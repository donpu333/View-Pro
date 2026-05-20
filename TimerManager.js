// ========== ВСПОМОГАТЕЛЬНЫЕ КЛАССЫ ==========

class TimerRenderer {
    constructor(timerManager) {
        this._timerManager = timerManager;
        this.enabled = true;
    }

       draw(target) {
    if (!this.enabled) return;
    
    target.useBitmapCoordinateSpace(scope => {
        const ctx = scope.context;
        const chartManager = this._timerManager._chartManager;
        if (!chartManager) return;
        
        // ✅ Защита: ждём данные
        if (!chartManager.chartData || chartManager.chartData.length === 0) return;
        
        const timerText = this._timerManager._timerElement?.textContent || '';
        if (!timerText) return;
        
        const hpr = scope.horizontalPixelRatio;
        const vpr = scope.verticalPixelRatio;
        
        const fontSize = 11 * vpr;
        ctx.font = `bold ${fontSize}px 'Inter', Arial, sans-serif`;
        const textWidth = ctx.measureText(timerText).width;
        
        const padding = 8 * hpr;
        const rectWidth = textWidth + padding * 2;
        const rectHeight = fontSize + 8 * vpr;
        
        const canvasWidth = scope.mediaSize.width * hpr;
        const rectX = canvasWidth - rectWidth - 5 * hpr;
        
        // ✅ БЕРЁМ ЦЕНУ ТАК ЖЕ, КАК ЛИНИЯ ЦЕНЫ
        let price = chartManager.currentRealPrice;
        if (!price || isNaN(price) || price <= 0) {
            // Фолбэк: последняя цена из данных
            const lastCandle = chartManager.chartData[chartManager.chartData.length - 1];
            price = lastCandle ? lastCandle.close : null;
        }

        if (!price || isNaN(price) || price <= 0) return;

        const activeSeries = chartManager.currentChartType === 'candle' 
            ? chartManager.candleSeries 
            : chartManager.barSeries;
        
        if (!activeSeries) return;

        // ✅ ПОЛУЧАЕМ КООРДИНАТУ ТАК ЖЕ, КАК ЛИНИЯ ЦЕНЫ
        let rawYCoord = activeSeries.priceToCoordinate(price);

        if (rawYCoord === null || isNaN(rawYCoord)) return;
        
        // ✅ ИСПОЛЬЗУЕМ ТУ ЖЕ ЛОГИКУ ЧТО И ЛИНИЯ ЦЕНЫ
        // Линия цены не использует vpr для позиции — координата уже в логических пикселях
        let rectY = rawYCoord - rectHeight / 2;
        
        // ✅ Ограничиваем, чтобы таймер не уходил за пределы
        const chartHeight = scope.mediaSize.height;
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
        ctx.shadowBlur = 4 * hpr;
        ctx.beginPath();
        this._roundRect(ctx, rectX, rectY, rectWidth, rectHeight, 4 * hpr);
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
        setTimeout(() => this._createPrimitive(), 500);
    }
_createPrimitive() {
    if (this._disabled) return;
    if (!this._chartManager || !this._chartManager.chart) return;
    
    // Удаляем старый примитив если есть
    if (this._primitive) {
        try {
            const oldSeries = this._chartManager.currentChartType === 'candle' 
                ? this._chartManager.candleSeries 
                : this._chartManager.barSeries;
            if (oldSeries) oldSeries.detachPrimitive(this._primitive);
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
            
            // Для дневных ТФ — скрываем
            if (this._isDayTimeframe(this._currentTf)) {
                this._primitive.setEnabled(false);
            } else {
                // ✅ ВКЛЮЧАЕМ, но позицию установим когда данные загрузятся
                this._primitive.setEnabled(true);
                // ✅ ЗАПУСКАЕМ ОЖИДАНИЕ ДАННЫХ
                this._waitForDataAndUpdate(series);
            }
            
            // Подписка на обновления данных в будущем
            series.subscribeDataChanged(() => {
                if (this._primitive && this._primitive.isEnabled() && 
                    this._chartManager.chartData && this._chartManager.chartData.length > 0) {
                    this._primitive.requestRedraw();
                }
            });
            
            console.log('✅ TimerManager: примитив создан, ждём данные...');
        } catch (e) {
            console.warn('❌ TimerManager: ошибка создания примитива:', e);
        }
    }
}

// ✅ НОВЫЙ МЕТОД: ожидание загрузки данных
_waitForDataAndUpdate(series) {
    let attempts = 0;
    const maxAttempts = 50; // 5 секунд максимум
    
    const checkData = () => {
        attempts++;
        
        // Проверяем, что менеджер и примитив всё ещё существуют
        if (!this._chartManager || !this._primitive) return;
        
        // Проверяем, что данные загружены
        if (this._chartManager.chartData && this._chartManager.chartData.length > 0) {
            // ✅ ДАННЫЕ ГОТОВЫ — ОБНОВЛЯЕМ ПОЗИЦИЮ
            if (this._primitive.isEnabled()) {
                this._primitive.requestRedraw();
                console.log(`✅ TimerManager: данные загружены (попытка ${attempts}), позиция обновлена`);
            }
            return; // Выходим из цикла
        }
        
        // Если превысили лимит попыток
        if (attempts >= maxAttempts) {
            console.warn('⚠️ TimerManager: не удалось дождаться данных');
            return;
        }
        
        // Пробуем ещё раз через 100мс
        setTimeout(checkData, 100);
    };
    
    // Запускаем первую проверку с небольшой задержкой
    setTimeout(checkData, 50);
}

// ✅ НОВЫЙ МЕТОД: ожидание загрузки данных
_waitForDataAndUpdate(series) {
    let attempts = 0;
    const maxAttempts = 50; // 5 секунд максимум
    
    const checkData = () => {
        attempts++;
        
        // Проверяем, что менеджер и примитив всё ещё существуют
        if (!this._chartManager || !this._primitive) return;
        
        // Проверяем, что данные загружены
        if (this._chartManager.chartData && this._chartManager.chartData.length > 0) {
            // ✅ ДАННЫЕ ГОТОВЫ — ОБНОВЛЯЕМ ПОЗИЦИЮ
            if (this._primitive.isEnabled()) {
                this._primitive.requestRedraw();
                console.log(`✅ TimerManager: данные загружены (попытка ${attempts}), позиция обновлена`);
            }
            return; // Выходим из цикла
        }
        
        // Если превысили лимит попыток
        if (attempts >= maxAttempts) {
            console.warn('⚠️ TimerManager: не удалось дождаться данных');
            return;
        }
        
        // Пробуем ещё раз через 100мс
        setTimeout(checkData, 100);
    };
    
    // Запускаем первую проверку с небольшой задержкой
    setTimeout(checkData, 50);
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
        
        // ✅ Если примитив уничтожен — пересоздаём
        if (!this._primitive) {
            this._createPrimitive();
        }
        
        // ✅ Если _timerElement уничтожен — пересоздаём
        if (!this._timerElement) {
            this._timerElement = { textContent: '' };
        }
        
        this._updateTimer();
        this.stop();
        this._interval = setInterval(() => this._updateTimer(), 250);
    }

    _updateTimer() {
        if (this._disabled) return;
        if (!this._timerElement) return;
        
        // ✅ Защита: если данных нет — не обновляем
        if (!this._chartManager.chartData || this._chartManager.chartData.length === 0) return;
        
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
    
    // Если примитива вообще нет — создаём (там уже будет ожидание данных)
    if (!this._primitive) {
        this._createPrimitive();
        return;
    }
    
    const wasEnabled = this._primitive.isEnabled();
    
    // Отсоединяем от старой серии
    try {
        const oldSeries = this._chartManager.currentChartType === 'candle' 
            ? this._chartManager.barSeries 
            : this._chartManager.candleSeries;
        if (oldSeries) oldSeries.detachPrimitive(this._primitive);
    } catch (e) {}
    
    // Присоединяем к новой серии
    const newSeries = this._chartManager.currentChartType === 'candle' 
        ? this._chartManager.candleSeries 
        : this._chartManager.barSeries;
    
    if (newSeries) {
        try {
            newSeries.attachPrimitive(this._primitive);
            
            if (wasEnabled) {
                this._primitive.setEnabled(true);
                
                // ✅ Даём команду на перерисовку — координата цены готова
                // Небольшая задержка, чтобы series точно инициализировал примитив
                setTimeout(() => {
                    if (this._primitive && this._primitive.isEnabled()) {
                        this._primitive.requestRedraw();
                    }
                }, 10);
            }
        } catch (e) {
            console.warn('❌ TimerManager: ошибка в reattach:', e);
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
        // ✅ НЕ обнуляем _timerElement — start() его пересоздаст
    }
}


if (typeof window !== 'undefined') {
    window.TimerManager = TimerManager;
}
