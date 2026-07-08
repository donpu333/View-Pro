class ADXIndicator extends BaseIndicator {
    static meta = { name: 'ADX', category: 'trend', panel: 'adx', color: '#66BB6A' };

    constructor(manager) {
        super(manager, 'adx', 'ADX', '#66BB6A', 'adx');
        this.settings.period = 14;
    }
    
    getWorkerType() { return 'adx'; }
    getWorkerParams() { return { period: this.settings.period }; }
    
    getSettingsHTML() {
        return `
            ${super.getSettingsHTML()}
            <div class="settings-row">
                <label>Период ADX:</label>
                <input type="number" id="indicatorPeriod" value="${this.settings.period}" min="5" max="50" style="width: 70px;">
            </div>
        `;
    }
    
    applySettingsFromForm() {
        const periodInput = document.getElementById('indicatorPeriod');
        if (periodInput) this.settings.period = parseInt(periodInput.value);
        super.applySettingsFromForm();
    }
    
        createSeries() {
        this._removeAllSeries();
        const panelManager = this.manager.panelManager;
        const panelId = this.data.panel;
        
        this.series = [
            panelManager.addSeries(panelId, `${this.type}-line`, 'line', { color: this.settings.color, lineWidth: this.settings.lineWidth }),
            panelManager.addSeries(panelId, `${this.type}-plus`, 'line', { color: '#4CAF50', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed }),
            panelManager.addSeries(panelId, `${this.type}-minus`, 'line', { color: '#FF5252', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed })
        ];
        
        return this.series;
    }
    
    updateSeriesData(data) {
        if (!data || !data.length) return;
        if (this.series[0]) this.series[0].setData(this.manager._filterData(data.map(d => ({ time: d.time, value: d.value }))));
        if (this.series[1]) this.series[1].setData(this.manager._filterData(data.map(d => ({ time: d.time, value: d.plusDI }))));
        if (this.series[2]) this.series[2].setData(this.manager._filterData(data.map(d => ({ time: d.time, value: d.minusDI }))));
    }
}

class ATRIndicator extends BaseIndicator {
    static meta = { name: 'ATR', category: 'volatility', panel: 'atr', color: '#AB47BC' };

    constructor(manager) {
        super(manager, 'atr', 'ATR', '#AB47BC', 'atr');
        this.settings.period = 14;
    }
    
    getWorkerType() { return 'atr'; }
    getWorkerParams() { return { period: this.settings.period }; }
    
    getSettingsHTML() {
        return `
            ${super.getSettingsHTML()}
            <div class="settings-row">
                <label>Период ATR:</label>
                <input type="number" id="indicatorPeriod" value="${this.settings.period}" min="5" max="50" style="width: 70px;">
            </div>
        `;
    }
    
    applySettingsFromForm() {
        const periodInput = document.getElementById('indicatorPeriod');
        if (periodInput) this.settings.period = parseInt(periodInput.value);
        super.applySettingsFromForm();
    }
    
       createSeries() {
        this._removeAllSeries();
        const panelManager = this.manager.panelManager;
        const panelId = this.data.panel;
        
        this.series = [
            panelManager.addSeries(panelId, `${this.type}-line`, 'line', { color: this.settings.color, lineWidth: this.settings.lineWidth })
        ];
        
        return this.series;
    }
    
    updateSeriesData(data) {
        if (!data || !data.length) return;
        if (this.series[0]) this.series[0].setData(this.manager._filterData(data));
    }
}

class EMAIndicator extends BaseIndicator {
    static meta = { name: 'EMA 20', category: 'trend', panel: 'main', color: '#00E5FF' };

    constructor(manager, period, name, color) {
        super(manager, `ema${period}`, name, color, 'main');
        this.settings.period = period;
    }
    
    getWorkerType() { return 'ema'; }
    getWorkerParams() { return { period: this.settings.period }; }
    
    getSettingsHTML() {
        return `
            ${super.getSettingsHTML()}
            <div class="settings-row">
                <label>Период EMA:</label>
                <input type="number" id="indicatorPeriod" value="${this.settings.period}" min="1" max="200" style="width: 70px;">
            </div>
        `;
    }
    
    applySettingsFromForm() {
        const periodInput = document.getElementById('indicatorPeriod');
        if (periodInput) this.settings.period = parseInt(periodInput.value);
        super.applySettingsFromForm();
    }
    
   _createEmptySeries() {
    this._removeAllSeries();
    this.series = [
        this.manager.chartManager.chart.addSeries(LightweightCharts.LineSeries, { color: this.settings.color, lineWidth: this.settings.lineWidth })
    ];
}
    updateSeriesData(data) {
        if (!data || !data.length) return;
        if (this.series[0]) this.series[0].setData(this.manager._filterData(data));
    }
}

class MACDIndicator extends BaseIndicator {
    static meta = { name: 'MACD', category: 'histogram', panel: 'macd', color: '#FFB6C1' };

    constructor(manager) {
        super(manager, 'macd', 'MACD', '#FFB6C1', 'macd');
        this.settings.fastPeriod = 12;
        this.settings.slowPeriod = 26;
        this.settings.signalPeriod = 9;
    }
    
    getWorkerType() { return 'macd'; }
    getWorkerParams() { return { fastPeriod: this.settings.fastPeriod, slowPeriod: this.settings.slowPeriod, signalPeriod: this.settings.signalPeriod }; }
    
    getSettingsHTML() {
        return `
            ${super.getSettingsHTML()}
            <div class="settings-row"><label>Быстрый:</label><input type="number" id="indicatorFastPeriod" value="${this.settings.fastPeriod}" min="5" max="50" style="width: 70px;"></div>
            <div class="settings-row"><label>Медленный:</label><input type="number" id="indicatorSlowPeriod" value="${this.settings.slowPeriod}" min="10" max="100" style="width: 70px;"></div>
            <div class="settings-row"><label>Сигнальный:</label><input type="number" id="indicatorSignalPeriod" value="${this.settings.signalPeriod}" min="5" max="50" style="width: 70px;"></div>
        `;
    }
    
    applySettingsFromForm() {
        if (document.getElementById('indicatorFastPeriod')) this.settings.fastPeriod = parseInt(document.getElementById('indicatorFastPeriod').value);
        if (document.getElementById('indicatorSlowPeriod')) this.settings.slowPeriod = parseInt(document.getElementById('indicatorSlowPeriod').value);
        if (document.getElementById('indicatorSignalPeriod')) this.settings.signalPeriod = parseInt(document.getElementById('indicatorSignalPeriod').value);
        super.applySettingsFromForm();
    }
    
