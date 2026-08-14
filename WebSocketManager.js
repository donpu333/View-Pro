class WebSocketManager {
    constructor(chartManager) {
        this.chartManager = chartManager;
        this.worker = null;
        this.reconnectTimer = null;
        this.retryCount = 0;
        this.isConnected = false;
        
        // ✅ Отслеживание свежести данных
        this._lastKlineTime = 0;
        this._lastMessageTime = 0;
        this._statusCheckTimeout = null;
        this._connectDebounceTimer = null;
        
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
        
        this._initWorker();
    }

    _initWorker() {
        const workerCode = [
            "var ws = null;",
            "var pingInterval = null;",
            "var currentUrl = null;",
            "var reconnectAttempts = 0;",
            "var maxReconnectDelay = 10000;",
            "",
            "function scheduleReconnect(d) {",
            "    setTimeout(function() {",
            "        if (currentUrl) createSocket(currentUrl);",
            "    }, d);",
            "}",
            "",
            "function createSocket(url) {",
            "    if (ws) {",
            "        var oldWs = ws;",
            "        ws = null;",
            "        oldWs.onopen = null;",
            "        oldWs.onclose = null;",
            "        oldWs.onerror = null;",
            "        oldWs.onmessage = null;",
            "        if (oldWs.readyState === WebSocket.OPEN) {",
            "            try { oldWs.close(1000, 'Switching'); } catch(e) {}",
            "        }",
            "    }",
            "",
            "    try {",
            "        ws = new WebSocket(url);",
            "    } catch(e) {",
            "        ws = null;",
            "        self.postMessage({ type: 'error', error: 'Failed: ' + e.message });",
            "        scheduleReconnect(3000);",
            "        return;",
            "    }",
            "",
            "    ws.onopen = function() {",
            "        reconnectAttempts = 0;",
            "        self.postMessage({ type: 'open' });",
            "",
            "        if (url.indexOf('bybit') !== -1) {",
            "            clearInterval(pingInterval);",
            "            pingInterval = setInterval(function() {",
            "                if (ws && ws.readyState === WebSocket.OPEN) {",
            "                    try { ws.send(JSON.stringify({ op: 'ping' })); } catch(e) {}",
            "                }",
            "            }, 20000);",
            "        }",
            "    };",
            "",
            "    ws.onmessage = function(e) {",
            "        if (ws === null) return;",
            "        self.postMessage({ type: 'message', data: e.data });",
            "    };",
            "",
            "    ws.onclose = function(e) {",
            "        clearInterval(pingInterval);",
            "        if (ws === null) return;",
            "        var target = ws;",
            "        ws = null;",
            "",
            "        if (e.code === 1000 || e.code === 1008) {",
            "            self.postMessage({ type: 'close', code: e.code, reason: e.reason || 'Normal' });",
            "            return;",
            "        }",
            "",
            "        reconnectAttempts++;",
            "        var d = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), maxReconnectDelay);",
            "        scheduleReconnect(d);",
            "    };",
            "",
            "    ws.onerror = function(e) {",
            "        if (ws === null) return;",
            "    };",
            "}",
            "",
            "self.onmessage = function(e) {",
            "    var m = e.data;",
            "",
            "    if (m.type === 'connect') {",
            "        currentUrl = m.url;",
            "        reconnectAttempts = 0;",
            "        createSocket(currentUrl);",
            "    } else if (m.type === 'send') {",
            "        if (ws && ws.readyState === WebSocket.OPEN) {",
            "            try { ws.send(m.data); } catch(e) {}",
            "        }",
            "    } else if (m.type === 'close') {",
            "        currentUrl = null;",
            "        clearInterval(pingInterval);",
            "        if (ws) {",
            "            ws.onopen = null;",
            "            ws.onclose = null;",
            "            ws.onerror = null;",
            "            ws.onmessage = null;",
            "            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {",
            "                try { ws.close(1000, 'User disconnect'); } catch(e) {}",
            "            }",
            "            ws = null;",
            "        }",
            "    } else if (m.type === 'ping') {",
            "        if (ws && ws.readyState === WebSocket.OPEN) {",
            "            self.postMessage({ type: 'pong' });",
            "        } else {",
            "            self.postMessage({ type: 'status', connected: false });",
            "        }",
            "    } else if (m.type === 'status') {",
            "        self.postMessage({",
            "            type: 'status',",
            "            connected: ws !== null && ws.readyState === WebSocket.OPEN,",
            "            url: currentUrl",
            "        });",
            "    }",
            "};"
        ].join('\n');

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        this.worker = new Worker(workerUrl);
        URL.revokeObjectURL(workerUrl);
        
        const self = this;
        
        this.worker.onmessage = function(event) {
            const msg = event.data;
            self._lastMessageTime = Date.now();
            
            if (msg.type === 'open') {
                self.isConnected = true;
                if (self.currentExchange === 'bybit') {
                    const bi = self.getExchangeInterval(self.currentInterval, self.currentExchange);
                    const bs = self.formatSymbol(self.currentSymbol, self.currentExchange);
                    self.worker.postMessage({
                        type: 'send',
                        data: JSON.stringify({ op: 'subscribe', args: ['kline.' + bi + '.' + bs, 'publicTrade.' + bs] })
                    });
                }
            }
            else if (msg.type === 'pong' || msg.type === 'status') {
                if (self._statusCheckTimeout) {
                    clearTimeout(self._statusCheckTimeout);
                    self._statusCheckTimeout = null;
                }
                if (msg.type === 'status') {
                    self.isConnected = msg.connected;
                    if (!msg.connected && !document.hidden) {
                        // Worker говорит, что не подключён — переподключаемся
                        self.connect(self.currentSymbol, self.currentInterval, 
                                    self.currentExchange, self.currentMarketType);
                    }
                }
            }
            else if (msg.type === 'message') {
                try {
                    const raw = JSON.parse(msg.data);
                    if (raw.op === 'pong') return;
                    
                    if (self.currentExchange === 'binance' && raw.stream) {
                        const msgSymbol = (raw.data && raw.data.s) ? raw.data.s.toUpperCase() : null;
                        if (!msgSymbol || msgSymbol !== self.currentSymbol.toUpperCase()) return;
                        
                        if (raw.stream.includes('@kline')) {
                            const k = raw.data.k;
                            if (k) {
                                self._lastKlineTime = Math.floor(k.t / 1000);
                                self.chartManager.updateLastCandle({
                                    time: Math.floor(k.t / 1000), open: parseFloat(k.o),
                                    high: parseFloat(k.h), low: parseFloat(k.l),
                                    close: parseFloat(k.c), volume: parseFloat(k.v)
                                });
                            }
                        } else if (raw.stream.includes('@trade')) {
                            const price = parseFloat(raw.data.p);
                            if (!isNaN(price) && self.chartManager._syncPriceLine) {
                                self.chartManager._syncPriceLine(price);
                            }
                        }
                    }
                    else if (self.currentExchange === 'bybit' && raw.topic) {
                        const parts = raw.topic.split('.');
                        let msgSymbol = null;
                        if (raw.topic.startsWith('kline.') && parts.length >= 3) {
                            msgSymbol = parts[2].toUpperCase();
                        } else if (raw.topic.startsWith('publicTrade.') && parts.length >= 2) {
                            msgSymbol = parts[1].toUpperCase();
                        }
                        if (!msgSymbol || msgSymbol !== self.currentSymbol.toUpperCase()) return;
                        
                        if (raw.topic.startsWith('kline.')) {
                            if (raw.data && raw.data.length) {
                                const k = raw.data[0];
                                self._lastKlineTime = Math.floor(k.start / 1000);
                                self.chartManager.updateLastCandle({
                                    time: Math.floor(k.start / 1000), open: parseFloat(k.open),
                                    high: parseFloat(k.high), low: parseFloat(k.low),
                                    close: parseFloat(k.close), volume: parseFloat(k.volume)
                                });
                            }
                        } else if (raw.topic.startsWith('publicTrade.')) {
                            if (raw.data && raw.data.length) {
                                const price = parseFloat(raw.data[0].p);
                                if (!isNaN(price) && self.chartManager._syncPriceLine) {
                                    self.chartManager._syncPriceLine(price);
                                }
                            }
                        }
                    }
                } catch(e) {}
            }
            else if (msg.type === 'close') {
                self.isConnected = false;
                if (msg.code === 1000) return;
                if (msg.code === 1008) {
                    if (self.currentExchange === 'binance' && self.currentMarketType === 'futures' && self.binanceSpotOnlyTokens.includes(self.currentSymbol.toUpperCase())) {
                        self.currentMarketType = 'spot';
                        self.connect(self.currentSymbol, self.currentInterval, self.currentExchange, 'spot');
                    }
                    return;
                }
                self.retryCount++;
                const delay = Math.min(5000 * Math.pow(1.5, self.retryCount - 1), 60000);
                self.reconnectTimer = setTimeout(function() {
                    self.connect(self.currentSymbol, self.currentInterval, self.currentExchange, self.currentMarketType);
                }, delay);
            }
        };
    }

    getExchangeInterval(interval, exchange) {
        if (exchange === 'bybit') {
            const map = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720', '1d': 'D', '1w': 'W', '1M': 'M' };
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
        
        if (exchange === 'binance' && marketType === 'futures' && this.binanceSpotOnlyTokens.includes(symbol.toUpperCase())) {
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
        
        const fs = this.formatSymbol(symbol, exchange);
        let wsUrl;
        if (exchange === 'binance') {
            wsUrl = (marketType === 'spot' ? 'wss://data-stream.binance.com/stream' : 'wss://fstream.binance.com/stream') +
                    '?streams=' + fs + '@kline_' + interval + '/' + fs + '@trade';
        } else {
            wsUrl = 'wss://stream.bybit.com/v5/public/' + (marketType === 'spot' ? 'spot' : 'linear');
        }
        
        if (!this.worker) this._initWorker();
        
        this._connectDebounceTimer = setTimeout(() => {
            this.worker.postMessage({ type: 'connect', url: wsUrl });
        }, 100);
    }

    updateSymbolAndTimeframe(symbol, interval, exchange, marketType) {
        this.connect(symbol, interval, exchange, marketType);
    }

    closeAll() {
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        if (this._connectDebounceTimer) { clearTimeout(this._connectDebounceTimer); this._connectDebounceTimer = null; }
        if (this.worker) this.worker.postMessage({ type: 'close' });
    }
    
    ensureConnected() {
        if (!this.worker) {
            this._initWorker();
            this.connect(this.currentSymbol, this.currentInterval, 
                        this.currentExchange, this.currentMarketType);
            return;
        }
        
        // ✅ Запрашиваем реальный статус у worker'а
        this.worker.postMessage({ type: 'status' });
        
        // Если worker не ответил за 2 секунды — переподключаемся
        if (this._statusCheckTimeout) clearTimeout(this._statusCheckTimeout);
        this._statusCheckTimeout = setTimeout(() => {
            if (Date.now() - this._lastMessageTime > 5000) {
                console.log('⚠️ Worker не отвечает, переподключаемся');
                this.connect(this.currentSymbol, this.currentInterval, 
                            this.currentExchange, this.currentMarketType);
            }
        }, 2000);
    }

    // ✅ Вызывается при возврате на вкладку
    _onTabVisible() {
        const now = Date.now();
        
        // 1. Проверяем, жив ли worker и соединение
        this.ensureConnected();
        
        // 2. Если нет сообщений больше 5 секунд — переподключаемся принудительно
        if (this._lastMessageTime && (now - this._lastMessageTime > 5000)) {
            console.log('🔄 Нет данных > 5 сек, переподключаемся');
            this.connect(this.currentSymbol, this.currentInterval, 
                        this.currentExchange, this.currentMarketType);
        }
        
        // 3. Догружаем пропущенные свечи через REST
        if (this.chartManager._catchUpMissedCandles) {
            this.chartManager._catchUpMissedCandles();
        }
    }

    // ✅ Очистка при уничтожении
    destroy() {
        document.removeEventListener('visibilitychange', this._visibilityHandler);
        if (this._statusCheckTimeout) clearTimeout(this._statusCheckTimeout);
        if (this._connectDebounceTimer) clearTimeout(this._connectDebounceTimer);
        this.closeAll();
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}

if (typeof window !== 'undefined') window.WebSocketManager = WebSocketManager;           
