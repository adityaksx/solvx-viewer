// SolvX Viewer — 3D Bathymetric Seabed Mesh Generator
// Generates the seabed surface + side walls + bottom cap so there's no hollow space below.
import * as THREE from 'three';

export function buildSeabed(bathymetry, sceneManager) {
    const t = bathymetry.terrain;
    if (!t || !t.x || !t.y) return null;

    const group = new THREE.Group();
    const nx = t.x.length;
    const ny = t.y.length;

    // Bedrock baseline — everything is filled down to this level
    const bedrockY = sceneManager.depthY(3500);

    // ---- 1. Seabed Surface Heightfield ----
    const pos = [];
    const index = [];
    const map = new Int32Array(nx * ny);
    map.fill(-1);

    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const rawDepth = Number((t.rawDepthKm[j] || [])[i]);
            if (rawDepth == null || isNaN(rawDepth) || rawDepth <= 0) continue;

            const yPos = sceneManager.depthY(rawDepth * 1000);
            map[j * nx + i] = pos.length / 3;
            // X is Northing (t.y[j]), Z is Easting (t.x[i])
            pos.push(t.y[j], yPos, t.x[i]);
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
        color: 0xd2ae80,
        roughness: 0.95,
        metalness: 0.05,
        side: THREE.DoubleSide,
        depthWrite: true
    });

    const seabedMesh = new THREE.Mesh(seabedGeom, seabedMat);
    seabedMesh.receiveShadow = true;
    seabedMesh.renderOrder = 2;
    group.add(seabedMesh);

    // ---- 2. Side Walls (connect seabed edges down to bedrock) ----
    const soilMat = new THREE.MeshStandardMaterial({
        color: 0xc8a477,
        roughness: 0.95,
        metalness: 0.02,
        side: THREE.DoubleSide,
        depthWrite: true
    });

    const sidePos = [];
    const sideIdx = [];

    // Helper: add a vertical quad from (x1,y1,z1) to (x2,y2,z2) down to bedrockY
    function addSideQuad(x1, y1, z1, x2, y2, z2) {
        const base = sidePos.length / 3;
        sidePos.push(
            x1, y1, z1,     // top-left
            x1, bedrockY, z1, // bottom-left
            x2, y2, z2,     // top-right
            x2, bedrockY, z2  // bottom-right
        );
        sideIdx.push(
            base, base + 2, base + 1,
            base + 2, base + 3, base + 1
        );
    }

    // Edge detection: Walk the boundary rows/cols of the seabed grid
    // Bottom edge (j = first row with data, walking i)
    for (let i = 0; i < nx - 1; i++) {
        const j = 0;
        const a = map[j * nx + i];
        const b = map[j * nx + i + 1];
        if (a >= 0 && b >= 0) {
            addSideQuad(
                pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2],
                pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]
            );
        }
    }

    // Top edge (j = last row, walking i)
    for (let i = 0; i < nx - 1; i++) {
        const j = ny - 1;
        const a = map[j * nx + i];
        const b = map[j * nx + i + 1];
        if (a >= 0 && b >= 0) {
            addSideQuad(
                pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2],
                pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]
            );
        }
    }

    // Left edge (i = 0, walking j)
    for (let j = 0; j < ny - 1; j++) {
        const i = 0;
        const a = map[j * nx + i];
        const b = map[(j + 1) * nx + i];
        if (a >= 0 && b >= 0) {
            addSideQuad(
                pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2],
                pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]
            );
        }
    }

    // Right edge (i = nx-1, walking j)
    for (let j = 0; j < ny - 1; j++) {
        const i = nx - 1;
        const a = map[j * nx + i];
        const b = map[(j + 1) * nx + i];
        if (a >= 0 && b >= 0) {
            addSideQuad(
                pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2],
                pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]
            );
        }
    }

    if (sidePos.length) {
        const sideGeom = new THREE.BufferGeometry();
        sideGeom.setAttribute('position', new THREE.Float32BufferAttribute(sidePos, 3));
        sideGeom.setIndex(sideIdx);
        sideGeom.computeVertexNormals();
        const sideMesh = new THREE.Mesh(sideGeom, soilMat);
        sideMesh.renderOrder = 2;
        group.add(sideMesh);
    }

    // ---- 3. Bottom Cap (flat quad at bedrock level) ----
    const minX = t.y[0];
    const maxX = t.y[ny - 1];
    const minZ = t.x[0];
    const maxZ = t.x[nx - 1];

    const bottomGeom = new THREE.BufferGeometry();
    const bottomPos = new Float32Array([
        minX, bedrockY, minZ,
        maxX, bedrockY, minZ,
        maxX, bedrockY, maxZ,
        minX, bedrockY, maxZ
    ]);
    const bottomIdx = [0, 2, 1, 0, 3, 2];
    bottomGeom.setAttribute('position', new THREE.BufferAttribute(bottomPos, 3));
    bottomGeom.setIndex(bottomIdx);
    bottomGeom.computeVertexNormals();

    const bottomMesh = new THREE.Mesh(bottomGeom, soilMat);
    bottomMesh.renderOrder = 2;
    group.add(bottomMesh);

    group.renderOrder = 2;
    return group;
}
