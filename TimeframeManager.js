class TimeframeManager {
    constructor(chartManager, wsManager, timerManager) {
        this.chartManager = chartManager;
        this.wsManager = wsManager;
        this.timerManager = timerManager;
        this.currentInterval = localStorage.getItem('lastTimeframe') || (typeof CONFIG !== 'undefined' ? CONFIG.defaultInterval : '15m');
        console.log('📊 TimeframeManager: таймфрейм =', this.currentInterval);
        
        // Переменные для сохранения позиции (центр и ширина окна)
        this.savedCenterTime = null;
        this.savedTimeSpan = null;

        // Сохраняем подписку TimeScale для корректной отписки
        this.timeScaleUnsubscribe = null;

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
        
        // 🛡️ Правильная подписка с сохранением функции отписки
        this.timeScaleUnsubscribe = this.chartManager.chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
            this.saveCurrentPosition();
        });
    }

    destroy() {
        document.removeEventListener('click', this.handleDocumentClickBound);
        document.removeEventListener('click', this.handleGlobalClickBound);
        document.removeEventListener('keydown', this.handleGlobalKeydownBound);
        
        // 🛡️ Корректная отписка от графика
        if (this.timeScaleUnsubscribe && typeof this.timeScaleUnsubscribe === 'function') {
            this.timeScaleUnsubscribe();
        } else if (this.timeScaleUnsubscribe && typeof this.timeScaleUnsubscribe.unsubscribe === 'function') {
            this.timeScaleUnsubscribe.unsubscribe();
        }
    }

    // 🎨 НОВАЯ ЛОГИКА: Сохраняем центр экрана и временную ширину окна
    saveCurrentPosition() {
        const timeScale = this.chartManager.chart.timeScale();
        const visibleRange = timeScale.getVisibleLogicalRange();
        const data = this.chartManager.chartData;
        
        if (visibleRange && data && data.length > 0) {
            const fromIndex = Math.max(0, Math.floor(visibleRange.from));
            const toIndex = Math.min(data.length - 1, Math.ceil(visibleRange.to));
            
            if (fromIndex < toIndex) {
                const centerIndex = Math.floor((fromIndex + toIndex) / 2);
                this.savedCenterTime = data[centerIndex].time;
                this.savedTimeSpan = data[toIndex].time - data[fromIndex].time;
            }
        }
    }

    // 🎨 НОВАЯ ЛОГИКА: Восстановление с отступами (Whitespace padding)
    restorePosition() {
        if (!this.savedCenterTime || !this.chartManager.chartData || this.chartManager.chartData.length === 0) {
            this.chartManager.chart.timeScale().scrollToRealTime();
            return;
        }
        
        const data = this.chartManager.chartData;
        const timeScale = this.chartManager.chart.timeScale();
        
        // Если мы смотрели самый край графика (где формируется свеча), 
        // при смене ТФ оставляем экран на реальном времени
        const latestTime = data[data.length - 1].time;
        if (latestTime <= this.savedCenterTime + (this.savedTimeSpan || 0)) {
            timeScale.scrollToRealTime();
            return;
        }

        // 🚀 Бинарный поиск O(log N) для нахождения индекса центра
        let left = 0;
        let right = data.length - 1;
        let centerIndex = -1;
        
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (data[mid].time === this.savedCenterTime) {
                centerIndex = mid;
                break;
            }
            if (data[mid].time < this.savedCenterTime) left = mid + 1;
            else right = mid - 1;
        }
        
        // Если точного времени нет (при переходе на старший ТФ), берем ближайшую свечу
        if (centerIndex === -1) centerIndex = left;
        centerIndex = Math.max(0, Math.min(centerIndex, data.length - 1));

        // Вычисляем, сколько свечей нужно показать слева и справа от центра
        let radius = 40; // Дефолтный радиус
        
        if (this.savedTimeSpan > 0 && data.length > 1) {
            const avgCandleDuration = (data[data.length - 1].time - data[0].time) / (data.length - 1);
            if (avgCandleDuration > 0) {
                radius = Math.round((this.savedTimeSpan / 2) / avgCandleDuration);
                radius = Math.max(15, Math.min(radius, 250)); // Ограничиваем от 15 до 250 свечей
            }
        }
        
        // ДОБАВЛЯЕМ КРАСИВЫЕ ОТСТУПЫ (по 15% пустого пространства с каждой стороны)
        const padding = Math.max(3, Math.floor(radius * 0.15)); 
        
        let from = centerIndex - radius - padding;
        let to = centerIndex + radius + padding;
        
        // Защита от выхода за границы массива
        from = Math.max(0, from);
        to = Math.min(data.length - 1, to);
        
        // Если справа не хватило места, сдвигаем окно влево
        if (to - from < radius * 1.5) {
            from = Math.max(0, to - (radius * 1.5));
        }

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
        // Заменено на Alt+T (Ctrl+T открывает новую вкладку браузера)
        if (event.altKey && event.key === 't') {
            event.preventDefault();
            const newType = this.chartManager.currentMarketType === 'futures' ? 'spot' : 'futures';
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
    
    setupControlButtons() {
        const scrollBtn = document.getElementById('scrollToLastCandleButton');
        if (scrollBtn) {
            scrollBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.scrollToLastCandle();
            });
        }
        
        const autoScaleBtn = document.getElementById('autoScaleButton');
        if (autoScaleBtn) {
            autoScaleBtn.addEventListener('click', (e) => {
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
            
            // Вызываем немедленно после загрузки данных (без setTimeout)
            this.chartManager.autoScale();
            this.restorePosition(); // Вызывает новую логику с отступами
            
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
