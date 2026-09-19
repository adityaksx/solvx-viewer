// SolvX Viewer — 3D Temperature Field Visualization
import * as THREE from 'three';
import { updateLegendUI, sampleColor } from './colorScale.js';
import { createDataTexture2D, extractSlice2D, findDepthIndex } from './dataTexture.js';

export class ScalarVisualizer {
    constructor(waterComponent, options = {}) {
        this.water = waterComponent;
        this.sceneManager = waterComponent.sceneManager;
        this.range = { lo: 24.0, hi: 31.0 };
        this.units = '°C';
        this.currentData = null;
        
        // Create horizontal slice mesh
        this.sliceMesh = null;
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
                    vec2 texCoord = vec2(1.0 - vUv.y, vUv.x);
                    if (uHasBathyTex) {
                        float depthVal = texture2D(uBathyTex, texCoord).r;
                        if (depthVal < 0.001) {
                            discard;
                        }
                    }
                    
                    vec4 col = texture2D(map, texCoord);
                    if (col.a < 0.05) discard;
                    
                    gl_FragColor = col;
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        
        this.sliceMesh = new THREE.Mesh(geom, mat);
        this.sliceMesh.renderOrder = 15;
        this.sliceMesh.visible = false;
        this.water.group.add(this.sliceMesh);

        // Vertical slice (diagonal across the bounds)
        // Length of diagonal
        const diagLen = Math.sqrt(widthX * widthX + widthZ * widthZ);
        const maxDepthM = 3500;
        const geomVert = new THREE.PlaneGeometry(diagLen, maxDepthM); // width, height (y)
        
        // Center of plane is at (0, 0, 0), we want it to extend down to -maxDepthM
        geomVert.translate(0, -maxDepthM / 2, 0);
        
        // Rotate so it aligns with the diagonal
        // No initial rotation, rotate the mesh dynamically
        
        this.verticalSliceMesh = new THREE.Mesh(geomVert, mat.clone());
        this.verticalSliceMesh.visible = false;
        this.water.group.add(this.verticalSliceMesh);
    }

    apply(variable, dataArray = null, depthM = 0, mode = 'slice') {
        this.variable = variable;
        this.currentData = dataArray;
        
        let lo = 24.0;
        let hi = 31.5;

        if (dataArray && dataArray.values && dataArray.values.length) {
            let slice2d = dataArray.values;
            if (Array.isArray(dataArray.values[0]) && Array.isArray(dataArray.values[0][0])) {
                const depths = dataArray.metadata?.depth_levels;
                const idx = findDepthIndex(depths, depthM);
                slice2d = extractSlice2D(dataArray, idx);
            }

            const flat = (slice2d || []).flat(2).filter(v => v != null && isFinite(v));
            if (flat.length > 0) {
                flat.sort((a, b) => a - b);
                lo = flat[Math.floor(flat.length * 0.02)];
                hi = flat[Math.floor(flat.length * 0.98)];
                
                // Ensure sufficient dynamic range for subtle gradients
                if (Math.abs(hi - lo) < 0.6) {
                    const mid = (lo + hi) / 2;
                    lo = mid - 0.5;
                    hi = mid + 0.5;
                }
            }
        }

        this.range = { lo, hi };
        updateLegendUI(this.variable, lo, hi, dataArray?.units || '');

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
        
        // Full volume dynamic range for 3D boxes
        let volLo = this.range.lo;
        let volHi = this.range.hi;
        if (is3D) {
            const allFlat = vals.flat(3).filter(v => v != null && isFinite(v)).sort((a, b) => a - b);
            if (allFlat.length > 0) {
                volLo = allFlat[Math.floor(allFlat.length * 0.02)];
                volHi = allFlat[Math.floor(allFlat.length * 0.98)];
            }
        }
        
        this.water.recolorCells(c => {
            const j = Math.floor(((c.lat - bounds[2]) / dLat) * lats);
            const i = Math.floor(((c.lon - bounds[0]) / dLon) * lons);
            
            if (j < 0 || j >= lats || i < 0 || i >= lons) return null;
            
            let d = 0;
            if (is3D && this.currentData.metadata && this.currentData.metadata.depth_levels) {
                d = findDepthIndex(this.currentData.metadata.depth_levels, c.depthM);
            }
            
            const val = is3D ? vals[d][j][i] : vals[j][i];
            if (val == null || isNaN(val)) return null;
            
            const color = sampleColor(this.variable, val, volLo, volHi);
            return new THREE.Color(color.r, color.g, color.b);
        });
    }


