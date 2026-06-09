class TimerRenderer {
    constructor(timerManager) {
        this._timerManager = timerManager;
        this.enabled = true;
        this._cachedColor = null;
        this._lastCandleTime = 0;
        this._lastDrawInfo = null;
    }

    setColor(color) {
        if (color) {
            this._cachedColor = color;
        }
    }

    draw(target) {
    if (!this.enabled) return;
    
    const chartManager = this._timerManager._chartManager;
    if (!chartManager || !chartManager.chartData || chartManager.chartData.length === 0) return;
    
    const timerText = this._timerManager._timerElement?.textContent || '';
    if (!timerText) return;

    target.useBitmapCoordinateSpace(scope => {
        const ctx = scope.context;
        const hpr = scope.horizontalPixelRatio;
        const vpr = scope.verticalPixelRatio;

        const lastCandle = chartManager.chartData[chartManager.chartData.length - 1];
        if (!lastCandle) return;

        const price = lastCandle.close;
        if (!price || isNaN(price)) return;

        const activeSeries = chartManager.currentChartType === 'candle' 
            ? chartManager.candleSeries : chartManager.barSeries;
        if (!activeSeries) return;

        const yCoord = activeSeries.priceToCoordinate(price);
        if (yCoord == null || isNaN(yCoord)) return;

        const bitmapY = yCoord * vpr;
        const bitmapWidth = scope.mediaSize.width * hpr;
        const bitmapHeight = scope.mediaSize.height * vpr;

        const fontSize = Math.round(11 * vpr);
        ctx.font = `bold ${fontSize}px 'Inter', Arial, sans-serif`;
        const textWidth = ctx.measureText(timerText).width;
        
        const rectWidth = Math.ceil(textWidth + 8 * hpr);
        const rectHeight = Math.ceil(fontSize + 6 * vpr);
        const rectX = bitmapWidth - rectWidth - 4 * hpr;
        
        let rectY = Math.round(bitmapY - rectHeight / 2);
        rectY = Math.max(2 * vpr, Math.min(rectY, bitmapHeight - rectHeight - 2 * vpr));

        // ✅ ЦВЕТ СТРОГО КАК У ЛИНИИ: _lastAppliedColor
        const bgColor = this._cachedColor 
            || chartManager._lastAppliedColor 
            || (lastCandle.close >= lastCandle.open 
                ? (chartManager.bullishColor || '#26a69a') 
                : (chartManager.bearishColor || '#ef5350'));

        ctx.save();
        ctx.fillStyle = bgColor + 'DD';
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 3 * hpr;
        this._roundRect(ctx, rectX, rectY, rectWidth, rectHeight, 2 * hpr);
        ctx.fill();
        
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(timerText, rectX + rectWidth / 2, rectY + rectHeight / 2);
        ctx.restore();
    });
}
}
class TimerPaneView {
    constructor(timerManager) {
        this._timerManager = timerManager;
        this._renderer = new TimerRenderer(timerManager);
        this._price = null;
        this._color = null;
    }

    renderer() { return this._renderer; }
}

class TimerPrimitive {
    constructor(timerManager, chartManager) {
        this._timerManager = timerManager;
        this._chartManager = chartManager;
        this._paneView = new TimerPaneView(timerManager);
        this._chart = null;
        this._series = null;
        this._requestUpdate = null;
        this._dataReady = false;
    }

    paneViews() { return [this._paneView]; }

    attached({ chart, series, requestUpdate }) {
        this._chart = chart;
        this._series = series;
        this._requestUpdate = requestUpdate;
        this._dataReady = false;
    }

    detached() { this._dataReady = false; }
    updateAllViews() {}

    requestRedraw() {
        if (this._requestUpdate) this._requestUpdate();
    }

    setEnabled(enabled) {
        if (this._paneView?._renderer) {
            this._paneView._renderer.enabled = enabled;
            if (enabled) this.requestRedraw();
        }
    }

    isEnabled() { return this._paneView?._renderer?.enabled ?? false; }
    updateDisplay() { this.requestRedraw(); }

    setPrice(p) { 
        if (this._paneView) this._paneView._price = p; 
    }

    setColor(c) { 
        if (this._paneView?._renderer) {
            this._paneView._renderer.setColor(c);
        }
        if (this._paneView) this._paneView._color = c; 
    }

    setDataReady(r) { this._dataReady = r; }
    isDataReady() { return this._dataReady; }
}

class TimerManager {
    constructor(chartManager) {
        this._chartManager = chartManager;
        this._interval = null;
        this._currentTf = CONFIG.defaultInterval || '1h';
        this._primitive = null;
        this._timerElement = { textContent: '' };
        this._disabled = false;

        chartManager.timerManager = this;
        setTimeout(() => this._init(), 500);
    }

