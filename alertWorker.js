/**
 * alertWorker.js
 * Web Worker для мониторинга цен в реальном времени
 */

class AlertWorker {
    constructor() {
        this.sockets = new Map(); // Хранит активные WebSocket соединения по ключу exchange:marketType
        this.subscriptions = new Map(); // Хранит список символов для каждого сокета: key -> Set<symbols>
        
        // Конфигурация эндпоинтов
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

        // Таймер переподключения
        this.reconnectTimers = new Map();
    }

    /**
     * Основной обработчик сообщений от основного потока
     */
    handleMessage(event) {
        const data = event.data;
        
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
                console.warn('[Worker] Unknown message type:', data.type);
        }
    }

    /**
     * Подписка на символ
     */
    subscribe(symbol, exchange = 'binance', marketType = 'futures') {
        const socketKey = `${exchange}:${marketType}`;
        
        // Инициализируем хранилище подписок для этого сокета, если нет
        if (!this.subscriptions.has(socketKey)) {
            this.subscriptions.set(socketKey, new Set());
        }
        
        const symbolSet = this.subscriptions.get(socketKey);
        
        // Если уже подписаны, ничего не делаем
        if (symbolSet.has(symbol)) return;
        
        symbolSet.add(symbol);
        
        // Если сокет уже есть, просто добавляем подписку через него
        if (this.sockets.has(socketKey)) {
            this._sendSubscriptionMessage(this.sockets.get(socketKey), [symbol], exchange, marketType, true);
        } else {
            // Если сокета нет, создаем новый
            this._createSocket(socketKey, exchange, marketType);
        }
        
        // console.log(`[Worker] Subscribed to ${symbol} on ${socketKey}`);
    }

    /**
     * Отписка от символа
     */
    unsubscribe(symbol, exchange = 'binance', marketType = 'futures') {
        const socketKey = `${exchange}:${marketType}`;
        const symbolSet = this.subscriptions.get(socketKey);
        
        if (!symbolSet || !symbolSet.has(symbol)) return;
        
        symbolSet.delete(symbol);
        
        // Если есть активный сокет, отправляем команду отписки
        if (this.sockets.has(socketKey)) {
            this._sendSubscriptionMessage(this.sockets.get(socketKey), [symbol], exchange, marketType, false);
        }
        
        // Если подписок больше нет, закрываем сокет
        if (symbolSet.size === 0) {
            this._closeSocket(socketKey);
        }
    }

    /**
     * Создание WebSocket соединения
     */
    _createSocket(socketKey, exchange, marketType) {
        const endpoint = this.endpoints[exchange]?.[marketType];
        if (!endpoint) {
            console.error(`[Worker] No endpoint for ${exchange} ${marketType}`);
            return;
        }

        // Binance поддерживает мульти-стримы через один сокет
        // Bybit v5 также поддерживает множественные топики
        
        const ws = new WebSocket(endpoint);
        
        ws.onopen = () => {
            console.log(`[Worker] Connected to ${socketKey}`);
            // При открытии подписываемся на все накопленные символы
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
                // Игнорируем ошибки парсинга
            }
        };

        ws.onerror = (err) => {
            console.error(`[Worker] Socket error ${socketKey}:`, err);
        };

        ws.onclose = () => {
            console.log(`[Worker] Disconnected from ${socketKey}`);
            this.sockets.delete(socketKey);
            
            // Пытаемся переподключиться, если есть активные подписки
            const symbols = this.subscriptions.get(socketKey);
            if (symbols && symbols.size > 0) {
                this._scheduleReconnect(socketKey, exchange, marketType);
            }
        };

        this.sockets.set(socketKey, ws);
    }

    /**
     * Отправка команд подписки/отписки (зависит от биржи)
     */
    _sendSubscriptionMessage(ws, symbols, exchange, marketType, isSubscribe) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        if (exchange === 'binance') {
            // Binance format: {"method": "SUBSCRIBE", "params": ["btcusdt@aggTrade"], "id": 1}
            const streams = symbols.map(s => `${s.toLowerCase()}@aggTrade`);
            const payload = {
                method: isSubscribe ? 'SUBSCRIBE' : 'UNSUBSCRIBE',
                params: streams,
                id: Date.now()
            };
            ws.send(JSON.stringify(payload));
        } 
        else if (exchange === 'bybit') {
            // Bybit v5 format: {"op": "subscribe", "args": ["tickers.BTCUSDT"]}
            const category = marketType === 'futures' ? 'linear' : 'spot';
            const args = symbols.map(s => `tickers.${s}`);
            
            const payload = {
                op: isSubscribe ? 'subscribe' : 'unsubscribe',
                args: args
            };
            ws.send(JSON.stringify(payload));
        }
    }

    /**
     * Обработка входящих сообщений
     */
    _processMessage(msg, exchange, marketType) {
        let symbol = null;
        let price = null;

        if (exchange === 'binance') {
            // Binance aggTrade: {"e":"aggTrade", "s":"BTCUSDT", "p":"123.45", ...}
            if (msg.e === 'aggTrade') {
                symbol = msg.s; // Обычно приходит в верхнем регистре
                price = parseFloat(msg.p);
            }
        } 
        else if (exchange === 'bybit') {
            // Bybit ticker: {"topic":"tickers.BTCUSDT", "data":{"lastPrice":"123.45"}}
            if (msg.topic && msg.topic.startsWith('tickers.')) {
                symbol = msg.topic.split('.')[1];
                if (msg.data && msg.data.lastPrice) {
                    price = parseFloat(msg.data.lastPrice);
                }
            }
        }

        if (symbol && price && !isNaN(price)) {
            // Отправляем цену в основной поток
            self.postMessage({
                type: 'price',
                symbol: symbol,
                price: price
            });
        }
    }

    /**
     * Планирование переподключения
     */
    _scheduleReconnect(socketKey, exchange, marketType) {
        if (this.reconnectTimers.has(socketKey)) {
            clearTimeout(this.reconnectTimers.get(socketKey));
        }
        
        // Экспоненциальная задержка или фиксированная (например, 3 секунды)
        const delay = 3000; 
        
        this.reconnectTimers.set(socketKey, setTimeout(() => {
            console.log(`[Worker] Reconnecting to ${socketKey}...`);
            this._createSocket(socketKey, exchange, marketType);
            this.reconnectTimers.delete(socketKey);
        }, delay));
    }

    /**
     * Закрытие конкретного сокета
     */
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

    /**
     * Полная очистка при уничтожении воркера
     */
    destroy() {
        console.log('[Worker] Destroying...');
        
        // Закрываем все таймеры
        this.reconnectTimers.forEach(timer => clearTimeout(timer));
        this.reconnectTimers.clear();
        
        // Закрываем все сокеты
        this.sockets.forEach(ws => ws.close());
        this.sockets.clear();
        this.subscriptions.clear();
        
        self.postMessage({ type: 'destroyed' });
    }
}

// Инициализация
const worker = new AlertWorker();

self.onmessage = (e) => {
    worker.handleMessage(e);
};

console.log('[Worker] Alert Worker Started');
