class WebSocketManager {
    constructor(chartManager) {
        this.chartManager = chartManager;
        this.wsKline = null;
        this.wsTrade = null; // Для Binance теперь будет null, используем один сокет
        this.reconnectTimer = null;
        this.retryCount = 0;
        this.isConnected = false;
        this.isConnecting = false;
        
        this._lastKlineTime = 0;
        this._lastMessageTime = 0;
        this._connectDebounceTimer = null;
        
        this.currentSymbol = 'BTCUSDT';
        this.currentInterval = '1h';
        this.currentExchange = 'binance';
        this.currentMarketType = 'futures';
        
        this.binanceSpotOnlyTokens = ['BTCDOMUSDT', 'DEFIUSDT', 'ALTUSDT', 'NFTUSDT', 'TOPCOINSUSDT'];
        
        this._visibilityHandler = () => {
            if (!document.hidden) this._onTabVisible();
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
        
        setTimeout(() => this._autoConnect(), 1000);
    }

    _autoConnect() {
        this.connect(this.currentSymbol, this.currentInterval, this.currentExchange, this.currentMarketType);
    }

    getExchangeInterval(interval, exchange) {
        if (exchange === 'bybit') {
            const map = { 
                '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', 
                '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720', 
                '1d': 'D', '1w': 'W', '1M': 'M' 
            };
            return map[interval] || interval;
        }
        return interval;
    }

    formatSymbol(symbol, exchange) {
        return exchange === 'bybit' ? symbol.trim().toUpperCase() : symbol.trim().toLowerCase();
    }

    connect(symbol, interval, exchange, marketType) {
        symbol = (symbol || this.currentSymbol).trim();
        exchange = exchange || this.currentExchange;
        marketType = marketType || this.currentMarketType;
        interval = (interval || this.currentInterval).trim().toLowerCase();
        
        if (exchange === 'binance' && marketType === 'futures' && 
            this.binanceSpotOnlyTokens.includes(symbol.toUpperCase())) {
            marketType = 'spot';
        }
        
        this.currentSymbol = symbol;
        this.currentInterval = interval;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;
        this.retryCount = 0;
        
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this._connectDebounceTimer) clearTimeout(this._connectDebounceTimer);
        
        this._connectDebounceTimer = setTimeout(() => this._doConnect(), 100);
    }

    _doConnect() {
        if (this.isConnecting) return;
        
        this._closeSocket();
        this.isConnecting = true;
        
        const fs = this.formatSymbol(this.currentSymbol, this.currentExchange);
        
        if (this.currentExchange === 'binance') {
            // ✅ ОПТИМИЗАЦИЯ: Используем один combined stream вместо двух сокетов
            const base = this.currentMarketType === 'futures' ? 'wss://fstream.binance.com' : 'wss://stream.binance.com:9443';
            const klineUrl = `${base}/stream?streams=${fs}@kline_${this.currentInterval}/${fs}@aggTrade`;
            console.log('🔌 BINANCE COMBINED:', klineUrl);
            this.wsKline = this._createWebSocket(klineUrl, 'kline');
            this.wsTrade = this.wsKline; // Указываем на тот же сокет для логики проверок
        } else if (this.currentExchange === 'bybit') {
            const wsUrl = 'wss://stream.bybit.com/v5/public/' + (this.currentMarketType === 'spot' ? 'spot' : 'linear');
            console.log('🔌 BYBIT:', wsUrl);
            this.wsKline = this._createWebSocket(wsUrl, 'bybit');
            this.wsTrade = this.wsKline;
        }
    }

    _createWebSocket(url, type) {
        let ws;
        try {
            ws = new WebSocket(url);
        } catch (e) {
            console.error(`❌ Ошибка создания ${type} WebSocket:`, e);
            this._scheduleReconnect(3000);
            return null;
        }
        
        ws._type = type;
        
        ws.onopen = () => {
            console.log(`✅ ${type.toUpperCase()} WebSocket подключён`);
            
            if (type === 'bybit') {
                const bi = this.getExchangeInterval(this.currentInterval, this.currentExchange);
                const bs = this.formatSymbol(this.currentSymbol, this.currentExchange);
                ws.send(JSON.stringify({
                    op: 'subscribe',
                    args: ['kline.' + bi + '.' + bs, 'publicTrade.' + bs]
                }));
                
                clearInterval(ws._pingInterval);
                ws._pingInterval = setInterval(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        try { ws.send(JSON.stringify({ op: 'ping' })); } catch(e) {}
                    }
                }, 20000);
            }
            
            const klineOk = this.wsKline && this.wsKline.readyState === WebSocket.OPEN;
            const tradeOk = this.wsTrade && this.wsTrade.readyState === WebSocket.OPEN;
            
