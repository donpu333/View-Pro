const SOURCE_PRIORITY = { 'ws': 3, 'rest': 2, 'cache': 1 };

const INTERVAL_SECONDS_MAP = {
    '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200,
    '1d': 86400, '1w': 604800, '1M': 2592000
};

const FMT_TICK_DAY = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
const FMT_TICK_TIME = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
const FMT_CROSSHAIR = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
});

const KLINE_HOSTS = {
    binanceSpot:    ['https://api.binance.com', 'https://data-api.binance.vision'],
    binanceFutures: ['https://fapi.binance.com'],
    bybit:          ['https://api.bybit.com', 'https://api.bytick.com']
};

const FETCH_CONTROLLER_SLOTS = {
    'switch':     '_switchFetchController',
    'user':       '_currentFetchController',
    'history':    '_historyFetchController',
    'background': '_backgroundFetchController',
    'heal':       '_healFetchController',
    'prefetch':   '_prefetchFetchController'
};

class ChartManager {

    constructor(container) {
        this.chartData = [];
        this.lastCandle = null;
        this._loadingSymbol = false;
        this._switchingSymbol = false;
        this._pendingSwitchRequest = null;
        this._generationCounter = 0;
        this._activeGeneration = 0;
        this._updatesSuspended = false;
        this._isApplyingData = false;
        this._pendingData = null;
        this._batchUpdateActive = false;
        this._isRestoringZoom = false;
        this._isSwitchingInterval = false;
        this._isSwitchingChartType = false;
        this._switchWatchdogTimer = null;
        this._switchProgressAt = 0;
        this._switchOwnerToken = null;
        this._setDataReadyTimeoutMs = 10000;
        this._savedBarSpacing = parseFloat(localStorage.getItem('chartBarSpacing')) || 25;
        this._lastSavedBarSpacing = this._savedBarSpacing;
        this._pendingBarSpacing = null;
        this.indicatorManager = new IndicatorManager(this);
        this.chartContainer = document.getElementById('chart-container') || container;

        this._symbolSwitchOverlay = document.createElement('div');
        this._symbolSwitchOverlay.className = 'chart-symbol-switch-overlay';
        this._symbolSwitchOverlay.style.cssText = [
            'position:absolute', 'inset:0', 'background:#000000',
            'opacity:0', 'pointer-events:none', 'transition:opacity 0.12s ease', 'z-index:5'
        ].join(';');

        if (this.chartContainer) {
            if (getComputedStyle(this.chartContainer).position === 'static') {
                this.chartContainer.style.position = 'relative';
            }
            this.chartContainer.appendChild(this._symbolSwitchOverlay);
        }

        this.currentChartType = localStorage.getItem('chartType') || 'candle';
        this.isLoadingMore = false;
        this.hasMoreData = true;
        this._priceSubscriptionKey = null;
        this.currentInterval = localStorage.getItem('lastTimeframe') || (typeof CONFIG !== 'undefined' ? CONFIG.defaultInterval : '1h');
        this.currentSymbol = (typeof CONFIG !== 'undefined' ? CONFIG.defaultSymbol : 'BTCUSDT');
        this.currentExchange = 'binance';
        this.currentMarketType = 'futures';
        this._lastWidth = this.chartContainer ? this.chartContainer.clientWidth : 0;
        this._lastHeight = this.chartContainer ? this.chartContainer.clientHeight : 0;
        this._initPromise = null;
        this._savedTimePosition = null;
        this._savedLogicalRange = null;
        this._lastTimeframe = null;
        this._symbolChangeCallbacks = [];
        this._colorChangeCallbacks = [];
        this._updateScheduled = false;
        this._lastUpdateTime = 0;
        this._pendingUpdates = false;
        this._pendingRedraw = false;
        this._updatePositionRafId = null;
        this._lastAppliedColor = null;
        this._lastAppliedPrecision = null;
        this._isSyncing = false;
        this._currentFetchController = null;
        this._historyFetchController = null;
        this._backgroundFetchController = null;
        this._healFetchController = null;
        this._prefetchFetchController = null;
        this._switchFetchController = null;
        this._lastKlinesFailure = null;
        this._serverTimeOffsetMs = 0;
        this._clockSkewWarned = false;
        this._klinesMaxAttempts = 2;
        this._klinesRetryTimeoutMs = 5000;
        this._klinesRetryDelayMs = 350;
        this._staleCacheMaxAgeMs = 24 * 60 * 60 * 1000;
        this._badIntervalsWarned = new Set();
        this._updateTimeout = null;
        this._autoScalePending = false;
        this._isVerticalZooming = false;
        this._crosshairRafId = null;
        this._latestCrosshairData = null;
        this._pendingCrosshairParam = null;
        this._crosshairActive = false;
        this._crosshairIdleTimeout = null;
        this._drawingScrollLock = false;
        this._panelCrosshairLast = new Map();
        this._refreshingAfterHidden = false;
        this._periodicSyncInterval = null;
        this._quarantineTimeout = null;
        this._preHiddenSuspendedState = false;
        this._lastKlineEventTime = 0;
        this._catchingUpMissed = false;
        this._lastCatchUpAttempt = 0;
        this._verticalZoomTimeout = null;
        this._wheelHandler = null;
        this._chartTypeSwitchTimeout = null;
        this._priceUpdateRafId = null;
        this._pendingPriceValue = null;
        this._pendingPriceUpdate = null;
        this._lastPriceGateAt = 0;
        this._priceGateMinMs = 100;
        this._priceGateTimeout = null;
        this._titleUpdateTimeout = null;
        this._lastTitleUpdateAt = 0;
        this._titleUpdateIntervalMs = 500;
        this._titlePrecision = null;
        this._domCheckOk = false;
        this._domCheckAt = 0;
        this._lastIndicatorsUpdateAt = 0;
        this._indicatorsUpdateTimeout = null;
        this._candleTimeMap = new Map();
        this._destroyed = false;
        this._lastSeriesResyncAt = 0;
        this._healingGaps = false;
        this._lastGapHealAttempt = 0;
        this._unhealableGaps = new Set();
        this._autoScrollEnabled = false;
        this._autoScrollTimeout = null;
        this._invisibleSeriesDirty = true;
        this._isScrolling = false;
        this._isScrollingFast = false;
        this._scrollStopTimeout = null;
        this._lastScrollTime = 0;
        this._panelsSyncRafId = null;
        this._lastVisibleRange = null;
        this._isViewingHistory = false;
        this._historyLoadQueue = [];
        this._preloadThreshold = 100;
        this._initialBatch = 1000;
        this._batchSize = 1000;
        this._minLoadDelay = 1000;
        this._lastHistoryLoadTime = 0;
        this._pendingHistoryLoad = false;
        this._historyEndTime = null;
        this._fetchPromise = null;

        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        this._historyCheckThrottleMs = 120;
        this._lastHistoryCheckAt = 0;
        this._historyThrottleRetry = null;
        this._historyPrefetchRunning = false;
        this._historyPrefetchMaxPages = isMobile ? 2 : 4;
        this._prefetchPageDelayMs = 220;
        this._prefetchIdleDelayMs = 900;
        this._historyCacheTtlMs = 7 * 24 * 60 * 60 * 1000;
        this._lwBarsCache = (typeof WeakMap === 'function') ? new WeakMap() : null;
        this._cachedPrecisionKey = null;
        this._cachedPrecisionValue = null;
        this._lastInferredPrecision = null;

        try {
            const PRECISION_CACHE_VERSION = '2';
            if (localStorage.getItem('vpPrecisionCacheVersion') !== PRECISION_CACHE_VERSION) {
                const doomed = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.indexOf('precision_') === 0) doomed.push(k);
                }
                doomed.forEach(k => localStorage.removeItem(k));
                localStorage.setItem('vpPrecisionCacheVersion', PRECISION_CACHE_VERSION);
                if (doomed.length) console.log(`🧹 [VP-PRECISION] сброшен устаревший кэш точности: ${doomed.length} записей`);
            }
        } catch (e) {}

        this._nearestTimeCache = new Map();
        this._nearestTimeCacheGen = null;
        this._nearestTimeCacheMax = 4096;
        this._panelsSyncActive = false;
        this._maxCandlesInMemory = isMobile ? 3000 : 8000;
        this._hardMaxCandles = isMobile ? 15000 : 40000;
        this._leftBuffer = isMobile ? 1000 : 2000;
        this._rightBuffer = isMobile ? 500 : 1000;
        this._trimDebounceTimeout = null;
        this._trimDebounceDelay = isMobile ? 500 : 300;
        this._pendingTrimParams = null;
        this._isTrimming = false;
        this._volumeDataCache = null;
        this._volumeDataDirty = true;
        this._lastVolumeUpdateIndex = -1;
        this._volumeScaleMargins = { top: 0.8, bottom: 0 };
        this._fetchTimeoutMs = 7000;

        this._visibilityHandler = () => {
            if (!document.hidden) {
                if (!this._isChartValid()) {
                    setTimeout(() => { if (this._isChartValid()) this.refreshCandlesAfterTabHidden(); }, 100);
                    return;
                }
                if (window.wsManager) window.wsManager.forceReconnect?.();
                this.refreshCandlesAfterTabHidden();
                if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
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
                try {
                    if (this.chart && this.chart.timeScale()) {
                        const range = this.chart.timeScale().getVisibleLogicalRange();
                        this._savedLogicalRange = range ? { from: range.from, to: range.to } : null;
                    }
                } catch (e) { this._savedLogicalRange = null; }
                this._startBackgroundTitleUpdate();
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);

        this._priceUpdateHandler = null;
        this._candleCheckerTimeout = null;
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

        this.chart = LightweightCharts.createChart(container, {
            layout: { background: { color: '#000000' }, textColor: '#808080', attributionLogo: false },
            grid: { vertLines: { visible: false }, horzLines: { visible: false } },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
            handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
            animation: { duration: 0 },
            timeScale: {
                timeVisible: true, secondsVisible: false, borderColor: '#333333',
                barSpacing: this._savedBarSpacing || 25, minBarSpacing: 1,
                fixLeftEdge: false, fixRightEdge: false, rightOffset: 15,
                shiftVisibleRangeOnNewBar: true,
                tickMarkFormatter: (time) => {
                    const iv = this.currentInterval;
                    return (iv === '1d' || iv === '1w' || iv === '1M')
                        ? FMT_TICK_DAY.format(time * 1000)
                        : FMT_TICK_TIME.format(time * 1000);
                }
            },
            rightPriceScale: {
                borderColor: '#333333', borderVisible: true,
                scaleMargins: { top: 0.1, bottom: 0.25 }, autoScale: true, entireTextOnly: false,
                mode: (localStorage.getItem('priceScaleMode') === 'log')
                    ? ((typeof LightweightCharts !== 'undefined' && LightweightCharts.PriceScaleMode)
                        ? LightweightCharts.PriceScaleMode.Logarithmic : 1)
                    : 0,
            },
            localization: { timeFormatter: (time) => FMT_CROSSHAIR.format(time * 1000) }
        });

        if (typeof this.chart.addPriceScale === 'function') {
            this.chart.addPriceScale({
                id: 'volume', scaleMargins: { top: 0.8, bottom: 0 },
                borderColor: '#333333', borderVisible: true, autoScale: true, visible: true
            });
        }

        const _DEFAULT_BULLISH = '#26a69a';
        const _DEFAULT_BEARISH = '#ef5350';
        if (typeof CONFIG !== 'undefined') {
            if (!CONFIG.colors) CONFIG.colors = {};
            if (!CONFIG.colors.bullish) CONFIG.colors.bullish = _DEFAULT_BULLISH;
            if (!CONFIG.colors.bearish) CONFIG.colors.bearish = _DEFAULT_BEARISH;
        }
        const initialBullish = (typeof CONFIG !== 'undefined' && CONFIG.colors && CONFIG.colors.bullish) || _DEFAULT_BULLISH;
        const initialBearish = (typeof CONFIG !== 'undefined' && CONFIG.colors && CONFIG.colors.bearish) || _DEFAULT_BEARISH;

        this.candleSeries = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: initialBullish, downColor: initialBearish, borderVisible: false,
            wickUpColor: initialBullish, wickDownColor: initialBearish, priceScaleId: 'right'
        });
        this.barSeries = this.chart.addSeries(LightweightCharts.BarSeries, {
            upColor: initialBullish, downColor: initialBearish,
            openVisible: true, thinBars: true, priceScaleId: 'right'
        });
        this.volumeSeries = this.chart.addSeries(LightweightCharts.HistogramSeries, {
            priceScaleId: 'volume', priceFormat: { type: 'volume' }, color: '#26a69a',
            lineWidth: 1, lastValueVisible: false, priceLineVisible: false, title: '', base: 0
        });

        [this.candleSeries, this.barSeries].forEach(series => {
            const bgColor = '#00bcd4';
            series.applyOptions({
                priceLineVisible: true, lastValueVisible: true, priceLineColor: bgColor,
                priceLineWidth: 1, priceLineStyle: LightweightCharts.LineStyle.Dashed,
                lastValueLabelBackgroundColor: bgColor,
                lastValueLabelTextColor: this._getTextColorForBackground(bgColor),
                priceLineTitle: ''
            });
            series.__lastLineColor = bgColor;
        });

        const savedBg = localStorage.getItem('chartBgColor');
        const savedBullish = localStorage.getItem('chartBullishColor');
        const savedBearish = localStorage.getItem('chartBearishColor');
        if (savedBg) this.chart.applyOptions({ layout: { background: { color: savedBg } } });
        if (savedBullish && savedBearish) {
            if (typeof CONFIG !== 'undefined') {
                if (!CONFIG.colors) CONFIG.colors = {};
                CONFIG.colors.bullish = savedBullish;
                CONFIG.colors.bearish = savedBearish;
            }
            this.bullishColor = savedBullish;
            this.bearishColor = savedBearish;
            this.candleSeries.applyOptions({
                upColor: savedBullish, downColor: savedBearish,
                wickUpColor: savedBullish, wickDownColor: savedBearish
            });
            this.barSeries.applyOptions({ upColor: savedBullish, downColor: savedBearish });
        } else {
            this.bullishColor = initialBullish;
            this.bearishColor = initialBearish;
        }

        this._applyVolumeScaleOptions();
        if (!localStorage.getItem('chartBarSpacing')) localStorage.setItem('chartBarSpacing', '25');
        this.timerManager = null;

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
            const CACHE_VERSION = '3';
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
                this._resizeObserver = new ResizeObserver(() => this._updateMainChartHeight());
                this._resizeObserver.observe(panelsContainer);
            }
            this._chartContainerResizeObserver = new ResizeObserver(() => {
                clearTimeout(this._containerResizeTimeout);
                this._containerResizeTimeout = setTimeout(() => {
                    if (this._isChartValid()) {
                        this._updateMainChartHeight();
                        if (this._resizeIndicatorPanels) this._resizeIndicatorPanels();
                        if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
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
                window.wsManager.connect(this.currentSymbol, this.currentInterval, this.currentExchange, this.currentMarketType);
            }
        }, 1000);
    }

    _enableAutoScroll(durationMs = 2000) {
        this._autoScrollEnabled = true;
        if (this._autoScrollTimeout) clearTimeout(this._autoScrollTimeout);
        this._autoScrollTimeout = setTimeout(() => {
            this._autoScrollEnabled = false;
            this._autoScrollTimeout = null;
        }, durationMs);
    }
    _disableAutoScroll() {
        this._autoScrollEnabled = false;
        if (this._autoScrollTimeout) { clearTimeout(this._autoScrollTimeout); this._autoScrollTimeout = null; }
    }

    _scrollToRightEdgeWithOffset() {
        if (!this._isChartValid() || !this.chartData || this.chartData.length === 0) return;
        const ts = this.chart.timeScale();
        if (!ts) return;
        const lastIndex = this.chartData.length - 1;
        const rightOffset = 15;
        try {
            const cur = ts.getVisibleLogicalRange();
            if (cur && Math.abs((cur.to - lastIndex) - rightOffset) < 0.5) return;
        } catch (e) {}
        let barSpacing = this._savedBarSpacing || ts.options().barSpacing || 25;
        if (!barSpacing || barSpacing <= 0) barSpacing = 25;
        let psW = 0;
        try { psW = this.chart.priceScale('right')?.width?.() || 0; } catch (e) {}
        const containerW = this.chartContainer?.clientWidth || 800;
        const width = Math.max(50, containerW - psW - 8);
        const visibleBars = width / barSpacing;
        const to = lastIndex + rightOffset;
        const from = to - visibleBars;
        try { ts.applyOptions({ barSpacing, rightOffset }); } catch (e) {}
        try { ts.setVisibleLogicalRange({ from, to }); } catch (e) {}
    }

    _resetPriceScaleWidth() {
        if (!this._isChartValid()) return;
        try { this.chart.priceScale('right').applyOptions({ minimumWidth: 0 }); } catch (e) {}
    }

    _lockPriceScaleWidth() {
        if (!this._isChartValid()) return;
        try {
            const ps = this.chart.priceScale('right');
            if (!ps) return;
            const w = ps.width();
            if (w > 0) ps.applyOptions({ minimumWidth: w });
        } catch (e) {}
    }
    _relockPriceScaleWidth() {
        if (!this._isChartValid()) return;
        try {
            const lr = this.chart.timeScale().getVisibleLogicalRange();
            if (lr && this.chartData.length > 0 && lr.to < this.chartData.length - 3) {
                this._resetPriceScaleWidth();
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    if (this._switchingSymbol || this._isSwitchingInterval) return;
                    this._lockPriceScaleWidth();
                }));
                return;
            }
        } catch (e) {}
        this._resetPriceScaleWidth();
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (this._switchingSymbol || this._isSwitchingInterval) return;
            this._lockPriceScaleWidth();
        }));
    }

    _toLwBar(c) {
        if (!c || typeof c !== 'object') return null;
        const t = c.time, o = c.open, h = c.high, l = c.low, cl = c.close;
        if (typeof t !== 'number' || !isFinite(t) || !Number.isInteger(t) || t <= 0 || t > 4102444800) return null;
        if (typeof o !== 'number' || !isFinite(o) || o <= 0) return null;
        if (typeof h !== 'number' || !isFinite(h) || h <= 0) return null;
        if (typeof l !== 'number' || !isFinite(l) || l <= 0) return null;
        if (typeof cl !== 'number' || !isFinite(cl) || cl <= 0) return null;
        if (h < l || o > h || o < l || cl > h || cl < l) return null;
        return { time: t, open: o, high: h, low: l, close: cl };
    }

    _toLwBarsArray(arr) {
        if (!Array.isArray(arr)) return [];
        const interval = this.currentInterval;
        const cache = this._lwBarsCache;
        const out = [];
        let sorted = true;
        let prevTime = -Infinity;
        for (let i = 0; i < arr.length; i++) {
            const c = arr[i];
            if (!c || typeof c !== 'object') continue;
            const rawT = c.time;
            if (typeof rawT !== 'number' || !isFinite(rawT) || !Number.isInteger(rawT) || rawT <= 0) continue;
            const alignedT = this._alignTimeForInterval(rawT, interval);
            if (!Number.isInteger(alignedT) || alignedT <= 0) continue;
            if (alignedT < prevTime) sorted = false;
            prevTime = alignedT;
            let bar = cache ? cache.get(c) : null;
            if (bar && bar.time === alignedT && bar.open === c.open && bar.high === c.high &&
                bar.low === c.low && bar.close === c.close) {
                out.push(bar);
                continue;
            }
            const o = c.open, h = c.high, l = c.low, cl = c.close;
            if (typeof o !== 'number' || !isFinite(o) || o <= 0) continue;
            if (typeof h !== 'number' || !isFinite(h) || h <= 0) continue;
            if (typeof l !== 'number' || !isFinite(l) || l <= 0) continue;
            if (typeof cl !== 'number' || !isFinite(cl) || cl <= 0) continue;
            if (alignedT > 4102444800) continue;
            if (h < l || o > h || o < l || cl > h || cl < l) continue;
            bar = { time: alignedT, open: o, high: h, low: l, close: cl };
            if (cache) cache.set(c, bar);
            out.push(bar);
        }
        if (!sorted) {
            const byTime = new Map();
            for (const b of out) byTime.set(b.time, b);
            return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
        }
        return out;
    }

    _assertAscendingBars(bars, who) {
        if (!Array.isArray(bars) || bars.length < 2) return bars;
        let prev = -Infinity;
        for (let i = 0; i < bars.length; i++) {
            const b = bars[i];
            const t = b && b.time;
            if (typeof t !== 'number') continue;
            if (t < prev) {
                console.error(`❌ [VP-UNSORTED] ${who}: setData() НЕ по возрастанию времени ` +
                    `(позиция ${i}: ${t} после ${prev}, всего ${bars.length} баров) — сортирую принудительно.`);
                try { if (typeof console.trace === 'function') console.trace('[VP-UNSORTED] источник'); } catch (e) {}
                return bars.slice().sort((a, b2) => ((a && a.time) || 0) - ((b2 && b2.time) || 0));
            }
            prev = t;
        }
        return bars;
    }

    _setVisibleSeriesData(lwBars, clearHidden = false) {
        const visible = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        const hidden = this.currentChartType === 'candle' ? this.barSeries : this.candleSeries;
        if (visible) {
            const safeBars = this._assertAscendingBars(lwBars, 'свечи');
            try { visible.setData(safeBars); }
            catch (e) {
                console.error('❌ [VP-RENDER] setData(свечи) упал:', e && e.message ? e.message : e);
                try { visible.setData([]); } catch (e2) {}
                try { visible.setData(safeBars); }
                catch (e3) { console.error('❌ [VP-RENDER] повторный setData(свечи) тоже упал:', e3 && e3.message ? e3.message : e3); }
            }
        }
        if (clearHidden && hidden) { try { hidden.setData([]); } catch (e) {} }
        this._invisibleSeriesDirty = true;
    }

    _applyVolumeScaleOptions() {
        if (!this.chart) return;
        const volumeScale = this.chart.priceScale('volume');
        if (!volumeScale) return;
        volumeScale.applyOptions({
            scaleMargins: this._volumeScaleMargins, visible: true,
            borderVisible: true, autoScale: true
        });
    }

    getCurrentPriceColor() {
        if (!this.chartData || this.chartData.length === 0) return this.bullishColor || '#26a69a';
        const lastCandle = this.chartData[this.chartData.length - 1];
        if (!lastCandle) return this.bullishColor || '#26a69a';
        return lastCandle.close >= lastCandle.open ? (this.bullishColor || '#26a69a') : (this.bearishColor || '#ef5350');
    }

    _isDarkColor(hexColor) {
        if (!hexColor || typeof hexColor !== 'string') return false;
        let hex = hexColor.replace('#', '');
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        if (hex.length !== 6) return false;
        const r = parseInt(hex.substring(0,2),16), g = parseInt(hex.substring(2,4),16), b = parseInt(hex.substring(4,6),16);
        return ((r*299)+(g*587)+(b*114))/1000 < 150;
    }

    _getTextColorForBackground(bgColor) { return this._isDarkColor(bgColor) ? '#ffffff' : '#000000'; }
    onColorChange(cb) { if (!this._colorChangeCallbacks) this._colorChangeCallbacks = []; this._colorChangeCallbacks.push(cb); }
    offColorChange(cb) { if (!this._colorChangeCallbacks) return; this._colorChangeCallbacks = this._colorChangeCallbacks.filter(c => c !== cb); }
    _notifyColorChange() { if (this._colorChangeCallbacks) this._colorChangeCallbacks.forEach(cb => cb()); }

    _isChartValid() {
        if (!this.chart || !this.candleSeries || !this.barSeries || !this.chartContainer) return false;
        const now = Date.now();
        if (this._domCheckOk && now - this._domCheckAt < 1000) return true;
        this._domCheckOk = document.contains(this.chartContainer);
        this._domCheckAt = now;
        return this._domCheckOk;
    }

    _updateVisibleSeries(updateData) {
        try {
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            if (!series) return;
            let data = updateData;
            const rawT = data && data.time;
            if (typeof rawT === 'number' && Number.isInteger(rawT) && rawT > 0) {
                const aligned = this._alignTimeToInterval(rawT);
                if (aligned !== rawT) data = { ...data, time: aligned };
            }
            const safe = this._toLwBar(data);
            if (!safe) return;
            if (this._isHistoricalBarTime(safe.time)) series.update(safe, true);
            else series.update(safe);
        } catch (e) {
            const needFull = /oldest data|non-existing data point/i.test(String((e && e.message) || ''));
            try { this._resyncSeriesFromData(needFull); } catch (e2) {}
        }
    }

    _isHistoricalBarTime(time) {
        try {
            if (!this.chartData || this.chartData.length === 0) return false;
            const last = this.chartData[this.chartData.length - 1];
            if (last && last.time === time) return false;
            return this._candleTimeMap.has(time);
        } catch (e) { return false; }
    }

    _resyncSeriesFromData(force = false) {
        try {
            if (!this._isChartValid() || !this.chartData || this.chartData.length === 0) return;
            const now = Date.now();
            if (!force && this._lastSeriesResyncAt && now - this._lastSeriesResyncAt < 250) return;
            this._lastSeriesResyncAt = now;
            this._applyDataAtomically();
        } catch (e) {}
    }

    _applyDataAtomically(rebuildVolume = true) {
        if (!this._isChartValid() || !this.chartData.length) return;
        const ts = this.chart.timeScale();
        if (!ts) return;
        let anchorTime = null, anchorFrac = 0, visibleSpan = 0, atRightEdge = false;
        try {
            const lr = ts.getVisibleLogicalRange();
            const lastIndex = this.chartData.length - 1;
            if (lr && lastIndex >= 0 && lr.to > lr.from) {
                atRightEdge = lr.to >= lastIndex - 2;
                visibleSpan = Math.max(10, lr.to - lr.from);
                const rawFrom = Math.max(0, Math.min(this.chartData.length - 1, lr.from));
                const fromIdx = Math.floor(rawFrom);
                anchorFrac = rawFrom - fromIdx;
                anchorTime = this.chartData[fromIdx]?.time ?? null;
            }
        } catch (e) {}
        const lwBars = this._toLwBarsArray(this.chartData);
        if (lwBars.length === 0) {
            console.error('❌ [VP-RENDER] _applyDataAtomically: все свечи отбракованы валидацией — series не трогаю');
            return;
        }
        this._setVisibleSeriesData(lwBars, true);
        if (rebuildVolume) {
            this._volumeDataCache = null;
            this._volumeDataDirty = true;
            this._lastVolumeUpdateIndex = -1;
            if (this.volumeSeries) {
                try {
                    const vd = this._buildVolumeData(this.chartData);
                    this.volumeSeries.setData(vd);
                    this._volumeDataDirty = false;
                    this._lastVolumeUpdateIndex = this.chartData.length - 1;
                } catch (e) {}
            }
            this._applyVolumeScaleOptions();
        }
        try {
            if (!atRightEdge && anchorTime != null) {
                const newIdx = this._candleTimeMap.get(anchorTime);
                if (newIdx !== undefined) {
                    ts.setVisibleLogicalRange({ from: newIdx + anchorFrac, to: newIdx + anchorFrac + visibleSpan });
                }
            }
        } catch (e) {}
    }

    _applyAppendOnly(newCandles) {
        if (!this._isChartValid() || !newCandles || newCandles.length === 0) return;
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (!series) return;
        let failed = false;
        for (const c of newCandles) {
            const point = this._toLwBar(c);
            if (!point) continue;
            try { series.update(point); } catch (e) { failed = true; break; }
            if (this.volumeSeries) {
                this._safeVolumeBarUpdate(point.time, c.quoteVolume || c.volume || 0,
                    point.close >= point.open ? this.bullishColor : this.bearishColor);
            }
        }
        if (failed) {
            try { series.setData([]); } catch (e) {}
            this._resyncSeriesFromData(true);
            return;
        }
        this._invisibleSeriesDirty = true;
        this._volumeDataDirty = true;
        this._lastVolumeUpdateIndex = this.chartData.length - 1;
    }

    _safeVolumeBarUpdate(time, value, color) {
        if (!this.volumeSeries) return;
        const t = Number(time), v = Number(value);
        if (!isFinite(t) || !Number.isInteger(t) || t <= 0) return;
        if (!isFinite(v) || v < 0) return;
        try {
            this.volumeSeries.update({ time: t, value: v, color }, this._isHistoricalBarTime(t));
        } catch (e) {
            try {
                this._volumeDataCache = null;
                this._volumeDataDirty = true;
                this._lastVolumeUpdateIndex = -1;
                const vd = this._buildVolumeData(this.chartData);
                this.volumeSeries.setData(vd);
                this._volumeDataDirty = false;
                this._lastVolumeUpdateIndex = this.chartData.length - 1;
            } catch (e2) {}
        }
    }

    _showSymbolSwitchOverlay() {
        if (this._symbolSwitchOverlay) {
            try {
                const bg = this.chart?.options()?.layout?.background?.color;
                if (bg) this._symbolSwitchOverlay.style.background = bg;
            } catch (e) {}
            this._symbolSwitchOverlay.style.opacity = '1';
        }
    }
    _hideSymbolSwitchOverlay() { if (this._symbolSwitchOverlay) this._symbolSwitchOverlay.style.opacity = '0'; }

    _doubleFrame(cb, fallbackMs = 120) {
        let done = false;
        let timer = null;
        const run = (viaFallback) => {
            if (done) return;
            done = true;
            if (timer !== null) { clearTimeout(timer); timer = null; }
            try { cb(viaFallback === true); } catch (e) { console.error('❌ _doubleFrame callback:', e); }
        };
        try {
            requestAnimationFrame(() => requestAnimationFrame(() => run(false)));
        } catch (e) { run(true); return; }
        timer = setTimeout(() => run(true), fallbackMs);
    }

    _withTimeout(promise, ms, onTimeout) {
        let timer = null;
        const guard = new Promise((resolve) => {
            timer = setTimeout(() => {
                try { resolve(onTimeout ? onTimeout() : undefined); } catch (e) { resolve(undefined); }
            }, ms);
        });
        return Promise.race([Promise.resolve(promise), guard])
            .finally(() => { if (timer !== null) clearTimeout(timer); });
    }

    _switchProgress() { this._switchProgressAt = Date.now(); }

    _armSwitchWatchdog(kind, ownerToken, stallMs = 30000) {
        this._switchProgress();
        if (this._switchWatchdogTimer !== null) { clearTimeout(this._switchWatchdogTimer); this._switchWatchdogTimer = null; }
        if (this._destroyed) return;
        const check = () => {
            this._switchWatchdogTimer = null;
            if (this._destroyed) return;
            if (this._switchOwnerToken !== ownerToken) return;
            if (!this._switchingSymbol && !this._isSwitchingInterval) return;
            const stalledFor = Date.now() - (this._switchProgressAt || 0);
            if (stalledFor < stallMs) {
                this._switchWatchdogTimer = setTimeout(check, Math.min(stallMs, 5000));
                return;
            }
            console.error(`❌ [VP-STUCK] ${kind} не завершилось за ${Math.round(stalledFor / 1000)} с — принудительно разблокирую график`);
            this._switchOwnerToken = null;
            this._activeGeneration = ++this._generationCounter;
            try { this._abortAllProcesses(); } catch (e) {}
            this._switchingSymbol = false;
            this._isSwitchingInterval = false;
            this._updatesSuspended = false;
            try { if (this.priceManager) this.priceManager.resume?.(); } catch (e) {}
            this._hideSymbolSwitchOverlay();
            try { this._revertSymbolUi(this.currentSymbol, this.currentExchange, this.currentMarketType); } catch (e) {}
            this._notifyUser({
                title: '⚠️ Переключение зависло',
                text: `${this.currentSymbol}: график разблокирован. Нажмите на тикер ещё раз, чтобы повторить загрузку.`,
                color: '#ffa500', duration: 8000
            });
            try { this._startPeriodicSync(); this._startNewCandleChecker(); } catch (e) {}
            try { this._dispatchPendingSwitch(); } catch (e) {}
        };
        this._switchWatchdogTimer = setTimeout(check, Math.min(stallMs, 5000));
    }

    _clearSwitchWatchdog() {
        if (this._switchWatchdogTimer !== null) { clearTimeout(this._switchWatchdogTimer); this._switchWatchdogTimer = null; }
    }

    onWebSocketConnected() { this._syncRecentCandles().catch(() => {}); }

    _safeElement(id) {
        const el = document.getElementById(id);
        if (el) return el;
        return {
            classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
            textContent: '', className: '', style: {}
        };
    }

    _rebuildTimeMap() {
        this._candleTimeMap.clear();
        for (let i = 0; i < this.chartData.length; i++) this._candleTimeMap.set(this.chartData[i].time, i);
    }
    _addToTimeMap(time, index) { this._candleTimeMap.set(time, index); }

    _stampCandle(candle, source, receivedAt, eventTime = null) {
        if (!candle) return candle;
        candle._source = source;
        candle._receivedAt = (receivedAt !== null && receivedAt !== undefined && !isNaN(receivedAt)) ? receivedAt : Date.now();
        candle._eventTime = (eventTime !== null && eventTime !== undefined && !isNaN(eventTime)) ? eventTime : null;
        return candle;
    }

    _isFresherUpdate(existingCandle, receivedAt, source) {
        if (!existingCandle || existingCandle._receivedAt === undefined || existingCandle._receivedAt === null) return true;
        if (existingCandle._isPlaceholder === true) return true;
        if (receivedAt > existingCandle._receivedAt) return true;
        if (receivedAt < existingCandle._receivedAt) return false;
        return (SOURCE_PRIORITY[source] || 0) > (SOURCE_PRIORITY[existingCandle._source] || 0);
    }

    _getLineColor() {
        if (!this.chartData || this.chartData.length === 0) return this.bullishColor || CONFIG?.colors?.bullish || '#26a69a';
        const lastCandle = this.chartData[this.chartData.length - 1];
        if (!lastCandle) return this.bullishColor || CONFIG?.colors?.bullish || '#26a69a';
        const isBullish = lastCandle.close >= lastCandle.open;
        return isBullish ? (this.bullishColor || CONFIG?.colors?.bullish || '#26a69a') : (this.bearishColor || CONFIG?.colors?.bearish || '#ef5350');
    }

    _applyPriceLineColor(series, color) {
        if (!series || !color) return;
        if (series.__lastLineColor === color) return;
        series.applyOptions({
            priceLineColor: color, priceLineSource: 'lastBar', lastValueVisible: true,
            lastValueLabelBackgroundColor: color,
            lastValueLabelTextColor: this._getTextColorForBackground(color),
            priceLineTitle: ''
        });
        series.__lastLineColor = color;
        this._lastAppliedColor = color;
    }

    _syncLineColor() {
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (!series) return;
        this._applyPriceLineColor(series, this._getLineColor());
        if (this.timerManager) this.timerManager.forceColorUpdate();
    }

    _getIntervalSeconds() { return INTERVAL_SECONDS_MAP[this.currentInterval] || 3600; }
    _getIntervalSecondsFor(interval) { return INTERVAL_SECONDS_MAP[interval] || 3600; }
    _getNextIntervalTime(timeSec) { return this._getNextIntervalTimeFor(timeSec, this.currentInterval); }

    _getNextIntervalTimeFor(timeSec, interval) {
        if (interval === '1M') {
            const aligned = this._alignTimeForInterval(timeSec, interval);
            const d = new Date(aligned * 1000);
            d.setUTCMonth(d.getUTCMonth() + 1);
            return Math.floor(d.getTime() / 1000);
        }
        if (interval === '1w') {
            const aligned = this._alignTimeForInterval(timeSec, interval);
            const d = new Date(aligned * 1000);
            d.setUTCDate(d.getUTCDate() + 7);
            return Math.floor(d.getTime() / 1000);
        }
        return timeSec + this._getIntervalSecondsFor(interval);
    }

    _alignTimeToInterval(nowSec) { return this._alignTimeForInterval(nowSec, this.currentInterval); }

    _alignTimeForInterval(nowSec, interval) {
        if (interval === '1w') {
            const now = new Date(nowSec * 1000);
            const dayOfWeek = now.getUTCDay();
            const daysSinceMonday = (dayOfWeek + 6) % 7;
            const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday, 0, 0, 0, 0));
            return Math.floor(monday.getTime() / 1000);
        } else if (interval === '1M') {
            const now = new Date(nowSec * 1000);
            const firstDayOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
            return Math.floor(firstDayOfMonth.getTime() / 1000);
        } else {
            const step = INTERVAL_SECONDS_MAP[interval] || 3600;
            return Math.floor(nowSec / step) * step;
        }
    }

    _startBackgroundTitleUpdate() {
        if (this._bgTitleInterval) { clearInterval(this._bgTitleInterval); this._bgTitleInterval = null; }
        this._bgTitleInterval = setInterval(() => {
            if (document.hidden && this.currentRealPrice != null) this._updatePageTitle();
            if (!document.hidden && this._bgTitleInterval) {
                clearInterval(this._bgTitleInterval);
                this._bgTitleInterval = null;
            }
        }, 1000);
    }

    _startPeriodicSync() {
        if (this._periodicSyncInterval) clearInterval(this._periodicSyncInterval);
        this._periodicSyncInterval = setInterval(() => {
            if (!document.hidden && !this._switchingSymbol && !this._updatesSuspended &&
                !this._isSwitchingInterval && this._isChartValid() &&
                !this._isScrolling && !this._isScrollingFast) {
                this._syncRecentCandles();
            }
        }, 30000);
    }

    _stopPeriodicSync() { if (this._periodicSyncInterval) { clearInterval(this._periodicSyncInterval); this._periodicSyncInterval = null; } }
    _stopCandleChecker() { if (this._candleCheckerTimeout) { clearTimeout(this._candleCheckerTimeout); this._candleCheckerTimeout = null; } }

    async _syncRecentCandles() {
        if (this._isScrolling || this._isScrollingFast) return;
        const genId = this._activeGeneration;
        const interval = this.currentInterval;
        try {
            const fresh = await this.fetchKlines(
                this.currentSymbol, this.currentExchange, this.currentMarketType,
                this.currentInterval, 3, null, 'background'
            );
            if (!fresh || fresh.length === 0) return;
            if (this._updatesSuspended || this._switchingSymbol || this._isSwitchingInterval) return;
            if (this._activeGeneration !== genId || this.currentInterval !== interval) return;
            const currentData = this.chartData;
            if (!currentData || currentData.length === 0) return;
            const freshMap = new Map(fresh.map(c => [c.time, c]));
            let changed = false, needsCatchUp = false, needsFullRedraw = false;
            const pushedMissing = [], touchedMidCandles = [];
            for (let i = currentData.length - 1; i >= Math.max(0, currentData.length - 3); i--) {
                const cur = currentData[i];
                const freshCandle = freshMap.get(cur.time);
                if (freshCandle) {
                    if (!this._isFresherUpdate(cur, freshCandle._receivedAt, freshCandle._source)) { freshMap.delete(cur.time); continue; }
                    if (cur._closed === true && freshCandle._closed !== true) { freshMap.delete(cur.time); continue; }
                    this._stampCandle(cur, freshCandle._source, freshCandle._receivedAt);
                    cur.open = freshCandle.open; cur.close = freshCandle.close;
                    cur.high = freshCandle.high; cur.low = freshCandle.low;
                    cur.volume = freshCandle.volume;
                    cur.quoteVolume = freshCandle.quoteVolume || cur.volume;
                    cur._isPlaceholder = false;
                    if (typeof freshCandle._closed === 'boolean') cur._closed = freshCandle._closed;
                    const safeTime = Number(cur.time);
                    if (isNaN(safeTime) || safeTime <= 0) continue;
                    if (i === currentData.length - 1) {
                        this._updateVisibleSeries({ time: safeTime, open: cur.open, high: cur.high, low: cur.low, close: cur.close });
                        this._safeVolumeBarUpdate(safeTime, cur.quoteVolume || cur.volume || 0,
                            cur.close >= cur.open ? this.bullishColor : this.bearishColor);
                    } else {
                        touchedMidCandles.push(cur);
                    }
                    changed = true;
                    freshMap.delete(cur.time);
                }
            }
            if (freshMap.size > 0) {
                const missing = Array.from(freshMap.values()).sort((a, b) => a.time - b.time);
                for (const candle of missing) {
                    candle.quoteVolume = candle.quoteVolume || candle.volume || 0;
                    const safeTime = Number(candle.time);
                    if (isNaN(safeTime) || safeTime <= 0) continue;
                    if (currentData.length > 0 && safeTime <= currentData[currentData.length - 1].time) {
                        const idx = this._candleTimeMap.get(safeTime);
                        const existing = (idx !== undefined) ? currentData[idx] : undefined;
                        if (existing && !(existing._closed === true && candle._closed !== true) &&
                            this._isFresherUpdate(existing, candle._receivedAt, candle._source)) {
                            existing.open = candle.open; existing.high = candle.high;
                            existing.low = candle.low; existing.close = candle.close;
                            existing.volume = candle.volume; existing.quoteVolume = candle.quoteVolume;
                            existing._isPlaceholder = false;
                            this._stampCandle(existing, candle._source, candle._receivedAt);
                            if (typeof candle._closed === 'boolean') existing._closed = candle._closed;
                            touchedMidCandles.push(existing);
                        }
                        needsFullRedraw = true;
                        continue;
                    }
                    if (currentData.length > 0) {
                        const lastTimeNow = currentData[currentData.length - 1].time;
                        const expectedNext = this._getNextIntervalTime(lastTimeNow);
                        if (safeTime !== expectedNext) { needsCatchUp = true; continue; }
                    }
                    candle._isPlaceholder = false;
                    currentData.push(candle);
                    this._addToTimeMap(safeTime, currentData.length - 1);
                    pushedMissing.push(candle);
                }
                if (needsFullRedraw) { currentData.sort((a, b) => a.time - b.time); this._rebuildTimeMap(); }
                this.lastCandle = currentData[currentData.length - 1];
                changed = true;
                if (needsCatchUp) this._catchUpMissedCandles().catch(() => {});
            }
            if (needsFullRedraw || touchedMidCandles.length > 0) {
                this._applyDataAtomically();
            } else if (pushedMissing.length > 0) {
                this._applyAppendOnly(pushedMissing);
            }
            if (pushedMissing.length > 0) this.autoScale();
            if (changed) {
                this._volumeDataDirty = true;
                this._syncLineColor();
                if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
                const lastClose = this.lastCandle?.close ?? currentData[currentData.length - 1]?.close;
                if (this.timerManager && lastClose != null) this.timerManager.updatePrice(lastClose);
            }
            this._healDataGaps().catch(() => {});
        } catch (e) { console.warn('⚠️ Ошибка синхронизации:', e); }
    }

    async refreshCandlesAfterTabHidden() {
        if (!this._isChartValid() || this._switchingSymbol || this._isSwitchingInterval) return;
        if (this._isScrolling || this._isScrollingFast) return;
        if (this._refreshingAfterHidden) return;
        this._refreshingAfterHidden = true;
        if (!this._quarantineTimeout) this._preHiddenSuspendedState = this._updatesSuspended;
        this._updatesSuspended = true;
        const genId = this._activeGeneration;
        const interval = this.currentInterval;
        try {
            const symbol = this.currentSymbol, exchange = this.currentExchange, marketType = this.currentMarketType;
            const freshCandles = await this.fetchKlines(symbol, exchange, marketType, interval, 500, null, 'background');
            if (!this._isChartValid() || this._activeGeneration !== genId || this._switchingSymbol || this._isSwitchingInterval) return;
            if (this.currentInterval !== interval) return;
            if (!freshCandles || freshCandles.length === 0) { this._forceRedrawAll(); return; }
            const currentData = this.chartData;
            if (!currentData || currentData.length === 0) {
                if (!this._isChartValid()) return;
                this.setDataQuick(freshCandles, interval, symbol, exchange, marketType, true);
                return;
            }
            const currentMap = new Map();
            for (const candle of currentData) currentMap.set(candle.time, candle);
            const oldLastCandle = currentData[currentData.length - 1];
            const oldLastTime = oldLastCandle.time;
            let hasStructuralChange = false, lastCandleFresh = null;
            const newCandles = [];
            for (const freshCandle of freshCandles) {
                const existing = currentMap.get(freshCandle.time);
                if (existing) {
                    if (!this._isFresherUpdate(existing, freshCandle._receivedAt, freshCandle._source)) continue;
                    if (existing._closed === true && freshCandle._closed !== true) continue;
                    const differs = (existing.open !== freshCandle.open || existing.high !== freshCandle.high ||
                        existing.low !== freshCandle.low || existing.close !== freshCandle.close ||
                        existing.volume !== freshCandle.volume || existing.quoteVolume !== freshCandle.quoteVolume);
                    if (differs) {
                        if (freshCandle.time === oldLastTime) lastCandleFresh = freshCandle;
                        else hasStructuralChange = true;
                    }
                } else if (freshCandle.time > oldLastTime) {
                    newCandles.push(freshCandle);
                } else { hasStructuralChange = true; }
            }
            newCandles.sort((a, b) => a.time - b.time);
            let dataChanged = false, appendOnly = false;
            const pushed = [];
            if (!hasStructuralChange) {
                if (lastCandleFresh) {
                    let fresh = lastCandleFresh;
                    if (!this._isValidCandle(fresh)) {
                        const sanitized = this._sanitizeCandle(fresh);
                        if (sanitized) fresh = sanitized;
                    }
                    if (!(oldLastCandle._closed === true && fresh._closed !== true)) {
                        oldLastCandle.open = fresh.open; oldLastCandle.high = fresh.high;
                        oldLastCandle.low = fresh.low; oldLastCandle.close = fresh.close;
                        oldLastCandle.volume = fresh.volume;
                        oldLastCandle.quoteVolume = fresh.quoteVolume || fresh.volume;
                        this._stampCandle(oldLastCandle, fresh._source, fresh._receivedAt);
                        oldLastCandle._isPlaceholder = false;
                        if (typeof fresh._closed === 'boolean') oldLastCandle._closed = fresh._closed;
                        this._updateVisibleSeries({ time: oldLastCandle.time, open: oldLastCandle.open,
                            high: oldLastCandle.high, low: oldLastCandle.low, close: oldLastCandle.close });
                        this._safeVolumeBarUpdate(oldLastCandle.time,
                            oldLastCandle.quoteVolume || oldLastCandle.volume || 0,
                            oldLastCandle.close >= oldLastCandle.open ? this.bullishColor : this.bearishColor);
                        dataChanged = true;
                    }
                }
                let cursorTime = oldLastTime, tailGapDetected = false;
                for (const nc of newCandles) {
                    let candle = nc;
                    if (!this._isValidCandle(candle)) {
                        const sanitized = this._sanitizeCandle(candle);
                        if (!sanitized) continue;
                        candle = sanitized;
                    }
                    const expectedNext = cursorTime ? this._getNextIntervalTime(cursorTime) : candle.time;
                    if (cursorTime && candle.time !== expectedNext) { tailGapDetected = true; break; }
                    candle.quoteVolume = candle.quoteVolume || candle.volume || 0;
                    candle._isPlaceholder = false;
                    currentData.push(candle);
                    this._addToTimeMap(candle.time, currentData.length - 1);
                    pushed.push(candle);
                    cursorTime = candle.time;
                    dataChanged = true;
                }
                if (tailGapDetected) this._catchUpMissedCandles().catch(() => {});
                if (dataChanged) {
                    this.lastCandle = currentData[currentData.length - 1];
                    if (lastCandleFresh && pushed.length === 0) { /* done */ }
                    else if (pushed.length > 0) appendOnly = true;
                    else this._applyDataAtomically();
                }
            } else {
                const updatedData = [];
                for (const freshCandle of freshCandles) {
                    const existing = currentMap.get(freshCandle.time);
                    if (existing) {
                        if (!this._isFresherUpdate(existing, freshCandle._receivedAt, freshCandle._source)) { updatedData.push(existing); continue; }
                        if (existing._closed === true && freshCandle._closed !== true) { updatedData.push(existing); continue; }
                        if (existing.open !== freshCandle.open || existing.high !== freshCandle.high ||
                            existing.low !== freshCandle.low || existing.close !== freshCandle.close ||
                            existing.volume !== freshCandle.volume || existing.quoteVolume !== freshCandle.quoteVolume) {
                            freshCandle._isPlaceholder = false;
                            updatedData.push(freshCandle);
                            dataChanged = true;
                        } else updatedData.push(existing);
                    } else {
                        freshCandle._isPlaceholder = false;
                        updatedData.push(freshCandle);
                        dataChanged = true;
                    }
                }
                const freshTimes = new Set(freshCandles.map(c => c.time));
                for (const candle of currentData) if (!freshTimes.has(candle.time)) updatedData.push(candle);
                updatedData.sort((a, b) => a.time - b.time);
                if (dataChanged && this._isChartValid()) {
                    this.chartData = updatedData;
                    this._rebuildTimeMap();
                    this.lastCandle = this.chartData[this.chartData.length - 1];
                    this._applyDataAtomically();
                }
            }
            if (appendOnly && pushed.length > 0) this._applyAppendOnly(pushed);
            if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
            const lastCandle = this.lastCandle;
            if (lastCandle && this._isChartValid()) {
                const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
                if (series) { this._applyPriceLineColor(series, this._getLineColor()); this.currentRealPrice = lastCandle.close; }
            }
            if (this.timerManager && this.lastCandle) {
                this.timerManager.start(this.currentInterval);
                this.timerManager.updatePrice(this.lastCandle.close);
            }
        } catch (error) { console.error('❌ Ошибка синхронизации после возврата:', error); if (this._isChartValid()) this._forceRedrawAll(); }
        finally {
            if (this._quarantineTimeout) clearTimeout(this._quarantineTimeout);
            const restoreState = this._preHiddenSuspendedState;
            this._quarantineTimeout = setTimeout(() => {
                this._updatesSuspended = restoreState;
                this._quarantineTimeout = null;
                this._refreshingAfterHidden = false;
                if (!restoreState && !document.hidden && this._isChartValid()) {
                    this._syncRecentCandles().catch(() => {}).finally(() => {
                        this._lastGapHealAttempt = 0;
                        this._healDataGaps().catch(() => {});
                    });
                }
            }, 1000);
        }
    }

    _forceRedrawAll() {
        if (!this._isChartValid()) return;
        if (this.volumeSeries && this.chartData.length > 0) {
            this._volumeDataCache = null;
            this._volumeDataDirty = false;
            const vd = this._buildVolumeData(this.chartData);
            this.volumeSeries.setData(vd);
            this._applyVolumeScaleOptions();
        }
        this._syncLineColor();
        if (this.timerManager) {
            this.timerManager.start(this.currentInterval);
            if (this.lastCandle?.close != null) this.timerManager.updatePrice(this.lastCandle.close);
        }
        this.forceRedraw();
    }

    _startNewCandleChecker() {
        if (this._candleCheckerTimeout) { clearTimeout(this._candleCheckerTimeout); this._candleCheckerTimeout = null; }
        const check = () => {
            if (this._destroyed) return;
            if (document.hidden) { this._candleCheckerTimeout = setTimeout(check, 2000); return; }
            if (!this._isChartValid() || !this.chartData?.length || !this.currentInterval ||
                this._updatesSuspended || this._isSwitchingInterval) {
                this._candleCheckerTimeout = setTimeout(check, 1000);
                return;
            }
            const nowSec = Math.floor(Date.now() / 1000);
            const aligned = this._alignTimeToInterval(nowSec);
            const last = this.chartData[this.chartData.length - 1];
            if (last && aligned > last.time) {
                const timeSinceNewCandle = nowSec - aligned;
                if (timeSinceNewCandle > 1) {
                    const nowMs = Date.now();
                    if (!this._lastCatchUpAttempt || nowMs - this._lastCatchUpAttempt > 1500) {
                        this._lastCatchUpAttempt = nowMs;
                        if (window.wsManager?.ensureConnected) window.wsManager.ensureConnected();
                        this._catchUpMissedCandles().catch(() => {});
                    }
                }
            }
            this._candleCheckerTimeout = setTimeout(check, 250);
        };
        check();
    }

    async _catchUpMissedCandles() {
        if (!this._isChartValid() || !this.currentSymbol || !this.currentInterval) return;
        if (this._catchingUpMissed || this._isSwitchingInterval || this._switchingSymbol) return;
        this._catchingUpMissed = true;
        const genId = this._activeGeneration;
        const interval = this.currentInterval;
        try {
            const lastLocalBefore = this.chartData.length > 0 ? this.chartData[this.chartData.length - 1] : null;
            const nowSec = Math.floor(Date.now() / 1000);
            const alignedNow = this._alignTimeForInterval(nowSec, interval);
            let limit = 10;
            if (lastLocalBefore) {
                const est = Math.ceil((alignedNow - lastLocalBefore.time) / this._getIntervalSecondsFor(interval)) + 3;
                limit = Math.min(1000, Math.max(10, est));
            }
            const freshCandles = await this.fetchKlines(
                this.currentSymbol, this.currentExchange, this.currentMarketType,
                this.currentInterval, limit, null, 'background'
            );
            if (!freshCandles || freshCandles.length === 0 || !this._isChartValid()) return;
            if (this._activeGeneration !== genId || this.currentInterval !== interval) return;
            const lastLocalTime = this.chartData.length > 0 ? this.chartData[this.chartData.length - 1].time : 0;
            const candidates = freshCandles.filter(c => c.time > lastLocalTime && this._isValidCandle(c));
            if (candidates.length > 0) {
                const expectedFirst = lastLocalTime ? this._getNextIntervalTimeFor(lastLocalTime, interval) : candidates[0].time;
                let toPush = [], holeDetected = false;
                if (lastLocalTime === 0 || candidates[0].time === expectedFirst) {
                    let cursor = lastLocalTime;
                    for (const c of candidates) {
                        const exp = cursor ? this._getNextIntervalTimeFor(cursor, interval) : c.time;
                        if (c.time !== exp) { holeDetected = true; break; }
                        toPush.push(c);
                        cursor = c.time;
                    }
                } else { holeDetected = true; toPush = candidates; }
                if (toPush.length > 0) {
                    const lastLocal = this.chartData.length > 0 ? this.chartData[this.chartData.length - 1] : null;
                    if (lastLocal && lastLocal._closed !== true) lastLocal._closed = true;
                    for (const candle of toPush) {
                        candle._isPlaceholder = false;
                        this.chartData.push(candle);
                        this._addToTimeMap(candle.time, this.chartData.length - 1);
                    }
                    this._rebuildTimeMap();
                    this.lastCandle = this.chartData[this.chartData.length - 1];
                    if (!holeDetected) this._applyAppendOnly(toPush);
                    else this._applyDataAtomically();
                    this._syncLineColor();
                    if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
                }
                if (holeDetected) { this._lastGapHealAttempt = 0; this._healDataGaps().catch(() => {}); }
            } else {
                const lastFresh = freshCandles[freshCandles.length - 1];
                const lastLocal = this.chartData[this.chartData.length - 1];
                if (lastFresh && lastLocal && lastFresh.time === lastLocal.time) {
                    if (typeof this.updateLastCandle === 'function') this.updateLastCandle(lastFresh);
                }
            }
        } catch (error) { console.error('❌ Ошибка догрузки свечей:', error); }
        finally { this._catchingUpMissed = false; }
    }

    async _healDataGaps() {
        if (this._destroyed) return;
        if (!this._isChartValid() || !this.currentSymbol || !this.currentInterval) return;
        if (this._healingGaps || this._isTrimming || this.isLoadingMore) return;
        if (this._switchingSymbol || this._isSwitchingInterval || this._updatesSuspended) return;
        if (this._isScrolling || this._isScrollingFast) return;
        const now = Date.now();
        if (this._lastGapHealAttempt && now - this._lastGapHealAttempt < 30000) return;
        this._lastGapHealAttempt = now;
        const data = this.chartData;
        if (!data || data.length < 2) return;
        this._healingGaps = true;
        const genId = this._activeGeneration;
        const interval = this.currentInterval;
        try {
            let gapIndex = -1, gapFromTime = 0, gapToTime = 0;
            for (let i = 1; i < data.length; i++) {
                const expected = this._getNextIntervalTimeFor(data[i - 1].time, interval);
                if (data[i].time > expected) {
                    if (this._unhealableGaps.has(data[i - 1].time + ':' + data[i].time)) continue;
                    gapIndex = i; gapFromTime = data[i - 1].time; gapToTime = data[i].time;
                    break;
                }
            }
            if (gapIndex === -1) return;
            const gapKey = gapFromTime + ':' + gapToTime;
            const estCount = Math.ceil((gapToTime - gapFromTime) / this._getIntervalSecondsFor(interval));
            const limit = Math.min(1000, Math.max(10, estCount + 5));
            const fetched = await this.fetchKlines(
                this.currentSymbol, this.currentExchange, this.currentMarketType,
                interval, limit, (gapToTime * 1000) - 1, 'heal'
            );
            if (!fetched || fetched.length === 0) return;
            if (this._activeGeneration !== genId || this.currentInterval !== interval) return;
            if (!this._isChartValid()) return;
            if (this.chartData !== data) return;
            const missing = fetched.filter(c =>
                c.time > gapFromTime && c.time < gapToTime &&
                !this._candleTimeMap.has(c.time) && this._isValidCandle(c)
            );
            if (missing.length === 0) {
                if (this._unhealableGaps.size > 50) this._unhealableGaps.clear();
                this._unhealableGaps.add(gapKey);
                return;
            }
            missing.sort((a, b) => a.time - b.time);
            for (const c of missing) c._isPlaceholder = false;
            this.chartData.splice(gapIndex, 0, ...missing);
            this._rebuildTimeMap();
            this._applyDataAtomically();
            if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
            setTimeout(() => {
                if (this._destroyed) return;
                this._lastGapHealAttempt = 0;
                this._healDataGaps().catch(() => {});
            }, 500);
        } catch (e) { console.warn('⚠️ Ошибка заполнения дыр:', e); }
        finally { this._healingGaps = false; }
    }

    _setupPanelsSync() {}

    setupOptimizedSubscriptions() {
        if (!this.chart || !this.chart.timeScale()) return;
        this._panelsSyncActive = true;
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
            this._checkHistoryPreloadLive(range);
            clearTimeout(this._scrollStopTimeout);
            this._scrollStopTimeout = setTimeout(() => {
                this._isScrolling = false;
                this._isScrollingFast = false;
                try {
                    const barSpacing = this.chart?.timeScale()?.options()?.barSpacing;
                    if (barSpacing) this._pendingBarSpacing = barSpacing;
                } catch (e) {}
                if (this._pendingBarSpacing && this._pendingBarSpacing !== this._lastSavedBarSpacing) {
                    this._lastSavedBarSpacing = this._pendingBarSpacing;
                    this._savedBarSpacing = this._pendingBarSpacing;
                    localStorage.setItem('chartBarSpacing', this._pendingBarSpacing);
                }
                this._applyPendingTrim();
                this.onVisibleLogicalRangeChange(this._lastVisibleRange);
            }, 150);
            if (range && this.indicatorManager?.panelManager && !this._isSyncing) {
                const panels = this._getPanelsList();
                if (panels.length > 0 && !this._panelsSyncRafId) {
                    this._panelsSyncRafId = requestAnimationFrame(() => {
                        this._panelsSyncRafId = null;
                        if (this._switchingSymbol || this._isSwitchingInterval) return;
                        this._isSyncing = true;
                        const r = this._lastVisibleRange || range;
                        const pm = this.indicatorManager?.panelManager;
                        const prevLock = pm ? pm._rangeSyncLock : false;
                        if (pm) pm._rangeSyncLock = true;
                        try {
                            const panelsNow = this._getPanelsList();
                            for (let i = 0; i < panelsNow.length; i++) {
                                const panel = panelsNow[i];
                                if (panel.chart && !panel.isCollapsed) {
                                    try { panel.chart.timeScale().setVisibleLogicalRange(r); } catch (e) {}
                                }
                            }
                        } finally {
                            if (pm) pm._rangeSyncLock = prevLock;
                            this._isSyncing = false;
                        }
                    });
                }
            }
        });
        this._wheelHandler = (e) => {
            if (e.ctrlKey || e.metaKey) {
                this._isVerticalZooming = true;
                clearTimeout(this._verticalZoomTimeout);
                this._verticalZoomTimeout = setTimeout(() => { this._isVerticalZooming = false; }, 150);
            }
        };
        this.chartContainer.addEventListener('wheel', this._wheelHandler, { passive: true });
    }

    setupEventListeners() {
        let resizeTimeout;
        this._resizeHandler = () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (this._isChartValid()) {
                    const newWidth = this.chartContainer.clientWidth;
                    const newHeight = this.chartContainer.clientHeight;
                    if (newWidth === this._lastWidth && newHeight === this._lastHeight) return;
                    this._lastWidth = newWidth;
                    this._lastHeight = newHeight;
                    this._updateMainChartHeight();
                    if (this._resizeIndicatorPanels) this._resizeIndicatorPanels();
                    if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
                }
            }, 100);
        };
        window.addEventListener('resize', this._resizeHandler);
        this._mouseLeaveHandler = () => {
            if (this.overlay) this.overlay.classList.remove('visible');
            this._latestCrosshairData = null;
            this._pendingCrosshairParam = null;
            if (this._crosshairRafId) { cancelAnimationFrame(this._crosshairRafId); this._crosshairRafId = null; }
            if (this.chart) { try { this.chart.clearCrosshairPosition(); } catch (e) {} }
            this._fixStuckAxisDrag();
        };
        this.chartContainer.addEventListener('mouseleave', this._mouseLeaveHandler);
        this._globalMouseUpHandler = (e) => {
            this.unlockChartScrollForDrawing();
            if (!this.chartContainer) return;
            const canvas = this.chartContainer.querySelector('canvas');
            if (!canvas) return;
            if (e.target === canvas) return;
            const rect = this.chartContainer.getBoundingClientRect();
            const isOverChart = (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom);
            if (isOverChart) this._fixStuckAxisDrag();
        };
        window.addEventListener('mouseup', this._globalMouseUpHandler, true);
        this._blurHandler = () => {
            this.unlockChartScrollForDrawing();
            this._fixStuckAxisDrag();
            if (window.trendLineManager?.cancelDrag) window.trendLineManager.cancelDrag();
            if (window.rayManager?.cancelDrag) window.rayManager.cancelDrag();
            if (window.rulerLineManager?.cancelDrag) window.rulerLineManager.cancelDrag();
            if (window.alertLineManager?.cancelDrag) window.alertLineManager.cancelDrag();
            if (window.textManager?.cancelDrag) window.textManager.cancelDrag();
            if (this.chart) { try { this.chart.clearCrosshairPosition(); } catch (e) {} }
        };
        window.addEventListener('blur', this._blurHandler);
    }

    _fixStuckAxisDrag() {
        if (!this._isChartValid()) return;
        try {
            const canvas = this.chartContainer.querySelector('canvas');
            if (canvas) canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        } catch (e) {}
    }

    setChartType(type) {
        if (!this._isChartValid()) return;
        this._isSwitchingChartType = true;
        if (this._chartTypeSwitchTimeout) { clearTimeout(this._chartTypeSwitchTimeout); this._chartTypeSwitchTimeout = null; }
        const previousType = this.currentChartType;
        this.currentChartType = type;
        localStorage.setItem('chartType', type);
        const switched = previousType !== type;
        if (type === 'candle') {
            if (switched && this.candleSeries && this.chartData.length) {
                try { this.candleSeries.setData(this._assertAscendingBars(this._toLwBarsArray(this.chartData), 'свечи/setChartType')); } catch (e) {}
            }
            if (this.candleSeries) this.candleSeries.applyOptions({ visible: true });
            if (this.barSeries) this.barSeries.applyOptions({ visible: false });
            if (switched && this.barSeries) { try { this.barSeries.setData([]); } catch (e) {} }
        } else if (type === 'bar') {
            if (switched && this.barSeries && this.chartData.length) {
                try { this.barSeries.setData(this._assertAscendingBars(this._toLwBarsArray(this.chartData), 'бары/setChartType')); } catch (e) {}
            }
            if (this.barSeries) this.barSeries.applyOptions({ visible: true });
            if (this.candleSeries) this.candleSeries.applyOptions({ visible: false });
            if (switched && this.candleSeries) { try { this.candleSeries.setData([]); } catch (e) {} }
        }
        this._invisibleSeriesDirty = true;
        if (this.volumeSeries) this._applyVolumeScaleOptions();
        if (this.barSeries) {
            this.barSeries.applyOptions({
                upColor: this.bullishColor || CONFIG?.colors?.bullish || '#26a69a',
                downColor: this.bearishColor || CONFIG?.colors?.bearish || '#ef5350'
            });
        }
        if (this.indicatorManager?.activeIndicators) {
            this.indicatorManager.activeIndicators.forEach(ind => { try { ind.createSeries(); } catch (e) {} });
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
            activeSeries.applyOptions({ priceLineVisible: true, priceLineWidth: 1, priceLineStyle: LightweightCharts.LineStyle.Dashed });
            this._applyPriceLineColor(activeSeries, this._getLineColor());
        }
        if (this.timerManager) {
            const price = this.currentRealPrice ?? this.lastCandle?.close;
            if (price != null) this.timerManager.updatePrice(price);
            this.timerManager.reattach();
        }
        if (window._dailySeparator && typeof window._dailySeparator.reattach === 'function') window._dailySeparator.reattach();
        if (window._sessionHighlighter && typeof window._sessionHighlighter.reattach === 'function') window._sessionHighlighter.reattach();
        this._chartTypeSwitchTimeout = setTimeout(() => {
            this._isSwitchingChartType = false;
            this._chartTypeSwitchTimeout = null;
        }, 300);
    }

    _updateIndicatorsThrottled() {
        if (!this.indicatorManager || this._destroyed) return;
        const minInterval = 500;
        const now = Date.now();
        if (now - this._lastIndicatorsUpdateAt >= minInterval) {
            this._lastIndicatorsUpdateAt = now;
            if (this._indicatorsUpdateTimeout) { clearTimeout(this._indicatorsUpdateTimeout); this._indicatorsUpdateTimeout = null; }
            this.indicatorManager.updateAllIndicators();
            return;
        }
        if (this._indicatorsUpdateTimeout === null) {
            this._indicatorsUpdateTimeout = setTimeout(() => {
                this._indicatorsUpdateTimeout = null;
                this._lastIndicatorsUpdateAt = Date.now();
                if (this.indicatorManager && !this._destroyed) this.indicatorManager.updateAllIndicators();
            }, minInterval - (now - this._lastIndicatorsUpdateAt));
        }
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
        if (this.timerManager?._primitive?.isEnabled()) this.timerManager._primitive.requestRedraw();
    }

    _getCachedPrecision(symbol, exchange, marketType) {
        const key = `precision_${symbol}_${exchange}_${marketType}`;
        if (this._cachedPrecisionKey === key) return this._cachedPrecisionValue;
        const value = localStorage.getItem(key);
        this._cachedPrecisionKey = key;
        this._cachedPrecisionValue = value;
        return value;
    }

    _setCachedPrecision(symbol, exchange, marketType, precision) {
        const key = `precision_${symbol}_${exchange}_${marketType}`;
        const value = String(precision);
        localStorage.setItem(key, value);
        this._cachedPrecisionKey = key;
        this._cachedPrecisionValue = value;
    }

    _prefetchPrecision(symbol, exchange, marketType) {
        if (this._getCachedPrecision(symbol, exchange, marketType)) return Promise.resolve();
        if (typeof getPrecisionFromExchange !== 'function') return Promise.resolve();
        let timer;
        const timeout = new Promise(r => { timer = setTimeout(r, 1500); });
        const request = Promise.resolve(getPrecisionFromExchange(symbol, exchange, marketType))
            .then(p => { this._applyResolvedPrecision(symbol, exchange, marketType, p); })
            .catch(() => {});
        return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
    }

    _applyResolvedPrecision(symbol, exchange, marketType, precision) {
        if (precision === null || precision === undefined || precision === '') return false;
        const n = Number(precision);
        if (!isFinite(n) || isNaN(n) || n < 0 || n > 8) return false;
        try { this._setCachedPrecision(symbol, exchange, marketType, Math.floor(n)); } catch (e) { return false; }
        return true;
    }

    _performUpdate() {
        if (!this.chartData.length || this._updatesSuspended || !this._isChartValid()) return;
        const cachedPrecision = this._getCachedPrecision(this.currentSymbol, this.currentExchange, this.currentMarketType);
        let precisionToApply, precisionStr;
        if (cachedPrecision) { precisionToApply = parseInt(cachedPrecision, 10); precisionStr = cachedPrecision; }
        else {
            precisionToApply = this._inferPrecisionFromData();
            precisionStr = String(precisionToApply);
            if (this._lastInferredPrecision !== precisionStr) this._lastInferredPrecision = precisionStr;
        }
        if (this._lastAppliedPrecision !== precisionStr) {
            this.applyPriceFormat(precisionToApply);
            this._lastAppliedPrecision = precisionStr;
            if (!cachedPrecision) this._setCachedPrecision(this.currentSymbol, this.currentExchange, this.currentMarketType, precisionToApply);
        }
        if (this.indicatorManager) this._updateIndicatorsThrottled();
        const lastCandle = this.chartData[this.chartData.length - 1];
        const price = this.getCurrentPrice();
        if (price !== null) this._syncPriceLine(price);
        else {
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            if (series) this._applyPriceLineColor(series, this._getLineColor());
        }
        if (this.timerManager) {
            this.timerManager.start(this.currentInterval);
            if (price !== null) this.timerManager.updatePrice(price);
            else if (lastCandle) this.timerManager.updatePrice(lastCandle.close);
        }
        this.scheduleUpdatePosition();
    }

    _syncPriceLine(priceOrObj) {
        let price = priceOrObj, tickTime = null;
        if (priceOrObj && typeof priceOrObj === 'object') {
            if (typeof priceOrObj.price === 'number') { price = priceOrObj.price; tickTime = priceOrObj.time || null; }
            else if (typeof priceOrObj.close === 'number') { price = priceOrObj.close; tickTime = priceOrObj.time || null; }
            else if (typeof priceOrObj.last === 'number') { price = priceOrObj.last; tickTime = priceOrObj.time || null; }
            else return;
        }
        if (typeof price !== 'number' || isNaN(price) || price <= 0) return;
        if (this._updatesSuspended || !this._isChartValid() || this._isRestoringZoom || this._isSwitchingInterval) return;
        this._pendingPriceUpdate = { price, time: tickTime };
        const now = Date.now();
        const elapsed = now - this._lastPriceGateAt;
        if (elapsed < this._priceGateMinMs) {
            if (this._priceGateTimeout === null) {
                this._priceGateTimeout = setTimeout(() => {
                    this._priceGateTimeout = null;
                    this._flushPendingPrice();
                }, this._priceGateMinMs - elapsed);
            }
            return;
        }
        this._lastPriceGateAt = now;
        if (this._priceUpdateRafId !== null) return;
        this._priceUpdateRafId = requestAnimationFrame(() => {
            this._priceUpdateRafId = null;
            const update = this._pendingPriceUpdate;
            this._pendingPriceUpdate = null;
            if (update && update.price !== undefined) this._applyPriceUpdate(update.price, update.time);
        });
    }

    _flushPendingPrice() {
        if (this._destroyed) return;
        if (this._updatesSuspended || !this._isChartValid() || this._isRestoringZoom || this._isSwitchingInterval) {
            this._pendingPriceUpdate = null;
            return;
        }
        if (!this._pendingPriceUpdate || this._pendingPriceUpdate.price === undefined) return;
        this._lastPriceGateAt = Date.now();
        if (this._priceUpdateRafId !== null) return;
        this._priceUpdateRafId = requestAnimationFrame(() => {
            this._priceUpdateRafId = null;
            const update = this._pendingPriceUpdate;
            this._pendingPriceUpdate = null;
            if (update && update.price !== undefined) this._applyPriceUpdate(update.price, update.time);
        });
    }

    _applyPriceUpdate(price, tickTime = null) {
        if (this._updatesSuspended || !this._isChartValid() || this._isRestoringZoom || this._isSwitchingInterval) return;
        const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (!activeSeries || !this.chartData || this.chartData.length === 0) return;
        const lastCandle = this.chartData[this.chartData.length - 1];
        if (!lastCandle || typeof lastCandle.time !== 'number') return;
        const intervalSec = this._getIntervalSeconds();
        let nowSec = Math.floor(Date.now() / 1000);
        if (tickTime !== null && tickTime !== undefined) {
            let t = Number(tickTime);
            if (!isNaN(t) && t > 0) {
                if (t > 1e11) t = Math.floor(t / 1000); else t = Math.floor(t);
                if (t >= lastCandle.time - intervalSec * 2 && t <= nowSec + intervalSec * 2) nowSec = t;
            }
        }
        const currentCandleStart = this._alignTimeToInterval(nowSec);
        if (lastCandle.time === currentCandleStart) {
            if (lastCandle._closed === true) return;
            if (lastCandle._isPlaceholder && lastCandle.volume === 0 && lastCandle._source !== 'ws') {
                lastCandle.open = price; lastCandle.high = price; lastCandle.low = price; lastCandle.close = price;
            } else {
                lastCandle.close = price;
                lastCandle.high = Math.max(lastCandle.high, price);
                lastCandle.low = Math.min(lastCandle.low, price);
            }
            this._stampCandle(lastCandle, 'ws', Date.now(), lastCandle._eventTime ?? null);
            this.currentRealPrice = price;
            this.lastCandle = lastCandle;
            this._updateVisibleSeries({ time: lastCandle.time, open: lastCandle.open, high: lastCandle.high, low: lastCandle.low, close: lastCandle.close });
            this._safeVolumeBarUpdate(lastCandle.time, lastCandle.quoteVolume || lastCandle.volume || 0,
                lastCandle.close >= lastCandle.open ? this.bullishColor : this.bearishColor);
            this._volumeDataDirty = true;
            this._lastVolumeUpdateIndex = this.chartData.length - 1;
            this._applyPriceLineColor(activeSeries, this._getLineColor());
            this._scheduleTitleUpdate();
            if (!document.hidden) this.scheduleUpdatePosition();
            if (this.timerManager) this.timerManager.updatePrice(price);
            return;
        }
        if (currentCandleStart > lastCandle.time) {
            const expectedNextTime = this._getNextIntervalTime(lastCandle.time);
            if (currentCandleStart > expectedNextTime) {
                if (!this._catchingUpMissed) setTimeout(() => { this._catchUpMissedCandles().catch(() => {}); }, 0);
                return;
            }
            if (lastCandle._closed !== true) lastCandle._closed = true;
            const newCandle = {
                time: currentCandleStart, open: price, high: price, low: price, close: price,
                volume: 0, quoteVolume: 0, _isPlaceholder: true, _closed: false
            };
            this._stampCandle(newCandle, 'ws', Date.now());
            this.chartData.push(newCandle);
            this._addToTimeMap(newCandle.time, this.chartData.length - 1);
            this.lastCandle = newCandle;
            this._volumeDataDirty = true;
            this._lastVolumeUpdateIndex = this.chartData.length - 1;
            this._updateVisibleSeries({ time: newCandle.time, open: newCandle.open, high: newCandle.high, low: newCandle.low, close: newCandle.close });
            this._safeVolumeBarUpdate(newCandle.time, 0, this.bullishColor || '#26a69a');
            this._applyPriceLineColor(activeSeries, this._getLineColor());
            this.currentRealPrice = price;
            this._scheduleTitleUpdate();
            if (this.timerManager) this.timerManager.updatePrice(price);
            return;
        }
        this.currentRealPrice = price;
        this._applyPriceLineColor(activeSeries, this._getLineColor());
        this._scheduleTitleUpdate();
        if (this.timerManager) this.timerManager.updatePrice(price);
    }

    updateLastCandle(candle, eventTime = null, meta = null) {
        if (this._switchingSymbol || this._isSwitchingInterval || this._updatesSuspended || !this._isChartValid()) return;
        if (meta && ((meta.symbol && meta.symbol.toUpperCase() !== (this.currentSymbol || '').toUpperCase()) ||
                     (meta.interval && meta.interval !== this.currentInterval))) return;
        if (!candle || typeof candle.time !== 'number' || isNaN(candle.time) || candle.time <= 0) return;
        const intervalSeconds = this._getIntervalSeconds();
        const expectedTime = this._alignTimeToInterval(candle.time);
        if (candle.time !== expectedTime) candle.time = expectedTime;
        const nowSec = Math.floor(Date.now() / 1000);
        const maxAllowedTime = this._alignTimeToInterval(nowSec) + intervalSeconds * 2;
        if (candle.time > maxAllowedTime) return;
        const hasEventTime = (eventTime !== null && eventTime !== undefined && !isNaN(eventTime));
        if (hasEventTime) {
            if (this._lastKlineEventTime && eventTime < this._lastKlineEventTime) return;
            if (eventTime > this._lastKlineEventTime) this._lastKlineEventTime = eventTime;
        }
        const receivedAt = Date.now();
        const isFresherWs = (existing) => {
            if (!existing) return true;
            if (hasEventTime && existing._source === 'ws' && existing._eventTime !== null && existing._eventTime !== undefined) {
                return eventTime >= existing._eventTime;
            }
            return this._isFresherUpdate(existing, receivedAt, 'ws');
        };
        try {
            if (!this._isValidCandle(candle)) {
                const sanitized = this._sanitizeCandle(candle);
                if (!sanitized) return;
                candle = sanitized;
            }
            if (!candle.quoteVolume && candle.volume) candle.quoteVolume = candle.volume;
            if (!this.chartData || this.chartData.length === 0) return;
            const currentCandleStart = this._alignTimeToInterval(nowSec);
            const inferredClosed = candle.time < currentCandleStart;
            const willBeClosed = candle.isClosed === true || inferredClosed;
            const currentLastCandle = this.chartData[this.chartData.length - 1];
            const isLastCandle = currentLastCandle && candle.time === currentLastCandle.time;
            const isNewCandle = !currentLastCandle || candle.time > currentLastCandle.time;
            const existingIndex = this._candleTimeMap.get(candle.time);
            const updateData = { time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close };
            if (isLastCandle) {
                if (currentLastCandle._closed === true && !willBeClosed) return;
                if (!isFresherWs(currentLastCandle)) return;
                currentLastCandle.open = candle.open; currentLastCandle.close = candle.close;
                currentLastCandle.high = candle.high; currentLastCandle.low = candle.low;
                currentLastCandle.volume = candle.volume;
                currentLastCandle.quoteVolume = candle.quoteVolume;
                if (!currentLastCandle.quoteVolume && currentLastCandle.volume) currentLastCandle.quoteVolume = currentLastCandle.volume;
                currentLastCandle._isPlaceholder = false;
                currentLastCandle._closed = willBeClosed;
                this._stampCandle(currentLastCandle, 'ws', receivedAt, eventTime);
                this.lastCandle = currentLastCandle;
                this._updateVisibleSeries(updateData);
                this._safeVolumeBarUpdate(currentLastCandle.time,
                    currentLastCandle.quoteVolume || currentLastCandle.volume || 0,
                    currentLastCandle.close >= currentLastCandle.open ? this.bullishColor : this.bearishColor);
            } else if (existingIndex !== undefined && existingIndex >= 0) {
                const existingCandle = this.chartData[existingIndex];
                if (existingCandle._closed === true && !willBeClosed) return;
                if (!isFresherWs(existingCandle)) return;
                existingCandle.open = candle.open; existingCandle.close = candle.close;
                existingCandle.high = candle.high; existingCandle.low = candle.low;
                existingCandle.volume = candle.volume; existingCandle.quoteVolume = candle.quoteVolume;
                if (!existingCandle.quoteVolume && existingCandle.volume) existingCandle.quoteVolume = existingCandle.volume;
                existingCandle._isPlaceholder = false;
                existingCandle._closed = willBeClosed;
                this._stampCandle(existingCandle, 'ws', receivedAt, eventTime);
                this._updateVisibleSeries({ time: existingCandle.time, open: existingCandle.open,
                    high: existingCandle.high, low: existingCandle.low, close: existingCandle.close });
                this._safeVolumeBarUpdate(existingCandle.time,
                    existingCandle.quoteVolume || existingCandle.volume || 0,
                    existingCandle.close >= existingCandle.open ? this.bullishColor : this.bearishColor);
                this._invisibleSeriesDirty = true;
                this._volumeDataDirty = true;
                return;
            } else if (isNewCandle) {
                if (currentLastCandle) {
                    const expectedNextTime = this._getNextIntervalTime(currentLastCandle.time);
                    if (candle.time > expectedNextTime) {
                        setTimeout(() => { this._catchUpMissedCandles().catch(() => {}); }, 100);
                        return;
                    }
                    currentLastCandle._closed = true;
                }
                candle._isPlaceholder = false;
                candle._closed = willBeClosed;
                this._stampCandle(candle, 'ws', receivedAt, eventTime);
                this.chartData.push(candle);
                this._addToTimeMap(candle.time, this.chartData.length - 1);
                this.lastCandle = candle;
                this._updateVisibleSeries(updateData);
                this._safeVolumeBarUpdate(candle.time, candle.quoteVolume || candle.volume || 0,
                    candle.close >= candle.open ? this.bullishColor : this.bearishColor);
                if (this.volumeSeries) this._lastVolumeUpdateIndex = this.chartData.length - 1;
            } else return;
            if (!this.lastCandle) return;
            const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            if (activeSeries) this._applyPriceLineColor(activeSeries, this._getLineColor());
            this._updatePageTitle();
            if (this.timerManager) this.timerManager.updatePrice(this.lastCandle.close);
            if (this.scheduleUpdatePosition) this.scheduleUpdatePosition();
            this._volumeDataDirty = true;
        } catch (e) { console.error('Ошибка в updateLastCandle:', e); }
    }

    async waitForChartReady() {
        await new Promise(resolve => {
            let settled = false;
            const done = () => { if (!settled) { settled = true; clearTimeout(fallback); resolve(); } };
            const check = () => {
                if (settled) return;
                if (this._destroyed) { done(); return; }
                if (this._isChartValid()) {
                    const ts = this.chart?.timeScale();
                    if (ts && ts.getVisibleRange()) { done(); return; }
                }
                try { requestAnimationFrame(check); } catch (e) { done(); }
            };
            const fallback = setTimeout(done, 1500);
            check();
        });
        await new Promise(r => setTimeout(r, 50));
    }

    _ensureCurrentCandle(source = 'rest') {
        if (!this._isChartValid() || !Array.isArray(this.chartData) || this.chartData.length === 0) return false;
        const nowSec = Math.floor(Date.now() / 1000);
        const currentStart = this._alignTimeToInterval(nowSec);
        const lastCandle = this.chartData[this.chartData.length - 1];
        if (!lastCandle || typeof lastCandle.time !== 'number') return false;
        if (lastCandle.time >= currentStart) return false;
        const expectedNextTime = this._getNextIntervalTime(lastCandle.time);
        if (currentStart > expectedNextTime) {
            if (!this._catchingUpMissed) setTimeout(() => { this._catchUpMissedCandles().catch(() => {}); }, 0);
            return false;
        }
        if (!Number.isInteger(currentStart) || currentStart <= 0) return false;
        let price = null;
        try { price = this.getCurrentPrice(); } catch (e) { price = null; }
        if (typeof price === 'string') price = Number(price);
        if (price === null || price === undefined || typeof price !== 'number' || !isFinite(price) || isNaN(price) || price <= 0) {
            price = lastCandle.close;
        }
        if (typeof price !== 'number' || !isFinite(price) || isNaN(price) || price <= 0) return false;
        const candle = {
            time: currentStart, open: price, high: price, low: price, close: price,
            volume: 0, quoteVolume: 0, _isPlaceholder: true, _closed: false
        };
        this._stampCandle(candle, source, Date.now());
        this.chartData.push(candle);
        this._addToTimeMap(candle.time, this.chartData.length - 1);
        this.lastCandle = candle;
        if (typeof this.currentRealPrice !== 'number' || !isFinite(this.currentRealPrice) || isNaN(this.currentRealPrice)) {
            this.currentRealPrice = price;
        }
        this._volumeDataDirty = true;
        this._lastVolumeUpdateIndex = this.chartData.length - 1;
        this._updateVisibleSeries({ time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
        this._safeVolumeBarUpdate(candle.time, 0, this.bullishColor || '#26a69a');
        if (this.volumeSeries) this._applyVolumeScaleOptions();
        this._syncLineColor();
        if (this.timerManager && !this._switchingSymbol && !this._isSwitchingInterval && !this._updatesSuspended) {
            this.timerManager.updatePrice(candle.close);
        }
        return true;
    }

    setDataQuick(data, interval, symbol, exchange = 'binance', marketType = 'futures', forceNewSymbol = false, onReady = null) {
        const earlyReady = () => { try { this._disableAutoScroll(); } catch (e) {} if (typeof onReady === 'function') { try { onReady(); } catch (e) {} } };
        try {
            if (!this._isChartValid()) { earlyReady(); return; }
            if (!data || data.length === 0) { earlyReady(); return; }
            this._enableAutoScroll(2000);
            if (this.timerManager) this.timerManager.hideImmediately();
            this.chart.applyOptions({ handleScroll: false, handleScale: false });
            this.chartData = [];
            this.lastCandle = null;
            this._candleTimeMap.clear();
            this._volumeDataCache = null;
            this._volumeDataDirty = true;
            this._lastVolumeUpdateIndex = -1;
            this._isTrimming = false;
            this._invisibleSeriesDirty = true;
            this._lastInferredPrecision = null;
            if (this._trimDebounceTimeout) { clearTimeout(this._trimDebounceTimeout); this._trimDebounceTimeout = null; }
            this._pendingTrimParams = null;
            this._unhealableGaps.clear();
            for (const c of data) {
                if (c && typeof c.time === 'number' && Number.isInteger(c.time) && c.time > 0) {
                    const aligned = this._alignTimeForInterval(c.time, interval);
                    if (c.time !== aligned) c.time = aligned;
                }
            }
            const seenTimes = new Set();
            let noDupes = data.filter(c => {
                if (!c || typeof c.time !== 'number' || !Number.isInteger(c.time) || c.time <= 0) return false;
                if (seenTimes.has(c.time)) return false;
                seenTimes.add(c.time);
                return true;
            });
            noDupes = noDupes.filter(c => this._isValidCandle(c));
            data = noDupes;
            if (data.length === 0) {
                this.chart.applyOptions({ handleScroll: true, handleScale: true });
                earlyReady();
                return;
            }
            data.sort((a, b) => a.time - b.time);
            this.currentInterval = interval;
            this.currentSymbol = symbol;
            this.currentExchange = exchange;
            this.currentMarketType = marketType;
            const currentCandleStart = this._alignTimeToInterval(Math.floor(Date.now() / 1000));
            data.forEach(c => { c._closed = c.time < currentCandleStart; });
            this.chartData = data;
            this._candleTimeMap.clear();
            for (let i = 0; i < data.length; i++) this._candleTimeMap.set(data[i].time, i);
            this.hasMoreData = true;
            this._historyEndTime = data[0].time;
            this.lastCandle = data[data.length - 1];
            const cachedPrecision = this._getCachedPrecision(symbol, exchange, marketType);
            const inferredPrecision = this._inferPrecisionFromData();
            const prec = cachedPrecision ? parseInt(cachedPrecision, 10) : inferredPrecision;
            this.applyPriceFormat(prec);
            this._lastAppliedPrecision = String(prec);
            if (!cachedPrecision) this._setCachedPrecision(symbol, exchange, marketType, inferredPrecision);
            const lwBars = this._toLwBarsArray(this.chartData);
            if (lwBars.length === 0) {
                console.error('❌ setDataQuick: после валидации не осталось свечей');
                this.chart.applyOptions({ handleScroll: true, handleScale: true });
                earlyReady();
                return;
            }
            try {
                const ps0 = this.chart.priceScale('right');
                if (ps0) ps0.applyOptions({ autoScale: true, minimumWidth: 0 });
            } catch (e) {}
            this._setVisibleSeriesData(lwBars, true);
            if (this.volumeSeries && this.chartData.length > 0) {
                try {
                    const vd = this._buildVolumeData(this.chartData);
                    this.volumeSeries.setData(vd);
                    this._volumeDataDirty = false;
                    this._lastVolumeUpdateIndex = this.chartData.length - 1;
                    this._applyVolumeScaleOptions();
                } catch (e) { console.error('❌ volumeSeries.setData упал', e); }
            }
            this._ensureCurrentCandle('rest');
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            this.chart.applyOptions({ handleScroll: true, handleScale: true });
            if (series) this._applyPriceLineColor(series, this._getLineColor());
            setTimeout(() => {
                if (this.indicatorManager && this._isChartValid()) {
                    this.indicatorManager.restorePendingIndicators();
                    this.indicatorManager.updateAllIndicators();
                    this.indicatorManager.loadIndicators();
                }
            }, 0);
            let readyCalled = false;
            const fireReady = () => {
                if (readyCalled) return;
                readyCalled = true;
                try { this._disableAutoScroll(); } catch (e) {}
                if (typeof onReady === 'function') { try { onReady(); } catch (e) { console.error('❌ setDataQuick onReady:', e); } }
            };
            const positionAfterDataApplied = () => {
                if (!this._isChartValid()) { fireReady(); return; }
                try { this._scrollToRightEdgeWithOffset(); } catch (e) {}
                const finalizeAfterRescale = () => {
                    try {
                        if (this._isChartValid()) {
                            const ps = this.chart.priceScale('right');
                            if (ps) {
                                this._lockPriceScaleWidth();
                                try { ps.applyOptions({ autoScale: false }); } catch (e) {}
                            }
                            this._applyVolumeScaleOptions();
                        }
                        if (this.timerManager && this._isChartValid() && this.lastCandle) {
                            this.timerManager.start(this.currentInterval);
                            this.timerManager.updatePrice(this.lastCandle.close);
                        }
                    } catch (e) { console.error('❌ finalizeAfterRescale:', e); }
                    finally { fireReady(); }
                };
                try {
                    const priceScale = this.chart.priceScale('right');
                    if (priceScale) {
                        priceScale.applyOptions({ autoScale: true });
                        this._doubleFrame(finalizeAfterRescale);
                    } else finalizeAfterRescale();
                } catch (e) { fireReady(); }
            };
            this._doubleFrame(positionAfterDataApplied);
            this.scheduleUpdatePosition();
            this._updatePageTitle();
            if (typeof getPrecisionFromExchange === 'function') {
                getPrecisionFromExchange(symbol, exchange, marketType).then(precision => {
                    if (this.currentSymbol === symbol && this._isChartValid()) {
                        if (this._applyResolvedPrecision(symbol, exchange, marketType, precision)) {
                            this.applyPriceFormat(Math.floor(Number(precision)));
                        }
                    }
                }).catch(() => {});
            }
            this._lastTimeframe = interval;
            if (!window._dailySeparator && window.DailySeparator) window._dailySeparator = new window.DailySeparator(this);
            if (window._dailySeparator?.redraw) window._dailySeparator.redraw();
            if (!window._sessionHighlighter && window.SessionHighlighter) window._sessionHighlighter = new window.SessionHighlighter(this);
            if (window._sessionHighlighter?.redraw) window._sessionHighlighter.redraw();
            this.isLoadingMore = false;
            this._pendingHistoryLoad = false;
            this._lastHistoryLoadTime = 0;
            this._historyPrefetchRunning = false;
            if (this._historyThrottleRetry) { clearTimeout(this._historyThrottleRetry); this._historyThrottleRetry = null; }
            this._lastHistoryCheckAt = 0;
            this._scheduleDeepPrefetch();
        } catch (error) {
            console.error('❌ Ошибка в setDataQuick:', error);
            if (this.chart) this.chart.applyOptions({ handleScroll: true, handleScale: true });
            earlyReady();
        }
    }

    _captureScale() {
        if (!this._isChartValid()) return null;
        try {
            const ts = this.chart.timeScale();
            const lr = ts.getVisibleLogicalRange();
            if (lr) return { logical: { from: lr.from, to: lr.to }, width: lr.to - lr.from };
        } catch (e) {}
        return null;
    }

    _restoreScale(scale) {
        if (!scale || !this._isChartValid()) return;
        this._isRestoringZoom = true;
        try {
            const ts = this.chart.timeScale();
            if (scale.logical) {
                const len = this.chartData.length;
                let from = Math.max(0, Math.floor(scale.logical.from));
                let to = Math.min(len, Math.ceil(scale.logical.to));
                if (from >= len || to <= 0 || from >= to) { this.scrollToLast(); return; }
                from = Math.max(0, Math.min(from, len - 2));
                to = Math.max(from + 2, Math.min(to, len));
                ts.setVisibleLogicalRange({ from, to });
            }
        } catch (e) { this.scrollToLast(); }
        finally { setTimeout(() => { this._isRestoringZoom = false; }, 100); }
    }

    _suspendAllUpdates() {
        this._updatesSuspended = true;
        if (this._priceGateTimeout !== null) { clearTimeout(this._priceGateTimeout); this._priceGateTimeout = null; }
        this._pendingPriceUpdate = null;
        this._lastPriceGateAt = 0;
        if (this.priceManager) this.priceManager.suspend?.();
        if (this.timerManager) this.timerManager.stop?.();
    }
    _resumeAllUpdates(genId) {
        if (this._activeGeneration !== genId) return;
        this._updatesSuspended = false;
        if (this.priceManager) this.priceManager.resume?.();
    }

    _queuePendingSwitch(partial) {
        this._pendingSwitchRequest = Object.assign({}, this._pendingSwitchRequest || {}, partial);
    }

    _dispatchPendingSwitch() {
        if (this._pendingSwitchRequest) {
            const req = this._pendingSwitchRequest;
            this._pendingSwitchRequest = null;
            const next = {
                symbol:     req.symbol     !== undefined ? req.symbol     : this.currentSymbol,
                exchange:   req.exchange   !== undefined ? req.exchange   : this.currentExchange,
                marketType: req.marketType !== undefined ? req.marketType : this.currentMarketType,
                interval:   req.interval   !== undefined ? req.interval   : this.currentInterval,
            };
            const symbolChanged = next.symbol !== this.currentSymbol || next.exchange !== this.currentExchange || next.marketType !== this.currentMarketType;
            const intervalChanged = next.interval !== this.currentInterval;
            if (!symbolChanged && !intervalChanged) return;
            if (symbolChanged) {
                if (intervalChanged) {
                    this.currentInterval = next.interval;
                    localStorage.setItem('lastTimeframe', next.interval);
                }
                this.switchSymbol(next.symbol, next.exchange, next.marketType);
            } else if (intervalChanged) {
                this.switchInterval(next.interval);
            }
        }
    }

    async switchSymbol(symbol, exchange, marketType) {
        if (this._switchingSymbol || this._isSwitchingInterval) {
            this._queuePendingSwitch({ symbol, exchange, marketType });
            return false;
        }
        const requested = { symbol, exchange, marketType };
        const fallbackUi = {
            symbol: this.currentSymbol, exchange: this.currentExchange, marketType: this.currentMarketType
        };

        this._switchingSymbol = true;
        this._showSymbolSwitchOverlay();
        this._suspendAllUpdates();

        const prevInterval = this.currentInterval;
        const generationId = ++this._generationCounter;
        this._activeGeneration = generationId;
        const ownerToken = Symbol('switchSymbol');
        this._switchOwnerToken = ownerToken;
        this._armSwitchWatchdog('переключение символа ' + requested.symbol, ownerToken);
        let dataApplied = false;
        const stillOwner = () => this._switchOwnerToken === ownerToken && this._activeGeneration === generationId;

        try {
            const explicitMarketSwitch = symbol === this.currentSymbol &&
                exchange === this.currentExchange && marketType !== this.currentMarketType;

            const loaded = await this._loadCandlesResilient(
                symbol, exchange, marketType, this.currentInterval, this._initialBatch || 1000,
                { requestType: 'switch', allowFallbacks: !explicitMarketSwitch }
            );
            this._switchProgress();
            if (this._activeGeneration !== generationId || this._destroyed) return false;

            let candles = loaded.candles;
            let isFromCache = !!loaded.fromCache;

            if (!candles || candles.length === 0) {
                if (loaded.reason !== 'aborted') {
                    const err = new Error(loaded.reason || this._describeLoadFailure(
                        symbol, exchange, marketType, this.currentInterval, loaded.errors, loaded.networkMissing
                    ));
                    err.vpNoData = true;
                    throw err;
                }
                return false;
            }

            if (loaded.alt) {
                symbol = loaded.alt.symbol;
                exchange = loaded.alt.exchange;
                marketType = loaded.alt.marketType;
            }

            this.currentRealPrice = null;
            this.lastCandle = null;
            this._abortAllProcesses();

            this.chartData = [];
            this._candleTimeMap.clear();
            this._lastKlineEventTime = 0;
            this._pendingTrimParams = null;

            this.currentSymbol = symbol;
            this.currentExchange = exchange;
            this.currentMarketType = marketType;

            this._subscribeToPrice();
            if (window.wsManager?.updateSymbolAndTimeframe) {
                window.wsManager.updateSymbolAndTimeframe(symbol, this.currentInterval, exchange, marketType);
            }
            const cachedPrecision = this._getCachedPrecision(symbol, exchange, marketType);
            if (cachedPrecision) {
                this.applyPriceFormat(parseInt(cachedPrecision, 10));
            } else {
                this.applyPriceFormat(this._inferPrecisionFromData());
                this._prefetchPrecision(symbol, exchange, marketType).catch(() => {});
            }
            if (!this._isChartValid()) return false;

            if (isFromCache) {
                this.refreshCandlesInBackground(symbol, exchange, marketType, this.currentInterval).catch(() => {});
            }

            await this._withTimeout(new Promise((resolve) => {
                this.setDataQuick(candles, this.currentInterval, symbol, exchange, marketType, true, resolve);
            }), this._setDataReadyTimeoutMs, () => {
                console.warn(`⚠️ [VP-STUCK] setDataQuick(${symbol}) не завершился за ` +
                    `${this._setDataReadyTimeoutMs / 1000} с — продолжаю по факту данных`);
            });
            this._switchProgress();
            dataApplied = true;
            if (!this.chartData || this.chartData.length === 0) {
                throw new Error(`${symbol}: свечи не легли на график`);
            }
            if (this._activeGeneration !== generationId) return true;

            if (!isFromCache) {
                this.saveCandlesToCache(symbol, exchange, marketType, this.currentInterval, candles).catch(() => {});
            }
            try {
                localStorage.setItem('lastSymbol', symbol);
                localStorage.setItem('lastExchange', exchange);
                localStorage.setItem('lastMarketType', marketType);
            } catch (e) {}
            if (window.drawingLoaderCoordinator) {
                window.drawingLoaderCoordinator.loadAllForSymbol(this.getCurrentSymbolKey()).catch(() => {});
            }

            if (!this._getCachedPrecision(symbol, exchange, marketType)) {
                this._prefetchPrecision(symbol, exchange, marketType).catch(() => {});
            }

            if (loaded.alt) {
                this._notifyUser({
                    title: '↪ Рынок переключён',
                    text: `${requested.symbol}: на ${requested.exchange}/${requested.marketType} данных нет — ` +
                          `показан ${exchange}/${marketType}`,
                    color: '#ffa500', duration: 6000
                });
                this._revertSymbolUi(symbol, exchange, marketType);
            } else if (loaded.stale) {
                this._notifyUser({
                    title: '⚠️ Биржа не ответила',
                    text: `${symbol}: показаны свечи из кэша, идёт досинхронизация`,
                    color: '#ffa500', duration: 6000
                });
            }

            this._notifySymbolChange();
            return true;
        } catch (error) {
            console.error(`❌ Не удалось переключиться на ${requested.symbol} ` +
                `(${requested.exchange}/${requested.marketType}):`, error && error.message ? error.message : error);
            if (!dataApplied && !this._destroyed && this._activeGeneration === generationId &&
                this.currentSymbol !== fallbackUi.symbol) {
                this.currentSymbol = fallbackUi.symbol;
                this.currentExchange = fallbackUi.exchange;
                this.currentMarketType = fallbackUi.marketType;
                try { this._subscribeToPrice(); } catch (e) {}
            }
            if (!dataApplied && !this._destroyed && this._activeGeneration === generationId &&
                this.currentInterval !== prevInterval) {
                this.currentInterval = prevInterval;
                try { localStorage.setItem('lastTimeframe', prevInterval); } catch (e) {}
                if (window.wsManager?.updateSymbolAndTimeframe) {
                    window.wsManager.updateSymbolAndTimeframe(this.currentSymbol, prevInterval, this.currentExchange, this.currentMarketType);
                }
            }
            if (!dataApplied && !this._destroyed && this._activeGeneration === generationId) {
                this._revertSymbolUi(fallbackUi.symbol, fallbackUi.exchange, fallbackUi.marketType);
                this._notifyUser({
                    title: '❌ Не удалось загрузить',
                    text: `${requested.symbol}: ${error && error.message ? error.message : 'нет данных'}`,
                    color: '#f23645',
                    duration: 8000,
                    retry: () => { this.switchSymbol(requested.symbol, requested.exchange, requested.marketType); }
                });
            }
            return false;
        } finally {
            if (this._destroyed) {
                this._clearSwitchWatchdog();
                return;
            }
            this._clearSwitchWatchdog();
            const owner = stillOwner();
            try {
                if (owner) {
                    this._switchingSymbol = false;
                    this._updatesSuspended = false;
                    if (this.priceManager) this.priceManager.resume?.();
                }
                if (dataApplied) {
                    if (owner) { this._startPeriodicSync(); this._startNewCandleChecker(); }
                    const genAtHide = this._activeGeneration;
                    this._doubleFrame(() => {
                        if (this._destroyed) return;
                        if (this._activeGeneration !== genAtHide) return;
                        this._hideSymbolSwitchOverlay();
                    });
                    this._syncRecentCandles().catch(() => {});
                } else {
                    this._hideSymbolSwitchOverlay();
                }
            } catch (finErr) {
                console.error('❌ switchSymbol: сбой в finally — снимаю затемнение принудительно', finErr);
                try { this._hideSymbolSwitchOverlay(); } catch (e) {}
            } finally {
                if (owner) { try { this._dispatchPendingSwitch(); } catch (e) {} }
            }
        }
    }

    async switchInterval(newInterval) {
        if (this._isSwitchingInterval || this._switchingSymbol) { this._queuePendingSwitch({ interval: newInterval }); return { queued: true }; }
        if (this.currentInterval === newInterval) return;

        this._isSwitchingInterval = true;
        this._showSymbolSwitchOverlay();
        const generationId = ++this._generationCounter;
        this._activeGeneration = generationId;
        const ownerToken = Symbol('switchInterval');
        this._switchOwnerToken = ownerToken;
        this._armSwitchWatchdog('переключение таймфрейма ' + newInterval, ownerToken);
        const stillOwner = () => this._switchOwnerToken === ownerToken && this._activeGeneration === generationId;
        this._stopPeriodicSync();
        this._stopCandleChecker();

        this._abortAllFetchControllers();
        this._historyPrefetchRunning = false;

        this._lastKlineEventTime = 0;
        this._catchingUpMissed = false;
        this._lastCatchUpAttempt = 0;
        this._lastInferredPrecision = null;

        if (window.wsManager?.clearKlineQueue) window.wsManager.clearKlineQueue();

        let intervalApplied = false;
        let isFromCache = false;

        try {
            this._suspendAllUpdates();
            const loaded = await this._loadCandlesResilient(
                this.currentSymbol, this.currentExchange, this.currentMarketType,
                newInterval, this._initialBatch || 1000,
                { requestType: 'switch', allowFallbacks: false, allowStale: false }
            );
            this._switchProgress();
            if (this._activeGeneration !== generationId || this._destroyed) return;
            let candles = loaded.candles;
            isFromCache = !!loaded.fromCache;
            if (!candles || candles.length === 0) {
                if (loaded.reason === 'aborted') return;
                throw new Error(`${newInterval}: ${loaded.reason || 'нет данных'}`);
            }
            if (loaded.stale) {
                this._notifyUser({
                    title: '⚠️ Биржа не ответила',
                    text: `${this.currentSymbol} ${newInterval}: показаны свечи из кэша`,
                    color: '#ffa500', duration: 5000
                });
            }

            this.currentInterval = newInterval;
            try { localStorage.setItem('lastTimeframe', newInterval); } catch (e) {}
            if (window.wsManager?.updateSymbolAndTimeframe) {
                window.wsManager.updateSymbolAndTimeframe(this.currentSymbol, newInterval, this.currentExchange, this.currentMarketType);
            }

            await this._withTimeout(new Promise((resolve) => {
                this.setDataQuick(candles, this.currentInterval, this.currentSymbol, this.currentExchange, this.currentMarketType, true, resolve);
            }), this._setDataReadyTimeoutMs, () => {
                console.warn(`⚠️ [VP-STUCK] setDataQuick(${newInterval}) не завершился за ` +
                    `${this._setDataReadyTimeoutMs / 1000} с — продолжаю по факту данных`);
            });
            this._switchProgress();
            if (this._activeGeneration !== generationId) return;
            intervalApplied = true;
            if (!isFromCache) this.saveCandlesToCache(this.currentSymbol, this.currentExchange, this.currentMarketType, this.currentInterval, candles).catch(() => {});
            if (isFromCache) {
                this.refreshCandlesInBackground(this.currentSymbol, this.currentExchange, this.currentMarketType, this.currentInterval).catch(() => {});
            }
            if (window.drawingLoaderCoordinator) {
                window.drawingLoaderCoordinator.loadAllForSymbol(this.getCurrentSymbolKey()).catch(() => {});
            }
        } catch (error) {
            console.error('❌ Ошибка переключения таймфрейма:', error);
        } finally {
            if (this._destroyed) {
                this._clearSwitchWatchdog();
                return;
            }
            this._clearSwitchWatchdog();
            const owner = stillOwner();
            try {
                if (owner) {
                    this._isSwitchingInterval = false;
                    this._updatesSuspended = false;
                    if (this.priceManager) this.priceManager.resume?.();
                    this._startPeriodicSync();
                    this._startNewCandleChecker();
                }
                const stale = this._activeGeneration !== generationId;
                if (stale || !intervalApplied) {
                    this._hideSymbolSwitchOverlay();
                } else {
                    const genAtHide = this._activeGeneration;
                    this._doubleFrame(() => {
                        if (this._destroyed) return;
                        if (this._activeGeneration !== genAtHide) return;
                        this._hideSymbolSwitchOverlay();
                    });
                    this._syncRecentCandles().catch(() => {});
                }
            } catch (finErr) {
                console.error('❌ switchInterval: сбой в finally — снимаю затемнение принудительно', finErr);
                try { this._hideSymbolSwitchOverlay(); } catch (e) {}
            } finally {
                if (owner) { try { this._dispatchPendingSwitch(); } catch (e) {} }
            }
        }
    }

    async loadInitialData(symbol, exchange, marketType, interval, onReady = null) {
        if (this._switchingSymbol || this._isSwitchingInterval) { if (onReady) onReady(); return; }
        if (this._destroyed) { if (onReady) onReady(); return; }

        this._showSymbolSwitchOverlay();

        const generationId = ++this._generationCounter;
        this._activeGeneration = generationId;
        if (symbol) this.currentSymbol = symbol;
        if (exchange) this.currentExchange = exchange;
        if (marketType) this.currentMarketType = marketType;
        if (interval) this.currentInterval = interval;

        const finish = () => {
            if (this._activeGeneration === generationId && !this._switchingSymbol && !this._isSwitchingInterval) {
                this._hideSymbolSwitchOverlay();
            }
            if (onReady) onReady();
        };
        try {
            const loaded = await this._loadCandlesResilient(
                this.currentSymbol, this.currentExchange, this.currentMarketType,
                this.currentInterval, this._initialBatch || 1000, { requestType: 'switch' }
            );
            if (this._activeGeneration !== generationId) { finish(); return; }
            const candles = loaded.candles;
            const isFromCache = !!loaded.fromCache;
            if (!candles || candles.length === 0) {
                console.warn(`⚠️ loadInitialData: ${this.currentSymbol} ${this.currentInterval} — ` +
                    (loaded.reason || 'нет данных'));
                this._notifyUser({
                    title: '❌ Не удалось загрузить график',
                    text: `${this.currentSymbol}: ${loaded.reason || 'нет данных'}`,
                    color: '#f23645', duration: 9000,
                    retry: () => { this.loadInitialData(null, null, null, null, null); }
                });
                finish(); return;
            }
            this._prefetchPrecision(this.currentSymbol, this.currentExchange, this.currentMarketType).catch(() => {});
            await this._withTimeout(new Promise((resolve) => {
                this.setDataQuick(candles, this.currentInterval, this.currentSymbol, this.currentExchange, this.currentMarketType, true, resolve);
            }), this._setDataReadyTimeoutMs, () => {
                console.warn('⚠️ [VP-STUCK] loadInitialData: setDataQuick не завершился за ' +
                    (this._setDataReadyTimeoutMs / 1000) + ' с');
            });
            if (this._activeGeneration !== generationId) { finish(); return; }
            if (isFromCache) this.refreshCandlesInBackground(this.currentSymbol, this.currentExchange, this.currentMarketType, this.currentInterval).catch(() => {});
            else this.saveCandlesToCache(this.currentSymbol, this.currentExchange, this.currentMarketType, this.currentInterval, candles).catch(() => {});
            finish();
        } catch (error) { console.error('❌ Ошибка первоначальной загрузки:', error); finish(); }
    }

    onCrosshairMove(param) {
        this._pendingCrosshairParam = param;
        this._crosshairActive = true;
        if (this._crosshairIdleTimeout) clearTimeout(this._crosshairIdleTimeout);
        this._crosshairIdleTimeout = setTimeout(() => {
            this._crosshairIdleTimeout = null;
            this._crosshairActive = false;
            try { this.indicatorManager?.flushPendingIndicatorsUpdate?.(); } catch (e) {}
        }, 150);
        if (this._crosshairRafId) return;
        this._crosshairRafId = requestAnimationFrame(() => {
            this._crosshairRafId = null;
            this._processCrosshair(this._pendingCrosshairParam);
        });
    }

    _processCrosshair(param) {
        if (document.hidden || !param || !param.time || !param.point || !this._isChartValid()) {
            if (this.overlay) this.overlay.classList.remove('visible');
            this._latestCrosshairData = null;
            this._clearPanelsCrosshair();
            return;
        }
        if (this._latestCrosshairData && this._latestCrosshairData.visible && this._latestCrosshairData.time === param.time) {
            this._latestCrosshairData.pointX = param.point.x;
            this._applyCrosshairDOMOptimized();
            this._syncPanelsCrosshairOptimized();
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
                cls: isBullish ? 'bullish' : 'bearish',
                visible: true, time: param.time, pointX: param.point.x
            };
        } else {
            this._latestCrosshairData = { visible: false, time: param.time, pointX: param.point.x };
        }
        this._applyCrosshairDOMOptimized();
        this._syncPanelsCrosshairOptimized();
    }

    _getPanelsList() {
        const panels = this.indicatorManager?.panelManager?.panels;
        if (!panels) return [];
        if (Array.isArray(panels)) return panels;
        if (typeof panels.values === 'function') { try { return Array.from(panels.values()); } catch (e) { return []; } }
        return [];
    }

    _getPanelFirstSeries(panel) {
        const series = panel?.series;
        if (!series) return null;
        if (Array.isArray(series)) return series.length ? series[0] : null;
        if (typeof series.values === 'function') {
            for (const s of series.values()) { if (s) return s; }
        }
        return null;
    }

    _isDrawingDragActive() {
        const w = window;
        return !!((w.alertLineManager && w.alertLineManager._isDragging) ||
            (w.trendLineManager && w.trendLineManager._isDragging) ||
            (w.rayManager && w.rayManager._isDragging) ||
            (w.rulerLineManager && w.rulerLineManager._isDragging) ||
            (w.textManager && w.textManager._isDragging) ||
            (w.tradeLevelManager && w.tradeLevelManager._isDragging));
    }

    lockChartScrollForDrawing() {
        if (this._drawingScrollLock) return;
        this._drawingScrollLock = true;
        try { this.chart.applyOptions({ handleScroll: false }); } catch (e) {}
    }

    unlockChartScrollForDrawing() {
        if (!this._drawingScrollLock) return;
        this._drawingScrollLock = false;
        try {
            this.chart.applyOptions({
                handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true }
            });
        } catch (e) {}
    }

    _clearPanelsCrosshair() {
        const panels = this._getPanelsList();
        if (panels.length === 0) return;
        for (let i = 0; i < panels.length; i++) {
            const panel = panels[i];
            if (!panel.chart || panel.isCollapsed) continue;
            if (!this._panelCrosshairLast.has(panel)) continue;
            this._panelCrosshairLast.delete(panel);
            try { panel.chart.clearCrosshairPosition(); } catch (e) {}
        }
    }

    _syncPanelsCrosshairOptimized() {
        if (!this._latestCrosshairData || !this._latestCrosshairData.visible) { this._clearPanelsCrosshair(); return; }
        if (this._isDrawingDragActive()) return;
        const panels = this._getPanelsList();
        if (panels.length === 0) return;
        const { time } = this._latestCrosshairData;
        const idx = this._candleTimeMap.get(time);
        for (let i = 0; i < panels.length; i++) {
            const panel = panels[i];
            if (!panel.chart || panel.isCollapsed) continue;
            try {
                const targetSeries = this._getPanelFirstSeries(panel);
                if (!targetSeries) continue;
                const dataPoint = (idx !== undefined) ? targetSeries.dataByIndex?.(idx) : null;
                if (dataPoint && dataPoint.value !== undefined) {
                    const last = this._panelCrosshairLast.get(panel);
                    if (last && last.time === time && last.value === dataPoint.value) continue;
                    this._panelCrosshairLast.set(panel, { time, value: dataPoint.value });
                    panel.chart.setCrosshairPosition(dataPoint.value, time, targetSeries);
                } else if (this._panelCrosshairLast.has(panel)) {
                    this._panelCrosshairLast.delete(panel);
                    panel.chart.clearCrosshairPosition();
                }
            } catch (e) {}
        }
    }

    _applyCrosshairDOMOptimized() {
        const data = this._latestCrosshairData;
        if (!data || !data.visible) { if (this.overlay) this.overlay.classList.remove('visible'); return; }
        const precision = this._getTitlePrecision();
        const formatWithPrecision = (value) => {
            if (value === undefined || value === null || isNaN(value)) return '—';
            const key = `${value}_${precision}`;
            if (!this._formatCache.has(key)) {
                const formatted = Number(value).toFixed(precision);
                this._formatCache.set(key, formatted);
                if (this._formatCache.size > 500) this._formatCache.delete(this._formatCache.keys().next().value);
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
        if (this.overlay && !this.overlay.classList.contains('visible')) this.overlay.classList.add('visible');
    }

    updateRealPrice(price) { this._syncPriceLine(price); }

    scrollToLast(enableRealTime = true) {
        if (!this._isChartValid() || !this.chartData || this.chartData.length === 0) return false;
        if (this._isRestoringZoom) return false;
        try {
            this._isViewingHistory = false;
            this.lastCandle = this.chartData[this.chartData.length - 1];
            const timeScale = this.chart.timeScale();
            if (!timeScale) return false;
            const savedBarSpacing = this._savedBarSpacing || 25;
            timeScale.applyOptions({ barSpacing: savedBarSpacing });
            this._scrollToRightEdgeWithOffset();
            if (this.lastCandle) {
                this._updateVisibleSeries({ time: this.lastCandle.time, open: this.lastCandle.open,
                    high: this.lastCandle.high, low: this.lastCandle.low, close: this.lastCandle.close });
            }
            if (this.timerManager?._primitive?.isEnabled()) this.timerManager._primitive.requestRedraw();
            return true;
        } catch (e) { return false; }
    }

    clearChart() {
        if (!this._isChartValid()) return;
        if (this.candleSeries) this.candleSeries.setData([]);
        if (this.barSeries) this.barSeries.setData([]);
        if (this.volumeSeries) { this.volumeSeries.setData([]); this._applyVolumeScaleOptions(); }
        this.chartData = [];
        this.lastCandle = null;
        this._volumeDataCache = null;
        this._volumeDataDirty = true;
        this._lastVolumeUpdateIndex = -1;
        this._isTrimming = false;
        const priceScale = this.chart.priceScale('right');
        if (priceScale) priceScale.applyOptions({ autoScale: true, minimumWidth: 0 });
    }

    autoScale(onComplete) {
        if (!this._isChartValid() || !this.chartData || this.chartData.length === 0) { if (onComplete) onComplete(); return; }
        if (this._autoScalePending) { if (onComplete) onComplete(); return; }
        this._autoScalePending = true;
        const genId = this._activeGeneration;
        setTimeout(() => {
            if (this._activeGeneration !== genId || !this._isChartValid()) { this._autoScalePending = false; if (onComplete) onComplete(); return; }
            try {
                const priceScale = this.chart.priceScale('right');
                if (priceScale) {
                    priceScale.applyOptions({ autoScale: true, scaleMargins: { top: 0.1, bottom: 0.25 } });
                    setTimeout(() => {
                        if (this._activeGeneration !== genId || !this._isChartValid()) { this._autoScalePending = false; if (onComplete) onComplete(); return; }
                        try { priceScale.applyOptions({ autoScale: false }); } catch (e) {}
                        this._applyVolumeScaleOptions();
                        this._autoScalePending = false;
                        if (this.timerManager?._primitive?.isEnabled()) this.timerManager._primitive.requestRedraw();
                        if (onComplete) onComplete();
                    }, 100);
                } else { this._autoScalePending = false; if (onComplete) onComplete(); }
            } catch (e) { this._autoScalePending = false; if (onComplete) onComplete(); }
        }, 100);
    }

    isLogScale() {
        try { return this.chart?.priceScale('right')?.options()?.mode === 1; } catch (e) { return false; }
    }

    setLogScale(enabled) {
        if (!this._isChartValid()) return;
        try {
            const mode = enabled
                ? ((typeof LightweightCharts !== 'undefined' && LightweightCharts.PriceScaleMode)
                    ? LightweightCharts.PriceScaleMode.Logarithmic : 1)
                : 0;
            this.chart.priceScale('right').applyOptions({ mode });
            localStorage.setItem('priceScaleMode', enabled ? 'log' : 'normal');
        } catch (e) { console.warn('setLogScale failed:', e); }
        this._updateLogScaleButton();
        this.autoScale();
    }

    toggleLogScale() { this.setLogScale(!this.isLogScale()); }

    _updateLogScaleButton() {
        const btn = document.getElementById('logScaleButton');
        if (btn) btn.classList.toggle('active', this.isLogScale());
    }

    _finishAutoScale(genId, onComplete) {
        if (this._isChartValid()) {
            const ps = this.chart?.priceScale('right');
            if (ps) { try { ps.applyOptions({ autoScale: false }); } catch (e) {} }
            this._applyVolumeScaleOptions();
        }
        this._autoScalePending = false;
        if (this._activeGeneration === genId && this.timerManager?._primitive?.isEnabled()) this.timerManager._primitive.requestRedraw();
        if (onComplete) onComplete();
    }

    getLastCandle() { return this.lastCandle; }
    getChart() { return this.chart; }
    setCurrentInterval(interval) { this.currentInterval = interval; }

    getCurrentPrice() {
        if (this.priceManager) {
            let price = null;
            try { price = this.priceManager.getPrice(this.currentSymbol, this.currentExchange, this.currentMarketType); }
            catch (e) { price = null; }
            if (price && typeof price === 'object') {
                if (typeof price.price === 'number') price = price.price;
                else if (typeof price.close === 'number') price = price.close;
                else if (typeof price.last === 'number') price = price.last;
                else price = null;
            }
            if (typeof price === 'string') price = Number(price);
            if (typeof price === 'number' && isFinite(price) && !isNaN(price) && price > 0) return price;
        }
        if (typeof this.currentRealPrice === 'number' && isFinite(this.currentRealPrice) && !isNaN(this.currentRealPrice) && this.currentRealPrice > 0) return this.currentRealPrice;
        return null;
    }

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
        this._applyVolumeScaleOptions();
        if (this.indicatorManager?.panelManager) {
            const panels = this._getPanelsList();
            if (panels.length > 0) {
                panels.forEach(panel => {
                    const pc = panel.content || panel.container;
                    if (panel.chart && !panel.isCollapsed && pc) {
                        try {
                            const ph = pc.clientHeight, pw = pc.clientWidth;
                            if (ph > 0 && pw > 0) panel.chart.resize(pw, ph);
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
        if (this._destroyed) return;
        if (!this.priceManager) {
            this.priceManager = window.priceManagerInstance || null;
            if (!this.priceManager) { setTimeout(() => this._subscribeToPrice(), 100); return; }
        }
        if (this._priceSubscriptionKey && this._priceUpdateHandler) {
            this.priceManager.unsubscribe(this._priceSubscriptionKey, this._priceUpdateHandler);
            this._priceUpdateHandler = null;
            this._priceSubscriptionKey = null;
        }
        const key = `${this.currentSymbol}:${this.currentExchange}:${this.currentMarketType}`;
        this._priceSubscriptionKey = key;
        this._priceUpdateHandler = (price, symbol, exchange, marketType) => {
            if (this._switchingSymbol || this._isSwitchingInterval || this._updatesSuspended) return;
            if (symbol !== this.currentSymbol || exchange !== this.currentExchange || marketType !== this.currentMarketType) return;
            if (price && typeof price === 'object') {
                if (typeof price.price === 'number') price = price.price;
                else if (typeof price.close === 'number') price = price.close;
                else if (typeof price.last === 'number') price = price.last;
                else return;
            }
            if (typeof price === 'string') price = Number(price);
            if (typeof price !== 'number' || isNaN(price) || !isFinite(price)) return;
            this.currentRealPrice = price;
            this._scheduleTitleUpdate();
            if (!document.hidden) this._syncPriceLine(price);
        };
        this.priceManager.subscribe(key, this._priceUpdateHandler, this.currentExchange, this.currentMarketType);
        this._startBackgroundTitleUpdate();
    }

    setSymbol(symbol) {
        if (this.currentSymbol === symbol) return;
        this.currentSymbol = symbol;
        this._subscribeToPrice();
    }

    _inferPrecisionFromData() {
        if (!this.chartData || this.chartData.length === 0) return 2;
        const lastPrice = this.chartData[this.chartData.length - 1].close;
        if (!lastPrice || lastPrice === 0) return 2;
        const fixed = lastPrice < 1 ? lastPrice.toFixed(10) : lastPrice.toString();
        if (fixed.includes('.')) {
            const decimals = fixed.split('.')[1].replace(/0+$/, '').length || 2;
            return Math.min(Math.max(decimals, 2), 8);
        }
        return 2;
    }

    applyPriceFormat(precision) {
        try {
            let p = Number(precision);
            if (!isFinite(p) || isNaN(p)) p = this._inferPrecisionFromData();
            p = Math.floor(p);
            if (p < 0) p = 0;
            if (p > 8) p = 8;
            const minMove = Math.pow(10, -p);
            const priceFormat = { type: 'price', precision: p, minMove };
            this._titlePrecision = p;
            this._drawingPrecisionKey = null;
            this._drawingPrecisionValue = null;
            if (this.candleSeries) this.candleSeries.applyOptions({ priceFormat });
            if (this.barSeries) this.barSeries.applyOptions({ priceFormat });
            if (this.chart) {
                const ps = this.chart.priceScale('right');
                if (ps) ps.applyOptions({ priceFormat });
            }
            if (this.timerManager?._primitive?.isEnabled()) this.timerManager._primitive.requestRedraw();
            return p;
        } catch (error) { return 2; }
    }

    _isValidCandle(candle, nowSecHint = null) {
        if (!candle || typeof candle !== 'object') return false;
        if (typeof candle.time !== 'number' || isNaN(candle.time) || candle.time <= 0) return false;
        if (!Number.isInteger(candle.time)) return false;
        const nowSec = nowSecHint !== null ? nowSecHint : this._nowSec();
        const maxAllowedTime = nowSec + this._getIntervalSeconds() * 2;
        if (candle.time > maxAllowedTime) return false;
        const ohlcFields = ['open', 'high', 'low', 'close'];
        for (const field of ohlcFields) {
            const val = candle[field];
            if (typeof val !== 'number' || isNaN(val) || !isFinite(val) || val <= 0) return false;
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
        const nowSec = this._nowSec();
        const maxAllowedTime = nowSec + this._getIntervalSeconds() * 2;
        if (clean.time > maxAllowedTime) return null;
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

    _createNewCandle(candle, eventTime = null) {
        if (!candle || !candle.time || !this._isChartValid()) return;
        if (this._candleTimeMap.has(candle.time)) return;
        const expectedTime = this._alignTimeToInterval(candle.time);
        if (candle.time !== expectedTime) candle.time = expectedTime;
        const lastCandle = this.chartData[this.chartData.length - 1];
        if (lastCandle && candle.time <= lastCandle.time) return;
        const nowSec = Math.floor(Date.now() / 1000);
        const intervalSeconds = this._getIntervalSeconds();
        const maxAllowedTime = this._alignTimeToInterval(nowSec) + intervalSeconds * 2;
        if (candle.time > maxAllowedTime) return;
        if (lastCandle) {
            const expectedNextTime = this._getNextIntervalTime(lastCandle.time);
            if (candle.time > expectedNextTime) {
                setTimeout(() => { this._catchUpMissedCandles().catch(() => {}); }, 100);
                return;
            }
        }
        if (!candle.quoteVolume && candle.volume) candle.quoteVolume = candle.volume;
        this._stampCandle(candle, 'ws', Date.now(), eventTime);
        this.chartData.push(candle);
        this._addToTimeMap(candle.time, this.chartData.length - 1);
        this.lastCandle = candle;
        this.currentRealPrice = candle.close;
        const lineColor = this._getLineColor();
        const updateData = { time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close };
        this._updateVisibleSeries(updateData);
        const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (activeSeries) this._applyPriceLineColor(activeSeries, lineColor);
        this._safeVolumeBarUpdate(candle.time, candle.quoteVolume || candle.volume || 0,
            candle.close >= candle.open ? this.bullishColor : this.bearishColor);
        if (this.volumeSeries) this._lastVolumeUpdateIndex = this.chartData.length - 1;
        if (this.timerManager) {
            this.timerManager.updatePrice(candle.close);
            this.timerManager.start(this.currentInterval);
        }
        this._volumeDataDirty = true;
    }

    _buildVolumeData(data) {
        const bullishColor = this.bullishColor || (typeof CONFIG !== 'undefined' && CONFIG.colors && CONFIG.colors.bullish) || '#26a69a';
        const bearishColor = this.bearishColor || (typeof CONFIG !== 'undefined' && CONFIG.colors && CONFIG.colors.bearish) || '#ef5350';
        if (this._volumeDataCache && !this._volumeDataDirty && data === this.chartData) return this._volumeDataCache;
        const volumeData = [];
        const interval = this.currentInterval;
        const byTime = new Map();
        for (let i = 0; i < data.length; i++) {
            const c = data[i];
            if (!c || typeof c !== 'object') continue;
            const t = c.time;
            if (typeof t !== 'number' || !isFinite(t) || !Number.isInteger(t) || t <= 0) continue;
            const alignedT = this._alignTimeForInterval(t, interval);
            if (!Number.isInteger(alignedT) || alignedT <= 0) continue;
            let volume = (typeof c.quoteVolume === 'number') ? c.quoteVolume : Number(c.quoteVolume);
            if (!isFinite(volume) || volume < 0) {
                volume = (typeof c.volume === 'number') ? c.volume : Number(c.volume);
                if (!isFinite(volume) || volume < 0) volume = 0;
            }
            const o = typeof c.open === 'number' ? c.open : Number(c.open);
            const cl = typeof c.close === 'number' ? c.close : Number(c.close);
            const isBull = (isFinite(o) && isFinite(cl)) ? (cl >= o) : true;
            byTime.set(alignedT, { time: alignedT, value: volume, color: isBull ? bullishColor : bearishColor });
        }
        const sorted = Array.from(byTime.values()).sort((a, b) => a.time - b.time);
        if (data === this.chartData) {
            this._volumeDataCache = sorted;
            this._volumeDataDirty = false;
        }
        return sorted;
    }

    _updateVolumeOptimized() {
        if (!this.volumeSeries || !this.chartData.length || !this._isChartValid()) return;
        if (this._isSwitchingChartType) return;
        if (this._volumeDataDirty && this._lastVolumeUpdateIndex === this.chartData.length - 1) {
            const lastCandle = this.chartData[this.chartData.length - 1];
            const isBullish = lastCandle.close >= lastCandle.open;
            this._safeVolumeBarUpdate(this._alignTimeToInterval(lastCandle.time),
                lastCandle.quoteVolume || lastCandle.volume || 0,
                isBullish ? this.bullishColor : this.bearishColor);
            this._volumeDataDirty = false;
            return;
        }
        if (this._volumeDataDirty) {
            const vd = this._buildVolumeData(this.chartData);
            this.volumeSeries.setData(vd);
            this._volumeDataDirty = false;
            this._lastVolumeUpdateIndex = this.chartData.length - 1;
            this._applyVolumeScaleOptions();
        }
    }

    static _bybitIntervalMap() {
        if (!ChartManager.__bybitIntervalMap) {
            ChartManager.__bybitIntervalMap = {
                '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
                '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
                '1d': 'D', '1w': 'W', '1M': 'M'
            };
        }
        return ChartManager.__bybitIntervalMap;
    }

    async fetchKlines(symbol, exchange, marketType, interval, limit = 1000, endTime = null, requestType = 'user') {
        const res = await this._fetchKlinesResilient(symbol, exchange, marketType, interval, limit, endTime, requestType);
        return res ? res.candles : null;
    }

    async fetchKlinesDetailed(symbol, exchange, marketType, interval, limit = 1000, endTime = null, requestType = 'user') {
        return this._fetchKlinesResilient(symbol, exchange, marketType, interval, limit, endTime, requestType);
    }

    _klineHostsFor(exchange, marketType) {
        if (exchange === 'bybit') return KLINE_HOSTS.bybit;
        return marketType === 'futures' ? KLINE_HOSTS.binanceFutures : KLINE_HOSTS.binanceSpot;
    }

    _buildKlinesUrl(host, symbol, exchange, marketType, interval, limit, endTime) {
        if (exchange === 'binance') {
            const path = marketType === 'futures'
                ? `/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`
                : `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
            return host + path + (endTime ? `&endTime=${endTime}` : '');
        }
        const bybitInt = ChartManager._bybitIntervalMap()[interval] || interval;
        const cat = marketType === 'futures' ? 'linear' : 'spot';
        return `${host}/v5/market/kline?category=${cat}&symbol=${encodeURIComponent(symbol)}` +
               `&interval=${encodeURIComponent(bybitInt)}&limit=${limit}` + (endTime ? `&end=${endTime}` : '');
    }

    _normalizeKlinesRequest(symbol, exchange, marketType, interval) {
        let sym = String(symbol == null ? '' : symbol).trim().toUpperCase().replace(/[\s/\\:-]/g, '');
        const ex = String(exchange || 'binance').toLowerCase() === 'bybit' ? 'bybit' : 'binance';
        const mt = String(marketType || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
        if (ex === 'binance' && sym.endsWith('.P')) sym = sym.slice(0, -2);
        let iv = String(interval == null ? '' : interval).trim();
        if (!INTERVAL_SECONDS_MAP[iv]) {
            const key = `${iv}|${ex}`;
            if (!this._badIntervalsWarned.has(key)) {
                this._badIntervalsWarned.add(key);
                console.warn(`⚠️ [VP-KLINES] интервал "${iv}" не поддерживается — использую "1h" ` +
                    `(проверьте localStorage.lastTimeframe)`);
            }
            iv = '1h';
        }
        return { symbol: sym, exchange: ex, marketType: mt, interval: iv };
    }

    _acquireFetchController(requestType) {
        const slot = FETCH_CONTROLLER_SLOTS[requestType] || FETCH_CONTROLLER_SLOTS.user;
        if (this[slot]) { try { this[slot].abort(); } catch (e) {} }
        const controller = new AbortController();
        controller._vpSlot = slot;
        this[slot] = controller;
        return controller;
    }

    _releaseFetchController(controller) {
        const slot = controller && controller._vpSlot;
        if (slot && this[slot] === controller) this[slot] = null;
    }

    _abortAllFetchControllers() {
        for (const slot of Object.values(FETCH_CONTROLLER_SLOTS)) {
            if (this[slot]) { try { this[slot].abort(); } catch (e) {} this[slot] = null; }
        }
    }

    _nowSec() { return Math.floor((Date.now() + this._serverTimeOffsetMs) / 1000); }

    _calibrateServerTime(response, data, rttMs) {
        try {
            let serverMs = null;
            const dateHeader = response && response.headers && typeof response.headers.get === 'function'
                ? response.headers.get('date') : null;
            if (dateHeader) {
                const t = Date.parse(dateHeader);
                if (isFinite(t)) serverMs = t;
            }
            if (serverMs === null && data && typeof data.time === 'number' && data.time > 1e12) {
                serverMs = data.time;
            }
            if (serverMs === null || serverMs < 1e12) return null;
            const estimatedNow = Date.now() + Math.max(0, Math.round((rttMs || 0) / 2));
            const offset = serverMs - estimatedNow;
            if (!isFinite(offset)) return Math.floor(serverMs / 1000);
            const MAX_SKEW_MS = 12 * 60 * 60 * 1000;
            const clamped = Math.max(-MAX_SKEW_MS, Math.min(MAX_SKEW_MS, offset));
            if (Math.abs(offset) > 30000 && !this._clockSkewWarned) {
                this._clockSkewWarned = true;
                console.warn(`⚠️ [VP-CLOCK] часы устройства расходятся с биржей на ` +
                    `${Math.round(offset / 1000)} с — валидация свечей переведена на серверное время`);
            }
            this._serverTimeOffsetMs = clamped;
            return Math.floor(serverMs / 1000);
        } catch (e) { return null; }
    }

    async _fetchKlinesOnce(host, norm, limit, endTime, outerSignal, timeoutMs, requestType) {
        const url = this._buildKlinesUrl(host, norm.symbol, norm.exchange, norm.marketType, norm.interval, limit, endTime);
        const inner = new AbortController();
        let timedOut = false;
        const onOuterAbort = () => { try { inner.abort(); } catch (e) {} };
        if (outerSignal.aborted) onOuterAbort();
        else outerSignal.addEventListener('abort', onOuterAbort, { once: true });
        const timer = setTimeout(() => { timedOut = true; try { inner.abort(); } catch (e) {} }, timeoutMs);
        const startedAt = Date.now();
        const requestStartedAt = startedAt;
        try {
            const response = await fetch(url, { signal: inner.signal });
            const rttMs = Date.now() - startedAt;
            if (!response.ok) {
                let bodyText = '';
                try { bodyText = (await response.text()).slice(0, 300); } catch (e) {}
                let code = null;
                const m = /"code"\s*:\s*(-?\d+)/.exec(bodyText);
                if (m) code = parseInt(m[1], 10);
                if (requestType !== 'prefetch') {
                    console.warn(`⚠️ [VP-KLINES] ${norm.symbol} ${norm.interval} (${norm.exchange}/${norm.marketType}): ` +
                        `HTTP ${response.status} ${code !== null ? `(code ${code}) ` : ''}от ${host} — ${bodyText.slice(0, 120)}`);
                }
                const invalidSymbol = response.status === 400 && (code === -1121 || code === -1130 || code === -1122 || code === -1008);
                return {
                    candles: null,
                    reason: `HTTP ${response.status}${code !== null ? ` (code ${code})` : ''}`,
                    fatal: response.status === 403 || response.status === 418 || response.status === 451 ||
                           response.status === 404 || invalidSymbol,
                    missing: invalidSymbol || response.status === 404,
                    rawCount: 0
                };
            }
            let data;
            try { data = await response.json(); }
            catch (e) { return { candles: null, reason: 'ответ не JSON', fatal: false, missing: false, rawCount: 0 }; }
            const serverNowSec = this._calibrateServerTime(response, data, rttMs);
            const alignTime = (t) => this._alignTimeForInterval(t, norm.interval);
            let rawCandles;
            if (norm.exchange === 'binance') {
                if (!Array.isArray(data)) {
                    return { candles: null, reason: 'Binance: ожидался массив', fatal: false, missing: false, rawCount: 0 };
                }
                rawCandles = data.map(item => {
                    const volume = parseFloat(item[5]);
                    const quoteVolume = parseFloat(item[7]);
                    return {
                        time: alignTime(Math.floor(item[0] / 1000)),
                        open: parseFloat(item[1]), high: parseFloat(item[2]),
                        low: parseFloat(item[3]), close: parseFloat(item[4]),
                        volume, quoteVolume: (quoteVolume > 0) ? quoteVolume : volume
                    };
                });
            } else {
                if (data.retCode !== 0) {
                    const msg = String(data.retMsg || '');
                    const missing = data.retCode === 10001 && /symbol/i.test(msg);
                    return {
                        candles: null,
                        reason: `Bybit error ${data.retCode}: ${msg}`,
                        fatal: missing,
                        missing,
                        rawCount: 0
                    };
                }
                if (!data.result || !data.result.list) {
                    return { candles: null, reason: 'Bybit: неожиданный формат', fatal: false, missing: false, rawCount: 0 };
                }
                rawCandles = data.result.list.map(item => {
                    const volume = parseFloat(item[5] || 0);
                    const quoteVolume = parseFloat(item[6] || 0);
                    return {
                        time: alignTime(Math.floor(parseInt(item[0]) / 1000)),
                        open: parseFloat(item[1]), high: parseFloat(item[2]),
                        low: parseFloat(item[3]), close: parseFloat(item[4]),
                        volume, quoteVolume: (quoteVolume > 0) ? quoteVolume : volume
                    };
                }).filter(c => c.time > 0 && !isNaN(c.open)).reverse();
            }
            if (outerSignal.aborted) return { candles: null, reason: 'aborted', fatal: true, missing: false, rawCount: rawCandles.length };
            const rawCount = rawCandles.length;
            const dedupMap = new Map();
            for (const c of rawCandles) {
                if (!c || !isFinite(c.time)) continue;
                const aligned = alignTime(c.time);
                c.time = aligned;
                dedupMap.set(aligned, c);
            }
            const noDupes = Array.from(dedupMap.values());
            const batchNowSec = (typeof serverNowSec === 'number' && serverNowSec > 1e9)
                ? serverNowSec : this._nowSec();
            const validCandles = noDupes.filter(c => this._isValidCandle(c, batchNowSec));
            validCandles.sort((a, b) => a.time - b.time);
            const currentStart = this._alignTimeForInterval(batchNowSec, norm.interval);
            for (const c of validCandles) {
                this._stampCandle(c, 'rest', requestStartedAt);
                c._closed = c.time < currentStart;
            }
            if (rawCount > 0 && validCandles.length === 0) {
                const first = noDupes[0];
                console.warn(`⚠️ [VP-KLINES] ${norm.symbol} ${norm.interval}: биржа отдала ${rawCount} свечей, ` +
                    `но ни одна не прошла валидацию. Пример: time=${first && first.time} ` +
                    `(${first ? new Date(first.time * 1000).toISOString() : '—'}), now=${batchNowSec} ` +
                    `(${new Date(batchNowSec * 1000).toISOString()}), offset=${this._serverTimeOffsetMs}мс`);
            }
            return { candles: validCandles, reason: null, fatal: false, missing: false, rawCount };
        } catch (error) {
            if (outerSignal.aborted) return { candles: null, reason: 'aborted', fatal: true, missing: false, rawCount: 0 };
            if (timedOut) {
                return { candles: null, reason: `таймаут ${Math.round(timeoutMs / 1000)} с`, fatal: false, missing: false, rawCount: 0 };
            }
            const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
            return {
                candles: null,
                reason: offline ? 'нет соединения' : (error && error.message ? error.message : String(error)),
                fatal: offline,
                missing: false,
                rawCount: 0
            };
        } finally {
            clearTimeout(timer);
            try { outerSignal.removeEventListener('abort', onOuterAbort); } catch (e) {}
        }
    }

    async _fetchKlinesResilient(symbol, exchange, marketType, interval, limit = 1000, endTime = null, requestType = 'user') {
        const norm = this._normalizeKlinesRequest(symbol, exchange, marketType, interval);
        if (!norm.symbol) {
            this._lastKlinesFailure = { reason: 'пустой символ', attempts: 0, host: null };
            return { candles: null, reason: 'пустой символ', error: 'пустой символ', attempts: 0, norm, missing: false };
        }
        const hosts = this._klineHostsFor(norm.exchange, norm.marketType);
        const maxAttempts = Math.max(1, Math.min(this._klinesMaxAttempts, hosts.length + 1));
        const controller = this._acquireFetchController(requestType);
        const signal = controller.signal;
        const errors = [];
        let attempts = 0;
        let missing = false;
        try {
            for (let i = 0; i < maxAttempts; i++) {
                if (signal.aborted || this._destroyed) break;
                attempts++;
                const host = hosts[i % hosts.length];
                const timeoutMs = i === 0 ? this._fetchTimeoutMs : this._klinesRetryTimeoutMs;
                this._switchProgress();
                const res = await this._fetchKlinesOnce(host, norm, limit, endTime, signal, timeoutMs, requestType);
                this._switchProgress();
                if (res.candles) {
                    this._lastKlinesFailure = null;
                    return {
                        candles: res.candles, reason: null, error: null, attempts,
                        host, norm, missing: false, rawCount: res.rawCount
                    };
                }
                if (res.missing) missing = true;
                if (res.reason === 'aborted') break;
                errors.push(`${host.replace(/^https?:\/\//, '')}: ${res.reason}`);
                if (res.fatal || i === maxAttempts - 1) break;
                await new Promise(r => setTimeout(r, this._klinesRetryDelayMs * (i + 1)));
            }
        } finally {
            this._releaseFetchController(controller);
        }
        if (signal.aborted) {
            return { candles: null, reason: 'aborted', error: null, attempts, host: null, norm, missing, aborted: true };
        }
        const reason = errors.length ? errors.join(' | ') : 'нет ответа';
        this._lastKlinesFailure = { reason, attempts, host: hosts[0], symbol: norm.symbol, at: Date.now() };
        if (requestType !== 'prefetch') {
            console.warn(`⚠️ [VP-KLINES] ${norm.symbol} ${norm.interval} (${norm.exchange}/${norm.marketType}) — ` +
                `данные не получены за ${attempts} попыт. Причина: ${reason}`);
        }
        return { candles: null, reason, error: reason, attempts, host: hosts[0], norm, missing };
    }

    async _loadCandlesResilient(symbol, exchange, marketType, interval, limit, opts = {}) {
        const requestType = opts.requestType || 'switch';
        const allowFallbacks = opts.allowFallbacks !== false;
        const errors = [];
        const isAlive = () => !this._destroyed;

        const finish = (candles, extra) => Object.assign({
            candles: candles && candles.length ? candles : null,
            fromCache: false, stale: false, alt: null,
            requested: { symbol, exchange, marketType },
            reason: null, errors, networkMissing: false
        }, extra || {});

        if (opts.allowCache !== false) {
            this._switchProgress();
            const cached = await this.loadCandlesFromCache(symbol, exchange, marketType, interval);
            this._switchProgress();
            if (cached && cached.length && isAlive()) {
                return finish(cached, { fromCache: true });
            }
        }

        const tried = new Set([`${symbol}|${exchange}|${marketType}`]);
        let networkMissing = false;
        let net = await this._fetchKlinesResilient(symbol, exchange, marketType, interval, limit, null, requestType);
        if (net && net.candles && net.candles.length && isAlive()) return finish(net.candles, {});
        if (net) {
            if (net.aborted) return finish(null, { reason: 'aborted' });
            if (net.error) errors.push(`${exchange}/${marketType} — ${net.error}`);
            if (net.missing) networkMissing = true;
        }
        if (!isAlive()) return finish(null, { reason: 'destroyed' });

        if (allowFallbacks && networkMissing) {
            const candidates = [
                { exchange, marketType: marketType === 'futures' ? 'spot' : 'futures' },
                { exchange: exchange === 'binance' ? 'bybit' : 'binance', marketType },
                { exchange: exchange === 'binance' ? 'bybit' : 'binance',
                  marketType: marketType === 'futures' ? 'spot' : 'futures' }
            ];
            for (const cand of candidates) {
                if (this._destroyed) return finish(null, { reason: 'destroyed' });
                const key = `${symbol}|${cand.exchange}|${cand.marketType}`;
                if (tried.has(key)) continue;
                tried.add(key);
                this._switchProgress();
                const res = await this._fetchKlinesResilient(
                    symbol, cand.exchange, cand.marketType, interval, limit, null, requestType
                );
                if (!isAlive()) return finish(null, { reason: 'destroyed' });
                if (res && res.aborted) return finish(null, { reason: 'aborted' });
                if (res && res.candles && res.candles.length) {
                    console.warn(`↪ [VP-LOAD] ${symbol} нет на ${exchange}/${marketType}, ` +
                        `но данные есть на ${cand.exchange}/${cand.marketType} — переключаемся туда`);
                    return finish(res.candles, {
                        alt: { symbol, exchange: cand.exchange, marketType: cand.marketType }
                    });
                }
                if (res && res.error) errors.push(`${cand.exchange}/${cand.marketType} — ${res.error}`);
            }
        }

        if (allowFallbacks && opts.allowStale !== false) {
            this._switchProgress();
            const stale = await this.loadCandlesFromCache(
                symbol, exchange, marketType, interval, this._staleCacheMaxAgeMs
            );
            if (stale && stale.length && isAlive()) {
                console.warn(`⚠️ [VP-LOAD] сеть не ответила — показываю кэш ${stale.length} свечей ` +
                    `(возраст ${this._staleCacheAgeText(stale)}), досинхронизация в фоне`);
                return finish(stale, { fromCache: true, stale: true });
            }
            const hist = await this._getStaleHistoryCandles(symbol, exchange, marketType, interval);
            if (hist && hist.length && isAlive()) {
                console.warn(`⚠️ [VP-LOAD] сеть не ответила — показываю ${hist.length} свечей из кэша истории`);
                return finish(hist, { fromCache: true, stale: true });
            }
        }

        return finish(null, {
            reason: this._describeLoadFailure(symbol, exchange, marketType, interval, errors, networkMissing),
            errors, networkMissing
        });
    }

    _staleCacheAgeText(candles) {
        try {
            const last = candles[candles.length - 1];
            const ageSec = Math.max(0, this._nowSec() - (last ? last.time : 0));
            if (ageSec < 3600) return `${Math.round(ageSec / 60)} мин`;
            if (ageSec < 86400) return `${Math.round(ageSec / 3600)} ч`;
            return `${Math.round(ageSec / 86400)} дн`;
        } catch (e) { return '—'; }
    }

    async _getStaleHistoryCandles(symbol, exchange, marketType, interval) {
        if (!window.db) return null;
        try {
            await this._waitForDb();
            const rows = await window.db.getByIndex('candles', 'symbol', symbol);
            if (!Array.isArray(rows) || rows.length === 0) return null;
            const byTime = new Map();
            for (const r of rows) {
                if (!r || r.type !== 'hist' || r.interval !== interval) continue;
                if (r.exchange !== exchange || r.marketType !== marketType) continue;
                if (!Array.isArray(r.data)) continue;
                for (const c of r.data) {
                    if (!c || typeof c.time !== 'number') continue;
                    byTime.set(c.time, c);
                }
            }
            if (byTime.size === 0) return null;
            const nowSec = this._nowSec();
            const currentStart = this._alignTimeForInterval(nowSec, interval);
            const out = [];
            for (const c of byTime.values()) {
                const cc = {
                    time: this._alignTimeForInterval(c.time, interval),
                    open: c.open, high: c.high, low: c.low, close: c.close,
                    volume: c.volume,
                    quoteVolume: (typeof c.quoteVolume === 'number' && c.quoteVolume > 0) ? c.quoteVolume : c.volume
                };
                if (!this._isValidCandle(cc, nowSec)) continue;
                this._stampCandle(cc, 'cache', Date.now());
                cc._closed = cc.time < currentStart;
                out.push(cc);
            }
            if (out.length === 0) return null;
            out.sort((a, b) => a.time - b.time);
            return out;
        } catch (e) { return null; }
    }

    _describeLoadFailure(symbol, exchange, marketType, interval, errors, networkMissing) {
        const where = `${exchange}/${marketType}`;
        if (networkMissing) {
            return `${symbol} не торгуется на ${where} (биржа ответила «неверный символ»), ` +
                `а соседние рынки данных не дали`;
        }
        const last = (errors && errors.length) ? errors[errors.length - 1] : null;
        const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
        if (offline) return 'нет соединения с интернетом';
        if (last && /HTTP 429|HTTP 418/.test(last)) {
            return `биржа ограничила частоту запросов (${last}) — повторите через несколько секунд`;
        }
        if (last && /HTTP 451|HTTP 403/.test(last)) {
            return `биржа заблокировала запрос из вашего региона (${last})`;
        }
        if (last && /таймаут/.test(last)) return `биржа не ответила вовремя (${last})`;
        if (last) return last;
        return `${where}: данных нет`;
    }

    _notifyUser({ title, text, color = '#f23645', duration = 6000, retry = null }) {
        try {
            const box = document.getElementById('alertNotification');
            if (!box) return;
            if (this._notifyUserTimer) { clearTimeout(this._notifyUserTimer); this._notifyUserTimer = null; }
            const esc = (v) => String(v == null ? '' : v)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            box.innerHTML =
                `<div class="alert-title">${esc(title)}</div>` +
                `<div class="alert-price">${esc(text)}</div>` +
                (retry ? `<div class="alert-repeat" id="vpNotifyRetry" style="cursor:pointer;color:#4fc3f7;text-decoration:underline">Повторить</div>` : '');
            box.style.display = 'block';
            box.style.borderLeftColor = color;
            if (retry) {
                const btn = box.querySelector('#vpNotifyRetry');
                if (btn) btn.onclick = () => {
                    box.style.display = 'none';
                    try { retry(); } catch (e) {}
                };
            }
            this._notifyUserTimer = setTimeout(() => {
                box.style.display = 'none';
                this._notifyUserTimer = null;
            }, duration);
        } catch (e) {}
    }

    _revertSymbolUi(symbol, exchange, marketType) {
        try {
            const panel = window.tickerPanelInstance || window.tickerPanel;
            if (panel && typeof panel.setCurrentSymbolSilently === 'function') {
                panel.setCurrentSymbolSilently(symbol, exchange, marketType);
            } else if (panel && panel.state) {
                panel.state.currentSymbol = symbol;
                panel.state.currentExchange = exchange;
                panel.state.currentMarketType = marketType;
                if (typeof panel.saveCurrentSymbol === 'function') {
                    try { panel.saveCurrentSymbol(symbol, exchange, marketType); } catch (e) {}
                }
                try {
                    document.querySelectorAll('.ticker-item.active').forEach(el => el.classList.remove('active'));
                    const sel = `.ticker-item[data-symbol="${symbol}"][data-exchange="${exchange}"][data-market-type="${marketType}"]`;
                    const el = document.querySelector(sel);
                    if (el) el.classList.add('active');
                } catch (e) {}
            }
            const pairDisplay = document.getElementById('pairDisplay');
            if (pairDisplay) pairDisplay.textContent = symbol;
            const exchangeDisplay = document.getElementById('exchangeDisplay');
            if (exchangeDisplay) exchangeDisplay.textContent = exchange === 'binance' ? 'Binance' : 'Bybit';
            const contractTypeDisplay = document.getElementById('contractTypeDisplay');
            if (contractTypeDisplay) contractTypeDisplay.textContent = marketType === 'futures' ? 'PERP' : 'SPOT';
            if (window.timeframeManager && typeof window.timeframeManager.updateInstrumentInfo === 'function') {
                try { window.timeframeManager.updateInstrumentInfo(); } catch (e) {}
            }
        } catch (e) {}
    }

    onStreamUnavailable(info) {
        try {
            if (this._destroyed || !info) return;
            if (info.symbol && this.currentSymbol && info.symbol !== this.currentSymbol) return;
            const reason = info.reason === 'symbol-not-found'
                ? 'тикер не найден на бирже'
                : 'поток данных не отвечает';
            console.warn(`⚠️ [VP-WS] ${info.symbol || this.currentSymbol}: ${reason}`);
            this._notifyUser({
                title: '⚠️ Поток данных',
                text: `${info.symbol || this.currentSymbol}: ${reason}`,
                color: '#ffa500',
                duration: 7000
            });
        } catch (e) {}
    }

    _scheduleTitleUpdate() {
        if (this._destroyed) return;
        if (this._titleUpdateTimeout !== null) return;
        const wait = Math.max(0, this._titleUpdateIntervalMs - (Date.now() - this._lastTitleUpdateAt));
        this._titleUpdateTimeout = setTimeout(() => {
            this._titleUpdateTimeout = null;
            this._lastTitleUpdateAt = Date.now();
            if (!this._destroyed) this._updatePageTitle();
        }, wait);
    }

    _getTitlePrecision() {
        if (typeof this._titlePrecision === 'number' && this._titlePrecision >= 0) return this._titlePrecision;
        try {
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            const p = series?.options()?.priceFormat?.precision;
            if (typeof p === 'number' && p >= 0) { this._titlePrecision = p; return p; }
        } catch (e) {}
        return 2;
    }

    _updatePageTitle() {
        const symbol = this.currentSymbol || '';
        let price = this.currentRealPrice;
        if (!price || isNaN(price) || price <= 0) price = this.lastCandle?.close;
        if (!price || isNaN(price) || price <= 0) price = this.chartData?.[this.chartData.length - 1]?.close;
        if (!symbol) { document.title = 'График'; return; }
        if (price != null && !isNaN(price) && price > 0) {
            const precision = this._getTitlePrecision();
            const lastCandle = this.chartData?.[this.chartData.length - 1];
            const isBullish = lastCandle ? lastCandle.close >= lastCandle.open : true;
            const arrow = isBullish ? '▲' : '▼';
            const newTitle = `${arrow} ${symbol} ${price.toFixed(precision)}`;
            if (this._lastTitle !== newTitle) { this._lastTitle = newTitle; document.title = newTitle; }
        } else {
            const fallbackTitle = `${symbol} —`;
            if (this._lastTitle !== fallbackTitle) { this._lastTitle = fallbackTitle; document.title = fallbackTitle; }
        }
    }

    updateColorsForSettings(bullishColor, bearishColor) {
        if (!this._isChartValid()) return;
        if (typeof CONFIG !== 'undefined') {
            if (!CONFIG.colors) CONFIG.colors = {};
            CONFIG.colors.bullish = bullishColor;
            CONFIG.colors.bearish = bearishColor;
        }
        this.bullishColor = bullishColor;
        this.bearishColor = bearishColor;
        this.candleSeries.applyOptions({
            upColor: bullishColor, downColor: bearishColor,
            wickUpColor: bullishColor, wickDownColor: bearishColor
        });
        this.barSeries.applyOptions({ upColor: bullishColor, downColor: bearishColor });
        this._syncLineAndTimerColor();
        this._volumeDataDirty = true;
        if (this.volumeSeries && this.chartData.length > 0) this._updateVolumeOptimized();
        this._notifyColorChange();
    }

    _syncLineAndTimerColor() {
        if (!this._isChartValid() || !this.chartData || this.chartData.length === 0) return;
        const lastCandle = this.chartData[this.chartData.length - 1];
        if (!lastCandle) return;
        const price = lastCandle.close;
        if (!price || isNaN(price)) return;
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (series) this._applyPriceLineColor(series, this._getLineColor());
        if (this.timerManager) this.timerManager.forceColorUpdate();
    }

    _abortAllProcesses() {
        if (this._bgTitleInterval) { clearInterval(this._bgTitleInterval); this._bgTitleInterval = null; }
        if (this._titleUpdateTimeout) { clearTimeout(this._titleUpdateTimeout); this._titleUpdateTimeout = null; }
        if (this._periodicSyncInterval) { clearInterval(this._periodicSyncInterval); this._periodicSyncInterval = null; }
        if (this._quarantineTimeout) { clearTimeout(this._quarantineTimeout); this._quarantineTimeout = null; }
        if (this.priceManager && this._priceUpdateHandler && this._priceSubscriptionKey) {
            this.priceManager.unsubscribe(this._priceSubscriptionKey, this._priceUpdateHandler);
            this._priceUpdateHandler = null;
            this._priceSubscriptionKey = null;
        }
        if (this.timerManager) this.timerManager.stop();
        this._loadingSymbol = false;
        this._drawingScrollLock = false;
        this.isLoadingMore = false;
        this._updateScheduled = false;
        this._pendingUpdates = false;
        this._pendingRedraw = false;
        if (this._updatePositionRafId) { cancelAnimationFrame(this._updatePositionRafId); this._updatePositionRafId = null; }
        if (this._priceUpdateRafId) { cancelAnimationFrame(this._priceUpdateRafId); this._priceUpdateRafId = null; }
        if (this._priceGateTimeout !== null) { clearTimeout(this._priceGateTimeout); this._priceGateTimeout = null; }
        this._lastPriceGateAt = 0;
        this._pendingPriceValue = null;
        this._pendingPriceUpdate = null;
        this._abortAllFetchControllers();
        this._historyPrefetchRunning = false;
        if (this._historyThrottleRetry) { clearTimeout(this._historyThrottleRetry); this._historyThrottleRetry = null; }
        if (this._updateTimeout) { clearTimeout(this._updateTimeout); this._updateTimeout = null; }
        if (this._crosshairIdleTimeout) { clearTimeout(this._crosshairIdleTimeout); this._crosshairIdleTimeout = null; }
        this._crosshairActive = false;
        if (this._trimDebounceTimeout) { clearTimeout(this._trimDebounceTimeout); this._trimDebounceTimeout = null; }
        if (this._candleCheckerTimeout) { clearTimeout(this._candleCheckerTimeout); this._candleCheckerTimeout = null; }
        this._fetchPromise = null;
        this._volumeDataDirty = true;
        this._lastVolumeUpdateIndex = -1;
        this._isTrimming = false;
        this._pendingTrimParams = null;
    }

    destroy() {
        this._destroyed = true;
        this._clearSwitchWatchdog();
        if (this._bgTitleInterval) { clearInterval(this._bgTitleInterval); this._bgTitleInterval = null; }
        if (this._periodicSyncInterval) { clearInterval(this._periodicSyncInterval); this._periodicSyncInterval = null; }
        if (this._quarantineTimeout) { clearTimeout(this._quarantineTimeout); this._quarantineTimeout = null; }
        if (this._titleUpdateTimeout) { clearTimeout(this._titleUpdateTimeout); this._titleUpdateTimeout = null; }
        if (this._indicatorsUpdateTimeout) { clearTimeout(this._indicatorsUpdateTimeout); this._indicatorsUpdateTimeout = null; }
        this._abortAllProcesses();
        if (window._dailySeparator && typeof window._dailySeparator.destroy === 'function') { window._dailySeparator.destroy(); window._dailySeparator = null; }
        if (window._sessionHighlighter && typeof window._sessionHighlighter.destroy === 'function') { window._sessionHighlighter.destroy(); window._sessionHighlighter = null; }
        if (this._candleCheckerTimeout) clearTimeout(this._candleCheckerTimeout);
        if (this._trimDebounceTimeout) clearTimeout(this._trimDebounceTimeout);
        if (this._scrollStopTimeout) clearTimeout(this._scrollStopTimeout);
        if (this._priceUpdateRafId) { cancelAnimationFrame(this._priceUpdateRafId); this._priceUpdateRafId = null; }
        if (this._crosshairRafId) { cancelAnimationFrame(this._crosshairRafId); this._crosshairRafId = null; }
        if (this._panelsSyncRafId) { cancelAnimationFrame(this._panelsSyncRafId); this._panelsSyncRafId = null; }
        if (this._autoScrollTimeout) { clearTimeout(this._autoScrollTimeout); this._autoScrollTimeout = null; }
        if (this._globalMouseUpHandler) window.removeEventListener('mouseup', this._globalMouseUpHandler, true);
        if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
        if (this._blurHandler) window.removeEventListener('blur', this._blurHandler);
        if (this._mouseLeaveHandler && this.chartContainer) this.chartContainer.removeEventListener('mouseleave', this._mouseLeaveHandler);
        if (this._wheelHandler && this.chartContainer) this.chartContainer.removeEventListener('wheel', this._wheelHandler);
        document.removeEventListener('visibilitychange', this._visibilityHandler);
        if (this._resizeObserver) this._resizeObserver.disconnect();
        if (this._chartContainerResizeObserver) this._chartContainerResizeObserver.disconnect();
        if (this._containerResizeTimeout) clearTimeout(this._containerResizeTimeout);
        if (this._verticalZoomTimeout) clearTimeout(this._verticalZoomTimeout);
        if (this._chartTypeSwitchTimeout) clearTimeout(this._chartTypeSwitchTimeout);
        if (this.timerManager && typeof this.timerManager.destroy === 'function') this.timerManager.destroy();
        if (this.chart) { this.chart.remove(); this.chart = null; }
        if (this._symbolSwitchOverlay && this._symbolSwitchOverlay.parentNode) this._symbolSwitchOverlay.parentNode.removeChild(this._symbolSwitchOverlay);
        this._symbolSwitchOverlay = null;
        this.chartData = [];
        this._candleTimeMap.clear();
        this._formatCache.clear();
        this._symbolChangeCallbacks = [];
        this._colorChangeCallbacks = [];
    }

    saveCurrentTimePosition() {
        if (!this._isChartValid() || !this.chartData.length) return null;
        const ts = this.chart.timeScale();
        const vr = ts.getVisibleLogicalRange();
        if (vr) {
            const i = Math.floor(vr.from);
            if (i >= 0 && i < this.chartData.length) return this.chartData[i].time;
        }
        return null;
    }

    scrollToTime(time) {
        if (!this._isChartValid() || !time) return;
        const ts = this.chart.timeScale();
        const cr = ts.getVisibleLogicalRange();
        if (!cr) return;
        const ti = this.chartData.findIndex(c => c.time >= time);
        if (ti !== -1) {
            const vb = cr.to - cr.from;
            ts.setVisibleLogicalRange({ from: Math.max(0, ti - 10), to: Math.max(0, ti - 10) + vb });
        } else this.scrollToLast();
    }

    getCurrentSymbolKey() { return `${this.currentSymbol}:${this.currentExchange}:${this.currentMarketType}`; }

    updatePricePrecision(symbol, exchange, marketType) {
        const cachedPrecision = this._getCachedPrecision(symbol, exchange, marketType);
        if (cachedPrecision) { this.applyPriceFormat(parseInt(cachedPrecision, 10)); return; }
        this.applyPriceFormat(this._inferPrecisionFromData());
        if (typeof getPrecisionFromExchange === 'function') {
            getPrecisionFromExchange(symbol, exchange, marketType).then(precision => {
                if (!this._applyResolvedPrecision(symbol, exchange, marketType, precision)) return;
                this.applyPriceFormat(Math.floor(Number(precision)));
                if (!this._switchingSymbol && !this._isSwitchingInterval) this._relockPriceScaleWidth();
            }).catch(() => {});
        }
    }

    forceRedraw() {
        if (!this._isChartValid() || !this.chartData.length) return;
        if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
        try { this.chart.timeScale().applyOptions({}); } catch (e) {}
    }

    _subscribeToSymbolChange(cb) { this._symbolChangeCallbacks = this._symbolChangeCallbacks || []; this._symbolChangeCallbacks.push(cb); }
    _notifySymbolChange() { if (this._symbolChangeCallbacks) this._symbolChangeCallbacks.forEach(cb => cb()); }

    findNearestCandleTime(anchor) {
        const data = this.chartData;
        if (!data || data.length === 0) return null;
        const a = Number(anchor);
        if (!isFinite(a)) return null;
        const len = data.length;
        const first = data[0].time;
        const last = data[len - 1].time;
        const gen = this._nearestTimeCacheGen;
        if (!gen || gen.len !== len || gen.first !== first || gen.last !== last) {
            this._nearestTimeCache.clear();
            this._nearestTimeCacheGen = { len, first, last };
        } else {
            const hit = this._nearestTimeCache.get(a);
            if (hit !== undefined) return hit;
        }
        let result;
        if (a <= first) result = first;
        else if (a >= last) result = last;
        else {
            let lo = 0, hi = len - 1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                const t = data[mid].time;
                if (t === a) { result = t; lo = -1; break; }
                if (t < a) lo = mid + 1; else hi = mid - 1;
            }
            if (lo !== -1) {
                const tl = data[hi] ? data[hi].time : first;
                const tr = data[lo] ? data[lo].time : last;
                result = (Math.abs(tl - a) <= Math.abs(tr - a)) ? tl : tr;
            }
        }
        if (this._nearestTimeCache.size < this._nearestTimeCacheMax) this._nearestTimeCache.set(a, result);
        return result;
    }

    findCandleFloorTime(anchor) {
        const data = this.chartData;
        if (!data || data.length === 0) return null;
        const a = Number(anchor);
        if (!isFinite(a)) return null;
        const len = data.length;
        const first = data[0].time;
        const last = data[len - 1].time;
        const interval = len >= 2 ? (data[1].time - first) : 0;
        const gen = this._nearestTimeCacheGen;
        const cacheOk = gen && gen.len === len && gen.first === first && gen.last === last;
        if (!cacheOk) {
            this._nearestTimeCache.clear();
            this._nearestTimeCacheGen = { len, first, last };
        } else {
            const key = 'f' + a;
            const hit = this._nearestTimeCache.get(key);
            if (hit !== undefined) return hit;
        }
        let result;
        if (a < first) {
            result = this.findNearestCandleTime(a);
        } else if (a >= last) {
            result = (interval > 0 && a < last + interval) ? last : this.findNearestCandleTime(a);
        } else {
            let lo = 0, hi = len - 1, idx = 0;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (data[mid].time <= a) { idx = mid; lo = mid + 1; } else { hi = mid - 1; }
            }
            const t = data[idx].time;
            result = (interval > 0 && a < t + interval) ? t : this.findNearestCandleTime(a);
        }
        if (this._nearestTimeCache.size < this._nearestTimeCacheMax) this._nearestTimeCache.set('f' + a, result);
        return result;
    }

    findNearestCandleIndex(anchor) {
        const data = this.chartData;
        if (!data || data.length === 0) return -1;
        const a = Number(anchor);
        if (!isFinite(a)) return -1;
        const len = data.length;
        if (a <= data[0].time) return 0;
        if (a >= data[len - 1].time) return len - 1;
        const cachedIdx = this._candleTimeMap ? this._candleTimeMap.get(a) : undefined;
        if (cachedIdx !== undefined) return cachedIdx;
        let lo = 0, hi = len - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const t = data[mid].time;
            if (t === a) return mid;
            if (t < a) lo = mid + 1; else hi = mid - 1;
        }
        const il = Math.max(0, hi), ir = Math.min(len - 1, lo);
        return (Math.abs(data[il].time - a) <= Math.abs(data[ir].time - a)) ? il : ir;
    }

    findNearestCandle(anchor) {
        const i = this.findNearestCandleIndex(anchor);
        return i >= 0 ? this.chartData[i] : null;
    }

    getDrawingPrecision() {
        const key = `${this.currentSymbol}|${this.currentExchange}|${this.currentMarketType}|${this.currentChartType}`;
        if (this._drawingPrecisionKey === key && typeof this._drawingPrecisionValue === 'number') {
            return this._drawingPrecisionValue;
        }
        let p = NaN;
        try { p = this._getTitlePrecision(); } catch (e) {}
        if (typeof p !== 'number' || !isFinite(p)) {
            const raw = this._getCachedPrecision(this.currentSymbol, this.currentExchange, this.currentMarketType);
            p = parseInt(raw, 10);
        }
        if (typeof p !== 'number' || !isFinite(p) || p < 0) {
            try { p = this._inferPrecisionFromData(); } catch (e) { p = 2; }
        }
        p = Math.max(0, Math.min(8, Math.floor(p)));
        this._drawingPrecisionKey = key;
        this._drawingPrecisionValue = p;
        return p;
    }

    timeToCoordinate(time) { if (!this._isChartValid()) return null; try { return this.chart.timeScale().timeToCoordinate(time); } catch (e) { return null; } }
    coordinateToTime(coordinate) { if (!this._isChartValid()) return null; try { return this.chart.timeScale().coordinateToTime(coordinate); } catch (e) { return null; } }

    priceToCoordinate(price) {
        if (!this._isChartValid()) return null;
        try { const s = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries; return s.priceToCoordinate(price); }
        catch (e) { return null; }
    }

    timeToCoordinateWithFallback(time) {
        let coord = this.timeToCoordinate(time);
        if (coord !== null) return coord;
        const data = this.chartData;
        if (!data || !data.length) return null;
        const firstCandle = data[0], lastCandle = data[data.length - 1];
        const firstX = this.timeToCoordinate(firstCandle.time);
        const lastX = this.timeToCoordinate(lastCandle.time);
        if (firstX === null || lastX === null) return null;
        const pxPerMs = (lastX - firstX) / (lastCandle.time - firstCandle.time);
        if (time < firstCandle.time) return firstX - (firstCandle.time - time) * pxPerMs;
        return lastX + (time - lastCandle.time) * pxPerMs;
    }

    priceToCoordinateWithFallback(price) { return this.priceToCoordinate(price); }

    timeToLogical(time) {
        if (!this.chartData || !this.chartData.length) return null;
        const index = this._candleTimeMap.get(time);
        return index !== undefined ? index : null;
    }

    coordinateToPrice(coordinate) {
        if (!this._isChartValid()) return null;
        try { const s = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries; return s.coordinateToPrice(coordinate); }
        catch (e) { return null; }
    }

    onVisibleLogicalRangeChange(range) {
        if (!range || !this.chartData.length || !this._isChartValid()) return;
        if (this._historyNeededNow(range)) { this._lastHistoryCheckAt = performance.now(); this._loadHistoryAsync(); }
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
        if (this._isScrolling || this._isScrollingFast) return;
        if (this._pendingTrimParams && !this._isTrimming) {
            const { fromIndex, toIndex } = this._pendingTrimParams;
            this._performTrimNow(fromIndex, toIndex);
            this._pendingTrimParams = null;
        }
    }

    _performTrimNow(fromIndex, toIndex) {
        if (this._isTrimming || this.isLoadingMore || !this._isChartValid()) return;
        if (this._isScrolling || this._isScrollingFast) return;
        if (this.chartData.length <= this._maxCandlesInMemory) return;
        const keepFrom = Math.max(0, Math.floor(fromIndex - (this._leftBuffer * 1.5)));
        if (keepFrom === 0) return;
        const leftTrim = keepFrom, rightTrim = 0;
        this._isTrimming = true;
        try {
            this.chartData = this.chartData.slice(keepFrom);
            this._rebuildTimeMap();
            this._nearestTimeCacheGen = null;
            this._volumeDataDirty = true;
            this._lastVolumeUpdateIndex = -1;
            const ts = this.chart.timeScale();
            const cr = ts.getVisibleLogicalRange();
            const ps = this.chart.priceScale('right');
            if (ps) ps.applyOptions({ autoScale: false });
            const lwBars = this._toLwBarsArray(this.chartData);
            this._setVisibleSeriesData(lwBars);
            this._updateVolumeOptimized();
            this._applyVolumeScaleOptions();
            if (cr && leftTrim > 0) ts.setVisibleLogicalRange({
                from: Math.max(0, cr.from - leftTrim), to: Math.max(1, cr.to - leftTrim)
            });
            if (leftTrim > 0 || rightTrim > 0) requestAnimationFrame(() => {
                if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
            });
            this.lastCandle = this.chartData[this.chartData.length - 1];
            this._syncLineColor();
            if (this.timerManager?._primitive?.isEnabled()) this.timerManager._primitive.requestRedraw();
        } catch (e) {} finally { this._isTrimming = false; }
    }

    _historyBatchFor(interval) {
        if (this.currentExchange === 'binance' && this.currentMarketType === 'futures') return 1500;
        return this._batchSize || 1000;
    }

    _preloadThresholdFor(range) {
        const visible = (range && isFinite(range.from) && isFinite(range.to)) ? Math.max(10, Math.ceil(range.to - range.from)) : 200;
        return Math.max(this._preloadThreshold, Math.min(visible, 1500));
    }

    _historyNeededNow(range) {
        if (!this.hasMoreData || this.isLoadingMore) return false;
        if (!this._isChartValid()) return false;
        if (this._destroyed || this._switchingSymbol || this._isSwitchingInterval || this._updatesSuspended) return false;
        if (!this.chartData || this.chartData.length === 0) return false;
        if (!range || !isFinite(range.from)) return false;
        if (range.from >= 0 && range.to <= 0) return false;
        return range.from < this._preloadThresholdFor(range);
    }

    _checkHistoryPreloadLive(range) {
        if (!this._historyNeededNow(range)) return;
        const now = performance.now();
        if (now - this._lastHistoryCheckAt < this._historyCheckThrottleMs) return;
        this._lastHistoryCheckAt = now;
        if (this._isScrolling || this._isScrollingFast) { this._warmHistoryCache(); return; }
        this._loadHistoryAsync();
    }

    _warmHistoryCache() {
        if (!this.hasMoreData || this.isLoadingMore) return;
        if (this._prefetchFetchController) return;
        if (!this.chartData || this.chartData.length === 0) return;
        const genId = this._activeGeneration;
        const interval = this.currentInterval;
        const symbol = this.currentSymbol;
        const cut = this.chartData[0].time;
        const batchSize = this._historyBatchFor(interval);
        this.fetchKlines(symbol, this.currentExchange, this.currentMarketType, interval, batchSize, (cut * 1000) - 1, 'prefetch')
            .then(page => {
                if (!page || page.length === 0) return;
                if (this._activeGeneration !== genId || this.currentInterval !== interval || this.currentSymbol !== symbol) return;
                if (this.chartData.length === 0 || this.chartData[0].time !== cut) return;
                return this._saveHistoryPageToCache(symbol, this.currentExchange, this.currentMarketType, interval, cut, page);
            })
            .catch(() => {});
    }

    async _loadHistoryAsync() {
        if (this.isLoadingMore || !this.hasMoreData || !this._isChartValid()) return;
        const now = Date.now();
        if (now - this._lastHistoryLoadTime < 1200) {
            if (!this._historyThrottleRetry) {
                this._historyThrottleRetry = setTimeout(() => {
                    this._historyThrottleRetry = null;
                    this._lastHistoryCheckAt = 0;
                    const r = this._lastVisibleRange || this.chart?.timeScale()?.getVisibleLogicalRange?.();
                    if (this._historyNeededNow(r)) this._loadHistoryAsync();
                }, 1200 - (now - this._lastHistoryLoadTime) + 30);
            }
            return;
        }
        this.isLoadingMore = true;
        this._lastHistoryLoadTime = now;
        const genId = this._activeGeneration;
        const interval = this.currentInterval;
        const batchSize = this._historyBatchFor(interval);
        try {
            if (!this.chartData.length) { this.hasMoreData = false; return; }
            const oldestCandle = this.chartData[0];
            if (!oldestCandle) { this.hasMoreData = false; return; }
            let page = await this._loadHistoryPageFromCache(
                this.currentSymbol, this.currentExchange, this.currentMarketType, interval, oldestCandle.time
            );
            let fromNetwork = false;
            if (!page || page.length === 0) {
                page = await this.fetchKlines(
                    this.currentSymbol, this.currentExchange, this.currentMarketType,
                    interval, batchSize, (oldestCandle.time * 1000) - 1, 'history'
                );
                if (page === null) return;
                fromNetwork = true;
                if (page.length > 0) {
                    this._saveHistoryPageToCache(
                        this.currentSymbol, this.currentExchange, this.currentMarketType, interval, oldestCandle.time, page
                    ).catch(() => {});
                }
            }
            if (this._activeGeneration !== genId || this.currentInterval !== interval) return;
            const applied = this._applyHistoryPage(page, batchSize, genId, interval, fromNetwork);
            if (applied === true) {
                this._chainPrefetch(genId, interval, 1);
            } else if (applied === false) {
                return;
            }
        } catch (e) { this.hasMoreData = false; }
        finally { this.isLoadingMore = false; }
    }

    _applyHistoryPage(page, batchSize, genId, interval, fromNetwork) {
        if (this._activeGeneration !== genId || this.currentInterval !== interval) return false;
        if (!this._isChartValid() || !this.chartData || this.chartData.length === 0) return false;
        if (!page || page.length === 0) { this.hasMoreData = false; return null; }
        const oldestExistingTime = this.chartData[0].time;
        const uniqueOlder = page.filter(c => c.time < oldestExistingTime);
        if (fromNetwork && page.length < batchSize) this.hasMoreData = false;
        if (uniqueOlder.length === 0) { this.hasMoreData = false; return null; }
        const ts = this.chart.timeScale();
        const cr = ts.getVisibleLogicalRange();
        const addedCount = uniqueOlder.length;
        let combined = [...uniqueOlder, ...this.chartData];
        let trimmedFromFront = 0;
        if (combined.length > this._maxCandlesInMemory) {
            const needed = combined.length - this._maxCandlesInMemory;
            const visibleFrom = (cr && isFinite(cr.from)) ? Math.max(0, Math.floor(cr.from)) : combined.length;
            const newVisibleFrom = visibleFrom + addedCount;
            const safeToTrim = Math.max(0, newVisibleFrom - this._leftBuffer);
            trimmedFromFront = Math.min(needed, safeToTrim);
            if (combined.length - trimmedFromFront > this._hardMaxCandles) {
                trimmedFromFront = combined.length - this._hardMaxCandles;
            }
            if (visibleFrom < this._leftBuffer && addedCount - trimmedFromFront <= 0) {
                this.hasMoreData = false;
                return null;
            }
            if (trimmedFromFront > 0) combined = combined.slice(trimmedFromFront);
        }
        this.chartData = combined;
        this._rebuildTimeMap();
        this.lastCandle = this.chartData[this.chartData.length - 1];
        this._volumeDataDirty = true;
        this._lastVolumeUpdateIndex = -1;
        const ps = this.chart.priceScale('right');
        if (ps) ps.applyOptions({ autoScale: false });
        const lwBars = this._toLwBarsArray(this.chartData);
        this._setVisibleSeriesData(lwBars);
        this._updateVolumeOptimized();
        this._applyVolumeScaleOptions();
        const netShift = addedCount - trimmedFromFront;
        if (cr && netShift !== 0) ts.setVisibleLogicalRange({ from: cr.from + netShift, to: cr.to + netShift });
        requestAnimationFrame(() => {
            if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
        });
        if (this.timerManager?._primitive?.isEnabled()) this.timerManager._primitive.requestRedraw();
        return true;
    }

    _chainPrefetch(genId, interval, pagesDone) {
        if (this._destroyed) return;
        if (this._activeGeneration !== genId || this.currentInterval !== interval) return;
        if (!this.hasMoreData || this.isLoadingMore) return;
        if (pagesDone >= this._historyPrefetchMaxPages) return;
        const r = this._lastVisibleRange || this.chart?.timeScale()?.getVisibleLogicalRange?.();
        if (!r || !isFinite(r.from)) return;
        if (r.from >= this._preloadThresholdFor(r)) return;
        setTimeout(() => {
            if (this._destroyed) return;
            if (this._activeGeneration !== genId || this.currentInterval !== interval) return;
            if (!this.hasMoreData || this.isLoadingMore) return;
            if (this._isTrimming || this._isScrolling || this._isScrollingFast) {
                this._chainPrefetch(genId, interval, Math.max(0, pagesDone - 1));
                return;
            }
            this._loadHistoryAsync().then(() => {
                if (this._activeGeneration === genId && this.currentInterval === interval && this.hasMoreData) {
                    this._chainPrefetch(genId, interval, pagesDone + 1);
                }
            }).catch(() => {});
        }, this._prefetchPageDelayMs);
    }

    _scheduleDeepPrefetch() {
        const genId = this._activeGeneration;
        const interval = this.currentInterval;
        const symbol = this.currentSymbol;
        const startedAt = Date.now();
        const tick = () => {
            if (this._destroyed) return;
            if (this._activeGeneration !== genId || this.currentInterval !== interval || this.currentSymbol !== symbol) return;
            if (!this._isChartValid() || !this.chartData.length || !this.hasMoreData) return;
            if (Date.now() - startedAt > 20000) return;
            const ov = this._symbolSwitchOverlay;
            if (ov && ov.style && ov.style.opacity && parseFloat(ov.style.opacity) > 0.05) {
                setTimeout(tick, 300); return;
            }
            if (this._isScrolling || this._isScrollingFast || this._isTrimming) { setTimeout(tick, 400); return; }
            const r = this.chart?.timeScale()?.getVisibleLogicalRange?.();
            if (r && isFinite(r.from) && r.from < this._preloadThresholdFor(r)) return;
            if (this._historyPrefetchRunning) return;
            this._historyPrefetchRunning = true;
            const done = () => { this._historyPrefetchRunning = false; };
            this._loadHistoryAsync()
                .then(() => this._chainPrefetch(genId, interval, 1))
                .catch(() => {})
                .finally(done);
        };
        setTimeout(tick, this._prefetchIdleDelayMs);
    }

    _historyCacheKey(symbol, exchange, marketType, interval, cutTime) {
        return `HIST_v1_${symbol}_${interval}_${exchange}_${marketType}_${cutTime}`;
    }

    async _loadHistoryPageFromCache(symbol, exchange, marketType, interval, oldestTime) {
        if (!window.db) return null;
        try {
            await this._waitForDb();
            const exact = await window.db.get('candles', this._historyCacheKey(symbol, exchange, marketType, interval, oldestTime));
            let rec = null;
            if (exact && Array.isArray(exact.data) && exact.data.length > 0) {
                rec = exact;
            } else {
                const rows = await window.db.getByIndex('candles', 'symbol', symbol);
                if (Array.isArray(rows) && rows.length) {
                    let best = null;
                    for (const r of rows) {
                        if (!r || r.type !== 'hist' || r.interval !== interval) continue;
                        if (r.exchange !== exchange || r.marketType !== marketType) continue;
                        if (typeof r.cut !== 'number' || r.cut < oldestTime) continue;
                        if (!Array.isArray(r.data) || r.data.length === 0) continue;
                        if (!best || r.cut < best.cut) best = r;
                    }
                    rec = best;
                }
            }
            if (!rec) return null;
            if (Date.now() - (rec.lastUpdate || 0) > this._historyCacheTtlMs) {
                try { await window.db.delete('candles', rec.key); } catch (e) {}
                return null;
            }
            const nowSec = Math.floor(Date.now() / 1000);
            const currentStart = this._alignTimeForInterval(nowSec, interval);
            const out = [];
            for (const c of rec.data) {
                if (!c || typeof c !== 'object') continue;
                if (typeof c.time !== 'number' || !Number.isInteger(c.time) || c.time <= 0) continue;
                if (c.time >= oldestTime) continue;
                const cc = {
                    time: this._alignTimeForInterval(c.time, interval),
                    open: c.open, high: c.high, low: c.low, close: c.close,
                    volume: c.volume, quoteVolume: (typeof c.quoteVolume === 'number' && c.quoteVolume > 0) ? c.quoteVolume : c.volume
                };
                if (!this._isValidCandle(cc, nowSec)) continue;
                this._stampCandle(cc, 'cache', rec.lastUpdate || Date.now());
                cc._closed = cc.time < currentStart;
                out.push(cc);
            }
            if (out.length === 0) return null;
            out.sort((a, b) => a.time - b.time);
            return out;
        } catch (e) { return null; }
    }

    async _saveHistoryPageToCache(symbol, exchange, marketType, interval, cutTime, candles) {
        if (!window.db || !Array.isArray(candles) || candles.length === 0) return;
        try {
            await this._waitForDb();
            const clean = [];
            for (const c of candles) {
                if (!c || typeof c !== 'object') continue;
                if (typeof c.time !== 'number' || !Number.isInteger(c.time) || c.time <= 0) continue;
                if (typeof c.open !== 'number' || typeof c.high !== 'number' ||
                    typeof c.low !== 'number' || typeof c.close !== 'number') continue;
                clean.push({
                    time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
                    volume: (typeof c.volume === 'number' ? c.volume : 0),
                    quoteVolume: (typeof c.quoteVolume === 'number' ? c.quoteVolume : 0)
                });
            }
            if (clean.length === 0) return;
            await window.db.put('candles', {
                key: this._historyCacheKey(symbol, exchange, marketType, interval, cutTime),
                type: 'hist',
                symbol, exchange, marketType, interval,
                cut: cutTime,
                firstCandleTime: clean[0].time,
                lastCandleTime: clean[clean.length - 1].time,
                count: clean.length,
                data: clean,
                lastUpdate: Date.now(),
                version: '3'
            });
        } catch (e) {}
    }

    async refreshCandlesInBackground(symbol, exchange, marketType, interval) {
        const genId = this._activeGeneration;
        try {
            if (symbol !== this.currentSymbol || exchange !== this.currentExchange || !this._isChartValid()) return;
            const freshCandles = await this.fetchKlines(symbol, exchange, marketType, interval, 100, null, 'background');
            if (!freshCandles || freshCandles.length === 0 || !this._isChartValid()) return;
            if (symbol !== this.currentSymbol || this._activeGeneration !== genId || this.currentInterval !== interval) return;
            if (!this.chartData.length) return;
            const lastCachedTime = this.chartData[this.chartData.length - 1].time;
            let matchLast = false, tailChanged = false;
            for (const fc of freshCandles) {
                if (fc.time > lastCachedTime) continue;
                const idx = this._candleTimeMap.get(fc.time);
                const ex = (idx !== undefined) ? this.chartData[idx] : null;
                if (!ex) continue;
                if (!this._isFresherUpdate(ex, fc._receivedAt, fc._source)) continue;
                if (ex._closed === true && fc._closed !== true) continue;
                if (ex.open === fc.open && ex.high === fc.high && ex.low === fc.low &&
                    ex.close === fc.close && ex.volume === fc.volume) continue;
                ex.open = fc.open; ex.high = fc.high; ex.low = fc.low; ex.close = fc.close;
                ex.volume = fc.volume; ex.quoteVolume = fc.quoteVolume || fc.volume;
                this._stampCandle(ex, fc._source, fc._receivedAt);
                ex._isPlaceholder = false;
                if (typeof fc._closed === 'boolean') ex._closed = fc._closed;
                if (fc.time === lastCachedTime) matchLast = true; else tailChanged = true;
            }
            if (matchLast) {
                const lc = this.chartData[this.chartData.length - 1];
                this._updateVisibleSeries({ time: lc.time, open: lc.open, high: lc.high, low: lc.low, close: lc.close });
                this._safeVolumeBarUpdate(lc.time, lc.quoteVolume || lc.volume || 0,
                    lc.close >= lc.open ? this.bullishColor : this.bearishColor);
            }
            let newCandles = freshCandles.filter(c => c.time > lastCachedTime);
            if (newCandles.length > 0) {
                const expectedFirst = lastCachedTime ? this._getNextIntervalTime(lastCachedTime) : newCandles[0].time;
                let holeDetected = false;
                if (newCandles[0].time === expectedFirst) {
                    const contiguous = [];
                    let cursor = lastCachedTime;
                    for (const c of newCandles) {
                        const exp = cursor ? this._getNextIntervalTime(cursor) : c.time;
                        if (c.time !== exp) { holeDetected = true; break; }
                        contiguous.push(c);
                        cursor = c.time;
                    }
                    newCandles = contiguous;
                } else holeDetected = true;
                for (const c of newCandles) c._isPlaceholder = false;
                if (newCandles.length > 0) {
                    const prevLast = this.chartData[this.chartData.length - 1];
                    if (prevLast && prevLast._closed !== true) prevLast._closed = true;
                    this.chartData.push(...newCandles);
                    this._rebuildTimeMap();
                    if (!holeDetected && !tailChanged) this._applyAppendOnly(newCandles);
                    else this._applyDataAtomically();
                }
                if (holeDetected) { this._lastGapHealAttempt = 0; this._healDataGaps().catch(() => {}); }
            } else if (tailChanged) {
                this._applyDataAtomically();
            }
            if (matchLast || tailChanged || newCandles.length > 0) {
                this.lastCandle = this.chartData[this.chartData.length - 1];
                this._syncLineColor();
                if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
            }
            if (newCandles.length > 0) this.autoScale();
        } catch (error) {}
    }

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
        const CACHE_VERSION = '3';
        const key = `${symbol}_${interval}_${exchange}_${marketType}_v${CACHE_VERSION}`;
        const byTime = new Map();
        for (const c of candles) {
            if (!c || typeof c !== 'object') continue;
            if (typeof c.time !== 'number' || !isFinite(c.time) || !Number.isInteger(c.time) || c.time <= 0) continue;
            if (typeof c.open !== 'number' || !isFinite(c.open) || c.open <= 0) continue;
            if (typeof c.high !== 'number' || !isFinite(c.high) || c.high <= 0) continue;
            if (typeof c.low !== 'number' || !isFinite(c.low) || c.low <= 0) continue;
            if (typeof c.close !== 'number' || !isFinite(c.close) || c.close <= 0) continue;
            const aligned = this._alignTimeForInterval(c.time, interval);
            if (!Number.isInteger(aligned) || aligned <= 0) continue;
            byTime.set(aligned, { ...c, time: aligned });
        }
        let cleanCandles = Array.from(byTime.values()).sort((a, b) => a.time - b.time);
        try {
            const cut = this._alignTimeForInterval(this._nowSec(), interval);
            while (cleanCandles.length > 1 && cleanCandles[cleanCandles.length - 1].time >= cut) cleanCandles.pop();
        } catch (e) {}
        if (cleanCandles.length === 0) return;
        const cacheData = {
            key, symbol, exchange, marketType, interval,
            data: cleanCandles,
            lastUpdate: Date.now(),
            firstCandleTime: cleanCandles[0].time,
            lastCandleTime: cleanCandles[cleanCandles.length - 1].time,
            count: cleanCandles.length,
            version: CACHE_VERSION
        };
        if (!window.db) return;
        try { await this._waitForDb(); await window.db.put('candles', cacheData); } catch (error) {}
    }

    async loadCandlesFromCache(symbol, exchange, marketType, interval, maxAgeMs = 5 * 60 * 1000) {
        const CACHE_VERSION = '3';
        const key = `${symbol}_${interval}_${exchange}_${marketType}_v${CACHE_VERSION}`;
        if (!window.db) return null;
        try {
            await this._waitForDb();
            const cached = await window.db.get('candles', key);
            if (!cached) return null;
            if (cached.version !== CACHE_VERSION) { await window.db.delete('candles', key); return null; }
            if (Date.now() - cached.lastUpdate > maxAgeMs) return null;
            if (!Array.isArray(cached.data)) return null;
            const byTime = new Map();
            for (const c of cached.data) {
                if (!c || typeof c !== 'object') continue;
                if (typeof c.time !== 'number' || !isFinite(c.time) || !Number.isInteger(c.time) || c.time <= 0) continue;
                if (typeof c.open !== 'number' || !isFinite(c.open) || c.open <= 0) continue;
                if (typeof c.high !== 'number' || !isFinite(c.high) || c.high <= 0) continue;
                if (typeof c.low !== 'number' || !isFinite(c.low) || c.low <= 0) continue;
                if (typeof c.close !== 'number' || !isFinite(c.close) || c.close <= 0) continue;
                const aligned = this._alignTimeForInterval(c.time, interval);
                if (!Number.isInteger(aligned) || aligned <= 0) continue;
                byTime.set(aligned, { ...c, time: aligned });
            }
            if (byTime.size === 0) { await window.db.delete('candles', key); return null; }
            const valid = Array.from(byTime.values()).sort((a, b) => a.time - b.time);
            try {
                const cutAtSave = this._alignTimeForInterval(
                    Math.floor((cached.lastUpdate || Date.now()) / 1000), interval);
                while (valid.length > 1 && valid[valid.length - 1].time >= cutAtSave) valid.pop();
            } catch (e) {}
            if (valid.length === 0) { await window.db.delete('candles', key); return null; }
            for (const c of valid) this._stampCandle(c, 'cache', cached.lastUpdate);
            return valid;
        } catch (error) { return null; }
    }

    async clearOldCaches() {
        const CACHE_VERSION = '3';
        try {
            if (!window.db) return;
            const allCandles = await window.db.getAll('candles');
            for (const cache of allCandles) {
                if (!cache.version || cache.version !== CACHE_VERSION) await window.db.delete('candles', cache.key);
            }
        } catch (e) {}
    }

    async clearOldCandlesCache(maxAge = 24 * 60 * 60 * 1000) {
        try {
            if (!window.db) return;
            const allCandles = await window.db.getAll('candles');
            const now = Date.now();
            for (const cached of allCandles) {
                if (now - cached.lastUpdated > maxAge) await window.db.delete('candles', cached.key);
            }
        } catch (error) {}
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

    manualAutoScale() { this.autoScale(); }
}

if (typeof window !== 'undefined') {
    window.ChartManager = ChartManager;
}
