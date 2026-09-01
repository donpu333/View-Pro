class ChartManager {
    constructor(container) {
        // ============ БАЗОВЫЕ ПЕРЕМЕННЫЕ ============
        this.chartData = [];
        this.lastCandle = null;
        this._loadingSymbol = false;
        this._switchingSymbol = false;
        this._pendingSymbolSwitch = null;
        this._generationCounter = 0;
        this._activeGeneration = 0;
        this._updatesSuspended = false;
        this._isRestoringZoom = false;
        this._isSwitchingInterval = false;
        this._isSwitchingChartType = false;

        // ============ НАСТРОЙКИ ============
        const savedChartType = localStorage.getItem('chartType') || 'candle';
        this.currentChartType = savedChartType;
        this.isLoadingMore = false;
        this.hasMoreData = true;
        this._priceSubscriptionKey = null;
        this.currentInterval = localStorage.getItem('lastTimeframe') || '1h';
        this.currentSymbol = 'BTCUSDT';
        this.currentExchange = 'binance';
        this.currentMarketType = 'futures';

        // ============ МЕНЕДЖЕРЫ ============
        this.indicatorManager = new IndicatorManager(this);
        this.chartContainer = document.getElementById('chart-container') || container;

        // ============ ОПТИМИЗАЦИЯ ============
        this._candleTimeMap = new Map();
        this._formatCache = new Map();
        this._lastCrosshairColor = null;
        this._lastTitle = null;
        this._bgTitleInterval = null;
        this._isScrolling = false;
        this._isScrollingFast = false;
        this._lastScrollTime = 0;
        this._scrollStopTimeout = null;
        this._lastVisibleRange = null;
        this._isViewingHistory = false;
        this._priceUpdateRafId = null;
        this._pendingPriceValue = null;
        this._crosshairRafId = null;
        this._latestCrosshairData = null;
        this._pendingCrosshairParam = null;
        this._drawingsRafId = null;
        this._refreshingAfterHidden = false;
        this._periodicSyncInterval = null;
        this._lastKlineEventTime = 0;
        this._catchingUpMissed = false;
        this._lastCatchUpAttempt = 0;
        this._currentFetchController = null;
        this._historyFetchController = null;
        this._backgroundFetchController = null;
        this._fetchTimeoutMs = 15000;

        // ============ DOM ЭЛЕМЕНТЫ ============
        this.overlay = this._safeElement('candleStatsOverlay');
        this.openEl = this._safeElement('openValue');
        this.highEl = this._safeElement('highValue');
        this.lowEl = this._safeElement('lowValue');
        this.closeEl = this._safeElement('closeValue');
        this.changeEl = this._safeElement('changeValue');
        this.volumeEl = document.getElementById('volumeValue');

        // ============ ЦВЕТА ============
        this.bullishColor = localStorage.getItem('chartBullishColor') || '#26a69a';
        this.bearishColor = localStorage.getItem('chartBearishColor') || '#ef5350';

        // ============ СОЗДАНИЕ ГРАФИКА ============
        this.chart = LightweightCharts.createChart(container, {
            layout: {
                background: { color: localStorage.getItem('chartBgColor') || '#000000' },
                textColor: '#808080'
            },
            grid: {
                vertLines: { visible: false },
                horzLines: { visible: false }
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal
            },
            handleScroll: {
                mouseWheel: true,
                pressedMouseMove: true,
                horzTouchDrag: true,
                vertTouchDrag: true
            },
            handleScale: {
                axisPressedMouseMove: true,
                mouseWheel: true,
                pinch: true
            },
            animation: { duration: 0 },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: '#333333',
                barSpacing: parseFloat(localStorage.getItem('chartBarSpacing')) || 25,
                minBarSpacing: 1,
                fixLeftEdge: false,
                fixRightEdge: false,
                rightOffset: 12,
                shiftVisibleRangeOnNewBar: true,
                tickMarkFormatter: (time) => {
                    const date = new Date(time * 1000);
                    return date.toLocaleTimeString('ru-RU', {
                        timeZone: 'Europe/Moscow',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }
            },
            rightPriceScale: {
                borderColor: '#333333',
                borderVisible: true,
                scaleMargins: { top: 0.1, bottom: 0.25 },
                autoScale: true,
                entireTextOnly: true
            },
            localization: {
                timeFormatter: (time) => {
                    return new Date(time * 1000).toLocaleString('ru-RU', {
                        timeZone: 'Europe/Moscow',
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }
            }
        });

        // ============ СЕРИИ ДАННЫХ ============
        this.candleSeries = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: this.bullishColor,
            downColor: this.bearishColor,
            borderVisible: false,
            wickUpColor: this.bullishColor,
            wickDownColor: this.bearishColor,
            priceScaleId: 'right'
        });

        this.barSeries = this.chart.addSeries(LightweightCharts.BarSeries, {
            upColor: this.bullishColor,
            downColor: this.bearishColor,
            openVisible: true,
            thinBars: true,
            priceScaleId: 'right'
        });

        // Настройка price line для обеих серий
        [this.candleSeries, this.barSeries].forEach(series => {
            series.applyOptions({
                priceLineVisible: true,
                lastValueVisible: true,
                priceLineColor: '#00bcd4',
                priceLineWidth: 1,
                priceLineStyle: LightweightCharts.LineStyle.Dashed,
                lastValueLabelBackgroundColor: '#00bcd4',
                priceLineTitle: ''
            });
        });

        // ============ VOLUME SERIES (ВСТРОЕННОЕ РЕШЕНИЕ) ============
        this.volumeSeries = this.chart.addSeries(LightweightCharts.HistogramSeries, {
            priceScaleId: 'volume',
            priceFormat: { type: 'volume' },
            color: '#26a69a',
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false,
            title: ''
        });

        // Настройка шкалы volume через встроенные методы
        const volumeScale = this.chart.priceScale('volume');
        volumeScale.applyOptions({
            scaleMargins: {
                top: 0.85,  // Гистограмма занимает нижние 15% графика
                bottom: 0
            },
            visible: true,
            borderVisible: true
        });

        // ============ ВИДИМОСТЬ СЕРИЙ ============
        const isCandle = this.currentChartType === 'candle';
        this.candleSeries.applyOptions({ visible: isCandle });
        this.barSeries.applyOptions({ visible: !isCandle });

        // ============ ПОДПИСКИ ============
        this.chart.subscribeCrosshairMove(this.onCrosshairMove.bind(this));
        this.setupOptimizedSubscriptions();
        this.setupEventListeners();

        // ============ ИНИЦИАЛИЗАЦИЯ ============
        this.alertTimers = new Map();
        this.currentRealPrice = null;
        this.timerManager = null;

        setTimeout(() => {
            this.priceManager = window.priceManagerInstance;
            if (this.priceManager) this._subscribeToPrice();
        }, 200);

        this._startNewCandleChecker();
        this._startPeriodicSync();

        setTimeout(() => {
            if (window.wsManager && typeof window.wsManager.connect === 'function') {
                window.wsManager.connect(this.currentSymbol, this.currentInterval, this.currentExchange, this.currentMarketType);
            }
        }, 1000);
    }

    // ============ УТИЛИТЫ ============
    _safeElement(id) {
        const el = document.getElementById(id);
        return el ? el : {
            classList: { add: () => {}, remove: () => {} },
            textContent: '',
            style: {}
        };
    }

    _isChartValid() {
        return this.chart && this.candleSeries && this.barSeries && this.chartContainer && document.contains(this.chartContainer);
    }

    _getLineColor() {
        if (!this.chartData || this.chartData.length === 0) return this.bullishColor;
        const lastCandle = this.chartData[this.chartData.length - 1];
        if (!lastCandle) return this.bullishColor;
        return lastCandle.close >= lastCandle.open ? this.bullishColor : this.bearishColor;
    }

    _applyPriceLineColor(series, color) {
        if (!series || !color) return;
        if (series.__lastLineColor === color) return;
        series.applyOptions({
            priceLineColor: color,
            priceLineSource: 'lastBar',
            lastValueVisible: true,
            lastValueLabelBackgroundColor: color,
            lastValueLabelTextColor: this._isDarkColor(color) ? '#ffffff' : '#000000',
            priceLineTitle: ''
        });
        series.__lastLineColor = color;
    }

    _isDarkColor(hexColor) {
        if (!hexColor || typeof hexColor !== 'string') return false;
        let hex = hexColor.replace('#', '');
        if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        if (hex.length !== 6) return false;
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return ((r * 299) + (g * 587) + (b * 114)) / 1000 < 150;
    }

    _syncLineColor() {
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (!series) return;
        const lineColor = this._getLineColor();
        this._applyPriceLineColor(series, lineColor);
        if (this.timerManager) this.timerManager.forceColorUpdate();
    }

    _getIntervalSeconds() {
        const stepMap = {
            '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
            '1h': 3600, '4h': 14400, '6h': 21600, '12h': 43200,
            '1d': 86400, '1w': 604800, '1M': 2592000
        };
        return stepMap[this.currentInterval] || 3600;
    }

    _alignTimeToInterval(nowSec) {
        const stepMap = {
            '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
            '1h': 3600, '4h': 14400, '6h': 21600, '12h': 43200,
            '1d': 86400, '1w': 604800, '1M': 2592000
        };
        
        if (this.currentInterval === '1w') {
            const now = new Date(nowSec * 1000);
            const dayOfWeek = now.getUTCDay();
            const daysToMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7;
            const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysToMonday));
            return Math.floor(monday.getTime() / 1000);
        } else if (this.currentInterval === '1M') {
            const now = new Date(nowSec * 1000);
            const firstDayOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
            return Math.floor(firstDayOfMonth.getTime() / 1000);
        } else {
            const step = stepMap[this.currentInterval] || 3600;
            return Math.floor(nowSec / step) * step;
        }
    }

    _rebuildTimeMap() {
        this._candleTimeMap.clear();
        for (let i = 0; i < this.chartData.length; i++) {
            this._candleTimeMap.set(this.chartData[i].time, i);
        }
    }

    _addToTimeMap(time, index) {
        this._candleTimeMap.set(time, index);
    }

    _stampCandle(candle, source, receivedAt) {
        if (!candle) return candle;
        candle._source = source;
        candle._receivedAt = receivedAt || Date.now();
        return candle;
    }

    _isFresherUpdate(existingCandle, receivedAt, source) {
        if (!existingCandle || existingCandle._receivedAt === undefined) return true;
        if (receivedAt > existingCandle._receivedAt) return true;
        if (receivedAt === existingCandle._receivedAt) return source === 'ws' && existingCandle._source !== 'ws';
        return false;
    }

    // ============ ПОДПИСКИ ============
    setupOptimizedSubscriptions() {
        if (!this.chart || !this.chart.timeScale()) return;
        
        this.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (!this._isChartValid()) return;
            
            const now = performance.now();
            this._isScrollingFast = (now - this._lastScrollTime) < 40;
            this._isScrolling = true;
            this._lastScrollTime = now;
            this._lastVisibleRange = range;
            
            if (range && this.chartData && this.chartData.length > 0) {
                const lastIndex = this.chartData.length - 1;
                this._isViewingHistory = range.to < lastIndex;
            }
            
            clearTimeout(this._scrollStopTimeout);
            this._scrollStopTimeout = setTimeout(() => {
                this._isScrolling = false;
                this._isScrollingFast = false;
                this.onVisibleLogicalRangeChange(this._lastVisibleRange);
            }, 150);
        });
    }

    setupEventListeners() {
        // Mouse leave
        this._mouseLeaveHandler = () => {
            if (this.overlay) this.overlay.classList.remove('visible');
            this._latestCrosshairData = null;
            if (this.chart) {
                try { this.chart.clearCrosshairPosition(); } catch(e) {}
            }
        };
        this.chartContainer.addEventListener('mouseleave', this._mouseLeaveHandler);

        // Visibility change
        this._visibilityHandler = () => {
            if (!document.hidden) {
                this.refreshCandlesAfterTabHidden();
                if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);

        // Resize
        let resizeTimeout;
        this._resizeHandler = () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (this._isChartValid()) {
                    this._updateMainChartHeight();
                    if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
                }
            }, 100);
        };
        window.addEventListener('resize', this._resizeHandler);
    }

    // ============ CROSSHAIR ============
    onCrosshairMove(param) {
        this._pendingCrosshairParam = param;
        if (this._crosshairRafId) return;
        
        this._crosshairRafId = requestAnimationFrame(() => {
            this._crosshairRafId = null;
            this._processCrosshair(this._pendingCrosshairParam);
        });
    }

    _processCrosshair(param) {
        if (document.hidden || !param || !param.time || !param.point || !this._isChartValid()) {
            if (this.overlay) this.overlay.classList.remove('visible');
            this._latestCrosshairData = null;
            return;
        }
        
        const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        const candle = param.seriesData.get(activeSeries);
        
        if (candle) {
            const isBullish = candle.close >= candle.open;
            const change = typeof Utils !== 'undefined' ? Utils.calculateChange(candle.open, candle.close) : '0';
            const changeNum = parseFloat(change);
            const index = this._candleTimeMap.get(param.time);
            const vol = index !== undefined ? (this.chartData[index].quoteVolume || 0) : 0;
            
            this._latestCrosshairData = {
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                change: (changeNum > 0 ? '+' : '') + change + '%',
                volume: typeof Utils !== 'undefined' ? Utils.formatVolume(vol) : vol,
                cls: isBullish ? 'bullish' : 'bearish',
                visible: true,
                time: param.time,
                pointX: param.point.x
            };
        } else {
            this._latestCrosshairData = {
                visible: false,
                time: param.time,
                pointX: param.point.x
            };
        }
        
        this._applyCrosshairDOMOptimized();
    }

    _applyCrosshairDOMOptimized() {
        const data = this._latestCrosshairData;
        if (!data || !data.visible) {
            if (this.overlay) this.overlay.classList.remove('visible');
            return;
        }
        
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        const precision = series?.options()?.priceFormat?.precision ?? 2;
        
        const formatWithPrecision = (value) => {
            if (value === undefined || value === null || isNaN(value)) return '—';
            const key = `${value}_${precision}`;
            if (!this._formatCache.has(key)) {
                const formatted = Number(value).toFixed(precision);
                this._formatCache.set(key, formatted);
                if (this._formatCache.size > 500) {
                    this._formatCache.delete(this._formatCache.keys().next().value);
                }
                return formatted;
            }
            return this._formatCache.get(key);
        };
        
        const color = data.cls === 'bullish' ? this.bullishColor : this.bearishColor;
        
        if (this._lastCrosshairColor !== color) {
            this._lastCrosshairColor = color;
            const styleColor = `color: ${color}`;
            if (this.openEl) this.openEl.style.cssText = styleColor;
            if (this.highEl) this.highEl.style.cssText = styleColor;
            if (this.lowEl) this.lowEl.style.cssText = styleColor;
            if (this.closeEl) this.closeEl.style.cssText = styleColor;
            if (this.changeEl) this.changeEl.style.cssText = styleColor;
            if (this.volumeEl) this.volumeEl.style.cssText = styleColor;
        }
        
        const baseClass = `stat-value ${data.cls}`;
        const changeClass = `change-value ${data.cls}`;
        
        const newOpen = formatWithPrecision(data.open);
        if (this.openEl && this.openEl.textContent !== newOpen) {
            this.openEl.textContent = newOpen;
        }
        if (this.openEl && this.openEl.className !== baseClass) {
            this.openEl.className = baseClass;
        }
        
        const newHigh = formatWithPrecision(data.high);
        if (this.highEl && this.highEl.textContent !== newHigh) {
            this.highEl.textContent = newHigh;
        }
        if (this.highEl && this.highEl.className !== baseClass) {
            this.highEl.className = baseClass;
        }
        
        const newLow = formatWithPrecision(data.low);
        if (this.lowEl && this.lowEl.textContent !== newLow) {
            this.lowEl.textContent = newLow;
        }
        if (this.lowEl && this.lowEl.className !== baseClass) {
            this.lowEl.className = baseClass;
        }
        
        const newClose = formatWithPrecision(data.close);
        if (this.closeEl && this.closeEl.textContent !== newClose) {
            this.closeEl.textContent = newClose;
        }
        if (this.closeEl && this.closeEl.className !== baseClass) {
            this.closeEl.className = baseClass;
        }
        
        if (this.changeEl && this.changeEl.textContent !== data.change) {
            this.changeEl.textContent = data.change;
        }
        if (this.changeEl && this.changeEl.className !== changeClass) {
            this.changeEl.className = changeClass;
        }
        
        if (this.volumeEl && this.volumeEl.textContent !== data.volume) {
            this.volumeEl.textContent = data.volume;
        }
        if (this.volumeEl && this.volumeEl.className !== baseClass) {
            this.volumeEl.className = baseClass;
        }
        
        if (this.overlay && !this.overlay.classList.contains('visible')) {
            this.overlay.classList.add('visible');
        }
    }

    // ============ ОБНОВЛЕНИЕ ЦЕН ============
    _syncPriceLine(price) {
        if (price && typeof price === 'object') {
            if (typeof price.price === 'number') price = price.price;
            else if (typeof price.close === 'number') price = price.close;
            else if (typeof price.last === 'number') price = price.last;
            else return;
        }
        
        if (typeof price !== 'number' || isNaN(price) || price <= 0) return;
        if (this._updatesSuspended || !this._isChartValid()) return;
        
        this._pendingPriceValue = price;
        if (this._priceUpdateRafId !== null) return;
        
        this._priceUpdateRafId = requestAnimationFrame(() => {
            this._priceUpdateRafId = null;
            const p = this._pendingPriceValue;
            this._pendingPriceValue = null;
            if (p !== null && p !== undefined) this._applyPriceUpdate(p);
        });
    }

    _applyPriceUpdate(price) {
        if (this._updatesSuspended || !this._isChartValid()) return;
        
        const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
        if (!series || !this.chartData || this.chartData.length === 0) return;
        
        const lastCandle = this.chartData[this.chartData.length - 1];
        if (!lastCandle) return;
        
        const nowSec = Math.floor(Date.now() / 1000);
        const currentCandleStart = this._alignTimeToInterval(nowSec);
        
        if (lastCandle.time !== currentCandleStart) {
            // Создаем новую свечу
            const newCandle = {
                time: currentCandleStart,
                open: price,
                high: price,
                low: price,
                close: price,
                volume: 0,
                quoteVolume: 0
            };
            
            this._stampCandle(newCandle, 'ws', Date.now());
            this.chartData.push(newCandle);
            this._addToTimeMap(newCandle.time, this.chartData.length - 1);
            this.lastCandle = newCandle;
            
            series.update({
                time: newCandle.time,
                open: newCandle.open,
                high: newCandle.high,
                low: newCandle.low,
                close: newCandle.close
            });
        } else {
            // Обновляем текущую свечу
            lastCandle.close = price;
            lastCandle.high = Math.max(lastCandle.high, price);
            lastCandle.low = Math.min(lastCandle.low, price);
            this._stampCandle(lastCandle, 'ws', Date.now());
            
            series.update({
                time: lastCandle.time,
                open: lastCandle.open,
                high: lastCandle.high,
                low: lastCandle.low,
                close: price
            });
        }
        
        this.currentRealPrice = price;
        const lineColor = this._getLineColor();
        this._applyPriceLineColor(series, lineColor);
        this._updatePageTitle();
        
        if (this.timerManager) this.timerManager.updatePrice(price);
    }

    updateLastCandle(candle, eventTime = null, meta = null) {
        if (this._switchingSymbol || this._isSwitchingInterval || this._updatesSuspended || !this._isChartValid()) return;
        
        if (meta && (
            (meta.symbol && meta.symbol !== this.currentSymbol) ||
            (meta.interval && meta.interval !== this.currentInterval)
        )) return;
        
        if (!candle || typeof candle.time !== 'number' || isNaN(candle.time) || candle.time <= 0) return;
        
        const receivedAt = eventTime || Date.now();
        
        try {
            if (!candle.quoteVolume && candle.volume) candle.quoteVolume = candle.volume;
            if (!this.chartData || this.chartData.length === 0) return;
            
            const currentLastCandle = this.chartData[this.chartData.length - 1];
            const isLastCandle = currentLastCandle && candle.time === currentLastCandle.time;
            const isNewCandle = !currentLastCandle || candle.time > currentLastCandle.time;
            const existingIndex = this._candleTimeMap.get(candle.time);
            
            const updateData = {
                time: candle.time,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close
            };
            
            if (isLastCandle) {
                if (!this._isFresherUpdate(currentLastCandle, receivedAt, 'ws')) return;
                
                currentLastCandle.open = candle.open;
                currentLastCandle.close = candle.close;
                currentLastCandle.high = candle.high;
                currentLastCandle.low = candle.low;
                currentLastCandle.volume = candle.volume;
                currentLastCandle.quoteVolume = candle.quoteVolume;
                
                this._stampCandle(currentLastCandle, 'ws', receivedAt);
                this.lastCandle = currentLastCandle;
                
                if (this.candleSeries) this.candleSeries.update(updateData);
                if (this.barSeries) this.barSeries.update(updateData);
                
                // Обновляем volume через встроенный метод
                if (this.volumeSeries && candle.quoteVolume > 0) {
                    const isBullish = candle.close >= candle.open;
                    this.volumeSeries.update({
                        time: candle.time,
                        value: candle.quoteVolume,
                        color: isBullish ? this.bullishColor : this.bearishColor
                    });
                }
            } else if (existingIndex !== undefined && existingIndex >= 0) {
                const existingCandle = this.chartData[existingIndex];
                if (!this._isFresherUpdate(existingCandle, receivedAt, 'ws')) return;
                
                existingCandle.open = candle.open;
                existingCandle.close = candle.close;
                existingCandle.high = candle.high;
                existingCandle.low = candle.low;
                existingCandle.volume = candle.volume;
                existingCandle.quoteVolume = candle.quoteVolume;
                
                this._stampCandle(existingCandle, 'ws', receivedAt);
                
                // Полное обновление данных
                if (this.candleSeries) this.candleSeries.setData(this.chartData);
                if (this.barSeries) this.barSeries.setData(this.chartData);
                
                // Обновляем volume через встроенный метод
                if (this.volumeSeries) {
                    this._updateVolumeData();
                }
                
                return;
            } else if (isNewCandle) {
                this._stampCandle(candle, 'ws', receivedAt);
                this.chartData.push(candle);
                this._addToTimeMap(candle.time, this.chartData.length - 1);
                this.lastCandle = candle;
                
                if (this.candleSeries) this.candleSeries.update(updateData);
                if (this.barSeries) this.barSeries.update(updateData);
                
                // Обновляем volume через встроенный метод
                if (this.volumeSeries && candle.quoteVolume > 0) {
                    const isBullish = candle.close >= candle.open;
                    this.volumeSeries.update({
                        time: candle.time,
                        value: candle.quoteVolume,
                        color: isBullish ? this.bullishColor : this.bearishColor
                    });
                }
            } else {
                return;
            }
            
            const lineColor = this._getLineColor();
            const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            if (activeSeries) this._applyPriceLineColor(activeSeries, lineColor);
            
            this._updatePageTitle();
            if (this.timerManager) this.timerManager.updatePrice(this.lastCandle.close);
            
        } catch (e) {
            console.error('Ошибка в updateLastCandle:', e);
        }
    }

    _updateVolumeData() {
        if (!this.volumeSeries || !this.chartData.length) return;
        
        const volumeData = this.chartData.map(c => ({
            time: c.time,
            value: c.quoteVolume || c.volume || 0,
            color: c.close >= c.open ? this.bullishColor : this.bearishColor
        }));
        
        this.volumeSeries.setData(volumeData);
    }

    // ============ УСТАНОВКА ДАННЫХ ============
    setDataQuick(data, interval, symbol, exchange = 'binance', marketType = 'futures', forceNewSymbol = false, onReady = null) {
        try {
            if (!this._isChartValid()) {
                if (onReady) onReady();
                return;
            }
            
            if (!data || data.length === 0) {
                if (onReady) onReady();
                return;
            }
            
            if (this.timerManager) this.timerManager.hideImmediately();
            
            // Очистка данных
            this.chartData = [];
            this.lastCandle = null;
            this._candleTimeMap.clear();
            
            // Фильтрация дубликатов
            const seenTimes = new Set();
            data = data.filter(c => {
                if (!c || typeof c.time !== 'number' || isNaN(c.time)) return false;
                if (seenTimes.has(c.time)) return false;
                seenTimes.add(c.time);
                return true;
            });
            
            data.sort((a, b) => a.time - b.time);
            
            this.chartData = data;
            this._candleTimeMap.clear();
            for (let i = 0; i < data.length; i++) {
                this._candleTimeMap.set(data[i].time, i);
            }
            
            this.currentInterval = interval;
            this.currentSymbol = symbol;
            this.currentExchange = exchange;
            this.currentMarketType = marketType;
            this.hasMoreData = true;
            this.lastCandle = data[data.length - 1];
            
            // Установка данных через встроенные методы
            if (this.candleSeries) this.candleSeries.setData(this.chartData);
            if (this.barSeries) this.barSeries.setData(this.chartData);
            
            // Установка volume данных через встроенный метод
            if (this.volumeSeries) {
                this._updateVolumeData();
            }
            
            // Настройка price line
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            if (series) {
                const lineColor = this._getLineColor();
                this._applyPriceLineColor(series, lineColor);
            }
            
            // Применение precision
            const cachedPrecision = localStorage.getItem(`precision_${symbol}_${exchange}_${marketType}`);
            if (cachedPrecision) {
                this.applyPriceFormat(parseInt(cachedPrecision));
            } else {
                const inferredPrecision = this._inferPrecisionFromData();
                this.applyPriceFormat(inferredPrecision);
                localStorage.setItem(`precision_${symbol}_${exchange}_${marketType}`, inferredPrecision);
            }
            
            // Обновление индикаторов
            setTimeout(() => {
                if (this.indicatorManager && this._isChartValid()) {
                    this.indicatorManager.updateAllIndicators();
                    this.indicatorManager.loadIndicators();
                }
            }, 0);
            
            // Позиционирование на последнюю свечу
            const timeScale = this.chart.timeScale();
            const savedBarSpacing = parseFloat(localStorage.getItem('chartBarSpacing')) || 25;
            timeScale.applyOptions({ barSpacing: savedBarSpacing });
            
            requestAnimationFrame(() => {
                if (this._isChartValid()) {
                    timeScale.scrollToRealTime();
                    
                    if (this.timerManager && this.lastCandle) {
                        this.timerManager.start(this.currentInterval);
                        this.timerManager.updatePrice(this.lastCandle.close);
                    }
                    
                    if (onReady) onReady();
                }
            });
            
            this._updatePageTitle();
            
        } catch (error) {
            console.error('Ошибка в setDataQuick:', error);
            if (onReady) onReady();
        }
    }

    // ============ ЗАГРУЗКА ДАННЫХ ============
    async fetchKlines(symbol, exchange, marketType, interval, limit = 1000, endTime = null, requestType = 'user') {
        let controller;
        if (requestType === 'history') {
            if (this._historyFetchController) this._historyFetchController.abort();
            this._historyFetchController = new AbortController();
            controller = this._historyFetchController;
        } else if (requestType === 'background') {
            if (this._backgroundFetchController) this._backgroundFetchController.abort();
            this._backgroundFetchController = new AbortController();
            controller = this._backgroundFetchController;
        } else {
            if (this._currentFetchController) this._currentFetchController.abort();
            this._currentFetchController = new AbortController();
            controller = this._currentFetchController;
        }
        
        const signal = controller.signal;
        const timeoutId = setTimeout(() => controller.abort(), this._fetchTimeoutMs);
        
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
            if (endTime) url += `&endTime=${endTime}`;
        } else {
            const bybitInt = bybitIntervalMap[interval] || interval;
            const cat = marketType === 'futures' ? 'linear' : 'spot';
            url = `https://api.bybit.com/v5/market/kline?category=${cat}&symbol=${symbol}&interval=${bybitInt}&limit=${limit}`;
            if (endTime) url += `&end=${endTime}`;
        }
        
        try {
            const response = await fetch(url, { signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            
            let rawCandles;
            if (exchange === 'binance') {
                if (!Array.isArray(data)) throw new Error('Binance: ожидался массив');
                rawCandles = data.map(item => ({
                    time: Math.floor(item[0] / 1000),
                    open: parseFloat(item[1]),
                    high: parseFloat(item[2]),
                    low: parseFloat(item[3]),
                    close: parseFloat(item[4]),
                    volume: parseFloat(item[5]),
                    quoteVolume: parseFloat(item[7]) || parseFloat(item[5])
                }));
            } else {
                if (data.retCode !== 0) throw new Error(`Bybit error: ${data.retCode}`);
                if (!data.result || !data.result.list) throw new Error('Bybit: неожиданный формат ответа');
                rawCandles = data.result.list.map(item => ({
                    time: Math.floor(parseInt(item[0]) / 1000),
                    open: parseFloat(item[1]),
                    high: parseFloat(item[2]),
                    low: parseFloat(item[3]),
                    close: parseFloat(item[4]),
                    volume: parseFloat(item[5] || 0),
                    quoteVolume: parseFloat(item[6] || 0)
                })).filter(c => c.time > 0 && !isNaN(c.open)).reverse();
            }
            
            if (signal.aborted) return null;
            
            const seenTimes = new Set();
            const validCandles = rawCandles
                .filter(c => {
                    if (seenTimes.has(c.time)) return false;
                    seenTimes.add(c.time);
                    return true;
                })
                .filter(c => this._isValidCandle(c))
                .sort((a, b) => a.time - b.time);
            
            return validCandles;
            
        } catch (error) {
            if (error?.name !== 'AbortError') {
                console.warn(`Ошибка загрузки klines:`, error);
            }
            return null;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    _isValidCandle(candle) {
        if (!candle || typeof candle !== 'object') return false;
        if (typeof candle.time !== 'number' || isNaN(candle.time) || candle.time <= 0) return false;
        
        const ohlcFields = ['open', 'high', 'low', 'close'];
        for (const field of ohlcFields) {
            const val = candle[field];
            if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) return false;
        }
        
        if (candle.high < candle.low) return false;
        if (candle.open > candle.high || candle.open < candle.low) return false;
        if (candle.close > candle.high || candle.close < candle.low) return false;
        
        return true;
    }

    // ============ ПЕРЕКЛЮЧЕНИЕ ============
    async switchSymbol(symbol, exchange, marketType) {
        if (this._switchingSymbol || this._isSwitchingInterval) {
            this._pendingSymbolSwitch = { symbol, exchange, marketType };
            return;
        }
        
        this._switchingSymbol = true;
        
        try {
            this._suspendAllUpdates();
            
            let candles = await this.loadCandlesFromCache(symbol, exchange, marketType, this.currentInterval);
            let isFromCache = !!candles;
            
            if (!isFromCache) {
                candles = await this.fetchKlines(symbol, exchange, marketType, this.currentInterval, 1000);
            }
            
            if (!candles || candles.length === 0) throw new Error('Нет данных');
            
            this.currentRealPrice = null;
            this.lastCandle = null;
            
            if (this.timerManager) this.timerManager.stop();
            
            this.chartData = [];
            this._candleTimeMap.clear();
            this._lastKlineEventTime = 0;
            
            this.currentSymbol = symbol;
            this.currentExchange = exchange;
            this.currentMarketType = marketType;
            
            this._subscribeToPrice();
            
            if (window.wsManager?.updateSymbolAndTimeframe) {
                window.wsManager.updateSymbolAndTimeframe(symbol, this.currentInterval, exchange, marketType);
            }
            
            this.setDataQuick(candles, this.currentInterval, symbol, exchange, marketType, true);
            
            if (!isFromCache) {
                this.saveCandlesToCache(symbol, exchange, marketType, this.currentInterval, candles);
            }
            
            localStorage.setItem('lastSymbol', symbol);
            localStorage.setItem('lastExchange', exchange);
            localStorage.setItem('lastMarketType', marketType);
            
        } catch (error) {
            console.error(`Не удалось переключиться на ${symbol}:`, error);
        } finally {
            this._switchingSymbol = false;
            this._resumeAllUpdates();
            
            if (this._pendingSymbolSwitch) {
                const next = this._pendingSymbolSwitch;
                this._pendingSymbolSwitch = null;
                this.switchSymbol(next.symbol, next.exchange, next.marketType);
            }
        }
    }

    async switchInterval(newInterval) {
        if (this._isSwitchingInterval || this._switchingSymbol) return;
        if (this.currentInterval === newInterval) return;
        
        this._isSwitchingInterval = true;
        
        try {
            this._suspendAllUpdates();
            
            this.currentInterval = newInterval;
            localStorage.setItem('lastTimeframe', newInterval);
            
            if (window.wsManager?.updateSymbolAndTimeframe) {
                window.wsManager.updateSymbolAndTimeframe(
                    this.currentSymbol,
                    this.currentInterval,
                    this.currentExchange,
                    this.currentMarketType
                );
            }
            
            let candles = await this.loadCandlesFromCache(
                this.currentSymbol, this.currentExchange, this.currentMarketType, this.currentInterval
            );
            let isFromCache = !!candles;
            
            if (!isFromCache) {
                candles = await this.fetchKlines(
                    this.currentSymbol, this.currentExchange, this.currentMarketType, this.currentInterval, 1000
                );
            }
            
            if (!candles || candles.length === 0) throw new Error('Нет данных');
            
            this.setDataQuick(
                candles,
                this.currentInterval,
                this.currentSymbol,
                this.currentExchange,
                this.currentMarketType,
                true
            );
            
            if (!isFromCache) {
                this.saveCandlesToCache(
                    this.currentSymbol, this.currentExchange, this.currentMarketType, this.currentInterval, candles
                );
            }
            
        } catch (error) {
            console.error('Ошибка переключения таймфрейма:', error);
        } finally {
            this._isSwitchingInterval = false;
            this._resumeAllUpdates();
        }
    }

    _suspendAllUpdates() {
        this._updatesSuspended = true;
        if (this.timerManager) this.timerManager.stop?.();
    }

    _resumeAllUpdates() {
        this._updatesSuspended = false;
    }

    // ============ ЦЕНОВОЙ ФОРМАТ ============
    _inferPrecisionFromData() {
        if (!this.chartData || this.chartData.length === 0) return 2;
        const lastPrice = this.chartData[this.chartData.length - 1].close;
        if (!lastPrice || lastPrice === 0) return 2;
        
        const fixed = lastPrice < 1 ? lastPrice.toFixed(10) : lastPrice.toString();
        if (fixed.includes('.')) {
            const decimals = fixed.split('.')[1].replace(/0+$/, '').length || 2;
            return Math.min(Math.max(decimals, 2), 8);
        }
        return 2;
    }

    applyPriceFormat(precision) {
        try {
            if (precision === null || precision === undefined || isNaN(precision) || precision < 0) {
                precision = this._inferPrecisionFromData();
            }
            
            const minMove = Math.pow(10, -precision);
            const priceFormat = { type: 'price', precision: precision, minMove: minMove };
            
            if (this.candleSeries) this.candleSeries.applyOptions({ priceFormat });
            if (this.barSeries) this.barSeries.applyOptions({ priceFormat });
            
            if (this.chart) {
                const priceScale = this.chart.priceScale('right');
                if (priceScale) priceScale.applyOptions({ priceFormat });
            }
            
            return precision;
        } catch (error) {
            return this._inferPrecisionFromData();
        }
    }

    // ============ ПРОКРУТКА ============
    scrollToLast(enableRealTime = true) {
        if (!this._isChartValid() || !this.chartData || this.chartData.length === 0) return false;
        
        try {
            this._isViewingHistory = false;
            this.lastCandle = this.chartData[this.chartData.length - 1];
            const timeScale = this.chart.timeScale();
            
            if (enableRealTime) {
                timeScale.scrollToRealTime();
            }
            
            return true;
        } catch (e) {
            return false;
        }
    }

    // ============ ПОДПИСКА НА ЦЕНЫ ============
    _subscribeToPrice() {
        if (!this.priceManager) {
            setTimeout(() => this._subscribeToPrice(), 100);
            return;
        }
        
        if (this._priceSubscriptionKey && this._priceUpdateHandler) {
            this.priceManager.unsubscribe(this._priceSubscriptionKey, this._priceUpdateHandler);
            this._priceUpdateHandler = null;
            this._priceSubscriptionKey = null;
        }
        
        const key = `${this.currentSymbol}:${this.currentExchange}:${this.currentMarketType}`;
        this._priceSubscriptionKey = key;
        
        this._priceUpdateHandler = (price, symbol, exchange, marketType) => {
            if (this._switchingSymbol || this._isSwitchingInterval || this._updatesSuspended) return;
            if (symbol !== this.currentSymbol || exchange !== this.currentExchange || marketType !== this.currentMarketType) return;
            
            if (price && typeof price === 'object') {
                if (typeof price.price === 'number') price = price.price;
                else if (typeof price.close === 'number') price = price.close;
                else if (typeof price.last === 'number') price = price.last;
                else return;
            }
            
            if (typeof price !== 'number' || isNaN(price)) return;
            
            this.currentRealPrice = price;
            this._updatePageTitle();
            
            if (!document.hidden && this._isChartValid()) {
                this._syncPriceLine(price);
                if (this.timerManager) this.timerManager.updatePrice(price);
            }
        };
        
        this.priceManager.subscribe(key, this._priceUpdateHandler, this.currentExchange, this.currentMarketType);
    }

    // ============ ЗАГОЛОВОК СТРАНИЦЫ ============
    _updatePageTitle() {
        const symbol = this.currentSymbol || '';
        let price = this.currentRealPrice;
        
        if (!price || isNaN(price) || price <= 0) {
            price = this.lastCandle?.close;
        }
        if (!price || isNaN(price) || price <= 0) {
            price = this.chartData?.[this.chartData.length - 1]?.close;
        }
        
        if (!symbol) {
            document.title = 'График';
            return;
        }
        
        if (price != null && !isNaN(price) && price > 0) {
            const series = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
            const precision = series?.options()?.priceFormat?.precision ?? 2;
            const lastCandle = this.chartData?.[this.chartData.length - 1];
            const isBullish = lastCandle ? lastCandle.close >= lastCandle.open : true;
            const arrow = isBullish ? '▲' : '▼';
            const newTitle = `${arrow} ${symbol} ${price.toFixed(precision)}`;
            
            if (this._lastTitle !== newTitle) {
                this._lastTitle = newTitle;
                document.title = newTitle;
            }
        } else {
            const fallbackTitle = `${symbol} —`;
            if (this._lastTitle !== fallbackTitle) {
                this._lastTitle = fallbackTitle;
                document.title = fallbackTitle;
            }
        }
    }

    // ============ ПЕРИОДИЧЕСКИЕ ОБНОВЛЕНИЯ ============
    _startPeriodicSync() {
        if (this._periodicSyncInterval) clearInterval(this._periodicSyncInterval);
        
        this._periodicSyncInterval = setInterval(() => {
            if (!document.hidden && !this._switchingSymbol && !this._updatesSuspended && 
                !this._isSwitchingInterval && this._isChartValid() && 
                !this._isScrolling && !this._isScrollingFast) {
                this._syncRecentCandles();
            }
        }, 30000);
    }

    async _syncRecentCandles() {
        if (this._isScrolling || this._isScrollingFast) return;
        
        try {
            const fresh = await this.fetchKlines(
                this.currentSymbol, this.currentExchange, this.currentMarketType, 
                this.currentInterval, 3, null, 'background'
            );
            
            if (!fresh || fresh.length === 0) return;
            if (this._updatesSuspended || this._switchingSymbol || this._isSwitchingInterval) return;
            
            const currentData = this.chartData;
            if (!currentData || currentData.length === 0) return;
            
            const freshMap = new Map(fresh.map(c => [c.time, c]));
            let changed = false;
            
            for (let i = currentData.length - 1; i >= Math.max(0, currentData.length - 3); i--) {
                const cur = currentData[i];
                const freshCandle = freshMap.get(cur.time);
                
                if (freshCandle) {
                    if (!this._isFresherUpdate(cur, freshCandle._receivedAt, freshCandle._source)) {
                        freshMap.delete(cur.time);
                        continue;
                    }
                    
                    cur.open = freshCandle.open;
                    cur.close = freshCandle.close;
                    cur.high = freshCandle.high;
                    cur.low = freshCandle.low;
                    cur.volume = freshCandle.volume;
                    cur.quoteVolume = freshCandle.quoteVolume || cur.volume;
                    
                    this._stampCandle(cur, freshCandle._source, freshCandle._receivedAt);
                    
                    if (i === currentData.length - 1) {
                        const updateData = {
                            time: cur.time,
                            open: cur.open,
                            high: cur.high,
                            low: cur.low,
                            close: cur.close
                        };
                        
                        if (this.candleSeries) this.candleSeries.update(updateData);
                        if (this.barSeries) this.barSeries.update(updateData);
                        
                        if (this.volumeSeries && (cur.quoteVolume > 0 || cur.volume > 0)) {
                            const isBullish = cur.close >= cur.open;
                            this.volumeSeries.update({
                                time: cur.time,
                                value: cur.quoteVolume || cur.volume || 0,
                                color: isBullish ? this.bullishColor : this.bearishColor
                            });
                        }
                    }
                    
                    changed = true;
                    freshMap.delete(cur.time);
                }
            }
            
            if (changed) {
                this._syncLineColor();
                if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
                if (this.timerManager) this.timerManager.updatePrice(this.lastCandle.close);
            }
            
        } catch (e) {
            console.warn('Ошибка периодической синхронизации:', e);
        }
    }

    async refreshCandlesAfterTabHidden() {
        if (!this._isChartValid() || this._switchingSymbol || this._isSwitchingInterval) return;
        if (this._refreshingAfterHidden) return;
        
        this._refreshingAfterHidden = true;
        
        try {
            const freshCandles = await this.fetchKlines(
                this.currentSymbol, this.currentExchange, this.currentMarketType,
                this.currentInterval, 500, null, 'background'
            );
            
            if (!freshCandles || freshCandles.length === 0) return;
            if (!this._isChartValid()) return;
            
            this.setDataQuick(
                freshCandles, this.currentInterval, this.currentSymbol,
                this.currentExchange, this.currentMarketType, true
            );
            
        } catch (error) {
            console.error('Ошибка синхронизации после возврата:', error);
        } finally {
            this._refreshingAfterHidden = false;
        }
    }

    // ============ КЭШИРОВАНИЕ ============
    async saveCandlesToCache(symbol, exchange, marketType, interval, candles) {
        if (!candles || candles.length === 0) return;
        
        const CACHE_VERSION = '2';
        const key = `${symbol}_${interval}_${exchange}_${marketType}_v${CACHE_VERSION}`;
        
        const cacheData = {
            key,
            symbol,
            exchange,
            marketType,
            interval,
            data: candles,
            lastUpdate: Date.now(),
            firstCandleTime: candles[0].time,
            lastCandleTime: candles[candles.length - 1].time,
            count: candles.length,
            version: CACHE_VERSION
        };
        
        if (!window.db) return;
        
        try {
            await window.db.put('candles', cacheData);
        } catch (error) {
            console.warn('Ошибка сохранения кэша:', error);
        }
    }

    async loadCandlesFromCache(symbol, exchange, marketType, interval) {
        const CACHE_VERSION = '2';
        const key = `${symbol}_${interval}_${exchange}_${marketType}_v${CACHE_VERSION}`;
        
        if (!window.db) return null;
        
        try {
            const cached = await window.db.get('candles', key);
            if (!cached) return null;
            
            if (cached.version !== CACHE_VERSION) {
                await window.db.delete('candles', key);
                return null;
            }
            
            const CACHE_DURATION = 5 * 60 * 1000;
            if (Date.now() - cached.lastUpdate > CACHE_DURATION) return null;
            
            return cached.data;
        } catch (error) {
            return null;
        }
    }

    // ============ РАЗМЕР ============
    _updateMainChartHeight() {
        if (!this._isChartValid()) return;
        
        const chartContainer = this.chartContainer;
        const panelsContainer = document.getElementById('indicator-panels-container');
        if (!chartContainer) return;
        
        const availableHeight = window.innerHeight - 48;
        const panelsHeight = panelsContainer ? panelsContainer.offsetHeight : 0;
        let newChartHeight = availableHeight - panelsHeight;
        
        if (newChartHeight < 200) newChartHeight = 200;
        
        chartContainer.style.height = newChartHeight + 'px';
        chartContainer.style.maxHeight = newChartHeight + 'px';
        
        const width = chartContainer.clientWidth;
        this.chart.resize(width, newChartHeight);
        
        if (this.indicatorManager?.panelManager) {
            const panels = this.indicatorManager.panelManager.panels;
            if (panels && Array.isArray(panels)) {
                panels.forEach(panel => {
                    if (panel.chart && !panel.isCollapsed && panel.container) {
                        try {
                            const panelHeight = panel.container.clientHeight;
                            const panelWidth = panel.container.clientWidth;
                            if (panelHeight > 0 && panelWidth > 0) {
                                panel.chart.resize(panelWidth, panelHeight);
                            }
                        } catch (e) {}
                    }
                });
            }
        }
    }

    // ============ УПРАВЛЕНИЕ ИНДИКАТОРАМИ ============
    addIndicator(type) {
        const result = this.indicatorManager.addIndicator(type);
        setTimeout(() => this._updateMainChartHeight(), 50);
        return result;
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

    // ============ ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ============
    getChart() { return this.chart; }
    getLastCandle() { return this.lastCandle; }
    setCurrentInterval(interval) { this.currentInterval = interval; }

    getCurrentPrice() {
        if (this.priceManager) {
            let price = null;
            try {
                price = this.priceManager.getPrice(
                    this.currentSymbol, this.currentExchange, this.currentMarketType
                );
            } catch (e) {
                price = null;
            }
            
            if (price !== null && price !== undefined && !isNaN(price)) return price;
        }
        
        if (this.currentRealPrice !== null && this.currentRealPrice !== undefined && !isNaN(this.currentRealPrice)) {
            return this.currentRealPrice;
        }
        
        return null;
    }

    getCurrentSymbolKey() {
        return `${this.currentSymbol}:${this.currentExchange}:${this.currentMarketType}`;
    }

    forceRedraw() {
        if (!this._isChartValid() || !this.chartData.length) return;
        
        const width = this.chartContainer.clientWidth;
        const height = this.chartContainer.clientHeight;
        
        this.chart.resize(width + 1, height);
        this.chart.resize(width, height);
        
        if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
    }

    autoScale(onComplete) {
        if (!this._isChartValid() || !this.chartData || this.chartData.length === 0) {
            if (onComplete) onComplete();
            return;
        }
        
        try {
            const priceScale = this.chart.priceScale('right');
            if (priceScale) {
                priceScale.applyOptions({ autoScale: true });
                
                setTimeout(() => {
                    try { priceScale.applyOptions({ autoScale: false }); } catch (e) {}
                    if (onComplete) onComplete();
                }, 100);
            }
        } catch (e) {
            if (onComplete) onComplete();
        }
    }

    updateColorsForSettings(bullishColor, bearishColor) {
        if (!this._isChartValid()) return;
        
        this.bullishColor = bullishColor;
        this.bearishColor = bearishColor;
        
        this.candleSeries.applyOptions({
            upColor: bullishColor,
            downColor: bearishColor,
            wickUpColor: bullishColor,
            wickDownColor: bearishColor
        });
        
        this.barSeries.applyOptions({
            upColor: bullishColor,
            downColor: bearishColor
        });
        
        // Обновляем volume с новыми цветами
        if (this.volumeSeries && this.chartData.length > 0) {
            this._updateVolumeData();
        }
        
        this._syncLineColor();
    }

    clearChart() {
        if (!this._isChartValid()) return;
        
        if (this.candleSeries) this.candleSeries.setData([]);
        if (this.barSeries) this.barSeries.setData([]);
        if (this.volumeSeries) this.volumeSeries.setData([]);
        
        this.chartData = [];
        this.lastCandle = null;
        this._candleTimeMap.clear();
    }

    destroy() {
        if (this._bgTitleInterval) {
            clearInterval(this._bgTitleInterval);
            this._bgTitleInterval = null;
        }
        
        if (this._periodicSyncInterval) {
            clearInterval(this._periodicSyncInterval);
            this._periodicSyncInterval = null;
        }
        
        if (this._mouseLeaveHandler && this.chartContainer) {
            this.chartContainer.removeEventListener('mouseleave', this._mouseLeaveHandler);
        }
        
        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
        }
        
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
        }
        
        if (this.timerManager && typeof this.timerManager.destroy === 'function') {
            this.timerManager.destroy();
        }
        
        if (this.chart) {
            this.chart.remove();
            this.chart = null;
        }
        
        this.chartData = [];
        this._candleTimeMap.clear();
        this._formatCache.clear();
    }

    _startNewCandleChecker() {
        const check = () => {
            if (document.hidden) {
                this._candleCheckerTimeout = setTimeout(check, 2000);
                return;
            }
            
            if (!this._isChartValid() || !this.chartData?.length || !this.currentInterval ||
                this._updatesSuspended || this._isSwitchingInterval) {
                this._candleCheckerTimeout = setTimeout(check, 1000);
                return;
            }
            
            const nowSec = Math.floor(Date.now() / 1000);
            const aligned = this._alignTimeToInterval(nowSec);
            const last = this.chartData[this.chartData.length - 1];
            
            if (last && aligned > last.time) {
                const timeSinceNewCandle = nowSec - aligned;
                
                if (timeSinceNewCandle > 8) {
                    const nowMs = Date.now();
                    if (!this._lastCatchUpAttempt || nowMs - this._lastCatchUpAttempt > 3000) {
                        this._lastCatchUpAttempt = nowMs;
                        this._catchUpMissedCandles();
                    }
                }
            }
            
            this._candleCheckerTimeout = setTimeout(check, 250);
        };
        
        check();
    }

    async _catchUpMissedCandles() {
        if (!this._isChartValid() || !this.currentSymbol || !this.currentInterval) return;
        if (this._catchingUpMissed || this._isSwitchingInterval) return;
        
        this._catchingUpMissed = true;
        
        try {
            const freshCandles = await this.fetchKlines(
                this.currentSymbol, this.currentExchange, this.currentMarketType,
                this.currentInterval, 10, null, 'background'
            );
            
            if (!freshCandles || freshCandles.length === 0 || !this._isChartValid()) return;
            
            const lastLocalTime = this.chartData.length > 0 ? this.chartData[this.chartData.length - 1].time : 0;
            const newCandles = freshCandles.filter(c => c.time > lastLocalTime);
            
            if (newCandles.length > 0) {
                for (const candle of newCandles) {
                    if (!this._isValidCandle(candle)) continue;
                    
                    const lastTime = this.chartData.length > 0 ? this.chartData[this.chartData.length - 1].time : 0;
                    if (candle.time <= lastTime) continue;
                    
                    this.chartData.push(candle);
                    this._addToTimeMap(candle.time, this.chartData.length - 1);
                }
                
                this._rebuildTimeMap();
                
                const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
                if (activeSeries) activeSeries.setData(this.chartData);
                
                // Обновляем volume
                if (this.volumeSeries) {
                    this._updateVolumeData();
                }
                
                this.lastCandle = this.chartData[this.chartData.length - 1];
                this._syncLineColor();
                
                if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
                this.scrollToLast();
            }
            
        } catch (error) {
            console.error('Ошибка догрузки свечей:', error);
        } finally {
            this._catchingUpMissed = false;
        }
    }

    onVisibleLogicalRangeChange(range) {
        if (!range || !this.chartData.length || !this._isChartValid()) return;
        
        const fromIndex = Math.max(0, Math.floor(range.from));
        
        if (fromIndex < 400 && this.hasMoreData && !this.isLoadingMore) {
            this._loadHistoryAsync();
        }
    }

    async _loadHistoryAsync() {
        if (this.isLoadingMore || !this.hasMoreData || !this._isChartValid()) return;
        
        const now = Date.now();
        if (now - this._lastHistoryLoadTime < 1500) return;
        
        this.isLoadingMore = true;
        this._lastHistoryLoadTime = now;
        
        try {
            const oldestCandle = this.chartData[0];
            if (!oldestCandle) {
                this.hasMoreData = false;
                this.isLoadingMore = false;
                return;
            }
            
            const endTime = (oldestCandle.time * 1000) - 1;
            const olderCandles = await this.fetchKlines(
                this.currentSymbol, this.currentExchange, this.currentMarketType,
                this.currentInterval, 500, endTime, 'history'
            );
            
            if (!olderCandles || olderCandles.length === 0 || !this._isChartValid()) {
                this.hasMoreData = false;
                this.isLoadingMore = false;
                return;
            }
            
            const oldestExistingTime = this.chartData[0].time;
            const uniqueOlder = olderCandles.filter(c => c.time < oldestExistingTime);
            
            if (uniqueOlder.length > 0) {
                const timeScale = this.chart.timeScale();
                const currentRange = timeScale.getVisibleLogicalRange();
                const addedCount = uniqueOlder.length;
                
                this.chartData = [...uniqueOlder, ...this.chartData];
                this._rebuildTimeMap();
                
                const activeSeries = this.currentChartType === 'candle' ? this.candleSeries : this.barSeries;
                if (activeSeries) activeSeries.setData(this.chartData);
                
                // Обновляем volume
                if (this.volumeSeries) {
                    this._updateVolumeData();
                }
                
                if (currentRange) {
                    timeScale.setVisibleLogicalRange({
                        from: currentRange.from + addedCount,
                        to: currentRange.to + addedCount
                    });
                }
                
                if (this.indicatorManager) this.indicatorManager.updateAllIndicators();
            }
            
            if (olderCandles.length < 500) {
                this.hasMoreData = false;
            }
            
        } catch (e) {
            this.hasMoreData = false;
        } finally {
            this.isLoadingMore = false;
        }
    }

    scheduleDrawingsUpdate(forceHighPriority = false) {
        if (document.hidden || !this._isChartValid()) return;
        
        if (this._drawingsRafId !== null) return;
        
        this._drawingsRafId = requestAnimationFrame(() => {
            this._drawingsRafId = null;
            
            if (window.rayManager?._applyRedrawIfNeeded) window.rayManager._applyRedrawIfNeeded();
            if (window.trendLineManager?._requestRedraw) window.trendLineManager._requestRedraw();
            if (window.rulerLineManager?._requestRedraw) window.rulerLineManager._requestRedraw();
            if (window.alertLineManager?._applyRedrawsIfNeeded) window.alertLineManager._applyRedrawsIfNeeded();
            if (window.textManager?._requestRedraw) window.textManager._requestRedraw();
        });
    }

    requestDrawingsRedraw() {
        this.scheduleDrawingsUpdate();
    }

    manualAutoScale() {
        this.autoScale();
    }
}

if (typeof window !== 'undefined') {
    window.ChartManager = ChartManager;
}
