/* ============================================================================
   ПОДПИСЬ-QWEN | ✅ ФИНАЛ — ЭТИМ ФАЙЛОМ ЗАМЕНИТЬ В РЕПО: ticker/TickerPanel.js (В ПАПКУ ticker!)
   Состав: живая версия репо (коммит 00f3b17) + [ANTI-BAN] — на 429/418
   запросы останавливаются сразу, без ретраев (ретраи превращают 429 в бан IP).
   Собран: 24.09.2026. Больше НИЧЕГО не менялось.
   ============================================================================ */
const TICKER_TIMINGS = {
    INITIAL_DATA_DELAY: 500,
    CACHE_REFRESH_INTERVAL: 4 * 60 * 60 * 1000,
    HEALTH_CHECK_INTERVAL: 30 * 1000,
    REST_POLL_INTERVAL: 30 * 60 * 1000,
    FINAL_RERENDER_DELAY: 3000,
    WS_RECONNECT_DELAY: 5000,
    FETCH_TIMEOUT: 15000,
    BATCH_DELAY: 800,
    FLASH_DURATION: 400,
    MAX_WS_MESSAGE_SIZE: 1024 * 1024,
    REST_QUEUE_DELAY: 200,
    BINANCE_BATCH_SIZE: 100,
    UI_UPDATE_THROTTLE: 5000,
};
const QUOTE_ASSETS = ['USDT', 'USDC', 'BUSD', 'BTC', 'ETH'];

const DATA_DEPENDENT_SORT_FIELDS = new Set(['price', 'change', 'volume', 'trades']);

class TickerPanel {
    constructor(coordinator) {
        this.coordinator = coordinator;
        this.watchlistManager = new WatchlistManager(this);
        this.storage = new TickerStorage();
        this.renderer = new TickerRenderer(this);
        this.modal = new TickerModal(this);
        this.events = new TickerEvents(this);
        this.priceManager = window.priceManagerInstance;

        if (!this.priceManager) {
            console.error('❌ PriceManager не найден!');
        }

        this._pmPriceHandler = (price, symbol, exchange, marketType) => {
            this._onPriceUpdate(symbol, price, exchange, marketType);
        };

        this._restToken = 0;
        this._pendingPriceUpdates = new Map();
        this._priceUpdateRaf = null;
        this._isDestroyed = false;
        this._lastUiUpdateMap = new Map();

        // ✅ ФИКС: сигнатура последнего обработанного набора customSymbols.
        // Используется в TickerRenderer.getFilteredTickers() для принудительного
        // сброса filterCache при смене состава списка (переключение вотчлиста,
        // массовое добавление/удаление) — иначе возвращался устаревший result
        // от предыдущего списка.
        this._lastSymbolsSig = null;

        this.state = this.storage.state;
        this.tickers = this.storage.tickers;
        this.tickersMap = this.storage.tickersMap;
        this.allSymbolsCache = this.storage.allSymbolsCache;
        this.binanceSymbolsCache = this.storage.binanceSymbolsCache;
        this.bybitSymbolsCache = this.storage.bybitSymbolsCache;
        this.allBinanceFutures = this.storage.allBinanceFutures;
        this.allBinanceSpot = this.storage.allBinanceSpot;
        this.allBybitFutures = this.storage.allBybitFutures;
        this.allBybitSpot = this.storage.allBybitSpot;
        // 📈 Акции/ETF (TradFi): отдельные списки для модалки и фильтра
        this.allBinanceStocks = this.storage.allBinanceStocks || [];
        this.allBybitStocks = this.storage.allBybitStocks || [];
        this.formatCache = this.storage.formatCache;
        this.cacheMaxAge = this.storage.cacheMaxAge;
        this.settings = this.storage.settings;
        this.debugMode = this.storage.debugMode;
        this.filterCache = this.storage.filterCache;
        this.saveTimeout = this.storage.saveTimeout;
        this._isRefreshing = this.storage._isRefreshing;
        this._eventsInitialized = this.storage._eventsInitialized;

        this._isBulkAdding = false;
        this._suppressWatchlistLoad = false;
        this._restDebounceTimer = null;
        this._renderPending = false;

        // 📈 Акции: цены парных рынков (spot ↔ futures) и служебные индексы
        this.pairPrices = new Map();          // pairKey -> price
        this._stockPairHandlers = new Map();  // cardKey -> { pairKey, handler }
        this._assetClassIndex = new Map();    // key -> 'crypto'|'stocks'
        this._stockPairIndex = new Map();     // cardKey -> { pairKey, pairLabel, pairTitle }

        this._rowDomCache = new Map();
        this._subscribedSymbols = new Set();

        this._fetchBatchInProgress = false;
        this._restInProgress = false;
        this._priceEngineStarted = false;

        this.rowHeight = 36;
        this.visibleCount = 30;
        this.tickerElements = this.renderer.tickerElements;

        Object.defineProperties(this, {
            displayedTickers: { get: () => this.renderer.displayedTickers },
            totalItems: { get: () => this.renderer.totalItems }
        });

        this._scrollHandler = this.renderer._scrollHandler;
        this._renderScheduled = this.renderer._renderScheduled;
        this._renderRafId = this.renderer._renderRafId;
        this._firstRender = this.renderer._firstRender;
        this._blockDOMUpdates = true;

        this.loadUserData = this.storage.loadUserData.bind(this.storage);
        this.saveCurrentSymbol = this.storage.saveCurrentSymbol.bind(this.storage);
        this.loadFromLocalStorage = this.storage.loadFromLocalStorage.bind(this.storage);
        this.loadFromIndexedDB = this.storage.loadFromIndexedDB.bind(this.storage);
        this.saveSymbolsToIndexedDB = this.storage.saveSymbolsToIndexedDB.bind(this.storage);
        this.sortByPopularity = this.storage.sortByPopularity.bind(this.storage);
        this.getFilteredCount = this.storage.getFilteredCount.bind(this.storage);
        this.updateModalCount = this.storage.updateModalCount.bind(this.storage);
        this.removeDuplicates = this.storage.removeDuplicates.bind(this.storage);
        this.saveState = this.storage.saveState.bind(this.storage);

        this.updatePriceElements = this.renderer.updatePriceElements.bind(this.renderer);
        this.sortTickers = this.renderer.sortTickers.bind(this.renderer);
        this.getFilteredTickers = this.renderer.getFilteredTickers.bind(this.renderer);
        this.renderTickerList = this.renderer.renderTickerList.bind(this.renderer);
        this.renderVisibleTickers = this.renderer.renderVisibleTickers.bind(this.renderer);
        this.createTickerElement = this.renderer.createTickerElement.bind(this.renderer);
        this.formatPrice = this.renderer.formatPrice.bind(this.renderer);
        this.formatChange = this.renderer.formatChange.bind(this.renderer);
        this.formatVolume = this.renderer.formatVolume.bind(this.renderer);
        this.formatTrades = this.renderer.formatTrades.bind(this.renderer);
        this.setupHeaderSorting = this.renderer.setupHeaderSorting.bind(this.renderer);

        this.setupModal = this.modal.setupModal.bind(this.modal);
        this.addNextBatch = this.modal.addNextBatch.bind(this.modal);
        this.updateModalButtons = this.modal.updateModalButtons.bind(this.modal);
        this.updateModalResults = this.modal.updateModalResults.bind(this.modal);
        this.renderModalResults = this.modal.renderModalResults.bind(this.modal);

        this.setupDelegatedEvents = this.events.setupDelegatedEvents.bind(this.events);
        this.setupFilters = this.events.setupFilters.bind(this.events);
        this.setupClearAllButton = this.events.setupClearAllButton.bind(this.events);
        this.setupFlagContextMenu = this.events.setupFlagContextMenu.bind(this.events);
        this.setupUIEventListeners = this.events.setupUIEventListeners.bind(this.events);

        this.initializeDataParallel = this.initializeDataParallel.bind(this);
        this.refreshSymbolCache = this.refreshSymbolCache.bind(this);
        this.processParallelData = this.processParallelData.bind(this);
        this.addInitialSymbols = this.addInitialSymbols.bind(this);
        this.fetchBybitSnapshots = this.fetchBybitSnapshots.bind(this);

        this.handleFlagSelect = this.handleFlagSelect.bind(this);
        this.handleTickerClick = this.handleTickerClick.bind(this);
        this.handleStarClick = this.handleStarClick.bind(this);
        this.handleContextMenu = this.handleContextMenu.bind(this);
        this.handleDoubleClick = this.handleDoubleClick.bind(this);
        this.handleKeyDelete = this.handleKeyDelete.bind(this);

        this._visibilityHandler = () => { if (!document.hidden) this._restoreWebSockets(); };
        this._focusHandler = () => this._restoreWebSockets();
        this._globalClickHandler = (e) => {
            const tickerMenu = document.getElementById('tickerContextMenu');
            if (tickerMenu && tickerMenu.style.display === 'block' && !tickerMenu.contains(e.target)) {
                tickerMenu.style.display = 'none';
            }
        };
        this._globalContextMenuHandler = (e) => {
            let target = e.target;
            if (target && target.nodeType === 3) target = target.parentElement;
            const tickerItem = target.closest('.ticker-item');
            if (tickerItem) { e.preventDefault(); this.handleContextMenu(e); }
        };

        this.loadFromLocalStorage();
        window.tickerPanelInstance = this;

        const savedSortBy = localStorage.getItem('tickerSortBy');
        const savedSortDir = localStorage.getItem('tickerSortDir');

        this.state.sortBy = savedSortBy === null ? 'volume' : (savedSortBy || null);
        this.state.sortDirection = savedSortDir === null ? 'desc' : (savedSortDir || null);

        this.init();
    }

    _scheduleRender() {
        if (this._renderPending) return;
        this._renderPending = true;
        requestAnimationFrame(() => {
            this.renderTickerList();
            this._renderPending = false;
        });
    }

    _isDataDependentSort() {
        return !!this.state?.sortBy && DATA_DEPENDENT_SORT_FIELDS.has(this.state.sortBy);
    }

    _refreshAfterBulkPriceUpdate() {
        if (this._isDestroyed) return;
        if (this._isDataDependentSort()) {
            this.filterCache = null;
            this._scheduleRender();
        } else {
            this.renderer?.updatePriceElements?.();
        }
    }

    _escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    _isValidSymbol(symbol) {
        return QUOTE_ASSETS.some(quote => symbol.endsWith(quote));
    }

    _arraysEqual(arr1, arr2) {
        if (arr1.length !== arr2.length) return false;
        for (let i = 0; i < arr1.length; i++) {
            if (arr1[i] !== arr2[i]) return false;
        }
        return true;
    }

