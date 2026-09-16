

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

    // ✅ Определяем, тёмный ли цвет (по яркости) - идентично ChartManager
    _isDarkColor(hexColor) {
        if (!hexColor || typeof hexColor !== 'string') return false;
        let hex = hexColor.replace('#', '');
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        if (hex.length !== 6) return false;
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return ((r * 299) + (g * 587) + (b * 114)) / 1000 < 150;
    }

    // ✅ Получаем цвет текста для плашки - идентично ChartManager
    _getTextColorForBackground(bgColor) {
        return this._isDarkColor(bgColor) ? '#ffffff' : '#000000';
    }

    draw(target) {
        if (!this.enabled) return;

        const chartManager = this._timerManager?._chartManager;
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

            // ✅ Цвет берётся ТОЧНО так же, как ChartManager рисует плашку цены
            let bgColor = '#26a69a'; // дефолт

            if (this._colorDirty || !this._cachedColor) {
                // 1. Приоритет: родной метод ChartManager, который использует сама плашка цены
                if (typeof chartManager._getLineColor === 'function') {
                    bgColor = chartManager._getLineColor();
                }
                // 2. Альтернативный родной метод
                else if (typeof chartManager.getCurrentPriceColor === 'function') {
                    bgColor = chartManager.getCurrentPriceColor();
                }
                // 3. Фолбэк: идентичная логика вычисления, если методы вдруг недоступны
                else {
                    const isBullish = lastCandle.close >= lastCandle.open;
                    bgColor = isBullish
                        ? (chartManager.bullishColor || '#26a69a')
                        : (chartManager.bearishColor || '#ef5350');
                }

                this._cachedColor = bgColor;
                this._colorDirty = false;
            } else {
                bgColor = this._cachedColor;
            }

            ctx.save();
            ctx.fillStyle = bgColor;
            ctx.shadowColor = 'rgba(0,0,0,0.4)';
            ctx.shadowBlur = 4 * hpr;
            this._roundRect(ctx, rectX, rectY, rectWidth, rectHeight, 3 * hpr);
            ctx.fill();

            ctx.shadowBlur = 0;

            // ✅ Цвет текста автоматически подстраивается под фон (белый на тёмном, чёрный на светлом)
            const textColor = this._getTextColorForBackground(bgColor);
            ctx.fillStyle = textColor;
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
        // T-FIX #7: очищаем ссылки отсоединённого примитива, чтобы
        // requestRedraw() не вызывал stale-requestUpdate
        this._chart = null;
        this._requestUpdate = null;
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
            // ✅ Сбрасываем кэш цвета: свеча могла сменить направление
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

        // T-FIX #2/#6/#8: служебные поля
        this._attachedSeries = null;      // серия, к которой РЕАЛЬНО прикреплён примитив
        this._destroyed = false;          // запрет фоновых циклов после destroy
        this._priceRetryTimeout = null;   // отменяемый ретрай подписки на цену
        this._initTimeout = null;         // отменяемый отложенный _init
        this._symbolChangeHandler = null; // переподписка при смене символа

        chartManager.timerManager = this;

        this._initTimeout = setTimeout(() => {
            this._initTimeout = null;
            this._init();
        }, 300);
    }

    // T-FIX #9: единая точка установки подписки на смену символа.
    // Раньше это было зашито только в _init(), и если reattach() вызывался
    // ДО срабатывания отложенного _init (первые 300мс), _init выходил рано
    // по флагу _initialized, и подписка НИКОГДА не создавалась.
    _ensureSymbolChangeSubscription() {
        if (this._destroyed || this._symbolChangeHandler) return;
        if (typeof this._chartManager?._subscribeToSymbolChange !== 'function') return;

        this._symbolChangeHandler = () => {
            if (this._destroyed) return;
            this._subscribeToPrice();
        };
        this._chartManager._subscribeToSymbolChange(this._symbolChangeHandler);
    }

    _init() {
        if (this._disabled || this._destroyed || !this._chartManager?.chart) return;

        // ✅ Проверяем, не инициализирован ли уже
        if (this._initialized && this._primitive) {
            // T-FIX #9: даже при раннем выходе гарантируем, что подписка
            // на смену символа установлена (её мог пропустить reattach()).
            this._ensureSymbolChangeSubscription();
            return;
        }

        this._attachToSeries(this._chartManager.currentChartType === 'candle'
            ? this._chartManager.candleSeries : this._chartManager.barSeries);
        this._subscribeToPrice();
        this._subscribeToColorChanges();

        // T-FIX #1 + #9: переподписываемся на цену при смене символа/биржи/рынка.
        this._ensureSymbolChangeSubscription();

        this._initialized = true;
    }

    _attachToSeries(series) {
        // ✅ Сначала полностью очищаем старый примитив
        this._detachPrimitive();

        if (!series) {
            console.warn('TimerManager: Series is null');
            return;
        }

        if (!this._chartManager?.chart) {
            console.warn('TimerManager: Chart is null');
            return;
        }

        this._primitive = new TimerPrimitive(this, this._chartManager);

        // T-FIX #3: attachPrimitive — единственная КРИТИЧНАЯ операция.
        // Всё остальное (подписки) выполняется в отдельных защищённых блоках:
        // их отказ больше не обнуляет _primitive и не оставляет сироту на серии.
        try {
            series.attachPrimitive(this._primitive);
            this._attachedSeries = series; // T-FIX #2: запоминаем РЕАЛЬНУЮ серию
        } catch (e) {
            console.error('TimerManager: Failed to attach primitive', e);
            this._primitive = null;
            this._attachedSeries = null;
            return;
        }

        // ✅ Сначала отключаем примитив (включится в _updateTimerState)
        this._primitive.setEnabled(false);

        // T-FIX #3: subscribeDataChanged() есть не во всех версиях
        // lightweight-charts — раньше его отсутствие (TypeError) убивало весь
        // примитив. Обновления бейджа в любом случае приходят из _tick (250мс),
        // updatePrice и updateAllViews, поэтому подписка — лишь дополнение.
        if (typeof series.subscribeDataChanged === 'function') {
            try {
                this._dataChangedUnsubscribe = series.subscribeDataChanged(() => {
                    if (!this._primitive || !this._chartManager?.chartData?.length) return;

                    if (!this._primitive.isDataReady()) {
                        this._primitive.setDataReady(true);
                        this._updateTimerState();
                    }

                    if (this._primitive.isEnabled()) {
                        this._primitive.invalidateColor();
                        this._primitive.requestRedraw();
                    }
                });
            } catch (e) {
                console.warn('TimerManager: subscribeDataChanged failed', e);
                this._dataChangedUnsubscribe = null;
            }
        }

        // ✅ Подписка на скролл — тоже в отдельном блоке
        try {
            const timeScale = this._chartManager.chart.timeScale();
            if (timeScale && typeof timeScale.subscribeVisibleLogicalRangeChange === 'function') {
                this._scrollHandler = () => {
                    if (this._primitive?.isEnabled()) {
                        this._primitive.requestRedraw();
                    }
                };
                timeScale.subscribeVisibleLogicalRangeChange(this._scrollHandler);
            }
        } catch (e) {
            console.warn('TimerManager: scroll subscribe failed', e);
            this._scrollHandler = null;
        }

        // ✅ Обновляем состояние если данные уже есть
        if (this._chartManager.chartData?.length > 0 && this._primitive) {
            this._primitive.setDataReady(true);
            this._updateTimerState();
        }
    }

    _detachPrimitive() {
        // ✅ Отписываемся от изменений данных
        if (this._dataChangedUnsubscribe) {
            try {
                this._dataChangedUnsubscribe();
            } catch(e) {
                console.warn('TimerManager: Error unsubscribing from data changes', e);
            }
            this._dataChangedUnsubscribe = null;
        }

        // ✅ Отписываемся от скролла
        if (this._scrollHandler && this._chartManager?.chart?.timeScale()) {
            try {
                this._chartManager.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this._scrollHandler);
            } catch(e) {
                console.warn('TimerManager: Error unsubscribing from scroll', e);
            }
            this._scrollHandler = null;
        }

        // ✅ Отключаем примитив от серии
        if (this._primitive) {
            try {
                // T-FIX #2: отцепляем ОТ ТОЙ серии, к которой примитив был
                // реально прикреплён.
                const series = this._attachedSeries ||
                    (this._chartManager?.currentChartType === 'candle'
                        ? this._chartManager?.candleSeries
                        : this._chartManager?.barSeries);

                if (series && typeof series.detachPrimitive === 'function') {
                    series.detachPrimitive(this._primitive);
                }
            } catch(e) {
                console.warn('TimerManager: Error detaching primitive', e);
            }
            this._primitive = null;
            this._attachedSeries = null;
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

        // T-FIX #6: после destroy больше не подписываемся
        if (this._destroyed) return;

        if (!this._chartManager?.priceManager) {
            // T-FIX #6: ретрай сохраняется — его можно отменить в
            // destroy()/detach() (раньше цикл 200мс крутился вечно).
            this._priceRetryTimeout = setTimeout(() => {
                this._priceRetryTimeout = null;
                if (this._destroyed) return;
                this._subscribeToPrice();
            }, 200);
            return;
        }

        const key = this._chartManager.getCurrentSymbolKey();
        if (!key) return;

        this._subscribedSymbolKey = key;
        this._priceSubscribed = true;

        this._priceHandler = (price, symbol, exchange, marketType) => {
            if (this._destroyed || document.hidden || !this._primitive?.isEnabled()) return;

            const cm = this._chartManager;
            if (!cm) return;

            // T-FIX #1: отсекаем тики ЧУЖОГО символа/биржи/рынка.
            if (symbol && cm.currentSymbol && symbol !== cm.currentSymbol) return;
            if (exchange && cm.currentExchange && exchange !== cm.currentExchange) return;
            if (marketType && cm.currentMarketType && marketType !== cm.currentMarketType) return;

            if (this._subscribedSymbolKey &&
                typeof cm.getCurrentSymbolKey === 'function' &&
                cm.getCurrentSymbolKey() !== this._subscribedSymbolKey) {
                return; // подписка устарела — ждём переподписки
            }

            // защита: priceManager может передать объект (как в ChartManager)
            if (price && typeof price === 'object') {
                if (typeof price.price === 'number') price = price.price;
                else if (typeof price.close === 'number') price = price.close;
                else if (typeof price.last === 'number') price = price.last;
                else return;
            }

            if (typeof price !== 'number' || isNaN(price) || price <= 0) return;

            cm.currentRealPrice = price;
            this._primitive?.updatePrice(price);
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
                this._primitive?.invalidateColor();
            };
            this._chartManager.onColorChange(this._colorChangeHandler);
        }
    }

    _unsubscribeFromPrice() {
        // T-FIX #6: отменяем ожидающий ретрай
        if (this._priceRetryTimeout) {
            clearTimeout(this._priceRetryTimeout);
            this._priceRetryTimeout = null;
        }

        if (this._priceHandler && this._chartManager?.priceManager && this._subscribedSymbolKey) {
            try { this._chartManager.priceManager.unsubscribe(this._subscribedSymbolKey, this._priceHandler); } catch(e) {}
        }
        this._priceHandler = null;
        this._priceSubscribed = false;
        this._subscribedSymbolKey = null;
    }

    start(interval) {
        if (this._disabled || this._destroyed) return;

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

    // T-FIX #4: ЕДИНСТВЕННОЕ определение hideImmediately().
    // Используется в setDataQuick() перед сменой данных/тикера, чтобы бейдж не
    // рисовался по устаревшей (ещё не пересчитанной) шкале цены.
    hideImmediately() {
        this.stop();
        if (this._primitive) {
            this._primitive.setEnabled(false);
        }
    }

    _tick() {
        if (this._disabled || this._destroyed || !this._timerElement || !this._chartManager?.chartData?.length) return;

        if (['1d','1w','1M'].includes(this._currentTf)) {
            this._timerElement.textContent = '';
            this.stop();
            return;
        }

        if (typeof TF_DURATIONS === 'undefined' || typeof Utils === 'undefined') return;

        const dur = TF_DURATIONS[this._currentTf];
        if (!dur || dur <= 0) return;

        // T-FIX #5: фаза обратного отсчёта — от UTC-времени (Date.now()).
        // Границы свечей биржи (и выравнивание в ChartManager) — UTC.
        // Московский сдвиг +3ч не делится нацело на 2h/4h/6h/12h/1d —
        // бейдж показывал неверное время до закрытия свечи.
        const left = dur - (Date.now() % dur);
        const txt = Utils.formatTimeRemaining(left);

        if (this._timerElement.textContent !== txt) {
            this._timerElement.textContent = txt;
            if (this._primitive?.isEnabled()) {
                this._primitive.requestRedraw();
            }
        }
    }

    reattach() {
        if (this._disabled || this._destroyed) return;

        // ✅ Полная переинициализация
        this._detachPrimitive();
        this._unsubscribeFromPrice();

        const series = this._chartManager.currentChartType === 'candle'
            ? this._chartManager.candleSeries : this._chartManager.barSeries;

        this._attachToSeries(series);
        this._subscribeToPrice();

        // T-FIX #9: гарантируем установку подписки на смену символа. Если
        // reattach() случился раньше отложенного _init (первые 300мс), _init
        // потом выйдет рано по флагу _initialized — и без этого вызова
        // подписка не создалась бы НИКОГДА, ломая T-FIX #1.
        this._ensureSymbolChangeSubscription();

        this._initialized = true;

        // ✅ Запускаем таймер заново
        if (this._chartManager.chartData?.length > 0) {
            this.start(this._currentTf);
        }
    }

    forceColorUpdate() {
        this._primitive?.invalidateColor();
    }

    updatePrice(price) {
        if (this._primitive) {
            this._primitive.updatePrice(price);
        } else {
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

    detach() {
        this.stop();
        this._detachPrimitive();
        this._unsubscribeFromPrice();
        this._initialized = false;
    }

    destroy() {
        // T-FIX #8: полная остановка всех фоновых циклов
        this._destroyed = true;

        if (this._initTimeout) {
            clearTimeout(this._initTimeout);
            this._initTimeout = null;
        }

        this.stop();
        this._unsubscribeFromPrice(); // T-FIX #6: отменит и ретрай подписки

        if (this._colorChangeHandler && typeof this._chartManager?.offColorChange === 'function') {
            this._chartManager.offColorChange(this._colorChangeHandler);
        }
        this._colorChangeHandler = null;

        // Колбэк смены символа остаётся в списке ChartManager (API отписки нет),
        // но он защищён флагом _destroyed и ничего не делает; ChartManager
        // очищает список колбэков в своём destroy().
        this._symbolChangeHandler = null;

        this._detachPrimitive();
        this._initialized = false;
    }
}

if (typeof window !== 'undefined') {
    window.TimerManager = TimerManager;
}
