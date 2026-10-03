// SolvX Viewer — Bathymetry-Driven 3D Ocean Volumetric Columns
import * as THREE from 'three';
import { OceanVolumeRenderer } from './oceanVolumeRenderer.js';

const _tempCol = new THREE.Color();

export class DynamicWater {
    constructor(bathymetry, sceneManager, options = {}) {
        this.bathymetry = bathymetry;
        this.sceneManager = sceneManager;
        this.bounds = bathymetry.bounds || [84.1, 93.0, 16.0, 23.5];

        this.temperature = options.temperature || 28.0;
        this.opacity = options.opacity != null ? options.opacity : 0.65;

        this.group = new THREE.Group();
        this.instancedVolume = null;
        this.cells = [];

        // Retain bathymetry texture for subsurface slice masking if needed
        this.bathyTex = this._buildBathymetryTexture();

        // 3D Ocean Volume Ray-Marching Renderer
        this.volumeRenderer = new OceanVolumeRenderer(this.bathymetry, this.sceneManager, {
            bathyTex: this.bathyTex,
            opacity: this.opacity
        });
        this.group.add(this.volumeRenderer.mesh);

        this.buildVolume();
    }

    /**
     * Build a DataTexture encoding depth values from bathymetry.
     * Red channel = normalized depth (0 = land, >0 = ocean).
     */
    _buildBathymetryTexture() {
        const t = this.bathymetry.terrain;
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

    buildVolume() {
        const t = this.bathymetry.terrain;
        if (!t || !t.x || !t.y) return;

        const nx = t.x.length;
        const ny = t.y.length;
        const raw = t.rawDepthKm;
        
        // Adaptive sampling targets a denser volume while keeping instanced rendering performant.
        // The previous ~18k-cell target made individual blocks visibly oversized at this regional scale.
        const targetCells = 60000;
        const step = Math.max(1, Math.ceil(Math.sqrt(((nx - 1) * (ny - 1)) / targetCells)));

        const midLat = (this.bounds[2] + this.bounds[3]) / 2;
        const midLon = (this.bounds[0] + this.bounds[1]) / 2;
        const klon = 111.32 * Math.cos((midLat * Math.PI) / 180);

        this.cells = [];

        for (let j = 0; j < ny - 1; j += step) {
            for (let i = 0; i < nx - 1; i += step) {
                const i2 = Math.min(nx - 1, i + step);
                const j2 = Math.min(ny - 1, j + step);

                const d00 = Number((raw[j] || [])[i]);
                const d10 = Number((raw[j] || [])[i2]);
                const d01 = Number((raw[j2] || [])[i]);
                const d11 = Number((raw[j2] || [])[i2]);

                const depths = [d00, d10, d01, d11].filter(v => v != null && !isNaN(v) && v > 0.005);
                if (depths.length < 4) continue;

                const minD = Math.min(...depths);
                const h = Math.abs(this.sceneManager.depthY(minD * 1000));
                if (h < 0.08) continue;

                const posX = (t.y[j] + t.y[j2]) / 2;
                const posZ = (t.x[i] + t.x[i2]) / 2;

                const lat = midLat + posX / 111.32;
                const lon = midLon + posZ / (klon || 1.0);

                this.cells.push({
                    x: posX,
                    z: posZ,
                    // Do not shrink adjacent cells. The old 0.995 factor created visible seams
                    // between neighboring instances. Exact grid extents make the volume continuous.
                    sx: Math.max(0.25, Math.abs(t.y[j2] - t.y[j])),
                    sz: Math.max(0.25, Math.abs(t.x[i2] - t.x[i])),
                    h: h,
                    depthM: minD * 1000,
                    lat: lat,
                    lon: lon
                });
            }
        }

        if (!this.cells.length) return;

        const minDepthVal = Math.min(...this.cells.map(c => c.depthM));
        const maxDepthVal = Math.max(...this.cells.map(c => c.depthM));

        const boxGeom = new THREE.BoxGeometry(1, 1, 1);
        
        // Custom attribute to toggle between shader depth gradient and instance color
        const useDepthArray = new Float32Array(this.cells.length);
        useDepthArray.fill(1.0); // 1.0 = use depth gradient, 0.0 = use instance color
        boxGeom.setAttribute('instanceUseDepth', new THREE.InstancedBufferAttribute(useDepthArray, 1));

        // Actual bathymetric depth in meters, independent of rendered vertical exaggeration
        const depthArray = new Float32Array(this.cells.length);
        for (let i = 0; i < this.cells.length; i++) {
            depthArray[i] = this.cells[i].depthM;
        }
        boxGeom.setAttribute('instanceDepth', new THREE.InstancedBufferAttribute(depthArray, 1));

        const boxMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.2,
            metalness: 0.15,
            transparent: true,
            opacity: this.opacity,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        boxMat.onBeforeCompile = (shader) => {
            shader.uniforms.surfaceColor = { value: new THREE.Color(0.18, 0.60, 0.85) };
            shader.uniforms.deepColor = { value: new THREE.Color(0.08, 0.35, 0.55) };
            shader.uniforms.minDepth = { value: minDepthVal };
            shader.uniforms.maxDepth = { value: maxDepthVal };

            shader.vertexShader = `
                attribute float instanceUseDepth;
                attribute float instanceDepth;
                varying float vUseDepth;
                varying float vInstanceDepth;
                ${shader.vertexShader}
            `.replace(
                '#include <worldpos_vertex>',
                `
                #include <worldpos_vertex>
                vUseDepth = instanceUseDepth;
                vInstanceDepth = instanceDepth;
                `
            );

            shader.fragmentShader = `
                uniform vec3 surfaceColor;
                uniform vec3 deepColor;
                uniform float minDepth;
                uniform float maxDepth;
                varying float vUseDepth;
                varying float vInstanceDepth;
                ${shader.fragmentShader}
            `.replace(
                '#include <color_fragment>',
                `
                #include <color_fragment>
                
                if (vUseDepth > 0.5) {
                    float depthRange = max(maxDepth - minDepth, 0.000001);
                    float t = clamp((vInstanceDepth - minDepth) / depthRange, 0.0, 1.0);
                    diffuseColor.rgb = mix(surfaceColor, deepColor, t);
                }
                `
            );
        };

        this.instancedVolume = new THREE.InstancedMesh(boxGeom, boxMat, this.cells.length);
        const dummy = new THREE.Object3D();

        for (let k = 0; k < this.cells.length; k++) {
            const c = this.cells[k];
            dummy.position.set(c.x, -c.h / 2, c.z);
            dummy.scale.set(c.sx, c.h, c.sz);
            dummy.updateMatrix();
            this.instancedVolume.setMatrixAt(k, dummy.matrix);

            // Clean default
            this.instancedVolume.setColorAt(k, new THREE.Color(1, 1, 1));
        }

        this.instancedVolume.instanceMatrix.needsUpdate = true;
        if (this.instancedVolume.instanceColor) {
            this.instancedVolume.instanceColor.needsUpdate = true;
        }
        this.instancedVolume.userData = { isWater: true, cells: this.cells };
        this.instancedVolume.renderOrder = 5;
        this.group.add(this.instancedVolume);
    }

    setOpacity(opacity) {
        this.opacity = Number(opacity);
        if (this.instancedVolume?.material) {
            this.instancedVolume.material.opacity = this.opacity;
            const isVolumeActive = this.volumeRenderer && this.volumeRenderer.mesh && this.volumeRenderer.mesh.visible;
            this.instancedVolume.visible = !isVolumeActive && (this.opacity > 0.01);
        }
        if (this.volumeRenderer) {
            this.volumeRenderer.setOpacity(this.opacity);
        }
    }

    setTemperature(temp) {
        this.temperature = temp;
    }

    recolorCells(colorFunc, sliceDepthM = 0) {
        if (!this.instancedVolume) return;
        const dummy = new THREE.Object3D();

        const geom = this.instancedVolume.geometry;
        let useDepthAttr = geom.getAttribute('instanceUseDepth');
        if (!useDepthAttr) {
            useDepthAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.cells.length), 1);
            geom.setAttribute('instanceUseDepth', useDepthAttr);
        }

