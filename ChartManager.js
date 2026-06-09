class ChartManager {
    constructor(container) {
        this.chartData = [];
        this.lastCandle = null;
        this._loadingSymbol = false;
        this.indicatorManager = new IndicatorManager(this);
        this.chartContainer = document.getElementById('chart-container');
        const savedChartType = localStorage.getItem('chartType') || 'candle';
        this.currentChartType = savedChartType;
        console.log('📊 Тип графика:', savedChartType);
        this.isLoadingMore = false;
        this.hasMoreData = true;
        this.currentInterval = localStorage.getItem('lastTimeframe') || CONFIG.defaultInterval;
        console.log('📊 ChartManager: таймфрейм =', this.currentInterval);
        this.currentSymbol = CONFIG.defaultSymbol;
        this.currentExchange = 'binance';
        this.currentMarketType = 'futures';
        this._lastWidth = this.chartContainer.clientWidth;
        this._initPromise = null;
        this._lastHeight = this.chartContainer.clientHeight;
        this._savedTimePosition = null;
        this._lastTimeframe = null;
        this._symbolChangeCallbacks = [];
        this._updateScheduled = false;
        this._lastUpdateTime = 0;
        this._drawingsUpdateRafId = null;
        this._pendingUpdates = false;
        this._lastLineColor = null;
        this._redrawLoopRunning = false;
        this._lastRedrawFrame = 0;
        this._pendingRedraw = false;
        this._updatePositionRafId = null;
        this._lastAppliedColor = null;
        this._isSyncing = false;
        this._switchingSymbol = false;
        this._currentFetchController = null;
        this._updateTimeout = null;

        this._visibilityHandler = () => {
            if (document.hidden) {
                // Ничего не делаем при скрытии
            } else {
                this._syncAfterHidden();
                if (this.timerManager?._primitive) {
                    this.timerManager._primitive.requestRedraw();
                }
                this.scheduleDrawingsUpdate();
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
       
        this._priceUpdateHandler = null;

        this.scheduleDrawingsUpdate = this.scheduleDrawingsUpdate.bind(this);
        this.onVisibleLogicalRangeChange = this.onVisibleLogicalRangeChange.bind(this);

        this.overlay = safeElement('candleStatsOverlay');
        this.openEl = safeElement('openValue');
        this.highEl = safeElement('highValue');
        this.lowEl = safeElement('lowValue');
        this.closeEl = safeElement('closeValue');
        this.changeEl = safeElement('changeValue');

        this.loadingOverlay = safeElement('loadingOverlay');
        this.loadingProgress = safeElement('loadingProgress');
        
        this.chart = LightweightCharts.createChart(container, {
            layout: { 
                background: { color: '#000000' }, 
                textColor: '#808080'
            },
            grid: { 
                vertLines: { visible: false },
                horzLines: { visible: false }
            },
            crosshair: { 
                mode: LightweightCharts.CrosshairMode.Normal 
            },
            timeScale: { 
                timeVisible: true, 
                secondsVisible: false,
                borderColor: '#333333',
                barSpacing: 12,
                minBarSpacing: 1,
                fixLeftEdge: false,
                fixRightEdge: false,
                rightOffset: 10,
                tickMarkFormatter: (time) => {
                    const mskTime = time + (3 * 3600);
                    const date = new Date(mskTime * 1000);
                    const hours = date.getUTCHours().toString().padStart(2, '0');
                    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
                    return `${hours}:${minutes}`;
                }
            },
            rightPriceScale: { 
                borderColor: '#333333',
                borderVisible: true,
                scaleMargins: {
                    top: 0.1,
                    bottom: 0.1,
                }
            },
            localization: {
                timeFormatter: (time) => {
                    const mskTime = time + (3 * 3600);
                    const date = new Date(mskTime * 1000);
                    return date.toLocaleString('ru-RU', {
                        timeZone: 'UTC',
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }
            }
        });

        this.candleSeries = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: CONFIG.colors.bullish,
            downColor: CONFIG.colors.bearish,
            borderVisible: false,
            wickUpColor: CONFIG.colors.bullish,
            wickDownColor: CONFIG.colors.bearish,
            priceScaleId: 'right',
        });

        this.barSeries = this.chart.addSeries(LightweightCharts.BarSeries, {
            upColor: CONFIG.colors.bullish,
            downColor: CONFIG.colors.bearish,
            openVisible: true,
            thinBars: true,
            priceScaleId: 'right',
        });

        this.candleSeries.applyOptions({
            priceLineVisible: true,
            lastValueVisible: true,
            priceLineSource: this.currentRealPrice || 0,
            priceLineColor: '#00bcd4',
            priceLineWidth: 1,
            priceLineStyle: LightweightCharts.LineStyle.Dashed
        });

        this.barSeries.applyOptions({
            priceLineVisible: true,
            lastValueVisible: true,
            priceLineSource: this.currentRealPrice || 0,
            priceLineColor: '#00bcd4',
            priceLineWidth: 1,
            priceLineStyle: LightweightCharts.LineStyle.Dashed
        });

        const savedBg = localStorage.getItem('chartBgColor');
        const savedBullish = localStorage.getItem('chartBullishColor');
        const savedBearish = localStorage.getItem('chartBearishColor');

        if (savedBg) {
            this.chart.applyOptions({ layout: { background: { color: savedBg } } });
        }
        if (savedBullish && savedBearish) {
            CONFIG.colors.bullish = savedBullish;
            CONFIG.colors.bearish = savedBearish;
            this.bullishColor = savedBullish;
            this.bearishColor = savedBearish;
            
            this.candleSeries.applyOptions({
                upColor: savedBullish,
                downColor: savedBearish,
                wickUpColor: savedBullish,
                wickDownColor: savedBearish
            });
            
            this.barSeries.applyOptions({
                upColor: savedBullish,
                downColor: savedBearish
            });
            
            const lastCandle = this.chartData?.[this.chartData.length - 1];
            const isBullish = lastCandle ? lastCandle.close >= lastCandle.open : true;
            const lineColor = isBullish ? savedBullish : savedBearish;
            this.candleSeries.applyOptions({ priceLineColor: lineColor });
            this.barSeries.applyOptions({ priceLineColor: lineColor });
        }

        if (typeof LightweightCharts !== 'undefined') {
            try {
                this.volumeSeries = this.chart.addSeries(LightweightCharts.HistogramSeries, {
                    priceScaleId: 'volume',
                    priceFormat: { type: 'volume' },
                    color: '#26a69a',
                    lineWidth: 1,
                    lastValueVisible: false,
                    title: ''
                });
                
                const volumeScale = this.chart.priceScale('volume');
                if (volumeScale) {
                    volumeScale.applyOptions({
                        scaleMargins: { top: 0.7, bottom: 0 },
                        visible: true,
                        borderVisible: true,
                        autoScale: true
                    });
                }
                
                this.bullishColor = CONFIG.colors.bullish;
                this.bearishColor = CONFIG.colors.bearish;
                
                console.log('✅ Volume series создан');
            } catch (e) {
                console.warn('⚠️ Не удалось создать Volume:', e);
                this.volumeSeries = null;
            }
        } else {
            console.warn('⚠️ LightweightCharts не загружен');
            this.volumeSeries = null;
        }

        console.log('✅ Volume series создан с отдельной шкалой');

        this.chart.priceScale('right').applyOptions({ 
            scaleMargins: { top: 0.0, bottom: 0.5 }
        });

        const isCandle = this.currentChartType === 'candle';
        this.candleSeries.applyOptions({ visible: isCandle });
        this.barSeries.applyOptions({ visible: !isCandle });

        this.chart.subscribeCrosshairMove(this.onCrosshairMove.bind(this));
        this.chart.timeScale().subscribeVisibleLogicalRangeChange(this.onVisibleLogicalRangeChange);

        this.setupMaximumSubscriptions();
        this.setupEventListeners();

        this.alertTimers = new Map();
        this.currentRealPrice = null;

        setTimeout(() => {
            this.priceManager = window.priceManagerInstance;
            if (this.priceManager) this._subscribeToPrice();
        }, 200);

        (async () => {
            const CACHE_VERSION = '2';
            const savedVersion = localStorage.getItem('candleCacheVersion');
            if (savedVersion !== CACHE_VERSION) {
                await this.clearOldCaches();
                localStorage.setItem('candleCacheVersion', CACHE_VERSION);
                console.log('✅ Кэш свечей обновлён до версии', CACHE_VERSION);
            }
        })();

        this._initPromise = (async () => {
            await this.waitForReady();
            
            this._updateMainChartHeight();
            
            const panelsContainer = document.getElementById('indicator-panels-container');
            if (panelsContainer) {
                const observer = new ResizeObserver(() => {
                    this._updateMainChartHeight();
                });
                observer.observe(panelsContainer);
            }
            
            console.log('✅ ChartManager полностью инициализирован');
        })();
     
        this._setupPanelsSync();
       this._startRedrawLoop();
this._startNewCandleChecker();

                // Поддержка WebSocket и графика на фоне
              // Поддержка WebSocket на фоне
      // Пинг каждые 30 секунд (было 15)
this._bgInterval = setInterval(() => {
    if (window.wsManager?.wsKline?.readyState === WebSocket.OPEN) {
        window.wsManager.wsKline.send(JSON.stringify({ type: 'ping' }));
    }
    if (window.wsManager?.wsTrade?.readyState === WebSocket.OPEN) {
        window.wsManager.wsTrade.send(JSON.stringify({ type: 'ping' }));
    }
}, 30000);
 }
    _startRedrawLoop() {
        const loop = () => {
            this.rayManager?._applyRedrawIfNeeded();
            this.trendLineManager?._applyRedrawIfNeeded();
            this.rulerLineManager?._applyRedrawIfNeeded();
            this.alertLineManager?._applyRedrawIfNeeded();
            
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    getCurrentPrice() {
        if (this.priceManager) {
            const price = this.priceManager.getPrice(this.currentSymbol);
            if (price !== null && !isNaN(price)) {
                return price;
            }
        }
        
        if (this.currentRealPrice !== null && this.currentRealPrice !== undefined && !isNaN(this.currentRealPrice)) {
            return this.currentRealPrice;
        }
        
        return null;
    }
_startNewCandleChecker() {
    const check = () => {
        if (!this.chartData.length || !this.currentInterval) {
            setTimeout(check, 1000);
            return;
        }
        
        const stepMap = {
            '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
            '1h': 3600, '4h': 14400, '6h': 21600, '12h': 43200,
            '1d': 86400, '1w': 604800, '1M': 2592000
        };
        const step = stepMap[this.currentInterval] || 3600;
        const nowSec = Math.floor(Date.now() / 1000);
        
        // 🔧 Для недельных и месячных свечей — не выравниваем математически,
        // а ждём реального наступления нового периода
        let aligned;
        if (this.currentInterval === '1w') {
            // Неделя начинается в понедельник 00:00 UTC
            const now = new Date(nowSec * 1000);
            const dayOfWeek = now.getUTCDay(); // 0 = воскресенье
            const daysToMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7;
            const monday = new Date(Date.UTC(
                now.getUTCFullYear(), 
                now.getUTCMonth(), 
                now.getUTCDate() + daysToMonday
            ));
            aligned = Math.floor(monday.getTime() / 1000);
        } else if (this.currentInterval === '1M') {
            // Месяц начинается 1-го числа 00:00 UTC
            const now = new Date(nowSec * 1000);
            const firstDayOfNextMonth = new Date(Date.UTC(
                now.getUTCFullYear(), 
                now.getUTCMonth() + 1, 
                1
            ));
            aligned = Math.floor(firstDayOfNextMonth.getTime() / 1000);
        } else {
            // Для остальных интервалов — стандартное выравнивание
            aligned = Math.floor(nowSec / step) * step;
        }
        
        const last = this.chartData[this.chartData.length - 1];
        
        // ✅ Дополнительная проверка: aligned должно быть СТРОГО БОЛЬШЕ последней свечи
        // и НЕ ДОЛЖНО быть в будущем (aligned <= nowSec)
        if (last && aligned > last.time && aligned <= nowSec) {
            // Дополнительная проверка для недельных/месячных:
            // убеждаемся что мы действительно находимся в новом периоде
            if (this.currentInterval === '1w' || this.currentInterval === '1M') {
                const lastDate = new Date(last.time * 1000);
                const alignedDate = new Date(aligned * 1000);
                
                // Проверяем что это действительно новый период
                if (this.currentInterval === '1w') {
                    const lastWeekStart = new Date(Date.UTC(
                        lastDate.getUTCFullYear(),
                        lastDate.getUTCMonth(),
                        lastDate.getUTCDate() - ((lastDate.getUTCDay() + 6) % 7)
                    ));
                    if (alignedDate.getTime() === lastWeekStart.getTime()) {
                        // Это та же самая неделя — не создаём новую свечу
                        setTimeout(check, 500);
                        return;
                    }
                } else if (this.currentInterval === '1M') {
                    if (alignedDate.getUTCFullYear() === lastDate.getUTCFullYear() && 
                        alignedDate.getUTCMonth() === lastDate.getUTCMonth()) {
                        // Это тот же самый месяц — не создаём новую свечу
                        setTimeout(check, 500);
                        return;
                    }
                }
            }
            
            const newCandle = {
                time: aligned,
                open: last.close,
                high: last.close,
                low: last.close,
                close: last.close,
                volume: 0
            };
            this._createNewCandle(newCandle);
        }
        
        setTimeout(check, 500);
    };
    check();
}
    _setupPanelsSync() {
        if (!this.chart) return;
        
        const mainTimeScale = this.chart.timeScale();
        const mainChart = this.chart;
        
        console.log('🔧 Настраиваю синхронизацию (по официальной документации TV)...');
        
        mainTimeScale.subscribeVisibleLogicalRangeChange((timeRange) => {
            if (!this.indicatorManager?.panelManager || this._isSyncing) return;
            
            this._isSyncing = true;
            
            const panels = this.indicatorManager.panelManager.panels;
            panels.forEach((panel) => {
                if (panel.chart && !panel.isCollapsed) {
                    try { panel.chart.timeScale().setVisibleLogicalRange(timeRange); } catch(e) {}
                }
            });
            
            setTimeout(() => { this._isSyncing = false; }, 10);
        });
        
        function getCrosshairDataPoint(series, param) {
            if (!param.time) return null;
            const dataPoint = param.seriesData.get(series);
            return dataPoint || null;
        }
        
        function syncCrosshairToPanels(param) {
            if (!mainChart || !param) return;
            
            const panels = window.chartManager?.indicatorManager?.panelManager?.panels;
            if (!panels) return;
            
            panels.forEach((panel) => {
                if (!panel.chart || panel.isCollapsed) return;
                
                try {
                    if (!param.time || !param.point) {
                        panel.chart.clearCrosshairPosition();
                        return;
                    }
                    
                    let targetSeries = null;
                    panel.series.forEach((series) => {
                        targetSeries = series;
                    });
                    
                    if (!targetSeries) {
                        panel.chart.clearCrosshairPosition();
                        return;
                    }
                    
                    const dataPoint = getCrosshairDataPoint(targetSeries, param);
                    
                    if (dataPoint) {
                        panel.chart.setCrosshairPosition(
                            param.time,
                            dataPoint.value,
                            param.point.x
                        );
                    } else {
                        panel.chart.clearCrosshairPosition();
                    }
                    
                } catch(e) {}
            });
        }
        
        mainChart.subscribeCrosshairMove((param) => {
            syncCrosshairToPanels(param);
        });
        
        console.log('✅ Crosshair синхронизирован (официальный метод TradingView)');
    }

    saveCurrentTimePosition() {
        if (!this.chart || !this.chartData.length) return null;
        
        const timeScale = this.chart.timeScale();
        const visibleRange = timeScale.getVisibleLogicalRange();
        
        if (visibleRange) {
            const firstVisibleIndex = Math.floor(visibleRange.from);
            if (firstVisibleIndex >= 0 && firstVisibleIndex < this.chartData.length) {
                return this.chartData[firstVisibleIndex].time;
            }
        }
        return null;
    }

    scrollToTime(time) {
        if (!this.chart || !time) return;
        
        const timeScale = this.chart.timeScale();
        const currentRange = timeScale.getVisibleLogicalRange();
        
        if (!currentRange) return;
        
        const targetIndex = this.chartData.findIndex(c => c.time >= time);
        
        if (targetIndex !== -1) {
            const visibleBars = currentRange.to - currentRange.from;
            timeScale.setVisibleLogicalRange({
                from: Math.max(0, targetIndex - 10),
                to: Math.max(0, targetIndex - 10) + visibleBars
            });
        } else {
            this.scrollToLast();
        }
    }

    getCurrentSymbolKey() {
        return `${this.currentSymbol}:${this.currentExchange}:${this.currentMarketType}`;
    }

    updatePricePrecision(symbol, exchange, marketType) {
        const cachedPrecision = localStorage.getItem(`precision_${symbol}_${exchange}_${marketType}`);
        if (cachedPrecision) {
            this.applyPriceFormat(parseInt(cachedPrecision));
            return;
        }

        this.applyPriceFormat(this._inferPrecisionFromData());

        getPrecisionFromExchange(symbol, exchange, marketType)
            .then(precision => {
                this.applyPriceFormat(precision);
                localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, precision);
            })
            .catch(() => {});
    }

    setupMaximumSubscriptions() {
        this.chart.timeScale().subscribeVisibleTimeRangeChange(() => {
            this.scheduleDrawingsUpdate();
        });
        
        this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
            this.scheduleDrawingsUpdate();
        });

        const priceScale = this.chart.priceScale('right');
        if (priceScale && typeof priceScale.subscribeVisibleLogicalRangeChange === 'function') {
            priceScale.subscribeVisibleLogicalRangeChange(() => {
                this.scheduleDrawingsUpdate();
            });
        }

        this.chartContainer.addEventListener('wheel', () => {
            this.scheduleDrawingsUpdate();
        }, { passive: true });
        
        let resizeTimeout;
        const observer = new MutationObserver(() => {
            if (resizeTimeout) return;
            resizeTimeout = setTimeout(() => {
                resizeTimeout = null;
                const currentWidth = this.chartContainer.clientWidth;
                const currentHeight = this.chartContainer.clientHeight;
                if (currentWidth !== this._lastWidth || currentHeight !== this._lastHeight) {
                    this._lastWidth = currentWidth;
                    this._lastHeight = currentHeight;
                    this.scheduleDrawingsUpdate();
                }
            }, 100);
        });
        observer.observe(this.chartContainer, { 
            attributes: true, 
            attributeFilter: ['style', 'class']
        });
    }

    forceRedraw() {
        if (!this.chartData.length) return;

        const cachedPrecision = localStorage.getItem(
            `precision_${this.currentSymbol}_${this.currentExchange}_${this.currentMarketType}`
        );
        if (cachedPrecision) {
            this.applyPriceFormat(parseInt(cachedPrecision));
        } else {
            this.applyPriceFormat(this._inferPrecisionFromData());
        }

        this.candleSeries.setData([]);
        this.barSeries.setData([]);
        if (this.volumeSeries) this.volumeSeries.setData([]);

        setTimeout(() => {
            this.candleSeries.setData(this.chartData);
            this.barSeries.setData(this.chartData);

            if (this.volumeSeries) {
                const volumeData = this.chartData.map(c => ({
                    time: c.time,
                    value: c.volume,
                    color: c.close >= c.open ? this.bullishColor : this.bearishColor
                }));
                this.volumeSeries.setData(volumeData);
            }

            if (this.indicatorManager) {
                this.indicatorManager.updateAllIndicators();
            }

            if (this.currentRealPrice) {
                const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
                if (series) {
                    series.applyOptions({ priceLineSource: this.currentRealPrice });
                }
            }

            if (this.timerManager?._primitive) {
                this.timerManager._primitive.requestRedraw();
            }
        }, 10);
    }

    _subscribeToSymbolChange(callback) {
        this._symbolChangeCallbacks = this._symbolChangeCallbacks || [];
        this._symbolChangeCallbacks.push(callback);
    }

    _notifySymbolChange() {
        if (this._symbolChangeCallbacks) {
            this._symbolChangeCallbacks.forEach(cb => cb());
        }
    }

    loadSymbolData(symbol, exchange, marketType) {
        const isSameSymbol = (symbol === this.currentSymbol);
        const isTimeframeChange = isSameSymbol && (this.currentInterval !== this._lastTimeframe);

        if (isTimeframeChange) {
            this._savedTimePosition = this.saveCurrentTimePosition();
            console.log('📍 Сохранена позиция:', this._savedTimePosition);
        }
        
        console.log(`📊 Загружаю данные для ${symbol} (${exchange} ${marketType})`);
        
        if (this._loadingSymbol) {
            console.log('Загрузка уже выполняется, пропускаем');
            return;
        }
        this._loadingSymbol = true;
        
        const dbPromise = new Promise(resolve => {
            if (window.dbReady) {
                resolve();
            } else {
                console.log('⏳ Ожидание IndexedDB...');
                const check = setInterval(() => {
                    if (window.dbReady) {
                        clearInterval(check);
                        console.log('✅ IndexedDB готова');
                        resolve();
                    }
                }, 50);
                setTimeout(() => {
                    clearInterval(check);
                    console.warn('⚠️ Таймаут ожидания IndexedDB');
                    resolve(); 
                }, 3000);
            }
        });

        this.setSymbol(symbol);
        
        if (this.loadingOverlay) {
            this.loadingOverlay.classList.add('visible');
            if (this.loadingProgress) {
                this.loadingProgress.textContent = 'Загрузка...';
            }
        }
        
        const loadData = async () => {
            // Метод оставлен для совместимости
        };
    }

    async saveCandlesToCache(symbol, exchange, marketType, interval, candles) {
        if (!candles || candles.length === 0) return;
        
        const CACHE_VERSION = '2';
        const key = `${symbol}_${interval}_${exchange}_${marketType}_v${CACHE_VERSION}`;
        
        const cacheData = {
            key: key,
            symbol: symbol,
            exchange: exchange,
            marketType: marketType,
            interval: interval,
            data: candles,
            lastUpdate: Date.now(),
            firstCandleTime: candles[0].time,
            lastCandleTime: candles[candles.length - 1].time,
            count: candles.length,
            version: CACHE_VERSION
        };
        
        if (!window.db) {
            console.warn('📦 IndexedDB не доступна, кэш не сохранен');
            return;
        }
        
        try {
            if (!window.dbReady) {
                await new Promise(resolve => {
                    const check = setInterval(() => {
                        if (window.dbReady) {
                            clearInterval(check);
                            resolve();
                        }
                    }, 100);
                    setTimeout(() => {
                        clearInterval(check);
                        resolve();
                    }, 2000);
                });
            }
            
            await window.db.put('candles', cacheData);
            console.log(`📦 Свечи сохранены в кэш: ${key} (${candles.length} свечей)`);
        } catch (error) {
            console.warn('❌ Ошибка сохранения свечей в кэш:', error);
        }
    }
    
    async loadCandlesFromCache(symbol, exchange, marketType, interval) {
        const CACHE_VERSION = '2';
        const key = `${symbol}_${interval}_${exchange}_${marketType}_v${CACHE_VERSION}`;
        
        if (!window.db) return null;
        
        try {
            const cached = await window.db.get('candles', key);
            if (!cached) return null;
            
            if (cached.version !== CACHE_VERSION) {
                console.log(`Кэш устарел (версия ${cached.version}), удаляем`);
                await window.db.delete('candles', key);
                return null;
            }
            
            const CACHE_DURATION = 5 * 60 * 1000;
            if (Date.now() - cached.lastUpdate > CACHE_DURATION) {
                console.log(`Кэш устарел по времени: ${key}`);
                return null;
            }
            
            console.log(`📦 Загружено ${cached.data.length} свечей из кэша: ${key}`);
            return cached.data;
        } catch (error) {
            console.warn('❌ Ошибка загрузки свечей из кэша:', error);
            return null;
        }
    }

    async clearOldCaches() {
        const CACHE_VERSION = '2';
        try {
            const allCandles = await window.db.getAll('candles');
            for (const cache of allCandles) {
                if (!cache.version || cache.version !== CACHE_VERSION) {
                    await window.db.delete('candles', cache.key);
                    console.log(`🗑️ Удалён старый кэш свечей: ${cache.key}`);
                }
            }
        } catch (e) {
            console.warn('Ошибка очистки кэша свечей:', e);
        }
    }

    async clearOldCandlesCache(maxAge = 24 * 60 * 60 * 1000) {
        try {
            const allCandles = await window.db.getAll('candles');
            const now = Date.now();
            let deletedCount = 0;
            
            for (const cached of allCandles) {
                if (now - cached.lastUpdate > maxAge) {
                    await window.db.delete('candles', cached.key);
                    deletedCount++;
                }
            }
            
            if (deletedCount > 0) {
                console.log(`🧹 Очищено ${deletedCount} устаревших кэшей свечей`);
            }
            
        } catch (error) {
            console.warn('❌ Ошибка очистки кэша свечей:', error);
        }
    }

    async waitForReady() {
        let attempts = 0;
        const maxAttempts = 50;
        
        while (attempts < maxAttempts) {
            if (this.chart && 
                this.candleSeries && 
                this.chartData && 
                this.chartData.length > 0 &&
                this.chart.timeScale()?.getVisibleRange()) {
                console.log('✅ График готов за', attempts * 100, 'мс');
                return true;
            }
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }
        console.warn('⚠️ Таймаут ожидания готовности графика');
        return false;
    }

    async waitForSeriesReady() {
        return this.waitForReady();
    }

    timeToCoordinate(time) {
        try {
            return this.chart.timeScale().timeToCoordinate(time);
        } catch (e) {
            return null;
        }
    }

    coordinateToTime(coordinate) {
        try {
            return this.chart.timeScale().coordinateToTime(coordinate);
        } catch (e) {
            return null;
        }
    }

    priceToCoordinate(price) {
        try {
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            return series.priceToCoordinate(price);
        } catch (e) {
            return null;
        }
    }

    timeToCoordinateWithFallback(time) {
        let coord = this.timeToCoordinate(time);
        if (coord !== null) return coord;
        
        const data = this.chartData;
        if (!data || !data.length) return null;
        
        const firstCandle = data[0];
        const lastCandle = data[data.length - 1];
        const firstX = this.timeToCoordinate(firstCandle.time);
        const lastX = this.timeToCoordinate(lastCandle.time);
        
        if (firstX === null || lastX === null) return null;
        
        const pixelsPerMs = (lastX - firstX) / (lastCandle.time - firstCandle.time);
        if (time < firstCandle.time) {
            return firstX - (firstCandle.time - time) * pixelsPerMs;
        } else {
            return lastX + (time - lastCandle.time) * pixelsPerMs;
        }
    }

    priceToCoordinateWithFallback(price) {
        let coord = this.priceToCoordinate(price);
        if (coord !== null) return coord;

        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (!series) return null;
        
        const priceScale = series.priceScale();
        if (!priceScale) return null;
        
        const height = priceScale.height;
        if (!height || height <= 0) return null;
        
        const firstValue = priceScale.priceToCoordinate(0);
        const lastValue = priceScale.priceToCoordinate(height);
        
        if (firstValue === null || lastValue === null) return null;
        
        const minPrice = Math.min(firstValue, lastValue);
        const maxPrice = Math.max(firstValue, lastValue);
        const pixelsPerUnit = height / (maxPrice - minPrice);
        
        if (price < minPrice) {
            return 0 - (minPrice - price) * pixelsPerUnit;
        } else {
            return height + (price - maxPrice) * pixelsPerUnit;
        }
    }
   
    timeToLogical(time) {
        if (!this.chartData || !this.chartData.length) return null;
        const index = this.chartData.findIndex(c => c.time === time);
        return index !== -1 ? index : null;
    }

    coordinateToPrice(coordinate) {
        try {
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            return series.coordinateToPrice(coordinate);
        } catch (e) {
            return null;
        }
    }

    scheduleDrawingsUpdate() {
        if (this._drawingsUpdateRafId === null && window.renderDrawings) {
            this._drawingsUpdateRafId = requestAnimationFrame(() => {
                window.renderDrawings();
                this._drawingsUpdateRafId = null;
            });
        }
    }
    
    onVisibleLogicalRangeChange(range) {
        if (!range || this.isLoadingMore || !this.hasMoreData || !this.chartData.length) return;
        
        const fromIndex = Math.max(0, Math.floor(range.from));
        
        if (fromIndex < 70 && this.hasMoreData && !this.isLoadingMore) {
            this.loadMoreHistoricalData();
        }
    }
    
   async loadMoreHistoricalData() {
    if (this.isLoadingMore || !this.hasMoreData || !this.chartData.length) return;
    
    this.isLoadingMore = true;
    
    try {
        const oldestCandle = this.chartData[0];
        if (!oldestCandle) {
            this.isLoadingMore = false;
            return;
        }
        
        const endTime = (oldestCandle.time * 1000) - 1;
        
        const olderCandles = await DataFetcher.loadMoreKlines(
            this.currentSymbol, 
            this.currentInterval, 
            endTime
        );
        
        if (olderCandles && olderCandles.length > 0) {
            const uniqueOlder = olderCandles.filter(newCandle => 
                !this.chartData.some(existing => existing.time === newCandle.time)
            );
            
            if (uniqueOlder.length > 0) {
                this.chartData = [...uniqueOlder, ...this.chartData];
                
                // Обновляем свечи
                this.candleSeries.setData(this.chartData);
                this.barSeries.setData(this.chartData);
                
                // Обновляем объёмы
                if (this.volumeSeries) {
                    const volumeData = this.chartData.map(c => ({
                        time: c.time,
                        value: c.volume || 0,
                        color: c.close >= c.open ? this.bullishColor : this.bearishColor
                    }));
                    this.volumeSeries.setData(volumeData);
                }
                
                // Обновляем индикаторы
                if (this.indicatorManager) {
                    this.indicatorManager.updateAllIndicators();
                }
            }
            
            if (olderCandles.length < 1000) {
                this.hasMoreData = false;
            }
        } else {
            this.hasMoreData = false;
        }
    } catch (e) {
        console.error('Ошибка загрузки истории:', e);
    } finally {
        this.isLoadingMore = false;
    }
}
    async refreshCandlesInBackground(symbol, exchange, marketType, interval) {
        console.log(`🔄 Фоновое обновление свечей для ${symbol}...`);
        
        try {
            const bybitIntervalMap = {
                '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
                '1h': '60', '4h': '240', '6h': '360', '12h': '720',
                '1d': 'D', '1w': 'W', '1M': 'M'
            };
            const CACHE_VERSION = '2';
            
            let url;
            let limit = 100;
            
            if (exchange === 'binance') {
                if (marketType === 'futures') {
                    url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
                } else {
                    url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
                }
            } else {
                const bybitInterval = bybitIntervalMap[interval] || interval;
                const category = marketType === 'futures' ? 'linear' : 'spot';
                url = `https://api.bybit.com/v5/market/kline?category=${category}&symbol=${symbol}&interval=${bybitInterval}&limit=${limit}`;
            }
            
            const response = await fetch(url);
            if (!response.ok) return;
            
            const data = await response.json();
            
            let freshCandles = [];
            
            if (exchange === 'binance') {
                if (!Array.isArray(data)) return;
                freshCandles = data.map(item => ({
                    time: Math.floor(item[0] / 1000),
                    open: parseFloat(item[1]),
                    high: parseFloat(item[2]),
                    low: parseFloat(item[3]),
                    close: parseFloat(item[4]),
                    volume: parseFloat(item[5]),
                    quoteVolume: parseFloat(item[7])
                }));
            } else {
                if (data.retCode !== 0 || !data.result?.list) return;
                const candles = data.result.list;
                freshCandles = candles.map(item => ({
                    time: Math.floor(parseInt(item[0]) / 1000),
                    open: parseFloat(item[1]),
                    high: parseFloat(item[2]),
                    low: parseFloat(item[3]),
                    close: parseFloat(item[4]),
                    volume: parseFloat(item[5] || 0),
                    quoteVolume: parseFloat(item[6] || 0)
                })).filter(c => c !== null);
            }
            
            if (freshCandles.length === 0) return;
            
            const lastCachedTime = this.chartData.length > 0 ? this.chartData[this.chartData.length - 1].time : 0;
            const lastFreshTime = freshCandles[freshCandles.length - 1].time;
            
            if (lastFreshTime > lastCachedTime) {
                console.log(`📊 Найдены новые свечи: ${lastFreshTime} > ${lastCachedTime}`);
                const newCandles = freshCandles.filter(c => c.time > lastCachedTime);
                this.chartData.push(...newCandles);
                this._performUpdate();
                
                if (window.db && window.dbReady) {
                    const key = `${symbol}_${interval}_${exchange}_${marketType}_v${CACHE_VERSION}`;
                    const cached = await window.db.get('candles', key);
                    
                    if (cached) {
                        const updatedData = [...cached.data, ...newCandles];
                        if (updatedData.length > 1000) {
                            updatedData.splice(0, updatedData.length - 1000);
                        }
                        await window.db.put('candles', {
                            ...cached,
                            key: key,
                            data: updatedData,
                            lastUpdate: Date.now(),
                            lastCandleTime: updatedData[updatedData.length - 1].time,
                            count: updatedData.length,
                            version: CACHE_VERSION
                        });
                        console.log(`📦 Кэш обновлён: добавлено ${newCandles.length} свечей`);
                    } else {
                        const newCache = {
                            key: key,
                            symbol: symbol,
                            exchange: exchange,
                            marketType: marketType,
                            interval: interval,
                            data: freshCandles,
                            lastUpdate: Date.now(),
                            firstCandleTime: freshCandles[0].time,
                            lastCandleTime: freshCandles[freshCandles.length - 1].time,
                            count: freshCandles.length,
                            version: CACHE_VERSION
                        };
                        await window.db.put('candles', newCache);
                        console.log(`📦 Создан новый кэш: ${key}`);
                    }
                }
                this.scrollToLast();
            }
        } catch (error) {
            console.warn('⚠️ Ошибка фонового обновления:', error);
        }
    }
    
    setupEventListeners() {
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            
            resizeTimeout = setTimeout(() => {
                if (this.chart) {
                    const width = this.chartContainer.clientWidth;
                    const height = this.chartContainer.clientHeight;
                    
                    this.chart.applyOptions({ width, height });
                    
                    if (this._resizeIndicatorPanels) {
                        this._resizeIndicatorPanels();
                    }
                    
                    if (this._updateMainChartHeight) {
                        this._updateMainChartHeight();
                    }
                    
                    setTimeout(() => {
                        this.scrollToLast();
                    }, 50);
                }
                
                if (this.timerManager && this.timerManager._primitive) {
                    this.timerManager._primitive.requestRedraw();
                }
                
                this.scheduleDrawingsUpdate();
            }, 100);
        });
    }
    
    setChartType(type) {
        if (!this.chart) {
            console.warn('График не инициализирован');
            return;
        }
        
        this.currentChartType = type;
        localStorage.setItem('chartType', type);
        if (type === 'candle') {
            if (this.candleSeries) this.candleSeries.applyOptions({ visible: true });
            if (this.barSeries) this.barSeries.applyOptions({ visible: false });
        } else if (type === 'bar') {
            if (this.candleSeries) this.candleSeries.applyOptions({ visible: false });
            if (this.barSeries) this.barSeries.applyOptions({ visible: true });
        }
        
        if (this.barSeries) {
            const bullishColor = CONFIG.colors.bullish;
            const bearishColor = CONFIG.colors.bearish;
            this.barSeries.applyOptions({
                upColor: bullishColor,
                downColor: bearishColor
            });
        }
        
        if (this.timerManager && typeof this.timerManager.reattach === 'function') {
            this.timerManager.reattach();
        }
        
        if (this.indicatorManager && this.indicatorManager.activeIndicators) {
            console.log('🔄 Пересоздаём серии индикаторов при смене типа графика');
            this.indicatorManager.activeIndicators.forEach(indicator => {
                try {
                    indicator.createSeries();
                } catch (e) {
                    console.warn('Ошибка при пересоздании серии для индикатора:', indicator.type, e);
                }
            });
        }
        
        setTimeout(() => {
            if (window.rayManager) window.rayManager.syncWithNewTimeframe();
            if (window.trendLineManager) window.trendLineManager.syncWithNewTimeframe();
            if (window.rulerLineManager) window.rulerLineManager.syncWithNewTimeframe();
            if (window.alertLineManager) window.alertLineManager.syncWithNewTimeframe();
            if (window.textManager) window.textManager.syncWithNewTimeframe();
        }, 50);
        
        const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (activeSeries) {
            const lastCandle = this.chartData[this.chartData.length - 1];
            const isBullish = lastCandle ? lastCandle.close >= lastCandle.open : true;
            const lineColor = isBullish ? CONFIG.colors.bullish : CONFIG.colors.bearish;
            
            activeSeries.applyOptions({
                priceLineVisible: true,
                lastValueVisible: true,
                priceLineSource: this.currentRealPrice || 0,
                priceLineColor: lineColor,
                priceLineWidth: 1,
                priceLineStyle: LightweightCharts.LineStyle.Dashed
            });
        }
    }

    scheduleUpdate() {
        if (this._updateScheduled) return;
        
        this._updateScheduled = true;
        requestAnimationFrame(() => {
            this._performUpdate();
            this._updateScheduled = false;
            this._lastUpdateTime = Date.now();
        });
    }

    scheduleUpdatePosition() {
        if (this._updatePositionRafId === null) {
            this._updatePositionRafId = requestAnimationFrame(() => {
                this.updatePriceLineTimerPosition();
                this._updatePositionRafId = null;
            });
        }
    }

    updatePriceLineTimerPosition() {
        if (!this.lastCandle || !this.priceLineTimer) return;
        
        const price = this.currentRealPrice || this.lastCandle.close;
        const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        const coordinate = activeSeries.priceToCoordinate(price);
        
        if (coordinate !== null && !isNaN(coordinate)) {
            const containerRect = this.chartContainer.getBoundingClientRect();
            let topPosition = coordinate - containerRect.top + 60;
            
            const timerHeight = this.priceLineTimer.offsetHeight;
            topPosition = Math.max(5, Math.min(window.innerHeight - timerHeight - 5, topPosition));
            
            this.priceLineTimer.style.top = topPosition + 'px';
            this.priceLineTimer.style.right = '10px';
            
            const isBullish = this.lastCandle ? Utils.isBullish(this.lastCandle.open, this.lastCandle.close) : true;
            this.priceLineTimer.classList.remove('bullish', 'bearish');
            this.priceLineTimer.classList.add(isBullish ? 'bullish' : 'bearish');
        }
    }

  _performUpdate() {
    if (!this.chartData.length) return;
    
    const cachedPrecision = localStorage.getItem(
        `precision_${this.currentSymbol}_${this.currentExchange}_${this.currentMarketType}`
    );
    if (cachedPrecision) {
        this.applyPriceFormat(parseInt(cachedPrecision));
    } else {
        this.applyPriceFormat(this._inferPrecisionFromData());
    }
    
    this.candleSeries.setData(this.chartData);
    this.barSeries.setData(this.chartData);
    
    if (this.indicatorManager) {
        this.indicatorManager.updateAllIndicators();
    }

    const lastCandle = this.chartData[this.chartData.length - 1];
    const isBullish = lastCandle ? lastCandle.close >= lastCandle.open : true;
    const lineColor = isBullish ? CONFIG.colors.bullish : CONFIG.colors.bearish;
    const price = this.getCurrentPrice();

    if (price !== null) {
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (series) {
            series.applyOptions({
                priceLineSource: price,
                priceLineColor: lineColor
            });
        }
    }

    if (this.timerManager) {
        this.timerManager.start(this.currentInterval);
        if (this.timerManager._primitive) {
            // ✅ Передаём таймеру цену
            if (price && this.timerManager._primitive.setPrice) {
                this.timerManager._primitive.setPrice(price);
            }
            // ✅ Передаём таймеру цвет
            if (this.timerManager._primitive.setColor) {
                this.timerManager._primitive.setColor(lineColor);
            }
            if (this.timerManager._primitive.isEnabled()) {
                this.timerManager._primitive.requestRedraw();
            }
        }
    }

    this._lastAppliedColor = lineColor;
    this.scheduleUpdatePosition();
}
updateLastCandle(candle) {
    if (!candle || typeof candle.time !== 'number' || isNaN(candle.time) || candle.time <= 0) {
        console.warn('⚠️ Пропущена свеча с некорректным временем:', candle);
        return;
    }
    
    try {
        if (!this._isValidCandle(candle)) {
            console.warn('⚠️ Битая свеча обнаружена:', candle);
            const sanitized = this._sanitizeCandle(candle);
            if (!sanitized) {
                console.error('❌ Свечу невозможно исправить, пропускаем');
                return;
            }
            candle = sanitized;
        }
        
        const lastCandle = this.chartData[this.chartData.length - 1];
        const existingIndex = this.chartData.findIndex(c => c.time === candle.time);
        
        if (existingIndex !== -1) {
            // Обновляем существующую свечу
            this.chartData[existingIndex] = candle;
        } else if (!lastCandle || candle.time > lastCandle.time) {
            // ✅ НОВАЯ СВЕЧА — добавляем
            this.chartData.push(candle);
            const limit = CONFIG.klineLimits[this.currentInterval] || 1000;
            if (this.chartData.length > limit) {
                this.chartData = this.chartData.slice(-limit);
            }
        } else {
            // Устаревшая свеча — игнорируем
            return;
        }
        
        // ✅ ОБНОВЛЯЕМ ГРАФИК
        const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (activeSeries) {
            if (existingIndex !== -1 && existingIndex === this.chartData.length - 1) {
                // Текущая свеча — обновляем через update
                activeSeries.update({
                    time: candle.time,
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close
                });
            } else {
                // Новая свеча — полная перезагрузка
                activeSeries.setData(this.chartData);
            }
        }
        
        this.currentRealPrice = candle.close;
        this.lastCandle = candle;
        
        // ✅ ОПРЕДЕЛЯЕМ ЦВЕТ
        const isBullish = candle.close >= candle.open;
        const lineColor = isBullish ? CONFIG.colors.bullish : CONFIG.colors.bearish;
        
        // ✅ ОБНОВЛЯЕМ ЛИНИЮ ЦЕНЫ
        if (activeSeries && this.currentRealPrice) {
            activeSeries.applyOptions({ 
                priceLineSource: this.currentRealPrice,
                priceLineColor: lineColor
            });
        }
        
        // ✅ ОБНОВЛЯЕМ ТАЙМЕР
        if (this.timerManager?._primitive) {
            if (this.timerManager._primitive.setPrice) {
                this.timerManager._primitive.setPrice(candle.close);
            }
            if (this.timerManager._primitive.setColor) {
                this.timerManager._primitive.setColor(lineColor);
            }
            if (this.timerManager._primitive.isEnabled()) {
                this.timerManager._primitive.requestRedraw();
            }
        }
        
        // ✅ ОБНОВЛЯЕМ ПОЗИЦИЮ
        if (this.scheduleUpdatePosition) {
            this.scheduleUpdatePosition();
        }
        
        // Обновляем volume
        if (this.volumeSeries && this.chartData.length > 0) {
            const volumeData = this.chartData.map(c => ({
                time: c.time,
                value: c.volume || 0,
                color: c.close >= c.open ? this.bullishColor : this.bearishColor
            }));
            this.volumeSeries.setData(volumeData);
        }
        
    } catch (e) {
        console.error('❌ Ошибка в updateLastCandle:', e);
    }
}

    async waitForChartReady() {
        await new Promise(resolve => {
            const check = () => {
                const ts = this.chart?.timeScale();
                if (ts && ts.getVisibleRange()) {
                    resolve();
                } else {
                    requestAnimationFrame(check);
                }
            };
            check();
        });
        await new Promise(r => setTimeout(r, 50));
    }

 setDataQuick(data, interval, symbol, exchange = 'binance', marketType = 'futures') {
    console.log('🔵 setDataQuick: получено свечей', data.length);
    
    if (data.length > 0) {
        console.log('    Первая свеча:', data[0]);
        console.log('    Последняя свеча:', data[data.length - 1]);
        
        if (this.candleSeries) this.candleSeries.setData([]);
        if (this.barSeries) this.barSeries.setData([]);
        if (this.volumeSeries) this.volumeSeries.setData([]);
        
        const beforeFilter = data.length;
        const seenTimes = new Set();
        let noDupes = data.filter(c => {
            if (!c || typeof c.time !== 'number' || isNaN(c.time)) return false;
            if (seenTimes.has(c.time)) return false;
            seenTimes.add(c.time);
            return true;
        });
        noDupes = noDupes.filter(c => this._isValidCandle(c));
        data = noDupes;
        
        if (data.length === 0) {
            console.error('❌ setDataQuick: после фильтрации не осталось валидных свечей!');
            return;
        }
        
        console.log(`✅ Валидных свечей: ${data.length}`);
        
        const intervalMapSeconds = {
            '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
            '1h': 3600, '4h': 14400, '6h': 21600, '12h': 43200,
            '1d': 86400, '1w': 604800, '1M': 2592000
        };
        const step = intervalMapSeconds[interval] || 3600;
        data = data.map(c => ({
            ...c,
            time: Math.floor(Math.floor(c.time * 1000) / (step * 1000)) * step
        }));
        
  
        this.chartData = data;
        this.currentInterval = interval;
        this.currentSymbol = symbol;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;
        this.hasMoreData = true;
        this.lastCandle = data[data.length - 1];
        
        const cachedPrecision = localStorage.getItem(`precision_${symbol}_${exchange}_${marketType}`);
        const inferredPrecision = this._inferPrecisionFromData();
        
        if (cachedPrecision) {
            this.applyPriceFormat(parseInt(cachedPrecision));
        } else {
            this.applyPriceFormat(inferredPrecision);
            localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, inferredPrecision);
        }
        
        this._performUpdate();
        this._updatePageTitle();
        
        if (this.volumeSeries && this.chartData.length > 0) {
            const volumeData = this.chartData.map(candle => ({
                time: candle.time,
                value: candle.volume || 0,
                color: candle.close >= candle.open ? this.bullishColor : this.bearishColor
            }));
            this.volumeSeries.setData(volumeData);
        }
        
        if (this.indicatorManager) {
            this.indicatorManager.restorePendingIndicators();
            this.indicatorManager.updateAllIndicators();
            this.indicatorManager.loadIndicators();
        }
        
        // ✅ Всегда получаем точный precision и ПРИМЕНЯЕМ его
        getPrecisionFromExchange(symbol, exchange, marketType)
            .then(precision => {
                localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, precision);
                this.applyPriceFormat(precision);  // ← ВОТ ЭТО добавлено
                console.log(`✅ Precision applied for ${symbol}: ${precision} decimals`);
            })
            .catch(() => {});
        
        requestAnimationFrame(() => {
            if (window.renderDrawings) window.renderDrawings();
        });
        
        this._notifySymbolChange();
        
    } else {
        console.warn('setDataQuick: нет данных');
    }
    
    this._lastTimeframe = interval;

    if (!window._dailySeparator) {
        window._dailySeparator = new DailySeparator(this);
    } else {
        window._dailySeparator.redraw();
    }
    
    if (!window._sessionHighlighter) {
        window._sessionHighlighter = new SessionHighlighter(this);
    }
}
    async loadDrawingsForCurrentSymbol() {
        await new Promise(resolve => setTimeout(resolve, 100));

        const key = `${this.currentSymbol}:${this.currentExchange}:${this.currentMarketType}`;
        console.log('🎨 Загрузка рисунков для:', key);

        await Promise.all([
            window.rayManager?.loadRays(),
            window.trendLineManager?.loadTrendLines(),
            window.rulerLineManager?.loadRulers(),
            window.alertLineManager?.loadAlerts(),
            window.textManager?.loadTexts()
        ].filter(Boolean));
    }

  
    onCrosshairMove(param) {
        if (!this.overlay) {
            this.overlay = safeElement('candleStatsOverlay');
        }
        
        if (!param || !param.time || !this.chartData || this.chartData.length === 0) {
            if (this.overlay) this.overlay.classList.remove('visible');
            return;
        }

        const candle = this.chartData.find(c => c.time === param.time);
        
        if (candle) {
            const isBullish = Utils.isBullish(candle.open, candle.close);
            const bullishClass = isBullish ? 'bullish' : 'bearish';
            
            if (this.openEl) {
                this.openEl.textContent = Utils.formatPrice(candle.open);
                this.openEl.className = `stat-value ${bullishClass}`;
            }
            
            if (this.highEl) {
                this.highEl.textContent = Utils.formatPrice(candle.high);
                this.highEl.className = `stat-value ${bullishClass}`;
            }
            
            if (this.lowEl) {
                this.lowEl.textContent = Utils.formatPrice(candle.low);
                this.lowEl.className = `stat-value ${bullishClass}`;
            }
            
            if (this.closeEl) {
                this.closeEl.textContent = Utils.formatPrice(candle.close);
                this.closeEl.className = `stat-value ${bullishClass}`;
            }
            
            if (this.changeEl) {
                const change = Utils.calculateChange(candle.open, candle.close);
                const changeNum = parseFloat(change);
                this.changeEl.textContent = (changeNum > 0 ? '+' : '') + change + '%';
                this.changeEl.className = `change-value ${bullishClass}`;
            }
            
            const volumeEl = document.getElementById('volumeValue');
            if (volumeEl) {
                volumeEl.textContent = Utils.formatVolume(candle.volume);
                volumeEl.className = `stat-value ${bullishClass}`;
            }
            
            if (this.overlay) {
                this.overlay.classList.add('visible');
            }
        } else {
            if (this.overlay) {
                this.overlay.classList.remove('visible');
            }
        }
    }
