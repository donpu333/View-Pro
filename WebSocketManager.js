class WebSocketManager {
    constructor(chartManager) {
        this.chartManager = chartManager;
        this.worker = null;
        this.lastHiddenTime = null;
        this.isConnected = false;
        
        this.currentSymbol = 'BTCUSDT';
        this.currentInterval = '1h';
        this.currentExchange = 'binance';
        this.currentMarketType = 'futures';
        
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

    _initWorker() {
        const workerCode = `
            let ws = null;
            let pingInterval = null;
            let bufferedMessages = [];
            const MAX_BUFFER = 5000;
            let currentUrl = null;
            let reconnectAttempts = 0;
            const maxReconnectDelay = 30000;

            function scheduleReconnect(delay) {
                setTimeout(() => {
                    if (currentUrl) openSocket(currentUrl);
                }, delay);
            }

            function openSocket(wsUrl) {
                if (ws) {
                    try { ws.onclose = null; ws.close(1000); } catch(e) {}
                    ws = null;
                }

                try {
                    ws = new WebSocket(wsUrl);
                } catch(e) {
                    self.postMessage({ type: 'error', error: 'Failed: ' + e.message });
                    scheduleReconnect(3000);
                    return;
                }

                ws.onopen = () => {
                    reconnectAttempts = 0;
                    self.postMessage({ type: 'open' });

                    if (wsUrl.includes('bybit')) {
                        clearInterval(pingInterval);
                        pingInterval = setInterval(() => {
                            if (ws && ws.readyState === WebSocket.OPEN) {
                                try { ws.send(JSON.stringify({ op: 'ping' })); } catch(e) {}
                            }
                        }, 20000);
                    }
                };

                ws.onmessage = (event) => {
                    bufferedMessages.push({ data: event.data, timestamp: Date.now() });
                    if (bufferedMessages.length > MAX_BUFFER) {
                        bufferedMessages = bufferedMessages.slice(-MAX_BUFFER / 2);
                    }
                    self.postMessage({ type: 'message', data: event.data });
                };

                ws.onclose = (event) => {
                    clearInterval(pingInterval);
                    ws = null;

                    if (event.code === 1000 || event.code === 1008) {
                        self.postMessage({ type: 'close', code: event.code, reason: event.reason || 'Normal' });
                        return;
                    }

                    reconnectAttempts++;
                    const delay = Math.min(3000 * Math.pow(2, reconnectAttempts - 1), maxReconnectDelay);
                    self.postMessage({ type: 'reconnect_scheduled', delay: delay });
                    scheduleReconnect(delay);
                };

                ws.onerror = () => {};
            }

            self.onmessage = (event) => {
                const msg = event.data;

                if (msg.type === 'connect') {
                    bufferedMessages = []; 
                    currentUrl = msg.url;
                    reconnectAttempts = 0;
                    openSocket(currentUrl);
                } else if (msg.type === 'send') {
                    if (ws && ws.readyState === WebSocket.OPEN) ws.send(msg.data);
                } else if (msg.type === 'close') {
                    currentUrl = null;
                    clearInterval(pingInterval);
                    if (ws) {
                        ws.onclose = null;
                        ws.close(1000, 'User disconnect');
                        ws = null;
                    }
                } else if (msg.type === 'get_buffer') {
                    self.postMessage({ type: 'buffer', messages: bufferedMessages.slice() });
                }
            };
        `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        this.worker = new Worker(workerUrl);
        URL.revokeObjectURL(workerUrl);

        this._bindWorkerEvents();
    }

    _bindWorkerEvents() {
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
                self._processRawMessage(msg.data);
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
                    self._processRawMessage(messages[i].data);
                }
            }
            else if (msg.type === 'error') {
                console.error('💥 WS error:', msg.error);
            }
        };
    }

    _processRawMessage(rawDataStr) {
        try {
            const raw = JSON.parse(rawDataStr);
            if (raw.op === 'pong') return;

            if (this.currentExchange === 'binance' && raw.stream) {
                const payload = raw.data;
                if (raw.stream.includes('@kline')) {
                    this._handleBinanceKline(payload, this.currentSymbol);
                } else if (raw.stream.includes('@trade')) {
                    this._handleBinanceTrade(payload, this.currentSymbol);
                }
            }
            else if (this.currentExchange === 'bybit' && raw.topic) {
                if (raw.topic.startsWith('kline.')) {
                    this._handleBybitKline(raw, this.currentSymbol);
                } else if (raw.topic.startsWith('publicTrade.')) {
                    this._handleBybitTrade(raw, this.currentSymbol);
                }
            }
        } catch(e) {}
    }

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
        return exchange === 'bybit' ? symbol.trim().toUpperCase() : symbol.trim().toLowerCase();
    }

    connect(symbol, interval, exchange, marketType) {
        symbol = symbol || this.currentSymbol || 'BTCUSDT';
        exchange = exchange || this.currentExchange || 'binance';
        marketType = marketType || this.currentMarketType || 'futures';
        interval = (interval || this.currentInterval || '1h').trim().toLowerCase();

        if (exchange === 'binance' && marketType === 'futures' && this.binanceSpotOnlyTokens.includes(symbol.toUpperCase())) {
            console.warn('⚠️ Символ ' + symbol + ' недоступен на фьючерсах Binance. Автопереключение на SPOT.');
            marketType = 'spot';
        }

        this.currentSymbol = symbol;
        this.currentInterval = interval;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;

        const formattedSymbol = this.formatSymbol(symbol, exchange);
        let wsUrl;

        if (exchange === 'binance') {
            const baseUrl = marketType === 'spot'
                ? 'wss://data-stream.binance.com/stream'
                : 'wss://fstream.binance.com/stream';
            const streams = `${formattedSymbol}@kline_${interval}/${formattedSymbol}@trade`;
            wsUrl = `${baseUrl}?streams=${streams}`;
        } else if (exchange === 'bybit') {
            const category = marketType === 'spot' ? 'spot' : 'linear';
            wsUrl = `wss://stream.bybit.com/v5/public/${category}`;
        }

        console.log('🔌 Подключаюсь к WS: ' + wsUrl);
        
        if (!this.worker) this._initWorker();
        
        this.worker.postMessage({ type: 'connect', url: wsUrl });
    }

    _handleBinanceKline(payload, symbol) {
        const k = payload.k;
        if (!k) return;
        
        const cm = this.chartManager;
        if (!cm || cm.currentSymbol !== symbol || !cm.chartData) return;

        const candleTime = Math.floor(k.t / 1000);
        const lastCandle = cm.chartData[cm.chartData.length - 1];
        const candle = {
            time: candleTime,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v)
        };

        if (lastCandle && candleTime > lastCandle.time) {
            const exists = cm.chartData.some(c => c.time === candleTime);
            if (!exists) {
                cm.chartData.push(candle);
                cm.lastCandle = candle;

                const series = cm.currentChartType === 'candle' ? cm.candleSeries : cm.barSeries;
                if (series) series.setData(cm.chartData);

                if (cm.volumeSeries) {
                    cm.volumeSeries.update({
                        time: candle.time,
                        value: candle.volume || 0,
                        color: candle.close >= candle.open ? cm.bullishColor : cm.bearishColor
                    });
                }

                if (cm.timerManager) cm.timerManager.start(this.currentInterval);
            }
        }

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
        
        const cm = this.chartManager;
        if (!cm || cm.currentSymbol !== symbol || !cm.chartData) return;

        const candle = {
            time: Math.floor(k.start / 1000),
            open: parseFloat(k.open),
            high: parseFloat(k.high),
            low: parseFloat(k.low),
            close: parseFloat(k.close),
            volume: parseFloat(k.volume)
        };

        const lastCandle = cm.chartData[cm.chartData.length - 1];

        if (lastCandle && candle.time > lastCandle.time) {
            const exists = cm.chartData.some(c => c.time === candle.time);
            if (!exists) {
                cm.chartData.push(candle);
                cm.lastCandle = candle;

                const series = cm.currentChartType === 'candle' ? cm.candleSeries : cm.barSeries;
                if (series) series.setData(cm.chartData);

                if (cm.volumeSeries) {
                    cm.volumeSeries.update({
                        time: candle.time,
                        value: candle.volume || 0,
                        color: candle.close >= candle.open ? cm.bullishColor : cm.bearishColor
                    });
                }

                if (cm.timerManager) cm.timerManager.start(this.currentInterval);
            }
        }

        cm.updateLastCandle(candle);
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
