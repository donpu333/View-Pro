// alertWorker.js - Web Worker для алертов (Binance + Bybit)
let wsConnections = new Map();
let lastPrices = new Map();
let activeAlerts = [];
let restInterval = null;
let pingIntervals = new Map();

const EXCHANGE_WS = {
    binance: {
        futures: (symbol) => ({
            url: `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@trade`,
            subscribe: null,
            needPing: false,
            parse: (raw) => {
                try { const d = JSON.parse(raw); return d.p ? parseFloat(d.p) : null; } catch { return null; }
            }
        }),
        spot: (symbol) => ({
            url: `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@trade`,
            subscribe: null,
            needPing: false,
            parse: (raw) => {
                try { const d = JSON.parse(raw); return d.p ? parseFloat(d.p) : null; } catch { return null; }
            }
        })
    },
    bybit: {
        futures: (symbol) => ({
            url: `wss://stream.bybit.com/v5/public/linear`,
            subscribe: JSON.stringify({ op: "subscribe", args: [`tickers.${symbol.toUpperCase()}`] }),
            needPing: true,
            pingMessage: JSON.stringify({ op: "ping" }),
            parse: (raw) => {
                try {
                    const d = JSON.parse(raw);
                    if (d.op === 'pong' || d.ret_msg === 'pong') return null;
                    if (d.topic && d.data && d.data.lastPrice) {
                        const price = parseFloat(d.data.lastPrice);
                        return !isNaN(price) ? price : null;
                    }
                    return null;
                } catch { return null; }
            }
        }),
        spot: (symbol) => ({
            url: `wss://stream.bybit.com/v5/public/spot`,
            subscribe: JSON.stringify({ op: "subscribe", args: [`tickers.${symbol.toUpperCase()}`] }),
            needPing: true,
            pingMessage: JSON.stringify({ op: "ping" }),
            parse: (raw) => {
                try {
                    const d = JSON.parse(raw);
                    if (d.op === 'pong' || d.ret_msg === 'pong') return null;
                    if (d.topic && d.data && d.data.lastPrice) {
                        const price = parseFloat(d.data.lastPrice);
                        return !isNaN(price) ? price : null;
                    }
                    return null;
                } catch { return null; }
            }
        })
    }
};

const EXCHANGE_REST = {
    binance: {
        futures: (s) => `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${s.toUpperCase()}`,
        spot: (s) => `https://api.binance.com/api/v3/ticker/price?symbol=${s.toUpperCase()}`,
        parse: (d) => parseFloat(d.price)
    },
    bybit: {
        futures: (s) => `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${s.toUpperCase()}`,
        spot: (s) => `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${s.toUpperCase()}`,
        parse: (d) => d.result?.list?.[0] ? parseFloat(d.result.list[0].lastPrice) : null
    }
};

function getWsConfig(exchange, marketType, symbol) {
    const ex = EXCHANGE_WS[exchange?.toLowerCase()] || EXCHANGE_WS.binance;
    const market = ex[marketType] || ex.futures;
    return market(symbol);
}

function getRestConfig(exchange, marketType) {
    const ex = EXCHANGE_REST[exchange?.toLowerCase()] || EXCHANGE_REST.binance;
    return ex[marketType] || ex.futures;
}

self.onmessage = function(e) {
    const data = e.data;
    switch(data.type) {
        case 'init':
            activeAlerts = data.alerts || [];
            subscribeToSymbols(activeAlerts);
            startRestPolling();
            self.postMessage({ type: 'ready', count: activeAlerts.length });
            break;
        case 'addAlert':
            if (!activeAlerts.find(a => a.id === data.alert.id)) {
                activeAlerts.push(data.alert);
                subscribeToSymbol(data.alert.symbol, data.alert.exchange || 'binance', data.alert.marketType || 'futures');
                self.postMessage({ type: 'alertAdded', id: data.alert.id });
            }
            break;
        case 'removeAlert':
            activeAlerts = activeAlerts.filter(a => a.id !== data.alertId);
            checkAndUnsubscribe(data.symbol);
            break;
        case 'getStatus':
            self.postMessage({
                type: 'status',
                data: {
                    alerts: activeAlerts.length,
                    subscriptions: wsConnections.size,
                    symbols: Array.from(wsConnections.keys())
                }
            });
            break;
        case 'destroy':
            destroy();
            break;
    }
};

function subscribeToSymbols(alerts) {
    const symbolMap = new Map();
    alerts.forEach(alert => {
        if (!alert.triggered && alert.status !== 'completed' && alert.status !== 'paused' && !alert.isTimerMode) {
            symbolMap.set(alert.symbol, { exchange: alert.exchange || 'binance', marketType: alert.marketType || 'futures' });
        }
    });
    symbolMap.forEach((info, symbol) => subscribeToSymbol(symbol, info.exchange, info.marketType));
}

