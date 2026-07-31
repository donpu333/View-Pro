class TimeframeManager {
    constructor(chartManager, wsManager, timerManager) {
        this.chartManager = chartManager;
        this.wsManager = wsManager;
        this.timerManager = timerManager;
        this.currentInterval = this._getInitialInterval();
        console.log('📊 TimeframeManager: таймфрейм =', this.currentInterval);
        
        this.savedCenterTime = null;
        this.savedTimeSpan = null;
        this._timeScaleUnsubscribe = null;
        this._abortController = null; // для отмены предыдущей загрузки

        this._handleDocumentClick = this._handleDocumentClick.bind(this);
        this._handleGlobalClick = this._handleGlobalClick.bind(this);
        this._handleGlobalKeydown = this._handleGlobalKeydown.bind(this);
        this._handleVisibleRangeChange = this._handleVisibleRangeChange.bind(this);
        
        this.init();
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

        try {
            const timeScale = this.chartManager.chart.timeScale();
            if (timeScale?.subscribeVisibleLogicalRangeChange) {
                this._timeScaleUnsubscribe = timeScale.subscribeVisibleLogicalRangeChange(
                    this._handleVisibleRangeChange
                );
            }
        } catch (e) {}
    }

    destroy() {
        document.removeEventListener('click', this._handleDocumentClick);
        document.removeEventListener('click', this._handleGlobalClick);
        document.removeEventListener('keydown', this._handleGlobalKeydown);
        
        if (this._timeScaleUnsubscribe) {
            typeof this._timeScaleUnsubscribe === 'function' 
                ? this._timeScaleUnsubscribe() 
                : this._timeScaleUnsubscribe?.unsubscribe?.();
        }

        if (this._abortController) {
            this._abortController.abort();
        }
    }

    // ==================== ПОЗИЦИЯ (как у вас) ====================
    _handleVisibleRangeChange() {
        if (this._saveTimeout) cancelAnimationFrame(this._saveTimeout);
        this._saveTimeout = requestAnimationFrame(() => this.saveCurrentPosition());
    }

    saveCurrentPosition() {
        const timeScale = this.chartManager.chart.timeScale();
        const visibleRange = timeScale.getVisibleLogicalRange();
        const data = this.chartManager.chartData;
        
        if (visibleRange && data?.length > 0) {
            const fromIndex = Math.max(0, Math.floor(visibleRange.from));
            const toIndex = Math.min(data.length - 1, Math.ceil(visibleRange.to));
            
            if (fromIndex < toIndex) {
                const centerIndex = Math.floor((fromIndex + toIndex) / 2);
                this.savedCenterTime = data[centerIndex].time;
                this.savedTimeSpan = data[toIndex].time - data[fromIndex].time;
            }
        }
    }

    restorePosition() {
        if (!this.savedCenterTime || !this.chartManager.chartData?.length) {
            this.chartManager.chart.timeScale().scrollToRealTime();
            return;
        }
        
        const data = this.chartManager.chartData;
        const timeScale = this.chartManager.chart.timeScale();
        const latestTime = data[data.length - 1].time;
        
        if (latestTime <= this.savedCenterTime + (this.savedTimeSpan || 0)) {
            timeScale.scrollToRealTime();
            return;
        }

        let left = 0, right = data.length - 1, centerIndex = -1;
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (data[mid].time === this.savedCenterTime) { centerIndex = mid; break; }
            data[mid].time < this.savedCenterTime ? left = mid + 1 : right = mid - 1;
        }
        if (centerIndex === -1) centerIndex = left;
        centerIndex = Math.max(0, Math.min(centerIndex, data.length - 1));

        let radius = 40;
        if (this.savedTimeSpan > 0 && data.length > 1) {
            const avg = (data[data.length - 1].time - data[0].time) / (data.length - 1);
            if (avg > 0) {
                radius = Math.round((this.savedTimeSpan / 2) / avg);
                radius = Math.max(15, Math.min(radius, 250));
            }
        }
        
        const padding = Math.max(3, Math.floor(radius * 0.15));
        let from = Math.max(0, centerIndex - radius - padding);
        let to = Math.min(data.length - 1, centerIndex + radius + padding);
        
        if (to - from < radius * 1.5) from = Math.max(0, to - radius * 1.5);

        from < to ? timeScale.setVisibleLogicalRange({ from, to }) : timeScale.scrollToRealTime();
    }

    // ==================== ОРИГИНАЛЬНЫЕ ОБРАБОТЧИКИ ====================
    setupEventListeners() {
        const header = document.getElementById('timeframeHeader');
        if (header) {
            header.addEventListener('click', (e) => {
                if (!e.target.classList.contains('tf-star')) {
                    document.getElementById('timeframePanel')?.classList.toggle('expanded');
                }
            });
        }

        document.querySelectorAll('.timeframe-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('tf-star')) return;
                this.switchToTimeframe(item.dataset.tf);
            });
        });

        const copyBtn = document.getElementById('copyPairButton');
        if (copyBtn) {
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.copyToClipboard();
            });
        }

        const candleBtn = document.getElementById('candleBtn');
        const barBtn = document.getElementById('barBtn');
        candleBtn?.addEventListener('click', () => {
            candleBtn.classList.add('active');
            barBtn?.classList.remove('active');
            this.chartManager.setChartType('candle');
        });
        barBtn?.addEventListener('click', () => {
            barBtn.classList.add('active');
            candleBtn?.classList.remove('active');
            this.chartManager.setChartType('bar');
        });
    }

    setupControlButtons() {
        document.getElementById('scrollToLastCandleButton')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.scrollToLastCandle();
        });
        document.getElementById('autoScaleButton')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.autoScaleChart();
        });
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
        if (event.altKey && event.key === 't') {
            event.preventDefault();
            const newType = this.chartManager.currentMarketType === 'futures' ? 'spot' : 'futures';
            this.chartManager.switchSymbol(
                this.chartManager.currentSymbol, this.chartManager.currentExchange, newType
            );
            this.updateInstrumentInfo();
        }
    }

    // ==================== ПЕРЕКЛЮЧЕНИЕ (с отменой) ====================
 async switchToTimeframe(tf) {
    if (!this._isValidTimeframe(tf) || tf === this.currentInterval) return;

    // Отменяем предыдущий запрос
    if (this.chartManager._currentFetchController) {
        this.chartManager._currentFetchController.abort();
    }

    console.log('🔄 Переключение на таймфрейм:', tf);
    
    document.querySelectorAll('.timeframe-item').forEach(i => {
        i.classList.toggle('active', i.dataset.tf === tf);
    });

    const previousInterval = this.currentInterval;
    this.currentInterval = tf;
    localStorage.setItem('lastTimeframe', tf);
    this.chartManager.setCurrentInterval(tf);
    
    document.getElementById('timeframePanel')?.classList.remove('expanded');

    try {
        if (this.wsManager) this.wsManager.disconnect?.();

        // ✅ Вот тут правильно — chartManager.fetchKlines
        const candles = await this.chartManager.fetchKlines(
            this.chartManager.currentSymbol,
            this.chartManager.currentExchange,
            this.chartManager.currentMarketType,
            tf,
            1000
        );

        if (this.currentInterval !== tf) {
            console.log('⏭️ Таймфрейм уже другой, пропускаем');
            return;
        }

        if (candles?.length > 0) {
            this.chartManager.setDataQuick(
                candles, tf,
                this.chartManager.currentSymbol,
                this.chartManager.currentExchange,
                this.chartManager.currentMarketType
            );
        }

        this.wsManager?.updateSymbolAndTimeframe(
            this.chartManager.currentSymbol, tf,
            this.chartManager.currentExchange,
            this.chartManager.currentMarketType
        );

        this.timerManager.start(tf);
        this.chartManager.autoScale();
        this.restorePosition();

        window.rayManager?.syncWithNewTimeframe();
        window.trendLineManager?.syncWithNewTimeframe();
        window.rulerLineManager?.syncWithNewTimeframe();
        window.alertLineManager?.syncWithNewTimeframe();
        window.textManager?.syncWithNewTimeframe();

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('🛑 Переключение отменено');
            return;
        }
        console.error('❌ Ошибка при переключении:', error);
        
        this.currentInterval = previousInterval;
        this.chartManager.setCurrentInterval(previousInterval);
        this.wsManager?.updateSymbolAndTimeframe(
            this.chartManager.currentSymbol, previousInterval,
            this.chartManager.currentExchange,
            this.chartManager.currentMarketType
        );
    }
    
    this.updateInstrumentInfo();
    this.loadStarredTimeframes();
}
    // ==================== UI ====================
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

        navigator.clipboard?.writeText(text).then(done).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); done(); } catch (e) {}
            document.body.removeChild(ta);
        });
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