        createSeries() {
        this._removeAllSeries(); // ✅ ДОБАВЛЕНО
        const pm = this.manager.panelManager;
        const pid = this.data.panel;
        
        // 1. Гистограмма — ТОЖЕ НА ПРАВОЙ ШКАЛЕ
        const histSeries = pm.addSeries(pid, `${this.type}-histogram`, 'histogram', {
            priceLineVisible: false,
            lastValueVisible: false,
            priceScaleId: 'right',     
            scaleMargins: { top: 0.2, bottom: 0.05 }
        });
        
        // Нулевая линия на ПРАВОЙ шкале
        histSeries.createPriceLine({
            price: 0,
            color: '#787b86',
            lineWidth: 1,
            lineStyle: LightweightCharts.LineStyle.SparseDotted,
            axisLabelVisible: true,
            title: 'Zero'
        });
        
        // 2. Линия MACD — ПРАВАЯ ШКАЛА
        const macdSeries = pm.addSeries(pid, `${this.type}-line`, 'line', {
            color: '#2196F3',
            lineWidth: this.settings.lineWidth,
            priceScaleId: 'right',
            lastValueVisible: true,
            title: 'MACD'
        });
        
        // 3. Сигнальная линия — ПРАВАЯ ШКАЛА
        const signalSeries = pm.addSeries(pid, `${this.type}-signal`, 'line', {
            color: '#ff6d00',
            lineWidth: 2,
            priceScaleId: 'right',
            lastValueVisible: true,
            title: 'Signal'
        });
        
        this.series = [histSeries, macdSeries, signalSeries];
        return this.series; // ✅ ДОБАВЛЕНО
    }
    updateSeriesData(data) {
        if (!data || !data.length) return;
        const chartData = this.manager.chartManager.chartData;
        if (!chartData || chartData.length === 0) return;
        
        // Индексируем данные
        const macdMap = new Map(), signalMap = new Map(), histMap = new Map();
        data.forEach(item => { macdMap.set(item.time, item.macd); signalMap.set(item.time, item.signal); histMap.set(item.time, item.histogram); });
        
        const macdData = [], signalData = [], histData = [];
        
        chartData.forEach((candle, index) => {
            if (macdMap.has(candle.time)) {
                const macd = macdMap.get(candle.time);
                const signal = signalMap.get(candle.time);
                const hist = histMap.get(candle.time);
                
                macdData.push({ time: candle.time, value: macd });
                signalData.push({ time: candle.time, value: signal });
                
                // ТОЧНАЯ КОПИЯ ЛОГИКИ TV: 4 цвета в зависимости от текущего и предыдущего значения
                // color hColor = hist >= 0 ? hist > hist[1] ? #26a69a : #b2dfdb : hist > hist[1] ? #ffcdd2 : #ff5252
                let hColor;
                const prevHist = index > 0 ? (histMap.get(chartData[index - 1].time) || 0) : 0;
                
                if (hist >= 0) {
                    // Растущая гистограмма (темно-зеленая) или падающая (светло-зеленая)
                    hColor = hist > prevHist ? '#26a69a' : '#b2dfdb';
                } else {
                    // Падающая гистограмма (темно-красная) или растущая (светло-красная)
                    hColor = hist > prevHist ? '#ffcdd2' : '#ff5252';
                }
                
                histData.push({ time: candle.time, value: hist, color: hColor });
            }
        });
        
        // Применяем данные. Порядок важен: [0] = hist, [1] = macd, [2] = signal
        if (this.series[0]) this.series[0].setData(histData);
        if (this.series[1]) this.series[1].setData(macdData);
        if (this.series[2]) this.series[2].setData(signalData);
    }
}
class MultiTimeframeATRIndicator extends BaseIndicator {
    constructor(manager) {
        super(manager, 'multiatr', 'ATR Multi', '#FFA500', 'main');
        
        const savedSettings = this._loadSettings();
        
        this.settings = {
            atrPeriod: savedSettings.atrPeriod || 3,
            rangeMode: savedSettings.rangeMode || 'High-Low',
            useFilter: savedSettings.useFilter !== undefined ? savedSettings.useFilter : true,
            filterType: savedSettings.filterType || 'Adaptive',
            devFactor: savedSettings.devFactor || 1.0,
            fixedMult: savedSettings.fixedMult || 1.5,
            showWeekTF: savedSettings.showWeekTF !== undefined ? savedSettings.showWeekTF : true,
            weekATRPeriod: savedSettings.weekATRPeriod || 3,
            showDayTF: savedSettings.showDayTF !== undefined ? savedSettings.showDayTF : true,
            dayATRPeriod: savedSettings.dayATRPeriod || 3,
            showHourTF: savedSettings.showHourTF !== undefined ? savedSettings.showHourTF : true,
            hourATRPeriod: savedSettings.hourATRPeriod || 12,
            hourTF: savedSettings.hourTF || '1',
            showMinuteTF: savedSettings.showMinuteTF !== undefined ? savedSettings.showMinuteTF : true,
            minuteATRPeriod: savedSettings.minuteATRPeriod || 6,
            minuteTF: savedSettings.minuteTF || '5',
            showMinute1TF: savedSettings.showMinute1TF !== undefined ? savedSettings.showMinute1TF : true,
            minute1ATRPeriod: savedSettings.minute1ATRPeriod || 3,
            minute1TF: savedSettings.minute1TF || '1',
            showTable: savedSettings.showTable !== undefined ? savedSettings.showTable : true
        };
        
        this.cache = {
            week: { atr: 0, natr: 0, progress: 0, remaining: 0, remainingPoints: 0 },
            day: { atr: 0, natr: 0, progress: 0, remaining: 0, remainingPoints: 0 },
            hour: { atr: 0, natr: 0, progress: 0, remaining: 0, remainingPoints: 0 },
            minute: { atr: 0, natr: 0, progress: 0, remaining: 0, remainingPoints: 0 },
            minute1: { atr: 0, natr: 0, progress: 0, remaining: 0, remainingPoints: 0 },
            current: { atr: 0, natr: 0, progress: 0, remaining: 0, remainingPoints: 0, rangeRatio: 0, trueRange: 0, isValid: true, upperBound: 0, lowerBound: 0, isAnomaly: false, anomalyType: null }
        };
        
        this._lastCandleTime = 0;
        this._isUpdating = false;
        this._updateTimeout = null;
        this._fallbackTimer = null;
        this._currentApiInterval = '1h';
        
        this._setupEventHandlers();
        this._initTableDOM();
        setTimeout(() => this.updateAllMetrics(), 500);
    }
    
    _loadSettings() {
        try {
            const key = 'atr_multi_settings';
            const saved = localStorage.getItem(key);
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            return {};
        }
    }

    _saveSettings() {
        try {
            localStorage.setItem('atr_multi_settings', JSON.stringify(this.settings));
        } catch (e) {}
    }
    
    get visible() { return this._visible; }
    
    set visible(value) {
        this._visible = value;
        this.settings.showTable = value;
        const table = document.getElementById('multiatr-full-table');
        if (table) table.style.display = value && this.settings.showTable ? 'block' : 'none';
        this._saveSettings();
        if (this.manager) this.manager._saveIndicators();
    }

    getWorkerType() { return null; }
    calculateAsync() {}
    
    _initTableDOM() {
        if (document.getElementById('multiatr-full-table')) return;
        
        const wrapper = document.createElement('div');
        wrapper.id = 'multiatr-full-table';
        wrapper.style.cssText = `
            position: fixed; top: 80px; left: 20px;
            background: rgba(10, 10, 26, 0.95); border: 1px solid #2A2A4A;
            border-radius: 8px; font-family: 'JetBrains Mono', monospace; font-size: 11px;
            color: #fff; z-index: 10000; backdrop-filter: blur(4px);
            min-width: 420px; display: none; box-shadow: 0 4px 15px rgba(0,0,0,0.5);
        `;
        
        const header = document.createElement('div');
        header.id = 'multiatr-header';
        header.style.cssText = `
            padding: 8px 12px; border-bottom: 1px solid #2A2A4A;
            cursor: move; display: flex; justify-content: space-between; align-items: center;
            border-radius: 8px 8px 0 0; background: rgba(255, 165, 0, 0.1);
            user-select: none;
        `;
        header.innerHTML = `
            <span style="color:#22E00F; font-weight:bold; pointer-events: none;">📊 ATR MULTI</span>
            <div style="display: flex; gap: 8px; align-items: center;">
                <span id="multiatr-toggle" style="cursor: pointer; color: #888; font-size: 14px; padding: 0 4px;">▼</span>
                <span id="multiatr-close" style="cursor: pointer; color: #FF4444; font-size: 14px; padding: 0 4px; font-weight: bold;" title="Удалить индикатор">✕</span>
            </div>
        `;
        wrapper.appendChild(header);
        
        const body = document.createElement('div');
        body.id = 'multiatr-body';
        body.style.cssText = `padding: 10px 12px;`;
        wrapper.appendChild(body);
        
        document.body.appendChild(wrapper);
        
        this._setupDrag(header, wrapper);
        document.getElementById('multiatr-toggle').addEventListener('mousedown', (e) => e.stopPropagation());
        document.getElementById('multiatr-toggle').addEventListener('click', () => this._toggleBody(body));
        document.getElementById('multiatr-close').addEventListener('mousedown', (e) => e.stopPropagation());
        document.getElementById('multiatr-close').addEventListener('click', () => {
            if (this.manager) {
                const index = this.manager.activeIndicators?.indexOf(this);
                if (index !== undefined && index !== -1) this.manager.removeIndicator(index);
            }
        });
        body.addEventListener('click', (e) => this._handleCopy(e));
    }

