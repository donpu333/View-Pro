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
        if (!this.savedCenterTime || !this.chartManager.chartData?.length) {
            this.chartManager.scrollToLast();
            return;
        }
        
        const data = this.chartManager.chartData;
        const timeScale = this.chartManager.chart.timeScale();
        const latestTime = data[data.length - 1].time;
        
        if (latestTime <= this.savedCenterTime + (this.savedTimeSpan || 0)) {
            this.chartManager.scrollToLast();
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

        from < to ? timeScale.setVisibleLogicalRange({ from, to }) : this.chartManager.scrollToLast();
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
        // ==================== ПЕРЕКЛЮЧЕНИЕ (ОПТИМИЗИРОВАНО) ====================
    async switchToTimeframe(tf) {
        // 1. Валидация
        if (!this._isValidTimeframe(tf) || tf === this.currentInterval) return;

        // 2. Отменяем предыдущее переключение
        if (this._abortController) {
            this._abortController.abort();
            console.log('🛑 Предыдущее переключение таймфрейма отменено');
        }

        // 3. Прерываем текущий запрос в ChartManager
        if (this.chartManager._currentFetchController) {
            this.chartManager._currentFetchController.abort();
        }

        this._abortController = new AbortController();
        const { signal } = this._abortController;

        console.log('🔄 Переключение на таймфрейм:', tf);

        // 4. Сохраняем позицию ДО переключения
        this.saveCurrentPosition();

        // 5. UI обновляем СРАЗУ
        document.querySelectorAll('.timeframe-item').forEach(i => {
            i.classList.toggle('active', i.dataset.tf === tf);
        });
        document.getElementById('timeframePanel')?.classList.remove('expanded');
        this._updateCurrentTfBadge(tf);

        const previousInterval = this.currentInterval;
        const cm = this.chartManager;

        try {
            // ✅ ГЛАВНЫЙ ФИКС: ПЫТАЕМСЯ ВЗЯТЬ ДАННЫЕ ИЗ КЭША (ЭТО ЗАНИМАЕТ 1-2 МИЛЛИСЕКУНДЫ)
            let candles = await cm.loadCandlesFromCache(
                cm.currentSymbol,
                cm.currentExchange,
                cm.currentMarketType,
                tf
            );
            let isFromCache = !!candles;

            // Если кэша нет, тянем с биржи (с запросом на сервер)
            if (!isFromCache) {
                candles = await cm.fetchKlines(
                    cm.currentSymbol,
                    cm.currentExchange,
                    cm.currentMarketType,
                    tf,
                    1000,
                    null,
                    'user'
                );
            }

            if (signal.aborted) return;

            // Если данные пустые — откатываемся
            if (!candles || candles.length === 0) {
                console.warn('⚠️ Пустые данные для', tf, '— откат на', previousInterval);
                this._rollbackTimeframe(previousInterval);
                return;
            }

            if (signal.aborted) return;

            // 6. Применяем новые данные (график рисуется мгновенно, если из кэша)
            this.currentInterval = tf;
            localStorage.setItem('lastTimeframe', tf);
            cm.setCurrentInterval(tf);

            cm.setDataQuick(
                candles, tf,
                cm.currentSymbol,
                cm.currentExchange,
                cm.currentMarketType
            );

            // 7. Обновляем WebSocket и Таймер
            if (this.wsManager?.updateSymbolAndTimeframe) {
                this.wsManager.updateSymbolAndTimeframe(
                    cm.currentSymbol, tf,
                    cm.currentExchange,
                    cm.currentMarketType
                );
            }

            this.timerManager.start(tf);
            
            requestAnimationFrame(() => {
                if (this.timerManager) {
                    const price = cm.currentRealPrice ?? cm.lastCandle?.close;
                    if (price != null) {
                        this.timerManager.updatePosition(price);
                    }
                    if (cm._applyPriceScaleWidth) {
                        cm._applyPriceScaleWidth();
                    }
                }
            });
            
            cm.autoScale();
            this.restorePosition();

            // 8. Синхронизация рисовалок
            requestAnimationFrame(() => {
                window.rayManager?.syncWithNewTimeframe();
                window.trendLineManager?.syncWithNewTimeframe();
                window.rulerLineManager?.syncWithNewTimeframe();
                window.alertLineManager?.syncWithNewTimeframe();
                window.textManager?.syncWithNewTimeframe();
            });

            console.log(`✅ Таймфрейм ${tf} загружен (Из кэша: ${isFromCache})`);

            // ✅ ФОНОВОЕ ОБНОВЛЕНИЕ
            // Если мы взяли данные из кэша, мы должны обновить их с биржи (тихо, без блокировки)
            if (isFromCache) {
                cm.refreshCandlesInBackground(
                    cm.currentSymbol, cm.currentExchange, cm.currentMarketType, tf
                ).catch(() => {});
            } else {
                // Если скачали с биржи впервые — сохраняем в кэш на будущее
                cm.saveCandlesToCache(
                    cm.currentSymbol, cm.currentExchange, cm.currentMarketType, tf, candles
                ).catch(() => {});
            }

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
