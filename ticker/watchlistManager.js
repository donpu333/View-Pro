class WatchlistManager {
    constructor(tickerPanel) {
        this.tickerPanel = tickerPanel;
        this.lists = new Map();
        this.activeListId = 'default';
        this.listOrder = ['default'];
        this.renderCache = new Map();
        this._dropdownOpen = false;
        this._loaded = false;
        this._saveDebounceTimer = null;
        this._dbReady = false;
        this._initPromise = this._waitForDBAndLoad();
        this._switchCooldown = false;
    }

    async _waitForDBAndLoad() {
        if (!window.db || !window.dbReady) {
            console.log('⏳ WatchlistManager: жду IndexedDB...');
            await new Promise((resolve) => {
                const check = setInterval(() => {
                    if (window.db && window.dbReady) {
                        clearInterval(check);
                        resolve();
                    }
                }, 100);
                setTimeout(() => { clearInterval(check); resolve(); }, 10000);
            });
        }
        this._dbReady = !!(window.db && window.dbReady);
        console.log('📋 WatchlistManager: IndexedDB ' + (this._dbReady ? 'готова' : 'недоступна'));
        await this._loadFromStorage();
    }

    async _loadFromStorage() {
        try {
            let saved = null;
            if (this._dbReady) {
                try {
                    const data = await window.db.get('settings', 'watchlists');
                    if (data?.value) saved = data.value;
                } catch (e) {}
            }
            if (!saved) {
                const localData = localStorage.getItem('watchlists');
                if (localData) {
                    try { saved = JSON.parse(localData); } catch (e) { localStorage.removeItem('watchlists'); }
                }
            }
            if (saved?.lists) {
                this.lists = new Map(Object.entries(saved.lists));
                this.listOrder = saved.listOrder || ['default'];
                this.activeListId = saved.activeListId || 'default';
            }
        } catch (e) {}

        if (!this.lists.has('default')) {
            this.lists.set('default', { name: 'Основной', symbols: [], isDefault: true });
        }
        if (!this.lists.has(this.activeListId)) this.activeListId = 'default';

        // ✅ ИСПРАВЛЕНИЕ: Вотчлист — единственный источник истины
        const activeList = this.lists.get(this.activeListId);
        if (activeList) {
            this.tickerPanel.state.customSymbols = [...activeList.symbols];
        } else {
            this.tickerPanel.state.customSymbols = [];
        }
        this._loaded = true;
    }

    async _saveToDB(data) {
        if (this._dbReady && window.db) {
            try {
                await window.db.put('settings', { key: 'watchlists', value: data, timestamp: Date.now() });
                return true;
            } catch (e) {}
        }
        localStorage.setItem('watchlists', JSON.stringify(data));
        return false;
    }

    saveToStorage() {
        if (this._saveDebounceTimer) clearTimeout(this._saveDebounceTimer);
        this._saveDebounceTimer = setTimeout(() => this._saveNow(), 300);
    }

    saveToStorageImmediate() {
        if (this._saveDebounceTimer) clearTimeout(this._saveDebounceTimer);
        this._saveNow();
    }

    async _saveNow() {
        if (!this._loaded) return;
        // ✅ Синхронизируем панель с активным списком перед сохранением
        const activeList = this.lists.get(this.activeListId);
        if (activeList) {
            this.tickerPanel.state.customSymbols = [...activeList.symbols];
        }
        await this._saveToDB({
            lists: Object.fromEntries(this.lists),
            listOrder: this.listOrder,
            activeListId: this.activeListId
        });
    }

    async syncActiveListFromPanel() {
        await this._initPromise;
        if (this._switchCooldown) return;
        const list = this.lists.get(this.activeListId);
        if (!list) return;
        const panelSymbols = this.tickerPanel.state.customSymbols;
        if (panelSymbols.length === 0) return;
        if (JSON.stringify([...list.symbols].sort()) === JSON.stringify([...panelSymbols].sort())) return;
        // ✅ Панель не должна перезаписывать вотчлист — наоборот
        this.tickerPanel.state.customSymbols = [...list.symbols];
        this.renderCache.delete(this.activeListId);
        this.renderDropdown();
    }

    async createList(name) {
        await this._initPromise;
        const id = `wl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        this.lists.set(id, { name: name || `Список ${this.lists.size}`, symbols: [], isDefault: false });
        this.listOrder.push(id);
        this.renderCache.delete(id);
        this.saveToStorage();
        this.renderDropdown();
        return id;
    }

    async deleteList(listId) {
        await this._initPromise;
        if (listId === 'default' || !this.lists.has(listId)) return false;
        this.lists.delete(listId);
        this.listOrder = this.listOrder.filter(id => id !== listId);
        this.renderCache.delete(listId);
        if (this.activeListId === listId) await this.activateList('default');
        this.saveToStorage();
        this.renderDropdown();
        return true;
    }

    async renameList(listId, newName) {
        await this._initPromise;
        const list = this.lists.get(listId);
        if (!list) return false;
        list.name = newName;
        this.renderCache.delete(listId);
        this.saveToStorage();
        this.renderDropdown();
        return true;
    }

    async activateList(listId) {
        await this._initPromise;
        if (!this.lists.has(listId)) return;
        if (this.activeListId === listId) { this.closeDropdown(); return; }

        // ✅ Сохраняем старый список
        const oldList = this.lists.get(this.activeListId);
        if (oldList) {
            oldList.symbols = [...this.tickerPanel.state.customSymbols];
            this.renderCache.delete(this.activeListId);
        }

        this.activeListId = listId;
        this._switchCooldown = true;
        setTimeout(() => { this._switchCooldown = false; }, 500);

        const newList = this.lists.get(listId);
        if (!newList) return;

        // ✅ Проверяем текущий открытый тикер
        const currentKey = `${this.tickerPanel.state.currentSymbol}:${this.tickerPanel.state.currentExchange}:${this.tickerPanel.state.currentMarketType}`;
        const isCurrentInNewList = newList.symbols.includes(currentKey);

        // ✅ Очищаем панель
        this.tickerPanel.state.customSymbols = [...newList.symbols];
        this.tickerPanel.tickers = [];
        this.tickerPanel.tickerElements.clear();
        this.tickerPanel.displayedTickers = [];
        this.tickerPanel.totalItems = 0;
        this.tickerPanel.filterCache = null;

        const container = document.getElementById('tickerListContainer');
        if (container) container.innerHTML = '';

        let needsPriceFetch = [];

        newList.symbols.forEach(symbolKey => {
            const parts = symbolKey.split(':');
            if (parts.length !== 3) return;
            const [symbol, exchange, marketType] = parts;

            if (this.tickerPanel.tickersMap.has(symbolKey)) {
                const ticker = this.tickerPanel.tickersMap.get(symbolKey);
                if (!this.tickerPanel.tickers.includes(ticker)) {
                    this.tickerPanel.tickers.push(ticker);
                }
            } else {
                const newTicker = { 
                    symbol, price: 0, change: 0, volume: 0, trades: null, 
                    custom: true, prevPrice: 0, exchange, marketType, 
                    flag: this.tickerPanel.state.flags[symbolKey] || null 
                };
                this.tickerPanel.tickers.push(newTicker);
                this.tickerPanel.tickersMap.set(symbolKey, newTicker);
                needsPriceFetch.push(symbolKey);
            }
        });

        this.tickerPanel.renderTickerList();
        this.tickerPanel.updateModalCount();
        this.renderDropdown();
        this.closeDropdown();

        // ✅ Если текущий тикер не в новом списке — очищаем график
        if (!isCurrentInNewList) {
            this.tickerPanel.state.currentSymbol = '';
            this.tickerPanel.state.currentExchange = 'binance';
            this.tickerPanel.state.currentMarketType = 'futures';
            const pairDisplay = document.getElementById('pairDisplay');
            if (pairDisplay) pairDisplay.textContent = '';
            const exchangeDisplay = document.getElementById('exchangeDisplay');
            if (exchangeDisplay) exchangeDisplay.textContent = '';
            const contractTypeDisplay = document.getElementById('contractTypeDisplay');
            if (contractTypeDisplay) contractTypeDisplay.textContent = '';
            if (this.tickerPanel.coordinator?.clearChart) {
                this.tickerPanel.coordinator.clearChart();
            }
        } else {
            setTimeout(() => {
                const el = document.querySelector(
                    `.ticker-item[data-symbol="${this.tickerPanel.state.currentSymbol}"]` +
                    `[data-exchange="${this.tickerPanel.state.currentExchange}"]` +
                    `[data-market-type="${this.tickerPanel.state.currentMarketType}"]`
                );
                if (el) {
                    document.querySelectorAll('.ticker-item.active').forEach(a => a.classList.remove('active'));
                    el.classList.add('active');
                }
            }, 100);
        }

        this.saveToStorageImmediate();

        if (needsPriceFetch.length > 0) {
            setTimeout(() => this.fetchPricesForActiveList(), 50);
        }
    }

    async addSymbolToList(listId, symbol, exchange, marketType) {
        await this._initPromise;
        const list = this.lists.get(listId);
        if (!list) return false;

        const key = `${symbol}:${exchange}:${marketType}`;
        if (list.symbols.includes(key)) return false;

        list.symbols.push(key);
        this.renderCache.delete(listId);
        this.saveToStorage();
        this.renderDropdown();

        if (listId === this.activeListId) {
            this.loadSymbolsFromList(listId);
            setTimeout(() => this.fetchPricesForActiveList(), 100);
        }

        return true;
    }

    async addSymbolToActiveList(symbol, exchange, marketType) {
        await this._initPromise;
        const list = this.lists.get(this.activeListId);
        if (!list) return;

        const key = `${symbol}:${exchange}:${marketType}`;
        if (list.symbols.includes(key)) return;

        list.symbols.push(key);
        this.renderCache.delete(this.activeListId);
        this.saveToStorage();
        this.renderDropdown();
        this.loadSymbolsFromList(this.activeListId);
        setTimeout(() => this.fetchPricesForActiveList(), 100);
    }

    async removeSymbolFromActiveList(symbol, exchange, marketType) {
        await this._initPromise;
        const list = this.lists.get(this.activeListId);
        if (!list) return;

        const key = `${symbol}:${exchange}:${marketType}`;
        const before = list.symbols.length;
        list.symbols = list.symbols.filter(s => s !== key);

        if (list.symbols.length !== before) {
            this.renderCache.delete(this.activeListId);
            this.saveToStorage();
            this.renderDropdown();
            this.loadSymbolsFromList(this.activeListId);
        }
    }

    async clearActiveList() {
        await this._initPromise;
        const list = this.lists.get(this.activeListId);
        if (!list) return;

        list.symbols = [];
        this.renderCache.delete(this.activeListId);
        this.saveToStorage();
        this.renderDropdown();
        this.loadSymbolsFromList(this.activeListId);
    }

    loadSymbolsFromList(listId) {
        const list = this.lists.get(listId);
        if (!list) return;

        this.tickerPanel.tickers = [];
        this.tickerPanel.state.customSymbols = [];
        this.tickerPanel.tickerElements.clear();
        this.tickerPanel.displayedTickers = [];
        this.tickerPanel.totalItems = 0;
        this.tickerPanel.filterCache = null;

        const container = document.getElementById('tickerListContainer');
        if (container) container.innerHTML = '';

        this.tickerPanel.state.customSymbols = [...list.symbols];

        list.symbols.forEach(symbolKey => {
            const parts = symbolKey.split(':');
            if (parts.length === 3) {
                const [symbol, exchange, marketType] = parts;
                if (this.tickerPanel.tickersMap.has(symbolKey)) {
                    this.tickerPanel.tickers.push(this.tickerPanel.tickersMap.get(symbolKey));
                } else {
                    this.tickerPanel.addSymbol(symbol, true, exchange, marketType, false, true, true);
                }
            }
        });
        this.tickerPanel.renderTickerList();
    }

    async fetchPricesForActiveList() {
        const activeList = this.lists.get(this.activeListId);
        if (!activeList || activeList.symbols.length === 0) return;

        const binanceFutures = [];
        const binanceSpot = [];
        const bybitFutures = [];
        const bybitSpot = [];

        activeList.symbols.forEach(key => {
            const parts = key.split(':');
            if (parts.length !== 3) return;
            const [symbol, exchange, marketType] = parts;
            if (exchange === 'binance') {
                if (marketType === 'futures') binanceFutures.push(symbol);
                else binanceSpot.push(symbol);
            } else if (exchange === 'bybit') {
                if (marketType === 'futures') bybitFutures.push(symbol);
                else bybitSpot.push(symbol);
            }
        });

        const promises = [];

        // Binance Futures
        if (binanceFutures.length > 0) {
            const set = new Set(binanceFutures);
            promises.push(
                fetch('https://fapi.binance.com/fapi/v1/ticker/24hr')
                    .then(r => r.json())
                    .then(data => {
                        if (Array.isArray(data)) data.forEach(t => {
                            if (set.has(t.symbol)) {
                                const ticker = this.tickerPanel.tickersMap.get(`${t.symbol}:binance:futures`);
                                if (ticker) {
                                    ticker.price = parseFloat(t.lastPrice) || 0;
                                    ticker.change = parseFloat(t.priceChangePercent) || 0;
                                    ticker.volume = parseFloat(t.quoteVolume) || 0;
                                    ticker.trades = parseInt(t.count) || 0;
                                }
                            }
                        });
                    }).catch(() => {})
            );
        }

        // Binance Spot
        if (binanceSpot.length > 0) {
            const set = new Set(binanceSpot);
            promises.push(
                fetch('https://api.binance.com/api/v3/ticker/24hr')
                    .then(r => r.json())
                    .then(data => {
                        if (Array.isArray(data)) data.forEach(t => {
                            if (set.has(t.symbol)) {
                                const ticker = this.tickerPanel.tickersMap.get(`${t.symbol}:binance:spot`);
                                if (ticker) {
                                    ticker.price = parseFloat(t.lastPrice) || 0;
                                    ticker.change = parseFloat(t.priceChangePercent) || 0;
                                    ticker.volume = parseFloat(t.quoteVolume) || 0;
                                    ticker.trades = parseInt(t.count) || 0;
                                }
                            }
                        });
                    }).catch(() => {})
            );
        }

        // Bybit Futures
        if (bybitFutures.length > 0) {
            const set = new Set(bybitFutures);
            promises.push(
                fetch('https://api.bybit.com/v5/market/tickers?category=linear')
                    .then(r => r.json())
                    .then(data => {
                        if (data?.retCode === 0 && data.result?.list) data.result.list.forEach(t => {
                            if (set.has(t.symbol)) {
                                const ticker = this.tickerPanel.tickersMap.get(`${t.symbol}:bybit:futures`);
                                if (ticker) {
                                    ticker.price = parseFloat(t.lastPrice) || 0;
                                    ticker.change = (parseFloat(t.price24hPcnt) || 0) * 100;
                                    ticker.volume = (parseFloat(t.volume24h) || 0) * (parseFloat(t.lastPrice) || 0);
                                }
                            }
                        });
                    }).catch(() => {})
            );
        }

        // Bybit Spot
        if (bybitSpot.length > 0) {
            const set = new Set(bybitSpot);
            promises.push(
                fetch('https://api.bybit.com/v5/market/tickers?category=spot')
                    .then(r => r.json())
                    .then(data => {
                        if (data?.retCode === 0 && data.result?.list) data.result.list.forEach(t => {
                            if (set.has(t.symbol)) {
                                const ticker = this.tickerPanel.tickersMap.get(`${t.symbol}:bybit:spot`);
                                if (ticker) {
                                    ticker.price = parseFloat(t.lastPrice) || 0;
                                    ticker.change = (parseFloat(t.price24hPcnt) || 0) * 100;
                                    ticker.volume = (parseFloat(t.volume24h) || 0) * (parseFloat(t.lastPrice) || 0);
                                }
                            }
                        });
                    }).catch(() => {})
            );
        }

        await Promise.allSettled(promises);
        this.tickerPanel.renderTickerList();
    }

    renderDropdown() {
        const container = document.getElementById('watchlistDropdown');
        if (!container) { this.createDropdownContainer(); return; }

        const activeList = this.lists.get(this.activeListId);
        const listName = activeList ? activeList.name : 'Списки';
        const itemCount = activeList ? activeList.symbols.length : 0;

        const btnText = container.querySelector('.wl-btn-text');
        const btnCount = container.querySelector('.wl-btn-count');
        if (btnText) btnText.textContent = this.escapeHtml(listName);
        if (btnCount) btnCount.textContent = itemCount;

        if (!this._dropdownOpen) return;

        const dropdown = container.querySelector('.wl-dropdown-menu');
        if (dropdown) {
            let html = '';
            this.listOrder.forEach(listId => {
                const list = this.lists.get(listId);
                if (!list) return;
                const isActive = listId === this.activeListId;
                html += `
                    <div class="wl-dropdown-item ${isActive ? 'active' : ''}" data-list-id="${listId}">
                       <span class="wl-item-name">${this.escapeHtml(list.name)}</span>
                       <span class="wl-item-count">${list.symbols.length}</span>
                       <span class="wl-item-actions">
                            ${!list.isDefault ? `<span class="wl-item-edit" data-action="edit" title="Переименовать">✎</span>` : ''}
                            ${!list.isDefault ? `<span class="wl-item-delete" data-action="delete" title="Удалить">×</span>` : ''}
                        </span>
                    </div>
                `;
            });

            html += `
                <div class="wl-dropdown-divider"></div>
                <div class="wl-dropdown-item wl-add-item" data-action="add">
                    + Создать новый список
                </div>
            `;

            dropdown.innerHTML = html;

            dropdown.querySelectorAll('.wl-dropdown-item[data-list-id]').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.closest('[data-action="edit"]')) { e.stopPropagation(); this.editListPrompt(item.dataset.listId); return; }
                    if (e.target.closest('[data-action="delete"]')) { e.stopPropagation(); this.deleteListPrompt(item.dataset.listId); return; }
                    this.activateList(item.dataset.listId);
                });
            });

            const addBtn = dropdown.querySelector('[data-action="add"]');
            if (addBtn) addBtn.addEventListener('click', () => this.createListPrompt());
        }
    }

    createDropdownContainer() {
        const tickerPanel = document.getElementById('tickerPanel');
        let container = document.getElementById('watchlistDropdown');
        if (!container) {
            container = document.createElement('div');
            container.id = 'watchlistDropdown';
            container.className = 'wl-dropdown-container';
            container.innerHTML = `
                <div class="wl-dropdown-btn">
                    <span class="wl-btn-text">Основной</span>
                    <span class="wl-btn-count">0</span>
                    <svg class="wl-btn-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
                <div class="wl-dropdown-menu"></div>
            `;
            const tabsContainer = tickerPanel?.querySelector('.tabs-container');
            if (tabsContainer) tabsContainer.parentNode.insertBefore(container, tabsContainer);
            else tickerPanel?.insertBefore(container, tickerPanel.firstChild);
            this.bindDropdownEvents(container);
        }
        this.renderDropdown();
    }

    bindDropdownEvents(container) {
        container.querySelector('.wl-dropdown-btn').addEventListener('click', (e) => { e.stopPropagation(); this.toggleDropdown(); });
        document.addEventListener('click', (e) => { if (!container.contains(e.target)) this.closeDropdown(); });
    }

    toggleDropdown() {
        const container = document.getElementById('watchlistDropdown');
        if (!container) return;
        this._dropdownOpen = !this._dropdownOpen;
        container.classList.toggle('open', this._dropdownOpen);
        if (this._dropdownOpen) this.renderDropdown();
    }

    closeDropdown() {
        const container = document.getElementById('watchlistDropdown');
        if (container) { container.classList.remove('open'); this._dropdownOpen = false; }
    }

    createListPrompt() {
        const name = prompt('Название нового списка:');
        if (name && name.trim()) this.createList(name.trim()).then(newId => this.activateList(newId));
    }

    editListPrompt(listId) {
        const list = this.lists.get(listId);
        if (!list) return;
        const newName = prompt('Новое название:', list.name);
        if (newName && newName.trim()) this.renameList(listId, newName.trim());
    }

    deleteListPrompt(listId) {
        const list = this.lists.get(listId);
        if (!list) return;
        if (confirm(`Удалить список «${list.name}»?`)) this.deleteList(listId);
    }

    async initializeWithPriority() {
        await this._initPromise;
        this.renderDropdown();
        const activeList = this.lists.get(this.activeListId);
        const panelHasTickers = this.tickerPanel.tickers.length > 0;

        if (!panelHasTickers && activeList && activeList.symbols.length > 0) {
            this.loadSymbolsFromList(this.activeListId);
            this.tickerPanel.renderTickerList();
            await this.fetchPricesForActiveList();
        } else if (panelHasTickers) {
            await this.fetchPricesForActiveList();
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

const toastStyles = document.createElement('style');
toastStyles.textContent = `
    @keyframes wl-toast-in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes wl-toast-out { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(20px); } }
`;
document.head.appendChild(toastStyles);

if (typeof window !== 'undefined') {
    window.WatchlistManager = WatchlistManager;
}
