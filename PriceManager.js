class PriceManager {
    constructor() {
        // Хранилище цен: ключ = `${symbol}:${exchange}:${marketType}`
        this.prices = new Map();    // значение: { price, time, exchange, marketType }
        this.subscribers = new Map(); // ключ – такой же составной, значение – массив callback-ов
        
        // WebSocket соединения
        this.connections = {
            'binance:futures': null,
            'binance:spot': null,
            'bybit:linear': null,
            'bybit:spot': null
        };
        this.reconnectTimers = new Map();
        
        this._init();
    }
    
    _init() {
        this._initBinanceFutures();
        this._initBinanceSpot();
        this._initBybitLinear();
        // Если нужен Bybit Spot – раскомментировать
        // this._initBybitSpot();
        console.log('✅ PriceManager (раздельный по биржам) инициализирован');
    }
    
    // ========== BINANCE FUTURES ==========
    _initBinanceFutures() {
        const key = 'binance:futures';
        this._connectWebSocket(key, 'wss://fstream.binance.com/ws/!ticker@arr', (data) => {
            const tickers = Array.isArray(data) ? data : [data];
            tickers.forEach(ticker => {
                if (!ticker.s || !ticker.c) return;
                const symbol = ticker.s;
                const price = parseFloat(ticker.c);
                if (isNaN(price)) return;
                this._setPrice(symbol, price, 'binance', 'futures');
            });
        });
    }
    
    // ========== BINANCE SPOT ==========
    _initBinanceSpot() {
        const key = 'binance:spot';
        this._connectWebSocket(key, 'wss://stream.binance.com:9443/ws/!ticker@arr', (data) => {
            const tickers = Array.isArray(data) ? data : [data];
            tickers.forEach(ticker => {
                if (!ticker.s || !ticker.c) return;
                const symbol = ticker.s;
                const price = parseFloat(ticker.c);
                if (isNaN(price)) return;
                this._setPrice(symbol, price, 'binance', 'spot');
            });
        });
    }
    
    // ========== BYBIT LINEAR (FUTURES) ==========
    _initBybitLinear() {
        const key = 'bybit:linear';
        const ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');
        
        ws.onopen = () => {
            console.log(`✅ PriceManager: ${key} подключён`);
            this.connections[key] = ws;
            // Подписываемся на все тикеры (или можно динамически позже)
            ws.send(JSON.stringify({ op: "subscribe", args: ["tickers.*"] }));
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.topic === 'tickers' && data.data) {
                    const symbol = data.data.symbol;
                    const price = parseFloat(data.data.lastPrice);
                    if (!symbol || isNaN(price)) return;
                    this._setPrice(symbol, price, 'bybit', 'futures');
                }
            } catch(e) {}
        };
        
        ws.onclose = () => this._reconnect(key, this._initBybitLinear.bind(this));
        ws.onerror = () => console.warn(`⚠️ ${key} ошибка`);
    }
    
    // Универсальный метод подключения с обработкой батчей
    _connectWebSocket(key, url, onMessageHandler) {
        if (this.reconnectTimers.has(key)) clearTimeout(this.reconnectTimers.get(key));
        if (this.connections[key]) {
            try { this.connections[key].close(); } catch(e) {}
            this.connections[key] = null;
        }
        
        const ws = new WebSocket(url);
        ws.onopen = () => {
            console.log(`✅ PriceManager: ${key} подключён`);
            this.connections[key] = ws;
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                onMessageHandler(data);
            } catch(e) {}
        };
        
        ws.onclose = () => {
            console.log(`❌ ${key} закрыт, переподключение...`);
            this._reconnect(key, () => this._connectWebSocket(key, url, onMessageHandler));
        };
        
        ws.onerror = () => console.warn(`⚠️ ${key} ошибка`);
    }
    
    _reconnect(key, initFn) {
        if (this.reconnectTimers.has(key)) clearTimeout(this.reconnectTimers.get(key));
        this.reconnectTimers.set(key, setTimeout(() => initFn(), 3000));
    }
    
    // Установка цены с составным ключом
    _setPrice(symbol, price, exchange, marketType) {
        const compositeKey = `${symbol}:${exchange}:${marketType}`;
        const old = this.prices.get(compositeKey);
        // Фильтр: если изменение меньше 0.01% - можно пропустить (опционально)
        if (old && Math.abs(price - old.price) / old.price < 0.0001) return;
        
        this.prices.set(compositeKey, { price, time: Date.now(), exchange, marketType });
        
        // Оповещение подписчиков на этот точный ключ
        if (this.subscribers.has(compositeKey)) {
            const cbs = this.subscribers.get(compositeKey);
            for (let cb of cbs) {
                try { cb(price, symbol, exchange, marketType); } catch(e) {}
            }
        }
        
        // Для обратной совместимости – оповещаем подписчиков по старому ключу (только символ)
        if (this.subscribers.has(symbol)) {
            const cbs = this.subscribers.get(symbol);
            for (let cb of cbs) {
                try { cb(price, symbol, exchange, marketType); } catch(e) {}
            }
        }
    }
    
    // ========== ПУБЛИЧНЫЕ МЕТОДЫ ==========
    
    // Подписка на конкретный тикер (с биржей и типом рынка)
    subscribe(compositeKeyOrSymbol, callback, exchange = 'binance', marketType = 'futures') {
        let key;
        if (typeof compositeKeyOrSymbol === 'string' && compositeKeyOrSymbol.includes(':')) {
            // уже составной ключ
            key = compositeKeyOrSymbol;
        } else {
            // старый формат: только символ, используем переданные exchange/marketType
            key = `${compositeKeyOrSymbol}:${exchange}:${marketType}`;
        }
        
        if (!this.subscribers.has(key)) this.subscribers.set(key, []);
        this.subscribers.get(key).push(callback);
        
        // Если уже есть цена – вызываем сразу
        const cached = this.prices.get(key);
        if (cached) {
            setTimeout(() => {
                try { callback(cached.price, compositeKeyOrSymbol, exchange, marketType); } catch(e) {}
            }, 0);
        }
        
        // Динамическая подписка через WebSocket (если нужно подписаться на конкретный символ)
        this._ensureSubscription(key);
    }
    
    // Отписка
    unsubscribe(key, callback) {
        if (!this.subscribers.has(key)) return;
        const list = this.subscribers.get(key);
        const idx = list.indexOf(callback);
        if (idx !== -1) list.splice(idx, 1);
        if (list.length === 0) this.subscribers.delete(key);
    }
    
    // Получение цены по составному ключу или по символу + биржа + тип
    getPrice(symbol, exchange = null, marketType = null) {
        let key;
        if (exchange && marketType) {
            key = `${symbol}:${exchange}:${marketType}`;
        } else if (symbol.includes(':')) {
            key = symbol;
        } else {
            // дефолт – binance futures
            key = `${symbol}:binance:futures`;
        }
        const data = this.prices.get(key);
        return data ? data.price : null;
    }
    
    // REST-запрос цены (учитывает биржу)
    async fetchPrice(symbol, exchange = 'binance', marketType = 'futures') {
        if (!symbol) return null;
        try {
            let url;
            if (exchange === 'binance') {
                if (marketType === 'futures')
                    url = `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`;
                else
                    url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
            } else { // bybit
                const category = marketType === 'futures' ? 'linear' : 'spot';
                url = `https://api.bybit.com/v5/market/tickers?category=${category}&symbol=${symbol}`;
            }
            
            const response = await fetch(url);
            const data = await response.json();
            let price = null;
            if (exchange === 'binance') {
                price = parseFloat(data.price);
            } else {
                if (data.retCode === 0 && data.result?.list?.[0])
                    price = parseFloat(data.result.list[0].lastPrice);
            }
            if (price && !isNaN(price)) {
                this._setPrice(symbol, price, exchange, marketType);
                return price;
            }
        } catch(e) {
            console.warn(`Ошибка fetchPrice для ${symbol}:${exchange}:${marketType}`, e);
        }
        return null;
    }
    
    // Внутренняя динамическая подписка через WebSocket (пример для Bybit)
    _ensureSubscription(compositeKey) {
        const [symbol, exchange, marketType] = compositeKey.split(':');
        if (!symbol || !exchange || !marketType) return;
        
        if (exchange === 'bybit') {
            const wsKey = marketType === 'futures' ? 'bybit:linear' : 'bybit:spot';
            const ws = this.connections[wsKey];
            if (ws && ws.readyState === WebSocket.OPEN) {
                const topic = `tickers.${symbol}`;
                ws.send(JSON.stringify({ op: "subscribe", args: [topic] }));
            }
        }
        // Для Binance не требуется отдельная подписка, т.к. мы получаем все тикеры
    }
    
    close() {
        for (const [key, ws] of Object.entries(this.connections)) {
            if (ws) try { ws.close(); } catch(e) {}
        }
        for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
        this.reconnectTimers.clear();
        this.prices.clear();
        this.subscribers.clear();
    }
}

// Автоматическое создание глобального экземпляра
if (typeof window !== 'undefined') {
    window.PriceManager = PriceManager;
    if (!window.priceManagerInstance) {
        window.priceManagerInstance = new PriceManager();
        console.log('✅ PriceManager (раздельный) создан');
    }
}