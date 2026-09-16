// =====================================================================================
// ИСПРАВЛЕННАЯ ВЕРСИЯ TimeframeManager
// =====================================================================================
// TF-FIX #1: _timeScaleUnsubscribe ВСЕГДА был undefined — в lightweight-charts
//   v4 subscribeVisibleLogicalRangeChange() ничего не возвращает, отписка
//   делается через unsubscribeVisibleLogicalRangeChange(handler). Обработчик
//   утекал: после destroy() на каждое изменение диапазона продолжал
//   выполняться saveCurrentPosition() по мёртвому chart (TypeError в rAF).
// TF-FIX #2: UI-слушатели (заголовок панели, кнопки TF/candle/bar/scroll/
//   autoscale, копирование) регистрировались АНОНИМНЫМИ функциями и в
//   destroy() не снимались. При пересоздании менеджера (re-init/hot-reload)
//   слушатели накапливались: клик по заголовку переключал панель N раз
//   (при чётном N — панель «не открывается»), switchToTimeframe вызывался
//   несколько раз за клик. Теперь все обработчики хранятся и снимаются.
// TF-FIX #3: saveCurrentPosition()/restorePosition() не имели защиты от
//   уничтоженного chart — TypeError на каждом rAF после destroy.
// TF-FIX #4: Alt+T (спот/фьючерс): updateInstrumentInfo() вызывался СРАЗУ
//   после запуска АСИНХРОННОГО switchSymbol() — бейдж PERP/SPOT оставался
//   устаревшим, т.к. switchSymbol меняет currentMarketType в середине
//   процесса. Теперь обновление бейджа подписано на
//   _subscribeToSymbolChange (ChartManager уведомляет, когда поля реально
//   изменены) + обновляется после resolve промиса.
// TF-FIX #5: switchToTimeframe проверял chartManager._savedWasViewingHistory —
//   такого поля в ChartManager НЕТ (есть _isViewingHistory). Ветвь
//   «восстановить позицию истории после смены ТФ» была мёртвым кодом:
//   при просмотре истории и смене таймфрейма пользователя всегда выбрасывало
//   к последним свечам. Теперь состояние просмотра истории захватывается
//   ДО переключения из реального поля _isViewingHistory.
// TF-FIX #6: restorePosition():
//   а) guard «видна последняя свеча → не восстанавливать» делал восстановление
//      после смены ТФ НЕВОЗМОЖНЫМ в принципе: setDataQuick всегда позиционирует
//      новый график у правого края → to >= lastIndex-2 → ранний return.
//      Добавлен параметр force (switchToTimeframe зовёт с force=true).
//   б) «приоритетная» ветвь применяла _savedLogicalRange — ИНДЕКСЫ старого
//      датасета (другой ТФ/символ ⇒ другая длина и шаг) — к новому массиву:
//      позиция восстанавливалась бы неверно. Ветвь удалена (она и не работала,
//      см. TF-FIX #5), оставлен только надёжный расчёт по ВРЕМЕНИ.
// TF-FIX #7: copyToClipboard(): `navigator.clipboard?.writeText(...).then(...)
//   .catch(fallback)` — optional chaining при отсутствии clipboard (http,
//   небезопасный контекст, старые браузеры) КОРОТИТ ВСЮ цепочку вместе с
//   catch — fallback на execCommand не выполнялся НИКОГДА, кнопка копирования
//   молча умирала. Переписано явными ветвями.
// TF-FIX #8: destroy() — флаг _destroyed (гасит отложенные rAF/колбэки),
//   снятие подписки на symbol change, обнуление ссылок.
// =====================================================================================

class TimeframeManager {
    constructor(chartManager, wsManager, timerManager) {
        this.chartManager = chartManager;
        this.wsManager = wsManager;
        this.timerManager = timerManager;
        this.currentInterval = this._getInitialInterval();
        console.log('📊 TimeframeManager: таймфрейм =', this.currentInterval);
        
        this.savedCenterTime = null;
        this.savedTimeSpan = null;
        this.savedVisibleBars = 0;   // TF-FIX #9: сколько свечей было видно (TradingView-стиль)
        this._timeScaleUnsubscribe = null;
        this._abortController = null;
        this._saveTimeout = null;

        // TF-FIX #2/#8: реестр UI-слушателей для корректного снятия в destroy()
        this._destroyed = false;
        this._uiListeners = [];        // [{target, type, handler}]
        this._symbolChangeHandler = null;

        this._handleDocumentClick = this._handleDocumentClick.bind(this);
        this._handleGlobalClick = this._handleGlobalClick.bind(this);
        this._handleGlobalKeydown = this._handleGlobalKeydown.bind(this);
        this._handleVisibleRangeChange = this._handleVisibleRangeChange.bind(this);
        
        this.init();
    }

