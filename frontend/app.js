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
import { SelectionContext } from './context/selectionContext.js';
import { themeManager } from './context/themeManager.js';
import { ViewerController } from './viewer/viewerController.js';
import { ProfileViewer } from './profiles/profileViewer.js';


class SolvXApp {
    constructor() {
        this.viewerController = new ViewerController(this);
        this.profileViewer = new ProfileViewer(this);
        this.currentMode = '3d'; // 'map' or '3d'
        const ctxArea = SelectionContext.getArea();
        this.currentBBox = ctxArea?.bbox ? { ...ctxArea.bbox } : {
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
            particles: true,
            observations: true
        };

        // Cache for batch ocean variables (keyed by timestamp)
        this.bundleCache = {};
        this.currentBundle = null;
        this._bundleReqSeq = 0;
        this._downloadedRegions = new Set();
    }

    async init() {
        this.status('Initializing SolvX 3D Ocean Explorer…', 'busy');

        // Setup UI View Switchers and Navigation
        this.setupNavigation();

        // 2. Initialize 3D Scene
        const canvas = document.getElementById('renderCanvas');
        this.scene = new OceanScene(canvas, {
            onOceanClick: (cell) => this.inspectPoint(cell),
            onFloatClick: (argo) => this.inspectObservation(argo),
            onAnomalyClick: (regionId) => this.inspectAnomalyRegion(regionId)
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
            onClearVerticalSlice: () => this.clearVerticalSlice(),
            getBBox: () => this.currentBBox
        });

        try {
            const depthData = await ApiClient.getOceanDepths(this.activeVar);
            if (depthData?.depths) {
                this.depthControl.setDepthLevels(depthData.depths);
            }
        } catch (e) {
            console.warn('Initial depths fetch error:', e);
        }

        this.timelineControl = new TimelineControl({
            onTimeChange: (idx, timeIso, meta) => this.onTimeChange(idx, timeIso, meta)
        });

        this.opacityControl = new OpacityControl({
            onExaggerationChange: (ex) => {
                this.setExaggeration(ex);
            }
        });

        this.setupLayerToggles();

        this.scene.onUpdate((timeMs) => {
            this.currentParticles?.update(0.016);
        });

        await this.loadRegion(this.currentBBox);

        // Synchronize theme with 3D scene and 2D map
        themeManager.init();
        const currentTheme = themeManager.getTheme();
        this.scene?.setTheme(currentTheme);
        this.worldMap?.setTheme(currentTheme);
        themeManager.subscribe(({ theme }) => {
            this.scene?.setTheme(theme);
            this.worldMap?.setTheme(theme);
        });

        // Hide loading screen
        document.getElementById('loading')?.classList.add('hidden');
        this.status('Ready to explore');
    }

    ensureMapInitialized() {
        if (this.worldMap) return;
        const mapContainer = document.getElementById('mapContainer');
        if (mapContainer && window.maplibregl) {
            try {
                const theme = themeManager.getTheme();
                const initialBasemap = theme === 'dark' ? 'osm-dark' : 'osm';
                this.worldMap = new WorldMap2D('mapContainer', {
                    initialBBox: this.currentBBox,
                    basemap: initialBasemap
                });
                this.worldMap.setTheme(theme);
                this.worldMap.init().catch(e => console.warn('[WorldMap2D] init err:', e));
                this.regionDrawer = new RegionDrawer(this.worldMap, {
                    onExplore: (bbox) => {
                        SelectionContext.setArea({ bbox });
                        this.loadRegion(bbox);
                        this.setViewMode('3d');
                    }
                });
            } catch (e) {
                console.error('[SolvXApp] 2D Map ERROR:', e);
            }
        }
    }