    applyVerticalSlicePlane(sLat, sLon, eLat, eLon) {
        this.customVerticalCoords = { sLat, sLon, eLat, eLon };
        this.updateSliceTexture(0, 'vertical_custom');
    }

    updateSliceTexture(depthM, mode = 'slice') {
        if (!this.currentData) return;
        
        // Also update volume colors when data changes
        this.applyVolumeColors();
        
        if (mode === 'vertical' || mode === 'vertical_custom') {
            this.sliceMesh.visible = false;
            this.verticalSliceMesh.visible = true;
            
            import('./verticalSlice.js').then(module => {
                const texture = module.createVerticalSliceTexture(this.currentData, this.variable, this.range.lo, this.range.hi, this.customVerticalCoords, this.water.bounds);
                
                if (mode === 'vertical_custom' && this.customVerticalCoords) {
                    const { sLat, sLon, eLat, eLon } = this.customVerticalCoords;
                    const midLat = (this.water.bounds[2] + this.water.bounds[3]) / 2;
                    const midLon = (this.water.bounds[0] + this.water.bounds[1]) / 2;
                    const sx = (sLat - midLat) * 111.32;
                    const sz = (sLon - midLon) * 111.32 * Math.cos(midLat * Math.PI / 180);
                    const ex = (eLat - midLat) * 111.32;
                    const ez = (eLon - midLon) * 111.32 * Math.cos(midLat * Math.PI / 180);
                    const length = Math.sqrt((ex - sx) ** 2 + (ez - sz) ** 2);
                    const cx = (sx + ex) / 2;
                    const cz = (sz + ez) / 2;
                    const angle = Math.atan2(ez - sz, ex - sx);
                    
                    this.verticalSliceMesh.position.set(cx, 0, cz);
                    const origLen = this.verticalSliceMesh.geometry.parameters.width;
                    this.verticalSliceMesh.scale.set(length / origLen, 1, 1);
                    this.verticalSliceMesh.rotation.set(0, -angle, 0);
                } else if (mode === 'vertical') {
                    // Default diagonal
                    const cx = this._centerX || 0;
                    const cz = this._centerZ || 0;
                    const widthX = this.water.widthX || 100;
                    const widthZ = this.water.widthZ || 100;
                    const angle = Math.atan2(widthZ, widthX);
                    this.verticalSliceMesh.position.set(cx, 0, cz);
                    this.verticalSliceMesh.scale.set(1, 1, 1);
                    this.verticalSliceMesh.rotation.set(0, -angle, 0);
                }

                if (texture && this.verticalSliceMesh.material) {
                    if (this.verticalSliceMesh.material.uniforms) {
                        if (this.verticalSliceMesh.material.uniforms.map.value) this.verticalSliceMesh.material.uniforms.map.value.dispose();
                        this.verticalSliceMesh.material.uniforms.map.value = texture;
                        // Turn off bathy mask for vertical slice since it goes straight down
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
            // No depth levels, just use the first slice
            slice2d = extractSlice2D(this.currentData, 0);
        }
        
        const tempFakeArray = { values: slice2d };
        const texture = createDataTexture2D(tempFakeArray, this.variable, this.range.lo, this.range.hi);
        
        if (texture && this.sliceMesh.material) {
            if (this.sliceMesh.material.uniforms) {
                if (this.sliceMesh.material.uniforms.map.value) this.sliceMesh.material.uniforms.map.value.dispose();
                this.sliceMesh.material.uniforms.map.value = texture;
                // Also ensure bathyTex is linked if it wasn't available at init
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
        
        // Position the slice slightly above water plane to prevent z-fighting
        const yPos = this.sceneManager.depthY(depthM);
        this.sliceMesh.position.set(this._centerX || 0, yPos + 0.35, this._centerZ || 0);
    }

    sliceAtDepth(depthM, mode = 'slice') {
        this.updateSliceTexture(depthM, mode);
    }
}
