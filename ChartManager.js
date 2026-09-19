const SOURCE_PRIORITY = { 'ws': 3, 'rest': 2, 'cache': 1 };

const INTERVAL_SECONDS_MAP = {
    '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200,
    '1d': 86400, '1w': 604800, '1M': 2592000
};

// [FIX] Intl.DateTimeFormat создаётся один раз. Раньше toLocaleString/toLocaleTimeString
// с опциями создавали новый форматтер на КАЖДЫЙ вызов (для каждой метки оси при каждом сдвиге
// графика и при каждом движении курсора) — это главный источник тормозов при скролле.
const FMT_TICK_DAY = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
const FMT_TICK_TIME = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
const FMT_CROSSHAIR = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
});

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

        const savedChartType = localStorage.getItem('chartType') || 'candle';
        this.currentChartType = savedChartType;
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
        this._drawingsUpdateRafId = null;
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
        this._updateTimeout = null;
        this._autoScalePending = false;
        this._isVerticalZooming = false;
        this._crosshairRafId = null;
        this._latestCrosshairData = null;
        this._pendingCrosshairParam = null;
        this._drawingsRafId = null;
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
        this._candleTimeMap = new Map();
        this._destroyed = false;
        this._lastSeriesResyncAt = 0;
        this._healingGaps = false;
        this._lastGapHealAttempt = 0;
        this._unhealableGaps = new Set();

        this._autoScrollEnabled = false;
        this._autoScrollTimeout = null;

        // [FIX] Скрытая серия (bar/candle) больше не держит копию данных.
        // Она пустая, а при переключении типа графика заполняется в setChartType.
        this._invisibleSeriesDirty = true;
        this._isScrolling = false;
        this._isScrollingFast = false;
        this._lastDrawingsCall = 0;
        this._drawingsFinalUpdateTimeout = null;
        this._scrollStopTimeout = null;
        this._lastScrollTime = 0;
        this._panelsSyncRafId = null;
        this._lastVisibleRange = null;
        this._isViewingHistory = false;
        this._historyLoadQueue = [];
        this._preloadThreshold = 400;
        // [FIX] Было 500: меньше подгрузок истории при скролле влево.
        this._batchSize = 1000;
        this._minLoadDelay = 1000;
        this._lastHistoryLoadTime = 0;
        this._pendingHistoryLoad = false;
        this._historyEndTime = null;
        this._fetchPromise = null;

        this._cachedPrecisionKey = null;
        this._cachedPrecisionValue = null;
        this._lastInferredPrecision = null;

        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        // [FIX] Меньше данных в памяти -> быстрее setData/индикаторы при подгрузке истории.
        // Буферы подобраны так, чтобы (left+right)*1.5 + видимая область помещались в лимит,
        // иначе _performTrimNow ничего не обрезает.
        this._maxCandlesInMemory = isMobile ? 3000 : 5000;
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
        this._fetchTimeoutMs = 15000;

        this._visibilityHandler = () => {
            if (!document.hidden) {
                if (!this._isChartValid()) {
                    setTimeout(() => {
                        if (this._isChartValid()) this.refreshCandlesAfterTabHidden();
                    }, 100);
                    return;
                }

                if (window.wsManager) window.wsManager.forceReconnect?.();

                this.refreshCandlesAfterTabHidden();
                this.scheduleDrawingsUpdate(true);
                this.requestDrawingsRedraw();

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
                } catch (e) {
                    this._savedLogicalRange = null;
                }

                this._startBackgroundTitleUpdate();
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

        this.chart = LightweightCharts.createChart(container, {
            layout: { background: { color: '#000000' }, textColor: '#808080', attributionLogo: false },
            grid: { vertLines: { visible: false }, horzLines: { visible: false } },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
            handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
            animation: { duration: 0 },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: '#333333',
                barSpacing: this._savedBarSpacing || 25,
                minBarSpacing: 1,
                fixLeftEdge: false,
                fixRightEdge: false,
                rightOffset: 15,
                shiftVisibleRangeOnNewBar: true,
                // [FIX] заранее созданные Intl-форматтеры вместо toLocale*String с опциями
                tickMarkFormatter: (time) => {
                    const iv = this.currentInterval;
                    return (iv === '1d' || iv === '1w' || iv === '1M')
                        ? FMT_TICK_DAY.format(time * 1000)
                        : FMT_TICK_TIME.format(time * 1000);
                }
            },
            rightPriceScale: {
                borderColor: '#333333',
                borderVisible: true,
                scaleMargins: { top: 0.1, bottom: 0.25 },
                // [FIX] автомасштаб включён с самого начала: ширина оси считается
                // библиотекой по реальным подписям уже на первом кадре с данными.
                autoScale: true,
                entireTextOnly: false,
            },
            localization: {
                timeFormatter: (time) => FMT_CROSSHAIR.format(time * 1000)
            }
        });

        if (typeof this.chart.addPriceScale === 'function') {
            this.chart.addPriceScale({
                id: 'volume',
                scaleMargins: { top: 0.8, bottom: 0 },
                borderColor: '#333333',
                borderVisible: true,
                autoScale: true,
                visible: true
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

    // =============== AUTOSCROLL ===============
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

    // =============== RIGHT EDGE ===============
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
        let width = 0;
        try { width = ts.width() || 0; } catch (e) {}
        if (!width || width < 50) {
            const ps = this.chart.priceScale('right');
            let psW = 0;
            try { psW = ps?.width?.() || 0; } catch (e) {}
            width = Math.max(50, (this.chartContainer.clientWidth || 800) - psW - 8);
        }
        const visibleBars = width / barSpacing;
        const to = lastIndex + rightOffset;
        const from = to - visibleBars;
        try { ts.applyOptions({ barSpacing, rightOffset }); } catch (e) {}
        try { ts.setVisibleLogicalRange({ from, to }); } catch (e) {}
    }

    // =============== PRICE SCALE WIDTH ===============
    // [FIX] Ширина оси цен больше не оценивается формулой (макс. цена * 2, 7px на символ) —
    // она ИЗМЕРЯЕТСЯ: библиотека сама считает ширину по реальным подписям при включённом
    // автомасштабе, мы читаем priceScale.width() и фиксируем её как minimumWidth.
    // Так ось не «прыгает» и не остаётся лишнего зазора.
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

    // Для случаев, когда формат подписей изменился уже после отрисовки
    // (например, пришла точность с биржи и она отличается от выведенной).
    _relockPriceScaleWidth() {
        if (!this._isChartValid()) return;
        this._resetPriceScaleWidth();
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (this._switchingSymbol || this._isSwitchingInterval) return;
            this._lockPriceScaleWidth();
        }));
    }

    // =============== LW-NULL GUARDS ===============
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
        const byTime = new Map();
        for (let i = 0; i < arr.length; i++) {
            const c = arr[i];
            if (!c || typeof c !== 'object') continue;
            const rawT = c.time;
            if (typeof rawT !== 'number' || !isFinite(rawT) || !Number.isInteger(rawT) || rawT <= 0) continue;
            const alignedT = this._alignTimeForInterval(rawT, interval);
            if (!Number.isInteger(alignedT) || alignedT <= 0) continue;
            const b = this._toLwBar({ ...c, time: alignedT });
            if (!b) continue;
            byTime.set(alignedT, b);
        }
        return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
    }

    // [FIX] Единая точка записи данных в серии: заполняется ТОЛЬКО видимая серия.
    // Скрытая очищается (чтобы её старые точки не влияли на шкалу времени)
    // и получит данные при переключении типа графика в setChartType.
    _setVisibleSeriesData(lwBars, clearHidden = false) {
        const visible = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        const hidden = this.currentChartType === 'candle' ? this.barSeries : this.candleSeries;
        if (visible) {
            try { visible.setData(lwBars); }
            catch (e) {
                try { visible.setData([]); } catch (e2) {}
                try { visible.setData(lwBars); } catch (e3) {}
            }
        }
        if (clearHidden && hidden) { try { hidden.setData([]); } catch (e) {} }
        this._invisibleSeriesDirty = true;
    }

    // =============== COLORS / VOLUME ===============
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

    // =============== VALIDITY ===============
    _isChartValid() {
        return this.chart && this.candleSeries && this.barSeries && this.chartContainer && document.contains(this.chartContainer);
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
            series.update(safe);
        } catch (e) { try { this._resyncSeriesFromData(); } catch (e2) {} }
    }

    _resyncSeriesFromData() {
        try {
            if (!this._isChartValid() || !this.chartData || this.chartData.length === 0) return;
            const now = Date.now();
            if (this._lastSeriesResyncAt && now - this._lastSeriesResyncAt < 250) return;
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

        // [FIX] только видимая серия
        const lwBars = this._toLwBarsArray(this.chartData);
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
            // [FIX] update только в видимую серию
            try { series.update(point); } catch (e) { failed = true; break; }
            if (this.volumeSeries) {
                this._safeVolumeBarUpdate(point.time, c.quoteVolume || c.volume || 0,
                    point.close >= point.open ? this.bullishColor : this.bearishColor);
            }
        }

        if (failed) {
            try { series.setData([]); } catch (e) {}
            this._resyncSeriesFromData();
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
        try { this.volumeSeries.update({ time: t, value: v, color }); }
        catch (e) {
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
    onWebSocketConnected() { this._syncRecentCandles().catch(() => {}); }

    _safeElement(id) {
        const el = document.getElementById(id);
        if (el) return el;
        return {
            classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
            textContent: '', className: '', style: {}
        };
    }

    // =============== TIME MAP ===============
    _rebuildTimeMap() {
        this._candleTimeMap.clear();
        for (let i = 0; i < this.chartData.length; i++) this._candleTimeMap.set(this.chartData[i].time, i);
    }
    _addToTimeMap(time, index) { this._candleTimeMap.set(time, index); }

    // =============== FRESHNESS ===============
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

    // =============== LINE COLOR ===============
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

    // =============== INTERVAL BOUNDS ===============
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
            const monday = new Date(Date.UTC(
                now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday, 0, 0, 0, 0
            ));
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

    // =============== BACKGROUND TITLE / PERIODIC SYNC ===============
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

            if (needsFullRedraw) this._applyDataAtomically();
            else if (touchedMidCandles.length > 0) {
                for (const cur of touchedMidCandles) {
                    this._updateVisibleSeries({ time: cur.time, open: cur.open, high: cur.high, low: cur.low, close: cur.close });
                }
                this._invisibleSeriesDirty = true;
                this._volumeDataDirty = true;
            } else if (pushedMissing.length > 0) {
                this._applyAppendOnly(pushedMissing);
            }

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
            if (dataChanged) { this.requestDrawingsRedraw(); this.scheduleDrawingsUpdate(true); }
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

    // =============== NEW CANDLE CHECKER ===============
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

    // =============== HEAL GAPS ===============
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
            this.requestDrawingsRedraw();

            setTimeout(() => {
                if (this._destroyed) return;
                this._lastGapHealAttempt = 0;
                this._healDataGaps().catch(() => {});
            }, 500);
        } catch (e) { console.warn('⚠️ Ошибка заполнения дыр:', e); }
        finally { this._healingGaps = false; }
    }

    _setupPanelsSync() {}

    // =============== SUBSCRIPTIONS ===============
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
            const barSpacing = this.chart.timeScale().options().barSpacing;
            if (barSpacing) this._pendingBarSpacing = barSpacing;
            clearTimeout(this._scrollStopTimeout);
            this._pendingDrawingsRedraw = true;

            this._scrollStopTimeout = setTimeout(() => {
                this._isScrolling = false;
                this._isScrollingFast = false;
                if (this._pendingBarSpacing && this._pendingBarSpacing !== this._lastSavedBarSpacing) {
                    this._lastSavedBarSpacing = this._pendingBarSpacing;
                    this._savedBarSpacing = this._pendingBarSpacing;
                    localStorage.setItem('chartBarSpacing', this._pendingBarSpacing);
                }
                this._applyPendingTrim();
                this.onVisibleLogicalRangeChange(this._lastVisibleRange);
                if (this._pendingDrawingsRedraw) {
                    this._pendingDrawingsRedraw = false;
                    this.requestDrawingsRedraw();
                }
            }, 150);

            if (this.timerManager?._primitive?.isEnabled()) this.timerManager._primitive.requestRedraw();

            if (range && this.indicatorManager?.panelManager && !this._isSyncing) {
                const panels = this.indicatorManager.panelManager.panels;
                if (panels && panels.length > 0 && !this._panelsSyncRafId) {
                    this._panelsSyncRafId = requestAnimationFrame(() => {
                        this._isSyncing = true;
                        panels.forEach((panel) => {
                            if (panel.chart && !panel.isCollapsed) {
                                try { panel.chart.timeScale().setVisibleLogicalRange(range); } catch (e) {}
                            }
                        });
                        this._isSyncing = false;
                        this._panelsSyncRafId = null;
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
                this.scheduleDrawingsUpdate(true);
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

    // =============== CHART TYPE ===============
    setChartType(type) {
        if (!this._isChartValid()) return;
        this._isSwitchingChartType = true;
        if (this._chartTypeSwitchTimeout) { clearTimeout(this._chartTypeSwitchTimeout); this._chartTypeSwitchTimeout = null; }

        const previousType = this.currentChartType;
        this.currentChartType = type;
        localStorage.setItem('chartType', type);

        // [FIX] Скрытая серия пустая, поэтому при смене типа её всегда нужно заполнить.
        // А серию, которая стала скрытой, очищаем.
        const switched = previousType !== type;
        if (type === 'candle') {
            if (switched && this.candleSeries && this.chartData.length) {
                try { this.candleSeries.setData(this._toLwBarsArray(this.chartData)); } catch (e) {}
            }
            if (this.candleSeries) this.candleSeries.applyOptions({ visible: true });
            if (this.barSeries) this.barSeries.applyOptions({ visible: false });
            if (switched && this.barSeries) { try { this.barSeries.setData([]); } catch (e) {} }
        } else if (type === 'bar') {
            if (switched && this.barSeries && this.chartData.length) {
                try { this.barSeries.setData(this._toLwBarsArray(this.chartData)); } catch (e) {}
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

    // =============== SCHEDULED UPDATE ===============
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

    // [FIX] Точность запрашивается ПАРАЛЛЕЛЬНО с загрузкой свечей и кладётся в кэш до
    // setDataQuick. Тогда первый кадр сразу рисуется с правильным числом знаков,
    // подписи оси не меняют формат (и ширину) после отрисовки.
    // Ожидание ограничено 1 секундой, чтобы не задерживать открытие графика.
    _prefetchPrecision(symbol, exchange, marketType) {
        if (this._getCachedPrecision(symbol, exchange, marketType)) return Promise.resolve();
        if (typeof getPrecisionFromExchange !== 'function') return Promise.resolve();
        let timer;
        const timeout = new Promise(r => { timer = setTimeout(r, 1000); });
        const request = Promise.resolve(getPrecisionFromExchange(symbol, exchange, marketType))
            .then(p => {
                const n = Number(p);
                if (isFinite(n) && n >= 0) this._setCachedPrecision(symbol, exchange, marketType, n);
            })
            .catch(() => {});
        return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
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

        if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
        const lastCandle = this.chartData[this.chartData.length - 1];
        // getCurrentPrice() уже возвращает currentRealPrice как fallback,
        // так что `?? this.currentRealPrice` здесь — мёртвая ветка.
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

    // =============== PRICE LINE (TICKS) ===============
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
            this._stampCandle(lastCandle, 'ws', Date.now());
            this.currentRealPrice = price;
            this.lastCandle = lastCandle;
            this._updateVisibleSeries({ time: lastCandle.time, open: lastCandle.open, high: lastCandle.high, low: lastCandle.low, close: lastCandle.close });
            this._safeVolumeBarUpdate(lastCandle.time, lastCandle.quoteVolume || lastCandle.volume || 0,
                lastCandle.close >= lastCandle.open ? this.bullishColor : this.bearishColor);
            this._volumeDataDirty = true;
            this._lastVolumeUpdateIndex = this.chartData.length - 1;
            this._applyPriceLineColor(activeSeries, this._getLineColor());
            this._updatePageTitle();
            if (!document.hidden) this.scheduleUpdatePosition();
            this.requestDrawingsRedraw();
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
            this._updatePageTitle();
            if (this.timerManager) this.timerManager.updatePrice(price);
            return;
        }

        this.currentRealPrice = price;
        this._applyPriceLineColor(activeSeries, this._getLineColor());
        this._updatePageTitle();
        if (this.timerManager) this.timerManager.updatePrice(price);
    }

    // =============== WS KLINE ===============
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

    // =============== WAIT / CURRENT CANDLE ===============
    async waitForChartReady() {
        await new Promise(resolve => {
            const check = () => {
                if (!this._isChartValid()) { requestAnimationFrame(check); return; }
                const ts = this.chart?.timeScale();
                if (ts && ts.getVisibleRange()) resolve();
                else requestAnimationFrame(check);
            };
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

    // =============== SET DATA ===============
    setDataQuick(data, interval, symbol, exchange = 'binance', marketType = 'futures', forceNewSymbol = false, onReady = null) {
        try {
            if (!this._isChartValid()) { if (onReady) onReady(); return; }
            if (!data || data.length === 0) { if (onReady) onReady(); return; }

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
                this._disableAutoScroll();
                if (onReady) onReady();
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
                this._disableAutoScroll();
                if (onReady) onReady();
                return;
            }

            // [FIX] Перед setData: автомасштаб включён и старая фиксированная ширина сброшена.
            // Библиотека посчитает ширину оси по реальным подписям нового символа/таймфрейма;
            // в finalizeAfterRescale мы её измерим и зафиксируем.
            try {
                const ps0 = this.chart.priceScale('right');
                if (ps0) ps0.applyOptions({ autoScale: true, minimumWidth: 0 });
            } catch (e) {}

            // [FIX] Данные пишутся только в видимую серию, скрытая очищается.
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

            const positionAfterDataApplied = () => {
                if (!this._isChartValid()) { this._disableAutoScroll(); if (onReady) onReady(); return; }

                this._scrollToRightEdgeWithOffset();

                const finalizeAfterRescale = () => {
                    if (this._isChartValid()) {
                        const ps = this.chart.priceScale('right');
                        if (ps) {
                            // [FIX] ширину измеряем, пока автомасштаб ещё включён, и только потом его выключаем
                            this._lockPriceScaleWidth();
                            try { ps.applyOptions({ autoScale: false }); } catch (e) {}
                        }
                        this._applyVolumeScaleOptions();
                    }
                    if (this.timerManager && this._isChartValid() && this.lastCandle) {
                        this.timerManager.start(this.currentInterval);
                        this.timerManager.updatePrice(this.lastCandle.close);
                    }
                    this._disableAutoScroll();
                    if (onReady) onReady();
                };

                const priceScale = this.chart.priceScale('right');
                if (priceScale) {
                    priceScale.applyOptions({ autoScale: true });
                    requestAnimationFrame(() => requestAnimationFrame(finalizeAfterRescale));
                } else finalizeAfterRescale();
            };

            requestAnimationFrame(() => requestAnimationFrame(positionAfterDataApplied));

            this.scheduleUpdatePosition();
            this._updatePageTitle();

            if (typeof getPrecisionFromExchange === 'function') {
                getPrecisionFromExchange(symbol, exchange, marketType).then(precision => {
                    if (this.currentSymbol === symbol && this._isChartValid()) {
                        const changed = this._lastAppliedPrecision !== String(precision);
                        this._setCachedPrecision(symbol, exchange, marketType, precision);
                        this.applyPriceFormat(precision);
                        this._lastAppliedPrecision = String(precision);
                        // [FIX] формат подписей изменился после отрисовки — пересчитать ширину оси
                        if (changed && !this._switchingSymbol && !this._isSwitchingInterval) this._relockPriceScaleWidth();
                    }
                }).catch(() => {});
            }

            setTimeout(() => { if (window.renderDrawings) window.renderDrawings(); }, 0);
            this._lastTimeframe = interval;

            if (!window._dailySeparator && window.DailySeparator) window._dailySeparator = new window.DailySeparator(this);
            if (window._dailySeparator?.redraw) window._dailySeparator.redraw();
            if (!window._sessionHighlighter && window.SessionHighlighter) window._sessionHighlighter = new window.SessionHighlighter(this);
            if (window._sessionHighlighter?.redraw) window._sessionHighlighter.redraw();

            this.isLoadingMore = false;
            this._pendingHistoryLoad = false;
            this._lastHistoryLoadTime = 0;
        } catch (error) {
            console.error('❌ Ошибка в setDataQuick:', error);
            if (this.chart) this.chart.applyOptions({ handleScroll: true, handleScale: true });
            this._disableAutoScroll();
            if (onReady) onReady();
        }
    }

    // =============== SCALE ===============
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

    // =============== SUSPEND/RESUME ===============
    _suspendAllUpdates() {
        this._updatesSuspended = true;
        if (this.priceManager) this.priceManager.suspend?.();
        if (this.timerManager) this.timerManager.stop?.();
    }
    _resumeAllUpdates(genId) {
        if (this._activeGeneration !== genId) return;
        this._updatesSuspended = false;
        if (this.priceManager) this.priceManager.resume?.();
    }

    _queuePendingSwitch(partial) {
        const base = this._pendingSwitchRequest || {
            symbol: this.currentSymbol, exchange: this.currentExchange,
            marketType: this.currentMarketType, interval: this.currentInterval
        };
        this._pendingSwitchRequest = Object.assign({}, base, partial);
    }

    // Синхронный вызов. Рекурсия по стеку здесь ограничена: _pendingSwitchRequest —
    // единственный слот (не очередь), поэтому даже при быстром чередовании
    // переключений цепочка finally → _dispatchPendingSwitch → switchSymbol →
    // finally → ... сворачивается в глубину 1–2 вызова, а не растёт линейно.
    // setTimeout(..., 0) здесь не нужен и вреден: браузер клэмпит его до ~4 мс,
    // а в фоновой вкладке — до 1000 мс, что заметно замедляет переключения.
    _dispatchPendingSwitch() {
        if (this._pendingSwitchRequest) {
            const next = this._pendingSwitchRequest;
            this._pendingSwitchRequest = null;
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

    // =============== SWITCH SYMBOL ===============
    async switchSymbol(symbol, exchange, marketType) {
        if (this._switchingSymbol || this._isSwitchingInterval) {
            this._queuePendingSwitch({ symbol, exchange, marketType });
            return;
        }
        this._switchingSymbol = true;
        this._showSymbolSwitchOverlay();
        this._suspendAllUpdates();

        const generationId = ++this._generationCounter;
        this._activeGeneration = generationId;
        let dataApplied = false;

        try {
            // [FIX] точность запрашивается параллельно с загрузкой свечей
            const precisionPromise = this._prefetchPrecision(symbol, exchange, marketType);

            let candles = await this.loadCandlesFromCache(symbol, exchange, marketType, this.currentInterval);
            let isFromCache = !!candles;
            if (!isFromCache) {
                candles = await this.fetchKlines(symbol, exchange, marketType, this.currentInterval, 1000);
            }
            await precisionPromise;
            if (this._activeGeneration !== generationId) return;
            if (!candles || candles.length === 0) throw new Error('Нет данных для ' + symbol);

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
            if (cachedPrecision) this.applyPriceFormat(parseInt(cachedPrecision, 10));
            if (!this._isChartValid()) return;

            let cacheRefreshPromise = null;
            if (isFromCache) {
                cacheRefreshPromise = Promise.race([
                    this.refreshCandlesInBackground(symbol, exchange, marketType, this.currentInterval).catch(() => {}),
                    new Promise(r => setTimeout(r, 2500))
                ]);
            }

            await new Promise((resolve) => {
                this.setDataQuick(candles, this.currentInterval, symbol, exchange, marketType, true, resolve);
            });
            dataApplied = true;
            if (this._activeGeneration !== generationId) return;

            if (cacheRefreshPromise) await cacheRefreshPromise;
            if (this._activeGeneration !== generationId) return;

            if (!isFromCache) {
                this.saveCandlesToCache(symbol, exchange, marketType, this.currentInterval, candles).catch(() => {});
            }
            this.loadDrawingsForCurrentSymbol();
            localStorage.setItem('lastSymbol', symbol);
            localStorage.setItem('lastExchange', exchange);
            localStorage.setItem('lastMarketType', marketType);
            this._notifySymbolChange();
        } catch (error) {
            console.error(`❌ Не удалось переключиться на ${symbol}:`, error);
        } finally {
            if (this._destroyed) return;
            // Безусловный cleanup, без generation-guard'а: если generation
            // сменился, эта операция всё равно остаётся владельцем
            // _switchingSymbol/_updatesSuspended и снять их может только она.
            this._switchingSymbol = false;
            this._updatesSuspended = false;
            if (this.priceManager) this.priceManager.resume?.();
            this._hideSymbolSwitchOverlay();
            if (dataApplied) {
                this._startPeriodicSync();
                this._startNewCandleChecker();
                this._syncRecentCandles().catch(() => {});
            }
            this._dispatchPendingSwitch();
        }
    }

    // =============== SWITCH INTERVAL ===============
    async switchInterval(newInterval) {
        if (this._isSwitchingInterval || this._switchingSymbol) { this._queuePendingSwitch({ interval: newInterval }); return; }
        if (this.currentInterval === newInterval) return;

        this._isSwitchingInterval = true;
        this._showSymbolSwitchOverlay();
        const generationId = ++this._generationCounter;
        this._activeGeneration = generationId;
        this._stopPeriodicSync();
        this._stopCandleChecker();

        if (this._currentFetchController) { this._currentFetchController.abort(); this._currentFetchController = null; }
        if (this._backgroundFetchController) { this._backgroundFetchController.abort(); this._backgroundFetchController = null; }
        if (this._historyFetchController) { this._historyFetchController.abort(); this._historyFetchController = null; }
        if (this._healFetchController) { this._healFetchController.abort(); this._healFetchController = null; }

        this._lastKlineEventTime = 0;
        this._catchingUpMissed = false;
        this._lastCatchUpAttempt = 0;
        this._lastInferredPrecision = null;

        if (window.wsManager?.clearKlineQueue) window.wsManager.clearKlineQueue();

        try {
            this._suspendAllUpdates();
            this.currentInterval = newInterval;
            localStorage.setItem('lastTimeframe', newInterval);
            if (window.wsManager?.updateSymbolAndTimeframe) {
                window.wsManager.updateSymbolAndTimeframe(this.currentSymbol, this.currentInterval, this.currentExchange, this.currentMarketType);
            }
            let candles = await this.loadCandlesFromCache(this.currentSymbol, this.currentExchange, this.currentMarketType, this.currentInterval);
            let isFromCache = !!candles;
            if (!isFromCache) candles = await this.fetchKlines(this.currentSymbol, this.currentExchange, this.currentMarketType, this.currentInterval, 1000);
            if (this._activeGeneration !== generationId) return;
            if (!candles || candles.length === 0) throw new Error('Нет данных');

            await new Promise((resolve) => {
                this.setDataQuick(candles, this.currentInterval, this.currentSymbol, this.currentExchange, this.currentMarketType, true, resolve);
            });
            if (this._activeGeneration !== generationId) return;
            if (!isFromCache) this.saveCandlesToCache(this.currentSymbol, this.currentExchange, this.currentMarketType, this.currentInterval, candles).catch(() => {});
            if (isFromCache) {
                await Promise.race([
                    this.refreshCandlesInBackground(this.currentSymbol, this.currentExchange, this.currentMarketType, this.currentInterval).catch(() => {}),
                    new Promise(r => setTimeout(r, 2500))
                ]);
                if (this._activeGeneration !== generationId) return;
            }
        } catch (error) { console.error('❌ Ошибка переключения таймфрейма:', error); }
        finally {
            if (this._destroyed) return;
            // Тот же паттерн, что в switchSymbol: cleanup без generation-guard.
            this._isSwitchingInterval = false;
            this._updatesSuspended = false;
            if (this.priceManager) this.priceManager.resume?.();
            this._hideSymbolSwitchOverlay();
            this._startPeriodicSync();
            this._startNewCandleChecker();
            this._dispatchPendingSwitch();
        }
    }

    loadDrawingsForCurrentSymbol() {
        Promise.allSettled([
            window.rayManager?.loadRays?.(), window.trendLineManager?.loadTrendLines?.(),
            window.rulerLineManager?.loadRulers?.(), window.alertLineManager?.loadAlerts?.(), window.textManager?.loadTexts?.()
        ]).then(() => this.requestDrawingsRedraw());
    }

    async loadInitialData(symbol, exchange, marketType, interval, onReady = null) {
        if (this._switchingSymbol || this._isSwitchingInterval) { if (onReady) onReady(); return; }
        if (this._destroyed) { if (onReady) onReady(); return; }

        // [FIX] Закрываем график оверлеем на время начальной загрузки —
        // промежуточные кадры (узкая ось, смена формата подписей) пользователь не видит.
        this._showSymbolSwitchOverlay();

        const generationId = ++this._generationCounter;
        this._activeGeneration = generationId;
        if (symbol) this.currentSymbol = symbol;
        if (exchange) this.currentExchange = exchange;
        if (marketType) this.currentMarketType = marketType;
        if (interval) this.currentInterval = interval;

        const finish = () => {
            // оверлей снимаем только если наша загрузка всё ещё актуальна
            // (иначе им владеет более новая операция)
            if (this._activeGeneration === generationId && !this._switchingSymbol && !this._isSwitchingInterval) {
                this._hideSymbolSwitchOverlay();
            }
            if (onReady) onReady();
        };
        try {
            // [FIX] точность параллельно со свечами
            const precisionPromise = this._prefetchPrecision(this.currentSymbol, this.currentExchange, this.currentMarketType);

            let candles = await this.loadCandlesFromCache(this.currentSymbol, this.currentExchange, this.currentMarketType, this.currentInterval);
            const isFromCache = !!(candles && candles.length > 0);
            if (!isFromCache) candles = await this.fetchKlines(this.currentSymbol, this.currentExchange, this.currentMarketType, this.currentInterval, 1000);
            await precisionPromise;
            if (this._activeGeneration !== generationId) { finish(); return; }
            if (!candles || candles.length === 0) { console.warn('⚠️ loadInitialData: нет данных'); finish(); return; }
            await new Promise((resolve) => {
                this.setDataQuick(candles, this.currentInterval, this.currentSymbol, this.currentExchange, this.currentMarketType, true, resolve);
            });
            if (this._activeGeneration !== generationId) { finish(); return; }
            if (isFromCache) this.refreshCandlesInBackground(this.currentSymbol, this.currentExchange, this.currentMarketType, this.currentInterval).catch(() => {});
            else this.saveCandlesToCache(this.currentSymbol, this.currentExchange, this.currentMarketType, this.currentInterval, candles).catch(() => {});
            finish();
        } catch (error) { console.error('❌ Ошибка первоначальной загрузки:', error); finish(); }
    }

    // =============== CROSSHAIR ===============
    onCrosshairMove(param) {
        this._pendingCrosshairParam = param;
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

    _clearPanelsCrosshair() {
        const panels = this.indicatorManager?.panelManager?.panels;
        if (!panels) return;
        for (let i = 0; i < panels.length; i++) {
            const panel = panels[i];
            if (panel.chart && !panel.isCollapsed) { try { panel.chart.clearCrosshairPosition(); } catch (e) {} }
        }
    }

    _syncPanelsCrosshairOptimized() {
        if (!this._latestCrosshairData || !this._latestCrosshairData.visible) { this._clearPanelsCrosshair(); return; }
        const panels = this.indicatorManager?.panelManager?.panels;
        if (!panels) return;
        const { time, pointX } = this._latestCrosshairData;
        for (let i = 0; i < panels.length; i++) {
            const panel = panels[i];
            if (!panel.chart || panel.isCollapsed) continue;
            try {
                let targetSeries = null;
                for (const series of panel.series) { targetSeries = series; break; }
                if (!targetSeries) { panel.chart.clearCrosshairPosition(); continue; }
                const dataPoint = targetSeries.dataByIndex?.(this._candleTimeMap.get(time));
                if (dataPoint && dataPoint.value !== undefined) panel.chart.setCrosshairPosition(dataPoint.value, time, pointX);
                else panel.chart.clearCrosshairPosition();
            } catch (e) {}
        }
    }

    _applyCrosshairDOMOptimized() {
        const data = this._latestCrosshairData;
        if (!data || !data.visible) { if (this.overlay) this.overlay.classList.remove('visible'); return; }

        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        const precision = series?.options()?.priceFormat?.precision ?? 2;
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

    // =============== SCROLL ===============
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
            const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            if (activeSeries && this.lastCandle) {
                const safe = this._toLwBar(this.lastCandle);
                if (safe) { try { activeSeries.update(safe); } catch (e) {} }
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

    // =============== GETTERS ===============
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

    // =============== LAYOUT ===============
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
            const panels = this.indicatorManager.panelManager.panels;
            if (panels && Array.isArray(panels)) {
                panels.forEach(panel => {
                    if (panel.chart && !panel.isCollapsed && panel.container) {
                        try {
                            const ph = panel.container.clientHeight, pw = panel.container.clientWidth;
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

    // =============== INDICATORS ===============
    addIndicator(type) {
        const result = this.indicatorManager.addIndicator(type);
        setTimeout(() => this._updateMainChartHeight(), 50);
        return result;
    }
    removeIndicatorByType(type) { return this.indicatorManager.removeIndicator(type); }
    clearAllIndicators() { this.indicatorManager.clearAllIndicators(); }
    updateAllIndicators() { this.indicatorManager.updateAllIndicators(); }
    restoreIndicators() { this.indicatorManager.loadIndicators(); }

    // =============== PRICE MANAGER ===============
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
            this._updatePageTitle();
            if (!document.hidden && this._isChartValid()) {
                this._syncPriceLine(price);
                if (this.timerManager) this.timerManager.updatePrice(price);
            }
        };
        this.priceManager.subscribe(key, this._priceUpdateHandler, this.currentExchange, this.currentMarketType);
        this._startBackgroundTitleUpdate();
    }

    setSymbol(symbol) {
        if (this.currentSymbol === symbol) return;
        this.currentSymbol = symbol;
        this._subscribeToPrice();
    }

    // =============== PRECISION ===============
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

    // =============== VALIDATION ===============
    _isValidCandle(candle, nowSecHint = null) {
        if (!candle || typeof candle !== 'object') return false;
        if (typeof candle.time !== 'number' || isNaN(candle.time) || candle.time <= 0) return false;
        if (!Number.isInteger(candle.time)) return false;
        const nowSec = nowSecHint !== null ? nowSecHint : Math.floor(Date.now() / 1000);
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
        const nowSec = Math.floor(Date.now() / 1000);
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

    // =============== NEW CANDLE ===============
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

    // =============== VOLUME ===============
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

    // =============== FETCH KLINES ===============
    async fetchKlines(symbol, exchange, marketType, interval, limit = 1000, endTime = null, requestType = 'user') {
        const requestStartedAt = Date.now();
        let controller;
        if (requestType === 'history') {
            if (this._historyFetchController) this._historyFetchController.abort();
            this._historyFetchController = new AbortController();
            controller = this._historyFetchController;
        } else if (requestType === 'heal') {
            if (this._healFetchController) this._healFetchController.abort();
            this._healFetchController = new AbortController();
            controller = this._healFetchController;
        } else if (requestType === 'background') {
            if (this._backgroundFetchController) this._backgroundFetchController.abort();
            this._backgroundFetchController = new AbortController();
            controller = this._backgroundFetchController;
        } else {
            if (this._currentFetchController) this._currentFetchController.abort();
            this._currentFetchController = new AbortController();
            controller = this._currentFetchController;
        }

        const signal = controller.signal;
        const timeoutId = setTimeout(() => controller.abort(), this._fetchTimeoutMs);

        const bybitIntervalMap = {
            '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
            '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
            '1d': 'D', '1w': 'W', '1M': 'M'
        };
        const alignTime = (t) => this._alignTimeForInterval(t, interval);

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
                if (!Array.isArray(data)) throw new Error('Binance: ожидался массив');
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
                if (data.retCode !== 0) throw new Error(`Bybit error: ${data.retCode}`);
                if (!data.result || !data.result.list) throw new Error('Bybit: неожиданный формат');
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

            if (signal.aborted) return null;

            const dedupMap = new Map();
            for (const c of rawCandles) {
                const aligned = alignTime(c.time);
                c.time = aligned;
                dedupMap.set(aligned, c);
            }
            const noDupes = Array.from(dedupMap.values());
            const batchNowSec = Math.floor(Date.now() / 1000);
            const validCandles = noDupes.filter(c => this._isValidCandle(c, batchNowSec));
            validCandles.sort((a, b) => a.time - b.time);
            const currentStart = this._alignTimeForInterval(batchNowSec, interval);
            for (const c of validCandles) {
                this._stampCandle(c, 'rest', requestStartedAt);
                c._closed = c.time < currentStart;
            }
            return validCandles;
        } catch (error) {
            if (error?.name !== 'AbortError') console.warn(`⚠️ Ошибка загрузки klines (${symbol}, ${interval}, ${requestType}):`, error);
            return null;
        } finally {
            clearTimeout(timeoutId);
            if (requestType === 'history' && this._historyFetchController?.signal === signal) this._historyFetchController = null;
            else if (requestType === 'heal' && this._healFetchController?.signal === signal) this._healFetchController = null;
            else if (requestType === 'background' && this._backgroundFetchController?.signal === signal) this._backgroundFetchController = null;
            else if (requestType === 'user' && this._currentFetchController?.signal === signal) this._currentFetchController = null;
        }
    }

    // =============== TITLE ===============
    _updatePageTitle() {
        const symbol = this.currentSymbol || '';
        let price = this.currentRealPrice;
        if (!price || isNaN(price) || price <= 0) price = this.lastCandle?.close;
        if (!price || isNaN(price) || price <= 0) price = this.chartData?.[this.chartData.length - 1]?.close;
        if (!symbol) { document.title = 'График'; return; }
        if (price != null && !isNaN(price) && price > 0) {
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            const precision = series?.options()?.priceFormat?.precision ?? 2;
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

    // =============== COLORS ===============
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

    // =============== ABORT / DESTROY ===============
    _abortAllProcesses() {
        if (this._bgTitleInterval) { clearInterval(this._bgTitleInterval); this._bgTitleInterval = null; }
        if (this._periodicSyncInterval) { clearInterval(this._periodicSyncInterval); this._periodicSyncInterval = null; }
        if (this._quarantineTimeout) { clearTimeout(this._quarantineTimeout); this._quarantineTimeout = null; }
        if (this.priceManager && this._priceUpdateHandler && this._priceSubscriptionKey) {
            this.priceManager.unsubscribe(this._priceSubscriptionKey, this._priceUpdateHandler);
            this._priceUpdateHandler = null;
            this._priceSubscriptionKey = null;
        }
        if (this.timerManager) this.timerManager.stop();
        this._loadingSymbol = false;
        this.isLoadingMore = false;
        this._updateScheduled = false;
        this._pendingUpdates = false;
        this._pendingRedraw = false;
        if (this._drawingsUpdateRafId) { cancelAnimationFrame(this._drawingsUpdateRafId); this._drawingsUpdateRafId = null; }
        if (this._updatePositionRafId) { cancelAnimationFrame(this._updatePositionRafId); this._updatePositionRafId = null; }
        if (this._priceUpdateRafId) { cancelAnimationFrame(this._priceUpdateRafId); this._priceUpdateRafId = null; }
        this._pendingPriceValue = null;
        this._pendingPriceUpdate = null;
        if (this._currentFetchController) { this._currentFetchController.abort(); this._currentFetchController = null; }
        if (this._historyFetchController) { this._historyFetchController.abort(); this._historyFetchController = null; }
        if (this._backgroundFetchController) { this._backgroundFetchController.abort(); this._backgroundFetchController = null; }
        if (this._healFetchController) { this._healFetchController.abort(); this._healFetchController = null; }
        if (this._updateTimeout) { clearTimeout(this._updateTimeout); this._updateTimeout = null; }
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
        if (this._bgTitleInterval) { clearInterval(this._bgTitleInterval); this._bgTitleInterval = null; }
        if (this._periodicSyncInterval) { clearInterval(this._periodicSyncInterval); this._periodicSyncInterval = null; }
        if (this._quarantineTimeout) { clearTimeout(this._quarantineTimeout); this._quarantineTimeout = null; }
        this._abortAllProcesses();
        if (window._dailySeparator && typeof window._dailySeparator.destroy === 'function') { window._dailySeparator.destroy(); window._dailySeparator = null; }
        if (window._sessionHighlighter && typeof window._sessionHighlighter.destroy === 'function') { window._sessionHighlighter.destroy(); window._sessionHighlighter = null; }
        if (this._candleCheckerTimeout) clearTimeout(this._candleCheckerTimeout);
        if (this._trimDebounceTimeout) clearTimeout(this._trimDebounceTimeout);
        if (this._drawingsFinalUpdateTimeout) clearTimeout(this._drawingsFinalUpdateTimeout);
        if (this._scrollStopTimeout) clearTimeout(this._scrollStopTimeout);
        if (this._priceUpdateRafId) { cancelAnimationFrame(this._priceUpdateRafId); this._priceUpdateRafId = null; }
        if (this._crosshairRafId) { cancelAnimationFrame(this._crosshairRafId); this._crosshairRafId = null; }
        if (this._drawingsRafId) { cancelAnimationFrame(this._drawingsRafId); this._drawingsRafId = null; }
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

    // =============== COORDINATES ===============
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
                this.applyPriceFormat(precision);
                this._setCachedPrecision(symbol, exchange, marketType, precision);
                // [FIX] формат подписей мог измениться — пересчитать ширину оси
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

    // =============== HISTORY LOAD / TRIM ===============
    onVisibleLogicalRangeChange(range) {
        if (!range || !this.chartData.length || !this._isChartValid()) return;
        const fromIndex = Math.max(0, Math.floor(range.from));
        if (fromIndex < this._preloadThreshold && this.hasMoreData && !this.isLoadingMore) this._loadHistoryAsync();
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
        if (this._isTrimming || this.isLoadingMore || !this._isChartValid()) return;
        if (this.chartData.length <= this._maxCandlesInMemory) return;
        const keepFrom = Math.max(0, Math.floor(fromIndex - (this._leftBuffer * 1.5)));
        let keepTo = Math.min(this.chartData.length, Math.ceil(toIndex + (this._rightBuffer * 1.5)));
        const minKeepRight = Math.min(this.chartData.length, 120);
        keepTo = Math.max(keepTo, this.chartData.length - minKeepRight);
        const liveFloorTime = this._alignTimeToInterval(Math.floor(Date.now() / 1000)) - this._getIntervalSeconds() * 2;
        let liveIdx = this.chartData.length;
        while (liveIdx > 0 && this.chartData[liveIdx - 1].time >= liveFloorTime) liveIdx--;
        keepTo = Math.max(keepTo, liveIdx);
        keepTo = Math.min(keepTo, this.chartData.length);

        const leftTrim = keepFrom, rightTrim = this.chartData.length - keepTo;
        if (leftTrim === 0 && rightTrim === 0) return;
        if (keepFrom >= keepTo) return;

        this._isTrimming = true;
        try {
            this.chartData = this.chartData.slice(keepFrom, keepTo);
            this._rebuildTimeMap();
            this._volumeDataDirty = true;
            this._lastVolumeUpdateIndex = -1;
            const ts = this.chart.timeScale();
            const cr = ts.getVisibleLogicalRange();
            const ps = this.chart.priceScale('right');
            if (ps) ps.applyOptions({ autoScale: false });
            const lwBars = this._toLwBarsArray(this.chartData);
            // [FIX] только видимая серия
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

    async _loadHistoryAsync() {
        if (this.isLoadingMore || !this.hasMoreData || !this._isChartValid()) return;
        const now = Date.now();
        if (now - this._lastHistoryLoadTime < 1500) return;
        this.isLoadingMore = true;
        this._lastHistoryLoadTime = now;

        const genId = this._activeGeneration;
        const interval = this.currentInterval;

        try {
            const oldestCandle = this.chartData[0];
            if (!oldestCandle) { this.hasMoreData = false; this.isLoadingMore = false; return; }
            const endTime = (oldestCandle.time * 1000) - 1;
            const olderCandles = await this.fetchKlines(
                this.currentSymbol, this.currentExchange, this.currentMarketType,
                this.currentInterval, this._batchSize, endTime, 'history'
            );
            if (olderCandles === null) { this.isLoadingMore = false; return; }
            if (!olderCandles || olderCandles.length === 0 || !this._isChartValid() ||
                this._activeGeneration !== genId || this.currentInterval !== interval || this.chartData.length === 0) {
                this.hasMoreData = false; this.isLoadingMore = false; return;
            }
            const oldestExistingTime = this.chartData[0].time;
            const uniqueOlder = olderCandles.filter(c => c.time < oldestExistingTime);

            if (uniqueOlder.length > 0) {
                const ts = this.chart.timeScale();
                const cr = ts.getVisibleLogicalRange();
                const addedCount = uniqueOlder.length;
                let combined = [...uniqueOlder, ...this.chartData];
                let trimmedFromFront = 0;
                if (combined.length > this._maxCandlesInMemory + 500) {
                    trimmedFromFront = combined.length - this._maxCandlesInMemory;
                    combined = combined.slice(trimmedFromFront);
                }
                this.chartData = combined;
                this._rebuildTimeMap();
                this.lastCandle = this.chartData[this.chartData.length - 1];
                this._volumeDataDirty = true;
                this._lastVolumeUpdateIndex = -1;
                const ps = this.chart.priceScale('right');
                if (ps) ps.applyOptions({ autoScale: false });
                const lwBars = this._toLwBarsArray(this.chartData);
                // [FIX] только видимая серия
                this._setVisibleSeriesData(lwBars);
                this._updateVolumeOptimized();
                this._applyVolumeScaleOptions();

                // [FIX] здесь раньше вызывалась _applyPriceScaleWidthOnce() — это и была
                // «подстройка ширины уже после открытия». Убрано.

                const netShift = addedCount - trimmedFromFront;
                if (cr) ts.setVisibleLogicalRange({ from: cr.from + netShift, to: cr.to + netShift });

                requestAnimationFrame(() => {
                    if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
                    this.scheduleDrawingsUpdate(true);
                });
                if (this.timerManager?._primitive?.isEnabled()) this.timerManager._primitive.requestRedraw();
            } else this.hasMoreData = false;
            if (olderCandles.length < this._batchSize) this.hasMoreData = false;
        } catch (e) { this.hasMoreData = false; }
        finally { this.isLoadingMore = false; }
    }

    // =============== BACKGROUND REFRESH ===============
    async refreshCandlesInBackground(symbol, exchange, marketType, interval) {
        const genId = this._activeGeneration;
        try {
            if (symbol !== this.currentSymbol || exchange !== this.currentExchange || !this._isChartValid()) return;
            const freshCandles = await this.fetchKlines(symbol, exchange, marketType, interval, 100, null, 'background');
            if (!freshCandles || freshCandles.length === 0 || !this._isChartValid()) return;
            if (symbol !== this.currentSymbol || this._activeGeneration !== genId || this.currentInterval !== interval) return;
            if (!this.chartData.length) return;

            const lastCachedTime = this.chartData[this.chartData.length - 1].time;
            const matchLast = freshCandles.find(c => c.time === lastCachedTime);

            if (matchLast && this._isFresherUpdate(this.chartData[this.chartData.length - 1], matchLast._receivedAt, matchLast._source)) {
                const lc = this.chartData[this.chartData.length - 1];
                if (!(lc._closed === true && matchLast._closed !== true)) {
                    lc.open = matchLast.open; lc.high = matchLast.high; lc.low = matchLast.low;
                    lc.close = matchLast.close; lc.volume = matchLast.volume; lc.quoteVolume = matchLast.quoteVolume;
                    this._stampCandle(lc, matchLast._source, matchLast._receivedAt);
                    lc._isPlaceholder = false;
                    if (typeof matchLast._closed === 'boolean') lc._closed = matchLast._closed;
                    this._updateVisibleSeries({ time: lc.time, open: lc.open, high: lc.high, low: lc.low, close: lc.close });
                    this._safeVolumeBarUpdate(lc.time, lc.quoteVolume || lc.volume || 0,
                        lc.close >= lc.open ? this.bullishColor : this.bearishColor);
                }
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
                    if (!holeDetected) this._applyAppendOnly(newCandles);
                    else this._applyDataAtomically();
                }
                if (holeDetected) { this._lastGapHealAttempt = 0; this._healDataGaps().catch(() => {}); }
            }

            if (matchLast || newCandles.length > 0) {
                this.lastCandle = this.chartData[this.chartData.length - 1];
                this._syncLineColor();
                if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
            }
        } catch (error) {}
    }

    // =============== CACHE ===============
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
        const cleanCandles = Array.from(byTime.values()).sort((a, b) => a.time - b.time);
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

    async loadCandlesFromCache(symbol, exchange, marketType, interval) {
        const CACHE_VERSION = '3';
        const key = `${symbol}_${interval}_${exchange}_${marketType}_v${CACHE_VERSION}`;
        if (!window.db) return null;
        try {
            await this._waitForDb();
            const cached = await window.db.get('candles', key);
            if (!cached) return null;
            if (cached.version !== CACHE_VERSION) { await window.db.delete('candles', key); return null; }
            const CACHE_DURATION = 5 * 60 * 1000;
            if (Date.now() - cached.lastUpdate > CACHE_DURATION) return null;
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
                if (now - cached.lastUpdate > maxAge) await window.db.delete('candles', cached.key);
            }
        } catch (error) {}
    }

    // =============== WAIT READY ===============
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

    // =============== DRAWINGS ===============
    manualAutoScale() { this.autoScale(); }

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

    requestDrawingsRedraw() {
        if (document.hidden || !this._isChartValid()) return;
        if (this._isScrolling || this._isScrollingFast) { this._pendingDrawingsRedraw = true; return; }
        if (this._drawingsRafId !== null) return;
        this._drawingsRafId = requestAnimationFrame(() => {
            this._drawingsRafId = null;
            this._performDrawingsRedraw();
        });
    }

    _performDrawingsRedraw() {
        if (window.rayManager?._applyRedrawIfNeeded) window.rayManager._applyRedrawIfNeeded();
        if (window.trendLineManager?._requestRedraw) window.trendLineManager._requestRedraw();
        if (window.rulerLineManager?._requestRedraw) window.rulerLineManager._requestRedraw();
        if (window.alertLineManager?._applyRedrawsIfNeeded) window.alertLineManager._applyRedrawsIfNeeded();
        if (window.textManager?._requestRedraw) window.textManager._requestRedraw();
    }
}

if (typeof window !== 'undefined') {
    window.ChartManager = ChartManager;
}
