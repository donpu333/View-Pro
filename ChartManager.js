class ChartManager {
    constructor(container) {
        // ============ БАЗОВЫЕ ПЕРЕМЕННЫЕ ============
        this.chartData = [];
        this.lastCandle = null;
        this._loadingSymbol = false;
        this._switchingSymbol = false;
        this._generationCounter = 0;
        this._activeGeneration = 0;
        this._updatesSuspended = false;
        this._isApplyingData = false;
        this._pendingData = null;
        this._batchUpdateActive = false;
        
        // ============ МЕНЕДЖЕРЫ ============
        this.indicatorManager = new IndicatorManager(this);
        this.chartContainer = document.getElementById('chart-container');
        
        // ============ НАСТРОЙКИ ============
        const savedChartType = localStorage.getItem('chartType') || 'candle';
        this.currentChartType = savedChartType;
        this.isLoadingMore = false;
        this.hasMoreData = true;
        this._priceSubscriptionKey = null;
        this.currentInterval = localStorage.getItem('lastTimeframe') || (typeof CONFIG !== 'undefined' ? CONFIG.defaultInterval : '1h');
        this.currentSymbol = (typeof CONFIG !== 'undefined' ? CONFIG.defaultSymbol : 'BTCUSDT');
        this.currentExchange = 'binance';
        this.currentMarketType = 'futures';
        
        // ============ ОПТИМИЗАЦИЯ ============
        this._lastWidth = this.chartContainer.clientWidth;
        this._lastHeight = this.chartContainer.clientHeight;
        this._initPromise = null;
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
        this._currentFetchController = null;
        this._historyFetchController = null;
        this._backgroundFetchController = null;
        this._updateTimeout = null;
        this._lastSyncedPrice = null;
        this._priceChanged = false;
        this._fullDataLoadTimeout = null;
        this._autoScalePending = false;
        this._isVerticalZooming = false;
        this._priceLineTimer = document.getElementById('priceLineTimer') || null;
        this._crosshairRafId = null;
        this._latestCrosshairData = null;
        this._drawingsRafId = null;
        this._refreshingAfterHidden = false;
        this._periodicSyncInterval = null;
        this._quarantineTimeout = null;
        this._lastKlineEventTime = 0;
        
        // ============ ВРЕМЕННЫЕ ОБЪЕКТЫ ============
        this._candleTimeMap = new Map();
        
        // ============ ПРОКРУТКА ============
        this._isScrolling = false;
        this._pendingSetData = false;
        this._isScrollingFast = false;
        this._lastDrawingsCall = 0;
        this._drawingsFinalUpdateTimeout = null;
        this._scrollStopTimeout = null;
        this._lastScrollTime = 0;
        this._panelsSyncRafId = null;
        this._lastVisibleRange = null;
        this._isViewingHistory = false;

        // ============ ИСТОРИЯ ============
        this._historyLoadQueue = [];
        this._preloadThreshold = 400;
        this._batchSize = 500;
        this._minLoadDelay = 1000;
        this._lastHistoryLoadTime = 0;
        this._pendingHistoryLoad = false;
        this._historyEndTime = null;
        this._fetchPromise = null;

        // ============ МОБИЛЬНАЯ ОПТИМИЗАЦИЯ ============
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        this._maxCandlesInMemory = isMobile ? 3000 : 8000;
        this._leftBuffer = isMobile ? 1000 : 3000;
        this._rightBuffer = isMobile ? 500 : 1500;
        
        // ============ ОБРЕЗКА ДАННЫХ ============
        this._trimDebounceTimeout = null;
        this._trimDebounceDelay = isMobile ? 500 : 300;
        this._pendingTrimParams = null;
        this._isTrimming = false;
        
        // ============ ОБЪЕМЫ ============
        this._volumeDataCache = null;
        this._volumeDataDirty = true;
        
        // ============ ЭФФЕКТЫ ЦЕНЫ ============
        this._priceEffectRafId = null;
        this._lastVolumeUpdateIndex = -1;
        this._pendingDrawingsRedraw = false;

        // ============ VISIBILITY HANDLER ============
        this._visibilityHandler = () => {
            if (!document.hidden) {
                if (window.wsManager) {
                    window.wsManager.forceReconnect?.();
                }
                this.refreshCandlesAfterTabHidden();
                const price = this.getCurrentPrice();
                if (price != null) {
                    this._syncPriceLine(price);
                }
                this.scheduleDrawingsUpdate(true);
                this.requestDrawingsRedraw();
                if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
            } else {
                this._startBackgroundTitleUpdate();
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
       
        // ============ ХЕНДЛЕРЫ ============
        this._priceUpdateHandler = null;
        this._candleCheckerTimeout = null;

        this.scheduleDrawingsUpdate = this.scheduleDrawingsUpdate.bind(this);
        this.onVisibleLogicalRangeChange = this.onVisibleLogicalRangeChange.bind(this);

        // ============ DOM ЭЛЕМЕНТЫ ============
        this.overlay = this._safeElement('candleStatsOverlay');
        this.openEl = this._safeElement('openValue');
        this.highEl = this._safeElement('highValue');
        this.lowEl = this._safeElement('lowValue');
        this.closeEl = this._safeElement('closeValue');
        this.changeEl = this._safeElement('changeValue');
        this.volumeEl = document.getElementById('volumeValue');
        
        this._formatCache = new Map();
        this._lastCrosshairColor = null;

        // ============ СОЗДАНИЕ ГРАФИКА ============
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
            handleScroll: { 
                mouseWheel: true, 
                pressedMouseMove: true, 
                horzTouchDrag: true, 
                vertTouchDrag: true 
            },
            handleScale: { 
                axisPressedMouseMove: true, 
                mouseWheel: true, 
                pinch: true 
            },
            animation: { 
                duration: 0
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
                    return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
                }
            },
            rightPriceScale: { 
                borderColor: '#333333', 
                borderVisible: true,
                scaleMargins: { top: 0.1, bottom: 0.1 }, 
                autoScale: false,
                entireTextOnly: true,
                minimumWidth: 90
            },
            localization: {
                timeFormatter: (time) => {
                    const mskTime = time + (3 * 3600);
                    return new Date(mskTime * 1000).toLocaleString('ru-RU', {
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

        // ============ СЕРИИ ДАННЫХ ============
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

        [this.candleSeries, this.barSeries].forEach(series => {
            series.applyOptions({
                priceLineVisible: true, 
                lastValueVisible: false,
                priceLineColor: '#00bcd4', 
                priceLineWidth: 1,
                priceLineStyle: LightweightCharts.LineStyle.Dashed
            });
        });

        const savedBg = localStorage.getItem('chartBgColor');
        const savedBullish = localStorage.getItem('chartBullishColor');
        const savedBearish = localStorage.getItem('chartBearishColor');

        if (savedBg) this.chart.applyOptions({ layout: { background: { color: savedBg } } });
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
                    priceLineVisible: false, 
                    title: ''
                });
                const volumeScale = this.chart.priceScale('volume');
                if (volumeScale) {
                    volumeScale.applyOptions({ 
                        scaleMargins: { top: 0.78, bottom: 0 }, 
                        visible: true, 
                        borderVisible: true 
                    });
                }
                this.bullishColor = CONFIG.colors.bullish;
                this.bearishColor = CONFIG.colors.bearish;
            } catch (e) {
                console.warn('⚠️ Не удалось создать Volume:', e);
                this.volumeSeries = null;
            }
        }

        const isCandle = this.currentChartType === 'candle';
        this.candleSeries.applyOptions({ visible: isCandle });
        this.barSeries.applyOptions({ visible: !isCandle });

        this.chart.subscribeCrosshairMove(this.onCrosshairMove.bind(this));
        this.setupOptimizedSubscriptions();
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
                this._resizeObserver = new ResizeObserver(() => {
                    this._updateMainChartHeight();
                });
                this._resizeObserver.observe(panelsContainer);
            }
        })();
     
        this._setupPanelsSync();
        this._startNewCandleChecker();
        this._startPeriodicSync();

        setTimeout(() => {
            if (window.wsManager && typeof window.wsManager.connect === 'function') {
                window.wsManager.connect(
                    this.currentSymbol,
                    this.currentInterval,
                    this.currentExchange,
                    this.currentMarketType
                );
                console.log('🚀 WebSocket автоподключён при старте:', this.currentSymbol, this.currentInterval);
            } else {
                console.warn('⚠️ wsManager не готов к автоподключению');
            }
        }, 1000);
    }

    onWebSocketConnected() {
        console.log('✅ ChartManager: WebSocket подключён, синхронизируем свечи...');
        this._syncRecentCandles().catch(() => {});
    }

    _safeElement(id) {
        const el = document.getElementById(id);
        return el ? el : { 
            classList: { add: () => {}, remove: () => {} }, 
            textContent: '', 
            style: {} 
        };
    }

    _rebuildTimeMap() {
        this._candleTimeMap.clear();
        for (let i = 0; i < this.chartData.length; i++) {
            this._candleTimeMap.set(this.chartData[i].time, i);
        }
    }

    _addToTimeMap(time, index) {
        this._candleTimeMap.set(time, index);
    }

    // ============ ЕДИНЫЙ МЕТОД ЦВЕТА ЛИНИИ ============
    _getLineColor() {
        if (!this.chartData || this.chartData.length === 0) {
            return this.bullishColor || CONFIG.colors.bullish || '#26a69a';
        }
        
        const lastCandle = this.chartData[this.chartData.length - 1];
        if (!lastCandle) {
            return this.bullishColor || CONFIG.colors.bullish || '#26a69a';
        }
        
        const isBullish = lastCandle.close >= lastCandle.open;
        
        return isBullish 
            ? (this.bullishColor || CONFIG.colors.bullish || '#26a69a') 
            : (this.bearishColor || CONFIG.colors.bearish || '#ef5350');
    }

    _syncLineColor() {
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (!series) return;
        
        const lineColor = this._getLineColor();
        this._lastAppliedColor = lineColor;
        
        series.applyOptions({ 
            priceLineColor: lineColor 
        });
    }

    _startBackgroundTitleUpdate() {
        if (this._bgTitleInterval) {
            clearInterval(this._bgTitleInterval);
            this._bgTitleInterval = null;
        }
        
        this._bgTitleInterval = setInterval(() => {
            if (document.hidden && this.currentRealPrice != null) {
                this._updatePageTitle();
            }
            if (!document.hidden && this._bgTitleInterval) {
                clearInterval(this._bgTitleInterval);
                this._bgTitleInterval = null;
            }
        }, 1000);
    }

    _startPeriodicSync() {
        if (this._periodicSyncInterval) {
            clearInterval(this._periodicSyncInterval);
        }
        this._periodicSyncInterval = setInterval(() => {
            if (!document.hidden && !this._switchingSymbol && !this._updatesSuspended) {
                this._syncRecentCandles();
            }
        }, 30000);
    }

    async _syncRecentCandles() {
        try {
            const fresh = await this.fetchKlines(
                this.currentSymbol, 
                this.currentExchange, 
                this.currentMarketType, 
                this.currentInterval, 
                3,
                null,
                'background'
            );
            if (!fresh || fresh.length === 0) return;
            
            if (this._updatesSuspended || this._switchingSymbol) return;
            
            const currentData = this.chartData;
            if (!currentData || currentData.length === 0) return;
            
            const freshMap = new Map(fresh.map(c => [c.time, c]));
            const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            let changed = false;
            
            for (let i = currentData.length - 1; i >= Math.max(0, currentData.length - 3); i--) {
                const cur = currentData[i];
                const freshCandle = freshMap.get(cur.time);
                if (freshCandle) {
                    const oldOpen = cur.open;
                    const oldHigh = cur.high;
                    const oldLow = cur.low;
                    const oldClose = cur.close;
                    const oldVolume = cur.volume;
                    const oldQuoteVolume = cur.quoteVolume;
                    
                    cur.open = freshCandle.open;
                    cur.close = freshCandle.close;
                    cur.high = freshCandle.high;
                    cur.low = freshCandle.low;
                    cur.volume = freshCandle.volume;
                    cur.quoteVolume = freshCandle.quoteVolume;
                    
                    if (
                        oldOpen !== cur.open ||
                        oldHigh !== cur.high ||
                        oldLow !== cur.low ||
                        oldClose !== cur.close ||
                        oldVolume !== cur.volume ||
                        oldQuoteVolume !== cur.quoteVolume
                    ) {
                        changed = true;
                        if (activeSeries) {
                            activeSeries.update({
                                time: cur.time,
                                open: cur.open,
                                high: cur.high,
                                low: cur.low,
                                close: cur.close
                            });
                        }
                        if (this.volumeSeries) {
                            const isBullish = cur.close >= cur.open;
                            this.volumeSeries.update({
                                time: cur.time,
                                value: cur.quoteVolume || cur.volume || 0,
                                color: isBullish ? this.bullishColor : this.bearishColor
                            });
                        }
                    }
                    freshMap.delete(cur.time);
                }
            }
            
            if (freshMap.size > 0) {
                const missing = Array.from(freshMap.values()).sort((a, b) => a.time - b.time);
                for (const candle of missing) {
                    currentData.push(candle);
                    this._addToTimeMap(candle.time, currentData.length - 1);
                    if (activeSeries) {
                        activeSeries.update({
                            time: candle.time,
                            open: candle.open,
                            high: candle.high,
                            low: candle.low,
                            close: candle.close
                        });
                    }
                    if (this.volumeSeries) {
                        const isBullish = candle.close >= candle.open;
                        this.volumeSeries.update({
                            time: candle.time,
                            value: candle.quoteVolume || candle.volume || 0,
                            color: isBullish ? this.bullishColor : this.bearishColor
                        });
                    }
                }
                this.lastCandle = currentData[currentData.length - 1];
                changed = true;
            }
            
            if (changed) {
                this._volumeDataDirty = true;
                this._syncLineColor();
                if (this.indicatorManager) {
                    this.indicatorManager.updateAllIndicators();
                }
                if (this.timerManager) {
                    this.timerManager.updatePrice(this.lastCandle.close);
                }
            }
        } catch (e) {
            console.warn('⚠️ Ошибка периодической синхронизации:', e);
        }
    }

    async refreshCandlesAfterTabHidden() {
        if (this._refreshingAfterHidden) return;
        this._refreshingAfterHidden = true;
        
        const wasSuspended = this._updatesSuspended;
        this._updatesSuspended = true;
        
        try {
            const symbol = this.currentSymbol;
            const exchange = this.currentExchange;
            const marketType = this.currentMarketType;
            const interval = this.currentInterval;
            const limit = 500;
            
            console.log('🔄 Синхронизация свечей после возврата на вкладку...');
            
            const freshCandles = await this.fetchKlines(
                symbol, exchange, marketType, interval, limit,
                null,
                'background'
            );
            if (!freshCandles || freshCandles.length === 0) {
                console.warn('⚠️ Не удалось получить свежие свечи для синхронизации');
                return;
            }
            
            const currentData = this.chartData;
            if (!currentData || currentData.length === 0) {
                this.setDataQuick(freshCandles, interval, symbol, exchange, marketType);
                return;
            }
            
            const currentMap = new Map();
            for (const candle of currentData) {
                currentMap.set(candle.time, candle);
            }
            
            const updatedData = [];
            let dataChanged = false;
            
            for (const freshCandle of freshCandles) {
                const existing = currentMap.get(freshCandle.time);
                if (existing) {
                    if (
                        existing.open !== freshCandle.open ||
                        existing.high !== freshCandle.high ||
                        existing.low !== freshCandle.low ||
                        existing.close !== freshCandle.close ||
                        existing.volume !== freshCandle.volume ||
                        existing.quoteVolume !== freshCandle.quoteVolume
                    ) {
                        updatedData.push(freshCandle);
                        dataChanged = true;
                    } else {
                        updatedData.push(existing);
                    }
                } else {
                    updatedData.push(freshCandle);
                    dataChanged = true;
                }
            }
            
            const freshTimes = new Set(freshCandles.map(c => c.time));
            for (const candle of currentData) {
                if (!freshTimes.has(candle.time)) {
                    updatedData.push(candle);
                }
            }
            
            updatedData.sort((a, b) => a.time - b.time);
            
            if (dataChanged) {
                this.chartData = updatedData;
                this._rebuildTimeMap();
                this.lastCandle = this.chartData[this.chartData.length - 1];
                
                const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
                if (activeSeries) {
                    activeSeries.setData(this.chartData);
                }
                
                if (this.volumeSeries) {
                    this._volumeDataDirty = false;
                    this._lastVolumeUpdateIndex = -1;
                    const volumeData = this._buildVolumeData(this.chartData);
                    this.volumeSeries.setData(volumeData);
                }
                
                if (this.indicatorManager) {
                    this.indicatorManager.updateAllIndicators();
                }
                
                const lastCandle = this.lastCandle;
                if (lastCandle) {
                    const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
                    if (series) {
                        const color = this._getLineColor();
                        series.applyOptions({
                            priceLineSource: lastCandle.close,
                            priceLineColor: color
                        });
                        this.currentRealPrice = lastCandle.close;
                        this._lastAppliedColor = color;
                    }
                }
                
                if (!this._isViewingHistory) {
                    this.scrollToLast();
                }
                console.log('✅ График и объёмы синхронизированы с биржей');
            }
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации после возврата:', error);
        } finally {
            this._refreshingAfterHidden = false;
            
            if (this._quarantineTimeout) clearTimeout(this._quarantineTimeout);
            this._quarantineTimeout = setTimeout(() => {
                this._updatesSuspended = wasSuspended;
                this._quarantineTimeout = null;
            }, 1000);
        }
    }

    destroy() {
        if (this._bgTitleInterval) {
            clearInterval(this._bgTitleInterval);
            this._bgTitleInterval = null;
        }
        if (this._periodicSyncInterval) {
            clearInterval(this._periodicSyncInterval);
            this._periodicSyncInterval = null;
        }
        if (this._quarantineTimeout) {
            clearTimeout(this._quarantineTimeout);
            this._quarantineTimeout = null;
        }

        this._abortAllProcesses();
        
        if (window._dailySeparator && typeof window._dailySeparator.destroy === 'function') {
            window._dailySeparator.destroy();
            window._dailySeparator = null;
        }
        if (window._sessionHighlighter && typeof window._sessionHighlighter.destroy === 'function') {
            window._sessionHighlighter.destroy();
            window._sessionHighlighter = null;
        }
        
        if (this._candleCheckerTimeout) clearTimeout(this._candleCheckerTimeout);
        if (this._trimDebounceTimeout) clearTimeout(this._trimDebounceTimeout);
        if (this._drawingsFinalUpdateTimeout) clearTimeout(this._drawingsFinalUpdateTimeout);
        if (this._scrollStopTimeout) clearTimeout(this._scrollStopTimeout);
        if (this._setDataTimeout) clearTimeout(this._setDataTimeout);
        
        if (this._globalMouseUpHandler) {
            window.removeEventListener('mouseup', this._globalMouseUpHandler, true);
        }
        
        document.removeEventListener('visibilitychange', this._visibilityHandler);
        if (this._resizeObserver) this._resizeObserver.disconnect();
        
        if (this.timerManager && typeof this.timerManager.destroy === 'function') {
            this.timerManager.destroy();
        }
        
        if (this.chart) {
            this.chart.remove();
            this.chart = null;
        }
        
        this.chartData = [];
        this._candleTimeMap.clear();
        this._formatCache.clear();
        this._symbolChangeCallbacks = [];
        console.log('✅ ChartManager полностью уничтожен, утечек памяти нет');
    }

    _startNewCandleChecker() {
        const check = () => {
            if (document.hidden) {
                this._candleCheckerTimeout = setTimeout(check, 2000);
                return;
            }

            if (!this.chartData?.length || !this.currentInterval || this._updatesSuspended) {
                this._candleCheckerTimeout = setTimeout(check, 1000);
                return;
            }
            
            const nowSec = Math.floor(Date.now() / 1000);
            const aligned = this._alignTimeToInterval(nowSec);
            
            const last = this.chartData[this.chartData.length - 1];
            
            if (last && aligned > last.time) {
                const timeSinceNewCandle = nowSec - aligned;
                
                if (timeSinceNewCandle < 5) {
                    this._candleCheckerTimeout = setTimeout(check, 250);
                    return;
                }
                
                console.warn('⚠️ Kline задерживается > 5 сек, создаём временную свечу');
                const newCandle = {
                    time: aligned,
                    open: last.close,
                    high: last.close,
                    low: last.close,
                    close: last.close,
                    volume: 0,
                    quoteVolume: 0,
                    _isPlaceholder: true
                };
                this._createNewCandle(newCandle);
            }
            
            this._candleCheckerTimeout = setTimeout(check, 250);
        };
        check();
    }

    async _catchUpMissedCandles() {
        if (!this.currentSymbol || !this.currentInterval) return;
        
        try {
            console.log('🔄 Догружаем пропущенные свечи...');
            
            const freshCandles = await this.fetchKlines(
                this.currentSymbol,
                this.currentExchange,
                this.currentMarketType,
                this.currentInterval,
                10,
                null,
                'background'
            );
            
            if (!freshCandles || freshCandles.length === 0) return;
            
            const lastLocalTime = this.chartData.length > 0 
                ? this.chartData[this.chartData.length - 1].time 
                : 0;
            
            const newCandles = freshCandles.filter(c => c.time > lastLocalTime);
            
            if (newCandles.length > 0) {
                console.log(`✅ Добавлено ${newCandles.length} пропущенных свечей`);
                
                this.chartData.push(...newCandles);
                this._rebuildTimeMap();
                this._volumeDataDirty = true;
                this._lastVolumeUpdateIndex = -1;
                
                const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
                if (activeSeries) {
                    activeSeries.setData(this.chartData);
                }
                
                this._updateVolumeOptimized();
                this.lastCandle = this.chartData[this.chartData.length - 1];
                this._syncLineColor();
                
                if (this.indicatorManager) {
                    this.indicatorManager.updateAllIndicators();
                }
                
                this.scrollToLast();
            } else {
                const lastFresh = freshCandles[freshCandles.length - 1];
                const lastLocal = this.chartData[this.chartData.length - 1];
                
                if (lastFresh && lastLocal && lastFresh.time === lastLocal.time) {
                    this.updateLastCandle(lastFresh);
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка догрузки свечей:', error);
        }
    }

    _setupPanelsSync() {}

    setupOptimizedSubscriptions() {
        this.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            const now = performance.now();
            this._isScrollingFast = (now - this._lastScrollTime) < 40;
            this._isScrolling = true;
            this._lastScrollTime = now;
            this._lastVisibleRange = range;

            clearTimeout(this._scrollStopTimeout);
            this._pendingDrawingsRedraw = true;

            this._scrollStopTimeout = setTimeout(() => {
                this._isScrolling = false;
                this._isScrollingFast = false;
                
                this._applyPendingTrim();
                this.onVisibleLogicalRangeChange(this._lastVisibleRange);
                
                if (this._pendingDrawingsRedraw) {
                    this._pendingDrawingsRedraw = false;
                    this.requestDrawingsRedraw();
                }
            }, 150);

            if (this.timerManager) {
                const price = this.currentRealPrice ?? this.lastCandle?.close;
                if (price != null) {
                    this.timerManager.updatePosition(price);
                }
            }

            if (range && this.indicatorManager?.panelManager && !this._isSyncing) {
                if (!this._panelsSyncRafId) {
                    this._panelsSyncRafId = requestAnimationFrame(() => {
                        this._isSyncing = true;
                        const panels = this.indicatorManager.panelManager.panels;
                        panels.forEach((panel) => {
                            if (panel.chart && !panel.isCollapsed) {
                                try { 
                                    panel.chart.timeScale().setVisibleLogicalRange(range); 
                                } catch(e) {}
                            }
                        });
                        this._isSyncing = false;
                        this._panelsSyncRafId = null;
                    });
                }
            }
        });
        
        this.chartContainer.addEventListener('wheel', () => {}, { passive: true });
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
                    if (this._resizeIndicatorPanels) this._resizeIndicatorPanels();
                    if (this._updateMainChartHeight) this._updateMainChartHeight();
                    setTimeout(() => this.scrollToLast(), 50);
                }
                if (this.timerManager) {
                    const price = this.currentRealPrice ?? this.lastCandle?.close;
                    if (price != null) {
                        this.timerManager.updatePosition(price);
                    }
                }
                this.scheduleDrawingsUpdate(true);
            }, 100);
        });

        this.chartContainer.addEventListener('mouseleave', () => {
            if (this.overlay) this.overlay.classList.remove('visible');
            this._latestCrosshairData = null;
            if (this._crosshairRafId) { 
                cancelAnimationFrame(this._crosshairRafId); 
                this._crosshairRafId = null; 
            }
            try { this.chart.clearCrosshairPosition(); } catch(e) {}
            
            this._fixStuckAxisDrag();
        });

        this._globalMouseUpHandler = (e) => {
            if (!this.chartContainer) return;
            
            const canvas = this.chartContainer.querySelector('canvas');
            if (!canvas) return;
            
            if (e.target === canvas) return;
            
            const rect = this.chartContainer.getBoundingClientRect();
            const isOverChart = (
                e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom
            );
            
            if (isOverChart) {
                this._fixStuckAxisDrag();
            }
        };
        window.addEventListener('mouseup', this._globalMouseUpHandler, true);

        window.addEventListener('blur', () => {
            this._fixStuckAxisDrag();
            
            if (window.trendLineManager?.cancelDrag) window.trendLineManager.cancelDrag();
            if (window.rayManager?.cancelDrag) window.rayManager.cancelDrag();
            if (window.rulerLineManager?.cancelDrag) window.rulerLineManager.cancelDrag();
            if (window.alertLineManager?.cancelDrag) window.alertLineManager.cancelDrag();
            if (window.textManager?.cancelDrag) window.textManager.cancelDrag();
            
            try { this.chart?.clearCrosshairPosition(); } catch(e) {}
        });
    }

    _fixStuckAxisDrag() {
        if (!this.chart || !this.chartContainer) return;
        try {
            const canvas = this.chartContainer.querySelector('canvas');
            if (canvas) {
                canvas.dispatchEvent(new MouseEvent('mouseup', { 
                    bubbles: true, 
                    cancelable: true,
                    view: window
                }));
            }
        } catch (e) {}
    }

