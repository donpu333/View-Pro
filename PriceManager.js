class PriceManager {
    constructor() {
        this.prices = new Map();
        this.subscribers = new Map();
        this.connections = {};
        this.reconnectTimers = new Map();
        this.pingIntervals = new Map();
        this._pendingUpdates = new Map();
        this._flushRafId = null;
        
        this._restPollInterval = null;
        this._lastWsMessage = {};
        this._connectionAttempts = {};
        this._bybitSubscriptions = { linear: new Set(), spot: new Set() };
        this._connectionState = {};
        this._initInProgress = false;
        
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
        
        // ✅ ИСПРАВЛЕНО: Bybit убран из автоматического запуска. 
        // Он подключится только тогда, когда действительно понадобится.
        const connectSequence = [
            () => this._connectBinanceFutures(),
            () => this._connectBinanceSpot()
        ];
        
        connectSequence.forEach((fn, index) => {
            setTimeout(fn, index * this.config.startupDelay);
        });
        
        this._restPollInterval = setInterval(() => this._pollAlertPricesViaRest(), this.config.restPollInterval);
        setTimeout(() => this._pollAlertPricesViaRest(), 1500);
        
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', () => this.close());
        }
        
        console.log('✅ PriceManager v12 запущен (Bybit подключается только по требованию)');
    }

    // ✅ НОВЫЙ МЕТОД: Проверяет, нужен ли Bybit, и подключает его только при наличии подписок
    _ensureBybitConnected() {
        const hasLinear = this._bybitSubscriptions.linear.size > 0;
        const hasSpot = this._bybitSubscriptions.spot.size > 0;

        if (hasLinear && (!this.connections['bybit:linear'] || this.connections['bybit:linear'].readyState !== WebSocket.OPEN)) {
            console.log('🔌 Подключение Bybit Linear (появилась подписка/алерт)');
            this._connectBybitLinear();
        }
        if (hasSpot && (!this.connections['bybit:spot'] || this.connections['bybit:spot'].readyState !== WebSocket.OPEN)) {
            console.log('🔌 Подключение Bybit Spot (появилась подписка/алерт)');
            this._connectBybitSpot();
        }
    }
    
    // ========== ПОДКЛЮЧЕНИЯ К BINANCE ==========
    _connectBinanceFutures() {
        const key = 'binance:futures';
        const url = 'wss://fstream.binance.com/ws/!miniTicker@arr';
        this._connectBinance(key, url, (data) => {
            const tickers = Array.isArray(data) ? data : [data];
            tickers.forEach(ticker => {
                if (!ticker.s || !ticker.c) return;
                const price = parseFloat(ticker.c);
                const change = parseFloat(ticker.P) || 0;
                this._setPrice(ticker.s, { price, change }, 'binance', 'futures');
            });
        });
    }
    
    _connectBinanceSpot() {
        const key = 'binance:spot';
        const url = 'wss://stream.binance.com:9443/ws/!ticker@arr';
        this._connectBinance(key, url, (data) => {
            const tickers = Array.isArray(data) ? data : [data];
            tickers.forEach(ticker => {
                if (!ticker.s || !ticker.c) return;
                const price = parseFloat(ticker.c);
                const change = parseFloat(ticker.P) || 0;
                this._setPrice(ticker.s, { price, change }, 'binance', 'spot');
            });
        });
    }
    
    _connectBinance(key, url, onMessageHandler) {
        if (this.reconnectTimers.has(key)) {
            clearTimeout(this.reconnectTimers.get(key));
            this.reconnectTimers.delete(key);
        }
        if (this.connections[key]) {
            try { this.connections[key].close(1000); } catch(e) {}
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
        };
        
        ws.onmessage = (event) => {
            this._lastWsMessage[key] = Date.now();
            if (event.data === 'ping') {
                try { ws.send('pong'); } catch(e) {}
                return;
            }
            try {
                const data = JSON.parse(event.data);
                onMessageHandler(data);
            } catch(e) {}
        };
        
        ws.onclose = (event) => {
            this._connectionState[key] = 'closed';
            if (this.reconnectTimers.has(key)) clearTimeout(this.reconnectTimers.get(key));
            
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
        this._connectBybit('bybit:linear', 'wss://stream.bybit.com/v5/public/linear', 'linear', 'futures');
    }
    
    _connectBybitSpot() {
        this._connectBybit('bybit:spot', 'wss://stream.bybit.com/v5/public/spot', 'spot', 'spot');
    }
    
    _connectBybit(key, url, marketKey, marketType) {
        if (this.reconnectTimers.has(key)) {
            clearTimeout(this.reconnectTimers.get(key));
            this.reconnectTimers.delete(key);
        }
        if (this.connections[key]) {
            try { this.connections[key].close(1000); } catch(e) {}
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
                    
                    if (symbol && !isNaN(price)) {
                        this._setPrice(symbol, { price, change }, 'bybit', marketType);
                    }
                }
            } catch(e) {}
        };
        
        ws.onclose = (event) => {
            this._connectionState[key] = 'closed';
            this._stopPing(key);
            if (this.reconnectTimers.has(key)) clearTimeout(this.reconnectTimers.get(key));
            
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
        if (symbols.length === 0) return; // ✅ Не отправляем пустые запросы
        
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
        this._ensureBybitConnected(); // ✅ ИСПРАВЛЕНО: инициируем подключение при добавлении символа
        
        const ws = this.connections[marketKey === 'linear' ? 'bybit:linear' : 'bybit:spot'];
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 'subscribe', args: [`tickers.${clean}`] }));
        }
    }
    
    // ========== REST (главный источник цен для алертов) ==========
    async _pollAlertPricesViaRest() {
        if (!window.alertLineManager) return;
        const activeAlerts = window.alertLineManager._alerts.filter(item => {
            const a = item.alert;
            return !a.triggered && a.status !== 'completed' && a.status !== 'paused';
        });
        
        const groups = { 'binance:futures': new Set(), 'binance:spot': new Set(), 'bybit:futures': new Set(), 'bybit:spot': new Set() };
        for (const item of activeAlerts) {
            const a = item.alert;
            const key = `${(a.exchange || 'binance').toLowerCase()}:${(a.marketType || 'futures').toLowerCase()}`;
            if (groups[key]) groups[key].add(a.symbol);
        }
        
        // ✅ ИСПРАВЛЕНО: Если в алертах появился Bybit, принудительно подключаем его WS
        if (groups['bybit:futures'].size > 0 || groups['bybit:spot'].size > 0) {
            this._ensureBybitConnected();
        }

        // Если активных алертов нет вообще, выходим раньше
        if (activeAlerts.length === 0) return;
        
        const tasks = [];
        if (groups['binance:futures'].size > 0) tasks.push(this._fetchBinanceRest([...groups['binance:futures']], 'futures'));
        if (groups['binance:spot'].size > 0) tasks.push(this._fetchBinanceRest([...groups['binance:spot']], 'spot'));
        if (groups['bybit:futures'].size > 0) tasks.push(this._fetchBybitRest([...groups['bybit:futures']], 'futures'));
        if (groups['bybit:spot'].size > 0) tasks.push(this._fetchBybitRest([...groups['bybit:spot']], 'spot'));
        
        await Promise.allSettled(tasks);
    }
    
    async _fetchBinanceRest(symbols, marketType) {
        try {
            const url = symbols.length === 1 
                ? `https://${marketType === 'futures' ? 'fapi' : 'api'}.binance.com/${marketType === 'futures' ? 'fapi/v1' : 'api/v3'}/ticker/24hr?symbol=${symbols[0]}`
                : `https://${marketType === 'futures' ? 'fapi' : 'api'}.binance.com/${marketType === 'futures' ? 'fapi/v1' : 'api/v3'}/ticker/24hr?symbols=[${symbols.map(s => `"${s}"`).join(',')}]`;
            
            const response = await this._fetchWithRetry(url);
            if (!response) return;
            const data = await response.json();
            const tickers = Array.isArray(data) ? data : [data];
            
            for (const ticker of tickers) {
                const price = parseFloat(ticker.lastPrice || ticker.price);
                const change = parseFloat(ticker.priceChangePercent) || 0;
                if (ticker.symbol && price && !isNaN(price)) {
                    this._setPrice(ticker.symbol, { price, change }, 'binance', marketType);
                    window.alertLineManager?._checkAlerts?.(ticker.symbol, price, 'binance', marketType);
                }
            }
        } catch(e) {}
    }
    
    async _fetchBybitRest(symbols, marketType) {
        try {
            const category = marketType === 'futures' ? 'linear' : 'spot';
            const tasks = symbols.map(sym => 
                fetch(`https://api.bybit.com/v5/market/tickers?category=${category}&symbol=${sym}`)
                    .then(r => r.json())
                    .catch(() => null)
            );
            
            const results = await Promise.all(tasks);
            
            for (const data of results) {
                if (data?.retCode === 0 && data.result?.list?.[0]) {
                    const ticker = data.result.list[0];
                    const price = parseFloat(ticker.lastPrice);
                    const change = parseFloat(ticker.price24hPcnt) || 0;
                    if (price && !isNaN(price)) {
                        this._setPrice(ticker.symbol, { price, change }, 'bybit', marketType);
                        window.alertLineManager?._checkAlerts?.(ticker.symbol, price, 'bybit', marketType);
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

        if (isNaN(price) || price <= 0) return;
        
        const key = `${symbol}:${exchange}:${marketType}`;
        const old = this.prices.get(key);
        
        if (old && old.price === price && old.change === change) return;
        
        this.prices.set(key, { price, change, time: Date.now() });
        this._pendingUpdates.set(key, { price, change, symbol, exchange, marketType });
        
        if (this._flushRafId === null) {
            this._flushRafId = requestAnimationFrame(() => {
                this._flushRafId = null;
                const updates = new Map(this._pendingUpdates);
                this._pendingUpdates.clear();
                for (const [k, data] of updates.entries()) {
                    const payload = { price: data.price, change: data.change };
                    
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
            });
        }
    }

    // ========== ПОДПИСКА ==========
    subscribe(key, callback) {
        if (!this.subscribers.has(key)) this.subscribers.set(key, []);
        this.subscribers.get(key).push(callback);
        const parts = key.split(':');
        if (parts.length === 3 && parts[1] === 'bybit') {
            this.subscribeBybitSymbol(parts[0], parts[2]); // Здесь уже вызовется _ensureBybitConnected
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
        if (list.length === 0) this.subscribers.delete(key);
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
        if (this._restPollInterval) {
            clearInterval(this._restPollInterval);
            this._restPollInterval = null;
        }
        
        if (this._flushRafId) {
            cancelAnimationFrame(this._flushRafId);
            this._flushRafId = null;
        }
        this._pendingUpdates.clear();
        
        for (const key in this.pingIntervals) {
            this._stopPing(key);
        }
        
        for (const ws of Object.values(this.connections)) { 
            if (ws) {
                ws.onclose = null; 
                ws.onerror = null;
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
    if (!window.priceManagerInstance) {
        window.priceManagerInstance = new PriceManager();
    }
    
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
