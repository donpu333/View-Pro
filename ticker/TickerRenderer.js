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

        this._injectFlashCSS();

        this.SCROLL_BUFFER = 10;
         this._formatCache = new Map();
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
        `;
        document.head.appendChild(style);
    }

    _escapeHtml(str) {
        this._escapeDiv.textContent = str;
        return this._escapeDiv.innerHTML;
    }

    _updatePriceWithAnimation(priceEl, ticker) {
        if (!priceEl || !ticker) return false;

        const newPrice = this.formatPrice(ticker.price);
        if (priceEl.textContent === newPrice) return false;

        priceEl.textContent = newPrice;

        const colorClass = ticker.change > 0 ? 'positive' : ticker.change < 0 ? 'negative' : '';

        let flashClass = null;
        if (ticker.prevPrice > 0 && ticker.prevPrice !== ticker.price) {
            flashClass = ticker.price > ticker.prevPrice ? 'flash-up' : 'flash-down';
        }

        const classes = ['ticker-price', colorClass];
        if (flashClass) classes.push(flashClass);
        priceEl.className = classes.join(' ');

        if (flashClass) {
            priceEl.classList.remove('flash-up', 'flash-down');
            if (priceEl.getAnimations) {
                priceEl.getAnimations().forEach(anim => anim.cancel());
            } else {
                void priceEl.offsetWidth; 
            }
            priceEl.classList.add(flashClass);
        }

        return true;
    }

    updatePriceElements() {
        if (this._updatePriceRaf) return;
        this._updatePriceRaf = requestAnimationFrame(() => {
            this._updatePriceRaf = null;
            this._doUpdatePriceElements();
        });
    }

    _doUpdatePriceElements() {
        let domUpdates = 0;
        // ✅ Убрана неиспользуемая переменная formatCache

        for (const [key, el] of this.tickerElements.entries()) {
            if (!el || !el.isConnected) continue;

            const ticker = this.parent.tickersMap?.get(key);
            if (!ticker) continue;

            const els = el._cachedEls || {};
            const priceEl = els.price;
            const changeEl = els.change;
            const volumeEl = els.volume;
            const tradesEl = els.trades;

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

            const newTrades = this.formatTrades(ticker.trades);
            if (tradesEl && tradesEl.textContent !== newTrades) {
                tradesEl.textContent = newTrades;
                domUpdates++;
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
        
        if (els.price) {
            this._updatePriceWithAnimation(els.price, ticker);
        }
        
        if (els.change) {
            const newChange = this.formatChange(ticker.change) + '%';
            if (els.change.textContent !== newChange) {
                els.change.textContent = newChange;
                els.change.className = `ticker-change ${ticker.change > 0 ? 'positive' : ticker.change < 0 ? 'negative' : ''}`;
            }
        }
    }

    sortTickers(tickers) {
        const arrayToSort = tickers || this.parent?.tickers;
        if (!arrayToSort || !Array.isArray(arrayToSort)) {
            if (this.parent?.debugMode) console.warn('⚠️ sortTickers: нет данных');
            return [];
        }
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
                res = (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0);
                break;
            case 'change':
                res = (parseFloat(a.change) || 0) - (parseFloat(b.change) || 0);
                break;
            case 'volume':
                res = (parseFloat(a.volume) || 0) - (parseFloat(b.volume) || 0);
                break;
            case 'trades':
                res = (parseInt(a.trades) || 0) - (parseInt(b.trades) || 0);
                break;
            default:
                res = 0;
        }
        return direction * res;
    }

    renderTickerList() {
        const flagTabs = document.getElementById('flagTabs');
        if (flagTabs) {
            flagTabs.classList.toggle('show', this.parent?.state?.activeTab === 'flags');
        }

        const container = document.getElementById('tickerListContainer');
        if (!container) return;

        const displayed = this.getFilteredTickers();
        this.displayedTickers = displayed;
        this.totalItems = displayed.length;

        if (this._scrollHandler) {
            container.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }

        container.innerHTML = '';

        if (this.parent?._rowDomCache) {
            this.parent._rowDomCache.clear();
        }
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
        container.addEventListener('scroll', this._scrollHandler);
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
                }

                el.style.position = 'absolute';
                el.style.top = (i * this.rowHeight) + 'px';
                el.style.left = '0';
                el.style.right = '0';
                el.style.width = '100%';
                el.style.display = '';

                if (!isNewElement) {
                    const priceEl = el._cachedEls?.price;
                    const changeEl = el._cachedEls?.change;
                    const volumeEl = el._cachedEls?.volume;
                    const tradesEl = el._cachedEls?.trades;

                    if (priceEl) this._updatePriceWithAnimation(priceEl, ticker);
                    if (changeEl) {
                        changeEl.textContent = this.formatChange(ticker.change) + '%';
                        changeEl.className = `ticker-change ${ticker.change > 0 ? 'positive' : ticker.change < 0 ? 'negative' : ''}`;
                    }
                    if (volumeEl) volumeEl.textContent = this.formatVolume(ticker.volume);
                    if (tradesEl) tradesEl.textContent = this.formatTrades(ticker.trades);
                }

                if (!el.parentNode) {
                    fragment.appendChild(el);
                }
            } catch (error) {
                console.error(`❌ Ошибка рендера тикера ${ticker.symbol}:`, error);
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
if (match) {
    rawName = match[2]; // Убираем цифры
}
// Берём первые 3 буквы
rawName = rawName.substring(0, 3);
const displayName = this._escapeHtml(rawName);

        const priceClass = ticker.change > 0 ? 'positive' : (ticker.change < 0 ? 'negative' : '');

        div.innerHTML = `
            <div class="ticker-name" style="display:flex;align-items:center;gap:4px;overflow:hidden;">
                ${flagHTML}
                <sup class="market-sup ${markerClass}" style="font-size:7px;font-weight:bold;margin-right:2px;flex-shrink:0;">${markerLetter}</sup>
                <span class="symbol-text" title="${this._escapeHtml(ticker.symbol)}" style="font-size:0.75rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;">${displayName}</span>
                <span class="star ${isFavorite}" data-symbol="${this._escapeHtml(ticker.symbol)}" title="Избранное" style="flex-shrink:0;margin-left:2px;">★</span>
            </div>
            <div class="ticker-price ${priceClass}" style="text-align:right;white-space:nowrap;font-size:0.7rem;font-family:monospace;">${this.formatPrice(ticker.price)}</div>
            <div class="ticker-change ${priceClass}" style="text-align:right;white-space:nowrap;font-size:0.7rem;font-family:monospace;">${this.formatChange(ticker.change)}%</div>
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

        // ✅ Быстрая обрезка нулей без медленного RegExp
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
        if (this._formatCache.size > 5000) this._formatCache.clear(); // Мгновенная очистка без GC-пауз
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

        let result;
        if (volume >= 1e9) result = (volume / 1e9).toFixed(2) + 'B';
        else if (volume >= 1e6) result = (volume / 1e6).toFixed(2) + 'M';
        else if (volume >= 1e3) result = (volume / 1e3).toFixed(2) + 'K';
        else if (volume < 1) result = volume.toFixed(4);
        else result = volume.toFixed(2);
        
        this._formatCache.set(key, result);
        if (this._formatCache.size > 5000) this._formatCache.clear();
        return result;
    }

    formatTrades(trades) {
        if (!trades || trades <= 0) return '—';
        const key = 't' + trades;
        if (this._formatCache.has(key)) return this._formatCache.get(key);

        let result;
        if (trades > 1e9) result = (trades / 1e9).toFixed(1) + 'B';
        else if (trades > 1e6) result = (trades / 1e6).toFixed(1) + 'M';
        else if (trades > 1e3) result = (trades / 1e3).toFixed(1) + 'K';
        else result = trades.toString();
        
        this._formatCache.set(key, result);
        if (this._formatCache.size > 5000) this._formatCache.clear();
        return result;
    }

    // ✅ УДАЛЕНО: startCacheCleanup и stopCacheCleanup (они больше не нужны)

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

    destroy() {
        // ✅ Убран вызов stopCacheCleanup()
        if (this._scrollHandler) {
            const container = document.getElementById('tickerListContainer');
            container?.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }
        this.tickerElements.clear();
        if (this.parent?._rowDomCache) {
            this.parent._rowDomCache.clear();
        }
        if (this._updatePriceRaf) cancelAnimationFrame(this._updatePriceRaf);
        if (this._renderRafId) cancelAnimationFrame(this._renderRafId);
    }
}

if (typeof window !== 'undefined') {
    window.TickerRenderer = TickerRenderer;
}
