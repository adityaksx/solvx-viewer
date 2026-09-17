// SolvX Viewer — 3D Land Geometry Generator
import * as THREE from 'three';

function polyGeometry(parts, y = 0) {
    const pos = [];
    const index = [];
    let base = 0;

    for (const p of parts || []) {
        for (const v of p.vertices || []) {
            pos.push(Number(v[1]), y, Number(v[0]));
        }
        for (const t of p.triangles || []) {
            index.push(base + t[0], base + t[1], base + t[2]);
        }
        base += (p.vertices || []).length;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
}

function createExtrudedMeshes(parts, sceneManager, topColor = 0x35b94d) {
    const group = new THREE.Group();
    if (!parts || !parts.length) return group;

    const topY = 0;
    const bottomY = sceneManager.depthY(3500); // 3.5 km bedrock base

    const topMat = new THREE.MeshStandardMaterial({
        color: topColor,
        roughness: 0.85,
        metalness: 0.05,
        side: THREE.DoubleSide
    });

    const soilMat = new THREE.MeshStandardMaterial({
        color: 0xc8a477,
        roughness: 0.95,
        metalness: 0.02,
        side: THREE.DoubleSide
    });

    // 1. Top surface
    const topMesh = new THREE.Mesh(polyGeometry(parts, topY), topMat);
    group.add(topMesh);

    // 2. Extruded sides (soil)
    const sidePos = [];
    const sideIdx = [];

    for (const part of parts) {
        const ring = part.top || [];
        for (let i = 0; i < ring.length - 1; i++) {
            const a = ring[i];
            const b = ring[i + 1];
            const q = sidePos.length / 3;

            sidePos.push(
                Number(a[1]), topY, Number(a[0]),
                Number(a[1]), bottomY, Number(a[0]),
                Number(b[1]), topY, Number(b[0]),
                Number(b[1]), bottomY, Number(b[0])
            );

            sideIdx.push(q, q + 2, q + 1, q + 2, q + 3, q + 1);
        }
    }

    if (sidePos.length) {
        const sideGeom = new THREE.BufferGeometry();
        sideGeom.setAttribute('position', new THREE.Float32BufferAttribute(sidePos, 3));
        sideGeom.setIndex(sideIdx);
        sideGeom.computeVertexNormals();
        const sideMesh = new THREE.Mesh(sideGeom, soilMat);
        group.add(sideMesh);
    }

    // 3. Bottom bedrock slab
    const bottomMesh = new THREE.Mesh(polyGeometry(parts, bottomY), soilMat);
    group.add(bottomMesh);

    return group;
}

export function buildLand(geography, sceneManager) {
    return createExtrudedMeshes(geography.land || [], sceneManager, 0x35b94d);
}

export function buildIslands(geography, sceneManager) {
    return createExtrudedMeshes(geography.islands || [], sceneManager, 0x2e9b42);
}
