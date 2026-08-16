class AppCoordinator {
    constructor() {
        this.chartManager = null;
        this.tickerPanel = null;
        this.wsManager = null;
        this.timerManager = null;
        this.tfManager = null;
        
        this._isLoading = false;
        this._pendingSymbol = null;
        this.symbolCache = new Map();
        
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }
        
        this.init();
    }
    
    async init() {
        // ✅ Ждём пока все классы загрузятся
        await this._waitForClasses();
        
        this.chartManager = new ChartManager(document.getElementById('chart-container'));
        window.chartManagerInstance = this.chartManager;
        window.chartManager = this.chartManager;

        await this._waitForChart();

        this.wsManager = new window.WebSocketManager(this.chartManager);
        window.wsManager = this.wsManager;
        
        // ✅ Безопасное создание TimerManager
        if (typeof TimerManager !== 'undefined') {
            this.timerManager = new TimerManager(this.chartManager);
        } else {
            console.error('❌ TimerManager не загружен!');
        }
        
        // ✅ Безопасное создание TimeframeManager
        if (typeof TimeframeManager !== 'undefined' && this.timerManager) {
            this.tfManager = new TimeframeManager(this.chartManager, this.wsManager, this.timerManager);
        } else {
            console.error('❌ TimeframeManager не загружен или TimerManager отсутствует!');
        }

        if (window.TickerPanel) {
            this.tickerPanel = new window.TickerPanel(this);
            window.tickerPanel = this.tickerPanel;
        } else {
            console.error('❌ window.TickerPanel не найден!');
            this.tickerPanel = { init: () => Promise.resolve(), cleanup: () => {} };
        }

        await this._waitForSavedSymbol();
        this._updateHeaderFromSavedSymbol();

        await this.loadInitialData();
        this.initDrawingTools();

        setTimeout(() => {
            if (this.tickerPanel?.init) {
                this.tickerPanel.init().catch(e => console.warn('TickerPanel error:', e));
            }
        }, 300);
    }

    // ✅ НОВЫЙ МЕТОД: ожидание загрузки всех классов
    _waitForClasses() {
        return new Promise(resolve => {
            const check = () => {
                if (typeof ChartManager !== 'undefined'
                    && typeof TimerManager !== 'undefined'
                    && typeof TimeframeManager !== 'undefined'
                    && typeof WebSocketManager !== 'undefined'
                    && typeof PriceManager !== 'undefined') {
                    resolve();
                } else {
                    setTimeout(check, 50);
                }
            };
            check();
            // Таймаут 5 секунд на случай зависания
            setTimeout(resolve, 5000);
        });
    }

    _waitForChart() {
        return new Promise(resolve => {
            const check = () => {
                if (this.chartManager && this.chartManager.chart) {
                    resolve();
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
    }

    async loadInitialData() {
        const defaultSymbol = this.chartManager.currentSymbol || 'BTCUSDT';
        const defaultExchange = this.chartManager.currentExchange || 'binance';
        const defaultMarketType = this.chartManager.currentMarketType || 'futures';
        const defaultInterval = localStorage.getItem('lastTimeframe') || '1h';
        
        await this.chartManager.switchSymbol(defaultSymbol, defaultExchange, defaultMarketType);
        
        if (this.wsManager) {
            this.wsManager.updateSymbolAndTimeframe(defaultSymbol, defaultInterval, defaultExchange);
        }
        
        if (this.timerManager) {
            this.timerManager.start(defaultInterval);
        }
        
        document.getElementById('pairDisplay').textContent = defaultSymbol;
        document.getElementById('exchangeDisplay').textContent = defaultExchange === 'binance' ? 'Binance' : 'Bybit';
        document.getElementById('contractTypeDisplay').textContent = defaultMarketType === 'futures' ? 'PERP' : 'SPOT';
    }

    _updateHeaderFromSavedSymbol() {
        const symbol = this.chartManager.currentSymbol || 'BTCUSDT';
        const exchange = this.chartManager.currentExchange || 'binance';
        const marketType = this.chartManager.currentMarketType || 'futures';
        
        const pairDisplay = document.getElementById('pairDisplay');
        if (pairDisplay) pairDisplay.textContent = symbol;

        const exchangeDisplay = document.getElementById('exchangeDisplay');
        if (exchangeDisplay) exchangeDisplay.textContent = exchange === 'binance' ? 'Binance' : 'Bybit';

        const contractTypeDisplay = document.getElementById('contractTypeDisplay');
        if (contractTypeDisplay) contractTypeDisplay.textContent = marketType === 'futures' ? 'PERP' : 'SPOT';
        
        console.log('📊 Заголовок обновлён:', symbol);
    }

    async _waitForSavedSymbol() {
        return new Promise(async (resolve) => {
            try {
                const saved = await window.db.get('settings', 'currentSymbol');
                if (saved && saved.value && saved.value.symbol) {
                    this.chartManager.currentSymbol = saved.value.symbol;
                    this.chartManager.currentExchange = saved.value.exchange || 'binance';
                    this.chartManager.currentMarketType = saved.value.marketType || 'futures';
                    this._updateHeaderFromSavedSymbol();
                    console.log('✅ Используется сохранённый символ:', saved.value.symbol);
                }
            } catch (e) {
                console.warn('Не удалось загрузить сохранённый символ');
            }
            resolve();
        });
    }

    async initDrawingTools() {
        // ✅ Проверка существования классов рисования
        if (typeof HorizontalRayManager === 'undefined') {
            console.error('❌ HorizontalRayManager не загружен!');
            return;
        }
        
        const rayManager = new HorizontalRayManager(this.chartManager);
        window.rayManager = rayManager;
        
        if (typeof TrendLineManager !== 'undefined') {
            const trendLineManager = new TrendLineManager(this.chartManager);
            window.trendLineManager = trendLineManager;
        }
        
        if (typeof RulerLineManager !== 'undefined') {
            const rulerLineManager = new RulerLineManager(this.chartManager);
            window.rulerLineManager = rulerLineManager;
        }
        
        if (typeof AlertLineManager !== 'undefined') {
            const alertLineManager = new AlertLineManager(this.chartManager);
            window.alertLineManager = alertLineManager;
        }
        
        if (typeof TextManager !== 'undefined') {
            const textManager = new TextManager(this.chartManager);
            window.textManager = textManager;
        }
        
        if (typeof TradeLevelManager !== 'undefined') {
            const tradeLevelManager = new TradeLevelManager(this.chartManager);
            window.tradeLevelManager = tradeLevelManager;
        }
        
        if (window.rayManager) await window.rayManager.loadRays();
        if (window.trendLineManager) await window.trendLineManager.loadTrendLines();
        if (window.rulerLineManager) await window.rulerLineManager.loadRulers();
        if (window.alertLineManager) await window.alertLineManager.loadAlerts();
        if (window.textManager) await window.textManager.loadTexts();
        if (window.tradeLevelManager) await window.tradeLevelManager.loadTrades();
        
        setTimeout(() => {
            if (window.rayManager) window.rayManager.syncWithNewTimeframe();
            if (window.trendLineManager) window.trendLineManager.syncWithNewTimeframe();
            if (window.rulerLineManager) window.rulerLineManager.syncWithNewTimeframe();
            if (window.alertLineManager) window.alertLineManager.syncWithNewTimeframe();
            if (window.textManager) window.textManager.syncWithNewTimeframe();
            if (window.tradeLevelManager) window.tradeLevelManager.syncWithNewTimeframe();
        }, 200);
        
        this.setupToolButtons();
    }

    setupToolButtons() {
        // ... остальной код без изменений (все проверки на существование уже есть)
        
        // =============================================
        // 1. ГОРИЗОНТАЛЬНЫЙ ЛУЧ (O)
        // =============================================
        const rayBtn = document.getElementById('toolHorizontalRay');
        if (rayBtn) {
            rayBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                if (window.trendLineManager) window.trendLineManager.setDrawingMode(false);
                if (window.alertLineManager) window.alertLineManager.setDrawingMode(false);
                if (window.rulerLineManager) window.rulerLineManager.setDrawingMode(false);
                if (window.textManager) window.textManager.setDrawingMode(false);
                if (window.tradeLevelManager) window.tradeLevelManager.setDrawingMode(false);
                
                const newMode = !window.rayManager._isDrawingMode;
                window.rayManager.setDrawingMode(newMode);
            };
        }
        
        // =============================================
        // 2. ТРЕНДОВАЯ ЛИНИЯ (U)
        // =============================================
        const trendBtn = document.getElementById('toolTrendLine');
        if (trendBtn) {
            trendBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                if (window.rayManager) window.rayManager.setDrawingMode(false);
                if (window.alertLineManager) window.alertLineManager.setDrawingMode(false);
                if (window.rulerLineManager) window.rulerLineManager.setDrawingMode(false);
                if (window.textManager) window.textManager.setDrawingMode(false);
                if (window.tradeLevelManager) window.tradeLevelManager.setDrawingMode(false);
                
                const newMode = !window.trendLineManager._isDrawingMode;
                window.trendLineManager.setDrawingMode(newMode);
            };
        }
        
        // =============================================
        // 3. АЛЕРТ (i)
        // =============================================
        const alertBtn = document.getElementById('toolAlert');
        if (alertBtn) {
            alertBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                if (window.rayManager) window.rayManager.setDrawingMode(false);
                if (window.trendLineManager) window.trendLineManager.setDrawingMode(false);
                if (window.rulerLineManager) window.rulerLineManager.setDrawingMode(false);
                if (window.textManager) window.textManager.setDrawingMode(false);
                if (window.tradeLevelManager) window.tradeLevelManager.setDrawingMode(false);
                
                const newMode = !window.alertLineManager._isDrawingMode;
                window.alertLineManager.setDrawingMode(newMode);
            };
        }
        
        // =============================================
        // 4. ЛИНЕЙКА (Y)
        // =============================================
        const rulerBtn = document.getElementById('toolRuler');
        if (rulerBtn) {
            rulerBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                if (window.rayManager) window.rayManager.setDrawingMode(false);
                if (window.trendLineManager) window.trendLineManager.setDrawingMode(false);
                if (window.alertLineManager) window.alertLineManager.setDrawingMode(false);
                if (window.textManager) window.textManager.setDrawingMode(false);
                if (window.tradeLevelManager) window.tradeLevelManager.setDrawingMode(false);
                
                const newMode = !window.rulerLineManager._isDrawingMode;
                window.rulerLineManager.setDrawingMode(newMode);
            };
        }
        
        // =============================================
        // 5. ТЕКСТ (T)
        // =============================================
        const textBtn = document.getElementById('toolText');
        if (textBtn) {
            textBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                if (window.rayManager) window.rayManager.setDrawingMode(false);
                if (window.trendLineManager) window.trendLineManager.setDrawingMode(false);
                if (window.alertLineManager) window.alertLineManager.setDrawingMode(false);
                if (window.rulerLineManager) window.rulerLineManager.setDrawingMode(false);
                if (window.tradeLevelManager) window.tradeLevelManager.setDrawingMode(false);
                
                const newMode = !window.textManager._isDrawingMode;
                window.textManager.setDrawingMode(newMode);
            };
        }
        
        // =============================================
        // 6. ТОРГОВЫЙ УРОВЕНЬ (L)
        // =============================================
        const tradeBtn = document.getElementById('toolTradeLevel');
        if (tradeBtn) {
            tradeBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                if (window.rayManager) window.rayManager.setDrawingMode(false);
                if (window.trendLineManager) window.trendLineManager.setDrawingMode(false);
                if (window.alertLineManager) window.alertLineManager.setDrawingMode(false);
                if (window.rulerLineManager) window.rulerLineManager.setDrawingMode(false);
                if (window.textManager) window.textManager.setDrawingMode(false);
                
                const newMode = !window.tradeLevelManager._isDrawingMode;
                window.tradeLevelManager.setDrawingMode(newMode);
            };
        }
        
        // =============================================
        // 7. МАГНИТ (Z)
        // =============================================
        const magnetBtn = document.getElementById('toolMagnet');
        if (magnetBtn) {
            magnetBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const isActive = magnetBtn.classList.contains('magnet-active');
                const newState = !isActive;
                
                if (window.rayManager) window.rayManager.setMagnetEnabled(newState);
                if (window.trendLineManager) window.trendLineManager.setMagnetEnabled(newState);
                if (window.rulerLineManager) window.rulerLineManager.setMagnetEnabled(newState);
                if (window.alertLineManager) window.alertLineManager.setMagnetEnabled(newState);
                if (window.tradeLevelManager) window.tradeLevelManager.setMagnetEnabled(newState);
                
                magnetBtn.classList.toggle('magnet-active', newState);
            };
            
            magnetBtn.classList.add('magnet-active');
            if (window.rayManager) window.rayManager.setMagnetEnabled(true);
            if (window.trendLineManager) window.trendLineManager.setMagnetEnabled(true);
            if (window.rulerLineManager) window.rulerLineManager.setMagnetEnabled(true);
            if (window.alertLineManager) window.alertLineManager.setMagnetEnabled(true);
            if (window.tradeLevelManager) window.tradeLevelManager.setMagnetEnabled(true);
        }

        // =============================================
        // 8. КОРЗИНА (УДАЛИТЬ ВСЁ)
        // =============================================
        const trashBtn = document.getElementById('toolTrash');
        if (trashBtn) {
            trashBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                if (window.rayManager) window.rayManager.deleteAllRays();
                if (window.trendLineManager) window.trendLineManager.deleteAllTrendLines();
                if (window.rulerLineManager) window.rulerLineManager.deleteAllRulers();
                if (window.alertLineManager) window.alertLineManager.deleteAllAlerts();
                if (window.textManager) window.textManager.deleteAllTexts();
                if (window.tradeLevelManager) window.tradeLevelManager.deleteAllTrades();
                
                if (window.alertLineManager) window.alertLineManager._updateAlertsListUI();
            };
        }
    }

    async loadSymbol(symbol, exchange, marketType, externalSignal = null) {
        console.log(`📊 Загрузка символа: ${symbol} (${exchange} ${marketType})`);
        
        if (this._isLoading) {
            this._pendingSymbol = { symbol, exchange, marketType };
            console.log('Загрузка уже идёт, ставим в очередь');
            return;
        }
        
        this._isLoading = true;
        
        try {
            await this.chartManager.switchSymbol(symbol, exchange, marketType);
            
            if (this.wsManager) {
                this.wsManager.updateSymbolAndTimeframe(symbol, this.chartManager.currentInterval, exchange, marketType);
            }
            
            document.getElementById('pairDisplay').textContent = symbol;
            document.getElementById('exchangeDisplay').textContent = exchange === 'binance' ? 'Binance' : 'Bybit';
            document.getElementById('contractTypeDisplay').textContent = marketType === 'futures' ? 'PERP' : 'SPOT';
            
        } catch (error) {
            console.error('❌ Ошибка загрузки символа:', error);
            
            const notification = document.getElementById('alertNotification');
            if (notification) {
                notification.innerHTML = `
                    <div class="alert-title">❌ Ошибка загрузки</div>
                    <div class="alert-price">${symbol}</div>
                    <div class="alert-repeat">${error.message || 'Проверьте символ'}</div>
                `;
                notification.style.display = 'block';
                notification.style.borderLeftColor = '#f23645';
                setTimeout(() => {
                    notification.style.display = 'none';
                }, 5000);
            }
        } finally {
            this._isLoading = false;
            
            if (this._pendingSymbol) {
                const pending = this._pendingSymbol;
                this._pendingSymbol = null;
                setTimeout(() => this.loadSymbol(pending.symbol, pending.exchange, pending.marketType), 100);
            }
        }
    }

    async syncAllDrawings() {
        await this.chartManager.waitForChartReady?.();
        
        if (window.rayManager) await window.rayManager.loadRays();
        if (window.trendLineManager) await window.trendLineManager.loadTrendLines();
        if (window.rulerLineManager) await window.rulerLineManager.loadRulers();
        if (window.alertLineManager) await window.alertLineManager.loadAlerts();
        if (window.textManager) await window.textManager.loadTexts();
        if (window.tradeLevelManager) await window.tradeLevelManager.loadTrades();
    }
}

