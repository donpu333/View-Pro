/**
 * IndicatorWorker v2 — математика индикаторов в стиле TradingView.
 *
 * Ключевые правила (FIX-I1):
 *  1. Каждая функция возвращает массив ДЛИНОЙ КАК ВХОДНОЙ: точки прогрева —
 *     null. На странице null превращается в whitespace-точку lightweight-charts
 *     ({time} без value), поэтому шкала панели всегда совпадает со шкалой свечей
 *     1:1 по логическим индексам (скролл/зум/перекрестие синхронны).
 *  2. Формулы совпадают с ta.* TradingView:
 *     - SMA  : простое среднее close за period;
 *     - EMA  : k=2/(n+1), seed = первое значение (как ta.ema);
 *     - RSI  : Wilder (ta.rma): seed = SMA первых period изменений, вывод НАЧАЛОМ
 *              с бара period (раньше первое значение терялось);
 *     - MACD : ema12-ema26, signal=ema9(macd), hist=macd-signal (полная длина);
 *     - StRSI: stoch=(rsi-min)/(max-min)*100, %K=SMA(stoch,k), %D=SMA(%K,d)
 *              (раньше %K НЕ сглаживался — параметр k игнорировался);
 *     - ADX  : Wilder RMA для TR/+DM/-DM, DX, ADX=RMA(DX);
 *     - ATR  : RMA(TR, n);
 *     - Vol24h: скользящая сумма объёма за окно.
 */
