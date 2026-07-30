class TimeframeManager {
    constructor(chartManager, wsManager, timerManager) {
        this.chartManager = chartManager;
        this.wsManager = wsManager;
        this.timerManager = timerManager;
        this.currentInterval = localStorage.getItem('lastTimeframe') || (typeof CONFIG !== 'undefined' ? CONFIG.defaultInterval : '15m');
        console.log('📊 TimeframeManager: таймфрейм =', this.currentInterval);
        
        this.currentExchange = 'Binance';
        this.currentContractType = 'PERP';
        
        this.savedCenterTime = null;
        this.savedRangeWidth = null;

        // Привязываем методы один раз для корректного удаления слушателей
        this.handleDocumentClickBound = this.handleDocumentClick.bind(this);
        this.handleGlobalClickBound = this.handleGlobalClick.bind(this);
        this.handleGlobalKeydownBound = this.handleGlobalKeydown.bind(this);
        
        this.init();
    }

    init() {
        this.updateInstrumentInfo();
        this.loadStarredTimeframes();
        this.setupEventListeners();
        this.setupControlButtons();
        
        this.timerManager.start(this.currentInterval);
        this.chartManager.setCurrentInterval(this.currentInterval);

        document.addEventListener('click', this.handleDocumentClickBound);
        document.addEventListener('click', this.handleGlobalClickBound);
        document.addEventListener('keydown', this.handleGlobalKeydownBound);
        
        this.chartManager.chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
            this.saveCurrentPosition();
        });
    }

    // Очистка слушателей (полезно при уничтожении компонента)
    destroy() {
        document.removeEventListener('click', this.handleDocumentClickBound);
        document.removeEventListener('click', this.handleGlobalClickBound);
        document.removeEventListener('keydown', this.handleGlobalKeydownBound);
        this.chartManager.chart.timeScale().unsubscribeVisibleLogicalRangeChange();
    }

    saveCurrentPosition() {
        const timeScale = this.chartManager.chart.timeScale();
        const visibleRange = timeScale.getVisibleLogicalRange();
        
        if (visibleRange && this.chartManager.chartData && this.chartManager.chartData.length > 0) {
            const fromIndex = Math.max(0, Math.floor(visibleRange.from));
            const toIndex = Math.min(this.chartManager.chartData.length - 1, Math.ceil(visibleRange.to));
            
            if (fromIndex < toIndex && fromIndex >= 0 && toIndex < this.chartManager.chartData.length) {
                const centerIndex = Math.floor((fromIndex + toIndex) / 2);
                this.savedCenterTime = this.chartManager.chartData[centerIndex].time;
                
                const startTime = this.chartManager.chartData[fromIndex].time;
                const endTime = this.chartManager.chartData[toIndex].time;
                
                // Убедимся, что время — это число (UNIX timestamp), а не объект BusinessDay
                if (typeof startTime === 'number' && typeof endTime === 'number') {
                    this.savedRangeWidth = Math.abs(endTime - startTime);
                }
            }
        }
    }

    restorePosition() {
        if (!this.savedCenterTime || !this.savedRangeWidth || !this.chartManager.chartData || this.chartManager.chartData.length === 0) return;
        
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
            timeScale.setVisibleLogicalRange({ from: startIndex, to: endIndex });
        }
    }

    handleDocumentClick(event) {
        const panel = document.getElementById('timeframePanel');
        if (panel && panel.classList.contains('expanded') && !panel.contains(event.target)) {
            panel.classList.remove('expanded');
        }
    }

    // Вынесено в отдельный метод для возможности удаления слушателя
    handleGlobalClick(event) {
        if (event.target.classList.contains('tf-star')) {
            event.stopPropagation();
            event.target.classList.toggle('starred');
            this.saveStarredTimeframes();
        }
    }

    // Вынесено в отдельный метод для возможности удаления слушателя
    handleGlobalKeydown(event) {
        if (event.ctrlKey && event.key === 't') {
            event.preventDefault();
            this.currentContractType = this.currentContractType === 'PERP' ? 'SPOT' : 'PERP';
            this.updateInstrumentInfo();
        }
    }

    updateInstrumentInfo() {
        const pairDisplay = document.getElementById('pairDisplay');
        if (pairDisplay) pairDisplay.textContent = this.chartManager.currentSymbol;
        
        const contractTypeDisplay = document.getElementById('contractTypeDisplay');
        if (contractTypeDisplay) {
            contractTypeDisplay.textContent = this.chartManager.currentMarketType === 'futures' ? 'PERP' : 'SPOT';
        }
        
        const exchangeDisplay = document.getElementById('exchangeDisplay');
        if (exchangeDisplay) {
            exchangeDisplay.textContent = this.chartManager.currentExchange === 'binance' ? 'Binance' : 'Bybit';
        }
        
        const currentTfBadge = document.getElementById('currentTfBadge');
        if (currentTfBadge) {
            currentTfBadge.textContent = (typeof TF_LABELS !== 'undefined' ? TF_LABELS[this.currentInterval] : null) || this.currentInterval;
        }
    }

    setupEventListeners() {
        const header = document.getElementById('timeframeHeader');
        if (header) {
            header.addEventListener('click', (e) => {
                if (!e.target.classList.contains('tf-star')) {
                    const panel = document.getElementById('timeframePanel');
                    if (panel) panel.classList.toggle('expanded');
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
        
        if (candleBtn) {
            candleBtn.addEventListener('click', () => {
                candleBtn.classList.add('active');
                if (barBtn) barBtn.classList.remove('active');
                this.chartManager.setChartType('candle');
            });
        }
        
        if (barBtn) {
            barBtn.addEventListener('click', () => {
                barBtn.classList.add('active');
                if (candleBtn) candleBtn.classList.remove('active');
                this.chartManager.setChartType('bar');
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
        const textToCopy = this.chartManager.currentSymbol;
        
        if (!textToCopy) return;

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(textToCopy)
                .then(() => {
                    if (button) {
                        button.classList.add('copied');
                        setTimeout(() => button.classList.remove('copied'), 1000);
                    }
                })
                .catch(() => this.fallbackCopy(button, textToCopy));
        } else {
            this.fallbackCopy(button, textToCopy);
        }
    }

    // ✅ ОСТАВЛЕН ТОЛЬКО ОДИН КОРРЕКТНЫЙ ВАРИАНТ fallbackCopy
    fallbackCopy(button, text) {
        const textarea = document.createElement('textarea');
        textarea.value = text; // ✅ Используем переданный текст, а не this.currentPair
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
            const label = (typeof TF_LABELS !== 'undefined' ? TF_LABELS[tf] : null) || tf;
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
        console.log('Переключение на таймфрейм:', tf);
        
        document.querySelectorAll('.timeframe-item').forEach(i => {
            i.classList.toggle('active', i.dataset.tf === tf);
        });

        this.currentInterval = tf;
        localStorage.setItem('lastTimeframe', tf);
        console.log('💾 Сохранён таймфрейм:', tf);
        
        this.chartManager.setCurrentInterval(tf);
        
        const panel = document.getElementById('timeframePanel');
        if (panel) panel.classList.remove('expanded');

        const currentSymbol = this.chartManager.currentSymbol;
        const currentExchange = this.chartManager.currentExchange;
        const currentMarketType = this.chartManager.currentMarketType;
        
        console.log('Текущий символ:', currentSymbol, currentExchange, currentMarketType);

        await this.chartManager.switchSymbol(currentSymbol, currentExchange, currentMarketType);
        
        if (this.wsManager) {
            console.log('🔄 Обновляем WebSocket для символа:', currentSymbol, 'таймфрейм:', tf);
            this.wsManager.updateSymbolAndTimeframe(currentSymbol, tf, currentExchange, currentMarketType);
        }
        
        this.timerManager.start(tf);
        
        setTimeout(() => {
            this.chartManager.autoScale();
        }, 300);
        
        setTimeout(() => {
            if (window.rayManager) window.rayManager.syncWithNewTimeframe();
            if (window.trendLineManager) window.trendLineManager.syncWithNewTimeframe();
            if (window.rulerLineManager) window.rulerLineManager.syncWithNewTimeframe();
            if (window.alertLineManager) window.alertLineManager.syncWithNewTimeframe();
            if (window.textManager) window.textManager.syncWithNewTimeframe();
        }, 200);
        
        this.updateInstrumentInfo();
        this.loadStarredTimeframes();
    }
}

if (typeof window !== 'undefined') {
    window.TimeframeManager = TimeframeManager;
}
