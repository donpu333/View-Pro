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
        this._priceLoadScheduled = false; // ← Новый флаг
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
        // Синхронизируем: панель имеет приоритет
        list.symbols = [...panelSymbols];
        this.renderCache.delete(this.activeListId);
        this.renderDropdown();
    }

    // ============================================
    // ✅ СОЗДАНИЕ СПИСКА
    // ============================================
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
    await this._initPromise;
    if (!this.lists.has(listId)) return;
    if (this.activeListId === listId) { this.closeDropdown(); return; }

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

    this.tickerPanel.state.customSymbols = [...newList.symbols];
    this.tickerPanel.tickers = [];
    this.tickerPanel.tickersMap.clear();
    this.tickerPanel.tickerElements?.clear();
    this.tickerPanel.displayedTickers = [];
    this.tickerPanel.totalItems = newList.symbols.length;
    this.tickerPanel.filterCache = null;

    const container = document.getElementById('tickerListContainer');
    if (container) { container.innerHTML = ''; container.scrollTop = 0; }

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
    }

    // ✅ Очистить кэш цен алертов
    if (window.alertLineManager) {
        window.alertLineManager._lastPrices.clear();
    }

    this.tickerPanel.renderVisibleTickers?.() || this.tickerPanel.renderTickerList();
    this.tickerPanel.updateModalCount();
    this.renderDropdown();
    this.closeDropdown();
    this.saveToStorageImmediate();

    this.tickerPanel._blockDOMUpdates = false;

    // ✅ НЕ сбрасываем движок — используем fetchPricesForActiveList
    setTimeout(() => {
        this.fetchPricesForActiveList();
    }, 500);
}
    // ============================================
    // ✅ ДОБАВЛЕНИЕ В СПИСОК
    // ============================================
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

    // ============================================
    // ✅ ЗАГРУЗКА СИМВОЛОВ (для initializeWithPriority)
 // ============================================
loadSymbolsFromList(listId) {
    const list = this.lists.get(listId);
    if (!list) return;

    console.log(`📋 Загрузка списка: ${list.name} (${list.symbols.length} шт.)`);

    // Полная очистка
    this.tickerPanel.tickers = [];
    this.tickerPanel.tickersMap.clear();
    this.tickerPanel.tickerElements?.clear();
    this.tickerPanel.displayedTickers = [];
    this.tickerPanel.totalItems = list.symbols.length;
    this.tickerPanel.filterCache = null;
    this.tickerPanel.state.customSymbols = [...list.symbols];

    const container = document.getElementById('tickerListContainer');
    if (container) { container.innerHTML = ''; container.scrollTop = 0; }

    // 🔥🔥🔥 PriceManager для подписок 🔥🔥🔥
    const pm = window.priceManagerInstance;

    // Создаём тикеры + ПОДПИСЫВАЕМ КАЖДЫЙ!
    for (const symbolKey of list.symbols) {
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
        
        // ✅✅✅ ВОТ ОН! Подписка на обновления цен!
        if (pm) {
            pm.subscribe(symbol, (price) => {
                // Обновляем ВСЕ тикеры с этим symbol (futures + spot)
                for (const [key, ticker] of this.tickerPanel.tickersMap.entries()) {
                    if (key.startsWith(symbol + ':')) {
                        if (ticker.price !== price) {
                            ticker.prevPrice = ticker.price;
                            ticker.price = price;
                        }
                    }
                }
                // Обновляем DOM
                if (!this.tickerPanel._blockDOMUpdates) {
                    this.tickerPanel.updatePriceElements?.();
                }
            });
        }
    }

    console.log(`✅ Создано ${this.tickerPanel.tickersMap.size} тикеров, ВСЕ подписаны`);

    // Виртуальный рендер
    this.tickerPanel.renderVisibleTickers?.() || this.tickerPanel.renderTickerList();
    this.tickerPanel.updateModalCount();

    // Фоновая загрузка цен (REST для первоначальных данных)
    this._schedulePriceLoadForList(list.symbols);
}

    async initializeWithPriority() {
        await this._initPromise;
        this.renderDropdown();
        
        const activeList = this.lists.get(this.activeListId);
        const panelHasTickers = this.tickerPanel.tickers.length > 0;

        console.log(`🔍 initializeWithPriority: panelHasTickers=${panelHasTickers}, listSize=${activeList?.symbols?.length||0}`);

        // Всегда загружаем если список не пустой!
        if (activeList && activeList.symbols.length > 0) {
            // Если панель пустая ИЛИ тикеры не совпадают со списком - перезагружаем
            if (!panelHasTickers || this.tickerPanel.tickers.length !== activeList.symbols.length) {
                console.log('📦 Загружаем символы из списка...');
                await this.loadSymbolsFromList(this.activeListId);
            } else {
                console.log('✅ Тикеры уже загружены, пропускаем');
                // Но всё равно планируем обновление цен
                this._schedulePriceLoadForList(activeList.symbols);
            }
        }
    }

    // ============================================
    // ✅ DROPDOWN UI
    // ============================================
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
