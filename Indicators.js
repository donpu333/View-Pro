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
    static meta = { name: 'EMA 20', category: 'trend', panel: 'main', color: '#00E5FF', multiple: true };   // [VP-MA]

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

    // [VOL24-FIX] Константы расчёта. Раньше 24h-объём считался по 388 пяти-минутным
    // барам (32.3 часа), а скользящее 24-часовое окно требует 288 баров LOOKBACK —
    // поэтому корректное окно было только у последних 100 баров, а остальные 288
    // (74% данных) получали ЗАНИЖЕННУЮ сумму по неполному окну.
    static BASE_TF = '5m';
    static BASE_SEC = 300;
    static DAY_SEC = 86400;
    static PAGE_SIZE = 1000;   // максимум баров за один запрос к бирже
    static MAX_PAGES = 4;      // 4000 x 5m ≈ 13.9 суток базы
    static CACHE_TTL_MS = 45000;

    // Секунды в баре — та же карта, что INTERVAL_SECONDS_MAP в ChartManager.js.
    // Держим свою копию: та объявлена top-level const в чужом файле.
    static INTERVAL_SECONDS = {
        '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
        '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200,
        '1d': 86400, '1w': 604800, '1M': 2592000
    };

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

        // [VOL24-FIX] кэш базовых 5m-данных и наблюдатель за сменой таймфрейма
        this._baseCache = null;      // { from, to, bars, rolling, at }
        this._tfTimer = null;
        this._inflight = false;

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
                // [VOL24-FIX] ТОЧКА ПРИ НАВЕДЕНИИ.
                // IndicatorPanelManager.addSeries() подставляет
                // crosshairMarkerVisible:false ([FIX-I6]), но Object.assign({...}, options)
                // отдаёт приоритет options — поэтому раньше здесь стояло true и точка
                // возвращалась. Теперь false задано ЯВНО, а не «опция удалена»:
                // результат не зависит от чужих дефолтов и от порядка Object.assign.
                crosshairMarkerVisible: false,
                crosshairMarkerRadius: 0
            })
        ];
        // Страховка: если панель создала серию с маркером (старая версия
        // IndicatorPanelManager / кэш), гасим его принудительно.
        try {
            const s0 = this.series[0];
            if (s0 && typeof s0.applyOptions === 'function') {
                s0.applyOptions({ crosshairMarkerVisible: false, crosshairMarkerRadius: 0 });
            }
        } catch (e) {}
        return this.series;
    }

    /* ========================= подписки ========================= */

    _setupListeners() {
        const cm = this.manager?.chartManager;
        if (!cm) return;

        if (cm._subscribeToSymbolChange) {
            cm._subscribeToSymbolChange(() => {
                this._baseVolumes = [];
                this._baseCache = null;      // [VOL24-FIX] другой символ — база не годится
                this._dataLoaded = false;
                if (this._pendingTimer) clearTimeout(this._pendingTimer);
                this._waitForChartData(cm);
            });
        }

        this._updateInterval = setInterval(() => {
            if (this._dataLoaded) this.fetchAndCalculate();
        }, 60000);

        // [VOL24-FIX] Наблюдатель за сменой таймфрейма / заменой данных.
        // В ChartManager нет колбэка на смену интервала (есть только
        // _subscribeToSymbolChange), поэтому раньше при переключении ТФ гистограмма
        // оставалась со СТАРЫМИ метками времени и чужими значениями — и «чинилась»
        // только через 60 с, когда срабатывал таймер обновления. Отсюда и эффект
        // «на разных таймфреймах показывает разное».
        this._startTfWatcher();

        this._waitForChartData(cm);
    }

    _startTfWatcher() {
        if (this._tfTimer) return;
        let lastIv = null, lastFirst = null, lastLen = -1;
        this._tfTimer = setInterval(() => {
            const cm = this.manager?.chartManager;
            if (!cm || !cm.chartData || !cm.chartData.length) return;

            const iv = cm.currentInterval;
            const first = cm.chartData[0].time;
            const len = cm.chartData.length;

            // Смена ТФ или полная замена набора данных (другой символ/диапазон)
            if (iv !== lastIv || first !== lastFirst) {
                lastIv = iv; lastFirst = first; lastLen = len;
                this._dataLoaded = true;
                // база 5m кэширована — если она покрывает новый диапазон,
                // пересчёт пройдёт без сети и мгновенно
                this.fetchAndCalculate();
                return;
            }
            lastLen = len;
        }, 500);
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

    /* ========================= расчёт ========================= */

    async fetchAndCalculate() {
        const cm = this.manager?.chartManager;
        if (!cm?.currentSymbol || !this._dataLoaded) return;
        if (this._inflight) return;          // не плодим параллельные запросы
        this._inflight = true;

        try {
            const chartData = cm.chartData;
            if (!chartData || chartData.length === 0) return;

            const ivSec = this.constructor.INTERVAL_SECONDS[cm.currentInterval];

            // [VOL24-FIX] Для ТФ >= 1d скользящее 24h-окно из пятиминутных баров
            // физически недоступно (недели истории), поэтому там считается сумма
            // дневных объёмов, попадающих в свечу графика. Это корректно и для 1d
            // (свеча = сутки), и для 1w/1M (свеча = неделя/месяц) — раньше 1w и 1M
            // попадали в «пятиминутную» ветку и показывали объём ~8 часов вместо недели.
            if (!ivSec || ivSec >= this.constructor.DAY_SEC) {
                await this._calcAggregated(cm, chartData);
            } else {
                await this._calcRolling(cm, chartData, ivSec);
            }
        } catch (e) {
            console.warn('Vol 24H: Ошибка', e);
        } finally {
            this._inflight = false;
        }
    }

    /**
     * [VOL24-FIX] Скользящий 24-часовой объём для внутридневных ТФ.
     * Значение привязано к МОМЕНТУ ВРЕМЕНИ, а не к номеру свечи, поэтому на любом
     * таймфрейме один и тот же момент даёт одно и то же число.
     */
    async _calcRolling(cm, chartData, ivSec) {
        const DAY = this.constructor.DAY_SEC;
        const BASE = this.constructor.BASE_SEC;

        // Какое время должна покрывать база:
        //   от (close первой свечи графика − 24h) до close последней свечи.
        const needTo = chartData[chartData.length - 1].time + ivSec;
        const needFrom = chartData[0].time + ivSec - DAY;

        const base = await this._getBaseRange(cm, needFrom, needTo);
        if (!base || base.length === 0) return;

        const rolling = this._rolling24h(base);
        if (!rolling.length) return;

        const aligned = [];
        const n = rolling.length;
        let idx = 0;

        for (let i = 0; i < chartData.length; i++) {
            const c = chartData[i];
            const isLast = (i === chartData.length - 1);
            // Момент, на который нужно значение:
            //   обычная свеча     -> её close, т.е. базовый бар (close − 5m)
            //   формирующаяся     -> сейчас, т.е. последний базовый бар
            const targetBaseTime = isLast ? rolling[n - 1].time : (c.time + ivSec - BASE);

            while (idx + 1 < n && rolling[idx + 1].time <= targetBaseTime) idx++;
            const r = rolling[idx];

            // [VOL24-FIX] Если для свечи нет базового бара (свеча старше загруженной
            // базы) или окно неполное — точку НЕ рисуем. Раньше vIdx оставался 0 и все
            // такие свечи получали _baseVolumes[0].value — одну и ту же заниженную
            // константу, из-за чего левая часть графика была плоской и неверной.
            if (!r || r.time > targetBaseTime || !r.valid) continue;

            aligned.push({ time: c.time, value: r.value });
        }

        this._baseVolumes = rolling;
        this._applySeriesData(aligned);
    }

    /**
     * [VOL24-FIX] Скользящая сумма за 24 часа по базовым барам.
     * Окно — (t − 24h, t], то есть РОВНО 288 пятиминутных баров.
     * Раньше условие было `t_i − t_j <= 86400`, из-за чего в окно попадал и бар
     * ровно 24 часа назад: 289 баров = 24ч 05м (off-by-one).
     */
    _rolling24h(base) {
        const DAY = this.constructor.DAY_SEC;
        const need = Math.round(DAY / this.constructor.BASE_SEC) - 1;   // 287 -> 288 баров
        const out = [];
        let sum = 0, left = 0;

        for (let i = 0; i < base.length; i++) {
            sum += base[i].volume;
            // строго '<': бар ровно 24h назад в окно НЕ входит
            while (base[i].time - base[left].time >= DAY) {
                sum -= base[left].volume;
                left++;
            }
            out.push({
                time: base[i].time,
                value: sum,
                // окно полное, если в нём действительно 288 баров
                valid: (i - left) >= need
            });
        }
        return out;
    }

    /**
     * [VOL24-FIX] База 5m, покрывающая [fromSec, toSec], с докачкой страницами.
     * Один запрос к бирже даёт максимум ~1000 баров (83 часа), а для корректного
     * 24h-окна на всём видимом диапазоне нужно больше — поэтому идём назад
     * страницами, пока не покроем диапазон или не упрёмся в лимит.
     */
    async _getBaseRange(cm, fromSec, toSec) {
        const now = Date.now();
        const c = this._baseCache;
        // [VOL24-FIX] Покрываем ли диапазон — проверяем по ЗАПРОШЕННЫМ границам,
        // а не по фактически полученным. Биржа никогда не отдаёт бары из будущего,
        // поэтому c.to всегда меньше toSec (close формирующейся свечи), и проверка
        // `c.to >= toSec` не проходила НИКОГДА -> каждый пересчёт лез в сеть.
        // Аналогично слева: если история началась позже fromSec, c.from > fromSec.
        if (c && (now - c.at) < this.constructor.CACHE_TTL_MS &&
            c.fromReq <= fromSec && c.toReq >= toSec) {
            return c.bars;      // кэш покрывает нужный диапазон — без сети
        }

        const all = [];
        let cursorMs = toSec * 1000;
        const minMs = fromSec * 1000;

        for (let page = 0; page < this.constructor.MAX_PAGES; page++) {
            const batch = await this._fetchKlines(
                cm.currentSymbol, cm.currentExchange, cm.currentMarketType,
                this.constructor.BASE_TF, this.constructor.PAGE_SIZE, cursorMs
            );
            if (!batch || batch.length === 0) break;

            all.unshift(...batch);                       // batch по возрастанию времени
            const oldest = batch[0].time * 1000;
            if (oldest <= minMs) break;                  // диапазон покрыт
            if (batch.length < this.constructor.PAGE_SIZE) break;   // история кончилась
            cursorMs = oldest - 1;
        }

        if (!all.length) return c ? c.bars : [];         // сеть недоступна — берём старый кэш

        // дедупликация и сортировка (страницы могли пересечься)
        const seen = new Map();
        for (const b of all) {
            if (b && isFinite(b.time) && isFinite(b.volume)) seen.set(b.time, b.volume);
        }
        const bars = [...seen.keys()].sort((a, b) => a - b)
            .map(t => ({ time: t, volume: seen.get(t) }));

        this._baseCache = {
            from: bars.length ? bars[0].time : 0,
            to: bars.length ? bars[bars.length - 1].time : 0,
            fromReq: fromSec,      // что реально запрашивали — для проверки покрытия
            toReq: toSec,
            bars, at: Date.now()
        };
        return bars;
    }

    /**
     * [VOL24-FIX] Для ТФ >= 1d: сумма дневных объёмов, попадающих в каждую свечу
     * главного графика. Работает одинаково для 1d, 1w и 1M.
     *
     * Раньше на 1d рисовался объём КАЛЕНДАРНОГО дня, но ПОСЛЕДНЯЯ свеча
     * перезаписывалась скользящим 24h из отдельного запроса 5m — то есть последний
     * столбик означал одно, а все остальные другое.
     */
    async _calcAggregated(cm, chartData) {
        const DAY = this.constructor.DAY_SEC;
        const spanDays = Math.ceil((chartData[chartData.length - 1].time - chartData[0].time) / DAY);
        const daysNeeded = Math.min(1000, Math.max(60, spanDays + 40));

        const dailyBars = await this._fetchKlines(
            cm.currentSymbol, cm.currentExchange, cm.currentMarketType, '1d', daysNeeded
        );
        if (!dailyBars || dailyBars.length === 0) return;

        const sums = new Float64Array(chartData.length);
        const has = new Uint8Array(chartData.length);

        for (const b of dailyBars) {
            if (!b || !isFinite(b.time)) continue;
            const i = this._findBucketIndex(chartData, b.time);
            if (i < 0) continue;
            sums[i] += b.volume || 0;
            has[i] = 1;
        }

        const data = [];
        for (let i = 0; i < chartData.length; i++) {
            // свеча, на которую не пришлось ни одного дневного бара, не рисуется
            // (раньше рисовался 0 — выглядело как «объёма не было»)
            if (!has[i]) continue;
            data.push({ time: chartData[i].time, value: sums[i] });
        }
        this._applySeriesData(data);
    }

    /** Индекс свечи, в которую попадает момент t: наибольший i с chartData[i].time <= t */
    _findBucketIndex(chartData, t) {
        let lo = 0, hi = chartData.length - 1, res = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (chartData[mid].time <= t) { res = mid; lo = mid + 1; }
            else hi = mid - 1;
        }
        return res;
    }

    /** Единая точка применения данных: серия + кэши для тултипа */
    _applySeriesData(data) {
        if (!this.series || !this.series[0]) return;
        this.series[0].setData(data);
        this._volumeData = data.filter(d => d.value > 0);
        this._volumeMap = new Map(data.map(d => [d.time, d.value]));
    }

    /* ========================= сеть ========================= */

    /**
     * @param {number} [endMs] [VOL24-FIX] граница «до» для дозагрузки страницами.
     *   Binance: &endTime=, Bybit v5: &end= (отдаёт по убыванию, разворачиваем).
     */
    async _fetchKlines(symbol, exchange, marketType, tf, limit, endMs = null) {
        const bybitMap = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D', '1w': 'W' };
        const end = (endMs && isFinite(endMs)) ? Math.floor(endMs) : null;
        let url;
        if (exchange === 'binance') {
            const base = marketType === 'futures' ? 'https://fapi.binance.com/fapi/v1/klines' : 'https://api.binance.com/api/v3/klines';
            url = `${base}?symbol=${symbol}&interval=${tf}&limit=${limit}`;
            if (end) url += `&endTime=${end}`;
        } else {
            const category = marketType === 'futures' ? 'linear' : 'spot';
            url = `https://api.bybit.com/v5/market/kline?category=${category}&symbol=${symbol}&interval=${bybitMap[tf] || tf}&limit=${limit}`;
            if (end) url += `&end=${end}`;
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

    /* ========================= ТУЛТИП ========================= */

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
            // [VOL24-FIX] для свечи без корректного 24h-значения тултип прячем,
            // а не показываем устаревшее число с прошлой свечи
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

    /* ========================= диагностика ========================= */

    /** В консоли браузера: __vol24hDebug() */
    _debugDump() {
        const cm = this.manager?.chartManager;
        const data = (cm && cm.chartData) || [];
        const iv = cm && cm.currentInterval;
        const ivSec = this.constructor.INTERVAL_SECONDS[iv];
        const c = this._baseCache;
        const shown = this._volumeData.length;
        const out = {
            'свечей на графике': data.length,
            'таймфрейм': iv,
            'секунд в баре': ivSec || '—',
            'режим': (!ivSec || ivSec >= this.constructor.DAY_SEC) ? 'агрегация дневных' : 'скользящие 24h',
            'диапазон графика': data.length
                ? (new Date(data[0].time * 1000).toISOString().slice(0, 16) + ' … ' +
                   new Date(data[data.length - 1].time * 1000).toISOString().slice(0, 16))
                : '—',
            'базы 5m загружено': c ? c.bars.length : 0,
            'база покрывает': c && c.bars.length
                ? ((c.to - c.from) / 3600).toFixed(1) + ' ч'
                : '—',
            'полных 24h-окон': this._baseVolumes.filter(r => r.valid).length,
            'нарисовано столбиков': shown,
            'свечей без значения': Math.max(0, data.length - shown),
            'последнее значение': shown ? this._fmt(this._volumeData[shown - 1].value) : '—',
            'серия': !!(this.series && this.series[0]),
            'тултип': !!this._tooltipEl
        };
        try { console.table(out); } catch (e) { console.log(out); }
        return out;
    }

    destroy() {
        if (this._updateInterval) clearInterval(this._updateInterval);
        if (this._pendingTimer) clearTimeout(this._pendingTimer);
        if (this._crosshairTimer) clearTimeout(this._crosshairTimer);
        if (this._tfTimer) { clearInterval(this._tfTimer); this._tfTimer = null; }   // [VOL24-FIX]
        this._baseCache = null;
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
    static meta = { name: 'SMA 20', category: 'trend', panel: 'main', color: '#FFD700', multiple: true };   // [VP-MA]

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
    static meta = { name: 'SMA 50', category: 'trend', panel: 'main', color: '#FF69B4', multiple: true };   // [VP-MA]
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
// [VP-STABLE] Ключевое требование — профиль НЕ должен «скакать»:
//   1. авто-подбор числа баров убран: на каждый таймфрейм bars/rows задаются
//      явно (вкладка настроек под каждый ТФ) и не меняются сами;
//   2. профиль привязан к ВРЕМЕНИ, а не к индексу свечи: при подгрузке истории
//      во время скролла все логические индексы съезжают, и привязка к индексу
//      телепортировала гистограмму. Теперь координата якоря каждый кадр
//      пересчитывается из сохранённого времени;
//   3. пересчёт запускается только по осмысленным событиям (смена ТФ/символа/
//      настроек, закрытие свечи) — НЕ на каждый тик и НЕ на подгрузку истории.
//      Скролл и зум пересчёт не вызывают вообще, только перерисовку.
// =============================================================================
class VolumeProfileIndicator extends BaseIndicator {
    // ключ localStorage и дефолты — в static-полях класса: Indicators.js обычный
    // скрипт, top-level const попал бы в глобальную область с риском конфликта имён.
    static STORAGE_KEY = 'volumeprofile_settings';
    // Версия схемы настроек. При несовпадении поля, чей ДЕФОЛТ изменился,
    // сбрасываются к новому дефолту — иначе значение из localStorage прежней
    // сборки перекроет его (v2: расположение профиля по умолчанию стало «слева»).
    static SETTINGS_VERSION = 7;

    // Секунды в баре — только для подписи «≈ N суток» во вкладках настроек.
    static INTERVAL_SECONDS = {
        '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
        '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200,
        '1d': 86400, '1w': 604800, '1M': 2592000
    };

    // Порядок вкладок в настройках
    static TF_ORDER = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w', '1M'];

    /**
     * Рекомендуемые bars/rows под каждый таймфрейм.
     * Логика: скальпинг — 1 сутки и много рядов; интрадей — 1 неделя;
     * свинг — 1 месяц и меньше рядов. Все значения помещаются в лимит 5000 баров.
     */
    static PER_TF_DEFAULTS = {
        '1m':  { bars: 1440, rows: 60 },   // 1 сутки
        '3m':  { bars: 1440, rows: 60 },   // 3 суток
        '5m':  { bars: 2016, rows: 60 },   // 7 суток
        '15m': { bars: 672,  rows: 48 },   // 7 суток
        '30m': { bars: 336,  rows: 48 },   // 7 суток
        '1h':  { bars: 168,  rows: 48 },   // 7 суток
        '2h':  { bars: 168,  rows: 48 },   // 14 суток
        '4h':  { bars: 180,  rows: 36 },   // 30 суток
        '6h':  { bars: 120,  rows: 36 },   // 30 суток
        '12h': { bars: 60,   rows: 36 },   // 30 суток
        '1d':  { bars: 90,   rows: 24 },   // 3 месяца
        '1w':  { bars: 104,  rows: 24 },   // 2 года
        '1M':  { bars: 120,  rows: 24 }    // 10 лет
    };

    static DEFAULTS = {
        // [VP-STABLE] авто-режима больше нет: bars/rows берутся из perTF[текущий ТФ]
        perTF: null,             // заполняется в конструкторе из PER_TF_DEFAULTS
        fallbackBars: 168,       // если текущий ТФ неизвестен
        fallbackRows: 48,

        // [VP-STABLE] когда пересчитывать профиль:
        //   'bar'    — только когда закрылась свеча (дефолт: стабильно, не скачет)
        //   'tick'   — на каждое изменение цены/объёма (живой, но дрожит)
        //   'manual' — только по смене ТФ/символа/настроек и кнопкой
        refreshMode: 'bar',

        percent: 70,             // Value Area Volume % — стандарт Market Profile

        pocColor: '#FF0000',
        pocWidth: 2,
        showPoc: true,

        vaUpColor: '#2196F3',
        vaDownColor: '#FF9800',
        vaAlpha: 0.70,

        upColor: '#2196F3',
        downColor: '#FF9800',
        bodyAlpha: 0.25,

        widthDivisor: 3,         // максимальная длина ряда = bars / widthDivisor свечей
        // [VP-FIT] Потолок ширины ряда в CSS-пикселях. Без него на коротких ТФ
        // (5m: 2016 баров / 3 = 672 свечи ≈ 16 800 px) гистограмма уезжала за
        // экран. 0 = не ограничивать в px, брать долю видимой ширины (maxWidthRatio).
        maxWidthPx: 320,
        // [VP-FIT] Доля видимой ширины панели, которую может занять гистограмма
        // (0..0.6). Работает только при maxWidthPx = 0.
        maxWidthRatio: 0.25,
        gapDivisor: 500,         // зазор между рядами = (top - bot) / gapDivisor
        showVaLines: true,       // линии и метки VAH / VAL
        vaLineColor: '#FFFFFF',
        extendPocRight: true,
        // [VP-PLACE] Расположение профиля (в TradingView — «Profile Placement»):
        //   false = СЛЕВА  — гистограмма растёт ВПРАВО от первой свечи диапазона.
        //                    Это поведение оригинального скрипта и дефолт TradingView.
        //   true  = СПРАВА — растёт ВЛЕВО от последней свечи, профиль прижат к
        //                    текущей цене (удобно, но перекрывает последние свечи).
        anchorRight: false,
        // [VP-TV] Расположение гистограммы (заменяет anchorRight, он оставлен
        // для совместимости со старыми сохранениями):
        //   'screenLeft' — ПРИЖАТ к левому краю видимой области графика и растёт
        //                   вправо: не зависит от скролла/зума, виден всегда
        //                   (аналог «Volume Profile Visible Range» в TradingView).
        //                   ДЕФОЛТ.
        //   'left'       — от ПЕРВОЙ свечи диапазона вправо (оригинальный скрипт
        //                   LonesomeTheBlue). На коротких ТФ уезжает далеко влево.
        //   'right'      — от ПОСЛЕДНЕЙ свечи влево, профиль у текущей цены.
        placement: 'screenLeft',
        // [VP-VOL] Подписи объёма на гистограмме ('none' | 'poc' | 'va' | 'all').
        // Шрифт подписи сам уменьшается под высоту ряда (10 -> 9 -> 8 px),
        // ряды тоньше volumeMinHeight пропускаются (счётчик — в __vpDebug()).
        showVolume: 'va',
        volumeMinHeight: 8,      // px: минимальная высота ряда для подписи
        volumeColor: '#FFFFFF',
    };

    // meta обязателен: IndicatorFactory.getIndicatorsList() строит меню по нему
    static meta = { name: 'Volume Profile', category: 'volatility', panel: 'main', color: '#2196F3' };

    constructor(manager) {
        super(manager, 'volumeprofile', 'Volume Profile', '#2196F3', 'main');

        const saved = this._loadSettings();
        // миграция: сохранение от прошлой версии схемы не должно перекрывать
        // новые дефолты (в v1 anchorRight=true, в v2 — false/«слева»)
        if (saved && saved.__v !== this.constructor.SETTINGS_VERSION) {
            // v2 -> v3: появились maxWidthPx / maxWidthRatio. В старом сохранении
            // их нет, и _clampFloat(undefined) дал бы 0 (= «без ограничения в px»),
            // поэтому явно оставляем новые дефолты.
            delete saved.maxWidthPx;
            delete saved.maxWidthRatio;
            if (Number(saved.__v) < 2) delete saved.anchorRight;
        }
        // [VP-TV] До v6 в UI не существовало ни placement, ни showVolume, поэтому
        // ЛЮБОЕ старое сохранение (включая булев anchorRight) не должно перекрывать
        // новые дефолты — иначе после установки патча «ничего не меняется».
        // Осознанный выбор пользователя сохраняется только начиная с v6.
        if (saved && Number(saved.__v) < 6) {
            delete saved.placement;
            delete saved.anchorRight;
            delete saved.showVolume;
        }
        this.settings = Object.assign({}, this.constructor.DEFAULTS, this.settings, saved);
        this.settings.placement = this._normPlacement(this.settings.placement);
        this.settings.color = this.settings.color || this.constructor.DEFAULTS.upColor;
        this.settings.__v = this.constructor.SETTINGS_VERSION;

        // perTF всегда должен быть полным: дополняем сохранённое дефолтами,
        // иначе после обновления списка ТФ новых вкладок не будет
        this.settings.perTF = this._mergePerTF(this.settings.perTF);

        this._profile = null;
        this._settingsSig = '';
        this._primitive = null;
        this._attachedSeries = null;
        this._requestUpdate = null;
        this._attachTimeout = null;
        this._recomputeTimeout = null;
        this._fallbackTimer = null;
        this._colorCache = new Map();
        this._destroyed = false;
        this._initialized = true;

        // [VP-STABLE] состояние наблюдателя: что именно уже видели
        this._seen = { tf: null, symbol: null, sig: null, barTime: null };
        // счётчик подгрузок истории — нужен только для диагностики
        this._recomputeReasons = {};

        this.metrics = {
            poc: null, vah: null, val: null,
            pocRow: -1, vaHighRow: -1, vaLowRow: -1,
            totalVolume: 0, vaVolume: 0, vaPercentActual: 0,
            rangeHigh: null, rangeLow: null, rows: 0, bars: 0,
            tf: null, refreshMode: 'bar',
            firstTime: null, lastTime: null,
            isValid: false
        };

        this._initTabsHelper();
        this._setupListeners();
        this._attach();

        try {
            if (typeof window !== 'undefined') window.__vpDebug = () => this._debugDump();
            if (typeof window !== 'undefined') window.__vpStatus = () => this._lastDraw;
        } catch (e) {}

        setTimeout(() => { this.recompute('init'); }, 600);
    }

    /* ------------------------- видимость ------------------------- */

    get visible() { return this._visible !== false; }

    set visible(value) {
        this._visible = !!value;
        // guard: сеттер вызывается из конструктора BaseIndicator, когда
        // _primitive ещё не существует
        if (this._initialized && this._primitive && this._primitive.requestRedraw) {
            try { this._primitive.requestRedraw(); } catch (e) {}
        }
    }

    /* ------------------------- интеграция ------------------------- */

    getWorkerType() { return null; }
    calculateAsync() {}
    onCalculateResult() {}

    // Примитив рисуется поверх серии, отдельные series не нужны.
    // ВАЖНО: IndicatorManager.addIndicator() требует truthy-возврат.
    createSeries() {
        this.series = [];
        return this.series;
    }

    _createEmptySeries() { this.series = []; }

    updateSeriesData() { /* пересчёт решает наблюдатель, а не worker */ }

    /**
     * BaseIndicator.updateSettings() после применения настроек дёргает
     * calculateAsync(), а он у нас no-op. Без переопределения программный вызов
     * updateSettings() не пересчитал бы профиль сразу.
     */
    updateSettings(newSettings) {
        super.updateSettings(newSettings);
        if (newSettings && newSettings.perTF) {
            this.settings.perTF = this._mergePerTF(this.settings.perTF);
        }
        this._sanitizeSettings();
        this._colorCache.clear();
        this.recompute('settings');
    }

    /* ------------------------- настройки ------------------------- */

    _loadSettings() {
        try {
            const raw = localStorage.getItem(this.constructor.STORAGE_KEY);
            return raw ? (JSON.parse(raw) || {}) : {};
        } catch (e) { return {}; }
    }

    _saveSettings() {
        try {
            localStorage.setItem(this.constructor.STORAGE_KEY, JSON.stringify(this.settings));
        } catch (e) {}
    }

    /** perTF всегда полный: сохранённые значения поверх рекомендованных дефолтов */
    _mergePerTF(saved) {
        const D = this.constructor.PER_TF_DEFAULTS;
        const out = {};
        for (const tf of Object.keys(D)) {
            const src = (saved && saved[tf]) || {};
            out[tf] = {
                bars: this._clampInt(src.bars, D[tf].bars, 1, 5000),
                rows: this._clampInt(src.rows, D[tf].rows, 5, 100)
            };
        }
        return out;
    }

    /**
     * «Пустое» значение — то, из которого нельзя понять намерение пользователя.
     * null и '' входят сюда, потому что Number(null) === 0 и Number('') === 0 —
     * без этой проверки cnum:null дал бы МИНИМУМ вместо дефолта.
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

    _sanitizeSettings() {
        const s = this.settings;
        const D = this.constructor.DEFAULTS;
        s.perTF = this._mergePerTF(s.perTF);
        s.fallbackBars = this._clampInt(s.fallbackBars, D.fallbackBars, 1, 5000);
        s.fallbackRows = this._clampInt(s.fallbackRows, D.fallbackRows, 5, 100);
        s.refreshMode = ['bar', 'tick', 'manual'].includes(s.refreshMode) ? s.refreshMode : 'bar';
        s.percent = this._clampFloat(s.percent, D.percent, 0, 100);
        s.widthDivisor = this._clampFloat(s.widthDivisor, D.widthDivisor, 0.5, 20);
        s.gapDivisor = this._clampFloat(s.gapDivisor, D.gapDivisor, 50, 100000);
        s.maxWidthPx = this._clampFloat(s.maxWidthPx, D.maxWidthPx, 0, 5000);
        s.maxWidthRatio = this._clampFloat(s.maxWidthRatio, D.maxWidthRatio, 0, 0.6);
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
        s.placement = this._normPlacement(s.placement);
        s.anchorRight = (s.placement === 'right');
        s.showVolume = ['none', 'poc', 'va', 'all'].includes(s.showVolume) ? s.showVolume : 'va';
        s.volumeMinHeight = this._clampFloat(s.volumeMinHeight, D.volumeMinHeight, 0, 100);
        s.volumeColor = this._normHex(s.volumeColor, D.volumeColor);
        return s;
    }

    /** Нормализованный ключ текущего таймфрейма ('60' -> '1h', '1M' остаётся месяцем) */
    _tfKey() {
        const cm = this.manager && this.manager.chartManager;
        const raw = cm && cm.currentInterval;
        if (!raw) return '1h';
        const s = String(raw).trim();
        if (s === '1M' || s === 'M' || s.toLowerCase() === 'month') return '1M';
        const i = s.toLowerCase();
        const map = {
            '1': '1m', '1m': '1m', 'm1': '1m',
            '3': '3m', '3m': '3m',
            '5': '5m', '5m': '5m',
            '15': '15m', '15m': '15m',
            '30': '30m', '30m': '30m',
            '60': '1h', '1h': '1h', 'h1': '1h',
            '120': '2h', '2h': '2h',
            '240': '4h', '4h': '4h',
            '360': '6h', '6h': '6h',
            '720': '12h', '12h': '12h',
            '1d': '1d', 'd': '1d', 'day': '1d',
            '1w': '1w', 'w': '1w', 'week': '1w'
        };
        return map[i] || null;
    }

    /** [VP-TV] Нормализация расположения: строка важнее устаревшего булева флага */
    _normPlacement(v) {
        if (['left', 'right', 'screenLeft'].includes(v)) return v;
        return this.settings && this.settings.anchorRight ? 'right' : 'left';
    }

    /** [VP-TV] Текущее расположение (строка). anchorRight оставлен для совместимости. */
    _placement() {
        return this._normPlacement(this.settings.placement);
    }

    /** bars/rows для текущего таймфрейма (из perTF, иначе fallback) */
    _tfSettings() {
        const key = this._tfKey();
        const s = this.settings;
        const per = key && s.perTF ? s.perTF[key] : null;
        if (per) {
            return {
                key: key,
                bars: this._clampInt(per.bars, s.fallbackBars, 1, 5000),
                rows: this._clampInt(per.rows, s.fallbackRows, 5, 100)
            };
        }
        return {
            key: key,
            bars: this._clampInt(s.fallbackBars, this.constructor.DEFAULTS.fallbackBars, 1, 5000),
            rows: this._clampInt(s.fallbackRows, this.constructor.DEFAULTS.fallbackRows, 5, 100)
        };
    }

    _settingsSignature() {
        const s = this.settings;
        // ТФ входит в сигнатуру: bars/rows теперь зависят от таймфрейма
        const tf = this._tfSettings();
        return [tf.key, tf.bars, tf.rows, s.refreshMode, s.percent,
            s.widthDivisor, s.gapDivisor, s.pocColor, s.pocWidth, s.showPoc,
            s.vaUpColor, s.vaDownColor, s.vaAlpha, s.upColor, s.downColor, s.bodyAlpha,
            s.showVaLines, s.vaLineColor, s.extendPocRight, this._placement(),
            s.showVolume, s.volumeMinHeight, s.volumeColor].join('|');
    }

    /* ------------------------- расчёт профиля ------------------------- */

    /**
     * Распределяет объём ценового отрезка [pFrom, pTo] по рядам.
     * volPerPrice — объём на единицу цены; суммарно по рядам добавится ровно
     * volPerPrice * (pTo - pFrom), то есть объём сохраняется.
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
     * Полный пересчёт профиля.
     * @param {Array} data        свечи
     * @param {Object} [options]  { bars, rows, percent } — явные переопределения
     *                            (для вызова извне и из тестов)
     */
    computeProfile(data, options) {
        const opt = options || {};
        const tf = this._tfSettings();
        const barsReq = this._clampInt(opt.bbars !== undefined ? opt.bbars : opt.bars, tf.bars, 1, 5000);
        const rows = this._clampInt(opt.cnum !== undefined ? opt.cnum : opt.rows, tf.rows, 5, 100);
        const percent = this._clampFloat(opt.percent !== undefined ? opt.percent : this.settings.percent,
            this.constructor.DEFAULTS.percent, 0, 100);

        if (!Array.isArray(data) || data.length < 2) return null;

        const bars = Math.max(1, Math.min(barsReq, data.length));
        const start = data.length - bars;

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
                // h == l == o == c: весь объём в один ряд
                // (в оригинальном скрипте здесь возникал 0/0 -> na и «отравлял» ряд)
                let x = Math.floor((cl - bot) / step);
                if (x < 0) x = 0;
                if (x >= rows) x = rows - 1;
                if (green) up[x] += v; else dn[x] += v;
                continue;
            }

            const bodyVol = body * v / denom;
            const twVol = 2 * topWick * v / denom;
            const bwVol = 2 * botWick * v / denom;

            if (body > 0 && bodyVol > 0) {
                this._distribute(bodyBot, bodyTop, bodyVol / body, green ? up : dn, bot, step, rows);
            }
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

        const total = new Float64Array(rows);
        let sum = 0, maxVol = 0, pocRow = 0;
        for (let x = 0; x < rows; x++) {
            const t = up[x] + dn[x];
            total[x] = t;
            sum += t;
            if (t > maxVol) { maxVol = t; pocRow = x; }
        }
        if (!(maxVol > 0) || !(sum > 0)) return null;

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

        return {
            rows, bars, tf: tf.key,
            // [VP-STABLE] привязка к ВРЕМЕНИ, а не к индексу
            firstTime: data[start] ? data[start].time : null,
            lastTime: data[data.length - 1] ? data[data.length - 1].time : null,
            firstIndexAtCalc: start,
            top, bot, step,
            up, dn, total,
            maxVol, sum,
            pocRow,
            pocPrice: bot + step * (pocRow + 0.5),
            vaHighRow, vaLowRow,
            vah: bot + step * (vaHighRow + 1),
            val: bot + step * vaLowRow,
            vaTotal, vaTarget,
            vaPercentActual: sum > 0 ? (vaTotal / sum) * 100 : 0,
            volumeSum
        };
    }

    recompute(reason) {
        if (this._destroyed) return;
        try {
            const cm = this.manager && this.manager.chartManager;
            const data = cm && cm.chartData;
            const p = this.computeProfile(data);
            this._profile = p;

            const tf = this._tfSettings();
            if (p) {
                this.metrics = {
                    poc: p.pocPrice, vah: p.vah, val: p.val,
                    pocRow: p.pocRow, vaHighRow: p.vaHighRow, vaLowRow: p.vaLowRow,
                    totalVolume: p.sum, vaVolume: p.vaTotal,
                    vaPercentActual: p.vaPercentActual,
                    rangeHigh: p.top, rangeLow: p.bot,
                    rows: p.rows, bars: p.bars,
                    tf: p.tf, refreshMode: this.settings.refreshMode,
                    firstTime: p.firstTime, lastTime: p.lastTime,
                    isValid: true
                };
            } else {
                this.metrics = {
                    poc: null, vah: null, val: null, pocRow: -1, vaHighRow: -1, vaLowRow: -1,
                    totalVolume: 0, vaVolume: 0, vaPercentActual: 0,
                    rangeHigh: null, rangeLow: null, rows: 0, bars: 0,
                    tf: tf.key, refreshMode: this.settings.refreshMode,
                    firstTime: null, lastTime: null, isValid: false
                };
            }

            this._settingsSig = this._settingsSignature();
            if (reason) this._recomputeReasons[reason] = (this._recomputeReasons[reason] || 0) + 1;
            this.requestRedraw();
        } catch (e) {
            console.warn('[VolumeProfile] recompute:', e);
        }
    }

    scheduleRecompute(reason) {
        if (this._destroyed || this._recomputeTimeout !== null) return;
        this._recomputeTimeout = setTimeout(() => {
            this._recomputeTimeout = null;
            this.recompute(reason || 'scheduled');
        }, 200);
    }

    /* ------------------------- наблюдатель ------------------------- */

    _setupListeners() {
        const cm = this.manager && this.manager.chartManager;
        if (!cm) return;

        if (typeof cm._subscribeToSymbolChange === 'function') {
            cm._subscribeToSymbolChange(() => {
                setTimeout(() => { this._attach(true); this.recompute('symbol'); }, 400);
            });
        }
        if (typeof cm.on === 'function') {
            cm.on('dataUpdate', () => this._onDataUpdate());
        }
        this._startWatcher();
    }

    /**
     * [VP-STABLE] Единственное место, где принимается решение о пересчёте.
     *
     * Пересчёт — ТОЛЬКО по осмысленным событиям:
     *   смена таймфрейма, смена символа, смена настроек, закрытие свечи
     *   (и то лишь в режимах 'bar'/'tick').
     *
     * Чего пересчёт НЕ делает:
     *   • скролл и зум — данные не меняются, меняется только отрисовка;
     *   • подгрузка ИСТОРИИ при скролле влево — chartData.length растёт, но
     *     время последней свечи то же. Раньше именно это и вызывало «скачок»:
     *     окно «последние N баров» съезжало, плюс логические индексы всех свечей
     *     смещались, а профиль был привязан к индексу.
     */
    _startWatcher() {
        // [VP-STABLE] проверяем на null, а не на truthy: идентификатор таймера
        // может быть равен 0, и `if (this._fallbackTimer)` завёл бы ВТОРОЙ
        // наблюдатель, а destroy() не смог бы его остановить.
        if (this._fallbackTimer !== null) return;
        this._fallbackTimer = setInterval(() => {
            if (this._destroyed) return;
            const cm = this.manager && this.manager.chartManager;
            if (!cm) return;
            const data = cm.chartData;
            if (!data || !data.length) return;

            const tf = this._tfKey();
            const sym = cm.currentSymbol || null;
            const sig = this._settingsSignature();
            const barTime = data[data.length - 1].time;
            const seen = this._seen;

            const tfChanged = seen.tf !== null && tf !== seen.tf;
            const symChanged = seen.symbol !== null && sym !== seen.symbol;
            const sigChanged = seen.sig !== null && sig !== seen.sig;
            const newBar = seen.barTime !== null && barTime !== seen.barTime;
            const first = (seen.tf === null);

            seen.tf = tf; seen.symbol = sym; seen.sig = sig; seen.barTime = barTime;

            // переприсоединяем примитив, если сменился тип графика (candle <-> bar)
            this._attach(true);

            if (first) { this.recompute('first'); return; }
            if (tfChanged) { this.recompute('timeframe'); return; }
            if (symChanged) { this.recompute('symbol'); return; }
            if (sigChanged) { this.recompute('settings'); return; }

            const mode = this.settings.refreshMode;
            if (mode === 'manual') return;                 // только перерисовка
            if (newBar) { this.recompute('newbar'); return; }
            if (mode === 'tick') { this.scheduleRecompute('tick'); return; }
            // режим 'bar': внутри свечи профиль НЕ пересчитываем — он стабильный
        }, 500);
    }

    _onDataUpdate() {
        // dataUpdate приходит на каждый тик; решение о пересчёте всё равно
        // принимает наблюдатель, поэтому здесь только дешёвая перерисовка
        this.requestRedraw();
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
            if (this._attachTimeout === null) {
                this._attachTimeout = setTimeout(() => { this._attachTimeout = null; this._attach(); }, 500);
            }
            return;
        }
        if (this._primitive && this._attachedSeries === series && !force) return;

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
            // [VP-FIX3] гистограмма рисуется ПОД свечами: индикатор больше ничего
            // не закрашивает и не перекрывает (zOrder поддержан в lightweight-charts v5)
            zOrder: () => 'bottom',
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

    /* ------------------------- отрисовка ------------------------- */

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

    /**
     * [VP-STABLE] Индекс свечи ПО ВРЕМЕНИ.
     * Хранить индекс из момента расчёта нельзя: при подгрузке истории во время
     * скролла все логические индексы смещаются, и профиль «телепортировался».
     */
    _indexByTime(data, time) {
        if (time == null || !data || !data.length) return null;
        const cm = this.manager && this.manager.chartManager;
        const map = cm && cm._candleTimeMap;
        if (map) {
            const i = map.get(time);
            if (i !== undefined && i >= 0 && i < data.length && data[i].time === time) return i;
        }
        let lo = 0, hi = data.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const t = data[mid].time;
            if (t === time) return mid;
            if (t < time) lo = mid + 1; else hi = mid - 1;
        }
        return null;
    }

    _xForIndex(timeScale, index, data) {
        if (index == null) return null;
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

        // [VP-TV] 'screenLeft' — гистограмма прижата к левому краю ВИДИМОЙ области,
        // поэтому логические индексы свечей диапазона ей не нужны: профиль остаётся
        // на месте при скролле, зуме, подгрузке истории и даже если первая свеча
        // диапазона уже выгружена из памяти (trim).
        const pinnedLeft = (this._placement() === 'screenLeft');
        this._volSkippedRows = 0;
        this._volLabelsDrawn = 0;
        this._lvlSolid = 0;
        this._lvlClamp = 0;
        this._rowsDrawn = 0;
        // [VP-STABLE] индексы пересчитываем из ВРЕМЕНИ каждый кадр
        const startIdx = pinnedLeft ? 0 : this._indexByTime(data, p.firstTime);
        if (startIdx === null) {
            // свеча диапазона исчезла (другой символ/глубокая подгрузка) —
            // профиль больше не актуален, просим пересчёт и ничего не рисуем
            this.scheduleRecompute('stale');
            return;
        }
        let lastIdx = pinnedLeft ? (data.length - 1) : this._indexByTime(data, p.lastTime);
        if (lastIdx === null) lastIdx = data.length - 1;

        const s = this.settings;
        const bs = this._barSpacing(timeScale);
        const placement = this._placement();
        const anchorRight = (placement === 'right');
        // [VP-TV] для 'screenLeft' якорь — левый край панели (x = 0), он существует
        // всегда, поэтому профиль никогда не пропадает при скролле.
        const x0 = pinnedLeft ? 0 : this._xForIndex(timeScale, anchorRight ? lastIdx + 1 : startIdx, data);
        if (x0 === null) return;

        const widthDivisor = this._clampFloat(s.widthDivisor, this.constructor.DEFAULTS.widthDivisor, 0.5, 20);
        const gapDivisor = this._clampFloat(s.gapDivisor, this.constructor.DEFAULTS.gapDivisor, 50, 100000);
        // [VP-FIT] ширина ряда в СВЕЧАХ (как в оригинальном скрипте TradingView);
        // перевод в пиксели и потолок — внутри scope, где известна ширина панели
        const maxLenBars = p.bars / widthDivisor;
        if (!(maxLenBars > 0)) return;
        const gapPrice = (p.top - p.bot) / gapDivisor;

        const priceToY = (price) => series.priceToCoordinate(price);

        target.useBitmapCoordinateSpace((scope) => {
            const ctx = scope.context;
            const hpr = scope.horizontalPixelRatio;
            const vpr = scope.verticalPixelRatio;
            const mediaW = scope.mediaSize.width;
            const mediaH = scope.mediaSize.height;

            // [VP-FIT] Потолок ширины в пикселях: на коротких ТФ bars/widthDivisor
            // даёт сотни свечей (5m: 672 свечи ≈ 16 800 px при barSpacing 25), и
            // гистограмма целиком уходила за левый край экрана. Теперь длина ряда
            // не больше maxWidthPx, а при maxWidthPx = 0 — не больше maxWidthRatio
            // от видимой ширины панели.
            let maxLenPx = maxLenBars * bs;
            const capPx = s.maxWidthPx > 0 ? s.maxWidthPx : (mediaW * s.maxWidthRatio);
            if (capPx > 0 && maxLenPx > capPx) maxLenPx = capPx;
            if (!(maxLenPx > 0)) return;

            const fillVaUp = this._rgba(s.vaUpColor, this._clampFloat(s.vaAlpha, this.constructor.DEFAULTS.vaAlpha, 0, 1));
            const fillVaDown = this._rgba(s.vaDownColor, this._clampFloat(s.vaAlpha, this.constructor.DEFAULTS.vaAlpha, 0, 1));
            const fillUp = this._rgba(s.upColor, this._clampFloat(s.bodyAlpha, this.constructor.DEFAULTS.bodyAlpha, 0, 1));
            const fillDown = this._rgba(s.downColor, this._clampFloat(s.bodyAlpha, this.constructor.DEFAULTS.bodyAlpha, 0, 1));

            const xStart = x0 * hpr;

            for (let x = 0; x < p.rows; x++) {
                const pBot = p.bot + p.step * x;
                const pTop = pBot + p.step;
                const yTop = priceToY(pTop - gapPrice);
                const yBot = priceToY(pBot + gapPrice);
                if (yTop === null || yBot === null) continue;

                const top = Math.min(yTop, yBot) * vpr;
                const height = Math.abs(yBot - yTop) * vpr;
                if (!(height > 0)) continue;
                this._rowsDrawn++;

                const inVA = x >= p.vaLowRow && x <= p.vaHighRow;
                const lenUp = (p.up[x] / p.maxVol) * maxLenPx;
                const lenDn = (p.dn[x] / p.maxVol) * maxLenPx;

                if (anchorRight) {
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

            // [VP-VOL] подписи объёма рисуем ПОСЛЕ рядов — поверх гистограммы;
            // [VP-FIX5] раскладка РАЗРЕЖЕННАЯ: сначала POC и самые объёмные ряды,
            // без перекрытий, — поэтому объём виден и на тонких рядах при любом зуме
            if (s.showVolume && s.showVolume !== 'none') {
                this._drawVolumeLabels(ctx, p, s, priceToY, gapPrice, maxLenPx, xStart, hpr, vpr, mediaW, mediaH);
            }

            if (s.showVaLines) {
                const yVah = priceToY(p.vah);
                const yVal = priceToY(p.val);
                // [VP-FIX4] линии уровней видны при ЛЮБОМ зуме: по реальной цене,
                // а когда уровень вне окна — пунктиром у края панели вместе с плашкой
                this._drawLevelLine(ctx, yVah, hpr, vpr, mediaW, mediaH, s.vaLineColor, 'top');
                this._drawLevelLine(ctx, yVal, hpr, vpr, mediaW, mediaH, s.vaLineColor, 'bottom');
                this._drawTagOrPin(ctx, 'VAH ' + this._fmt(p.vah), yVah, hpr, vpr, mediaW, mediaH, s.vaLineColor, 'top');
                this._drawTagOrPin(ctx, 'VAL ' + this._fmt(p.val), yVal, hpr, vpr, mediaW, mediaH, s.vaLineColor, 'bottom');
            }

            if (s.showPoc !== false) {
                const yPoc = priceToY(p.pocPrice);
                if (yPoc !== null) {
                    const w = this._clampInt(s.pocWidth, this.constructor.DEFAULTS.pocWidth, 1, 5);
                    const fromX = (s.extendPocRight === false && !anchorRight) ? x0 : 0;
                    this._drawHLine(ctx, yPoc, hpr, vpr, mediaW, s.pocColor, w, fromX);

                    // [VP-FIX3] плашка POC всегда на прежнем месте — у последней свечи
                    let labelX = (anchorRight ? (lastIdx - 15) : (lastIdx + 15));
                    const xLabel = this._xForIndex(timeScale, Math.max(0, labelX), data);
                    this._drawPocLabel(ctx, 'POC: ' + this._fmt(p.pocPrice),
                        xLabel !== null ? xLabel : mediaW - 10, yPoc,
                        hpr, vpr, mediaW, s.pocColor, data[data.length - 1]);
                } else {
                    // [VP-FIX4] POC вне окна: пунктирная линия у края панели + плашка
                    const lastC = data[data.length - 1];
                    const edge = (lastC && p.pocPrice > Number(lastC.close)) ? 'top' : 'bottom';
                    this._drawLevelLine(ctx, null, hpr, vpr, mediaW, mediaH, s.pocColor, edge);
                    this._drawTagOrPin(ctx, 'POC ' + this._fmt(p.pocPrice), null, hpr, vpr, mediaW, mediaH, s.pocColor, edge);
                }
            }

            // [VP-FIX5] снимок последнего кадра для быстрой диагностики:
            // консоль -> __vpStatus(). null в yVAH/yVAL/yPOC = уровень вне ценового
            // окна (тогда линия пунктиром у края, см. linesAtEdge).
            this._lastDraw = {
                when: new Date().toLocaleTimeString(),
                placement: placement,
                showVaLines: !!s.showVaLines,
                showVolume: s.showVolume,
                bars: p.bars, rows: p.rows,
                rowsOnScreen: this._rowsDrawn,
                volumeLabels: this._volLabelsDrawn,
                linesByPrice: this._lvlSolid,
                linesAtEdge: this._lvlClamp,
                yVAH: priceToY(p.vah), yVAL: priceToY(p.val), yPOC: priceToY(p.pocPrice),
                paneW: mediaW, paneH: mediaH
            };
        });
    }

    /**
     * [VP-VOL] Подпись объёма ряда. Текст кладётся ВНУТРЬ гистограммы у её левого
     * края (там ряд самый плотный) с тёмным контуром — читается и на синих, и на
     * оранжевых рядах. Размер шрифта подбирается под высоту ряда; если подпись не
     * влезает в длину ряда — не рисуем.
     */
    _drawVolumeLabel(ctx, text, xStartBitmap, yTopBitmap, rowLenBitmap, rowHBitmap,
                     color, isPoc, hpr, vpr, mediaW) {
        if (!text) return;
        const fontSize = rowHBitmap >= 13 * vpr ? 10 : (rowHBitmap >= 10 * vpr ? 9 : 8);
        const padX = 2 * hpr;
        // оценку ширины берём с запасом (_measure считает по 11px, факт — 8..10px),
        // зато подпись гарантированно не вылезает за конец ряда
        const textW = this._measure(ctx, text).w * (fontSize / 11) * hpr + padX * 2;
        if (rowLenBitmap < textW) return;          // ряд короче подписи
        const x = xStartBitmap + padX;
        if (x + textW > mediaW * hpr) return;      // не вылезать за правый край панели
        const y = yTopBitmap + rowHBitmap / 2;
        ctx.save();
        ctx.font = (isPoc ? 'bold ' : '') + fontSize + 'px "JetBrains Mono", monospace';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, 2.5 * vpr);
        ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.strokeText(text, x, y);
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    /**
     * [VP-VOL] Компактный объём: тот же формат, что у Utils.formatVolume (K/M/B),
     * но пороги >= и без его округления (Utils.formatVolume(999.9) дал бы '1000').
     */
    _fmtVolume(v) {
        if (!isFinite(v) || v <= 0) return '';
        if (v >= 1e12) return (v / 1e12).toFixed(2) + 'T';
        if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
        if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
        if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
        // 999.9 не должно превращаться в '1000' — округление до следующего порядка
        if (v >= 100) {
            const r = v.toFixed(0);
            return r === '1000' ? (v / 1e3).toFixed(1) + 'K' : r;
        }
        return v >= 1 ? v.toFixed(1) : v.toFixed(2);
    }

    /**
     * [VP-FIX5] Подписи объёма с разряженной раскладкой: кандидаты сортируются
     * (POC первым, затем по убыванию объёма) и ставятся только туда, где не
     * перекроют уже поставленную подпись. Тонкие ряды больше не съедают объём:
     * при ряду тоньше шрифта подписи просто расставляются реже.
     */
    _drawVolumeLabels(ctx, p, s, priceToY, gapPrice, maxLenPx, xStart, hpr, vpr, mediaW, mediaH) {
        const volColor = s.volumeColor || '#FFFFFF';
        const cands = [];
        for (let x = 0; x < p.rows; x++) {
            const vol = p.total[x];
            if (!(vol > 0)) continue;
            const inVA = x >= p.vaLowRow && x <= p.vaHighRow;
            const isPoc = (x === p.pocRow);
            if (s.showVolume === 'poc' && !isPoc) continue;
            if (s.showVolume === 'va' && !inVA && !isPoc) continue;
            const pBot = p.bot + p.step * x;
            const pTop = pBot + p.step;
            const yTop = priceToY(pTop - gapPrice);
            const yBot = priceToY(pBot + gapPrice);
            if (yTop === null || yBot === null) { this._volSkippedRows++; continue; }
            const yMin = Math.min(yTop, yBot), rowH = Math.abs(yBot - yTop);
            if (rowH < 2) { this._volSkippedRows++; continue; }
            const lenRow = ((p.up[x] + p.dn[x]) / p.maxVol) * maxLenPx;
            if (!(lenRow > 4)) continue;
            cands.push({ vol, yMin, rowH, lenRow, isPoc });
        }
        cands.sort((a, b) => (b.isPoc - a.isPoc) || (b.vol - a.vol));
        const placed = [];
        let drawn = 0;
        for (const c of cands) {
            const fs2 = c.rowH >= 13 * vpr ? 10 : (c.rowH >= 10 * vpr ? 9 : 8);
            const h = fs2 + 2;
            const yC = c.yMin + c.rowH / 2;
            const top = yC - h / 2, bot = yC + h / 2;
            if (top < 0 || bot > mediaH) continue;
            let busy = false;
            for (const q of placed) {
                if (top < q.bot + 2 && bot > q.top - 2) { busy = true; break; }
            }
            if (busy) continue;
            placed.push({ top, bot });
            this._drawVolumeLabel(ctx, this._fmtVolume(c.vol), xStart, top * vpr,
                c.lenRow * hpr, h * vpr, volColor, c.isPoc, hpr, vpr, mediaW);
            drawn++;
        }
        this._volLabelsDrawn = drawn;
    }

    /**
     * [VP-FIX4] Линия уровня: сплошная по цене, если уровень в видимом ценовом окне;
     * иначе пунктирная у верхнего/нижнего края панели — линия есть при любом зуме.
     */
    _drawLevelLine(ctx, yMedia, hpr, vpr, mediaW, mediaH, color, edge) {
        let y = yMedia;
        let dashed = false;
        if (y === null || y === undefined || !isFinite(y)) {
            y = (edge === 'top') ? 1 : mediaH - 1;
            dashed = true;
        } else if (y < 0) {
            y = 1;
            dashed = true;
        } else if (y > mediaH) {
            y = mediaH - 1;
            dashed = true;
        }
        if (dashed) this._lvlClamp++; else this._lvlSolid++;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, 1 * vpr);
        if (dashed && ctx.setLineDash) ctx.setLineDash([6 * hpr, 4 * hpr]);
        ctx.beginPath();
        ctx.moveTo(0, y * vpr);
        ctx.lineTo(mediaW * hpr, y * vpr);
        ctx.stroke();
        ctx.restore();
    }

    /**
     * [VP-FIX3] Плашка уровня: если уровень в видимом ценовом окне — рисуется по его
     * цене (как раньше); если вне окна — прижимается к краю панели со стрелкой
     * (вверх = уровень выше экрана, вниз = ниже), поэтому VAH/VAL видны всегда.
     */
    _drawTagOrPin(ctx, text, yMedia, hpr, vpr, mediaW, mediaH, color, edge) {
        if (yMedia !== null && isFinite(yMedia) && yMedia >= 0 && yMedia <= mediaH) {
            this._drawTag(ctx, text, yMedia, hpr, vpr, mediaW, color);
            return;
        }
        const m = this._measure(ctx, text);
        const padX = 5, padY = 3;
        const w = (m.w + padX * 2) * hpr;
        const h = (m.h + padY) * vpr;
        const x = mediaW * hpr - w - 2 * hpr;
        const y = (edge === 'top') ? 2 * vpr : (mediaH * vpr - h - 2 * vpr);
        ctx.save();
        ctx.fillStyle = this._rgba(color, 0.55);
        ctx.fillRect(x, y, w, h);
        // стрелка слева от плашки: куда находится сам уровень
        const ax = x - 10 * hpr;
        ctx.beginPath();
        if (edge === 'top') {
            ctx.moveTo(ax, y + h - 2 * vpr);
            ctx.lineTo(ax + 8 * hpr, y + h - 2 * vpr);
            ctx.lineTo(ax + 4 * hpr, y + 2 * vpr);
        } else {
            ctx.moveTo(ax, y + 2 * vpr);
            ctx.lineTo(ax + 8 * hpr, y + 2 * vpr);
            ctx.lineTo(ax + 4 * hpr, y + h - 2 * vpr);
        }
        ctx.closePath();
        ctx.fillStyle = this._rgba(color, 0.9);
        ctx.fill();
        ctx.fillStyle = '#000000';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + padX * hpr, y + h / 2);
        ctx.restore();
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

    _measure(ctx, text) {
        ctx.save();
        ctx.font = '11px "JetBrains Mono", monospace';
        const w = ctx.measureText(text).width;
        ctx.restore();
        return { w: w, h: 15 };
    }

    _drawTag(ctx, text, yMedia, hpr, vpr, mediaW, color) {
        if (yMedia === null || !isFinite(yMedia)) return;
        const m = this._measure(ctx, text);
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
        const m = this._measure(ctx, text);
        const padX = 6, padY = 4;
        const w = (m.w + padX * 2) * hpr;
        const h = (m.h + padY * 2) * vpr;

        let x = xMedia * hpr;
        if (x + w > mediaW * hpr - 2 * hpr) x = mediaW * hpr - w - 2 * hpr;
        if (x < 2 * hpr) x = 2 * hpr;

        const above = lastCandle && isFinite(Number(lastCandle.close)) &&
            Number(lastCandle.close) >= this._profile.pocPrice;
        const tail = 6 * vpr;
        const y = above ? (yMedia * vpr - h - tail) : (yMedia * vpr + tail);

        ctx.save();
        ctx.fillStyle = color;
        ctx.beginPath();
        const r = 3 * vpr;
        const cx = x + w / 2;
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
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

    /* ------------------------- вкладки настроек ------------------------- */

    _initTabsHelper() {
        try {
            if (typeof window === 'undefined' || window.__vpTab) return;
            window.__vpTab = function (id) {
                const panes = document.querySelectorAll('[id^="vp_tab_"]');
                for (let i = 0; i < panes.length; i++) panes[i].style.display = 'none';
                const btns = document.querySelectorAll('[id^="vp_tabbtn_"]');
                for (let i = 0; i < btns.length; i++) {
                    btns[i].style.background = '#1E1E1E';
                    btns[i].style.color = '#B0B0B0';
                    btns[i].style.borderColor = '#404040';
                }
                const pane = document.getElementById('vp_tab_' + id);
                if (pane) pane.style.display = 'block';
                const btn = document.getElementById('vp_tabbtn_' + id);
                if (btn) {
                    btn.style.background = '#2196F3';
                    btn.style.color = '#FFFFFF';
                    btn.style.borderColor = '#2196F3';
                }
            };
        } catch (e) {}
    }

    _daysLabel(tf, bars) {
        const sec = this.constructor.INTERVAL_SECONDS[tf];
        if (!sec) return '';
        const days = (bars * sec) / 86400;
        if (days < 1) {
            const hours = (bars * sec) / 3600;
            return '≈ ' + (hours < 1 ? (hours * 60).toFixed(0) + ' мин' : hours.toFixed(1) + ' ч');
        }
        if (days < 60) return '≈ ' + (days % 1 === 0 ? days.toFixed(0) : days.toFixed(1)) + ' сут';
        if (days < 730) return '≈ ' + (days / 30).toFixed(1) + ' мес';
        return '≈ ' + (days / 365).toFixed(1) + ' лет';
    }

    getSettingsHTML() {
        const s = this.settings;
        const D = this.constructor.DEFAULTS;
        const PD = this.constructor.PER_TF_DEFAULTS;
        const TF = this.constructor.TF_ORDER;

        const rowStyle = 'background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px;';
        const numStyle = rowStyle + ' width:90px;';
        const labelStyle = 'color:#B0B0B0; width:150px;';
        const rowDiv = 'margin-bottom:8px; display:flex; align-items:center; gap:10px;';
        const chk = (v) => v ? 'checked' : '';
        const curTf = this._tfKey() || '1h';
        const pl = this._placement();          // [VP-TV]

        // --- кнопки вкладок ---
        const tabs = ['general'].concat(TF);
        const tabLabels = { general: 'Общие' };
        TF.forEach(tf => { tabLabels[tf] = tf + (tf === curTf ? ' ●' : ''); });
        const btnStyle = 'background:#1E1E1E; border:1px solid #404040; color:#B0B0B0; border-radius:4px;' +
            ' padding:3px 7px; cursor:pointer; font-size:11px; font-family:inherit;';
        const btns = tabs.map((id, i) => {
            const active = i === 0;
            const st = active
                ? 'background:#2196F3; border:1px solid #2196F3; color:#FFFFFF; border-radius:4px; padding:3px 7px; cursor:pointer; font-size:11px; font-family:inherit;'
                : btnStyle;
            return `<button type="button" id="vp_tabbtn_${id}" style="${st}" onclick="window.__vpTab && window.__vpTab('${id}')">${tabLabels[id]}</button>`;
        }).join('');

        // --- вкладка «Общие» ---
        const general = `
            <div id="vp_tab_general" style="display:block;">
                <div style="color:#2196F3; margin:8px 0;">🔄 Обновление профиля</div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}" title="На новой свече — профиль стабильный, не дрожит при движении цены. На каждом тике — живой, но перерисовывается постоянно. Вручную — только при смене ТФ/символа/настроек.">Пересчитывать:</label>
                    <select id="vp_refreshMode" style="${rowStyle}">
                        <option value="bar" ${s.refreshMode === 'bar' ? 'selected' : ''}>На новой свече (стабильно)</option>
                        <option value="tick" ${s.refreshMode === 'tick' ? 'selected' : ''}>На каждом тике (живой)</option>
                        <option value="manual" ${s.refreshMode === 'manual' ? 'selected' : ''}>Вручную</option>
                    </select>
                </div>
                <div style="color:#888; font-size:10px; line-height:1.45; margin-bottom:10px;">
                    Скролл и зум пересчёт не вызывают никогда. Подгрузка истории
                    при скролле влево — тоже: профиль привязан ко времени, а не к номеру свечи.
                </div>

                <div style="color:#2196F3; margin:8px 0;">📊 Общие</div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}" title="Сколько процентов объёма должно попасть в Value Area">Value Area, %:</label>
                    <input type="number" id="vp_percent" value="${s.percent}" min="0" max="100" step="1" style="${numStyle}">
                </div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}" title="Максимальная длина ряда = баров / делитель">Ширина (делитель):</label>
                    <input type="number" id="vp_widthDivisor" value="${s.widthDivisor}" min="0.5" max="20" step="0.5" style="${numStyle}">
                </div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}" title="Жёсткий потолок длины ряда в пикселях. 0 — ограничивать долей экрана (следующее поле). Нужно, чтобы на коротких ТФ гистограмма не уезжала за экран.">Макс. ширина, px:</label>
                    <input type="number" id="vp_maxWidthPx" value="${s.maxWidthPx}" min="0" max="5000" step="10" style="${numStyle}">
                </div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}" title="Работает только при «Макс. ширина, px» = 0. Какая доля видимой ширины графика может быть занята гистограммой.">Макс. доля экрана:</label>
                    <input type="number" id="vp_maxWidthRatio" value="${s.maxWidthRatio}" min="0" max="0.6" step="0.05" style="${numStyle}">
                </div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}" title="Применяется, только если текущий таймфрейм не распознался">Баров (резерв):</label>
                    <input type="number" id="vp_fallbackBars" value="${s.fallbackBars}" min="1" max="5000" style="${numStyle}">
                </div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}" title="Применяется, только если текущий таймфрейм не распознался">Рядов (резерв):</label>
                    <input type="number" id="vp_fallbackRows" value="${s.fallbackRows}" min="5" max="100" style="${numStyle}">
                </div>

                <div style="color:#2196F3; margin:8px 0;">🎯 POC и уровни</div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}">Показывать POC:</label>
                    <input type="checkbox" id="vp_showPoc" ${chk(s.showPoc)} style="accent-color:#4A90E2;">
                </div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}">Цвет POC:</label>
                    <input type="color" id="vp_pocColor" value="${s.pocColor}" style="width:50px; height:28px; background:#1E1E1E; border:1px solid #404040; border-radius:4px;">
                    <label style="color:#B0B0B0;">Толщина:</label>
                    <input type="number" id="vp_pocWidth" value="${s.pocWidth}" min="1" max="5" style="width:60px; background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px;">
                </div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}" title="Продлевать линию POC вправо до края панели">Линия POC вправо:</label>
                    <input type="checkbox" id="vp_extendPocRight" ${chk(s.extendPocRight)} style="accent-color:#4A90E2;">
                </div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}" title="Линии и метки границ Value Area">Показывать VAH/VAL:</label>
                    <input type="checkbox" id="vp_showVaLines" ${chk(s.showVaLines)} style="accent-color:#4A90E2;">
                </div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}">Цвет VAH/VAL:</label>
                    <input type="color" id="vp_vaLineColor" value="${s.vaLineColor}" style="width:50px; height:28px; background:#1E1E1E; border:1px solid #404040; border-radius:4px;">
                </div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}" title="Слева — гистограмма растёт вправо от первой свечи диапазона (как в оригинальном скрипте TradingView). Справа — растёт влево от последней свечи, профиль прижат к текущей цене.">Расположение профиля:</label>
                    <select id="vp_placement" style="${rowStyle}">
                        <option value="screenLeft" ${pl === 'screenLeft' ? 'selected' : ''}>Слева — прижать к экрану (видно всегда)</option>
                        <option value="left" ${pl === 'left' ? 'selected' : ''}>Слева — от первой свечи диапазона</option>
                        <option value="right" ${pl === 'right' ? 'selected' : ''}>Справа — у текущей цены</option>
                    </select>
                </div>
                <div style="color:#888; font-size:10px; line-height:1.45; margin:-4px 0 10px 160px;">
                    «Прижать к экрану» — гистограмма стоит у левого края видимой области
                    и не уезжает при скролле/зуме (как Volume Profile Visible Range в TradingView).
                </div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}" title="Подписи объёма прямо на гистограмме, формат K/M/B. Шрифт сам уменьшается под высоту ряда.">Надписи объёма на гистограмме:</label>
                    <select id="vp_showVolume" style="${rowStyle}">
                        <option value="none" ${s.showVolume === 'none' ? 'selected' : ''}>Не показывать</option>
                        <option value="poc" ${s.showVolume === 'poc' ? 'selected' : ''}>Только у POC</option>
                        <option value="va" ${s.showVolume === 'va' ? 'selected' : ''}>В Value Area + POC</option>
                        <option value="all" ${s.showVolume === 'all' ? 'selected' : ''}>У каждого ряда</option>
                    </select>
                </div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}" title="Ряд тоньше этого значения рисуется без подписи. Если подписей нет — уменьшите значение или число рядов во вкладке таймфрейма (рекомендуется ≤ 48).">Мин. высота ряда, px:</label>
                    <input type="number" id="vp_volumeMinHeight" value="${s.volumeMinHeight}" min="0" max="100" step="1" style="${numStyle}">
                    <label style="color:#B0B0B0;">Цвет:</label>
                    <input type="color" id="vp_volumeColor" value="${s.volumeColor}" style="width:50px; height:28px; background:#1E1E1E; border:1px solid #404040; border-radius:4px;">
                </div>

                <div style="color:#2196F3; margin:8px 0;">🎨 Цвета</div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}">Value Area вверх:</label>
                    <input type="color" id="vp_vaUpColor" value="${s.vaUpColor}" style="width:50px; height:28px; background:#1E1E1E; border:1px solid #404040; border-radius:4px;">
                    <label style="color:#B0B0B0;">Прозрачность:</label>
                    <input type="number" id="vp_vaAlpha" value="${s.vaAlpha}" min="0" max="1" step="0.05" style="width:70px; background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px;">
                </div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}">Value Area вниз:</label>
                    <input type="color" id="vp_vaDownColor" value="${s.vaDownColor}" style="width:50px; height:28px; background:#1E1E1E; border:1px solid #404040; border-radius:4px;">
                </div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}">Объём вверх:</label>
                    <input type="color" id="vp_upColor" value="${s.upColor}" style="width:50px; height:28px; background:#1E1E1E; border:1px solid #404040; border-radius:4px;">
                    <label style="color:#B0B0B0;">Прозрачность:</label>
                    <input type="number" id="vp_bodyAlpha" value="${s.bodyAlpha}" min="0" max="1" step="0.05" style="width:70px; background:#1E1E1E; border:1px solid #404040; color:#fff; border-radius:4px; padding:4px 8px;">
                </div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}">Объём вниз:</label>
                    <input type="color" id="vp_downColor" value="${s.downColor}" style="width:50px; height:28px; background:#1E1E1E; border:1px solid #404040; border-radius:4px;">
                </div>

                <div style="margin-top:10px; display:flex; gap:8px;">
                    <button type="button" onclick="window.__vpResetTF && window.__vpResetTF()" style="${btnStyle}">Сбросить все ТФ к рекомендуемым</button>
                </div>
            </div>`;

        // --- вкладки по таймфреймам ---
        const tfTabs = TF.map(tf => {
            const cur = (s.perTF && s.perTF[tf]) || PD[tf];
            const def = PD[tf];
            const isCur = tf === curTf;
            return `
            <div id="vp_tab_${tf}" style="display:none;">
                <div style="color:#2196F3; margin:8px 0;">⏱ Таймфрейм ${tf}${isCur ? ' <span style="color:#22E00F;">(текущий)</span>' : ''}</div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}" title="Сколько последних свечей этого таймфрейма входит в профиль">Количество баров:</label>
                    <input type="number" id="vp_bars_${tf}" value="${cur.bars}" min="1" max="5000" style="${numStyle}">
                </div>
                <div style="${rowDiv}">
                    <label style="${labelStyle}" title="На сколько горизонтальных рядов делится ценовой диапазон. Высота ряда = (top - bot) / рядов; держите её в пределах 0.1-0.5 ATR">Число рядов:</label>
                    <input type="number" id="vp_rows_${tf}" value="${cur.rows}" min="5" max="100" style="${numStyle}">
                </div>
                <div style="color:#888; font-size:10px; line-height:1.5; margin-top:6px;">
                    Покрывает: <span style="color:#4FC3F7;">${this._daysLabel(tf, cur.bars)}</span><br>
                    Высота ряда при диапазоне 10%: <span style="color:#4FC3F7;">${(10 / cur.rows).toFixed(3)}%</span><br>
                    Рекомендуемое: ${def.bars} баров / ${def.rows} рядов (${this._daysLabel(tf, def.bars)})
                </div>
            </div>`;
        }).join('');

        return `
            <div style="max-height:420px; overflow-y:auto; padding-right:5px; scrollbar-width: thin; scrollbar-color: #4A4A4A #1E1E1E;">
                <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:10px; position:sticky; top:0; background:#141420; padding-bottom:6px;">
                    ${btns}
                </div>
                ${general}
                ${tfTabs}
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

        s.refreshMode = oneOf('vp_refreshMode', ['bar', 'tick', 'manual'], s.refreshMode);
        s.percent = num('vp_percent', s.percent, 0, 100);
        s.widthDivisor = num('vp_widthDivisor', s.widthDivisor, 0.5, 20);
        s.maxWidthPx = num('vp_maxWidthPx', s.maxWidthPx, 0, 5000);
        s.maxWidthRatio = num('vp_maxWidthRatio', s.maxWidthRatio, 0, 0.6);
        s.fallbackBars = int('vp_fallbackBars', s.fallbackBars, 1, 5000);
        s.fallbackRows = int('vp_fallbackRows', s.fallbackRows, 5, 100);

        s.showPoc = bool('vp_showPoc', s.showPoc);
        s.pocColor = color('vp_pocColor', s.pocColor);
        s.pocWidth = int('vp_pocWidth', s.pocWidth, 1, 5);
        s.extendPocRight = bool('vp_extendPocRight', s.extendPocRight);
        s.showVaLines = bool('vp_showVaLines', s.showVaLines);
        s.vaLineColor = color('vp_vaLineColor', s.vaLineColor);
        // [VP-PLACE] расположение профиля: 'left' / 'right'
        const placement = oneOf('vp_placement', ['left', 'right', 'screenLeft'], this._placement());
        s.placement = placement;
        s.anchorRight = (placement === 'right');
        s.showVolume = oneOf('vp_showVolume', ['none', 'poc', 'va', 'all'], s.showVolume);
        s.volumeMinHeight = num('vp_volumeMinHeight', s.volumeMinHeight, 0, 100);
        s.volumeColor = color('vp_volumeColor', s.volumeColor);

        s.vaUpColor = color('vp_vaUpColor', s.vaUpColor);
        s.vaDownColor = color('vp_vaDownColor', s.vaDownColor);
        s.vaAlpha = num('vp_vaAlpha', s.vaAlpha, 0, 1);
        s.upColor = color('vp_upColor', s.upColor);
        s.downColor = color('vp_downColor', s.downColor);
        s.bodyAlpha = num('vp_bodyAlpha', s.bodyAlpha, 0, 1);

        // per-TF: читаем только те таймфреймы, поля которых реально есть в форме
        const perTF = {};
        for (const tf of this.constructor.TF_ORDER) {
            const bEl = el('vp_bars_' + tf);
            const rEl = el('vp_rows_' + tf);
            const prev = (s.perTF && s.perTF[tf]) || this.constructor.PER_TF_DEFAULTS[tf];
            perTF[tf] = {
                bars: int('vp_bars_' + tf, prev.bars, 1, 5000),
                rows: int('vp_rows_' + tf, prev.rows, 5, 100)
            };
            // если полей не было вообще — не трогаем значение
            if (!bEl && !rEl) perTF[tf] = { bars: prev.bars, rows: prev.rows };
        }
        s.perTF = perTF;

        this._sanitizeSettings();
        this._saveSettings();
        this._colorCache.clear();
        this.recompute('form');
        if (super.applySettingsFromForm) super.applySettingsFromForm();
    }

    /* ------------------------- диагностика ------------------------- */

    /** В консоли браузера: __vpDebug() */
    _debugDump() {
        const cm = this.manager && this.manager.chartManager;
        const data = (cm && cm.chartData) || [];
        const p = this._profile;
        const tf = this._tfSettings();
        const out = {
            'свечей в chartData': data.length,
            'currentInterval': cm && cm.currentInterval,
            'ключ ТФ': tf.key,
            'баров (настройка ТФ)': tf.bars,
            'рядов (настройка ТФ)': tf.rows,
            'refreshMode': this.settings.refreshMode,
            'расположение': this._placement(),
            'anchorRight (устар.)': !!this.settings.anchorRight,
            'объём на рядах': this.settings.showVolume,
            'линии VAH/VAL (showVaLines)': this.settings.showVaLines,
            'показывать POC (showPoc)': this.settings.showPoc,
            'рядов без подписи (тонкие)': this._volSkippedRows || 0,
            'баров в профиле': p ? p.bars : 0,
            'данных меньше, чем заказано': p
                ? (p.bars < tf.bars ? ('да: ' + p.bars + ' из ' + tf.bars + ' — профиль по всем загруженным свечам, при догрузке истории «плывёт»') : 'нет')
                : '—',
            'рядов в профиле': p ? p.rows : 0,
            'диапазон': p ? (this._fmt(p.bot) + ' .. ' + this._fmt(p.top)) : '—',
            'firstTime профиля': p && p.firstTime ? new Date(p.firstTime * 1000).toISOString().slice(0, 16) : '—',
            'lastTime профиля': p && p.lastTime ? new Date(p.lastTime * 1000).toISOString().slice(0, 16) : '—',
            'firstTime найден в данных': p ? (this._indexByTime(data, p.firstTime) !== null) : false,
            'POC': p ? this._fmt(p.pocPrice) : '—',
            'VAH': p ? this._fmt(p.vah) : '—',
            'VAL': p ? this._fmt(p.val) : '—',
            'VA ряды': p ? (p.vaLowRow + '..' + p.vaHighRow) : '—',
            'VA фактически %': p ? p.vaPercentActual.toFixed(1) : '—',
            'объём всего': p ? Math.round(p.sum) : 0,
            'пересчётов по причинам': JSON.stringify(this._recomputeReasons),
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
        if (this._attachTimeout !== null) { clearTimeout(this._attachTimeout); this._attachTimeout = null; }
        if (this._recomputeTimeout !== null) { clearTimeout(this._recomputeTimeout); this._recomputeTimeout = null; }
        if (this._fallbackTimer !== null) { clearInterval(this._fallbackTimer); this._fallbackTimer = null; }
        if (this._primitive && this._attachedSeries) {
            try { this._attachedSeries.detachPrimitive(this._primitive); } catch (e) {}
        }
        this._primitive = null;
        this._attachedSeries = null;
        this._requestUpdate = null;
        this._profile = null;
        this._colorCache.clear();
        // super.destroy() сам делает _removeAllSeries() + manager = null
        super.destroy();
    }
}

// Глобальный сброс per-TF настроек к рекомендуемым (кнопка во вкладке «Общие»)
if (typeof window !== 'undefined' && !window.__vpResetTF) {
    window.__vpResetTF = function () {
        try {
            const im = window.chartManagerInstance && window.chartManagerInstance.indicatorManager;
            const ind = im && im.activeIndicators && im.activeIndicators.find(i => i.type === 'volumeprofile');
            if (!ind) { console.warn('[VolumeProfile] индикатор не добавлен на график'); return; }
            const PD = VolumeProfileIndicator.PER_TF_DEFAULTS;
            const perTF = {};
            for (const tf of Object.keys(PD)) perTF[tf] = { bars: PD[tf].bars, rows: PD[tf].rows };
            ind.updateSettings({ perTF: perTF });
            // перерисовываем панель настроек, чтобы поля показали новые значения
            if (im && im._renderUI) im._renderUI();
            console.log('[VolumeProfile] настройки всех таймфреймов сброшены к рекомендуемым');
        } catch (e) { console.warn('[VolumeProfile] сброс настроек:', e); }
    };
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
    // [VP-BUILD] маркер сборки: по этой строке в консоли сразу видно,
    // какой Indicators.js реально загрузился в браузере
    try {
        console.log('%c[VolumeProfile] сборка VP-FIT+VP-TV-VOL+FIX5: линии + объём при любом зуме, профиль ПОД свечами; диагностика __vpStatus(), схема настроек v' + VolumeProfileIndicator.SETTINGS_VERSION, 'color:#4FC3F7');
        window.__vpBuild = () => 'VP-FIT+VP-TV-VOL+FIX5, SETTINGS_VERSION=' + VolumeProfileIndicator.SETTINGS_VERSION;
    } catch (e) {}
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
