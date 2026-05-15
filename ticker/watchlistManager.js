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

    // ============================================
    // ✅✅✅ ПЕРЕКЛЮЧЕНИЕ (ВИРТУАЛЬНЫЙ СКРОЛЛ + ФОНОВАЯ ЗАГРУЗКА) ✅✅✅
    // ============================================
    async activateList(listId) {
        await this._initPromise;
        if (!this.lists.has(listId)) return;
        if (this.activeListId === listId) { this.closeDropdown(); return; }

        // Сохраняем текущий
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

        // ============================================
        // 1. ПОЛНАЯ ОЧИСТКА
        // ============================================
        this.tickerPanel.state.customSymbols = [...newList.symbols];
        this.tickerPanel.tickers = [];
        this.tickerPanel.tickersMap.clear();
        this.tickerPanel.tickerElements?.clear();
        this.tickerPanel.displayedTickers = [];
        this.tickerPanel.totalItems = newList.symbols.length;
        this.tickerPanel.filterCache = null;

        const container = document.getElementById('tickerListContainer');
        if (container) {
            container.innerHTML = '';
            container.scrollTop = 0;
        }

        // ============================================
        // 2. БЫСТРОЕ СОЗДАНИЕ ТИКЕРОВ (без DOM)
        // ============================================
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
            
            // Подписка на WS
            if (window.priceManagerInstance) {
                window.priceManagerInstance.subscribe(symbol, (price) => {
                    if (this.tickerPanel._onPriceUpdate) {
                        this.tickerPanel._onPriceUpdate(symbol, price);
                    }
                });
            }
        }

        // ============================================
        // 3. ВИРТУАЛЬНЫЙ РЕНДЕР (только видимые!)
        // ============================================
        this.tickerPanel.renderVisibleTickers?.() || this.tickerPanel.renderTickerList();
        
        const renderTime = performance.now() - startTime;
        console.log(`⚡ Рендер за ${renderTime.toFixed(0)}мс`);

        // ============================================
        // 4. UI обновления
        // ============================================
        this.tickerPanel.updateModalCount();
        this.renderDropdown();
        this.closeDropdown();
        this.saveToStorageImmediate();

        // Скрываем лоадер если был
        const loader = document.getElementById('tickerLoader');
        if (loader) loader.style.display = 'none';

        // ============================================
        // 5. ✅✅✅ ФОНОВАЯ ЗАГРУЗКА ЦЕН (пакетами!) ✅✅✅
        // ============================================
        setTimeout(() => {
    this.fetchPricesForActiveList();
}, 200);
    }

  

