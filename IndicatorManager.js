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
        
        // 🔥 ЗАЩИТА ОТ СПАМА WORKER (Debounce)
        this._updateWorkerTimer = null;
        this._isWorkerProcessing = false;

        // Привязываем контекст всех методов
        this._handleWorkerMessage = this._handleWorkerMessage.bind(this);
        this.updateAllIndicators = this.updateAllIndicators.bind(this);
        this.loadIndicators = this.loadIndicators.bind(this);
        this.restorePendingIndicators = this.restorePendingIndicators.bind(this);
        this._saveIndicators = this._saveIndicators.bind(this);
        
        // Инициализируем Worker
        this.worker = window.initIndicatorWorker ? window.initIndicatorWorker() : null;
        if (this.worker) {
            this.worker.addEventListener('message', (e) => this._handleWorkerMessage(e.data));
            // Обработка ошибок воркера, чтобы не ронять приложение
            this.worker.addEventListener('error', (e) => console.error('❌ Worker error:', e));
        }
        
        this._initIndicatorPanels();
        
        setTimeout(() => {
            this.loadIndicators();
        }, 2000);
    }
    
    _handleWorkerMessage(message) {
        this._isWorkerProcessing = false; // Разрешаем следующие запросы

        const processResult = (res) => {
            const indicator = this.activeIndicators.find(i => i.id == res.indicatorId);
            if (indicator && res.success) {
                // 🔥 ОПТИМИЗАЦИЯ: Убрали s.setData([]). 
                // Пусть onCalculateResult сам делает setData(newData). Это предотвратит 1-кадровое моргание.
                indicator.onCalculateResult({ 
                    indicatorId: res.indicatorId, 
                    result: res.result, 
                    success: true 
                });
            }
        };

        if (message.task === 'result') {
            processResult(message);
        } else if (message.task === 'resultMultiple') {
            for (const res of message.results) {
                processResult(res);
            }
        }
    }
    
    _filterData(data) {
        if (!data || !Array.isArray(data)) return [];
        return data.filter(item => 
            item && item.time !== undefined && item.value !== undefined && 
            !isNaN(item.value) && item.time > 0
        );
    }
    
    _initIndicatorPanels() {
        const chartContainer = document.getElementById('chart-container');
        if (!chartContainer) return;
        
        let panelsContainer = document.getElementById('indicator-panels-container');
        if (!panelsContainer) {
            panelsContainer = document.createElement('div');
            panelsContainer.id = 'indicator-panels-container';
            chartContainer.parentNode.insertBefore(panelsContainer, chartContainer.nextSibling);
        }
        
        this.panelManager = new window.IndicatorPanelManager(panelsContainer, this.chartManager);
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
            
            // 🔥 ВАЖНО: Привязываем кроссхейр и синхронизацию сразу при создании
            if (this.panelManager._syncPanelWithMainChart) {
                this.panelManager._syncPanelWithMainChart(panelId);
            }
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
            const indicator = window.IndicatorFactory ? window.IndicatorFactory.createIndicator(type, this) : null;
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
                
                // 🔥 Запускаем расчет, но с защитой от дублирования
                this.updateAllIndicators();
                return true;
            }
            return false;
        } catch (error) {
            console.error(`Ошибка при добавлении индикатора ${type}:`, error);
            return false;
        } finally {
            this._addingInProgress.delete(type);
        }
    }
    
    removeIndicator(index) {
        const indicator = this.activeIndicators[index];
        if (!indicator) return false;
        
        if (indicator.destroy) {
            indicator.destroy();
        }
        
        indicator.series.forEach(series => {
            if (indicator.data.panel === 'main') {
                try { this.chartManager.chart.removeSeries(series); } catch(e) {}
            } else {
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
        
        // ❌ УДАЛЕНО: this.chartManager?.chart?.timeScale()?.fitContent();
        // Вызов fitContent() при удалении индикатора сбрасывает позицию скролла пользователя, что очень раздражает.
        
        return true;
    }
    
    // 🔥 ОПТИМИЗИРОВАННЫЙ ВЫЗОВ WORKER С DEBOUNCE
   updateAllIndicators() {
    if (!this.worker) return;
    
    // Debounce защита (если она у вас уже есть, оставьте её)
    if (this._updateWorkerTimer) clearTimeout(this._updateWorkerTimer);

    this._updateWorkerTimer = setTimeout(() => {
        const calculations = [];
        const chartData = this.chartManager.chartData;
        
        if (!chartData || chartData.length === 0) return;

        // ⚡ ШАГ 4: Берем только видимый диапазон + буфер по 50 свечей с каждой стороны
        const range = this.chartManager.chart.timeScale().getVisibleLogicalRange();
        let from = 0;
        let to = chartData.length - 1;
        
        if (range) {
            from = Math.max(0, Math.floor(range.from) - 50);
            to = Math.min(chartData.length - 1, Math.ceil(range.to) + 50);
        }
        
        const visibleData = chartData.slice(from, to + 1);

        this.activeIndicators.forEach(indicator => {
            const workerType = indicator.getWorkerType();
            if (!workerType) return; 
            
            calculations.push({
                indicatorId: indicator.id,
                type: workerType,
                data: visibleData, // ⚡ Отправляем в воркер 200 элементов вместо 10 000!
                params: indicator.getWorkerParams ? indicator.getWorkerParams() : {},
                offsetIndex: from // Передаем смещение, чтобы индикатор знал, к каким свечам это относится
            });
        });
        
        if (calculations.length > 0) {
            this._isWorkerProcessing = true;
            this.worker.postMessage({ task: 'calculateMultiple', calculations });
        }
    }, 150);
}

    showIndicatorSettings(indicator) {
        const panel = document.getElementById('indicatorSettings');
        const content = document.getElementById('indicatorSettingsContent');
        const title = document.getElementById('indicatorSettingsTitle');
        
        if (!panel || !content || !title) return;
        
        this._currentSettingsIndicator = indicator;
        title.textContent = `Настройки: ${indicator.data.name}`;
        content.innerHTML = indicator.getSettingsHTML ? indicator.getSettingsHTML() : '';
        
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
                if (this._currentSettingsIndicator && this._currentSettingsIndicator.applySettingsFromForm) {
                    this._currentSettingsIndicator.applySettingsFromForm();
                    this._currentSettingsIndicator.createSeries();
                    this._renderUI();
                    this._saveIndicators();
                    this.updateAllIndicators(); // Пересчитываем с новыми настройками
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
    
    _restoreIndicators(indicatorsData) {
        indicatorsData.forEach(data => {
            if (this.activeIndicators.some(i => i.type === data.type)) return;
            
            const IndicatorClass = window.IndicatorRegistry ? window.IndicatorRegistry.get(data.type) : null;
            if (!IndicatorClass) return;
            
            const indicator = new IndicatorClass(this);
            if (!indicator) return;
            
            if (data.settings) {
                indicator.settings = { ...indicator.settings, ...data.settings };
            }
            if (data.visible !== undefined) {
                indicator.visible = data.visible;
            }
            
            if (!indicator.settings.color || indicator.settings.color === 'undefined') {
                indicator.settings.color = indicator.data.color || '#FFA500';
            }
            
            if (indicator.data.panel !== 'main') {
                this._showPanel(indicator.data.panel);
            }
            
            const series = indicator.createSeries();
            if (series && series.length > 0) {
                this.activeIndicators.push(indicator);
                indicator.series.forEach(s => {
                    if (s) s.applyOptions({ visible: indicator.visible !== false });
                });
            }
        });
        
        this._saveIndicators();
        this._renderUI();
        this.chartManager?._updateMainChartHeight?.();
        
        // 🔥 КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Запускаем расчет после восстановления!
        // Раньше этого не было, и индикаторы висели пустыми до первого обновления.
        setTimeout(() => {
            this.updateAllIndicators();
        }, 300);
    }
    
    // 🔥 ОПТИМИЗИРОВАННОЕ МАССОВОЕ УДАЛЕНИЕ
    clearAllIndicators() {
        if (this.activeIndicators.length === 0) return;
        
        // 1. Сначала уничтожаем все серии и DOM-элементы
        for (let i = this.activeIndicators.length - 1; i >= 0; i--) {
            const indicator = this.activeIndicators[i];
            if (indicator.destroy) indicator.destroy();
            
            indicator.series.forEach(series => {
                if (indicator.data.panel === 'main') {
                    try { this.chartManager.chart.removeSeries(series); } catch(e) {}
                } else {
                    this.panelManager.removeSeries(indicator.data.panel, series);
                }
            });
        }
        
        // 2. Закрываем пустые панели
        const panelsToClose = new Set();
        this.activeIndicators.forEach(ind => {
            if (ind.data.panel !== 'main') panelsToClose.add(ind.data.panel);
        });
        
        panelsToClose.forEach(panelId => {
            this.panelManager.closePanel(panelId);
            delete this.indicatorPanels[panelId];
        });
        
        // 3. Очищаем массив ОДИН раз
        this.activeIndicators = [];
        
        // 4. Сохраняем и обновляем UI ОДИН раз (вместо N раз в цикле)
        this._saveIndicators();
        this._renderUI();
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
