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
        this._escapeDiv = document.createElement('div');

        // 🚀 ОПТИМИЗАЦИЯ 1: Ограничение частоты обновлений (Throttling)
        this._lastUpdateTime = 0;
        this._updateInterval = 66; 

        this.SCROLL_BUFFER = 10;
        this._formatCache = new Map();
        
        // Таймер для очистки неиспользуемых элементов
        this._cleanupTimer = null;
        this._cleanupInterval = 30000; // 30 секунд

        this._injectFlashCSS();
    }

    _escapeHtml(str) {
        if (!str) return '';
        this._escapeDiv.textContent = str;
        return this._escapeDiv.innerHTML;
    }

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
            .ticker-price.positive { color: #26a65b; }
            .ticker-price.negative { color: #ea3943; }
            .ticker-change.positive { color: #26a65b; }
            .ticker-change.negative { color: #ea3943; }
            .ticker-change.neutral { color: #848e9c; }
        `;
        document.head.appendChild(style);
    }

    // 🚀 ОПТИМИЗАЦИЯ 2: Добавлен временной троттлинг поверх requestAnimationFrame
    updatePriceElements() {
        const now = performance.now();
        if (now - this._lastUpdateTime < this._updateInterval) return;
        this._lastUpdateTime = now;

        if (this._updatePriceRaf) return;
        this._updatePriceRaf = requestAnimationFrame(() => {
            this._updatePriceRaf = null;
            this._doUpdatePriceElements();
        });
    }

    _doUpdatePriceElements() {
        let domUpdates = 0;
        
        // 🚀 ОПТИМИЗАЦИЯ 3: Пакетная перерисовка (Batched Reflows)
        const elementsToFlash = [];

        for (const [key, el] of this.tickerElements.entries()) {
            if (!el || !el.isConnected) continue;

            const ticker = this.parent.tickersMap?.get(key);
            if (!ticker) continue;

            const els = el._cachedEls || {};
            const priceEl = els.price;
            const changeEl = els.change;
            const volumeEl = els.volume;
            const tradesEl = els.trades;

            if (priceEl && ticker.price !== undefined) {
                const newPrice = this.formatPrice(ticker.price);
                if (priceEl.textContent !== newPrice) {
                    // Сохраняем старую цену для flash-анимации
                    const oldPrice = parseFloat(priceEl.textContent) || ticker.prevPrice || 0;
                    
                    priceEl.textContent = newPrice;
                    const colorClass = ticker.change > 0 ? 'positive' : (ticker.change < 0 ? 'negative' : '');
                    
                    const expectedClass = `ticker-price ${colorClass}`;
                    if (priceEl.className !== expectedClass) {
                        priceEl.className = expectedClass;
                    }

                    if (oldPrice > 0 && oldPrice !== ticker.price) {
                        const flashClass = ticker.price > oldPrice ? 'flash-up' : 'flash-down';
                        elementsToFlash.push({ el: priceEl, flashClass });
                    }
                    domUpdates++;
                }
            }

            if (changeEl && ticker.change !== undefined) {
                const newChange = this.formatChange(ticker.change) + '%';
                if (changeEl.textContent !== newChange) {
                    changeEl.textContent = newChange;
                    const newClass = `ticker-change ${ticker.change > 0 ? 'positive' : (ticker.change < 0 ? 'negative' : 'neutral')}`;
                    if (changeEl.className !== newClass) {
                        changeEl.className = newClass;
                    }
                    domUpdates++;
                }
            }

            if (volumeEl && ticker.volume !== undefined) {
                const newVolume = this.formatVolume(ticker.volume);
                if (volumeEl.textContent !== newVolume) {
                    volumeEl.textContent = newVolume;
                    domUpdates++;
                }
            }

            if (tradesEl && ticker.trades !== undefined) {
                const newTrades = this.formatTrades(ticker.trades);
                if (tradesEl.textContent !== newTrades) {
                    tradesEl.textContent = newTrades;
                    domUpdates++;
                }
            }
        }

        // 🚀 ВЫПОЛНЯЕМ ПРИНУДИТЕЛЬНЫЙ ПЕРЕСЧЕТ МАКЕТА (REFLOW) ОДИН РАЗ ДЛЯ ВСЕХ ЭЛЕМЕНТОВ
        if (elementsToFlash.length > 0) {
            for (const item of elementsToFlash) {
                item.el.classList.remove('flash-up', 'flash-down');
            }
            // Принудительный reflow один раз для всех элементов
            void elementsToFlash[0].el.offsetWidth;
            for (const item of elementsToFlash) {
                item.el.classList.add(item.flashClass);
            }
        }

        if (this.parent?.debugMode && domUpdates > 0) {
            console.log(`🔄 Обновлено ${domUpdates} DOM-элементов`);
        }
    }

    updatePriceForSymbol(key, price, change) {
        const el = this.tickerElements.get(key);
        if (!el || !el.isConnected) return;

        const ticker = this.parent.tickersMap?.get(key);
        if (!ticker) return;

        const els = el._cachedEls || {};
        
        if (els.price && price !== undefined) {
            const newPrice = this.formatPrice(price);
            if (els.price.textContent !== newPrice) {
                const oldPrice = parseFloat(els.price.textContent) || ticker.prevPrice || 0;
                
                els.price.textContent = newPrice;
                const colorClass = change > 0 ? 'positive' : (change < 0 ? 'negative' : '');
                els.price.className = `ticker-price ${colorClass}`;
                
                if (oldPrice > 0 && oldPrice !== price) {
                    const flashClass = price > oldPrice ? 'flash-up' : 'flash-down';
                    els.price.classList.remove('flash-up', 'flash-down');
                    void els.price.offsetWidth;
                    els.price.classList.add(flashClass);
                }
            }
        }
        
        if (els.change && change !== undefined) {
            const newChange = this.formatChange(change) + '%';
            if (els.change.textContent !== newChange) {
                els.change.textContent = newChange;
                els.change.className = `ticker-change ${change > 0 ? 'positive' : (change < 0 ? 'negative' : 'neutral')}`;
            }
        }
        
        // Обновляем prevPrice для следующего сравнения
        if (ticker && price !== undefined) {
            ticker.prevPrice = price;
        }
    }

    sortTickers(tickers) {
        const arrayToSort = tickers || this.parent?.tickers;
        if (!arrayToSort || !Array.isArray(arrayToSort)) return [];
        if (!this.parent?.state?.sortBy) return [...arrayToSort];
        
        const sortBy = this.parent.state.sortBy;
        const direction = this.parent.state.sortDirection === 'asc' ? 1 : -1;
        return [...arrayToSort].sort((a, b) => this._compareTickers(a, b, sortBy, direction));
    }

    getFilteredTickers() {
        const state = this.parent?.state;
        if (!state) return [];

        const cacheKey = `${state.marketFilter || 'all'}:${state.exchangeFilter || 'all'}:${state.activeTab || 'all'}:${state.sortBy || 'volume'}:${state.sortDirection || 'desc'}`;
        if (this.parent.filterCache?.key === cacheKey) {
            return this.parent.filterCache.result;
        }

        let result = [];
        try {
            const map = this.parent.tickersMap;
            if (!map) return [];

            switch (state.activeTab) {
                case 'favorites': {
                    const favSet = new Set(state.favorites || []);
                    result = Array.from(map.values()).filter(t => favSet.has(t.symbol));
                    break;
                }
                case 'flags': {
                    const flags = state.flags || {};
                    const flagTab = state.activeFlagTab;
                    result = Object.entries(flags)
                        .filter(([, flag]) => flag && (!flagTab || flag === flagTab))
                        .map(([key]) => map.get(key))
                        .filter(t => t !== undefined);
                    break;
                }
                default: {
                    const sourceKeys = state.customSymbols || [];
                    if (sourceKeys.length === 0) {
                        result = Array.from(map.values());
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
                        result = filteredKeys.map(key => map.get(key)).filter(t => t !== undefined);
                    }
                    break;
                }
            }

            const sortBy = state.sortBy || 'volume';
            const direction = state.sortDirection === 'asc' ? 1 : -1;
            result.sort((a, b) => this._compareTickers(a, b, sortBy, direction));

        } catch (error) {
            console.error('❌ getFilteredTickers error:', error);
            result = Array.from(this.parent.tickersMap?.values() || []);
        }

        this.parent.filterCache = { key: cacheKey, result };
        return result;
    }

   _compareTickers(a, b, sortBy, direction) {
    if (!a || !b) return 0;
    
    const flagPriority = { 
        red: 1, yellow: 2, green: 3, lime: 4, 
        blue: 5, cyan: 6, purple: 7, null: 999 
    };
    
    let res = 0;
    switch (sortBy) {
        case 'flag': 
            res = (flagPriority[a.flag] || 999) - (flagPriority[b.flag] || 999); 
            break;
            
        case 'price': 
            res = (a.price || 0) - (b.price || 0); 
            break;
            
        case 'change': 
            res = (a.change || 0) - (b.change || 0); 
            break;
            
        case 'volume': 
            // Быстрый путь: если volume уже число
            res = (typeof a.volume === 'number' ? a.volume : (parseFloat(a.volume) || 0)) - 
                 (typeof b.volume === 'number' ? b.volume : (parseFloat(b.volume) || 0));
            break;
            
        case 'trades': 
            // Быстрый путь: если trades уже число
            res = (typeof a.trades === 'number' ? a.trades : (parseInt(a.trades) || 0)) - 
                 (typeof b.trades === 'number' ? b.trades : (parseInt(b.trades) || 0));
            break;
            
        default: 
            res = 0;
    }
    
    return direction * res;
}

// Оставляем как fallback для formatVolume/formatTrades, но не используем в сортировке
_extractNumericValue(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const num = parseFloat(value);
        return isNaN(num) ? 0 : num;
    }
    return 0;
}
    
    renderTickerList() {
        const flagTabs = document.getElementById('flagTabs');
        if (flagTabs) {
            flagTabs.classList.toggle('show', this.parent?.state?.activeTab === 'flags');
        }

        const container = document.getElementById('tickerListContainer');
        if (!container) return;

        // Инвалидируем кэш фильтра при перерисовке
        this.parent.filterCache = null;
        
        const displayed = this.getFilteredTickers();
        this.displayedTickers = displayed;
        this.totalItems = displayed.length;

        if (this._scrollHandler) {
            container.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }

        const oldItems = container.querySelector('.ticker-items-container');
        const oldSpacer = container.querySelector('.ticker-spacer');
        if (oldItems) oldItems.remove();
        if (oldSpacer) oldSpacer.remove();

        if (this.parent?._rowDomCache) this.parent._rowDomCache.clear();
        this.tickerElements.clear();

        container.style.position = 'relative';
        container.style.overflowY = 'auto';

        const newSpacer = document.createElement('div');
        newSpacer.className = 'ticker-spacer';
        newSpacer.style.height = (this.totalItems * this.rowHeight) + 'px';
        newSpacer.style.width = '100%';
        newSpacer.style.pointerEvents = 'none';
        container.appendChild(newSpacer);

        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'ticker-items-container';
        itemsContainer.style.position = 'absolute';
        itemsContainer.style.top = '0';
        itemsContainer.style.left = '0';
        itemsContainer.style.right = '0';
        container.appendChild(itemsContainer);

        this.renderVisibleTickers();

        let ticking = false;
        this._scrollHandler = () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    this.renderVisibleTickers();
                    ticking = false;
                });
                ticking = true;
            }
        };
        container.addEventListener('scroll', this._scrollHandler, { passive: true });
        
        // Запускаем таймер очистки неиспользуемых элементов
        this._startCleanupTimer();
    }

  renderVisibleTickers() {
    const container = document.getElementById('tickerListContainer');
    if (!container || !this.displayedTickers || this.totalItems === 0) return;

    const itemsContainer = container.querySelector('.ticker-items-container');
    if (!itemsContainer) return;

    const scrollTop = container.scrollTop;
    const startIndex = Math.max(0, Math.floor(scrollTop / this.rowHeight));
    const endIndex = Math.min(startIndex + this.visibleCount + this.SCROLL_BUFFER, this.totalItems);
    if (startIndex >= endIndex) return;

    const visibleKeys = new Set();
    const fragment = document.createDocumentFragment();
    let hasNewElements = false;

    for (let i = startIndex; i < endIndex; i++) {
        const ticker = this.displayedTickers[i];
        if (!ticker) continue;

        const key = `${ticker.symbol}:${ticker.exchange}:${ticker.marketType}`;
        visibleKeys.add(key);

        let el = this.tickerElements.get(key);
        const isNewElement = !el;

        try {
            if (isNewElement) {
                el = this.createTickerElement(ticker, i);
                if (!el) continue;
                this.tickerElements.set(key, el);
                hasNewElements = true;
            }

            // Устанавливаем позиционирование для всех элементов (новых и существующих)
            el.style.position = 'absolute';
            el.style.top = (i * this.rowHeight) + 'px';
            el.style.left = '0';
            el.style.right = '0';
            el.style.width = '100%';
            el.style.display = '';
            
            // Сбрасываем время скрытия, так как элемент снова видим
            el._hiddenSince = null;

            // Обновляем содержимое существующих элементов
            if (!isNewElement) {
                this._updateExistingElement(el, ticker);
            }

            // Новые элементы добавляем во фрагмент для пакетной вставки
            if (isNewElement) {
                fragment.appendChild(el);
            }
        } catch (error) {
            console.error(`❌ Ошибка рендера тикера ${ticker.symbol}:`, error);
        }
    }

    // Вставляем новые элементы одной операцией (без вложенного RAF)
    // DocumentFragment.appendChild уже оптимизирован браузером для пакетной вставки
    if (hasNewElements && fragment.hasChildNodes()) {
        itemsContainer.appendChild(fragment);
    }

    // Управляем видимостью существующих элементов
    const now = Date.now();
    for (const [key, el] of this.tickerElements.entries()) {
        const isVisible = visibleKeys.has(key);
        
        if (!isVisible && el.style.display !== 'none') {
            el.style.display = 'none';
            if (!el._hiddenSince) {
                el._hiddenSince = now;
            }
        } else if (isVisible && el.style.display === 'none') {
            el.style.display = '';
            el._hiddenSince = null;
        }
    }
}
    
    _updateExistingElement(el, ticker) {
        const els = el._cachedEls || {};
        
        if (els.price && ticker.price !== undefined) {
            const newPrice = this.formatPrice(ticker.price);
            if (els.price.textContent !== newPrice) {
                els.price.textContent = newPrice;
                els.price.className = `ticker-price ${ticker.change > 0 ? 'positive' : (ticker.change < 0 ? 'negative' : '')}`;
            }
        }
        
        if (els.change && ticker.change !== undefined) {
            const newChange = this.formatChange(ticker.change) + '%';
            if (els.change.textContent !== newChange) {
                els.change.textContent = newChange;
                els.change.className = `ticker-change ${ticker.change > 0 ? 'positive' : (ticker.change < 0 ? 'negative' : 'neutral')}`;
            }
        }
        
        if (els.volume && ticker.volume !== undefined) {
            const newVolume = this.formatVolume(ticker.volume);
            if (els.volume.textContent !== newVolume) {
                els.volume.textContent = newVolume;
            }
        }
        
        if (els.trades && ticker.trades !== undefined) {
            const newTrades = this.formatTrades(ticker.trades);
            if (els.trades.textContent !== newTrades) {
                els.trades.textContent = newTrades;
            }
        }
        
        // Обновляем флаги и избранное если изменились
        const flagKey = `${ticker.symbol}:${ticker.exchange}:${ticker.marketType}`;
        const currentFlag = this.parent?.state?.flags?.[flagKey] || null;
        const isFavorite = this.parent?.state?.favorites?.includes(ticker.symbol);
        
        const flagEl = el.querySelector('.flag, .flag-placeholder');
        if (flagEl) {
            const expectedFlagClass = currentFlag ? `flag flag-${currentFlag}` : 'flag-placeholder';
            if (flagEl.className !== expectedFlagClass) {
                flagEl.className = expectedFlagClass;
            }
        }
        
        const starEl = el.querySelector('.star');
        if (starEl) {
            const expectedStarClass = `star ${isFavorite ? 'favorite' : ''}`;
            if (starEl.className !== expectedStarClass) {
                starEl.className = expectedStarClass;
            }
        }
    }

    createTickerElement(ticker, index) {
        const div = document.createElement('div');
        div.className = 'ticker-item';
        
        if (ticker.symbol === this.parent?.state?.currentSymbol &&
            ticker.exchange === this.parent?.state?.currentExchange &&
            ticker.marketType === this.parent?.state?.currentMarketType) {
            div.classList.add('active');
        }
        
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
        div.style.position = 'absolute';

        if (!ticker.prevPrice && ticker.price > 0) {
            ticker.prevPrice = ticker.price;
        }

        const flagKey = `${ticker.symbol}:${ticker.exchange}:${ticker.marketType}`;
        const flag = this.parent?.state?.flags?.[flagKey] || null;
        const flagHTML = flag ? `<div class="flag flag-${flag}"></div>` : '<div class="flag-placeholder"></div>';

        const isFavorite = this.parent?.state?.favorites?.includes(ticker.symbol) ? 'favorite' : '';
        const markerLetter = ticker.marketType === 'futures' ? 'F' : 'S';
        const markerClass = ticker.marketType === 'futures' ? 'futures' : 'spot';

        let rawName = ticker.symbol.replace('USDT', '');
        const match = rawName.match(/^(\d+)([A-Z]+)$/);
        if (match) rawName = match[2];
        rawName = rawName.substring(0, 3);
        const displayName = this._escapeHtml(rawName);
        const escapedSymbol = this._escapeHtml(ticker.symbol);

        const priceClass = ticker.change > 0 ? 'positive' : (ticker.change < 0 ? 'negative' : '');
        const changeClass = ticker.change > 0 ? 'positive' : (ticker.change < 0 ? 'negative' : 'neutral');

        div.innerHTML = `
            <div class="ticker-name" style="display:flex;align-items:center;gap:4px;overflow:hidden;">
                ${flagHTML}
                <sup class="market-sup ${markerClass}" style="font-size:7px;font-weight:bold;margin-right:2px;flex-shrink:0;">${markerLetter}</sup>
                <span class="symbol-text" title="${escapedSymbol}" style="font-size:0.75rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;">${displayName}</span>
                <span class="star ${isFavorite}" data-symbol="${escapedSymbol}" title="Избранное" style="flex-shrink:0;margin-left:2px;">★</span>
            </div>
            <div class="ticker-price ${priceClass}" style="text-align:right;white-space:nowrap;font-size:0.7rem;font-family:monospace;">${this.formatPrice(ticker.price)}</div>
            <div class="ticker-change ${changeClass}" style="text-align:right;white-space:nowrap;font-size:0.7rem;font-family:monospace;">${this.formatChange(ticker.change)}%</div>
            <div class="ticker-volume" style="text-align:right;white-space:nowrap;font-size:0.7rem;font-family:monospace;">${this.formatVolume(ticker.volume)}</div>
            <div class="ticker-trades" style="text-align:right;white-space:nowrap;font-size:0.7rem;font-family:monospace;">${this.formatTrades(ticker.trades)}</div>
        `;

        div._cachedEls = {
            price: div.querySelector('.ticker-price'),
            change: div.querySelector('.ticker-change'),
            volume: div.querySelector('.ticker-volume'),
            trades: div.querySelector('.ticker-trades')
        };

        const cacheKey = `${ticker.symbol}:${ticker.exchange}:${ticker.marketType}`;
        if (this.parent?._rowDomCache) {
            this.parent._rowDomCache.set(cacheKey, div);
        }

        return div;
    }

    formatPrice(price) {
        if (!price || price <= 0) return '...';
        const key = 'p' + price;
        if (this._formatCache.has(key)) return this._formatCache.get(key);

        let str = price.toFixed(8);
        let end = str.length;
        while (end > 0 && str[end - 1] === '0') end--;
        if (end > 0 && str[end - 1] === '.') end--;
        str = str.substring(0, end);
        
        if (!str.includes('.')) str += '.00';
        else {
            const parts = str.split('.');
            if (parts[1].length < 2) str += '0'.repeat(2 - parts[1].length);
        }
        
        this._formatCache.set(key, str);
        if (this._formatCache.size > 5000) this._formatCache.clear();
        return str;
    }

    formatChange(change) {
        if (change === undefined || change === null) return '0.00';
        const key = 'c' + change;
        if (this._formatCache.has(key)) return this._formatCache.get(key);

        const result = (change > 0 ? '+' : '') + change.toFixed(2);
        this._formatCache.set(key, result);
        if (this._formatCache.size > 5000) this._formatCache.clear();
        return result;
    }

    formatVolume(volume) {
        if (!volume || volume === 0) return '0';
        const key = 'v' + volume;
        if (this._formatCache.has(key)) return this._formatCache.get(key);

        // Приводим к числу если volume пришел как строка с суффиксом
        const numVolume = this._extractNumericValue(volume);
        
        let result;
        if (numVolume >= 1e9) result = (numVolume / 1e9).toFixed(2) + 'B';
        else if (numVolume >= 1e6) result = (numVolume / 1e6).toFixed(2) + 'M';
        else if (numVolume >= 1e3) result = (numVolume / 1e3).toFixed(2) + 'K';
        else if (numVolume < 1) result = numVolume.toFixed(4);
        else result = numVolume.toFixed(2);
        
        this._formatCache.set(key, result);
        if (this._formatCache.size > 5000) this._formatCache.clear();
        return result;
    }

    formatTrades(trades) {
        if (!trades || trades <= 0) return '—';
        const key = 't' + trades;
        if (this._formatCache.has(key)) return this._formatCache.get(key);

        // Приводим к числу если trades пришел как строка
        const numTrades = typeof trades === 'string' ? parseInt(trades) : trades;
        
        let result;
        if (numTrades > 1e9) result = (numTrades / 1e9).toFixed(1) + 'B';
        else if (numTrades > 1e6) result = (numTrades / 1e6).toFixed(1) + 'M';
        else if (numTrades > 1e3) result = (numTrades / 1e3).toFixed(1) + 'K';
        else result = numTrades.toString();
        
        this._formatCache.set(key, result);
        if (this._formatCache.size > 5000) this._formatCache.clear();
        return result;
    }

    setupHeaderSorting() {
        const parent = this.parent;
        if (!parent) return;

        if (parent._sortClickHandler) {
            document.querySelectorAll('.table-header span[data-sort]').forEach(header => {
                header.removeEventListener('click', parent._sortClickHandler);
            });
        }

        const savedSortBy = localStorage.getItem('tickerSortBy');
        const savedSortDir = localStorage.getItem('tickerSortDir');
        const VALID_SORT_FIELDS = ['flag', 'price', 'change', 'volume', 'trades'];
        const VALID_DIRECTIONS = ['asc', 'desc'];

        parent.state.sortBy = VALID_SORT_FIELDS.includes(savedSortBy) ? savedSortBy : 'volume';
        parent.state.sortDirection = VALID_DIRECTIONS.includes(savedSortDir) ? savedSortDir : 'desc';

        parent._sortClickHandler = (e) => {
            e.stopPropagation();
            const header = e.currentTarget;
            const sortBy = header.dataset.sort;

            if (parent.state.sortBy === sortBy) {
                parent.state.sortDirection = parent.state.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                parent.state.sortBy = sortBy;
                parent.state.sortDirection = sortBy === 'flag' ? 'asc' : 'desc';
            }

            localStorage.setItem('tickerSortBy', parent.state.sortBy);
            localStorage.setItem('tickerSortDir', parent.state.sortDirection);

            if (parent.watchlistManager?._saveSortForList) {
                parent.watchlistManager._saveSortForList(parent.watchlistManager.activeListId);
            }

            document.querySelectorAll('.table-header span[data-sort] i').forEach(icon => {
                icon.className = 'fas fa-sort';
            });
            const icon = header.querySelector('i');
            if (icon) {
                icon.className = parent.state.sortDirection === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
            }

            // Инвалидируем кэш при смене сортировки
            parent.filterCache = null;
            parent.renderTickerList();
        };

        document.querySelectorAll('.table-header span[data-sort]').forEach(header => {
            header.addEventListener('click', parent._sortClickHandler);
            if (header.dataset.sort === 'flag') {
                const icon = header.querySelector('i');
                if (icon) icon.style.display = 'none';
            }
        });

        const activeHeader = document.querySelector(`.table-header span[data-sort="${parent.state.sortBy}"]`);
        if (activeHeader) {
            const icon = activeHeader.querySelector('i');
            if (icon) {
                icon.className = parent.state.sortDirection === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
                if (parent.state.sortBy === 'flag') icon.style.display = 'none';
            }
        }
    }
    
    _startCleanupTimer() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
        }
        
        this._cleanupTimer = setInterval(() => {
            this._cleanupHiddenElements();
        }, this._cleanupInterval);
    }
    
    _cleanupHiddenElements() {
        const now = Date.now();
        const maxHiddenTime = 60000; // 1 минута
        const keysToDelete = [];
        
        for (const [key, el] of this.tickerElements.entries()) {
            if (el._hiddenSince && (now - el._hiddenSince) > maxHiddenTime) {
                if (el.parentNode) {
                    el.parentNode.removeChild(el);
                }
                keysToDelete.push(key);
                
                // Удаляем из кэша строк
                const cacheKey = key;
                if (this.parent?._rowDomCache) {
                    this.parent._rowDomCache.delete(cacheKey);
                }
            }
        }
        
        if (keysToDelete.length > 0) {
            keysToDelete.forEach(key => this.tickerElements.delete(key));
            
            if (this.parent?.debugMode) {
                console.log(`🧹 Очищено ${keysToDelete.length} неиспользуемых элементов`);
            }
        }
    }

    destroy() {
        if (this._scrollHandler) {
            const container = document.getElementById('tickerListContainer');
            container?.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }
        
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }
        
        // Очищаем все DOM-элементы
        for (const [key, el] of this.tickerElements.entries()) {
            if (el.parentNode) {
                el.parentNode.removeChild(el);
            }
        }
        
        this.tickerElements.clear();
        
        if (this.parent?._rowDomCache) {
            this.parent._rowDomCache.clear();
        }
        
        if (this._updatePriceRaf) {
            cancelAnimationFrame(this._updatePriceRaf);
            this._updatePriceRaf = null;
        }
        
        if (this._renderRafId) {
            cancelAnimationFrame(this._renderRafId);
            this._renderRafId = null;
        }
        
        this._formatCache.clear();
    }
}

if (typeof window !== 'undefined') {
    window.TickerRenderer = TickerRenderer;
}
