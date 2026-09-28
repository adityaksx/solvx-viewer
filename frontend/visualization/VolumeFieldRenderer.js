// SolvX Viewer — Generic 3D Volumetric Field Renderer
// Accepts any normalized FieldData instance, manages Data3DTexture, GPU shaders, depth coordinates, and clipping.
import * as THREE from 'three';
import { createVolumeMaterial } from './VolumeFieldShader.js';
import { sampleColor } from './colorScale.js';

export class VolumeFieldRenderer {
    /**
     * @param {Object} options
     * @param {THREE.Group} options.parentGroup Three.js parent group to attach volume mesh
     * @param {Object} options.sceneManager SolvX scene manager providing depthY()
     * @param {Object} options.bathymetry Bathymetry model providing bounds and bathyTex
     */
    constructor({ parentGroup, sceneManager, bathymetry, opacity = 0.65 } = {}) {
        this.parentGroup = parentGroup;
        this.sceneManager = sceneManager;
        this.bathymetry = bathymetry;
        this.opacity = opacity;

        this.fieldData = null;
        this.mesh = null;
        this.material = null;
        this.geometry = null;

        this.volumeTexture = null;
        this.colormapTexture = null;
        this.depthLutTexture = null;

        this.isSupported = this._checkWebGL3DSupport();
    }

    _checkWebGL3DSupport() {
        try {
            return typeof THREE.Data3DTexture === 'function';
        } catch (_) {
            return false;
        }
    }

    /**
     * Uploads and renders a generic FieldData instance.
     * @param {import('./FieldData.js').FieldData} fieldData
     */
    setField(fieldData) {
        if (!fieldData || !fieldData.values) {
            this.clear();
            return;
        }

        if (!this.isSupported) {
            console.warn('[VolumeFieldRenderer] THREE.Data3DTexture is unsupported in current environment.');
            return;
        }

        // Dispose previous GPU resources to avoid memory leaks
        this._disposeTextures();

        this.fieldData = fieldData;

        // 1. Build 3D Data Texture
        this.volumeTexture = new THREE.Data3DTexture(
            fieldData.values,
            fieldData.width,
            fieldData.height,
            fieldData.depth
        );
        this.volumeTexture.format = THREE.RedFormat;
        this.volumeTexture.type = THREE.FloatType;
        this.volumeTexture.minFilter = THREE.LinearFilter;
        this.volumeTexture.magFilter = THREE.LinearFilter;
        this.volumeTexture.unpackAlignment = 1;
        this.volumeTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.volumeTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.volumeTexture.wrapR = THREE.ClampToEdgeWrapping;
        this.volumeTexture.needsUpdate = true;

        // 2. Build Colormap 1D Texture (256 entries)
        this.colormapTexture = this._buildColormapTexture(fieldData.variable, fieldData.min, fieldData.max);

        // 3. Build Non-Uniform Depth LUT 1D Texture (256 entries)
        this.depthLutTexture = this._buildDepthLutTexture(fieldData.levels);

        // 4. Compute Volume Bounding Box in Scene Coordinates
        const bounds = this.bathymetry?.bounds || [84.1, 93.0, 16.0, 23.5];
        const sceneMidLat = (bounds[2] + bounds[3]) / 2;
        const sceneMidLon = (bounds[0] + bounds[1]) / 2;
        const kLon = 111.32 * Math.cos((sceneMidLat * Math.PI) / 180);

        const latMin = fieldData.latitude[0];
        const latMax = fieldData.latitude[fieldData.latitude.length - 1];
        const lonMin = fieldData.longitude[0];
        const lonMax = fieldData.longitude[fieldData.longitude.length - 1];

        const depthMinM = fieldData.levels[0];
        const depthMaxM = fieldData.levels[fieldData.levels.length - 1];

        const sizeX = Math.max(1.0, Math.abs(latMax - latMin) * 111.32);
        const centerX = (((latMin + latMax) / 2) - sceneMidLat) * 111.32;

        const sizeZ = Math.max(1.0, Math.abs(lonMax - lonMin) * kLon);
        const centerZ = (((lonMin + lonMax) / 2) - sceneMidLon) * kLon;

        const topY = this.sceneManager.depthY(depthMinM);
        const bottomY = this.sceneManager.depthY(depthMaxM);
        const sizeY = Math.max(0.5, Math.abs(topY - bottomY));
        const centerY = (topY + bottomY) / 2;

        // 5. Create or Update Shader Material
        if (!this.material) {
            this.material = createVolumeMaterial({
                volumeTexture: this.volumeTexture,
                colormapTexture: this.colormapTexture,
                depthLutTexture: this.depthLutTexture,
                bathyTexture: this.bathymetry?.bathyTex || null,
                opacity: this.opacity,
                minDepthKm: depthMinM / 1000.0,
                maxDepthKm: depthMaxM / 1000.0,
                steps: 96
            });
        } else {
            this.material.uniforms.u_volume.value = this.volumeTexture;
            this.material.uniforms.u_colormap.value = this.colormapTexture;
            this.material.uniforms.u_depthLut.value = this.depthLutTexture;
            this.material.uniforms.u_bathyTex.value = this.bathymetry?.bathyTex || null;
            this.material.uniforms.u_hasBathyTex.value = !!this.bathymetry?.bathyTex;
            this.material.uniforms.u_minDepthKm.value = depthMinM / 1000.0;
            this.material.uniforms.u_maxDepthKm.value = depthMaxM / 1000.0;
            this.material.uniforms.u_opacity.value = this.opacity;
            this.material.uniforms.u_clipMinDepthFrac.value = 0.0;
            this.material.uniforms.u_clipMaxDepthFrac.value = 1.0;
        }

        // 6. Create or Reposition Mesh
        if (!this.geometry) {
            this.geometry = new THREE.BoxGeometry(1, 1, 1);
        }

        if (!this.mesh) {
            this.mesh = new THREE.Mesh(this.geometry, this.material);
            this.mesh.renderOrder = 18;
            this.mesh.onBeforeRender = () => {
                if (this.mesh && this.material && this.material.uniforms.u_inverseModelMatrix) {
                    this.material.uniforms.u_inverseModelMatrix.value.copy(this.mesh.matrixWorld).invert();
                }
            };
            this.parentGroup.add(this.mesh);
        }

        this.mesh.position.set(centerX, centerY, centerZ);
        this.mesh.scale.set(sizeX, sizeY, sizeZ);
        this.mesh.updateMatrixWorld(true);
        this.mesh.visible = true;
    }

