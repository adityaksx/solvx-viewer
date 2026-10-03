/**
 * 3D Land Geometry and Topography for SolvX Scene.
 * Uses canonical GeographicTransform.
 * Follows Sections 20 & 23 of the implementation plan.
 */

import * as THREE from 'three';
import { GeographicTransform } from './geographicTransform.js';

export function buildLandMesh(geometryData, geoConfig) {
    const group = new THREE.Group();
    group.name = "LandGroup";

    const parts = geometryData.land || [];
    if (!parts.length) return group;

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

    const topY = 0.5; // Slightly elevated above surface to prevent z-fighting
    const boundaryBaseY = GeographicTransform.depthToWorldY(geoConfig.depthMax, geoConfig);

    // 1. Build Polygon Geometry (Top surface)
    const pos = [];
    const index = [];
    let base = 0;

    for (const p of parts) {
        for (const v of p.vertices || []) {
            const normX = (v[0] - kmXMin) / Math.max(kmXMax - kmXMin, 1e-6);
            const normZ = (v[1] - kmYMin) / Math.max(kmYMax - kmYMin, 1e-6);

            const lon = gLonMin + normX * (gLonMax - gLonMin);
            const lat = gLatMin + normZ * (gLatMax - gLatMin);

            const worldPt = GeographicTransform.geoToWorld(lon, lat, 0, geoConfig);
            pos.push(worldPt.x, topY, worldPt.z);
        }
        for (const t of p.triangles || []) {
            index.push(base + t[0], base + t[1], base + t[2]);
        }
        base += (p.vertices || []).length;
    }

    const landGeom = new THREE.BufferGeometry();
    landGeom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    landGeom.setIndex(index);
    landGeom.computeVertexNormals();

    const topMat = new THREE.MeshStandardMaterial({
        color: 0x3da35d, // Coastal green
        roughness: 0.70,
        metalness: 0.05,
        side: THREE.DoubleSide,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
    });

    const topMesh = new THREE.Mesh(landGeom, topMat);
    topMesh.renderOrder = 1;
    group.add(topMesh);

    // 2. Extruded Soil Sides down to bedrock
    const sideMat = new THREE.MeshStandardMaterial({
        color: 0x7c6853, // Earth brown
        roughness: 0.90,
        metalness: 0.02,
        side: THREE.DoubleSide,
        depthWrite: true
    });

    const sidePos = [];
    const sideIdx = [];

    for (const part of parts) {
        const ring = part.top || [];
        for (let i = 0; i < ring.length - 1; i++) {
            const a = ring[i];
            const b = ring[i + 1];

            const aNormX = (a[0] - kmXMin) / Math.max(kmXMax - kmXMin, 1e-6);
            const aNormZ = (a[1] - kmYMin) / Math.max(kmYMax - kmYMin, 1e-6);
            const aLon = gLonMin + aNormX * (gLonMax - gLonMin);
            const aLat = gLatMin + aNormZ * (gLatMax - gLatMin);
            const aWorld = GeographicTransform.geoToWorld(aLon, aLat, 0, geoConfig);

            const bNormX = (b[0] - kmXMin) / Math.max(kmXMax - kmXMin, 1e-6);
            const bNormZ = (b[1] - kmYMin) / Math.max(kmYMax - kmYMin, 1e-6);
            const bLon = gLonMin + bNormX * (gLonMax - gLonMin);
            const bLat = gLatMin + bNormZ * (gLatMax - gLatMin);
            const bWorld = GeographicTransform.geoToWorld(bLon, bLat, 0, geoConfig);

            const q = sidePos.length / 3;
            sidePos.push(
                aWorld.x, topY, aWorld.z,
                aWorld.x, boundaryBaseY, aWorld.z,
                bWorld.x, topY, bWorld.z,
                bWorld.x, boundaryBaseY, bWorld.z
            );
            sideIdx.push(q, q + 2, q + 1, q + 2, q + 3, q + 1);
        }
    }

    if (sidePos.length) {
        const sideGeom = new THREE.BufferGeometry();
        sideGeom.setAttribute('position', new THREE.Float32BufferAttribute(sidePos, 3));
        sideGeom.setIndex(sideIdx);
        sideGeom.computeVertexNormals();

        const sideMesh = new THREE.Mesh(sideGeom, sideMat);
        sideMesh.renderOrder = 1;
        group.add(sideMesh);
    }

    return group;
}
