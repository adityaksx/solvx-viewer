// SolvX Viewer — High-Performance 3D Scalar Field Visualization
import * as THREE from 'three';
import { updateLegendUI, sampleColor } from './colorScale.js';
import { createDataTexture2D, extractSlice2D, findDepthIndex } from './dataTexture.js';

const _reusableColor = new THREE.Color();

function calculatePercentileRange(data2dOr3d, maxSamples = 1500) {
    if (!data2dOr3d || !data2dOr3d.length) return { lo: 24.0, hi: 31.0 };
    
    // Sample deterministically without flattening/sorting huge multi-megabyte arrays
    const samples = [];
    const is3D = Array.isArray(data2dOr3d[0]) && Array.isArray(data2dOr3d[0][0]);
    
    if (is3D) {
        const dLen = data2dOr3d.length;
        const latLen = data2dOr3d[0].length;
        const lonLen = data2dOr3d[0][0].length;
        const total = dLen * latLen * lonLen;
        const step = Math.max(1, Math.floor(total / maxSamples));
        
        let count = 0;
        for (let d = 0; d < dLen; d++) {
            for (let j = 0; j < latLen; j++) {
                for (let i = 0; i < lonLen; i++) {
                    if (count % step === 0) {
                        const val = data2dOr3d[d][j][i];
                        if (val != null && isFinite(val)) samples.push(val);
                    }
                    count++;
                }
            }
        }
    } else {
        const latLen = data2dOr3d.length;
        const lonLen = (data2dOr3d[0] || []).length;
        const total = latLen * lonLen;
        const step = Math.max(1, Math.floor(total / maxSamples));
        
        let count = 0;
        for (let j = 0; j < latLen; j++) {
            for (let i = 0; i < lonLen; i++) {
                if (count % step === 0) {
                    const val = data2dOr3d[j][i];
                    if (val != null && isFinite(val)) samples.push(val);
                }
                count++;
            }
        }
    }

    if (samples.length === 0) return { lo: 24.0, hi: 31.0 };
    
    samples.sort((a, b) => a - b);
    let lo = samples[Math.floor(samples.length * 0.02)];
    let hi = samples[Math.floor(samples.length * 0.98)];
    
    if (Math.abs(hi - lo) < 0.6) {
        const mid = (lo + hi) / 2;
        lo = mid - 0.5;
        hi = mid + 0.5;
    }
    
    return { lo, hi };
}

export class ScalarVisualizer {
    constructor(waterComponent, options = {}) {
        this.water = waterComponent;
        this.sceneManager = waterComponent.sceneManager;
        this.range = { lo: 24.0, hi: 31.0 };
        this.units = '°C';
        this.currentData = null;
        this.lastRenderedDepth = null;
        this.lastMode = null;
        
        // Horizontal & vertical slice meshes
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

        // Vertical slice
        const diagLen = Math.sqrt(widthX * widthX + widthZ * widthZ);
        const maxDepthM = 3500;
        const geomVert = new THREE.PlaneGeometry(diagLen, maxDepthM);
        geomVert.translate(0, -maxDepthM / 2, 0);
        
        this.verticalSliceMesh = new THREE.Mesh(geomVert, mat.clone());
        this.verticalSliceMesh.visible = false;
        this.water.group.add(this.verticalSliceMesh);
    }

