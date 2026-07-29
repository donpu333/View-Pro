class ChartManager {
    constructor(container) {
        this.chartData = [];
        this.lastCandle = null;
        this._loadingSymbol = false;
        this.indicatorManager = new IndicatorManager(this);
        this.chartContainer = document.getElementById('chart-container');
        
        const savedChartType = localStorage.getItem('chartType') || 'candle';
        this.currentChartType = savedChartType;
        
        this.isLoadingMore = false;
        this.hasMoreData = true;
        this._priceSubscriptionKey = null;
        this.currentInterval = localStorage.getItem('lastTimeframe') || (typeof CONFIG !== 'undefined' ? CONFIG.defaultInterval : '1h');
        this.currentSymbol = (typeof CONFIG !== 'undefined' ? CONFIG.defaultSymbol : 'BTCUSDT');
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
        this._lastSyncedPrice = null;
        this._priceChanged = false;
        this._fullDataLoadTimeout = null;
        this._autoScalePending = false;
        this._isVerticalZooming = false;
        this._priceLineTimer = document.getElementById('priceLineTimer') || null;
        this._crosshairRafId = null;
        this._latestCrosshairData = null;
        this._drawingsRafId = null;
  
this._tempCandleUpdate = { time: 0, open: 0, high: 0, low: 0, close: 0 };
        this._candleTimeMap = new Map();
        
        this._isScrolling = false;
        this._pendingSetData = false;
        this._debouncedSetData = this._debouncedSetData.bind(this);
        this._isScrollingFast = false;
        this._lastDrawingsCall = 0;
        this._drawingsFinalUpdateTimeout = null;
        this._scrollStopTimeout = null;

        this._lastScrollTime = 0;
        this._panelsSyncRafId = null;
        this._lastVisibleRange = null;

        this._historyLoadQueue = [];
        this._preloadThreshold = 400;
        this._batchSize = 500;
        this._minLoadDelay = 1000;
        this._lastHistoryLoadTime = 0;
        this._pendingHistoryLoad = false;
        this._historyEndTime = null;
        this._fetchPromise = null;

        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        this._maxCandlesInMemory = isMobile ? 3000 : 8000;
        this._leftBuffer = isMobile ? 1000 : 3000;
        this._rightBuffer = isMobile ? 500 : 1500;
        
        this._trimDebounceTimeout = null;
        this._trimDebounceDelay = isMobile ? 500 : 300; 
        this._pendingTrimParams = null;
        this._isTrimming = false;
        
        this._volumeDataCache = null;
        this._volumeDataDirty = true;
        
        // 🚀 ПЕРЕМЕННАЯ ДЛЯ ТРОТТЛИНГА DOM-ЭФФЕКТОВ ЦЕНЫ
        this._priceEffectRafId = null;
        this._lastVolumeUpdateIndex = -1;
        this._pendingDrawingsRedraw = false;

        this._visibilityHandler = () => {
            if (!document.hidden) {
                if (window.wsManager) {
                    window.wsManager.ensureConnected?.();
                }
                const price = this.getCurrentPrice();
                if (price != null) {
                    this._syncPriceLine(price);
                }
                this.scheduleDrawingsUpdate(true);
                this.requestDrawingsRedraw();
                if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
       
        this._priceUpdateHandler = null;
        this._candleCheckerTimeout = null;

        this.scheduleDrawingsUpdate = this.scheduleDrawingsUpdate.bind(this);
        this.onVisibleLogicalRangeChange = this.onVisibleLogicalRangeChange.bind(this);

        this.overlay = this._safeElement('candleStatsOverlay');
        this.openEl = this._safeElement('openValue');
        this.highEl = this._safeElement('highValue');
        this.lowEl = this._safeElement('lowValue');
        this.closeEl = this._safeElement('closeValue');
        this.changeEl = this._safeElement('changeValue');
        this.volumeEl = document.getElementById('volumeValue');
        
        this._formatCache = new Map(); 
        this._lastCrosshairColor = null; 

        this.loadingOverlay = this._safeElement('loadingOverlay');
        this.loadingProgress = this._safeElement('loadingProgress');
        
        this.chart = LightweightCharts.createChart(container, {
            layout: { background: { color: '#000000' }, textColor: '#808080' },
            grid: { vertLines: { visible: false }, horzLines: { visible: false } },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
            handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
            animation: { duration: 0 },
            timeScale: { 
                timeVisible: true, secondsVisible: false, borderColor: '#333333',
                barSpacing: 12, minBarSpacing: 1, fixLeftEdge: false, fixRightEdge: false,
                rightOffset: 10,
                tickMarkFormatter: (time) => {
                    const mskTime = time + (3 * 3600);
                    const date = new Date(mskTime * 1000);
                    return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
                }
            },
            rightPriceScale: { 
                borderColor: '#333333', borderVisible: true,
                scaleMargins: { top: 0.1, bottom: 0.1 }, autoScale: false,
                entireTextOnly: true
            },
            localization: {
                timeFormatter: (time) => {
                    const mskTime = time + (3 * 3600);
                    return new Date(mskTime * 1000).toLocaleString('ru-RU', {
                        timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                    });
                }
            }
        });

        this.candleSeries = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: CONFIG.colors.bullish, downColor: CONFIG.colors.bearish,
            borderVisible: false, wickUpColor: CONFIG.colors.bullish, wickDownColor: CONFIG.colors.bearish,
            priceScaleId: 'right',
        });

        this.barSeries = this.chart.addSeries(LightweightCharts.BarSeries, {
            upColor: CONFIG.colors.bullish, downColor: CONFIG.colors.bearish,
            openVisible: true, thinBars: true, priceScaleId: 'right',
        });

        [this.candleSeries, this.barSeries].forEach(series => {
            series.applyOptions({
                priceLineVisible: true, lastValueVisible: true,
                priceLineColor: '#00bcd4', priceLineWidth: 1,
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
            
            this.candleSeries.applyOptions({ upColor: savedBullish, downColor: savedBearish, wickUpColor: savedBullish, wickDownColor: savedBearish });
            this.barSeries.applyOptions({ upColor: savedBullish, downColor: savedBearish });
        }

        if (typeof LightweightCharts !== 'undefined') {
            try {
                this.volumeSeries = this.chart.addSeries(LightweightCharts.HistogramSeries, {
                    priceScaleId: 'volume', priceFormat: { type: 'volume' },
                    color: '#26a69a', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, title: ''
                });
                const volumeScale = this.chart.priceScale('volume');
                if (volumeScale) {
                    volumeScale.applyOptions({ scaleMargins: { top: 0.78, bottom: 0 }, visible: true, borderVisible: true });
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

        this._pingInterval = setInterval(() => {
            if (window.wsManager?.wsKline?.readyState === WebSocket.OPEN) {
                window.wsManager.wsKline.send(JSON.stringify({ type: 'ping' }));
            }
            if (window.wsManager?.wsTrade?.readyState === WebSocket.OPEN) {
                window.wsManager.wsTrade.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
    }

    _safeElement(id) {
        const el = document.getElementById(id);
        return el ? el : { classList: { add: () => {}, remove: () => {} }, textContent: '', style: {} };
    }

        
       destroy() {
        this._abortAllProcesses();
        
        // 🚀 ОЧИСТКА ОВЕРЛЕЕВ (СЕССИИ И РАЗДЕЛИТЕЛЬ ДНЕЙ)
        if (window._dailySeparator && typeof window._dailySeparator.destroy === 'function') {
            window._dailySeparator.destroy();
            window._dailySeparator = null;
        }
        if (window._sessionHighlighter && typeof window._sessionHighlighter.destroy === 'function') {
            window._sessionHighlighter.destroy();
            window._sessionHighlighter = null;
        }
        
        if (this._pingInterval) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
        }
        if (this._candleCheckerTimeout) clearTimeout(this._candleCheckerTimeout);
        if (this._trimDebounceTimeout) clearTimeout(this._trimDebounceTimeout);
        if (this._drawingsFinalUpdateTimeout) clearTimeout(this._drawingsFinalUpdateTimeout);
        if (this._scrollStopTimeout) clearTimeout(this._scrollStopTimeout);
        if (this._setDataTimeout) clearTimeout(this._setDataTimeout);
        
        document.removeEventListener('visibilitychange', this._visibilityHandler);
        if (this._resizeObserver) this._resizeObserver.disconnect();
        
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
    _rebuildTimeMap() {
        this._candleTimeMap.clear();
        for (let i = 0; i < this.chartData.length; i++) {
            this._candleTimeMap.set(this.chartData[i].time, i);
        }
    }

    _addToTimeMap(time, index) {
        this._candleTimeMap.set(time, index);
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
        const mainChart = this.chart;
        let crosshairUpdateScheduled = false;
        let lastCrosshairParam = null;
        
        const syncCrosshairToPanels = (param) => {
            if (!mainChart || !param) return;
            const panels = window.chartManager?.indicatorManager?.panelManager?.panels;
            if (!panels) return;
            
            panels.forEach((panel) => {
                if (!panel.chart || panel.isCollapsed) return;
                try {
                    if (!param.time || !param.point) { panel.chart.clearCrosshairPosition(); return; }
                    let targetSeries = null;
                    panel.series.forEach((series) => { targetSeries = series; });
                    if (!targetSeries) { panel.chart.clearCrosshairPosition(); return; }
                    const dataPoint = param.seriesData.get(targetSeries);
                    if (dataPoint) {
                        panel.chart.setCrosshairPosition(dataPoint.value, param.time, param.point.x);
                    } else {
                        panel.chart.clearCrosshairPosition();
                    }
                } catch(e) {}
            });
        };
        
        mainChart.subscribeCrosshairMove((param) => {
            lastCrosshairParam = param;
            if (!crosshairUpdateScheduled) {
                crosshairUpdateScheduled = true;
                requestAnimationFrame(() => {
                    syncCrosshairToPanels(lastCrosshairParam);
                    crosshairUpdateScheduled = false;
                });
            }
        });
    }

       setupOptimizedSubscriptions() {
        this.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            const now = performance.now();
            this._isScrollingFast = (now - this._lastScrollTime) < 40;
            this._isScrolling = true;
            this._lastScrollTime = now;
            this._lastVisibleRange = range;

            // 1. Сбрасываем таймер "остановки" скролла
            clearTimeout(this._scrollStopTimeout);
            
            // 2. 🚀 КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: Просто ставим флаг, что рисовалки нужно обновить ПОЗЖЕ
            this._pendingDrawingsRedraw = true;

            this._scrollStopTimeout = setTimeout(() => {
                this._isScrolling = false;
                this._isScrollingFast = false;
                
                // 3. Обрезка данных и проверка истории (только после остановки)
                this._applyPendingTrim();
                this.onVisibleLogicalRangeChange(this._lastVisibleRange);
                
                // 4. 🚀 ГАРАНТИРОВАННАЯ перерисовка рисунков ПОСЛЕ остановки скролла
                if (this._pendingDrawingsRedraw) {
                    this._pendingDrawingsRedraw = false;
                    this.requestDrawingsRedraw(); // Вызываем перерисовку один раз
                }
            }, 150); // 150мс тишины считаются "остановкой скролла"

            // 5. Синхронизация панелей индикаторов (оставляем, она легкая благодаря RAF)
            if (range && this.indicatorManager?.panelManager && !this._isSyncing) {
                if (!this._panelsSyncRafId) {
                    this._panelsSyncRafId = requestAnimationFrame(() => {
                        this._isSyncing = true;
                        const panels = this.indicatorManager.panelManager.panels;
                        panels.forEach((panel) => {
                            if (panel.chart && !panel.isCollapsed) {
                                try { panel.chart.timeScale().setVisibleLogicalRange(range); } catch(e) {}
                            }
                        });
                        this._isSyncing = false;
                        this._panelsSyncRafId = null;
                    });
                }
            }
            
            // 🚨 ЗДЕСЬ БЫЛО: this.scheduleDrawingsUpdate(); 
            // МЫ ЭТО УДАЛИЛИ, чтобы не нагружать процессор во время движения
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
                if (this.timerManager?._primitive) this.timerManager._primitive.requestRedraw();
                this.scheduleDrawingsUpdate(true);
            }, 100);
        });

        this.chartContainer.addEventListener('mouseleave', () => {
            if (this.overlay) this.overlay.classList.remove('visible');
            this._latestCrosshairData = null;
            if (this._crosshairRafId) { cancelAnimationFrame(this._crosshairRafId); this._crosshairRafId = null; }
            try { this.chart.clearCrosshairPosition(); } catch(e) {}
        });

        // 🚀 ДОБАВЛЕНО: Глобальный сброс перетаскивания при потере фокуса окна (Alt+Tab, клик вне браузера)
        window.addEventListener('blur', () => {
            // Принудительно отменяем перетаскивание во всех менеджерах рисования
            if (window.trendLineManager?.cancelDrag) window.trendLineManager.cancelDrag();
            if (window.rayManager?.cancelDrag) window.rayManager.cancelDrag();
            if (window.rulerLineManager?.cancelDrag) window.rulerLineManager.cancelDrag();
            if (window.alertLineManager?.cancelDrag) window.alertLineManager.cancelDrag();
            if (window.textManager?.cancelDrag) window.textManager.cancelDrag();
            
            // Сбрасываем зависший курсор и состояние графика
            try { 
                this.chart?.clearCrosshairPosition(); 
                // Если используется кастомный примитив, сбрасываем его состояние
                if (this.chart?.unsubscribeClick) { /* доп. очистка если нужна */ }
            } catch(e) {}
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
        
        if (this.barSeries) {
            this.barSeries.applyOptions({ upColor: CONFIG.colors.bullish, downColor: CONFIG.colors.bearish });
        }
        
        if (this.timerManager?.reattach) this.timerManager.reattach();
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
            const lastCandle = this.chartData[this.chartData.length - 1];
            const isBullish = lastCandle ? lastCandle.close >= lastCandle.open : true;
            const lineColor = isBullish ? CONFIG.colors.bullish : CONFIG.colors.bearish;
            activeSeries.applyOptions({
                priceLineVisible: true, lastValueVisible: true,
                priceLineColor: lineColor, priceLineWidth: 1,
                priceLineStyle: LightweightCharts.LineStyle.Dashed
            });
        }

        // 🚀 КРИТИЧЕСКИ ВАЖНО: перепривязка примитивов к новой видимой серии
        if (window._dailySeparator && typeof window._dailySeparator.reattach === 'function') {
            window._dailySeparator.reattach();
        }
        if (window._sessionHighlighter && typeof window._sessionHighlighter.reattach === 'function') {
            window._sessionHighlighter.reattach();
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
        if (!this.chartData.length) return;
        
        const cachedPrecision = localStorage.getItem(`precision_${this.currentSymbol}_${this.currentExchange}_${this.currentMarketType}`);
        if (cachedPrecision) {
            this.applyPriceFormat(parseInt(cachedPrecision));
        } else {
            this.applyPriceFormat(this._inferPrecisionFromData());
        }
        
        if (this.indicatorManager) this.indicatorManager.updateAllIndicators();

        const lastCandle = this.chartData[this.chartData.length - 1];
        const isBullishByCandle = lastCandle ? lastCandle.close >= lastCandle.open : true;
        const lineColorByCandle = isBullishByCandle ? CONFIG.colors.bullish : CONFIG.colors.bearish;
        const price = this.getCurrentPrice() ?? this.currentRealPrice;

        if (price !== null) {
            this._syncPriceLine(price);
        } else {
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            if (series) {
                series.applyOptions({ priceLineSource: lastCandle.close, priceLineColor: lineColorByCandle });
            }
            this._lastAppliedColor = lineColorByCandle;
        }

        if (this.timerManager) {
            const prim = this.timerManager._primitive;
            if (prim) {
                if (prim.setPrice) prim.setPrice(price !== null ? price : lastCandle.close);
                if (!price && prim.setColor) prim.setColor(lineColorByCandle);
            }
            this.timerManager.start(this.currentInterval);
        }
        this.scheduleUpdatePosition();
    }

    // 🚀 ИСПРАВЛЕНО: Мгновенное обновление данных (сохраняет правильные high/low), 
    // но троттлинг тяжелых DOM-операций (заголовок, позиция, рисовалки)
  _syncPriceLine(price) {
    if (!price || isNaN(price)) return;
    const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
    if (!series) return;
    
    const lastCandle = this.chartData[this.chartData.length - 1];
    if (!lastCandle) return;
    
    // 1. Обновляем данные свечи
    lastCandle.close = price;
    if (price > lastCandle.high) lastCandle.high = price;
    if (price < lastCandle.low) lastCandle.low = price;
    
    // ✅ Цвет линии ВСЕГДА совпадает с цветом свечи (close vs open)
    const isBullish = lastCandle.close >= lastCandle.open;
    const lineColor = isBullish 
        ? (this.bullishColor || CONFIG.colors.bullish) 
        : (this.bearishColor || CONFIG.colors.bearish);
    
    this.currentRealPrice = price;
    this._lastAppliedColor = lineColor;
    this.lastCandle = lastCandle;
    
    // 2. МГНОВЕННО: свеча + линия цены (цвет синхронизирован)
   this._tempCandleUpdate.time = lastCandle.time;
this._tempCandleUpdate.open = lastCandle.open;
this._tempCandleUpdate.high = lastCandle.high;
this._tempCandleUpdate.low = lastCandle.low;
this._tempCandleUpdate.close = price;
series.update(this._tempCandleUpdate);
    
    // ✅ МГНОВЕННО обновляем цвет линии (без троттлинга)
    series.applyOptions({ 
        priceLineSource: price, 
        priceLineColor: lineColor 
    });
    
    // 3. ТРОТТЛИНГ только для тяжёлых операций
    if (!this._priceEffectRafId) {
        this._priceEffectRafId = requestAnimationFrame(() => {
            this._priceEffectRafId = null;
            
            const prim = this.timerManager?._primitive;
            if (prim) {
                if (prim.setPrice) prim.setPrice(this.currentRealPrice);
                if (prim.setColor) prim.setColor(this._lastAppliedColor);
                if (prim.isEnabled) prim.requestRedraw();
            }
            
            if (!document.hidden) {
                this.scheduleUpdatePosition();
                this._updatePageTitle();
            }
            this.requestDrawingsRedraw();
        });
    }
}

       updateLastCandle(candle) {
        if (!candle || typeof candle.time !== 'number' || isNaN(candle.time) || candle.time <= 0) return;
        
        try {
            if (!this._isValidCandle(candle)) {
                const sanitized = this._sanitizeCandle(candle);
                if (!sanitized) return;
                candle = sanitized;
            }
            
            // 1. ВСЕГДА берем актуальную последнюю свечу напрямую из конца массива
            const currentLastCandle = this.chartData[this.chartData.length - 1];

            // 2. СЦЕНАРИЙ А: Это обновление ТЕКУЩЕЙ последней свечи (самый частый случай)
            if (currentLastCandle && candle.time === currentLastCandle.time) {
                currentLastCandle.close = candle.close;
                currentLastCandle.high = Math.max(currentLastCandle.high, candle.high);
                currentLastCandle.low = Math.min(currentLastCandle.low, candle.low);
                currentLastCandle.open = candle.open;
                currentLastCandle.volume = candle.volume;
                
                this.lastCandle = currentLastCandle; // Жестко синхронизируем ссылку
            } 
            // 3. СЦЕНАРИЙ Б: Это НОВАЯ свеча
            else if (!currentLastCandle || candle.time > currentLastCandle.time) {
                this.chartData.push(candle);
                this._addToTimeMap(candle.time, this.chartData.length - 1);
                this.lastCandle = candle; // Теперь это последняя свеча
            } 
            // 4. СЦЕНАРИЙ В: Это историческая свеча (обновление в прошлом)
            else {
                const existingIndex = this._candleTimeMap.get(candle.time);
                if (existingIndex !== undefined) {
                    const existing = this.chartData[existingIndex];
                    existing.open = candle.open;
                    existing.close = candle.close;
                    existing.volume = candle.volume;
                    existing.high = Math.max(existing.high, candle.high);
                    existing.low = Math.min(existing.low, candle.low);
                    
                    // 🚀 ВАЖНО: Обновляем только график, НО НЕ ТРОГАЕМ this.lastCandle!
                    const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
                    if (activeSeries) {
                        this._tempCandleUpdate.time = existing.time;
                        this._tempCandleUpdate.open = existing.open;
                        this._tempCandleUpdate.high = existing.high;
                        this._tempCandleUpdate.low = existing.low;
                        this._tempCandleUpdate.close = existing.close;
                        activeSeries.update(this._tempCandleUpdate);
                    }
                }
                // Выходим из функции, так как это не последняя свеча, UI обновлять не нужно
                return; 
            }
            
            // --- ДАЛЕЕ КОД ВЫПОЛНЯЕТСЯ ТОЛЬКО ДЛЯ ПОСЛЕДНЕЙ (АКТУАЛЬНОЙ) СВЕЧИ ---
            
            const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            if (activeSeries && this.lastCandle) {
                this._tempCandleUpdate.time = this.lastCandle.time;
                this._tempCandleUpdate.open = this.lastCandle.open;
                this._tempCandleUpdate.high = this.lastCandle.high;
                this._tempCandleUpdate.low = this.lastCandle.low;
                this._tempCandleUpdate.close = this.lastCandle.close;
                
                activeSeries.update(this._tempCandleUpdate);
                
                const isBullish = this.lastCandle.close >= this.lastCandle.open;
                const lineColor = isBullish ? CONFIG.colors.bullish : CONFIG.colors.bearish;
                
                if (lineColor !== this._lastAppliedColor) {
                    this._lastAppliedColor = lineColor;
                    activeSeries.applyOptions({ priceLineColor: lineColor });
                }
            }
            
            this.currentRealPrice = this.lastCandle.close;
            
            if (this.timerManager?._primitive) {
                if (this.timerManager._primitive.setPrice) this.timerManager._primitive.setPrice(this.currentRealPrice);
                if (this.timerManager._primitive.setColor) this.timerManager._primitive.setColor(this._lastAppliedColor);
                if (this.timerManager._primitive.isEnabled()) this.timerManager._primitive.requestRedraw();
            }
            
            if (this.scheduleUpdatePosition) this.scheduleUpdatePosition();
            
            if (this.volumeSeries && this.lastCandle) {
                this.volumeSeries.update({ 
                    time: this.lastCandle.time, 
                    value: this.lastCandle.quoteVolume || this.lastCandle.volume || 0, 
                    color: (this.lastCandle.close >= this.lastCandle.open) ? this.bullishColor : this.bearishColor 
                });
            }
            
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
        if (data.length === 0) return;

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

        if (data.length === 0) return;

        data.sort((a, b) => a.time - b.time);

      // СТАЛО:
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

        const cachedPrecision = localStorage.getItem(`precision_${symbol}_${exchange}_${marketType}`);
        const inferredPrecision = this._inferPrecisionFromData();

        if (cachedPrecision) {
            this.applyPriceFormat(parseInt(cachedPrecision));
        } else {
            this.applyPriceFormat(inferredPrecision);
            localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, inferredPrecision);
        }

        this.candleSeries.setData(this.chartData);
        this.barSeries.setData(this.chartData);

        if (this.volumeSeries && this.chartData.length > 0) {
            const volumeData = this._buildVolumeData(this.chartData);
            this.volumeSeries.setData(volumeData);
            this._volumeDataDirty = false;
            this._lastVolumeUpdateIndex = this.chartData.length - 1;
        }

        if (this.indicatorManager) {
            this.indicatorManager.restorePendingIndicators();
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    this.indicatorManager.updateAllIndicators();
                    this.indicatorManager.loadIndicators();
                });
            });
        }

        const lastCandle = this.chartData[this.chartData.length - 1];
        const isBullishByCandle = lastCandle ? lastCandle.close >= lastCandle.open : true;
        const lineColorByCandle = isBullishByCandle ? CONFIG.colors.bullish : CONFIG.colors.bearish;
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (series) {
            series.applyOptions({ priceLineColor: lineColorByCandle });
            this._lastAppliedColor = lineColorByCandle;
        }

        if (this.timerManager) this.timerManager.start(this.currentInterval);

        this.scrollToLast();
        this.autoScale();
        this.scheduleUpdatePosition();
        this._updatePageTitle();

        if (typeof getPrecisionFromExchange === 'function') {
            getPrecisionFromExchange(symbol, exchange, marketType)
                .then(precision => {
                    if (this.currentSymbol === symbol) {
                        localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, precision);
                        this.applyPriceFormat(precision);
                    }
                })
                .catch(() => {});
        }

        requestAnimationFrame(() => {
            if (window.renderDrawings) window.renderDrawings();
        });

        this._notifySymbolChange();
        this._lastTimeframe = interval;

              // ✅ ИСПРАВЛЕНИЕ: Передаем this (chartManager) в конструкторы!
        if (!window._dailySeparator && window.DailySeparator) {
            window._dailySeparator = new window.DailySeparator(this);
        }
        if (window._dailySeparator && window._dailySeparator.redraw) {
            window._dailySeparator.redraw();
        }
        
        if (!window._sessionHighlighter && window.SessionHighlighter) {
            window._sessionHighlighter = new window.SessionHighlighter(this);
        }
        if (window._sessionHighlighter && window._sessionHighlighter.redraw) {
            window._sessionHighlighter.redraw();
        }

        this.isLoadingMore = false;
        this._pendingHistoryLoad = false;
        this._lastHistoryLoadTime = 0;
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
        if (document.hidden) return;

        if (!this.overlay) this.overlay = this._safeElement('candleStatsOverlay');
        
        if (!param || !param.time || !param.point || !this.chartData || this.chartData.length === 0) {
            if (this.overlay) this.overlay.classList.remove('visible');
            this._latestCrosshairData = null;
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
                open: candle.open, high: candle.high, low: candle.low, close: candle.close,
                change: (changeNum > 0 ? '+' : '') + change + '%',
                volume: typeof Utils !== 'undefined' ? Utils.formatVolume(vol) : vol,
                cls: isBullish ? 'bullish' : 'bearish', visible: true
            };
        } else {
            this._latestCrosshairData = { visible: false };
        }
        
        if (!this._crosshairRafId) {
            this._crosshairRafId = requestAnimationFrame(() => {
                this._applyCrosshairDOM();
                this._crosshairRafId = null;
            });
        }
    }

    _applyCrosshairDOM() {
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
                    const firstKey = this._formatCache.keys().next().value;
                    this._formatCache.delete(firstKey);
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
            if (this.openEl) this.openEl.style.color = color;
            if (this.highEl) this.highEl.style.color = color;
            if (this.lowEl) this.lowEl.style.color = color;
            if (this.closeEl) this.closeEl.style.color = color;
            if (this.changeEl) this.changeEl.style.color = color;
            if (this.volumeEl) this.volumeEl.style.color = color;
        }

        const baseClass = `stat-value ${data.cls}`;
        const changeClass = `change-value ${data.cls}`;

        if (this.openEl) {
            const newText = formatWithPrecision(data.open);
            if (this.openEl.textContent !== newText) this.openEl.textContent = newText;
            if (this.openEl.className !== baseClass) this.openEl.className = baseClass;
        }
        if (this.highEl) {
            const newText = formatWithPrecision(data.high);
            if (this.highEl.textContent !== newText) this.highEl.textContent = newText;
            if (this.highEl.className !== baseClass) this.highEl.className = baseClass;
        }
        if (this.lowEl) {
            const newText = formatWithPrecision(data.low);
            if (this.lowEl.textContent !== newText) this.lowEl.textContent = newText;
            if (this.lowEl.className !== baseClass) this.lowEl.className = baseClass;
        }
        if (this.closeEl) {
            const newText = formatWithPrecision(data.close);
            if (this.closeEl.textContent !== newText) this.closeEl.textContent = newText;
            if (this.closeEl.className !== baseClass) this.closeEl.className = baseClass;
        }
        if (this.changeEl) {
            if (this.changeEl.textContent !== data.change) this.changeEl.textContent = data.change;
            if (this.changeEl.className !== changeClass) this.changeEl.className = changeClass;
        }
        if (this.volumeEl) {
            if (this.volumeEl.textContent !== data.volume) this.volumeEl.textContent = data.volume;
            if (this.volumeEl.className !== baseClass) this.volumeEl.className = baseClass;
        }

        if (this.overlay && !this.overlay.classList.contains('visible')) {
            this.overlay.classList.add('visible');
        }
    }

    updateRealPrice(price) { 
        this._syncPriceLine(price); 
    }
    
     scrollToLast(enableRealTime = true) {
        if (!this.chart || this.chartData.length === 0) {
            console.warn('⚠️ scrollToLast: График не готов или нет данных');
            return false;
        }

        try {
            // 1. Жестко синхронизируем lastCandle с реальным концом массива
            this.lastCandle = this.chartData[this.chartData.length - 1];
            
            const timeScale = this.chart.timeScale();
            if (!timeScale) {
                console.warn('⚠️ scrollToLast: timeScale недоступен');
                return false;
            }

            // 2. Пытаемся использовать встроенный scrollToRealTime
            if (enableRealTime) {
                timeScale.scrollToRealTime();
            } else {
                // Если не нужно включать real-time, просто прокручиваем к последней свече
                const lastCandleTime = this.lastCandle.time;
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

            // 3. Гарантируем, что последняя свеча отрисована корректно
            const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            if (activeSeries && this.lastCandle) {
                this._tempCandleUpdate.time = this.lastCandle.time;
                this._tempCandleUpdate.open = this.lastCandle.open;
                this._tempCandleUpdate.high = this.lastCandle.high;
                this._tempCandleUpdate.low = this.lastCandle.low;
                this._tempCandleUpdate.close = this.lastCandle.close;
                activeSeries.update(this._tempCandleUpdate);
            }

            return true;
        } catch (e) {
            console.error('❌ Ошибка в scrollToLast:', e);
            return false;
        }
    }

    _debouncedSetData() {
        if (this._pendingSetData) return;
        this._pendingSetData = true;
        clearTimeout(this._setDataTimeout);
        this._setDataTimeout = setTimeout(() => {
            this._pendingSetData = false;
            const timeScale = this.chart.timeScale();
            const visibleRange = timeScale.getVisibleLogicalRange();
            const savedRange = visibleRange ? { from: visibleRange.from, to: visibleRange.to } : null;
            this.candleSeries.setData(this.chartData);
            this.barSeries.setData(this.chartData);
            if (savedRange) timeScale.setVisibleLogicalRange(savedRange);
        }, 100);
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
        if (!this.chart || this.chartData.length === 0) return;
        const priceScale = this.chart.priceScale('right');
        if (!priceScale) return;
        if (this._autoScalePending) return;
        this._autoScalePending = true;
        priceScale.applyOptions({ autoScale: true, scaleMargins: { top: 0.1, bottom: 0.1 } });
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                priceScale.applyOptions({ autoScale: false });
                this._autoScalePending = false;
            });
        });
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
            if (this._switchingSymbol) return;
            if (symbol !== this.currentSymbol || exchange !== this.currentExchange || marketType !== this.currentMarketType) return;
            
            this.currentRealPrice = price;
            this._updatePageTitle();
            
            if (!document.hidden) {
                this._syncPriceLine(price);
            }
        };

        this.priceManager.subscribe(key, this._priceUpdateHandler, this.currentExchange, this.currentMarketType);
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

        const isBullish = candle.close >= candle.open;
        this._lastAppliedColor = isBullish ? (this.bullishColor || CONFIG.colors.bullish) : (this.bearishColor || CONFIG.colors.bearish);
        
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (series) {
            series.update({ time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
        }
        if (this.volumeSeries) {
            this.volumeSeries.update({ time: candle.time, value: candle.volume || 0, color: isBullish ? this.bullishColor : this.bearishColor });
            this._lastVolumeUpdateIndex = this.chartData.length - 1;
        }
        if (this.timerManager) {
            if (this.timerManager.forceColorUpdate) this.timerManager.forceColorUpdate();
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

    async fetchKlines(symbol, exchange, marketType, interval, limit = 1000, endTime = null) {
        if (this._fetchPromise) { try { await this._fetchPromise; } catch(e) {} }
        if (this._currentFetchController) this._currentFetchController.abort();
        this._currentFetchController = new AbortController();

        const bybitIntervalMap = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '6h': '360', '12h': '720', '1d': 'D', '1w': 'W', '1M': 'M' };

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

        this._fetchPromise = (async () => {
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
                const noDupes = rawCandles.filter(c => { if (seenTimes.has(c.time)) return false; seenTimes.add(c.time); return true; });
                const validCandles = noDupes.filter(c => this._isValidCandle(c));
                validCandles.sort((a, b) => a.time - b.time);
                
                return validCandles;
            } catch (error) {
                if (error.name === 'AbortError') console.log('🛑 fetchKlines прерван');
                else console.error('❌ Ошибка fetchKlines:', error);
                return [];
            } finally {
                this._currentFetchController = null;
                this._fetchPromise = null;
            }
        })();

        return this._fetchPromise;
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
            this._candleTimeMap.clear();
            this.currentRealPrice = null;
            this._lastAppliedColor = null;
            this._historyLoadQueue = [];
            this._pendingHistoryLoad = false;
            this._historyEndTime = null;
            this.isLoadingMore = false;
            this._lastHistoryLoadTime = 0;
            this._fetchPromise = null;
            this._volumeDataCache = null;
            this._volumeDataDirty = true;
            this._lastVolumeUpdateIndex = -1;
            this._isTrimming = false;

            this.currentSymbol = symbol;
            this.currentExchange = exchange;
            this.currentMarketType = marketType;

            if (window.wsManager && window.wsManager.updateSymbolAndTimeframe) {
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

            this.setDataQuick(candles, this.currentInterval, symbol, exchange, marketType);

            if (!isFromCache) {
                this.saveCandlesToCache(symbol, exchange, marketType, this.currentInterval, candles).catch(() => {});
            }

            this.loadDrawingsForCurrentSymbol();

            if (this.timerManager) {
                if (this.timerManager.destroy) this.timerManager.destroy();
                this.timerManager.start(this.currentInterval);
            }

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
        
        this._volumeDataDirty = true;
        if (this.volumeSeries && this.chartData.length > 0) {
            this._updateVolumeOptimized();
        }
    }

    _syncLineAndTimerColor() {
        if (!this.chartData || this.chartData.length === 0) return;
        const lastCandle = this.chartData[this.chartData.length - 1];
        if (!lastCandle) return;
        let price = this.currentRealPrice;
        if (!price || isNaN(price)) price = lastCandle.close;
        
        const isBullish = price >= lastCandle.open;
        const lineColor = isBullish ? (this.bullishColor || CONFIG.colors.bullish) : (this.bearishColor || CONFIG.colors.bearish);
        
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (series && price) series.applyOptions({ priceLineColor: lineColor, priceLineSource: price });
        
        if (this.timerManager) {
            const prim = this.timerManager._primitive;
            if (prim) {
                if (prim.setColor) prim.setColor(lineColor);
                if (prim.setPrice && price) prim.setPrice(price);
                if (prim.isEnabled) prim.requestRedraw();
            }
            if (this.timerManager.forceColorUpdate) this.timerManager.forceColorUpdate();
        }
        this._lastAppliedColor = lineColor;
    }

    _abortAllProcesses() {
        if (this._pingInterval) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
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
        if (this._updateTimeout) { clearTimeout(this._updateTimeout); this._updateTimeout = null; }
        if (this._trimDebounceTimeout) { clearTimeout(this._trimDebounceTimeout); this._trimDebounceTimeout = null; }
        if (this._candleCheckerTimeout) { clearTimeout(this._candleCheckerTimeout); this._candleCheckerTimeout = null; }
        this._fetchPromise = null;
        this._volumeDataDirty = true;
        this._lastVolumeUpdateIndex = -1;
        this._isTrimming = false;
    }

    getCurrentPrice() {
        if (this.priceManager) { 
            const price = this.priceManager.getPrice(this.currentSymbol); 
            if (price !== null && !isNaN(price)) return price; 
        }
        if (this.currentRealPrice !== null && this.currentRealPrice !== undefined && !isNaN(this.currentRealPrice)) return this.currentRealPrice;
        return null;
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
            timeScale.setVisibleLogicalRange({ from: Math.max(0, targetIndex - 10), to: Math.max(0, targetIndex - 10) + visibleBars });
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
                .then(precision => { this.applyPriceFormat(precision); localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, precision); })
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

    loadSymbolData(symbol, exchange, marketType) {
        const isSameSymbol = (symbol === this.currentSymbol);
        const isTimeframeChange = isSameSymbol && (this.currentInterval !== this._lastTimeframe);
        if (isTimeframeChange) this._savedTimePosition = this.saveCurrentTimePosition();
        if (this._loadingSymbol) return;
        this._loadingSymbol = true;
        this.setSymbol(symbol);
        if (this.loadingOverlay) { 
            this.loadingOverlay.classList.add('visible'); 
            if (this.loadingProgress) this.loadingProgress.textContent = 'Загрузка...'; 
        }
    }

    async saveCandlesToCache(symbol, exchange, marketType, interval, candles) {
        if (!candles || candles.length === 0) return;
        const CACHE_VERSION = '2';
        const key = `${symbol}_${interval}_${exchange}_${marketType}_v${CACHE_VERSION}`;
        const cacheData = { key, symbol, exchange, marketType, interval, data: candles, lastUpdate: Date.now(), firstCandleTime: candles[0].time, lastCandleTime: candles[candles.length - 1].time, count: candles.length, version: CACHE_VERSION };
        if (!window.db) return;
        try {
            if (!window.dbReady) {
                await new Promise(resolve => {
                    const check = setInterval(() => { if (window.dbReady) { clearInterval(check); resolve(); } }, 100);
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
            if (cached.version !== CACHE_VERSION) { await window.db.delete('candles', key); return null; }
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
            for (const cache of allCandles) { if (!cache.version || cache.version !== CACHE_VERSION) await window.db.delete('candles', cache.key); }
        } catch (e) { console.warn('Ошибка очистки кэша свечей:', e); }
    }

    async clearOldCandlesCache(maxAge = 24 * 60 * 60 * 1000) {
        try {
            if (!window.db) return;
            const allCandles = await window.db.getAll('candles');
            const now = Date.now();
            for (const cached of allCandles) { if (now - cached.lastUpdate > maxAge) await window.db.delete('candles', cached.key); }
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

    timeToCoordinate(time) { try { return this.chart.timeScale().timeToCoordinate(time); } catch (e) { return null; } }
    coordinateToTime(coordinate) { try { return this.chart.timeScale().coordinateToTime(coordinate); } catch (e) { return null; } }
    priceToCoordinate(price) { try { const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries; return series.priceToCoordinate(price); } catch (e) { return null; } }

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
    timeToLogical(time) { if (!this.chartData || !this.chartData.length) return null; const index = this._candleTimeMap.get(time); return index !== undefined ? index : null; }
    coordinateToPrice(coordinate) { try { const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries; return series.coordinateToPrice(coordinate); } catch (e) { return null; } }

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
            // 1. Создаем НОВЫЙ массив. Старые ссылки на объекты могут стать неактуальными.
            this.chartData = this.chartData.slice(keepFrom, keepTo);
            this._rebuildTimeMap();
            this._volumeDataDirty = true;
            this._lastVolumeUpdateIndex = -1;
            
            const timeScale = this.chart.timeScale();
            const currentRange = timeScale.getVisibleLogicalRange();
            const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            if (activeSeries) activeSeries.setData(this.chartData);
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

            // 🚀 КРИТИЧЕСКИ ВАЖНО: После создания нового массива (.slice) 
            // жестко привязываем lastCandle к реальному последнему элементу нового массива.
            // Это предотвращает рассинхронизацию при возврате из истории.
            this.lastCandle = this.chartData[this.chartData.length - 1];

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
                endTime
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
                
                // 🚀 КРИТИЧЕСКИ ВАЖНАЯ СТРАХОВКА: 
                // После любых манипуляций с массивом (.slice или ...) обновляем ссылку
                this.lastCandle = this.chartData[this.chartData.length - 1];
                
                this._volumeDataDirty = true;
                this._lastVolumeUpdateIndex = -1;
                
                const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
                if (activeSeries) activeSeries.setData(this.chartData);
                
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
            const freshCandles = await this.fetchKlines(symbol, exchange, marketType, interval, 100);
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
