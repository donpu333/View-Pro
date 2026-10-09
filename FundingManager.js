/**
 * FundingManager — ставка фандинга (funding rate) для фьючерсов.
 *
 * Показывается в легенде графика (OTKP/MAKC/MIN/ZAKR/VOL/FAND) в двух видах:
 *  • наведение на ИСТОРИЧЕСКУЮ свечу — ставка, действовавшая на момент этой свечи
 *    (ближайший расчёт фандинга до её времени, шаг 8 часов);
 *  • наведение на ПОСЛЕДНЮЮ свечу — текущая ставка + сколько до следующего начисления.
 *
 * Источники:
 *  Binance futures: текущая  — fapi/v1/premiumIndex?symbol=X (lastFundingRate, nextFundingTime)
 *                   история — fapi/v1/fundingRate?symbol=X&limit=1000 (~333 суток)
 *  Bybit   linear : текущая  — v5/market/tickers?category=linear&symbol=X (fundingRate, nextFundingTime)
 *                   история — v5/market/funding/history?category=linear&symbol=X&limit=200 (~66 суток)
 *  Spot: фандинга нет — getRateAt() возвращает null, пункт легенды скрывается.
 *
 * Экономия запросов: история символа кэшируется в памяти на сессию (1 запрос на символ),
 * текущая ставка обновляется раз в 60 с и только в видимой вкладке (вес premiumIndex = 1).
 * Все запросы с таймаутом 6 с и проверкой «символ не сменился, пока летел запрос».
 */
class FundingManager {
    constructor(chartManager) {
        this.cm = chartManager;
        this.symbolKey = null;          // 'SYMBOL|exchange|marketType' — для чего держим данные
        this.current = null;            // { rate: Number (доля, 0.0001 = 0.01%), nextFundingTime: ms }
        this.history = [];              // [{ t: сек, rate: доля }] по возрастанию t
        this._histCache = new Map();    // symbolKey -> history (кэш сессии)
        this._refreshTimer = null;
        this._fetchSeq = 0;             // защита от гонки при быстрых переключениях
        // [FUNDING-BADGE] постоянно видимый бейдж (левый верхний угол графика)
        this._badgeEl = null;
        this._badgeRateEl = null;
        this._badgeTimerEl = null;
        this._badgeTimer = null;        // setInterval 1с — тиканье таймера
        this._lastAutoRefresh = 0;      // троттл автообновления после истечения отсчёта
    }

    /** Вызывается ChartManager при смене символа (и при первичной загрузке). */
    onSymbolChanged(symbol, exchange, marketType) {
        const key = `${symbol}|${exchange}|${marketType}`;
        this.symbolKey = key;
        this.current = null;
        this.history = this._histCache.get(key) || [];
        this._fetchSeq++;
        if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
        if (marketType !== 'futures' || !symbol) {          // спот: фандинга нет
            this._stopBadgeTicker();
            this._showBadge(false);
            return;
        }
        // [FUNDING-BADGE] постоянный бейдж в левом верхнем углу графика:
        // виден ВСЕГДА (не только при наведении перекрестия), тикает каждую секунду
        this._showBadge(true);
        this._startBadgeTicker();
        this.refreshCurrent();
        if (!this.history.length) this._loadHistory(symbol, exchange, key);
        // периодическое обновление текущей ставки (только видимая вкладка, только этот символ)
        this._refreshTimer = setInterval(() => {
            try {
                if (typeof document !== 'undefined' && document.hidden) return;
                if (this.symbolKey === key) this.refreshCurrent();
            } catch (e) {}
        }, 60000);
    }

    /** Текущая ставка + время следующего начисления. */
    async refreshCurrent() {
        if (!this.symbolKey) return;
        const [symbol, exchange, marketType] = this.symbolKey.split('|');
        if (marketType !== 'futures') return;
        const mySeq = this._fetchSeq;
        const keyAtStart = this.symbolKey;
        try {
            const d = await this._getJson(exchange === 'binance'
                ? `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`
                : `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${encodeURIComponent(symbol)}`);
            if (this.symbolKey !== keyAtStart || this._fetchSeq !== mySeq) return;   // уже другой символ
            let rate = null, nextT = null;
            if (exchange === 'binance') {
                if (!d || d.lastFundingRate === undefined) return;
                rate = parseFloat(d.lastFundingRate);
                nextT = parseInt(d.nextFundingTime, 10) || null;
            } else {
                const t = (d && d.retCode === 0 && Array.isArray(d.result && d.result.list)) ? d.result.list[0] : null;
                if (!t) return;
                rate = parseFloat(t.fundingRate);
                nextT = parseInt(t.nextFundingTime, 10) || null;
            }
            if (!isFinite(rate)) return;
            this.current = { rate, nextFundingTime: nextT };
            this._updateBadge();   // [FUNDING-BADGE] мгновенно отразить новую ставку/отсчёт
            // легенда перекрестия открыта — освежить цифру сразу, не ждать следующего движения мыши
            try {
                if (this.cm && this.cm._latestCrosshairData && this.cm._latestCrosshairData.visible) {
                    this.cm._applyCrosshairDOMOptimized();
                }
            } catch (e) {}
        } catch (e) { /* фандинг — информация справочная, молча живём без него */ }
    }

