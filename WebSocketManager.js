class WebSocketManager {
    constructor(chartManager) {
        this.chartManager = chartManager;
        // Единое WebSocket-соединение (вместо wsKline + wsTrade)
        this.ws = null;
        this.reconnectTimer = null;
        this.pingInterval = null;
        this.currentSymbol = 'BTCUSDT';
        this.currentInterval = '1h';
        this.currentExchange = 'binance';
        this.currentMarketType = 'futures';
        this.retryCount = 0;

        // Список символов, которых нет на фьючерсах Binance (только спот/индексы)
        this.binanceSpotOnlyTokens = ['BTCDOMUSDT', 'DEFIUSDT', 'ALTUSDT', 'NFTUSDT', 'TOPCOINSUSDT'];
    }

    // ========== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ==========
    getExchangeInterval(interval, exchange) {
        if (exchange === 'bybit') {
            const map = {
                '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
                '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
                '1d': 'D', '1D': 'D', '1w': 'W', '1W': 'W', '1M': 'M'
            };
            return map[interval] || interval;
        }
        return interval;
    }

    formatSymbol(symbol, exchange) {
        const cleanSymbol = symbol.trim();
        return exchange === 'bybit' ? cleanSymbol.toUpperCase() : cleanSymbol.toLowerCase();
    }

    // ========== ГЛАВНЫЙ МЕТОД ПОДКЛЮЧЕНИЯ (комбинированный) ==========
    connect(symbol, interval, exchange, marketType) {
        // Нормализация параметров
        if (!symbol) symbol = this.currentSymbol || 'BTCUSDT';
        if (!exchange) exchange = this.currentExchange || 'binance';
        if (!marketType) marketType = this.currentMarketType || 'futures';
        if (!interval) interval = this.currentInterval || '1h';

        symbol = symbol.trim();
        interval = interval.trim().toLowerCase();

        // Автопереключение на спот для символов, отсутствующих на фьючерсах
        if (exchange === 'binance' && marketType === 'futures' && this.binanceSpotOnlyTokens.includes(symbol.toUpperCase())) {
            console.warn(`⚠️ Символ ${symbol} недоступен на фьючерсах Binance. Автопереключение на SPOT.`);
            marketType = 'spot';
            this.currentMarketType = 'spot';
        }

        // Сохраняем текущие параметры
        this.currentSymbol = symbol;
        this.currentInterval = interval;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;

        // Закрываем старые таймеры и сокет
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.onmessage = null;
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close();
            }
            this.ws = null;
        }

        // Формируем URL
        let wsUrl;
        const formattedSymbol = this.formatSymbol(symbol, exchange);

        if (exchange === 'binance') {
            // Комбинированный поток для Binance
            const baseUrl = marketType === 'spot'
                ? 'wss://data-stream.binance.com/stream'
                : 'wss://fstream.binance.com/stream';
            const streams = `${formattedSymbol}@kline_${interval}/${formattedSymbol}@trade`;
            wsUrl = `${baseUrl}?streams=${streams}`;
        } else if (exchange === 'bybit') {
            // Bybit – одно соединение, подписка на несколько каналов
            const category = (marketType === 'spot') ? 'spot' : (marketType === 'futures' || marketType === 'linear') ? 'linear' : marketType;
            wsUrl = `wss://stream.bybit.com/v5/public/${category}`;
        } else {
            // fallback – используем старый формат (для других бирж, но таких нет)
            wsUrl = `wss://${exchange}.com/ws`;
        }

        console.log(`🔌 Подключаюсь к комбинированному WS: ${wsUrl}`);
        const ws = new WebSocket(wsUrl);
        this.ws = ws;
        this.retryCount = 0;

        const self = this;

        ws.onopen = () => {
            console.log(`✅ Комбинированный WS открыт: ${exchange} ${symbol} (${marketType}) ${interval}`);
            if (exchange === 'bybit') {
                // Подписываемся на оба канала одним сообщением
                const bybitInterval = self.getExchangeInterval(interval, exchange);
                const bybitSymbol = self.formatSymbol(symbol, exchange);
                const args = [
                    `kline.${bybitInterval}.${bybitSymbol}`,
                    `publicTrade.${bybitSymbol}`
                ];
                ws.send(JSON.stringify({ op: 'subscribe', args: args }));

                // Bybit требует периодический ping
                self.pingInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        try { ws.send(JSON.stringify({ op: 'ping' })); } catch(e) {}
                    }
                }, 20000);
            }
            // Для Binance ping/pong обрабатывается автоматически, дополнительных действий не нужно
        };

        // ========== ЕДИНЫЙ ОБРАБОТЧИК СООБЩЕНИЙ ==========
        ws.onmessage = (event) => {
            try {
                if (symbol !== self.currentSymbol) return;
                const raw = JSON.parse(event.data);

                // Обработка pong (для Bybit)
                if (raw.op === 'pong') return;

                // ----- ОБРАБОТКА BINANCE (комбинированный поток) -----
                if (exchange === 'binance') {
                    // В комбинированном потоке сообщение содержит поле stream
                    if (raw.stream) {
                        const streamName = raw.stream;
                        const payload = raw.data; // сами данные
                        if (streamName.includes('@kline')) {
                            // Это свеча
                            self._handleBinanceKline(payload, symbol);
                        } else if (streamName.includes('@trade')) {
                            // Это сделка
                            self._handleBinanceTrade(payload, symbol);
                        }
                    }
                }

                // ----- ОБРАБОТКА BYBIT -----
                else if (exchange === 'bybit') {
                    if (raw.topic) {
                        if (raw.topic.startsWith('kline.')) {
                            // Свеча
                            self._handleBybitKline(raw, symbol);
                        } else if (raw.topic.startsWith('publicTrade.')) {
                            // Сделка
                            self._handleBybitTrade(raw, symbol);
                        }
                    }
                }
            } catch(e) {
                console.warn('⚠️ Ошибка обработки WS сообщения:', e);
            }
        };

        // ========== ОБРАБОТКА ЗАКРЫТИЯ ==========
        ws.onclose = (event) => {
            if (self.pingInterval) { clearInterval(self.pingInterval); self.pingInterval = null; }
            if (self.currentSymbol !== symbol || self.currentInterval !== interval) return;

            if (event.code === 1000) return; // штатное закрытие

            // При 1008 пробуем переключиться на спот (если символ в списке) или просто выходим
            if (event.code === 1008) {
                if (exchange === 'binance' && marketType === 'futures') {
                    // Если символ в списке спотовых – переключаемся
                    if (self.binanceSpotOnlyTokens.includes(symbol.toUpperCase())) {
                        console.warn(`⚠️ 1008: ${symbol} не найден на фьючерсах. Переключение на SPOT.`);
                        self.currentMarketType = 'spot';
                        self.connect(symbol, interval, exchange, 'spot');
                        return;
                    }
                }
                console.error(`🚫 WS 1008: Символ ${symbol} не найден на ${exchange} (${marketType}).`);
                return;
            }

            // Реконнект с экспоненциальной задержкой
            self.retryCount++;
            const delay = Math.min(3000 * Math.pow(2, self.retryCount - 1), 30000);
            console.warn(`❌ WS ОБРЫВ (Код: ${event.code}). Переподключение через ${delay/1000}с...`);
            self.reconnectTimer = setTimeout(() => {
                self.connect(symbol, interval, exchange, marketType);
            }, delay);
        };

        ws.onerror = (error) => {
            console.error('💥 WS Ошибка:', error.type || error);
        };
    }

    // ========== ОБРАБОТЧИКИ ДАННЫХ (вынесены для чистоты) ==========

    _handleBinanceKline(payload, symbol) {
        const k = payload.k;
        if (!k) return;
        const cm = this.chartManager;
        if (!cm || cm.currentSymbol !== symbol) return;

        const candleTime = Math.floor(k.t / 1000);
        const lastCandle = cm.chartData?.[cm.chartData.length - 1];

        // Добавляем новую свечу, если время изменилось
        if (lastCandle && candleTime > lastCandle.time) {
            const exists = cm.chartData.some(c => c.time === candleTime);
            if (!exists) {
                const newCandle = {
                    time: candleTime,
                    open: parseFloat(k.o),
                    high: parseFloat(k.h),
                    low: parseFloat(k.l),
                    close: parseFloat(k.c),
                    volume: parseFloat(k.v)
                };
                cm.chartData.push(newCandle);
                cm.lastCandle = newCandle;

                const series = cm.currentChartType === 'candle' ? cm.candleSeries : cm.barSeries;
                if (series) series.setData(cm.chartData);

                if (cm.volumeSeries) {
                    const volData = cm.chartData.map(c => ({
                        time: c.time,
                        value: c.volume || 0,
                        color: c.close >= c.open ? cm.bullishColor : cm.bearishColor
                    }));
                    cm.volumeSeries.setData(volData);
                }

                if (cm.timerManager) cm.timerManager.start(this.currentInterval);
            }
        }

        // Обновляем последнюю свечу (даже если та же)
        const candle = {
            time: candleTime,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v)
        };
        cm.updateLastCandle(candle);
    }

    _handleBinanceTrade(payload, symbol) {
        const price = parseFloat(payload.p);
        if (isNaN(price)) return;
        const cm = this.chartManager;
        if (cm && cm.currentSymbol === symbol && cm._syncPriceLine) {
            cm._syncPriceLine(price);
        }
    }

    _handleBybitKline(data, symbol) {
        if (!data.data?.length) return;
        const k = data.data[0];
        const candle = {
            time: Math.floor(k.start / 1000),
            open: parseFloat(k.open),
            high: parseFloat(k.high),
            low: parseFloat(k.low),
            close: parseFloat(k.close),
            volume: parseFloat(k.volume)
        };
        const cm = this.chartManager;
        if (cm && cm.currentSymbol === symbol) {
            cm.updateLastCandle(candle);
        }
    }

    _handleBybitTrade(data, symbol) {
        if (!data.data?.length) return;
        const price = parseFloat(data.data[0].p);
        if (isNaN(price)) return;
        const cm = this.chartManager;
        if (cm && cm.currentSymbol === symbol && cm._syncPriceLine) {
            cm._syncPriceLine(price);
        }
    }

    // ========== ОБНОВЛЕНИЕ СИМВОЛА/ТАЙМФРЕЙМА ==========
    updateSymbolAndTimeframe(symbol, interval, exchange, marketType) {
        // Просто переподключаемся с новыми параметрами
        this.connect(symbol, interval, exchange, marketType);
    }

    // ========== ЗАКРЫТИЕ ВСЕХ СОЕДИНЕНИЙ ==========
    closeAll() {
        if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        if (this.ws) {
            this.ws.onclose = null;
            try { this.ws.close(); } catch(e) {}
            this.ws = null;
        }
    }
}

if (typeof window !== 'undefined') window.WebSocketManager = WebSocketManager;
