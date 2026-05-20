class TickerRenderer {
    constructor(parent) {
        this.parent = parent;
        this.rowHeight = 36;
        this.visibleCount = 30;
        this.tickerElements = new Map();
        this.displayedTickers = [];
        this.totalItems = 0;
        
        // Таймеры и флаги
        this._scrollHandler = null;
        this._renderScheduled = false;
        this._renderRafId = null;
        this._firstRender = true;
        this._updatePriceRafId = null;
        this._cleanupInterval = null;
        this._isDestroyed = false;
        
        // ✅ НОВЫЕ: Для авто-сортировки
        this._resortTimeoutId = null;      // Timer для debounce сортировки
        this._lastSortDataHash = '';       // Хэш последних данных для детекта изменений
        this._resortEnabled = true;        // Флаг включения авто-сортировки
        this._resortDelay = 500;           // Задержка в мс (debounce)
        this._dataChanged = false;         // Флаг изменения данных
        
        // Инжектим CSS
        this._injectFlashCSS();
    }
    
    // ... [предыдущие методы без изменений: _injectFlashCSS, destroy, _checkDestroyed] ...
    
    /**
     * ✅ ГЛАВНЫЙ ФИКС: Обновление цен + авто-пересортировка
     */
    updatePriceElements() {
        if (this._checkDestroyed('updatePriceElements')) return;
        if (this._updatePriceRafId) return;
        
        this._updatePriceRafId = requestAnimationFrame(() => {
            this._updatePriceRafId = null;
            if (this._isDestroyed) return;
            
            // Обновляем DOM элементы
            const dataChanged = this._doUpdatePriceElements();
            
            // ✅ Если данные изменились И включена авто-сортировка → планируем пересортировку
            if (dataChanged && this._resortEnabled && this.parent.state.sortBy) {
                this._scheduleResort();
            }
        });
    }
    
    _doUpdatePriceElements() {
        if (this._checkDestroyed('_doUpdatePriceElements')) return false;
        
        let domUpdates = 0;
        let dataChanged = false; // ✅ Флаг: были ли изменения в данных
        
        for (const [key, el] of this.tickerElements.entries()) {
            if (!el) continue;
            
            const isConnected = typeof el.isConnected !== 'undefined' 
                ? el.isConnected 
                : document.body.contains(el);
            if (!isConnected) continue;
            
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
            
            // ✅ Отслеживаем изменения
            let itemChanged = false;
            
            if (priceEl && priceEl.textContent !== newPrice) {
                priceEl.textContent = newPrice;
                
                const colorClass = ticker.change > 0 ? 'positive' : ticker.change < 0 ? 'negative' : '';
                priceEl.className = `ticker-price ${colorClass}`;
                
                // Анимация мигания
                if (ticker.prevPrice > 0 && ticker.prevPrice !== ticker.price) {
                    this._triggerFlashAnimation(priceEl, ticker);
                    ticker.prevPrice = ticker.price;
                }
                
                domUpdates++;
                itemChanged = true;
            }
            
            if (changeEl && changeEl.textContent !== newChange) {
                changeEl.textContent = newChange;
                changeEl.className = `ticker-change ${ticker.change > 0 ? 'positive' : ticker.change < 0 ? 'negative' : ''}`;
                domUpdates++;
                itemChanged = true;
            }
            
            if (volumeEl && volumeEl.textContent !== newVolume) {
                volumeEl.textContent = newVolume;
                domUpdates++;
                itemChanged = true;
            }
            
            if (tradesEl && tradesEl.textContent !== newTrades) {
                tradesEl.textContent = newTrades;
                domUpdates++;
                itemChanged = true;
            }
            
            if (itemChanged) {
                dataChanged = true;
            }
        }
        
        return dataChanged; // ✅ Возвращаем факт изменений
    }
    
    /**
     * ✅ НОВЫЙ: Планирует пересортировку с debounce
     */
    _scheduleResort() {
        // Очищаем предыдущий таймер
        if (this._resortTimeoutId) {
            clearTimeout(this._resortTimeoutId);
        }
        
        // Планируем новую сортировку через _resortDelay мс
        this._resortTimeoutId = setTimeout(() => {
            this._resortTimeoutId = null;
            
            if (this._isDestroyed || !this._resortEnabled) return;
            
            console.log(`[TickerRenderer] Auto-resorting by: ${this.parent.state.sortBy}`);
            
            // Инвалидируем кеш фильтров
            this.parent.filterCache = null;
            
            // Полный рендер с новой сортировкой
            this.renderTickerList();
            
        }, this._resortDelay);
    }
    
    /**
     * ✅ НОВЫЙ: Принудительная немедленная сортировка (для кнопок)
     */
    forceResortNow() {
        if (this._resortTimeoutId) {
            clearTimeout(this._resortTimeoutId);
            this._resortTimeoutId = null;
        }
        
        this.parent.filterCache = null;
        this.renderTickerList();
    }
    
    /**
     * ✅ НОВЫЕ: Управление авто-сортировкой
     */
    enableAutoResort(enabled = true) {
        this._resortEnabled = enabled;
        console.log(`[TickerRenderer] Auto-resort: ${enabled ? 'ENABLED' : 'DISABLED'}`);
    }
    
    setResortDelay(delayMs) {
        this._resortDelay = Math.max(100, Math.min(2000, delayMs)); // Clamp 100-2000ms
    }
    
    /**
     * ✅ Улучшенная анимация мигания (вынесена в отдельный метод)
     */
    _triggerFlashAnimation(priceEl, ticker) {
        const flashClass = ticker.price > ticker.prevPrice ? 'flash-up' : 'flash-down';
        
        priceEl.classList.remove('flash-up', 'flash-down');
        
        requestAnimationFrame(() => {
            if (!priceEl.isConnected) return;
            
            priceEl.classList.add(flashClass);
            
            const onAnimEnd = () => {
                priceEl.removeEventListener('animationend', onAnimEnd);
                priceEl.classList.remove(flashClass);
            };
            
            priceEl.addEventListener('animationend', onAnimEnd, { once: true });
        });
    }
    
    // ... [sortTickers, getFilteredTickers - без изменений] ...
    
    sortTickers(tickers) {
        if (this._checkDestroyed('sortTickers')) return [];
        
        return [...tickers].sort((a, b) => {
            let result = 0;
            
            switch (this.parent.state.sortBy) {
                case 'name':
                    result = a.symbol.localeCompare(b.symbol);
                    break;
                case 'price':
                    result = (a.price || 0) - (b.price || 0);
                    break;
                case 'change':
                    result = (a.change || 0) - (b.change || 0);
                    break;
                case 'volume':
                    result = (a.volume || 0) - (b.volume || 0);
                    break;
                case 'trades':
                    result = (a.trades || 0) - (b.trades || 0);
                    break;
                default:
                    result = 0;
            }
            
            return this.parent.state.sortDirection === 'asc' ? result : -result;
        });
    }
    
    getFilteredTickers() {
        if (this._checkDestroyed('getFilteredTickers')) return [];
        
        const flagPart = this.parent.state.activeTab === 'flags' 
            ? this.parent.state.activeFlagTab 
            : 'none';
        
        const cacheKey = `${this.parent.state.marketFilter}:${this.parent.state.exchangeFilter}:${this.parent.state.activeTab}:${flagPart}:${this.parent.state.sortBy}:${this.parent.state.sortDirection}`;
        
        if (this.parent.filterCache && 
            this.parent.filterCache.key === cacheKey && 
            Array.isArray(this.parent.filterCache.result)) {
            return this.parent.filterCache.result;
        }
        
        let filtered = [...this.parent.tickers];
        
        if (this.parent.state.marketFilter !== 'all') {
            filtered = filtered.filter(t => t.marketType === this.parent.state.marketFilter);
        }
        
        if (this.parent.state.exchangeFilter !== 'all') {
            filtered = filtered.filter(t => t.exchange === this.parent.state.exchangeFilter);
        }
        
        if (this.parent.state.activeTab === 'favorites') {
            filtered = filtered.filter(t => this.parent.state.favorites.includes(t.symbol));
        } else if (this.parent.state.activeTab === 'flags') {
            filtered = filtered.filter(t => {
                const key = `${t.symbol}:${t.exchange}:${t.marketType}`;
                if (this.parent.state.activeFlagTab) {
                    return this.parent.state.flags[key] === this.parent.state.activeFlagTab;
                } else {
                    return this.parent.state.flags[key] !== undefined;
                }
            });
        }
        
        const result = this.sortTickers(filtered);
        
        this.parent.filterCache = {
            key: cacheKey,
            result: result,
            timestamp: Date.now()
        };
        
        return result;
    }
    
    renderTickerList() {
        if (this._checkDestroyed('renderTickerList')) return;
        
        const flagTabs = document.getElementById('flagTabs');
        if (flagTabs) {
            flagTabs.classList.toggle('show', this.parent.state.activeTab === 'flags');
        }

        const container = document.getElementById('tickerListContainer');
        if (!container) return;

        const displayed = this.getFilteredTickers();
        this.displayedTickers = displayed;
        this.totalItems = displayed.length;

        // ✅ Отменяем ожидающую авто-сортировку (мы уже сортируем вручную)
        if (this._resortTimeoutId) {
            clearTimeout(this._resortTimeoutId);
            this._resortTimeoutId = null;
        }

        if (this._scrollHandler) {
            container.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }
        
        const spacer = container.querySelector('.ticker-spacer');
        if (spacer) spacer.remove();
        
        const itemsContainer = container.querySelector('.ticker-items-container');
        if (itemsContainer) itemsContainer.remove();
        
        this.tickerElements.clear();

        if (this.totalItems === 0) {
            container.style.height = 'auto';
            container.innerHTML = '<div class="empty-state" style="padding:20px;text-align:center;color:#666;">Нет данных</div>';
            return;
        }

        container.style.position = 'relative';
        container.style.overflowY = 'auto';
        
        const newSpacer = document.createElement('div');
        newSpacer.className = 'ticker-spacer';
        newSpacer.style.height = `${this.totalItems * this.rowHeight}px`;
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

        let scrollTimeout = null;
        this._scrollHandler = () => {
            if (scrollTimeout) return;
            
            scrollTimeout = setTimeout(() => {
                scrollTimeout = null;
                this.renderVisibleTickers();
            }, 16);
        };
        
        container.addEventListener('scroll', this._scrollHandler, { passive: true });
    }
    
    // ... [renderVisibleTickers, createTickerElement - без изменений] ...
    
    renderVisibleTickers() {
        if (this._checkDestroyed('renderVisibleTickers')) return;
        
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
            
            if (isNewElement) {
                el = this.createTickerElement(ticker, i);
                if (!el) continue;
                this.tickerElements.set(key, el);
            }
            
            el.style.position = 'absolute';
            el.style.top = `${i * this.rowHeight}px`;
            el.style.left = '0';
            el.style.right = '0';
            el.style.width = '100%';
            el.style.display = '';
            
            if (!isNewElement) {
                const priceEl = el.querySelector('.ticker-price');
                const changeEl = el.querySelector('.ticker-change');
                const volumeEl = el.querySelector('.ticker-volume');
                const tradesEl = el.querySelector('.ticker-trades');
                
                if (priceEl) priceEl.textContent = this.formatPrice(ticker.price);
                if (changeEl) {
                    changeEl.textContent = `${this.formatChange(ticker.change)}%`;
                    changeEl.className = `ticker-change ${ticker.change > 0 ? 'positive' : ticker.change < 0 ? 'negative' : ''}`;
                }
                if (volumeEl) volumeEl.textContent = this.formatVolume(ticker.volume);
                if (tradesEl) tradesEl.textContent = this.formatTrades(ticker);
            }
            
            if (!el.parentNode) {
                fragment.appendChild(el);
            }
        }
        
        if (fragment.hasChildNodes()) {
            itemsContainer.appendChild(fragment);
        }
        
        for (const [key, el] of this.tickerElements.entries()) {
            if (!visibleKeys.has(key)) {
                el.style.display = 'none';
            }
        }
    }
    
    createTickerElement(ticker, index) {
        if (this._checkDestroyed('createTickerElement')) return null;
        
        const div = document.createElement('div');
        const isActive = ticker.symbol === this.parent.state.currentSymbol &&
                        ticker.exchange === this.parent.state.currentExchange &&
                        ticker.marketType === this.parent.state.currentMarketType;
        
        div.className = `ticker-item ${isActive ? 'active' : ''}`;
        div.dataset.symbol = ticker.symbol;
        div.dataset.exchange = ticker.exchange;
        div.dataset.marketType = ticker.marketType;
        div.dataset.key = `${ticker.symbol}:${ticker.exchange}:${ticker.marketType}`;
        
        Object.assign(div.style, {
            display: 'grid',
            gridTemplateColumns: '1.3fr 1fr 0.7fr 0.8fr 0.7fr',
            alignItems: 'center',
            gap: '4px',
            padding: '6px 8px',
            minHeight: '36px',
            borderBottom: '1px solid #2B3139'
        });

        const flag = this.parent.state.flags[`${ticker.symbol}:${ticker.exchange}:${ticker.marketType}`] || null;
        const flagHTML = flag 
            ? `<div class="flag flag-${flag}"></div>` 
            : '<div class="flag-placeholder"></div>';

        const isFavorite = this.parent.state.favorites.includes(ticker.symbol) ? 'favorite' : '';
        const markerLetter = ticker.marketType === 'futures' ? 'F' : 'S';
        const markerClass = ticker.marketType === 'futures' ? 'futures' : 'spot';
        
        let displayName = ticker.symbol.replace('USDT', '');
        const match = displayName.match(/^(\d+)([A-Z]+)$/);
        if (match) displayName = '1' + match[2];
        else if (displayName.length > 8) displayName = displayName.substring(0, 7) + '…';

        const priceClass = ticker.change > 0 ? 'positive' : (ticker.change < 0 ? 'negative' : '');

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

        const dragHandle = document.createElement('div');
        dragHandle.className = 'drag-handle';
        dragHandle.title = 'ПКМ → перетащить';
        div.insertBefore(dragHandle, div.firstChild);

        return div;
    }
    
    // ... [formatPrice, _formatAsIs, formatChange, formatVolume, formatTrades - без изменений] ...
    
    formatPrice(price) {
        if (!price || price <= 0) return '...';
        
        const now = Date.now();
        const cached = this.parent.formatCache.prices.get(price);
        
        if (cached && cached.value && (now - cached.timestamp) < this.parent.cacheMaxAge) {
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
        
        try {
            this.parent.formatCache.prices.set(price, { value: result, timestamp: now });
            
            if (this.parent.formatCache.prices.size > 500) {
                const oldestKey = this.parent.formatCache.prices.keys().next().value;
                if (oldestKey !== undefined) {
                    this.parent.formatCache.prices.delete(oldestKey);
                }
            }
        } catch (e) {
            console.error('[TickerRenderer] Cache write error:', e);
        }
        
        return result;
    }

    _formatAsIs(price) {
        if (typeof price !== 'number' || isNaN(price)) return '...';
        
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
    
    formatChange(change) {
        if (change === undefined || change === null || isNaN(change)) return '0.00';
        
        const now = Date.now();
        const cached = this.parent.formatCache.changes.get(change);
        
        if (cached && cached.value && (now - cached.timestamp) < this.parent.cacheMaxAge) {
            return cached.value;
        }
        
        const result = (change > 0 ? '+' : '') + Number(change).toFixed(2);
        
        this.parent.formatCache.changes.set(change, { value: result, timestamp: now });
        
        if (this.parent.formatCache.changes.size > 500) {
            const oldestKey = this.parent.formatCache.changes.keys().next().value;
            if (oldestKey !== undefined) {
                this.parent.formatCache.changes.delete(oldestKey);
            }
        }
        
        return result;
    }
    
    formatVolume(volume) {
        if (!volume || volume === 0) return '0';
        
        const now = Date.now();
        const cached = this.parent.formatCache.volumes.get(volume);
        
        if (cached && cached.value && (now - cached.timestamp) < this.parent.cacheMaxAge) {
            return cached.value;
        }
        
        let result;
        const absVolume = Math.abs(volume);
        
        if (absVolume >= 1e9) result = (volume / 1e9).toFixed(2) + 'B';
        else if (absVolume >= 1e6) result = (volume / 1e6).toFixed(2) + 'M';
        else if (absVolume >= 1e3) result = (volume / 1e3).toFixed(2) + 'K';
        else if (absVolume < 1) result = volume.toFixed(4);
        else result = volume.toFixed(2);
        
        this.parent.formatCache.volumes.set(volume, { value: result, timestamp: now });
        
        if (this.parent.formatCache.volumes.size > 500) {
            const oldestKey = this.parent.formatCache.volumes.keys().next().value;
            if (oldestKey !== undefined) {
                this.parent.formatCache.volumes.delete(oldestKey);
            }
        }
        
        return result;
    }
    
    formatTrades(ticker) {
        if (!ticker || ticker.exchange !== 'binance' || !ticker.trades || ticker.trades <= 0) return '—';
        
        const absTrades = Math.abs(ticker.trades);
        
        if (absTrades > 1e9) return (ticker.trades / 1e9).toFixed(1) + 'B';
        if (absTrades > 1e6) return (ticker.trades / 1e6).toFixed(1) + 'M';
        if (absTrades > 1e3) return (ticker.trades / 1e3).toFixed(1) + 'K';
        
        return ticker.trades.toString();
    }
    
    startCacheCleanup() {
        if (this._cleanupInterval) return;
        
        this._cleanupInterval = setInterval(() => {
            if (this._isDestroyed) {
                clearInterval(this._cleanupInterval);
                this._cleanupInterval = null;
                return;
            }
            
            const now = Date.now();
            const maxAge = this.parent.cacheMaxAge;
            
            this._cleanCacheMap(this.parent.formatCache.prices, now, maxAge);
            this._cleanCacheMap(this.parent.formatCache.changes, now, maxAge);
            this._cleanCacheMap(this.parent.formatCache.volumes, now, maxAge);
            
        }, 30000);
    }
    
    _cleanCacheMap(cacheMap, now, maxAge) {
        if (!cacheMap) return;
        
        for (const [key, value] of cacheMap.entries()) {
            if (!value || (now - value.timestamp) > maxAge) {
                cacheMap.delete(key);
            }
        }
    }
    
    setupHeaderSorting() {
        if (this._checkDestroyed('setupHeaderSorting')) return;
        
        if (this.parent._sortClickHandler) {
            document.querySelectorAll('.table-header span[data-sort]').forEach(header => {
                header.removeEventListener('click', this.parent._sortClickHandler);
            });
        }
        
        const savedSortBy = localStorage.getItem('tickerSortBy');
        const savedSortDir = localStorage.getItem('tickerSortDir');
        
        if (savedSortBy) {
            this.parent.state.sortBy = savedSortBy;
            this.parent.state.sortDirection = savedSortDir || 'desc';
        }
        
        this.parent._sortClickHandler = (e) => {
            e.stopPropagation();
            
            try {
                const header = e.currentTarget;
                const sortBy = header.dataset.sort;
                
                if (!sortBy) return;
                
                if (this.parent.state.sortBy === sortBy) {
                    this.parent.state.sortDirection = this.parent.state.sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    this.parent.state.sortBy = sortBy;
                    this.parent.state.sortDirection = 'desc';
                }
                
                localStorage.setItem('tickerSortBy', this.parent.state.sortBy);
                localStorage.setItem('tickerSortDir', this.parent.state.sortDirection);
                
                document.querySelectorAll('.table-header span[data-sort] i').forEach(icon => {
                    icon.className = 'fas fa-sort';
                });
                
                const icon = header.querySelector('i');
                if (icon) {
                    icon.className = this.parent.state.sortDirection === 'asc' 
                        ? 'fas fa-sort-up' 
                        : 'fas fa-sort-down';
                }
                
                // ✅ Принудительная немедленная сортировка при клике
                this.forceResortNow();
                
            } catch (error) {
                console.error('[TickerRenderer] Sort handler error:', error);
            }
        };
        
        document.querySelectorAll('.table-header span[data-sort]').forEach(header => {
            header.addEventListener('click', this.parent._sortClickHandler);
        });
        
        if (savedSortBy) {
            const activeHeader = document.querySelector(`.table-header span[data-sort="${savedSortBy}"]`);
            if (activeHeader) {
                const icon = activeHeader.querySelector('i');
                if (icon) {
                    icon.className = savedSortDir === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
                }
            }
        }
    }
    
    destroy() {
        this._isDestroyed = true;
        
        console.log('[TickerRenderer] Destroying instance...');
        
        // Очистка всех таймеров
        if (this._updatePriceRafId) {
            cancelAnimationFrame(this._updatePriceRafId);
            this._updatePriceRafId = null;
        }
        
        if (this._renderRafId) {
            cancelAnimationFrame(this._renderRafId);
            this._renderRafId = null;
        }
        
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
        
        // ✅ Очистка таймера авто-сортировки
        if (this._resortTimeoutId) {
            clearTimeout(this._resortTimeoutId);
            this._resortTimeoutId = null;
        }
        
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
        
        const container = document.getElementById('tickerListContainer');
        if (container && this._scrollHandler) {
            container.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }
        
        this.tickerElements.clear();
        this.displayedTickers = [];
        
        console.log('[TickerRenderer] Instance destroyed successfully');
    }
}

// Экспорт
if (typeof window !== 'undefined') {
    window.TickerRenderer = TickerRenderer;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TickerRenderer;
}
