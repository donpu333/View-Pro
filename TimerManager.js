class TimerManager {
    constructor(chartManager) {
        this._chartManager = chartManager;
        this._interval = null;
        this._currentTf = CONFIG.defaultInterval || '1h';
        this._labelElement = null;
        this._priceRow = null;
        this._timerRow = null;
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
        this._retryTimeout = null;
        this._retryCount = 0;
        this._initRetryCount = 0;

        if (chartManager.timerManager) {
            chartManager.timerManager.destroy();
        }
        chartManager.timerManager = this;
        
        setTimeout(() => this._init(), 100);
    }

    _init() {
        if (this._disabled || !this._chartManager?.chart) {
            if (this._initRetryCount < 15) {
                this._initRetryCount++;
                setTimeout(() => this._init(), 200);
            }
            return;
        }
        
        this._initRetryCount = 0;

        document.querySelectorAll('#price-timer-label').forEach(el => el.remove());

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

        this._priceRow = document.createElement('div');
        this._priceRow.style.cssText = `
            font-weight: bold;
            font-size:  11px;
            color: #000000;
            padding: 2px 6px 1px 6px;
            white-space: nowrap;
            overflow: hidden;
        `;
        this._priceRow.textContent = '';

        this._timerRow = document.createElement('div');
        this._timerRow.style.cssText = `
            font-weight: bold;
            font-size: 11px;
            color: #000000;
            padding: 0 6px 2px 6px;
            white-space: nowrap;
            overflow: hidden;
        `;
        this._timerRow.textContent = '';

        this._labelElement.appendChild(this._priceRow);
        this._labelElement.appendChild(this._timerRow);

        const initTextColor = this._getContrastTextColor(initColor);
        this._priceRow.style.color = initTextColor;
        this._timerRow.style.color = initTextColor;

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
        setTimeout(() => this._forceUpdate(), 400);
        setTimeout(() => this._forceUpdate(), 800);
        setTimeout(() => this._forceUpdate(), 1500);
        setTimeout(() => this._forceUpdate(), 2500);
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

    _getContrastTextColor(bgColor) {
        if (!bgColor) return '#000000';
        
        let r, g, b;
        
        if (bgColor.startsWith('#')) {
            let hex = bgColor.slice(1);
            if (hex.length === 3) {
                hex = hex.split('').map(c => c + c).join('');
            }
            r = parseInt(hex.slice(0, 2), 16);
            g = parseInt(hex.slice(2, 4), 16);
            b = parseInt(hex.slice(4, 6), 16);
        } else if (bgColor.startsWith('rgb')) {
            const match = bgColor.match(/\d+/g);
            if (match && match.length >= 3) {
                r = parseInt(match[0]);
                g = parseInt(match[1]);
                b = parseInt(match[2]);
            }
        }
        
        if (isNaN(r) || isNaN(g) || isNaN(b)) return '#000000';
        
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        return luminance > 0.55 ? '#000000' : '#ffffff';
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
            if (this._labelElement && !this._disabled) {
                const price = this._currentPrice || 
                             this._chartManager.currentRealPrice || 
                             this._chartManager.lastCandle?.close;
                             
                if (price != null && !isNaN(price) && price > 0) {
                    this._updatePosition(price);
                    
                    // ✅ Страховка: если плашка должна быть видима но случайно скрыта
                    if (this._isVisible && this._labelElement.style.visibility !== 'visible') {
                        this._labelElement.style.visibility = 'visible';
                        this._labelElement.style.opacity = '1';
                    }
                } else if (!this._isVisible) {
                    const lastClose = this._chartManager.lastCandle?.close;
                    if (lastClose != null && !isNaN(lastClose)) {
                        this._updatePosition(lastClose);
                    }
                }
                
                this._updateColor();
            }
            this._rafId = requestAnimationFrame(track);
        };
        
        track();
    }

    _updateColor() {
        if (!this._labelElement || !this._priceRow || !this._timerRow) return;
        const targetColor = this._getCurrentColor();
        
        if (targetColor !== this._lastColor) {
            this._lastColor = targetColor;
            this._labelElement.style.backgroundColor = targetColor;
            
            const textColor = this._getContrastTextColor(targetColor);
            this._priceRow.style.color = textColor;
            this._timerRow.style.color = textColor;
        }
    }

    _updateTimerState() {
        if (!this._labelElement) return;
        
        if (['1d','1w','1M'].includes(this._currentTf)) {
            this._showTimerRow = false;
            if (this._timerRow) this._timerRow.style.display = 'none';
            this.stop();
        } else {
            this._showTimerRow = true;
            if (this._timerRow) this._timerRow.style.display = 'block';
            this._tick();
            if (this._interval) clearInterval(this._interval);
            this._interval = setInterval(() => this._tick(), 250);
        }
    }

    updatePrice(price) {
        if (this._disabled || !this._labelElement) return;
        this._currentPrice = price;
        
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
            this._scheduleRetry();
            return;
        }
        
        const activeSeries = cm.currentChartType === 'candle' ? cm.candleSeries : cm.barSeries;
        if (!activeSeries) {
            this._scheduleRetry();
            return;
        }

        let yCoord;
        try {
            yCoord = activeSeries.priceToCoordinate(price);
        } catch (e) {
            this._scheduleRetry();
            return;
        }
        
        if (yCoord == null || isNaN(yCoord)) {
            this._scheduleRetry();
            return;
        }

        const containerHeight = cm.chartContainer.clientHeight;
        const labelHeight = this._labelElement.offsetHeight || 20;
        
        const scaleWidth = this._getPriceScaleWidth();
        if (Math.abs(this._lastWidth - scaleWidth) > 2) {
            this._lastWidth = scaleWidth;
            this._labelElement.style.width = scaleWidth + 'px';
        }
        
        const hideBuffer = labelHeight * 2;
        if (yCoord < -hideBuffer || yCoord > containerHeight + hideBuffer) {
            this._hideLabel();
            return;
        }

        this._showLabel();

        const priceRowHeight = this._priceRow.offsetHeight || 17;
        const priceRowCenter = priceRowHeight / 2;
        
        let top = yCoord - priceRowCenter;
        
        const maxTop = containerHeight - labelHeight - 3;
        if (top > maxTop) top = maxTop;
        if (top < 3) top = 3;
        
        const finalTop = Math.round(top);
        if (finalTop !== this._lastTop) {
            this._lastTop = finalTop;
            this._labelElement.style.top = finalTop + 'px';
        }
    }
