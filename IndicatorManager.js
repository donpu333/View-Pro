class IndicatorManager {
    
    constructor(chartManager) {
        this.chartManager = chartManager;
        this.activeIndicators = [];
        this.panelManager = null;
        this.indicatorPanels = {};
        
        this._addingInProgress = new Set();
        this._pendingIndicators = null;
        this._currentSettingsIndicator = null;
        this._outsideClickHandler = null;
        
        // Инициализируем Worker
        this.worker = window.initIndicatorWorker();
        if (this.worker) {
            this.worker.addEventListener('message', (e) => this._handleWorkerMessage(e.data));
        }
        
        this._initIndicatorPanels();
    }
    
    _handleWorkerMessage(message) {
        if (message.task === 'result') {
            const indicator = this.activeIndicators.find(i => i.id == message.indicatorId);
            if (indicator && message.success) indicator.onCalculateResult(message);
        }
        else if (message.task === 'resultMultiple') {
            for (const res of message.results) {
                const indicator = this.activeIndicators.find(i => i.id == res.indicatorId);
                if (indicator && res.success) {
                    indicator.onCalculateResult({ indicatorId: res.indicatorId, result: res.result, success: true });
                }
            }
        }
    }
    
    _filterData(data) {
        if (!data || !Array.isArray(data)) return [];
        return data.filter(item => item && item.time !== undefined && item.value !== undefined && !isNaN(item.value) && item.time > 0);
    }
    
    _initIndicatorPanels() {
        const chartContainer = document.getElementById('chart-container');
        
        let panelsContainer = document.getElementById('indicator-panels-container');
        if (!panelsContainer) {
            panelsContainer = document.createElement('div');
            panelsContainer.id = 'indicator-panels-container';
            chartContainer.parentNode.insertBefore(panelsContainer, chartContainer.nextSibling);
        }
        
        this.panelManager = new window.IndicatorPanelManager(panelsContainer, this.chartManager);
        
        // УДАЛЕНО: Ручной вызов syncTimeScaleWithMainChart. 
        // IndicatorPanelManager теперь делает это автоматически внутри себя при создании каждой панели!
    }
    
    toggleIndicatorVisibility(indicator) {
        if (!indicator) return;
        indicator.visible = indicator.visible === false ? true : false;
        indicator.series.forEach(series => {
            if (series) series.applyOptions({ visible: indicator.visible });
        });
        this._saveIndicators();
        this._renderUI();
    }
    
    _showPanel(panelId) {
        if (panelId === 'main') return;
        
        let panel = this.indicatorPanels[panelId];
        const isPanelAttached = panel && panel.wrapper && panel.wrapper.parentNode === this.panelManager.container;
        
        if (!panel || !isPanelAttached) {
            const activeInd = this.activeIndicators.find(i => i.data.panel === panelId);
            const panelName = activeInd ? activeInd.data.name : panelId.toUpperCase();
            panel = this.panelManager.createPanel(panelId, panelName, 150, 60, 400);
            this.indicatorPanels[panelId] = panel;
        }
        
        if (panel && panel.isCollapsed) {
            this.panelManager.toggleCollapse(panelId);
        }
    }

    addIndicator(type) {
        if (this._addingInProgress.has(type)) return false;
        if (this.activeIndicators.some(i => i.type === type)) return false;
        
        this._addingInProgress.add(type);
        
        try {
            const indicator = window.IndicatorFactory.createIndicator(type, this);
            if (!indicator) return false;
            
            if (indicator.data.panel !== 'main') {
                this._showPanel(indicator.data.panel);
            }
            
            const series = indicator.createSeries();
            if (series) {
                this.activeIndicators.push(indicator);
                this._saveIndicators();
                this._renderUI();
                this.chartManager?._updateMainChartHeight?.();
                return true;
            }
            return false;
        } catch (error) {
            console.error(`Ошибка при добавлении индикатора ${type}:`, error);
            return false;
        } finally {
            // ИСПРАВЛЕНО: Снимаем блокировку сразу, без костыльного setTimeout
            this._addingInProgress.delete(type);
        }
    }
    
    removeIndicator(index) {
        const indicator = this.activeIndicators[index];
        if (!indicator) return false;
        
        indicator.series.forEach(series => {
            if (indicator.data.panel === 'main') {
                try { this.chartManager.chart.removeSeries(series); } catch(e) {}
            } else {
                // ИСПРАВЛЕНО: Передаем сам объект series, как ожидает новый PanelManager
                this.panelManager.removeSeries(indicator.data.panel, series);
            }
        });
        
        this.activeIndicators.splice(index, 1);
        
        if (indicator.data.panel !== 'main') {
            const hasOther = this.activeIndicators.some(i => i.data.panel === indicator.data.panel);
            if (!hasOther) {
                this.panelManager.closePanel(indicator.data.panel);
            }
        }
        
        this._saveIndicators();
        this._renderUI();
        this.chartManager?.chart?.timeScale()?.fitContent();
        
        return true;
    }
    
    updateAllIndicators() {
        if (!this.worker) return;
        
        const calculations = [];
        this.activeIndicators.forEach(indicator => {
            // ИСПРАВЛЕНО: Пропускаем индикаторы, которые не используют Worker (например, MultiTimeframeATR)
            const workerType = indicator.getWorkerType();
            if (!workerType) return; 
            
            const chartData = this.chartManager.chartData;
            if (chartData && chartData.length > 0) {
                calculations.push({
                    indicatorId: indicator.id,
                    type: workerType,
                    data: chartData,
                    params: indicator.getWorkerParams()
                });
            }
        });
        
        if (calculations.length > 0) {
            this.worker.postMessage({ task: 'calculateMultiple', calculations });
        }
    }
    
    // УДАЛЕНО: syncAllIndicatorPanels() - больше не нужно
    
    showIndicatorSettings(indicator) {
        const panel = document.getElementById('indicatorSettings');
        const content = document.getElementById('indicatorSettingsContent');
        const title = document.getElementById('indicatorSettingsTitle');
        
        if (!panel || !content || !title) return;
        
        this._currentSettingsIndicator = indicator;
        title.textContent = `Настройки: ${indicator.data.name}`;
        content.innerHTML = indicator.getSettingsHTML();
        
        const widthSlider = document.getElementById('indicatorLineWidth');
        const widthValue = document.getElementById('lineWidthValue');
        if (widthSlider && widthValue) {
            widthValue.textContent = widthSlider.value;
            widthSlider.oninput = () => widthValue.textContent = widthSlider.value;
        }
        
        panel.style.display = 'block';
        panel.style.left = '50%';
        panel.style.top = '50%';
        panel.style.transform = 'translate(-50%, -50%)';
        this._setupIndicatorSettingsButtons(panel);
    }
    
    _setupIndicatorSettingsButtons(panel) {
        const saveBtn = document.getElementById('indicatorSaveSettings');
        if (saveBtn) {
            saveBtn.onclick = () => {
                if (this._currentSettingsIndicator) {
                    this._currentSettingsIndicator.applySettingsFromForm();
                    // ВНИМАНИЕ: Метод createSeries() внутри ваших классов ДОЛЖЕН удалять старые серии!
                    this._currentSettingsIndicator.createSeries();
                    this._renderUI();
                    this._saveIndicators();
                }
                this._closeSettingsPanel(panel);
            };
        }
        
        const deleteBtn = document.getElementById('indicatorDelete');
        if (deleteBtn) {
            deleteBtn.onclick = () => {
                if (this._currentSettingsIndicator) {
                    const index = this.activeIndicators.findIndex(i => i.id === this._currentSettingsIndicator.id);
                    if (index !== -1) this.removeIndicator(index);
                }
                this._closeSettingsPanel(panel);
            };
        }
        
        const closeBtn = panel.querySelector('.close-settings');
        if (closeBtn) {
            closeBtn.onclick = () => this._closeSettingsPanel(panel);
        }
        
        if (this._outsideClickHandler) document.removeEventListener('mousedown', this._outsideClickHandler);
        
        this._outsideClickHandler = (e) => {
            if (!panel.contains(e.target)) this._closeSettingsPanel(panel);
        };
        setTimeout(() => document.addEventListener('mousedown', this._outsideClickHandler), 10);
    }
    
    _closeSettingsPanel(panel) {
        panel.style.display = 'none';
        if (this._outsideClickHandler) {
            document.removeEventListener('mousedown', this._outsideClickHandler);
            this._outsideClickHandler = null;
        }
    }
    
    _saveIndicators() {
        const indicatorsData = this.activeIndicators.map(indicator => ({
            type: indicator.type,
            settings: indicator.settings,
            id: indicator.id,
            visible: indicator.visible !== false
        }));
        localStorage.setItem('activeIndicatorsV2', JSON.stringify(indicatorsData));
    }
    
    loadIndicators() {
        try {
            const saved = localStorage.getItem('activeIndicatorsV2');
            if (!saved) return;
            
            const indicatorsData = JSON.parse(saved);
            if (!indicatorsData || indicatorsData.length === 0) return;
            
            if (!this.chartManager.chartData || this.chartManager.chartData.length === 0) {
                this._pendingIndicators = indicatorsData;
                return;
            }
            
            this._restoreIndicators(indicatorsData);
        } catch(e) {
            console.warn('❌ Ошибка загрузки индикаторов:', e);
        }
    }
    
    restorePendingIndicators() {
        if (!this.chartManager.chartData || this.chartManager.chartData.length === 0) return;
        
        if (this._pendingIndicators && this._pendingIndicators.length > 0) {
            const data = [...this._pendingIndicators];
            this._pendingIndicators = null;
            this._restoreIndicators(data);
        }
    }
    
    // ИСПРАВЛЕНО: Убрали уродливые setTimeout с index * 200. Теперь индикаторы загружаются мгновенно.
    _restoreIndicators(indicatorsData) {
        indicatorsData.forEach(data => {
            if (this.activeIndicators.some(i => i.type === data.type)) return;
            
            const success = this.addIndicator(data.type);
            if (success) {
                const indicator = this.activeIndicators.find(i => i.type === data.type);
                if (indicator) {
                    if (data.settings) indicator.settings = { ...indicator.settings, ...data.settings };
                    if (data.visible !== undefined) indicator.visible = data.visible;
                    
                    indicator.createSeries();
                    indicator.series.forEach(series => {
                        if (series) series.applyOptions({ visible: indicator.visible });
                    });
                }
            }
        });
        
        this.afterAllIndicatorsLoaded();
    }
    
    afterAllIndicatorsLoaded() {
        this.chartManager?._updateMainChartHeight?.();
        
        const volumeScale = this.chartManager?.chart?.priceScale('volume');
        if (volumeScale) volumeScale.applyOptions({ scaleMargins: { top: 0.7, bottom: 0 } });
        
        // УДАЛЕНО: Вызов syncAllIndicatorPanels() - больше не нужно
    }
    
    clearAllIndicators() {
        for (let i = this.activeIndicators.length - 1; i >= 0; i--) {
            this.removeIndicator(i);
        }
    }
    
    _renderUI() {
        if (window.renderActiveIndicatorsUI) {
            window.renderActiveIndicatorsUI(this.activeIndicators);
        }
    }
}

if (typeof window !== 'undefined') {
    window.IndicatorManager = IndicatorManager;
}