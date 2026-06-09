class TickerRenderer {
    constructor(parent) {
        this.parent = parent;
        this.rowHeight = 36;
        this.visibleCount = 30;
        this.tickerElements = new Map();
        this.displayedTickers = [];
        this.totalItems = 0;
        this._scrollHandler = null;
        this._renderScheduled = false;
        this._renderRafId = null;
        this._firstRender = true;
        this._updatePriceRaf = null;
        
        // Инжектим CSS для мигания
        this._injectFlashCSS();
    }
    
    // =========================================================================
    // 💫 CSS для мигания цены
    // =========================================================================
    _injectFlashCSS() {
        if (document.getElementById('tickerFlashCSS')) return;
        const style = document.createElement('style');
        style.id = 'tickerFlashCSS';
        style.textContent = `
            @keyframes flashGreen {
                0% { background-color: rgba(38, 166, 91, 0.5); }
                100% { background-color: transparent; }
            }
            @keyframes flashRed {
                0% { background-color: rgba(234, 57, 67, 0.5); }
                100% { background-color: transparent; }
            }
            .ticker-price.flash-up {
                animation: flashGreen 0.4s ease-out;
                border-radius: 2px;
            }
            .ticker-price.flash-down {
                animation: flashRed 0.4s ease-out;
                border-radius: 2px;
            }
        `;
        document.head.appendChild(style);
    }
    
    // =========================================================================
    // 💫 УНИВЕРСАЛЬНЫЙ МЕТОД ОБНОВЛЕНИЯ ЦЕНЫ С АНИМАЦИЕЙ
    // =========================================================================
    _updatePriceWithAnimation(priceEl, ticker) {
        if (!priceEl || !ticker) return false;
        
        const newPrice = this.formatPrice(ticker.price);
        
        // Если цена не изменилась - просто выходим
        if (priceEl.textContent === newPrice) return false;
        
        // Обновляем текст
        priceEl.textContent = newPrice;
        
        // Обновляем цвет
        const colorClass = ticker.change > 0 ? 'positive' : ticker.change < 0 ? 'negative' : '';
        
        // Определяем flash-класс
        let flashClass = null;
        if (ticker.prevPrice > 0 && ticker.prevPrice !== ticker.price) {
            flashClass = ticker.price > ticker.prevPrice ? 'flash-up' : 'flash-down';
        }
        
        // Собираем все классы
        const classes = ['ticker-price', colorClass];
        if (flashClass) classes.push(flashClass);
        
        // Применяем классы
        priceEl.className = classes.join(' ');
        
        // Если была анимация - сбрасываем и перезапускаем
        if (flashClass) {
            // Удаляем анимацию
            priceEl.classList.remove('flash-up', 'flash-down');
            
            // Форсируем reflow
            void priceEl.offsetWidth;
            
            // Запускаем анимацию заново
            priceEl.classList.add(flashClass);
            
            // Обновляем prevPrice после анимации
            ticker.prevPrice = ticker.price;
        }
        
        return true;
    }
    
    // =========================================================================
    // ⚡ RAF-троттлинг — DOM обновляется строго 1 раз за кадр (60fps)
    // =========================================================================
    updatePriceElements() {
        if (this._updatePriceRaf) return;
        this._updatePriceRaf = requestAnimationFrame(() => {
            this._updatePriceRaf = null;
            this._doUpdatePriceElements();
        });
    }
    
    _doUpdatePriceElements() {
        let domUpdates = 0;
        
        // Итерируемся по ВСЕМ созданным элементам
        for (const [key, el] of this.tickerElements.entries()) {
            if (!el || !el.isConnected) continue; // Элемент удален из DOM - пропускаем
            
            const ticker = this.parent.tickersMap.get(key);
            if (!ticker) continue;
            
            const priceEl = el.querySelector('.ticker-price');
            const changeEl = el.querySelector('.ticker-change');
            const volumeEl = el.querySelector('.ticker-volume');
            const tradesEl = el.querySelector('.ticker-trades');
            
            // ✅ Используем универсальный метод с анимацией
            if (priceEl) {
                const updated = this._updatePriceWithAnimation(priceEl, ticker);
                if (updated) domUpdates++;
            }
            
            const newChange = this.formatChange(ticker.change) + '%';
            if (changeEl && changeEl.textContent !== newChange) {
                changeEl.textContent = newChange;
                changeEl.className = `ticker-change ${ticker.change > 0 ? 'positive' : ticker.change < 0 ? 'negative' : ''}`;
                domUpdates++;
            }
            
            const newVolume = this.formatVolume(ticker.volume);
            if (volumeEl && volumeEl.textContent !== newVolume) {
                volumeEl.textContent = newVolume;
                domUpdates++;
            }
            
            const newTrades = this.formatTrades(ticker);
            if (tradesEl && tradesEl.textContent !== newTrades) {
                tradesEl.textContent = newTrades;
                domUpdates++;
            }
        }
        
        if (this.parent?.debugMode && domUpdates > 0) {
           
        }
    }
    
    // =========================================================================
    // 🔄 СОРТИРОВКА ТИКЕРОВ
    // =========================================================================
   // =========================================================================
// 🔄 СОРТИРОВКА ТИКЕРОВ (ВОЗВРАЩАЕТ НОВЫЙ МАССИВ)
// =========================================================================
sortTickers(tickers) {
    const arrayToSort = tickers || this.parent.tickers;
    
    if (!arrayToSort || !Array.isArray(arrayToSort)) {
        if (this.parent?.debugMode) {
            console.warn('⚠️ sortTickers: нет данных для сортировки');
        }
        return [];
    }
    
    if (!this.parent?.state?.sortBy) {
        return [...arrayToSort];
    }
    
    const sortBy = this.parent.state.sortBy;
    const direction = this.parent.state.sortDirection === 'asc' ? 1 : -1;
    
    // ✅ Приоритет флагов (обновлён с учётом lime и cyan)
    const flagPriority = {
        'red': 1,      // 🔴 Красный
        'yellow': 2,   // 🟡 Жёлтый
        'green': 3,    // 🟢 Зелёный
        'lime': 4,     // 🟢💚 Лайм
        'blue': 5,     // 🔵 Синий
        'cyan': 6,     // 💙 Бирюзовый
        'purple': 7,   // 🟣 Фиолетовый
        null: 999      // Без флага
    };
    
    const sorted = [...arrayToSort].sort((a, b) => {
        if (!a || !b) return 0;
        
        let result = 0;
        
        switch (sortBy) {
            case 'flag':
                // ✅ Сортировка по флагам
                const aFlag = a.flag || null;
                const bFlag = b.flag || null;
                const aPriority = flagPriority[aFlag];
                const bPriority = flagPriority[bFlag];
                result = aPriority - bPriority;
                break;
                
            case 'price':
                result = (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0);
                break;
                
            case 'change':
                result = (parseFloat(a.change) || 0) - (parseFloat(b.change) || 0);
                break;
                
            case 'volume':
                const aVol = parseFloat(a.volume) || 0;
                const bVol = parseFloat(b.volume) || 0;
                result = aVol - bVol;
                break;
                
            case 'trades':
                result = (parseInt(a.trades) || 0) - (parseInt(b.trades) || 0);
                break;
                
            default:
                result = 0;
        }
        
        return direction * result;
    });
    
    if (this.parent?.debugMode && sortBy === 'flag' && sorted.length > 0) {
        console.log('🏁 Сортировка по флагам:', 
            sorted.slice(0, 5).map(t => `${t.symbol}: ${t.flag || 'нет'}`)
        );
    }
    
    return sorted;
}
    
    // =========================================================================
    // 📋 ПОЛУЧИТЬ ОТФИЛЬТРОВАННЫЕ (И ОТСОРТИРОВАННЫЕ!) ТИКЕРЫ
    // =========================================================================
   getFilteredTickers() {
    const cacheKey = `${this.parent.state?.marketFilter || 'all'}:${this.parent.state?.exchangeFilter || 'all'}:${this.parent.state?.activeTab || 'all'}:${this.parent.state?.sortBy || 'volume'}:${this.parent.state?.sortDirection || 'desc'}`;
    
    if (this.parent.filterCache && this.parent.filterCache.key === cacheKey) {
        return this.parent.filterCache.result;
    }
    
    let result = [];
    const state = this.parent.state;
    
    try {
        switch (state?.activeTab) {
            case 'favorites':
                const favSet = new Set(state.favorites || []);
                result = Array.from(this.parent.tickersMap.values()).filter(t => 
                    favSet.has(t.symbol)
                );
                break;
                
            case 'flags':
                const flags = state.flags || {};
                const flagTab = state.activeFlagTab;
                
                result = Object.entries(flags)
                    .filter(([, flag]) => flag && (!flagTab || flag === flagTab))
                    .map(([key]) => this.parent.tickersMap.get(key))
                    .filter(t => t !== undefined);
                break;
                
            default:
                const sourceKeys = state.customSymbols || [];
                
                if (sourceKeys.length === 0) {
                    console.warn('⚠️ customSymbols пустой! Используем tickersMap');
                    result = Array.from(this.parent.tickersMap.values());
                } else {
                    let filteredKeys = [...sourceKeys];
                    
                    if (state.marketFilter && state.marketFilter !== 'all') {
                        filteredKeys = filteredKeys.filter(k => k.endsWith(':' + state.marketFilter));
                    }
                    
                    if (state.exchangeFilter && state.exchangeFilter !== 'all') {
                        filteredKeys = filteredKeys.filter(k => {
                            const parts = k.split(':');
                            return parts[1] === state.exchangeFilter;
                        });
                    }
                    
                    result = filteredKeys
                        .map(key => this.parent.tickersMap.get(key))
                        .filter(t => t !== undefined);
                }
                break;
        }
        
        const sortBy = state.sortBy || 'volume';
        const direction = state.sortDirection === 'asc' ? 1 : -1;
        
        // ✅ Приоритет флагов (обновлён)
        const flagPriority = {
            'red': 1,
            'yellow': 2,
            'green': 3,
            'lime': 4,
            'blue': 5,
            'cyan': 6,
            'purple': 7,
            null: 999
        };
        
        result.sort((a, b) => {
            if (!a || !b) return 0;
            
            let res = 0;
            switch (sortBy) {
                case 'flag':
                    const aFlag = a.flag || null;
                    const bFlag = b.flag || null;
                    res = (flagPriority[aFlag] || 999) - (flagPriority[bFlag] || 999);
                    break;
                case 'price':
                    res = (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0);
                    break;
                case 'change':
                    res = (parseFloat(a.change) || 0) - (parseFloat(b.change) || 0);
                    break;
                case 'volume':
                    res = (parseFloat(a.volume) || 0) - (parseFloat(b.volume || 0));
                    break;
                case 'trades':
                    res = (parseInt(a.trades) || 0) - (parseInt(b.trades) || 0);
                    break;
                default:
                    res = 0;
            }
            
            return direction * res;
        });
        
    } catch (error) {
        console.error('❌ Ошибка getFilteredTickers:', error);
        result = Array.from(this.parent.tickersMap.values());
    }
    
    this.displayedTickers = result;
    this.totalItems = result.length;
    
    this.parent.filterCache = { key: cacheKey, result };
    
    return result;
}
    // =========================================================================
    // 🎨 ГЛАВНЫЙ МЕТОД РЕНДЕРИНГА СПИСКА
  // ============================================
// ✅ ИСПРАВЛЕННЫЙ renderTickerList (замени полностью)
// ============================================

renderTickerList() {
    // ✅ ЗАЩИТА ОТ ПОВТОРНОГО ВЫЗОВА В ОДНОМ КАДРЕ
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    
    requestAnimationFrame(() => {
        this._renderScheduled = false;
        
        const flagTabs = document.getElementById('flagTabs');
        if (flagTabs) {
            flagTabs.classList.toggle('show', this.parent.state.activeTab === 'flags');
        }

        const container = document.getElementById('tickerListContainer');
        if (!container) return;

        const displayed = this.getFilteredTickers();
        this.displayedTickers = displayed;
        this.totalItems = displayed.length;

        if (this._scrollHandler) {
            container.removeEventListener('scroll', this._scrollHandler);
        }
        
        const spacer = container.querySelector('.ticker-spacer');
        if (spacer) spacer.remove();
        
        const itemsContainer = container.querySelector('.ticker-items-container');
        if (itemsContainer) itemsContainer.remove();
        
        this.tickerElements.clear();

        container.style.position = 'relative';
        container.style.overflowY = 'auto';
        
        const newSpacer = document.createElement('div');
        newSpacer.className = 'ticker-spacer';
        newSpacer.style.height = (this.totalItems * this.rowHeight) + 'px';
        newSpacer.style.width = '100%';
        newSpacer.style.pointerEvents = 'none';
        container.appendChild(newSpacer);
        
        const newItemsContainer = document.createElement('div');
        newItemsContainer.className = 'ticker-items-container';
        newItemsContainer.style.position = 'absolute';
        newItemsContainer.style.top = '0';
        newItemsContainer.style.left = '0';
        newItemsContainer.style.right = '0';
        container.appendChild(newItemsContainer);
        
        this.renderVisibleTickers();

        this._scrollHandler = () => {
            this.renderVisibleTickers();
        };
        container.addEventListener('scroll', this._scrollHandler);
    });
}
    // =========================================================================
    // 📜 РЕНДЕРИНГ ВИДИМЫХ ЭЛЕМЕНТОВ (виртуальный скроллинг)
    // =========================================================================
    renderVisibleTickers() {
        const container = document.getElementById('tickerListContainer');
        if (!container || !this.displayedTickers || this.totalItems === 0) return;
        
        const itemsContainer = container.querySelector('.ticker-items-container');
        if (!itemsContainer) return;
        
        const scrollTop = container.scrollTop;
        const startIndex = Math.max(0, Math.floor(scrollTop / this.rowHeight));
        const endIndex = Math.min(startIndex + this.visibleCount + 10, this.totalItems);
        
        if (startIndex >= endIndex) return;
        
        const visibleKeys = new Set();
        const fragment = document.createDocumentFragment();
        
        for (let i = startIndex; i < endIndex; i++) {
            const ticker = this.displayedTickers[i];
            if (!ticker) continue;
            
            const key = `${ticker.symbol}:${ticker.exchange}:${ticker.marketType}`;
            visibleKeys.add(key);
            
            let el = this.tickerElements.get(key);
            const isNewElement = !el;
            
            // Создаём новый элемент если нужно
            if (isNewElement) {
                el = this.createTickerElement(ticker, i);
                this.tickerElements.set(key, el);
            }
            
            // Позиционируем элемент
            el.style.position = 'absolute';
            el.style.top = (i * this.rowHeight) + 'px';
            el.style.left = '0';
            el.style.right = '0';
            el.style.width = '100%';
            el.style.display = '';
            
            // ✅ Обновляем данные в существующем элементе С АНИМАЦИЕЙ
            if (!isNewElement) {
                const priceEl = el.querySelector('.ticker-price');
                const changeEl = el.querySelector('.ticker-change');
                const volumeEl = el.querySelector('.ticker-volume');
                const tradesEl = el.querySelector('.ticker-trades');
                
                // ✅ ИСПОЛЬЗУЕМ УНИВЕРСАЛЬНЫЙ МЕТОД С АНИМАЦИЕЙ
                if (priceEl) {
                    this._updatePriceWithAnimation(priceEl, ticker);
                }
                
                if (changeEl) {
                    changeEl.textContent = this.formatChange(ticker.change) + '%';
                    changeEl.className = `ticker-change ${ticker.change > 0 ? 'positive' : ticker.change < 0 ? 'negative' : ''}`;
                }
                if (volumeEl) volumeEl.textContent = this.formatVolume(ticker.volume);
                if (tradesEl) tradesEl.textContent = this.formatTrades(ticker);
            }
            
            // Добавляем в DOM если ещё не добавлен
            if (!el.parentNode) {
                fragment.appendChild(el);
            }
        }
        
        // Batch DOM update
        if (fragment.hasChildNodes()) {
            itemsContainer.appendChild(fragment);
        }
        
        // Скрываем невидимые элементы (для быстрого скролла)
        for (const [key, el] of this.tickerElements.entries()) {
            if (!visibleKeys.has(key)) {
                el.style.display = 'none';
            }
        }
    }
    
    // =========================================================================
    // 📦 СОЗДАНИЕ DOM-ЭЛЕМЕНТА ТИКЕРА
    // =========================================================================
    createTickerElement(ticker, index) {
        const div = document.createElement('div');
        div.className = `ticker-item ${ticker.symbol === this.parent.state.currentSymbol && 
            ticker.exchange === this.parent.state.currentExchange && 
            ticker.marketType === this.parent.state.currentMarketType ? 'active' : ''}`;
        div.dataset.symbol = ticker.symbol;
        div.dataset.exchange = ticker.exchange;
        div.dataset.marketType = ticker.marketType;
        div.style.display = 'grid';
        div.style.gridTemplateColumns = '1.3fr 1fr 0.7fr 0.8fr 0.7fr';
        div.style.alignItems = 'center';
        div.style.gap = '4px';
        div.style.padding = '6px 8px';
        div.style.minHeight = '36px';
        div.style.borderBottom = '1px solid #2B3139';

        // ✅ Инициализируем prevPrice при создании
        if (!ticker.prevPrice && ticker.price > 0) {
            ticker.prevPrice = ticker.price;
        }

        // Ручка для перетаскивания
        const dragHandle = document.createElement('div');
        dragHandle.className = 'drag-handle';
        dragHandle.title = 'ПКМ → перетащить';
        div.appendChild(dragHandle);

        // Флаг
        const flag = this.parent.state.flags[`${ticker.symbol}:${ticker.exchange}:${ticker.marketType}`] || null;
        const flagHTML = flag ? 
            `<div class="flag flag-${flag}"></div>` : 
            '<div class="flag-placeholder"></div>';

        // Избранное и маркер рынка
        const isFavorite = this.parent.state.favorites.includes(ticker.symbol) ? 'favorite' : '';
        const markerLetter = ticker.marketType === 'futures' ? 'F' : 'S';
        const markerClass = ticker.marketType === 'futures' ? 'futures' : 'spot';
        
        // Отображаемое имя
        let displayName = ticker.symbol.replace('USDT', '');
        const match = displayName.match(/^(\d+)([A-Z]+)$/);
        if (match) displayName = '1' + match[2];
        else if (displayName.length > 8) displayName = displayName.substring(0, 7) + '…';

        // Цвет цены
        const priceClass = ticker.change > 0 ? 'positive' : (ticker.change < 0 ? 'negative' : '');

        // HTML содержимое
        div.innerHTML = `
            <div class="ticker-name" style="display:flex;align-items:center;gap:4px;overflow:hidden;" data-ctx="symbol">
                ${flagHTML}
                <sup class="market-sup ${markerClass}" style="font-size:7px;font-weight:bold;margin-right:2px;flex-shrink:0;" data-ctx="block">${markerLetter}</sup>
                <span class="symbol-text" title="${ticker.symbol}" style="font-size:0.75rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;">${displayName}</span>
                <span class="star ${isFavorite}" data-symbol="${ticker.symbol}" title="Избранное" style="flex-shrink:0;margin-left:2px;" data-ctx="block">★</span>
            </div>
            <div class="ticker-price ${priceClass}" style="text-align:right;white-space:nowrap;font-size:0.7rem;font-family:monospace;" data-ctx="block">${this.formatPrice(ticker.price)}</div>
            <div class="ticker-change ${priceClass}" style="text-align:right;white-space:nowrap;font-size:0.7rem;font-family:monospace;" data-ctx="block">${this.formatChange(ticker.change)}%</div>
            <div class="ticker-volume" style="text-align:right;white-space:nowrap;font-size:0.7rem;font-family:monospace;" data-ctx="block">${this.formatVolume(ticker.volume)}</div>
            <div class="ticker-trades" style="text-align:right;white-space:nowrap;font-size:0.7rem;font-family:monospace;" data-ctx="block">${this.formatTrades(ticker)}</div>
        `;

        return div;
    }
    
    // =========================================================================
    // 💰 ФОРМАТИРОВАНИЕ ЦЕНЫ
    // =========================================================================
    formatPrice(price) {
        if (!price || price <= 0) return '...';
        
        const now = Date.now();
        const cached = this.parent.formatCache.prices.get(price);
        if (cached && (now - cached.timestamp) < this.parent.cacheMaxAge) {
            return cached.value;
        }
        
        let result;
        
        if (price < 0.001) {
            const priceStr = price.toFixed(10);
            const match = priceStr.match(/^0\.(0+)(.+)$/);
            if (match && match[1].length >= 3) {
                const zeros = match[1].length;
                const digits = match[2].replace(/0+$/, '');
                if (digits.length === 0) {
                    result = price.toFixed(zeros + 2);
                } else {
                    const subScript = '₀₁₂₃₄₅₆₇₈₉';
                    const zeroSub = String(zeros).split('').map(d => subScript[parseInt(d)]).join('');
                    result = `0.0${zeroSub}${digits}`;
                }
            } else {
                result = this._formatAsIs(price);
            }
        } else {
            result = this._formatAsIs(price);
        }
        
        this.parent.formatCache.prices.set(price, { value: result, timestamp: now });
        if (this.parent.formatCache.prices.size > 500) {
            const oldestKey = this.parent.formatCache.prices.keys().next().value;
            this.parent.formatCache.prices.delete(oldestKey);
        }
        
        return result;
    }

    _formatAsIs(price) {
        let str = price.toFixed(8);
        str = str.replace(/\.?0+$/, '');
        if (!str.includes('.')) {
            str += '.00';
        } else {
            const parts = str.split('.');
            if (parts[1].length < 2) {
                str = str.padEnd(str.length + (2 - parts[1].length), '0');
            }
        }
        return str;
    }
    
    // =========================================================================
    // 📈 ФОРМАТИРОВАНИЕ ИЗМЕНЕНИЯ %
    // =========================================================================
    formatChange(change) {
        if (change === undefined || change === null) return '0.00';
        
        const now = Date.now();
        const cached = this.parent.formatCache.changes.get(change);
        
        if (cached && (now - cached.timestamp) < this.parent.cacheMaxAge) {
            return cached.value;
        }
        
        const result = (change > 0 ? '+' : '') + change.toFixed(2);
        
        this.parent.formatCache.changes.set(change, { value: result, timestamp: now });
        
        if (this.parent.formatCache.changes.size > 500) {
            const oldestKey = this.parent.formatCache.changes.keys().next().value;
            this.parent.formatCache.changes.delete(oldestKey);
        }
        
        return result;
    }
    
    // =========================================================================
    // 📊 ФОРМАТИРОВАНИЕ ОБЪЁМА
    // =========================================================================
    formatVolume(volume) {
        if (!volume || volume === 0) return '0';
        
        const now = Date.now();
        const cached = this.parent.formatCache.volumes.get(volume);
        
        if (cached && (now - cached.timestamp) < this.parent.cacheMaxAge) {
            return cached.value;
        }
        
        let result;
        if (volume >= 1e9) result = (volume / 1e9).toFixed(2) + 'B';
        else if (volume >= 1e6) result = (volume / 1e6).toFixed(2) + 'M';
        else if (volume >= 1e3) result = (volume / 1e3).toFixed(2) + 'K';
        else if (volume < 1) result = volume.toFixed(4);
        else result = volume.toFixed(2);
        
        this.parent.formatCache.volumes.set(volume, { value: result, timestamp: now });
        
        if (this.parent.formatCache.volumes.size > 500) {
            const oldestKey = this.parent.formatCache.volumes.keys().next().value;
            this.parent.formatCache.volumes.delete(oldestKey);
        }
        
        return result;
    }
    
    // =========================================================================
    // 🔢 ФОРМАТИРОВАНИЕ КОЛИЧЕСТВА СДЕЛОК
    // =========================================================================
    formatTrades(ticker) {
        if (ticker.exchange !== 'binance' || !ticker.trades || ticker.trades <= 0) return '—';
        if (ticker.trades > 1e9) return (ticker.trades / 1e9).toFixed(1) + 'B';
        if (ticker.trades > 1e6) return (ticker.trades / 1e6).toFixed(1) + 'M';
        if (ticker.trades > 1e3) return (ticker.trades / 1e3).toFixed(1) + 'K';
        return ticker.trades.toString();
    }
    
    // =========================================================================
    // 🧹 ОЧИСТКА КЭША ФОРМАТИРОВАНИЯ
    // =========================================================================
    startCacheCleanup() {
        setInterval(() => {
            const now = Date.now();
            
            for (const cache of [this.parent.formatCache.prices, this.parent.formatCache.changes, this.parent.formatCache.volumes]) {
                for (const [key, value] of cache) {
                    if (now - value.timestamp > this.parent.cacheMaxAge) {
                        cache.delete(key);
                    }
                }
            }
        }, 30000);
    }
    
    // =========================================================================
    // ⬆️⬇️ НАСТРОЙКА СОРТИРОВКИ ПО ЗАГОЛОВКАМ
    // =========================================================================
  // В методе setupHeaderSorting() - убираем смену направления
setupHeaderSorting() {
    if (this.parent._sortClickHandler) {
        document.querySelectorAll('.table-header span[data-sort]').forEach(header => {
            header.removeEventListener('click', this.parent._sortClickHandler);
        });
    }
    
    const savedSortBy = localStorage.getItem('tickerSortBy');
    const savedSortDir = localStorage.getItem('tickerSortDir');
    
    // ✅ ЗДЕСЬ - убрал 'name', добавил 'flag'
    const VALID_SORT_FIELDS = ['flag', 'price', 'change', 'volume', 'trades'];
    const VALID_DIRECTIONS = ['asc', 'desc'];
    
    this.parent.state.sortBy = VALID_SORT_FIELDS.includes(savedSortBy) 
        ? savedSortBy 
        : 'volume';
    
    this.parent.state.sortDirection = VALID_DIRECTIONS.includes(savedSortDir) 
        ? savedSortDir 
        : 'desc';
    
   this.parent._sortClickHandler = (e) => {
    e.stopPropagation();
    
    const header = e.currentTarget;
    const sortBy = header.dataset.sort;
    
    if (this.parent.state.sortBy === sortBy) {
        this.parent.state.sortDirection = this.parent.state.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        this.parent.state.sortBy = sortBy;
        // ✅ ЗДЕСЬ - вместо 'name' теперь 'flag'
        this.parent.state.sortDirection = sortBy === 'flag' ? 'asc' : 'desc';
    }
    
    localStorage.setItem('tickerSortBy', this.parent.state.sortBy);
    localStorage.setItem('tickerSortDir', this.parent.state.sortDirection);
    
    // ✅ ИСПРАВЛЕННАЯ СТРОКА - сохраняем через watchlistManager
    if (this.parent.watchlistManager) {
        this.parent.watchlistManager._saveSortForList(this.parent.watchlistManager.activeListId);
    }
    
    document.querySelectorAll('.table-header span[data-sort] i').forEach(icon => {
        icon.className = 'fas fa-sort';
    });
    
    const icon = header.querySelector('i');
    if (icon) {
        icon.className = this.parent.state.sortDirection === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
    }
    
    this.parent.filterCache = null;
    this.parent.renderTickerList();
};
    document.querySelectorAll('.table-header span[data-sort]').forEach(header => {
        header.addEventListener('click', this.parent._sortClickHandler);
        
        // Скрываем иконку у заголовка "Флаг"
        if (header.dataset.sort === 'flag') {
            const icon = header.querySelector('i');
            if (icon) icon.style.display = 'none';
        }
    });
    
    const activeHeader = document.querySelector(`.table-header span[data-sort="${this.parent.state.sortBy}"]`);
    if (activeHeader) {
        const icon = activeHeader.querySelector('i');
        if (icon) {
            icon.className = this.parent.state.sortDirection === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
            // Скрываем иконку у флага если он активный
            if (this.parent.state.sortBy === 'flag') {
                icon.style.display = 'none';
            }
        }
    }
}
}

// Экспорт
if (typeof window !== 'undefined') {
    window.TickerRenderer = TickerRenderer;
}
