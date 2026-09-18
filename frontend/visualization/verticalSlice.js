import * as THREE from 'three';
import { sampleColor } from './colorScale.js';

export function createVerticalSliceTexture(dataArray, varName, minVal, maxVal, customCoords = null, bounds = null) {
    const values = dataArray.values;
    if (!values || !values.length) return null;
    
    // Check if 3D
    if (!Array.isArray(values[0]) || !Array.isArray(values[0][0])) return null;

    const depths = values.length;
    const lats = values[0].length;
    const lons = values[0][0].length;
    
    const steps = Math.max(lats, lons);
    const data = new Uint8Array(4 * steps * depths);
    
    // If no customCoords, default to diagonal
    let startLonIdx = 0, startLatIdx = 0;
    let endLonIdx = lons - 1, endLatIdx = lats - 1;

    if (customCoords && bounds) {
        // Map geographic coords to grid indices
        const dLon = bounds[1] - bounds[0];
        const dLat = bounds[3] - bounds[2];
        
        startLonIdx = ((customCoords.sLon - bounds[0]) / dLon) * (lons - 1);
        startLatIdx = ((customCoords.sLat - bounds[2]) / dLat) * (lats - 1);
        endLonIdx = ((customCoords.eLon - bounds[0]) / dLon) * (lons - 1);
        endLatIdx = ((customCoords.eLat - bounds[2]) / dLat) * (lats - 1);
    }
    
    for (let d = 0; d < depths; d++) {
        for (let s = 0; s < steps; s++) {
            const t = s / (steps - 1 || 1);
            
            const lonIdx = Math.round(startLonIdx + t * (endLonIdx - startLonIdx));
            const latIdx = Math.round(startLatIdx + t * (endLatIdx - startLatIdx));
            
            const idx = ((depths - 1 - d) * steps + s) * 4; // Y is depth
            
            if (latIdx < 0 || latIdx >= lats || lonIdx < 0 || lonIdx >= lons) {
                // Out of bounds
                data[idx+3] = 0;
                continue;
            }
            
            const val = values[d][latIdx][lonIdx];
            
            if (val === null || val === undefined || isNaN(val)) {
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