    _toggleBody(body) {
        const isHidden = body.style.display === 'none';
        body.style.display = isHidden ? 'block' : 'none';
        document.getElementById('multiatr-toggle').innerText = isHidden ? '▼' : '▶';
    }

    _handleCopy(e) {
        const btn = e.target.closest('.copy-atr-btn');
        if (!btn) return;
        e.stopPropagation();
        const value = btn.getAttribute('data-value');
        if (!value || value === '0') return;
        navigator.clipboard.writeText(value).then(() => {
            const originalText = btn.innerText;
            btn.innerText = '✅';
            btn.style.color = '#22E00F';
            setTimeout(() => { btn.innerText = originalText; btn.style.color = '#888'; }, 1000);
        }).catch(() => {});
    }

    _setupDrag(handle, element) {
        let isDragging = false, startX, startY, initialLeft, initialTop;
        handle.addEventListener('mousedown', (e) => {
            if (e.target.id === 'multiatr-toggle' || e.target.id === 'multiatr-close') return;
            isDragging = true; startX = e.clientX; startY = e.clientY;
            const rect = element.getBoundingClientRect(); initialLeft = rect.left; initialTop = rect.top;
            element.style.transition = 'none'; element.style.right = 'auto'; element.style.bottom = 'auto';
        });
        this._dragMoveHandler = (e) => { if (!isDragging) return; e.preventDefault(); element.style.left = `${initialLeft + e.clientX - startX}px`; element.style.top = `${initialTop + e.clientY - startY}px`; };
        this._dragUpHandler = () => { if (isDragging) { isDragging = false; element.style.transition = ''; } };
        document.addEventListener('mousemove', this._dragMoveHandler);
        document.addEventListener('mouseup', this._dragUpHandler);
    }

    _normalizeInterval(interval) {
        if (!interval) return '1h';
        const i = interval.toString().toLowerCase().trim();
        if (['1', '1m', 'm1'].includes(i)) return '1m';
        if (['3', '3m', 'm3'].includes(i)) return '3m';
        if (['5', '5m', 'm5'].includes(i)) return '5m';
        if (['15', '15m', 'm15'].includes(i)) return '15m';
        if (['30', '30m', 'm30'].includes(i)) return '30m';
        if (['60', '1h', 'h1', 'h'].includes(i)) return '1h';
        if (['120', '2h', 'h2'].includes(i)) return '2h';
        if (['240', '4h', 'h4'].includes(i)) return '4h';
        if (['360', '6h', 'h6'].includes(i)) return '6h';
        if (['720', '12h', 'h12'].includes(i)) return '12h';
        if (['d', '1d', 'day'].includes(i)) return '1d';
        if (['w', '1w', 'week'].includes(i)) return '1w';
        return '1h';
    }

    _displayInterval(apiInterval) {
        const map = { '1m': '1M', '3m': '3M', '5m': '5M', '15m': '15M', '30m': '30M', '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6H', '12h': '12H', '1d': '1D', '1w': '1W' };
        return map[apiInterval] || apiInterval.toUpperCase();
    }

    calculateCandlesFromHours(hours, minuteTFStr) {
        return Math.max(Math.floor(hours * 60 / parseInt(minuteTFStr)), 1);
    }
    
    computeATRMetrics(data, period, rangeMode, useFilter, filterType, devFactor, fixedMult) {
        if (!data || data.length < period + 1) return { atr: 0, natr: 0, progress: 0, remaining: 0, remainingPoints: 0, trueRange: 0, rangeRatio: 0, upperBound: 0, lowerBound: 0, isValid: true, isAnomaly: false, anomalyType: null };

        const ranges = [];
        for (let i = 0; i < data.length; i++) {
            if (rangeMode === 'True Range' && i > 0) {
                const prevClose = data[i - 1].close;
                ranges.push(Math.max(data[i].high - data[i].low, Math.abs(data[i].high - prevClose), Math.abs(data[i].low - prevClose)));
            } else {
                ranges.push(data[i].high - data[i].low);
            }
        }

        if (ranges.length < period) return { atr: 0, natr: 0, progress: 0, remaining: 0, remainingPoints: 0, trueRange: 0, rangeRatio: 0, upperBound: 0, lowerBound: 0, isValid: true, isAnomaly: false, anomalyType: null };

        const rma = (src, len) => {
            const result = new Array(src.length).fill(0);
            let sum = 0;
            for (let i = 0; i < len; i++) sum += src[i];
            result[len - 1] = sum / len;
            for (let i = len; i < src.length; i++) result[i] = (src[i] + (len - 1) * result[i - 1]) / len;
            return result;
        };

        if (!useFilter) {
            const atrArray = rma(ranges, period);
            const lastIdx = ranges.length - 1;
            const atr = atrArray[lastIdx];
            const lastCandle = data[lastIdx];
            const dist = Math.abs(lastCandle.close - lastCandle.open);
            const prog = atr > 0 ? (dist / atr) * 100 : 0;
            return { atr, natr: lastCandle.close > 0 ? (atr / lastCandle.close) * 100 : 0, progress: Math.min(prog, 100), remaining: Math.max(0, 100 - prog), remainingPoints: Math.max(0, atr - dist), trueRange: ranges[lastIdx], rangeRatio: (lastIdx > 0 && atrArray[lastIdx - 1] > 0) ? (ranges[lastIdx] / atrArray[lastIdx - 1]) * 100 : 0, upperBound: 0, lowerBound: 0, isValid: true, isAnomaly: false, anomalyType: null };
        }

        const rawRMA = rma(ranges, period);
        const filteredRanges = [...ranges];
        const filteredATR = new Array(ranges.length).fill(0);
        
        for (let i = 0; i < period; i++) {
            filteredRanges[i] = ranges[i];
            if (i === period - 1) { let sum = 0; for (let j = 0; j < period; j++) sum += ranges[j]; filteredATR[i] = sum / period; }
            else if (i > 0) { let sum = 0; for (let j = 0; j <= i; j++) sum += ranges[j]; filteredATR[i] = sum / (i + 1); }
            else filteredATR[i] = ranges[i];
        }
        
        let upperBound = 0, lowerBound = 0;
        
        for (let i = period; i < ranges.length; i++) {
            const currentRange = ranges[i];
            const prevRawATR = rawRMA[i - 1];
            if (filterType === 'Adaptive') {
                const window = ranges.slice(Math.max(0, i - period), i);
                const mean = window.reduce((a, b) => a + b, 0) / window.length;
                const variance = window.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / window.length;
                const stdDev = Math.sqrt(variance);
                upperBound = Math.min(prevRawATR + stdDev * devFactor, prevRawATR * 3.0);
                lowerBound = Math.max(prevRawATR - stdDev * devFactor, prevRawATR * 0.3);
            } else {
                upperBound = prevRawATR * fixedMult;
                lowerBound = Math.max(prevRawATR / fixedMult, 0);
            }
            
            filteredRanges[i] = (currentRange > upperBound || currentRange < lowerBound) ? prevRawATR : currentRange;
            filteredATR[i] = (filteredRanges[i] + (period - 1) * filteredATR[i - 1]) / period;
        }
        
        const lastIdx = ranges.length - 1;
        const atr = filteredATR[lastIdx];
        const lastCandle = data[lastIdx];
        const lastRange = ranges[lastIdx];
        const prevATR = lastIdx > 0 ? filteredATR[lastIdx - 1] : atr;
        const isCurrentlyAnomaly = lastRange > upperBound || lastRange < lowerBound;
        const distFromOpen = Math.abs(lastCandle.close - lastCandle.open);
        const progress = atr > 0 ? (distFromOpen / atr) * 100 : 0;
        
        return { atr, natr: lastCandle.close > 0 ? (atr / lastCandle.close) * 100 : 0, progress: Math.min(progress, 100), remaining: Math.max(0, 100 - progress), remainingPoints: Math.max(0, atr - distFromOpen), trueRange: lastRange, rangeRatio: prevATR > 0 ? (lastRange / prevATR) * 100 : 0, upperBound, lowerBound, isValid: !isCurrentlyAnomaly, isAnomaly: isCurrentlyAnomaly, anomalyType: lastRange > upperBound ? 'LARGE' : (lastRange < lowerBound ? 'SMALL' : null) };
    }
    
