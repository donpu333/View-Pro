let connections = {};

self.onmessage = function(e) {
    var msg = e.data;
    
    if (msg.type === 'subscribe') {
        var symbol = (msg.symbol || 'btcusdt').toLowerCase();
        var key = symbol + ':' + (msg.exchange || 'binance') + ':' + (msg.marketType || 'futures');
        
        if (connections[key]) return;
        
        var url = 'wss://fstream.binance.com/ws/' + symbol + '@miniTicker';
        
        try {
            var ws = new WebSocket(url);
            
            ws.onopen = function() {
                self.postMessage({ type: 'log', message: '[Worker] Open: ' + key });
            };
            
            ws.onmessage = function(event) {
                try {
                    var data = JSON.parse(event.data);
                    if (data.c) {
                        self.postMessage({ type: 'price', symbol: msg.symbol, price: parseFloat(data.c) });
                    }
                } catch(err) {}
            };
            
            ws.onclose = function() {
                delete connections[key];
                setTimeout(function() {
                    if (!connections[key]) {
                        self.postMessage(msg);
                    }
                }, 5000);
            };
            
            ws.onerror = function() {
                delete connections[key];
                try { ws.close(); } catch(e) {}
            };
            
            connections[key] = ws;
        } catch(err) {
            self.postMessage({ type: 'log', message: '[Worker] Error: ' + err.message });
        }
    }
    
    if (msg.type === 'unsubscribe') {
        var symbol = msg.symbol.toLowerCase();
        for (var k in connections) {
            if (k.indexOf(symbol) === 0) {
                try { connections[k].close(); } catch(e) {}
                delete connections[k];
            }
        }
    }
    
    if (msg.type === 'destroy') {
        for (var k in connections) {
            try { connections[k].close(); } catch(e) {}
        }
        connections = {};
        self.postMessage({ type: 'destroyed' });
    }
};
