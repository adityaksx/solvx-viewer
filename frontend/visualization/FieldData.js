// SolvX Viewer — Generic Volumetric Field Data Normalization
// Converts backend 3D ocean/atmosphere fields into normalized GPU-ready representations.

export class FieldData {
    constructor({
        variable = '',
        domain = 'ocean',
        units = '',
        values = null,
        width = 0,
        height = 0,
        depth = 0,
        latitude = [],
        longitude = [],
        levels = [],
        levelType = 'depth',
        min = 0,
        max = 1,
        time = null,
        metadata = {}
    } = {}) {
        this.variable = variable;
        this.domain = domain;
        this.units = units;
        this.values = values; // Float32Array (normalized 0.0 - 1.0, missing = -1.0)
        this.width = width;   // Longitude count (Nx)
        this.height = height; // Latitude count (Ny)
        this.depth = depth;   // Level count (Nz)
        this.latitude = latitude;
        this.longitude = longitude;
        this.levels = levels;
        this.levelType = levelType;
        this.min = min;
        this.max = max;
        this.time = time;
        this.metadata = metadata;
    }

    /**
     * Converts a backend /api/ocean/volume response into a normalized FieldData instance.
     * Backend order: values[depth][latitude][longitude] -> flattened to Float32Array.
     * Missing/land values are explicitly encoded as -1.0 (never converted to 0.0).
     */
    static fromVolumeResponse(data) {
        if (!data || !data.values || !Array.isArray(data.values)) {
            throw new Error('[FieldData] Invalid volume response: missing values array');
        }

        const levels = data.levels || [];
        const latitude = data.latitude || [];
        const longitude = data.longitude || [];

        const depth = levels.length;
        const height = latitude.length;
        const width = longitude.length;

        if (depth === 0 || height === 0 || width === 0) {
            throw new Error(`[FieldData] Invalid dimensions: depth=${depth}, height=${height}, width=${width}`);
        }

        const min = data.min_value != null ? Number(data.min_value) : 0.0;
        const max = data.max_value != null ? Number(data.max_value) : 1.0;
        const range = (max - min) !== 0 ? (max - min) : 1.0;

        const totalVoxels = width * height * depth;
        const buffer = new Float32Array(totalVoxels);

        let validCount = 0;
        let missingCount = 0;
        let idx = 0;

        for (let z = 0; z < depth; z++) {
            const levelData = data.values[z];
            for (let y = 0; y < height; y++) {
                const rowData = levelData ? levelData[y] : null;
                for (let x = 0; x < width; x++) {
                    const val = rowData ? rowData[x] : null;
                    if (val == null || !Number.isFinite(val)) {
                        buffer[idx] = -1.0; // Sentinel for missing/land voxels
                        missingCount++;
                    } else {
                        const norm = (Number(val) - min) / range;
                        buffer[idx] = Math.max(0.0, Math.min(1.0, norm));
                        validCount++;
                    }
                    idx++;
                }
            }
        }

        const field = new FieldData({
            variable: data.variable || 'unknown',
            domain: data.domain || 'ocean',
            units: data.units || '',
            values: buffer,
            width,
            height,
            depth,
            latitude,
            longitude,
            levels,
            levelType: data.level_type || 'depth',
            min,
            max,
            time: data.time,
            metadata: {
                ...data.metadata,
                totalVoxels,
                validCount,
                missingCount
            }
        });

        // Small validation check
        field.validateSamples(data.values);

        return field;
    }

    /**
     * Diagnostic validation verifying voxel integrity between original backend array and flattened buffer.
     */
    validateSamples(originalNested) {
        if (!originalNested) return;
        const samplesToCheck = [
            [0, 0, 0],
            [Math.floor(this.depth / 2), Math.floor(this.height / 2), Math.floor(this.width / 2)],
            [this.depth - 1, this.height - 1, this.width - 1]
        ];

        const range = (this.max - this.min) || 1.0;
        for (const [z, y, x] of samplesToCheck) {
            if (z >= this.depth || y >= this.height || x >= this.width) continue;
            const originalVal = originalNested[z]?.[y]?.[x];
            const bufferIdx = (z * this.height + y) * this.width + x;
            const bufferVal = this.values[bufferIdx];

            if (originalVal == null || !Number.isFinite(originalVal)) {
                if (bufferVal !== -1.0) {
                    console.warn(`[FieldData] Validation mismatch at (${z},${y},${x}): expected -1.0 for null, got ${bufferVal}`);
                }
            } else {
                const expectedNorm = Math.max(0.0, Math.min(1.0, (originalVal - this.min) / range));
                if (Math.abs(bufferVal - expectedNorm) > 1e-4) {
                    console.warn(`[FieldData] Validation mismatch at (${z},${y},${x}): orig=${originalVal}, expectedNorm=${expectedNorm}, got=${bufferVal}`);
                }
            }
        }
    }

    /**
     * Samples the unnormalized scientific value at given discrete indices.
     */
    getScientificValue(z, y, x) {
        if (z < 0 || z >= this.depth || y < 0 || y >= this.height || x < 0 || x >= this.width) return null;
        const idx = (z * this.height + y) * this.width + x;
        const norm = this.values[idx];
        if (norm < -0.1) return null; // Missing
        return this.min + norm * (this.max - this.min);
    }

    /**
     * Generates a synthetic test field for verifying 3D coordinate orientation and gradient direction.
     * @param {'depth' | 'longitude' | 'latitude'} gradientAxis
     * @param {Object} template
     */
    static createSyntheticField(gradientAxis = 'depth', template = null) {
        const depth = template?.levels?.length || 32;
        const height = template?.latitude?.length || 90;
        const width = template?.longitude?.length || 106;

        const levels = template?.levels || Array.from({ length: depth }, (_, i) => i * 15);
        const latitude = template?.latitude || Array.from({ length: height }, (_, i) => 16.0 + i * (7.5 / height));
        const longitude = template?.longitude || Array.from({ length: width }, (_, i) => 84.0 + i * (9.0 / width));

        const totalVoxels = width * height * depth;
        const buffer = new Float32Array(totalVoxels);

        let idx = 0;
        for (let z = 0; z < depth; z++) {
            const zFrac = depth > 1 ? z / (depth - 1) : 0;
            for (let y = 0; y < height; y++) {
                const yFrac = height > 1 ? y / (height - 1) : 0;
                for (let x = 0; x < width; x++) {
                    const xFrac = width > 1 ? x / (width - 1) : 0;

                    let normVal = 0.0;
                    if (gradientAxis === 'depth') {
                        // Depth gradient: z=0 (surface) -> 0.0 (blue), z=max (deep) -> 1.0 (red)
                        normVal = zFrac;
                    } else if (gradientAxis === 'longitude' || gradientAxis === 'lon') {
                        // Longitude gradient: x=0 (west) -> 0.0 (blue), x=max (east) -> 1.0 (red)
                        normVal = xFrac;
                    } else if (gradientAxis === 'latitude' || gradientAxis === 'lat') {
                        // Latitude gradient: y=0 (south) -> 0.0 (blue), y=max (north) -> 1.0 (red)
                        normVal = yFrac;
                    }

                    buffer[idx++] = normVal;
                }
            }
        }

        return new FieldData({
            variable: 'temperature',
            domain: 'ocean',
            units: 'norm',
            values: buffer,
            width,
            height,
            depth,
            latitude,
            longitude,
            levels,
            levelType: 'depth',
            min: 0.0,
            max: 1.0,
            metadata: {
                isSynthetic: true,
                syntheticType: gradientAxis
            }
        });
    }
}

