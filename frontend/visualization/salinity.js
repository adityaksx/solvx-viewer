// SolvX Viewer — 3D Salinity Field Visualization
import { sampleColor, updateLegendUI } from './colorScale.js';

export class SalinityVisualizer {
    constructor(waterComponent, options = {}) {
        this.water = waterComponent;
        this.range = { lo: 26.0, hi: 35.5 };
        this.units = 'PSU';
    }

    apply(dataArray = null) {
        let lo = 26.0;
        let hi = 35.5;

        if (dataArray && dataArray.data && dataArray.data.length) {
            const flat = dataArray.data.flat(4).filter(v => v != null && isFinite(v));
            if (flat.length > 0) {
                flat.sort((a, b) => a - b);
                lo = flat[Math.floor(flat.length * 0.02)];
                hi = flat[Math.floor(flat.length * 0.98)];
            }
        }

        this.range = { lo, hi };
        updateLegendUI('salinity', lo, hi, this.units);

        // Recolor water cells with salinity gradient (river runoff is fresher at surface, deeper is saltier)
        this.water.recolorCells((cell) => {
            const depthFactor = Math.min(1.0, (cell.depthM || 0) / 800.0);
            const simSal = lo + (hi - lo) * Math.pow(depthFactor, 0.6);
            return sampleColor('salinity', simSal, lo, hi);
        });
    }

    sliceAtDepth(depthM) {
        if (!this.water?.instancedVolume) return;
        const mesh = this.water.instancedVolume;
        for (let i = 0; i < this.water.cells.length; i++) {
            const c = this.water.cells[i];
            const dist = Math.abs(c.depthM - depthM);
            const inSlice = dist < Math.max(50, depthM * 0.15);
            const salVal = this.range.lo + (this.range.hi - this.range.lo) * Math.min(1.0, c.depthM / 800.0);
            const col = sampleColor('salinity', salVal, this.range.lo, this.range.hi);
            if (!inSlice) col.multiplyScalar(0.35);
            mesh.setColorAt(i, col);
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
}
