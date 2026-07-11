class TickerStorage {
    constructor() {
        // ✅ ВОЗВРАЩАЕМ БЕЗ АРГУМЕНТОВ — совместимость со старым TickerPanel
        this.state = {
            favorites: [],
            customSymbols: [],
            flags: {},
            activeTab: 'all',
            activeFlagTab: 'red',
            currentSymbol: '',
            currentExchange: 'binance',
            currentMarketType: 'futures',
            sortBy: 'volume',
            sortDirection: 'desc',
            marketFilter: 'all',
            exchangeFilter: 'all',
            modalSearchQuery: '',
            modalExchange: 'binance',
            modalMarketType: 'futures',
            modalPage: 0,
            modalPageSize: 30,
            isAddingAllInProgress: false,
            addingAllOffset: 0,
            addingAllBatchSize: 50,
            // ✅ ВОЗВРАЩАЕМ WS-состояния обратно в state (для совместимости)
            binanceHasConnection: { futures: false, spot: false },
            bybitHasConnection: { futures: false, spot: false },
            maxReconnectAttempts: 10,
            wsReconnectAttempts: { 
                binanceFutures: 0, binanceSpot: 0, 
                bybitFutures: 0, bybitSpot: 0 
            },
            wsConnected: {
                binanceFutures: false, binanceSpot: false,
                bybitFutures: false, bybitSpot: false    
            },
            isSettingUpWebSockets: false
        };
        
        this.tickers = [];
        this.tickersMap = new Map();
        this.allSymbolsCache = [];
        this.binanceSymbolsCache = [];
        this.bybitSymbolsCache = [];
        this.allBinanceFutures = [];
        this.allBinanceSpot = [];
        this.allBybitFutures = [];
        this.allBybitSpot = [];
        
        this.formatCache = {
            prices: new Map(),
            volumes: new Map(),
            changes: new Map()
        };
        this.cacheMaxAge = 10000;
        this.settings = { excludePatterns: ['BULL', 'BEAR', 'UP', 'DOWN', 'HEDGE'] };
        this.debugMode = true;
        this.filterCache = null;
        this.saveTimeout = null;
        this._isRefreshing = false;
        this._eventsInitialized = false;

        // ✅ УЛУЧШЕНИЕ: Map для O(1) поиска популярности
        this._popularityIndex = this._buildPopularityIndex();
    }
    
    // ✅ ВОЗВРАЩАЕМ ВСЕ ГЕТТЕРЫ (для совместимости)
    getState() { return this.state; }
    getTickers() { return this.tickers; }
    getTickersMap() { return this.tickersMap; }
    getBinanceSymbolsCache() { return this.binanceSymbolsCache; }
    getBybitSymbolsCache() { return this.bybitSymbolsCache; }
    
    // ===== ЗАГРУЗКА ДАННЫХ =====
    
    async loadUserData() {
        console.log('📦 Загрузка пользовательских данных...');
        
        const loadedFromLocal = this.loadFromLocalStorage();
        
        if (window.db && window.dbReady) {
            try {
                const favorites = await window.db.get('settings', 'favorites');
                if (favorites && favorites.value) {
                    this.state.favorites = favorites.value;
                }
                
                const flags = await window.db.get('settings', 'flags');
                if (flags && flags.value) {
                    this.state.flags = flags.value;
                }
                
                const currentSymbol = await window.db.get('settings', 'currentSymbol');
                if (currentSymbol && currentSymbol.value) {
                    this.state.currentSymbol = currentSymbol.value.symbol || 'BTCUSDT';
                    this.state.currentExchange = currentSymbol.value.exchange || 'binance';
                    this.state.currentMarketType = currentSymbol.value.marketType || 'futures';
                }
                
                console.log('✅ Данные загружены из IndexedDB');
            } catch (error) {
                console.warn('❌ Ошибка IndexedDB, используем localStorage:', error);
            }
        } else if (loadedFromLocal) {
            console.log('✅ Данные загружены из localStorage');
        } else {
            console.warn('⚠️ Нет сохранённых данных');
        }
    }
    
    // ✅ ИСПРАВЛЕНИЕ: теперь корректно возвращает true при загрузке
    loadFromLocalStorage() {
        try {
            let loaded = false;
            
            const favorites = localStorage.getItem('favorites');
            if (favorites) {
                const parsed = JSON.parse(favorites);
                if (Array.isArray(parsed)) {
                    this.state.favorites = parsed;
                    loaded = true;  // ✅ ДОБАВЛЕНО
                }
            }
            
            const flags = localStorage.getItem('flags');
            if (flags) {
                const parsed = JSON.parse(flags);
                if (typeof parsed === 'object') {
                    this.state.flags = parsed;
                    loaded = true;  // ✅ ДОБАВЛЕНО
                }
            }
            
            const currentSymbol = localStorage.getItem('currentSymbol');
            if (currentSymbol) {
                const parsed = JSON.parse(currentSymbol);
                this.state.currentSymbol = parsed.symbol || 'BTCUSDT';
                this.state.currentExchange = parsed.exchange || 'binance';
                this.state.currentMarketType = parsed.marketType || 'futures';
                loaded = true;  // ✅ ДОБАВЛЕНО
            }
            
            return loaded;
            
        } catch (e) {
            console.warn('❌ Ошибка загрузки из localStorage:', e);
            return false;
        }
    }
    
    async loadFromIndexedDB() {
        console.log('📦 Загрузка инструментов из IndexedDB...');
        
        if (!window.db || !window.dbReady) {
            console.warn('📦 IndexedDB не доступна');
            return false;
        }
        
        try {
            const binanceCache = await window.db.get('symbolCaches', 'binance');
            if (binanceCache && binanceCache.data && binanceCache.data.length > 0) {
                this.binanceSymbolsCache = binanceCache.data;
                this.binanceSymbolsCache = this.sortByPopularity(this.binanceSymbolsCache);
                this.allBinanceFutures = this.binanceSymbolsCache.filter(s => s.marketType === 'futures');
                this.allBinanceSpot = this.binanceSymbolsCache.filter(s => s.marketType === 'spot');
                console.log(`✅ Binance из IndexedDB: ${this.binanceSymbolsCache.length}`);
            }
            
            const bybitCache = await window.db.get('symbolCaches', 'bybit');
            if (bybitCache && bybitCache.data && bybitCache.data.length > 0) {
                this.bybitSymbolsCache = bybitCache.data;
                this.bybitSymbolsCache = this.sortByPopularity(this.bybitSymbolsCache);
                this.allBybitFutures = this.bybitSymbolsCache.filter(s => s.marketType === 'futures');
                this.allBybitSpot = this.bybitSymbolsCache.filter(s => s.marketType === 'spot');
                console.log(`✅ Bybit из IndexedDB: ${this.bybitSymbolsCache.length}`);
            }
            
            this.allSymbolsCache = [...this.binanceSymbolsCache, ...this.bybitSymbolsCache];
            
            return this.binanceSymbolsCache.length > 0 || this.bybitSymbolsCache.length > 0;
            
        } catch (error) {
            console.warn('❌ Ошибка загрузки из IndexedDB:', error);
            return false;
        }
    }
    
    // ===== СОХРАНЕНИЕ =====
    
    // ✅ ИСПРАВЛЕНИЕ: async вынесен в отдельный метод
    saveState() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => this._doSaveState(), 500);
    }

    async _doSaveState() {
        if (window.tickerPanelInstance?.syncWithActiveWatchlist) {
            window.tickerPanelInstance.syncWithActiveWatchlist();
        }
        
        try {
            localStorage.setItem('favorites', JSON.stringify(this.state.favorites));
            localStorage.setItem('flags', JSON.stringify(this.state.flags));
            localStorage.setItem('currentSymbol', JSON.stringify({
                symbol: this.state.currentSymbol,
                exchange: this.state.currentExchange,
                marketType: this.state.currentMarketType
            }));
        } catch (e) {
            console.warn('Ошибка сохранения в localStorage:', e);
        }
        
        if (window.db && window.dbReady) {
            try {
                await window.db.put('settings', {
                    key: 'favorites',
                    value: this.state.favorites,
                    timestamp: Date.now()
                });
                
                await window.db.put('settings', {
                    key: 'flags',
                    value: this.state.flags,
                    timestamp: Date.now()
                });
                
                console.log('✅ Состояние сохранено');
            } catch (error) {
                console.warn('❌ Ошибка сохранения в IndexedDB:', error);
            }
        }
    }
    
    async saveCurrentSymbol(symbol, exchange, marketType) {
        try {
            localStorage.setItem('currentSymbol', JSON.stringify({ symbol, exchange, marketType }));
        } catch (e) {}
        
        if (!window.db || !window.dbReady) return;
        
        try {
            await window.db.put('settings', {
                key: 'currentSymbol',
                value: { symbol, exchange, marketType },
                timestamp: Date.now()
            });
        } catch (error) {
            console.warn('❌ Ошибка сохранения currentSymbol:', error);
        }
    }
    
    async saveSymbolsToIndexedDB() {
        try {
            localStorage.setItem('binanceSymbolsCache', JSON.stringify(this.binanceSymbolsCache));
            localStorage.setItem('bybitSymbolsCache', JSON.stringify(this.bybitSymbolsCache));
        } catch (e) {
            console.warn('localStorage переполнен, кэш символов не сохранён');
        }
        
        if (!window.db || !window.dbReady) return;
        
        try {
            const now = Date.now();
            
            if (this.binanceSymbolsCache && this.binanceSymbolsCache.length > 0) {
                const sortedBinance = this.sortByPopularity(this.binanceSymbolsCache);
                await window.db.put('symbolCaches', {
                    exchange: 'binance',
                    data: sortedBinance,
                    timestamp: now
                });
            }
            
            if (this.bybitSymbolsCache && this.bybitSymbolsCache.length > 0) {
                const sortedBybit = this.sortByPopularity(this.bybitSymbolsCache);
                await window.db.put('symbolCaches', {
                    exchange: 'bybit',
                    data: sortedBybit,
                    timestamp: now
                });
            }
            
            console.log('✅ Кэш символов сохранён в IndexedDB');
            
        } catch (error) {
            console.warn('❌ Ошибка сохранения кэша:', error);
        }
    }
    
    // ===== ВОТЧЛИСТЫ (ВОЗВРАЩЕНЫ для совместимости) =====
    
    async loadWatchlists() {
        if (window.db && window.dbReady) {
            try {
                const data = await window.db.get('settings', 'watchlists');
                if (data?.value) return data.value;
            } catch (e) {}
        }
        const saved = localStorage.getItem('watchlists');
        return saved ? JSON.parse(saved) : null;
    }

    async saveWatchlists(data) {
        if (window.db && window.dbReady) {
            try {
                await window.db.put('settings', { key: 'watchlists', value: data, timestamp: Date.now() });
                console.log('📋 Вотчлисты сохранены в IndexedDB');
                localStorage.removeItem('watchlists');
                return;
            } catch (e) {
                console.error('Ошибка сохранения в IndexedDB:', e);
            }
        }
        localStorage.setItem('watchlists', JSON.stringify(data));
    }
    
    // ===== УТИЛИТЫ =====
    
    // ✅ УЛУЧШЕНИЕ: O(1) поиск вместо O(n)
    _buildPopularityIndex() {
        const popularityOrder = [
            'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
            'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
            'MATICUSDT', 'UNIUSDT', 'ATOMUSDT', 'ETCUSDT', 'LTCUSDT',
            'FILUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'NEARUSDT',
            'INJUSDT', 'SUIUSDT', 'SEIUSDT', 'WIFUSDT', 'PEPEUSDT',
            'SHIBUSDT', 'BONKUSDT', 'FLOKIUSDT'
        ];
        const index = new Map();
        popularityOrder.forEach((sym, idx) => index.set(sym, idx));
        return index;
    }

    sortByPopularity(symbols) {
        const popularityIndex = this._popularityIndex;
        return [...symbols].sort((a, b) => {
            const aSymbol = a.symbol || '';
            const bSymbol = b.symbol || '';
            const aIdx = popularityIndex.get(aSymbol);
            const bIdx = popularityIndex.get(bSymbol);
            
            if (aIdx !== undefined && bIdx !== undefined) {
                if (aIdx === bIdx) {
                    if (a.exchange === 'binance' && b.exchange !== 'binance') return -1;
                    if (a.exchange !== 'binance' && b.exchange === 'binance') return 1;
                    return 0;
                }
                return aIdx - bIdx;
            }
            if (aIdx !== undefined) return -1;
            if (bIdx !== undefined) return 1;
            
            return aSymbol.localeCompare(bSymbol);
        });
    }
    
    getFilteredCount(exchange, marketType, query) {
        if (exchange === 'binance') {
            const source = marketType === 'futures' ? this.allBinanceFutures : this.allBinanceSpot;
            if (!source) return 0;
            let filtered = source;
            if (query) {
                filtered = filtered.filter(s => s.symbol.includes(query.toUpperCase()));
            }
            return filtered.length;
        } else {
            const source = marketType === 'futures' ? this.allBybitFutures : this.allBybitSpot;
            if (!source) return 0;
            let filtered = source;
            if (query) {
                filtered = filtered.filter(s => s.symbol.includes(query.toUpperCase()));
            }
            return filtered.length;
        }
    }
    
    // ✅ ВОЗВРАЩАЕМ updateModalCount (критично для TickerPanel!)
    updateModalCount() {
        const foundSpan = document.getElementById('modalFoundCount');
        if (!foundSpan) return;
        
        if (!this.state) {
            console.warn('updateModalCount: this.state не определен');
            foundSpan.textContent = '0';
            return;
        }
        
        let source;
        if (this.state.modalExchange === 'binance') {
            source = this.state.modalMarketType === 'futures' 
                ? this.allBinanceFutures 
                : this.allBinanceSpot;
        } else {
            source = this.state.modalMarketType === 'futures' 
                ? this.allBybitFutures 
                : this.allBybitSpot;
        }
        
        let count = source ? source.length : 0;
        const query = this.state.modalSearchQuery;
        if (query && source) {
            count = source.filter(s => s.symbol.includes(query.toUpperCase())).length;
        }
        
        foundSpan.textContent = count;
    }

    // ✅ ВОЗВРАЩАЕМ removeDuplicates (для совместимости)
    removeDuplicates(arr, key) {
        const seen = new Map();
        return arr.filter(item => {
            if (!item || !item[key]) return false;
            const value = item[key];
            if (seen.has(value)) return false;
            seen.set(value, true);
            return true;
        });
    }
    
    // ✅ УЛУЧШЕНИЕ: метод destroy для очистки ресурсов
    destroy() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        this.formatCache.prices.clear();
        this.formatCache.volumes.clear();
        this.formatCache.changes.clear();
        this.tickersMap.clear();
        this.filterCache = null;
    }
}

if (typeof window !== 'undefined') {
    window.TickerStorage = TickerStorage;
}
