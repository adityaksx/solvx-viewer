// SolvX — Main Application Orchestrator
// Coordinates 2D World Map (MapLibre GL JS) + 3D Ocean Volume (Three.js),
// Real Marine Regions EEZ, Natural Earth Minor Islands,
// Dynamic Multi-Resolution Timeline, 9 Layer Toggles, and Provenance Reporting.

import * as THREE from 'three';
import { ApiClient } from './api/apiClient.js';
import { WorldMap2D } from './map/worldMap2D.js';
import { RegionDrawer } from './map/regionDrawing.js';

import { OceanScene } from './scene/oceanScene.js';
import { buildLand, buildIslands } from './scene/land.js';
import { buildCoastline, buildEEZ } from './scene/coastline.js';
import { buildSeabed } from './scene/seabed.js';
import { buildVegetation } from './scene/vegetation.js';
import { DynamicWater } from './scene/water.js';

import { ScalarVisualizer } from './visualization/scalar.js';
import { buildCurrentVectors } from './visualization/currents.js';
import { CurrentParticles } from './visualization/particles.js';
import { DepthControl } from './controls/depthControl.js';
import { VariableControl } from './controls/variableControl.js';
import { TimelineControl } from './controls/timelineControl.js';
import { OpacityControl } from './controls/opacityControl.js';

class SolvXApp {
    constructor() {
        this.currentMode = '3d'; // 'map' or '3d'
        this.currentBBox = {
            min_lon: 84.10,
            max_lon: 93.00,
            min_lat: 16.07,
            max_lat: 23.52
        };

        this.worldMap = null;
        this.regionDrawer = null;

        this.scene = null;
        this.water = null;
        this.tempViz = null;
        this.anomalyViz = null;
        this.hazardUI = null;
        this.salViz = null;
        this.currentVectorsGroup = null;
        this.currentParticles = null;
        this.argoMarkersGroup = null;

        this.varControl = null;
        this.depthControl = null;
        this.timelineControl = null;
        this.opacityControl = null;

        this.catalog = [];
        this.activeProvider = 'auto';
        this.activeVar = 'ocean_temperature';
        this.activeDepth = 0;
        this.activeDepthMode = 'volume';
        this.activeTime = null;
        this.activeTimeMeta = null;

        this.lastOceanData = null;
        this.lastBathyData = null;
        this.currentGrid = null;
        this.currentGeo = null;
        this.currentBathy = null;
        this.currentEEZ = null;
        this.currentVariableMeta = null;

        // Layer visibility state
        this.layerState = {
            land: true,
            coastline: true,
            islands: true,
            eez: true,
            seabed: true,
            water: true,
            scientific: true,
            currents: true,
            particles: true
        };
    }

