class ChartManager {
    constructor(container) {
        this.chartData = [];
        this.lastCandle = null;
        this._loadingSymbol = false;
        this.indicatorManager = new IndicatorManager(this);
        this.chartContainer = document.getElementById('chart-container');
       // Восстанавливаем сохранённый тип графика
const savedChartType = localStorage.getItem('chartType') || 'candle';
this.currentChartType = savedChartType;
console.log('📊 Тип графика:', savedChartType);
        this.isLoadingMore = false;
        this.hasMoreData = true;
        this.currentInterval = localStorage.getItem('lastTimeframe') || CONFIG.defaultInterval;
console.log('📊 ChartManager: таймфрейм =', this.currentInterval);
        this.currentSymbol = CONFIG.defaultSymbol;
        this.currentExchange = 'binance';
        this.currentMarketType = 'futures';
        this._lastWidth = this.chartContainer.clientWidth;
        this._initPromise = null;
        this._lastHeight = this.chartContainer.clientHeight;
        this._savedTimePosition = null;
        this._lastTimeframe = null;
        this._symbolChangeCallbacks = [];
        this._updateScheduled = false;
        this._lastUpdateTime = 0;
        this._drawingsUpdateRafId = null;
        this._pendingUpdates = false;  // 👈 флаг фоновых изменений
this._lastLineColor = null;
 this._redrawLoopRunning = false;
    this._lastRedrawFrame = 0;
    this._pendingRedraw = false;


this._visibilityHandler = () => {
    if (document.hidden) {
        // this._saveZoomState();   ← ЗАКОММЕНТИРОВАТЬ
    } else {
        this._syncAfterHidden();
        // setTimeout(() => this._restoreZoomState(), 100);   ← ЗАКОММЕНТИРОВАТЬ
        if (this.timerManager?._primitive) {
            this.timerManager._primitive.requestRedraw();
        }
        this.scheduleDrawingsUpdate();
    }
};
document.addEventListener('visibilitychange', this._visibilityHandler);
       
        this._priceUpdateHandler = null;

        this.scheduleDrawingsUpdate = this.scheduleDrawingsUpdate.bind(this);
        this.onVisibleLogicalRangeChange = this.onVisibleLogicalRangeChange.bind(this);

        this.overlay = safeElement('candleStatsOverlay');
        this.openEl = safeElement('openValue');
        this.highEl = safeElement('highValue');
        this.lowEl = safeElement('lowValue');
        this.closeEl = safeElement('closeValue');
        this.changeEl = safeElement('changeValue');

        this.loadingOverlay = safeElement('loadingOverlay');
        this.loadingProgress = safeElement('loadingProgress');
this.chart = LightweightCharts.createChart(container, {
     
    layout: { 
        background: { color: '#000000' }, 
        textColor: '#808080'
    },
    grid: { 
        vertLines: { visible: false },
        horzLines: { visible: false }
    },
    crosshair: { 
        mode: LightweightCharts.CrosshairMode.Normal 
    },
   timeScale: { 
    timeVisible: true, 
    secondsVisible: false,
    borderColor: '#333333',
    barSpacing: 12,
    minBarSpacing: 1,        // ← Минимальное расстояние между барами (было 3)
    fixLeftEdge: false,      // ← Разрешаем скролл влево
    fixRightEdge: false,     // ← Разрешаем скролл вправо
    rightOffset: 10,
        tickMarkFormatter: (time) => {
            const mskTime = time + (3 * 3600);
            const date = new Date(mskTime * 1000);
            const hours = date.getUTCHours().toString().padStart(2, '0');
            const minutes = date.getUTCMinutes().toString().padStart(2, '0');
            return `${hours}:${minutes}`;
        }
    },
    rightPriceScale: { 
        borderColor: '#333333',
        borderVisible: true,
        scaleMargins: {
            top: 0.1,
            bottom: 0.1,
        }
    },
    localization: {
        timeFormatter: (time) => {
            const mskTime = time + (3 * 3600);
            const date = new Date(mskTime * 1000);
            return date.toLocaleString('ru-RU', {
                timeZone: 'UTC',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    }
});
this._isSyncing = false;
// Создаём свечную серию
this.candleSeries = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: CONFIG.colors.bullish,
    downColor: CONFIG.colors.bearish,
    borderVisible: false,
    wickUpColor: CONFIG.colors.bullish,
    wickDownColor: CONFIG.colors.bearish,
    priceScaleId: 'right',
    // priceFormat убран — будет задан позже через applyPriceFormat
});

// Создаём барную серию
this.barSeries = this.chart.addSeries(LightweightCharts.BarSeries, {
    upColor: CONFIG.colors.bullish,
    downColor: CONFIG.colors.bearish,
    openVisible: true,
    thinBars: true,
    priceScaleId: 'right',
    // priceFormat убран
});

// Включаем встроенную линию цены
this.candleSeries.applyOptions({
    priceLineVisible: true,
    lastValueVisible: true,
    priceLineSource: this.currentRealPrice || 0,
    priceLineColor: '#00bcd4',
    priceLineWidth: 1,
    priceLineStyle: LightweightCharts.LineStyle.Dashed
});

this.barSeries.applyOptions({
    priceLineVisible: true,
    lastValueVisible: true,
    priceLineSource: this.currentRealPrice || 0,
    priceLineColor: '#00bcd4',
    priceLineWidth: 1,
    priceLineStyle: LightweightCharts.LineStyle.Dashed
});


// В конструкторе ChartManager, после создания candleSeries и barSeries
const savedBg = localStorage.getItem('chartBgColor');
const savedBullish = localStorage.getItem('chartBullishColor');
const savedBearish = localStorage.getItem('chartBearishColor');

if (savedBg) {
    this.chart.applyOptions({ layout: { background: { color: savedBg } } });
}
if (savedBullish && savedBearish) {
    CONFIG.colors.bullish = savedBullish;
    CONFIG.colors.bearish = savedBearish;
    this.bullishColor = savedBullish;
    this.bearishColor = savedBearish;
    
    this.candleSeries.applyOptions({
        upColor: savedBullish,
        downColor: savedBearish,
        wickUpColor: savedBullish,
        wickDownColor: savedBearish
    });
    
    this.barSeries.applyOptions({
        upColor: savedBullish,
        downColor: savedBearish
    });
    
    // === ЛИНИЯ ЦЕНЫ ===
    const lastCandle = this.chartData?.[this.chartData.length - 1];
    const isBullish = lastCandle ? lastCandle.close >= lastCandle.open : true;
    const lineColor = isBullish ? savedBullish : savedBearish;
    this.candleSeries.applyOptions({ priceLineColor: lineColor });
    this.barSeries.applyOptions({ priceLineColor: lineColor });
}
// ========== СОЗДАНИЕ ОБЪЁМА ==========
if (typeof LightweightCharts !== 'undefined') {
    try {
        this.volumeSeries = this.chart.addSeries(LightweightCharts.HistogramSeries, {
            priceScaleId: 'volume',
            priceFormat: { type: 'volume' },
            color: '#26a69a',
            lineWidth: 1,
            lastValueVisible: false,
            title: ''
        });
        
        const volumeScale = this.chart.priceScale('volume');
        if (volumeScale) {
            volumeScale.applyOptions({
                scaleMargins: { top: 0.7, bottom: 0 },
                visible: true,
                borderVisible: true,
                autoScale: true
            });
        }
        
        this.bullishColor = CONFIG.colors.bullish;
        this.bearishColor = CONFIG.colors.bearish;
        
        console.log('✅ Volume series создан');
    } catch (e) {
        console.warn('⚠️ Не удалось создать Volume:', e);
        this.volumeSeries = null;
    }
} else {
    console.warn('⚠️ LightweightCharts не загружен');
    this.volumeSeries = null;
}

console.log('✅ Volume series создан с отдельной шкалой');

this.chart.priceScale('right').applyOptions({ 
    scaleMargins: { top: 0.0, bottom: 0.5 }
});

// Применяем сохранённый тип графика
const isCandle = this.currentChartType === 'candle';
this.candleSeries.applyOptions({ visible: isCandle });
this.barSeries.applyOptions({ visible: !isCandle });

this.chart.subscribeCrosshairMove(this.onCrosshairMove.bind(this));
  this._isSyncing = false; 
this.chart.timeScale().subscribeVisibleLogicalRangeChange(this.onVisibleLogicalRangeChange);

this.setupMaximumSubscriptions();
this.setupEventListeners();

this.alertTimers = new Map();
this.currentRealPrice = null;

setTimeout(() => {
    this.priceManager = window.priceManagerInstance;
    if (this.priceManager) this._subscribeToPrice();
}, 200); // Ждем, пока TickerPanel точно создаст PriceManager
(async () => {
    const CACHE_VERSION = '2';
    const savedVersion = localStorage.getItem('candleCacheVersion');
    if (savedVersion !== CACHE_VERSION) {
        await this.clearOldCaches();
        localStorage.setItem('candleCacheVersion', CACHE_VERSION);
        console.log('✅ Кэш свечей обновлён до версии', CACHE_VERSION);
    }
})();

// Запускаем асинхронную инициализацию
this._initPromise = (async () => {
    await this.waitForReady();
    
    this._updateMainChartHeight();
    
    const panelsContainer = document.getElementById('indicator-panels-container');
    if (panelsContainer) {
        const observer = new ResizeObserver(() => {
            this._updateMainChartHeight();
        });
        observer.observe(panelsContainer);
    }
    
    console.log('✅ ChartManager полностью инициализирован');
})();
 
this._setupPanelsSync();
this._startRedrawLoop();
 }

_startRedrawLoop() {
    const loop = () => {
        // Один раз за кадр перерисовываем всё, что изменилось
        this.rayManager?._applyRedrawIfNeeded();
        this.trendLineManager?._applyRedrawIfNeeded();
        this.rulerLineManager?._applyRedrawIfNeeded();
        this.alertLineManager?._applyRedrawIfNeeded();
        
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}



getCurrentPrice() {
    // 1. Сначала из PriceManager (WebSocket)
    if (this.priceManager) {
        const price = this.priceManager.getPrice(this.currentSymbol);
        if (price !== null && !isNaN(price)) {
            return price;
        }
    }
    
    // 2. Если WebSocket еще не дал цену — используем сохраненную realPrice
    if (this.currentRealPrice !== null && this.currentRealPrice !== undefined && !isNaN(this.currentRealPrice)) {
        return this.currentRealPrice;
    }
    
    
    // 4. Если ничего нет — null
    return null;
}

_setupPanelsSync() {
    if (!this.chart) return;
    
    const mainTimeScale = this.chart.timeScale();
    const mainChart = this.chart;
    
    console.log('🔧 Настраиваю синхронизацию (по официальной документации TV)...');
    
    // ═════════════════════════════════════════
    // 1. СИНХРОНИЗАЦИЯ ВРЕМЕНИ (как в docs)
    // ═════════════════════════════════════════
    mainTimeScale.subscribeVisibleLogicalRangeChange((timeRange) => {
        if (!this.indicatorManager?.panelManager || this._isSyncing) return;
        
        this._isSyncing = true;
        
        const panels = this.indicatorManager.panelManager.panels;
        panels.forEach((panel) => {
            if (panel.chart && !panel.isCollapsed) {
                try { panel.chart.timeScale().setVisibleLogicalRange(timeRange); } catch(e) {}
            }
        });
        
        setTimeout(() => { this._isSyncing = false; }, 10);
    });
    
    // ═════════════════════════════════════════════════════
    // 2. ❗️❗️❗️ СИНХРОНИЗАЦИЯ CROSSHAIR (официальный метод из docs!)
    // ═════════════════════════════════════════════════════
    
    // Функция получения данных точки (из документации)
    function getCrosshairDataPoint(series, param) {
        if (!param.time) return null;
        const dataPoint = param.seriesData.get(series);
        return dataPoint || null;
    }
    
    // Функция синхронизации crosshair (из документации)
    function syncCrosshairToPanels(param) {
        if (!mainChart || !param) return;
        
        const panels = window.chartManager?.indicatorManager?.panelManager?.panels;
        if (!panels) return;
        
        panels.forEach((panel) => {
            if (!panel.chart || panel.isCollapsed) return;
            
            try {
                // Если нет времени - скрываем
                if (!param.time || !param.point) {
                    panel.chart.clearCrosshairPosition();
                    return;
                }
                
                // Ищем первую серию на панели
                let targetSeries = null;
                panel.series.forEach((series) => {
                    targetSeries = series; // Берем любую серию
                });
                
                if (!targetSeries) {
                    panel.chart.clearCrosshairPosition();
                    return;
                }
                
                // Получаем точку данных
                const dataPoint = getCrosshairDataPoint(targetSeries, param);
                
                // ❗️ Устанавливаем crosshair (как в документации!)
                if (dataPoint) {
                    panel.chart.setCrosshairPosition(
                        param.time,       // Время
                        dataPoint.value,  // Цена из данных
                        param.point.x     // X координата
                    );
                } else {
                    panel.chart.clearCrosshairPosition();
                }
                
            } catch(e) {}
        });
    }
    
    // Подписываемся на crosshair основного графика
    mainChart.subscribeCrosshairMove((param) => {
        syncCrosshairToPanels(param);
    });
    
    console.log('✅ Crosshair синхронизирован (официальный метод TradingView)');
}
saveCurrentTimePosition() {
    if (!this.chart || !this.chartData.length) return null;
    
    const timeScale = this.chart.timeScale();
    const visibleRange = timeScale.getVisibleLogicalRange();
    
    if (visibleRange) {
        const firstVisibleIndex = Math.floor(visibleRange.from);
        if (firstVisibleIndex >= 0 && firstVisibleIndex < this.chartData.length) {
            return this.chartData[firstVisibleIndex].time;
        }
    }
    return null;
}
scrollToTime(time) {
    if (!this.chart || !time) return;
    
    const timeScale = this.chart.timeScale();
    const currentRange = timeScale.getVisibleLogicalRange();
    
    if (!currentRange) return;
    
    const targetIndex = this.chartData.findIndex(c => c.time >= time);
    
    if (targetIndex !== -1) {
        const visibleBars = currentRange.to - currentRange.from;
        timeScale.setVisibleLogicalRange({
            from: Math.max(0, targetIndex - 10),
            to: Math.max(0, targetIndex - 10) + visibleBars
        });
    } else {
        this.scrollToLast();
    }
}
getCurrentSymbolKey() {
    return `${this.currentSymbol}:${this.currentExchange}:${this.currentMarketType}`;
}
    updatePricePrecision(symbol, exchange, marketType) {
        // 1. Берем из локального кэша (0 запросов к API)
        const cachedPrecision = localStorage.getItem(`precision_${symbol}_${exchange}_${marketType}`);
        if (cachedPrecision) {
            this.applyPriceFormat(parseInt(cachedPrecision));
            return;
        }

        // 2. Если кэша нет - берем из УЖЕ СКАЧАННЫХ данных графика (0 запросов к API)
        this.applyPriceFormat(this._inferPrecisionFromData());

        // 3. Отправляем фоновый запрос в НАДЖДЕ, чтобы сохранить точность на будущее.
        // Больше не блокируем график!
        getPrecisionFromExchange(symbol, exchange, marketType)
            .then(precision => {
                this.applyPriceFormat(precision);
                localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, precision);
            })
            .catch(() => {}); // Игнорируем ошибки сети, чтобы не спамить в консоль
    }
  setupMaximumSubscriptions() {
    this.chart.timeScale().subscribeVisibleTimeRangeChange(() => {
        this.scheduleDrawingsUpdate();
    });
    
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
        this.scheduleDrawingsUpdate();
    });

