// SolvX Viewer — Exaggeration & Layer Opacity Controller

export class OpacityControl {
    constructor(options = {}) {
        this.onExaggerationChange = options.onExaggerationChange || (() => {});
        this.onOpacityChange = options.onOpacityChange || (() => {});

        this.exagSlider = document.getElementById(options.exagSliderId || 'exaggeration');
        this.exagDisplay = document.getElementById(options.exagDisplayId || 'exagValue');

        this.setupEvents();
    }

    setupEvents() {
        this.exagSlider?.addEventListener('input', (e) => {
            const val = Number(e.target.value);
            if (this.exagDisplay) {
                this.exagDisplay.textContent = `${val}×`;
            }
            this.onExaggerationChange(val);
        });
    }
}
