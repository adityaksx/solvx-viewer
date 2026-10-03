// SolvX Viewer — Normalized 3D Ocean Variable Dataset Abstraction
// Canonical Data Contract (Sections 8 & 9):
// CPU layout: values3D[depthIndex][latIndex][lonIndex]
// GPU texture layout: X = longitude, Y = latitude, Z = depth index
// Flattening index: lonIndex + latIndex * lonCount + depthIndex * lonCount * latCount

import * as THREE from 'three';

/**
 * Finds bracket depth indices and interpolation fraction for non-uniform vertical levels.
 */
export function depthToIndices(depthLevels, targetDepth) {
    if (!depthLevels || !depthLevels.length) {
        return { k0: 0, k1: 0, alpha: 0 };
    }
    const n = depthLevels.length;
    if (targetDepth <= depthLevels[0]) {
        return { k0: 0, k1: 0, alpha: 0 };
    }
    if (targetDepth >= depthLevels[n - 1]) {
        return { k0: n - 1, k1: n - 1, alpha: 0 };
    }
    let k = 0;
    while (k < n - 1 && depthLevels[k + 1] < targetDepth) {
        k++;
    }
    const z0 = depthLevels[k];
    const z1 = depthLevels[k + 1];
    const alpha = Math.max(0, Math.min(1, (targetDepth - z0) / Math.max(z1 - z0, 1e-6)));
    return { k0: k, k1: k + 1, alpha };
}

export class OceanVariableDataset {
    constructor({
        variable = 'thetao',
        values3D = null,
        depthLevels = [],
        latitudes = [],
        longitudes = [],
        time = null,
        units = '',
        min = null,
        max = null,
        missingValue = -999.0,
        metadata = {}
    } = {}) {
        this.variable = variable;
        this.values3D = values3D;
        this.depthLevels = depthLevels ? Array.from(depthLevels).map(Number) : [];
        this.latitudes = latitudes ? Array.from(latitudes).map(Number) : [];
        this.longitudes = longitudes ? Array.from(longitudes).map(Number) : [];
        this.time = time;
        this.units = units;
        this.missingValue = missingValue;
        this.metadata = metadata;

        const dCount = values3D?.length || depthLevels?.length || 0;
        const latCount = values3D?.[0]?.length || latitudes?.length || 0;
        const lonCount = values3D?.[0]?.[0]?.length || longitudes?.length || 0;

        this.dimensions = {
            depth: dCount,
            latitude: latCount,
            longitude: lonCount
        };

        this.min = min;
        this.max = max;
        this._stats = null;
        this._flatBuffer = null;

        if (this.values3D) {
            this.validate();
            this.getStats();
        }
    }

    get levels() {
        return this.depthLevels;
    }

    get depth() {
        return this.dimensions.depth;
    }

    get height() {
        return this.dimensions.latitude;
    }

    get width() {
        return this.dimensions.longitude;
    }

    get values() {
        if (!this._flatBuffer) {
            this._flatBuffer = this.flatten().buffer;
        }
        return this._flatBuffer;
    }

    getScientificValue(depthIdx, yIdx, xIdx) {
        if (!this.values3D || depthIdx < 0 || depthIdx >= this.dimensions.depth) return null;
        const v = this.values3D[depthIdx]?.[yIdx]?.[xIdx];
        if (v == null || !Number.isFinite(v) || v <= -900) return null;
        return Number(v);
    }

    /**
     * Factory constructor normalizing backend API responses into canonical OceanVariableDataset.
     * Supports both /api/data/ocean and /api/ocean/volume formats.
     */
    static fromApiResponse(data) {
        if (!data) {
            throw new Error('[OceanVariableDataset] Cannot build dataset from null or undefined response');
        }

        const values = data.values;
        if (!values || !Array.isArray(values) || !values.length) {
            throw new Error('[OceanVariableDataset] Invalid response: values array missing or empty');
        }

        const is3D = Array.isArray(values[0]) && Array.isArray(values[0][0]);
        if (!is3D) {
            throw new Error('[OceanVariableDataset] Response is 2D, expected full 3D array [depth][lat][lon]');
        }

        const depthLevels = data.depth_levels || data.levels || data.metadata?.depth_levels || [];
        const latitudes = data.latitude || data.lats || [];
        const longitudes = data.longitude || data.lons || [];

        return new OceanVariableDataset({
            variable: data.variable || 'ocean_temperature',
            values3D: values,
            depthLevels,
            latitudes,
            longitudes,
            time: data.time || null,
            units: data.units || (data.variable === 'salinity' ? 'PSU' : '°C'),
            min: data.min_value != null ? Number(data.min_value) : null,
            max: data.max_value != null ? Number(data.max_value) : null,
            metadata: data.metadata || {}
        });
    }

    /**
     * Validates data integrity against the canonical layout.
     */
    validate() {
        if (!this.values3D || !Array.isArray(this.values3D)) {
            throw new Error('[OceanVariableDataset] values3D must be an array');
        }

        const nz = this.values3D.length;
        if (nz === 0) throw new Error('[OceanVariableDataset] values3D depth dimension is empty');

        const ny = this.values3D[0]?.length || 0;
        if (ny === 0) throw new Error('[OceanVariableDataset] values3D latitude dimension is empty');

        const nx = this.values3D[0]?.[0]?.length || 0;
        if (nx === 0) throw new Error('[OceanVariableDataset] values3D longitude dimension is empty');

        this.dimensions = { depth: nz, latitude: ny, longitude: nx };

        if (this.depthLevels.length && this.depthLevels.length !== nz) {
            console.warn(`[OceanVariableDataset] Depth level count (${this.depthLevels.length}) does not match Z-dimension (${nz})`);
        }
        if (this.latitudes.length && this.latitudes.length !== ny) {
            console.warn(`[OceanVariableDataset] Latitude count (${this.latitudes.length}) does not match Y-dimension (${ny})`);
        }
        if (this.longitudes.length && this.longitudes.length !== nx) {
            console.warn(`[OceanVariableDataset] Longitude count (${this.longitudes.length}) does not match X-dimension (${nx})`);
        }

        return true;
    }

