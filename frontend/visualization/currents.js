// SolvX Viewer — 3D Ocean Current Vector Field
import * as THREE from 'three';
import { sampleColor, updateLegendUI } from './colorScale.js';

export function buildCurrentVectors(currentGrid, sceneManager, bounds) {
    const group = new THREE.Group();
    if (!currentGrid || !currentGrid.u || !currentGrid.v) return group;

    const lat = currentGrid.latitude || [];
    const lon = currentGrid.longitude || [];
    const u = currentGrid.u || [];
    const v = currentGrid.v || [];

    const midLat = (bounds[2] + bounds[3]) / 2;
    const midLon = (bounds[0] + bounds[1]) / 2;
    const klat = 111.32;
    const klon = 111.32 * Math.cos((midLat * Math.PI) / 180);

    const project = (lng, lt) => [
        (Number(lng) - midLon) * klon,
        (Number(lt) - midLat) * klat
    ];

    let maxSpeed = 0.001;
    const points = [];

    // Calculate max speed for scaling
    for (let j = 0; j < lat.length; j++) {
        for (let i = 0; i < lon.length; i++) {
            const uu = Number(u[j]?.[i]);
            const vv = Number(v[j]?.[i]);
            if (isFinite(uu) && isFinite(vv)) {
                maxSpeed = Math.max(maxSpeed, Math.hypot(uu, vv));
            }
        }
    }

    updateLegendUI('currents', 0.0, maxSpeed, currentGrid.units || 'm s⁻¹');

    // Build arrow line segments
    const linePos = [];
    const lineCols = [];

    for (let j = 0; j < lat.length; j++) {
        for (let i = 0; i < lon.length; i++) {
            const uu = Number(u[j]?.[i]);
            const vv = Number(v[j]?.[i]);
            if (!isFinite(uu) || !isFinite(vv)) continue;

            const speed = Math.hypot(uu, vv);
            if (speed < 0.005) continue;

            const [pLon, pLat] = project(lon[i], lat[j]);
            const x = pLat; // Scene X is Northing
            const z = pLon; // Scene Z is Easting
            const y = 0.35; // Hover just above sea level

            const len = 6 + (speed / maxSpeed) * 22;
            const dx = (vv / speed) * len; // Northward velocity
            const dz = (uu / speed) * len; // Eastward velocity

            const ex = x + dx;
            const ez = z + dz;

            // Shaft
            linePos.push(x, y, z, ex, y, ez);

            // Arrow head
            const angle = Math.atan2(dz, dx);
            const headLen = Math.min(6, len * 0.3);
            const leftX = ex - headLen * Math.cos(angle - 0.5);
            const leftZ = ez - headLen * Math.sin(angle - 0.5);
            const rightX = ex - headLen * Math.cos(angle + 0.5);
            const rightZ = ez - headLen * Math.sin(angle + 0.5);

            linePos.push(ex, y, ez, leftX, y, leftZ);
            linePos.push(ex, y, ez, rightX, y, rightZ);

            const col = sampleColor('currents', speed, 0.0, maxSpeed);
            for (let c = 0; c < 6; c++) {
                lineCols.push(col.r, col.g, col.b);
            }
        }
    }

    if (linePos.length) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
        geom.setAttribute('color', new THREE.Float32BufferAttribute(lineCols, 3));
        const mat = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.95,
            linewidth: 2
        });
        group.add(new THREE.LineSegments(geom, mat));
    }

    return group;
}
