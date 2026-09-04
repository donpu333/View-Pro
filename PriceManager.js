class PriceManager {
    constructor() {
        this.prices = new Map();
        this.subscribers = new Map();
        this.connections = {};
        this.reconnectTimers = new Map();
        this.pingIntervals = new Map();
        this._pendingUpdates = new Map();
        this._flushTimerId = null;
        
        this._restPollInterval = null;
        this._heartbeatInterval = null; 
        this._lastWsMessage = {};
        this._connectionAttempts = {};
        this._bybitSubscriptions = { linear: new Set(), spot: new Set() };
        this._connectionState = {};
        this._initInProgress = false;
        this._destroyed = false;          // ✅ флаг уничтожения менеджера
        this._wakeCheckTimerId = null;     // ✅ id вложенного таймера пробуждения вкладки
        
        this.config = {
            reconnectDelay: 15000,
            maxReconnectDelay: 120000,
            restPollInterval: 10000,
            bybitPingInterval: 15000, 
            startupDelay: 2000
        };
        
        this._init();
    }
    
    _init() {
        if (this._initInProgress) return;
        this._initInProgress = true;
        
        const connectSequence = [
            () => this._connectBinanceFutures(),
            () => this._connectBinanceSpot()
        ];
        
        connectSequence.forEach((fn, index) => {
            setTimeout(fn, index * this.config.startupDelay);
        });
        
        this._restPollInterval = setInterval(() => this._pollAlertPricesViaRest(), this.config.restPollInterval);
        setTimeout(() => this._pollAlertPricesViaRest(), 1500);
        
        this._heartbeatInterval = setInterval(() => this._checkHeartbeats(), 5000);
        
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', () => this.close());
        }

        if (typeof document !== 'undefined') {
            this._visibilityHandler = () => {
                if (this._destroyed) return; // ✅ не реагируем после close()
                if (!document.hidden) {
                    const now = Date.now();
                    for (const key in this.connections) {
                        if (this.connections[key]?.readyState === WebSocket.OPEN) {
                            this._lastWsMessage[key] = now;
                        }
                    }
                    
                    if (this._wakeCheckTimerId) clearTimeout(this._wakeCheckTimerId); // ✅ не копим параллельные таймеры
                    this._wakeCheckTimerId = setTimeout(() => {
                        this._wakeCheckTimerId = null;
                        if (this._destroyed) return; // ✅ менеджер уже уничтожен — не воскрешаем сокеты
                        if (document.hidden) return;
                        const checkNow = Date.now();
                        for (const key in this.connections) {
                            const ws = this.connections[key];
                            if (ws?.readyState === WebSocket.OPEN) {
                                const elapsed = checkNow - (this._lastWsMessage[key] || 0);
                                if (elapsed > 5000) {
                                    console.warn(`💔 ${key} не ожил после сна вкладки. Реконнект...`);
                                    ws.onclose = null; 
                                    ws.onerror = null;
                                    try { ws.close(4000, 'Zombie after sleep'); } catch(e) {}
                                    
                                    if (key === 'binance:futures') this._connectBinanceFutures();
                                    else if (key === 'binance:spot') this._connectBinanceSpot();
                                    else if (key === 'bybit:linear') this._connectBybitLinear();
                                    else if (key === 'bybit:spot') this._connectBybitSpot();
                                }
                            }
                        }
                    }, 5000);
                }
            };
            document.addEventListener('visibilitychange', this._visibilityHandler);
        }
        
        console.log('✅ PriceManager v18 запущен (Защита от сна вкладки + Оптимизация 600+ монет + Исправлен REST-резерв цен)');
    }

    _checkHeartbeats() {
        if (this._destroyed) return; // ✅
        const now = Date.now();
        const ZOMBIE_TIMEOUT = 30000; 

        if (typeof document !== 'undefined' && document.hidden) return;

        for (const key in this.connections) {
            const ws = this.connections[key];
            if (!ws || ws.readyState !== WebSocket.OPEN) continue;

            const lastMsgTime = this._lastWsMessage[key] || 0;
            const elapsed = now - lastMsgTime;

            if (elapsed > ZOMBIE_TIMEOUT) {
                console.warn(`💔 ${key} ЗОМБИ! Нет данных ${Math.round(elapsed/1000)}с. Принудительное переподключение...`);
                
                ws.onclose = null; 
                ws.onerror = null;
                
                try { ws.close(4000, 'Zombie connection'); } catch(e) {}
                
                if (key === 'binance:futures') this._connectBinanceFutures();
                else if (key === 'binance:spot') this._connectBinanceSpot();
                else if (key === 'bybit:linear') this._connectBybitLinear();
                else if (key === 'bybit:spot') this._connectBybitSpot();
            }
        }
    }

    _ensureBybitConnected() {
        const hasLinear = this._bybitSubscriptions.linear.size > 0;
        const hasSpot = this._bybitSubscriptions.spot.size > 0;

        // ✅ CONNECTING считаем "уже подключаемся", а не поводом для нового connect.
        // Раньше проверка "!== OPEN" на каждый REST-полл (раз в 10с) заново дёргала
        // _connectBybitLinear/Spot, пока сокет ещё в процессе установки соединения —
        // это обрывало живой хэндшейк и запускало паразитный цикл переподключений.
        const isActive = (ws) => ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);

        if (hasLinear && !isActive(this.connections['bybit:linear'])) {
            console.log('🔌 Подключение Bybit Linear (появилась подписка/алерт)');
            this._connectBybitLinear();
        }
        if (hasSpot && !isActive(this.connections['bybit:spot'])) {
            console.log('🔌 Подключение Bybit Spot (появилась подписка/алерт)');
            this._connectBybitSpot();
        }
    }
    
    // ========== ПОДКЛЮЧЕНИЯ К BINANCE ==========
    // ⚠️ ПРОВЕРИТЬ: путь "/market/ws/" в URL ниже нетипичен для официального Binance Futures
    // WS-эндпоинта (обычно это wss://fstream.binance.com/ws/!ticker@arr). Если это не
    // сознательно настроенный прокси на вашей стороне, а опечатка — соединение может вообще
    // не устанавливаться, и все фьючерсные алерты будут держаться только на REST-резерве
    // (который был сломан, см. фикс в _fetchBinanceRest ниже). Я не стал менять этот URL
    // без возможности проверить сетевое подключение — но стоит явно свериться с логами
    // (успевает ли когда-нибудь появиться "✅ binance:futures WebSocket подключен").
    _connectBinanceFutures() {
        if (this._destroyed) return; // ✅
        const key = 'binance:futures';
        const url = 'wss://fstream.binance.com/market/ws/!ticker@arr';
        
        this._connectBinance(key, url, (data) => {
            const tickers = Array.isArray(data) ? data : [data];
            for (let i = 0; i < tickers.length; i++) {
                const t = tickers[i];
                if (!t.s || !t.c) continue;
                
                const subKey = `${t.s}:binance:futures`;
                if (!this.subscribers.has(subKey) && !this.subscribers.has(t.s)) continue;

                const price = parseFloat(t.c);
                const change = parseFloat(t.P) || 0;
                const volume = parseFloat(t.q) || 0;   
                const trades = parseInt(t.n) || 0;     
                
                this._setPrice(t.s, { price, change, volume, trades }, 'binance', 'futures');
            }
        });
    }
    
    _connectBinanceSpot() {
        if (this._destroyed) return; // ✅
        const key = 'binance:spot';
        const url = 'wss://stream.binance.com/ws/!ticker@arr';
        
        this._connectBinance(key, url, (data) => {
            const tickers = Array.isArray(data) ? data : [data];
            for (let i = 0; i < tickers.length; i++) {
                const t = tickers[i];
                if (!t.s || !t.c) continue;

                const subKey = `${t.s}:binance:spot`;
                if (!this.subscribers.has(subKey) && !this.subscribers.has(t.s)) continue;

                const price = parseFloat(t.c);
                const change = parseFloat(t.P) || 0;
                const volume = parseFloat(t.q) || 0;   
                const trades = parseInt(t.n) || 0;     
                
                this._setPrice(t.s, { price, change, volume, trades }, 'binance', 'spot');
            }
        });
    }
    
    _connectBinance(key, url, onMessageHandler) {
        if (this._destroyed) return; // ✅
        if (this.reconnectTimers.has(key)) {
            clearTimeout(this.reconnectTimers.get(key));
            this.reconnectTimers.delete(key);
        }
        if (this.connections[key]) {
            // ✅ обнуляем обработчики СТАРОГО сокета ДО close().
            // Иначе, если старый сокет ещё OPEN/CONNECTING, его "родной" onclose
            // сработает и запланирует свой собственный отложенный реконнект —
            // тот, что через 15-100с внезапно оборвёт уже нормально работающее
            // новое соединение и запустит бесконечный паразитный цикл реконнектов.
            const oldWs = this.connections[key];
            oldWs.onclose = null;
            oldWs.onerror = null;
            oldWs.onmessage = null;
            try { oldWs.close(1000); } catch(e) {}
            this.connections[key] = null;
        }
        
        const ws = new WebSocket(url);
        this.connections[key] = ws;
        this._connectionAttempts[key] = (this._connectionAttempts[key] || 0) + 1;
        this._connectionState[key] = 'connecting';
        
        ws.onopen = () => {
            this._lastWsMessage[key] = Date.now();
            this._connectionAttempts[key] = 0;
            this._connectionState[key] = 'open';
            console.log(`✅ ${key} WebSocket подключен`);
        };
        
        ws.onmessage = (event) => {
            this._lastWsMessage[key] = Date.now();
            
            try {
                const data = JSON.parse(event.data);
                onMessageHandler(data);
            } catch(e) {}
        };
        
        ws.onclose = (event) => {
            this._connectionState[key] = 'closed';
            if (this.reconnectTimers.has(key)) clearTimeout(this.reconnectTimers.get(key));
            if (this._destroyed) return; // ✅ после close() менеджера не планируем реконнект
            
            const attempts = this._connectionAttempts[key] || 0;
            const delay = Math.min(
                this.config.reconnectDelay * Math.pow(1.5, attempts),
                this.config.maxReconnectDelay
            );
            console.warn(`⚠️ ${key} закрыт (код ${event.code || 'неизвестен'}), реконнект через ${delay/1000}с (попытка ${attempts + 1})`);
            
            this.reconnectTimers.set(key, setTimeout(() => {
                this._connectBinance(key, url, onMessageHandler);
            }, delay));
        };
        
        ws.onerror = (error) => {
            console.error(`❌ Ошибка WebSocket ${key}:`, error);
        };
    }
    
    // ========== ПОДКЛЮЧЕНИЯ К BYBIT ==========
    _connectBybitLinear() {
        if (this._destroyed) return; // ✅
        this._connectBybit('bybit:linear', 'wss://stream.bybit.com/v5/public/linear', 'linear', 'futures');
    }
    
    _connectBybitSpot() {
        if (this._destroyed) return; // ✅
        this._connectBybit('bybit:spot', 'wss://stream.bybit.com/v5/public/spot', 'spot', 'spot');
    }
    
    _connectBybit(key, url, marketKey, marketType) {
        if (this._destroyed) return; // ✅
        if (this.reconnectTimers.has(key)) {
            clearTimeout(this.reconnectTimers.get(key));
            this.reconnectTimers.delete(key);
        }
        if (this.connections[key]) {
            // ✅ та же причина, что и в _connectBinance — обнуляем обработчики
            // старого сокета перед close(), чтобы не наплодить призрачные реконнекты.
            const oldWs = this.connections[key];
            oldWs.onclose = null;
            oldWs.onerror = null;
            oldWs.onmessage = null;
            try { oldWs.close(1000); } catch(e) {}
            this.connections[key] = null;
        }
        
        const ws = new WebSocket(url);
        this.connections[key] = ws;
        this._connectionAttempts[key] = (this._connectionAttempts[key] || 0) + 1;
        
        ws.onopen = () => {
            this._lastWsMessage[key] = Date.now();
            this._connectionState[key] = 'open';
            this._connectionAttempts[key] = 0; 
            this._startPingBybit(key, ws);
            this._resubscribeBybit(marketKey);
        };
        
        ws.onmessage = (event) => {
            this._lastWsMessage[key] = Date.now();
            try {
                const msg = JSON.parse(event.data);
                if (msg.op === 'pong' || msg.ret_msg === 'pong') return;
                
                if (msg.topic?.startsWith('tickers.') && msg.data) {
                    const symbol = msg.data.symbol || msg.data.s;
                    const price = parseFloat(msg.data.lastPrice || msg.data.c);
                    const change = parseFloat(msg.data.price24hPcnt) || 0;
                    const volume = parseFloat(msg.data.turnover24h) || 
                                   (parseFloat(msg.data.volume24h) * price) || 0;
                    const trades = parseInt(msg.data.count) || 0;
                    
                    if (symbol && !isNaN(price)) {
                        this._setPrice(symbol, { price, change, volume, trades }, 'bybit', marketType);
                    }
                }
            } catch(e) {}
        };
        
        ws.onclose = (event) => {
            this._connectionState[key] = 'closed';
            this._stopPing(key);
            if (this.reconnectTimers.has(key)) clearTimeout(this.reconnectTimers.get(key));
            if (this._destroyed) return; // ✅
            
            const attempts = this._connectionAttempts[key] || 0;
            const delay = Math.min(
                this.config.reconnectDelay * Math.pow(1.5, attempts),
                this.config.maxReconnectDelay
            );
            console.warn(`⚠️ ${key} закрыт (код ${event.code || 'неизвестен'}, reason: ${event.reason || 'нет'}), реконнект через ${delay/1000}с (попытка ${attempts + 1})`);
            
            this.reconnectTimers.set(key, setTimeout(() => {
                this._connectBybit(key, url, marketKey, marketType);
            }, delay));
        };
        
        ws.onerror = (error) => {
            console.error(`❌ Ошибка WebSocket ${key}:`, error);
        };
    }
    
    // ========== ПИНГИ ДЛЯ BYBIT ==========
    _startPingBybit(key, ws) {
        this._stopPing(key);
        this.pingIntervals[key] = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) {
                try { ws.send(JSON.stringify({ op: 'ping', req_id: Date.now() })); } catch(e) {}
            }
        }, this.config.bybitPingInterval);
    }
    
    _stopPing(key) {
        if (this.pingIntervals[key]) {
            clearInterval(this.pingIntervals[key]);
            this.pingIntervals[key] = null;
        }
    }
    
    _resubscribeBybit(marketKey) {
        const ws = this.connections[marketKey === 'linear' ? 'bybit:linear' : 'bybit:spot'];
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const symbols = [...this._bybitSubscriptions[marketKey]];
        if (symbols.length === 0) return;
        
        for (let i = 0; i < symbols.length; i += 10) {
            const batch = symbols.slice(i, i + 10).map(s => `tickers.${s}`);
            ws.send(JSON.stringify({ op: 'subscribe', args: batch }));
        }
    }
    
    subscribeBybitSymbol(symbol, marketType) {
        const marketKey = marketType === 'futures' ? 'linear' : 'spot';
        const clean = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (this._bybitSubscriptions[marketKey].has(clean)) return;
        
        this._bybitSubscriptions[marketKey].add(clean);
        this._ensureBybitConnected();
        
        const ws = this.connections[marketKey === 'linear' ? 'bybit:linear' : 'bybit:spot'];
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 'subscribe', args: [`tickers.${clean}`] }));
        }
    }

    // ✅ обратная операция к subscribeBybitSymbol — снимает подписку с сокета, когда
    // на монету больше нет ни одного подписчика (используется из PriceManager.unsubscribe).
    unsubscribeBybitSymbol(symbol, marketType) {
        const marketKey = marketType === 'futures' ? 'linear' : 'spot';
        const clean = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!this._bybitSubscriptions[marketKey].has(clean)) return;
        
        this._bybitSubscriptions[marketKey].delete(clean);
        
        const ws = this.connections[marketKey === 'linear' ? 'bybit:linear' : 'bybit:spot'];
        if (ws?.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ op: 'unsubscribe', args: [`tickers.${clean}`] })); } catch(e) {}
        }
    }
    
    // ========== REST (главный источник цен для алертов) ==========
    async _pollAlertPricesViaRest() {
        if (this._destroyed) return; // ✅
        if (!window.alertLineManager) return;
        
        const activeAlerts = window.alertLineManager._alerts.filter(item => {
            const a = item.alert;
            return a.status === 'active';
        });
        
        if (activeAlerts.length === 0) return;
        
        const groups = { 
            'binance:futures': new Set(), 
            'binance:spot': new Set(), 
            'bybit:futures': new Set(), 
            'bybit:spot': new Set() 
        };
        
        for (const item of activeAlerts) {
            const a = item.alert;
            const key = `${(a.exchange || 'binance').toLowerCase()}:${(a.marketType || 'futures').toLowerCase()}`;
            if (groups[key]) groups[key].add(a.symbol);
        }
        
        if (groups['bybit:futures'].size > 0 || groups['bybit:spot'].size > 0) {
            this._ensureBybitConnected();
        }
        
        const tasks = [];
        if (groups['binance:futures'].size > 0) tasks.push(this._fetchBinanceRest([...groups['binance:futures']], 'futures'));
        if (groups['binance:spot'].size > 0) tasks.push(this._fetchBinanceRest([...groups['binance:spot']], 'spot'));
        if (groups['bybit:futures'].size > 0) tasks.push(this._fetchBybitRest([...groups['bybit:futures']], 'futures'));
        if (groups['bybit:spot'].size > 0) tasks.push(this._fetchBybitRest([...groups['bybit:spot']], 'spot'));
        
        await Promise.allSettled(tasks);
    }
    
    // ✅ ИСПРАВЛЕНО (главный баг PriceManager): раньше при 2+ символах запрос строился
    // как "...ticker/24hr?symbols=[\"BTCUSDT\",\"ETHUSDT\"]". Параметр "symbols" (батч
    // из нескольких монет) поддерживается ТОЛЬКО у Binance SPOT API. У Binance FUTURES
    // API (/fapi/v1/ticker/24hr) такого параметра нет — принимается только одиночный
    // "symbol". В результате при наличии активных алертов на 2+ разных фьючерсных
    // монетах одновременно запрос к Binance Futures завершался ошибкой, которая тихо
    // проглатывалась в catch(e) {} — REST-резерв цен переставал обновляться вообще ни
    // для одной из монет в этом батче. Теперь вместо одного "умного" батч-запроса мы
    // запрашиваем ВЕСЬ список тикеров рынка одним обычным запросом без параметра
    // symbol (официально поддерживаемый режим и для FUTURES, и для SPOT) и фильтруем
    // нужные монеты уже на своей стороне. Заодно добавлена проверка response.ok —
    // раньше ошибочный ответ пытались распарсить как валидный тикер.
    async _fetchBinanceRest(symbols, marketType) {
        if (!symbols || symbols.length === 0) return;
        try {
            const url = marketType === 'futures'
                ? 'https://fapi.binance.com/fapi/v1/ticker/24hr'
                : 'https://api.binance.com/api/v3/ticker/24hr';

            const response = await this._fetchWithRetry(url);
            if (!response || !response.ok) return;
            const data = await response.json();
            const tickers = Array.isArray(data) ? data : [data];
            const wanted = new Set(symbols);

            for (const ticker of tickers) {
                if (!ticker.symbol || !wanted.has(ticker.symbol)) continue;
                const price = parseFloat(ticker.lastPrice || ticker.price);
                const change = parseFloat(ticker.priceChangePercent) || 0;
                if (price && !isNaN(price)) {
                    this._setPrice(ticker.symbol, { price, change }, 'binance', marketType);
                }
            }
        } catch(e) {}
    }
    
    // ✅ ИСПРАВЛЕНО: раньше символы склеивались через запятую в один параметр
    // "symbol=BTCUSDT,ETHUSDT,..." батчами по 10. Официальный Bybit v5
    // "/v5/market/tickers" документирован как принимающий только ОДИН symbol за
    // запрос — поведение с несколькими через запятую не гарантировано (в лучшем
    // случае действует как один из символов/игнорируется, в худшем — ошибка,
    // которая проглатывалась в .catch(() => null)). Теперь запрашиваем весь список
    // тикеров категории одним запросом без symbol и фильтруем нужные монеты сами —
    // это и надёжнее, и требует всего одного запроса вместо нескольких батчей.
    async _fetchBybitRest(symbols, marketType) {
        if (!symbols || symbols.length === 0) return;
        try {
            const category = marketType === 'futures' ? 'linear' : 'spot';
            const response = await this._fetchWithRetry(
                `https://api.bybit.com/v5/market/tickers?category=${category}`
            );
            if (!response || !response.ok) return;
            const data = await response.json();
            const wanted = new Set(symbols);

            if (data?.retCode === 0 && Array.isArray(data.result?.list)) {
                for (const ticker of data.result.list) {
                    if (!ticker.symbol || !wanted.has(ticker.symbol)) continue;
                    const price = parseFloat(ticker.lastPrice);
                    const change = parseFloat(ticker.price24hPcnt) || 0;
                    if (price && !isNaN(price)) {
                        this._setPrice(ticker.symbol, { price, change }, 'bybit', marketType);
                    }
                }
            }
        } catch(e) {}
    }
    
    async _fetchWithRetry(url, maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch(url);
                if (response.ok) return response;
                if (response.status === 429) {
                    await new Promise(resolve => setTimeout(resolve, 5000 * (i + 1)));
                    continue;
                }
                if (response.status >= 500) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
                    continue;
                }
                return response;
            } catch(e) {
                if (i === maxRetries - 1) throw e;
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
            }
        }
        return null;
    }
    
    // ========== УСТАНОВКА ЦЕНЫ ==========
    _setPrice(symbol, priceData, exchange, marketType) {
        if (!symbol) return;
        
        const isObject = typeof priceData === 'object' && priceData !== null;
        const price = isObject ? parseFloat(priceData.price) : parseFloat(priceData);
        const change = isObject ? parseFloat(priceData.change) : undefined;
        
        // ✅ раньше parseFloat(undefined) давал NaN вместо undefined,
        // и проверка "volume === undefined" в дедупликации ниже никогда не срабатывала —
        // из-за этого REST-обновления цены (без volume/trades) всегда считались
        // "изменившимися" и лишний раз дёргали всех подписчиков.
        const volume = (isObject && priceData.volume !== undefined) ? parseFloat(priceData.volume) : undefined;
        const trades = (isObject && priceData.trades !== undefined) ? parseInt(priceData.trades) : undefined;

        if (isNaN(price) || price <= 0) return;
        
        const key = `${symbol}:${exchange}:${marketType}`;
        const old = this.prices.get(key);
        
        const newVolume = (volume !== undefined && !isNaN(volume)) ? volume : (old?.volume);
        const newTrades = (trades !== undefined && !isNaN(trades)) ? trades : (old?.trades);
        
        if (old && 
            old.price === price && 
            old.change === change && 
            (volume === undefined || old.volume === volume) && 
            (trades === undefined || old.trades === trades)) {
            return;
        }
        
        this.prices.set(key, { price, change, volume: newVolume, trades: newTrades, time: Date.now() });
        this._pendingUpdates.set(key, { price, change, volume: newVolume, trades: newTrades, symbol, exchange, marketType });
        
        if (this._flushTimerId === null) {
            this._flushTimerId = setTimeout(() => {
                this._flushTimerId = null;
                const updates = new Map(this._pendingUpdates);
                this._pendingUpdates.clear();
                for (const [k, data] of updates.entries()) {
                    const payload = { 
                        price: data.price, 
                        change: data.change,
                        volume: data.volume,
                        trades: data.trades
                    };
                    
                    if (this.subscribers.has(k)) {
                        this.subscribers.get(k).forEach(cb => { 
                            try { cb(payload, data.symbol, data.exchange, data.marketType); } catch(e) {} 
                        });
                    }
                    if (this.subscribers.has(data.symbol)) {
                        this.subscribers.get(data.symbol).forEach(cb => { 
                            try { cb(payload, data.symbol, data.exchange, data.marketType); } catch(e) {} 
                        });
                    }
                }
            }, 100);
        }
    }
    
    // ========== ПОДПИСКА ==========
    subscribe(key, callback) {
        if (!this.subscribers.has(key)) this.subscribers.set(key, []);
        this.subscribers.get(key).push(callback);
        const parts = key.split(':');
        if (parts.length === 3 && parts[1] === 'bybit') {
            this.subscribeBybitSymbol(parts[0], parts[2]);
        }
        const cached = this.prices.get(key);
        if (cached) {
            setTimeout(() => { 
                try { 
                    callback({ price: cached.price, change: cached.change }, parts[0], parts[1], parts[2]); 
                } catch(e) {} 
            }, 0);
        }
    }
    
    unsubscribe(key, callback) {
        if (!this.subscribers.has(key)) return;
        const list = this.subscribers.get(key);
        const idx = list.indexOf(callback);
        if (idx !== -1) list.splice(idx, 1);
        if (list.length === 0) {
            this.subscribers.delete(key);
            
            // ✅ если это была Bybit-подписка и других подписчиков на неё
            // не осталось — отписываемся от сокета, чтобы не копить лишний трафик.
            const parts = key.split(':');
            if (parts.length === 3 && parts[1] === 'bybit') {
                this.unsubscribeBybitSymbol(parts[0], parts[2]);
            }
        }
    }
    
    getPrice(symbol, exchange = null, marketType = null) {
        let key;
        if (exchange && marketType) key = `${symbol}:${exchange}:${marketType}`;
        else if (symbol.includes(':')) key = symbol;
        else key = `${symbol}:binance:futures`;
        const data = this.prices.get(key);
        return data ? data.price : null;
    }
    
    async fetchPrice(symbol, exchange = 'binance', marketType = 'futures') {
        if (!symbol) return null;
        try {
            let url;
            if (exchange === 'binance') {
                url = marketType === 'futures'
                    ? `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`
                    : `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;
            } else {
                const category = marketType === 'futures' ? 'linear' : 'spot';
                url = `https://api.bybit.com/v5/market/tickers?category=${category}&symbol=${symbol}`;
            }
            const response = await fetch(url);
            const data = await response.json();
            let price = null;
            let change = 0;
            
            if (exchange === 'binance') {
                price = parseFloat(data.lastPrice || data.price);
                change = parseFloat(data.priceChangePercent) || 0;
            } else {
                if (data.retCode === 0 && data.result?.list?.[0]) {
                    price = parseFloat(data.result.list[0].lastPrice);
                    change = parseFloat(data.result.list[0].price24hPcnt) || 0;
                }
            }
            if (price && !isNaN(price)) {
                this._setPrice(symbol, { price, change }, exchange, marketType);
                return price;
            }
        } catch(e) {}
        return null;
    }
    
    getStatus() {
        const status = {};
        for (const [key, ws] of Object.entries(this.connections)) {
            const lastMsg = this._lastWsMessage[key];
            status[key] = {
                readyState: ws?.readyState,
                lastMessage: lastMsg ? `${Math.round((Date.now() - lastMsg) / 1000)}с назад` : 'никогда',
                state: this._connectionState[key] || 'unknown'
            };
        }
        return {
            connections: status,
            totalPrices: this.prices.size,
            totalSubscribers: this.subscribers.size
        };
    }
    
    close() {
        this._destroyed = true; // ✅ блокирует любые дальнейшие реконнекты/таймеры
        
        if (this._restPollInterval) {
            clearInterval(this._restPollInterval);
            this._restPollInterval = null;
        }
        
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
        }

        if (this._visibilityHandler && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }
        
        if (this._wakeCheckTimerId) {           // ✅ чистим "призрачный" таймер пробуждения
            clearTimeout(this._wakeCheckTimerId);
            this._wakeCheckTimerId = null;
        }
        
        if (this._flushTimerId) {
            clearTimeout(this._flushTimerId);
            this._flushTimerId = null;
        }
        this._pendingUpdates.clear();
        
        for (const key in this.pingIntervals) {
            this._stopPing(key);
        }
        
        for (const ws of Object.values(this.connections)) { 
            if (ws) {
                ws.onclose = null; 
                ws.onerror = null;
                ws.onmessage = null;
                try { ws.close(1000); } catch(e) {} 
            }
        }
        
        for (const timer of this.reconnectTimers.values()) {
            clearTimeout(timer);
        }
        this.reconnectTimers.clear();
    }
}

if (typeof window !== 'undefined') {
    window.PriceManager = PriceManager;
    
    // ✅ защита от дублирования синглтона (например, при hot-reload скрипта).
    // Раньше старый инстанс со всеми его WS/таймерами мог остаться жить
    // параллельно новому, удваивая соединения и трафик.
    if (window.priceManagerInstance && typeof window.priceManagerInstance.close === 'function') {
        try { window.priceManagerInstance.close(); } catch(e) {}
    }
    window.priceManagerInstance = new PriceManager();
    
    window.checkWS = function() {
        const pm = window.priceManagerInstance;
        if (!pm) return console.error('❌ PriceManager не найден');
        console.log('=== СТАТУС ===');
        console.table(pm.getStatus().connections);
        console.log(`💰 Цен: ${pm.prices.size}`);
        console.log(`👥 Подписчиков: ${pm.subscribers.size}`);
        return pm.getStatus();
    };
}
