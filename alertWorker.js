// alertWorker.js — ПРОСТАЯ И РАБОЧАЯ ВЕРСИЯ
let connections = {};

self.onmessage = function(e) {
    const msg = e.data;
    
    if (msg.type === 'subscribe') {
        const symbol = (msg.symbol || 'btcusdt').toLowerCase();
        const key = symbol;
        
        if (connections[key]) {
            self.postMessage({ type: 'log', message: '[Worker] Already connected: ' + key });
            return;
        }
        
        const url = 'wss://fstream.binance.com/ws/' + symbol + '@miniTicker';
        self.postMessage({ type: 'log', message: '[Worker] Connecting to ' + url });
        
        try {
            const ws = new WebSocket(url);
            
            ws.onopen = function() {
                self.postMessage({ type: 'log', message: '[Worker] ✅ Open: ' + key });
            };
            
            ws.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    if (data.c) {
                        const price = parseFloat(data.c);
                        self.postMessage({ type: 'price', symbol: msg.symbol, price: price });
                    }
                } catch(e) {}
            };
            
            ws.onclose = function() {
                self.postMessage({ type: 'log', message: '[Worker] Closed: ' + key });
                delete connections[key];
                setTimeout(function() {
                    self.postMessage(msg);
                }, 5000);
            };
            
            ws.onerror = function() {
                self.postMessage({ type: 'log', message: '[Worker] ❌ Error: ' + key });
                ws.close();
            };
            
            connections[key] = ws;
        } catch(e) {
            self.postMessage({ type: 'log', message: '[Worker] ❌ Exception: ' + e.message });
        }
    }
    
    if (msg.type === 'unsubscribe') {
        const key = msg.symbol.toLowerCase();
        if (connections[key]) {
            connections[key].close();
            delete connections[key];
        }
    }
    
    if (msg.type === 'destroy') {
        for (let key in connections) {
            connections[key].close();
        }
        connections = {};
        self.postMessage({ type: 'destroyed' });
    }
};
