class DataFetcher {
    static INTERVALS = {
        seconds: { '1m':60, '3m':180, '5m':300, '15m':900, '30m':1800, '1h':3600, '4h':14400, '6h':21600, '12h':43200, '1d':86400, '1w':604800, '1M':2592000 },
        bybit: { '1m':'1', '3m':'3', '5m':'5', '15m':'15', '30m':'30', '1h':'60', '4h':'240', '6h':'360', '12h':'720', '1d':'D', '1w':'W', '1M':'M' }
    };

    static async loadMoreKlines(symbol, interval, endTime, exchange = 'binance', marketType = 'futures') {
        const limit = 1000;
        let url;
        
        if (exchange === 'binance') {
            url = marketType === 'futures'
                ? `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}&endTime=${endTime}`
                : `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}&endTime=${endTime}`;
        } else if (exchange === 'bybit') {
            const bybitInt = DataFetcher.INTERVALS.bybit[interval] || interval;
            const category = marketType === 'futures' ? 'linear' : 'spot';
            const stepSec = DataFetcher.INTERVALS.seconds[interval] || 3600;
            const startTime = Math.max(0, endTime - limit * stepSec * 1000);
            url = `https://api.bybit.com/v5/market/kline?category=${category}&symbol=${symbol}&interval=${bybitInt}&start=${startTime}&end=${endTime}&limit=${limit}`;
        } else {
            console.error('Неподдерживаемая биржа:', exchange);
            return [];
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                if (response.status === 400) {
                    console.warn('Символ не поддерживается для истории:', symbol);
                    return [];
                }
                throw new Error(`HTTP ${response.status}`);
            }
            
            const rawData = await response.json();
            
            if (exchange === 'binance') {
                if (!Array.isArray(rawData)) return [];
                return rawData.map(item => ({
                    time: Math.floor(item[0] / 1000),
                    open: parseFloat(item[1]),
                    high: parseFloat(item[2]),
                    low: parseFloat(item[3]),
                    close: parseFloat(item[4]),
                    volume: parseFloat(item[5])
                }));
            } else if (exchange === 'bybit') {
                if (rawData.retCode !== 0 || !rawData.result?.list) return [];
                return rawData.result.list
                    .map(item => ({
                        time: Math.floor(parseInt(item[0]) / 1000),
                        open: parseFloat(item[1]),
                        high: parseFloat(item[2]),
                        low: parseFloat(item[3]),
                        close: parseFloat(item[4]),
                        volume: parseFloat(item[5] || 0)
                    }))
                    .filter(c => c !== null)
                    .reverse();
            }
            return [];
            
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error('Ошибка загрузки истории:', e);
            }
            return [];
        }
    }
}

function positionsLine(positionMedia, pixelRatio, desiredWidthMedia = 1, widthIsBitmap = false) {
    const scaledPosition = Math.round(pixelRatio * positionMedia);
    const lineBitmapWidth = widthIsBitmap 
        ? desiredWidthMedia 
        : Math.round(desiredWidthMedia * pixelRatio);
    const centreOffset = Math.floor(lineBitmapWidth * 0.5);
    const position = scaledPosition - centreOffset;
    return { position, length: lineBitmapWidth };
}

function positionsBox(position1Media, position2Media, pixelRatio) {
    const scaledPosition1 = Math.round(pixelRatio * position1Media);
    const scaledPosition2 = Math.round(pixelRatio * position2Media);
    return {
        position: Math.min(scaledPosition1, scaledPosition2),
        length: Math.abs(scaledPosition2 - scaledPosition1) + 1,
    };
}

if (typeof window !== 'undefined') {
    window.DataFetcher = DataFetcher;
}