    async updateAllMetrics() {
        if (this._isUpdating) return;
        this._isUpdating = true;
        if (this._updateTimeout) clearTimeout(this._updateTimeout);

        try {
            const chartManager = this.manager?.chartManager;
            if (!chartManager?.chartData?.length) return;

            const rawInterval = chartManager.currentInterval || '60';
            this._currentApiInterval = this._normalizeInterval(rawInterval);

            // 🔥 ГЛАВНОЕ ИСПРАВЛЕНИЕ: Хранилище промисов, чтобы не делать 2 одинаковых запроса
            const apiRequests = {};

            // Функция: если запрос с такими параметрами уже есть — просто копирует результат
            const fetchOnce = (reqKey, cacheKey, tf, period) => {
                if (!apiRequests[reqKey]) {
                    apiRequests[reqKey] = this._fetchAndCompute(cacheKey, tf, period);
                } else {
                    // Если ключ совпал (⭐ и 1H имеют одинаковые ТФ и период),
                    // мы не делаем новый запрос, а просто копируем данные из первого
                    apiRequests[reqKey] = apiRequests[reqKey].then(() => {
                        if (cacheKey !== 'current') {
                            this.cache[cacheKey] = { ...this.cache.current };
                        }
                    });
                }
            };

            // 1. Строка ⭐ (текущий ТФ графика)
            const starKey = `${this._currentApiInterval}_${this.settings.atrPeriod}`;
            fetchOnce(starKey, 'current', this._currentApiInterval, this.settings.atrPeriod);
            
            // 2. Остальные строки
            if (this.settings.showWeekTF) {
                fetchOnce(`1w_${this.settings.weekATRPeriod}`, 'week', '1w', this.settings.weekATRPeriod);
            }
            if (this.settings.showDayTF) {
                fetchOnce(`1d_${this.settings.dayATRPeriod}`, 'day', '1d', this.settings.dayATRPeriod);
            }
            if (this.settings.showHourTF) {
                fetchOnce(`${this.settings.hourTF}h_${this.settings.hourATRPeriod}`, 'hour', this.settings.hourTF + 'h', this.settings.hourATRPeriod);
            }
            if (this.settings.showMinuteTF) {
                const p = this.calculateCandlesFromHours(this.settings.minuteATRPeriod, this.settings.minuteTF);
                fetchOnce(`${this.settings.minuteTF}m_${p}`, 'minute', this.settings.minuteTF + 'm', p);
            }
            if (this.settings.showMinute1TF) {
                const p = this.calculateCandlesFromHours(this.settings.minute1ATRPeriod, this.settings.minute1TF);
                fetchOnce(`${this.settings.minute1TF}m_${p}`, 'minute1', this.settings.minute1TF + 'm', p);
            }

            await Promise.allSettled(Object.values(apiRequests));
            this.renderFullTable();
        } catch (e) {
            console.error('ATR Multi error:', e);
        } finally {
            this._isUpdating = false;
        }
    }

    async _fetchAndCompute(cacheKey, tf, period) {
        const limit = Math.max(period * 3, 200);
        try {
            const data = await this.fetchDataForTF(tf, limit);
            if (data && data.length >= period + 1) {
                const m = this.computeATRMetrics(data, period, this.settings.rangeMode, this.settings.useFilter, this.settings.filterType, this.settings.devFactor, this.settings.fixedMult);
                
                if (cacheKey === 'current') {
                    this.cache[cacheKey] = m;
                } else {
                    this.cache[cacheKey] = { atr: m.atr, natr: m.natr, progress: m.progress, remaining: m.remaining, remainingPoints: m.remainingPoints };
                }
            }
        } catch (e) {
            console.error(`ATR Multi: ошибка загрузки ${tf}:`, e);
        }
    }
    
    _setupEventHandlers() {
        const chartManager = this.manager?.chartManager;
        if (!chartManager) return;
        if (chartManager._subscribeToSymbolChange) chartManager._subscribeToSymbolChange(() => setTimeout(() => this.updateAllMetrics(), 500));
        if (chartManager.on && typeof chartManager.on === 'function') {
            chartManager.on('dataUpdate', () => this._onChartDataUpdate());
        } else {
            this._startFallbackTimer();
        }
    }
    
    _onChartDataUpdate() {
        if (this._updateTimeout) clearTimeout(this._updateTimeout);
        this._updateTimeout = setTimeout(() => {
            const data = this.manager?.chartManager?.chartData;
            if (!data?.length) return;
            const lastTime = data[data.length - 1].time;
            if (lastTime !== this._lastCandleTime) { this._lastCandleTime = lastTime; this.updateAllMetrics(); }
        }, 100);
    }
    
    _startFallbackTimer() {
        if (this._fallbackTimer) return;
        let lastTime = 0;
        this._fallbackTimer = setInterval(() => {
            const data = this.manager?.chartManager?.chartData;
            if (data?.length && data[data.length - 1].time !== lastTime) { lastTime = data[data.length - 1].time; this.updateAllMetrics(); }
        }, 5000);
    }

    destroy() {
        if (this._fallbackTimer) { clearInterval(this._fallbackTimer); this._fallbackTimer = null; }
        if (this._updateTimeout) { clearTimeout(this._updateTimeout); this._updateTimeout = null; }
        if (this._dragMoveHandler) document.removeEventListener('mousemove', this._dragMoveHandler);
        if (this._dragUpHandler) document.removeEventListener('mouseup', this._dragUpHandler);
        const table = document.getElementById('multiatr-full-table');
        if (table) table.remove();
        this._removeAllSeries();
        this.manager = null;
    }
    
    async fetchDataForTF(tf, limit) {
        const chartManager = this.manager?.chartManager;
        if (!chartManager) return [];
        const { currentSymbol: symbol, currentExchange: exchange, currentMarketType: marketType } = chartManager;
        const bybitIntervalMap = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '6h': '360', '8h': '480', '12h': '720', '1d': 'D', '1w': 'W' };
        