if (typeof window !== 'undefined') {
    window.AppCoordinator = AppCoordinator;
}

// Глобальные обработчики (без изменений)
(function() {
    const container = document.getElementById('chart-container');
    if (!container) return;

    container.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.drawing-context-menu')) return;

        const rect = container.getBoundingClientRect();
        const pixelRatio = window.devicePixelRatio || 1;
        const x = (e.clientX - rect.left) * pixelRatio;
        const y = (e.clientY - rect.top) * pixelRatio;

        const managers = [
            window.rayManager,
            window.trendLineManager,
            window.rulerLineManager,
            window.alertLineManager,
            window.textManager,
            window.tradeLevelManager
        ];

        let hitFound = false;
        for (const m of managers) {
            if (m && typeof m.hitTest === 'function') {
                const hit = m.hitTest(x, y);
                if (hit) {
                    hitFound = true;
                    break;
                }
            }
        }

        if (!hitFound) {
            const menuIds = [
                'drawingContextMenu',
                'trendContextMenu',
                'alertContextMenu',
                'rulerContextMenu',
                'textContextMenu',
                'tradeContextMenu'
            ];
            for (const id of menuIds) {
                const menu = document.getElementById(id);
                if (menu) menu.style.display = 'none';
            }
        }
    }, true);
})();

