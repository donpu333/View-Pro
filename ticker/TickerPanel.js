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
        
        // Пробрасываем ссылки
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
        this.formatCache = this.storage.formatCache;
        this.cacheMaxAge = this.storage.cacheMaxAge;
        this.settings = this.storage.settings;
        this.debugMode = this.storage.debugMode;
        this.filterCache = this.storage.filterCache;
        this.saveTimeout = this.storage.saveTimeout;
        this._isRefreshing = this.storage._isRefreshing;
        this._eventsInitialized = this.storage._eventsInitialized;
        
 // ✅✅✅ ДОБАВЬ ЭТИ 2 СТРОКИ ✅✅✅
    this._isBulkAdding = false;          // Флаг: идёт массовое добавление?
    this._suppressWatchlistLoad = false;  // Флаг: блокировать загрузку Watchlist?
    


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
        this._blockDOMUpdates = true; // Блокируем обновление DOM до конца первой отрисовки
        
        // Пробрасываем методы
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
        this.startCacheCleanup = this.renderer.startCacheCleanup.bind(this.renderer);
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
        
        this.loadFromLocalStorage();
        window.tickerPanelInstance = this;
        // Восстанавливаем сохранённую сортировку
const savedSortBy = localStorage.getItem('tickerSortBy');
const savedSortDir = localStorage.getItem('tickerSortDir');
this.state.sortBy = savedSortBy || 'volume';
this.state.sortDirection = savedSortDir || 'desc';

