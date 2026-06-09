class TimeframeManager {
    constructor(chartManager, wsManager, timerManager) {
        this.chartManager = chartManager;
        this.wsManager = wsManager;
        this.timerManager = timerManager;
        this.currentInterval = localStorage.getItem('lastTimeframe') || CONFIG.defaultInterval;
        console.log('📊 TimeframeManager: таймфрейм =', this.currentInterval);
        
        this.savedCenterTime = null;
        this.savedRangeWidth = null;
        
        this.init();
        
        // Подписываемся на изменение символа из ChartManager
        if (chartManager && chartManager._subscribeToSymbolChange) {
            chartManager._subscribeToSymbolChange(() => {
                this.updateInstrumentInfo();
            });
        }
    }

    init() {
        this.updateInstrumentInfo();
        this.loadStarredTimeframes();
        this.setupEventListeners();
        this.setupControlButtons();
        
        this.timerManager.start(this.currentInterval);
        this.chartManager.setCurrentInterval(this.currentInterval);

        document.addEventListener('click', this.handleDocumentClick.bind(this));
        
        if (this.chartManager && this.chartManager.chart) {
            this.chartManager.chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
                this.saveCurrentPosition();
            });
        }
    }

    saveCurrentPosition() {
        if (!this.chartManager || !this.chartManager.chart || !this.chartManager.chartData.length) return;
        
        const timeScale = this.chartManager.chart.timeScale();
        const visibleRange = timeScale.getVisibleLogicalRange();
        
        if (visibleRange && this.chartManager.chartData.length > 0) {
            const fromIndex = Math.max(0, Math.floor(visibleRange.from));
            const toIndex = Math.min(this.chartManager.chartData.length - 1, Math.ceil(visibleRange.to));
            
            if (fromIndex < toIndex && fromIndex >= 0 && toIndex < this.chartManager.chartData.length) {
                const centerIndex = Math.floor((fromIndex + toIndex) / 2);
                this.savedCenterTime = this.chartManager.chartData[centerIndex].time;
                
                const startTime = this.chartManager.chartData[fromIndex].time;
                const endTime = this.chartManager.chartData[toIndex].time;
                this.savedRangeWidth = Math.abs(endTime - startTime);
            }
        }
    }

    restorePosition() {
        if (!this.savedCenterTime || !this.savedRangeWidth || !this.chartManager.chartData.length) return;
        
        const timeScale = this.chartManager.chart.timeScale();
        
        let closestIndex = 0;
        let minDiff = Infinity;
        
        for (let i = 0; i < this.chartManager.chartData.length; i++) {
            const diff = Math.abs(this.chartManager.chartData[i].time - this.savedCenterTime);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = i;
            }
        }
        
        const halfWidth = this.savedRangeWidth / 2;
        const targetStartTime = this.chartManager.chartData[closestIndex].time - halfWidth;
        const targetEndTime = this.chartManager.chartData[closestIndex].time + halfWidth;
        
        let startIndex = 0;
        let endIndex = this.chartManager.chartData.length - 1;
        
        for (let i = 0; i < this.chartManager.chartData.length; i++) {
            if (this.chartManager.chartData[i].time >= targetStartTime) {
                startIndex = i;
                break;
            }
        }
        
        for (let i = this.chartManager.chartData.length - 1; i >= 0; i--) {
            if (this.chartManager.chartData[i].time <= targetEndTime) {
                endIndex = i;
                break;
            }
        }
        
        if (startIndex < endIndex) {
            timeScale.setVisibleLogicalRange({
                from: startIndex,
                to: endIndex
            });
        }
    }

    handleDocumentClick(event) {
        const panel = document.getElementById('timeframePanel');
        if (panel && panel.classList.contains('expanded') && !panel.contains(event.target)) {
            panel.classList.remove('expanded');
        }
    }

    updateInstrumentInfo() {
        const pairDisplay = document.getElementById('pairDisplay');
        if (pairDisplay && this.chartManager) {
            pairDisplay.textContent = this.chartManager.currentSymbol || 'BTCUSDT';
        }
        
        const contractTypeDisplay = document.getElementById('contractTypeDisplay');
        if (contractTypeDisplay && this.chartManager) {
            const text = this.chartManager.currentMarketType === 'futures' ? 'PERP' : 'SPOT';
            contractTypeDisplay.textContent = text;
        }
        
        const exchangeDisplay = document.getElementById('exchangeDisplay');
        if (exchangeDisplay && this.chartManager) {
            const text = this.chartManager.currentExchange === 'binance' ? 'Binance' : 'Bybit';
            exchangeDisplay.textContent = text;
        }
        
        const currentTfBadge = document.getElementById('currentTfBadge');
        if (currentTfBadge) {
            currentTfBadge.textContent = (TF_LABELS && TF_LABELS[this.currentInterval]) || this.currentInterval;
        }
    }

    setupEventListeners() {
        const header = document.getElementById('timeframeHeader');
        if (header) {
            header.addEventListener('click', (e) => {
                if (!e.target.classList || !e.target.classList.contains('tf-star')) {
                    const panel = document.getElementById('timeframePanel');
                    if (panel) panel.classList.toggle('expanded');
                }
            });
        }

        document.querySelectorAll('.timeframe-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.classList && e.target.classList.contains('tf-star')) return;
                this.switchToTimeframe(item.dataset.tf);
            });
        });

        document.addEventListener('click', (e) => {
            if (e.target.classList && e.target.classList.contains('tf-star')) {
                e.stopPropagation();
                e.target.classList.toggle('starred');
                this.saveStarredTimeframes();
            }
        });

        const copyBtn = document.getElementById('copyPairButton');
        if (copyBtn) {
            const newCopyBtn = copyBtn.cloneNode(true);
            copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
            newCopyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.copyToClipboard();
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 't') {
                e.preventDefault();
                if (this.chartManager) {
                    const newType = this.chartManager.currentMarketType === 'futures' ? 'spot' : 'futures';
                    this.chartManager.currentMarketType = newType;
                    this.updateInstrumentInfo();
                }
            }
        });

        const candleBtn = document.getElementById('candleBtn');
        const barBtn = document.getElementById('barBtn');
        
        if (candleBtn) {
            const newCandleBtn = candleBtn.cloneNode(true);
            candleBtn.parentNode.replaceChild(newCandleBtn, candleBtn);
            newCandleBtn.addEventListener('click', () => {
                newCandleBtn.classList.add('active');
                if (barBtn) barBtn.classList.remove('active');
                if (this.chartManager) this.chartManager.setChartType('candle');
            });
        }
        
        if (barBtn) {
            const newBarBtn = barBtn.cloneNode(true);
            barBtn.parentNode.replaceChild(newBarBtn, barBtn);
            newBarBtn.addEventListener('click', () => {
                newBarBtn.classList.add('active');
                if (candleBtn) candleBtn.classList.remove('active');
                if (this.chartManager) this.chartManager.setChartType('bar');
            });
        }
    }

    setupControlButtons() {
        const scrollBtn = document.getElementById('scrollToLastCandleButton');
        if (scrollBtn) {
            const newScrollBtn = scrollBtn.cloneNode(true);
            scrollBtn.parentNode.replaceChild(newScrollBtn, scrollBtn);
            newScrollBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.scrollToLastCandle();
            });
        }
        
        const autoScaleBtn = document.getElementById('autoScaleButton');
        if (autoScaleBtn) {
            const newAutoScaleBtn = autoScaleBtn.cloneNode(true);
            autoScaleBtn.parentNode.replaceChild(newAutoScaleBtn, autoScaleBtn);
            newAutoScaleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.autoScaleChart();
            });
        }
    }

    scrollToLastCandle() {
        if (this.chartManager) this.chartManager.scrollToLast();
    }

    autoScaleChart() {
        if (this.chartManager) this.chartManager.autoScale();
    }

    copyToClipboard() {
        const button = document.getElementById('copyPairButton');
        const textToCopy = this.chartManager ? this.chartManager.currentSymbol : 'BTCUSDT';
        
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(textToCopy)
                .then(() => {
                    if (button) {
                        button.classList.add('copied');
                        setTimeout(() => button.classList.remove('copied'), 1000);
                    }
                })
                .catch(() => this._fallbackCopy(button, textToCopy));
        } else {
            this._fallbackCopy(button, textToCopy);
        }
    }

    _fallbackCopy(button, text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        
        try {
            document.execCommand('copy');
            if (button) {
                button.classList.add('copied');
                setTimeout(() => button.classList.remove('copied'), 1000);
            }
        } catch (err) {
            console.error('Ошибка копирования:', err);
        }
        
        document.body.removeChild(textarea);
    }

    loadStarredTimeframes() {
        const starred = JSON.parse(localStorage.getItem('starredTimeframes') || '[]');
        
        document.querySelectorAll('.tf-star').forEach(star => {
            if (starred.includes(star.dataset.tf)) {
                star.classList.add('starred');
            } else {
                star.classList.remove('starred');
            }
        });
        
        this.updateStarredDisplay(starred);
    }

    saveStarredTimeframes() {
        const starred = [];
        document.querySelectorAll('.tf-star.starred').forEach(star => {
            starred.push(star.dataset.tf);
        });
        localStorage.setItem('starredTimeframes', JSON.stringify(starred));
        this.updateStarredDisplay(starred);
    }

    updateStarredDisplay(starred) {
        const container = document.getElementById('starredTimeframes');
        if (!container) return;
        
        container.innerHTML = '';
        
        starred.forEach(tf => {
            const label = (TF_LABELS && TF_LABELS[tf]) || tf;
            const item = document.createElement('div');
            item.className = 'starred-item';
            if (tf === this.currentInterval) {
                item.classList.add('active');
            }
            item.dataset.tf = tf;
            item.innerHTML = `<span class="tf-name">${label}</span>`;
            
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.switchToTimeframe(tf);
            });
            
            container.appendChild(item);
        });
    }

    async switchToTimeframe(tf) {
    if (this.currentInterval === tf) return;
    
    console.log('⚡ Переключение на таймфрейм:', tf);
    
    document.querySelectorAll('.timeframe-item').forEach(i => {
        i.classList.toggle('active', i.dataset.tf === tf);
    });
    
    this.currentInterval = tf;
    localStorage.setItem('lastTimeframe', tf);
    
    if (this.chartManager) {
        this.chartManager.setCurrentInterval(tf);
    }
    
    const panel = document.getElementById('timeframePanel');
    if (panel) panel.classList.remove('expanded');
    
    // Сохраняем позицию перед переключением
    this.saveCurrentPosition();
    
    // ✅ БЫСТРО: меняем только таймфрейм, загружаем только свечи
    if (this.chartManager) {
        try {
            const klines = await this.chartManager.fetchKlines(
                this.chartManager.currentSymbol,
                tf,
                1000
            );
            
            if (klines && klines.length > 0) {
                this.chartManager.chartData = klines;
                this.chartManager.updateChart();
                console.log(`✅ Загружено ${klines.length} свечей`);
            }
        } catch (e) {
            console.warn('⚠️ Ошибка загрузки свечей:', e);
        }
    }
    
    // Восстанавливаем позицию
    setTimeout(() => this.restorePosition(), 100);
    
    // Обновляем WebSocket для свечей
    if (this.wsManager && this.chartManager) {
        this.wsManager.updateSymbolAndTimeframe(
            this.chartManager.currentSymbol,
            tf,
            this.chartManager.currentExchange,
            this.chartManager.currentMarketType
        );
    }
    
    // Запускаем таймер
    if (this.timerManager) {
        this.timerManager.start(tf);
    }
    
    // Обновляем UI
    this.updateInstrumentInfo();
    this.loadStarredTimeframes();
    
    // Автомасштаб
    setTimeout(() => {
        if (this.chartManager) this.chartManager.autoScale();
    }, 300);
    
    // Синхронизируем рисунки
    setTimeout(() => {
        if (window.rayManager) window.rayManager?.syncWithNewTimeframe();
        if (window.trendLineManager) window.trendLineManager?.syncWithNewTimeframe();
        if (window.rulerLineManager) window.rulerLineManager?.syncWithNewTimeframe();
        if (window.alertLineManager) window.alertLineManager?.syncWithNewTimeframe();
        if (window.textManager) window.textManager?.syncWithNewTimeframe();
    }, 200);
}
    // Публичный метод для внешнего обновления (из WatchlistManager)
    updateFromChartManager() {
        if (!this.chartManager) return;
        
        this.updateInstrumentInfo();
        this.currentInterval = this.chartManager.currentInterval || this.currentInterval;
        
        // Обновляем активный класс в списке таймфреймов
        document.querySelectorAll('.timeframe-item').forEach(item => {
            item.classList.toggle('active', item.dataset.tf === this.currentInterval);
        });
        
        const currentTfBadge = document.getElementById('currentTfBadge');
        if (currentTfBadge) {
            currentTfBadge.textContent = (TF_LABELS && TF_LABELS[this.currentInterval]) || this.currentInterval;
        }
    }
}

if (typeof window !== 'undefined') {
    window.TimeframeManager = TimeframeManager;
}
