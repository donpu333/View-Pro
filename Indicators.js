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

    // [FIX-I4] дефолты для создания из реестра без аргументов
    constructor(manager, period = 20, name = 'EMA 20', color = '#00E5FF') {
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
        this.manager.chartManager.chart.addSeries(LightweightCharts.LineSeries, { color: this.settings.color, lineWidth: this.settings.lineWidth, crosshairMarkerVisible: false })
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

        // [FIX-I1] полная длина: прогрев = whitespace, шкала панели = шкала свечей
        chartData.forEach((candle, index) => {
            const has = macdMap.has(candle.time);
            const macd = has ? macdMap.get(candle.time) : null;
            const signal = has ? signalMap.get(candle.time) : null;
            const hist = has ? histMap.get(candle.time) : null;

            const put = (val) => (val === undefined || val === null || isNaN(val))
                ? { time: candle.time }
                : { time: candle.time, value: val };

            macdData.push(put(macd));
            signalData.push(put(signal));

            if (hist === null || hist === undefined || isNaN(hist)) {
                histData.push({ time: candle.time });
                return;
            }
            // ТОЧНАЯ КОПИЯ ЛОГИКИ TV: 4 цвета в зависимости от текущего и предыдущего значения
            let hColor;
            let prevHist = 0;
            for (let j = index - 1; j >= 0; j--) {
                const pv = histMap.get(chartData[j].time);
                if (pv !== undefined && pv !== null && !isNaN(pv)) { prevHist = pv; break; }
            }
            if (hist >= 0) {
                hColor = hist > prevHist ? '#26a69a' : '#b2dfdb';
            } else {
                hColor = hist > prevHist ? '#ffcdd2' : '#ff5252';
            }
            histData.push({ time: candle.time, value: hist, color: hColor });
        });
        
        // Применяем данные. Порядок важен: [0] = hist, [1] = macd, [2] = signal
        if (this.series[0]) this.series[0].setData(histData);
        if (this.series[1]) this.series[1].setData(macdData);
        if (this.series[2]) this.series[2].setData(signalData);
    }
}
class MultiTimeframeATRIndicator extends BaseIndicator {
    constructor(manager) {
        super(manager, 'multiatr', 'ATR', '#FFA500', 'main');

        const savedSettings = this._loadSettings();

        this.settings = {
            atrPeriod: savedSettings.atrPeriod || 3,
            rangeMode: savedSettings.rangeMode || 'High-Low',
            useFilter: savedSettings.useFilter !== undefined ? savedSettings.useFilter : true,
            filterType: savedSettings.filterType || 'Adaptive',
            devFactor: savedSettings.devFactor || 1.0,
            fixedMult: savedSettings.fixedMult || 1.5,
            monthATRPeriod: savedSettings.monthATRPeriod || 3,   // [ATR-FIX] период для ТФ 1M (месяц)
            weekATRPeriod: savedSettings.weekATRPeriod || 3,
            dayATRPeriod: savedSettings.dayATRPeriod || 3,
            hourATRPeriod: savedSettings.hourATRPeriod || 12,
            hourTF: savedSettings.hourTF || '1',
            minuteTF: savedSettings.minuteTF || '5',
            minuteATRPeriod: savedSettings.minuteATRPeriod || 3,
            minute1TF: savedSettings.minute1TF || '1',
            minute1ATRPeriod: savedSettings.minute1ATRPeriod || 3,

            calcMode: savedSettings.calcMode || 'auto',
            manualBars: savedSettings.manualBars || 20,
            manualTimes: Array.isArray(savedSettings.manualTimes)
                ? savedSettings.manualTimes
                : []
        };

        this.metrics = {
            atr: 0,
            natr: 0,
            progress: 0,
            remaining: 0,
            remainingPoints: 0,
            trueRange: 0,
            rangeRatio: 0,
            isValid: true,
            upperBound: 0,
            lowerBound: 0,
            isAnomaly: false,
            anomalyType: null
        };

        this._lastCandleTime = 0;
        this._lastInterval = null;
        this._isUpdating = false;
        this._updateTimeout = null;
        this._fallbackTimer = null;
        this._currentApiInterval = '1h';
        this._decimals = null;
        this._wasDragged = false;

        this._manualDomMarkers = [];
        this._manualMarkerData = new Map();

        this._manualChart = null;
        this._manualClickHandler = null;
        this._documentMouseDownHandler = null;
        this._crosshairHandler = null;
        this._lastHoverTime = null;

        this._chartContainer = null;
        this._rafId = null;

        this._timeScale = null;
        this._timeScaleHandler = null;
        this._timeScaleUnsubscribe = null;

        this._priceScale = null;
        this._priceScaleHandler = null;
        this._priceScaleUnsubscribe = null;

        this._resizeObserver = null;
        this._resizeContainer = null;

        this._windowScrollHandler = null;

        this._setupEventHandlers();
        this._initWidgetDOM();

        this._startMarkerLoop();

        setTimeout(() => {
            this._setupManualSelection();
            this._rebuildManualMarkers();
            this.updateMetrics();
        }, 500);
    }

