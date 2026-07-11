class TickerEvents {
    // Константы вместо магических чисел
    static REFRESH_TIMEOUT = 15000;   // таймаут обновления кэша (мс)

    constructor(parent) {
        this.parent = parent;
        this._delegatedEventsSet = false;
        this._documentKeyHandler = null;
        this._documentCloseHandler = null;
    }

    // ---------------------------------------------------------------
    // ✅ Делегированные события на контейнере тикеров
    // ---------------------------------------------------------------
    setupDelegatedEvents() {
        if (this._delegatedEventsSet) return;
        this._delegatedEventsSet = true;

        const container = document.getElementById('tickerListContainer');
        if (!container) return;

        container.removeEventListener('click', this.parent.handleTickerClick);
        container.removeEventListener('contextmenu', this.parent.handleContextMenu);
        container.removeEventListener('dblclick', this.parent.handleDoubleClick);

        container.addEventListener('click', this.parent.handleTickerClick);
        container.addEventListener('contextmenu', this.parent.handleContextMenu);
        container.addEventListener('dblclick', this.parent.handleDoubleClick);

        if (this._documentKeyHandler) {
            document.removeEventListener('keydown', this._documentKeyHandler);
        }
        this._documentKeyHandler = this.parent.handleKeyDelete;
        document.addEventListener('keydown', this._documentKeyHandler);
    }

    // ---------------------------------------------------------------
    // ✅ Фильтры (рынок / биржа)
    // ---------------------------------------------------------------
    setupFilters() {
        document.querySelectorAll('[data-filter="market"]').forEach(btn => {
            if (btn.dataset.initialized) return;
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
            if (btn.dataset.initialized) return;
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

    // ---------------------------------------------------------------
    // ✅ Кнопка очистки (кастомное подтверждение)
    // ---------------------------------------------------------------
    setupClearAllButton() {
        const clearBtn = document.getElementById('clearAllBtn');
        if (!clearBtn || clearBtn.dataset.initialized) return;
        clearBtn.dataset.initialized = 'true';

        clearBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const count = this.parent.tickers?.length || 0;
            if (count === 0) {
                this._showNotification('⚠️ Список уже пуст', 'info');
                return;
            }

            const confirmed = await this._confirmDialog(
                `Удалить все ${count} символов из списка?\nЭто действие нельзя отменить.`
            );
            if (!confirmed) return;

            this.parent.clearAllSymbols();
            this._showNotification(`🗑️ Удалено: ${count} символов`, 'error');
        });
    }

    // ---------------------------------------------------------------
    // ✅ Контекстное меню флагов
    // ---------------------------------------------------------------
    setupFlagContextMenu() {
        const contextMenu = document.getElementById('flagContextMenu');
        if (!contextMenu) return;

        contextMenu.querySelectorAll('.context-menu-item').forEach(menuItem => {
            if (menuItem.dataset.initialized) return;
            menuItem.dataset.initialized = 'true';
            menuItem.addEventListener('click', this.parent.handleFlagSelect);
        });

        if (this._documentCloseHandler) {
            document.removeEventListener('click', this._documentCloseHandler);
        }
        this._documentCloseHandler = this.parent.closeContextMenu;
        document.addEventListener('click', this._documentCloseHandler);
    }

    // ---------------------------------------------------------------
    // ✅ Вкладки (Все / Избранное / Флаги) и кнопка обновления кэша
    // ---------------------------------------------------------------
    setupUIEventListeners() {
        // Вкладки "Все", "Избранное", "Флаги"
        document.querySelectorAll('.tab[data-tab]').forEach(tab => {
            if (tab.dataset.initialized) return;
            tab.dataset.initialized = 'true';

            tab.addEventListener('click', () => {
                this._switchToMainTab(tab.dataset.tab, tab);
            });
        });

        // Кнопка обновления кэша
        const refreshBtn = document.getElementById('refreshCacheBtn');
        if (refreshBtn && !refreshBtn.dataset.initialized) {
            refreshBtn.dataset.initialized = 'true';
            refreshBtn.addEventListener('click', async () => {
                const originalHTML = refreshBtn.innerHTML;
                const originalOpacity = refreshBtn.style.opacity;
                refreshBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="#848e9c"><path d="..."/></svg>`;
                refreshBtn.style.opacity = '0.6';
                try {
                    await this.parent.refreshSymbolCache(TickerEvents.REFRESH_TIMEOUT);
                    this.parent.updateModalCount();
                } catch (error) {
                    console.error('Ошибка обновления кэша:', error);
                    this._showNotification('⚠️ Ошибка обновления кэша', 'error');
                } finally {
                    refreshBtn.innerHTML = originalHTML;
                    refreshBtn.style.opacity = originalOpacity || '1';
                }
            });
        }

        // Подвкладки цветов флагов
        document.querySelectorAll('.tab[data-flag]').forEach(tab => {
            if (tab.dataset.initialized) return;
            tab.dataset.initialized = 'true';

            tab.addEventListener('click', (e) => {
                e.stopPropagation();
                this._switchToFlagTab(tab.dataset.flag, tab);
            });
        });
    }

    // ---------------------------------------------------------------
    // ✅ Вспомогательные методы для переключения вкладок
    // ---------------------------------------------------------------
    _switchToMainTab(tabId, clickedTab) {
        // Убираем активность со всех главных вкладок
        document.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.remove('active'));
        if (clickedTab) clickedTab.classList.add('active');
        this.parent.state.activeTab = tabId;

        const flagTabs = document.getElementById('flagTabs');
        if (flagTabs) {
            if (tabId === 'flags') {
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
    }

    _switchToFlagTab(flag, clickedTab) {
        // Если не на вкладке "Флаги", переключаемся на неё
        if (this.parent.state.activeTab !== 'flags') {
            this._switchToMainTab('flags', document.querySelector('.tab[data-tab="flags"]'));
        }

        document.querySelectorAll('.tab[data-flag]').forEach(t => t.classList.remove('active'));
        if (clickedTab) clickedTab.classList.add('active');
        this.parent.state.activeFlagTab = flag;

        this.parent.filterCache = null;
        this.parent.renderTickerList();
    }

    // ---------------------------------------------------------------
    // ✅ Вспомогательные методы для кастомных уведомлений
    // ---------------------------------------------------------------
    _showNotification(message, type = 'info') {
        const notif = document.getElementById('alertNotification');
        if (!notif) return;
        notif.innerHTML = `<div class="alert-title">${message}</div>`;
        notif.style.display = 'block';
        notif.style.borderLeftColor = type === 'error' ? '#f23645' : '#4caf50';
        setTimeout(() => { notif.style.display = 'none'; }, 2500);
    }

    _confirmDialog(message) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay confirm-overlay';
            overlay.innerHTML = `
                <div class="modal-content confirm-dialog">
                    <div class="modal-header">${message}</div>
                    <div class="modal-body" style="display:flex; gap:10px; justify-content:center; padding:12px;">
                        <button class="confirm-yes" style="background:var(--accent-red-bright); color:white; border:none; padding:8px 20px; border-radius:4px; cursor:pointer;">Да, удалить</button>
                        <button class="confirm-no" style="background:var(--bg-ticker); color:var(--text-white); border:1px solid var(--border-light); padding:8px 20px; border-radius:4px; cursor:pointer;">Отмена</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            const close = (result) => {
                document.body.removeChild(overlay);
                resolve(result);
            };

            overlay.querySelector('.confirm-yes').onclick = () => close(true);
            overlay.querySelector('.confirm-no').onclick = () => close(false);
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) close(false);
            });
        });
    }

    // ---------------------------------------------------------------
    // ✅ Уничтожение всех обработчиков (destroy)
    // ---------------------------------------------------------------
    destroy() {
        const container = document.getElementById('tickerListContainer');
        if (container) {
            container.removeEventListener('click', this.parent.handleTickerClick);
            container.removeEventListener('contextmenu', this.parent.handleContextMenu);
            container.removeEventListener('dblclick', this.parent.handleDoubleClick);
        }

        if (this._documentKeyHandler) {
            document.removeEventListener('keydown', this._documentKeyHandler);
            this._documentKeyHandler = null;
        }

        if (this._documentCloseHandler) {
            document.removeEventListener('click', this._documentCloseHandler);
            this._documentCloseHandler = null;
        }

        document.querySelectorAll('[data-initialized]').forEach(el => {
            delete el.dataset.initialized;
        });

        this._delegatedEventsSet = false;
    }
}

if (typeof window !== 'undefined') {
    window.TickerEvents = TickerEvents;
}
