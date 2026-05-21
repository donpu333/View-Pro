class TickerModal {
    constructor(parent) {
        this.parent = parent;
        this.searchTimeout = null;
        this.modalAllResults = [];
    }
    
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

    // ========== 1. СНАЧАЛА ОБЪЯВЛЯЕМ ФУНКЦИЮ ==========
    const toggleClearBtn = () => {
        const input = document.getElementById('modalSearchInput');
        const btn = document.getElementById('searchClearBtn');
        if (input && btn) {
            btn.style.display = input.value.length > 0 ? 'block' : 'none';
        }
    };

    // ========== 2. ПОТОМ СОЗДАЁМ КРЕСТИК ==========
   // ========== 2. СОЗДАЁМ КРЕСТИК ==========
const searchWrapper = modalSearch?.parentElement || modalSearch?.closest('.modal-search-wrapper');

if (modalSearch && !document.getElementById('searchClearBtn')) {
    searchWrapper.style.position = 'relative';
    searchWrapper.style.display = 'inline-block';
    searchWrapper.style.width = '100%';
    
    modalSearch.style.paddingRight = '42px';  // Больше отступ справа
    modalSearch.style.boxSizing = 'border-box';
    
    const clearBtn = document.createElement('button');
    clearBtn.id = 'searchClearBtn';
    clearBtn.type = 'button';
    clearBtn.innerHTML = '✕';
    clearBtn.title = 'Очистить поиск';
    clearBtn.style.cssText = `
        position: absolute;
        right: 32px;          /* Сдвинули левее */
        top: 50%;
        transform: translateY(-50%);
        width: 16px;          /* Чуть меньше */
        height: 16px;
        border: none;
        background: #666;
        color: #fff;
        border-radius: 50%;
        cursor: pointer;
        display: none;
        font-size: 10px;
        line-height: 16px;
        padding: 0;
        text-align: center;
        transition: all 0.15s ease;
        z-index: 20;
        flex-shrink: 0;
    `;
    
    clearBtn.onmouseenter = () => {
        clearBtn.style.background = '#f23645';
        clearBtn.style.transform = 'translateY(-50%) scale(1.2)';
    };
    clearBtn.onmouseleave = () => {
        clearBtn.style.background = '#666';
        clearBtn.style.transform = 'translateY(-50%) scale(1)';
    };
    
    clearBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const input = document.getElementById('modalSearchInput');
        if (input) {
            input.value = '';
            this.parent.state.modalSearchQuery = '';
            this.parent.state.modalPage = 0;
            clearBtn.style.display = 'none';
            input.focus();
            this.updateModalResults(true);
        }
    };
    
    searchWrapper.appendChild(clearBtn);
}
    openBtn.addEventListener('click', () => {
        this.parent.state.modalExchange = 'binance';
        this.parent.state.modalMarketType = 'futures';
        this.parent.state.modalSearchQuery = '';
        this.parent.state.modalPage = 0;
        modalSearch.value = '';
        toggleClearBtn();
        this.updateModalButtons();
        modal.classList.add('show');
        modalSearch.focus();
        this.parent.updateModalCount();
        this.updateModalResults(true);
    });

    closeBtn.addEventListener('click', () => {
        modal.classList.remove('show');
        this.parent.state.isAddingAllInProgress = false;
        this.parent.state.addingAllOffset = 0;
        modalAddAllBtn.classList.remove('loading');
        modalAddAllBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Добавить все';
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('show');
            this.parent.state.isAddingAllInProgress = false;
            this.parent.state.addingAllOffset = 0;
            modalAddAllBtn.classList.remove('loading');
            modalAddAllBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Добавить все';
        }
    });

    modalBinanceBtn.addEventListener('click', () => { 
        this.parent.state.modalExchange = 'binance'; 
        this.parent.state.modalPage = 0;
        this.updateModalButtons();
        this.parent.updateModalCount();
        this.updateModalResults(true); 
    });
    
    modalBybitBtn.addEventListener('click', () => { 
        this.parent.state.modalExchange = 'bybit'; 
        this.parent.state.modalPage = 0;
        this.updateModalButtons();
        this.parent.updateModalCount();
        this.updateModalResults(true); 
    });
    
    modalFuturesBtn.addEventListener('click', () => { 
        this.parent.state.modalMarketType = 'futures'; 
        this.parent.state.modalPage = 0;
        this.updateModalButtons();
        this.parent.updateModalCount();
        this.updateModalResults(true); 
    });
    
    modalSpotBtn.addEventListener('click', () => { 
        this.parent.state.modalMarketType = 'spot'; 
        this.parent.state.modalPage = 0;
        this.updateModalButtons();
        this.parent.updateModalCount();
        this.updateModalResults(true); 
    });

    modalAddAllBtn.addEventListener('click', async () => {
        if (this.parent.state.isAddingAllInProgress) return;
        
        const cache = this.parent.state.modalExchange === 'binance' ? this.parent.binanceSymbolsCache : this.parent.bybitSymbolsCache;
        const allPairs = cache.filter(s => 
            s.exchange === this.parent.state.modalExchange && 
            s.marketType === this.parent.state.modalMarketType && 
            s.symbol && s.symbol.endsWith('USDT')
        );
        
        if (allPairs.length === 0) return;
        
        this.parent.state.isAddingAllInProgress = true;
        this.parent.state.addingAllOffset = 0;
        modalAddAllBtn.classList.add('loading');
        modalAddAllBtn.innerHTML = '<i class="fas fa-spinner"></i> Загрузка...';
        
        this.addNextBatch();
    });

    // Очищаем инпут от старых listeners
    const oldInput = modalSearch;
    const newInput = oldInput.cloneNode(true);
    oldInput.parentNode.replaceChild(newInput, oldInput);
    const modalSearchClean = document.getElementById('modalSearchInput');

    let isManualUpdate = false;

    const hardwareLayoutMap = {
        'ё': '`', 'й': 'q', 'ц': 'w', 'у': 'e', 'к': 'r', 'е': 't', 'н': 'y', 'г': 'u', 'ш': 'i', 'щ': 'o', 'з': 'p', 'х': '[', 'ъ': ']',
        'ф': 'a', 'ы': 's', 'в': 'd', 'а': 'f', 'п': 'g', 'р': 'h', 'о': 'j', 'л': 'k', 'д': 'l', 'ж': ';', 'э': "'",
        'я': 'z', 'ч': 'x', 'с': 'c', 'м': 'v', 'и': 'b', 'т': 'n', 'ь': 'm', 'б': ',', 'ю': '.'
    };

    modalSearchClean.addEventListener('keydown', (e) => {
        if (['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab', 'Enter', 'Escape'].includes(e.key)) {
            if (e.key === 'Backspace' || e.key === 'Delete') {
                setTimeout(toggleClearBtn, 0);
            }
            return;
        }
        
        if (e.ctrlKey || e.altKey || e.metaKey) return;

        if (e.key.length === 1) {
            e.preventDefault();
            
            let char = e.key;
            if (hardwareLayoutMap[char]) char = hardwareLayoutMap[char];
            char = char.toUpperCase();

            const input = e.target;
            const start = input.selectionStart;
            const end = input.selectionEnd;
            const value = input.value;
            
            isManualUpdate = true;
            input.value = value.substring(0, start) + char + value.substring(end);
            input.selectionStart = input.selectionEnd = start + 1;
            isManualUpdate = false;
            
            toggleClearBtn();
            
            this.parent.state.modalSearchQuery = input.value;
            this.parent.state.modalPage = 0;
            
            if (this.searchTimeout) clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout(() => {
                this.updateModalResults(true);
            }, 300);
        }
    });

    modalSearchClean.addEventListener('input', (e) => {
        if (isManualUpdate) return;

        const input = e.target;
        const cursor = input.selectionStart;
        
        let val = input.value;
        val = val.split('').map(c => hardwareLayoutMap[c] || c).join('');
        
        input.value = val.toUpperCase();
        input.setSelectionRange(cursor, cursor);
        
        toggleClearBtn();
        
        this.parent.state.modalSearchQuery = input.value;
        this.parent.state.modalPage = 0;
        
        if (this.searchTimeout) clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            this.updateModalResults(true);
        }, 300);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('show')) {
            const activeEl = document.activeElement;
            if (activeEl && activeEl.id === 'modalSearchInput' && activeEl.value.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                activeEl.value = '';
                this.parent.state.modalSearchQuery = '';
                this.parent.state.modalPage = 0;
                toggleClearBtn();
                this.updateModalResults(true);
                return;
            }
            
            modal.classList.remove('show');
            this.parent.state.isAddingAllInProgress = false;
            this.parent.state.addingAllOffset = 0;
            modalAddAllBtn.classList.remove('loading');
            modalAddAllBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Добавить все';
        }
        
        if (e.key === 'Enter' && modal.classList.contains('show')) {
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
                    if (e.shiftKey) modal.classList.remove('show');
                }
            }
        }
    });
}
    
