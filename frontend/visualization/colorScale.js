// SolvX Viewer — Scientific Color Scales & Legend
import * as THREE from 'three';

export const PALETTES = {
    ocean_temperature: [
        [0x071b8f, 0.0],
        [0x075cff, 0.15],
        [0x00c6ff, 0.32],
        [0x00e79a, 0.48],
        [0xfff000, 0.62],
        [0xff6b00, 0.80],
        [0xb40000, 1.0]
    ],
    air_temperature: [
        [0x071b8f, 0.0],
        [0x075cff, 0.15],
        [0x00c6ff, 0.32],
        [0x00e79a, 0.48],
        [0xfff000, 0.62],
        [0xff6b00, 0.80],
        [0xb40000, 1.0]
    ],
    sea_level_anomaly: [
        [0x06349e, 0.0],
        [0x4b9fe8, 0.25],
        [0xffffff, 0.50],
        [0xffa060, 0.75],
        [0xb60018, 1.0]
    ],
    temperature_anomaly: [
        [0x06349e, 0.0],
        [0x4b9fe8, 0.25],
        [0xffffff, 0.50],
        [0xffa060, 0.75],
        [0xb60018, 1.0]
    ],
    salinity: [
        [0x071d9b, 0.0],
        [0x00a6ff, 0.20],
        [0x00d49a, 0.42],
        [0xb8e52e, 0.68],
        [0xffe600, 1.0]
    ],
    currents: [
        [0x0a194f, 0.0],
        [0x0066cc, 0.25],
        [0x00cc99, 0.50],
        [0xffcc00, 0.75],
        [0xff3300, 1.0]
    ],
    sea_surface_height: [
        [0x102caa, 0.0],
        [0x00a9ff, 0.25],
        [0x26d08b, 0.50],
        [0xffd21a, 0.75],
        [0xd40000, 1.0]
    ],
    chlorophyll: [
        [0xf7fff0, 0.0],
        [0xb7ef59, 0.20],
        [0x42c83e, 0.45],
        [0x078d38, 0.72],
        [0x003d20, 1.0]
    ],
    dissolved_oxygen: [
        [0x440154, 0.0],
        [0x3b528b, 0.25],
        [0x21908c, 0.50],
        [0x5dc863, 0.75],
        [0xfde725, 1.0]
    ],
    ph: [
        [0x990000, 0.0],
        [0xff6600, 0.25],
        [0xffff00, 0.50],
        [0x33cc33, 0.75],
        [0x0000ff, 1.0]
    ],
    mixed_layer_depth: [
        [0xffffff, 0.0],
        [0x99ccff, 0.33],
        [0x0066cc, 0.66],
        [0x000066, 1.0]
    ],
    wave_height: [
        [0x000033, 0.0],
        [0x006699, 0.25],
        [0x00ccff, 0.50],
        [0x99ffff, 0.75],
        [0xffffff, 1.0]
    ],
    wind_speed: [
        [0x000000, 0.0],
        [0x330066, 0.25],
        [0xcc0066, 0.50],
        [0xff9900, 0.75],
        [0xffffcc, 1.0]
    ],
    fallback: [
        [0x071b8f, 0.0],
        [0x00cfff, 0.25],
        [0xfff000, 0.50],
        [0xff6a00, 0.75],
        [0xb40000, 1.0]
    ]
};

export function getPaletteStops(variable) {
    return PALETTES[variable] || PALETTES.fallback;
}

export function sampleColor(variable, val, lo, hi) {
    const stops = getPaletteStops(variable);
    const range = hi - lo || 1.0;
    const t = Math.max(0, Math.min(1, (Number(val) - lo) / range));

    let a = stops[0];
    let b = stops[stops.length - 1];

    for (let i = 0; i < stops.length - 1; i++) {
        if (t <= stops[i + 1][1]) {
            a = stops[i];
            b = stops[i + 1];
            break;
        }
    }

    const u = (t - a[1]) / (b[1] - a[1] || 1.0);
    const ar = (a[0] >> 16) & 255;
    const ag = (a[0] >> 8) & 255;
    const ab = a[0] & 255;
    const br = (b[0] >> 16) & 255;
    const bg = (b[0] >> 8) & 255;
    const bb = b[0] & 255;

    return new THREE.Color(
        (ar + (br - ar) * u) / 255,
        (ag + (bg - ag) * u) / 255,
        (ab + (bb - ab) * u) / 255
    );
}

export function updateLegendUI(variable, lo, hi, units = '') {
    const bar = document.getElementById('legendBar');
    const loEl = document.getElementById('legendLo');
    const hiEl = document.getElementById('legendHi');
    const titleEl = document.getElementById('legendTitle');
    const typeEl = document.getElementById('legendScaleType');

    if (loEl) loEl.textContent = `${Number(lo).toFixed(2)} ${units}`;
    if (hiEl) hiEl.textContent = `${Number(hi).toFixed(2)} ${units}`;
    if (titleEl) titleEl.textContent = `${variable.replace(/_/g, ' ').toUpperCase()}`;

    // Determine scale type
    const divergingVars = ['sea_level_anomaly', 'temperature_anomaly', 'wind_stress']; // add others if needed
    const isDiverging = divergingVars.includes(variable);
    if (typeEl) typeEl.textContent = isDiverging ? 'Diverging Scale' : 'Sequential Scale';

    if (bar) {
        const stops = getPaletteStops(variable);
        const cssStops = stops.map(s => {
            const hex = '#' + s[0].toString(16).padStart(6, '0');
            return `${hex} ${(s[1] * 100).toFixed(0)}%`;
        });
        bar.style.background = `linear-gradient(90deg, ${cssStops.join(', ')})`;
    }

}