    const priceScale = this.chart.priceScale('right');
    if (priceScale && typeof priceScale.subscribeVisibleLogicalRangeChange === 'function') {
        priceScale.subscribeVisibleLogicalRangeChange(() => {
            this.scheduleDrawingsUpdate();
        });
    }

    // ✅ ОСТАВЛЯЕМ wheel - он нужен для зума
    this.chartContainer.addEventListener('wheel', () => {
        this.scheduleDrawingsUpdate();
    }, { passive: true });
    
    // ✅ УБИРАЕМ мусор (mousedown/mouseup)
    // this.chartContainer.addEventListener('mousedown', () => { this.scheduleDrawingsUpdate(); });
    // this.chartContainer.addEventListener('mouseup', () => { this.scheduleDrawingsUpdate(); });
    
    // ✅ ИСПРАВЛЯЕМ MutationObserver - только при реальном изменении размера
    let resizeTimeout;
    const observer = new MutationObserver(() => {
        // Не вызываем при каждом чихе, а только когда изменился размер
        if (resizeTimeout) return;
        resizeTimeout = setTimeout(() => {
            resizeTimeout = null;
            const currentWidth = this.chartContainer.clientWidth;
            const currentHeight = this.chartContainer.clientHeight;
            if (currentWidth !== this._lastWidth || currentHeight !== this._lastHeight) {
                this._lastWidth = currentWidth;
                this._lastHeight = currentHeight;
                this.scheduleDrawingsUpdate();
            }
        }, 100);
    });
    observer.observe(this.chartContainer, { 
        attributes: true, 
        attributeFilter: ['style', 'class']  // ← ТОЛЬКО style и class
    });
}
   forceRedraw() {
    if (!this.chartData.length) return;

    this.candleSeries.setData([]);
    this.barSeries.setData([]);
    if (this.volumeSeries) this.volumeSeries.setData([]);

    setTimeout(() => {
        this.candleSeries.setData(this.chartData);
        this.barSeries.setData(this.chartData);

        if (this.volumeSeries) {
            const volumeData = this.chartData.map(c => ({
                time: c.time,
                value: c.volume,
                color: c.close >= c.open ? this.bullishColor : this.bearishColor
            }));
            this.volumeSeries.setData(volumeData);
        }

        if (this.indicatorManager) {
            this.indicatorManager.updateAllIndicators();
        }

        // 👇 ВОССТАНАВЛИВАЕМ ЛИНИЮ ЦЕНЫ
        if (this.currentRealPrice) {
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            if (series) {
                series.applyOptions({ priceLineSource: this.currentRealPrice });
            }
        }

        if (this.timerManager?._primitive) {
            this.timerManager._primitive.requestRedraw();
        }

      
    }, 10);
}
    _subscribeToSymbolChange(callback) {
        this._symbolChangeCallbacks = this._symbolChangeCallbacks || [];
        this._symbolChangeCallbacks.push(callback);
    }

    _notifySymbolChange() {
        if (this._symbolChangeCallbacks) {
            this._symbolChangeCallbacks.forEach(cb => cb());
        }
    }
       loadSymbolData(symbol, exchange, marketType) {
        const isSameSymbol = (symbol === this.currentSymbol);
        const isTimeframeChange = isSameSymbol && (this.currentInterval !== this._lastTimeframe);

        if (isTimeframeChange) {
            this._savedTimePosition = this.saveCurrentTimePosition();
            console.log('📍 Сохранена позиция:', this._savedTimePosition);
        }
        
        console.log(`📊 Загружаю данные для ${symbol} (${exchange} ${marketType})`);
        
        if (this._loadingSymbol) {
            console.log('Загрузка уже выполняется, пропускаем');
            return;
        }
        this._loadingSymbol = true;
        
        // ==========================================================
        // 2. ЖДЁМ ГОТОВНОСТИ IndexedDB
        // ==========================================================
        const dbPromise = new Promise(resolve => {
            if (window.dbReady) {
                resolve();
            } else {
                console.log('⏳ Ожидание IndexedDB...');
                const check = setInterval(() => {
                    if (window.dbReady) {
                        clearInterval(check);
                        console.log('✅ IndexedDB готова');
                        resolve();
                    }
                }, 50);
                setTimeout(() => {
                    clearInterval(check);
                    console.warn('⚠️ Таймаут ожидания IndexedDB');
                    resolve(); 
                }, 3000);
            }
        });
        // ==========================================================

        this.setSymbol(symbol);
        
        const previousData = [...(this.chartData || [])];
        const previousSymbol = this.currentSymbol;
        const previousExchange = this.currentExchange;
        const previousMarketType = this.currentMarketType;
        
        if (this.loadingOverlay) {
            this.loadingOverlay.classList.add('visible');
            if (this.loadingProgress) {
                this.loadingProgress.textContent = 'Загрузка...';
            }
        }
        
        const loadData = async () => {
         }
         }
        
   async saveCandlesToCache(symbol, exchange, marketType, interval, candles) {
    if (!candles || candles.length === 0) return;
    
    const CACHE_VERSION = '2'; // ← новая версия кэша
    const key = `${symbol}_${interval}_${exchange}_${marketType}_v${CACHE_VERSION}`; // ← версия в ключе
    
    const cacheData = {
        key: key,
        symbol: symbol,
        exchange: exchange,
        marketType: marketType,
        interval: interval,
        data: candles,
        lastUpdate: Date.now(),
        firstCandleTime: candles[0].time,
        lastCandleTime: candles[candles.length - 1].time,
        count: candles.length,
        version: CACHE_VERSION // ← поле версии
    };
    
    if (!window.db) {
        console.warn('📦 IndexedDB не доступна, кэш не сохранен');
        return;
    }
    
    try {
        if (!window.dbReady) {
            await new Promise(resolve => {
                const check = setInterval(() => {
                    if (window.dbReady) {
                        clearInterval(check);
                        resolve();
                    }
                }, 100);
                setTimeout(() => {
                    clearInterval(check);
                    resolve();
                }, 2000);
            });
        }
        
        await window.db.put('candles', cacheData);
        console.log(`📦 Свечи сохранены в кэш: ${key} (${candles.length} свечей)`);
    } catch (error) {
        console.warn('❌ Ошибка сохранения свечей в кэш:', error);
    }
}
    
    async loadCandlesFromCache(symbol, exchange, marketType, interval) {
    const CACHE_VERSION = '2';
    const key = `${symbol}_${interval}_${exchange}_${marketType}_v${CACHE_VERSION}`;
    
    if (!window.db) return null;
    
    try {
        const cached = await window.db.get('candles', key);
        if (!cached) return null;
        
        // Проверяем версию (на случай, если ключ без версии, но поле есть)
        if (cached.version !== CACHE_VERSION) {
            console.log(`Кэш устарел (версия ${cached.version}), удаляем`);
            await window.db.delete('candles', key);
            return null;
        }
        
        const CACHE_DURATION = 5 * 60 * 1000; // 5 минут
        if (Date.now() - cached.lastUpdate > CACHE_DURATION) {
            console.log(`Кэш устарел по времени: ${key}`);
            return null;
        }
        
        console.log(`📦 Загружено ${cached.data.length} свечей из кэша: ${key}`);
        return cached.data;
    } catch (error) {
        console.warn('❌ Ошибка загрузки свечей из кэша:', error);
        return null;
    }
}
// Вставьте после метода loadCandlesFromCache или перед getCurrentPrice

    async clearOldCaches() {
    const CACHE_VERSION = '2';
    try {
        const allCandles = await window.db.getAll('candles');
        for (const cache of allCandles) {
            if (!cache.version || cache.version !== CACHE_VERSION) {
                await window.db.delete('candles', cache.key);
                console.log(`🗑️ Удалён старый кэш свечей: ${cache.key}`);
            }
        }
    } catch (e) {
        console.warn('Ошибка очистки кэша свечей:', e);
    }
}
    async clearOldCandlesCache(maxAge = 24 * 60 * 60 * 1000) {
        try {
            const allCandles = await window.db.getAll('candles');
            const now = Date.now();
            let deletedCount = 0;
            
            for (const cached of allCandles) {
                if (now - cached.lastUpdate > maxAge) {
                    await window.db.delete('candles', cached.key);
                    deletedCount++;
                }
            }
            
            if (deletedCount > 0) {
                console.log(`🧹 Очищено ${deletedCount} устаревших кэшей свечей`);
            }
            
        } catch (error) {
            console.warn('❌ Ошибка очистки кэша свечей:', error);
        }
    }
    async waitForReady() {
    let attempts = 0;
    const maxAttempts = 50; // 5 секунд максимум
    
    while (attempts < maxAttempts) {
        if (this.chart && 
            this.candleSeries && 
            this.chartData && 
            this.chartData.length > 0 &&
            this.chart.timeScale()?.getVisibleRange()) {
            console.log('✅ График готов за', attempts * 100, 'мс');
            return true;
        }
        await new Promise(r => setTimeout(r, 100));
        attempts++;
    }
    console.warn('⚠️ Таймаут ожидания готовности графика');
    return false;
}

