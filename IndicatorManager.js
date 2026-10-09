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
        this._pendingIndicatorsUpdate = false;
        this._pendingIndicatorResults = new Map();
        
        // [FIX] Троттлинг пересчётов — не чаще одного раза за _indicatorThrottleMs
        this._updateThrottleTimeout = null;
        this._lastIndicatorUpdateAt = 0;
        this._indicatorThrottleMs = 150;
        // [CROSSHAIR-PERF] На глубокой истории (десятки тысяч свечей) полный
        // пересчёт дорог: structured-clone массива в worker + setData результатов
        // блокируют main thread. Окно расчёта ограничено хвостом массива —
        // недостающие точки превращаются в whitespace при применении ([FIX-I1]),
        // поэтому выравнивание логических индексов панелей 1:1 не ломается.
        this._calcWindowCandles = 12000;
        // [DRAW-PERF] таймер отложенного повторного flush (драг/скролл)
        this._flushRetryTimeout = null;
        
        // [FIX] Батч результатов: собираем результаты worker'а и применяем в одном RAF
        this._batchResults = [];
        this._batchRafId = null;
        
        // [FIX-MA-JUMP] «Поколение» данных графика. Инкрементируется при каждой
        // полной замене свечей (смена ТФ/символа — ChartManager.setDataQuick()
        // вызывает resetForNewData()). Каждый запрос в worker помечается текущим
        // поколением, и результаты ЧУЖОГО поколения отбрасываются: раньше расчёт,
        // стартовавший на старом ТФ, прилетал после переключения и ложил точки со
        // старыми метками времени поверх новых свечей — шкала времени (объединение
        // времён всех серий) разъезжалась, свечи «скакали».
        this._dataGeneration = 0;
        
        // Привязываем контекст всех методов
        this._handleWorkerMessage = this._handleWorkerMessage.bind(this);
        this.updateAllIndicators = this.updateAllIndicators.bind(this);
        this.loadIndicators = this.loadIndicators.bind(this);
        this.restorePendingIndicators = this.restorePendingIndicators.bind(this);
        this._saveIndicators = this._saveIndicators.bind(this);
        
        // Инициализируем Worker
        this.worker = window.initIndicatorWorker();
        if (this.worker) {
            this.worker.addEventListener('message', (e) => this._handleWorkerMessage(e.data));
        }
        
        this._initIndicatorPanels();
        
        setTimeout(() => {
            this.loadIndicators();
        }, 2000);
    }
    
    // [FIX] Применяем собранные результаты в одном RAF вместо трёх отдельных рендеров
    _flushBatch() {
        this._batchRafId = null;
        if (this._batchResults.length === 0) return;
        // [DRAW-PERF] Применяем результаты ПОРЦИЯМИ (не больше 2 индикаторов за кадр).
        // onCalculateResult -> setData по всему массиву свечей; на глубокой истории
        // (20-40 тыс.) пачка из всех индикаторов в одном кадре блокировала main thread
        // на 100-300 мс — перетаскивание алертов/трендов «заикалось».
        const batch = this._batchResults.splice(0, 2);
        for (const { indicator, res } of batch) {
            // Проверяем, что индикатор всё ещё активен (не удалён между сбором и применением)
            if (!this.activeIndicators.includes(indicator)) continue;
            indicator.onCalculateResult({ 
                indicatorId: res.indicatorId, 
                result: res.result, 
                success: true 
            });
        }
        if (this._batchResults.length > 0) {
            // остальные — в следующих кадрах
            this._scheduleBatchFlush();
            return;
        }
        // [FIX-I5] после применения новых данных индикаторов выравниваем шкалы панелей
        this.panelManager?.syncPanelsNow?.();
    }
    
    _scheduleBatchFlush() {
        if (this._batchRafId) return;
        this._batchRafId = requestAnimationFrame(() => this._flushBatch());
    }
    
    _handleWorkerMessage(message) {
        // [FIX] Собираем результаты, применяем в одном RAF
        const collect = (res) => {
            // [FIX-MA-JUMP] Результат устаревшего поколения данных (ТФ/символ
            // сменились, пока worker считал) применять НЕЛЬЗЯ: его точки имеют
            // метки времени старого ТФ и ломают шкалу времени главного графика.
            if (res.generation !== this._dataGeneration) return;
            const indicator = this.activeIndicators.find(i => i.id == res.indicatorId);
            if (!indicator || !res.success) return;

            // Если идёт скролл — откладываем применение результата
            // [CROSSHAIR-PERF] ...или пользователь двигает перекрестие: setData
            // результатов — тяжёлая операция, она не должна вклиниваться между
            // кадрами движения крестика. Применится через flush после остановки.
            if (this.chartManager?._isScrolling || this.chartManager?._isScrollingFast || this.chartManager?._isVerticalZooming || this.chartManager?._crosshairActive || this.chartManager?._isDrawingDragActive?.()) {
                this._pendingIndicatorResults.set(indicator.id, res);
                return;
            }
            this._batchResults.push({ indicator, res });
        };

        if (message.task === 'result') {
            collect(message);
        } else if (message.task === 'resultMultiple') {
            for (const res of message.results) {
                collect(res);
            }
        } else {
            return;
        }

        if (this._batchResults.length > 0) {
            this._scheduleBatchFlush();
        }
    }
    
    _flushPendingIndicatorResults() {
        if (this._pendingIndicatorResults.size === 0) return;
        
        // [FIX] Собираем в батч и применяем в одном RAF
        for (const [indicatorId, res] of this._pendingIndicatorResults.entries()) {
            const indicator = this.activeIndicators.find(i => i.id == indicatorId);
            if (indicator && res.success) {
                this._batchResults.push({ indicator, res });
            }
        }
        this._pendingIndicatorResults.clear();
        
        if (this._batchResults.length > 0) {
            this._scheduleBatchFlush();
        }
    }
    
    // [FIX-I1] Точки прогрева (value=null/NaN) НЕ выбрасываются, а превращаются
    // в whitespace-данные lightweight-charts ({time} без value): серия индикатора
    // всегда той же длины, что и свечи, поэтому логические индексы панелей и
    // главного графика совпадают 1:1 — скролл/зум/перекрестие синхронны.
    _filterData(data) {
        if (!data || !Array.isArray(data)) return [];
        // [FIX-MA-JUMP] Последний рубеж защиты свечей: точка индикатора, чьё
        // время ОТСУТСТВУЕТ среди текущих свечей, на серию не попадает вообще.
        // Шкала времени lightweight-charts — объединение времён ВСЕХ серий:
        // одна «чужая» точка (устаревший результат, сбой выравнивания) сдвигала
        // бы все свечи. Все worker-индикаторы считаются по chartData, поэтому
        // легальные точки всегда есть в _candleTimeMap — фильтр их не задевает.
        const tmap = this.chartManager?._candleTimeMap;
        const guardTime = !!(tmap && typeof tmap.has === 'function' && tmap.size > 0);
        const out = [];
        for (const item of data) {
            if (!item || item.time === undefined || !(item.time > 0)) continue;
            if (guardTime && !tmap.has(item.time)) continue;
            const v = item.value;
            if (v === undefined || v === null || (typeof v === 'number' && isNaN(v))) out.push({ time: item.time });
            else out.push({ time: item.time, value: v });
        }
        return out;
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
        // [VP-MA] скользящие средние (и всё с meta.multiple) можно добавлять
        // несколькими экземплярами с разными периодами и цветами
        const IndClass = window.IndicatorRegistry && window.IndicatorRegistry.get(type);
        const allowMultiple = !!(IndClass && IndClass.meta && IndClass.meta.multiple);
        const sameCount = this.activeIndicators.filter(i => i.type === type).length;
        if (!allowMultiple && sameCount > 0) return false;
        
        this._addingInProgress.add(type);
        
        try {
            const indicator = window.IndicatorFactory.createIndicator(type, this);
            if (!indicator) return false;

            // [VP-MA] 2-й и следующие экземпляры того же типа получают цвет из
            // палитры, иначе несколько скользящих средних сливаются в одну линию
            if (allowMultiple && sameCount > 0) {
                const palette = ['#FF9800', '#4CAF50', '#E91E63', '#00BCD4', '#FFEB3B', '#9C27B0', '#FF5722', '#3F51B5', '#8BC34A', '#009688'];
                const autoColor = palette[(sameCount - 1) % palette.length];
                indicator.settings.color = autoColor;
                indicator.data.color = autoColor;
            }
            
            if (indicator.data.panel !== 'main') {
                this._showPanel(indicator.data.panel);
            }
            
            const series = indicator.createSeries();
            if (series) {
                this.activeIndicators.push(indicator);
                this._saveIndicators();
                this._renderUI();
                this.chartManager?._updateMainChartHeight?.();
                
                // Запускаем расчёт для нового индикатора
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
        
        // Очищаем отложенные результаты для удалённого индикатора
        this._pendingIndicatorResults.delete(indicator.id);
        // [FIX] И из текущего батча
        this._batchResults = this._batchResults.filter(b => b.indicator !== indicator);
        
        this._saveIndicators();
        this._renderUI();
     
        
        return true;
    }
    
    // [FIX-I3] Мягкая просьба пересчитать индикаторы (на тике цены/клины).
    // Внутренний троттлинг updateAllIndicators() сам ограничит частоту.
    scheduleUpdate() {
        this.updateAllIndicators();
    }

    updateAllIndicators() {
        if (!this.worker) return;
        
        // Не запускаем расчёт во время скролла/зума
        // [CROSSHAIR-PERF] ...и пока пользователь двигает перекрестие: пересчёт
        // блокирует main thread, и крестик «отлипает» от курсора. Ставим в очередь —
        // flushPendingIndicatorsUpdate() выполнит её через 150 мс после остановки мыши.
        if (this.chartManager?._isScrolling || this.chartManager?._isScrollingFast || this.chartManager?._isVerticalZooming || this.chartManager?._crosshairActive || this.chartManager?._isDrawingDragActive?.()) {
            this._pendingIndicatorsUpdate = true;
            return;
        }
        
        // [FIX] Троттлинг: не чаще одного пересчёта за _indicatorThrottleMs
        // [CROSSHAIR-PERF] Троттлинг адаптивный: чем больше данных в памяти,
        // тем дороже пересчёт (clone + mapping + setData по всей длине) — тем реже
        // его делаем. На типичных 1000-8000 свечей остаётся прежние 150 мс.
        const dataLen = this.chartManager?.chartData?.length || 0;
        const throttleMs = dataLen > 20000 ? 600 : dataLen > 10000 ? 350 : this._indicatorThrottleMs;
        const now = performance.now();
        const elapsed = now - this._lastIndicatorUpdateAt;
        if (elapsed < throttleMs) {
            if (!this._updateThrottleTimeout) {
                this._updateThrottleTimeout = setTimeout(() => {
                    this._updateThrottleTimeout = null;
                    this.updateAllIndicators();
                }, throttleMs - elapsed);
            }
            return;
        }
        this._lastIndicatorUpdateAt = now;
        
        // PERF: пропускаем полный пересчёт, если данные и состав индикаторов
        // не изменились с прошлого запуска. updateAllIndicators() дёргается на
        // каждом тике (до ~6 раз/с) и каждый раз отправляет ВЕСЬ chartData
        // (до 5000 свечей) в worker + применяет результат через series.setData().
        // Все worker-индикаторы считаются только по OHLC — если последняя свеча
        // не изменилась (обновление объёма, resize, повторный тик той же цены),
        // результат идентичен, пересчёт не нужен.
        const cmRef = this.chartManager;
        const dataRef = cmRef?.chartData;
        if (dataRef && dataRef.length > 0 && this.activeIndicators.length > 0) {
            const lastBar = dataRef[dataRef.length - 1];
            const sig = dataRef.length + '|' + lastBar.time + '|' + lastBar.open + '|' +
                lastBar.high + '|' + lastBar.low + '|' + lastBar.close + '|' +
                (cmRef.currentSymbol || '') + '|' + (cmRef.currentInterval || '') + '|' +
                this.activeIndicators.map(i => i.id).join(',');
            if (sig === this._lastCalcSignature) return;
            this._lastCalcSignature = sig;
        }
        
        const calculations = [];
        this.activeIndicators.forEach(indicator => {
            const workerType = indicator.getWorkerType();
            if (!workerType) return; 
            
            const chartData = this.chartManager.chartData;
            if (chartData && chartData.length > 0) {
                if (indicator.result) {
                    indicator.result = null;
                }
                
                // [CROSSHAIR-PERF] В worker отправляем только хвост массива
                // (_calcWindowCandles). Structured-clone 40 000 объектов
                // блокировал main thread на десятки мс каждые 150 мс — именно
                // это роняло кадры перекрестия на глубокой истории. Прогрев
                // индикаторов (SMA/RSI/...) много меньше окна, а недостающие
                // старые точки станут whitespace ([FIX-I1]) — выравнивание панелей целое.
                const win = this._calcWindowCandles || 12000;
                const data = chartData.length > win ? chartData.slice(chartData.length - win) : chartData;
                calculations.push({
                    indicatorId: indicator.id,
                    generation: this._dataGeneration,   // [FIX-MA-JUMP] worker вернёт его обратно
                    type: workerType,
                    // [FIX] Не копируем массив — postMessage всё равно сделает structured clone
                    data: data,
                    params: indicator.getWorkerParams()
                });
            }
        });
        
        if (calculations.length > 0) {
            this.worker.postMessage({ task: 'calculateMultiple', calculations });
        }
    }
    
    // [FIX-MA-JUMP] Вызывается ChartManager.setDataQuick() ПЕРЕД укладкой новых
    // свечей (смена ТФ/символа/первичная загрузка):
    //  1. инкрементирует поколение данных — все in-flight и отложенные результаты
    //     worker'а со старыми метками времени будут отброшены в _handleWorkerMessage;
    //  2. очищает очереди (_pendingIndicatorResults, _batchResults) — там могли
    //     лежать результаты, посчитанные ещё по прежнему ТФ;
    //  3. ОБНУЛЯЕТ все серии индикаторов (главный график + панели): точки старого
    //     ТФ немедленно исчезают со шкалы времени, и новые свечи рисуются строго
    //     по своим данным — индикаторы больше не могут сдвинуть или растянуть их.
    //  4. сбрасывает подпись/троттл пересчёта — новый ТФ пересчитывается сразу.
    resetForNewData() {
        this._dataGeneration++;
        this._lastCalcSignature = null;
        this._lastIndicatorUpdateAt = 0;
        this._pendingIndicatorResults.clear();
        if (this._batchRafId) {
            cancelAnimationFrame(this._batchRafId);
            this._batchRafId = null;
        }
        this._batchResults = [];
        for (const indicator of this.activeIndicators) {
            if (!indicator || !Array.isArray(indicator.series)) continue;
            for (const series of indicator.series) {
                if (!series || typeof series.setData !== 'function') continue;
                try { series.setData([]); } catch (e) {}
            }
        }
    }
    
    flushPendingIndicatorsUpdate() {
        // [DRAW-PERF] Пока тащат рисовалку или идёт скролл — не применяем тяжёлые
        // результаты (setData по всему массиву на каждый индикатор). Раньше flush
        // взрывался ровно в паузе перетаскивания алерта (150 мс покоя мыши) —
        // отсюда «алерты стали плохо перемещаться при повторном» хвате.
        const cm = this.chartManager;
        const busy = cm && (cm._isScrolling || cm._isScrollingFast || cm._isVerticalZooming ||
            (typeof cm._isDrawingDragActive === 'function' && cm._isDrawingDragActive()));
        if (busy) {
            if (!this._flushRetryTimeout) {
                this._flushRetryTimeout = setTimeout(() => {
                    this._flushRetryTimeout = null;
                    this.flushPendingIndicatorsUpdate();
                }, 200);
            }
            return;
        }
        if (this._flushRetryTimeout) { clearTimeout(this._flushRetryTimeout); this._flushRetryTimeout = null; }
        if (this._pendingIndicatorsUpdate) {
            this._pendingIndicatorsUpdate = false;
            this.updateAllIndicators();
        }
        this._flushPendingIndicatorResults();
    }
    
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
        console.log('💾 Индикаторы сохранены:', indicatorsData.length);
    }
    
    loadIndicators() {
        try {
            const saved = localStorage.getItem('activeIndicatorsV2');
            if (!saved) return;
            
            const indicatorsData = JSON.parse(saved);
            if (!indicatorsData || indicatorsData.length === 0) return;
            
            if (!this.chartManager.chartData || this.chartManager.chartData.length === 0) {
                this._pendingIndicators = indicatorsData;
                console.log('⏳ Данные графика еще не загружены, откладываем восстановление индикаторов');
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
            
            // Запускаем пересчет
            setTimeout(() => {
                this.updateAllIndicators();
            }, 500);
        }
    }
    
    _restoreIndicators(indicatorsData) {
        indicatorsData.forEach(data => {
            // [VP-MA] при восстановлении тоже разрешаем несколько экземпляров
            const RestoreClass = window.IndicatorRegistry.get(data.type);
            const allowMulti = !!(RestoreClass && RestoreClass.meta && RestoreClass.meta.multiple);
            if (!allowMulti && this.activeIndicators.some(i => i.type === data.type)) return;
            
            // [FIX-MA-DUPES2] Скользящие средние НЕЛЬЗЯ восстанавливать повторно.
            // Выше для SMA/EMA (meta.multiple=true) проверки не было: второй вызов
            // loadIndicators() — например, таймер конструктора (2 с) срабатывал
            // ПОСЛЕ того, как setDataQuick уже восстановил индикаторы, — создавал
            // ещё один экземпляр каждой средней, а _saveIndicators() закреплял
            // дубли в localStorage: при переключении таймфрейма/перезагрузке
            // появлялась «ещё одна» такая же линия. Дубль определяем по тройке
            // (тип + период + цвет): намеренно добавленные разные средние всегда
            // отличаются хотя бы периодом или цветом (addIndicator выдаёт 2-му+
            // экземпляру цвет из палитры). Эта же проверка «схлопывает» дубли,
            // которые уже успела сохранить старая версия бага.
            if (allowMulti) {
                const metaColor = (RestoreClass.meta && RestoreClass.meta.color) || '#FFA500';
                const savedColor = String((data.settings && data.settings.color) || metaColor);
                const savedPeriod = (data.settings && data.settings.period !== undefined) ? data.settings.period : null;
                const dupe = this.activeIndicators.some(i => {
                    if (i.type !== data.type) return false;
                    const c = String((i.settings && i.settings.color) || metaColor);
                    const p = (i.settings && i.settings.period !== undefined) ? i.settings.period : null;
                    return c === savedColor && p === savedPeriod;
                });
                if (dupe) return;
            }
            
            const IndicatorClass = window.IndicatorRegistry.get(data.type);
            if (!IndicatorClass) return;
            
            const indicator = new IndicatorClass(this);
            if (!indicator) return;
            
            // Сначала настройки, ПОТОМ createSeries
            if (data.settings) {
                indicator.settings = { ...indicator.settings, ...data.settings };
            }
            if (data.visible !== undefined) {
                indicator.visible = data.visible;
            }
            
            // Проверяем цвет
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
        this.afterAllIndicatorsLoaded();
    }
    
    afterAllIndicatorsLoaded() {
        this.chartManager?._updateMainChartHeight?.();
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
