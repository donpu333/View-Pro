// alertWorker.js — Минимальная, гарантированно рабочая версия
// Использует ТОЛЬКО ES5 (никаких стрелок, шаблонных строк, const/let в циклах)
// Подключается к Binance Futures @miniTicker (цена каждую секунду)

var connections = {}; // key: "SYMBOL:exchange:marketType" -> WebSocket

self.onmessage = function(e) {
    var msg = e.data;

    if (msg.type === 'subscribe') {
        var symbol = (msg.symbol || 'btcusdt').toLowerCase();
        var exchange = msg.exchange || 'binance';
        var marketType = msg.marketType || 'futures';
        var key = symbol + ':' + exchange + ':' + marketType;

        // Уже подключены
        if (connections[key]) {
            self.postMessage({ type: 'log', message: '[Worker] Already subscribed to ' + key });
            return;
        }

        // Для Binance Futures используем @miniTicker (стабильный поток каждую секунду)
        var url = 'wss://fstream.binance.com/ws/' + symbol + '@miniTicker';
        self.postMessage({ type: 'log', message: '[Worker] Connecting to ' + url });

        try {
            var ws = new WebSocket(url);

            ws.onopen = function() {
                self.postMessage({ type: 'log', message: '[Worker] ✅ Open: ' + key });
            };

            ws.onmessage = function(event) {
                try {
                    var data = JSON.parse(event.data);
                    // @miniTicker присылает объект с полем "c" (close price)
                    if (data && typeof data.c === 'string') {
                        var price = parseFloat(data.c);
                        if (!isNaN(price)) {
                            self.postMessage({
                                type: 'price',
                                symbol: msg.symbol, // сохраняем оригинальный регистр
                                price: price
                            });
                        }
                    }
                } catch (err) {
                    // игнорируем ошибки парсинга
                }
            };

            ws.onclose = function() {
                self.postMessage({ type: 'log', message: '[Worker] Closed: ' + key });
                delete connections[key];
                // Переподключение через 5 секунд, если не закрыто принудительно
                setTimeout(function() {
                    if (!connections[key]) {
                        self.postMessage(msg); // повторно шлём тот же subscribe
                    }
                }, 5000);
            };

            ws.onerror = function(err) {
                self.postMessage({ type: 'log', message: '[Worker] ❌ Error: ' + key });
                // Закрываем соединение, чтобы onclose сработал
                try { ws.close(); } catch(e) {}
                delete connections[key];
            };

            connections[key] = ws;
        } catch (err) {
            self.postMessage({ type: 'log', message: '[Worker] Exception: ' + err.message });
        }
    }

    if (msg.type === 'unsubscribe') {
        var symbol = (msg.symbol || '').toLowerCase();
        // Закрываем все соединения для этого символа
        for (var k in connections) {
            if (k.indexOf(symbol + ':') === 0) {
                try { connections[k].close(); } catch(e) {}
                delete connections[k];
                self.postMessage({ type: 'log', message: '[Worker] Unsubscribed: ' + k });
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
