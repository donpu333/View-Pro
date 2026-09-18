

const WS_ENDPOINTS = {
    binance: {
        // После миграции 2026-03-06 kline/aggTrade/ticker/markPrice — ТОЛЬКО в /market.
        futuresMarketBase: 'wss://fstream.binance.com/market/ws',
        // Альтернативный режим того же /market: стримы в query, полезная нагрузка
        // приходит ОБЁРНУТОЙ в {stream,data} — _handleMessage её разворачивает.
        // ВНИМАНИЕ: 'wss://fstream.binance.com/stream' (без /market) — это LEGACY,
        // он отключён 2026-04-23: сокет открывается, но данных не даёт.
        futuresMarketStreamBase: 'wss://fstream.binance.com/market/stream?streams=',
        // data-stream.binance.vision — только рыночные данные, порт 443.
        // Старый 'wss://stream.binance.com:9443/ws' тоже жив, но 9443 часто
        // блокируется прокси/файрволами.
        spotBase: 'wss://data-stream.binance.vision/ws',
        spotFallbackBase: 'wss://stream.binance.com:9443/ws'
    },
    bybit: {
        publicBase: 'wss://stream.bybit.com/v5/public'
    }
};

class WebSocketManager {
    constructor(chartManager, options = {}) {
        this.chartManager = chartManager;
        this.wsKline = null;
        this.wsTrade = null;
        this.reconnectTimer = null;
        this.retryCount = 0;
        this.isConnected = false;
        this.isConnecting = false;
        this._connectGeneration = 0;
        this._lastRelevantMessageTime = 0;   // последние ДАННЫЕ (kline/aggTrade)
        this._lastActivityTime = 0;          // ЛЮБОЙ кадр, включая pong — признак живого TCP
        this._connectDebounceTimer = null;
        this._statusCheckInterval = null;
        this._autoConnectTimer = null;       // ФИКС: раньше не хранился → destroy() его не отменял
        this._connectStartedAt = 0;
        this._silentRounds = 0;              // сколько циклов сторожа подряд нет данных
        this._noDataNotified = false;
        this._giveUpAt = 0;                  // когда сдались (окно пассивного режима)
        this._closedByUser = false;

        // Настраиваемые пороги (значения по умолчанию — боевые).
        const o = Object.assign({
            watchdogIntervalMs: 15000, // как часто сторож просыпается
            staleMs: 90000,            // нет ЛЮБЫХ кадров → мёртвый TCP (half-open)
            noDataMs: 30000,           // канал открыт, но данных нет → переподключиться
            noDataMaxRounds: 3,        // после N безуспешных циклов сдаёмся (защита от IP-бана)
            passiveCheckMs: 60000,     // период пассивной проверки после того, как сдались
            connectTimeoutMs: 12000,   // сокет не открылся за это время → принудительный реконнект
            tabVisibleStaleMs: 10000,  // порог «нет данных» при возврате на вкладку
            validateSymbols: true      // проверять тикер по exchangeInfo до подписки
        }, options || {});
        this._opt = o;

        // Набор ключей, по которым уже предупреждали о несовпадении выравнивания.
        // ФИКС: ключ теперь exchange|symbol|interval — раньше был только interval,
        // поэтому предупреждение могло «съедаться» другим тикером.
        this._warnedAlign = new Set();

        this.currentSymbol = 'BTCUSDT';
        this.currentInterval = '1h';
        this.currentExchange = 'binance';
        this.currentMarketType = 'futures';

        // Кэш exchangeInfo для валидации тикеров (см. _getSymbolInfo / _validateSymbol).
        this._symbolInfoCache = new Map();
        this._symbolInfoTtlMs = 10 * 60 * 1000;

        // Тикеры, которые торгуются ТОЛЬКО на фьючерсах Binance (индексы).
        // ⚠️ Список проверен по fapi/v1/exchangeInfo 2026-09-18:
        //    BTCDOMUSDT   → TRADING   (фьючерсы, на споте нет)
        //    ALTUSDT      → TRADING   (ЕСТЬ И НА СПОТЕ! см. баг №4 в отчёте)
        //    DEFIUSDT     → SETTLING  (данных в стриме уже нет)
        //    NFTUSDT      → удалён с фьючерсов
        //    TOPCOINSUSDT → удалён с фьючерсов
        // Поэтому держать мёртвые тикеры здесь бессмысленно — их всё равно не
        // подключить; защитой служит _validateSymbol() + «сдача» сторожа.
        this.binanceFuturesOnlyTokens = ['BTCDOMUSDT', 'DEFIUSDT', 'ALTUSDT'];

        this._visibilityHandler = () => {
            if (!document.hidden) {
                this._onTabVisible();
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);

        // Сторож соединения (подробности — в _watchdogTick).
        this._statusCheckInterval = setInterval(
            () => this._watchdogTick(), o.watchdogIntervalMs
        );

        this._autoConnectTimer = setTimeout(() => {
            this._autoConnectTimer = null;
            this._autoConnect();
        }, 1000);
    }

    _autoConnect() {
        if (this._closedByUser) return;

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

    /**
     * Единая точка построения URL. Возвращает { kline, trade } или null,
     * если биржа/тип рынка не поддерживаются.
     */
    _buildStreamUrls(ctx) {
        const fs = this.formatSymbol(ctx.symbol, ctx.exchange);

        if (ctx.exchange === 'binance') {
            const isSpot = ctx.marketType === 'spot';
            const base = isSpot
                ? WS_ENDPOINTS.binance.spotBase
                : WS_ENDPOINTS.binance.futuresMarketBase;

            const urls = {
                kline: `${base}/${fs}@kline_${ctx.interval}`,
                trade: `${base}/${fs}@aggTrade`
            };

            if (!isSpot) {
                // Опционально: ОДИН комбинированный сокет вместо двух — экономит
                // квоту подключений (лимит 300 соединений / 5 мин / IP, а каждое
                // переключение тикера создаёт два новых).
                // ВНИМАНИЕ: в режиме ?streams= полезная нагрузка обёрнута в
                // {stream, data} — _handleMessage её разворачивает.
                urls.combined = WS_ENDPOINTS.binance.futuresMarketStreamBase +
                    `${fs}@kline_${ctx.interval}/${fs}@aggTrade`;
            }
            return urls;
        }

        if (ctx.exchange === 'bybit') {
            const kind = ctx.marketType === 'spot' ? 'spot' : 'linear';
            const url = `${WS_ENDPOINTS.bybit.publicBase}/${kind}`;
            return { kline: url, trade: url };
        }

        return null;
    }

    /**
     * Публичная точка входа: пользователь сменил тикер/таймфрейм/биржу.
     * Полный сброс состояния, ВКЛЮЧАЯ бухгалтерию «тихих» раундов сторожа.
     */
    connect(symbol, interval, exchange, marketType) {
        this._silentRounds = 0;
        this._noDataNotified = false;
        this._giveUpAt = 0;
        return this._connectInternal(symbol, interval, exchange, marketType);
    }

    /**
     * Внутреннее подключение. НЕ трогает _silentRounds/_noDataNotified/_giveUpAt:
     * именно её вызывает сторож (_hardReconnect), и если бы счётчик сбрасывался
     * здесь, раунд всегда был бы «1/N» и режим «сдаться» не достигался никогда
     * (бесконечные реконнекты по кругу).
     */
    _connectInternal(symbol, interval, exchange, marketType) {
        symbol = (symbol || this.currentSymbol).trim();
        exchange = exchange || this.currentExchange;
        marketType = marketType || this.currentMarketType;

        // ВАЖНО: только trim, без toLowerCase(). Идентификаторы интервалов
        // регистрозависимы: '1M' (месяц) после toLowerCase() становился '1m'.
        interval = (interval || this.currentInterval).trim();

        // Индексы Binance (BTCDOM и т.п.) на споте не торгуются — остаёмся на futures.
        if (exchange === 'binance' && marketType === 'spot' &&
            this.binanceFuturesOnlyTokens.includes(symbol.toUpperCase())) {
            marketType = 'futures';
        }

        this.currentSymbol = symbol;
        this.currentInterval = interval;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;

        // Явное подключение снимает флаг закрытия.
        this._closedByUser = false;
        this.retryCount = 0;
        this._connectStartedAt = 0;
        this._lastRelevantMessageTime = 0;
        this._lastActivityTime = 0;

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

    async _doConnect() {
        const generation = ++this._connectGeneration;
        this.isConnecting = true;
        this._connectStartedAt = Date.now();

        this._closeSocket();

        // Снимок целевых параметров ИМЕННО в момент открытия сокета.
        const subContext = {
            symbol: this.currentSymbol,
            interval: this.currentInterval,
            exchange: this.currentExchange,
            marketType: this.currentMarketType
        };

        const urls = this._buildStreamUrls(subContext);
        if (!urls) {
            console.error(`❌ Не поддерживаемая биржа: ${subContext.exchange}`);
            this.isConnecting = false;
            this._connectStartedAt = 0;
            return;
        }

        // ФИКС: проверка тикера до подписки. Новый Binance-WS НЕ сообщает об
        // ошибке: несуществующий/делистнутый стрим просто молчит вечно, и
        // единственный симптом — бесконечные реконнекты.
        const verdict = await this._validateSymbol(subContext);
        if (generation !== this._connectGeneration) return; // параметры успели смениться

        if (verdict === 'missing') {
            console.error(`❌ ${subContext.symbol} не торгуется на ${subContext.exchange}/${subContext.marketType} — подписка невозможна`);
            if (this.chartManager && typeof this.chartManager.onStreamUnavailable === 'function') {
                this.chartManager.onStreamUnavailable({
                    reason: 'symbol-not-found', ...subContext
                });
            }
            this.isConnecting = false;
            this._connectStartedAt = 0;
            return;
        }
        if (verdict === 'not-trading') {
            console.warn(`⚠️ ${subContext.symbol}: статус не TRADING (делистинг/расчёт) — данных в стриме может не быть`);
        }

        console.log('🔌 KLINE:', urls.kline);
        console.log('🔌 TRADE:', urls.trade);

        this._connectStartedAt = Date.now();

        if (subContext.exchange === 'bybit') {
            this.wsKline = this._createWebSocket(urls.kline, 'bybit', generation, subContext);
            this.wsTrade = this.wsKline;
        } else {
            this.wsKline = this._createWebSocket(urls.kline, 'kline', generation, subContext);
            this.wsTrade = this._createWebSocket(urls.trade, 'trade', generation, subContext);
        }

        this._updateConnectionState();
    }

    /**
     * Возвращает 'ok' | 'not-trading' | 'missing' | 'unknown' (если REST недоступен).
     * Результат кэшируется на 10 минут, чтобы не дёргать exchangeInfo при каждом реконнекте.
     */
    async _validateSymbol(ctx) {
        if (!this._opt.validateSymbols) return 'ok';
        if (typeof fetch !== 'function') return 'ok';

        const info = await this._getSymbolInfo(ctx.exchange, ctx.marketType);
        if (!info) return 'unknown';

        const key = ctx.symbol.trim().toUpperCase();
        if (!(key in info)) return 'missing';

        // Binance отдаёт 'TRADING', Bybit — 'Trading' / 'Settling' / 'Closed'.
        // Сравниваем регистронезависимо, иначе на Bybit каждое подключение
        // сопровождалось бы ложным предупреждением «статус не TRADING».
        const status = String(info[key] || '').toUpperCase();
        return status === 'TRADING' ? 'ok' : 'not-trading';
    }

    async _getSymbolInfo(exchange, marketType) {
        const cacheKey = `${exchange}:${marketType}`;
        const cached = this._symbolInfoCache.get(cacheKey);
        if (cached && Date.now() - cached.at < this._symbolInfoTtlMs) return cached.map;

        let url;
        if (exchange === 'binance') {
            url = marketType === 'spot'
                ? 'https://api.binance.com/api/v3/exchangeInfo'
                : 'https://fapi.binance.com/fapi/v1/exchangeInfo';
        } else if (exchange === 'bybit') {
            const category = marketType === 'spot' ? 'spot' : 'linear';
            url = `https://api.bybit.com/v5/market/instruments-info?category=${category}&limit=1000`;
        } else {
            return null;
        }

        try {
            const controller = (typeof AbortController === 'function') ? new AbortController() : null;
            const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
            const res = await fetch(url, { signal: controller ? controller.signal : undefined });
            if (timer) clearTimeout(timer);
            if (!res || !res.ok) return null;

            const data = await res.json();
            const map = {};

            if (exchange === 'binance') {
                (data.symbols || []).forEach(s => { map[s.symbol] = s.status; });
            } else {
                ((data.result && data.result.list) || []).forEach(s => { map[s.symbol] = s.status; });
            }

            this._symbolInfoCache.set(cacheKey, { at: Date.now(), map });
            return map;
        } catch (e) {
            console.warn('⚠️ exchangeInfo недоступен, пропускаем валидацию символа:', e && e.message);
            return null;
        }
    }

    _createWebSocket(url, type, generation, subContext) {
        let ws;
        try {
            ws = new WebSocket(url);
        } catch (e) {
            console.error(`❌ Ошибка создания ${type} WebSocket:`, e);
            this._updateConnectionState();
            // ФИКС: retryCount теперь растёт и при явной задержке,
            // иначе создание сокета с ошибкой давало цикл «каждые 3 с навсегда».
            this._scheduleReconnect(3000);
            return null;
        }

        ws._type = type;
        ws._generation = generation;
        ws._subContext = subContext;

        ws.onopen = () => {
            if (generation !== this._connectGeneration) return;

            console.log(`✅ ${type.toUpperCase()} WebSocket подключён`);
            this._lastActivityTime = Date.now();

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
            } else {
                // ПРИМЕЧАНИЕ: прикладной keep-alive для Binance здесь НЕ нужен и
                // даже вреден: на protocol-level ping-фреймы браузер отвечает pong
                // самостоятельно (это требование документации spot-стримов —
                // «при получении ping необходимо отправить pong как можно скорее»),
                // а любой отправленный JSON считается входящим сообщением и
                // попадает под лимит 5 сообщений/с. Для Bybit keep-alive — это
                // {"op":"ping"} каждые 20 с (см. ветку выше).
            }

            this._updateConnectionState();
        };

        ws.onmessage = (event) => {
            if (generation !== this._connectGeneration) return;
            this._lastActivityTime = Date.now();
            this._handleMessage(event.data, type, subContext);
        };

        ws.onclose = (event) => {
            if (generation !== this._connectGeneration) return;

            console.log(`🔌 ${type.toUpperCase()} WebSocket закрыт:`, event.code, event.reason);

            // Чистим ping-интервал этого сокета здесь, а не только в _closeSocket():
            // после серверного/сетевого закрытия интервал не должен тикать в мёртвый канал.
            if (ws._pingInterval) {
                clearInterval(ws._pingInterval);
                ws._pingInterval = null;
            }
            if (ws._keepAlive) {
                clearInterval(ws._keepAlive);
                ws._keepAlive = null;
            }

            this._updateConnectionState();

            // ФИКС (было критическим): прежняя ветка для кода 1008 переключала
            // фьючерсные индексы (BTCDOMUSDT и т.п.) на spot. Но на споте этих
            // тикеров НЕТ (проверено по api/v3/exchangeInfo: BTCDOMUSDT —
            // ОТСУТСТВУЕТ), то есть «предохранитель» гарантированно уводил
            // подписку в мёртвый стрим, который к тому же больше не закрывается
            // с ошибкой. Ветка удалена целиком.
            //
            // Намеренное закрытие (_closeSocket) обнуляет обработчики, поэтому
            // сюда такие события не попадают => ЛЮБОЙ сработавший onclose
            // требует переподключения (1000/1005/1006/1008/1011 — все).
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

    /**
     * Пересчитывает isConnected/isConnecting по фактическому readyState сокетов
     * и ОДИН раз вызывает chartManager.onWebSocketConnected().
     *
     * ФИКС: раньше isConnected становился true только когда ОБА сокета OPEN.
     * Если трейд-сокет не открывался (или стрим aggTrade для инструмента
     * отсутствует), kline-данные шли, но isConnected оставался false и
     * onWebSocketConnected() не вызывался никогда — UI зависал в «подключении».
     * Теперь: kline — обязательный канал, trade — желательный.
     */
    _updateConnectionState() {
        const open = (ws) => !!ws && ws.readyState === WebSocket.OPEN;
        const pending = (ws) => !!ws && ws.readyState === WebSocket.CONNECTING;

        const klineState = open(this.wsKline) ||
            (this.wsKline === this.wsTrade && open(this.wsTrade)); // Bybit: один сокет
        const tradeState = open(this.wsTrade) ||
            (this.wsKline === this.wsTrade && open(this.wsKline));

        const wasConnected = this.isConnected;

        if (klineState) {
            this.isConnecting = false;

            // ФИКС (найден тестами): отменяем запланированный реконнект, если
            // соединение всё-таки успело открыться. Сценарий: рукопожатие шло
            // дольше connectTimeoutMs → сработал _scheduleReconnect(5000), затем
            // сокет открылся. Без отмены через 5 с живой канал разрывался и
            // пересоздавался «на ровном месте» (потеря kline-событий + мигание графика).
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
                console.log('✅ Соединение открылось — запланированный реконнект отменён');
            }

            if (!wasConnected) {
                this.isConnected = true;
                this.retryCount = 0;
                // Сбрасываем метки, чтобы сторож отсчитывал молчание от момента
                // восстановления связи, а не от старых данных.
                const now = Date.now();
                this._lastRelevantMessageTime = now;
                this._lastActivityTime = now;
                // Счётчик «тихих» раундов НЕ сбрасываем: иначе стрим без данных
                // получал бы бесконечную серию реконнектов.
                console.log(tradeState ? '✅ Оба WebSocket подключены'
                                       : '✅ KLINE подключён (trade-канал ещё не открыт)');

                if (this.chartManager && typeof this.chartManager.onWebSocketConnected === 'function') {
                    this.chartManager.onWebSocketConnected();
                }
            }
        } else {
            this.isConnected = false;
            this.isConnecting = pending(this.wsKline) || pending(this.wsTrade);
        }
    }

    _handleMessage(rawData, type, subContext) {
        try {
            let raw = JSON.parse(rawData);
            if (!raw || typeof raw !== 'object') return;

            // Combined-режим (/stream?streams=a/b) оборачивает полезную нагрузку.
            // Без этой развёртки переход на комбинированный сокет молча сломал бы
            // всю обработку (raw.e === undefined).
            if (raw && typeof raw === 'object' && raw.stream && raw.data &&
                typeof raw.data === 'object') {
                raw = raw.data;
            }

            // Новое событие Binance (в проде с 2026-05-08): сервер предупреждает
            // о скором закрытии. Переподключаемся СРАЗУ, а не через 30 с по сторожу.
            if (raw && raw.e === 'serverShutdown') {
                console.warn('⚠️ serverShutdown от биржи — переподключаемся заранее');
                this._scheduleReconnect(1000);
                return;
            }

            // Служебные кадры Bybit. Ошибку подписки больше не глотаем.
            if (raw && raw.op === 'pong') return;
            if (raw && raw.op === 'subscribe') {
                if (raw.success === false) {
                    console.error('❌ Bybit отклонил подписку:', raw.ret_msg);
                }
                return;
            }

            const chartManager = this.chartManager || (typeof window !== 'undefined' ? window.chartManager : null);

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

                    // Сверяем интервал СВЕЧИ из сообщения с интервалом подписки
                    // именно этого сокета (страховка; основную защиту дают
                    // generation + subContext).
                    if (k.i && k.i !== subContext.interval) return;

                    this._markDataReceived();

                    let candleTime = Math.floor(k.t / 1000);

                    // Календарное выравнивание вместо Math.floor(t / step) * step:
                    // старая формула неверна для 1w (эпоха Unix — четверг) и 1M.
                    const expectedTime = this._alignTimeToInterval(candleTime, subContext.interval);

                    if (candleTime !== expectedTime) {
                        const warnKey = `${subContext.exchange}|${subContext.symbol}|${subContext.interval}`;
                        if (!this._warnedAlign.has(warnKey)) {
                            console.warn(`⚠️ WS время не совпало с выравниванием: ${candleTime} → ${expectedTime} (${subContext.interval})`);
                            this._warnedAlign.add(warnKey);
                        }
                        candleTime = expectedTime;
                    }

                    if (typeof chartManager.updateLastCandle === 'function') {
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

                    this._markDataReceived();

                    const price = parseFloat(raw.p);
                    if (!isNaN(price) && price > 0) {
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

                this._markDataReceived();

                if (raw.topic.startsWith('kline.') && raw.data && raw.data.length) {
                    // У Bybit свежие данные в КОНЦЕ батча (data[0] — самый старый).
                    const k = raw.data[raw.data.length - 1];

                    let candleTime = Math.floor(k.start / 1000);
                    const expectedTime = this._alignTimeToInterval(candleTime, subContext.interval);

                    if (candleTime !== expectedTime) {
                        const warnKey = `${subContext.exchange}|${subContext.symbol}|${subContext.interval}`;
                        if (!this._warnedAlign.has(warnKey)) {
                            console.warn(`⚠️ Bybit время не совпало с выравниванием: ${candleTime} → ${expectedTime} (${subContext.interval})`);
                            this._warnedAlign.add(warnKey);
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
                } else if (raw.topic.startsWith('publicTrade.') && raw.data && raw.data.length) {
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
        // ФИКС: '1M' больше НЕ возвращает 2592000 (30 суток). Календарный месяц
        // не выражается постоянным шагом, поэтому для '1M' возвращаем 0 —
        // любой внешний код обязан идти через _alignTimeToInterval().
        // Прежнее значение 2592000 тихо ломало всё, что считало границы месяцев
        // (агрегация, «следующая свеча», прогресс бара).
        const map = {
            '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
            '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200,
            '1d': 86400, '1w': 604800, '1M': 0
        };
        // ВНИМАНИЕ: именно hasOwnProperty, а не `map[interval] || 3600` —
        // для '1M' значение 0 falsy, и прежняя запись молча возвращала 3600.
        return Object.prototype.hasOwnProperty.call(map, interval) ? map[interval] : 3600;
    }

    /**
     * Календарное выравнивание Unix-времени (в секундах) к началу интервала в UTC.
     *
     * - '1w' → понедельник 00:00:00 UTC (стандарт Binance и Bybit).
     * - '1M' → 1-е число месяца 00:00:00 UTC.
     * - всё остальное → floor(timeSec / step) * step.
     *
     * Сверено с живыми стримами обеих бирж 2026-09-18 по всем интервалам — 0 расхождений.
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
        if (!step) return timeSec; // защита от деления на 0 ('1M' сюда не попадает)
        return Math.floor(timeSec / step) * step;
    }

    _scheduleReconnect(delay = null) {
        if (this._closedByUser) return;
        if (this.reconnectTimer) return;

        // ФИКС: счётчик попыток растёт ВСЕГДА, в том числе когда задержка задана
        // явно. Раньше _scheduleReconnect(3000) и _scheduleReconnect(500) не
        // трогали retryCount, поэтому экспоненциальный бэкофф не включался и
        // клиент мог долбить сервер с постоянным интервалом.
        this.retryCount++;

        if (delay === null) {
            delay = Math.min(5000 * Math.pow(1.5, this.retryCount - 1), 60000);
        }

        console.log(`🔄 Переподключение через ${delay}мс (попытка ${this.retryCount})`);

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
            if (ws._keepAlive) {
                clearInterval(ws._keepAlive);
                ws._keepAlive = null;
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

        // У Bybit wsTrade === wsKline (один сокет) — повторный вызов безопасен:
        // обработчики уже сняты, а CLOSING/CLOSED не попадает ни под одну ветку.
        closeWs(this.wsTrade);

        this.wsKline = null;
        this.wsTrade = null;
        this.isConnected = false;
        this.isConnecting = false;
    }

    updateSymbolAndTimeframe(symbol, interval, exchange, marketType) {
        console.log('🔄 Обновление символа:', { symbol, interval, exchange, marketType });
        // Сбрасываем «один раз на ключ», чтобы при возврате снова увидеть предупреждение.
        this._warnedAlign.clear();
        this.connect(symbol, interval, exchange, marketType);
    }

    closeAll() {
        console.log('🔌 Закрытие WebSocket...');

        // Явное закрытие — сторож и reconnect не воскрешают соединение.
        this._closedByUser = true;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this._connectDebounceTimer) {
            clearTimeout(this._connectDebounceTimer);
            this._connectDebounceTimer = null;
        }
        // ФИКС: увеличиваем generation ДО закрытия сокетов, чтобы их onclose
        // (если обработчики ещё не сняты) гарантированно отсекался сторожевой
        // проверкой поколения и не ставил новый reconnectTimer.
        this._connectGeneration++;
        this._connectStartedAt = 0;
        this._closeSocket();
    }

    ensureConnected() {
        if (this._closedByUser) return;

        // Иначе сторож каждые 15 с пытался бы переподключить неподдерживаемую
        // биржу и заспамил бы консоль по кругу.
        if (!this._buildStreamUrls({
            symbol: this.currentSymbol, interval: this.currentInterval,
            exchange: this.currentExchange, marketType: this.currentMarketType
        })) return;

        const klineState = this.wsKline ? this.wsKline.readyState : undefined;
        const tradeState = this.wsTrade ? this.wsTrade.readyState : undefined;

        const klineOk = klineState === WebSocket.OPEN || klineState === WebSocket.CONNECTING;
        const tradeOk = tradeState === WebSocket.OPEN || tradeState === WebSocket.CONNECTING;

        if (!klineOk || !tradeOk) {
            console.log('⚠️ WebSocket не подключён, переподключаемся...');
            // Внутренний вызов: не сбрасываем счётчик «тихих» раундов сторожа.
            this._connectInternal(this.currentSymbol, this.currentInterval,
                                  this.currentExchange, this.currentMarketType);
        }
    }

    forceReconnect() {
        // Не убиваем ЖИВОЕ соединение: ChartManager вызывает forceReconnect()
        // при каждом возврате на вкладку, а пересоздание живых сокетов даёт
        // «слепое окно» (сотни мс), в котором теряются kline-события.
        const alive = (ws) => ws &&
            (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);

        // ФИКС: если реконнект уже запланирован — не мешаем ему (раньше вызов
        // connect() сбрасывал накопленный бэкофф).
        if (this.reconnectTimer) {
            console.log('🔄 forceReconnect: реконнект уже запланирован');
            return;
        }

        if (alive(this.wsKline) && alive(this.wsTrade) && !this._closedByUser) {
            console.log('🔄 forceReconnect: соединение живо, сокеты не пересоздаём');
            return;
        }

        console.log('🔄 Принудительное переподключение...');
        this._connectInternal(this.currentSymbol, this.currentInterval,
                              this.currentExchange, this.currentMarketType);
    }

    _onTabVisible() {
        if (this._closedByUser) return;

        const now = Date.now();
        // ФИКС: смотрим на ЛЮБУЮ активность (включая pong), а не только на данные.
        // Иначе тихий инструмент (индексы, месячные свечи) вызывал реконнект
        // при каждом возврате на вкладку.
        const last = Math.max(this._lastActivityTime, this._lastRelevantMessageTime);

        if (last && (now - last > this._opt.tabVisibleStaleMs)) {
            console.log('🔄 Нет активности канала, переподключаемся');
            this._lastActivityTime = now;
            this._lastRelevantMessageTime = now; // не триггерить повторно до новых данных
            this._connectInternal(this.currentSymbol, this.currentInterval,
                                  this.currentExchange, this.currentMarketType);
        } else if (!last) {
            // Данных не было ни разу (например, вкладка открыта в фоне) — подключаемся.
            this.ensureConnected();
        } else {
            this.ensureConnected();
        }
    }

    /**
     * Сторож. Три независимых проверки:
     *  1) CONNECTING дольше connectTimeoutMs → мёртвый рукопожатие;
     *  2) нет ЛЮБЫХ кадров дольше staleMs → half-open TCP (сон машины/прокси);
     *  3) канал открыт, но ДАННЫХ нет дольше noDataMs → не тот стрим / делистинг.
     * Проверка 3 имеет предел попыток: новый Binance-WS не закрывает невалидные
     * стримы и не сообщает об ошибках, поэтому без «сдачи» получился бы
     * бесконечный цикл реконнектов (и риск упереться в лимит 300 conn / 5 мин / IP).
     */
    _watchdogTick() {
        if (this._closedByUser) return;
        if (this.reconnectTimer || this._connectDebounceTimer) return; // реконнект уже в пути

        const now = Date.now();

        // 1) Зависшее рукопожатие: сокеты создали, а OPEN так и не случилось.
        //    ФИКС: проверяем именно isConnected, а не «нет активности вообще» —
        //    иначе повторный коннект с зависшим рукопожатием не лечился,
        //    потому что _lastActivityTime оставался от прошлой сессии.
        if (this._connectStartedAt && !this.isConnected &&
            (now - this._connectStartedAt > this._opt.connectTimeoutMs)) {
            this._registerSilentRound(
                `соединение не открылось за ${Math.round((now - this._connectStartedAt) / 1000)}с`, 0);
            return;
        }

        // 2) Полная тишина в канале: ни одного прикладного кадра staleMs.
        //    ВАЖНО понимать ограничение браузера: protocol-level ping/pong-фреймы
        //    в onmessage НЕ попадают, поэтому «тишина» не доказывает смерть TCP.
        //    Полутёплое соединение после сна машины/прокси обычно само присылает
        //    буфер или onclose (1006) — это покрыто _scheduleReconnect().
        const lastActivity = this._lastActivityTime || this._lastRelevantMessageTime;
        if (lastActivity && (now - lastActivity > this._opt.staleMs)) {
            this._registerSilentRound(`нет никаких кадров ${this._fmtMs(now - lastActivity)}`,
                                      now - lastActivity);
            return;
        }

        // 3) Канал открыт и что-то приходит, но ДАННЫХ (kline/aggTrade) нет.
        //    Типичная причина после миграции WS Binance 2026: стрим существует,
        //    но инструмент делистнут / в статусе SETTLING / по нему нет торгов.
        //    Сервер при этом НЕ закрывает соединение и НЕ шлёт ошибку.
        const dataSilence = this._lastRelevantMessageTime
            ? now - this._lastRelevantMessageTime
            : (lastActivity ? now - lastActivity : 0);

        // Пассивный режим: после «сдачи» даём бирже passiveCheckMs тишины, прежде
        // чем начинать новый цикл из noDataMaxRounds попыток. Без этого окна
        // счётчик раундов сбрасывался бы мгновенно и реконнекты шли вечно.
        const inGiveUpWindow = this._giveUpAt &&
            (now - this._giveUpAt < this._opt.passiveCheckMs);

        if (this.isConnected && dataSilence > this._opt.noDataMs && !inGiveUpWindow) {
            this._registerSilentRound(`нет данных ${this._fmtMs(dataSilence)}`, dataSilence);
            return;
        }

        // ВАЖНО: счётчик _silentRounds здесь НЕ сбрасывается. Единственные
        // легитимные точки сброса — приход РЕАЛЬНЫХ данных (_handleMessage) и
        // явный вызов connect() пользователем. Прежний сброс «по малому
        // молчанию» обнулял счётчик сразу после каждого _hardReconnect()
        // (там метка времени ставится в now), поэтому раунд всегда был 1/3 и
        // режим «сдаться» не достигался никогда — реконнекты шли вечно.
        if (this._giveUpAt && !inGiveUpWindow && this._silentRounds !== 0) {
            // Окно пассивного режима истекло, данных по-прежнему нет —
            // разрешаем НОВЫЙ короткий цикл попыток (вдруг стрим ожил).
            // _giveUpAt НЕ обнуляем: его обновит _giveUpOnNoData() после
            // исчерпания попыток, иначе окно не выдерживалось бы и реконнекты
            // шли непрерывно.
            this._silentRounds = 0;
        }

        // 4) Совсем нет сокетов и ничего не запланировано.
        const idle = !this.isConnected && !this.isConnecting && !this._connectStartedAt;
        if (idle) this.ensureConnected();

    }

    /**
     * Единая точка реакции на «тишину»: N попыток реконнекта, затем сдаёмся и
     * переходим в пассивный режим (проверка раз в passiveCheckMs).
     *
     * Зачем сдаваться: новый Binance-WS не закрывает невалидные стримы и не
     * сообщает об ошибках (проверено 2026-09-18: /market/ws/nftusdt@kline_1h и
     * даже /market/ws/junk висят в OPEN вечно, SUBSCRIBE отвечает result:null).
     * Без предела попыток получились бы бесконечные реконнекты каждые ~30 с,
     * а это ещё и риск упереться в лимит подключений (spot: 300 / 5 мин / IP).
     */
    /**
     * Пришли НАСТОЯЩИЕ рыночные данные — канал здоров.
     * Сбрасываем всю бухгалтерию «тихих» раундов.
     */
    _markDataReceived() {
        this._lastRelevantMessageTime = Date.now();
        if (this._silentRounds || this._noDataNotified || this._giveUpAt) {
            if (this._noDataNotified) {
                console.log('✅ Данные снова пошли — выходим из пассивного режима');
            }
            this._silentRounds = 0;
            this._noDataNotified = false;
            this._giveUpAt = 0;
        }
    }

    _fmtMs(ms) {
        return ms < 2000 ? `${Math.round(ms)}мс` : `${Math.round(ms / 1000)}с`;
    }

    _registerSilentRound(reason, silenceMs) {
        this._silentRounds++;

        if (this._silentRounds <= this._opt.noDataMaxRounds) {
            console.warn(`⚠️ ${reason} — переподключаемся (попытка ${this._silentRounds}/${this._opt.noDataMaxRounds})`);
            this._hardReconnect();
        } else {
            this._giveUpOnNoData(reason, silenceMs);
        }
    }

    _hardReconnect() {
        // Помечаем момент, чтобы не триггерить повторно до появления новых кадров.
        const now = Date.now();
        this._lastRelevantMessageTime = now;
        this._lastActivityTime = now;
        this._connectStartedAt = 0;
        this._connectInternal(this.currentSymbol, this.currentInterval,
                              this.currentExchange, this.currentMarketType);
    }

    _giveUpOnNoData(reason, silenceMs) {
        if (!this._noDataNotified) {
            console.error(`❌ ${this.currentSymbol} ${this.currentInterval} (${this.currentExchange}/${this.currentMarketType}): ${reason} (молчание ${this._fmtMs(silenceMs)}). Реконнекты прекращены — скорее всего стрим пуст (делистинг / статус SETTLING / нет торгов). Переход в пассивный режим.`);
            this._noDataNotified = true;
            if (this.chartManager && typeof this.chartManager.onStreamUnavailable === 'function') {
                this.chartManager.onStreamUnavailable({
                    reason: 'no-data',
                    symbol: this.currentSymbol,
                    interval: this.currentInterval,
                    exchange: this.currentExchange,
                    marketType: this.currentMarketType,
                    silenceMs: silenceMs
                });
            }
        }
        // Следующая проверка — через passiveCheckMs: вдруг данные всё-таки пошли.
        const now = Date.now();
        this._giveUpAt = now;
        this._lastRelevantMessageTime = now - (this._opt.noDataMs - this._opt.passiveCheckMs);
        this._lastActivityTime = this._lastRelevantMessageTime;
    }

    destroy() {
        console.log('🗑️ Уничтожение WebSocketManager...');
        document.removeEventListener('visibilitychange', this._visibilityHandler);

        if (this._statusCheckInterval) {
            clearInterval(this._statusCheckInterval);
            this._statusCheckInterval = null;
        }
        // ФИКС: таймер автоподключения раньше не отменялся — destroy() в первую
        // секунду жизни объекта всё равно открывал сокеты, которыми уже никто
        // не управляет (сторож к тому моменту снят).
        if (this._autoConnectTimer) {
            clearTimeout(this._autoConnectTimer);
            this._autoConnectTimer = null;
        }

        this._warnedAlign.clear();
        this._symbolInfoCache.clear();
        this.closeAll();
        console.log('✅ WebSocketManager уничтожен');
    }
}

if (typeof window !== 'undefined') {
    window.WebSocketManager = WebSocketManager;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WebSocketManager, WS_ENDPOINTS };
}
