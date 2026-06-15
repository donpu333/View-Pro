class WebSocketManager {
    constructor(chartManager) {
        this.chartManager = chartManager;
        this.wsKline = null;
        this.wsTrade = null;
        this.klineReconnectTimer = null;
        this.tradeReconnectTimer = null;
        this.currentSymbol = 'BTCUSDT';
        this.currentInterval = '1h';
        this.currentExchange = 'binance';
        this.currentMarketType = 'futures';
        this._destroyed = false;
        this._klineConnecting = false;
        this._tradeConnecting = false;
        // Уникальный ID для каждого соединения, чтобы отслеживать устаревшие
        this._klineConnectionId = 0;
        this._tradeConnectionId = 0;
    }

    connectKline(symbol, interval, exchange, marketType) {
        if (this._destroyed) return;

        // Нормализация параметров
        symbol = symbol || this.currentSymbol || 'BTCUSDT';
        exchange = exchange || this.currentExchange || 'binance';
        marketType = marketType || this.currentMarketType || 'futures';
        interval = interval || this.currentInterval || '1h';

        // Обновляем текущее состояние ДО создания соединения
        this.currentSymbol = symbol;
        this.currentInterval = interval;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;

        // Очищаем предыдущее соединение
        this._cleanupKline();

        // Защита от двойного коннекта
        if (this._klineConnecting) {
            console.warn('⚠️ Kline WS уже подключается');
            return;
        }
        this._klineConnecting = true;

        // Генерируем уникальный ID для этого соединения
        const connectionId = ++this._klineConnectionId;

        let wsUrl;
        if (exchange === 'bybit') {
            const category = (marketType === 'spot') ? 'spot' : 'linear';
            wsUrl = `wss://stream.bybit.com/v5/public/${category}`;
        } else {
            const baseUrl = marketType === 'spot' 
                ? 'wss://data-stream.binance.com/ws' 
                : 'wss://fstream.binance.com/ws';
            wsUrl = `${baseUrl}/${symbol.toLowerCase()}@kline_${interval}`;
        }

        const ws = new WebSocket(wsUrl);
        this.wsKline = ws;

        ws.onopen = () => {
            if (this._destroyed) { 
                this._safeClose(ws); 
                return; 
            }
            // Проверяем, что это актуальное соединение
            if (this.wsKline !== ws || this._klineConnectionId !== connectionId) {
                this._safeClose(ws);
                return;
            }
            console.log('✅ Kline WS открыт:', exchange, symbol, interval);
            this._klineConnecting = false;
            if (exchange === 'bybit') {
                ws.send(JSON.stringify({ op: 'subscribe', args: [`kline.${interval}.${symbol}`] }));
            }
        };

        ws.onmessage = (event) => {
            if (this._destroyed) return;
            try {
                // Проверяем актуальность соединения по ID
                if (this.wsKline !== ws || this._klineConnectionId !== connectionId) return;
                // Проверяем актуальность параметров
                if (this.currentSymbol !== symbol || this.currentInterval !== interval) return;

                const data = JSON.parse(event.data);
                let candle = null;

                if (exchange === 'bybit') {
                    if (data.topic?.startsWith('kline.') && data.data?.length) {
                        const k = data.data[0];
                        candle = {
                            time: Math.floor(k.start / 1000),
                            open: parseFloat(k.open),
                            high: parseFloat(k.high),
                            low: parseFloat(k.low),
                            close: parseFloat(k.close),
                            volume: parseFloat(k.volume),
                            isClosed: k.confirm || false
                        };
                    }
                } else {
                    const k = data.k;
                    if (k) {
                        candle = {
                            time: Math.floor(k.t / 1000),
                            open: parseFloat(k.o),
                            high: parseFloat(k.h),
                            low: parseFloat(k.l),
                            close: parseFloat(k.c),
                            volume: parseFloat(k.v),
                            isClosed: k.x || false
                        };
                    }
                }

                if (candle && this.chartManager && this.chartManager.currentSymbol === this.currentSymbol) {
                    this.chartManager.updateLastCandle(candle);
                }
            } catch(e) {
                console.warn('⚠️ Kline WS ошибка обработки:', e);
            }
        };

        ws.onclose = (event) => {
            // Всегда сбрасываем флаг коннекта для этого соединения
            if (this.wsKline === ws) {
                this._klineConnecting = false;
            }
            
            if (this._destroyed) return;
            
            // Проверяем, что это актуальное соединение и параметры не изменились
            if (this.wsKline !== ws || this._klineConnectionId !== connectionId) return;
            
            if (this.currentSymbol === symbol && this.currentInterval === interval && 
                this.currentExchange === exchange && this.currentMarketType === marketType) {
                console.log('❌ Kline WS закрыт, переподключение...', event.code);
                this.klineReconnectTimer = setTimeout(() => {
                    if (!this._destroyed) this.connectKline(symbol, interval, exchange, marketType);
                }, 3000);
            }
        };

        ws.onerror = (err) => {
            console.warn('⚠️ Kline WS ошибка:', err);
            if (this.wsKline === ws) {
                this._klineConnecting = false;
            }
        };
    }

    connectTrade(symbol, exchange, marketType) {
        if (this._destroyed) return;

        symbol = symbol || this.currentSymbol || 'BTCUSDT';
        exchange = exchange || this.currentExchange || 'binance';
        marketType = marketType || this.currentMarketType || 'futures';

        this.currentSymbol = symbol;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;

        this._cleanupTrade();

        if (this._tradeConnecting) {
            console.warn('⚠️ Trade WS уже подключается');
            return;
        }
        this._tradeConnecting = true;

        const connectionId = ++this._tradeConnectionId;

        let wsUrl;
        if (exchange === 'bybit') {
            const category = (marketType === 'spot') ? 'spot' : 'linear';
            wsUrl = `wss://stream.bybit.com/v5/public/${category}`;
        } else {
            const baseUrl = marketType === 'spot'
                ? 'wss://data-stream.binance.com/ws'
                : 'wss://fstream.binance.com/ws';
            wsUrl = `${baseUrl}/${symbol.toLowerCase()}@aggTrade`;
        }

        const ws = new WebSocket(wsUrl);
        this.wsTrade = ws;

        ws.onopen = () => {
            if (this._destroyed) { 
                this._safeClose(ws); 
                return; 
            }
            if (this.wsTrade !== ws || this._tradeConnectionId !== connectionId) {
                this._safeClose(ws);
                return;
            }
            console.log('✅ Trade WS открыт:', exchange, symbol);
            this._tradeConnecting = false;
            if (exchange === 'bybit') {
                ws.send(JSON.stringify({ op: 'subscribe', args: [`publicTrade.${symbol}`] }));
            }
        };

        ws.onmessage = (event) => {
            if (this._destroyed) return;
            try {
                if (this.wsTrade !== ws || this._tradeConnectionId !== connectionId) return;
                if (this.currentSymbol !== symbol) return;
                
                const data = JSON.parse(event.data);
                let price = null;

                if (exchange === 'bybit') {
                    if (data.topic?.startsWith('publicTrade.') && data.data?.length) {
                        price = parseFloat(data.data[0].p);
                    }
                } else {
                    price = parseFloat(data.p);
                }

                if (price && this.chartManager && this.chartManager.currentSymbol === this.currentSymbol) {
                    this.chartManager._syncPriceLine?.(price);
                }
            } catch(e) {
                console.warn('⚠️ Trade WS ошибка обработки:', e);
            }
        };

        ws.onclose = (event) => {
            if (this.wsTrade === ws) {
                this._tradeConnecting = false;
            }
            
            if (this._destroyed) return;
            
            if (this.wsTrade !== ws || this._tradeConnectionId !== connectionId) return;
            
            if (this.currentSymbol === symbol && this.currentExchange === exchange && this.currentMarketType === marketType) {
                console.log('❌ Trade WS закрыт, переподключение...', event.code);
                this.tradeReconnectTimer = setTimeout(() => {
                    if (!this._destroyed) this.connectTrade(symbol, exchange, marketType);
                }, 3000);
            }
        };

        ws.onerror = (err) => {
            console.warn('⚠️ Trade WS ошибка:', err);
            if (this.wsTrade === ws) {
                this._tradeConnecting = false;
            }
        };
    }

    // Безопасное закрытие без вызова onclose
    _safeClose(ws) {
        if (!ws) return;
        const oldOnClose = ws.onclose;
        ws.onclose = null;
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            try { ws.close(); } catch(e) {}
        }
        // Восстанавливаем onclose для очистки, но без логики реконнекта
        if (oldOnClose) {
            try { oldOnClose({ code: 1000, reason: 'destroyed' }); } catch(e) {}
        }
    }

    _cleanupKline() {
        if (this.klineReconnectTimer) {
            clearTimeout(this.klineReconnectTimer);
            this.klineReconnectTimer = null;
        }
        if (this.wsKline) {
            const oldWs = this.wsKline;
            this.wsKline = null;
            this._safeClose(oldWs);
        }
        this._klineConnecting = false;
    }

    _cleanupTrade() {
        if (this.tradeReconnectTimer) {
            clearTimeout(this.tradeReconnectTimer);
            this.tradeReconnectTimer = null;
        }
        if (this.wsTrade) {
            const oldWs = this.wsTrade;
            this.wsTrade = null;
            this._safeClose(oldWs);
        }
        this._tradeConnecting = false;
    }

    updateSymbolAndTimeframe(symbol, interval, exchange, marketType) {
        // Обновляем все текущие параметры ДО вызова connect
        this.currentSymbol = symbol || this.currentSymbol;
        this.currentInterval = interval || this.currentInterval;
        this.currentExchange = exchange || this.currentExchange;
        this.currentMarketType = marketType || this.currentMarketType;

        // Передаём уже обновленные значения
        this.connectKline(this.currentSymbol, this.currentInterval, this.currentExchange, this.currentMarketType);
        this.connectTrade(this.currentSymbol, this.currentExchange, this.currentMarketType);
    }

    closeAll() {
        this._cleanupKline();
        this._cleanupTrade();
    }

    destroy() {
        console.log('🗑️ WebSocketManager: уничтожение...');
        this._destroyed = true;
        this.closeAll();
        this.chartManager = null;
        console.log('✅ WebSocketManager: уничтожен');
    }
}

if (typeof window !== 'undefined') window.WebSocketManager = WebSocketManager;