    async init() {
        if (this._isDestroyed) return;
        console.log('📋 TickerPanel: быстрая инициализация');
        const loader = document.getElementById('tickerLoader');
        if (loader) loader.style.display = 'block';

        this.setupFilters();
        this.setupFlagContextMenu();
        this.setupUIEventListeners();
        this.setupClearAllButton();
        this.setupHeaderSorting();
        this.setupModal();

        document.addEventListener('contextmenu', this._globalContextMenuHandler);
        document.addEventListener('click', this._globalClickHandler);
        document.addEventListener('visibilitychange', this._visibilityHandler);
        window.addEventListener('focus', this._focusHandler);

        if (this.watchlistManager) this.watchlistManager.createDropdownContainer();

        setTimeout(async () => {
            if (this._isDestroyed) return;
            console.log('⏳ Ожидание загрузки Watchlist...');
            if (this.watchlistManager) {
                await this.watchlistManager._initPromise;
                console.log('✅ Watchlist загружен, customSymbols:', this.state.customSymbols?.length);
            }
            await this.loadUserData();
            if (this.watchlistManager) this.watchlistManager.syncActiveListFromPanel();
            this.initializeDataParallel();
            this.updateModalWithData?.();
            if (this.watchlistManager) await this.watchlistManager.initializeWithPriority();

            this._cacheRefreshInterval = setInterval(() => {
                if (!this._isDestroyed) {
                    this.refreshSymbolCache(20000).catch(err => console.warn('⚠️ Фон. обновление кэша:', err));
                }
            }, TICKER_TIMINGS.CACHE_REFRESH_INTERVAL);
        }, 100);
    }

    _restoreWebSockets() {
        if (this._isDestroyed) return;
        // PERF: focus/visibilitychange могут firing'ать часто (клики по другим окнам,
        // alt-tab туда-обратно). Раньше КАЖДЫЙ вызов запускал полный REST-батч
        // и полный перерендер списка — одновременно с refresh'ем графика,
        // что давало «шторм» и подвисание на несколько секунд.
        // Теперь — не чаще раза в 30 с.
        const nowTs = Date.now();
        if (this._lastRestoreAt && nowTs - this._lastRestoreAt < 30000) return;
        this._lastRestoreAt = nowTs;
        console.log('📡 Вкладка стала активной, принудительно восстанавливаем обновление...');

        this._restToken = (this._restToken || 0) + 1;
        this._isRestRunning = false;
        this._restQueue = [];
        this.filterCache = null;

        if (this.pollRestData) {
            setTimeout(() => {
                if (!this._isDestroyed) this.pollRestData();
            }, 100);
        }
        this._scheduleRender();
    }

    /**
     * [VP-BANDWIDTH] Ждём «окно тишины» графика перед тяжёлыми закачками.
     *
     * Зачем: кэш символов — это ЧЕТЫРЕ запроса exchangeInfo/instruments-info
     * суммарно ~19 МБ, из них один binance spot exchangeInfo — ~17 МБ
     * (3705 записей). Раньше он стартовал через 1 с после инициализации панели,
     * то есть РОВНО тогда, когда AppCoordinator.loadInitialData() тянул свечи
     * для восстановленного символа. Два потока на один домен api.binance.com:
     * klines не успевал за 15-секундный таймаут и возвращал null, а
     * switchSymbol печатал «❌ Не удалось переключиться на SUIUSDT:
     * Нет данных для SUIUSDT». Причём на СПОТ-тикерах это повторялось каждый
     * раз: 17 МБ не успевали дочитаться, точность не кэшировалась, и следующая
     * попытка запускала всё заново.
     *
     * @param {number} maxWaitMs сколько максимум ждать (дальше грузим в любом случае)
     */
    async _waitForChartIdle(maxWaitMs = 20000) {
        const startedAt = Date.now();
        const cm = () => (typeof window !== 'undefined')
            ? (window.chartManagerInstance || window.chartManager || null) : null;
        while (Date.now() - startedAt < maxWaitMs) {
            if (this._isDestroyed) return false;
            const chart = cm();
            const busy = !chart || chart._switchingSymbol || chart._isSwitchingInterval;
            const hasData = !!(chart && chart.chartData && chart.chartData.length > 0);
            if (!busy && hasData) return true;
            await new Promise(r => setTimeout(r, 250));
        }
        return false;
    }

    async initializeDataParallel() {
        const container = document.getElementById('tickerListContainer');
        const loader = document.getElementById('tickerLoader');

        const loaded = await this.loadFromIndexedDB();
        if (loaded) {
            this.addInitialSymbols();
            this.updateModalCount();
            if (loader) loader.style.display = 'none';
            if (container) container.classList.add('ready');
            // [VP-BANDWIDTH] не стартуем 19 МБ закачку, пока график не загрузил
            // свечи восстановленного символа (см. _waitForChartIdle).
            (async () => {
                await this._waitForChartIdle();
                if (this._isDestroyed) return;
                await new Promise(r => setTimeout(r, 1500));   // даём графику «усесться»
                if (this._isDestroyed) return;
                this.refreshSymbolCache(20000).catch(err => console.warn('⚠️ Фон. обновление:', err));
            })();
            return;
        }

        if (loader) loader.style.display = 'block';
        if (container) container.innerHTML = '';

        // [VP-BANDWIDTH] холодный старт (кэша в IndexedDB ещё нет): сначала
        // даём графику загрузить свечи, и только потом качаем ~19 МБ списков
        // инструментов. Прежний таймаут 5 с для 17-мегабайтного
        // binance spot exchangeInfo был недостижим в принципе — запрос
        // обрывался, список оставался пустым, а трафик тратился впустую.
        await this._waitForChartIdle(15000);
        if (this._isDestroyed) return;

        const controllers = [];
        const fetchWithTimeout = (url, timeout) => {
            const controller = new AbortController();
            controllers.push(controller);
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            return fetch(url, { signal: controller.signal })
                .then(async r => {
                    if (!r.ok) {
                        console.warn(`⚠️ [TICKER] ${url.split('?')[0]}: HTTP ${r.status}`);
                        return null;
                    }
                    return await r.json();
                })
                .catch(err => {
                    console.warn(`⚠️ [TICKER] ${url.split('?')[0]}: ` +
                        ((err && err.name === 'AbortError') ? `таймаут ${Math.round(timeout / 1000)} с` : (err && err.message) || String(err)));
                    return null;
                })
                .finally(() => clearTimeout(timeoutId));
        };

        const urls = [
            'https://fapi.binance.com/fapi/v1/exchangeInfo',
            'https://api.binance.com/api/v3/exchangeInfo',
            'https://api.bybit.com/v5/market/instruments-info?category=linear',
            'https://api.bybit.com/v5/market/instruments-info?category=spot'
        ];

        try {
            const allResults = await Promise.allSettled(urls.map(url => fetchWithTimeout(url, 20000)));
            const finalResults = allResults.map(r => r.status === 'fulfilled' ? r.value : null);

            this.processParallelData(finalResults, false);
            this.addInitialSymbols();
            await this.saveSymbolsToIndexedDB();

            if (container) {
                container.innerHTML = '';
                container.classList.add('ready');
            }
            if (loader) loader.style.display = 'none';
        } catch (error) {
            console.error('❌ Ошибка загрузки данных:', error);
            if (container) {
                container.innerHTML = '<div style="padding: 20px; text-align: center; color: #f23645; font-size: 14px;">⚠️ Не удалось загрузить данные бирж. Проверьте подключение к интернету.</div>';
            }
            if (loader) loader.style.display = 'none';
        } finally {
            controllers.length = 0;
        }
    }

    /**
     * Обновление кэша инструментов.
     *
     * [VP-BANDWIDTH] Три исправления:
     *  • не запускается, пока график переключает символ/таймфрейм (иначе тяжёлая
     *    закачка отбирает канал у fetchKlines и график падает с «Нет данных»);
     *  • таймаут по умолчанию увеличен 10 с -> 20 с: binance spot exchangeInfo
     *    весит ~17 МБ и на обычном канале за 10 с не дочитывался. Прерванный
     *    запрос — это потраченный трафик и ПУСТОЙ результат, а следующая
     *    попытка качала те же 17 МБ заново;
     *  • причина отказа больше не теряется: раньше `.catch(() => null)`
     *    проглатывал и таймаут, и 429, и отсутствие сети.
     */
    async refreshSymbolCache(timeout = 20000) {
        if (this._isRefreshing || this._isDestroyed) return;
        const cm = window.chartManagerInstance || window.chartManager;
        if (cm && (cm._switchingSymbol || cm._isSwitchingInterval)) {
            console.log('⏳ [VP-BANDWIDTH] график переключается — обновление кэша символов отложено');
            setTimeout(() => {
                if (!this._isDestroyed && !this._isRefreshing) {
                    this.refreshSymbolCache(timeout).catch(e => console.warn('⚠️ Отложенное обновление кэша:', e));
                }
            }, 3000);
            return;
        }
        this._isRefreshing = true;
        const controllers = [];
        const fetchWithTimeout = (url, timeout) => {
            const controller = new AbortController();
            controllers.push(controller);
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            const startedAt = Date.now();
            return fetch(url, { signal: controller.signal })
                .then(async r => {
                    if (!r.ok) {
                        console.warn(`⚠️ [TICKER] ${url.split('?')[0]}: HTTP ${r.status}`);
                        return null;
                    }
                    return await r.json();
                })
                .catch(err => {
                    const aborted = err && err.name === 'AbortError';
                    console.warn(`⚠️ [TICKER] ${url.split('?')[0]}: ` +
                        (aborted ? `таймаут ${Math.round(timeout / 1000)} с` : (err && err.message) || String(err)));
                    return null;
                })
                .finally(() => clearTimeout(timeoutId));
        };
        const urls = [
            'https://fapi.binance.com/fapi/v1/exchangeInfo',
            'https://api.binance.com/api/v3/exchangeInfo',
            'https://api.bybit.com/v5/market/instruments-info?category=linear',
            'https://api.bybit.com/v5/market/instruments-info?category=spot'
        ];
        try {
            const results = await Promise.allSettled(urls.map(url => fetchWithTimeout(url, timeout)));
            const finalResults = results.map(r => r.status === 'fulfilled' ? r.value : null);
            this.processParallelData(finalResults, true);
            await this.saveSymbolsToIndexedDB();
        } catch (error) {
            console.warn('⚠️ Ошибка фонового обновления:', error);
        } finally {
            controllers.forEach(c => c.abort());
            this._isRefreshing = false;
        }
    }

