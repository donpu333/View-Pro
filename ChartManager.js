class ChartManager {
    constructor(container) {
        // ============ БАЗОВЫЕ ПЕРЕМЕННЫЕ ============
        this.chartData = [];
        this.lastCandle = null;
        this._loadingSymbol = false;
        this._switchingSymbol = false;
        this._pendingSymbolSwitch = null; // ✅ ФИКС: очередь на случай быстрого переключения тикеров
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
        this._savedLogicalRange = null;
        this._lastTimeframe = null;
        this._symbolChangeCallbacks = [];
        this._updateScheduled = false;
        this._lastUpdateTime = 0;
        this._drawingsUpdateRafId = null;
        this._pendingUpdates = false;
        this._pendingRedraw = false;
        this._updatePositionRafId = null;
        this._lastAppliedColor = null;
        this._lastAppliedPrecision = null; // ✅ ФИКС: кэш применённой точности, чтобы не дёргать applyPriceFormat на каждый rAF-тик
        this._isSyncing = false;
        this._currentFetchController = null;
        this._historyFetchController = null;
        this._backgroundFetchController = null;
        this._updateTimeout = null;
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
        this._lastVolumeUpdateIndex = -1;

        // ============ FETCH TIMEOUT ============
        this._fetchTimeoutMs = 15000; // ✅ ФИКС: хардлимит на подвисший fetch, чтобы _switchingSymbol не залипал навечно

        // ============ VISIBILITY HANDLER ============
        this._visibilityHandler = () => {
            if (!document.hidden) {
                // ✅ Проверяем график перед использованием
                if (!this._isChartValid()) {
                    console.warn('⚠️ График не готов после возврата, ждём...');
                    setTimeout(() => {
                        if (this._isChartValid()) {
                            this.refreshCandlesAfterTabHidden();
                        }
                    }, 100);
                    return;
                }

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

                // ✅ ФИКС: Принудительно пересчитываем размеры после возврата на вкладку
                requestAnimationFrame(() => {
                    if (this._isChartValid()) {
                        this._updateMainChartHeight();
                        if (this._resizeIndicatorPanels) this._resizeIndicatorPanels();
                        this.chart.applyOptions({
                            width: this.chartContainer.clientWidth,
                            height: this.chartContainer.clientHeight
                        });
                    }
                });
            } else {
                // ✅ Сохраняем точную видимую позицию перед уходом с вкладки
                try {
                    if (this.chart && this.chart.timeScale()) {
                        const range = this.chart.timeScale().getVisibleLogicalRange();
                        this._savedLogicalRange = range ? { from: range.from, to: range.to } : null;
                    }
                } catch (e) {
                    this._savedLogicalRange = null;
                }
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
                minimumWidth: 60
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
                        scaleMargins: { top: 0.85, bottom: 0 },
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

        // ✅ Создаём TimerManager сразу, чтобы плашка появилась без задержки
        if (!this.timerManager) {
            this.timerManager = new TimerManager(this);
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

            // ✅ НОВОЕ: Следим за изменением размера самого контейнера графика
            this._chartContainerResizeObserver = new ResizeObserver(() => {
                clearTimeout(this._containerResizeTimeout);
                this._containerResizeTimeout = setTimeout(() => {
                    if (this._isChartValid()) {
                        this._updateMainChartHeight();
                        if (this._resizeIndicatorPanels) this._resizeIndicatorPanels();
                        this.forceRedraw();
                    }
                }, 50);
            });
            this._chartContainerResizeObserver.observe(this.chartContainer);
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

    // ✅ Проверка валидности графика
    _isChartValid() {
        return this.chart &&
               this.candleSeries &&
               this.barSeries &&
               this.chartContainer &&
               document.contains(this.chartContainer);
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
            if (!document.hidden && !this._switchingSymbol && !this._updatesSuspended && this._isChartValid()) {
                this._syncRecentCandles();
            }
        }, 30000);
    }

    async _syncRecentCandles() {
        const genId = this._activeGeneration; // ✅ ФИКС: снимок поколения ДО await
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

            // ✅ ФИКС: если за время запроса тикер/стейт сменился — не трогаем chartData
            if (this._updatesSuspended || this._switchingSymbol || this._activeGeneration !== genId) return;

            const currentData = this.chartData;
            if (!currentData || currentData.length === 0) return;

            const freshMap = new Map(fresh.map(c => [c.time, c]));
            let changed = false;
            let olderCandlesChanged = false; // Флаг: изменились ли старые свечи

            // 1. Обновляем последние 3 свечи
            for (let i = currentData.length - 1; i >= Math.max(0, currentData.length - 3); i--) {
                const cur = currentData[i];
                const freshCandle = freshMap.get(cur.time);
                if (freshCandle) {
                    cur.open = freshCandle.open;
                    cur.close = freshCandle.close;
                    cur.high = freshCandle.high;
                    cur.low = freshCandle.low;
                    cur.volume = freshCandle.volume;
                    cur.quoteVolume = freshCandle.quoteVolume || cur.volume;

                    const safeTime = Number(cur.time);
                    if (isNaN(safeTime) || safeTime <= 0) {
                        console.warn('⚠️ Пропуск обновления свечи: некорректное время', cur.time);
                        continue;
                    }

                    // ✅ .update() можно вызывать ТОЛЬКО для последней свечи!
                    if (i === currentData.length - 1) {
                        const updateData = {
                            time: safeTime,
                            open: cur.open,
                            high: cur.high,
                            low: cur.low,
                            close: cur.close
                        };

                        if (this.candleSeries) this.candleSeries.update(updateData);
                        if (this.barSeries) this.barSeries.update(updateData);

                        if (this.volumeSeries) {
                            const isBullish = cur.close >= cur.open;
                            this.volumeSeries.update({
                                time: safeTime,
                                value: cur.quoteVolume || cur.volume || 0,
                                color: isBullish ? this.bullishColor : this.bearishColor
                            });
                        }
                    } else {
                        olderCandlesChanged = true;
                    }

                    changed = true;
                    freshMap.delete(cur.time);
                }
            }

            if (olderCandlesChanged && this._isChartValid()) {
                if (this.candleSeries) this.candleSeries.setData(currentData);
                if (this.barSeries) this.barSeries.setData(currentData);
                if (this.volumeSeries) {
                    this._volumeDataCache = null;
                    this._volumeDataDirty = true;
                    this._updateVolumeOptimized();
                }
            }

            // 2. Добавляем пропущенные свечи
            if (freshMap.size > 0) {
                const missing = Array.from(freshMap.values()).sort((a, b) => a.time - b.time);
                let needsFullRedraw = false;

                for (const candle of missing) {
                    candle.quoteVolume = candle.quoteVolume || candle.volume || 0;

                    const safeTime = Number(candle.time);
                    if (isNaN(safeTime) || safeTime <= 0) continue;

                    if (currentData.length > 0 && safeTime <= currentData[currentData.length - 1].time) {
                        needsFullRedraw = true;
                    }

                    currentData.push(candle);
                    this._addToTimeMap(safeTime, currentData.length - 1);
                }

                if (needsFullRedraw && this._isChartValid()) {
                    currentData.sort((a, b) => a.time - b.time);
                    this._rebuildTimeMap();

                    if (this.candleSeries) this.candleSeries.setData(currentData);
                    if (this.barSeries) this.barSeries.setData(currentData);
                    if (this.volumeSeries) {
                        this._volumeDataCache = null;
                        this._volumeDataDirty = true;
                        this._updateVolumeOptimized();
                    }
                } else {
                    for (const candle of missing) {
                        const updateData = {
                            time: candle.time,
                            open: candle.open,
                            high: candle.high,
                            low: candle.low,
                            close: candle.close
                        };
                        if (this.candleSeries) this.candleSeries.update(updateData);
                        if (this.barSeries) this.barSeries.update(updateData);

                        if (this.volumeSeries) {
                            const isBullish = candle.close >= candle.open;
                            this.volumeSeries.update({
                                time: candle.time,
                                value: candle.quoteVolume || candle.volume || 0,
                                color: isBullish ? this.bullishColor : this.bearishColor
                            });
                        }
                    }
                }

                this.lastCandle = currentData[currentData.length - 1];
                changed = true;
            }

            if (changed) {
                this._volumeDataDirty = true;
                this._syncLineColor();
                if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
                if (this.timerManager) this.timerManager.updatePrice(this.lastCandle.close);
            }
        } catch (e) {
            console.warn('⚠️ Ошибка периодической синхронизации:', e);
        }
    }

    async refreshCandlesAfterTabHidden() {
        if (!this._isChartValid()) {
            console.warn('⚠️ График не инициализирован, откладываем синхронизацию');
            return;
        }

        if (this._refreshingAfterHidden) return;
        this._refreshingAfterHidden = true;

        const wasSuspended = this._updatesSuspended;
        this._updatesSuspended = true;
        const genId = this._activeGeneration; // ✅ ФИКС: снимок поколения ДО await

        try {
            const symbol = this.currentSymbol;
            const exchange = this.currentExchange;
            const marketType = this.currentMarketType;
            const interval = this.currentInterval;
            const limit = 500;

            console.log('🔄 Синхронизация свечей после возврата на вкладку...');

            const freshCandles = await this.fetchKlines(
                symbol, exchange, marketType, interval, limit,
                null, 'background'
            );

            if (!this._isChartValid() || this._activeGeneration !== genId) {
                console.warn('⚠️ График был уничтожен/сменился во время загрузки данных');
                return;
            }

            if (!freshCandles || freshCandles.length === 0) {
                console.warn('⚠️ Не удалось получить свежие свечи для синхронизации');
                this._forceRedrawAll();
                if (!this._isViewingHistory) {
                    this.scrollToLast();
                } else if (this._savedLogicalRange) {
                    try {
                        this.chart.timeScale().setVisibleLogicalRange(this._savedLogicalRange);
                    } catch (e) {
                        // Если не удалось восстановить, оставляем как есть
                    }
                }
                return;
            }

            const currentData = this.chartData;
            if (!currentData || currentData.length === 0) {
                if (!this._isChartValid()) {
                    console.warn('⚠️ chart отсутствует перед setDataQuick');
                    return;
                }
                // ✅ ФИКС: фактически первая загрузка данных — считаем как новый символ
                this.setDataQuick(freshCandles, interval, symbol, exchange, marketType, true);
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

            if (dataChanged && this._isChartValid()) {
                this.chartData = updatedData;
                this._rebuildTimeMap();
                this.lastCandle = this.chartData[this.chartData.length - 1];

                if (this.candleSeries) this.candleSeries.setData(this.chartData);
                if (this.barSeries) this.barSeries.setData(this.chartData);
            }

            if (this.volumeSeries && this.chartData.length > 0) {
                this._volumeDataCache = null;
                this._volumeDataDirty = false;
                this._lastVolumeUpdateIndex = this.chartData.length - 1;
                const volumeData = this._buildVolumeData(this.chartData);
                this.volumeSeries.setData(volumeData);
            }

            if (this.indicatorManager) {
                this.indicatorManager.updateAllIndicators();
            }

            const lastCandle = this.lastCandle;
            if (lastCandle && this._isChartValid()) {
                const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
                if (series) {
                    const color = this._getLineColor();
                    series.applyOptions({
                        priceLineSource: 'lastBar',
                        priceLineColor: color
                    });
                    this.currentRealPrice = lastCandle.close;
                    this._lastAppliedColor = color;
                }
            }

            if (this.timerManager) {
                this.timerManager.refresh();
            }

            if (!this._isViewingHistory) {
                this.scrollToLast();
            } else {
                if (this._savedLogicalRange && this._isChartValid()) {
                    try {
                        this.chart.timeScale().setVisibleLogicalRange({
                            from: this._savedLogicalRange.from,
                            to: this._savedLogicalRange.to
                        });
                    } catch (e) {
                        console.warn('⚠️ Не удалось восстановить позицию, прокручиваем к последней свече');
                        this.scrollToLast();
                    }
                }
            }

            console.log('✅ График, объёмы и таймер синхронизированы с биржей');

        } catch (error) {
            console.error('❌ Ошибка синхронизации после возврата:', error);
            if (this._isChartValid()) {
                this._forceRedrawAll();
                if (!this._isViewingHistory) {
                    this.scrollToLast();
                }
            }
        } finally {
            this._refreshingAfterHidden = false;

            if (this._quarantineTimeout) clearTimeout(this._quarantineTimeout);
            this._quarantineTimeout = setTimeout(() => {
                this._updatesSuspended = wasSuspended;
                this._quarantineTimeout = null;
            }, 1000);
        }
    }

    _forceRedrawAll() {
        if (!this._isChartValid()) return;

        if (this.volumeSeries && this.chartData.length > 0) {
            this._volumeDataCache = null;
            this._volumeDataDirty = false;
            const volumeData = this._buildVolumeData(this.chartData);
            this.volumeSeries.setData(volumeData);
        }

        this._syncLineColor();

        if (this.timerManager) this.timerManager.refresh();

        this.forceRedraw();
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

        // ✅ ФИКС: снимаем ВСЕ window-слушатели через сохранённые ссылки (раньше resize/blur были анонимными и никогда не снимались)
        if (this._globalMouseUpHandler) {
            window.removeEventListener('mouseup', this._globalMouseUpHandler, true);
        }
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
        }
        if (this._blurHandler) {
            window.removeEventListener('blur', this._blurHandler);
        }

        document.removeEventListener('visibilitychange', this._visibilityHandler);
        if (this._resizeObserver) this._resizeObserver.disconnect();

        if (this._chartContainerResizeObserver) this._chartContainerResizeObserver.disconnect();
        if (this._containerResizeTimeout) clearTimeout(this._containerResizeTimeout);

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

            if (!this._isChartValid() || !this.chartData?.length || !this.currentInterval || this._updatesSuspended) {
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
        if (!this._isChartValid() || !this.currentSymbol || !this.currentInterval) return;
        const genId = this._activeGeneration; // ✅ ФИКС: снимок поколения

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

            if (!freshCandles || freshCandles.length === 0 || !this._isChartValid() || this._activeGeneration !== genId) return;

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
        if (!this.chart || !this.chart.timeScale()) return;

        this.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (!this._isChartValid()) return;

            const now = performance.now();
            this._isScrollingFast = (now - this._lastScrollTime) < 40;
            this._isScrolling = true;
            this._lastScrollTime = now;
            this._lastVisibleRange = range;

            if (range && this.chartData && this.chartData.length > 0) {
                const lastIndex = this.chartData.length - 1;
                this._isViewingHistory = range.to < lastIndex;
            }

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

    // ✅ ИСПРАВЛЕННЫЙ МЕТОД: resize и blur слушатели теперь именованные функции,
    // сохранённые в this._resizeHandler / this._blurHandler и корректно снимаемые в destroy()
    setupEventListeners() {
        let resizeTimeout;
        this._resizeHandler = () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (this._isChartValid()) {
                    this._updateMainChartHeight();
                    if (this._resizeIndicatorPanels) this._resizeIndicatorPanels();
                    this.forceRedraw();
                    setTimeout(() => this.scrollToLast(), 50);
                }
                this.scheduleDrawingsUpdate(true);
            }, 100);
        };
        window.addEventListener('resize', this._resizeHandler);

        this._mouseLeaveHandler = () => {
            if (this.overlay) this.overlay.classList.remove('visible');
            this._latestCrosshairData = null;
            if (this._crosshairRafId) {
                cancelAnimationFrame(this._crosshairRafId);
                this._crosshairRafId = null;
            }
            if (this.chart) {
                try { this.chart.clearCrosshairPosition(); } catch(e) {}
            }

            this._fixStuckAxisDrag();
        };
        this.chartContainer.addEventListener('mouseleave', this._mouseLeaveHandler);

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

        this._blurHandler = () => {
            this._fixStuckAxisDrag();

            if (window.trendLineManager?.cancelDrag) window.trendLineManager.cancelDrag();
            if (window.rayManager?.cancelDrag) window.rayManager.cancelDrag();
            if (window.rulerLineManager?.cancelDrag) window.rulerLineManager.cancelDrag();
            if (window.alertLineManager?.cancelDrag) window.alertLineManager.cancelDrag();
            if (window.textManager?.cancelDrag) window.textManager.cancelDrag();

            if (this.chart) {
                try { this.chart.clearCrosshairPosition(); } catch(e) {}
            }
        };
        window.addEventListener('blur', this._blurHandler);
    }

    _fixStuckAxisDrag() {
        if (!this._isChartValid()) return;
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
        if (!this._isChartValid()) return;

        this._isSwitchingChartType = true;

        this.currentChartType = type;
        localStorage.setItem('chartType', type);

        if (type === 'candle') {
            if (this.candleSeries) this.candleSeries.applyOptions({ visible: true });
            if (this.barSeries) this.barSeries.applyOptions({ visible: false });
        } else if (type === 'bar') {
            if (this.barSeries) this.barSeries.applyOptions({ visible: true });
            if (this.candleSeries) this.candleSeries.applyOptions({ visible: false });
        }

        if (this.volumeSeries) {
            const volumeScale = this.chart.priceScale('volume');
            if (volumeScale) {
                volumeScale.applyOptions({
                    scaleMargins: { top: 0.85, bottom: 0 },
                    autoScale: false
                });
            }
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

        setTimeout(() => {
            this._isSwitchingChartType = false;
        }, 300);
    }

    scheduleUpdate() {
        if (this._updateScheduled || this._updatesSuspended || !this._isChartValid()) return;
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
        if (!this.lastCandle || !this._isChartValid()) return;

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

    // ✅ ИСПРАВЛЕННЫЙ МЕТОД: precision применяется только если реально изменилась
    // (раньше localStorage.getItem + applyPriceFormat дёргались на КАЖДЫЙ rAF-тик)
    _performUpdate() {
        if (!this.chartData.length || this._updatesSuspended || !this._isChartValid()) return;

        const cachedPrecision = localStorage.getItem(
            `precision_${this.currentSymbol}_${this.currentExchange}_${this.currentMarketType}`
        );
        if (cachedPrecision) {
            if (this._lastAppliedPrecision !== cachedPrecision) { // ✅ ФИКС: скип, если не изменилось
                this.applyPriceFormat(parseInt(cachedPrecision));
                this._lastAppliedPrecision = cachedPrecision;
            }
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
        if (!price || isNaN(price) || this._updatesSuspended || !this._isChartValid()) return;

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
                priceLineSource: 'lastBar'
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
                priceLineSource: 'lastBar',
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
            priceLineSource: 'lastBar',
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
        if (this._switchingSymbol || this._updatesSuspended || !this._isChartValid()) return;
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

            if (!candle.quoteVolume && candle.volume) {
                candle.quoteVolume = candle.volume;
            }

            if (!this.chartData || this.chartData.length === 0) return;

            const currentLastCandle = this.chartData[this.chartData.length - 1];
            const isLastCandle = currentLastCandle && candle.time === currentLastCandle.time;
            const isNewCandle = !currentLastCandle || candle.time > currentLastCandle.time;
            const existingIndex = this._candleTimeMap.get(candle.time);

            const updateData = {
                time: candle.time,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close
            };

            if (isLastCandle) {
                currentLastCandle.open = candle.open;
                currentLastCandle.close = candle.close;
                currentLastCandle.high = candle.high;
                currentLastCandle.low = candle.low;
                currentLastCandle.volume = candle.volume;
                currentLastCandle.quoteVolume = candle.quoteVolume;
                if (!currentLastCandle.quoteVolume && currentLastCandle.volume) {
                    currentLastCandle.quoteVolume = currentLastCandle.volume;
                }
                currentLastCandle._isPlaceholder = false;
                this.lastCandle = currentLastCandle;

                if (this.candleSeries) this.candleSeries.update(updateData);
                if (this.barSeries) this.barSeries.update(updateData);

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
                if (!existingCandle.quoteVolume && existingCandle.volume) {
                    existingCandle.quoteVolume = existingCandle.volume;
                }
                existingCandle._isPlaceholder = false;

                if (this._isChartValid()) {
                    if (this.candleSeries) this.candleSeries.setData(this.chartData);
                    if (this.barSeries) this.barSeries.setData(this.chartData);

                    if (this.volumeSeries) {
                        this._volumeDataCache = null;
                        this._volumeDataDirty = true;
                        this._updateVolumeOptimized();
                    }
                }

                this._volumeDataDirty = true;
                return;
            } else if (isNewCandle) {
                this.chartData.push(candle);
                this._addToTimeMap(candle.time, this.chartData.length - 1);
                this.lastCandle = candle;

                if (this.candleSeries) this.candleSeries.update(updateData);
                if (this.barSeries) this.barSeries.update(updateData);

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

            const lineColor = this._getLineColor();
            const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            if (activeSeries) {
                activeSeries.applyOptions({
                    priceLineColor: lineColor,
                    priceLineSource: 'lastBar'
                });
                this._lastAppliedColor = lineColor;
            }

            this._updatePageTitle();
            if (this.timerManager) this.timerManager.updatePrice(this.lastCandle.close);
            if (this.scheduleUpdatePosition) this.scheduleUpdatePosition();

            this._volumeDataDirty = true;

        } catch (e) {
            console.error('❌ Ошибка в updateLastCandle:', e);
        }
    }

    async waitForChartReady() {
        await new Promise(resolve => {
            const check = () => {
                if (!this._isChartValid()) {
                    requestAnimationFrame(check);
                    return;
                }
                const ts = this.chart?.timeScale();
                if (ts && ts.getVisibleRange()) resolve();
                else requestAnimationFrame(check);
            };
            check();
        });
        await new Promise(r => setTimeout(r, 50));
    }

    // ✅ ИСПРАВЛЕННЫЙ МЕТОД setDataQuick
    // forceNewSymbol передаётся ЯВНО вызывающей стороной. Раньше isNewSymbol
    // вычислялся как this.currentSymbol !== symbol, но currentSymbol уже был
    // перезаписан в switchSymbol() до вызова этого метода — сравнение всегда
    // давало false, и график при смене тикера пытался восстановить старый
    // зум/диапазон цены вместо scrollToLast()+autoScale() (как в TradingView).
    setDataQuick(data, interval, symbol, exchange = 'binance', marketType = 'futures', forceNewSymbol = false) {
        try {
            if (!this._isChartValid()) {
                console.error('❌ setDataQuick: chart не инициализирован');
                return;
            }

            if (!data || data.length === 0) return;

            const currentScale = this._captureScale();
            const isNewSymbol = forceNewSymbol;

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

            if (this.candleSeries) this.candleSeries.setData(this.chartData);
            if (this.barSeries) this.barSeries.setData(this.chartData);

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
                series.applyOptions({
                    priceLineColor: lineColor,
                    priceLineSource: 'lastBar'
                });
                this._lastAppliedColor = lineColor;
            }

            const cachedPrecision = localStorage.getItem(`precision_${symbol}_${exchange}_${marketType}`);
            const inferredPrecision = this._inferPrecisionFromData();

            if (cachedPrecision) {
                this.applyPriceFormat(parseInt(cachedPrecision));
                this._lastAppliedPrecision = cachedPrecision;
            } else {
                this.applyPriceFormat(inferredPrecision);
                localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, inferredPrecision);
                this._lastAppliedPrecision = String(inferredPrecision);
            }

            setTimeout(() => {
                if (this.indicatorManager && this._isChartValid()) {
                    this.indicatorManager.restorePendingIndicators();
                    this.indicatorManager.updateAllIndicators();
                    this.indicatorManager.loadIndicators();
                }
            }, 0);

            // ✅ ФИКС: при новом символе (или первой загрузке) — ВСЕГДА scrollToLast + autoScale,
            // как в TradingView. При смене таймфрейма на ТОМ ЖЕ тикере — восстанавливаем
            // logical-диапазон, но ВСЕГДА добиваем autoScale(), т.к. _restoreScale()
            // восстанавливает только временной диапазон, а не диапазон цены — при смене TF
            // (например 1m -> 1W) цены сильно отличаются, и без autoScale часть свечей
            // визуально "срезана" сверху/снизу шкалы.
            if (currentScale && !isNewSymbol) {
                this._restoreScale(currentScale);
                this.autoScale(); // ✅ ФИКС: добиваем ценовую шкалу под новый набор данных
            } else {
                this.scrollToLast();
                this.autoScale();
            }

            this.scheduleUpdatePosition();
            this._updatePageTitle();

            if (this.timerManager) {
                this.timerManager.start(this.currentInterval);
                this.timerManager.updatePrice(this.lastCandle.close);
                this.timerManager._forceUpdate();

                requestAnimationFrame(() => {
                    if (this.timerManager) {
                        this.timerManager._forceUpdate();
                    }
                });

                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (this.timerManager) {
                            this.timerManager._forceUpdate();
                        }
                    });
                });
            }

            if (typeof getPrecisionFromExchange === 'function') {
                getPrecisionFromExchange(symbol, exchange, marketType)
                    .then(precision => {
                        if (this.currentSymbol === symbol && this._isChartValid()) {
                            localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, precision);
                            this.applyPriceFormat(precision);
                            this._lastAppliedPrecision = String(precision);
                        }
                    })
                    .catch(() => {});
            }

            setTimeout(() => {
                if (window.renderDrawings) window.renderDrawings();
            }, 0);

            // ✅ ФИКС: _notifySymbolChange() и localStorage-запись переехали в switchSymbol()
            // и выполняются там один раз за переключение (раньше дублировались).
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
            if (this.chart) {
                this.chart.applyOptions({ handleScroll: true, handleScale: true });
            }
        }
    }

    _captureScale() {
        if (!this._isChartValid()) return null;

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
        if (!scale || !this._isChartValid()) return;
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

    // ✅ ИСПРАВЛЕННЫЙ МЕТОД switchSymbol
    async switchSymbol(symbol, exchange, marketType) {
        // ✅ ФИКС: раньше повторный клик по тикеру во время загрузки предыдущего
        // просто отбрасывался. Теперь запрос ставится в очередь и доигрывается
        // сразу после завершения текущего переключения ("последний клик побеждает").
        if (this._switchingSymbol) {
            this._pendingSymbolSwitch = { symbol, exchange, marketType };
            return;
        }
        this._switchingSymbol = true;

        if (this.timerManager) {
            this.timerManager.reset();
        }

        this.currentRealPrice = null;
        this.lastCandle = null;

        const generationId = ++this._generationCounter;
        this._activeGeneration = generationId;

        try {
            this._abortAllProcesses();
            this._suspendAllUpdates();

            // ❌ Не очищаем экран (setData([])) — старые свечи висят, пока грузятся новые.
            // setDataQuick мгновенно заменит их без пустого экрана.

            this.chartData = [];
            this._candleTimeMap.clear();
            this.currentSymbol = symbol;
            this.currentExchange = exchange;
            this.currentMarketType = marketType;

            this._subscribeToPrice();

            if (window.wsManager?.updateSymbolAndTimeframe) {
                window.wsManager.updateSymbolAndTimeframe(symbol, this.currentInterval, exchange, marketType);
            }

            const cachedPrecision = localStorage.getItem(`precision_${symbol}_${exchange}_${marketType}`);
            if (cachedPrecision) this.applyPriceFormat(parseInt(cachedPrecision));

            // 1. Пытаемся взять данные из кэша (мгновенная скорость)
            let candles = await this.loadCandlesFromCache(symbol, exchange, marketType, this.currentInterval);
            let isFromCache = !!candles;

            // 2. Если кэша нет, тянем с биржи
            if (!isFromCache) {
                candles = await this.fetchKlines(symbol, exchange, marketType, this.currentInterval, 1000);
            }

            if (!candles || candles.length === 0) {
                throw new Error('Нет данных для ' + symbol);
            }

            // Если пользователь успел нажать другой тикер, отменяем этот
            if (this._activeGeneration !== generationId) {
                console.log('🔄 Символ уже переключился, отменяем старую загрузку');
                return;
            }

            if (this.timerManager) {
                this.timerManager.stop();
            }

            // 3. Мгновенно отображаем новые свечи (замещаем старые без пустого экрана)
            // ✅ ФИКС: forceNewSymbol=true — гарантирует scrollToLast()+autoScale()
            // вместо попытки восстановить зум/диапазон цены от предыдущего тикера.
            if (this._isChartValid()) {
                this.setDataQuick(candles, this.currentInterval, symbol, exchange, marketType, true);
            }

            // ✅ ФИКС: убран дублирующий блок timerManager.start()/updatePrice()/_forceUpdate() —
            // setDataQuick() уже делает это внутри себя. Двойной вызов приводил к дёрганью
            // плашки таймера цены при каждом переключении тикера.

            // 4. Сохраняем в кэш, если качали с биржи
            if (!isFromCache) {
                this.saveCandlesToCache(symbol, exchange, marketType, this.currentInterval, candles).catch(() => {});
            }

            this.loadDrawingsForCurrentSymbol();

            localStorage.setItem('lastSymbol', symbol);
            localStorage.setItem('lastExchange', exchange);
            localStorage.setItem('lastMarketType', marketType);

            // ✅ ФИКС: _notifySymbolChange() вызывается один раз за переключение
            // (раньше вызывался ещё и внутри setDataQuick — подписчики срабатывали дважды).
            this._notifySymbolChange();

            // 5. Фоновое обновление свежими свечами (если взяли из кэша)
            if (isFromCache) {
                this.refreshCandlesInBackground(symbol, exchange, marketType, this.currentInterval).catch(() => {});
            }

        } catch (error) {
            console.error('❌ Ошибка переключения:', error);
        } finally {
            if (this._activeGeneration === generationId) {
                this._switchingSymbol = false;
                this._resumeAllUpdates(generationId);

                // ✅ ФИКС: если за время загрузки пользователь кликнул по другому тикеру —
                // доигрываем последний запрошенный переход вместо того, чтобы его терять.
                if (this._pendingSymbolSwitch) {
                    const next = this._pendingSymbolSwitch;
                    this._pendingSymbolSwitch = null;
                    this.switchSymbol(next.symbol, next.exchange, next.marketType);
                }
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
        if (document.hidden || !param || !param.time || !param.point || !this._isChartValid()) {
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
        if (!this._isChartValid() || !this.chartData || this.chartData.length === 0) {
            return false;
        }

        try {
            this._isViewingHistory = false;
            this.lastCandle = this.chartData[this.chartData.length - 1];

            const timeScale = this.chart.timeScale();
            if (!timeScale) return false;

            if (enableRealTime) {
                timeScale.scrollToRealTime();
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
        if (!this._isChartValid()) return;

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
        if (!this._isChartValid() || !this.chartData || this.chartData.length === 0) return;
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
            if (this._activeGeneration === genId && this._autoScalePending && this._isChartValid()) {
                const ps = this.chart?.priceScale('right');
                if (ps) {
                    ps.applyOptions({ autoScale: false });
                }
                this._autoScalePending = false;
                if (this.timerManager) this.timerManager._forceUpdate();
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

    // ✅ ФИКС: используем уже закэшированный this.chartContainer вместо повторного getElementById на каждый вызов
    _updateMainChartHeight() {
        if (!this._isChartValid()) return;
        const chartContainer = this.chartContainer;
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

        if (this.indicatorManager?.panelManager) {
            const panels = this.indicatorManager.panelManager.panels;
            if (panels && Array.isArray(panels)) {
                panels.forEach(panel => {
                    if (panel.chart && !panel.isCollapsed && panel.container) {
                        try {
                            const panelHeight = panel.container.clientHeight;
                            const panelWidth = panel.container.clientWidth;
                            if (panelHeight > 0 && panelWidth > 0) {
                                panel.chart.resize(panelWidth, panelHeight);
                            }
                        } catch (e) {}
                    }
                });
            }
        }
    }

    _resizeIndicatorPanels() {
        const chartContainer = this.chartContainer;
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
            console.warn('⚠️ PriceManager ещё не готов, повтор через 100мс');
            setTimeout(() => this._subscribeToPrice(), 100);
            return;
        }

        if (this._priceSubscriptionKey && this._priceUpdateHandler) {
            console.log(`🔌 Отписка от цены: ${this._priceSubscriptionKey}`);
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

            if (!document.hidden && this._isChartValid()) {
                this._syncPriceLine(price);
                if (this.timerManager) {
                    this.timerManager.updatePrice(price);
                }
            }
        };

        this.priceManager.subscribe(key, this._priceUpdateHandler, this.currentExchange, this.currentMarketType);
        this._startBackgroundTitleUpdate();

        console.log(`✅ Подписка на цену: ${key}`);
    }

    setSymbol(symbol) {
        if (this.currentSymbol === symbol) return;
        this.currentSymbol = symbol;
        this._subscribeToPrice();
    }

    // ✅ ИСПРАВЛЕННЫЙ МЕТОД: toString() для цен < 1e-6 уходит в экспоненциальную запись
    // без точки ("1.2e-7"), из-за чего функция решала, что точности нет, и подставляла
    // дефолтные 2 знака — для дешёвых токенов график показывал "0.00" вместо реальной цены.
    _inferPrecisionFromData() {
        if (!this.chartData || this.chartData.length === 0) return 2;
        const lastPrice = this.chartData[this.chartData.length - 1].close;
        if (!lastPrice || lastPrice === 0) return 2;

        const fixed = lastPrice < 1 ? lastPrice.toFixed(10) : lastPrice.toString(); // ✅ ФИКС
        if (fixed.includes('.')) {
            const decimals = fixed.split('.')[1].replace(/0+$/, '').length || 2;
            return Math.min(Math.max(decimals, 2), 8);
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
            if (this.chart) {
                const priceScale = this.chart.priceScale('right');
                if (priceScale) priceScale.applyOptions({ priceFormat: priceFormat });
            }

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
        if (!candle || !candle.time || !this._isChartValid()) return;
        if (this._candleTimeMap.has(candle.time)) return;

        const lastCandle = this.chartData[this.chartData.length - 1];
        if (lastCandle && candle.time <= lastCandle.time) return;

        if (!candle.quoteVolume && candle.volume) {
            candle.quoteVolume = candle.volume;
        }

        this.chartData.push(candle);
        this._addToTimeMap(candle.time, this.chartData.length - 1);
        this.lastCandle = candle;
        this.currentRealPrice = candle.close;

        this._lastAppliedColor = this._getLineColor();

        const updateData = {
            time: candle.time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close
        };

        if (this.candleSeries) this.candleSeries.update(updateData);
        if (this.barSeries) this.barSeries.update(updateData);

        const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (activeSeries) {
            activeSeries.applyOptions({
                priceLineColor: this._lastAppliedColor,
                priceLineSource: 'lastBar'
            });
        }

        if (this.volumeSeries) {
            const isBullish = candle.close >= candle.open;
            this.volumeSeries.update({
                time: candle.time,
                value: candle.quoteVolume || candle.volume || 0,
                color: isBullish ? this.bullishColor : this.bearishColor
            });
            this._lastVolumeUpdateIndex = this.chartData.length - 1;
        }
        if (this.timerManager) {
            this.timerManager.updatePrice(candle.close);
            this.timerManager.start(this.currentInterval);
        }
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
                value: c.quoteVolume || c.volume || 0,
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
        if (!this.volumeSeries || !this.chartData.length || !this._isChartValid()) return;

        if (this._isSwitchingChartType) return;

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

    // ✅ ИСПРАВЛЕННЫЙ МЕТОД: добавлен хардлимит по времени (_fetchTimeoutMs).
    // Раньше при "зависшем" (не оборванном) сетевом запросе await мог не завершиться
    // никогда — из-за этого _switchingSymbol оставался true навсегда, и весь свитчер
    // тикеров переставал отвечать до перезагрузки страницы.
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
        const timeoutId = setTimeout(() => controller.abort(), this._fetchTimeoutMs); // ✅ ФИКС: хардлимит

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
                rawCandles = data.map(item => {
                    const volume = parseFloat(item[5]);
                    const quoteVolume = parseFloat(item[7]);
                    return {
                        time: Math.floor(item[0] / 1000),
                        open: parseFloat(item[1]),
                        high: parseFloat(item[2]),
                        low: parseFloat(item[3]),
                        close: parseFloat(item[4]),
                        volume: volume,
                        quoteVolume: (quoteVolume > 0) ? quoteVolume : volume
                    };
                });
            } else {
                if (data.retCode !== 0) {
                    throw new Error(`Bybit error: ${data.retCode} - ${data.retMsg}`);
                }
                if (!data.result || !data.result.list) {
                    throw new Error('Bybit: неожиданный формат ответа');
                }
                rawCandles = data.result.list
                    .map(item => {
                        const volume = parseFloat(item[5] || 0);
                        const quoteVolume = parseFloat(item[6] || 0);
                        return {
                            time: Math.floor(parseInt(item[0]) / 1000),
                            open: parseFloat(item[1]),
                            high: parseFloat(item[2]),
                            low: parseFloat(item[3]),
                            close: parseFloat(item[4]),
                            volume: volume,
                            quoteVolume: (quoteVolume > 0) ? quoteVolume : volume
                        };
                    })
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
            clearTimeout(timeoutId); // ✅ ФИКС: снимаем таймер после завершения запроса
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

        if (!price || isNaN(price) || price <= 0) {
            price = this.lastCandle?.close;
        }
        if (!price || isNaN(price) || price <= 0) {
            price = this.chartData?.[this.chartData.length - 1]?.close;
        }

        if (!symbol) {
            document.title = 'График';
            return;
        }

        if (price != null && !isNaN(price) && price > 0) {
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            const precision = series?.options()?.priceFormat?.precision ?? 2;
            const lastCandle = this.chartData?.[this.chartData.length - 1];
            const isBullish = lastCandle ? lastCandle.close >= lastCandle.open : true;
            const arrow = isBullish ? '▲' : '▼';

            const newTitle = `${arrow} ${symbol} ${price.toFixed(precision)}`;

            if (this._lastTitle !== newTitle) {
                this._lastTitle = newTitle;
                document.title = newTitle;
            }
        } else {
            const fallbackTitle = `${symbol} —`;
            if (this._lastTitle !== fallbackTitle) {
                this._lastTitle = fallbackTitle;
                document.title = fallbackTitle;
            }
        }
    }

    updateColorsForSettings(bullishColor, bearishColor) {
        if (!this._isChartValid()) return;

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
        if (!this._isChartValid() || !this.chartData || this.chartData.length === 0) return;
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
        if (this.priceManager && this._priceUpdateHandler && this._priceSubscriptionKey) {
            this.priceManager.unsubscribe(this._priceSubscriptionKey, this._priceUpdateHandler);
            this._priceUpdateHandler = null;
            this._priceSubscriptionKey = null;
        }
        if (this.timerManager) {
            this.timerManager.stop();
            if (typeof this.timerManager.reset === 'function') {
                this.timerManager.reset();
            }
        }
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
        if (!this._isChartValid() || !this.chartData.length) return null;
        const timeScale = this.chart.timeScale();
        const visibleRange = timeScale.getVisibleLogicalRange();
        if (visibleRange) {
            const firstVisibleIndex = Math.floor(visibleRange.from);
            if (firstVisibleIndex >= 0 && firstVisibleIndex < this.chartData.length) return this.chartData[firstVisibleIndex].time;
        }
        return null;
    }

    scrollToTime(time) {
        if (!this._isChartValid() || !time) return;
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
        if (!this._isChartValid() || !this.chartData.length) return;
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

    // ✅ НОВЫЙ ХЕЛПЕР: единая точка ожидания готовности IndexedDB.
    // Раньше saveCandlesToCache честно ждал window.dbReady (поллинг до 2с),
    // а loadCandlesFromCache — нет, поэтому на холодном старте страницы кэш
    // просто не срабатывал в самый нужный момент (первая загрузка тикера).
    async _waitForDb(timeoutMs = 2000) {
        if (window.dbReady) return true;
        return new Promise(resolve => {
            const check = setInterval(() => {
                if (window.dbReady) { clearInterval(check); resolve(true); }
            }, 100);
            setTimeout(() => { clearInterval(check); resolve(!!window.dbReady); }, timeoutMs);
        });
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
            await this._waitForDb(); // ✅ ФИКС: используем общий хелпер
            await window.db.put('candles', cacheData);
        } catch (error) { console.warn('❌ Ошибка сохранения свечей в кэш:', error); }
    }

    // ✅ ИСПРАВЛЕННЫЙ МЕТОД: теперь тоже ждёт готовности БД перед чтением
    // (раньше на холодном старте страницы кэш всегда промахивался мимо ещё
    // не инициализированного window.db, и график всегда шёл на биржу за данными,
    // хотя кэш формально уже мог существовать).
    async loadCandlesFromCache(symbol, exchange, marketType, interval) {
        const CACHE_VERSION = '2';
        const key = `${symbol}_${interval}_${exchange}_${marketType}_v${CACHE_VERSION}`;
        if (!window.db) return null;
        try {
            await this._waitForDb(); // ✅ ФИКС
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
            if (this._isChartValid() && this.chartData && this.chartData.length > 0 && this.chart.timeScale()?.getVisibleRange()) return true;
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }
        return false;
    }

    async waitForSeriesReady() { return this.waitForReady(); }

    timeToCoordinate(time) {
        if (!this._isChartValid()) return null;
        try { return this.chart.timeScale().timeToCoordinate(time); }
        catch (e) { return null; }
    }

    coordinateToTime(coordinate) {
        if (!this._isChartValid()) return null;
        try { return this.chart.timeScale().coordinateToTime(coordinate); }
        catch (e) { return null; }
    }

    priceToCoordinate(price) {
        if (!this._isChartValid()) return null;
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
        if (!this._isChartValid()) return null;
        try {
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            return series.coordinateToPrice(coordinate);
        } catch (e) { return null; }
    }

    onVisibleLogicalRangeChange(range) {
        if (!range || !this.chartData.length || !this._isChartValid()) return;
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

    // ✅ ИСПРАВЛЕННЫЙ МЕТОД: убрана бессмысленная привязка раннего выхода к _isScrolling —
    // условие `!this._isScrolling && length <= max` было почти всегда ложным во время
    // скролла и функция каждый раз досчитывала keepFrom/keepTo впустую, полагаясь на
    // последующий `if (leftTrim === 0 && rightTrim === 0) return;`. Теперь выход
    // единственный и понятный: если данных меньше лимита — обрезать нечего.
    _performTrimNow(fromIndex, toIndex) {
        if (this._isTrimming || this.isLoadingMore || !this._isChartValid()) return;
        if (this.chartData.length <= this._maxCandlesInMemory) return; // ✅ ФИКС

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

            const priceScale = this.chart.priceScale('right');
            priceScale.applyOptions({ autoScale: false });

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

    // ✅ ИСПРАВЛЕННЫЙ МЕТОД: добавлен generation guard после await.
    // Раньше при быстром переключении тикера (switchSymbol обнуляет chartData=[])
    // именно в момент, когда этот запрос уже успел зарезолвиться, следующая строка
    // `this.chartData[0].time` могла упасть с TypeError на пустом массиве.
    async _loadHistoryAsync() {
        if (this.isLoadingMore || !this.hasMoreData || !this._isChartValid()) return;

        const now = Date.now();
        if (now - this._lastHistoryLoadTime < 1500) return;

        this.isLoadingMore = true;
        this._lastHistoryLoadTime = now;
        const genId = this._activeGeneration; // ✅ ФИКС: снимок поколения ДО await

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

            // ✅ ФИКС: проверяем, что за время запроса тикер не сменился и данные не обнулились
            if (!olderCandles || olderCandles.length === 0 || !this._isChartValid() ||
                this._activeGeneration !== genId || this.chartData.length === 0) {
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

    // ✅ ИСПРАВЛЕННЫЙ МЕТОД: добавлен generation guard после await —
    // без него фоновое обновление могло дописать чужие (от предыдущего тикера)
    // свечи в chartData нового тикера при неудачном стечении таймингов.
    async refreshCandlesInBackground(symbol, exchange, marketType, interval) {
        const genId = this._activeGeneration; // ✅ ФИКС
        try {
            if (symbol !== this.currentSymbol || exchange !== this.currentExchange || !this._isChartValid()) return;
            const freshCandles = await this.fetchKlines(
                symbol, exchange, marketType, interval, 100,
                null,
                'background'
            );
            if (!freshCandles || freshCandles.length === 0 || !this._isChartValid()) return;
            if (symbol !== this.currentSymbol || this._activeGeneration !== genId) return; // ✅ ФИКС

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
        if (document.hidden || !this._isChartValid()) return;
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
        if (document.hidden || !this._isChartValid()) return;

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
