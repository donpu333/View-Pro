class TimerRenderer {
    constructor(timerManager) {
        this._timerManager = timerManager;
        this.enabled = true;
        this._lastValidPosition = null;
        this._cachedColor = null; // ✅ Кешируем цвет
        this._lastCandleTime = 0; // ✅ Время последней проверки свечи
    }

    draw(target) {
        if (!this.enabled) return;
        
        const chartManager = this._timerManager._chartManager;
        if (!chartManager) return;
        
        if (!chartManager.chartData || chartManager.chartData.length === 0) return;
        
        const timerText = this._timerManager._timerElement?.textContent || '';
        if (!timerText) return;

        target.useBitmapCoordinateSpace(scope => {
            const ctx = scope.context;
            const hpr = scope.horizontalPixelRatio;
            const vpr = scope.verticalPixelRatio;
            
            let price = chartManager.currentRealPrice;
            if (!price || isNaN(price) || price <= 0) {
                const lastCandle = chartManager.chartData[chartManager.chartData.length - 1];
                price = lastCandle ? lastCandle.close : null;
            }
            
            if (!price || isNaN(price) || price <= 0) return;

            const activeSeries = chartManager.currentChartType === 'candle' 
                ? chartManager.candleSeries 
                : chartManager.barSeries;
            
            if (!activeSeries) return;

            let rawYCoord = activeSeries.priceToCoordinate(price);
            if (rawYCoord === null || isNaN(rawYCoord)) return;
            
            const bitmapY = rawYCoord * vpr;
            
            const bitmapWidth = scope.mediaSize.width * hpr;
            const bitmapHeight = scope.mediaSize.height * vpr;
            
            const fontSize = Math.round(11 * vpr);
            ctx.font = `bold ${fontSize}px 'Inter', Arial, sans-serif`;
            const textMetrics = ctx.measureText(timerText);
            const textWidth = textMetrics.width;
            
            const paddingX = Math.round(4 * hpr);
            const paddingY = Math.round(3 * vpr);
            const rectWidth = Math.ceil(textWidth + paddingX * 2);
            const rectHeight = Math.ceil(fontSize + paddingY * 2);
            
            const edgeGap = Math.round(3 * hpr);
            const rectX = bitmapWidth - rectWidth - edgeGap;
            
            let rectY = Math.round(bitmapY - rectHeight / 2);
            const minTop = Math.round(2 * vpr);
            if (rectY < minTop) rectY = minTop;
            if (rectY + rectHeight > bitmapHeight - minTop) {
                rectY = bitmapHeight - rectHeight - minTop;
            }
            
            // ✅✅✅ ПРАВИЛЬНОЕ ОПРЕДЕЛЕНИЕ ЦВЕТА!
            const bgColor = this._getCorrectColor(chartManager);
            
            this._lastValidPosition = { x: rectX, y: rectY };
            
            ctx.save();
            
            ctx.fillStyle = bgColor + 'DD';
            ctx.shadowColor = 'rgba(0,0,0,0.4)';
            ctx.shadowBlur = Math.round(4 * hpr);
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = Math.round(1 * vpr);
            ctx.beginPath();
            this._roundRect(ctx, rectX, rectY, rectWidth, rectHeight, Math.round(2 * hpr));
            ctx.fill();
            
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${fontSize}px 'Inter', Arial, sans-serif`;
            ctx.fillText(timerText, rectX + rectWidth / 2, rectY + rectHeight / 2);
            
            ctx.restore();
        });
    }
    
    // ✅✅✅ НОВЫЙ МЕТОД: правильное определение цвета
    _getCorrectColor(chartManager) {
        const data = chartManager.chartData;
        if (!data || data.length === 0) {
            return chartManager.bullishColor || '#00bcd4';
        }
        
        // Берём ПОСЛЕДНЮЮ свечу
        const lastCandle = data[data.length - 1];
        if (!lastCandle) {
            return chartManager.bullishColor || '#00bcd4';
        }
        
        // ✅ Проверяем все необходимые поля
        const close = lastCandle.close;
        const open = lastCandle.open;
        
        if (close == null || open == null || isNaN(close) || isNaN(open)) {
            return chartManager.bullishColor || '#00bcd4';
        }
        
        // ✅ Определяем бычья/медвежья с учётом точности чисел
        const isBullish = close > open;
        
        // ✅ Берём цвета из настроек графика (гарантированное совпадение!)
        const bullishColor = chartManager.bullishColor || '#00bcd4';
        const bearishColor = chartManager.bearishColor || '#f23645';
        
        const color = isBullish ? bullishColor : bearishColor;
        
        // ✅ Кешируем цвет (чтобы не моргал)
        const candleTime = lastCandle.time || 0;
        if (candleTime !== this._lastCandleTime) {
            this._cachedColor = color;
            this._lastCandleTime = candleTime;
        }
        
        return this._cachedColor || color;
    }
    
    _roundRect(ctx, x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
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
    }
    
    paneViews() { 
        return [this._paneView]; 
    }
    
    attached({ chart, series, requestUpdate }) {
        this._chart = chart;
        this._series = series;
        this._requestUpdate = requestUpdate;
        this._dataReady = false;
    }
    
    detached() {
        this._dataReady = false;
    }
    
    updateAllViews() {}
    
    requestRedraw() {
        if (this._requestUpdate) {
            this._requestUpdate();
        }
    }
    
    setEnabled(enabled) {
        if (this._paneView && this._paneView._renderer) {
            this._paneView._renderer.enabled = enabled;
            this.requestRedraw();
        }
    }
    
    isEnabled() {
        return this._paneView?._renderer?.enabled ?? false;
    }
    
    updateDisplay() {
        this.requestRedraw();
    }
    
    setPrice(price) {
        if (this._paneView) {
            this._paneView._price = price;
        }
    }
    
    setColor(color) {
        if (this._paneView) {
            this._paneView._color = color;
        }
    }

    setDataReady(ready) {
        this._dataReady = ready;
    }

    isDataReady() {
        return this._dataReady;
    }
    
    // ✅ Метод для сброса кеша цвета (вызывать при смене данных)
    resetColorCache() {
        if (this._paneView && this._paneView._renderer) {
            this._paneView._renderer._cachedColor = null;
            this._paneView._renderer._lastCandleTime = 0;
        }
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
        this._isFirstDraw = true;
        this._initialDrawDone = false;
        
        chartManager.timerManager = this;
        setTimeout(() => this._createPrimitive(), 500);
    }

    _createPrimitive() {
        if (this._disabled) return;
        if (!this._chartManager || !this._chartManager.chart) return;
        
        if (this._primitive) {
            try {
                const oldSeries = this._chartManager.currentChartType === 'candle' 
                    ? this._chartManager.candleSeries 
                    : this._chartManager.barSeries;
                if (oldSeries) oldSeries.detachPrimitive(this._primitive);
            } catch (e) {}
            this._primitive = null;
        }
        
        this._isFirstDraw = true;
        this._initialDrawDone = false;
        
        this._primitive = new TimerPrimitive(this, this._chartManager);
        
        const series = this._chartManager.currentChartType === 'candle' 
            ? this._chartManager.candleSeries 
            : this._chartManager.barSeries;
        
        if (series) {
            try {
                series.attachPrimitive(this._primitive);
                
                if (this._isDayTimeframe(this._currentTf)) {
                    this._primitive.setEnabled(false);
                } else {
                    this._primitive.setEnabled(false);
                    this._primitive.setDataReady(false);
                    this._waitForFirstDraw(series);
                }
                
                series.subscribeDataChanged(() => {
                    if (this._primitive && this._chartManager.chartData && 
                        this._chartManager.chartData.length > 0) {
                        
                        // ✅ Сбрасываем кеш цвета при изменении данных!
                        this._primitive.resetColorCache();
                        
                        if (this._primitive && !this._primitive.isDataReady()) {
                            this._primitive.setDataReady(true);
                            
                            if (!this._isDayTimeframe(this._currentTf)) {
                                this._primitive.setEnabled(true);
                            }
                        }
                        
                        if (this._primitive.isEnabled()) {
                            this._primitive.requestRedraw();
                        }
                    }
                });
                
            } catch (e) {
                console.error('❌ TimerManager:', e);
            }
        }
    }

    _waitForFirstDraw(series) {
        let attempts = 0;
        const maxAttempts = 100;
        
        const tryDraw = () => {
            attempts++;
            
            if (!this._chartManager || !this._primitive) return;
            
            const hasData = this._chartManager.chartData && 
                           this._chartManager.chartData.length > 0;
            
            if (hasData) {
                let price = this._chartManager.currentRealPrice;
                if (!price || isNaN(price) || price <= 0) {
                    const lastCandle = this._chartManager.chartData[this._chartManager.chartData.length - 1];
                    price = lastCandle ? lastCandle.close : null;
                }
                
                if (price && !isNaN(price) && price > 0) {
                    this._primitive.setDataReady(true);
                    this._primitive.setEnabled(true);
                    this._initialDrawDone = true;
                    this._isFirstDraw = false;
                    
                    setTimeout(() => {
                        if (this._primitive) {
                            this._primitive.requestRedraw();
                        }
                    }, 50);
                    
                    return;
                }
            }
            
            if (attempts >= maxAttempts) {
                this._primitive.setDataReady(true);
                this._primitive.setEnabled(true);
                return;
            }
            
            setTimeout(tryDraw, 100);
        };
        
        setTimeout(tryDraw, 100);
    }

    _isDayTimeframe(interval) {
        return ['1d', '1w', '1M'].includes(interval);
    }

    start(interval) {
        if (this._disabled) return;
        
        this._currentTf = interval;
        
        if (this._isDayTimeframe(interval)) {
            this._timerElement.textContent = '';
            if (this._primitive) this._primitive.setEnabled(false);
            this.stop();
            return;
        }
        
        if (!this._primitive) {
            this._createPrimitive();
        }
        
        if (!this._timerElement) {
            this._timerElement = { textContent: '' };
        }
        
        if (this._isFirstDraw && this._initialDrawDone) {
            this._isFirstDraw = false;
        }
        
        this._updateTimer();
        this.stop();
        this._interval = setInterval(() => this._updateTimer(), 250);
    }

    _updateTimer() {
        if (this._disabled) return;
        if (!this._timerElement) return;
        
        if (!this._chartManager.chartData || this._chartManager.chartData.length === 0) return;
        
        if (this._primitive && !this._primitive.isDataReady()) {
            return;
        }
        
        if (this._isDayTimeframe(this._currentTf)) {
            this._timerElement.textContent = '';
            if (this._primitive) this._primitive.setEnabled(false);
            return;
        }
        
        const duration = TF_DURATIONS[this._currentTf];
        if (!duration) return;
        
        const now = Date.now();
        const moscowNow = Utils.toMoscowTime(now).getTime();
        const msSinceEpoch = moscowNow % duration;
        const timeLeft = duration - msSinceEpoch;
        
        const newText = Utils.formatTimeRemaining(timeLeft);
        
        if (this._timerElement.textContent !== newText) {
            this._timerElement.textContent = newText;
            
            if (this._primitive) {
                if (!this._primitive.isEnabled() && this._primitive.isDataReady()) {
                    this._primitive.setEnabled(true);
                }
                
                if (this._primitive.isEnabled()) {
                    this._primitive.requestRedraw();
                }
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
        
        if (!this._primitive) {
            this._createPrimitive();
            return;
        }
        
        const wasEnabled = this._primitive.isEnabled();
        
        try {
            const oldSeries = this._chartManager.currentChartType === 'candle' 
                ? this._chartManager.barSeries 
                : this._chartManager.candleSeries;
            if (oldSeries) oldSeries.detachPrimitive(this._primitive);
        } catch (e) {}
        
        this._primitive.setDataReady(false);
        this._primitive.resetColorCache(); // ✅ Сброс кеша при переподключении
        
        const newSeries = this._chartManager.currentChartType === 'candle' 
            ? this._chartManager.candleSeries 
            : this._chartManager.barSeries;
        
        if (newSeries) {
            try {
                newSeries.attachPrimitive(this._primitive);
                
                if (wasEnabled && !this._isDayTimeframe(this._currentTf)) {
                    this._primitive.setEnabled(false);
                    this._waitForFirstDraw(newSeries);
                }
            } catch (e) {
                console.error('❌ TimerManager reattach:', e);
            }
        }
    }

    destroy() {
        this.stop();
        if (this._primitive) {
            try {
                const series = this._chartManager.currentChartType === 'candle' 
                    ? this._chartManager.candleSeries 
                    : this._chartManager.barSeries;
                if (series) series.detachPrimitive(this._primitive);
            } catch (e) {}
            this._primitive = null;
        }
    }
}

if (typeof window !== 'undefined') {
    window.TimerManager = TimerManager;
}