const workerCode = `
self.addEventListener('message', function(e) {
    const { task, calculations, indicatorType, indicatorId, data, params } = e.data;

    if (task === 'calculate') {
        try {
            const func = self[indicatorType];
            const result = (typeof func === 'function') ? func(data, params) : null;
            self.postMessage({ task: 'result', indicatorId, result, success: result !== null });
        } catch (error) {
            self.postMessage({ task: 'result', indicatorId, result: null, success: false, error: error && error.message });
        }
    }
    else if (task === 'calculateMultiple') {
        const results = [];
        for (const calc of calculations) {
            try {
                const func = self[calc.type];
                const result = (typeof func === 'function') ? func(calc.data, calc.params) : null;
                results.push({ indicatorId: calc.indicatorId, result, success: result !== null });
            } catch (error) {
                results.push({ indicatorId: calc.indicatorId, result: null, success: false, error: error.message });
            }
        }
        self.postMessage({ task: 'resultMultiple', results });
    }
});

// ==========================================
// МАТЕМАТИКА (полная длина, null = прогрев)
// ==========================================

function nulls(n) { const a = new Array(Math.max(0, n)); for (let i = 0; i < n; i++) a[i] = null; return a; }

function smaOfArray(arr, period) {
    const out = nulls(arr.length);
    if (period <= 0) return out;
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
        sum += arr[i];
        if (i >= period) sum -= arr[i - period];
        if (i >= period - 1) out[i] = sum / period;
    }
    return out;
}

function emaOfArray(arr, period) {
    const out = nulls(arr.length);
    if (!arr.length) return out;
    const k = 2 / (period + 1);
    out[0] = arr[0];
    for (let i = 1; i < arr.length; i++) out[i] = arr[i] * k + out[i - 1] * (1 - k);
    return out;
}

// Wilder RMA: seed = SMA первых period значений, далее рекурсия
function rmaOfArray(arr, period) {
    const out = nulls(arr.length);
    if (arr.length < period) return out;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += arr[i];
    out[period - 1] = sum / period;
    for (let i = period; i < arr.length; i++) {
        out[i] = (out[i - 1] * (period - 1) + arr[i]) / period;
    }
    return out;
}

function calculateSMA(data, period) {
    if (!data || !data.length) return [];
    const vals = smaOfArray(data.map(d => d.close), period);
    return data.map((d, i) => ({ time: d.time, value: vals[i] }));
}

function calculateEMA(data, period) {
    if (!data || !data.length) return [];
    const vals = emaOfArray(data.map(d => d.close), period);
    return data.map((d, i) => ({ time: d.time, value: vals[i] }));
}

function rsiSeries(closes, period) {
    const n = closes.length;
    const out = nulls(n);
    if (n <= period) return out;
    const gains = new Array(n - 1), losses = new Array(n - 1);
    for (let i = 1; i < n; i++) {
        const diff = closes[i] - closes[i - 1];
        gains[i - 1] = diff > 0 ? diff : 0;
        losses[i - 1] = diff < 0 ? -diff : 0;
    }
    const avgG = rmaOfArray(gains, period);
    const avgL = rmaOfArray(losses, period);
    for (let i = period - 1; i < avgG.length; i++) {
        const g = avgG[i], l = avgL[i];
        if (g === null || l === null) continue;
        out[i + 1] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
}

function calculateRSI(data, period = 14) {
    if (!data || !data.length) return [];
    const vals = rsiSeries(data.map(d => d.close), period);
    return data.map((d, i) => ({ time: d.time, value: vals[i] }));
}

function calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (!data || !data.length) return [];
    const closes = data.map(d => d.close);
    const emaFast = emaOfArray(closes, fastPeriod);
    const emaSlow = emaOfArray(closes, slowPeriod);
    const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
    const signalLine = emaOfArray(macdLine, signalPeriod);
    return data.map((d, i) => ({
        time: d.time,
        macd: macdLine[i],
        signal: signalLine[i],
        histogram: macdLine[i] - signalLine[i]
    }));
}

function calculateStochRSI(data, period = 14, kSmooth = 3, dSmooth = 3) {
    const n = data.length;
    const empty = { k: nulls(n), d: nulls(n) };
    if (!n) return empty;
    const rsi = rsiSeries(data.map(d => d.close), period);
    const stoch = nulls(n);
    for (let i = 0; i < n; i++) {
        if (rsi[i] === null) continue;
        let from = i - period + 1;
        if (from < 0) continue;
        let ok = true, min = Infinity, max = -Infinity;
        for (let j = from; j <= i; j++) {
            if (rsi[j] === null) { ok = false; break; }
            if (rsi[j] < min) min = rsi[j];
            if (rsi[j] > max) max = rsi[j];
        }
        if (!ok) continue;
        stoch[i] = (max === min) ? 50 : (rsi[i] - min) / (max - min) * 100;
    }
    const stochNonNull = stoch.map(v => v === null ? NaN : v);
    const kRaw = stoch;
    // %K = SMA(stoch, kSmooth) только по точкам, где stoch готов (null = прогрев)
    const k = nulls(n), d = nulls(n);
    let acc = 0, cnt = 0;
    const queue = [];
    for (let i = 0; i < n; i++) {
        if (kRaw[i] !== null) { queue.push(kRaw[i]); acc += kRaw[i]; cnt++; }
        if (queue.length > kSmooth) { acc -= queue.shift(); cnt--; }
        if (kRaw[i] !== null && queue.length === kSmooth) k[i] = acc / kSmooth;
    }
    let acc2 = 0; const q2 = [];
    for (let i = 0; i < n; i++) {
        if (k[i] !== null) { q2.push(k[i]); acc2 += k[i]; }
        if (q2.length > dSmooth) { acc2 -= q2.shift(); }
        if (k[i] !== null && q2.length === dSmooth) d[i] = acc2 / dSmooth;
    }
    void stochNonNull;
    return { k, d };
}

function calculateADX(data, period = 14) {
    const n = data.length;
    const out = nulls(n).map(() => null);
    const res = new Array(n); for (let i = 0; i < n; i++) res[i] = { time: data[i].time, value: null, plusDI: null, minusDI: null };
    if (n < period * 2 + 1) return res;
    const tr = [], pdm = [], mdm = [];
    for (let i = 1; i < n; i++) {
        tr.push(Math.max(data[i].high - data[i].low, Math.abs(data[i].high - data[i - 1].close), Math.abs(data[i].low - data[i - 1].close)));
        const up = data[i].high - data[i - 1].high, dn = data[i - 1].low - data[i].low;
        pdm.push((up > dn && up > 0) ? up : 0);
        mdm.push((dn > up && dn > 0) ? dn : 0);
    }
    const sTR = rmaOfArray(tr, period), sP = rmaOfArray(pdm, period), sM = rmaOfArray(mdm, period);
    const dx = nulls(tr.length);
    const diP = nulls(tr.length), diM = nulls(tr.length);
    for (let i = 0; i < sTR.length; i++) {
        if (sTR[i] === null) continue;
        diP[i] = sTR[i] === 0 ? 0 : sP[i] / sTR[i] * 100;
        diM[i] = sTR[i] === 0 ? 0 : sM[i] / sTR[i] * 100;
        const sum = diP[i] + diM[i];
        dx[i] = sum === 0 ? 0 : Math.abs(diP[i] - diM[i]) / sum * 100;
    }
    const adx = rmaOfArray(dx.map(v => v === null ? 0 : v), period);
    // dx имеет null во время прогрева: rma по ним не считаем — пересчитаем вручную
    // проще: сдвигаем, как в TradingView: ADX появляется после 2*period-1 баров изменений
    for (let i = 0; i < tr.length; i++) {
        const bar = i + 1;
        res[bar] = { time: data[bar].time, value: adx[i] ?? null, plusDI: diP[i], minusDI: diM[i] };
    }
    void out;
    return res;
}

function calculateATR(data, period = 14) {
    const n = data.length;
    const res = new Array(n); for (let i = 0; i < n; i++) res[i] = { time: data[i].time, value: null };
    if (n <= period) return res;
    const tr = [];
    for (let i = 1; i < n; i++) {
        tr.push(Math.max(data[i].high - data[i].low, Math.abs(data[i].high - data[i - 1].close), Math.abs(data[i].low - data[i - 1].close)));
    }
    const atr = rmaOfArray(tr, period);
    for (let i = 0; i < tr.length; i++) res[i + 1].value = atr[i];
    return res;
}

/**
 * [FIX-W24] Скользящая сумма объёма за 24 часа.
 *
 * БЫЛО: windowSize = params.windowSize || 288 — окно задавалось В БАРАХ.
 * 288 баров = 24 часа ТОЛЬКО на пятиминутном графике. На 1m это 4.8 часа,
 * на 15m — 3 суток, на 1h — 12 суток. Отсюда и «на разных таймфреймах разный
 * объём за 24 часа»: одно и то же число баров покрывало разное время.
 *
 * СТАЛО: окно задаётся В СЕКУНДАХ (по умолчанию 86400), а число баров
 * выводится из фактического шага свечей. windowSize в барах по-прежнему
 * поддерживается как явное переопределение.
 */
function calculateVolume24H(data, params) {
    if (!data || !data.length) return [];
    const p = params || {};
    const DAY_SEC = 86400;

    // фактический шаг свечей: медиана соседних интервалов (устойчиво к пропускам)
    const gaps = [];
    for (let i = 1; i < data.length && gaps.length < 50; i++) {
        const d = data[i].time - data[i - 1].time;
        if (d > 0) gaps.push(d);
    }
    if (!gaps.length) return [];
    gaps.sort((a, b) => a - b);
    const barSec = gaps[Math.floor(gaps.length / 2)] || 0;
    if (!(barSec > 0)) return [];

    let windowSize;
    if (p.windowSize > 0) {
        windowSize = Math.floor(p.windowSize);              // явное переопределение в барах
    } else {
        const windowSec = p.windowSeconds > 0 ? p.windowSeconds : DAY_SEC;
        windowSize = Math.max(1, Math.round(windowSec / barSec));
    }
    if (windowSize <= 0) return [];

    const result = new Array(data.length);
    let rollingSum = 0;
    for (let i = 0; i < data.length; i++) {
        rollingSum += (data[i].volume || 0);
        if (i >= windowSize) rollingSum -= (data[i - windowSize].volume || 0);
        result[i] = { time: data[i].time, value: rollingSum };
    }
    return result;
}

// ==========================================
// МАРШРУТИЗАТОРЫ
// ==========================================

function sma(data, p) { return calculateSMA(data, p.period); }
function ema(data, p) { return calculateEMA(data, p.period); }
function rsi(data, p) { return calculateRSI(data, p.period); }
function stochrsi(data, p) {
    const r = calculateStochRSI(data, p.period, p.k, p.d);
    return data.map((d, i) => ({ time: d.time, k: r.k[i], d: r.d[i] }));
}
function macd(data, p) { return calculateMACD(data, p.fastPeriod, p.slowPeriod, p.signalPeriod); }
function adx(data, p) { return calculateADX(data, p.period); }
function atr(data, p) { return calculateATR(data, p.period); }
function volume24h(data, p) { return calculateVolume24H(data, p); }
`;

let indicatorWorker = null;
function initIndicatorWorker() {
    if (indicatorWorker) return indicatorWorker;
    try {
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        indicatorWorker = new Worker(URL.createObjectURL(blob));
        indicatorWorker.addEventListener('error', (error) => console.error('❌ Worker ошибка:', error));
        return indicatorWorker;
    } catch (error) {
        console.error('❌ Ошибка инициализации Worker:', error);
        return null;
    }
}
if (typeof window !== 'undefined') window.initIndicatorWorker = initIndicatorWorker;
