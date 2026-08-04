class TimerRenderer {
    constructor(timerManager) {
        this._timerManager = timerManager;
        this.enabled = true;
    }

    /**
     * Всегда определяет цвет по актуальному состоянию последней свечи
     * Никакого кеширования — для текущей свечи это бессмысленно
     */
    _getCurrentColor(chartManager) {
        const lastCandle = chartManager.chartData?.[chartManager.chartData.length - 1];
        
        if (lastCandle && lastCandle.close != null && lastCandle.open != null) {
            const isBullish = lastCandle.close >= lastCandle.open;
            return isBullish 
                ? (chartManager.bullishColor || '#26a69a')
                : (chartManager.bearishColor || '#ef5350');
        }
        
        return '#26a69a';
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

            const chartManager = this._timerManager._chartManager;
            let price = chartManager.currentRealPrice;
            
            // Если real-time цена недоступна, используем последнюю свечу
            if (price == null || isNaN(price) || price <= 0) {
                const lastCandle = chartManager.chartData[chartManager.chartData.length - 1];
                if (lastCandle && lastCandle.close != null) {
                    price = lastCandle.close;
                }
            }
            
            if (price == null || isNaN(price) || price <= 0) return;

            // Получаем координату через API графика
            let yCoord = null;
            
            if (this._timerManager._primitive?._chart) {
                try {
                    const chart = this._timerManager._primitive._chart;
                    const coordinate = chart.priceScale().priceToCoordinate(price);
                    if (coordinate != null && !isNaN(coordinate)) {
                        yCoord = coordinate;
                    }
                } catch(e) {}
            }
            
            // Fallback: через серию
            if (yCoord == null) {
                const activeSeries = chartManager.currentChartType === 'candle' 
                    ? chartManager.candleSeries 
                    : chartManager.barSeries;
                
                if (activeSeries) {
                    yCoord = activeSeries.priceToCoordinate(price);
                }
            }
            
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

            // 🔥 ВСЕГДА получаем актуальный цвет (без кеширования)
            const bgColor = this._getCurrentColor(chartManager);

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

    renderer() { 
        return this._renderer; 
    }
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
        this._lastPrice = null;
    }

    paneViews() { 
        return [this._paneView]; 
    }

    attached({ chart, series, requestUpdate }) {
        this._chart = chart;
        this._series = series;
        this._requestUpdate = requestUpdate;
        
        this._lastPrice = null;
        
        if (this._chartManager?.chartData?.length > 0) {
            this._dataReady = true;
        }
    }

    detached() { 
        this._dataReady = false;
        this._lastPrice = null;
    }
    
    updateAllViews() {}

    requestRedraw() {
        if (this._requestUpdate) {
            this._requestUpdate();
        }
    }

    setEnabled(enabled) {
        if (this._paneView?._renderer) {
            const wasEnabled = this._paneView._renderer.enabled;
            this._paneView._renderer.enabled = enabled;
            if (enabled && !wasEnabled) {
                this._lastPrice = null;
                this.requestRedraw();
            }
        }
    }

    isEnabled() { 
        return this._paneView?._renderer?.enabled ?? false; 
    }
    
    updatePrice(price) {
        if (price != null && !isNaN(price) && price !== this._lastPrice) {
            this._lastPrice = price;
            if (this.isEnabled()) {
                this.requestRedraw();
            }
        }
    }

    setDataReady(ready) { 
        this._dataReady = ready; 
        if (ready) {
            this._lastPrice = null;
        }
    }
    
    isDataReady() { 
        return this._dataReady; 
    }
}

class TimerManager {
    constructor(chartManager) {
        this._chartManager = chartManager;
        this._interval = null;
        this._currentTf = CONFIG.defaultInterval || '1h';
        this._primitive = null;
        this._timerElement = { textContent: '' };
        this._disabled = false;
        
        this._priceSubscribed = false;
        this._priceHandler = null;
        this._subscribedSymbolKey = null;
        this._colorChangeUnsubscribe = null;
        this._initialized = false;

        chartManager.timerManager = this;
        setTimeout(() => this._init(), 300);
    }

    _init() {
        if (this._disabled || !this._chartManager?.chart) return;

        this._detachPrimitive();

        this._primitive = new TimerPrimitive(this, this._chartManager);
        const series = this._chartManager.currentChartType === 'candle' 
            ? this._chartManager.candleSeries 
            : this._chartManager.barSeries;

        if (series) {
            try {
                series.attachPrimitive(this._primitive);
                this._primitive.setEnabled(false);

                series.subscribeDataChanged(() => {
                    if (this._primitive && this._chartManager.chartData?.length > 0) {
                        if (!this._primitive.isDataReady()) {
                            this._primitive.setDataReady(true);
                            this._updateTimerState();
                        }
                        this._primitive._lastPrice = null;
                        if (this._primitive.isEnabled()) {
                            this._primitive.requestRedraw();
                        }
                    }
                });
            } catch(e) {
                console.error('TimerManager: Failed to attach primitive', e);
            }
        }
        
        this._subscribeToPrice();
        this._subscribeToColorChanges();
        
        if (this._chartManager.chartData?.length > 0) {
            this._primitive.setDataReady(true);
            this._updateTimerState();
        }
        
        this._initialized = true;
    }
    
