class TickerStorage {
    constructor() {
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
        };

        // Свойства WebSocket и подключений теперь живут отдельно от сохраняемого состояния
        this.wsState = {
            binanceHasConnection: { futures: false, spot: false },
            bybitHasConnection: { futures: false, spot: false },
            maxReconnectAttempts: 10,
            wsReconnectAttempts: {
                binanceFutures: 0,
                binanceSpot: 0,
                bybitFutures: 0,
                bybitSpot: 0
            },
            wsConnected: {
                binanceFutures: false,
                binanceSpot: false,
                bybitFutures: false,
                bybitSpot: false
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

        // O(1) индекс популярности
        this._popularityIndex = this._buildPopularityIndex();
    }

    getState() { return this.state; }
    getTickers() { return this.tickers; }
    getTickersMap() { return this.tickersMap; }
    getBinanceSymbolsCache() { return this.binanceSymbolsCache; }
    getBybitSymbolsCache() { return this.bybitSymbolsCache; }

    // ---------------------------------------------------------------------------
    // Загрузка данных
    // ---------------------------------------------------------------------------
    async loadUserData() {
        console.log('📦 Загрузка пользовательских данных...');

        const loadedFromLocal = this.loadFromLocalStorage(); // теперь возвращает корректный флаг

        if (window.db && window.dbReady) {
            try {
                const favorites = await window.db.get('settings', 'favorites');
                if (favorites?.value) this.state.favorites = favorites.value;

                const flags = await window.db.get('settings', 'flags');
                if (flags?.value) this.state.flags = flags.value;

                const currentSymbol = await window.db.get('settings', 'currentSymbol');
                if (currentSymbol?.value) {
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

    loadFromLocalStorage() {
        try {
            let loaded = false;

            const favorites = localStorage.getItem('favorites');
            if (favorites) {
                const parsed = JSON.parse(favorites);
                if (Array.isArray(parsed)) {
                    this.state.favorites = parsed;
                    loaded = true;
                }
            }

            const flags = localStorage.getItem('flags');
            if (flags) {
                const parsed = JSON.parse(flags);
                if (typeof parsed === 'object') {
                    this.state.flags = parsed;
                    loaded = true;
                }
            }

            const currentSymbol = localStorage.getItem('currentSymbol');
            if (currentSymbol) {
                const parsed = JSON.parse(currentSymbol);
                this.state.currentSymbol = parsed.symbol || 'BTCUSDT';
                this.state.currentExchange = parsed.exchange || 'binance';
                this.state.currentMarketType = parsed.marketType || 'futures';
                loaded = true;
            }

            return loaded; // ✅ теперь честно возвращает true/false
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
            if (binanceCache?.data?.length > 0) {
                this.binanceSymbolsCache = this.sortByPopularity(binanceCache.data);
                this.allBinanceFutures = this.binanceSymbolsCache.filter(s => s.marketType === 'futures');
                this.allBinanceSpot = this.binanceSymbolsCache.filter(s => s.marketType === 'spot');
                console.log(`✅ Binance из IndexedDB: ${this.binanceSymbolsCache.length}`);
            }

            const bybitCache = await window.db.get('symbolCaches', 'bybit');
            if (bybitCache?.data?.length > 0) {
                this.bybitSymbolsCache = this.sortByPopularity(bybitCache.data);
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

    // ---------------------------------------------------------------------------
    // Сохранение
    // ---------------------------------------------------------------------------
    saveState() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => this._doSaveState(), 500);
    }

    async _doSaveState() {
        // Синхронизация с активным вотчлистом
        if (window.tickerPanelInstance?.syncWithActiveWatchlist) {
            window.tickerPanelInstance.syncWithActiveWatchlist();
        }

        // localStorage (синхронно, быстро)
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

        // IndexedDB (асинхронно)
        if (window.db && window.dbReady) {
            try {
                await window.db.put('settings', { key: 'favorites', value: this.state.favorites, timestamp: Date.now() });
                await window.db.put('settings', { key: 'flags', value: this.state.flags, timestamp: Date.now() });
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

        if (window.db && window.dbReady) {
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
            if (this.binanceSymbolsCache?.length > 0) {
                await window.db.put('symbolCaches', {
                    exchange: 'binance',
                    data: this.sortByPopularity(this.binanceSymbolsCache),
                    timestamp: now
                });
            }
            if (this.bybitSymbolsCache?.length > 0) {
                await window.db.put('symbolCaches', {
                    exchange: 'bybit',
                    data: this.sortByPopularity(this.bybitSymbolsCache),
                    timestamp: now
                });
            }
            console.log('✅ Кэш символов сохранён в IndexedDB');
        } catch (error) {
            console.warn('❌ Ошибка сохранения кэша:', error);
        }
    }

    // ---------------------------------------------------------------------------
    // Вспомогательные методы
    // ---------------------------------------------------------------------------
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
        const popIdx = this._popularityIndex;
        return [...symbols].sort((a, b) => {
            const aSym = a.symbol || '';
            const bSym = b.symbol || '';
            const aIdx = popIdx.get(aSym);
            const bIdx = popIdx.get(bSym);

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
            return aSym.localeCompare(bSym);
        });
    }

    // ✅ Удалён дублирующийся код
    getFilteredCount(exchange, marketType, query) {
        let source;
        if (exchange === 'binance') {
            source = marketType === 'futures' ? this.allBinanceFutures : this.allBinanceSpot;
        } else {
            source = marketType === 'futures' ? this.allBybitFutures : this.allBybitSpot;
        }
        if (!source) return 0;
        if (!query) return source.length;
        return source.filter(s => s.symbol.includes(query.toUpperCase())).length;
    }

    // Заглушка для обратной совместимости – реальное обновление теперь в TickerModal
    updateModalCount() {
        // Рекомендуется вызывать TickerModal.updateCount() напрямую
        if (window.tickerPanelInstance?.modal?.updateCount) {
            window.tickerPanelInstance.modal.updateCount();
        }
    }

    // ✅ Метод очистки таймера
    destroy() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
    }
}

if (typeof window !== 'undefined') {
    window.TickerStorage = TickerStorage;
}
