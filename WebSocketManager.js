class WebSocketManager {
    constructor(chartManager) {
        this.chartManager = chartManager;
        this.wsKline = null;
        this.klineReconnectTimer = null;
        this.currentSymbol = 'BTCUSDT';
        this.currentInterval = '1h';
        this.currentExchange = 'binance';
    }

      connectKline(symbol, interval, exchange, marketType) {
        if (!symbol) {
            console.warn('❌ WebSocket: symbol is undefined, сохраняем старый');
            symbol = this.currentSymbol || 'BTCUSDT';
        }
        if (!exchange) exchange = this.currentExchange || 'binance';
        
        if (this.klineReconnectTimer) { 
            clearTimeout(this.klineReconnectTimer); 
            this.klineReconnectTimer = null; 
        }
        if (this.wsKline) {
            this.wsKline.onclose = null; 
            this.wsKline.onerror = null; 
            this.wsKline.onmessage = null;
            if (this.wsKline.readyState === WebSocket.OPEN || this.wsKline.readyState === WebSocket.CONNECTING) {
                this.wsKline.close();
            }
            this.wsKline = null;
        }

        this.currentSymbol = symbol;
        this.currentInterval = interval;
        this.currentExchange = exchange;
        
        // ИСПРАВЛЕНИЕ 1: Сбрасываем старую цену! Таймер перестанет рисовать призраков.
     

        let wsUrl;
        if (exchange === 'bybit') {
            const category = marketType === 'spot' ? 'spot' : 'linear';
            wsUrl = `wss://stream.bybit.com/v5/public/${category}`;
        } else {
            wsUrl = (exchange === 'binance' && marketType === 'spot')
                ? `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@trade`
                : `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@trade`;
        }

        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('✅ Trade (свечи) открыт:', exchange);
            this.wsKline = ws; 
            if (exchange === 'bybit') {
                ws.send(JSON.stringify({
                    op: 'subscribe',
                    args: [`publicTrade.${symbol}`]
                }));
            }
        };
        
ws.onmessage = (event) => {
    try {
        if (symbol !== this.currentSymbol) return;
        
        const data = JSON.parse(event.data);
        let price = null;
        
        if (exchange === 'bybit') {
            if (data.topic?.startsWith('publicTrade.') && data.data?.length) {
                price = parseFloat(data.data[0].p);
            }
        } else {
            price = parseFloat(data.p);
        }
        
        if (!price || !this.chartManager?.chartData?.length) return;
        if (this.chartManager.currentSymbol !== symbol) return;
        
        // ✅ ТОЛЬКО ОБНОВЛЯЕМ ЦЕНУ — свечи не трогаем
        if (this.chartManager._syncPriceLine) {
            this.chartManager._syncPriceLine(price);
        }
        
    } catch(e) {}
};
        ws.onclose = () => {
            console.log('❌ Trade WebSocket закрыт, переподключение...');
            if (this.currentSymbol === symbol) {
                this.klineReconnectTimer = setTimeout(() => 
                    this.connectKline(symbol, interval, exchange, marketType), 3000
                );
            }
        };
        
        ws.onerror = () => {};
    }
    
    updateSymbolAndTimeframe(symbol, interval, exchange, marketType) {
        this.connectKline(symbol, interval, exchange, marketType);
    }

    closeAll() {
        if (this.wsKline) {
            try { this.wsKline.close(); } catch(e) {}
            this.wsKline = null;
        }
        if (this.klineReconnectTimer) clearTimeout(this.klineReconnectTimer);
    }
}

if (typeof window !== 'undefined') window.WebSocketManager = WebSocketManager; 
