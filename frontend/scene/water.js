// SolvX Viewer — 3D Ocean Variable Layer Coordinator
import * as THREE from 'three';
import { OceanVolumeRenderer } from './oceanVolumeRenderer.js';

/**
 * DynamicWater acts as a thin coordinator between bathymetry,
 * the scene graph, and the true 3D volumetric ocean variable renderer.
 * All legacy InstancedMesh and BoxGeometry water cells have been removed.
 */
export class DynamicWater {
    constructor(bathymetry, sceneManager, options = {}) {
        this.bathymetry = bathymetry;
        this.sceneManager = sceneManager;
        this.bounds = bathymetry.bounds || [84.1, 93.0, 16.0, 23.5];

        this.opacity = options.opacity != null ? options.opacity : 0.65;

        this.group = new THREE.Group();

        // Bathymetry texture encoding depth values from bathymetry grid
        // Red channel = normalized depth (0 = land, >0 = ocean).
        this.bathyTex = this._buildBathymetryTexture();

        // 3D Ocean Volume Ray-Marching Renderer
        this.volumeRenderer = new OceanVolumeRenderer(this.bathymetry, this.sceneManager, {
            bathyTex: this.bathyTex,
            bathyBounds: this.bounds,
            opacity: this.opacity
        });
        this.renderer = this.volumeRenderer; // Alias

        this.group.add(this.volumeRenderer.mesh);
    }

    /**
     * Build a DataTexture encoding depth values from bathymetry.
     * Red channel = normalized depth (0 = land, >0 = ocean).
     */
    _buildBathymetryTexture() {
        const t = this.bathymetry?.terrain;
        if (!t || !t.x || !t.y || !t.rawDepthKm) return null;

        const nx = t.x.length;
        const ny = t.y.length;
        const data = new Float32Array(nx * ny);

        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const rawD = Number((t.rawDepthKm[j] || [])[i]);
                if (rawD == null || isNaN(rawD) || rawD <= 0) {
                    data[j * nx + i] = 0.0;
                } else {
                    data[j * nx + i] = Math.min(rawD / 6.0, 1.0);
                }
            }
        }

        const tex = new THREE.DataTexture(data, nx, ny, THREE.RedFormat, THREE.FloatType);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;
        return tex;
    }

    setOpacity(opacity) {
        this.opacity = Number(opacity);
        if (this.volumeRenderer) {
            this.volumeRenderer.setOpacity(this.opacity);
        }
    }

    setDataset(dataset) {
        if (this.volumeRenderer) {
            this.volumeRenderer.setDataset(dataset);
        }
    }

    setField(values3D, depthLevels, variable, valLo, valHi, maxDepthM = null) {
        if (this.volumeRenderer) {
            this.volumeRenderer.setField(values3D, depthLevels, variable, valLo, valHi, maxDepthM);
        }
    }

    setDebugMode(mode, sliceDepthM = 0.49) {
        if (this.volumeRenderer) {
            this.volumeRenderer.setDebugMode(mode, sliceDepthM);
        }
    }

    setClipDepth(depthM) {
        if (this.volumeRenderer) {
            this.volumeRenderer.setClipDepth(depthM);
        }
    }

    setTransferFunction(baseAlpha, transferLow, transferHigh, opacityScale) {
        if (this.volumeRenderer) {
            this.volumeRenderer.setTransferFunction(baseAlpha, transferLow, transferHigh, opacityScale);
        }
    }

    dispose() {
        if (this.bathyTex) {
            this.bathyTex.dispose();
            this.bathyTex = null;
        }
        if (this.volumeRenderer) {
            this.volumeRenderer.dispose();
            this.volumeRenderer = null;
            this.renderer = null;
        }
    }
}

// Export canonical alias
export const OceanVariableLayer = DynamicWater;