        let url;
        if (exchange === 'binance') {
            const base = marketType === 'futures' ? 'https://fapi.binance.com/fapi/v1/klines' : 'https://api.binance.com/api/v3/klines';
            url = `${base}?symbol=${symbol}&interval=${tf}&limit=${limit}`;
        } else {
            const category = marketType === 'futures' ? 'linear' : 'spot';
            url = `https://api.bybit.com/v5/market/kline?category=${category}&symbol=${symbol}&interval=${bybitIntervalMap[tf] || tf}&limit=${limit}`;
        }
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) return [];
            const data = await response.json();
            
            if (exchange === 'binance') {
                return Array.isArray(data) ? data.map(item => ({ time: Math.floor(item[0] / 1000), open: parseFloat(item[1]), high: parseFloat(item[2]), low: parseFloat(item[3]), close: parseFloat(item[4]), volume: parseFloat(item[5]) })) : [];
            } else {
                if (data.retCode !== 0 || !data.result?.list) return [];
                return data.result.list.reverse().map(item => ({ time: Math.floor(parseInt(item[0]) / 1000), open: parseFloat(item[1]), high: parseFloat(item[2]), low: parseFloat(item[3]), close: parseFloat(item[4]), volume: parseFloat(item[5] || 0) }));
            }
        } catch (e) { return []; }
    }
    
    renderFullTable() {
        const wrapper = document.getElementById('multiatr-full-table');
        const body = document.getElementById('multiatr-body');
        if (!wrapper || !body) return;
        if (!this.visible || !this.settings.showTable) { wrapper.style.display = 'none'; return; }
        wrapper.style.display = 'block';

        const c = this.cache;
        const current = c.current;
        let decimals = 2;
        try {
            const chartData = this.manager?.chartManager?.chartData;
            if (chartData && chartData.length > 0) {
                const last = chartData[chartData.length - 1];
                [last.open, last.high, last.low, last.close].forEach(p => {
                    const s = p.toString();
                    if (s.includes('.')) { const d = s.split('.')[1].replace(/0+$/, '').length; if (d > decimals) decimals = d; }
                });
            }
        } catch(e) {}
        
        const formatATR = (v) => (!v || v === 0) ? '—' : v.toFixed(decimals);
        const formatPercent = (v) => (v === undefined || v === null || isNaN(v)) ? '—%' : v.toFixed(1) + '%';
        const progressColor = (p) => p > 80 ? '#FF4444' : p > 50 ? '#FFA500' : '#FFFFFF';
        const remainingColor = (r) => r < 20 ? '#FF4444' : r < 50 ? '#FFA500' : '#FFFFFF';
        
        const modeText = this.settings.rangeMode === 'True Range' ? 'TR' : 'HL';
        const filterText = this.settings.useFilter ? (this.settings.filterType === 'Adaptive' ? `A${this.settings.devFactor}` : `F${this.settings.fixedMult}`) : 'Off';
        const headerTitle = wrapper.querySelector('#multiatr-header span:first-child');
        if(headerTitle) headerTitle.innerText = `📊 ATR MULTI [ ${modeText} | ${filterText} ]`;

        const addRow = (label, color, atrValue, natr, progress, remaining) => {
            const atrFormatted = formatATR(atrValue);
            const copyBtn = atrFormatted !== '—' ? `<button class="copy-atr-btn" data-value="${atrFormatted}" style="background:none;border:none;color:#888;cursor:pointer;font-size:10px;padding:0 2px;margin-left:4px;line-height:1;" title="Скопировать ATR">📋</button>` : '';
            return `<tr>
                <td style="padding:3px 4px; color:${color}; white-space:nowrap;">${label}</td>
                <td style="text-align:right; padding:3px 4px; color:#FFFFFF; font-weight: bold;">${atrFormatted}${copyBtn}</td>
                <td style="text-align:right; padding:3px 4px; color:#AAAAAA;">${formatPercent(natr)}</td>
                <td style="text-align:right; padding:3px 4px; color:${progressColor(progress)};">${formatPercent(progress)}</td>
                <td style="text-align:right; padding:3px 4px; color:${remainingColor(remaining)};">${formatPercent(remaining)}</td>
            </tr>`;
        };

        let rowsHTML = `
            <table style="border-collapse:collapse; width:100%;">
                <tr style="border-bottom:1px solid #3A3A5A;">
                    <th style="text-align:left; padding:2px 4px; color:#666; font-weight:normal;">ТФ</th>
                    <th style="text-align:right; padding:2px 4px; color:#666; font-weight:normal;">ATR</th>
                    <th style="text-align:right; padding:2px 4px; color:#666; font-weight:normal;">NATR</th>
                    <th style="text-align:right; padding:2px 4px; color:#666; font-weight:normal;">Пройд.</th>
                    <th style="text-align:right; padding:2px 4px; color:#666; font-weight:normal;">Ост.</th>
                </tr>
        `;
        
        if (this.settings.showWeekTF) rowsHTML += addRow(`W (${this.settings.weekATRPeriod})`, '#FFA500', c.week.atr, c.week.natr, c.week.progress, c.week.remaining);
        if (this.settings.showDayTF) rowsHTML += addRow(`D (${this.settings.dayATRPeriod})`, '#4A90E2', c.day.atr, c.day.natr, c.day.progress, c.day.remaining);
        if (this.settings.showHourTF) rowsHTML += addRow(`${this.settings.hourTF}H (${this.settings.hourATRPeriod})`, '#FF69B4', c.hour.atr, c.hour.natr, c.hour.progress, c.hour.remaining);
        if (this.settings.showMinuteTF) rowsHTML += addRow(`${this.settings.minuteTF}M (${this.settings.minuteATRPeriod}ч)`, '#22E00F', c.minute.atr, c.minute.natr, c.minute.progress, c.minute.remaining);
        if (this.settings.showMinute1TF) rowsHTML += addRow(`${this.settings.minute1TF}M (${this.settings.minute1ATRPeriod}ч)`, '#00FFFF', c.minute1.atr, c.minute1.natr, c.minute1.progress, c.minute1.remaining);
        
        const displayTF = this._displayInterval(this._currentApiInterval || '1h');
        rowsHTML += `<tr style="border-top:1px solid #2A2A4A;">`;
        rowsHTML += addRow(`⭐ ${displayTF} (${this.settings.atrPeriod})`, '#FFD700', current.atr, current.natr, current.progress, current.remaining);
        
        rowsHTML += `
            <tr style="border-top:1px solid #2A2A4A;">
                <td style="padding:3px 4px; color:#666; font-size:10px;">Свеча</td>
                <td style="text-align:right; padding:3px 4px; color:#FFFFFF; font-size:10px;">${formatATR(current.trueRange)}</td>
                <td style="text-align:right; padding:3px 4px; color:${current.rangeRatio > 100 ? '#F44' : '#0F0'}; font-size:10px;">${formatPercent(current.rangeRatio)}</td>
                <td colspan="2" style="font-size:10px; color:#444;">—</td>
            </tr>
        `;
        
        if (this.settings.useFilter && current.upperBound > 0) rowsHTML += `<tr><td style="padding:2px 4px; color:#555; font-size:9px;" colspan="5">Фильтр: [ ${formatATR(current.lowerBound)} — ${formatATR(current.upperBound)} ]</td></tr>`;
        if (current.isAnomaly) {
            const anomalyColor = current.anomalyType === 'LARGE' ? '#FF4444' : '#4488FF';
            const anomalyText = current.anomalyType === 'LARGE' ? 'БОЛЬШАЯ АНОМАЛИЯ' : 'МАЛЕНЬКАЯ АНОМАЛИЯ';
            rowsHTML += `<tr><td style="padding:2px 4px; color:${anomalyColor}; font-size:9px;" colspan="5">⚠️ ${anomalyText}: свеча ${formatATR(current.trueRange)}</td></tr>`;
        }
        
        rowsHTML += `</table>`;
        body.innerHTML = rowsHTML;
    }
    
    getSettingsHTML() {
        return `
            <div style="max-height:400px; overflow-y:auto; padding-right:5px; scrollbar-width: thin; scrollbar-color: #4A4A4A #1E1E1E;">
                <div style="margin-bottom:12px;">
                    <div style="color:#FFA500; margin-bottom:8px;">📊 Основные настройки</div>
                    <div style="margin-bottom:8px; display:flex; align-items:center; gap:10px;">
                        <label style="color:#B0B0B0; width:120px;">Период ATR:</label>
                        <input type="number" id="atrPeriod" value="${this.settings.atrPeriod}" min="1" max="50" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px; width:80px;">
                    </div>
                    <div style="margin-bottom:8px; display:flex; align-items:center; gap:10px;">
                        <label style="color:#B0B0B0; width:120px;">Режим:</label>
                        <select id="rangeMode" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px;">
                            <option value="High-Low" ${this.settings.rangeMode === 'High-Low' ? 'selected' : ''}>High-Low</option>
                            <option value="True Range" ${this.settings.rangeMode === 'True Range' ? 'selected' : ''}>True Range</option>
                        </select>
                    </div>
                    <div style="margin-bottom:8px; display:flex; align-items:center; gap:10px;">
                        <label style="color:#B0B0B0; width:120px;">Фильтр:</label>
                        <input type="checkbox" id="useFilter" ${this.settings.useFilter ? 'checked' : ''} style="accent-color:#4A90E2;">
                    </div>
                    <div id="filterSettings" style="margin-left:130px; display: ${this.settings.useFilter ? 'block' : 'none'};">
                        <div style="margin-bottom:8px; display:flex; align-items:center; gap:10px;">
                            <label style="color:#B0B0B0; width:80px;">Тип:</label>
                            <select id="filterType" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px;">
                                <option value="Adaptive" ${this.settings.filterType === 'Adaptive' ? 'selected' : ''}>Adaptive</option>
                                <option value="Fixed" ${this.settings.filterType === 'Fixed' ? 'selected' : ''}>Fixed</option>
                            </select>
                        </div>
                        <div id="adaptiveSettings" style="margin-bottom:8px; display: ${this.settings.filterType === 'Adaptive' ? 'flex' : 'none'}; align-items:center; gap:10px;">
                            <label style="color:#B0B0B0; width:80px;">Девиация:</label>
                            <input type="number" id="devFactor" min="0.1" max="2.0" step="0.1" value="${this.settings.devFactor}" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px; width:80px;">
                        </div>
                        <div id="fixedSettings" style="margin-bottom:8px; display: ${this.settings.filterType === 'Fixed' ? 'flex' : 'none'}; align-items:center; gap:10px;">
                            <label style="color:#B0B0B0; width:80px;">Множитель:</label>
                            <input type="number" id="fixedMult" min="1.1" max="3.0" step="0.1" value="${this.settings.fixedMult}" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px; width:80px;">
                        </div>
                    </div>
                </div>
                <div style="margin-bottom:12px;">
                    <div style="color:#FFA500; margin-bottom:8px;">📅 Таймфреймы</div>
                    <div style="margin-bottom:6px; display:flex; align-items:center; gap:10px;">
                        <label style="color:#B0B0B0; width:70px;">W ATR:</label>
                        <input type="checkbox" id="showWeekTF" ${this.settings.showWeekTF ? 'checked' : ''}>
                        <input type="number" id="weekATRPeriod" value="${this.settings.weekATRPeriod}" min="1" max="20" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px; width:60px;">
                    </div>
                    <div style="margin-bottom:6px; display:flex; align-items:center; gap:10px;">
                        <label style="color:#B0B0B0; width:70px;">D ATR:</label>
                        <input type="checkbox" id="showDayTF" ${this.settings.showDayTF ? 'checked' : ''}>
                        <input type="number" id="dayATRPeriod" value="${this.settings.dayATRPeriod}" min="1" max="20" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px; width:60px;">
                    </div>
                    <div style="margin-bottom:6px; display:flex; align-items:center; gap:10px;">
                        <label style="color:#B0B0B0; width:70px;">H ATR:</label>
                        <input type="checkbox" id="showHourTF" ${this.settings.showHourTF ? 'checked' : ''}>
                        <select id="hourTF" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px;">${['1','2','3','4','6','8','12'].map(v => `<option value="${v}" ${this.settings.hourTF === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
                        <input type="number" id="hourATRPeriod" value="${this.settings.hourATRPeriod}" min="1" max="100" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px; width:60px;">
                    </div>
                    <div style="margin-bottom:6px; display:flex; align-items:center; gap:10px;">
                        <label style="color:#B0B0B0; width:70px;">M ATR:</label>
                        <input type="checkbox" id="showMinuteTF" ${this.settings.showMinuteTF ? 'checked' : ''}>
                        <select id="minuteTF" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px;">${['1','2','3','5','10','15','30'].map(v => `<option value="${v}" ${this.settings.minuteTF === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
                        <input type="number" id="minuteATRPeriod" value="${this.settings.minuteATRPeriod}" min="1" max="24" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px; width:60px;"><span style="color:#888;">ч</span>
                    </div>
                    <div style="margin-bottom:6px; display:flex; align-items:center; gap:10px;">
                        <label style="color:#B0B0B0; width:70px;">1M ATR:</label>
                        <input type="checkbox" id="showMinute1TF" ${this.settings.showMinute1TF ? 'checked' : ''}>
                        <select id="minute1TF" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px;">${['1','2','3','5','10','15','30'].map(v => `<option value="${v}" ${this.settings.minute1TF === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
                        <input type="number" id="minute1ATRPeriod" value="${this.settings.minute1ATRPeriod}" min="1" max="24" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px; width:60px;"><span style="color:#888;">ч</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    applySettingsFromForm() {
        this.settings.atrPeriod = parseInt(document.getElementById('atrPeriod')?.value || 3);
        this.settings.rangeMode = document.getElementById('rangeMode')?.value || 'High-Low';
        this.settings.useFilter = document.getElementById('useFilter')?.checked || false;
        this.settings.filterType = document.getElementById('filterType')?.value || 'Adaptive';
        this.settings.devFactor = parseFloat(document.getElementById('devFactor')?.value || 1);
        this.settings.fixedMult = parseFloat(document.getElementById('fixedMult')?.value || 1.5);
        this.settings.showWeekTF = document.getElementById('showWeekTF')?.checked || false;
        this.settings.weekATRPeriod = parseInt(document.getElementById('weekATRPeriod')?.value || 5);
        this.settings.showDayTF = document.getElementById('showDayTF')?.checked || false;
        this.settings.dayATRPeriod = parseInt(document.getElementById('dayATRPeriod')?.value || 5);
        this.settings.showHourTF = document.getElementById('showHourTF')?.checked || false;
        this.settings.hourTF = document.getElementById('hourTF')?.value || '1';
        this.settings.hourATRPeriod = parseInt(document.getElementById('hourATRPeriod')?.value || 24);
        this.settings.showMinuteTF = document.getElementById('showMinuteTF')?.checked || false;
        this.settings.minuteTF = document.getElementById('minuteTF')?.value || '5';
        this.settings.minuteATRPeriod = parseInt(document.getElementById('minuteATRPeriod')?.value || 3);
        this.settings.showMinute1TF = document.getElementById('showMinute1TF')?.checked || false;
        this.settings.minute1TF = document.getElementById('minute1TF')?.value || '1';
        this.settings.minute1ATRPeriod = parseInt(document.getElementById('minute1ATRPeriod')?.value || 1);
        
        this._saveSettings();
        this.updateAllMetrics();
        super.applySettingsFromForm();
    }
    
    _createEmptySeries() { this._removeAllSeries(); }
    
    updateSeriesData(data) {
        if (data && data.length) {
            const lastTime = data[data.length - 1].time;
            if (lastTime !== this._lastCandleTime) { this._lastCandleTime = lastTime; this.updateAllMetrics(); }
        }
    }
}
class Volume24HIndicator extends BaseIndicator {
    static meta = { name: 'Vol 24H', category: 'info', panel: 'vol24h', color: '#2962FF' };