    async init() {
        this.status('Initializing SolvX 3D Ocean Explorer…', 'busy');

        // 1. Initialize Interactive 2D World Map
        const mapContainer = document.getElementById('mapContainer');
        if (mapContainer && window.maplibregl) {
            try {
                this.worldMap = new WorldMap2D('mapContainer', {
                    initialBBox: this.currentBBox
                });
                await this.worldMap.init();

                this.regionDrawer = new RegionDrawer(this.worldMap, {
                    onExplore: (bbox) => {
                        this.loadRegion(bbox);
                        this.setViewMode('3d');
                    }
                });
            } catch (e) {
                console.warn('[SolvXApp] 2D Map initialization warning:', e);
            }
        }

        // Setup UI View Switchers and Navigation
        this.setupNavigation();

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
            onModeChange: (mode, depthM) => this.onDepthModeChange(mode, depthM),
            onVerticalSlice: (slat, slon, elat, elon) => this.applyVerticalSlice(slat, slon, elat, elon),
            onClearVerticalSlice: () => this.clearVerticalSlice()
        });

        this.timelineControl = new TimelineControl({
            onTimeChange: (idx, timeIso, meta) => this.onTimeChange(idx, timeIso, meta)
        });

        this.opacityControl = new OpacityControl({
            onExaggerationChange: (ex) => {
                this.scene.setExaggeration(ex);
                this.rebuildTerrain();
            }
        });

        // Setup Layer Visibility Checkboxes
        this.setupLayerToggles();

        // Register animation loop callbacks
        this.scene.onUpdate((timeMs) => {
            this.water?.update(timeMs);
            this.currentParticles?.update(0.016);
        });

        // 4. Load initial region (Bay of Bengal)
        await this.loadRegion(this.currentBBox);

        // Hide loading screen
        document.getElementById('loading')?.classList.add('hidden');
        this.status('Ready to explore');
    }

    setupNavigation() {
        const switchBtn = document.getElementById('toggleMapBtn');
        const mapView = document.getElementById('mapView');
        const sceneView = document.getElementById('sceneView');

        const setViewMode = (mode) => {
            this.currentMode = mode;
            if (mode === 'map') {
                mapView?.classList.remove('hidden');
                sceneView?.classList.add('hidden');
                if (switchBtn) {
                    switchBtn.innerHTML = `
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                      <span>3D OCEAN SCENE</span>`;
                }
                this.worldMap?.resize();
            } else {
                mapView?.classList.add('hidden');
                sceneView?.classList.remove('hidden');
                if (switchBtn) {
                    switchBtn.innerHTML = `
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>
                      <span>2D WORLD MAP</span>`;
                }
                this.scene?.onResize();
            }
        };
        this.setViewMode = setViewMode;

        switchBtn?.addEventListener('click', () => {
            setViewMode(this.currentMode === 'map' ? '3d' : 'map');
        });

        document.getElementById('exploreRegionBtn')?.addEventListener('click', () => {
            const bbox = this.regionDrawer?.currentBBox || this.currentBBox;
            this.loadRegion(bbox);
            setViewMode('3d');
        });

        // Provider Selector Controls
        const provSelect = document.getElementById('providerSelect_REMOVED');
        const mapProvSelect = document.getElementById('mapProviderSelect_REMOVED');

        const onProviderSelect = async (val) => {
            if (this.activeProvider === val) return;
            this.activeProvider = val;
            if (provSelect) provSelect.value = val;
            if (mapProvSelect) mapProvSelect.value = val;
            this.status(`Switching provider to ${val.toUpperCase()}…`, 'busy');
            try {
                // If selected provider does not support the currently active variable, switch to 'ocean_temperature'
                if (['copernicus', 'noaa', 'hycom'].includes(val)) {
                    const supported = ['ocean_temperature', 'salinity', 'currents', 'sea_surface_height'];
                    if (!supported.includes(this.activeVar)) {
                        this.activeVar = 'ocean_temperature';
                        this.varControl?.setActive('ocean_temperature');
                    }
                }
                await this.loadActiveVariable();
                this.updateProvenanceUI();
                this.status(`Active provider: ${this.lastOceanData?.provider || val.toUpperCase()}`);
            } catch (err) {
                console.error('Failed switching provider:', err);
                this.timelineControl?.pause();
                this.status(`Provider error: ${err.message}`, 'error');
            }
        };

        provSelect?.addEventListener('change', (e) => onProviderSelect(e.target.value));
        mapProvSelect?.addEventListener('change', (e) => onProviderSelect(e.target.value));

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

    setupLayerToggles() {
        const toggles = [
            { id: 'layerLand', layer: 'land' },
            { id: 'layerCoastline', layer: 'coastline' },
            { id: 'layerIslands', layer: 'islands' },
            { id: 'layerEEZ', layer: 'eez' },
            { id: 'layerSeabed', layer: 'seabed' },
            { id: 'layerWater', layer: 'water' },
            { id: 'layerScientific', layer: 'scientific' },
            { id: 'layerCurrents', layer: 'currents' },
            { id: 'layerParticles', layer: 'particles' }
        ];

        toggles.forEach(({ id, layer }) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', (e) => {
                const checked = e.target.checked;
                this.layerState[layer] = checked;
                this.applyLayerVisibility(layer, checked);
            });
        });
    }

    applyLayerVisibility(layer, visible) {
        if (layer === 'water') {
            if (this.water?.surfaceMesh) this.water.surfaceMesh.visible = visible;
        } else if (layer === 'scientific') {
            if (this.water?.instancedVolume) this.water.instancedVolume.visible = visible;
        } else {
            this.scene.setLayerVisibility(layer, visible);
        }
    }

    async loadRegion(bbox) {
        this.currentBBox = bbox;
        this.status('Loading geographic & ocean data…', 'busy');

        try {
            // Parallel fetch of catalog, geography, bathymetry, eez, and observations
            const [catalogData, geoData, bathyData, eezData, argoData] = await Promise.all([
                ApiClient.getDataVariables().catch(() => ({ variables: [] })),
                ApiClient.getDataGeometry(bbox),
                ApiClient.getDataBathymetry(bbox, 'medium').catch(err => {
                    console.warn('Bathymetry unavailable for region, using fallback:', err);
                    return { bounds: [bbox.min_lon, bbox.max_lon, bbox.min_lat, bbox.max_lat], terrain: null, maxDepthKm: 3.5 };
                }),
                ApiClient.getDataEEZ(bbox).catch(() => ({ features: [], lines3d: [] })),
                ApiClient.getDataObservations(bbox).catch(() => ({ observations: [] }))
            ]);

            this.catalog = catalogData.variables || [];
            this.currentGeo = geoData;
            this.currentBathy = bathyData;
            this.lastBathyData = bathyData;
            this.currentEEZ = eezData;

            this.varControl.setCatalog(this.catalog);

            // Discover and set timeline for the active variable
            await this.timelineControl.loadTimelineForVariable(this.activeVar, bbox);
            this.activeTime = this.timelineControl.getCurrentTimestamp();

            const maxD = ((bathyData?.maxDepthKm) || (bathyData?.terrain?.maxDepthKm) || 3.5) * 1000;
            this.depthControl.setMaxDepth(maxD);

            // Assemble 3D Scene
            this.assemble3DScene(geoData, bathyData, eezData, argoData.observations || []);

            // Load scientific layer
            await this.loadActiveVariable();

            // Update Provenance Panel
            this.updateProvenanceUI();

            this.status('3D ocean chunk ready');
        } catch (e) {
            console.error('Failed to load region:', e);
            this.status(`Load failed · ${e.message}`, 'error');
        }
    }

    assemble3DScene(geography, bathymetry, eezData, observations) {
        this.scene.clearScene();

        // 1. 3D Mainland
        const landMesh = buildLand(geography, this.scene);
        this.scene.setLayer('land', landMesh);

        // 2. Coastline Shoreline Vectors
        const coastMesh = buildCoastline(geography);
        this.scene.setLayer('coastline', coastMesh);

        // 3. Minor Offshore Islands
        const islandMesh = buildIslands(geography, this.scene);
        this.scene.setLayer('islands', islandMesh);

        // 4. Real Maritime EEZ Boundaries (Marine Regions v12)
        const eezMesh = buildEEZ(geography, eezData);
        this.scene.setLayer('eez', eezMesh);

        // 5. Bathymetric Seabed
        const seabedMesh = buildSeabed(bathymetry, this.scene);
        if (seabedMesh) this.scene.setLayer('seabed', seabedMesh);

        // 6. Procedural Seabed Vegetation & Rocks
        const vegMesh = buildVegetation(bathymetry, this.scene);
        if (vegMesh) this.scene.root.add(vegMesh);

        // 7. Dynamic Ocean Water & Volumetric Column
        this.water = new DynamicWater(bathymetry, this.scene);
        this.scene.setLayer('water', this.water.group);

        // 8. In-Situ Argo Float Markers
        this.buildArgoMarkers(observations, bathymetry.bounds || [this.currentBBox.min_lon, this.currentBBox.max_lon, this.currentBBox.min_lat, this.currentBBox.max_lat]);

        // Initialize visualizers
        this.scalarViz = new ScalarVisualizer(this.water);
        this.initMLControls();

        // Apply layer toggles according to user checkbox settings
        for (const [layer, visible] of Object.entries(this.layerState)) {
            this.applyLayerVisibility(layer, visible);
        }

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
            this.assemble3DScene(this.currentGeo, this.currentBathy, this.currentEEZ, []);
            this.loadActiveVariable();
        }
    }

    async setVariable(varId) {
        this.activeVar = varId;
        this.status(`Loading ${varId}…`, 'busy');
        await this.timelineControl.loadTimelineForVariable(varId, this.currentBBox);
        this.activeTime = this.timelineControl.getCurrentTimestamp();
        await this.loadActiveVariable();
        this.updateProvenanceUI();
        this.status('Ready');
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

        try {
            if (this.activeVar === 'currents') {
                await this.loadCurrents();
            } else {
                const requestParams = {
                    provider: this.activeProvider,
                    variable: this.activeVar,
                    bbox: this.currentBBox,
                    time: this.activeTime
                };
                if (this.activeDepthMode === 'slice') {
                    requestParams.depth = this.activeDepth;
                }
                const data = await ApiClient.getOceanVariable(requestParams);
                this.lastOceanData = data;
                this.scalarViz?.apply(this.activeVar, data, this.activeDepth, this.activeDepthMode);
            }
        } catch (e) {
            console.warn(`[SolvXApp] Failed to load variable '${this.activeVar}' with provider '${this.activeProvider}':`, e);
            this.timelineControl?.pause();
            this.status(`Provider error (${this.activeProvider.toUpperCase()}): ${e.message}`, 'error');
            this.scalarViz?.apply(this.activeVar, null, this.activeDepth, this.activeDepthMode);
        }

        this.applyLayerVisibility('scientific', this.layerState.scientific);
        this.applyLayerVisibility('currents', this.layerState.currents);
        this.applyLayerVisibility('particles', this.layerState.particles);
        this.updateProvenanceUI();
    }

    async loadCurrents() {
        try {
            const data = await ApiClient.getOceanVariable({
                provider: this.activeProvider,
                variable: 'currents',
                bbox: this.currentBBox,
                time: this.activeTime,
                stride: 3
            });
            this.lastOceanData = data;
            this.currentGrid = data;
            const bounds = this.currentBathy?.bounds || [this.currentBBox.min_lon, this.currentBBox.max_lon, this.currentBBox.min_lat, this.currentBBox.max_lat];

            // Build 3D vector arrows
            this.currentVectorsGroup = buildCurrentVectors(data, this.scene, bounds);
            this.scene.setLayer('currents', this.currentVectorsGroup);

            // Build animated particles
            this.currentParticles = new CurrentParticles(data, bounds, { count: 600 });
            this.scene.setLayer('particles', this.currentParticles.group);
            
            // Update legend for currents
            import('./visualization/colorScale.js').then(module => {
                module.updateLegendUI('currents', 0.0, 1.5, 'm/s');
            });
        } catch (e) {
            console.warn(`[SolvXApp] Failed to load currents with provider '${this.activeProvider}':`, e);
            throw e;
        }
    }


    applyVerticalSlice(sLat, sLon, eLat, eLon) {
        this.activeDepthMode = 'vertical_custom';
        this.verticalSliceCoords = {sLat, sLon, eLat, eLon};
        if (this.scalarViz) {
            this.scalarViz.applyVerticalSlicePlane(sLat, sLon, eLat, eLon);
        }
    }

    clearVerticalSlice() {
        this.activeDepthMode = 'volume';
        // restore depth control UI mode if we want, but simple enough to just call mode change
        this.onDepthModeChange('volume', this.activeDepth);
    }

    onDepthChange(depthM) {
        this.activeDepth = depthM;
        if (this.activeVar !== 'currents') {
            this.scalarViz?.sliceAtDepth(depthM, this.activeDepthMode);
        }
        this.updateProvenanceUI();
    }

    onDepthModeChange(mode, depthM) {
        this.activeDepthMode = mode;
        this.activeDepth = depthM;
        if (mode === 'volume' || mode === 'vertical') {
            this.loadActiveVariable();
        } else {
            this.onDepthChange(depthM);
        }
        this.updateProvenanceUI();
    }

    async onTimeChange(idx, timeIso, meta) {
        
        this.activeTime = timeIso;
        this.activeTimeMeta = meta;
        // Reload data for ALL variables when timeline changes
        await this.loadActiveVariable();
        this.updateProvenanceUI();
    }

    updateProvenanceUI() {
        // No-op, provenance panel removed.
    }
    
    updateHazardUI(hazardData) {
        const statusEl = document.getElementById('hazardStatus');
        const listEl = document.getElementById('hazardEventsList');
        if (!statusEl || !listEl) return;
        
        if (!hazardData || !hazardData.hazards || hazardData.hazards.length === 0) {
            statusEl.innerHTML = `STATUS<br><span style="font-size: 16px; color: #00aa55;">Conditions Normal</span>`;
            listEl.innerHTML = `<div style="color: #557799; font-size: 12px;">Data:<br>No active warnings detected</div>`;
            return;
        }
        
        statusEl.innerHTML = `STATUS<br><span style="font-size: 16px; color: #cc0000;">Hazard Detected</span>`;
        let html = '';
        for (const h of hazardData.hazards) {
            html += `
            <div style="background: rgba(200, 0, 0, 0.05); border-left: 3px solid #cc0000; padding: 10px; font-size: 11px; color: #003366; border-radius: 0 4px 4px 0;">
                <b style="color: #cc0000;">${h.type ? h.type.replace(/_/g, ' ').toUpperCase() : 'UNKNOWN HAZARD'}</b><br>
                <div style="margin-top: 4px; line-height: 1.4;">
                    Location: ${h.location || 'N/A'}<br>
                    Severity: <span style="font-weight:bold;">${h.severity || 'N/A'}</span><br>
                    Time: ${h.time || 'N/A'}<br>
                    Value: ${h.value || 'N/A'}<br>
                </div>
            </div>`;
        }
        listEl.innerHTML = html;
    }
