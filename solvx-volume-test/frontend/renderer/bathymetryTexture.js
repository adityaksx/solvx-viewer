/**
 * Constructs 2D GPU DataTexture (HalfFloatType, RedFormat) from GEBCO Bathymetric Terrain.
 * Used for authoritative ray-marching volume clipping in VolumeRenderer.js.
 */

import * as THREE from 'three';

export function createBathymetryTexture(bathymetryData) {
    const terrain = bathymetryData?.terrain;
    if (!terrain || !terrain.rawDepthKm) {
        return null;
    }

    const nx = terrain.x?.length || 305;
    const ny = terrain.y?.length || 256;
    const bounds = bathymetryData.bounds || [84.104976, 92.992988, 16.070728, 23.524364];

    // Store physical seabed depth in meters using 16-bit half floats
    const buffer = new Uint16Array(nx * ny);

    for (let j = 0; j < ny; j++) {
        const row = terrain.rawDepthKm[j] || [];
        for (let i = 0; i < nx; i++) {
            const rawKm = row[i];
            // Depths <= 20m or NaN are considered land (stored as 0.0)
            const depthM = (rawKm != null && !isNaN(rawKm) && rawKm > 0.02) ? rawKm * 1000.0 : 0.0;
            buffer[j * nx + i] = THREE.DataUtils.toHalfFloat(depthM);
        }
    }

    const texture = new THREE.DataTexture(buffer, nx, ny, THREE.RedFormat, THREE.HalfFloatType);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    return {
        texture,
        bounds,
        nx,
        ny
    };
}