    apply(variable, dataArray = null, depthM = 0, mode = 'slice') {
        this.variable = variable;
        this.currentData = dataArray;
        
        let { lo, hi } = { lo: 24.0, hi: 31.5 };

        if (dataArray && dataArray.values && dataArray.values.length) {
            let sliceOrVolume = dataArray.values;
            if (Array.isArray(dataArray.values[0]) && Array.isArray(dataArray.values[0][0])) {
                const depths = dataArray.metadata?.depth_levels;
                const idx = findDepthIndex(depths, depthM);
                sliceOrVolume = extractSlice2D(dataArray, idx);
            }
            const range = calculatePercentileRange(sliceOrVolume);
            lo = range.lo;
            hi = range.hi;
        }

        this.range = { lo, hi };
        updateLegendUI(this.variable, lo, hi, dataArray?.units || '');

        // Recolor volume only when new data is supplied
        this.applyVolumeColors();
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
        const lats = is3D ? (vals[0]?.length || 0) : vals.length;
        const lons = is3D ? (vals[0]?.[0]?.length || 0) : (vals[0]?.length || 0);
        if (!lats || !lons) return;
        
        let volLo = this.range.lo;
        let volHi = this.range.hi;
        if (is3D) {
            const volRange = calculatePercentileRange(vals);
            volLo = volRange.lo;
            volHi = volRange.hi;
        }
        
        const variable = this.variable;
        const depthLevels = this.currentData.metadata?.depth_levels;

        this.water.recolorCells(c => {
            const j = Math.floor(((c.lat - bounds[2]) / dLat) * lats);
            const i = Math.floor(((c.lon - bounds[0]) / dLon) * lons);
            
            if (j < 0 || j >= lats || i < 0 || i >= lons) return null;
            
            let d = 0;
            if (is3D && depthLevels) {
                d = findDepthIndex(depthLevels, c.depthM);
            }
            
            const val = is3D ? vals[d]?.[j]?.[i] : vals[j]?.[i];
            if (val == null || isNaN(val)) return null;
            
            const color = sampleColor(variable, val, volLo, volHi);
            _reusableColor.setRGB(color.r, color.g, color.b);
            return _reusableColor;
        });
    }

    applyVerticalSlicePlane(sLat, sLon, eLat, eLon, transectData = null) {
        this.customVerticalCoords = { sLat, sLon, eLat, eLon, transectData };
        this.updateSliceTexture(0, 'vertical_custom');
    }

    updateSliceTexture(depthM, mode = 'slice') {
        if (!this.currentData && !(this.customVerticalCoords && this.customVerticalCoords.transectData)) {
            if (this.sliceMesh) this.sliceMesh.visible = false;
            if (this.verticalSliceMesh) this.verticalSliceMesh.visible = false;
            if (this.water) this.water.setDataTexture(null, 0.0);
            return;
        }

        if (mode === 'volume') {
            if (this.sliceMesh) this.sliceMesh.visible = false;
            if (this.verticalSliceMesh) this.verticalSliceMesh.visible = false;

            // Keep the selected scientific field on the visible ocean surface while
            // retaining the volumetric cell coloring underneath. Previously volume
            // mode cleared the data texture, so the surface fell back to a static,
            // temperature-only base color and did not react to timeline changes.
            const depthLevels = this.currentData?.metadata?.depth_levels;
            const surfaceIndex = findDepthIndex(depthLevels, 0);
            const surface2d = extractSlice2D(this.currentData, surfaceIndex);
            const surfaceTexture = surface2d
                ? createDataTexture2D(
                    { values: surface2d },
                    this.variable,
                    this.range.lo,
                    this.range.hi
                  )
                : null;

            if (this.water) {
                this.water.setDataTexture(surfaceTexture, surfaceTexture ? 1.0 : 0.0);
                this.water.setOpacity(0.35);
            }
            return;
        }
        
        if (mode === 'vertical' || mode === 'vertical_custom') {
            if (this.sliceMesh) this.sliceMesh.visible = false;
            if (this.verticalSliceMesh) this.verticalSliceMesh.visible = true;
            if (this.water) this.water.setDataTexture(null, 0.0);
            
            import('./verticalSlice.js').then(module => {
                const dataSource = (this.customVerticalCoords && this.customVerticalCoords.transectData)
                    ? this.customVerticalCoords.transectData
                    : this.currentData;
                const texture = module.createVerticalSliceTexture(
                    dataSource,
                    this.variable,
                    this.range.lo,
                    this.range.hi,
                    this.customVerticalCoords,
                    this.water.bounds
                );
                
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
                    const cx = this._centerX || 0;
                    const cz = this._centerZ || 0;
                    const widthX = this.water.widthX || 100;
                    const widthZ = this.water.widthZ || 100;
                    const angle = Math.atan2(widthZ, widthX);
                    this.verticalSliceMesh.position.set(cx, 0, cz);
                    this.verticalSliceMesh.scale.set(1, 1, 1);
                    this.verticalSliceMesh.rotation.set(0, -angle, 0);
                }

                if (texture && this.verticalSliceMesh && this.verticalSliceMesh.material) {
                    if (this.verticalSliceMesh.material.uniforms) {
                        if (this.verticalSliceMesh.material.uniforms.map.value) {
                            this.verticalSliceMesh.material.uniforms.map.value.dispose();
                        }
                        this.verticalSliceMesh.material.uniforms.map.value = texture;
                        this.verticalSliceMesh.material.uniforms.uHasBathyTex.value = false;
                    }
                }
            });
            return;
        }
        
