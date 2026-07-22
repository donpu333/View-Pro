class IndicatorPanelManager {
    constructor(container, chartManager) {
        this.container = container;
        this.chartManager = chartManager;
        this.panels = new Map();
        this.activeResizer = null;
        this.startY = 0;
        this.startHeight = 0;
        
        // 🔥 Кэш для предотвращения лишних вызовов resize
        this._resizeDebounceTimer = null;
        
        this._initEvents();
    }
    
    _initEvents() {
        document.addEventListener('mousemove', this._onMouseMove.bind(this));
        document.addEventListener('mouseup', this._onMouseUp.bind(this));
        
        // 🔥 ОПТИМИЗАЦИЯ: Debounce для ResizeObserver, чтобы не спамить chart.resize()
        this._resizeObserver = new ResizeObserver(entries => {
            if (this._resizeDebounceTimer) return;
            
            this._resizeDebounceTimer = requestAnimationFrame(() => {
                for (let entry of entries) {
                    if (entry.contentRect.width === 0) continue;
                    
                    this.panels.forEach(panel => {
                        if (panel.chart && !panel.isCollapsed) {
                            const width = panel.content.clientWidth;
                            const height = panel.height - 28;
                            if (width > 0 && height > 0) {
                                panel.chart.applyOptions({ width, height });
                            }
                        }
                    });
                }
                this._resizeDebounceTimer = null;
            });
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
        wrapper.style.position = 'relative'; // 🔥 ВАЖНО для абсолютного позиционирования кроссхейра
        
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
        
        const panel = { 
            wrapper, header, content, resizer, chart, 
            height: defaultHeight, minHeight, maxHeight, 
            isCollapsed: false, series: new Map(),
            crosshairLine: null // 🔥 Ссылка на линию кроссхейра
        };
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
            if (panel.crosshairLine) panel.crosshairLine.style.display = 'none';
        } else {
            panel.wrapper.classList.remove('collapsed');
            panel.wrapper.style.height = `${panel.height}px`;
            panel.header.querySelector('.collapse-btn').innerHTML = '▼';
        }
        
        setTimeout(() => {
            const width = panel.content.clientWidth;
            const height = panel.isCollapsed ? 0 : panel.height - 28;
            if (width > 0) panel.chart.applyOptions({ width, height });
        }, 10);
        
        this._updateContainerHeight();
    }
    
    closePanel(id) {
        const panel = this.panels.get(id);
        if (!panel) return;
        
        if (panel.crosshairLine) panel.crosshairLine.remove();
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
            
            const width = panel.content.clientWidth;
            if (width > 0) panel.chart.applyOptions({ width, height: newHeight - 28 });
            
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
        if (this.chartManager?._updateMainChartHeight) {
            // 🔥 Debounce обновления высоты главного графика
            clearTimeout(this._updateHeightTimer);
            this._updateHeightTimer = setTimeout(() => {
                this.chartManager._updateMainChartHeight();
            }, 50);
        }
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
                if (width > 0 && h > 0) panel.chart.applyOptions({ width, height: h });
            }
        });
    }

    // 🔥 НОВЫЙ МЕТОД: Вызывается ИЗ ChartManager для синхронизации скролла
    syncVisibleRange(range) {
        this.panels.forEach(panel => {
            if (panel.chart && !panel.isCollapsed) {
                try {
                    panel.chart.timeScale().setVisibleLogicalRange(range);
                } catch(e) {}
            }
        });
    }

    // 🔥 ОПТИМИЗИРОВАННАЯ ПРИВЯЗКА КРОССХЕЙРА (БЕЗ getBoundingClientRect!)
    _syncPanelWithMainChart(panelId) {
        const panel = this.panels.get(panelId);
        const cm = this.chartManager;
        if (!panel || !cm?.chart) return;
        
        const mainChart = cm.chart;
        
        // 1. Синхронизируем базовые настройки timeScale один раз
        const mainOptions = mainChart.options();
        panel.chart.applyOptions({
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
        
        // 2. Создаем линию кроссхейра ВНУТРИ wrapper панели (а не в body!)
        // Это позволяет использовать CSS top:0 и height:100% без JS-вычислений
        if (!panel.crosshairLine) {
            const line = document.createElement('div');
            line.style.cssText = `
                position: absolute; width: 1px; 
                height: 100%; top: 0; pointer-events: none; z-index: 9999;
                display: none; border-left: 1px dashed #758696;
            `;
            panel.wrapper.appendChild(line); // 🔥 Добавляем в wrapper, а не в document.body
            panel.crosshairLine = line;
        }
        
        // 3. Синхронизация кроссхейра через API графика (мгновенно и точно)
        mainChart.subscribeCrosshairMove((p) => {
            if (!p?.time || panel.isCollapsed) {
                panel.crosshairLine.style.display = 'none';
                return;
            }
            
            // 🔥 МАГИЯ: Преобразуем время главного графика в X-координату панели
            const panelX = panel.chart.timeScale().timeToCoordinate(p.time);
            
            if (panelX === null) {
                panel.crosshairLine.style.display = 'none';
            } else {
                panel.crosshairLine.style.display = 'block';
                panel.crosshairLine.style.left = `${panelX}px`; // Идеальное совпадение без getBoundingClientRect
            }
        });
    }
}

if (typeof window !== 'undefined') {
    window.IndicatorPanelManager = IndicatorPanelManager;
}
