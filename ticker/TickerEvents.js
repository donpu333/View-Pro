class TickerEvents {
    constructor(parent) {
        this.parent = parent;
    }
    
    setupDelegatedEvents() {
        const container = document.getElementById('tickerListContainer');
        if (!container) return;
        
        container.removeEventListener('click', this.parent.handleTickerClick);
        container.removeEventListener('contextmenu', this.parent.handleContextMenu);
        container.removeEventListener('dblclick', this.parent.handleDoubleClick);
        
        container.addEventListener('click', this.parent.handleTickerClick);
        container.addEventListener('contextmenu', this.parent.handleContextMenu);
        container.addEventListener('dblclick', this.parent.handleDoubleClick);
        
        document.removeEventListener('keydown', this.parent.handleKeyDelete);
        document.addEventListener('keydown', this.parent.handleKeyDelete);
    }
    
    setupFilters() {
        document.querySelectorAll('[data-filter="market"]').forEach(btn => {
            if (btn.dataset.initialized) return; // ЗАЩИТА: не вешаем повторно
            btn.dataset.initialized = 'true';
            
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-filter="market"]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.parent.state.marketFilter = btn.dataset.value;
                this.parent.filterCache = null;
                this.parent.renderTickerList();
            });
        });
        
        document.querySelectorAll('[data-filter="exchange"]').forEach(btn => {
            if (btn.dataset.initialized) return; // ЗАЩИТА
            btn.dataset.initialized = 'true';
            
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-filter="exchange"]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.parent.state.exchangeFilter = btn.dataset.value;
                this.parent.filterCache = null;
                this.parent.renderTickerList();
            });
        });
    }
    
    setupClearAllButton() {
        const clearBtn = document.getElementById('clearAllBtn');
        if (clearBtn && !clearBtn.dataset.initialized) { // ЗАЩИТА
            clearBtn.dataset.initialized = 'true';
            clearBtn.addEventListener('dblclick', () => {
                this.parent.clearAllSymbols();
            });
        }
    }
    
    setupFlagContextMenu() {
        const contextMenu = document.getElementById('flagContextMenu');
        if (!contextMenu) return;
        
        contextMenu.querySelectorAll('.context-menu-item').forEach(menuItem => {
            if (menuItem.dataset.initialized) return; // ЗАЩИТА
            menuItem.dataset.initialized = 'true';
            menuItem.addEventListener('click', this.parent.handleFlagSelect);
        });
        
        // ИСПРАВЛЕНИЕ: Убираем анонимную функцию, используем метод из parent, 
        // чтобы removeEventListener сработал корректно!
        document.removeEventListener('click', this.parent.closeContextMenu);
        document.addEventListener('click', this.parent.closeContextMenu);
    }
    
    setupUIEventListeners() {
        document.querySelectorAll('.tab[data-tab]').forEach(tab => {
            if (tab.dataset.initialized) return; // ЗАЩИТА
            tab.dataset.initialized = 'true';
            
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.parent.state.activeTab = tab.dataset.tab;
                
                const flagTabs = document.getElementById('flagTabs');
                if (flagTabs) {
                    if (this.parent.state.activeTab === 'flags') {
                        flagTabs.style.display = 'flex';
                        this.parent.state.activeFlagTab = null;
                        document.querySelectorAll('.tab[data-flag]').forEach(t => t.classList.remove('active'));
                    } else {
                        flagTabs.style.display = 'none';
                        this.parent.state.activeFlagTab = null;
                    }
                }
                
                this.parent.filterCache = null;
                this.parent.renderTickerList();
            });
        });
       const refreshBtn = document.getElementById('refreshCacheBtn');
if (refreshBtn && !refreshBtn.dataset.initialized) {
    refreshBtn.dataset.initialized = 'true';
    refreshBtn.addEventListener('click', async () => {
        const svg = refreshBtn.querySelector('svg');
        const originalSVG = svg ? svg.outerHTML : '';
        
        // Показываем песочные часы
        refreshBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="#848e9c"><path d="m24,3h-4.091c2.601,2.281,4.091,5.51,4.091,9,0,6.617-5.383,12-12,12-3.676,0-7.099-1.651-9.391-4.529l.782-.623c2.102,2.639,5.239,4.152,8.609,4.152,6.065,0,11-4.935,11-11,0-3.31-1.461-6.366-4-8.465v4.465h-1V3.5c0-.827.673-1.5,1.5-1.5h4.5v1ZM12,1V0c-1.15,0-2.288.163-3.381.483l.284.966c.983-.288,2.021-.45,3.097-.45Zm-5.943,1.753l-.546-.848c-.962.62-1.83,1.372-2.58,2.238l.762.661c.686-.791,1.48-1.482,2.364-2.051ZM2.001,7.434l-.919-.42c-.477,1.042-.8,2.146-.961,3.28l1.003.143c.151-1.057.449-2.065.878-3.003Zm8.732,4.94l.468-.374-.468-.375c-.556-.444-2.393-2.082-2.688-4.48-.035-.281.053-.556.246-.773.209-.236.513-.372.834-.372h5.752c.321,0,.625.136.834.372.193.218.28.493.245.774-.296,2.386-2.137,4.033-2.693,4.48l-.464.374.464.373c1.243,1,2.725,2.67,2.725,4.952l.034.675h-7.992l-.033-.649c0-2.308,1.488-3.978,2.736-4.977Zm.625-1.529l.642.514.636-.512c.483-.388,2.078-1.812,2.328-3.824l-.087-.023h-5.752c.162,2.046,1.752,3.46,2.233,3.845Zm-2.349,6.155h5.965c-.145-1.736-1.332-3.039-2.338-3.848l-.636-.511-.642.514c-1.015.812-2.212,2.121-2.349,3.845ZM.121,13.707c.162,1.135.485,2.239.962,3.281l.919-.421c-.429-.938-.727-1.946-.878-3.003l-1.003.143Z"/></svg>`;
        refreshBtn.style.opacity = '0.6';
        
        await this.parent.refreshSymbolCache(15000);
        this.parent.updateModalCount();
        
        // Возвращаем иконку обновления
        refreshBtn.innerHTML = originalSVG;
        refreshBtn.style.opacity = '1';
    });
}

        document.querySelectorAll('.tab[data-flag]').forEach(tab => {
            if (tab.dataset.initialized) return; // ЗАЩИТА
            tab.dataset.initialized = 'true';
            
            tab.addEventListener('click', (e) => {
                e.stopPropagation();
                
                if (this.parent.state.activeTab !== 'flags') {
                    document.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.remove('active'));
                    document.querySelector('.tab[data-tab="flags"]').classList.add('active');
                    this.parent.state.activeTab = 'flags';
                    
                    const flagTabs = document.getElementById('flagTabs');
                    if (flagTabs) {
                        flagTabs.style.display = 'flex';
                    }
                }
                
                document.querySelectorAll('.tab[data-flag]').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.parent.state.activeFlagTab = tab.dataset.flag;
                
                this.parent.filterCache = null;
                this.parent.renderTickerList();
            });
        });
    }

    
    
}

if (typeof window !== 'undefined') {
    window.TickerEvents = TickerEvents;
}