    _buildColormapTexture(variable, minVal, maxVal, lutSize = 256) {
        const data = new Uint8Array(lutSize * 4);
        const range = (maxVal - minVal) || 1.0;

        for (let i = 0; i < lutSize; i++) {
            const val = minVal + (i / (lutSize - 1)) * range;
            const col = sampleColor(variable, val, minVal, maxVal);
            const idx = i * 4;
            data[idx] = Math.round(col.r * 255);
            data[idx + 1] = Math.round(col.g * 255);
            data[idx + 2] = Math.round(col.b * 255);
            data[idx + 3] = 255;
        }

        const tex = new THREE.DataTexture(data, lutSize, 1, THREE.RGBAFormat);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;
        return tex;
    }

    _buildDepthLutTexture(levels, lutSize = 256) {
        const data = new Float32Array(lutSize);
        if (!levels || levels.length === 0) {
            for (let i = 0; i < lutSize; i++) data[i] = i / (lutSize - 1);
        } else {
            const nLevels = levels.length;
            const minD = levels[0];
            const maxD = levels[nLevels - 1];
            const depthSpan = (maxD - minD) || 1.0;

            for (let i = 0; i < lutSize; i++) {
                const queryDepth = minD + (i / (lutSize - 1)) * depthSpan;

                // Piecewise linear interpolation across non-uniform depth levels
                let k = 0;
                while (k < nLevels - 1 && levels[k + 1] < queryDepth) {
                    k++;
                }

                let fracIdx = k;
                if (k < nLevels - 1) {
                    const step = levels[k + 1] - levels[k];
                    if (step > 1e-4) {
                        fracIdx = k + (queryDepth - levels[k]) / step;
                    }
                }

                const texZ = fracIdx / (nLevels - 1 || 1);
                data[i] = Math.max(0.0, Math.min(1.0, texZ));
            }
        }

        const tex = new THREE.DataTexture(data, lutSize, 1, THREE.RedFormat, THREE.FloatType);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;
        return tex;
    }

    setOpacity(opacity) {
        this.opacity = Number(opacity);
        if (this.material && this.material.uniforms.u_opacity) {
            this.material.uniforms.u_opacity.value = this.opacity;
        }
    }

    updateColorScale(minVal, maxVal) {
        if (!this.fieldData) return;
        if (this.colormapTexture) this.colormapTexture.dispose();
        this.colormapTexture = this._buildColormapTexture(this.fieldData.variable, minVal, maxVal);
        if (this.material) {
            this.material.uniforms.u_colormap.value = this.colormapTexture;
        }
    }

    setLevelRange(minDepthM, maxDepthM) {
        if (!this.fieldData || !this.material) return;
        const levels = this.fieldData.levels;
        const depthMin = levels[0];
        const depthMax = levels[levels.length - 1];
        const range = (depthMax - depthMin) || 1.0;

        if (maxDepthM <= depthMin || maxDepthM >= depthMax) {
            this.material.uniforms.u_clipMinDepthFrac.value = 0.0;
            this.material.uniforms.u_clipMaxDepthFrac.value = 1.0;
            return;
        }

        const cMin = Math.max(0.0, Math.min(1.0, (minDepthM - depthMin) / range));
        const cMax = Math.max(0.0, Math.min(1.0, (maxDepthM - depthMin) / range));

        this.material.uniforms.u_clipMinDepthFrac.value = Math.min(cMin, cMax);
        this.material.uniforms.u_clipMaxDepthFrac.value = Math.max(cMin, cMax);
    }

    setVisible(visible) {
        if (this.mesh) {
            this.mesh.visible = !!visible;
        }
    }

    _disposeTextures() {
        if (this.volumeTexture) {
            this.volumeTexture.dispose();
            this.volumeTexture = null;
        }
        if (this.colormapTexture) {
            this.colormapTexture.dispose();
            this.colormapTexture = null;
        }
        if (this.depthLutTexture) {
            this.depthLutTexture.dispose();
            this.depthLutTexture = null;
        }
    }

    clear() {
        this._disposeTextures();
        if (this.mesh) {
            this.mesh.visible = false;
        }
        this.fieldData = null;
    }

    dispose() {
        this.clear();
        if (this.geometry) {
            this.geometry.dispose();
            this.geometry = null;
        }
        if (this.material) {
            this.material.dispose();
            this.material = null;
        }
        if (this.mesh) {
            this.parentGroup?.remove(this.mesh);
            this.mesh = null;
        }
    }
}