(function setupGlobalDblClick() {
    const container = document.getElementById('chart-container');
    if (!container) return;
    if (container._dblClickSetupDone) return;
    container._dblClickSetupDone = true;
    
    const pixelRatio = window.devicePixelRatio || 1;
    
    container.addEventListener('dblclick', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const rect = container.getBoundingClientRect();
        const x = (e.clientX - rect.left) * pixelRatio;
        const y = (e.clientY - rect.top) * pixelRatio;
        
        const managers = [
            window.rayManager,
            window.trendLineManager,
            window.rulerLineManager,
            window.alertLineManager,
            window.textManager,
            window.tradeLevelManager
        ].filter(m => m && typeof m.hitTest === 'function');
        
        let bestHit = null;
        let bestDist = Infinity;
        
        for (const m of managers) {
            const hit = m.hitTest(x, y);
            if (hit && hit.distance !== undefined && hit.distance < bestDist) {
                bestHit = { manager: m, hit: hit };
                bestDist = hit.distance;
            }
        }
        
        for (const m of managers) {
            if (m.deactivateAll) m.deactivateAll();
        }
        
        if (bestHit && bestHit.manager.activateObject) {
            const obj = bestHit.hit.ray || 
                        bestHit.hit.trendLine || 
                        bestHit.hit.ruler || 
                        bestHit.hit.alert || 
                        bestHit.hit.text ||
                        bestHit.hit.trade;
            if (obj) bestHit.manager.activateObject(obj);
        }
        
        for (const m of managers) {
            if (m._requestRedraw) m._requestRedraw();
        }
    }, true);
})();