_schedulePriceLoadForList(symbols) {
    if (!symbols || symbols.length === 0) return;
    
    // ✅ Защита от множественных вызовов
    if (this._priceLoadTimer) {
        clearTimeout(this._priceLoadTimer);
    }
    
    this._priceLoadTimer = setTimeout(async () => {
        this._priceLoadTimer = null;
        
        // ✅ Проверяем что не запущено
        if (this.tickerPanel._isRestRunning) {
            console.log('⏳ REST уже работает, не запускаем повторно');
            return;
        }
        
        console.log(`⚡ Планирую загрузку цен (${symbols.length} шт.)...`);
        
        if (this.tickerPanel.pollRestData) {
            await this.tickerPanel.pollRestData();
        }
        
    }, 1000); // 1 секунда debounce
}
    // ============================================
    // ✅ ЗАГРУЗКА ЦЕН (Fallback)
    // ============================================
    async fetchPricesForActiveList() {
        const activeList = this.lists.get(this.activeListId);
        if (!activeList || activeList.symbols.length === 0) return;

        const bnFut = [], bnSpot = [], byFut = [], bySpot = [];

        activeList.symbols.forEach(key => {
            const parts = key.split(':');
            if (parts.length !== 3) return;
            const [s, ex, mt] = parts;
            if (ex === 'binance') { mt === 'futures' ? bnFut.push(s) : bnSpot.push(s); }
            else if (ex === 'bybit') { mt === 'futures' ? byFut.push(s) : bySpot.push(s); }
        });

        const BATCH = 25;
        const DELAY = 800;

        // Binance Futures
        for (let i = 0; i < bnFut.length; i += BATCH) {
            const batch = bnFut.slice(i, i + BATCH);
            try {
                const r = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbols=[${batch.map(s=>`"${s}"`).join(',')}]`);
                const d = await r.json();
                if (Array.isArray(d)) d.forEach(t => {
                    const tk = this.tickerPanel.tickersMap.get(`${t.symbol}:binance:futures`);
                    if (tk) { tk.price=+t.lastPrice; tk.change=+t.priceChangePercent; tk.volume=+t.quoteVolume; tk.trades=+t.count||0; }
                });
                this.tickerPanel.renderer?.updatePriceElements?.();
            } catch(e){}
            if (i+BATCH < bnFut.length) await new Promise(r=>setTimeout(r, DELAY));
        }

        // Binance Spot
        if (bnFut.length>0 && bnSpot.length>0) await new Promise(r=>setTimeout(r, 1500));
        
        for (let i = 0; i < bnSpot.length; i += BATCH) {
            const batch = bnSpot.slice(i, i + BATCH);
            try {
                const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=[${batch.map(s=>`"${s}"`).join(',')}]`);
                const d = await r.json();
                if (Array.isArray(d)) d.forEach(t => {
                    const tk = this.tickerPanel.tickersMap.get(`${t.symbol}:binance:spot`);
                    if (tk) { tk.price=+t.lastPrice; tk.change=+t.priceChangePercent; tk.volume=+t.quoteVolume; tk.trades=+t.count||0; }
                });
                this.tickerPanel.renderer?.updatePriceElements?.();
            } catch(e){}
            if (i+BATCH < bnSpot.length) await new Promise(r=>setTimeout(r, DELAY));
        }

        // Bybit
        if ((bnFut.length>0||bnSpot.length>0) && (byFut.length>0||bySpot.length>0)) 
            await new Promise(r=>setTimeout(r, 1000));

        if (byFut.length>0) {
            try {
                const r = await fetch('https://api.bybit.com/v5/market/tickers?category=linear');
                const d = await r.json();
                if (d?.retCode===0) {
                    const set = new Set(byFut);
                    d.result.list.forEach(t => {
                        if (set.has(t.symbol)) {
                            const tk = this.tickerPanel.tickersMap.get(`${t.symbol}:bybit:futures`);
                            if (tk) { tk.price=+t.lastPrice; tk.change=+(t.price24hPcnt||0)*100; tk.volume=+(t.volume24h||0)*+(t.lastPrice||0); }
                        }
                    });
                }
            } catch(e){}
        }

        if (bySpot.length>0) {
            try {
                const r = await fetch('https://api.bybit.com/v5/market/tickers?category=spot');
                const d = await r.json();
                if (d?.retCode===0) {
                    const set = new Set(bySpot);
                    d.result.list.forEach(t => {
                        if (set.has(t.symbol)) {
                            const tk = this.tickerPanel.tickersMap.get(`${t.symbol}:bybit:spot`);
                            if (tk) { tk.price=+t.lastPrice; tk.change=+(t.price24hPcnt||0)*100; tk.volume=+(t.volume24h||0)*+(t.lastPrice||0); }
                        }
                    });
                }
            } catch(e){}
        }

        this.tickerPanel.renderer?.updatePriceElements?.();
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

        console.log(`📋 Загрузка списка: ${list.name}`);

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

        // Создаём тикеры
        for (const symbolKey of list.symbols) {
            const parts = symbolKey.split(':');
            if (parts.length !== 3) continue;
            const [symbol, exchange, marketType] = parts;
            
            const flag = this.tickerPanel.state.flags[symbolKey] || null;
            const t = { symbol, price: 0, change: 0, volume: 0, trades: null, custom: true, prevPrice: 0, exchange, marketType, flag };
            this.tickerPanel.tickers.push(t);
            this.tickerPanel.tickersMap.set(symbolKey, t);
        }

        // Виртуальный рендер
        this.tickerPanel.renderVisibleTickers?.() || this.tickerPanel.renderTickerList();
        this.tickerPanel.updateModalCount();

        // Фоновая загрузка цен
        this._schedulePriceLoadForList(list.symbols);
    }

    // ============================================
    // ✅ ИНИЦИАЛИЗАЦИЯ
    // ============================================
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