async inspectPoint(cell) {
        if (!this.markerMesh) {
            const geom = new THREE.TorusGeometry(0.5, 0.1, 16, 32);
            geom.rotateX(Math.PI / 2);
            const mat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.8 });
            this.markerMesh = new THREE.Mesh(geom, mat);
            const pinGeom = new THREE.CylinderGeometry(0, 0.2, 1, 16);
            pinGeom.translate(0, 0.5, 0);
            const pinMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
            const pin = new THREE.Mesh(pinGeom, pinMat);
            this.markerMesh.add(pin);
            this.scene.root.add(this.markerMesh);
        }
        
        const midLat = (this.currentBBox.min_lat + this.currentBBox.max_lat) / 2;
        const midLon = (this.currentBBox.min_lon + this.currentBBox.max_lon) / 2;
        const posX = (cell.lat - midLat) * 111.32;
        const posZ = (cell.lon - midLon) * 111.32 * Math.cos(midLat * Math.PI / 180);
        
        this.markerMesh.position.set(posX, 1.0, posZ); // slightly above water

        this.status('Inspecting ocean point...', 'busy');

        try {
            const data = await ApiClient.getPoint(cell.lat, cell.lon, this.activeTime);
            
            let popup = document.getElementById('pointPopup');
            if (!popup) {
                popup = document.createElement('div');
                popup.id = 'pointPopup';
                popup.style.position = 'absolute';
                popup.style.right = '20px';
                popup.style.bottom = '20px';
                popup.style.width = '300px';
                popup.style.background = 'rgba(15, 20, 25, 0.9)';
                popup.style.border = '1px solid #1da5d8';
                popup.style.borderRadius = '8px';
                popup.style.padding = '15px';
                popup.style.color = 'white';
                popup.style.fontFamily = 'monospace';
                popup.style.fontSize = '12px';
                popup.style.zIndex = '1000';
                popup.style.boxShadow = '0 4px 10px rgba(0,0,0,0.5)';
                document.body.appendChild(popup);
            }
            
            const vars = data.variables || {};
            const units = data.units || {};
            
            const formatVal = (v, u) => (v != null && !isNaN(v)) ? `${Number(v).toFixed(2)} ${u || ''}` : 'N/A';
            
            popup.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(0,50,100,0.1); padding-bottom: 5px; margin-bottom: 10px;">
                    <b style="color: #1da5d8;">OCEAN POINT</b>
                    <button onclick="document.getElementById('pointPopup').style.display='none'; if(window.solvx.markerMesh) window.solvx.markerMesh.visible=false;" style="background: none; border: none; color: #003366; cursor: pointer; font-size: 16px;">×</button>
                </div>
                <div style="margin-bottom: 10px;">${cell.lat.toFixed(4)}° N, ${cell.lon.toFixed(4)}° E</div>
                <div style="color: #557799; font-size: 10px; margin-bottom: 15px;">DEPTH<br><span style="color:white; font-size: 12px;">Surface / selected depth</span></div>
                
                <div style="color: #557799; font-size: 10px; margin-bottom: 5px;">OCEAN</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-bottom: 15px;">
                    <span>Temperature</span><span>${formatVal(vars.ocean_temperature, units.ocean_temperature)}</span>
                    <span>Salinity</span><span>${formatVal(vars.salinity, units.salinity)}</span>
                    <span>Sea level</span><span>${formatVal(vars.sea_surface_height || vars.sea_level_anomaly, units.sea_surface_height || units.sea_level_anomaly)}</span>
                    <span>Current speed</span><span>${formatVal(vars.current_speed || Math.sqrt(vars.current_u**2 + vars.current_v**2), 'm/s')}</span>
                    <span>Direction</span><span>${formatVal(vars.current_direction, '°')}</span>
                </div>
                
                <div style="color: #557799; font-size: 10px; margin-bottom: 5px;">ATMOSPHERE</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-bottom: 15px;">
                    <span>Air temp</span><span>${formatVal(vars.air_temperature, units.air_temperature)}</span>
                    <span>Humidity</span><span>${formatVal(vars.relative_humidity, units.relative_humidity)}</span>
                    <span>Wind speed</span><span>${formatVal(vars.wind_speed, units.wind_speed)}</span>
                    <span>Wind dir</span><span>${formatVal(vars.wind_direction, units.wind_direction)}</span>
                    <span>Pressure</span><span>${formatVal(vars.sea_level_pressure, units.sea_level_pressure)}</span>
                </div>
                
                <div style="color: #557799; font-size: 10px; margin-bottom: 5px;">TIME</div>
                <div>${new Date(this.activeTime || data.timestamp).toUTCString()}</div>
            `;
            popup.style.display = 'block';
            this.markerMesh.visible = true;

            popup.style.display = 'block';
            this.status('Point data loaded.');
        } catch (e) {
            console.error('Point inspection failed:', e);
            this.status('Point inspection failed', 'error');
        }
    }

    async inspectObservation(argo) {
        const modal = document.getElementById('obsModal');
        const title = document.getElementById('obsTitle');
        const stats = document.getElementById('obsStats');
        const body = document.getElementById('obsBody');

        if (!modal || !argo) return;
        if (title) title.textContent = `Argo Float #${argo.wmo} Sounding Profile`;
        this.status(`Comparing Argo #${argo.wmo} with model…`, 'busy');

        try {
            const cmp = await ApiClient.compareObservation(argo.id);
            if (stats) {
                stats.innerHTML = `
                    <div class="obs-stat">
                        <b>Root Mean Squared Error (RMSE)</b>
                        <span>${cmp.rmse != null ? `${cmp.rmse.toFixed(3)} °C` : '—'}</span>
                    </div>
                    <div class="obs-stat">
                        <b>Mean Model Bias</b>
                        <span>${cmp.bias != null ? `${cmp.bias.toFixed(3)} °C` : '—'}</span>
                    </div>
                `;
            }

            if (body && Array.isArray(cmp.comparison)) {
                body.innerHTML = `
                    <table class="obs-table">
                        <thead>
                            <tr>
                                <th>Depth (m)</th>
                                <th>Observed (°C)</th>
                                <th>Model (°C)</th>
                                <th>Diff (°C)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${cmp.comparison.map(row => {
                                const diff = row.diff != null ? row.diff : (row.model_temp - row.observed_temp);
                                const diffClass = diff > 0 ? 'diff-pos' : 'diff-neg';
                                return `
                                    <tr>
                                        <td>${row.depth}</td>
                                        <td>${row.observed_temp.toFixed(2)}</td>
                                        <td>${row.model_temp.toFixed(2)}</td>
                                        <td class="${diffClass}">${diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                `;
            }

            modal.classList.remove('hidden');
            this.status('Observation profile collocated');
        } catch (e) {
            this.status(`Observation comparison failed · ${e.message}`, 'error');
        }
    }

    status(msg, type = 'ready') {
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('status');
        if (text) text.textContent = msg;
        if (dot) {
            dot.className = type === 'busy' ? 'busy' : (type === 'error' ? 'error' : '');
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const app = new SolvXApp();
    window.solvx = app;
    app.init().catch(err => {
        console.error('Fatal initialization error:', err);
        const fatal = document.getElementById('fatal');
        const fatalText = document.getElementById('fatalText');
        if (fatalText) fatalText.textContent = err.message || String(err);
        fatal?.classList.add('show');
    });
});

// --- ML Hazard Early Warning Extension ---
SolvXApp.prototype.initMLControls = function() {
    this.mlMode = 'state'; // 'state' or 'anomalies'
    
    const mlBtn = document.getElementById('mlStateBtn');
    if (mlBtn) {
        mlBtn.addEventListener('click', async () => {
            if (this.mlMode === 'state') {
                this.mlMode = 'anomalies';
                mlBtn.innerHTML = '[ Mode: Anomalies & Hazard Risk ]';
                mlBtn.style.background = '#4a2f00';
                await this.refreshMLAnomalies();
            } else {
                this.mlMode = 'state';
                mlBtn.innerHTML = '[ Mode: Ocean State ]';
                mlBtn.style.background = '#0a192f';
                this.updateHazardUI({});
                // Restore standard visualization
                this.onVariableChange(this.varControl?.activeVar || 'ocean_temperature');
            }
        });
    }

    const demoBtn = document.getElementById('mlDemoBtn');
    if (demoBtn) {
        demoBtn.addEventListener('click', async () => {
            const api = new ApiClient();
            await api.post('/api/ml/demo');
            if (this.mlMode === 'state' && mlBtn) mlBtn.click();
            else await this.refreshMLAnomalies();
        });
    }
};

SolvXApp.prototype.refreshMLAnomalies = async function() {
    if (this.mlMode !== 'anomalies') return;
    const time = this.timelineControl?.currentTimeStr;
    const api = new ApiClient();
    try {
        const bbox = this.currentBBox;
        const data = await api.get('/api/ml/region', {
            min_lon: bbox.min_lon,
            max_lon: bbox.max_lon,
            min_lat: bbox.min_lat,
            max_lat: bbox.max_lat,
            time: time
        });
        this.updateHazardUI(data);
    } catch (e) {
        console.error('Failed to load anomalies:', e);
    }
};

SolvXApp.prototype.focusHazard = function(lat, lon) {
    // Basic camera fly implementation
    if (!this.scene?.camera || !this.scene?.controls) return;
    const x = lon - ((this.currentBBox.min_lon + this.currentBBox.max_lon) / 2);
    const z = lat - ((this.currentBBox.min_lat + this.currentBBox.max_lat) / 2);
    
    // Animate camera manually or just jump for prototype
    this.scene.camera.position.set(x, 15, z + 20);
    this.scene.controls.target.set(x, 0, z);
    this.scene.controls.update();
};

// Override inspectPoint to use ML Panel
const originalInspectPoint = SolvXApp.prototype.inspectPoint;
SolvXApp.prototype.inspectPoint = async function(cell) {
    // We still update the old readout if needed, or we just rely on ML panel
    if (this.mlMode === 'anomalies') {
        if (this.hazardUI) {
            this.hazardUI.inspectPoint(cell.lat, cell.lon, this.timelineControl?.currentTimeStr);
        }
    } else {
        // Run original
        await originalInspectPoint.call(this, cell);
    }
};
