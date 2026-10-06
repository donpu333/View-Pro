
const SOURCE_PRIORITY = { 'ws': 3, 'rest': 2, 'cache': 1 };

// [FIX-M3] '2h' в UI (TF_LABELS) отсутствует и оставлен в карте для обратной
// совместимости: чтобы корректно выравнивать время в старых кэшах/рисунках.
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

// ============================ [VP-KLINES] =====================================
// Запасные хосты REST. Основной хост может отдать 429/418 (рейт-лимит/бан IP),
// 451 (геоблокировка) или просто «лечь» — раньше это означало окончательный
// провал загрузки и «Нет данных для SYMBOL». Теперь есть второй хост.
//
//   data-api.binance.vision — публичное зеркало рыночных данных Binance
//                             (spot), отдаёт /api/v3/* и CORS «*»;
//   api.bytick.com          — альтернативный домен Bybit v5.
// Для Binance Futures публичного зеркала нет, поэтому хост один.
const KLINE_HOSTS = {
    binanceSpot:    ['https://api.binance.com', 'https://data-api.binance.vision'],
    binanceFutures: ['https://fapi.binance.com'],
    bybit:          ['https://api.bybit.com', 'https://api.bytick.com']
};

// Каждый «тип» запроса имеет СВОЙ слот AbortController. Раньше типов было
// меньше, чем сценариев, и запросы разных сценариев дрались за один слот:
// любой фоновый вызов с requestType 'user' обрывал незавершённую загрузку
// switchSymbol, та получала null и бросала «Нет данных для SYMBOL» — причём
// AbortError даже не логировался, поэтому в консоли не было НИ одной причины.
const FETCH_CONTROLLER_SLOTS = {
    'switch':     '_switchFetchController',      // смена символа / ТФ / первый вход — критично
    'user':       '_currentFetchController',
    'history':    '_historyFetchController',
    'background': '_backgroundFetchController',
    'heal':       '_healFetchController',
    'prefetch':   '_prefetchFetchController'
};
// =================================================================================

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
        // [VP-STUCK] сторож залипшего переключения символа/ТФ
        this._switchWatchdogTimer = null;
        this._switchProgressAt = 0;
        this._switchOwnerToken = null;
        // сколько ждём финализацию отрисовки (onReady из setDataQuick)
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
        // [ШАГ 1] Удалены: _drawingsUpdateRafId, _drawingsRafId, _lastDrawingsCall, _drawingsFinalUpdateTimeout
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
        this._prefetchFetchController = null;   // [HIST-FIX] отдельный контроллер фонового prefetch истории
        // [VP-KLINES] свой контроллер критичных загрузок (смена символа/ТФ/первый вход).
        // Без него любой фоновый запрос типа 'user' обрывал загрузку символа.
        this._switchFetchController = null;
        this._lastKlinesFailure = null;         // последняя причина отказа REST — для внятной ошибки
        this._serverTimeOffsetMs = 0;           // [VP-CLOCK] serverTime - Date.now(), ограничен ±2 мин
        this._clockSkewWarned = false;
        this._klinesMaxAttempts = 3;            // сколько хостов/повторов пробуем
        this._klinesRetryTimeoutMs = 10000;     // таймаут повторной попытки (первая — _fetchTimeoutMs)
        this._klinesRetryDelayMs = 350;         // пауза между попытками
        this._staleCacheMaxAgeMs = 24 * 60 * 60 * 1000;  // «последний шанс»: кэш свечей до 24 ч
        this._badIntervalsWarned = new Set();
        this._updateTimeout = null;
        this._autoScalePending = false;
        this._isVerticalZooming = false;
        this._crosshairRafId = null;
        this._latestCrosshairData = null;
        this._pendingCrosshairParam = null;
        // [CROSSHAIR-PERF] Флаг «пользователь двигает перекрестие» + таймер «успокоения».
        // Пока флаг взведён, IndicatorManager откладывает полный пересчёт индикаторов:
        // на глубокой истории (десятки тысяч свечей) пересчёт (structured-clone в worker
        // + setData результатов) блокировал main thread на десятки мс, и перекрестию
        // не хватало кадров — оно lag'ало и «отлипало» от курсора. Пересчёт выполняется
        // через 150 мс после остановки мыши (flushPendingIndicatorsUpdate).
        this._crosshairActive = false;
        this._crosshairIdleTimeout = null;
        // [DRAW-DRAG] заблокирован ли скролл графика на время перетаскивания рисовалки
        this._drawingScrollLock = false;
        // [CROSSHAIR-PERF] Де-дупликатор перекрестия панелей: setCrosshairPosition
        // (= полная перерисовка панели) вызывается только при реальном смене time/value.
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
        // [PERF-GATE] Троттлинг перерисовки графика от тиков aggTrade:
        // не чаще 10 раз в секунду (1 раз в 100 мс). На спокойных монетах
        // (тик реже 100 мс) гейт прозрачен — всё проходит как раньше.
        this._lastPriceGateAt = 0;
        this._priceGateMinMs = 100;
        this._priceGateTimeout = null;
        // [PERF-GATE2] Обвязка «тихих» апдейтов: тик-хэндлер больше не делает
        // тяжёлую работу на каждый aggTrade (титул, timerManager, DOM-проверки).
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
        // [INFINITE-SCROLL] схема пагинации истории (как в TradingView):
        //   • стартовая загрузка — 1000 свечей (как в оригинале);
        //   • страница догрузки — максимум, который конкретная биржа/рынок отдаёт
        //     за один запрос: Binance futures 1500, Binance spot и Bybit v5 1000
        //     (см. _historyBatchFor). Меньше — чаще страницы и чаще полный setData
        //     (микротормоза), больше — нельзя: ответ урезается и проверка
        //     «page.length < batchSize» ложно закрывает историю;
        //   • триггер догрузки — когда до левого края остаётся ~100 свечей
        //     (или один видимый экран при сильном отдалении, см. _preloadThresholdFor).
        this._preloadThreshold = 100;
        this._initialBatch = 1000;
        this._batchSize = 1000;
        this._minLoadDelay = 1000;
        this._lastHistoryLoadTime = 0;
        this._pendingHistoryLoad = false;
        this._historyEndTime = null;
        this._fetchPromise = null;

        // ========================== [HIST-FIX] =========================================
        // Причина «тормозов истории» именно на коротких ТФ (1m/3m/5m/15m):
        //   1) стартовая загрузка — всегда 1000 свечей. Для 1d это ~3 года, для 1h ~41 день,
        //      а для 1m — всего ~16 часов. То есть на 1m левого края графика пользователь
        //      достигает через пару прокруток, а на 1h/1d — практически никогда. Отсюда и
        //      ощущение «на часе и дне история летает, а на минутах тормозит»: на длинных ТФ
        //      пагинация просто не запускается.
        //   2) догрузка истории стартовала ТОЛЬКО через 150 мс после остановки скролла и
        //      упиралась в жёсткий троттлинг 1500 мс, который молча выходил без повтора.
        //      Быстрая прокрутка успевала доехать до пустого края -> график вставал на
        //      1.5–3 с (троттлинг + сеть), потом скачок — и так на каждой странице.
        //   3) каждая страница тянула полный setData по всем ~5000 свечей + пересборку
        //      объёмов + пересчёт индикаторов, причём массив баров собирался заново
        //      (spread {...c} + Map + sort) на КАЖДУЮ догрузку и КАЖДЫЙ trim.
        // Ниже: упреждающий prefetch цепочкой (без остановки у края), страница истории
        // = максимум API биржи (Binance futures 1500, Binance spot и Bybit v5 1000),
        // локальный кэш страниц истории в IndexedDB (повторная прокрутка того же
        // участка — без сети, мгновенно) и кэш LW-баров.
        // =================================================================================
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        this._historyCheckThrottleMs = 120;   // как часто проверяем край ВО ВРЕМЯ скролла
        this._lastHistoryCheckAt = 0;
        this._historyThrottleRetry = null;    // отложенный повтор, если попали в троттлинг
        this._historyPrefetchRunning = false; // цепочка фоновых догрузок уже идёт
        this._historyPrefetchMaxPages = isMobile ? 2 : 4;  // страниц за один заход
        this._prefetchPageDelayMs = 220;      // пауза между страницами (бережём rate limit)
        this._prefetchIdleDelayMs = 900;      // когда начинать копать вглубь после загрузки монеты
        this._historyCacheTtlMs = 7 * 24 * 60 * 60 * 1000; // закрытые свечи не меняются — держим неделю
        this._lwBarsCache = (typeof WeakMap === 'function') ? new WeakMap() : null;

        this._cachedPrecisionKey = null;
        this._cachedPrecisionValue = null;
        this._lastInferredPrecision = null;

        // [VP-PRECISION] Одноразовая чистка кэша точности.
        // Старая «тяжёлая» getPrecisionFromExchange при ЛЮБОМ сбое (а падала она
        // регулярно: 17 МБ exchangeInfo просто не успевали дочитаться) возвращала
        // 2 и записывала её в localStorage как истину. _prefetchPrecision при
        // наличии значения больше не спрашивает биржу — то есть неверный формат
        // цены оставался у пользователя НАВСЕГДА. Теперь точность добывается
        // дёшево (5 КБ на spot-символ), поэтому старый кэш безопасно сбросить.
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
                if (doomed.length) {
                    console.log(`🧹 [VP-PRECISION] сброшен устаревший кэш точности: ${doomed.length} записей`);
                }
            }
        } catch (e) {}

        // [PERF-PAN] Кэш «ближайшей свечи» для примитивов рисовалок.
        // updateAllViews() у каждого примитива вызывается КАЖДЫЙ кадр, а данных
        // на 1m в памяти до 12 000 свечей — линейный скан стоил миллисекунды
        // на объект на кадр. Теперь: бинарный поиск + мемоизация по «поколению»
        // данных (length/first/last), инвалидация автоматическая.
        this._nearestTimeCache = new Map();
        this._nearestTimeCacheGen = null;
        this._nearestTimeCacheMax = 4096;

        // [PERF-PAN] Флаг «синхронизацию панелей держит ChartManager»:
        // IndicatorPanelManager при нём не дублирует setVisibleLogicalRange
        // вторым rAF-колбэком на каждую панель.
        this._panelsSyncActive = false;

        // [HIST-FIX] isMobile поднят выше (нужен параметрам истории)
        this._maxCandlesInMemory = isMobile ? 3000 : 8000;   // было 5000: реже trim и реже «пилот» у левого края
        // [INFINITE-SCROLL] Абсолютный потолок памяти — защита при ОЧЕНЬ долгом
        // непрерывном листании истории. Между _maxCandlesInMemory и этим потолком
        // массив растёт свободно: trim спереди выполняется только когда пользователь
        // ушёл от левого края (иначе бесконечный скролл «запирался» на потолке).
        // 40 000 свечей на 1m — это ~27 дней непрерывного листания влево.
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
                // [ШАГ 1] Удалены scheduleDrawingsUpdate/requestDrawingsRedraw

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

        // [ШАГ 1] Убран .bind(this) для scheduleDrawingsUpdate — метода больше нет
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
                autoScale: true,
                entireTextOnly: false,
                // [LOGSCALE] запоминаем режим шкалы: 1 = логарифмическая (кнопка «Л»)
                mode: (localStorage.getItem('priceScaleMode') === 'log')
                    ? ((typeof LightweightCharts !== 'undefined' && LightweightCharts.PriceScaleMode)
                        ? LightweightCharts.PriceScaleMode.Logarithmic : 1)
                    : 0,
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

        // [FIX] Ширину берём от контейнера минус реальная ширина правой шкалы.
        // Раньше использовался ts.width(), который меняется асинхронно после
        // autoscale / смены точности — из-за этого visibleBars для разных монет
        // был разным и зум "уплывал". Этот расчёт стабилен всегда.
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

    // =============== PRICE SCALE WIDTH ===============
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
        // [FIX] Если пользователь ушёл в историю — не трогаем его зум.
        // Раньше relock вызывал сброс/фиксацию минимума ширины, из-за чего
        // visibleLogicalRange пересчитывался и пользователя "дёргало".
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

    // [HIST-FIX] Было: на КАЖДЫЙ вызов создавалось по копии {...c} на каждую свечю
    // (5000 объектов), складывалось в Map и сортировалось. Вызов идёт на каждую страницу
    // истории, на каждый trim и на каждое полное перерисование — на коротких ТФ это
    // главный источник «фризов» при листании. Теперь:
    //   • объект бара кэшируется в WeakMap по самой свече и пересоздаётся только если
    //     свеча реально изменилась (живая свеча) — мусора и работы почти нет;
    //   • Map + sort включаются только если вход НЕ отсортирован (в реальности он всегда
    //     отсортирован, так что sort не выполняется вовсе).
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
            // валидация на месте, без spread-копии (было: {...c, time: alignedT})
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
        if (!this.chart || !this.candleSeries || !this.barSeries || !this.chartContainer) return false;
        // [PERF-GATE2] document.contains() — обход DOM-дерева. Раньше вызывался
        // на каждый тик (по 2-3 раза: хэндлер цены, _syncPriceLine, ...) — на
        // горячих монетах это 300-600 обходов в секунду. Кэшируем «да» на 1 с;
        // «нет» перепроверяем сразу, чтобы не пропустить монтаж контейнера.
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

    // ===================== [VP-STUCK] =========================================
    /**
     * «Двойной кадр» с гарантированным срабатыванием.
     *
     * ЧТО БЫЛО: финализация setDataQuick() (и снятие затемнения при смене ТФ)
     * висела на requestAnimationFrame(() => requestAnimationFrame(...)).
     * Браузер НЕ вызывает rAF, когда страница скрыта/свёрнута/перекрыта другим
     * окном (document.hidden), а также пока главный поток занят тяжёлой задачей.
     * Клик по тикеру в этот момент оставлял switchSymbol навсегда внутри
     * `await new Promise(resolve => setDataQuick(..., resolve))`:
     *   • _switchingSymbol залипал в true  -> ЛЮБОЙ следующий клик по тикеру
     *     молча уходил в очередь и не выполнялся («нажимаю — ничего не
     *     происходит», «через раз не открывает»);
     *   • чёрный оверлей оставался с opacity:1 -> «пустой/чёрный график»;
     *   • priceManager/timerManager стояли в suspend -> цены не обновлялись;
     *   • очередь _pendingSwitchRequest не диспетчеризировалась.
     * Теперь у каждого ожидания кадра есть запасной setTimeout: цепочка
     * доходит до конца даже без rAF, ровно один раз.
     */
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

    /** await с жёстким лимитом: защита от «вечно незавершающегося» промиса. */
    _withTimeout(promise, ms, onTimeout) {
        let timer = null;
        const guard = new Promise((resolve) => { timer = setTimeout(() => {
            try { resolve(onTimeout ? onTimeout() : undefined); } catch (e) { resolve(undefined); }
        }, ms); });
        return Promise.race([Promise.resolve(promise), guard])
            .finally(() => { if (timer !== null) clearTimeout(timer); });
    }

    /** Отметка прогресса переключения — для сторожа залипания (_switchWatchdog). */
    _switchProgress() { this._switchProgressAt = Date.now(); }

    /**
     * Сторож переключения символа/ТФ.
     *
     * Если переключение не продвигается дольше лимита (rAF не тикает в скрытой
     * вкладке, IndexedDB не отвечает, сеть «висит» без таймаута и т.п.),
     * принудительно возвращаем приложение в рабочее состояние: гасим затемнение,
     * снимаем флаги, возобновляем обновления и диспетчеризуем отложенный запрос.
     * Без этого панель тикеров оставалась заблокированной до перезагрузки страницы.
     *
     * Идентификатор прогона — ownerToken (а не поколение): поколение может
     * легально смениться фоном (loadInitialData/refreshCandlesInBackground),
     * это не повод бросать наблюдение.
     */
    _armSwitchWatchdog(kind, ownerToken, stallMs = 20000) {
        this._switchProgress();
        if (this._switchWatchdogTimer !== null) { clearTimeout(this._switchWatchdogTimer); this._switchWatchdogTimer = null; }
        if (this._destroyed) return;
        const check = () => {
            this._switchWatchdogTimer = null;
            if (this._destroyed) return;
            if (this._switchOwnerToken !== ownerToken) return;      // прогон завершён/заменён
            if (!this._switchingSymbol && !this._isSwitchingInterval) return;
            const stalledFor = Date.now() - (this._switchProgressAt || 0);
            if (stalledFor < stallMs) {                             // прогресс есть — наблюдаем дальше
                this._switchWatchdogTimer = setTimeout(check, Math.min(stallMs, 5000));
                return;
            }

            console.error(`❌ [VP-STUCK] ${kind} не завершилось за ${Math.round(stalledFor / 1000)} с — принудительно разблокирую график`);
            // обнуляем владельца и делаем «залипший» прогон чужим, чтобы он не смог
            // применить свои данные и не снял блокировку у следующего переключения
            this._switchOwnerToken = null;
            this._activeGeneration = ++this._generationCounter;
            try { this._abortAllProcesses(); } catch (e) {}
            this._switchingSymbol = false;
            this._isSwitchingInterval = false;
            this._updatesSuspended = false;
            try { if (this.priceManager) this.priceManager.resume?.(); } catch (e) {}
            this._hideSymbolSwitchOverlay();
            // панель и шапка уже показали запрошенный символ — возвращаем их к тому,
            // что РЕАЛЬНО на графике, иначе клик по «подсвеченному» тикеру снова
            // упирался бы в защиту от повторного переключения.
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
    // ==========================================================================
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

            // [ВЫРАВНИВАНИЕ] добавились пропущенные свечи -> пересчёт залоченного масштаба
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
            // [ШАГ 1] Удалены requestDrawingsRedraw + scheduleDrawingsUpdate(true)
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
            // [ШАГ 1] Удалён requestDrawingsRedraw()

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
        // [PERF-PAN] ChartManager синхронизирует панели ОДНИМ rAF на все панели.
        // IndicatorPanelManager видит этот флаг и не дублирует синхронизацию
        // своим отдельным rAF на каждую панель (раньше setVisibleLogicalRange
        // вызывался дважды за кадр на панель + лишний echo-обработчик с
        // matches(':hover') — принудительный recalc стиля каждый кадр).
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
            // [HIST-FIX] Проверяем левый край ПРЯМО ВО ВРЕМЯ скролла (троттлинг 120 мс),
            // а не только через 150 мс после остановки. Иначе быстрая прокрутка на 1m
            // успевала доехать до пустого края раньше, чем вообще стартовала загрузка.
            this._checkHistoryPreloadLive(range);
            // [PERF-GATE2] Убран timeScale().options() на каждое событие: это КЛОН
            // всего объекта опций на каждый кадр скролла/зума (мусор для GC).
            // barSpacing теперь читается один раз при остановке скролла (ниже).
            clearTimeout(this._scrollStopTimeout);
            // [ШАГ 1] Удалено this._pendingDrawingsRedraw = true;

            this._scrollStopTimeout = setTimeout(() => {
                this._isScrolling = false;
                this._isScrollingFast = false;
                // [PERF-GATE2] читаем barSpacing один раз при остановке
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
                // [ШАГ 1] Удалён блок if (this._pendingDrawingsRedraw) { ... }
            }, 150);

            // [PERF-GATE2] Убран timerManager._primitive.requestRedraw() на каждое
            // событие range: при изменении диапазона график и так перерисовывается,
            // примитив отрисуется в том же кадре — вызов лишь плодил инвалидации.

            if (range && this.indicatorManager?.panelManager && !this._isSyncing) {
                // [CROSSHAIR-PERF] panels — Map: раньше panels.length был undefined,
                // и синхронизация панелей при скролле НЕ выполнялась никогда.
                const panels = this._getPanelsList();
                if (panels.length > 0 && !this._panelsSyncRafId) {
                    this._panelsSyncRafId = requestAnimationFrame(() => {
                        this._panelsSyncRafId = null;
                        // [TF-SWITCH] Во время переключения символа/таймфрейма панели НЕ синхронизируем:
                        // их серии ещё содержат данные СТАРОГО ТФ, а новый диапазон главного графика
                        // показывал бы в них «чужое» окно — визуально гэпы/мусор, пока не приедет
                        // пересчёт индикаторов. После пересчёта панели выровняет syncPanelsNow().
                        if (this._switchingSymbol || this._isSwitchingInterval) return;
                        this._isSyncing = true;
                        // [PERF-PAN] берём САМЫЙ СВЕЖИЙ диапазон (за кадр могло
                        // прийти несколько событий) и глушим «эхо» панелей:
                        // иначе panelRangeHandler панели отвечал бы обратной
                        // синхронизацией главного графика на каждый кадр.
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
                // [ШАГ 1] Удалён this.scheduleDrawingsUpdate(true);
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
            // [DRAW-DRAG] разблок скролла на ЛЮБОМ mouseup (window, capture) —
            // страховка: даже если менеджер рисовалок «потерял» отпускание.
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
            this.unlockChartScrollForDrawing();   // [DRAW-DRAG]
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
    // [PERF-GATE2] Троттлинг полного пересчёта индикаторов (<= 2 раз/с, trailing).
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

    /**
     * [VP-PRECISION] Точность тикера.
     *
     * Две прежние ловушки:
     *   • `Number(null) === 0`, поэтому неудача запроса записывала в localStorage
     *     точность «0 знаков» и портила формат цены НАВСЕГДА (значение оттуда
     *     больше не перезапрашивается). Теперь null/undefined отсекаются явно.
     *   • гонка с 1-секундным таймаутом оставляла запрос «висеть»: если он
     *     завершался позже, результат всё равно писался в кэш — это оставлено
     *     намеренно (точность пригодится), но только при валидном значении.
     */
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

    /** Валидация и запись точности. Мусор (null/NaN/отрицательное) игнорируется. */
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

        // [PERF-GATE2] Предохранитель: даже если scheduleUpdate() дёргают снаружи
        // на каждый тик, полный пересчёт индикаторов — не чаще 2 раз/с и всегда
        // с «хвостовым» пересчётом (последние данные не потеряются).
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

    // =============== PRICE LINE (TICKS) ===============
    // [PERF-GATE] На горячих монетах aggTrade летит 50-200 раз/с, и каждый тик
    // тянул полную перерисовку графика (series.update + объёмы + цвет линии +
    // заголовок) до 60 раз/с. Гейт оставляет не более 10 перерисовок в секунду.
    // Тики внутри окна НЕ теряются: последний сохраняется в _pendingPriceUpdate
    // и в конце окна гарантированно применяется через _flushPendingPrice —
    // цена на графике отстаёт максимум на 100 мс.
    // На OHLC свечи это не влияет: авторитетные данные приходят из WS kline
    // (updateLastCandle) и _syncRecentCandles — они не троттлятся.
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

        // [PERF-GATE] окно 100 мс: внутри окна только копим последний тик
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

    // [PERF-GATE] Флаш последнего тика, накопленного за окно гейта:
    // график всегда догоняет до актуальной цены (отставание не более ~100 мс).
    _flushPendingPrice() {
        if (this._destroyed) return;
        if (this._updatesSuspended || !this._isChartValid() || this._isRestoringZoom || this._isSwitchingInterval) {
            this._pendingPriceUpdate = null;
            return;
        }
        if (!this._pendingPriceUpdate || this._pendingPriceUpdate.price === undefined) return;
        this._lastPriceGateAt = Date.now();
        if (this._priceUpdateRafId !== null) return; // перерисовка уже запланирована — она возьмёт свежую цену
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
            // [FIX-M1] сохраняем _eventTime последней свечи: тик aggTrade не должен
            // обнулять его, иначе событийный guard порядка в updateLastCandle
            // деградирует до сравнения по стенному receivedAt.
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
            // [ШАГ 1] Удалён this.requestDrawingsRedraw();
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
        // [VP-STUCK] опрос шёл ТОЛЬКО через requestAnimationFrame и БЕЗ лимита:
        // в скрытой/свёрнутой вкладке rAF не вызывается, поэтому ожидание не
        // заканчивалось никогда (вместе с ним вставал syncAllDrawings).
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
            const fallback = setTimeout(done, 1500);   // жёсткий лимит ожидания
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
      // =============== SET DATA ===============
    setDataQuick(data, interval, symbol, exchange = 'binance', marketType = 'futures', forceNewSymbol = false, onReady = null) {
        // [VP-STUCK] единая точка выхода для ранних return'ов (до fireReady ниже)
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

            // [VP-STUCK] onReady ОБЯЗАН сработать ровно один раз и при любых
            // обстоятельствах: именно на нём висит await внутри switchSymbol /
            // switchInterval / loadInitialData. Раньше он вызывался только из
            // цепочки двойного requestAnimationFrame — при скрытой/свёрнутой
            // вкладке (rAF не тикает) или при исключении в одном из колбэков
            // переключение зависало навсегда: чёрный оверлей, «пустой» график и
            // полностью заблокированная панель тикеров.
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

            // [FIX] Убран _relockPriceScaleWidth() — именно он менял ширину правой
            // шкалы ПОСЛЕ того, как layout уже устоялся, и сбивал зум у монет,
            // точность которых не была в кэше. Точность всё равно закэшируется —
            // она применится при следующем открытии монеты или при switchSymbol.
            if (typeof getPrecisionFromExchange === 'function') {
                getPrecisionFromExchange(symbol, exchange, marketType).then(precision => {
                    // [VP-PRECISION] null при неудаче — НЕ записываем (раньше
                    // Number(null) давал 0 и портил формат цены навсегда).
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
            // [HIST-FIX] сбрасываем состояние пагинации под новые данные
            this._historyPrefetchRunning = false;
            if (this._historyThrottleRetry) { clearTimeout(this._historyThrottleRetry); this._historyThrottleRetry = null; }
            this._lastHistoryCheckAt = 0;
            // [HIST-FIX] и сразу копаем историю ВГЛУБЬ в фоне: к моменту, когда
            // пользователь долистает до края, страницы уже будут в памяти.
            this._scheduleDeepPrefetch();
        } catch (error) {
            console.error('❌ Ошибка в setDataQuick:', error);
            if (this.chart) this.chart.applyOptions({ handleScroll: true, handleScale: true });
            earlyReady();
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
        // [PERF-GATE] выбрасываем отложенный тик СТАРОГО символа/ТФ, чтобы он
        // не вылез на новый график после завершения переключения.
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
        // [FIX-D3] Храним ТОЛЬКО явно запрошенные поля. Раньше базой служил снапшот
        // текущих symbol/exchange/marketType в момент постановки в очередь: клик по
        // ТФ во время switchSymbol('spot') запоминал marketType='futures', и
        // _dispatchPendingSwitch потом молча отменял смену рынка.
        this._pendingSwitchRequest = Object.assign({}, this._pendingSwitchRequest || {}, partial);
    }

    _dispatchPendingSwitch() {
        if (this._pendingSwitchRequest) {
            const req = this._pendingSwitchRequest;
            this._pendingSwitchRequest = null;
            // [FIX-D3] Незапрошенные поля берём из ТЕКУЩЕГО состояния на момент
            // диспетчеризации, а не из снапшота в момент постановки в очередь.
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

    // =============== SWITCH SYMBOL ===============
    /**
     * [VP-LOAD] Смена символа.
     *
     * ЧТО БЫЛО: ровно ОДИН запрос кэша и РОВНО ОДИН запрос к бирже, после чего
     * сразу `throw new Error('Нет данных для ' + symbol)`. При этом:
     *   • у switchInterval такой же сценарий ещё в [VP-TF] обзавёлся двумя
     *     повторами («первый REST после пробуждения страницы может вернуть
     *     пусто»), а switchSymbol — НЕТ. То есть самый частый путь (клик по
     *     тикеру) оставался самым хрупким;
     *   • параллельно стартовал _prefetchPrecision(), который (из-за
     *     дубля getPrecisionFromExchange) качал весь exchangeInfo Binance
     *     — до 17 МБ без таймаута, забивая канал именно в тот момент, когда
     *     грузились свечи;
     *   • причина отказа терялась: и «нет сети», и 429, и «тикер не торгуется
     *     на этом рынке» давали один и тот же текст «Нет данных для SYMBOL»;
     *   • после ошибки шапка и тикер-панель УЖЕ показывали новый символ, а
     *     график оставался старым, и пользователь не получал никакого сигнала.
     *
     * ЧТО СТАЛО: загрузка через _loadCandlesResilient (кэш → сеть с повторами
     * и запасными хостами → соседний рынок/биржа → устаревший кэш), внятная
     * причина, тост с кнопкой «Повторить» и откат UI к символу, который
     * реально остался на графике.
     *
     * @returns {Promise<boolean>} true — данные применены; false — не удалось.
     */
    async switchSymbol(symbol, exchange, marketType) {
        if (this._switchingSymbol || this._isSwitchingInterval) {
            this._queuePendingSwitch({ symbol, exchange, marketType });
            return false;
        }
        const requested = { symbol, exchange, marketType };
        // [VP-LOAD] куда откатывать UI, если переключение не состоится
        const fallbackUi = {
            symbol: this.currentSymbol, exchange: this.currentExchange, marketType: this.currentMarketType
        };

        this._switchingSymbol = true;
        this._showSymbolSwitchOverlay();
        this._suspendAllUpdates();

        // [FIX-D1b] Интервал мог быть изменён «снаружи» до входа (_dispatchPendingSwitch
        // фиксирует его до вызова switchSymbol). Если данные загрузить не удастся —
        // откатим интервал/хранилище/WS, чтобы источники истины не разъехались.
        const prevInterval = this.currentInterval;

        const generationId = ++this._generationCounter;
        this._activeGeneration = generationId;
        // [VP-STUCK] сторож: если переключение встанет (скрытая/свёрнутая вкладка —
        // rAF не тикает, мёртвый IndexedDB, зависший await), график разблокируется
        // сам, а не «навсегда», как раньше.
        const ownerToken = Symbol('switchSymbol');
        this._switchOwnerToken = ownerToken;
        this._armSwitchWatchdog('переключение символа ' + requested.symbol, ownerToken);
        let dataApplied = false;
        // владеет ли ещё ЭТОТ прогон переключением (сторож мог снять флаги и
        // передать управление новому запросу)
        const stillOwner = () => this._switchOwnerToken === ownerToken && this._activeGeneration === generationId;

        try {
            // [VP-LOAD] Явная смена РЫНКА того же символа (Alt+T, кнопки
            // SPOT/PERP) — намеренное действие пользователя. Автоматический
            // возврат на рынок, с которого он только что ушёл, был бы
            // извращением смысла команды, поэтому фолбэки здесь отключены:
            // вместо тихого «остались где были» показываем причину.
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
                // «aborted» = нас сознательно отменило более новое переключение:
                // это не ошибка и показывать пользователю нечего.
                if (loaded.reason !== 'aborted') {
                    const err = new Error(loaded.reason || this._describeLoadFailure(
                        symbol, exchange, marketType, this.currentInterval, loaded.errors, loaded.networkMissing
                    ));
                    err.vpNoData = true;
                    throw err;
                }
                return false;
            }

            // [VP-LOAD] данные нашлись на соседнем рынке/бирже — принимаем их как текущие
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
            // [VP-PRECISION] Точность добираем ЗДЕСЬ, а не параллельно со свечами.
            // Раньше _prefetchPrecision() стартовал ПЕРЕД загрузкой и (из-за дубля
            // getPrecisionFromExchange в Utils.js/PrecisionHelper.js) тянул весь
            // exchangeInfo Binance — до 17 МБ без таймаута, — отбирая канал у
            // fetchKlines. Теперь свечи уже получены, запрос лёгкий, а формат цены
            // известен ДО первой отрисовки (иначе цена «переключалась» с 2 знаков на
            // 6 уже на глазах). Внутри — гонка с лимитом 1.5 с: зависнуть не может.
            await this._prefetchPrecision(symbol, exchange, marketType);
            this._switchProgress();
            if (this._activeGeneration !== generationId || this._destroyed) return false;
            const cachedPrecision = this._getCachedPrecision(symbol, exchange, marketType);
            if (cachedPrecision) this.applyPriceFormat(parseInt(cachedPrecision, 10));
            if (!this._isChartValid()) return false;

            let cacheRefreshPromise = null;
            if (isFromCache) {
                cacheRefreshPromise = Promise.race([
                    this.refreshCandlesInBackground(symbol, exchange, marketType, this.currentInterval).catch(() => {}),
                    new Promise(r => setTimeout(r, 2500))
                ]);
            }

            // [VP-STUCK] ждём финализацию отрисовки, но НЕ вечно: onReady внутри
            // setDataQuick теперь гарантирован (try/finally + запасной setTimeout
            // вместо голого requestAnimationFrame), а сверху — жёсткий лимит.
            // Иначе один не сработавший колбэк навсегда оставлял _switchingSymbol=true,
            // чёрный оверлей и полностью мёртвую панель тикеров.
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

            if (cacheRefreshPromise) await cacheRefreshPromise;
            if (this._activeGeneration !== generationId) return true;

            if (!isFromCache) {
                this.saveCandlesToCache(symbol, exchange, marketType, this.currentInterval, candles).catch(() => {});
            }
            try {
                localStorage.setItem('lastSymbol', symbol);
                localStorage.setItem('lastExchange', exchange);
                localStorage.setItem('lastMarketType', marketType);
            } catch (e) {}
            // [FIX] Загрузка рисунков для нового символа — через координатор,
            // он сам раздаст данные по всем менеджерам.
            if (window.drawingLoaderCoordinator) {
                window.drawingLoaderCoordinator.loadAllForSymbol(this.getCurrentSymbolKey()).catch(() => {});
            }

            // [VP-PRECISION] страховка: если выше точность получить не удалось
            // (null в localStorage не пишем), пробуем ещё раз в фоне — формат
            // цены применится, как только биржа ответит.
            if (!this._getCachedPrecision(symbol, exchange, marketType)) {
                this._prefetchPrecision(symbol, exchange, marketType).catch(() => {});
            }

            if (loaded.alt) {
                this._notifyUser({
                    title: '↪ Рынок переключён',
                    text: `${requested.symbol}: на ${requested.exchange}/${requested.marketType} данных нет — ` +
                          `показан ${exchange}/${marketType}`,
                    color: '#ffa500',
                    duration: 6000
                });
                // UI (шапка/тикер) должен следовать за фактическим рынком
                this._revertSymbolUi(symbol, exchange, marketType);
            } else if (loaded.stale) {
                this._notifyUser({
                    title: '⚠️ Биржа не ответила',
                    text: `${symbol}: показаны свечи из кэша, идёт досинхронизация`,
                    color: '#ffa500',
                    duration: 6000
                });
            }

            this._notifySymbolChange();
            return true;
        } catch (error) {
            // [VP-LOAD] причина — в тексте ошибки, а не «Нет данных для SYMBOL»
            console.error(`❌ Не удалось переключиться на ${requested.symbol} ` +
                `(${requested.exchange}/${requested.marketType}):`, error && error.message ? error.message : error);
            // [VP-STUCK] символ/биржа/рынок присваиваются ДО применения данных:
            // если данные так и не легли, возвращаем их к реальному состоянию
            // графика — иначе chartManager.currentSymbol расходился и с графиком,
            // и с шапкой (WS-подписка ниже переставляется обратно).
            if (!dataApplied && !this._destroyed && this._activeGeneration === generationId &&
                this.currentSymbol !== fallbackUi.symbol) {
                this.currentSymbol = fallbackUi.symbol;
                this.currentExchange = fallbackUi.exchange;
                this.currentMarketType = fallbackUi.marketType;
                try { this._subscribeToPrice(); } catch (e) {}
            }
            // [FIX-D1b] откат интервала, зафиксированного извне, если данные не применились
            if (!dataApplied && !this._destroyed && this._activeGeneration === generationId &&
                this.currentInterval !== prevInterval) {
                this.currentInterval = prevInterval;
                try { localStorage.setItem('lastTimeframe', prevInterval); } catch (e) {}
                if (window.wsManager?.updateSymbolAndTimeframe) {
                    window.wsManager.updateSymbolAndTimeframe(this.currentSymbol, prevInterval, this.currentExchange, this.currentMarketType);
                }
            }
            if (!dataApplied && !this._destroyed && this._activeGeneration === generationId) {
                // график остался на прежнем символе — возвращаем туда же шапку и тикер
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
            if (this._destroyed) { this._clearSwitchWatchdog(); return; }
            this._clearSwitchWatchdog();
            // [VP-STUCK] общее состояние снимает ТОЛЬКО владелец переключения.
            // «Оживший» после сторожа старый прогон раньше сбрасывал
            // _switchingSymbol/_updatesSuspended у НОВОГО переключения и
            // диспетчеризовал очередь посреди чужой загрузки.
            const owner = stillOwner();
            if (owner) {
                this._switchingSymbol = false;
                this._updatesSuspended = false;
                if (this.priceManager) this.priceManager.resume?.();
            }
            if (dataApplied) {
                if (owner) { this._startPeriodicSync(); this._startNewCandleChecker(); }
                // [FIX-JUMP] Затемнение гасим ТОЛЬКО после того, как первый
                // _syncRecentCandles() усадит график (он может догрузить свечи и
                // дёрнуть autoScale). Жёсткий лимит 1200мс — чтобы оверлей не залипал.
                const genAtHide = this._activeGeneration;
                Promise.race([
                    this._syncRecentCandles().catch(() => {}),
                    new Promise(r => setTimeout(r, 1200))
                ]).then(() => {
                    if (this._destroyed) return;
                    if (this._activeGeneration !== genAtHide) return; // уже другое переключение
                    this._hideSymbolSwitchOverlay();
                });
            } else {
                this._hideSymbolSwitchOverlay();
            }
            if (owner) this._dispatchPendingSwitch();
        }
    }

       async switchInterval(newInterval) {
        // [FIX-D2] Отложенное переключение возвращает маркер {queued:true}, чтобы
        // вызывающий (TimeframeManager) не принял мгновенный возврат за «интервал
        // не сменился» и не откатил бейдж поверх применённого позже переключения.
        if (this._isSwitchingInterval || this._switchingSymbol) { this._queuePendingSwitch({ interval: newInterval }); return { queued: true }; }
        if (this.currentInterval === newInterval) return;

        this._isSwitchingInterval = true;
        this._showSymbolSwitchOverlay();
        const generationId = ++this._generationCounter;
        this._activeGeneration = generationId;
        // [VP-STUCK] тот же сторож, что и в switchSymbol
        const ownerToken = Symbol('switchInterval');
        this._switchOwnerToken = ownerToken;
        this._armSwitchWatchdog('переключение таймфрейма ' + newInterval, ownerToken);
        const stillOwner = () => this._switchOwnerToken === ownerToken && this._activeGeneration === generationId;
        this._stopPeriodicSync();
        this._stopCandleChecker();

        // [VP-KLINES] гасим все in-flight запросы (данные уже чужие), включая 'switch'
        this._abortAllFetchControllers();
        this._historyPrefetchRunning = false;

        this._lastKlineEventTime = 0;
        this._catchingUpMissed = false;
        this._lastCatchUpAttempt = 0;
        this._lastInferredPrecision = null;

        if (window.wsManager?.clearKlineQueue) window.wsManager.clearKlineQueue();

        // [FIX-JUMP2] Флаги для «плавного» снятия затемнения (см. finally ниже).
        let intervalApplied = false;  // данные нового ТФ реально легли на график
        let bgRefreshDone = false;    // фоновый досинхрон кэша успел отработать ПОД оверлеем

        try {
            this._suspendAllUpdates();
            // [FIX-D1] Интервал, localStorage и WS-подписка фиксируются ТОЛЬКО после
            // успешного получения данных. Раньше состояние уходило на новый ТФ до
            // загрузки, и при ошибке сети бейдж/WS/хранилище говорили «4h», а на
            // графике оставались часовые свечи; после восстановления сети WS-клины
            // нового шага дописывались в массив старого — серия превращалась в кашу.
            // [VP-TF/VP-LOAD] прежнее «до 2 повторов через 1.2 с» заменено общим
            // загрузчиком: кэш -> сеть с повторами и запасными хостами -> устаревший
            // кэш. Логика та же, но попыток больше и причина отказа видна.
            const loaded = await this._loadCandlesResilient(
                this.currentSymbol, this.currentExchange, this.currentMarketType,
                newInterval, this._initialBatch || 1000, { requestType: 'switch' }
            );
            this._switchProgress();
            if (this._activeGeneration !== generationId || this._destroyed) return;
            let candles = loaded.candles;
            let isFromCache = !!loaded.fromCache;
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

            // [VP-STUCK] с жёстким лимитом: без него зависший onReady держал
            // _isSwitchingInterval=true и чёрный оверлей до перезагрузки страницы.
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
                // [FIX-JUMP2] race вернёт true, если фон УСПЕЛ досинхронить кэш под
                // оверлеем (отдельный _syncRecentCandles в finally тогда не нужен),
                // и false, если сработал лимит 2500мс — данные могли остаться старыми.
                bgRefreshDone = await Promise.race([
                    this.refreshCandlesInBackground(this.currentSymbol, this.currentExchange, this.currentMarketType, this.currentInterval).then(() => true, () => true),
                    new Promise(r => setTimeout(() => r(false), 2500))
                ]) === true;
                if (this._activeGeneration !== generationId) return;
            }
            // [FIX] Загрузка рисунков для нового таймфрейма — та же логика, что в switchSymbol.
            // При смене ТФ координатор перечитает данные с новым ключом (символ тот же, но объекты
            // могут отфильтроваться по timeframeVisibility внутри каждого менеджера).
            if (window.drawingLoaderCoordinator) {
                window.drawingLoaderCoordinator.loadAllForSymbol(this.getCurrentSymbolKey()).catch(() => {});
            }
        } catch (error) { console.error('❌ Ошибка переключения таймфрейма:', error); }
        finally {
            if (this._destroyed) { this._clearSwitchWatchdog(); return; }
            this._clearSwitchWatchdog();
            // [VP-STUCK] см. switchSymbol: состояние трогает только владелец
            const owner = stillOwner();
            if (owner) {
                this._isSwitchingInterval = false;
                this._updatesSuspended = false;
                if (this.priceManager) this.priceManager.resume?.();
                this._startPeriodicSync();
                this._startNewCandleChecker();
            }
            // [FIX-JUMP2] Затемнение при смене ТФ снимается ТОЛЬКО после того, как
            // график «уселся». Что могло дёрнуть его уже НА ВИДУ:
            //   • _syncRecentCandles() догружает пропущенные свечи -> autoScale() (~стр. 924);
            //   • _startNewCandleChecker() сразу гоняет _catchUpMissedCandles();
            //   • _healDataGaps() лечит дырки асинхронно и тоже перерисовывает.
            // Теперь всё это происходит под чёрным оверлеем — как в switchSymbol.
            // Досинхрон пропускаем, если кэш уже досинхронизирован под оверлеем
            // (bgRefreshDone === true) — лишний сетевой запрос не нужен.
            const stale = this._activeGeneration !== generationId; // уже другое переключение
            if (stale || !intervalApplied) {
                // либо график уже принадлежит другому переключению (оверлей гасит оно),
                // либо данные нового ТФ не легли (ошибка) — ждать нечего, гасим сразу.
                this._hideSymbolSwitchOverlay();
            } else {
                const genAtHide = this._activeGeneration;
                const settle = (!bgRefreshDone)
                    // кэш НЕ был досинхронизирован под оверлеем -> делаем это сейчас,
                    // иначе он досинхронизируется позже и дёрнет масштаб уже на виду.
                    ? Promise.race([
                        this._syncRecentCandles().catch(() => {}),
                        new Promise(r => setTimeout(r, 1200))   // жёсткий лимит: оверлей не залипнет
                    ])
                    // кэш досинхронизирован -> хватит короткой паузы, чтобы
                    // индикаторы/разделители/хайлайты дорисовались под затемнением.
                    : new Promise(r => setTimeout(r, 60));
                // [VP-STUCK] _doubleFrame вместо голого двойного rAF: в скрытой
                // вкладке затемнение иначе не гасло вообще.
                settle
                    .then(() => new Promise(r => this._doubleFrame(r)))
                    .then(() => {
                        if (this._destroyed) return;
                        if (this._activeGeneration !== genAtHide) return; // график уже чужой
                        this._hideSymbolSwitchOverlay();
                    });
            }
            if (owner) this._dispatchPendingSwitch();
        }
    }
    // [ШАГ 1] Метод loadDrawingsForCurrentSymbol() удалён целиком

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
            // [VP-LOAD] первый вход в приложение грузится тем же надёжным
            // контуром, что и смена символа: холодный старт (кэша ещё нет,
            // сеть/IndexedDB могут быть не готовы) — самый частый источник
            // «пустого графика при открытии страницы».
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
            // [VP-STUCK] лимит ожидания финализации — иначе «пустой график при
            // открытии страницы» залипал навсегда, если страница стартовала скрытой.
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

    // =============== CROSSHAIR ===============
    onCrosshairMove(param) {
        this._pendingCrosshairParam = param;
        // [CROSSHAIR-PERF] Пока мышь движется по графику — тяжёлые пересчёты
        // индикаторов не запускаются (см. IndicatorManager.updateAllIndicators).
        // Через 150 мс покоя флаг снимается и отложенное выполняется разом.
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

    // [CROSSHAIR-PERF] panelManager.panels — это Map (и panel.series — тоже Map),
    // а здесь их исторически перебирали как массив (panels.length / panels[i] /
    // for..of по Map без .values()). Все эти циклы МОЛЧА не выполнялись:
    // синхронизация панелей (скролл, перекрестие, resize) была мертва.
    // Хелперы возвращают нормальный массив из любой формы.
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

    // [DRAW-PERF] Тащит ли пользователь прямо сейчас какой-либо инструмент рисования
    // (алерт, тренд, луч, линейку, текст, стоп/тейк)? Пока идёт перетаскивание,
    // тяжёлые фоновые операции (пересчёт/применение индикаторов, синхронизация
    // перекрестия панелей) откладываются — иначе они вклиниваются между кадрами
    // и объект «дёргается» в руке.
    _isDrawingDragActive() {
        const w = window;
        return !!((w.alertLineManager && w.alertLineManager._isDragging) ||
            (w.trendLineManager && w.trendLineManager._isDragging) ||
            (w.rayManager && w.rayManager._isDragging) ||
            (w.rulerLineManager && w.rulerLineManager._isDragging) ||
            (w.textManager && w.textManager._isDragging) ||
            (w.tradeLevelManager && w.tradeLevelManager._isDragging));
    }

    // =============== [DRAW-DRAG] БЛОКИРОВКА СКРОЛЛА НА ВРЕМЯ ДРАГА ===============
    // Поведение как в TradingView: взял линию/алерт/тренд — график замер, отпустил —
    // снова скроллится. Без блокировки LW-панорамирование (handleScroll.pressedMouseMove)
    // начиналось ОДНОВРЕМЕННО с перетаскиванием: range-события взводили _isScrolling,
    // mousemove-обработчики рисовалок из-за этого сбрасывали события — линия «замерзала»
    // в руке (алерт двигался рывками), а график и панели индикаторов перерисовывались
    // каждый кадр. LW читает handleScroll на КАЖДОМ mousemove, поэтому блокировка,
    // выставленная в mousedown, гасит панораму уже со следующего кадра.
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
            // [CROSSHAIR-PERF] де-дуп: не дёргаем clearCrosshairPosition (= redraw
            // панели) каждый кадр, если перекрестие уже снято.
            if (!this._panelCrosshairLast.has(panel)) continue;
            this._panelCrosshairLast.delete(panel);
            try { panel.chart.clearCrosshairPosition(); } catch (e) {}
        }
    }

    _syncPanelsCrosshairOptimized() {
        if (!this._latestCrosshairData || !this._latestCrosshairData.visible) { this._clearPanelsCrosshair(); return; }
        // [DRAW-PERF] Во время перетаскивания рисовалки синхронизацию панелей не гоняем:
        // setCrosshairPosition — это лишняя перерисовка каждой панели на каждый кадр.
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
                    // [CROSSHAIR-PERF] де-дуп: setCrosshairPosition = перерисовка панели.
                    // Мышь в пределах одной свечи (time/value те же) — не перерисовываем.
                    const last = this._panelCrosshairLast.get(panel);
                    if (last && last.time === time && last.value === dataPoint.value) continue;
                    this._panelCrosshairLast.set(panel, { time, value: dataPoint.value });
                    // [FIX] LW v5: setCrosshairPosition(price, time, SERIES). Раньше
                    // третьим аргументом передавали pointX (число) — LW молча выходил
                    // (this.ug.get(n) === undefined), перекрестие панелей не работало.
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

        // [PERF-GATE2] без клона series.options() на каждый кадр кроссхэра
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

    // =============== LOG SCALE (кнопка «Л») ===============
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
            // [CROSSHAIR-PERF] panels — Map (Array.isArray всегда false — блок был
            // мёртв), а поле панели называется content, не container.
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
            // [PERF-GATE2] ГЛАВНАЯ ПРИЧИНА остаточных тормозов на «лидерах роста».
            // Гейт стоял только на _syncPriceLine, но этот же хэндлер на КАЖДЫЙ
            // aggTrade (50-200 раз/с) сверх того делал:
            //   • _updatePageTitle() — series.options() (ПОЛНЫЙ КЛОН опций серии
            //     в lightweight-charts) + конкатенация + запись document.title
            //     ~на каждый тик (цена-то меняется);
            //   • timerManager.updatePrice(price) — примитив делает requestRedraw,
            //     т.е. ПОЛНУЮ перерисовку канваса графика с частотой тиков.
            //     Гейт 10 раз/с таким образом обходился «чёрным ходом».
            // Теперь на тик — только запись currentRealPrice. Титул — свой
            // троттлинг 2 раза/с; цена на графике и в таймере — через гейт
            // (_applyPriceUpdate сам вызывает timerManager.updatePrice, 10 раз/с).
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
            this._titlePrecision = p;   // [PERF-GATE2] кэш для титула/кроссхэра
            this._drawingPrecisionKey = null;   // [PERF-PAN] сброс кэша точности рисовалок
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

    // =============== VALIDATION ===============
    _isValidCandle(candle, nowSecHint = null) {
        if (!candle || typeof candle !== 'object') return false;
        if (typeof candle.time !== 'number' || isNaN(candle.time) || candle.time <= 0) return false;
        if (!Number.isInteger(candle.time)) return false;
        // [VP-CLOCK] nowSecHint=null -> берём время с поправкой на сервер биржи
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
        const nowSec = this._nowSec();   // [VP-CLOCK]
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
    // =============== FETCH KLINES ===============
    // [VP-KLINES] «Сырые» карты интервалов Bybit — на уровне модуля, чтобы не
    // пересоздавать объект на каждый запрос.
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

    /**
     * Публичная загрузка свечей. Сигнатура и контракт НЕ изменились:
     * массив свечей (возможно пустой — «истории у тикера нет») либо null,
     * если данные получить не удалось. Внутри — повторы, запасные хосты и
     * диагностика (см. _fetchKlinesResilient).
     */
    async fetchKlines(symbol, exchange, marketType, interval, limit = 1000, endTime = null, requestType = 'user') {
        const res = await this._fetchKlinesResilient(symbol, exchange, marketType, interval, limit, endTime, requestType);
        return res ? res.candles : null;
    }

    /** То же, но с описанием источника/причины отказа — для switchSymbol. */
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

    /**
     * Приведение аргументов запроса к тому виду, который понимают биржи.
     *
     * Зачем: interval берётся из localStorage/бейджей и может оказаться
     * мусором, которого нет ни в INTERVAL_SECONDS_MAP, ни у биржи (например
     * '2h' на Bybit futures или сохранённый с прошлой версии '45m'). Раньше
     * такое значение уходило в URL как есть, биржа отвечала HTTP 400, и
     * переключение символа падало с «Нет данных» на ЛЮБОМ тикере.
     */
    _normalizeKlinesRequest(symbol, exchange, marketType, interval) {
        let sym = String(symbol == null ? '' : symbol).trim().toUpperCase().replace(/[\s/\\:-]/g, '');
        const ex = String(exchange || 'binance').toLowerCase() === 'bybit' ? 'bybit' : 'binance';
        const mt = String(marketType || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
        // 'SUIUSDT.P' — формат Bybit; у Binance такой тикер невозможен.
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

    /** Отмена всех in-flight REST-запросов (в т.ч. критичного 'switch'). */
    _abortAllFetchControllers() {
        for (const slot of Object.values(FETCH_CONTROLLER_SLOTS)) {
            if (this[slot]) { try { this[slot].abort(); } catch (e) {} this[slot] = null; }
        }
    }

    /**
     * [VP-CLOCK] «Сейчас» в секундах с поправкой на серверное время биржи.
     *
     * Зачем: _isValidCandle() отбрасывала свечи с time > now + 2 интервала,
     * где now — часы УСТРОЙСТВА. При отстающих часах (или после сна ноутбука)
     * под отсев попадал ВЕСЬ свежий батч: REST возвращал HTTP 200 и нормальные
     * данные, а на график не попадало ни одной свечи — снова «Нет данных».
     * Смещение считаем из заголовка Date / поля time ответа Bybit и ограничиваем
     * двумя минутами, чтобы случайный сбой ответа не утащил всю временную шкалу.
     */
    _nowSec() { return Math.floor((Date.now() + this._serverTimeOffsetMs) / 1000); }

    /**
     * Вычисляет смещение часов устройства относительно биржи и ВОЗВРАЩАЕТ
     * серверное «сейчас» в секундах (null, если взять его неоткуда).
     *
     * Зачем два результата:
     *  • серверное «сейчас» используется для валидации только что полученных
     *    свечей — оно ТОЧНОЕ и вообще не зависит от часов пользователя;
     *  • смещение нужно для остальных мест (кэш, новые свечи из WS), где
     *    свежего ответа под рукой нет.
     *
     * Прежняя проверка `candle.time > Date.now()/1000 + 2*interval` отбраковывала
     * ВЕСЬ батч при отстающих часах устройства: биржа отвечала 200 и нормальными
     * данными, а на график не попадало ни одной свечи — «Нет данных для SYMBOL».
     */
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
                serverMs = data.time;   // Bybit v5 отдаёт своё время в теле ответа
            }
            if (serverMs === null || serverMs < 1e12) return null;

            // Date из заголовка имеет точность 1 с + половина RTT на доставку
            const estimatedNow = Date.now() + Math.max(0, Math.round((rttMs || 0) / 2));
            const offset = serverMs - estimatedNow;
            if (!isFinite(offset)) return Math.floor(serverMs / 1000);

            // Ограничиваем разумным пределом: защита от мусорного заголовка,
            // но достаточно большим, чтобы реально исправить сбитые часы.
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

    /**
     * Один HTTP-запрос свечей: свой внутренний AbortController (чтобы таймаут
     * попытки не убивал весь внешний сигнал и оставались повторные попытки).
     *
     * @returns {Promise<Object>} { candles, reason, error, fatal, missing, rawCount }
     *   candles — массив (пустой = «данных у биржи нет»), null = запрос не удался;
     *   fatal   — повторять бессмысленно (геобан, неверный символ, IP-бан);
     *   missing — биржа прямо сказала «такого тикера здесь нет».
     */
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
                // Читаем тело, чтобы вытащить код ошибки биржи: -1121 = Invalid symbol.
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
            // [VP-CLOCK] «сейчас» — по часам БИРЖИ, а не устройства (см. _calibrateServerTime)
            const batchNowSec = (typeof serverNowSec === 'number' && serverNowSec > 1e9)
                ? serverNowSec : this._nowSec();
            const validCandles = noDupes.filter(c => this._isValidCandle(c, batchNowSec));
            validCandles.sort((a, b) => a.time - b.time);
            const currentStart = this._alignTimeForInterval(batchNowSec, norm.interval);
            for (const c of validCandles) {
                this._stampCandle(c, 'rest', requestStartedAt);
                c._closed = c.time < currentStart;
            }

            // Биржа ответила 200 и что-то отдала, но валидация всё снесла.
            // Раньше это молча превращалось в «Нет данных»; теперь причина видна.
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

    /**
     * [VP-KLINES] Загрузка с повторами и запасными хостами.
     *
     * Прежняя версия делала РОВНО ОДИН запрос и при любой неудаче возвращала
     * null. Вызывающий (switchSymbol) не отличал «нет соединения» от «рейт-лимит»
     * от «тикера не существует» и печатал одно и то же «Нет данных для SYMBOL».
     */
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
                this._switchProgress();   // [VP-STUCK] попытка началась — прогресс есть
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
                if (res.reason === 'aborted') break;   // отменено новым переключением — не наше дело
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

    // =============== НАДЕЖНАЯ ЗАГРУЗКА ДАННЫХ СИМВОЛА ===============
    /**
     * [VP-LOAD] Единый загрузчик свечей для смены символа / таймфрейма /
     * первого входа. Порядок попыток:
     *
     *   1. свежий кэш IndexedDB (≤ 5 мин)                       — мгновенно;
     *   2. сеть: повторы + запасные хосты (_fetchKlinesResilient);
     *   3. если биржа ответила «такого тикера здесь нет» — соседний рынок и
     *      соседняя биржа (тот же принцип, что уже давно работает в
     *      WebSocketManager._validateSymbolAsync, но для REST его не было:
     *      сокет подключался, а график оставался пустым);
     *   4. «последний шанс» — устаревший кэш свечей (≤ 24 ч) либо кэш страниц
     *      истории, с фоновым досинхроном;
     *   5. честный отказ с ПРИЧИНОЙ и списком всех ошибок.
     *
     * @returns {Promise<Object>} { candles, fromCache, stale, alt, reason, errors, networkMissing }
     */
    async _loadCandlesResilient(symbol, exchange, marketType, interval, limit, opts = {}) {
        const requestType = opts.requestType || 'switch';
        const allowFallbacks = opts.allowFallbacks !== false;
        const errors = [];
        const isAlive = () => !this._destroyed;

        const finish = (candles, extra) => Object.assign({
            candles: candles && candles.length ? candles : null,
            fromCache: false,
            stale: false,
            alt: null,
            requested: { symbol, exchange, marketType },
            reason: null,
            errors,
            networkMissing: false
        }, extra || {});

        // 1. СВЕЖИЙ КЭШ
        if (opts.allowCache !== false) {
            this._switchProgress();   // [VP-STUCK] обращение к IndexedDB может быть долгим
            const cached = await this.loadCandlesFromCache(symbol, exchange, marketType, interval);
            this._switchProgress();
            if (cached && cached.length && isAlive()) {
                return finish(cached, { fromCache: true });
            }
        }

        // 2. СЕТЬ (основной рынок)
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

        // 3. СОСЕДНИЕ РЫНКИ / БИРЖИ — только если тикера здесь действительно нет
        if (allowFallbacks && networkMissing) {
            const candidates = [
                { exchange, marketType: marketType === 'futures' ? 'spot' : 'futures' },
                { exchange: exchange === 'binance' ? 'bybit' : 'binance', marketType },
                { exchange: exchange === 'binance' ? 'bybit' : 'binance',
                  marketType: marketType === 'futures' ? 'spot' : 'futures' }
            ];
            for (const cand of candidates) {
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

        // 4. ПОСЛЕДНИЙ ШАНС: устаревший кэш (только для критичных загрузок)
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

        // 5. ОТКАЗ
        return finish(null, {
            reason: this._describeLoadFailure(symbol, exchange, marketType, interval, errors, networkMissing),
            errors,
            networkMissing
        });
    }

    /** Возраст самой старой свечи кэша — для понятного предупреждения. */
    _staleCacheAgeText(candles) {
        try {
            const last = candles[candles.length - 1];
            const ageSec = Math.max(0, this._nowSec() - (last ? last.time : 0));
            if (ageSec < 3600) return `${Math.round(ageSec / 60)} мин`;
            if (ageSec < 86400) return `${Math.round(ageSec / 3600)} ч`;
            return `${Math.round(ageSec / 86400)} дн`;
        } catch (e) { return '—'; }
    }

    /**
     * Кэш СТРАНИЦ ИСТОРИИ (type:'hist') — его TTL неделя, и он нередко есть
     * даже тогда, когда 5-минутного кэша символа нет. Собираем из него
     * непрерывный хвост до текущего момента.
     */
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

    /** Человекочитаемая причина отказа — вместо безликого «Нет данных». */
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

    // =============== ПОЛЬЗОВАТЕЛЬСКИЕ УВЕДОМЛЕНИЯ / ОТКАТ UI ===============
    /**
     * Тост в существующий #alertNotification.
     * Раньше любой сбой загрузки был виден ТОЛЬКО в консоли: шапка и тикер-панель
     * уже показывали новый символ, а график оставался старым.
     */
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

    /**
     * Возврат шапки/тикера к символу, который РЕАЛЬНО на графике.
     * Без этого после неудачи UI и график жили разными символами.
     */
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

    /**
     * [VP-WS] Хук, который WebSocketManager зовёт при мёртвом канале или
     * несуществующем тикере. До сих пор в ChartManager такого метода НЕ БЫЛО,
     * поэтому проверка `typeof chartManager.onStreamUnavailable === 'function'`
     * всегда была ложной и пользователь не получал НИКАКОГО сигнала: график
     * просто замирал без объяснений.
     */
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

    // =============== TITLE ===============
    // [PERF-GATE2] Троттлинг титула: не чаще 2 раз/с, обязательно с «хвостовым»
    // вызовом — финальная цена не потеряется. В скрытой вкладке титул и так
    // обновляет _startBackgroundTitleUpdate (1 раз/с).
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

    // [PERF-GATE2] series.options() в lightweight-charts возвращает КЛОН всего
    // объекта опций. Точность меняется только в applyPriceFormat — кэшируем.
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
        this._drawingScrollLock = false;   // [DRAW-DRAG] график перестраивается — скролл включит setDataQuick
        this.isLoadingMore = false;
        this._updateScheduled = false;
        this._pendingUpdates = false;
        this._pendingRedraw = false;
        // [ШАГ 1] Удалены cancelAnimationFrame(this._drawingsUpdateRafId)
        if (this._updatePositionRafId) { cancelAnimationFrame(this._updatePositionRafId); this._updatePositionRafId = null; }
        if (this._priceUpdateRafId) { cancelAnimationFrame(this._priceUpdateRafId); this._priceUpdateRafId = null; }
        // [PERF-GATE] чистим гейт
        if (this._priceGateTimeout !== null) { clearTimeout(this._priceGateTimeout); this._priceGateTimeout = null; }
        this._lastPriceGateAt = 0;
        this._pendingPriceValue = null;
        this._pendingPriceUpdate = null;
        // [VP-KLINES] отменяем ВСЕ in-flight REST-запросы одним проходом —
        // включая критичный 'switch' (его раньше здесь не было).
        this._abortAllFetchControllers();
        this._historyPrefetchRunning = false;
        if (this._historyThrottleRetry) { clearTimeout(this._historyThrottleRetry); this._historyThrottleRetry = null; }
        if (this._updateTimeout) { clearTimeout(this._updateTimeout); this._updateTimeout = null; }
        // [CROSSHAIR-PERF]
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
        // [ШАГ 1] Удалён clearTimeout(this._drawingsFinalUpdateTimeout)
        if (this._scrollStopTimeout) clearTimeout(this._scrollStopTimeout);
        if (this._priceUpdateRafId) { cancelAnimationFrame(this._priceUpdateRafId); this._priceUpdateRafId = null; }
        if (this._crosshairRafId) { cancelAnimationFrame(this._crosshairRafId); this._crosshairRafId = null; }
        // [ШАГ 1] Удалён cancelAnimationFrame(this._drawingsRafId)
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
                // [VP-PRECISION] при неудаче остаётся точность, выведенная из свечей
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

    // [PERF-PAN] Единая точка «привязки» времени рисовалок к свече.
    // O(log N) + кэш результата; кэш сбрасывается, когда данные изменились
    // (trim / prepend / новая свеча). Метод НЕ читает DOM и НЕ вызывает
    // series.options() — его безопасно звать из updateAllViews() каждый кадр.
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

    // [PERF-PAN] «Пол» по свече: наибольшее time такое, что time <= anchor < time+интервал.
    // Семантика ТОЧНО как у старого HorizontalRayPrimitive._syncRayTime
    // (интервал берётся по первым двум свечам; если anchor не попал ни в один
    // интервал — фолбэк на ближайшую свечу), но O(log N) + кэш вместо двух
    // линейных проходов по всему массиву на каждом кадре.
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

    // [PERF-PAN] Индекс ближайшей свечи (бинарный поиск, без кэша — нужен
    // в обработчиках мыши, где anchor каждый раз новый).
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

    // [PERF-PAN] Ближайшая свеча целиком — для «магнита» рисовалок.
    // Заменяет линейный скан chartData в _snapToPrice/_snapToCandle/
    // _findClosestCandleTime (они вызываются на каждое движение мыши).
    findNearestCandle(anchor) {
        const i = this.findNearestCandleIndex(anchor);
        return i >= 0 ? this.chartData[i] : null;
    }

    // [PERF-PAN] Точность цены для подписей рисовалок БЕЗ series.options()
    // (в lightweight-charts options() возвращает ПОЛНЫЙ ГЛУБОКИЙ КЛОН опций
    // серии — раньше такой клон создавался по 4-6 раз на сделку КАЖДЫЙ кадр)
    // и БЕЗ localStorage.getItem() (синхронное чтение хранилища каждый кадр).
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

    // =============== HISTORY LOAD / TRIM ===============
    onVisibleLogicalRangeChange(range) {
        if (!range || !this.chartData.length || !this._isChartValid()) return;
        // [INFINITE-SCROLL] порог догрузки: ~100 свечей до левого края (или один
        // видимый экран при сильном отдалении) — см. _preloadThresholdFor
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
        // [PERF-PAN] trim — это full setData() + пересчёт индикаторов (десятки мс).
        // Раньше он мог выстрелить прямо во время перетаскивания (дебаунс 300 мс
        // срабатывал посреди драга) — отсюда «рывок» при листании на 1m/5m.
        if (this._isScrolling || this._isScrollingFast) return;
        if (this._pendingTrimParams && !this._isTrimming) {
            const { fromIndex, toIndex } = this._pendingTrimParams;
            this._performTrimNow(fromIndex, toIndex);
            this._pendingTrimParams = null;
        }
    }

    _performTrimNow(fromIndex, toIndex) {
        if (this._isTrimming || this.isLoadingMore || !this._isChartValid()) return;
        // [PERF-PAN] двойная защита: никогда не перекладываем данные серии
        // в момент, когда пользователь тащит график.
        if (this._isScrolling || this._isScrollingFast) return;
        if (this.chartData.length <= this._maxCandlesInMemory) return;
        // [INFINITE-SCROLL] Подрезаем ТОЛЬКО слева — старую историю, куда пользователь
        // уже не смотрит (при возврате она мгновенно достаётся из IndexedDB-кэша
        // страниц, без сети). Правую сторону НЕ трогаем ВОВСЕ: прежний правый trim
        // при просмотре истории отрезал «живой хвост» (последние свечи вместе с
        // текущей), после чего первый же WS-тик видел дыру и запускал
        // _catchUpMissedCandles + полное перерисование — отсюда «перегрузы».
        const keepFrom = Math.max(0, Math.floor(fromIndex - (this._leftBuffer * 1.5)));
        if (keepFrom === 0) return;
        const leftTrim = keepFrom, rightTrim = 0;

        this._isTrimming = true;
        try {
            this.chartData = this.chartData.slice(keepFrom);
            this._rebuildTimeMap();
            this._nearestTimeCacheGen = null;   // [PERF-PAN] данные изменились — сброс кэша привязки
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

    // =============== [INFINITE-SCROLL] HISTORY LOAD / PREFETCH ===============
    // Оптимальная страница истории = максимум, который API конкретной биржи/рынка
    // отдаёт за ОДИН запрос:
    //   • Binance futures /fapi/v1/klines — 1500;
    //   • Binance spot /api/v3/klines     — 1000;
    //   • Bybit v5 /market/kline          — 1000.
    // Почему именно максимум:
    //   • меньше размер -> больше страниц -> чаще полный setData/объёмы/индикаторы
    //     (главный источник микротормозов при листании) и чаще сетевые запросы;
    //   • больше нельзя: ответ урезается по лимиту биржи, и проверка
    //     «page.length < batchSize» ложно ставила hasMoreData=false — история
    //     «заканчивалась» после первой страницы (так было на Bybit со страницей 1500).
    // Одна страница отодвигает левый край на 1000-1500 свечей — при триггере
    // «осталось ~100» запас хода всегда больше, чем путь до края, поэтому скролл
    // бесконечный и без остановок.
    _historyBatchFor(interval) {
        if (this.currentExchange === 'binance' && this.currentMarketType === 'futures') return 1500;
        return this._batchSize || 1000;
    }

    // [INFINITE-SCROLL] Насколько рано стартовать догрузку: когда до левого края
    // данных остаётся ~100 свечей. Если график отдалён так, что в видимой области
    // больше 100 баров, порог = ширина экрана (иначе триггер срабатывал бы уже
    // на самом краю). Пока пользователь долистывает эти ~100 свечей, страница 800
    // успевает приехать из сети или (чаще) из IndexedDB-кэша — край отодвигается
    // раньше, чем в него упираются. Так же работает TradingView.
    _preloadThresholdFor(range) {
        const visible = (range && isFinite(range.from) && isFinite(range.to)) ? Math.max(10, Math.ceil(range.to - range.from)) : 200;
        return Math.max(this._preloadThreshold, Math.min(visible, 1500));
    }

    // Нужна ли догрузка прямо сейчас (range.from НЕ клампим: за левым краем он отрицательный)
    _historyNeededNow(range) {
        if (!this.hasMoreData || this.isLoadingMore) return false;
        if (!this._isChartValid()) return false;
        if (this._destroyed || this._switchingSymbol || this._isSwitchingInterval || this._updatesSuspended) return false;
        if (!this.chartData || this.chartData.length === 0) return false;
        if (!range || !isFinite(range.from)) return false;
        if (range.from >= 0 && range.to <= 0) return false;   // ещё нет самих данных
        return range.from < this._preloadThresholdFor(range);
    }

    // Проверка ВО ВРЕМЯ скролла (троттлинг 120 мс).
    // Важно: пока пользователь тащит график, данные на серию НЕ кладём — prepend
    // смещает логические индексы и может дёрнуть картинку прямо под курсором.
    // Вместо этого заранее тянем следующую страницу в локальный кэш: как только
    // скролл остановится (150 мс), страница ляжет на график уже без сети.
    _checkHistoryPreloadLive(range) {
        if (!this._historyNeededNow(range)) return;
        const now = performance.now();
        if (now - this._lastHistoryCheckAt < this._historyCheckThrottleMs) return;
        this._lastHistoryCheckAt = now;
        if (this._isScrolling || this._isScrollingFast) { this._warmHistoryCache(); return; }
        this._loadHistoryAsync();
    }

    // [HIST-FIX] Тихо тянет следующую страницу истории в IndexedDB (без отрисовки).
    // Даёт «горячий» кэш: реальная догрузка на график после остановки скролла
    // происходит уже без ожидания сети (200–600 мс -> единицы мс).
    _warmHistoryCache() {
        if (!this.hasMoreData || this.isLoadingMore) return;
        if (this._prefetchFetchController) return;   // запрос уже в полёте
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
            // [HIST-FIX] было 1500 мс и МОЛЧАЛИВЫЙ выход: если пользователь продолжал
            // листать, повторная попытка случалась только на следующем событии скролла,
            // а график всё это время стоял у пустого края. Теперь ставим отложенный повтор.
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

            // [HIST-FIX] сначала локальный кэш страниц (мгновенно, без сети и без rate limit),
            // затем — REST.
            let page = await this._loadHistoryPageFromCache(
                this.currentSymbol, this.currentExchange, this.currentMarketType, interval, oldestCandle.time
            );
            let fromNetwork = false;
            if (!page || page.length === 0) {
                page = await this.fetchKlines(
                    this.currentSymbol, this.currentExchange, this.currentMarketType,
                    interval, batchSize, (oldestCandle.time * 1000) - 1, 'history'
                );
                if (page === null) return;                       // abort/timeout — hasMoreData не трогаем
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
                // [HIST-FIX] добираем ещё صفحات подряд, пока край не отодвинется достаточно
                // далеко (или пока не кончится история). Именно отсутствие этой цепочки и
                // давало «листнул — встал — подгрузилось — листнул — встал» на минутках.
                this._chainPrefetch(genId, interval, 1);
            } else if (applied === false) {
                // данные устарели/график уже чужой — просто выходим, hasMoreData не трогаем
                return;
            }
        } catch (e) { this.hasMoreData = false; }
        finally { this.isLoadingMore = false; }
    }

    // Применяет одну страницу истории. Возврат: true — легла, false — график уже чужой,
    // null — истории больше нет.
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
            // [INFINITE-SCROLL] Было: на потолке памяти спереди БЕЗУСЛОВНО срезалось
            // «лишнее» — т.е. ровно только что добавленная страница (netShift = 0).
            // Левый край переставал отодвигаться, бесконечный скролл запирался на
            // ~8000 свечей, а каждая страница всё равно тянула полный setData —
            // те самые «перегрузы и тормоза».
            // Стало: спереди режем ТОЛЬКО свечи, которые гарантированно далеко слева
            // от видимого окна (пользователь ушёл от края — их можно отдать обратно
            // в IndexedDB-кэш). У левого края массив просто растёт — до _hardMaxCandles.
            const needed = combined.length - this._maxCandlesInMemory;
            const visibleFrom = (cr && isFinite(cr.from)) ? Math.max(0, Math.floor(cr.from)) : combined.length;
            const newVisibleFrom = visibleFrom + addedCount;   // видимый край ПОСЛЕ prepend
            const safeToTrim = Math.max(0, newVisibleFrom - this._leftBuffer);
            trimmedFromFront = Math.min(needed, safeToTrim);
            if (combined.length - trimmedFromFront > this._hardMaxCandles) {
                trimmedFromFront = combined.length - this._hardMaxCandles;  // абсолютная защита памяти
            }
            // Достигнут абсолютный потолок памяти И пользователь у самого левого края:
            // страница не отодвинет край (netShift <= 0) — получился бы бессмысленный
            // полный setData на каждый триггер («беговая дорожка»). Аккуратно останавливаем
            // историю в рамках сессии: потолок 40 000 свечей (~27 дней на 1m) на
            // практике недостижим, а при смене монеты/ТФ hasMoreData снова true.
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

    // Цепочка догрузок: продолжает копать влево, пока пользователь не отстал от края
    // достаточно далеко. Пауза между страницами — чтобы не ловить rate limit биржи.
    _chainPrefetch(genId, interval, pagesDone) {
        if (this._destroyed) return;
        if (this._activeGeneration !== genId || this.currentInterval !== interval) return;
        if (!this.hasMoreData || this.isLoadingMore) return;
        if (pagesDone >= this._historyPrefetchMaxPages) return;
        const r = this._lastVisibleRange || this.chart?.timeScale()?.getVisibleLogicalRange?.();
        if (!r || !isFinite(r.from)) return;
        // край уже далеко (данные легли с запасом) — дальше не грузим
        if (r.from >= this._preloadThresholdFor(r)) return;

        setTimeout(() => {
            if (this._destroyed) return;
            if (this._activeGeneration !== genId || this.currentInterval !== interval) return;
            if (!this.hasMoreData || this.isLoadingMore) return;
            // пока пользователь тащит график или идёт trim — ждём, не дёргаем серию
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

    // [HIST-FIX] Глубокая фоновая догрузка после того, как монета/ТФ легли на график.
    // На 1m стартовых 1000 свечей — это ~16 часов: пользователь упирался в край почти
    // сразу. Теперь к моменту первого листания в памяти уже есть запас, и листание
    // идёт так же ровно, как на 1h/1d.
    _scheduleDeepPrefetch() {
        const genId = this._activeGeneration;
        const interval = this.currentInterval;
        const symbol = this.currentSymbol;
        const startedAt = Date.now();
        const tick = () => {
            if (this._destroyed) return;
            if (this._activeGeneration !== genId || this.currentInterval !== interval || this.currentSymbol !== symbol) return;
            if (!this._isChartValid() || !this.chartData.length || !this.hasMoreData) return;
            if (Date.now() - startedAt > 20000) return;   // не вечный цикл

            // 1) ждём, пока погаснет затемнение переключения монеты/ТФ: под ним ещё
            //    дорабатывают _syncRecentCandles/autoScale, и лишний setData там не нужен
            const ov = this._symbolSwitchOverlay;
            if (ov && ov.style && ov.style.opacity && parseFloat(ov.style.opacity) > 0.05) {
                setTimeout(tick, 300); return;
            }
            // 2) не лезем, пока пользователь тащит график или идёт trim
            if (this._isScrolling || this._isScrollingFast || this._isTrimming) { setTimeout(tick, 400); return; }
            // 3) пользователь уже сам листает историю — работает обычная цепочка догрузок
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

    // ---------------- [HIST-FIX] локальный кэш страниц истории ----------------
    // Закрытые свечи прошлого не меняются, поэтому страницу можно хранить вечно.
    // Ключ — «срез» (время самой старой свечи на момент запроса): при повторном
    // листании того же участка берём данные из IndexedDB за пару миллисекунд
    // вместо 200–600 мс сетевого запроса.
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
                // ближайший срез чуть старше текущей самой старой свечи
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

            // [ВЫРАВНИВАНИЕ] Если фоновая дозагрузка ДОБАВИЛА недостающие свечи
            // (кейс «сплюснутой» монеты: устаревший кэш + плейсхолдер по живой цене),
            // залоченный вертикальный масштаб (autoScale:false) остаётся растянутым
            // между старыми ценами и текущей — пересчитываем его (то же, что кнопка «A»).
            // Только при ДОБАВЛЕНИИ свечей — обычные обновления масштаб не трогают.
            if (newCandles.length > 0) this.autoScale();
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

    /**
     * @param {number} [maxAgeMs=5мин] [VP-STALE] максимальный возраст кэша.
     *   Большее значение используется ТОЛЬКО как «последний шанс», когда сеть
     *   не отдала ничего: закрытые свечи не меняются, поэтому показать
     *   вчерашние данные и досинхронизировать их в фоне лучше, чем оставить
     *   пользователя с пустым графиком и надписью «Нет данных».
     */
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
    // [ШАГ 1] Из блока DRAWINGS оставлен только manualAutoScale().
    // scheduleDrawingsUpdate / requestDrawingsRedraw / _performDrawingsRedraw — удалены,
    // их работу делают сами примитивы через attached({ requestUpdate }).
    manualAutoScale() { this.autoScale(); }
}

if (typeof window !== 'undefined') {
    window.ChartManager = ChartManager;
}