async waitForSeriesReady() {
    return this.waitForReady();
}
    timeToCoordinate(time) {
        try {
            return this.chart.timeScale().timeToCoordinate(time);
        } catch (e) {
            return null;
        }
    }

    coordinateToTime(coordinate) {
        try {
            return this.chart.timeScale().coordinateToTime(coordinate);
        } catch (e) {
            return null;
        }
    }

    priceToCoordinate(price) {
        try {
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            return series.priceToCoordinate(price);
        } catch (e) {
            return null;
        }
    }

    // ========== FALLBACK МЕТОДЫ (ВНУТРИ КЛАССА) ==========
    timeToCoordinateWithFallback(time) {
        let coord = this.timeToCoordinate(time);
        if (coord !== null) return coord;
        
        const data = this.chartData;
        if (!data || !data.length) return null;
        
        const firstCandle = data[0];
        const lastCandle = data[data.length - 1];
        const firstX = this.timeToCoordinate(firstCandle.time);
        const lastX = this.timeToCoordinate(lastCandle.time);
        
        if (firstX === null || lastX === null) return null;
        
        const pixelsPerMs = (lastX - firstX) / (lastCandle.time - firstCandle.time);
        if (time < firstCandle.time) {
            return firstX - (firstCandle.time - time) * pixelsPerMs;
        } else {
            return lastX + (time - lastCandle.time) * pixelsPerMs;
        }
    }

  priceToCoordinateWithFallback(price) {
    let coord = this.priceToCoordinate(price);
    if (coord !== null) return coord;

    const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
    if (!series) return null;
    
    const priceScale = series.priceScale();
    if (!priceScale) return null;
    
    // 🔥 ИСПРАВЛЕНО: height - это СВОЙСТВО, а не функция
    const height = priceScale.height;
    if (!height || height <= 0) return null;
    
    // 🔥 ИСПРАВЛЕНО: priceToCoordinate, а не coordinateToPrice
    const firstValue = priceScale.priceToCoordinate(0);
    const lastValue = priceScale.priceToCoordinate(height);
    
    if (firstValue === null || lastValue === null) return null;
    
    const minPrice = Math.min(firstValue, lastValue);
    const maxPrice = Math.max(firstValue, lastValue);
    const pixelsPerUnit = height / (maxPrice - minPrice);
    
    if (price < minPrice) {
        return 0 - (minPrice - price) * pixelsPerUnit;
    } else {
        return height + (price - maxPrice) * pixelsPerUnit;
    }
}
   
