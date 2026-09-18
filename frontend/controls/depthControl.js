// SolvX Viewer — Ocean Slicing Controller

export class DepthControl {
    constructor(options = {}) {
        this.onDepthChange = options.onDepthChange || (() => {});
        this.onModeChange = options.onModeChange || (() => {});
        this.onVerticalSlice = options.onVerticalSlice || (() => {});
        this.onClearVerticalSlice = options.onClearVerticalSlice || (() => {});

        this.modeButtons = document.querySelectorAll('[data-depth-mode]');
        this.currentDepth = 100;
        this.currentMode = 'volume';

        this.horizControls = document.getElementById('horizontalSliceControls');
        this.vertControls = document.getElementById('verticalSliceControls');
        this.horizDepthInput = document.getElementById('horizDepthInput');
        this.applyHorizBtn = document.getElementById('applyHorizSliceBtn');
        this.applyVertBtn = document.getElementById('applyVertSliceBtn');
        this.clearVertBtn = document.getElementById('clearVertSliceBtn');
        this.horizInfo = document.getElementById('horizSliceInfo');

        this.setupEvents();
    }

    setMaxDepth(maxM) {
        // No-op for now
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
    }

    setupEvents() {
        this.modeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.modeButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentMode = btn.dataset.depthMode || 'volume';
                this.updateDisplay();
                this.onModeChange(this.currentMode, this.currentDepth);
            });
        });

        if (this.applyHorizBtn) {
            this.applyHorizBtn.addEventListener('click', () => {
                this.currentDepth = Number(this.horizDepthInput.value || 0);
                this.onDepthChange(this.currentDepth);
                if (this.horizInfo) {
                    this.horizInfo.textContent = `Requested: ${this.currentDepth} m`;
                }
            });
        }
        
        if (this.applyVertBtn) {
            this.applyVertBtn.addEventListener('click', () => {
                const sLat = Number(document.getElementById('vertStartLat').value);
                const sLon = Number(document.getElementById('vertStartLon').value);
                const eLat = Number(document.getElementById('vertEndLat').value);
                const eLon = Number(document.getElementById('vertEndLon').value);
                if (isNaN(sLat) || isNaN(sLon) || isNaN(eLat) || isNaN(eLon)) {
                    alert('Please enter valid start and end coordinates.');
                    return;
                }
                this.onVerticalSlice(sLat, sLon, eLat, eLon);
            });
        }
        
        if (this.clearVertBtn) {
            this.clearVertBtn.addEventListener('click', () => {
                this.onClearVerticalSlice();
            });
        }
    }
}
