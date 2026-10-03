/**
 * Constructs and updates Three.js Data3DTexture from binary float32 NetCDF volume stream.
 * Converts to HalfFloatType for hardware-accelerated trilinear interpolation.
 */

import * as THREE from 'three';

export function createOceanVolumeTexture(arrayBuffer, meta, options = {}) {
    const verticalExaggeration = options.verticalExaggeration || 5.0;
    const [nz, ny, nx] = meta.shape; // [depthCount, latCount, lonCount]
    const srcFloats = new Float32Array(arrayBuffer);

    // Three.js Data3DTexture dimensions: (width=X, height=Y, depth=Z)
    // X = Longitude (nx)
    // Y = Vertical/Depth levels (nz)
    // Z = Latitude (ny)
    const width = nx;
    const height = nz;
    const depth = ny;
    const totalVoxels = width * height * depth;

    // Use Uint16Array with HalfFloatType for universal WebGL2 trilinear interpolation
    const textureBuffer = new Uint16Array(totalVoxels);

    // Reorder from NetCDF [depth, lat, lon] to 3D texture [Z_lat, Y_depth, X_lon]
    // where Y_depth=0 is deep seabed and Y_depth=height-1 is ocean surface.
    for (let texZ = 0; texZ < depth; texZ++) {       // Latitude index: south to north
        const latIdx = texZ;
        for (let texY = 0; texY < height; texY++) {  // Vertical index: bottom (0) to top (height-1)
            // Invert depth index so top (texY = height - 1) corresponds to NetCDF depth[0] (surface)
            const depthIdx = (height - 1) - texY;

            for (let texX = 0; texX < width; texX++) { // Longitude index: west to east
                const lonIdx = texX;

                // NetCDF contiguous index: depthIdx * (ny * nx) + latIdx * nx + lonIdx
                const srcIdx = depthIdx * (ny * nx) + latIdx * nx + lonIdx;
                // Texture index: texX + texY * width + texZ * (width * height);
                const dstIdx = texX + texY * width + texZ * (width * height);

                const val = srcFloats[srcIdx];
                textureBuffer[dstIdx] = THREE.DataUtils.toHalfFloat(val);
            }
        }
    }

    // Create Three.js 3D texture with HalfFloatType
    const texture = new THREE.Data3DTexture(textureBuffer, width, height, depth);
    texture.format = THREE.RedFormat;
    texture.type = THREE.HalfFloatType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    // Calculate world-space bounds and voxel size
    const bounds = meta.bounds;
    const midLon = (bounds.lon_min + bounds.lon_max) / 2.0;
    const midLat = (bounds.lat_min + bounds.lat_max) / 2.0;
    const klon = 111.32 * Math.cos((midLat * Math.PI) / 180.0);
    const klat = 111.32;

    const xMin = (bounds.lon_min - midLon) * klon;
    const xMax = (bounds.lon_max - midLon) * klon;
    const zMin = (bounds.lat_min - midLat) * klat;
    const zMax = (bounds.lat_max - midLat) * klat;

    // Depth in km * verticalExaggeration
    const maxDepthKm = bounds.depth_max / 1000.0;
    const minDepthKm = bounds.depth_min / 1000.0;
    const yMin = -maxDepthKm * verticalExaggeration;
    const yMax = -minDepthKm * verticalExaggeration; // surface is Y ~ 0

    const volumeOrigin = new THREE.Vector3(xMin, yMin, zMin);
    const volumeResolution = new THREE.Vector3(width, height, depth);
    const voxelSize = new THREE.Vector3(
        (xMax - xMin) / Math.max(width - 1, 1),
        (yMax - yMin) / Math.max(height - 1, 1),
        (zMax - zMin) / Math.max(depth - 1, 1)
    );

    return {
        texture,
        volumeOrigin,
        volumeResolution,
        voxelSize,
        worldBounds: {
            xMin, xMax,
            yMin, yMax,
            zMin, zMax,
        },
        geographicBounds: bounds,
        projection: { midLon, midLat, klon, klat },
        rawBuffer: srcFloats,
        shape: [nz, ny, nx],
        meta,
    };
}
