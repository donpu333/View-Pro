class TimeframeManager {
    constructor(chartManager, wsManager, timerManager) {
        this.chartManager = chartManager;
        this.wsManager = wsManager;
        this.timerManager = timerManager;
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
        const saved = localStorage.getItem('lastTimeframe');
        const defaultInterval = (typeof CONFIG !== 'undefined' && CONFIG.defaultInterval) ? CONFIG.defaultInterval : '15m';
        return (saved && (typeof TF_LABELS === 'undefined' || TF_LABELS[saved])) ? saved : defaultInterval;
    }

    _isValidTimeframe(tf) {
        return Boolean(tf && (typeof TF_LABELS === 'undefined' || TF_LABELS[tf]));
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
            this.chartManager._subscribeToSymbolChange(this._symbolChangeHandler);
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

        this._symbolChangeHandler = null;

        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }

        if (this._saveTimeout) {
            cancelAnimationFrame(this._saveTimeout);
            this._saveTimeout = null;
        }
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
                this.savedCenterTime = data[centerIndex].time;
                this.savedTimeSpan = data[toIndex].time - data[fromIndex].time;
                // Используем ИНДЕКСЫ в данных — без учёта пустого правого отступа.
                // Раньше в savedVisibleBars попадал и rightOffset, из-за чего при
                // восстановлении показывалось на ~25 свечей меньше.
                this.savedVisibleBars = Math.max(0, toIndex - fromIndex + 1);
            }
        }
    }

    // Метод оставлен как публичный API для ручного вызова. Автоматически
    // больше не используется — см. switchToTimeframe.
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
            if (data[mid].time === this.savedCenterTime) {
                centerIndex = mid;
                break;
            }
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
            this._addListener(copyBtn, 'click', (e) => {
                e.stopPropagation();
                this.copyToClipboard();
            });
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
            this._addListener(scrollBtn, 'click', (e) => {
                e.stopPropagation();
                this.scrollToLastCandle();
            });
        }

        const autoScaleBtn = document.getElementById('autoScaleButton');
        if (autoScaleBtn) {
            this._addListener(autoScaleBtn, 'click', (e) => {
                e.stopPropagation();
                this.autoScaleChart();
            });
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
        if (!event.altKey || event.key !== 't') return;

        // Не перехватываем хоткей, если пользователь печатает в поле ввода.
        const tag = (event.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || event.target?.isContentEditable) return;

        event.preventDefault();
        if (this._destroyed) return;

        const newType = this.chartManager.currentMarketType === 'futures' ? 'spot' : 'futures';

        // switchSymbol асинхронный; поля currentMarketType/currentSymbol меняются
        // внутри процесса. UI обновится через _subscribeToSymbolChange
        // (см. init) — когда ChartManager реально завершит смену.
        // Синхронный updateInstrumentInfo() удалён: он читал старое значение
        // и давал мигание устаревшим PERP/SPOT.
        Promise.resolve(this.chartManager.switchSymbol(
            this.chartManager.currentSymbol,
            this.chartManager.currentExchange,
            newType
        )).catch(() => {});
    }

    async switchToTimeframe(tf) {
        if (this._destroyed) return;
        if (!this._isValidTimeframe(tf) || tf === this.currentInterval) return;

        // AbortController оставлен для обратной совместимости с внешним API,
        // но реальной отмены не делает: switchInterval всё равно доработает.
        if (this._abortController) this._abortController.abort();
        this._abortController = new AbortController();
        const { signal } = this._abortController;

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
            // На случай, если ChartManager когда-нибудь начнёт пробрасывать
            // ошибки наружу (сейчас — нет, он их глотает внутри себя).
            if (error?.name !== 'AbortError') {
                console.error('❌ Ошибка при переключении:', error);
                this._rollbackTimeframe(previousInterval);
            }
            if (this._abortController?.signal === signal) this._abortController = null;
            return;
        }

        if (this._destroyed) {
            if (this._abortController?.signal === signal) this._abortController = null;
            return;
        }

        // switchInterval у ChartManager глотает ошибки — определяем неудачу
        // по факту: currentInterval не сменился. Иначе UI показывал бы новый
        // ТФ, а на графике были бы старые данные.
        if (this.chartManager.currentInterval !== tf) {
            console.warn('⚠️ switchInterval не сменил интервал (вероятно, ошибка загрузки)');
            this._rollbackTimeframe(previousInterval);
            if (this._abortController?.signal === signal) this._abortController = null;
            return;
        }

        // Синхронизируем локальное состояние из ChartManager — он источник
        // истины. Независимо от signal.aborted: switchInterval уже отработал,
        // и chartManager.currentInterval теперь равен tf. Раньше при aborted
        // мы выходили, оставив this.currentInterval устаревшим.
        this.currentInterval = this.chartManager.currentInterval;
        localStorage.setItem('lastTimeframe', this.currentInterval);
        this.chartManager.setCurrentInterval(this.currentInterval);

        // wsManager.updateSymbolAndTimeframe здесь УДАЛЁН: его уже вызвал
        // ChartManager.switchInterval. Повторный вызов давал двойной реконнект
        // WS на каждое переключение ТФ (в логах — два 🔌 KLINE подряд).

        this.timerManager.start(this.currentInterval);

        requestAnimationFrame(() => {
            if (this._destroyed) return;
            if (this.timerManager) {
                const price = this.chartManager.currentRealPrice
                    ?? this.chartManager.lastCandle?.close;
                if (price != null) this.timerManager.updatePrice(price);
            }
            if (this.chartManager._applyPriceScaleWidth) {
                this.chartManager._applyPriceScaleWidth();
            }
        });

        this.chartManager.autoScale();

        // Восстановление позиции истории после смены ТФ не выполняется:
        // ChartManager всегда позиционирует вьюпорт у правого края под
        // затемняющей подложкой. restorePosition() оставлен как публичный
        // API для внешнего вызова.

        requestAnimationFrame(() => {
            if (this._destroyed) return;
            window.rayManager?.syncWithNewTimeframe();
            window.trendLineManager?.syncWithNewTimeframe();
            window.rulerLineManager?.syncWithNewTimeframe();
            window.alertLineManager?.syncWithNewTimeframe();
            window.textManager?.syncWithNewTimeframe();
        });

        console.log('✅ Таймфрейм переключен:', tf);

        if (this._abortController?.signal === signal) {
            this._abortController = null;
        }

        this.updateInstrumentInfo();
        this.loadStarredTimeframes();
    }

    _rollbackTimeframe(previousInterval) {
        if (this._destroyed) return;

        this.currentInterval = previousInterval;
        this.chartManager.setCurrentInterval(previousInterval);
        this._updateCurrentTfBadge(previousInterval);

        // Оставлено: rollback бывает и ПОСЛЕ того, как switchInterval успел
        // увести WS-подписку на новый интервал (ветка «currentInterval !== tf»).
        // В этом случае нужно вернуть WS обратно.
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
            const label = (typeof TF_LABELS !== 'undefined' ? TF_LABELS[tf] : null) || tf;
            badge.textContent = label;
        }
    }

    updateInstrumentInfo() {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
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
        const starred = JSON.parse(localStorage.getItem('starredTimeframes') || '[]');
        document.querySelectorAll('.tf-star').forEach(s => {
            s.classList.toggle('starred', starred.includes(s.dataset.tf));
        });
        this.updateStarredDisplay(starred);
    }

    saveStarredTimeframes() {
        const starred = Array.from(document.querySelectorAll('.tf-star.starred'), s => s.dataset.tf);
        localStorage.setItem('starredTimeframes', JSON.stringify(starred));
        this.updateStarredDisplay(starred);
    }

    updateStarredDisplay(starred) {
        const container = document.getElementById('starredTimeframes');
        if (!container) return;
        container.innerHTML = '';
        starred.forEach(tf => {
            const label = (typeof TF_LABELS !== 'undefined' ? TF_LABELS[tf] : null) || tf;
            const item = document.createElement('div');
            item.className = 'starred-item' + (tf === this.currentInterval ? ' active' : '');
            item.dataset.tf = tf;
            item.innerHTML = `<span class="tf-name">${label}</span>`;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.switchToTimeframe(tf);
            });
            container.appendChild(item);
        });
    }
}

if (typeof window !== 'undefined') {
    window.TimeframeManager = TimeframeManager;
}