        for (let i = 0; i < this.cells.length; i++) {
            const c = this.cells[i];

            // If slicing below this cell's seabed depth, mask it out
            if (sliceDepthM > 0 && c.depthM < sliceDepthM) {
                dummy.position.set(c.x, -c.h / 2, c.z);
                dummy.scale.set(0, 0, 0);
                dummy.updateMatrix();
                this.instancedVolume.setMatrixAt(i, dummy.matrix);
                useDepthAttr.setX(i, 0.0);
                continue;
            }

            const col = colorFunc(c);
            if (col) {
                this.instancedVolume.setColorAt(i, col);
                dummy.position.set(c.x, -c.h / 2, c.z);
                dummy.scale.set(c.sx, c.h, c.sz);
                dummy.updateMatrix();
                this.instancedVolume.setMatrixAt(i, dummy.matrix);
                useDepthAttr.setX(i, 0.0);
            } else {
                // Default depth gradient enabled via shader attribute
                _tempCol.setRGB(1, 1, 1);
                this.instancedVolume.setColorAt(i, _tempCol);
                dummy.position.set(c.x, -c.h / 2, c.z);
                dummy.scale.set(c.sx, c.h, c.sz);
                dummy.updateMatrix();
                this.instancedVolume.setMatrixAt(i, dummy.matrix);
                useDepthAttr.setX(i, 1.0);
            }
        }
        this.instancedVolume.instanceMatrix.needsUpdate = true;
        if (this.instancedVolume.instanceColor) {
            this.instancedVolume.instanceColor.needsUpdate = true;
        }
        useDepthAttr.needsUpdate = true;
    }

    dispose() {
        if (this.bathyTex) {
            this.bathyTex.dispose();
            this.bathyTex = null;
        }
        if (this.volumeRenderer) {
            this.volumeRenderer.dispose();
            this.volumeRenderer = null;
        }
        if (this.instancedVolume) {
            this.instancedVolume.geometry?.dispose();
            this.instancedVolume.material?.dispose();
            this.group.remove(this.instancedVolume);
            this.instancedVolume = null;
        }
    }
}