    _init() {
        if (this._disabled || !this._chartManager?.chart) return;

        if (this._primitive) {
            try {
                const s = this._chartManager.currentChartType === 'candle' 
                    ? this._chartManager.candleSeries : this._chartManager.barSeries;
                s?.detachPrimitive(this._primitive);
            } catch(e) {}
        }

        this._primitive = new TimerPrimitive(this, this._chartManager);
        const series = this._chartManager.currentChartType === 'candle' 
            ? this._chartManager.candleSeries : this._chartManager.barSeries;

        if (series) {
            try {
                series.attachPrimitive(this._primitive);

                if (['1d','1w','1M'].includes(this._currentTf)) {
                    this._primitive.setEnabled(false);
                } else {
                    this._primitive.setEnabled(false);
                    this._waitForData();
                }

                series.subscribeDataChanged(() => {
                    if (this._primitive && this._chartManager.chartData?.length > 0) {
                        if (!this._primitive.isDataReady()) {
                            this._primitive.setDataReady(true);
                            if (!['1d','1w','1M'].includes(this._currentTf)) {
                                this._primitive.setEnabled(true);
                            }
                        }
                        if (this._primitive.isEnabled()) this._primitive.requestRedraw();
                    }
                });
            } catch(e) {}
        }
    }

    _waitForData() {
        let i = 0;
        const check = () => {
            if (++i > 80 || !this._chartManager || !this._primitive) return;
            if (this._chartManager.chartData?.length > 0) {
                this._primitive.setDataReady(true);
                this._primitive.setEnabled(true);
                return;
            }
            setTimeout(check, 100);
        };
        setTimeout(check, 100);
    }

    start(interval) {
        if (this._disabled) return;
        this._currentTf = interval;

        if (['1d','1w','1M'].includes(interval)) {
            this._timerElement.textContent = '';
            this._primitive?.setEnabled(false);
            this.stop();
            return;
        }

        if (!this._primitive) this._init();
        if (!this._timerElement) this._timerElement = { textContent: '' };

        this._tick();
        this.stop();
        this._interval = setInterval(() => this._tick(), 250);
    }

    _tick() {
        if (this._disabled || !this._timerElement) return;
        if (!this._chartManager.chartData?.length) return;
        if (this._primitive && !this._primitive.isDataReady()) return;

        if (['1d','1w','1M'].includes(this._currentTf)) {
            this._timerElement.textContent = '';
            this._primitive?.setEnabled(false);
            return;
        }

        const dur = TF_DURATIONS[this._currentTf];
        if (!dur) return;

        const left = dur - (Utils.toMoscowTime(Date.now()).getTime() % dur);
        const txt = Utils.formatTimeRemaining(left);

        if (this._timerElement.textContent !== txt) {
            this._timerElement.textContent = txt;
            if (this._primitive) {
                if (!this._primitive.isEnabled() && this._primitive.isDataReady())
                    this._primitive.setEnabled(true);
                if (this._primitive.isEnabled()) this._primitive.requestRedraw();
            }
        }
    }

    forceColorUpdate() {
        if (this._primitive?.isEnabled()) {
            this._primitive.requestRedraw();
        }
    }

    stop() {
        if (this._interval) { clearInterval(this._interval); this._interval = null; }
    }

    reattach() {
        if (this._disabled) return;
        if (!this._primitive) { this._init(); return; }

        const on = this._primitive.isEnabled();
        try {
            const old = this._chartManager.currentChartType === 'candle'
                ? this._chartManager.barSeries : this._chartManager.candleSeries;
            old?.detachPrimitive(this._primitive);
        } catch(e) {}

        this._primitive.setDataReady(false);
        const series = this._chartManager.currentChartType === 'candle'
            ? this._chartManager.candleSeries : this._chartManager.barSeries;

        if (series) {
            try {
                series.attachPrimitive(this._primitive);
                if (on && !['1d','1w','1M'].includes(this._currentTf)) {
                    this._primitive.setEnabled(false);
                    this._waitForData();
                }
            } catch(e) {}
        }
    }

    destroy() {
        this.stop();
        if (this._primitive) {
            try {
                const s = this._chartManager.currentChartType === 'candle'
                    ? this._chartManager.candleSeries : this._chartManager.barSeries;
                s?.detachPrimitive(this._primitive);
            } catch(e) {}
            this._primitive = null;
        }
    }
}

if (typeof window !== 'undefined') window.TimerManager = TimerManager;
