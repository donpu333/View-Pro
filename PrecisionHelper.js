/**
 * PrecisionHelper — единственный владелец getPrecisionFromExchange().
 *
 * [VP-PRECISION] ЧТО БЫЛО СЛОМАНО (причина «❌ Не удалось переключиться на XXX:
 * Нет данных для XXX» в ChartManager.switchSymbol):
 *
 *  1. Функция getPrecisionFromExchange была объявлена ДВАЖДЫ: здесь и в Utils.js.
 *     В index.html PrecisionHelper.js подключён ПОСЛЕ Utils.js, поэтому в
 *     классических скриптах побеждало более позднее объявление — и «лёгкая»
 *     версия из Utils.js (точечный запрос ?symbol=XXX, ~5 КБ) была мёртвым
 *     кодом, а реально работала «тяжёлая».
 *
 *  2. Тяжёлая версия качала ВЕСЬ exchangeInfo на КАЖДЫЙ новый символ:
 *        binance SPOT    /api/v3/exchangeInfo       ~17 300 КБ (3705 записей)
 *        binance FUTURES /fapi/v1/exchangeInfo       ~1 120 КБ (905 записей)
 *     Запрос шёл БЕЗ AbortController и БЕЗ таймаута, а _prefetchPrecision()
 *     лишь «отпускал» ожидание через 1 с — сама закачка продолжала жить и
 *     забивала канал. Параллельный fetchKlines() (1000 свечей) не успевал за
 *     _fetchTimeoutMs = 15 с, обрывался по таймауту и молча возвращал null
 *     (AbortError даже не логировался) — switchSymbol бросал «Нет данных».
 *     Хуже всего на SPOT: 17 МБ не успевали дочитаться, точность не
 *     сохранялась в localStorage, и КАЖДАЯ следующая попытка переключения
 *     запускала всё заново. Отсюда «ошибка осталась» после прежних правок.
 *
 *  3. `data.symbols.find(...)` не проверялся: для несуществующего тикера
 *     Binance отдаёт {"symbols":[]} → TypeError → catch → precision = 2, и эта
 *     двойка записывалась в localStorage как истина (Number(null) === 0 в
 *     прежнем _prefetchPrecision давал ещё и «0 знаков»).
 *
 * ЧТО СДЕЛАНО:
 *   • один источник правды (Utils.js больше не объявляет эту функцию);
 *   • SPOT  — точечный exchangeInfo?symbol=XXX (~5 КБ вместо 17 МБ);
 *   • FUTURES — у Binance параметр ?symbol= ИГНОРИРУЕТСЯ (ответ всё равно
 *     ~1.1 МБ), поэтому список качается ОДИН РАЗ на сессию и превращается
 *     в карту symbol -> precision. Было: 1.1 МБ на каждый символ.
 *     (Проверено: fapi/v1/exchangeInfo?symbol=SUIUSDT → 1 120 КБ,
 *               api/v3/exchangeInfo?symbol=SUIUSDT  → 5 КБ,
 *               api.binance.com/fapi/...            → 403 Forbidden.)
 *   • жёсткий таймаут + запасной хост (data-api.binance.vision для spot);
 *   • честный null при неудаче: вызывающий выводит точность из самих свечей
 *     (_inferPrecisionFromData) вместо того, чтобы навсегда закэшировать «2».
 */