async addNextBatch() {
    if (!this.parent.state.isAddingAllInProgress) return;
    
    const modalAddAllBtn = document.getElementById('modalAddAllBtn');
    
    // Берем данные ИЗ ТОГО ЖЕ ИСТОЧНИКА, что и счетчик
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
    
    // Применяем поиск
    if (this.parent.state.modalSearchQuery) {
        const query = this.parent.state.modalSearchQuery.toUpperCase();
        allPairs = allPairs.filter(s => s.symbol.includes(query));
    }
    
    console.log(`📊 Добавление всех: найдено ${allPairs.length} символов`);
    
    if (allPairs.length === 0) return;
    
    this.parent.state.isAddingAllInProgress = true;
    this.parent.state.addingAllOffset = 0;
    modalAddAllBtn.classList.add('loading');
    modalAddAllBtn.innerHTML = '<i class="fas fa-spinner"></i> Загрузка...';
    
    this._doAddNextBatch(allPairs);
}

async _doAddNextBatch(allPairs) {
    if (!this.parent.state.isAddingAllInProgress) return;

    const batchSize = this.parent.state.addingAllBatchSize;
    const start = this.parent.state.addingAllOffset;
    const end = Math.min(start + batchSize, allPairs.length);

    // Добавляем текущую партию
    for (let i = start; i < end; i++) {
        const item = allPairs[i];
        if (item && item.symbol) {
            this.parent.addSymbol(item.symbol, true, item.exchange, item.marketType, false, false, false);
        }
    }

    this.parent.state.addingAllOffset = end;
    const progress = Math.round((end / allPairs.length) * 100);
    const btn = document.getElementById('modalAddAllBtn');
    if (btn) {
        btn.innerHTML = `<i class="fas fa-spinner"></i> Загружено ${end}/${allPairs.length} (${progress}%)`;
    }

    if (end < allPairs.length) {
        // Ещё есть символы – добавляем следующую партию через 150 мс
        setTimeout(() => this._doAddNextBatch(allPairs), 150);
    } else {
        // ВСЕ СИМВОЛЫ ДОБАВЛЕНЫ
        this.parent.state.isAddingAllInProgress = false;
        if (btn) {
            btn.classList.remove('loading');
            btn.innerHTML = '<i class="fas fa-plus-circle"></i> Добавить все';
        }

        // 1. Принудительно синхронизируем активный вотчлист
        const wm = this.parent.watchlistManager;
        if (wm) {
            const activeList = wm.lists.get(wm.activeListId);
            if (activeList) {
                // Убедимся, что все добавленные ключи есть в списке
                for (const item of allPairs) {
                    const key = `${item.symbol}:${item.exchange}:${item.marketType}`;
                    if (!activeList.symbols.includes(key)) {
                        activeList.symbols.push(key);
                    }
                }
                this.parent.state.customSymbols = [...activeList.symbols];
                wm.saveToStorage();
                wm.renderDropdown();
                // Перезагружаем отображение списка из вотчлиста
                wm.loadSymbolsFromList(wm.activeListId);
            } else {
                // fallback
                this.parent.filterCache = null;
                this.parent.renderTickerList();
            }
        } else {
            this.parent.filterCache = null;
            this.parent.renderTickerList();
        }

        // 2. Обновляем счётчик в модалке (на всякий случай)
        const counterSpan = document.getElementById('modalFoundCount');
        if (counterSpan) counterSpan.textContent = allPairs.length;

        // 3. Загружаем 24h данные (change, volume, trades)
        setTimeout(() => {
            if (this.parent.pollRestData) {
                this.parent.pollRestData();
            } else if (this.parent.fetchBatchSnapshots) {
                // Альтернативный метод, если pollRestData отсутствует
                const symbolsToFetch = allPairs.map(p => ({
                    symbol: p.symbol,
                    exchange: p.exchange,
                    marketType: p.marketType
                }));
                this.parent.fetchBatchSnapshots(symbolsToFetch);
            }
        }, 500);
    }
}
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
  updateModalResults(reset = false) {
    const resultsContainer = document.getElementById('modalResults');
    
    if (reset) {
        this.parent.state.modalPage = 0;
    }
    
    // Выбираем источник данных
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
    
    // Фильтруем по поиску
    let filteredResults = [...source];
    
    if (this.parent.state.modalSearchQuery) {
        const query = this.parent.state.modalSearchQuery.toUpperCase();
        filteredResults = filteredResults.filter(s => s.symbol.includes(query));
    }
    
    // Сохраняем ВСЕ отфильтрованные результаты
    this.modalAllResults = filteredResults;
    
    // ✅ ОБНОВЛЯЕМ СЧЕТЧИК
    const foundSpan = document.getElementById('modalFoundCount');
    if (foundSpan) {
        foundSpan.textContent = this.modalAllResults.length;
    }
    
    // Пагинация
    const pageSize = this.parent.state.modalPageSize;
    const startIndex = reset ? 0 : this.parent.state.modalPage * pageSize;
    const endIndex = Math.min(startIndex + pageSize, this.modalAllResults.length);
    
    if (this.modalAllResults.length === 0) {
        resultsContainer.innerHTML = '';
        return;
    }
    
    const pageResults = this.modalAllResults.slice(startIndex, endIndex);
    
    if (!reset && startIndex < this.modalAllResults.length) {
        this.parent.state.modalPage++;
    }
    
    this.renderModalResults(pageResults, !reset && startIndex > 0);
}
    renderModalResults(results, append = false) {
        const resultsContainer = document.getElementById('modalResults');
        
        if (results.length === 0 && !append) { 
            resultsContainer.innerHTML = '<div class="no-results">Инструменты не найдены</div>'; 
            return; 
        }
        
        let html = append ? resultsContainer.innerHTML : '';
        
        for (const symbolData of results) {
            if (!symbolData || !symbolData.symbol) continue;
            
            const isAdded = this.parent.tickers.some(t => 
                t.symbol === symbolData.symbol && 
                t.exchange === symbolData.exchange && 
                t.marketType === symbolData.marketType
            );
            
            const addedClass = isAdded ? 'added' : '';
            
            let exchangeIconHtml = '';
            if (symbolData.exchange === 'binance') {
                exchangeIconHtml = `
                    <div class="modal-exchange-icon binance-icon">
                       <svg width="25" height="25" viewBox="0 0 32 32">
                          <circle cx="16" cy="16" r="15" fill="none" stroke="#FFA500" stroke-width="1.2"/>
                          <g transform="translate(16, 16) scale(0.025)">
                            <g transform="translate(-500, -500)">
                              <path fill="#F0B90B" d="M500,612.7l112.7-112.7L500,387.3L387.3,500L500,612.7z M500,774.6L306.4,581L193.6,693.7L500,1000l306.4-306.3L693.7,581L500,774.6z M887.3,387.3L774.6,500l112.7,112.7L1000,500L887.3,387.3z M500,225.4l193.7,193.7L806.4,306.4L500,0L193.6,306.4l112.7,112.7L500,225.4z M225.4,500L112.7,612.7L0,500l112.7-112.7L225.4,500z"/>
                            </g>
                          </g>
                        </svg>
                    </div>
                `;
            } else {
                exchangeIconHtml = `
                    <div class="modal-exchange-icon bybit-icon">
                       <svg width="25" height="25" viewBox="0 0 40 40">
                          <circle cx="20" cy="20" r="19" fill="none" stroke="#FFFFFF" stroke-width="1.2"/>
                          <g transform="translate(20, 20) scale(0.012)">
                            <g transform="translate(-1300, -420)">
                              <polygon fill="#F7A600" points="1781.6,642.2 1781.6,0 1910.7,0 1910.7,642.2"/>
                              <path fill="#FFFFFF" d="M277.3,832.9H0.6V190.8h265.6c129,0,204.3,70.4,204.3,180.4c0,71.3-48.3,117.2-81.8,132.6c39.9,18,91,58.6,91,144.3 C479.7,767.9,395.2,832.9,277.3,832.9L277.3,832.9z M256,302.7H129.6v147.9H256c54.8,0,85.5-29.8,85.5-74S310.8,302.7,256,302.7 L256,302.7z M264.3,563.3H129.6v157.8h134.6c58.6,0,86.4-36.1,86.4-79.4C350.6,598.4,322.7,563.3,264.3,563.3z"/>
                              <polygon fill="#FFFFFF" points="873.4,569.5 873.4,832.9 745.2,832.9 745.2,569.5 546.5,190.8 686.8,190.8 810.2,449.6 931.9,190.8 1072.1,190.8"/>
                              <path fill="#FFFFFF" d="M1438,832.9h-276.7V190.8h265.6c129,0,204.3,70.4,204.3,180.4c0,71.3-48.3,117.2-81.8,132.6c39.9,18,91,58.6,91,144.3 C1640.4,767.9,1556,832.9,1438,832.9L1438,832.9z M1416.7,302.7h-126.3v147.9h126.3c54.8,0,85.5-29.8,85.5-74 C1502.1,332.4,1471.4,302.7,1416.7,302.7L1416.7,302.7z M1425,563.3h-134.6v157.8H1425c58.6,0,86.4-36.1,86.4-79.4 C1511.4,598.4,1483.5,563.3,1425,563.3L1425,563.3z"/>
                              <polygon fill="#FFFFFF" points="2326.7,302.7 2326.7,833 2197.6,833 2197.6,302.7 2024.9,302.7 2024.9,190.8 2499.4,190.8 2499.4,302.7"/>
                            </g>
                          </g>
                        </svg>
                    </div>
                `;
            }
            
            if (isAdded) {
                html += `<div class="modal-result-item ${addedClass}" data-symbol="${symbolData.symbol}" data-exchange="${symbolData.exchange}" data-market-type="${symbolData.marketType}">${exchangeIconHtml}<span class="modal-result-symbol">${symbolData.symbol}</span><div class="modal-result-exchange"><span>${symbolData.exchange === 'binance' ? 'Binance' : 'Bybit'} - ${symbolData.marketType === 'futures' ? 'Futures' : 'Spot'}</span></div><div class="modal-result-actions"><span class="modal-check-icon"><i class="fas fa-check-circle"></i></span><span class="modal-target-btn" data-symbol="${symbolData.symbol}" data-exchange="${symbolData.exchange}" data-market-type="${symbolData.marketType}" title="Прицелиться"><i class="fas fa-crosshairs"></i></span></div></div>`;
            } else {
                html += `<div class="modal-result-item ${addedClass}" data-symbol="${symbolData.symbol}" data-exchange="${symbolData.exchange}" data-market-type="${symbolData.marketType}">${exchangeIconHtml}<span class="modal-result-symbol">${symbolData.symbol}</span><div class="modal-result-exchange"><span>${symbolData.exchange === 'binance' ? 'Binance' : 'Bybit'} - ${symbolData.marketType === 'futures' ? 'Futures' : 'Spot'}</span></div><span class="modal-add-icon"><i class="fas fa-plus-circle"></i></span></div>`;
            }
        }
        
        resultsContainer.innerHTML = html;
        
        document.querySelectorAll('.modal-result-item:not(.added)').forEach(item => {
            item.addEventListener('click', (e) => {
                const symbol = item.dataset.symbol;
                const exchange = item.dataset.exchange;
                const marketType = item.dataset.marketType;
                
                if (this.parent.addSymbol(symbol, true, exchange, marketType)) {
                    this.parent.updateModalCount();
                    this.updateModalResults(true);
                    this.parent.filterCache = null;
                    
                    if (e.shiftKey) {
                        document.getElementById('addInstrumentModal').classList.remove('show');
                    }
                }
            });
        });
        
        document.querySelectorAll('.modal-target-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const symbol = btn.dataset.symbol;
                const exchange = btn.dataset.exchange;
                const marketType = btn.dataset.marketType;
                
                if (this.parent.focusOnSymbol) {
                    this.parent.focusOnSymbol(symbol, exchange, marketType);
                } else {
                    document.getElementById('addInstrumentModal').classList.remove('show');
                }
            });
        });
        
        if (!resultsContainer._scrollHandler) {
            resultsContainer._scrollHandler = () => {
                const { scrollTop, scrollHeight, clientHeight } = resultsContainer;
                if (scrollHeight - scrollTop - clientHeight < 100) {
                    if (this.modalAllResults && 
                        this.parent.state.modalPage * this.parent.state.modalPageSize < this.modalAllResults.length) {
                        this.updateModalResults(false);
                    }
                }
            };
            resultsContainer.addEventListener('scroll', resultsContainer._scrollHandler);
        }
    }
}

if (typeof window !== 'undefined') {
    window.TickerModal = TickerModal;
}