// SolvX Viewer — Region Selector Controller

export class RegionSelector {
    constructor(options = {}) {
        this.onSelect = options.onSelect || (() => {});
        this.presets = options.presets || [];
        this.currentBBox = options.initialBBox || {
            min_lon: 84.10,
            max_lon: 93.00,
            min_lat: 16.07,
            max_lat: 23.52
        };
    }

    setPresets(presets) {
        this.presets = presets;
        this.renderPresetButtons();
    }

    renderPresetButtons(containerId = 'presetList') {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        this.presets.forEach(preset => {
            const btn = document.createElement('button');
            btn.className = 'preset-chip';
            btn.innerHTML = `<b>${preset.name}</b><small>${preset.description}</small>`;
            btn.onclick = () => {
                this.currentBBox = { ...preset.bbox };
                this.onSelect(this.currentBBox);
            };
            container.appendChild(btn);
        });
    }

    selectBBox(bbox) {
        this.currentBBox = { ...bbox };
        this.onSelect(this.currentBBox);
    }
}