        // Horizontal slice mode
        const isSurface = (depthM == null || Math.abs(depthM) < 1);

        let slice2d = null;
        if (this.currentData.metadata && this.currentData.metadata.depth_levels) {
            const depths = this.currentData.metadata.depth_levels;
            const idx = findDepthIndex(depths, depthM);
            slice2d = extractSlice2D(this.currentData, idx);
        } else {
            slice2d = extractSlice2D(this.currentData, 0);
        }
        
        const tempFakeArray = { values: slice2d };
        const texture = createDataTexture2D(tempFakeArray, this.variable, this.range.lo, this.range.hi);
        
        if (isSurface) {
            // Apply directly onto realistic 3D animated water surface shader — avoids double layer / reflection artifacts
            if (this.sliceMesh) this.sliceMesh.visible = false;
            if (this.verticalSliceMesh) this.verticalSliceMesh.visible = false;
            if (this.water) {
                this.water.setDataTexture(texture, 1.0);
            }
        } else {
            // Subsurface depth slice: position underwater mesh at actual depth
            if (this.water) {
                this.water.setDataTexture(null, 0.0);
            }
            if (this.sliceMesh) this.sliceMesh.visible = true;
            if (this.verticalSliceMesh) this.verticalSliceMesh.visible = false;

            if (texture && this.sliceMesh && this.sliceMesh.material) {
                if (this.sliceMesh.material.uniforms) {
                    if (this.sliceMesh.material.uniforms.map.value) {
                        this.sliceMesh.material.uniforms.map.value.dispose();
                    }
                    this.sliceMesh.material.uniforms.map.value = texture;
                    if (this.water.bathyTex && !this.sliceMesh.material.uniforms.uHasBathyTex.value) {
                        this.sliceMesh.material.uniforms.uBathyTex.value = this.water.bathyTex;
                        this.sliceMesh.material.uniforms.uHasBathyTex.value = true;
                    }
                }
            }
            
            const yPos = this.sceneManager.depthY(depthM);
            if (this.sliceMesh) {
                this.sliceMesh.position.set(this._centerX || 0, yPos, this._centerZ || 0);
            }
        }
    }

    sliceAtDepth(depthM, mode = 'slice') {
        this.updateSliceTexture(depthM, mode);
    }

    dispose() {
        if (this.sliceMesh) {
            this.sliceMesh.geometry?.dispose();
            if (this.sliceMesh.material?.uniforms?.map?.value) {
                this.sliceMesh.material.uniforms.map.value.dispose();
            }
            this.sliceMesh.material?.dispose();
            this.water.group.remove(this.sliceMesh);
            this.sliceMesh = null;
        }
        if (this.verticalSliceMesh) {
            this.verticalSliceMesh.geometry?.dispose();
            if (this.verticalSliceMesh.material?.uniforms?.map?.value) {
                this.verticalSliceMesh.material.uniforms.map.value.dispose();
            }
            this.verticalSliceMesh.material?.dispose();
            this.water.group.remove(this.verticalSliceMesh);
            this.verticalSliceMesh = null;
        }
    }
}
