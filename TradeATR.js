// =============================================================================
// TradeATR.js — вкладка «ATR» в панели инструмента «Стоп Тейк» (TradeLevelManager)
//
// Что умеет:
//   • считает и показывает ДНЕВНОЙ ATR (1D) — тем же алгоритмом и с теми же
//     настройками, что и индикатор «ATR Multi» (MultiTimeframeATRIndicator):
//     период dayATRPeriod, rangeMode, фильтр выбросов (Adaptive/Fixed) и т.д.;
//   • кнопки 10% / 15% / 20% (плюс свой процент) ставят стоп-лосс на расстоянии
//     N% от дневного ATR от цены входа: вниз для Long, вверх для Short;
//   • опционально очищает тейк, чтобы он пересчитался по R:R.
//
// Откуда берётся дневной ATR (по приоритету):
//   1. график на 1D и индикатор ATR Multi в авто-режиме → metrics.atr из виджета
//      (то самое число, которое показывает виджет ATR Multi);
//   2. график на 1D → свечи самого графика (chartData);
//   3. любой другой ТФ → запрос дневных свечей (1D) с биржи (кэш 30 сек);
//   4. запасной вариант (нет сети) → агрегация свечей текущего ТФ в дневные.
//
// Если индикатор ATR Multi не добавлен на график — расчёт всё равно работает:
// настройки берутся из localStorage('atr_multi_settings') либо значения по
// умолчанию, а формула ATR — из прототипа MultiTimeframeATRIndicator.
// =============================================================================
(function (global) {
    'use strict';

    const DAY_SEC = 86400;
    const FETCH_LIMIT = 200;          // сколько дневных свечей запрашиваем с биржи
    const CACHE_TTL_MS = 30000;       // время жизни кэша дневных свечей
    const FETCH_TIMEOUT_MS = 6000;    // таймаут запроса
    const AUTOREFRESH_MS = 30000;     // автообновление, пока открыта вкладка
    const PRESET_PCTS = [10, 15, 20]; // кнопки-пресеты

    // Настройки ATR Multi по умолчанию (совпадают с MultiTimeframeATRIndicator)
    const DEFAULTS = {
        dayATRPeriod: 3,
        rangeMode: 'High-Low',
        useFilter: true,
        filterType: 'Adaptive',
        devFactor: 1.0,
        fixedMult: 1.5,
        calcMode: 'auto'
    };

    // Длительность таймфрейма в секундах (для решения «можно ли агрегировать в дни»)
    const TF_SECONDS = {
        '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
        '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200,
        '1d': 86400, '1w': 604800, '1M': 2592000
    };

    const num = (v, def) => { const n = Number(v); return isFinite(n) ? n : def; };
    const posInt = (v, def) => { const n = Math.round(Number(v)); return (isFinite(n) && n > 0) ? n : def; };

    class TradeATRController {
        constructor(chartManager) {
            this.cm = chartManager || null;
            this.manager = null;      // TradeLevelManager
            this.panel = null;        // #tradeCreatePanel
            this.els = {};            // кэш DOM-элементов вкладки
            this._bound = false;

            this._cache = null;       // { key, ts, candles } — кэш дневных свечей с биржи
            this._inflight = null;    // { key, promise }    — идущий запрос
            this._last = null;        // последний успешный результат getDailyATR()
            this._busy = false;

            this._selectedPct = this._loadPct();
            this._autoTimer = null;
        }

        // ====================================================================
        //  РАСЧЁТ ДНЕВНОГО ATR
        // ====================================================================

        /** Живой экземпляр индикатора «ATR Multi», если он добавлен на график */
        _getIndicator() {
            try {
                const list = this.cm && this.cm.indicatorManager && this.cm.indicatorManager.activeIndicators;
                if (!Array.isArray(list)) return null;
                for (const ind of list) {
                    if (!ind) continue;
                    if (ind.type === 'multiatr') return ind;
                    if (ind.constructor && ind.constructor.name === 'MultiTimeframeATRIndicator') return ind;
                }
            } catch (e) { /* индикаторы ещё не инициализированы */ }
            return null;
        }

        _readSavedSettings() {
            try {
                const raw = localStorage.getItem('atr_multi_settings');
                return raw ? (JSON.parse(raw) || {}) : {};
            } catch (e) { return {}; }
        }

        /** Настройки дневного ATR: из индикатора, иначе из localStorage, иначе дефолт */
        _getSettings() {
            const ind = this._getIndicator();
            const src = (ind && ind.settings) ? ind.settings : this._readSavedSettings();
            return {
                dayATRPeriod: posInt(src.dayATRPeriod, DEFAULTS.dayATRPeriod),
                rangeMode: src.rangeMode || DEFAULTS.rangeMode,
                useFilter: src.useFilter !== undefined ? !!src.useFilter : DEFAULTS.useFilter,
                filterType: src.filterType || DEFAULTS.filterType,
                devFactor: num(src.devFactor, DEFAULTS.devFactor) > 0 ? num(src.devFactor, DEFAULTS.devFactor) : DEFAULTS.devFactor,
                fixedMult: num(src.fixedMult, DEFAULTS.fixedMult) > 0 ? num(src.fixedMult, DEFAULTS.fixedMult) : DEFAULTS.fixedMult,
                calcMode: src.calcMode || DEFAULTS.calcMode,
                fromIndicator: !!(ind && ind.settings)
            };
        }

        _normalizeTf(interval) {
            const raw = String(interval == null ? '' : interval).trim();
            if (raw === '1M' || raw === 'M') return '1M';           // месяц (регистр важен!)
            const i = raw.toLowerCase();
            if (TF_SECONDS[i] !== undefined) return i;
            if (i === 'd' || i === 'day') return '1d';
            if (i === 'w' || i === 'week') return '1w';
            if (i === '60' || i === 'h') return '1h';
            return i;
        }

        _isDailyTf() { return this._normalizeTf(this.cm && this.cm.currentInterval) === '1d'; }

        _tfSeconds() {
            const tf = this._normalizeTf(this.cm && this.cm.currentInterval);
            return TF_SECONDS[tf] || 3600;
        }

        /** Текущая цена (для NATR/превью и для «живой» дневной свечи) */
        _livePrice() {
            try {
                if (this.cm && typeof this.cm.getCurrentPrice === 'function') {
                    const p = this.cm.getCurrentPrice();
                    if (typeof p === 'number' && isFinite(p) && p > 0) return p;
                }
            } catch (e) {}
            try {
                const data = this.cm && this.cm.chartData;
                if (Array.isArray(data) && data.length) {
                    const c = data[data.length - 1];
                    if (c && isFinite(c.close) && c.close > 0) return c.close;
                }
            } catch (e) {}
            return null;
        }

        /**
         * Считаем ATR теми же формулами, что и индикатор ATR Multi.
         * Берём метод computeATRMetrics живого индикатора, а если его нет —
         * вызываем тот же метод из прототипа класса (без создания виджета).
         */
        _computeMetrics(candles, settings) {
            const period = settings.dayATRPeriod;
            if (!Array.isArray(candles) || candles.length < period + 1) return null;

            let calc = null;
            const ind = this._getIndicator();
            if (ind && typeof ind.computeATRMetrics === 'function') {
                calc = ind;
            } else {
                const Cls = global.MultiTimeframeATRIndicator;
                if (Cls && Cls.prototype && typeof Cls.prototype.computeATRMetrics === 'function') {
                    // Object.create — методы класса без side-эффектов конструктора
                    calc = Object.create(Cls.prototype);
                }
            }
            if (!calc) return null;

            try {
                const m = calc.computeATRMetrics(
                    candles, period,
                    settings.rangeMode, settings.useFilter,
                    settings.filterType, settings.devFactor, settings.fixedMult
                );
                if (!m || !(m.atr > 0) || !isFinite(m.atr)) return null;
                m._actualPeriod = period;
                return m;
            } catch (e) {
                console.warn('[TradeATR] computeATRMetrics:', e);
                return null;
            }
        }

        /** Склейка свечей текущего ТФ в дневные (UTC-границы, как у биржи) */
        _aggregateDaily(data) {
            if (!Array.isArray(data) || data.length === 0) return [];
            const buckets = new Map();
            for (const c of data) {
                if (!c || typeof c.time !== 'number' || !isFinite(c.high) || !isFinite(c.low)) continue;
                const day = Math.floor(c.time / DAY_SEC) * DAY_SEC;
                const b = buckets.get(day);
                if (!b) {
                    buckets.set(day, { time: day, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 });
                } else {
                    if (c.high > b.high) b.high = c.high;
                    if (c.low < b.low) b.low = c.low;
                    b.close = c.close;
                    b.volume += (c.volume || 0);
                }
            }
            const arr = Array.from(buckets.values()).sort((a, b) => a.time - b.time);
            // Первый «день» неполный, если график начался не с UTC-полуночи —
            // такой обрубок занижает ATR, поэтому отбрасываем его.
            if (arr.length > 1 && (data[0].time % DAY_SEC) !== 0) arr.shift();
            return arr;
        }

        /** Подмешиваем текущую цену в формирующуюся дневную свечу (без мутации chartData) */
        _mergeLive(candles) {
            if (!Array.isArray(candles) || !candles.length) return candles;
            const price = this._livePrice();
            if (!(price > 0)) return candles;

            const out = candles.slice();
            const last = out[out.length - 1];
            const todayStart = Math.floor(Date.now() / 1000 / DAY_SEC) * DAY_SEC;

            if (last.time >= todayStart) {
                out[out.length - 1] = {
                    ...last,
                    high: Math.max(last.high, price),
                    low: Math.min(last.low, price),
                    close: price
                };
            } else if (todayStart - last.time <= 2 * DAY_SEC) {
                // дневная свеча ещё не пришла — заводим формирующуюся сами
                out.push({ time: todayStart, open: price, high: price, low: price, close: price, volume: 0 });
            }
            return out;
        }

        /** Запрос дневных свечей с биржи (Binance/Bybit) + кэш */
        async _fetchDailyKlines() {
            const symbol = this.cm && this.cm.currentSymbol;
            if (!symbol) return null;
            const exchange = String((this.cm && this.cm.currentExchange) || 'binance').toLowerCase();
            const marketType = String((this.cm && this.cm.currentMarketType) || 'futures').toLowerCase();
            const key = `${symbol}:${exchange}:${marketType}`;

            if (this._cache && this._cache.key === key && (Date.now() - this._cache.ts) < CACHE_TTL_MS) {
                return this._cache.candles;
            }
            if (this._inflight && this._inflight.key === key) return this._inflight.promise;

            const promise = (async () => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
                try {
                    let url;
                    if (exchange === 'binance') {
                        const base = marketType === 'futures'
                            ? 'https://fapi.binance.com/fapi/v1/klines'
                            : 'https://api.binance.com/api/v3/klines';
                        url = `${base}?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=${FETCH_LIMIT}`;
                    } else {
                        const cat = marketType === 'futures' ? 'linear' : 'spot';
                        url = `https://api.bybit.com/v5/market/kline?category=${cat}&symbol=${encodeURIComponent(symbol)}&interval=D&limit=${FETCH_LIMIT}`;
                    }

                    const resp = await fetch(url, { signal: controller.signal });
                    if (!resp.ok) return null;
                    const data = await resp.json();

                    let candles;
                    if (exchange === 'binance') {
                        if (!Array.isArray(data)) return null;
                        candles = data.map(k => ({
                            time: Math.floor(Number(k[0]) / 1000),
                            open: parseFloat(k[1]), high: parseFloat(k[2]),
                            low: parseFloat(k[3]), close: parseFloat(k[4]),
                            volume: parseFloat(k[5]) || 0
                        }));
                    } else {
                        if (!data || data.retCode !== 0 || !data.result || !Array.isArray(data.result.list)) return null;
                        candles = data.result.list.map(k => ({
                            time: Math.floor(parseInt(k[0], 10) / 1000),
                            open: parseFloat(k[1]), high: parseFloat(k[2]),
                            low: parseFloat(k[3]), close: parseFloat(k[4]),
                            volume: parseFloat(k[5]) || 0
                        })).reverse(); // Bybit отдаёт от новых к старым
                    }

                    candles = candles
                        .filter(c => c.time > 0 && isFinite(c.high) && isFinite(c.low))
                        .sort((a, b) => a.time - b.time);

                    if (!candles.length) return null;
                    this._cache = { key, ts: Date.now(), candles };
                    return candles;
                } catch (e) {
                    return null; // сеть/CORS/таймаут — уходим на агрегацию
                } finally {
                    clearTimeout(timer);
                }
            })();

            this._inflight = { key, promise };
            try {
                return await promise;
            } finally {
                if (this._inflight && this._inflight.promise === promise) this._inflight = null;
            }
        }

        /**
         * Главный вход: дневной ATR.
         * @returns {Promise<null|{atr,natr,period,progress,source,hasIndicator,days}>}
         */
        async getDailyATR(force = false) {
            const settings = this._getSettings();
            const period = settings.dayATRPeriod;
            const ind = this._getIndicator();

            // (1) График на дневке + ATR Multi в авто-режиме → значение из виджета
            if (ind && this._isDailyTf() && settings.calcMode !== 'manual') {
                try { if (typeof ind.updateMetrics === 'function') ind.updateMetrics(); } catch (e) {}
                const m = ind.metrics;
                if (m && m.atr > 0) {
                    return {
                        atr: m.atr,
                        natr: m.natr || 0,
                        progress: m.progress || 0,
                        period: m._actualPeriod || period,
                        source: 'виджет ATR Multi (1D)',
                        hasIndicator: true,
                        days: Array.isArray(this.cm.chartData) ? this.cm.chartData.length : 0
                    };
                }
            }

            // (2) Дневные свечи
            let candles = null;
            let source = '';
            const chartData = this.cm && this.cm.chartData;

            if (this._isDailyTf() && Array.isArray(chartData) && chartData.length >= period + 1) {
                candles = chartData;
                source = 'свечи графика (1D)';
            } else {
                candles = await this._fetchDailyKlines();
                source = 'запрос 1D с биржи';

                if (!candles || candles.length < period + 1) {
                    // (3) запасной путь: агрегация текущего ТФ в дневные свечи
                    const tfSec = this._tfSeconds();
                    if (tfSec < DAY_SEC) {
                        const agg = this._aggregateDaily(chartData);
                        if (agg.length >= period + 1) {
                            candles = agg;
                            source = `агрегация ${String(this._normalizeTf(this.cm.currentInterval)).toUpperCase()} → 1D`;
                        }
                    }
                }
            }

            if (!candles || candles.length < period + 1) return null;

            const prepared = this._mergeLive(candles);
            const m = this._computeMetrics(prepared, settings);
            if (!m) return null;

            return {
                atr: m.atr,
                natr: m.natr || 0,
                progress: m.progress || 0,
                period,
                source,
                hasIndicator: !!ind,
                days: prepared.length
            };
        }

        // ====================================================================
        //  UI
        // ====================================================================

        /** Привязка к панели «Стоп Тейк» (вызывается каждый раз при открытии) */
        bind(panel, manager) {
            this.panel = panel;
            this.manager = manager;
            if (!panel) return false;

            const ids = [
                'tradeAtrPanel', 'tradeAtrValue', 'tradeAtrPeriod', 'tradeAtrNatr', 'tradeAtrProgress',
                'tradeAtrSource', 'tradeAtrRefreshBtn', 'tradeAtrCustomPct', 'tradeAtrCustomBtn',
                'tradeAtrPreviewSL', 'tradeAtrPreviewDist', 'tradeAtrHint', 'tradeAtrRecalcTP',
                'tradeAtrApplyBtn', 'tradeAtrCloseBtn'
            ];
            const els = {};
            let missing = false;
            ids.forEach(id => {
                els[id] = panel.querySelector('#' + id) || document.getElementById(id);
                if (!els[id]) missing = true;
            });
            els.pctButtons = Array.from(panel.querySelectorAll('.trade-atr-pct-btn'));
            if (!els.tradeAtrPanel || !els.pctButtons.length) missing = true;

            if (missing) {
                console.warn('[TradeATR] в index.html нет разметки вкладки ATR (#tradeAtrPanel) — вкладка не активна');
                return false;
            }
            this.els = els;

            if (!this._bound) {
                this._bound = true;

                els.pctButtons.forEach(btn => {
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        this._selectPct(num(btn.dataset.pct, 10));
                        this._applyPercent(this._selectedPct);
                    };
                });

                if (els.tradeAtrCustomBtn) {
                    els.tradeAtrCustomBtn.onclick = (e) => {
                        e.stopPropagation();
                        const pct = num(els.tradeAtrCustomPct && els.tradeAtrCustomPct.value, 0);
                        if (!(pct > 0)) { this._setHint('Введите процент больше 0', '#f23645'); return; }
                        this._selectPct(pct);
                        this._applyPercent(pct);
                    };
                }
                if (els.tradeAtrCustomPct) {
                    els.tradeAtrCustomPct.onkeydown = (e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') { e.preventDefault(); els.tradeAtrCustomBtn && els.tradeAtrCustomBtn.click(); }
                    };
                    els.tradeAtrCustomPct.oninput = () => {
                        const pct = num(els.tradeAtrCustomPct.value, 0);
                        if (pct > 0) { this._selectPct(pct, true); this._renderPreview(); }
                    };
                }

                if (els.tradeAtrRefreshBtn) {
                    els.tradeAtrRefreshBtn.onclick = (e) => { e.stopPropagation(); this.refresh(true); };
                }
                if (els.tradeAtrApplyBtn) {
                    els.tradeAtrApplyBtn.onclick = (e) => { e.stopPropagation(); this._applyAndSave(); };
                }
                if (els.tradeAtrCloseBtn) {
                    els.tradeAtrCloseBtn.onclick = (e) => {
                        e.stopPropagation();
                        if (this.manager && typeof this.manager._closePanel === 'function') this.manager._closePanel();
                    };
                }
                if (els.tradeAtrRecalcTP) {
                    els.tradeAtrRecalcTP.checked = this._loadRecalcTP();
                    els.tradeAtrRecalcTP.onchange = () => this._saveRecalcTP(els.tradeAtrRecalcTP.checked);
                }

                // Превью стопа должно жить при изменении входа/направления
                const entryInput = document.getElementById('tradeEntryInput');
                if (entryInput) entryInput.addEventListener('input', () => this._renderPreview());
                ['tradeDirectionLong', 'tradeDirectionShort'].forEach(id => {
                    const b = document.getElementById(id);
                    if (b) b.addEventListener('click', () => setTimeout(() => this._renderPreview(), 0));
                });
            }

            this._selectPct(this._selectedPct, true);
            return true;
        }

        /** Панель открылась: сбрасываем состояние и греем расчёт в фоне */
        onPanelOpen() {
            if (!this.els.tradeAtrPanel) return;
            this._setHint('Считаем дневной ATR…', '#8A8A8A');
            this.refresh(false);
            this._startAutoRefresh();
        }

        /** Панель закрылась */
        onPanelClose() {
            this._stopAutoRefresh();
        }

        /** Переключились на вкладку ATR */
        onTabShow() {
            this._renderPreview();
            // если значение устарело (другой символ/ТФ или прошло > CACHE_TTL) — пересчитать
            const stale = !this._last || (Date.now() - (this._lastTs || 0)) > CACHE_TTL_MS;
            if (stale) this.refresh(false);
        }

        _startAutoRefresh() {
            this._stopAutoRefresh();
            this._autoTimer = setInterval(() => {
                const visible = this.panel && this.panel.style.display !== 'none'
                    && this.els.tradeAtrPanel && this.els.tradeAtrPanel.style.display !== 'none';
                if (visible && !document.hidden) this.refresh(false);
            }, AUTOREFRESH_MS);
        }

        _stopAutoRefresh() {
            if (this._autoTimer) { clearInterval(this._autoTimer); this._autoTimer = null; }
        }

        async refresh(force = false) {
            if (!this.els.tradeAtrValue || this._busy) return;
            this._busy = true;
            this.els.tradeAtrValue.textContent = '…';
            this._setHint(force ? 'Пересчитываем дневной ATR…' : 'Считаем дневной ATR…', '#8A8A8A');
            try {
                const res = await this.getDailyATR(force);
                if (res && res.atr > 0) {
                    this._last = res;
                    this._lastTs = Date.now();
                    this._render(res);
                } else {
                    this._last = null;
                    this._renderEmpty('Нет данных для расчёта дневного ATR');
                }
            } catch (e) {
                console.warn('[TradeATR] refresh:', e);
                this._last = null;
                this._renderEmpty('Ошибка расчёта дневного ATR');
            } finally {
                this._busy = false;
            }
            this._renderPreview();
        }

        _precision() {
            try {
                if (this.manager && typeof this.manager._getChartPrecision === 'function') return this.manager._getChartPrecision();
            } catch (e) {}
            return 2;
        }

        _fmtPrice(v) {
            if (this.manager && typeof this.manager._formatPrice === 'function') return this.manager._formatPrice(v);
            return Number(v).toFixed(this._precision());
        }

        _render(res) {
            const e = this.els;
            const prec = this._precision();
            if (e.tradeAtrValue) {
                e.tradeAtrValue.textContent = res.atr.toFixed(prec);
                e.tradeAtrValue.style.color = '#FFA500';
            }
            if (e.tradeAtrPeriod) e.tradeAtrPeriod.textContent = res.period;
            if (e.tradeAtrNatr) e.tradeAtrNatr.textContent = res.natr > 0 ? res.natr.toFixed(2) + '%' : '—';
            if (e.tradeAtrProgress) e.tradeAtrProgress.textContent = res.progress > 0 ? res.progress.toFixed(0) + '%' : '—';
            if (e.tradeAtrSource) {
                const sym = (this.cm && this.cm.currentSymbol) || '';
                const tail = res.hasIndicator ? '' : ' · индикатор ATR Multi не добавлен (настройки по умолчанию)';
                e.tradeAtrSource.textContent = `${sym} · 1D · период ${res.period} · ${res.source}${tail}`;
            }
            this._setHint(`Стоп = ${this._fmtPct(this._selectedPct)} от дневного ATR. Нажмите «Применить стоп».`, '#8A8A8A');
        }

        _renderEmpty(msg) {
            const e = this.els;
            if (e.tradeAtrValue) { e.tradeAtrValue.textContent = '—'; e.tradeAtrValue.style.color = '#6E6E6E'; }
            if (e.tradeAtrPeriod) e.tradeAtrPeriod.textContent = '—';
            if (e.tradeAtrNatr) e.tradeAtrNatr.textContent = '—';
            if (e.tradeAtrProgress) e.tradeAtrProgress.textContent = '—';
            if (e.tradeAtrSource) {
                const tf = String(this._normalizeTf(this.cm && this.cm.currentInterval)).toUpperCase();
                e.tradeAtrSource.textContent = `Нет дневных свечей (текущий ТФ ${tf}). Нажмите ⟳ для повтора.`;
            }
            if (e.tradeAtrPreviewSL) e.tradeAtrPreviewSL.textContent = '—';
            if (e.tradeAtrPreviewDist) e.tradeAtrPreviewDist.textContent = '—';
            this._setHint(msg, '#f23645');
        }

        _fmtPct(pct) {
            const n = Number(pct);
            if (!isFinite(n)) return '—';
            return (Math.round(n * 100) / 100) + '%';
        }

        _setHint(text, color) {
            if (!this.els.tradeAtrHint) return;
            this.els.tradeAtrHint.textContent = text;
            this.els.tradeAtrHint.style.color = color || '#8A8A8A';
        }

        _selectPct(pct, silent) {
            this._selectedPct = num(pct, 10);
            this._savePct(this._selectedPct);
            (this.els.pctButtons || []).forEach(btn => {
                const active = num(btn.dataset.pct, -1) === this._selectedPct;
                btn.style.background = active ? '#FFA500' : '#2D2D2D';
                btn.style.color = active ? '#1E1E1E' : '#fff';
                btn.style.border = active ? '1px solid #FFA500' : '1px solid #404040';
                btn.style.fontWeight = active ? 'bold' : 'normal';
            });
            if (this.els.tradeAtrCustomPct && !PRESET_PCTS.includes(this._selectedPct)) {
                this.els.tradeAtrCustomPct.value = this._selectedPct;
            }
            if (!silent) this._renderPreview();
        }

        /** Цена входа из поля; если пусто — текущая цена рынка (в поле НЕ пишем) */
        _entryValue() {
            const input = document.getElementById('tradeEntryInput');
            const v = input ? parseFloat(input.value) : NaN;
            if (isFinite(v) && v > 0) return { price: v, filled: true };
            const live = this._livePrice();
            return { price: (isFinite(live) && live > 0) ? live : null, filled: false };
        }

        _renderPreview() {
            const e = this.els;
            if (!e.tradeAtrPreviewSL || !e.tradeAtrPreviewDist) return;
            const res = this._last;
            const entryInfo = this._entryValue();
            if (!res || !(res.atr > 0) || !(entryInfo.price > 0)) {
                e.tradeAtrPreviewSL.textContent = '—';
                e.tradeAtrPreviewDist.textContent = '—';
                return;
            }
            const dist = res.atr * (this._selectedPct / 100);
            const dir = (this.manager && this.manager._selectedDirection) || 'long';
            const sl = dir === 'long' ? entryInfo.price - dist : entryInfo.price + dist;
            e.tradeAtrPreviewSL.textContent = this._fmtPrice(sl);
            e.tradeAtrPreviewDist.textContent =
                `${this._fmtPrice(dist)} · ${this._fmtPct(this._selectedPct)} ATR · ${(dist / entryInfo.price * 100).toFixed(2)}% цены`;
        }

        /** Клик по 10% / 15% / 20% / «Свой %» → пишем стоп в поле SL */
        _applyPercent(pct) {
            const e = this.els;
            const res = this._last;
            if (!res || !(res.atr > 0)) {
                this._setHint('Дневной ATR ещё не рассчитан — нажмите ⟳', '#f23645');
                return;
            }
            const p = num(pct, 0);
            if (!(p > 0)) { this._setHint('Процент должен быть больше 0', '#f23645'); return; }

            const entryInput = document.getElementById('tradeEntryInput');
            const slInput = document.getElementById('tradeSLInput');
            const tpInput = document.getElementById('tradeTPInput');
            if (!entryInput || !slInput) return;

            let entry = parseFloat(entryInput.value);
            let autoEntry = false;
            if (!(isFinite(entry) && entry > 0)) {
                entry = this._livePrice();
                if (!(entry > 0)) { this._setHint('Не задана цена входа (ТВХ)', '#f23645'); return; }
                entryInput.value = this._fmtPrice(entry);
                autoEntry = true;
            }

            const dist = res.atr * (p / 100);
            const dir = (this.manager && this.manager._selectedDirection) || 'long';
            const sl = dir === 'long' ? entry - dist : entry + dist;
            if (!(sl > 0)) { this._setHint('Стоп получился ≤ 0 — уменьшите процент', '#f23645'); return; }

            slInput.value = this._fmtPrice(sl);

            // Тейк: по галке пересчитываем по R:R (как при перетаскивании стопа на графике)
            if (e.tradeAtrRecalcTP && e.tradeAtrRecalcTP.checked) {
                if (tpInput) tpInput.value = '';
                if (this.manager) this.manager._tpManuallySet = false;
            }

            if (this.manager) {
                try { this.manager._updateStep(); } catch (err) {}
                try { this.manager._updatePreview(); } catch (err) {}
            }

            // подсветка поля SL — видно, куда встал стоп
            const prevBorder = slInput.style.border;
            slInput.style.border = '1px solid #FFA500';
            setTimeout(() => { slInput.style.border = prevBorder || ''; }, 500);

            const dirText = dir === 'long' ? 'Long (стоп ниже входа)' : 'Short (стоп выше входа)';
            this._setHint(
                `${autoEntry ? 'Цена входа не была задана — подставлена текущая ' + this._fmtPrice(entry) + '. ' : ''}` +
                `Стоп ${this._fmtPrice(sl)} = ${this._fmtPct(p)} от ATR (${this._fmtPrice(dist)}). ${dirText}.`,
                autoEntry ? '#FFA500' : '#00ff88'
            );
            this._renderPreview();
        }

        /** «Применить стоп» → ещё раз ставим стоп и сохраняем сделку */
        _applyAndSave() {
            if (!this.manager) return;
            if (this._last && this._last.atr > 0) this._applyPercent(this._selectedPct);

            const slInput = document.getElementById('tradeSLInput');
            if (!slInput || !(parseFloat(slInput.value) > 0)) {
                this._setHint('Стоп не задан: сначала нажмите 10% / 15% / 20%', '#f23645');
                return;
            }

            let submitted = false;
            try {
                if (typeof this.manager._handlePanelSubmit === 'function') {
                    this.manager._handlePanelSubmit();
                    submitted = true;
                }
            } catch (err) {
                console.warn('[TradeATR] submit:', err);
            }

            // если панель осталась открытой — _handlePanelSubmit показал ошибку
            const stillOpen = this.panel && this.panel.style.display !== 'none';
            if (submitted && stillOpen) {
                const rewardEl = document.getElementById('tradePreviewReward');
                const msg = rewardEl ? rewardEl.textContent.replace(/^❌\s*/, '').trim() : '';
                this._setHint(msg || 'Не применено — проверьте цену входа и стоп', '#f23645');
            }
        }

        // --------------------------- localStorage ---------------------------
        _loadPct() {
            try {
                const v = parseFloat(localStorage.getItem('trade_atr_pct'));
                if (isFinite(v) && v > 0) return v;
            } catch (e) {}
            return PRESET_PCTS[0];
        }
        _savePct(pct) {
            try { localStorage.setItem('trade_atr_pct', String(pct)); } catch (e) {}
        }
        _loadRecalcTP() {
            try { return localStorage.getItem('trade_atr_recalc_tp') !== '0'; } catch (e) { return true; }
        }
        _saveRecalcTP(v) {
            try { localStorage.setItem('trade_atr_recalc_tp', v ? '1' : '0'); } catch (e) {}
        }
    }

    global.TradeATRController = TradeATRController;
    global.TradeATRPresets = PRESET_PCTS;
})(typeof window !== 'undefined' ? window : globalThis);
