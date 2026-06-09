class WebSocketManager {
    constructor(chartManager) {
        this.chartManager = chartManager;
        this.wsKline = null;
        this.wsTrade = null;
        this.klineReconnectTimer = null;
        this.tradeReconnectTimer = null;
        this.currentSymbol = 'BTCUSDT';
        this.currentInterval = '1h';
        this.currentExchange = 'binance';
        this.currentMarketType = 'futures';
    }

    connectKline(symbol, interval, exchange, marketType) {
        if (!symbol) { symbol = this.currentSymbol || 'BTCUSDT'; }
        if (!exchange) { exchange = this.currentExchange || 'binance'; }
        if (!marketType) { marketType = this.currentMarketType || 'futures'; }
        if (!interval) { interval = this.currentInterval || '1h'; }

        this.currentSymbol = symbol;
        this.currentInterval = interval;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;

        if (this.klineReconnectTimer) { clearTimeout(this.klineReconnectTimer); this.klineReconnectTimer = null; }
        if (this.wsKline) {
            this.wsKline.onclose = null;
            this.wsKline.onerror = null;
            this.wsKline.onmessage = null;
            if (this.wsKline.readyState === WebSocket.OPEN || this.wsKline.readyState === WebSocket.CONNECTING) {
                this.wsKline.close();
            }
            this.wsKline = null;
        }

        let wsUrl;
        if (exchange === 'bybit') {
           let category = (marketType === 'spot') ? 'spot' : (marketType === 'futures' || marketType === 'linear') ? 'linear' : marketType;
wsUrl = `wss://stream.bybit.com/v5/public/${category}`;
        } else {
            if (marketType === 'spot') {
                wsUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`;
            } else {
                wsUrl = `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${interval}`;
            }
        }

        const ws = new WebSocket(wsUrl);
        const self = this;

        ws.onopen = () => {
            console.log('✅ Kline WS открыт:', exchange, interval);
            self.wsKline = ws;
            if (exchange === 'bybit') {
                ws.send(JSON.stringify({ op: 'subscribe', args: [`kline.${interval}.${symbol}`] }));
            }
        };

        ws.onmessage = (event) => {
            try {
                if (symbol !== self.currentSymbol) return;
                const data = JSON.parse(event.data);
                let candle = null;

                if (exchange === 'bybit') {
                    if (data.topic?.startsWith('kline.') && data.data?.length) {
                        const k = data.data[0];
                        candle = {
                            time: Math.floor(k.start / 1000),
                            open: parseFloat(k.open),
                            high: parseFloat(k.high),
                            low: parseFloat(k.low),
                            close: parseFloat(k.close),
                            volume: parseFloat(k.volume)
                        };
                    }
                } else {
                  const k = data.k;
if (k) {
    const cm = self.chartManager;
    const candleTime = Math.floor(k.t / 1000);
    const lastCandle = cm?.chartData?.[cm.chartData.length - 1];
    
    // Создаём новую свечу если её время больше последней
    if (cm && lastCandle && candleTime > lastCandle.time) {
        const exists = cm.chartData.some(c => c.time === candleTime);
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
                const volData = cm.chartData.map(c => ({
                    time: c.time,
                    value: c.volume || 0,
                    color: c.close >= c.open ? cm.bullishColor : cm.bearishColor
                }));
                cm.volumeSeries.setData(volData);
            }
            
            if (cm.timerManager) cm.timerManager.start(interval);
            console.log('🕯️ Новая свеча:', new Date(candleTime * 1000));
        }
    }
    
    candle = {
        time: candleTime,
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v)
    };
}
                }

                if (candle && self.chartManager && self.chartManager.currentSymbol === symbol) {
                    self.chartManager.updateLastCandle(candle);
                }
            } catch(e) {}
        };

        ws.onclose = () => {
            console.log('❌ Kline WS закрыт, переподключение...');
            if (self.currentSymbol === symbol) {
                self.klineReconnectTimer = setTimeout(() => {
                    self.connectKline(symbol, interval, exchange, marketType);
                }, 3000);
            }
        };

        ws.onerror = () => {};
    }

    connectTrade(symbol, exchange, marketType) {
        if (!symbol) { symbol = this.currentSymbol || 'BTCUSDT'; }
        if (!exchange) { exchange = this.currentExchange || 'binance'; }
        if (!marketType) { marketType = this.currentMarketType || 'futures'; }

        if (this.tradeReconnectTimer) { clearTimeout(this.tradeReconnectTimer); this.tradeReconnectTimer = null; }
        if (this.wsTrade) {
            this.wsTrade.onclose = null;
            this.wsTrade.onerror = null;
            this.wsTrade.onmessage = null;
            if (this.wsTrade.readyState === WebSocket.OPEN || this.wsTrade.readyState === WebSocket.CONNECTING) {
                this.wsTrade.close();
            }
            this.wsTrade = null;
        }

        let wsUrl;
        if (exchange === 'bybit') {
         let category = (marketType === 'spot') ? 'spot' : (marketType === 'futures' || marketType === 'linear') ? 'linear' : marketType;
wsUrl = `wss://stream.bybit.com/v5/public/${category}`;
        } else {
            if (marketType === 'spot') {
                wsUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@trade`;
            } else {
                wsUrl = `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@trade`;
            }
        }

        const ws = new WebSocket(wsUrl);
        const self = this;

        ws.onopen = () => {
            console.log('✅ Trade WS открыт:', exchange);
            self.wsTrade = ws;
            if (exchange === 'bybit') {
                ws.send(JSON.stringify({ op: 'subscribe', args: [`publicTrade.${symbol}`] }));
            }
        };

        ws.onmessage = (event) => {
            try {
                if (symbol !== self.currentSymbol) return;
                const data = JSON.parse(event.data);
                let price = null;

                if (exchange === 'bybit') {
                    if (data.topic?.startsWith('publicTrade.') && data.data?.length) {
                        price = parseFloat(data.data[0].p);
                    }
                } else {
                    price = parseFloat(data.p);
                }

                if (price && self.chartManager && self.chartManager.currentSymbol === symbol) {
                    if (self.chartManager._syncPriceLine) {
                        self.chartManager._syncPriceLine(price);
                    }
                }
            } catch(e) {}
        };

        ws.onclose = () => {
            console.log('❌ Trade WS закрыт, переподключение...');
            if (self.currentSymbol === symbol) {
                self.tradeReconnectTimer = setTimeout(() => {
                    self.connectTrade(symbol, exchange, marketType);
                }, 3000);
            }
        };

        ws.onerror = () => {};
    }

    updateSymbolAndTimeframe(symbol, interval, exchange, marketType) {
        this.connectKline(symbol, interval, exchange, marketType);
        this.connectTrade(symbol, exchange, marketType);
    }

    closeAll() {
        if (this.wsKline) { try { this.wsKline.close(); } catch(e) {} this.wsKline = null; }
        if (this.wsTrade) { try { this.wsTrade.close(); } catch(e) {} this.wsTrade = null; }
        if (this.klineReconnectTimer) { clearTimeout(this.klineReconnectTimer); this.klineReconnectTimer = null; }
        if (this.tradeReconnectTimer) { clearTimeout(this.tradeReconnectTimer); this.tradeReconnectTimer = null; }
    }
}

if (typeof window !== 'undefined') window.WebSocketManager = WebSocketManager;
