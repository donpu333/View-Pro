/**
 * alertWorker.js - Упрощенная и надежная версия
 */

console.log('[Worker] Script loaded');

self.onmessage = function(e) {
    const data = e.data;
    
    if (data.type === 'subscribe') {
        console.log(`[Worker] Subscribing to ${data.symbol} on ${data.exchange}:${data.marketType}`);
        connectAndSubscribe(data.symbol, data.exchange, data.marketType);
    } else if (data.type === 'destroy') {
        self.close();
    }
};

let ws = null;

function connectAndSubscribe(symbol, exchange, marketType) {
    // Если сокет уже есть и открыт, просто шлем подписку
    if (ws && ws.readyState === WebSocket.OPEN) {
        sendSubscription(symbol, exchange, marketType);
        return;
    }

    let url = '';
    if (exchange === 'binance') {
        url = marketType === 'futures' 
            ? 'wss://fstream.binance.com/stream' 
            : 'wss://stream.binance.com:9443/stream';
    } else if (exchange === 'bybit') {
        url = marketType === 'linear' 
            ? 'wss://stream.bybit.com/v5/public/linear' 
            : 'wss://stream.bybit.com/v5/public/spot';
    }

    if (!url) {
        self.postMessage({ type: 'log', message: `Unknown exchange/market: ${exchange}:${marketType}` });
        return;
    }

    console.log(`[Worker] Connecting to ${url}...`);
    ws = new WebSocket(url);

    ws.onopen = () => {
        console.log(`[Worker] ✅ Connected to ${exchange}:${marketType}`);
        self.postMessage({ type: 'log', message: `Connected to ${exchange}:${marketType}` });
        sendSubscription(symbol, exchange, marketType);
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleBinanceMessage(msg, exchange);
        } catch (err) {
            // Игнорируем ошибки парсинга
        }
    };

    ws.onerror = (err) => {
        console.error(`[Worker] ❌ Socket error`);
        self.postMessage({ type: 'log', message: 'Socket Error' });
    };

    ws.onclose = () => {
        console.log(`[Worker] 🔌 Disconnected`);
        self.postMessage({ type: 'log', message: 'Disconnected' });
    };
}

function sendSubscription(symbol, exchange, marketType) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (exchange === 'binance') {
        const payload = {
            method: 'SUBSCRIBE',
            params: [`${symbol.toLowerCase()}@aggTrade`],
            id: 1
        };
        ws.send(JSON.stringify(payload));
        console.log(`[Worker] Sent SUBSCRIBE for ${symbol}`);
    } else if (exchange === 'bybit') {
        const payload = {
            op: 'subscribe',
            args: [`tickers.${symbol}`]
        };
        ws.send(JSON.stringify(payload));
    }
}

function handleBinanceMessage(msg, exchange) {
    let symbol = null;
    let price = null;

    if (exchange === 'binance' && msg.e === 'aggTrade') {
        symbol = msg.s;
        price = parseFloat(msg.p);
    } else if (exchange === 'bybit' && msg.topic && msg.topic.startsWith('tickers.')) {
        symbol = msg.topic.split('.')[1];
        if (msg.data && msg.data.lastPrice) {
            price = parseFloat(msg.data.lastPrice);
        }
    }

    if (symbol && price) {
        self.postMessage({
            type: 'price',
            symbol: symbol,
            price: price
        });
    }
}
