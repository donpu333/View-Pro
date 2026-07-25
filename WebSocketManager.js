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

    // ========== СОЗДАНИЕ WORKER (только WebSocket, без логики) ==========
    _initWorker() {
       const workerCode = `
    var ws = null;
    var pendingUrl = null;
    var bufferedMessages = [];
    var MAX_BUFFER = 5000;

    function openSocket(wsUrl) {
        try {
            ws = new WebSocket(wsUrl);

            ws.onopen = function() {
                self.postMessage({ type: 'open' });
            };

            ws.onmessage = function(event) {
                bufferedMessages.push({
                    data: event.data,
                    timestamp: Date.now()
                });
                if (bufferedMessages.length > MAX_BUFFER) {
                    bufferedMessages = bufferedMessages.slice(-MAX_BUFFER / 2);
                }
                self.postMessage({ type: 'message', data: event.data });
            };

            ws.onclose = function(event) {
                // Если есть ожидающий URL – открываем новый сокет
                if (pendingUrl) {
                    var url = pendingUrl;
                    pendingUrl = null;
                    openSocket(url);
                } else {
                    // Иначе сообщаем основному потоку о закрытии
                    self.postMessage({ type: 'close', code: event.code, reason: event.reason });
                }
            };

            ws.onerror = function(error) {
                self.postMessage({ type: 'error', error: error.type || 'Unknown' });
            };
        } catch(e) {
            self.postMessage({ type: 'error', error: 'Failed: ' + e.message });
        }
    }

    function connect(wsUrl) {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            // Сохраняем URL и инициируем закрытие – новый сокет откроется в onclose
            pendingUrl = wsUrl;
            ws.close(1000, 'Reconnecting');
        } else {
            // Нет активного сокета – открываем сразу
            openSocket(wsUrl);
        }
    }

    self.onmessage = function(event) {
        var msg = event.data;
        
        if (msg.type === 'connect') {
            connect(msg.url);
        } else if (msg.type === 'send') {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(msg.data);
            }
        } else if (msg.type === 'close') {
            pendingUrl = null;  // отменяем ожидание
            if (ws) {
                ws.onclose = null;
                ws.close(1000, 'User disconnect');
                ws = null;
            }
        } else if (msg.type === 'get_buffer') {
            self.postMessage({
                type: 'buffer',
                messages: bufferedMessages.slice()
            });
        }
    };
`;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        this.worker = new Worker(workerUrl);
        URL.revokeObjectURL(workerUrl);
        
        const self = this;
        
        this.worker.onmessage = function(event) {
            const msg = event.data;
            
            if (msg.type === 'open') {
                console.log('✅ Worker WS открыт');
                // Ваш оригинальный код ws.onopen
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

                    self.pingInterval = setInterval(function() {
                        self.worker.postMessage({
                            type: 'send',
                            data: JSON.stringify({ op: 'ping' })
                        });
                    }, 20000);
                }
            }
            else if (msg.type === 'message') {
                // Ваш оригинальный код ws.onmessage
                try {
                    if (self.currentSymbol !== self.currentSymbol) return;
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
                if (self.pingInterval) { clearInterval(self.pingInterval); self.pingInterval = null; }

                if (msg.code === 1000) return;

                if (msg.code === 1008) {
                    if (self.currentExchange === 'binance' && self.currentMarketType === 'futures') {
                        if (self.binanceSpotOnlyTokens.includes(self.currentSymbol.toUpperCase())) {
                            console.warn('⚠️ 1008: Переключение на SPOT.');
                            self.currentMarketType = 'spot';
                            self.connect(self.currentSymbol, self.currentInterval, self.currentExchange, 'spot');
                            return;
                        }
                    }
                    console.error('🚫 WS 1008: Символ не найден');
                    return;
                }

                self.retryCount++;
                const delay = Math.min(3000 * Math.pow(2, self.retryCount - 1), 30000);
                console.warn('❌ WS ОБРЫВ. Переподключение через ' + (delay/1000) + 'с...');
                self.reconnectTimer = setTimeout(function() {
                    self.connect(self.currentSymbol, self.currentInterval, self.currentExchange, self.currentMarketType);
                }, delay);
            }
            else if (msg.type === 'buffer') {
                // Применяем буферизированные сообщения
                const messages = msg.messages || [];
                for (var i = 0; i < messages.length; i++) {
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
        };
    }

    // ========== ВСЕ ОСТАЛЬНЫЕ МЕТОДЫ ОСТАВЛЯЕМ КАК БЫЛИ ==========
    
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

    // Ваши оригинальные обработчики (БЕЗ ИЗМЕНЕНИЙ)
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
