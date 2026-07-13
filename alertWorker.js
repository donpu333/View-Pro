// alertWorker.js — ТОЛЬКО WebSocket подключения и отправка цены
let wsConnections = new Map();
let pingIntervals = new Map();

const WS_CONFIGS = {
    'binance:futures': (symbol) => ({
        url: `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@trade`,
        parse: (raw) => { 
            try { 
                const d = JSON.parse(raw); 
                return d.p ? parseFloat(d.p) : null; 
            } catch { return null; } 
        }
    }),
    'binance:spot': (symbol) => ({
        url: `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@trade`,
        parse: (raw) => { 
            try { 
                const d = JSON.parse(raw); 
                return d.p ? parseFloat(d.p) : null; 
            } catch { return null; } 
        }
    }),
    'bybit:futures': (symbol) => ({
        url: `wss://stream.bybit.com/v5/public/linear`,
        subscribe: JSON.stringify({ op: "subscribe", args: [`tickers.${symbol.toUpperCase()}`] }),
        needPing: true,
        pingMessage: JSON.stringify({ op: "ping" }),
        parse: (raw) => {
            try {
                const d = JSON.parse(raw);
                
                // Bybit шлёт pong ответы
                if (d.op === 'pong' || d.ret_msg === 'pong') return null;
                
                // Bybit шлёт ответ на подписку
                if (d.op === 'subscribe' && d.success) {
                    self.postMessage({ type: 'log', message: `[Worker] ✅ Subscribed to Bybit ${symbol}` });
                    return null;
                }
                
                // Bybit ticker данные
                if (d.topic && d.data) {
                    // Формат: { topic: "tickers.BTCUSDT", data: { lastPrice: "65123.00", ... } }
                    const price = parseFloat(d.data.lastPrice);
                    if (!isNaN(price)) return price;
                }
                
                return null;
            } catch { return null; }
        }
    }),
    'bybit:spot': (symbol) => ({
        url: `wss://stream.bybit.com/v5/public/spot`,
        subscribe: JSON.stringify({ op: "subscribe", args: [`tickers.${symbol.toUpperCase()}`] }),
        needPing: true,
        pingMessage: JSON.stringify({ op: "ping" }),
        parse: (raw) => {
            try {
                const d = JSON.parse(raw);
                
                if (d.op === 'pong' || d.ret_msg === 'pong') return null;
                
                if (d.op === 'subscribe' && d.success) {
                    self.postMessage({ type: 'log', message: `[Worker] ✅ Subscribed to Bybit spot ${symbol}` });
                    return null;
                }
                
                if (d.topic && d.data) {
                    const price = parseFloat(d.data.lastPrice);
                    if (!isNaN(price)) return price;
                }
                
                return null;
            } catch { return null; }
        }
    })
};

self.onmessage = function(e) {
    const data = e.data;
    
    self.postMessage({ type: 'log', message: `[Worker] Received: ${data.type}` });
    
    switch(data.type) {
        case 'subscribe':
            subscribeToSymbol(data.symbol, data.exchange, data.marketType);
            break;
            
        case 'unsubscribe':
            unsubscribeFromSymbol(data.symbol, data.exchange, data.marketType);
            break;
            
        case 'destroy':
            destroy();
            break;
    }
};

function getKey(symbol, exchange, marketType) {
    return `${symbol}:${exchange}:${marketType}`;
}

function subscribeToSymbol(symbol, exchange = 'binance', marketType = 'futures') {
    const key = getKey(symbol, exchange, marketType);
    
    if (wsConnections.has(key)) {
        self.postMessage({ type: 'log', message: `[Worker] Already subscribed to ${key}` });
        return;
    }
    
    const configKey = `${exchange}:${marketType}`;
    const config = WS_CONFIGS[configKey];
    
    if (!config) {
        self.postMessage({ type: 'log', message: `[Worker] ❌ No config for ${configKey}` });
        return;
    }
    
    const wsConfig = config(symbol);
    self.postMessage({ type: 'log', message: `[Worker] Connecting to ${wsConfig.url}` });
    
    try {
        const ws = new WebSocket(wsConfig.url);
        
        ws.onopen = () => {
            self.postMessage({ type: 'log', message: `[Worker] ✅ Connected to ${key}` });
            if (wsConfig.subscribe) {
                ws.send(wsConfig.subscribe);
                self.postMessage({ type: 'log', message: `[Worker] Sent subscribe: ${wsConfig.subscribe}` });
            }
            if (wsConfig.needPing) {
                const pingId = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(wsConfig.pingMessage);
                    }
                }, 15000);
                pingIntervals.set(key, pingId);
            }
        };
        
        ws.onmessage = (event) => {
            const price = wsConfig.parse(event.data);
            if (price && !isNaN(price)) {
                self.postMessage({ type: 'log', message: `[Worker] 💰 ${symbol} = ${price}` });
                self.postMessage({ 
                    type: 'price', 
                    symbol: symbol, 
                    price: price 
                });
            }
        };
        
        ws.onclose = () => {
            self.postMessage({ type: 'log', message: `[Worker] Connection closed: ${key}` });
            cleanup(key);
            setTimeout(() => {
                if (wsConnections.has(key)) {
                    subscribeToSymbol(symbol, exchange, marketType);
                }
            }, 5000);
        };
        
        ws.onerror = (err) => {
            self.postMessage({ type: 'log', message: `[Worker] ❌ WS error for ${key}` });
            cleanup(key);
            ws.close();
        };
        
        wsConnections.set(key, ws);
        
    } catch(e) {
        self.postMessage({ type: 'log', message: `[Worker] ❌ Failed to connect ${key}: ${e.message}` });
    }
}

function unsubscribeFromSymbol(symbol, exchange, marketType) {
    const key = getKey(symbol, exchange, marketType);
    self.postMessage({ type: 'log', message: `[Worker] Unsubscribing from ${key}` });
    cleanup(key);
    const ws = wsConnections.get(key);
    if (ws) {
        ws.close();
        wsConnections.delete(key);
    }
}

function cleanup(key) {
    const pingId = pingIntervals.get(key);
    if (pingId) {
        clearInterval(pingId);
        pingIntervals.delete(key);
    }
}

function destroy() {
    self.postMessage({ type: 'log', message: '[Worker] Destroying all connections' });
    for (const key of wsConnections.keys()) {
        cleanup(key);
        const ws = wsConnections.get(key);
        if (ws) ws.close();
    }
    wsConnections.clear();
    self.postMessage({ type: 'destroyed' });
}
