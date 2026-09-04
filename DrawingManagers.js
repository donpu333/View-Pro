class AlertLineManager {
    constructor(chartManager) {
        this._pixelRatio = window.devicePixelRatio || 1;
        this._alerts = [];
        this._lastPrices = new Map();
        this._chartManager = chartManager;
        this._selectedAlert = null;
        this._hoveredAlert = null;
        this._isDrawingMode = false;
        this._isDragging = false;
        this._dragAlert = null;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._dragStartPrice = 0;
        this._dragStartTime = 0;
        this._lastMouseX = 0;
        this._lastMouseY = 0;
        this._isLoading = false;
        this._potentialDrag = null;
        this._dragThreshold = 5;
        this._dblClickTimer = null;
        this._potentialDblClickTarget = null;
        this._dblClickTimeout = 350;
        this._lastClickTime = 0;
        this._needsRedraw = false;
        this._subscriptions = new Map();
        this._subCheckInterval = null;

        // ✅ ИСПРАВЛЕНО (главный баг): раньше вместо этого флага использовалась проверка
        // "if (this._alerts.length > 0) return;" в setTimeout ниже. Она ЛОЖНО считала,
        // что все алерты уже загружены, если к моменту срабатывания таймера (150мс) уже
        // успели подгрузиться алерты ТОЛЬКО текущего открытого графика (это делает
        // window.drawingLoaderCoordinator параллельно, ещё до этого таймера).
        // Из-за этого loadAllAlertsFromDB() — единственный метод, который тянет алерты
        // ВСЕХ монет, а не только текущей, — вообще никогда не вызывался. В результате
        // алерты на монетах, не открытых в этой сессии на графике, никогда не попадали
        // в this._alerts и, соответственно, никогда не подписывались на цены в
        // PriceManager => никогда не могли сработать. Теперь флаг выставляется только
        // после реального завершения полной загрузки (см. _doLoadAllAlertsFromDB).
        this._allAlertsLoadedFromDB = false;
        this._loadAllAlertsPromise = null;

        // ✅ КЭШ ДЛЯ ФИЛЬТРАЦИИ
        this._alertsCache = null;
        this._alertsCacheKey = null;

        // ✅ rAF THROTTLE ДЛЯ HOVER
        this._pendingMouseEvent = null;
        this._hoverRafId = null;

        this._handleContextMenu = this._handleContextMenu.bind(this);
        this._handleGlobalMouseUp = this._handleGlobalMouseUp.bind(this);
        window.addEventListener('mouseup', this._handleGlobalMouseUp);

        this._setupEventListeners();
        this._setupHotkeys();
        this._setupSettingsListeners();

        if (window.drawingLoaderCoordinator) {
            window.drawingLoaderCoordinator.register(this, 'alert');
        }

        setTimeout(async () => {
            try {
                // ✅ ИСПРАВЛЕНО: было "if (this._alerts.length > 0) return;" — см. комментарий
                // у объявления this._allAlertsLoadedFromDB выше.
                if (this._allAlertsLoadedFromDB) return;
                if (!window.dbReady) {
                    // ✅ ИСПРАВЛЕНО: раньше ожидание window.dbReady не имело потолка.
                    // Если IndexedDB.open() завершается через onblocked/ошибку (см.
                    // IndexedDBStorage: window.db там подменяется на Proxy-заглушку
                    // НАВСЕГДА и window.dbReady остаётся false до конца жизни вкладки),
                    // этот цикл крутился бы бесконечно раз в 50мс до конца сессии.
                    // Теперь ждём не дольше 8с, после чего просто пробуем
                    // loadAllAlertsFromDB() в любом случае — если БД правда недоступна,
                    // она сама аккуратно завершится через "if (!window.db) return;".
                    const dbReadyTimeoutMs = 8000;
                    const waitStart = Date.now();
                    await new Promise(r => {
                        const c = () => {
                            if (window.dbReady || Date.now() - waitStart > dbReadyTimeoutMs) return r();
                            setTimeout(c, 50);
                        };
                        c();
                    });
                }
                await this.loadAllAlertsFromDB();
                this._subscribeAlertsToPriceManager();
            } catch (error) {
                console.error('❌ Auto-load alerts failed:', error);
            }
        }, 150);
    }

    // ✅ КЭШИРОВАННЫЙ МЕТОД
    _getAlertsForCurrentSymbol() {
        const currentKey = this._getCurrentSymbolKey();
        if (this._alertsCacheKey === currentKey && this._alertsCache) {
            return this._alertsCache;
        }
        this._alertsCacheKey = currentKey;
        this._alertsCache = this._alerts.filter(item => item.alert && item.alert.symbolKey === currentKey);
        return this._alertsCache;
    }

    // ✅ ИНВАЛИДАЦИЯ КЭША
    _invalidateAlertsCache() {
        this._alertsCache = null;
        this._alertsCacheKey = null;
    }

    _normalizeSymbol(symbol) {
        return String(symbol || '').toUpperCase().replace(/[_\-]?(PERP|SPOT)$/i, '').replace(/[^A-Z0-9]/g, '');
    }

    _getSubscriptionKey(symbol, exchange, marketType) {
        const cleanSymbol = this._normalizeSymbol(symbol);
        const cleanExchange = String(exchange || 'binance').toLowerCase();
        const cleanMarket = String(marketType || 'futures').toLowerCase();
        return `${cleanSymbol}:${cleanExchange}:${cleanMarket}`;
    }

    _hasActiveAlertsForSymbol(symbol, exchange, marketType, excludeAlertId = null) {
        const targetKey = this._getSubscriptionKey(symbol, exchange, marketType);

        for (const item of this._alerts) {
            const a = item.alert;
            if (!a) continue;
            if (excludeAlertId && a.id === excludeAlertId) continue;
            if (a.status !== 'active') continue;

            const aKey = this._getSubscriptionKey(a.symbol, a.exchange, a.marketType);
            if (aKey === targetKey) return true;
        }

        return false;
    }

    _subscribeAlertsToPriceManager() {
        if (!window.priceManagerInstance) {
            console.warn('⚠️ PriceManager not available, retrying in 1s...');
            setTimeout(() => this._subscribeAlertsToPriceManager(), 1000);
            return;
        }

        for (const item of this._alerts) {
            const a = item.alert;
            if (a.status !== 'active') continue;

            const key = this._getSubscriptionKey(a.symbol, a.exchange, a.marketType);

            if (this._subscriptions.has(key)) continue;

            const handler = (price, symbol, exchange, marketType) => {
                this._checkAlerts(symbol, price, exchange, marketType);
            };

            this._subscriptions.set(key, handler);
            window.priceManagerInstance.subscribe(key, handler);
            console.log(`✅ Подписка: ${key}`);
        }

        if (!this._subCheckInterval) {
            this._subCheckInterval = setInterval(() => {
                this._verifySubscriptions();
            }, 10000);
        }
    }

    _verifySubscriptions() {
        if (!window.priceManagerInstance) {
            this._subscriptions.clear();
            this._subscribeAlertsToPriceManager();
            return;
        }

        for (const item of this._alerts) {
            const a = item.alert;
            if (a.status !== 'active') continue;

            const key = this._getSubscriptionKey(a.symbol, a.exchange, a.marketType);

            if (!this._subscriptions.has(key)) {
                console.warn(`⚠️ Lost subscription for ${key}, resubscribing...`);
                this._subscribeAlertsToPriceManager();
                break;
            }
        }
    }

    // ✅ ИСПРАВЛЕНО (второй баг): раньше подписки на PriceManager нигде корректно не
    // отписывались — только удалялись из локальной this._subscriptions Map, а сам колбэк
    // продолжал висеть внутри window.priceManagerInstance.subscribers. При повторном
    // создании алерта на той же монете это приводило к накоплению дублирующихся
    // обработчиков на один и тот же ключ (лишняя нагрузка на каждый тик цены).
    // Теперь любое место, где раньше было "this._subscriptions.delete(key)",
    // использует этот метод, который сначала реально отписывается от PriceManager.
    _unsubscribeKey(key) {
        const handler = this._subscriptions.get(key);
        if (handler && window.priceManagerInstance) {
            try { window.priceManagerInstance.unsubscribe(key, handler); } catch (e) {}
        }
        this._subscriptions.delete(key);
    }

    _checkAlerts(symbol, price, exchange, market) {
        if (!symbol || !price || isNaN(price)) return;

        const cleanSymbol = this._normalizeSymbol(symbol);
        const cleanExchange = String(exchange || 'binance').toLowerCase();
        const cleanMarket = String(market || 'futures').toLowerCase();

        const items = this._alerts.filter(item => {
            const a = item.alert;
            if (!a || a.status !== 'active') return false;

            const aSym = this._normalizeSymbol(a.symbol);
            const aEx = String(a.exchange || 'binance').toLowerCase();
            const aMk = String(a.marketType || 'futures').toLowerCase();

            return aSym === cleanSymbol && aEx === cleanExchange && aMk === cleanMarket;
        });

        if (items.length === 0) return;

        const now = Date.now();

        for (const item of items) {
            const alert = item.alert;

            const lastPrice = this._lastPrices.get(alert.id);
            this._lastPrices.set(alert.id, price);

            if (lastPrice === undefined) continue;

            if (now - alert.createdAt < 100) continue;

            const triggerLimit = AlertLine.normalizeRepeatCount(alert.repeatCount);

            if (alert.triggerCount >= triggerLimit) {
                alert.complete();
                this._handleAlertCompletion(alert);
                continue;
            }

            const isFirstTrigger = alert.triggerCount === 0;
            let shouldTrigger = false;

            if (isFirstTrigger) {
                const crossedUp = lastPrice <= alert.price && price >= alert.price;
                const crossedDown = lastPrice >= alert.price && price <= alert.price;

                if (alert.direction === 'above' && crossedUp) shouldTrigger = true;
                else if (alert.direction === 'below' && crossedDown) shouldTrigger = true;
                else if (alert.direction === 'both' && (crossedUp || crossedDown)) shouldTrigger = true;

                if (shouldTrigger) {
                    alert._firstTriggerTime = now;
                    alert._firstTriggerPrice = price;
                }
            } else {
                const intervalMs = (alert.repeatInterval || 1) * 60000;
                const msSinceLast = now - alert.lastTriggerTime;

                if (msSinceLast >= intervalMs) {
                    shouldTrigger = true;
                }
            }

            if (shouldTrigger) {
                const isRepeat = alert.triggerCount > 0;
                console.log(`🔥 ТРИГГЕР: ${alert.symbol} @ ${alert.price} (${isRepeat ? 'ПОВТОР ПО ТАЙМЕРУ' : 'ПЕРВОЕ ПЕРЕСЕЧЕНИЕ'} ${alert.triggerCount + 1}/${triggerLimit === Infinity ? '∞' : triggerLimit})`);

                alert.triggerCount++;
                alert.lastTriggerTime = now;
                alert.active = true;

                this._saveAlerts();
                this._updateAlertsListUI();
                this._startInfiniteHighlight(alert.id);
                this._showAlertNotification(alert, price, isRepeat);
                this._sendTelegramAlert(alert, price, isRepeat);
                this._requestRedraw();

                if (alert.triggerCount >= triggerLimit) {
                    alert.complete();
                    this._handleAlertCompletion(alert);
                }
            }
        }
    }

    _handleAlertCompletion(alert) {
        this._stopHighlight(alert.id);

        const alertItem = this._alerts.find(i => i.alert.id === alert.id);
        if (alertItem && alertItem.primitive && alertItem.series) {
            try {
                alertItem.series.detachPrimitive(alertItem.primitive);
            } catch(e) {
                console.warn('Failed to detach primitive:', e);
            }
            alertItem.primitive = null;
            alertItem.series = null;
        }

        const key = this._getSubscriptionKey(alert.symbol, alert.exchange, alert.marketType);

        if (!this._hasActiveAlertsForSymbol(alert.symbol, alert.exchange, alert.marketType, alert.id)) {
            this._unsubscribeKey(key); // ✅ ИСПРАВЛЕНО: было this._subscriptions.delete(key)
            console.log(`🔌 Отписка: ${key} (нет активных алертов)`);
        }

        this._saveAlerts();
        this._updateAlertsListUI();

        setTimeout(() => this._highlightTriggeredAlert(alert.id), 200);
    }

    async loadFromData(symbolKey, alertRecords) {
        try {
            const currentSymbolKey = this._getCurrentSymbolKey();
            const isCurrentSymbol = (currentSymbolKey === symbolKey);

            const series = isCurrentSymbol
                ? (this._chartManager.currentChartType === 'candle'
                    ? this._chartManager.candleSeries
                    : this._chartManager.barSeries)
                : null;

            if (isCurrentSymbol && !series) {
                console.warn('No series available for current symbol');
                return;
            }

            const ALL_TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '1d', '1w', '1M'];
            const defaultVisibility = {};
            ALL_TFS.forEach(tf => { defaultVisibility[tf] = true; });

            const newRecordIds = new Set(alertRecords.map(a => a.id));

            if (isCurrentSymbol) {
                const toDetach = this._alerts.filter(item =>
                    item.alert.symbolKey === symbolKey && !newRecordIds.has(item.alert.id)
                );
                for (const item of toDetach) {
                    try {
                        if (item.primitive && item.series) item.series.detachPrimitive(item.primitive);
                        item.primitive = null;
                        item.series = null;
                    } catch(e) {}
                }
            }

            this._alerts = this._alerts.filter(item =>
                item.alert.symbolKey !== symbolKey || newRecordIds.has(item.alert.id)
            );

            const newAlerts = [];
            for (const rec of alertRecords) {
                try {
                    const existing = this._alerts.find(item => item.alert.id === rec.id);

                    if (existing) {
                        existing.alert.price = rec.data.price;
                        existing.alert.time = rec.data.time;
                        existing.alert.anchorTime = rec.data.anchorTime || rec.data.time;
                        existing.alert.options = { ...existing.alert.options, ...rec.data.options };
                        existing.alert.timeframeVisibility = { ...defaultVisibility, ...(rec.data.timeframeVisibility || {}) };
                        existing.alert.triggered = rec.data.triggered || false;
                        existing.alert.triggerCount = rec.data.triggerCount || 0;
                        existing.alert.repeatCount = rec.data.repeatCount ?? 5;
                        existing.alert.repeatInterval = rec.data.repeatInterval ?? 1;
                        existing.alert.lastTriggerTime = rec.data.lastTriggerTime || null;
                        existing.alert.active = rec.data.active || false;
                        existing.alert.status = rec.data.status || 'active';
                        existing.alert.anchorCandle = rec.data.anchorCandle || null;
                        existing.alert.symbol = rec.data.symbol || existing.alert.symbol;
                        existing.alert.exchange = rec.data.exchange || existing.alert.exchange;
                        existing.alert.marketType = rec.data.marketType || existing.alert.marketType;

                        if (isCurrentSymbol &&
                            existing.alert.status === 'active' &&
                            (!existing.primitive || !existing.series)) {
                            const primitive = new AlertLinePrimitive(existing.alert, this._chartManager);
                            try {
                                series.attachPrimitive(primitive);
                                existing.primitive = primitive;
                                existing.series = series;
                            } catch(e) {}
                        }
                        continue;
                    }

                    const alert = new AlertLine(rec.data.price, rec.data.time, rec.data.options);
                    alert.id = rec.id;
                    alert.symbolKey = rec.symbolKey;
                    alert.anchorTime = rec.data.anchorTime || rec.data.time;
                    alert.symbol = rec.data.symbol;
                    alert.exchange = rec.data.exchange || 'binance';
                    alert.marketType = rec.data.marketType || 'futures';
                    alert.timeframeVisibility = { ...defaultVisibility, ...(rec.data.timeframeVisibility || {}) };
                    alert.triggered = rec.data.triggered || false;
                    alert.triggerCount = rec.data.triggerCount || 0;
                    alert.repeatCount = rec.data.repeatCount ?? 5;
                    alert.repeatInterval = rec.data.repeatInterval ?? 1;
                    alert.lastTriggerTime = rec.data.lastTriggerTime || null;
                    alert.active = rec.data.active || false;
                    alert.status = rec.data.status || 'active';
                    alert.anchorCandle = rec.data.anchorCandle || null;

                    if (isCurrentSymbol && alert.status === 'active') {
                        const primitive = new AlertLinePrimitive(alert, this._chartManager);
                        try {
                            series.attachPrimitive(primitive);
                            newAlerts.push({ alert, primitive, series });
                        } catch(e) {
                            newAlerts.push({ alert, primitive: null, series: null });
                        }
                    } else {
                        newAlerts.push({ alert, primitive: null, series: null });
                    }
                } catch (e) {
                    console.warn('Failed to load alert:', rec.id, e);
                }
            }

            this._alerts.push(...newAlerts);
            this._invalidateAlertsCache();

            if (isCurrentSymbol) {
                this._subscribeAlertsToPriceManager();
                this._updateAlertsListUI();
                this._requestRedraw();
            }

            console.log(`✅ Loaded ${alertRecords.length} alerts for ${symbolKey}`);
        } catch (error) {
            console.error('❌ loadFromData failed:', error);
            throw error;
        }
    }

    // ✅ ИСПРАВЛЕНО: обёртка-дедупликатор поверх реальной загрузки (_doLoadAllAlertsFromDB).
    // Если метод вызывается ещё раз, пока предыдущий вызов не завершился (например,
    // параллельно из конструктора и откуда-то ещё), мы просто ждём уже идущий вызов,
    // вместо того чтобы читать всю БД второй раз параллельно.
    async loadAllAlertsFromDB() {
        if (this._loadAllAlertsPromise) return this._loadAllAlertsPromise;
        this._loadAllAlertsPromise = this._doLoadAllAlertsFromDB();
        try {
            await this._loadAllAlertsPromise;
        } finally {
            this._loadAllAlertsPromise = null;
        }
    }

    async _doLoadAllAlertsFromDB() {
        try {
            if (!window.db) return;
            const allRecords = await window.db.getAll('drawings');
            if (!allRecords || allRecords.length === 0) {
                // ✅ ИСПРАВЛЕНО: даже если алертов в БД вообще нет, считаем полную
                // загрузку выполненной, чтобы флаг this._allAlertsLoadedFromDB не остался
                // навсегда false и не блокировал логику выше.
                this._allAlertsLoadedFromDB = true;
                return;
            }

            const alertsBySymbol = {};
            for (const record of allRecords) {
                if (record.type !== 'alert') continue;
                const key = record.symbolKey || `${record.data.symbol}:${record.data.exchange}:${record.data.marketType}`;
                if (!alertsBySymbol[key]) alertsBySymbol[key] = [];
                alertsBySymbol[key].push(record);
            }

            for (const [symbolKey, records] of Object.entries(alertsBySymbol)) {
                await this.loadFromData(symbolKey, records);
            }

            // ✅ ИСПРАВЛЕНО: флаг ставится ТОЛЬКО здесь, после того как реально прошли
            // по всем монетам из БД — а не по факту "в this._alerts что-то есть".
            this._allAlertsLoadedFromDB = true;

            this._subscribeAlertsToPriceManager();
            console.log(`✅ All alerts loaded (${this._alerts.length} total)`);
        } catch (error) {
            console.error('❌ loadAllAlertsFromDB failed:', error);
        }
    }

    async loadAlerts() {
        const currentKey = this._getCurrentSymbolKey();
        if (window.drawingLoaderCoordinator) {
            await window.drawingLoaderCoordinator.loadAllForSymbol(currentKey);
        }
    }

    createAlert(price, time, options = {}) {
        const defaultVisibility = {
            '1m': true, '3m': true, '5m': true, '15m': true, '30m': true,
            '1h': true, '4h': true, '6h': true, '12h': true,
            '1d': true, '1w': true, '1M': true
        };

        const timeframeVisibility = options.timeframeVisibility || defaultVisibility;
        const exchange = this._chartManager.currentExchange || 'binance';
        const rawSymbol = this._chartManager.currentSymbol || 'BTCUSDT';
        const cleanSymbol = rawSymbol.toUpperCase().replace(/[^A-Z0-9]/g, '');

        const alert = new AlertLine(price, time, {
            ...options,
            symbol: cleanSymbol,
            exchange: exchange,
            marketType: this._chartManager.currentMarketType || 'futures',
            timeframeVisibility: timeframeVisibility,
            repeatCount: options.repeatCount ?? 5,
            repeatInterval: options.repeatInterval ?? 1,
            triggerCount: options.triggerCount || 0,
            lastTriggerTime: options.lastTriggerTime || null,
            active: options.active || false,
            status: options.status || 'active'
        });

        alert.anchorTime = time;
        alert.triggered = options.triggered || false;
        alert.symbolKey = this._getCurrentSymbolKey();

        let primitive = null;
        let series = null;

        if (alert.status === 'active') {
            primitive = new AlertLinePrimitive(alert, this._chartManager);
            series = this._chartManager.currentChartType === 'candle'
                ? this._chartManager.candleSeries
                : this._chartManager.barSeries;
            if (series) {
                try {
                    series.attachPrimitive(primitive);
                } catch(e) {
                    console.warn('Failed to attach primitive:', e);
                    primitive = null;
                }
            }
        }

        this._alerts.push({ alert, primitive, series });
        this._invalidateAlertsCache();

        this._subscribeAlertsToPriceManager();
        this._saveAlerts();
        this._updateAlertsListUI();

        console.log(`✅ Alert created: ${alert.symbol} at ${price} (${alert.exchange}:${alert.marketType})`);
        return alert;
    }

    deleteAlert(alertId) {
        const index = this._alerts.findIndex(a => a.alert.id === alertId);
        if (index === -1) return false;

        const { alert, primitive, series } = this._alerts[index];

        this._stopHighlight(alertId);

        if (window.db) {
            window.db.delete('drawings', alertId).catch(e => console.warn('DB delete error:', e));
        }

        if (primitive && series) {
            try {
                series.detachPrimitive(primitive);
            } catch (e) {
                console.warn('Failed to detach primitive:', e);
            }
        }

        const key = this._getSubscriptionKey(alert.symbol, alert.exchange, alert.marketType);

        if (!this._hasActiveAlertsForSymbol(alert.symbol, alert.exchange, alert.marketType, alertId)) {
            this._unsubscribeKey(key); // ✅ ИСПРАВЛЕНО: было this._subscriptions.delete(key)
            console.log(`🔌 Отписка: ${key} (нет активных алертов)`);
        }

        this._alerts.splice(index, 1);
        this._invalidateAlertsCache();

        if (this._selectedAlert?.id === alertId) {
            this._selectedAlert = null;
        }
        if (this._dragAlert?.id === alertId) {
            this._dragAlert = null;
        }
        this._lastPrices.delete(alertId);

        this._saveAlerts();
        this._updateAlertsListUI();
        this._requestRedraw();

        console.log(`🗑️ Alert deleted: ${alert.symbol} ${alert.price}`);
        return true;
    }

    pauseAlert(alertId) {
        const item = this._alerts.find(a => a.alert.id === alertId);
        if (item && item.alert.status === 'active') {
            item.alert.pause();

            const key = this._getSubscriptionKey(item.alert.symbol, item.alert.exchange, item.alert.marketType);
            if (!this._hasActiveAlertsForSymbol(item.alert.symbol, item.alert.exchange, item.alert.marketType)) {
                this._unsubscribeKey(key); // ✅ ИСПРАВЛЕНО: было this._subscriptions.delete(key)
                console.log(`🔌 Отписка: ${key} (нет активных алертов)`);
            }

            this._saveAlerts();
            this._updateAlertsListUI();
            this._requestRedraw();
            return true;
        }
        return false;
    }

    resumeAlert(alertId) {
        const item = this._alerts.find(a => a.alert.id === alertId);
        if (item && item.alert.status === 'paused') {
            item.alert.resume();
            if (!item.primitive && item.alert.status === 'active') {
                const primitive = new AlertLinePrimitive(item.alert, this._chartManager);
                const series = this._chartManager.currentChartType === 'candle'
                    ? this._chartManager.candleSeries
                    : this._chartManager.barSeries;
                if (series) {
                    try {
                        series.attachPrimitive(primitive);
                        item.primitive = primitive;
                        item.series = series;
                    } catch(e) {
                        console.warn('Failed to attach primitive on resume:', e);
                    }
                }
            }
            this._subscribeAlertsToPriceManager();
            this._saveAlerts();
            this._updateAlertsListUI();
            this._requestRedraw();
            return true;
        }
        return false;
    }

    deleteAllAlerts() {
        const currentSymbolKey = this._getCurrentSymbolKey();
        const currentSymbol = this._chartManager.currentSymbol;
        const alertsToDelete = this._alerts.filter(item => item.alert.symbolKey === currentSymbolKey);
        if (alertsToDelete.length === 0) return;
        if (!confirm(`Удалить ВСЕ алерты для ${currentSymbol}? (${alertsToDelete.length} шт.)`)) return;

        const keysToRemove = new Set();

        alertsToDelete.forEach(item => {
            if (window.db) window.db.delete('drawings', item.alert.id).catch(e => console.warn(e));
            if (item.primitive && item.series) {
                try { item.series.detachPrimitive(item.primitive); } catch(e) {}
            }

            const key = this._getSubscriptionKey(item.alert.symbol, item.alert.exchange, item.alert.marketType);
            keysToRemove.add(key);

            this._lastPrices.delete(item.alert.id);
            const index = this._alerts.indexOf(item);
            if (index !== -1) this._alerts.splice(index, 1);
        });

        this._invalidateAlertsCache();

        for (const key of keysToRemove) {
            this._unsubscribeKey(key); // ✅ ИСПРАВЛЕНО: было this._subscriptions.delete(key)
            console.log(`🔌 Отписка: ${key}`);
        }

        this._saveAlerts();
        this._updateAlertsListUI();
        this._requestRedraw();
    }

    deleteCompletedAlerts() {
        const completedAlerts = this._alerts.filter(item =>
            item.alert.status === 'completed'
        );
        if (completedAlerts.length === 0) return;
        if (!confirm(`Удалить ${completedAlerts.length} завершенных алертов?`)) return;

        completedAlerts.forEach(item => {
            if (window.db) window.db.delete('drawings', item.alert.id).catch(e => console.warn(e));
            if (item.primitive && item.series) {
                try { item.series.detachPrimitive(item.primitive); } catch(e) {}
            }
            this._lastPrices.delete(item.alert.id);
            const index = this._alerts.indexOf(item);
            if (index !== -1) this._alerts.splice(index, 1);
        });

        this._invalidateAlertsCache();
        this._saveAlerts();
        this._updateAlertsListUI();
        this._requestRedraw();
    }

    hitTest(x, y) {
        if (this._selectedAlert) {
            const selItem = this._alerts.find(item => item.alert === this._selectedAlert);
            if (selItem?.primitive?._paneView?._renderer) {
                try {
                    const hit = selItem.primitive._paneView._renderer.hitTest(x, y);
                    if (hit) return { alert: this._selectedAlert, type: hit.type, distance: hit.distance };
                } catch (e) {}
            }
        }

        let bestHit = null;
        let bestDistance = Infinity;

        for (const item of this._alerts) {
            if (!item.primitive?._paneView?._renderer) continue;
            if (item.alert === this._selectedAlert) continue;
            try {
                const hit = item.primitive._paneView._renderer.hitTest(x, y);
                if (hit && hit.distance !== undefined && hit.distance < bestDistance) {
                    bestHit = { alert: item.alert, type: hit.type, distance: hit.distance };
                    bestDistance = hit.distance;
                }
            } catch (e) {}
        }

        return bestHit;
    }

    setDrawingMode(enabled) {
        this._isDrawingMode = enabled;
        const alertBtn = document.getElementById('toolAlert');
        if (alertBtn) {
            if (enabled) {
                alertBtn.style.background = '#4A90E2';
                alertBtn.style.color = '#FFFFFF';
                alertBtn.classList.add('active');
                if (window.rayManager) window.rayManager.setDrawingMode(false);
                if (window.trendLineManager) window.trendLineManager.setDrawingMode(false);
                if (window.rulerLineManager) window.rulerLineManager.setDrawingMode(false);
                if (window.textManager) window.textManager.setDrawingMode(false);
            } else {
                alertBtn.style.background = '';
                alertBtn.style.color = '';
                alertBtn.classList.remove('active');
            }
        }
    }

    deactivateAll() {
        this._alerts.forEach(item => {
            if (item.alert) {
                item.alert.selected = false;
                item.alert.showDragPoint = false;
            }
        });
        this._selectedAlert = null;
    }

    setMagnetEnabled(enabled) {
    }

    activateObject(alert) {
        alert.selected = true;
        alert.showDragPoint = true;
        this._selectedAlert = alert;
    }

    syncWithNewTimeframe() {
        for (const item of this._alerts) {
            if (item.primitive) item.primitive.updateAllViews();
        }
    }

    _toBitmapCoords(cssX, cssY) {
        return { x: cssX * this._pixelRatio, y: cssY * this._pixelRatio };
    }

    _getCurrentSymbolKey() {
        const symbol = this._chartManager.currentSymbol || 'BTCUSDT';
        const exchange = this._chartManager.currentExchange || 'binance';
        const marketType = this._chartManager.currentMarketType || 'futures';
        return `${symbol}:${exchange}:${marketType}`;
    }

    _getTimeFromCoordinate(x) {
        let time = this._chartManager.coordinateToTime(x);
        if (time !== null) return time;

        const data = this._chartManager.chartData;
        if (!data.length) return null;

        const firstCandle = data[0];
        const lastCandle = data[data.length - 1];
        const firstX = this._chartManager.timeToCoordinate(firstCandle.time);
        const lastX = this._chartManager.timeToCoordinate(lastCandle.time);

        if (firstX === null || lastX === null) return null;

        const timeDiff = lastCandle.time - firstCandle.time;
        if (timeDiff === 0) return lastCandle.time;

        if (x > lastX) {
            const deltaX = x - lastX;
            const pixelsPerMs = (lastX - firstX) / timeDiff;
            return lastCandle.time + deltaX / pixelsPerMs;
        }
        if (x < firstX) {
            const deltaX = firstX - x;
            const pixelsPerMs = (lastX - firstX) / timeDiff;
            return firstCandle.time - deltaX / pixelsPerMs;
        }
        return null;
    }

    _requestRedraw() {
        this._alerts.forEach(item => {
            if (item.primitive?.requestRedraw) item.primitive.requestRedraw();
        });
    }

    _applyRedrawIfNeeded() {
        if (this._needsRedraw) {
            this._needsRedraw = false;
            this._alerts?.forEach(item => {
                if (item.primitive?.requestRedraw) item.primitive.requestRedraw();
            });
        }
    }

    async _saveAlerts() {
        if (!window.db) {
            console.warn('⚠️ DB not available, alerts saved to memory only');
            return;
        }

        const promises = this._alerts.map(item => {
            const alert = item.alert;
            return window.db.put('drawings', {
                id: alert.id,
                type: 'alert',
                symbolKey: alert.symbolKey || this._getCurrentSymbolKey(),
                data: {
                    price: alert.price,
                    time: alert.time,
                    anchorTime: alert.anchorTime || alert.time,
                    symbol: alert.symbol,
                    exchange: alert.exchange || 'binance',
                    marketType: alert.marketType || 'futures',
                    options: alert.options || {},
                    timeframeVisibility: alert.timeframeVisibility || {},
                    triggered: alert.triggered || false,
                    triggerCount: alert.triggerCount || 0,
                    repeatCount: alert.repeatCount ?? 5,
                    repeatInterval: alert.repeatInterval ?? 1,
                    lastTriggerTime: alert.lastTriggerTime || null,
                    active: alert.active || false,
                    status: alert.status || 'active',
                    anchorCandle: alert.anchorCandle || null
                }
            }).catch(e => {
                console.warn(`Save alert error (${alert.id}):`, e);
            });
        });

        await Promise.allSettled(promises);
    }

    _setupHotkeys() {
        document.addEventListener('keydown', (e) => {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

            if (e.code === 'KeyI' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                this.setDrawingMode(!this._isDrawingMode);
            }

            if (e.key === 'Delete' && this._selectedAlert && this._selectedAlert.showDragPoint === true) {
                e.preventDefault();
                this.deleteAlert(this._selectedAlert.id);
                this._selectedAlert = null;
            }
        });
    }

    _setupEventListeners() {
        const container = this._chartManager.chartContainer;

        container.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;

            if (e.target.closest('#alertSettings') ||
                e.target.closest('#trendSettings') ||
                e.target.closest('#textSettings') ||
                e.target.closest('#rulerSettingsPanel') ||
                e.target.closest('#drawingSettings')) {
                return;
            }

            const rect = container.getBoundingClientRect();
            let x = e.clientX - rect.left;
            let y = e.clientY - rect.top;
            const { x: bmX, y: bmY } = this._toBitmapCoords(x, y);

            const hit = this.hitTest(bmX, bmY);
            if (hit) {
                e.preventDefault();
                e.stopPropagation();

                const now = Date.now();

                if (this._dblClickTimer && this._potentialDblClickTarget === hit.alert && now - this._lastClickTime < this._dblClickTimeout) {
                    clearTimeout(this._dblClickTimer);
                    this._dblClickTimer = null;
                    this._potentialDblClickTarget = null;
                    this._lastClickTime = 0;
                    hit.alert.showDragPoint = !hit.alert.showDragPoint;
                    this._requestRedraw();
                    return;
                }

                if (this._selectedAlert && this._selectedAlert !== hit.alert) {
                    this._selectedAlert.selected = false;
                    this._selectedAlert.showDragPoint = false;
                }
                hit.alert.selected = true;
                this._selectedAlert = hit.alert;

                this._potentialDblClickTarget = hit.alert;
                this._lastClickTime = now;
                if (this._dblClickTimer) clearTimeout(this._dblClickTimer);
                this._dblClickTimer = setTimeout(() => {
                    this._dblClickTimer = null;
                    this._potentialDblClickTarget = null;
                }, this._dblClickTimeout);

                if (hit.alert.showDragPoint) {
                    const alertX = this._chartManager.timeToCoordinate(hit.alert.time);
                    const alertY = this._chartManager.priceToCoordinate(hit.alert.price);
                    if (alertX !== null && alertY !== null) {
                        hit.alert.dragPointX = alertX;
                        hit.alert.dragPointY = alertY;
                    }
                    this._potentialDrag = { alert: hit.alert, startX: bmX, startY: bmY, startPrice: hit.alert.price, startTime: hit.alert.time };
                } else {
                    this._potentialDrag = null;
                }

                this._requestRedraw();
            } else {
                const alertMenu = document.getElementById('alertContextMenu');
                if (alertMenu && alertMenu.style.display === 'flex') {
                    const menuRect = alertMenu.getBoundingClientRect();
                    const isClickInsideMenu = e.clientX >= menuRect.left && e.clientX <= menuRect.right && e.clientY >= menuRect.top && e.clientY <= menuRect.bottom;
                    if (isClickInsideMenu) return;
                }
                if (this._selectedAlert) {
                    this._selectedAlert.selected = false;
                    this._selectedAlert.showDragPoint = false;
                    this._selectedAlert = null;
                }
                if (alertMenu) alertMenu.style.display = 'none';
                this._requestRedraw();
            }
        });

        // ✅ rAF-THROTTLED MOUSEMOVE С GUARD НА СКРОЛЛ
        container.addEventListener('mousemove', (e) => {
            // Guard: при панорамировании/зуме пропускаем hover
            if (this._chartManager._isScrolling || this._chartManager._isScrollingFast) {
                if (this._hoveredAlert) {
                    this._hoveredAlert.hovered = false;
                    this._hoveredAlert = null;
                    this._requestRedraw();
                }
                return;
            }

            this._pendingMouseEvent = e;
            if (this._hoverRafId) return;

            this._hoverRafId = requestAnimationFrame(() => {
                this._hoverRafId = null;
                this._processMouseMove(this._pendingMouseEvent);
            });
        });

        container.addEventListener('mouseup', (e) => {
            this._potentialDrag = null;
            if (this._isDragging) {
                e.preventDefault(); e.stopPropagation();
                this._isDragging = false;
                if (this._dragAlert) {
                    this._dragAlert.dragging = false;
                    this._dragAlert.attached = false;
                    this._dragAlert.anchorTime = this._dragAlert.time;
                    this._saveAlerts();
                    this._dragAlert = null;
                    this._requestRedraw();
                }
                container.style.cursor = 'crosshair';
                setTimeout(() => {
                    const moveEvent = new MouseEvent('mousemove', { clientX: e.clientX, clientY: e.clientY });
                    container.dispatchEvent(moveEvent);
                }, 10);
            }
        });

        container.addEventListener('mouseleave', () => {
            if (this._hoveredAlert) { this._hoveredAlert.hovered = false; this._hoveredAlert = null; this._requestRedraw(); }
            container.style.cursor = 'crosshair';

            if (this._hoverRafId) {
                cancelAnimationFrame(this._hoverRafId);
                this._hoverRafId = null;
            }
            this._pendingMouseEvent = null;
        });

        container.addEventListener('click', (e) => {
            if (this._isDragging) { e.preventDefault(); e.stopPropagation(); }
            if (this._isDrawingMode) this._handleChartClick(e);
        });

        container.addEventListener('contextmenu', this._handleContextMenu);
    }

    // ✅ ВЫНЕСЕННАЯ ЛОГИКА MOUSEMOVE
    _processMouseMove(e) {
        const container = this._chartManager.chartContainer;
        const rect = container.getBoundingClientRect();
        const cssX = e.clientX - rect.left;
        const cssY = e.clientY - rect.top;

        this._lastMouseX = cssX;
        this._lastMouseY = cssY;

        const { x: bmX, y: bmY } = this._toBitmapCoords(cssX, cssY);

        if (this._potentialDrag && !this._isDragging) {
            const dx = Math.abs(bmX - this._potentialDrag.startX);
            const dy = Math.abs(bmY - this._potentialDrag.startY);
            if (dx > this._dragThreshold || dy > this._dragThreshold) {
                this._isDragging = true;
                this._dragAlert = this._potentialDrag.alert;
                this._dragAlert.dragging = true;
                this._dragStartX = this._potentialDrag.startX;
                this._dragStartY = this._potentialDrag.startY;
                this._dragStartPrice = this._potentialDrag.startPrice;
                this._dragStartTime = this._potentialDrag.startTime;
                container.style.cursor = 'grabbing';
            }
        }

        if (this._isDragging && this._dragAlert) {
            e.preventDefault(); e.stopPropagation();

            const deltaX = (bmX - this._dragStartX) / this._pixelRatio;
            const deltaY = (bmY - this._dragStartY) / this._pixelRatio;

            const alertX = this._chartManager.timeToCoordinate(this._dragStartTime);
            const alertY = this._chartManager.priceToCoordinate(this._dragStartPrice);
            if (alertX !== null && alertY !== null) {
                const newX = alertX + deltaX;
                const newY = alertY + deltaY;
                const newPrice = this._chartManager.coordinateToPrice(newY);
                const newTime = this._chartManager.coordinateToTime(newX);
                if (newPrice !== null) this._dragAlert.price = newPrice;
                if (newTime !== null) { this._dragAlert.time = newTime; this._dragAlert.anchorTime = newTime; }
                const newAlertX = this._chartManager.timeToCoordinate(this._dragAlert.time);
                const newAlertY = this._chartManager.priceToCoordinate(this._dragAlert.price);
                if (newAlertX !== null && newAlertY !== null) {
                    this._dragAlert.dragPointX = newAlertX;
                    this._dragAlert.dragPointY = newAlertY;
                }
                this._requestRedraw();
            }
        } else {
            const hit = this.hitTest(bmX, bmY);
            const hitAlert = hit ? hit.alert : null;
            container.style.cursor = hitAlert ? 'grab' : 'crosshair';
            if (this._hoveredAlert !== hitAlert) {
                if (this._hoveredAlert) this._hoveredAlert.hovered = false;
                this._hoveredAlert = hitAlert;
                if (hitAlert) hitAlert.hovered = true;
                this._requestRedraw();
            }
        }
    }

    _handleGlobalMouseUp(e) {
        if (!this._isDragging) return;

        this._isDragging = false;
        this._potentialDrag = null;

        if (this._dragAlert) {
            this._dragAlert.dragging = false;
            this._dragAlert.attached = false;
            this._dragAlert.anchorTime = this._dragAlert.time;
            this._saveAlerts();
            this._dragAlert = null;
            this._requestRedraw();
        }

        this._chartManager.chartContainer.style.cursor = 'crosshair';
    }

    _handleChartClick(event) {
        if (!this._isDrawingMode) return;

        const rect = this._chartManager.chartContainer.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        let price = this._chartManager.coordinateToPrice(y);
        let time = this._getTimeFromCoordinate(x);

        if (price === null || time === null) {
            const lastCandle = this._chartManager.getLastCandle();
            if (lastCandle) {
                price = lastCandle.close;
                time = lastCandle.time;
            } else return;
        }

        this.createAlert(price, time, {
            color: document.getElementById('alertCurrentColorBox')?.style.backgroundColor || '#808080',
            lineWidth: parseInt(document.getElementById('alertSettingThickness')?.value) || 2,
            lineStyle: document.getElementById('alertTemplateSelect')?.value || 'dotted',
            opacity: parseInt(document.getElementById('alertColorOpacity')?.value) / 100 || 0.26,
            showPrice: true,
            showBell: document.getElementById('alertShowBell')?.checked || true,
            repeatCount: document.getElementById('alertRepeatCount')?.value === 'Infinity' ? Infinity : parseInt(document.getElementById('alertRepeatCount')?.value) || 5,
            repeatInterval: parseInt(document.getElementById('alertRepeatInterval')?.value) || 1,
            anchorCandle: null,
            status: 'active'
        });

        this.setDrawingMode(false);
    }

    _handleContextMenu(e) {
        e.preventDefault(); e.stopPropagation();
        const rect = this._chartManager.chartContainer.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;
        const { x: bmX, y: bmY } = this._toBitmapCoords(x, y);

        const hit = this.hitTest(bmX, bmY);
        if (hit) {
            if (this._selectedAlert && this._selectedAlert !== hit.alert) {
                this._selectedAlert.selected = false;
                this._selectedAlert.showDragPoint = false;
                this._selectedAlert.attached = false;
            }
            hit.alert.selected = true;
            hit.alert.showDragPoint = true;
            hit.alert.attached = false;
            const alertX = this._chartManager.timeToCoordinate(hit.alert.time);
            const alertY = this._chartManager.priceToCoordinate(hit.alert.price);
            if (alertX !== null && alertY !== null) {
                hit.alert.dragPointX = alertX;
                hit.alert.dragPointY = alertY;
            }
            this._selectedAlert = hit.alert;
            this._requestRedraw();

            const menu = document.getElementById('alertContextMenu');
            if (menu) {
                document.getElementById('drawingContextMenu').style.display = 'none';
                document.getElementById('trendContextMenu').style.display = 'none';
                menu.style.display = 'flex';
                menu.style.left = e.clientX + 'px';
                menu.style.top = e.clientY + 'px';

                const copyBtn = document.getElementById('alertContextCopyBtn');
                const newCopyBtn = copyBtn.cloneNode(true);
                copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
                newCopyBtn.onclick = (event) => { event.stopPropagation(); navigator.clipboard?.writeText(Utils.formatPrice(hit.alert.price)); menu.style.display = 'none'; };

                const settingsBtn = document.getElementById('alertContextSettingsBtn');
                const newSettingsBtn = settingsBtn.cloneNode(true);
                settingsBtn.parentNode.replaceChild(newSettingsBtn, settingsBtn);
                newSettingsBtn.onclick = (event) => { event.stopPropagation(); this._showSettings(hit.alert); menu.style.display = 'none'; };

                const pauseBtn = document.getElementById('alertContextPauseBtn');
                if (pauseBtn) {
                    const newPauseBtn = pauseBtn.cloneNode(true);
                    pauseBtn.parentNode.replaceChild(newPauseBtn, pauseBtn);
                    newPauseBtn.textContent = hit.alert.status === 'paused' ? '▶️ Возобновить' : '⏸️ Пауза';
                    newPauseBtn.onclick = (event) => {
                        event.stopPropagation();
                        if (hit.alert.status === 'paused') hit.alert.resume();
                        else hit.alert.pause();
                        this._saveAlerts();
                        this._updateAlertsListUI();
                        this._requestRedraw();
                        menu.style.display = 'none';
                    };
                }

                const deleteBtn = document.getElementById('alertContextDeleteBtn');
                const newDeleteBtn = deleteBtn.cloneNode(true);
                deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
                newDeleteBtn.onclick = (event) => { event.stopPropagation(); this.deleteAlert(hit.alert.id); menu.style.display = 'none'; };
            }
        } else {
            const menu = document.getElementById('alertContextMenu');
            if (menu) menu.style.display = 'none';
        }
    }

    _showSettings(alert) {
        const settings = document.getElementById('alertSettings');
        if (!settings) return;

        document.getElementById('alertCurrentColorBox').style.backgroundColor = alert.options.color;
        document.getElementById('alertHexInputInline').value = alert.options.color;
        document.getElementById('alertSettingThickness').value = alert.options.lineWidth;
        document.getElementById('alertTemplateSelect').value = alert.options.lineStyle;
        document.getElementById('alertColorOpacity').value = Math.round(alert.options.opacity * 100);
        document.getElementById('alertColorOpacityValue').textContent = document.getElementById('alertColorOpacity').value + '%';

        const bellCheckbox = document.getElementById('alertShowBell');
        if (bellCheckbox) bellCheckbox.checked = alert.options.showBell !== false;

        createColorGrid('alertInlineColorsGrid', 'alertCurrentColorBox', 'alertHexInputInline', alert.options.color, 'alertAddColorInline');

        const priceInput = document.getElementById('alertSettingsPriceInput');
        if (priceInput) priceInput.value = Utils.formatPrice(alert.price);

        const repeatCountSelect = document.getElementById('alertRepeatCount');
        if (repeatCountSelect) repeatCountSelect.value = alert.repeatCount === Infinity ? 'Infinity' : alert.repeatCount;

        const repeatIntervalSelect = document.getElementById('alertRepeatInterval');
        if (repeatIntervalSelect) repeatIntervalSelect.value = alert.repeatInterval;

        this._renderTimeframeCheckboxes(alert);

        settings.style.display = 'block';
        settings.style.left = '50%';
        settings.style.top = '50%';
        settings.style.transform = 'translate(-50%, -50%)';
        settings.dataset.alertId = alert.id;

        const stylePanel = document.getElementById('alertStylePanel');
        const repeatPanel = document.getElementById('alertRepeatPanel');
        const visibilityPanel = document.getElementById('alertVisibilityPanel');

        stylePanel.classList.add('active');
        repeatPanel.classList.remove('active');
        visibilityPanel.classList.remove('active');

        document.querySelectorAll('#alertSettings .settings-tab').forEach(tab => {
            tab.classList.remove('active');
            if (tab.dataset.alertSettingsTab === 'style') tab.classList.add('active');
        });

        settings.onmousedown = (e) => e.stopPropagation();

        if (!document._alertSettingsCloseHandler) {
            document._alertSettingsCloseHandler = (e) => {
                if (!settings.contains(e.target) && settings.style.display === 'block') {
                    settings.style.display = 'none';
                }
            };
            document.addEventListener('mousedown', document._alertSettingsCloseHandler);
        }
    }

    _setupSettingsListeners() {
        const settings = document.getElementById('alertSettings');
        if (!settings || settings._listenersSetup) return;
        settings._listenersSetup = true;

        settings.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.alertSettingsTab;
                document.getElementById('alertStylePanel').classList.toggle('active', tabName === 'style');
                document.getElementById('alertRepeatPanel').classList.toggle('active', tabName === 'repeat');
                document.getElementById('alertVisibilityPanel').classList.toggle('active', tabName === 'visibility');
                settings.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
            });
        });

        document.getElementById('alertApplyPriceBtn').addEventListener('click', () => {
            const alertId = settings.dataset.alertId;
            const alert = this._alerts.find(a => a.alert.id === alertId)?.alert;
            if (!alert) return;
            const newPrice = parseFloat(document.getElementById('alertSettingsPriceInput').value);
            if (!isNaN(newPrice)) {
                alert.price = newPrice;
                this._requestRedraw();
                this._saveAlerts();
            }
        });

        document.getElementById('alertSaveSettings').addEventListener('click', () => {
            const alertId = settings.dataset.alertId;
            const alert = this._alerts.find(a => a.alert.id === alertId)?.alert;
            if (!alert) return;
            const repeatCountVal = document.getElementById('alertRepeatCount').value;
            alert.updateOptions({
                color: document.getElementById('alertCurrentColorBox').style.backgroundColor,
                lineWidth: parseInt(document.getElementById('alertSettingThickness').value),
                lineStyle: document.getElementById('alertTemplateSelect').value,
                opacity: parseInt(document.getElementById('alertColorOpacity').value) / 100,
                showBell: document.getElementById('alertShowBell').checked,
                repeatCount: repeatCountVal === 'Infinity' ? Infinity : parseInt(repeatCountVal),
                repeatInterval: parseInt(document.getElementById('alertRepeatInterval').value)
            });
            this._requestRedraw();
            settings.style.display = 'none';
            this._saveAlerts();
            this._updateAlertsListUI();
        });

        document.getElementById('alertDeleteDrawing').addEventListener('click', () => {
            const alertId = settings.dataset.alertId;
            this.deleteAlert(alertId);
            settings.style.display = 'none';
            this._requestRedraw();
        });
    }

    _renderTimeframeCheckboxes(alert) {
        const container = document.getElementById('alertTimeframeCheckboxList');
        if (!container) return;

        const tfLabels = {
            '1m': '1 минута', '3m': '3 минуты', '5m': '5 минут', '15m': '15 минут',
            '30m': '30 минут', '1h': '1 час', '4h': '4 часа', '6h': '6 часов',
            '12h': '12 часов', '1d': '1 день', '1w': '1 неделя', '1M': '1 месяц'
        };

        let html = '';
        const timeframes = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '1d', '1w', '1M'];

        timeframes.forEach(tf => {
            const isChecked = alert.timeframeVisibility[tf] !== false;
            html += `
                <div class="timeframe-checkbox-item">
                    <input type="checkbox" id="alert_tf_${tf}_${alert.id}" data-timeframe="${tf}" ${isChecked ? 'checked' : ''}>
                    <label for="alert_tf_${tf}_${alert.id}">${tfLabels[tf] || tf}</label>
                    <span class="tf-badge">${tf}</span>
                </div>
            `;
        });

        container.innerHTML = html;

        container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const tf = e.target.dataset.timeframe;
                alert.timeframeVisibility[tf] = e.target.checked;
                this._saveAlerts();
            });
        });

        const selectAllBtn = document.getElementById('alertSelectAllTimeframes');
        const deselectAllBtn = document.getElementById('alertDeselectAllTimeframes');

        if (selectAllBtn) {
            const newSelectAll = selectAllBtn.cloneNode(true);
            selectAllBtn.parentNode.replaceChild(newSelectAll, selectAllBtn);
            newSelectAll.addEventListener('click', () => {
                container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                    cb.checked = true;
                    alert.timeframeVisibility[cb.dataset.timeframe] = true;
                });
                this._saveAlerts();
            });
        }

        if (deselectAllBtn) {
            const newDeselectAll = deselectAllBtn.cloneNode(true);
            deselectAllBtn.parentNode.replaceChild(newDeselectAll, deselectAllBtn);
            newDeselectAll.addEventListener('click', () => {
                container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                    cb.checked = false;
                    alert.timeframeVisibility[cb.dataset.timeframe] = false;
                });
                this._saveAlerts();
            });
        }
    }

    _startInfiniteHighlight(alertId) {
        this._stopHighlight(alertId);

        setTimeout(() => {
            const content = document.getElementById('alertHistoryContent');
            if (!content) return;

            const item = content.querySelector(`.alert-list-item[data-id="${alertId}"]`);
            if (!item) return;

            if (!item._originalStyles) {
                item._originalStyles = {
                    bg: item.style.backgroundColor,
                    boxShadow: item.style.boxShadow,
                    borderLeftColor: item.style.borderLeftColor,
                    borderLeftWidth: item.style.borderLeftWidth,
                    transition: item.style.transition
                };
            }

            let isHighlighted = false;

            const blink = () => {
                if (!item.isConnected) {
                    if (item._blinkInterval) {
                        clearInterval(item._blinkInterval);
                        item._blinkInterval = null;
                    }
                    return;
                }

                isHighlighted = !isHighlighted;

                if (isHighlighted) {
                    item.style.backgroundColor = 'rgba(0, 255, 100, 0.35)';
                    item.style.boxShadow = 'inset 0 0 25px rgba(0, 255, 100, 0.6), 0 0 20px rgba(0, 255, 100, 0.8)';
                    item.style.borderLeftColor = '#00FF00';
                    item.style.borderLeftWidth = '6px';
                    item.style.transition = 'all 0.35s ease';
                } else {
                    item.style.backgroundColor = 'rgba(0, 255, 100, 0.1)';
                    item.style.boxShadow = 'inset 0 0 10px rgba(0, 255, 100, 0.25)';
                    item.style.borderLeftColor = '#00DD00';
                    item.style.borderLeftWidth = '4px';
                    item.style.transition = 'all 0.35s ease';
                }
            };

            blink();
            item._blinkInterval = setInterval(blink, 550);

            item._stopBlink = () => {
                if (item._blinkInterval) {
                    clearInterval(item._blinkInterval);
                    item._blinkInterval = null;
                }
                const orig = item._originalStyles || {};
                item.style.backgroundColor = orig.bg || '';
                item.style.boxShadow = orig.boxShadow || '';
                item.style.borderLeftColor = orig.borderLeftColor || '';
                item.style.borderLeftWidth = orig.borderLeftWidth || '';
                item.style.transition = orig.transition || '';
            };

            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }

    _stopHighlight(alertId) {
        const content = document.getElementById('alertHistoryContent');
        if (!content) return;

        const item = content.querySelector(`.alert-list-item[data-id="${alertId}"]`);
        if (item && item._stopBlink) {
            item._stopBlink();
        }
    }

    _highlightTriggeredAlert(alertId) {
        const content = document.getElementById('alertHistoryContent');
        if (!content) return;

        const activeTab = document.querySelector('.history-tab.active')?.dataset.tab;
        if (activeTab !== 'triggered') return;

        const item = content.querySelector(`.alert-list-item[data-id="${alertId}"]`);
        if (!item) return;

        item.style.backgroundColor = 'rgba(255, 200, 0, 0.25)';
        item.style.boxShadow = '0 0 25px rgba(255, 200, 0, 0.6)';
        item.style.borderLeftColor = '#FFC800';
        item.style.borderLeftWidth = '5px';
        item.style.transition = 'all 0.5s ease';

        item.scrollIntoView({ behavior: 'smooth', block: 'center' });

        setTimeout(() => {
            if (item.isConnected) {
                item.style.backgroundColor = 'rgba(255, 200, 0, 0.08)';
                item.style.boxShadow = 'none';
                item.style.borderLeftWidth = '3px';
            }
        }, 8000);
    }

    _showAlertNotification(alert, currentPrice, isRepeat = false) {
        const notification = document.getElementById('alertNotification');

        const priceFormatted = Utils.formatPrice(currentPrice);
        const alertPriceFormatted = Utils.formatPrice(alert.price);
        const timeStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const repeatText = isRepeat ? ` (повтор ${alert.triggerCount}/${alert.repeatCount === Infinity ? '∞' : alert.repeatCount})` : '';

        if (notification) {
            notification.innerHTML = `
                <div class="alert-title">🔔 ${alert.symbol} - АЛЕРТ СРАБОТАЛ${repeatText}</div>
                <div class="alert-price">${priceFormatted} / ${alertPriceFormatted}</div>
                <div class="alert-repeat">${timeStr}</div>
            `;
            notification.style.display = 'block';
            notification.style.borderLeftColor = alert.options.color;
            setTimeout(() => { notification.style.display = 'none'; }, 5000);
        }

        this._playAlertSound();
        this._showSystemNotification(alert, currentPrice, isRepeat);
    }

    _playAlertSound() {
        try {
            const audio = document.getElementById('alertSound');
            if (audio && audio.src && audio.src !== '') {
                audio.currentTime = 0;
                audio.play().catch(e => {});
                return;
            }

            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;

            const ctx = new AudioContext();

            if (ctx.state === 'suspended') {
                ctx.resume().catch(() => {});
            }

            const now = ctx.currentTime;
            const melody = [523, 587, 659, 698, 784, 880, 988, 1047, 988, 880, 784, 698, 659, 587, 523, 494];

            melody.forEach((freq, i) => {
                const startTime = now + i * 0.15;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, startTime);
                gain.gain.linearRampToValueAtTime(0.25, startTime + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.00001, startTime + 0.2);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(startTime);
                osc.stop(startTime + 0.2);
            });
        } catch (e) {}
    }

    _showSystemNotification(alert, currentPrice, isRepeat = false) {
        if (!("Notification" in window)) return;

        const priceFormatted = Utils.formatPrice(currentPrice);
        const repeatText = isRepeat ? ` (повтор ${alert.triggerCount}/${alert.repeatCount === Infinity ? '∞' : alert.repeatCount})` : '';

        const showNotification = () => {
            const notification = new Notification(`🔔 ${alert.symbol} - АЛЕРТ${repeatText}`, {
                body: `Цена: ${priceFormatted} | Уровень: ${Utils.formatPrice(alert.price)}`,
                icon: 'https://tradingview.com/favicon.ico',
                silent: false,
                requireInteraction: true
            });
            notification.onclick = () => { window.focus(); notification.close(); };
            setTimeout(() => notification.close(), 10000);
        };

        if (Notification.permission === "granted") showNotification();
        else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") showNotification();
            });
        }
    }

    _sendTelegramAlert(alert, currentPrice, isRepeat = false) {
        const chatId = localStorage.getItem('telegramChatId');
        if (!chatId) return;

        const priceFormatted = Utils.formatPrice(currentPrice);
        const alertPriceFormatted = Utils.formatPrice(alert.price);

        const direction = currentPrice > alert.price ? '⬆️ Выше' : '⬇️ Ниже';
        const repeatText = isRepeat ? `\n🔄 Повтор: ${alert.triggerCount}/${alert.repeatCount === Infinity ? '∞' : alert.repeatCount}` : '';

        const message = `🚨 АЛЕРТ СРАБОТАЛ!\n\n📊 Пара: ${alert.symbol}\n💰 Цена алерта: ${alertPriceFormatted}\n📈 Текущая цена: ${priceFormatted}\n🧭 Направление: ${direction}${repeatText}\n⏰ Время: ${new Date().toLocaleString('ru-RU')}`;

        const formData = new URLSearchParams();
        formData.append('chat_id', chatId);
        formData.append('text', message);

        fetch(CONFIG.telegramProxyUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData
        }).catch(err => console.warn('Ошибка отправки в Telegram:', err));
    }

    _updateAlertsListUI() {
        const content = document.getElementById('alertHistoryContent');
        if (!content) return;

        const activeAlerts = this._alerts
            .map(a => a.alert)
            .filter(alert => alert.status === 'active' || alert.status === 'paused')
            .sort((a, b) => {
                if (a.active && !b.active) return -1;
                if (!a.active && b.active) return 1;
                return b.createdAt - a.createdAt;
            });

        const completedAlerts = this._alerts
            .map(a => a.alert)
            .filter(alert => alert.status === 'completed')
            .sort((a, b) => (b.lastTriggerTime || 0) - (a.lastTriggerTime || 0));

        const activeTab = document.querySelector('.history-tab.active')?.dataset.tab || 'active';

        let html = '';

        if (activeTab === 'active') {
            const displayAlerts = [...activeAlerts];
            if (displayAlerts.length === 0) {
                html = '<div class="empty-alerts">Нет активных алертов</div>';
            } else {
                html = '<div class="alert-list">';
                displayAlerts.forEach(alert => {
                    const priceFormatted = Utils.formatPrice(alert.price);
                    const color = alert.options.color;
                    const isActive = alert.active;
                    const isPaused = alert.status === 'paused';

                    const exchangeBadge = alert.exchange || 'binance';
                    const marketBadge = (alert.marketType || 'futures') === 'spot' ? 'Spot' : 'Fut';

                    const statusIcon = isPaused ? '⏸️' : '🔔';
                    const statusText = isPaused ? 'На паузе' : (isActive ? `Активен (${alert.triggerCount}/${alert.repeatCount === Infinity ? '∞' : alert.repeatCount})` : 'Ожидание');

                    html += `
                        <div class="alert-list-item ${isActive ? 'is-active' : ''} ${isPaused ? 'is-paused' : ''}"
                             style="border-left-color: ${color};${isActive ? 'background: rgba(0,255,100,0.05);' : ''}${isPaused ? 'background: rgba(255,165,0,0.05);' : ''}"
                             data-id="${alert.id}">
                            <div class="trigger-bell">${statusIcon}</div>
                            <div>
                                <div class="price">
                                    <span class="copy-symbol" style="color:#FFD700; font-weight:bold; cursor:pointer;"
                                          data-symbol="${alert.symbol}"
                                          title="Копировать тикер">
                                        ${alert.symbol}
                                    </span>
                                    <span style="font-size: 0.7em; color: #888;">${exchangeBadge}:${marketBadge}</span>
                                    ${priceFormatted}
                                </div>
                                <div class="info">
                                    <span>${alert.repeatCount === Infinity ? '♾️' : alert.repeatCount} × ${alert.repeatInterval} мин</span>
                                    <span>${statusText}</span>
                                </div>
                            </div>
                            <div class="actions">
                                <button class="copy-alert-symbol" data-symbol="${alert.symbol}" title="Копировать тикер">📋</button>
                                <button class="pause-alert" data-id="${alert.id}" title="${isPaused ? 'Возобновить' : 'Пауза'}">
                                    ${isPaused ? '▶️' : '⏸️'}
                                </button>
                                <button class="delete-alert" data-id="${alert.id}" title="Удалить">❌</button>
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
            }
        } else {
            if (completedAlerts.length === 0) {
                html = '<div class="empty-alerts">Нет завершенных алертов</div>';
            } else {
                html = '<div class="alert-list">';
                completedAlerts.forEach(alert => {
                    const priceFormatted = Utils.formatPrice(alert.price);
                    const color = alert.options.color;
                    const triggerTime = alert.lastTriggerTime || alert.createdAt;
                    const timeStr = new Date(triggerTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    const dateStr = new Date(triggerTime).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
                    const repeatInfo = alert.triggerCount > 0 ? ` (${alert.triggerCount}×)` : '';

                    html += `
                        <div class="alert-list-item completed" style="border-left-color: ${color}; opacity: 0.8;" data-id="${alert.id}">
                            <div>
                                <div class="price">
                                    <span class="copy-symbol" style="color:#FFD700; font-weight:bold; cursor:pointer;"
                                          data-symbol="${alert.symbol}"
                                          title="Копировать тикер">
                                        ${alert.symbol}
                                    </span>
                                    ${priceFormatted}${repeatInfo}
                                </div>
                                <div class="info">
                                    <span>🕐 ${dateStr} ${timeStr}</span>
                                    <span>✅ Завершен</span>
                                </div>
                            </div>
                            <div class="actions">
                                <button class="copy-alert-symbol" data-symbol="${alert.symbol}" title="Копировать тикер">📋</button>
                                <button class="delete-alert" data-id="${alert.id}" title="Удалить">❌</button>
                            </div>
                        </div>
                    `;
                });
                html += '</div>';

                html += `
                    <div style="padding: 10px; text-align: center;">
                        <button class="clear-completed-btn" style="background: #ff4444; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                            🗑️ Удалить все завершенные (${completedAlerts.length})
                        </button>
                    </div>
                `;
            }
        }

        content.innerHTML = html;

        content.querySelectorAll('.copy-symbol').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard?.writeText(el.dataset.symbol);
                el.style.color = '#00FF00';
                setTimeout(() => el.style.color = '#FFD700', 500);
            });
        });

        content.querySelectorAll('.copy-alert-symbol').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard?.writeText(btn.dataset.symbol);
                btn.textContent = '✅';
                setTimeout(() => btn.textContent = '📋', 500);
            });
        });

        content.querySelectorAll('.delete-alert').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteAlert(btn.dataset.id);
            });
        });

        content.querySelectorAll('.pause-alert').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const alert = this._alerts.find(a => a.alert.id === id)?.alert;
                if (alert) {
                    if (alert.status === 'paused') this.resumeAlert(id);
                    else this.pauseAlert(id);
                }
            });
        });

        const clearBtn = content.querySelector('.clear-completed-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.deleteCompletedAlerts());
        }
    }

    debugAlertTimers() {
        console.log('=== ДЕБАГ ИНТЕРВАЛОВ АЛЕРТОВ ===');

        for (const item of this._alerts) {
            const a = item.alert;
            if (a.status !== 'active') continue;

            const now = Date.now();
            const lastPrice = this._lastPrices.get(a.id);
            const msSinceLastTrigger = a.lastTriggerTime ? now - a.lastTriggerTime : Infinity;
            const intervalMs = (a.repeatInterval || 1) * 60000;
            const canTrigger = a.triggerCount === 0 || msSinceLastTrigger >= intervalMs;
            const key = this._getSubscriptionKey(a.symbol, a.exchange, a.marketType);
            const subscribed = this._subscriptions.has(key);

            console.log(`📌 ${a.symbol} @ ${a.price}:`);
            console.log(`   Ключ: ${key}`);
            console.log(`   Подписан: ${subscribed ? '✅' : '❌'}`);
            console.log(`   Срабатываний: ${a.triggerCount}`);
            console.log(`   Последний триггер: ${a.lastTriggerTime ? new Date(a.lastTriggerTime).toLocaleTimeString() : 'никогда'}`);
            console.log(`   Прошло: ${msSinceLastTrigger === Infinity ? '∞' : (msSinceLastTrigger/1000).toFixed(1)}с`);
            console.log(`   Интервал: ${a.repeatInterval}мин (${intervalMs/1000}с)`);
            console.log(`   Может триггерить: ${canTrigger ? '✅ ДА' : '❌ НЕТ (ждем)'}`);
            console.log(`   Последняя цена: ${lastPrice || 'нет'}`);
            console.log(`   Статус: ${a.status}`);
            console.log('');
        }

        console.log(`📊 Всего подписок: ${this._subscriptions.size}`);
        console.log(`📊 Подписанные символы:`, [...this._subscriptions.keys()]);
        console.log(`📊 Полная загрузка из БД завершена: ${this._allAlertsLoadedFromDB ? '✅' : '❌'}`);
    }

    getAlertsStats() {
        const total = this._alerts.length;
        const active = this._alerts.filter(a => a.alert.status === 'active').length;
        const paused = this._alerts.filter(a => a.alert.status === 'paused').length;
        const completed = this._alerts.filter(a => a.alert.status === 'completed').length;
        const withPrimitive = this._alerts.filter(a => a.primitive !== null).length;

        console.log('=== ALERTS STATS ===');
        console.log(`📊 Всего: ${total}`);
        console.log(`🟢 Активных: ${active}`);
        console.log(`🟡 На паузе: ${paused}`);
        console.log(`✅ Завершено: ${completed}`);
        console.log(`🎨 С примитивом: ${withPrimitive}`);
        console.log(`💰 В lastPrices: ${this._lastPrices.size}`);
        console.log(`📡 Подписок: ${this._subscriptions.size}`);

        return { total, active, paused, completed, withPrimitive, lastPrices: this._lastPrices.size, subscriptions: this._subscriptions.size };
    }

    destroy() {
        window.removeEventListener('mouseup', this._handleGlobalMouseUp);

        if (document._alertSettingsCloseHandler) {
            document.removeEventListener('mousedown', document._alertSettingsCloseHandler);
            document._alertSettingsCloseHandler = null;
        }

        if (this._subCheckInterval) {
            clearInterval(this._subCheckInterval);
            this._subCheckInterval = null;
        }

        // ✅ ИСПРАВЛЕНО: перед очисткой локальной Map реально отписываемся от
        // window.priceManagerInstance, а не просто забываем про handler-ы.
        if (window.priceManagerInstance) {
            for (const [key, handler] of this._subscriptions.entries()) {
                try { window.priceManagerInstance.unsubscribe(key, handler); } catch (e) {}
            }
        }
        this._subscriptions.clear();
        this._alerts = [];
        this._lastPrices.clear();
        this._selectedAlert = null;
        this._hoveredAlert = null;

        if (this._hoverRafId) {
            cancelAnimationFrame(this._hoverRafId);
            this._hoverRafId = null;
        }
        this._pendingMouseEvent = null;

        console.log('🗑️ AlertLineManager destroyed');
    }
}
