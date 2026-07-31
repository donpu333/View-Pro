class TimeframeManager {
    constructor(chartManager, wsManager, timerManager) {
        this.chartManager = chartManager;
        this.wsManager = wsManager;
        this.timerManager = timerManager;
        this.currentInterval = localStorage.getItem('lastTimeframe') || (typeof CONFIG !== 'undefined' ? CONFIG.defaultInterval : '15m');
        console.log('📊 TimeframeManager: таймфрейм =', this.currentInterval);
        
        // Убраны currentExchange и currentContractType — берем из chartManager!
        
        this.savedStartTime = null;
        this.savedEndTime = null;

        // Сохраняем подписку TimeScale для корректной отписки
        this.timeScaleUnsubscribe = null;

        // Привязываем методы один раз для корректного удаления слушателей
        this.handleDocumentClickBound = this.handleDocumentClick.bind(this);
        this.handleGlobalClickBound = this.handleGlobalClick.bind(this);
        this.handleGlobalKeydownBound = this.handleGlobalKeydown.bind(this);
        this.handleScrollClickBound = this.scrollToLastCandle.bind(this);
        this.handleAutoScaleClickBound = this.autoScaleChart.bind(this);
        
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
        
        // 🛡️ ИСПРАВЛЕНИЕ: Сохраняем функцию отписки, возвращаемую библиотекой
        this.timeScaleUnsubscribe = this.chartManager.chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
            this.saveCurrentPosition();
        });
    }

    destroy() {
        document.removeEventListener('click', this.handleDocumentClickBound);
        document.removeEventListener('click', this.handleGlobalClickBound);
        document.removeEventListener('keydown', this.handleGlobalKeydownBound);
        
        // 🛡️ ИСПРАВЛЕНИЕ: Корректная отписка через сохраненную функцию
        if (this.timeScaleUnsubscribe && typeof this.timeScaleUnsubscribe === 'function') {
            this.timeScaleUnsubscribe();
        } else if (this.timeScaleUnsubscribe && typeof this.timeScaleUnsubscribe.unsubscribe === 'function') {
            this.timeScaleUnsubscribe.unsubscribe();
        }
    }

    saveCurrentPosition() {
        const timeScale = this.chartManager.chart.timeScale();
        const visibleRange = timeScale.getVisibleLogicalRange();
        const data = this.chartManager.chartData;
        
        if (visibleRange && data && data.length > 0) {
            const fromIndex = Math.max(0, Math.floor(visibleRange.from));
            const toIndex = Math.min(data.length - 1, Math.ceil(visibleRange.to));
            
            if (fromIndex < toIndex) {
                // 🚀 Надежнее сохранять границы, а не центр+ширину при смене ТФ
                this.savedStartTime = data[fromIndex].time;
                this.savedEndTime = data[toIndex].time;
            }
        }
    }

    restorePosition() {
        if (!this.savedStartTime || !this.savedEndTime || !this.chartManager.chartData || this.chartManager.chartData.length === 0) return;
        
        const timeScale = this.chartManager.chart.timeScale();
        const data = this.chartManager.chartData;
        
        // 🚀 ОПТИМИЗАЦИЯ: Бинарный поиск O(log N) вместо циклов O(N)
        const findIndexByTime = (targetTime) => {
            let left = 0;
            let right = data.length - 1;
            while (left <= right) {
                const mid = Math.floor((left + right) / 2);
                if (data[mid].time === targetTime) return mid;
                if (data[mid].time < targetTime) left = mid + 1;
                else right = mid - 1;
            }
            return Math.max(0, Math.min(left, data.length - 1)); // Зажимаем индекс
        };

        const startIndex = findIndexByTime(this.savedStartTime);
        const endIndex = findIndexByTime(this.savedEndTime);
        
        // Небольшой отступ по краям для красоты
        const from = Math.max(0, startIndex - 1);
        const to = Math.min(data.length - 1, endIndex + 1);

        if (from < to) {
            timeScale.setVisibleLogicalRange({ from, to });
        } else {
            timeScale.scrollToRealTime();
        }
    }

    handleDocumentClick(event) {
        const panel = document.getElementById('timeframePanel');
        if (panel && panel.classList.contains('expanded') && !panel.contains(event.target)) {
            panel.classList.remove('expanded');
        }
    }

    handleGlobalClick(event) {
        if (event.target.classList.contains('tf-star')) {
            event.stopPropagation();
            event.target.classList.toggle('starred');
            this.saveStarredTimeframes();
        }
    }

    handleGlobalKeydown(event) {
        // 🛡️ ИСПРАВЛЕНИЕ: Alt+T вместо Ctrl+T (чтобы не блокировать новую вкладку браузера)
        if (event.altKey && event.key === 't') {
            event.preventDefault();
            const newType = this.chartManager.currentMarketType === 'futures' ? 'spot' : 'futures';
            // 🛡️ ИСПРАВЛЕНИЕ: Реально переключаем график, а не просто меняем текст
            this.chartManager.switchSymbol(
                this.chartManager.currentSymbol, 
                this.chartManager.currentExchange, 
                newType
            );
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
    
    // 🛡️ ИСПРАВЛЕНИЕ: Убран cloneNode, используем привязанные методы
    setupControlButtons() {
        const scrollBtn = document.getElementById('scrollToLastCandleButton');
        if (scrollBtn) {
            scrollBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleScrollClickBound();
            });
        }
        
        const autoScaleBtn = document.getElementById('autoScaleButton');
        if (autoScaleBtn) {
            autoScaleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleAutoScaleClickBound();
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

    fallbackCopy(button, text) {
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
            star.classList.toggle('starred', starred.includes(star.dataset.tf));
        });
        this.updateStarredDisplay(starred);
    }

    saveStarredTimeframes() {
        const starred = Array.from(document.querySelectorAll('.tf-star.starred')).map(s => s.dataset.tf);
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

    async switchToTimeframe(tf) {
        if (tf === this.currentInterval) return;
        console.log('Переключение на таймфрейм:', tf);
        
        document.querySelectorAll('.timeframe-item').forEach(i => {
            i.classList.toggle('active', i.dataset.tf === tf);
        });

        this.currentInterval = tf;
        localStorage.setItem('lastTimeframe', tf);
        this.chartManager.setCurrentInterval(tf);
        
        // 🛡️ ИСПРАВЛЕНИЕ: Проверка на null
        const panel = document.getElementById('timeframePanel');
        if (panel) panel.classList.remove('expanded');

        try {
            // Загружаем данные напрямую
            const candles = await this.chartManager.fetchKlines(
                this.chartManager.currentSymbol,
                this.chartManager.currentExchange,
                this.chartManager.currentMarketType,
                tf,
                1000
            );
            
            if (candles && candles.length > 0) {
                this.chartManager.setDataQuick(candles, tf,
                    this.chartManager.currentSymbol,
                    this.chartManager.currentExchange,
                    this.chartManager.currentMarketType
                );
            }
            
            if (this.wsManager) {
                this.wsManager.updateSymbolAndTimeframe(
                    this.chartManager.currentSymbol, tf,
                    this.chartManager.currentExchange,
                    this.chartManager.currentMarketType
                );
            }
            
            this.timerManager.start(tf);
            
            // 🚀 ИСПРАВЛЕНИЕ: Убраны setTimeout. 
            // Если setDataQuick отработал, данные уже в массиве chartData.
            // Вызываем немедленно, чтобы избежать мигания пустого экрана.
            this.chartManager.autoScale();
            this.restorePosition(); 
            
            // Синхронизация рисунков
            if (window.rayManager) window.rayManager.syncWithNewTimeframe();
            if (window.trendLineManager) window.trendLineManager.syncWithNewTimeframe();
            if (window.rulerLineManager) window.rulerLineManager.syncWithNewTimeframe();
            if (window.alertLineManager) window.alertLineManager.syncWithNewTimeframe();
            if (window.textManager) window.textManager.syncWithNewTimeframe();

        } catch (error) {
            console.error('Ошибка при переключении таймфрейма:', error);
        }
        
        this.updateInstrumentInfo();
        this.loadStarredTimeframes();
    }
}

if (typeof window !== 'undefined') {
    window.TimeframeManager = TimeframeManager;
}