timeToLogical(time) {
    if (!this.chartData || !this.chartData.length) return null;
    const index = this.chartData.findIndex(c => c.time === time);
    return index !== -1 ? index : null;
}
    coordinateToPrice(coordinate) {
        try {
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            return series.coordinateToPrice(coordinate);
        } catch (e) {
            return null;
        }
    }

  scheduleDrawingsUpdate() {
    if (this._drawingsTimer) clearTimeout(this._drawingsTimer);
    this._drawingsTimer = setTimeout(() => {
        if (window.renderDrawings) {
            window.renderDrawings();
        }
    }, 50);
}
    onVisibleLogicalRangeChange(range) {
        if (!range || this.isLoadingMore || !this.hasMoreData || !this.chartData.length) return;
        
        const fromIndex = Math.max(0, Math.floor(range.from));
        
        if (fromIndex < 70 && this.hasMoreData && !this.isLoadingMore) {
            this.loadMoreHistoricalData();
        }
    }
    
    async loadMoreHistoricalData() {
        if (this.isLoadingMore || !this.hasMoreData || !this.chartData.length) return;
        
        this.isLoadingMore = true;
        
        try {
            const oldestCandle = this.chartData[0];
            if (!oldestCandle) {
                this.isLoadingMore = false;
                return;
            }
            
            const endTime = (oldestCandle.time * 1000) - 1;
            
            const olderCandles = await DataFetcher.loadMoreKlines(
                this.currentSymbol, 
                this.currentInterval, 
                endTime
            );
            
            if (olderCandles && olderCandles.length > 0) {
                const uniqueOlder = olderCandles.filter(newCandle => 
                    !this.chartData.some(existing => existing.time === newCandle.time)
                );
                
                if (uniqueOlder.length > 0) {
                    this.chartData = [...uniqueOlder, ...this.chartData];
                    this.scheduleUpdate();
                }
                
                if (olderCandles.length < 1000) {
                    this.hasMoreData = false;
                }
            } else {
                this.hasMoreData = false;
            }
        } catch (e) {
            console.error('Ошибка загрузки истории:', e);
        } finally {
            this.isLoadingMore = false;
        }
    }
    
  async refreshCandlesInBackground(symbol, exchange, marketType, interval) {
    console.log(`🔄 Фоновое обновление свечей для ${symbol}...`);
    
    try {
        const bybitIntervalMap = {
            '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
            '1h': '60', '4h': '240', '6h': '360', '12h': '720',
            '1d': 'D', '1w': 'W', '1M': 'M'
        };
        const CACHE_VERSION = '2';
        
        let url;
        let limit = 100;
        
        if (exchange === 'binance') {
            if (marketType === 'futures') {
                url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
            } else {
                url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
            }
        } else {
            const bybitInterval = bybitIntervalMap[interval] || interval;
            const category = marketType === 'futures' ? 'linear' : 'spot';
            url = `https://api.bybit.com/v5/market/kline?category=${category}&symbol=${symbol}&interval=${bybitInterval}&limit=${limit}`;
        }
        
        const response = await fetch(url);
        if (!response.ok) return;
        
        const data = await response.json();
        
        let freshCandles = [];
        
        if (exchange === 'binance') {
            if (!Array.isArray(data)) return;
            freshCandles = data.map(item => ({
                time: Math.floor(item[0] / 1000),
                open: parseFloat(item[1]),
                high: parseFloat(item[2]),
                low: parseFloat(item[3]),
                close: parseFloat(item[4]),
                volume: parseFloat(item[5]),
                quoteVolume: parseFloat(item[7])   // ← ДОБАВЛЕНО
            }));
        } else {
            if (data.retCode !== 0 || !data.result?.list) return;
            const candles = data.result.list;
            freshCandles = candles.map(item => ({
                time: Math.floor(parseInt(item[0]) / 1000),
                open: parseFloat(item[1]),
                high: parseFloat(item[2]),
                low: parseFloat(item[3]),
                close: parseFloat(item[4]),
                volume: parseFloat(item[5] || 0),
                quoteVolume: parseFloat(item[6] || 0)   // ← ДОБАВЛЕНО
            })).filter(c => c !== null);
        }
        
        if (freshCandles.length === 0) return;
        
        const lastCachedTime = this.chartData.length > 0 ? this.chartData[this.chartData.length - 1].time : 0;
        const lastFreshTime = freshCandles[freshCandles.length - 1].time;
        
        if (lastFreshTime > lastCachedTime) {
            console.log(`📊 Найдены новые свечи: ${lastFreshTime} > ${lastCachedTime}`);
            const newCandles = freshCandles.filter(c => c.time > lastCachedTime);
            this.chartData.push(...newCandles);
            this._performUpdate();
            
            if (window.db && window.dbReady) {
                const key = `${symbol}_${interval}_${exchange}_${marketType}_v${CACHE_VERSION}`;
                const cached = await window.db.get('candles', key);
                
                if (cached) {
                    const updatedData = [...cached.data, ...newCandles];
                    if (updatedData.length > 1000) {
                        updatedData.splice(0, updatedData.length - 1000);
                    }
                    await window.db.put('candles', {
                        ...cached,
                        key: key,
                        data: updatedData,
                        lastUpdate: Date.now(),
                        lastCandleTime: updatedData[updatedData.length - 1].time,
                        count: updatedData.length,
                        version: CACHE_VERSION
                    });
                    console.log(`📦 Кэш обновлён: добавлено ${newCandles.length} свечей`);
                } else {
                    const newCache = {
                        key: key,
                        symbol: symbol,
                        exchange: exchange,
                        marketType: marketType,
                        interval: interval,
                        data: freshCandles,
                        lastUpdate: Date.now(),
                        firstCandleTime: freshCandles[0].time,
                        lastCandleTime: freshCandles[freshCandles.length - 1].time,
                        count: freshCandles.length,
                        version: CACHE_VERSION
                    };
                    await window.db.put('candles', newCache);
                    console.log(`📦 Создан новый кэш: ${key}`);
                }
            }
            this.scrollToLast();
        }
    } catch (error) {
        console.warn('⚠️ Ошибка фонового обновления:', error);
    }
}
    
    setupEventListeners() {
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        
        resizeTimeout = setTimeout(() => {
            if (this.chart) {
                const width = this.chartContainer.clientWidth;
                const height = this.chartContainer.clientHeight;
                
                this.chart.applyOptions({ width, height });
                
                if (this._resizeIndicatorPanels) {
                    this._resizeIndicatorPanels();
                }
                
                if (this._updateMainChartHeight) {
                    this._updateMainChartHeight();
                }
                
                setTimeout(() => {
                    this.scrollToLast();
                }, 50);
            }
            
            if (this.timerManager && this.timerManager._primitive) {
                this.timerManager._primitive.requestRedraw();
            }
            
            this.scheduleDrawingsUpdate();
        }, 150); // ✅ 100 → 150
    });
}
    
setChartType(type) {
    if (!this.chart) {
        console.warn('График не инициализирован');
        return;
    }
    
    this.currentChartType = type;
    localStorage.setItem('chartType', type);
    if (type === 'candle') {
        if (this.candleSeries) this.candleSeries.applyOptions({ visible: true });
        if (this.barSeries) this.barSeries.applyOptions({ visible: false });
    } else if (type === 'bar') {
        if (this.candleSeries) this.candleSeries.applyOptions({ visible: false });
        if (this.barSeries) this.barSeries.applyOptions({ visible: true });
    }
    
    // применяем текущие цвета к барам
    if (this.barSeries) {
        const bullishColor = CONFIG.colors.bullish;
        const bearishColor = CONFIG.colors.bearish;
        this.barSeries.applyOptions({
            upColor: bullishColor,
            downColor: bearishColor
        });
    }
    
    if (this.timerManager && typeof this.timerManager.reattach === 'function') {
        this.timerManager.reattach();
    }
    
    if (this.indicatorManager && this.indicatorManager.activeIndicators) {
        console.log('🔄 Пересоздаём серии индикаторов при смене типа графика');
        this.indicatorManager.activeIndicators.forEach(indicator => {
            try {
                indicator.createSeries();
            } catch (e) {
                console.warn('Ошибка при пересоздании серии для индикатора:', indicator.type, e);
            }
        });
    }
    
    setTimeout(() => {
        if (window.rayManager) window.rayManager.syncWithNewTimeframe();
        if (window.trendLineManager) window.trendLineManager.syncWithNewTimeframe();
        if (window.rulerLineManager) window.rulerLineManager.syncWithNewTimeframe();
        if (window.alertLineManager) window.alertLineManager.syncWithNewTimeframe();
        if (window.textManager) window.textManager.syncWithNewTimeframe();
    }, 50);
    
    // Обновляем линию цены с правильным цветом
    const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
    if (activeSeries) {
        const lastCandle = this.chartData[this.chartData.length - 1];
        const isBullish = lastCandle ? lastCandle.close >= lastCandle.open : true;
        const lineColor = isBullish ? CONFIG.colors.bullish : CONFIG.colors.bearish;
        
        activeSeries.applyOptions({
            priceLineVisible: true,
            lastValueVisible: true,
            priceLineSource: this.currentRealPrice || 0,
            priceLineColor: lineColor,
            priceLineWidth: 1,
            priceLineStyle: LightweightCharts.LineStyle.Dashed
        });
    }
}
    scheduleUpdate() {
        if (this._updateScheduled) return;
        
        this._updateScheduled = true;
        requestAnimationFrame(() => {
            this._performUpdate();
            this._updateScheduled = false;
            this._lastUpdateTime = Date.now();
        });
    }