    // TF-FIX #2: регистрируем слушатель с запоминанием — чтобы destroy() мог
    // снять его даже если он висел на статичном DOM-элементе
    _addListener(target, type, handler) {
        if (!target || typeof target.addEventListener !== 'function') return;
        target.addEventListener(type, handler);
        this._uiListeners.push({ target, type, handler });
    }

    _getInitialInterval() {
        const saved = localStorage.getItem('lastTimeframe');
        const defaultInterval = (typeof CONFIG !== 'undefined' && CONFIG.defaultInterval) ? CONFIG.defaultInterval : '15m';
        return (saved && (typeof TF_LABELS === 'undefined' || TF_LABELS[saved])) ? saved : defaultInterval;
    }

    _isValidTimeframe(tf) {
        return Boolean(tf && (typeof TF_LABELS === 'undefined' || TF_LABELS[tf]));
    }

    init() {
        this.updateInstrumentInfo();
        this.loadStarredTimeframes();
        this.setupEventListeners();
        this.setupControlButtons();
        
        this.timerManager.start(this.currentInterval);
        this.chartManager.setCurrentInterval(this.currentInterval);

        document.addEventListener('click', this._handleDocumentClick);
        document.addEventListener('click', this._handleGlobalClick);
        document.addEventListener('keydown', this._handleGlobalKeydown);

        // TF-FIX #4: обновляем информацию об инструменте, когда ChartManager
        // РЕАЛЬНО завершил смену символа/рынка (Alt+T, поиск по символу и т.д.)
        if (typeof this.chartManager?._subscribeToSymbolChange === 'function') {
            this._symbolChangeHandler = () => {
                if (this._destroyed) return;
                this.updateInstrumentInfo();
            };
            this.chartManager._subscribeToSymbolChange(this._symbolChangeHandler);
        }

        try {
            const timeScale = this.chartManager.chart?.timeScale?.();
            if (timeScale?.subscribeVisibleLogicalRangeChange) {
                this._timeScaleUnsubscribe = timeScale.subscribeVisibleLogicalRangeChange(
                    this._handleVisibleRangeChange
                );
            }
        } catch (e) {}
    }

    destroy() {
        // TF-FIX #8: флаг гасит отложенные rAF/колбэки
        this._destroyed = true;

        document.removeEventListener('click', this._handleDocumentClick);
        document.removeEventListener('click', this._handleGlobalClick);
        document.removeEventListener('keydown', this._handleGlobalKeydown);

        // TF-FIX #2: снимаем ВСЕ зарегистрированные UI-слушатели
        for (const { target, type, handler } of this._uiListeners) {
            try { target.removeEventListener(type, handler); } catch (e) {}
        }
        this._uiListeners = [];

        // TF-FIX #1: в lightweight-charts v4 subscribe... НЕ возвращает функцию
        // отписки — отписываемся парным unsubscribe... по тому же обработчику.
        // Старый путь (_timeScaleUnsubscribe как функция) сохранён на случай
        // альтернативной реализации timeScale.
        try {
            const timeScale = this.chartManager?.chart?.timeScale?.();
            if (timeScale?.unsubscribeVisibleLogicalRangeChange) {
                timeScale.unsubscribeVisibleLogicalRangeChange(this._handleVisibleRangeChange);
            }
        } catch (e) {}

        if (this._timeScaleUnsubscribe) {
            typeof this._timeScaleUnsubscribe === 'function' 
                ? this._timeScaleUnsubscribe() 
                : this._timeScaleUnsubscribe?.unsubscribe?.();
            this._timeScaleUnsubscribe = null;
        }

        // TF-FIX #8: API отписки от symbol change в ChartManager нет — колбэк
        // обнулён и защищён флагом _destroyed; ChartManager очистит список
        // колбэков в своём destroy().
        this._symbolChangeHandler = null;

        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
        
        if (this._saveTimeout) {
            cancelAnimationFrame(this._saveTimeout);
            this._saveTimeout = null;
        }
    }

