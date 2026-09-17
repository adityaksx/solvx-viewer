// SolvX Viewer — 3D Temperature Field Visualization
import { sampleColor, updateLegendUI } from './colorScale.js';

export class TemperatureVisualizer {
    constructor(waterComponent, options = {}) {
        this.water = waterComponent;
        this.range = { lo: 24.0, hi: 31.0 };
        this.units = '°C';
    }

    apply(dataArray = null) {
        let lo = 24.0;
        let hi = 31.5;

        // If dataArray is available, compute 1st-99th percentiles
        if (dataArray && dataArray.data && dataArray.data.length) {
            const flat = dataArray.data.flat(4).filter(v => v != null && isFinite(v));
            if (flat.length > 0) {
                flat.sort((a, b) => a - b);
                lo = flat[Math.floor(flat.length * 0.02)];
                hi = flat[Math.floor(flat.length * 0.98)];
            }
        }

        this.range = { lo, hi };
        updateLegendUI('temperature', lo, hi, this.units);

        // Recolor water cells with temperature gradient
        this.water.recolorCells((cell) => {
            // Temperature decreases with depth: surface ~29C down to ~6C at 1000m
            const depthFactor = Math.min(1.0, (cell.depthM || 0) / 1000.0);
            const simTemp = hi - (hi - lo) * Math.pow(depthFactor, 0.4);
            return sampleColor('temperature', simTemp, lo, hi);
        });
    }

    sliceAtDepth(depthM) {
        // Highlights or dims cells based on slice depth
        if (!this.water?.instancedVolume) return;
        const mesh = this.water.instancedVolume;
        for (let i = 0; i < this.water.cells.length; i++) {
            const c = this.water.cells[i];
            const dist = Math.abs(c.depthM - depthM);
            const inSlice = dist < Math.max(50, depthM * 0.15);
            // Modify instance matrix scale or color intensity
            const tempVal = this.range.hi - (this.range.hi - this.range.lo) * Math.min(1.0, c.depthM / 1000.0);
            const col = sampleColor('temperature', tempVal, this.range.lo, this.range.hi);
            if (!inSlice) {
                col.multiplyScalar(0.35); // Dim unselected depth
            }
            mesh.setColorAt(i, col);
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
}
