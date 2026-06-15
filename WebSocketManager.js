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
        this._destroyed = false;
        this._klineConnecting = false;
        this._tradeConnecting = false;
        this._klineReconnectAttempts = 0;
        this._tradeReconnectAttempts = 0;
        this._maxReconnectDelay = 30000;
    }

    connectKline(symbol, interval, exchange, marketType) {
        if (this._destroyed) return;

        symbol = symbol || this.currentSymbol || 'BTCUSDT';
        exchange = exchange || this.currentExchange || 'binance';
        marketType = marketType || this.currentMarketType || 'futures';
        interval = interval || this.currentInterval || '1h';

        this.currentSymbol = symbol;
        this.currentInterval = interval;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;

        this._cleanupKline();

        if (this._klineConnecting) {
            console.warn('⚠️ Kline WS уже подключается');
            return;
        }
        this._klineConnecting = true;

        let wsUrl;
        if (exchange === 'bybit') {
            const category = (marketType === 'spot') ? 'spot' : 'linear';
            wsUrl = `wss://stream.bybit.com/v5/public/${category}`;
        } else {
            const baseUrl = marketType === 'spot' 
                ? 'wss://data-stream.binance.com/ws' 
                : 'wss://fstream.binance.com/ws';
            wsUrl = `${baseUrl}/${symbol.toLowerCase()}@kline_${interval}`;
        }

        const ws = new WebSocket(wsUrl);
        this.wsKline = ws;

        ws.onopen = () => {
            if (this._destroyed) { ws.close(); return; }
            this._klineConnecting = false;
            this._klineReconnectAttempts = 0;
            if (exchange === 'bybit') {
                ws.send(JSON.stringify({ op: 'subscribe', args: [`kline.${interval}.${symbol}`] }));
            }
        };

        ws.onmessage = (event) => {
            if (this._destroyed) return;
            try {
                if (this.currentSymbol !== symbol || this.currentInterval !== interval) return;

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
                            volume: parseFloat(k.volume),
                            isClosed: k.confirm || false
                        };
                    }
                } else {
                    const k = data.k;
                    if (k) {
                        candle = {
                            time: Math.floor(k.t / 1000),
                            open: parseFloat(k.o),
                            high: parseFloat(k.h),
                            low: parseFloat(k.l),
                            close: parseFloat(k.c),
                            volume: parseFloat(k.v),
                            isClosed: k.x || false
                        };
                    }
                }

                if (candle && this.chartManager && this.chartManager.currentSymbol === this.currentSymbol) {
                    this.chartManager.updateLastCandle(candle);
                }
            } catch(e) {
                console.warn('⚠️ Kline WS ошибка обработки:', e);
            }
        };

        ws.onclose = (event) => {
            this._klineConnecting = false;
            if (this._destroyed) return;
            if (this.currentSymbol === symbol && this.currentInterval === interval && 
                this.currentExchange === exchange && this.currentMarketType === marketType) {
                const delay = this._getReconnectDelay(this._klineReconnectAttempts);
                this._klineReconnectAttempts++;
                this.klineReconnectTimer = setTimeout(() => {
                    if (!this._destroyed) this.connectKline(symbol, interval, exchange, marketType);
                }, delay);
            }
        };

        ws.onerror = (err) => {
            console.warn('⚠️ Kline WS ошибка:', err);
            this._klineConnecting = false;
        };
    }

    connectTrade(symbol, exchange, marketType) {
        if (this._destroyed) return;

        symbol = symbol || this.currentSymbol || 'BTCUSDT';
        exchange = exchange || this.currentExchange || 'binance';
        marketType = marketType || this.currentMarketType || 'futures';

        this.currentSymbol = symbol;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;

        this._cleanupTrade();

        if (this._tradeConnecting) {
            console.warn('⚠️ Trade WS уже подключается');
            return;
        }
        this._tradeConnecting = true;

        let wsUrl;
        if (exchange === 'bybit') {
            const category = (marketType === 'spot') ? 'spot' : 'linear';
            wsUrl = `wss://stream.bybit.com/v5/public/${category}`;
        } else {
            const baseUrl = marketType === 'spot'
                ? 'wss://data-stream.binance.com/ws'
                : 'wss://fstream.binance.com/ws';
            wsUrl = `${baseUrl}/${symbol.toLowerCase()}@aggTrade`;
        }

        const ws = new WebSocket(wsUrl);
        this.wsTrade = ws;

        ws.onopen = () => {
            if (this._destroyed) { ws.close(); return; }
            this._tradeConnecting = false;
            this._tradeReconnectAttempts = 0;
            if (exchange === 'bybit') {
                ws.send(JSON.stringify({ op: 'subscribe', args: [`publicTrade.${symbol}`] }));
            }
        };

        ws.onmessage = (event) => {
            if (this._destroyed) return;
            try {
                if (this.currentSymbol !== symbol) return;
                const data = JSON.parse(event.data);
                let price = null;

                if (exchange === 'bybit') {
                    if (data.topic?.startsWith('publicTrade.') && data.data?.length) {
                        price = parseFloat(data.data[0].p);
                    }
                } else {
                    price = parseFloat(data.p);
                }

                if (price && this.chartManager && this.chartManager.currentSymbol === this.currentSymbol) {
                    this.chartManager._syncPriceLine?.(price);
                }
            } catch(e) {
                console.warn('⚠️ Trade WS ошибка обработки:', e);
            }
        };

        ws.onclose = (event) => {
            this._tradeConnecting = false;
            if (this._destroyed) return;
            if (this.currentSymbol === symbol && this.currentExchange === exchange && this.currentMarketType === marketType) {
                const delay = this._getReconnectDelay(this._tradeReconnectAttempts);
                this._tradeReconnectAttempts++;
                this.tradeReconnectTimer = setTimeout(() => {
                    if (!this._destroyed) this.connectTrade(symbol, exchange, marketType);
                }, delay);
            }
        };

        ws.onerror = (err) => {
            console.warn('⚠️ Trade WS ошибка:', err);
            this._tradeConnecting = false;
        };
    }

    _cleanupKline() {
        if (this.klineReconnectTimer) {
            clearTimeout(this.klineReconnectTimer);
            this.klineReconnectTimer = null;
        }
        if (this.wsKline) {
            const oldWs = this.wsKline;
            this.wsKline = null;
            oldWs.onopen = null;
            oldWs.onmessage = null;
            oldWs.onclose = null;
            oldWs.onerror = null;
            if (oldWs.readyState === WebSocket.OPEN || oldWs.readyState === WebSocket.CONNECTING || oldWs.readyState === WebSocket.CLOSING) {
                try { oldWs.close(); } catch(e) {}
            }
        }
        this._klineConnecting = false;
    }

    _cleanupTrade() {
        if (this.tradeReconnectTimer) {
            clearTimeout(this.tradeReconnectTimer);
            this.tradeReconnectTimer = null;
        }
        if (this.wsTrade) {
            const oldWs = this.wsTrade;
            this.wsTrade = null;
            oldWs.onopen = null;
            oldWs.onmessage = null;
            oldWs.onclose = null;
            oldWs.onerror = null;
            if (oldWs.readyState === WebSocket.OPEN || oldWs.readyState === WebSocket.CONNECTING || oldWs.readyState === WebSocket.CLOSING) {
                try { oldWs.close(); } catch(e) {}
            }
        }
        this._tradeConnecting = false;
    }

    _getReconnectDelay(attempts) {
        const baseDelay = 3000;
        const exponential = Math.min(baseDelay * Math.pow(2, attempts), this._maxReconnectDelay);
        const jitter = Math.random() * 1000;
        return exponential + jitter;
    }

    updateSymbolAndTimeframe(symbol, interval, exchange, marketType) {
        this.currentSymbol = symbol || this.currentSymbol;
        this.currentInterval = interval || this.currentInterval;
        this.currentExchange = exchange || this.currentExchange;
        this.currentMarketType = marketType || this.currentMarketType;

        this.connectKline(symbol, interval, exchange, marketType);
        this.connectTrade(symbol, exchange, marketType);
    }

    isKlineConnected() {
        return this.wsKline && this.wsKline.readyState === WebSocket.OPEN && !this._klineConnecting;
    }

    isTradeConnected() {
        return this.wsTrade && this.wsTrade.readyState === WebSocket.OPEN && !this._tradeConnecting;
    }

    closeAll() {
        this._cleanupKline();
        this._cleanupTrade();
    }

    destroy() {
        this._destroyed = true;
        this.closeAll();
        this.chartManager = null;
    }
}

if (typeof window !== 'undefined') window.WebSocketManager = WebSocketManager;
