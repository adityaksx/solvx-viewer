// SolvX Viewer — True 3D Ocean Variable Volumetric Ray-Marching Renderer
import * as THREE from 'three';
import { sampleColor } from '../visualization/colorScale.js';
import { OceanVariableDataset } from '../visualization/OceanVariableDataset.js';

/**
 * Flattens a 3D array of shape [depthCount][latCount][lonCount] into a Float32Array
 * suitable for THREE.Data3DTexture.
 * Index layout: idx = x + y * width + z * width * height
 * where x = lon index, y = lat index, z = depth index.
 */
export function flatten3DField(values3D, options = {}) {
    if (!values3D || !values3D.length || !values3D[0] || !values3D[0].length || !values3D[0][0]) {
        return null;
    }
    const depthCount = values3D.length;       // z: depth levels (e.g. 32)
    const latCount = values3D[0].length;      // y: latitude (e.g. 90)
    const lonCount = values3D[0][0].length;   // x: longitude (e.g. 106)
    const total = lonCount * latCount * depthCount;
    const buffer = new Float32Array(total);
    const sentinel = options.sentinel !== undefined ? options.sentinel : -999.0;

    for (let z = 0; z < depthCount; z++) {
        const zLayer = values3D[z];
        const zOffset = z * lonCount * latCount;
        for (let y = 0; y < latCount; y++) {
            const yRow = zLayer ? zLayer[y] : null;
            const yOffset = zOffset + y * lonCount;
            for (let x = 0; x < lonCount; x++) {
                const v = yRow ? yRow[x] : null;
                buffer[yOffset + x] = (v != null && Number.isFinite(v)) ? Number(v) : sentinel;
            }
        }
    }

    return {
        buffer,
        width: lonCount,
        height: latCount,
        depth: depthCount
    };
}

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

/**
 * Normalizes a scalar value to [0, 1] range given min/max bounds.
 */
export function normalizeScalar(val, lo, hi) {
    if (val == null || !Number.isFinite(val)) return 0;
    const range = Math.max(hi - lo, 1e-6);
    return Math.max(0, Math.min(1, (val - lo) / range));
}

/**
 * CPU Reference Sampler for 3D scalar field at arbitrary physical depth (Section 19).
 * Locates the non-uniform depth bracket, computes interpolation fraction alpha,
 * and samples between layers k and k+1.
 */
export function sampleFieldAtDepth(values3D, depthLevels, latIndex, lonIndex, targetDepth) {
    if (!values3D || !values3D.length || !depthLevels || !depthLevels.length) {
        return null;
    }
    const { k0, k1, alpha } = depthToIndices(depthLevels, targetDepth);
    const v0 = values3D[k0]?.[latIndex]?.[lonIndex];
    const v1 = values3D[k1]?.[latIndex]?.[lonIndex];

    const hasV0 = (v0 != null && Number.isFinite(v0) && v0 > -900);
    const hasV1 = (v1 != null && Number.isFinite(v1) && v1 > -900);

    if (!hasV0 && !hasV1) return null;
    if (!hasV0) return v1;
    if (!hasV1) return v0;
    return (1.0 - alpha) * v0 + alpha * v1;
}

/**
 * Builds a 256x1 DataTexture for GLSL colormap sampling.
 */
