// SolvX Viewer — Ocean Slicing Controller (Stage 2: Depth Slice & Vertical Slice)

export class DepthControl {
    constructor(options = {}) {
        this.onDepthChange = options.onDepthChange || (() => {});
        this.onModeChange = options.onModeChange || (() => {});
        this.onVerticalSlice = options.onVerticalSlice || (() => {});
        this.onClearVerticalSlice = options.onClearVerticalSlice || (() => {});
        this.getBBox = options.getBBox || (() => ({ min_lat: 16.08, max_lat: 23.5, min_lon: 84.17, max_lon: 92.92 }));

        this.modeButtons = document.querySelectorAll('[data-depth-mode]');
        this.currentDepth = 100;
        this.currentMode = 'volume';
        this.transectMode = 'custom'; // 'custom', 'lat', 'lon'

        // Horizontal Slice Elements
        this.horizControls = document.getElementById('horizontalSliceControls');
        this.horizDepthInput = document.getElementById('horizDepthInput');
        this.horizDepthSlider = document.getElementById('horizDepthSlider');
        this.horizDepthValue = document.getElementById('horizDepthValue');
        this.sliderTickMid = document.getElementById('sliderTickMid');
        this.sliderTickMax = document.getElementById('sliderTickMax');
        this.applyHorizBtn = document.getElementById('applyHorizSliceBtn');
        this.horizInfo = document.getElementById('horizSliceInfo');

        // Vertical Slice Elements
        this.vertControls = document.getElementById('verticalSliceControls');
        this.transectPills = document.querySelectorAll('[data-transect-mode]');
        this.transectCustomInputs = document.getElementById('transectCustomInputs');
        this.transectSingleInput = document.getElementById('transectSingleInput');
        this.transectSingleLabel = document.getElementById('transectSingleLabel');
        this.transectSingleVal = document.getElementById('transectSingleVal');
        this.transectSingleUnit = document.getElementById('transectSingleUnit');
        this.applyVertBtn = document.getElementById('applyVertSliceBtn');
        this.clearVertBtn = document.getElementById('clearVertSliceBtn');
        // 3D Volume Diagnostic Elements (Section 28)
        this.volumeDebugControls = document.getElementById('volumeDebugControls');
        this.volumeDebugBtns = document.querySelectorAll('[data-volume-debug]');
        this.volumeDebugDepthRow = document.getElementById('volumeDebugDepthRow');
        this.volumeDepthBtns = document.querySelectorAll('[data-volume-depth]');
        this.currentDebugMode = 0;
        this.currentDebugSliceDepth = 0.49;

        this.depthLevels = [];

        this.setupEvents();
    }

    setMaxDepth(maxM) {
        const m = Math.round(maxM || 541);
        if (this.horizDepthSlider) {
            this.horizDepthSlider.max = m;
        }
        if (this.sliderTickMid) {
            this.sliderTickMid.textContent = `${Math.round(m / 2)}m`;
        }
        if (this.sliderTickMax) {
            this.sliderTickMax.textContent = `${m}m`;
        }
        if (this.horizDepthInput) {
            this.horizDepthInput.max = m;
        }
    }

    setDepthLevels(levels) {
        if (!Array.isArray(levels) || levels.length === 0) return;
        this.depthLevels = levels.map(Number).sort((a, b) => a - b);
        this.setMaxDepth(this.depthLevels[this.depthLevels.length - 1]);
    }

    setMode(mode) {
        this.modeButtons.forEach(b => {
            if ((b.dataset.depthMode || '') === mode) {
                b.classList.add('active');
            } else {
                b.classList.remove('active');
            }
        });
        this.currentMode = mode;
        this.updateDisplay();
        this.onModeChange(this.currentMode, this.currentDepth);
    }

    updateDisplay() {
        if (this.horizControls) {
            this.horizControls.style.display = '';
            if (this.currentMode === 'horizontal') {
                this.horizControls.classList.remove('hidden');
            } else {
                this.horizControls.classList.add('hidden');
            }
        }
        if (this.vertControls) {
            this.vertControls.style.display = '';
            if (this.currentMode === 'vertical') {
                this.vertControls.classList.remove('hidden');
            } else {
                this.vertControls.classList.add('hidden');
            }
        }
        if (this.volumeDebugControls) {
            if (this.currentMode === 'volume') {
                this.volumeDebugControls.classList.remove('hidden');
            } else {
                this.volumeDebugControls.classList.add('hidden');
            }
        }
    }

