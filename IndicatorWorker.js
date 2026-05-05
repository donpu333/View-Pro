const workerCode = `
self.addEventListener('message', function(e) {
    const { task, calculations, indicatorType, indicatorId, data, params } = e.data;
    
    if (task === 'calculate') {
        // МАГИЯ: Вызываем функцию по имени строки (indicatorType) напрямую
        const func = self[indicatorType];
        const result = (typeof func === 'function') ? func(data, params) : null;
        self.postMessage({ task: 'result', indicatorId, result, success: result !== null });
    }
    else if (task === 'calculateMultiple') {
        const results = [];
        for (const calc of calculations) {
            try {
                const func = self[calc.type];
                const result = (typeof func === 'function') ? func(calc.data, calc.params) : null;
                results.push({ indicatorId: calc.indicatorId, result, success: result !== null });
            } catch (error) {
                results.push({ indicatorId: calc.indicatorId, error: error.message, success: false });
            }
        }
        self.postMessage({ task: 'resultMultiple', results });
    }
});

// === МАТЕМАТИКА (Без изменений, берем из прошлого исправленного кода) ===

function calculateSMA(data, period) {
    const times = data.map(d => d.time);
    const values = data.map(d => d.close);
    const result = [];
    for (let i = period - 1; i < values.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += values[i - j];
        result.push({ time: times[i], value: sum / period });
    }
    return result;
}

function calculateEMA(data, period) {
    const times = data.map(d => d.time);
    const values = data.map(d => d.close);
    const k = 2 / (period + 1);
    const result = [];
    for (let i = 0; i < values.length; i++) {
        if (i === 0) result.push({ time: times[i], value: values[0] });
        else result.push({ time: times[i], value: values[i] * k + result[i - 1].value * (1 - k) });
    }
    return result;
}

function calculateRSI(data, period = 14) {
    const times = data.map(d => d.time);
    const closes = data.map(d => d.close);
    const rsiData = [];
    if (closes.length <= period) return rsiData;
    let gains = [], losses = [];
    for (let i = 1; i < closes.length; i++) {
        let diff = closes[i] - closes[i-1];
        gains.push(diff > 0 ? diff : 0);
        losses.push(diff < 0 ? -diff : 0);
    }
    let avgGain = 0, avgLoss = 0;
    for (let i = 0; i < period; i++) { avgGain += gains[i]; avgLoss += losses[i]; }
    avgGain /= period; avgLoss /= period;
    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
        let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsiData.push({ time: times[i + 1], value: 100 - 100 / (1 + rs) });
    }
    return rsiData;
}

function calculateEMAArray(data, period) {
    const k = 2 / (period + 1);
    const ema = [data[0]];
    for (let i = 1; i < data.length; i++) ema.push(data[i] * k + ema[i-1] * (1 - k));
    return ema;
}

function calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const times = data.map(d => d.time);
    const closes = data.map(d => d.close);
    const emaFast = calculateEMAArray(closes, fastPeriod);
    const emaSlow = calculateEMAArray(closes, slowPeriod);
    const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
    const signalLine = calculateEMAArray(macdLine, signalPeriod);
    const histogram = macdLine.map((v, i) => v - signalLine[i]);
    return macdLine.map((v, i) => ({ time: times[i], macd: v, signal: signalLine[i], histogram: histogram[i] }));
}

function calculateStochRSI(data, period = 14, kSmooth = 3, dSmooth = 3) {
    const times = data.map(d => d.time);
    const closes = data.map(d => d.close);
    let rsi = [];
    if (closes.length < period + 1) return { k: [], d: [], times: [] };
    let gains = [], losses = [];
    for (let i = 1; i < closes.length; i++) {
        let diff = closes[i] - closes[i-1];
        gains.push(diff > 0 ? diff : 0);
        losses.push(diff < 0 ? -diff : 0);
    }
    let avgG = 0, avgL = 0;
    for (let i = 0; i < period; i++) { avgG += gains[i]; avgL += losses[i]; }
    avgG /= period; avgL /= period;
    for (let i = period; i < gains.length; i++) {
        avgG = (avgG * (period-1) + gains[i]) / period;
        avgL = (avgL * (period-1) + losses[i]) / period;
        let rs = avgL === 0 ? 100 : avgG / avgL;
        rsi.push(100 - 100 / (1 + rs));
    }
    let stochK = [];
    for (let i = period-1; i < rsi.length; i++) {
        let window = rsi.slice(i - period + 1, i + 1);
        let min = window[0], max = window[0];
        for(let j=1; j<window.length; j++) { if (window[j] < min) min = window[j]; if (window[j] > max) max = window[j]; }
        stochK.push((max === min) ? 50 : (rsi[i] - min) / (max - min) * 100);
    }
    let stochD = [];
    for (let i = dSmooth-1; i < stochK.length; i++) {
        let sum = 0;
        for (let j = 0; j < dSmooth; j++) sum += stochK[i - j];
        stochD.push(sum / dSmooth);
    }
    const offset = stochK.length - stochD.length;
    const timeOffset = (period * 2) + offset;
    return { k: stochK.slice(offset), d: stochD, times: times.slice(timeOffset) };
}

function calculateADX(data, period = 14) {
    const times = data.map(d => d.time);
    const highs = data.map(d => d.high), lows = data.map(d => d.low), closes = data.map(d => d.close);
    if (closes.length < period + 1) return [];
    const tr = [], plusDM = [], minusDM = [];
    for (let i = 1; i < closes.length; i++) {
        tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
        const upMove = highs[i] - highs[i-1], downMove = lows[i-1] - lows[i];
        plusDM.push((upMove > downMove && upMove > 0) ? upMove : 0);
        minusDM.push((downMove > upMove && downMove > 0) ? downMove : 0);
    }
    const smoothTR = smoothArray(tr, period), smoothPlusDM = smoothArray(plusDM, period), smoothMinusDM = smoothArray(minusDM, period);
    const plusDI = [], minusDI = [], dx = [];
    for (let i = 0; i < smoothTR.length; i++) {
        const diPlus = smoothTR[i] === 0 ? 0 : (smoothPlusDM[i] / smoothTR[i]) * 100;
        const diMinus = smoothTR[i] === 0 ? 0 : (smoothMinusDM[i] / smoothTR[i]) * 100;
        plusDI.push(diPlus); minusDI.push(diMinus);
        const diSum = diPlus + diMinus, diDiff = Math.abs(diPlus - diMinus);
        dx.push(diSum === 0 ? 0 : (diDiff / diSum) * 100);
    }
    const adx = smoothArray(dx, period);
    const result = [];
    const startIndex = (period - 1) + (period - 1) + 1;
    for (let i = 0; i < adx.length; i++) {
        const timeIndex = startIndex + i;
        if (timeIndex < times.length) result.push({ time: times[timeIndex], value: adx[i], plusDI: plusDI[i + period - 1], minusDI: minusDI[i + period - 1] });
    }
    return result;
}

function calculateATR(data, period = 14) {
    const times = data.map(d => d.time);
    const tr = [];
    for (let i = 1; i < data.length; i++) {
        tr.push(Math.max(data[i].high - data[i].low, Math.abs(data[i].high - data[i-1].close), Math.abs(data[i].low - data[i-1].close)));
    }
    const smoothedATR = smoothArray(tr, period);
    return smoothedATR.map((val, i) => ({ time: times[i + period], value: val }));
}

function smoothArray(arr, period) {
    if (arr.length < period) return [];
    const smoothed = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += arr[i];
    smoothed.push(sum / period);
    for (let i = period; i < arr.length; i++) smoothed.push(smoothed[smoothed.length - 1] + (arr[i] - smoothed[smoothed.length - 1]) / period);
    return smoothed;
}

// === МАРШРУТИЗАТОРЫ (Мостики между ID и Функциями) ===
// Если добавите новый индикатор, просто добавьте сюда строчку: function id(data, p) { return calculateFunc(data, p.param); }

function sma20(data, p) { return calculateSMA(data, p.period); }
function sma50(data, p) { return calculateSMA(data, p.period); }
function ema20(data, p) { return calculateEMA(data, p.period); }
function rsi14(data, p) { return calculateRSI(data, p.period); }
function stochrsi(data, p) { return calculateStochRSI(data, p.period, p.k, p.d); }
function macd(data, p) { return calculateMACD(data, p.fastPeriod, p.slowPeriod, p.signalPeriod); }
function adx(data, p) { return calculateADX(data, p.period); }
function atr(data, p) { return calculateATR(data, p.period); }
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