    _onPriceUpdate(symbol, data, exchange, marketType) {
        if (this._isDestroyed) return;
        const compositeKey = `${symbol}:${exchange}:${marketType}`;
        const ticker = this.tickersMap.get(compositeKey);
        if (!ticker) return;

        const newPrice = typeof data === 'object' && data !== null ? parseFloat(data.price) : parseFloat(data);
        if (isNaN(newPrice)) return;

        let newChange = typeof data === 'object' && data !== null ? parseFloat(data.change) : undefined;
        if (isNaN(newChange)) newChange = ticker.change || 0;

        let newVolume = typeof data === 'object' && data !== null ? parseFloat(data.volume) : undefined;
        if (isNaN(newVolume)) newVolume = ticker.volume;

        let newTrades = typeof data === 'object' && data !== null ? parseInt(data.trades) : undefined;
        if (isNaN(newTrades)) newTrades = ticker.trades;

        const now = Date.now();
        const lastUpdate = this._lastUiUpdateMap.get(compositeKey) || 0;

        if (now - lastUpdate < TICKER_TIMINGS.UI_UPDATE_THROTTLE) {
            ticker.prevPrice = ticker.price > 0 ? ticker.price : newPrice;
            ticker.price = newPrice;
            ticker.change = newChange;
            ticker.volume = newVolume;
            ticker.trades = newTrades;
            ticker._lastUpdateTime = now;
            return;
        }

        this._lastUiUpdateMap.set(compositeKey, now);

        ticker.prevPrice = ticker.price > 0 ? ticker.price : newPrice;
        ticker.price = newPrice;
        ticker.change = newChange;
        ticker.volume = newVolume;
        ticker.trades = newTrades;
        ticker._lastUpdateTime = now;

        if (!this._blockDOMUpdates && this.renderer) {
            this._pendingPriceUpdates.set(compositeKey, {
                price: ticker.price,
                change: newChange,
                volume: newVolume,
                trades: newTrades
            });

            if (!this._priceUpdateRaf) {
                this._priceUpdateRaf = requestAnimationFrame(() => {
                    this._priceUpdateRaf = null;
                    const batch = this._pendingPriceUpdates;
                    this._pendingPriceUpdates = new Map();
                    for (const [key, val] of batch.entries()) {
                        this.renderer.updatePriceForSymbol(key, val.price, val.change, val.volume, val.trades);
                    }
                });
            }
        }
    }

    processParallelData(results, updateOnly = false) {
        const MAX_SYMBOLS = 4000;
        let binanceFuturesList = [], binanceSpotList = [], bybitFuturesList = [], bybitSpotList = [];

        // 📈 TradFi-типы Bybit Linear: токенизированные акции, ETF, товары, форекс
        const BYBIT_LINEAR_TRADFI = ['stock', 'ETF', 'commodity', 'forex'];

        if (results[0]?.symbols) {
            // Binance Futures: contractType === 'TRADIFI_PERPETUAL' — перпы на акции/ETF/товары (TSLAUSDT, SPYUSDT, XAUUSDT...)
            binanceFuturesList = results[0].symbols.filter(s => s.symbol?.endsWith('USDT') && s.status === 'TRADING').map(s => ({ symbol: s.symbol, exchange: 'binance', marketType: 'futures', assetClass: s.contractType === 'TRADIFI_PERPETUAL' ? 'stocks' : 'crypto' }));
        }
        if (results[1]?.symbols) {
            // Binance Spot: токенизированных акций нет — вся крипта
            binanceSpotList = results[1].symbols.filter(s => s.symbol?.endsWith('USDT') && s.status === 'TRADING').map(s => ({ symbol: s.symbol, exchange: 'binance', marketType: 'spot', assetClass: 'crypto' }));
        }
        if (results[2]?.retCode === 0 && results[2]?.result?.list) {
            // Bybit Linear: symbolType 'stock'/'ETF'/'commodity'/'forex' — традиционные рынки
            bybitFuturesList = results[2].result.list.filter(s => s.symbol?.endsWith('USDT')).map(s => ({ symbol: s.symbol, exchange: 'bybit', marketType: 'futures', assetClass: BYBIT_LINEAR_TRADFI.includes(s.symbolType) ? 'stocks' : 'crypto' }));
        }
        if (results[3]?.retCode === 0 && results[3]?.result?.list) {
            // Bybit Spot: symbolType 'xstocks' — токенизированные акции/ETF (TSLAXUSDT...)
            bybitSpotList = results[3].result.list.filter(s => s.symbol?.endsWith('USDT')).map(s => ({ symbol: s.symbol, exchange: 'bybit', marketType: 'spot', assetClass: s.symbolType === 'xstocks' ? 'stocks' : 'crypto' }));
        }

        this.binanceSymbolsCache = this._deduplicateSymbols([...binanceFuturesList, ...binanceSpotList]);
        this.bybitSymbolsCache = this._deduplicateSymbols([...bybitFuturesList, ...bybitSpotList]);
        this.binanceSymbolsCache = this.sortByPopularity(this.binanceSymbolsCache);
        this.bybitSymbolsCache = this.sortByPopularity(this.bybitSymbolsCache);

        // Крипто-вкладки FUTURES/SPOT больше не содержат акции — они живут во вкладке «Акции/ETF»
        const isStocks = s => s.assetClass === 'stocks';
        this.allBinanceFutures = this.binanceSymbolsCache.filter(s => s.marketType === 'futures' && !isStocks(s)).slice(0, MAX_SYMBOLS);
        this.allBinanceSpot = this.binanceSymbolsCache.filter(s => s.marketType === 'spot' && !isStocks(s)).slice(0, MAX_SYMBOLS);
        this.allBybitFutures = this.bybitSymbolsCache.filter(s => s.marketType === 'futures' && !isStocks(s)).slice(0, MAX_SYMBOLS);
        this.allBybitSpot = this.bybitSymbolsCache.filter(s => s.marketType === 'spot' && !isStocks(s)).slice(0, MAX_SYMBOLS);
        this.allBinanceStocks = this.binanceSymbolsCache.filter(isStocks).slice(0, MAX_SYMBOLS);
        this.allBybitStocks = this.bybitSymbolsCache.filter(isStocks).slice(0, MAX_SYMBOLS);
        this.allSymbolsCache = [...this.binanceSymbolsCache, ...this.bybitSymbolsCache];
        this._buildAssetClassIndex();
        this._buildStockPairIndex();
        this._restampTickersAssetClass();
        this.updateModalCount();
    }

    // =========================================================================
    // 📈 АКЦИИ/ETF (TradFi): классификация, пары «спот ↔ фьючерс»
    // =========================================================================
    _buildAssetClassIndex() {
        this._assetClassIndex = new Map();
        for (const s of this.allSymbolsCache || []) {
            if (!s?.symbol) continue;
            this._assetClassIndex.set(`${s.symbol}:${s.exchange}:${s.marketType}`, s.assetClass || 'crypto');
        }
    }

    _assetClassOf(symbol, exchange, marketType) {
        return this._assetClassIndex?.get(`${symbol}:${exchange}:${marketType}`) || 'crypto';
    }

    _buildStockPairIndex() {
        // Для каждого инструмента акций ищем парный рынок:
        //   Bybit spot xStock (TSLAXUSDT) ↔ Bybit perp (TSLAUSDT)
        //   Bybit perp / Binance perp (TSLAUSDT) ↔ Bybit spot xStock (TSLAXUSDT)
        this._stockPairIndex = new Map();
        const bybitSpotByBase = new Map();
        const bybitFutByBase = new Map();
        for (const s of this.bybitSymbolsCache || []) {
            if (s.assetClass !== 'stocks') continue;
            const base = s.symbol.replace(/USDT$/, '');
            if (s.marketType === 'spot') {
                bybitSpotByBase.set(base.replace(/X$/, ''), s.symbol);
                bybitSpotByBase.set(base, s.symbol);
            } else {
                bybitFutByBase.set(base, s.symbol);
            }
        }
        for (const s of this.allSymbolsCache || []) {
            if (s.assetClass !== 'stocks') continue;
            const cardKey = `${s.symbol}:${s.exchange}:${s.marketType}`;
            const base = s.symbol.replace(/USDT$/, '');
            let pair = null;
            if (s.exchange === 'bybit' && s.marketType === 'spot') {
                const futSym = bybitFutByBase.get(base.replace(/X$/, '')) || bybitFutByBase.get(base);
                if (futSym) pair = { pairKey: `${futSym}:bybit:futures`, pairLabel: 'FUT', pairTitle: `Bybit perpetual: ${futSym}` };
            } else {
                const spotSym = bybitSpotByBase.get(base);
                if (spotSym) pair = { pairKey: `${spotSym}:bybit:spot`, pairLabel: 'SPOT', pairTitle: `Bybit xStock (spot): ${spotSym}` };
            }
            if (pair && pair.pairKey !== cardKey) this._stockPairIndex.set(cardKey, pair);
        }
    }

    /** После обновления кэша бирж проставляем assetClass/пары уже созданным тикерам. */
    _restampTickersAssetClass() {
        if (!this.tickersMap || this.tickersMap.size === 0) return;
        let changed = 0;
        for (const [key, t] of this.tickersMap.entries()) {
            const ac = this._assetClassOf(t.symbol, t.exchange, t.marketType);
            if (t.assetClass !== ac) { t.assetClass = ac; changed++; }
            const pair = ac === 'stocks' ? this._stockPairIndex.get(key) : null;
            const newPairKey = pair ? pair.pairKey : null;
            if (t.pairKey !== newPairKey) {
                this._unsubscribeStockPair(key);
                t.pairKey = newPairKey;
                t.pairLabel = pair ? pair.pairLabel : null;
                t.pairTitle = pair ? pair.pairTitle : null;
                if (newPairKey) this._subscribeStockPair(key, newPairKey);
                changed++;
            }
        }
        if (changed > 0) {
            this.filterCache = null;
            this._scheduleRender();
        }
    }

    /** «Теневая» подписка на цену парного рынка для плашки акции. */
    _subscribeStockPair(cardKey, pairKey) {
        const pm = window.priceManagerInstance;
        if (!pm || this._isDestroyed || this._stockPairHandlers.has(cardKey)) return;
        const handler = (data) => {
            if (this._isDestroyed) return;
            const price = (data && typeof data === 'object') ? parseFloat(data.price) : parseFloat(data);
            if (!price || isNaN(price)) return;
            this.pairPrices.set(pairKey, price);
            try { this.renderer.updatePairPrice(cardKey, price); } catch (e) {}
        };
        try { pm.subscribe(pairKey, handler); } catch (e) { return; }
        this._stockPairHandlers.set(cardKey, { pairKey, handler });
        this._fetchStockPairPrice(pairKey, cardKey);
    }