updateRealPrice(price) {
    this._syncPriceLine(price);
}
    scrollToLast() {
        if (this.chart && this.chartData.length > 0) {
            const timeScale = this.chart.timeScale();
            const currentRange = timeScale.getVisibleLogicalRange();
            
            if (currentRange) {
                const visibleBarsCount = currentRange.to - currentRange.from;
                const newFrom = Math.max(0, this.chartData.length - visibleBarsCount + 10);
                
                timeScale.setVisibleLogicalRange({
                    from: newFrom,
                    to: newFrom + visibleBarsCount
                });
            } else {
                timeScale.scrollToRealTime();
                
                setTimeout(() => {
                    const newRange = timeScale.getVisibleLogicalRange();
                    if (newRange) {
                        const visibleBars = newRange.to - newRange.from;
                        timeScale.setVisibleLogicalRange({
                            from: this.chartData.length - visibleBars + 10,
                            to: this.chartData.length + 10
                        });
                    }
                }, 50);
            }
        }
    }

    clearChart() {
        if (this.candleSeries) {
            this.candleSeries.setData([]);
        }
        if (this.barSeries) {
            this.barSeries.setData([]);
        }
        if (this.volumeSeries) {
            this.volumeSeries.setData([]);
        }
        
        this.chartData = [];
        this.lastCandle = null;
        
        const priceScale = this.chart.priceScale('right');
        if (priceScale) {
            priceScale.applyOptions({ autoScale: true });
        }
    }