            if (klineOk && tradeOk && !this.isConnected) {
                this.isConnected = true;
                this.isConnecting = false;
                this.retryCount = 0;
                if (this.chartManager?.onWebSocketConnected) {
                    this.chartManager.onWebSocketConnected();
                }
            }
        };
        
        ws.onmessage = (event) => {
            this._lastMessageTime = Date.now();
            this._handleMessage(event.data, type);
        };
        
        ws.onclose = (event) => {
            console.log(`🔌 ${type.toUpperCase()} закрыт:`, event.code, event.reason);
            this.isConnected = false;
            this.isConnecting = false;
            
            // ✅ ИСПРАВЛЕНО: 1005 и 1000 — норма. 1008 — смена маркет типа.
            if (event.code === 1000 || event.code === 1005) return;
            
            if (event.code === 1008) {
                if (this.currentExchange === 'binance' && this.currentMarketType === 'futures' && 
                    this.binanceSpotOnlyTokens.includes(this.currentSymbol.toUpperCase())) {
                    this.currentMarketType = 'spot';
                    this._scheduleReconnect(500);
                }
                return;
            }
            
            // ✅ ИСПРАВЛЕНО: Код 1006 (обрыв интернета) БОЛЬШЕ НЕ ИГНОРИРУЕМ!
            this._scheduleReconnect();
        };
        
        ws.onerror = () => {
            if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
                console.error(`❌ ${type.toUpperCase()} ошибка`);
            }
        };
        
        return ws;
    }

    _handleMessage(rawData, type) {
        try {
            let raw = JSON.parse(rawData);
            
            // ✅ НОВОЕ: Обработка формата combined stream от Binance
            if (this.currentExchange === 'binance' && raw.stream && raw.data) {
                raw = raw.data;
            }
            
            if (raw.op === 'pong' || raw.op === 'subscribe') return;
            
            if (this.currentExchange === 'binance') {
                if (raw.e === 'kline' && raw.k) {
                    const k = raw.k;
                    const msgSymbol = raw.s ? raw.s.toUpperCase() : null;
                    if (msgSymbol && msgSymbol !== this.currentSymbol.toUpperCase()) return;
                    
                    this._lastKlineTime = Math.floor(k.t / 1000);
                    this.chartManager.updateLastCandle({
                        time: Math.floor(k.t / 1000),
                        open: parseFloat(k.o), high: parseFloat(k.h),
                        low: parseFloat(k.l), close: parseFloat(k.c),
                        volume: parseFloat(k.v), quoteVolume: parseFloat(k.q || 0),
                        isClosed: k.x === true
                    });
                }
                
                if (raw.e === 'aggTrade') {
                    const msgSymbol = raw.s ? raw.s.toUpperCase() : null;
                    if (msgSymbol && msgSymbol !== this.currentSymbol.toUpperCase()) return;
                    
                    const price = parseFloat(raw.p);
                    if (!isNaN(price) && price > 0) this.chartManager._syncPriceLine(price);
                }
            }
            else if (this.currentExchange === 'bybit' && raw.topic) {
                const parts = raw.topic.split('.');
                let msgSymbol = null;
                
                if (raw.topic.startsWith('kline.') && parts.length >= 3) msgSymbol = parts[2].toUpperCase();
                else if (raw.topic.startsWith('publicTrade.') && parts.length >= 2) msgSymbol = parts[1].toUpperCase();
                
                if (!msgSymbol || msgSymbol !== this.currentSymbol.toUpperCase()) return;
                
                if (raw.topic.startsWith('kline.') && raw.data?.length) {
                    const k = raw.data[0];
                    this.chartManager.updateLastCandle({
                        time: Math.floor(k.start / 1000),
                        open: parseFloat(k.open), high: parseFloat(k.high),
                        low: parseFloat(k.low), close: parseFloat(k.close),
                        volume: parseFloat(k.volume), quoteVolume: parseFloat(k.turnover || 0),
                        isClosed: k.confirm === true
                    });
                } else if (raw.topic.startsWith('publicTrade.') && raw.data?.length) {
                    const price = parseFloat(raw.data[0].p);
                    if (!isNaN(price) && price > 0) this.chartManager._syncPriceLine(price);
                }
            }
        } catch (e) {
            console.error('❌ Ошибка парсинга:', e);
        }
    }

    _scheduleReconnect(delay = null) {
        if (this.reconnectTimer) return;
        if (delay === null) {
            this.retryCount++;
            delay = Math.min(5000 * Math.pow(1.5, this.retryCount - 1), 60000);
        }
        console.log(`🔄 Переподключение через ${delay}ms (попытка ${this.retryCount})`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this._doConnect();
        }, delay);
    }

    _closeSocket() {
        const closeWs = (ws) => {
            if (!ws) return;
            if (ws._pingInterval) clearInterval(ws._pingInterval);
            ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
            try { if (ws.readyState === WebSocket.OPEN) ws.close(1000); } catch (e) {}
        };
        
        // ✅ ИСПРАВЛЕНО: так как для Binance wsKline и wsTrade - один и тот же объект, 
        // просто закрываем по одному разу
        if (this.wsKline === this.wsTrade) {
            closeWs(this.wsKline);
        } else {
            closeWs(this.wsKline);
            closeWs(this.wsTrade);
        }
        
        this.wsKline = null;
        this.wsTrade = null;
        this.isConnected = false;
        this.isConnecting = false;
    }

    updateSymbolAndTimeframe(symbol, interval, exchange, marketType) {
        this.connect(symbol, interval, exchange, marketType);
    }

    closeAll() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this._connectDebounceTimer) clearTimeout(this._connectDebounceTimer);
        this.reconnectTimer = this._connectDebounceTimer = null;
        this._closeSocket();
    }
    
    ensureConnected() {
        const klineOk = this.wsKline?.readyState === WebSocket.OPEN || this.wsKline?.readyState === WebSocket.CONNECTING;
        if (!klineOk) {
            this.connect(this.currentSymbol, this.currentInterval, this.currentExchange, this.currentMarketType);
        }
    }

    forceReconnect() {
        this.closeAll();
        setTimeout(() => this.connect(this.currentSymbol, this.currentInterval, this.currentExchange, this.currentMarketType), 300);
    }

    _onTabVisible() {
        // ✅ ИСПРАВЛЕНО: Убрали проверку времени (которая вызывала ложные рвения графика). 
        // Проверяем только реальное состояние сокета.
        this.ensureConnected();
    }

    destroy() {
        document.removeEventListener('visibilitychange', this._visibilityHandler);
        this.closeAll();
    }
}

if (typeof window !== 'undefined') {
    window.WebSocketManager = WebSocketManager;
}
