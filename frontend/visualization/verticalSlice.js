import * as THREE from 'three';
import { sampleColor } from './colorScale.js';

export function createVerticalSliceTexture(dataArray, varName, minVal, maxVal) {
    const values = dataArray.values;
    if (!values || !values.length) return null;
    
    // Check if 3D
    if (!Array.isArray(values[0]) || !Array.isArray(values[0][0])) return null;

    const depths = values.length;
    const lats = values[0].length;
    const lons = values[0][0].length;
    
    // Diagonal slice: from bottom-left to top-right of the lat/lon grid
    const steps = Math.max(lats, lons);
    
    const data = new Uint8Array(4 * steps * depths);
    
    for (let d = 0; d < depths; d++) {
        for (let s = 0; s < steps; s++) {
            const latIdx = Math.floor((s / steps) * lats);
            const lonIdx = Math.floor((s / steps) * lons);
            
            const val = values[d][latIdx][lonIdx];
            const idx = ((depths - 1 - d) * steps + s) * 4; // Y is depth
            
            if (val === null || val === undefined || isNaN(val)) {
                data[idx] = 0;
                data[idx+1] = 0;
                data[idx+2] = 0;
                data[idx+3] = 0;
            } else {
                const color = sampleColor(varName, val, minVal, maxVal);
                data[idx] = color.r * 255;
                data[idx+1] = color.g * 255;
                data[idx+2] = color.b * 255;
                data[idx+3] = 200;
            }
        }
    }
    
    const texture = new THREE.DataTexture(data, steps, depths, THREE.RGBAFormat);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}
