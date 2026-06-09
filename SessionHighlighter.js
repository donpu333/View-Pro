class SessionHighlighter {
    constructor(chartManager) {
        this._cm = chartManager;
        this._primitive = null;
        this._requestUpdate = null;
        
        const saved = localStorage.getItem('sessionSettings');
        if (saved) {
            try {
                const s = JSON.parse(saved);
                this._enabled = s.enabled !== false;
                this._opacity = s.opacity || 0.15;
                this._colors = s.colors || {};
            } catch(e) {
                this._enabled = true;
                this._opacity = 0.15;
                this._colors = {};
            }
        } else {
            this._enabled = true;
            this._opacity = 0.15;
            this._colors = {};
        }

        this.sessions = [
            { name: 'asian',    startUTC: 0,  endUTC: 9,  color: this._colors.asian || '#FF9800' }, 
            { name: 'european', startUTC: 7,  endUTC: 16, color: this._colors.european || '#2196F3' }, 
            { name: 'american', startUTC: 13, endUTC: 24, color: this._colors.american || '#E040FB' }
        ];
        
        setTimeout(() => this._attach(), 1500);
    }

    _attach() {
        if (this._primitive) return; // уже прикреплён
        
        if (!this._cm || !this._cm.chart) {
            setTimeout(() => this._attach(), 500);
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
        console.log('✅ SessionHighlighter: ПРИКРЕПЛЕН');
    }

    _getSessionForHour(utcHour) {
        for (let i = this.sessions.length - 1; i >= 0; i--) {
            if (utcHour >= this.sessions[i].startUTC && utcHour < this.sessions[i].endUTC) {
                return this.sessions[i];
            }
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

        target.useBitmapCoordinateSpace(scope => {
            const ctx = scope.context;
            const hpr = scope.horizontalPixelRatio;
            const vpr = scope.verticalPixelRatio;
            const canvasHeight = scope.mediaSize.height * vpr;

            let candleWidthPixels = 0;

            for (let i = fromIdx; i <= toIdx; i++) {
                const candle = data[i];
                const utcHour = new Date(candle.time * 1000).getUTCHours();
                
                const session = this._getSessionForHour(utcHour);
                if (!session) continue;

                const xCenter = timeScale.timeToCoordinate(candle.time);
                if (xCenter === null) continue;

                if (candleWidthPixels === 0 && i + 1 <= toIdx) {
                    const nextX = timeScale.timeToCoordinate(data[i + 1].time);
                    if (nextX !== null) {
                        candleWidthPixels = Math.abs(nextX - xCenter) * 2;
                    }
                }
                
                if (candleWidthPixels === 0) candleWidthPixels = 10 * hpr;

                ctx.fillStyle = this._hexToRgba(session.color, this._opacity);
                ctx.fillRect(
                    (xCenter - candleWidthPixels / 2) * hpr, 
                    0, 
                    candleWidthPixels * hpr, 
                    canvasHeight
                );
            }
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
        localStorage.setItem('sessionSettings', JSON.stringify({ 
            enabled: this._enabled, 
            opacity: this._opacity, 
            colors: this._colors 
        }));
        this._reattach();
    }

    _reattach() {
        const series = this._cm.currentChartType === 'candle' ? this._cm.candleSeries : this._cm.barSeries;
        if (!series) return;
        
        if (this._primitive) {
            try { series.detachPrimitive(this._primitive); } catch(e) {}
            this._primitive = null;
        }
        
        this._attach();
    }

    redraw() {
        if (this._primitive && this._primitive.requestRedraw) {
            this._primitive.requestRedraw();
        }
    }
}

if (typeof window !== 'undefined') {
    window.SessionHighlighter = SessionHighlighter;
}