scheduleUpdatePosition() {
    if (this._updatePositionRafId === null) {
        this._updatePositionRafId = requestAnimationFrame(() => {
            this.updatePriceLineTimerPosition();
            this._updatePositionRafId = null;
        });
    }
}

updatePriceLineTimerPosition() {
    if (!this.lastCandle || !this.priceLineTimer) return;
    
    const price = this.currentRealPrice || this.lastCandle.close;
    const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
    const coordinate = activeSeries.priceToCoordinate(price);
    
    if (coordinate !== null && !isNaN(coordinate)) {
        const containerRect = this.chartContainer.getBoundingClientRect();
        let topPosition = coordinate - containerRect.top + 60;
        
        // Ограничиваем, чтобы таймер не вылезал за пределы
        const timerHeight = this.priceLineTimer.offsetHeight;
        topPosition = Math.max(5, Math.min(window.innerHeight - timerHeight - 5, topPosition));
        
        this.priceLineTimer.style.top = topPosition + 'px';
        this.priceLineTimer.style.right = '10px';
        
        // Цвет
        const isBullish = this.lastCandle ? Utils.isBullish(this.lastCandle.open, this.lastCandle.close) : true;
        this.priceLineTimer.classList.remove('bullish', 'bearish');
        this.priceLineTimer.classList.add(isBullish ? 'bullish' : 'bearish');
    }
}
_performUpdate() {
    if (!this.chartData.length) return;
    
    // Обновляем данные свечей
    this.candleSeries.setData(this.chartData);
    this.barSeries.setData(this.chartData);
    
    // Индикаторы
    if (this.indicatorManager) {
        this.indicatorManager.updateAllIndicators();
    }

    // Цвет линии цены
    const price = this.getCurrentPrice();
    if (price !== null) {
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (series) {
            const lastCandle = this.chartData[this.chartData.length - 1];
            const isBullish = lastCandle ? lastCandle.close >= lastCandle.open : true;
            const lineColor = isBullish ? CONFIG.colors.bullish : CONFIG.colors.bearish;
            
            series.applyOptions({
                priceLineSource: price,
                priceLineColor: lineColor
            });
        }
    }

    // ЗАЩИТА ОТ СБРОСА ФОРМАТА ЦЕНЫ
    const cachedPrecision = localStorage.getItem(`precision_${this.currentSymbol}_${this.currentExchange}_${this.currentMarketType}`);
    if (cachedPrecision) {
        const p = parseInt(cachedPrecision);
        const fmt = { type: 'price', precision: p, minMove: Math.pow(10, -p) };
        this.candleSeries.applyOptions({ priceFormat: fmt });
        this.barSeries.applyOptions({ priceFormat: fmt });
        const priceScale = this.chart.priceScale('right');
        if (priceScale) {
            priceScale.applyOptions({ priceFormat: fmt, autoScale: true });
        }
    }

    // Таймер
    if (this.timerManager) {
        this.timerManager.start(this.currentInterval);
        if (this.timerManager._primitive && this.timerManager._primitive.isEnabled()) {
            this.timerManager._primitive.requestRedraw();
        }
    }

    this.scheduleUpdatePosition();
}
  updateLastCandle(candle) {
    if (!candle || typeof candle.time !== 'number' || isNaN(candle.time) || candle.time <= 0) {
        console.warn('Пропущена свеча с некорректным временем:', candle);
        return;
    }
    
    try {
        const existingIndex = this.chartData.findIndex(c => c.time === candle.time);
        
        if (existingIndex !== -1) {
            this.chartData[existingIndex] = candle;
        } else {
            this.chartData.push(candle);
            const limit = CONFIG.klineLimits[this.currentInterval] || 1000;
            if (this.chartData.length > limit) {
                this.chartData = this.chartData.slice(-limit);
            }
        }
        
        // ЕДИНСТВЕННОЕ ОБЪЯВЛЕНИЕ activeSeries
        const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (activeSeries) {
            activeSeries.update({
                time: candle.time,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close
            });
        }
        
        this.currentRealPrice = candle.close;
        if (activeSeries) {
            activeSeries.applyOptions({ priceLineSource: candle.close });
        }
        
        if (this.volumeSeries && this.chartData.length > 0) {
            const volumeData = this.chartData.map(c => {
                const isBullish = c.close >= c.open;
                return {
                    time: c.time,
                    value: c.volume,
                    color: isBullish ? this.bullishColor : this.bearishColor
                };
            });
            this.volumeSeries.setData(volumeData);
        }
        
        this.lastCandle = candle;
        
    } catch (e) {
        console.warn('Ошибка в updateLastCandle:', e);
    }
}

