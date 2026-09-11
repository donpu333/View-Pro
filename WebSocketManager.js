class WebSocketManager {
    constructor(chartManager) {
        this.chartManager = chartManager;
        this.wsKline = null;
        this.wsTrade = null;
        this.reconnectTimer = null;
        this.retryCount = 0;
        this.isConnected = false;
        this.isConnecting = false;
        this._connectGeneration = 0;
        this._lastKlineTime = 0;
        this._lastMessageTime = 0;
        this._lastRelevantMessageTime = 0;
        this._connectDebounceTimer = null;
        this._statusCheckInterval = null;

        // ФИКС: набор интервалов, по которым уже предупреждали о несовпадении
        // выравнивания — чтобы не спамить в консоль на каждом сообщении.
        this._warnedAlign = new Set();

        this.currentSymbol = 'BTCUSDT';
        this.currentInterval = '1h';
        this.currentExchange = 'binance';
        this.currentMarketType = 'futures';

        this.binanceSpotOnlyTokens = ['BTCDOMUSDT', 'DEFIUSDT', 'ALTUSDT', 'NFTUSDT', 'TOPCOINSUSDT'];

        this._visibilityHandler = () => {
            if (!document.hidden) {
                this._onTabVisible();
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);

        this._statusCheckInterval = setInterval(() => {
            if (this.isConnected && this._lastRelevantMessageTime &&
                (Date.now() - this._lastRelevantMessageTime > 30000)) {
                console.warn('⚠️ Нет данных 30 сек, проверяем соединение');
                this.ensureConnected();
            }
        }, 15000);

        setTimeout(() => this._autoConnect(), 1000);
    }

    _autoConnect() {
        console.log('🚀 WebSocketManager: автоподключение...');
        this.connect(this.currentSymbol, this.currentInterval, this.currentExchange, this.currentMarketType);
    }

    getExchangeInterval(interval, exchange) {
        if (exchange === 'bybit') {
            const map = {
                '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
                '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
                '1d': 'D', '1w': 'W', '1M': 'M'
            };
            return map[interval] || interval;
        }
        return interval;
    }

    formatSymbol(symbol, exchange) {
        return exchange === 'bybit' ? symbol.trim().toUpperCase() : symbol.trim().toLowerCase();
    }

    connect(symbol, interval, exchange, marketType) {
        symbol = (symbol || this.currentSymbol).trim();
        exchange = exchange || this.currentExchange;
        marketType = marketType || this.currentMarketType;
        interval = (interval || this.currentInterval).trim().toLowerCase();

        if (exchange === 'binance' && marketType === 'futures' &&
            this.binanceSpotOnlyTokens.includes(symbol.toUpperCase())) {
            marketType = 'spot';
        }

        this.currentSymbol = symbol;
        this.currentInterval = interval;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;
        this.retryCount = 0;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this._connectDebounceTimer) {
            clearTimeout(this._connectDebounceTimer);
        }

        this._connectDebounceTimer = setTimeout(() => {
            this._doConnect();
        }, 100);
    }

    _doConnect() {
        const generation = ++this._connectGeneration;
        this.isConnecting = true;

        this._closeSocket();

        // ФИКС: снимок целевых параметров ИМЕННО в момент реального открытия
        // сокета. Раньше сообщения фильтровались по мутирующимся
        // this.currentSymbol/this.currentInterval, которые уже обновляются
        // синхронно в connect(), ДО того как _doConnect() реально выполнится
        // (100мс дебаунс) — то есть пока старый сокет ещё жив и шлёт данные
        // старого таймфрейма/тикера, они трактовались как данные нового.
        // Теперь у каждого сокета есть собственный неизменяемый контекст
        // подписки, по которому и фильтруются его сообщения.
        const subContext = {
            symbol: this.currentSymbol,
            interval: this.currentInterval,
            exchange: this.currentExchange,
            marketType: this.currentMarketType
        };

        const fs = this.formatSymbol(subContext.symbol, subContext.exchange);

        if (subContext.exchange === 'binance') {
            const klineUrl = `wss://fstream.binance.com/market/ws/${fs}@kline_${subContext.interval}`;
            const tradeUrl = `wss://fstream.binance.com/market/ws/${fs}@aggTrade`;

            console.log('🔌 KLINE:', klineUrl);
            console.log('🔌 TRADE:', tradeUrl);

            this.wsKline = this._createWebSocket(klineUrl, 'kline', generation, subContext);
            this.wsTrade = this._createWebSocket(tradeUrl, 'trade', generation, subContext);
        } else if (subContext.exchange === 'bybit') {
            const wsUrl = 'wss://stream.bybit.com/v5/public/' + (subContext.marketType === 'spot' ? 'spot' : 'linear');
            console.log('🔌 Bybit:', wsUrl);
            this.wsKline = this._createWebSocket(wsUrl, 'bybit', generation, subContext);
            this.wsTrade = this.wsKline;
        }
    }

    _createWebSocket(url, type, generation, subContext) {
        let ws;
        try {
            ws = new WebSocket(url);
        } catch (e) {
            console.error(`❌ Ошибка создания ${type} WebSocket:`, e);
            if (generation === this._connectGeneration) this.isConnecting = false;
            this._scheduleReconnect(3000);
            return null;
        }

        ws._type = type;
        ws._generation = generation;
        // ФИКС: контекст подписки "приклеен" к сокету — используется при
        // обработке КАЖДОГО его сообщения, независимо от того, что успело
        // измениться в this.currentSymbol/this.currentInterval за это время.
        ws._subContext = subContext;

        ws.onopen = () => {
            if (generation !== this._connectGeneration) return;

            console.log(`✅ ${type.toUpperCase()} WebSocket подключён`);

            if (type === 'bybit') {
                const bi = this.getExchangeInterval(subContext.interval, subContext.exchange);
                const bs = this.formatSymbol(subContext.symbol, subContext.exchange);
                ws.send(JSON.stringify({
                    op: 'subscribe',
                    args: ['kline.' + bi + '.' + bs, 'publicTrade.' + bs]
                }));

                clearInterval(ws._pingInterval);
                ws._pingInterval = setInterval(() => {
                    if (generation !== this._connectGeneration) {
                        clearInterval(ws._pingInterval);
                        return;
                    }
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        try { ws.send(JSON.stringify({ op: 'ping' })); } catch(e) {}
                    }
                }, 20000);
            }

            const klineOk = this.wsKline && this.wsKline.readyState === WebSocket.OPEN;
            const tradeOk = this.wsTrade && this.wsTrade.readyState === WebSocket.OPEN;

            if (klineOk && tradeOk && !this.isConnected) {
                this.isConnected = true;
                this.isConnecting = false;
                this.retryCount = 0;
                console.log('✅ Оба WebSocket подключены');

                if (this.chartManager && this.chartManager.onWebSocketConnected) {
                    this.chartManager.onWebSocketConnected();
                }
            }
        };

        ws.onmessage = (event) => {
            if (generation !== this._connectGeneration) return;
            this._lastMessageTime = Date.now();
            this._handleMessage(event.data, type, subContext);
        };

        ws.onclose = (event) => {
            if (generation !== this._connectGeneration) return;

            console.log(`🔌 ${type.toUpperCase()} WebSocket закрыт:`, event.code, event.reason);
            this.isConnected = false;
            this.isConnecting = false;

            if (event.code === 1000 || event.code === 1005 || event.code === 1006) {
                return;
            }

            if (event.code === 1008) {
                if (this.currentExchange === 'binance' &&
                    this.currentMarketType === 'futures' &&
                    this.binanceSpotOnlyTokens.includes(this.currentSymbol.toUpperCase())) {
                    this.currentMarketType = 'spot';
                    this._scheduleReconnect(500);
                }
                return;
            }

            this._scheduleReconnect();
        };

        ws.onerror = (error) => {
            if (generation !== this._connectGeneration) return;
            if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
                console.error(`❌ ${type.toUpperCase()} WebSocket ошибка:`, error);
            }
        };

        return ws;
    }

    _handleMessage(rawData, type, subContext) {
        try {
            const raw = JSON.parse(rawData);

            if (raw.op === 'pong' || raw.op === 'subscribe') return;

            const chartManager = this.chartManager || window.chartManager;

            if (!chartManager) {
                console.warn('⚠️ chartManager не найден');
                return;
            }

            // Защита от вызова без контекста подписки (не должно происходить,
            // но лучше явно отбросить сообщение, чем обработать его "вслепую").
            if (!subContext) return;

            if (subContext.exchange === 'binance') {
                if (raw.e === 'kline' && raw.k) {
                    const k = raw.k;
                    const msgSymbol = raw.s ? raw.s.toUpperCase() : null;
                    if (msgSymbol && msgSymbol !== subContext.symbol.toUpperCase()) return;

                    // ФИКС: сверяем интервал СВЕЧИ из сообщения с интервалом,
                    // на который подписан именно этот сокет. Раньше такой
                    // проверки не было вовсе — при быстрой смене таймфрейма
                    // ещё не закрытый старый сокет "1m" мог прислать данные,
                    // которые пересчитывались как данные нового интервала "1h"
                    // (candleTime заново выравнивался по чужому шагу) —
                    // отсюда битые/скачущие свечи сразу после переключения.
                    if (k.i && k.i !== subContext.interval) return;

                    this._lastRelevantMessageTime = Date.now();

                    let candleTime = Math.floor(k.t / 1000);

                    // ФИКС: календарное выравнивание вместо
                    // Math.floor(t / step) * step.
                    //
                    // Старая формула работала только для ТФ, кратных суткам,
                    // начинающимся от эпохи Unix. Эпоха Unix — ЧЕТВЕРГ,
                    // поэтому для 1w шаг 604800 сек давал четверги, а не
                    // понедельники: Binance присылает 1788739200 (Пн),
                    // а floor-формула превращала его в 1788393600 (Чт) —
                    // отсюда и "🛑 WS невыровненное время".
                    // Для 1M шаг 2592000 (30 дней) вообще не совпадает
                    // с длиной календарного месяца.
                    const expectedTime = this._alignTimeToInterval(candleTime, subContext.interval);

                    if (candleTime !== expectedTime) {
                        // Не спамим в консоль — предупреждаем один раз на интервал.
                        if (!this._warnedAlign.has(subContext.interval)) {
                            console.warn(`⚠️ WS время не совпало с выравниванием: ${candleTime} → ${expectedTime} (${subContext.interval})`);
                            this._warnedAlign.add(subContext.interval);
                        }
                        candleTime = expectedTime;
                    }

                    this._lastKlineTime = candleTime;

                    if (typeof chartManager.updateLastCandle === 'function') {
                        // ФИКС: передаём meta {symbol, interval} — ChartManager
                        // теперь реально использует их как вторую линию защиты
                        // (см. updateLastCandle), на случай если сам график уже
                        // переключился на другой тикер/интервал, а этот сокет
                        // ещё не успели закрыть.
                        chartManager.updateLastCandle({
                            time: candleTime,
                            open: parseFloat(k.o),
                            high: parseFloat(k.h),
                            low: parseFloat(k.l),
                            close: parseFloat(k.c),
                            volume: parseFloat(k.v),
                            quoteVolume: parseFloat(k.q || 0),
                            isClosed: k.x === true
                        }, raw.E || Date.now(), { symbol: subContext.symbol, interval: subContext.interval });
                    }
                }

                if (raw.e === 'aggTrade') {
                    const msgSymbol = raw.s ? raw.s.toUpperCase() : null;
                    if (msgSymbol && msgSymbol !== subContext.symbol.toUpperCase()) return;

                    this._lastRelevantMessageTime = Date.now();

                    const price = parseFloat(raw.p);
                    if (!isNaN(price) && price > 0) {
                        // ФИКС: доп. сверка с РЕАЛЬНЫМ текущим символом графика.
                        // _syncPriceLine раньше вызывался без какой-либо проверки
                        // символа — если ChartManager уже переключился на другой
                        // тикер, а этот сокет (ещё старого тикера) не успели
                        // закрыть, чужой тик мог на мгновение исказить последнюю
                        // свечу нового графика.
                        if (!chartManager.currentSymbol ||
                            chartManager.currentSymbol.toUpperCase() === subContext.symbol.toUpperCase()) {
                            if (typeof chartManager._syncPriceLine === 'function') {
                                chartManager._syncPriceLine({
                                    time: Math.floor(raw.T / 1000), // время сделки в секундах
                                    price: price
                                });
                            }
                        }
                    }
                }
            }
            else if (subContext.exchange === 'bybit' && raw.topic) {
                const parts = raw.topic.split('.');
                let msgSymbol = null;

                if (raw.topic.startsWith('kline.') && parts.length >= 3) {
                    msgSymbol = parts[2].toUpperCase();
                } else if (raw.topic.startsWith('publicTrade.') && parts.length >= 2) {
                    msgSymbol = parts[1].toUpperCase();
                }

                if (!msgSymbol || msgSymbol !== subContext.symbol.toUpperCase()) return;

                if (raw.topic.startsWith('kline.') && parts.length >= 2) {
                    // ФИКС: аналогичная проверка интервала для Bybit — интервал
                    // зашит прямо в топике ('kline.{interval}.{symbol}'),
                    // сверяем его с интервалом, на который подписан этот сокет.
                    const expectedBybitInterval = this.getExchangeInterval(subContext.interval, 'bybit');
                    if (parts[1] !== expectedBybitInterval) return;
                }

                this._lastRelevantMessageTime = Date.now();

                if (raw.topic.startsWith('kline.') && raw.data?.length) {
                    const k = raw.data[0];

                    let candleTime = Math.floor(k.start / 1000);

                    // ФИКС: то же календарное выравнивание, что и для Binance.
                    // Bybit для 1w тоже присылает понедельник, для 1M — 1-е число.
                    const expectedTime = this._alignTimeToInterval(candleTime, subContext.interval);

                    if (candleTime !== expectedTime) {
                        if (!this._warnedAlign.has(subContext.interval)) {
                            console.warn(`⚠️ Bybit время не совпало с выравниванием: ${candleTime} → ${expectedTime} (${subContext.interval})`);
                            this._warnedAlign.add(subContext.interval);
                        }
                        candleTime = expectedTime;
                    }

                    if (typeof chartManager.updateLastCandle === 'function') {
                        chartManager.updateLastCandle({
                            time: candleTime,
                            open: parseFloat(k.open),
                            high: parseFloat(k.high),
                            low: parseFloat(k.low),
                            close: parseFloat(k.close),
                            volume: parseFloat(k.volume),
                            quoteVolume: parseFloat(k.turnover || 0),
                            isClosed: k.confirm === true
                        }, raw.ts || Date.now(), { symbol: subContext.symbol, interval: subContext.interval });
                    }
                } else if (raw.topic.startsWith('publicTrade.') && raw.data?.length) {
                    const tradeData = raw.data[0];
                    const price = parseFloat(tradeData.p);

                    if (!isNaN(price) && price > 0) {
                        if (!chartManager.currentSymbol ||
                            chartManager.currentSymbol.toUpperCase() === subContext.symbol.toUpperCase()) {
                            if (typeof chartManager._syncPriceLine === 'function') {
                                chartManager._syncPriceLine({
                                    time: Math.floor(tradeData.T / 1000), // время сделки в секундах
                                    price: price
                                });
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('❌ Ошибка парсинга:', e);
        }
    }

    _getIntervalSeconds(interval) {
        const map = {
            '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
            '1h': 3600, '4h': 14400, '6h': 21600, '12h': 43200,
            '1d': 86400, '1w': 604800, '1M': 2592000
        };
        return map[interval] || 3600;
    }

    _getIntervalSecondsFromBybit(intervalStr) {
        const map = {
            '1': 60, '3': 180, '5': 300, '15': 900, '30': 1800,
            '60': 3600, '240': 14400, '360': 21600, '720': 43200,
            'D': 86400, 'W': 604800, 'M': 2592000
        };
        return map[intervalStr] || 3600;
    }

    /**
     * Календарное выравнивание Unix-времени (в секундах) к началу интервала в UTC.
     *
     * - '1w' → понедельник 00:00:00 UTC (стандарт Binance и Bybit).
     * - '1M' → 1-е число месяца 00:00:00 UTC.
     * - всё остальное → floor(timeSec / step) * step.
     *
     * ВАЖНО: для '1w' НЕЛЬЗЯ использовать Math.floor(t / 604800) * 604800,
     * потому что эпоха Unix (1 января 1970) — ЧЕТВЕРГ, и кратные 604800
     * секунд от неё — это всегда четверги, а не понедельники.
     * Аналогично для '1M' шаг 30 дней не совпадает с длиной календарного месяца.
     */
    _alignTimeToInterval(timeSec, interval) {
        if (interval === '1w') {
            const d = new Date(timeSec * 1000);
            const dayOfWeek = d.getUTCDay();              // 0=Вс, 1=Пн, ..., 6=Сб
            const daysSinceMonday = (dayOfWeek + 6) % 7;  // Пн→0, Вт→1, ..., Вс→6
            const monday = Date.UTC(
                d.getUTCFullYear(),
                d.getUTCMonth(),
                d.getUTCDate() - daysSinceMonday,
                0, 0, 0, 0
            );
            return Math.floor(monday / 1000);
        }

        if (interval === '1M') {
            const d = new Date(timeSec * 1000);
            const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
            return Math.floor(first / 1000);
        }

        const step = this._getIntervalSeconds(interval);
        return Math.floor(timeSec / step) * step;
    }

    _scheduleReconnect(delay = null) {
        if (this.reconnectTimer) return;

        if (delay === null) {
            this.retryCount++;
            delay = Math.min(5000 * Math.pow(1.5, this.retryCount - 1), 60000);
        }

        console.log(`🔄 Переподключение через ${delay}ms (попытка ${this.retryCount})`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this._doConnect();
        }, delay);
    }

    _closeSocket() {
        const closeWs = (ws) => {
            if (!ws) return;

            if (ws._pingInterval) {
                clearInterval(ws._pingInterval);
                ws._pingInterval = null;
            }

            ws.onopen = null;
            ws.onclose = null;
            ws.onerror = null;
            ws.onmessage = null;

            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.close(1000, 'User disconnect');
                } else if (ws.readyState === WebSocket.CONNECTING) {
                    ws.close();
                }
            } catch (e) {}
        };

        closeWs(this.wsKline);
        closeWs(this.wsTrade);

        this.wsKline = null;
        this.wsTrade = null;
        this.isConnected = false;
        this.isConnecting = false;
    }

    updateSymbolAndTimeframe(symbol, interval, exchange, marketType) {
        console.log('🔄 Обновление символа:', { symbol, interval, exchange, marketType });
        // При смене инструмента/таймфрейма сбрасываем "один раз на интервал",
        // чтобы при возврате на проблемный интервал снова увидеть предупреждение.
        this._warnedAlign.clear();
        this.connect(symbol, interval, exchange, marketType);
    }

    closeAll() {
        console.log('🔌 Закрытие WebSocket...');
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this._connectDebounceTimer) {
            clearTimeout(this._connectDebounceTimer);
            this._connectDebounceTimer = null;
        }
        this._connectGeneration++;
        this._closeSocket();
    }

    ensureConnected() {
        const klineState = this.wsKline?.readyState;
        const tradeState = this.wsTrade?.readyState;

        const klineOk = klineState === WebSocket.OPEN || klineState === WebSocket.CONNECTING;
        const tradeOk = tradeState === WebSocket.OPEN || tradeState === WebSocket.CONNECTING;

        if (!klineOk || !tradeOk) {
            console.log('⚠️ WebSocket не подключён, переподключаемся...');
            this.connect(this.currentSymbol, this.currentInterval, this.currentExchange, this.currentMarketType);
        }
    }

    forceReconnect() {
        console.log('🔄 Принудительное переподключение...');
        this.connect(this.currentSymbol, this.currentInterval, this.currentExchange, this.currentMarketType);
    }

    _onTabVisible() {
        const now = Date.now();
        if (this._lastRelevantMessageTime && (now - this._lastRelevantMessageTime > 10000)) {
            console.log('🔄 Нет данных, переподключаемся');
            this.connect(this.currentSymbol, this.currentInterval, this.currentExchange, this.currentMarketType);
        } else {
            this.ensureConnected();
        }
    }

    destroy() {
        console.log('🗑️ Уничтожение WebSocketManager...');
        document.removeEventListener('visibilitychange', this._visibilityHandler);

        if (this._statusCheckInterval) {
            clearInterval(this._statusCheckInterval);
            this._statusCheckInterval = null;
        }

        this._warnedAlign.clear();
        this.closeAll();
        console.log('✅ WebSocketManager уничтожен');
    }
}

if (typeof window !== 'undefined') {
    window.WebSocketManager = WebSocketManager;
}
