class WebSocketManager {
    constructor(chartManager) {
        this.chartManager = chartManager;
        this.wsKline = null;
        this.wsTrade = null;
        this.reconnectTimer = null;
        this.retryCount = 0;
        this.isConnected = false;
        this.isConnecting = false;
        
        this._lastKlineTime = 0;
        this._lastMessageTime = 0;
        this._connectDebounceTimer = null;
        this._statusCheckInterval = null;
        
        this.currentSymbol = 'BTCUSDT';
        this.currentInterval = '1h';
        this.currentExchange = 'binance';
        this.currentMarketType = 'futures';
        
        this.binanceSpotOnlyTokens = ['BTCDOMUSDT', 'DEFIUSDT', 'ALTUSDT', 'NFTUSDT', 'TOPCOINSUSDT'];
        
        this._visibilityHandler = () => {
            if (!document.hidden) {
                this._onTabVisible();
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
        
        setTimeout(() => this._autoConnect(), 1000);
    }

    _autoConnect() {
        console.log('🚀 WebSocketManager: автоподключение...');
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
        
        // Проверка на spot-only токены для фьючерсов
        if (exchange === 'binance' && marketType === 'futures' && 
            this.binanceSpotOnlyTokens.includes(symbol.toUpperCase())) {
            console.log('⚠️ Токен', symbol, 'доступен только на spot, переключаемся');
            marketType = 'spot';
        }
        
        this.currentSymbol = symbol;
        this.currentInterval = interval;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;
        this.retryCount = 0;
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this._connectDebounceTimer) {
            clearTimeout(this._connectDebounceTimer);
        }
        
        this._connectDebounceTimer = setTimeout(() => {
            this._doConnect();
        }, 100);
    }

  _doConnect() {
    this._closeSocket();
    
    const fs = this.formatSymbol(this.currentSymbol, this.currentExchange);
    
    if (this.currentExchange === 'binance') {
        // ✅ ИСПРАВЛЕНО: оба потока через market/ws
        const klineUrl = `wss://fstream.binance.com/market/ws/${fs}@kline_${this.currentInterval}`;
        const tradeUrl = `wss://fstream.binance.com/market/ws/${fs}@aggTrade`;  // ← ИСПРАВЛЕНО!
        
        console.log('🔌 KLINE:', klineUrl);
        console.log('🔌 TRADE:', tradeUrl);
        
        this.wsKline = this._createWebSocket(klineUrl, 'kline');
        this.wsTrade = this._createWebSocket(tradeUrl, 'trade');
    } else if (this.currentExchange === 'bybit') {
        const wsUrl = 'wss://stream.bybit.com/v5/public/' + (this.currentMarketType === 'spot' ? 'spot' : 'linear');
        this.wsKline = this._createWebSocket(wsUrl, 'bybit');
        this.wsTrade = this.wsKline;
    }
    
    this.isConnecting = true;
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
        
        ws.onopen = () => {
            console.log(`✅ ${type.toUpperCase()} WebSocket подключён`);
            
            if (type === 'bybit') {
                const bi = this.getExchangeInterval(this.currentInterval, this.currentExchange);
                const bs = this.formatSymbol(this.currentSymbol, this.currentExchange);
                const subscribeMsg = {
                    op: 'subscribe',
                    args: ['kline.' + bi + '.' + bs, 'publicTrade.' + bs]
                };
                console.log('📡 Bybit подписка:', subscribeMsg);
                ws.send(JSON.stringify(subscribeMsg));
                
                // Пинг для Bybit
                clearInterval(ws._pingInterval);
                ws._pingInterval = setInterval(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        try { ws.send(JSON.stringify({ op: 'ping' })); } catch(e) {}
                    }
                }, 20000);
            }
            
            // Проверяем готовность обоих соединений
            const klineOk = this.wsKline && this.wsKline.readyState === WebSocket.OPEN;
            const tradeOk = this.wsTrade && this.wsTrade.readyState === WebSocket.OPEN;
            
            if (klineOk && tradeOk && !this.isConnected) {
                this.isConnected = true;
                this.isConnecting = false;
                this.retryCount = 0;
                console.log('✅ Оба WebSocket подключены');
                
                if (this.chartManager && this.chartManager.onWebSocketConnected) {
                    this.chartManager.onWebSocketConnected();
                }
            }
        };
        
