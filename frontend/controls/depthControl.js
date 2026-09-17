// SolvX Viewer — Depth Range & Slice Controller

export class DepthControl {
    constructor(options = {}) {
        this.onDepthChange = options.onDepthChange || (() => {});
        this.onModeChange = options.onModeChange || (() => {});

        this.slider = document.getElementById(options.sliderId || 'depthSlider');
        this.valueDisplay = document.getElementById(options.valueDisplayId || 'depthValue');
        this.modeButtons = document.querySelectorAll(options.modeSelector || '[data-depth-mode]');
        this.currentDepth = 0;
        this.currentMode = 'volume';

        this.setupEvents();
    }

    setMaxDepth(maxM) {
        if (this.slider) {
            this.slider.max = String(Math.round(maxM));
            this.slider.value = '0';
        }
        this.updateDisplay(0);
    }

    updateDisplay(depthM) {
        if (this.valueDisplay) {
            this.valueDisplay.textContent = this.currentMode === 'volume'
                ? `Volume (0 → ${Math.round(this.slider?.max || 3500)} m)`
                : `Slice at ${Math.round(depthM)} m`;
        }
    }

    setupEvents() {
        this.slider?.addEventListener('input', (e) => {
            this.currentDepth = Number(e.target.value);
            this.updateDisplay(this.currentDepth);
            this.onDepthChange(this.currentDepth);
        });

        this.modeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.modeButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentMode = btn.dataset.depthMode || 'volume';
                this.updateDisplay(this.currentDepth);
                this.onModeChange(this.currentMode, this.currentDepth);
            });
        });
    }
}
