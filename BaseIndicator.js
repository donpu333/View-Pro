class BaseIndicator {
    constructor(manager, type, name, color, panel = 'main') {
        this.manager = manager;
        this.type = type;
        this.id = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.data = {
            name: name,
            color: color,
            panel: panel
        };
        this.settings = {
            color: color,
            lineWidth: 1          // [VP-MA] толщина по умолчанию = 1
        };
        this.series = [];
        this.isCalculating = false;
        this.pendingData = false;
          this.visible = true; 
    }
    
    getSetting(key) {
        return this.settings[key];
    }
    
    updateSettings(newSettings) {
        Object.assign(this.settings, newSettings);
        this.calculateAsync();
        if (this.manager) {
            this.manager._renderUI();
            this.manager._saveIndicators();
        }
    }
    
    calculateAsync() {
        if (this.isCalculating) {
            this.pendingData = true;
            return;
        }
        
        this.isCalculating = true;
        
        const chartData = this.manager?.chartManager?.chartData;
        if (!chartData || chartData.length === 0) {
            this.isCalculating = false;
            return;
        }
        
        const worker = this.manager?.worker;
        if (!worker) {
            console.warn('Worker не инициализирован');
            this.isCalculating = false;
            return;
        }
        
        worker.postMessage({
            task: 'calculate',
            indicatorId: this.id,
            // [FIX-MA-JUMP] поколение данных — результат из устаревшего поколения
            // (ТФ/символ сменились во время расчёта) будет отброшен менеджером.
            generation: this.manager ? this.manager._dataGeneration : undefined,
            indicatorType: this.getWorkerType(),
            data: chartData,
            params: this.getWorkerParams()
        });
    }
    
    onCalculateResult(result) {
        this.isCalculating = false;
        
        if (this.pendingData) {
            this.pendingData = false;
            this.calculateAsync();
            return;
        }
        
        if (result && result.success && result.result) {
            this.updateSeriesData(result.result);
        }
    }
    
    updateSeriesData(data) {
        // Переопределяется в наследниках
    }
    
    getWorkerType() {
        return this.type;
    }
    
    getWorkerParams() {
        return {};
    }
    
   createSeries() {
    this._removeAllSeries();
    
    const chart = this.manager.chartManager.chart;
    if (!chart) return [];
    
    try {
        if (this.data.panel === 'main') {
            const series = chart.addSeries(LightweightCharts.LineSeries, {
                color: this.settings.color || this.data.color,
                lineWidth: this.settings.lineWidth || 1,
                lastValueVisible: false,
                priceLineVisible: false,
                // [FIX-DOT] ТОЧКА ПРИ НАВЕДЕНИИ НА СРЕДНИЕ СКОЛЬЗЯЩИЕ.
                // У LineSeries в lightweight-charts crosshairMarkerVisible по
                // умолчанию TRUE. IndicatorPanelManager.addSeries() гасит маркер
                // ([FIX-I6]), но этот метод создаёт серию НАПРЯМУЮ через
                // chart.addSeries(), минуя панель — поэтому фикс не применялся.
                // Именно отсюда точка на SMA/EMA и прочих линейных индикаторах
                // главной панели. _createEmptySeries() в наследниках маркер гасит,
                // но IndicatorManager.addIndicator() вызывает createSeries(),
                // а _createEmptySeries() в проекте не вызывается НИГДЕ.
                crosshairMarkerVisible: false,
                // [FIX-MA-SCALE] Индикатор НЕ ВЛИЯЕТ на масштаб свечей.
                // Без этой опции линия SMA/EMA висит на правой ценовой шкале
                // и участвует в autoscale: значения средней (особенно устаревшие
                // после смены ТФ/символа) растягивали или сжимали свечи по
                // вертикали. () => null полностью исключает серию из расчёта
                // диапазона шкалы — масштаб строится ТОЛЬКО по свечам, а линия
                // по-прежнему рисуется на правильных ценовых уровнях.
                autoscaleInfoProvider: () => null
            });
            this.series = [series];
        } else {
            const panel = this.manager.indicatorPanels[this.data.panel];
            if (panel?.chart) {
                const series = panel.chart.addSeries(LightweightCharts.LineSeries, {
                    color: this.settings.color || this.data.color,
                    lineWidth: this.settings.lineWidth || 1,
                    lastValueVisible: false,
                    priceLineVisible: false,
                    crosshairMarkerVisible: false   // [FIX-DOT] см. комментарий выше
                });
                this.series = [series];
            }
        }
        } catch(e) {
        console.error('Ошибка создания серии:', e);
    }
    
    return this.series;
}
       _removeAllSeries() {
        this.series.forEach(s => {
            if (!s) return;
            try {
                if (this.data.panel === 'main') {
                    this.manager.chartManager.chart.removeSeries(s);
                } else {
                    this.manager.panelManager.removeSeries(this.data.panel, s);
                }
            } catch(e) {
                console.warn('Ошибка удаления серии:', e);
            }
        });
        this.series = [];
    }
    
    _createEmptySeries() {
        // Переопределяется в наследниках
    }
    
    getSettingsHTML() {
        return `
            <div class="settings-row">
                <label>Цвет:</label>
                <input type="color" id="indicatorColor" value="${this.settings.color}" style="width: 50px; height: 30px;">
            </div>
            <div class="settings-row">
                <label>Толщина:</label>
                <input type="range" id="indicatorLineWidth" min="1" max="5" step="1" value="${this.settings.lineWidth}">
                <span class="value-display" id="lineWidthValue">${this.settings.lineWidth}</span>
            </div>
        `;
    }
    
    applySettingsFromForm() {
        const colorInput = document.getElementById('indicatorColor');
        const widthInput = document.getElementById('indicatorLineWidth');
        
        const newSettings = {};
        if (colorInput) newSettings.color = colorInput.value;
        if (widthInput) newSettings.lineWidth = parseInt(widthInput.value);
        
        this.updateSettings(newSettings);
    }
         destroy() {
        this._removeAllSeries();
        this.manager = null;
    }
}

if (typeof window !== 'undefined') {
    window.BaseIndicator = BaseIndicator;
}
