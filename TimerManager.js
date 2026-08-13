class TimerRenderer {
    constructor(timerManager) {
        this._timerManager = timerManager;
        this.enabled = true;
        this._cachedColor = null;
        this._colorDirty = true;
        // ✅ Кэш для стабильной позиции (не прыгает при каждом тике цены)
        this._cachedY = null;
        this._cachedCandleTime = null;
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

    // ✅ Сброс кэша позиции (вызывается при новой свече или смене ТФ)
    invalidatePosition() {
        this._cachedY = null;
        this._cachedCandleTime = null;
    }

  draw(target) {
    if (!this.enabled) return;
    
    const chartManager = this._timerManager._chartManager;
    if (!chartManager || !chartManager.chartData || chartManager.chartData.length === 0) return;
    
    const timerText = this._timerManager._timerElement?.textContent || '';
    if (!timerText) return;

    const lastCandle = chartManager.chartData[chartManager.chartData.length - 1];
    if (!lastCandle || lastCandle.close == null) return;

    target.useBitmapCoordinateSpace(scope => {
        const ctx = scope.context;
        const hpr = scope.horizontalPixelRatio;
        const vpr = scope.verticalPixelRatio;

        // ✅ СИНХРОНИЗАЦИЯ С ЛИНИЕЙ ЦЕНЫ:
        // Позиция = currentRealPrice (то же, что у линии)
        // Обновляем Y только при сдвиге > 1px (убирает дёрганье)
        let yCoord = null;
        const currentPrice = chartManager.currentRealPrice || lastCandle.close;

        const activeSeries = chartManager.currentChartType === 'candle' 
            ? chartManager.candleSeries 
            : chartManager.barSeries;

        if (activeSeries) {
            const newY = activeSeries.priceToCoordinate(currentPrice);
            
            if (newY != null && !isNaN(newY)) {
                if (this._cachedY === null || 
                    this._cachedCandleTime !== lastCandle.time ||
                    Math.abs(newY - this._cachedY) >= 0.4 ) {
                    this._cachedY = newY;
                    this._cachedCandleTime = lastCandle.time;
                }
                yCoord = this._cachedY;
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

        // ✅ Цвет по currentRealPrice vs open (правильно)
        let bgColor;
        if (this._colorDirty || !this._cachedColor) {
            const isBullish = currentPrice >= lastCandle.open;
            bgColor = isBullish 
                ? (chartManager.bullishColor || (typeof CONFIG !== 'undefined' ? CONFIG.colors?.bullish : null) || '#26a69a')
                : (chartManager.bearishColor || (typeof CONFIG !== 'undefined' ? CONFIG.colors?.bearish : null) || '#ef5350');
            
            if (bgColor) {
                this._cachedColor = bgColor;
                this._colorDirty = false;
            }
        } else {
            bgColor = this._cachedColor;
        }

        if (!bgColor) bgColor = '#26a69a';

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
        this._lastCandleTime = null;  // ✅ было _lastPrice, стало _lastCandleTime
    }

    paneViews() { 
        return [this._paneView]; 
    }

    attached({ chart, series, requestUpdate }) {
        this._chart = chart;
        this._series = series;
        this._requestUpdate = requestUpdate;
        
        this._lastCandleTime = null;
        
        if (this._paneView?._renderer) {
            this._paneView._renderer.invalidateColor();
            this._paneView._renderer.invalidatePosition();
        }
        
        if (this._chartManager?.chartData?.length > 0) {
            this._dataReady = true;
        }
    }

    detached() { 
        this._dataReady = false;
        this._lastCandleTime = null;
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
                this._lastCandleTime = null;
                if (this._paneView._renderer) {
                    this._paneView._renderer.invalidatePosition();
                }
                this.requestRedraw();
            }
        }
    }

    isEnabled() { 
        return this._paneView?._renderer?.enabled ?? false; 
    }

    setColor(color) { 
        if (this._paneView?._renderer) {
            this._paneView._renderer.setColor(color);
        }
    }
    
    // ✅ ИСПРАВЛЕНО: обновляем ТОЛЬКО цвет, НЕ пересчитываем позицию
    updatePrice(price) {
        if (this._paneView?._renderer) {
            this._paneView._renderer.invalidateColor();
            // Позиция НЕ пересчитывается — она привязана к lastCandle.close
        }
        // requestRedraw нужен чтобы перерисовать цвет
        if (this.isEnabled()) {
            this.requestRedraw();
        }
    }

    // ✅ НОВОЕ: вызывается при появлении НОВОЙ свечи — пересчитываем позицию
    onNewCandle() {
        if (this._paneView?._renderer) {
            this._paneView._renderer.invalidatePosition();
        }
        if (this.isEnabled()) {
            this.requestRedraw();
        }
    }

    setDataReady(ready) { 
        this._dataReady = ready; 
        if (ready) {
            this._lastCandleTime = null;
            if (this._paneView?._renderer) {
                this._paneView._renderer.invalidatePosition();
            }
        }
    }
    
    isDataReady() { 
        return this._dataReady; 
    }
    
    invalidateColor() {
        if (this._paneView?._renderer) {
            this._paneView._renderer.invalidateColor();
        }
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

                // ✅ ИСПРАВЛЕННАЯ подписка: пересчитываем позицию ТОЛЬКО при новой свече
                series.subscribeDataChanged(() => {
                    if (this._primitive && this._chartManager.chartData?.length > 0) {
                        const lastCandle = this._chartManager.chartData[this._chartManager.chartData.length - 1];
                        
                        if (!this._primitive.isDataReady()) {
                            this._primitive.setDataReady(true);
                            this._updateTimerState();
                        }
                        
                        // ✅ КЛЮЧЕВОЕ: пересчитываем позицию ТОЛЬКО если пришла НОВАЯ свеча
                        if (lastCandle && this._primitive._lastCandleTime !== lastCandle.time) {
                            this._primitive._lastCandleTime = lastCandle.time;
                            this._primitive.onNewCandle();
                        } else {
                            // Обновляем только цвет (текущая свеча изменилась)
                            if (this._primitive.isEnabled()) {
                                this._primitive.requestRedraw();
                            }
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
        if (this._colorChangeHandler) return;
        
        if (typeof this._chartManager.onColorChange === 'function') {
            this._colorChangeHandler = () => {
                if (this._primitive) {
                    this._primitive.invalidateColor();
                    if (this._primitive.isEnabled()) {
                        this._primitive.requestRedraw();
                    }
                }
            };
            this._chartManager.onColorChange(this._colorChangeHandler);
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

        const dur = (typeof TF_DURATIONS !== 'undefined') ? TF_DURATIONS[this._currentTf] : null;
        if (!dur) return;

        const left = dur - ((typeof Utils !== 'undefined' && Utils.toMoscowTime) 
            ? Utils.toMoscowTime(Date.now()).getTime() % dur 
            : Date.now() % dur);
        const txt = (typeof Utils !== 'undefined' && Utils.formatTimeRemaining) 
            ? Utils.formatTimeRemaining(left) 
            : '';

        const textChanged = this._timerElement.textContent !== txt;
        
        if (textChanged) {
            this._timerElement.textContent = txt;
            // ✅ ИСПРАВЛЕНО: НЕ сбрасываем кэш позиции — просто перерисовываем с той же Y
            if (this._primitive?.isEnabled()) {
                this._primitive.requestRedraw();
            }
        }
        
        if (this._primitive && !this._primitive.isEnabled() && 
            this._primitive.isDataReady() && 
            !['1d','1w','1M'].includes(this._currentTf)) {
            this._primitive.setEnabled(true);
            this._primitive.requestRedraw();
        }
    }

    forceColorUpdate() {
        if (this._primitive) {
            this._primitive.invalidateColor();
            if (this._primitive.isEnabled()) {
                this._primitive.requestRedraw();
            }
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
                
                // ✅ ИСПРАВЛЕННАЯ подписка (как в _init)
                series.subscribeDataChanged(() => {
                    if (this._primitive && this._chartManager.chartData?.length > 0) {
                        const lastCandle = this._chartManager.chartData[this._chartManager.chartData.length - 1];
                        
                        if (!this._primitive.isDataReady()) {
                            this._primitive.setDataReady(true);
                            this._updateTimerState();
                        }
                        
                        // ✅ КЛЮЧЕВОЕ: пересчитываем позицию ТОЛЬКО если пришла НОВАЯ свеча
                        if (lastCandle && this._primitive._lastCandleTime !== lastCandle.time) {
                            this._primitive._lastCandleTime = lastCandle.time;
                            this._primitive.onNewCandle();
                        } else {
                            // Обновляем только цвет (текущая свеча изменилась)
                            if (this._primitive.isEnabled()) {
                                this._primitive.requestRedraw();
                            }
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
