/**
 * Coastline Vector Overlay for SolvX Scene.
 * Follows Sections 21 & 22 of the implementation plan.
 */

import * as THREE from 'three';
import { GeographicTransform } from './geographicTransform.js';

export function buildCoastlines(geometryData, geoConfig) {
    const group = new THREE.Group();
    group.name = "CoastlineGroup";

    const coastlines = geometryData.coast || [];
    if (!coastlines.length) return group;

    const gBounds = geometryData.bounds || [geoConfig.lonMin, geoConfig.lonMax, geoConfig.latMin, geoConfig.latMax];
    const gLonMin = gBounds[0], gLonMax = gBounds[1];
    const gLatMin = gBounds[2], gLatMax = gBounds[3];

    // Reference terrain range for normalizing km coordinates in geometry.json
    const tX = geometryData.terrain?.x || [];
    const tY = geometryData.terrain?.y || [];
    const kmXMin = tX.length ? tX[0] : -geoConfig.worldWidth / 2;
    const kmXMax = tX.length ? tX[tX.length - 1] : geoConfig.worldWidth / 2;
    const kmYMin = tY.length ? tY[0] : -geoConfig.worldLength / 2;
    const kmYMax = tY.length ? tY[tY.length - 1] : geoConfig.worldLength / 2;

    const lineMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        linewidth: 2,
        transparent: true,
        opacity: 0.95,
        depthWrite: true,
    });

    for (const seg of coastlines) {
        if (!seg || seg.length < 2) continue;
        const pts = [];
        for (const pt of seg) {
            // Convert geometry km point to lon/lat
            const normX = (pt[0] - kmXMin) / Math.max(kmXMax - kmXMin, 1e-6);
            const normZ = (pt[1] - kmYMin) / Math.max(kmYMax - kmYMin, 1e-6);

            const lon = gLonMin + normX * (gLonMax - gLonMin);
            const lat = gLatMin + normZ * (gLatMax - gLatMin);

            // Convert to canonical world coordinates at sea surface (Y = 0)
            const worldPt = GeographicTransform.geoToWorld(lon, lat, 0, geoConfig);
            pts.push(new THREE.Vector3(worldPt.x, worldPt.y + 0.5, worldPt.z)); // +0.5 to prevent z-fighting with ocean surface
        }

        const lineGeom = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(lineGeom, lineMat);
        line.renderOrder = 2;
        group.add(line);
    }

    return group;
}
