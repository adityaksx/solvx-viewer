// SolvX Viewer — Main Application Orchestrator
import * as THREE from 'three';
import { ApiClient } from './api/apiClient.js';
import { WorldGlobe } from './globe/worldMap.js';
import { RegionSelector } from './globe/regionSelector.js';
import { CoordinateInput } from './globe/coordinateInput.js';

import { OceanScene } from './scene/oceanScene.js';
import { buildLand } from './scene/land.js';
import { buildCoastline } from './scene/coastline.js';
import { buildSeabed } from './scene/seabed.js';
import { buildVegetation } from './scene/vegetation.js';
import { DynamicWater } from './scene/water.js';

import { TemperatureVisualizer } from './visualization/temperature.js';
import { SalinityVisualizer } from './visualization/salinity.js';
import { buildCurrentVectors } from './visualization/currents.js';
import { CurrentParticles } from './visualization/particles.js';

import { VariableControl } from './controls/variableControl.js';
import { DepthControl } from './controls/depthControl.js';
import { TimelineControl } from './controls/timelineControl.js';
import { OpacityControl } from './controls/opacityControl.js';

class SolvXApp {
    constructor() {
        this.currentMode = '3d'; // 'globe' or '3d'
        this.currentBBox = {
            min_lon: 84.10,
            max_lon: 93.00,
            min_lat: 16.07,
            max_lat: 23.52
        };

        this.globe = null;
        this.regionSelector = null;
        this.coordInput = null;

        this.scene = null;
        this.water = null;
        this.tempViz = null;
        this.salViz = null;
        this.currentVectorsGroup = null;
        this.currentParticles = null;
        this.argoMarkersGroup = null;

        this.varControl = null;
        this.depthControl = null;
        this.timelineControl = null;
        this.opacityControl = null;

        this.catalog = [];
        this.times = [];
        this.activeVar = 'temperature';
        this.activeTime = null;
        this.currentGrid = null;
        this.currentGeo = null;
        this.currentBathy = null;
    }

    async init() {
        this.status('Initializing SolvX 3D Ocean Explorer…', 'busy');

        // Setup UI Navigation Toggles
        this.setupNavigation();

        // 1. Initialize World Globe
        const globeContainer = document.getElementById('globeContainer');
        if (globeContainer) {
            this.globe = new WorldGlobe(globeContainer, {
                initialBBox: this.currentBBox,
                onRegionSelect: (bbox) => this.onRegionSelected(bbox)
            });

            this.regionSelector = new RegionSelector({
                initialBBox: this.currentBBox,
                onSelect: (bbox) => {
                    this.globe.updateSelectionBox(bbox);
                    this.coordInput?.setValues(bbox);
                    this.globe.flyTo((bbox.min_lat + bbox.max_lat) / 2, (bbox.min_lon + bbox.max_lon) / 2);
                }
            });

            this.coordInput = new CoordinateInput({
                onSubmit: (bbox) => {
                    this.globe.updateSelectionBox(bbox);
                    this.loadRegion(bbox);
                },
                onChange: (bbox) => {
                    this.globe.updateSelectionBox(bbox);
                }
            });
            this.coordInput.setValues(this.currentBBox);
        }

        // Fetch presets
        try {
            const presetsData = await ApiClient.getPresets();
            if (presetsData?.presets) {
                this.globe?.setPresets(presetsData.presets);
                this.regionSelector?.setPresets(presetsData.presets);
            }
        } catch (e) {
            console.warn('Presets failed to load:', e);
        }

        // 2. Initialize 3D Scene
        const canvas = document.getElementById('renderCanvas');
        this.scene = new OceanScene(canvas, {
            onOceanClick: (cell) => this.inspectPoint(cell),
            onFloatClick: (argo) => this.inspectObservation(argo)
        });

        // 3. Initialize Interactive Controls
        this.varControl = new VariableControl('vars', {
            initialVariable: this.activeVar,
            onChange: (v) => this.setVariable(v)
        });

        this.depthControl = new DepthControl({
            onDepthChange: (depthM) => this.onDepthChange(depthM),
            onModeChange: (mode, depthM) => this.onDepthModeChange(mode, depthM)
        });

        this.timelineControl = new TimelineControl({
            onTimeChange: (idx, timeIso) => this.onTimeChange(idx, timeIso)
        });

        this.opacityControl = new OpacityControl({
            onExaggerationChange: (ex) => {
                this.scene.setExaggeration(ex);
                this.rebuildTerrain();
            }
        });

        // Register animation updates
        this.scene.onUpdate((timeMs) => {
            this.water?.update(timeMs);
            this.currentParticles?.update(0.016);
        });

        // 4. Load initial region (Bay of Bengal)
        await this.loadRegion(this.currentBBox);

        // Hide loading
        document.getElementById('loading')?.classList.add('hidden');
        this.status('Ready to explore');
    }

