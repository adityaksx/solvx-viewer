/**
 * 3D Bathymetric Seabed Generator for SolvX Scene.
 * Uses GEBCO bathymetry grid to build a physical seabed basin.
 * Follows Section 21 & 25 of the prototype plan.
 */

import * as THREE from 'three';

export function buildSeabedMesh(bathymetryData, verticalExaggeration = 5.0) {
    const t = bathymetryData?.terrain;
    if (!t || !t.x || !t.y || !t.rawDepthKm) return null;

    const group = new THREE.Group();
    group.name = "SeabedGroup";

    const nx = t.x.length; // e.g. 305 (Longitude / Easting)
    const ny = t.y.length; // e.g. 256 (Latitude / Northing)
    const bedrockY = -3.5 * verticalExaggeration;

    // 1. Bathymetric Surface
    const pos = [];
    const index = [];
    const map = new Int32Array(nx * ny);
    map.fill(-1);

    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const rawDepthKm = Number((t.rawDepthKm[j] || [])[i]);
            // Skip zero or negative (land elevation handled by land mesh)
            if (rawDepthKm == null || isNaN(rawDepthKm) || rawDepthKm <= 0.05) continue;

            const yPos = -rawDepthKm * verticalExaggeration;
            map[j * nx + i] = pos.length / 3;

            // X = Longitude/Easting (t.x[i]), Y = Depth, Z = Latitude/Northing (t.y[j])
            pos.push(t.x[i], yPos, t.y[j]);
        }
    }

    for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
            const a = map[j * nx + i];
            const b = map[j * nx + i + 1];
            const c = map[(j + 1) * nx + i];
            const d = map[(j + 1) * nx + i + 1];

            if (a >= 0 && b >= 0 && c >= 0 && d >= 0) {
                index.push(a, b, c, b, d, c);
            }
        }
    }

    if (!pos.length) return null;

    const seabedGeom = new THREE.BufferGeometry();
    seabedGeom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    seabedGeom.setIndex(index);
    seabedGeom.computeVertexNormals();

    // Ocean floor material (sand/silt texture with subtle lighting)
    const seabedMat = new THREE.MeshStandardMaterial({
        color: 0xc2a677, // Sandy beige seabed
        roughness: 0.90,
        metalness: 0.05,
        side: THREE.DoubleSide,
        depthWrite: true,
    });

    const seabedMesh = new THREE.Mesh(seabedGeom, seabedMat);
    seabedMesh.receiveShadow = true;
    seabedMesh.renderOrder = 2;
    group.add(seabedMesh);

    // 2. Side Walls down to bedrock
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

    // Outer boundary walls
    // South edge (j = 0)
    for (let i = 0; i < nx - 1; i++) {
        const a = map[0 * nx + i];
        const b = map[0 * nx + i + 1];
        if (a >= 0 && b >= 0) {
            addSideQuad(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
        }
    }
    // North edge (j = ny - 1)
    for (let i = 0; i < nx - 1; i++) {
        const a = map[(ny - 1) * nx + i];
        const b = map[(ny - 1) * nx + i + 1];
        if (a >= 0 && b >= 0) {
            addSideQuad(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2], pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
        }
    }
    // West edge (i = 0)
    for (let j = 0; j < ny - 1; j++) {
        const a = map[j * nx + 0];
        const b = map[(j + 1) * nx + 0];
        if (a >= 0 && b >= 0) {
            addSideQuad(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2], pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
        }
    }
    // East edge (i = nx - 1)
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
            color: 0x6e5d47, // Bedrock brown
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