setChartType(type) {
    if (!this.chart) return;
    this.currentChartType = type;
    localStorage.setItem('chartType', type);
    
    // ✅ Переключаем только видимость, НЕ трогаем данные
    // Обе серии уже содержат данные из setDataQuick
    if (type === 'candle') {
        if (this.candleSeries) this.candleSeries.applyOptions({ visible: true });
        if (this.barSeries) this.barSeries.applyOptions({ visible: false });
    } else if (type === 'bar') {
        if (this.barSeries) this.barSeries.applyOptions({ visible: true });
        if (this.candleSeries) this.candleSeries.applyOptions({ visible: false });
    }
    
    if (this.volumeSeries && this.chartData.length > 0) {
        this._volumeDataCache = null;
        this._volumeDataDirty = true;
        this._lastVolumeUpdateIndex = -1; 
        this._updateVolumeOptimized();
    }
    
    if (this.barSeries) {
        this.barSeries.applyOptions({ 
            upColor: CONFIG.colors.bullish, 
            downColor: CONFIG.colors.bearish 
        });
    }
    
    if (this.indicatorManager?.activeIndicators) {
        this.indicatorManager.activeIndicators.forEach(indicator => {
            try { indicator.createSeries(); } catch (e) {}
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
        const lineColor = this._getLineColor();
        activeSeries.applyOptions({
            priceLineVisible: true, 
            lastValueVisible: false,
            priceLineColor: lineColor,
            priceLineSource: 'lastBar',
            priceLineWidth: 1,
            priceLineStyle: LightweightCharts.LineStyle.Dashed
        });
        this._lastAppliedColor = lineColor;
    }

    if (this.timerManager) {
        const price = this.currentRealPrice ?? this.lastCandle?.close;
        if (price != null) {
            this.timerManager.updatePrice(price);
        }
        
        requestAnimationFrame(() => {
            if (this.timerManager) this.timerManager._forceUpdate();
        });
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (this.timerManager) this.timerManager._forceUpdate();
            });
        });
        setTimeout(() => {
            if (this.timerManager) this.timerManager._forceUpdate();
        }, 150);
        setTimeout(() => {
            if (this.timerManager) this.timerManager._forceUpdate();
        }, 400);
    }

    if (window._dailySeparator && typeof window._dailySeparator.reattach === 'function') {
        window._dailySeparator.reattach();
    }
    if (window._sessionHighlighter && typeof window._sessionHighlighter.reattach === 'function') {
        window._sessionHighlighter.reattach();
    }
}
    scheduleUpdate() {
        if (this._updateScheduled || this._updatesSuspended) return;
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
        if (!this.priceLineTimer) {
            this.priceLineTimer = document.getElementById('priceLineTimer');
            if (!this.priceLineTimer) return;
        }
        if (!this.lastCandle) return;
        
        const price = this.currentRealPrice || this.lastCandle.close;
        if (!price || isNaN(price)) return;
        
        const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (!activeSeries) return;
        
        const coordinate = activeSeries.priceToCoordinate(price);
        if (coordinate !== null && !isNaN(coordinate)) {
            const containerRect = this.chartContainer.getBoundingClientRect();
            let topPosition = coordinate + containerRect.top;
            const timerHeight = this.priceLineTimer.offsetHeight || 30;
            topPosition = Math.max(5, Math.min(window.innerHeight - timerHeight - 5, topPosition));
            this.priceLineTimer.style.top = topPosition + 'px';
            this.priceLineTimer.style.right = '10px';
            
            const isBullish = this.lastCandle ? (this.lastCandle.close >= this.lastCandle.open) : true;
            this.priceLineTimer.classList.remove('bullish', 'bearish');
            this.priceLineTimer.classList.add(isBullish ? 'bullish' : 'bearish');
        }
    }

    _performUpdate() {
        if (!this.chartData.length || this._updatesSuspended) return;
        
        const cachedPrecision = localStorage.getItem(
            `precision_${this.currentSymbol}_${this.currentExchange}_${this.currentMarketType}`
        );
        if (cachedPrecision) {
            this.applyPriceFormat(parseInt(cachedPrecision));
        } else {
            this.applyPriceFormat(this._inferPrecisionFromData());
        }
        
        if (this.indicatorManager) this.indicatorManager.updateAllIndicators();

        const lastCandle = this.chartData[this.chartData.length - 1];
        const price = this.getCurrentPrice() ?? this.currentRealPrice;

        if (price !== null) {
            this._syncPriceLine(price);
        } else {
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            if (series) {
                const lineColor = this._getLineColor();
                series.applyOptions({ 
                    priceLineSource: lastCandle.close, 
                    priceLineColor: lineColor 
                });
                this._lastAppliedColor = lineColor;
            }
        }

        if (this.timerManager) {
            this.timerManager.start(this.currentInterval);
            if (price !== null) {
                this.timerManager.updatePrice(price);
            } else {
                this.timerManager.updatePrice(lastCandle.close);
            }
        }
        this.scheduleUpdatePosition();
    }

 _syncPriceLine(price) {
    if (!price || isNaN(price) || this._updatesSuspended) return;

    const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
    if (!series || !this.chartData || this.chartData.length === 0) return;

    const lastCandle = this.chartData[this.chartData.length - 1];
    if (!lastCandle) return;

    const nowSec = Math.floor(Date.now() / 1000);
    const currentCandleStart = this._alignTimeToInterval(nowSec);

    if (lastCandle.time < currentCandleStart) {
        const lineColor = this._getLineColor();
        this.currentRealPrice = price;
        series.applyOptions({
            priceLineColor: lineColor,
            priceLineSource: lastCandle.close
        });
        this._lastAppliedColor = lineColor;
        this._updatePageTitle();
        if (this.timerManager) this.timerManager.updatePrice(price);
        return;
    }

    if (lastCandle.time !== currentCandleStart) {
        const lineColor = this._getLineColor();
        this.currentRealPrice = price;
        series.applyOptions({
            priceLineSource: price,
            priceLineColor: lineColor
        });
        this._lastAppliedColor = lineColor;
        this._updatePageTitle();
        this.scheduleUpdatePosition();
        if (this.timerManager) this.timerManager.updatePrice(price);
        return;
    }

    lastCandle.close = price;
    lastCandle.high = Math.max(lastCandle.high, price);
    lastCandle.low = Math.min(lastCandle.low, price);

    this.currentRealPrice = price;
    this.lastCandle = lastCandle;

    // Вот здесь — уже после изменения close
    const lineColor = this._getLineColor();

    series.update({
        time: lastCandle.time,
        open: lastCandle.open,
        high: lastCandle.high,
        low: lastCandle.low,
        close: price
    });

    this._lastAppliedColor = lineColor;

    series.applyOptions({
        priceLineSource: price,
        priceLineColor: lineColor
    });

    this._updatePageTitle();
    if (!document.hidden) this.scheduleUpdatePosition();
    this.requestDrawingsRedraw();

    if (this.timerManager) this.timerManager.updatePrice(price);
}

    _alignTimeToInterval(nowSec) {
        const stepMap = {
            '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
            '1h': 3600, '4h': 14400, '6h': 21600, '12h': 43200,
            '1d': 86400, '1w': 604800, '1M': 2592000
        };
        
        if (this.currentInterval === '1w') {
            const now = new Date(nowSec * 1000);
            const dayOfWeek = now.getUTCDay();
            const daysToMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7;
            const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysToMonday));
            return Math.floor(monday.getTime() / 1000);
        } else if (this.currentInterval === '1M') {
            const now = new Date(nowSec * 1000);
            const firstDayOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
            return Math.floor(firstDayOfMonth.getTime() / 1000);
        } else {
            const step = stepMap[this.currentInterval] || 3600;
            return Math.floor(nowSec / step) * step;
        }
    }

    updateLastCandle(candle, eventTime = null) {
        if (this._switchingSymbol || this._updatesSuspended) return;
        if (!candle || typeof candle.time !== 'number' || isNaN(candle.time) || candle.time <= 0) return;
        
        if (eventTime !== null && eventTime !== undefined) {
            if (this._lastKlineEventTime && eventTime <= this._lastKlineEventTime) return;
            this._lastKlineEventTime = eventTime;
        }
        
        try {
            if (!this._isValidCandle(candle)) {
                const sanitized = this._sanitizeCandle(candle);
                if (!sanitized) return;
                candle = sanitized;
            }
            
            if (!this.chartData || this.chartData.length === 0) return;
            
            const currentLastCandle = this.chartData[this.chartData.length - 1];
            const isLastCandle = currentLastCandle && candle.time === currentLastCandle.time;
            const isNewCandle = !currentLastCandle || candle.time > currentLastCandle.time;
            const existingIndex = this._candleTimeMap.get(candle.time);

            if (isLastCandle) {
                currentLastCandle.open = candle.open;
                currentLastCandle.close = candle.close;
                currentLastCandle.high = candle.high;
                currentLastCandle.low = candle.low;
                currentLastCandle.volume = candle.volume;
                currentLastCandle.quoteVolume = candle.quoteVolume;
                currentLastCandle._isPlaceholder = false;
                this.lastCandle = currentLastCandle;
                
                if (this.volumeSeries) {
                    const isBullish = currentLastCandle.close >= currentLastCandle.open;
                    this.volumeSeries.update({
                        time: currentLastCandle.time,
                        value: currentLastCandle.quoteVolume || currentLastCandle.volume || 0,
                        color: isBullish ? this.bullishColor : this.bearishColor
                    });
                }
            } else if (existingIndex !== undefined && existingIndex >= 0) {
                const existingCandle = this.chartData[existingIndex];
                existingCandle.close = candle.close;
                existingCandle.high = Math.max(existingCandle.high, candle.high);
                existingCandle.low = Math.min(existingCandle.low, candle.low);
                existingCandle.volume = candle.volume;
                existingCandle.quoteVolume = candle.quoteVolume;
                existingCandle._isPlaceholder = false;
                
                const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
                if (activeSeries) {
                    activeSeries.update({
                        time: existingCandle.time,
                        open: existingCandle.open,
                        high: existingCandle.high,
                        low: existingCandle.low,
                        close: existingCandle.close
                    });
                }
                if (this.volumeSeries) {
                    const isBullish = existingCandle.close >= existingCandle.open;
                    this.volumeSeries.update({
                        time: existingCandle.time,
                        value: existingCandle.quoteVolume || existingCandle.volume || 0,
                        color: isBullish ? this.bullishColor : this.bearishColor
                    });
                }
                this._volumeDataDirty = true;
                return;
            } else if (isNewCandle) {
                this.chartData.push(candle);
                this._addToTimeMap(candle.time, this.chartData.length - 1);
                this.lastCandle = candle;
                
                if (this.volumeSeries) {
                    const isBullish = candle.close >= candle.open;
                    this.volumeSeries.update({
                        time: candle.time,
                        value: candle.quoteVolume || candle.volume || 0,
                        color: isBullish ? this.bullishColor : this.bearishColor
                    });
                    this._lastVolumeUpdateIndex = this.chartData.length - 1;
                }
            } else {
                return;
            }
            
            if (!this.lastCandle) return;
            
            const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            if (activeSeries) {
                activeSeries.update({
                    time: this.lastCandle.time,
                    open: this.lastCandle.open,
                    high: this.lastCandle.high,
                    low: this.lastCandle.low,
                    close: this.lastCandle.close
                });
                
                const lineColor = this._getLineColor();
                
                activeSeries.applyOptions({
                    priceLineColor: lineColor,
                    priceLineSource: this.lastCandle.close
                });
                this._lastAppliedColor = lineColor;
            }
            
            this._updatePageTitle();
            if (this.timerManager) this.timerManager.updatePrice(this.lastCandle.close);
            if (this.scheduleUpdatePosition) this.scheduleUpdatePosition();
            
            this._priceChanged = true;
            this._volumeDataDirty = true;
            
        } catch (e) {
            console.error('❌ Ошибка в updateLastCandle:', e);
        }
    }

    async waitForChartReady() {
        await new Promise(resolve => {
            const check = () => {
                const ts = this.chart?.timeScale();
                if (ts && ts.getVisibleRange()) resolve();
                else requestAnimationFrame(check);
            };
            check();
        });
        await new Promise(r => setTimeout(r, 50));
    }

    setDataQuick(data, interval, symbol, exchange = 'binance', marketType = 'futures') {
        try {
            if (!data || data.length === 0) return;

            const currentScale = this._captureScale();
            const isNewSymbol = this.currentSymbol !== symbol;

            this.chart.applyOptions({ 
                handleScroll: false, 
                handleScale: false 
            });
            
            if (this.candleSeries) this.candleSeries.setData([]);
            if (this.barSeries) this.barSeries.setData([]);
            if (this.volumeSeries) this.volumeSeries.setData([]);
            
            this.chartData = [];
            this.lastCandle = null;
            this._candleTimeMap.clear();
            this._volumeDataCache = null;
            this._volumeDataDirty = true;
            this._lastVolumeUpdateIndex = -1;
            this._isTrimming = false;

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
                console.warn('⚠️ Все свечи отфильтрованы как невалидные');
                this.chart.applyOptions({ handleScroll: true, handleScale: true });
                return;
            }

            data.sort((a, b) => a.time - b.time);

            this.chartData = data;
            this._candleTimeMap.clear();
            for (let i = 0; i < data.length; i++) {
                this._candleTimeMap.set(data[i].time, i);
            }

            this.currentInterval = interval;
            this.currentSymbol = symbol;
            this.currentExchange = exchange;
            this.currentMarketType = marketType;
            this.hasMoreData = true;
            this._historyEndTime = data[0].time;
            this.lastCandle = data[data.length - 1];

            this.candleSeries.setData(this.chartData);
            this.barSeries.setData(this.chartData);

            if (this.volumeSeries && this.chartData.length > 0) {
                const volumeData = this._buildVolumeData(this.chartData);
                this.volumeSeries.setData(volumeData);
                this._volumeDataDirty = false;
                this._lastVolumeUpdateIndex = this.chartData.length - 1;
            }

            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            
            this.chart.applyOptions({ 
                handleScroll: true, 
                handleScale: true 
            });
            
            if (series) {
                const lineColor = this._getLineColor();
                series.applyOptions({ priceLineColor: lineColor });
                this._lastAppliedColor = lineColor;
            }

            const cachedPrecision = localStorage.getItem(`precision_${symbol}_${exchange}_${marketType}`);
            const inferredPrecision = this._inferPrecisionFromData();

            if (cachedPrecision) {
                this.applyPriceFormat(parseInt(cachedPrecision));
            } else {
                this.applyPriceFormat(inferredPrecision);
                localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, inferredPrecision);
            }

            setTimeout(() => {
                if (this.indicatorManager) {
                    this.indicatorManager.restorePendingIndicators();
                    this.indicatorManager.updateAllIndicators();
                    this.indicatorManager.loadIndicators();
                }
            }, 0);

            if (this.timerManager) {
                this.timerManager.start(this.currentInterval);
                this.timerManager.updatePrice(this.lastCandle.close);
            }

            if (currentScale && !isNewSymbol) {
                this._restoreScale(currentScale);
            } else {
                this.scrollToLast();
                this.autoScale();
            }
            
            this.scheduleUpdatePosition();
            this._updatePageTitle();

            if (this.timerManager) {
                requestAnimationFrame(() => {
                    if (this.timerManager) this.timerManager._forceUpdate();
                });
                
                if (isNewSymbol) {
                    setTimeout(() => {
                        if (this.timerManager) this.timerManager._forceUpdate();
                    }, 200);
                    setTimeout(() => {
                        if (this.timerManager) this.timerManager._forceUpdate();
                    }, 500);
                }
            }

            if (typeof getPrecisionFromExchange === 'function') {
                getPrecisionFromExchange(symbol, exchange, marketType)
                    .then(precision => {
                        if (this.currentSymbol === symbol) {
                            localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, precision);
                            this.applyPriceFormat(precision);
                            
                            setTimeout(() => {
                                if (this.timerManager) this.timerManager._forceUpdate();
                            }, 100);
                        }
                    })
                    .catch(() => {});
            }

            setTimeout(() => {
                if (window.renderDrawings) window.renderDrawings();
            }, 0);

            this._notifySymbolChange();
            this._lastTimeframe = interval;

            if (!window._dailySeparator && window.DailySeparator) {
                window._dailySeparator = new window.DailySeparator(this);
            }
            if (window._dailySeparator?.redraw) {
                window._dailySeparator.redraw();
            }
            
            if (!window._sessionHighlighter && window.SessionHighlighter) {
                window._sessionHighlighter = new window.SessionHighlighter(this);
            }
            if (window._sessionHighlighter?.redraw) {
                window._sessionHighlighter.redraw();
            }

            this.isLoadingMore = false;
            this._pendingHistoryLoad = false;
            this._lastHistoryLoadTime = 0;

        } catch (error) {
            console.error('❌ Критическая ошибка в setDataQuick:', error);
            this.chart.applyOptions({ handleScroll: true, handleScale: true });
        }
    }

    _captureScale() {
        try {
            const timeScale = this.chart.timeScale();
            const priceScale = this.chart.priceScale('right');
            const logicalRange = timeScale.getVisibleLogicalRange();
            const priceRange = priceScale.getVisiblePriceRange();
            
            if (logicalRange && priceRange) {
                return {
                    logical: { from: logicalRange.from, to: logicalRange.to },
                    price: { from: priceRange.from, to: priceRange.to }
                };
            }
        } catch (e) {}
        return null;
    }

    _restoreScale(scale) {
        if (!scale) return;
        try {
            const timeScale = this.chart.timeScale();
            
            if (scale.logical) {
                const currentDataLength = this.chartData.length;
                const from = Math.min(scale.logical.from, currentDataLength - 1);
                const to = Math.min(scale.logical.to, currentDataLength);
                
                if (from < to) {
                    timeScale.setVisibleLogicalRange({ from, to });
                }
            }
        } catch (e) {
            this.scrollToLast();
        }
    }

    _isNewSymbol(symbol) {
        return this.currentSymbol !== symbol;
    }

    _suspendAllUpdates() {
        this._updatesSuspended = true;
        if (this.priceManager) {
            this.priceManager.suspend?.();
        }
        if (this.timerManager) {
            this.timerManager.stop?.();
        }
    }

    _resumeAllUpdates(genId) {
        if (this._activeGeneration !== genId) return;
        this._updatesSuspended = false;
        if (this.priceManager) {
            this.priceManager.resume?.();
        }
    }

    async switchSymbol(symbol, exchange, marketType) {
        if (this._switchingSymbol) return;
        this._switchingSymbol = true;
        
        const generationId = ++this._generationCounter;
        this._activeGeneration = generationId;

        try {
            this._abortAllProcesses();
            this._suspendAllUpdates();
            
            if (this.candleSeries) this.candleSeries.setData([]);
            if (this.barSeries) this.barSeries.setData([]);
            if (this.volumeSeries) this.volumeSeries.setData([]);
            
            this.lastCandle = null;
            this.chartData = [];
            this._candleTimeMap.clear();
            this.currentSymbol = symbol;
            this.currentExchange = exchange;
            this.currentMarketType = marketType;

            if (window.wsManager?.updateSymbolAndTimeframe) {
                window.wsManager.updateSymbolAndTimeframe(symbol, this.currentInterval, exchange, marketType);
            }

            const cachedPrecision = localStorage.getItem(`precision_${symbol}_${exchange}_${marketType}`);
            if (cachedPrecision) this.applyPriceFormat(parseInt(cachedPrecision));

            let candles = await this.loadCandlesFromCache(symbol, exchange, marketType, this.currentInterval);
            let isFromCache = !!candles;
            
            if (!isFromCache) {
                candles = await this.fetchKlines(symbol, exchange, marketType, this.currentInterval, 1000);
            }
            
            if (!candles || candles.length === 0) {
                throw new Error('Нет данных для ' + symbol);
            }

            if (this._activeGeneration !== generationId) {
                console.log('🔄 Символ уже переключился, отменяем старую загрузку');
                return;
            }

            if (this.timerManager && this.timerManager.destroy) {
                this.timerManager.destroy();
            }

            this.setDataQuick(candles, this.currentInterval, symbol, exchange, marketType);
            
            setTimeout(() => {
                if (this.timerManager) this.timerManager._forceUpdate();
            }, 300);

            if (!isFromCache) {
                this.saveCandlesToCache(symbol, exchange, marketType, this.currentInterval, candles).catch(() => {});
            }

            this.loadDrawingsForCurrentSymbol();

            localStorage.setItem('lastSymbol', symbol);
            localStorage.setItem('lastExchange', exchange);
            localStorage.setItem('lastMarketType', marketType);
            this._notifySymbolChange();

            if (isFromCache) {
                this.refreshCandlesInBackground(symbol, exchange, marketType, this.currentInterval).catch(() => {});
            }
            
        } catch (error) {
            console.error('❌ Ошибка переключения:', error);
        } finally {
            if (this._activeGeneration === generationId) {
                this._switchingSymbol = false;
                this._resumeAllUpdates(generationId);
            }
        }
    }

    loadDrawingsForCurrentSymbol() {
        Promise.allSettled([
            window.rayManager?.loadRays?.(),
            window.trendLineManager?.loadTrendLines?.(),
            window.rulerLineManager?.loadRulers?.(),
            window.alertLineManager?.loadAlerts?.(),
            window.textManager?.loadTexts?.()
        ]).then(() => this.requestDrawingsRedraw());
    }

    onCrosshairMove(param) {
        if (document.hidden || !param || !param.time || !param.point) {
            if (this.overlay) this.overlay.classList.remove('visible');
            this._latestCrosshairData = null;
            this._clearPanelsCrosshair();
            return;
        }

        const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        const candle = param.seriesData.get(activeSeries);
        
        if (candle) {
            const isBullish = candle.close >= candle.open;
            const change = typeof Utils !== 'undefined' ? Utils.calculateChange(candle.open, candle.close) : '0';
            const changeNum = parseFloat(change);
            const index = this._candleTimeMap.get(param.time);
            const vol = index !== undefined ? (this.chartData[index].quoteVolume || 0) : 0;
            
            this._latestCrosshairData = {
                open: candle.open, 
                high: candle.high, 
                low: candle.low, 
                close: candle.close,
                change: (changeNum > 0 ? '+' : '') + change + '%',
                volume: typeof Utils !== 'undefined' ? Utils.formatVolume(vol) : vol,
                cls: isBullish ? 'bullish' : 'bearish', 
                visible: true,
                time: param.time,
                pointX: param.point.x
            };
        } else {
            this._latestCrosshairData = { visible: false, time: param.time, pointX: param.point.x };
        }
        
        if (!this._crosshairRafId) {
            this._crosshairRafId = requestAnimationFrame(() => {
                this._applyCrosshairDOMOptimized();
                this._syncPanelsCrosshairOptimized();
                this._crosshairRafId = null;
            });
        }
    }

    _clearPanelsCrosshair() {
        const panels = window.chartManager?.indicatorManager?.panelManager?.panels;
        if (!panels) return;
        for (let i = 0; i < panels.length; i++) {
            const panel = panels[i];
            if (panel.chart && !panel.isCollapsed) {
                try { panel.chart.clearCrosshairPosition(); } catch(e) {}
            }
        }
    }

    _syncPanelsCrosshairOptimized() {
        if (!this._latestCrosshairData || !this._latestCrosshairData.visible) {
            this._clearPanelsCrosshair();
            return;
        }

        const panels = window.chartManager?.indicatorManager?.panelManager?.panels;
        if (!panels) return;

        const { time, pointX } = this._latestCrosshairData;

        for (let i = 0; i < panels.length; i++) {
            const panel = panels[i];
            if (!panel.chart || panel.isCollapsed) continue;
            
            try {
                let targetSeries = null;
                for (const series of panel.series) { 
                    targetSeries = series; 
                    break; 
                }
                
                if (!targetSeries) { 
                    panel.chart.clearCrosshairPosition(); 
                    continue; 
                }
                
                const dataPoint = targetSeries.dataByIndex?.(this._candleTimeMap.get(time)); 
                
                if (dataPoint && dataPoint.value !== undefined) {
                    panel.chart.setCrosshairPosition(dataPoint.value, time, pointX);
                } else {
                    panel.chart.clearCrosshairPosition();
                }
            } catch(e) {}
        }
    }

    _applyCrosshairDOMOptimized() {
        const data = this._latestCrosshairData;
        if (!data || !data.visible) {
            if (this.overlay) this.overlay.classList.remove('visible');
            return;
        }

        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        const precision = series?.options()?.priceFormat?.precision ?? 2;
        
        const formatWithPrecision = (value) => {
            if (value === undefined || value === null || isNaN(value)) return '—';
            const key = `${value}_${precision}`;
            if (!this._formatCache.has(key)) {
                const formatted = Number(value).toFixed(precision);
                this._formatCache.set(key, formatted);
                if (this._formatCache.size > 500) {
                    this._formatCache.delete(this._formatCache.keys().next().value);
                }
                return formatted;
            }
            return this._formatCache.get(key);
        };

        const bullishColor = this.bullishColor || CONFIG?.colors?.bullish || '#26a69a';
        const bearishColor = this.bearishColor || CONFIG?.colors?.bearish || '#ef5350';
        const color = data.cls === 'bullish' ? bullishColor : bearishColor;

        if (this._lastCrosshairColor !== color) {
            this._lastCrosshairColor = color;
            const styleColor = `color: ${color}`;
            if (this.openEl) this.openEl.style.cssText = styleColor;
            if (this.highEl) this.highEl.style.cssText = styleColor;
            if (this.lowEl) this.lowEl.style.cssText = styleColor;
            if (this.closeEl) this.closeEl.style.cssText = styleColor;
            if (this.changeEl) this.changeEl.style.cssText = styleColor;
            if (this.volumeEl) this.volumeEl.style.cssText = styleColor;
        }

        const baseClass = `stat-value ${data.cls}`;
        const changeClass = `change-value ${data.cls}`;

        let newText;
        
        newText = formatWithPrecision(data.open);
        if (this.openEl && this.openEl.textContent !== newText) this.openEl.textContent = newText;
        if (this.openEl && this.openEl.className !== baseClass) this.openEl.className = baseClass;

        newText = formatWithPrecision(data.high);
        if (this.highEl && this.highEl.textContent !== newText) this.highEl.textContent = newText;
        if (this.highEl && this.highEl.className !== baseClass) this.highEl.className = baseClass;

        newText = formatWithPrecision(data.low);
        if (this.lowEl && this.lowEl.textContent !== newText) this.lowEl.textContent = newText;
        if (this.lowEl && this.lowEl.className !== baseClass) this.lowEl.className = baseClass;

        newText = formatWithPrecision(data.close);
        if (this.closeEl && this.closeEl.textContent !== newText) this.closeEl.textContent = newText;
        if (this.closeEl && this.closeEl.className !== baseClass) this.closeEl.className = baseClass;

        if (this.changeEl && this.changeEl.textContent !== data.change) this.changeEl.textContent = data.change;
        if (this.changeEl && this.changeEl.className !== changeClass) this.changeEl.className = changeClass;

        if (this.volumeEl && this.volumeEl.textContent !== data.volume) this.volumeEl.textContent = data.volume;
        if (this.volumeEl && this.volumeEl.className !== baseClass) this.volumeEl.className = baseClass;

        if (this.overlay && !this.overlay.classList.contains('visible')) {
            this.overlay.classList.add('visible');
        }
    }

    updateRealPrice(price) { 
        this._syncPriceLine(price); 
    }
    
    scrollToLast(enableRealTime = true) {
        if (!this.chart || !this.chartData || this.chartData.length === 0) {
            console.warn('⚠️ scrollToLast: График не готов или нет данных');
            return false;
        }

        try {
            this._isViewingHistory = false;
            
            this.lastCandle = this.chartData[this.chartData.length - 1];
            
            const timeScale = this.chart.timeScale();
            if (!timeScale) {
                console.warn('⚠️ scrollToLast: timeScale недоступен');
                return false;
            }

            if (enableRealTime) {
                const visibleBars = Math.floor(this.chartContainer.clientWidth / 12);
                const lastIndex = this.chartData.length - 1;
                const rightOffsetBars = 10;
                
                timeScale.setVisibleLogicalRange({
                    from: Math.max(0, lastIndex - visibleBars - rightOffsetBars),
                    to: lastIndex + rightOffsetBars
                });
            } else {
                const currentRange = timeScale.getVisibleLogicalRange();
                if (currentRange) {
                    const visibleBars = currentRange.to - currentRange.from;
                    const lastIndex = this.chartData.length - 1;
                    timeScale.setVisibleLogicalRange({
                        from: Math.max(0, lastIndex - visibleBars + 1),
                        to: lastIndex + 1
                    });
                }
            }

            const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            if (activeSeries && this.lastCandle) {
                activeSeries.update({
                    time: this.lastCandle.time,
                    open: this.lastCandle.open,
                    high: this.lastCandle.high,
                    low: this.lastCandle.low,
                    close: this.lastCandle.close
                });
            }

            if (this.timerManager) {
                this.timerManager.updatePosition(this.lastCandle.close);
            }

            return true;
        } catch (e) {
            console.error('❌ Ошибка в scrollToLast:', e);
            return false;
        }
    }

    clearChart() {
        if (this.candleSeries) this.candleSeries.setData([]);
        if (this.barSeries) this.barSeries.setData([]);
        if (this.volumeSeries) this.volumeSeries.setData([]);
        this.chartData = [];
        this.lastCandle = null;
        this._volumeDataCache = null;
        this._volumeDataDirty = true;
        this._lastVolumeUpdateIndex = -1;
        this._isTrimming = false;
        const priceScale = this.chart.priceScale('right');
        if (priceScale) priceScale.applyOptions({ autoScale: true });
    }

    autoScale() {
        if (!this.chart || !this.chartData || this.chartData.length === 0) return;
        const priceScale = this.chart.priceScale('right');
        if (!priceScale) return;
        if (this._autoScalePending) return;
        
        this._autoScalePending = true;
        const genId = this._activeGeneration;
        
        priceScale.applyOptions({ 
            autoScale: true, 
            scaleMargins: { top: 0.1, bottom: 0.1 } 
        });
        
        setTimeout(() => {
            if (this._activeGeneration === genId && this._autoScalePending) {
                const ps = this.chart?.priceScale('right');
                if (ps) {
                    ps.applyOptions({ autoScale: false });
                }
                this._autoScalePending = false;
            }
        }, 50);
    }

    getLastCandle() { return this.lastCandle; }
    getChart() { return this.chart; }
    setCurrentInterval(interval) { this.currentInterval = interval; }

    getCurrentPrice() {
        if (this.priceManager) { 
            const price = this.priceManager.getPrice(this.currentSymbol); 
            if (price !== null && !isNaN(price)) return price; 
        }
        if (this.currentRealPrice !== null && this.currentRealPrice !== undefined && !isNaN(this.currentRealPrice)) return this.currentRealPrice;
        return null;
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
        if (volumeScale) volumeScale.applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    }

    _resizeIndicatorPanels() {
        const chartContainer = document.getElementById('chart-container');
        if (!chartContainer) return;
        const width = chartContainer.clientWidth;
        if (this.indicatorManager?.panelManager) {
            this.indicatorManager.panelManager.resize(width);
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

    _subscribeToPrice() {
        if (!this.priceManager) {
            setTimeout(() => this._subscribeToPrice(), 100);
            return;
        }

        if (this._priceSubscriptionKey && this._priceUpdateHandler) {
            this.priceManager.unsubscribe(this._priceSubscriptionKey, this._priceUpdateHandler);
            this._priceUpdateHandler = null;
            this._priceSubscriptionKey = null;
        }

        const key = `${this.currentSymbol}:${this.currentExchange}:${this.currentMarketType}`;
        this._priceSubscriptionKey = key;

        this._priceUpdateHandler = (price, symbol, exchange, marketType) => {
            if (this._switchingSymbol || this._updatesSuspended) return;
            if (symbol !== this.currentSymbol || exchange !== this.currentExchange || marketType !== this.currentMarketType) return;
            
            this.currentRealPrice = price;
            this._updatePageTitle();
            
            if (!document.hidden) {
                this._syncPriceLine(price);
                if (this.timerManager) {
                    this.timerManager.updatePrice(price);
                }
            }
        };

        this.priceManager.subscribe(key, this._priceUpdateHandler, this.currentExchange, this.currentMarketType);
        this._startBackgroundTitleUpdate();
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
                precision = this._inferPrecisionFromData();
            }
            const minMove = Math.pow(10, -precision);
            const priceFormat = { type: 'price', precision: precision, minMove: minMove };
            if (this.candleSeries) this.candleSeries.applyOptions({ priceFormat });
            if (this.barSeries) this.barSeries.applyOptions({ priceFormat });
            const priceScale = this.chart.priceScale('right');
            if (priceScale) priceScale.applyOptions({ priceFormat: priceFormat });
            
            if (this.timerManager) {
                requestAnimationFrame(() => {
                    if (this.timerManager) this.timerManager._forceUpdate();
                });
            }
            
            return precision;
        } catch (error) {
            console.error('❌ КРИТИЧЕСКАЯ ОШИБКА applyPriceFormat:', error);
            return this._inferPrecisionFromData();
        }
    }

    _isValidCandle(candle) {
        if (!candle || typeof candle !== 'object') return false;
        if (typeof candle.time !== 'number' || isNaN(candle.time) || candle.time <= 0) return false;
        const ohlcFields = ['open', 'high', 'low', 'close'];
        for (const field of ohlcFields) {
            const val = candle[field];
            if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) return false;
        }
        if (candle.high < candle.low) return false;
        if (candle.open > candle.high || candle.open < candle.low || candle.close > candle.high || candle.close < candle.low) return false;
        if (candle.volume !== undefined && candle.volume !== null) {
            if (typeof candle.volume !== 'number' || isNaN(candle.volume) || candle.volume < 0) return false;
        }
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
        if (this._candleTimeMap.has(candle.time)) return;
        
        const lastCandle = this.chartData[this.chartData.length - 1];
        if (lastCandle && candle.time <= lastCandle.time) return;
        
        this.chartData.push(candle);
        this._addToTimeMap(candle.time, this.chartData.length - 1);
        this.lastCandle = candle;
        this.currentRealPrice = candle.close;

        this._lastAppliedColor = this._getLineColor();
        
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (series) {
            series.update({
                time: candle.time,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close
            });
            series.applyOptions({ 
                priceLineColor: this._lastAppliedColor,
                priceLineSource: candle.close
            });
        }
        if (this.volumeSeries) {
            const isBullish = candle.close >= candle.open;
            this.volumeSeries.update({
                time: candle.time,
                value: candle.volume || 0,
                color: isBullish ? this.bullishColor : this.bearishColor
            });
            this._lastVolumeUpdateIndex = this.chartData.length - 1;
        }
        if (this.timerManager) {
            this.timerManager.updatePrice(candle.close);
            this.timerManager.start(this.currentInterval);
        }
        this._priceChanged = true;
        this._volumeDataDirty = true;
    }

    _buildVolumeData(data) {
        const bullishColor = this.bullishColor || CONFIG.colors.bullish || '#26a69a';
        const bearishColor = this.bearishColor || CONFIG.colors.bearish || '#ef5350';
        
        if (this._volumeDataCache && !this._volumeDataDirty && data === this.chartData) {
            return this._volumeDataCache;
        }
        
        const volumeData = new Array(data.length);
        for (let i = 0; i < data.length; i++) {
            const c = data[i];
            volumeData[i] = {
                time: c.time,
                value: c.quoteVolume || 0, 
                color: c.close >= c.open ? bullishColor : bearishColor
            };
        }
        
        if (data === this.chartData) {
            this._volumeDataCache = volumeData;
            this._volumeDataDirty = false;
        }
        
        return volumeData;
    }

    _updateVolumeOptimized() {
        if (!this.volumeSeries || !this.chartData.length) return;
        
        if (this._volumeDataDirty && this._lastVolumeUpdateIndex === this.chartData.length - 1) {
            const lastCandle = this.chartData[this.chartData.length - 1];
            const isBullish = lastCandle.close >= lastCandle.open;
            this.volumeSeries.update({
                time: lastCandle.time,
                value: lastCandle.quoteVolume || lastCandle.volume || 0,
                color: isBullish ? this.bullishColor : this.bearishColor
            });
            this._volumeDataDirty = false;
            return;
        }

        if (this._volumeDataDirty) {
            const volumeData = this._buildVolumeData(this.chartData);
            this.volumeSeries.setData(volumeData);
            this._volumeDataDirty = false;
            this._lastVolumeUpdateIndex = this.chartData.length - 1;
        }
    }

    async fetchKlines(symbol, exchange, marketType, interval, limit = 1000, endTime = null, requestType = 'user') {
        let controller;
        if (requestType === 'history') {
            if (this._historyFetchController) {
                this._historyFetchController.abort();
            }
            this._historyFetchController = new AbortController();
            controller = this._historyFetchController;
        } else if (requestType === 'background') {
            if (this._backgroundFetchController) {
                this._backgroundFetchController.abort();
            }
            this._backgroundFetchController = new AbortController();
            controller = this._backgroundFetchController;
        } else {
            if (this._currentFetchController) {
                this._currentFetchController.abort();
            }
            this._currentFetchController = new AbortController();
            controller = this._currentFetchController;
        }
        
        const signal = controller.signal;

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
            if (endTime) url += `&endTime=${endTime}`;
        } else {
            const bybitInt = bybitIntervalMap[interval] || interval;
            const cat = marketType === 'futures' ? 'linear' : 'spot';
            url = `https://api.bybit.com/v5/market/kline?category=${cat}&symbol=${symbol}&interval=${bybitInt}&limit=${limit}`;
            if (endTime) url += `&end=${endTime}`;
        }

        try {
            const response = await fetch(url, { signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            let rawCandles;
            if (exchange === 'binance') {
                if (!Array.isArray(data)) {
                    throw new Error('Binance: ожидался массив, получен ' + typeof data);
                }
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
                if (data.retCode !== 0) {
                    throw new Error(`Bybit error: ${data.retCode} - ${data.retMsg}`);
                }
                if (!data.result || !data.result.list) {
                    throw new Error('Bybit: неожиданный формат ответа');
                }
                rawCandles = data.result.list
                    .map(item => ({
                        time: Math.floor(parseInt(item[0]) / 1000),
                        open: parseFloat(item[1]),
                        high: parseFloat(item[2]),
                        low: parseFloat(item[3]),
                        close: parseFloat(item[4]),
                        volume: parseFloat(item[5] || 0),
                        quoteVolume: parseFloat(item[6] || 0)
                    }))
                    .filter(c => c.time > 0 && !isNaN(c.open))
                    .reverse();
            }
            
            if (signal.aborted) {
                return [];
            }
            
            const seenTimes = new Set();
            const noDupes = rawCandles.filter(c => {
                if (seenTimes.has(c.time)) return false;
                seenTimes.add(c.time);
                return true;
            });
            const validCandles = noDupes.filter(c => this._isValidCandle(c));
            validCandles.sort((a, b) => a.time - b.time);
            
            return validCandles;
            
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log(`🛑 fetchKlines прерван (${requestType})`);
            } else {
                console.error('❌ Ошибка fetchKlines:', error);
            }
            return [];
        } finally {
            if (requestType === 'history' && this._historyFetchController?.signal === signal) {
                this._historyFetchController = null;
            } else if (requestType === 'background' && this._backgroundFetchController?.signal === signal) {
                this._backgroundFetchController = null;
            } else if (requestType === 'user' && this._currentFetchController?.signal === signal) {
                this._currentFetchController = null;
            }
        }
    }

    _updatePageTitle() {
        const symbol = this.currentSymbol || '';
        let price = this.currentRealPrice;
        if (!price && this.lastCandle) price = this.lastCandle.close;
        if (!price && this.chartData?.length > 0) price = this.chartData[this.chartData.length - 1].close;
        
        if (!symbol) { document.title = 'График'; return; }
        
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

    updateColorsForSettings(bullishColor, bearishColor) {
        CONFIG.colors.bullish = bullishColor;
        CONFIG.colors.bearish = bearishColor;
        this.bullishColor = bullishColor;
        this.bearishColor = bearishColor;
        
        this.candleSeries.applyOptions({ 
            upColor: bullishColor, 
            downColor: bearishColor, 
            wickUpColor: bullishColor, 
            wickDownColor: bearishColor 
        });
        this.barSeries.applyOptions({ 
            upColor: bullishColor, 
            downColor: bearishColor 
        });
        this._syncLineAndTimerColor();
        
        this._volumeDataDirty = true;
        if (this.volumeSeries && this.chartData.length > 0) {
            this._updateVolumeOptimized();
        }
    }

    _syncLineAndTimerColor() {
        if (!this.chartData || this.chartData.length === 0) return;
        const lastCandle = this.chartData[this.chartData.length - 1];
        if (!lastCandle) return;
        
        const price = lastCandle.close;
        if (!price || isNaN(price)) return;
        
        const lineColor = this._getLineColor();
        
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        
        if (series) {
            series.applyOptions({ 
                priceLineColor: lineColor,
                priceLineSource: 'lastBar'
            });
        }
        
        if (this.timerManager) {
            this.timerManager.updatePosition(price);
        }
        
        this._lastAppliedColor = lineColor;
    }

    _abortAllProcesses() {
        if (this._bgTitleInterval) {
            clearInterval(this._bgTitleInterval);
            this._bgTitleInterval = null;
        }
        if (this._periodicSyncInterval) {
            clearInterval(this._periodicSyncInterval);
            this._periodicSyncInterval = null;
        }
        if (this._quarantineTimeout) {
            clearTimeout(this._quarantineTimeout);
            this._quarantineTimeout = null;
        }
        if (this.priceManager && this._priceUpdateHandler) {
            this.priceManager.unsubscribe(this.currentSymbol, this._priceUpdateHandler);
            this._priceUpdateHandler = null;
        }
        if (this.timerManager && this.timerManager.destroy) this.timerManager.destroy();
        this._loadingSymbol = false;
        this.isLoadingMore = false;
        this._updateScheduled = false;
        this._pendingUpdates = false;
        this._pendingRedraw = false;
        if (this._drawingsUpdateRafId) { cancelAnimationFrame(this._drawingsUpdateRafId); this._drawingsUpdateRafId = null; }
        if (this._updatePositionRafId) { cancelAnimationFrame(this._updatePositionRafId); this._updatePositionRafId = null; }
        if (this._currentFetchController) { this._currentFetchController.abort(); this._currentFetchController = null; }
        if (this._historyFetchController) { this._historyFetchController.abort(); this._historyFetchController = null; }
        if (this._backgroundFetchController) { this._backgroundFetchController.abort(); this._backgroundFetchController = null; }
        if (this._updateTimeout) { clearTimeout(this._updateTimeout); this._updateTimeout = null; }
        if (this._trimDebounceTimeout) { clearTimeout(this._trimDebounceTimeout); this._trimDebounceTimeout = null; }
        if (this._candleCheckerTimeout) { clearTimeout(this._candleCheckerTimeout); this._candleCheckerTimeout = null; }
        this._fetchPromise = null;
        this._volumeDataDirty = true;
        this._lastVolumeUpdateIndex = -1;
        this._isTrimming = false;
    }

    saveCurrentTimePosition() {
        if (!this.chart || !this.chartData.length) return null;
        const timeScale = this.chart.timeScale();
        const visibleRange = timeScale.getVisibleLogicalRange();
        if (visibleRange) {
            const firstVisibleIndex = Math.floor(visibleRange.from);
            if (firstVisibleIndex >= 0 && firstVisibleIndex < this.chartData.length) return this.chartData[firstVisibleIndex].time;
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

    getCurrentSymbolKey() { return `${this.currentSymbol}:${this.currentExchange}:${this.currentMarketType}`; }

    updatePricePrecision(symbol, exchange, marketType) {
        const cachedPrecision = localStorage.getItem(`precision_${symbol}_${exchange}_${marketType}`);
        if (cachedPrecision) { this.applyPriceFormat(parseInt(cachedPrecision)); return; }
        this.applyPriceFormat(this._inferPrecisionFromData());
        if (typeof getPrecisionFromExchange === 'function') {
            getPrecisionFromExchange(symbol, exchange, marketType)
                .then(precision => { 
                    this.applyPriceFormat(precision); 
                    localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, precision); 
                })
                .catch(() => {});
        }
    }

    forceRedraw() {
        if (!this.chart || !this.chartData.length) return;
        const width = this.chartContainer.clientWidth;
        const height = this.chartContainer.clientHeight;
        this.chart.resize(width + 1, height);
        this.chart.resize(width, height);
        if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
    }

    _subscribeToSymbolChange(callback) {
        this._symbolChangeCallbacks = this._symbolChangeCallbacks || [];
        this._symbolChangeCallbacks.push(callback);
    }

    _notifySymbolChange() {
        if (this._symbolChangeCallbacks) this._symbolChangeCallbacks.forEach(cb => cb());
    }

    async saveCandlesToCache(symbol, exchange, marketType, interval, candles) {
        if (!candles || candles.length === 0) return;
        const CACHE_VERSION = '2';
        const key = `${symbol}_${interval}_${exchange}_${marketType}_v${CACHE_VERSION}`;
        const cacheData = { 
            key, symbol, exchange, marketType, interval, 
            data: candles, lastUpdate: Date.now(), 
            firstCandleTime: candles[0].time, 
            lastCandleTime: candles[candles.length - 1].time, 
            count: candles.length, version: CACHE_VERSION 
        };
        if (!window.db) return;
        try {
            if (!window.dbReady) {
                await new Promise(resolve => {
                    const check = setInterval(() => { 
                        if (window.dbReady) { clearInterval(check); resolve(); } 
                    }, 100);
                    setTimeout(() => { clearInterval(check); resolve(); }, 2000);
                });
            }
            await window.db.put('candles', cacheData);
        } catch (error) { console.warn('❌ Ошибка сохранения свечей в кэш:', error); }
    }
    
    async loadCandlesFromCache(symbol, exchange, marketType, interval) {
        const CACHE_VERSION = '2';
        const key = `${symbol}_${interval}_${exchange}_${marketType}_v${CACHE_VERSION}`;
        if (!window.db) return null;
        try {
            const cached = await window.db.get('candles', key);
            if (!cached) return null;
            if (cached.version !== CACHE_VERSION) { 
                await window.db.delete('candles', key); 
                return null; 
            }
            const CACHE_DURATION = 5 * 60 * 1000;
            if (Date.now() - cached.lastUpdate > CACHE_DURATION) return null;
            return cached.data;
        } catch (error) { return null; }
    }

    async clearOldCaches() {
        const CACHE_VERSION = '2';
        try {
            if (!window.db) return;
            const allCandles = await window.db.getAll('candles');
            for (const cache of allCandles) { 
                if (!cache.version || cache.version !== CACHE_VERSION) {
                    await window.db.delete('candles', cache.key); 
                }
            }
        } catch (e) { console.warn('Ошибка очистки кэша свечей:', e); }
    }

    async clearOldCandlesCache(maxAge = 24 * 60 * 60 * 1000) {
        try {
            if (!window.db) return;
            const allCandles = await window.db.getAll('candles');
            const now = Date.now();
            for (const cached of allCandles) { 
                if (now - cached.lastUpdate > maxAge) {
                    await window.db.delete('candles', cached.key); 
                }
            }
        } catch (error) { console.warn('❌ Ошибка очистки кэша свечей:', error); }
    }

    async waitForReady() {
        let attempts = 0;
        const maxAttempts = 50;
        while (attempts < maxAttempts) {
            if (this.chart && this.candleSeries && this.chartData && this.chartData.length > 0 && this.chart.timeScale()?.getVisibleRange()) return true;
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }
        return false;
    }

    async waitForSeriesReady() { return this.waitForReady(); }

    timeToCoordinate(time) { 
        try { return this.chart.timeScale().timeToCoordinate(time); } 
        catch (e) { return null; } 
    }
    
    coordinateToTime(coordinate) { 
        try { return this.chart.timeScale().coordinateToTime(coordinate); } 
        catch (e) { return null; } 
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
        const firstCandle = data[0];
        const lastCandle = data[data.length - 1];
        const firstX = this.timeToCoordinate(firstCandle.time);
        const lastX = this.timeToCoordinate(lastCandle.time);
        if (firstX === null || lastX === null) return null;
        const pixelsPerMs = (lastX - firstX) / (lastCandle.time - firstCandle.time);
        if (time < firstCandle.time) return firstX - (firstCandle.time - time) * pixelsPerMs;
        else return lastX + (time - lastCandle.time) * pixelsPerMs;
    }

    priceToCoordinateWithFallback(price) { return this.priceToCoordinate(price); }
    
    timeToLogical(time) { 
        if (!this.chartData || !this.chartData.length) return null; 
        const index = this._candleTimeMap.get(time); 
        return index !== undefined ? index : null; 
    }
    
    coordinateToPrice(coordinate) { 
        try { 
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries; 
            return series.coordinateToPrice(coordinate); 
        } catch (e) { return null; } 
    }

    onVisibleLogicalRangeChange(range) {
        if (!range || !this.chartData.length) return;
        const fromIndex = Math.max(0, Math.floor(range.from));
        if (fromIndex < this._preloadThreshold && this.hasMoreData && !this.isLoadingMore) {
            this._loadHistoryAsync();
        }
        this._scheduleTrim(range);
    }

    _scheduleTrim(range) {
        if (this._isTrimming || this.isLoadingMore) return;
        const fromIndex = Math.max(0, Math.floor(range.from));
        const toIndex = Math.min(this.chartData.length - 1, Math.ceil(range.to));
        this._pendingTrimParams = { fromIndex, toIndex };
        if (this._trimDebounceTimeout) clearTimeout(this._trimDebounceTimeout);
        this._trimDebounceTimeout = setTimeout(() => {
            this._applyPendingTrim();
            this._trimDebounceTimeout = null;
        }, this._trimDebounceDelay);
    }

    _applyPendingTrim() {
        if (this._pendingTrimParams && !this._isTrimming) {
            const { fromIndex, toIndex } = this._pendingTrimParams;
            this._performTrimNow(fromIndex, toIndex);
            this._pendingTrimParams = null;
        }
    }

    _performTrimNow(fromIndex, toIndex) {
        if (this._isTrimming || this.isLoadingMore) return;
        if (!this._isScrolling && this.chartData.length <= this._maxCandlesInMemory) return;
        
        const keepFrom = Math.max(0, fromIndex - (this._leftBuffer * 1.5));
        const keepTo = Math.min(this.chartData.length, toIndex + (this._rightBuffer * 1.5));
        const leftTrim = keepFrom;
        const rightTrim = this.chartData.length - keepTo;
        
        if (leftTrim === 0 && rightTrim === 0) return;
        this._isTrimming = true;
        
        try {
            this.chartData = this.chartData.slice(keepFrom, keepTo);
            this._rebuildTimeMap();
            this._volumeDataDirty = true;
            this._lastVolumeUpdateIndex = -1;
            
            const timeScale = this.chart.timeScale();
            const currentRange = timeScale.getVisibleLogicalRange();
            const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;

            const priceScale = this.chart.priceScale('right');
            priceScale.applyOptions({ autoScale: false });

            if (activeSeries) {
                activeSeries.setData(this.chartData);
            }
            this._updateVolumeOptimized();
            
            if (currentRange && leftTrim > 0) {
                timeScale.setVisibleLogicalRange({
                    from: Math.max(0, currentRange.from - leftTrim),
                    to: Math.max(1, currentRange.to - leftTrim)
                });
            }

            if (leftTrim > 0 || rightTrim > 0) {
                requestAnimationFrame(() => {
                    if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
                });
            }

            this.lastCandle = this.chartData[this.chartData.length - 1];
            this._syncLineColor();

            if (this.timerManager) {
                this.timerManager.updatePosition(this.lastCandle.close);
            }

        } catch (e) {
            console.error('❌ Ошибка обрезки данных:', e);
        } finally {
            this._isTrimming = false;
        }
    }

    async _loadHistoryAsync() {
        if (this.isLoadingMore || !this.hasMoreData) return;
        
        const now = Date.now();
        if (now - this._lastHistoryLoadTime < 1500) return;
        
        this.isLoadingMore = true;
        this._lastHistoryLoadTime = now;
        
        try {
            const oldestCandle = this.chartData[0];
            if (!oldestCandle) { 
                this.hasMoreData = false;
                this.isLoadingMore = false;
                return; 
            }
            
            const endTime = (oldestCandle.time * 1000) - 1;
            const olderCandles = await this.fetchKlines(
                this.currentSymbol, 
                this.currentExchange, 
                this.currentMarketType, 
                this.currentInterval, 
                this._batchSize, 
                endTime,
                'history'
            );
            
            if (!olderCandles || olderCandles.length === 0) {
                this.hasMoreData = false;
                this.isLoadingMore = false;
                return;
            }
            
            const oldestExistingTime = this.chartData[0].time;
            const uniqueOlder = olderCandles.filter(c => c.time < oldestExistingTime);
            
            if (uniqueOlder.length > 0) {
                const timeScale = this.chart.timeScale();
                const currentRange = timeScale.getVisibleLogicalRange();
                const addedCount = uniqueOlder.length;
                
                this.chartData = [...uniqueOlder, ...this.chartData];
                
                if (this.chartData.length > this._maxCandlesInMemory + 500) {
                    this.chartData = this.chartData.slice(0, this._maxCandlesInMemory);
                }
                
                this._rebuildTimeMap();
                this.lastCandle = this.chartData[this.chartData.length - 1];
                this._volumeDataDirty = true;
                this._lastVolumeUpdateIndex = -1;
                
                const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;

                const priceScale = this.chart.priceScale('right');
                priceScale.applyOptions({ autoScale: false });

                if (activeSeries) {
                    activeSeries.setData(this.chartData);
                }
                this._updateVolumeOptimized();
                
                if (currentRange) {
                    timeScale.setVisibleLogicalRange({ 
                        from: currentRange.from + addedCount, 
                        to: currentRange.to + addedCount 
                    });
                }
                
                requestAnimationFrame(() => {
                    if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
                    this.scheduleDrawingsUpdate(true);
                });

                if (this.timerManager) {
                    this.timerManager.updatePosition(this.lastCandle.close);
                }
            }
            
            if (olderCandles.length < this._batchSize) {
                this.hasMoreData = false;
            }
            
        } catch (e) {
            console.error('❌ Ошибка загрузки истории:', e);
            this.hasMoreData = false;
        } finally {
            this.isLoadingMore = false;
        }
    }

    async refreshCandlesInBackground(symbol, exchange, marketType, interval) {
        try {
            if (symbol !== this.currentSymbol || exchange !== this.currentExchange) return;
            const freshCandles = await this.fetchKlines(
                symbol, exchange, marketType, interval, 100,
                null,
                'background'
            );
            if (!freshCandles || freshCandles.length === 0) return;
            if (symbol !== this.currentSymbol) return;

            const lastCachedTime = this.chartData.length > 0 ? this.chartData[this.chartData.length - 1].time : 0;
            const lastFreshTime = freshCandles[freshCandles.length - 1].time;
            
            if (lastFreshTime > lastCachedTime) {
                const newCandles = freshCandles.filter(c => c.time > lastCachedTime);
                this.chartData.push(...newCandles);
                this._rebuildTimeMap();
                this._volumeDataDirty = true;
                this._lastVolumeUpdateIndex = -1;
                const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
                if (activeSeries) activeSeries.setData(this.chartData);
                this._updateVolumeOptimized();
                this._syncLineColor();
                if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
                this.scrollToLast();
            }
        } catch (error) { console.warn('⚠️ Ошибка фонового обновления:', error); }
    }

    scheduleDrawingsUpdate(forceHighPriority = false) {
        if (document.hidden) return;
        if (this._isVerticalZooming) return;
        
        const now = performance.now();
        let delay;
        if (forceHighPriority) delay = 0;
        else if (this._isScrollingFast) delay = 50;
        else if (this._isScrolling) delay = 100;
        else delay = 150;

        if (now - (this._lastDrawingsCall || 0) < delay) {
            if (!this._drawingsFinalUpdateTimeout) {
                this._drawingsFinalUpdateTimeout = setTimeout(() => {
                    this._drawingsFinalUpdateTimeout = null;
                    if (window.renderDrawings) window.renderDrawings();
                }, delay);
            }
            return;
        }
        this._lastDrawingsCall = now;

        if (this._drawingsUpdateRafId === null && window.renderDrawings) {
            this._drawingsUpdateRafId = requestAnimationFrame(() => {
                window.renderDrawings();
                this._drawingsUpdateRafId = null;
            });
        }
    }
    
    manualAutoScale() {
        this.autoScale();
    }
    
    requestDrawingsRedraw() {
        if (document.hidden) return;
        
        if (this._isScrolling || this._isScrollingFast) {
            this._pendingDrawingsRedraw = true;
            return;
        }
        
        if (this._drawingsRafId !== null) return;
        
        this._drawingsRafId = requestAnimationFrame(() => {
            this._drawingsRafId = null;
            this._performDrawingsRedraw();
        });
    }

    _performDrawingsRedraw() {
        if (this.rayManager?._applyRedrawIfNeeded) this.rayManager._applyRedrawIfNeeded();
        if (this.trendLineManager?._requestRedraw) this.trendLineManager._requestRedraw();
        if (this.rulerLineManager?._requestRedraw) this.rulerLineManager._requestRedraw();
        if (this.alertLineManager?._applyRedrawsIfNeeded) this.alertLineManager._applyRedrawsIfNeeded();
        if (this.textManager?._requestRedraw) this.textManager._requestRedraw();
    }
}

if (typeof window !== 'undefined') {
    window.ChartManager = ChartManager;
}