    /**
     * Calculates and logs dataset statistics (Section 11).
     */
    getStats() {
        if (this._stats) return this._stats;

        const { depth: nz, latitude: ny, longitude: nx } = this.dimensions;
        let validCount = 0;
        let missingCount = 0;
        let sum = 0;
        let minVal = Infinity;
        let maxVal = -Infinity;

        for (let z = 0; z < nz; z++) {
            const zLayer = this.values3D[z];
            for (let y = 0; y < ny; y++) {
                const yRow = zLayer ? zLayer[y] : null;
                for (let x = 0; x < nx; x++) {
                    const v = yRow ? yRow[x] : null;
                    if (v == null || !Number.isFinite(v) || v <= -900) {
                        missingCount++;
                    } else {
                        const num = Number(v);
                        validCount++;
                        sum += num;
                        if (num < minVal) minVal = num;
                        if (num > maxVal) maxVal = num;
                    }
                }
            }
        }

        const depthMin = this.depthLevels.length ? this.depthLevels[0] : 0;
        const depthMax = this.depthLevels.length ? this.depthLevels[this.depthLevels.length - 1] : 0;

        if (this.min == null && Number.isFinite(minVal)) this.min = minVal;
        if (this.max == null && Number.isFinite(maxVal)) this.max = maxVal;

        const mean = validCount > 0 ? sum / validCount : 0;

        this._stats = {
            variable: this.variable,
            shape: [nz, ny, nx],
            depthCount: nz,
            latCount: ny,
            lonCount: nx,
            depthMin,
            depthMax,
            validCount,
            missingCount,
            scalarMin: Number.isFinite(minVal) ? minVal : this.min,
            scalarMax: Number.isFinite(maxVal) ? maxVal : this.max,
            mean
        };

        console.group(`[OceanVariableDataset] Validated 3D Field: ${this.variable}`);
        console.log(`Shape: [${nz} depth × ${ny} lat × ${nx} lon] (${(nz * ny * nx).toLocaleString()} voxels)`);
        console.log(`Depth range: ${depthMin.toFixed(2)}m to ${depthMax.toFixed(2)}m`);
        console.log(`Valid voxels: ${validCount.toLocaleString()}, Missing: ${missingCount.toLocaleString()}`);
        console.log(`Scalar range: [${this._stats.scalarMin?.toFixed(2)}, ${this._stats.scalarMax?.toFixed(2)}] ${this.units}, Mean: ${mean.toFixed(2)} ${this.units}`);
        console.groupEnd();

        return this._stats;
    }

    /**
     * CPU reference sampler for arbitrary physical depth (Section 15 & 16).
     * Brackets targetDepth across non-uniform depth levels and interpolates.
     */
    sampleDepth(latIndex, lonIndex, depthM) {
        if (!this.values3D || !this.depthLevels.length) return null;
        const { k0, k1, alpha } = depthToIndices(this.depthLevels, depthM);

        const v0 = this.values3D[k0]?.[latIndex]?.[lonIndex];
        const v1 = this.values3D[k1]?.[latIndex]?.[lonIndex];

        const hasV0 = (v0 != null && Number.isFinite(v0) && v0 > -900);
        const hasV1 = (v1 != null && Number.isFinite(v1) && v1 > -900);

        if (!hasV0 && !hasV1) return null;
        if (!hasV0) return v1;
        if (!hasV1) return v0;
        return (1.0 - alpha) * v0 + alpha * v1;
    }

    /**
     * Flattens 3D array into Float32Array following canonical GPU texture layout (Section 9):
     * index = lonIndex + latIndex * lonCount + depthIndex * lonCount * latCount
     */
    flatten() {
        const { depth: nz, latitude: ny, longitude: nx } = this.dimensions;
        const total = nx * ny * nz;
        const buffer = new Float32Array(total);
        const sentinel = this.missingValue;

        for (let z = 0; z < nz; z++) {
            const zLayer = this.values3D[z];
            const zOffset = z * nx * ny;
            for (let y = 0; y < ny; y++) {
                const yRow = zLayer ? zLayer[y] : null;
                const yOffset = zOffset + y * nx;
                for (let x = 0; x < nx; x++) {
                    const v = yRow ? yRow[x] : null;
                    buffer[yOffset + x] = (v != null && Number.isFinite(v) && v > -900) ? Number(v) : sentinel;
                }
            }
        }

        return {
            buffer,
            width: nx,   // Longitude (X)
            height: ny,  // Latitude (Y)
            depth: nz    // Depth index (Z)
        };
    }

    /**
     * Builds and configures a WebGL2 THREE.Data3DTexture (Section 13).
     */
    createTexture() {
        const { buffer, width, height, depth } = this.flatten();

        const texture = new THREE.Data3DTexture(buffer, width, height, depth);
        texture.format = THREE.RedFormat;
        texture.type = THREE.FloatType;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.wrapR = THREE.ClampToEdgeWrapping;
        texture.generateMipmaps = false;
        texture.unpackAlignment = 1;
        texture.needsUpdate = true;

        return texture;
    }
}
