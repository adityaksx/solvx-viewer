/**
 * 3D Land Geometry and Coastlines for SolvX Scene.
 * Follows Section 20 of the prototype plan.
 */

import * as THREE from 'three';

function buildPolygonGeometry(parts, y = 0) {
    const pos = [];
    const index = [];
    let base = 0;

    for (const p of parts || []) {
        for (const v of p.vertices || []) {
            // v[0] = Easting/X (km), v[1] = Northing/Z (km)
            pos.push(Number(v[0]), y, Number(v[1]));
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

export function buildLandMesh(geometryData, verticalExaggeration = 5.0) {
    const group = new THREE.Group();
    group.name = "LandGroup";

    const parts = geometryData.land || [];
    if (!parts.length) return group;

    const topY = 1.0; // Slightly elevated above surface to prevent z-fighting
    const bedrockY = -3.5 * verticalExaggeration; // 3.5 km bedrock

    // Top surface (coastal vegetation / topography)
    const topMat = new THREE.MeshStandardMaterial({
        color: 0x3da35d, // Vibrant coastal green
        roughness: 0.7,
        metalness: 0.05,
        side: THREE.DoubleSide,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
    });

    const topMesh = new THREE.Mesh(buildPolygonGeometry(parts, topY), topMat);
    topMesh.renderOrder = 1;
    group.add(topMesh);

    // Soil / bedrock side walls
    const sideMat = new THREE.MeshStandardMaterial({
        color: 0x7c6853, // Earth brown
        roughness: 0.9,
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
            const q = sidePos.length / 3;

            sidePos.push(
                Number(a[0]), topY, Number(a[1]),
                Number(a[0]), bedrockY, Number(a[1]),
                Number(b[0]), topY, Number(b[1]),
                Number(b[0]), bedrockY, Number(b[1])
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

    // Coastlines
    const coastlines = geometryData.coast || [];
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2, depthWrite: true });

    for (const seg of coastlines) {
        if (!seg || seg.length < 2) continue;
        const pts = [];
        for (const pt of seg) {
            pts.push(new THREE.Vector3(Number(pt[0]), topY + 0.5, Number(pt[1])));
        }
        const lineGeom = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(lineGeom, lineMat);
        line.renderOrder = 2;
        group.add(line);
    }

    return group;
}