_scheduleRetry() {
    if (this._retryTimeout) {
        clearTimeout(this._retryTimeout);
    }
    
    if (this._retryCount < 15) {
        this._retryCount++;
        
        this._retryTimeout = setTimeout(() => {
            this._retryTimeout = null;
            const price = this._currentPrice || 
                         this._chartManager?.currentRealPrice || 
                         this._chartManager?.lastCandle?.close;
            if (price != null && !isNaN(price) && price > 0) {
                this._updatePosition(price);
            }
        }, 50);  // ← фиксированная задержка 50мс
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
        }
        
        if (!this._labelElement) return;
        this.stop();
        this._updateTimerState();
        
        this._lastWidth = null;
        this._lastTop = null;
        this._lastColor = null;
        this._attachScaleObserver();
        
        this._forceUpdate();
        
        setTimeout(() => this._forceUpdate(), 200);
        setTimeout(() => this._forceUpdate(), 500);
        setTimeout(() => this._forceUpdate(), 1000);
    }

    _tick() {
        if (this._disabled || !this._timerRow) return;
        if (!this._chartManager?.chartData?.length) return;
        if (['1d','1w','1M'].includes(this._currentTf)) {
            if (this._timerRow) this._timerRow.style.display = 'none';
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
        
        this._retryCount = 0;
        if (this._retryTimeout) {
            clearTimeout(this._retryTimeout);
            this._retryTimeout = null;
        }
        
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
        if (this._retryTimeout) {
            clearTimeout(this._retryTimeout);
            this._retryTimeout = null;
        }
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
        this._retryCount = 0;
        this._initRetryCount = 0;
    }
}

if (typeof window !== 'undefined') {
    window.TimerManager = TimerManager;
}
