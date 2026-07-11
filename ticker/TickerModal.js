class TickerModal {
    // Константы вместо магических чисел
    static DEBOUNCE_DELAY = 300;            // задержка перед поиском (мс)
    static BATCH_SIZE = 20;                 // размер батча при массовом добавлении
    static BATCH_INTERVAL = 80;             // интервал между батчами (мс)
    static INFINITE_SCROLL_OFFSET = 100;    // отступ от низа для подгрузки (px)

    constructor(parent) {
        this.parent = parent;
        this.searchTimeout = null;
        this.modalAllResults = [];
        this._scrollHandler = null;
        this._keyDownHandler = null;
        this._escapeDiv = document.createElement('div');

        // Кэш ссылок на ключевые элементы (заполняются при открытии / setup)
        this._modal = null;
        this._input = null;
        this._resultsContainer = null;
        this._addAllBtn = null;
        this._foundSpan = null;

        // Карта раскладки (русская → английская)
        this.layoutMap = {
            'й': 'q', 'ц': 'w', 'у': 'e', 'к': 'r', 'е': 't', 'н': 'y', 'г': 'u',
            'ш': 'i', 'щ': 'o', 'з': 'p', 'х': '[', 'ъ': ']',
            'ф': 'a', 'ы': 's', 'в': 'd', 'а': 'f', 'п': 'g', 'р': 'h',
            'о': 'j', 'л': 'k', 'д': 'l', 'ж': ';', 'э': "'",
            'я': 'z', 'ч': 'x', 'с': 'c', 'м': 'v', 'и': 'b', 'т': 'n',
            'ь': 'm', 'б': ',', 'ю': '.', 'ё': '`'
        };
    }

    // Безопасный доступ к состоянию (с валидацией)
    _state() {
        return this.parent?.state;
    }

    _validateState() {
        if (!this._state()) {
            console.error('TickerModal: отсутствует this.parent.state');
            return false;
        }
        return true;
    }

    // =========================================================================
    // 🎯 ГЛАВНЫЙ МЕТОД — setupModal()
    // =========================================================================
    setupModal() {
        this._modal = document.getElementById('addInstrumentModal');
        const openBtn = document.getElementById('addInstrumentBtn');
        const closeBtn = document.getElementById('modalClose');
        let modalSearch = document.getElementById('modalSearchInput');
        const modalBinanceBtn = document.getElementById('modalBinanceBtn');
        const modalBybitBtn = document.getElementById('modalBybitBtn');
        const modalFuturesBtn = document.getElementById('modalFuturesBtn');
        const modalSpotBtn = document.getElementById('modalSpotBtn');
        const modalAddAllBtn = document.getElementById('modalAddAllBtn');
        this._addAllBtn = modalAddAllBtn;
        this._resultsContainer = document.getElementById('modalResults');
        this._foundSpan = document.getElementById('modalFoundCount');

        if (!this._modal) {
            console.warn('TickerModal: основной контейнер не найден');
            return;
        }

        // 1. Чистим инпут от старых listener'ов
        if (modalSearch) {
            const newInput = modalSearch.cloneNode(true);
            modalSearch.parentNode.replaceChild(newInput, modalSearch);
            modalSearch = document.getElementById('modalSearchInput');
            this._input = modalSearch;
        }

        // 2. Создаём кнопку очистки
        this._createClearButton(this._input);

        // 3. Вешаем слушатели поиска
        this._setupSearchListeners(this._input);

        // 4. Открытие модального окна
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                if (!this._validateState()) return;
                const state = this._state();
                state.modalExchange = 'binance';
                state.modalMarketType = 'futures';
                state.modalSearchQuery = '';
                state.modalPage = 0;
                if (this._input) this._input.value = '';
                this._toggleClearBtn();
                this.updateModalButtons();
                this._modal.classList.add('show');
                this._input?.focus();
                this.updateCount();
                this.updateModalResults(true);
            });
        }

        // 5. Закрытие
        const closeHandler = () => this.closeModal();
        if (closeBtn) closeBtn.addEventListener('click', closeHandler);
        this._modal.addEventListener('click', (e) => { if (e.target === this._modal) closeHandler(); });

        // Клавиатурные события
        if (this._keyDownHandler) document.removeEventListener('keydown', this._keyDownHandler);
        this._keyDownHandler = (e) => {
            if (!this._modal?.classList.contains('show')) return;
            if (e.key === 'Escape') {
                if (this._input && this._input.value.length > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    this._input.value = '';
                    this._state().modalSearchQuery = '';
                    this._state().modalPage = 0;
                    this._toggleClearBtn();
                    this.updateModalResults(true);
                    return;
                }
                this.closeModal();
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const firstItem = this._resultsContainer?.querySelector('.modal-result-item:not(.added)');
                if (firstItem) {
                    const { symbol, exchange, marketType } = firstItem.dataset;
                    this._addSingleSymbol(symbol, exchange, marketType, firstItem);
                }
            }
        };
        document.addEventListener('keydown', this._keyDownHandler);

        // 6. Переключение бирж/типов рынка
        modalBinanceBtn?.addEventListener('click', () => this._switchExchange('binance'));
        modalBybitBtn?.addEventListener('click', () => this._switchExchange('bybit'));
        modalFuturesBtn?.addEventListener('click', () => this._switchMarketType('futures'));
        modalSpotBtn?.addEventListener('click', () => this._switchMarketType('spot'));

        // 7. Кнопка "Добавить все"
        this._addAllBtn?.addEventListener('click', () => this._startAddAll());

        // 8. Делегирование кликов в результатах
        this._resultsContainer?.addEventListener('click', (e) => {
            const target = e.target.closest('.modal-result-item');
            if (!target) return;

            if (e.target.closest('.modal-target-btn')) {
                e.stopPropagation();
                const { symbol, exchange, marketType } = target.dataset;
                this.parent?.focusOnSymbol?.(symbol, exchange, marketType);
                this.closeModal();
                return;
            }

            if (!target.classList.contains('added')) {
                const { symbol, exchange, marketType } = target.dataset;
                this._addSingleSymbol(symbol, exchange, marketType, target);
            }
        });
    }

    // =========================================================================
    // Вспомогательные переключатели
    // =========================================================================
    _switchExchange(exchange) {
        if (!this._validateState()) return;
        this._state().modalExchange = exchange;
        this._state().modalPage = 0;
        this.updateModalButtons();
        this.updateCount();
        this.updateModalResults(true);
    }

    _switchMarketType(marketType) {
        if (!this._validateState()) return;
        this._state().modalMarketType = marketType;
        this._state().modalPage = 0;
        this.updateModalButtons();
        this.updateCount();
        this.updateModalResults(true);
    }

    // =========================================================================
    // Добавление одного символа (без перерендера всей модалки)
    // =========================================================================
    _addSingleSymbol(symbol, exchange, marketType, element) {
        if (!this._validateState()) return;
        if (!this.parent.addSymbol(symbol, true, exchange, marketType)) return;

        // Обновляем только этот элемент
        element.classList.add('added');
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'modal-result-actions';
        actionsDiv.innerHTML = `
            <span class="modal-check-icon"><i class="fas fa-check-circle"></i></span>
            <span class="modal-target-btn" data-symbol="${this._escapeHtml(symbol)}" 
                  data-exchange="${this._escapeHtml(exchange)}" 
                  data-market-type="${this._escapeHtml(marketType)}">
                <i class="fas fa-crosshairs"></i>
            </span>`;
        const addIcon = element.querySelector('.modal-add-icon');
        if (addIcon) addIcon.remove();
        element.appendChild(actionsDiv);

        this.updateCount();
        this.parent.filterCache = null;
        this.parent.renderTickerList();

        if (window.event?.shiftKey) {
            this.closeModal();
        }
    }

    // =========================================================================
    // Закрытие модалки с очисткой таймера и обработчиков
    // =========================================================================
    closeModal() {
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = null;
        }
        this._modal?.classList.remove('show');
        const state = this._state();
        if (state) {
            state.isAddingAllInProgress = false;
            state.addingAllOffset = 0;
        }
        if (this._addAllBtn) {
            this._addAllBtn.classList.remove('loading');
            this._addAllBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Добавить все';
        }
        if (this._resultsContainer && this._scrollHandler) {
            this._resultsContainer.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }
    }

    // =========================================================================
    // Создание кнопки очистки поиска (без изменений)
    // =========================================================================
    _createClearButton(modalSearch) {
        if (!modalSearch || document.getElementById('searchClearBtn')) return;
        const wrapper = modalSearch.closest('.modal-search-wrapper') || modalSearch.parentElement;
        wrapper.style.position = 'relative';
        wrapper.style.display = 'inline-block';
        wrapper.style.width = '100%';
        modalSearch.style.paddingRight = '42px';

        const clearBtn = document.createElement('button');
        clearBtn.id = 'searchClearBtn';
        clearBtn.innerHTML = '✕';
        clearBtn.title = 'Очистить поиск';
        Object.assign(clearBtn.style, {
            position: 'absolute', right: '32px', top: '50%', transform: 'translateY(-50%)',
            width: '16px', height: '16px', border: 'none', background: '#666', color: '#fff',
            borderRadius: '50%', cursor: 'pointer', display: 'none', fontSize: '10px',
            lineHeight: '16px', padding: '0', textAlign: 'center', zIndex: '20',
            opacity: '0.8'
        });
        clearBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const input = document.getElementById('modalSearchInput');
            if (input) {
                input.value = '';
                this._state().modalSearchQuery = '';
                this._state().modalPage = 0;
                clearBtn.style.display = 'none';
                input.focus();
                this.updateModalResults(true);
            }
        };
        wrapper.appendChild(clearBtn);
    }

    _toggleClearBtn() {
        const input = this._input || document.getElementById('modalSearchInput');
        const btn = document.getElementById('searchClearBtn');
        if (input && btn) btn.style.display = input.value.length > 0 ? 'block' : 'none';
    }

    // =========================================================================
    // Обработчики поиска с конвертацией раскладки (без изменений)
    // =========================================================================
    _setupSearchListeners(modalSearch) {
        if (!modalSearch) return;
        let isManualUpdate = false;

        modalSearch.addEventListener('keydown', (e) => {
            const specialKeys = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab', 'Enter', 'Escape'];
            if (specialKeys.includes(e.key)) {
                if (e.key === 'Backspace' || e.key === 'Delete') setTimeout(() => this._toggleClearBtn(), 0);
                return;
            }
            if (e.ctrlKey || e.altKey || e.metaKey) return;

            if (e.key.length === 1) {
                e.preventDefault();
                let char = e.key.toLowerCase();
                char = this.layoutMap[char] || char;
                char = char.toUpperCase();
                const input = e.target;
                const start = input.selectionStart;
                const end = input.selectionEnd;
                isManualUpdate = true;
                input.value = input.value.substring(0, start) + char + input.value.substring(end);
                input.selectionStart = input.selectionEnd = start + 1;
                isManualUpdate = false;
                this._toggleClearBtn();
                this._triggerSearch(input.value);
            }
        });

        modalSearch.addEventListener('input', (e) => {
            if (isManualUpdate) return;
            const input = e.target;
            let val = input.value;
            let converted = '';
            for (const c of val) {
                const lower = c.toLowerCase();
                converted += (this.layoutMap[lower] || c).toUpperCase();
            }
            input.value = converted;
            const pos = Math.min(input.selectionStart, converted.length);
            input.setSelectionRange(pos, pos);
            this._toggleClearBtn();
            this._triggerSearch(converted);
        });
    }

    _triggerSearch(query) {
        if (!this._validateState()) return;
        this._state().modalSearchQuery = query;
        this._state().modalPage = 0;
        if (this.searchTimeout) clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => this.updateModalResults(true), TickerModal.DEBOUNCE_DELAY);
    }

    // =========================================================================
    // Обновление счётчика найденных инструментов
    // =========================================================================
    updateCount() {
        if (!this._foundSpan || !this._validateState()) return;
        const source = this._getCurrentSource();
        let count = source ? source.length : 0;
        const query = this._state().modalSearchQuery;
        if (query && source) {
            count = source.filter(s => s.symbol.includes(query.toUpperCase())).length;
        }
        this._foundSpan.textContent = count;
    }

    // =========================================================================
    // Кнопки биржи/рынка
    // =========================================================================
    updateModalButtons() {
        if (!this._validateState()) return;
        const state = this._state();
        document.getElementById('modalBinanceBtn')?.classList.toggle('active', state.modalExchange === 'binance');
        document.getElementById('modalBybitBtn')?.classList.toggle('active', state.modalExchange === 'bybit');
        document.getElementById('modalFuturesBtn')?.classList.toggle('active', state.modalMarketType === 'futures');
        document.getElementById('modalSpotBtn')?.classList.toggle('active', state.modalMarketType === 'spot');
    }

    // =========================================================================
    // Результаты поиска
    // =========================================================================
    updateModalResults(reset = false) {
        if (!this._resultsContainer || !this._validateState()) return;

        const state = this._state();
        if (reset) {
            state.modalPage = 0;
            this._resultsContainer.innerHTML = '';
        }

        const source = this._getCurrentSource();
        if (!source?.length) {
            this._resultsContainer.innerHTML = '<div class="no-results">Загрузка данных...</div>';
            return;
        }

        let filtered = [...source];
        if (state.modalSearchQuery) {
            const q = state.modalSearchQuery.toUpperCase();
            filtered = filtered.filter(s => s.symbol.includes(q));
        }

        this.modalAllResults = filtered;
        const pageSize = state.modalPageSize || 50;
        const start = state.modalPage * pageSize;
        const end = Math.min(start + pageSize, filtered.length);

        if (filtered.length === 0) {
            this._resultsContainer.innerHTML = '<div class="no-results">Инструменты не найдены</div>';
            return;
        }

        const pageResults = filtered.slice(start, end);
        this.renderModalResults(pageResults, start > 0);
        this.updateCount();
    }

    _getCurrentSource() {
        const state = this._state();
        if (!state) return null;
        if (state.modalExchange === 'binance') {
            return state.modalMarketType === 'futures' ? this.parent?.allBinanceFutures : this.parent?.allBinanceSpot;
        } else {
            return state.modalMarketType === 'futures' ? this.parent?.allBybitFutures : this.parent?.allBybitSpot;
        }
    }

    // =========================================================================
    // Рендер результатов
    // =========================================================================
    renderModalResults(results, append = false) {
        const container = this._resultsContainer;
        if (!container) return;

        if (!append) {
            container.innerHTML = '';
            if (this._scrollHandler) {
                container.removeEventListener('scroll', this._scrollHandler);
                this._scrollHandler = null;
            }
        }

        const fragment = document.createDocumentFragment();
        const tickersMap = this.parent?.tickersMap;

        results.forEach(symbolData => {
            if (!symbolData?.symbol) return;
            const key = `${symbolData.symbol}:${symbolData.exchange}:${symbolData.marketType}`;
            const isAdded = tickersMap ? tickersMap.has(key) : false;
            fragment.appendChild(this._createResultItem(symbolData, isAdded));
        });

        container.appendChild(fragment);

        if (!this._scrollHandler) {
            this._scrollHandler = () => {
                const { scrollTop, scrollHeight, clientHeight } = container;
                if (scrollHeight - scrollTop - clientHeight < TickerModal.INFINITE_SCROLL_OFFSET) {
                    const nextPage = (this._state().modalPage || 0) + 1;
                    if (nextPage * (this._state().modalPageSize || 50) < this.modalAllResults.length) {
                        this._state().modalPage = nextPage;
                        this.updateModalResults(false);
                    }
                }
            };
            container.addEventListener('scroll', this._scrollHandler);
        }
    }

    _createResultItem(symbolData, isAdded) {
        const div = document.createElement('div');
        div.className = `modal-result-item ${isAdded ? 'added' : ''}`;
        div.dataset.symbol = symbolData.symbol;
        div.dataset.exchange = symbolData.exchange;
        div.dataset.marketType = symbolData.marketType;

        const iconDiv = document.createElement('div');
        iconDiv.className = `modal-exchange-icon ${symbolData.exchange}-icon`;
        iconDiv.innerHTML = symbolData.exchange === 'binance' ? this._binanceIconSVG() : this._bybitIconSVG();
        div.appendChild(iconDiv);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'modal-result-symbol';
        nameSpan.textContent = symbolData.symbol;
        div.appendChild(nameSpan);

        const exchangeDiv = document.createElement('div');
        exchangeDiv.className = 'modal-result-exchange';
        exchangeDiv.innerHTML = `<span>${symbolData.exchange === 'binance' ? 'Binance' : 'Bybit'} - ${symbolData.marketType === 'futures' ? 'Futures' : 'Spot'}</span>`;
        div.appendChild(exchangeDiv);

        if (isAdded) {
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'modal-result-actions';
            actionsDiv.innerHTML = `
                <span class="modal-check-icon"><i class="fas fa-check-circle"></i></span>
                <span class="modal-target-btn" data-symbol="${this._escapeHtml(symbolData.symbol)}" 
                      data-exchange="${this._escapeHtml(symbolData.exchange)}" 
                      data-market-type="${this._escapeHtml(symbolData.marketType)}">
                    <i class="fas fa-crosshairs"></i>
                </span>`;
            div.appendChild(actionsDiv);
        } else {
            const addIcon = document.createElement('span');
            addIcon.className = 'modal-add-icon';
            addIcon.innerHTML = '<i class="fas fa-plus-circle"></i>';
            div.appendChild(addIcon);
        }

        return div;
    }

    // =========================================================================
    // Пакетное добавление (с защитой от ошибок)
    // =========================================================================
    _startAddAll() {
        if (!this._validateState()) return;
        const state = this._state();
        if (state.isAddingAllInProgress) return;

        const source = this._getCurrentSource();
        const allPairs = source?.filter(s => s.symbol?.endsWith('USDT')) || [];
        if (!allPairs.length) return;

        state.isAddingAllInProgress = true;
        state.addingAllOffset = 0;
        const btn = this._addAllBtn;
        if (btn) {
            btn.classList.add('loading');
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Загрузка...';
        }

        this._addNextBatch(allPairs, btn).catch(error => {
            console.error('Ошибка пакетного добавления:', error);
            if (state) state.isAddingAllInProgress = false;
            if (btn) {
                btn.classList.remove('loading');
                btn.innerHTML = '<i class="fas fa-plus-circle"></i> Добавить все';
            }
            this._showNotification('❌ Ошибка при добавлении всех инструментов', '#f23645');
        });
    }

    async _addNextBatch(allPairs, btn) {
        const state = this._state();
        if (!state?.isAddingAllInProgress) return;

        const start = state.addingAllOffset;
        const end = Math.min(start + TickerModal.BATCH_SIZE, allPairs.length);

        if (start === 0) {
            this.parent._isBulkAdding = true;
            this.parent._suppressWatchlistLoad = true;
        }

        for (let i = start; i < end; i++) {
            const item = allPairs[i];
            if (item?.symbol) {
                this.parent.addSymbol(item.symbol, true, item.exchange, item.marketType, false, true, true);
            }
        }

        state.addingAllOffset = end;
        const progress = Math.round((end / allPairs.length) * 100);
        if (btn) btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${end}/${allPairs.length} (${progress}%)`;

        if (end < allPairs.length) {
            await new Promise(resolve => setTimeout(resolve, TickerModal.BATCH_INTERVAL));
            await this._addNextBatch(allPairs, btn);
        } else {
            this.parent._isBulkAdding = false;
            await this._finalizeAddAll(allPairs, btn);
            setTimeout(() => { this.parent._suppressWatchlistLoad = false; }, 3000);
        }
    }

    async _finalizeAddAll(allPairs, btn) {
        const state = this._state();
        if (state) state.isAddingAllInProgress = false;
        if (btn) {
            btn.classList.remove('loading');
            btn.innerHTML = '<i class="fas fa-plus-circle"></i> Добавить все';
        }

        const wm = this.parent?.watchlistManager;
        if (wm) {
            const list = wm.lists.get(wm.activeListId);
            if (list) {
                list.symbols = Array.from(this.parent.tickersMap.keys());
                wm.saveToStorage();
                wm.renderDropdown();
            }
        }

        if (this.parent) {
            this.parent.state.customSymbols = Array.from(this.parent.tickersMap.keys());
            this.parent.filterCache = null;
            this.parent.renderTickerList();
            this.parent.saveState();
        }
        this.updateCount();

        if (this.parent?.pollRestData && !this.parent._isRestRunning) {
            this.parent.pollRestData().catch(e => console.warn('pollRestData:', e));
        }
        this._showNotification(`✅ Добавлено ${allPairs.length} символов. Цены загружаются...`, '#4caf50');
        setTimeout(() => this._hideNotification(), 3000);
    }

    // =========================================================================
    // Уведомления
    // =========================================================================
    _showNotification(message, color = '#666') {
        const notif = document.getElementById('alertNotification');
        if (notif) {
            notif.innerHTML = `<div>${message}</div>`;
            notif.style.display = 'block';
            notif.style.borderLeftColor = color;
        }
    }

    _hideNotification() {
        const notif = document.getElementById('alertNotification');
        if (notif) notif.style.display = 'none';
    }

    // =========================================================================
    // SVG-иконки
    // =========================================================================
    _binanceIconSVG() {
        return `<svg width="25" height="25" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="15" fill="none" stroke="#FFA500" stroke-width="1.2"/>
            <g transform="translate(16,16) scale(0.025)"><g transform="translate(-500,-500)">
                <path fill="#F0B90B" d="M500,612.7l112.7-112.7L500,387.3L387.3,500L500,612.7z M500,774.6L306.4,581L193.6,693.7L500,1000l306.4-306.3L693.7,581L500,774.6z M887.3,387.3L774.6,500l112.7,112.7L1000,500L887.3,387.3z M500,225.4l193.7,193.7L806.4,306.4L500,0L193.6,306.4l112.7,112.7L500,225.4z M225.4,500L112.7,612.7L0,500l112.7-112.7L225.4,500z"/>
            </g></g>
        </svg>`;
    }

    _bybitIconSVG() {
        return `<svg width="25" height="25" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="19" fill="none" stroke="#FFFFFF" stroke-width="1.2"/>
            <g transform="translate(20,20) scale(0.012)"><g transform="translate(-1300,-420)">
                <polygon fill="#F7A600" points="1781.6,642.2 1781.6,0 1910.7,0 1910.7,642.2"/>
                <path fill="#FFFFFF" d="M277.3,832.9H0.6V190.8h265.6c129,0,204.3,70.4,204.3,180.4c0,71.3-48.3,117.2-81.8,132.6c39.9,18,91,58.6,91,144.3 C479.7,767.9,395.2,832.9,277.3,832.9L277.3,832.9z M256,302.7H129.6v147.9H256c54.8,0,85.5-29.8,85.5-74S310.8,302.7,256,302.7 L256,302.7z M264.3,563.3H129.6v157.8h134.6c58.6,0,86.4-36.1,86.4-79.4C350.6,598.4,322.7,563.3,264.3,563.3z"/>
                <polygon fill="#FFFFFF" points="873.4,569.5 873.4,832.9 745.2,832.9 745.2,569.5 546.5,190.8 686.8,190.8 810.2,449.6 931.9,190.8 1072.1,190.8"/>
                <path fill="#FFFFFF" d="M1438,832.9h-276.7V190.8h265.6c129,0,204.3,70.4,204.3,180.4c0,71.3-48.3,117.2-81.8,132.6c39.9,18,91,58.6,91,144.3 C1640.4,767.9,1556,832.9,1438,832.9L1438,832.9z M1416.7,302.7h-126.3v147.9h126.3c54.8,0,85.5-29.8,85.5-74 C1502.1,332.4,1471.4,302.7,1416.7,302.7L1416.7,302.7z M1425,563.3h-134.6v157.8H1425c58.6,0,86.4-36.1,86.4-79.4 C1511.4,598.4,1483.5,563.3,1425,563.3L1425,563.3z"/>
                <polygon fill="#FFFFFF" points="2326.7,302.7 2326.7,833 2197.6,833 2197.6,302.7 2024.9,302.7 2024.9,190.8 2499.4,190.8 2499.4,302.7"/>
            </g></g>
        </svg>`;
    }

    // =========================================================================
    // Экранирование HTML
    // =========================================================================
    _escapeHtml(str) {
        if (!str) return '';
        this._escapeDiv.textContent = str;
        return this._escapeDiv.innerHTML;
    }

    // =========================================================================
    // Destroy: снимаем все обработчики
    // =========================================================================
    destroy() {
        if (this.searchTimeout) clearTimeout(this.searchTimeout);
        if (this._keyDownHandler) {
            document.removeEventListener('keydown', this._keyDownHandler);
            this._keyDownHandler = null;
        }
        if (this._resultsContainer && this._scrollHandler) {
            this._resultsContainer.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }
        this._modal = null;
        this._input = null;
        this._resultsContainer = null;
        this._addAllBtn = null;
        this._foundSpan = null;
    }
}

if (typeof window !== 'undefined') {
    window.TickerModal = TickerModal;
}
