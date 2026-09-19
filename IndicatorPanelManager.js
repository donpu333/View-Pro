class IndicatorPanelManager {
    constructor(container, chartManager) {
        this.container = container;
        this.chartManager = chartManager;
        this.panels = new Map();
        this.activeResizer = null;
        this.startY = 0;
        this.startHeight = 0;
        
        this._initEvents();
    }
    
    _initEvents() {
        document.addEventListener('mousemove', this._onMouseMove.bind(this));
        document.addEventListener('mouseup', this._onMouseUp.bind(this));
        
        this._resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                if (entry.contentRect.width === 0) return;
                
                this.panels.forEach(panel => {
                    if (panel.chart && !panel.isCollapsed) {
                        const width = panel.content.clientWidth;
                        const height = panel.height - 28;
                        if (width > 0 && height > 0) {
                            panel.chart.resize(width, height);
                        }
                    }
                });
            }
        });
        
        if (this.container) {
            this._resizeObserver.observe(this.container);
        }
    }
    
    createPanel(id, title, defaultHeight = 150, minHeight = 80, maxHeight = 400) {
        if (this.panels.has(id)) return this.panels.get(id);
        
        const wrapper = document.createElement('div');
        wrapper.className = 'indicator-panel-wrapper';
        wrapper.style.height = `${defaultHeight}px`;
        wrapper.dataset.panelId = id;
        
        const header = document.createElement('div');
        header.className = 'indicator-panel-header';
        header.innerHTML = `
            <div class="indicator-panel-title"><span>${title}</span></div>
            <div class="indicator-panel-actions">
                <button class="indicator-panel-btn collapse-btn" title="Свернуть">▼</button>
                <button class="indicator-panel-btn close-btn" title="Закрыть">✕</button>
            </div>
        `;
        
        const content = document.createElement('div');
        content.className = 'indicator-panel-content';
        
        const resizer = document.createElement('div');
        resizer.className = 'panel-resizer';
        resizer.dataset.panelId = id;
        
        wrapper.appendChild(resizer);
        wrapper.appendChild(header);
        wrapper.appendChild(content);
        this.container.appendChild(wrapper);
        
        const safeWidth = content.clientWidth || 400;
        const safeHeight = Math.max(50, defaultHeight - 28);
        
        const chart = LightweightCharts.createChart(content, {
            width: safeWidth,
            height: safeHeight,
            autoSize: false, 
            layout: { background: { color: '#000000' }, textColor: '#808080' },
            grid: { vertLines: { visible: false }, horzLines: { visible: false } },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            timeScale: { visible: false },
            rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.1 }, borderColor: '#333333' }
        });
        
        const panel = { wrapper, header, content, resizer, chart, height: defaultHeight, minHeight, maxHeight, isCollapsed: false, series: new Map(), _syncState: null };
        this.panels.set(id, panel);
        
        header.querySelector('.collapse-btn').addEventListener('click', (e) => { e.stopPropagation(); this.toggleCollapse(id); });
        header.querySelector('.close-btn').addEventListener('click', (e) => { e.stopPropagation(); this.closePanel(id); });
        resizer.addEventListener('mousedown', (e) => { this._startResize(id, e); });
         
        return panel;
    }
    
    toggleCollapse(id) {
        const panel = this.panels.get(id);
        if (!panel) return;
        
        panel.isCollapsed = !panel.isCollapsed;
        
        if (panel.isCollapsed) {
            panel.wrapper.classList.add('collapsed');
            panel.wrapper.style.height = '36px';
            panel.header.querySelector('.collapse-btn').innerHTML = '▶';
        } else {
            panel.wrapper.classList.remove('collapsed');
            panel.wrapper.style.height = `${panel.height}px`;
            panel.header.querySelector('.collapse-btn').innerHTML = '▼';
        }
        
        setTimeout(() => {
            const width = panel.content.clientWidth;
            const height = panel.isCollapsed ? 0 : panel.height - 28;
            if (width > 0) panel.chart.resize(width, height);
        }, 10);
        
        this._updateContainerHeight();
    }
    
    closePanel(id) {
        const panel = this.panels.get(id);
        if (!panel) return;
        
        // [FIX] Отписываемся от событий главного графика
        this._teardownPanelSync(panel);
        
        if (panel.wrapper && panel.wrapper.parentNode) panel.wrapper.remove();
        try { if (panel.chart) panel.chart.remove(); } catch(e) {}
        
        this.panels.delete(id);
        this._updateContainerHeight();
    }
    
    // [FIX] Общая очистка подписок панели
    _teardownPanelSync(panel) {
        if (!panel || !panel._syncState) return;
        
        for (const unsub of panel._syncState.unsubscribers) {
            try { unsub(); } catch(e) {}
        }
        panel._syncState.unsubscribers = [];
        
        const line = panel._syncState.crosshairLine;
        if (line && line.parentNode) line.parentNode.removeChild(line);
        
        panel._syncState = null;
    }
    
    _startResize(id, e) {
        e.preventDefault(); e.stopPropagation();
        const panel = this.panels.get(id);
        if (!panel || panel.isCollapsed) return;
        
        this.activeResizer = { id, startY: e.clientY, startHeight: panel.height };
        if (panel.resizer) panel.resizer.classList.add('active');
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    }
    
    _onMouseMove(e) {
        if (!this.activeResizer) return;
        const panel = this.panels.get(this.activeResizer.id);
        if (!panel) { this._onMouseUp(); return; }
        
        const delta = this.activeResizer.startY - e.clientY;
        let newHeight = Math.max(panel.minHeight, Math.min(panel.maxHeight, this.activeResizer.startHeight + delta));
        
        if (newHeight !== panel.height) {
            panel.height = newHeight;
            panel.wrapper.style.height = `${newHeight}px`;
            
            const width = panel.content.clientWidth;
            if (width > 0) panel.chart.resize(width, newHeight - 28);
            
            this._updateContainerHeight();
        }
    }
    
    _onMouseUp() {
        if (!this.activeResizer) return;
        const panel = this.panels.get(this.activeResizer.id);
        if (panel?.resizer) panel.resizer.classList.remove('active');
        
        this.activeResizer = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }
    
    _updateContainerHeight() {
        if (this.chartManager?._updateMainChartHeight) this.chartManager._updateMainChartHeight();
    }
    
    addSeries(panelId, seriesId, type, options) {
        const panel = this.panels.get(panelId);
        if (!panel || !panel.chart) return null;
        
        let series;
        if (type === 'line') series = panel.chart.addSeries(LightweightCharts.LineSeries, options);
        else if (type === 'histogram') series = panel.chart.addSeries(LightweightCharts.HistogramSeries, options);
        
        if (series) panel.series.set(seriesId, series);
        return series;
    }
    
    removeSeries(panelId, seriesIdOrObject) {
        const panel = this.panels.get(panelId);
        if (!panel || !panel.chart) return;
        
        let seriesToDelete = seriesIdOrObject;
        if (typeof seriesIdOrObject === 'string') seriesToDelete = panel.series.get(seriesIdOrObject);
        
        if (seriesToDelete) {
            try { panel.chart.removeSeries(seriesToDelete); } catch(e) {}
            for (const [key, val] of panel.series.entries()) {
                if (val === seriesToDelete) { panel.series.delete(key); break; }
            }
        }
    }
    
    resize(width) {
        this.panels.forEach(panel => {
            if (panel.chart && !panel.isCollapsed) {
                const h = panel.height - 28;
                if (width > 0 && h > 0) panel.chart.resize(width, h);
            }
        });
    }
    
    // [FIX] Защита от повторной подписки. Раньше: каждый повторный вызов
    // вешал ещё один обработчик timeScale и crosshair на главный график,
    // и панель дёргалась N раз за скролл. Сейчас: подписка вешается один
    // раз на панель, отписка — в closePanel / destroy.
    _syncPanelWithMainChart(panelChart) {
        const cm = this.chartManager;
        if (!cm?.chart) return;
        
        const mainChart = cm.chart;
        
        let panelData = null;
        this.panels.forEach((p) => {
            if (p.chart === panelChart) panelData = p;
        });
        
        if (!panelData?.wrapper) return;
        
        // [FIX] Уже подписаны — выходим, чтобы не плодить дубли
        if (panelData._syncState) return;
        
        panelData._syncState = { unsubscribers: [], crosshairLine: null };
        
        // 1. Копируем настройки timeScale из основного
        const mainOptions = mainChart.options();
        panelChart.applyOptions({
            timeScale: {
                ...mainOptions.timeScale,
                visible: false,
                rightOffset: mainOptions.timeScale?.rightOffset || 5,
                barSpacing: mainOptions.timeScale?.barSpacing || 12,
                minBarSpacing: mainOptions.timeScale?.minBarSpacing || 3,
                fixLeftEdge: true,
                fixRightEdge: false
            }
        });
        
        // 2. Синхронизация диапазона
        let syncTimer = null;
        const rangeHandler = () => {
            if (syncTimer) cancelAnimationFrame(syncTimer);
            syncTimer = requestAnimationFrame(() => {
                try {
                    const currentRange = mainChart.timeScale().getVisibleLogicalRange();
                    if (currentRange) {
                        panelChart.timeScale().setVisibleLogicalRange({
                            from: Math.floor(currentRange.from),
                            to: Math.ceil(currentRange.to)
                        });
                    }
                } catch(e) {}
            });
        };
        mainChart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);
        panelData._syncState.unsubscribers.push(() => {
            try { mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler); } catch(e) {}
            if (syncTimer) cancelAnimationFrame(syncTimer);
        });
        
        // 3. Crosshair линия
        const panelId = panelData.wrapper.dataset.panelId;
        let line = document.getElementById(`crosshair-line-${panelId}`);
        if (!line) {
            line = document.createElement('div');
            line.id = `crosshair-line-${panelId}`;
            line.style.cssText = `
                position:absolute; width:1px; background:transparent;
                height:100%; top:0; pointer-events:none; z-index:99999;
                display:none; border-left:1px dashed #758696;
            `;
            document.body.appendChild(line);
        }
        panelData._syncState.crosshairLine = line;
        
        const crosshairHandler = (p) => {
            if (!p?.time || !p?.point) { line.style.display = 'none'; return; }
            const rect = panelData.wrapper.getBoundingClientRect();
            line.style.display = 'block';
            line.style.left = p.point.x + 'px';
            line.style.top = rect.top + 'px';
            line.style.height = (rect.height - 28) + 'px';
        };
        mainChart.subscribeCrosshairMove(crosshairHandler);
        panelData._syncState.unsubscribers.push(() => {
            try { mainChart.unsubscribeCrosshairMove(crosshairHandler); } catch(e) {}
        });
    }
    
    // [FIX] Полная очистка — на случай destroy или перезагрузки приложения
    destroy() {
        for (const [id, panel] of this.panels.entries()) {
            this._teardownPanelSync(panel);
            try { if (panel.chart) panel.chart.remove(); } catch(e) {}
            if (panel.wrapper?.parentNode) panel.wrapper.parentNode.removeChild(panel.wrapper);
        }
        this.panels.clear();
        
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
    }
}

if (typeof window !== 'undefined') {
    window.IndicatorPanelManager = IndicatorPanelManager;
}
