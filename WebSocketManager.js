

const WS_ENDPOINTS = {
    binance: {
        // После миграции 2026-03-06 kline/aggTrade/ticker/markPrice — ТОЛЬКО в /market.
        // Legacy 'wss://fstream.binance.com/ws' отключён 2026-04-23: сокет открывается
        // и LIST_SUBSCRIPTIONS отвечает, но рыночных данных не будет (проверено зондом).
        futuresMarketBase: 'wss://fstream.binance.com/market/ws',
        futuresMarketStreamBase: 'wss://fstream.binance.com/market/stream?streams=',
        // data-stream.binance.vision — только рыночные данные, порт 443 (реже режется прокси).
        spotBase: 'wss://data-stream.binance.vision/ws',
        spotFallbackBase: 'wss://stream.binance.com:9443/ws'   // W8: теперь реально используется
    },
    bybit: {
        publicBase: 'wss://stream.bybit.com/v5/public'
    }
};

const KA_ID_BASE = 1e9;

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

        this._lastRelevantMessageTime = 0;   // последние РЫНОЧНЫЕ данные (kline/aggTrade)
        this._lastActivityTime = 0;          // ЛЮБОЙ кадр, включая keep-alive-ответ = живой TCP
        this._connectDebounceTimer = null;
        this._statusCheckInterval = null;
        this._autoConnectTimer = null;
        this._connectStartedAt = 0;
        this._silentRounds = 0;
        this._noDataNotified = false;
        this._giveUpAt = 0;
        this._closedByUser = false;
        this._symbolUnavailable = false;     // W3: валидация сказала «нет такого тикера» — не циклим
        this._kaId = KA_ID_BASE;
        this._spotUsingFallback = false;     // W8: какой spot-хост сейчас в ходу
        this._quietWarnedAt = 0;

        const o = Object.assign({
            watchdogIntervalMs: 5000,        // было 15000: быстрее ловим зависший handshake
            staleMs: 50000,                  // нет ЛЮБЫХ кадров (включая keep-alive) → мёртвый TCP.
                                             // 3 пропущенных keep-alive при интервале 15 с = 45 с + запас
            keepAliveIntervalMs: 15000,      // LIST_SUBSCRIPTIONS / {"op":"ping"}
            quietMarketWarnMs: 300000,       // ИНФОРМАЦИОННО: рынок молчит, канал жив
            noDataMaxRounds: 3,              // сколько раз лечим мёртвый TCP, прежде чем сдаться
            passiveCheckMs: 60000,           // пауза после «сдачи»
            connectTimeoutMs: 12000,
            tabVisibleStaleMs: 10000,        // W2: теперь сверяется с АКТИВНОСТЬЮ канала, а не с данными
            validateSymbols: true,
            validateTimeoutMs: 5000,         // v3.1: таймаут лёгкой проверки тикера
            validateTtlMs: 10 * 60 * 1000    // v3.1: кэш вердикта по тикеру
        }, options || {});
        this._opt = o;

        this._warnedAlign = new Set();

        this.currentSymbol = 'BTCUSDT';
        this.currentInterval = '1h';
        this.currentExchange = 'binance';
        this.currentMarketType = 'futures';

        // v3.1: кэш ВЕРДИКТОВ по конкретному тикеру, а не карта всех символов рынка.
        this._symbolVerdictCache = new Map();

        // W6: жёсткий список удалён. Прежний binanceFuturesOnlyTokens был неверен:
        //   BTCDOMUSDT — только futures  (редирект был нужен)
        //   DEFIUSDT   — futures, SETTLING (данных уже нет)
        //   ALTUSDT    — ЕСТЬ НА ОБОИХ рынках, TRADING → редирект ломал выбор пользователя
        // Вместо списка — автоматический кросс-маркет фолбэк по exchangeInfo (_fallbackMarket).

        this._visibilityHandler = () => {
            if (!document.hidden) this._onTabVisible();
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);

        this._statusCheckInterval = setInterval(() => this._watchdogTick(), o.watchdogIntervalMs);

        this._autoConnectTimer = setTimeout(() => {
            this._autoConnectTimer = null;
            this._autoConnect();
        }, 1000);
    }

    _autoConnect() {
        if (this._closedByUser) return;
        // W3: автоподключение стартует через 1с после конструктора. Если к этому
        // моменту тикер уже признан несуществующим (валидация отработала быстрее),
        // без этой проверки _autoConnect сбрасывал _symbolUnavailable через connect()
        // и запускал ровно тот же цикл, который мы только что остановили.
        if (this._symbolUnavailable) {
            console.warn('🚀 WebSocketManager: автоподключение пропущено — тикер признан недействительным');
            return;
        }
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
        return exchange === 'bybit' ? symbol.trim().toUpperCase() : symbol.trim().toLowerCase();
    }

    _spotBase() {
        return this._spotUsingFallback
            ? WS_ENDPOINTS.binance.spotFallbackBase
            : WS_ENDPOINTS.binance.spotBase;
    }

    _buildStreamUrls(ctx) {
        const fs = this.formatSymbol(ctx.symbol, ctx.exchange);

        if (ctx.exchange === 'binance') {
            const isSpot = ctx.marketType === 'spot';
            const base = isSpot ? this._spotBase() : WS_ENDPOINTS.binance.futuresMarketBase;
            return {
                kline: `${base}/${fs}@kline_${ctx.interval}`,
                trade: `${base}/${fs}@aggTrade`
            };
        }

        if (ctx.exchange === 'bybit') {
            const kind = ctx.marketType === 'spot' ? 'spot' : 'linear';
            const url = `${WS_ENDPOINTS.bybit.publicBase}/${kind}`;
            return { kline: url, trade: url };
        }

        return null;
    }

    /** Публичная точка входа: пользователь сменил тикер/таймфрейм/биржу. Полный сброс. */
    connect(symbol, interval, exchange, marketType) {
        this._silentRounds = 0;
        this._noDataNotified = false;
        this._giveUpAt = 0;
        this._symbolUnavailable = false;
        this._spotUsingFallback = false;
        return this._connectInternal(symbol, interval, exchange, marketType);
    }

    /**
     * Внутреннее подключение. НЕ сбрасывает _silentRounds/_giveUpAt/_symbolUnavailable:
     * её вызывает сторож, и сброс счётчика делал бы «сдачу» недостижимой.
     */
    _connectInternal(symbol, interval, exchange, marketType) {
        symbol = (symbol || this.currentSymbol).trim();
        exchange = exchange || this.currentExchange;
        marketType = marketType || this.currentMarketType;
        // Только trim: '1M' (месяц) после toLowerCase() стал бы '1m' (минута).
        interval = (interval || this.currentInterval).trim();

        this.currentSymbol = symbol;
        this.currentInterval = interval;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;

        this._closedByUser = false;
        this.retryCount = 0;
        this._connectStartedAt = 0;
        this._lastRelevantMessageTime = 0;
        this._lastActivityTime = 0;

        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        if (this._connectDebounceTimer) clearTimeout(this._connectDebounceTimer);

        this._connectDebounceTimer = setTimeout(() => {
            this._connectDebounceTimer = null;
            this._doConnect();
        }, 100);
    }

    /**
     * W9: сокет создаётся СРАЗУ, валидация тикера идёт параллельно.
     * Прежний `await _validateSymbol()` ДО создания сокета добавлял до 8 с
     * (таймаут exchangeInfo) к каждому переключению тикера и к каждому реконнекту,
     * а _connectStartedAt при этом уже тикал — сторож успевал объявить
     * «соединение не открылось за Nс» и сделать _hardReconnect прямо во время
     * ожидания REST (воспроизведено тестом W9: 4 сокета вместо одного).
     */
    _doConnect() {
        const generation = ++this._connectGeneration;
        this.isConnecting = true;

        this._closeSocket();

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
            this._symbolUnavailable = true;      // W3: не циклим каждые 5 с
            return;
        }

        this._connectStartedAt = Date.now();     // теперь строго перед созданием сокета

        console.log('🔌 KLINE:', urls.kline);
        console.log('🔌 TRADE:', urls.trade);

        if (subContext.exchange === 'bybit') {
            this.wsKline = this._createWebSocket(urls.kline, 'bybit', generation, subContext);
            this.wsTrade = this.wsKline;
        } else {
            this.wsKline = this._createWebSocket(urls.kline, 'kline', generation, subContext);
            this.wsTrade = this._createWebSocket(urls.trade, 'trade', generation, subContext);
        }

        this._updateConnectionState();

        // Валидация — параллельно, результат приходит уже на живой сокет.
        this._validateSymbolAsync(subContext, generation);
    }

    /**
     * W3 + W6: проверяем тикер по exchangeInfo НЕ блокируя подключение.
     * Если на запрошенном рынке тикера нет — пробуем соседний рынок (это заменило
     * жёсткий список binanceFuturesOnlyTokens, в котором были ошибки).
     */
    async _validateSymbolAsync(ctx, generation) {
        if (!this._opt.validateSymbols || typeof fetch !== 'function') return;
        try {
            const verdict = await this._checkSymbol(ctx.exchange, ctx.marketType, ctx.symbol);
            if (generation !== this._connectGeneration || this._closedByUser) return;

            if (verdict === 'not-trading') {
                console.warn(`⚠️ ${ctx.symbol}: статус не TRADING (делистинг/расчёт) — данных в стриме может не быть`);
                return;
            }
            if (verdict !== 'missing') return;

            // На запрошенном рынке тикера нет. Смотрим соседний (только для Binance).
            if (ctx.exchange === 'binance') {
                const alt = ctx.marketType === 'spot' ? 'futures' : 'spot';
                const altVerdict = await this._checkSymbol('binance', alt, ctx.symbol);
                if (generation !== this._connectGeneration || this._closedByUser) return;

                if (altVerdict === 'ok') {
                    console.warn(`↪ ${ctx.symbol} нет на binance/${ctx.marketType}, но торгуется на binance/${alt} — переключаемся`);
                    this._connectInternal(ctx.symbol, ctx.interval, 'binance', alt);
                    return;
                }
            }

            // Тикера нет нигде — останавливаемся БЕЗ цикла реконнектов.
            this._symbolUnavailable = true;
            this._connectStartedAt = 0;   // иначе ветка «не открылось за Nс» воскресит подключение
            console.error(`❌ ${ctx.symbol} не торгуется на ${ctx.exchange}/${ctx.marketType} — подписка невозможна. Реконнекты остановлены.`);
            if (this.chartManager && typeof this.chartManager.onStreamUnavailable === 'function') {
                this.chartManager.onStreamUnavailable({ reason: 'symbol-not-found', ...ctx });
            }
            this._closeSocket();
        } catch (e) {
            console.warn('⚠️ валидация символа не выполнена:', e && e.message);
        }
    }

    /**
     * v3.1. Проверка ОДНОГО тикера вместо выкачивания всего exchangeInfo.
     *
     * Замеры 2026-09-18 (probe8.js / probe9.js):
     *
     *   binance SPOT    exchangeInfo        17 198 КБ  ~1030мс   (3705 записей)
     *   binance FUTURES exchangeInfo         1 097 КБ   ~343мс   (905 записей)
     *   bybit   linear  instruments-info       796 КБ    ~77мс   (879 записей)
     *
     *   api/v3/ticker/price?symbol=X            45 Б   ~260мс
     *   fapi/v1/ticker/price?symbol=X           60 Б   ~250мс
     *   bybit instruments-info?symbol=X       1047 Б    ~25мс
     *
     * Точечный запрос в ~28 000 раз легче для spot и при этом даёт БОЛЬШЕ информации:
     *   HTTP 400 + code -1121 "Invalid symbol."  → тикера нет            ('missing')
     *   HTTP 200 + {"symbol","price"}            → торгуется             ('ok')
     *   HTTP 200 + {}                            → есть, но не торгуется ('not-trading')
     *      (проверено на DEFIUSDT: статус SETTLING, цена уже не отдаётся)
     *   Bybit: list[0].status = 'Trading' / 'Settling' / 'Closed' — статус напрямую.
     *
     * Побочно снимается проблема пагинации Bybit: прежний запрос с limit=1000 упирался
     * в потолок (linear = 879 записей, 88% лимита), и первый же новый листинг за
     * пределами тысячи дал бы ложный 'missing' на валидном тикере. Для одного символа
     * пагинация не нужна в принципе.
     */
    async _checkSymbol(exchange, marketType, symbol) {
        const sym = String(symbol || '').trim().toUpperCase();
        if (!sym) return 'unknown';

        const cacheKey = `${exchange}:${marketType}:${sym}`;
        const cached = this._symbolVerdictCache.get(cacheKey);
        if (cached && Date.now() - cached.at < this._opt.validateTtlMs) return cached.verdict;

        let url;
        if (exchange === 'binance') {
            url = marketType === 'spot'
                ? `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(sym)}`
                : `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${encodeURIComponent(sym)}`;
        } else if (exchange === 'bybit') {
            const category = marketType === 'spot' ? 'spot' : 'linear';
            url = `https://api.bybit.com/v5/market/instruments-info?category=${category}&symbol=${encodeURIComponent(sym)}`;
        } else {
            return 'unknown';
        }

        let verdict = 'unknown';
        const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), this._opt.validateTimeoutMs) : null;
        try {
            const r = await fetch(url, { signal: ctrl ? ctrl.signal : undefined });

            if (r.status === 400 || r.status === 404) {
                verdict = 'missing';
            } else if (r.status === 429 || r.status === 418 || r.status >= 500) {
                // Рейт-лимит или сбой сервера — НЕ повод объявлять тикер несуществующим.
                verdict = 'unknown';
            } else if (r.ok) {
                const d = await r.json();
                if (exchange === 'binance') {
                    verdict = (d && d.price !== undefined && d.price !== null && d.price !== '')
                        ? 'ok' : 'not-trading';
                } else {
                    const list = (d && d.retCode === 0 && d.result && d.result.list) || [];
                    verdict = !list.length ? 'missing'
                        : (String(list[0].status || '').toUpperCase() === 'TRADING' ? 'ok' : 'not-trading');
                }
            }
        } catch (e) {
            console.warn('⚠️ проверка тикера не выполнена (сеть/таймаут) — подписываемся как есть:', e && e.message);
            verdict = 'unknown';
        } finally {
            if (timer) clearTimeout(timer);
        }

        // 'unknown' НЕ кэшируем: это переходный вердикт, его надо перепроверить.
        if (verdict !== 'unknown') {
            this._symbolVerdictCache.set(cacheKey, { at: Date.now(), verdict });
        }
        return verdict;
    }

    _nextKaId() { return ++this._kaId; }

    _createWebSocket(url, type, generation, subContext) {
        let ws;
        try {
            ws = new WebSocket(url);
        } catch (e) {
            console.error(`❌ Ошибка создания ${type} WebSocket:`, e);
            this._updateConnectionState();
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

            // W4: ЛЮБАЯ отправка обёрнута в try/catch, а _updateConnectionState()
            // вызывается безусловно в конце. Прежний ws.send() без защиты бросал
            // исключение, обрывал весь onopen, и isConnected оставался false при
            // живом OPEN-сокете — сторож после этого уходил в вечные реконнекты.
            try {
                if (type === 'bybit') {
                    const bi = this.getExchangeInterval(subContext.interval, subContext.exchange);
                    const bs = this.formatSymbol(subContext.symbol, subContext.exchange);
                    ws.send(JSON.stringify({
                        op: 'subscribe',
                        args: ['kline.' + bi + '.' + bs, 'publicTrade.' + bs]
                    }));
                }
            } catch (e) {
                console.error(`❌ ${type.toUpperCase()}: не удалось отправить подписку:`, e && e.message);
            }

            // Прикладной keep-alive. Для Bybit это {"op":"ping"} (был и раньше),
            // для Binance — LIST_SUBSCRIPTIONS (проверено на живых эндпоинтах:
            // отвечает и на /market/ws, и на data-stream.binance.vision/ws,
            // в том числе когда рыночных данных нет вовсе).
            clearInterval(ws._keepAlive);
            ws._keepAlive = setInterval(() => {
                if (generation !== this._connectGeneration || this._closedByUser) {
                    clearInterval(ws._keepAlive); ws._keepAlive = null; return;
                }
                if (ws.readyState !== WebSocket.OPEN) return;
                const payload = (type === 'bybit')
                    ? { op: 'ping', req_id: 'ka' + this._nextKaId() }
                    : { method: 'LIST_SUBSCRIPTIONS', id: this._nextKaId() };
                try { ws.send(JSON.stringify(payload)); } catch (e) {}
            }, this._opt.keepAliveIntervalMs);

            this._updateConnectionState();
        };

        ws.onmessage = (event) => {
            if (generation !== this._connectGeneration) return;
            this._lastActivityTime = Date.now();   // ЛЮБОЙ кадр, включая keep-alive-ответ
            this._handleMessage(event.data, type, subContext);
        };

        ws.onclose = (event) => {
            if (generation !== this._connectGeneration) return;

            console.log(`🔌 ${type.toUpperCase()} WebSocket закрыт:`, event.code, event.reason);

            clearInterval(ws._pingInterval); ws._pingInterval = null;
            clearInterval(ws._keepAlive);    ws._keepAlive = null;

            // W8: если spot-хост data-stream.binance.vision не живёт — пробуем :9443.
            // Событие abnormal closure (1006) до открытия — типичный признак того,
            // что хост заблокирован прокси/файрволом.
            if (subContext.exchange === 'binance' && subContext.marketType === 'spot' &&
                event.code === 1006 && !this._spotUsingFallback) {
                this._spotUsingFallback = true;
                console.warn('↪ spot: data-stream.binance.vision недоступен, переключаемся на stream.binance.com:9443');
            } else if (subContext.exchange === 'binance' && subContext.marketType === 'spot' &&
                       event.code === 1006 && this._spotUsingFallback) {
                this._spotUsingFallback = false;   // фолбэк тоже не смог — возвращаемся к основному
            }

            this._updateConnectionState();
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

    _updateConnectionState() {
        const open = (ws) => !!ws && ws.readyState === WebSocket.OPEN;
        const pending = (ws) => !!ws && ws.readyState === WebSocket.CONNECTING;

        // Bybit: один сокет на оба канала.
        const klineState = open(this.wsKline);
        const tradeState = open(this.wsTrade);
        const wasConnected = this.isConnected;

        if (klineState) {
            this.isConnecting = false;

            // Соединение всё-таки открылось — отменяем запланированный реконнект,
            // иначе живой канал разорвётся «на ровном месте» через N секунд.
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
                console.log('✅ Соединение открылось — запланированный реконнект отменён');
            }

            if (!wasConnected) {
                this.isConnected = true;
                this.retryCount = 0;
                const now = Date.now();
                this._lastRelevantMessageTime = now;
                this._lastActivityTime = now;
                // ВАЖНО: _silentRounds здесь НЕ обнуляется. Сброс легитимен только
                // по ПРИХОДУ ДАННЫХ (_markDataReceived) или по явному connect().
                // Obnulение на факте открытия сокета делало режим «сдаться»
                // недостижимым: сокет открывается, молчит, рвётся, снова открывается —
                // и раунд каждый раз «1/N». Ровно тот вечный цикл, что был в v2.
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
            if (raw.stream && raw.data && typeof raw.data === 'object') raw = raw.data;

            // Сервер Binance предупреждает о скором закрытии — переподключаемся заранее.
            if (raw.e === 'serverShutdown') {
                console.warn('⚠️ serverShutdown от биржи — переподключаемся заранее');
                this._scheduleReconnect(1000);
                return;
            }

            // W5: keep-alive ответ Binance = {"result":[...],"id":<наш id>}.
            // Живость уже учтена в onmessage (_lastActivityTime), здесь просто
            // не пускаем служебный кадр в бизнес-логику.
            if (typeof raw.id === 'number' && raw.id > KA_ID_BASE && ('result' in raw)) return;

            // W5: реальный ответ Bybit на {"op":"ping"} — это
            //   {"success":true,"ret_msg":"pong","conn_id":"...","req_id":"...","op":"ping"}
            // Поля op:"pong" НЕ существует, поэтому прежнее условие `raw.op === 'pong'`
            // не срабатывало никогда. Проверяем оба варианта.
            if (raw.op === 'pong' || raw.ret_msg === 'pong') return;

            if (raw.op === 'subscribe' || raw.topic === 'subscribe') {
                if (raw.success === false) console.error('❌ Bybit отклонил подписку:', raw.ret_msg);
                return;
            }

            const chartManager = this.chartManager ||
                (typeof window !== 'undefined' ? window.chartManager : null);
            if (!chartManager) { console.warn('⚠️ chartManager не найден'); return; }
            if (!subContext) return;

            if (subContext.exchange === 'binance') {
                if (raw.e === 'kline' && raw.k) {
                    const k = raw.k;
                    const msgSymbol = raw.s ? raw.s.toUpperCase() : null;
                    if (msgSymbol && msgSymbol !== subContext.symbol.toUpperCase()) return;
                    if (k.i && k.i !== subContext.interval) return;

                    this._markDataReceived();

                    let candleTime = Math.floor(k.t / 1000);
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
                            open: parseFloat(k.o), high: parseFloat(k.h),
                            low: parseFloat(k.l), close: parseFloat(k.c),
                            volume: parseFloat(k.v), quoteVolume: parseFloat(k.q || 0),
                            isClosed: k.x === true
                        }, raw.E || Date.now(), {
                            symbol: subContext.symbol, interval: subContext.interval
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
                                chartManager._syncPriceLine({ time: Math.floor(raw.T / 1000), price });
                            }
                        }
                    }
                }
            }
            else if (subContext.exchange === 'bybit' && raw.topic) {
                const parts = raw.topic.split('.');
                let msgSymbol = null;

                if (raw.topic.startsWith('kline.') && parts.length >= 3) msgSymbol = parts[2].toUpperCase();
                else if (raw.topic.startsWith('publicTrade.') && parts.length >= 2) msgSymbol = parts[1].toUpperCase();

                if (!msgSymbol || msgSymbol !== subContext.symbol.toUpperCase()) return;

                if (raw.topic.startsWith('kline.') && parts.length >= 2) {
                    if (parts[1] !== this.getExchangeInterval(subContext.interval, 'bybit')) return;
                }

                this._markDataReceived();

                if (raw.topic.startsWith('kline.') && raw.data && raw.data.length) {
                    const k = raw.data[raw.data.length - 1];   // свежие данные в КОНЦЕ батча
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
                            open: parseFloat(k.open), high: parseFloat(k.high),
                            low: parseFloat(k.low), close: parseFloat(k.close),
                            volume: parseFloat(k.volume), quoteVolume: parseFloat(k.turnover || 0),
                            isClosed: k.confirm === true
                        }, raw.ts || Date.now(), {
                            symbol: subContext.symbol, interval: subContext.interval
                        });
                    }
                } else if (raw.topic.startsWith('publicTrade.') && raw.data && raw.data.length) {
                    const tradeData = raw.data[raw.data.length - 1];
                    const price = parseFloat(tradeData.p);
                    if (!isNaN(price) && price > 0) {
                        if (!chartManager.currentSymbol ||
                            chartManager.currentSymbol.toUpperCase() === subContext.symbol.toUpperCase()) {
                            if (typeof chartManager._syncPriceLine === 'function') {
                                chartManager._syncPriceLine({ time: Math.floor(tradeData.T / 1000), price });
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
        // '8h' и '3d' добавлены явно: раньше их не было, и срабатывал дефолт 3600,
        // который СЛУЧАЙНО давал верный результат (3600 — делитель 28800 и 259200).
        // Полагаться на это не стоит.
        // '1M' = 0 намеренно: календарный месяц постоянным шагом не выражается,
        // любой внешний код обязан идти через _alignTimeToInterval().
        // [FIX-M3] '2h' в UI (TF_LABELS) также отсутствует и оставлен ради
        // обратной совместимости со старыми кэшами/рисунками.
        const map = {
            '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
            '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '8h': 28800,
            '12h': 43200, '1d': 86400, '3d': 259200, '1w': 604800, '1M': 0
        };
        return Object.prototype.hasOwnProperty.call(map, interval) ? map[interval] : 3600;
    }

    _alignTimeToInterval(timeSec, interval) {
        if (interval === '1w') {
            const d = new Date(timeSec * 1000);
            const daysSinceMonday = (d.getUTCDay() + 6) % 7;   // Пн→0 … Вс→6
            const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(),
                                    d.getUTCDate() - daysSinceMonday, 0, 0, 0, 0);
            return Math.floor(monday / 1000);
        }
        if (interval === '1M') {
            const d = new Date(timeSec * 1000);
            return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0) / 1000);
        }
        const step = this._getIntervalSeconds(interval);
        if (!step) return timeSec;
        return Math.floor(timeSec / step) * step;
    }

    _scheduleReconnect(delay = null) {
        if (this._closedByUser) return;
        if (this.reconnectTimer) return;

        this.retryCount++;
        if (delay === null) delay = Math.min(5000 * Math.pow(1.5, this.retryCount - 1), 60000);

        console.log(`🔄 Переподключение через ${delay}мс (попытка ${this.retryCount})`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this._doConnect();
        }, delay);
    }

    _closeSocket() {
        const closeWs = (ws) => {
            if (!ws) return;
            clearInterval(ws._pingInterval); ws._pingInterval = null;
            clearInterval(ws._keepAlive);    ws._keepAlive = null;

            ws.onopen = null; ws.onclose = null; ws.onerror = null; ws.onmessage = null;
            // [FIX-M4] хендлеры снимаются ДО close. Единичная ошибка консоли от самого
            // Chromium «Ping received after close» — сетевая гонка уровня браузера
            // (пинг биржи приходит во время close-handshake); страницным кодом не
            // убирается, безобидна и внесена в белый список tests/regression.test.js.
            try {
                if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'User disconnect');
                else if (ws.readyState === WebSocket.CONNECTING) ws.close();
            } catch (e) {}
        };

        closeWs(this.wsKline);
        closeWs(this.wsTrade);   // у Bybit это тот же объект — повторный вызов безопасен

        this.wsKline = null;
        this.wsTrade = null;
        this.isConnected = false;
        this.isConnecting = false;
    }

    updateSymbolAndTimeframe(symbol, interval, exchange, marketType) {
        console.log('🔄 Обновление символа:', { symbol, interval, exchange, marketType });
        this._warnedAlign.clear();
        this.connect(symbol, interval, exchange, marketType);
    }

    closeAll() {
        console.log('🔌 Закрытие WebSocket...');
        this._closedByUser = true;

        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        if (this._connectDebounceTimer) { clearTimeout(this._connectDebounceTimer); this._connectDebounceTimer = null; }
        this._connectGeneration++;   // ДО закрытия: onclose отсекутся по поколению
        this._connectStartedAt = 0;
        this._closeSocket();
    }

    ensureConnected() {
        if (this._closedByUser || this._symbolUnavailable) return;   // W3: не циклим

        if (!this._buildStreamUrls({
            symbol: this.currentSymbol, interval: this.currentInterval,
            exchange: this.currentExchange, marketType: this.currentMarketType
        })) return;

        const alive = (ws) => ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);
        if (!alive(this.wsKline) || !alive(this.wsTrade)) {
            console.log('⚠️ WebSocket не подключён, переподключаемся...');
            this._connectInternal(this.currentSymbol, this.currentInterval,
                                  this.currentExchange, this.currentMarketType);
        }
    }

    forceReconnect() {
        const alive = (ws) => ws &&
            (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);

        if (this.reconnectTimer) { console.log('🔄 forceReconnect: реконнект уже запланирован'); return; }

        if (alive(this.wsKline) && alive(this.wsTrade) && !this._closedByUser) {
            console.log('🔄 forceReconnect: соединение живо, сокеты не пересоздаём');
            return;
        }

        console.log('🔄 Принудительное переподключение...');
        this._connectInternal(this.currentSymbol, this.currentInterval,
                              this.currentExchange, this.currentMarketType);
    }

    /**
     * W2: при возврате на вкладку смотрим на АКТИВНОСТЬ КАНАЛА (keep-alive-ответы),
     * а не на рыночные данные. Прежняя проверка по данным с порогом 10 с рвала
     * живое соединение на любом тихом инструменте: замеренная нормальная тишина
     * 0GUSDT — 46 с, ANETUSDT — больше 110 с.
     */
    _onTabVisible() {
        if (this._closedByUser) return;

        const now = Date.now();

        // Страница могла быть заморожена: если сам таймер сторожа долго не тикал,
        // отсчёты бессмысленны — перетариваем метки и не рвём сокеты.
        const lag = now - (this._lastWatchdogTick || now);
        this._lastWatchdogTick = now;
        if (lag > 30000) {
            console.warn(`⏱️ Страница была заморожена ${Math.round(lag / 1000)}с — отсчёт сброшен, сокеты не трогаем`);
            this._lastActivityTime = now;
            this._lastRelevantMessageTime = now;
            this._connectStartedAt = this._connectStartedAt ? now : 0;
            this.ensureConnected();
            return;
        }

        if (this._lastActivityTime && (now - this._lastActivityTime > this._opt.tabVisibleStaleMs)) {
            console.log('🔄 Канал не отвечает на keep-alive, переподключаемся');
            this._connectInternal(this.currentSymbol, this.currentInterval,
                                  this.currentExchange, this.currentMarketType);
        } else {
            this.ensureConnected();
        }
    }

    /**
     * Сторож. Две проверки ЖИВОСТИ (обе дают реконнект) и одна ИНФОРМАЦИОННАЯ.
     *
     *  1) CONNECTING дольше connectTimeoutMs → зависшее рукопожатие;
     *  2) нет НИ ОДНОГО кадра (включая keep-alive-ответы) дольше staleMs → мёртвый TCP;
     *  3) канал жив, но рынок молчит → ТОЛЬКО предупреждение, реконнекта нет.
     */
    _watchdogTick() {
        if (this._closedByUser) return;
        this._lastWatchdogTick = Date.now();

        // W3: тикер признан несуществующим — сторож не должен воскрешать подключение.
        // Без этой проверки _connectStartedAt оставался ненулевым после _closeSocket(),
        // и ветка «соединение не открылось за Nс» запускала новый круг каждые
        // connectTimeoutMs, хотя reconnect-логика тут принципиально не поможет.
        if (this._symbolUnavailable) return;

        if (this.reconnectTimer || this._connectDebounceTimer) return;   // реконнект уже в пути
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;  // нет сети — не жжём попытки

        const now = Date.now();

        // (1) Зависшее рукопожатие. Отсчёт строго от создания ТЕКУЩЕГО сокета.
        if (this._connectStartedAt && !this.isConnected &&
            (now - this._connectStartedAt > this._opt.connectTimeoutMs)) {
            this._registerSilentRound(
                `соединение не открылось за ${Math.round((now - this._connectStartedAt) / 1000)}с`, 0);
            return;
        }

        // (2) Мёртвый TCP: keep-alive ходит каждые keepAliveIntervalMs, поэтому
        //     отсутствие ЛЮБЫХ кадров staleMs — это уже настоящая авария,
        //     а не тихий рынок.
        const lastActivity = this._lastActivityTime || this._lastRelevantMessageTime;
        if (this.isConnected && lastActivity && (now - lastActivity > this._opt.staleMs)) {
            this._registerSilentRound(`канал не отвечает ${this._fmtMs(now - lastActivity)} (keep-alive молчит)`,
                                      now - lastActivity);
            return;
        }

        // (3) Рынок молчит, канал жив. НИКАКОГО реконнекта: разрыв живого сокета
        //     теряет kline-события и даёт «слепое окно» на графике.
        const dataSilence = this._lastRelevantMessageTime ? now - this._lastRelevantMessageTime : 0;
        if (this.isConnected && dataSilence > this._opt.quietMarketWarnMs &&
            (now - this._quietWarnedAt > this._opt.quietMarketWarnMs)) {
            this._quietWarnedAt = now;
            console.info(`ℹ️ ${this.currentSymbol} ${this.currentInterval}: рынок молчит ${this._fmtMs(dataSilence)}, ` +
                         `канал жив (keep-alive отвечает). Реконнект не требуется.`);
            if (this.chartManager && typeof this.chartManager.onQuietMarket === 'function') {
                try {
                    this.chartManager.onQuietMarket({
                        symbol: this.currentSymbol, interval: this.currentInterval,
                        exchange: this.currentExchange, marketType: this.currentMarketType,
                        silenceMs: dataSilence
                    });
                } catch (e) {}
            }
        }

        // После «сдачи» даём бирже passiveCheckMs покоя, затем разрешаем новый цикл.
        const inGiveUpWindow = this._giveUpAt && (now - this._giveUpAt < this._opt.passiveCheckMs);
        if (this._giveUpAt && !inGiveUpWindow && this._silentRounds !== 0) this._silentRounds = 0;

        // (4) Совсем нет сокетов и ничего не запланировано.
        const idle = !this.isConnected && !this.isConnecting && !this._connectStartedAt;
        if (idle && !this._symbolUnavailable) this.ensureConnected();
    }

    /** Пришли НАСТОЯЩИЕ рыночные данные — канал здоров, бухгалтерия обнуляется. */
    _markDataReceived() {
        this._lastRelevantMessageTime = Date.now();
        if (this._silentRounds || this._noDataNotified || this._giveUpAt) {
            if (this._noDataNotified) console.log('✅ Данные снова пошли — выходим из пассивного режима');
            this._silentRounds = 0;
            this._noDataNotified = false;
            this._giveUpAt = 0;
        }
    }

    _fmtMs(ms) {
        if (ms < 0) return '0мс';                     // W7: отрицательной давности больше не бывает
        return ms < 2000 ? `${Math.round(ms)}мс` : `${Math.round(ms / 1000)}с`;
    }

    /**
     * Реакция на МЁРТВЫЙ КАНАЛ (не на тишину рынка!): N попыток, затем сдаёмся
     * и переходим в пассивный режим. Защита от упора в лимит
     * 300 соединений / 5 мин / IP, который общий на IP с PriceManager.
     */
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
        this._connectStartedAt = 0;
        this._connectInternal(this.currentSymbol, this.currentInterval,
                              this.currentExchange, this.currentMarketType);
    }

    _giveUpOnNoData(reason, silenceMs) {
        if (!this._noDataNotified) {
            console.error(`❌ ${this.currentSymbol} ${this.currentInterval} (${this.currentExchange}/${this.currentMarketType}): ${reason}. ` +
                          `Реконнекты прекращены — переход в пассивный режим.`);
            this._noDataNotified = true;
            if (this.chartManager && typeof this.chartManager.onStreamUnavailable === 'function') {
                this.chartManager.onStreamUnavailable({
                    reason: 'channel-dead',
                    symbol: this.currentSymbol, interval: this.currentInterval,
                    exchange: this.currentExchange, marketType: this.currentMarketType,
                    silenceMs: silenceMs
                });
            }
        }
        // W7: метки больше НЕ уводятся в будущее. Прежнее
        //   _lastRelevantMessageTime = now - (noDataMs - passiveCheckMs)
        // при noDataMs < passiveCheckMs давало now + 30000, то есть отметку
        // в будущем; отрицательная «давность» потом попадала в логи.
        // Паузу полностью обеспечивает _giveUpAt + inGiveUpWindow.
        this._giveUpAt = Date.now();
    }

    /** Диагностика для консоли. */
    getStatus() {
        const now = Date.now();
        const age = (t) => t ? Math.round((now - t) / 1000) + 'с' : '—';
        const rs = (ws) => ws ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState] : 'нет';
        return {
            target: `${this.currentSymbol} ${this.currentInterval} ${this.currentExchange}/${this.currentMarketType}`,
            isConnected: this.isConnected,
            kline: rs(this.wsKline),
            trade: rs(this.wsTrade),
            попыток: this.retryCount,
            тихихРаундов: this._silentRounds,
            сдались: !!this._giveUpAt,
            тикерНеНайден: this._symbolUnavailable,
            кадровНазад: age(this._lastActivityTime),
            данныхНазад: age(this._lastRelevantMessageTime),
            spotFallback: this._spotUsingFallback
        };
    }

    destroy() {
        console.log('🗑️ Уничтожение WebSocketManager...');
        document.removeEventListener('visibilitychange', this._visibilityHandler);

        if (this._statusCheckInterval) { clearInterval(this._statusCheckInterval); this._statusCheckInterval = null; }
        if (this._autoConnectTimer) { clearTimeout(this._autoConnectTimer); this._autoConnectTimer = null; }

        this._warnedAlign.clear();
        this._symbolVerdictCache.clear();
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
