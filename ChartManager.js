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
        
        // 🔥 ИСПРАВЛЕНИЕ #1: Инициализируем цену как null!
        this.currentRealPrice = null;
        this._lastAppliedColor = null;
        this._lastLineColor = null;
        
        this._lastWidth = this.chartContainer.clientWidth;
        this._initPromise = null;
        this._lastHeight = this.chartContainer.clientHeight;
        this._savedTimePosition = null;
        this._lastTimeframe = null;
        this._symbolChangeCallbacks = [];
        this._updateScheduled = false;
        this._lastUpdateTime = 0;
        this._drawingsUpdateRafId = null;
        this._pendingUpdates = false;
        this._updatePositionRafId = null;
        
        this._redrawLoopRunning = false;
        this._lastRedrawFrame = 0;
        this._pendingRedraw = false;
        this._isSyncing = false;

        this._visibilityHandler = () => {
            if (document.hidden) {
                // Ничего не делаем при скрытии
            } else {
                this._syncAfterHidden();
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
                minBarSpacing: 1,
                fixLeftEdge: false,
                fixRightEdge: false,
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

        // Создаём свечную серию
        this.candleSeries = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: CONFIG.colors.bullish,
            downColor: CONFIG.colors.bearish,
            borderVisible: false,
            wickUpColor: CONFIG.colors.bullish,
            wickDownColor: CONFIG.colors.bearish,
            priceScaleId: 'right',
        });

        // Создаём барную серию
        this.barSeries = this.chart.addSeries(LightweightCharts.BarSeries, {
            upColor: CONFIG.colors.bullish,
            downColor: CONFIG.colors.bearish,
            openVisible: true,
            thinBars: true,
            priceScaleId: 'right',
        });

        // 🔥 ИСПРАВЛЕНИЕ #2: НЕ устанавливаем priceLineSource здесь!
        this.candleSeries.applyOptions({
            priceLineVisible: true,
            lastValueVisible: true,
            priceLineColor: '#00bcd4',
            priceLineWidth: 1,
            priceLineStyle: LightweightCharts.LineStyle.Dashed
        });

        this.barSeries.applyOptions({
            priceLineVisible: true,
            lastValueVisible: true,
            priceLineColor
