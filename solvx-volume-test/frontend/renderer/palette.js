/**
 * Procedural Color Palette Generator for Ocean Scalar Fields.
 * Follows Section 17 & 49 of the prototype plan.
 */

import * as THREE from 'three';

const PALETTE_DEFINITIONS = {
    'Ocean Thermal (Turbo)': [
        [0.00, 0.19, 0.07, 0.23],
        [0.15, 0.12, 0.38, 0.89],
        [0.35, 0.10, 0.74, 0.61],
        [0.55, 0.65, 0.89, 0.15],
        [0.75, 0.98, 0.65, 0.05],
        [0.90, 0.92, 0.28, 0.01],
        [1.00, 0.50, 0.00, 0.00],
    ],
    'Viridis': [
        [0.00, 0.267, 0.004, 0.329],
        [0.25, 0.190, 0.407, 0.556],
        [0.50, 0.127, 0.566, 0.550],
        [0.75, 0.369, 0.788, 0.382],
        [1.00, 0.993, 0.906, 0.143],
    ],
    'Cool-Warm': [
        [0.00, 0.23, 0.29, 0.75],
        [0.30, 0.50, 0.69, 0.90],
        [0.50, 0.86, 0.86, 0.86],
        [0.70, 0.92, 0.57, 0.46],
        [1.00, 0.70, 0.01, 0.15],
    ],
    'Haline (Salinity)': [
        [0.00, 0.05, 0.15, 0.35],
        [0.25, 0.08, 0.38, 0.52],
        [0.50, 0.16, 0.64, 0.60],
        [0.75, 0.55, 0.82, 0.50],
        [1.00, 0.95, 0.92, 0.60],
    ],
    'Chlorophyll': [
        [0.00, 0.02, 0.08, 0.28],
        [0.30, 0.05, 0.35, 0.50],
        [0.60, 0.10, 0.68, 0.35],
        [0.85, 0.65, 0.85, 0.10],
        [1.00, 0.98, 0.95, 0.20],
    ]
};

function interpolateStops(stops, t) {
    if (t <= stops[0][0]) return [stops[0][1], stops[0][2], stops[0][3]];
    if (t >= stops[stops.length - 1][0]) {
        const last = stops[stops.length - 1];
        return [last[1], last[2], last[3]];
    }

    for (let i = 0; i < stops.length - 1; i++) {
        const s0 = stops[i];
        const s1 = stops[i + 1];
        if (t >= s0[0] && t <= s1[0]) {
            const frac = (t - s0[0]) / Math.max(s1[0] - s0[0], 1e-6);
            return [
                s0[1] + frac * (s1[1] - s0[1]),
                s0[2] + frac * (s1[2] - s0[2]),
                s0[3] + frac * (s1[3] - s0[3]),
            ];
        }
    }
    return [1, 1, 1];
}

export function buildPaletteTexture(paletteName = 'Ocean Thermal (Turbo)') {
    const stops = PALETTE_DEFINITIONS[paletteName] || PALETTE_DEFINITIONS['Ocean Thermal (Turbo)'];
    const width = 256;
    const data = new Uint8Array(width * 4);

    for (let i = 0; i < width; i++) {
        const t = i / (width - 1);
        const [r, g, b] = interpolateStops(stops, t);
        data[i * 4 + 0] = Math.round(r * 255);
        data[i * 4 + 1] = Math.round(g * 255);
        data[i * 4 + 2] = Math.round(b * 255);
        data[i * 4 + 3] = 255;
    }

    const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
}

export function getAvailablePalettes() {
    return Object.keys(PALETTE_DEFINITIONS);
}