async waitForChartReady() {
    // Ждём, пока timeScale станет доступен и вернёт диапазон
    await new Promise(resolve => {
        const check = () => {
            const ts = this.chart?.timeScale();
            if (ts && ts.getVisibleRange()) {
                resolve();
            } else {
                requestAnimationFrame(check);
            }
        };
        check();
    });
    // Дополнительная микро-пауза для уверенности
    await new Promise(r => setTimeout(r, 50));
}
setDataQuick(data, interval, symbol, exchange = 'binance', marketType = 'futures') {
    console.log('🔵 setDataQuick: получено свечей', data.length);
    
    if (data.length > 0) {
        console.log('    Первая свеча:', data[0]);
        console.log('    Последняя свеча:', data[data.length - 1]);
        
        // ОЧИЩАЕМ СТАРЫЕ ДАННЫЕ
        if (this.candleSeries) this.candleSeries.setData([]);
        if (this.barSeries) this.barSeries.setData([]);
        if (this.volumeSeries) this.volumeSeries.setData([]);
        
        // ФИЛЬТРАЦИЯ
        const beforeFilter = data.length;
        const seenTimes = new Set();
        let noDupes = data.filter(c => {
            if (!c || typeof c.time !== 'number' || isNaN(c.time)) return false;
            if (seenTimes.has(c.time)) return false;
            seenTimes.add(c.time);
            return true;
        });
        noDupes = noDupes.filter(c => this._isValidCandle(c));
        data = noDupes;
        
        if (data.length === 0) {
            console.error('❌ setDataQuick: после фильтрации не осталось валидных свечей!');
            return;
        }
        
        console.log(`✅ Валидных свечей: ${data.length}`);
        
        // ВЫРАВНИВАНИЕ ВРЕМЕНИ
        const intervalMapSeconds = {
            '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
            '1h': 3600, '4h': 14400, '6h': 21600, '12h': 43200,
            '1d': 86400, '1w': 604800, '1M': 2592000
        };
        const step = intervalMapSeconds[interval] || 3600;
        data = data.map(c => ({
            ...c,
            time: Math.floor(Math.floor(c.time * 1000) / (step * 1000)) * step
        }));
        
        // 👇 ДОБАВЛЯЕМ ТЕКУЩУЮ НЕЗАКРЫТУЮ СВЕЧУ
        const nowSec = Math.floor(Date.now() / 1000);
        const currentAligned = Math.floor(nowSec / step) * step;
        const lastDataCandle = data[data.length - 1];
        
        if (lastDataCandle && lastDataCandle.time < currentAligned) {
            const currentCandle = {
                time: currentAligned,
                open: lastDataCandle.close,
                high: lastDataCandle.close,
                low: lastDataCandle.close,
                close: lastDataCandle.close,
                volume: 0
            };
            data.push(currentCandle);
            console.log('📌 Добавлена текущая незакрытая свеча:', new Date(currentAligned * 1000));
        }
        
        // СОХРАНЯЕМ ДАННЫЕ
        this.chartData = data;
        this.currentInterval = interval;
        this.currentSymbol = symbol;
        this.currentExchange = exchange;
        this.currentMarketType = marketType;
        this.hasMoreData = true;
        this.lastCandle = data[data.length - 1];
        
        // ТОЧНОСТЬ ДО ОТРИСОВКИ
        const cachedPrecision = localStorage.getItem(`precision_${symbol}_${exchange}_${marketType}`);
        const inferredPrecision = this._inferPrecisionFromData();
        
        // Используем кэш только если он НЕ МЕНЬШЕ реальной точности
        if (cachedPrecision && parseInt(cachedPrecision) >= inferredPrecision) {
            this.applyPriceFormat(parseInt(cachedPrecision));
        } else {
            if (cachedPrecision) {
                console.warn(`⚠️ Кэш precision устарел (${cachedPrecision} < ${inferredPrecision}), исправляем`);
            }
            this.applyPriceFormat(inferredPrecision);
            localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, inferredPrecision);
        }
        
        // РИСУЕМ (ОДИН РАЗ)
        this._performUpdate();
        this._updatePageTitle();
        
        // ОБЪЁМ
        if (this.volumeSeries && this.chartData.length > 0) {
            const volumeData = this.chartData.map(candle => ({
                time: candle.time,
                value: candle.volume || 0,
                color: candle.close >= candle.open ? this.bullishColor : this.bearishColor
            }));
            this.volumeSeries.setData(volumeData);
        }
        
        // ИНДИКАТОРЫ
        if (this.indicatorManager) {
            this.indicatorManager.restorePendingIndicators();
            this.indicatorManager.updateAllIndicators();
            this.indicatorManager.loadIndicators();
        }
        
        // ФОНОВАЯ ЗАГРУЗКА ТОЧНОСТИ (только сохраняем, не применяем)
        if (!cachedPrecision || parseInt(cachedPrecision) < inferredPrecision) {
            getPrecisionFromExchange(symbol, exchange, marketType)
                .then(precision => {
                    localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, precision);
                    console.log(`✅ Precision saved for ${symbol}: ${precision} decimals`);
                })
                .catch(() => {});
        }
        
        // ОТЛОЖЕННЫЕ ОБНОВЛЕНИЯ
        requestAnimationFrame(() => {
            if (window.renderDrawings) window.renderDrawings();
        });
        
        this._notifySymbolChange();
        
    } else {
        console.warn('setDataQuick: нет данных');
    }
    
    this._lastTimeframe = interval;

    if (!window._dailySeparator) {
        window._dailySeparator = new DailySeparator(this);
    } else {
        window._dailySeparator.redraw();
    }
    
    if (!window._sessionHighlighter) {
        window._sessionHighlighter = new SessionHighlighter(this);
    }
}
async loadDrawingsForCurrentSymbol() {
    // Небольшая задержка, чтобы серия точно была готова
    await new Promise(resolve => setTimeout(resolve, 100));

    const key = `${this.currentSymbol}:${this.currentExchange}:${this.currentMarketType}`;
    console.log('🎨 Загрузка рисунков для:', key);

    // Загружаем все рисунки параллельно
    await Promise.all([
        window.rayManager?.loadRays(),
        window.trendLineManager?.loadTrendLines(),
        window.rulerLineManager?.loadRulers(),
        window.alertLineManager?.loadAlerts(),
        window.textManager?.loadTexts()
    ].filter(Boolean));
}
updateCurrentCandle(price) {
    if (!this.chartData || this.chartData.length === 0) return;
    const lastCandle = this.chartData[this.chartData.length - 1];
    if (!lastCandle) return;
    lastCandle.close = price;
    if (price > lastCandle.high) lastCandle.high = price;
    if (price < lastCandle.low) lastCandle.low = price;
    const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
    if (activeSeries) {
        activeSeries.update({ time: lastCandle.time, open: lastCandle.open, high: lastCandle.high, low: lastCandle.low, close: price });
    }
    this.lastCandle = lastCandle;
    this.currentRealPrice = price;
    if (activeSeries) {
        activeSeries.applyOptions({ priceLineSource: price });
    }
    if (this.scheduleUpdatePosition) {
        this.scheduleUpdatePosition();
    }
}
   onCrosshairMove(param) {
    if (!this.overlay) {
        this.overlay = safeElement('candleStatsOverlay');
    }
    
    if (!param || !param.time || !this.chartData || this.chartData.length === 0) {
        if (this.overlay) this.overlay.classList.remove('visible');
        return;
    }

    const candle = this.chartData.find(c => c.time === param.time);
    
    if (candle) {
        const isBullish = Utils.isBullish(candle.open, candle.close);
        const bullishClass = isBullish ? 'bullish' : 'bearish';
        
        if (this.openEl) {
            this.openEl.textContent = Utils.formatPrice(candle.open);
            this.openEl.className = `stat-value ${bullishClass}`;
        }
        
        if (this.highEl) {
            this.highEl.textContent = Utils.formatPrice(candle.high);
            this.highEl.className = `stat-value ${bullishClass}`;
        }
        
        if (this.lowEl) {
            this.lowEl.textContent = Utils.formatPrice(candle.low);
            this.lowEl.className = `stat-value ${bullishClass}`;
        }
        
        if (this.closeEl) {
            this.closeEl.textContent = Utils.formatPrice(candle.close);
            this.closeEl.className = `stat-value ${bullishClass}`;
        }
        
        if (this.changeEl) {
            const change = Utils.calculateChange(candle.open, candle.close);
            const changeNum = parseFloat(change);
            this.changeEl.textContent = (changeNum > 0 ? '+' : '') + change + '%';
            this.changeEl.className = `change-value ${bullishClass}`;
        }
        
        // ========== ДОБАВЛЕННЫЙ БЛОК ДЛЯ ОБЪЁМА ==========
        const volumeEl = document.getElementById('volumeValue');
        if (volumeEl) {
            // Используем функцию форматирования объёма
            volumeEl.textContent = Utils.formatVolume(candle.volume);
            volumeEl.className = `stat-value ${bullishClass}`;
        }
        // ===================================================
        
        if (this.overlay) {
            this.overlay.classList.add('visible');
        }
    } else {
        if (this.overlay) {
            this.overlay.classList.remove('visible');
        }
    }
}
 updateRealPrice(price) {
    this.currentRealPrice = price;
    const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
    if (series) {
        const lastCandle = this.chartData[this.chartData.length - 1];
        const isBullish = lastCandle ? lastCandle.close >= lastCandle.open : true;
        const lineColor = isBullish ? CONFIG.colors.bullish : CONFIG.colors.bearish;
        
        series.applyOptions({ 
            priceLineSource: price,
            priceLineColor: lineColor
        });
    }
    this.scheduleUpdatePosition();
}
    scrollToLast() {
        if (this.chart && this.chartData.length > 0) {
            const timeScale = this.chart.timeScale();
            const currentRange = timeScale.getVisibleLogicalRange();
            
            if (currentRange) {
                const visibleBarsCount = currentRange.to - currentRange.from;
                const newFrom = Math.max(0, this.chartData.length - visibleBarsCount + 10);
                
                timeScale.setVisibleLogicalRange({
                    from: newFrom,
                    to: newFrom + visibleBarsCount
                });
            } else {
                timeScale.scrollToRealTime();
                
                setTimeout(() => {
                    const newRange = timeScale.getVisibleLogicalRange();
                    if (newRange) {
                        const visibleBars = newRange.to - newRange.from;
                        timeScale.setVisibleLogicalRange({
                            from: this.chartData.length - visibleBars + 10,
                            to: this.chartData.length + 10
                        });
                    }
                }, 50);
            }
        }
    }
    clearChart() {
    if (this.candleSeries) {
        this.candleSeries.setData([]);
    }
    if (this.barSeries) {
        this.barSeries.setData([]);
    }
    if (this.volumeSeries) {
        this.volumeSeries.setData([]);
    }
    
    this.chartData = [];
    this.lastCandle = null;
    
    const priceScale = this.chart.priceScale('right');
    if (priceScale) {
        priceScale.applyOptions({ autoScale: true });
    }
}
    autoScale() {
        
        if (this.chart && this.chartData.length > 0) {
            const timeScale = this.chart.timeScale();
            const visibleRange = timeScale.getVisibleLogicalRange();
            
            if (visibleRange) {
                const fromIndex = Math.max(0, Math.floor(visibleRange.from));
                const toIndex = Math.min(this.chartData.length - 1, Math.ceil(visibleRange.to));
                
                if (fromIndex < toIndex && fromIndex >= 0 && toIndex < this.chartData.length) {
                    let minPrice = Infinity, maxPrice = -Infinity;
                    
                    for (let i = fromIndex; i <= toIndex; i++) {
                        minPrice = Math.min(minPrice, this.chartData[i].low);
                        maxPrice = Math.max(maxPrice, this.chartData[i].high);
                    }
                    
                    const padding = (maxPrice - minPrice) * 0.05;
                    
                    const priceScale = this.chart.priceScale('right');
                    if (priceScale) {
                        priceScale.applyOptions({
                            autoScale: true,
                        });
                        
                        setTimeout(() => {
                            priceScale.applyOptions({
                                autoScale: true,
                            });
                        }, 10);
                    }
                    
                    setTimeout(() => {
                        if (this.timerManager && this.timerManager._primitive) {
                            this.timerManager._primitive.requestRedraw();
                        }
                    }, 50);
                }
            } else {
                const priceScale = this.chart.priceScale('right');
                if (priceScale) {
                    priceScale.applyOptions({
                        autoScale: true,
                    });
                }
            }
        }
    }

    getLastCandle() {
        return this.lastCandle;
    }
    
    getChart() {
        return this.chart;
    }
    
    setCurrentInterval(interval) {
        this.currentInterval = interval;
    }
