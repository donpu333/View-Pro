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
        // Глобальные события для перетаскивания мышью
        document.addEventListener('mousemove', this._onMouseMove.bind(this));
        document.addEventListener('mouseup', this._onMouseUp.bind(this));
        
        // 🚀 НОВОЕ: Автоматическая подстройка размеров при изменении окна/контейнера
        this._resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                // Если контейнер вообще не виден (например, скрыт вкладка), пропускаем
                if (entry.contentRect.width === 0) return;
                
                this.panels.forEach(panel => {
                    if (panel.chart && !panel.isCollapsed) {
                        // Берем ширину конкретной обертки панели, а не всего контейнера!
                        const width = panel.content.clientWidth;
                        const height = panel.height - 28; // 28px - высота заголовка
                        if (width > 0 && height > 0) {
                            panel.chart.resize(width, height);
                        }
                    }
                });
            }
        });
        
        // Начинаем следить за контейнером индикаторов
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
        
        // Создаем график
        const chart = LightweightCharts.createChart(content, {
            // ИСПРАВЛЕНО: Берем ширину content, а не всего container!
            width: content.clientWidth,
            height: defaultHeight - 28,
              autoSize: false, 
            layout: { background: { color: '#000000' }, textColor: '#808080' },
            grid: { vertLines: { visible: false }, horzLines: { visible: false } },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            timeScale: { visible: false },
            rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.1 }, borderColor: '#333333' }
        });
        
        const panel = { wrapper, header, content, resizer, chart, height: defaultHeight, minHeight, maxHeight, isCollapsed: false, series: new Map() };
        this.panels.set(id, panel);
        
        // Обработчики кнопок
        header.querySelector('.collapse-btn').addEventListener('click', (e) => { e.stopPropagation(); this.toggleCollapse(id); });
        header.querySelector('.close-btn').addEventListener('click', (e) => { e.stopPropagation(); this.closePanel(id); });
        resizer.addEventListener('mousedown', (e) => { this._startResize(id, e); });
        
        setTimeout(() => { if (this.chartManager?._updateMainChartHeight) this.chartManager._updateMainChartHeight(); }, 50);
        
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
        
        // ИСПРАВЛЕНО: Используем chart.resize вместо applyOptions и УБРАЛИ пересчет данных!
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
        
        if (panel.wrapper && panel.wrapper.parentNode) panel.wrapper.remove();
        try { if (panel.chart) panel.chart.remove(); } catch(e) {}
        
        this.panels.delete(id);
        this._updateContainerHeight();
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
            
            // ИСПРАВЛЕНО: Используем chart.resize (без пересчета данных!)
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
            // Удаляем по значению объекта из Map
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

    // УДАЛЕНО: Метод syncTimeScaleWithMainChart убран отсюда. 
    // Синхронизация теперь происходит автоматически внутри createPanel.
}

if (typeof window !== 'undefined') {
    window.IndicatorPanelManager = IndicatorPanelManager;
}