import * as THREE from 'three';
import { sampleColor } from './colorScale.js';

export function createDataTexture2D(dataArray, varName, minVal, maxVal) {
    // dataArray.values is a 2D array [lat][lon]
    const values = dataArray.values;
    if (!values || !values.length) return null;

    const height = values.length; // lat
    const width = values[0].length; // lon

    const size = width * height;
    const data = new Uint8Array(4 * size);

    for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
            const val = values[j][i];
            const idx = (j * width + i) * 4;
            
            if (val === null || val === undefined || isNaN(val)) {
                data[idx] = 0;
                data[idx+1] = 0;
                data[idx+2] = 0;
                data[idx+3] = 0; // Transparent for NaN
            } else {
                const color = sampleColor(varName, val, minVal, maxVal);
                data[idx] = Math.round(color.r * 255);
                data[idx+1] = Math.round(color.g * 255);
                data[idx+2] = Math.round(color.b * 255);
                data[idx+3] = 245; // High opacity for crisp data overlay
            }
        }
    }

    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

export function extractSlice2D(dataArray, depthIndex) {
    if (!dataArray.values || !dataArray.values.length) return null;
    // Check if it's 3D: [depth][lat][lon]
    if (Array.isArray(dataArray.values[0]) && Array.isArray(dataArray.values[0][0])) {
        const d = Math.max(0, Math.min(depthIndex, dataArray.values.length - 1));
        return dataArray.values[d];
    }
    // Already 2D
    return dataArray.values;
}

export function findDepthIndex(depths, targetDepth) {
    if (!depths || !depths.length) return 0;
    let bestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < depths.length; i++) {
        const diff = Math.abs(depths[i] - targetDepth);
        if (diff < minDiff) {
            minDiff = diff;
            bestIdx = i;
        }
    }
    return bestIdx;
}
