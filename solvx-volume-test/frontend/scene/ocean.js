/**
 * Ocean Volume Manager for SolvX Scene.
 * Coordinates VolumeRenderer, bounding box, depth slice, and shader uniforms.
 * Follows Sections 18, 19, 24, 29, 30 of the prototype plan.
 */

import * as THREE from 'three';
import VolumeRenderer from '../renderer/VolumeRenderer.js';
import { buildPaletteTexture } from '../renderer/palette.js';
import { buildCoordinateGrid } from './coordinateGrid.js';

export class OceanVolumeManager {
    constructor(scene, app = null) {
        this.scene = scene;
        this.app = app;
        this.volumeData = null;
        this.volumeMeta = null;
        this.currentPalette = 'Ocean Thermal (Turbo)';
        this.isSliceMode = false;
        this.sliceDepthM = 100.0;

        // 1. Create VolumeRenderer
        this.volumeRenderer = new VolumeRenderer({
            useVolumetricDepthTest: true,
            useRandomStart: true,
            raySteps: 128,
        });
        this.scene.add(this.volumeRenderer);

        // 2. Bounding Box Wireframe (depthWrite false to not pollute depth buffer)
        this.wireframeBox = new THREE.LineSegments(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({
                color: 0x00f0ff,
                transparent: true,
                opacity: 0.4,
                depthWrite: false
            })
        );
        this.wireframeBox.name = "VolumeBoundingBox";
        this.scene.add(this.wireframeBox);

        // 3. Coordinate Grid (initialized when geoConfig is available)
        this.coordinateGrid = null;
        this.surfaceGrid = new THREE.Group(); // Reference kept for backwards compatibility
        this.scene.add(this.surfaceGrid);

        // 4. Set Initial Palette
        this.setPalette(this.currentPalette);
    }

    setPalette(paletteName) {
        this.currentPalette = paletteName;
        const tex = buildPaletteTexture(paletteName);
        this.volumeRenderer.uniforms.palette.value = tex;
    }

    applyVolumeData(volumeResult) {
        this.volumeData = volumeResult;
        this.volumeMeta = volumeResult.meta;

        const uniforms = this.volumeRenderer.uniforms;
        uniforms.volumeData.value = volumeResult.texture;
        uniforms.volumeOrigin.value.copy(volumeResult.volumeOrigin);
        uniforms.volumeResolution.value.copy(volumeResult.volumeResolution);
        uniforms.voxelSize.value.copy(volumeResult.voxelSize);

        // Reset clipping to entire volume
        const b = volumeResult.worldBounds;
        uniforms.clipMin.value.set(b.xMin, b.yMin, b.zMin);
        uniforms.clipMax.value.set(b.xMax, b.yMax, b.zMax);

        // Update Bounding Box Wireframe
        this.updateBoundingBox(b);

        // Update Geographic Coordinate Grid
        if (volumeResult.geoConfig) {
            this.updateCoordinateGrid(volumeResult.geoConfig);
        }
    }

    updateCoordinateGrid(geoConfig) {
        if (this.coordinateGrid) {
            this.scene.remove(this.coordinateGrid);
            this.coordinateGrid = null;
        }
        this.coordinateGrid = buildCoordinateGrid(geoConfig);
        const isVisible = this.app?.gui?.params?.showGrid ?? true;
        this.coordinateGrid.visible = isVisible;
        this.scene.add(this.coordinateGrid);
    }

    setGridVisible(visible) {
        if (this.coordinateGrid) this.coordinateGrid.visible = visible;
        if (this.surfaceGrid) this.surfaceGrid.visible = visible;
    }

    updateBoundingBox(b) {
        const min = new THREE.Vector3(b.xMin, b.yMin, b.zMin);
        const max = new THREE.Vector3(b.xMax, b.yMax, b.zMax);

        this.wireframeBox.geometry.dispose();
        const boxGeom = new THREE.BoxGeometry(max.x - min.x, max.y - min.y, max.z - min.z);
        const edgesGeom = new THREE.EdgesGeometry(boxGeom);
        boxGeom.dispose();

        this.wireframeBox.geometry = edgesGeom;
        this.wireframeBox.position.set(
            (min.x + max.x) / 2,
            (min.y + max.y) / 2,
            (min.z + max.z) / 2
        );
    }

    setDepthRange(minDepthM, maxDepthM, verticalExaggeration = 5.0) {
        if (!this.volumeData) return;
        const b = this.volumeData.worldBounds;
        const ex = this.volumeData.geoConfig?.verticalExaggeration || verticalExaggeration;
        const yTop = -(minDepthM / 1000.0) * ex;
        const yBottom = -(maxDepthM / 1000.0) * ex;

        const uniforms = this.volumeRenderer.uniforms;
        uniforms.clipMin.value.y = Math.max(b.yMin, Math.min(yBottom, yTop));
        uniforms.clipMax.value.y = Math.min(b.yMax, Math.max(yBottom, yTop));
    }

    setOpacity(opacity) {
        this.volumeRenderer.uniforms.alphaMultiplier.value = opacity;
    }

    setRaySteps(steps) {
        this.volumeRenderer.setRaySteps(steps);
    }

    setPaletteRange(minNorm, maxNorm) {
        this.volumeRenderer.uniforms.minPaletteValue.value = minNorm;
        this.volumeRenderer.uniforms.maxPaletteValue.value = maxNorm;
    }

    setExtinction(extinction) {
        this.volumeRenderer.uniforms.extinctionCoefficient.value = extinction;
    }

    setSliceMode(enabled, depthM = 100.0, verticalExaggeration = 5.0) {
        this.isSliceMode = enabled;
        this.sliceDepthM = depthM;
        if (!this.volumeData) return;

        const b = this.volumeData.worldBounds;
        const uniforms = this.volumeRenderer.uniforms;
        const ex = this.volumeData.geoConfig?.verticalExaggeration || verticalExaggeration;

        if (enabled) {
            const sliceY = -(depthM / 1000.0) * ex;
            const halfThickness = (voxelSizeY => Math.max(voxelSizeY * 0.8, 1.0))(this.volumeData.voxelSize.y);
            uniforms.clipMin.value.y = sliceY - halfThickness;
            uniforms.clipMax.value.y = sliceY + halfThickness;
            uniforms.alphaMultiplier.value = 0.95;
        } else {
            uniforms.clipMin.value.y = b.yMin;
            uniforms.clipMax.value.y = b.yMax;
            uniforms.alphaMultiplier.value = 0.65;
        }
    }

    update() {
        this.volumeRenderer.uniforms.random.value = Math.random();
    }
}
