class TickerModal {
    constructor(parent) {
        this.parent = parent;
        this.searchTimeout = null;
        this.modalAllResults = [];
        
        // 🇷🇺→🇬🇧 Карта раскладки (русская → английская)
        this.layoutMap = {
            'й': 'q', 'ц': 'w', 'у': 'e', 'к': 'r', 'е': 't', 'н': 'y', 'г': 'u',
            'ш': 'i', 'щ': 'o', 'з': 'p', 'х': '[', 'ъ': ']',
            'ф': 'a', 'ы': 's', 'в': 'd', 'а': 'f', 'п': 'g', 'р': 'h',
            'о': 'j', 'л': 'k', 'д': 'l', 'ж': ';', 'э': "'",
            'я': 'z', 'ч': 'x', 'с': 'c', 'м': 'v', 'и': 'b', 'т': 'n',
            'ь': 'm', 'б': ',', 'ю': '.', 'ё': '`',
            'Й': 'Q', 'Ц': 'W', 'У': 'E', 'К': 'R', 'Е': 'T', 'Н': 'Y', 'Г': 'U',
            'Ш': 'I', 'Щ': 'O', 'З': 'P', 'Х': '[', 'Ъ': ']',
            'Ф': 'A', 'Ы': 'S', 'В': 'D', 'А': 'F', 'П': 'G', 'Р': 'H',
            'О': 'J', 'Л': 'K', 'Д': 'L', 'Ж': ';', 'Э': "'",
            'Я': 'Z', 'Ч': 'X', 'С': 'C', 'М': 'V', 'И': 'B', 'Т': 'N',
            'Ь': 'M', 'Б': ',', 'Ю': '.', 'Ё': '`'
        };
    }
    