function buildColorMapTexture(variable, lo, hi) {
    const width = 256;
    const data = new Uint8Array(width * 4);
    for (let i = 0; i < width; i++) {
        const t = i / (width - 1);
        const val = lo + t * (hi - lo);
        const c = sampleColor(variable, val, lo, hi);
        data[i * 4 + 0] = Math.round(c.r * 255);
        data[i * 4 + 1] = Math.round(c.g * 255);
        data[i * 4 + 2] = Math.round(c.b * 255);
        data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
}

/**
 * Builds a 256x1 DataTexture for decoupled scalar-to-opacity transfer function (Section 24 & 25).
 * Generates density profile for step-size-aware physical accumulation.
 */
export function buildOpacityMapTexture(transferLow = 0.0, transferHigh = 1.0) {
    const width = 256;
    const data = new Uint8Array(width * 4);
    const lo = Math.max(0.0, Math.min(1.0, transferLow));
    const hi = Math.max(lo + 1e-4, Math.min(1.0, transferHigh));

    for (let i = 0; i < width; i++) {
        const t = i / (width - 1);
        let s = (t - lo) / (hi - lo);
        s = Math.max(0.0, Math.min(1.0, s));
        const smoothS = s * s * (3.0 - 2.0 * s);
        // Base density 0.15 + 0.85 * smoothS across the scalar range
        let density = 0.15 + 0.85 * smoothS;
        if (lo > 0.01 && t < lo) {
            density = 0.15 * Math.max(0.0, t / lo);
        }
        const byteVal = Math.round(Math.max(0, Math.min(1, density)) * 255);
        data[i * 4 + 0] = byteVal;
        data[i * 4 + 1] = byteVal;
        data[i * 4 + 2] = byteVal;
        data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
}

/**
 * Geographic <-> Scene World coordinate conversion helpers (Phase 7).
 * In SolvX:
 * - Three.js X = Northing (Latitude direction, km)
 * - Three.js Z = Easting (Longitude direction, km)
 * - Three.js Y = Height / Depth
 */
export function worldToLongitude(worldZ, bounds = [84.167, 92.917, 16.083, 23.500]) {
    if (!bounds || bounds.length < 4) return 88.5;
    const [minLon, maxLon, minLat, maxLat] = bounds;
    const midLon = (minLon + maxLon) / 2.0;
    const midLat = (minLat + maxLat) / 2.0;
    const klon = 111.32 * Math.cos((midLat * Math.PI) / 180.0);
    return midLon + worldZ / (klon || 1.0);
}

export function worldToLatitude(worldX, bounds = [84.167, 92.917, 16.083, 23.500]) {
    if (!bounds || bounds.length < 4) return 19.8;
    const [minLon, maxLon, minLat, maxLat] = bounds;
    const midLat = (minLat + maxLat) / 2.0;
    const klat = 111.32;
    return midLat + worldX / klat;
}

export function longitudeToWorldZ(lon, bounds = [84.167, 92.917, 16.083, 23.500]) {
    if (!bounds || bounds.length < 4) return 0;
    const [minLon, maxLon, minLat, maxLat] = bounds;
    const midLon = (minLon + maxLon) / 2.0;
    const midLat = (minLat + maxLat) / 2.0;
    const klon = 111.32 * Math.cos((midLat * Math.PI) / 180.0);
    return (lon - midLon) * klon;
}

export function latitudeToWorldX(lat, bounds = [84.167, 92.917, 16.083, 23.500]) {
    if (!bounds || bounds.length < 4) return 0;
    const [minLon, maxLon, minLat, maxLat] = bounds;
    const midLat = (minLat + maxLat) / 2.0;
    const klat = 111.32;
    return (lat - midLat) * klat;
}

// Coordinate aliases
export function longitudeToWorldX(lon, bounds) {
    return longitudeToWorldZ(lon, bounds);
}

export function latitudeToWorldZ(lat, bounds) {
    return latitudeToWorldX(lat, bounds);
}

export class OceanVolumeRenderer {
    constructor(bathymetry, sceneManager, options = {}) {
        this.bathymetry = bathymetry;
        this.sceneManager = sceneManager;
        this.options = options;

        this.maxDepthM = 541.089; // Default max depth of 4D model
        this.clipMaxDepthM = options.clipMaxDepthM != null ? options.clipMaxDepthM : this.maxDepthM;
        this.opacity = options.opacity != null ? options.opacity : 0.55;
        this.baseAlpha = options.baseAlpha != null ? options.baseAlpha : 0.035;
        this.opacityScale = options.opacityScale != null ? options.opacityScale : 1.0;
        this.transferLow = options.transferLow != null ? options.transferLow : 0.0;
        this.transferHigh = options.transferHigh != null ? options.transferHigh : 1.0;
        this.variable = 'ocean_temperature';
        this.valLo = 9.0;
        this.valHi = 31.0;

        this.scalarBounds = options.scalarBounds || [84.167, 92.917, 16.083, 23.500];
        this.bathyBounds = options.bathyBounds || (bathymetry?.bounds ? [...bathymetry.bounds] : [84.167, 92.917, 16.083, 23.500]);

        this.data3DTexture = null;
        this.colorMapTexture = null;
        this.opacityMapTexture = null;
        this.bathyTex = options.bathyTex || null;
        this.lastValues3D = null;
        this.dataset = null;

        // Default 32 depth levels matching INCOIS/NEMO 4D model
        this.depthLevels = [
            0.494025, 1.541375, 2.645669, 3.819495, 5.078224, 6.440614, 7.92956, 9.572997,
            11.405, 13.46768, 15.81032, 18.49528, 21.59882, 25.21141, 29.44473, 34.43476,
            40.34405, 47.37369, 55.76429, 65.80727, 77.85385, 92.32607, 109.7293, 130.666,
            155.8507, 186.1256, 222.4752, 266.0403, 318.1274, 380.213, 453.9377, 541.0889
        ];

        this.initMaterial();
        this.initMesh();
    }

    initMaterial() {
        const depthUniformArray = new Float32Array(32);
        for (let i = 0; i < 32; i++) {
            depthUniformArray[i] = this.depthLevels[i] || 0.0;
        }

        this.colorMapTexture = buildColorMapTexture(this.variable, this.valLo, this.valHi);
        this.opacityMapTexture = buildOpacityMapTexture(this.transferLow, this.transferHigh);

        this.material = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            uniforms: {
                uInverseModelMatrix: { value: new THREE.Matrix4() },
                uData3D: { value: null },
                uHasData3D: { value: false },
                uColorMap: { value: this.colorMapTexture },
                uOpacityMap: { value: this.opacityMapTexture },
                uOpacityScale: { value: this.opacityScale },
                uBathyTex: { value: this.bathyTex },
                uHasBathyTex: { value: this.bathyTex ? true : false },
                uScalarBounds: { value: new THREE.Vector4(this.scalarBounds[0], this.scalarBounds[1], this.scalarBounds[2], this.scalarBounds[3]) },
                uBathyBounds: { value: new THREE.Vector4(this.bathyBounds[0], this.bathyBounds[1], this.bathyBounds[2], this.bathyBounds[3]) },
                uDepthLevels: { value: depthUniformArray },
                uDepthCount: { value: 32 },
                uMaxDepthM: { value: this.maxDepthM },
                uClipMaxDepthM: { value: this.clipMaxDepthM },
                u_clipMaxDepthFrac: { value: 1.0 },
                uValLo: { value: this.valLo },
                uValHi: { value: this.valHi },
                uGlobalOpacity: { value: this.opacity },
                uBaseAlpha: { value: this.baseAlpha },
                uTransferLow: { value: this.transferLow },
                uTransferHigh: { value: this.transferHigh },
                uDebugMode: { value: 0 },
                uDebugSliceDepthM: { value: 0.49 }
            },
            vertexShader: `
                out vec3 vLocalPos;

                void main() {
                    vLocalPos = position; // Unit box [-0.5, 0.5]^3
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                precision highp sampler3D;
                precision highp sampler2D;

                in vec3 vLocalPos;

                out vec4 fragColor;

                uniform mat4 uInverseModelMatrix;
                uniform sampler3D uData3D;
                uniform bool uHasData3D;
                uniform sampler2D uColorMap;
                uniform sampler2D uOpacityMap;
                uniform float uOpacityScale;
                uniform sampler2D uBathyTex;
                uniform bool uHasBathyTex;

                uniform vec4 uScalarBounds;
                uniform vec4 uBathyBounds;

                uniform float uDepthLevels[32];
                uniform int uDepthCount;
                uniform float uMaxDepthM;
                uniform float uClipMaxDepthM;
                uniform float u_clipMaxDepthFrac;
                uniform float uValLo;
                uniform float uValHi;
                uniform float uGlobalOpacity;
                uniform float uBaseAlpha;
                uniform float uTransferLow;
                uniform float uTransferHigh;
                uniform int uDebugMode;
                uniform float uDebugSliceDepthM;

                // Ray-AABB intersection on unit box [-0.5, 0.5]^3
                bool intersectBox(vec3 ro, vec3 rd, out float tEnter, out float tExit) {
                    vec3 invR = 1.0 / rd;
                    vec3 tbot = invR * (vec3(-0.5) - ro);
                    vec3 ttop = invR * (vec3(0.5) - ro);
                    vec3 tmin = min(ttop, tbot);
                    vec3 tmax = max(ttop, tbot);
                    float t0 = max(max(tmin.x, tmin.y), tmin.z);
                    float t1 = min(min(tmax.x, tmax.y), tmax.z);

                    if (t0 > t1 || t1 < 0.0) return false;
                    tEnter = max(t0, 0.0);
                    tExit = t1;
                    return true;
                }

                vec2 getBathyUv(float normLon, float normLat) {
                    if (uBathyBounds.y > uBathyBounds.x && uScalarBounds.y > uScalarBounds.x) {
                        float lon = mix(uScalarBounds.x, uScalarBounds.y, normLon);
                        float lat = mix(uScalarBounds.z, uScalarBounds.w, normLat);
                        float u = clamp((lon - uBathyBounds.x) / (uBathyBounds.y - uBathyBounds.x), 0.0, 1.0);
                        float v = clamp((lat - uBathyBounds.z) / (uBathyBounds.w - uBathyBounds.z), 0.0, 1.0);
                        return vec2(u, v);
                    }
                    return vec2(normLon, normLat);
                }

                void main() {
                    if (!uHasData3D || uGlobalOpacity <= 0.0001) {
                        discard;
                    }

                    // Compute object-space ray using CPU-provided inverse model matrix
                    vec3 ro = (uInverseModelMatrix * vec4(cameraPosition, 1.0)).xyz;
                    vec3 rd = normalize(vLocalPos - ro);

                    float tEnter, tExit;
                    if (!intersectBox(ro, rd, tEnter, tExit)) {
                        discard;
                    }

                    float totalDist = tExit - tEnter;
                    if (totalDist <= 0.0001) {
                        discard;
                    }

                    // ================= DEBUG MODE 5: FIXED PHYSICAL DEPTH SLICE =================
                    // Analytical ray-plane intersection directly at requested physical depth (Section 6 & 18)
                    if (uDebugMode == 5) {
                        float targetDepth = clamp(uDebugSliceDepthM, 0.0, uMaxDepthM);
                        if (targetDepth > uClipMaxDepthM) {
                            discard;
                        }
                        float yTarget = 0.5 - (targetDepth / max(uMaxDepthM, 1.0));

                        if (abs(rd.y) > 1e-6) {
                            float tSlice = (yTarget - ro.y) / rd.y;
                            if (tSlice >= tEnter && tSlice <= tExit) {
                                vec3 pSlice = ro + rd * tSlice;
                                float normLat = clamp(pSlice.x + 0.5, 0.0, 1.0);
                                float normLon = clamp(pSlice.z + 0.5, 0.0, 1.0);

                                if (uHasBathyTex) {
                                    vec2 bathyUv = getBathyUv(normLon, normLat);
                                    float seabedM = texture(uBathyTex, bathyUv).r * 6000.0;
                                    if (seabedM < 0.5 || targetDepth > seabedM) {
                                        discard;
                                    }
                                }

                                int k = 0;
                                for (int i = 0; i < 31; i++) {
                                    if (i < uDepthCount - 1 && uDepthLevels[i + 1] < targetDepth) {
                                        k = i + 1;
                                    }
                                }
                                int kNext = min(k + 1, uDepthCount - 1);
                                float z0 = uDepthLevels[k];
                                float z1 = uDepthLevels[kNext];
                                float alpha = clamp((targetDepth - z0) / max(z1 - z0, 0.001), 0.0, 1.0);

                                float w0 = (float(k) + 0.5) / float(uDepthCount);
                                float w1 = (float(kNext) + 0.5) / float(uDepthCount);

                                float v0 = texture(uData3D, vec3(normLon, normLat, w0)).r;
                                float v1 = texture(uData3D, vec3(normLon, normLat, w1)).r;

                                if (v0 <= -900.0 && v1 <= -900.0) {
                                    discard;
                                }

                                float sampleVal = 0.0;
                                if (v0 <= -900.0) sampleVal = v1;
                                else if (v1 <= -900.0) sampleVal = v0;
                                else sampleVal = mix(v0, v1, alpha);

                                float normVal = clamp((sampleVal - uValLo) / max(uValHi - uValLo, 0.0001), 0.0, 1.0);
                                vec4 col = texture(uColorMap, vec2(normVal, 0.5));
                                fragColor = vec4(col.rgb, 0.95 * uGlobalOpacity);
                                return;
                            }
                        }
                        discard;
                    }

                    // 96 ray-marching sample steps for smooth volumetric fidelity
                    const int NUM_STEPS = 96;
                    float dt = totalDist / float(NUM_STEPS);
                    vec3 stepVec = rd * dt;
                    vec3 p = ro + rd * (tEnter + dt * 0.5);

                    vec4 accColor = vec4(0.0);

                    for (int s = 0; s < NUM_STEPS; s++) {
                        // Map object coordinates [-0.5, 0.5]^3 to normalized dimensions:
                        // p.x: [-0.5, 0.5] -> normLat [0, 1] (South to North)
                        // p.z: [-0.5, 0.5] -> normLon [0, 1] (West to East)
                        // p.y: [0.5, -0.5] -> depthM [0, maxDepthM] (Surface to Deep)
                        float normLat = clamp(p.x + 0.5, 0.0, 1.0);
                        float normLon = clamp(p.z + 0.5, 0.0, 1.0);
                        float depthM = clamp((0.5 - p.y) * uMaxDepthM, 0.0, uMaxDepthM);

                        // Depth clipping
                        if (depthM > uClipMaxDepthM) {
                            p += stepVec;
                            continue;
                        }

                        // Seabed clipping via bathymetry texture
                        float seabedM = 6000.0;
                        if (uHasBathyTex) {
                            vec2 bathyUv = getBathyUv(normLon, normLat);
                            seabedM = texture(uBathyTex, bathyUv).r * 6000.0;
                            // If land or sample is beneath seabed floor, skip
                            if (seabedM < 0.5 || depthM > seabedM) {
                                p += stepVec;
                                continue;
                            }
                        }

                        // ================= DEBUG MODES (Section 10 & 28) =================
                        // Mode 1: Normalized depth (surface = 0/black, bottom = 1/white)
                        if (uDebugMode == 1) {
                            float normD = clamp(depthM / max(uMaxDepthM, 1.0), 0.0, 1.0);
                            float stepA = 1.0 - exp(-dt * uOpacityScale * uGlobalOpacity * 30.0);
                            float w = (1.0 - accColor.a) * stepA;
                            accColor.rgb += vec3(normD) * w;
                            accColor.a += w;
                            if (accColor.a >= 0.98) break;
                            p += stepVec;
                            continue;
                        }

                        // Mode 2: Normalized longitude (West = 0/black, East = 1/white)
                        if (uDebugMode == 2) {
                            float stepA = 1.0 - exp(-dt * uOpacityScale * uGlobalOpacity * 30.0);
                            float w = (1.0 - accColor.a) * stepA;
                            accColor.rgb += vec3(normLon) * w;
                            accColor.a += w;
                            if (accColor.a >= 0.98) break;
                            p += stepVec;
                            continue;
                        }

                        // Mode 3: Normalized latitude (South = 0/black, North = 1/white)
                        if (uDebugMode == 3) {
                            float stepA = 1.0 - exp(-dt * uOpacityScale * uGlobalOpacity * 30.0);
                            float w = (1.0 - accColor.a) * stepA;
                            accColor.rgb += vec3(normLat) * w;
                            accColor.a += w;
                            if (accColor.a >= 0.98) break;
                            p += stepVec;
                            continue;
                        }

                        // Mode 6: Bathymetry seabed mask
                        if (uDebugMode == 6) {
                            float bathyNorm = clamp(seabedM / 3500.0, 0.0, 1.0);
                            accColor = vec4(vec3(bathyNorm), 0.95 * uGlobalOpacity);
                            break;
                        }

                        // Non-uniform vertical level lookup
                        int k = 0;
                        for (int i = 0; i < 31; i++) {
                            if (i < uDepthCount - 1 && uDepthLevels[i + 1] < depthM) {
                                k = i + 1;
                            }
                        }

                        int kNext = min(k + 1, uDepthCount - 1);
                        float z0 = uDepthLevels[k];
                        float z1 = uDepthLevels[kNext];
                        float alpha = clamp((depthM - z0) / max(z1 - z0, 0.001), 0.0, 1.0);

                        float w0 = (float(k) + 0.5) / float(uDepthCount);
                        float w1 = (float(kNext) + 0.5) / float(uDepthCount);

                        // Sample layer k and layer k+1 from 3D texture
                        float v0 = texture(uData3D, vec3(normLon, normLat, w0)).r;
                        float v1 = texture(uData3D, vec3(normLon, normLat, w1)).r;

                        bool hasValidData = (v0 > -900.0 || v1 > -900.0);

                        // Mode 7: Invalid-data / NaN mask
                        if (uDebugMode == 7) {
                            vec3 col = hasValidData ? vec3(0.1, 0.7, 0.3) : vec3(0.9, 0.1, 0.1);
                            float a = hasValidData ? (0.02 * uGlobalOpacity) : (0.15 * uGlobalOpacity);
                            float w = (1.0 - accColor.a) * a;
                            accColor.rgb += col * w;
                            accColor.a += w;
                            if (accColor.a >= 0.98) break;
                            p += stepVec;
                            continue;
                        }

                        if (hasValidData) {
                            float sampleVal = 0.0;
                            if (v0 <= -900.0) {
                                sampleVal = v1;
                            } else if (v1 <= -900.0) {
                                sampleVal = v0;
                            } else {
                                sampleVal = mix(v0, v1, alpha);
                            }

                            // Normalize against active variable range
                            float normVal = clamp((sampleVal - uValLo) / max(uValHi - uValLo, 0.0001), 0.0, 1.0);

                            // Mode 4: Raw normalized scalar (grayscale)
                            if (uDebugMode == 4) {
                                float density = texture(uOpacityMap, vec2(normVal, 0.5)).r;
                                float stepA = 1.0 - exp(-density * dt * uOpacityScale * uGlobalOpacity * 60.0);
                                float weight = (1.0 - accColor.a) * stepA;
                                accColor.rgb += vec3(normVal) * weight;
                                accColor.a += weight;
                                if (accColor.a >= 0.98) break;
                                p += stepVec;
                                continue;
                            }

                            // Mode 0: Normal scientific scalar volume rendering (Section 12, 13, 14, 24, 25)
                            vec4 sampleCol = texture(uColorMap, vec2(normVal, 0.5));
                            float density = texture(uOpacityMap, vec2(normVal, 0.5)).r;
                            float sampleAlpha = 1.0 - exp(-density * dt * uOpacityScale * uGlobalOpacity * 60.0);

                            // Front-to-back accumulation
                            accColor.rgb += (1.0 - accColor.a) * sampleCol.rgb * sampleAlpha;
                            accColor.a   += (1.0 - accColor.a) * sampleAlpha;

                            if (accColor.a >= 0.98) break;
                        }

                        p += stepVec;
                    }

                    if (accColor.a < 0.005) {
                        discard;
                    }

                    fragColor = accColor;
                }
            `
        });
    }

    initMesh() {
        const geom = new THREE.BoxGeometry(1, 1, 1);
        this.mesh = new THREE.Mesh(geom, this.material);
        this.mesh.renderOrder = 10;
        this.mesh.visible = false;

        this.mesh.onBeforeRender = () => {
            this.mesh.updateMatrixWorld(true);
            if (this.material?.uniforms?.uInverseModelMatrix) {
                this.material.uniforms.uInverseModelMatrix.value.copy(this.mesh.matrixWorld).invert();
            }
        };

        this.updateDimensions();
    }

    updateDimensions() {
        const t = this.bathymetry?.terrain;
        if (!t || !t.x || !t.y) return;

        const widthX = Math.abs(t.y[t.y.length - 1] - t.y[0]) || 500;
        const widthZ = Math.abs(t.x[t.x.length - 1] - t.x[0]) || 500;
        const centerX = (t.y[0] + t.y[t.y.length - 1]) / 2;
        const centerZ = (t.x[0] + t.x[t.x.length - 1]) / 2;

        const maxH = Math.abs(this.sceneManager?.depthY ? this.sceneManager.depthY(this.maxDepthM) : this.maxDepthM * 0.07);

        this.mesh.scale.set(widthX, maxH, widthZ);
        this.mesh.position.set(centerX, -maxH / 2, centerZ);

        this.mesh.updateMatrix();
        this.mesh.updateMatrixWorld(true);
        if (this.material?.uniforms?.uInverseModelMatrix) {
            this.material.uniforms.uInverseModelMatrix.value.copy(this.mesh.matrixWorld).invert();
        }
    }

    get volumeTexture() {
        return this.data3DTexture;
    }

    setBathyTex(tex) {
        this.bathyTex = tex;
        if (this.material?.uniforms?.uBathyTex) {
            this.material.uniforms.uBathyTex.value = tex;
            this.material.uniforms.uHasBathyTex.value = !!tex;
        }
    }

    setBounds(scalarBounds, bathyBounds) {
        if (scalarBounds && scalarBounds.length >= 4) {
            this.scalarBounds = [scalarBounds[0], scalarBounds[1], scalarBounds[2], scalarBounds[3]];
            if (this.material?.uniforms?.uScalarBounds) {
                this.material.uniforms.uScalarBounds.value.set(...this.scalarBounds);
            }
        }
        if (bathyBounds && bathyBounds.length >= 4) {
            this.bathyBounds = [bathyBounds[0], bathyBounds[1], bathyBounds[2], bathyBounds[3]];
            if (this.material?.uniforms?.uBathyBounds) {
                this.material.uniforms.uBathyBounds.value.set(...this.bathyBounds);
            }
        }
    }

    setClipDepth(depthM) {
        const d = Math.max(0.0, Math.min(this.maxDepthM, Number(depthM) || this.maxDepthM));
        this.clipMaxDepthM = d;
        const frac = d / Math.max(this.maxDepthM, 1.0);
        if (this.material?.uniforms?.uClipMaxDepthM) {
            this.material.uniforms.uClipMaxDepthM.value = d;
        }
        if (this.material?.uniforms?.u_clipMaxDepthFrac) {
            this.material.uniforms.u_clipMaxDepthFrac.value = frac;
        }
    }

    setDataset(dataset) {
        if (!dataset) return;
        this.dataset = dataset;
        this.lastValues3D = dataset.values3D;
        const stats = dataset.getStats();

        this.valLo = stats.scalarMin != null ? stats.scalarMin : (this.valLo || 9.0);
        this.valHi = stats.scalarMax != null ? stats.scalarMax : (this.valHi || 31.0);
        if (dataset.depthLevels && dataset.depthLevels.length) {
            this.depthLevels = dataset.depthLevels;
        }
        this.maxDepthM = stats.depthMax || (this.depthLevels.length ? this.depthLevels[this.depthLevels.length - 1] : 541.089);
        this.clipMaxDepthM = this.maxDepthM;
        this.variable = dataset.variable || this.variable;

        if (dataset.longitudes?.length && dataset.latitudes?.length) {
            const minLon = dataset.longitudes[0];
            const maxLon = dataset.longitudes[dataset.longitudes.length - 1];
            const minLat = dataset.latitudes[0];
            const maxLat = dataset.latitudes[dataset.latitudes.length - 1];
            this.scalarBounds = [minLon, maxLon, minLat, maxLat];
            if (this.material?.uniforms?.uScalarBounds) {
                this.material.uniforms.uScalarBounds.value.set(minLon, maxLon, minLat, maxLat);
            }
        }

        // Dispose previous 3D texture
        if (this.data3DTexture) {
            this.data3DTexture.dispose();
            this.data3DTexture = null;
        }

        this.data3DTexture = dataset.createTexture();

        const uArray = this.material.uniforms.uDepthLevels.value;
        for (let i = 0; i < 32; i++) {
            uArray[i] = i < this.depthLevels.length ? this.depthLevels[i] : (this.depthLevels[this.depthLevels.length - 1] || 0);
        }
        this.material.uniforms.uDepthCount.value = Math.min(32, this.depthLevels.length);
        this.material.uniforms.uMaxDepthM.value = this.maxDepthM;
        this.material.uniforms.uClipMaxDepthM.value = this.clipMaxDepthM;
        this.material.uniforms.u_clipMaxDepthFrac.value = 1.0;

        if (this.colorMapTexture) {
            this.colorMapTexture.dispose();
        }
        this.colorMapTexture = buildColorMapTexture(this.variable, this.valLo, this.valHi);

        const u = this.material.uniforms;
        u.uData3D.value = this.data3DTexture;
        u.uHasData3D.value = true;
        u.uColorMap.value = this.colorMapTexture;
        u.uValLo.value = this.valLo;
        u.uValHi.value = this.valHi;

        this.updateDimensions();
        this.debugTextureSample();
    }

    setField(values3D, depthLevels, variable, valLo, valHi, maxDepthM = null) {
        if (!values3D || !values3D.length) return;
        const dataset = new OceanVariableDataset({
            variable: variable || this.variable,
            values3D,
            depthLevels: depthLevels || this.depthLevels,
            min: Number.isFinite(valLo) ? valLo : null,
            max: Number.isFinite(valHi) ? valHi : null
        });
        if (maxDepthM) {
            this.maxDepthM = maxDepthM;
        }
        this.setDataset(dataset);
    }

    debugTextureSample() {
        if (!this.data3DTexture || !this.data3DTexture.image) {
            return null;
        }
        const { width, height, depth, data } = this.data3DTexture.image;
        const sampleAt = (x, y, z) => {
            if (!data) return null;
            const idx = x + y * width + z * width * height;
            return data[idx];
        };

        const samples = {
            width,
            height,
            depth,
            'x=0,y=0,z=0': sampleAt(0, 0, 0),
            'x=50,y=45,z=0': sampleAt(50, 45, 0),
            'x=50,y=45,z=10': sampleAt(50, 45, 10),
            'x=50,y=45,z=20': sampleAt(50, 45, 20),
            'x=50,y=45,z=31': sampleAt(50, 45, 31)
        };

        console.group('[OceanVolumeRenderer] Data3DTexture Proof (Section 4)');
        console.log(`Dimensions: width=${width}, height=${height}, depth=${depth}`);
        console.log(`ValRange: [${this.valLo?.toFixed(2)}, ${this.valHi?.toFixed(2)}]`);
        console.log('Sample Points:', samples);
        if (this.depthLevels) {
            console.log(`Vertical Profile at (x=50, y=45):`);
            console.log(`  z=0  (Depth ${this.depthLevels[0]?.toFixed(2)}m):  ${samples['x=50,y=45,z=0']?.toFixed(2)}`);
            console.log(`  z=10 (Depth ${this.depthLevels[10]?.toFixed(2)}m): ${samples['x=50,y=45,z=10']?.toFixed(2)}`);
            console.log(`  z=20 (Depth ${this.depthLevels[20]?.toFixed(2)}m): ${samples['x=50,y=45,z=20']?.toFixed(2)}`);
            console.log(`  z=31 (Depth ${this.depthLevels[31]?.toFixed(2)}m): ${samples['x=50,y=45,z=31']?.toFixed(2)}`);
        }
        console.groupEnd();
        return samples;
    }

    debugVerticalProfile(latIndex = 45, lonIndex = 50) {
        if (!this.lastValues3D || !this.depthLevels) {
            console.warn('[OceanVolumeRenderer] No 3D values available for vertical profile.');
            return null;
        }
        const profile = [];
        console.group(`[OceanVolumeRenderer] Vertical Profile at LatIdx=${latIndex}, LonIdx=${lonIndex} (Section 20)`);
        console.log('Depth (m) | Value');
        console.log('----------------');
        for (let z = 0; z < this.depthLevels.length; z++) {
            const d = this.depthLevels[z];
            const v = this.lastValues3D[z]?.[latIndex]?.[lonIndex];
            profile.push({ depth: d, value: v });
            console.log(`${d.toFixed(2).padStart(8)}m | ${v != null ? v.toFixed(3) : 'NaN'}`);
        }
        console.groupEnd();
        return profile;
    }

    setVisible(visible) {
        if (this.mesh) {
            this.mesh.visible = !!visible;
        }
    }

    setOpacity(opacity) {
        this.opacity = opacity;
        if (this.material?.uniforms?.uGlobalOpacity) {
            this.material.uniforms.uGlobalOpacity.value = opacity;
        }
    }

    setTransferFunction(baseAlpha, transferLow, transferHigh, opacityScale = null) {
        if (baseAlpha != null && this.material?.uniforms?.uBaseAlpha) {
            this.baseAlpha = Number(baseAlpha);
            this.material.uniforms.uBaseAlpha.value = this.baseAlpha;
        }
        if (opacityScale != null && this.material?.uniforms?.uOpacityScale) {
            this.opacityScale = Number(opacityScale);
            this.material.uniforms.uOpacityScale.value = this.opacityScale;
        }
        let needsRebuild = false;
        if (transferLow != null && this.material?.uniforms?.uTransferLow) {
            this.transferLow = Number(transferLow);
            this.material.uniforms.uTransferLow.value = this.transferLow;
            needsRebuild = true;
        }
        if (transferHigh != null && this.material?.uniforms?.uTransferHigh) {
            this.transferHigh = Number(transferHigh);
            this.material.uniforms.uTransferHigh.value = this.transferHigh;
            needsRebuild = true;
        }
        if (needsRebuild) {
            if (this.opacityMapTexture) {
                this.opacityMapTexture.dispose();
            }
            this.opacityMapTexture = buildOpacityMapTexture(this.transferLow, this.transferHigh);
            if (this.material?.uniforms?.uOpacityMap) {
                this.material.uniforms.uOpacityMap.value = this.opacityMapTexture;
            }
        }
    }

    setDebugMode(mode, sliceDepthM = 0.49) {
        if (this.material?.uniforms?.uDebugMode) {
            this.material.uniforms.uDebugMode.value = Number(mode) || 0;
        }
        if (this.material?.uniforms?.uDebugSliceDepthM) {
            this.material.uniforms.uDebugSliceDepthM.value = Number(sliceDepthM) || 0.0;
        }
        console.log(`[OceanVolumeRenderer] Debug Mode: ${mode}, Slice Depth: ${sliceDepthM}m`);
    }

    dispose() {
        if (this.mesh) {
            this.mesh.geometry?.dispose();
            if (this.material) {
                this.material.dispose();
            }
            this.mesh.parent?.remove(this.mesh);
            this.mesh = null;
        }
        if (this.data3DTexture) {
            this.data3DTexture.dispose();
            this.data3DTexture = null;
        }
        if (this.colorMapTexture) {
            this.colorMapTexture.dispose();
            this.colorMapTexture = null;
        }
        if (this.opacityMapTexture) {
            this.opacityMapTexture.dispose();
            this.opacityMapTexture = null;
        }
    }
}