    _handleVisibleRangeChange() {
        if (this._destroyed) return; // TF-FIX #8
        if (this._saveTimeout) cancelAnimationFrame(this._saveTimeout);
        this._saveTimeout = requestAnimationFrame(() => {
            this._saveTimeout = null;
            if (!this._destroyed) this.saveCurrentPosition();
        });
    }

    saveCurrentPosition() {
        // TF-FIX #3: защита от уничтоженного/неготового chart — раньше
        // this.chartManager.chart.timeScale() бросал TypeError на каждом rAF
        if (this._destroyed) return;

        const timeScale = this.chartManager?.chart?.timeScale?.();
        if (!timeScale?.getVisibleLogicalRange) return;

        let visibleRange = null;
        try {
            visibleRange = timeScale.getVisibleLogicalRange();
        } catch (e) { return; }

        const data = this.chartManager.chartData;
        
        if (visibleRange && data?.length > 0) {
            const fromIndex = Math.max(0, Math.floor(visibleRange.from));
            const toIndex = Math.min(data.length - 1, Math.ceil(visibleRange.to));
            
            if (fromIndex < toIndex) {
                const centerIndex = Math.floor((fromIndex + toIndex) / 2);
                this.savedCenterTime = data[centerIndex].time;
                this.savedTimeSpan = data[toIndex].time - data[fromIndex].time;
                // TF-FIX #9: запоминаем ШИРИНУ вьюпорта в барах — при
                // восстановлении позиции после смены ТФ сохраним тот же масштаб
                this.savedVisibleBars = Math.max(0, visibleRange.to - visibleRange.from);
            }
        }
    }

   // TF-FIX #6: параметр force — обязателен для вызова сразу после смены ТФ:
   // новый график всегда позиционируется у правого края, и прежний guard
   // «видна последняя свеча → не трогать» блокировал восстановление ВСЕГДА.
   restorePosition(force = false) {
    if (this._destroyed) return;
    if (!this.chartManager || !this.chartManager._isChartValid?.()) return;
    if (!this.savedCenterTime || !this.chartManager.chartData?.length) {
        return;
    }
    
    const data = this.chartManager.chartData;
    const timeScale = this.chartManager.chart?.timeScale?.();
    if (!timeScale) return;

    // TF-FIX #9: сохранённый центр должен попадать в диапазон НОВОГО датасета —
    // иначе не восстанавливаем ничего (иначе вьюпорт уезжал бы «в никуда»)
    const firstTime = data[0].time;
    const lastTime = data[data.length - 1].time;
    if (this.savedCenterTime < firstTime || this.savedCenterTime > lastTime) {
        return;
    }
    
    if (!force) {
        // Не перехватываем вьюпорт, если пользователь и так у последних свечей
        let currentRange = null;
        try { currentRange = timeScale.getVisibleLogicalRange(); } catch (e) {}

        if (currentRange) {
            const lastIndex = data.length - 1;
            if (currentRange.to >= lastIndex - 2) {
                return;
            }
        }
    }
    
    // TF-FIX #6б: удалена «приоритетная» ветвь с chartManager._savedLogicalRange:
    //   1) _savedWasViewingHistory в ChartManager не существует (мёртвый код);
    //   2) даже с _savedLogicalRange это ИНДЕКСЫ старого датасета — после смены
    //      ТФ/символа длина и шаг массива другие, позиция восстановилась бы криво.
    // Расчёт по абсолютному ВРЕМЕНИ ниже корректен между любыми датасетами.

    let left = 0, right = data.length - 1, centerIndex = -1;
    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (data[mid].time === this.savedCenterTime) { 
            centerIndex = mid; 
            break; 
        }
        data[mid].time < this.savedCenterTime ? left = mid + 1 : right = mid - 1;
    }
    
    if (centerIndex === -1) centerIndex = left;
    centerIndex = Math.max(0, Math.min(centerIndex, data.length - 1));