    // =========================================================================
    // 🎯 ГЛАВНЫЙ МЕТОД - setupModal()
    // =========================================================================
    setupModal() {
        const modal = document.getElementById('addInstrumentModal');
        const openBtn = document.getElementById('addInstrumentBtn');
        const closeBtn = document.getElementById('modalClose');
        let modalSearch = document.getElementById('modalSearchInput');
        const modalBinanceBtn = document.getElementById('modalBinanceBtn');
        const modalBybitBtn = document.getElementById('modalBybitBtn');
        const modalFuturesBtn = document.getElementById('modalFuturesBtn');
        const modalSpotBtn = document.getElementById('modalSpotBtn');
        const modalAddAllBtn = document.getElementById('modalAddAllBtn');

        // =========================================================================
        // 1. 🔥 ЧИСТИМ ИНПУТ ОТ СТАРЫХ LISTENERS
        // =========================================================================
        if (modalSearch) {
            const oldInput = modalSearch;
            const newInput = oldInput.cloneNode(true);
            oldInput.parentNode.replaceChild(newInput, oldInput);
            modalSearch = document.getElementById('modalSearchInput');
        }

        // =========================================================================
        // 2. ✕ СОЗДАЁМ КНОПКУ ОЧИСТКИ ПОИСКА
        // =========================================================================
        this.createClearButton(modalSearch);

        // =========================================================================
        // 3. ⌨️ ВЕШАЕМ ЛИСТЕНЕРЫ ПОИСКА
        // =========================================================================
        this.setupSearchListeners(modalSearch);

        // =========================================================================
        // 4. 📂 ОТКРЫТИЕ МОДАЛЬНОГО ОКНА
        // =========================================================================
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                this.parent.state.modalExchange = 'binance';
                this.parent.state.modalMarketType = 'futures';
                this.parent.state.modalSearchQuery = '';
                this.parent.state.modalPage = 0;
                
                const input = document.getElementById('modalSearchInput');
                if (input) input.value = '';
                
                this.toggleClearBtn();
                this.updateModalButtons();
                modal.classList.add('show');
                setTimeout(() => input?.focus(), 100);
                this.parent.updateModalCount();
                this.updateModalResults(true);
            });
        }

        // =========================================================================
        // 5. ❌ ЗАКРЫТИЕ МОДАЛЬНОГО ОКНА
        // =========================================================================
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

        // Глобальные обработчики клавиш
        document.addEventListener('keydown', (e) => {
            if (!modal || !modal.classList.contains('show')) return;

            if (e.key === 'Escape') {
                const activeEl = document.activeElement;
                if (activeEl && activeEl.id === 'modalSearchInput' && activeEl.value.length > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    activeEl.value = '';
                    this.parent.state.modalSearchQuery = '';
                    this.parent.state.modalPage = 0;
                    this.toggleClearBtn();
                    this.updateModalResults(true);
                    return;
                }
                this.closeModal(modal, modalAddAllBtn);
            }

            if (e.key === 'Enter' && document.activeElement?.id === 'modalSearchInput') {
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

        // =========================================================================
        // 6. 🏦 ПЕРЕКЛЮЧЕНИЕ БИРЖ (Binance / Bybit)
        // =========================================================================
        if (modalBinanceBtn) {
            modalBinanceBtn.addEventListener('click', () => { 
                this.parent.state.modalExchange = 'binance'; 
                this.parent.state.modalPage = 0;
                this.updateModalButtons();
                this.parent.updateModalCount();
                this.updateModalResults(true); 
            });
        }
        
        if (modalBybitBtn) {
            modalBybitBtn.addEventListener('click', () => { 
                this.parent.state.modalExchange = 'bybit'; 
                this.parent.state.modalPage = 0;
                this.updateModalButtons();
                this.parent.updateModalCount();
                this.updateModalResults(true); 
            });
        }

        // =========================================================================
        // 7. 📊 ПЕРЕКЛЮЧЕНИЕ ТИПА РЫНКА (Futures / Spot)
        // =========================================================================
        if (modalFuturesBtn) {
            modalFuturesBtn.addEventListener('click', () => { 
                this.parent.state.modalMarketType = 'futures'; 
                this.parent.state.modalPage = 0;
                this.updateModalButtons();
                this.parent.updateModalCount();
                this.updateModalResults(true); 
            });
        }
        
        if (modalSpotBtn) {
            modalSpotBtn.addEventListener('click', () => { 
                this.parent.state.modalMarketType = 'spot'; 
                this.parent.state.modalPage = 0;
                this.updateModalButtons();
                this.parent.updateModalCount();
                this.updateModalResults(true); 
            });
        }

        // =========================================================================
        // 8. ➕ КНОПКА "ДОБАВИТЬ ВСЕ"
        // =========================================================================
        if (modalAddAllBtn) {
            modalAddAllBtn.addEventListener('click', async () => {
                if (this.parent.state.isAddingAllInProgress) return;
                
                const cache = this.parent.state.modalExchange === 'binance' 
                    ? this.parent.binanceSymbolsCache 
                    : this.parent.bybitSymbolsCache;
                    
                const allPairs = cache.filter(s => 
                    s.exchange === this.parent.state.modalExchange && 
                    s.marketType === this.parent.state.modalMarketType && 
                    s.symbol && 
                    s.symbol.endsWith('USDT')
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
    // ✕ СОЗДАНИЕ КНОПКИ ОЧИСТКИ
    // =========================================================================
    createClearButton(modalSearch) {
        if (!modalSearch) return;

        const searchWrapper = modalSearch.parentElement || modalSearch.closest('.modal-search-wrapper');
        
        if (!searchWrapper || document.getElementById('searchClearBtn')) return;

        searchWrapper.style.position = 'relative';
        searchWrapper.style.display = 'inline-block';
        searchWrapper.style.width = '100%';
        
        modalSearch.style.paddingRight = '42px';
        modalSearch.style.boxSizing = 'border-box';
        
        const clearBtn = document.createElement('button');
        clearBtn.id = 'searchClearBtn';
        clearBtn.type = 'button';
        clearBtn.innerHTML = '✕';
        clearBtn.title = 'Очистить поиск';
        clearBtn.setAttribute('aria-label', 'Очистить поле поиска');
        clearBtn.style.cssText = `
            position: absolute;
            right: 32px;
            top: 50%;
            transform: translateY(-50%);
            width: 20px;
            height: 20px;
            border: none;
            background: #666;
            color: #fff;
            border-radius: 50%;
            cursor: pointer;
            display: none;
            font-size: 11px;
            line-height: 20px;
            padding: 0;
            text-align: center;
            transition: all 0.15s ease;
            z-index: 20;
            flex-shrink: 0;
            opacity: 0.8;
        `;
        
        clearBtn.onmouseenter = () => {
            clearBtn.style.background = '#f23645';
            clearBtn.style.transform = 'translateY(-50%) scale(1.2)';
            clearBtn.style.opacity = '1';
        };
        clearBtn.onmouseleave = () => {
            clearBtn.style.background = '#666';
            clearBtn.style.transform = 'translateY(-50%) scale(1)';
            clearBtn.style.opacity = '0.8';
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

    // =========================================================================
    // ⌨️ ЛИСТЕНЕРЫ ПОИСКА - ИСПРАВЛЕННАЯ ВЕРСИЯ
    // =========================================================================
    setupSearchListeners(modalSearch) {
        if (!modalSearch) return;

        // Удаляем старые обработчики (на всякий случай)
        const newSearch = modalSearch.cloneNode(true);
        modalSearch.parentNode.replaceChild(newSearch, modalSearch);
        modalSearch = document.getElementById('modalSearchInput');
        
        if (!modalSearch) return;

        // === ЕДИНСТВЕННЫЙ ОБРАБОТЧИК - input ===
        // Он срабатывает на ВСЕ изменения: ввод с клавиатуры, paste, drag-drop, авто-замена
        modalSearch.addEventListener('input', (e) => {
            const input = e.target;
            let val = input.value;
            
            // Конвертируем каждый символ: русский → английский
            let converted = '';
            for (let i = 0; i < val.length; i++) {
                const char = val[i];
                converted += this.layoutMap[char] || char.toUpperCase();
            }
            
            // Применяем конвертированное значение, если оно изменилось
            if (converted !== val) {
                const cursorPos = input.selectionStart;
                input.value = converted;
                
                // Восстанавливаем позицию курсора
                const newCursor = Math.min(cursorPos, converted.length);
                input.setSelectionRange(newCursor, newCursor);
            }
            
            // Обновляем UI
            this.toggleClearBtn();
            this.triggerSearch(input.value);
        });

        // === ОБРАБОТЧИК keydown - только для специальных клавиш ===
        modalSearch.addEventListener('keydown', (e) => {
            // Backspace и Delete уже обрабатываются через input
            // Здесь только предотвращаем стандартное поведение для навигации
            const specialKeys = ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab', 'Escape', 'Enter'];
            
            if (e.key === 'Escape') {
                // Очистка или закрытие - обрабатывается в глобальном обработчике
                return;
            }
            
            if (e.key === 'Enter') {
                // Выбор первого элемента - обрабатывается в глобальном обработчике
                return;
            }
        });

        // === ОБРАБОТЧИК paste - на всякий случай, хотя input уже покрывает ===
        modalSearch.addEventListener('paste', (e) => {
            // Небольшая задержка, чтобы сработал input после вставки
            setTimeout(() => {
                const input = e.target;
                let val = input.value;
                
                let converted = '';
                for (let i = 0; i < val.length; i++) {
                    const char = val[i];
                    converted += this.layoutMap[char] || char.toUpperCase();
                }
                
                if (converted !== val) {
                    input.value = converted;
                }
                
                this.toggleClearBtn();
                this.triggerSearch(input.value);
            }, 10);
        });
    }

    // =========================================================================
    // 🔍 ТРИГГЕР ПОИСКА (с debounce и немедленным первым срабатыванием)
    // =========================================================================
    triggerSearch(query) {
        this.parent.state.modalSearchQuery = query;
        this.parent.state.modalPage = 0;
        
        // Очищаем предыдущий таймаут
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = null;
        }
        
        // Если запрос пустой - показываем результаты немедленно
        if (!query || query.length === 0) {
            this.updateModalResults(true);
            return;
        }
        
        // Для первой буквы - показываем быстрее (150ms вместо 300ms)
        const delay = query.length === 1 ? 150 : 300;
        
        this.searchTimeout = setTimeout(() => {
            this.updateModalResults(true);
            this.searchTimeout = null;
        }, delay);
    }

    // =========================================================================
    // ✕ ПОКАЗАТЬ/СКРЫТЬ КНОПКУ ОЧИСТКИ
    // =========================================================================
    toggleClearBtn() {
        const input = document.getElementById('modalSearchInput');
        const btn = document.getElementById('searchClearBtn');
        
        if (input && btn) {
            btn.style.display = input.value.length > 0 ? 'flex' : 'none';
        }
    }

    // =========================================================================
    // 🔒 ЗАКРЫТИЕ МОДАЛЬНОГО ОКНА
    // =========================================================================
    closeModal(modal, modalAddAllBtn) {
        if (modal) {
            modal.classList.remove('show');
        }
        
        this.parent.state.isAddingAllInProgress = false;
        this.parent.state.addingAllOffset = 0;
        
        if (modalAddAllBtn) {
            modalAddAllBtn.classList.remove('loading');
            modalAddAllBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Добавить все';
        }
        
        // Очищаем таймаут поиска при закрытии
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = null;
        }
    }

    // =========================================================================
    // 🔄 ОБНОВЛЕНИЕ АКТИВНЫХ КНОПОК БИРЖИ/РЫНКА
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

    // =========================================================================
    // 📋 ОБНОВЛЕНИЕ РЕЗУЛЬТАТОВ ПОИСКА
    // =========================================================================
   // =========================================================================
// 📋 ОБНОВЛЕНИЕ РЕЗУЛЬТАТОВ ПОИСКА - ИСПРАВЛЕНО (поиск ТОЛЬКО с начала)
// =========================================================================
updateModalResults(reset = false) {
    const resultsContainer = document.getElementById('modalResults');
    
    if (!resultsContainer) return;
    
    if (reset) {
        this.parent.state.modalPage = 0;
        // Сбрасываем скролл в начало при новом поиске
        resultsContainer.scrollTop = 0;
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
    
    // Фильтруем по поиску - ТОЛЬКО С НАЧАЛА ТИКЕРА!
    let filteredResults = [...source];
    
    if (this.parent.state.modalSearchQuery) {
        const query = this.parent.state.modalSearchQuery.toUpperCase();
        
        // ✅ ИСПРАВЛЕНО: ищем только тикеры, НАЧИНАЮЩИЕСЯ с запроса
        filteredResults = filteredResults.filter(s => s.symbol.startsWith(query));
        
        // Сортируем по алфавиту
        filteredResults.sort((a, b) => a.symbol.localeCompare(b.symbol));
    } else {
        // Если запрос пустой - тоже сортируем по алфавиту
        filteredResults.sort((a, b) => a.symbol.localeCompare(b.symbol));
    }
    
    // Сохраняем все результаты
    this.modalAllResults = filteredResults;
    
    // Обновляем счётчик
    const foundSpan = document.getElementById('modalFoundCount');
    if (foundSpan) {
        foundSpan.textContent = this.modalAllResults.length;
    }
    
    // Пагинация
    const pageSize = this.parent.state.modalPageSize || 50;
    const startIndex = reset ? 0 : this.parent.state.modalPage * pageSize;
    const endIndex = Math.min(startIndex + pageSize, this.modalAllResults.length);
    
    if (this.modalAllResults.length === 0) {
        resultsContainer.innerHTML = '<div class="no-results">Инструменты не найдены</div>';
        return;
    }
    
    const pageResults = this.modalAllResults.slice(startIndex, endIndex);
    
    if (!reset && startIndex < this.modalAllResults.length) {
        this.parent.state.modalPage++;
    }
    
    this.renderModalResults(pageResults, !reset && startIndex > 0);
}
    // =========================================================================
    // 🎨 РЕНДЕРИНГ РЕЗУЛЬТАТОВ ПОИСКА
    // =========================================================================
 renderModalResults(results, append = false) {
    const resultsContainer = document.getElementById('modalResults');
    
    if (!resultsContainer) return;
    
    if (results.length === 0 && !append) { 
        resultsContainer.innerHTML = '<div class="no-results">Инструменты не найдены</div>'; 
        return; 
    }
    
    let html = append ? resultsContainer.innerHTML : '';
    
    for (const symbolData of results) {
        if (!symbolData || !symbolData.symbol) continue;
        
        // Проверяем добавлен ли уже
        const isAdded = this.parent.tickers.some(t => 
            t.symbol === symbolData.symbol && 
            t.exchange === symbolData.exchange && 
            t.marketType === symbolData.marketType
        );
        
        const addedClass = isAdded ? 'added' : '';
        
        // ✅ ИСПРАВЛЕНО: Подсветка для ВСЕХ результатов
        let displaySymbol = symbolData.symbol;
        if (this.parent.state.modalSearchQuery) {
            const query = this.parent.state.modalSearchQuery.toUpperCase();
            const upperSymbol = symbolData.symbol.toUpperCase();
            const index = upperSymbol.indexOf(query);
            if (index >= 0) {
                displaySymbol = 
                    symbolData.symbol.substring(0, index) + 
                    '<span class="search-highlight">' + 
                    symbolData.symbol.substring(index, index + query.length) + 
                    '</span>' + 
                    symbolData.symbol.substring(index + query.length);
            }
        }
        
        // HTML иконки биржи (оставляем как у вас)
        let exchangeIconHtml = '';
        if (symbolData.exchange === 'binance') {
            exchangeIconHtml = `
                <div class="modal-exchange-icon binance-icon">
                    <svg width="20" height="20" viewBox="0 0 40 40" style="display:block;">
                        <circle cx="20" cy="20" r="19" fill="none" stroke="#F0B90B" stroke-width="1.5"/>
                        <g transform="translate(20, 20) scale(0.03)">
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
        
        // HTML элемента результата
        const exchangeLabel = symbolData.exchange === 'binance' ? 'Binance' : 'Bybit';
        const marketLabel = symbolData.marketType === 'futures' ? 'Futures' : 'Spot';
        
        if (isAdded) {
            html += `
                <div class="modal-result-item ${addedClass}" 
                     data-symbol="${symbolData.symbol}" 
                     data-exchange="${symbolData.exchange}" 
                     data-market-type="${symbolData.marketType}">
                    ${exchangeIconHtml}
                    <span class="modal-result-symbol">${displaySymbol}</span>
                    <div class="modal-result-exchange">
                        <span>${exchangeLabel} - ${marketLabel}</span>
                    </div>
                    <div class="modal-result-actions">
                        <span class="modal-check-icon"><i class="fas fa-check-circle"></i></span>
                        <span class="modal-target-btn" 
                              data-symbol="${symbolData.symbol}" 
                              data-exchange="${symbolData.exchange}" 
                              data-market-type="${symbolData.marketType}" 
                              title="Прицелиться">
                            <i class="fas fa-crosshairs"></i>
                        </span>
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="modal-result-item ${addedClass}" 
                     data-symbol="${symbolData.symbol}" 
                     data-exchange="${symbolData.exchange}" 
                     data-market-type="${symbolData.marketType}">
                    ${exchangeIconHtml}
                    <span class="modal-result-symbol">${displaySymbol}</span>
                    <div class="modal-result-exchange">
                        <span>${exchangeLabel} - ${marketLabel}</span>
                    </div>
                    <span class="modal-add-icon"><i class="fas fa-plus-circle"></i></span>
                </div>
            `;
        }
    }
    
    // Вставляем HTML
    resultsContainer.innerHTML = html;
    
    // Обработчики кликов на элементы
    this.attachResultHandlers();
    
    // Infinite scroll
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
    // =========================================================================
    // 🔗 ПРИВЯЗКА ОБРАБОТЧИКОВ К РЕЗУЛЬТАТАМ
    // =========================================================================
    attachResultHandlers() {
        // Обработчики кликов на элементы (не добавленные)
        document.querySelectorAll('.modal-result-item:not(.added)').forEach(item => {
            item.addEventListener('click', (e) => {
                // Игнорируем клики по кнопке прицеливания
                if (e.target.closest('.modal-target-btn')) return;
                
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
        
        // Обработчики кнопок "прицелиться"
        document.querySelectorAll('.modal-target-btn').forEach(btn => {
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
    // 🚀 ДОБАВЛЕНИЕ ВСЕХ ИНСТРУМЕНТОВ (batch add)
    // =========================================================================
    async addNextBatch() {
        if (!this.parent.state.isAddingAllInProgress) return;
        
        const modalAddAllBtn = document.getElementById('modalAddAllBtn');
        
        // Берём данные из того же источника
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
        
        // Применяем фильтр поиска
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

        // Первый батч — включаем защиту
        if (start === 0) {
            console.log('🛡️ ВКЛЮЧЕНА ЗАЩИТА от лишних запросов к API');
            this.parent._isBulkAdding = true;
            this.parent._suppressWatchlistLoad = true;
            this._startTime = Date.now();
        }

        // Добавляем текущую партию
        for (let i = start; i < end; i++) {
            const item = allPairs[i];
            if (item && item.symbol) {
                this.parent.addSymbol(
                    item.symbol, 
                    true, 
                    item.exchange, 
                    item.marketType, 
                    false,   // render=false
                    true,    // skipInitialFetch=true
                    true     // skipWatchlistSync=true
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

        // 1. Рендерим
        this.parent.filterCache = null;
        this.parent.renderTickerList();
        
        this._showNotification(`⏳ Синхронизация...`, '#ffa500');

        // 2. Синхронизируем вотчлист
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
        
        // 3. Сохраняем
        this.parent.saveState();

        // 4. Обновляем счётчик модалки
        const counterSpan = document.getElementById('modalFoundCount');
        if (counterSpan) counterSpan.textContent = this.parent.tickersMap.size;

        // 5. Загружаем цены
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
        
        console.log('📦 Распределение:');
        console.log(`   Binance Futures: ${groups.bnFut.length}`);
        console.log(`   Binance Spot: ${groups.bnSpot.length}`);
        console.log(`   Bybit Futures: ${groups.byFut.length}`);
        console.log(`   Bybit Spot: ${groups.bySpot.length}`);
        
        const BATCH_SIZE = 80;
        const DELAY_BETWEEN_BATCHES = 2000;
        let loaded = 0;
        
        try {
            if (groups.bnFut.length > 0) {
                console.log(`⚡ Загрузка Binance Futures (${groups.bnFut.length} шт.)...`);
                
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
                
                console.log(`✅ Binance Futures загружено`);
            }
            
            if (groups.bnFut.length > 0 && groups.bnSpot.length > 0) {
                console.log('⏸️ Пауза 2 сек перед Binance Spot...');
                await new Promise(r => setTimeout(r, 2000));
            }
            
            if (groups.bnSpot.length > 0) {
                console.log(`⚡ Загрузка Binance Spot (${groups.bnSpot.length} шт.)...`);
                
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
                
                console.log(`✅ Binance Spot загружено`);
            }
            
            const hasBinanceData = groups.bnFut.length > 0 || groups.bnSpot.length > 0;
            const hasBybitData = groups.byFut.length > 0 || groups.bySpot.length > 0;
            
            if (hasBinanceData && hasBybitData) {
                console.log('⏸️ Пауза 3 сек перед Bybit...');
                await new Promise(r => setTimeout(r, 3000));
            }
            
            if (groups.byFut.length > 0) {
                console.log(`⚡ Загрузка Bybit Futures (${groups.byFut.length} шт.)...`);
                
                await this._fetchBybit24hSafe(groups.byFut, 'futures');
                loaded += groups.byFut.length;
                
                const pct = Math.round((loaded / total) * 100);
                this._showNotification(`⏳ ${loaded}/${total} (${pct}%)`, '#ffa500');
                
                console.log(`✅ Bybit Futures загружено`);
                
                if (groups.bySpot.length > 0) {
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            
            if (groups.bySpot.length > 0) {
                console.log(`⚡ Загрузка Bybit Spot (${groups.bySpot.length} шт.)...`);
                
                await this._fetchBybit24hSafe(groups.bySpot, 'spot');
                loaded += groups.bySpot.length;
                
                console.log(`✅ Bybit Spot загружено`);
            }
            
            console.log(`💰 Обновление UI...`);
            
            this.parent.renderer?.updatePriceElements?.();
            this.parent.renderTickerList();
            
            this._showNotification(`✅ Готово! Загружено ${loaded} символов`, '#4caf50');
            console.log(`✅✅✅ ВСЁ ГОТОВО! Загружено ${loaded} из ${total} символов`);
            
            setTimeout(() => {
                const notif = document.getElementById('alertNotification');
                if (notif) notif.style.display = 'none';
            }, 3000);
            
        } catch (error) {
            console.error('❌ Критическая ошибка при загрузке цен:', error);
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
            
            if (!response.ok) {
                console.warn(`⚠️ Binance ${marketType} HTTP ${response.status}`);
                return;
            }
            
            const data = await response.json();
            
            if (Array.isArray(data)) {
                data.forEach(t => {
                    this.parent._updateTickerFromBinance(t, marketType);
                });
            }
            
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn(`⏰ Binance ${marketType}: таймаут запроса`);
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
            
            if (!response.ok) {
                console.warn(`⚠️ Bybit ${marketType} HTTP ${response.status}`);
                return;
            }
            
            const data = await response.json();
            
            if (data.retCode === 0 && data.result?.list) {
                const symbolSet = new Set(symbols);
                
                data.result.list.forEach(t => {
                    if (symbolSet.has(t.symbol)) {
                        this.parent._updateTickerFromBybit(t, marketType);
                    }
                });
            } else {
                console.warn(`⚠️ Bybit ${marketType} retCode:`, data.retCode);
            }
            
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn(`⏰ Bybit ${marketType}: таймаут запроса`);
            } else {
                console.warn(`⚠️ Bybit ${marketType} error:`, error.message);
            }
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
}

// Экспорт
if (typeof window !== 'undefined') {
    window.TickerModal = TickerModal;
}
