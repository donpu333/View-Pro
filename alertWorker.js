let connections = {};

self.onmessage = function(e) {
    var msg = e.data;
    
    if (msg.type === 'subscribe') {
        var symbol = (msg.symbol || 'btcusdt').toLowerCase();
        
        if (connections[symbol]) return;
        
        var url = 'wss://fstream.binance.com/ws/' + symbol + '@miniTicker';
        
        try {
            var ws = new WebSocket(url);
            
            ws.onopen = function() {
                self.postMessage({ type: 'log', message: '[Worker] Open: ' + symbol });
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
                delete connections[symbol];
                setTimeout(function() {
                    self.postMessage(msg);
                }, 5000);
            };
            
            ws.onerror = function() {
                ws.close();
            };
            
            connections[symbol] = ws;
        } catch(err) {}
    }
    
    if (msg.type === 'unsubscribe') {
        var key = msg.symbol.toLowerCase();
        if (connections[key]) {
            connections[key].close();
            delete connections[key];
        }
    }
    
    if (msg.type === 'destroy') {
        for (var k in connections) {
            connections[k].close();
        }
        connections = {};
        self.postMessage({ type: 'destroyed' });
    }
};
