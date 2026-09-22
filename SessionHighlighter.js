class SessionHighlighter {
    constructor(chartManager) {
        this._cm = chartManager;
        this._primitive = null;
        this._requestUpdate = null;
        this._attachTimeout = null;
        
        const saved = localStorage.getItem('sessionSettings');
        if (saved) {
            try {
                const s = JSON.parse(saved);
                this._enabled = s.enabled !== false;
                this._opacity = s.opacity || 0.15;
                this._colors = s.colors || {};
            } catch(e) {
                this._enabled = true; this._opacity = 0.15; this._colors = {};
            }
        } else {
            this._enabled = true; this._opacity = 0.15; this._colors = {};
        }

        this.sessions = [
            { name: 'asian', startUTC: 0, endUTC: 9, color: this._colors.asian || '#FF9800' }, 
            { name: 'european', startUTC: 7, endUTC: 16, color: this._colors.european || '#2196F3' }, 
            { name: 'american', startUTC: 13, endUTC: 24, color: this._colors.american || '#E040FB' }
        ];
        this._attach();
    }

    _attach() {
        if (this._primitive) return;
        if (!this._cm || !this._cm.chart) {
            this._attachTimeout = setTimeout(() => this._attach(), 500);
            return;
        }
        const series = this._cm.currentChartType === 'candle' ? this._cm.candleSeries : this._cm.barSeries;
        if (!series) return;
        
        const self = this;
        this._primitive = {
            paneViews: () => [{ renderer: () => ({ draw: (target) => self._draw(target) }) }],
            attached: ({ requestUpdate }) => { self._requestUpdate = requestUpdate; },
            detached: () => { self._primitive = null; },
            updateAllViews: () => {},
            requestRedraw: () => { if (self._requestUpdate) self._requestUpdate(); }
        };
        series.attachPrimitive(this._primitive);
    }

    _getSessionForHour(utcHour) {
        for (let i = this.sessions.length - 1; i >= 0; i--) {
            if (utcHour >= this.sessions[i].startUTC && utcHour < this.sessions[i].endUTC) return this.sessions[i];
        }
        return null;
    }

    _hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    _draw(target) {
        if (!this._enabled) return;
        const tf = this._cm.currentInterval;
        if (['1d', '1w', '1M'].includes(tf)) return;
        const data = this._cm.chartData;
        if (!data || data.length < 2) return;
        const timeScale = this._cm.chart.timeScale();
        const visibleRange = timeScale.getVisibleLogicalRange();
        if (!visibleRange) return;

        const fromIdx = Math.max(0, Math.floor(visibleRange.from) - 1);
        const toIdx = Math.min(data.length - 1, Math.ceil(visibleRange.to) + 1);

        // PERF: кэш строк fillStyle (инвалидируется в updateSettings)
        if (!this._fillStyleCache) this._fillStyleCache = new Map();

        target.useBitmapCoordinateSpace(scope => {
            const ctx = scope.context;
            const hpr = scope.horizontalPixelRatio;
            const vpr = scope.verticalPixelRatio;
            const canvasHeight = scope.mediaSize.height * vpr;
            let candleWidthPixels = 0;

            // PERF: вместо fillRect на КАЖДУЮ свечу (сотни полупрозрачных
            // прямоугольников на каждый кадр) склеиваем идущие подряд свечи
            // одной сессии в один span и рисуем один fillRect на span.
            // Соседние свечи перекрывались ровно по краю (width = 2 * шаг),
            // поэтому визуальный результат идентичен (и без швов на стыках).
            let spanSession = null;
            let spanX1 = 0, spanX2 = 0;

            const flushSpan = () => {
                if (!spanSession) return;
                const cacheKey = spanSession.color + '|' + this._opacity;
                let fill = this._fillStyleCache.get(cacheKey);
                if (!fill) {
                    fill = this._hexToRgba(spanSession.color, this._opacity);
                    this._fillStyleCache.set(cacheKey, fill);
                }
                ctx.fillStyle = fill;
                ctx.fillRect((spanX1 - candleWidthPixels / 2) * hpr, 0,
                    (spanX2 - spanX1 + candleWidthPixels) * hpr, canvasHeight);
                spanSession = null;
            };

            for (let i = fromIdx; i <= toIdx; i++) {
                const candle = data[i];
                // PERF: час UTC арифметически, без new Date() на каждую свечу
                const utcHour = Math.floor(candle.time / 3600) % 24;
                const session = this._getSessionForHour(utcHour);

                const xCenter = timeScale.timeToCoordinate(candle.time);
                if (xCenter === null) { flushSpan(); continue; }

                if (candleWidthPixels === 0 && i + 1 <= toIdx) {
                    const nextX = timeScale.timeToCoordinate(data[i + 1].time);
                    if (nextX !== null) candleWidthPixels = Math.abs(nextX - xCenter) * 2;
                }
                if (candleWidthPixels === 0) candleWidthPixels = 10 * hpr;

                if (!session) { flushSpan(); continue; }

                if (spanSession === session) {
                    spanX2 = xCenter;
                } else {
                    flushSpan();
                    spanSession = session;
                    spanX1 = xCenter;
                    spanX2 = xCenter;
                }
            }
            flushSpan();
        });
    }

    updateSettings(settings) {
        if (settings.enabled !== undefined) this._enabled = settings.enabled;
        if (settings.opacity !== undefined) this._opacity = settings.opacity;
        if (settings.colors) {
            this._colors = { ...this._colors, ...settings.colors };
            if (settings.colors.asian) this.sessions[0].color = settings.colors.asian;
            if (settings.colors.european) this.sessions[1].color = settings.colors.european;
            if (settings.colors.american) this.sessions[2].color = settings.colors.american;
        }
        this._fillStyleCache = null;   // PERF: цвета/прозрачность могли измениться
        localStorage.setItem('sessionSettings', JSON.stringify({ enabled: this._enabled, opacity: this._opacity, colors: this._colors }));
        if (this._primitive && this._primitive.requestRedraw) this._primitive.requestRedraw();
    }

    reattach() {
        if (this._primitive && this._cm && this._cm.chart) {
            const series = this._cm.currentChartType === 'candle' ? this._cm.candleSeries : this._cm.barSeries;
            try { series.detachPrimitive(this._primitive); } catch(e) {}
        }
        this._primitive = null;
        this._attach();
    }

    destroy() {
        if (this._attachTimeout) { clearTimeout(this._attachTimeout); this._attachTimeout = null; }
        if (this._primitive && this._cm && this._cm.chart) {
            const series = this._cm.currentChartType === 'candle' ? this._cm.candleSeries : this._cm.barSeries;
            try { series.detachPrimitive(this._primitive); } catch(e) {}
        }
        this._primitive = null;
        this._requestUpdate = null;
    }

    redraw() {
        if (this._primitive && this._primitive.requestRedraw) this._primitive.requestRedraw();
    }
}
if (typeof window !== 'undefined') window.SessionHighlighter = SessionHighlighter;