_syncPriceLine(price) {
    if (!price) return;
    
    const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
    if (!series) return;
    
    const lastCandle = this.chartData[this.chartData.length - 1];
    if (!lastCandle) return;
    
    // Обновляем данные свечи
    lastCandle.close = price;
    if (price > lastCandle.high) lastCandle.high = price;
    if (price < lastCandle.low) lastCandle.low = price;
    
    const isBullish = price >= lastCandle.open;
    const lineColor = isBullish ? CONFIG.colors.bullish : CONFIG.colors.bearish;
    
    this.currentRealPrice = price;
    this._lastAppliedColor = lineColor;
    this.lastCandle = lastCandle;
    
    // Свеча на графике
    series.update({
        time: lastCandle.time,
        open: lastCandle.open,
        high: lastCandle.high,
        low: lastCandle.low,
        close: price
    });
    
    // Линия
    series.applyOptions({
        priceLineSource: price,
        priceLineColor: lineColor
    });
    
    // Таймер
    const prim = this.timerManager?._primitive;
    if (prim) {
        if (prim.setPrice) prim.setPrice(price);
        if (prim.setColor) prim.setColor(lineColor);
        if (prim.isEnabled()) prim.requestRedraw();
    }
    
    this.scheduleUpdatePosition();
    this._updatePageTitle(); // 👈 ОБНОВЛЯЕМ ЗАГОЛОВОК ВКЛАДКИ

     if (this.timerManager?.forceColorUpdate) {
        this.timerManager.forceColorUpdate();
    }
}
    autoScale() {
        if (this.chart && this.chartData.length > 0) {
            const timeScale = this.chart.timeScale();
            const visibleRange = timeScale.getVisibleLogicalRange();
            
            if (visibleRange) {
                const fromIndex = Math.max(0, Math.floor(visibleRange.from));
                const toIndex = Math.min(this.chartData.length - 1, Math.ceil(visibleRange.to));
                
                if (fromIndex < toIndex && fromIndex >= 0 && toIndex < this.chartData.length) {
                    let minPrice = Infinity, maxPrice = -Infinity;
                    
                    for (let i = fromIndex; i <= toIndex; i++) {
                        minPrice = Math.min(minPrice, this.chartData[i].low);
                        maxPrice = Math.max(maxPrice, this.chartData[i].high);
                    }
                    
                    const padding = (maxPrice - minPrice) * 0.05;
                    
                    const priceScale = this.chart.priceScale('right');
                    if (priceScale) {
                        priceScale.applyOptions({
                            autoScale: true,
                        });
                        
                        setTimeout(() => {
                            priceScale.applyOptions({
                                autoScale: true,
                            });
                        }, 10);
                    }
                    
                    setTimeout(() => {
                        if (this.timerManager && this.timerManager._primitive) {
                            this.timerManager._primitive.requestRedraw();
                        }
                    }, 50);
                }
            } else {
                const priceScale = this.chart.priceScale('right');
                if (priceScale) {
                    priceScale.applyOptions({
                        autoScale: true,
                    });
                }
            }
        }
    }

    getLastCandle() {
        return this.lastCandle;
    }
    
    getChart() {
        return this.chart;
    }
    
    setCurrentInterval(interval) {
        this.currentInterval = interval;
    }

    _updateMainChartHeight() {
        if (!this.chart) return;
        
        const chartContainer = document.getElementById('chart-container');
        const panelsContainer = document.getElementById('indicator-panels-container');
        
        if (!chartContainer) return;

        const availableHeight = window.innerHeight - 48;
        const panelsHeight = panelsContainer ? panelsContainer.offsetHeight : 0;
        let newChartHeight = availableHeight - panelsHeight;
        
        if (newChartHeight < 200) newChartHeight = 200;
        
        chartContainer.style.height = newChartHeight + 'px';
        chartContainer.style.maxHeight = newChartHeight + 'px';
        
        if (panelsContainer) {
            panelsContainer.style.position = 'absolute';
            panelsContainer.style.top = newChartHeight + 'px';
            panelsContainer.style.bottom = 'auto';
        }
        
        const width = chartContainer.clientWidth;
        this.chart.resize(width, newChartHeight);
        
        const volumeScale = this.chart.priceScale('volume');
        if (volumeScale) {
            volumeScale.applyOptions({
                scaleMargins: { top: 0.7, bottom: 0 }
            });
        }
    }

    _resizeIndicatorPanels() {
        const chartContainer = document.getElementById('chart-container');
        if (!chartContainer) return;
        
        const width = chartContainer.clientWidth;
        
        if (this.indicatorManager && this.indicatorManager.panelManager) {
            this.indicatorManager.panelManager.resize(width);
            this._updateMainChartHeight();
        }
    }

    addIndicator(type) {
        const result = this.indicatorManager.addIndicator(type);
        setTimeout(() => {
            this._updateMainChartHeight();
        }, 50);
        return result;
    }

    removeIndicatorByType(type) {
        return this.indicatorManager.removeIndicator(type);
    }

    clearAllIndicators() {
        this.indicatorManager.clearAllIndicators();
    }

    updateAllIndicators() {
        this.indicatorManager.updateAllIndicators();
    }

    restoreIndicators() {
        this.indicatorManager.loadIndicators();
    }

   async _syncAfterHidden() {
    if (!this.chartData.length) return;

    const lastCandle = this.chartData[this.chartData.length - 1];
    const nowSec = Math.floor(Date.now() / 1000);

    const intervalSeconds = {
        '1m': 60, '3m': 180, '5m': 300, '15m': 900,
        '30m': 1800, '1h': 3600, '4h': 14400, '6h': 21600,
        '12h': 43200, '1d': 86400, '1w': 604800, '1M': 2592000
    }[this.currentInterval] || 3600;

    // 1. Если гэпа нет — просто обновляем таймер и рисунки
    if (nowSec - lastCandle.time < intervalSeconds * 1.5) {
        if (this.timerManager?._primitive) {
            this.timerManager._primitive.requestRedraw();
        }
        this.scheduleDrawingsUpdate();
        return;
    }

    // 2. Гэп большой — загружаем пропущенные свечи
    console.log('🔄 Обнаружен гэп, загружаем пропущенные свечи...');
    try {
        const freshCandles = await this.fetchKlines(
            this.currentSymbol,
            this.currentExchange,
            this.currentMarketType,
            this.currentInterval,
            1000
        );

        if (freshCandles && freshCandles.length > 0) {
            const newCandles = freshCandles.filter(c => c.time > lastCandle.time);
            if (newCandles.length > 0) {
                // Добавляем новые свечи
                for (const candle of newCandles) {
                    if (!this.chartData.some(c => c.time === candle.time)) {
                        this.chartData.push(candle);
                    }
                }
                this.chartData.sort((a, b) => a.time - b.time);
                this.lastCandle = this.chartData[this.chartData.length - 1];
                
                // 3. Полная перерисовка свечей
                this.candleSeries.setData(this.chartData);
                this.barSeries.setData(this.chartData);
                
                // 4. Обновляем объёмы
                if (this.volumeSeries) {
                    const volumeData = this.chartData.map(c => ({
                        time: c.time,
                        value: c.volume || 0,
                        color: c.close >= c.open ? this.bullishColor : this.bearishColor
                    }));
                    this.volumeSeries.setData(volumeData);
                }
                
                // 5. Обновляем индикаторы
                if (this.indicatorManager) {
                    this.indicatorManager.updateAllIndicators();
                }
                
                console.log(`✅ Добавлено ${newCandles.length} пропущенных свечей`);
            }
        }
        
        // 6. Запускаем подгрузку истории (бесконечный скролл)
        this.hasMoreData = true;
        this.isLoadingMore = false;
        
    } catch (e) {
        console.warn('⚠️ Ошибка при синхронизации после скрытия:', e);
    }

    // 7. Обновляем таймер и рисунки
    if (this.timerManager?._primitive) {
        this.timerManager._primitive.requestRedraw();
    }
    this.scheduleDrawingsUpdate();
}
    _saveZoomState() {
        const timeScale = this.chart.timeScale();
        if (!timeScale) return;
        
        const visibleRange = timeScale.getVisibleLogicalRange();
        if (visibleRange) {
            this._savedZoomRange = {
                from: visibleRange.from,
                to: visibleRange.to
            };
            console.log('💾 Масштаб сохранён:', this._savedZoomRange);
        }
    }

    _restoreZoomState() {
        if (!this._savedZoomRange) return;
        
        const timeScale = this.chart.timeScale();
        if (!timeScale) return;
        
        const dataLength = this.chartData.length;
        const savedFrom = this._savedZoomRange.from;
        const savedTo = this._savedZoomRange.to;
        const savedLength = savedTo - savedFrom;
        
        if (savedFrom >= dataLength) {
            timeScale.setVisibleLogicalRange({
                from: Math.max(0, dataLength - savedLength),
                to: dataLength
            });
        } else {
            timeScale.setVisibleLogicalRange({
                from: savedFrom,
                to: Math.min(dataLength, savedTo)
            });
        }
        
        this._savedZoomRange = null;
    }

