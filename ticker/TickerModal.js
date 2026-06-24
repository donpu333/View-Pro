class TickerModal {
    constructor(parent) {
        this.parent = parent;
        this.searchTimeout = null;
        this.modalAllResults = [];

        // 🇷🇺→🇬🇧 Карта раскладки
        this.layoutMap = {
            'й': 'q', 'ц': 'w', 'у': 'e', 'к': 'r', 'е': 't', 'н': 'y', 'г': 'u',
            'ш': 'i', 'щ': 'o', 'з': 'p', 'х': '[', 'ъ': ']',
            'ф': 'a', 'ы': 's', 'в': 'd', 'а': 'f', 'п': 'g', 'р': 'h',
            'о': 'j', 'л': 'k', 'д': 'l', 'ж': ';', 'э': "'",
            'я': 'z', 'ч': 'x', 'с': 'c', 'м': 'v', 'и': 'b', 'т': 'n',
            'ь': 'm', 'б': ',', 'ю': '.', 'ё': '`'
        };
    }

    // =========================================================================
    // 🎯 ГЛАВНЫЙ МЕТОД - setupModal()
    // =========================================================================
    setupModal() {
        const modal = document.getElementById('addInstrumentModal');
        const openBtn = document.getElementById('addInstrumentBtn');
        const closeBtn = document.getElementById('modalClose');
        const modalSearch = document.getElementById('modalSearchInput');
        const modalBinanceBtn = document.getElementById('modalBinanceBtn');
        const modalBybitBtn = document.getElementById('modalBybitBtn');
        const modalFuturesBtn = document.getElementById('modalFuturesBtn');
        const modalSpotBtn = document.getElementById('modalSpotBtn');
        const modalAddAllBtn = document.getElementById('modalAddAllBtn');

        // ❌ Убрана замена через cloneNode — проблема решена
        // ✅ Создаём кнопку очистки (один раз)
        this.createClearButton(modalSearch);

        // ✅ Вешаем слушатели ввода (только input + спецклавиши)
        this.setupSearchListeners(modalSearch);

        // Открытие модального окна
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                // ✅ Проверка готовности данных перед открытием
                if (!this.parent.allBinanceFutures?.length && !this.parent.allBybitFutures?.length) {
                    this._showNotification('⏳ Данные ещё загружаются, подождите...', '#ff9800');
                    return;
                }

                this.parent.state.modalExchange = 'binance';
                this.parent.state.modalMarketType = 'futures';
                this.parent.state.modalSearchQuery = '';
                this.parent.state.modalPage = 0;

                const input = document.getElementById('modalSearchInput');
                if (input) input.value = '';

                this.toggleClearBtn();
                this.updateModalButtons();
                modal.classList.add('show');
                input?.focus();
                this.parent.updateModalCount();
                this.updateModalResults(true);
            });
        }

        // Закрытие модального окна
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.closeModal(modal, modalAddAllBtn);
            });
        }

        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(modal, modalAddAllBtn);
                }
            });
        }

        // Глобальные клавиши: Escape / Enter
        document.addEventListener('keydown', (e) => {
            if (!modal || !modal.classList.contains('show')) return;

            if (e.key === 'Escape') {
                const activeEl = document.activeElement;
                if (activeEl && activeEl.id === 'modalSearchInput' && activeEl.value.length > 0) {
                    e.preventDefault();
                    activeEl.value = '';
                    this.parent.state.modalSearchQuery = '';
                    this.parent.state.modalPage = 0;
                    this.toggleClearBtn();
                    this.updateModalResults(true);
                    return;
                }
                this.closeModal(modal, modalAddAllBtn);
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                const firstItem = document.querySelector('.modal-result-item:not(.added)');
                if (firstItem) {
                    const symbol = firstItem.dataset.symbol;
                    const exchange = firstItem.dataset.exchange;
                    const marketType = firstItem.dataset.marketType;

                    if (this.parent.addSymbol(symbol, true, exchange, marketType)) {
                        this.parent.updateModalCount();
                        this.updateModalResults(true);
                        this.parent.filterCache = null;
                        this.parent.renderTickerList();

                        if (e.shiftKey && modal) {
                            modal.classList.remove('show');
                        }
                    }
                }
            }
        });

        // Переключение бирж
        modalBinanceBtn?.addEventListener('click', () => {
            this.parent.state.modalExchange = 'binance';
            this.parent.state.modalPage = 0;
            this.updateModalButtons();
            this.parent.updateModalCount();
            this.updateModalResults(true);
        });
        modalBybitBtn?.addEventListener('click', () => {
            this.parent.state.modalExchange = 'bybit';
            this.parent.state.modalPage = 0;
            this.updateModalButtons();
            this.parent.updateModalCount();
            this.updateModalResults(true);
        });

        // Переключение типа рынка
        modalFuturesBtn?.addEventListener('click', () => {
            this.parent.state.modalMarketType = 'futures';
            this.parent.state.modalPage = 0;
            this.updateModalButtons();
            this.parent.updateModalCount();
            this.updateModalResults(true);
        });
        modalSpotBtn?.addEventListener('click', () => {
            this.parent.state.modalMarketType = 'spot';
            this.parent.state.modalPage = 0;
            this.updateModalButtons();
            this.parent.updateModalCount();
            this.updateModalResults(true);
        });

        // Кнопка "Добавить все"
        if (modalAddAllBtn) {
            modalAddAllBtn.addEventListener('click', async () => {
                if (this.parent.state.isAddingAllInProgress) return;

                const cache = this.parent.state.modalExchange === 'binance'
                    ? this.parent.binanceSymbolsCache
                    : this.parent.bybitSymbolsCache;

                const allPairs = cache.filter(s =>
                    s.exchange === this.parent.state.modalExchange &&
                    s.marketType === this.parent.state.modalMarketType &&
                    s.symbol?.endsWith('USDT')
                );

                if (allPairs.length === 0) return;

                this.parent.state.isAddingAllInProgress = true;
                this.parent.state.addingAllOffset = 0;
                modalAddAllBtn.classList.add('loading');
                modalAddAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Загрузка...';

                this.addNextBatch();
            });
        }
    }

    // =========================================================================
    // ✕ СОЗДАНИЕ КНОПКИ ОЧИСТКИ (CSS-классы, без инлайнов)
    // =========================================================================
    createClearButton(modalSearch) {
        if (!modalSearch) return;

        const searchWrapper = modalSearch.parentElement || modalSearch.closest('.modal-search-wrapper');
        if (!searchWrapper || document.getElementById('searchClearBtn')) return;

        searchWrapper.classList.add('modal-search-wrapper');
        modalSearch.classList.add('modal-search-input');

        const clearBtn = document.createElement('button');
        clearBtn.id = 'searchClearBtn';
        clearBtn.type = 'button';
        clearBtn.innerHTML = '✕';
        clearBtn.title = 'Очистить поиск';
        clearBtn.setAttribute('aria-label', 'Очистить поле поиска');
        clearBtn.className = 'search-clear-btn';

        clearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const input = document.getElementById('modalSearchInput');
            if (input) {
                input.value = '';
                this.parent.state.modalSearchQuery = '';
                this.parent.state.modalPage = 0;
                clearBtn.classList.remove('visible');
                input.focus();
                this.updateModalResults(true);
            }
        });

        searchWrapper.appendChild(clearBtn);
    }

    // =========================================================================
    // ⌨️ СЛУШАТЕЛИ ВВОДА (только input + клавиши удаления)
    // =========================================================================
    setupSearchListeners(modalSearch) {
        if (!modalSearch) return;

        // Главный обработчик ввода: конвертация и поиск
        modalSearch.addEventListener('input', (e) => {
            const input = e.target;
            const cursorPos = input.selectionStart;
            let val = input.value;
            let converted = '';

            for (const c of val) {
                const lowerC = c.toLowerCase();
                if (this.layoutMap[lowerC]) {
                    converted += this.layoutMap[lowerC].toUpperCase();
                } else {
                    converted += c.toUpperCase();
                }
            }

            if (converted !== val) {
                input.value = converted;
                input.setSelectionRange(cursorPos, cursorPos);
            }

            this.toggleClearBtn();
            this.triggerSearch(input.value);
        });

        // Клавиши удаления — для актуализации кнопки очистки
        modalSearch.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' || e.key === 'Delete') {
                setTimeout(() => this.toggleClearBtn(), 0);
            }
        });
    }

    // =========================================================================
    // 🔍 ТРИГГЕР ПОИСКА (с debounce и индикатором)
    // =========================================================================
    triggerSearch(query) {
        this.parent.state.modalSearchQuery = query;
        this.parent.state.modalPage = 0;

        const resultsContainer = document.getElementById('modalResults');
        if (resultsContainer) resultsContainer.classList.add('loading');

        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            this.updateModalResults(true);
            if (resultsContainer) resultsContainer.classList.remove('loading');
        }, 300);
    }

    // =========================================================================
    // ✕ ПОКАЗАТЬ/СКРЫТЬ КНОПКУ ОЧИСТКИ
    // =========================================================================
    toggleClearBtn() {
        const input = document.getElementById('modalSearchInput');
        const btn = document.getElementById('searchClearBtn');
        if (input && btn) {
            btn.classList.toggle('visible', input.value.length > 0);
        }
    }

    // =========================================================================
    // 🔒 ЗАКРЫТИЕ МОДАЛЬНОГО ОКНА (с очисткой скролла)
    // =========================================================================
    closeModal(modal, modalAddAllBtn) {
        if (modal) {
            modal.classList.remove('show');
        }

        // Удаляем обработчик бесконечного скролла
        const resultsContainer = document.getElementById('modalResults');
        if (resultsContainer?._scrollHandler) {
            resultsContainer.removeEventListener('scroll', resultsContainer._scrollHandler);
            delete resultsContainer._scrollHandler;
        }

        this.parent.state.isAddingAllInProgress = false;
        this.parent.state.addingAllOffset = 0;

        if (modalAddAllBtn) {
            modalAddAllBtn.classList.remove('loading');
            modalAddAllBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Добавить все';
        }
    }

    // =========================================================================
    // 🚀 ДОБАВЛЕНИЕ ВСЕХ ИНСТРУМЕНТОВ (batch)
    // =========================================================================
    async addNextBatch() {
        if (!this.parent.state.isAddingAllInProgress) return;

        const modalAddAllBtn = document.getElementById('modalAddAllBtn');

        let source;
        if (this.parent.state.modalExchange === 'binance') {
            source = this.parent.state.modalMarketType === 'futures'
                ? this.parent.allBinanceFutures
                : this.parent.allBinanceSpot;
        } else {
            source = this.parent.state.modalMarketType === 'futures'
                ? this.parent.allBybitFutures
                : this.parent.allBybitSpot;
        }

        let allPairs = [...source];

        if (this.parent.state.modalSearchQuery) {
            const query = this.parent.state.modalSearchQuery.toUpperCase();
            allPairs = allPairs.filter(s => s.symbol.includes(query));
        }

        console.log(`📊 Добавление всех: найдено ${allPairs.length} символов`);

        if (allPairs.length === 0) return;

        this.parent.state.isAddingAllInProgress = true;
        this.parent.state.addingAllOffset = 0;

        if (modalAddAllBtn) {
            modalAddAllBtn.classList.add('loading');
            modalAddAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Загрузка...';
        }

        this._doAddNextBatch(allPairs);
    }

    async _doAddNextBatch(allPairs) {
        if (!this.parent.state.isAddingAllInProgress) return;

        const batchSize = 20;
        const start = this.parent.state.addingAllOffset;
        const end = Math.min(start + batchSize, allPairs.length);

        if (start === 0) {
            console.log('🛡️ ВКЛЮЧЕНА ЗАЩИТА от лишних запросов к API');
            this.parent._isBulkAdding = true;
            this.parent._suppressWatchlistLoad = true;
            this._startTime = Date.now();
        }

        for (let i = start; i < end; i++) {
            const item = allPairs[i];
            if (item && item.symbol) {
                this.parent.addSymbol(
                    item.symbol,
                    true,
                    item.exchange,
                    item.marketType,
                    false,
                    true,
                    true
                );
            }
        }

        this.parent.state.addingAllOffset = end;

        const btn = document.getElementById('modalAddAllBtn');
        if (btn) {
            const progress = Math.round((end / allPairs.length) * 100);
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${end}/${allPairs.length} (${progress}%)`;
        }

        if (end < allPairs.length) {
            setTimeout(() => this._doAddNextBatch(allPairs), 80);
        } else {
            console.log(`📦 Все символы добавлены в память за ${Date.now() - this._startTime}ms`);
            this.parent._isBulkAdding = false;
            await this._finalizeAddAllFixed(allPairs);
            setTimeout(() => {
                this.parent._suppressWatchlistLoad = false;
                console.log('🛡️ Защита ОТКЛЮЧЕНА. WatchlistManager снова активен.');
            }, 3000);
        }
    }

    async _finalizeAddAllFixed(allPairs) {
        console.log(`✅ В памяти: ${this.parent.tickersMap.size} тикеров`);

        this.parent.state.isAddingAllInProgress = false;

        const btn = document.getElementById('modalAddAllBtn');
        if (btn) {
            btn.classList.remove('loading');
            btn.innerHTML = '<i class="fas fa-plus-circle"></i> Добавить все';
        }

        this.parent.filterCache = null;
        this.parent.renderTickerList();

        this._showNotification(`⏳ Синхронизация...`, '#ffa500');

        const wm = this.parent.watchlistManager;
        if (wm) {
            const activeList = wm.lists.get(wm.activeListId);
            if (activeList) {
                activeList.symbols = [];
                for (const [key] of this.parent.tickersMap.entries()) {
                    activeList.symbols.push(key);
                }
                this.parent.state.customSymbols = [...activeList.symbols];
                console.log(`📝 Вотчлист: ${activeList.symbols.length} символов (без дублей!)`);
                wm.saveToStorage();
                wm.renderDropdown();
            }
        } else {
            this.parent.state.customSymbols = [];
            for (const [key] of this.parent.tickersMap.entries()) {
                this.parent.state.customSymbols.push(key);
            }
        }

        this.parent.saveState();

        const counterSpan = document.getElementById('modalFoundCount');
        if (counterSpan) counterSpan.textContent = this.parent.tickersMap.size;

        await new Promise(r => setTimeout(r, 1000));
        await this._safeLoadPricesFixed();
    }

    async _safeLoadPricesFixed() {
        const total = this.parent.tickersMap.size;
        if (total === 0) {
            console.log('⚠️ Нет тикеров для загрузки');
            return;
        }

        this._showNotification(`⏳ Загрузка цен для ${total} символов...`, '#ffa500');
        console.log(`📊 Начинаем загрузку цен для ${total} тикеров...`);

        const groups = { bnFut: [], bnSpot: [], byFut: [], bySpot: [] };
        for (const [, ticker] of this.parent.tickersMap.entries()) {
            if (ticker.exchange === 'binance' && ticker.marketType === 'futures') {
                groups.bnFut.push(ticker.symbol);
            } else if (ticker.exchange === 'binance' && ticker.marketType === 'spot') {
                groups.bnSpot.push(ticker.symbol);
            } else if (ticker.exchange === 'bybit' && ticker.marketType === 'futures') {
                groups.byFut.push(ticker.symbol);
            } else if (ticker.exchange === 'bybit' && ticker.marketType === 'spot') {
                groups.bySpot.push(ticker.symbol);
            }
        }

        console.log(`   Binance Futures: ${groups.bnFut.length}`);
        console.log(`   Binance Spot: ${groups.bnSpot.length}`);
        console.log(`   Bybit Futures: ${groups.byFut.length}`);
        console.log(`   Bybit Spot: ${groups.bySpot.length}`);

        const BATCH_SIZE = 80;
        const DELAY_BETWEEN_BATCHES = 2000;
        let loaded = 0;

        try {
            if (groups.bnFut.length > 0) {
                for (let i = 0; i < groups.bnFut.length; i += BATCH_SIZE) {
                    const batch = groups.bnFut.slice(i, i + BATCH_SIZE);
                    await this._fetchBinance24hSafe(batch, 'futures');
                    loaded += batch.length;
                    const pct = Math.round((loaded / total) * 100);
                    this._showNotification(`⏳ ${loaded}/${total} (${pct}%)`, '#ffa500');
                    if (i + BATCH_SIZE < groups.bnFut.length) {
                        await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
                    }
                }
            }

            if (groups.bnFut.length > 0 && groups.bnSpot.length > 0) {
                await new Promise(r => setTimeout(r, 2000));
            }

            if (groups.bnSpot.length > 0) {
                for (let i = 0; i < groups.bnSpot.length; i += BATCH_SIZE) {
                    const batch = groups.bnSpot.slice(i, i + BATCH_SIZE);
                    await this._fetchBinance24hSafe(batch, 'spot');
                    loaded += batch.length;
                    const pct = Math.round((loaded / total) * 100);
                    this._showNotification(`⏳ ${loaded}/${total} (${pct}%)`, '#ffa500');
                    if (i + BATCH_SIZE < groups.bnSpot.length) {
                        await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
                    }
                }
            }

            const hasBinance = groups.bnFut.length > 0 || groups.bnSpot.length > 0;
            const hasBybit = groups.byFut.length > 0 || groups.bySpot.length > 0;
            if (hasBinance && hasBybit) {
                await new Promise(r => setTimeout(r, 3000));
            }

            if (groups.byFut.length > 0) {
                await this._fetchBybit24hSafe(groups.byFut, 'futures');
                loaded += groups.byFut.length;
                const pct = Math.round((loaded / total) * 100);
                this._showNotification(`⏳ ${loaded}/${total} (${pct}%)`, '#ffa500');
                if (groups.bySpot.length > 0) {
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            if (groups.bySpot.length > 0) {
                await this._fetchBybit24hSafe(groups.bySpot, 'spot');
                loaded += groups.bySpot.length;
            }

            this.parent.renderer?.updatePriceElements?.();
            this.parent.renderTickerList();

            this._showNotification(`✅ Готово! Загружено ${loaded} символов`, '#4caf50');

            setTimeout(() => {
                const notif = document.getElementById('alertNotification');
                if (notif) notif.style.display = 'none';
            }, 3000);

        } catch (error) {
            console.error('❌ Ошибка загрузки цен:', error);
            this._showNotification(`❌ Ошибка: ${error.message}`, '#f23645');
        }
    }

    async _fetchBinance24hSafe(symbols, marketType) {
        if (!symbols || symbols.length === 0) return;
        const symbolsParam = symbols.map(s => `"${s}"`).join(',');
        const url = marketType === 'futures'
            ? `https://fapi.binance.com/fapi/v1/ticker/24hr?symbols=[${symbolsParam}]`
            : `https://api.binance.com/api/v3/ticker/24hr?symbols=[${symbolsParam}]`;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) return;
            const data = await response.json();
            if (Array.isArray(data)) {
                data.forEach(t => this.parent._updateTickerFromBinance(t, marketType));
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn(`⏰ Binance ${marketType}: таймаут`);
            } else {
                console.warn(`⚠️ Binance ${marketType} error:`, error.message);
            }
        }
    }

    async _fetchBybit24hSafe(symbols, marketType) {
        if (!symbols || symbols.length === 0) return;
        const category = marketType === 'futures' ? 'linear' : 'spot';
        const url = `https://api.bybit.com/v5/market/tickers?category=${category}`;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) return;
            const data = await response.json();
            if (data.retCode === 0 && data.result?.list) {
                const symbolSet = new Set(symbols);
                data.result.list.forEach(t => {
                    if (symbolSet.has(t.symbol)) {
                        this.parent._updateTickerFromBybit(t, marketType);
                    }
                });
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn(`⏰ Bybit ${marketType}: таймаут`);
            } else {
                console.warn(`⚠️ Bybit ${marketType} error:`, error.message);
            }
        }
    }

    async _safeBulkLoadPrices(allPairs) {
        const groups = { bnFut: [], bnSpot: [], byFut: [], bySpot: [] };
        allPairs.forEach(item => {
            if (item.exchange === 'binance' && item.marketType === 'futures') groups.bnFut.push(item.symbol);
            else if (item.exchange === 'binance' && item.marketType === 'spot') groups.bnSpot.push(item.symbol);
            else if (item.exchange === 'bybit' && item.marketType === 'futures') groups.byFut.push(item.symbol);
            else if (item.exchange === 'bybit' && item.marketType === 'spot') groups.bySpot.push(item.symbol);
        });

        const BINANCE_BATCH = 80;
        const DELAY_BETWEEN_BATCHES = 2000;
        const DELAY_AFTER_BINANCE = 3000;

        let loaded = 0;
        const total = allPairs.length;

        for (let i = 0; i < groups.bnFut.length; i += BINANCE_BATCH) {
            const batch = groups.bnFut.slice(i, i + BINANCE_BATCH);
            await this._fetchBinance24h(batch, 'futures');
            loaded += batch.length;
            this._showNotification(`⏳ Binance F: ${loaded}/${total}`, '#ffa500');
            if (i + BINANCE_BATCH < groups.bnFut.length) {
                await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
            }
        }

        if (groups.bnFut.length > 0 && groups.bnSpot.length > 0) {
            await new Promise(r => setTimeout(r, 2000));
        }

        for (let i = 0; i < groups.bnSpot.length; i += BINANCE_BATCH) {
            const batch = groups.bnSpot.slice(i, i + BINANCE_BATCH);
            await this._fetchBinance24h(batch, 'spot');
            loaded += batch.length;
            this._showNotification(`⏳ Binance S: ${loaded}/${total}`, '#ffa500');
            if (i + BINANCE_BATCH < groups.bnSpot.length) {
                await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
            }
        }

        if ((groups.bnFut.length > 0 || groups.bnSpot.length > 0) &&
            (groups.byFut.length > 0 || groups.bySpot.length > 0)) {
            await new Promise(r => setTimeout(r, DELAY_AFTER_BINANCE));
        }

        if (groups.byFut.length > 0) {
            await this._fetchBybit24h(groups.byFut, 'futures');
            loaded += groups.byFut.length;
            this._showNotification(`⏳ Bybit F: ${loaded}/${total}`, '#ffa500');
            await new Promise(r => setTimeout(r, 2000));
        }

        if (groups.bySpot.length > 0) {
            await this._fetchBybit24h(groups.bySpot, 'spot');
            loaded += groups.bySpot.length;
            this._showNotification(`⏳ Bybit S: ${loaded}/${total}`, '#ffa500');
        }

        this.parent.renderer?.updatePriceElements?.();
        this.parent.renderTickerList();

        this._showNotification(`✅ Загружено ${loaded} символов!`, '#4caf50');

        setTimeout(() => {
            const notif = document.getElementById('alertNotification');
            if (notif) notif.style.display = 'none';
        }, 3000);
    }

    async _fetchBinance24h(symbols, marketType) {
        if (symbols.length === 0) return;
        const symbolsParam = symbols.map(s => `"${s}"`).join(',');
        const url = marketType === 'futures'
            ? `https://fapi.binance.com/fapi/v1/ticker/24hr?symbols=[${symbolsParam}]`
            : `https://api.binance.com/api/v3/ticker/24hr?symbols=[${symbolsParam}]`;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data)) {
                    data.forEach(t => this.parent._updateTickerFromBinance(t, marketType));
                }
            }
        } catch (e) {
            console.warn(`⚠️ Ошибка Binance ${marketType}:`, e.message);
        }
    }

    async _fetchBybit24h(symbols, marketType) {
        if (symbols.length === 0) return;
        const category = marketType === 'futures' ? 'linear' : 'spot';
        const url = `https://api.bybit.com/v5/market/tickers?category=${category}`;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 20000);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            if (response.ok) {
                const data = await response.json();
                if (data.retCode === 0 && data.result?.list) {
                    const symbolSet = new Set(symbols);
                    data.result.list.forEach(t => {
                        if (symbolSet.has(t.symbol)) {
                            this.parent._updateTickerFromBybit(t, marketType);
                        }
                    });
                }
            }
        } catch (e) {
            console.warn(`⚠️ Ошибка Bybit ${marketType}:`, e.message);
        }
    }

    _showNotification(message, color = '#666') {
        const notif = document.getElementById('alertNotification');
        if (notif) {
            notif.innerHTML = `<div>${message}</div>`;
            notif.style.display = 'block';
            notif.style.borderLeftColor = color;
        }
    }

    // =========================================================================
    // 📋 ОБНОВЛЕНИЕ РЕЗУЛЬТАТОВ ПОИСКА
    // =========================================================================
    updateModalResults(reset = false) {
        const resultsContainer = document.getElementById('modalResults');
        if (!resultsContainer) return;

        if (reset) {
            this.parent.state.modalPage = 0;
        }

        let source;
        if (this.parent.state.modalExchange === 'binance') {
            source = this.parent.state.modalMarketType === 'futures'
                ? this.parent.allBinanceFutures
                : this.parent.allBinanceSpot;
        } else {
            source = this.parent.state.modalMarketType === 'futures'
                ? this.parent.allBybitFutures
                : this.parent.allBybitSpot;
        }

        if (!source || source.length === 0) {
            resultsContainer.innerHTML = '<div class="no-results">Загрузка данных...</div>';
            return;
        }

        let filteredResults = [...source];
        if (this.parent.state.modalSearchQuery) {
            const query = this.parent.state.modalSearchQuery.toUpperCase();
            filteredResults = filteredResults.filter(s => s.symbol.startsWith(query));
        }

        this.modalAllResults = filteredResults;

        const foundSpan = document.getElementById('modalFoundCount');
        if (foundSpan) foundSpan.textContent = filteredResults.length;

        const pageSize = this.parent.state.modalPageSize || 50;
        const startIndex = reset ? 0 : this.parent.state.modalPage * pageSize;
        const endIndex = Math.min(startIndex + pageSize, filteredResults.length);

        if (filteredResults.length === 0) {
            resultsContainer.innerHTML = '<div class="no-results">Инструменты не найдены</div>';
            return;
        }

        const pageResults = filteredResults.slice(startIndex, endIndex);
        if (!reset && startIndex < filteredResults.length) {
            this.parent.state.modalPage++;
        }

        this.renderModalResults(pageResults, !reset && startIndex > 0);
    }

    // =========================================================================
    // 🎨 РЕНДЕРИНГ РЕЗУЛЬТАТОВ (оптимизирован)
    // =========================================================================
    renderModalResults(results, append = false) {
        const resultsContainer = document.getElementById('modalResults');
        if (!resultsContainer) return;

        if (!append && results.length === 0) {
            resultsContainer.innerHTML = '<div class="no-results">Инструменты не найдены</div>';
            return;
        }

        if (!append) {
            resultsContainer.innerHTML = '';
        }

        const getExchangeIcon = (exchange) => {
            if (exchange === 'binance') {
                return `<div class="modal-exchange-icon binance-icon">
                    <svg width="25" height="25" viewBox="0 0 32 32">
                        <circle cx="16" cy="16" r="15" fill="none" stroke="#FFA500" stroke-width="1.2"/>
                        <g transform="translate(16,16) scale(0.025)">
                            <g transform="translate(-500,-500)">
                                <path fill="#F0B90B" d="M500,612.7l112.7-112.7L500,387.3L387.3,500L500,612.7z M500,774.6L306.4,581L193.6,693.7L500,1000l306.4-306.3L693.7,581L500,774.6z M887.3,387.3L774.6,500l112.7,112.7L1000,500L887.3,387.3z M500,225.4l193.7,193.7L806.4,306.4L500,0L193.6,306.4l112.7,112.7L500,225.4z M225.4,500L112.7,612.7L0,500l112.7-112.7L225.4,500z"/>
                            </g>
                        </g>
                    </svg></div>`;
            } else {
                return `<div class="modal-exchange-icon bybit-icon">
                    <svg width="25" height="25" viewBox="0 0 40 40">
                        <circle cx="20" cy="20" r="19" fill="none" stroke="#FFFFFF" stroke-width="1.2"/>
                        <g transform="translate(20,20) scale(0.012)">
                            <g transform="translate(-1300,-420)">
                                <polygon fill="#F7A600" points="1781.6,642.2 1781.6,0 1910.7,0 1910.7,642.2"/>
                                <path fill="#FFFFFF" d="M277.3,832.9H0.6V190.8h265.6c129,0,204.3,70.4,204.3,180.4c0,71.3-48.3,117.2-81.8,132.6c39.9,18,91,58.6,91,144.3C479.7,767.9,395.2,832.9,277.3,832.9L277.3,832.9z M256,302.7H129.6v147.9H256c54.8,0,85.5-29.8,85.5-74S310.8,302.7,256,302.7 L256,302.7z M264.3,563.3H129.6v157.8h134.6c58.6,0,86.4-36.1,86.4-79.4C350.6,598.4,322.7,563.3,264.3,563.3z"/>
                                <polygon fill="#FFFFFF" points="873.4,569.5 873.4,832.9 745.2,832.9 745.2,569.5 546.5,190.8 686.8,190.8 810.2,449.6 931.9,190.8 1072.1,190.8"/>
                                <path fill="#FFFFFF" d="M1438,832.9h-276.7V190.8h265.6c129,0,204.3,70.4,204.3,180.4c0,71.3-48.3,117.2-81.8,132.6c39.9,18,91,58.6,91,144.3 C1640.4,767.9,1556,832.9,1438,832.9L1438,832.9z M1416.7,302.7h-126.3v147.9h126.3c54.8,0,85.5-29.8,85.5-74 C1502.1,332.4,1471.4,302.7,1416.7,302.7L1416.7,302.7z M1425,563.3h-134.6v157.8H1425c58.6,0,86.4-36.1,86.4-79.4 C1511.4,598.4,1483.5,563.3,1425,563.3L1425,563.3z"/>
                                <polygon fill="#FFFFFF" points="2326.7,302.7 2326.7,833 2197.6,833 2197.6,302.7 2024.9,302.7 2024.9,190.8 2499.4,190.8 2499.4,302.7"/>
                            </g>
                        </g>
                    </svg></div>`;
            }
        };

        const itemsHtml = results.map(symbolData => {
            if (!symbolData?.symbol) return '';

            const isAdded = this.parent.tickers.some(t =>
                t.symbol === symbolData.symbol &&
                t.exchange === symbolData.exchange &&
                t.marketType === symbolData.marketType
            );

            const exchangeName = symbolData.exchange === 'binance' ? 'Binance' : 'Bybit';
            const marketName = symbolData.marketType === 'futures' ? 'Futures' : 'Spot';

            const actionsHtml = isAdded
                ? `<div class="modal-result-actions">
                       <span class="modal-check-icon"><i class="fas fa-check-circle"></i></span>
                       <span class="modal-target-btn"
                             data-symbol="${symbolData.symbol}"
                             data-exchange="${symbolData.exchange}"
                             data-market-type="${symbolData.marketType}"
                             title="Прицелиться">
                           <i class="fas fa-crosshairs"></i>
                       </span>
                   </div>`
                : `<span class="modal-add-icon"><i class="fas fa-plus-circle"></i></span>`;

            return `<div class="modal-result-item ${isAdded ? 'added' : ''}"
                         data-symbol="${symbolData.symbol}"
                         data-exchange="${symbolData.exchange}"
                         data-market-type="${symbolData.marketType}">
                        ${getExchangeIcon(symbolData.exchange)}
                        <span class="modal-result-symbol">${symbolData.symbol}</span>
                        <div class="modal-result-exchange">
                            <span>${exchangeName} - ${marketName}</span>
                        </div>
                        ${actionsHtml}
                    </div>`;
        }).join('');

        if (append) {
            resultsContainer.insertAdjacentHTML('beforeend', itemsHtml);
        } else {
            resultsContainer.innerHTML = itemsHtml;
        }

        this._attachResultItemListeners(resultsContainer);

        if (!resultsContainer._scrollHandler) {
            resultsContainer._scrollHandler = () => {
                const { scrollTop, scrollHeight, clientHeight } = resultsContainer;
                if (scrollHeight - scrollTop - clientHeight < 100) {
                    if (this.modalAllResults &&
                        this.parent.state.modalPage * (this.parent.state.modalPageSize || 50) < this.modalAllResults.length) {
                        this.updateModalResults(false);
                    }
                }
            };
            resultsContainer.addEventListener('scroll', resultsContainer._scrollHandler);
        }
    }

    _attachResultItemListeners(container) {
        container.querySelectorAll('.modal-result-item:not(.added)').forEach(item => {
            item.addEventListener('click', (e) => {
                const symbol = item.dataset.symbol;
                const exchange = item.dataset.exchange;
                const marketType = item.dataset.marketType;

                if (this.parent.addSymbol(symbol, true, exchange, marketType)) {
                    this.parent.updateModalCount();
                    this.updateModalResults(true);
                    this.parent.filterCache = null;
                    this.parent.renderTickerList();

                    if (e.shiftKey) {
                        const modal = document.getElementById('addInstrumentModal');
                        if (modal) modal.classList.remove('show');
                    }
                }
            });
        });

        container.querySelectorAll('.modal-target-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const symbol = btn.dataset.symbol;
                const exchange = btn.dataset.exchange;
                const marketType = btn.dataset.marketType;

                if (this.parent.focusOnSymbol) {
                    this.parent.focusOnSymbol(symbol, exchange, marketType);
                } else {
                    const modal = document.getElementById('addInstrumentModal');
                    if (modal) modal.classList.remove('show');
                }
            });
        });
    }

    // =========================================================================
    // updateModalButtons (без изменений)
    // =========================================================================
    updateModalButtons() {
        const binanceBtn = document.getElementById('modalBinanceBtn');
        const bybitBtn = document.getElementById('modalBybitBtn');
        const futuresBtn = document.getElementById('modalFuturesBtn');
        const spotBtn = document.getElementById('modalSpotBtn');

        if (binanceBtn) binanceBtn.classList.toggle('active', this.parent.state.modalExchange === 'binance');
        if (bybitBtn) bybitBtn.classList.toggle('active', this.parent.state.modalExchange === 'bybit');
        if (futuresBtn) futuresBtn.classList.toggle('active', this.parent.state.modalMarketType === 'futures');
        if (spotBtn) spotBtn.classList.toggle('active', this.parent.state.modalMarketType === 'spot');
    }
}

if (typeof window !== 'undefined') {
    window.TickerModal = TickerModal;
}