    _detachPrimitive() {
        if (this._primitive) {
            try {
                const series = this._chartManager.currentChartType === 'candle'
                    ? this._chartManager.candleSeries 
                    : this._chartManager.barSeries;
                if (series) {
                    series.detachPrimitive(this._primitive);
                }
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
            this._primitive.requestRedraw();
            
            if (this._interval) {
                clearInterval(this._interval);
                this._interval = null;
            }
            this._tick();
            this._interval = setInterval(() => this._tick(), 250);
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
        
        this._priceHandler = (price, symbol, exchange, marketType) => {
            if (document.hidden) return;
            if (!this._primitive?.isEnabled()) return;
            
            if (this._chartManager) {
                this._chartManager.currentRealPrice = price;
            }
            
            this._primitive.updatePrice(price);
        };
        
        try {
            this._chartManager.priceManager.subscribe(
                key, 
                this._priceHandler,
                this._chartManager.currentExchange,
                this._chartManager.currentMarketType
            );
        } catch(e) {
            console.error('TimerManager: Failed to subscribe to price', e);
        }
    }
    
    _subscribeToColorChanges() {
        if (this._colorChangeUnsubscribe) {
            this._colorChangeUnsubscribe();
            this._colorChangeUnsubscribe = null;
        }
        
        if (typeof this._chartManager.onColorChange === 'function') {
            this._colorChangeUnsubscribe = this._chartManager.onColorChange(() => {
                if (this._primitive && this._primitive.isEnabled()) {
                    this._primitive.requestRedraw();
                }
            });
        }
    }
    
    _unsubscribeFromPrice() {
        if (this._priceHandler && this._chartManager?.priceManager && this._subscribedSymbolKey) {
            try {
                this._chartManager.priceManager.unsubscribe(
                    this._subscribedSymbolKey, 
                    this._priceHandler
                );
            } catch(e) {}
        }
        this._priceHandler = null;
        this._priceSubscribed = false;
        this._subscribedSymbolKey = null;
    }

    start(interval) {
        if (this._disabled) return;
        
        const tfChanged = this._currentTf !== interval;
        this._currentTf = interval;

        if (!this._primitive && !this._initialized) {
            this._init();
        }
        
        if (!this._timerElement) {
            this._timerElement = { textContent: '' };
        }

        if (tfChanged && this._initialized) {
            this.stop();
            this.reattach();
        } else if (!tfChanged) {
            this.stop();
            this._updateTimerState();
        }
    }

    _tick() {
        if (this._disabled || !this._timerElement) return;
        if (!this._chartManager?.chartData?.length) return;
        
        if (['1d','1w','1M'].includes(this._currentTf)) {
            this._timerElement.textContent = '';
            this.stop();
            return;
        }

        const dur = TF_DURATIONS[this._currentTf];
        if (!dur) return;

        const left = dur - (Utils.toMoscowTime(Date.now()).getTime() % dur);
        const txt = Utils.formatTimeRemaining(left);

        const textChanged = this._timerElement.textContent !== txt;
        
        if (textChanged) {
            this._timerElement.textContent = txt;
            if (this._primitive?.isEnabled()) {
                this._primitive._lastPrice = null;
                this._primitive.requestRedraw();
            }
        }
        
        if (this._primitive && !this._primitive.isEnabled() && 
            this._primitive.isDataReady() && 
            !['1d','1w','1M'].includes(this._currentTf)) {
            this._primitive.setEnabled(true);
            this._primitive._lastPrice = null;
            this._primitive.requestRedraw();
        }
    }

    stop() {
        if (this._interval) { 
            clearInterval(this._interval); 
            this._interval = null; 
        }
    }

    reattach() {
        if (this._disabled) return;
        
        this._detachPrimitive();
        
        this._primitive = new TimerPrimitive(this, this._chartManager);
        const series = this._chartManager.currentChartType === 'candle'
            ? this._chartManager.candleSeries 
            : this._chartManager.barSeries;

        if (series) {
            try {
                series.attachPrimitive(this._primitive);
                
                series.subscribeDataChanged(() => {
                    if (this._primitive && this._chartManager.chartData?.length > 0) {
                        if (!this._primitive.isDataReady()) {
                            this._primitive.setDataReady(true);
                            this._updateTimerState();
                        }
                        this._primitive._lastPrice = null;
                        if (this._primitive.isEnabled()) {
                            this._primitive.requestRedraw();
                        }
                    }
                });
                
                if (this._chartManager.chartData?.length > 0) {
                    this._primitive.setDataReady(true);
                    this._updateTimerState();
                }
            } catch(e) {
                console.error('TimerManager: Failed to reattach primitive', e);
            }
        }
        
        this._subscribeToPrice();
        this._subscribeToColorChanges();
    }

    destroy() {
        this.stop();
        this._unsubscribeFromPrice();
        
        if (this._colorChangeUnsubscribe) {
            this._colorChangeUnsubscribe();
            this._colorChangeUnsubscribe = null;
        }
        
        this._detachPrimitive();
        this._initialized = false;
    }
}

if (typeof window !== 'undefined') {
    window.TimerManager = TimerManager;
}
