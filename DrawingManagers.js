class HorizontalRayManager {
    constructor(chartManager) {
        this._pixelRatio = window.devicePixelRatio || 1;
        this._rays = [];
        this._chartManager = chartManager;
        this._selectedRay = null;
        this._hoveredRay = null;
        this._isDrawingMode = false;
        this._magnetEnabled = true;
        this._isDragging = false;
        this._dragRay = null;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._dragStartPrice = 0;
        this._dragStartTime = 0;
        this._lastMouseX = 0;
        this._lastMouseY = 0;
        this._potentialDrag = null;
        this._dragThreshold = 5;
        this._needsRedraw = false;
        this._currentSymbolKey = this._getCurrentSymbolKey();
        this._isLoading = false;
        this._handleDblClick = this._handleDblClickFn.bind(this);
        
        // ✅ КЭШ ДЛЯ ФИЛЬТРАЦИИ
        this._raysCache = null;
        this._raysCacheKey = null;
        
        // ✅ rAF THROTTLE ТОЛЬКО ДЛЯ HOVER
        this._pendingHoverEvent = null;
        this._hoverRafId = null;
        
        this._handleGlobalMouseUp = this._handleGlobalMouseUp.bind(this);
        window.addEventListener('mouseup', this._handleGlobalMouseUp);
        
        // ✅ Регистрируем в координаторе
        window.drawingLoaderCoordinator.register(this, 'ray');
        
        setTimeout(async () => {
            try {
                if (!window.dbReady) {
                    await new Promise(resolve => {
                        const check = () => {
                            if (window.dbReady) resolve();
                            else setTimeout(check, 50);
                        };
                        check();
                    });
                }
                console.log('🚀 Auto-loading rays...');
                await this.loadRays();
                console.log('✅ Rays auto-loaded successfully');
            } catch (error) {
                console.error('❌ Auto-load rays failed:', error);
            }
        }, 150);
    }

    // ✅ КЭШИРОВАННЫЙ МЕТОД
    _getRaysForCurrentSymbol() {
        const currentKey = this._getCurrentSymbolKey();
        if (this._raysCacheKey === currentKey && this._raysCache) return this._raysCache;
        this._raysCacheKey = currentKey;
        this._raysCache = this._rays.filter(item => item.ray.symbolKey === currentKey);
        return this._raysCache;
    }
    
    // ✅ ИНВАЛИДАЦИЯ КЭША
    _invalidateRaysCache() {
        this._raysCache = null;
        this._raysCacheKey = null;
    }

    async loadFromData(symbolKey, rayRecords) {
        if (this._getCurrentSymbolKey() !== symbolKey) {
            console.warn('⏹️ Symbol changed during load, aborting');
            return;
        }

        try {
            const series = this._chartManager.currentChartType === 'candle' 
                ? this._chartManager.candleSeries 
                : this._chartManager.barSeries;

            if (!series) {
                console.warn('Series not ready for rays, skipping');
                return;
            }

            const ALL_TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '1d', '1w', '1M'];
            const defaultVisibility = {};
            ALL_TFS.forEach(tf => { defaultVisibility[tf] = true; });

            const existingIds = new Set(
                this._rays
                    .filter(item => item.ray.symbolKey === symbolKey)
                    .map(item => item.ray.id)
            );
            
            const newRecordIds = new Set(rayRecords.map(r => r.id));
            
            const toDetach = this._rays.filter(item => 
                item.ray.symbolKey === symbolKey && !newRecordIds.has(item.ray.id)
            );
            
            for (const item of toDetach) {
                try { 
                    if (item.series && item.primitive) {
                        item.series.detachPrimitive(item.primitive); 
                    }
                } catch(e) {}
            }
            
            this._rays = this._rays.filter(item => 
                item.ray.symbolKey !== symbolKey || newRecordIds.has(item.ray.id)
            );
            this._invalidateRaysCache();

            const newRays = [];
            
            for (const rec of rayRecords) {
                try {
                    const existing = this._rays.find(item => item.ray.id === rec.id);
                    
                    if (existing) {
                        existing.ray.price = rec.data.price;
                        existing.ray.time = rec.data.time;
                        existing.ray.anchorTime = rec.data.anchorTime;
                        existing.ray.options = { ...existing.ray.options, ...rec.data.options };
                        existing.ray.timeframeVisibility = { ...defaultVisibility, ...(rec.data.timeframeVisibility || {}) };
                        existing.ray.anchorCandle = rec.data.anchorCandle;
                        continue;
                    }

                    const ray = new HorizontalRay(rec.data.price, rec.data.time, rec.data.options);
                    ray.id = rec.id;
                    ray.anchorTime = rec.data.anchorTime;
                    ray.timeframeVisibility = { ...defaultVisibility, ...(rec.data.timeframeVisibility || {}) };
                    ray.anchorCandle = rec.data.anchorCandle;
                    ray.symbolKey = rec.symbolKey;

                    const primitive = new HorizontalRayPrimitive(ray, this._chartManager);
                    series.attachPrimitive(primitive);
                    newRays.push({ ray, primitive, series });
                } catch (e) {
                    console.warn('Failed to attach ray:', rec.id, e);
                }
            }

            this._rays.push(...newRays);
            this._invalidateRaysCache();
            this._requestRedraw();
            
            console.log(`✅ Loaded ${rayRecords.length} rays for ${symbolKey}`);
            
        } catch (error) {
            console.error('❌ loadFromData failed:', error);
            throw error;
        }
    }

    _toBitmapCoords(cssX, cssY) {
        return { x: cssX * this._pixelRatio, y: cssY * this._pixelRatio };
    }

    _getCurrentSymbolKey() {
        const symbol = this._chartManager.currentSymbol || 'BTCUSDT';
        const exchange = this._chartManager.currentExchange || 'binance';
        const marketType = this._chartManager.currentMarketType || 'futures';
        return `${symbol}:${exchange}:${marketType}`;
    }

    _handleGlobalMouseUp(e) {
        if (!this._isDragging) return;
        
        this._isDragging = false;
        this._potentialDrag = null;

        if (this._dragRay) {
            this._dragRay.dragging = false;
            this._dragRay.attached = false;
            
            const newAnchor = this._findClosestCandleTime(this._dragRay.time);
            if (newAnchor) this._dragRay.anchorTime = newAnchor;
            
            this._saveRays();
            this._dragRay = null;
            this._requestRedraw();
        }
        
        this._chartManager.chartContainer.style.cursor = 'crosshair';
    }

    _setupHotkeys() {
        document.addEventListener('keydown', (e) => {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
            
            if (e.code === 'KeyH' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                const newState = !this._isDrawingMode;
                this.setDrawingMode(newState);
                if (window.trendLineManager && newState) window.trendLineManager.setDrawingMode(false);
                if (window.rulerLineManager && newState) window.rulerLineManager.setDrawingMode(false);
                if (window.alertLineManager && newState) window.alertLineManager.setDrawingMode(false);
                if (window.textManager && newState) window.textManager.setDrawingMode(false);
                console.log(`Горизонтальный луч ${newState ? 'включён' : 'выключён'}`);
            }
            
            if (e.key === 'Delete' && this._selectedRay && this._selectedRay.readyToDrag === true) {
                e.preventDefault();
                this.deleteRay(this._selectedRay.id);
                this._selectedRay = null;
            }
        });
    }

    _handleContextMenu(e) {
        e.preventDefault();
        e.stopPropagation();

        const rect = this._chartManager.chartContainer.getBoundingClientRect();
        const { x, y } = this._toBitmapCoords(e.clientX - rect.left, e.clientY - rect.top);
        
        const hit = this.hitTest(x, y);

        if (hit) {
            if (this._selectedRay && this._selectedRay !== hit.ray) {
                this._selectedRay.selected = false;
                this._selectedRay.showDragPoint = false;
                this._selectedRay.attached = false;
            }

            hit.ray.selected = true;
            hit.ray.attached = false;

            let rayX = this._chartManager.timeToCoordinate(hit.ray.time);
            let rayY = this._chartManager.priceToCoordinate(hit.ray.price);
            
            if (rayX !== null && rayY !== null) {
                hit.ray.dragPointX = rayX * this._pixelRatio;
                hit.ray.dragPointY = rayY * this._pixelRatio;
            }

            this._selectedRay = hit.ray;
            this._requestRedraw();
            
            const menu = document.getElementById('drawingContextMenu');
            if (menu) {
                document.getElementById('trendContextMenu').style.display = 'none';
                document.getElementById('alertContextMenu').style.display = 'none';
                
                menu.style.display = 'flex';
                menu.style.left = e.clientX + 'px';
                menu.style.top = e.clientY + 'px';
                
                const copyBtn = document.getElementById('contextCopyBtn');
                const newCopyBtn = copyBtn.cloneNode(true);
                copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
                newCopyBtn.onclick = (event) => {
                    event.stopPropagation();
                    const priceText = Utils.formatPrice(hit.ray.price);
                    navigator.clipboard?.writeText(priceText);
                    menu.style.display = 'none';
                };
                
                const settingsBtn = document.getElementById('contextSettingsBtn');
                const newSettingsBtn = settingsBtn.cloneNode(true);
                settingsBtn.parentNode.replaceChild(newSettingsBtn, settingsBtn);
                newSettingsBtn.onclick = (event) => {
                    event.stopPropagation();
                    this._showSettings(hit.ray);
                    menu.style.display = 'none';
                };
                
                const deleteBtn = document.getElementById('contextDeleteBtn');
                const newDeleteBtn = deleteBtn.cloneNode(true);
                deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
                newDeleteBtn.onclick = (event) => {
                    event.stopPropagation();
                    this.deleteRay(hit.ray.id);
                    menu.style.display = 'none';
                };
            }
        } else {
            const menu = document.getElementById('drawingContextMenu');
            if (menu) menu.style.display = 'none';
        }
    }

    _setupEventListeners() {
        const container = this._chartManager.chartContainer;
        
        container.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;

            const rect = container.getBoundingClientRect();
            const { x, y } = this._toBitmapCoords(e.clientX - rect.left, e.clientY - rect.top);
            const hit = this.hitTest(x, y);
            if (hit) {
                e.preventDefault();
                e.stopPropagation();

                if (this._selectedRay && this._selectedRay === hit.ray) {
                    if (!hit.ray.readyToDrag) {
                        hit.ray.readyToDrag = true;
                        hit.ray.showDragPoint = true;
                    }
                } else {
                    if (this._selectedRay) {
                        this._selectedRay.selected = false;
                        this._selectedRay.showDragPoint = false;
                        this._selectedRay.readyToDrag = false;
                        this._selectedRay.attached = false;
                    }
                    hit.ray.selected = true;
                    hit.ray.attached = true;
                    hit.ray.readyToDrag = false;
                    this._selectedRay = hit.ray;
                }

                let rayX = this._chartManager.timeToCoordinate(hit.ray.time);
                let rayY = this._chartManager.priceToCoordinate(hit.ray.price);
                if (rayX !== null && rayY !== null) {
                    hit.ray.dragPointX = rayX * this._pixelRatio;
                    hit.ray.dragPointY = rayY * this._pixelRatio;
                }

                if (hit.ray.readyToDrag) {
                    this._potentialDrag = {
                        ray: hit.ray,
                        startX: x,
                        startY: y,
                        startPrice: hit.ray.price,
                        startTime: hit.ray.time
                    };
                }

                this._requestRedraw();
            } else {
                const rayMenu = document.getElementById('drawingContextMenu');
                if (rayMenu && rayMenu.style.display === 'flex') {
                    const menuRect = rayMenu.getBoundingClientRect();
                    const isClickInsideMenu = 
                        e.clientX >= menuRect.left && e.clientX <= menuRect.right &&
                        e.clientY >= menuRect.top && e.clientY <= menuRect.bottom;
                    if (isClickInsideMenu) return;
                }

                if (this._dragRay) {
                    this._dragRay.selected = false;
                    this._dragRay.showDragPoint = false;
                    this._dragRay.readyToDrag = false;
                    this._dragRay.attached = false;
                    this._dragRay = null;
                }
                if (this._selectedRay) {
                    this._selectedRay.selected = false;
                    this._selectedRay.showDragPoint = false;
                    this._selectedRay.readyToDrag = false;
                    this._selectedRay.attached = false;
                    this._selectedRay = null;
                }
                
                if (rayMenu) rayMenu.style.display = 'none';
                
                this._requestRedraw();
            }
        });

        // ✅ MOUSEMOVE: ДРАГ синхронно, HOVER через rAF
        container.addEventListener('mousemove', (e) => {
            const rect = container.getBoundingClientRect();
            const cssX = e.clientX - rect.left;
            const cssY = e.clientY - rect.top;
            
            this._lastMouseX = cssX;
            this._lastMouseY = cssY;

            const { x: bmX, y: bmY } = this._toBitmapCoords(cssX, cssY);

            // ========== ДРАГ (синхронно, с preventDefault) ==========
            if (this._potentialDrag && !this._isDragging) {
                const dx = Math.abs(bmX - this._potentialDrag.startX);
                const dy = Math.abs(bmY - this._potentialDrag.startY);

                if (dx > this._dragThreshold || dy > this._dragThreshold) {
                    e.preventDefault();
                    e.stopPropagation();
                    this._isDragging = true;
                    this._dragRay = this._potentialDrag.ray;
                    this._dragRay.dragging = true;

                    this._dragStartX = this._potentialDrag.startX;
                    this._dragStartY = this._potentialDrag.startY;
                    this._dragStartPrice = this._potentialDrag.startPrice;
                    this._dragStartTime = this._potentialDrag.startTime;

                    container.style.cursor = 'grabbing';
                }
            }

            if (this._isDragging && this._dragRay) {
                e.preventDefault();
                e.stopPropagation();
                
                const deltaX = (bmX - this._dragStartX) / this._pixelRatio;
                const deltaY = (bmY - this._dragStartY) / this._pixelRatio;

                const rayX = this._chartManager.timeToCoordinate(this._dragStartTime);
                const rayY = this._chartManager.priceToCoordinate(this._dragStartPrice);

                if (rayX !== null && rayY !== null) {
                    const newX = rayX + deltaX;
                    const newY = rayY + deltaY;

                    const newPrice = this._chartManager.coordinateToPrice(newY);
                    const newTime = this._chartManager.coordinateToTime(newX);

                    if (newPrice !== null) {
                        this._dragRay.price = newPrice;
                    }
                    if (newTime !== null) {
                        this._dragRay.time = newTime;
                        this._dragRay.anchorTime = newTime;
                    }
                    
                    const newRayX = this._chartManager.timeToCoordinate(this._dragRay.time);
                    const newRayY = this._chartManager.priceToCoordinate(this._dragRay.price);

                    if (newRayX !== null && newRayY !== null) {
                        this._dragRay.dragPointX = newRayX;
                        this._dragRay.dragPointY = newRayY;
                    }

                    this._requestRedraw();
                }
                return; // Не идём в hover
            }

            // ========== HOVER (через rAF, без preventDefault) ==========
            if (this._chartManager._isScrolling || this._chartManager._isScrollingFast) {
                if (this._hoveredRay) {
                    this._hoveredRay.hovered = false;
                    this._hoveredRay = null;
                    this._requestRedraw();
                }
                return;
            }

            this._pendingHoverEvent = { bmX, bmY };
            if (this._hoverRafId) return;
            
            this._hoverRafId = requestAnimationFrame(() => {
                this._hoverRafId = null;
                this._processHover(this._pendingHoverEvent);
            });
        });

        container.addEventListener('mouseup', (e) => {
            this._potentialDrag = null;

            if (this._isDragging) {
                e.preventDefault();
                e.stopPropagation();

                this._isDragging = false;
                if (this._dragRay) {
                    this._dragRay.dragging = false;
                    this._dragRay.attached = false;
                    
                    const newAnchor = this._findClosestCandleTime(this._dragRay.time);
                    if (newAnchor) {
                        this._dragRay.anchorTime = newAnchor;
                    }
                    
                    this._saveRays();
                    this._dragRay = null;
                    this._requestRedraw();
                }

                container.style.cursor = 'crosshair';

                setTimeout(() => {
                    const moveEvent = new MouseEvent('mousemove', {
                        clientX: e.clientX,
                        clientY: e.clientY
                    });
                    container.dispatchEvent(moveEvent);
                }, 10);
            }
        });

        container.addEventListener('mouseleave', () => {
            if (this._hoveredRay) {
                this._hoveredRay.hovered = false;
                this._hoveredRay = null;
                this._requestRedraw();
            }
            container.style.cursor = 'crosshair';
            
            if (this._hoverRafId) {
                cancelAnimationFrame(this._hoverRafId);
                this._hoverRafId = null;
            }
            this._pendingHoverEvent = null;
        });

        container.addEventListener('click', (e) => {
            if (this._isDragging) {
                e.preventDefault();
                e.stopPropagation();
            }
            if (this._isDrawingMode) {
                this._handleChartClick(e);
            }
        });

        container.addEventListener('contextmenu', (e) => {
            this._handleContextMenu(e);
        });
    }

    // ✅ HOVER — только hover, без preventDefault
    _processHover({ bmX, bmY }) {
        const container = this._chartManager.chartContainer;
        const raysForCurrent = this._getRaysForCurrentSymbol();
        let hit = null;
        
        for (const item of raysForCurrent) {
            if (!item.primitive || !item.primitive._paneView || !item.primitive._paneView._renderer) continue;
            const hitType = item.primitive._paneView._renderer.hitTest(bmX, bmY);
            if (hitType) {
                hit = { ray: item.ray, type: hitType };
                break;
            }
        }
        
        const hitRay = hit ? hit.ray : null;

        if (hitRay) {
            container.style.cursor = hitRay.readyToDrag ? 'grab' : 'default';
        } else {
            container.style.cursor = 'crosshair';
        }

        if (this._hoveredRay !== hitRay) {
            if (this._hoveredRay) {
                this._hoveredRay.hovered = false;
            }
            this._hoveredRay = hitRay;
            if (hitRay) {
                hitRay.hovered = true;
            }
            this._requestRedraw();
        }
    }

    setDrawingMode(enabled) {
        this._isDrawingMode = enabled;
        
        const rayBtn = document.getElementById('toolHorizontalRay');
        if (rayBtn) {
            if (enabled) {
                rayBtn.style.background = '#4A90E2';
                rayBtn.style.color = '#FFFFFF';
                rayBtn.classList.add('active');
            } else {
                rayBtn.style.background = '';
                rayBtn.style.color = '';
                rayBtn.classList.remove('active');
            }
        }
    }

    setMagnetEnabled(enabled) {
        this._magnetEnabled = enabled;
        const magnetBtn = document.getElementById('toolMagnet');
        if (magnetBtn) {
            if (enabled) {
                magnetBtn.style.background = '#4A90E2';
                magnetBtn.style.color = '#FFFFFF';
                magnetBtn.classList.add('magnet-active');
            } else {
                magnetBtn.style.background = '';
                magnetBtn.style.color = '';
                magnetBtn.classList.remove('magnet-active');
            }
        }
    }

    createRay(price, time, options = {}) {
        const defaultVisibility = {
            '1m': true, '3m': true, '5m': true, '15m': true, '30m': true,
            '1h': true, '4h': true, '6h': true, '12h': true,
            '1d': true, '1w': true, '1M': true
        };
        
        const timeframeVisibility = options.timeframeVisibility || defaultVisibility;
        
        const ray = new HorizontalRay(price, time, options);
        ray.timeframeVisibility = timeframeVisibility;
        ray.anchorTime = time;
        if (options.anchorCandle) {
            ray.anchorCandle = { ...options.anchorCandle };
        }
        
        ray.symbolKey = this._getCurrentSymbolKey();
        ray.symbol = this._chartManager.currentSymbol;
        ray.exchange = this._chartManager.currentExchange;
        ray.marketType = this._chartManager.currentMarketType;
        
        const primitive = new HorizontalRayPrimitive(ray, this._chartManager);
        const series = this._chartManager.currentChartType === 'candle' 
            ? this._chartManager.candleSeries 
            : this._chartManager.barSeries;
        series.attachPrimitive(primitive);
        this._rays.push({ ray, primitive, series });
        this._invalidateRaysCache();
        this._saveRays();
        return ray;
    }
    
    deleteRay(rayId) {
        console.log('🗑️ Удаление луча:', rayId);
        
        const index = this._rays.findIndex(r => r.ray.id === rayId);
        if (index !== -1) {
            const { primitive, series, ray } = this._rays[index];
            
            window.db.delete('drawings', rayId).catch(e => console.warn(e));
            
            try { 
                if (series && primitive) {
                    series.detachPrimitive(primitive); 
                }
            } catch (e) {
                console.warn('Ошибка при detach:', e);
            }
            this._rays.splice(index, 1);
            this._invalidateRaysCache();
            
            if (this._selectedRay && this._selectedRay.id === rayId) {
                this._selectedRay = null;
            }
            if (this._dragRay && this._dragRay.id === rayId) {
                this._dragRay = null;
            }
            
            this._saveRays();
            this._requestRedraw();
            
            const menu = document.getElementById('drawingContextMenu');
            if (menu) menu.style.display = 'none';
            
            return true;
        } else {
            console.warn('Луч не найден:', rayId);
            return false;
        }
    }

    deleteAllRays() {
        const currentKey = this._getCurrentSymbolKey();
        const raysToDelete = this._rays.filter(item => item.ray.symbolKey === currentKey);
        
        for (const item of raysToDelete) {
            window.db.delete('drawings', item.ray.id).catch(e => console.warn(e));
        }
        
        raysToDelete.forEach(({ primitive, series }) => {
            try { 
                if (series && primitive) {
                    series.detachPrimitive(primitive); 
                }
            } catch(e) {}
        });
        
        this._rays = this._rays.filter(item => item.ray.symbolKey !== currentKey);
        this._invalidateRaysCache();
        
        if (this._selectedRay && this._selectedRay.symbolKey === currentKey) {
            this._selectedRay = null;
        }
        if (this._dragRay && this._dragRay.symbolKey === currentKey) {
            this._dragRay = null;
        }
        
        this._saveRays();
        this._requestRedraw();
    }
    
    _detachAllPrimitivesForSymbol(symbolKey) {
        const itemsForSymbol = this._rays.filter(item => item.ray.symbolKey === symbolKey);
        for (const item of itemsForSymbol) {
            if (item.primitive && item.series) {
                try { 
                    item.series.detachPrimitive(item.primitive); 
                } catch(e) {}
            }
        }
        this._rays = this._rays.filter(item => item.ray.symbolKey !== symbolKey);
        this._invalidateRaysCache();
    }
    
    hitTest(x, y) {
        const raysForCurrent = this._getRaysForCurrentSymbol();
        
        if (this._selectedRay) {
            const selItem = raysForCurrent.find(item => item.ray === this._selectedRay);
            if (selItem && selItem.primitive?._paneView?._renderer) {
                const hit = selItem.primitive._paneView._renderer.hitTest(x, y);
                if (hit) return { ray: this._selectedRay, type: hit.type, distance: hit.distance };
            }
        }
        
        let bestHit = null;
        let bestDistance = Infinity;
        
        for (const item of raysForCurrent) {
            if (!item.primitive?._paneView?._renderer) continue;
            if (item.ray === this._selectedRay) continue;
            
            const hit = item.primitive._paneView._renderer.hitTest(x, y);
            
            if (hit && hit.distance !== undefined && hit.distance < bestDistance) {
                bestHit = { ray: item.ray, type: hit.type, distance: hit.distance };
                bestDistance = hit.distance;
            }
        }
        
        return bestHit;
    }
    
    _handleChartClick(event) {
        if (!this._isDrawingMode) return;
        
        const rect = this._chartManager.chartContainer.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        let price = this._chartManager.coordinateToPrice(y);
        let time = this._chartManager.coordinateToTime(x);
        let anchorCandle = null;
        
        if (price === null || time === null) {
            const lastCandle = this._chartManager.getLastCandle();
            if (lastCandle) {
                price = lastCandle.close;
                time = lastCandle.time;
            } else {
                return;
            }
        }
        
        if (this._magnetEnabled) {
            const snapped = this._snapToPrice(price, time);
            price = snapped.price;
            time = snapped.time;
            anchorCandle = snapped.anchorCandle;
        }
        
        this.createRay(price, time, {
            color: document.getElementById('currentColorBox')?.style.backgroundColor || '#0933e2',
            lineWidth: parseInt(document.getElementById('settingThickness')?.value) || 2,
            lineStyle: document.getElementById('templateSelect')?.value || 'solid',
            opacity: parseInt(document.getElementById('colorOpacity')?.value) / 100 || 0.9,
            showPrice: true,
            anchorCandle: anchorCandle
        });
        
        this.setDrawingMode(false);
    }
    
    _snapToPrice(price, time) {
        if (!this._chartManager.chartData.length) return { price, time, anchorCandle: null };
        
        const data = this._chartManager.chartData;
        
        let closestCandle = data[0];
        let minTimeDiff = Math.abs(data[0].time - time);
        for (let i = 1; i < data.length; i++) {
            const diff = Math.abs(data[i].time - time);
            if (diff < minTimeDiff) { 
                minTimeDiff = diff; 
                closestCandle = data[i]; 
            }
        }
        
        const priceY = this._chartManager.priceToCoordinate(price);
        const highY = this._chartManager.priceToCoordinate(closestCandle.high);
        const lowY = this._chartManager.priceToCoordinate(closestCandle.low);
        const closeY = this._chartManager.priceToCoordinate(closestCandle.close);
        
        if (priceY === null || highY === null) return { price, time, anchorCandle: null };
        
        const dHighPx = Math.abs(highY - priceY);
        const dLowPx = Math.abs(lowY - priceY);
        const dClosePx = Math.abs(closeY - priceY);
        
        let snappedPrice = price;
        let anchorType = null;
        const MAGNET_THRESHOLD = 150;
        
        const minDistPx = Math.min(dHighPx, dLowPx, dClosePx);
        
        if (minDistPx < MAGNET_THRESHOLD) {
            if (minDistPx === dHighPx) {
                snappedPrice = closestCandle.high;
                anchorType = 'high';
            } else if (minDistPx === dLowPx) {
                snappedPrice = closestCandle.low;
                anchorType = 'low';
            } else {
                snappedPrice = closestCandle.close;
                anchorType = 'close';
            }
        }
        
        return { 
            price: snappedPrice, 
            time: closestCandle.time,
            anchorCandle: {
                time: closestCandle.time,
                type: anchorType,
                price: snappedPrice
            }
        };
    }
    
    _findClosestCandleTime(time) {
        if (!this._chartManager.chartData.length) return time;
        
        const data = this._chartManager.chartData;
        let closestCandle = data[0];
        let minDiff = Math.abs(data[0].time - time);
        
        for (let i = 1; i < data.length; i++) {
            const diff = Math.abs(data[i].time - time);
            if (diff < minDiff) {
                minDiff = diff;
                closestCandle = data[i];
            }
        }
        
        return closestCandle.time;
    }
    
    _showSettings(ray) {
        const settings = document.getElementById('drawingSettings');
        
        document.getElementById('currentColorBox').style.backgroundColor = ray.options.color;
        document.getElementById('hexInputInline').value = ray.options.color;
        document.getElementById('settingThickness').value = ray.options.lineWidth;
        document.getElementById('templateSelect').value = ray.options.lineStyle;
        document.getElementById('colorOpacity').value = Math.round(ray.options.opacity * 100);
        document.getElementById('colorOpacityValue').textContent = document.getElementById('colorOpacity').value + '%';
        
        const priceInput = document.getElementById('settingsPriceInput');
        if (priceInput) {
            priceInput.value = Utils.formatPrice(ray.price);
            priceInput.addEventListener('contextmenu', (e) => {
                e.stopPropagation();
            });
        }
        
        createColorGrid('inlineColorsGrid', 'currentColorBox', 'colorPickerInline', 'hexInputInline', ray.options.color, 'addColorInline');
        const hexInput = document.getElementById('hexInputInline');
        if (hexInput) {
            hexInput.addEventListener('contextmenu', (e) => {
                e.stopPropagation();
            });
        }

        this._renderTimeframeCheckboxes(ray);
        
        settings.style.display = 'block';
        settings.style.left = '50%';
        settings.style.top = '50%';
        settings.style.transform = 'translate(-50%, -50%)';
        
        settings.addEventListener('mousedown', (e) => e.stopPropagation());
        settings.addEventListener('mousemove', (e) => e.stopPropagation());
        settings.addEventListener('mouseup', (e) => e.stopPropagation());
        settings.addEventListener('click', (e) => e.stopPropagation());
        
        let header = settings.querySelector('.settings-header');
        if (!header) {
            header = document.createElement('div');
            header.className = 'settings-header';
            header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #404040;';
            
            const title = document.createElement('span');
            title.textContent = 'Настройки луча';
            title.style.color = '#c5c3c3';
            title.style.fontSize = '14px';
            title.style.fontWeight = 'bold';
            
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '✕';
            closeBtn.style.cssText = 'background: transparent; border: none; color: #B0B0B0; font-size: 18px; cursor: pointer; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 4px;';
            closeBtn.onmouseover = () => closeBtn.style.background = '#404040';
            closeBtn.onmouseout = () => closeBtn.style.background = 'transparent';
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                settings.style.display = 'none';
            };
            
            header.appendChild(title);
            header.appendChild(closeBtn);
            settings.insertBefore(header, settings.firstChild);
        }
        
        if (this._closeOnOutsideClick) {
            document.removeEventListener('mousedown', this._closeOnOutsideClick);
        }
        
        this._closeOnOutsideClick = (e) => {
            if (!settings.contains(e.target) && settings.style.display === 'block') {
                settings.style.display = 'none';
                document.removeEventListener('mousedown', this._closeOnOutsideClick);
                this._closeOnOutsideClick = null;
            }
        };
        
        setTimeout(() => {
            if (this._closeOnOutsideClick) {
                document.addEventListener('mousedown', this._closeOnOutsideClick);
            }
        }, 100);
        
        const stylePanel = document.getElementById('stylePanel');
        const visibilityPanel = document.getElementById('visibilityPanel');
        const tabs = document.querySelectorAll('#drawingSettings .settings-tab');
        
        tabs.forEach(tab => {
            tab.classList.remove('active');
            if (tab.dataset.settingsTab === 'style') {
                tab.classList.add('active');
            }
        });
        stylePanel.classList.add('active');
        visibilityPanel.classList.remove('active');
        
        tabs.forEach(tab => {
            const newTab = tab.cloneNode(true);
            tab.parentNode.replaceChild(newTab, tab);
        });
        
        document.querySelectorAll('#drawingSettings .settings-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('#drawingSettings .settings-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                if (tab.dataset.settingsTab === 'style') {
                    stylePanel.classList.add('active');
                    visibilityPanel.classList.remove('active');
                } else {
                    stylePanel.classList.remove('active');
                    visibilityPanel.classList.add('active');
                }
            });
        });
        
        const applyBtn = document.getElementById('applyPriceBtn');
        const newApplyBtn = applyBtn.cloneNode(true);
        applyBtn.parentNode.replaceChild(newApplyBtn, applyBtn);
        
        newApplyBtn.addEventListener('click', () => {
            const newPrice = parseFloat(document.getElementById('settingsPriceInput').value);
            if (!isNaN(newPrice)) {
                ray.price = newPrice;
                this._requestRedraw();
                this._saveRays();
            }
        });
        
        const saveBtn = document.getElementById('saveSettings');
        const newSaveBtn = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
        
        newSaveBtn.addEventListener('click', () => {
            ray.updateOptions({
                color: document.getElementById('currentColorBox').style.backgroundColor,
                lineWidth: parseInt(document.getElementById('settingThickness').value),
                lineStyle: document.getElementById('templateSelect').value,
                opacity: parseInt(document.getElementById('colorOpacity').value) / 100
            });
            this._requestRedraw();
            settings.style.display = 'none';
            this._saveRays();
        });
        
        const deleteBtn = document.getElementById('deleteDrawing');
        const newDeleteBtn = deleteBtn.cloneNode(true);
        deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
        
        newDeleteBtn.addEventListener('click', () => {
            this.deleteRay(ray.id);
            settings.style.display = 'none';
            this._requestRedraw();
        });

        if (!settings.dataset.minutesBound) {
            settings.dataset.minutesBound = 'true';
            const minutesBtn = document.getElementById('selectMinutesTimeframes');
            if (minutesBtn) {
                minutesBtn.addEventListener('click', () => {
                    const container = document.getElementById('timeframeCheckboxList');
                    if (!container) return;
                    const minutesSet = new Set(['1m', '3m', '5m', '15m', '30m', '1h']);
                    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                        const isMinute = minutesSet.has(cb.dataset.timeframe);
                        cb.checked = isMinute;
                        ray.timeframeVisibility[cb.dataset.timeframe] = isMinute;
                    });
                });
            }
        }

        if (typeof window.makePanelDraggable === 'function') {
            window.makePanelDraggable(settings);
        }
    }

    _renderTimeframeCheckboxes(ray) {
        const container = document.getElementById('timeframeCheckboxList');
        if (!container) return;
        
        const tfLabels = {
            '1m': '1 минута', '3m': '3 минуты', '5m': '5 минут', '15m': '15 минут',
            '30m': '30 минут', '1h': '1 час', '4h': '4 часа', '6h': '6 часов',
            '12h': '12 часов', '1d': '1 день', '1w': '1 неделя', '1M': '1 месяц'
        };
        
        let html = '';
        const timeframes = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '1d', '1w', '1M'];
        
        timeframes.forEach(tf => {
            const isChecked = ray.timeframeVisibility[tf] !== false;
            const label = tfLabels[tf] || tf;
            const shortLabel = tf;
            
            html += `
                <div class="timeframe-checkbox-item">
                    <input type="checkbox" id="tf_${tf}_${ray.id}" data-timeframe="${tf}" ${isChecked ? 'checked' : ''}>
                    <label for="tf_${tf}_${ray.id}">${label}</label>
                    <span class="tf-badge">${shortLabel}</span>
                </div>
            `;
        });
        
        container.innerHTML = html;
        
        container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const tf = e.target.dataset.timeframe;
                ray.timeframeVisibility[tf] = e.target.checked;
                this._requestRedraw();
            });
        });
        
        const selectAllBtn = document.getElementById('selectAllTimeframes');
        const deselectAllBtn = document.getElementById('deselectAllTimeframes');
        
        if (selectAllBtn) {
            const newSelectAll = selectAllBtn.cloneNode(true);
            selectAllBtn.parentNode.replaceChild(newSelectAll, selectAllBtn);
            
            newSelectAll.addEventListener('click', () => {
                container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                    cb.checked = true;
                    const tf = cb.dataset.timeframe;
                    ray.timeframeVisibility[tf] = true;
                });
                this._requestRedraw();
            });
        }
        
        if (deselectAllBtn) {
            const newDeselectAll = deselectAllBtn.cloneNode(true);
            deselectAllBtn.parentNode.replaceChild(newDeselectAll, deselectAllBtn);
            
            newDeselectAll.addEventListener('click', () => {
                container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                    cb.checked = false;
                    const tf = cb.dataset.timeframe;
                    ray.timeframeVisibility[tf] = false;
                });
                this._requestRedraw();
            });
        }
    }
    
    syncWithNewTimeframe() {
        const raysForCurrent = this._getRaysForCurrentSymbol();
        raysForCurrent.forEach(item => {
            if (item.primitive && item.primitive.updateAllViews) {
                item.primitive.updateAllViews();
            }
            if (item.primitive && item.primitive.requestRedraw) {
                item.primitive.requestRedraw();
            }
        });
        this._requestRedraw();
    }
    
    _requestRedraw() {
        const raysForCurrent = this._getRaysForCurrentSymbol();
        raysForCurrent.forEach(item => { 
            if (item.primitive?.requestRedraw) {
                item.primitive.requestRedraw();
            }
        });
    }

    _applyRedrawIfNeeded() {
        if (this._needsRedraw) {
            this._needsRedraw = false;
            this._rays?.forEach(item => { 
                if (item.primitive?.requestRedraw) {
                    item.primitive.requestRedraw();
                }
            });
        }
    }

    _handleDblClickFn(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        const rect = this._chartManager.chartContainer.getBoundingClientRect();
        const { x, y } = this._toBitmapCoords(e.clientX - rect.left, e.clientY - rect.top);
        const hit = this.hitTest(x, y);
        
        this._rays.forEach(item => {
            item.ray.readyToDrag = false;
            item.ray.showDragPoint = false;
        });
        
        if (hit && hit.ray) {
            hit.ray.readyToDrag = true;
            hit.ray.showDragPoint = true;
            hit.ray.selected = true;
            this._selectedRay = hit.ray;
            this._readyToDragRay = hit.ray;
            this._requestRedraw();
        } else {
            this._selectedRay = null;
            this._readyToDragRay = null;
            this._requestRedraw();
        }
    }
    
    async _saveRays() {
        if (this._rays.length === 0) return;
        
        const promises = this._rays.map(({ ray }) => 
            window.db.put('drawings', {
                id: ray.id,
                type: 'ray',
                symbolKey: ray.symbolKey,
                data: {
                    price: ray.price,
                    time: ray.time,
                    anchorTime: ray.anchorTime,
                    options: ray.options,
                    timeframeVisibility: ray.timeframeVisibility,
                    anchorCandle: ray.anchorCandle
                }
            }).catch(e => console.warn('Save ray error:', e))
        );
        
        await Promise.all(promises);
        console.log(`💾 Saved ${this._rays.length} rays`);
    }

    async loadRays() {
        const currentKey = this._getCurrentSymbolKey();
        await window.drawingLoaderCoordinator.loadAllForSymbol(currentKey);
    }

    reattachRays() {
        const currentKey = this._getCurrentSymbolKey();
        const series = this._chartManager.currentChartType === 'candle' 
            ? this._chartManager.candleSeries 
            : this._chartManager.barSeries;
        
        this._rays.forEach(item => {
            if (item.ray.symbolKey === currentKey) {
                try {
                    if (item.series && item.primitive) {
                        item.series.detachPrimitive(item.primitive);
                    }
                    if (series && item.primitive) {
                        series.attachPrimitive(item.primitive);
                    }
                    item.series = series;
                } catch(e) {
                    console.warn('Ошибка переприкрепления луча:', e);
                }
            }
        });
        
        this._requestRedraw();
    }
    
    deactivateAll() {
        this._rays.forEach(item => {
            item.ray.selected = false;
            item.ray.showDragPoint = false;
            item.ray.readyToDrag = false;
        });
        this._selectedRay = null;
    }

    activateObject(ray) {
        ray.selected = true;
        ray.showDragPoint = true;
        ray.readyToDrag = true;
        this._selectedRay = ray;
    }
}
// ============================================================
// TREND LINE CLASSES
// ============================================================
class TrendLineManager {
    constructor(chartManager) {
        this._pixelRatio = window.devicePixelRatio || 1;
        this._trendLines = [];
        this._chartManager = chartManager;
        this._selectedLine = null;
        this._hoveredLine = null;
        this._isDrawingMode = false;
        this._magnetEnabled = true;
        this._tempLine = null;
        this._tempPrimitive = null;
        this._isDragging = false;
        this._dragLine = null;
        this._dragPoint = null;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._dragStartPoint1 = { price: 0, time: 0 };
        this._dragStartPoint2 = { price: 0, time: 0 };
        this._drawingStartPoint = null;
        this._isDrawingSecondPoint = false;
        this._lastMouseX = 0;
        this._lastMouseY = 0;
        this._potentialDrag = null;
        this._dragThreshold = 5;
        
        // ✅ КЭШ ДЛЯ ФИЛЬТРАЦИИ
        this._trendLinesCache = null;
        this._trendLinesCacheKey = null;
        
        // ✅ rAF THROTTLE ДЛЯ HOVER
        this._pendingMouseEvent = null;
        this._hoverRafId = null;
        
        this._handleMouseDown = this._handleMouseDown.bind(this);
        this._handleMouseMove = this._handleMouseMove.bind(this);
        this._handleMouseUp = this._handleMouseUp.bind(this);
        this._handleMouseLeave = this._handleMouseLeave.bind(this);
        this._handleContextMenu = this._handleContextMenu.bind(this);

        this._handleGlobalMouseUp = this._handleGlobalMouseUp.bind(this);
        window.addEventListener('mouseup', this._handleGlobalMouseUp);
        this._setupEventListeners();
        this._setupHotkeys();
        this._isLoading = false;
        this._needsRedraw = false;
        this._dblClickTimer = null;
        this._potentialDblClickTarget = null;
        this._dblClickTimeout = 350;
        this._lastClickTime = 0;

        window.drawingLoaderCoordinator.register(this, 'trendline');

        setTimeout(async () => {
            try {
                if (!window.dbReady) {
                    await new Promise(r => { const c = () => window.dbReady ? r() : setTimeout(c, 50); c(); });
                }
                await this.loadTrendLines();
            } catch (e) { console.error(e); }
        }, 150);
    }

