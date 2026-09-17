// SolvX Viewer — Procedural Seabed Vegetation & Rock Clustered Meshes
// NOTE: Procedural vegetation is strictly visual and decorative. It does NOT represent measured ecological distribution.
import * as THREE from 'three';

export function buildVegetation(bathymetry, sceneManager) {
    const group = new THREE.Group();
    const t = bathymetry.terrain;
    if (!t || !t.x || !t.y) return group;

    const nx = t.x.length;
    const ny = t.y.length;
    const shelfPoints = [];
    const deepPoints = [];

    // Sample seabed locations based on depth
    for (let j = 4; j < ny - 4; j += 3) {
        for (let i = 4; i < nx - 4; i += 3) {
            const rawDepth = Number((t.rawDepthKm[j] || [])[i]);
            if (!rawDepth || isNaN(rawDepth) || rawDepth <= 0.005) continue;

            const yPos = sceneManager.depthY(rawDepth * 1000);
            const pt = { x: t.y[j], y: yPos, z: t.x[i], depthM: rawDepth * 1000 };

            if (pt.depthM < 200) {
                shelfPoints.push(pt);
            } else if (pt.depthM < 1500) {
                deepPoints.push(pt);
            }
        }
    }

    // 1. Procedural Sea Grass Tuft Instances (Shallow Shelves)
    if (shelfPoints.length > 0) {
        const grassCount = Math.min(shelfPoints.length, 300);
        const grassGeom = new THREE.ConeGeometry(0.8, 4.0, 4);
        const grassMat = new THREE.MeshStandardMaterial({
            color: 0x228b22,
            roughness: 0.8,
            side: THREE.DoubleSide
        });
        const grassMesh = new THREE.InstancedMesh(grassGeom, grassMat, grassCount);
        const dummy = new THREE.Object3D();

        for (let k = 0; k < grassCount; k++) {
            const pt = shelfPoints[k % shelfPoints.length];
            const jitterX = (Math.sin(k * 13.7) * 2.0);
            const jitterZ = (Math.cos(k * 7.9) * 2.0);
            dummy.position.set(pt.x + jitterX, pt.y + 2.0, pt.z + jitterZ);
            dummy.scale.set(0.6 + Math.random() * 0.8, 0.7 + Math.random() * 1.0, 0.6 + Math.random() * 0.8);
            dummy.rotation.y = Math.random() * Math.PI * 2;
            dummy.updateMatrix();
            grassMesh.setMatrixAt(k, dummy.matrix);
        }
        grassMesh.instanceMatrix.needsUpdate = true;
        grassMesh.userData = { isDecorative: true, name: 'Seabed Grass' };
        group.add(grassMesh);
    }

    // 2. Underwater Rock Boulders (Medium Depths)
    if (deepPoints.length > 0) {
        const rockCount = Math.min(deepPoints.length, 180);
        const rockGeom = new THREE.DodecahedronGeometry(1.5, 0);
        const rockMat = new THREE.MeshStandardMaterial({
            color: 0x5c4d3c,
            roughness: 0.95
        });
        const rockMesh = new THREE.InstancedMesh(rockGeom, rockMat, rockCount);
        const dummy = new THREE.Object3D();

        for (let k = 0; k < rockCount; k++) {
            const pt = deepPoints[k % deepPoints.length];
            dummy.position.set(pt.x, pt.y + 0.8, pt.z);
            dummy.scale.set(0.8 + Math.random() * 1.5, 0.5 + Math.random() * 1.0, 0.8 + Math.random() * 1.5);
            dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
            dummy.updateMatrix();
            rockMesh.setMatrixAt(k, dummy.matrix);
        }
        rockMesh.instanceMatrix.needsUpdate = true;
        rockMesh.userData = { isDecorative: true, name: 'Seabed Rocks' };
        group.add(rockMesh);
    }

    return group;
}
