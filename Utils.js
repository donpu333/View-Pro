const Utils = {
    formatPrice(price) {
        if (price === undefined || price === null) return '—';
        
        const absPrice = Math.abs(price);
        
        try {
            const cm = window.chartManager || window.app?.chartManager || window.chartManagerInstance;
            if (cm && cm.currentSymbol) {
                const key = `${cm.currentExchange}_${cm.currentMarketType}_${cm.currentSymbol}`;
                const precision = PRECISION_CACHE.get(key);
                if (precision !== undefined) return price.toFixed(precision);
            }
        } catch(e) {}
        
        if (absPrice >= 1000) return price.toFixed(2);
        if (absPrice >= 1) return price.toFixed(4);
        if (absPrice >= 0.01) return price.toFixed(6);
        if (absPrice > 0) {
            const str = absPrice.toFixed(10);
            const decimal = str.split('.')[1];
            let zeros = 0;
            for (let i = 0; i < decimal.length; i++) {
                if (decimal[i] === '0') zeros++;
                else break;
            }
            return price.toFixed(Math.min(zeros + 3, 10));
        }
        return '0';
    },
    
    formatTime(seconds) {
        if (seconds < 60) return seconds + 'с';
        if (seconds < 3600) return Math.floor(seconds / 60) + 'м ' + (seconds % 60) + 'с';
        return Math.floor(seconds / 3600) + 'ч ' + Math.floor((seconds % 3600) / 60) + 'м';
    },
    
    calculateChange(open, close) {
        if (!open || !close) return '0.00%';
        return ((close - open) / open * 100).toFixed(2) + '%';
    },
    
    isBullish(open, close) {
        return close >= open;
    },
    
    formatTimeRemaining(ms) {
        if (ms <= 0) return '00:00';
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        if (hours > 0) {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    },
    
    toMoscowTime(timestamp) {
        const date = new Date(timestamp);
        const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
        return new Date(utc + (3600000 * CONFIG.timezoneOffset));
    },
    
    calculateEMA(data, period) {
        const k = 2 / (period + 1);
        let ema = [data[0]];
        for (let i = 1; i < data.length; i++) {
            ema.push(data[i] * k + ema[i-1] * (1 - k));
        }
        return ema;
    },
    
    calculateSMA(data, period) {
        let sma = [];
        for (let i = period - 1; i < data.length; i++) {
            let sum = 0;
            for (let j = 0; j < period; j++) sum += data[i - j];
            sma.push(sum / period);
        }
        return sma;
    },
    
    calculateStochRSI(data, period = 14, k = 3, d = 3) {
        if (data.length < period + 1) return [];
        let rsi = [], gains = [], losses = [];
        for (let i = 1; i < data.length; i++) {
            let diff = data[i] - data[i-1];
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
            let min = Math.min(...window);
            let max = Math.max(...window);
            stochK.push(max === min ? 50 : (rsi[i] - min) / (max - min) * 100);
        }
        let stochD = [];
        for (let i = k-1; i < stochK.length; i++) {
            let sum = 0;
            for (let j = 0; j < k; j++) sum += stochK[i - j];
            stochD.push(sum / k);
        }
        return { k: stochK, d: stochD };
    },
    
    formatVolume(vol) {
        if (vol > 1e9) return (vol / 1e9).toFixed(1) + 'B';
        if (vol > 1e6) return (vol / 1e6).toFixed(1) + 'M';
        if (vol > 1e3) return (vol / 1e3).toFixed(1) + 'K';
        return vol.toFixed(0);
    }
};

// ========== ГЛОБАЛЬНЫЕ ФУНКЦИИ ==========

function waitForReady(checks, timeout = 5000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const check = () => {
            if (checks.every(fn => fn())) return resolve();
            if (Date.now() - start > timeout) return reject(new Error('Timeout'));
            setTimeout(check, 50);
        };
        check();
    });
}

// Общий кэш точности цены: ключ `${exchange}_${marketType}_${symbol}` -> число знаков.
// Читает Utils.formatPrice(), наполняет PrecisionHelper.js.
const PRECISION_CACHE = new Map();
window.PRECISION_CACHE = PRECISION_CACHE;

// [VP-PRECISION] getPrecisionFromExchange() здесь БОЛЬШЕ НЕ ОБЪЯВЛЕНА.
//
// Раньше функция существовала в ДВУХ файлах одновременно — здесь и в
// PrecisionHelper.js. В index.html PrecisionHelper.js подключён ПОСЛЕ Utils.js,
// поэтому в классических скриптах побеждало более позднее объявление: «лёгкая»
// версия (точечный exchangeInfo?symbol=XXX, ~5 КБ) была мёртвым кодом, а
// реально работала «тяжёлая» — она качала ВЕСЬ exchangeInfo Binance
// (~17 300 КБ для spot, ~1 100 КБ для futures) без таймаута и без отмены.
// Эта закачка шла параллельно с fetchKlines() и съедала канал: klines не
// успевал за _fetchTimeoutMs = 15 с, обрывался и возвращал null, а
// switchSymbol() бросал «Нет данных для SYMBOL».
//
// Единственный владелец функции теперь — PrecisionHelper.js. Одна точка
// объявления убирает риск повторного расхождения версий.

// ============================================================
// positionsLine — перенос из DataFetcher.js
// Используется в DrawingManagers.js и TimerManager.js (26 мест)
// ============================================================
function positionsLine(positionMedia, pixelRatio, desiredWidthMedia = 1, widthIsBitmap = false) {
    const scaledPosition = Math.round(pixelRatio * positionMedia);
    const lineBitmapWidth = widthIsBitmap
        ? desiredWidthMedia
        : Math.round(desiredWidthMedia * pixelRatio);
    const centreOffset = Math.floor(lineBitmapWidth * 0.5);
    const position = scaledPosition - centreOffset;
    return { position, length: lineBitmapWidth };
}

if (typeof window !== 'undefined') {
    window.Utils = Utils;
    window.positionsLine = positionsLine;
}
