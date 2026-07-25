class WebSocketManager {
    constructor(chartManager) {
        this.chartManager = chartManager;
        this.worker = null;
        this.reconnectTimer = null;
        this.pingInterval = null;
        this.currentSymbol = 'BTCUSDT';
        this.currentInterval = '1h';
        this.currentExchange = 'binance';
        this.currentMarketType = 'futures';
        this.retryCount = 0;
        this.lastHiddenTime = null;
        this.isConnected = false;
        this.binanceSpotOnlyTokens = ['BTCDOMUSDT', 'DEFIUSDT', 'ALTUSDT', 'NFTUSDT', 'TOPCOINSUSDT'];
        
        this._initWorker();
        
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                if (this.lastHiddenTime && (Date.now() - this.lastHiddenTime > 10000) && this.worker) {
                    this.worker.postMessage({ type: 'get_buffer' });
                }
            } else {
                this.lastHiddenTime = Date.now();
            }
        });
    }

    // ========== СОЗДАНИЕ WORKER ==========
    _initWorker() {
        // Код воркера пишем как обычную строку, без шаблонных литералов
        const workerCode = [
            "var ws = null;",
            "var pingInterval = null;",
            "var bufferedMessages = [];",
            "var MAX_BUFFER = 5000;",
            "var currentUrl = null;",
            "var reconnectAttempts = 0;",
            "var maxReconnectDelay = 30000;",
            "",
            "function scheduleReconnect(delay) {",
            "    setTimeout(function() {",
            "        if (currentUrl) {",
            "            openSocket(currentUrl);",
            "        }",
            "    }, delay);",
            "}",
            "",
            "function openSocket(wsUrl) {",
            "    if (ws) {",
            "        try { ws.onclose = null; ws.close(1000); } catch(e) {}",
            "        ws = null;",
            "    }",
            "",
            "    try {",
            "        ws = new WebSocket(wsUrl);",
            "    } catch(e) {",
            "        self.postMessage({ type: 'error', error: 'Failed: ' + e.message });",
            "        scheduleReconnect(3000);",
            "        return;",
            "    }",
            "",
            "    ws.onopen = function() {",
            "        reconnectAttempts = 0;",
            "        self.postMessage({ type: 'open' });",
            "",
            "        if (wsUrl.indexOf('bybit') !== -1) {",
            "            clearInterval(pingInterval);",
            "            pingInterval = setInterval(function() {",
            "                if (ws && ws.readyState === WebSocket.OPEN) {",
            "                    try { ws.send(JSON.stringify({ op: 'ping' })); } catch(e) {}",
            "                }",
            "            }, 20000);",
            "        }",
            "    };",
            "",
            "    ws.onmessage = function(event) {",
            "        bufferedMessages.push({",
            "            data: event.data,",
            "            timestamp: Date.now()",
            "        });",
            "        if (bufferedMessages.length > MAX_BUFFER) {",
            "            bufferedMessages = bufferedMessages.slice(-MAX_BUFFER / 2);",
            "        }",
            "        self.postMessage({ type: 'message', data: event.data });",
            "    };",
            "",
            "    ws.onclose = function(event) {",
            "        clearInterval(pingInterval);",
            "        ws = null;",
            "",
            "        if (event.code === 1000) {",
            "            self.postMessage({ type: 'close', code: event.code, reason: 'Normal' });",
            "            return;",
            "        }",
            "",
            "        if (event.code === 1008) {",
            "            self.postMessage({ type: 'close', code: event.code, reason: event.reason });",
            "            return;",
            "        }",
            "",
            "        reconnectAttempts++;",
            "        var delay = Math.min(3000 * Math.pow(2, reconnectAttempts - 1), maxReconnectDelay);",
            "        self.postMessage({ type: 'reconnect_scheduled', delay: delay });",
            "        scheduleReconnect(delay);",
            "    };",
            "",
            "    ws.onerror = function(error) {};",
            "}",
            "",
            "self.onmessage = function(event) {",
            "    var msg = event.data;",
            "",
            "    if (msg.type === 'connect') {",
            "        currentUrl = msg.url;",
            "        reconnectAttempts = 0;",
            "        openSocket(currentUrl);",
            "    } else if (msg.type === 'send') {",
            "        if (ws && ws.readyState === WebSocket.OPEN) {",
            "            ws.send(msg.data);",
            "        }",
            "    } else if (msg.type === 'close') {",
            "        currentUrl = null;",
            "        clearInterval(pingInterval);",
            "        if (ws) {",
            "            ws.onclose = null;",
            "            ws.close(1000, 'User disconnect');",
            "            ws = null;",
            "        }",
            "    } else if (msg.type === 'get_buffer') {",
            "        self.postMessage({",
            "            type: 'buffer',",
            "            messages: bufferedMessages.slice()",
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

            if (msg.type === 'open') {
                console.log('✅ Worker WS открыт');
                self.isConnected = true;

                if (self.currentExchange === 'bybit') {
                    const bybitInterval = self.getExchangeInterval(self.currentInterval, self.currentExchange);
                    const bybitSymbol = self.formatSymbol(self.currentSymbol, self.currentExchange);
                    const args = [
                        'kline.' + bybitInterval + '.' + bybitSymbol,
                        'publicTrade.' + bybitSymbol
                    ];
                    self.worker.postMessage({
                        type: 'send',
                        data: JSON.stringify({ op: 'subscribe', args: args })
                    });
                }
            }
            else if (msg.type === 'message') {
                try {
                    const raw = JSON.parse(msg.data);
                    if (raw.op === 'pong') return;

                    if (self.currentExchange === 'binance') {
                        if (raw.stream) {
                            const streamName = raw.stream;
                            const payload = raw.data;
                            if (streamName.includes('@kline')) {
                                self._handleBinanceKline(payload, self.currentSymbol);
                            } else if (streamName.includes('@trade')) {
                                self._handleBinanceTrade(payload, self.currentSymbol);
                            }
                        }
                    }
                    else if (self.currentExchange === 'bybit') {
                        if (raw.topic) {
                            if (raw.topic.startsWith('kline.')) {
                                self._handleBybitKline(raw, self.currentSymbol);
                            } else if (raw.topic.startsWith('publicTrade.')) {
                                self._handleBybitTrade(raw, self.currentSymbol);
                            }
                        }
                    }
                } catch(e) {
                    console.warn('⚠️ Ошибка обработки WS сообщения:', e);
                }
            }
            else if (msg.type === 'close') {
                self.isConnected = false;
                if (msg.code === 1008) {
                    if (self.currentExchange === 'binance' && self.currentMarketType === 'futures') {
                        if (self.binanceSpotOnlyTokens.includes(self.currentSymbol.toUpperCase())) {
                            console.warn('⚠️ 1008: Переключение на SPOT.');
                            self.currentMarketType = 'spot';
                            self.connect(self.currentSymbol, self.currentInterval, self.currentExchange, 'spot');
                        }
                    }
                }
            }
            else if (msg.type === 'reconnect_scheduled') {
                console.log('🔄 WS переподключится через ' + (msg.delay / 1000) + 'с');
            }
            else if (msg.type === 'buffer') {
                const messages = msg.messages || [];
                for (let i = 0; i < messages.length; i++) {
                    try {
                        const raw = JSON.parse(messages[i].data);
                        if (raw.op === 'pong') continue;
                        if (self.currentExchange === 'binance' && raw.stream) {
                            const payload = raw.data;
                            if (raw.stream.includes('@kline')) {
                                self._handleBinanceKline(payload, self.currentSymbol);
                            } else if (raw.stream.includes('@trade')) {
                                self._handleBinanceTrade(payload, self.currentSymbol);
                            }
                        }
                    } catch(e) {}
                }
            }
            else if (msg.type === 'error') {
                console.error('💥 WS error:', msg.error);
            }
        };

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    // ========== ОРИГИНАЛЬНЫЕ МЕТОДЫ ==========
    getExchangeInterval(interval, exchange) {
        if (exchange === 'bybit') {
            const map = {
                '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
                '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
                '1d': 'D', '1D': 'D', '1w': 'W', '1W': 'W', '1M': 'M'
            };
            return map[interval] || interval;
        }
        return interval;
    }

    formatSymbol(symbol, exchange) {
        const cleanSymbol = symbol.trim();
        return exchange === 'bybit' ? cleanSymbol.toUpperCase() : cleanSymbol.toLowerCase();
    }

    connect(symbol, interval, exchange, marketType) {
        if (!symbol) symbol = this.currentSymbol || 'BTCUSDT';
        if (!exchange) exchange = this.currentExchange || 'binance';
        if (!marketType) marketType = this.currentMarketType || 'futures';
        if (!interval) interval = this.currentInterval || '1h';

        symbol = symbol.trim();
        interval = interval.trim().toLowerCase();

        if (exchange === 'binance' && marketType === 'futures' && this.binanceSpotOnlyTokens.includes(symbol.toUpperCase())) {
            console.warn('⚠️ Символ ' + symbol + ' недоступен на фьючерсах Binance. Автопереключение на SPOT.');
            marketType = 'spot';
            this.currentMarketType = 'spot';
        }

        this.currentSymbol = symbol;
        this.currentInterval = interval;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;

        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }

        let wsUrl;
        const formattedSymbol = this.formatSymbol(symbol, exchange);

        if (exchange === 'binance') {
            const baseUrl = marketType === 'spot'
                ? 'wss://data-stream.binance.com/stream'
                : 'wss://fstream.binance.com/stream';
            const streams = formattedSymbol + '@kline_' + interval + '/' + formattedSymbol + '@trade';
            wsUrl = baseUrl + '?streams=' + streams;
        } else if (exchange === 'bybit') {
            const category = (marketType === 'spot') ? 'spot' : (marketType === 'futures' || marketType === 'linear') ? 'linear' : marketType;
            wsUrl = 'wss://stream.bybit.com/v5/public/' + category;
        } else {
            wsUrl = 'wss://' + exchange + '.com/ws';
        }

        console.log('🔌 Подключаюсь к комбинированному WS: ' + wsUrl);
        
        if (!this.worker) {
            this._initWorker();
        }
        
        this.worker.postMessage({ type: 'connect', url: wsUrl });
        this.retryCount = 0;
    }

    _handleBinanceKline(payload, symbol) {
        const k = payload.k;
        if (!k) return;
        const cm = this.chartManager;
        if (!cm || cm.currentSymbol !== symbol) return;

        const candleTime = Math.floor(k.t / 1000);
        const lastCandle = cm.chartData ? cm.chartData[cm.chartData.length - 1] : null;

        if (lastCandle && candleTime > lastCandle.time) {
            const exists = cm.chartData.some(function(c) { return c.time === candleTime; });
            if (!exists) {
                const newCandle = {
                    time: candleTime,
                    open: parseFloat(k.o),
                    high: parseFloat(k.h),
                    low: parseFloat(k.l),
                    close: parseFloat(k.c),
                    volume: parseFloat(k.v)
                };
                cm.chartData.push(newCandle);
                cm.lastCandle = newCandle;

                const series = cm.currentChartType === 'candle' ? cm.candleSeries : cm.barSeries;
                if (series) series.setData(cm.chartData);

                if (cm.volumeSeries) {
                    const volData = cm.chartData.map(function(c) {
                        return {
                            time: c.time,
                            value: c.volume || 0,
                            color: c.close >= c.open ? cm.bullishColor : cm.bearishColor
                        };
                    });
                    cm.volumeSeries.setData(volData);
                }

                if (cm.timerManager) cm.timerManager.start(this.currentInterval);
            }
        }

        const candle = {
            time: candleTime,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v)
        };
        cm.updateLastCandle(candle);
    }

    _handleBinanceTrade(payload, symbol) {
        const price = parseFloat(payload.p);
        if (isNaN(price)) return;
        const cm = this.chartManager;
        if (cm && cm.currentSymbol === symbol && cm._syncPriceLine) {
            cm._syncPriceLine(price);
        }
    }

    _handleBybitKline(data, symbol) {
        if (!data.data || !data.data.length) return;
        const k = data.data[0];
        const candle = {
            time: Math.floor(k.start / 1000),
            open: parseFloat(k.open),
            high: parseFloat(k.high),
            low: parseFloat(k.low),
            close: parseFloat(k.close),
            volume: parseFloat(k.volume)
        };
        const cm = this.chartManager;
        if (cm && cm.currentSymbol === symbol) {
            cm.updateLastCandle(candle);
        }
    }

    _handleBybitTrade(data, symbol) {
        if (!data.data || !data.data.length) return;
        const price = parseFloat(data.data[0].p);
        if (isNaN(price)) return;
        const cm = this.chartManager;
        if (cm && cm.currentSymbol === symbol && cm._syncPriceLine) {
            cm._syncPriceLine(price);
        }
    }

    updateSymbolAndTimeframe(symbol, interval, exchange, marketType) {
        this.connect(symbol, interval, exchange, marketType);
    }

    closeAll() {
        if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        if (this.worker) {
            this.worker.postMessage({ type: 'close' });
        }
    }
    
    ensureConnected() {
        if (this.worker) {
            this.worker.postMessage({ type: 'ping' });
        }
    }
}

if (typeof window !== 'undefined') window.WebSocketManager = WebSocketManager;
