/**
 * FundingManager — ставка фандинга (funding rate) для фьючерсов.
 *
 * Показывается в легенде графика (OTKP/MAKC/MIN/ZAKR/VOL/FAND) в двух видах:
 *  • наведение на ИСТОРИЧЕСКУЮ свечу — ставка, действовавшая на момент этой свечи
 *    (ближайший расчёт фандинга до её времени, шаг 8 часов);
 *  • наведение на ПОСЛЕДНЮЮ свечу — текущая ставка + сколько до следующего начисления.
 *
 * Источники:
 *  Binance futures: текущая  — fapi/v1/premiumIndex?symbol=X (lastFundingRate, nextFundingTime)
 *                   история — fapi/v1/fundingRate?symbol=X&limit=1000 (~333 суток)
 *  Bybit   linear : текущая  — v5/market/tickers?category=linear&symbol=X (fundingRate, nextFundingTime)
 *                   история — v5/market/funding/history?category=linear&symbol=X&limit=200 (~66 суток)
 *  Spot: фандинга нет — getRateAt() возвращает null, пункт легенды скрывается.
 *
 * Экономия запросов: история символа кэшируется в памяти на сессию (1 запрос на символ),
 * текущая ставка обновляется раз в 60 с и только в видимой вкладке (вес premiumIndex = 1).
 * Все запросы с таймаутом 6 с и проверкой «символ не сменился, пока летел запрос».
 */
class FundingManager {
    constructor(chartManager) {
        this.cm = chartManager;
        this.symbolKey = null;          // 'SYMBOL|exchange|marketType' — для чего держим данные
        this.current = null;            // { rate: Number (доля, 0.0001 = 0.01%), nextFundingTime: ms }
        this.history = [];              // [{ t: сек, rate: доля }] по возрастанию t
        this._histCache = new Map();    // symbolKey -> history (кэш сессии)
        this._refreshTimer = null;
        this._fetchSeq = 0;             // защита от гонки при быстрых переключениях
    }

    /** Вызывается ChartManager при смене символа (и при первичной загрузке). */
    onSymbolChanged(symbol, exchange, marketType) {
        const key = `${symbol}|${exchange}|${marketType}`;
        this.symbolKey = key;
        this.current = null;
        this.history = this._histCache.get(key) || [];
        this._fetchSeq++;
        if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
        if (marketType !== 'futures' || !symbol) return;   // спот: фандинга нет
        this.refreshCurrent();
        if (!this.history.length) this._loadHistory(symbol, exchange, key);
        // периодическое обновление текущей ставки (только видимая вкладка, только этот символ)
        this._refreshTimer = setInterval(() => {
            try {
                if (typeof document !== 'undefined' && document.hidden) return;
                if (this.symbolKey === key) this.refreshCurrent();
            } catch (e) {}
        }, 60000);
    }

    /** Текущая ставка + время следующего начисления. */
    async refreshCurrent() {
        if (!this.symbolKey) return;
        const [symbol, exchange, marketType] = this.symbolKey.split('|');
        if (marketType !== 'futures') return;
        const mySeq = this._fetchSeq;
        const keyAtStart = this.symbolKey;
        try {
            const d = await this._getJson(exchange === 'binance'
                ? `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`
                : `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${encodeURIComponent(symbol)}`);
            if (this.symbolKey !== keyAtStart || this._fetchSeq !== mySeq) return;   // уже другой символ
            let rate = null, nextT = null;
            if (exchange === 'binance') {
                if (!d || d.lastFundingRate === undefined) return;
                rate = parseFloat(d.lastFundingRate);
                nextT = parseInt(d.nextFundingTime, 10) || null;
            } else {
                const t = (d && d.retCode === 0 && Array.isArray(d.result && d.result.list)) ? d.result.list[0] : null;
                if (!t) return;
                rate = parseFloat(t.fundingRate);
                nextT = parseInt(t.nextFundingTime, 10) || null;
            }
            if (!isFinite(rate)) return;
            this.current = { rate, nextFundingTime: nextT };
            // легенда перекрестия открыта — освежить цифру сразу, не ждать следующего движения мыши
            try {
                if (this.cm && this.cm._latestCrosshairData && this.cm._latestCrosshairData.visible) {
                    this.cm._applyCrosshairDOMOptimized();
                }
            } catch (e) {}
        } catch (e) { /* фандинг — информация справочная, молча живём без него */ }
    }

    /** История начислений (8-часовые отметки) — один раз на символ за сессию. */
    async _loadHistory(symbol, exchange, key) {
        const mySeq = this._fetchSeq;
        try {
            let arr = [];
            if (exchange === 'binance') {
                const d = await this._getJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${encodeURIComponent(symbol)}&limit=1000`);
                if (Array.isArray(d)) {
                    arr = d.map(x => ({ t: Math.floor((x.fundingTime || 0) / 1000), rate: parseFloat(x.fundingRate) }))
                           .filter(x => x.t > 0 && isFinite(x.rate));
                }
            } else if (exchange === 'bybit') {
                const d = await this._getJson(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${encodeURIComponent(symbol)}&limit=200`);
                const list = (d && d.retCode === 0 && Array.isArray(d.result && d.result.list)) ? d.result.list : null;
                if (list) {
                    arr = list.map(x => ({ t: Math.floor((x.fundingRateTimestamp || 0) / 1000), rate: parseFloat(x.fundingRate) }))
                           .filter(x => x.t > 0 && isFinite(x.rate));
                }
            }
            if (!arr.length) return;
            arr.sort((a, b) => a.t - b.t);
            this._histCache.set(key, arr);
            if (this.symbolKey === key && this._fetchSeq === mySeq) this.history = arr;
        } catch (e) {}
    }

    /**
     * Ставка фандинга (доля: 0.0001 = 0.01%) на момент свечи timeSec.
     * null — если это спот / данных нет. Для последней свечи и правее истории —
     * текущая ставка (она же действует до следующего начисления).
     */
    getRateAt(timeSec) {
        if (!this.symbolKey) return null;
        const parts = this.symbolKey.split('|');
        if (parts[2] !== 'futures') return null;
        const t = Number(timeSec);
        if (!isFinite(t) || t <= 0) return this.current ? this.current.rate : null;
        const h = this.history;
        if (!h || !h.length) return this.current ? this.current.rate : null;
        // бинарный поиск: последнее начисление с t <= timeSec
        let lo = 0, hi = h.length - 1, res = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (h[mid].t <= t) { res = mid; lo = mid + 1; } else { hi = mid - 1; }
        }
        if (res === -1) return h[0].rate;                       // свеча левее всей истории
        if (res === h.length - 1 && this.current) return this.current.rate;  // правый край — живая ставка
        return h[res].rate;
    }

    /** «3ч05м» до следующего начисления (пустая строка, если неизвестно). */
    getNextFundingText() {
        if (!this.current || !this.current.nextFundingTime) return '';
        const ms = this.current.nextFundingTime - Date.now();
        if (!(ms > 0)) return 'сейчас';
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        return `${h}ч${String(m).padStart(2, '0')}м`;
    }

    /** fetch с таймаутом 6 с; null при любой ошибке. */
    async _getJson(url) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 6000);
        try {
            const r = await fetch(url, { signal: ctrl.signal });
            if (!r.ok) return null;
            return await r.json();
        } catch (e) {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    destroy() {
        this._fetchSeq++;
        if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
        this._histCache.clear();
        this.history = [];
        this.current = null;
        this.symbolKey = null;
    }
}

if (typeof window !== 'undefined') {
    window.FundingManager = FundingManager;
}
