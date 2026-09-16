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
        this._lastRelevantMessageTime = 0;
        this._connectDebounceTimer = null;
        this._statusCheckInterval = null;
        // Флаг явного закрытия — сторож и reconnect не воскрешают соединение
        this._closedByUser = false;

        // Набор интервалов, по которым уже предупреждали о несовпадении
        // выравнивания — чтобы не спамить в консоль на каждом сообщении.
        this._warnedAlign = new Set();

        this.currentSymbol = 'BTCUSDT';
        this.currentInterval = '1h';
        this.currentExchange = 'binance';
        this.currentMarketType = 'futures';

        // ФИКС: переименовано из binanceSpotOnlyTokens. Эти тикеры — ФЬЮЧЕРСНЫЕ
        // индексы Binance (BTCDOM — доминация BTC, DEFI, NFT и т.п.) и на споте
        // не торгуются. Старая логика переключала их в 'spot' и уводила
        // подписку на несуществующий стрим.
        this.binanceFuturesOnlyTokens = [
            'BTCDOMUSDT', 'DEFIUSDT', 'ALTUSDT', 'NFTUSDT', 'TOPCOINSUSDT'
        ];

        this._visibilityHandler = () => {
            if (!document.hidden) {
                this._onTabVisible();
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);

        // Сторож соединения: если данные не приходят >30 с или соединение
        // "idle" (нет ни сокетов, ни запланированного реконнекта) —
        // восстанавливаем связь.
        this._statusCheckInterval = setInterval(() => {
            if (this._closedByUser) return;

            const stale = this._lastRelevantMessageTime &&
                (Date.now() - this._lastRelevantMessageTime > 30000);

            const idle = !this.isConnected && !this.isConnecting &&
                !this.reconnectTimer && !this._connectDebounceTimer;

            if (stale) {
                console.warn('⚠️ Нет данных 30 сек, переподключаемся');
                // ФИКС: ensureConnected() проверяет только readyState и не
                // поможет при OPEN-сокете с мёртвым каналом. Полноценный
                // реконнект + сброс метки, чтобы не триггерить повторно.
                this._lastRelevantMessageTime = Date.now();
                this.connect(this.currentSymbol, this.currentInterval,
                             this.currentExchange, this.currentMarketType);
            } else if (idle) {
                this.ensureConnected();
            }
        }, 15000);

        setTimeout(() => this._autoConnect(), 1000);
    }

    _autoConnect() {
        if (this._closedByUser) return;

        // Не переподключаемся, если соединение уже установлено или
        // подключение уже запланировано.
        const alreadyActive = this.wsKline || this.wsTrade ||
            this.reconnectTimer || this._connectDebounceTimer;

        if (alreadyActive) {
            console.log('🚀 WebSocketManager: подключение уже активно, автоподключение пропущено');
            return;
        }

        console.log('🚀 WebSocketManager: автоподключение...');
        this.connect(this.currentSymbol, this.currentInterval,
                     this.currentExchange, this.currentMarketType);
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
        return exchange === 'bybit'
            ? symbol.trim().toUpperCase()
            : symbol.trim().toLowerCase();
    }

    connect(symbol, interval, exchange, marketType) {
        symbol = (symbol || this.currentSymbol).trim();
        exchange = exchange || this.currentExchange;
        marketType = marketType || this.currentMarketType;

        // ВАЖНО: только trim, без toLowerCase(). Идентификаторы интервалов
        // регистрозависимы: '1M' (месяц) после toLowerCase() становился '1m'
        // (минута) — сокет подписывался не на тот таймфрейм, meta.interval
        // не совпадал с currentInterval графика, и все свечи отбрасывались.
        interval = (interval || this.currentInterval).trim();

        // ФИКС: инвертированная логика. Раньше фьючерсные индексы Binance
        // принудительно уводились в spot. Теперь — наоборот: если запрошен
        // spot, но тикер торгуется только на фьючерсах, остаёмся на futures.
        if (exchange === 'binance' && marketType === 'spot' &&
            this.binanceFuturesOnlyTokens.includes(symbol.toUpperCase())) {
            marketType = 'futures';
        }

        this.currentSymbol = symbol;
        this.currentInterval = interval;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;
        this.retryCount = 0;

        // Явное подключение снимает флаг закрытия
        this._closedByUser = false;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this._connectDebounceTimer) {
            clearTimeout(this._connectDebounceTimer);
        }

        this._connectDebounceTimer = setTimeout(() => {
            this._connectDebounceTimer = null;
            this._doConnect();
        }, 100);
    }

    _doConnect() {
        const generation = ++this._connectGeneration;
        this.isConnecting = true;

        this._closeSocket();

        // Снимок целевых параметров ИМЕННО в момент открытия сокета.
        // Все фильтры сообщений идут по этому неизменяемому контексту, а не
        // по мутирующимся this.current*, которые могли быть уже обновлены
        // синхронно в connect() (пока старый сокет ещё жив и шлёт данные).
        const subContext = {
            symbol: this.currentSymbol,
            interval: this.currentInterval,
            exchange: this.currentExchange,
            marketType: this.currentMarketType
        };

        const fs = this.formatSymbol(subContext.symbol, subContext.exchange);

        if (subContext.exchange === 'binance') {
            const baseHost = subContext.marketType === 'spot'
                ? 'wss://stream.binance.com:9443/ws'
                : 'wss://fstream.binance.com/market/ws';

            const klineUrl = `${baseHost}/${fs}@kline_${subContext.interval}`;
            const tradeUrl = `${baseHost}/${fs}@aggTrade`;

            console.log('🔌 KLINE:', klineUrl);
            console.log('🔌 TRADE:', tradeUrl);

            this.wsKline = this._createWebSocket(klineUrl, 'kline', generation, subContext);
            this.wsTrade = this._createWebSocket(tradeUrl, 'trade', generation, subContext);
        } else if (subContext.exchange === 'bybit') {
            const wsUrl = 'wss://stream.bybit.com/v5/public/' +
                (subContext.marketType === 'spot' ? 'spot' : 'linear');
            console.log('🔌 Bybit:', wsUrl);
            this.wsKline = this._createWebSocket(wsUrl, 'bybit', generation, subContext);
            this.wsTrade = this.wsKline;
        } else {
            this.isConnecting = false;
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
                        ws._pingInterval = null;
                        return;
                    }
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        try { ws.send(JSON.stringify({ op: 'ping' })); } catch (e) {}
                    }
                }, 20000);
            }

            const klineOk = this.wsKline && this.wsKline.readyState === WebSocket.OPEN;
            const tradeOk = this.wsTrade && this.wsTrade.readyState === WebSocket.OPEN;

            if (klineOk && tradeOk && !this.isConnected) {
                this.isConnected = true;
                this.isConnecting = false;
                this.retryCount = 0;
                // Сбрасываем метку «последних данных», чтобы сторож отсчитывал
                // 30 с молчания от момента восстановления связи.
                this._lastRelevantMessageTime = Date.now();
                console.log('✅ Оба WebSocket подключены');

                if (this.chartManager && this.chartManager.onWebSocketConnected) {
                    this.chartManager.onWebSocketConnected();
                }
            }
        };

        ws.onmessage = (event) => {
            if (generation !== this._connectGeneration) return;
            this._handleMessage(event.data, type, subContext);
        };

        ws.onclose = (event) => {
            if (generation !== this._connectGeneration) return;

            console.log(`🔌 ${type.toUpperCase()} WebSocket закрыт:`, event.code, event.reason);

            // ФИКС: чистим ping-интервал этого сокета здесь, а не только в
            // _closeSocket(). Иначе после серверного/сетевого закрытия
            // интервал продолжит тикать в мёртвое соединение.
            if (ws._pingInterval) {
                clearInterval(ws._pingInterval);
                ws._pingInterval = null;
            }

            this.isConnected = false;
            this.isConnecting = false;

            // Коды 1000/1005/1006 раньше выходили без переподключения:
            //   - 1006: аварийный обрыв (сеть/прокси/сон машины) — самый частый;
            //   - 1000: сервер Binance планово закрывает стрим каждые 24 часа;
            //   - 1005: статус не передан (тоже авария).
            // Намеренное закрытие (_closeSocket) обнуляет обработчики, поэтому
            // сюда такие события не попадают. Значит, ЛЮБОЙ сработавший onclose
            // требует переподключения.
            if (event.code === 1008) {
                if (subContext.exchange === 'binance' &&
                    subContext.marketType === 'futures' &&
                    this.binanceFuturesOnlyTokens.includes(subContext.symbol.toUpperCase()) &&
                    this.currentSymbol === subContext.symbol &&
                    this.currentInterval === subContext.interval) {
                    // Резервный предохранитель: если по какой-то причине
                    // фьючерсный индекс ушёл в spot-запрос.
                    this.currentMarketType = 'spot';
                    this._scheduleReconnect(500);
                    return;
                }
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

            if (!subContext) return;

            if (subContext.exchange === 'binance') {
                if (raw.e === 'kline' && raw.k) {
                    const k = raw.k;
                    const msgSymbol = raw.s ? raw.s.toUpperCase() : null;
                    if (msgSymbol && msgSymbol !== subContext.symbol.toUpperCase()) return;

                    // Сверяем интервал СВЕЧИ из сообщения с интервалом,
                    // на который подписан именно этот сокет. Без этого при
                    // быстрой смене таймфрейма ещё не закрытый старый сокет
                    // "1m" мог прислать данные, которые пересчитывались как
                    // данные нового интервала "1h" — отсюда битые/скачущие
                    // свечи сразу после переключения.
                    if (k.i && k.i !== subContext.interval) return;

                    this._lastRelevantMessageTime = Date.now();

                    let candleTime = Math.floor(k.t / 1000);

                    // Календарное выравнивание вместо
                    // Math.floor(t / step) * step. Старая формула не работала
                    // для 1w (эпоха Unix — четверг, а Binance присылает
                    // понедельник) и для 1M (30-дневный шаг ≠ календарный
                    // месяц).
                    const expectedTime = this._alignTimeToInterval(candleTime, subContext.interval);

                    if (candleTime !== expectedTime) {
                        if (!this._warnedAlign.has(subContext.interval)) {
                            console.warn(`⚠️ WS время не совпало с выравниванием: ${candleTime} → ${expectedTime} (${subContext.interval})`);
                            this._warnedAlign.add(subContext.interval);
                        }
                        candleTime = expectedTime;
                    }

                    if (typeof chartManager.updateLastCandle === 'function') {
                        // meta {symbol, interval} — вторая линия защиты в
                        // ChartManager: если график уже переключился на другой
                        // тикер/интервал, а этот сокет ещё не закрыт.
                        chartManager.updateLastCandle({
                            time: candleTime,
                            open: parseFloat(k.o),
                            high: parseFloat(k.h),
                            low: parseFloat(k.l),
                            close: parseFloat(k.c),
                            volume: parseFloat(k.v),
                            quoteVolume: parseFloat(k.q || 0),
                            isClosed: k.x === true
                        }, raw.E || Date.now(), {
                            symbol: subContext.symbol,
                            interval: subContext.interval
                        });
                    }
                }

                if (raw.e === 'aggTrade') {
                    const msgSymbol = raw.s ? raw.s.toUpperCase() : null;
                    if (msgSymbol && msgSymbol !== subContext.symbol.toUpperCase()) return;

                    this._lastRelevantMessageTime = Date.now();

                    const price = parseFloat(raw.p);
                    if (!isNaN(price) && price > 0) {
                        // Сверка с реальным текущим символом графика:
                        // если ChartManager уже переключился, чужой тик
                        // не должен исказить последнюю свечу.
                        if (!chartManager.currentSymbol ||
                            chartManager.currentSymbol.toUpperCase() === subContext.symbol.toUpperCase()) {
                            if (typeof chartManager._syncPriceLine === 'function') {
                                chartManager._syncPriceLine({
                                    time: Math.floor(raw.T / 1000),
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
                    const expectedBybitInterval = this.getExchangeInterval(subContext.interval, 'bybit');
                    if (parts[1] !== expectedBybitInterval) return;
                }

                this._lastRelevantMessageTime = Date.now();

                if (raw.topic.startsWith('kline.') && raw.data?.length) {
                    // У Bybit свежие данные идут в КОНЦЕ батча (data[0] — самый старый).
                    const k = raw.data[raw.data.length - 1];

                    let candleTime = Math.floor(k.start / 1000);

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
                        }, raw.ts || Date.now(), {
                            symbol: subContext.symbol,
                            interval: subContext.interval
                        });
                    }
                } else if (raw.topic.startsWith('publicTrade.') && raw.data?.length) {
                    const tradeData = raw.data[raw.data.length - 1];
                    const price = parseFloat(tradeData.p);

                    if (!isNaN(price) && price > 0) {
                        if (!chartManager.currentSymbol ||
                            chartManager.currentSymbol.toUpperCase() === subContext.symbol.toUpperCase()) {
                            if (typeof chartManager._syncPriceLine === 'function') {
                                chartManager._syncPriceLine({
                                    time: Math.floor(tradeData.T / 1000),
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
        // ФИКС: добавлен '2h': 7200. Раньше для 2h выравнивание уходило
        // в fallback 3600 и работало «по совпадению».
        const map = {
            '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
            '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200,
            '1d': 86400, '1w': 604800, '1M': 2592000
        };
        return map[interval] || 3600;
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
        if (this._closedByUser) return;
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

        // У Bybit wsTrade === wsKline (один сокет) — повторный вызов closeWs
        // для того же объекта безопасен: обработчики уже сняты, а readyState
        // CLOSING/CLOSED не попадает ни под одну ветку закрытия.
        closeWs(this.wsTrade);

        this.wsKline = null;
        this.wsTrade = null;
        this.isConnected = false;
        this.isConnecting = false;
    }

    updateSymbolAndTimeframe(symbol, interval, exchange, marketType) {
        console.log('🔄 Обновление символа:', { symbol, interval, exchange, marketType });
        // Сбрасываем «один раз на интервал», чтобы при возврате на проблемный
        // интервал снова увидеть предупреждение.
        this._warnedAlign.clear();
        this.connect(symbol, interval, exchange, marketType);
    }

    closeAll() {
        console.log('🔌 Закрытие WebSocket...');

        // Явное закрытие — сторож и reconnect не воскрешают соединение
        this._closedByUser = true;

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
        if (this._closedByUser) return;

        const klineState = this.wsKline?.readyState;
        const tradeState = this.wsTrade?.readyState;

        const klineOk = klineState === WebSocket.OPEN || klineState === WebSocket.CONNECTING;
        const tradeOk = tradeState === WebSocket.OPEN || tradeState === WebSocket.CONNECTING;

        if (!klineOk || !tradeOk) {
            console.log('⚠️ WebSocket не подключён, переподключаемся...');
            this.connect(this.currentSymbol, this.currentInterval,
                         this.currentExchange, this.currentMarketType);
        }
    }

    forceReconnect() {
        // Не убиваем ЖИВОЕ соединение. ChartManager вызывает forceReconnect()
        // при каждом возврате на вкладку; пересоздание живых сокетов давало
        // «слепое окно» (сотни мс), в котором терялись kline-события.
        // Если сокеты живы, но данные протухли (сон машины, half-open TCP) —
        // это покрывает _onTabVisible(): нет данных >10 с → полный реконнект.
        const alive = (ws) => ws &&
            (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);

        if (alive(this.wsKline) && alive(this.wsTrade) && !this._closedByUser) {
            console.log('🔄 forceReconnect: соединение живо, сокеты не пересоздаём');
            return;
        }

        console.log('🔄 Принудительное переподключение...');
        this.connect(this.currentSymbol, this.currentInterval,
                     this.currentExchange, this.currentMarketType);
    }

    _onTabVisible() {
        if (this._closedByUser) return;

        const now = Date.now();
        if (this._lastRelevantMessageTime && (now - this._lastRelevantMessageTime > 10000)) {
            console.log('🔄 Нет данных, переподключаемся');
            this._lastRelevantMessageTime = now; // не триггерить повторно до новых данных
            this.connect(this.currentSymbol, this.currentInterval,
                         this.currentExchange, this.currentMarketType);
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
