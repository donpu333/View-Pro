/**
 * TimeframeManager v2 — исправленная версия.
 *
 * Что починено (номера соответствуют pm/TIMEFRAMEMANAGER-REVIEW.md):
 *
 *  TF1/TF2  Гонка при быстром переключении таймфреймов. Переключения ставятся
 *           в ОЧЕРЕДЬ с коалесцингом: параллельных switchInterval больше нет,
 *           устаревший результат не может откатить успешный, побеждает
 *           ПОСЛЕДНИЙ клик. Раньше: клик «1h» → через 10мс «4h» давали
 *           badge=15m, WS=15m, localStorage=4h, график=4h — четыре
 *           рассогласованных источника истины.
 *  TF3      destroy() останавливает timerManager (раньше таймер тикал вечно).
 *  TF4      destroy() реально отписывается от _subscribeToSymbolChange
 *           (возвращаемая функция отписки раньше выбрасывалась).
 *  TF5      Каждый менеджер в rAF-цепочке синхронизации обёрнут в свой try/catch:
 *           падение rayManager больше не оставляет АЛЕРТЫ и трендовые линии
 *           на старом таймфрейме.
 *  TF6      Восстановление вьюпорта включается опцией restoreViewportOnSwitch.
 *  TF7      Alt+T защищён от повторного нажатия до завершения switchSymbol;
 *           работает и с зажатым Shift (event.key === 'T').
 *  TF8      Зависимости проверяются в конструкторе, timerManager опционален.
 *
 *  Публичный API сохранён: constructor(chartManager, wsManager, timerManager),
 *  switchToTimeframe, restorePosition, saveCurrentPosition, updateInstrumentInfo,
 *  scrollToLastCandle, autoScaleChart, copyToClipboard, loadStarredTimeframes,
 *  saveStarredTimeframes, updateStarredDisplay, destroy.
 *  Добавлен необязательный 4-й аргумент options.
 */

const DEFAULT_OPTIONS = {
    restoreViewportOnSwitch: false,  // TF6: по умолчанию поведение прежнее (не восстанавливаем)
    switchDebounceMs: 100,           // окно коалесцинга быстрых кликов
    syncManagers: ['rayManager', 'trendLineManager', 'rulerLineManager', 'alertLineManager', 'textManager']
};

class TimeframeManager {
    constructor(chartManager, wsManager, timerManager, options = {}) {
        // TF8: раньше init() падал с «Cannot read properties of null (reading 'start')»,
        // если timerManager не передали, — хотя в switchToTimeframe проверка была.
        if (!chartManager) {
            throw new Error('TimeframeManager: chartManager обязателен');
        }
        this.chartManager = chartManager;
        this.wsManager = wsManager || null;
        this.timerManager = timerManager || { start() {}, stop() {}, updatePrice() {} };
        this.opts = Object.assign({}, DEFAULT_OPTIONS, options || {});

        this.currentInterval = this._getInitialInterval();
        console.log('📊 TimeframeManager: таймфрейм =', this.currentInterval);

        this.savedCenterTime = null;
        this.savedTimeSpan = null;
        this.savedVisibleBars = 0;
        this._timeScaleUnsubscribe = null;
        this._abortController = null;
        this._saveTimeout = null;

        this._destroyed = false;
        this._uiListeners = [];
        this._symbolChangeHandler = null;
        this._symbolChangeUnsub = null;      // TF4

        // TF1/TF2: очередь переключений
        this._switchQueued = null;           // последний запрошенный таймфрейм
        this._switchRunning = false;
        this._switchDebounceTimer = null;
        this._switchWaiters = [];            // кто ждёт завершения (см. switchToTimeframe)
        this._marketSwitchInFlight = false;  // TF7

        this._handleDocumentClick = this._handleDocumentClick.bind(this);
        this._handleGlobalClick = this._handleGlobalClick.bind(this);
        this._handleGlobalKeydown = this._handleGlobalKeydown.bind(this);
        this._handleVisibleRangeChange = this._handleVisibleRangeChange.bind(this);

        this.init();
    }

    _addListener(target, type, handler) {
        if (!target || typeof target.addEventListener !== 'function') return;
        target.addEventListener(type, handler);
        this._uiListeners.push({ target, type, handler });
    }

