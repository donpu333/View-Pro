const workerCode = `
self.addEventListener('message', function(e) {
    const { task, calculations, indicatorType, indicatorId, data, params } = e.data;
    
    if (task === 'calculate') {
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

// ==========================================
// 🧮 ЧИСТАЯ МАТЕМАТИКА (Оптимизированная)
// ==========================================

function calculateSMA(data, period) {
    const result = [];
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += data[i - j].close;
        result.push({ time: data[i].time, value: sum / period });
    }
    return result;
}

function calculateEMA(data, period) {
    const k = 2 / (period + 1);
    const result = [{ time: data[0].time, value: data[0].close }];
    for (let i = 1; i < data.length; i++) {
        result.push({ time: data[i].time, value: data[i].close * k + result[i - 1].value * (1 - k) });
    }
    return result;
}

function calculateRSI(data, period = 14) {
    const rsiData = [];
    if (data.length <= period) return rsiData;
    let gains = [], losses = [];
    for (let i = 1; i < data.length; i++) {
        const diff = data[i].close - data[i-1].close;
        gains.push(diff > 0 ? diff : 0);
        losses.push(diff < 0 ? -diff : 0);
    }
    let avgGain = 0, avgLoss = 0;
    for (let i = 0; i < period; i++) { avgGain += gains[i]; avgLoss += losses[i]; }
    avgGain /= period; avgLoss /= period;
    
    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsiData.push({ time: data[i + 1].time, value: 100 - 100 / (1 + rs) });
    }
    return rsiData;
}

function calculateEMAArray(arr, period) {
    const k = 2 / (period + 1);
    const ema = [arr[0]];
    for (let i = 1; i < arr.length; i++) ema.push(arr[i] * k + ema[i-1] * (1 - k));
    return ema;
}

function calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const closes = data.map(d => d.close);
    const emaFast = calculateEMAArray(closes, fastPeriod);
    const emaSlow = calculateEMAArray(closes, slowPeriod);
    const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
    const signalLine = calculateEMAArray(macdLine, signalPeriod);
    const histogram = macdLine.map((v, i) => v - signalLine[i]);
    return macdLine.map((v, i) => ({ time: data[i].time, macd: v, signal: signalLine[i], histogram: histogram[i] }));
}

function calculateStochRSI(data, period = 14, kSmooth = 3, dSmooth = 3) {
    const closes = data.map(d => d.close);
    let rsi = [];
    if (closes.length < period + 1) return { k: [], d: [], times: [] };
    let gains = [], losses = [];
    for (let i = 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i-1].close;
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
    return { k: stochK.slice(offset), d: stochD, times: data.map(d=>d.time).slice(timeOffset) };
}

function calculateADX(data, period = 14) {
    if (data.length < period + 1) return [];
    const tr = [], plusDM = [], minusDM = [];
    for (let i = 1; i < data.length; i++) {
        tr.push(Math.max(data[i].high - data[i].low, Math.abs(data[i].high - data[i-1].close), Math.abs(data[i].low - data[i-1].close)));
        const upMove = data[i].high - data[i-1].high, downMove = data[i-1].low - data[i].low;
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
        if (timeIndex < data.length) result.push({ time: data[timeIndex].time, value: adx[i], plusDI: plusDI[i + period - 1], minusDI: minusDI[i + period - 1] });
    }
    return result;
}

function calculateATR(data, period = 14) {
    const tr = [];
    for (let i = 1; i < data.length; i++) {
        tr.push(Math.max(data[i].high - data[i].low, Math.abs(data[i].high - data[i-1].close), Math.abs(data[i].low - data[i-1].close)));
    }
    const smoothedATR = smoothArray(tr, period);
    return smoothedATR.map((val, i) => ({ time: data[i + period].time, value: val }));
}

function calculateVolume24H(data, params) {
    if (!data || data.length === 0) return [];
    
    // Окно берем строго из параметров (например, 288 для 5m)
    const windowSize = params.windowSize || 288; 
    if (windowSize <= 0) return [];
    
    const result = [];
    for (let i = 0; i < data.length; i++) {
        let volSum = 0;
        const startIdx = Math.max(0, i - windowSize + 1);
        for (let j = startIdx; j <= i; j++) {
            volSum += (data[j].volume || 0);
        }
        result.push({
            time: data[i].time,
            value: volSum
        });
    }
    
    return result;
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

// ==========================================
// 🔗 МАРШРУТИЗАТОРЫ (Прямые мостики)
// ==========================================
// Универсально: sma, ema подойдут для ЛЮБОГО периода, period берется из params!

function sma(data, p) { return calculateSMA(data, p.period); }
function ema(data, p) { return calculateEMA(data, p.period); }
function rsi(data, p) { return calculateRSI(data, p.period); }
function stochrsi(data, p) { return calculateStochRSI(data, p.period, p.k, p.d); }
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
