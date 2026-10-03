/**
 * 3D Bathymetric Seabed Generator for SolvX Scene.
 * Uses GEBCO bathymetry grid and canonical GeographicTransform.
 * Follows Sections 16, 17, 24 of the implementation plan.
 */

import * as THREE from 'three';
import { GeographicTransform } from './geographicTransform.js';

export class BathymetryLookup {
    constructor(bathymetryData, bounds) {
        this.t = bathymetryData?.terrain;
        this.bounds = bounds || [84.10, 93.00, 16.07, 23.52];
        this.nx = this.t?.x?.length || 0;
        this.ny = this.t?.y?.length || 0;
        this.rawDepthKm = this.t?.rawDepthKm || [];
    }

    getDepthAt(lon, lat) {
        if (!this.nx || !this.ny) return 0;
        const [lonMin, lonMax, latMin, latMax] = this.bounds;
        const normX = Math.max(0, Math.min(1, (lon - lonMin) / Math.max(lonMax - lonMin, 1e-6)));
        const normY = Math.max(0, Math.min(1, (lat - latMin) / Math.max(latMax - latMin, 1e-6)));

        const xi = Math.round(normX * (this.nx - 1));
        const yj = Math.round(normY * (this.ny - 1));

        const dKm = (this.rawDepthKm[yj] || [])[xi];
        return (dKm != null && !isNaN(dKm) && dKm > 0) ? dKm * 1000.0 : 0;
    }
}

export function buildSeabedMesh(bathymetryData, geoConfig) {
    const t = bathymetryData?.terrain;
    if (!t || !t.rawDepthKm) return null;

    const group = new THREE.Group();
    group.name = "SeabedGroup";

    const nx = t.x.length; // Longitude count (305)
    const ny = t.y.length; // Latitude count (256)
    const bounds = bathymetryData.bounds || [geoConfig.lonMin, geoConfig.lonMax, geoConfig.latMin, geoConfig.latMax];
    const [bLonMin, bLonMax, bLatMin, bLatMax] = bounds;

    const bedrockY = -Math.max(geoConfig.depthMax, 3500) / 1000.0 * geoConfig.verticalExaggeration;

    // 1. Bathymetric Surface Heightfield
    const pos = [];
    const index = [];
    const map = new Int32Array(nx * ny);
    map.fill(-1);

    for (let j = 0; j < ny; j++) {
        const latNorm = j / Math.max(ny - 1, 1);
        const lat = bLatMin + latNorm * (bLatMax - bLatMin);

        for (let i = 0; i < nx; i++) {
            const lonNorm = i / Math.max(nx - 1, 1);
            const lon = bLonMin + lonNorm * (bLonMax - bLonMin);

            const rawDepthKm = Number((t.rawDepthKm[j] || [])[i]);
            // Skip land (elevation <= 0.05 km)
            if (rawDepthKm == null || isNaN(rawDepthKm) || rawDepthKm <= 0.05) continue;

            const depthM = rawDepthKm * 1000.0;
            const worldPt = GeographicTransform.geoToWorld(lon, lat, depthM, geoConfig);

            map[j * nx + i] = pos.length / 3;
            pos.push(worldPt.x, worldPt.y, worldPt.z);
        }
    }

    for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
            const a = map[j * nx + i];
            const b = map[j * nx + i + 1];
            const c = map[(j + 1) * nx + i];
            const d = map[(j + 1) * nx + i + 1];

            if (a >= 0 && b >= 0 && c >= 0 && d >= 0) {
                index.push(a, c, b, b, c, d);
            }
        }
    }

    if (!pos.length) return null;

    const seabedGeom = new THREE.BufferGeometry();
    seabedGeom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    seabedGeom.setIndex(index);
    seabedGeom.computeVertexNormals();

    const seabedMat = new THREE.MeshStandardMaterial({
        color: 0xc4a47c, // Sand/silt seabed color
        roughness: 0.85,
        metalness: 0.05,
        side: THREE.DoubleSide,
        depthWrite: true,
    });

    const seabedMesh = new THREE.Mesh(seabedGeom, seabedMat);
    seabedMesh.renderOrder = 2;
    group.add(seabedMesh);

    // 2. Bedrock Side Walls
    const sidePos = [];
    const sideIdx = [];

    function addSideQuad(x1, y1, z1, x2, y2, z2) {
        const base = sidePos.length / 3;
        sidePos.push(
            x1, y1, z1,
            x1, bedrockY, z1,
            x2, y2, z2,
            x2, bedrockY, z2
        );
        sideIdx.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    }

    // South Edge (j = 0)
    for (let i = 0; i < nx - 1; i++) {
        const a = map[0 * nx + i];
        const b = map[0 * nx + i + 1];
        if (a >= 0 && b >= 0) {
            addSideQuad(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
        }
    }
    // North Edge (j = ny - 1)
    for (let i = 0; i < nx - 1; i++) {
        const a = map[(ny - 1) * nx + i];
        const b = map[(ny - 1) * nx + i + 1];
        if (a >= 0 && b >= 0) {
            addSideQuad(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2], pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
        }
    }
    // West Edge (i = 0)
    for (let j = 0; j < ny - 1; j++) {
        const a = map[j * nx + 0];
        const b = map[(j + 1) * nx + 0];
        if (a >= 0 && b >= 0) {
            addSideQuad(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2], pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
        }
    }
    // East Edge (i = nx - 1)
    for (let j = 0; j < ny - 1; j++) {
        const a = map[j * nx + (nx - 1)];
        const b = map[(j + 1) * nx + (nx - 1)];
        if (a >= 0 && b >= 0) {
            addSideQuad(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
        }
    }

    if (sidePos.length) {
        const sideGeom = new THREE.BufferGeometry();
        sideGeom.setAttribute('position', new THREE.Float32BufferAttribute(sidePos, 3));
        sideGeom.setIndex(sideIdx);
        sideGeom.computeVertexNormals();

        const sideMat = new THREE.MeshStandardMaterial({
            color: 0x6b5742,
            roughness: 0.95,
            metalness: 0.05,
            side: THREE.DoubleSide,
            depthWrite: true,
        });

        const sideMesh = new THREE.Mesh(sideGeom, sideMat);
        sideMesh.renderOrder = 2;
        group.add(sideMesh);
    }

    return group;
}
