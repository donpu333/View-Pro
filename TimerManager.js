class TimerRenderer {
    constructor(timerManager) {
        this._timerManager = timerManager;
        this.enabled = true;
        this._cachedColor = null;
        this._colorDirty = true;
    }

    setColor(color) {
        if (color && this._cachedColor !== color) {
            this._cachedColor = color;
            this._colorDirty = false;
            if (this._timerManager?._primitive?.requestRedraw) {
                this._timerManager._primitive.requestRedraw();
            }
        }
    }
    
    invalidateColor() {
        this._colorDirty = true;
        this._cachedColor = null;
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
            let price = lastCandle?.close;
            
            if (price == null || isNaN(price) || price <= 0) {
                price = chartManager.currentRealPrice;
            }
            
            if (price == null || isNaN(price) || price <= 0) return;

            let yCoord = null;
            const primitiveSeries = this._timerManager._primitive?._series;
            
            if (primitiveSeries) {
                try {
                    yCoord = primitiveSeries.priceToCoordinate(price);
                } catch(e) {}
            }
            
            if (yCoord == null || isNaN(yCoord)) return;

            const bitmapY = yCoord * vpr;
            const bitmapWidth = scope.mediaSize.width * hpr;
            const bitmapHeight = scope.mediaSize.height * vpr;

            const fontSize = Math.round(11 * vpr);
            ctx.font = `bold ${fontSize}px 'Inter', Arial, sans-serif`;
            const textWidth = ctx.measureText(timerText).width;
            
            const rectWidth = Math.ceil(textWidth + 10 * hpr);
            const rectHeight = Math.ceil(fontSize + 6 * vpr);

            const rectX = bitmapWidth - rectWidth - 4 * hpr;
            let rectY = Math.round(bitmapY - rectHeight / 2);
            rectY = Math.max(2 * vpr, Math.min(rectY, bitmapHeight - rectHeight - 2 * vpr));

            let bgColor = this._cachedColor;
            if (this._colorDirty || !bgColor) {
                if (typeof chartManager.getCurrentPriceColor === 'function') {
                    bgColor = chartManager.getCurrentPriceColor();
                } else {
                    if (lastCandle?.close != null && lastCandle?.open != null) {
                        bgColor = lastCandle.close >= lastCandle.open 
                            ? (chartManager.bullishColor || '#26a69a')
                            : (chartManager.bearishColor || '#ef5350');
                    } else {
                        bgColor = chartManager._lastAppliedColor || '#26a69a';
                    }
                }
                if (bgColor) {
                    this._cachedColor = bgColor;
                    this._colorDirty = false;
                }
            }

            if (!bgColor) bgColor = '#26a69a';

            ctx.save();
            ctx.fillStyle = bgColor; 
            ctx.shadowColor = 'rgba(0,0,0,0.4)';
            ctx.shadowBlur = 4 * hpr;
            this._roundRect(ctx, rectX, rectY, rectWidth, rectHeight, 3 * hpr);
            ctx.fill();
            
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(timerText, rectX + rectWidth / 2, rectY + rectHeight / 2 + (1 * vpr));
            ctx.restore();
        });
    }

    _roundRect(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }
}

class TimerPaneView {
    constructor(timerManager) {
        this._timerManager = timerManager;
        this._renderer = new TimerRenderer(timerManager);
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
        this._paneView._renderer.invalidateColor();
        if (this._chartManager?.chartData?.length > 0) this._dataReady = true;
    }

    detached() { 
        this._dataReady = false;
        this._series = null;
    }
    
    updateAllViews() {
        if (this._paneView?._renderer) {
            this._paneView._renderer.invalidateColor();
        }
    }

    requestRedraw() {
        if (this._requestUpdate) {
            this._requestUpdate();
        }
    }

    setEnabled(enabled) {
        if (this._paneView?._renderer) {
            this._paneView._renderer.enabled = enabled;
            if (enabled) this.requestRedraw();
        }
    }

    isEnabled() { return this._paneView?._renderer?.enabled ?? false; }

