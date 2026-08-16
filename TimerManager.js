class TimerManager {
    constructor(chartManager) {
        this._chartManager = chartManager;
        this._interval = null;
        this._currentTf = CONFIG.defaultInterval || '1h';
        this._labelElement = null;      // Единая плашка
        this._priceRow = null;          // Строка с ценой
        this._timerRow = null;          // Строка с таймером
        this._disabled = false;
        this._initialized = false;
        this._currentPrice = null;
        this._rafId = null;
        this._lastTop = null;
        this._lastColor = null;
        this._lastWidth = null;
        this._scaleObserver = null;
        this._lastScaleCanvas = null;
        this._isVisible = false;
        this._showTimerRow = true;

        if (chartManager.timerManager) {
            chartManager.timerManager.destroy();
        }
        chartManager.timerManager = this;
        
        setTimeout(() => this._init(), 100);
    }

    _init() {
        if (this._disabled || !this._chartManager?.chart) return;

        document.querySelectorAll('#price-timer-label').forEach(el => el.remove());

        // ✅ ЕДИНАЯ ПЛАШКА: контейнер с двумя строками
        this._labelElement = document.createElement('div');
        this._labelElement.id = 'price-timer-label';
        
        const initColor = this._getCurrentColor();
        this._lastColor = initColor;
        const initWidth = 90;
        this._lastWidth = initWidth;

        this._labelElement.style.cssText = `
            position: absolute;
            right: 0px;
            left: auto;
            width: ${initWidth}px;
            pointer-events: none;
            z-index: 999;
            font-family: 'Inter', Arial, sans-serif;
            visibility: hidden;
            opacity: 0;
            background-color: ${initColor};
            border-radius: 3px;
            text-align: center;
            box-sizing: border-box;
            will-change: top, opacity, width;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            line-height: 1.2;
        `;

        // ✅ СТРОКА 1: ЦЕНА
        this._priceRow = document.createElement('div');
        this._priceRow.style.cssText = `
            font-weight: bold;
            font-size: 11px;
            color: #ffffff;
            padding: 2px 6px 1px 6px;
            white-space: nowrap;
            overflow: hidden;
        `;
        this._priceRow.textContent = '';

        // ✅ СТРОКА 2: ТАЙМЕР
        this._timerRow = document.createElement('div');
        this._timerRow.style.cssText = `
            font-weight: bold;
            font-size: 10px;
            color: rgba(255, 255, 255, 0.95);
            padding: 0 6px 2px 6px;
            white-space: nowrap;
            overflow: hidden;
        `;
        this._timerRow.textContent = '';

        this._labelElement.appendChild(this._priceRow);
        this._labelElement.appendChild(this._timerRow);

        const container = this._chartManager.chartContainer;
        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        container.appendChild(this._labelElement);
        this._initialized = true;

        this._attachScaleObserver();
        this._updateTimerState();
        this._startTracking();
        
        setTimeout(() => this._forceUpdate(), 150);
    }

    _attachScaleObserver() {
        const cm = this._chartManager;
        if (!cm?.chartContainer) return;

        const canvases = cm.chartContainer.querySelectorAll('canvas');
        if (canvases.length < 2) {
            setTimeout(() => this._attachScaleObserver(), 300);
            return;
        }
        
        const scaleCanvas = canvases[canvases.length - 1];
        if (this._lastScaleCanvas === scaleCanvas) return;
        
        this._lastScaleCanvas = scaleCanvas;
        
        if (this._scaleObserver) {
            this._scaleObserver.disconnect();
            this._scaleObserver = null;
        }

        this._scaleObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const newWidth = Math.round(entry.contentRect.width);
                if (newWidth > 30 && newWidth !== this._lastWidth) {
                    this._lastWidth = newWidth;
                    if (this._labelElement) {
                        this._labelElement.style.width = newWidth + 'px';
                    }
                }
            }
        });
        
        this._scaleObserver.observe(scaleCanvas);
        
        const rect = scaleCanvas.getBoundingClientRect();
        if (rect.width > 30) {
            this._lastWidth = Math.round(rect.width);
            if (this._labelElement) {
                this._labelElement.style.width = this._lastWidth + 'px';
            }
        }
    }

    _getCurrentColor() {
        const cm = this._chartManager;
        if (cm?._lastAppliedColor) return cm._lastAppliedColor;
        if (cm?.lastCandle) {
            const price = cm.currentRealPrice || cm.lastCandle.close;
            const isBullish = price >= cm.lastCandle.open;
            return isBullish 
                ? (cm.bullishColor || CONFIG.colors.bullish || '#26a69a') 
                : (cm.bearishColor || CONFIG.colors.bearish || '#ef5350');
        }
        return cm?.bullishColor || CONFIG.colors.bullish || '#26a69a';
    }

    _getPriceScaleWidth() {
        const cm = this._chartManager;
        if (!cm?.chartContainer) return this._lastWidth || 90;
        
        const canvases = cm.chartContainer.querySelectorAll('canvas');
        if (canvases.length >= 2) {
            const lastCanvas = canvases[canvases.length - 1];
            const rect = lastCanvas.getBoundingClientRect();
            if (rect.width > 30) return Math.round(rect.width);
        }
        
        return this._lastWidth || 90;
    }

    _startTracking() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        
        const track = () => {
            if (this._labelElement) {
                const price = this._currentPrice || 
                             this._chartManager.currentRealPrice || 
                             this._chartManager.lastCandle?.close;
                             
                if (price != null && !isNaN(price) && price > 0) {
                    this._updatePosition(price);
                }
                
                this._updateColor();
            }
            this._rafId = requestAnimationFrame(track);
        };
        
        track();
    }

    _updateColor() {
        if (!this._labelElement) return;
        const targetColor = this._getCurrentColor();
        
        if (targetColor !== this._lastColor) {
            this._lastColor = targetColor;
            this._labelElement.style.backgroundColor = targetColor;
        }
    }

    _updateTimerState() {
        if (!this._labelElement) return;
        
        // ✅ На длинных ТФ скрываем строку таймера, плашка становится ниже
        if (['1d','1w','1M'].includes(this._currentTf)) {
            this._showTimerRow = false;
            this._timerRow.style.display = 'none';
            this.stop();
        } else {
            this._showTimerRow = true;
            this._timerRow.style.display = 'block';
            this._tick();
            if (this._interval) clearInterval(this._interval);
            this._interval = setInterval(() => this._tick(), 250);
        }
    }

    updatePrice(price) {
        if (this._disabled || !this._labelElement) return;
        this._currentPrice = price;
        
        // Обновляем текст цены
        if (price != null && !isNaN(price)) {
            this._updatePriceText(price);
        }
    }

    _updatePriceText(price) {
        if (!this._priceRow) return;
        const cm = this._chartManager;
        const activeSeries = cm?.currentChartType === 'candle' ? cm.candleSeries : cm?.barSeries;
        const precision = activeSeries?.options()?.priceFormat?.precision ?? 2;
        const text = Number(price).toFixed(precision);
        if (this._priceRow.textContent !== text) {
            this._priceRow.textContent = text;
        }
    }

    _showLabel() {
        if (!this._labelElement) return;
        if (!this._isVisible) {
            this._isVisible = true;
            this._labelElement.style.visibility = 'visible';
            this._labelElement.style.opacity = '1';
        }
    }

    _hideLabel() {
        if (!this._labelElement) return;
        if (this._isVisible) {
            this._isVisible = false;
            this._labelElement.style.visibility = 'hidden';
            this._labelElement.style.opacity = '0';
        }
    }

    _updatePosition(price) {
        if (!this._labelElement) return;
        if (price == null || isNaN(price) || price <= 0) {
            this._hideLabel();
            return;
        }
        
        const cm = this._chartManager;
        if (!cm || !cm.chartContainer || !cm.chartData?.length) {
            this._hideLabel();
            return;
        }
        
        const activeSeries = cm.currentChartType === 'candle' ? cm.candleSeries : cm.barSeries;
        if (!activeSeries) {
            this._hideLabel();
            return;
        }

        let yCoord;
        try {
            yCoord = activeSeries.priceToCoordinate(price);
        } catch (e) {
            this._hideLabel();
            return;
        }
        
        if (yCoord == null || isNaN(yCoord)) {
            this._hideLabel();
            return;
        }

        const containerHeight = cm.chartContainer.clientHeight;
        const labelHeight = this._labelElement.offsetHeight || 20;
        
        // Синхронизация ширины
        const scaleWidth = this._getPriceScaleWidth();
        if (Math.abs(this._lastWidth - scaleWidth) > 2) {
            this._lastWidth = scaleWidth;
            this._labelElement.style.width = scaleWidth + 'px';
        }
        
        if (yCoord < -labelHeight || yCoord > containerHeight + labelHeight) {
            this._hideLabel();
            return;
        }

        this._showLabel();

        // ✅ ПОЗИЦИОНИРОВАНИЕ: строка ЦЕНЫ центрируется по линии цены
        // Высота строки цены ≈ 17px (11px font + 2px padding top + 1px padding bottom + line-height)
        const priceRowHeight = this._priceRow.offsetHeight || 17;
        const priceRowCenter = priceRowHeight / 2;
        
        let top = yCoord - priceRowCenter;
        
        // Защита от выхода за границы
        const maxTop = containerHeight - labelHeight - 3;
        if (top > maxTop) top = maxTop;
        if (top < 3) top = 3;
        
        const finalTop = Math.round(top);
        if (finalTop !== this._lastTop) {
            this._lastTop = finalTop;
            this._labelElement.style.top = finalTop + 'px';
        }
    }

    updatePosition(price) {
        this.updatePrice(price);
        this._updatePosition(price);
    }

    start(interval) {
        if (this._disabled) return;
        this._currentTf = interval;
        if (!this._initialized) {
            this._init();
            return;
        }
        if (!this._labelElement) return;
        this.stop();
        this._updateTimerState();
        
        this._lastWidth = null;
        this._lastTop = null;
        this._lastColor = null;
        this._attachScaleObserver();
        
        this._forceUpdate();
    }

    _tick() {
        if (this._disabled || !this._timerRow) return;
        if (!this._chartManager?.chartData?.length) return;
        if (['1d','1w','1M'].includes(this._currentTf)) {
            this._timerRow.style.display = 'none';
            this.stop();
            return;
        }
        const dur = TF_DURATIONS[this._currentTf];
        if (!dur) return;
        const left = dur - (Utils.toMoscowTime(Date.now()).getTime() % dur);
        const txt = Utils.formatTimeRemaining(left);
        if (this._timerRow.textContent !== txt) {
            this._timerRow.textContent = txt;
        }
    }

    stop() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
    }

    _forceUpdate() {
        if (!this._labelElement) return;
        
        const scaleWidth = this._getPriceScaleWidth();
        if (scaleWidth > 30) {
            this._lastWidth = scaleWidth;
            this._labelElement.style.width = scaleWidth + 'px';
        }
        
        this._lastTop = null;
        this._lastColor = null;
        
        const price = this._currentPrice || 
                     this._chartManager?.currentRealPrice || 
                     this._chartManager?.lastCandle?.close;
        
        if (price != null && !isNaN(price) && price > 0) {
            this._updatePriceText(price);
            this._updatePosition(price);
        }
        
        this._updateColor();
    }

    reattach() {
        this._init();
    }

    destroy() {
        this.stop();
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        if (this._scaleObserver) {
            this._scaleObserver.disconnect();
            this._scaleObserver = null;
        }
        this._lastScaleCanvas = null;
        if (this._labelElement && this._labelElement.parentNode) {
            this._labelElement.parentNode.removeChild(this._labelElement);
        }
        this._labelElement = null;
        this._priceRow = null;
        this._timerRow = null;
        this._initialized = false;
        this._isVisible = false;
    }
}

if (typeof window !== 'undefined') {
    window.TimerManager = TimerManager;
}