_updateMainChartHeight() {
    if (this._resizeTimer) clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
        this._doUpdateMainChartHeight();
    }, 100);
}

_doUpdateMainChartHeight() {
    if (!this.chart) return;
    
    const chartContainer = document.getElementById('chart-container');
    const panelsContainer = document.getElementById('indicator-panels-container');
    
    if (!chartContainer) return;

    const availableHeight = window.innerHeight - 48;
    const panelsHeight = panelsContainer ? panelsContainer.offsetHeight : 0;
    let newChartHeight = availableHeight - panelsHeight;
    
    if (newChartHeight < 200) newChartHeight = 200;
    
    chartContainer.style.height = newChartHeight + 'px';
    chartContainer.style.maxHeight = newChartHeight + 'px';
    
    if (panelsContainer) {
        panelsContainer.style.position = 'absolute';
        panelsContainer.style.top = newChartHeight + 'px';
        panelsContainer.style.bottom = 'auto';
    }
    
    const width = chartContainer.clientWidth;
    this.chart.resize(width, newChartHeight);
    
    const volumeScale = this.chart.priceScale('volume');
    if (volumeScale) {
        volumeScale.applyOptions({
            scaleMargins: { top: 0.7, bottom: 0 }
        });
    }
}
 _resizeIndicatorPanels() {
    const chartContainer = document.getElementById('chart-container');
    if (!chartContainer) return;
    
    const width = chartContainer.clientWidth;
    
    // 👇 ИСПРАВЛЕНО: panelManager находится внутри indicatorManager
    if (this.indicatorManager && this.indicatorManager.panelManager) {
        this.indicatorManager.panelManager.resize(width);
        this._updateMainChartHeight();
    }
}


    addIndicator(type) {
    return this.indicatorManager.addIndicator(type);
    // В конце метода addIndicator, перед return true
setTimeout(() => {
    this.chartManager._updateMainChartHeight();
}, 50);
}

removeIndicatorByType(type) {
    return this.indicatorManager.removeIndicator(type);
}

clearAllIndicators() {
    this.indicatorManager.clearAllIndicators();
}

updateAllIndicators() {
    this.indicatorManager.updateAllIndicators();
}

restoreIndicators() {
    this.indicatorManager.loadIndicators();
}

async _syncAfterHidden() {
    if (!this.chartData.length) return;

    const lastCandle = this.chartData[this.chartData.length - 1];
    const nowSec = Math.floor(Date.now() / 1000);

    // Длительность одного интервала в секундах
    const intervalSeconds = {
        '1m': 60, '3m': 180, '5m': 300, '15m': 900,
        '30m': 1800, '1h': 3600, '4h': 14400, '6h': 21600,
        '12h': 43200, '1d': 86400, '1w': 604800, '1M': 2592000
    }[this.currentInterval] || 3600;

    // Если прошло больше 1.5 интервалов — точно был пропуск
    if (nowSec - lastCandle.time < intervalSeconds * 1.5) {
        // Пропусков нет, просто перерисовываем
        this.forceRedraw();
        return;
    }

    console.log('🔄 Обнаружен гэп, загружаем пропущенные свечи...');
    try {
        const freshCandles = await this.fetchKlines(
            this.currentSymbol,
            this.currentExchange,
            this.currentMarketType,
            this.currentInterval,
            1000
        );

        if (freshCandles && freshCandles.length > 0) {
            // Оставляем только свечи строго позже последней известной
            const newCandles = freshCandles.filter(c => c.time > lastCandle.time);
            if (newCandles.length > 0) {
                // Удаляем возможные дубли и объединяем
                const allCandles = [...this.chartData, ...newCandles];
                this.chartData = allCandles
                    .filter((v, i, a) => a.findIndex(t => t.time === v.time) === i)
                    .sort((a, b) => a.time - b.time);

                this._performUpdate();  // обновит свечи и объём
                console.log(`✅ Добавлено ${newCandles.length} пропущенных свечей`);
            }
        }
    } catch (e) {
        console.warn('⚠️ Ошибка при синхронизации после скрытия:', e);
    }

    this.forceRedraw(); // для перерисовки примитивов (таймер, рисунки)
}


// Сохранить текущий масштаб и позицию
_saveZoomState() {
    const timeScale = this.chart.timeScale();
    if (!timeScale) return;
    
    const visibleRange = timeScale.getVisibleLogicalRange();
    if (visibleRange) {
        this._savedZoomRange = {
            from: visibleRange.from,
            to: visibleRange.to
        };
        console.log('💾 Масштаб сохранён:', this._savedZoomRange);
    }
}

_restoreZoomState() {
    if (!this._savedZoomRange) return;
    
    const timeScale = this.chart.timeScale();
    if (!timeScale) return;
    
    const dataLength = this.chartData.length;
    const savedFrom = this._savedZoomRange.from;
    const savedTo = this._savedZoomRange.to;
    const savedLength = savedTo - savedFrom;
    
    // Проверяем, не выходит ли сохранённый диапазон за пределы новых данных
    if (savedFrom >= dataLength) {
        // Сохранённая позиция была за пределами данных (данные обновились)
        // Остаёмся у правого края с тем же количеством свечей
        timeScale.setVisibleLogicalRange({
            from: Math.max(0, dataLength - savedLength),
            to: dataLength
        });
    } else {
        // Восстанавливаем точную позицию, усекая до текущего размера данных
        timeScale.setVisibleLogicalRange({
            from: savedFrom,
            to: Math.min(dataLength, savedTo)
        });
    }
    
    this._savedZoomRange = null;
}
_subscribeToPrice() {
    if (!this.priceManager) return;
    
    if (this._priceUpdateHandler) {
        this.priceManager.unsubscribe(this.currentSymbol, this._priceUpdateHandler);
    }
    
    this._priceUpdateHandler = (price, symbol) => {
        if (document.hidden) return;
        if (symbol !== this.currentSymbol) return;
        
        this.currentRealPrice = price;
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (!series) return;

        // 1. Двигаем линию цены
        series.applyOptions({ priceLineSource: price });

        // 2. Цвет меняем ТОЛЬКО при смене свечи
        const lastCandle = this.chartData[this.chartData.length - 1];
        const isBullish = lastCandle ? lastCandle.close >= lastCandle.open : true;
        const newColor = isBullish ? CONFIG.colors.bullish : CONFIG.colors.bearish;
        
        if (this._lastAppliedColor !== newColor) {
            this._lastAppliedColor = newColor;
            series.applyOptions({ priceLineColor: newColor });
        }

        // 3. Обновляем свечу
        if (lastCandle && lastCandle.time) {
            series.update({
                time: lastCandle.time,
                open: lastCandle.open,
                high: lastCandle.high,
                low: lastCandle.low,
                close: price
            });
        }

        this.scheduleUpdatePosition();
    };
    
    this.priceManager.subscribe(this.currentSymbol, this._priceUpdateHandler);
    
    const cachedPrice = this.priceManager.getPrice(this.currentSymbol);
    if (cachedPrice !== null) {
        this.currentRealPrice = cachedPrice;
    }
}
    setSymbol(symbol) {
        if (this.currentSymbol === symbol) return;
        this.currentSymbol = symbol;
        this._subscribeToPrice();
    }
    // ДОБАВЬ ЭТОТ МЕТОД В ChartManager
// Метод для вычисления точности из самих данных (Fallback)
_inferPrecisionFromData() {
    if (!this.chartData || this.chartData.length === 0) return 2;
    const lastPrice = this.chartData[this.chartData.length - 1].close;
    if (!lastPrice || lastPrice === 0) return 2;
    
    const str = lastPrice.toString();
    if (str.includes('.')) {
        const decimals = str.split('.')[1].length;
        return Math.min(decimals, 8);
    }
    return 2;
}