    setColor(color) { this._paneView?._renderer?.setColor(color); }
    
    updatePrice(price) {
        if (price != null && !isNaN(price) && this.isEnabled()) {
            this._chartManager.currentRealPrice = price;
            this._paneView._renderer.invalidateColor();
            this.requestRedraw();
        }
    }

    setDataReady(ready) { this._dataReady = ready; }
    isDataReady() { return this._dataReady; }
    
    invalidateColor() {
        this._paneView?._renderer?.invalidateColor();
        if (this.isEnabled()) this.requestRedraw();
    }
}

class TimerManager {
    constructor(chartManager) {
        this._chartManager = chartManager;
        this._interval = null;
        this._currentTf = (typeof CONFIG !== 'undefined' && CONFIG.defaultInterval) ? CONFIG.defaultInterval : '1h';
        this._primitive = null;
        this._timerElement = { textContent: '' };
        this._disabled = false;
        
        this._priceSubscribed = false;
        this._priceHandler = null;
        this._subscribedSymbolKey = null;
        this._colorChangeHandler = null;
        this._initialized = false;
        
        this._dataChangedUnsubscribe = null; 
        this._scrollHandler = null;

        chartManager.timerManager = this;
        setTimeout(() => this._init(), 300);
    }

    _init() {
        if (this._disabled || !this._chartManager?.chart) return;
        this._attachToSeries(this._chartManager.currentChartType === 'candle' 
            ? this._chartManager.candleSeries : this._chartManager.barSeries);
        this._subscribeToPrice();
        this._subscribeToColorChanges();
        this._initialized = true;
    }
    
    _attachToSeries(series) {
        this._detachPrimitive();
        if (!series) return;

        this._primitive = new TimerPrimitive(this, this._chartManager);
        try {
            series.attachPrimitive(this._primitive);
            this._primitive.setEnabled(false);

            this._dataChangedUnsubscribe = series.subscribeDataChanged(() => {
                if (this._primitive && this._chartManager.chartData?.length > 0) {
                    if (!this._primitive.isDataReady()) {
                        this._primitive.setDataReady(true);
                        this._updateTimerState();
                    }
                    if (this._primitive.isEnabled()) {
                        this._primitive.invalidateColor();
                        this._primitive.requestRedraw();
                    }
                }
            });

            if (this._chartManager?.chart?.timeScale()) {
                this._scrollHandler = () => {
                    if (this._primitive?.isEnabled()) {
                        this._primitive.requestRedraw();
                    }
                };
                this._chartManager.chart.timeScale().subscribeVisibleLogicalRangeChange(this._scrollHandler);
            }

        } catch(e) {
            console.error('TimerManager: Failed to attach primitive', e);
        }
        
        if (this._chartManager.chartData?.length > 0) {
            this._primitive.setDataReady(true);
            this._updateTimerState();
        }
    }

    _detachPrimitive() {
        if (this._dataChangedUnsubscribe) {
            this._dataChangedUnsubscribe();
            this._dataChangedUnsubscribe = null;
        }
        
        if (this._scrollHandler && this._chartManager?.chart?.timeScale()) {
            this._chartManager.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this._scrollHandler);
            this._scrollHandler = null;
        }
        