(function () {
    'use strict';

    const SPOT_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
    const FUTURES_HOSTS = ['https://fapi.binance.com'];
    const BYBIT_HOSTS = ['https://api.bybit.com', 'https://api.bytick.com'];

    const REQUEST_TIMEOUT_MS = 8000;
    const MAX_DECIMALS = 8;

    const resolvedCache = new Map();   // `${symbol}:${exchange}:${marketType}` -> number
    const inflight = new Map();        // тот же ключ -> Promise (анти-дубль запросов)
    let futuresInfoPromise = null;     // общая карта futures-тикеров на сессию

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    /** Общий кэш точности, который читает Utils.formatPrice(). */
    function sharedCache() {
        if (typeof window === 'undefined') return null;
        if (!window.PRECISION_CACHE) {
            try { window.PRECISION_CACHE = new Map(); } catch (e) { return null; }
        }
        return window.PRECISION_CACHE;
    }

    function setShared(exchange, marketType, symbol, precision) {
        const shared = sharedCache();
        if (shared && typeof shared.set === 'function') {
            // Формат ключа Utils.formatPrice: `${exchange}_${marketType}_${symbol}`.
            try { shared.set(`${exchange}_${marketType}_${symbol}`, precision); } catch (e) {}
        }
    }

    /** '0.0001' -> 4. Отрицательное число знаков для цены смысла не имеет. */
    function decimalsFromTick(tick) {
        const n = parseFloat(tick);
        if (!isFinite(n) || n <= 0) return null;
        const d = Math.round(Math.log10(1 / n));
        if (!isFinite(d)) return null;
        return Math.max(0, Math.min(MAX_DECIMALS, d));
    }

    /** ' sui/usdt ' -> 'SUIUSDT' */
    function normalizeSymbol(symbol) {
        return String(symbol == null ? '' : symbol).trim().toUpperCase().replace(/[\s/\\:-]/g, '');
    }

    /** fetch с обязательным таймаутом; бросает исключение с .reason */
    async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
        const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
        try {
            const response = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
            if (!response.ok) {
                const err = new Error(`HTTP ${response.status}`);
                err.reason = 'http';
                err.status = response.status;
                throw err;
            }
            return await response.json();
        } catch (e) {
            if (e && e.name === 'AbortError') {
                const err = new Error(`таймаут ${timeoutMs} мс`);
                err.reason = 'timeout';
                throw err;
            }
            if (e && !e.reason) e.reason = 'network';
            throw e;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /** Точность из одной записи exchangeInfo Binance. */
    function precisionFromBinanceInfo(info) {
        if (!info) return null;
        let precision = Number(info.pricePrecision);
        if (!isFinite(precision) || precision < 0) {
            const filters = Array.isArray(info.filters) ? info.filters : [];
            const priceFilter = filters.find((f) => f && f.filterType === 'PRICE_FILTER');
            precision = decimalsFromTick(priceFilter && priceFilter.tickSize);
        }
        if (precision === null || precision === undefined || !isFinite(precision)) return null;
        return Math.max(0, Math.min(MAX_DECIMALS, Math.floor(precision)));
    }

    /**
     * Общий список futures-инструментов Binance. Качается ОДИН раз на сессию:
     * фильтр ?symbol= на /fapi/v1/exchangeInfo биржей игнорируется, поэтому
     * «точечный» запрос всё равно стоит ~1.1 МБ — бессмысленно повторять его
     * на каждый символ.
     */
    function loadBinanceFuturesMap() {
        if (!futuresInfoPromise) {
            futuresInfoPromise = (async () => {
                for (let i = 0; i < FUTURES_HOSTS.length; i++) {
                    try {
                        const data = await fetchJson(`${FUTURES_HOSTS[i]}/fapi/v1/exchangeInfo`, 20000);
                        const list = Array.isArray(data && data.symbols) ? data.symbols : [];
                        if (!list.length) continue;
                        const map = new Map();
                        for (const info of list) {
                            if (!info || !info.symbol) continue;
                            const p = precisionFromBinanceInfo(info);
                            if (p !== null) map.set(String(info.symbol).toUpperCase(), p);
                        }
                        if (map.size) return map;
                    } catch (e) {
                        console.warn(`⚠️ [VP-PRECISION] список futures-инструментов: ${e && e.message} (${FUTURES_HOSTS[i]})`);
                    }
                }
                return null;
            })();
            // неудачу НЕ кэшируем: следующая попытка спросит снова
            futuresInfoPromise.catch(() => { futuresInfoPromise = null; });
        }
        return futuresInfoPromise;
    }

    /** Точечный запрос точности. Число либо null. */
    async function requestPrecision(symbol, exchange, marketType) {
        // ---------- BINANCE ----------
        if (exchange === 'binance') {
            if (marketType === 'futures') {
                const map = await loadBinanceFuturesMap();
                if (!map) return null;
                return map.has(symbol) ? map.get(symbol) : null;   // тикера нет — честный null
            }
            for (let i = 0; i < SPOT_HOSTS.length; i++) {
                try {
                    const data = await fetchJson(
                        `${SPOT_HOSTS[i]}/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`
                    );
                    const list = Array.isArray(data && data.symbols) ? data.symbols : [];
                    const info = list.find((s) => s && s.symbol === symbol) || list[0] || null;
                    if (!info) return null;
                    return precisionFromBinanceInfo(info);
                } catch (e) {
                    const last = i === SPOT_HOSTS.length - 1;
                    console.warn(`⚠️ [VP-PRECISION] ${symbol} binance/spot: ${e && e.message} (${SPOT_HOSTS[i]})` +
                        (last ? ' — запасных хостов больше нет' : ', пробуем запасной хост'));
                    if (last) return null;
                    await sleep(150);
                }
            }
            return null;
        }

        // ---------- BYBIT ----------
        const category = marketType === 'futures' ? 'linear' : 'spot';
        for (let i = 0; i < BYBIT_HOSTS.length; i++) {
            try {
                const data = await fetchJson(
                    `${BYBIT_HOSTS[i]}/v5/market/instruments-info?category=${category}&symbol=${encodeURIComponent(symbol)}`
                );
                const info = (data && data.retCode === 0 && data.result &&
                    Array.isArray(data.result.list) && data.result.list[0]) || null;
                if (!info) return null;   // тикера нет на этом рынке
                if (marketType === 'futures' && Number.isFinite(Number(info.priceScale))) {
                    return Math.max(0, Math.min(MAX_DECIMALS, Math.floor(Number(info.priceScale))));
                }
                const d = decimalsFromTick(info.priceFilter && info.priceFilter.tickSize);
                return d === null ? null : d;
            } catch (e) {
                const last = i === BYBIT_HOSTS.length - 1;
                console.warn(`⚠️ [VP-PRECISION] ${symbol} bybit/${marketType}: ${e && e.message} (${BYBIT_HOSTS[i]})` +
                    (last ? ' — запасных хостов больше нет' : ', пробуем запасной хост'));
                if (last) return null;
                await sleep(150);
            }
        }
        return null;
    }

    /**
     * Точность цены тикера.
     *
     * @returns {Promise<number|null>} число знаков либо NULL, если узнать не
     *          удалось. Раньше при любой ошибке возвращалось «2», и вызывающий
     *          записывал эту двойку в localStorage как истину.
     */
    async function getPrecisionFromExchange(symbol, exchange, marketType) {
        const sym = normalizeSymbol(symbol);
        const ex = String(exchange || 'binance').toLowerCase() === 'bybit' ? 'bybit' : 'binance';
        const mt = String(marketType || 'futures').toLowerCase() === 'spot' ? 'spot' : 'futures';
        if (!sym) return null;

        const key = `${sym}:${ex}:${mt}`;
        if (resolvedCache.has(key)) return resolvedCache.get(key);
        if (inflight.has(key)) return inflight.get(key);

        const promise = (async () => {
            try {
                const precision = await requestPrecision(sym, ex, mt);
                if (typeof precision === 'number' && isFinite(precision) && precision >= 0) {
                    resolvedCache.set(key, precision);
                    setShared(ex, mt, sym, precision);
                    return precision;
                }
                return null;   // неудачу НЕ кэшируем
            } finally {
                inflight.delete(key);
            }
        })();

        inflight.set(key, promise);
        promise.catch(() => {});   // наружу отклонение не выпускаем: все ветки дают null
        return promise;
    }

    /** Диагностика для консоли. */
    function getPrecisionCacheSize() { return resolvedCache.size; }

    if (typeof window !== 'undefined') {
        window.getPrecisionFromExchange = getPrecisionFromExchange;
        window.PrecisionHelper = {
            getPrecisionFromExchange,
            decimalsFromTick,
            normalizeSymbol,
            getPrecisionCacheSize
        };
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { getPrecisionFromExchange, decimalsFromTick, normalizeSymbol };
    }
})();