_subscribeToPrice() {
    if (!this.priceManager) {
        setTimeout(() => this._subscribeToPrice(), 100);
        return;
    }
    
    if (this._priceUpdateHandler) {
        this.priceManager.unsubscribe(this.currentSymbol, this._priceUpdateHandler);
        this._priceUpdateHandler = null;
    }
    
    this._priceUpdateHandler = (price, symbol) => {
        if (document.hidden || this._switchingSymbol) return;
        if (symbol !== this.currentSymbol) return;
        this._syncPriceLine(price);
    };
    
    this.priceManager.subscribe(this.currentSymbol, this._priceUpdateHandler);
    
    const cachedPrice = this.priceManager.getPrice(this.currentSymbol);
    if (cachedPrice !== null) {
        this.currentRealPrice = cachedPrice;
        
        // ✅ УСТАНАВЛИВАЕМ ЦВЕТ СРАЗУ ПОСЛЕ ПОЛУЧЕНИЯ КЕШИРОВАННОЙ ЦЕНЫ
        if (this.chartData && this.chartData.length > 0) {
            const lastCandle = this.chartData[this.chartData.length - 1];
            if (lastCandle) {
                const isBullish = cachedPrice >= lastCandle.open;
                this._lastAppliedColor = isBullish 
                    ? (this.bullishColor || CONFIG?.colors?.bullish || '#26a69a')
                    : (this.bearishColor || CONFIG?.colors?.bearish || '#ef5350');
            }
        }
        
        // ✅ ПРИНУДИТЕЛЬНО ОБНОВЛЯЕМ ТАЙМЕР
        if (this.timerManager?.forceColorUpdate) {
            this.timerManager.forceColorUpdate();
        }
    }
}
    setSymbol(symbol) {
        if (this.currentSymbol === symbol) return;
        
        const oldSymbol = this.currentSymbol;
        
        if (this.priceManager && this._priceUpdateHandler) {
            this.priceManager.unsubscribe(oldSymbol, this._priceUpdateHandler);
            this._priceUpdateHandler = null;
        }
        
        this.currentSymbol = symbol;
        this._subscribeToPrice();
    }

    _inferPrecisionFromData() {
        if (!this.chartData || this.chartData.length === 0) return 2;
        const lastPrice = this.chartData[this.chartData.length - 1].close;
        if (!lastPrice || lastPrice === 0) return 2;
        
        const str = lastPrice.toString();
        if (str.includes('.')) {
            const decimals = str.split('.')[1].length;
            return Math.min(decimals, 8);
        }
        return 2;
    }

    applyPriceFormat(precision) {
        try {
            if (precision === null || precision === undefined || isNaN(precision) || precision < 0) {
                console.warn('⚠️ Precision не получен, вычисляем из данных графика...');
                precision = this._inferPrecisionFromData();
            }

            const minMove = Math.pow(10, -precision);
            const priceFormat = { type: 'price', precision: precision, minMove: minMove };

            if (this.candleSeries) this.candleSeries.applyOptions({ priceFormat });
            if (this.barSeries) this.barSeries.applyOptions({ priceFormat });

            const priceScale = this.chart.priceScale('right');
            if (priceScale) {
                priceScale.applyOptions({ 
                    priceFormat: priceFormat,
                    autoScale: true 
                });
            }

            console.log(`✅ Формат цены применен: ${precision} знаков`);
            return precision;

        } catch (error) {
            console.error('❌ КРИТИЧЕСКАЯ ОШИБКА applyPriceFormat:', error);
            return this._inferPrecisionFromData();
        }
    }

    _isValidCandle(candle) {
        if (!candle || typeof candle !== 'object') return false;
        
        if (typeof candle.time !== 'number' || isNaN(candle.time) || candle.time <= 0) {
            return false;
        }
        
        const ohlcFields = ['open', 'high', 'low', 'close'];
        for (const field of ohlcFields) {
            const val = candle[field];
            if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) {
                return false;
            }
        }
        
        if (candle.high < candle.low) return false;
        
        if (candle.open > candle.high || candle.open < candle.low ||
            candle.close > candle.high || candle.close < candle.low) {
            return false;
        }
        
        if (candle.volume !== undefined && candle.volume !== null) {
            if (typeof candle.volume !== 'number' || isNaN(candle.volume) || candle.volume < 0) {
                return false;
            }
        }
        
        return true;
    }

    _sanitizeCandle(candle) {
        if (!candle) return null;
        
        const clean = { ...candle };
        const fields = ['open', 'high', 'low', 'close'];
        
        const validValues = fields.filter(f => 
            typeof clean[f] === 'number' && !isNaN(clean[f]) && isFinite(clean[f])
        );
        
        if (validValues.length === 0) return null;
        
        const avgValue = validValues.reduce((s, f) => s + clean[f], 0) / validValues.length;
        
        for (const field of fields) {
            if (typeof clean[field] !== 'number' || isNaN(clean[field]) || !isFinite(clean[field])) {
                clean[field] = avgValue;
            }
        }
        
        if (typeof clean.volume !== 'number' || isNaN(clean.volume) || clean.volume < 0) {
            clean.volume = 0;
        }
        
        const ohlc = [clean.open, clean.high, clean.low, clean.close];
        clean.high = Math.max(...ohlc);
        clean.low = Math.min(...ohlc);
        
        return clean;
    }