    _getInitialInterval() {
        const saved = this._storageGet('lastTimeframe');
        const defaultInterval = (typeof CONFIG !== 'undefined' && CONFIG.defaultInterval) ? CONFIG.defaultInterval : '15m';
        return (saved && this._isValidTimeframe(saved)) ? saved : defaultInterval;
    }

    _isValidTimeframe(tf) {
        return Boolean(tf && (typeof TF_LABELS === 'undefined' || TF_LABELS[tf]));
    }

    _storageGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }   // приватный режим бросает
    }

    _storageSet(key, value) {
        try { localStorage.setItem(key, value); } catch (e) {}
    }

    init() {
        this.updateInstrumentInfo();
        this.loadStarredTimeframes();
        this.setupEventListeners();
        this.setupControlButtons();

        this.timerManager.start(this.currentInterval);
        this.chartManager.setCurrentInterval(this.currentInterval);

        document.addEventListener('click', this._handleDocumentClick);
        document.addEventListener('click', this._handleGlobalClick);
        document.addEventListener('keydown', this._handleGlobalKeydown);

        if (typeof this.chartManager?._subscribeToSymbolChange === 'function') {
            this._symbolChangeHandler = () => {
                if (this._destroyed) return;
                this.updateInstrumentInfo();
            };
            // TF4: сохраняем то, что вернула подписка. Раньше возвращаемая
            // функция отписки просто выбрасывалась, и destroy() лишь обнулял
            // this._symbolChangeHandler — подписчик навсегда оставался в
            // ChartManager и копился при каждом пересоздании менеджера.
            const unsub = this.chartManager._subscribeToSymbolChange(this._symbolChangeHandler);
            if (typeof unsub === 'function') this._symbolChangeUnsub = unsub;
        }

        try {
            const timeScale = this.chartManager.chart?.timeScale?.();
            if (timeScale?.subscribeVisibleLogicalRangeChange) {
                this._timeScaleUnsubscribe = timeScale.subscribeVisibleLogicalRangeChange(
                    this._handleVisibleRangeChange
                );
            }
        } catch (e) {}
    }

    destroy() {
        this._destroyed = true;

        document.removeEventListener('click', this._handleDocumentClick);
        document.removeEventListener('click', this._handleGlobalClick);
        document.removeEventListener('keydown', this._handleGlobalKeydown);

        for (const { target, type, handler } of this._uiListeners) {
            try { target.removeEventListener(type, handler); } catch (e) {}
        }
        this._uiListeners = [];

        try {
            const timeScale = this.chartManager?.chart?.timeScale?.();
            if (timeScale?.unsubscribeVisibleLogicalRangeChange) {
                timeScale.unsubscribeVisibleLogicalRangeChange(this._handleVisibleRangeChange);
            }
        } catch (e) {}

        if (this._timeScaleUnsubscribe) {
            typeof this._timeScaleUnsubscribe === 'function'
                ? this._timeScaleUnsubscribe()
                : this._timeScaleUnsubscribe?.unsubscribe?.();
            this._timeScaleUnsubscribe = null;
        }

        // TF4: настоящая отписка
        if (this._symbolChangeUnsub) {
            try { this._symbolChangeUnsub(); } catch (e) {}
            this._symbolChangeUnsub = null;
        } else if (this._symbolChangeHandler &&
                   typeof this.chartManager?._unsubscribeFromSymbolChange === 'function') {
            try { this.chartManager._unsubscribeFromSymbolChange(this._symbolChangeHandler); } catch (e) {}
        }
        this._symbolChangeHandler = null;

        // TF3: таймер обратного отсчёта до следующей свечи раньше продолжал тикать
        // после destroy() и трогал уже разобранный график.
        try { this.timerManager?.stop?.(); } catch (e) {}

        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
        if (this._saveTimeout) {
            cancelAnimationFrame(this._saveTimeout);
            this._saveTimeout = null;
        }
        if (this._switchDebounceTimer) {                    // TF1/TF2
            clearTimeout(this._switchDebounceTimer);
            this._switchDebounceTimer = null;
        }
        this._switchQueued = null;
        const waiters = this._switchWaiters;
        this._switchWaiters = [];
        for (const r of waiters) { try { r(); } catch (e) {} }
    }

    _handleVisibleRangeChange() {
        if (this._destroyed) return;
        if (this._saveTimeout) cancelAnimationFrame(this._saveTimeout);
        this._saveTimeout = requestAnimationFrame(() => {
            this._saveTimeout = null;
            if (!this._destroyed) this.saveCurrentPosition();
        });
    }

    saveCurrentPosition() {
        if (this._destroyed) return;

        const timeScale = this.chartManager?.chart?.timeScale?.();
        if (!timeScale?.getVisibleLogicalRange) return;

        let visibleRange = null;
        try {
            visibleRange = timeScale.getVisibleLogicalRange();
        } catch (e) { return; }

        const data = this.chartManager.chartData;

        if (visibleRange && data?.length > 0) {
            const fromIndex = Math.max(0, Math.floor(visibleRange.from));
            const toIndex = Math.min(data.length - 1, Math.ceil(visibleRange.to));

            if (fromIndex < toIndex) {
                const centerIndex = Math.floor((fromIndex + toIndex) / 2);
                // lightweight-charts допускает time как BusinessDay-объект —
                // арифметика с ним дала бы NaN и сломала restorePosition.
                const tFrom = data[fromIndex]?.time;
                const tTo = data[toIndex]?.time;
                if (typeof tFrom !== 'number' || typeof tTo !== 'number') return;

                this.savedCenterTime = data[centerIndex].time;
                this.savedTimeSpan = tTo - tFrom;
                // ИНДЕКСЫ в данных, без учёта пустого правого отступа (rightOffset).
                this.savedVisibleBars = Math.max(0, toIndex - fromIndex + 1);
            }
        }
    }

    restorePosition(force = false) {
        if (this._destroyed) return;
        if (!this.chartManager || !this.chartManager._isChartValid?.()) return;
        if (!this.savedCenterTime || !this.chartManager.chartData?.length) return;

        const data = this.chartManager.chartData;
        const timeScale = this.chartManager.chart?.timeScale?.();
        if (!timeScale) return;

        const firstTime = data[0].time;
        const lastTime = data[data.length - 1].time;
        if (this.savedCenterTime < firstTime || this.savedCenterTime > lastTime) return;

        if (!force) {
            let currentRange = null;
            try { currentRange = timeScale.getVisibleLogicalRange(); } catch (e) {}

            if (currentRange) {
                const lastIndex = data.length - 1;
                if (currentRange.to >= lastIndex - 2) return;
            }
        }

        let left = 0, right = data.length - 1, centerIndex = -1;
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (data[mid].time === this.savedCenterTime) { centerIndex = mid; break; }
            data[mid].time < this.savedCenterTime ? left = mid + 1 : right = mid - 1;
        }

        if (centerIndex === -1) centerIndex = left;
        centerIndex = Math.max(0, Math.min(centerIndex, data.length - 1));

        let from, to;

        if (this.savedVisibleBars > 2) {
            const half = Math.floor(this.savedVisibleBars / 2);
            from = centerIndex - half;
            to = centerIndex + half;
        } else {
            let radius = 40;
            if (this.savedTimeSpan > 0 && data.length > 1) {
                const avg = (data[data.length - 1].time - data[0].time) / (data.length - 1);
                if (avg > 0) {
                    radius = Math.round((this.savedTimeSpan / 2) / avg);
                    radius = Math.max(15, Math.min(radius, 250));
                }
            }
            const padding = Math.max(3, Math.floor(radius * 0.15));
            from = centerIndex - radius - padding;
            to = centerIndex + radius + padding;
        }

        from = Math.max(0, Math.floor(from));
        to = Math.min(data.length - 1, Math.ceil(to));

        if (from < to) {
            try {
                timeScale.setVisibleLogicalRange({ from, to });
            } catch (e) {
                console.warn('⚠️ Ошибка при установке видимого диапазона:', e);
            }
        }
    }

    setupEventListeners() {
        const header = document.getElementById('timeframeHeader');
        if (header) {
            this._addListener(header, 'click', (e) => {
                if (!e.target.classList.contains('tf-star')) {
                    document.getElementById('timeframePanel')?.classList.toggle('expanded');
                }
            });
        }

        document.querySelectorAll('.timeframe-item').forEach(item => {
            this._addListener(item, 'click', (e) => {
                if (e.target.classList.contains('tf-star')) return;
                this.switchToTimeframe(item.dataset.tf);
            });
        });

        const copyBtn = document.getElementById('copyPairButton');
        if (copyBtn) {
            this._addListener(copyBtn, 'click', (e) => { e.stopPropagation(); this.copyToClipboard(); });
        }

        const candleBtn = document.getElementById('candleBtn');
        const barBtn = document.getElementById('barBtn');

        if (candleBtn) {
            this._addListener(candleBtn, 'click', () => {
                candleBtn.classList.add('active');
                barBtn?.classList.remove('active');
                this.chartManager.setChartType('candle');
            });
        }
        if (barBtn) {
            this._addListener(barBtn, 'click', () => {
                barBtn.classList.add('active');
                candleBtn?.classList.remove('active');
                this.chartManager.setChartType('bar');
            });
        }
    }

    setupControlButtons() {
        const scrollBtn = document.getElementById('scrollToLastCandleButton');
        if (scrollBtn) {
            this._addListener(scrollBtn, 'click', (e) => { e.stopPropagation(); this.scrollToLastCandle(); });
        }
        const autoScaleBtn = document.getElementById('autoScaleButton');
        if (autoScaleBtn) {
            this._addListener(autoScaleBtn, 'click', (e) => { e.stopPropagation(); this.autoScaleChart(); });
        }
        // [LOGSCALE] Кнопка «Л» — логарифмическая шкала.
        // Логика переключения живёт в ChartManager.toggleLogScale(),
        // здесь только привязка клика (та же схема, что у кнопки «A»).
        const logScaleBtn = document.getElementById('logScaleButton');
        if (logScaleBtn) {
            this._addListener(logScaleBtn, 'click', (e) => {
                e.stopPropagation();
                if (typeof this.chartManager?.toggleLogScale === 'function') this.chartManager.toggleLogScale();
            });
            if (typeof this.chartManager?._updateLogScaleButton === 'function') this.chartManager._updateLogScaleButton();
        }
    }

    _handleDocumentClick(event) {
        const panel = document.getElementById('timeframePanel');
        if (panel?.classList.contains('expanded') && !panel.contains(event.target)) {
            panel.classList.remove('expanded');
        }
    }

    _handleGlobalClick(event) {
        if (event.target.classList.contains('tf-star')) {
            event.stopPropagation();
            event.target.classList.toggle('starred');
            this.saveStarredTimeframes();
        }
    }

    _handleGlobalKeydown(event) {
        // TF7: 'T' — с зажатым Shift; раньше такой вариант не срабатывал.
        if (!event.altKey || (event.key !== 't' && event.key !== 'T')) return;

        const tag = (event.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || event.target?.isContentEditable) return;

        event.preventDefault();
        if (this._destroyed) return;

        // TF7: повторное нажатие до завершения switchSymbol запускало ВТОРОЙ
        // параллельный переход. Оба вычисляли newType из одного и того же
        // currentMarketType, поэтому оба переключали в одну сторону — второе
        // нажатие не отменяло первое и не давало «вернуться назад».
        if (this._marketSwitchInFlight) {
            console.log('⏳ Alt+T: смена рынка ещё идёт, повторное нажатие проигнорировано');
            return;
        }

        const newType = this.chartManager.currentMarketType === 'futures' ? 'spot' : 'futures';
        this._marketSwitchInFlight = true;

        Promise.resolve(this.chartManager.switchSymbol(
            this.chartManager.currentSymbol,
            this.chartManager.currentExchange,
            newType
        ))
            .catch((e) => console.warn('⚠️ switchSymbol:', e))
            .finally(() => { this._marketSwitchInFlight = false; });
    }

    /**
     * TF1/TF2. Публичная точка входа больше НЕ запускает переключение напрямую,
     * а ставит его в очередь.
     *
     * Почему это нужно: прежний код делал `await chartManager.switchInterval(tf)`
     * без какой-либо сериализации (AbortController создавался, но signal никуда
     * не передавался — это отмечал и комментарий в самом коде). При двух быстрых
     * кликах шли ДВА параллельных переключения, и результат зависел от того,
     * чей await разрешится последним:
     *   • оба успешны → побеждал ПЕРВЫЙ клик, последний терялся;
     *   • первый завершался позже и видел «currentInterval !== tf» → вызывал
     *     _rollbackTimeframe(), который откатывал УЖЕ УСПЕВШЕЕ второе
     *     переключение и уводил WS-подписку на старый интервал.
     * Итог того сценария (замер): badge=15m, WS=15m, localStorage=4h, график=4h.
     *
     * Очередь с коалесцингом даёт два свойства: параллельных switchInterval не
     * бывает вовсе, а при серии быстрых кликов выполняется только последний.
     */
    switchToTimeframe(tf) {
        if (this._destroyed || !this._isValidTimeframe(tf)) return Promise.resolve();
        if (tf === this.currentInterval && !this._switchQueued && !this._switchRunning) return Promise.resolve();

        this._switchQueued = tf;

        // Промис резолвится, когда очередь ДОРАБОТАЕТ. При серии быстрых кликов
        // промежуточные запросы схлопываются в последний; их промисы тоже
        // резолвятся (иначе вызывающий висел бы вечно), но применён будет
        // только последний таймфрейм.
        const promise = new Promise((resolve) => this._switchWaiters.push(resolve));

        if (this._switchRunning) return promise;   // текущая очередь подхватит _switchQueued

        if (this._switchDebounceTimer) clearTimeout(this._switchDebounceTimer);
        this._switchDebounceTimer = setTimeout(() => {
            this._switchDebounceTimer = null;
            this._runSwitchQueue();
        }, this.opts.switchDebounceMs);

        return promise;
    }

    async _runSwitchQueue() {
        if (this._switchRunning) return;
        this._switchRunning = true;
        try {
            while (this._switchQueued && !this._destroyed) {
                const tf = this._switchQueued;
                this._switchQueued = null;
                await this._doSwitch(tf);
            }
        } finally {
            this._switchRunning = false;
            const waiters = this._switchWaiters;
            this._switchWaiters = [];
            for (const r of waiters) { try { r(); } catch (e) {} }
        }
    }

    async _doSwitch(tf) {
        if (this._destroyed) return;
        if (tf === this.currentInterval) return;

        console.log('🔄 Переключение на таймфрейм:', tf);

        this.saveCurrentPosition();

        document.querySelectorAll('.timeframe-item').forEach(i => {
            i.classList.toggle('active', i.dataset.tf === tf);
        });
        document.getElementById('timeframePanel')?.classList.remove('expanded');
        this._updateCurrentTfBadge(tf);

        const previousInterval = this.currentInterval;

        try {
            await this.chartManager.switchInterval(tf);
        } catch (error) {
            console.error('❌ Ошибка при переключении:', error);
            // Откатываемся, только если пользователь уже не запросил другой таймфрейм.
            if (!this._switchQueued && !this._destroyed) this._rollbackTimeframe(previousInterval);
            return;
        }

        if (this._destroyed) return;

        // Пока мы ждали, пользователь мог кликнуть ещё раз — не трогаем UI и не
        // откатываемся, очередь сама обработает следующий запрос.
        if (this._switchQueued) return;

        if (this.chartManager.currentInterval !== tf) {
            console.warn('⚠️ switchInterval не сменил интервал (вероятно, ошибка загрузки)');
            this._rollbackTimeframe(previousInterval);
            return;
        }

        this.currentInterval = this.chartManager.currentInterval;
        this._storageSet('lastTimeframe', this.currentInterval);
        this.chartManager.setCurrentInterval(this.currentInterval);

        this.timerManager?.start?.(this.currentInterval);

        requestAnimationFrame(() => {
            if (this._destroyed) return;
            const price = this.chartManager.currentRealPrice ?? this.chartManager.lastCandle?.close;
            if (price != null) this.timerManager?.updatePrice?.(price);
            try { this.chartManager._applyPriceScaleWidth?.(); } catch (e) { console.error('⚠️ _applyPriceScaleWidth:', e); }
        });

        // TF5: раньше это был один блок без try/catch. Исключение в первом же
        // rayManager обрывало всю цепочку, и trendLine/rulerLine/АЛЕРТЫ/text
        // оставались на старом таймфрейме, хотя график уже перерисован.
        requestAnimationFrame(() => {
            if (this._destroyed) return;
            for (const name of this.opts.syncManagers) {
                try {
                    const mgr = (typeof window !== 'undefined') ? window[name] : null;
                    if (mgr && typeof mgr.syncWithNewTimeframe === 'function') mgr.syncWithNewTimeframe();
                } catch (e) {
                    console.error(`⚠️ ${name}.syncWithNewTimeframe() упал — остальные продолжают работать:`, e);
                }
            }
        });

        // TF6: восстановление вьюпорта — опционально (по умолчанию выключено,
        // чтобы не менять текущее поведение).
        if (this.opts.restoreViewportOnSwitch) this.restorePosition(true);

        console.log('✅ Таймфрейм переключен:', tf);

        this.updateInstrumentInfo();
        this.loadStarredTimeframes();
    }

    _rollbackTimeframe(previousInterval) {
        if (this._destroyed) return;

        this.currentInterval = previousInterval;
        this.chartManager.setCurrentInterval(previousInterval);
        this._updateCurrentTfBadge(previousInterval);

        // Нужно: rollback бывает и ПОСЛЕ того, как switchInterval успел увести
        // WS-подписку на новый интервал.
        if (this.wsManager?.updateSymbolAndTimeframe) {
            this.wsManager.updateSymbolAndTimeframe(
                this.chartManager.currentSymbol, previousInterval,
                this.chartManager.currentExchange,
                this.chartManager.currentMarketType
            );
        }

        document.querySelectorAll('.timeframe-item').forEach(i => {
            i.classList.toggle('active', i.dataset.tf === previousInterval);
        });
    }

    _updateCurrentTfBadge(tf) {
        const badge = document.getElementById('currentTfBadge');
        if (badge) {
            badge.textContent = (typeof TF_LABELS !== 'undefined' ? TF_LABELS[tf] : null) || tf;
        }
    }

    updateInstrumentInfo() {
        const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        set('pairDisplay', this.chartManager.currentSymbol);
        set('contractTypeDisplay', this.chartManager.currentMarketType === 'futures' ? 'PERP' : 'SPOT');
        set('exchangeDisplay', this.chartManager.currentExchange === 'binance' ? 'Binance' : 'Bybit');
        set('currentTfBadge', (typeof TF_LABELS !== 'undefined' ? TF_LABELS[this.currentInterval] : null) || this.currentInterval);
    }

    scrollToLastCandle() { this.chartManager?.scrollToLast(); }
    autoScaleChart() { this.chartManager?.autoScale(); }

    copyToClipboard() {
        const btn = document.getElementById('copyPairButton');
        const text = this.chartManager.currentSymbol;
        if (!text) return;

        const done = () => {
            if (btn) {
                btn.classList.add('copied');
                setTimeout(() => btn.classList.remove('copied'), 1000);
            }
        };

        const legacyCopy = () => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); done(); } catch (e) {}
            document.body.removeChild(ta);
        };

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(text).then(done).catch(legacyCopy);
        } else {
            legacyCopy();
        }
    }

    loadStarredTimeframes() {
        let starred = [];
        try { starred = JSON.parse(this._storageGet('starredTimeframes') || '[]'); } catch (e) { starred = []; }
        if (!Array.isArray(starred)) starred = [];
        document.querySelectorAll('.tf-star').forEach(s => {
            s.classList.toggle('starred', starred.includes(s.dataset.tf));
        });
        this.updateStarredDisplay(starred);
    }

    saveStarredTimeframes() {
        const starred = Array.from(document.querySelectorAll('.tf-star.starred'), s => s.dataset.tf);
        this._storageSet('starredTimeframes', JSON.stringify(starred));
        this.updateStarredDisplay(starred);
    }

    updateStarredDisplay(starred) {
        const container = document.getElementById('starredTimeframes');
        if (!container) return;
        container.innerHTML = '';
        (starred || []).forEach(tf => {
            const label = (typeof TF_LABELS !== 'undefined' ? TF_LABELS[tf] : null) || tf;
            const item = document.createElement('div');
            item.className = 'starred-item' + (tf === this.currentInterval ? ' active' : '');
            item.dataset.tf = tf;
            item.innerHTML = `<span class="tf-name">${label}</span>`;
            item.addEventListener('click', (e) => { e.stopPropagation(); this.switchToTimeframe(tf); });
            container.appendChild(item);
        });
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { TimeframeManager };
if (typeof window !== 'undefined') {
    window.TimeframeManager = TimeframeManager;
}