        ws.onmessage = (event) => {
            this._lastMessageTime = Date.now();
            this._handleMessage(event.data, type);
        };
        
        ws.onclose = (event) => {
            console.log(`🔌 ${type.toUpperCase()} WebSocket закрыт:`, event.code, event.reason);
            this.isConnected = false;
            this.isConnecting = false;
            
            // Нормальное закрытие — не переподключаемся
            if (event.code === 1000) {
                console.log('   Нормальное закрытие');
                return;
            }
            
            // Policy violation — возможно токен только на spot
            if (event.code === 1008) {
                if (this.currentExchange === 'binance' && 
                    this.currentMarketType === 'futures' && 
                    this.binanceSpotOnlyTokens.includes(this.currentSymbol.toUpperCase())) {
                    console.log('🔄 Policy violation — переключаемся на spot для', this.currentSymbol);
                    this.currentMarketType = 'spot';
                    this._scheduleReconnect(500);
                }
                return;
            }
            
            this._scheduleReconnect();
        };
        
        ws.onerror = (error) => {
            console.error(`❌ ${type.toUpperCase()} WebSocket ошибка:`, error);
        };
        
        return ws;
    }

    _handleMessage(rawData, type) {
        try {
            const raw = JSON.parse(rawData);
            
            // Игнорируем pong и subscribe от Bybit
            if (raw.op === 'pong' || raw.op === 'subscribe') return;
            
            // ==================== BINANCE ====================
            if (this.currentExchange === 'binance') {
                
                // KLINE (новый формат 2026)
                if (raw.e === 'kline' && raw.k) {
                    const k = raw.k;
                    const msgSymbol = raw.s ? raw.s.toUpperCase() : null;
                    if (msgSymbol && msgSymbol !== this.currentSymbol.toUpperCase()) {
                        return;
                    }
                    
                    this._lastKlineTime = Math.floor(k.t / 1000);
                    
                    const candle = {
                        time: Math.floor(k.t / 1000),
                        open: parseFloat(k.o),
                        high: parseFloat(k.h),
                        low: parseFloat(k.l),
                        close: parseFloat(k.c),
                        volume: parseFloat(k.v),
                        quoteVolume: parseFloat(k.q || 0),
                        isClosed: k.x === true
                    };
                    
                    this.chartManager.updateLastCandle(candle);
                }
                
                // AGGTRADE (замена @trade)
                if (raw.e === 'aggTrade') {
                    const msgSymbol = raw.s ? raw.s.toUpperCase() : null;
                    if (msgSymbol && msgSymbol !== this.currentSymbol.toUpperCase()) {
                        return;
                    }
                    
                    const price = parseFloat(raw.p);
                    if (!isNaN(price) && price > 0) {
                        this.chartManager._syncPriceLine(price);
                    }
                }
            }
            // ==================== BYBIT ====================
            else if (this.currentExchange === 'bybit' && raw.topic) {
                const parts = raw.topic.split('.');
                let msgSymbol = null;
                
                if (raw.topic.startsWith('kline.') && parts.length >= 3) {
                    msgSymbol = parts[2].toUpperCase();
                } else if (raw.topic.startsWith('publicTrade.') && parts.length >= 2) {
                    msgSymbol = parts[1].toUpperCase();
                }
                
                if (!msgSymbol || msgSymbol !== this.currentSymbol.toUpperCase()) {
                    return;
                }
                
                if (raw.topic.startsWith('kline.')) {
                    if (raw.data && raw.data.length) {
                        const k = raw.data[0];
                        this._lastKlineTime = Math.floor(k.start / 1000);
                        
                        const candle = {
                            time: Math.floor(k.start / 1000),
                            open: parseFloat(k.open),
                            high: parseFloat(k.high),
                            low: parseFloat(k.low),
                            close: parseFloat(k.close),
                            volume: parseFloat(k.volume),
                            quoteVolume: parseFloat(k.turnover || 0),
                            isClosed: k.confirm === true
                        };
                        
                        this.chartManager.updateLastCandle(candle);
                    }
                } else if (raw.topic.startsWith('publicTrade.')) {
                    if (raw.data && raw.data.length) {
                        const price = parseFloat(raw.data[0].p);
                        if (!isNaN(price) && price > 0) {
                            this.chartManager._syncPriceLine(price);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('❌ Ошибка парсинга WebSocket сообщения:', e);
        }
    }

    _scheduleReconnect(delay = null) {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        
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
            
            // Очищаем пинг-интервал (для Bybit)
            if (ws._pingInterval) {
                clearInterval(ws._pingInterval);
                ws._pingInterval = null;
            }
            
            ws.onopen = null;
            ws.onclose = null;
            ws.onerror = null;
            ws.onmessage = null;
            
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                try { ws.close(1000, 'User disconnect'); } catch (e) {}
            }
        };
        
        closeWs(this.wsKline);
        closeWs(this.wsTrade);
        
        this.wsKline = null;
        this.wsTrade = null;
        this.isConnected = false;
    }

    updateSymbolAndTimeframe(symbol, interval, exchange, marketType) {
        console.log('🔄 Обновление символа и таймфрейма:', { symbol, interval, exchange, marketType });
        this.connect(symbol, interval, exchange, marketType);
    }

    closeAll() {
        console.log('🔌 Закрытие WebSocket...');
        if (this.reconnectTimer) { 
            clearTimeout(this.reconnectTimer); 
            this.reconnectTimer = null; 
        }
        if (this._connectDebounceTimer) { 
            clearTimeout(this._connectDebounceTimer); 
            this._connectDebounceTimer = null; 
        }
        this._closeSocket();
    }
    
    ensureConnected() {
        const klineOk = this.wsKline && (this.wsKline.readyState === WebSocket.OPEN || this.wsKline.readyState === WebSocket.CONNECTING);
        const tradeOk = this.wsTrade && (this.wsTrade.readyState === WebSocket.OPEN || this.wsTrade.readyState === WebSocket.CONNECTING);
        
        if (!klineOk || !tradeOk) {
            console.log('⚠️ WebSocket не полностью подключён, переподключаемся...');
            this.connect(this.currentSymbol, this.currentInterval, this.currentExchange, this.currentMarketType);
        }
    }

    forceReconnect() {
        console.log('🔄 Принудительное переподключение WebSocket...');
        this.closeAll();
        setTimeout(() => {
            this.connect(this.currentSymbol, this.currentInterval, this.currentExchange, this.currentMarketType);
        }, 300);
    }

    _onTabVisible() {
        console.log('👁️ Вкладка активна, проверяем WebSocket...');
        
        const now = Date.now();
        if (this._lastMessageTime && (now - this._lastMessageTime > 5000)) {
            console.log('🔄 Нет данных > 5 сек, переподключаемся');
            this.forceReconnect();
        } else {
            this.ensureConnected();
        }
    }

    destroy() {
        console.log('🗑️ Уничтожение WebSocketManager...');
        document.removeEventListener('visibilitychange', this._visibilityHandler);
        
        if (this._statusCheckInterval) {
            clearInterval(this._statusCheckInterval);
            this._statusCheckInterval = null;
        }
        
        this.closeAll();
        console.log('✅ WebSocketManager уничтожен');
    }
}

if (typeof window !== 'undefined') {
    window.WebSocketManager = WebSocketManager;
}
