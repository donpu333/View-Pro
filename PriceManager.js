

class PriceManager {
    // «нет поля» в delta-сообщении ≠ 0. Возвращаем undefined, чтобы _setPrice сохранил старое.
    static _num(v) {
        if (v === undefined || v === null || v === '') return undefined;
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : undefined;
    }

    static _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    constructor(options = {}) {
        this.prices = new Map();
        this.subscribers = new Map();
        this.connections = {};
        this.reconnectTimers = new Map();
        this.pingIntervals = new Map();
        this._pendingUpdates = new Map();
        this._flushTimerId = null;
        this._cacheTimers = new Map();       // fix 17: callback -> timerId, чтобы отменять
        this._resubTimers = new Map();       // fix 12: ключ -> timerId размазанной подписки

        this._restPollInterval = null;
        this._restPollTimer = null;
        this._heartbeatInterval = null;
        this._sweepInterval = null;
        this._lastWsMessage = {};
        this._connectionAttempts = {};
        this._bybitSubscriptions = { linear: new Set(), spot: new Set() };
        this._binanceSubscriptions = { futures: new Set(), spot: new Set() };  // A
        this._binanceMode = { futures: 'idle', spot: 'idle' };                // idle|combined|arr
        this._binanceUrlStreams = { futures: new Set(), spot: new Set() };
        this._binanceSubQueue = { futures: [], spot: [] };                    // D
        this._binanceSubTimer = { futures: null, spot: null };
        this._lastHeartbeatTick = 0;                                          // B
        this._connectionState = {};
        this._initInProgress = false;
        this._destroyed = false;
        this._restPollInFlight = false;      // fix 4
        this._wakeCheckTimerId = null;

        this._visibilityHandler = null;
        this._pageHideHandler = null;        // fix 9
        this._onlineHandler = null;

        this.config = {
            reconnectDelay: 15000,
            maxReconnectDelay: 120000,
            restPollInterval: 60000,           // [ANTI-BAN] было 10с: алерты и так получают цены по WS, REST — лишь страховка
            bybitPingInterval: 15000,
            startupDelay: 2000,
            flushInterval: 100,
            fetchTimeout: 9000,               // fix 5
            zombieTimeout: 30000,
            stalePriceTtl: 5 * 60 * 1000,     // fix 16
            spotBatchSize: 20,                // fix 6: лимит символов в ?symbols= у spot
            futuresSingleSymbolMax: 30,       // fix 6: 30×weight1 < weight40 полного дампа
            bybitSingleSymbolMax: 10,         // fix 6
            resubscribeBatchDelay: 120,       // fix 12: ~8 сообщений/с
            useCombinedStreams: true,         // A: false = прежнее поведение (!ticker@arr)
            maxCombinedStreams: 900,          // A: лимит Binance — 1024 потока на соединение
            binanceSubMsgInterval: 250,       // D: 4 сообщ/с — под лимитом 5/с у SPOT
            binanceSubBatchSize: 100,         // D: параметров в одном SUBSCRIBE-сообщении
            heartbeatTickLagMs: 15000         // B: порог «страница была заморожена»
        };
        Object.assign(this.config, options);

        // fix 11: единая точка принудительного реконнекта вместо дублирующихся if/else-цепочек
        this._connectors = {
            'binance:futures': () => this._connectBinanceFutures(),
            'binance:spot':    () => this._connectBinanceSpot(),
            'bybit:linear':    () => this._connectBybitLinear(),
            'bybit:spot':      () => this._connectBybitSpot()
        };

        this._init();
    }

    // =========================================================================
    //  ЖИЗНЕННЫЙ ЦИКЛ
    // =========================================================================
    _init() {
        if (this._initInProgress || this._destroyed) return;
        this._initInProgress = true;

        // A: при useCombinedStreams соединение создаётся только когда есть подписчики.
        // При useCombinedStreams:false — как раньше, сразу !ticker@arr.
        [() => this._connectBinanceFutures(), () => this._connectBinanceSpot()]
            .forEach((fn, i) => setTimeout(fn, i * this.config.startupDelay));

        this._restPollInterval = setInterval(() => this._pollAlertPricesViaRest(), this.config.restPollInterval);
        this._restPollTimer = setTimeout(() => this._pollAlertPricesViaRest(), 1500);
        this._heartbeatInterval = setInterval(() => this._checkHeartbeats(), 5000);
        this._sweepInterval = setInterval(() => this._sweepStalePrices(), 60000);   // fix 16

        if (typeof window !== 'undefined') {
            // fix 9: pagehide, а не beforeunload. beforeunload fires и при ОТМЕНЁННОЙ
            // навигации (диалог «Покинуть сайт?» → «Остаться»), после чего менеджер
            // оставался мёртвым навсегда. persisted=true — страница ушла в bfcache,
            // её могут вернуть, убивать соединения нельзя.
            this._pageHideHandler = (e) => { if (!e?.persisted) this.close(); };
            window.addEventListener('pagehide', this._pageHideHandler);

            // мгновенный реконнект после восстановления сети
            this._onlineHandler = () => {
                if (this._destroyed) return;
                for (const key of Object.keys(this._connectors)) {
                    const ws = this.connections[key];
                    const active = ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);
                    if (active) continue;
                    if (this._connectionState[key] === 'idle') continue;   // слушать нечего — не воскрешаем
                    const mt = key.split(':')[1];
                    if (key.indexOf('binance:') === 0 && this._desiredBinanceMode(mt) === 'idle') continue;
                    this._forceReconnect(key, 'network online');
                }
                this._pollAlertPricesViaRest();
            };
            window.addEventListener('online', this._onlineHandler);
        }

        if (typeof document !== 'undefined') {
            this._visibilityHandler = () => {
                if (this._destroyed) return;
                if (document.hidden) return;

                const now = Date.now();
                for (const key in this.connections) {
                    if (this.connections[key]?.readyState === WebSocket.OPEN) this._lastWsMessage[key] = now;
                }

                if (this._wakeCheckTimerId) clearTimeout(this._wakeCheckTimerId);
                this._wakeCheckTimerId = setTimeout(() => {
                    this._wakeCheckTimerId = null;
                    if (this._destroyed || document.hidden) return;
                    const checkNow = Date.now();
                    for (const key in this.connections) {
                        const ws = this.connections[key];
                        if (ws?.readyState !== WebSocket.OPEN) continue;
                        if (checkNow - (this._lastWsMessage[key] || 0) > 5000) {
                            console.warn(`💔 ${key} не ожил после сна вкладки. Реконнект...`);
                            this._forceReconnect(key, 'Zombie after sleep');   // fix 11
                        }
                    }
                }, 5000);
            };
            document.addEventListener('visibilitychange', this._visibilityHandler);
        }

