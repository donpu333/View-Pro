class TimerRenderer {
    constructor(timerManager) {
        this._timerManager = timerManager;
        this.enabled = true;
        this._lastValidPosition = null; // ✅ Кешируем ПОЗИЦИЮ!
        this._cachedColor = null;
        this._lastCandleTime = 0;
        this._lastValidY = null; // ✅ Кешируем Y-координату!
        this._priceCheckFailures = 0; // ✅ Счётчик ошибок
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
            
            // ✅✅✅ НАДЁЖНОЕ ПОЛУЧЕНИЕ ЦЕНЫ С ЗАЩИТОЙ
            let price = this._getSafePrice(chartManager);
            
            if (!price || isNaN(price) || price <= 0) {
                // ✅ Если цена не получена - используем кешированную позицию!
                if (this._lastValidPosition) {
                    this._drawAtCachedPosition(ctx, scope, hpr, vpr, timerText);
                }
                return;
            }

            const activeSeries = chartManager.currentChartType === 'candle' 
                ? chartManager.candleSeries 
                : chartManager.barSeries;
            
            if (!activeSeries) {
                if (this._lastValidPosition) {
                    this._drawAtCachedPosition(ctx, scope, hpr, vpr, timerText);
                }
                return;
            }

            // ✅ Получаем Y-координату с защитой от null
            let rawYCoord = activeSeries.priceToCoordinate(price);
            
            // ✅✅✅ ПРОВЕРКА: координата валидна?
            if (rawYCoord === null || isNaN(rawYCoord) || !isFinite(rawYCoord)) {
                this._priceCheckFailures++;
                
                console.warn(`⚠️ Timer: priceToCoordinate вернул ${rawYCoord} для price=${price} (ошибка #${this._priceCheckFailures})`);
                
                // ✅ Используем последнюю валидную позицию!
                if (this._lastValidPosition && this._priceCheckFailures < 10) {
                    this._drawAtCachedPosition(ctx, scope, hpr, vpr, timerText);
                    return;
                }
                
                // Если слишком много ошибок - пытаемся получить Y по-другому
                rawYCoord = this._getFallbackYCoordinate(activeSeries, chartManager);
                
                if (rawYCoord === null) {
                    return; // Нечего рисовать
                }
            } else {
                // ✅ Успех - сбрасываем счётчик ошибок
                this._priceCheckFailures = 0;
                this._lastValidY = rawYCoord; // Кешируем успешную Y
            }
            
            const bitmapY = rawYCoord * vpr;
            
            const bitmapWidth = scope.mediaSize.width * hpr;
            const bitmapHeight = scope.mediaSize.height * vpr;
            
            // ✅ Проверка что Y в пределах канвы
            if (bitmapY < -1000 || bitmapY > bitmapHeight + 1000) {
                console.warn('⚠️ Timer: Y за пределами канвы', { bitmapY, bitmapHeight });
                if (this._lastValidPosition) {
                    this._drawAtCachedPosition(ctx, scope, hpr, vpr, timerText);
                }
                return;
            }
            
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
            
            // ✅ Сохраняем успешную позицию
            this._lastValidPosition = { x: rectX, y: rectY, w: rectWidth, h: rectHeight };
            
            const bgColor = this._getCorrectColor(chartManager);
            
            // === РИСОВАНИЕ ===
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
    
    // ✅✅✅ НОВЫЙ: рисование в кешированной позиции (когда цена недоступна)
    _drawAtCachedPosition(ctx, scope, hpr, vpr, timerText) {
        if (!this._lastValidPosition) return;
        
        const fontSize = Math.round(11 * vpr);
        ctx.font = `bold ${fontSize}px 'Inter', Arial, sans-serif`;
        
        const bgColor = this._getCorrectColor(this._timerManager._chartManager);
        
        ctx.save();
        ctx.fillStyle = bgColor + 'DD';
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = Math.round(4 * hpr);
        ctx.beginPath();
        this._roundRect(
            ctx, 
            this._lastValidPosition.x, 
            this._lastValidPosition.y, 
            this._lastValidPosition.w, 
            this._lastValidPosition.h, 
            Math.round(2 * hpr)
        );
        ctx.fill();
        
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
            timerText, 
            this._lastValidPosition.x + this._lastValidPosition.w / 2, 
            this._lastValidPosition.y + this._lastValidPosition.h / 2
        );
        ctx.restore();
    }
    
    // ✅✅✅ НОВЫЙ: надёжное получение цены с защитой
    _getSafePrice(chartManager) {
        // Способ 1: текущая реальная цена
        let price = chartManager.currentRealPrice;
        
        if (price && !isNaN(price) && price > 0) {
            return price;
        }
        
        // Способ 2: последняя свеча close
        const data = chartManager.chartData;
        if (data && data.length > 0) {
            const lastCandle = data[data.length - 1];
            if (lastCandle && lastCandle.close != null && !isNaN(lastCandle.close) && lastCandle.close > 0) {
                return lastCandle.close;
            }
        }
        
        return null;
    }
    
    // ✅✅✅ НОВЫЙ: fallback для Y-координаты
    _getFallbackYCoordinate(series, chartManager) {
        // Если есть кешированная Y - возвращаем её
        if (this._lastValidY != null) {
            return this._lastValidY;
        }
        
        // Пробуем взять close последней свечи
        const data = chartManager.chartData;
        if (data && data.length > 0) {
            const lastCandle = data[data.length - 1];
            if (lastCandle && lastCandle.close != null) {
                const y = series.priceToCoordinate(lastCandle.close);
                if (y != null && !isNaN(y)) {
                    return y;
                }
            }
        }
        
        // Пребуем предпоследнюю свечу
        if (data && data.length > 1) {
            const prevCandle = data[data.length - 2];
            if (prevCandle && prevCandle.close != null) {
                const y = series.priceToCoordinate(prevCandle.close);
                if (y != null && !isNaN(y)) {
                    return y;
                }
            }
        }
        
        return null;
    }
    
    // ✅ Правильное определение цвета
    _getCorrectColor(chartManager) {
        const data = chartManager.chartData;
        if (!data || data.length === 0) {
            return chartManager.bullishColor || '#00bcd4';
        }
        
        const lastCandle = data[data.length - 1];
        if (!lastCandle) {
            return chartManager.bullishColor || '#00bcd4';
        }
        
        const close = lastCandle.close;
        const open = lastCandle.open;
        
        if (close == null || open == null || isNaN(close) || isNaN(open)) {
            return chartManager.bullishColor || '#00bcd4';
        }
        
        const isBullish = close > open;
        const bullishColor = chartManager.bullishColor || '#00bcd4';
        const bearishColor = chartManager.bearishColor || '#f23645';
        const color = isBullish ? bullishColor : bearishColor;
        
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
    
    resetColorCache() {
        if (this._paneView && this._paneView._renderer) {
            this._paneView._renderer._cachedColor = null;
            this._paneView._renderer._lastCandleTime = 0;
        }
    }
    
    // ✅ Сброс позиции (вызывать при смене символа)
    resetPositionCache() {
        if (this._paneView && this._paneView._renderer) {
            this._paneView._renderer._lastValidPosition = null;
            this._paneView._renderer._lastValidY = null;
            this._paneView._renderer._priceCheckFailures = 0;
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
                        
                        this._primitive.resetColorCache();
                        // ✅ Не сбрасываем позицию при обычном обновлении данных!
                        
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
        this._primitive.resetColorCache();
        this._primitive.resetPositionCache(); // ✅ Сброс позиции при переподключении
        
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
