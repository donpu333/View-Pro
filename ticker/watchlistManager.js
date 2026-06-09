class WatchlistManager {
    constructor(tickerPanel) {
        this.tickerPanel = tickerPanel;
        this.lists = new Map();
        this.activeListId = 'default';
        this.listOrder = ['default'];
        this.renderCache = new Map();
        this._listSorts = new Map();
        this._dropdownOpen = false;
        this._loaded = false;
        this._saveDebounceTimer = null;
        this._dbReady = false;
        this._initPromise = this._waitForDBAndLoad();
        this._switchCooldown = false;
        this._priceLoadTimer = null;
    }

    async _waitForDBAndLoad() {
        if (!window.db || !window.dbReady) {
            console.log('⏳ WatchlistManager: жду IndexedDB...');
            await new Promise((resolve) => {
                const check = setInterval(() => {
                    if (window.db && window.dbReady) { clearInterval(check); resolve(); }
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

        const activeList = this.lists.get(this.activeListId);
        if (activeList) {
            this.tickerPanel.state.customSymbols = [...activeList.symbols];
            console.log(`📦 Загружен список "${activeList.name}" с ${activeList.symbols.length} символами`);
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
        list.symbols = [...panelSymbols];
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
        await this.activateList(id);
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
        return false;
    }

   async activateList(listId) {
    if (this.tickerPanel?._suppressWatchlistLoad) {
        console.log('⏸️ activateList(): ПРОПУЩЕНО — идёт массовое добавление');
        return;
    }

    await this._initPromise;
    if (!this.lists.has(listId)) return;
    if (this.activeListId === listId) { this.closeDropdown(); return; }

    if (this.activeListId) {
        this._saveSortForList(this.activeListId);
    }

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

    console.log(`🔄 → "${newList.name}" (${newList.symbols.length} шт.)`);

    const startTime = performance.now();

    this.tickerPanel.state.customSymbols = [...newList.symbols];
    this.tickerPanel.tickers = [];
    this.tickerPanel.tickersMap.clear();
    this.tickerPanel.tickerElements?.clear();
    this.tickerPanel.renderer.displayedTickers = [];
    this.tickerPanel.renderer.totalItems = newList.symbols.length;
    this.tickerPanel.filterCache = null;

    const container = document.getElementById('tickerListContainer');
    if (container) {
        container.innerHTML = '';
        container.scrollTop = 0;
    }

    // ✅ ПРАВИЛЬНАЯ ПОДПИСКА с указанием биржи и типа рынка
    for (const symbolKey of newList.symbols) {
        const parts = symbolKey.split(':');
        if (parts.length !== 3) continue;
        const [symbol, exchange, marketType] = parts;
        const flag = this.tickerPanel.state.flags[symbolKey] || null;
        const t = { 
            symbol, price: 0, change: 0, volume: 0, 
            trades: null, custom: true, prevPrice: 0, 
            exchange, marketType, flag 
        };
        this.tickerPanel.tickers.push(t);
        this.tickerPanel.tickersMap.set(symbolKey, t);
        
        if (window.priceManagerInstance) {
            // 🔥 КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: передаём биржу и тип рынка
            window.priceManagerInstance.subscribe(
                symbol,
                (price, sym, exch, mType) => {
                    if (this.tickerPanel._onPriceUpdate) {
                        // Также передаём exch и mType для точного обновления
                        this.tickerPanel._onPriceUpdate(symbol, price, exchange, marketType);
                    }
                },
                exchange,
                marketType
            );
        }
    }

    this._restoreSortForList(listId);
    this.tickerPanel.renderTickerList();
    const renderTime = performance.now() - startTime;
    console.log(`⚡ Первичный рендер за ${renderTime.toFixed(0)}мс`);

    this.tickerPanel.updateModalCount();
    this.renderDropdown();
    this.closeDropdown();
    this.saveToStorageImmediate();

    const loader = document.getElementById('tickerLoader');
    if (loader) loader.style.display = 'none';

    if (newList.symbols.length > 0) {
        const firstKey = newList.symbols[0];
        const parts = firstKey.split(':');
        if (parts.length === 3) {
            const [symbol, exchange, marketType] = parts;
            if (this.tickerPanel.coordinator?.chartManager) {
                this.tickerPanel.coordinator.chartManager.switchSymbol(symbol, exchange, marketType);
            }
            setTimeout(() => {
                this.tickerPanel.focusOnSymbol?.(symbol, exchange, marketType);
            }, 100);
        }
    }

    setTimeout(async () => {
        console.log('⏳ Загрузка цен для списка...');
        await this.fetchPricesForActiveList();
        console.log('🔄 Пересортировка после загрузки цен...');
        this.tickerPanel.filterCache = null;
        this.tickerPanel.renderTickerList();
        console.log(`✅ Готово: ${this.tickerPanel.displayedTickers?.length} тикеров отсортировано`);
    }, 200);
}

    _saveSortForList(listId) {
        if (!this._listSorts) this._listSorts = new Map();
        this._listSorts.set(listId, {
            sortBy: this.tickerPanel.state.sortBy,
            sortDirection: this.tickerPanel.state.sortDirection
        });
        console.log('💾 Сохранено для', listId, this.tickerPanel.state.sortBy, this.tickerPanel.state.sortDirection);
    }

    _restoreSortForList(listId) {
        if (!this._listSorts) this._listSorts = new Map();
        const saved = this._listSorts.get(listId);
        console.log('🔄 Восстановление для', listId, 'найдено:', saved);
        if (saved) {
            this.tickerPanel.state.sortBy = saved.sortBy;
            this.tickerPanel.state.sortDirection = saved.sortDirection;
        } else {
            this.tickerPanel.state.sortBy = 'volume';
            this.tickerPanel.state.sortDirection = 'desc';
        }
        this.tickerPanel.filterCache = null;
        this._updateHeaderIcons();
        this.tickerPanel.renderTickerList();
        console.log('✅ После восстановления:', this.tickerPanel.state.sortBy, this.tickerPanel.state.sortDirection);
    }

    _updateHeaderIcons() {
        const sortBy = this.tickerPanel.state.sortBy;
        const sortDirection = this.tickerPanel.state.sortDirection;
        document.querySelectorAll('.table-header span[data-sort] i').forEach(icon => {
            icon.className = 'fas fa-sort';
            icon.style.display = 'inline-block';
        });
        const activeHeader = document.querySelector(`.table-header span[data-sort="${sortBy}"]`);
        if (activeHeader) {
            const icon = activeHeader.querySelector('i');
            if (icon) {
                icon.className = sortDirection === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
                if (sortBy === 'flag') {
                    icon.style.display = 'none';
                }
            }
        }
    }

    _schedulePriceLoadForList(symbols) {
        if (!symbols || symbols.length === 0) return;
        if (this._priceLoadTimer) clearTimeout(this._priceLoadTimer);
        this._priceLoadTimer = setTimeout(async () => {
            this._priceLoadTimer = null;
            if (this.tickerPanel._isRestRunning) {
                console.log('⏳ REST уже работает, не запускаем повторно');
                return;
            }
            console.log(`⚡ Планирую загрузку цен (${symbols.length} шт.)...`);
            await this.fetchPricesForActiveList();
            this.tickerPanel.filterCache = null;
            this.tickerPanel.renderTickerList();
        }, 1000);
    }

    // ============================================
    // ИСПРАВЛЕННЫЙ МЕТОД ЗАГРУЗКИ ЦЕН (без ошибки 418)
    // ============================================
   // ✅ ИСПРАВЛЕННЫЙ МЕТОД — просто скопируй и вставь ВМЕСТО старого
async fetchPricesForActiveList() {
    const activeList = this.lists.get(this.activeListId);
    if (!activeList || activeList.symbols.length === 0) return false;

    const bnFut = [], bnSpot = [], byFut = [], bySpot = [];

    activeList.symbols.forEach(key => {
        const parts = key.split(':');
        if (parts.length !== 3) return;
        const [s, ex, mt] = parts;
        if (ex === 'binance') { mt === 'futures' ? bnFut.push(s) : bnSpot.push(s); }
        else if (ex === 'bybit') { mt === 'futures' ? byFut.push(s) : bySpot.push(s); }
    });

    const BATCH = 20;
    const DELAY = 1200;
    const HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
    };

    const fetchBatch = async (url, symbolsArray, exchangeType) => {
        if (symbolsArray.length === 0) return;
        for (let i = 0; i < symbolsArray.length; i += BATCH) {
            const batch = symbolsArray.slice(i, i + BATCH);
            const symbolsJson = JSON.stringify(batch);
            const encodedSymbols = encodeURIComponent(symbolsJson);
            const fullUrl = `${url}?symbols=${encodedSymbols}`;
            try {
                const response = await fetch(fullUrl, { headers: HEADERS });
                if (response.status === 418) {
                    console.warn(`⚠️ 418 на ${url} — увеличенная задержка`);
                    await new Promise(r => setTimeout(r, 5000));
                    continue;
                }
                const data = await response.json();
                if (Array.isArray(data)) {
                    data.forEach(t => {
                        const key = `${t.symbol}:${exchangeType}`;
                        const ticker = this.tickerPanel.tickersMap.get(key);
                        if (ticker) {
                            ticker.price = +t.lastPrice;
                            ticker.change = +t.priceChangePercent;
                            ticker.volume = +t.quoteVolume;
                            ticker.trades = +t.count || 0;
                        }
                    });
                    this.tickerPanel.renderer?.updatePriceElements?.();
                }
            } catch (e) {
                console.error(`Ошибка запроса ${fullUrl}:`, e);
            }
            if (i + BATCH < symbolsArray.length) {
                await new Promise(r => setTimeout(r, DELAY));
            }
        }
    };

    if (bnFut.length) {
        await fetchBatch('https://fapi.binance.com/fapi/v1/ticker/24hr', bnFut, 'binance:futures');
    }

    if (bnFut.length && bnSpot.length) {
        await new Promise(r => setTimeout(r, 2000));
    }

    if (bnSpot.length) {
        await fetchBatch('https://api.binance.com/api/v3/ticker/24hr', bnSpot, 'binance:spot');
    }

    if ((bnFut.length || bnSpot.length) && (byFut.length || bySpot.length)) {
        await new Promise(r => setTimeout(r, 2000));
    }

    if (byFut.length) {
        try {
            const response = await fetch('https://api.bybit.com/v5/market/tickers?category=linear', { headers: HEADERS });
            const data = await response.json();
            if (data?.retCode === 0) {
                const set = new Set(byFut);
                data.result.list.forEach(t => {
                    if (set.has(t.symbol)) {
                        const ticker = this.tickerPanel.tickersMap.get(`${t.symbol}:bybit:futures`);
                        if (ticker) {
                            ticker.price = +t.lastPrice;
                            ticker.change = +(t.price24hPcnt || 0) * 100;
                            ticker.volume = +(t.volume24h || 0) * +(t.lastPrice || 0);
                        }
                    }
                });
            }
        } catch (e) {}
    }

    if (bySpot.length) {
        try {
            const response = await fetch('https://api.bybit.com/v5/market/tickers?category=spot', { headers: HEADERS });
            const data = await response.json();
            if (data?.retCode === 0) {
                const set = new Set(bySpot);
                data.result.list.forEach(t => {
                    if (set.has(t.symbol)) {
                        const ticker = this.tickerPanel.tickersMap.get(`${t.symbol}:bybit:spot`);
                        if (ticker) {
                            ticker.price = +t.lastPrice;
                            ticker.change = +(t.price24hPcnt || 0) * 100;
                            ticker.volume = +(t.volume24h || 0) * +(t.lastPrice || 0);
                        }
                    }
                });
            }
        } catch (e) {}
    }

    this.tickerPanel.renderer?.updatePriceElements?.();
    return true;
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
            if (!this.tickerPanel.tickersMap.has(key)) {
                this.tickerPanel.addSymbol(symbol, true, exchange, marketType, true, false, true);
            }
        }
        return true;
    }

    async addSymbolToActiveList(symbol, exchange, marketType) {
        return this.addSymbolToList(this.activeListId, symbol, exchange, marketType);
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
            this.tickerPanel.removeSymbol(symbol, exchange, marketType);
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
        this.tickerPanel.clearAllSymbols();
    }

    loadSymbolsFromList(listId) {
        const list = this.lists.get(listId);
        if (!list) return;

        console.log(`📋 Загрузка списка: ${list.name}`);

        this.tickerPanel.tickers = [];
        this.tickerPanel.tickersMap.clear();
        this.tickerPanel.tickerElements?.clear();
        this.tickerPanel.renderer.displayedTickers = [];
        this.tickerPanel.renderer.totalItems = list.symbols.length;
        this.tickerPanel.filterCache = null;
        this.tickerPanel.state.customSymbols = [...list.symbols];

        const container = document.getElementById('tickerListContainer');
        if (container) { container.innerHTML = ''; container.scrollTop = 0; }

        for (const symbolKey of list.symbols) {
            const parts = symbolKey.split(':');
            if (parts.length !== 3) continue;
            const [symbol, exchange, marketType] = parts;
            const flag = this.tickerPanel.state.flags[symbolKey] || null;
            const t = { symbol, price: 0, change: 0, volume: 0, trades: null, custom: true, prevPrice: 0, exchange, marketType, flag };
            this.tickerPanel.tickers.push(t);
            this.tickerPanel.tickersMap.set(symbolKey, t);
        }

        this.tickerPanel.renderTickerList();
        this.tickerPanel.updateModalCount();

        setTimeout(async () => {
            console.log('⏳ Загрузка цен для списка...');
            await this.fetchPricesForActiveList();
            console.log('🔄 Пересортировка после загрузки цен...');
            this.tickerPanel.filterCache = null;
            this.tickerPanel.renderTickerList();
            console.log(`✅ Готово: ${this.tickerPanel.displayedTickers?.length} тикеров отсортировано`);
        }, 200);
    }

    async initializeWithPriority() {
        await this._initPromise;
        this.renderDropdown();
        const activeList = this.lists.get(this.activeListId);
        const panelHasTickers = this.tickerPanel.tickers.length > 0;
        console.log(`🔍 initializeWithPriority: panelHasTickers=${panelHasTickers}, listSize=${activeList?.symbols?.length||0}`);
        if (activeList && activeList.symbols.length > 0) {
            if (!panelHasTickers || this.tickerPanel.tickers.length !== activeList.symbols.length) {
                console.log('📦 Загружаем символы из списка...');
                await this.loadSymbolsFromList(this.activeListId);
            } else {
                console.log('✅ Тикеры уже загружены, пропускаем');
                this._schedulePriceLoadForList(activeList.symbols);
            }
        }
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
                <div class="wl-dropdown-item wl-add-item" data-action="add">+ Создать новый список</div>
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