    // ✅ КЭШИРОВАННЫЙ МЕТОД
    _getTrendLinesForCurrentSymbol() {
        const currentKey = this._getCurrentSymbolKey();
        if (this._trendLinesCacheKey === currentKey && this._trendLinesCache) {
            return this._trendLinesCache;
        }
        this._trendLinesCacheKey = currentKey;
        this._trendLinesCache = this._trendLines.filter(item => item.trendLine.symbolKey === currentKey);
        return this._trendLinesCache;
    }
    
    // ✅ ИНВАЛИДАЦИЯ КЭША
    _invalidateTrendLinesCache() {
        this._trendLinesCache = null;
        this._trendLinesCacheKey = null;
    }

    // ✅ НОВЫЙ МЕТОД: Экстраполяция цены для зон вне видимого диапазона
    _getPriceFromCoordinate(y) {
        let price = this._chartManager.coordinateToPrice(y);
        if (price !== null) return price;

        const data = this._chartManager.chartData;
        if (!data || data.length === 0) return null;

        let minPrice = Infinity, maxPrice = -Infinity;
        for (const candle of data) {
            if (candle.low < minPrice) minPrice = candle.low;
            if (candle.high > maxPrice) maxPrice = candle.high;
        }

        const minY = this._chartManager.priceToCoordinate(maxPrice);
        const maxY = this._chartManager.priceToCoordinate(minPrice);

        if (minY === null || maxY === null || maxY === minY) return null;

        const pricePerPixel = (maxPrice - minPrice) / (maxY - minY);

        if (y < minY) return maxPrice + (minY - y) * pricePerPixel;
        if (y > maxY) return minPrice - (y - maxY) * pricePerPixel;
        return null;
    }

