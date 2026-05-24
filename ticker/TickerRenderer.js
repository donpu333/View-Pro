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
        this._updatePriceRaf = null; // RAF-троттлинг
        
        // Инжектим CSS для мигания один раз
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
            
            const newPrice = this.formatPrice(ticker.price);
            const newChange = this.formatChange(ticker.change) + '%';
            const newVolume = this.formatVolume(ticker.volume);
            const newTrades = this.formatTrades(ticker);
            
            if (priceEl && priceEl.textContent !== newPrice) {
                priceEl.textContent = newPrice;
                const colorClass = ticker.change > 0 ? 'positive' : ticker.change < 0 ? 'negative' : '';
                priceEl.className = `ticker-price ${colorClass}`;
                
                if (ticker.prevPrice > 0 && ticker.prevPrice !== ticker.price) {
                    const flashClass = ticker.price > ticker.prevPrice ? 'flash-up' : 'flash-down';
                    priceEl.classList.remove('flash-up', 'flash-down');
                    void priceEl.offsetWidth; 
                    priceEl.classList.add(flashClass);
                    ticker.prevPrice = ticker.price;
                }
                domUpdates++;
            }
            if (changeEl && changeEl.textContent !== newChange) {
                changeEl.textContent = newChange;
                changeEl.className = `ticker-change ${ticker.change > 0 ? 'positive' : ticker.change < 0 ? 'negative' : ''}`;
                domUpdates++;
            }
            if (volumeEl && volumeEl.textContent !== newVolume) {
                volumeEl.textContent = newVolume;
                domUpdates++;
            }
            if (tradesEl && tradesEl.textContent !== newTrades) {
                tradesEl.textContent = newTrades;
                domUpdates++;
            }
        }
        
    }
    
    // =========================================================================
    // 🔄 СОРТИРОВКА ТИКЕРОВ (ИСПРАВЛЕНА! Работает с/без аргумента)
    // =========================================================================
    /**
     * Сортировка тикеров по выбранному критерию
     * @param {Array} [tickers] - Опциональный массив для сортировки.
     *                            Если не передан — сортирует this.parent.tickers
     * @returns {Array} Отсортированный массив
     */
    sortTickers(tickers) {
        // ✅ Если массив не передан — сортируем основной массив this.parent.tickers
        const arrayToSort = tickers || this.parent.tickers;
        
        // ✅ Защита: проверяем что есть что сортировать
        if (!arrayToSort || !Array.isArray(arrayToSort)) {
            if (this.parent?.debugMode) {
                console.warn('⚠️ sortTickers: нет данных для сортировки');
            }
            return Array.isArray(arrayToSort) ? arrayToSort : [];
        }
        
        // ✅ Защита: проверяем настройки сортировки
        if (!this.parent?.state?.sortBy) {
            return arrayToSort;
        }
        
        const sortBy = this.parent.state.sortBy;
        const direction = this.parent.state.sortDirection === 'asc' ? 1 : -1;
        
        if (this.parent?.debugMode) {
            console.log(`🔄 Сортировка: ${sortBy} (${direction === 1 ? '↑ ASC' : '↓ DESC'}), элементов: ${arrayToSort.length}`);
        }
        
        // Создаём НОВЫЙ отсортированный массив (не мутируем оригинал!)
        const sorted = [...arrayToSort].sort((a, b) => {
            if (!a || !b) return 0;
            
            let result = 0;
            
            switch (sortBy) {
                case 'name':
                    result = (a.symbol || '').localeCompare(b.symbol || '');
                    break;
                case 'price':
                    result = (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0);
                    break;
                case 'change':
                    result = (parseFloat(a.change) || 0) - (parseFloat(b.change) || 0);
                    break;
                case 'volume': // ⭐ ПО ОБЪЁМУ!
                    result = (parseFloat(a.volume) || 0) - (parseFloat(b.volume) || 0);
                    break;
                case 'trades':
                    result = (parseInt(a.trades) || 0) - (parseInt(b.trades) || 0);
                    break;
                default:
                    result = 0;
            }
            
            return direction * result; // asc = 1, desc = -1
        });
        
        // ✅ Если сортировали this.parent.tickets — заменяем его на отсортированный!
        if (!tickers && arrayToSort === this.parent.tickers) {
            this.parent.tickers.length = 0;
            this.parent.tickers.push(...sorted);
            
            // Сбрасываем кэш фильтрации (важно после сортировки!)
            this.parent.filterCache = null;
            
            if (this.parent?.debugMode) {
                console.log(`✅ this.parent.tickers обновлён (отсортировано по ${sortBy})`);
                
                // Диагностика топ-3
                if (sortBy === 'volume' && sorted.length > 0) {
                    console.log('🏆 Топ-3:', 
                        sorted.slice(0, 3).map(t => `${t.symbol}: $${(t.volume / 1e9).toFixed(2)}B`)
                    );
                }
            }
        }
        
        return sorted;
    }
    
    // =========================================================================
    // 📋 ПОЛУЧИТЬ ОТФИЛЬТРОВАННЫЕ (И ОТСОРТИРОВАННЫЕ!) ТИКЕРЫ
    // =========================================================================
   getFilteredTickers() {
    const cacheKey = `${this.parent.state?.marketFilter || 'all'}:${this.parent.state?.exchangeFilter || 'all'}:${this.parent.state?.activeTab || 'all'}:${this.parent.state?.sortBy || 'volume'}:${this.parent.state?.sortDirection || 'desc'}`;
    
    // Из кэша
    if (this.parent.filterCache && this.parent.filterCache.key === cacheKey) {
        return this.parent.filterCache.result;
    }
    
    let result = [];
    const state = this.parent.state;
    
    try {
        // ✅ Выбираем источник данных
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
                // ✅✅✅ ОСНОВНОЙ СПИСОК — надёжный способ!
                
                // Берём ключи из state.customSymbols (где они точно есть!)
                const sourceKeys = state.customSymbols || [];
                
                if (sourceKeys.length === 0) {
                    // Если пустой — берём ВСЕ из tickersMap
                    console.warn('⚠️ customSymbols пустой! Используем tickersMap');
                    result = Array.from(this.parent.tickersMap.values());
                } else {
                    // Фильтруем по бирже/рынку (работаем со строками)
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
                    
                    // ✅ Получаем объекты из Map
                    result = filteredKeys
                        .map(key => this.parent.tickersMap.get(key))
                        .filter(t => t !== undefined);
                }
                break;
        }
        
        // ✅ СОРТИРОВКА
        const sortBy = state.sortBy || 'volume';
        const direction = state.sortDirection === 'asc' ? 1 : -1;
        
        result.sort((a, b) => {
            if (!a || !b) return 0;
            
            let res = 0;
            switch (sortBy) {
                case 'name':   res = (a.symbol||'').localeCompare(b.symbol||''); break;
                case 'price':  res = (parseFloat(a.price)||0) - (parseFloat(b.price)||0); break;
                case 'change': res = (parseFloat(a.change)||0) - (parseFloat(b.change)||0); break;
                case 'volume': res = (parseFloat(a.volume)||0) - (parseFloat(b.volume||0)); break;
                case 'trades': res = (parseInt(a.trades)||0) - (parseInt(b.trades)||0); break;
            }
            
            return direction * res;
        });
        
    } catch (error) {
        console.error('❌ Ошибка getFilteredTickers:', error);
        
        // Fallback: возвращаем всё из tickersMap
        result = Array.from(this.parent.tickersMap.values());
    }
    
    // Сохраняем
    this.displayedTickers = result;
    this.totalItems = result.length;
    
    // Кэшируем
    this.parent.filterCache = { key: cacheKey, result };
    
    return result;
}
    
    // =========================================================================
    // 🎨 ГЛАВНЫЙ МЕТОД РЕНДЕРИНГА СПИСКА
    // =========================================================================
    renderTickerList() {
        // Управление вкладками флагов
        const flagTabs = document.getElementById('flagTabs');
        if (flagTabs) {
            flagTabs.classList.toggle('show', this.parent.state.activeTab === 'flags');
        }

        const container = document.getElementById('tickerListContainer');
        if (!container) return;

        // ✅ Получаем отфильтрованные И отсортированные тикеры
        const displayed = this.getFilteredTickers();
        this.displayedTickers = displayed;
        this.totalItems = displayed.length;

        // Чистим старые обработчики скролла
        if (this._scrollHandler) {
            container.removeEventListener('scroll', this._scrollHandler);
        }
        
        // Удаляем старые элементы
        const spacer = container.querySelector('.ticker-spacer');
        if (spacer) spacer.remove();
        
        const itemsContainer = container.querySelector('.ticker-items-container');
        if (itemsContainer) itemsContainer.remove();
        
        // Очищаем кэш DOM-элементов
        this.tickerElements.clear();

     

        // Настройка контейнера для виртуального скроллинга
        container.style.position = 'relative';
        container.style.overflowY = 'auto';
        
        // Spacer (задаёт полную высоту для скроллбара)
        const newSpacer = document.createElement('div');
        newSpacer.className = 'ticker-spacer';
        newSpacer.style.height = (this.totalItems * this.rowHeight) + 'px';
        newSpacer.style.width = '100%';
        newSpacer.style.pointerEvents = 'none';
        container.appendChild(newSpacer);
        
        // Контейнер для видимых элементов (absolute positioning)
        const newItemsContainer = document.createElement('div');
        newItemsContainer.className = 'ticker-items-container';
        newItemsContainer.style.position = 'absolute';
        newItemsContainer.style.top = '0';
        newItemsContainer.style.left = '0';
        newItemsContainer.style.right = '0';
        container.appendChild(newItemsContainer);
        
        // Первый рендеринг видимых элементов
        this.renderVisibleTickers();

        // Обработчик скролла (виртуальный скроллинг)
        this._scrollHandler = () => {
            this.renderVisibleTickers();
        };
        container.addEventListener('scroll', this._scrollHandler);
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
            
            // Обновляем данные в существующем элементе
            if (!isNewElement) {
                const priceEl = el.querySelector('.ticker-price');
                const changeEl = el.querySelector('.ticker-change');
                const volumeEl = el.querySelector('.ticker-volume');
                const tradesEl = el.querySelector('.ticker-trades');
                
                if (priceEl) priceEl.textContent = this.formatPrice(ticker.price);
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

        // Ручка для перетаскивания (ПКМ как в TradingView)
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
        
        // Отображаемое имя (укороченное)
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
    // 💰 ФОРМАТИРОВАНИЕ ЦЕНЫ (с подстрочной нотацией для мелких цен)
    // =========================================================================
    formatPrice(price) {
        if (!price || price <= 0) return '...';
        
        const now = Date.now();
        const cached = this.parent.formatCache.prices.get(price);
        if (cached && (now - cached.timestamp) < this.parent.cacheMaxAge) {
            return cached.value;
        }
        
        let result;
        
        // Подстрочная нотация для очень маленьких цен (< 0.001)
        // 0.00002534 → "0.0₄2534"
        // 0.00000089 → "0.0₆89"
        if (price < 0.001) {
            const priceStr = price.toFixed(10);
            const match = priceStr.match(/^0\.(0+)(.+)$/);
            if (match && match[1].length >= 3) { // минимум 3 нуля
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
        
        // Кэшируем
        this.parent.formatCache.prices.set(price, { value: result, timestamp: now });
        if (this.parent.formatCache.prices.size > 500) {
            const oldestKey = this.parent.formatCache.prices.keys().next().value;
            this.parent.formatCache.prices.delete(oldestKey);
        }
        
        return result;
    }

    /**
     * Форматирование "как приходит" — без лишних нулей
     */
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
    // 📊 ФОРМАТИРОВАНИЯ ОБЪЁМА
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
    // 🔢 ФОРМАТИРОВАНИЯ КОЛИЧЕСТВА СДЕЛОК
    // =========================================================================
    formatTrades(ticker) {
        if (ticker.exchange !== 'binance' || !ticker.trades || ticker.trades <= 0) return '—';
        if (ticker.trades > 1e9) return (ticker.trades / 1e9).toFixed(1) + 'B';
        if (ticker.trades > 1e6) return (ticker.trades / 1e6).toFixed(1) + 'M';
        if (ticker.trades > 1e3) return (ticker.trades / 1e3).toFixed(1) + 'K';
        return ticker.trades.toString();
    }
    
    // =========================================================================
    // 🧹 ОЧИСТКА КЭША ФОРМАТИРОВАНИЯ (каждые 30 сек)
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
    // ⬆️⬇️ НАСТРОЙКА СОРТИРОВКИ ПО ЗАГОЛОВКАМ ТАБЛИЦЫ
    // =========================================================================
    setupHeaderSorting() {
        // Удаляем старые обработчики
        if (this.parent._sortClickHandler) {
            document.querySelectorAll('.table-header span[data-sort]').forEach(header => {
                header.removeEventListener('click', this.parent._sortClickHandler);
            });
        }
        
        // Восстанавливаем сохранённую сортировку
        const savedSortBy = localStorage.getItem('tickerSortBy');
        const savedSortDir = localStorage.getItem('tickerSortDir');
        
        const VALID_SORT_FIELDS = ['name', 'price', 'change', 'volume', 'trades'];
        const VALID_DIRECTIONS = ['asc', 'desc'];
        
        this.parent.state.sortBy = VALID_SORT_FIELDS.includes(savedSortBy) 
            ? savedSortBy 
            : 'volume'; // ← По умолчанию: по объёму!
        
        this.parent.state.sortDirection = VALID_DIRECTIONS.includes(savedSortDir) 
            ? savedSortDir 
            : 'desc'; // ← По умолчанию: по убыванию!
        
        // Новый обработчик кликов по заголовкам
        this.parent._sortClickHandler = (e) => {
            e.stopPropagation();
            
            const header = e.currentTarget;
            const sortBy = header.dataset.sort;
            
            // Клик по той же колонке — меняем направление
            if (this.parent.state.sortBy === sortBy) {
                this.parent.state.sortDirection = this.parent.state.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                // Новая колонка → всегда desc (кроме name)
                this.parent.state.sortBy = sortBy;
                this.parent.state.sortDirection = sortBy === 'name' ? 'asc' : 'desc';
            }
            
            // Сохраняем выбор
            localStorage.setItem('tickerSortBy', this.parent.state.sortBy);
            localStorage.setItem('tickerSortDir', this.parent.state.sortDirection);
            
            // Обновляем иконки
            document.querySelectorAll('.table-header span[data-sort] i').forEach(icon => {
                icon.className = 'fas fa-sort';
            });
            
            const icon = header.querySelector('i');
            if (icon) {
                icon.className = this.parent.state.sortDirection === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
            }
            
            // Перерисовываем с новой сортировкой
            this.parent.filterCache = null;
            this.parent.renderTickerList();
        };
        
        // Вешаем обработчики
        document.querySelectorAll('.table-header span[data-sort]').forEach(header => {
            header.addEventListener('click', this.parent._sortClickHandler);
        });
        
        // Обновляем иконку активной сортировки
        const activeHeader = document.querySelector(`.table-header span[data-sort="${this.parent.state.sortBy}"]`);
        if (activeHeader) {
            const icon = activeHeader.querySelector('i');
            if (icon) {
                icon.className = this.parent.state.sortDirection === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
            }
        }
    }
}

// Экспорт
if (typeof window !== 'undefined') {
    window.TickerRenderer = TickerRenderer;
}