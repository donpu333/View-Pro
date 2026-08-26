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
        this._abortController = null;
        this._saveTimeout = null;

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
            this._abortController = null;
        }
        
        if (this._saveTimeout) {
            cancelAnimationFrame(this._saveTimeout);
            this._saveTimeout = null;
        }
    }

    // ==================== ПОЗИЦИЯ ====================
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
    // 1. Базовые проверки
    if (!this.chartManager || !this.chartManager._isChartValid()) return;
    if (!this.savedCenterTime || !this.chartManager.chartData?.length) {
        return;
    }
    
    const data = this.chartManager.chartData;
    const timeScale = this.chartManager.chart.timeScale();
    
    // ✅ ИСПРАВЛЕНИЕ: НЕ перезаписываем позицию, если это новый символ/интервал
    // Проверяем, не находится ли график в начале (только что загружен)
    const currentRange = timeScale.getVisibleLogicalRange();
    if (currentRange) {
        const lastIndex = data.length - 1;
        // Если видна последняя свеча - значит график только что загружен
        if (currentRange.to >= lastIndex - 2) {
            // Не восстанавливаем позицию, оставляем как есть
            return;
        }
    }
    
    // 2. Приоритет: используем нативное сохранение из ChartManager
    if (this.chartManager._savedWasViewingHistory && this.chartManager._savedLogicalRange) {
        try {
            timeScale.setVisibleLogicalRange(this.chartManager._savedLogicalRange);
            return;
        } catch (e) {
            console.warn('⚠️ Не удалось восстановить логический диапазон, используем расчетный');
        }
    }

    // 3. Расчетный метод (резервный)
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
    
    if (to - from < radius * 1.5) {
        from = Math.max(0, to - radius * 1.5);
    }

    // 4. ✅ БЕЗОПАСНОЕ ПРИМЕНЕНИЕ (без scrollToLast!)
    if (from < to) {
        try {
            timeScale.setVisibleLogicalRange({ from, to });
        } catch (e) {
            console.warn('⚠️ Ошибка при установке видимого диапазона:', e);
        }
    }
    // ❌ УДАЛЕНО: this.chartManager.scrollToLast();
}

    // ==================== ОБРАБОТЧИКИ ====================
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

    // ==================== ПЕРЕКЛЮЧЕНИЕ (ИСПРАВЛЕНО) ====================
  async switchToTimeframe(tf) {
    // 1. Валидация
    if (!this._isValidTimeframe(tf) || tf === this.currentInterval) return;

    // 2. Отменяем предыдущее переключение
    if (this._abortController) {
        this._abortController.abort();
        console.log('🛑 Предыдущее переключение таймфрейма отменено');
    }

    this._abortController = new AbortController();
    const { signal } = this._abortController;

    console.log('🔄 Переключение на таймфрейм:', tf);

    // 3. Сохраняем позицию ДО переключения
    this.saveCurrentPosition();

    // 4. UI обновляем СРАЗУ
    document.querySelectorAll('.timeframe-item').forEach(i => {
        i.classList.toggle('active', i.dataset.tf === tf);
    });
    document.getElementById('timeframePanel')?.classList.remove('expanded');
    this._updateCurrentTfBadge(tf);

    const previousInterval = this.currentInterval;

    try {
        // 5. Переключаем интервал через ChartManager
        await this.chartManager.switchInterval(tf);

        if (signal.aborted) {
            console.log('🛑 Переключение отменено после switchInterval');
            return;
        }

        // 6. Обновляем состояние
        this.currentInterval = tf;
        localStorage.setItem('lastTimeframe', tf);
        this.chartManager.setCurrentInterval(tf);

        // 7. Обновляем WebSocket
        if (this.wsManager?.updateSymbolAndTimeframe) {
            this.wsManager.updateSymbolAndTimeframe(
                this.chartManager.currentSymbol, tf,
                this.chartManager.currentExchange,
                this.chartManager.currentMarketType
            );
        }

        // 8. Таймер
        this.timerManager.start(tf);
        
        requestAnimationFrame(() => {
            if (this.timerManager) {
                const price = this.chartManager.currentRealPrice 
                    ?? this.chartManager.lastCandle?.close;
                if (price != null) {
                    this.timerManager.updatePrice(price);
                }
                if (this.chartManager._applyPriceScaleWidth) {
                    this.chartManager._applyPriceScaleWidth();
                }
            }
        });
        
        // 9. ✅ ИСПРАВЛЕНИЕ: Автоскейл, НО НЕ восстанавливаем позицию!
        this.chartManager.autoScale();
        // ❌ УДАЛЕНО: this.restorePosition();  // ← Это перезаписывает позицию!
        
        // ✅ Восстанавливаем ТОЛЬКО если пользователь был в истории
        if (this.chartManager._savedWasViewingHistory) {
            this.restorePosition();
        }

        // 10. Синхронизация рисовалок
        requestAnimationFrame(() => {
            window.rayManager?.syncWithNewTimeframe();
            window.trendLineManager?.syncWithNewTimeframe();
            window.rulerLineManager?.syncWithNewTimeframe();
            window.alertLineManager?.syncWithNewTimeframe();
            window.textManager?.syncWithNewTimeframe();
        });

        console.log('✅ Таймфрейм переключен:', tf);

    } catch (error) {
        if (error.name === 'AbortError' || signal?.aborted) {
            console.log('🛑 Переключение отменено (AbortError)');
            return;
        }
        console.error('❌ Ошибка при переключении:', error);
        this._rollbackTimeframe(previousInterval);
    } finally {
        if (this._abortController?.signal === signal) {
            this._abortController = null;
        }
        this.updateInstrumentInfo();
        this.loadStarredTimeframes();
    }
}

    // ==================== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ====================
    _rollbackTimeframe(previousInterval) {
        this.currentInterval = previousInterval;
        this.chartManager.setCurrentInterval(previousInterval);
        this._updateCurrentTfBadge(previousInterval);
        
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