    setupNavigation() {
        const switchBtn = document.getElementById('toggleGlobeBtn');
        const globeView = document.getElementById('globeView');
        const sceneView = document.getElementById('sceneView');

        const setViewMode = (mode) => {
            this.currentMode = mode;
            if (mode === 'globe') {
                globeView?.classList.remove('hidden');
                sceneView?.classList.add('hidden');
                if (switchBtn) switchBtn.textContent = '3D OCEAN SCENE';
                this.globe?.onResize();
            } else {
                globeView?.classList.add('hidden');
                sceneView?.classList.remove('hidden');
                if (switchBtn) switchBtn.textContent = 'WORLD GLOBE';
                this.scene?.onResize();
            }
        };

        switchBtn?.addEventListener('click', () => {
            setViewMode(this.currentMode === 'globe' ? '3d' : 'globe');
        });

        document.getElementById('exploreRegionBtn')?.addEventListener('click', () => {
            const bbox = this.coordInput?.getValues() || this.currentBBox;
            this.loadRegion(bbox);
            setViewMode('3d');
        });

        // Camera Views
        document.querySelectorAll('#views button[data-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#views button[data-view]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.scene.setView(btn.dataset.view);
            });
        });

        document.getElementById('reset')?.addEventListener('click', () => this.scene.fitCamera());
        document.getElementById('fullscreen')?.addEventListener('click', () => {
            if (document.fullscreenElement) document.exitFullscreen?.();
            else document.documentElement.requestFullscreen?.();
        });

        document.getElementById('closeReadout')?.addEventListener('click', () => {
            document.getElementById('readout')?.classList.add('hidden');
        });

        document.getElementById('closeObsModal')?.addEventListener('click', () => {
            document.getElementById('obsModal')?.classList.add('hidden');
        });
    }

    onRegionSelected(bbox) {
        this.currentBBox = bbox;
        this.coordInput?.setValues(bbox);
    }

    async loadRegion(bbox) {
        this.currentBBox = bbox;
        this.status('Loading geographic & ocean data…', 'busy');

        try {
            // Parallel fetch of catalog, timeline, geography, and bathymetry
            const [catalogData, timeData, geoData, bathyData, argoData] = await Promise.all([
                ApiClient.getCatalog().catch(() => ({ variables: [] })),
                ApiClient.getTime().catch(() => ({ values: [] })),
                ApiClient.getGeography(bbox),
                ApiClient.getBathymetry(bbox),
                ApiClient.getObservations(bbox).catch(() => ({ observations: [] }))
            ]);

            this.catalog = catalogData.variables || [];
            this.times = timeData.values || [];
            this.currentGeo = geoData;
            this.currentBathy = bathyData;

            this.varControl.setCatalog(this.catalog);
            this.timelineControl.setTimes(this.times);
            this.activeTime = this.times[0] || null;

            const maxD = (bathyData.terrain?.maxDepthKm || 3.5) * 1000;
            this.depthControl.setMaxDepth(maxD);

            // Assemble 3D Scene
            this.assemble3DScene(geoData, bathyData, argoData.observations || []);

            // Load scientific layer
            await this.loadActiveVariable();

            this.status('3D ocean chunk ready');
        } catch (e) {
            console.error('Failed to load region:', e);
            this.status(`Load failed · ${e.message}`, 'error');
        }
    }

    assemble3DScene(geography, bathymetry, observations) {
        this.scene.clearScene();

        // 1. 3D Land
        const landMesh = buildLand(geography, this.scene);
        this.scene.root.add(landMesh);

        // 2. Coastline & EEZ
        const coastMesh = buildCoastline(geography);
        this.scene.root.add(coastMesh);

        // 3. Bathymetric Seabed
        const seabedMesh = buildSeabed(bathymetry, this.scene);
        if (seabedMesh) this.scene.root.add(seabedMesh);

        // 4. Procedural Seabed Vegetation & Rocks
        const vegMesh = buildVegetation(bathymetry, this.scene);
        this.scene.root.add(vegMesh);

        // 5. Dynamic Ocean Water & Volumetric Column
        this.water = new DynamicWater(bathymetry, this.scene);
        this.scene.root.add(this.water.group);

        // 6. In-Situ Argo Float Markers
        this.buildArgoMarkers(observations, bathymetry.bounds);

        // Initialize visualizers
        this.tempViz = new TemperatureVisualizer(this.water);
        this.salViz = new SalinityVisualizer(this.water);

        this.scene.fitCamera();
    }

    buildArgoMarkers(observations, bounds) {
        if (this.argoMarkersGroup) {
            this.scene.disposeObject(this.argoMarkersGroup);
        }
        this.argoMarkersGroup = new THREE.Group();

        const midLat = (bounds[2] + bounds[3]) / 2;
        const midLon = (bounds[0] + bounds[1]) / 2;
        const klat = 111.32;
        const klon = 111.32 * Math.cos((midLat * Math.PI) / 180);

        observations.forEach(obs => {
            const x = (obs.latitude - midLat) * klat;
            const z = (obs.longitude - midLon) * klon;
            const y = 1.2;

            // Float beacon sphere
            const geom = new THREE.SphereGeometry(2.0, 16, 16);
            const mat = new THREE.MeshStandardMaterial({
                color: 0x38bdf8,
                emissive: 0x0284c7,
                emissiveIntensity: 0.6
            });
            const marker = new THREE.Mesh(geom, mat);
            marker.position.set(x, y, z);
            marker.userData = { isArgoFloat: true, float: obs };

            // Vertical sounding wire down to 1000m
            const lineGeom = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, this.scene.depthY(1000), 0)
            ]);
            const lineMat = new THREE.LineDashedMaterial({
                color: 0x38bdf8,
                dashSize: 2,
                gapSize: 1.5,
                opacity: 0.7,
                transparent: true
            });
            const wire = new THREE.Line(lineGeom, lineMat);
            wire.computeLineDistances();
            marker.add(wire);

            this.argoMarkersGroup.add(marker);
        });

        this.scene.root.add(this.argoMarkersGroup);
    }

    rebuildTerrain() {
        if (this.currentGeo && this.currentBathy) {
            this.assemble3DScene(this.currentGeo, this.currentBathy, []);
            this.loadActiveVariable();
        }
    }

    async setVariable(varId) {
        this.activeVar = varId;
        await this.loadActiveVariable();
    }

    async loadActiveVariable() {
        if (this.currentVectorsGroup) {
            this.scene.disposeObject(this.currentVectorsGroup);
            this.currentVectorsGroup = null;
        }
        if (this.currentParticles) {
            this.scene.disposeObject(this.currentParticles.group);
            this.currentParticles = null;
        }

        if (this.activeVar === 'temperature') {
            this.tempViz?.apply();
        } else if (this.activeVar === 'salinity') {
            this.salViz?.apply();
        } else if (this.activeVar === 'currents') {
            await this.loadCurrents();
        } else {
            this.tempViz?.apply();
        }
    }

    async loadCurrents() {
        try {
            const data = await ApiClient.getCurrentGrid(this.activeTime, null, 3);
            this.currentGrid = data;
            const bounds = this.currentBathy?.bounds || [84.1, 93.0, 16.0, 23.5];

            // Build 3D vector arrows
            this.currentVectorsGroup = buildCurrentVectors(data, this.scene, bounds);
            this.scene.root.add(this.currentVectorsGroup);

            // Build animated particles
            this.currentParticles = new CurrentParticles(data, bounds, { count: 600 });
            this.scene.root.add(this.currentParticles.group);
        } catch (e) {
            console.warn('Failed to load currents:', e);
        }
    }

    onDepthChange(depthM) {
        if (this.activeVar === 'temperature') {
            this.tempViz?.sliceAtDepth(depthM);
        } else if (this.activeVar === 'salinity') {
            this.salViz?.sliceAtDepth(depthM);
        }
    }

    onDepthModeChange(mode, depthM) {
        if (mode === 'volume') {
            this.loadActiveVariable();
        } else {
            this.onDepthChange(depthM);
        }
    }

    async onTimeChange(idx, timeIso) {
        this.activeTime = timeIso;
        if (this.activeVar === 'currents') {
            await this.loadCurrents();
        }
    }

    async inspectPoint(cell) {
        const readout = document.getElementById('readout');
        const coords = document.getElementById('coords');
        const grid = document.getElementById('readoutGrid');
        const timeEl = document.getElementById('readoutTime');

        if (coords) coords.textContent = `${cell.lat.toFixed(4)}° N · ${cell.lon.toFixed(4)}° E`;
        this.status('Inspecting ocean point…', 'busy');

        try {
            const data = await ApiClient.getPoint(cell.lat, cell.lon, this.activeTime);
            const map = {};
            if (Array.isArray(data?.values)) {
                for (const item of data.values) if (item?.id) map[item.id] = item;
            }

            const tempVal = map['temperature']?.value;
            const salVal = map['salinity']?.value;
            const curVal = map['currents']?.speed ?? (map['currents']?.value ? Math.hypot(map['currents'].value.uo || 0, map['currents'].value.vo || 0) : null);
            const slVal = map['sea_level']?.value;
            const anomVal = map['temperature_anomaly']?.value;
            const chVal = map['chlorophyll']?.value;

            const rows = [
                ['Temperature', tempVal, '°C'],
                ['Salinity', salVal, 'PSU'],
                ['Current speed', curVal, 'm s⁻¹'],
                ['Sea level', slVal, 'm'],
                ['SST anomaly', anomVal, '°C'],
                ['Chlorophyll', chVal, 'mg m⁻³']
            ];

            if (grid) {
                grid.innerHTML = rows.map(r => `
                    <div class="rval">
                        <b>${r[0]}</b>
                        <span>${r[1] != null && isFinite(r[1]) ? `${Number(r[1]).toFixed(Math.abs(Number(r[1])) < 1 ? 4 : 2)} ${r[2]}` : '—'}</span>
                    </div>
                `).join('');
            }

            if (timeEl) timeEl.textContent = data.time || this.activeTime || 'Timestep 1';
            readout?.classList.remove('hidden');
            this.status('Point inspected');
        } catch (e) {
            this.status(`Point inspection failed · ${e.message}`, 'error');
        }
    }

    async inspectObservation(argo) {
        const modal = document.getElementById('obsModal');
        const title = document.getElementById('obsTitle');
        const body = document.getElementById('obsBody');
        const stats = document.getElementById('obsStats');

        if (title) title.textContent = `Argo Float #${argo.wmo} (${argo.platform})`;
        modal?.classList.remove('hidden');

        try {
            const comp = await ApiClient.compareObservation(argo.id);
            if (stats) {
                stats.innerHTML = `
                    <div class="obs-stat"><b>Location</b><span>${argo.latitude}° N, ${argo.longitude}° E</span></div>
                    <div class="obs-stat"><b>Cycles</b><span>${argo.cycles} soundings</span></div>
                    <div class="obs-stat"><b>Model RMSE</b><span>${comp.rmse != null ? `${comp.rmse} °C` : '—'}</span></div>
                    <div class="obs-stat"><b>Mean Bias</b><span>${comp.bias != null ? `${comp.bias} °C` : '—'}</span></div>
                `;
            }

            if (body) {
                const rows = (comp.comparison || []).map(r => `
                    <tr>
                        <td>${r.depth} m</td>
                        <td>${r.observed} °C</td>
                        <td>${r.model} °C</td>
                        <td class="${r.diff > 0 ? 'diff-pos' : 'diff-neg'}">${r.diff > 0 ? '+' : ''}${r.diff} °C</td>
                    </tr>
                `).join('');

                body.innerHTML = `
                    <table class="obs-table">
                        <thead>
                            <tr>
                                <th>Depth</th>
                                <th>Observed (Argo)</th>
                                <th>Model Sim</th>
                                <th>Difference (Anomaly)</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                `;
            }
        } catch (e) {
            if (body) body.innerHTML = `<p class="error">Failed to load profile comparison: ${e.message}</p>`;
        }
    }

    status(text, type = 'ok') {
        const statusText = document.getElementById('status');
        const statusDot = document.getElementById('statusDot');
        if (statusText) statusText.textContent = text;
        if (statusDot) {
            statusDot.className = type === 'error' ? 'error' : type === 'busy' ? 'busy' : '';
        }
    }
}

// Start application
window.addEventListener('DOMContentLoaded', () => {
    const app = new SolvXApp();
    app.init().catch(err => {
        console.error('Fatal initialization error:', err);
        document.getElementById('loading')?.classList.add('hidden');
        const fatal = document.getElementById('fatal');
        const fatalText = document.getElementById('fatalText');
        if (fatalText) fatalText.textContent = err.message || String(err);
        fatal?.classList.add('show');
    });
});