    constructor(manager) {
        super(manager, 'volume24h', 'Vol 24H', '#2962FF', 'vol24h');
        this.settings.color = '#2962FF';
        this._baseVolumes = [];
        this._updateInterval = null;
        this._dataLoaded = false;
        this._pendingTimer = null;

        // Тултип
        this._volumeData = [];
        this._volumeMap = new Map();
        this._tooltipEl = null;
        this._crosshairTimer = null;
        this._initTooltip();
        setTimeout(() => this._bindCrosshair(), 300);

        this._setupListeners();
    }

    getWorkerType() { return null; }
    calculateAsync() {}

    createSeries() {
        this._removeAllSeries();
        const pm = this.manager.panelManager;
        const pid = this.data.panel;
        this.series = [
            pm.addSeries(pid, `${this.type}-hist`, 'histogram', {
                color: this.settings.color,
                priceFormat: { type: 'volume' },
                priceLineVisible: false,
                lastValueVisible: true,
                priceScaleId: 'right',
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 5,
                crosshairMarkerBorderColor: '#ffffff',
                crosshairMarkerBackgroundColor: this.settings.color,
            })
        ];
        return this.series;
    }

    _setupListeners() {
        const cm = this.manager?.chartManager;
        if (!cm) return;

        if (cm._subscribeToSymbolChange) {
            cm._subscribeToSymbolChange(() => {
                this._baseVolumes = [];
                this._dataLoaded = false;
                if (this._pendingTimer) clearTimeout(this._pendingTimer);
                this._waitForChartData(cm);
            });
        }

        this._updateInterval = setInterval(() => {
            if (this._dataLoaded) this.fetchAndCalculate();
        }, 60000);

        this._waitForChartData(cm);
    }

    _waitForChartData(cm) {
        if (cm.chartData && cm.chartData.length > 1) {
            this._dataLoaded = true;
            this.fetchAndCalculate();
            return;
        }
        this._pendingTimer = setTimeout(() => {
            this._waitForChartData(cm);
        }, 200);
    }

