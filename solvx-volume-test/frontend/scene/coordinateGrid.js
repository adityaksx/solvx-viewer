/**
 * Geographic Coordinate Grid and Depth Marker Posts.
 * Follows Sections 28, 29, 30 of the implementation plan.
 */

import * as THREE from 'three';
import { GeographicTransform } from './geographicTransform.js';

export function buildCoordinateGrid(geoConfig) {
    const group = new THREE.Group();
    group.name = "CoordinateGridGroup";

    const lineMat = new THREE.LineBasicMaterial({
        color: 0x0ea5e9,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
    });

    const labelMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
    });

    // 1. Longitude Lines (Meridians) at Sea Level (Y = 0)
    const lonStart = Math.ceil(geoConfig.lonMin);
    const lonEnd = Math.floor(geoConfig.lonMax);

    for (let lon = lonStart; lon <= lonEnd; lon++) {
        const p1 = GeographicTransform.geoToWorld(lon, geoConfig.latMin, 0, geoConfig);
        const p2 = GeographicTransform.geoToWorld(lon, geoConfig.latMax, 0, geoConfig);

        const geom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(p1.x, p1.y, p1.z),
            new THREE.Vector3(p2.x, p2.y, p2.z)
        ]);
        group.add(new THREE.Line(geom, lineMat));
    }

    // 2. Latitude Lines (Parallels) at Sea Level (Y = 0)
    const latStart = Math.ceil(geoConfig.latMin);
    const latEnd = Math.floor(geoConfig.latMax);

    for (let lat = latStart; lat <= latEnd; lat++) {
        const p1 = GeographicTransform.geoToWorld(geoConfig.lonMin, lat, 0, geoConfig);
        const p2 = GeographicTransform.geoToWorld(geoConfig.lonMax, lat, 0, geoConfig);

        const geom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(p1.x, p1.y, p1.z),
            new THREE.Vector3(p2.x, p2.y, p2.z)
        ]);
        group.add(new THREE.Line(geom, lineMat));
    }

    // 3. Corner Depth Marker Posts
    const corners = [
        [geoConfig.lonMin, geoConfig.latMin],
        [geoConfig.lonMax, geoConfig.latMin],
        [geoConfig.lonMin, geoConfig.latMax],
        [geoConfig.lonMax, geoConfig.latMax],
    ];

    const markerDepths = [0, 100, 200, 500, 800, 1000].filter(d => d <= geoConfig.depthMax);

    for (const [cLon, cLat] of corners) {
        // Vertical post from Y=0 down to max depth
        const top = GeographicTransform.geoToWorld(cLon, cLat, 0, geoConfig);
        const bottom = GeographicTransform.geoToWorld(cLon, cLat, geoConfig.depthMax, geoConfig);

        const postGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(top.x, top.y, top.z),
            new THREE.Vector3(bottom.x, bottom.y, bottom.z)
        ]);
        group.add(new THREE.Line(postGeom, labelMat));

        // Depth tick marks
        for (const d of markerDepths) {
            const tickCenter = GeographicTransform.geoToWorld(cLon, cLat, d, geoConfig);
            const tickGeom = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(tickCenter.x - 5, tickCenter.y, tickCenter.z),
                new THREE.Vector3(tickCenter.x + 5, tickCenter.y, tickCenter.z)
            ]);
            group.add(new THREE.Line(tickGeom, labelMat));
        }
    }

    return group;
}