    /** История начислений (8-часовые отметки) — один раз на символ за сессию. */
    async _loadHistory(symbol, exchange, key) {
        const mySeq = this._fetchSeq;
        try {
            let arr = [];
            if (exchange === 'binance') {
                const d = await this._getJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${encodeURIComponent(symbol)}&limit=1000`);
                if (Array.isArray(d)) {
                    arr = d.map(x => ({ t: Math.floor((x.fundingTime || 0) / 1000), rate: parseFloat(x.fundingRate) }))
                           .filter(x => x.t > 0 && isFinite(x.rate));
                }
            } else if (exchange === 'bybit') {
                const d = await this._getJson(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${encodeURIComponent(symbol)}&limit=200`);
                const list = (d && d.retCode === 0 && Array.isArray(d.result && d.result.list)) ? d.result.list : null;
                if (list) {
                    arr = list.map(x => ({ t: Math.floor((x.fundingRateTimestamp || 0) / 1000), rate: parseFloat(x.fundingRate) }))
                           .filter(x => x.t > 0 && isFinite(x.rate));
                }
            }
            if (!arr.length) return;
            arr.sort((a, b) => a.t - b.t);
            this._histCache.set(key, arr);
            if (this.symbolKey === key && this._fetchSeq === mySeq) this.history = arr;
        } catch (e) {}
    }

    /**
     * Ставка фандинга (доля: 0.0001 = 0.01%) на момент свечи timeSec.
     * null — если это спот / данных нет. Для последней свечи и правее истории —
     * текущая ставка (она же действует до следующего начисления).
     */
    getRateAt(timeSec) {
        if (!this.symbolKey) return null;
        const parts = this.symbolKey.split('|');
        if (parts[2] !== 'futures') return null;
        const t = Number(timeSec);
        if (!isFinite(t) || t <= 0) return this.current ? this.current.rate : null;
        const h = this.history;
        if (!h || !h.length) return this.current ? this.current.rate : null;
        // бинарный поиск: последнее начисление с t <= timeSec
        let lo = 0, hi = h.length - 1, res = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (h[mid].t <= t) { res = mid; lo = mid + 1; } else { hi = mid - 1; }
        }
        if (res === -1) return h[0].rate;                       // свеча левее всей истории
        if (res === h.length - 1 && this.current) return this.current.rate;  // правый край — живая ставка
        return h[res].rate;
    }

    /** «3ч05м» до следующего начисления (пустая строка, если неизвестно). */
    getNextFundingText() {
        if (!this.current || !this.current.nextFundingTime) return '';
        const ms = this.current.nextFundingTime - Date.now();
        if (!(ms > 0)) return 'сейчас';
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        return `${h}ч${String(m).padStart(2, '0')}м`;
    }

    /* ================= [FUNDING-BADGE] постоянный бейдж ================= */

    /**
     * Создаёт (один раз) и возвращает элемент бейджа в ЛЕВОМ ВЕРХНЕМ УГЛУ графика.
     * Крепится в #chart-container — тот же позиционированный предок, что у
     * затемнения переключения, поэтому угол совпадает с углом графика точно.
     * Панель рисования стоит ниже (top:60px) — пересечений нет. Все DOM-операции
     * обёрнуты в try/catch: окружение без DOM (тесты) не должно падать.
     */
    _ensureBadge() {
        try {
            if (this._badgeEl && typeof document !== 'undefined' && document.body && document.body.contains(this._badgeEl)) return this._badgeEl;
            if (typeof document === 'undefined') return null;
            const exist = document.getElementById('fundingBadge');
            if (exist) { this._badgeEl = exist; }
            else {
                const host = document.getElementById('chart-container') || document.body;
                if (!host) return null;
                if (typeof getComputedStyle === 'function' && getComputedStyle(host).position === 'static') host.style.position = 'relative';
                const b = document.createElement('div');
                b.id = 'fundingBadge';
                b.title = 'Фандинг (фьючерсы): текущая ставка и время до следующего начисления';
                b.style.cssText = 'position:absolute;top:10px;left:20px;z-index:999;display:none;align-items:center;gap:7px;' +
                    'padding:4px 10px;background:rgba(18,20,26,0.78);border:1px solid rgba(255,255,255,0.14);border-radius:6px;' +
                    'font-size:12px;line-height:1;color:#d1d4dc;pointer-events:none;white-space:nowrap;user-select:none;' +
                    'backdrop-filter:blur(3px);box-shadow:0 1px 4px rgba(0,0,0,0.4)';
                b.innerHTML = '<span style="color:#787b86;font-size:10px;letter-spacing:.6px">FAND</span>' +
                    '<span class="fb-rate" style="font-weight:700;font-variant-numeric:tabular-nums;color:#808080">\u2026</span>' +
                    '<span style="color:#4a4d56">\u00b7</span>' +
                    '<span class="fb-timer" style="font-weight:600;font-variant-numeric:tabular-nums;color:#b2b5be">--:--:--</span>';
                host.appendChild(b);
                this._badgeEl = b;
            }
            this._badgeRateEl = this._badgeEl.querySelector ? this._badgeEl.querySelector('.fb-rate') : null;
            this._badgeTimerEl = this._badgeEl.querySelector ? this._badgeEl.querySelector('.fb-timer') : null;
            return this._badgeEl;
        } catch (e) { return null; }
    }

    _showBadge(show) {
        try {
            const b = show ? this._ensureBadge() : this._badgeEl;
            if (b && b.style) b.style.display = show ? 'flex' : 'none';
        } catch (e) {}
    }

    _startBadgeTicker() {
        if (this._badgeTimer || typeof setInterval !== 'function') return;
        this._badgeTimer = setInterval(() => { try { this._updateBadge(); } catch (e) {} }, 1000);
        this._updateBadge();
    }

    _stopBadgeTicker() {
        if (this._badgeTimer) { clearInterval(this._badgeTimer); this._badgeTimer = null; }
    }

    /** Ставка + обратный отсчёт ЧЧ:ММ:СС до следующего начисления (тик раз в секунду). */
    _updateBadge() {
        const b = this._badgeEl;
        if (!b || !b.style || b.style.display === 'none') return;
        const rateEl = this._badgeRateEl, timerEl = this._badgeTimerEl;
        if (rateEl) {
            const r = this.current ? this.current.rate : null;
            if (r !== null && isFinite(r)) {
                const txt = (r > 0 ? '+' : '') + (r * 100).toFixed(4) + '%';
                if (rateEl.textContent !== txt) rateEl.textContent = txt;
                const col = r > 0 ? '#26a69a' : (r < 0 ? '#ef5350' : '#808080');
                if (rateEl.style.color !== col) rateEl.style.color = col;
            } else if (rateEl.textContent !== '\u2026') {
                rateEl.textContent = '\u2026';
            }
        }
        if (timerEl) {
            const nt = this.current ? this.current.nextFundingTime : null;
            let txt = '--:--:--';
            if (nt) {
                const ms = nt - Date.now();
                if (ms <= 0) {
                    txt = '00:00:00';
                    // начисление состоялось — тянем свежие данные (троттл: не чаще раза в 5 с)
                    const n = Date.now();
                    if (n - this._lastAutoRefresh > 5000) { this._lastAutoRefresh = n; this.refreshCurrent(); }
                } else {
                    const h = Math.floor(ms / 3600000);
                    const m = Math.floor((ms % 3600000) / 60000);
                    const s = Math.floor((ms % 60000) / 1000);
                    txt = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                }
            }
            if (timerEl.textContent !== txt) timerEl.textContent = txt;
        }
    }

    /** fetch с таймаутом 6 с; null при любой ошибке. */
    async _getJson(url) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 6000);
        try {
            const r = await fetch(url, { signal: ctrl.signal });
            if (!r.ok) return null;
            return await r.json();
        } catch (e) {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    destroy() {
        this._fetchSeq++;
        this._stopBadgeTicker();
        this._showBadge(false);
        if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
        this._histCache.clear();
        this.history = [];
        this.current = null;
        this.symbolKey = null;
    }
}

if (typeof window !== 'undefined') {
    window.FundingManager = FundingManager;
}