    _loadSettings() {
        try {
            const saved = localStorage.getItem('atr_multi_settings');
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

    _loadPosition() {
        try {
            const saved = localStorage.getItem('multiatr_position');
            if (saved) {
                const pos = JSON.parse(saved);
                return { x: pos.x ?? 20, y: pos.y ?? 80 };
            }
        } catch (e) {}
        return { x: 20, y: 80 };
    }

    _savePosition(x, y) {
        try {
            localStorage.setItem('multiatr_position', JSON.stringify({ x, y }));
        } catch (e) {}
    }

    get visible() {
        return this._visible;
    }

    set visible(value) {
        this._visible = value;

        const widget = document.getElementById('multiatr-widget');
        if (widget) widget.style.display = value ? 'flex' : 'none';

        this._saveSettings();

        if (this.manager) this.manager._saveIndicators();
    }

    getWorkerType() {
        return null;
    }

    calculateAsync() {}

    _initWidgetDOM() {
        if (document.getElementById('multiatr-widget')) return;

        const pos = this._loadPosition();

        const wrapper = document.createElement('div');
        wrapper.id = 'multiatr-widget';
        wrapper.style.cssText = `
            position: fixed; top: ${pos.y}px; left: ${pos.x}px;
            background: rgba(5, 5, 15, 0.9); 
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 11px;
            color: #fff; z-index: 10000; padding: 5px 10px;
            display: none; align-items: center; gap: 4px; cursor: pointer;
            backdrop-filter: blur(6px); user-select: none;
        `;

        document.body.appendChild(wrapper);
        this._setupDrag(wrapper, wrapper);

        wrapper.addEventListener('click', (e) => {
            if (this._wasDragged || e.target.id === 'multiatr-close') return;

            if (this.metrics.atr > 0) {
                navigator.clipboard.writeText(this.metrics.atr.toFixed(this._getPriceDecimals()))
                    .then(() => {
                        const val = document.getElementById('matr-val');
                        if (val) {
                            val.style.color = '#22E00F';
                            setTimeout(() => val.style.color = '#FFFFFF', 400);
                        }
                    })
                    .catch(() => {});
            }
        });

        wrapper.addEventListener('contextmenu', (e) => {
            if (this.settings.calcMode === 'manual') {
                e.preventDefault();
                this.clearManualSelection();
            }
        });
    }

    _setupDrag(handle, element) {
        let isDragging = false, startX, startY, initialLeft, initialTop;
        this._wasDragged = false;

        handle.addEventListener('mousedown', (e) => {
            if (e.target.id === 'multiatr-close') return;

            isDragging = true;
            this._wasDragged = false;
            startX = e.clientX;
            startY = e.clientY;

            const rect = element.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            element.style.transition = 'none';
            element.style.right = 'auto';
            element.style.bottom = 'auto';
        });

        this._dragMoveHandler = (e) => {
            if (!isDragging) return;
            e.preventDefault();

            if (Math.abs(e.clientX - startX) > 2 || Math.abs(e.clientY - startY) > 2) {
                this._wasDragged = true;
            }

            element.style.left = `${initialLeft + e.clientX - startX}px`;
            element.style.top = `${initialTop + e.clientY - startY}px`;
        };

        this._dragUpHandler = () => {
            if (isDragging) {
                isDragging = false;
                element.style.transition = '';

                const x = parseInt(element.style.left) || 20;
                const y = parseInt(element.style.top) || 80;
                this._savePosition(x, y);
            }
        };

        document.addEventListener('mousemove', this._dragMoveHandler);
        document.addEventListener('mouseup', this._dragUpHandler);
    }

    _normalizeInterval(interval) {
        if (!interval) return '1h';

        // [ATR-FIX] МЕСЯЦ проверяем ДО toLowerCase(): '1M' (месяц) и '1m'
        // (минута) после приведения к нижнему регистру неразличимы, и месячный
        // график попадал в ветку «1 минута» → период ATR становился
        // calculateCandlesFromHours(3, '1') = 180 МЕСЯЦЕВ, а виджет писал «1M».
        const raw = interval.toString().trim();
        if (raw === '1M' || raw === 'M' || raw.toLowerCase() === 'month') return '1M';

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
        const map = {
            '1m': '1M', '3m': '3M', '5m': '5M', '15m': '15M', '30m': '30M',
            '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6H', '12h': '12H',
            '1d': '1D', '1w': '1W',
            // [ATR-FIX] месяц — '1Mo', иначе и минута, и месяц выводились как «1M»
            '1M': '1Mo'
        };
        return map[apiInterval] || apiInterval.toUpperCase();
    }

    calculateCandlesFromHours(hours, minuteTFStr) {
        return Math.max(Math.floor((hours * 60) / parseInt(minuteTFStr)), 1);
    }

    getActualPeriod(apiInterval) {
        // [ATR-FIX] месяц — отдельная ветка (и ДО минутных, иначе '1M' перехватит
        // ветка minute1TF='1' и период станет 180)
        if (apiInterval === '1M') return this.settings.monthATRPeriod || 3;
        if (apiInterval === '1w') return this.settings.weekATRPeriod || 3;
        if (apiInterval === '1d') return this.settings.dayATRPeriod || 3;

        const hourApiTF = this.settings.hourTF + 'h';
        if (apiInterval === hourApiTF) {
            return this.settings.hourATRPeriod || 12;
        }

        const minuteApiTF = this.settings.minuteTF + 'm';
        if (apiInterval === minuteApiTF) {
            return this.calculateCandlesFromHours(
                this.settings.minuteATRPeriod || 3,
                this.settings.minuteTF
            );
        }

        const minute1ApiTF = this.settings.minute1TF + 'm';
        if (apiInterval === minute1ApiTF) {
            return this.calculateCandlesFromHours(
                this.settings.minute1ATRPeriod || 3,
                this.settings.minute1TF
            );
        }

        return this.settings.atrPeriod || 3;
    }

    computeATRMetrics(data, period, rangeMode, useFilter, filterType, devFactor, fixedMult) {
        if (!data || data.length < period + 1) {
            return this._emptyMetrics();
        }

        const ranges = [];
        for (let i = 0; i < data.length; i++) {
            if (rangeMode === 'True Range' && i > 0) {
                const prevClose = data[i - 1].close;
                ranges.push(
                    Math.max(
                        data[i].high - data[i].low,
                        Math.abs(data[i].high - prevClose),
                        Math.abs(data[i].low - prevClose)
                    )
                );
            } else {
                ranges.push(data[i].high - data[i].low);
            }
        }

        if (ranges.length < period) {
            return this._emptyMetrics();
        }

        const rma = (src, len) => {
            const result = new Array(src.length).fill(0);
            let sum = 0;
            for (let i = 0; i < len; i++) sum += src[i];
            result[len - 1] = sum / len;
            for (let i = len; i < src.length; i++) {
                result[i] = (src[i] + (len - 1) * result[i - 1]) / len;
            }
            return result;
        };

        if (!useFilter) {
            const atrArray = rma(ranges, period);
            const lastIdx = ranges.length - 1;
            const lastCandle = data[lastIdx];
            
            // ✅ БАЗА ATR: ATR предыдущей закрытой свечи (стабильный базис)
            const baselineATR = lastIdx > 0 ? atrArray[lastIdx - 1] : atrArray[lastIdx];
            
            // ✅ ПРОГРЕСС: Полный размах High-Low (как в классическом ATR)
            const dist = lastCandle.high - lastCandle.low;
            const prog = baselineATR > 0 ? (dist / baselineATR) * 100 : 0;

            return {
                atr: baselineATR,
                natr: lastCandle.close > 0 ? (baselineATR / lastCandle.close) * 100 : 0,
                progress: prog,
                // ✅ ОСТАТОК: Может быть отрицательным (свеча пробила ATR)
                remaining: 100 - prog,
                remainingPoints: baselineATR - dist,
                trueRange: ranges[lastIdx],
                rangeRatio: baselineATR > 0 ? (ranges[lastIdx] / baselineATR) * 100 : 0,
                upperBound: 0,
                lowerBound: 0,
                isValid: true,
                isAnomaly: false,
                anomalyType: null
            };
        }

        // --- Ветка с фильтром ---
        const rawRMA = rma(ranges, period);
        const filteredRanges = [...ranges];
        const filteredATR = new Array(ranges.length).fill(0);

        for (let i = 0; i < period; i++) {
            filteredRanges[i] = ranges[i];
            if (i === period - 1) {
                let sum = 0;
                for (let j = 0; j < period; j++) sum += ranges[j];
                filteredATR[i] = sum / period;
            } else if (i > 0) {
                let sum = 0;
                for (let j = 0; j <= i; j++) sum += ranges[j];
                filteredATR[i] = sum / (i + 1);
            } else {
                filteredATR[i] = ranges[i];
            }
        }

        let upperBound = 0;
        let lowerBound = 0;

        for (let i = period; i < ranges.length; i++) {
            const currentRange = ranges[i];
            const prevRawATR = rawRMA[i - 1];

            if (filterType === 'Adaptive') {
                // [ATR-FIX] без ranges.slice() на каждой свече: окно считаем
                // индексами. Порядок суммирования и Math.pow сохранены — результат
                // бит-в-бит тот же, но исчезает N аллокаций массива на пересчёт
                // (пересчёт идёт каждые ~100 мс на тиках, на 12 000 свечей
                // это были десятки тысяч объектов в секунду → давление на GC).
                const wStart = Math.max(0, i - period);
                const wLen = i - wStart;
                let wSum = 0;
                for (let j = wStart; j < i; j++) wSum += ranges[j];
                const mean = wSum / wLen;
                let varSum = 0;
                for (let j = wStart; j < i; j++) varSum += Math.pow(ranges[j] - mean, 2);
                const stdDev = Math.sqrt(varSum / wLen);

                upperBound = Math.min(prevRawATR + stdDev * devFactor, prevRawATR * 3.0);
                lowerBound = Math.max(prevRawATR - stdDev * devFactor, prevRawATR * 0.3);
            } else {
                upperBound = prevRawATR * fixedMult;
                lowerBound = Math.max(prevRawATR / fixedMult, 0);
            }

            filteredRanges[i] = currentRange > upperBound || currentRange < lowerBound ? prevRawATR : currentRange;
            filteredATR[i] = (filteredRanges[i] + (period - 1) * filteredATR[i - 1]) / period;
        }

        const lastIdx = ranges.length - 1;
        const lastCandle = data[lastIdx];
        const lastRange = ranges[lastIdx];
        
        const prevATR = lastIdx > 0 ? filteredATR[lastIdx - 1] : filteredATR[lastIdx];
        const baselineATR = prevATR;

        const isCurrentlyAnomaly = lastRange > upperBound || lastRange < lowerBound;
        
        // ✅ Полный размах High-Low
        const distFromOpen = lastCandle.high - lastCandle.low;
        const progress = baselineATR > 0 ? (distFromOpen / baselineATR) * 100 : 0;

        return {
            atr: baselineATR,
            natr: lastCandle.close > 0 ? (baselineATR / lastCandle.close) * 100 : 0,
            progress,
            // ✅ ОСТАТОК: Может быть отрицательным
            remaining: 100 - progress,
            remainingPoints: baselineATR - distFromOpen,
            trueRange: lastRange,
            rangeRatio: baselineATR > 0 ? (lastRange / baselineATR) * 100 : 0,
            upperBound,
            lowerBound,
            isValid: !isCurrentlyAnomaly,
            isAnomaly: isCurrentlyAnomaly,
            anomalyType: lastRange > upperBound ? 'LARGE' : lastRange < lowerBound ? 'SMALL' : null
        };
    }

    _emptyMetrics(extra = {}) {
        return {
            atr: 0, natr: 0, progress: 0, remaining: 0, remainingPoints: 0,
            trueRange: 0, rangeRatio: 0, isValid: true, upperBound: 0, lowerBound: 0,
            isAnomaly: false, anomalyType: null, ...extra
        };
    }

    computeManualHighLowMetricsFromTimes(fullData, selectedValues) {
        if (!fullData || !fullData.length || !selectedValues || !selectedValues.length) {
            return this._emptyMetrics({ isValid: false });
        }

        const selectedSet = new Set(selectedValues.map((v) => Number(v)));
        const selectedCandles = [];
        const ranges = [];

        for (const candle of fullData) {
            const t = this._getTimeValue(candle.time);
            if (t == null || !selectedSet.has(t)) continue;
            selectedCandles.push(candle);
            ranges.push(candle.high - candle.low);
        }

        if (!selectedCandles.length || !ranges.length) {
            return this._emptyMetrics({ isValid: false });
        }

        const atr = ranges.reduce((sum, v) => sum + v, 0) / ranges.length;
        const last = selectedCandles[selectedCandles.length - 1];
        const lastRange = ranges[ranges.length - 1];

        // [ATR-FIX] «Прогресс» и «Остаток» в ручном режиме считались от последней
        // ВЫБРАННОЙ свечи. Если пользователь выбирал исторические свечи, виджет
        // показывал остаток хода свечи из прошлого (замер: «Ост 77.4%» вместо
        // «−5.8%» по текущей свече). Теперь — как в авто-режиме: ATR берётся из
        // выборки, а прогресс/остаток относятся к ТЕКУЩЕЙ свече графика.
        // Диапазон последней выбранной свечи сохранён в _selectedLastRange.
        const live = fullData[fullData.length - 1];
        const liveRange = (live && isFinite(live.high) && isFinite(live.low))
            ? (live.high - live.low)
            : lastRange;
        const liveClose = (live && isFinite(live.close) && live.close > 0) ? live.close : last.close;
        const progress = atr > 0 ? (liveRange / atr) * 100 : 0;

        return {
            atr,
            natr: liveClose > 0 ? (atr / liveClose) * 100 : 0,
            progress,
            remaining: 100 - progress,
            remainingPoints: atr - liveRange,
            trueRange: liveRange,
            rangeRatio: atr > 0 ? (liveRange / atr) * 100 : 0,
            _selectedLastRange: lastRange,
            upperBound: 0, lowerBound: 0, isValid: true, isAnomaly: false, anomalyType: null,
            _manual: true, _selectedBars: selectedCandles.length
        };
    }

    // [ATR-FIX] Сравнение ВСЕХ полей, которые виджет показывает.
    // БЫЛО: сравнивались только atr / remaining / _actualPeriod.
    // NATR = ATR / close * 100 зависит ещё и от close: когда цена двигалась
    // ВНУТРИ диапазона текущей свечи (high/low не изменились → remaining тот же),
    // NATR менялся, но renderWidget() НЕ вызывался — на экране оставалось
    // устаревшее значение (замер: close 95.8272→95.3312, NATR 1.2697%→1.2763%,
    // перерисовки нет).
    _displayChanged(nw, old) {
        if (!old) return true;
        return nw.atr !== old.atr
            || nw.natr !== old.natr
            || nw.remaining !== old.remaining
            || nw.progress !== old.progress
            || nw._actualPeriod !== old._actualPeriod
            || nw._selectedBars !== old._selectedBars;
    }

    updateMetrics() {
        if (this._updateTimeout) clearTimeout(this._updateTimeout);

        try {
            const chartManager = this.manager?.chartManager;
            const data = chartManager?.chartData;
            if (!data || !data.length) return;

            const rawInterval = chartManager.currentInterval || '60';
            const newApiInterval = this._normalizeInterval(rawInterval);

            if (this._currentApiInterval !== newApiInterval) {
                this._currentApiInterval = newApiInterval;
                this.metrics.atr = 0;
            }

            if (this.settings.calcMode === 'manual') {
                const selectedTimes = this._getManualSelectedTimes(data);
                if (!selectedTimes.length) {
                    this.metrics = this._emptyMetrics({ _manual: true, _actualPeriod: 0, _selectedBars: 0 });
                    this.renderWidget();
                    return;
                }

                const newMetrics = this.computeManualHighLowMetricsFromTimes(data, selectedTimes);
                newMetrics._actualPeriod = newMetrics._selectedBars || selectedTimes.length;

                if (this._displayChanged(newMetrics, this.metrics)) {   // [ATR-FIX] + natr/progress
                    this.metrics = newMetrics;
                    this.renderWidget();
                } else {
                    this.metrics = newMetrics;
                }
                return;
            }

            const actualPeriod = this.getActualPeriod(this._currentApiInterval);
            if (data.length >= actualPeriod + 1) {
                const newMetrics = this.computeATRMetrics(
                    data, actualPeriod, this.settings.rangeMode, this.settings.useFilter,
                    this.settings.filterType, this.settings.devFactor, this.settings.fixedMult
                );
                newMetrics._actualPeriod = actualPeriod;

                if (this._displayChanged(newMetrics, this.metrics)) {   // [ATR-FIX] + natr/progress
                    this.metrics = newMetrics;
                    this.renderWidget();
                } else {
                    this.metrics = newMetrics;
                }
            } else {
                // [ATR-FIX] сбрасываем ВСЕ метрики, а не только atr: иначе виджет
                // показывал «ATR: ...» рядом с устаревшими NATR и «Остаток».
                this.metrics = this._emptyMetrics({ _actualPeriod: actualPeriod });
                this.renderWidget();
            }
        } catch (e) {
            console.error('ATR error:', e);
        }
    }

    _setupEventHandlers() {
        const chartManager = this.manager?.chartManager;
        if (!chartManager) return;

        if (chartManager._subscribeToSymbolChange) {
            chartManager._subscribeToSymbolChange(() => setTimeout(() => this.updateMetrics(), 500));
        }
        if (chartManager.on && typeof chartManager.on === 'function') {
            chartManager.on('dataUpdate', () => this._onChartDataUpdate());
        }
        this._startSmartFallbackTimer();
    }

    _onChartDataUpdate() {
        if (this._updateTimeout) clearTimeout(this._updateTimeout);
        this._updateTimeout = setTimeout(() => { this.updateMetrics(); }, 100);
    }

    _startSmartFallbackTimer() {
        if (this._fallbackTimer) return;
        let lastDataLength = 0;
        let lastClose = 0;

        this._fallbackTimer = setInterval(() => {
            const cm = this.manager?.chartManager;
            if (!cm || !cm.chartData || !cm.chartData.length) return;

            const data = cm.chartData;
            const lastCandle = data[data.length - 1];

            if (data.length !== lastDataLength || lastCandle.close !== lastClose) {
                const lengthChanged = data.length !== lastDataLength;
                lastDataLength = data.length;
                lastClose = lastCandle.close;

                if (!this._documentMouseDownHandler) {
                    this._setupManualSelection();
                } else {
                    this._setupCrosshair();
                    this._setupChartSync();
                }

                this.updateMetrics();
                if (lengthChanged) {
                    this._rebuildManualMarkers();
                } else {
                    this._updateDomMarkersPositions();
                }
            }
        }, 500);
    }

    destroy() {
        this._destroyed = true;   // [PERF-PAN] гасим rAF-цикл маркеров
        if (this._fallbackTimer) { clearInterval(this._fallbackTimer); this._fallbackTimer = null; }
        if (this._updateTimeout) { clearTimeout(this._updateTimeout); this._updateTimeout = null; }
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
        this._stopChartSync();

        if (this._dragMoveHandler) document.removeEventListener('mousemove', this._dragMoveHandler);
        if (this._dragUpHandler) document.removeEventListener('mouseup', this._dragUpHandler);
        if (this._documentMouseDownHandler) {
            document.removeEventListener('mousedown', this._documentMouseDownHandler, true);
            this._documentMouseDownHandler = null;
        }
        if (this._manualChart && this._crosshairHandler) {
            if (typeof this._manualChart.unsubscribeCrosshairMove === 'function') {
                this._manualChart.unsubscribeCrosshairMove(this._crosshairHandler);
            }
            this._crosshairHandler = null;
        }
        if (this._manualChart && this._manualClickHandler) {
            if (typeof this._manualChart.unsubscribeClick === 'function') {
                this._manualChart.unsubscribeClick(this._manualClickHandler);
            }
            this._manualClickHandler = null;
        }

        this._clearDomMarkers();
        this._manualMarkerData.clear();
        const widget = document.getElementById('multiatr-widget');
        if (widget) widget.remove();
        this._removeAllSeries();
        this.manager = null;
    }

    _getPriceDecimals() {
        // [ATR-FIX] сначала — точность ценовой шкалы (кэш ChartManager, тот же
        // знаменатель, что и у оси цен/плашки), и без toString()/split() на
        // каждый вызов. Прежняя эвристика оставлена фолбэком; в ней дополнительно
        // обработана экспоненциальная запись (1e-7 → «0.00» раньше).
        try {
            const cm = this.manager?.chartManager;
            if (cm && typeof cm.getDrawingPrecision === 'function') {
                const p = cm.getDrawingPrecision();
                if (typeof p === 'number' && isFinite(p) && p >= 0) return Math.min(8, Math.floor(p));
            }
            if (cm && typeof cm._getTitlePrecision === 'function') {
                const p = cm._getTitlePrecision();
                if (typeof p === 'number' && isFinite(p) && p >= 0) return Math.min(8, Math.floor(p));
            }
        } catch (e) {}
        try {
            const data = this.manager?.chartManager?.chartData;
            if (data && data.length > 0) {
                const last = data[data.length - 1];
                let maxDecimals = 2;
                const decimalsOf = (price) => {
                    if (!(price > 0)) return 0;
                    const str = price.toString();
                    if (str.includes('e-')) {
                        const parts = str.split('e-');
                        const mant = parts[0].includes('.') ? parts[0].split('.')[1].length : 0;
                        return mant + (parseInt(parts[1], 10) || 0);
                    }
                    return str.includes('.') ? str.split('.')[1].length : 0;
                };
                [last.open, last.high, last.low, last.close].forEach((price) => {
                    const d = decimalsOf(price);
                    if (d > maxDecimals) maxDecimals = d;
                });
                return Math.min(8, maxDecimals);
            }
        } catch (e) {}
        return 2;
    }

    renderWidget() {
        const wrapper = document.getElementById('multiatr-widget');
        if (!wrapper) return;
        if (!this.visible) { wrapper.style.display = 'none'; return; }
        wrapper.style.display = 'flex';

        const m = this.metrics;
        const isManual = this.settings.calcMode === 'manual';
        const displayTF = isManual ? 'MAN' : this._displayInterval(this._currentApiInterval || '1h');
        const decimals = this._getPriceDecimals();

        const manualCount = this.settings.manualTimes && this.settings.manualTimes.length
            ? this.settings.manualTimes.length : this.settings.manualBars || 0;
        const periodDisplay = isManual ? (m._selectedBars ?? manualCount) : (m._actualPeriod || this.getActualPeriod(this._currentApiInterval));

        const formatATR = (v) => {
            if (!v || v === 0) return '...';
            if (v < 0.0001) return v.toPrecision(4);
            return v.toFixed(decimals);
        };

        const formatNATR = (v) => {
            if (v === 0) return '0.00';
            return v.toFixed(2);
        };

        // [ATR-FIX] если ATR неизвестен (мало данных / плоский рынок / нет
        // выбранных свечей в ручном режиме) — NATR и «Остаток» показываем как «—».
        // Раньше выводилось «NATR: 0.00% | Ост: 0.0%» КРАСНЫМ, что читалось как
        // «свеча уже прошла 100% ATR», хотя на самом деле расчёт просто не готов.
        const hasATR = !!(m.atr && m.atr > 0 && isFinite(m.atr) && isFinite(m.natr));
        const natrText = hasATR ? `${formatNATR(m.natr)}%` : '—';
        const remText = hasATR ? `${m.remaining.toFixed(1)}%` : '—';

        // ✅ ЦВЕТА: Фиолетовый для отрицательного остатка (пробой ATR)
        const remColor = !hasATR
            ? '#777777'
            : m.remaining < 0
            ? '#FF00FF'
            : m.remaining < 20
            ? '#FF4444'
            : m.remaining < 50
            ? '#FFA500'
            : '#FFFFFF';

        wrapper.innerHTML = `
            <span style="color:#AAA">${isManual ? '✋' : '⭐'}</span>
            <span style="color:#AAA">${displayTF}(${periodDisplay})</span>
            <span style="color:#444; margin: 0 4px;">|</span>
            <span style="color:#AAA">ATR:</span>
            <span id="matr-val" style="color:#FFFFFF; font-weight:600; transition: color 0.2s;">${formatATR(m.atr)}</span>
            <span style="color:#444; margin: 0 4px;">|</span>
            <span style="color:#AAA" title="Normalized ATR = ATR / цена закрытия × 100">NATR:</span>
            <span style="color:#4FC3F7; font-weight:600;" title="${hasATR ? `ATR ${formatATR(m.atr)} / close × 100` : 'недостаточно данных для расчёта'}">${natrText}</span>
            <span style="color:#444; margin: 0 4px;">|</span>
            <span style="color:#AAA" title="Сколько ATR осталось пройти текущей свече (100% − прогресс). Отрицательный = свеча уже пробила ATR">Ост:</span>
            <span style="color:${remColor}; font-weight:600;" title="${hasATR ? `прогресс свечи: ${m.progress.toFixed(1)}% ATR` : 'недостаточно данных для расчёта'}">${remText}</span>
            <span id="multiatr-close" style="margin-left: 8px; color: #666; cursor: pointer; font-size: 10px;" title="Удалить">✕</span>
        `;

        wrapper.querySelector('#multiatr-close').addEventListener('mousedown', (e) => e.stopPropagation());
        wrapper.querySelector('#multiatr-close').addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.manager) {
                const index = this.manager.activeIndicators?.indexOf(this);
                if (index !== undefined && index !== -1) this.manager.removeIndicator(index);
            }
        });
    }

    getSettingsHTML() {
        return `
            <div style="max-height:400px; overflow-y:auto; padding-right:5px; scrollbar-width: thin; scrollbar-color: #4A4A4A #1E1E1E;">
                <div style="margin-bottom:12px;">
                    <div style="color:#FFA500; margin-bottom:8px;">📊 Основные настройки</div>
                    <div style="margin-bottom:8px; display:flex; align-items:center; gap:10px;">
                        <label style="color:#B0B0B0; width:120px;">Период (дефолт):</label>
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
                    <div style="color:#FFA500; margin-bottom:8px;">🖐 Ручной режим</div>
                    <div style="margin-bottom:8px; display:flex; align-items:center; gap:10px;">
                        <label style="color:#B0B0B0; width:120px;">Расчет:</label>
                        <select id="multiatr_calcMode" onchange="document.getElementById('multiatr_manual_block').style.display=this.value==='manual'?'block':'none'" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px;">
                            <option value="auto" ${this.settings.calcMode === 'auto' ? 'selected' : ''}>Авто</option>
                            <option value="manual" ${this.settings.calcMode === 'manual' ? 'selected' : ''}>Ручной</option>
                        </select>
                    </div>
                    <div id="multiatr_manual_block" style="margin-left:130px; display:${this.settings.calcMode === 'manual' ? 'block' : 'none'};">
                        <div style="margin-bottom:8px; display:flex; align-items:center; gap:10px;">
                            <label style="color:#B0B0B0; width:80px;">Баров:</label>
                            <input type="number" id="multiatr_manualBars" value="${this.settings.manualBars}" min="1" max="1000" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px; width:80px;">
                        </div>
                        <div style="color:#888; font-size:10px; line-height:1.45;">
                            Ручной режим считает только High-Low без фильтра.<br>
                            ЛКМ по свече — выбрать свечу.<br>
                            Клик в пустоту игнорируется.<br>
                            ПКМ по виджету — очистить выбор.
                        </div>
                    </div>
                </div>
                <div style="margin-bottom:12px;">
                    <div style="color:#FFA500; margin-bottom:8px;">📅 Периоды под ТФ</div>
                    <div style="margin-bottom:6px; display:flex; align-items:center; gap:10px;">
                        <label style="color:#B0B0B0; width:70px;" title="Период ATR для месячного таймфрейма (1M)">Mo ATR:</label>
                        <input type="number" id="monthATRPeriod" value="${this.settings.monthATRPeriod}" min="1" max="20" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px; width:60px;">
                    </div>
                    <div style="margin-bottom:6px; display:flex; align-items:center; gap:10px;">
                        <label style="color:#B0B0B0; width:70px;">W ATR:</label>
                        <input type="number" id="weekATRPeriod" value="${this.settings.weekATRPeriod}" min="1" max="20" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px; width:60px;">
                    </div>
                    <div style="margin-bottom:6px; display:flex; align-items:center; gap:10px;">
                        <label style="color:#B0B0B0; width:70px;">D ATR:</label>
                        <input type="number" id="dayATRPeriod" value="${this.settings.dayATRPeriod}" min="1" max="20" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px; width:60px;">
                    </div>
                    <div style="margin-bottom:6px; display:flex; align-items:center; gap:10px;">
                        <label style="color:#B0B0B0; width:70px;">H ATR:</label>
                        <select id="hourTF" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px;">
                            ${['1', '2', '3', '4', '6', '8', '12'].map((v) => `<option value="${v}" ${this.settings.hourTF === v ? 'selected' : ''}>${v}</option>`).join('')}
                        </select>
                        <input type="number" id="hourATRPeriod" value="${this.settings.hourATRPeriod}" min="1" max="100" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px; width:60px;">
                    </div>
                    <div style="margin-bottom:6px; display:flex; align-items:center; gap:10px;">
                        <label style="color:#B0B0B0; width:70px;">M ATR:</label>
                        <select id="minuteTF" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px;">
                            ${['1', '2', '3', '5', '10', '15', '30'].map((v) => `<option value="${v}" ${this.settings.minuteTF === v ? 'selected' : ''}>${v}</option>`).join('')}
                        </select>
                        <input type="number" id="minuteATRPeriod" value="${this.settings.minuteATRPeriod}" min="1" max="24" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px; width:60px;">
                        <span style="color:#888;">ч</span>
                    </div>
                    <div style="margin-bottom:6px; display:flex; align-items:center; gap:10px;">
                        <label style="color:#B0B0B0; width:70px;">1M ATR:</label>
                        <select id="minute1TF" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px;">
                            ${['1', '2', '3', '5', '10', '15', '30'].map((v) => `<option value="${v}" ${this.settings.minute1TF === v ? 'selected' : ''}>${v}</option>`).join('')}
                        </select>
                        <input type="number" id="minute1ATRPeriod" value="${this.settings.minute1ATRPeriod}" min="1" max="24" style="background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px; width:60px;">
                        <span style="color:#888;">ч</span>
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
        this.settings.monthATRPeriod = parseInt(document.getElementById('monthATRPeriod')?.value || 3);   // [ATR-FIX]
        this.settings.weekATRPeriod = parseInt(document.getElementById('weekATRPeriod')?.value || 5);
        this.settings.dayATRPeriod = parseInt(document.getElementById('dayATRPeriod')?.value || 5);
        this.settings.hourTF = document.getElementById('hourTF')?.value || '1';
        this.settings.hourATRPeriod = parseInt(document.getElementById('hourATRPeriod')?.value || 24);
        this.settings.minuteTF = document.getElementById('minuteTF')?.value || '5';
        this.settings.minuteATRPeriod = parseInt(document.getElementById('minuteATRPeriod')?.value || 3);
        this.settings.minute1TF = document.getElementById('minute1TF')?.value || '1';
        this.settings.minute1ATRPeriod = parseInt(document.getElementById('minute1ATRPeriod')?.value || 1);
        this.settings.calcMode = document.getElementById('multiatr_calcMode')?.value || 'auto';
        this.settings.manualBars = Math.max(1, parseInt(document.getElementById('multiatr_manualBars')?.value || 20));

        this._saveSettings();
        this._rebuildManualMarkers();
        this.updateMetrics();
        super.applySettingsFromForm();
    }

    _createEmptySeries() { this._removeAllSeries(); }

    updateSeriesData(data) {
        if (data && data.length) {
            const lastTime = data[data.length - 1].time;
            if (lastTime !== this._lastCandleTime) {
                this._lastCandleTime = lastTime;
                this.updateMetrics();
            }
        }
    }

    _getChart() {
        const cm = this.manager?.chartManager;
        return cm?._chart || cm?.chart || cm?.chartWidget?._chart || cm?._chartWidget?._chart || null;
    }

    _getTimeValue(t) {
        if (typeof t === 'number') return t;
        if (t && typeof t === 'object') {
            if (t.year !== undefined && t.month !== undefined && t.day !== undefined) return Date.UTC(t.year, t.month - 1, t.day);
            if (t.timestamp !== undefined) return t.timestamp;
        }
        const ts = new Date(t).getTime();
        return Number.isNaN(ts) ? null : ts;
    }

    _findCandleByValue(value) {
        // [PERF-PAN] БЫЛО: data.find(...) — ЛИНЕЙНЫЙ скан всего chartData
        // (до 12 000 свечей на 1m) с вызовом _getTimeValue() на каждую свечю.
        // Метод зовётся из _calcChartClientPosition() для КАЖДОГО DOM-маркера
        // на КАЖДОМ кадре — один из главных источников «тормозов» при листании.
        // СТАЛО: точное попадание по _candleTimeMap, иначе бинарный поиск.
        const cm = this.manager?.chartManager;
        const data = cm?.chartData || [];
        if (!data.length) return null;
        const num = Number(value);
        if (!isFinite(num)) return null;

        const idx = cm._candleTimeMap ? cm._candleTimeMap.get(num) : undefined;
        if (idx !== undefined && data[idx]) return data[idx];

        if (typeof cm.findNearestCandle === 'function') {
            const c = cm.findNearestCandle(num);
            if (c) return c;
        }
        let lo = 0, hi = data.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const t = this._getTimeValue(data[mid].time);
            if (t === num) return data[mid];
            if (t < num) lo = mid + 1; else hi = mid - 1;
        }
        const il = Math.max(0, hi), ir = Math.min(data.length - 1, lo);
        const tl = this._getTimeValue(data[il].time), tr = this._getTimeValue(data[ir].time);
        return (Math.abs(tl - num) <= Math.abs(tr - num)) ? data[il] : data[ir];
    }

    // [PERF-PAN] Кэш getBoundingClientRect(): чтение геометрии ПОСЛЕ записи
    // стилей (а маркеры пишут left/top каждый кадр) заставляет браузер
    // выполнять принудительный layout — до десятков мс на кадр.
    _getChartRectCached(ttl = 120) {
        const container = this._getChartContainer();
        if (!container) return null;
        const now = performance.now();
        const c = this._chartRectCache;
        if (c && c.el === container && now - c.at < ttl) return c.rect;
        const rect = container.getBoundingClientRect();
        this._chartRectCache = { el: container, rect, at: now };
        return rect;
    }

    _invalidateChartRectCache() { this._chartRectCache = null; }

    _getAllSeries() {
        const chart = this._getChart();
        const all = [];
        try {
            if (chart) {
                const list = typeof chart.series === 'function' ? chart.series() : chart.series;
                if (list) all.push(...Array.from(list));
            }
        } catch (e) {}
        const cm = this.manager?.chartManager;
        const directCandidates = [cm?._series, cm?.series, cm?.mainSeries, cm?.candleSeries, cm?._mainSeries, cm?._candleSeries, cm?._candlestickSeries].flat().filter(Boolean);
        all.unshift(...directCandidates);
        return all;
    }

    _getMainSeries() {
        const all = this._getAllSeries();
        const getSeriesType = (s) => {
            if (!s) return null;
            if (typeof s.seriesType === 'function') return s.seriesType();
            return s.seriesType || null;
        };
        return all.find((s) => ['Candlestick', 'Bar', 'Candles'].includes(getSeriesType(s))) || null;
    }

    _getPriceSeries() {
        const main = this._getMainSeries();
        if (main && typeof main.priceToCoordinate === 'function') return main;
        const all = this._getAllSeries();
        return all.find((s) => typeof s?.priceToCoordinate === 'function') || null;
    }

    _getChartContainer(sourceEvent = null) {
        if (this._chartContainer && document.body.contains(this._chartContainer)) return this._chartContainer;
        if (sourceEvent && sourceEvent.target instanceof HTMLCanvasElement) {
            const parent = sourceEvent.target.parentElement;
            if (parent instanceof HTMLElement) { this._chartContainer = parent; return parent; }
        }
        const chart = this._getChart();
        const candidates = [chart?._chartWidget?._element, chart?._chartWidget?._container, chart?._chartWidget?._paneWidgets?.[0]?._paneCell?.parentElement, this.manager?.chartManager?._chartContainer, this.manager?.chartManager?.chartContainer, this.manager?.chartManager?._chartEl, this.manager?.chartManager?.chartEl];
        for (const c of candidates) { if (c instanceof HTMLElement) { this._chartContainer = c; return c; } }
        if (sourceEvent && sourceEvent.target) {
            const target = sourceEvent.target;
            if (target.closest) {
                const el = target.closest('.tv-lightweight-charts') || target.closest('div');
                if (el) { this._chartContainer = el; return el; }
            }
            if (target.parentElement) { this._chartContainer = target.parentElement; return target.parentElement; }
        }
        return document.querySelector('.tv-lightweight-charts') || document.body;
    }

    _getManualSelectedTimes(data) {
        if (!Array.isArray(data) || !data.length) return [];
        if (this.settings.manualTimes && this.settings.manualTimes.length) {
            const selectedSet = new Set(this.settings.manualTimes.map((v) => Number(v)));
            const result = [];
            for (const candle of data) {
                const t = this._getTimeValue(candle.time);
                if (t != null && selectedSet.has(t)) result.push(t);
            }
            return result;
        }
        const bars = Math.max(1, parseInt(this.settings.manualBars) || 1);
        return data.slice(-bars).map((c) => this._getTimeValue(c.time)).filter((v) => v != null);
    }

    _setupCrosshair() {
        const chart = this._getChart();
        if (!chart || this._crosshairHandler) return;
        if (typeof chart.subscribeCrosshairMove !== 'function') return;
        this._manualChart = chart;
        this._crosshairHandler = (param) => {
            if (param && param.time != null) this._lastHoverTime = this._getTimeValue(param.time);
            else this._lastHoverTime = null;
        };
        chart.subscribeCrosshairMove(this._crosshairHandler);
    }

    _setupManualSelection() {
        if (this._documentMouseDownHandler) return;
        this._setupCrosshair();
        this._setupChartSync();

        this._documentMouseDownHandler = (e) => {
            if (this.settings.calcMode !== 'manual' || e.button !== 0) return;
            const target = e.target;
            if (target && target.closest && target.closest('#multiatr-widget')) return;

            const container = this._getChartContainer(e);
            if (container) { this._chartContainer = container; this._setupChartSync(); }

            const isChartTarget = target instanceof HTMLCanvasElement || (target && target.closest && target.closest('.tv-lightweight-charts')) || (container && container !== document.body && container.contains(target));
            if (!isChartTarget) return;

            const clientX = e.clientX;
            const clientY = e.clientY;
            if (clientX == null || clientY == null) return;

            const localPoint = this._getChartLocalPoint(clientX, clientY, e);
            if (!localPoint) return;

            let timeValue = this._lastHoverTime;
            if (timeValue == null) timeValue = this._getTimeAtLocalX(localPoint.localX, e);
            if (timeValue == null) return;
            if (!this._isClickOnCandle(localPoint.localX, localPoint.localY, timeValue)) return;

            const lp = this._getLogicalPriceAtClient(clientX, clientY, e);
            this._toggleManualTime(timeValue, { clientX, clientY, logical: lp.logical, price: lp.price });
        };
        document.addEventListener('mousedown', this._documentMouseDownHandler, true);
    }

    _getChartLocalPoint(clientX, clientY, sourceEvent = null) {
        try {
            const container = this._getChartContainer(sourceEvent);
            if (!container) return null;
            const rect = container.getBoundingClientRect();
            return { localX: clientX - rect.left, localY: clientY - rect.top };
        } catch (e) { return null; }
    }

    _getTimeAtLocalX(localX, sourceEvent = null) {
        try {
            const chart = this._getChart();
            if (!chart) return null;
            const timeScale = typeof chart.timeScale === 'function' ? chart.timeScale() : null;
            if (!timeScale) return null;

            let rawTime = null;
            if (typeof timeScale.coordinateToTime === 'function') rawTime = timeScale.coordinateToTime(localX);
            else if (typeof timeScale.coordinateToLogical === 'function') rawTime = timeScale.coordinateToLogical(localX);

            const clickedTime = this._getTimeValue(rawTime);
            if (clickedTime == null) return null;

            const data = this.manager?.chartManager?.chartData || [];
            if (!data.length) return null;

            const exact = data.find((c) => this._getTimeValue(c.time) === clickedTime);
            if (exact) return clickedTime;

            let best = null;
            let bestDist = Infinity;
            if (typeof timeScale.timeToCoordinate === 'function') {
                for (const candle of data) {
                    const t = this._getTimeValue(candle.time);
                    if (t == null) continue;
                    const coord = timeScale.timeToCoordinate(candle.time);
                    if (coord == null) continue;
                    const dist = Math.abs(coord - localX);
                    if (dist < bestDist) { bestDist = dist; best = t; }
                }
            }
            if (best == null) return null;

            let maxDist = 20;
            try {
                const opts = typeof timeScale.options === 'function' ? timeScale.options() : timeScale.options;
                if (opts && typeof opts.barSpacing === 'number') maxDist = opts.barSpacing / 2;
            } catch (e) {}
            maxDist = Math.max(5, maxDist);

            if (bestDist <= maxDist) return best;
            return null;
        } catch (e) { return null; }
    }

    _isClickOnCandle(localX, localY, timeValue) {
        const chart = this._getChart();
        if (!chart) return false;
        const timeScale = typeof chart.timeScale === 'function' ? chart.timeScale() : null;
        const series = this._getPriceSeries();
        const candle = this._findCandleByValue(timeValue);
        if (!candle) return false;

        let xOk = false;
        if (timeScale && typeof timeScale.timeToCoordinate === 'function') {
            const candleX = timeScale.timeToCoordinate(candle.time);
            if (candleX == null) return false;
            let maxDist = 20;
            try {
                const opts = typeof timeScale.options === 'function' ? timeScale.options() : timeScale.options;
                if (opts && typeof opts.barSpacing === 'number') maxDist = opts.barSpacing / 2;
            } catch (e) {}
            maxDist = Math.max(5, maxDist);
            xOk = Math.abs(localX - candleX) <= maxDist;
        } else { xOk = true; }

        let yOk = false;
        if (series && typeof series.priceToCoordinate === 'function') {
            const yHigh = series.priceToCoordinate(candle.high);
            const yLow = series.priceToCoordinate(candle.low);
            if (yHigh == null || yLow == null) return false;
            const top = Math.min(yHigh, yLow) - 5;
            const bottom = Math.max(yHigh, yLow) + 5;
            yOk = localY >= top && localY <= bottom;
        } else { return false; }

        return xOk && yOk;
    }

    _getLogicalPriceAtClient(clientX, clientY, sourceEvent = null) {
        try {
            const chart = this._getChart();
            const container = this._getChartContainer(sourceEvent);
            if (!chart || !container) return { logical: null, price: null };
            const rect = container.getBoundingClientRect();
            const localX = clientX - rect.left;
            const localY = clientY - rect.top;
            const timeScale = typeof chart.timeScale === 'function' ? chart.timeScale() : null;
            const series = this._getPriceSeries();

            let logical = null;
            let price = null;
            if (localX != null && timeScale && typeof timeScale.coordinateToLogical === 'function') logical = timeScale.coordinateToLogical(localX);
            if (localY != null && series && typeof series.coordinateToPrice === 'function') price = series.coordinateToPrice(localY);

            return { logical, price };
        } catch (e) { return { logical: null, price: null }; }
    }

    _toggleManualTime(value, clickInfo = null) {
        const num = Number(value);
        let times = Array.isArray(this.settings.manualTimes) ? [...this.settings.manualTimes] : [];
        const idx = times.findIndex((t) => Number(t) === num);

        if (idx === -1) {
            times.push(num);
            if (clickInfo) {
                const candle = this._findCandleByValue(num);
                const price = clickInfo.price ?? candle?.high ?? candle?.close ?? null;
                this._manualMarkerData.set(num, {
                    clientX: clickInfo.clientX ?? null, clientY: clickInfo.clientY ?? null,
                    logical: clickInfo.logical ?? null, price,
                    lastClientX: clickInfo.clientX ?? null, lastClientY: clickInfo.clientY ?? null
                });
            }
        } else {
            times.splice(idx, 1);
            this._manualMarkerData.delete(num);
        }
        times.sort((a, b) => Number(a) - Number(b));
        this.settings.manualTimes = times;
        this._saveSettings();
        this._rebuildManualMarkers();
        this.updateMetrics();
    }

    clearManualSelection() {
        this.settings.manualTimes = [];
        this._manualMarkerData.clear();
        this._saveSettings();
        this._rebuildManualMarkers();
        this.updateMetrics();
    }

    _clearDomMarkers() {
        if (!Array.isArray(this._manualDomMarkers)) return;
        for (const m of this._manualDomMarkers) {
            if (m && m.element && m.element.remove) m.element.remove();
        }
        this._manualDomMarkers = [];
        // [PERF-PAN] маркеров нет — rAF-цикл не нужен
        if (typeof this._stopMarkerLoop === 'function') this._stopMarkerLoop();
    }

    _rebuildManualMarkers() {
        this._clearDomMarkers();
        if (this.settings.calcMode !== 'manual' || !this.settings.manualTimes || !this.settings.manualTimes.length) return;

        for (const t of this.settings.manualTimes) {
            const timeValue = Number(t);
            const info = this._manualMarkerData.get(timeValue) || null;
            let client = null;

            if (info && info.clientX != null && info.clientY != null) client = { x: info.clientX, y: info.clientY };
            if (!client && info && info.lastClientX != null && info.lastClientY != null) client = { x: info.lastClientX, y: info.lastClientY };
            if (!client) client = this._calcChartClientPosition(timeValue, info?.price ?? null, info?.logical ?? null);
            if (!client) client = { x: -9999, y: -9999 };

            const element = document.createElement('div');
            element.style.cssText = `
                position: fixed; left: ${client.x}px; top: ${client.y}px; width: 8px; height: 8px;
                border-radius: 50%; background: #FFA500; border: 1px solid rgba(0,0,0,0.85);
                box-shadow: 0 0 4px rgba(0,0,0,0.75); transform: translate(-50%, -50%);
                pointer-events: none; z-index: 999999; display: ${client.x < -9000 ? 'none' : 'block'};
            `;
            document.body.appendChild(element);
            this._manualDomMarkers.push({ element, timeValue, fixedX: client.x, fixedY: client.y, logical: info?.logical ?? null, price: info?.price ?? null });
            // [PERF-PAN] цикл запускается ТОЛЬКО когда маркеры реально есть
            this._startMarkerLoop();
        }
    }

    _calcChartClientPosition(timeValue, price = null, logical = null) {
        try {
            const chart = this._getChart();
            const container = this._getChartContainer();
            if (!chart || !container) return null;
            // [PERF-PAN] кэш геометрии контейнера (см. _getChartRectCached)
            const rect = this._getChartRectCached();
            if (!rect) return null;
            const timeScale = typeof chart.timeScale === 'function' ? chart.timeScale() : null;
            const series = this._getPriceSeries();

            let xLocal = null;
            let yLocal = null;

            if (logical != null && timeScale && typeof timeScale.logicalToCoordinate === 'function') xLocal = timeScale.logicalToCoordinate(logical);
            if (xLocal == null && timeValue != null) {
                const candle = this._findCandleByValue(timeValue);
                if (candle && timeScale && typeof timeScale.timeToCoordinate === 'function') xLocal = timeScale.timeToCoordinate(candle.time);
            }

            const candle = this._findCandleByValue(timeValue);
            const targetPrice = price ?? candle?.high ?? candle?.close ?? null;
            if (targetPrice != null && series && typeof series.priceToCoordinate === 'function') yLocal = series.priceToCoordinate(targetPrice);

            if (xLocal == null || yLocal == null) return null;
            return { x: rect.left + xLocal, y: rect.top + yLocal };
        } catch (e) { return null; }
    }

    _updateDomMarkersPositions() {
        if (!this._manualDomMarkers || !this._manualDomMarkers.length) return;
        for (const marker of this._manualDomMarkers) {
            let client = null;
            if (marker.timeValue != null || marker.logical != null || marker.price != null) {
                client = this._calcChartClientPosition(marker.timeValue, marker.price, marker.logical);
            }
            if (!client && marker.fixedX != null && marker.fixedY != null) client = { x: marker.fixedX, y: marker.fixedY };

            if (client) {
                const hidden = (client.x < -9000 || client.y < -9000);
                // [PERF-PAN] запись left/top = инвалидация layout на ВСЁ дерево.
                // Пишем только если координата реально изменилась (на 0.5px).
                const st = marker.element.style;
                const moved = marker._lastX === undefined ||
                    Math.abs(marker._lastX - client.x) > 0.5 ||
                    Math.abs(marker._lastY - client.y) > 0.5 ||
                    marker._lastHidden !== hidden;
                if (moved) {
                    if (hidden) {
                        st.display = 'none';
                    } else {
                        if (st.display !== 'block') st.display = 'block';
                        st.left = `${client.x}px`;
                        st.top = `${client.y}px`;
                    }
                    marker._lastX = client.x; marker._lastY = client.y; marker._lastHidden = hidden;
                }
                marker.fixedX = client.x;
                marker.fixedY = client.y;
                if (marker.timeValue != null) {
                    const info = this._manualMarkerData.get(marker.timeValue);
                    if (info) { info.lastClientX = client.x; info.lastClientY = client.y; }
                }
            }
        }
    }

    _startMarkerLoop() {
        // [PERF-PAN] БЫЛО: бесконечный requestAnimationFrame-цикл, который
        // крутился ВСЕГДА (даже без маркеров) и каждый кадр дёргал
        // _updateDomMarkersPositions() -> getBoundingClientRect() (принудительный
        // layout) + поиск свечи по каждому маркеру + запись стилей.
        // Этот цикл конкурировал за главный поток с рендером lightweight-charts
        // именно в момент перетаскивания графика.
        // СТАЛО: цикл живёт только пока есть DOM-маркеры, и сам останавливается.
        if (this._rafId) return;
        if (!this._manualDomMarkers || this._manualDomMarkers.length === 0) return;
        const loop = () => {
            this._rafId = null;
            if (this._destroyed) return;
            if (!this._manualDomMarkers || this._manualDomMarkers.length === 0) return; // стоп
            this._updateDomMarkersPositions();
            this._rafId = requestAnimationFrame(loop);
        };
        this._rafId = requestAnimationFrame(loop);
    }

    // [PERF-PAN] останавливаем цикл, когда маркеров не осталось
    _stopMarkerLoop() {
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    }

    _setupChartSync() {
        // [PERF-PAN] два разных колбэка:
        //  • update — на изменение видимого диапазона/цены. Геометрия контейнера
        //    при листании графика НЕ меняется, поэтому кэш rect НЕ сбрасываем
        //    (иначе каждый кадр получали бы принудительный layout).
        //  • updateGeom — на resize/scroll: здесь кэш сбрасываем.
        const update = () => {
            if (!this._manualDomMarkers || this._manualDomMarkers.length === 0) return;
            this._updateDomMarkersPositions();
        };
        const updateGeom = () => {
            this._invalidateChartRectCache();
            update();
        };
        if (!this._timeScaleHandler) {
            const chart = this._getChart();
            const timeScale = chart && typeof chart.timeScale === 'function' ? chart.timeScale() : null;
            if (timeScale) {
                if (typeof timeScale.subscribeVisibleLogicalRangeChange === 'function') {
                    timeScale.subscribeVisibleLogicalRangeChange(update);
                    this._timeScale = timeScale; this._timeScaleHandler = update; this._timeScaleUnsubscribe = 'unsubscribeVisibleLogicalRangeChange';
                } else if (typeof timeScale.subscribeVisibleTimeRangeChange === 'function') {
                    timeScale.subscribeVisibleTimeRangeChange(update);
                    this._timeScale = timeScale; this._timeScaleHandler = update; this._timeScaleUnsubscribe = 'unsubscribeVisibleTimeRangeChange';
                }
            }
        }
        if (!this._priceScaleHandler) {
            const series = this._getPriceSeries();
            const priceScale = series && typeof series.priceScale === 'function' ? series.priceScale() : null;
            if (priceScale && typeof priceScale.subscribeVisibleLogicalRangeChange === 'function') {
                priceScale.subscribeVisibleLogicalRangeChange(update);
                this._priceScale = priceScale; this._priceScaleHandler = update; this._priceScaleUnsubscribe = 'unsubscribeVisibleLogicalRangeChange';
            }
        }
        if (!this._resizeObserver && typeof ResizeObserver !== 'undefined') {
            const container = this._getChartContainer();
            if (container && container !== document.body) {
                this._resizeObserver = new ResizeObserver(updateGeom);
                this._resizeContainer = container;
                this._resizeObserver.observe(container);
            }
        }
        if (!this._windowScrollHandler) {
            this._windowScrollHandler = updateGeom;
            window.addEventListener('scroll', updateGeom, true);
            window.addEventListener('resize', updateGeom);
        }
    }

    _stopChartSync() {
        if (this._timeScale && this._timeScaleHandler && this._timeScaleUnsubscribe && typeof this._timeScale[this._timeScaleUnsubscribe] === 'function') {
            try { this._timeScale[this._timeScaleUnsubscribe](this._timeScaleHandler); } catch (e) {}
        }
        this._timeScale = null; this._timeScaleHandler = null; this._timeScaleUnsubscribe = null;

        if (this._priceScale && this._priceScaleHandler && this._priceScaleUnsubscribe && typeof this._priceScale[this._priceScaleUnsubscribe] === 'function') {
            try { this._priceScale[this._priceScaleUnsubscribe](this._priceScaleHandler); } catch (e) {}
        }
        this._priceScale = null; this._priceScaleHandler = null; this._priceScaleUnsubscribe = null;

        if (this._resizeObserver) {
            try { this._resizeObserver.disconnect(); } catch (e) {}
            this._resizeObserver = null; this._resizeContainer = null;
        }
        if (this._windowScrollHandler) {
            window.removeEventListener('scroll', this._windowScrollHandler, true);
            window.removeEventListener('resize', this._windowScrollHandler);
            this._windowScrollHandler = null;
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

        // [FIX-I1] полная длина: прогрев = whitespace, шкала панели = шкала свечей
        const rsiData = chartData.map(candle => {
            const v = rsiMap.get(candle.time);
            return (v === undefined || v === null || isNaN(v))
                ? { time: candle.time }
                : { time: candle.time, value: v };
        });
        
        if (this.series[0]) this.series[0].setData(rsiData);
        if (this.series[1]) this.series[1].setData(chartData.map(c => ({ time: c.time, value: 30 })));
        if (this.series[2]) this.series[2].setData(chartData.map(c => ({ time: c.time, value: 70 })));
    }
}

class SMAIndicator extends BaseIndicator {
    static meta = { name: 'SMA 20', category: 'trend', panel: 'main', color: '#FFD700' };

    // [FIX-I4] дефолты: реестр создаёт класс через new Class(manager),
    // без них period=undefined и серия пустая (type 'smaundefined').
    constructor(manager, period = 20, name = 'SMA 20', color = '#FFD700') {
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
        this.manager.chartManager.chart.addSeries(LightweightCharts.LineSeries, { color: this.settings.color, lineWidth: this.settings.lineWidth, crosshairMarkerVisible: false })
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
        if (!data || !data.length) return;
        const chartData = this.manager.chartManager.chartData;
        if (!chartData || chartData.length === 0) return;

        const kMap = new Map(), dMap = new Map();
        data.forEach(item => { kMap.set(item.time, item.k); dMap.set(item.time, item.d); });

        const put = (time, v) => (v === undefined || v === null || isNaN(v))
            ? { time } : { time, value: v };
        const kData = chartData.map(c => put(c.time, kMap.get(c.time)));
        const dData = chartData.map(c => put(c.time, dMap.get(c.time)));

        if (this.series[0]) this.series[0].setData(kData);
        if (this.series[1]) this.series[1].setData(dData);
    }
}

// =============================================================================
// Volume Profile / Fixed Range — индикатор VolumeProfileIndicator
//
// Порт идеи Pine-скрипта «Volume Profile / Fixed Range» (© LonesomeTheBlue,
// лицензия Mozilla Public License 2.0, https://mozilla.org/MPL/2.0/)
// на архитектуру проекта: BaseIndicator + lightweight-charts primitive.
// Реализация самостоятельная (JS), не дословный перевод исходника.
//
// Что делает:
//   • берёт последние N свечей (fixed range) и разбивает их ценовой диапазон
//     на R горизонтальных рядов;
//   • распределяет объём каждой свечи по рядам: тело получает вес 1, каждая тень
//     вес 2 (как в оригинале — denom = 2*topWick + 2*botWick + body), объём тени
//     делится пополам между «ап» и «даун» частями, объём тела уходит целиком
//     в «ап» на растущей свече и в «даун» на падающей;
//   • находит POC (ряд с максимальным суммарным объёмом) и Value Area
//     (расширение от POC вверх/вниз, пока не набрано X% объёма);
//   • рисует горизонтальную гистограмму в основной панели + линию и метку POC.
//
//
// Класс объявлен прямо в Indicators.js (как остальные индикаторы проекта) и
// регистрируется в bootIndicators() + экспортируется в window — отдельные
// <script> и саморегистрация не нужны.
// =============================================================================

class VolumeProfileIndicator extends BaseIndicator {
    // ключ localStorage и дефолты держим в static-полях класса:
    // Indicators.js — обычный скрипт, и top-level const попал бы в глобальную
    // область с риском конфликта имён с другими индикаторами.
    static STORAGE_KEY = 'volumeprofile_settings';
    static DEFAULTS = {
        // [AUTO] barsMode: 'auto' — число баров подбирается под таймфрейм так,
        // чтобы профиль всегда покрывал autoDays суток. Это главный дефолт:
        // фиксированное bbars не может быть правильным для всех ТФ сразу
        // (150 баров на 1m = 2.5 часа, на 1d = 5 месяцев).
        barsMode: 'auto',    // 'auto' | 'fixed'
        autoDays: 7,         // сколько суток покрывает профиль в режиме auto (0.5..90)
        bbars: 168,          // Number of Bars — используется только в режиме 'fixed' (1..5000)
        cnum: 48,            // Row Size (5..100) — 48 как рабочий вариант для интрадея
        percent: 70,         // Value Area Volume % (0..100) — стандарт Market Profile

        pocColor: '#FF0000', // POC Color
        pocWidth: 2,         // POC Width (1..5)
        showPoc: true,       // Show POC Label

        vaUpColor: '#2196F3',   // Value Area Up
        vaDownColor: '#FF9800', // Value Area Down
        vaAlpha: 0.70,

        upColor: '#2196F3',     // UP Volume
        downColor: '#FF9800',   // Down Volume
        bodyAlpha: 0.25,

        // --- добавлено при портировании (в оригинале зашито константами) ---
        widthDivisor: 3,     // максимальная длина ряда = bbars / widthDivisor свечей
        gapDivisor: 500,     // зазор между рядами = (top - bot) / gapDivisor
        showVaLines: true,   // линии и метки VAH / VAL — полезны как уровни
        vaLineColor: '#FFFFFF',
        extendPocRight: true, // продлевать линию POC вправо до края панели
        // Куда растёт гистограмма. true — от ПОСЛЕДНЕЙ свечи влево: профиль всегда
        // прижат к правому краю, к текущей цене, и виден при любом зуме.
        // false — от ПЕРВОЙ свечи диапазона вправо (поведение оригинального скрипта):
        // на длинном диапазоне при приближении левый край уходит за экран.
        anchorRight: true
    };

    // Секунды в баре — та же карта, что INTERVAL_SECONDS_MAP в ChartManager.js.
    // Держим свою копию: та объявлена top-level const в чужом файле, и полагаться
    // на её доступность из другого скрипта ненадёжно.
    static INTERVAL_SECONDS = {
        '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
        '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200,
        '1d': 86400, '1w': 604800, '1M': 2592000
    };

    // meta обязателен: IndicatorFactory.getIndicatorsList() строит меню по нему
    static meta = { name: 'Volume Profile', category: 'volatility', panel: 'main', color: '#2196F3' };

    constructor(manager) {
        super(manager, 'volumeprofile', 'Volume Profile', '#2196F3', 'main');

        // BaseIndicator.constructor уже записал this.settings = {color, lineWidth}
        // и вызвал this.visible = true — setter ниже это переживает (см. guard).
        const saved = this._loadSettings();
        this.settings = Object.assign({}, this.constructor.DEFAULTS, this.settings, saved);
        this.settings.color = this.settings.color || this.constructor.DEFAULTS.upColor;
        // сохранённое в localStorage могло быть записано старой версией или
        // повреждено — нормализуем до первого использования
        this._sanitizeSettings();

        this._profile = null;          // кэш рассчитанного профиля
        this._settingsSig = '';        // сигнатура настроек (для автпересчёта)
        this._primitive = null;
        this._attachedSeries = null;
        this._requestUpdate = null;
        this._attachTimeout = null;
        this._recomputeTimeout = null;
        this._fallbackTimer = null;
        this._lastDataLen = -1;
        this._lastBarSig = '';
        this._colorCache = new Map();
        this._destroyed = false;
        this._initialized = true;

        this.metrics = {
            poc: null, vah: null, val: null,
            pocRow: -1, vaHighRow: -1, vaLowRow: -1,
            totalVolume: 0, vaVolume: 0, vaPercentActual: 0,
            rangeHigh: null, rangeLow: null, rows: 0, bars: 0,
            isValid: false
        };

        this._setupListeners();
        this._attach();

        // диагностика: в консоли браузера выполнить  __vpDebug()
        try {
            if (typeof window !== 'undefined') window.__vpDebug = () => this._debugDump();
        } catch (e) {}

        // первичный расчёт: данные могут ещё не быть загружены
        setTimeout(() => { this.recompute(); }, 600);
    }

    /* ------------------------- видимость ------------------------- */

    get visible() { return this._visible !== false; }

    set visible(value) {
        this._visible = !!value;
        // guard: сеттер вызывается из конструктора BaseIndicator,
        // когда _primitive ещё не существует
        if (this._initialized && this._primitive && this._primitive.requestRedraw) {
            try { this._primitive.requestRedraw(); } catch (e) {}
        }
    }

    /* ------------------------- интеграция ------------------------- */

    // Worker не используется: расчёт лёгкий и синхронный, рисуем примитивом.
    getWorkerType() { return null; }
    calculateAsync() {}
    onCalculateResult() {}

    /**
     * Приводит settings к допустимым значениям. Нужно потому, что updateSettings()
     * могут вызвать программно с чем угодно, и это значение потом уедет в
     * localStorage. computeProfile() клампит на входе, поэтому расчёт всегда
     * безопасен, но храниться должен уже нормализованный объект.
     */
    _sanitizeSettings() {
        const s = this.settings;
        const D = this.constructor.DEFAULTS;
        s.barsMode = (s.barsMode === 'fixed') ? 'fixed' : 'auto';
        s.autoDays = this._clampFloat(s.autoDays, D.autoDays, 0.5, 90);
        s.bbars = this._clampInt(s.bbars, D.bbars, 1, 5000);
        s.cnum = this._clampInt(s.cnum, D.cnum, 5, 100);
        s.percent = this._clampFloat(s.percent, D.percent, 0, 100);
        s.widthDivisor = this._clampFloat(s.widthDivisor, D.widthDivisor, 0.5, 20);
        s.gapDivisor = this._clampFloat(s.gapDivisor, D.gapDivisor, 50, 100000);
        s.pocWidth = this._clampInt(s.pocWidth, D.pocWidth, 1, 5);
        s.vaAlpha = this._clampFloat(s.vaAlpha, D.vaAlpha, 0, 1);
        s.bodyAlpha = this._clampFloat(s.bodyAlpha, D.bodyAlpha, 0, 1);
        s.pocColor = this._normHex(s.pocColor, D.pocColor);
        s.vaUpColor = this._normHex(s.vaUpColor, D.vaUpColor);
        s.vaDownColor = this._normHex(s.vaDownColor, D.vaDownColor);
        s.upColor = this._normHex(s.upColor, D.upColor);
        s.downColor = this._normHex(s.downColor, D.downColor);
        s.vaLineColor = this._normHex(s.vaLineColor, D.vaLineColor);
        s.showPoc = s.showPoc !== false;
        s.showVaLines = !!s.showVaLines;
        s.extendPocRight = s.extendPocRight !== false;
        s.anchorRight = !!s.anchorRight;
        return s;
    }

    /**
     * BaseIndicator.updateSettings() после применения настроек дёргает
     * calculateAsync(), а он у нас — no-op (worker не используется).
     * Без этого переопределения программный вызов
     * `vp.updateSettings({ bbars: 300 })` не пересчитал бы профиль сразу —
     * его подхватил бы только фолбэк-таймер через 500 мс.
     */
    updateSettings(newSettings) {
        super.updateSettings(newSettings);
        this._sanitizeSettings();
        this._colorCache.clear();
        this.recompute();
    }

    // Примитив рисуется поверх серии, отдельные series не нужны.
    // ВАЖНО: IndicatorManager.addIndicator() требует truthy-возврат,
    // поэтому возвращаем массив (пустой массив — truthy).
    createSeries() {
        this.series = [];
        return this.series;
    }

    _createEmptySeries() { this.series = []; }

    updateSeriesData() { this.scheduleRecompute(); }

    /* ------------------------- настройки ------------------------- */

    _loadSettings() {
        try {
            const raw = localStorage && localStorage.getItem(this.constructor.STORAGE_KEY);
            return raw ? (JSON.parse(raw) || {}) : {};
        } catch (e) { return {}; }
    }

    _saveSettings() {
        try {
            if (localStorage) localStorage.setItem(this.constructor.STORAGE_KEY, JSON.stringify(this.settings));
        } catch (e) {}
    }

    /**
     * «Пустое» значение — то, из которого нельзя понять намерение пользователя.
     * ВАЖНО: null и '' сюда входят, потому что Number(null) === 0 и Number('') === 0 —
     * без этой проверки cnum:null дал бы МИНИМУМ (5 рядов) вместо дефолта (48).
     */
    _isBlank(v) {
        return v === undefined || v === null || v === '' ||
            (typeof v === 'string' && v.trim() === '');
    }

    _clampInt(v, fallback, min, max) {
        if (this._isBlank(v)) return fallback;
        const n = Math.round(Number(v));
        if (!isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, n));
    }

    _clampFloat(v, fallback, min, max) {
        if (this._isBlank(v)) return fallback;
        const n = Number(v);
        if (!isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, n));
    }

    _normHex(v, fallback) {
        if (typeof v !== 'string') return fallback;
        const s = v.trim();
        return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? s : fallback;
    }

    _settingsSignature() {
        const s = this.settings;
        // [AUTO] currentInterval входит в сигнатуру: в авто-режиме число баров
        // зависит от таймфрейма, поэтому смена ТФ обязана вызывать пересчёт.
        const cm = this.manager && this.manager.chartManager;
        return [cm && cm.currentInterval, s.barsMode, s.autoDays,
            s.bbars, s.cnum, s.percent, s.widthDivisor, s.gapDivisor,
            s.pocColor, s.pocWidth, s.showPoc, s.vaUpColor, s.vaDownColor, s.vaAlpha,
            s.upColor, s.downColor, s.bodyAlpha, s.showVaLines, s.vaLineColor,
            s.extendPocRight, s.anchorRight].join('|');
    }

    /* ------------------------- расчёт профиля ------------------------- */

    /**
     * [AUTO] Сколько баров брать под профиль.
     *   'fixed' — settings.bbars как есть;
     *   'auto'  — autoDays суток, пересчитанные в бары текущего таймфрейма.
     * Результат клампится к 1..5000 и к фактическому числу свечей.
     */
    _effectiveBars(dataLen) {
        const s = this.settings;
        if (s.barsMode === 'fixed') {
            return this._clampInt(s.bbars, this.constructor.DEFAULTS.bbars, 1, 5000);
        }
        const cm = this.manager && this.manager.chartManager;
        const iv = (cm && cm.currentInterval) || '1h';
        const sec = this.constructor.INTERVAL_SECONDS[iv];
        if (!sec) {
            // неизвестный ТФ — откатываемся к фиксированному значению
            return this._clampInt(s.bbars, this.constructor.DEFAULTS.bbars, 1, 5000);
        }
        const days = this._clampFloat(s.autoDays, this.constructor.DEFAULTS.autoDays, 0.5, 90);
        const bars = Math.round((days * 86400) / sec);
        const clamped = this._clampInt(bars, this.constructor.DEFAULTS.bbars, 1, 5000);
        return (typeof dataLen === 'number' && dataLen > 0) ? Math.min(clamped, dataLen) : clamped;
    }

    /**
     * Распределяет объём ценового отрезка [pFrom, pTo] по рядам.
     * volPerPrice — объём на единицу цены внутри отрезка; суммарно по всем
     * рядам добавится ровно volPerPrice * (pTo - pFrom), т.е. объём сохраняется.
     */
    _distribute(pFrom, pTo, volPerPrice, target, bot, step, rows) {
        if (!(pTo > pFrom) || !(volPerPrice > 0)) return;
        let i0 = Math.floor((pFrom - bot) / step);
        let i1 = Math.floor((pTo - bot) / step);
        if (i0 < 0) i0 = 0;
        if (i1 >= rows) i1 = rows - 1;
        for (let x = i0; x <= i1; x++) {
            const lo = Math.max(pFrom, bot + step * x);
            const hi = Math.min(pTo, bot + step * (x + 1));
            if (hi > lo) target[x] += (hi - lo) * volPerPrice;
        }
    }

    /**
     * Полный пересчёт профиля. Возвращает объект профиля или null.
     * Сложность O(bars * рядов_на_свечу) — благодаря ограничению диапазона
     * рядов по цене свечи это заметно дешевле «в лоб» O(bars * rows).
     */
    computeProfile(data, options) {
        const opt = options || {};
        // opt.bbars имеет приоритет (его передают тесты и computeProfile извне);
        // иначе — авто-подбор под таймфрейм через _effectiveBars().
        const barsReq = (opt.bbars !== undefined)
            ? this._clampInt(opt.bbars, this.constructor.DEFAULTS.bbars, 1, 5000)
            : this._effectiveBars(data ? data.length : 0);
        const rows = this._clampInt(opt.cnum !== undefined ? opt.cnum : this.settings.cnum, this.constructor.DEFAULTS.cnum, 2, 500);
        const percent = this._clampFloat(opt.percent !== undefined ? opt.percent : this.settings.percent, this.constructor.DEFAULTS.percent, 0, 100);

        if (!Array.isArray(data) || data.length < 2) return null;

        const bars = Math.max(1, Math.min(barsReq, data.length));
        const start = data.length - bars;

        // --- границы диапазона ---
        let top = -Infinity, bot = Infinity;
        for (let i = start; i < data.length; i++) {
            const h = Number(data[i].high), l = Number(data[i].low);
            if (isFinite(h) && h > top) top = h;
            if (isFinite(l) && l < bot) bot = l;
        }
        if (!isFinite(top) || !isFinite(bot) || !(top > bot)) return null;

        const step = (top - bot) / rows;
        if (!(step > 0)) return null;

        const up = new Float64Array(rows);
        const dn = new Float64Array(rows);
        let volumeSum = 0;

        for (let i = start; i < data.length; i++) {
            const c = data[i];
            if (!c) continue;
            const h = Number(c.high), l = Number(c.low), cl = Number(c.close);
            if (!isFinite(h) || !isFinite(l) || !isFinite(cl)) continue;
            const v = Number(c.volume);
            if (!isFinite(v) || v <= 0) continue;
            const o = isFinite(Number(c.open)) ? Number(c.open) : cl;

            volumeSum += v;

            const bodyTop = Math.max(o, cl);
            const bodyBot = Math.min(o, cl);
            const topWick = Math.max(h - bodyTop, 0);
            const botWick = Math.max(bodyBot - l, 0);
            const body = Math.max(bodyTop - bodyBot, 0);
            const denom = 2 * topWick + 2 * botWick + body;
            const green = cl >= o;

            if (!(denom > 0)) {
                // h == l == o == c: весь объём в один ряд (в оригинале здесь
                // возникал 0/0 -> na и «отравлял» ряд; у нас — явная ветка)
                let x = Math.floor((cl - bot) / step);
                if (x < 0) x = 0;
                if (x >= rows) x = rows - 1;
                if (green) up[x] += v; else dn[x] += v;
                continue;
            }

            const bodyVol = body * v / denom;
            const twVol = 2 * topWick * v / denom;
            const bwVol = 2 * botWick * v / denom;

            // тело: целиком в «ап» на растущей свече, в «даун» на падающей
            if (body > 0 && bodyVol > 0) {
                this._distribute(bodyBot, bodyTop, bodyVol / body, green ? up : dn, bot, step, rows);
            }
            // тени: объём делится пополам между «ап» и «даун»
            if (topWick > 0 && twVol > 0) {
                const half = (twVol / topWick) / 2;
                this._distribute(bodyTop, h, half, up, bot, step, rows);
                this._distribute(bodyTop, h, half, dn, bot, step, rows);
            }
            if (botWick > 0 && bwVol > 0) {
                const half = (bwVol / botWick) / 2;
                this._distribute(l, bodyBot, half, up, bot, step, rows);
                this._distribute(l, bodyBot, half, dn, bot, step, rows);
            }
        }

        // --- итоги, POC ---
        const total = new Float64Array(rows);
        let sum = 0, maxVol = 0, pocRow = 0;
        for (let x = 0; x < rows; x++) {
            const t = up[x] + dn[x];
            total[x] = t;
            sum += t;
            if (t > maxVol) { maxVol = t; pocRow = x; }
        }
        if (!(maxVol > 0) || !(sum > 0)) return null;

        // --- Value Area: расширение от POC в сторону большего объёма ---
        const vaTarget = sum * percent / 100;
        let vaTotal = total[pocRow];
        let vaHighRow = pocRow, vaLowRow = pocRow;
        for (let k = 0; k < rows; k++) {
            if (vaTotal >= vaTarget) break;
            const upperVol = vaHighRow < rows - 1 ? total[vaHighRow + 1] : 0;
            const lowerVol = vaLowRow > 0 ? total[vaLowRow - 1] : 0;
            if (upperVol === 0 && lowerVol === 0) break;
            if (upperVol >= lowerVol) { vaTotal += upperVol; vaHighRow++; }
            else { vaTotal += lowerVol; vaLowRow--; }
        }

        const levelAt = (x) => bot + step * x;

        return {
            rows, bars, start,
            startIndex: start,
            lastIndex: data.length - 1,
            firstTime: data[start] ? data[start].time : null,
            top, bot, step,
            levels: levelAt,               // функция, чтобы не хранить массив
            up, dn, total,
            maxVol, sum,
            pocRow,
            pocPrice: bot + step * (pocRow + 0.5),
            vaHighRow, vaLowRow,
            vah: levelAt(vaHighRow + 1),
            val: levelAt(vaLowRow),
            vaTotal, vaTarget,
            vaPercentActual: sum > 0 ? (vaTotal / sum) * 100 : 0,
            volumeSum
        };
    }

    recompute() {
        if (this._destroyed) return;
        try {
            const cm = this.manager && this.manager.chartManager;
            const data = cm && cm.chartData;
            const p = this.computeProfile(data);
            this._profile = p;

            if (p) {
                this.metrics = {
                    poc: p.pocPrice, vah: p.vah, val: p.val,
                    pocRow: p.pocRow, vaHighRow: p.vaHighRow, vaLowRow: p.vaLowRow,
                    totalVolume: p.sum, vaVolume: p.vaTotal,
                    vaPercentActual: p.vaPercentActual,
                    barsMode: this.settings.barsMode, autoDays: this.settings.autoDays,
                    rangeHigh: p.top, rangeLow: p.bot,
                    rows: p.rows, bars: p.bars,
                    isValid: true
                };
            } else {
                this.metrics = {
                    poc: null, vah: null, val: null, pocRow: -1, vaHighRow: -1, vaLowRow: -1,
                    totalVolume: 0, vaVolume: 0, vaPercentActual: 0,
                    rangeHigh: null, rangeLow: null, rows: 0, bars: 0, isValid: false
                };
            }

            this._lastDataLen = data ? data.length : 0;
            this._settingsSig = this._settingsSignature();
            this.requestRedraw();
        } catch (e) {
            console.warn('[VolumeProfile] recompute:', e);
        }
    }

    scheduleRecompute() {
        if (this._destroyed || this._recomputeTimeout) return;
        // троттлинг: профиль считается не чаще раза в 200 мс
        this._recomputeTimeout = setTimeout(() => {
            this._recomputeTimeout = null;
            this.recompute();
        }, 200);
    }

    /* ------------------------- события ------------------------- */

    _setupListeners() {
        const cm = this.manager && this.manager.chartManager;
        if (!cm) return;

        if (typeof cm._subscribeToSymbolChange === 'function') {
            this._symbolUnsub = true;
            cm._subscribeToSymbolChange(() => {
                setTimeout(() => { this._attach(true); this.recompute(); }, 400);
            });
        }
        if (typeof cm.on === 'function') {
            cm.on('dataUpdate', () => this._onDataUpdate());
        }

        // фолбэк-таймер: dataUpdate есть не во всех ветках загрузки данных
        let lastLen = -1, lastSig = '';
        this._fallbackTimer = setInterval(() => {
            if (this._destroyed) return;
            const data = this.manager && this.manager.chartManager && this.manager.chartManager.chartData;
            if (!data || !data.length) return;

            const last = data[data.length - 1];
            const sig = data.length + ':' + (last ? last.close + '/' + last.volume : '');
            const sigChanged = sig !== lastSig;
            lastLen = data.length;
            lastSig = sig;

            // смена типа графика (candle <-> bar) -> переприсоединяем примитив
            this._attach(true);

            const settingsSig = this._settingsSignature();
            if (sigChanged || settingsSig !== this._settingsSig) {
                this.recompute();
            } else {
                this.requestRedraw();
            }
        }, 500);
    }

    _onDataUpdate() {
        const data = this.manager && this.manager.chartManager && this.manager.chartManager.chartData;
        const last = data && data.length ? data[data.length - 1] : null;
        const sig = last ? (last.close + '/' + last.volume) : '';
        // пересчитываем только если изменилась длина или последняя свеча
        if (data && data.length === this._lastDataLen && sig === this._lastBarSig &&
            this._settingsSig === this._settingsSignature()) {
            this.requestRedraw();
            return;
        }
        this._lastBarSig = sig;
        this.scheduleRecompute();
    }

    /* ------------------------- примитив ------------------------- */

    _getSeries() {
        const cm = this.manager && this.manager.chartManager;
        if (!cm) return null;
        return cm.currentChartType === 'candle' ? cm.candleSeries : cm.barSeries;
    }

    _attach(force) {
        if (this._destroyed) return;
        const series = this._getSeries();
        if (!series || typeof series.attachPrimitive !== 'function') {
            if (!this._attachTimeout) this._attachTimeout = setTimeout(() => { this._attachTimeout = null; this._attach(); }, 500);
            return;
        }
        if (this._primitive && this._attachedSeries === series && !force) return;

        // отсоединяем от прежней серии (смена типа графика / пересоздание чарта)
        if (this._primitive && this._attachedSeries && this._attachedSeries !== series) {
            try { this._attachedSeries.detachPrimitive(this._primitive); } catch (e) {}
            this._primitive = null;
        }
        if (this._primitive && force) {
            try { series.detachPrimitive(this._primitive); } catch (e) {}
            this._primitive = null;
        }
        if (this._primitive) { this._attachedSeries = series; return; }

        const self = this;
        this._primitive = {
            paneViews: () => [{ renderer: () => ({ draw: (target) => self._draw(target) }) }],
            attached: (params) => { self._requestUpdate = params && params.requestUpdate; },
            detached: () => { self._requestUpdate = null; },
            updateAllViews: () => {},
            requestRedraw: () => { if (self._requestUpdate) self._requestUpdate(); }
        };
        try {
            series.attachPrimitive(this._primitive);
            this._attachedSeries = series;
        } catch (e) {
            console.warn('[VolumeProfile] attachPrimitive:', e);
            this._primitive = null;
        }
    }

    requestRedraw() {
        this._attach();
        if (this._primitive && this._primitive.requestRedraw) {
            try { this._primitive.requestRedraw(); } catch (e) {}
        }
    }

    /* ------------------------- рисование ------------------------- */

    _rgba(hex, alpha) {
        const key = hex + '|' + alpha;
        let cached = this._colorCache.get(key);
        if (cached) return cached;
        let h = String(hex).replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        const r = parseInt(h.slice(0, 2), 16) || 0;
        const g = parseInt(h.slice(2, 4), 16) || 0;
        const b = parseInt(h.slice(4, 6), 16) || 0;
        cached = 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
        this._colorCache.set(key, cached);
        return cached;
    }

    _barSpacing(timeScale) {
        try {
            const opts = typeof timeScale.options === 'function' ? timeScale.options() : timeScale.options;
            if (opts && isFinite(opts.barSpacing) && opts.barSpacing > 0) return opts.barSpacing;
        } catch (e) {}
        return 8;
    }

    _xForIndex(timeScale, index, data) {
        try {
            if (typeof timeScale.logicalToCoordinate === 'function') {
                const x = timeScale.logicalToCoordinate(index);
                if (x !== null && x !== undefined && isFinite(x)) return x;
            }
        } catch (e) {}
        try {
            const candle = data && data[index];
            if (candle && typeof timeScale.timeToCoordinate === 'function') {
                const x = timeScale.timeToCoordinate(candle.time);
                if (x !== null && x !== undefined && isFinite(x)) return x;
            }
        } catch (e) {}
        return null;
    }

    _draw(target) {
        if (this._destroyed) return;
        if (this.visible === false) return;
        const p = this._profile;
        if (!p) return;

        const cm = this.manager && this.manager.chartManager;
        const chart = cm && cm.chart;
        if (!chart) return;
        const series = this._getSeries();
        if (!series || typeof series.priceToCoordinate !== 'function') return;

        const timeScale = chart.timeScale();
        if (!timeScale) return;
        const data = cm.chartData;
        if (!data || !data.length) return;

        const s = this.settings;
        const bs = this._barSpacing(timeScale);
        // anchorRight: гистограмма растёт ВЛЕВО от правого края последней свечи,
        // иначе — ВПРАВО от первой свечи диапазона (как в оригинале).
        const anchorRight = !!s.anchorRight;
        const x0 = this._xForIndex(timeScale, anchorRight ? p.lastIndex + 1 : p.startIndex, data);
        if (x0 === null) return;

        const widthDivisor = this._clampFloat(s.widthDivisor, this.constructor.DEFAULTS.widthDivisor, 0.5, 20);
        const gapDivisor = this._clampFloat(s.gapDivisor, this.constructor.DEFAULTS.gapDivisor, 50, 100000);
        // максимальная длина ряда в пикселях (в оригинале — bbars/3 свечей)
        const maxLenPx = (p.bars / widthDivisor) * bs;
        if (!(maxLenPx > 0)) return;
        // зазор между рядами, как dist = (top - bot) / 500 в оригинале
        const gapPrice = (p.top - p.bot) / gapDivisor;

        const priceToY = (price) => series.priceToCoordinate(price);

        target.useBitmapCoordinateSpace((scope) => {
            const ctx = scope.context;
            const hpr = scope.horizontalPixelRatio;
            const vpr = scope.verticalPixelRatio;
            const mediaW = scope.mediaSize.width;

            const fillVaUp = this._rgba(s.vaUpColor, this._clampFloat(s.vaAlpha, this.constructor.DEFAULTS.vaAlpha, 0, 1));
            const fillVaDown = this._rgba(s.vaDownColor, this._clampFloat(s.vaAlpha, this.constructor.DEFAULTS.vaAlpha, 0, 1));
            const fillUp = this._rgba(s.upColor, this._clampFloat(s.bodyAlpha, this.constructor.DEFAULTS.bodyAlpha, 0, 1));
            const fillDown = this._rgba(s.downColor, this._clampFloat(s.bodyAlpha, this.constructor.DEFAULTS.bodyAlpha, 0, 1));

            const xStart = x0 * hpr;

            // --- гистограмма ---
            for (let x = 0; x < p.rows; x++) {
                const pBot = p.bot + p.step * x;
                const pTop = pBot + p.step;
                // сужаем ряд на gapPrice сверху и снизу (аналог dist в оригинале)
                const yTop = priceToY(pTop - gapPrice);
                const yBot = priceToY(pBot + gapPrice);
                if (yTop === null || yBot === null) continue;

                const top = Math.min(yTop, yBot) * vpr;
                const height = Math.abs(yBot - yTop) * vpr;
                if (!(height > 0)) continue;

                const inVA = x >= p.vaLowRow && x <= p.vaHighRow;
                const lenUp = (p.up[x] / p.maxVol) * maxLenPx;
                const lenDn = (p.dn[x] / p.maxVol) * maxLenPx;

                if (anchorRight) {
                    // зеркально: «ап» у правого края, «даун» левее него
                    if (lenUp > 0) {
                        ctx.fillStyle = inVA ? fillVaUp : fillUp;
                        ctx.fillRect(xStart - lenUp * hpr, top, lenUp * hpr, height);
                    }
                    if (lenDn > 0) {
                        ctx.fillStyle = inVA ? fillVaDown : fillDown;
                        ctx.fillRect(xStart - (lenUp + lenDn) * hpr, top, lenDn * hpr, height);
                    }
                } else {
                    if (lenUp > 0) {
                        ctx.fillStyle = inVA ? fillVaUp : fillUp;
                        ctx.fillRect(xStart, top, lenUp * hpr, height);
                    }
                    if (lenDn > 0) {
                        ctx.fillStyle = inVA ? fillVaDown : fillDown;
                        ctx.fillRect(xStart + lenUp * hpr, top, lenDn * hpr, height);
                    }
                }
            }

            // --- линии VAH / VAL (опционально) ---
            if (s.showVaLines) {
                this._drawHLine(ctx, priceToY(p.vah), hpr, vpr, mediaW, s.vaLineColor, 1, x0);
                this._drawHLine(ctx, priceToY(p.val), hpr, vpr, mediaW, s.vaLineColor, 1, x0);
                this._drawTag(ctx, 'VAH ' + this._fmt(p.vah), priceToY(p.vah), hpr, vpr, mediaW, s.vaLineColor);
                this._drawTag(ctx, 'VAL ' + this._fmt(p.val), priceToY(p.val), hpr, vpr, mediaW, s.vaLineColor);
            }

            // --- POC ---
            if (s.showPoc !== false) {
                const yPoc = priceToY(p.pocPrice);
                if (yPoc !== null) {
                    const w = this._clampInt(s.pocWidth, this.constructor.DEFAULTS.pocWidth, 1, 5);
                    // extendPocRight=false -> линия только внутри профиля
                    const fromX = (s.extendPocRight === false && !anchorRight) ? x0 : 0;
                    this._drawHLine(ctx, yPoc, hpr, vpr, mediaW, s.pocColor, w, fromX);

                    // метка: 15 свечей правее последнего бара (как в оригинале),
                    // но не дальше правого края панели
                    const xLast = this._xForIndex(timeScale, p.lastIndex, data);
                    // 15 баров от последней свечи; при anchorRight уносим метку влево,
                    // чтобы она не наезжала на гистограмму
                    let labelX = (xLast !== null
                        ? (anchorRight ? xLast - 15 * bs : xLast + 15 * bs)
                        : mediaW - 10);
                    this._drawPocLabel(ctx, 'POC: ' + this._fmt(p.pocPrice), labelX, yPoc,
                        hpr, vpr, mediaW, s.pocColor, data[data.length - 1]);
                }
            }
        });
    }

    _drawHLine(ctx, yMedia, hpr, vpr, mediaW, color, width, fromXMedia) {
        if (yMedia === null || yMedia === undefined || !isFinite(yMedia)) return;
        const y = yMedia * vpr;
        const x1 = (fromXMedia || 0) * hpr;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, width) * vpr;
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(mediaW * hpr, y);
        ctx.stroke();
        ctx.restore();
    }

    _measure(ctx, text, vpr) {
        ctx.save();
        ctx.font = '11px "JetBrains Mono", monospace';
        const w = ctx.measureText(text).width;
        ctx.restore();
        return { w: w, h: 15 };
    }

    _drawTag(ctx, text, yMedia, hpr, vpr, mediaW, color) {
        if (yMedia === null || !isFinite(yMedia)) return;
        const m = this._measure(ctx, text, vpr);
        const padX = 5, padY = 3;
        const w = (m.w + padX * 2) * hpr;
        const h = (m.h + padY) * vpr;
        const x = mediaW * hpr - w - 2 * hpr;
        const y = yMedia * vpr - h / 2;
        ctx.save();
        ctx.fillStyle = this._rgba(color, 0.85);
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#000000';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + padX * hpr, y + h / 2);
        ctx.restore();
    }

    _drawPocLabel(ctx, text, xMedia, yMedia, hpr, vpr, mediaW, color, lastCandle) {
        if (yMedia === null || !isFinite(yMedia)) return;
        const m = this._measure(ctx, text, vpr);
        const padX = 6, padY = 4;
        const w = (m.w + padX * 2) * hpr;
        const h = (m.h + padY * 2) * vpr;

        let x = xMedia * hpr;
        if (x + w > mediaW * hpr - 2 * hpr) x = mediaW * hpr - w - 2 * hpr;
        if (x < 2 * hpr) x = 2 * hpr;

        // стиль метки: выше линии, если цена над POC, и ниже — если под (как в оригинале)
        const above = lastCandle && isFinite(Number(lastCandle.close)) && Number(lastCandle.close) >= this._profile.pocPrice;
        const tail = 6 * vpr;
        const y = above ? (yMedia * vpr - h - tail) : (yMedia * vpr + tail);

        ctx.save();
        ctx.fillStyle = color;
        ctx.beginPath();
        // прямоугольник со «хвостом» к линии
        const r = 3 * vpr;
        const cx = x + w / 2;
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        if (!above) { ctx.lineTo(cx + 5 * hpr, y); }
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        if (above) {
            ctx.lineTo(cx + 5 * hpr, y + h);
            ctx.lineTo(cx, y + h + tail);
            ctx.lineTo(cx - 5 * hpr, y + h);
        }
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        if (!above) {
            ctx.lineTo(cx - 5 * hpr, y);
            ctx.lineTo(cx, y - tail);
            ctx.lineTo(cx + 5 * hpr, y);
        }
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + padX * hpr, y + h / 2);
        ctx.restore();
    }

    _fmt(price) {
        if (!isFinite(price)) return '—';
        try {
            const cm = this.manager && this.manager.chartManager;
            if (cm && typeof cm.getDrawingPrecision === 'function') {
                const d = cm.getDrawingPrecision();
                if (typeof d === 'number' && isFinite(d) && d >= 0) return price.toFixed(Math.min(8, Math.floor(d)));
            }
        } catch (e) {}
        const a = Math.abs(price);
        if (a >= 1000) return price.toFixed(1);
        if (a >= 1) return price.toFixed(2);
        if (a >= 0.01) return price.toFixed(4);
        return price.toPrecision(4);
    }

    /* ------------------------- UI настроек ------------------------- */

    getSettingsHTML() {
        const s = this.settings;
        const rowStyle = 'background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px;';
        const numStyle = rowStyle + ' width:80px;';
        const labelStyle = 'color:#B0B0B0; width:150px;';
        const rowDiv = 'margin-bottom:8px; display:flex; align-items:center; gap:10px;';
        const chk = (v) => v ? 'checked' : '';

        return `
            <div style="max-height:400px; overflow-y:auto; padding-right:5px; scrollbar-width: thin; scrollbar-color: #4A4A4A #1E1E1E;">
                <div style="margin-bottom:12px;">
                    <div style="color:#2196F3; margin-bottom:8px;">📊 Диапазон и ряды</div>
                    <div style="${rowDiv}">
                        <label style="${labelStyle}" title="Авто — число баров подбирается под таймфрейм так, чтобы профиль покрывал заданное число суток. Фиксированно — всегда одно и то же число баров.">Баров:</label>
                        <select id="vp_barsMode" onchange="var a=this.value==='auto';document.getElementById('vp_autoDays_row').style.display=a?'flex':'none';document.getElementById('vp_bbars_row').style.display=a?'none':'flex';" style="${rowStyle}">
                            <option value="auto" ${s.barsMode === 'auto' ? 'selected' : ''}>Авто (по таймфрейму)</option>
                            <option value="fixed" ${s.barsMode === 'fixed' ? 'selected' : ''}>Фиксированно</option>
                        </select>
                    </div>
                    <div id="vp_autoDays_row" style="${rowDiv} display:${s.barsMode === 'auto' ? 'flex' : 'none'};">
                        <label style="${labelStyle}" title="Сколько суток истории входит в профиль. На 1h при 7 днях это 168 баров, на 5m — 2016.">Период, суток:</label>
                        <input type="number" id="vp_autoDays" value="${s.autoDays}" min="0.5" max="90" step="0.5" style="${numStyle}">
                        <span style="color:#888; font-size:10px;">≈ ${this._effectiveBars()} баров</span>
                    </div>
                    <div id="vp_bbars_row" style="${rowDiv} display:${s.barsMode === 'fixed' ? 'flex' : 'none'};">
                        <label style="${labelStyle}" title="Сколько последних свечей входит в расчёт">Количество баров:</label>
                        <input type="number" id="vp_bbars" value="${s.bbars}" min="1" max="5000" style="${numStyle}">
                    </div>
                    <div style="${rowDiv}">
                        <label style="${labelStyle}" title="На сколько горизонтальных рядов делится ценовой диапазон">Число рядов:</label>
                        <input type="number" id="vp_cnum" value="${s.cnum}" min="5" max="100" style="${numStyle}">
                    </div>
                    <div style="${rowDiv}">
                        <label style="${labelStyle}" title="Сколько процентов объёма должно попасть в Value Area">Value Area, %:</label>
                        <input type="number" id="vp_percent" value="${s.percent}" min="0" max="100" step="1" style="${numStyle}">
                    </div>
                    <div style="${rowDiv}">
                        <label style="${labelStyle}" title="Максимальная длина ряда = баров / делитель">Ширина (делитель):</label>
                        <input type="number" id="vp_widthDivisor" value="${s.widthDivisor}" min="0.5" max="20" step="0.5" style="${numStyle}">
                    </div>
                </div>
                <div style="margin-bottom:12px;">
                    <div style="color:#2196F3; margin-bottom:8px;">🎯 POC</div>
                    <div style="${rowDiv}">
                        <label style="${labelStyle}">Показывать POC:</label>
                        <input type="checkbox" id="vp_showPoc" ${chk(s.showPoc)} style="accent-color:#4A90E2;">
                    </div>
                    <div style="${rowDiv}">
                        <label style="${labelStyle}">Цвет POC:</label>
                        <input type="color" id="vp_pocColor" value="${s.pocColor}" style="width:50px; height:28px; background:#1E1E1E; border:1px solid #404040; border-radius:4px;">
                        <label style="color:#B0B0B0;">Толщина:</label>
                        <input type="number" id="vp_pocWidth" value="${s.pocWidth}" min="1" max="5" style="${numStyle}">
                    </div>
                    <div style="${rowDiv}">
                        <label style="${labelStyle}" title="Продлевать линию POC вправо до края панели">Линия вправо:</label>
                        <input type="checkbox" id="vp_extendPocRight" ${chk(s.extendPocRight)} style="accent-color:#4A90E2;">
                    </div>
                    <div style="${rowDiv}">
                        <label style="${labelStyle}" title="Гистограмма растёт влево от последней свечи. Включайте на длинном диапазоне (1000+ баров), иначе профиль уходит за левый край экрана">От правого края:</label>
                        <input type="checkbox" id="vp_anchorRight" ${chk(s.anchorRight)} style="accent-color:#4A90E2;">
                    </div>
                </div>
                <div style="margin-bottom:12px;">
                    <div style="color:#2196F3; margin-bottom:8px;">🎨 Цвета</div>
                    <div style="${rowDiv}">
                        <label style="${labelStyle}">Value Area вверх:</label>
                        <input type="color" id="vp_vaUpColor" value="${s.vaUpColor}" style="width:50px; height:28px; background:#1E1E1E; border:1px solid #404040; border-radius:4px;">
                        <label style="color:#B0B0B0;">Прозрачность:</label>
                        <input type="number" id="vp_vaAlpha" value="${s.vaAlpha}" min="0" max="1" step="0.05" style="${numStyle}">
                    </div>
                    <div style="${rowDiv}">
                        <label style="${labelStyle}">Value Area вниз:</label>
                        <input type="color" id="vp_vaDownColor" value="${s.vaDownColor}" style="width:50px; height:28px; background:#1E1E1E; border:1px solid #404040; border-radius:4px;">
                    </div>
                    <div style="${rowDiv}">
                        <label style="${labelStyle}">Объём вверх:</label>
                        <input type="color" id="vp_upColor" value="${s.upColor}" style="width:50px; height:28px; background:#1E1E1E; border:1px solid #404040; border-radius:4px;">
                        <label style="color:#B0B0B0;">Прозрачность:</label>
                        <input type="number" id="vp_bodyAlpha" value="${s.bodyAlpha}" min="0" max="1" step="0.05" style="${numStyle}">
                    </div>
                    <div style="${rowDiv}">
                        <label style="${labelStyle}">Объём вниз:</label>
                        <input type="color" id="vp_downColor" value="${s.downColor}" style="width:50px; height:28px; background:#1E1E1E; border:1px solid #404040; border-radius:4px;">
                    </div>
                </div>
                <div style="margin-bottom:12px;">
                    <div style="color:#2196F3; margin-bottom:8px;">📏 Value Area линии</div>
                    <div style="${rowDiv}">
                        <label style="${labelStyle}" title="Рисовать горизонтальные линии и метки VAH/VAL">Показывать VAH/VAL:</label>
                        <input type="checkbox" id="vp_showVaLines" ${chk(s.showVaLines)} style="accent-color:#4A90E2;">
                    </div>
                    <div style="${rowDiv}">
                        <label style="${labelStyle}">Цвет VAH/VAL:</label>
                        <input type="color" id="vp_vaLineColor" value="${s.vaLineColor}" style="width:50px; height:28px; background:#1E1E1E; border:1px solid #404040; border-radius:4px;">
                    </div>
                </div>
                <div style="color:#888; font-size:10px; line-height:1.5;">
                    Профиль считается по последним N барам и перерисовывается
                    автоматически. Объём свечи распределяется по рядам: тело — вес 1,
                    каждая тень — вес 2, объём тени делится пополам между
                    «ап» и «даун» частями ряда.
                </div>
            </div>
        `;
    }

    applySettingsFromForm() {
        // Читаем ТОЛЬКО реально присутствующие в DOM поля: иначе вызов без
        // открытой панели молча сбросил бы настройки к дефолтам.
        const el = (id) => document.getElementById(id);
        const num = (id, fallback, min, max) => {
            const e = el(id);
            if (!e || e.value === '' || e.value == null) return fallback;
            const v = parseFloat(e.value);
            return isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
        };
        const int = (id, fallback, min, max) => Math.round(num(id, fallback, min, max));
        const bool = (id, fallback) => {
            const e = el(id);
            return (e && typeof e.checked === 'boolean') ? e.checked : fallback;
        };
        const oneOf = (id, allowed, fallback) => {
            const e = el(id);
            const v = (e && e.value != null && e.value !== '') ? e.value : fallback;
            return allowed.includes(v) ? v : fallback;
        };
        const color = (id, fallback) => {
            const e = el(id);
            return (e && typeof e.value === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(e.value))
                ? e.value : fallback;
        };
        const s = this.settings;

        // 5000 вместо 500 из оригинала: замер показал ~1 мс на 5000 баров x 100 рядов,
        // а на минутных ТФ 500 баров — это меньше суток, профиль получается бессмысленным.
        s.barsMode = oneOf('vp_barsMode', ['auto', 'fixed'], s.barsMode);
        s.autoDays = num('vp_autoDays', s.autoDays, 0.5, 90);
        // 5000 вместо 500 из оригинала: замер показал ~1 мс на 5000 баров x 100 рядов,
        // а на минутных ТФ 500 баров — это меньше суток, профиль получается бессмысленным.
        s.bbars = int('vp_bbars', s.bbars, 1, 5000);
        s.cnum = int('vp_cnum', s.cnum, 5, 100);
        s.percent = num('vp_percent', s.percent, 0, 100);
        s.widthDivisor = num('vp_widthDivisor', s.widthDivisor, 0.5, 20);

        s.showPoc = bool('vp_showPoc', s.showPoc);
        s.pocColor = color('vp_pocColor', s.pocColor);
        s.pocWidth = int('vp_pocWidth', s.pocWidth, 1, 5);
        s.extendPocRight = bool('vp_extendPocRight', s.extendPocRight);
        s.anchorRight = bool('vp_anchorRight', s.anchorRight);

        s.vaUpColor = color('vp_vaUpColor', s.vaUpColor);
        s.vaDownColor = color('vp_vaDownColor', s.vaDownColor);
        s.vaAlpha = num('vp_vaAlpha', s.vaAlpha, 0, 1);
        s.upColor = color('vp_upColor', s.upColor);
        s.downColor = color('vp_downColor', s.downColor);
        s.bodyAlpha = num('vp_bodyAlpha', s.bodyAlpha, 0, 1);

        s.showVaLines = bool('vp_showVaLines', s.showVaLines);
        s.vaLineColor = color('vp_vaLineColor', s.vaLineColor);

        this._saveSettings();
        this._sanitizeSettings();
        this._colorCache.clear();
        this.recompute();
        if (super.applySettingsFromForm) super.applySettingsFromForm();
    }

    /* ------------------------- диагностика ------------------------- */

    /** В консоли браузера: __vpDebug() */
    _debugDump() {
        const cm = this.manager && this.manager.chartManager;
        const data = (cm && cm.chartData) || [];
        const p = this._profile;
        const out = {
            'свечей в chartData': data.length,
            'currentInterval': cm && cm.currentInterval,
            'barsMode': this.settings && this.settings.barsMode,
            'autoDays': this.settings && this.settings.autoDays,
            'эффективно баров': this._effectiveBars(data.length),
            'anchorRight': !!(this.settings && this.settings.anchorRight),
            'showVaLines': !!(this.settings && this.settings.showVaLines),
            'баров в профиле': p ? p.bars : 0,
            'рядов': p ? p.rows : 0,
            'диапазон': p ? (this._fmt(p.bot) + ' .. ' + this._fmt(p.top)) : '—',
            'POC': p ? this._fmt(p.pocPrice) : '—',
            'POC ряд': p ? p.pocRow : -1,
            'VAH': p ? this._fmt(p.vah) : '—',
            'VAL': p ? this._fmt(p.val) : '—',
            'VA ряды': p ? (p.vaLowRow + '..' + p.vaHighRow) : '—',
            'объём всего': p ? p.volumeSum.toFixed(2) : 0,
            'объём в VA': p ? p.vaTotal.toFixed(2) : 0,
            'VA фактически %': p ? p.vaPercentActual.toFixed(1) : 0,
            'примитив присоединён': !!this._primitive,
            'серия': this._getSeries() ? 'есть' : 'нет',
            'visible': this.visible
        };
        try { console.table(out); } catch (e) { console.log(out); }
        return out;
    }

    /* ------------------------- уничтожение ------------------------- */

    destroy() {
        this._destroyed = true;
        if (this._attachTimeout) { clearTimeout(this._attachTimeout); this._attachTimeout = null; }
        if (this._recomputeTimeout) { clearTimeout(this._recomputeTimeout); this._recomputeTimeout = null; }
        if (this._fallbackTimer) { clearInterval(this._fallbackTimer); this._fallbackTimer = null; }
        if (this._primitive && this._attachedSeries) {
            try { this._attachedSeries.detachPrimitive(this._primitive); } catch (e) {}
        }
        this._primitive = null;
        this._attachedSeries = null;
        this._requestUpdate = null;
        this._profile = null;
        this._colorCache.clear();
        // super.destroy() сам делает _removeAllSeries() + manager = null
        // (series у нас пустой, поэтому обращение к chart безопасно)
        super.destroy();
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
    window.IndicatorRegistry.set('volumeprofile', VolumeProfileIndicator);
   
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
    window.VolumeProfileIndicator = VolumeProfileIndicator;
 
}
