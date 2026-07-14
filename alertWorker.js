/**
 * alertWorker.js
 * Web Worker для мониторинга цен в реальном времени (ИСПРАВЛЕННАЯ ВЕРСИЯ)
 */

// Глобальная обработка ошибок внутри воркера
self.onerror = function(message, source, lineno, colno, error) {
    self.postMessage({ 
        type: 'log', 
        message: `WORKER CRASH: ${message} (Line ${lineno})` 
    });
};

class AlertWorker {
    constructor() {
        this.sockets = new Map(); 
        this.subscriptions = new Map(); 
        
        // ИСПРАВЛЕНО: Используем /ws вместо /stream для JSON подписок
        this.endpoints = {
            binance: {
                futures: 'wss://fstream.binance.com/ws',
                spot: 'wss://stream.binance.com:9443/ws'
            },
            bybit: {
                futures: 'wss://stream.bybit.com/v5/public/linear',
                spot: 'wss://stream.bybit.com/v5/public/spot'
            }
        };

        this.reconnectTimers = new Map();
        
        // Отправляем сообщение о готовности
        self.postMessage({ type: 'log', message: '[Worker] Initialized successfully' });
    }

    handleMessage(event) {
        const data = event.data;
        
        try {
            switch (data.type) {
                case 'subscribe':
                    this.subscribe(data.symbol, data.exchange, data.marketType);
                    break;
                case 'unsubscribe':
                    this.unsubscribe(data.symbol, data.exchange, data.marketType);
                    break;
                case 'destroy':
                    this.destroy();
                    break;
                // ДОБАВЛЕНО: Команда для проверки состояния воркера
                case 'status':
                    self.postMessage({ 
                        type: 'status', 
                        sockets: Array.from(this.sockets.entries()).map(([k, ws]) => ({
                            key: k, 
                            state: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState]
                        })),
                        subscriptions: Object.fromEntries(
                            Array.from(this.subscriptions.entries()).map(([k, v]) => [k, [...v]])
                        )
                    });
                    break;
                default:
                    break;
            }
        } catch (e) {
            self.postMessage({ type: 'log', message: `Error handling ${data.type}: ${e.message}` });
        }
    }

    subscribe(symbol, exchange = 'binance', marketType = 'futures') {
        const socketKey = `${exchange}:${marketType}`;
        
        if (!this.subscriptions.has(socketKey)) {
            this.subscriptions.set(socketKey, new Set());
        }
        
        const symbolSet = this.subscriptions.get(socketKey);
        
        if (symbolSet.has(symbol)) {
            self.postMessage({ type: 'log', message: `[Worker] Already subscribed to ${symbol}` });
            return;
        }
        
        symbolSet.add(symbol);
        self.postMessage({ type: 'log', message: `[Worker] Adding subscription: ${symbol} (${socketKey})` });
        
        if (this.sockets.has(socketKey)) {
            const ws = this.sockets.get(socketKey);
            if (ws.readyState === WebSocket.OPEN) {
                this._sendSubscriptionMessage(ws, [symbol], exchange, marketType, true);
            } else {
                self.postMessage({ type: 'log', message: `[Worker] Socket ${socketKey} not open yet (state: ${ws.readyState}), will subscribe on open` });
            }
        } else {
            this._createSocket(socketKey, exchange, marketType);
        }
    }

    unsubscribe(symbol, exchange = 'binance', marketType = 'futures') {
        const socketKey = `${exchange}:${marketType}`;
        const symbolSet = this.subscriptions.get(socketKey);
        
        if (!symbolSet || !symbolSet.has(symbol)) return;
        
        symbolSet.delete(symbol);
        
        if (this.sockets.has(socketKey)) {
            const ws = this.sockets.get(socketKey);
            if (ws.readyState === WebSocket.OPEN) {
                this._sendSubscriptionMessage(ws, [symbol], exchange, marketType, false);
            }
        }
        
        if (symbolSet.size === 0) {
            this._closeSocket(socketKey);
        }
    }

    _createSocket(socketKey, exchange, marketType) {
        const endpoint = this.endpoints[exchange]?.[marketType];
        if (!endpoint) {
            self.postMessage({ type: 'log', message: `No endpoint for ${exchange} ${marketType}` });
            return;
        }

        self.postMessage({ type: 'log', message: `[Worker] Connecting to ${endpoint}...` });
        
        try {
            const ws = new WebSocket(endpoint);
            
            ws.onopen = () => {
                self.postMessage({ type: 'log', message: `[Worker] ✅ Connected to ${socketKey}` });
                const symbols = Array.from(this.subscriptions.get(socketKey) || []);
                if (symbols.length > 0) {
                    this._sendSubscriptionMessage(ws, symbols, exchange, marketType, true);
                }
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    
                    // Binance присылает подтверждение подписки: {"result": null, "id": 123}
                    // Игнорируем его, чтобы не обрабатывать как ошибку
                    if (msg.result !== undefined && !msg.e && !msg.topic) return;
                    
                    this._processMessage(msg, exchange, marketType);
                } catch (e) {
                    // Silent fail для ошибок парсинга
                }
            };

            ws.onerror = (err) => {
                self.postMessage({ type: 'log', message: `[Worker] ❌ Socket error ${socketKey}` });
            };

            ws.onclose = (event) => {
                self.postMessage({ type: 'log', message: `[Worker] Closed ${socketKey} (Code: ${event.code})` });
                this.sockets.delete(socketKey);
                
                const symbols = this.subscriptions.get(socketKey);
                if (symbols && symbols.size > 0) {
                    this._scheduleReconnect(socketKey, exchange, marketType);
                }
            };

            this.sockets.set(socketKey, ws);
        } catch (e) {
            self.postMessage({ type: 'log', message: `[Worker] Failed to create socket: ${e.message}` });
        }
    }

    _sendSubscriptionMessage(ws, symbols, exchange, marketType, isSubscribe) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        if (exchange === 'binance') {
            const streams = symbols.map(s => `${s.toLowerCase()}@aggTrade`);
            const payload = {
                method: isSubscribe ? 'SUBSCRIBE' : 'UNSUBSCRIBE',
                params: streams,
                id: Date.now()
            };
            ws.send(JSON.stringify(payload));
        } 
        else if (exchange === 'bybit') {
            const args = symbols.map(s => `tickers.${s}`);
            const payload = {
                op: isSubscribe ? 'subscribe' : 'unsubscribe',
                args: args
            };
            ws.send(JSON.stringify(payload));
        }
    }

    _processMessage(msg, exchange, marketType) {
        let symbol = null;
        let price = null;

        if (exchange === 'binance') {
            if (msg.e === 'aggTrade') {
                symbol = msg.s; 
                price = parseFloat(msg.p);
            }
        } 
        else if (exchange === 'bybit') {
            if (msg.topic && msg.topic.startsWith('tickers.')) {
                symbol = msg.topic.split('.')[1];
                if (msg.data && msg.data.lastPrice) {
                    price = parseFloat(msg.data.lastPrice);
                }
            }
        }

        if (symbol && price && !isNaN(price)) {
            self.postMessage({
                type: 'price',
                symbol: symbol,
                price: price
            });
        }
    }

    _scheduleReconnect(socketKey, exchange, marketType) {
        if (this.reconnectTimers.has(socketKey)) {
            clearTimeout(this.reconnectTimers.get(socketKey));
        }
        
        const delay = 3000; 
        
        this.reconnectTimers.set(socketKey, setTimeout(() => {
            self.postMessage({ type: 'log', message: `[Worker] Reconnecting ${socketKey}...` });
            this._createSocket(socketKey, exchange, marketType);
            this.reconnectTimers.delete(socketKey);
        }, delay));
    }

    _closeSocket(socketKey) {
        const ws = this.sockets.get(socketKey);
        if (ws) {
            ws.close();
            this.sockets.delete(socketKey);
        }
        if (this.reconnectTimers.has(socketKey)) {
            clearTimeout(this.reconnectTimers.get(socketKey));
            this.reconnectTimers.delete(socketKey);
        }
        this.subscriptions.delete(socketKey);
    }

    destroy() {
        self.postMessage({ type: 'log', message: '[Worker] Destroying...' });
        this.reconnectTimers.forEach(timer => clearTimeout(timer));
        this.reconnectTimers.clear();
        this.sockets.forEach(ws => ws.close());
        this.sockets.clear();
        this.subscriptions.clear();
        self.postMessage({ type: 'destroyed' });
    }
}

const worker = new AlertWorker();

self.onmessage = (e) => {
    worker.handleMessage(e);
};
