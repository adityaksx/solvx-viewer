// SolvX Viewer — 3D Bathymetric Seabed Mesh Generator
import * as THREE from 'three';

export function buildSeabed(bathymetry, sceneManager) {
    const t = bathymetry.terrain;
    if (!t || !t.x || !t.y) return null;

    const nx = t.x.length;
    const ny = t.y.length;
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

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.setIndex(index);
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
        color: 0xd2ae80,
        roughness: 0.95,
        metalness: 0.05,
        side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    return mesh;
}