    // TF-FIX #9: TradingView-поведение — сохраняем ТО ЖЕ количество видимых
    // свечей, что было до переключения (прежний расчёт «радиуса» с клампом
    // 15..250 показывал ~36 свечей вместо прежних нескольких сотен —
    // «отрисовывает несколько свечей»).
    let from, to;

    if (this.savedVisibleBars > 2) {
        const half = this.savedVisibleBars / 2;
        from = Math.round(centerIndex - half);
        to = Math.round(centerIndex + half);
    } else {
        let radius = 40;
        if (this.savedTimeSpan > 0 && data.length > 1) {
            const avg = (data[data.length - 1].time - data[0].time) / (data.length - 1);
            if (avg > 0) {
                radius = Math.round((this.savedTimeSpan / 2) / avg);
                radius = Math.max(15, Math.min(radius, 250));
            }
        }

        const padding = Math.max(3, Math.floor(radius * 0.15));
        from = centerIndex - radius - padding;
        to = centerIndex + radius + padding;

        if (to - from < radius * 1.5) {
            from = to - radius * 1.5;
        }
    }

    from = Math.max(0, Math.floor(from));
    to = Math.min(data.length - 1 + 25, Math.ceil(to)); // +25 — штатный rightOffset

    if (from < to) {
        try {
            timeScale.setVisibleLogicalRange({ from, to });
        } catch (e) {
            console.warn('⚠️ Ошибка при установке видимого диапазона:', e);
        }
    }
}

    setupEventListeners() {
        // TF-FIX #2: все слушатели регистрируются через _addListener —
        // destroy() сможет их снять (анонимные слушатели на статичных DOM-
        // элементах при пересоздании менеджера накапливались: клик по
        // заголовку toggles-овал панель несколько раз — при чётном количестве
        // панель выглядела «сломанной»).
        const header = document.getElementById('timeframeHeader');
        if (header) {
            this._addListener(header, 'click', (e) => {
                if (!e.target.classList.contains('tf-star')) {
                    document.getElementById('timeframePanel')?.classList.toggle('expanded');
                }
            });
        }

        document.querySelectorAll('.timeframe-item').forEach(item => {
            this._addListener(item, 'click', (e) => {
                if (e.target.classList.contains('tf-star')) return;
                this.switchToTimeframe(item.dataset.tf);
            });
        });

        const copyBtn = document.getElementById('copyPairButton');
        if (copyBtn) {
            this._addListener(copyBtn, 'click', (e) => {
                e.stopPropagation();
                this.copyToClipboard();
            });
        }

        const candleBtn = document.getElementById('candleBtn');
        const barBtn = document.getElementById('barBtn');

        if (candleBtn) {
            this._addListener(candleBtn, 'click', () => {
                candleBtn.classList.add('active');
                barBtn?.classList.remove('active');
                this.chartManager.setChartType('candle');
            });
        }
        if (barBtn) {
            this._addListener(barBtn, 'click', () => {
                barBtn.classList.add('active');
                candleBtn?.classList.remove('active');
                this.chartManager.setChartType('bar');
            });
        }
    }

    setupControlButtons() {
        const scrollBtn = document.getElementById('scrollToLastCandleButton');
        if (scrollBtn) {
            this._addListener(scrollBtn, 'click', (e) => {
                e.stopPropagation();
                this.scrollToLastCandle();
            });
        }

        const autoScaleBtn = document.getElementById('autoScaleButton');
        if (autoScaleBtn) {
            this._addListener(autoScaleBtn, 'click', (e) => {
                e.stopPropagation();
                this.autoScaleChart();
            });
        }
    }

    _handleDocumentClick(event) {
        const panel = document.getElementById('timeframePanel');
        if (panel?.classList.contains('expanded') && !panel.contains(event.target)) {
            panel.classList.remove('expanded');
        }
    }

    _handleGlobalClick(event) {
        if (event.target.classList.contains('tf-star')) {
            event.stopPropagation();
            event.target.classList.toggle('starred');
            this.saveStarredTimeframes();
        }
    }

    _handleGlobalKeydown(event) {
        if (event.altKey && event.key === 't') {
            event.preventDefault();
            const newType = this.chartManager.currentMarketType === 'futures' ? 'spot' : 'futures';

            // TF-FIX #4: switchSymbol — АСИНХРОННЫЙ (поля currentMarketType и
            // пр. меняются в середине процесса). Прежний синхронный вызов
            // updateInstrumentInfo() показывал устаревший PERP/SPOT. Теперь:
            //   1) подписка на _notifySymbolChange (init) обновит бейдж, когда
            //      поля реально изменятся;
            //   2) плюс обновляемся после resolve — на случай очереди
            //      переключений, где notify сработает позже.
            const result = this.chartManager.switchSymbol(
                this.chartManager.currentSymbol, this.chartManager.currentExchange, newType
            );

            Promise.resolve(result).then(() => {
                if (!this._destroyed) this.updateInstrumentInfo();
            }).catch(() => {});

            this.updateInstrumentInfo();
        }
    }

  async switchToTimeframe(tf) {
    if (!this._isValidTimeframe(tf) || tf === this.currentInterval) return;

    if (this._abortController) {
        this._abortController.abort();
        console.log('🛑 Предыдущее переключение таймфрейма отменено');
    }

    this._abortController = new AbortController();
    const { signal } = this._abortController;

    console.log('🔄 Переключение на таймфрейм:', tf);

    this.saveCurrentPosition();

    document.querySelectorAll('.timeframe-item').forEach(i => {
        i.classList.toggle('active', i.dataset.tf === tf);
    });
    document.getElementById('timeframePanel')?.classList.remove('expanded');
    this._updateCurrentTfBadge(tf);

    const previousInterval = this.currentInterval;

    // TF-FIX #5 (уточнён): «пользователь в истории» определяем по ФАКТИЧЕСКОМУ
    // вьюпорту, а не по флагу chartManager._isViewingHistory — флаг
    // проставляется на каждое событие диапазона и в переходные моменты
    // (перестроение данных) может быть ложно true → «скачки» после каждого
    // переключения. Порог 5 баров: пользователь у правого края (штатный
    // rightOffset=25) НИКОГДА не считается «в истории».
    const wasViewingHistory = (() => {
        try {
            const ts = this.chartManager.chart?.timeScale?.();
            const range = ts?.getVisibleLogicalRange?.();
            const data = this.chartManager.chartData;
            if (!range || !data || data.length === 0) return false;
            return range.to < (data.length - 1) - 5;
        } catch (e) { return false; }
    })();

    try {
        await this.chartManager.switchInterval(tf);

        if (signal.aborted) {
            console.log('🛑 Переключение отменено после switchInterval');
            return;
        }

        this.currentInterval = tf;
        localStorage.setItem('lastTimeframe', tf);
        this.chartManager.setCurrentInterval(tf);

        if (this.wsManager?.updateSymbolAndTimeframe) {
            this.wsManager.updateSymbolAndTimeframe(
                this.chartManager.currentSymbol, tf,
                this.chartManager.currentExchange,
                this.chartManager.currentMarketType
            );
        }

        this.timerManager.start(tf);
        
        requestAnimationFrame(() => {
            if (this.timerManager) {
                const price = this.chartManager.currentRealPrice 
                    ?? this.chartManager.lastCandle?.close;
                if (price != null) {
                    this.timerManager.updatePrice(price);
                }
                if (this.chartManager._applyPriceScaleWidth) {
                    this.chartManager._applyPriceScaleWidth();
                }
            }
        });
        
        this.chartManager.autoScale();

        // TF-FIX #9: восстановление позиции — только если пользователь ДЕЙСТВИТЕЛЬНО
        // был в истории (по фактическому вьюпорту), и под той же затемняющей
        // подложкой, что используется при смене символа — никаких «голых»
        // скачков вьюпорта. Сохраняются центр по времени и количество видимых
        // свечей (TradingView-стиль).
        if (wasViewingHistory) {
            this.chartManager._showSymbolSwitchOverlay?.();
            this.restorePosition(true);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    this.chartManager._hideSymbolSwitchOverlay?.();
                });
            });
        }

        requestAnimationFrame(() => {
            window.rayManager?.syncWithNewTimeframe();
            window.trendLineManager?.syncWithNewTimeframe();
            window.rulerLineManager?.syncWithNewTimeframe();
            window.alertLineManager?.syncWithNewTimeframe();
            window.textManager?.syncWithNewTimeframe();
        });

        console.log('✅ Таймфрейм переключен:', tf);

    } catch (error) {
        if (error.name === 'AbortError' || signal?.aborted) {
            console.log('🛑 Переключение отменено (AbortError)');
            return;
        }
        console.error('❌ Ошибка при переключении:', error);
        this._rollbackTimeframe(previousInterval);
    } finally {
        if (this._abortController?.signal === signal) {
            this._abortController = null;
        }
        this.updateInstrumentInfo();
        this.loadStarredTimeframes();
    }
}

    _rollbackTimeframe(previousInterval) {
        this.currentInterval = previousInterval;
        this.chartManager.setCurrentInterval(previousInterval);
        this._updateCurrentTfBadge(previousInterval);
        
        if (this.wsManager?.updateSymbolAndTimeframe) {
            this.wsManager.updateSymbolAndTimeframe(
                this.chartManager.currentSymbol, previousInterval,
                this.chartManager.currentExchange,
                this.chartManager.currentMarketType
            );
        }
        
        document.querySelectorAll('.timeframe-item').forEach(i => {
            i.classList.toggle('active', i.dataset.tf === previousInterval);
        });
    }

    _updateCurrentTfBadge(tf) {
        const badge = document.getElementById('currentTfBadge');
        if (badge) {
            const label = (typeof TF_LABELS !== 'undefined' ? TF_LABELS[tf] : null) || tf;
            badge.textContent = label;
        }
    }

    updateInstrumentInfo() {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('pairDisplay', this.chartManager.currentSymbol);
        set('contractTypeDisplay', this.chartManager.currentMarketType === 'futures' ? 'PERP' : 'SPOT');
        set('exchangeDisplay', this.chartManager.currentExchange === 'binance' ? 'Binance' : 'Bybit');
        set('currentTfBadge', (typeof TF_LABELS !== 'undefined' ? TF_LABELS[this.currentInterval] : null) || this.currentInterval);
    }

    scrollToLastCandle() { this.chartManager?.scrollToLast(); }
    autoScaleChart() { this.chartManager?.autoScale(); }

    copyToClipboard() {
        const btn = document.getElementById('copyPairButton');
        const text = this.chartManager.currentSymbol;
        if (!text) return;

        const done = () => {
            if (btn) {
                btn.classList.add('copied');
                setTimeout(() => btn.classList.remove('copied'), 1000);
            }
        };

        // TF-FIX #7: прежняя запись
        //   navigator.clipboard?.writeText(text).then(done).catch(fallback)
        // при отсутствии clipboard API (http/небезопасный контекст/старый
        // браузер) КОРОТИЛА всю цепочку — .catch с fallback на execCommand не
        // выполнялся никогда, и кнопка копирования молча не работала.
        // Теперь ветви явные.
        const legacyCopy = () => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); done(); } catch (e) {}
            document.body.removeChild(ta);
        };

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(text).then(done).catch(legacyCopy);
        } else {
            legacyCopy();
        }
    }

    loadStarredTimeframes() {
        const starred = JSON.parse(localStorage.getItem('starredTimeframes') || '[]');
        document.querySelectorAll('.tf-star').forEach(s => {
            s.classList.toggle('starred', starred.includes(s.dataset.tf));
        });
        this.updateStarredDisplay(starred);
    }

    saveStarredTimeframes() {
        const starred = Array.from(document.querySelectorAll('.tf-star.starred'), s => s.dataset.tf);
        localStorage.setItem('starredTimeframes', JSON.stringify(starred));
        this.updateStarredDisplay(starred);
    }

    updateStarredDisplay(starred) {
        const container = document.getElementById('starredTimeframes');
        if (!container) return;
        container.innerHTML = '';
        starred.forEach(tf => {
            const label = (typeof TF_LABELS !== 'undefined' ? TF_LABELS[tf] : null) || tf;
            const item = document.createElement('div');
            item.className = 'starred-item' + (tf === this.currentInterval ? ' active' : '');
            item.dataset.tf = tf;
            item.innerHTML = `<span class="tf-name">${label}</span>`;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.switchToTimeframe(tf);
            });
            container.appendChild(item);
        });
    }
}

if (typeof window !== 'undefined') {
    window.TimeframeManager = TimeframeManager;
}