    async fetchAndCalculate() {
        const cm = this.manager?.chartManager;
        if (!cm?.currentSymbol || !this._dataLoaded) return;

        try {
            const currentTF = cm.currentInterval;
            const chartData = cm.chartData;
            if (!chartData || chartData.length === 0) return;

            if (currentTF === '1d' && chartData.length > 1) {
                const daysNeeded = chartData.length + 50;
                const dailyBars = await this._fetchKlines(
                    cm.currentSymbol, cm.currentExchange, cm.currentMarketType,
                    '1d', daysNeeded
                );
                if (!dailyBars || dailyBars.length === 0) return;

                const dailyMap = new Map(dailyBars.map(b => [b.time, b.volume]));
                const historyData = chartData.map(candle => ({
                    time: candle.time,
                    value: dailyMap.get(candle.time) || 0
                }));

                const live5m = await this._fetchKlines(
                    cm.currentSymbol, cm.currentExchange, cm.currentMarketType,
                    '5m', 300
                );
                if (live5m && live5m.length > 0) {
                    const msIn24h = 24 * 60 * 60 * 1000;
                    const lastTime = live5m[live5m.length - 1].time * 1000;
                    let sum = 0;
                    for (let i = live5m.length - 1; i >= 0; i--) {
                        if (lastTime - live5m[i].time * 1000 > msIn24h) break;
                        sum += live5m[i].volume || 0;
                    }
                    if (historyData.length > 0) {
                        historyData[historyData.length - 1].value = sum;
                    }
                }

                this.series[0].setData(historyData);
                this._volumeData = historyData.filter(d => d.value > 0);
                this._volumeMap = new Map(historyData.map(d => [d.time, d.value]));

            } else {
                const data = await this._fetchKlines(
                    cm.currentSymbol, cm.currentExchange, cm.currentMarketType,
                    '5m', 388
                );
                if (!data || data.length === 0) return;

                const msIn24h = 24 * 60 * 60 * 1000;
                const calculated = [];
                for (let i = 0; i < data.length; i++) {
                    let sum = 0;
                    for (let j = i; j >= 0; j--) {
                        if (data[i].time * 1000 - data[j].time * 1000 <= msIn24h) {
                            sum += data[j].volume || 0;
                        } else break;
                    }
                    calculated.push({ time: data[i].time, value: sum });
                }
                this._baseVolumes = calculated;
                this._alignToMainChart();
            }
        } catch (e) {
            console.warn('Vol 24H: Ошибка', e);
        }
    }

    _alignToMainChart() {
        if (!this.series[0] || !this._baseVolumes.length) return;
        const chartData = this.manager.chartManager.chartData;
        if (!chartData || chartData.length === 0) return;

        const aligned = [];
        let vIdx = 0;
        const lastIdx = this._baseVolumes.length - 1;

        for (let i = 0; i < chartData.length; i++) {
            const mainTime = chartData[i].time;
            if (i === chartData.length - 1) {
                aligned.push({ time: mainTime, value: this._baseVolumes[lastIdx].value });
                continue;
            }
            while (vIdx < lastIdx && this._baseVolumes[vIdx + 1].time <= mainTime) {
                vIdx++;
            }
            aligned.push({ time: mainTime, value: this._baseVolumes[vIdx].value });
        }
        this.series[0].setData(aligned);
        this._volumeData = aligned.filter(d => d.value > 0);
        this._volumeMap = new Map(aligned.map(d => [d.time, d.value]));
    }

    async _fetchKlines(symbol, exchange, marketType, tf, limit) {
        const bybitMap = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D', '1w': 'W' };
        let url;
        if (exchange === 'binance') {
            const base = marketType === 'futures' ? 'https://fapi.binance.com/fapi/v1/klines' : 'https://api.binance.com/api/v3/klines';
            url = `${base}?symbol=${symbol}&interval=${tf}&limit=${limit}`;
        } else {
            const category = marketType === 'futures' ? 'linear' : 'spot';
            url = `https://api.bybit.com/v5/market/kline?category=${category}&symbol=${symbol}&interval=${bybitMap[tf] || tf}&limit=${limit}`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) return [];
            const data = await response.json();

            if (exchange === 'binance') {
                return Array.isArray(data) ? data.map(k => ({ time: Math.floor(k[0] / 1000), volume: parseFloat(k[7]) || 0 })) : [];
            } else {
                if (data.retCode !== 0 || !data.result?.list) return [];
                return data.result.list.reverse().map(k => ({ time: Math.floor(parseInt(k[0]) / 1000), volume: parseFloat(k[6]) || 0 }));
            }
        } catch (err) {
            clearTimeout(timeoutId);
            return [];
        }
    }

    // ---------- ТУЛТИП ----------
    _initTooltip() {
        if (document.getElementById('vol24h-tooltip')) return;
        const el = document.createElement('div');
        el.id = 'vol24h-tooltip';
        el.style.cssText = `
            position: fixed; top: 10px; left: 10px;
            background: rgba(10,10,26,0.95); border: 1px solid #2962FF;
            border-radius: 6px; padding: 8px 12px; color: #fff;
            font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: bold;
            z-index: 9999; display: none; pointer-events: none;
            box-shadow: 0 4px 15px rgba(41,98,255,0.3);
        `;
        el.innerHTML = `<span style="color:#2962FF;">📦 24H Vol:</span> <span id="vol24h-val">—</span>`;
        document.body.appendChild(el);
        this._tooltipEl = el;
    }

    _bindCrosshair(attempts = 0) {
        const MAX_ATTEMPTS = 20;
        if (attempts >= MAX_ATTEMPTS) return;
        try {
            const pm = this.manager.panelManager;
            const panel = pm.panels.get(this.data.panel);
            if (!panel || !panel.chart) {
                this._crosshairTimer = setTimeout(() => this._bindCrosshair(attempts + 1), 500);
                return;
            }
            panel.chart.subscribeCrosshairMove((param) => this._handleCrosshairMove(param));
        } catch (e) {
            console.error('Volume24H crosshair error:', e);
        }
    }

    _handleCrosshairMove(param) {
        if (!param?.time || !this._tooltipEl || !this._volumeMap) {
            if (this._tooltipEl) this._tooltipEl.style.display = 'none';
            return;
        }
        const vol = this._volumeMap.get(param.time);
        if (vol != null && vol > 0) {
            document.getElementById('vol24h-val').textContent = this._fmt(vol);
            this._tooltipEl.style.display = 'block';
            const pm = this.manager.panelManager;
            const panel = pm.panels.get(this.data.panel);
            if (panel?.wrapper) {
                const rect = panel.wrapper.getBoundingClientRect();
                this._tooltipEl.style.top = (rect.top + 35) + 'px';
                this._tooltipEl.style.left = (rect.left + 10) + 'px';
            }
        } else {
            this._tooltipEl.style.display = 'none';
        }
    }

    _fmt(v) {
        if (!v) return '0 $';
        if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B $';
        if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M $';
        if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K $';
        return v.toFixed(2) + ' $';
    }

    destroy() {
        if (this._updateInterval) clearInterval(this._updateInterval);
        if (this._pendingTimer) clearTimeout(this._pendingTimer);
        if (this._crosshairTimer) clearTimeout(this._crosshairTimer);
        if (this._tooltipEl) {
            this._tooltipEl.remove();
            this._tooltipEl = null;
        }
        super.destroy();
    }
}

window.IndicatorRegistry.set('volume24h', Volume24HIndicator);
class RSI14Indicator extends BaseIndicator {
    static meta = { name: 'RSI 14', category: 'oscillator', panel: 'rsi', color: '#FFA500' };

    constructor(manager) {
        super(manager, 'rsi14', 'RSI 14', '#FFA500', 'rsi');
        this.settings.period = 14;
    }
    
    getWorkerType() { return 'rsi'; }
    getWorkerParams() { return { period: this.settings.period }; }
    