    async loadFromData(symbolKey, lineRecords) {
        if (this._getCurrentSymbolKey() !== symbolKey) return;

        try {
            const series = this._chartManager.currentChartType === 'candle'
                ? this._chartManager.candleSeries
                : this._chartManager.barSeries;

            if (!series) return;

            const ALL_TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '1d', '1w', '1M'];
            const defaultVisibility = {};
            ALL_TFS.forEach(tf => { defaultVisibility[tf] = true; });

            const existingIds = new Set(
                this._trendLines
                    .filter(item => item.trendLine.symbolKey === symbolKey)
                    .map(item => item.trendLine.id)
            );

            const newRecordIds = new Set(lineRecords.map(l => l.id));

            const toDetach = this._trendLines.filter(item =>
                item.trendLine.symbolKey === symbolKey && !newRecordIds.has(item.trendLine.id)
            );

            for (const item of toDetach) {
                try {
                    if (item.series && item.primitive) {
                        item.series.detachPrimitive(item.primitive);
                    }
                } catch (e) { }
            }

            this._trendLines = this._trendLines.filter(item =>
                item.trendLine.symbolKey !== symbolKey || newRecordIds.has(item.trendLine.id)
            );

            const newLines = [];
            for (const rec of lineRecords) {
                try {
                    const existing = this._trendLines.find(item => item.trendLine.id === rec.id);
                    if (existing) {
                        existing.trendLine.point1 = rec.data.point1;
                        existing.trendLine.point2 = rec.data.point2;
                        existing.trendLine.options = { ...existing.trendLine.options, ...rec.data.options };

                        existing.trendLine.timeframeVisibility = { ...defaultVisibility, ...(rec.data.timeframeVisibility || {}) };

                        existing.trendLine.anchorTime1 = rec.data.anchorTime1;
                        existing.trendLine.anchorTime2 = rec.data.anchorTime2;
                        existing.trendLine.anchorCandle1 = rec.data.anchorCandle1;
                        existing.trendLine.anchorCandle2 = rec.data.anchorCandle2;

                        continue;
                    }

                    const line = new TrendLine(rec.data.point1, rec.data.point2, rec.data.options);
                    line.id = rec.id;
                    line.symbolKey = rec.symbolKey;

                    line.timeframeVisibility = { ...defaultVisibility, ...(rec.data.timeframeVisibility || {}) };

                    line.anchorCandle1 = rec.data.anchorCandle1;
                    line.anchorCandle2 = rec.data.anchorCandle2;
                    line.anchorTime1 = rec.data.anchorTime1;
                    line.anchorTime2 = rec.data.anchorTime2;

                    const primitive = new TrendLinePrimitive(line, this._chartManager);
                    series.attachPrimitive(primitive);
                    newLines.push({ trendLine: line, primitive, series });
                } catch (e) {
                    console.warn('Failed to load trend line:', rec.id, e);
                }
            }

            this._trendLines.push(...newLines);
            this._invalidateTrendLinesCache();
            this._requestRedraw();
            console.log(`✅ Loaded ${lineRecords.length} trend lines for ${symbolKey}`);
        } catch (error) {
            console.error('❌ loadFromData failed:', error);
            throw error;
        }
    }

    _toBitmapCoords(cssX, cssY) {
        return { x: cssX * this._pixelRatio, y: cssY * this._pixelRatio };
    }

    _setupEventListeners() {
        const container = this._chartManager.chartContainer;
        container.addEventListener('mousedown', this._handleMouseDown);
        container.addEventListener('mousemove', this._handleMouseMove);
        container.addEventListener('mouseup', this._handleMouseUp);
        container.addEventListener('mouseleave', this._handleMouseLeave);
        container.addEventListener('contextmenu', this._handleContextMenu);
    }

    _setupHotkeys() {
        document.addEventListener('keydown', (e) => {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

            if (e.key === 'Delete' && this._selectedLine && this._selectedLine.editMode === true) {
                e.preventDefault();
                this.deleteTrendLine(this._selectedLine.id);
                this._selectedLine = null;
            }
        });
    }

    _getCurrentSymbolKey() {
        const symbol = this._chartManager.currentSymbol || 'BTCUSDT';
        const exchange = this._chartManager.currentExchange || 'binance';
        const marketType = this._chartManager.currentMarketType || 'futures';
        return `${symbol}:${exchange}:${marketType}`;
    }

    setDrawingMode(enabled) {
        this._isDrawingMode = enabled;
        const btn = document.getElementById('toolTrendLine');
        if (btn) {
            if (enabled) { btn.style.background = '#4A90E2'; btn.style.color = '#FFFFFF'; btn.classList.add('active'); }
            else { btn.style.background = ''; btn.style.color = ''; btn.classList.remove('active'); }
        }
        if (!enabled) {
            if (this._tempPrimitive) {
                const series = this._chartManager.currentChartType === 'candle' ? this._chartManager.candleSeries : this._chartManager.barSeries;
                if (series) try { series.detachPrimitive(this._tempPrimitive); } catch (e) { }
                this._tempPrimitive = null;
            }
            this._drawingStartPoint = null;
            this._isDrawingSecondPoint = false;
            this._tempLine = null;
            this._requestRedraw();
        }
    }

    setMagnetEnabled(enabled) {
        this._magnetEnabled = enabled;
        const btn = document.getElementById('toolMagnet');
        if (btn) { if (enabled) btn.classList.add('magnet-active'); else btn.classList.remove('magnet-active'); }
    }

    _getTimeFromCoordinate(x) {
        let time = this._chartManager.coordinateToTime(x);
        if (time !== null) return time;
        const data = this._chartManager.chartData;
        if (!data.length) return null;
        let intervalMs = 60 * 60 * 1000;
        if (data.length >= 2) intervalMs = data[1].time - data[0].time;
        const firstCandle = data[0], lastCandle = data[data.length - 1];
        const firstX = this._chartManager.timeToCoordinate(firstCandle.time);
        const lastX = this._chartManager.timeToCoordinate(lastCandle.time);
        if (firstX === null || lastX === null) return null;
        if (x > lastX) { return lastCandle.time + (x - lastX) / ((lastX - firstX) / (lastCandle.time - firstCandle.time)); }
        if (x < firstX) { return firstCandle.time - (firstX - x) / ((lastX - firstX) / (lastCandle.time - firstCandle.time)); }
        return null;
    }

    createTrendLine(point1, point2, options = {}) {
        const defaultVisibility = { '1m': true, '3m': true, '5m': true, '15m': true, '30m': true, '1h': true, '4h': true, '6h': true, '12h': true, '1d': true, '1w': true, '1M': true };
        const trendLine = new TrendLine(point1, point2, { ...options, timeframeVisibility: options.timeframeVisibility || defaultVisibility });
        trendLine.anchorTime1 = point1.time; trendLine.anchorTime2 = point2.time;
        trendLine.symbolKey = this._getCurrentSymbolKey();
        trendLine.symbol = this._chartManager.currentSymbol;
        trendLine.exchange = this._chartManager.currentExchange;
        trendLine.marketType = this._chartManager.currentMarketType;
        const primitive = new TrendLinePrimitive(trendLine, this._chartManager);
        const series = this._chartManager.currentChartType === 'candle' ? this._chartManager.candleSeries : this._chartManager.barSeries;
        series.attachPrimitive(primitive);
        this._trendLines.push({ trendLine, primitive, series });
        this._invalidateTrendLinesCache();
        this._saveTrendLines();
        return trendLine;
    }

    deleteTrendLine(lineId) {
        const index = this._trendLines.findIndex(item => item.trendLine.id === lineId);
        if (index !== -1) {
            const { primitive, series } = this._trendLines[index];
            window.db.delete('drawings', lineId).catch(e => console.warn(e));
            try { series.detachPrimitive(primitive); } catch (e) { }
            this._trendLines.splice(index, 1);
            this._invalidateTrendLinesCache();
            if (this._selectedLine?.id === lineId) this._selectedLine = null;
            if (this._dragLine?.id === lineId) this._dragLine = null;
            this._saveTrendLines(); this._requestRedraw();
            return true;
        }
        return false;
    }

    deleteAllTrendLines() {
        for (const item of this._trendLines) window.db.delete('drawings', item.trendLine.id).catch(e => console.warn(e));
        this._trendLines.forEach(({ primitive, series }) => { try { series.detachPrimitive(primitive); } catch (e) { } });
        this._trendLines = [];
        this._invalidateTrendLinesCache();
        this._selectedLine = null; this._dragLine = null;
        this._saveTrendLines(); this._requestRedraw();
    }

    _handleMouseDown(e) {
        if (e.button !== 0) return;
        const rect = this._chartManager.chartContainer.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;
        const { x: bmX, y: bmY } = this._toBitmapCoords(x, y);

        const trendMenu = document.getElementById('trendContextMenu');
        if (trendMenu?.style.display === 'flex') {
            const mr = trendMenu.getBoundingClientRect();
            if (e.clientX >= mr.left && e.clientX <= mr.right && e.clientY >= mr.top && e.clientY <= mr.bottom) return;
        }

        if (this._isDrawingMode && this._isDrawingSecondPoint && this._drawingStartPoint) {
            this._completeDrawing(x, y);
            e.preventDefault(); e.stopPropagation();
            return;
        }

        const hit = this.hitTest(bmX, bmY);
        if (hit?.trendLine) {
            e.preventDefault(); e.stopPropagation();

            const now = Date.now();

            if (this._dblClickTimer && this._potentialDblClickTarget === hit.trendLine && now - this._lastClickTime < this._dblClickTimeout) {
                clearTimeout(this._dblClickTimer);
                this._dblClickTimer = null;
                this._potentialDblClickTarget = null;
                this._lastClickTime = 0;

                if (hit.trendLine.editMode) {
                    hit.trendLine.editMode = false;
                    hit.trendLine.showDragPoint1 = false;
                    hit.trendLine.showDragPoint2 = false;
                } else {
                    this._trendLines.forEach(item => {
                        if (item.trendLine !== hit.trendLine) {
                            item.trendLine.editMode = false;
                            item.trendLine.showDragPoint1 = false;
                            item.trendLine.showDragPoint2 = false;
                        }
                    });
                    hit.trendLine.editMode = true;
                    hit.trendLine.showDragPoint1 = true;
                    hit.trendLine.showDragPoint2 = true;
                    hit.trendLine.selected = true;
                    if (this._selectedLine && this._selectedLine !== hit.trendLine) {
                        this._selectedLine.selected = false;
                    }
                    this._selectedLine = hit.trendLine;
                }
                this._requestRedraw();
                return;
            }

            if (this._selectedLine && this._selectedLine !== hit.trendLine) {
                this._selectedLine.selected = false;
                this._selectedLine.editMode = false;
                this._selectedLine.showDragPoint1 = false;
                this._selectedLine.showDragPoint2 = false;
            }
            hit.trendLine.selected = true;
            this._selectedLine = hit.trendLine;

            this._potentialDblClickTarget = hit.trendLine;
            this._lastClickTime = now;
            if (this._dblClickTimer) clearTimeout(this._dblClickTimer);
            this._dblClickTimer = setTimeout(() => {
                this._dblClickTimer = null;
                this._potentialDblClickTarget = null;
            }, this._dblClickTimeout);

            if (hit.trendLine.editMode) {
                this._potentialDrag = {
                    line: hit.trendLine, pointType: hit.type, startX: bmX, startY: bmY,
                    startPoint1: { ...hit.trendLine.point1 }, startPoint2: { ...hit.trendLine.point2 }
                };
                this._chartManager.chartContainer.style.cursor = this._potentialDrag ? 'grabbing' : 'crosshair';
            }

            this._requestRedraw();
        } else {
            if (this._isDrawingMode && !this._isDrawingSecondPoint) {
                this._startDrawing(x, y);
                e.preventDefault(); e.stopPropagation();
                return;
            }
            if (this._selectedLine) {
                this._selectedLine.selected = false;
                this._selectedLine.editMode = false;
                this._selectedLine.showDragPoint1 = false;
                this._selectedLine.showDragPoint2 = false;
                this._selectedLine = null;
                this._requestRedraw();
            }
            if (trendMenu) trendMenu.style.display = 'none';
        }
    }

    // ✅ rAF-THROTTLED С GUARD НА СКРОЛЛ
    _handleMouseMove(e) {
        // Guard: при панорамировании/зуме пропускаем hover
        if (this._chartManager._isScrolling || this._chartManager._isScrollingFast) {
            if (this._hoveredLine) {
                this._hoveredLine.hovered = false;
                this._hoveredLine = null;
                this._requestRedraw();
            }
            return;
        }
        
        this._pendingMouseEvent = e;
        if (this._hoverRafId) return;
        
        this._hoverRafId = requestAnimationFrame(() => {
            this._hoverRafId = null;
            this._processMouseMove(this._pendingMouseEvent);
        });
    }
    
    // ✅ ВЫНЕСЕННАЯ ЛОГИКА MOUSEMOVE
    _processMouseMove(e) {
        const rect = this._chartManager.chartContainer.getBoundingClientRect();
        const cssX = e.clientX - rect.left;
        const cssY = e.clientY - rect.top;

        this._lastMouseX = cssX;
        this._lastMouseY = cssY;

        const { x: bmX, y: bmY } = this._toBitmapCoords(cssX, cssY);

        if (this._isDrawingMode && this._isDrawingSecondPoint && this._drawingStartPoint) {
            let price = this._chartManager.coordinateToPrice(cssY);
            let time = this._chartManager.coordinateToTime(cssX);

            if (price === null) price = this._getPriceFromCoordinate(cssY);
            if (time === null) time = this._getTimeFromCoordinate(cssX);

            if (price !== null && time !== null) {
                if (this._tempLine) {
                    this._tempLine.point2 = { price, time };
                } else {
                    this._tempLine = {
                        point1: this._drawingStartPoint,
                        point2: { price, time },
                        options: {
                            color: document.getElementById('currentColorBox')?.style.backgroundColor || '#2706e4',
                            lineWidth: parseInt(document.getElementById('settingThickness')?.value) || 2,
                            lineStyle: document.getElementById('templateSelect')?.value || 'solid'
                        }
                    };
                    const series = this._chartManager.currentChartType === 'candle' ? this._chartManager.candleSeries : this._chartManager.barSeries;
                    if (series && !this._tempPrimitive) {
                        this._tempPrimitive = new TempTrendLinePrimitive(this);
                        try { series.attachPrimitive(this._tempPrimitive); } catch (e) { }
                    }
                }
            }
            return;
        }

        if (this._potentialDrag && !this._isDragging) {
            const dx = Math.abs(bmX - this._potentialDrag.startX), dy = Math.abs(bmY - this._potentialDrag.startY);
            if (dx > 3 || dy > 3) {
                this._isDragging = true; this._dragLine = this._potentialDrag.line; this._dragPoint = this._potentialDrag.pointType;
                this._dragLine.dragging = true;
                const p1x = this._chartManager.timeToCoordinateWithFallback?.(this._dragLine.point1.time) ?? this._chartManager.timeToCoordinate(this._dragLine.point1.time);
                const p1y = this._chartManager.priceToCoordinateWithFallback?.(this._dragLine.point1.price) ?? this._chartManager.priceToCoordinate(this._dragLine.point1.price);
                const p2x = this._chartManager.timeToCoordinateWithFallback?.(this._dragLine.point2.time) ?? this._chartManager.timeToCoordinate(this._dragLine.point2.time);
                const p2y = this._chartManager.priceToCoordinateWithFallback?.(this._dragLine.point2.price) ?? this._chartManager.priceToCoordinate(this._dragLine.point2.price);
                if (p1x !== null && p1y !== null) this._dragLine._pixelStart1 = { x: p1x * this._pixelRatio, y: p1y * this._pixelRatio };
                if (p2x !== null && p2y !== null) this._dragLine._pixelStart2 = { x: p2x * this._pixelRatio, y: p2y * this._pixelRatio };
                this._dragStartX = this._potentialDrag.startX; this._dragStartY = this._potentialDrag.startY;
                this._dragStartPoint1 = { ...this._potentialDrag.startPoint1 };
                this._dragStartPoint2 = { ...this._potentialDrag.startPoint2 };
                this._chartManager.chartContainer.style.cursor = 'grabbing';
            }
        }
        if (this._isDragging && this._dragLine) {
            e.preventDefault(); e.stopPropagation();
            const deltaX = bmX - this._dragStartX, deltaY = bmY - this._dragStartY;
            if (this._dragPoint === 'point1' && this._dragLine._pixelStart1) {
                this._dragLine._tempPixel1 = { x: this._dragLine._pixelStart1.x + deltaX, y: this._dragLine._pixelStart1.y + deltaY };
                delete this._dragLine._tempPixel2;
            } else if (this._dragPoint === 'point2' && this._dragLine._pixelStart2) {
                this._dragLine._tempPixel2 = { x: this._dragLine._pixelStart2.x + deltaX, y: this._dragLine._pixelStart2.y + deltaY };
                delete this._dragLine._tempPixel1;
            } else if (this._dragPoint === 'line' && this._dragLine._pixelStart1 && this._dragLine._pixelStart2) {
                this._dragLine._tempPixel1 = { x: this._dragLine._pixelStart1.x + deltaX, y: this._dragLine._pixelStart1.y + deltaY };
                this._dragLine._tempPixel2 = { x: this._dragLine._pixelStart2.x + deltaX, y: this._dragLine._pixelStart2.y + deltaY };
            }
            this._requestRedraw();
        } else {
            const hit = this.hitTest(bmX, bmY);
            const hitLine = hit?.trendLine ?? null;
            this._chartManager.chartContainer.style.cursor = hitLine ? (hit.type === 'point1' || hit.type === 'point2' ? 'move' : 'grab') : 'crosshair';
            if (this._hoveredLine !== hitLine) {
                if (this._hoveredLine) this._hoveredLine.hovered = false;
                this._hoveredLine = hitLine;
                if (hitLine) hitLine.hovered = true;
                this._requestRedraw();
            }
        }
    }

    _handleMouseUp(e) {
        if (this._isDragging) {
            e.preventDefault(); e.stopPropagation();
            this._isDragging = false;
            if (this._dragLine) {
                if (this._dragPoint === 'point1' && this._dragLine._tempPixel1) {
                    const price = this._chartManager.coordinateToPrice(this._dragLine._tempPixel1.y / this._pixelRatio);
                    const time = this._getTimeFromCoordinate(this._dragLine._tempPixel1.x / this._pixelRatio);
                    if (price !== null && time !== null) {
                        this._dragLine.point1.price = price;
                        this._dragLine.point1.time = time;
                        this._dragLine.anchorCandle1 = null;
                    }
                    delete this._dragLine._tempPixel1;
                } else if (this._dragPoint === 'point2' && this._dragLine._tempPixel2) {
                    const price = this._chartManager.coordinateToPrice(this._dragLine._tempPixel2.y / this._pixelRatio);
                    const time = this._getTimeFromCoordinate(this._dragLine._tempPixel2.x / this._pixelRatio);
                    if (price !== null && time !== null) {
                        this._dragLine.point2.price = price;
                        this._dragLine.point2.time = time;
                        this._dragLine.anchorCandle2 = null;
                    }
                    delete this._dragLine._tempPixel2;
                } else if (this._dragPoint === 'line' && this._dragLine._tempPixel1 && this._dragLine._tempPixel2) {
                    const price1 = this._chartManager.coordinateToPrice(this._dragLine._tempPixel1.y / this._pixelRatio);
                    const time1 = this._getTimeFromCoordinate(this._dragLine._tempPixel1.x / this._pixelRatio);
                    const price2 = this._chartManager.coordinateToPrice(this._dragLine._tempPixel2.y / this._pixelRatio);
                    const time2 = this._getTimeFromCoordinate(this._dragLine._tempPixel2.x / this._pixelRatio);
                    if (price1 !== null && time1 !== null && price2 !== null && time2 !== null) {
                        this._dragLine.point1.price = price1;
                        this._dragLine.point1.time = time1;
                        this._dragLine.anchorCandle1 = null;
                        this._dragLine.point2.price = price2;
                        this._dragLine.point2.time = time2;
                        this._dragLine.anchorCandle2 = null;
                    }
                    delete this._dragLine._tempPixel1;
                    delete this._dragLine._tempPixel2;
                }
                delete this._dragLine._pixelStart1;
                delete this._dragLine._pixelStart2;
                this._dragLine.dragging = false;
                this._dragLine.anchorTime1 = this._dragLine.point1.time;
                this._dragLine.anchorTime2 = this._dragLine.point2.time;
                if (this._selectedLine !== this._dragLine) {
                    this._dragLine.showDragPoint1 = false;
                    this._dragLine.showDragPoint2 = false;
                }
                this._saveTrendLines();
                this._dragLine = null;
                this._requestRedraw();
            }
            this._chartManager.chartContainer.style.cursor = 'crosshair';
        }
        this._potentialDrag = null;
    }
    
    _handleGlobalMouseUp(e) {
        if (!this._isDragging) return;
        this._handleMouseUp(e);
    }
    
    _handleMouseLeave() {
        if (this._hoveredLine) { this._hoveredLine.hovered = false; this._hoveredLine = null; this._requestRedraw(); }
        this._chartManager.chartContainer.style.cursor = 'crosshair';
        
        if (this._hoverRafId) {
            cancelAnimationFrame(this._hoverRafId);
            this._hoverRafId = null;
        }
        this._pendingMouseEvent = null;
    }

    _handleContextMenu(e) {
        e.preventDefault(); e.stopPropagation();
        const rect = this._chartManager.chartContainer.getBoundingClientRect();
        let x = e.clientX - rect.left, y = e.clientY - rect.top;
        const { x: bmX, y: bmY } = this._toBitmapCoords(x, y);

        const hit = this.hitTest(bmX, bmY);
        if (hit?.trendLine) {
            if (this._selectedLine && this._selectedLine !== hit.trendLine) {
                this._selectedLine.selected = false; this._selectedLine.showDragPoint1 = false; this._selectedLine.showDragPoint2 = false;
            }
            hit.trendLine.selected = true; hit.trendLine.showDragPoint1 = true; hit.trendLine.showDragPoint2 = true;
            this._selectedLine = hit.trendLine;
            this._requestRedraw();
            const menu = document.getElementById('trendContextMenu');
            if (menu) {
                document.getElementById('drawingContextMenu').style.display = 'none';
                document.getElementById('alertContextMenu').style.display = 'none';
                const extendBtn = document.getElementById('trendExtendRightBtn');
                if (extendBtn) {
                    hit.trendLine.options.extendRight ? extendBtn.classList.add('active') : extendBtn.classList.remove('active');
                    const nb = extendBtn.cloneNode(true); extendBtn.parentNode.replaceChild(nb, extendBtn);
                    nb.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        if (this._selectedLine) {
                            const ns = !this._selectedLine.options.extendRight;
                            this._selectedLine.updateOptions({ extendRight: ns });
                            ns ? nb.classList.add('active') : nb.classList.remove('active');
                            this._requestRedraw(); this._saveTrendLines();
                        }
                    });
                }
                const sb = document.getElementById('trendSettingsBtn'), nsb = sb.cloneNode(true); sb.parentNode.replaceChild(nsb, sb);
                nsb.onclick = (ev) => { ev.stopPropagation(); this._showSettings(hit.trendLine); menu.style.display = 'none'; };
                const db = document.getElementById('trendDeleteBtn'), ndb = db.cloneNode(true); db.parentNode.replaceChild(ndb, db);
                ndb.onclick = (ev) => { ev.stopPropagation(); this.deleteTrendLine(hit.trendLine.id); menu.style.display = 'none'; };
                menu.style.display = 'flex'; menu.style.left = e.clientX + 'px'; menu.style.top = e.clientY + 'px';
            }
        } else { const menu = document.getElementById('trendContextMenu'); if (menu) menu.style.display = 'none'; }
    }

    _handleKeyDown(e) {
        if (e.key === 'Delete' && this._selectedLine) { this.deleteTrendLine(this._selectedLine.id); this._selectedLine = null; }
    }

    _startDrawing(x, y) {
        let price = this._chartManager.coordinateToPrice(y);
        let time = this._getTimeFromCoordinate(x);
        let anchorCandle = null;

        if (price === null) price = this._getPriceFromCoordinate(y);

        if (price === null || time === null) {
            const lc = this._chartManager.getLastCandle();
            if (lc) { price = lc.close; time = lc.time; }
            else return;
        }

        if (this._magnetEnabled) {
            const s = this._snapToPrice(price, time);
            price = s.price;
            time = s.time;
            anchorCandle = s.anchorCandle;
        }

        this._drawingStartPoint = { price, time, x, y, anchorCandle };
        this._isDrawingSecondPoint = true;
        this._tempLine = null;
        this._requestRedraw();
    }

    _completeDrawing(x, y) {
        if (!this._drawingStartPoint) return;
        let price = this._chartManager.coordinateToPrice(y);
        let time = this._getTimeFromCoordinate(x);

        if (price === null) price = this._getPriceFromCoordinate(y);

        if (price === null || time === null) {
            const lc = this._chartManager.getLastCandle();
            if (lc) { price = lc.close; time = lc.time; }
            else return;
        }

        const startTime = this._drawingStartPoint.time;
        const endTime = time;
        let point1, point2, ac1, ac2;

        if (startTime <= endTime) {
            point1 = { price: this._drawingStartPoint.price, time: startTime };
            point2 = { price, time: endTime };
            ac1 = this._drawingStartPoint.anchorCandle;
            ac2 = null;
        } else {
            point1 = { price, time: endTime };
            point2 = { price: this._drawingStartPoint.price, time: startTime };
            ac1 = null;
            ac2 = this._drawingStartPoint.anchorCandle;
        }

        this.createTrendLine(point1, point2, {
            anchorCandle1: ac1,
            anchorCandle2: ac2,
            color: document.getElementById('currentColorBox')?.style.backgroundColor || '#1707f8',
            lineWidth: parseInt(document.getElementById('settingThickness')?.value) || 2,
            lineStyle: document.getElementById('templateSelect')?.value || 'solid',
            opacity: parseInt(document.getElementById('colorOpacity')?.value) / 100 || 0.9
        });

        if (this._tempPrimitive) {
            const s = this._chartManager.currentChartType === 'candle' ? this._chartManager.candleSeries : this._chartManager.barSeries;
            if (s) try { s.detachPrimitive(this._tempPrimitive); } catch (e) { }
            this._tempPrimitive = null;
        }
        this._drawingStartPoint = null;
        this._isDrawingSecondPoint = false;
        this._tempLine = null;
        this._requestRedraw();
        this.setDrawingMode(false);
    }

    hitTest(x, y) {
        if (this._selectedLine) {
            const selItem = this._trendLines.find(item => item.trendLine === this._selectedLine);
            if (selItem && selItem.primitive?._paneView?._renderer) {
                try {
                    const hit = selItem.primitive._paneView._renderer.hitTest(x, y);
                    if (hit) return hit;
                } catch (e) { }
            }
        }

        let bestHit = null;
        let bestDistance = Infinity;

        for (const item of this._trendLines) {
            if (!item.primitive?._paneView?._renderer) continue;
            if (item.trendLine === this._selectedLine) continue;

            try {
                const hit = item.primitive._paneView._renderer.hitTest(x, y);

                if (hit && hit.distance !== undefined && hit.distance < bestDistance) {
                    bestHit = hit;
                    bestDistance = hit.distance;
                }
            } catch (e) { }
        }

        return bestHit;
    }

    _detachAllPrimitivesForSymbol(symbolKey) {
        const itemsForSymbol = this._trendLines.filter(item => item.trendLine.symbolKey === symbolKey);
        for (const item of itemsForSymbol) {
            if (item.primitive && item.series) {
                try {
                    item.series.detachPrimitive(item.primitive);
                } catch (e) { }
            }
        }
        this._trendLines = this._trendLines.filter(item => item.trendLine.symbolKey !== symbolKey);
        this._invalidateTrendLinesCache();
    }

    _snapToPrice(price, time) {
        if (!this._chartManager.chartData.length) return { price, time, anchorCandle: null };
        const data = this._chartManager.chartData;
        let closestCandle;
        if (time <= data[0].time) closestCandle = data[0];
        else if (time >= data[data.length - 1].time) closestCandle = data[data.length - 1];
        else {
            closestCandle = data[0];
            let minDiff = Math.abs(data[0].time - time);
            for (let i = 1; i < data.length; i++) {
                const d = Math.abs(data[i].time - time);
                if (d < minDiff) { minDiff = d; closestCandle = data[i]; }
            }
        }
        const priceY = this._chartManager.priceToCoordinate(price);
        const highY = this._chartManager.priceToCoordinate(closestCandle.high), lowY = this._chartManager.priceToCoordinate(closestCandle.low), closeY = this._chartManager.priceToCoordinate(closestCandle.close);
        if (priceY === null || highY === null) return { price, time, anchorCandle: null };
        const dHigh = Math.abs(highY - priceY), dLow = Math.abs(lowY - priceY), dClose = Math.abs(closeY - priceY);
        let snappedPrice = price, anchorType = null;
        const minDist = Math.min(dHigh, dLow, dClose);
        if (minDist < 150) {
            if (minDist === dHigh) { snappedPrice = closestCandle.high; anchorType = 'high'; }
            else if (minDist === dLow) { snappedPrice = closestCandle.low; anchorType = 'low'; }
            else { snappedPrice = closestCandle.close; anchorType = 'close'; }
        }
        return { price: snappedPrice, time: closestCandle.time, anchorCandle: { time: closestCandle.time, type: anchorType, price: snappedPrice } };
    }

    _showSettings(trendLine) {
        const settings = document.getElementById('trendSettings');
        if (!settings) return;

        this._selectedLine = trendLine;

        document.getElementById('trendCurrentColorBox').style.backgroundColor = trendLine.options.color;
        document.getElementById('trendHexInputInline').value = trendLine.options.color;
        document.getElementById('trendSettingThickness').value = trendLine.options.lineWidth;
        document.getElementById('trendTemplateSelect').value = trendLine.options.lineStyle;
        document.getElementById('trendColorOpacity').value = Math.round(trendLine.options.opacity * 100);
        document.getElementById('trendColorOpacityValue').textContent = Math.round(trendLine.options.opacity * 100) + '%';

        const extendRightCheckbox = document.getElementById('trendExtendRight');
        if (extendRightCheckbox) extendRightCheckbox.checked = trendLine.options.extendRight || false;

        createColorGrid('trendInlineColorsGrid', 'trendCurrentColorBox', 'trendColorPickerInline', 'trendHexInputInline', trendLine.options.color, 'trendAddColorInline');

        this._renderTimeframeCheckboxes(trendLine);

        settings.style.display = 'block';
        settings.style.left = '50%';
        settings.style.top = '50%';
        settings.style.transform = 'translate(-50%, -50%)';

        let header = settings.querySelector('.settings-header');
        if (!header) {
            header = document.createElement('div');
            header.className = 'settings-header';
            header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;padding-bottom:10px;border-bottom:1px solid #404040;';
            const title = document.createElement('span');
            title.textContent = 'Настройки линии';
            title.style.cssText = 'color:#FFFFFF;font-size:14px;font-weight:bold;';
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '✕';
            closeBtn.style.cssText = 'background:transparent;border:none;color:#B0B0B0;font-size:18px;cursor:pointer;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:4px;';
            closeBtn.onmouseover = () => closeBtn.style.background = '#404040';
            closeBtn.onmouseout = () => closeBtn.style.background = 'transparent';
            closeBtn.onclick = (e) => { e.stopPropagation(); settings.style.display = 'none'; };
            header.appendChild(title);
            header.appendChild(closeBtn);
            settings.insertBefore(header, settings.firstChild);
        }

        const closeOnOutsideClick = (e) => {
            if (!settings.style.display || settings.style.display === 'none') {
                document.removeEventListener('mousedown', closeOnOutsideClick);
                return;
            }
            if (settings.contains(e.target)) return;
            if (e.target.closest('.drawing-context-menu')) return;
            if (e.target.closest('.drawing-settings-panel')) return;
            settings.style.display = 'none';
            document.removeEventListener('mousedown', closeOnOutsideClick);
        };
        document.removeEventListener('mousedown', closeOnOutsideClick);
        document.addEventListener('mousedown', closeOnOutsideClick);

        const stylePanel = document.getElementById('trendStylePanel');
        const visibilityPanel = document.getElementById('trendVisibilityPanel');
        const tabs = document.querySelectorAll('#trendSettings .settings-tab');
        tabs.forEach(tab => {
            tab.onclick = null;
            tab.addEventListener('click', function () {
                document.querySelectorAll('#trendSettings .settings-tab').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                if (this.dataset.settingsTab === 'style') {
                    stylePanel.classList.add('active');
                    visibilityPanel.classList.remove('active');
                } else {
                    stylePanel.classList.remove('active');
                    visibilityPanel.classList.add('active');
                }
            });
        });

        const saveBtn = document.getElementById('trendSaveSettings');
        const deleteBtn = document.getElementById('trendDeleteDrawing');

        if (saveBtn) {
            saveBtn.onclick = null;
            saveBtn.addEventListener('click', () => {
                trendLine.options.color = document.getElementById('trendHexInputInline').value;
                trendLine.options.lineWidth = parseInt(document.getElementById('trendSettingThickness').value) || 1;
                trendLine.options.lineStyle = document.getElementById('trendTemplateSelect').value;
                trendLine.options.opacity = parseInt(document.getElementById('trendColorOpacity').value) / 100;
                trendLine.options.extendRight = document.getElementById('trendExtendRight')?.checked || false;

                this._requestRedraw();
                settings.style.display = 'none';
                this._saveTrendLines();
            });
        }

        if (deleteBtn) {
            deleteBtn.onclick = null;
            deleteBtn.addEventListener('click', () => {
                this.deleteTrendLine(trendLine.id);
                settings.style.display = 'none';
                this._requestRedraw();
            });
        }

        if (!settings.dataset.instantBound) {
            settings.dataset.instantBound = 'true';

            document.getElementById('trendSettingThickness').addEventListener('input', function () {
                const mgr = window.trendLineManager;
                if (!mgr || !mgr._selectedLine) return;
                const val = parseInt(this.value) || 1;
                mgr._selectedLine.options.lineWidth = val;

                mgr._requestRedraw();
                mgr._saveTrendLines();
            });

            document.getElementById('trendColorOpacity').addEventListener('input', function () {
                const mgr = window.trendLineManager;
                if (!mgr || !mgr._selectedLine) return;
                document.getElementById('trendColorOpacityValue').textContent = this.value + '%';
                mgr._selectedLine.options.opacity = parseInt(this.value) / 100;
                mgr._requestRedraw();
                mgr._saveTrendLines();
            });

            document.getElementById('trendTemplateSelect').addEventListener('change', function () {
                const mgr = window.trendLineManager;
                if (!mgr || !mgr._selectedLine) return;
                const styleMap = { solid: 0, dotted: 1, dashed: 2 };
                mgr._selectedLine.options.lineStyle = this.value;

                mgr._requestRedraw();
                mgr._saveTrendLines();
            });
        }

        if (!settings.dataset.minutesBound) {
            settings.dataset.minutesBound = 'true';
            const minutesBtn = document.getElementById('trendSelectMinutesTimeframes');
            if (minutesBtn) {
                minutesBtn.addEventListener('click', () => {
                    const container = document.getElementById('trendTimeframeCheckboxList');
                    if (!container) return;
                    const minutesSet = new Set(['1m', '3m', '5m', '15m', '30m', '1h']);
                    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                        const isMinute = minutesSet.has(cb.dataset.timeframe);
                        cb.checked = isMinute;
                        trendLine.timeframeVisibility[cb.dataset.timeframe] = isMinute;
                    });
                });
            }
        }

        if (typeof window.makePanelDraggable === 'function') {
            window.makePanelDraggable(settings);
        }
    }
    
    _renderTimeframeCheckboxes(trendLine) {
        const container = document.getElementById('trendTimeframeCheckboxList'); if (!container) return;
        const tfLabels = { '1m': '1 минута', '3m': '3 минуты', '5m': '5 минут', '15m': '15 минут', '30m': '30 минут', '1h': '1 час', '4h': '4 часа', '6h': '6 часов', '12h': '12 часов', '1d': '1 день', '1w': '1 неделя', '1M': '1 месяц' };
        let html = ''; const timeframes = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '1d', '1w', '1M'];
        timeframes.forEach(tf => { const isChecked = trendLine.timeframeVisibility[tf] !== false; html += `<div class="timeframe-checkbox-item"><input type="checkbox" id="trend_tf_${tf}_${trendLine.id}" data-timeframe="${tf}" ${isChecked ? 'checked' : ''}><label>${tfLabels[tf] || tf}</label><span class="tf-badge">${tf}</span></div>`; });
        container.innerHTML = html;
        container.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.addEventListener('change', (e) => { trendLine.timeframeVisibility[e.target.dataset.timeframe] = e.target.checked; }); });
        const selectAll = document.getElementById('trendSelectAllTimeframes'), deselectAll = document.getElementById('trendDeselectAllTimeframes');
        if (selectAll) { const ns = selectAll.cloneNode(true); selectAll.parentNode.replaceChild(ns, selectAll); ns.addEventListener('click', () => container.querySelectorAll('input').forEach(c => { c.checked = true; trendLine.timeframeVisibility[c.dataset.timeframe] = true; })); }
        if (deselectAll) { const nd = deselectAll.cloneNode(true); deselectAll.parentNode.replaceChild(nd, deselectAll); nd.addEventListener('click', () => container.querySelectorAll('input').forEach(c => { c.checked = false; trendLine.timeframeVisibility[c.dataset.timeframe] = false; })); }
    }

    _requestRedraw() { this._trendLines.forEach(item => { if (item.primitive?.requestRedraw) item.primitive.requestRedraw(); }); if (this._tempPrimitive) this._tempPrimitive.requestRedraw(); }

    _applyRedrawIfNeeded() {
        if (this._needsRedraw) {
            this._needsRedraw = false;
            this._trendLines?.forEach(item => {
                if (item.primitive?.requestRedraw) {
                    item.primitive.requestRedraw();
                }
            });
        }
    }

    async _saveTrendLines() {
        if (this._trendLines.length === 0) return;
        const promises = this._trendLines.map(item => window.db.put('drawings', {
            id: item.trendLine.id,
            type: 'trendline',
            symbolKey: item.trendLine.symbolKey,
            data: {
                point1: item.trendLine.point1,
                point2: item.trendLine.point2,
                options: item.trendLine.options,
                timeframeVisibility: item.trendLine.timeframeVisibility,
                anchorCandle1: item.trendLine.anchorCandle1,
                anchorCandle2: item.trendLine.anchorCandle2,
                anchorTime1: item.trendLine.anchorTime1,
                anchorTime2: item.trendLine.anchorTime2
            }
        }).catch(e => console.warn(e)));
        await Promise.all(promises);
    }

    async loadTrendLines() {
        const currentKey = this._getCurrentSymbolKey();
        await window.drawingLoaderCoordinator.loadAllForSymbol(currentKey);
    }

    syncWithNewTimeframe() { }

    deactivateAll() {
        this._trendLines.forEach(item => {
            item.trendLine.selected = false;
            item.trendLine.editMode = false;
            item.trendLine.showDragPoint1 = false;
            item.trendLine.showDragPoint2 = false;
        });
        this._selectedLine = null;
    }

    activateObject(line) {
        line.selected = true;
        line.editMode = true;
        line.showDragPoint1 = true;
        line.showDragPoint2 = true;
        this._selectedLine = line;
    }
}
 class RulerLineManager {
    constructor(chartManager) {
        this._pixelRatio = window.devicePixelRatio || 1;
        this._rulers = [];
        this._chartManager = chartManager;
        this._selectedRuler = null;
        this._hoveredRuler = null;
        this._isDrawingMode = false;
        this._isDragging = false;
        this._dragRuler = null;
        this._dragPoint = null;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._dragStartPoint1 = { price: 0, time: 0 };
        this._dragStartPoint2 = { price: 0, time: 0 };
        this._drawingStartPoint = null;
        this._isDrawingSecondPoint = false;
        this._lastMouseX = 0;
        this._lastMouseY = 0;
        this._potentialDrag = null;
        this._dragThreshold = 5;
        this._tempLine = null;
        this._tempPoint = null;
        this._tempLinePrimitive = null;
        this._tempPointPrimitive = null;
        this._dblClickTimer = null;
        this._potentialDblClickTarget = null;
        this._dblClickTimeout = 350;
        this._lastClickTime = 0;
        this._needsRedraw = false;
        
        // ✅ КЭШ ДЛЯ ФИЛЬТРАЦИИ
        this._rulersCache = null;
        this._rulersCacheKey = null;
        
        // ✅ rAF THROTTLE ДЛЯ HOVER
        this._pendingMouseEvent = null;
        this._hoverRafId = null;
        
        this._handleMouseDown = this._handleMouseDown.bind(this);
        this._handleMouseMove = this._handleMouseMove.bind(this);
        this._handleMouseUp = this._handleMouseUp.bind(this);
        this._handleMouseLeave = this._handleMouseLeave.bind(this);
        this._handleContextMenu = this._handleContextMenu.bind(this);
        this._handleGlobalMouseUp = this._handleGlobalMouseUp.bind(this);
        
        window.addEventListener('mouseup', this._handleGlobalMouseUp);
        this._setupEventListeners();
        this._setupHotkeys();
        
        if (window.drawingLoaderCoordinator) {
            window.drawingLoaderCoordinator.register(this, 'ruler');
        }
        
        setTimeout(async () => {
            try {
                if (!window.dbReady) {
                    await new Promise(r => { const c = () => window.dbReady ? r() : setTimeout(c, 50); c(); });
                }
                await this.loadRulers();
            } catch (e) { console.error(e); }
        }, 150);
        this._isLoading = false;
    }

    // ✅ КЭШИРОВАННЫЙ МЕТОД
    _getRulersForCurrentSymbol() {
        const currentKey = this._getCurrentSymbolKey();
        if (this._rulersCacheKey === currentKey && this._rulersCache) {
            return this._rulersCache;
        }
        this._rulersCacheKey = currentKey;
        this._rulersCache = this._rulers.filter(item => item.ruler.symbolKey === currentKey);
        return this._rulersCache;
    }
    
    // ✅ ИНВАЛИДАЦИЯ КЭША
    _invalidateRulersCache() {
        this._rulersCache = null;
        this._rulersCacheKey = null;
    }

    _toBitmapCoords(cssX, cssY) {
        return { x: cssX * this._pixelRatio, y: cssY * this._pixelRatio };
    }

    _setupEventListeners() {
        const container = this._chartManager.chartContainer;
        container.addEventListener('mousedown', this._handleMouseDown);
        container.addEventListener('mousemove', this._handleMouseMove);
        container.addEventListener('mouseup', this._handleMouseUp);
        container.addEventListener('mouseleave', this._handleMouseLeave);
        container.addEventListener('contextmenu', this._handleContextMenu);
    }

    _setupHotkeys() {
        document.addEventListener('keydown', (e) => {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
            
            if (e.key === 'Delete' && this._selectedRuler && (this._selectedRuler.showDragPoint1 || this._selectedRuler.showDragPoint2)) {
                e.preventDefault();
                this.deleteRuler(this._selectedRuler.id);
                this._selectedRuler = null;
            }
        });
    }

    _getCurrentSymbolKey() {
        const symbol = this._chartManager.currentSymbol || 'BTCUSDT';
        const exchange = this._chartManager.currentExchange || 'binance';
        const marketType = this._chartManager.currentMarketType || 'futures';
        return `${symbol}:${exchange}:${marketType}`;
    }

    setDrawingMode(enabled) {
        this._isDrawingMode = enabled;
        const rulerBtn = document.getElementById('toolRuler');
        if (rulerBtn) {
            if (enabled) {
                rulerBtn.style.background = '#4A90E2';
                rulerBtn.style.color = '#FFFFFF';
                rulerBtn.classList.add('active');
            } else {
                rulerBtn.style.background = '';
                rulerBtn.style.color = '';
                rulerBtn.classList.remove('active');
            }
        }
        if (!enabled) {
            this._drawingStartPoint = null;
            this._isDrawingSecondPoint = false;
            if (this._tempLinePrimitive) {
                const series = this._chartManager.currentChartType === 'candle' ? this._chartManager.candleSeries : this._chartManager.barSeries;
                if (series) try { series.detachPrimitive(this._tempLinePrimitive); } catch(e) {}
                this._tempLinePrimitive = null;
                this._tempLine = null;
            }
            if (this._tempPointPrimitive) {
                const series = this._chartManager.currentChartType === 'candle' ? this._chartManager.candleSeries : this._chartManager.barSeries;
                if (series) try { series.detachPrimitive(this._tempPointPrimitive); } catch(e) {}
                this._tempPointPrimitive = null;
                this._tempPoint = null;
            }
            this._requestRedraw();
        }
    }

    setMagnetEnabled(enabled) {}

    _getExtendedTimeFromX(x) {
        let time = this._chartManager.coordinateToTime(x);
        if (time !== null) return time;

        const chartData = this._chartManager.chartData;
        if (!chartData || chartData.length < 2) return null;

        const firstTime = chartData[0].time;
        const lastTime = chartData[chartData.length - 1].time;
        const firstX = this._chartManager.timeToCoordinate(firstTime);
        const lastX = this._chartManager.timeToCoordinate(lastTime);

        if (firstX !== null && lastX !== null) {
            const barInterval = chartData[1].time - chartData[0].time;
            const barWidth = (lastX - firstX) / (chartData.length - 1);
            
            if (x > lastX) {
                const barsAfter = Math.round((x - lastX) / barWidth);
                return lastTime + barsAfter * barInterval;
            } else if (x < firstX) {
                const barsBefore = Math.round((firstX - x) / barWidth);
                return firstTime - barsBefore * barInterval;
            }
        }
        return null;
    }

    createRuler(point1, point2, options = {}) {
        const defaultVisibility = { '1m': true, '3m': true, '5m': true, '15m': true, '30m': true, '1h': true, '4h': true, '6h': true, '12h': true, '1d': true, '1w': true, '1M': true };
        const timeframeVisibility = options.timeframeVisibility || defaultVisibility;
        const ruler = new RulerLine(point1, point2, this._chartManager, { ...options, timeframeVisibility });
        ruler.anchorTime1 = point1.time;
        ruler.anchorTime2 = point2.time;
        ruler.symbolKey = this._getCurrentSymbolKey();
        ruler.symbol = this._chartManager.currentSymbol;
        ruler.exchange = this._chartManager.currentExchange;
        ruler.marketType = this._chartManager.currentMarketType;
        const primitive = new RulerLinePrimitive(ruler, this._chartManager);
        const series = this._chartManager.currentChartType === 'candle' ? this._chartManager.candleSeries : this._chartManager.barSeries;
        series.attachPrimitive(primitive);
        this._rulers.push({ ruler, primitive, series });
        this._invalidateRulersCache();
        this._saveRulers();
        return ruler;
    }

    deleteRuler(rulerId) {
        const index = this._rulers.findIndex(r => r.ruler.id === rulerId);
        if (index !== -1) {
            const { primitive, series } = this._rulers[index];
            if (window.db) window.db.delete('drawings', rulerId).catch(e => console.warn(e));
            try { series.detachPrimitive(primitive); } catch (e) {}
            this._rulers.splice(index, 1);
            this._invalidateRulersCache();
            if (this._selectedRuler && this._selectedRuler.id === rulerId) this._selectedRuler = null;
            if (this._dragRuler && this._dragRuler.id === rulerId) this._dragRuler = null;
            this._saveRulers();
            this._requestRedraw();
            return true;
        }
        return false;
    }

    deleteAllRulers() {
        for (const item of this._rulers) {
            if (window.db) window.db.delete('drawings', item.ruler.id).catch(e => console.warn(e));
        }
        this._rulers.forEach(({ primitive, series }) => { try { series.detachPrimitive(primitive); } catch (e) {} });
        this._rulers = [];
        this._invalidateRulersCache();
        this._selectedRuler = null;
        this._dragRuler = null;
        this._saveRulers();
        this._requestRedraw();
    }

    hitTest(x, y) {
        if (this._selectedRuler) {
            const selItem = this._rulers.find(item => item.ruler === this._selectedRuler);
            if (selItem && selItem.primitive?._paneView?._renderer) {
                try {
                    const hit = selItem.primitive._paneView._renderer.hitTest(x, y);
                    if (hit) return hit;
                } catch (e) {}
            }
        }
        
        let bestHit = null;
        let bestDistance = Infinity;
        
        for (const item of this._rulers) {
            if (!item.primitive?._paneView?._renderer) continue;
            if (item.ruler === this._selectedRuler) continue;
            
            try {
                const hit = item.primitive._paneView._renderer.hitTest(x, y);
                if (hit && hit.distance !== undefined && hit.distance < bestDistance) {
                    bestHit = hit;
                    bestDistance = hit.distance;
                }
            } catch (e) {}
        }
        return bestHit;
    }

    _handleMouseDown(e) {
        if (e.button !== 0) return;
        const rect = this._chartManager.chartContainer.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;
        const { x: bmX, y: bmY } = this._toBitmapCoords(x, y);

        const rulerMenu = document.getElementById('rulerContextMenu');
        if (rulerMenu && rulerMenu.style.display === 'flex') {
            const menuRect = rulerMenu.getBoundingClientRect();
            const isClickInsideMenu = e.clientX >= menuRect.left && e.clientX <= menuRect.right && e.clientY >= menuRect.top && e.clientY <= menuRect.bottom;
            if (isClickInsideMenu) return;
        }

        if (this._isDrawingMode && this._isDrawingSecondPoint && this._drawingStartPoint) {
            this._completeDrawing(x, y);
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        const hit = this.hitTest(bmX, bmY);
        if (hit && hit.ruler) {
            e.preventDefault();
            e.stopPropagation();
            
            const now = Date.now();
            
            if (this._dblClickTimer && this._potentialDblClickTarget === hit.ruler && now - this._lastClickTime < this._dblClickTimeout) {
                clearTimeout(this._dblClickTimer);
                this._dblClickTimer = null;
                this._potentialDblClickTarget = null;
                this._lastClickTime = 0;
                
                if (hit.ruler.showDragPoint1 || hit.ruler.showDragPoint2) {
                    hit.ruler.showDragPoint1 = false;
                    hit.ruler.showDragPoint2 = false;
                } else {
                    hit.ruler.showDragPoint1 = true;
                    hit.ruler.showDragPoint2 = true;
                }
                this._requestRedraw();
                return;
            }
            
            if (this._selectedRuler && this._selectedRuler !== hit.ruler) {
                this._selectedRuler.selected = false;
                this._selectedRuler.showDragPoint1 = false;
                this._selectedRuler.showDragPoint2 = false;
            }
            hit.ruler.selected = true;
            this._selectedRuler = hit.ruler;
            
            this._potentialDblClickTarget = hit.ruler;
            this._lastClickTime = now;
            if (this._dblClickTimer) clearTimeout(this._dblClickTimer);
            this._dblClickTimer = setTimeout(() => {
                this._dblClickTimer = null;
                this._potentialDblClickTarget = null;
            }, this._dblClickTimeout);
            
            if (hit.ruler.showDragPoint1 || hit.ruler.showDragPoint2) {
                this._potentialDrag = { ruler: hit.ruler, pointType: hit.type, startX: bmX, startY: bmY, startPoint1: { ...hit.ruler.point1 }, startPoint2: { ...hit.ruler.point2 } };
            } else {
                this._potentialDrag = null;
            }
            
            this._requestRedraw();
        } else {
            if (this._isDrawingMode && !this._isDrawingSecondPoint) {
                this._startDrawing(x, y);
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (this._selectedRuler) {
                this._selectedRuler.selected = false;
                this._selectedRuler.showDragPoint1 = false;
                this._selectedRuler.showDragPoint2 = false;
                this._selectedRuler = null;
                this._requestRedraw();
            }
            if (rulerMenu) rulerMenu.style.display = 'none';
        }
    }

    // ✅ rAF-THROTTLED С GUARD НА СКРОЛЛ
    _handleMouseMove(e) {
        // Guard: при панорамировании/зуме пропускаем hover
        if (this._chartManager._isScrolling || this._chartManager._isScrollingFast) {
            if (this._hoveredRuler) {
                this._hoveredRuler.hovered = false;
                this._hoveredRuler = null;
                this._requestRedraw();
            }
            return;
        }
        
        this._pendingMouseEvent = e;
        if (this._hoverRafId) return;
        
        this._hoverRafId = requestAnimationFrame(() => {
            this._hoverRafId = null;
            this._processMouseMove(this._pendingMouseEvent);
        });
    }
    
    // ✅ ВЫНЕСЕННАЯ ЛОГИКА MOUSEMOVE
    _processMouseMove(e) {
        const rect = this._chartManager.chartContainer.getBoundingClientRect();
        const cssX = e.clientX - rect.left;
        const cssY = e.clientY - rect.top;
        
        this._lastMouseX = cssX;
        this._lastMouseY = cssY;

        const { x: bmX, y: bmY } = this._toBitmapCoords(cssX, cssY);

        if (this._isDrawingMode && this._isDrawingSecondPoint && this._drawingStartPoint) {
            let price = this._chartManager.coordinateToPrice(cssY);
            let time = this._getExtendedTimeFromX(cssX);
            
            if (price !== null && time !== null) {
                if (!this._tempLine) {
                    this._tempLine = { point1: this._drawingStartPoint, point2: { price, time } };
                    if (!this._tempLinePrimitive) {
                        this._tempLinePrimitive = new TempRulerLinePrimitive(this);
                        const series = this._chartManager.currentChartType === 'candle' ? this._chartManager.candleSeries : this._chartManager.barSeries;
                        if (series) series.attachPrimitive(this._tempLinePrimitive);
                    }
                } else {
                    this._tempLine.point2 = { price, time };
                }
            }
            return;
        }

        if (this._potentialDrag && !this._isDragging) {
            const dx = Math.abs(bmX - this._potentialDrag.startX);
            const dy = Math.abs(bmY - this._potentialDrag.startY);
            if (dx > 1 || dy > 1) {
                this._isDragging = true;
                this._dragRuler = this._potentialDrag.ruler;
                this._dragPoint = this._potentialDrag.pointType;
                this._dragRuler.dragging = true;
                this._dragStartX = this._potentialDrag.startX;
                this._dragStartY = this._potentialDrag.startY;
                this._dragStartPoint1 = { ...this._potentialDrag.startPoint1 };
                this._dragStartPoint2 = { ...this._potentialDrag.startPoint2 };
                this._chartManager.chartContainer.style.cursor = 'grabbing';
            }
        }

        if (this._isDragging && this._dragRuler) {
            e.preventDefault();
            e.stopPropagation();
            
            const deltaX = (bmX - this._dragStartX) / this._pixelRatio;
            const deltaY = (bmY - this._dragStartY) / this._pixelRatio;

            const startPoint = this._dragPoint === 'point1' ? this._dragStartPoint1 : this._dragStartPoint2;
            
            let px = this._chartManager.timeToCoordinate(startPoint.time);
            if (px === null) {
                const chartData = this._chartManager.chartData;
                if (chartData && chartData.length > 1) {
                    const firstTime = chartData[0].time;
                    const lastTime = chartData[chartData.length - 1].time;
                    const firstX = this._chartManager.timeToCoordinate(firstTime);
                    const lastX = this._chartManager.timeToCoordinate(lastTime);
                    if (firstX !== null && lastX !== null) {
                        const barInterval = chartData[1].time - chartData[0].time;
                        const barWidth = (lastX - firstX) / (chartData.length - 1);
                        if (startPoint.time > lastTime) {
                            px = lastX + ((startPoint.time - lastTime) / barInterval) * barWidth;
                        } else {
                            px = firstX - ((firstTime - startPoint.time) / barInterval) * barWidth;
                        }
                    }
                }
            }
            
            const py = this._chartManager.priceToCoordinate(startPoint.price);
            
            if (px !== null && py !== null) {
                const newX = px + deltaX;
                const newY = py + deltaY;
                
                const newPrice = this._chartManager.coordinateToPrice(newY);
                const newTime = this._getExtendedTimeFromX(newX);
                
                if (this._dragPoint === 'point1') {
                    if (newPrice !== null) this._dragRuler.point1.price = newPrice;
                    if (newTime !== null) { this._dragRuler.point1.time = newTime; this._dragRuler.anchorTime1 = newTime; }
                } else {
                    if (newPrice !== null) this._dragRuler.point2.price = newPrice;
                    if (newTime !== null) { this._dragRuler.point2.time = newTime; this._dragRuler.anchorTime2 = newTime; }
                }
            }
            
            const newColor = this._dragRuler._isBullish() ? '#00bcd4' : '#f23645';
            this._dragRuler.options.color = newColor;
            this._requestRedraw();
        } else {
            const hit = this.hitTest(bmX, bmY);
            const hitRuler = hit ? hit.ruler : null;
            if (hitRuler && (hitRuler.showDragPoint1 || hitRuler.showDragPoint2)) {
                this._chartManager.chartContainer.style.cursor = (hit.type === 'point1' || hit.type === 'point2') ? 'move' : 'crosshair';
            } else {
                this._chartManager.chartContainer.style.cursor = 'crosshair';
            }
            if (this._hoveredRuler !== hitRuler) {
                if (this._hoveredRuler) this._hoveredRuler.hovered = false;
                this._hoveredRuler = hitRuler;
                if (hitRuler) hitRuler.hovered = true;
                this._requestRedraw();
            }
        }
    }

    _handleMouseUp(e) {
        if (this._isDragging) {
            e.preventDefault();
            e.stopPropagation();
            this._isDragging = false;
            if (this._dragRuler) {
                this._dragRuler.dragging = false;
                this._dragRuler.anchorTime1 = this._dragRuler.point1.time;
                this._dragRuler.anchorTime2 = this._dragRuler.point2.time;
                if (this._selectedRuler !== this._dragRuler) {
                    this._dragRuler.showDragPoint1 = false;
                    this._dragRuler.showDragPoint2 = false;
                }
                this._saveRulers();
                this._dragRuler = null;
                this._requestRedraw();
            }
            this._chartManager.chartContainer.style.cursor = 'crosshair';
        }
        this._potentialDrag = null;
    }

    _handleGlobalMouseUp(e) {
        if (!this._isDragging) return;
        this._handleMouseUp(e); 
    }

    _handleMouseLeave() {
        if (this._hoveredRuler) {
            this._hoveredRuler.hovered = false;
            this._hoveredRuler = null;
            this._requestRedraw();
        }
        this._chartManager.chartContainer.style.cursor = 'crosshair';
        
        if (this._hoverRafId) {
            cancelAnimationFrame(this._hoverRafId);
            this._hoverRafId = null;
        }
        this._pendingMouseEvent = null;
    }

    _handleContextMenu(e) {
        e.preventDefault();
        e.stopPropagation();
        const rect = this._chartManager.chartContainer.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;
        const { x: bmX, y: bmY } = this._toBitmapCoords(x, y);
        
        const hit = this.hitTest(bmX, bmY);
        if (hit && hit.ruler) {
            if (this._selectedRuler && this._selectedRuler !== hit.ruler) {
                this._selectedRuler.selected = false;
                this._selectedRuler.showDragPoint1 = false;
                this._selectedRuler.showDragPoint2 = false;
            }
            hit.ruler.selected = true;
            hit.ruler.showDragPoint1 = true;
            hit.ruler.showDragPoint2 = true;
            this._selectedRuler = hit.ruler;
            this._requestRedraw();
            const menu = document.getElementById('rulerContextMenu');
            if (menu) {
                const otherMenus = ['drawingContextMenu', 'trendContextMenu', 'alertContextMenu'];
                otherMenus.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
                menu.style.display = 'flex';
                menu.style.left = e.clientX + 'px';
                menu.style.top = e.clientY + 'px';
                const settingsBtn = document.getElementById('rulerSettingsBtn');
                settingsBtn.onclick = null;
                settingsBtn.onclick = (event) => { event.stopPropagation(); this._showSettings(hit.ruler); menu.style.display = 'none'; };
                const deleteBtn = document.getElementById('rulerDeleteBtn');
                deleteBtn.onclick = null;
                deleteBtn.onclick = (event) => { event.stopPropagation(); this.deleteRuler(hit.ruler.id); menu.style.display = 'none'; };
            }
        } else {
            const menu = document.getElementById('rulerContextMenu');
            if (menu) menu.style.display = 'none';
        }
    }

    _startDrawing(x, y) {
        let price = this._chartManager.coordinateToPrice(y);
        let time = this._getExtendedTimeFromX(x);
        
        if (price === null || time === null) {
            const lastCandle = this._chartManager.getLastCandle?.() || (this._chartManager.chartData?.length ? this._chartManager.chartData[this._chartManager.chartData.length - 1] : null);
            if (lastCandle) { 
                price = price ?? lastCandle.close; 
                time = time ?? lastCandle.time; 
            } else {
                return;
            }
        }
        
        this._drawingStartPoint = { price, time, x, y, anchorCandle: null };
        this._isDrawingSecondPoint = true;
        this._tempPoint = { price, time, x, y };
        this._tempLine = null;
        
        const series = this._chartManager.currentChartType === 'candle' ? this._chartManager.candleSeries : this._chartManager.barSeries;
        if (series && !this._tempPointPrimitive) {
            this._tempPointPrimitive = new TempRulerPointPrimitive(this);
            try { series.attachPrimitive(this._tempPointPrimitive); } catch (e) {}
        }
        this._requestRedraw();
    }

    _completeDrawing(x, y) {
        if (!this._drawingStartPoint) return;
        let price = this._chartManager.coordinateToPrice(y);
        let time = this._getExtendedTimeFromX(x);
        
        if (price === null || time === null) {
            const lastCandle = this._chartManager.getLastCandle?.() || (this._chartManager.chartData?.length ? this._chartManager.chartData[this._chartManager.chartData.length - 1] : null);
            if (lastCandle) { 
                price = price ?? lastCandle.close; 
                time = time ?? lastCandle.time; 
            } else {
                return;
            }
        }
        
        const startTime = this._drawingStartPoint.time; 
        const endTime = time;
        let point1, point2;
        
        if (startTime <= endTime) {
            point1 = { price: this._drawingStartPoint.price, time: startTime };
            point2 = { price, time: endTime };
        } else {
            point1 = { price, time: endTime };
            point2 = { price: this._drawingStartPoint.price, time: startTime };
        }
        
        this.createRuler(point1, point2, { anchorCandle1: null, anchorCandle2: null });
        
        const series = this._chartManager.currentChartType === 'candle' ? this._chartManager.candleSeries : this._chartManager.barSeries;
        if (this._tempLinePrimitive) { 
            if (series) try { series.detachPrimitive(this._tempLinePrimitive); } catch(e) {} 
            this._tempLinePrimitive = null; 
            this._tempLine = null; 
        }
        if (this._tempPointPrimitive) { 
            if (series) try { series.detachPrimitive(this._tempPointPrimitive); } catch(e) {} 
            this._tempPointPrimitive = null; 
            this._tempPoint = null; 
        }
        this._drawingStartPoint = null; 
        this._isDrawingSecondPoint = false;
        this._requestRedraw(); 
        this.setDrawingMode(false);
    }

    _showSettings(ruler) {
        const panel = document.getElementById('rulerSettingsPanel');
        if (!panel) return;

        this._selectedRuler = ruler;

        const opacitySlider = document.getElementById('rulerFillOpacity');
        const opacityValue = document.getElementById('rulerFillOpacityValue');

        if (opacitySlider && opacityValue) {
            opacitySlider.value = Math.round((ruler.options.fillOpacity || 0.25) * 100);
            opacityValue.textContent = opacitySlider.value + '%';
        }

        const closeBtn = panel.querySelector('.close-settings');
        if (closeBtn) {
            closeBtn.onclick = null;
            closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        }

        const saveBtn = document.getElementById('rulerSaveSettings');
        if (saveBtn) {
            saveBtn.onclick = null;
            saveBtn.addEventListener('click', () => {
                if (opacitySlider) {
                    ruler.updateOptions({ fillOpacity: parseInt(opacitySlider.value) / 100 });
                    this._requestRedraw();
                    this._saveRulers();
                }
                panel.style.display = 'none';
            });
        }

        const deleteBtn = document.getElementById('rulerDeleteFromSettings');
        if (deleteBtn) {
            deleteBtn.onclick = null;
            deleteBtn.addEventListener('click', () => {
                this.deleteRuler(ruler.id);
                panel.style.display = 'none';
            });
        }

        panel.style.display = 'block';
        panel.style.left = '50%';
        panel.style.top = '50%';
        panel.style.transform = 'translate(-50%, -50%)';

        const closeOnOutsideClick = (e) => {
            if (!panel.contains(e.target) && panel.style.display === 'block') {
                panel.style.display = 'none';
                document.removeEventListener('mousedown', closeOnOutsideClick);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', closeOnOutsideClick), 100);

        if (!panel.dataset.instantBound) {
            panel.dataset.instantBound = 'true';
            opacitySlider.addEventListener('input', () => {
                const val = parseInt(opacitySlider.value) / 100;
                opacityValue.textContent = opacitySlider.value + '%';
                if (this._selectedRuler) {
                    this._selectedRuler.options.fillOpacity = val;
                    if (this._selectedRuler.primitive?.requestRedraw) {
                        this._selectedRuler.primitive.requestRedraw();
                    }
                    this._requestRedraw();
                    this._saveRulers();
                }
            });
        }
    }

    _requestRedraw() {
        this._rulers.forEach(item => { if (item.primitive?.requestRedraw) item.primitive.requestRedraw(); });
        if (this._tempLinePrimitive) this._tempLinePrimitive.requestRedraw();
        if (this._tempPointPrimitive) this._tempPointPrimitive.requestRedraw();
    }

    _applyRedrawIfNeeded() {
        if (this._needsRedraw) {
            this._needsRedraw = false;
            this._rulers?.forEach(item => { 
                if (item.primitive?.requestRedraw) item.primitive.requestRedraw();
            });
            if (this._tempLinePrimitive) this._tempLinePrimitive.requestRedraw();
            if (this._tempPointPrimitive) this._tempPointPrimitive.requestRedraw();
        }
    }

    async _saveRulers() {
        if (this._rulers.length === 0 || !window.db) return;
        const promises = this._rulers.map(item => window.db.put('drawings', { 
            id: item.ruler.id, type: 'ruler', symbolKey: item.ruler.symbolKey, 
            data: { 
                point1: item.ruler.point1, point2: item.ruler.point2, 
                options: item.ruler.options, timeframeVisibility: item.ruler.timeframeVisibility, 
                anchorCandle1: item.ruler.anchorCandle1, anchorCandle2: item.ruler.anchorCandle2, 
                anchorTime1: item.ruler.anchorTime1, anchorTime2: item.ruler.anchorTime2, 
                symbol: item.ruler.symbol, exchange: item.ruler.exchange, marketType: item.ruler.marketType 
            } 
        }).catch(e => console.warn(e)));
        await Promise.all(promises);
    }

    async loadRulers() {
        const currentKey = this._getCurrentSymbolKey();
        if (window.drawingLoaderCoordinator) {
            await window.drawingLoaderCoordinator.loadAllForSymbol(currentKey);
        }
    }

    async loadFromData(symbolKey, rulerRecords) {
        if (this._getCurrentSymbolKey() !== symbolKey) return;

        try {
            const series = this._chartManager.currentChartType === 'candle' 
                ? this._chartManager.candleSeries 
                : this._chartManager.barSeries;

            if (!series) return;

            const ALL_TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '1d', '1w', '1M'];
            const defaultVisibility = {};
            ALL_TFS.forEach(tf => { defaultVisibility[tf] = true; });

            const existingIds = new Set(
                this._rulers.filter(item => item.ruler.symbolKey === symbolKey).map(item => item.ruler.id)
            );
            
            const newRecordIds = new Set(rulerRecords.map(r => r.id));
            
            const toDetach = this._rulers.filter(item => 
                item.ruler.symbolKey === symbolKey && !newRecordIds.has(item.ruler.id)
            );
            
            for (const item of toDetach) {
                try { if (item.series && item.primitive) item.series.detachPrimitive(item.primitive); } catch(e) {}
            }
            
            this._rulers = this._rulers.filter(item => 
                item.ruler.symbolKey !== symbolKey || newRecordIds.has(item.ruler.id)
            );

            const newRulers = [];
            let loadedCount = 0;
            let skippedCount = 0;

            for (const rec of rulerRecords) {
                try {
                    const data = rec.data || rec;
                    
                    if (!data.point1 || !data.point2) {
                        console.warn('⚠️ Ruler пропущен (нет point1/point2):', rec.id);
                        skippedCount++;
                        continue;
                    }

                    if (typeof data.point1.time !== 'number' || typeof data.point1.price !== 'number' ||
                        typeof data.point2.time !== 'number' || typeof data.point2.price !== 'number') {
                        console.warn('⚠️ Ruler пропущен (невалидные координаты):', rec.id);
                        skippedCount++;
                        continue;
                    }

                    const existing = this._rulers.find(item => item.ruler.id === rec.id);
                    
                    if (existing) {
                        existing.ruler.point1 = data.point1;
                        existing.ruler.point2 = data.point2;
                        existing.ruler.options = { ...existing.ruler.options, ...(data.options || {}) };
                        existing.ruler.timeframeVisibility = { ...defaultVisibility, ...(data.timeframeVisibility || {}) };
                        existing.ruler.anchorTime1 = data.anchorTime1;
                        existing.ruler.anchorTime2 = data.anchorTime2;
                        existing.ruler.anchorCandle1 = data.anchorCandle1;
                        existing.ruler.anchorCandle2 = data.anchorCandle2;
                        loadedCount++;
                        continue;
                    }

                    const ruler = new RulerLine(data.point1, data.point2, this._chartManager, data.options);
                    ruler.id = rec.id;
                    ruler.symbolKey = rec.symbolKey || symbolKey;
                    ruler.symbol = data.symbol;
                    ruler.exchange = data.exchange;
                    ruler.marketType = data.marketType;
                    ruler.timeframeVisibility = { ...defaultVisibility, ...(data.timeframeVisibility || {}) };
                    ruler.anchorCandle1 = data.anchorCandle1;
                    ruler.anchorCandle2 = data.anchorCandle2;
                    ruler.anchorTime1 = data.anchorTime1;
                    ruler.anchorTime2 = data.anchorTime2;

                    const primitive = new RulerLinePrimitive(ruler, this._chartManager);
                    series.attachPrimitive(primitive);
                    newRulers.push({ ruler, primitive, series });
                    loadedCount++;
                } catch (e) { 
                    console.warn('Failed to load ruler:', rec.id, e); 
                    skippedCount++;
                }
            }

            this._rulers.push(...newRulers);
            this._invalidateRulersCache();
            this._requestRedraw();
            
            if (skippedCount > 0) {
                console.log(`⚠️ Loaded ${loadedCount}/${rulerRecords.length} rulers for ${symbolKey} (${skippedCount} skipped)`);
            } else {
                console.log(`✅ Loaded ${loadedCount} rulers for ${symbolKey}`);
            }
        } catch (error) {
            console.error('❌ loadFromData failed:', error);
            throw error;
        }
    }

    _detachAllPrimitivesForSymbol(symbolKey) {
        const itemsForSymbol = this._rulers.filter(item => item.ruler.symbolKey === symbolKey);
        for (const item of itemsForSymbol) {
            if (item.primitive && item.series) {
                try { item.series.detachPrimitive(item.primitive); } catch(e) {}
            }
        }
        this._rulers = this._rulers.filter(item => item.ruler.symbolKey !== symbolKey);
        this._invalidateRulersCache();
    }

    syncWithNewTimeframe() {}

    deactivateAll() {
        this._rulers.forEach(item => {
            item.ruler.selected = false;
            item.ruler.showDragPoint1 = false;
            item.ruler.showDragPoint2 = false;
        });
        this._selectedRuler = null;
    }

    activateObject(ruler) {
        ruler.selected = true;
        ruler.showDragPoint1 = true;
        ruler.showDragPoint2 = true;
        this._selectedRuler = ruler;
    }
}
class AlertLineManager {
    constructor(chartManager) {
        this._pixelRatio = window.devicePixelRatio || 1;
        this._alerts = [];
        this._lastPrices = new Map();
        this._chartManager = chartManager;
        this._selectedAlert = null;
        this._hoveredAlert = null;
        this._isDrawingMode = false;
        this._isDragging = false;
        this._dragAlert = null;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._dragStartPrice = 0;
        this._dragStartTime = 0;
        this._lastMouseX = 0;
        this._lastMouseY = 0;
        this._isLoading = false;
        this._potentialDrag = null;
        this._dragThreshold = 5;
        this._dblClickTimer = null;
        this._potentialDblClickTarget = null;
        this._dblClickTimeout = 350;
        this._lastClickTime = 0;
        this._needsRedraw = false;
        this._subscriptions = new Map();
        this._subCheckInterval = null;

        // ✅ ИСПРАВЛЕНО (главный баг): раньше вместо этого флага использовалась проверка
        // "if (this._alerts.length > 0) return;" в setTimeout ниже. Она ЛОЖНО считала,
        // что все алерты уже загружены, если к моменту срабатывания таймера (150мс) уже
        // успели подгрузиться алерты ТОЛЬКО текущего открытого графика (это делает
        // window.drawingLoaderCoordinator параллельно, ещё до этого таймера).
        // Из-за этого loadAllAlertsFromDB() — единственный метод, который тянет алерты
        // ВСЕХ монет, а не только текущей, — вообще никогда не вызывался. В результате
        // алерты на монетах, не открытых в этой сессии на графике, никогда не попадали
        // в this._alerts и, соответственно, никогда не подписывались на цены в
        // PriceManager => никогда не могли сработать. Теперь флаг выставляется только
        // после реального завершения полной загрузки (см. _doLoadAllAlertsFromDB).
        this._allAlertsLoadedFromDB = false;
        this._loadAllAlertsPromise = null;

        // ✅ КЭШ ДЛЯ ФИЛЬТРАЦИИ
        this._alertsCache = null;
        this._alertsCacheKey = null;

        // ✅ rAF THROTTLE ДЛЯ HOVER
        this._pendingMouseEvent = null;
        this._hoverRafId = null;

        this._handleContextMenu = this._handleContextMenu.bind(this);
        this._handleGlobalMouseUp = this._handleGlobalMouseUp.bind(this);
        window.addEventListener('mouseup', this._handleGlobalMouseUp);

        this._setupEventListeners();
        this._setupHotkeys();
        this._setupSettingsListeners();

        if (window.drawingLoaderCoordinator) {
            window.drawingLoaderCoordinator.register(this, 'alert');
        }

        setTimeout(async () => {
            try {
                // ✅ ИСПРАВЛЕНО: было "if (this._alerts.length > 0) return;" — см. комментарий
                // у объявления this._allAlertsLoadedFromDB выше.
                if (this._allAlertsLoadedFromDB) return;
                if (!window.dbReady) {
                    await new Promise(r => {
                        const c = () => window.dbReady ? r() : setTimeout(c, 50);
                        c();
                    });
                }
                await this.loadAllAlertsFromDB();
                this._subscribeAlertsToPriceManager();
            } catch (error) {
                console.error('❌ Auto-load alerts failed:', error);
            }
        }, 150);
    }

    // ✅ КЭШИРОВАННЫЙ МЕТОД
    _getAlertsForCurrentSymbol() {
        const currentKey = this._getCurrentSymbolKey();
        if (this._alertsCacheKey === currentKey && this._alertsCache) {
            return this._alertsCache;
        }
        this._alertsCacheKey = currentKey;
        this._alertsCache = this._alerts.filter(item => item.alert && item.alert.symbolKey === currentKey);
        return this._alertsCache;
    }

    // ✅ ИНВАЛИДАЦИЯ КЭША
    _invalidateAlertsCache() {
        this._alertsCache = null;
        this._alertsCacheKey = null;
    }

    _normalizeSymbol(symbol) {
        return String(symbol || '').toUpperCase().replace(/[_\-]?(PERP|SPOT)$/i, '').replace(/[^A-Z0-9]/g, '');
    }

    _getSubscriptionKey(symbol, exchange, marketType) {
        const cleanSymbol = this._normalizeSymbol(symbol);
        const cleanExchange = String(exchange || 'binance').toLowerCase();
        const cleanMarket = String(marketType || 'futures').toLowerCase();
        return `${cleanSymbol}:${cleanExchange}:${cleanMarket}`;
    }

    _hasActiveAlertsForSymbol(symbol, exchange, marketType, excludeAlertId = null) {
        const targetKey = this._getSubscriptionKey(symbol, exchange, marketType);

        for (const item of this._alerts) {
            const a = item.alert;
            if (!a) continue;
            if (excludeAlertId && a.id === excludeAlertId) continue;
            if (a.status !== 'active') continue;

            const aKey = this._getSubscriptionKey(a.symbol, a.exchange, a.marketType);
            if (aKey === targetKey) return true;
        }

        return false;
    }

    _subscribeAlertsToPriceManager() {
        if (!window.priceManagerInstance) {
            console.warn('⚠️ PriceManager not available, retrying in 1s...');
            setTimeout(() => this._subscribeAlertsToPriceManager(), 1000);
            return;
        }

        for (const item of this._alerts) {
            const a = item.alert;
            if (a.status !== 'active') continue;

            const key = this._getSubscriptionKey(a.symbol, a.exchange, a.marketType);

            if (this._subscriptions.has(key)) continue;

            const handler = (price, symbol, exchange, marketType) => {
                this._checkAlerts(symbol, price, exchange, marketType);
            };

            this._subscriptions.set(key, handler);
            window.priceManagerInstance.subscribe(key, handler);
            console.log(`✅ Подписка: ${key}`);
        }

        if (!this._subCheckInterval) {
            this._subCheckInterval = setInterval(() => {
                this._verifySubscriptions();
            }, 10000);
        }
    }

    _verifySubscriptions() {
        if (!window.priceManagerInstance) {
            this._subscriptions.clear();
            this._subscribeAlertsToPriceManager();
            return;
        }

        for (const item of this._alerts) {
            const a = item.alert;
            if (a.status !== 'active') continue;

            const key = this._getSubscriptionKey(a.symbol, a.exchange, a.marketType);

            if (!this._subscriptions.has(key)) {
                console.warn(`⚠️ Lost subscription for ${key}, resubscribing...`);
                this._subscribeAlertsToPriceManager();
                break;
            }
        }
    }

    // ✅ ИСПРАВЛЕНО (второй баг): раньше подписки на PriceManager нигде корректно не
    // отписывались — только удалялись из локальной this._subscriptions Map, а сам колбэк
    // продолжал висеть внутри window.priceManagerInstance.subscribers. При повторном
    // создании алерта на той же монете это приводило к накоплению дублирующихся
    // обработчиков на один и тот же ключ (лишняя нагрузка на каждый тик цены).
    // Теперь любое место, где раньше было "this._subscriptions.delete(key)",
    // использует этот метод, который сначала реально отписывается от PriceManager.
    _unsubscribeKey(key) {
        const handler = this._subscriptions.get(key);
        if (handler && window.priceManagerInstance) {
            try { window.priceManagerInstance.unsubscribe(key, handler); } catch (e) {}
        }
        this._subscriptions.delete(key);
    }

    _checkAlerts(symbol, price, exchange, market) {
        if (!symbol || !price || isNaN(price)) return;

        const cleanSymbol = this._normalizeSymbol(symbol);
        const cleanExchange = String(exchange || 'binance').toLowerCase();
        const cleanMarket = String(market || 'futures').toLowerCase();

        const items = this._alerts.filter(item => {
            const a = item.alert;
            if (!a || a.status !== 'active') return false;

            const aSym = this._normalizeSymbol(a.symbol);
            const aEx = String(a.exchange || 'binance').toLowerCase();
            const aMk = String(a.marketType || 'futures').toLowerCase();

            return aSym === cleanSymbol && aEx === cleanExchange && aMk === cleanMarket;
        });

        if (items.length === 0) return;

        const now = Date.now();

        for (const item of items) {
            const alert = item.alert;

            const lastPrice = this._lastPrices.get(alert.id);
            this._lastPrices.set(alert.id, price);

            if (lastPrice === undefined) continue;

            if (now - alert.createdAt < 100) continue;

            const triggerLimit = AlertLine.normalizeRepeatCount(alert.repeatCount);

            if (alert.triggerCount >= triggerLimit) {
                alert.complete();
                this._handleAlertCompletion(alert);
                continue;
            }

            const isFirstTrigger = alert.triggerCount === 0;
            let shouldTrigger = false;

            if (isFirstTrigger) {
                const crossedUp = lastPrice <= alert.price && price >= alert.price;
                const crossedDown = lastPrice >= alert.price && price <= alert.price;

                if (alert.direction === 'above' && crossedUp) shouldTrigger = true;
                else if (alert.direction === 'below' && crossedDown) shouldTrigger = true;
                else if (alert.direction === 'both' && (crossedUp || crossedDown)) shouldTrigger = true;

                if (shouldTrigger) {
                    alert._firstTriggerTime = now;
                    alert._firstTriggerPrice = price;
                }
            } else {
                const intervalMs = (alert.repeatInterval || 1) * 60000;
                const msSinceLast = now - alert.lastTriggerTime;

                if (msSinceLast >= intervalMs) {
                    shouldTrigger = true;
                }
            }

            if (shouldTrigger) {
                const isRepeat = alert.triggerCount > 0;
                console.log(`🔥 ТРИГГЕР: ${alert.symbol} @ ${alert.price} (${isRepeat ? 'ПОВТОР ПО ТАЙМЕРУ' : 'ПЕРВОЕ ПЕРЕСЕЧЕНИЕ'} ${alert.triggerCount + 1}/${triggerLimit === Infinity ? '∞' : triggerLimit})`);

                alert.triggerCount++;
                alert.lastTriggerTime = now;
                alert.active = true;

                this._saveAlerts();
                this._updateAlertsListUI();
                this._startInfiniteHighlight(alert.id);
                this._showAlertNotification(alert, price, isRepeat);
                this._sendTelegramAlert(alert, price, isRepeat);
                this._requestRedraw();

                if (alert.triggerCount >= triggerLimit) {
                    alert.complete();
                    this._handleAlertCompletion(alert);
                }
            }
        }
    }

    _handleAlertCompletion(alert) {
        this._stopHighlight(alert.id);

        const alertItem = this._alerts.find(i => i.alert.id === alert.id);
        if (alertItem && alertItem.primitive && alertItem.series) {
            try {
                alertItem.series.detachPrimitive(alertItem.primitive);
            } catch(e) {
                console.warn('Failed to detach primitive:', e);
            }
            alertItem.primitive = null;
            alertItem.series = null;
        }

        const key = this._getSubscriptionKey(alert.symbol, alert.exchange, alert.marketType);

        if (!this._hasActiveAlertsForSymbol(alert.symbol, alert.exchange, alert.marketType, alert.id)) {
            this._unsubscribeKey(key); // ✅ ИСПРАВЛЕНО: было this._subscriptions.delete(key)
            console.log(`🔌 Отписка: ${key} (нет активных алертов)`);
        }

        this._saveAlerts();
        this._updateAlertsListUI();

        setTimeout(() => this._highlightTriggeredAlert(alert.id), 200);
    }

    async loadFromData(symbolKey, alertRecords) {
        try {
            const currentSymbolKey = this._getCurrentSymbolKey();
            const isCurrentSymbol = (currentSymbolKey === symbolKey);

            const series = isCurrentSymbol
                ? (this._chartManager.currentChartType === 'candle'
                    ? this._chartManager.candleSeries
                    : this._chartManager.barSeries)
                : null;

            if (isCurrentSymbol && !series) {
                console.warn('No series available for current symbol');
                return;
            }

            const ALL_TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '1d', '1w', '1M'];
            const defaultVisibility = {};
            ALL_TFS.forEach(tf => { defaultVisibility[tf] = true; });

            const newRecordIds = new Set(alertRecords.map(a => a.id));

            if (isCurrentSymbol) {
                const toDetach = this._alerts.filter(item =>
                    item.alert.symbolKey === symbolKey && !newRecordIds.has(item.alert.id)
                );
                for (const item of toDetach) {
                    try {
                        if (item.primitive && item.series) item.series.detachPrimitive(item.primitive);
                        item.primitive = null;
                        item.series = null;
                    } catch(e) {}
                }
            }

            this._alerts = this._alerts.filter(item =>
                item.alert.symbolKey !== symbolKey || newRecordIds.has(item.alert.id)
            );

            const newAlerts = [];
            for (const rec of alertRecords) {
                try {
                    const existing = this._alerts.find(item => item.alert.id === rec.id);

                    if (existing) {
                        existing.alert.price = rec.data.price;
                        existing.alert.time = rec.data.time;
                        existing.alert.anchorTime = rec.data.anchorTime || rec.data.time;
                        existing.alert.options = { ...existing.alert.options, ...rec.data.options };
                        existing.alert.timeframeVisibility = { ...defaultVisibility, ...(rec.data.timeframeVisibility || {}) };
                        existing.alert.triggered = rec.data.triggered || false;
                        existing.alert.triggerCount = rec.data.triggerCount || 0;
                        existing.alert.repeatCount = rec.data.repeatCount ?? 5;
                        existing.alert.repeatInterval = rec.data.repeatInterval ?? 1;
                        existing.alert.lastTriggerTime = rec.data.lastTriggerTime || null;
                        existing.alert.active = rec.data.active || false;
                        existing.alert.status = rec.data.status || 'active';
                        existing.alert.anchorCandle = rec.data.anchorCandle || null;
                        existing.alert.symbol = rec.data.symbol || existing.alert.symbol;
                        existing.alert.exchange = rec.data.exchange || existing.alert.exchange;
                        existing.alert.marketType = rec.data.marketType || existing.alert.marketType;

                        if (isCurrentSymbol &&
                            existing.alert.status === 'active' &&
                            (!existing.primitive || !existing.series)) {
                            const primitive = new AlertLinePrimitive(existing.alert, this._chartManager);
                            try {
                                series.attachPrimitive(primitive);
                                existing.primitive = primitive;
                                existing.series = series;
                            } catch(e) {}
                        }
                        continue;
                    }

                    const alert = new AlertLine(rec.data.price, rec.data.time, rec.data.options);
                    alert.id = rec.id;
                    alert.symbolKey = rec.symbolKey;
                    alert.anchorTime = rec.data.anchorTime || rec.data.time;
                    alert.symbol = rec.data.symbol;
                    alert.exchange = rec.data.exchange || 'binance';
                    alert.marketType = rec.data.marketType || 'futures';
                    alert.timeframeVisibility = { ...defaultVisibility, ...(rec.data.timeframeVisibility || {}) };
                    alert.triggered = rec.data.triggered || false;
                    alert.triggerCount = rec.data.triggerCount || 0;
                    alert.repeatCount = rec.data.repeatCount ?? 5;
                    alert.repeatInterval = rec.data.repeatInterval ?? 1;
                    alert.lastTriggerTime = rec.data.lastTriggerTime || null;
                    alert.active = rec.data.active || false;
                    alert.status = rec.data.status || 'active';
                    alert.anchorCandle = rec.data.anchorCandle || null;

                    if (isCurrentSymbol && alert.status === 'active') {
                        const primitive = new AlertLinePrimitive(alert, this._chartManager);
                        try {
                            series.attachPrimitive(primitive);
                            newAlerts.push({ alert, primitive, series });
                        } catch(e) {
                            newAlerts.push({ alert, primitive: null, series: null });
                        }
                    } else {
                        newAlerts.push({ alert, primitive: null, series: null });
                    }
                } catch (e) {
                    console.warn('Failed to load alert:', rec.id, e);
                }
            }

            this._alerts.push(...newAlerts);
            this._invalidateAlertsCache();

            if (isCurrentSymbol) {
                this._subscribeAlertsToPriceManager();
                this._updateAlertsListUI();
                this._requestRedraw();
            }

            console.log(`✅ Loaded ${alertRecords.length} alerts for ${symbolKey}`);
        } catch (error) {
            console.error('❌ loadFromData failed:', error);
            throw error;
        }
    }

    // ✅ ИСПРАВЛЕНО: обёртка-дедупликатор поверх реальной загрузки (_doLoadAllAlertsFromDB).
    // Если метод вызывается ещё раз, пока предыдущий вызов не завершился (например,
    // параллельно из конструктора и откуда-то ещё), мы просто ждём уже идущий вызов,
    // вместо того чтобы читать всю БД второй раз параллельно.
    async loadAllAlertsFromDB() {
        if (this._loadAllAlertsPromise) return this._loadAllAlertsPromise;
        this._loadAllAlertsPromise = this._doLoadAllAlertsFromDB();
        try {
            await this._loadAllAlertsPromise;
        } finally {
            this._loadAllAlertsPromise = null;
        }
    }

    async _doLoadAllAlertsFromDB() {
        try {
            if (!window.db) return;
            const allRecords = await window.db.getAll('drawings');
            if (!allRecords || allRecords.length === 0) {
                // ✅ ИСПРАВЛЕНО: даже если алертов в БД вообще нет, считаем полную
                // загрузку выполненной, чтобы флаг this._allAlertsLoadedFromDB не остался
                // навсегда false и не блокировал логику выше.
                this._allAlertsLoadedFromDB = true;
                return;
            }

            const alertsBySymbol = {};
            for (const record of allRecords) {
                if (record.type !== 'alert') continue;
                const key = record.symbolKey || `${record.data.symbol}:${record.data.exchange}:${record.data.marketType}`;
                if (!alertsBySymbol[key]) alertsBySymbol[key] = [];
                alertsBySymbol[key].push(record);
            }

            for (const [symbolKey, records] of Object.entries(alertsBySymbol)) {
                await this.loadFromData(symbolKey, records);
            }

            // ✅ ИСПРАВЛЕНО: флаг ставится ТОЛЬКО здесь, после того как реально прошли
            // по всем монетам из БД — а не по факту "в this._alerts что-то есть".
            this._allAlertsLoadedFromDB = true;

            this._subscribeAlertsToPriceManager();
            console.log(`✅ All alerts loaded (${this._alerts.length} total)`);
        } catch (error) {
            console.error('❌ loadAllAlertsFromDB failed:', error);
        }
    }

    async loadAlerts() {
        const currentKey = this._getCurrentSymbolKey();
        if (window.drawingLoaderCoordinator) {
            await window.drawingLoaderCoordinator.loadAllForSymbol(currentKey);
        }
    }

    createAlert(price, time, options = {}) {
        const defaultVisibility = {
            '1m': true, '3m': true, '5m': true, '15m': true, '30m': true,
            '1h': true, '4h': true, '6h': true, '12h': true,
            '1d': true, '1w': true, '1M': true
        };

        const timeframeVisibility = options.timeframeVisibility || defaultVisibility;
        const exchange = this._chartManager.currentExchange || 'binance';
        const rawSymbol = this._chartManager.currentSymbol || 'BTCUSDT';
        const cleanSymbol = rawSymbol.toUpperCase().replace(/[^A-Z0-9]/g, '');

        const alert = new AlertLine(price, time, {
            ...options,
            symbol: cleanSymbol,
            exchange: exchange,
            marketType: this._chartManager.currentMarketType || 'futures',
            timeframeVisibility: timeframeVisibility,
            repeatCount: options.repeatCount ?? 5,
            repeatInterval: options.repeatInterval ?? 1,
            triggerCount: options.triggerCount || 0,
            lastTriggerTime: options.lastTriggerTime || null,
            active: options.active || false,
            status: options.status || 'active'
        });

        alert.anchorTime = time;
        alert.triggered = options.triggered || false;
        alert.symbolKey = this._getCurrentSymbolKey();

        let primitive = null;
        let series = null;

        if (alert.status === 'active') {
            primitive = new AlertLinePrimitive(alert, this._chartManager);
            series = this._chartManager.currentChartType === 'candle'
                ? this._chartManager.candleSeries
                : this._chartManager.barSeries;
            if (series) {
                try {
                    series.attachPrimitive(primitive);
                } catch(e) {
                    console.warn('Failed to attach primitive:', e);
                    primitive = null;
                }
            }
        }

        this._alerts.push({ alert, primitive, series });
        this._invalidateAlertsCache();

        this._subscribeAlertsToPriceManager();
        this._saveAlerts();
        this._updateAlertsListUI();

        console.log(`✅ Alert created: ${alert.symbol} at ${price} (${alert.exchange}:${alert.marketType})`);
        return alert;
    }

    deleteAlert(alertId) {
        const index = this._alerts.findIndex(a => a.alert.id === alertId);
        if (index === -1) return false;

        const { alert, primitive, series } = this._alerts[index];

        this._stopHighlight(alertId);

        if (window.db) {
            window.db.delete('drawings', alertId).catch(e => console.warn('DB delete error:', e));
        }

        if (primitive && series) {
            try {
                series.detachPrimitive(primitive);
            } catch (e) {
                console.warn('Failed to detach primitive:', e);
            }
        }

        const key = this._getSubscriptionKey(alert.symbol, alert.exchange, alert.marketType);

        if (!this._hasActiveAlertsForSymbol(alert.symbol, alert.exchange, alert.marketType, alertId)) {
            this._unsubscribeKey(key); // ✅ ИСПРАВЛЕНО: было this._subscriptions.delete(key)
            console.log(`🔌 Отписка: ${key} (нет активных алертов)`);
        }

        this._alerts.splice(index, 1);
        this._invalidateAlertsCache();

        if (this._selectedAlert?.id === alertId) {
            this._selectedAlert = null;
        }
        if (this._dragAlert?.id === alertId) {
            this._dragAlert = null;
        }
        this._lastPrices.delete(alertId);

        this._saveAlerts();
        this._updateAlertsListUI();
        this._requestRedraw();

        console.log(`🗑️ Alert deleted: ${alert.symbol} ${alert.price}`);
        return true;
    }

    pauseAlert(alertId) {
        const item = this._alerts.find(a => a.alert.id === alertId);
        if (item && item.alert.status === 'active') {
            item.alert.pause();

            const key = this._getSubscriptionKey(item.alert.symbol, item.alert.exchange, item.alert.marketType);
            if (!this._hasActiveAlertsForSymbol(item.alert.symbol, item.alert.exchange, item.alert.marketType)) {
                this._unsubscribeKey(key); // ✅ ИСПРАВЛЕНО: было this._subscriptions.delete(key)
                console.log(`🔌 Отписка: ${key} (нет активных алертов)`);
            }

            this._saveAlerts();
            this._updateAlertsListUI();
            this._requestRedraw();
            return true;
        }
        return false;
    }

    resumeAlert(alertId) {
        const item = this._alerts.find(a => a.alert.id === alertId);
        if (item && item.alert.status === 'paused') {
            item.alert.resume();
            if (!item.primitive && item.alert.status === 'active') {
                const primitive = new AlertLinePrimitive(item.alert, this._chartManager);
                const series = this._chartManager.currentChartType === 'candle'
                    ? this._chartManager.candleSeries
                    : this._chartManager.barSeries;
                if (series) {
                    try {
                        series.attachPrimitive(primitive);
                        item.primitive = primitive;
                        item.series = series;
                    } catch(e) {
                        console.warn('Failed to attach primitive on resume:', e);
                    }
                }
            }
            this._subscribeAlertsToPriceManager();
            this._saveAlerts();
            this._updateAlertsListUI();
            this._requestRedraw();
            return true;
        }
        return false;
    }

    deleteAllAlerts() {
        const currentSymbolKey = this._getCurrentSymbolKey();
        const currentSymbol = this._chartManager.currentSymbol;
        const alertsToDelete = this._alerts.filter(item => item.alert.symbolKey === currentSymbolKey);
        if (alertsToDelete.length === 0) return;
        if (!confirm(`Удалить ВСЕ алерты для ${currentSymbol}? (${alertsToDelete.length} шт.)`)) return;

        const keysToRemove = new Set();

        alertsToDelete.forEach(item => {
            if (window.db) window.db.delete('drawings', item.alert.id).catch(e => console.warn(e));
            if (item.primitive && item.series) {
                try { item.series.detachPrimitive(item.primitive); } catch(e) {}
            }

            const key = this._getSubscriptionKey(item.alert.symbol, item.alert.exchange, item.alert.marketType);
            keysToRemove.add(key);

            this._lastPrices.delete(item.alert.id);
            const index = this._alerts.indexOf(item);
            if (index !== -1) this._alerts.splice(index, 1);
        });

        this._invalidateAlertsCache();

        for (const key of keysToRemove) {
            this._unsubscribeKey(key); // ✅ ИСПРАВЛЕНО: было this._subscriptions.delete(key)
            console.log(`🔌 Отписка: ${key}`);
        }

        this._saveAlerts();
        this._updateAlertsListUI();
        this._requestRedraw();
    }

    deleteCompletedAlerts() {
        const completedAlerts = this._alerts.filter(item =>
            item.alert.status === 'completed'
        );
        if (completedAlerts.length === 0) return;
        if (!confirm(`Удалить ${completedAlerts.length} завершенных алертов?`)) return;

        completedAlerts.forEach(item => {
            if (window.db) window.db.delete('drawings', item.alert.id).catch(e => console.warn(e));
            if (item.primitive && item.series) {
                try { item.series.detachPrimitive(item.primitive); } catch(e) {}
            }
            this._lastPrices.delete(item.alert.id);
            const index = this._alerts.indexOf(item);
            if (index !== -1) this._alerts.splice(index, 1);
        });

        this._invalidateAlertsCache();
        this._saveAlerts();
        this._updateAlertsListUI();
        this._requestRedraw();
    }

    hitTest(x, y) {
        if (this._selectedAlert) {
            const selItem = this._alerts.find(item => item.alert === this._selectedAlert);
            if (selItem?.primitive?._paneView?._renderer) {
                try {
                    const hit = selItem.primitive._paneView._renderer.hitTest(x, y);
                    if (hit) return { alert: this._selectedAlert, type: hit.type, distance: hit.distance };
                } catch (e) {}
            }
        }

        let bestHit = null;
        let bestDistance = Infinity;

        for (const item of this._alerts) {
            if (!item.primitive?._paneView?._renderer) continue;
            if (item.alert === this._selectedAlert) continue;
            try {
                const hit = item.primitive._paneView._renderer.hitTest(x, y);
                if (hit && hit.distance !== undefined && hit.distance < bestDistance) {
                    bestHit = { alert: item.alert, type: hit.type, distance: hit.distance };
                    bestDistance = hit.distance;
                }
            } catch (e) {}
        }

        return bestHit;
    }

    setDrawingMode(enabled) {
        this._isDrawingMode = enabled;
        const alertBtn = document.getElementById('toolAlert');
        if (alertBtn) {
            if (enabled) {
                alertBtn.style.background = '#4A90E2';
                alertBtn.style.color = '#FFFFFF';
                alertBtn.classList.add('active');
                if (window.rayManager) window.rayManager.setDrawingMode(false);
                if (window.trendLineManager) window.trendLineManager.setDrawingMode(false);
                if (window.rulerLineManager) window.rulerLineManager.setDrawingMode(false);
                if (window.textManager) window.textManager.setDrawingMode(false);
            } else {
                alertBtn.style.background = '';
                alertBtn.style.color = '';
                alertBtn.classList.remove('active');
            }
        }
    }

    deactivateAll() {
        this._alerts.forEach(item => {
            if (item.alert) {
                item.alert.selected = false;
                item.alert.showDragPoint = false;
            }
        });
        this._selectedAlert = null;
    }

    setMagnetEnabled(enabled) {
    }

    activateObject(alert) {
        alert.selected = true;
        alert.showDragPoint = true;
        this._selectedAlert = alert;
    }

    syncWithNewTimeframe() {
        for (const item of this._alerts) {
            if (item.primitive) item.primitive.updateAllViews();
        }
    }

    _toBitmapCoords(cssX, cssY) {
        return { x: cssX * this._pixelRatio, y: cssY * this._pixelRatio };
    }

    _getCurrentSymbolKey() {
        const symbol = this._chartManager.currentSymbol || 'BTCUSDT';
        const exchange = this._chartManager.currentExchange || 'binance';
        const marketType = this._chartManager.currentMarketType || 'futures';
        return `${symbol}:${exchange}:${marketType}`;
    }

    _getTimeFromCoordinate(x) {
        let time = this._chartManager.coordinateToTime(x);
        if (time !== null) return time;

        const data = this._chartManager.chartData;
        if (!data.length) return null;

        const firstCandle = data[0];
        const lastCandle = data[data.length - 1];
        const firstX = this._chartManager.timeToCoordinate(firstCandle.time);
        const lastX = this._chartManager.timeToCoordinate(lastCandle.time);

        if (firstX === null || lastX === null) return null;

        const timeDiff = lastCandle.time - firstCandle.time;
        if (timeDiff === 0) return lastCandle.time;

        if (x > lastX) {
            const deltaX = x - lastX;
            const pixelsPerMs = (lastX - firstX) / timeDiff;
            return lastCandle.time + deltaX / pixelsPerMs;
        }
        if (x < firstX) {
            const deltaX = firstX - x;
            const pixelsPerMs = (lastX - firstX) / timeDiff;
            return firstCandle.time - deltaX / pixelsPerMs;
        }
        return null;
    }

    _requestRedraw() {
        this._alerts.forEach(item => {
            if (item.primitive?.requestRedraw) item.primitive.requestRedraw();
        });
    }

    _applyRedrawIfNeeded() {
        if (this._needsRedraw) {
            this._needsRedraw = false;
            this._alerts?.forEach(item => {
                if (item.primitive?.requestRedraw) item.primitive.requestRedraw();
            });
        }
    }

    async _saveAlerts() {
        if (!window.db) {
            console.warn('⚠️ DB not available, alerts saved to memory only');
            return;
        }

        const promises = this._alerts.map(item => {
            const alert = item.alert;
            return window.db.put('drawings', {
                id: alert.id,
                type: 'alert',
                symbolKey: alert.symbolKey || this._getCurrentSymbolKey(),
                data: {
                    price: alert.price,
                    time: alert.time,
                    anchorTime: alert.anchorTime || alert.time,
                    symbol: alert.symbol,
                    exchange: alert.exchange || 'binance',
                    marketType: alert.marketType || 'futures',
                    options: alert.options || {},
                    timeframeVisibility: alert.timeframeVisibility || {},
                    triggered: alert.triggered || false,
                    triggerCount: alert.triggerCount || 0,
                    repeatCount: alert.repeatCount ?? 5,
                    repeatInterval: alert.repeatInterval ?? 1,
                    lastTriggerTime: alert.lastTriggerTime || null,
                    active: alert.active || false,
                    status: alert.status || 'active',
                    anchorCandle: alert.anchorCandle || null
                }
            }).catch(e => {
                console.warn(`Save alert error (${alert.id}):`, e);
            });
        });

        await Promise.allSettled(promises);
    }

    _setupHotkeys() {
        document.addEventListener('keydown', (e) => {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

            if (e.code === 'KeyI' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                this.setDrawingMode(!this._isDrawingMode);
            }

            if (e.key === 'Delete' && this._selectedAlert && this._selectedAlert.showDragPoint === true) {
                e.preventDefault();
                this.deleteAlert(this._selectedAlert.id);
                this._selectedAlert = null;
            }
        });
    }

    _setupEventListeners() {
        const container = this._chartManager.chartContainer;

        container.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;

            if (e.target.closest('#alertSettings') ||
                e.target.closest('#trendSettings') ||
                e.target.closest('#textSettings') ||
                e.target.closest('#rulerSettingsPanel') ||
                e.target.closest('#drawingSettings')) {
                return;
            }

            const rect = container.getBoundingClientRect();
            let x = e.clientX - rect.left;
            let y = e.clientY - rect.top;
            const { x: bmX, y: bmY } = this._toBitmapCoords(x, y);

            const hit = this.hitTest(bmX, bmY);
            if (hit) {
                e.preventDefault();
                e.stopPropagation();

                const now = Date.now();

                if (this._dblClickTimer && this._potentialDblClickTarget === hit.alert && now - this._lastClickTime < this._dblClickTimeout) {
                    clearTimeout(this._dblClickTimer);
                    this._dblClickTimer = null;
                    this._potentialDblClickTarget = null;
                    this._lastClickTime = 0;
                    hit.alert.showDragPoint = !hit.alert.showDragPoint;
                    this._requestRedraw();
                    return;
                }

                if (this._selectedAlert && this._selectedAlert !== hit.alert) {
                    this._selectedAlert.selected = false;
                    this._selectedAlert.showDragPoint = false;
                }
                hit.alert.selected = true;
                this._selectedAlert = hit.alert;

                this._potentialDblClickTarget = hit.alert;
                this._lastClickTime = now;
                if (this._dblClickTimer) clearTimeout(this._dblClickTimer);
                this._dblClickTimer = setTimeout(() => {
                    this._dblClickTimer = null;
                    this._potentialDblClickTarget = null;
                }, this._dblClickTimeout);

                if (hit.alert.showDragPoint) {
                    const alertX = this._chartManager.timeToCoordinate(hit.alert.time);
                    const alertY = this._chartManager.priceToCoordinate(hit.alert.price);
                    if (alertX !== null && alertY !== null) {
                        hit.alert.dragPointX = alertX;
                        hit.alert.dragPointY = alertY;
                    }
                    this._potentialDrag = { alert: hit.alert, startX: bmX, startY: bmY, startPrice: hit.alert.price, startTime: hit.alert.time };
                } else {
                    this._potentialDrag = null;
                }

                this._requestRedraw();
            } else {
                const alertMenu = document.getElementById('alertContextMenu');
                if (alertMenu && alertMenu.style.display === 'flex') {
                    const menuRect = alertMenu.getBoundingClientRect();
                    const isClickInsideMenu = e.clientX >= menuRect.left && e.clientX <= menuRect.right && e.clientY >= menuRect.top && e.clientY <= menuRect.bottom;
                    if (isClickInsideMenu) return;
                }
                if (this._selectedAlert) {
                    this._selectedAlert.selected = false;
                    this._selectedAlert.showDragPoint = false;
                    this._selectedAlert = null;
                }
                if (alertMenu) alertMenu.style.display = 'none';
                this._requestRedraw();
            }
        });

        // ✅ rAF-THROTTLED MOUSEMOVE С GUARD НА СКРОЛЛ
        container.addEventListener('mousemove', (e) => {
            // Guard: при панорамировании/зуме пропускаем hover
            if (this._chartManager._isScrolling || this._chartManager._isScrollingFast) {
                if (this._hoveredAlert) {
                    this._hoveredAlert.hovered = false;
                    this._hoveredAlert = null;
                    this._requestRedraw();
                }
                return;
            }

            this._pendingMouseEvent = e;
            if (this._hoverRafId) return;

            this._hoverRafId = requestAnimationFrame(() => {
                this._hoverRafId = null;
                this._processMouseMove(this._pendingMouseEvent);
            });
        });

        container.addEventListener('mouseup', (e) => {
            this._potentialDrag = null;
            if (this._isDragging) {
                e.preventDefault(); e.stopPropagation();
                this._isDragging = false;
                if (this._dragAlert) {
                    this._dragAlert.dragging = false;
                    this._dragAlert.attached = false;
                    this._dragAlert.anchorTime = this._dragAlert.time;
                    this._saveAlerts();
                    this._dragAlert = null;
                    this._requestRedraw();
                }
                container.style.cursor = 'crosshair';
                setTimeout(() => {
                    const moveEvent = new MouseEvent('mousemove', { clientX: e.clientX, clientY: e.clientY });
                    container.dispatchEvent(moveEvent);
                }, 10);
            }
        });

        container.addEventListener('mouseleave', () => {
            if (this._hoveredAlert) { this._hoveredAlert.hovered = false; this._hoveredAlert = null; this._requestRedraw(); }
            container.style.cursor = 'crosshair';

            if (this._hoverRafId) {
                cancelAnimationFrame(this._hoverRafId);
                this._hoverRafId = null;
            }
            this._pendingMouseEvent = null;
        });

        container.addEventListener('click', (e) => {
            if (this._isDragging) { e.preventDefault(); e.stopPropagation(); }
            if (this._isDrawingMode) this._handleChartClick(e);
        });

        container.addEventListener('contextmenu', this._handleContextMenu);
    }

    // ✅ ВЫНЕСЕННАЯ ЛОГИКА MOUSEMOVE
    _processMouseMove(e) {
        const container = this._chartManager.chartContainer;
        const rect = container.getBoundingClientRect();
        const cssX = e.clientX - rect.left;
        const cssY = e.clientY - rect.top;

        this._lastMouseX = cssX;
        this._lastMouseY = cssY;

        const { x: bmX, y: bmY } = this._toBitmapCoords(cssX, cssY);

        if (this._potentialDrag && !this._isDragging) {
            const dx = Math.abs(bmX - this._potentialDrag.startX);
            const dy = Math.abs(bmY - this._potentialDrag.startY);
            if (dx > this._dragThreshold || dy > this._dragThreshold) {
                this._isDragging = true;
                this._dragAlert = this._potentialDrag.alert;
                this._dragAlert.dragging = true;
                this._dragStartX = this._potentialDrag.startX;
                this._dragStartY = this._potentialDrag.startY;
                this._dragStartPrice = this._potentialDrag.startPrice;
                this._dragStartTime = this._potentialDrag.startTime;
                container.style.cursor = 'grabbing';
            }
        }

        if (this._isDragging && this._dragAlert) {
            e.preventDefault(); e.stopPropagation();

            const deltaX = (bmX - this._dragStartX) / this._pixelRatio;
            const deltaY = (bmY - this._dragStartY) / this._pixelRatio;

            const alertX = this._chartManager.timeToCoordinate(this._dragStartTime);
            const alertY = this._chartManager.priceToCoordinate(this._dragStartPrice);
            if (alertX !== null && alertY !== null) {
                const newX = alertX + deltaX;
                const newY = alertY + deltaY;
                const newPrice = this._chartManager.coordinateToPrice(newY);
                const newTime = this._chartManager.coordinateToTime(newX);
                if (newPrice !== null) this._dragAlert.price = newPrice;
                if (newTime !== null) { this._dragAlert.time = newTime; this._dragAlert.anchorTime = newTime; }
                const newAlertX = this._chartManager.timeToCoordinate(this._dragAlert.time);
                const newAlertY = this._chartManager.priceToCoordinate(this._dragAlert.price);
                if (newAlertX !== null && newAlertY !== null) {
                    this._dragAlert.dragPointX = newAlertX;
                    this._dragAlert.dragPointY = newAlertY;
                }
                this._requestRedraw();
            }
        } else {
            const hit = this.hitTest(bmX, bmY);
            const hitAlert = hit ? hit.alert : null;
            container.style.cursor = hitAlert ? 'grab' : 'crosshair';
            if (this._hoveredAlert !== hitAlert) {
                if (this._hoveredAlert) this._hoveredAlert.hovered = false;
                this._hoveredAlert = hitAlert;
                if (hitAlert) hitAlert.hovered = true;
                this._requestRedraw();
            }
        }
    }

    _handleGlobalMouseUp(e) {
        if (!this._isDragging) return;

        this._isDragging = false;
        this._potentialDrag = null;

        if (this._dragAlert) {
            this._dragAlert.dragging = false;
            this._dragAlert.attached = false;
            this._dragAlert.anchorTime = this._dragAlert.time;
            this._saveAlerts();
            this._dragAlert = null;
            this._requestRedraw();
        }

        this._chartManager.chartContainer.style.cursor = 'crosshair';
    }

    _handleChartClick(event) {
        if (!this._isDrawingMode) return;

        const rect = this._chartManager.chartContainer.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        let price = this._chartManager.coordinateToPrice(y);
        let time = this._getTimeFromCoordinate(x);

        if (price === null || time === null) {
            const lastCandle = this._chartManager.getLastCandle();
            if (lastCandle) {
                price = lastCandle.close;
                time = lastCandle.time;
            } else return;
        }

        this.createAlert(price, time, {
            color: document.getElementById('alertCurrentColorBox')?.style.backgroundColor || '#808080',
            lineWidth: parseInt(document.getElementById('alertSettingThickness')?.value) || 2,
            lineStyle: document.getElementById('alertTemplateSelect')?.value || 'dotted',
            opacity: parseInt(document.getElementById('alertColorOpacity')?.value) / 100 || 0.26,
            showPrice: true,
            showBell: document.getElementById('alertShowBell')?.checked || true,
            repeatCount: document.getElementById('alertRepeatCount')?.value === 'Infinity' ? Infinity : parseInt(document.getElementById('alertRepeatCount')?.value) || 5,
            repeatInterval: parseInt(document.getElementById('alertRepeatInterval')?.value) || 1,
            anchorCandle: null,
            status: 'active'
        });

        this.setDrawingMode(false);
    }

    _handleContextMenu(e) {
        e.preventDefault(); e.stopPropagation();
        const rect = this._chartManager.chartContainer.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;
        const { x: bmX, y: bmY } = this._toBitmapCoords(x, y);

        const hit = this.hitTest(bmX, bmY);
        if (hit) {
            if (this._selectedAlert && this._selectedAlert !== hit.alert) {
                this._selectedAlert.selected = false;
                this._selectedAlert.showDragPoint = false;
                this._selectedAlert.attached = false;
            }
            hit.alert.selected = true;
            hit.alert.showDragPoint = true;
            hit.alert.attached = false;
            const alertX = this._chartManager.timeToCoordinate(hit.alert.time);
            const alertY = this._chartManager.priceToCoordinate(hit.alert.price);
            if (alertX !== null && alertY !== null) {
                hit.alert.dragPointX = alertX;
                hit.alert.dragPointY = alertY;
            }
            this._selectedAlert = hit.alert;
            this._requestRedraw();

            const menu = document.getElementById('alertContextMenu');
            if (menu) {
                document.getElementById('drawingContextMenu').style.display = 'none';
                document.getElementById('trendContextMenu').style.display = 'none';
                menu.style.display = 'flex';
                menu.style.left = e.clientX + 'px';
                menu.style.top = e.clientY + 'px';

                const copyBtn = document.getElementById('alertContextCopyBtn');
                const newCopyBtn = copyBtn.cloneNode(true);
                copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
                newCopyBtn.onclick = (event) => { event.stopPropagation(); navigator.clipboard?.writeText(Utils.formatPrice(hit.alert.price)); menu.style.display = 'none'; };

                const settingsBtn = document.getElementById('alertContextSettingsBtn');
                const newSettingsBtn = settingsBtn.cloneNode(true);
                settingsBtn.parentNode.replaceChild(newSettingsBtn, settingsBtn);
                newSettingsBtn.onclick = (event) => { event.stopPropagation(); this._showSettings(hit.alert); menu.style.display = 'none'; };

                const pauseBtn = document.getElementById('alertContextPauseBtn');
                if (pauseBtn) {
                    const newPauseBtn = pauseBtn.cloneNode(true);
                    pauseBtn.parentNode.replaceChild(newPauseBtn, pauseBtn);
                    newPauseBtn.textContent = hit.alert.status === 'paused' ? '▶️ Возобновить' : '⏸️ Пауза';
                    newPauseBtn.onclick = (event) => {
                        event.stopPropagation();
                        if (hit.alert.status === 'paused') hit.alert.resume();
                        else hit.alert.pause();
                        this._saveAlerts();
                        this._updateAlertsListUI();
                        this._requestRedraw();
                        menu.style.display = 'none';
                    };
                }

                const deleteBtn = document.getElementById('alertContextDeleteBtn');
                const newDeleteBtn = deleteBtn.cloneNode(true);
                deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
                newDeleteBtn.onclick = (event) => { event.stopPropagation(); this.deleteAlert(hit.alert.id); menu.style.display = 'none'; };
            }
        } else {
            const menu = document.getElementById('alertContextMenu');
            if (menu) menu.style.display = 'none';
        }
    }

    _showSettings(alert) {
        const settings = document.getElementById('alertSettings');
        if (!settings) return;

        document.getElementById('alertCurrentColorBox').style.backgroundColor = alert.options.color;
        document.getElementById('alertHexInputInline').value = alert.options.color;
        document.getElementById('alertSettingThickness').value = alert.options.lineWidth;
        document.getElementById('alertTemplateSelect').value = alert.options.lineStyle;
        document.getElementById('alertColorOpacity').value = Math.round(alert.options.opacity * 100);
        document.getElementById('alertColorOpacityValue').textContent = document.getElementById('alertColorOpacity').value + '%';

        const bellCheckbox = document.getElementById('alertShowBell');
        if (bellCheckbox) bellCheckbox.checked = alert.options.showBell !== false;

        createColorGrid('alertInlineColorsGrid', 'alertCurrentColorBox', 'alertHexInputInline', alert.options.color, 'alertAddColorInline');

        const priceInput = document.getElementById('alertSettingsPriceInput');
        if (priceInput) priceInput.value = Utils.formatPrice(alert.price);

        const repeatCountSelect = document.getElementById('alertRepeatCount');
        if (repeatCountSelect) repeatCountSelect.value = alert.repeatCount === Infinity ? 'Infinity' : alert.repeatCount;

        const repeatIntervalSelect = document.getElementById('alertRepeatInterval');
        if (repeatIntervalSelect) repeatIntervalSelect.value = alert.repeatInterval;

        this._renderTimeframeCheckboxes(alert);

        settings.style.display = 'block';
        settings.style.left = '50%';
        settings.style.top = '50%';
        settings.style.transform = 'translate(-50%, -50%)';
        settings.dataset.alertId = alert.id;

        const stylePanel = document.getElementById('alertStylePanel');
        const repeatPanel = document.getElementById('alertRepeatPanel');
        const visibilityPanel = document.getElementById('alertVisibilityPanel');

        stylePanel.classList.add('active');
        repeatPanel.classList.remove('active');
        visibilityPanel.classList.remove('active');

        document.querySelectorAll('#alertSettings .settings-tab').forEach(tab => {
            tab.classList.remove('active');
            if (tab.dataset.alertSettingsTab === 'style') tab.classList.add('active');
        });

        settings.onmousedown = (e) => e.stopPropagation();

        if (!document._alertSettingsCloseHandler) {
            document._alertSettingsCloseHandler = (e) => {
                if (!settings.contains(e.target) && settings.style.display === 'block') {
                    settings.style.display = 'none';
                }
            };
            document.addEventListener('mousedown', document._alertSettingsCloseHandler);
        }
    }

    _setupSettingsListeners() {
        const settings = document.getElementById('alertSettings');
        if (!settings || settings._listenersSetup) return;
        settings._listenersSetup = true;

        settings.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.alertSettingsTab;
                document.getElementById('alertStylePanel').classList.toggle('active', tabName === 'style');
                document.getElementById('alertRepeatPanel').classList.toggle('active', tabName === 'repeat');
                document.getElementById('alertVisibilityPanel').classList.toggle('active', tabName === 'visibility');
                settings.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
            });
        });

        document.getElementById('alertApplyPriceBtn').addEventListener('click', () => {
            const alertId = settings.dataset.alertId;
            const alert = this._alerts.find(a => a.alert.id === alertId)?.alert;
            if (!alert) return;
            const newPrice = parseFloat(document.getElementById('alertSettingsPriceInput').value);
            if (!isNaN(newPrice)) {
                alert.price = newPrice;
                this._requestRedraw();
                this._saveAlerts();
            }
        });

        document.getElementById('alertSaveSettings').addEventListener('click', () => {
            const alertId = settings.dataset.alertId;
            const alert = this._alerts.find(a => a.alert.id === alertId)?.alert;
            if (!alert) return;
            const repeatCountVal = document.getElementById('alertRepeatCount').value;
            alert.updateOptions({
                color: document.getElementById('alertCurrentColorBox').style.backgroundColor,
                lineWidth: parseInt(document.getElementById('alertSettingThickness').value),
                lineStyle: document.getElementById('alertTemplateSelect').value,
                opacity: parseInt(document.getElementById('alertColorOpacity').value) / 100,
                showBell: document.getElementById('alertShowBell').checked,
                repeatCount: repeatCountVal === 'Infinity' ? Infinity : parseInt(repeatCountVal),
                repeatInterval: parseInt(document.getElementById('alertRepeatInterval').value)
            });
            this._requestRedraw();
            settings.style.display = 'none';
            this._saveAlerts();
            this._updateAlertsListUI();
        });

        document.getElementById('alertDeleteDrawing').addEventListener('click', () => {
            const alertId = settings.dataset.alertId;
            this.deleteAlert(alertId);
            settings.style.display = 'none';
            this._requestRedraw();
        });
    }

    _renderTimeframeCheckboxes(alert) {
        const container = document.getElementById('alertTimeframeCheckboxList');
        if (!container) return;

        const tfLabels = {
            '1m': '1 минута', '3m': '3 минуты', '5m': '5 минут', '15m': '15 минут',
            '30m': '30 минут', '1h': '1 час', '4h': '4 часа', '6h': '6 часов',
            '12h': '12 часов', '1d': '1 день', '1w': '1 неделя', '1M': '1 месяц'
        };

        let html = '';
        const timeframes = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '1d', '1w', '1M'];

        timeframes.forEach(tf => {
            const isChecked = alert.timeframeVisibility[tf] !== false;
            html += `
                <div class="timeframe-checkbox-item">
                    <input type="checkbox" id="alert_tf_${tf}_${alert.id}" data-timeframe="${tf}" ${isChecked ? 'checked' : ''}>
                    <label for="alert_tf_${tf}_${alert.id}">${tfLabels[tf] || tf}</label>
                    <span class="tf-badge">${tf}</span>
                </div>
            `;
        });

        container.innerHTML = html;

        container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const tf = e.target.dataset.timeframe;
                alert.timeframeVisibility[tf] = e.target.checked;
                this._saveAlerts();
            });
        });

        const selectAllBtn = document.getElementById('alertSelectAllTimeframes');
        const deselectAllBtn = document.getElementById('alertDeselectAllTimeframes');

        if (selectAllBtn) {
            const newSelectAll = selectAllBtn.cloneNode(true);
            selectAllBtn.parentNode.replaceChild(newSelectAll, selectAllBtn);
            newSelectAll.addEventListener('click', () => {
                container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                    cb.checked = true;
                    alert.timeframeVisibility[cb.dataset.timeframe] = true;
                });
                this._saveAlerts();
            });
        }

        if (deselectAllBtn) {
            const newDeselectAll = deselectAllBtn.cloneNode(true);
            deselectAllBtn.parentNode.replaceChild(newDeselectAll, deselectAllBtn);
            newDeselectAll.addEventListener('click', () => {
                container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                    cb.checked = false;
                    alert.timeframeVisibility[cb.dataset.timeframe] = false;
                });
                this._saveAlerts();
            });
        }
    }

    _startInfiniteHighlight(alertId) {
        this._stopHighlight(alertId);

        setTimeout(() => {
            const content = document.getElementById('alertHistoryContent');
            if (!content) return;

            const item = content.querySelector(`.alert-list-item[data-id="${alertId}"]`);
            if (!item) return;

            if (!item._originalStyles) {
                item._originalStyles = {
                    bg: item.style.backgroundColor,
                    boxShadow: item.style.boxShadow,
                    borderLeftColor: item.style.borderLeftColor,
                    borderLeftWidth: item.style.borderLeftWidth,
                    transition: item.style.transition
                };
            }

            let isHighlighted = false;

            const blink = () => {
                if (!item.isConnected) {
                    if (item._blinkInterval) {
                        clearInterval(item._blinkInterval);
                        item._blinkInterval = null;
                    }
                    return;
                }

                isHighlighted = !isHighlighted;

                if (isHighlighted) {
                    item.style.backgroundColor = 'rgba(0, 255, 100, 0.35)';
                    item.style.boxShadow = 'inset 0 0 25px rgba(0, 255, 100, 0.6), 0 0 20px rgba(0, 255, 100, 0.8)';
                    item.style.borderLeftColor = '#00FF00';
                    item.style.borderLeftWidth = '6px';
                    item.style.transition = 'all 0.35s ease';
                } else {
                    item.style.backgroundColor = 'rgba(0, 255, 100, 0.1)';
                    item.style.boxShadow = 'inset 0 0 10px rgba(0, 255, 100, 0.25)';
                    item.style.borderLeftColor = '#00DD00';
                    item.style.borderLeftWidth = '4px';
                    item.style.transition = 'all 0.35s ease';
                }
            };

            blink();
            item._blinkInterval = setInterval(blink, 550);

            item._stopBlink = () => {
                if (item._blinkInterval) {
                    clearInterval(item._blinkInterval);
                    item._blinkInterval = null;
                }
                const orig = item._originalStyles || {};
                item.style.backgroundColor = orig.bg || '';
                item.style.boxShadow = orig.boxShadow || '';
                item.style.borderLeftColor = orig.borderLeftColor || '';
                item.style.borderLeftWidth = orig.borderLeftWidth || '';
                item.style.transition = orig.transition || '';
            };

            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }

    _stopHighlight(alertId) {
        const content = document.getElementById('alertHistoryContent');
        if (!content) return;

        const item = content.querySelector(`.alert-list-item[data-id="${alertId}"]`);
        if (item && item._stopBlink) {
            item._stopBlink();
        }
    }

    _highlightTriggeredAlert(alertId) {
        const content = document.getElementById('alertHistoryContent');
        if (!content) return;

        const activeTab = document.querySelector('.history-tab.active')?.dataset.tab;
        if (activeTab !== 'triggered') return;

        const item = content.querySelector(`.alert-list-item[data-id="${alertId}"]`);
        if (!item) return;

        item.style.backgroundColor = 'rgba(255, 200, 0, 0.25)';
        item.style.boxShadow = '0 0 25px rgba(255, 200, 0, 0.6)';
        item.style.borderLeftColor = '#FFC800';
        item.style.borderLeftWidth = '5px';
        item.style.transition = 'all 0.5s ease';

        item.scrollIntoView({ behavior: 'smooth', block: 'center' });

        setTimeout(() => {
            if (item.isConnected) {
                item.style.backgroundColor = 'rgba(255, 200, 0, 0.08)';
                item.style.boxShadow = 'none';
                item.style.borderLeftWidth = '3px';
            }
        }, 8000);
    }

    _showAlertNotification(alert, currentPrice, isRepeat = false) {
        const notification = document.getElementById('alertNotification');

        const priceFormatted = Utils.formatPrice(currentPrice);
        const alertPriceFormatted = Utils.formatPrice(alert.price);
        const timeStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const repeatText = isRepeat ? ` (повтор ${alert.triggerCount}/${alert.repeatCount === Infinity ? '∞' : alert.repeatCount})` : '';

        if (notification) {
            notification.innerHTML = `
                <div class="alert-title">🔔 ${alert.symbol} - АЛЕРТ СРАБОТАЛ${repeatText}</div>
                <div class="alert-price">${priceFormatted} / ${alertPriceFormatted}</div>
                <div class="alert-repeat">${timeStr}</div>
            `;
            notification.style.display = 'block';
            notification.style.borderLeftColor = alert.options.color;
            setTimeout(() => { notification.style.display = 'none'; }, 5000);
        }

        this._playAlertSound();
        this._showSystemNotification(alert, currentPrice, isRepeat);
    }

    _playAlertSound() {
        try {
            const audio = document.getElementById('alertSound');
            if (audio && audio.src && audio.src !== '') {
                audio.currentTime = 0;
                audio.play().catch(e => {});
                return;
            }

            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;

            const ctx = new AudioContext();

            if (ctx.state === 'suspended') {
                ctx.resume().catch(() => {});
            }

            const now = ctx.currentTime;
            const melody = [523, 587, 659, 698, 784, 880, 988, 1047, 988, 880, 784, 698, 659, 587, 523, 494];

            melody.forEach((freq, i) => {
                const startTime = now + i * 0.15;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, startTime);
                gain.gain.linearRampToValueAtTime(0.25, startTime + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.00001, startTime + 0.2);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(startTime);
                osc.stop(startTime + 0.2);
            });
        } catch (e) {}
    }

    _showSystemNotification(alert, currentPrice, isRepeat = false) {
        if (!("Notification" in window)) return;

        const priceFormatted = Utils.formatPrice(currentPrice);
        const repeatText = isRepeat ? ` (повтор ${alert.triggerCount}/${alert.repeatCount === Infinity ? '∞' : alert.repeatCount})` : '';

        const showNotification = () => {
            const notification = new Notification(`🔔 ${alert.symbol} - АЛЕРТ${repeatText}`, {
                body: `Цена: ${priceFormatted} | Уровень: ${Utils.formatPrice(alert.price)}`,
                icon: 'https://tradingview.com/favicon.ico',
                silent: false,
                requireInteraction: true
            });
            notification.onclick = () => { window.focus(); notification.close(); };
            setTimeout(() => notification.close(), 10000);
        };

        if (Notification.permission === "granted") showNotification();
        else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") showNotification();
            });
        }
    }

    _sendTelegramAlert(alert, currentPrice, isRepeat = false) {
        const chatId = localStorage.getItem('telegramChatId');
        if (!chatId) return;

        const priceFormatted = Utils.formatPrice(currentPrice);
        const alertPriceFormatted = Utils.formatPrice(alert.price);

        const direction = currentPrice > alert.price ? '⬆️ Выше' : '⬇️ Ниже';
        const repeatText = isRepeat ? `\n🔄 Повтор: ${alert.triggerCount}/${alert.repeatCount === Infinity ? '∞' : alert.repeatCount}` : '';

        const message = `🚨 АЛЕРТ СРАБОТАЛ!\n\n📊 Пара: ${alert.symbol}\n💰 Цена алерта: ${alertPriceFormatted}\n📈 Текущая цена: ${priceFormatted}\n🧭 Направление: ${direction}${repeatText}\n⏰ Время: ${new Date().toLocaleString('ru-RU')}`;

        const formData = new URLSearchParams();
        formData.append('chat_id', chatId);
        formData.append('text', message);

        fetch(CONFIG.telegramProxyUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData
        }).catch(err => console.warn('Ошибка отправки в Telegram:', err));
    }

    _updateAlertsListUI() {
        const content = document.getElementById('alertHistoryContent');
        if (!content) return;

        const activeAlerts = this._alerts
            .map(a => a.alert)
            .filter(alert => alert.status === 'active' || alert.status === 'paused')
            .sort((a, b) => {
                if (a.active && !b.active) return -1;
                if (!a.active && b.active) return 1;
                return b.createdAt - a.createdAt;
            });

        const completedAlerts = this._alerts
            .map(a => a.alert)
            .filter(alert => alert.status === 'completed')
            .sort((a, b) => (b.lastTriggerTime || 0) - (a.lastTriggerTime || 0));

        const activeTab = document.querySelector('.history-tab.active')?.dataset.tab || 'active';

        let html = '';

        if (activeTab === 'active') {
            const displayAlerts = [...activeAlerts];
            if (displayAlerts.length === 0) {
                html = '<div class="empty-alerts">Нет активных алертов</div>';
            } else {
                html = '<div class="alert-list">';
                displayAlerts.forEach(alert => {
                    const priceFormatted = Utils.formatPrice(alert.price);
                    const color = alert.options.color;
                    const isActive = alert.active;
                    const isPaused = alert.status === 'paused';

                    const exchangeBadge = alert.exchange || 'binance';
                    const marketBadge = (alert.marketType || 'futures') === 'spot' ? 'Spot' : 'Fut';

                    const statusIcon = isPaused ? '⏸️' : '🔔';
                    const statusText = isPaused ? 'На паузе' : (isActive ? `Активен (${alert.triggerCount}/${alert.repeatCount === Infinity ? '∞' : alert.repeatCount})` : 'Ожидание');

                    html += `
                        <div class="alert-list-item ${isActive ? 'is-active' : ''} ${isPaused ? 'is-paused' : ''}"
                             style="border-left-color: ${color};${isActive ? 'background: rgba(0,255,100,0.05);' : ''}${isPaused ? 'background: rgba(255,165,0,0.05);' : ''}"
                             data-id="${alert.id}">
                            <div class="trigger-bell">${statusIcon}</div>
                            <div>
                                <div class="price">
                                    <span class="copy-symbol" style="color:#FFD700; font-weight:bold; cursor:pointer;"
                                          data-symbol="${alert.symbol}"
                                          title="Копировать тикер">
                                        ${alert.symbol}
                                    </span>
                                    <span style="font-size: 0.7em; color: #888;">${exchangeBadge}:${marketBadge}</span>
                                    ${priceFormatted}
                                </div>
                                <div class="info">
                                    <span>${alert.repeatCount === Infinity ? '♾️' : alert.repeatCount} × ${alert.repeatInterval} мин</span>
                                    <span>${statusText}</span>
                                </div>
                            </div>
                            <div class="actions">
                                <button class="copy-alert-symbol" data-symbol="${alert.symbol}" title="Копировать тикер">📋</button>
                                <button class="pause-alert" data-id="${alert.id}" title="${isPaused ? 'Возобновить' : 'Пауза'}">
                                    ${isPaused ? '▶️' : '⏸️'}
                                </button>
                                <button class="delete-alert" data-id="${alert.id}" title="Удалить">❌</button>
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
            }
        } else {
            if (completedAlerts.length === 0) {
                html = '<div class="empty-alerts">Нет завершенных алертов</div>';
            } else {
                html = '<div class="alert-list">';
                completedAlerts.forEach(alert => {
                    const priceFormatted = Utils.formatPrice(alert.price);
                    const color = alert.options.color;
                    const triggerTime = alert.lastTriggerTime || alert.createdAt;
                    const timeStr = new Date(triggerTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    const dateStr = new Date(triggerTime).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
                    const repeatInfo = alert.triggerCount > 0 ? ` (${alert.triggerCount}×)` : '';

                    html += `
                        <div class="alert-list-item completed" style="border-left-color: ${color}; opacity: 0.8;" data-id="${alert.id}">
                            <div>
                                <div class="price">
                                    <span class="copy-symbol" style="color:#FFD700; font-weight:bold; cursor:pointer;"
                                          data-symbol="${alert.symbol}"
                                          title="Копировать тикер">
                                        ${alert.symbol}
                                    </span>
                                    ${priceFormatted}${repeatInfo}
                                </div>
                                <div class="info">
                                    <span>🕐 ${dateStr} ${timeStr}</span>
                                    <span>✅ Завершен</span>
                                </div>
                            </div>
                            <div class="actions">
                                <button class="copy-alert-symbol" data-symbol="${alert.symbol}" title="Копировать тикер">📋</button>
                                <button class="delete-alert" data-id="${alert.id}" title="Удалить">❌</button>
                            </div>
                        </div>
                    `;
                });
                html += '</div>';

                html += `
                    <div style="padding: 10px; text-align: center;">
                        <button class="clear-completed-btn" style="background: #ff4444; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                            🗑️ Удалить все завершенные (${completedAlerts.length})
                        </button>
                    </div>
                `;
            }
        }

        content.innerHTML = html;

        content.querySelectorAll('.copy-symbol').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard?.writeText(el.dataset.symbol);
                el.style.color = '#00FF00';
                setTimeout(() => el.style.color = '#FFD700', 500);
            });
        });

        content.querySelectorAll('.copy-alert-symbol').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard?.writeText(btn.dataset.symbol);
                btn.textContent = '✅';
                setTimeout(() => btn.textContent = '📋', 500);
            });
        });

        content.querySelectorAll('.delete-alert').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteAlert(btn.dataset.id);
            });
        });

        content.querySelectorAll('.pause-alert').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const alert = this._alerts.find(a => a.alert.id === id)?.alert;
                if (alert) {
                    if (alert.status === 'paused') this.resumeAlert(id);
                    else this.pauseAlert(id);
                }
            });
        });

        const clearBtn = content.querySelector('.clear-completed-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.deleteCompletedAlerts());
        }
    }

    debugAlertTimers() {
        console.log('=== ДЕБАГ ИНТЕРВАЛОВ АЛЕРТОВ ===');

        for (const item of this._alerts) {
            const a = item.alert;
            if (a.status !== 'active') continue;

            const now = Date.now();
            const lastPrice = this._lastPrices.get(a.id);
            const msSinceLastTrigger = a.lastTriggerTime ? now - a.lastTriggerTime : Infinity;
            const intervalMs = (a.repeatInterval || 1) * 60000;
            const canTrigger = a.triggerCount === 0 || msSinceLastTrigger >= intervalMs;
            const key = this._getSubscriptionKey(a.symbol, a.exchange, a.marketType);
            const subscribed = this._subscriptions.has(key);

            console.log(`📌 ${a.symbol} @ ${a.price}:`);
            console.log(`   Ключ: ${key}`);
            console.log(`   Подписан: ${subscribed ? '✅' : '❌'}`);
            console.log(`   Срабатываний: ${a.triggerCount}`);
            console.log(`   Последний триггер: ${a.lastTriggerTime ? new Date(a.lastTriggerTime).toLocaleTimeString() : 'никогда'}`);
            console.log(`   Прошло: ${msSinceLastTrigger === Infinity ? '∞' : (msSinceLastTrigger/1000).toFixed(1)}с`);
            console.log(`   Интервал: ${a.repeatInterval}мин (${intervalMs/1000}с)`);
            console.log(`   Может триггерить: ${canTrigger ? '✅ ДА' : '❌ НЕТ (ждем)'}`);
            console.log(`   Последняя цена: ${lastPrice || 'нет'}`);
            console.log(`   Статус: ${a.status}`);
            console.log('');
        }

        console.log(`📊 Всего подписок: ${this._subscriptions.size}`);
        console.log(`📊 Подписанные символы:`, [...this._subscriptions.keys()]);
        console.log(`📊 Полная загрузка из БД завершена: ${this._allAlertsLoadedFromDB ? '✅' : '❌'}`);
    }

    getAlertsStats() {
        const total = this._alerts.length;
        const active = this._alerts.filter(a => a.alert.status === 'active').length;
        const paused = this._alerts.filter(a => a.alert.status === 'paused').length;
        const completed = this._alerts.filter(a => a.alert.status === 'completed').length;
        const withPrimitive = this._alerts.filter(a => a.primitive !== null).length;

        console.log('=== ALERTS STATS ===');
        console.log(`📊 Всего: ${total}`);
        console.log(`🟢 Активных: ${active}`);
        console.log(`🟡 На паузе: ${paused}`);
        console.log(`✅ Завершено: ${completed}`);
        console.log(`🎨 С примитивом: ${withPrimitive}`);
        console.log(`💰 В lastPrices: ${this._lastPrices.size}`);
        console.log(`📡 Подписок: ${this._subscriptions.size}`);

        return { total, active, paused, completed, withPrimitive, lastPrices: this._lastPrices.size, subscriptions: this._subscriptions.size };
    }

    destroy() {
        window.removeEventListener('mouseup', this._handleGlobalMouseUp);

        if (document._alertSettingsCloseHandler) {
            document.removeEventListener('mousedown', document._alertSettingsCloseHandler);
            document._alertSettingsCloseHandler = null;
        }

        if (this._subCheckInterval) {
            clearInterval(this._subCheckInterval);
            this._subCheckInterval = null;
        }

        // ✅ ИСПРАВЛЕНО: перед очисткой локальной Map реально отписываемся от
        // window.priceManagerInstance, а не просто забываем про handler-ы.
        if (window.priceManagerInstance) {
            for (const [key, handler] of this._subscriptions.entries()) {
                try { window.priceManagerInstance.unsubscribe(key, handler); } catch (e) {}
            }
        }
        this._subscriptions.clear();
        this._alerts = [];
        this._lastPrices.clear();
        this._selectedAlert = null;
        this._hoveredAlert = null;

        if (this._hoverRafId) {
            cancelAnimationFrame(this._hoverRafId);
            this._hoverRafId = null;
        }
        this._pendingMouseEvent = null;

        console.log('🗑️ AlertLineManager destroyed');
    }
}
// ============================================================
// TEXT DRAWING CLASSES
// ============================================================
class TextManager {
    constructor(chartManager) {
        this._pixelRatio = window.devicePixelRatio || 1;
        this._texts = [];
        this._chartManager = chartManager;
        this._selectedText = null;
        this._hoveredText = null;
        this._isDrawingMode = false;
        
        this._isDragging = false;
        this._dragText = null;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._dragStartPrice = 0;
        this._dragStartTime = 0;
        this._lastMouseX = 0;
        this._lastMouseY = 0;
        this._potentialDrag = null;
        this._dragThreshold = 5;
        this._isLoading = false;
        this._magnetEnabled = true; 
        this._dblClickTimer = null;
        this._potentialDblClickTarget = null;
        this._dblClickTimeout = 350;
        this._lastClickTime = 0;
        this._handleContextMenu = this._handleContextMenu.bind(this);
        this._handleGlobalMouseUp = this._handleGlobalMouseUp.bind(this);
        window.addEventListener('mouseup', this._handleGlobalMouseUp);
        this._setupEventListeners();
        this._setupHotkeys();
        this._needsRedraw = false;
        
        // ✅ КЭШ ДЛЯ ФИЛЬТРАЦИИ
        this._textsCache = null;
        this._textsCacheKey = null;
        
        // ✅ rAF THROTTLE ДЛЯ HOVER
        this._pendingMouseEvent = null;
        this._hoverRafId = null;
        
        // ✅ Регистрируем в координаторе
        window.drawingLoaderCoordinator.register(this, 'text');
        
        // ✅ Единая задержка 150ms
        setTimeout(async () => {
            try {
                if (!window.dbReady) {
                    await new Promise(resolve => {
                        const check = () => window.dbReady ? resolve() : setTimeout(check, 50);
                        check();
                    });
                }
                console.log('🚀 Auto-loading texts...');
                await this.loadTexts();
                console.log('✅ Texts loaded');
            } catch (error) {
                console.error('❌ Auto-load texts failed:', error);
            }
        }, 150);
    }

    // ✅ КЭШИРОВАННЫЙ МЕТОД
    _getTextsForCurrentSymbol() {
        const currentKey = this._getCurrentSymbolKey();
        if (this._textsCacheKey === currentKey && this._textsCache) {
            return this._textsCache;
        }
        this._textsCacheKey = currentKey;
        this._textsCache = this._texts.filter(item => item.text && item.text.symbolKey === currentKey);
        return this._textsCache;
    }
    
    // ✅ ИНВАЛИДАЦИЯ КЭША
    _invalidateTextsCache() {
        this._textsCache = null;
        this._textsCacheKey = null;
    }

    async loadFromData(symbolKey, textRecords) {
        if (this._getCurrentSymbolKey() !== symbolKey) return;

        try {
            const series = this._chartManager.currentChartType === 'candle' 
                ? this._chartManager.candleSeries 
                : this._chartManager.barSeries;

            if (!series) return;

            const ALL_TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '1d', '1w', '1M'];
            const defaultVisibility = {};
            ALL_TFS.forEach(tf => { defaultVisibility[tf] = true; });

            const existingIds = new Set(
                this._texts
                    .filter(item => item.text.symbolKey === symbolKey)
                    .map(item => item.text.id)
            );
            
            const newRecordIds = new Set(textRecords.map(t => t.id));
            
            const toDetach = this._texts.filter(item => 
                item.text.symbolKey === symbolKey && !newRecordIds.has(item.text.id)
            );
            
            for (const item of toDetach) {
                try { 
                    if (item.primitive && item.series) {
                        item.series.detachPrimitive(item.primitive); 
                    }
                } catch(e) {
                    console.warn('Error detaching old primitive:', e);
                }
            }
            
            this._texts = this._texts.filter(item => 
                item.text.symbolKey !== symbolKey || newRecordIds.has(item.text.id)
            );

            const newTexts = [];
            for (const rec of textRecords) {
                try {
                    const existing = this._texts.find(item => item.text.id === rec.id);
                    if (existing) {
                        existing.text.text = rec.data.text;
                        existing.text.price = rec.data.price;
                        existing.text.time = rec.data.time;
                        existing.text.options = { ...existing.text.options, ...rec.data.options };
                        existing.text.timeframeVisibility = { ...defaultVisibility, ...(rec.data.timeframeVisibility || {}) };
                        continue;
                    }

                    const textDrawing = new TextDrawing(rec.data.text, rec.data.time, rec.data.price, rec.data.options);
                    textDrawing.id = rec.id;
                    textDrawing.symbolKey = rec.symbolKey;
                    textDrawing.symbol = rec.data.symbol;
                    textDrawing.exchange = rec.data.exchange;
                    textDrawing.marketType = rec.data.marketType;
                    textDrawing.anchorTime = rec.data.anchorTime || rec.data.time;
                    textDrawing.timeframeVisibility = { ...defaultVisibility, ...(rec.data.timeframeVisibility || {}) };
                    textDrawing.anchorCandle = rec.data.anchorCandle || null;
                    
                    const primitive = new TextPrimitive(textDrawing, this._chartManager);
                    series.attachPrimitive(primitive);
                    newTexts.push({ text: textDrawing, primitive, series });
                } catch (e) { 
                    console.warn('Failed to load text:', rec.id, e); 
                }
            }

            this._texts.push(...newTexts);
            this._invalidateTextsCache();
            this._requestRedraw();
            console.log(`✅ Loaded ${textRecords.length} texts for ${symbolKey}`);
        } catch (error) {
            console.error('❌ loadFromData failed:', error);
            throw error;
        }
    }

    _toBitmapCoords(cssX, cssY) {
        return { x: cssX * this._pixelRatio, y: cssY * this._pixelRatio };
    }

    _getCurrentSymbolKey() {
        const symbol = this._chartManager.currentSymbol || 'BTCUSDT';
        const exchange = this._chartManager.currentExchange || 'binance';
        const marketType = this._chartManager.currentMarketType || 'futures';
        return `${symbol}:${exchange}:${marketType}`;
    }

    _handleGlobalMouseUp(e) {
        if (!this._isDragging) return;
        
        this._isDragging = false;
        this._potentialDrag = null;

        if (this._dragText) {
            this._dragText.dragging = false;
            this._dragText.attached = false;
            this._dragText.anchorTime = this._dragText.time;
            this._saveTexts();
            this._dragText = null;
            this._requestRedraw();
        }
        
        this._chartManager.chartContainer.style.cursor = 'crosshair';
    }

    _setupHotkeys() {
        document.addEventListener('keydown', (e) => {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
            
            if (e.key === 'Delete' && this._selectedText && this._selectedText.showDragPoint === true) {
                e.preventDefault();
                this.deleteText(this._selectedText.id);
                this._selectedText = null;
            }
        });
    }

    _handleContextMenu(e) {
        e.preventDefault(); e.stopPropagation();

        const rect = this._chartManager.chartContainer.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;
        const { x: bmX, y: bmY } = this._toBitmapCoords(x, y);
        const hit = this.hitTest(bmX, bmY);

        if (hit) {
            if (this._selectedText && this._selectedText !== hit.text) {
                this._selectedText.selected = false;
                this._selectedText.showDragPoint = false;
                this._selectedText.attached = false;
            }

            hit.text.selected = true;
            hit.text.showDragPoint = true;
            hit.text.attached = false;

            const textX = this._chartManager.timeToCoordinate(hit.text.time);
            const textY = this._chartManager.priceToCoordinate(hit.text.price);
            if (textX !== null && textY !== null) {
                hit.text.dragPointX = textX;
                hit.text.dragPointY = textY;
            }

            this._selectedText = hit.text;
            this._requestRedraw();

            const menu = document.getElementById('textContextMenu');
            if (menu) {
                document.getElementById('drawingContextMenu').style.display = 'none';
                document.getElementById('trendContextMenu').style.display = 'none';
                document.getElementById('alertContextMenu').style.display = 'none';

                menu.style.display = 'flex';
                menu.style.left = e.clientX + 'px';
                menu.style.top = e.clientY + 'px';

                const copyBtn = document.getElementById('textContextCopyBtn');
                const newCopyBtn = copyBtn.cloneNode(true);
                copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
                newCopyBtn.onclick = (event) => {
                    event.stopPropagation();
                    navigator.clipboard?.writeText(hit.text.text);
                    menu.style.display = 'none';
                };

                const settingsBtn = document.getElementById('textContextSettingsBtn');
                const newSettingsBtn = settingsBtn.cloneNode(true);
                settingsBtn.parentNode.replaceChild(newSettingsBtn, settingsBtn);
                newSettingsBtn.onclick = (event) => {
                    event.stopPropagation();
                    this._showSettings(hit.text);
                    menu.style.display = 'none';
                };

                const deleteBtn = document.getElementById('textContextDeleteBtn');
                const newDeleteBtn = deleteBtn.cloneNode(true);
                deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
                newDeleteBtn.onclick = (event) => {
                    event.stopPropagation();
                    this.deleteText(hit.text.id);
                    menu.style.display = 'none';
                };
            }
        } else {
            const menu = document.getElementById('textContextMenu');
            if (menu) menu.style.display = 'none';
        }
    }

    _setupEventListeners() {
        const container = this._chartManager.chartContainer;

        container.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;

            const rect = container.getBoundingClientRect();
            let x = e.clientX - rect.left;
            let y = e.clientY - rect.top;
            const { x: bmX, y: bmY } = this._toBitmapCoords(x, y);
            const hit = this.hitTest(bmX, bmY);

            if (hit) {
                e.preventDefault(); e.stopPropagation();

                const now = Date.now();
                
                if (this._dblClickTimer && this._potentialDblClickTarget === hit.text && now - this._lastClickTime < this._dblClickTimeout) {
                    clearTimeout(this._dblClickTimer);
                    this._dblClickTimer = null;
                    this._potentialDblClickTarget = null;
                    this._lastClickTime = 0;
                    
                    hit.text.showDragPoint = !hit.text.showDragPoint;
                    this._requestRedraw();
                    return;
                }

                if (this._selectedText && this._selectedText !== hit.text) {
                    this._selectedText.selected = false;
                    this._selectedText.showDragPoint = false;
                }

                hit.text.selected = true;
                this._selectedText = hit.text;
                
                this._potentialDblClickTarget = hit.text;
                this._lastClickTime = now;
                if (this._dblClickTimer) clearTimeout(this._dblClickTimer);
                this._dblClickTimer = setTimeout(() => {
                    this._dblClickTimer = null;
                    this._potentialDblClickTarget = null;
                }, this._dblClickTimeout);

                if (hit.text.showDragPoint) {
                    const textX = this._chartManager.timeToCoordinate(hit.text.time);
                    const textY = this._chartManager.priceToCoordinate(hit.text.price);
                    if (textX !== null && textY !== null) {
                        hit.text.dragPointX = textX;
                        hit.text.dragPointY = textY;
                    }
                    this._potentialDrag = {
                        text: hit.text,
                        startX: bmX,
                        startY: bmY,
                        startPrice: hit.text.price,
                        startTime: hit.text.time
                    };
                } else {
                    this._potentialDrag = null;
                }

                this._requestRedraw();
            } else {
                const textMenu = document.getElementById('textContextMenu');
                if (textMenu && textMenu.style.display === 'flex') {
                    const menuRect = textMenu.getBoundingClientRect();
                    const isClickInsideMenu = 
                        e.clientX >= menuRect.left && e.clientX <= menuRect.right &&
                        e.clientY >= menuRect.top && e.clientY <= menuRect.bottom;
                    if (isClickInsideMenu) return;
                }

                if (this._selectedText) {
                    this._selectedText.selected = false;
                    this._selectedText.showDragPoint = false;
                    this._selectedText = null;
                }
                
                if (textMenu) textMenu.style.display = 'none';
                this._requestRedraw();
            }
        });

        // ✅ rAF-THROTTLED MOUSEMOVE С GUARD НА СКРОЛЛ
        container.addEventListener('mousemove', (e) => {
            // Guard: при панорамировании/зуме пропускаем hover
            if (this._chartManager._isScrolling || this._chartManager._isScrollingFast) {
                if (this._hoveredText) {
                    this._hoveredText.hovered = false;
                    this._hoveredText = null;
                    this._requestRedraw();
                }
                return;
            }
            
            this._pendingMouseEvent = e;
            if (this._hoverRafId) return;
            
            this._hoverRafId = requestAnimationFrame(() => {
                this._hoverRafId = null;
                this._processMouseMove(this._pendingMouseEvent);
            });
        });

        container.addEventListener('mouseup', (e) => {
            this._potentialDrag = null;

            if (this._isDragging) {
                e.preventDefault(); e.stopPropagation();

                this._isDragging = false;
                if (this._dragText) {
                    this._dragText.dragging = false;
                    this._dragText.attached = false;
                    this._dragText.anchorTime = this._dragText.time;
                    this._saveTexts();
                    this._dragText = null;
                    this._requestRedraw();
                }

                container.style.cursor = 'crosshair';

                setTimeout(() => {
                    const moveEvent = new MouseEvent('mousemove', {
                        clientX: e.clientX,
                        clientY: e.clientY
                    });
                    container.dispatchEvent(moveEvent);
                }, 10);
            }
        });

        container.addEventListener('mouseleave', () => {
            if (this._hoveredText) {
                this._hoveredText.hovered = false;
                this._hoveredText = null;
                this._requestRedraw();
            }
            container.style.cursor = 'crosshair';
            
            if (this._hoverRafId) {
                cancelAnimationFrame(this._hoverRafId);
                this._hoverRafId = null;
            }
            this._pendingMouseEvent = null;
        });

        container.addEventListener('click', (e) => {
            if (this._isDragging) {
                e.preventDefault(); e.stopPropagation();
            }
            if (this._isDrawingMode) {
                this._handleChartClick(e);
            }
        });

        container.addEventListener('contextmenu', this._handleContextMenu);
    }

    // ✅ ВЫНЕСЕННАЯ ЛОГИКА MOUSEMOVE
    _processMouseMove(e) {
        const container = this._chartManager.chartContainer;
        const rect = container.getBoundingClientRect();
        const cssX = e.clientX - rect.left;
        const cssY = e.clientY - rect.top;
        
        this._lastMouseX = cssX;
        this._lastMouseY = cssY;

        const { x: bmX, y: bmY } = this._toBitmapCoords(cssX, cssY);

        if (this._potentialDrag && !this._isDragging) {
            const dx = Math.abs(bmX - this._potentialDrag.startX);
            const dy = Math.abs(bmY - this._potentialDrag.startY);

            if (dx > this._dragThreshold || dy > this._dragThreshold) {
                this._isDragging = true;
                this._dragText = this._potentialDrag.text;
                this._dragText.dragging = true;

                this._dragStartX = this._potentialDrag.startX;
                this._dragStartY = this._potentialDrag.startY;
                this._dragStartPrice = this._potentialDrag.startPrice;
                this._dragStartTime = this._potentialDrag.startTime;

                container.style.cursor = 'grabbing';
            }
        }

        if (this._isDragging && this._dragText) {
            e.preventDefault(); e.stopPropagation();

            const deltaX = (bmX - this._dragStartX) / this._pixelRatio;
            const deltaY = (bmY - this._dragStartY) / this._pixelRatio;

            const textX = this._chartManager.timeToCoordinate(this._dragStartTime);
            const textY = this._chartManager.priceToCoordinate(this._dragStartPrice);

            if (textX !== null && textY !== null) {
                const newX = textX + deltaX;
                const newY = textY + deltaY;

                const newPrice = this._chartManager.coordinateToPrice(newY);
                const newTime = this._getTimeFromCoordinate(newX);

                if (newPrice !== null) this._dragText.price = newPrice;
                if (newTime !== null) {
                    this._dragText.time = newTime;
                    this._dragText.anchorTime = newTime;
                }

                const newTextX = this._chartManager.timeToCoordinate(this._dragText.time);
                const newTextY = this._chartManager.priceToCoordinate(this._dragText.price);
                if (newTextX !== null && newTextY !== null) {
                    this._dragText.dragPointX = newTextX;
                    this._dragText.dragPointY = newTextY;
                }

                this._requestRedraw();
            }
        } else {
            const hit = this.hitTest(bmX, bmY);
            const hitText = hit ? hit.text : null;

            if (hitText) {
                container.style.cursor = 'grab';
            } else {
                container.style.cursor = 'crosshair';
            }

            if (this._hoveredText !== hitText) {
                if (this._hoveredText) this._hoveredText.hovered = false;
                this._hoveredText = hitText;
                if (hitText) hitText.hovered = true;
                this._requestRedraw();
            }
        }
    }

    _getTimeFromCoordinate(x) {
        let time = this._chartManager.coordinateToTime(x);
        if (time !== null) return time;
        
        const data = this._chartManager.chartData;
        if (!data.length) return null;
        
        let intervalMs = 60 * 60 * 1000;
        if (data.length >= 2) intervalMs = data[1].time - data[0].time;
        
        const firstCandle = data[0];
        const lastCandle = data[data.length - 1];
        const firstX = this._chartManager.timeToCoordinate(firstCandle.time);
        const lastX = this._chartManager.timeToCoordinate(lastCandle.time);
        
        if (firstX === null || lastX === null) return null;
        
        if (x > lastX) {
            const deltaX = x - lastX;
            const pixelsPerMs = (lastX - firstX) / (lastCandle.time - firstCandle.time);
            const deltaTime = deltaX / pixelsPerMs;
            return lastCandle.time + deltaTime;
        }
        
        if (x < firstX) {
            const deltaX = firstX - x;
            const pixelsPerMs = (lastX - firstX) / (lastCandle.time - firstCandle.time);
            const deltaTime = deltaX / pixelsPerMs;
            return firstCandle.time - deltaTime;
        }
        
        return null;
    }

    setDrawingMode(enabled) {
        this._isDrawingMode = enabled;
        const textBtn = document.getElementById('toolText');
        if (textBtn) {
            if (enabled) {
                textBtn.style.background = '#4A90E2';
                textBtn.style.color = '#FFFFFF';
                textBtn.classList.add('active');
            } else {
                textBtn.style.background = '';
                textBtn.style.color = '';
                textBtn.classList.remove('active');
            }
        }
    }

    setMagnetEnabled(enabled) {
        this._magnetEnabled = enabled;
    }

    createText(text, time, price, options = {}) {
        const defaultVisibility = {
            '1m': true, '3m': true, '5m': true, '15m': true, '30m': true,
            '1h': true, '4h': true, '6h': true, '12h': true,
            '1d': true, '1w': true, '1M': true
        };
        const timeframeVisibility = options.timeframeVisibility || defaultVisibility;

        const textDrawing = new TextDrawing(text, time, price, {
            ...options,
            timeframeVisibility
        });
        
        textDrawing.anchorTime = time;
        textDrawing.symbolKey = this._getCurrentSymbolKey();
        textDrawing.symbol = this._chartManager.currentSymbol;
        textDrawing.exchange = this._chartManager.currentExchange;
        textDrawing.marketType = this._chartManager.currentMarketType;

        const primitive = new TextPrimitive(textDrawing, this._chartManager);
        const series = this._chartManager.currentChartType === 'candle'
            ? this._chartManager.candleSeries
            : this._chartManager.barSeries;
        series.attachPrimitive(primitive);
        this._texts.push({ text: textDrawing, primitive, series });
        this._invalidateTextsCache();
        this._saveTexts();
        return textDrawing;
    }

    deleteText(textId) {
        const index = this._texts.findIndex(t => t.text.id === textId);
        if (index !== -1) {
            const { primitive, series } = this._texts[index];
            window.db.delete('drawings', textId).catch(e => console.warn(e));
            try { series.detachPrimitive(primitive); } catch (e) {}
            this._texts.splice(index, 1);
            this._invalidateTextsCache();
            if (this._selectedText && this._selectedText.id === textId) this._selectedText = null;
            if (this._dragText && this._dragText.id === textId) this._dragText = null;
            this._saveTexts();
            this._requestRedraw();
            return true;
        }
        return false;
    }

    deleteAllTexts() {
        for (const item of this._texts) {
            window.db.delete('drawings', item.text.id).catch(e => console.warn(e));
        }
        this._texts.forEach(({ primitive, series }) => {
            try { series.detachPrimitive(primitive); } catch (e) {}
        });
        this._texts = [];
        this._invalidateTextsCache();
        this._selectedText = null;
        this._dragText = null;
        this._saveTexts();
        this._requestRedraw();
    }

    _detachAllPrimitivesForSymbol(symbolKey) {
        const itemsForSymbol = this._texts.filter(item => item.text.symbolKey === symbolKey);
        for (const item of itemsForSymbol) {
            if (item.primitive && item.series) {
                try { 
                    item.series.detachPrimitive(item.primitive); 
                } catch(e) {}
            }
        }
        this._texts = this._texts.filter(item => item.text.symbolKey !== symbolKey);
        this._invalidateTextsCache();
    }

    hitTest(x, y) {
        if (this._selectedText) {
            const selItem = this._texts.find(item => item.text === this._selectedText);
            if (selItem && selItem.primitive?._paneView?._renderer) {
                try {
                    const hit = selItem.primitive._paneView._renderer.hitTest(x, y);
                    if (hit) return { text: this._selectedText, type: hit.type, distance: hit.distance };
                } catch (e) {}
            }
        }
        
        let bestHit = null;
        let bestDistance = Infinity;
        
        for (const item of this._texts) {
            if (!item.primitive?._paneView?._renderer) continue;
            if (item.text === this._selectedText) continue;
            
            try {
                const hit = item.primitive._paneView._renderer.hitTest(x, y);
                
                if (hit && hit.distance !== undefined && hit.distance < bestDistance) {
                    bestHit = { text: item.text, type: hit.type, distance: hit.distance };
                    bestDistance = hit.distance;
                }
            } catch (e) {}
        }
        
        return bestHit;
    }

    _handleChartClick(event) {
        if (!this._isDrawingMode) return;
        
        const rect = this._chartManager.chartContainer.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        let price = this._chartManager.coordinateToPrice(y);
        let time = this._chartManager.coordinateToTime(x);
        let anchorCandle = null;
        
        if (price === null || time === null) {
            const lastCandle = this._chartManager.getLastCandle();
            if (lastCandle) {
                price = lastCandle.close;
                time = lastCandle.time;
            } else {
                return;
            }
        }
        
        if (this._magnetEnabled) {
            const snapped = this._snapToPrice(price, time);
            price = snapped.price;
            time = snapped.time;
            anchorCandle = snapped.anchorCandle;
        }
        
        const color = document.getElementById('textCurrentColorBox')?.style.backgroundColor || '#FFFFFF';
        const bgColor = document.getElementById('textBgColorBox')?.style.backgroundColor || '#000000';
        const fontSize = parseInt(document.getElementById('textFontSize')?.value) || 12;
        const bold = document.getElementById('textBold')?.checked || false;
        const opacity = parseInt(document.getElementById('textOpacity')?.value) / 100 || 1;
        const bgOpacity = parseInt(document.getElementById('textBgOpacity')?.value) / 100 || 0;
        
        const newText = this.createText('Текст', time, price, {
            color, 
            bgColor, 
            fontSize, 
            bold, 
            opacity, 
            bgOpacity, 
            anchorCandle
        });
        
        setTimeout(() => {
            this._showSettings(newText);
        }, 100);
        
        this.setDrawingMode(false);
    }

    _snapToPrice(price, time) {
        if (!this._chartManager.chartData.length) return { price, time, anchorCandle: null };
        const data = this._chartManager.chartData;
        let closestCandle = data[0];
        let minTimeDiff = Math.abs(data[0].time - time);
        for (let i = 1; i < data.length; i++) {
            const diff = Math.abs(data[i].time - time);
            if (diff < minTimeDiff) { minTimeDiff = diff; closestCandle = data[i]; }
        }
        const priceY = this._chartManager.priceToCoordinate(price);
        const highY = this._chartManager.priceToCoordinate(closestCandle.high);
        const lowY = this._chartManager.priceToCoordinate(closestCandle.low);
        const closeY = this._chartManager.priceToCoordinate(closestCandle.close);
        if (priceY === null || highY === null) return { price, time, anchorCandle: null };
        const dHighPx = Math.abs(highY - priceY);
        const dLowPx = Math.abs(lowY - priceY);
        const dClosePx = Math.abs(closeY - priceY);
        let snappedPrice = price;
        let anchorType = null;
        const MAGNET_THRESHOLD = 150;
        const minDistPx = Math.min(dHighPx, dLowPx, dClosePx);
        if (minDistPx < MAGNET_THRESHOLD) {
            if (minDistPx === dHighPx) { snappedPrice = closestCandle.high; anchorType = 'high'; }
            else if (minDistPx === dLowPx) { snappedPrice = closestCandle.low; anchorType = 'low'; }
            else { snappedPrice = closestCandle.close; anchorType = 'close'; }
        }
        return { price: snappedPrice, time: closestCandle.time, anchorCandle: { time: closestCandle.time, type: anchorType, price: snappedPrice } };
    }

    _findClosestCandleTime(time) {
        if (!this._chartManager.chartData.length) return time;
        const data = this._chartManager.chartData;
        let closestCandle = data[0];
        let minDiff = Math.abs(data[0].time - time);
        for (let i = 1; i < data.length; i++) {
            const diff = Math.abs(data[i].time - time);
            if (diff < minDiff) { minDiff = diff; closestCandle = data[i]; }
        }
        return closestCandle.time;
    }

    _showSettings(text) {
        const settings = document.getElementById('textSettings');
        if (!settings) return;

        this._selectedText = text;

        document.getElementById('textCurrentColorBox').style.backgroundColor = text.options.color;
        document.getElementById('textHexInputInline').value = text.options.color;
        document.getElementById('textBgColorBox').style.backgroundColor = text.options.bgColor;
        document.getElementById('textBgHexInput').value = text.options.bgColor;
        document.getElementById('textFontSize').value = text.options.fontSize;
        document.getElementById('textBold').checked = text.options.bold || false;
        document.getElementById('textOpacity').value = Math.round(text.options.opacity * 100);
        document.getElementById('textOpacityValue').textContent = document.getElementById('textOpacity').value + '%';
        document.getElementById('textBgOpacity').value = Math.round(text.options.bgOpacity * 100);
        document.getElementById('textBgOpacityValue').textContent = document.getElementById('textBgOpacity').value + '%';
        document.getElementById('textContentInput').value = text.text;

        createColorGrid('textInlineColorsGrid', 'textCurrentColorBox', 'textColorPickerInline', 'textHexInputInline', text.options.color, 'textAddColorInline');
        createColorGrid('textBgColorsGrid', 'textBgColorBox', 'textBgColorPicker', 'textBgHexInput', text.options.bgColor, 'textBgAddColor');
        this._renderColorGrid('textBgColorsGrid', 'textBgColorBox', 'textBgHexInput', text.options.bgColor);
        this._renderTimeframeCheckboxes(text);

        settings.style.display = 'block';
        settings.style.left = '50%';
        settings.style.top = '50%';
        settings.style.transform = 'translate(-50%, -50%)';

        settings.addEventListener('mousedown', (e) => e.stopPropagation());
        settings.addEventListener('mousemove', (e) => e.stopPropagation());
        settings.addEventListener('mouseup', (e) => e.stopPropagation());
        settings.addEventListener('click', (e) => e.stopPropagation());

        let header = settings.querySelector('.settings-header');
        if (!header) {
            header = document.createElement('div');
            header.className = 'settings-header';
            header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #404040;';
            const title = document.createElement('span');
            title.textContent = 'Настройки текста';
            title.style.color = '#FFFFFF';
            title.style.fontSize = '14px';
            title.style.fontWeight = 'bold';
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '✕';
            closeBtn.style.cssText = 'background: transparent; border: none; color: #B0B0B0; font-size: 18px; cursor: pointer; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 4px;';
            closeBtn.onmouseover = () => closeBtn.style.background = '#404040';
            closeBtn.onmouseout = () => closeBtn.style.background = 'transparent';
            closeBtn.onclick = (e) => { e.stopPropagation(); settings.style.display = 'none'; };
            header.appendChild(title);
            header.appendChild(closeBtn);
            settings.insertBefore(header, settings.firstChild);
        }

        if (this._closeOnOutsideClick) {
            document.removeEventListener('mousedown', this._closeOnOutsideClick);
        }
        
        this._closeOnOutsideClick = (e) => {
            if (!settings.contains(e.target) && settings.style.display === 'block') {
                settings.style.display = 'none';
                document.removeEventListener('mousedown', this._closeOnOutsideClick);
                this._closeOnOutsideClick = null;
            }
        };
        
        setTimeout(() => {
            if (this._closeOnOutsideClick) {
                document.addEventListener('mousedown', this._closeOnOutsideClick);
            }
        }, 100);

        const textPanel = document.getElementById('textEditPanel');
        const stylePanel = document.getElementById('textStylePanel');
        const visibilityPanel = document.getElementById('textVisibilityPanel');
        const tabs = document.querySelectorAll('#textSettings .settings-tab');

        tabs.forEach(tab => {
            tab.classList.remove('active');
            if (tab.dataset.textSettingsTab === 'text') tab.classList.add('active');
        });

        if (textPanel) textPanel.classList.add('active');
        if (stylePanel) stylePanel.classList.remove('active');
        if (visibilityPanel) visibilityPanel.classList.remove('active');

        tabs.forEach(tab => {
            tab.onclick = null;
            tab.addEventListener('click', function() {
                document.querySelectorAll('#textSettings .settings-tab').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                if (textPanel) textPanel.classList.remove('active');
                if (stylePanel) stylePanel.classList.remove('active');
                if (visibilityPanel) visibilityPanel.classList.remove('active');
                if (this.dataset.textSettingsTab === 'text' && textPanel) textPanel.classList.add('active');
                else if (this.dataset.textSettingsTab === 'style' && stylePanel) stylePanel.classList.add('active');
                else if (this.dataset.textSettingsTab === 'visibility' && visibilityPanel) visibilityPanel.classList.add('active');
            });
        });

        const saveBtn = document.getElementById('textSaveSettings');
        const deleteBtn = document.getElementById('textDeleteDrawing');

        if (saveBtn) {
            saveBtn.onclick = null;
            saveBtn.addEventListener('click', () => {
                text.updateOptions({
                    color: document.getElementById('textCurrentColorBox').style.backgroundColor,
                    bgColor: document.getElementById('textBgColorBox').style.backgroundColor,
                    fontSize: parseInt(document.getElementById('textFontSize').value),
                    bold: document.getElementById('textBold').checked,
                    opacity: parseInt(document.getElementById('textOpacity').value) / 100,
                    bgOpacity: parseInt(document.getElementById('textBgOpacity').value) / 100,
                    text: document.getElementById('textContentInput').value
                });
                this._requestRedraw();
                settings.style.display = 'none';
                this._saveTexts();
            });
        }

        if (deleteBtn) {
            deleteBtn.onclick = null;
            deleteBtn.addEventListener('click', () => {
                this.deleteText(text.id);
                settings.style.display = 'none';
                this._requestRedraw();
            });
        }

        if (!settings.dataset.instantBound) {
            settings.dataset.instantBound = 'true';

            document.getElementById('textFontSize').addEventListener('input', function() {
                const mgr = window.textManager;
                if (!mgr || !mgr._selectedText) return;
                const val = parseInt(this.value) || 12;
                mgr._selectedText.options.fontSize = val;
                if (mgr._selectedText.primitive) mgr._selectedText.primitive.requestRedraw();
                mgr._requestRedraw();
                mgr._saveTexts();
            });

            document.getElementById('textBold').addEventListener('change', function() {
                const mgr = window.textManager;
                if (!mgr || !mgr._selectedText) return;
                mgr._selectedText.options.bold = this.checked;
                if (mgr._selectedText.primitive) mgr._selectedText.primitive.requestRedraw();
                mgr._requestRedraw();
                mgr._saveTexts();
            });

            document.getElementById('textOpacity').addEventListener('input', function() {
                const mgr = window.textManager;
                if (!mgr || !mgr._selectedText) return;
                document.getElementById('textOpacityValue').textContent = this.value + '%';
                mgr._selectedText.options.opacity = parseInt(this.value) / 100;
                if (mgr._selectedText.primitive) mgr._selectedText.primitive.requestRedraw();
                mgr._requestRedraw();
                mgr._saveTexts();
            });

            document.getElementById('textBgOpacity').addEventListener('input', function() {
                const mgr = window.textManager;
                if (!mgr || !mgr._selectedText) return;
                document.getElementById('textBgOpacityValue').textContent = this.value + '%';
                mgr._selectedText.options.bgOpacity = parseInt(this.value) / 100;
                if (mgr._selectedText.primitive) mgr._selectedText.primitive.requestRedraw();
                mgr._requestRedraw();
                mgr._saveTexts();
            });
        }

        if (!settings.dataset.minutesBound) {
            settings.dataset.minutesBound = 'true';
            const minutesBtn = document.getElementById('textSelectMinutesTimeframes');
            if (minutesBtn) {
                minutesBtn.addEventListener('click', () => {
                    const container = document.getElementById('textTimeframeCheckboxList');
                    if (!container) return;
                    const minutesSet = new Set(['1m', '3m', '5m', '15m', '30m', '1h']);
                    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                        const isMinute = minutesSet.has(cb.dataset.timeframe);
                        cb.checked = isMinute;
                        text.timeframeVisibility[cb.dataset.timeframe] = isMinute;
                    });
                });
            }
        }

        if (typeof window.makePanelDraggable === 'function') {
            window.makePanelDraggable(settings);
        }
    }

    _renderColorGrid(gridId, colorBoxId, hexInputId, selectedColor) {
        const grid = document.getElementById(gridId);
        if (!grid) return;
        const colors = ['#FFFFFF', '#EF5350', '#26A69A', '#FFA726', '#AB47BC', '#5C6BC0', '#66BB6A', '#FF7043', '#7E57C2', '#42A5F5', '#EC407A', '#FFCA28', '#8D6E63', '#B0BEC5', '#000000', '#F44336', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3', '#03A9F4', '#00BCD4', '#009688', '#4CAF50'];
        grid.innerHTML = '';
        colors.forEach(color => {
            const square = document.createElement('div');
            square.className = 'color-square';
            square.style.backgroundColor = color;
            if (color === selectedColor) square.classList.add('selected');
            square.addEventListener('click', () => {
                document.querySelectorAll(`#${gridId} .color-square`).forEach(s => s.classList.remove('selected'));
                square.classList.add('selected');
                document.getElementById(colorBoxId).style.backgroundColor = color;
                document.getElementById(hexInputId).value = color;
            });
            grid.appendChild(square);
        });
        const addBtnId = gridId === 'textInlineColorsGrid' ? 'textAddColorInline' : 'textBgAddColor';
        const addBtn = document.getElementById(addBtnId);
        const hexInput = document.getElementById(hexInputId);
        if (addBtn && hexInput) {
            addBtn.onclick = () => {
                let hex = hexInput.value.trim();
                if (!hex.startsWith('#')) hex = '#' + hex;
                if (/^#[0-9A-F]{6}$/i.test(hex)) {
                    const square = document.createElement('div');
                    square.className = 'color-square';
                    square.style.backgroundColor = hex;
                    square.addEventListener('click', () => {
                        document.querySelectorAll(`#${gridId} .color-square`).forEach(s => s.classList.remove('selected'));
                        square.classList.add('selected');
                        document.getElementById(colorBoxId).style.backgroundColor = hex;
                        hexInput.value = hex;
                    });
                    grid.appendChild(square);
                    document.querySelectorAll(`#${gridId} .color-square`).forEach(s => s.classList.remove('selected'));
                    square.classList.add('selected');
                    document.getElementById(colorBoxId).style.backgroundColor = hex;
                }
            };
        }
    }

    _renderTimeframeCheckboxes(text) {
        const container = document.getElementById('textTimeframeCheckboxList');
        if (!container) return;
        const tfLabels = { '1m': '1 минута', '3m': '3 минуты', '5m': '5 минут', '15m': '15 минут', '30m': '30 минут', '1h': '1 час', '4h': '4 часа', '6h': '6 часов', '12h': '12 часов', '1d': '1 день', '1w': '1 неделя', '1M': '1 месяц' };
        let html = '';
        const timeframes = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '1d', '1w', '1M'];
        timeframes.forEach(tf => {
            const isChecked = text.timeframeVisibility[tf] !== false;
            html += `<div class="timeframe-checkbox-item"><input type="checkbox" id="text_tf_${tf}_${text.id}" data-timeframe="${tf}" ${isChecked ? 'checked' : ''}><label for="text_tf_${tf}_${text.id}">${tfLabels[tf] || tf}</label><span class="tf-badge">${tf}</span></div>`;
        });
        container.innerHTML = html;
        container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => { text.timeframeVisibility[e.target.dataset.timeframe] = e.target.checked; });
        });
        const selectAllBtn = document.getElementById('textSelectAllTimeframes');
        const deselectAllBtn = document.getElementById('textDeselectAllTimeframes');
        if (selectAllBtn) {
            selectAllBtn.onclick = null;
            selectAllBtn.addEventListener('click', () => { 
                container.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; text.timeframeVisibility[cb.dataset.timeframe] = true; }); 
            });
        }
        if (deselectAllBtn) {
            deselectAllBtn.onclick = null;
            deselectAllBtn.addEventListener('click', () => { 
                container.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; text.timeframeVisibility[cb.dataset.timeframe] = false; }); 
            });
        }
    }

    _requestRedraw() {
        this._texts.forEach(item => {
            if (item.primitive?.requestRedraw) item.primitive.requestRedraw();
        });
    }

    _applyRedrawIfNeeded() {
        if (this._needsRedraw) {
            this._needsRedraw = false;
            this._texts?.forEach(item => { 
                if (item.primitive?.requestRedraw) {
                    item.primitive.requestRedraw();
                }
            });
        }
    }

    async _saveTexts() {
        if (this._texts.length === 0) return;
        const promises = this._texts.map(item => 
            window.db.put('drawings', {
                id: item.text.id,
                type: 'text',
                symbolKey: item.text.symbolKey,
                data: {
                    text: item.text.text,
                    time: item.text.time,
                    anchorTime: item.text.anchorTime,
                    price: item.text.price,
                    options: item.text.options,
                    timeframeVisibility: item.text.timeframeVisibility,
                    anchorCandle: item.text.anchorCandle,
                    symbol: item.text.symbol,
                    exchange: item.text.exchange,
                    marketType: item.text.marketType
                }
            }).catch(e => console.warn('Save text error:', e))
        );
        await Promise.all(promises);
    }

    async loadTexts() {
        const currentKey = this._getCurrentSymbolKey();
        await window.drawingLoaderCoordinator.loadAllForSymbol(currentKey);
    }

    syncWithNewTimeframe() {}

    deactivateAll() {
        this._texts.forEach(item => {
            item.text.selected = false;
            item.text.showDragPoint = false;
        });
        this._selectedText = null;
    }

    activateObject(text) {
        text.selected = true;
        text.showDragPoint = true;
        this._selectedText = text;
    }
}