this.init();
      }  
    
   async init() {
    console.log('📋 TickerPanel: быстрая инициализация');
    document.getElementById('tickerLoader').style.display = 'block';
    
    this.setupFilters();
    this.setupFlagContextMenu();
    this.setupUIEventListeners();
    this.setupClearAllButton();
    this.setupHeaderSorting();
    this.setupModal();

    document.addEventListener('contextmenu', (e) => {
        let target = e.target;
        if (target && target.nodeType === 3) target = target.parentElement;
        const tickerItem = target.closest('.ticker-item');
        if (tickerItem) { e.preventDefault(); this.handleContextMenu(e); }
    });
    
    document.addEventListener('click', (e) => {
        const tickerMenu = document.getElementById('tickerContextMenu');
        if (tickerMenu && tickerMenu.style.display === 'block' && !tickerMenu.contains(e.target)) {
            tickerMenu.style.display = 'none';
        }
    });

    if (this.watchlistManager) this.watchlistManager.createDropdownContainer();

    setTimeout(async () => {
        // ============================================
        // ✅✅✅ ЖДЁМ ЗАГРУЗКИ WATCHLIST ИЗ DB! ✅✅✅
        // ============================================
        console.log('⏳ Ожидание загрузки Watchlist...');
        
        if (this.watchlistManager) {
            await this.watchlistManager._initPromise; // ← ДОЖДАЁМСЯ!
            console.log('✅ Watchlist загружен, customSymbols:', this.state.customSymbols?.length);
        }
        
        await this.loadUserData();
        
        if (this.watchlistManager) {
            // ✅ Синхронизируем activeList с панелью
            this.watchlistManager.syncActiveListFromPanel();
        }
        
        this.initializeDataParallel();
        this.startCacheCleanup();
        this.updateModalWithData?.();
        
        if (this.watchlistManager) await this.watchlistManager.initializeWithPriority();

        // Обновляем кэш раз в 4 часа
        this._cacheRefreshInterval = setInterval(() => {
            this.refreshSymbolCache(10000).catch(err => console.warn('⚠️ Фон. обновление кэша:', err));
        }, 4 * 60 * 60 * 1000);
    }, 100);
}
    async initializeDataParallel() {
        const container = document.getElementById('tickerListContainer');
        const loaded = await this.loadFromIndexedDB();
        
        if (loaded) {
            this.addInitialSymbols(); 
            this.updateModalCount();
            setTimeout(() => this.refreshSymbolCache(10000).catch(err => console.warn('⚠️ Фон. обновление:', err)), 1000);
            return;
        }
        
        if (container) container.innerHTML = '';
        
        const controllers = [];
        const fetchWithTimeout = (url, timeout) => {
            const controller = new AbortController();
            controllers.push(controller);
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeoutId));
        };
        
        const urls = [
            'https://fapi.binance.com/fapi/v1/exchangeInfo',
            'https://api.binance.com/api/v3/exchangeInfo',
            'https://api.bybit.com/v5/market/instruments-info?category=linear',
            'https://api.bybit.com/v5/market/instruments-info?category=spot'
        ];
        
        try {
            const allResults = await Promise.allSettled(urls.map(url => fetchWithTimeout(url, 5000).then(r => r.json()).catch(() => null)));
            const finalResults = allResults.map(r => r.status === 'fulfilled' ? r.value : null);
            this.processParallelData(finalResults, false);
            this.addInitialSymbols();
            await this.saveSymbolsToIndexedDB();
            if (container) container.innerHTML = '';
        } catch (error) {
            console.error('❌ Ошибка загрузки данных:', error);
            if (container) container.innerHTML = '';
        } finally {
            controllers.forEach(c => c.abort());
        }
    }
    
    async refreshSymbolCache(timeout = 10000) {
        if (this._isRefreshing) return;
        this._isRefreshing = true;
        const controllers = [];
        const fetchWithTimeout = (url, timeout) => {
            const controller = new AbortController();
            controllers.push(controller);
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeoutId));
        };
        const urls = [
            'https://fapi.binance.com/fapi/v1/exchangeInfo',
            'https://api.binance.com/api/v3/exchangeInfo',
            'https://api.bybit.com/v5/market/instruments-info?category=linear',
            'https://api.bybit.com/v5/market/instruments-info?category=spot'
        ];
        try {
            const results = await Promise.allSettled(urls.map(url => fetchWithTimeout(url, timeout).then(r => r.json()).catch(e => null)));
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
    
_onPriceUpdate(symbol, price, exchange, marketType, extra = {}) {
    const compositeKey = `${symbol}:${exchange}:${marketType}`;
    const ticker = this.tickersMap.get(compositeKey);
    if (!ticker) return;

    let updated = false;

    // Цена
    if (ticker.price !== price) {
        ticker.prevPrice = ticker.price;
        ticker.price = price;
        updated = true;
    }

    // ✅ Процент изменения (берём из extra, не пересчитываем)
    if (extra.change !== undefined && ticker.change !== extra.change) {
        ticker.change = extra.change;
        updated = true;
    }

    // ✅ Объём
    if (extra.volume !== undefined && ticker.volume !== extra.volume) {
        ticker.volume = extra.volume;
        updated = true;
    }

    // ✅ Сделки
    if (extra.trades !== undefined && ticker.trades !== extra.trades) {
        ticker.trades = extra.trades;
        updated = true;
    }

    if (updated && !this._blockDOMUpdates) {
        this.updatePriceElements();
    }
}
   processParallelData(results, updateOnly = false) {
    const MAX_SYMBOLS = 4000;
    let binanceFuturesList = [], binanceSpotList = [], bybitFuturesList = [], bybitSpotList = [];
    
    // Парсим Binance Futures
    if (results[0]?.symbols) {
        binanceFuturesList = results[0].symbols
            .filter(s => s.symbol?.endsWith('USDT') && s.status === 'TRADING')
            .map(s => ({ 
                symbol: s.symbol, 
                exchange: 'binance', 
                marketType: 'futures' 
            }));
    }
    
    // Парсим Binance Spot
    if (results[1]?.symbols) {
        binanceSpotList = results[1].symbols
            .filter(s => s.symbol?.endsWith('USDT') && s.status === 'TRADING')
            .map(s => ({ 
                symbol: s.symbol, 
                exchange: 'binance', 
                marketType: 'spot' 
            }));
    }
    
    // Парсим Bybit Futures
    if (results[2]?.retCode === 0 && results[2]?.result?.list) {
        bybitFuturesList = results[2].result.list
            .filter(s => s.symbol?.endsWith('USDT'))
            .map(s => ({ 
                symbol: s.symbol, 
                exchange: 'bybit', 
                marketType: 'futures' 
            }));
    }
    
    // Парсим Bybit Spot
    if (results[3]?.retCode === 0 && results[3]?.result?.list) {
        bybitSpotList = results[3].result.list
            .filter(s => s.symbol?.endsWith('USDT'))
            .map(s => ({ 
                symbol: s.symbol, 
                exchange: 'bybit', 
                marketType: 'spot' 
            }));
    }
    
    // ✅ ИСПРАВЛЕНИЕ №2: Объединяем кэши по биржам
    this.binanceSymbolsCache = [...binanceFuturesList, ...binanceSpotList];
    this.bybitSymbolsCache = [...bybitFuturesList, ...bybitSpotList];
    
    // ✅ ИСПРАВЛЕНИЕ №3: Умная дедупликация по СОСТАВНОМУ КЛЮЧУ!
    // Раньше: removeDuplicates(arr, 'symbol') — убивало BTCUSDT если был и в futures и в spot
    // Теперь: уникальность = symbol + exchange + marketType
    
    this.binanceSymbolsCache = this._deduplicateSymbols(this.binanceSymbolsCache);
    this.bybitSymbolsCache = this._deduplicateSymbols(this.bybitSymbolsCache);
    
    // Сортировка по популярности
    this.binanceSymbolsCache = this.sortByPopularity(this.binanceSymbolsCache);
    this.bybitSymbolsCache = this.sortByPopularity(this.bybitSymbolsCache);
    
    // Разделяем по типам для модалки
    this.allBinanceFutures = this.binanceSymbolsCache
        .filter(s => s.marketType === 'futures')
        .slice(0, MAX_SYMBOLS);
    
    this.allBinanceSpot = this.binanceSymbolsCache
        .filter(s => s.marketType === 'spot')
        .slice(0, MAX_SYMBOLS);
    
    this.allBybitFutures = this.bybitSymbolsCache
        .filter(s => s.marketType === 'futures')
        .slice(0, MAX_SYMBOLS);
    
    this.allBybitSpot = this.bybitSymbolsCache
        .filter(s => s.marketType === 'spot')
        .slice(0, MAX_SYMBOLS);
    
    // Общий кэш
    this.allSymbolsCache = [...this.binanceSymbolsCache, ...this.bybitSymbolsCache];
    
    // Обновляем счётчик в модалке
    this.updateModalCount();
}

// ✅ НОВЫЙ метод — умная дедупликация по составному ключу
_deduplicateSymbols(symbols) {
    const seen = new Set();
    return symbols.filter(item => {
        if (!item || !item.symbol) return false;
        
        // Составной ключ: SYMBOL:EXCHANGE:MARKET_TYPE
        const key = `${item.symbol}:${item.exchange}:${item.marketType}`;
        
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

addInitialSymbols() {
    const savedSymbols = this.state.customSymbols;
    savedSymbols.forEach(symbolKey => {
        const parts = symbolKey.split(':');
        if (parts.length === 3) this.addSymbol(parts[0], true, parts[1], parts[2], false, false, true);
    });
    
    this.updateModalCount();
    
    // ✅ ИНВАЛИДИРУЕМ КЭШ ПЕРЕД ПЕРВЫМ РЕНДЕРОМ!
    // (чтобы не использовать старый кэш с volume=0)
    this.filterCache = null;
    
    // СНАЧАЛА РЕНДЕР (цены будут 0.00, но структура создана)
    this.renderTickerList();
    
    requestAnimationFrame(() => {
        const container = document.getElementById('tickerListContainer');
        const loader = document.getElementById('tickerLoader');
        if (container) container.classList.add('ready');
        if (loader) loader.style.display = 'none';
        
        // Разблокировка
        this._blockDOMUpdates = false;
        
        // Запускаем движок цен
        this.startTickerPanelPriceEngine();
        
        this.setupDelegatedEvents();
        
        // ✅✅✅ ПЕРЕРИСОВКА ПОСЛЕ ЗАГРУЗКИ РЕАЛЬНЫХ ДАННЫХ!
        // Увеличен timeout до 3000мс — чтобы успели прийти 49 REST-запросов
        setTimeout(() => {
            console.log('🔄 Финальная пересортировка после загрузки цен...');
            
            if (this.renderer) {
                // ✅ СБРАСЫВАЕМ КЭШ (он мог создаться когда volumes были = 0!)
                this.filterCache = null;
                
                // Обновляем цены в DOM
                this.renderer.updatePriceElements?.();
                
                // ✅ ПЕРЕСОРТИРОВКА С РЕАЛЬНЫМИ ОБЪЁМАМИ!
                this.renderTickerList();
                
                console.log(`✅ Пересортировано: ${this.displayedTickers?.length} тикеров`);
                
                // Диагностика (можно убрать в проде):
                if (this.displayedTickers?.length > 0) {
                    console.log('🏆 Топ-3 по объёму:', 
                        this.displayedTickers.slice(0, 3).map(t => 
                            `${t.symbol}: $${(t.volume / 1e9).toFixed(2)}B`
                        )
                    );
                }
            }
        }, 3000);  // ← УВЕЛИЧЕНО С 1500 ДО 3000 МС!
    });
}
startTickerPanelPriceEngine() {
    if (this._priceEngineStarted) return;
    this._priceEngineStarted = true;
    console.log('🚀 TickerPriceEngine: Запуск...');
    
    this._wsConnections = {};
    this._restQueue = [];           
    this._isRestRunning = false;    

  this._safeFetch = async (url, retries = 3) => {
    // ✅ Ждём ChartManager, но не больше 5 секунд
    let waited = 0;
    while (ChartManager._fetchInProgress && waited < 50) {
        await new Promise(r => setTimeout(r, 100));
        waited++;
    }
    
    for (let i = 0; i < retries; i++) {
        try {
            if (i > 0) await new Promise(r => setTimeout(r, Math.min(5000 * i, 20000)));
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (response.status === 418 || response.status === 429) continue;
            if (!response.ok) return null;
            return await response.json();
        } catch (e) {
            if (e.name !== 'AbortError') continue;
        }
    }
    return null;
};

    this._processRestQueue = async () => {
        // ✅ Ждём fetchBatchSnapshots
        while (TickerPanel._fetchBatchInProgress) {
            await new Promise(r => setTimeout(r, 100));
        }
        
        if (this._isRestRunning) return;
        this._isRestRunning = true;
        TickerPanel._restInProgress = true;
        
        let count = 0;
        try {
            while (this._restQueue.length > 0) {
                const task = this._restQueue.shift();
                count++;
                await task();
                await new Promise(r => setTimeout(r, 1000));
            }
        } finally {
            this._isRestRunning = false;
            TickerPanel._restInProgress = false;
        }
        
        console.log(`✅ REST завершён (${count} запросов)`);
        
        if (!this._blockDOMUpdates) {
            this.renderTickerList();
            this.updatePriceElements?.();
        }
    };

   const loadAllData = async () => {
    if (this.tickersMap.size === 0) return;

    const groups = { bnFut: [], bnSpot: [], byFut: [], bySpot: [] };
    for (const [k, t] of this.tickersMap.entries()) {
        if (t.exchange === 'binance' && t.marketType === 'futures') groups.bnFut.push(t.symbol);
        if (t.exchange === 'binance' && t.marketType === 'spot') groups.bnSpot.push(t.symbol);
        if (t.exchange === 'bybit' && t.marketType === 'futures') groups.byFut.push(t.symbol);
        if (t.exchange === 'bybit' && t.marketType === 'spot') groups.bySpot.push(t.symbol);
    }

    // ✅ ИСПРАВЛЕНИЕ: Увеличиваем до безопасного лимита (не 100, а 80 для запаса)
    const BINANCE_BATCH_SIZE = 80;  // Было 12!!!
    
    this._restQueue = [];

    // Binance Futures - оптимизированный
    for (let i = 0; i < groups.bnFut.length; i += BINANCE_BATCH_SIZE) {
        const batch = groups.bnFut.slice(i, i + BINANCE_BATCH_SIZE);
        const symbolsParam = batch.map(s => `"${s}"`).join(',');
        
        this._restQueue.push(async () => {
            const data = await this._safeFetch(
                `https://fapi.binance.com/fapi/v1/ticker/24hr?symbols=[${symbolsParam}]`
            );
            if (Array.isArray(data)) data.forEach(t => { 
                const tk = this.tickersMap.get(`${t.symbol}:binance:futures`);
                if (tk) { 
                    const np = parseFloat(t.lastPrice)||0;
                    if (tk.price !== np && tk.price !== 0) tk.prevPrice = tk.price;
                    tk.price = np; 
                    tk.change = parseFloat(t.priceChangePercent)||0; 
                    tk.volume = parseFloat(t.quoteVolume)||0; 
                    tk.trades = parseInt(t.count)||0; 
                } 
            });
            this.renderer?.updatePriceElements?.();
        });
    }

    // Binance Spot - оптимизированный
    for (let i = 0; i < groups.bnSpot.length; i += BINANCE_BATCH_SIZE) {
        const batch = groups.bnSpot.slice(i, i + BINANCE_BATCH_SIZE);
        const symbolsParam = batch.map(s => `"${s}"`).join(',');
        
        this._restQueue.push(async () => {
            const data = await this._safeFetch(
                `https://api.binance.com/api/v3/ticker/24hr?symbols=[${symbolsParam}]`
            );
            if (Array.isArray(data)) data.forEach(t => { 
                const tk = this.tickersMap.get(`${t.symbol}:binance:spot`);
                if (tk) { 
                    const np = parseFloat(t.lastPrice)||0;
                    if (tk.price !== np && tk.price !== 0) tk.prevPrice = tk.price;
                    tk.price = np; 
                    tk.change = parseFloat(t.priceChangePercent)||0; 
                    tk.volume = parseFloat(t.quoteVolume)||0; 
                    tk.trades = parseInt(t.count)||0; 
                } 
            });
            this.renderer?.updatePriceElements?.();
        });
    }

    
        // Bybit Futures
        if (groups.byFut.length > 0) {
            this._restQueue.push(async () => {
                const data = await this._safeFetch(
                    'https://api.bybit.com/v5/market/tickers?category=linear'
                );
                if (data?.retCode === 0 && data.result?.list) { 
                    const set = new Set(groups.byFut);
                    data.result.list.forEach(t => { 
                        if (set.has(t.symbol)) { 
                            const tk = this.tickersMap.get(`${t.symbol}:bybit:futures`);
                            if (tk) { 
                                const np = parseFloat(t.lastPrice)||0;
                                if (tk.price !== np && tk.price !== 0) tk.prevPrice = tk.price;
                                tk.price = np; 
                                tk.change = (parseFloat(t.price24hPcnt)||0)*100; 
                                tk.volume = (parseFloat(t.volume24h)||0)*(parseFloat(t.lastPrice)||0); 
                            } 
                        } 
                    });
                }
                this.renderer?.updatePriceElements?.();
            });
        }

        // Bybit Spot
        if (groups.bySpot.length > 0) {
            this._restQueue.push(async () => {
                const data = await this._safeFetch(
                    'https://api.bybit.com/v5/market/tickers?category=spot'
                );
                if (data?.retCode === 0 && data.result?.list) { 
                    const set = new Set(groups.bySpot);
                    data.result.list.forEach(t => { 
                        if (set.has(t.symbol)) { 
                            const tk = this.tickersMap.get(`${t.symbol}:bybit:spot`);
                            if (tk) { 
                                const np = parseFloat(t.lastPrice)||0;
                                if (tk.price !== np && tk.price !== 0) tk.prevPrice = tk.price;
                                tk.price = np; 
                                tk.change = (parseFloat(t.price24hPcnt)||0)*100; 
                                tk.volume = (parseFloat(t.volume24h)||0)*(parseFloat(t.lastPrice)||0); 
                            } 
                        } 
                    });
                }
                this.renderer?.updatePriceElements?.();
            });
        }

        await this._processRestQueue();
        
        console.log(`💰 Загружено ${this.tickersMap.size} тикеров с ценами!`);
        
        if (!this._blockDOMUpdates) {
            this.renderTickerList();
            this.updateModalCount?.();
        }
    };

    // ============================================
    // WEBSOCKET — без изменений
    // ============================================
 const connectBinanceWs = (id, url, marketType) => {
    if (this._wsConnections[id]) return;
    var ws = new WebSocket(url);
    this._wsConnections[id] = ws;
    
    ws.onopen = function() { 
        console.log('%c✅ [WS] ' + id, 'color:#4caf50;font-weight:bold;'); 
    };
    
    ws.onmessage = (event) => {
        try {
            var tickers = JSON.parse(event.data);
            if (!Array.isArray(tickers)) return;
            var now = Date.now();
            
            for (var i = 0; i < tickers.length; i++) {
                var t = tickers[i];
                if (!t.s || !t.c) continue;
                var key = t.s + ':binance:' + marketType;
                var tk = this.tickersMap.get(key);
                
                if (tk) {
                    var newPrice = parseFloat(t.c);
                    var oldPrice = tk.price;
                    
                    // ✅ ВСЕГДА ОБНОВЛЯЕМ ЦЕНУ
                    tk.prevPrice = oldPrice || newPrice;
                    tk.price = newPrice;
                    
                    // ✅ ВСЕГДА УСТАНАВЛИВАЕМ ФЛАГИ МЕРЦАНИЯ
                    tk._flashDir = (oldPrice !== undefined && newPrice > oldPrice) ? 'up' : 'down';
                    tk._flashTime = now;
                    
                    // ✅ ОБНОВЛЯЕМ 24h ДАННЫЕ
                    if (t.P !== undefined) tk.change = parseFloat(t.P);
                    if (t.q !== undefined) tk.volume = parseFloat(t.q);
                    if (t.n !== undefined) tk.trades = parseInt(t.n);
                }
            }
            
            if (!this._blockDOMUpdates) {
                this.renderer.updatePriceElements();
                this._flashUpdatedRows(now);
            }
        } catch(e) {}
    };
    
    ws.onclose = function() { 
        if (this._wsConnections) this._wsConnections[id] = null;
        setTimeout(function() { connectBinanceWs(id, url, marketType); }, 5000); 
    };
    
    ws.onerror = function() { ws.close(); };
};
 const connectBybitWs = (id, url, marketType) => {
    if (this._wsConnections[id]) return;
    var ws = new WebSocket(url);
    this._wsConnections[id] = ws;
    
    ws.onopen = function() {
        console.log('%c✅ [WS] ' + id, 'color:#F7A600;font-weight:bold;');
        var topic = marketType === 'futures' ? 'tickers.linear' : 'tickers.spot';
        ws.send(JSON.stringify({ op: "subscribe", args: [topic] }));
    };
    
    ws.onmessage = (event) => {
        try {
            var msg = JSON.parse(event.data);
            var data = msg.data;
            if (!data || !data.topic || !data.topic.startsWith('tickers.')) return;
            var d = data.data;
            if (!d) return;
            
            var symbol = d.s || d.symbol;
            var newPrice = parseFloat(d.lastPrice || d.c || d.p);
            if (!symbol || isNaN(newPrice)) return;
            
            var mt = data.topic.includes('linear') ? 'futures' : 'spot';
            var key = symbol + ':bybit:' + mt;
            var tk = this.tickersMap.get(key);
            
            if (tk) {
                var now = Date.now();
                var oldPrice = tk.price;
                
                // ✅ ВСЕГДА ОБНОВЛЯЕМ ЦЕНУ
                tk.prevPrice = oldPrice || newPrice;
                tk.price = newPrice;
                
                // ✅ ВСЕГДА УСТАНАВЛИВАЕМ ФЛАГИ МЕРЦАНИЯ
                if (oldPrice !== undefined && oldPrice !== newPrice) {
                    tk._flashDir = newPrice > oldPrice ? 'up' : 'down';
                } else {
                    tk._flashDir = oldPrice === undefined ? 'up' : (tk._flashDir || 'up');
                }
                tk._flashTime = now;
                
                // ✅ 24h ДАННЫЕ ДЛЯ BYBIT
                if (d.price24hPcnt !== undefined) tk.change = parseFloat(d.price24hPcnt) * 100;
                if (d.volume24h !== undefined) tk.volume = parseFloat(d.volume24h);
                
                if (!this._blockDOMUpdates) {
                    this.renderer.updatePriceElements();
                    this._flashUpdatedRows(now);
                }
            }
        } catch(e) {}
    };
    
    ws.onclose = () => { 
        if (this._wsConnections) this._wsConnections[id] = null;
        setTimeout(() => { connectBybitWs(id, url, marketType); }, 5000); 
    };
    
    ws.onerror = function() { ws.close(); };
};

  connectBinanceWs('bn-fut', 'wss://fstream.binance.com/market/ws/!miniTicker@arr', 'futures');
connectBinanceWs('bn-spot', 'wss://stream.binance.com/market/ws/!miniTicker@arr', 'spot');
    connectBybitWs('by-fut', 'wss://stream.bybit.com/v5/public/linear', 'futures');
    connectBybitWs('by-spot', 'wss://stream.bybit.com/v5/public/spot', 'spot');


}
// ============================================
// ✅ АНИМАЦИЯ
// ============================================
_flashUpdatedRows(flashTime) {
    var container = document.getElementById('tickerListContainer');
    if (!container) return;
    
    var now = Date.now();
    
    for (var key of this.tickersMap.keys()) {
        var ticker = this.tickersMap.get(key);
        
        // ✅ Проверяем, что флаг установлен и не старше 500 мс
        if (ticker && ticker._flashTime && (now - ticker._flashTime) < 500) {
            var row = container.querySelector(
                '.ticker-item[data-symbol="' + ticker.symbol + '"][data-exchange="' + ticker.exchange + '"][data-market-type="' + ticker.marketType + '"]'
            );
            
            if (row) {
                row.classList.remove('price-flash-up', 'price-flash-down');
                void row.offsetWidth;
                row.classList.add(ticker._flashDir === 'up' ? 'price-flash-up' : 'price-flash-down');
                
                setTimeout(function() {
                    if (row) {
                        row.classList.remove('price-flash-up', 'price-flash-down');
                    }
                }, 400);
            }
            
            // ❌ НЕ УДАЛЯЕМ — пусть живут, но проверяем по времени
            // delete ticker._flashTime;
            // delete ticker._flashDir;
        }
    }
}

clearAllSymbols() {
    console.log('🗑️ Начало очистки всех символов...');
    
    // 1. Очищаем основные массивы и Map'ы
    this.tickers = []; 
    this.tickersMap.clear(); 
    this.state.customSymbols = []; 
    this.state.favorites = []; 
    this.state.flags = {};
    
    // 2. Очищаем элементы рендерера
    this.tickerElements.clear();
    
    // 3. Сбрасываем состояние рендерера (ВАЖНО!)
    if (this.renderer) {
        // Сбрасываем внутренние свойства рендерера
        this.renderer._displayedTickers = [];
        this.renderer._totalItems = 0;
        
        // Очищаем кэш отфильтрованных результатов
        this.renderer._filteredTickersCache = null;
    }
    
    // 4. Сбрасываем все кэши
    this.filterCache = null; 
    this.formatCache = { 
        prices: new Map(), 
        volumes: new Map(), 
        changes: new Map() 
    };
    
    // 5. Очищаем DOM
    const container = document.getElementById('tickerListContainer');
    if (container) { 
        container.innerHTML = ''; 
        container.style.height = 'auto'; 
        container.scrollTop = 0; 
        container.classList.remove('ready'); // Можно убрать класс ready
        
        // ✅ ГЛАВНОЕ: Перерисовываем пустой список
        requestAnimationFrame(() => {
            this.renderTickerList();
            
            // Возвращаем класс ready (если нужен для стилей)
            setTimeout(() => {
                if (container) container.classList.add('ready');
            }, 50);
        });
    }
    
    // 6. Очищаем вотчлист
    if (this.watchlistManager) {
        const list = this.watchlistManager.lists.get(this.watchlistManager.activeListId);
        if (list) {
            list.symbols = [];
            this.watchlistManager._saveNow(); 
            
            // Очищаем кэш рендеринга дропдауна
            this.watchlistManager.renderCache.delete(this.watchlistManager.activeListId);
        }
        
        // Обновляем счётчик кнопки
        const btnCount = document.querySelector('.wl-btn-count');
        if (btnCount) btnCount.textContent = '0';
        
        // Перерисовываем дропдаун
        this.watchlistManager.renderDropdown?.();
    }
    
    // 7. Сохраняем состояние
    this.saveState();
    
    // 8. Обновляем модалку (если открыта)
    this.updateModalCount?.();
    
    console.log('✅ Очистка завершена! Тикеров:', this.tickersMap.size);
}
syncWithActiveWatchlist() {
    if (!this.watchlistManager) return;
    const activeList = this.watchlistManager.lists.get(this.watchlistManager.activeListId);
    if (activeList) {
        // Только если есть расхождение
        if (JSON.stringify(this.state.customSymbols) !== JSON.stringify(activeList.symbols)) {
            this.state.customSymbols = [...activeList.symbols];
        }
    }
}
addSymbol(symbol, isCustom = true, exchange = 'binance', marketType = 'futures', render = true, skipInitialFetch = false, skipWatchlistSync = false) {
    symbol = symbol.trim().toUpperCase();
    if (!symbol.endsWith('USDT')) return false;
    const key = `${symbol}:${exchange}:${marketType}`;
    
    // Вотчлист
    if (isCustom && this.watchlistManager && !skipWatchlistSync) { 
        this.watchlistManager.addSymbolToActiveList(symbol, exchange, marketType); 
        this.watchlistManager.renderDropdown(); 
    }

    // Если уже есть в памяти – просто добавляем в рендер
    if (this.tickersMap.has(key)) {
        const existingTicker = this.tickersMap.get(key);
        if (!this.tickers.includes(existingTicker)) {
            this.tickers.push(existingTicker);
            this.filterCache = null;
            if (render) this.renderTickerList();
        }
        return true;
    }
    
    // Создаём новый тикер
    const newTicker = {
        symbol,
        price: 0,
        change: 0,
        volume: 0,
        trades: null,
        custom: true,
        prevPrice: 0,
        exchange,
        marketType,
        flag: this.state.flags[key] || null
    };
    
    this.tickers.push(newTicker);
    this.tickersMap.set(key, newTicker);
    
    if (!this.state.customSymbols.includes(key)) {
        this.state.customSymbols.push(key);
    }
    
    // Подписываемся на PriceManager (WebSocket)
    if (window.priceManagerInstance) {
        window.priceManagerInstance.subscribe(symbol, (price) => this._onPriceUpdate(symbol, price), exchange, marketType);
    }
    
    this.filterCache = null;
    if (render) this.renderTickerList();
    
    // ===================================================
    // ✅ ПРИНУДИТЕЛЬНАЯ ЗАГРУЗКА ЦЕНЫ (ДЛЯ ОДИНОЧНЫХ ДОБАВЛЕНИЙ)
    // ===================================================
    if (!skipInitialFetch && window.priceManagerInstance) {
        // 1. Пытаемся взять из кэша
        const cachedPrice = window.priceManagerInstance.getPrice(symbol, exchange, marketType);
        if (cachedPrice !== null && cachedPrice > 0) {
            this._onPriceUpdate(symbol, cachedPrice);
            this.updatePriceElements();
        } else {
            // 2. Если кэша нет – делаем REST-запрос (с задержкой)
            setTimeout(() => {
                window.priceManagerInstance.fetchPrice(symbol, exchange, marketType)
                    .then(price => {
                        if (price) {
                            this._onPriceUpdate(symbol, price);
                            this.updatePriceElements();
                        }
                    })
                    .catch(() => {});
            }, 300);
        }
        
        // 3. ГАРАНТИРОВАННОЕ ОБНОВЛЕНИЕ (как в addSymbolsBatch)
        if (typeof this.pollRestData === 'function') {
            setTimeout(() => this.pollRestData(), 600);
        }
    }
    
    return true;
}

async fetchBatchSnapshots(symbols) {
    if (!symbols || symbols.length === 0) return;
    
    // ✅ Ждём предыдущий вызов
    while (TickerPanel._fetchBatchInProgress) {
        await new Promise(r => setTimeout(r, 100));
    }
    TickerPanel._fetchBatchInProgress = true;
    
    try {
        const BATCH_SIZE = 25;
        const BATCH_DELAY = 800;
        
        const bnFutures = symbols.filter(s => s.exchange === 'binance' && s.marketType === 'futures');
        const bnSpot = symbols.filter(s => s.exchange === 'binance' && s.marketType === 'spot');
        const byFutures = symbols.filter(s => s.exchange === 'bybit' && s.marketType === 'futures');
        const bySpot = symbols.filter(s => s.exchange === 'bybit' && s.marketType === 'spot');
        
        const fetchBinanceBatched = async (symbolList, marketType) => {
            for (let i = 0; i < symbolList.length; i += BATCH_SIZE) {
                const batch = symbolList.slice(i, i + BATCH_SIZE);
                const symbolsParam = batch.map(s => `"${s.symbol}"`).join(',');
                
                try {
                    const url = marketType === 'futures'
                        ? `https://fapi.binance.com/fapi/v1/ticker/24hr?symbols=[${symbolsParam}]`
                        : `https://api.binance.com/api/v3/ticker/24hr?symbols=[${symbolsParam}]`;
                    
                    const response = await fetch(url);
                    const data = await response.json();
                    
                    if (Array.isArray(data)) {
                        data.forEach(t => {
                            this._updateTickerFromBinance(t, marketType);
                        });
                    }
                } catch (e) {}
                
                if (i + BATCH_SIZE < symbolList.length) {
                    await new Promise(r => setTimeout(r, BATCH_DELAY));
                }
            }
        };
        
        const fetchBybitBulk = async (symbolList, marketType) => {
            if (symbolList.length === 0) return;
            try {
                const category = marketType === 'futures' ? 'linear' : 'spot';
                const url = `https://api.bybit.com/v5/market/tickers?category=${category}`;
                const response = await fetch(url);
                const data = await response.json();
                
                if (data.retCode === 0 && data.result?.list) {
                    const symbolSet = new Set(symbolList.map(s => s.symbol));
                    data.result.list.forEach(t => {
                        if (symbolSet.has(t.symbol)) {
                            this._updateTickerFromBybit(t, marketType);
                        }
                    });
                }
            } catch (e) {}
        };
        
        await Promise.all([
            fetchBinanceBatched(bnFutures, 'futures'),
            fetchBinanceBatched(bnSpot, 'spot'),
            fetchBybitBulk(byFutures, 'futures'),
            fetchBybitBulk(bySpot, 'spot')
        ]);
        
        this.renderer?.updatePriceElements();
        
    } finally {
        TickerPanel._fetchBatchInProgress = false;
    }
}

// ✅ Вспомогательный метод (можно добавить если нет)
_updateTickerFromBinance(data, marketType) {
    const key = `${data.symbol}:binance:${marketType}`;
    const ticker = this.tickersMap.get(key);
    if (ticker) {
        ticker.price = parseFloat(data.lastPrice) || 0;
        ticker.change = parseFloat(data.priceChangePercent) || 0;
        ticker.volume = parseFloat(data.quoteVolume) || 0;
        ticker.trades = parseInt(data.count) || 0;
    }
}

_updateTickerFromBybit(data, marketType) {
    const key = `${data.symbol}:bybit:${marketType}`;
    const ticker = this.tickersMap.get(key);
    if (ticker) {
        ticker.price = parseFloat(data.lastPrice) || 0;
        ticker.change = parseFloat(data.price24hPcnt) * 100 || 0;
        ticker.volume = parseFloat(data.volume24h) * parseFloat(data.lastPrice) || 0;
    }
}
    async fetchInitialDataForSymbol(symbol, exchange, marketType) {
        try {
            const url = exchange === 'binance' 
                ? (marketType === 'futures' ? `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}` : `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`)
                : `https://api.bybit.com/v5/market/tickers?category=${marketType === 'futures' ? 'linear' : 'spot'}&symbol=${symbol}`;
            const response = await fetch(url);
            const data = await response.json();
            const ticker = this.tickersMap.get(`${symbol}:${exchange}:${marketType}`);
            if (!ticker) return;

            if (exchange === 'binance') {
                ticker.price = parseFloat(data.lastPrice); ticker.change = parseFloat(data.priceChangePercent); ticker.volume = parseFloat(data.quoteVolume); ticker.trades = parseInt(data.count);
            } else if (data.retCode === 0 && data.result?.list?.[0]) {
                const d = data.result.list[0]; ticker.price = parseFloat(d.lastPrice); ticker.change = parseFloat(d.price24hPcnt) * 100; ticker.volume = parseFloat(d.turnover24h) || parseFloat(d.volume24h) * parseFloat(d.lastPrice);
            }
            
            if (!this._blockDOMUpdates) this.updatePriceElements(); 
            
        } catch (error) { console.warn(`⚠️ Не удалось загрузить ${symbol}:`, error); }
    }

    async fetchBybitSnapshots() {
        try {
            const [futRes, spotRes] = await Promise.all([fetch('https://api.bybit.com/v5/market/tickers?category=linear'), fetch('https://api.bybit.com/v5/market/tickers?category=spot')]);
            const futData = await futRes.json(); const spotData = await spotRes.json();
            if (futData.retCode === 0) futData.result.list.forEach(t => { if(t.symbol?.endsWith('USDT')) { const tk=this.tickersMap.get(`${t.symbol}:bybit:futures`); if(tk){ tk.price=parseFloat(t.lastPrice); tk.change=parseFloat(t.price24hPcnt)*100; tk.volume=parseFloat(t.volume24h)*parseFloat(t.lastPrice); }}});
            if (spotData.retCode === 0) spotData.result.list.forEach(t => { if(t.symbol?.endsWith('USDT')) { const tk=this.tickersMap.get(`${t.symbol}:bybit:spot`); if(tk){ tk.price=parseFloat(t.lastPrice); tk.change=parseFloat(t.price24hPcnt)*100; tk.volume=parseFloat(t.volume24h); }}});
            this.renderer.updatePriceElements();
        } catch (error) { console.error('❌ Ошибка загрузки Bybit:', error); }
    }

    removeSymbol(symbol, exchange, marketType) {
        if (!symbol) return;
        const key = `${symbol}:${exchange}:${marketType}`;
        delete this.state.flags[key];
        this.tickers = this.tickers.filter(t => !(t.symbol === symbol && t.exchange === exchange && t.marketType === marketType));
        this.tickersMap.delete(key);
        this.state.customSymbols = this.state.customSymbols.filter(s => s !== key);
        this.state.favorites = this.state.favorites.filter(s => s !== key);
        if (this.watchlistManager) { this.watchlistManager.removeSymbolFromActiveList(symbol, exchange, marketType); this.watchlistManager.renderDropdown(); }
        this.saveState();
        if (this.state.currentSymbol === symbol && this.state.currentExchange === exchange && this.state.currentMarketType === marketType) { this.state.currentSymbol = ''; this.state.currentExchange = 'binance'; }
        this.filterCache = null;
        this.renderTickerList();
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
                notification.innerHTML = `<div class="alert-title">🗑️ Удален</div><div class="alert-price">${symbol}</div><div class="alert-repeat">${exchange} ${marketType}</div>`; 
                notification.style.display = 'block'; 
                notification.style.borderLeftColor = '#f23645'; 
                setTimeout(() => notification.style.display = 'none', 2000); 
            }
            this.removeSymbol(symbol, exchange, marketType);
        }
    }

  handleTickerClick(e) {
    const star = e.target.closest('.star');
    if (star) {
        e.preventDefault();
        e.stopPropagation();
        const symbol = star.dataset.symbol;
        if (!symbol) return;
        const index = this.state.favorites.indexOf(symbol);
        if (index === -1) {
            this.state.favorites.push(symbol);
            star.classList.add('favorite');
        } else {
            this.state.favorites.splice(index, 1);
            star.classList.remove('favorite');
        }
        this.saveState();
        this.filterCache = null;
        return;
    }
    
    const flag = e.target.closest('.flag');
    if (flag) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    
    const tickerItem = e.target.closest('.ticker-item');
    if (tickerItem && tickerItem.dataset.symbol) {
        const symbol = tickerItem.dataset.symbol;
        const exchange = tickerItem.dataset.exchange;
        const marketType = tickerItem.dataset.marketType;
        
        if (this.state.currentSymbol === symbol && 
            this.state.currentExchange === exchange && 
            this.state.currentMarketType === marketType) return;
        
        this.state.currentSymbol = symbol;
        this.state.currentExchange = exchange;
        this.state.currentMarketType = marketType;
        this.saveCurrentSymbol(symbol, exchange, marketType);
        
        // ✅ СНАЧАЛА подсветка
        document.querySelectorAll('.ticker-item.active').forEach(el => el.classList.remove('active'));
        tickerItem.classList.add('active');
        
        // ✅ ПОТОМ асинхронное переключение
        if (this.coordinator?.chartManager) {
            this.coordinator.chartManager.switchSymbol(symbol, exchange, marketType);
        }
        
        const pairDisplay = document.getElementById('pairDisplay');
        if (pairDisplay) pairDisplay.textContent = symbol;
        
        const exchangeDisplay = document.getElementById('exchangeDisplay');
        if (exchangeDisplay) exchangeDisplay.textContent = exchange === 'binance' ? 'Binance' : 'Bybit';
        
        const contractTypeDisplay = document.getElementById('contractTypeDisplay');
        if (contractTypeDisplay) contractTypeDisplay.textContent = marketType === 'futures' ? 'PERP' : 'SPOT';
    }
}
    handleStarClick(star) {
        const symbol = star.dataset.symbol; if (!symbol) return;
        const index = this.state.favorites.indexOf(symbol);
        if (index === -1) this.state.favorites.push(symbol); else this.state.favorites.splice(index, 1);
        this.filterCache = null; this.saveState(); star.classList.toggle('favorite', index === -1);
    }

  handleContextMenu(e) {
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
        
        // ✅ Подгоняем позицию флаг-меню
        requestAnimationFrame(() => {
            const rect = contextMenu.getBoundingClientRect();
            if (rect.bottom > window.innerHeight) {
                contextMenu.style.top = Math.max(0, window.innerHeight - rect.height - 10) + 'px';
            }
            if (rect.right > window.innerWidth) {
                contextMenu.style.left = Math.max(0, window.innerWidth - rect.width - 10) + 'px';
            }
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
        // ✅ Добавляем max-height через стили, если ещё не прописано в CSS
        menu.style.maxHeight = '350px';
        menu.style.overflowY = 'auto';
        document.body.appendChild(menu);
    }
    
    let html = `<div class="context-menu-item" data-action="copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>Копировать ${symbol}</div>`;
    
    if (this.watchlistManager && this.watchlistManager.lists) { 
        html += `<div class="context-menu-divider"></div><div class="context-menu-label">Добавить в вотчлист:</div>`; 
        this.watchlistManager.listOrder.forEach(listId => { 
            const list = this.watchlistManager.lists.get(listId); 
            if (list) { 
                html += `<div class="context-menu-item" data-action="add-wl" data-list-id="${listId}" data-symbol="${symbol}" data-exchange="${exchange}" data-market-type="${marketType}">${listId === this.watchlistManager.activeListId ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;color:#4caf50;"><path d="m17,15c-4.188,0-6.33,3.499-6.849,4.5.52,1.001,2.661,4.5,6.849,4.5s6.33-3.499,6.849-4.5c-.52-1.001-2.661-4.5-6.849-4.5Zm0,8c-3.302,0-5.033-2.288-5.717-3.5.685-1.212,2.415-3.5,5.717-3.5s5.033,2.288,5.717,3.5c-.685,1.212-2.415,3.5-5.717,3.5Zm-8-12.5h11v1h-11v-1Zm8,7c-1.103,0-2,.897-2,2s.897,2,2,2,2-.897,2-2-.897-2-2-2Zm0,3c-.551,0-1-.448-1-1s.449-1,1-1,1,.448,1,1-.449,1-1,1ZM6,5.5c0,.552-.448,1-1,1s-1-.448-1-1,.448-1,1-1,1,.448,1,1Zm0,5.5c0,.552-.448,1-1,1s-1-.448-1-1,.448-1,1-1,1,.448,1,1Zm14-5h-11v-1h11v1Zm-14,10.5c0,.552-.448,1-1,1s-1-.448-1-1,.448-1,1-1,1,.448,1,1ZM24,2.5v13.684c-.292-.327-.624-.66-1-.981V2.5c0-.827-.673-1.5-1.5-1.5H2.5c-.827,0-1.5.673-1.5,1.5v18.5h7.686c.161.279.377.624.653,1H0V2.5C0,1.122,1.122,0,2.5,0h19c1.378,0,2.5,1.122,2.5,2.5Z"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;opacity:0.5;"><path d="M17.5,24H6.5c-2.481,0-4.5-2.019-4.5-4.5V4.5C2,2.019,4.019,0,6.5,0h11c2.481,0,4.5,2.019,4.5,4.5v15c0,2.481-2.019,4.5-4.5,4.5ZM6.5,1c-1.93,0-3.5,1.57-3.5,3.5v15c0,1.93,1.57,3.5,3.5,3.5h11c1.93,0-3.5-1.57-3.5-3.5V4.5c0-1.93-1.57-3.5-3.5-3.5H6.5Zm11.5,4.5c0-.276-.224-.5-.5-.5h-6c-.276,0-.5,.224-.5,.5s.224,.5,.5,.5h6c.276,0,.5-.224,.5-.5Zm0,6c0-.276-.224-.5-.5-.5h-6c-.276,0-.5,.224-.5,.5s.224,.5,.5,.5h6c.276,0,.5-.224,.5-.5Zm0,6c0-.276-.224-.5-.5-.5h-6c-.276,0-.5,.224-.5,.5s.224,.5,.5,.5h6c.276,0,.5-.224,.5-.5ZM8.5,7h-2c-.276,0-.5-.224-.5-.5v-2c0-.276,.224-.5,.5-.5h2c.276,0,.5,.224,.5,.5v2c0,.276-.224,.5-.5,.5Zm-1.5-1h1v-1h-1v1Zm1.5,7h-2c-.276,0-.5-.224-.5-.5v-2c0-.276,.224-.5,.5-.5h2c.276,0,.5,.224,.5,.5v2c0,.276-.224,.5-.5,.5Zm-1.5-1h1v-1h-1v1Zm1.5,7h-2c-.276,0-.5-.224-.5-.5v-2c0-.276,.224-.5,.5-.5h2c.276,0,.5,.224,.5,.5v2c0,.276-.224,.5-.5,.5Zm-1.5-1h1v-1h-1v1Z"/></svg>'}${this.watchlistManager.escapeHtml(list.name)}<span style="margin-left:auto;color:#666;font-size:11px">${list.symbols.length}</span></div>`; 
            } 
        }); 
    }
    
    menu.innerHTML = html;
    const x = Math.min(e.pageX, window.innerWidth - 220);
    const y = Math.min(e.pageY, window.innerHeight - 200);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.display = 'block';
    
    // ✅ ИСПРАВЛЕНИЕ: Подгоняем меню, чтобы оно не вылезало за экран
    requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.bottom > window.innerHeight) {
            menu.style.top = Math.max(0, window.innerHeight - rect.height - 10) + 'px';
        }
        if (rect.right > window.innerWidth) {
            menu.style.left = Math.max(0, window.innerWidth - rect.width - 10) + 'px';
        }
    });
    
    menu.querySelector('[data-action="copy"]').onclick = () => {
        navigator.clipboard.writeText(symbol);
        menu.style.display = 'none';
    };
    
    menu.querySelectorAll('[data-action="add-wl"]').forEach(item => {
        item.onclick = async (ev) => {
            ev.stopPropagation();
            const listId = item.dataset.listId;
            const sym = item.dataset.symbol;
            const ex = item.dataset.exchange;
            const mt = item.dataset.marketType;
            if (this.watchlistManager) {
                const added = await this.watchlistManager.addSymbolToList(listId, sym, ex, mt);
                const notif = document.getElementById('alertNotification');
                if (notif) {
                    const list = this.watchlistManager.lists.get(listId);
                    notif.innerHTML = `<div>${added ? '✅' : '⚠️'} ${sym} ${added ? '→' : 'уже в'} ${list?.name || 'списке'}</div>`;
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
        const flag = e.target.closest('.flag'); if (!flag) return; e.stopPropagation();
        const item = flag.closest('.ticker-item'); if (!item || !item.dataset.symbol) return;
        const symbol = item.dataset.symbol; const exchange = item.dataset.exchange; const marketType = item.dataset.marketType; const key = `${symbol}:${exchange}:${marketType}`;
        delete this.state.flags[key]; const ticker = this.tickers.find(t => t.symbol === symbol && t.exchange === exchange && t.marketType === marketType);
        if (ticker) { ticker.flag = null; const flagContainer = flag.parentNode; const placeholder = document.createElement('div'); placeholder.className = 'flag-placeholder'; flagContainer.replaceChild(placeholder, flag); }
        this.filterCache = null; this.saveState();
    }

    focusOnSymbol(symbol, exchange, marketType) {
    this.state.currentSymbol = symbol;
    this.state.currentExchange = exchange;
    this.state.currentMarketType = marketType;
    this.saveCurrentSymbol(symbol, exchange, marketType);
    
    document.querySelectorAll('.ticker-item.active').forEach(el => el.classList.remove('active'));
    
    const key = `${symbol}:${exchange}:${marketType}`;
    const ticker = this.tickersMap.get(key);
    
    if (ticker && this.renderer) {
        const index = this.renderer.displayedTickers.indexOf(ticker);
        if (index !== -1) {
            const container = document.getElementById('tickerListContainer');
            container.scrollTop = Math.max(0, index * (this.renderer.rowHeight || 36) - container.clientHeight / 2);
            setTimeout(() => {
                this.renderer.renderVisibleTickers();
                const el = document.querySelector(`.ticker-item[data-symbol="${symbol}"][data-exchange="${exchange}"][data-market-type="${marketType}"]`);
                if (el) el.classList.add('active');
            }, 100);
        }
    }
    
    // ✅ ЕДИНСТВЕННОЕ ИЗМЕНЕНИЕ — эта строка:
    if (this.coordinator?.chartManager) {
        this.coordinator.chartManager.switchSymbol(symbol, exchange, marketType);
    }
    
    const pairDisplay = document.getElementById('pairDisplay');
    if (pairDisplay) pairDisplay.textContent = symbol;
    
    const exchangeDisplay = document.getElementById('exchangeDisplay');
    if (exchangeDisplay) exchangeDisplay.textContent = exchange === 'binance' ? 'Binance' : 'Bybit';
    
    const contractTypeDisplay = document.getElementById('contractTypeDisplay');
    if (contractTypeDisplay) contractTypeDisplay.textContent = marketType === 'futures' ? 'PERP' : 'SPOT';
    
    document.getElementById('addInstrumentModal').classList.remove('show');
}
    handleFlagSelect(e) {
        e.stopPropagation(); const contextMenu = document.getElementById('flagContextMenu'), symbol = contextMenu.dataset.symbol, exchange = contextMenu.dataset.exchange, marketType = contextMenu.dataset.marketType, flag = e.currentTarget.dataset.flag;
        if (!symbol || !exchange || !marketType) return; const key = `${symbol}:${exchange}:${marketType}`; this.state.flags[key] = flag;
        const ticker = this.tickers.find(t => t.symbol === symbol && t.exchange === exchange && t.marketType === marketType);
        if (ticker) { ticker.flag = flag; const tickerElement = document.querySelector(`.ticker-item[data-symbol="${symbol}"][data-exchange="${exchange}"][data-market-type="${marketType}"]`); if (tickerElement) { const flagContainer = tickerElement.querySelector('.flag, .flag-placeholder'); if (flagContainer) { const newFlag = document.createElement('div'); newFlag.className = `flag flag-${flag}`; newFlag.dataset.symbol = symbol; newFlag.dataset.exchange = exchange; newFlag.dataset.marketType = marketType; flagContainer.parentNode.replaceChild(newFlag, flagContainer); } } }
        this.filterCache = null; this.saveState(); contextMenu.style.display = 'none';
    }

    closeContextMenu() {
        const flagMenu = document.getElementById('flagContextMenu'); if (flagMenu) flagMenu.style.display = 'none';
        const tickerMenu = document.getElementById('tickerContextMenu'); if (tickerMenu) tickerMenu.style.display = 'none';
    }

// Сохранить сортировку для текущего списка



    
}

if (typeof window !== 'undefined') {
    window.TickerPanel = TickerPanel;
}