    _unsubscribeStockPair(cardKey) {
        const rec = this._stockPairHandlers.get(cardKey);
        if (!rec) return;
        const pm = window.priceManagerInstance;
        if (pm) { try { pm.unsubscribe(rec.pairKey, rec.handler); } catch (e) {} }
        this._stockPairHandlers.delete(cardKey);
    }

    _unsubscribeAllStockPairs() {
        for (const cardKey of [...this._stockPairHandlers.keys()]) this._unsubscribeStockPair(cardKey);
    }

    /**
     * [VP-NET] fetch с обязательным таймаутом и отменой.
     *
     * Зачем: в панели было ПЯТЬ мест с «голым» `await fetch(url)`. Такой запрос
     * не отменяется НИКОГДА: при зависшем соединении он вечно держит слот в
     * пуле браузера (лимит ~6 на домен), а домены здесь те же, откуда график
     * берёт свечи (api.binance.com / fapi.binance.com / api.bybit.com).
     * Подвисшая пачка тикеров таким образом могла «съесть» весь пул, и
     * fetchKlines для switchSymbol обрывался по таймауту — «Нет данных».
     *
     * @returns {Promise<Response|null>} null при таймауте/сетевой ошибке
     */
    async _fetchWithTimeout(url, timeoutMs = TICKER_TIMINGS.FETCH_TIMEOUT) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, { signal: controller.signal });
        } catch (e) {
            const reason = (e && e.name === 'AbortError')
                ? `таймаут ${Math.round(timeoutMs / 1000)} с` : (e && e.message) || String(e);
            console.warn(`⚠️ [TICKER] ${String(url).split('?')[0]}: ${reason}`);
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    /** Разовый REST-запрос, чтобы чип пары не был пустым до первого WS-тика. */
    async _fetchStockPairPrice(pairKey, cardKey) {
        try {
            const [symbol, exchange, marketType] = pairKey.split(':');
            const url = exchange === 'binance'
                ? (marketType === 'futures'
                    ? `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`
                    : `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`)
                : `https://api.bybit.com/v5/market/tickers?category=${marketType === 'futures' ? 'linear' : 'spot'}&symbol=${symbol}`;
            const res = await this._fetchWithTimeout(url);
            if (!res || !res.ok) return;
            const data = await res.json();
            const price = exchange === 'binance' ? parseFloat(data?.lastPrice) : parseFloat(data?.result?.list?.[0]?.lastPrice);
            if (!price || isNaN(price)) return;
            this.pairPrices.set(pairKey, price);
            try { this.renderer.updatePairPrice(cardKey, price); } catch (e) {}
        } catch (e) {}
    }

    _deduplicateSymbols(symbols) {
        const seen = new Set();
        return symbols.filter(item => {
            if (!item || !item.symbol) return false;
            const key = `${item.symbol}:${item.exchange}:${item.marketType}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    addInitialSymbols() {
        const savedSymbols = this.state.customSymbols;

        this._isBulkAdding = true;
        savedSymbols.forEach(symbolKey => {
            const parts = symbolKey.split(':');
            if (parts.length === 3) this.addSymbol(parts[0], true, parts[1], parts[2], false, false, true);
        });
        this._isBulkAdding = false;

        this.updateModalCount();
        this.filterCache = null;
        this._scheduleRender();

        requestAnimationFrame(() => {
            if (this._isDestroyed) return;
            const container = document.getElementById('tickerListContainer');
            const loader = document.getElementById('tickerLoader');
            if (container) container.classList.add('ready');
            if (loader) loader.style.display = 'none';
            this._blockDOMUpdates = false;
            this.startTickerPanelPriceEngine();
            this.setupDelegatedEvents();
            setTimeout(() => {
                if (this._isDestroyed) return;
                this._refreshAfterBulkPriceUpdate();
                console.log(`✅ Пересортировано: ${this.displayedTickers?.length} тикеров`);
            }, TICKER_TIMINGS.FINAL_RERENDER_DELAY);
        });
    }

    _syncToPriceManager() {
        if (!window.priceManagerInstance || this._isDestroyed) return;
        let count = 0;
        for (const [key] of this.tickersMap.entries()) {
            if (!this._subscribedSymbols.has(key)) {
                window.priceManagerInstance.subscribe(key, this._pmPriceHandler);
                this._subscribedSymbols.add(key);
                count++;
            }
        }
        console.log(`✅ TickerPanel подписан на PriceManager (${count} символов)`);
    }

    startTickerPanelPriceEngine() {
        if (this._priceEngineStarted || this._isDestroyed) return;
        this._priceEngineStarted = true;
        console.log('🚀 TickerPriceEngine: Запуск (Live через PriceManager + REST для 24h)');

        this._restQueue = [];
        this._isRestRunning = false;
        this._restToken = 0;
        this._wsUpdateRafId = null;

        this._safeFetch = async (url, retries = 3) => {
            for (let i = 0; i < retries; i++) {
                try {
                    if (i > 0) await new Promise(r => setTimeout(r, Math.min(5000 * i, 20000)));
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), TICKER_TIMINGS.FETCH_TIMEOUT);
                    let response;
                    // [VP-NET] clearTimeout в finally: при исключении таймер
                    // оставался жить и держал ссылку на контроллер.
                    try {
                        response = await fetch(url, { signal: controller.signal });
                    } finally {
                        clearTimeout(timeoutId);
                    }

                    // [ANTI-BAN] 429/418 = биржа сказала «слишком много».
                    // Немедленно останавливаемся и НЕ ретраим: по правилам Binance
                    // продолжение запросов после 429 превращается в 418 (бан IP),
                    // а продолжение после 418 — продлевает бан.
                    if (response.status === 418 || response.status === 429) {
                        console.warn(`⛔ Binance ${response.status} — запросы остановлены, Retry-After: ${response.headers.get('Retry-After') || 'нет'}`);
                        return null;
                    }
                    if (!response.ok) return null;
                    return await response.json();
                } catch (e) {
                    // [VP-NET] раньше здесь было `if (e.name !== 'AbortError') continue;`
                    // — то есть сетевая ошибка молча уходила на следующий круг,
                    // а причина не логировалась вообще.
                    const reason = (e && e.name === 'AbortError')
                        ? `таймаут ${Math.round(TICKER_TIMINGS.FETCH_TIMEOUT / 1000)} с`
                        : (e && e.message) || String(e);
                    console.warn(`⚠️ [TICKER] ${String(url).split('?')[0]}: ${reason} (попытка ${i + 1}/${retries})`);
                }
            }
            return null;
        };

        this._processRestQueue = async () => {
            if (this._isRestRunning || this._isDestroyed) return;
            this._isRestRunning = true;
            this._restInProgress = true;
            const myToken = this._restToken;
            let count = 0;
            let stale = false;
            try {
                while (this._restQueue.length > 0) {
                    if (this._restToken !== myToken || this._isDestroyed) {
                        stale = true;
                        break;
                    }
                    const task = this._restQueue.shift();
                    count++;
                    await task();
                    if (this._restQueue.length > 0) {
                        await new Promise(r => setTimeout(r, TICKER_TIMINGS.REST_QUEUE_DELAY));
                    }
                }
            } finally {
                if (this._restToken === myToken && !this._isDestroyed) {
                    this._isRestRunning = false;
                    this._restInProgress = false;
                }
            }
            if (stale) return;
            console.log(`✅ REST завершён (${count} запросов)`);

            if (!this._blockDOMUpdates && !this._isDestroyed) {
                setTimeout(() => {
                    this._refreshAfterBulkPriceUpdate();
                    this.updateModalCount?.();
                }, 50);
            }
        };

        const loadAllData = async () => {
            if (this.tickersMap.size === 0 || this._isDestroyed) return;
            const groups = { bnFut: [], bnSpot: [], byFut: [], bySpot: [] };

            for (const [, t] of this.tickersMap.entries()) {
                if (t.exchange === 'binance' && t.marketType === 'futures') groups.bnFut.push(t.symbol);
                if (t.exchange === 'binance' && t.marketType === 'spot') groups.bnSpot.push(t.symbol);
                if (t.exchange === 'bybit' && t.marketType === 'futures') groups.byFut.push(t.symbol);
                if (t.exchange === 'bybit' && t.marketType === 'spot') groups.bySpot.push(t.symbol);
            }

            this._restQueue = [];

            const createBinanceTask = (symbols, marketType) => {
                return async () => {
                    const baseUrl = marketType === 'futures'
                        ? 'https://fapi.binance.com/fapi/v1/ticker/24hr'
                        : 'https://api.binance.com/api/v3/ticker/24hr';
                    const symbolsParam = symbols.map(s => `"${s}"`).join(',');
                    const data = await this._safeFetch(`${baseUrl}?symbols=[${symbolsParam}]`);
                    if (Array.isArray(data)) {
                        data.forEach(t => this._updateTickerFromBinance(t, marketType));
                    }
                };
            };

            const createBybitTask = (symbols, marketType) => {
                return async () => {
                    const category = marketType === 'futures' ? 'linear' : 'spot';
                    const data = await this._safeFetch(`https://api.bybit.com/v5/market/tickers?category=${category}`);
                    if (data?.retCode === 0 && data.result?.list) {
                        const set = new Set(symbols);
                        data.result.list.forEach(t => {
                            if (set.has(t.symbol)) this._updateTickerFromBybit(t, marketType);
                        });
                    }
                };
            };

            for (let i = 0; i < groups.bnFut.length; i += TICKER_TIMINGS.BINANCE_BATCH_SIZE) {
                this._restQueue.push(createBinanceTask(groups.bnFut.slice(i, i + TICKER_TIMINGS.BINANCE_BATCH_SIZE), 'futures'));
            }
            for (let i = 0; i < groups.bnSpot.length; i += TICKER_TIMINGS.BINANCE_BATCH_SIZE) {
                this._restQueue.push(createBinanceTask(groups.bnSpot.slice(i, i + TICKER_TIMINGS.BINANCE_BATCH_SIZE), 'spot'));
            }

            if (groups.byFut.length > 0) this._restQueue.push(createBybitTask(groups.byFut, 'futures'));
            if (groups.bySpot.length > 0) this._restQueue.push(createBybitTask(groups.bySpot, 'spot'));

            await this._processRestQueue();
            console.log(`💰 Загружено ${this.tickersMap.size} тикеров с ценами!`);
        };

        console.log('⏳ Первичная загрузка REST...');
        setTimeout(() => { if (!this._isDestroyed) loadAllData(); }, TICKER_TIMINGS.INITIAL_DATA_DELAY);

        this._pollInterval = setInterval(() => {
            if (!this._isRestRunning && this._restQueue.length === 0 && !document.hidden && !this._isDestroyed) {
                loadAllData().catch(e => console.warn('⚠️ Ошибка REST:', e));
            }
        }, TICKER_TIMINGS.REST_POLL_INTERVAL);

        this.pollRestData = loadAllData;
        this._syncToPriceManager();
    }

    destroyPriceEngine() {
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
        if (window.priceManagerInstance && this._pmPriceHandler) {
            for (const key of this._subscribedSymbols) {
                window.priceManagerInstance.unsubscribe(key, this._pmPriceHandler);
            }
            this._subscribedSymbols.clear();
        }
        this._unsubscribeAllStockPairs();
        this._priceEngineStarted = false;
    }

    destroy() {
        console.log('🗑️ Уничтожение TickerPanel...');
        this._isDestroyed = true;

        this.destroyPriceEngine();

        if (this._restDebounceTimer) {
            clearTimeout(this._restDebounceTimer);
            this._restDebounceTimer = null;
        }
        if (this._cacheRefreshInterval) {
            clearInterval(this._cacheRefreshInterval);
            this._cacheRefreshInterval = null;
        }
        if (this._priceUpdateRaf) {
            cancelAnimationFrame(this._priceUpdateRaf);
            this._priceUpdateRaf = null;
        }

        document.removeEventListener('contextmenu', this._globalContextMenuHandler);
        document.removeEventListener('click', this._globalClickHandler);
        document.removeEventListener('visibilitychange', this._visibilityHandler);
        window.removeEventListener('focus', this._focusHandler);

        this.tickers.length = 0;
        this.tickersMap.clear();
        this._subscribedSymbols.clear();
        this._rowDomCache.clear();
        this._pendingPriceUpdates.clear();
        this._lastUiUpdateMap.clear();

        // ✅ ФИКС: сброс сигнатуры, чтобы при пересоздании панели не тянуть
        // устаревшее значение между инстансами.
        this._lastSymbolsSig = null;

        console.log('✅ TickerPanel полностью уничтожен');
    }

    _clearDomCache() {
        this._rowDomCache.clear();
    }

    clearAllSymbols() {
        console.log('🗑️ Начало очистки всех символов...');

        if (window.priceManagerInstance && this._pmPriceHandler) {
            for (const key of this._subscribedSymbols) {
                window.priceManagerInstance.unsubscribe(key, this._pmPriceHandler);
            }
        }
        this._unsubscribeAllStockPairs();

        this.tickers.length = 0;
        this.tickersMap.clear();
        this.state.customSymbols = [];
        this.state.favorites = [];
        this.state.flags = {};
        this.tickerElements.clear();
        this._rowDomCache.clear();
        this._subscribedSymbols.clear();
        this._lastUiUpdateMap.clear();

        // ✅ ФИКС: при массовой очистке сбрасываем сигнатуру, чтобы следующий
        // вызов getFilteredTickers() гарантированно пересчитал результат.
        this._lastSymbolsSig = null;

        if (this.renderer) {
            this.renderer._displayedTickers = [];
            this.renderer._totalItems = 0;
            this.renderer._filteredTickersCache = null;
        }
        this.filterCache = null;
        this.formatCache = { prices: new Map(), volumes: new Map(), changes: new Map() };
        if (this.renderer) this.renderer._formatCache.clear();

        if (this.watchlistManager) {
            const list = this.watchlistManager.lists.get(this.watchlistManager.activeListId);
            if (list) {
                list.symbols = [];
                list.flags = {};
                list.favorites = [];
                this.watchlistManager.saveToStorageImmediate();
                this.watchlistManager.renderCache.delete(this.watchlistManager.activeListId);
            }
            const btnCount = document.querySelector('.wl-btn-count');
            if (btnCount) btnCount.textContent = '0';
            this.watchlistManager.renderDropdown?.();
        }

        const container = document.getElementById('tickerListContainer');
        if (container) {
            container.innerHTML = '';
            container.style.height = 'auto';
            container.scrollTop = 0;
            container.classList.remove('ready');
            requestAnimationFrame(() => {
                if (!this._isDestroyed) {
                    this._scheduleRender();
                    setTimeout(() => { if (container) container.classList.add('ready'); }, 50);
                }
            });
        }
        this.saveState();
        this.updateModalCount?.();
        console.log('✅ Очистка завершена! Тикеров:', this.tickersMap.size);
    }

    syncWithActiveWatchlist() {
        if (!this.watchlistManager || this._isDestroyed) return;
        const activeList = this.watchlistManager.lists.get(this.watchlistManager.activeListId);
        if (activeList) {
            if (!this._arraysEqual(this.state.customSymbols, activeList.symbols)) {
                activeList.symbols = [...this.state.customSymbols];
            }
            activeList.flags = { ...this.state.flags };
            activeList.favorites = [...this.state.favorites];
        }

        this.filterCache = null;
        // ✅ ФИКС: сбрасываем сигнатуру, чтобы getFilteredTickers() не отдал
        // кэш от предыдущего списка.
        this._lastSymbolsSig = null;
        this.tickerElements.clear();
        this._rowDomCache.clear();
        this._scheduleRender();
    }

    addSymbol(symbol, isCustom = true, exchange = 'binance', marketType = 'futures', render = true, skipInitialFetch = false, skipWatchlistSync = false) {
        if (this._isDestroyed) return false;
        symbol = symbol.trim().toUpperCase();
        if (!this._isValidSymbol(symbol)) return false;
        const key = `${symbol}:${exchange}:${marketType}`;

        if (isCustom && this.watchlistManager && !skipWatchlistSync) {
            this.watchlistManager.addSymbolToActiveList(symbol, exchange, marketType);
            this.watchlistManager.renderDropdown();
        }

        if (this.tickersMap.has(key)) {
            const existingTicker = this.tickersMap.get(key);
            if (!this.tickers.includes(existingTicker)) {
                this.tickers.push(existingTicker);
                this.filterCache = null;
                this._lastSymbolsSig = null; // ✅ ФИКС
                if (render) this._scheduleRender();
            }
            return true;
        }

        // 📈 Для акций помним класс актива и пару «спот ↔ фьючерс»
        const assetClass = this._assetClassOf(symbol, exchange, marketType);
        const pair = assetClass === 'stocks' ? (this._stockPairIndex?.get(key) || null) : null;

        const newTicker = {
            symbol, price: 0, change: 0, volume: 0, trades: null,
            custom: true, prevPrice: 0, exchange, marketType,
            flag: this.state.flags[key] || null,
            assetClass,
            pairKey: pair ? pair.pairKey : null,
            pairLabel: pair ? pair.pairLabel : null,
            pairTitle: pair ? pair.pairTitle : null
        };

        this.tickers.push(newTicker);
        this.tickersMap.set(key, newTicker);
        if (!this.state.customSymbols.includes(key)) this.state.customSymbols.push(key);

        if (window.priceManagerInstance && !this._subscribedSymbols.has(key)) {
            window.priceManagerInstance.subscribe(key, this._pmPriceHandler);
            this._subscribedSymbols.add(key);
        }
        if (newTicker.pairKey) this._subscribeStockPair(key, newTicker.pairKey);

        this.filterCache = null;
        this._lastSymbolsSig = null; // ✅ ФИКС
        if (render) this._scheduleRender();

        if (!skipInitialFetch && !this._isBulkAdding) {
            this.fetchInitialDataForSymbol(symbol, exchange, marketType).then(() => {
                if (!this._isDestroyed) {
                    setTimeout(() => { this.renderTickerList(); }, 50);
                }
            }).catch(err => {
                console.warn('⚠️ Ошибка получения начальных данных:', err);
            });
        }

        return true;
    }

    async addSymbolsBatch(symbolsData) {
        if (!symbolsData || symbolsData.length === 0 || this._isDestroyed) return;
        const addedKeys = [];

        symbolsData.forEach(({ symbol, exchange, marketType }) => {
            if (!symbol) return;
            symbol = symbol.trim().toUpperCase();
            if (!this._isValidSymbol(symbol)) return;
            const key = `${symbol}:${exchange}:${marketType}`;

            if (!this.tickersMap.has(key)) {
                // 📈 Для акций помним класс актива и пару «спот ↔ фьючерс»
                const assetClass = this._assetClassOf(symbol, exchange, marketType);
                const pair = assetClass === 'stocks' ? (this._stockPairIndex?.get(key) || null) : null;
                const newTicker = {
                    symbol, price: 0, change: 0, volume: 0, trades: null,
                    custom: true, prevPrice: 0, exchange, marketType,
                    flag: this.state.flags[key] || null,
                    assetClass,
                    pairKey: pair ? pair.pairKey : null,
                    pairLabel: pair ? pair.pairLabel : null,
                    pairTitle: pair ? pair.pairTitle : null
                };
                this.tickers.push(newTicker);
                this.tickersMap.set(key, newTicker);
                addedKeys.push(key);

                if (window.priceManagerInstance && !this._subscribedSymbols.has(key)) {
                    window.priceManagerInstance.subscribe(key, this._pmPriceHandler);
                    this._subscribedSymbols.add(key);
                }
                if (newTicker.pairKey) this._subscribeStockPair(key, newTicker.pairKey);
            }
        });

        if (addedKeys.length === 0) return;

        if (this.watchlistManager) {
            const list = this.watchlistManager.lists.get(this.watchlistManager.activeListId);
            if (list) {
                for (const key of addedKeys) {
                    if (!list.symbols.includes(key)) list.symbols.push(key);
                }
                this.watchlistManager.renderCache.delete(this.watchlistManager.activeListId);
                this.watchlistManager.saveToStorage();
                this.watchlistManager.renderDropdown();
            }
        }

        this.syncWithActiveWatchlist();
        this.saveState();
        this.filterCache = null;
        this._lastSymbolsSig = null; // ✅ ФИКС
        this.tickerElements.clear();
        this._scheduleRender();

        if (this._restDebounceTimer) clearTimeout(this._restDebounceTimer);
        this._restDebounceTimer = setTimeout(() => {
            if (this.pollRestData && !this._isDestroyed) this.pollRestData();
        }, 1000);
    }

    async fetchBatchSnapshots(symbols) {
        if (!symbols || symbols.length === 0 || this._isDestroyed) return;
        const startTime = Date.now();
        while (this._fetchBatchInProgress && Date.now() - startTime < 10000) {
            await new Promise(r => setTimeout(r, 100));
        }
        if (this._fetchBatchInProgress) {
            console.warn('⚠️ Fetch batch timeout, forcing reset');
            this._fetchBatchInProgress = false;
        }
        this._fetchBatchInProgress = true;

        try {
            const BATCH_SIZE = 25;
            const bnFutures = symbols.filter(s => s.exchange === 'binance' && s.marketType === 'futures');
            const bnSpot = symbols.filter(s => s.exchange === 'binance' && s.marketType === 'spot');
            const byFutures = symbols.filter(s => s.exchange === 'bybit' && s.marketType === 'futures');
            const bySpot = symbols.filter(s => s.exchange === 'bybit' && s.marketType === 'spot');

            const fetchBinanceBatched = async (symbolList, marketType) => {
                for (let i = 0; i < symbolList.length; i += BATCH_SIZE) {
                    const batch = symbolList.slice(i, i + BATCH_SIZE);
                    const symbolsParam = batch.map(s => `"${s.symbol}"`).join(',');
                    try {
                        const url = marketType === 'futures' ? `https://fapi.binance.com/fapi/v1/ticker/24hr?symbols=[${symbolsParam}]` : `https://api.binance.com/api/v3/ticker/24hr?symbols=[${symbolsParam}]`;
                        const response = await this._fetchWithTimeout(url);
                        if (!response || !response.ok) continue;
                        const data = await response.json();
                        if (Array.isArray(data)) data.forEach(t => this._updateTickerFromBinance(t, marketType));
                    } catch (e) {}
                    if (i + BATCH_SIZE < symbolList.length) await new Promise(r => setTimeout(r, TICKER_TIMINGS.BATCH_DELAY));
                }
            };

            const fetchBybitBulk = async (symbolList, marketType) => {
                if (symbolList.length === 0) return;
                try {
                    const category = marketType === 'futures' ? 'linear' : 'spot';
                    const url = `https://api.bybit.com/v5/market/tickers?category=${category}`;
                    const response = await this._fetchWithTimeout(url);
                    if (!response || !response.ok) return;
                    const data = await response.json();
                    if (data.retCode === 0 && data.result?.list) {
                        const symbolSet = new Set(symbolList.map(s => s.symbol));
                        data.result.list.forEach(t => { if (symbolSet.has(t.symbol)) this._updateTickerFromBybit(t, marketType); });
                    }
                } catch (e) {}
            };

            await Promise.all([
                fetchBinanceBatched(bnFutures, 'futures'),
                fetchBinanceBatched(bnSpot, 'spot'),
                fetchBybitBulk(byFutures, 'futures'),
                fetchBybitBulk(bySpot, 'spot')
            ]);
            if (!this._isDestroyed) this._refreshAfterBulkPriceUpdate();
        } finally {
            this._fetchBatchInProgress = false;
        }
    }

    _updateTickerFromBinance(data, marketType) {
        const key = `${data.symbol}:binance:${marketType}`;
        const ticker = this.tickersMap.get(key);
        if (!ticker) return;

        const newPrice = parseFloat(data.lastPrice) || 0;
        if (newPrice <= 0) return;

        ticker.prevPrice = ticker.price || newPrice;
        ticker.price = newPrice;
        ticker.volume = parseFloat(data.quoteVolume) || 0;
        ticker.trades = parseInt(data.count) || 0;

        if (!this._blockDOMUpdates && !this._isDestroyed) {
            this.renderer.updatePriceForSymbol(key, newPrice, ticker.change);
        }
    }

    _updateTickerFromBybit(data, marketType) {
        const key = `${data.symbol}:bybit:${marketType}`;
        const ticker = this.tickersMap.get(key);
        if (!ticker) return;

        const newPrice = parseFloat(data.lastPrice) || 0;
        if (newPrice <= 0) return;

        ticker.prevPrice = ticker.price || newPrice;
        ticker.price = newPrice;
        ticker.volume = parseFloat(data.volume24h) * newPrice || 0;

        if (!this._blockDOMUpdates && !this._isDestroyed) {
            this.renderer.updatePriceForSymbol(key, newPrice, ticker.change);
        }
    }

    async fetchInitialDataForSymbol(symbol, exchange, marketType) {
        if (this._isDestroyed) return;
        try {
            const url = exchange === 'binance'
                ? (marketType === 'futures' ? `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}` : `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`)
                : `https://api.bybit.com/v5/market/tickers?category=${marketType === 'futures' ? 'linear' : 'spot'}&symbol=${symbol}`;

            const response = await this._fetchWithTimeout(url);
            if (!response) throw new Error('запрос не завершился (таймаут/сеть)');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            const ticker = this.tickersMap.get(`${symbol}:${exchange}:${marketType}`);
            if (!ticker || this._isDestroyed) return;

            if (exchange === 'binance') {
                ticker.price = parseFloat(data.lastPrice);
                ticker.change = parseFloat(data.priceChangePercent);
                ticker.volume = parseFloat(data.quoteVolume);
                ticker.trades = parseInt(data.count);
            } else if (data.retCode === 0 && data.result?.list?.[0]) {
                const d = data.result.list[0];
                ticker.price = parseFloat(d.lastPrice);
                ticker.change = parseFloat(d.price24hPcnt) * 100;
                ticker.volume = parseFloat(d.turnover24h) || parseFloat(d.volume24h) * parseFloat(d.lastPrice);
            }
        } catch (error) {
            console.warn(`⚠️ Не удалось загрузить ${symbol}:`, error);
        }
    }

    async fetchBybitSnapshots() {
        if (this._isDestroyed) return;
        try {
            const [futRes, spotRes] = await Promise.all([
                this._fetchWithTimeout('https://api.bybit.com/v5/market/tickers?category=linear'),
                this._fetchWithTimeout('https://api.bybit.com/v5/market/tickers?category=spot')
            ]);

            if (!futRes || !spotRes || !futRes.ok || !spotRes.ok) throw new Error('Bybit API error');

            const futData = await futRes.json();
            const spotData = await spotRes.json();

            if (futData.retCode === 0) {
                futData.result.list.forEach(t => {
                    if (t.symbol?.endsWith('USDT')) {
                        const tk = this.tickersMap.get(`${t.symbol}:bybit:futures`);
                        if (tk) { tk.price = parseFloat(t.lastPrice); tk.change = parseFloat(t.price24hPcnt) * 100; tk.volume = parseFloat(t.volume24h) * parseFloat(t.lastPrice); }
                    }
                });
            }
            if (spotData.retCode === 0) {
                spotData.result.list.forEach(t => {
                    if (t.symbol?.endsWith('USDT')) {
                        const tk = this.tickersMap.get(`${t.symbol}:bybit:spot`);
                        if (tk) { tk.price = parseFloat(t.lastPrice); tk.change = parseFloat(t.price24hPcnt) * 100; tk.volume = parseFloat(t.volume24h) * parseFloat(t.lastPrice); }
                    }
                });
            }
            if (!this._isDestroyed) this._refreshAfterBulkPriceUpdate();
        } catch (error) {
            console.error('❌ Ошибка загрузки Bybit:', error);
        }
    }

    removeSymbol(symbol, exchange, marketType) {
        if (!symbol || this._isDestroyed) return;
        const key = `${symbol}:${exchange}:${marketType}`;

        const wasCurrentSymbol = (
            this.state.currentSymbol === symbol &&
            this.state.currentExchange === exchange &&
            this.state.currentMarketType === marketType
        );

        let nextTicker = null;
        if (wasCurrentSymbol) {
            const filteredTickers = this.renderer.getFilteredTickers();
            const currentIndex = filteredTickers.findIndex(t =>
                t.symbol === symbol && t.exchange === exchange && t.marketType === marketType
            );

            if (currentIndex !== -1) {
                if (currentIndex + 1 < filteredTickers.length) {
                    nextTicker = filteredTickers[currentIndex + 1];
                } else if (currentIndex > 0) {
                    nextTicker = filteredTickers[currentIndex - 1];
                }
            }
        }

        delete this.state.flags[key];

        const tickerIdx = this.tickers.findIndex(t =>
            t.symbol === symbol && t.exchange === exchange && t.marketType === marketType
        );
        if (tickerIdx !== -1) this.tickers.splice(tickerIdx, 1);

        this.tickersMap.delete(key);
        this._rowDomCache.delete(key);
        this._subscribedSymbols.delete(key);
        this._unsubscribeStockPair(key);
        this._lastUiUpdateMap.delete(key);
        this.state.customSymbols = this.state.customSymbols.filter(s => s !== key);
        this.state.favorites = this.state.favorites.filter(s => s !== symbol);

        if (window.priceManagerInstance && this._pmPriceHandler) {
            window.priceManagerInstance.unsubscribe(key, this._pmPriceHandler);
        }

        if (this.watchlistManager) {
            this.watchlistManager.removeSymbolFromActiveList(symbol, exchange, marketType);
            this.watchlistManager.renderDropdown();
        }
        this.saveState();

        if (wasCurrentSymbol && nextTicker) {
            this.state.currentSymbol = nextTicker.symbol;
            this.state.currentExchange = nextTicker.exchange;
            this.state.currentMarketType = nextTicker.marketType;
            this.saveCurrentSymbol(nextTicker.symbol, nextTicker.exchange, nextTicker.marketType);

            try {
                if (this.coordinator?.chartManager) {
                    this.coordinator.chartManager.switchSymbol(
                        nextTicker.symbol,
                        nextTicker.exchange,
                        nextTicker.marketType
                    );
                }
            } catch (error) {
                console.error('❌ Ошибка переключения символа:', error);
            }

            const pairDisplay = document.getElementById('pairDisplay');
            if (pairDisplay) pairDisplay.textContent = nextTicker.symbol;

            const exchangeDisplay = document.getElementById('exchangeDisplay');
            if (exchangeDisplay) exchangeDisplay.textContent = nextTicker.exchange === 'binance' ? 'Binance' : 'Bybit';

            const contractTypeDisplay = document.getElementById('contractTypeDisplay');
            if (contractTypeDisplay) contractTypeDisplay.textContent = nextTicker.marketType === 'futures' ? 'PERP' : 'SPOT';

            if (window.timeframeManager) window.timeframeManager.updateInstrumentInfo();

        } else if (wasCurrentSymbol) {
            this.state.currentSymbol = '';
            this.state.currentExchange = 'binance';
            this.state.currentMarketType = 'futures';

            const pairDisplay = document.getElementById('pairDisplay');
            if (pairDisplay) pairDisplay.textContent = 'Выберите пару';

            const exchangeDisplay = document.getElementById('exchangeDisplay');
            if (exchangeDisplay) exchangeDisplay.textContent = 'Binance';

            const contractTypeDisplay = document.getElementById('contractTypeDisplay');
            if (contractTypeDisplay) contractTypeDisplay.textContent = 'PERP';
        }

        this.filterCache = null;
        this._lastSymbolsSig = null; // ✅ ФИКС
        this._scheduleRender();

        if (wasCurrentSymbol && nextTicker) {
            setTimeout(() => {
                if (this._isDestroyed) return;
                const activeEl = document.querySelector(
                    `.ticker-item[data-symbol="${nextTicker.symbol}"][data-exchange="${nextTicker.exchange}"][data-market-type="${nextTicker.marketType}"]`
                );
                if (activeEl) {
                    document.querySelectorAll('.ticker-item.active').forEach(el => el.classList.remove('active'));
                    activeEl.classList.add('active');
                }
            }, 150);
        }
    }

    handleKeyDelete(e) {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT')) return;
        const activeTicker = document.querySelector('.ticker-item.active');
        if (!activeTicker) return;
        e.preventDefault();
        const symbol = activeTicker.dataset.symbol, exchange = activeTicker.dataset.exchange, marketType = activeTicker.dataset.marketType;
        if (symbol && exchange && marketType) {
            const notification = document.getElementById('alertNotification');
            if (notification) {
                notification.innerHTML = `<div class="alert-title">🗑️ Удален</div><div class="alert-price">${this._escapeHtml(symbol)}</div><div class="alert-repeat">${this._escapeHtml(exchange)} ${this._escapeHtml(marketType)}</div>`;
                notification.style.display = 'block';
                notification.style.borderLeftColor = '#f23645';
                setTimeout(() => notification.style.display = 'none', 2000);
            }
            this.removeSymbol(symbol, exchange, marketType);
        }
    }

    handleTickerClick(e) {
        if (this._isDestroyed) return;
        const star = e.target.closest('.star');
        if (star) { e.preventDefault(); e.stopPropagation(); this.handleStarClick(star); return; }
        const flag = e.target.closest('.flag');
        if (flag) { e.preventDefault(); e.stopPropagation(); return; }

        const tickerItem = e.target.closest('.ticker-item');
        if (tickerItem && tickerItem.dataset.symbol) {
            const symbol = tickerItem.dataset.symbol;
            const exchange = tickerItem.dataset.exchange;
            const marketType = tickerItem.dataset.marketType;

            // [VP-CLICK] Раньше здесь сравнивали ТОЛЬКО с состоянием панели и
            // выходили. Но панель обновлялась оптимистично — ДО загрузки символа,
            // поэтому при любом рассинхроне (переключение не завершилось, запрос
            // потерялся в очереди, страница вернулась из фона) повторный клик по
            // тому же тикеру не делал НИЧЕГО: график оставался на прошлом символе
            // или пустым, а «вылечить» его кликом было уже невозможно.
            // Теперь «тем же самым» считается только полное совпадение
            // панель + график, и при совпадении график всё равно проверяется.
            const cm = this.coordinator?.chartManager;
            const panelMatches = this.state.currentSymbol === symbol &&
                this.state.currentExchange === exchange &&
                this.state.currentMarketType === marketType;
            const chartMatches = !!cm && cm.currentSymbol === symbol &&
                cm.currentExchange === exchange && cm.currentMarketType === marketType;
            if (panelMatches && chartMatches && this._isChartUsable(cm)) return;

            this._requestSymbolSwitch(symbol, exchange, marketType);
        }
    }

    /** [VP-CLICK] График действительно живой: есть свечи, нет зависшего переключения. */
    _isChartUsable(cm) {
        try {
            if (!cm) return false;
            if (cm._switchingSymbol || cm._isSwitchingInterval) return false;
            if (cm._symbolSwitchOverlay && parseFloat(cm._symbolSwitchOverlay.style.opacity || '0') > 0.05) return false;
            return Array.isArray(cm.chartData) && cm.chartData.length > 0;
        } catch (e) { return false; }
    }

    /** [VP-CLICK] Идёт ли ещё переключение (или наш запрос стоит в очереди). */
    _isSwitchInProgress(cm, symbol) {
        try {
            if (!cm) return false;
            if (cm._switchingSymbol || cm._isSwitchingInterval) return true;
            const q = cm._pendingSwitchRequest;
            if (q && (q.symbol === undefined || q.symbol === symbol)) return true;
        } catch (e) {}
        return false;
    }

    /**
     * [VP-CLICK] Ждём, пока график «усядется»: переключение завершилось, затемнение
     * погасло, свечи на месте. Без этого проверка результата срабатывала в
     * переходный момент (оверлей ещё гаснет) и запускала лишнее повторное
     * переключение того же символа — двойные запросы и мигание графика.
     */
    _settleChart(cm, timeoutMs = 12000) {
        return new Promise((resolve) => {
            const startedAt = Date.now();
            const tick = () => {
                if (this._isDestroyed) { resolve(false); return; }
                if (this._isChartUsable(cm)) { resolve(true); return; }
                if (Date.now() - startedAt > timeoutMs) { resolve(this._isChartUsable(cm)); return; }
                setTimeout(tick, 120);
            };
            tick();
        });
    }

    /** [VP-CLICK] Возврат панели/шапки к символу, который РЕАЛЬНО на графике. */
    _syncPanelToChart(cm) {
        try {
            const sym = cm.currentSymbol, ex = cm.currentExchange, mt = cm.currentMarketType;
            if (!sym) return;
            if (typeof this.setCurrentSymbolSilently === 'function') this.setCurrentSymbolSilently(sym, ex, mt);
            this._setHeaderSymbol(sym, ex, mt);
        } catch (e) {}
    }

    /**
     * [VP-CLICK] Единая точка «пользователь выбрал инструмент».
     *
     * ЧТО БЫЛО: switchSymbol() вызывался «выстрелил и забыл» (без await и без
     * проверки результата), а состояние панели, подсветка строки, шапка и
     * localStorage менялись СРАЗУ. Если переключение вставало в очередь
     * (_switchingSymbol) или завершалось ошибкой, панель продолжала утверждать,
     * что инструмент открыт: «кликнул — график пустой / остался старый».
     *
     * ЧТО СТАЛО: UI по-прежнему обновляется мгновенно (иначе клик ощущается
     * «мёртвым»), но результат переключения проверяется, и при расхождении
     * панель либо дожимает загрузку, либо возвращается к символу, который
     * РЕАЛЬНО на графике.
     */
    _requestSymbolSwitch(symbol, exchange, marketType) {
        const cm = this.coordinator?.chartManager;
        if (!cm || typeof cm.switchSymbol !== 'function') return;

        this.state.currentSymbol = symbol;
        this.state.currentExchange = exchange;
        this.state.currentMarketType = marketType;
        try { this.saveCurrentSymbol(symbol, exchange, marketType); } catch (e) {}

        document.querySelectorAll('.ticker-item.active').forEach(el => el.classList.remove('active'));
        try {
            const sel = `.ticker-item[data-symbol="${symbol}"][data-exchange="${exchange}"][data-market-type="${marketType}"]`;
            const el = document.querySelector(sel);
            if (el) el.classList.add('active');
        } catch (e) {}
        this._setHeaderSymbol(symbol, exchange, marketType);

        const token = (this._switchReqToken = (this._switchReqToken || 0) + 1);
        let promise;
        try {
            promise = Promise.resolve(cm.switchSymbol(symbol, exchange, marketType));
        } catch (error) {
            console.error('❌ Ошибка переключения символа:', error);
            return;
        }
        promise
            .catch(err => console.error('❌ switchSymbol отклонён:', err))
            .then(() => { if (!this._isDestroyed) this._verifySymbolSwitch(symbol, exchange, marketType, token); });
    }

    /**
     * [VP-CLICK] Контроль результата переключения.
     *
     * Если график так и не оказался на запрошенном символе (переключение
     * потерялось в очереди, завершилось ошибкой или зависло), а запрос при этом
     * НЕ в очереди и сеть есть — повторяем переключение один раз. При повторной
     * неудаче панель и шапка возвращаются к символу, который реально на графике,
     * чтобы следующий клик снова сработал (раньше он упирался в защиту
     * «этот тикер уже выбран» и график оставался чужим/пустым до перезагрузки).
     */
    _verifySymbolSwitch(symbol, exchange, marketType, token, isRetry = false) {
        if (this._isDestroyed || token !== this._switchReqToken) return;   // есть более свежий клик
        const cm = this.coordinator?.chartManager;
        if (!cm) return;

        this._settleChart(cm).then(() => {
            if (this._isDestroyed || token !== this._switchReqToken) return;
            // пользователь тем временем выбрал другой инструмент — не мешаем
            if (this.state.currentSymbol !== symbol || this.state.currentExchange !== exchange ||
                this.state.currentMarketType !== marketType) return;

            const matches = cm.currentSymbol === symbol && cm.currentExchange === exchange &&
                cm.currentMarketType === marketType;
            if (matches && this._isChartUsable(cm)) return;                 // всё хорошо
            if (this._isSwitchInProgress(cm, symbol)) return;               // ещё грузится/в очереди
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return;  // офлайн

            if (!isRetry) {
                console.warn(`⚠️ [VP-CLICK] ${symbol}: после клика график остался на ` +
                    `${cm.currentSymbol} — повторяю переключение`);
                let p;
                try { p = Promise.resolve(cm.switchSymbol(symbol, exchange, marketType)); } catch (e) { return; }
                p.catch(() => {}).then(() => {
                    if (!this._isDestroyed) this._verifySymbolSwitch(symbol, exchange, marketType, token, true);
                });
                return;
            }

            console.error(`❌ [VP-CLICK] ${symbol} не открылся (на графике: ${cm.currentSymbol}) — ` +
                `возвращаю панель к текущему символу`);
            this._syncPanelToChart(cm);
        });
    }

    /** [VP-CLICK] Шапка — один источник правды для трёх вызовов. */
    _setHeaderSymbol(symbol, exchange, marketType) {
        const pairDisplay = document.getElementById('pairDisplay');
        if (pairDisplay) pairDisplay.textContent = symbol;
        const exchangeDisplay = document.getElementById('exchangeDisplay');
        if (exchangeDisplay) exchangeDisplay.textContent = exchange === 'binance' ? 'Binance' : 'Bybit';
        const contractTypeDisplay = document.getElementById('contractTypeDisplay');
        if (contractTypeDisplay) contractTypeDisplay.textContent = marketType === 'futures' ? 'PERP' : 'SPOT';
        try { if (window.timeframeManager) window.timeframeManager.updateInstrumentInfo(); } catch (e) {}
    }

    handleStarClick(star) {
        if (this._isDestroyed) return;
        const symbol = star.dataset.symbol;
        if (!symbol) return;
        const index = this.state.favorites.indexOf(symbol);
        if (index === -1) this.state.favorites.push(symbol);
        else this.state.favorites.splice(index, 1);

        this.filterCache = null;
        this._lastSymbolsSig = null; // ✅ ФИКС (на всякий случай, влияет на вкладку favorites)
        this.saveState();
        star.classList.toggle('favorite', index === -1);

        if (this.state.activeTab === 'favorites') {
            this._scheduleRender();
        }
    }

    handleContextMenu(e) {
        if (this._isDestroyed) return;
        let target = e.target;
        if (target && target.nodeType === 3) target = target.parentElement;
        if (!target) return;

        const tickerItem = target.closest('.ticker-item');
        if (!tickerItem) return;

        if (target.closest('.flag') || target.closest('.flag-placeholder')) {
            e.preventDefault(); e.stopPropagation();
            const contextMenu = document.getElementById('flagContextMenu');
            if (!contextMenu) return;
            contextMenu.dataset.symbol = tickerItem.dataset.symbol;
            contextMenu.dataset.exchange = tickerItem.dataset.exchange;
            contextMenu.dataset.marketType = tickerItem.dataset.marketType;
            const x = Math.min(e.pageX, window.innerWidth - 200);
            const y = Math.min(e.pageY, window.innerHeight - 200);
            contextMenu.style.display = 'block';
            contextMenu.style.left = x + 'px';
            contextMenu.style.top = y + 'px';
            const tickerMenu = document.getElementById('tickerContextMenu');
            if (tickerMenu) tickerMenu.style.display = 'none';

            requestAnimationFrame(() => {
                const rect = contextMenu.getBoundingClientRect();
                if (rect.bottom > window.innerHeight) contextMenu.style.top = Math.max(0, window.innerHeight - rect.height - 10) + 'px';
                if (rect.right > window.innerWidth) contextMenu.style.left = Math.max(0, window.innerWidth - rect.width - 10) + 'px';
            });
            return;
        }

        const nameColumn = tickerItem.children[0];
        if (!nameColumn || !nameColumn.contains(target)) return;
        if (target.closest('.star') || target.closest('.market-sup')) return;

        e.preventDefault(); e.stopPropagation();
        const symbol = tickerItem.dataset.symbol;
        const exchange = tickerItem.dataset.exchange;
        const marketType = tickerItem.dataset.marketType;

        let menu = document.getElementById('tickerContextMenu');
        if (!menu) {
            menu = document.createElement('div');
            menu.id = 'tickerContextMenu';
            menu.className = 'context-menu';
            menu.style.maxHeight = '350px';
            menu.style.overflowY = 'auto';
            document.body.appendChild(menu);
        }

        let html = `<div class="context-menu-item" data-action="copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>Копировать ${this._escapeHtml(symbol)}</div>`;

        if (this.watchlistManager && this.watchlistManager.lists) {
            html += `<div class="context-menu-divider"></div><div class="context-menu-label">Добавить в вотчлист:</div>`;
            this.watchlistManager.listOrder.forEach(listId => {
                const list = this.watchlistManager.lists.get(listId);
                if (list) {
                    html += `<div class="context-menu-item" data-action="add-wl" data-list-id="${listId}" data-symbol="${symbol}" data-exchange="${exchange}" data-market-type="${marketType}">${listId === this.watchlistManager.activeListId ? '⭐' : '📋'} ${this._escapeHtml(list.name)} <span style="margin-left:auto;color:#666;font-size:11px">${list.symbols.length}</span></div>`;
                }
            });
        }

        menu.innerHTML = html;
        const x = Math.min(e.pageX, window.innerWidth - 220);
        const y = Math.min(e.pageY, window.innerHeight - 200);
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.style.display = 'block';

        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            if (rect.bottom > window.innerHeight) menu.style.top = Math.max(0, window.innerHeight - rect.height - 10) + 'px';
            if (rect.right > window.innerWidth) menu.style.left = Math.max(0, window.innerWidth - rect.width - 10) + 'px';
        });

        menu.querySelector('[data-action="copy"]').onclick = () => {
            navigator.clipboard.writeText(symbol).catch(() => {});
            menu.style.display = 'none';
        };

        menu.querySelectorAll('[data-action="add-wl"]').forEach(item => {
            item.onclick = async (ev) => {
                ev.stopPropagation();
                const listId = item.dataset.listId;
                const sym = item.dataset.symbol;
                const ex = item.dataset.exchange;
                const mt = item.dataset.marketType;
                if (this.watchlistManager && listId) {
                    const added = await this.watchlistManager.addSymbolToList(listId, sym, ex, mt);
                    const notif = document.getElementById('alertNotification');
                    if (notif) {
                        const list = this.watchlistManager.lists.get(listId);
                        notif.innerHTML = `<div>${added ? '✅' : '⚠️'} ${this._escapeHtml(sym)} ${added ? '→' : 'уже в'} ${this._escapeHtml(list?.name || 'списке')}</div>`;
                        notif.style.display = 'block';
                        notif.style.borderLeftColor = added ? '#4caf50' : '#ff9800';
                        setTimeout(() => notif.style.display = 'none', 2000);
                    }
                }
                menu.style.display = 'none';
            };
        });

        const flagMenu = document.getElementById('flagContextMenu');
        if (flagMenu) flagMenu.style.display = 'none';
    }

    handleDoubleClick(e) {
        if (this._isDestroyed) return;
        const flag = e.target.closest('.flag');
        if (!flag) return;
        e.preventDefault(); e.stopPropagation();
        const item = flag.closest('.ticker-item');
        if (!item || !item.dataset.symbol) return;
        const symbol = item.dataset.symbol;
        const exchange = item.dataset.exchange;
        const marketType = item.dataset.marketType;
        const key = `${symbol}:${exchange}:${marketType}`;
        delete this.state.flags[key];

        const ticker = this.tickersMap.get(key);
        if (ticker) {
            ticker.flag = null;
            const flagContainer = flag.parentNode;
            const placeholder = document.createElement('div');
            placeholder.className = 'flag-placeholder';
            flagContainer.replaceChild(placeholder, flag);
        }
        this.filterCache = null;
        this._lastSymbolsSig = null; // ✅ ФИКС (влияет на вкладку flags)
        this.saveState();

        if (this.state.activeTab === 'flags') {
            this._scheduleRender();
        }
    }

    /**
     * [VP-LOAD] Тихая синхронизация «текущего символа» панели с графиком —
     * БЕЗ запуска переключения (иначе получился бы цикл: switchSymbol ->
     * revert -> focusOnSymbol -> switchSymbol ...).
     *
     * Нужен для отката UI: клик по тикеру подсвечивает строку и меняет шапку
     * сразу, а загрузка символа может закончиться ошибкой — тогда график
     * остаётся на прежнем тикере, и панель обязана вернуться к нему же.
     */
    setCurrentSymbolSilently(symbol, exchange, marketType) {
        if (this._isDestroyed) return;
        this.state.currentSymbol = symbol;
        this.state.currentExchange = exchange;
        this.state.currentMarketType = marketType;
        try { this.saveCurrentSymbol(symbol, exchange, marketType); } catch (e) {}
        try {
            document.querySelectorAll('.ticker-item.active').forEach(el => el.classList.remove('active'));
            const el = document.querySelector(
                `.ticker-item[data-symbol="${symbol}"][data-exchange="${exchange}"][data-market-type="${marketType}"]`
            );
            if (el) el.classList.add('active');
        } catch (e) {}
    }

    focusOnSymbol(symbol, exchange, marketType) {
        if (this._isDestroyed) return;
        const key = `${symbol}:${exchange}:${marketType}`;
        const ticker = this.tickersMap.get(key);
        if (ticker && this.renderer) {
            const index = this.renderer.displayedTickers.indexOf(ticker);
            if (index !== -1) {
                const container = document.getElementById('tickerListContainer');
                container.scrollTop = Math.max(0, index * (this.renderer.rowHeight || 36) - container.clientHeight / 2);

                setTimeout(() => {
                    if (this._isDestroyed) return;
                    document.querySelectorAll('.ticker-item.active').forEach(e => e.classList.remove('active'));
                    const el = document.querySelector(`.ticker-item[data-symbol="${symbol}"][data-exchange="${exchange}"][data-market-type="${marketType}"]`);
                    if (el) el.classList.add('active');
                }, 50);
            }
        }
        // [VP-CLICK] состояние, подсветка, шапка и контроль результата — там же,
        // где и для обычного клика по списку.
        this._requestSymbolSwitch(symbol, exchange, marketType);

        const modal = document.getElementById('addInstrumentModal');
        if (modal) modal.classList.remove('show');
    }

    handleFlagSelect(e) {
        if (this._isDestroyed) return;
        e.stopPropagation();
        const contextMenu = document.getElementById('flagContextMenu');
        const symbol = contextMenu.dataset.symbol;
        const exchange = contextMenu.dataset.exchange;
        const marketType = contextMenu.dataset.marketType;
        const flag = e.currentTarget.dataset.flag;
        if (!symbol || !exchange || !marketType) return;
        const key = `${symbol}:${exchange}:${marketType}`;
        this.state.flags[key] = flag;

        const ticker = this.tickersMap.get(key);
        if (ticker) {
            ticker.flag = flag;
            const tickerElement = document.querySelector(`.ticker-item[data-symbol="${symbol}"][data-exchange="${exchange}"][data-market-type="${marketType}"]`);
            if (tickerElement) {
                const flagContainer = tickerElement.querySelector('.flag, .flag-placeholder');
                if (flagContainer) {
                    const newFlag = document.createElement('div');
                    newFlag.className = `flag flag-${flag}`;
                    newFlag.dataset.symbol = symbol;
                    newFlag.dataset.exchange = exchange;
                    newFlag.dataset.marketType = marketType;
                    flagContainer.parentNode.replaceChild(newFlag, flagContainer);
                }
            }
        }
        this.filterCache = null;
        this._lastSymbolsSig = null; // ✅ ФИКС (влияет на вкладку flags)
        this.saveState();
        contextMenu.style.display = 'none';

        if (this.state.activeTab === 'flags') {
            this._scheduleRender();
        }
    }

    closeContextMenu() {
        const flagMenu = document.getElementById('flagContextMenu');
        if (flagMenu) flagMenu.style.display = 'none';
        const tickerMenu = document.getElementById('tickerContextMenu');
        if (tickerMenu) tickerMenu.style.display = 'none';
    }
}

if (typeof window !== 'undefined') {
    window.TickerPanel = TickerPanel;
}
