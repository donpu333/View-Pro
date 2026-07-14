/**
 * alertWorker.js
 * Web Worker для мониторинга цен в реальном времени
 */

// Глобальная обработка ошибок внутри воркера
self.onerror = function(message, source, lineno, colno, error) {
    console.error(`[Worker] CRITICAL ERROR: ${message} at ${source}:${lineno}:${colno}`);
    self.postMessage({ 
        type: 'log', 
        message: `WORKER CRASH: ${message} (Line ${lineno})` 
    });
};

class AlertWorker {
    constructor() {
        this.sockets = new Map(); 
        this.subscriptions = new Map(); 
        
        this.endpoints = {
            binance: {
                futures: 'wss://fstream.binance.com/stream',
                spot: 'wss://stream.binance.com:9443/stream'
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
        // console.log('[Worker] Received:', data.type); // Можно раскомментировать для отладки
        
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
                default:
                    // Игнорируем неизвестные типы
            }
        } catch (e) {
            console.error('[Worker] Error handling message:', e);
            self.postMessage({ type: 'log', message: `Error handling ${data.type}: ${e.message}` });
        }
    }

    subscribe(symbol, exchange = 'binance', marketType = 'futures') {
        const socketKey = `${exchange}:${marketType}`;
        
        if (!this.subscriptions.has(socketKey)) {
            this.subscriptions.set(socketKey, new Set());
        }
        
        const symbolSet = this.subscriptions.get(socketKey);
        
        if (symbolSet.has(symbol)) return;
        
        symbolSet.add(symbol);
        
        if (this.sockets.has(socketKey)) {
            const ws = this.sockets.get(socketKey);
            // Проверяем состояние сокета перед отправкой
            if (ws.readyState === WebSocket.OPEN) {
                this._sendSubscriptionMessage(ws, [symbol], exchange, marketType, true);
            } else {
                console.warn(`[Worker] Socket ${socketKey} not open yet, waiting...`);
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

        console.log(`[Worker] Connecting to ${endpoint}...`);
        
        try {
            const ws = new WebSocket(endpoint);
            
            ws.onopen = () => {
                console.log(`[Worker] Connected to ${socketKey}`);
                const symbols = Array.from(this.subscriptions.get(socketKey) || []);
                if (symbols.length > 0) {
                    this._sendSubscriptionMessage(ws, symbols, exchange, marketType, true);
                }
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    this._processMessage(msg, exchange, marketType);
                } catch (e) {
                    // Silent fail for parsing errors
                }
            };

            ws.onerror = (err) => {
                console.error(`[Worker] Socket error ${socketKey}`);
            };

            ws.onclose = () => {
                console.log(`[Worker] Closed ${socketKey}`);
                this.sockets.delete(socketKey);
                
                const symbols = this.subscriptions.get(socketKey);
                if (symbols && symbols.size > 0) {
                    this._scheduleReconnect(socketKey, exchange, marketType);
                }
            };

            this.sockets.set(socketKey, ws);
        } catch (e) {
            console.error(`[Worker] Failed to create socket: ${e.message}`);
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
            console.log(`[Worker] Reconnecting ${socketKey}...`);
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
        console.log('[Worker] Destroying...');
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