        if (this._primitive) {
            try {
                const series = this._chartManager.currentChartType === 'candle'
                    ? this._chartManager.candleSeries : this._chartManager.barSeries;
                if (series) series.detachPrimitive(this._primitive);
            } catch(e) {}
            this._primitive = null;
        }
    }
    
    _updateTimerState() {
        if (!this._primitive?.isDataReady()) return;
        
        if (['1d','1w','1M'].includes(this._currentTf)) {
            this._timerElement.textContent = '';
            this._primitive.setEnabled(false);
            this.stop();
        } else {
            this._primitive.setEnabled(true);
            this._tick();
            if (!this._interval) {
                this._interval = setInterval(() => this._tick(), 250);
            }
        }
    }
    
    _subscribeToPrice() {
        this._unsubscribeFromPrice();
        if (!this._chartManager?.priceManager) {
            setTimeout(() => this._subscribeToPrice(), 200);
            return;
        }
        
        const key = this._chartManager.getCurrentSymbolKey();
        if (!key) return;
        
        this._subscribedSymbolKey = key;
        this._priceSubscribed = true;
        
        this._priceHandler = (price) => {
            if (document.hidden || !this._primitive?.isEnabled()) return;
            
            this._chartManager.currentRealPrice = price;
            this._primitive.updatePrice(price);
        };
        
        try {
            this._chartManager.priceManager.subscribe(key, this._priceHandler, this._chartManager.currentExchange, this._chartManager.currentMarketType);
        } catch(e) {
            console.error('TimerManager: Failed to subscribe to price', e);
        }
    }
    
    _subscribeToColorChanges() {
        if (this._colorChangeHandler) return;
        if (typeof this._chartManager.onColorChange === 'function') {
            this._colorChangeHandler = () => this._primitive?.invalidateColor();
            this._chartManager.onColorChange(this._colorChangeHandler);
        }
    }
    
    _unsubscribeFromPrice() {
        if (this._priceHandler && this._chartManager?.priceManager && this._subscribedSymbolKey) {
            try { this._chartManager.priceManager.unsubscribe(this._subscribedSymbolKey, this._priceHandler); } catch(e) {}
        }
        this._priceHandler = null;
        this._priceSubscribed = false;
        this._subscribedSymbolKey = null;
    }

    start(interval) {
        if (this._disabled) return;
        
        const tfChanged = this._currentTf !== interval;
        this._currentTf = interval;

        if (!this._initialized) {
            this._init();
            return;
        }

        this.stop();
        
        if (tfChanged) {
            if (this._primitive) {
                this._primitive.invalidateColor();
            }
        }
        
        this._updateTimerState();
    }

    _tick() {
        if (this._disabled || !this._timerElement || !this._chartManager?.chartData?.length) return;
        
        if (['1d','1w','1M'].includes(this._currentTf)) {
            this._timerElement.textContent = '';
            this.stop();
            return;
        }

        if (typeof TF_DURATIONS === 'undefined' || typeof Utils === 'undefined') return;

        const dur = TF_DURATIONS[this._currentTf];
        if (!dur) return;

        const left = dur - (Utils.toMoscowTime(Date.now()).getTime() % dur);
        const txt = Utils.formatTimeRemaining(left);

        if (this._timerElement.textContent !== txt) {
            this._timerElement.textContent = txt;
            if (this._primitive?.isEnabled()) {
                this._primitive.requestRedraw();
            }
        }
    }

    reattach() {
        if (this._disabled || !this._initialized) return;
        const series = this._chartManager.currentChartType === 'candle'
            ? this._chartManager.candleSeries : this._chartManager.barSeries;
        this._attachToSeries(series);
        this._subscribeToPrice();
    }

    forceColorUpdate() {
        this._primitive?.invalidateColor();
    }

    // ✅ ДОБАВЛЕННЫЙ МЕТОД: делегирует вызов к primitive, предотвращая ошибку "is not a function"
    updatePrice(price) {
        if (this._primitive) {
            this._primitive.updatePrice(price);
        } else {
            // Фолбэк, если primitive ещё не инициализирован
            if (this._chartManager) {
                this._chartManager.currentRealPrice = price;
            }
        }
    }

    stop() {
        if (this._interval) { 
            clearInterval(this._interval); 
            this._interval = null; 
        }
    }

    destroy() {
        this.stop();
        this._unsubscribeFromPrice();
        if (this._colorChangeHandler && typeof this._chartManager?.offColorChange === 'function') {
            this._chartManager.offColorChange(this._colorChangeHandler);
        }
        this._colorChangeHandler = null;
        this._detachPrimitive();
        this._initialized = false;
    }
}

if (typeof window !== 'undefined') {
    window.TimerManager = TimerManager;
}
