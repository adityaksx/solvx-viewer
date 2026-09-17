// SolvX Viewer — 3D Salinity Field Visualization
import * as THREE from 'three';
import { updateLegendUI, sampleColor } from './colorScale.js';
import { createDataTexture2D, extractSlice2D, findDepthIndex } from './dataTexture.js';

export class SalinityVisualizer {
    constructor(waterComponent, options = {}) {
        this.water = waterComponent;
        this.sceneManager = waterComponent.sceneManager;
        this.range = { lo: 26.0, hi: 35.5 };
        this.units = 'PSU';
        this.currentData = null;
        
        this.sliceMesh = null;
        this.verticalSliceMesh = null;
        this.initSliceMesh();
    }

    initSliceMesh() {
        const t = this.water.bathymetry.terrain;
        if (!t || !t.x || !t.y) return;

        const widthX = Math.abs(t.y[t.y.length - 1] - t.y[0]) || 500;
        const widthZ = Math.abs(t.x[t.x.length - 1] - t.x[0]) || 500;
        const centerX = (t.y[0] + t.y[t.y.length - 1]) / 2;
        const centerZ = (t.x[0] + t.x[t.x.length - 1]) / 2;

        const geom = new THREE.PlaneGeometry(widthX, widthZ);
        geom.rotateX(-Math.PI / 2);
        
        this._centerX = centerX;
        this._centerZ = centerZ;
        
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                map: { value: null },
                uBathyTex: { value: this.water.bathyTex },
                uHasBathyTex: { value: this.water.bathyTex ? true : false }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D map;
                uniform sampler2D uBathyTex;
                uniform bool uHasBathyTex;
                varying vec2 vUv;
                
                void main() {
                    if (uHasBathyTex) {
                        float depthVal = texture2D(uBathyTex, vec2(1.0 - vUv.y, vUv.x)).r;
                        if (depthVal < 0.001) {
                            discard;
                        }
                    }
                    
                    vec4 col = texture2D(map, vec2(1.0 - vUv.y, 1.0 - vUv.x));
                    if (col.a < 0.05) discard;
                    
                    gl_FragColor = col;
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        
        this.sliceMesh = new THREE.Mesh(geom, mat);
        this.sliceMesh.visible = false;
        this.water.group.add(this.sliceMesh);

        const diagLen = Math.sqrt(widthX * widthX + widthZ * widthZ);
        const maxDepthM = 3500;
        const geomVert = new THREE.PlaneGeometry(diagLen, maxDepthM);
        geomVert.translate(0, -maxDepthM / 2, 0);
        const angle = Math.atan2(widthZ, widthX);
        geomVert.rotateY(-angle);
        
        this.verticalSliceMesh = new THREE.Mesh(geomVert, mat.clone());
        this.verticalSliceMesh.visible = false;
        this.water.group.add(this.verticalSliceMesh);
    }

    apply(dataArray = null, depthM = 0, mode = 'slice') {
        this.currentData = dataArray;
        
        let lo = 26.0;
        let hi = 35.5;

        if (dataArray && dataArray.values && dataArray.values.length) {
            const flat = dataArray.values.flat(3).filter(v => v != null && isFinite(v));
            if (flat.length > 0) {
                flat.sort((a, b) => a - b);
                lo = flat[Math.floor(flat.length * 0.02)];
                hi = flat[Math.floor(flat.length * 0.98)];
            }
        }

        this.range = { lo, hi };
        updateLegendUI('salinity', lo, hi, this.units);

        this.updateSliceTexture(depthM, mode);
    }

    applyVolumeColors() {
        if (!this.currentData || !this.water.cells) return;
        const vals = this.currentData.values;
        if (!vals || !vals.length) return;
        
        const bounds = this.water.bounds;
        const dLat = bounds[3] - bounds[2];
        const dLon = bounds[1] - bounds[0];
        
        const is3D = Array.isArray(vals[0]) && Array.isArray(vals[0][0]);
        const lats = is3D ? vals[0].length : vals.length;
        const lons = is3D ? vals[0][0].length : vals[0].length;
        
        this.water.recolorCells(c => {
            const j = Math.floor(((c.lat - bounds[2]) / dLat) * lats);
            const i = Math.floor(((c.lon - bounds[0]) / dLon) * lons);
            
            if (j < 0 || j >= lats || i < 0 || i >= lons) return null;
            
            let d = 0;
            if (is3D && this.currentData.metadata && this.currentData.metadata.depth_levels) {
                d = findDepthIndex(this.currentData.metadata.depth_levels, c.depthM / 2);
            }
            
            const val = is3D ? vals[d][j][i] : vals[j][i];
            if (val == null || isNaN(val)) return null;
            
            const color = sampleColor('salinity', val, this.range.lo, this.range.hi);
            return new THREE.Color(color.r, color.g, color.b);
        });
    }

    updateSliceTexture(depthM, mode = 'slice') {
        if (!this.currentData) return;
        
        this.applyVolumeColors();
        
        if (mode === 'volume') {
            this.sliceMesh.visible = false;
            this.verticalSliceMesh.visible = false;
            return;
        }

        if (mode === 'vertical') {
            this.sliceMesh.visible = false;
            this.verticalSliceMesh.visible = true;
            
            import('./verticalSlice.js').then(module => {
                const texture = module.createVerticalSliceTexture(this.currentData, 'salinity', this.range.lo, this.range.hi);
                if (texture && this.verticalSliceMesh.material) {
                    if (this.verticalSliceMesh.material.uniforms) {
                        if (this.verticalSliceMesh.material.uniforms.map.value) this.verticalSliceMesh.material.uniforms.map.value.dispose();
                        this.verticalSliceMesh.material.uniforms.map.value = texture;
                        this.verticalSliceMesh.material.uniforms.uHasBathyTex.value = false;
                    } else {
                        if (this.verticalSliceMesh.material.map) this.verticalSliceMesh.material.map.dispose();
                        this.verticalSliceMesh.material.map = texture;
                        this.verticalSliceMesh.material.needsUpdate = true;
                    }
                }
            });
            return;
        }

        // Horizontal slice mode
        this.sliceMesh.visible = true;
        this.verticalSliceMesh.visible = false;
        
        let slice2d = null;
        if (this.currentData.metadata && this.currentData.metadata.depth_levels) {
            const depths = this.currentData.metadata.depth_levels;
            const idx = findDepthIndex(depths, depthM);
            slice2d = extractSlice2D(this.currentData, idx);
        } else {
            slice2d = extractSlice2D(this.currentData, 0);
        }
        
        const tempFakeArray = { values: slice2d };
        const texture = createDataTexture2D(tempFakeArray, 'salinity', this.range.lo, this.range.hi);
        
        if (texture && this.sliceMesh.material) {
            if (this.sliceMesh.material.uniforms) {
                if (this.sliceMesh.material.uniforms.map.value) this.sliceMesh.material.uniforms.map.value.dispose();
                this.sliceMesh.material.uniforms.map.value = texture;
                if (this.water.bathyTex && !this.sliceMesh.material.uniforms.uHasBathyTex.value) {
                    this.sliceMesh.material.uniforms.uBathyTex.value = this.water.bathyTex;
                    this.sliceMesh.material.uniforms.uHasBathyTex.value = true;
                }
            } else {
                if (this.sliceMesh.material.map) this.sliceMesh.material.map.dispose();
                this.sliceMesh.material.map = texture;
                this.sliceMesh.material.needsUpdate = true;
            }
        }
        
        const yPos = this.sceneManager.depthY(depthM);
        this.sliceMesh.position.set(this._centerX || 0, yPos, this._centerZ || 0);
    }

    sliceAtDepth(depthM, mode = 'slice') {
        this.updateSliceTexture(depthM, mode);
    }
}