    setupNavigation() {
        const navViewer = document.getElementById('navViewer');
        const navMap = document.getElementById('navMap');
        const switchBtn = document.getElementById('toggleMapBtn');
        const mapView = document.getElementById('mapView');
        const sceneView = document.getElementById('sceneView');

        const setViewMode = (mode) => {
            this.currentMode = mode;
            if (mode === 'map') {
                mapView?.classList.remove('hidden');
                sceneView?.classList.add('hidden');
                navMap?.classList.add('active');
                navViewer?.classList.remove('active');
                if (switchBtn) {
                    switchBtn.innerHTML = `<span>3D OCEAN SCENE</span>`;
                }
                this.ensureMapInitialized();
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        this.worldMap?.resize();
                    }, 60);
                });
            } else {
                mapView?.classList.add('hidden');
                sceneView?.classList.remove('hidden');
                navViewer?.classList.add('active');
                navMap?.classList.remove('active');
                if (switchBtn) {
                    switchBtn.innerHTML = `<span>2D WORLD MAP</span>`;
                }
                this.scene?.onResize();
            }
        };
        this.setViewMode = setViewMode;

        navViewer?.addEventListener('click', (e) => {
            e.preventDefault();
            setViewMode('3d');
        });

        navMap?.addEventListener('click', (e) => {
            e.preventDefault();
            setViewMode('map');
        });

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('mode') === 'map') {
            setViewMode('map');
        }

        switchBtn?.addEventListener('click', () => {
            setViewMode(this.currentMode === 'map' ? '3d' : 'map');
        });

        document.getElementById('exploreRegionBtn')?.addEventListener('click', () => {
            const bbox = this.regionDrawer?.currentBBox || this.currentBBox;
            SelectionContext.setArea({ bbox });
            this.loadRegion(bbox);
            setViewMode('3d');
        });

        // Provider Selector Controls
        const provSelect = document.getElementById('providerSelect_REMOVED');
        const mapProvSelect = document.getElementById('mapProviderSelect');

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

        // Drawer Toggle Rail Handle
        const drawerToggle = document.getElementById('drawerToggle');
        const controls = document.getElementById('controls');
        drawerToggle?.addEventListener('click', () => {
            const isCollapsed = controls?.classList.toggle('collapsed');
            const arrow = drawerToggle.querySelector('.drawer-arrow');
            if (arrow) arrow.textContent = isCollapsed ? '▶' : '◀';
        });

        // Vertical Exaggeration Slider with dynamic readout & bathy scale
        const exagSlider = document.getElementById('exaggeration') || document.getElementById('exaggerationSlider');
        const exagVal = document.getElementById('exagValue') || document.getElementById('exaggerationValue');
        if (exagSlider) {
            exagSlider.addEventListener('input', (e) => {
                const v = Number(e.target.value);
                if (exagVal) exagVal.textContent = `${v}×`;
                if (this.scene) {
                    this.scene.setExaggeration(v);
                    const seabed = this.scene.layers?.seabed;
                    if (seabed) {
                        seabed.scale.set(1, v / 70.0, 1);
                    }
                }
            });
        }

        // Camera Views & Presets
        document.querySelectorAll('#views button[data-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#views button[data-view]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const view = btn.dataset.view;
                if (view === 'reset') {
                    this.scene?.fitCamera();
                } else if (view === 'underwater') {
                    this.scene?.setView('under');
                } else {
                    this.scene?.setView(view);
                }
            });
        });

        // Fullscreen Toggle
        document.getElementById('fullscreenBtn')?.addEventListener('click', () => {
            if (document.fullscreenElement) document.exitFullscreen?.();
            else document.documentElement.requestFullscreen?.();
        });

        // Close Inspector Readout
        document.getElementById('closeReadout')?.addEventListener('click', () => {
            document.getElementById('readout')?.classList.add('hidden');
            if (this.markerMesh) this.markerMesh.visible = false;
        });

        // Close In-Situ Observation Modal
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
        if (layer === 'scientific') {
            if (this.water?.instancedVolume) this.water.instancedVolume.visible = visible;
        } else if (layer === 'observations') {
            if (this.argoMarkersGroup) this.argoMarkersGroup.visible = visible;
        } else {
            this.scene.setLayerVisibility(layer, visible);
        }
    }

    updateGeoProgress(step, state, text, pct, msg) {
        const modal = document.getElementById('geoModal');
        if (modal) modal.classList.remove('hidden');

        if (step) {
            const stepEl = document.getElementById(step);
            const statusEl = document.getElementById(step.replace('step', 'status'));
            if (stepEl) {
                stepEl.classList.remove('active', 'done');
                if (state === 'active') {
                    stepEl.classList.add('active');
                    const icon = stepEl.querySelector('.geo-step-icon');
                    if (icon) icon.textContent = '◐';
                } else if (state === 'done') {
                    stepEl.classList.add('done');
                    const icon = stepEl.querySelector('.geo-step-icon');
                    if (icon) icon.textContent = '✓';
                }
            }
            if (statusEl && text) statusEl.textContent = text;
        }

        const bar = document.getElementById('geoProgressBar');
        if (bar && pct != null) bar.style.width = `${pct}%`;

        const msgEl = document.getElementById('geoModalMsg');
        if (msgEl && msg) msgEl.textContent = msg;
    }

    hideGeoModal(delayMs = 1200) {
        setTimeout(() => {
            const modal = document.getElementById('geoModal');
            if (modal) modal.classList.add('hidden');
        }, delayMs);
    }

    updateDataProgress(step, state, text, pct, msg, estSeconds) {
        const modal = document.getElementById('dataDownloadModal');
        if (modal) modal.classList.remove('hidden');

        if (step) {
            const stepEl = document.getElementById(step);
            const statusEl = document.getElementById(step.replace('dataStep', 'dataStatus'));
            if (stepEl) {
                stepEl.classList.remove('active', 'done');
                if (state === 'active') {
                    stepEl.classList.add('active');
                    const icon = stepEl.querySelector('.geo-step-icon');
                    if (icon) icon.textContent = '◐';
                } else if (state === 'done') {
                    stepEl.classList.add('done');
                    const icon = stepEl.querySelector('.geo-step-icon');
                    if (icon) icon.textContent = '✓';
                }
            }
            if (statusEl && text) statusEl.textContent = text;
        }

        const bar = document.getElementById('dataProgressBar');
        if (bar && pct != null) bar.style.width = `${pct}%`;

        const msgEl = document.getElementById('dataModalMsg');
        if (msgEl && msg) msgEl.textContent = msg;

        const estEl = document.getElementById('dataModalTimeEst');
        if (estEl && estSeconds != null) {
            estEl.textContent = estSeconds > 0 ? `Estimated time: ~${estSeconds}s` : 'Processing & caching…';
        }
    }

    hideDataModal(delayMs = 0) {
        if (this._dataCountdownInterval) {
            clearInterval(this._dataCountdownInterval);
            this._dataCountdownInterval = null;
        }
        const modal = document.getElementById('dataDownloadModal');
        if (!modal) return;
        if (delayMs <= 0) {
            modal.classList.add('hidden');
        } else {
            setTimeout(() => {
                modal.classList.add('hidden');
            }, delayMs);
        }
    }

    isLocalRegion(bbox) {
        if (!bbox) return false;
        return (
            bbox.min_lat >= 15.0 && bbox.max_lat <= 24.5 &&
            bbox.min_lon >= 83.0 && bbox.max_lon <= 94.0
        );
    }


    async loadRegion(bbox) {
        this.currentBBox = bbox;
        this.status('Downloading & loading geographic terrain…', 'busy');

        // Reset bundle cache for new region
        this.bundleCache = {};
        this.currentBundle = null;

        // Reset modal steps
        ['stepBathy', 'stepCoast', 'stepEEZ', 'stepTerrain'].forEach(id => {
            const el = document.getElementById(id);
            const st = document.getElementById(id.replace('step', 'status'));
            const ic = el?.querySelector('.geo-step-icon');
            if (el) el.className = 'geo-step';
            if (st) st.textContent = 'Waiting…';
            if (ic) ic.textContent = '○';
        });

        this.updateGeoProgress('stepBathy', 'active', 'Downloading GEBCO…', 15, 'Retrieving seabed elevation grid…');

        try {
            // Parallel fetch of catalog, geography, bathymetry, eez, and observations
            const [catalogData, geoData, bathyData, eezData, argoData, gliderData] = await Promise.all([
                ApiClient.getDataVariables().catch(() => ({ variables: [] })),
                ApiClient.getDataGeometry(bbox).then(res => {
                    this.updateGeoProgress('stepCoast', 'done', 'Loaded', 40, 'Coastlines & islands processed');
                    return res;
                }),
                ApiClient.getDataBathymetry(bbox, 'medium').catch(err => {
                    console.warn('Bathymetry unavailable for region, using fallback:', err);
                    return { bounds: [bbox.min_lon, bbox.max_lon, bbox.min_lat, bbox.max_lat], terrain: null, maxDepthKm: 3.5 };
                }).then(res => {
                    this.updateGeoProgress('stepBathy', 'done', 'Loaded', 60, 'GEBCO seabed ready');
                    return res;
                }),
                ApiClient.getDataEEZ(bbox).catch(() => ({ features: [], lines3d: [] })).then(res => {
                    this.updateGeoProgress('stepEEZ', 'done', 'Loaded', 80, 'Maritime boundaries configured');
                    return res;
                }),
                ApiClient.getArgoObservations(bbox).catch(() => ({ observations: [] })),
                ApiClient.getGliderObservations(bbox).catch(() => ({ observations: [] }))
            ]);

            this.catalog = catalogData.variables || [];
            this.currentGeo = geoData;
            this.currentBathy = bathyData;
            this.lastBathyData = bathyData;
            this.currentEEZ = eezData;

            this.varControl.setCatalog(this.catalog);

            this.updateGeoProgress('stepTerrain', 'active', 'Assembling 3D scene…', 90, 'Rendering ocean basin & seabed…');

            const maxD = ((bathyData?.maxDepthKm) || (bathyData?.terrain?.maxDepthKm) || 3.5) * 1000;
            this.depthControl.setMaxDepth(maxD);

            // Assemble 3D Scene with both Argo floats and Gliders
            const allObservations = [
                ...(argoData.observations || []),
                ...(gliderData?.observations || [])
            ];
            this.assemble3DScene(geoData, bathyData, eezData, allObservations);

            this.updateGeoProgress('stepTerrain', 'done', 'Ready', 100, 'Geography loaded successfully!');

            // Discover and set timeline for the active variable
            await this.timelineControl.loadTimelineForVariable(this.activeVar, bbox);
            this.activeTime = this.timelineControl.getCurrentTimestamp();

            this.status('Geography ready · Loading ocean variables for timeline…');
            this.hideGeoModal(1200);

            // Phase 2: Load all ocean variables at once for the current timeline date
            if (this.activeTime) {
                await this.loadTimelineBundle(this.activeTime);
            }

            this.status('3D ocean chunk ready');
        } catch (e) {
            console.error('Failed to load region:', e);
            this.updateGeoProgress(null, null, null, null, `Error: ${e.message}`);
            this.status(`Load failed · ${e.message}`, 'error');
            this.hideGeoModal(2500);
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
            const isGlider = obs.type === 'glider' || /glider/i.test(obs.platform || '');
            const y = 1.2;
            const maxD = obs.max_depth || (obs.depth_range ? obs.depth_range[1] : 1000);
            const bottomY = this.scene.depthY(maxD);

            const floatMarker = new THREE.Group();
            floatMarker.position.set(x, y, z);
            floatMarker.userData = { isArgoFloat: true, isGlider: isGlider, float: obs };

            if (isGlider) {
                // Autonomous Underwater Glider (Cyan #22d3ee, Winged body)
                const bodyGeom = new THREE.CylinderGeometry(0.8, 0.9, 3.6, 12);
                bodyGeom.rotateX(Math.PI / 2);
                const bodyMat = new THREE.MeshStandardMaterial({
                    color: 0x22d3ee,
                    roughness: 0.2,
                    metalness: 0.3,
                    emissive: 0x0891b2,
                    emissiveIntensity: 0.4
                });
                const body = new THREE.Mesh(bodyGeom, bodyMat);
                body.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(body);

                // Swept Wings
                const wingGeom = new THREE.BoxGeometry(4.2, 0.15, 1.2);
                const wingMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4 });
                const wings = new THREE.Mesh(wingGeom, wingMat);
                wings.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(wings);

                // Vertical fin
                const finGeom = new THREE.BoxGeometry(0.15, 1.2, 0.8);
                const fin = new THREE.Mesh(finGeom, wingMat);
                fin.position.set(0, 0.6, -1.4);
                fin.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(fin);
            } else {
                // Argo Profiling Float (Amber #f59e0b)
                const hullGeom = new THREE.CylinderGeometry(1.6, 1.4, 2.2, 16);
                const hullMat = new THREE.MeshStandardMaterial({
                    color: 0xf59e0b,
                    roughness: 0.3,
                    metalness: 0.2,
                    emissive: 0xb45309,
                    emissiveIntensity: 0.3
                });
                const hull = new THREE.Mesh(hullGeom, hullMat);
                hull.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(hull);

                const antGeom = new THREE.CylinderGeometry(0.15, 0.2, 2.4, 8);
                const antMat = new THREE.MeshStandardMaterial({ color: 0x64748b });
                const antenna = new THREE.Mesh(antGeom, antMat);
                antenna.position.set(0, 2.2, 0);
                antenna.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(antenna);

                const beaconGeom = new THREE.SphereGeometry(0.7, 12, 12);
                const beaconMat = new THREE.MeshStandardMaterial({
                    color: 0xfbbf24,
                    emissive: 0xf59e0b,
                    emissiveIntensity: 0.85
                });
                const beacon = new THREE.Mesh(beaconGeom, beaconMat);
                beacon.position.set(0, 3.4, 0);
                beacon.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(beacon);

                // Sounding Wire down to profiling depth
                const lineGeom = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(0, 0, 0),
                    new THREE.Vector3(0, bottomY, 0)
                ]);
                const lineMat = new THREE.LineDashedMaterial({
                    color: 0xf59e0b,
                    dashSize: 2.5,
                    gapSize: 1.5,
                    opacity: 0.7,
                    transparent: true
                });
                const wire = new THREE.Line(lineGeom, lineMat);
                wire.computeLineDistances();
                wire.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(wire);

                // CTD Sensor Package at Profiling Depth
                const ctdGeom = new THREE.CylinderGeometry(1.0, 1.0, 1.8, 12);
                const ctdMat = new THREE.MeshStandardMaterial({
                    color: 0xd97706,
                    emissive: 0xb45309,
                    emissiveIntensity: 0.5
                });
                const ctd = new THREE.Mesh(ctdGeom, ctdMat);
                ctd.position.set(0, bottomY, 0);
                ctd.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(ctd);
            }

            this.argoMarkersGroup.add(floatMarker);
        });

        // Register with scene layers so targeted raycasting interrogates observations
        this.scene.layers.observations = { group: this.argoMarkersGroup };
        this.scene.root.add(this.argoMarkersGroup);
    }

    setExaggeration(ex) {
        this.scene.setExaggeration(ex);
        const base = 70.0;
        const scale = Number(ex) / base;
        if (this.scene.layers.seabed) {
            this.scene.layers.seabed.scale.set(1, scale, 1);
        }
        if (this.scene.layers.water) {
            this.scene.layers.water.scale.set(1, scale, 1);
        }
    }

    rebuildTerrain() {
        if (this.currentGeo && this.currentBathy) {
            this.assemble3DScene(this.currentGeo, this.currentBathy, this.currentEEZ, []);
            this.loadActiveVariable();
        }
    }

    _resolveVarData(variables, varId) {
        if (!variables) return null;
        if (variables[varId] && !variables[varId].error) return variables[varId];
        const aliases = {
            'ocean_temperature': ['temperature', 'thetao', 'temp', 'sst', 'sea_water_temperature'],
            'temperature': ['ocean_temperature', 'thetao', 'temp', 'sst', 'sea_water_temperature'],
            'sea_surface_height': ['ssh', 'zos', 'sla', 'sea_level', 'total_sea_level'],
            'sea_level': ['sea_surface_height', 'ssh', 'zos', 'sla', 'total_sea_level'],
            'ssh': ['sea_surface_height', 'zos', 'sla', 'sea_level'],
            'currents': ['uo', 'vo', 'ocean_currents', 'velocity'],
            'salinity': ['so', 'salt', 'vosaline', 'sea_water_salinity'],
            'temperature_anomaly': ['sst_anomaly', 'sea_surface_temperature_anomaly', 'ssta', 'temp_anomaly'],
            'chlorophyll': ['chl', 'chlor_a', 'chlorophyll_a'],
            'dissolved_oxygen': ['o2', 'oxygen'],
            'ph': ['ocean_ph', 'sea_water_ph'],
            'nitrate': ['no3'],
            'phosphate': ['po4'],
            'mixed_layer_depth': ['mld', 'ocean_mixed_layer_thickness']
        };
        const fallbacks = aliases[varId] || [];
        for (const alias of fallbacks) {
            if (variables[alias] && !variables[alias].error) {
                return variables[alias];
            }
        }
        return null;
    }

    async setVariable(varId) {
        this.activeVar = varId;
        this.status(`Switching to ${varId}…`);

        try {
            const depthData = await ApiClient.getOceanDepths(varId);
            if (depthData?.depths) {
                this.depthControl?.setDepthLevels(depthData.depths);
            }
        } catch (_) {}

        // Instant switch if variable is already cached in bundle for the active time!
        if (this.activeTime && this.bundleCache[this.activeTime]) {
            const cachedVar = this._resolveVarData(this.bundleCache[this.activeTime], varId);
            if (cachedVar) {
                this.applyBundleData(this.bundleCache[this.activeTime]);
                this.status(`Ready · Showing ${varId}`);
                return;
            }
        }

        // Otherwise fetch this specific variable directly
        await this.loadActiveVariable();
    }

    async loadTimelineBundle(timeIso) {
        if (!timeIso) return;
        this.activeTime = timeIso;

        if (this.bundleCache[timeIso] && Object.keys(this.bundleCache[timeIso]).length > 0) {
            this.applyBundleData(this.bundleCache[timeIso]);
            this.status(`Ready · Ocean data for ${timeIso.slice(0, 10)}`);
            this.prefetchAdjacentTimestamps(timeIso);
            return;
        }

        const reqSeq = ++this._bundleReqSeq;
        const isLocal = this.isLocalRegion(this.currentBBox);
        const regionKey = `${this.currentBBox.min_lat}_${this.currentBBox.max_lat}_${this.currentBBox.min_lon}_${this.currentBBox.max_lon}`;
        const alreadyDownloaded = isLocal || this._downloadedRegions.has(regionKey);

        // Retrieve full timeline bounds for single-pass download
        let startTime = null;
        let endTime = null;
        if (this.timelineControl?.allTimestamps?.length > 0) {
            startTime = this.timelineControl.allTimestamps[0];
            endTime = this.timelineControl.allTimestamps[this.timelineControl.allTimestamps.length - 1];
        }

        // Show modal ONLY if it is a truly remote download that takes time (NEVER for Bay of Bengal or local disk files)
        let downloadModalTimeout = null;
        if (!alreadyDownloaded) {
            downloadModalTimeout = setTimeout(() => {
                if (this._bundleReqSeq === reqSeq && !this._downloadedRegions.has(regionKey)) {
                    this.updateDataProgress('dataStepTemp', 'active', 'Downloading…', 30, 'Downloading Copernicus Marine variables…', 10);
                }
            }, 800);
        }

        this.status(alreadyDownloaded ? `Loading ocean variables from local disk…` : `Downloading ocean data…`, 'busy');

        try {
            const bundle = await ApiClient.getOceanBundle({
                provider: this.activeProvider,
                bbox: this.currentBBox,
                depth: this.activeDepthMode === 'slice' ? this.activeDepth : null,
                time: timeIso,
                start_time: startTime,
                end_time: endTime,
                stride: 1
            });

            if (downloadModalTimeout) clearTimeout(downloadModalTimeout);

            // Discard aborted requests or superseded requests
            if (bundle?.aborted) return;
            if (this._bundleReqSeq !== reqSeq) return;

            if (bundle && bundle.variables && Object.keys(bundle.variables).length > 0) {
                this._downloadedRegions.add(regionKey);
                this.bundleCache[timeIso] = bundle.variables;
                this.hideDataModal(0);
                this.applyBundleData(this.bundleCache[timeIso]);
                this.updateProvenanceUI();
                this.refreshMLAnomalies();
                this.status(`⚡ Ocean data loaded (${bundle.provider || 'LOCAL'}) · Ready`);
                this.prefetchAdjacentTimestamps(timeIso);
            } else {
                this.hideDataModal(0);
                await this.loadActiveVariable();
            }
        } catch (e) {
            if (downloadModalTimeout) clearTimeout(downloadModalTimeout);
            if (this._bundleReqSeq !== reqSeq) return;
            console.warn(`[SolvXApp] Ocean bundle download failed for ${timeIso}, falling back:`, e);
            this.hideDataModal(0);
            await this.loadActiveVariable();
        }
    }

    prefetchAdjacentTimestamps(currentIso) {
        if (!this.timelineControl?.filteredTimestamps?.length) return;
        const list = this.timelineControl.filteredTimestamps;
        const curIdx = list.indexOf(currentIso);
        if (curIdx < 0) return;

        // Prefetch adjacent timestamps sequentially with category: null so they don't abort active playback
        const toPrefetch = [curIdx + 1, curIdx + 2, curIdx - 1]
            .filter(i => i >= 0 && i < list.length)
            .map(i => list[i])
            .filter(iso => !this.bundleCache[iso] || Object.keys(this.bundleCache[iso]).length === 0);

        if (!toPrefetch.length) return;

        (async () => {
            for (const iso of toPrefetch) {
                if (this.bundleCache[iso] && Object.keys(this.bundleCache[iso]).length > 0) continue;
                try {
                    const bundle = await ApiClient.getOceanBundle({
                        provider: this.activeProvider,
                        bbox: this.currentBBox,
                        depth: this.activeDepthMode === 'slice' ? this.activeDepth : null,
                        time: iso,
                        stride: 1,
                        options: { category: null }
                    });
                    if (bundle?.variables && !bundle.aborted && Object.keys(bundle.variables).length > 0) {
                        this.bundleCache[iso] = bundle.variables;
                    }
                } catch (_) {}
            }
        })();
    }

    applyBundleData(variables) {
        if (!variables) return;
        this.currentBundle = variables;

        const isCurrentsActive = this.activeVar === 'currents';

        if (isCurrentsActive) {
            const curData = this._resolveVarData(variables, 'currents');
            if (curData && !curData.error) {
                this.renderCurrents(curData, true);
            }
        } else {
            const varData = this._resolveVarData(variables, this.activeVar);
            if (varData && !varData.error) {
                this.lastOceanData = varData;
                this.scalarViz?.apply(this.activeVar, varData, this.activeDepth, this.activeDepthMode);
            } else {
                this.scalarViz?.apply(this.activeVar, null, this.activeDepth, this.activeDepthMode);
            }

            // Update particle flow in background without overriding active scalar variable or legend
            const curData = this._resolveVarData(variables, 'currents');
            if (curData && !curData.error && (this.layerState.particles || this.layerState.currents)) {
                this.renderCurrents(curData, false);
            }
        }

        this.applyLayerVisibility('scientific', this.layerState.scientific);
        this.applyLayerVisibility('currents', isCurrentsActive && this.layerState.currents);
        this.applyLayerVisibility('particles', this.layerState.particles);
    }

    renderCurrents(data, isPrimary = true) {
        if (this.currentVectorsGroup) {
            this.scene.disposeObject(this.currentVectorsGroup);
            this.currentVectorsGroup = null;
        }
        if (this.currentParticles) {
            this.scene.disposeObject(this.currentParticles.group);
            this.currentParticles = null;
        }

        if (isPrimary) {
            this.lastOceanData = data;
            this.currentGrid = data;
        }
        const bounds = this.currentBathy?.bounds || [this.currentBBox.min_lon, this.currentBBox.max_lon, this.currentBBox.min_lat, this.currentBBox.max_lat];

        // Build 3D vector arrows
        this.currentVectorsGroup = buildCurrentVectors(data, this.scene, bounds, isPrimary);
        this.scene.setLayer('currents', this.currentVectorsGroup);

        // Build animated particles
        this.currentParticles = new CurrentParticles(data, bounds, { count: 600 });
        this.scene.setLayer('particles', this.currentParticles.group);
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

        // Fast path: use already cached bundle data if this specific variable is present
        if (this.activeTime && this.bundleCache[this.activeTime]) {
            const cachedVar = this._resolveVarData(this.bundleCache[this.activeTime], this.activeVar);
            if (cachedVar) {
                this.applyBundleData(this.bundleCache[this.activeTime]);
                this.updateProvenanceUI();
                return;
            }
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
                
                // Store in bundleCache
                if (this.activeTime) {
                    if (!this.bundleCache[this.activeTime]) this.bundleCache[this.activeTime] = {};
                    this.bundleCache[this.activeTime][this.activeVar] = data;
                    this.currentBundle = this.bundleCache[this.activeTime];
                }
                
                this.scalarViz?.apply(this.activeVar, data, this.activeDepth, this.activeDepthMode);
                this.status(`Ready · Showing ${this.activeVar}`);
            }
        } catch (e) {
            console.warn(`[SolvXApp] Failed to load variable '${this.activeVar}' with provider '${this.activeProvider}':`, e);
            this.status(`Provider error (${this.activeProvider.toUpperCase()}): ${e.message}`, 'error');
            this.scalarViz?.apply(this.activeVar, null, this.activeDepth, this.activeDepthMode);
        }

        this.applyLayerVisibility('scientific', this.layerState.scientific);
        this.applyLayerVisibility('currents', (this.activeVar === 'currents') && this.layerState.currents);
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
            this.renderCurrents(data);
        } catch (e) {
            console.warn(`[SolvXApp] Failed to load currents with provider '${this.activeProvider}':`, e);
            throw e;
        }
    }

    async applyVerticalSlice(sLat, sLon, eLat, eLon) {
        this.activeDepthMode = 'vertical_custom';
        this.verticalSliceCoords = { sLat, sLon, eLat, eLon };
        try {
            const transect = await ApiClient.getOceanVerticalSlice({
                variable: this.activeVar === 'currents' ? 'temperature' : this.activeVar,
                time: this.activeTime,
                startLat: sLat,
                startLon: sLon,
                endLat: eLat,
                endLon: eLon,
                numPoints: 100
            });
            if (this.scalarViz) {
                this.scalarViz.applyVerticalSlicePlane(sLat, sLon, eLat, eLon, transect);
            }
            if (this.depthControl?.vertInfo && transect.total_distance_km) {
                this.depthControl.vertInfo.textContent = `Transect: ${transect.total_distance_km} km · ${transect.depths?.length || 32} levels`;
            }
        } catch (e) {
            console.warn('[SolvXApp] Vertical slice API call failed, falling back to local array:', e);
            if (this.scalarViz) {
                this.scalarViz.applyVerticalSlicePlane(sLat, sLon, eLat, eLon);
            }
        }
    }

    clearVerticalSlice() {
        this.activeDepthMode = 'volume';
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
            this.loadTimelineBundle(this.activeTime);
        } else {
            this.onDepthChange(depthM);
        }
        this.updateProvenanceUI();
    }

    async onTimeChange(idx, timeIso, meta) {
        this.activeTime = timeIso;
        this.activeTimeMeta = meta;
        await this.loadTimelineBundle(timeIso);
    }

    updateProvenanceUI() {
        // No-op, provenance panel removed.
    }
    
    updateHazardUI(hazardData) {
        // Analytical warnings owned by Analysis page per plan.md specification
    }

    async inspectPoint(cell) {
        if (!this.markerMesh) {
            const geom = new THREE.TorusGeometry(0.5, 0.1, 16, 32);
            geom.rotateX(Math.PI / 2);
            const mat = new THREE.MeshBasicMaterial({ color: 0x00e5a0, transparent: true, opacity: 0.85 });
            this.markerMesh = new THREE.Mesh(geom, mat);
            const pinGeom = new THREE.CylinderGeometry(0, 0.2, 1, 16);
            pinGeom.translate(0, 0.5, 0);
            const pinMat = new THREE.MeshBasicMaterial({ color: 0x00e5a0 });
            const pin = new THREE.Mesh(pinGeom, pinMat);
            this.markerMesh.add(pin);
            this.scene.root.add(this.markerMesh);
        }

        const midLat = (this.currentBBox.min_lat + this.currentBBox.max_lat) / 2;
        const midLon = (this.currentBBox.min_lon + this.currentBBox.max_lon) / 2;
        const posX = (cell.lat - midLat) * 111.32;
        const posZ = (cell.lon - midLon) * 111.32 * Math.cos(midLat * Math.PI / 180);
        const pointDepth = cell.depthM != null ? cell.depthM : (this.activeDepth || 0);

        this.markerMesh.position.set(posX, 1.0, posZ);
        this.markerMesh.visible = true;

        const readout = document.getElementById('readout');
        const coordsEl = document.getElementById('coords');
        const gridEl = document.getElementById('readoutGrid');
        const timeEl = document.getElementById('readoutTime');

        if (coordsEl) coordsEl.textContent = `${cell.lat.toFixed(4)}° N, ${cell.lon.toFixed(4)}° E · Depth: ${pointDepth.toFixed(1)} m`;
        if (gridEl) gridEl.innerHTML = '<div style="color: var(--ink-muted); font-size: 11px; padding: 4px 0;">Querying oceanographic & atmospheric sensors…</div>';
        readout?.classList.remove('hidden');

        this.status('Inspecting ocean point…', 'busy');

        try {
            const [data, mlData] = await Promise.all([
                ApiClient.getPoint(cell.lat, cell.lon, this.activeTime, pointDepth).catch(() => ({ variables: {}, units: {}, profile: [] })),
                ApiClient.getMLPoint(cell.lat, cell.lon, this.activeTime).catch(() => null)
            ]);

            const vars = { ...data.variables, ...(mlData?.values || {}) };
            const units = data.units || {};
            const formatVal = (v, u) => (v != null && !isNaN(v)) ? `${Number(v).toFixed(2)} ${u || ''}` : '—';

            let gridHtml = `
                <div class="readout-category-title">OCEAN STATE</div>
                <div class="readout-rows">
                    <span class="readout-label">Temperature</span>
                    <span class="readout-val">${formatVal(vars.ocean_temperature, units.ocean_temperature || '°C')}</span>
                    <span class="readout-label">Salinity</span>
                    <span class="readout-val">${formatVal(vars.salinity, units.salinity || 'PSU')}</span>
                    <span class="readout-label">Sea Level</span>
                    <span class="readout-val">${formatVal(vars.sea_surface_height ?? vars.sea_level_anomaly, units.sea_surface_height || 'm')}</span>
                    <span class="readout-label">Current Velocity</span>
                    <span class="readout-val">${formatVal(vars.current_speed ?? (vars.current_u != null && vars.current_v != null ? Math.sqrt(vars.current_u**2 + vars.current_v**2) : null), 'm/s')}</span>
                    <span class="readout-label">Current Dir</span>
                    <span class="readout-val">${formatVal(vars.current_direction, '°')}</span>
                </div>

                <div class="readout-category-title">ATMOSPHERE & WINDS</div>
                <div class="readout-rows">
                    <span class="readout-label">Air Temp</span>
                    <span class="readout-val">${formatVal(vars.air_temperature, '°C')}</span>
                    <span class="readout-label">Wind Velocity</span>
                    <span class="readout-val">${formatVal(vars.wind_speed, 'm/s')}</span>
                    <span class="readout-label">Wind Dir</span>
                    <span class="readout-val">${formatVal(vars.wind_direction, '°')}</span>
                    <span class="readout-label">Humidity</span>
                    <span class="readout-val">${formatVal(vars.relative_humidity, '%')}</span>
                    <span class="readout-label">Surface Pressure</span>
                    <span class="readout-val">${formatVal(vars.sea_level_pressure, 'hPa')}</span>
                </div>
            `;

            if (data.profile && data.profile.length > 0) {
                gridHtml += `
                    <div class="readout-category-title">VERTICAL SOUNDING PROFILE</div>
                    <div style="max-height: 140px; overflow-y: auto; font-size: 11px; margin-top: 4px; border: 1px solid var(--border-subtle, rgba(255,255,255,0.1)); border-radius: 4px;">
                        <table style="width: 100%; border-collapse: collapse; text-align: right;">
                            <thead>
                                <tr style="color: var(--ink-muted); border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.1)); font-size: 10px;">
                                    <th style="padding: 2px 4px; text-align: left;">Depth</th>
                                    <th style="padding: 2px 4px;">Temp</th>
                                    <th style="padding: 2px 4px;">Sal</th>
                                    <th style="padding: 2px 4px;">Speed</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${data.profile.map(p => `
                                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                                        <td style="padding: 2px 4px; text-align: left;">${p.depth.toFixed(1)} m</td>
                                        <td style="padding: 2px 4px;">${p.temperature != null ? `${p.temperature.toFixed(2)} °C` : '—'}</td>
                                        <td style="padding: 2px 4px;">${p.salinity != null ? `${p.salinity.toFixed(2)}` : '—'}</td>
                                        <td style="padding: 2px 4px;">${p.current_speed != null ? `${p.current_speed.toFixed(2)} m/s` : '—'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            }

            if (mlData?.anomaly || mlData?.hazard) {
                const aScore = mlData.anomaly?.anomaly_score;
                const hRisk = mlData.hazard?.risk_score;
                gridHtml += `
                    <div class="readout-category-title">HAZARD RISK & ANOMALIES</div>
                    <div class="readout-rows">
                        <span class="readout-label">Anomaly Score</span>
                        <span class="readout-val">${aScore != null ? `${Number(aScore).toFixed(1)} / 100` : 'Normal'}</span>
                        <span class="readout-label">Hazard Risk</span>
                        <span class="readout-val">${hRisk != null ? `${Number(hRisk).toFixed(1)} / 100` : 'Low'}</span>
                    </div>
                `;
                if (mlData.hazard?.contributing_signals?.length) {
                    gridHtml += `
                        <div style="font-size: 10px; color: var(--ink-muted); margin-top: 4px; line-height: 1.4;">
                            ${mlData.hazard.contributing_signals.map(s => `• ${s}`).join('<br>')}
                        </div>
                    `;
                }
            }

            if (gridEl) gridEl.innerHTML = gridHtml;
            if (timeEl) timeEl.textContent = new Date(this.activeTime || data.timestamp || Date.now()).toUTCString();

            const openAnalysisBtn = document.getElementById('btnOpenAnalysisFromReadout');
            if (openAnalysisBtn) {
                openAnalysisBtn.onclick = () => {
                    SelectionContext.setSelection({
                        type: 'cell',
                        lat: cell.lat,
                        lon: cell.lon,
                        depth: this.currentDepth || 0
                    });
                    window.location.href = `/analysis.html?lat=${cell.lat.toFixed(4)}&lon=${cell.lon.toFixed(4)}`;
                };
            }

            this.status('Point data loaded.');
        } catch (e) {
            console.error('Point inspection failed:', e);
            if (gridEl) gridEl.innerHTML = `<div style="color: #ff4455; font-size: 11px;">Inspection failed: ${e.message}</div>`;
            this.status('Point inspection failed', 'error');
        }
    }

    inspectAnomalyRegion(regionId) {
        if (!regionId) return;
        this.status(`Investigating Anomaly Region ${regionId}…`, 'busy');
        
        // Ensure the Analysis Dashboard is open since this is where Anomaly info lives.
        const AnalysisPanel = window.AnalysisPanel; // Actually, it's imported in analysisPanel.js and used as a module.
        // Let's just click the Analysis toggle button if it exists and isn't active
        const toggleBtn = document.getElementById('analysisToggleBtn');
        if (toggleBtn && !toggleBtn.classList.contains('active')) {
            toggleBtn.click();
        }
        
        // We could also highlight the specific row in the dashboard, but opening it fulfills the requirement.
        this.status(`Investigating anomaly region ${regionId}.`, 'ready');
    }

    async inspectObservation(argo) {
        if (!argo) return;

        if (this.profileViewer) {
            await this.profileViewer.show(argo);
            return;
        }

        const modal = document.getElementById('obsModal');
        const title = document.getElementById('obsTitle');
        const stats = document.getElementById('obsStats');
        const body = document.getElementById('obsBody');

        if (!modal) return;
        if (title) title.textContent = `Argo Float #${argo.wmo || argo.id} Sounding Profile`;
        this.status(`Comparing Argo #${argo.wmo || argo.id} with model…`, 'busy');

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

const app = new SolvXApp();
window.solvx = app;
window.solvxViewer = app.viewerController;
app.init().catch(err => {
    console.error('Fatal initialization error:', err);
    const fatal = document.getElementById('fatal');
    const fatalText = document.getElementById('fatalText');
    if (fatalText) fatalText.textContent = err.message || String(err);
    fatal?.classList.add('show');
});

// --- ML Hazard Early Warning Extension ---
SolvXApp.prototype.initMLControls = function() {
    // Warnings owned by Analysis page
};

SolvXApp.prototype.refreshMLAnomalies = async function() {
    try {
        const data = await ApiClient.getMLAnomalies(this.currentBBox, this.activeTime);
        this.updateHazardUI(data);
    } catch (e) {
        console.warn('Failed to load hazards/anomalies:', e);
        this.updateHazardUI({ hazards: [] });
    }
};

SolvXApp.prototype.focusHazard = function(lat, lon) {
    if (!this.scene?.camera || !this.scene?.controls) return;
    const midLat = (this.currentBBox.min_lat + this.currentBBox.max_lat) / 2;
    const midLon = (this.currentBBox.min_lon + this.currentBBox.max_lon) / 2;
    const posX = (lat - midLat) * 111.32;
    const posZ = (lon - midLon) * 111.32 * Math.cos(midLat * Math.PI / 180);
    
    this.scene.camera.position.set(posX, 80, posZ + 120);
    this.scene.controls.target.set(posX, 0, posZ);
    this.scene.controls.update();

    this.inspectPoint({ lat, lon });
};
