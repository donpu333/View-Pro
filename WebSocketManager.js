class WebSocketManager {
    constructor(chartManager) {
        this.chartManager = chartManager;
        this.worker = null;
        this.pingInterval = null;
        this.reconnectTimer = null;
        this.retryCount = 0;
        this.isConnected = false;
        
        this.currentSymbol = 'BTCUSDT';
        this.currentInterval = '1h';
        this.currentExchange = 'binance';
        this.currentMarketType = 'futures';
        
        this.binanceSpotOnlyTokens = ['BTCDOMUSDT', 'DEFIUSDT', 'ALTUSDT', 'NFTUSDT', 'TOPCOINSUSDT'];
        
        this._initWorker();
    }

    _initWorker() {
        const workerCode = [
            "var ws=null;",
            "var pingInterval=null;",
            "var currentUrl=null;",
            "var reconnectAttempts=0;",
            "var maxReconnectDelay=30000;",
            "",
            "function scheduleReconnect(d){",
            "    setTimeout(function(){",
            "        if(currentUrl)openSocket(currentUrl);",
            "    },d);",
            "}",
            "",
            "function openSocket(url){",
            "    if(ws){",
            "        try{ws.onclose=null;ws.close(1000)}catch(e){}",
            "        ws=null;",
            "    }",
            "    try{",
            "        ws=new WebSocket(url);",
            "    }catch(e){",
            "        self.postMessage({type:'error',error:'Failed: '+e.message});",
            "        scheduleReconnect(3000);",
            "        return;",
            "    }",
            "    ws.onopen=function(){",
            "        reconnectAttempts=0;",
            "        self.postMessage({type:'open'});",
            "        if(url.indexOf('bybit')!==-1){",
            "            clearInterval(pingInterval);",
            "            pingInterval=setInterval(function(){",
            "                if(ws&&ws.readyState===WebSocket.OPEN){",
            "                    try{ws.send(JSON.stringify({op:'ping'}))}catch(e){}",
            "                }",
            "            },20000);",
            "        }",
            "    };",
            "    ws.onmessage=function(e){",
            "        self.postMessage({type:'message',data:e.data});",
            "    };",
            "    ws.onclose=function(e){",
            "        clearInterval(pingInterval);",
            "        ws=null;",
            "        if(e.code===1000||e.code===1008){",
            "            self.postMessage({type:'close',code:e.code,reason:e.reason||'Normal'});",
            "            return;",
            "        }",
            "        reconnectAttempts++;",
            "        var d=Math.min(3000*Math.pow(2,reconnectAttempts-1),maxReconnectDelay);",
            "        scheduleReconnect(d);",
            "    };",
            "    ws.onerror=function(){};",
            "}",
            "",
            "self.onmessage=function(e){",
            "    var m=e.data;",
            "    if(m.type==='connect'){",
            "        currentUrl=m.url;",
            "        reconnectAttempts=0;",
            "        openSocket(currentUrl);",
            "    }else if(m.type==='send'){",
            "        if(ws&&ws.readyState===WebSocket.OPEN)ws.send(m.data);",
            "    }else if(m.type==='close'){",
            "        currentUrl=null;",
            "        clearInterval(pingInterval);",
            "        if(ws){",
            "            ws.onclose=null;",
            "            ws.close(1000,'User disconnect');",
            "            ws=null;",
            "        }",
            "    }",
            "};"
        ].join('\n');

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        this.worker = new Worker(workerUrl);
        URL.revokeObjectURL(workerUrl);
        
        const self = this;
        
        this.worker.onmessage = function(event) {
            const msg = event.data;
            
            if (msg.type === 'open') {
                self.isConnected = true;
                if (self.currentExchange === 'bybit') {
                    const bi = self.getExchangeInterval(self.currentInterval, self.currentExchange);
                    const bs = self.formatSymbol(self.currentSymbol, self.currentExchange);
                    self.worker.postMessage({ type: 'send', data: JSON.stringify({ op: 'subscribe', args: ['kline.' + bi + '.' + bs, 'publicTrade.' + bs] }) });
                }
            }
            else if (msg.type === 'message') {
                try {
                    const raw = JSON.parse(msg.data);
                    if (raw.op === 'pong') return;
                    
                    if (self.currentExchange === 'binance' && raw.stream) {
                        const msgSymbol = (raw.data && raw.data.s) ? raw.data.s.toUpperCase() : null;
                        if (!msgSymbol || msgSymbol !== self.currentSymbol.toUpperCase()) return;
                        const p = raw.data;
                        if (raw.stream.includes('@kline')) {
                            self._sendToChart(p, 'binance');
                        } else if (raw.stream.includes('@trade')) {
                            self._sendTradeToChart(parseFloat(p.p));
                        }
                    }
                    else if (self.currentExchange === 'bybit' && raw.topic) {
                        const parts = raw.topic.split('.');
                        let msgSymbol = null;
                        if (raw.topic.startsWith('kline.') && parts.length >= 3) msgSymbol = parts[2].toUpperCase();
                        else if (raw.topic.startsWith('publicTrade.') && parts.length >= 2) msgSymbol = parts[1].toUpperCase();
                        if (!msgSymbol || msgSymbol !== self.currentSymbol.toUpperCase()) return;
                        
                        if (raw.topic.startsWith('kline.')) {
                            self._sendToChart(raw, 'bybit');
                        } else if (raw.topic.startsWith('publicTrade.')) {
                            self._sendTradeToChart(parseFloat(raw.data[0].p));
                        }
                    }
                } catch(e) {}
            }
            else if (msg.type === 'close') {
                self.isConnected = false;
                if (self.pingInterval) { clearInterval(self.pingInterval); self.pingInterval = null; }
                if (msg.code === 1000) return;
                if (msg.code === 1008) {
                    if (self.currentExchange === 'binance' && self.currentMarketType === 'futures' && self.binanceSpotOnlyTokens.includes(self.currentSymbol.toUpperCase())) {
                        self.currentMarketType = 'spot';
                        self.connect(self.currentSymbol, self.currentInterval, self.currentExchange, 'spot');
                    }
                    return;
                }
                self.retryCount++;
                const delay = Math.min(3000 * Math.pow(2, self.retryCount - 1), 30000);
                self.reconnectTimer = setTimeout(function() { self.connect(self.currentSymbol, self.currentInterval, self.currentExchange, self.currentMarketType) }, delay);
            }
        };
    }

    _sendToChart(data, exchange) {
        const cm = this.chartManager;
        if (!cm) return;
        
        let candle;
        if (exchange === 'binance') {
            const k = data.k;
            if (!k) return;
            candle = { time: Math.floor(k.t / 1000), open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c), volume: parseFloat(k.v) };
        } else {
            if (!data.data || !data.data.length) return;
            const k = data.data[0];
            candle = { time: Math.floor(k.start / 1000), open: parseFloat(k.open), high: parseFloat(k.high), low: parseFloat(k.low), close: parseFloat(k.close), volume: parseFloat(k.volume) };
        }
        
        cm.updateLastCandle(candle);
    }

    _sendTradeToChart(price) {
        if (isNaN(price)) return;
        const cm = this.chartManager;
        if (cm && cm._syncPriceLine) cm._syncPriceLine(price);
    }

    getExchangeInterval(interval, exchange) {
        if (exchange === 'bybit') { const m = { '1m':'1','3m':'3','5m':'5','15m':'15','30m':'30','1h':'60','2h':'120','4h':'240','6h':'360','12h':'720','1d':'D','1w':'W','1M':'M' }; return m[interval] || interval; }
        return interval;
    }

    formatSymbol(symbol, exchange) { return exchange === 'bybit' ? symbol.trim().toUpperCase() : symbol.trim().toLowerCase(); }

    connect(symbol, interval, exchange, marketType) {
        symbol = symbol || this.currentSymbol;
        exchange = exchange || this.currentExchange;
        marketType = marketType || this.currentMarketType;
        interval = (interval || this.currentInterval).trim().toLowerCase();
        if (exchange === 'binance' && marketType === 'futures' && this.binanceSpotOnlyTokens.includes(symbol.toUpperCase())) marketType = 'spot';
        
        this.currentSymbol = symbol;
        this.currentInterval = interval;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;
        this.retryCount = 0;
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        
        const fs = this.formatSymbol(symbol, exchange);
        let wsUrl;
        if (exchange === 'binance') wsUrl = (marketType === 'spot' ? 'wss://data-stream.binance.com/stream' : 'wss://fstream.binance.com/stream') + '?streams=' + fs + '@kline_' + interval + '/' + fs + '@trade';
        else wsUrl = 'wss://stream.bybit.com/v5/public/' + (marketType === 'spot' ? 'spot' : 'linear');
        
        if (!this.worker) this._initWorker();
        this.worker.postMessage({ type: 'connect', url: wsUrl });
    }

    updateSymbolAndTimeframe(symbol, interval, exchange, marketType) { this.connect(symbol, interval, exchange, marketType); }
    
    closeAll() {
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        if (this.worker) this.worker.postMessage({ type: 'close' });
    }
}

if (typeof window !== 'undefined') window.WebSocketManager = WebSocketManager;
