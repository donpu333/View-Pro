// ============================================================
// alertWorker.js - ПРАВИЛЬНАЯ ВЕРСИЯ (без window)
// ============================================================

let wsConnections = new Map();
let lastPrices = new Map();
let activeAlerts = [];
let restInterval = null;

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
                subscribeToSymbol(data.alert.symbol);
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
    const symbols = new Set();
    alerts.forEach(alert => {
        if (!alert.triggered && alert.status !== 'completed' && alert.status !== 'paused' && !alert.isTimerMode) {
            symbols.add(alert.symbol);
        }
    });
    symbols.forEach(symbol => subscribeToSymbol(symbol));
}

function subscribeToSymbol(symbol) {
    if (wsConnections.has(symbol)) return;
    
    try {
        const ws = new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@trade`);
        
        ws.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                if (data.p) {
                    const price = parseFloat(data.p);
                    lastPrices.set(symbol, price);
                    const alerts = activeAlerts.filter(a => a.symbol === symbol && !a.triggered && a.status !== 'completed' && a.status !== 'paused' && !a.isTimerMode);
                    if (alerts.length > 0) {
                        checkAlerts(symbol, price, alerts);
                    }
                }
            } catch (e) {}
        };
        
        ws.onclose = function() {
            wsConnections.delete(symbol);
            setTimeout(() => {
                const hasAlerts = activeAlerts.some(a => a.symbol === symbol && !a.triggered && a.status !== 'completed' && a.status !== 'paused' && !a.isTimerMode);
                if (hasAlerts && !wsConnections.has(symbol)) {
                    subscribeToSymbol(symbol);
                }
            }, 5000);
        };
        
        ws.onerror = function() {
            ws.close();
        };
        
        wsConnections.set(symbol, ws);
        self.postMessage({ type: 'subscribed', symbol: symbol });
        
    } catch (e) {
        self.postMessage({ type: 'error', message: 'WebSocket error: ' + e.message });
    }
}

function checkAlerts(symbol, price, alerts) {
    const now = Date.now();
    const lastPrice = lastPrices.get(symbol);
    
    if (lastPrice === undefined) return;
    
    for (const alert of alerts) {
        if (now - alert.createdAt < 2000) continue;
        if (alert.priceTriggered) continue;
        
        const alertPrice = alert.price;
        let crossed = false;
        
        if (alert.direction === 'above') {
            crossed = lastPrice < alertPrice && price >= alertPrice;
        } else if (alert.direction === 'below') {
            crossed = lastPrice > alertPrice && price <= alertPrice;
        }
        
        if (crossed) {
            alert.priceTriggered = true;
            alert.active = true;
            alert.lastTriggerTime = now;
            alert.triggerCount = 1;
            
            self.postMessage({
                type: 'alert_triggered',
                alert: alert,
                price: price
            });
        }
    }
}

function startRestPolling() {
    if (restInterval) return;
    
    restInterval = setInterval(() => {
        const symbols = new Set();
        activeAlerts.forEach(alert => {
            if (!alert.triggered && alert.status !== 'completed' && alert.status !== 'paused' && !alert.isTimerMode) {
                symbols.add(alert.symbol);
            }
        });
        
        symbols.forEach(async (symbol) => {
            if (wsConnections.has(symbol)) return;
            
            try {
                const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol.toUpperCase()}`);
                const data = await response.json();
                const price = parseFloat(data.price);
                
                if (!isNaN(price)) {
                    lastPrices.set(symbol, price);
                    const alerts = activeAlerts.filter(a => a.symbol === symbol && !a.triggered && a.status !== 'completed' && a.status !== 'paused' && !a.isTimerMode);
                    if (alerts.length > 0) {
                        checkAlerts(symbol, price, alerts);
                    }
                }
            } catch (e) {}
        });
    }, 3000);
}

function checkAndUnsubscribe(symbol) {
    const hasAlerts = activeAlerts.some(a => a.symbol === symbol && !a.triggered && a.status !== 'completed' && a.status !== 'paused' && !a.isTimerMode);
    if (!hasAlerts) {
        const ws = wsConnections.get(symbol);
        if (ws) {
            try { ws.close(); } catch(e) {}
            wsConnections.delete(symbol);
        }
    }
}

function destroy() {
    if (restInterval) {
        clearInterval(restInterval);
        restInterval = null;
    }
    for (const [symbol, ws] of wsConnections) {
        try { ws.close(); } catch(e) {}
    }
    wsConnections.clear();
    lastPrices.clear();
    activeAlerts = [];
}