// SolvX Viewer — Coastline and Maritime Boundaries
import * as THREE from 'three';

export function buildCoastline(geography) {
    const group = new THREE.Group();
    const coastParts = [
        ...(geography.coast || []),
        ...(geography.landBoundary || []),
        ...(geography.islandCoast || [])
    ];

    if (coastParts.length) {
        const linePos = [];
        for (const line of coastParts) {
            for (let i = 0; i < line.length - 1; i++) {
                linePos.push(
                    Number(line[i][1]), 0.05, Number(line[i][0]),
                    Number(line[i + 1][1]), 0.05, Number(line[i + 1][0])
                );
            }
        }

        const coastGeom = new THREE.BufferGeometry();
        coastGeom.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
        const coastMat = new THREE.LineBasicMaterial({
            color: 0x18351d,
            linewidth: 2
        });
        group.add(new THREE.LineSegments(coastGeom, coastMat));
    }

    // EEZ Boundary Beads
    const beads = geography.eezBeads || [];
    if (beads.length) {
        const beadGeom = new THREE.BufferGeometry();
        const beadPos = [];
        for (const pt of beads) {
            beadPos.push(Number(pt[1]), 0.1, Number(pt[0]));
        }
        beadGeom.setAttribute('position', new THREE.Float32BufferAttribute(beadPos, 3));
        const beadMat = new THREE.PointsMaterial({
            color: 0xf59e0b,
            size: 2.2,
            transparent: true,
            opacity: 0.75
        });
        group.add(new THREE.Points(beadGeom, beadMat));
    }

    return group;
}