// В класс ChartManager добавь:
_createNewCandle(candle) {
    if (!candle || !candle.time) return;
    
    // Проверяем, существует ли уже такая свеча
    const exists = this.chartData.some(c => c.time === candle.time);
    if (exists) return;
    
    const lastCandle = this.chartData[this.chartData.length - 1];
    if (lastCandle && candle.time <= lastCandle.time) return;
    
    // Добавляем новую свечу
    this.chartData.push(candle);
    
    // Обрезаем старые если нужно
    const limit = CONFIG.klineLimits?.[this.currentInterval] || 1000;
    if (this.chartData.length > limit) {
        this.chartData.shift();
    }
    
    this.lastCandle = candle;
    this.currentRealPrice = candle.close;
    
    // Обновляем график
    const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
    if (series) {
        series.setData(this.chartData);
    }
    
    // Обновляем volume
    if (this.volumeSeries) {
        const volumeData = this.chartData.map(c => ({
            time: c.time,
            value: c.volume || 0,
            color: c.close >= c.open ? this.bullishColor : this.bearishColor
        }));
        this.volumeSeries.setData(volumeData);
    }
    
    // Перезапускаем таймер
    if (this.timerManager) {
        this.timerManager.start(this.currentInterval);
    }
    
    console.log('🕯️ Новая свеча создана:', new Date(candle.time * 1000).toISOString());
}
  async fetchKlines(symbol, exchange, marketType, interval, limit = 1000) {
    // Ждём только предыдущий fetchKlines, но не тикеры
    while (ChartManager._fetchInProgress) {
        await new Promise(r => setTimeout(r, 100));
    }
    ChartManager._fetchInProgress = true;
    
    // Отменяем предыдущий (если завис)
    if (this._currentFetchController) {
        this._currentFetchController.abort();
    }
    this._currentFetchController = new AbortController();

    const bybitIntervalMap = {
        '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
        '1h': '60', '4h': '240', '6h': '360', '12h': '720',
        '1d': 'D', '1w': 'W', '1M': 'M'
    };

    let url;
    if (exchange === 'binance') {
        url = marketType === 'futures'
            ? `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
            : `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    } else {
        const bybitInt = bybitIntervalMap[interval] || interval;
        const cat = marketType === 'futures' ? 'linear' : 'spot';
        url = `https://api.bybit.com/v5/market/kline?category=${cat}&symbol=${symbol}&interval=${bybitInt}&limit=${limit}`;
    }

    try {
        const response = await fetch(url, { 
            signal: this._currentFetchController.signal
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        let rawCandles;
        
        if (exchange === 'binance') {
            rawCandles = data.map(item => ({
                time: Math.floor(item[0] / 1000),
                open: parseFloat(item[1]),
                high: parseFloat(item[2]),
                low: parseFloat(item[3]),
                close: parseFloat(item[4]),
                volume: parseFloat(item[5]),
                quoteVolume: parseFloat(item[7])
            }));
        } else {
            if (data.retCode !== 0) throw new Error(data.retMsg);
            rawCandles = data.result.list.map(item => ({
                time: Math.floor(parseInt(item[0]) / 1000),
                open: parseFloat(item[1]),
                high: parseFloat(item[2]),
                low: parseFloat(item[3]),
                close: parseFloat(item[4]),
                volume: parseFloat(item[5] || 0),
                quoteVolume: parseFloat(item[6] || 0)
            })).filter(c => c !== null).reverse();
        }
        
        const beforeCount = rawCandles.length;
        
        const seenTimes = new Set();
        const noDupes = rawCandles.filter(c => {
            if (seenTimes.has(c.time)) return false;
            seenTimes.add(c.time);
            return true;
        });
        
        const validCandles = noDupes.filter(c => this._isValidCandle(c));
        
        const removedCount = beforeCount - validCandles.length;
        if (removedCount > 0) {
            console.warn(`⚠️ fetchKlines: отфильтровано ${removedCount} битых/дублей из ${beforeCount}`);
        }
        
        validCandles.sort((a, b) => a.time - b.time);
        
        return validCandles;
        
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('🛑 fetchKlines прерван (переключение символа)');
        } else {
            console.error('❌ Ошибка fetchKlines:', error);
        }
        return [];
    } finally {
        this._currentFetchController = null;
        ChartManager._fetchInProgress = false;
    }
}
   _updatePageTitle() {
    const symbol = this.currentSymbol || '';
    
    // Берём цену из lastCandle если currentRealPrice ещё нет
    let price = this.currentRealPrice;
    if (!price && this.lastCandle) {
        price = this.lastCandle.close;
    }
    if (!price && this.chartData?.length > 0) {
        price = this.chartData[this.chartData.length - 1].close;
    }
    
    if (!symbol) {
        document.title = 'График';
        return;
    }
    
    if (price != null && !isNaN(price) && price > 0) {
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        const precision = series?.options()?.priceFormat?.precision || 2;
        const lastCandle = this.chartData?.[this.chartData.length - 1];
        const isBullish = lastCandle ? lastCandle.close >= lastCandle.open : true;
        const arrow = isBullish ? '▲' : '▼';
        document.title = `${arrow} ${symbol} ${price.toFixed(precision)}`;
    } else {
        document.title = `${symbol}`;
    }
}

    // ============================================================
    //  НОВЫЕ МЕТОДЫ: switchSymbol + _abortAllProcesses
    // ============================================================
async switchSymbol(symbol, exchange, marketType) {
    if (this._switchingSymbol) {
        console.warn('⚠️ Переключение уже выполняется, игнорируем');
        return;
    }
    this._switchingSymbol = true;

    try {
        console.log(`🔄 ПЕРЕКЛЮЧЕНИЕ: ${this.currentSymbol} → ${symbol}`);

        this._abortAllProcesses();

        this.candleSeries.setData([]);
        this.barSeries.setData([]);
        if (this.volumeSeries) this.volumeSeries.setData([]);
        this.chartData = [];
        this.lastCandle = null;
        this.currentRealPrice = null;
        this._lastAppliedColor = null;

        this.currentSymbol = symbol;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;
        
        // Заранее спрашиваем у биржи точность
        getPrecisionFromExchange(symbol, exchange, marketType).then(p => {
            localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, p);
        }).catch(() => {});
        
        const candles = await this.fetchKlines(symbol, exchange, marketType, this.currentInterval, 1000);

        if (!candles || candles.length === 0) {
            throw new Error('Нет данных для ' + symbol);
        }

        this.setDataQuick(candles, this.currentInterval, symbol, exchange, marketType);

        this._subscribeToPrice();

        await this.loadDrawingsForCurrentSymbol();

        if (this.timerManager) {
            this.timerManager.destroy();
            this.timerManager.start(this.currentInterval);
        }

        localStorage.setItem('lastSymbol', symbol);
        localStorage.setItem('lastExchange', exchange);
        localStorage.setItem('lastMarketType', marketType);

        console.log(`✅ Переключено: ${symbol} (${exchange}, ${marketType})`);

        // ✅✅✅ ПРИНУДИТЕЛЬНОЕ ОБНОВЛЕНИЕ ЦВЕТА ТАЙМЕРА ✅✅✅
        // Даём время на отрисовку свечей и получение первой цены
        setTimeout(() => {
            // Определяем цвет по последней свече
            if (this.chartData && this.chartData.length > 0) {
                const lastCandle = this.chartData[this.chartData.length - 1];
                if (lastCandle) {
                    const isBullish = lastCandle.close >= lastCandle.open;
                    this._lastAppliedColor = isBullish 
                        ? (this.bullishColor || CONFIG?.colors?.bullish || '#26a69a')
                        : (this.bearishColor || CONFIG?.colors?.bearish || '#ef5350');
                }
            }
            
            // Обновляем таймер
            if (this.timerManager?.forceColorUpdate) {
                this.timerManager.forceColorUpdate();
            } else if (this.timerManager?._syncColorFromChartManager) {
                this.timerManager._syncColorFromChartManager();
            } else if (this.timerManager?._primitive?._paneView?._renderer) {
                this.timerManager._primitive._paneView._renderer._cachedColor = this._lastAppliedColor;
                if (this.timerManager._primitive.isEnabled()) {
                    this.timerManager._primitive.requestRedraw();
                }
            }
        }, 300);

        // ✅✅✅ ПОВТОРНАЯ СИНХРОНИЗАЦИЯ ПОСЛЕ ПОЛУЧЕНИЯ ЦЕНЫ ✅✅✅
        setTimeout(() => {
            if (this.timerManager?.forceColorUpdate) {
                this.timerManager.forceColorUpdate();
            }
        }, 1500);

        this._notifySymbolChange();

    } catch (error) {
        console.error('❌ Ошибка переключения:', error);
    } finally {
        this._switchingSymbol = false;
    }
}
    _abortAllProcesses() {
        if (this.priceManager && this._priceUpdateHandler) {
            this.priceManager.unsubscribe(this.currentSymbol, this._priceUpdateHandler);
            this._priceUpdateHandler = null;
        }

        if (this.timerManager) {
            this.timerManager.destroy();
        }

        this._loadingSymbol = false;
        this.isLoadingMore = false;
        this._updateScheduled = false;
        this._pendingUpdates = false;
        this._pendingRedraw = false;

        if (this._drawingsUpdateRafId) {
            cancelAnimationFrame(this._drawingsUpdateRafId);
            this._drawingsUpdateRafId = null;
        }
        if (this._updatePositionRafId) {
            cancelAnimationFrame(this._updatePositionRafId);
            this._updatePositionRafId = null;
        }

        if (this._currentFetchController) {
            this._currentFetchController.abort();
            this._currentFetchController = null;
        }

        if (this._updateTimeout) {
            clearTimeout(this._updateTimeout);
            this._updateTimeout = null;
        }

        

        console.log('🛑 Все старые процессы прерваны');
    }
}

if (typeof window !== 'undefined') {
    window.ChartManager = ChartManager;
}