function getFormattedPriceFromChart(chartManager, price) {
    try {
        const series = chartManager.currentChartType === 'candle' 
            ? chartManager.candleSeries 
            : chartManager.barSeries;
        const precision = series?.options()?.priceFormat?.precision ?? 2;
        return Number(price).toFixed(precision);
    } catch (e) {
        return Number(price).toFixed(2);
    }
}

class TradeLevel {
    constructor(entryPrice, stopLossPrice, options = {}) {
        this.entryPrice = entryPrice;
        this.stopLossPrice = stopLossPrice;
        this.takeProfitPrice = null;
        this.direction = options.direction || (stopLossPrice > entryPrice ? 'short' : 'long');
        this.riskRewardRatio = options.riskRewardRatio || 3;
        this.manualTP = options.manualTP || false;
        this.entryTime = options.time || Date.now() / 1000;
        this.anchorTime = this.entryTime;
        this.id = `trade_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        this.symbolKey = options.symbolKey || null;
        this.symbol = options.symbol || null;
        this.exchange = options.exchange || null;
        this.marketType = options.marketType || null;
        
        this.options = {
            slColor: options.slColor || '#f23645',
            tpColor: options.tpColor || '#00ff88',
            lineWidth: options.lineWidth || 1,
            showLabels: options.showLabels !== undefined ? options.showLabels : true,
            showPlechi: options.showPlechi !== undefined ? options.showPlechi : true,
        };
        
        const ALL_TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '1d', '1w', '1M'];
        const defaultVisibility = {};
        ALL_TFS.forEach(tf => { defaultVisibility[tf] = true; });
        this.timeframeVisibility = options.timeframeVisibility || defaultVisibility;
        
        this.selected = false;
        this.hovered = false;
        this.dragging = false;
        this.showDragPoints = false;
        this.updateTP();
    }

    updateTP() {
        if (this.manualTP && this.takeProfitPrice !== null && !isNaN(this.takeProfitPrice)) return;
        const risk = Math.abs(this.entryPrice - this.stopLossPrice);
        if (isNaN(risk) || risk === 0) return;
        const multiplier = this.riskRewardRatio || 3;
        if (this.direction === 'long') {
            this.takeProfitPrice = this.entryPrice + (risk * multiplier);
        } else {
            this.takeProfitPrice = this.entryPrice - (risk * multiplier);
        }
    }

    update() {
        this.direction = this.stopLossPrice > this.entryPrice ? 'short' : 'long';
        this.updateTP();
    }

    isVisibleOnTimeframe(timeframe) {
        return this.timeframeVisibility[timeframe] !== false;
    }
}

class TradeLevelRenderer {
    constructor(trade, chartManager) {
        this._trade = trade;
        this._chartManager = chartManager;
        this._hitAreas = [];
        this._pixelRatio = window.devicePixelRatio || 1;
    }

    draw(target) {
        this._hitAreas = [];
        const trade = this._trade;
        const chartManager = this._chartManager;
        const currentKey = chartManager.getCurrentSymbolKey?.();
        if (currentKey && trade.symbolKey !== currentKey) return;

        target.useBitmapCoordinateSpace(scope => {
            const ctx = scope.context;
            const currentTf = chartManager.currentInterval;
            if (!trade.isVisibleOnTimeframe(currentTf)) return;

            const entryY = chartManager.priceToCoordinate(trade.entryPrice);
            const slY = chartManager.priceToCoordinate(trade.stopLossPrice);
            const tpY = trade.takeProfitPrice !== null && !isNaN(trade.takeProfitPrice) 
                ? chartManager.priceToCoordinate(trade.takeProfitPrice) 
                : null;
            const xCoord = chartManager.timeToCoordinate(trade.entryTime);

            const mediaW = scope.mediaSize.width * scope.horizontalPixelRatio;
            const mediaH = scope.mediaSize.height * scope.verticalPixelRatio;

            const x = (xCoord !== null ? xCoord : mediaW / (2 * scope.horizontalPixelRatio)) * scope.horizontalPixelRatio;
            const entry = entryY !== null ? entryY * scope.verticalPixelRatio : null;
            const sl = slY !== null ? slY * scope.verticalPixelRatio : null;
            const tp = tpY !== null ? tpY * scope.verticalPixelRatio : null;

            const isLong = trade.direction === 'long';
            const entryColor = isLong ? '#00ff88' : '#f23645';
            const arrowSize = 10 * scope.horizontalPixelRatio;

            if (entry !== null) {
                ctx.save();
                ctx.fillStyle = entryColor;
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                ctx.shadowBlur = 4;
                ctx.beginPath();
                if (isLong) {
                    ctx.moveTo(x, entry - arrowSize);
                    ctx.lineTo(x - arrowSize, entry + arrowSize * 0.5);
                    ctx.lineTo(x + arrowSize, entry + arrowSize * 0.5);
                } else {
                    ctx.moveTo(x, entry + arrowSize);
                    ctx.lineTo(x - arrowSize, entry - arrowSize * 0.5);
                    ctx.lineTo(x + arrowSize, entry - arrowSize * 0.5);
                }
                ctx.closePath();
                ctx.fill();
                ctx.restore();

                ctx.save();
                const fontSize = 10 * scope.horizontalPixelRatio;
                ctx.font = `${fontSize}px 'Inter', Arial, sans-serif`;
                const priceText = getFormattedPriceFromChart(chartManager, trade.entryPrice);
                const textMetrics = ctx.measureText(priceText);
                const padding = 4 * scope.horizontalPixelRatio;
                const labelX = x + arrowSize + 4 * scope.horizontalPixelRatio;
                const labelY = entry - (fontSize + padding * 2) / 2;
                const labelW = textMetrics.width + padding * 2;
                const labelH = fontSize + padding * 2;
                
                ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                ctx.shadowBlur = 3;
                ctx.beginPath();
                this._roundRect(ctx, labelX, labelY, labelW, labelH, 3 * scope.horizontalPixelRatio);
                ctx.fill();
                
                ctx.shadowBlur = 0;
                ctx.fillStyle = '#FFFFFF';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(priceText, labelX + padding, labelY + labelH / 2);
                ctx.restore();
            }

            const riskAbs = Math.abs(trade.entryPrice - trade.stopLossPrice);
            const riskPercent = trade.entryPrice !== 0 ? (riskAbs / trade.entryPrice) * 100 : 0;
            const rewardPercent = riskPercent * trade.riskRewardRatio;

            if (sl !== null) {
                this._drawLine(ctx, scope, sl, trade.options.slColor, 'dashed', 0.7);
                this._drawLabel(ctx, scope, `SL ${getFormattedPriceFromChart(chartManager, trade.stopLossPrice)} (${riskPercent.toFixed(2)}%)`, sl, trade.options.slColor);
            }

            if (tp !== null) {
                this._drawLine(ctx, scope, tp, trade.options.tpColor, 'dashed', 0.7);
                this._drawLabel(ctx, scope, `TP ${getFormattedPriceFromChart(chartManager, trade.takeProfitPrice)} (1:${trade.riskRewardRatio.toFixed(2)} | ${rewardPercent.toFixed(2)}%)`, tp, trade.options.tpColor);
            }

            if (trade.selected && trade.options.showPlechi && entry !== null) {
                ctx.save();
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 1 * scope.horizontalPixelRatio;
                ctx.globalAlpha = 0.3;
                if (sl !== null) {
                    ctx.strokeStyle = trade.options.slColor;
                    ctx.beginPath(); ctx.moveTo(x, entry); ctx.lineTo(x, sl); ctx.stroke();
                }
                if (tp !== null) {
                    ctx.strokeStyle = trade.options.tpColor;
                    ctx.beginPath(); ctx.moveTo(x, entry); ctx.lineTo(x, tp); ctx.stroke();
                }
                ctx.restore();
            }

            if (trade.showDragPoints) {
                if (entry !== null) this._drawDragPoint(ctx, scope, x, entry, entryColor);
                if (sl !== null) this._drawDragPoint(ctx, scope, x, sl, trade.options.slColor);
                if (tp !== null) this._drawDragPoint(ctx, scope, x, tp, trade.options.tpColor); 
            }

            const hitBuffer = 15 * scope.horizontalPixelRatio;
            if (entry !== null) {
                this._hitAreas.push({ type: 'entry', x, y: entry, radius: arrowSize * 1.5, trade });
            }
            if (sl !== null) {
                this._hitAreas.push({ type: 'sl', x1: 0, x2: mediaW, y: sl, buffer: hitBuffer, trade });
            }
            if (tp !== null) {
                this._hitAreas.push({ type: 'tp', x1: 0, x2: mediaW, y: tp, buffer: hitBuffer, trade });
            }
        });
    }

    _drawLine(ctx, scope, y, color, style, opacity) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = opacity;
        ctx.lineWidth = 1 * scope.horizontalPixelRatio;
        ctx.setLineDash(style === 'dashed' ? [6, 4] : []);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(scope.mediaSize.width * scope.horizontalPixelRatio, y);
        ctx.stroke();
        ctx.restore();
    }

    _drawLabel(ctx, scope, text, y, color) {
        ctx.save();
        const fontSize = 10 * scope.horizontalPixelRatio;
        ctx.font = `${fontSize}px 'Inter', Arial, sans-serif`;
        const metrics = ctx.measureText(text);
        const padding = 6 * scope.horizontalPixelRatio;
        const labelWidth = metrics.width + padding * 2;
        const labelHeight = fontSize + padding * 2;
        
        const labelX = scope.mediaSize.width * scope.horizontalPixelRatio - labelWidth - 5 * scope.horizontalPixelRatio;
        const labelY = y - labelHeight / 2;

        ctx.fillStyle = 'rgba(20, 20, 20, 0.85)';
        ctx.shadowBlur = 4;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        this._roundRect(ctx, labelX, labelY, labelWidth, labelHeight, 4 * scope.horizontalPixelRatio);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = color;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, labelX + labelWidth - padding, labelY + labelHeight / 2);
        ctx.restore();
    }

    _drawDragPoint(ctx, scope, x, y, color) {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 4;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(x, y, 6 * scope.horizontalPixelRatio, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(x, y, 4 * scope.horizontalPixelRatio, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
    }

    _roundRect(ctx, x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
    }

    hitTest(x, y) {
        let bestHit = null;
        let bestDistance = Infinity;
        for (const area of this._hitAreas) {
            if (area.type === 'entry') {
                const dx = x - area.x;
                const dy = y - area.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < area.radius && distance < bestDistance) {
                    bestHit = { type: 'entry', trade: area.trade, distance };
                    bestDistance = distance;
                }
            } else {
                if (x >= area.x1 && x <= area.x2) {
                    const distance = Math.abs(y - area.y);
                    if (distance < area.buffer && distance < bestDistance) {
                        bestHit = { type: area.type, trade: area.trade, distance };
                        bestDistance = distance;
                    }
                }
            }
        }
        return bestHit;
    }
}

class TradeLevelPaneView {
    constructor(trade, chartManager) {
        this._trade = trade;
        this._chartManager = chartManager;
        this._renderer = new TradeLevelRenderer(trade, chartManager);
    }
    renderer() { return this._renderer; }
    zOrder() { return 'top'; }
}

class TradeLevelPrimitive {
    constructor(trade, chartManager) {
        this._trade = trade;
        this._chartManager = chartManager;
        this._paneView = new TradeLevelPaneView(trade, chartManager);
        this._requestUpdate = null;
    }
    paneViews() { return [this._paneView]; }
    attached({ chart, series, requestUpdate }) {
        this._requestUpdate = requestUpdate;
        this._syncTime();
    }
    updateAllViews() { 
        const oldTime = this._trade.entryTime;
        this._syncTime();
        if (this._trade.entryTime !== oldTime && this._requestUpdate) {
            this._requestUpdate();
        }
    }
    _syncTime() {
        const chartData = this._chartManager.chartData;
        if (!chartData || chartData.length === 0) return;
        const anchor = this._trade.anchorTime ?? this._trade.entryTime;
        let closest = chartData[0];
        let minDiff = Math.abs(chartData[0].time - anchor);
        for (let i = 1; i < chartData.length; i++) {
            const diff = Math.abs(chartData[i].time - anchor);
            if (diff < minDiff) { minDiff = diff; closest = chartData[i]; }
        }
        this._trade.entryTime = closest.time;
    }
    getTrade() { return this._trade; }
    requestRedraw() { if (this._requestUpdate) this._requestUpdate(); }
}

class TradeLevelManager {
    constructor(chartManager) {
        this._trades = [];
        this._chartManager = chartManager;
        this._selectedTrade = null;
        this._hoveredTrade = null;
        this._isDrawingMode = false;
        
        this._potentialDrag = null;
        this._isDragging = false;
        this._dragTrade = null;
        this._dragType = null;
        this._dragStartY = 0;
        this._dragStartPrice = 0;
        this._dragThreshold = 4;
        
        this._drawingEntry = null;
        this._isWaitingForSL = false;
        this._pixelRatio = window.devicePixelRatio || 1;
        this._magnetEnabled = true;
        this._selectedDirection = 'long';
        this._editingTrade = null;
        this._tpManuallySet = false;
        this._pendingTradeTime = null;

        this._lastMouseClientX = 0;
        this._lastMouseClientY = 0;

        if (window.drawingLoaderCoordinator) {
            window.drawingLoaderCoordinator.register(this, 'tradelevel');
        }

        this._setupEventListeners();
        this._setupHotkeys();

        this._handleGlobalMouseUp = this._handleGlobalMouseUp.bind(this);
        window.addEventListener('mouseup', this._handleGlobalMouseUp);

        setTimeout(async () => {
            try {
                if (this._trades.length > 0) return;
                if (!window.dbReady) {
                    await new Promise(r => { 
                        const c = () => window.dbReady ? r() : setTimeout(c, 50); 
                        c(); 
                    });
                }
                await this.loadAllTradesFromDB();
            } catch (error) {
                console.error('❌ Auto-load trades failed:', error);
            }
        }, 150);
    }

    _handleGlobalMouseUp() {
        if (this._potentialDrag && !this._isDragging) {
            this._potentialDrag = null;
        }
        if (this._isDragging) {
            this._isDragging = false;
            if (this._dragTrade) {
                this._dragTrade.dragging = false;
                this._saveTrades();
                this._dragTrade = null;
                this._dragType = null;
                this._chartManager.chartContainer.style.cursor = 'crosshair';
                this._requestRedraw();
            }
        }
    }

    _getChartPrecision() {
        try {
            const series = this._chartManager.currentChartType === 'candle' 
                ? this._chartManager.candleSeries 
                : this._chartManager.barSeries;
            return series?.options()?.priceFormat?.precision ?? 2;
        } catch (e) {
            return 2;
        }
    }

    _formatPrice(price) {
        if (price === null || price === undefined || isNaN(price)) return '';
        return Number(price).toFixed(this._getChartPrecision());
    }

    _updateStep() {
        const entryInput = document.getElementById('tradeEntryInput');
        const slInput = document.getElementById('tradeSLInput');
        const tpInput = document.getElementById('tradeTPInput');
        const price = parseFloat(entryInput?.value) || 100;
        const precision = this._getChartPrecision();
        const step = Math.pow(10, -precision);
        
        if (entryInput) entryInput.step = step;
        if (slInput) slInput.step = step;
        if (tpInput) tpInput.step = step;
    }

    async loadFromData(symbolKey, tradeRecords) {
        try {
            const currentSymbolKey = this._getCurrentSymbolKey();
            const isCurrentSymbol = (currentSymbolKey === symbolKey);
            const series = isCurrentSymbol ? (this._chartManager.currentChartType === 'candle' ? this._chartManager.candleSeries : this._chartManager.barSeries) : null;
            if (isCurrentSymbol && !series) return;

            const ALL_TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '1d', '1w', '1M'];
            const defaultVisibility = {};
            ALL_TFS.forEach(tf => { defaultVisibility[tf] = true; });
            const newRecordIds = new Set(tradeRecords.map(t => t.id));

            if (isCurrentSymbol) {
                const toDetach = this._trades.filter(item => item.trade.symbolKey === symbolKey && !newRecordIds.has(item.trade.id));
                for (const item of toDetach) {
                    try { if (item.primitive && item.series) item.series.detachPrimitive(item.primitive); item.primitive = null; item.series = null; } catch(e) {}
                }
            }
            this._trades = this._trades.filter(item => item.trade.symbolKey !== symbolKey || newRecordIds.has(item.trade.id));

            const newTrades = [];
            for (const rec of tradeRecords) {
                try {
                    const existing = this._trades.find(item => item.trade.id === rec.id);
                    if (existing) {
                        existing.trade.entryPrice = rec.data.entryPrice;
                        existing.trade.stopLossPrice = rec.data.stopLossPrice;
                        existing.trade.takeProfitPrice = rec.data.takeProfitPrice;
                        existing.trade.direction = rec.data.direction;
                        existing.trade.riskRewardRatio = rec.data.riskRewardRatio;
                        existing.trade.manualTP = rec.data.manualTP || false;
                        existing.trade.entryTime = rec.data.entryTime;
                        existing.trade.anchorTime = rec.data.anchorTime ?? rec.data.entryTime;
                        existing.trade.options = { ...existing.trade.options, ...rec.data.options };
                        existing.trade.timeframeVisibility = { ...defaultVisibility, ...(rec.data.timeframeVisibility || {}) };
                        if (!existing.trade.manualTP) {
                            existing.trade.updateTP();
                        }
                        if (isCurrentSymbol && (!existing.primitive || !existing.series || existing.series !== series)) {
                            try {
                                if (existing.primitive && existing.series) existing.series.detachPrimitive(existing.primitive);
                                const primitive = new TradeLevelPrimitive(existing.trade, this._chartManager);
                                series.attachPrimitive(primitive);
                                existing.primitive = primitive;
                                existing.series = series;
                            } catch(e) { console.warn('Failed to re-attach trade:', e); }
                        }
                        continue;
                    }
                    const trade = new TradeLevel(rec.data.entryPrice, rec.data.stopLossPrice, rec.data.options);
                    trade.id = rec.id;
                    trade.symbolKey = rec.symbolKey;
                    trade.takeProfitPrice = rec.data.takeProfitPrice;
                    trade.direction = rec.data.direction;
                    trade.riskRewardRatio = rec.data.riskRewardRatio;
                    trade.manualTP = rec.data.manualTP || false;
                    trade.entryTime = rec.data.entryTime;
                    trade.anchorTime = rec.data.anchorTime ?? rec.data.entryTime;
                    trade.timeframeVisibility = { ...defaultVisibility, ...(rec.data.timeframeVisibility || {}) };
                    trade.symbol = rec.data.symbol;
                    trade.exchange = rec.data.exchange || 'binance';
                    trade.marketType = rec.data.marketType || 'futures';

                    if (!trade.manualTP) {
                        trade.updateTP();
                    }

                    if (isCurrentSymbol) {
                        const primitive = new TradeLevelPrimitive(trade, this._chartManager);
                        try { series.attachPrimitive(primitive); newTrades.push({ trade, primitive, series }); } catch(e) { newTrades.push({ trade, primitive: null, series: null }); }
                    } else {
                        newTrades.push({ trade, primitive: null, series: null });
                    }
                } catch (e) { console.warn('Failed to load trade:', rec.id, e); }
            }
            this._trades.push(...newTrades);
            if (isCurrentSymbol) this._requestRedraw();
        } catch (error) { console.error('❌ loadFromData failed:', error); }
    }

    async loadTrades() {
        const key = this._getCurrentSymbolKey();
        if (window.drawingLoaderCoordinator) await window.drawingLoaderCoordinator.loadAllForSymbol(key);
    }

    async _saveTrades() {
        if (!window.db) return;
        const promises = this._trades.map(item => {
            const trade = item.trade;
            return window.db.put('drawings', {
                id: trade.id, type: 'tradelevel', symbolKey: trade.symbolKey || this._getCurrentSymbolKey(),
                data: { 
                    entryPrice: trade.entryPrice, 
                    stopLossPrice: trade.stopLossPrice, 
                    takeProfitPrice: trade.takeProfitPrice, 
                    direction: trade.direction, 
                    riskRewardRatio: trade.riskRewardRatio, 
                    manualTP: trade.manualTP, 
                    entryTime: trade.entryTime, 
                    anchorTime: trade.anchorTime ?? trade.entryTime,
                    options: trade.options, 
                    timeframeVisibility: trade.timeframeVisibility, 
                    symbol: trade.symbol, 
                    exchange: trade.exchange, 
                    marketType: trade.marketType 
                }
            }).catch(e => console.error(`❌ Save trade error (${trade.id}):`, e));
        });
        await Promise.allSettled(promises);
    }

    async loadAllTradesFromDB() {
        try {
            if (!window.db) return;
            const allRecords = await window.db.getAll('drawings');
            if (!allRecords || allRecords.length === 0) return;
            const tradesBySymbol = {};
            for (const record of allRecords) {
                if (record.type !== 'tradelevel') continue;
                const key = record.symbolKey || `${record.data.symbol}:${record.data.exchange}:${record.data.marketType}`;
                if (!tradesBySymbol[key]) tradesBySymbol[key] = [];
                tradesBySymbol[key].push(record);
            }
            for (const [symbolKey, records] of Object.entries(tradesBySymbol)) {
                await this.loadFromData(symbolKey, records);
            }
        } catch (error) { console.error('❌ loadAllTradesFromDB failed:', error); }
    }

    createTrade(entryPrice, stopLossPrice, options = {}) {
        const rawSymbol = this._chartManager.currentSymbol || 'BTCUSDT';
        const cleanSymbol = rawSymbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const exchange = (this._chartManager.currentExchange || 'binance').toLowerCase();
        const marketType = (this._chartManager.currentMarketType || 'futures').toLowerCase();

        const trade = new TradeLevel(entryPrice, stopLossPrice, {
            ...options, time: options.time || Date.now() / 1000, symbolKey: `${cleanSymbol}:${exchange}:${marketType}`, symbol: cleanSymbol, exchange, marketType
        });
        
        if (trade.takeProfitPrice === null || isNaN(trade.takeProfitPrice)) {
            trade.updateTP();
        }
        if (trade.takeProfitPrice === null || isNaN(trade.takeProfitPrice)) {
            const risk = Math.abs(entryPrice - stopLossPrice);
            if (trade.direction === 'long') {
                trade.takeProfitPrice = entryPrice + (risk * trade.riskRewardRatio);
            } else {
                trade.takeProfitPrice = entryPrice - (risk * trade.riskRewardRatio);
            }
        }

        const series = this._chartManager.currentChartType === 'candle' ? this._chartManager.candleSeries : this._chartManager.barSeries;
        const primitive = new TradeLevelPrimitive(trade, this._chartManager);
        series.attachPrimitive(primitive);
        this._trades.push({ trade, primitive, series });
        this._saveTrades();
        this._requestRedraw();
        return trade;
    }

    deleteTrade(tradeId) {
        const index = this._trades.findIndex(t => t.trade.id === tradeId);
        if (index === -1) return false;
        const { trade, primitive, series } = this._trades[index];
        if (window.db) window.db.delete('drawings', tradeId).catch(e => console.warn(e));
        if (primitive && series) { try { series.detachPrimitive(primitive); } catch(e) {} }
        this._trades.splice(index, 1);
        if (this._selectedTrade?.id === tradeId) this._selectedTrade = null;
        if (this._dragTrade?.id === tradeId) this._dragTrade = null;
        this._saveTrades();
        this._requestRedraw();
        return true;
    }

    deleteAllTrades() {
        const currentKey = this._getCurrentSymbolKey();
        const toDelete = this._trades.filter(t => t.trade.symbolKey === currentKey);
        for (const item of toDelete) {
            if (window.db) window.db.delete('drawings', item.trade.id).catch(e => console.warn(e));
            if (item.primitive && item.series) { try { item.series.detachPrimitive(item.primitive); } catch(e) {} }
        }
        this._trades = this._trades.filter(t => t.trade.symbolKey !== currentKey);
        this._selectedTrade = null;
        this._dragTrade = null;
        this._saveTrades();
        this._requestRedraw();
    }

    setDrawingMode(enabled) {
        this._isDrawingMode = enabled;
        const btn = document.getElementById('toolTradeLevel');
        if (btn) {
            if (enabled) { btn.style.background = '#4A90E2'; btn.style.color = '#FFFFFF'; btn.classList.add('active'); }
            else { btn.style.background = ''; btn.style.color = ''; btn.classList.remove('active'); }
        }
        if (!enabled) {
            this._drawingEntry = null;
            this._isWaitingForSL = false;
            this._editingTrade = null;
            this._pendingTradeTime = null;
            const panel = document.getElementById('tradeCreatePanel');
            if (panel) panel.style.display = 'none';
        }
    }

    setMagnetEnabled(enabled) { this._magnetEnabled = enabled; }

    hitTest(x, y) {
        if (this._selectedTrade) {
            const item = this._trades.find(t => t.trade === this._selectedTrade);
            if (item && item.primitive) {
                const hit = item.primitive._paneView._renderer.hitTest(x, y);
                if (hit) return hit;
            }
        }
        for (const item of this._trades) {
            if (item.trade === this._selectedTrade) continue;
            if (!item.primitive) continue;
            const hit = item.primitive._paneView._renderer.hitTest(x, y);
            if (hit) return hit;
        }
        return null;
    }

    _setupEventListeners() {
        const container = this._chartManager.chartContainer;
        container.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.target.closest('#tradeCreatePanel') || e.target.closest('#tradeSettingsPanel')) return;
            const tradeMenu = document.getElementById('tradeContextMenu');
            if (tradeMenu && tradeMenu.style.display === 'flex') {
                const menuRect = tradeMenu.getBoundingClientRect();
                if (e.clientX >= menuRect.left && e.clientX <= menuRect.right && e.clientY >= menuRect.top && e.clientY <= menuRect.bottom) return;
            }
            const rect = container.getBoundingClientRect();
            const x = (e.clientX - rect.left) * this._pixelRatio;
            const y = (e.clientY - rect.top) * this._pixelRatio;

            if (this._isDrawingMode) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._handleDrawingClick(e, x, y);
                return;
            }

            const hit = this.hitTest(x, y);
            if (hit) {
                e.preventDefault();
                e.stopPropagation();
                if (this._selectedTrade && this._selectedTrade !== hit.trade) {
                    this._selectedTrade.selected = false;
                    this._selectedTrade.showDragPoints = false;
                }
                hit.trade.selected = true;
                hit.trade.showDragPoints = true;
                this._selectedTrade = hit.trade;
                this._potentialDrag = { trade: hit.trade, type: hit.type, startX: x, startY: y, startEntry: hit.trade.entryPrice, startSL: hit.trade.stopLossPrice, startTP: hit.trade.takeProfitPrice, startTime: hit.trade.entryTime };
                this._requestRedraw();
            } else {
                if (this._selectedTrade) {
                    this._selectedTrade.selected = false;
                    this._selectedTrade.showDragPoints = false;
                    this._selectedTrade = null;
                    this._requestRedraw();
                }
                if (tradeMenu) tradeMenu.style.display = 'none';
            }
        });

        container.addEventListener('mousemove', (e) => {
            this._lastMouseClientX = e.clientX;
            this._lastMouseClientY = e.clientY;
            const rect = container.getBoundingClientRect();
            const x = (e.clientX - rect.left) * this._pixelRatio;
            const y = (e.clientY - rect.top) * this._pixelRatio;

            if (this._potentialDrag && !this._isDragging) {
                const dx = Math.abs(x - this._potentialDrag.startX);
                const dy = Math.abs(y - this._potentialDrag.startY);
                if (dx > this._dragThreshold || dy > this._dragThreshold) {
                    this._isDragging = true;
                    this._dragTrade = this._potentialDrag.trade;
                    this._dragType = this._potentialDrag.type;
                    this._dragStartY = this._potentialDrag.startY;
                    if (this._dragType === 'entry') this._dragStartPrice = this._potentialDrag.startEntry;
                    else if (this._dragType === 'sl') this._dragStartPrice = this._potentialDrag.startSL;
                    else if (this._dragType === 'tp') this._dragStartPrice = this._potentialDrag.startTP;
                    container.style.cursor = 'grabbing';
                }
            }

            if (this._isDragging && this._dragTrade) {
                e.preventDefault();
                e.stopPropagation();
                const deltaCssX = (x - this._potentialDrag.startX) / this._pixelRatio;
                const deltaCssY = (y - this._potentialDrag.startY) / this._pixelRatio;

                if (this._dragType === 'entry') {
                    const startTimeX = this._chartManager.timeToCoordinate(this._potentialDrag.startTime);
                    if (startTimeX !== null) {
                        const newTime = this._chartManager.coordinateToTime(startTimeX + deltaCssX);
                        if (newTime !== null) {
                            this._dragTrade.entryTime = newTime;
                            this._dragTrade.anchorTime = newTime;
                        }
                    }
                } else if (this._dragType === 'sl') {
                    const startPriceY = this._chartManager.priceToCoordinate(this._potentialDrag.startSL);
                    if (startPriceY !== null) {
                        const newPrice = this._chartManager.coordinateToPrice(startPriceY + deltaCssY);
                        if (newPrice !== null) {
                            this._dragTrade.stopLossPrice = newPrice;
                            this._dragTrade.manualTP = false;
                        }
                    }
                } else if (this._dragType === 'tp') {
                    const startPriceY = this._chartManager.priceToCoordinate(this._potentialDrag.startTP);
                    if (startPriceY !== null) {
                        const newPrice = this._chartManager.coordinateToPrice(startPriceY + deltaCssY);
                        if (newPrice !== null) {
                            this._dragTrade.takeProfitPrice = newPrice;
                            this._dragTrade.manualTP = true;
                            const risk = Math.abs(this._dragTrade.entryPrice - this._dragTrade.stopLossPrice);
                            const reward = Math.abs(newPrice - this._dragTrade.entryPrice);
                            this._dragTrade.riskRewardRatio = risk > 0 ? (reward / risk) : this._dragTrade.riskRewardRatio;
                        }
                    }
                }
                this._dragTrade.update();
                this._requestRedraw();
                return;
            }

            const hit = this.hitTest(x, y);
            container.style.cursor = hit ? 'grab' : 'crosshair';
            if (this._hoveredTrade !== hit?.trade) {
                if (this._hoveredTrade) this._hoveredTrade.hovered = false;
                this._hoveredTrade = hit?.trade || null;
                if (this._hoveredTrade) this._hoveredTrade.hovered = true;
                this._requestRedraw();
            }
        });

        container.addEventListener('mouseup', (e) => {
            this._potentialDrag = null;
            if (this._isDragging) {
                e.preventDefault();
                e.stopPropagation();
                this._isDragging = false;
                if (this._dragTrade) {
                    this._dragTrade.dragging = false;
                    this._saveTrades();
                    this._dragTrade = null;
                    this._dragType = null;
                    container.style.cursor = 'crosshair';
                    this._requestRedraw();
                }
            }
        });

        container.addEventListener('mouseleave', () => {
            if (this._hoveredTrade) {
                this._hoveredTrade.hovered = false;
                this._hoveredTrade = null;
                this._requestRedraw();
            }
        });

        container.addEventListener('contextmenu', (e) => {
            this._handleContextMenu(e);
        });
    }

  _handleDrawingClick(e, x, y) {
    if (e.target.closest('#tradeCreatePanel')) return;
    const rect = this._chartManager.chartContainer.getBoundingClientRect();
    const cssY = (e.clientY - rect.top);
    const cssX = (e.clientX - rect.left);
    let price = this._chartManager.coordinateToPrice(cssY);
    let time = this._chartManager.coordinateToTime(cssX);
    if (price === null || time === null) {
        const last = this._chartManager.getLastCandle();
        if (last) { price = last.close; time = last.time; } else return;
    }
    if (this._magnetEnabled) {
        const snapped = this._snapToCandle(price, time);
        price = snapped.price;
        time = snapped.time;
    }
    
    if (!this._isWaitingForSL) {
        // Первый клик — создаём временный трейд только с точкой входа
        // Используем ту же цену для SL временно (потом заменится)
        this._drawingEntry = { price, time };
        this._pendingTradeTime = time;
        this._isWaitingForSL = true;
        
        // Создаём временный трейд (entry = price, sl = price)
        // Он покажет точку входа на графике
        this._tempTrade = this.createTrade(price, price, {
            time: time
        });
    } else {
        // Второй клик — удаляем временный трейд и создаём нормальный
        const entryPrice = this._drawingEntry.price;
        const entryTime = this._drawingEntry.time;
        const slPrice = price;
        
        // Удаляем временный трейд
        if (this._tempTrade) {
            this.deleteTrade(this._tempTrade.id);
            this._tempTrade = null;
        }
        
        const direction = slPrice > entryPrice ? 'short' : 'long';
        
        this.createTrade(entryPrice, slPrice, { 
            direction: direction, 
            time: entryTime 
        });
        
        this._drawingEntry = null;
        this._isWaitingForSL = false;
        this._pendingTradeTime = null;
        this.setDrawingMode(false);
    }
}

    _handleContextMenu(e) {
        e.preventDefault();
        e.stopPropagation();
        const rect = this._chartManager.chartContainer.getBoundingClientRect();
        const x = (e.clientX - rect.left) * this._pixelRatio;
        const y = (e.clientY - rect.top) * this._pixelRatio;
        const hit = this.hitTest(x, y);
        if (!hit) {
            const menu = document.getElementById('tradeContextMenu');
            if (menu) menu.style.display = 'none';
            return;
        }
        if (this._selectedTrade && this._selectedTrade !== hit.trade) {
            this._selectedTrade.selected = false;
            this._selectedTrade.showDragPoints = false;
        }
        hit.trade.selected = true;
        hit.trade.showDragPoints = true;
        this._selectedTrade = hit.trade;
        this._requestRedraw();
        
        const menu = document.getElementById('tradeContextMenu');
        if (menu) {
            ['drawingContextMenu', 'trendContextMenu', 'alertContextMenu', 'rulerContextMenu', 'textContextMenu'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            menu.style.display = 'flex';
            menu.style.left = e.clientX + 'px';
            menu.style.top = e.clientY + 'px';
            
            const settingsBtn = document.getElementById('tradeContextSettingsBtn');
            if (settingsBtn) {
                const newSettingsBtn = settingsBtn.cloneNode(true);
                settingsBtn.parentNode.replaceChild(newSettingsBtn, settingsBtn);
                newSettingsBtn.onclick = (ev) => { ev.stopPropagation(); this._showSettings(hit.trade); menu.style.display = 'none'; };
            }
            const deleteBtn = document.getElementById('tradeContextDeleteBtn');
            if (deleteBtn) {
                const newDeleteBtn = deleteBtn.cloneNode(true);
                deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
                newDeleteBtn.onclick = (ev) => { ev.stopPropagation(); this.deleteTrade(hit.trade.id); menu.style.display = 'none'; };
            }
        }
    }

    _setupHotkeys() {
        document.addEventListener('keydown', (e) => {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
            if (e.code === 'KeyL' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                this.setDrawingMode(!this._isDrawingMode);
            }
            if (e.key === 'Delete' && this._selectedTrade) {
                e.preventDefault();
                this.deleteTrade(this._selectedTrade.id);
                this._selectedTrade = null;
            }
        });
    }

    _showSettings(trade = null) {
        const panel = document.getElementById('tradeCreatePanel');
        if (!panel) return;

        this._potentialDrag = null;
        this._isDragging = false;
        this._editingTrade = trade;

        const entryInput = document.getElementById('tradeEntryInput');
        const slInput = document.getElementById('tradeSLInput');
        const tpInput = document.getElementById('tradeTPInput');
        const rrInput = document.getElementById('tradeRRInput');
        const createBtn = document.getElementById('tradeCreateBtn');

        if (trade) {
            entryInput.value = this._formatPrice(trade.entryPrice);
            slInput.value = this._formatPrice(trade.stopLossPrice);
            if (tpInput) tpInput.value = this._formatPrice(trade.takeProfitPrice);
            if (rrInput) rrInput.value = trade.riskRewardRatio.toFixed(2);
            this._setDirection(trade.direction);
            if (createBtn) createBtn.textContent = ' Сохранить';
            this._tpManuallySet = trade.manualTP || false;
        } else {
            entryInput.value = '';
            slInput.value = '';
            if (tpInput) tpInput.value = '';
            if (rrInput) rrInput.value = '3.00';
            this._setDirection('long');
            if (createBtn) createBtn.textContent = ' Создать';
            this._tpManuallySet = false;
        }

        [entryInput, slInput, tpInput, rrInput].forEach(inp => {
            if (inp) inp.oncontextmenu = (e) => e.stopPropagation();
        });

        panel.onmousedown = (e) => e.stopPropagation();
        panel.onmousemove = (e) => e.stopPropagation();
        panel.onmouseup = (e) => e.stopPropagation();
        panel.onclick = (e) => e.stopPropagation();

        entryInput.oninput = () => { this._tpManuallySet = false; this._updateStep(); this._updatePreview(); };
        slInput.oninput = () => { this._tpManuallySet = false; this._updateStep(); this._updatePreview(); };
        if (rrInput) rrInput.oninput = () => { this._tpManuallySet = false; this._updatePreview(); };
        if (tpInput) tpInput.oninput = () => { this._tpManuallySet = true; this._updatePreview(); };

        const longBtn = document.getElementById('tradeDirectionLong');
        const shortBtn = document.getElementById('tradeDirectionShort');
        if (longBtn) longBtn.onclick = (e) => { e.stopPropagation(); this._setDirection('long'); this._updatePreview(); };
        if (shortBtn) shortBtn.onclick = (e) => { e.stopPropagation(); this._setDirection('short'); this._updatePreview(); };

        createBtn.onclick = (e) => { e.stopPropagation(); this._handlePanelSubmit(); };

        document.getElementById('tradeCancelBtn').onclick = (e) => { e.stopPropagation(); this._closePanel(); };
        document.getElementById('closeTradeCreate').onclick = (e) => { e.stopPropagation(); this._closePanel(); };

        panel.style.display = 'block';
        panel.style.position = 'fixed';
        panel.style.left = '50%';
        panel.style.top = '50%';
        panel.style.transform = 'translate(-50%, -50%)';
        panel.style.zIndex = '99999';

        const container = this._chartManager.chartContainer;
        if (container) {
            container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: this._lastMouseClientX || 0, clientY: this._lastMouseClientY || 0 }));
        }
        
        this._makeDraggable(panel);
        this._updateStep();
        this._updatePreview();
        setTimeout(() => entryInput.focus(), 100);
    }

    _makeDraggable(panel) {
        if (panel._draggableSetup) return;
        panel._draggableSetup = true;
        
        const header = panel.querySelector('.settings-header');
        if (!header) return;
        
        header.style.cursor = 'move';
        
        header.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(e.target.tagName)) return;
            
            e.preventDefault();
            header.setPointerCapture(e.pointerId);
            
            let startX = e.clientX;
            let startY = e.clientY;
            let origX = panel.offsetLeft;
            let origY = panel.offsetTop;
            
            panel.style.userSelect = 'none';
            panel.style.cursor = 'grabbing';
            header.style.cursor = 'grabbing';
            panel.style.willChange = 'transform';
            
            const moveHandler = (ev) => {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                panel.style.transform = `translate(${dx}px, ${dy}px)`;
            };

            const upHandler = (ev) => {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                
                panel.style.left = (origX + dx) + 'px';
                panel.style.top = (origY + dy) + 'px';
                
                panel.style.transform = '';
                panel.style.willChange = '';
                panel.style.userSelect = '';
                panel.style.cursor = '';
                header.style.cursor = 'move';

                header.releasePointerCapture(e.pointerId);
                header.removeEventListener('pointermove', moveHandler);
                header.removeEventListener('pointerup', upHandler);
                header.removeEventListener('pointercancel', upHandler);
            };

            header.addEventListener('pointermove', moveHandler);
            header.addEventListener('pointerup', upHandler);
            header.addEventListener('pointercancel', upHandler);
        });
    }

    _showPanelError(message) {
        const rewardEl = document.getElementById('tradePreviewReward');
        if (rewardEl) {
            rewardEl.innerHTML = `<span style="color:#f23645; font-weight:bold;">❌ ${message}</span>`;
        }
        const createBtn = document.getElementById('tradeCreateBtn');
        if (createBtn) { createBtn.disabled = true; createBtn.style.opacity = '0.5'; }
    }

    _updatePreview() {
        const entryInput = document.getElementById('tradeEntryInput');
        const slInput = document.getElementById('tradeSLInput');
        const tpInput = document.getElementById('tradeTPInput');
        const rrInput = document.getElementById('tradeRRInput');
        const createBtn = document.getElementById('tradeCreateBtn');
        const direction = this._selectedDirection || 'long';

        const entry = parseFloat(entryInput?.value);
        const sl = parseFloat(slInput?.value);

        if (isNaN(entry) || isNaN(sl) || entry === 0 || sl === 0) {
            document.getElementById('tradePreviewTP').textContent = '—';
            document.getElementById('tradePreviewRisk').textContent = '—';
            document.getElementById('tradePreviewReward').textContent = '—';
            if (rrInput) rrInput.value = '3.00';
            if (createBtn) { createBtn.disabled = false; createBtn.style.opacity = '1'; }
            return;
        }

        if (direction === 'long' && sl >= entry) {
            this._showPanelError('Для Long SL должен быть НИЖЕ Entry');
            return;
        }
        if (direction === 'short' && sl <= entry) {
            this._showPanelError('Для Short SL должен быть ВЫШЕ Entry');
            return;
        }

        const risk = Math.abs(entry - sl);
        const tpValue = tpInput ? tpInput.value.trim() : '';
        const tp = tpValue !== '' ? parseFloat(tpValue) : null;
        let rr = rrInput ? (parseFloat(rrInput.value) || 2) : 2;

        if (tp !== null && !isNaN(tp)) {
            if (direction === 'long' && tp <= entry) {
                this._showPanelError('Для Long TP должен быть ВЫШЕ Entry');
                return;
            }
            if (direction === 'short' && tp >= entry) {
                this._showPanelError('Для Short TP должен быть НИЖЕ Entry');
                return;
            }
            const reward = Math.abs(tp - entry);
            rr = risk > 0 ? (reward / risk) : 2;
            if (rrInput) rrInput.value = rr.toFixed(2);
            
            document.getElementById('tradePreviewTP').textContent = this._formatPrice(tp);
            document.getElementById('tradePreviewRisk').textContent = `${this._formatPrice(risk)} (${((risk / entry) * 100).toFixed(2)}%)`;
            document.getElementById('tradePreviewReward').textContent = `${this._formatPrice(reward)} (${((reward / entry) * 100).toFixed(2)}%) | R:R 1:${rr.toFixed(2)}`;
        } else {
            document.getElementById('tradePreviewTP').textContent = '—';
            document.getElementById('tradePreviewRisk').textContent = `${this._formatPrice(risk)} (${((risk / entry) * 100).toFixed(2)}%)`;
            document.getElementById('tradePreviewReward').textContent = '—';
        }

        if (createBtn) { createBtn.disabled = false; createBtn.style.opacity = '1'; }
    }

    _handlePanelSubmit() {
        const entryInput = document.getElementById('tradeEntryInput');
        const slInput = document.getElementById('tradeSLInput');
        const tpInput = document.getElementById('tradeTPInput');
        const rrInput = document.getElementById('tradeRRInput');
        
        const entry = parseFloat(entryInput.value);
        const sl = parseFloat(slInput.value);
        const direction = this._selectedDirection || 'long';
        
        const tpValue = tpInput ? tpInput.value.trim() : '';
        const tp = tpValue !== '' ? parseFloat(tpValue) : null;
        const rr = rrInput ? (parseFloat(rrInput.value) || 2) : 2;

        if (isNaN(entry) || isNaN(sl) || entry === 0 || sl === 0) { this._showPanelError('Введите корректные цены'); return; }
        if (entry === sl) { this._showPanelError('Цена входа и стоп-лосс не могут быть равны'); return; }
        if (direction === 'long' && sl >= entry) { this._showPanelError('Для Long стоп-лосс должен быть НИЖЕ цены входа'); return; }
        if (direction === 'short' && sl <= entry) { this._showPanelError('Для Short стоп-лосс должен быть ВЫШЕ цены входа'); return; }

        if (tp !== null && !isNaN(tp)) {
            if (direction === 'long' && tp <= entry) { this._showPanelError('Для Long тейк-профит должен быть ВЫШЕ цены входа'); return; }
            if (direction === 'short' && tp >= entry) { this._showPanelError('Для Short тейк-профит должен быть НИЖЕ цены входа'); return; }
        }

        const risk = Math.abs(entry - sl);

        if (this._editingTrade) {
            this._editingTrade.entryPrice = entry;
            this._editingTrade.stopLossPrice = sl;
            this._editingTrade.direction = direction;
            
            if (tp !== null && !isNaN(tp)) {
                this._editingTrade.takeProfitPrice = tp;
                this._editingTrade.manualTP = true;
                const reward = Math.abs(tp - entry);
                this._editingTrade.riskRewardRatio = risk > 0 ? (reward / risk) : rr;
            } else {
                this._editingTrade.manualTP = false;
                this._editingTrade.riskRewardRatio = rr;
                this._editingTrade.update();
                if (this._editingTrade.takeProfitPrice === null || isNaN(this._editingTrade.takeProfitPrice)) {
                    if (direction === 'long') {
                        this._editingTrade.takeProfitPrice = entry + (risk * rr);
                    } else {
                        this._editingTrade.takeProfitPrice = entry - (risk * rr);
                    }
                }
            }
            this._editingTrade = null;
        } else {
            const tradeTime = this._pendingTradeTime || Date.now() / 1000;
            const options = { riskRewardRatio: rr, direction: direction, time: tradeTime };
            const trade = this.createTrade(entry, sl, options);
            
            if (tp !== null && !isNaN(tp)) {
                trade.takeProfitPrice = tp;
                trade.manualTP = true;
                const reward = Math.abs(tp - entry);
                trade.riskRewardRatio = risk > 0 ? (reward / risk) : rr;
            } else {
                trade.manualTP = false;
                trade.update();
                if (trade.takeProfitPrice === null || isNaN(trade.takeProfitPrice)) {
                    if (direction === 'long') {
                        trade.takeProfitPrice = entry + (risk * rr);
                    } else {
                        trade.takeProfitPrice = entry - (risk * rr);
                    }
                }
            }
        }

        this._pendingTradeTime = null;
        this._closePanel();
    }

    _closePanel() {
        const panel = document.getElementById('tradeCreatePanel');
        if (panel) {
            if (panel._destroyDrag) panel._destroyDrag();
            panel.style.display = 'none';
        }
        this._drawingEntry = null;
        this._isWaitingForSL = false;
        this._editingTrade = null;
        this._pendingTradeTime = null;
        this.setDrawingMode(false);
        this._saveTrades();
        this._requestRedraw();
    }

    _setDirection(direction) {
        this._selectedDirection = direction;
        const longBtn = document.getElementById('tradeDirectionLong');
        const shortBtn = document.getElementById('tradeDirectionShort');
        if (direction === 'long') {
            if (longBtn) { longBtn.style.background = '#0aa037'; longBtn.style.borderColor = '#0aa037'; }
            if (shortBtn) { shortBtn.style.background = '#2D2D2D'; shortBtn.style.borderColor = '#404040'; }
        } else {
            if (shortBtn) { shortBtn.style.background = '#ad1010'; shortBtn.style.borderColor = '#ad1010'; }
            if (longBtn) { longBtn.style.background = '#2D2D2D'; longBtn.style.borderColor = '#404040'; }
        }
    }

    _snapToCandle(price, time) {
        const data = this._chartManager.chartData;
        if (!data || data.length === 0) return { price, time };
        let closest = data[0];
        let minDiff = Math.abs(data[0].time - time);
        for (let i = 1; i < data.length; i++) {
            const diff = Math.abs(data[i].time - time);
            if (diff < minDiff) { minDiff = diff; closest = data[i]; }
        }
        const newTime = closest.time;
        if (this._magnetEnabled) {
            const priceY = this._chartManager.priceToCoordinate(price);
            const highY = this._chartManager.priceToCoordinate(closest.high);
            const lowY = this._chartManager.priceToCoordinate(closest.low);
            const closeY = this._chartManager.priceToCoordinate(closest.close);
            if (priceY !== null && highY !== null) {
                const dHigh = Math.abs(highY - priceY);
                const dLow = Math.abs(lowY - priceY);
                const dClose = Math.abs(closeY - priceY);
                const minDist = Math.min(dHigh, dLow, dClose);
                if (minDist < 150) {
                    if (minDist === dHigh) price = closest.high;
                    else if (minDist === dLow) price = closest.low;
                    else price = closest.close;
                }
            }
        }
        return { price, time: newTime };
    }

    _getCurrentSymbolKey() {
        const rawSymbol = this._chartManager.currentSymbol || 'BTCUSDT';
        const cleanSymbol = rawSymbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const exchange = (this._chartManager.currentExchange || 'binance').toLowerCase();
        const marketType = (this._chartManager.currentMarketType || 'futures').toLowerCase();
        return `${cleanSymbol}:${exchange}:${marketType}`;
    }

    _requestRedraw() {
        for (const item of this._trades) {
            if (item.primitive && item.primitive.requestRedraw) item.primitive.requestRedraw();
        }
    }

    syncWithNewTimeframe() {
        for (const item of this._trades) {
            if (item.primitive && item.primitive.updateAllViews) item.primitive.updateAllViews();
        }
        this._requestRedraw();
    }

    deactivateAll() {
        for (const item of this._trades) {
            item.trade.selected = false;
            item.trade.showDragPoints = false;
        }
        this._selectedTrade = null;
    }

    activateObject(trade) {
        trade.selected = true;
        trade.showDragPoints = true;
        this._selectedTrade = trade;
    }
}

if (typeof window !== 'undefined') {
    window.TradeLevel = TradeLevel;
    window.TradeLevelRenderer = TradeLevelRenderer;
    window.TradeLevelPrimitive = TradeLevelPrimitive;
    window.TradeLevelManager = TradeLevelManager;
}
// ========== ГОРЯЧИЕ КЛАВИШИ ==========
function isTyping() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
}

document.addEventListener('keydown', (e) => {
    if (isTyping()) return;
    
    // Z - магнит
    if (e.code === 'KeyZ' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        const newState = !window.rayManager?._magnetEnabled;
        if (window.rayManager) window.rayManager.setMagnetEnabled(newState);
        if (window.trendLineManager) window.trendLineManager.setMagnetEnabled(newState);
        if (window.rulerLineManager) window.rulerLineManager.setMagnetEnabled(newState);
        if (window.alertLineManager) window.alertLineManager.setMagnetEnabled(newState);
        if (window.textManager) window.textManager.setMagnetEnabled(newState);
        const btn = document.getElementById('toolMagnet');
        if (btn) btn.classList.toggle('magnet-active', newState);
    }
    
    // U - трендовая линия
    if (e.code === 'KeyU' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (window.trendLineManager) {
            const ns = !window.trendLineManager._isDrawingMode;
            window.trendLineManager.setDrawingMode(ns);
            if (window.rayManager && ns) window.rayManager.setDrawingMode(false);
            if (window.rulerLineManager && ns) window.rulerLineManager.setDrawingMode(false);
            if (window.alertLineManager && ns) window.alertLineManager.setDrawingMode(false);
            if (window.textManager && ns) window.textManager.setDrawingMode(false);
            const btn = document.getElementById('toolTrendLine');
            if (btn) btn.style.background = ns ? '#4A90E2' : '';
        }
    }
    
    // O - горизонтальный луч
    if (e.code === 'KeyO' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        if (window.rayManager) {
            const ns = !window.rayManager._isDrawingMode;
            window.rayManager.setDrawingMode(ns);
            if (window.trendLineManager && ns) window.trendLineManager.setDrawingMode(false);
            if (window.rulerLineManager && ns) window.rulerLineManager.setDrawingMode(false);
            if (window.alertLineManager && ns) window.alertLineManager.setDrawingMode(false);
            if (window.textManager && ns) window.textManager.setDrawingMode(false);
            const btn = document.getElementById('toolHorizontalRay');
            if (btn) btn.style.background = ns ? '#4A90E2' : '';
        }
    }
    

    // Y - линейка
    if (e.code === 'KeyY' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (window.rulerLineManager) {
            const ns = !window.rulerLineManager._isDrawingMode;
            window.rulerLineManager.setDrawingMode(ns);
            if (window.rayManager && ns) window.rayManager.setDrawingMode(false);
            if (window.trendLineManager && ns) window.trendLineManager.setDrawingMode(false);
            if (window.alertLineManager && ns) window.alertLineManager.setDrawingMode(false);
            if (window.textManager && ns) window.textManager.setDrawingMode(false);
            const btn = document.getElementById('toolRuler');
            if (btn) btn.style.background = ns ? '#4A90E2' : '';
        }
    }
    
    // T - текст
    if (e.code === 'KeyT' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (window.textManager) {
            const ns = !window.textManager._isDrawingMode;
            window.textManager.setDrawingMode(ns);
            if (window.rayManager && ns) window.rayManager.setDrawingMode(false);
            if (window.trendLineManager && ns) window.trendLineManager.setDrawingMode(false);
            if (window.rulerLineManager && ns) window.rulerLineManager.setDrawingMode(false);
 
            const btn = document.getElementById('toolText');
            if (btn) btn.style.background = ns ? '#4A90E2' : '';
        }
    }
});

(function() {
    const container = document.getElementById('chart-container');
    if (!container) return;

    container.addEventListener('click', function(e) {
        const panelIds = ['drawingSettings', 'trendSettings', 'alertSettings', 'textSettings', 'rulerSettingsPanel'];
        panelIds.forEach(id => {
            const panel = document.getElementById(id);
            if (panel && panel.style.display === 'block' && !panel.contains(e.target)) {
                panel.style.display = 'none';
            }
        });
    });
})();

if (typeof window !== 'undefined') {
    window.HorizontalRayManager = HorizontalRayManager;
    window.TrendLineManager = TrendLineManager;
    window.RulerLineManager = RulerLineManager;
    window.AlertLineManager = AlertLineManager;
    window.TextManager = TextManager;
}