// Обновленный метод с обработкой ошибок и принудительным обновлением
applyPriceFormat(precision) {
    try {
        if (precision === null || precision === undefined || isNaN(precision) || precision < 0) {
            console.warn('⚠️ Precision не получен, вычисляем из данных графика...');
            precision = this._inferPrecisionFromData();
        }

        const minMove = Math.pow(10, -precision);
        const priceFormat = { type: 'price', precision: precision, minMove: minMove };

        // 2. Применяем к сериям
        if (this.candleSeries) this.candleSeries.applyOptions({ priceFormat });
        if (this.barSeries) this.barSeries.applyOptions({ priceFormat });

        // 3. Применяем к шкале ОДНИМ вызовом
        const priceScale = this.chart.priceScale('right');
        if (priceScale) {
            priceScale.applyOptions({ 
                priceFormat: priceFormat,
                autoScale: true 
            });
        }

        console.log(`✅ Формат цены применен: ${precision} знаков`);
        return precision;

    } catch (error) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА applyPriceFormat:', error);
        return this._inferPrecisionFromData();
    }
} 
_isValidCandle(candle) {
    if (!candle || typeof candle !== 'object') return false;
    
    // Time — обязателен
    if (typeof candle.time !== 'number' || isNaN(candle.time) || candle.time <= 0) {
        return false;
    }
    
    // OHLC — конечные числа
    const ohlcFields = ['open', 'high', 'low', 'close'];
    for (const field of ohlcFields) {
        const val = candle[field];
        if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) {
            return false;
        }
    }
    
    // High >= Low
    if (candle.high < candle.low) return false;
    
    // Open/Close внутри High-Low
    if (candle.open > candle.high || candle.open < candle.low ||
        candle.close > candle.high || candle.close < candle.low) {
        return false;
    }
    
    // Volume — число >= 0
    if (candle.volume !== undefined && candle.volume !== null) {
        if (typeof candle.volume !== 'number' || isNaN(candle.volume) || candle.volume < 0) {
            return false;
        }
    }
    
    return true;
}

// --- 2. САНИТАЙЗЕР: пытается починить битую свечу ---
_sanitizeCandle(candle) {
    if (!candle) return null;
    
    const clean = { ...candle };
    const fields = ['open', 'high', 'low', 'close'];
    
    // Ищем валидные значения
    const validValues = fields.filter(f => 
        typeof clean[f] === 'number' && !isNaN(clean[f]) && isFinite(clean[f])
    );
    
    if (validValues.length === 0) return null; // Всё битое — удаляем
    
    const avgValue = validValues.reduce((s, f) => s + clean[f], 0) / validValues.length;
    
    // Восстанавливаем битые поля средним
    for (const field of fields) {
        if (typeof clean[field] !== 'number' || isNaN(clean[field]) || !isFinite(clean[field])) {
            clean[field] = avgValue;
        }
    }
    
    // Volume
    if (typeof clean.volume !== 'number' || isNaN(clean.volume) || clean.volume < 0) {
        clean.volume = 0;
    }
    
    // Исправляем high/low
    const ohlc = [clean.open, clean.high, clean.low, clean.close];
    clean.high = Math.max(...ohlc);
    clean.low = Math.min(...ohlc);
    
    return clean;
}

// --- 3. ИСПРАВЛЕННЫЙ updateLastCandle ---
updateLastCandle(candle) {
    // Базовая проверка времени
    if (!candle || typeof candle.time !== 'number' || isNaN(candle.time) || candle.time <= 0) {
        console.warn('⚠️ Пропущена свеча с некорректным временем:', candle);
        return;
    }
    
    try {
        // ВАЛИДАЦИЯ
        if (!this._isValidCandle(candle)) {
            console.warn('⚠️ Битая свеча обнаружена:', candle);
            
            const sanitized = this._sanitizeCandle(candle);
            if (!sanitized) {
                console.error('❌ Свечу невозможно исправить, пропускаем');
                return;
            }
            
            candle = sanitized;
        }
        
        const existingIndex = this.chartData.findIndex(c => c.time === candle.time);
        
        if (existingIndex !== -1) {
            this.chartData[existingIndex] = candle;
        } else {
            this.chartData.push(candle);
            const limit = CONFIG.klineLimits[this.currentInterval] || 1000;
            if (this.chartData.length > limit) {
                this.chartData = this.chartData.slice(-limit);
            }
        }
        
        const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (activeSeries) {
            activeSeries.update({
                time: candle.time,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close
            });
        }
        
        this.currentRealPrice = candle.close;
        if (activeSeries) {
            activeSeries.applyOptions({ priceLineSource: candle.close });
        }
        
        if (this.volumeSeries && this.chartData.length > 0) {
            const volumeData = this.chartData.map(c => ({
                time: c.time,
                value: c.volume || 0,
                color: c.close >= c.open ? this.bullishColor : this.bearishColor
            }));
            this.volumeSeries.setData(volumeData);
        }
        
        this.lastCandle = candle;
        
    } catch (e) {
        console.error('❌ Ошибка в updateLastCandle:', e);
    }
}

// --- 4. ИСПРАВЛЕННЫЙ updateCurrentCandle ---
updateCurrentCandle(price) {
    if (!this.chartData || this.chartData.length === 0) return;
    
    const lastCandle = this.chartData[this.chartData.length - 1];
    if (!lastCandle) return;
    
    // ВАЛИДАЦИЯ цены от WebSocket
    if (typeof price !== 'number' || isNaN(price) || !isFinite(price) || price <= 0) {
        return; // Молча игнорируем битую цену
    }
    
    lastCandle.close = price;
    if (price > lastCandle.high) lastCandle.high = price;
    if (price < lastCandle.low) lastCandle.low = price;
    
    const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
    if (activeSeries) {
        activeSeries.update({ 
            time: lastCandle.time, 
            open: lastCandle.open, 
            high: lastCandle.high, 
            low: lastCandle.low, 
            close: price 
        });
    }
    
    this.lastCandle = lastCandle;
    this.currentRealPrice = price;
    
    if (activeSeries) {
        activeSeries.applyOptions({ priceLineSource: price });
    }
    
    if (this.scheduleUpdatePosition) {
        this.scheduleUpdatePosition();
    }
}

// --- 5. ИСПРАВЛЕННЫЙ fetchKlines с фильтрацией + quoteVolume ---
async fetchKlines(symbol, exchange, marketType, interval, limit = 1000) {
    const bybitIntervalMap = {
        '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
        '1h': '60', '4h': '240', '6h': '360', '12h': '720',
        '1d': 'D', '1w': 'W', '1M': 'M'
    };

    let url;
    if (exchange === 'binance') {
        url = marketType === 'futures'
            ? `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
            : `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    } else {
        const bybitInt = bybitIntervalMap[interval] || interval;
        const cat = marketType === 'futures' ? 'linear' : 'spot';
        url = `https://api.bybit.com/v5/market/kline?category=${cat}&symbol=${symbol}&interval=${bybitInt}&limit=${limit}`;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    let rawCandles;
    
    if (exchange === 'binance') {
        rawCandles = data.map(item => ({
            time: Math.floor(item[0] / 1000),
            open: parseFloat(item[1]),
            high: parseFloat(item[2]),
            low: parseFloat(item[3]),
            close: parseFloat(item[4]),
            volume: parseFloat(item[5]),
            quoteVolume: parseFloat(item[7])   // ← ДОБАВЛЕНО
        }));
    } else {
        if (data.retCode !== 0) throw new Error(data.retMsg);
        rawCandles = data.result.list.map(item => ({
            time: Math.floor(parseInt(item[0]) / 1000),
            open: parseFloat(item[1]),
            high: parseFloat(item[2]),
            low: parseFloat(item[3]),
            close: parseFloat(item[4]),
            volume: parseFloat(item[5] || 0),
            quoteVolume: parseFloat(item[6] || 0)   // ← ДОБАВЛЕНО
        })).filter(c => c !== null).reverse();
    }
    
    // ═══════════════════════════════════════
    // ФИЛЬТРАЦИЯ БИТЫХ СВЕЧЕЙ + ДУБЛИКАТОВ
    // ═══════════════════════════════════════
    const beforeCount = rawCandles.length;
    
    // Убираем дубли по времени
    const seenTimes = new Set();
    const noDupes = rawCandles.filter(c => {
        if (seenTimes.has(c.time)) return false;
        seenTimes.add(c.time);
        return true;
    });
    
    // Валидируем каждую свечу
    const validCandles = noDupes.filter(c => this._isValidCandle(c));
    
    const removedCount = beforeCount - validCandles.length;
    if (removedCount > 0) {
        console.warn(`⚠️ fetchKlines: отфильтровано ${removedCount} битых/дублей из ${beforeCount}`);
    }
    
    // Сортируем по времени
    validCandles.sort((a, b) => a.time - b.time);
    
    return validCandles;
}
_updatePageTitle() {
    const symbol = this.currentSymbol || '';
    const price = this.currentRealPrice;
    
    if (!symbol) {
        document.title = 'График';
        return;
    }
    
    if (price != null && !isNaN(price) && price > 0) {
        // Точность из текущего формата
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        const precision = series?.options()?.priceFormat?.precision || 2;
        
        // Определяем цвет (стрелка)
        const lastCandle = this.chartData?.[this.chartData.length - 1];
        const isBullish = lastCandle ? lastCandle.close >= lastCandle.open : true;
        const arrow = isBullish ? '▲' : '▼';
        
        document.title = `${arrow} ${symbol} ${price.toFixed(precision)}`;
    } else {
        document.title = `${symbol}`;
    }
}
}
if (typeof window !== 'undefined') {
    window.ChartManager = ChartManager;
}
