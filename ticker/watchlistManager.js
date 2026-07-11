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
        this._destroyed = false;
        this._outsideClickListener = null;
        this._escapeDiv = document.createElement('div');
    }

    async _waitForDBAndLoad() {
        if (!window.db || !window.dbReady) {
            console.log('⏳ WatchlistManager: жду IndexedDB...');
            await new Promise((resolve) => {
                const check = setInterval(() => {
                    if (this._destroyed) { clearInterval(check); resolve(); return; }
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
        if (this._destroyed) return;
        if (this._saveDebounceTimer) clearTimeout(this._saveDebounceTimer);
        this._saveDebounceTimer = setTimeout(() => this._saveNow(), 300);
    }

    saveToStorageImmediate() {
        if (this._destroyed) return;
        if (this._saveDebounceTimer) clearTimeout(this._saveDebounceTimer);
        this._saveNow();
    }

    async _saveNow() {
        if (!this._loaded || this._destroyed) return;
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
        return true;
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

        // Загрузка символов (без рендера)
        await this.loadSymbolsFromList(listId);

        // Восстановление сортировки – единственный рендер
        this._restoreSortForList(listId);

        this.tickerPanel.updateModalCount();
        this.renderDropdown();
        this.closeDropdown();
        this.saveToStorageImmediate();

        const loader = document.getElementById('tickerLoader');
        if (loader) loader.style.display = 'none';

        const newList = this.lists.get(listId);
        if (newList && newList.symbols.length > 0) {
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

        // Без setTimeout – сразу запрос цен
        this.fetchPricesForActiveList();
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
        }
        // Иначе оставляем текущую сортировку без изменений
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

    async fetchPricesForActiveList() {
        if (this.tickerPanel?._suppressWatchlistLoad) {
            console.log('⏸️ fetchPricesForActiveList(): ПРОПУЩЕНО');
            return false;
        }
        const activeList = this.lists.get(this.activeListId);
        if (!activeList || activeList.symbols.length === 0) return false;
        console.log(`📊 Watchlist: использую TickerPanel для загрузки цен`);
        if (this.tickerPanel?.pollRestData && !this.tickerPanel._isRestRunning) {
            this.tickerPanel.pollRestData().catch(e => console.warn('pollRestData:', e));
        }
        return true;
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
            const t = {
                symbol, price: 0, change: 0, volume: 0,
                trades: null, custom: true, prevPrice: 0,
                exchange, marketType, flag
            };
            this.tickerPanel.tickers.push(t);
            this.tickerPanel.tickersMap.set(symbolKey, t);
        }

        // Рендер здесь не вызывается! Только подготовка данных.
        this.tickerPanel.updateModalCount();
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
                // Единственный рендер с обновлением иконок сортировки
                this._restoreSortForList(this.activeListId);
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
        if (this._outsideClickListener) {
            document.removeEventListener('click', this._outsideClickListener);
        }
        this._outsideClickListener = (e) => {
            if (!container.contains(e.target)) this.closeDropdown();
        };
        document.addEventListener('click', this._outsideClickListener);
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
        this._escapeDiv.textContent = text;
        return this._escapeDiv.innerHTML;
    }

    destroy() {
        this._destroyed = true;
        if (this._saveDebounceTimer) clearTimeout(this._saveDebounceTimer);
        if (this._priceLoadTimer) clearTimeout(this._priceLoadTimer);
        if (this._outsideClickListener) {
            document.removeEventListener('click', this._outsideClickListener);
            this._outsideClickListener = null;
        }
        this.closeDropdown();
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
