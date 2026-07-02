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
        this._priceSubscriptionKey = null;
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
        this._userScrolledManually = false;
        this.candleTimeMap = new Map();
        
        this._visibilityHandler = () => {
            if (!document.hidden) {
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
                rightOffset: 5,
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
            priceLineSource: 0,
            priceLineColor: '#00bcd4',
            priceLineWidth: 1,
            priceLineStyle: LightweightCharts.LineStyle.Dashed
        });

        this.barSeries.applyOptions({
            priceLineVisible: true,
            lastValueVisible: true,
            priceLineSource: 0,
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
            } catch (e) {
                console.warn('⚠️ Не удалось создать Volume:', e);
                this.volumeSeries = null;
            }
        } else {
            console.warn('⚠️ LightweightCharts не загружен');
            this.volumeSeries = null;
        }

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
        })();
     
        this._setupPanelsSync();
        this._startRedrawLoop();
        this._startNewCandleChecker();

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
            if (price !== null && !isNaN(price)) return price;
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
            
            let aligned;
            if (this.currentInterval === '1w') {
                const now = new Date(nowSec * 1000);
                const dayOfWeek = now.getUTCDay();
                const daysToMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7;
                const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysToMonday));
                aligned = Math.floor(monday.getTime() / 1000);
            } else if (this.currentInterval === '1M') {
                const now = new Date(nowSec * 1000);
                const firstDayOfNextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
                aligned = Math.floor(firstDayOfNextMonth.getTime() / 1000);
            } else {
                aligned = Math.floor(nowSec / step) * step;
            }
            
            const last = this.chartData[this.chartData.length - 1];
            
            if (last && aligned > last.time && aligned <= nowSec) {
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

        function syncCrosshairToPanels(param) {
            if (!mainChart || !param) return;
            const panels = window.chartManager?.indicatorManager?.panelManager?.panels;
            if (!panels) return;

            if (!param.time || !param.point) {
                panels.forEach(p => p.chart?.clearCrosshairPosition());
                return;
            }

            panels.forEach((panel) => {
                if (!panel.chart || panel.isCollapsed) return;
                try { panel.chart.setCrosshairPosition(param.time, param.point.y, param.point.x); } catch(e) {}
            });
        }

        let crosshairPending = false;
        mainChart.subscribeCrosshairMove((param) => {
            if (!crosshairPending) {
                crosshairPending = true;
                requestAnimationFrame(() => {
                    syncCrosshairToPanels(param);
                    crosshairPending = false;
                });
            }
        });
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
            const range = this.chart.timeScale().getVisibleLogicalRange();
            if (range && this.chartData.length > 0) {
                const lastIndex = this.chartData.length - 1;
                const visibleEnd = Math.floor(range.to);
                this._userScrolledManually = (lastIndex - visibleEnd) > 10;
            }
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

    async saveCandlesToCache(symbol, exchange, marketType, interval, candles) {
        if (!candles || candles.length === 0 || !window.db) return;
        const CACHE_VERSION = '2';
        const key = `${symbol}_${interval}_${exchange}_${marketType}_v${CACHE_VERSION}`;
        const cacheData = {
            key, symbol, exchange, marketType, interval,
            data: candles,
            lastUpdate: Date.now(),
            firstCandleTime: candles[0].time,
            lastCandleTime: candles[candles.length - 1].time,
            count: candles.length,
            version: CACHE_VERSION
        };
        try {
            await window.db.put('candles', cacheData);
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
            if (!cached || cached.version !== CACHE_VERSION || Date.now() - cached.lastUpdate > 300000) return null;
            return cached.data;
        } catch (error) {
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
                }
            }
        } catch (e) {}
    }

    async clearOldCandlesCache(maxAge = 86400000) {
        try {
            const allCandles = await window.db.getAll('candles');
            const now = Date.now();
            for (const cached of allCandles) {
                if (now - cached.lastUpdate > maxAge) {
                    await window.db.delete('candles', cached.key);
                }
            }
        } catch (error) {}
    }

    async waitForReady() {
        let attempts = 0;
        while (attempts < 50) {
            if (this.chart && this.candleSeries && this.chartData && this.chartData.length > 0 && this.chart.timeScale()?.getVisibleRange()) {
                return true;
            }
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }
        return false;
    }

    async waitForSeriesReady() {
        return this.waitForReady();
    }

    timeToCoordinate(time) {
        try { return this.chart.timeScale().timeToCoordinate(time); } catch (e) { return null; }
    }

    coordinateToTime(coordinate) {
        try { return this.chart.timeScale().coordinateToTime(coordinate); } catch (e) { return null; }
    }

    priceToCoordinate(price) {
        try {
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            return series.priceToCoordinate(price);
        } catch (e) { return null; }
    }

    timeToCoordinateWithFallback(time) {
        let coord = this.timeToCoordinate(time);
        if (coord !== null) return coord;
        const data = this.chartData;
        if (!data || !data.length) return null;
        const firstCandle = data[0], lastCandle = data[data.length - 1];
        const firstX = this.timeToCoordinate(firstCandle.time), lastX = this.timeToCoordinate(lastCandle.time);
        if (firstX === null || lastX === null) return null;
        const pixelsPerMs = (lastX - firstX) / (lastCandle.time - firstCandle.time);
        return time < firstCandle.time ? firstX - (firstCandle.time - time) * pixelsPerMs : lastX + (time - lastCandle.time) * pixelsPerMs;
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
        const firstValue = priceScale.priceToCoordinate(0), lastValue = priceScale.priceToCoordinate(height);
        if (firstValue === null || lastValue === null) return null;
        const minPrice = Math.min(firstValue, lastValue), maxPrice = Math.max(firstValue, lastValue);
        const pixelsPerUnit = height / (maxPrice - minPrice);
        return price < minPrice ? 0 - (minPrice - price) * pixelsPerUnit : height + (price - maxPrice) * pixelsPerUnit;
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
        } catch (e) { return null; }
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
        if (Math.floor(range.from) < 70 && this.hasMoreData && !this.isLoadingMore) {
            this.loadMoreHistoricalData();
        }
    }
    
    async loadMoreHistoricalData() {
        if (this.isLoadingMore || !this.hasMoreData || !this.chartData.length) return;
        this.isLoadingMore = true;
        try {
            const oldestCandle = this.chartData[0];
            if (!oldestCandle) { this.isLoadingMore = false; return; }
            const endTime = (oldestCandle.time * 1000) - 1;
            const olderCandles = await DataFetcher.loadMoreKlines(this.currentSymbol, this.currentInterval, endTime);
            if (olderCandles && olderCandles.length > 0) {
                const uniqueOlder = olderCandles.filter(newCandle => !this.chartData.some(existing => existing.time === newCandle.time));
                if (uniqueOlder.length > 0) {
                    this.chartData = [...uniqueOlder, ...this.chartData];
                    this._rebuildCandleMap();
                    this.candleSeries.setData(this.chartData);
                    this.barSeries.setData(this.chartData);
                    if (this.volumeSeries) {
                        const volumeData = this.chartData.map(c => ({
                            time: c.time, value: c.volume || 0,
                            color: c.close >= c.open ? this.bullishColor : this.bearishColor
                        }));
                        this.volumeSeries.setData(volumeData);
                    }
                    if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
                }
                if (olderCandles.length < 1000) this.hasMoreData = false;
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
        try {
            const bybitIntervalMap = {
                '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
                '1h': '60', '4h': '240', '6h': '360', '12h': '720',
                '1d': 'D', '1w': 'W', '1M': 'M'
            };
            let url, limit = 100;
            if (exchange === 'binance') {
                url = marketType === 'futures'
                    ? `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
                    : `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
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
                    time: Math.floor(item[0] / 1000), open: parseFloat(item[1]),
                    high: parseFloat(item[2]), low: parseFloat(item[3]),
                    close: parseFloat(item[4]), volume: parseFloat(item[5]),
                    quoteVolume: parseFloat(item[7])
                }));
            } else {
                if (data.retCode !== 0 || !data.result?.list) return;
                freshCandles = data.result.list.map(item => ({
                    time: Math.floor(parseInt(item[0]) / 1000), open: parseFloat(item[1]),
                    high: parseFloat(item[2]), low: parseFloat(item[3]),
                    close: parseFloat(item[4]), volume: parseFloat(item[5] || 0),
                    quoteVolume: parseFloat(item[6] || 0)
                })).filter(c => c !== null);
            }
            if (freshCandles.length === 0) return;
            const lastCachedTime = this.chartData.length > 0 ? this.chartData[this.chartData.length - 1].time : 0;
            const lastFreshTime = freshCandles[freshCandles.length - 1].time;
            if (lastFreshTime > lastCachedTime) {
                const newCandles = freshCandles.filter(c => c.time > lastCachedTime);
                this.chartData.push(...newCandles);
                this._performUpdate();
                if (!this._userScrolledManually) this.scrollToLast();
            }
        } catch (error) {}
    }
    
    setupEventListeners() {
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (this.chart) {
                    const width = this.chartContainer.clientWidth, height = this.chartContainer.clientHeight;
                    this.chart.applyOptions({ width, height });
                    if (this._resizeIndicatorPanels) this._resizeIndicatorPanels();
                    if (this._updateMainChartHeight) this._updateMainChartHeight();
                }
                if (this.timerManager?._primitive) this.timerManager._primitive.requestRedraw();
                this.scheduleDrawingsUpdate();
            }, 100);
        });
    }
    
    setChartType(type) {
        if (!this.chart) return;
        this.currentChartType = type;
        localStorage.setItem('chartType', type);
        if (type === 'candle') {
            if (this.candleSeries) this.candleSeries.applyOptions({ visible: true });
            if (this.barSeries) this.barSeries.applyOptions({ visible: false });
        } else if (type === 'bar') {
            if (this.candleSeries) this.candleSeries.applyOptions({ visible: false });
            if (this.barSeries) this.barSeries.applyOptions({ visible: true });
        }
        if (this.timerManager?.reattach) this.timerManager.reattach();
        if (this.indicatorManager?.activeIndicators) {
            this.indicatorManager.activeIndicators.forEach(indicator => {
                try { indicator.createSeries(); } catch (e) {}
            });
        }
        setTimeout(() => {
            window.rayManager?.syncWithNewTimeframe();
            window.trendLineManager?.syncWithNewTimeframe();
            window.rulerLineManager?.syncWithNewTimeframe();
            window.alertLineManager?.syncWithNewTimeframe();
            window.textManager?.syncWithNewTimeframe();
        }, 50);
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
            topPosition = Math.max(5, Math.min(window.innerHeight - this.priceLineTimer.offsetHeight - 5, topPosition));
            this.priceLineTimer.style.top = topPosition + 'px';
            this.priceLineTimer.style.right = '10px';
        }
    }

    _performUpdate() {
        if (!this.chartData.length) return;
        const cachedPrecision = localStorage.getItem(`precision_${this.currentSymbol}_${this.currentExchange}_${this.currentMarketType}`);
        if (cachedPrecision) this.applyPriceFormat(parseInt(cachedPrecision));
        else this.applyPriceFormat(this._inferPrecisionFromData());
        
        this.candleSeries.setData(this.chartData);
        this.barSeries.setData(this.chartData);
        if (this.indicatorManager) this.indicatorManager.updateAllIndicators();

        const lastCandle = this.chartData[this.chartData.length - 1];
        const price = this.getCurrentPrice() ?? this.currentRealPrice;
        if (price !== null) this._syncPriceLine(price);
        if (this.timerManager) this.timerManager.start(this.currentInterval);
        this.scheduleUpdatePosition();
    }
    
    updateLastCandle(candle) {
        if (!candle || typeof candle.time !== 'number' || isNaN(candle.time) || candle.time <= 0) return;
        try {
            if (!this._isValidCandle(candle)) {
                const sanitized = this._sanitizeCandle(candle);
                if (!sanitized) return;
                candle = sanitized;
            }
            const lastCandle = this.chartData[this.chartData.length - 1];
            const existingIndex = this.chartData.findIndex(c => c.time === candle.time);
            if (existingIndex !== -1) {
                this.chartData[existingIndex] = candle;
            } else if (!lastCandle || candle.time > lastCandle.time) {
                this.chartData.push(candle);
                const limit = CONFIG.klineLimits[this.currentInterval] || 1000;
                if (this.chartData.length > limit) this.chartData = this.chartData.slice(-limit);
            } else return;
            
            const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            if (activeSeries) {
                if (existingIndex !== -1 && existingIndex === this.chartData.length - 1) {
                    activeSeries.update({ time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
                } else {
                    activeSeries.setData(this.chartData);
                }
            }
            this.currentRealPrice = candle.close;
            this.lastCandle = candle;
            
            const isBullish = candle.close >= candle.open;
            const lineColor = isBullish ? CONFIG.colors.bullish : CONFIG.colors.bearish;
            if (activeSeries && this.currentRealPrice) {
                activeSeries.applyOptions({ priceLineSource: this.currentRealPrice, priceLineColor: lineColor });
            }
            if (this.timerManager?._primitive) {
                if (this.timerManager._primitive.setPrice) this.timerManager._primitive.setPrice(candle.close);
                if (this.timerManager._primitive.setColor) this.timerManager._primitive.setColor(lineColor);
                if (this.timerManager._primitive.isEnabled()) this.timerManager._primitive.requestRedraw();
            }
            if (this.scheduleUpdatePosition) this.scheduleUpdatePosition();
            if (this.volumeSeries && this.chartData.length > 0) {
                const volumeData = this.chartData.map(c => ({
                    time: c.time, value: c.volume || 0,
                    color: c.close >= c.open ? this.bullishColor : this.bearishColor
                }));
                this.volumeSeries.setData(volumeData);
            }
            this._rebuildCandleMap();
        } catch (e) {
            console.error('❌ Ошибка в updateLastCandle:', e);
        }
    }

    async waitForChartReady() {
        await new Promise(resolve => {
            const check = () => {
                if (this.chart?.timeScale()?.getVisibleRange()) resolve();
                else requestAnimationFrame(check);
            };
            check();
        });
        await new Promise(r => setTimeout(r, 50));
    }

    setDataQuick(data, interval, symbol, exchange = 'binance', marketType = 'futures') {
        if (data.length > 0) {
            if (this.candleSeries) this.candleSeries.setData([]);
            if (this.barSeries) this.barSeries.setData([]);
            if (this.volumeSeries) this.volumeSeries.setData([]);
            
            const seenTimes = new Set();
            data = data.filter(c => {
                if (!c || typeof c.time !== 'number' || isNaN(c.time)) return false;
                if (seenTimes.has(c.time)) return false;
                seenTimes.add(c.time);
                return true;
            }).filter(c => this._isValidCandle(c));
            
            if (data.length === 0) return;
            
            this.chartData = data;
            this._rebuildCandleMap();
            this.currentInterval = interval;
            this.currentSymbol = symbol;
            this.currentExchange = exchange;
            this.currentMarketType = marketType;
            this.hasMoreData = true;
            this.lastCandle = data[data.length - 1];
            
            const cachedPrecision = localStorage.getItem(`precision_${symbol}_${exchange}_${marketType}`);
            if (cachedPrecision) this.applyPriceFormat(parseInt(cachedPrecision));
            else {
                const inferredPrecision = this._inferPrecisionFromData();
                this.applyPriceFormat(inferredPrecision);
                localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, inferredPrecision);
            }
            
            this._performUpdate();
            this._updatePageTitle();
            
            if (this.volumeSeries && this.chartData.length > 0) {
                const volumeData = this.chartData.map(c => ({
                    time: c.time, value: c.volume || 0,
                    color: c.close >= c.open ? this.bullishColor : this.bearishColor
                }));
                this.volumeSeries.setData(volumeData);
            }
            
            if (this.indicatorManager) {
                this.indicatorManager.restorePendingIndicators();
                this.indicatorManager.updateAllIndicators();
                this.indicatorManager.loadIndicators();
            }
            
            getPrecisionFromExchange(symbol, exchange, marketType)
                .then(precision => {
                    localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, precision);
                    this.applyPriceFormat(precision);
                })
                .catch(() => {});
            
            requestAnimationFrame(() => {
                if (window.renderDrawings) window.renderDrawings();
                if (!this._userScrolledManually) this.scrollToLast();
            });
            
            this._notifySymbolChange();
        }
        this._lastTimeframe = interval;
        if (!window._dailySeparator) window._dailySeparator = new DailySeparator(this);
        else window._dailySeparator.redraw();
        if (!window._sessionHighlighter) window._sessionHighlighter = new SessionHighlighter(this);
    }
    
    async loadDrawingsForCurrentSymbol() {
        await new Promise(resolve => setTimeout(resolve, 100));
        await Promise.all([
            window.rayManager?.loadRays(),
            window.trendLineManager?.loadTrendLines(),
            window.rulerLineManager?.loadRulers(),
            window.alertLineManager?.loadAlerts(),
            window.textManager?.loadTexts()
        ].filter(Boolean));
    }

    onCrosshairMove(param) {
        if (!this.overlay) this.overlay = safeElement('candleStatsOverlay');
        if (!param || !param.time || !this.chartData || this.chartData.length === 0) {
            if (this.overlay) this.overlay.classList.remove('visible');
            return;
        }
        const candle = this.candleTimeMap.get(param.time);
        if (candle) {
            const isBullish = Utils.isBullish(candle.open, candle.close);
            const bullishClass = isBullish ? 'bullish' : 'bearish';
            if (this.openEl) { this.openEl.textContent = Utils.formatPrice(candle.open); this.openEl.className = `stat-value ${bullishClass}`; }
            if (this.highEl) { this.highEl.textContent = Utils.formatPrice(candle.high); this.highEl.className = `stat-value ${bullishClass}`; }
            if (this.lowEl) { this.lowEl.textContent = Utils.formatPrice(candle.low); this.lowEl.className = `stat-value ${bullishClass}`; }
            if (this.closeEl) { this.closeEl.textContent = Utils.formatPrice(candle.close); this.closeEl.className = `stat-value ${bullishClass}`; }
            if (this.changeEl) {
                const change = Utils.calculateChange(candle.open, candle.close);
                this.changeEl.textContent = (parseFloat(change) > 0 ? '+' : '') + change + '%';
                this.changeEl.className = `change-value ${bullishClass}`;
            }
            const volumeEl = document.getElementById('volumeValue');
            if (volumeEl) { volumeEl.textContent = Utils.formatVolume(candle.volume); volumeEl.className = `stat-value ${bullishClass}`; }
            if (this.overlay) this.overlay.classList.add('visible');
        } else {
            if (this.overlay) this.overlay.classList.remove('visible');
        }
    }
    
    updateRealPrice(price) {
        this._syncPriceLine(price);
    }
    
    scrollToLast() {
        if (this.chart && this.chartData.length > 0) {
            this.chart.timeScale().scrollToRealTime();
            this._userScrolledManually = false;
        }
    }
    
    clearChart() {
        if (this.candleSeries) this.candleSeries.setData([]);
        if (this.barSeries) this.barSeries.setData([]);
        if (this.volumeSeries) this.volumeSeries.setData([]);
        this.chartData = [];
        this.lastCandle = null;
        const priceScale = this.chart.priceScale('right');
        if (priceScale) priceScale.applyOptions({ autoScale: true });
    }
    
    _syncPriceLine(price) {
        if (!price) return;
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (!series) return;
        const lastCandle = this.chartData[this.chartData.length - 1];
        if (!lastCandle) return;
        lastCandle.close = price;
        if (price > lastCandle.high) lastCandle.high = price;
        if (price < lastCandle.low) lastCandle.low = price;
        
        const isBullish = price >= lastCandle.open;
        const lineColor = isBullish ? (this.bullishColor || CONFIG.colors.bullish) : (this.bearishColor || CONFIG.colors.bearish);
        this.currentRealPrice = price;
        this._lastAppliedColor = lineColor;
        this.lastCandle = lastCandle;
        
        series.update({ time: lastCandle.time, open: lastCandle.open, high: lastCandle.high, low: lastCandle.low, close: price });
        series.applyOptions({ priceLineSource: price, priceLineColor: lineColor });
        
        const prim = this.timerManager?._primitive;
        if (prim) {
            if (prim.setPrice) prim.setPrice(price);
            if (prim.setColor) prim.setColor(lineColor);
            if (prim.isEnabled()) prim.requestRedraw();
        }
        this.scheduleUpdatePosition();
        this._updatePageTitle();
    }
    
    autoScale() {
        if (this.chart && this.chartData.length > 0) {
            const priceScale = this.chart.priceScale('right');
            if (priceScale) {
                priceScale.applyOptions({ autoScale: true });
            }
        }
    }
    
    _rebuildCandleMap() {
        this.candleTimeMap.clear();
        for (const c of this.chartData) this.candleTimeMap.set(c.time, c);
    }
    
    getLastCandle() { return this.lastCandle; }
    getChart() { return this.chart; }
    setCurrentInterval(interval) { this.currentInterval = interval; }

    _updateMainChartHeight() {
        if (!this.chart) return;
        const chartContainer = document.getElementById('chart-container');
        const panelsContainer = document.getElementById('indicator-panels-container');
        if (!chartContainer) return;
        const availableHeight = window.innerHeight - 48;
        const panelsHeight = panelsContainer ? panelsContainer.offsetHeight : 0;
        let newChartHeight = Math.max(200, availableHeight - panelsHeight);
        chartContainer.style.height = newChartHeight + 'px';
        chartContainer.style.maxHeight = newChartHeight + 'px';
        if (panelsContainer) {
            panelsContainer.style.position = 'absolute';
            panelsContainer.style.top = newChartHeight + 'px';
            panelsContainer.style.bottom = 'auto';
        }
        this.chart.resize(chartContainer.clientWidth, newChartHeight);
    }

    _resizeIndicatorPanels() {
        const chartContainer = document.getElementById('chart-container');
        if (!chartContainer) return;
        if (this.indicatorManager?.panelManager) {
            this.indicatorManager.panelManager.resize(chartContainer.clientWidth);
            this._updateMainChartHeight();
        }
    }

    addIndicator(type) {
        const result = this.indicatorManager.addIndicator(type);
        setTimeout(() => this._updateMainChartHeight(), 50);
        return result;
    }

    removeIndicatorByType(type) { return this.indicatorManager.removeIndicator(type); }
    clearAllIndicators() { this.indicatorManager.clearAllIndicators(); }
    updateAllIndicators() { this.indicatorManager.updateAllIndicators(); }
    restoreIndicators() { this.indicatorManager.loadIndicators(); }

    async _syncAfterHidden() {
        if (!this.chartData.length) return;
        const lastCandle = this.chartData[this.chartData.length - 1];
        const nowSec = Math.floor(Date.now() / 1000);
        const intervalSeconds = {
            '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
            '1h': 3600, '4h': 14400, '6h': 21600, '12h': 43200,
            '1d': 86400, '1w': 604800, '1M': 2592000
        }[this.currentInterval] || 3600;

        if (nowSec - lastCandle.time < intervalSeconds * 1.5) {
            if (this.timerManager?._primitive) this.timerManager._primitive.requestRedraw();
            this.scheduleDrawingsUpdate();
            return;
        }

        try {
            const freshCandles = await this.fetchKlines(this.currentSymbol, this.currentExchange, this.currentMarketType, this.currentInterval, 1000);
            if (freshCandles && freshCandles.length > 0) {
                const newCandles = freshCandles.filter(c => c.time > lastCandle.time);
                if (newCandles.length > 0) {
                    for (const candle of newCandles) {
                        if (!this.chartData.some(c => c.time === candle.time)) this.chartData.push(candle);
                    }
                    this.chartData.sort((a, b) => a.time - b.time);
                    this.lastCandle = this.chartData[this.chartData.length - 1];
                    this.candleSeries.setData(this.chartData);
                    this.barSeries.setData(this.chartData);
                    if (this.volumeSeries) {
                        const volumeData = this.chartData.map(c => ({
                            time: c.time, value: c.volume || 0,
                            color: c.close >= c.open ? this.bullishColor : this.bearishColor
                        }));
                        this.volumeSeries.setData(volumeData);
                    }
                    if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
                }
            }
            this.hasMoreData = true;
            this.isLoadingMore = false;
            if (!this._userScrolledManually) this.scrollToLast();
        } catch (e) {}
        if (this.timerManager?._primitive) this.timerManager._primitive.requestRedraw();
        this.scheduleDrawingsUpdate();
    }

    _subscribeToPrice() {
        if (!this.priceManager) { setTimeout(() => this._subscribeToPrice(), 100); return; }
        if (this._priceSubscriptionKey && this._priceUpdateHandler) {
            this.priceManager.unsubscribe(this._priceSubscriptionKey, this._priceUpdateHandler);
            this._priceUpdateHandler = null;
            this._priceSubscriptionKey = null;
        }
        const key = `${this.currentSymbol}:${this.currentExchange}:${this.currentMarketType}`;
        this._priceSubscriptionKey = key;
        this._priceUpdateHandler = (price, symbol, exchange, marketType) => {
            if (document.hidden || this._switchingSymbol) return;
            if (symbol !== this.currentSymbol || exchange !== this.currentExchange || marketType !== this.currentMarketType) return;
            this._syncPriceLine(price);
        };
        this.priceManager.subscribe(key, this._priceUpdateHandler, this.currentExchange, this.currentMarketType);
        const cachedPrice = this.priceManager.getPrice(key);
        if (cachedPrice !== null && cachedPrice !== undefined && !isNaN(cachedPrice)) {
            this.currentRealPrice = cachedPrice;
            if (this.timerManager?.forceColorUpdate) this.timerManager.forceColorUpdate();
        }
    }
    
    setSymbol(symbol) {
        if (this.currentSymbol === symbol) return;
        if (this.priceManager && this._priceUpdateHandler) {
            this.priceManager.unsubscribe(this.currentSymbol, this._priceUpdateHandler);
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
        return str.includes('.') ? Math.min(str.split('.')[1].length, 8) : 2;
    }

    applyPriceFormat(precision) {
        try {
            if (precision === null || precision === undefined || isNaN(precision) || precision < 0) {
                precision = this._inferPrecisionFromData();
            }
            const minMove = Math.pow(10, -precision);
            const priceFormat = { type: 'price', precision, minMove };
            if (this.candleSeries) this.candleSeries.applyOptions({ priceFormat });
            if (this.barSeries) this.barSeries.applyOptions({ priceFormat });
            const priceScale = this.chart.priceScale('right');
            if (priceScale) priceScale.applyOptions({ priceFormat, autoScale: true });
            return precision;
        } catch (error) {
            return this._inferPrecisionFromData();
        }
    }

    _isValidCandle(candle) {
        if (!candle || typeof candle !== 'object') return false;
        if (typeof candle.time !== 'number' || isNaN(candle.time) || candle.time <= 0) return false;
        for (const field of ['open', 'high', 'low', 'close']) {
            const val = candle[field];
            if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) return false;
        }
        if (candle.high < candle.low) return false;
        if (candle.open > candle.high || candle.open < candle.low || candle.close > candle.high || candle.close < candle.low) return false;
        if (candle.volume !== undefined && candle.volume !== null && (typeof candle.volume !== 'number' || isNaN(candle.volume) || candle.volume < 0)) return false;
        return true;
    }

    _sanitizeCandle(candle) {
        if (!candle) return null;
        const clean = { ...candle };
        const fields = ['open', 'high', 'low', 'close'];
        const validValues = fields.filter(f => typeof clean[f] === 'number' && !isNaN(clean[f]) && isFinite(clean[f]));
        if (validValues.length === 0) return null;
        const avgValue = validValues.reduce((s, f) => s + clean[f], 0) / validValues.length;
        for (const field of fields) {
            if (typeof clean[field] !== 'number' || isNaN(clean[field]) || !isFinite(clean[field])) clean[field] = avgValue;
        }
        if (typeof clean.volume !== 'number' || isNaN(clean.volume) || clean.volume < 0) clean.volume = 0;
        const ohlc = [clean.open, clean.high, clean.low, clean.close];
        clean.high = Math.max(...ohlc);
        clean.low = Math.min(...ohlc);
        return clean;
    }
    
    _createNewCandle(candle) {
        if (!candle || !candle.time) return;
        if (this.chartData.some(c => c.time === candle.time)) return;
        const lastCandle = this.chartData[this.chartData.length - 1];
        if (lastCandle && candle.time <= lastCandle.time) return;

        this.chartData.push(candle);
        const limit = CONFIG.klineLimits?.[this.currentInterval] || 1000;
        if (this.chartData.length > limit) this.chartData.shift();
        this.lastCandle = candle;
        this.currentRealPrice = candle.close;

        const isBullish = candle.close >= candle.open;
        this._lastAppliedColor = isBullish ? (this.bullishColor || CONFIG.colors.bullish) : (this.bearishColor || CONFIG.colors.bearish);

        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (series) {
            series.update({ time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
            series.applyOptions({ priceLineSource: candle.close, priceLineColor: this._lastAppliedColor });
        }
        if (this.volumeSeries) {
            this.volumeSeries.update({ time: candle.time, value: candle.volume || 0, color: this._lastAppliedColor });
        }
        if (this.timerManager) {
            this.timerManager.forceColorUpdate();
            this.timerManager.start(this.currentInterval);
        }
        if (!this._userScrolledManually) this.scrollToLast();
    }
    
    async fetchKlines(symbol, exchange, marketType, interval, limit = 1000) {
        while (ChartManager._fetchInProgress) await new Promise(r => setTimeout(r, 100));
        ChartManager._fetchInProgress = true;
        if (this._currentFetchController) this._currentFetchController.abort();
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
            const response = await fetch(url, { signal: this._currentFetchController.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            let rawCandles;
            if (exchange === 'binance') {
                rawCandles = data.map(item => ({
                    time: Math.floor(item[0] / 1000), open: parseFloat(item[1]),
                    high: parseFloat(item[2]), low: parseFloat(item[3]),
                    close: parseFloat(item[4]), volume: parseFloat(item[5]),
                    quoteVolume: parseFloat(item[7])
                }));
            } else {
                if (data.retCode !== 0) throw new Error(data.retMsg);
                rawCandles = data.result.list.map(item => ({
                    time: Math.floor(parseInt(item[0]) / 1000), open: parseFloat(item[1]),
                    high: parseFloat(item[2]), low: parseFloat(item[3]),
                    close: parseFloat(item[4]), volume: parseFloat(item[5] || 0),
                    quoteVolume: parseFloat(item[6] || 0)
                })).filter(c => c !== null).reverse();
            }
            
            const seenTimes = new Set();
            const validCandles = rawCandles.filter(c => {
                if (seenTimes.has(c.time)) return false;
                seenTimes.add(c.time);
                return this._isValidCandle(c);
            }).sort((a, b) => a.time - b.time);
            
            return validCandles;
        } catch (error) {
            if (error.name === 'AbortError') console.log('🛑 fetchKlines прерван');
            else console.error('❌ Ошибка fetchKlines:', error);
            return [];
        } finally {
            this._currentFetchController = null;
            ChartManager._fetchInProgress = false;
        }
    }
    
    _updatePageTitle() {
        const symbol = this.currentSymbol || '';
        let price = this.currentRealPrice || this.lastCandle?.close || this.chartData?.[this.chartData.length - 1]?.close;
        if (!symbol) { document.title = 'График'; return; }
        if (price != null && !isNaN(price) && price > 0) {
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            const precision = series?.options()?.priceFormat?.precision || 2;
            const lastCandle = this.chartData?.[this.chartData.length - 1];
            const arrow = lastCandle?.close >= lastCandle?.open ? '▲' : '▼';
            document.title = `${arrow} ${symbol} ${price.toFixed(precision)}`;
        } else {
            document.title = `${symbol}`;
        }
    }

    async switchSymbol(symbol, exchange, marketType) {
        if (this._switchingSymbol) return;
        this._switchingSymbol = true;
        try {
            this._abortAllProcesses();
            this.candleSeries.setData([]);
            this.barSeries.setData([]);
            if (this.volumeSeries) this.volumeSeries.setData([]);
            this.chartData = [];
            this.lastCandle = null;
            if (this.currentSymbol !== symbol) this.currentRealPrice = null;
            this._lastAppliedColor = null;
            this._userScrolledManually = false;

            this.currentSymbol = symbol;
            this.currentExchange = exchange;
            this.currentMarketType = marketType;
            
            getPrecisionFromExchange(symbol, exchange, marketType)
                .then(p => localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, p))
                .catch(() => {});
            
            const candles = await this.fetchKlines(symbol, exchange, marketType, this.currentInterval, 1000);
            if (!candles || candles.length === 0) throw new Error('Нет данных для ' + symbol);

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

            setTimeout(() => {
                if (this.chartData?.length > 0) {
                    const lastCandle = this.chartData[this.chartData.length - 1];
                    if (lastCandle) {
                        this._lastAppliedColor = lastCandle.close >= lastCandle.open
                            ? (this.bullishColor || CONFIG?.colors?.bullish || '#26a69a')
                            : (this.bearishColor || CONFIG?.colors?.bearish || '#ef5350');
                    }
                }
                if (this.timerManager?.forceColorUpdate) this.timerManager.forceColorUpdate();
            }, 300);

            this._notifySymbolChange();
        } catch (error) {
            console.error('❌ Ошибка переключения:', error);
        } finally {
            this._switchingSymbol = false;
        }
    }
    
    updateColorsForSettings(bullishColor, bearishColor) {
        CONFIG.colors.bullish = bullishColor;
        CONFIG.colors.bearish = bearishColor;
        this.bullishColor = bullishColor;
        this.bearishColor = bearishColor;
        this.candleSeries.applyOptions({ upColor: bullishColor, downColor: bearishColor, wickUpColor: bullishColor, wickDownColor: bearishColor });
        this.barSeries.applyOptions({ upColor: bullishColor, downColor: bearishColor });
        this._syncLineAndTimerColor();
        if (this.volumeSeries && this.chartData.length > 0) {
            const volumeData = this.chartData.map(c => ({
                time: c.time, value: c.volume || 0,
                color: c.close >= c.open ? bullishColor : bearishColor
            }));
            this.volumeSeries.setData(volumeData);
        }
    }

    _syncLineAndTimerColor() {
        if (!this.chartData?.length) return;
        const lastCandle = this.chartData[this.chartData.length - 1];
        if (!lastCandle) return;
        let price = this.currentRealPrice || lastCandle.close;
        const isBullish = price >= lastCandle.open;
        const lineColor = isBullish ? (this.bullishColor || CONFIG.colors.bullish) : (this.bearishColor || CONFIG.colors.bearish);
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (series && price) series.applyOptions({ priceLineColor: lineColor, priceLineSource: price });
        if (this.timerManager) {
            const prim = this.timerManager._primitive;
            if (prim) {
                if (prim.setColor) prim.setColor(lineColor);
                if (prim.setPrice && price) prim.setPrice(price);
                if (prim.isEnabled()) prim.requestRedraw();
            }
            if (this.timerManager.forceColorUpdate) this.timerManager.forceColorUpdate();
        }
        this._lastAppliedColor = lineColor;
    }
    
    _abortAllProcesses() {
        if (this.priceManager && this._priceUpdateHandler) {
            this.priceManager.unsubscribe(this.currentSymbol, this._priceUpdateHandler);
            this._priceUpdateHandler = null;
        }
        if (this.timerManager) this.timerManager.destroy();
        this._loadingSymbol = false;
        this.isLoadingMore = false;
        this._updateScheduled = false;
        if (this._drawingsUpdateRafId) { cancelAnimationFrame(this._drawingsUpdateRafId); this._drawingsUpdateRafId = null; }
        if (this._updatePositionRafId) { cancelAnimationFrame(this._updatePositionRafId); this._updatePositionRafId = null; }
        if (this._currentFetchController) { this._currentFetchController.abort(); this._currentFetchController = null; }
        if (this._updateTimeout) { clearTimeout(this._updateTimeout); this._updateTimeout = null; }
    }
}

if (typeof window !== 'undefined') {
    window.ChartManager = ChartManager;
}