    getSettingsHTML() {
        return `
            ${super.getSettingsHTML()}
            <div class="settings-row">
                <label>Период RSI:</label>
                <input type="number" id="indicatorPeriod" value="${this.settings.period}" min="5" max="50" style="width: 70px;">
            </div>
        `;
    }
    
    applySettingsFromForm() {
        if (document.getElementById('indicatorPeriod')) this.settings.period = parseInt(document.getElementById('indicatorPeriod').value);
        super.applySettingsFromForm();
    }
    
      createSeries() {
        this._removeAllSeries();
        const pm = this.manager.panelManager, pid = this.data.panel;
        this.series = [
            pm.addSeries(pid, `${this.type}-line`, 'line', { color: this.settings.color, lineWidth: this.settings.lineWidth }),
            pm.addSeries(pid, `${this.type}-level30`, 'line', { color: '#808080', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed }),
            pm.addSeries(pid, `${this.type}-level70`, 'line', { color: '#808080', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed })
        ];
        return this.series;
    }
    updateSeriesData(data) {
        if (!data || !data.length) return;
        const chartData = this.manager.chartManager.chartData;
        if (!chartData || chartData.length === 0) return;
        
        const rsiMap = new Map();
        data.forEach(item => rsiMap.set(item.time, item.value));
        
        const rsiData = [];
        chartData.forEach(candle => {
            if (rsiMap.has(candle.time)) rsiData.push({ time: candle.time, value: rsiMap.get(candle.time) });
        });
        
        if (this.series[0]) this.series[0].setData(rsiData);
        if (this.series[1]) this.series[1].setData(chartData.map(c => ({ time: c.time, value: 30 })));
        if (this.series[2]) this.series[2].setData(chartData.map(c => ({ time: c.time, value: 70 })));
    }
}

class SMAIndicator extends BaseIndicator {
    static meta = { name: 'SMA 20', category: 'trend', panel: 'main', color: '#FFD700' };

    constructor(manager, period, name, color) {
        super(manager, `sma${period}`, name, color, 'main');
        this.settings.period = period;
    }
    
    getWorkerType() { return 'sma'; }
    getWorkerParams() { return { period: this.settings.period }; }
    
    getSettingsHTML() {
        return `
            ${super.getSettingsHTML()}
            <div class="settings-row">
                <label>Период SMA:</label>
                <input type="number" id="indicatorPeriod" value="${this.settings.period}" min="1" max="200" style="width: 70px;">
            </div>
        `;
    }
    
    applySettingsFromForm() {
        if (document.getElementById('indicatorPeriod')) this.settings.period = parseInt(document.getElementById('indicatorPeriod').value);
        super.applySettingsFromForm();
    }
    
    _createEmptySeries() {
    this._removeAllSeries();
    this.series = [
        this.manager.chartManager.chart.addSeries(LightweightCharts.LineSeries, { color: this.settings.color, lineWidth: this.settings.lineWidth })
    ];
}
    
    updateSeriesData(data) {
        if (!data || !data.length) return;
        if (this.series[0]) this.series[0].setData(this.manager._filterData(data));
    }
}

// Специальный класс для SMA 50, чтобы Реестр мог отличить его от SMA 20
class SMA50Indicator extends SMAIndicator {
    static meta = { name: 'SMA 50', category: 'trend', panel: 'main', color: '#FF69B4' };
    constructor(manager) {
        super(manager, 50, 'SMA 50', '#FF69B4');
        this.type = 'sma50';
        this.data.type = 'sma50';
    }
}

class StochRSIIndicator extends BaseIndicator {
    static meta = { name: 'Stochastic RSI', category: 'oscillator', panel: 'stoch', color: '#87CEEB' };

    constructor(manager) {
        super(manager, 'stochrsi', 'Stochastic RSI', '#87CEEB', 'stoch');
        this.settings.period = 14; this.settings.k = 3; this.settings.d = 3;
    }
    
    getWorkerType() { return 'stochrsi'; }
    getWorkerParams() { return { period: this.settings.period, k: this.settings.k, d: this.settings.d }; }
    
    getSettingsHTML() {
        return `
            ${super.getSettingsHTML()}
            <div class="settings-row"><label>Период:</label><input type="number" id="indicatorPeriod" value="${this.settings.period}" min="5" max="50" style="width: 70px;"></div>
            <div class="settings-row"><label>%K:</label><input type="number" id="indicatorK" value="${this.settings.k}" min="1" max="10" style="width: 70px;"></div>
            <div class="settings-row"><label>%D:</label><input type="number" id="indicatorD" value="${this.settings.d}" min="1" max="10" style="width: 70px;"></div>
        `;
    }
    
    applySettingsFromForm() {
        if (document.getElementById('indicatorPeriod')) this.settings.period = parseInt(document.getElementById('indicatorPeriod').value);
        if (document.getElementById('indicatorK')) this.settings.k = parseInt(document.getElementById('indicatorK').value);
        if (document.getElementById('indicatorD')) this.settings.d = parseInt(document.getElementById('indicatorD').value);
        super.applySettingsFromForm();
    }
    
    _createEmptySeries() {
        const pm = this.manager.panelManager, pid = this.data.panel;
        this.series.forEach(s => { if (s) pm.removeSeries(pid, s); });
        this.series = [
            pm.addSeries(pid, `${this.type}-k`, 'line', { color: '#87CEEB', lineWidth: this.settings.lineWidth }),
            pm.addSeries(pid, `${this.type}-d`, 'line', { color: '#FFA500', lineWidth: this.settings.lineWidth })
        ];
    }
    
    updateSeriesData(data) {
        if (!data || !data.k || !data.d || !data.times) return;
        const chartData = this.manager.chartManager.chartData;
        if (!chartData || chartData.length === 0) return;
        
        const kMap = new Map(), dMap = new Map();
        for (let i = 0; i < data.times.length; i++) {
            kMap.set(data.times[i], data.k[i]);
            dMap.set(data.times[i], data.d[i]);
        }
        
        const kData = [], dData = [];
        for (let i = 0; i < chartData.length; i++) {
            const time = chartData[i].time;
            kData.push(kMap.has(time) ? { time, value: kMap.get(time) } : { time, value: null });
            dData.push(dMap.has(time) ? { time, value: dMap.get(time) } : { time, value: null });
        }
        
        if (this.series[0]) this.series[0].setData(kData);
        if (this.series[1]) this.series[1].setData(dData);
    }
}

// === РЕГИСТРАЦИЯ В РЕЕСТРЕ (ОБЯЗАТЕЛЬНО ДЛЯ МЕНЮ) ===
function bootIndicators() {
    if (!window.IndicatorRegistry) {
        console.error('❌ IndicatorRegistry не загружен!');
        return;
    }
    window.IndicatorRegistry.set('sma20', SMAIndicator);
    window.IndicatorRegistry.set('sma50', SMA50Indicator);
    window.IndicatorRegistry.set('ema20', EMAIndicator);
    window.IndicatorRegistry.set('rsi14', RSI14Indicator);
    window.IndicatorRegistry.set('stochrsi', StochRSIIndicator);
    window.IndicatorRegistry.set('macd', MACDIndicator);
    window.IndicatorRegistry.set('adx', ADXIndicator);
    window.IndicatorRegistry.set('atr', ATRIndicator);
    window.IndicatorRegistry.set('multiatr', MultiTimeframeATRIndicator);
    window.IndicatorRegistry.set('volume24h', Volume24HIndicator);
   
    console.log('✅ Зарегистрировано индикаторов:', window.IndicatorRegistry.size);
}
bootIndicators();

if (typeof window !== 'undefined') {
    window.SMAIndicator = SMAIndicator;
    window.SMA50Indicator = SMA50Indicator;
    window.EMAIndicator = EMAIndicator;
    window.RSI14Indicator = RSI14Indicator;
    window.MACDIndicator = MACDIndicator;
    window.StochRSIIndicator = StochRSIIndicator;
    window.ADXIndicator = ADXIndicator;
    window.ATRIndicator = ATRIndicator;
    window.MultiTimeframeATRIndicator = MultiTimeframeATRIndicator;
    window.Volume24HIndicator = Volume24HIndicator;
 
}