    setupEvents() {
        // Mode Buttons (Volume / Horizontal / Vertical)
        this.modeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.setMode(btn.dataset.depthMode || 'volume');
            });
        });

        // 3D Volume Diagnostic Mode Buttons (Section 28)
        this.volumeDebugBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.volumeDebugBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const mode = Number(btn.dataset.volumeDebug || 0);
                this.currentDebugMode = mode;

                if (this.volumeDebugDepthRow) {
                    if (mode === 5) {
                        this.volumeDebugDepthRow.classList.remove('hidden');
                    } else {
                        this.volumeDebugDepthRow.classList.add('hidden');
                    }
                }

                if (window.solvxVolumeRenderer) {
                    window.solvxVolumeRenderer.setDebugMode(mode, this.currentDebugSliceDepth);
                }
            });
        });

        // 3D Volume Diagnostic Slice Depth Buttons
        this.volumeDepthBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.volumeDepthBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const depth = Number(btn.dataset.volumeDepth || 0.49);
                this.currentDebugSliceDepth = depth;

                if (window.solvxVolumeRenderer) {
                    window.solvxVolumeRenderer.setDebugMode(this.currentDebugMode, this.currentDebugSliceDepth);
                }
            });
        });

        // Horizontal Depth Slider
        if (this.horizDepthSlider) {
            this.horizDepthSlider.addEventListener('input', (e) => {
                const val = Number(e.target.value);
                this.currentDepth = val;
                if (this.horizDepthInput) this.horizDepthInput.value = val;
                if (this.horizDepthValue) this.horizDepthValue.textContent = `${val}m`;
                if (this.horizInfo) this.horizInfo.textContent = `Depth: ${val} m`;
                this.onDepthChange(val);
            });
        }

        // Horizontal Depth Number Input
        if (this.horizDepthInput) {
            this.horizDepthInput.addEventListener('change', (e) => {
                const val = Math.max(0, Number(e.target.value || 0));
                this.currentDepth = val;
                if (this.horizDepthSlider) this.horizDepthSlider.value = Math.min(val, Number(this.horizDepthSlider.max || 5000));
                if (this.horizDepthValue) this.horizDepthValue.textContent = `${val}m`;
                if (this.horizInfo) this.horizInfo.textContent = `Depth: ${val} m`;
                this.onDepthChange(val);
            });
        }

        if (this.applyHorizBtn) {
            this.applyHorizBtn.addEventListener('click', () => {
                this.currentDepth = Number(this.horizDepthInput?.value || this.horizDepthSlider?.value || 0);
                this.onDepthChange(this.currentDepth);
                if (this.horizInfo) {
                    this.horizInfo.textContent = `Applied depth: ${this.currentDepth} m`;
                }
            });
        }

        // Transect Mode Pills (Custom Line, Constant Latitude, Constant Longitude)
        this.transectPills.forEach(pill => {
            pill.addEventListener('click', () => {
                this.transectPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.transectMode = pill.dataset.transectMode || 'custom';

                if (this.transectMode === 'custom') {
                    this.transectCustomInputs?.classList.remove('hidden');
                    this.transectSingleInput?.classList.add('hidden');
                } else if (this.transectMode === 'lat') {
                    this.transectCustomInputs?.classList.add('hidden');
                    this.transectSingleInput?.classList.remove('hidden');
                    if (this.transectSingleLabel) this.transectSingleLabel.textContent = 'Transect Latitude (°N)';
                    if (this.transectSingleUnit) this.transectSingleUnit.textContent = '°N';
                    const bbox = this.getBBox();
                    if (this.transectSingleVal) this.transectSingleVal.value = ((bbox.min_lat + bbox.max_lat) / 2).toFixed(1);
                } else if (this.transectMode === 'lon') {
                    this.transectCustomInputs?.classList.add('hidden');
                    this.transectSingleInput?.classList.remove('hidden');
                    if (this.transectSingleLabel) this.transectSingleLabel.textContent = 'Transect Longitude (°E)';
                    if (this.transectSingleUnit) this.transectSingleUnit.textContent = '°E';
                    const bbox = this.getBBox();
                    if (this.transectSingleVal) this.transectSingleVal.value = ((bbox.min_lon + bbox.max_lon) / 2).toFixed(1);
                }
            });
        });

        // Apply Vertical Slice Button
        if (this.applyVertBtn) {
            this.applyVertBtn.addEventListener('click', () => {
                const bbox = this.getBBox();
                let sLat, sLon, eLat, eLon;

                if (this.transectMode === 'lat') {
                    const lat = Number(this.transectSingleVal?.value);
                    if (isNaN(lat)) {
                        alert('Please enter a valid latitude value.');
                        return;
                    }
                    sLat = lat;
                    eLat = lat;
                    sLon = bbox.min_lon;
                    eLon = bbox.max_lon;
                    if (this.vertInfo) this.vertInfo.textContent = `Transect along ${lat.toFixed(2)}°N (${sLon.toFixed(1)}°E to ${eLon.toFixed(1)}°E)`;
                } else if (this.transectMode === 'lon') {
                    const lon = Number(this.transectSingleVal?.value);
                    if (isNaN(lon)) {
                        alert('Please enter a valid longitude value.');
                        return;
                    }
                    sLon = lon;
                    eLon = lon;
                    sLat = bbox.min_lat;
                    eLat = bbox.max_lat;
                    if (this.vertInfo) this.vertInfo.textContent = `Transect along ${lon.toFixed(2)}°E (${sLat.toFixed(1)}°N to ${eLat.toFixed(1)}°N)`;
                } else {
                    sLat = Number(document.getElementById('vertStartLat')?.value);
                    sLon = Number(document.getElementById('vertStartLon')?.value);
                    eLat = Number(document.getElementById('vertEndLat')?.value);
                    eLon = Number(document.getElementById('vertEndLon')?.value);

                    if (isNaN(sLat) || isNaN(sLon) || isNaN(eLat) || isNaN(eLon)) {
                        alert('Please enter valid start and end coordinates.');
                        return;
                    }
                    if (this.vertInfo) this.vertInfo.textContent = `Transect: (${sLat.toFixed(1)}°, ${sLon.toFixed(1)}°) → (${eLat.toFixed(1)}°, ${eLon.toFixed(1)}°)`;
                }

                this.onVerticalSlice(sLat, sLon, eLat, eLon);
            });
        }

        // Clear Vertical Slice Button
        if (this.clearVertBtn) {
            this.clearVertBtn.addEventListener('click', () => {
                if (this.vertInfo) this.vertInfo.textContent = '';
                this.onClearVerticalSlice();
            });
        }
    }
}
