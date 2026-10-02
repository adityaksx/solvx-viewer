// SolvX Viewer — True 3D Ocean Variable Volumetric Ray-Marching Renderer
import * as THREE from 'three';
import { sampleColor } from '../visualization/colorScale.js';

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

export class OceanVolumeRenderer {
    constructor(bathymetry, sceneManager, options = {}) {
        this.bathymetry = bathymetry;
        this.sceneManager = sceneManager;
        this.options = options;

        this.maxDepthM = 541.089; // Default max depth of 4D model
        this.opacity = options.opacity != null ? options.opacity : 0.55;
        this.stepAlpha = options.stepAlpha != null ? options.stepAlpha : 0.045;
        this.variable = 'ocean_temperature';
        this.valLo = 24.0;
        this.valHi = 31.0;

        this.data3DTexture = null;
        this.colorMapTexture = null;
        this.bathyTex = options.bathyTex || null;

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
                uBathyTex: { value: this.bathyTex },
                uHasBathyTex: { value: this.bathyTex ? true : false },
                uDepthLevels: { value: depthUniformArray },
                uDepthCount: { value: 32 },
                uMaxDepthM: { value: this.maxDepthM },
                uValLo: { value: this.valLo },
                uValHi: { value: this.valHi },
                uGlobalOpacity: { value: this.opacity },
                uStepAlpha: { value: this.stepAlpha },
                uDebugMode: { value: 0 }
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
                uniform sampler2D uBathyTex;
                uniform bool uHasBathyTex;

                uniform float uDepthLevels[32];
                uniform int uDepthCount;
                uniform float uMaxDepthM;
                uniform float uValLo;
                uniform float uValHi;
                uniform float uGlobalOpacity;
                uniform float uStepAlpha;
                uniform int uDebugMode;

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

                void main() {
                    if (!uHasData3D) {
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

                        // Seabed clipping via bathymetry texture
                        if (uHasBathyTex) {
                            float seabedM = texture(uBathyTex, vec2(normLon, normLat)).r * 6000.0;
                            // If land or sample is beneath seabed floor, skip
                            if (seabedM < 0.5 || depthM > seabedM) {
                                p += stepVec;
                                continue;
                            }
                        }

                        // Debug Mode 1: Depth slice coloring
                        if (uDebugMode == 1) {
                            float frac = depthM / uMaxDepthM;
                            vec4 c = vec4(frac, 1.0 - frac, 0.5, 0.08 * uGlobalOpacity);
                            float w = (1.0 - accColor.a) * c.a;
                            accColor.rgb += c.rgb * w;
                            accColor.a += w;
                            if (accColor.a >= 0.95) break;
                            p += stepVec;
                            continue;
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

                        // Check sentinel value (-999.0 indicates land/no-data)
                        if (v0 > -900.0 || v1 > -900.0) {
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
                            vec4 sampleCol = texture(uColorMap, vec2(normVal, 0.5));

                            // Step opacity with global volume slider
                            float stepA = clamp(uStepAlpha * uGlobalOpacity, 0.0, 1.0);

                            // Front-to-back accumulation
                            float weight = (1.0 - accColor.a) * stepA;
                            accColor.rgb += sampleCol.rgb * weight;
                            accColor.a += weight;

                            if (accColor.a >= 0.95) break;
                        }

                        p += stepVec;
                    }

                    if (accColor.a < 0.01) {
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

    setBathyTex(tex) {
        this.bathyTex = tex;
        if (this.material?.uniforms?.uBathyTex) {
            this.material.uniforms.uBathyTex.value = tex;
            this.material.uniforms.uHasBathyTex.value = !!tex;
        }
    }

    setField(values3D, depthLevels, variable, valLo, valHi, maxDepthM = null) {
        if (!values3D || !values3D.length) return;

        // Flatten 3D array into Float32Array texture buffer
        const flat = flatten3DField(values3D);
        if (!flat) return;

        // Dispose previous 3D texture
        if (this.data3DTexture) {
            this.data3DTexture.dispose();
            this.data3DTexture = null;
        }

        this.data3DTexture = new THREE.Data3DTexture(
            flat.buffer,
            flat.width,
            flat.height,
            flat.depth
        );
        this.data3DTexture.format = THREE.RedFormat;
        this.data3DTexture.type = THREE.FloatType;
        this.data3DTexture.minFilter = THREE.LinearFilter;
        this.data3DTexture.magFilter = THREE.LinearFilter;
        this.data3DTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.data3DTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.data3DTexture.wrapR = THREE.ClampToEdgeWrapping;
        this.data3DTexture.needsUpdate = true;

        this.variable = variable || this.variable;
        this.valLo = Number.isFinite(valLo) ? valLo : 24.0;
        this.valHi = Number.isFinite(valHi) ? valHi : 31.0;

        if (depthLevels && depthLevels.length) {
            this.depthLevels = depthLevels;
            const uArray = this.material.uniforms.uDepthLevels.value;
            for (let i = 0; i < 32; i++) {
                uArray[i] = i < depthLevels.length ? depthLevels[i] : (depthLevels[depthLevels.length - 1] || 0);
            }
            this.material.uniforms.uDepthCount.value = Math.min(32, depthLevels.length);
            this.maxDepthM = maxDepthM || depthLevels[depthLevels.length - 1] || 541.089;
        } else if (maxDepthM) {
            this.maxDepthM = maxDepthM;
        }

        // Rebuild colormap texture
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
        u.uMaxDepthM.value = this.maxDepthM;

        this.updateDimensions();
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

    setDebugMode(mode) {
        if (this.material?.uniforms?.uDebugMode) {
            this.material.uniforms.uDebugMode.value = Number(mode) || 0;
        }
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
    }
}
