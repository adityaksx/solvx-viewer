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
    return group;
}

export function buildEEZ(geography, eezData = null) {
    const group = new THREE.Group();

    // 1. Real Marine Regions / VLIZ v12 3D Line Segments
    const lines3d = eezData?.lines3d || [];
    if (lines3d.length) {
        const linePos = [];
        for (const line of lines3d) {
            for (let i = 0; i < line.length - 1; i++) {
                linePos.push(
                    Number(line[i][1]), 0.1, Number(line[i][0]),
                    Number(line[i + 1][1]), 0.1, Number(line[i + 1][0])
                );
            }
        }
        if (linePos.length) {
            const eezLineGeom = new THREE.BufferGeometry();
            eezLineGeom.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
            const eezLineMat = new THREE.LineBasicMaterial({
                color: 0xffb703,
                linewidth: 2,
                transparent: true,
                opacity: 0.85
            });
            group.add(new THREE.LineSegments(eezLineGeom, eezLineMat));
        }
    }

    // 2. Maritime EEZ Boundary Beads
    const beads = geography?.eezBeads || [];
    if (beads.length) {
        const beadGeom = new THREE.BufferGeometry();
        const beadPos = [];
        for (const pt of beads) {
            beadPos.push(Number(pt[1]), 0.12, Number(pt[0]));
        }
        beadGeom.setAttribute('position', new THREE.Float32BufferAttribute(beadPos, 3));
        const beadMat = new THREE.PointsMaterial({
            color: 0xf59e0b,
            size: 2.2,
            transparent: true,
            opacity: 0.8
        });
        group.add(new THREE.Points(beadGeom, beadMat));
    }

    return group;
}