        console.log('✅ PriceManager v20 запущен (combined-стримы + защита от сна вкладки)');
    }

    /** fix 9: симметричный close() — позволяет воскресить менеджер вместо перезагрузки вкладки. */
    start() {
        if (!this._destroyed) return;
        this._destroyed = false;
        this._initInProgress = false;
        this._connectionAttempts = {};
        this._lastHeartbeatTick = Date.now();
        this._init();
    }

    /**
     * fix 11: общий принудительный реконнект.
     * Обнуляет onclose ДО close() (иначе «родной» onclose запланирует свой отложенный
     * реконнект и оборвёт уже работающее новое соединение), но при этом ЯВНО вызывает
     * _stopPing — в v18 он жил только в onclose и на этом пути терялся.
     */
    _forceReconnect(key, reason) {
        if (this._destroyed) return;
        this._teardownSocket(key, 4000, reason);
        const fn = this._connectors[key];
        if (fn) fn();
    }

    _checkHeartbeats() {
        if (this._destroyed) return;
        if (typeof document !== 'undefined' && document.hidden) return;

        const now = Date.now();

        // B: Если НАШ СОБСТВЕННЫЙ 5-секундный таймер сработал с опозданием > 15с —
        // страница была заморожена (сон машины, фоновый троттлинг, окклюзия окна).
        // Chrome при окклюзии окна троттлит страницу, НЕ выставляя document.hidden,
        // поэтому guard выше не спасает. В таком состоянии отсчёт «нет данных Nс»
        // бессмыслен: WS-кадры просто не читались. Не убиваем заведомо живые сокеты,
        // а перетариваем метки и проверяем уже честный интервал на следующем тике.
        const lag = now - (this._lastHeartbeatTick || now);
        this._lastHeartbeatTick = now;
        if (lag > this.config.heartbeatTickLagMs) {
            console.warn(`⏱️ Страница была заморожена ${Math.round(lag / 1000)}с — отсчёт heartbeat сброшен, сокеты не трогаем`);
            for (const key in this.connections) {
                if (this.connections[key]?.readyState === WebSocket.OPEN) this._lastWsMessage[key] = now;
            }
            return;
        }

        // B: сеть физически отсутствует — реконнект сейчас только сожжёт попытки и
        // упрётся в лимит «300 соединений на 5 минут на IP». Дождёмся события online.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

        for (const key in this.connections) {
            const ws = this.connections[key];
            if (!ws || ws.readyState !== WebSocket.OPEN) continue;

            const elapsed = now - (this._lastWsMessage[key] || 0);
            if (elapsed > this.config.zombieTimeout) {
                console.warn(`💔 ${key} ЗОМБИ! Нет данных ${Math.round(elapsed / 1000)}с. Переподключение...`);
                this._forceReconnect(key, 'Zombie connection');
            }
        }
    }

    /** fix 16: prices больше не растёт бесконечно для символов без подписчиков. */
    _sweepStalePrices() {
        if (this._destroyed) return;
        const now = Date.now();
        for (const [key, data] of this.prices) {
            if (this.subscribers.has(key) || this.subscribers.has(data.symbol)) continue;
            if (now - (data.time || 0) > this.config.stalePriceTtl) this.prices.delete(key);
        }
    }

    _ensureBybitConnected() {
        const isActive = (ws) => ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);

        if (this._bybitSubscriptions.linear.size > 0 && !isActive(this.connections['bybit:linear'])) {
            console.log('🔌 Подключение Bybit Linear');
            this._connectBybitLinear();
        }
        if (this._bybitSubscriptions.spot.size > 0 && !isActive(this.connections['bybit:spot'])) {
            console.log('🔌 Подключение Bybit Spot');
            this._connectBybitSpot();
        }
    }

    // =========================================================================
    //  BINANCE
    // =========================================================================
    // A: три режима на каждый рынок
    //   'idle'     — подписчиков нет, соединение вообще не создаём
    //   'combined' — /stream?streams=<sym>@ticker/... только по нужным символам
    //   'arr'      — !ticker@arr (прежнее поведение): при useCombinedStreams:false
    //                или когда символов больше maxCombinedStreams (лимит 1024/соединение)
    _binanceBase(marketType) {
        // ℹ️ /market — корректный путь после миграции Binance Futures WS 2026 года.
        return marketType === 'futures' ? 'wss://fstream.binance.com/market' : 'wss://stream.binance.com';
    }

    _desiredBinanceMode(marketType) {
        if (!this.config.useCombinedStreams) return 'arr';
        const n = this._binanceSubscriptions[marketType].size;
        if (n === 0) return 'idle';
        return n <= this.config.maxCombinedStreams ? 'combined' : 'arr';
    }

    _binanceKey(marketType) { return marketType === 'futures' ? 'binance:futures' : 'binance:spot'; }

    _binanceUrl(marketType) {
        const mode = this._binanceMode[marketType];
        const base = this._binanceBase(marketType);
        if (mode === 'combined') {
            const streams = [...this._binanceSubscriptions[marketType]].map(s => `${s.toLowerCase()}@ticker`);
            this._binanceUrlStreams[marketType] = new Set(streams);
            return `${base}/stream?streams=${streams.join('/')}`;
        }
        this._binanceUrlStreams[marketType] = new Set();
        return `${base}/ws/!ticker@arr`;
    }

    _connectBinanceFutures() {
        if (this._destroyed) return;
        this._binanceMode.futures = this._desiredBinanceMode('futures');
        if (this._binanceMode.futures === 'idle') { this._teardownSocket('binance:futures'); return; }
        this._connectBinance('binance:futures', this._binanceUrl('futures'), (data) => {
            this._handleBinanceTickerPayload(data, 'futures');
        });
    }

    _connectBinanceSpot() {
        if (this._destroyed) return;
        this._binanceMode.spot = this._desiredBinanceMode('spot');
        if (this._binanceMode.spot === 'idle') { this._teardownSocket('binance:spot'); return; }
        this._connectBinance('binance:spot', this._binanceUrl('spot'), (data) => {
            this._handleBinanceTickerPayload(data, 'spot');
        });
    }

    /** Пересоздаёт соединение, если желаемый режим/набор символов разошёлся с текущим. */
    _syncBinanceConnection(marketType) {
        if (this._destroyed) return;
        const key = this._binanceKey(marketType);
        const want = this._desiredBinanceMode(marketType);
        const ws = this.connections[key];
        const live = ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);

        if (want === 'idle') {
            if (live) {
                this._binanceMode[marketType] = 'idle';
                this._teardownSocket(key);
                console.log(`🔌 ${key} закрыт: подписчиков не осталось`);
            }
            this._binanceMode[marketType] = 'idle';
            return;
        }
        if (live && this._binanceMode[marketType] === want) return;   // ничего не изменилось
        if (marketType === 'futures') this._connectBinanceFutures();
        else this._connectBinanceSpot();
    }

    /**
     * D: живые SUBSCRIBE/UNSUBSCRIBE на уже открытом сокете.
     * У Binance SPOT лимит 5 входящих сообщений/с (у futures 10/с); за превышение
     * соединение отключают, а повторяющиеся IP банят — поэтому очередь + троттлинг.
     */
    _queueBinanceSub(marketType, method, params) {
        if (!params?.length) return;
        this._binanceSubQueue[marketType].push({ method, params });
        if (this._binanceSubTimer[marketType]) return;
        this._scheduleBinanceSubFlush(marketType);
    }

    _scheduleBinanceSubFlush(marketType) {
        this._binanceSubTimer[marketType] = setTimeout(() => {
            this._binanceSubTimer[marketType] = null;
            const queue = this._binanceSubQueue[marketType];
            this._binanceSubQueue[marketType] = [];
            if (!queue.length || this._destroyed) return;

            const key = this._binanceKey(marketType);
            const ws = this.connections[key];
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            if (this._binanceMode[marketType] !== 'combined') return;   // в режиме arr не нужно

            // Схлопываем одноимённые method и режем на чанки: один SUBSCRIBE на сотни
            // параметров может упереться в размер WS-кадра, а частота сообщений
            // ограничена Binance (5/с у spot, 10/с у futures — за превышение рвут
            // соединение и банят повторяющиеся IP).
            const grouped = new Map();
            for (const { method, params } of queue) {
                if (!grouped.has(method)) grouped.set(method, []);
                grouped.get(method).push(...params);
            }

            const jobs = [];
            for (const [method, all] of grouped) {
                const uniq = [...new Set(all)];
                for (let i = 0; i < uniq.length; i += this.config.binanceSubBatchSize) {
                    jobs.push({ method, params: uniq.slice(i, i + this.config.binanceSubBatchSize) });
                }
            }

            let n = 0;
            const sendNext = () => {
                this._binanceSubTimer[marketType] = null;
                if (this._destroyed || n >= jobs.length) return;
                const w = this.connections[key];
                if (!w || w.readyState !== WebSocket.OPEN) return;
                const job = jobs[n++];
                try { w.send(JSON.stringify({ ...job, id: `${Date.now()}-${n}` })); } catch (e) {}
                if (n < jobs.length) {
                    this._binanceSubTimer[marketType] = setTimeout(sendNext, this.config.binanceSubMsgInterval);
                }
            };
            sendNext();
        }, this.config.binanceSubMsgInterval);
    }

    /** После onopen добираем символы, добавленные пока сокет ещё только подключался. */
    _binanceResyncOnOpen(key) {
        const marketType = key.split(':')[1];
        if (this._binanceMode[marketType] !== 'combined') return;

        const current = new Set([...this._binanceSubscriptions[marketType]].map(s => `${s.toLowerCase()}@ticker`));
        const inUrl = this._binanceUrlStreams[marketType] || new Set();

        const toAdd = [...current].filter(s => !inUrl.has(s));
        const toRemove = [...inUrl].filter(s => !current.has(s));
        this._binanceUrlStreams[marketType] = current;

        if (toAdd.length) this._queueBinanceSub(marketType, 'SUBSCRIBE', toAdd);
        if (toRemove.length) this._queueBinanceSub(marketType, 'UNSUBSCRIBE', toRemove);
    }

    _subscribeBinanceSymbol(symbol, marketType) {
        if (marketType !== 'futures' && marketType !== 'spot') return;
        const clean = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!clean) return;

        const set = this._binanceSubscriptions[marketType];
        if (set.has(clean)) return;

        const key = this._binanceKey(marketType);
        const ws = this.connections[key];
        const liveCombined = ws && ws.readyState === WebSocket.OPEN && this._binanceMode[marketType] === 'combined';

        set.add(clean);

        // сокет открыт и режим не меняется → дописываем поток без переподключения
        if (liveCombined && this._desiredBinanceMode(marketType) === 'combined') {
            this._queueBinanceSub(marketType, 'SUBSCRIBE', [`${clean.toLowerCase()}@ticker`]);
            this._binanceUrlStreams[marketType].add(`${clean.toLowerCase()}@ticker`);
            return;
        }
        this._syncBinanceConnection(marketType);
    }

    _unsubscribeBinanceSymbol(symbol, marketType) {
        if (marketType !== 'futures' && marketType !== 'spot') return;
        const clean = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
        const set = this._binanceSubscriptions[marketType];
        if (!set.has(clean)) return;

        const key = this._binanceKey(marketType);
        const ws = this.connections[key];
        const liveCombined = ws && ws.readyState === WebSocket.OPEN && this._binanceMode[marketType] === 'combined';

        set.delete(clean);

        if (liveCombined && this._desiredBinanceMode(marketType) === 'combined') {
            this._queueBinanceSub(marketType, 'UNSUBSCRIBE', [`${clean.toLowerCase()}@ticker`]);
            this._binanceUrlStreams[marketType].delete(`${clean.toLowerCase()}@ticker`);
            return;
        }
        this._syncBinanceConnection(marketType);   // при 0 символов закроет сокет
    }

    _handleBinanceTickerPayload(data, marketType) {
        // A: в combined-режиме полезная нагрузка обёрнута в {"stream":"<name>","data":<payload>}
        if (data && data.stream !== undefined && data.data !== undefined) data = data.data;

        const tickers = Array.isArray(data) ? data : [data];
        for (let i = 0; i < tickers.length; i++) {
            const t = tickers[i];
            if (!t || !t.s) continue;

            // В режиме arr по-прежнему фильтруем весь рынок по подписчикам;
            // в combined-режиме приходят только наши символы, проверка дешёвая.
            const subKey = `${t.s}:binance:${marketType}`;
            if (!this.subscribers.has(subKey) && !this.subscribers.has(t.s)) continue;

            const price = PriceManager._num(t.c);
            if (price === undefined || price <= 0) continue;

            this._setPrice(t.s, {
                price,
                change: PriceManager._num(t.P),        // fix 1: у Binance УЖЕ проценты
                volume: PriceManager._num(t.q),
                trades: t.n === undefined ? undefined : parseInt(t.n, 10)
            }, 'binance', marketType);
        }
    }

    _connectBinance(key, url, onMessageHandler) {
        if (this._destroyed) return;
        this._clearSocket(key);

        const ws = new WebSocket(url);
        this.connections[key] = ws;
        this._connectionAttempts[key] = (this._connectionAttempts[key] || 0) + 1;
        this._connectionState[key] = 'connecting';

        ws.onopen = () => {
            if (this.connections[key] !== ws) return;   // сокет уже заменён
            this._lastWsMessage[key] = Date.now();
            this._connectionAttempts[key] = 0;
            this._connectionState[key] = 'open';
            this._lastHeartbeatTick = Date.now();        // B: сброс отсчёта «заморозки»
            console.log(`✅ ${key} WebSocket подключен (${url.split('?')[0].replace('wss://', '')}, ${this._streamsCount(key)})`);
            this._binanceResyncOnOpen(key);              // A: добираем символы, добавленные во время handshake
        };

        ws.onmessage = (event) => {
            if (this.connections[key] !== ws) return;
            this._lastWsMessage[key] = Date.now();

            // fix 20: парсинг отделён от бизнес-логики — ошибки хэндлера больше не маскируются
            let data;
            try { data = JSON.parse(event.data); } catch (e) { return; }

            // C: Binance присылает serverShutdown перед перезапуском WS-сервера.
            // Документация прямо просит переподключиться как можно скорее — делаем это
            // превентивно, а не ждём обрыва и 15-секундного backoff.
            if (data && (data.e === 'serverShutdown' || data.stream === '!serverShutdown')) {
                console.warn(`⚠️ ${key}: Binance перезапускает WS-сервер — превентивный реконнект`);
                this._forceReconnect(key, 'serverShutdown');
                return;
            }

            try { onMessageHandler(data); }
            catch (e) { console.error(`❌ Ошибка обработчика ${key}:`, e); }
        };

        ws.onclose = (event) => {
            this._connectionState[key] = 'closed';
            if (this.reconnectTimers.has(key)) clearTimeout(this.reconnectTimers.get(key));
            if (this._destroyed || this.connections[key] !== ws) return;

            const delay = this._backoffDelay(key);
            console.warn(`⚠️ ${key} закрыт (код ${event.code || '?'}), реконнект через ${delay / 1000}с`);
            this.reconnectTimers.set(key, setTimeout(() => {
                this.reconnectTimers.delete(key);
                // A: зовём коннектор, а не _connectBinance со СТАРЫМ url — за время
                // дисконнекта набор символов мог измениться, URL нужно пересобрать.
                const fn = this._connectors[key];
                if (fn) fn(); else this._connectBinance(key, url, onMessageHandler);
            }, delay));
        };

        ws.onerror = (error) => console.error(`❌ Ошибка WebSocket ${key}:`, error);
    }

    /** fix 14: attempts инкрементируется ДО попытки, поэтому степень — (attempts - 1). */
    /** Подпись для лога: сколько реально потоков слушает соединение. */
    _streamsCount(key) {
        if (key.indexOf('binance:') === 0) {
            const mt = key.split(':')[1];
            const mode = this._binanceMode[mt];
            if (mode === 'combined') return `потоков: ${this._binanceSubscriptions[mt].size}`;
            if (mode === 'arr') return 'весь рынок (!ticker@arr)';
            return 'подписок нет';
        }
        if (key.indexOf('bybit:') === 0) {
            const mk = key === 'bybit:linear' ? 'linear' : 'spot';
            return `топиков: ${this._bybitSubscriptions[mk].size}`;
        }
        return '';
    }

    _backoffDelay(key) {
        const attempts = Math.max(0, (this._connectionAttempts[key] || 1) - 1);
        return Math.min(this.config.reconnectDelay * Math.pow(1.5, attempts), this.config.maxReconnectDelay);
    }

    /** Аккуратно гасим сокет: обработчики обнуляются ДО close(), иначе будет призрачный реконнект. */
    _teardownSocket(key, code = 1000, reason = '') {
        if (this.reconnectTimers.has(key)) {
            clearTimeout(this.reconnectTimers.get(key));
            this.reconnectTimers.delete(key);
        }
        if (this._resubTimers.has(key)) {
            clearTimeout(this._resubTimers.get(key));
            this._resubTimers.delete(key);
        }
        const oldWs = this.connections[key];
        if (oldWs) {
            oldWs.onclose = null;
            oldWs.onerror = null;
            oldWs.onmessage = null;
            this._stopPing(key);
            try { oldWs.close(code, reason); } catch (e) {}
            this.connections[key] = null;
            this._connectionState[key] = 'idle';
        }
    }

    _clearSocket(key) { this._teardownSocket(key); }

    // =========================================================================
    //  BYBIT
    // =========================================================================
    _connectBybitLinear() {
        if (this._destroyed) return;
        this._connectBybit('bybit:linear', 'wss://stream.bybit.com/v5/public/linear', 'linear', 'futures');
    }

    _connectBybitSpot() {
        if (this._destroyed) return;
        this._connectBybit('bybit:spot', 'wss://stream.bybit.com/v5/public/spot', 'spot', 'spot');
    }

    _connectBybit(key, url, marketKey, marketType) {
        if (this._destroyed) return;
        this._clearSocket(key);

        const ws = new WebSocket(url);
        this.connections[key] = ws;
        this._connectionAttempts[key] = (this._connectionAttempts[key] || 0) + 1;
        this._connectionState[key] = 'connecting';     // fix 19

        ws.onopen = () => {
            if (this.connections[key] !== ws) return;
            this._lastWsMessage[key] = Date.now();
            this._connectionState[key] = 'open';
            this._connectionAttempts[key] = 0;
            this._startPingBybit(key, ws);
            this._resubscribeBybit(marketKey);
        };

        ws.onmessage = (event) => {
            if (this.connections[key] !== ws) return;
            this._lastWsMessage[key] = Date.now();

            let msg;
            try { msg = JSON.parse(event.data); } catch (e) { return; }
            if (msg.op === 'pong' || msg.ret_msg === 'pong') return;
            if (!msg.topic || msg.topic.indexOf('tickers.') !== 0 || !msg.data) return;

            try { this._handleBybitTicker(msg.data, marketType); }
            catch (e) { console.error(`❌ Ошибка обработчика ${key}:`, e); }
        };

        ws.onclose = (event) => {
            this._connectionState[key] = 'closed';
            this._stopPing(key);
            if (this.reconnectTimers.has(key)) clearTimeout(this.reconnectTimers.get(key));
            if (this._destroyed || this.connections[key] !== ws) return;

            const delay = this._backoffDelay(key);
            console.warn(`⚠️ ${key} закрыт (код ${event.code || '?'}, ${event.reason || 'без причины'}), реконнект через ${delay / 1000}с`);
            this.reconnectTimers.set(key, setTimeout(() => {
                this.reconnectTimers.delete(key);
                this._connectBybit(key, url, marketKey, marketType);
            }, delay));
        };

        ws.onerror = (error) => console.error(`❌ Ошибка WebSocket ${key}:`, error);
    }

    /**
     * fix 1, 2, 3.
     * Bybit tickers — snapshot+delta канал: «поля нет в сообщении» = «значение не изменилось»,
     * поэтому ничего не заменяем нулём, а передаём undefined — _setPrice сохранит старое.
     * price24hPcnt у Bybit — ДОЛЯ (0.025 = +2.5%), приводим к процентам, как у Binance.
     * Поля count в tickers не существует — trades не выдумываем.
     */
    _handleBybitTicker(d, marketType) {
        const symbol = d.symbol;
        if (!symbol) return;

        const price = PriceManager._num(d.lastPrice);
        if (price === undefined || price <= 0) return;

        const rawChange = PriceManager._num(d.price24hPcnt);

        this._setPrice(symbol, {
            price,
            change: rawChange === undefined ? undefined : rawChange * 100,
            volume: PriceManager._num(d.turnover24h)
        }, 'bybit', marketType);
    }

    _startPingBybit(key, ws) {
        this._stopPing(key);
        this.pingIntervals[key] = setInterval(() => {
            if (this._destroyed || this.connections[key] !== ws) { this._stopPing(key); return; }
            if (ws.readyState === WebSocket.OPEN) {
                try { ws.send(JSON.stringify({ op: 'ping', req_id: Date.now() })); } catch (e) {}
            }
        }, this.config.bybitPingInterval);
    }

    _stopPing(key) {
        if (this.pingIntervals[key]) {
            clearInterval(this.pingIntervals[key]);
            this.pingIntervals[key] = null;
        }
    }

    /**
     * fix 12: батчи по 10 (лимит Bybit) отправляются НЕ одним синхронным залпом.
     * Binance документированно рвёт соединение при >10 входящих сообщений/с и банит
     * повторяющиеся IP; у Bybit аналогичные ограничения на частоту запросов.
     */
    _resubscribeBybit(marketKey) {
        const key = marketKey === 'linear' ? 'bybit:linear' : 'bybit:spot';
        const ws = this.connections[key];
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const symbols = [...this._bybitSubscriptions[marketKey]];
        if (symbols.length === 0) return;

        if (this._resubTimers.has(key)) clearTimeout(this._resubTimers.get(key));

        let i = 0;
        const tick = () => {
            this._resubTimers.delete(key);
            if (this._destroyed || this.connections[key] !== ws || ws.readyState !== WebSocket.OPEN) return;

            const batch = symbols.slice(i, i + 10).map(s => `tickers.${s}`);
            if (batch.length) {
                try { ws.send(JSON.stringify({ op: 'subscribe', args: batch })); } catch (e) {}
            }
            i += 10;
            if (i < symbols.length) {
                this._resubTimers.set(key, setTimeout(tick, this.config.resubscribeBatchDelay));
            }
        };
        tick();
    }

    _bybitSocketKey(marketType) { return marketType === 'futures' ? 'bybit:linear' : 'bybit:spot'; }
    _bybitMarketKey(marketType) { return marketType === 'futures' ? 'linear' : 'spot'; }

    subscribeBybitSymbol(symbol, marketType) {
        const marketKey = this._bybitMarketKey(marketType);
        const clean = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!clean || this._bybitSubscriptions[marketKey].has(clean)) return;

        this._bybitSubscriptions[marketKey].add(clean);
        this._ensureBybitConnected();

        const ws = this.connections[this._bybitSocketKey(marketType)];
        if (ws?.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ op: 'subscribe', args: [`tickers.${clean}`] })); } catch (e) {}
        }
    }

    unsubscribeBybitSymbol(symbol, marketType) {
        const marketKey = this._bybitMarketKey(marketType);
        const clean = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!this._bybitSubscriptions[marketKey].has(clean)) return;

        this._bybitSubscriptions[marketKey].delete(clean);

        const connKey = this._bybitSocketKey(marketType);
        const ws = this.connections[connKey];
        if (ws?.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ op: 'unsubscribe', args: [`tickers.${clean}`] })); } catch (e) {}
        }

        // fix 10: подписок на этот рынок больше нет — закрываем соединение и ping,
        // иначе они живут впустую до конца сессии вкладки.
        if (this._bybitSubscriptions[marketKey].size === 0 && ws) {
            this._stopPing(connKey);
            if (this._resubTimers.has(connKey)) {
                clearTimeout(this._resubTimers.get(connKey));
                this._resubTimers.delete(connKey);
            }
            ws.onclose = null; ws.onerror = null; ws.onmessage = null;
            try { ws.close(1000, 'no subscriptions left'); } catch (e) {}
            this.connections[connKey] = null;
            this._connectionState[connKey] = 'idle';
            console.log(`🔌 ${connKey} закрыт: подписок не осталось`);
        }
    }

    // =========================================================================
    //  REST — резервный источник цен для алертов
    // =========================================================================
    async _pollAlertPricesViaRest() {
        if (this._destroyed) return;
        // [ANTI-BAN] скрытая вкладка не опрашивает биржу: WS в фоне продолжает
        // работать, алерты срабатывают через него — REST-страховка подождёт
        if (typeof document !== 'undefined' && document.hidden) return;
        // fix 4: interval не ждёт await. Без этого флага медленный опрос (ретраи на 429 —
        // до 30с) перекрывается следующими, запросы наслаиваются лавиной → 418 → бан IP.
        if (this._restPollInFlight) return;
        if (typeof window === 'undefined' || !window.alertLineManager) return;

        this._restPollInFlight = true;
        try {
            const activeAlerts = window.alertLineManager._alerts.filter(item => item.alert?.status === 'active');
            if (activeAlerts.length === 0) return;

            const groups = {
                'binance:futures': new Set(), 'binance:spot': new Set(),
                'bybit:futures': new Set(),   'bybit:spot': new Set()
            };

            for (const item of activeAlerts) {
                const a = item.alert;
                if (!a?.symbol) continue;
                const key = `${(a.exchange || 'binance').toLowerCase()}:${(a.marketType || 'futures').toLowerCase()}`;
                if (groups[key]) groups[key].add(String(a.symbol).toUpperCase());
            }

            if (groups['bybit:futures'].size > 0 || groups['bybit:spot'].size > 0) this._ensureBybitConnected();

            const tasks = [];
            if (groups['binance:futures'].size) tasks.push(this._fetchBinanceRest([...groups['binance:futures']], 'futures'));
            if (groups['binance:spot'].size)    tasks.push(this._fetchBinanceRest([...groups['binance:spot']], 'spot'));
            if (groups['bybit:futures'].size)   tasks.push(this._fetchBybitRest([...groups['bybit:futures']], 'futures'));
            if (groups['bybit:spot'].size)      tasks.push(this._fetchBybitRest([...groups['bybit:spot']], 'spot'));

            await Promise.allSettled(tasks);
        } finally {
            this._restPollInFlight = false;   // гарантированно сбрасываем даже при исключении
        }
    }

    /**
     * fix 6.
     *  SPOT    /api/v3/ticker/24hr  — symbols ПОДДЕРЖИВАЕТСЯ: 1–20 символов = weight 2,
     *                                 без параметра = weight 80 (~2500 объектов).
     *  FUTURES /fapi/v1/ticker/24hr — symbols НЕТ: одиночный symbol = weight 1,
     *                                 без параметра = weight 40.
     * Поэтому стратегии разные: spot батчами, futures точечно до 30 символов (30×1 < 40).
     */
    async _fetchBinanceRest(symbols, marketType) {
        if (!symbols?.length || this._destroyed) return;
        const wanted = new Set(symbols);

        if (marketType === 'spot') {
            for (let i = 0; i < symbols.length; i += this.config.spotBatchSize) {
                if (this._destroyed) return;
                const batch = symbols.slice(i, i + this.config.spotBatchSize);
                const url = 'https://api.binance.com/api/v3/ticker/24hr?symbols=' +
                            encodeURIComponent(JSON.stringify(batch));
                await this._consumeBinanceTickers(url, wanted, marketType);
            }
            return;
        }

        if (symbols.length <= this.config.futuresSingleSymbolMax) {
            for (const s of symbols) {
                if (this._destroyed) return;
                await this._consumeBinanceTickers(
                    `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(s)}`,
                    wanted, marketType);
            }
        } else {
            await this._consumeBinanceTickers('https://fapi.binance.com/fapi/v1/ticker/24hr', wanted, marketType);
        }
    }

    async _consumeBinanceTickers(url, wanted, marketType) {
        try {
            const response = await this._fetchWithRetry(url);
            if (!response || !response.ok) {
                if (response) console.warn(`⚠️ Binance REST ${response.status} для ${url}`);
                return;
            }
            const data = await response.json();
            const tickers = Array.isArray(data) ? data : [data];

            for (const t of tickers) {
                if (!t?.symbol || !wanted.has(t.symbol)) continue;
                const price = PriceManager._num(t.lastPrice);
                if (price === undefined || price <= 0) continue;
                this._setPrice(t.symbol, {
                    price,
                    change: PriceManager._num(t.priceChangePercent)   // fix 1: уже проценты
                }, 'binance', marketType);
            }
        } catch (e) {
            console.warn('⚠️ Binance REST error:', e?.message || e);
        }
    }

    /**
     * fix 6: /v5/market/tickers принимает только ОДИН symbol (батч через запятую не
     * документирован). До 10 символов дешевле точечные запросы, дальше — дамп категории.
     * fix 1: price24hPcnt здесь тоже доля → приводим к процентам.
     */
    async _fetchBybitRest(symbols, marketType) {
        if (!symbols?.length || this._destroyed) return;
        const category = marketType === 'futures' ? 'linear' : 'spot';
        const wanted = new Set(symbols);

        try {
            let list = [];
            if (symbols.length <= this.config.bybitSingleSymbolMax) {
                for (const s of symbols) {
                    if (this._destroyed) return;
                    const r = await this._fetchWithRetry(
                        `https://api.bybit.com/v5/market/tickers?category=${category}&symbol=${encodeURIComponent(s)}`);
                    if (!r?.ok) continue;
                    const d = await r.json();
                    if (d?.retCode === 0 && Array.isArray(d.result?.list)) list.push(...d.result.list);
                }
            } else {
                const r = await this._fetchWithRetry(`https://api.bybit.com/v5/market/tickers?category=${category}`);
                if (r?.ok) {
                    const d = await r.json();
                    if (d?.retCode === 0 && Array.isArray(d.result?.list)) list = d.result.list;
                }
            }

            for (const t of list) {
                if (!t?.symbol || !wanted.has(t.symbol)) continue;
                const price = PriceManager._num(t.lastPrice);
                if (price === undefined || price <= 0) continue;
                const raw = PriceManager._num(t.price24hPcnt);
                this._setPrice(t.symbol, {
                    price,
                    change: raw === undefined ? undefined : raw * 100
                }, 'bybit', marketType);
            }
        } catch (e) {
            console.warn('⚠️ Bybit REST error:', e?.message || e);
        }
    }

    /** fix 5: таймаут через AbortController + честный учёт Retry-After и 418. */
    async _fetchWithTimeout(url, ms = this.config.fetchTimeout) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), ms);
        try {
            return await fetch(url, { signal: ctrl.signal });
        } finally {
            clearTimeout(t);
        }
    }

    async _fetchWithRetry(url, maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            if (this._destroyed) return null;
            try {
                const response = await this._fetchWithTimeout(url);
                if (response.ok) return response;

                if (response.status === 418) {
                    // [ANTI-BAN] 418 = IP уже забанен; любые ретраи продлевают бан
                    console.warn('⛔ Binance 418 (IP ban) — REST остановлен');
                    return null;
                }
                if (response.status === 429) {
                    let wait = 5000 * (i + 1);
                    try {
                        const ra = parseInt(response.headers?.get?.('Retry-After') || '', 10);
                        if (Number.isFinite(ra) && ra > 0) wait = Math.max(wait, ra * 1000);
                    } catch (e) {}
                    await PriceManager._sleep(wait);
                    continue;
                }
                if (response.status >= 500) {
                    await PriceManager._sleep(1000 * (i + 1));
                    continue;
                }
                return response;   // 4xx — повторять бессмысленно, пусть вызывающий решит
            } catch (e) {
                if (this._destroyed) return null;
                if (i === maxRetries - 1) throw e;
                await PriceManager._sleep(1000 * Math.pow(2, i));
            }
        }
        return null;
    }

    // =========================================================================
    //  УСТАНОВКА ЦЕНЫ
    // =========================================================================
    _setPrice(symbol, priceData, exchange, marketType) {
        if (!symbol) return;

        const isObject = typeof priceData === 'object' && priceData !== null;
        const price = PriceManager._num(isObject ? priceData.price : priceData);
        if (price === undefined || price <= 0) return;

        const key = `${symbol}:${exchange}:${marketType}`;
        const old = this.prices.get(key);

        // fix 2, 13: undefined/''/NaN = «значение не пришло» → сохраняем прежнее.
        // Раньше parseFloat(undefined) давал NaN, а NaN === NaN → false, поэтому
        // дедупликация не срабатывала НИКОГДА для таких вызовов.
        const keep = (raw, prev, parse) => {
            if (raw === undefined || raw === null || raw === '') return prev;
            const v = parse(raw);
            return Number.isFinite(v) ? v : prev;
        };
        const change = keep(isObject ? priceData.change : undefined, old?.change, parseFloat);
        const volume = keep(isObject ? priceData.volume : undefined, old?.volume, parseFloat);
        const trades = keep(isObject ? priceData.trades : undefined, old?.trades, (x) => parseInt(x, 10));

        if (old && old.price === price && old.change === change &&
            old.volume === volume && old.trades === trades) {
            old.time = Date.now();   // обновляем «свежесть» без уведомления подписчиков
            return;
        }

        this.prices.set(key, { price, change, volume, trades, symbol, time: Date.now() });
        this._pendingUpdates.set(key, { price, change, volume, trades, symbol, exchange, marketType });

        if (this._flushTimerId === null) {
            this._flushTimerId = setTimeout(() => {
                this._flushTimerId = null;
                this._flushUpdates();
            }, this.config.flushInterval);
        }
    }

    _flushUpdates() {
        const updates = new Map(this._pendingUpdates);
        this._pendingUpdates.clear();
        if (this._destroyed) return;

        for (const [k, data] of updates.entries()) {
            const payload = { price: data.price, change: data.change, volume: data.volume, trades: data.trades };

            // fix 8: если один и тот же колбэк подписан И на полный ключ, И на «голый»
            // символ — он получал два идентичных вызова на одно событие. Дедуплицируем
            // в рамках ОДНОГО обновления (разные рынки того же символа остаются
            // отдельными событиями — у них разные цены, терять их нельзя).
            const called = new Set();
            const notify = (list) => {
                if (!list) return;
                for (const cb of list) {
                    if (called.has(cb)) continue;
                    called.add(cb);
                    try { cb(payload, data.symbol, data.exchange, data.marketType); }
                    catch (e) { console.error('❌ Ошибка подписчика:', e); }
                }
            };

            notify(this.subscribers.get(k));
            if (data.symbol !== k) notify(this.subscribers.get(data.symbol));
        }
    }

    // =========================================================================
    //  ПОДПИСКА
    // =========================================================================
    /** fix 7: единая нормализация — WS-источники отдают символы капсом без разделителей. */
    _normKey(key) {
        const s = String(key ?? '');
        const parts = s.split(':');
        const sym = parts[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!sym) return s;
        return parts.length === 3
            ? `${sym}:${parts[1].toLowerCase()}:${parts[2].toLowerCase()}`
            : sym;
    }

    /** Возвращает disposer: const off = pm.subscribe(...); off(); */
    subscribe(key, callback) {
        if (typeof callback !== 'function') return () => {};
        key = this._normKey(key);

        if (!this.subscribers.has(key)) this.subscribers.set(key, []);
        this.subscribers.get(key).push(callback);

        const parts = key.split(':');
        if (parts.length === 3) {
            if (parts[1] === 'bybit') this.subscribeBybitSymbol(parts[0], parts[2]);
            else if (parts[1] === 'binance') this._subscribeBinanceSymbol(parts[0], parts[2]);  // A
        } else if (parts.length === 1) {
            // A: «голый» символ (без биржи/рынка). В v19 он пассивно получал данные из
            // всегда включённого !ticker@arr обоих Binance-рынков. Чтобы в combined-режиме
            // семантика не сломалась, регистрируем символ на обоих рынках Binance явно.
            // Bybit не трогаем — как и в v19, туда нужна подписка с полным ключом.
            this._subscribeBinanceSymbol(parts[0], 'futures');
            this._subscribeBinanceSymbol(parts[0], 'spot');
        }

        const cached = this.prices.get(key);
        if (cached) {
            // fix 17: полный payload (volume/trades) + возможность отменить при unsubscribe
            const tid = setTimeout(() => {
                this._cacheTimers.delete(callback);
                try {
                    callback({ price: cached.price, change: cached.change, volume: cached.volume, trades: cached.trades },
                             parts[0], parts[1], parts[2]);
                } catch (e) { console.error('❌ Ошибка подписчика:', e); }
            }, 0);
            this._cacheTimers.set(callback, tid);
        }

        return () => this.unsubscribe(key, callback);
    }

    unsubscribe(key, callback) {
        key = this._normKey(key);
        if (!this.subscribers.has(key)) return;

        const list = this.subscribers.get(key);
        const idx = list.indexOf(callback);
        if (idx !== -1) list.splice(idx, 1);

        if (this._cacheTimers.has(callback)) {          // fix 17
            clearTimeout(this._cacheTimers.get(callback));
            this._cacheTimers.delete(callback);
        }

        if (list.length === 0) {
            this.subscribers.delete(key);
            const parts = key.split(':');
            if (parts.length === 3) {
                if (parts[1] === 'bybit') this.unsubscribeBybitSymbol(parts[0], parts[2]);
                else if (parts[1] === 'binance') this._unsubscribeBinanceSymbol(parts[0], parts[2]);  // A
            } else if (parts.length === 1) {
                this._unsubscribeBinanceSymbol(parts[0], 'futures');
                this._unsubscribeBinanceSymbol(parts[0], 'spot');
            }
        }
    }

    getPrice(symbol, exchange = null, marketType = null) {
        let key;
        if (exchange && marketType) key = this._normKey(`${symbol}:${exchange}:${marketType}`);
        else key = this._normKey(String(symbol).includes(':') ? symbol : `${symbol}:binance:futures`);
        const data = this.prices.get(key);
        return data ? data.price : null;
    }

    /** fix 18: тот же retry/таймаут/парсинг, что и у REST-опроса; больше не дублирует единицы измерения. */
    async fetchPrice(symbol, exchange = 'binance', marketType = 'futures') {
        if (!symbol || this._destroyed) return null;
        symbol = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');

        try {
            if (exchange === 'binance') {
                const url = marketType === 'futures'
                    ? `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(symbol)}`
                    : `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
                const r = await this._fetchWithRetry(url);
                if (!r?.ok) return null;
                const d = await r.json();
                const price = PriceManager._num(d.lastPrice);
                if (price === undefined || price <= 0) return null;
                this._setPrice(symbol, { price, change: PriceManager._num(d.priceChangePercent) }, 'binance', marketType);
                return price;
            }

            const category = marketType === 'futures' ? 'linear' : 'spot';
            const r = await this._fetchWithRetry(
                `https://api.bybit.com/v5/market/tickers?category=${category}&symbol=${encodeURIComponent(symbol)}`);
            if (!r?.ok) return null;
            const d = await r.json();
            const t = (d?.retCode === 0) ? d.result?.list?.[0] : null;
            if (!t) return null;
            const price = PriceManager._num(t.lastPrice);
            if (price === undefined || price <= 0) return null;
            const raw = PriceManager._num(t.price24hPcnt);
            this._setPrice(symbol, {
                price,
                change: raw === undefined ? undefined : raw * 100
            }, 'bybit', marketType);
            return price;
        } catch (e) {
            console.warn('⚠️ fetchPrice error:', e?.message || e);
            return null;
        }
    }

    // =========================================================================
    //  СТАТУС / ЗАКРЫТИЕ
    // =========================================================================
    getStateName(code) {
        if (typeof WebSocket === 'undefined') return String(code);
        return ({ 0: 'CONNECTING', 1: 'OPEN', 2: 'CLOSING', 3: 'CLOSED' })[code] ?? String(code);
    }

    getStatus() {
        const status = {};
        for (const [key, ws] of Object.entries(this.connections)) {
            const lastMsg = this._lastWsMessage[key];
            status[key] = {
                readyState: ws ? this.getStateName(ws.readyState) : 'NONE',
                lastMessage: lastMsg ? `${Math.round((Date.now() - lastMsg) / 1000)}с назад` : 'никогда',
                state: this._connectionState[key] || 'unknown'
            };
        }
        return {
            destroyed: this._destroyed,
            connections: status,
            totalPrices: this.prices.size,
            totalSubscribers: this.subscribers.size,
            bybitSubscriptions: {
                linear: this._bybitSubscriptions.linear.size,
                spot: this._bybitSubscriptions.spot.size
            },
            binanceSubscriptions: {
                futures: { mode: this._binanceMode.futures, symbols: this._binanceSubscriptions.futures.size },
                spot:    { mode: this._binanceMode.spot,    symbols: this._binanceSubscriptions.spot.size }
            },
            restPollInFlight: this._restPollInFlight
        };
    }

    close() {
        this._destroyed = true;   // блокирует любые дальнейшие реконнекты/таймеры

        for (const id of [this._restPollInterval, this._heartbeatInterval, this._sweepInterval]) {
            if (id) clearInterval(id);
        }
        this._restPollInterval = null;
        this._heartbeatInterval = null;
        this._sweepInterval = null;

        for (const id of [this._restPollTimer, this._wakeCheckTimerId, this._flushTimerId]) {
            if (id) clearTimeout(id);
        }
        this._restPollTimer = null;
        this._wakeCheckTimerId = null;
        this._flushTimerId = null;

        for (const tid of this._cacheTimers.values()) clearTimeout(tid);
        this._cacheTimers.clear();
        for (const tid of this._resubTimers.values()) clearTimeout(tid);
        this._resubTimers.clear();

        for (const mt of ['futures', 'spot']) {          // A/D
            if (this._binanceSubTimer[mt]) clearTimeout(this._binanceSubTimer[mt]);
            this._binanceSubTimer[mt] = null;
            this._binanceSubQueue[mt] = [];
        }

        this._pendingUpdates.clear();

        if (typeof window !== 'undefined') {   // fix 9: снимаем за собой слушатели
            if (this._pageHideHandler) window.removeEventListener('pagehide', this._pageHideHandler);
            if (this._onlineHandler) window.removeEventListener('online', this._onlineHandler);
            this._pageHideHandler = null;
            this._onlineHandler = null;
        }
        if (typeof document !== 'undefined' && this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }

        for (const key in this.pingIntervals) this._stopPing(key);

        for (const ws of Object.values(this.connections)) {
            if (ws) {
                ws.onclose = null; ws.onerror = null; ws.onmessage = null;
                try { ws.close(1000); } catch (e) {}
            }
        }

        for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
        this.reconnectTimers.clear();

        // fix 15: раньше connections/_connectionState оставались, и checkWS() показывал
        // state:"open" у полностью мёртвого менеджера.
        this.connections = {};
        this._connectionState = {};
        this._lastWsMessage = {};
        this._connectionAttempts = {};
        this._initInProgress = false;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PriceManager };
}

if (typeof window !== 'undefined') {
    window.PriceManager = PriceManager;

    // защита от дублирования синглтона (hot-reload скрипта)
    if (window.priceManagerInstance && typeof window.priceManagerInstance.close === 'function') {
        try { window.priceManagerInstance.close(); } catch (e) {}
    }
    window.priceManagerInstance = new PriceManager();

    window.checkWS = function () {
        const pm = window.priceManagerInstance;
        if (!pm) return console.error('❌ PriceManager не найден');
        const st = pm.getStatus();
        console.log('=== СТАТУС ===');
        console.table(st.connections);
        console.log(`💰 Цен: ${st.totalPrices} | 👥 Подписчиков: ${st.totalSubscribers}`);
        console.log(`📡 Bybit: linear=${st.bybitSubscriptions.linear}, spot=${st.bybitSubscriptions.spot}`);
        console.log(`📡 Binance: futures=${st.binanceSubscriptions.futures.symbols} (${st.binanceSubscriptions.futures.mode}), spot=${st.binanceSubscriptions.spot.symbols} (${st.binanceSubscriptions.spot.mode})`);
        console.log(`🛑 destroyed: ${st.destroyed} | REST в полёте: ${st.restPollInFlight}`);
        return st;
    };
}