function subscribeToSymbol(symbol, exchange = 'binance', marketType = 'futures') {
    const key = `${symbol}:${exchange}:${marketType}`;
    if (wsConnections.has(key)) return;
    
    const config = getWsConfig(exchange, marketType, symbol);
    
    try {
        const ws = new WebSocket(config.url);
        
        ws.onopen = () => {
            if (config.subscribe) {
                try { ws.send(config.subscribe); } catch (e) {}
            }
            if (config.needPing) {
                const pingId = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        try { ws.send(config.pingMessage); } catch (e) {}
                    }
                }, 15000);
                pingIntervals.set(key, pingId);
            }
            self.postMessage({ type: 'subscribed', symbol, exchange });
        };
        
        ws.onmessage = function(event) {
            try {
                const price = config.parse(event.data);
                if (price && !isNaN(price)) {
                    const lastPrice = lastPrices.get(symbol);
                    lastPrices.set(symbol, price);
                    
                    const alerts = activeAlerts.filter(a => 
                        a.symbol === symbol && !a.triggered && 
                        a.status !== 'completed' && a.status !== 'paused' && !a.isTimerMode
                    );
                    
                    if (alerts.length > 0 && lastPrice !== undefined) {
                        checkAlerts(symbol, price, lastPrice, alerts);
                    }
                }
            } catch (e) {}
        };
        
        ws.onclose = function() {
            const pingId = pingIntervals.get(key);
            if (pingId) { clearInterval(pingId); pingIntervals.delete(key); }
            wsConnections.delete(key);
            setTimeout(() => {
                const hasAlerts = activeAlerts.some(a => 
                    a.symbol === symbol && !a.triggered && 
                    a.status !== 'completed' && a.status !== 'paused' && !a.isTimerMode
                );
                if (hasAlerts && !wsConnections.has(key)) {
                    subscribeToSymbol(symbol, exchange, marketType);
                }
            }, 5000);
        };
        
        ws.onerror = function() { try { ws.close(); } catch(e) {} };
        
        wsConnections.set(key, ws);
    } catch (e) {
        self.postMessage({ type: 'error', message: `WS error ${symbol}: ${e.message}` });
    }
}

function checkAlerts(symbol, price, lastPrice, alerts) {
    const now = Date.now();
    for (const alert of alerts) {
        if (now - alert.createdAt < 2000) continue;
        if (alert.priceTriggered) continue;
        
        let crossed = false;
        if (alert.direction === 'above') {
            crossed = lastPrice < alert.price && price >= alert.price;
        } else if (alert.direction === 'below') {
            crossed = lastPrice > alert.price && price <= alert.price;
        } else {
            crossed = (lastPrice < alert.price && price >= alert.price) ||
                      (lastPrice > alert.price && price <= alert.price);
        }
        
        if (crossed) {
            alert.priceTriggered = true;
            alert.active = true;
            alert.lastTriggerTime = now;
            alert.triggerCount = 1;
            self.postMessage({ type: 'alert_triggered', alert, price });
        }
    }
}

function startRestPolling() {
    if (restInterval) return;
    restInterval = setInterval(() => {
        const symbolMap = new Map();
        activeAlerts.forEach(alert => {
            if (!alert.triggered && alert.status !== 'completed' && alert.status !== 'paused' && !alert.isTimerMode) {
                const key = `${alert.symbol}:${alert.exchange || 'binance'}:${alert.marketType || 'futures'}`;
                if (!wsConnections.has(key)) {
                    symbolMap.set(alert.symbol, { exchange: alert.exchange || 'binance', marketType: alert.marketType || 'futures' });
                }
            }
        });
        
        symbolMap.forEach(async (info, symbol) => {
            try {
                const config = getRestConfig(info.exchange, info.marketType);
                const response = await fetch(config(symbol));
                const data = await response.json();
                const price = config.parse(data);
                
                if (price && !isNaN(price)) {
                    const lastPrice = lastPrices.get(symbol);
                    lastPrices.set(symbol, price);
                    const alerts = activeAlerts.filter(a => 
                        a.symbol === symbol && !a.triggered && 
                        a.status !== 'completed' && a.status !== 'paused' && !a.isTimerMode
                    );
                    if (alerts.length > 0 && lastPrice !== undefined) {
                        checkAlerts(symbol, price, lastPrice, alerts);
                    }
                }
            } catch (e) {}
        });
    }, 3000);
}

function checkAndUnsubscribe(symbol) {
    const hasAlerts = activeAlerts.some(a => 
        a.symbol === symbol && !a.triggered && 
        a.status !== 'completed' && a.status !== 'paused' && !a.isTimerMode
    );
    if (!hasAlerts) {
        for (const [key, ws] of wsConnections.entries()) {
            if (key.startsWith(`${symbol}:`)) {
                const pingId = pingIntervals.get(key);
                if (pingId) { clearInterval(pingId); pingIntervals.delete(key); }
                try { ws.close(); } catch(e) {}
                wsConnections.delete(key);
            }
        }
    }
}

function destroy() {
    if (restInterval) { clearInterval(restInterval); restInterval = null; }
    for (const pingId of pingIntervals.values()) clearInterval(pingId);
    pingIntervals.clear();
    for (const ws of wsConnections.values()) try { ws.close(); } catch(e) {}
    wsConnections.clear();
    lastPrices.clear();
    activeAlerts = [];
}