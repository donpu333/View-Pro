// ========== ВСПОМОГАТЕЛЬНЫЕ КЛАССЫ ==========

class TimerRenderer {
    constructor(timerManager) {
        this._timerManager = timerManager;
        this.enabled = true;
    }

   draw(target) {
    if (!this.enabled) return;
    
    // ✅ Используем MEDIA coordinate space, как линия цены
    target.useMediaCoordinateSpace(scope => {
        const ctx = scope.context;
        const chartManager = this._timerManager._chartManager;
        if (!chartManager) return;
        
        if (!chartManager.chartData || chartManager.chartData.length === 0) return;
        
        const timerText = this._timerManager._timerElement?.textContent || '';
        if (!timerText) return;
        
        const fontSize = 11;
        ctx.font = `bold ${fontSize}px 'Inter', Arial, sans-serif`;
        const textWidth = ctx.measureText(timerText).width;
        
        const padding = 8;
        const rectWidth = textWidth + padding * 2;
        const rectHeight = fontSize + 8;
        
        const canvasWidth = scope.mediaSize.width;
        const rectX = canvasWidth - rectWidth - 5;
        
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

        // ✅ В media space координата уже правильная, умножать НЕ НАДО
        let rawYCoord = activeSeries.priceToCoordinate(price);

        if (rawYCoord === null || isNaN(rawYCoord)) return;
        
        let rectY = rawYCoord - rectHeight / 2;
        
        const chartHeight = scope.mediaSize.height; // без умножения!
        if (rectY < 0) rectY = 0;
        if (rectY + rectHeight > chartHeight) rectY = chartHeight - rectHeight;
        
        const lastCandle = chartManager.chartData[chartManager.chartData.length - 1];
        const isBullish = lastCandle ? lastCandle.close > lastCandle.open : true;
        const bullishColor = chartManager.bullishColor || '#00bcd4';
        const bearishColor = chartManager.bearishColor || '#f23645';
        const bgColor = isBullish ? bullishColor : bearishColor;
        
        ctx.save();
        ctx.fillStyle = bgColor;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 4;
        ctx.beginPath();
        this._roundRect(ctx, rectX, rectY, rectWidth, rectHeight, 4);
        ctx.fill();
        
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(timerText, rectX + rectWidth / 2, rectY + rectHeight / 2);
        ctx.restore();
    });
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
    }
    
    paneViews() { 
        return [this._paneView]; 
    }
    
    attached({ chart, series, requestUpdate }) {
        this._chart = chart;
        this._series = series;
        this._requestUpdate = requestUpdate;
    }
    
    detached() {}
    
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
    
    // ✅ НОВЫЕ МЕТОДЫ
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
}
// ========== ОСНОВНОЙ КЛАСС ==========
class TimerManager { 
    constructor(chartManager) {
        this._chartManager = chartManager;
        this._interval = null;
        this._currentTf = CONFIG.defaultInterval || '1h';
        this._primitive = null;
        this._timerElement = { textContent: '' };
        this._disabled = false;
        
        chartManager.timerManager = this;
        
        // ✅ Создаём примитив СРАЗУ, но с проверкой готовности
        this._initAttempts = 0;
        this._tryCreatePrimitive();
    }
    
    _tryCreatePrimitive() {
        if (this._disabled || this._initAttempts > 50) return;
        this._initAttempts++;
        
        if (!this._chartManager?.chart || !this._chartManager?.candleSeries) {
            setTimeout(() => this._tryCreatePrimitive(), 100);
            return;
        }
        
        this._createPrimitive();
    }
    
    _createPrimitive() {
        if (this._disabled) return;
        if (!this._chartManager?.chart) return;
        
        // Удаляем старый примитив если есть
        if (this._primitive) {
            try {
                const series = this._chartManager.currentChartType === 'candle' 
                    ? this._chartManager.candleSeries 
                    : this._chartManager.barSeries;
                if (series) series.detachPrimitive(this._primitive);
            } catch (e) {}
            this._primitive = null;
        }
        
        // Создаём новый примитив
        this._primitive = new TimerPrimitive(this, this._chartManager);
        
        const series = this._chartManager.currentChartType === 'candle' 
            ? this._chartManager.candleSeries 
            : this._chartManager.barSeries;
        
        if (series) {
            try {
                series.attachPrimitive(this._primitive);
                
                // ✅ Всегда включаем (дневные ТФ скроются через updateTimer)
                this._primitive.setEnabled(true);
                
                // ✅ СРАЗУ запрашиваем перерисовку
                // Координата будет получена в draw() через priceToCoordinate
                setTimeout(() => {
                    if (this._primitive?.isEnabled()) {
                        this._primitive.requestRedraw();
                    }
                }, 50);
                
                console.log('✅ TimerManager: примитив создан и прикреплён');
            } catch (e) {
                console.warn('❌ TimerManager: ошибка создания примитива:', e);
            }
        }
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
        
        // Если примитив уничтожен — пересоздаём
        if (!this._primitive) {
            this._createPrimitive();
        }
        
        this._updateTimer();
        this.stop();
        this._interval = setInterval(() => this._updateTimer(), 250);
    }

    _updateTimer() {
        if (this._disabled) return;
        if (!this._timerElement) return;
        
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
                if (!this._primitive.isEnabled()) {
                    this._primitive.setEnabled(true);
                }
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
        
        // Просто пересоздаём примитив
        this._createPrimitive();
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
