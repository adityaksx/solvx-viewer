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
import { AssistantDock } from './ai/assistantDock.js';


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

        // Current flow & dynamics parameters
        this.currentFlowSpeed = 1.0;
        this.particleDensity = 600;
        this.vectorScale = 1.0;
        this.particlesPaused = false;
        this.particlesEnabled = true;

        // Point inspection state
        this.isInspectingPoint = false;
        this.activeInspectedPoint = null;
        this.pointProfileVar = 'temperature';
        this.pointTimeseriesVar = 'temperature';
        this.lastInspectedData = null;
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
        this.setupCurrentControls();
        this.setupPointInspector();
        AssistantDock.init(this.viewerController, this);

        let lastUpdateMs = performance.now();
        this.scene.onUpdate((timeMs) => {
            const now = timeMs || performance.now();
            const delta = Math.min(0.05, Math.max(0.001, (now - lastUpdateMs) / 1000.0));
            lastUpdateMs = now;
            if (this.activeVar === 'currents') {
                this.currentVectorsGroup?.update?.(delta, now / 1000.0, this.scene.camera);
            }
            this.currentParticles?.update(delta);
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
        } else if (layer === 'currents') {
            const actualVisible = (this.activeVar === 'currents') && visible;
            this.scene.setLayerVisibility('currents', actualVisible);
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
        this.allObservations = observations || [];
        this.currentObservationBounds = bounds;
        this.obsPulseRings = [];

        const midLat = (bounds[2] + bounds[3]) / 2;
        const midLon = (bounds[0] + bounds[1]) / 2;
        const klat = 111.32;
        const klon = 111.32 * Math.cos((midLat * Math.PI) / 180);

        observations.forEach(obs => {
            const x = (obs.latitude - midLat) * klat;
            const z = (obs.longitude - midLon) * klon;
            const isGlider = obs.type === 'glider' || /glider/i.test(obs.platform || '');
            const y = 1.8;
            const maxD = obs.max_depth || (obs.depth_range ? obs.depth_range[1] : 1000);
            const bottomY = this.scene.depthY(maxD);

            const floatMarker = new THREE.Group();
            floatMarker.position.set(x, y, z);
            floatMarker.userData = { isArgoFloat: true, isGlider: isGlider, float: obs };

            if (isGlider) {
                // Autonomous Underwater Glider (Cyan #22d3ee) - Scaled up for ocean visibility
                // 1. Torpedo Fuselage
                const bodyGeom = new THREE.CylinderGeometry(1.8, 2.0, 11.0, 16);
                bodyGeom.rotateX(Math.PI / 2);
                const bodyMat = new THREE.MeshStandardMaterial({
                    color: 0x22d3ee,
                    roughness: 0.15,
                    metalness: 0.4,
                    emissive: 0x0891b2,
                    emissiveIntensity: 0.6
                });
                const body = new THREE.Mesh(bodyGeom, bodyMat);
                body.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(body);

                // Nose Cone (Hemisphere / Cone)
                const noseGeom = new THREE.ConeGeometry(1.8, 3.2, 16);
                noseGeom.rotateX(-Math.PI / 2);
                noseGeom.translate(0, 0, 7.1);
                const noseMat = new THREE.MeshStandardMaterial({
                    color: 0x38bdf8,
                    emissive: 0x0284c7,
                    emissiveIntensity: 0.8
                });
                const nose = new THREE.Mesh(noseGeom, noseMat);
                nose.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(nose);

                // Swept Delta Wings (High Visibility Span: 16 units)
                const wingGeom = new THREE.BoxGeometry(16.0, 0.45, 3.2);
                const wingMat = new THREE.MeshStandardMaterial({
                    color: 0x06b6d4,
                    metalness: 0.3,
                    roughness: 0.2,
                    emissive: 0x0891b2,
                    emissiveIntensity: 0.4
                });
                const wings = new THREE.Mesh(wingGeom, wingMat);
                wings.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(wings);

                // Vertical Stabilizer Fin
                const finGeom = new THREE.BoxGeometry(0.4, 3.8, 2.4);
                const fin = new THREE.Mesh(finGeom, wingMat);
                fin.position.set(0, 2.2, -3.8);
                fin.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(fin);

                // Glowing Cyan Strobe Beacon
                const strobeGeom = new THREE.SphereGeometry(1.0, 16, 16);
                const strobeMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9 });
                const strobe = new THREE.Mesh(strobeGeom, strobeMat);
                strobe.position.set(0, 3.8, -3.8);
                strobe.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(strobe);

                // Surface Locator Ring (Cyan Torus at water surface)
                const haloGeom = new THREE.TorusGeometry(8.0, 0.4, 16, 48);
                haloGeom.rotateX(Math.PI / 2);
                const haloMat = new THREE.MeshBasicMaterial({
                    color: 0x22d3ee,
                    transparent: true,
                    opacity: 0.8
                });
                const halo = new THREE.Mesh(haloGeom, haloMat);
                halo.position.set(0, 0.2 - y, 0);
                halo.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(halo);
                this.obsPulseRings.push(halo);

                // Vertical Datum Ray
                const rayGeom = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(0, 0.2 - y, 0),
                    new THREE.Vector3(0, bottomY, 0)
                ]);
                const rayMat = new THREE.LineDashedMaterial({
                    color: 0x22d3ee,
                    dashSize: 3.0,
                    gapSize: 2.0,
                    opacity: 0.6,
                    transparent: true
                });
                const ray = new THREE.Line(rayGeom, rayMat);
                ray.computeLineDistances();
                ray.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(ray);
            } else {
                // Argo Profiling Float (Golden Amber #f59e0b) - Prominent Scale
                // 1. High-Vis Cylindrical Hull
                const hullGeom = new THREE.CylinderGeometry(3.5, 3.0, 6.5, 20);
                const hullMat = new THREE.MeshStandardMaterial({
                    color: 0xf59e0b,
                    roughness: 0.25,
                    metalness: 0.3,
                    emissive: 0xb45309,
                    emissiveIntensity: 0.4
                });
                const hull = new THREE.Mesh(hullGeom, hullMat);
                hull.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(hull);

                // Upper Collar Ring
                const collarGeom = new THREE.CylinderGeometry(4.0, 4.0, 1.2, 20);
                const collarMat = new THREE.MeshStandardMaterial({
                    color: 0xfbbf24,
                    emissive: 0xd97706,
                    emissiveIntensity: 0.5
                });
                const collar = new THREE.Mesh(collarGeom, collarMat);
                collar.position.set(0, 2.8, 0);
                collar.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(collar);

                // Antenna Mast
                const antGeom = new THREE.CylinderGeometry(0.35, 0.45, 6.5, 12);
                const antMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.6 });
                const antenna = new THREE.Mesh(antGeom, antMat);
                antenna.position.set(0, 6.0, 0);
                antenna.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(antenna);

                // Glowing Amber Strobe Beacon
                const beaconGeom = new THREE.SphereGeometry(1.8, 16, 16);
                const beaconMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
                const beacon = new THREE.Mesh(beaconGeom, beaconMat);
                beacon.position.set(0, 9.2, 0);
                beacon.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(beacon);

                // Surface Locator Ring (Amber Torus at water surface)
                const haloGeom = new THREE.TorusGeometry(8.0, 0.4, 16, 48);
                haloGeom.rotateX(Math.PI / 2);
                const haloMat = new THREE.MeshBasicMaterial({
                    color: 0xf59e0b,
                    transparent: true,
                    opacity: 0.85
                });
                const halo = new THREE.Mesh(haloGeom, haloMat);
                halo.position.set(0, 0.2 - y, 0);
                halo.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(halo);
                this.obsPulseRings.push(halo);

                // Sounding Wire down to profiling depth
                const lineGeom = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(0, 0, 0),
                    new THREE.Vector3(0, bottomY, 0)
                ]);
                const lineMat = new THREE.LineDashedMaterial({
                    color: 0xf59e0b,
                    dashSize: 3.0,
                    gapSize: 2.0,
                    opacity: 0.75,
                    transparent: true
                });
                const wire = new THREE.Line(lineGeom, lineMat);
                wire.computeLineDistances();
                wire.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(wire);

                // CTD Sensor Package at Profiling Depth
                const ctdGeom = new THREE.CylinderGeometry(2.4, 2.4, 4.0, 16);
                const ctdMat = new THREE.MeshStandardMaterial({
                    color: 0xd97706,
                    emissive: 0xb45309,
                    emissiveIntensity: 0.6
                });
                const ctd = new THREE.Mesh(ctdGeom, ctdMat);
                ctd.position.set(0, bottomY, 0);
                ctd.userData = { isArgoFloat: true, float: obs };
                floatMarker.add(ctd);
            }

            this.argoMarkersGroup.add(floatMarker);
        });

        // Add subtle continuous pulse animation for observation surface rings
        if (!this._obsPulseBound) {
            this.scene.onUpdate((delta, time) => {
                if (!this.obsPulseRings || !this.obsPulseRings.length) return;
                const pulse = 1.0 + Math.sin(time * 2.5) * 0.12;
                const opacity = 0.6 + Math.sin(time * 2.5) * 0.25;
                for (const ring of this.obsPulseRings) {
                    ring.scale.set(pulse, pulse, pulse);
                    if (ring.material) ring.material.opacity = opacity;
                }
            });
            this._obsPulseBound = true;
        }

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
        if (window.performance && performance.mark) {
            performance.mark('variable-switch-start');
        }
        this.activeVar = varId;
        this.status(`Switching to ${varId}…`);

        if (varId !== 'currents') {
            if (this.currentVectorsGroup) {
                this.scene.disposeObject(this.currentVectorsGroup);
                this.currentVectorsGroup = null;
            }
            this.scene.setLayerVisibility('currents', false);
        }

        // Fast path: Instant switch if variable is already cached in bundle for the active time!
        if (this.activeTime && this.bundleCache[this.activeTime]) {
            const cachedVar = this._resolveVarData(this.bundleCache[this.activeTime], varId);
            if (cachedVar) {
                this.applyBundleData(this.bundleCache[this.activeTime]);
                this.status(`Ready · Showing ${varId}`);
                AssistantDock.updateContextBar();
                if (window.performance && performance.mark) {
                    performance.mark('variable-switch-end');
                    performance.measure('variable-switch-duration', 'variable-switch-start', 'variable-switch-end');
                }
                // Update depth levels in the background non-blocking
                ApiClient.getOceanDepths(varId).then(depthData => {
                    if (depthData?.depths) {
                        this.depthControl?.setDepthLevels(depthData.depths);
                    }
                }).catch(() => {});
                return;
            }
        }

        // Non-blocking depth metadata fetch
        ApiClient.getOceanDepths(varId).then(depthData => {
            if (depthData?.depths) {
                this.depthControl?.setDepthLevels(depthData.depths);
            }
        }).catch(() => {});

        // Otherwise fetch this specific variable directly
        await this.loadActiveVariable();
        AssistantDock.updateContextBar();
        if (window.performance && performance.mark) {
            performance.mark('variable-switch-end');
            performance.measure('variable-switch-duration', 'variable-switch-start', 'variable-switch-end');
        }
    }

    async loadTimelineBundle(timeIso) {
        if (!timeIso) return;
        this.activeTime = timeIso;

        if (window.performance && performance.mark) {
            performance.mark('bundle-cache-check');
        }

        if (this.bundleCache[timeIso] && Object.keys(this.bundleCache[timeIso]).length > 0) {
            if (window.performance && performance.mark) {
                performance.mark('bundle-apply-start');
            }
            this.applyBundleData(this.bundleCache[timeIso]);
            if (window.performance && performance.mark) {
                performance.mark('bundle-apply-end');
                performance.measure('bundle-cache-apply-duration', 'bundle-apply-start', 'bundle-apply-end');
            }
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
        if (this.timelineControl?.windowTimestamps?.length > 0) {
            startTime = this.timelineControl.windowTimestamps[0];
            endTime = this.timelineControl.windowTimestamps[this.timelineControl.windowTimestamps.length - 1];
        } else if (this.timelineControl?.allTimestamps?.length > 0) {
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
            if (window.performance && performance.mark) {
                performance.mark('bundle-fetch-start');
            }
            const bundle = await ApiClient.getOceanBundle({
                provider: this.activeProvider,
                bbox: this.currentBBox,
                depth: this.activeDepthMode === 'slice' ? this.activeDepth : null,
                time: timeIso,
                start_time: startTime,
                end_time: endTime,
                stride: 1,
                options: { category: 'active-bundle' }
            });

            if (downloadModalTimeout) clearTimeout(downloadModalTimeout);

            // Discard aborted requests or superseded requests
            if (bundle?.aborted) return;
            if (this._bundleReqSeq !== reqSeq || this.activeTime !== timeIso) return;

            if (bundle && bundle.variables && Object.keys(bundle.variables).length > 0) {
                this._downloadedRegions.add(regionKey);
                this.bundleCache[timeIso] = bundle.variables;
                this.hideDataModal(0);
                if (window.performance && performance.mark) {
                    performance.mark('bundle-apply-start');
                }
                this.applyBundleData(this.bundleCache[timeIso]);
                if (window.performance && performance.mark) {
                    performance.mark('bundle-apply-end');
                    performance.measure('bundle-fetch-to-apply', 'bundle-fetch-start', 'bundle-apply-end');
                }
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
            if (this._bundleReqSeq !== reqSeq || this.activeTime !== timeIso) return;
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

        // Prefetch adjacent timestamps sequentially with category: 'prefetch' so they don't abort active user requests
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
                        options: { category: 'prefetch' }
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
                if (!curData.values && curData.u && curData.v) {
                    const u = curData.u;
                    const v = curData.v;
                    curData.values = u.map((row, j) => row.map((uu, i) => {
                        const vv = v[j]?.[i];
                        return (uu != null && vv != null) ? Math.hypot(uu, vv) : null;
                    }));
                }
                this.lastOceanData = curData;
                this.scalarViz?.apply('currents', curData, this.activeDepth, this.activeDepthMode);
                this.renderCurrents(curData, true);
            }
        } else {
            if (this.currentVectorsGroup) {
                this.scene.disposeObject(this.currentVectorsGroup);
                this.currentVectorsGroup = null;
            }
            const varData = this._resolveVarData(variables, this.activeVar);
            if (varData && !varData.error) {
                this.lastOceanData = varData;
                this.scalarViz?.apply(this.activeVar, varData, this.activeDepth, this.activeDepthMode);
            } else {
                this.scalarViz?.apply(this.activeVar, null, this.activeDepth, this.activeDepthMode);
            }

            // Update particle flow in background without overriding active scalar variable or legend
            const curData = this._resolveVarData(variables, 'currents');
            if (curData && !curData.error && this.layerState.particles) {
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
        }
        this.currentGrid = data;
        const bounds = this.currentBathy?.bounds || [this.currentBBox.min_lon, this.currentBBox.max_lon, this.currentBBox.min_lat, this.currentBBox.max_lat];
        const depthY = this.activeDepth ? (this.scene.depthY(this.activeDepth) + 0.8) : 1.2;

        // Build 3D vector arrows ONLY if currents is the actively selected variable
        if (this.activeVar === 'currents') {
            this.currentVectorsGroup = buildCurrentVectors(data, this.scene, bounds, isPrimary, this.vectorScale, depthY);
            this.scene.setLayer('currents', this.currentVectorsGroup);
            this.scene.setLayerVisibility('currents', this.layerState.currents);
        } else {
            this.scene.setLayerVisibility('currents', false);
        }

        // Build animated particles with flowSpeed, particleDensity, vectorScale
        this.currentParticles = new CurrentParticles(data, bounds, {
            count: this.particleDensity,
            flowSpeed: this.currentFlowSpeed,
            vectorScale: this.vectorScale,
            paused: this.particlesPaused,
            animated: this.particlesEnabled,
            depthY: depthY + 0.3
        });
        this.scene.setLayer('particles', this.currentParticles.group);
        this.scene.setLayerVisibility('particles', this.layerState.particles);
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
        const depthNotice = document.getElementById('currentDepthNotice');
        try {
            const data = await ApiClient.getCurrentField(
                this.currentBBox,
                this.activeDepth || 0,
                this.activeTime,
                3
            );

            if (data && data.available === false) {
                if (depthNotice) {
                    depthNotice.classList.remove('hidden');
                    depthNotice.textContent = `Current data unavailable at ${this.activeDepth || 0}m (${data.reason || 'depth exceeds coverage'}). Available: 0m to 541m.`;
                }
                if (this.currentVectorsGroup) {
                    this.scene.disposeObject(this.currentVectorsGroup);
                    this.currentVectorsGroup = null;
                }
                if (this.currentParticles) {
                    this.scene.disposeObject(this.currentParticles.group);
                    this.currentParticles = null;
                }
                this.status(`Current data unavailable at ${this.activeDepth || 0}m (available: 0m to 541m)`, 'busy');
                return;
            }

            if (depthNotice) depthNotice.classList.add('hidden');
            if (this.activeVar === 'currents') {
                if (!data.values && data.u && data.v) {
                    const u = data.u;
                    const v = data.v;
                    data.values = u.map((row, j) => row.map((uu, i) => {
                        const vv = v[j]?.[i];
                        return (uu != null && vv != null) ? Math.hypot(uu, vv) : null;
                    }));
                }
                this.scalarViz?.apply('currents', data, this.activeDepth, this.activeDepthMode);
            }
            this.renderCurrents(data, this.activeVar === 'currents');
            this.status('Ocean currents & flow particles loaded.');
        } catch (e) {
            console.warn(`[SolvXApp] getCurrentField failed, falling back to standard currents:`, e);
            try {
                const fallback = await ApiClient.getOceanVariable({
                    provider: this.activeProvider,
                    variable: 'currents',
                    bbox: this.currentBBox,
                    time: this.activeTime,
                    stride: 3
                });
                this.renderCurrents(fallback, this.activeVar === 'currents');
            } catch (err2) {
                console.warn(`[SolvXApp] Fallback currents failed:`, err2);
            }
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
        } else {
            this.loadCurrents();
        }
        if (this.layerState.currents || this.layerState.particles) {
            this.loadCurrents();
        }
        if (this.activeInspectedPoint && !document.getElementById('readout')?.classList.contains('hidden')) {
            this.inspectPoint({ ...this.activeInspectedPoint, depthM });
        }
        this.updateProvenanceUI();
        AssistantDock.updateContextBar();
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
        AssistantDock.updateContextBar();
    }

    async onTimeChange(idx, timeIso, meta) {
        if (!timeIso) return;
        if (window.performance && performance.mark) {
            performance.mark('timeline-change-start');
        }
        this.activeTime = timeIso;
        this.activeTimeMeta = meta;
        this.profileViewer?.updateActiveTime(timeIso);

        // Fast path: if cached, apply synchronously and return immediately!
        if (this.bundleCache[timeIso] && Object.keys(this.bundleCache[timeIso]).length > 0) {
            this.applyBundleData(this.bundleCache[timeIso]);
            this.status(`Ready · Ocean data for ${timeIso.slice(0, 10)}`);
            this.prefetchAdjacentTimestamps(timeIso);
            if (this.activeInspectedPoint && !document.getElementById('readout')?.classList.contains('hidden')) {
                this.inspectPoint(this.activeInspectedPoint);
            }
            AssistantDock.updateContextBar();
            if (window.performance && performance.mark) {
                performance.mark('timeline-change-visible');
                performance.measure('timeline-to-visible-cached', 'timeline-change-start', 'timeline-change-visible');
            }
            return;
        }

        // Uncached path: fetch bundle
        await this.loadTimelineBundle(timeIso);

        // Only load currents separately if currents are needed AND missing from active bundle
        const hasCurrentsInBundle = Boolean(this._resolveVarData(this.currentBundle, 'currents'));
        if ((this.layerState.currents || this.activeVar === 'currents') && !hasCurrentsInBundle) {
            await this.loadCurrents();
        }

        if (this.activeInspectedPoint && !document.getElementById('readout')?.classList.contains('hidden')) {
            this.inspectPoint(this.activeInspectedPoint);
        }
        AssistantDock.updateContextBar();
        if (window.performance && performance.mark) {
            performance.mark('timeline-change-visible');
            performance.measure('timeline-to-visible-network', 'timeline-change-start', 'timeline-change-visible');
        }
    }

    setupCurrentControls() {
        const btnToggle = document.getElementById('btnToggleCurrentAnim');
        const btnPause = document.getElementById('btnPauseCurrentAnim');
        const speedSlider = document.getElementById('currentSpeedSlider');
        const speedVal = document.getElementById('currentSpeedVal');
        const densitySlider = document.getElementById('particleDensitySlider');
        const densityVal = document.getElementById('particleDensityVal');
        const scaleSlider = document.getElementById('vectorScaleSlider');
        const scaleVal = document.getElementById('vectorScaleVal');

        if (btnToggle) {
            btnToggle.onclick = () => {
                this.particlesEnabled = !this.particlesEnabled;
                btnToggle.textContent = this.particlesEnabled ? 'ON' : 'OFF';
                btnToggle.classList.toggle('active', this.particlesEnabled);
                this.currentParticles?.toggleAnimation(this.particlesEnabled);
                this.currentVectorsGroup?.toggleAnimation?.(this.particlesEnabled);
            };
        }

        if (btnPause) {
            btnPause.onclick = () => {
                this.particlesPaused = !this.particlesPaused;
                btnPause.textContent = this.particlesPaused ? 'RESUME' : 'PAUSE';
                btnPause.classList.toggle('active', this.particlesPaused);
                this.currentParticles?.setPaused(this.particlesPaused);
                this.currentVectorsGroup?.setPaused?.(this.particlesPaused);
            };
        }

        if (speedSlider) {
            speedSlider.oninput = (e) => {
                this.currentFlowSpeed = parseFloat(e.target.value);
                if (speedVal) speedVal.textContent = `${this.currentFlowSpeed.toFixed(1)}×`;
                this.currentParticles?.setFlowSpeed(this.currentFlowSpeed);
                this.currentVectorsGroup?.setFlowSpeed?.(this.currentFlowSpeed);
            };
        }

        if (densitySlider) {
            densitySlider.oninput = (e) => {
                this.particleDensity = parseInt(e.target.value, 10);
                if (densityVal) densityVal.textContent = `${this.particleDensity}`;
                this.currentParticles?.setParticleDensity(this.particleDensity);
            };
        }

        if (scaleSlider) {
            scaleSlider.oninput = (e) => {
                this.vectorScale = parseFloat(e.target.value);
                if (scaleVal) scaleVal.textContent = `${this.vectorScale.toFixed(1)}×`;
                this.currentParticles?.setVectorScale(this.vectorScale);
                if (this.currentGrid) {
                    this.renderCurrents(this.currentGrid, this.activeVar === 'currents');
                }
            };
        }
    }

    setupPointInspector() {
        const inspectBtn = document.getElementById('inspectPointBtn');
        const clearBtn = document.getElementById('clearPointBtn');
        const closeBtn = document.getElementById('closeReadout');
        const canvas = document.getElementById('renderCanvas');

        if (inspectBtn) {
            inspectBtn.onclick = () => {
                this.isInspectingPoint = !this.isInspectingPoint;
                inspectBtn.classList.toggle('active', this.isInspectingPoint);
                if (canvas) {
                    canvas.style.cursor = this.isInspectingPoint ? 'crosshair' : 'default';
                }
                if (this.isInspectingPoint) {
                    this.status('Point Inspector Active · Click anywhere on ocean scene to inspect point');
                } else {
                    this.status('Point Inspector Deactivated');
                }
            };
        }

        const clearPoint = () => {
            if (this.markerMesh) {
                this.markerMesh.visible = false;
            }
            this.activeInspectedPoint = null;
            document.getElementById('readout')?.classList.add('hidden');
            clearBtn?.classList.add('hidden');
            if (this.isInspectingPoint) {
                this.isInspectingPoint = false;
                inspectBtn?.classList.remove('active');
                if (canvas) canvas.style.cursor = 'default';
            }
        };

        if (clearBtn) clearBtn.onclick = clearPoint;
        if (closeBtn) closeBtn.onclick = clearPoint;

        // Subtabs
        const tabs = document.querySelectorAll('.readout-tab');
        tabs.forEach(tab => {
            tab.onclick = () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const targetTab = tab.dataset.tab;
                document.querySelectorAll('.readout-tab-content').forEach(c => c.classList.add('hidden'));
                const el = document.getElementById(`readoutTab${targetTab.charAt(0).toUpperCase() + targetTab.slice(1)}`);
                el?.classList.remove('hidden');

                if (targetTab === 'profile' && this.lastInspectedData) {
                    this.renderPointVerticalProfile(this.pointProfileVar);
                } else if (targetTab === 'timeseries' && this.activeInspectedPoint) {
                    this.renderPointTimeseries(this.pointTimeseriesVar);
                }
            };
        });

        // Profile variable pills
        const profPills = document.querySelectorAll('#ptProfilePills .pill-btn');
        profPills.forEach(pill => {
            pill.onclick = () => {
                profPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.pointProfileVar = pill.dataset.var;
                this.renderPointVerticalProfile(this.pointProfileVar);
            };
        });

        // Time series variable pills
        const tsPills = document.querySelectorAll('#ptTimeseriesPills .pill-btn');
        tsPills.forEach(pill => {
            pill.onclick = () => {
                tsPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.pointTimeseriesVar = pill.dataset.var;
                this.renderPointTimeseries(this.pointTimeseriesVar);
            };
        });
    }

    updateProvenanceUI() {
        // No-op, provenance panel removed.
    }
    
    updateHazardUI(hazardData) {
        // Analytical warnings owned by Analysis page per plan.md specification
    }

    _sampleValueFromData(data, lat, lon, depthM = 0) {
        if (!data) return null;
        const bounds = this.currentBathy?.bounds || (this.water?.bounds) || [
            this.currentBBox.min_lon,
            this.currentBBox.max_lon,
            this.currentBBox.min_lat,
            this.currentBBox.max_lat
        ];
        const minLon = bounds[0];
        const maxLon = bounds[1];
        const minLat = bounds[2];
        const maxLat = bounds[3];
        const dLat = maxLat - minLat;
        const dLon = maxLon - minLon;
        if (dLat <= 0 || dLon <= 0) return null;

        // If currents with u and v
        if (data.u && data.v) {
            const lats = data.u.length;
            const lons = data.u[0]?.length || 0;
            if (!lats || !lons) return null;
            const j = Math.floor(((lat - minLat) / dLat) * lats);
            const i = Math.floor(((lon - minLon) / dLon) * lons);
            if (j >= 0 && j < lats && i >= 0 && i < lons) {
                const u = data.u[j]?.[i];
                const v = data.v[j]?.[i];
                if (u != null && v != null) return Math.hypot(u, v);
            }
        }

        // If scalar grid with values
        if (data.values && data.values.length) {
            const is3D = Array.isArray(data.values[0]) && Array.isArray(data.values[0][0]);
            const lats = is3D ? data.values[0].length : data.values.length;
            const lons = is3D ? (data.values[0][0]?.length || 0) : (data.values[0]?.length || 0);
            if (!lats || !lons) return null;
            const j = Math.floor(((lat - minLat) / dLat) * lats);
            const i = Math.floor(((lon - minLon) / dLon) * lons);
            if (j >= 0 && j < lats && i >= 0 && i < lons) {
                if (is3D) {
                    const depthLevels = data.metadata?.depth_levels || [];
                    let dIdx = 0;
                    if (depthLevels.length) {
                        let closestDist = Infinity;
                        depthLevels.forEach((dl, idx) => {
                            const dist = Math.abs(dl - depthM);
                            if (dist < closestDist) {
                                closestDist = dist;
                                dIdx = idx;
                            }
                        });
                    }
                    return data.values[dIdx]?.[j]?.[i];
                } else {
                    return data.values[j]?.[i];
                }
            }
        }
        return null;
    }

    async inspectPoint(cell) {
        if (!cell || cell.lat == null || cell.lon == null) return;
        this.activeInspectedPoint = cell;
        const reqToken = (++this._inspectReqSeq || (this._inspectReqSeq = 1));

        if (window.performance && performance.mark) {
            performance.mark('inspector-click-start');
        }

        // 1. Visual 3D marker beacon (immediate feedback)
        if (!this.markerMesh) {
            const group = new THREE.Group();
            const ringGeom = new THREE.TorusGeometry(2.4, 0.2, 16, 48);
            ringGeom.rotateX(Math.PI / 2);
            const ringMat = new THREE.MeshBasicMaterial({ color: 0x00e5a0, transparent: true, opacity: 0.9 });
            const ring = new THREE.Mesh(ringGeom, ringMat);
            group.add(ring);

            const beaconGeom = new THREE.CylinderGeometry(0.15, 0.6, 8.0, 16);
            beaconGeom.translate(0, 4.0, 0);
            const beaconMat = new THREE.MeshBasicMaterial({ color: 0x00e5a0, transparent: true, opacity: 0.45 });
            const beacon = new THREE.Mesh(beaconGeom, beaconMat);
            group.add(beacon);

            const coreGeom = new THREE.SphereGeometry(0.4, 16, 16);
            coreGeom.translate(0, 0.3, 0);
            const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
            const core = new THREE.Mesh(coreGeom, coreMat);
            group.add(core);

            this.markerMesh = group;
            this.scene.root.add(this.markerMesh);
        }

        const midLat = (this.currentBBox.min_lat + this.currentBBox.max_lat) / 2;
        const midLon = (this.currentBBox.min_lon + this.currentBBox.max_lon) / 2;
        const posX = (cell.lat - midLat) * 111.32;
        const posZ = (cell.lon - midLon) * 111.32 * Math.cos(midLat * Math.PI / 180);
        const pointDepth = cell.depthM != null ? cell.depthM : (this.activeDepth || 0);

        this.markerMesh.position.set(posX, 0.2, posZ);
        this.markerMesh.visible = true;

        // 2. Immediate Readout Shell & Coordinates
        const readout = document.getElementById('readout');
        const coordsEl = document.getElementById('coords');
        const gridEl = document.getElementById('readoutGrid');
        const clearBtn = document.getElementById('clearPointBtn');
        const activeVarNameEl = document.getElementById('readoutActiveVarName');
        const activeVarValEl = document.getElementById('readoutActiveVarVal');

        if (clearBtn) clearBtn.classList.remove('hidden');
        if (coordsEl) coordsEl.textContent = `${cell.lat.toFixed(4)}° N, ${cell.lon.toFixed(4)}° E · Depth: ${pointDepth.toFixed(1)} m`;
        if (activeVarNameEl) activeVarNameEl.textContent = this.activeVar.replace(/_/g, ' ').toUpperCase();
        readout?.classList.remove('hidden');

        // 3. Fast-path: sample active value locally from loaded grid / active bundle immediately!
        let fastVal = this._sampleValueFromData(this.lastOceanData, cell.lat, cell.lon, pointDepth);
        if (fastVal == null && this.activeTime && this.bundleCache[this.activeTime]) {
            const bVar = this._resolveVarData(this.bundleCache[this.activeTime], this.activeVar);
            fastVal = this._sampleValueFromData(bVar, cell.lat, cell.lon, pointDepth);
        }

        const unit = this.lastOceanData?.units || (this.activeVar === 'ocean_temperature' ? '°C' : (this.activeVar === 'salinity' ? 'PSU' : (this.activeVar === 'currents' ? 'm/s' : '')));
        if (activeVarValEl) {
            activeVarValEl.textContent = (fastVal != null && !isNaN(fastVal)) 
                ? `${Number(fastVal).toFixed(2)} ${unit}` 
                : 'Querying…';
        }

        if (gridEl && (!this.lastInspectedData || this.lastInspectedData._token !== reqToken)) {
            gridEl.innerHTML = `
                <div class="readout-depth-control-box">
                    <div class="depth-control-header">
                        <span>DEPTH SOUNDING SLICE</span>
                        <span style="color: #38bdf8; font-weight: 700;">${pointDepth.toFixed(1)} m</span>
                    </div>
                    <div style="color: var(--ink-muted); font-size: 11px; padding: 6px 0;">Loading physical ocean soundings & sensor details…</div>
                </div>
            `;
        }

        if (window.performance && performance.mark) {
            performance.mark('inspector-fast-rendered');
            performance.measure('inspector-fast-render-duration', 'inspector-click-start', 'inspector-fast-rendered');
        }

        this.status('Inspecting ocean point…', 'busy');

        // 4. Background Enrichment: Point Details & ML Analysis
        ApiClient.getPoint(cell.lat, cell.lon, this.activeTime, pointDepth, null, null, { category: 'point_inspect' })
            .then(data => {
                if (this._inspectReqSeq !== reqToken) return;
                data._token = reqToken;
                this.lastInspectedData = data;
                this._populatePointDetails(cell, pointDepth, data);
                if (window.performance && performance.mark) {
                    performance.mark('inspector-enriched');
                    performance.measure('inspector-enrichment-duration', 'inspector-click-start', 'inspector-enriched');
                }
                this.status('Point data loaded.');
            })
            .catch(e => {
                if (this._inspectReqSeq !== reqToken) return;
                console.warn('[SolvXApp] Point inspection secondary load failed:', e);
            });

        ApiClient.getMLPoint(cell.lat, cell.lon, this.activeTime, pointDepth, { category: 'point_ml' })
            .then(mlData => {
                if (this._inspectReqSeq !== reqToken) return;
                this._patchMLPointDetails(mlData);
            })
            .catch(() => {});
    }

    _populatePointDetails(cell, pointDepth, data) {
        const gridEl = document.getElementById('readoutGrid');
        const timeEl = document.getElementById('readoutTime');
        const activeVarValEl = document.getElementById('readoutActiveVarVal');

        const vars = { ...data.variables, ...(this._lastMlPointData?.values || {}) };
        const units = data.units || {};
        const formatVal = (v, u) => (v != null && !isNaN(v)) ? `${Number(v).toFixed(2)} ${u || ''}` : '—';

        // Update active variable value banner with exact point data if available
        let activeValStr = '—';
        if (this.activeVar === 'ocean_temperature') activeValStr = formatVal(vars.ocean_temperature, '°C');
        else if (this.activeVar === 'salinity') activeValStr = formatVal(vars.salinity, 'PSU');
        else if (this.activeVar === 'sea_surface_height') activeValStr = formatVal(vars.sea_surface_height ?? vars.sea_level_anomaly, 'm');
        else if (this.activeVar === 'currents') {
            const spd = vars.current_speed ?? (vars.current_u != null && vars.current_v != null ? Math.hypot(vars.current_u, vars.current_v) : null);
            activeValStr = formatVal(spd, 'm/s');
        } else if (vars[this.activeVar] != null) {
            activeValStr = formatVal(vars[this.activeVar], units[this.activeVar]);
        }
        if (activeVarValEl && activeValStr !== '—') activeVarValEl.textContent = activeValStr;

        // Build Depth Selector Pills
        const standardDepths = [0, 10, 25, 50, 75, 100, 150, 200, 300, 500, 1000];
        const datasetDepths = Array.isArray(data.available_depths) && data.available_depths.length > 0 
            ? data.available_depths 
            : (data.profile?.map(p => p.depth) || standardDepths);
        const combinedDepths = Array.from(new Set([...standardDepths, ...datasetDepths]))
            .filter(d => typeof d === 'number' && !isNaN(d) && d >= 0)
            .sort((a, b) => a - b);

        const depthPillsHtml = combinedDepths.map(d => {
            const isSelected = Math.abs(d - pointDepth) < 0.5;
            const label = d === 0 ? '0m (Surface)' : `${d}m`;
            return `<button class="depth-pill ${isSelected ? 'active' : ''}" data-depth="${d}">${label}</button>`;
        }).join('');

        // Build Sounding Matrix Rows
        const profilePts = Array.isArray(data.profile) ? data.profile : [];
        const soundingRowsHtml = profilePts.length > 0 ? profilePts.map(p => {
            const isSelected = Math.abs(p.depth - pointDepth) < 0.5;
            const tempStr = p.temperature != null ? `${Number(p.temperature).toFixed(2)} °C` : '—';
            const salStr = p.salinity != null ? `${Number(p.salinity).toFixed(2)} PSU` : '—';
            const spdStr = p.current_speed != null ? `${Number(p.current_speed).toFixed(2)} m/s` : '—';
            const densStr = p.density != null ? `${Number(p.density).toFixed(1)}` : '—';
            return `
                <tr class="${isSelected ? 'active-depth-row' : ''}" data-depth="${p.depth}" style="cursor: pointer;" title="Click to slice depth at ${p.depth}m">
                    <td style="font-weight: 600; color: ${isSelected ? '#38bdf8' : '#e2e8f0'};">${p.depth.toFixed(0)}m</td>
                    <td>${tempStr}</td>
                    <td>${salStr}</td>
                    <td>${spdStr}</td>
                    <td>${densStr}</td>
                </tr>
            `;
        }).join('') : '';

        // Tab 1: Variables View
        let gridHtml = `
            <div class="readout-depth-control-box">
                <div class="depth-control-header">
                    <span>DEPTH SOUNDING SLICE</span>
                    <span style="color: #38bdf8; font-weight: 700;">${pointDepth.toFixed(1)} m</span>
                </div>
                <div class="depth-pills-row">
                    ${depthPillsHtml}
                </div>
            </div>

            <div class="readout-category-title">PHYSICAL OCEAN STATE (${pointDepth.toFixed(0)}m)</div>
            <div class="readout-rows">
                <span class="readout-label">Temperature</span>
                <span class="readout-val">${formatVal(vars.ocean_temperature, units.ocean_temperature || '°C')}</span>
                <span class="readout-label">Salinity</span>
                <span class="readout-val">${formatVal(vars.salinity, units.salinity || 'PSU')}</span>
                <span class="readout-label">Sea Surface Height</span>
                <span class="readout-val">${formatVal(vars.sea_surface_height ?? vars.sea_level_anomaly, units.sea_surface_height || 'm')}</span>
                <span class="readout-label">Current Velocity</span>
                <span class="readout-val">${formatVal(vars.current_speed ?? (vars.current_u != null && vars.current_v != null ? Math.hypot(vars.current_u, vars.current_v) : null), 'm/s')}</span>
                <span class="readout-label">Current Direction</span>
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
            <div id="readoutMLSection"></div>
        `;

        if (soundingRowsHtml) {
            gridHtml += `
                <div class="readout-category-title" style="margin-top: 12px; display:flex; justify-content:space-between; align-items:center;">
                    <span>VALUES ACROSS EACH DEPTH</span>
                    <span style="font-size:9px; text-transform:none; color:#94a3b8; font-weight:normal;">Click row to slice depth</span>
                </div>
                <table class="readout-sounding-table">
                    <thead>
                        <tr>
                            <th>Depth</th>
                            <th>Temp</th>
                            <th>Salinity</th>
                            <th>Current</th>
                            <th>Density</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${soundingRowsHtml}
                    </tbody>
                </table>
            `;
        }

        if (gridEl) {
            gridEl.innerHTML = gridHtml;

            // Wire depth pill clicks with instant local profile reuse
            gridEl.querySelectorAll('.depth-pill').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const targetD = parseFloat(btn.dataset.depth);
                    if (!isNaN(targetD)) {
                        this.onDepthChange(targetD);
                        if (this.lastInspectedData && Array.isArray(this.lastInspectedData.profile) && this.lastInspectedData.profile.length > 0) {
                            const row = this.lastInspectedData.profile.find(p => Math.abs(p.depth - targetD) < 0.5);
                            if (row) {
                                this.activeInspectedPoint = { ...cell, depthM: targetD };
                                this._selectSoundingDepthFast(cell, targetD, row);
                                return;
                            }
                        }
                        this.inspectPoint({ ...cell, depthM: targetD });
                    }
                });
            });

            // Wire sounding table row clicks with instant local profile reuse
            gridEl.querySelectorAll('.readout-sounding-table tr[data-depth]').forEach(tr => {
                tr.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const targetD = parseFloat(tr.dataset.depth);
                    if (!isNaN(targetD)) {
                        this.onDepthChange(targetD);
                        if (this.lastInspectedData && Array.isArray(this.lastInspectedData.profile) && this.lastInspectedData.profile.length > 0) {
                            const row = this.lastInspectedData.profile.find(p => Math.abs(p.depth - targetD) < 0.5);
                            if (row) {
                                this.activeInspectedPoint = { ...cell, depthM: targetD };
                                this._selectSoundingDepthFast(cell, targetD, row);
                                return;
                            }
                        }
                        this.inspectPoint({ ...cell, depthM: targetD });
                    }
                });
            });
        }

        if (timeEl) timeEl.textContent = new Date(this.activeTime || data.timestamp || Date.now()).toUTCString();

        // Tab 2: Vertical Profile
        this.renderPointVerticalProfile(this.pointProfileVar);

        // Tab 4: Nearest Observation Collocation
        const matchCard = document.getElementById('pointObsMatchCard');
        if (matchCard) {
            if (data.nearest_observation) {
                const obs = data.nearest_observation;
                const isGlider = obs.type === 'glider' || /glider/i.test(obs.platform || '');
                matchCard.innerHTML = `
                    <div class="obs-match-badge ${isGlider ? 'obs-match-glider' : 'obs-match-argo'}">
                        <span>●</span>
                        <span>${isGlider ? 'AUTONOMOUS GLIDER MATCH' : 'ARGO FLOAT MATCH'} · #${obs.id || obs.wmo || obs.glider_id}</span>
                    </div>
                    <div class="readout-rows" style="margin-top: 6px;">
                        <span class="readout-label">Collocation Distance</span>
                        <span class="readout-val" style="color: var(--accent); font-weight:700;">${obs.distance_km?.toFixed(1) || '0'} km</span>
                        <span class="readout-label">Time Offset</span>
                        <span class="readout-val">${obs.time_diff_days != null ? `${obs.time_diff_days.toFixed(1)} days` : (obs.time_diff_hours != null ? `${obs.time_diff_hours.toFixed(1)} hrs` : 'Concurrent')}</span>
                        <span class="readout-label">Platform</span>
                        <span class="readout-val">${obs.platform || (isGlider ? 'Underwater Glider' : 'CTD Float')}</span>
                        <span class="readout-label">Institution</span>
                        <span class="readout-val">${obs.institution || 'INCOIS / Argo'}</span>
                    </div>
                    ${obs.model_sst != null && obs.observed_sst != null ? `
                        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); font-size: 11px;">
                            <div style="color: var(--ink-muted); font-size: 10px; margin-bottom: 4px;">SURFACE SST COMPARISON</div>
                            <div class="readout-rows">
                                <span class="readout-label">Observed SST</span>
                                <span class="readout-val">${obs.observed_sst.toFixed(2)} °C</span>
                                <span class="readout-label">Model SST</span>
                                <span class="readout-val">${obs.model_sst.toFixed(2)} °C</span>
                                <span class="readout-label">Absolute Bias</span>
                                <span class="readout-val" style="color:${Math.abs(obs.diff_sst) > 0.5 ? '#f59e0b' : '#10b981'}">${(obs.diff_sst > 0 ? '+' : '') + obs.diff_sst.toFixed(2)} °C</span>
                            </div>
                        </div>
                    ` : ''}
                    <button id="btnOpenMatchedObs" class="btn-secondary" style="width: 100%; margin-top: 10px; font-size: 11px; padding: 6px 10px;">
                        VIEW IN OBSERVATION DRAWER →
                    </button>
                `;
                document.getElementById('btnOpenMatchedObs')?.addEventListener('click', () => {
                    this.profileViewer?.show(obs, this.activeTime);
                });
            } else {
                matchCard.innerHTML = `
                    <div style="color: var(--ink-muted); font-size: 11px; text-align: center; padding: 12px 0;">
                        No in-situ Argo float or Glider observation within 100 km of this position.
                    </div>
                `;
            }
        }

        const openAnalysisBtn = document.getElementById('btnOpenAnalysisFromReadout');
        if (openAnalysisBtn) {
            openAnalysisBtn.onclick = () => {
                SelectionContext.setSelection({
                    type: 'cell',
                    lat: cell.lat,
                    lon: cell.lon,
                    depth: pointDepth
                });
                window.location.href = `/analysis.html?lat=${cell.lat.toFixed(4)}&lon=${cell.lon.toFixed(4)}`;
            };
        }
    }

    _selectSoundingDepthFast(cell, targetD, row) {
        const coordsEl = document.getElementById('coords');
        const activeVarValEl = document.getElementById('readoutActiveVarVal');
        if (coordsEl) coordsEl.textContent = `${cell.lat.toFixed(4)}° N, ${cell.lon.toFixed(4)}° E · Depth: ${targetD.toFixed(1)} m`;

        // Update active variable banner if row contains it
        if (activeVarValEl) {
            if (this.activeVar === 'ocean_temperature' && row.temperature != null) {
                activeVarValEl.textContent = `${Number(row.temperature).toFixed(2)} °C`;
            } else if (this.activeVar === 'salinity' && row.salinity != null) {
                activeVarValEl.textContent = `${Number(row.salinity).toFixed(2)} PSU`;
            } else if (this.activeVar === 'currents' && row.current_speed != null) {
                activeVarValEl.textContent = `${Number(row.current_speed).toFixed(2)} m/s`;
            }
        }

        // Update pill active class
        document.querySelectorAll('.depth-pill').forEach(btn => {
            const d = parseFloat(btn.dataset.depth);
            btn.classList.toggle('active', Math.abs(d - targetD) < 0.5);
        });

        // Update table row active class
        document.querySelectorAll('.readout-sounding-table tr[data-depth]').forEach(tr => {
            const d = parseFloat(tr.dataset.depth);
            const isMatch = Math.abs(d - targetD) < 0.5;
            tr.classList.toggle('active-depth-row', isMatch);
            const firstTd = tr.querySelector('td');
            if (firstTd) firstTd.style.color = isMatch ? '#38bdf8' : '#e2e8f0';
        });

        // Update depth header label
        const depthHeaderEl = document.querySelector('.depth-control-header span:last-child');
        if (depthHeaderEl) depthHeaderEl.textContent = `${targetD.toFixed(1)} m`;
    }

    _patchMLPointDetails(mlData) {
        this._lastMlPointData = mlData;
        const mlSection = document.getElementById('readoutMLSection');
        if (mlSection && (mlData?.anomaly || mlData?.hazard)) {
            const aScore = mlData.anomaly?.anomaly_score;
            const hRisk = mlData.hazard?.risk_score;
            mlSection.innerHTML = `
                <div class="readout-category-title">HAZARD RISK & ANOMALIES</div>
                <div class="readout-rows">
                    <span class="readout-label">Anomaly Score</span>
                    <span class="readout-val">${aScore != null ? `${Number(aScore).toFixed(1)} / 100` : 'Normal'}</span>
                    <span class="readout-label">Hazard Risk</span>
                    <span class="readout-val">${hRisk != null ? `${Number(hRisk).toFixed(1)} / 100` : 'Low'}</span>
                </div>
            `;
        }
    }

    renderPointVerticalProfile(varName = 'temperature') {
        const svg = document.getElementById('ptProfileSvg');
        const tooltip = document.getElementById('ptProfileTooltip');
        const tableBox = document.getElementById('ptProfileTable');
        const profile = this.lastInspectedData?.profile;

        if (!svg) return;
        if (!profile || !profile.length) {
            svg.innerHTML = '<text x="170" y="110" fill="#64748b" text-anchor="middle" font-size="11">No vertical sounding profile available</text>';
            if (tableBox) tableBox.innerHTML = '';
            return;
        }

        const validPts = profile.filter(p => p[varName] != null && !isNaN(p[varName]));
        if (!validPts.length) {
            svg.innerHTML = `<text x="170" y="110" fill="#64748b" text-anchor="middle" font-size="11">No ${varName} data along vertical column</text>`;
            return;
        }

        const depths = validPts.map(p => p.depth);
        const vals = validPts.map(p => p[varName]);
        const minD = Math.min(...depths);
        const maxD = Math.max(...depths);
        const minV = Math.min(...vals);
        const maxV = Math.max(...vals);
        const vSpan = (maxV - minV) || 1.0;
        const dSpan = (maxD - minD) || 1.0;

        const W = 340, H = 220;
        const padL = 45, padR = 20, padT = 20, padB = 30;
        const innerW = W - padL - padR;
        const innerH = H - padT - padB;

        // Depth on Y axis (inverted: 0m at top down to maxD), Value on X axis
        const scaleX = (v) => padL + ((v - minV) / vSpan) * innerW;
        const scaleY = (d) => padT + ((d - minD) / dSpan) * innerH;

        let pathD = '';
        validPts.forEach((p, i) => {
            const x = scaleX(p[varName]);
            const y = scaleY(p.depth);
            pathD += (i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`);
        });

        const colorMap = { temperature: '#00d2ff', salinity: '#10b981', current_speed: '#f59e0b' };
        const strokeColor = colorMap[varName] || '#00d2ff';
        const unitMap = { temperature: '°C', salinity: 'PSU', current_speed: 'm/s' };
        const unit = unitMap[varName] || '';

        let svgHtml = `
            <!-- Grid Lines -->
            <line x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}" stroke="rgba(255,255,255,0.08)" />
            <line x1="${padL}" y1="${padT + innerH / 2}" x2="${W - padR}" y2="${padT + innerH / 2}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="3,3" />
            <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="rgba(255,255,255,0.08)" />
            
            <!-- Axes Labels -->
            <text x="${padL - 6}" y="${padT + 4}" fill="#64748b" text-anchor="end" font-size="9" font-family="monospace">${minD.toFixed(0)}m</text>
            <text x="${padL - 6}" y="${padT + innerH / 2 + 4}" fill="#64748b" text-anchor="end" font-size="9" font-family="monospace">${((minD + maxD) / 2).toFixed(0)}m</text>
            <text x="${padL - 6}" y="${H - padB + 4}" fill="#64748b" text-anchor="end" font-size="9" font-family="monospace">${maxD.toFixed(0)}m</text>

            <text x="${padL}" y="${H - 10}" fill="#64748b" text-anchor="start" font-size="9" font-family="monospace">${minV.toFixed(1)} ${unit}</text>
            <text x="${W - padR}" y="${H - 10}" fill="#64748b" text-anchor="end" font-size="9" font-family="monospace">${maxV.toFixed(1)} ${unit}</text>

            <!-- Curve -->
            <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" />
        `;

        validPts.forEach(p => {
            const x = scaleX(p[varName]);
            const y = scaleY(p.depth);
            svgHtml += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${strokeColor}" stroke="#030a12" stroke-width="1.5" class="profile-chart-pt" data-depth="${p.depth.toFixed(1)}" data-val="${p[varName].toFixed(2)}" />`;
        });

        svg.innerHTML = svgHtml;

        // Hover tooltips
        svg.querySelectorAll('.profile-chart-pt').forEach(pt => {
            pt.addEventListener('mouseenter', (e) => {
                const depth = pt.dataset.depth;
                const val = pt.dataset.val;
                if (tooltip) {
                    tooltip.innerHTML = `Depth: <b>${depth}m</b> · ${varName}: <b>${val} ${unit}</b>`;
                    tooltip.style.left = `${parseFloat(pt.getAttribute('cx')) + 8}px`;
                    tooltip.style.top = `${parseFloat(pt.getAttribute('cy')) - 12}px`;
                    tooltip.classList.remove('hidden');
                }
            });
            pt.addEventListener('mouseleave', () => {
                tooltip?.classList.add('hidden');
            });
        });

        // Table
        if (tableBox) {
            tableBox.innerHTML = `
                <table style="width: 100%; border-collapse: collapse; text-align: right;">
                    <thead>
                        <tr style="color: var(--ink-muted); border-bottom: 1px solid var(--line); font-size: 10px;">
                            <th style="padding: 2px 4px; text-align: left;">Depth</th>
                            <th style="padding: 2px 4px;">Temp</th>
                            <th style="padding: 2px 4px;">Salinity</th>
                            <th style="padding: 2px 4px;">Current</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${profile.map(p => `
                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                                <td style="padding: 2px 4px; text-align: left;">${p.depth.toFixed(1)} m</td>
                                <td style="padding: 2px 4px;">${p.temperature != null ? `${p.temperature.toFixed(2)} °C` : '—'}</td>
                                <td style="padding: 2px 4px;">${p.salinity != null ? `${p.salinity.toFixed(2)}` : '—'}</td>
                                <td style="padding: 2px 4px;">${p.current_speed != null ? `${p.current_speed.toFixed(2)} m/s` : '—'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    }

    async renderPointTimeseries(varName = 'temperature') {
        const svg = document.getElementById('ptTimeseriesSvg');
        const tooltip = document.getElementById('ptTimeseriesTooltip');
        const summaryBox = document.getElementById('ptTimeseriesSummary');
        if (!svg || !this.activeInspectedPoint) return;

        svg.innerHTML = '<text x="170" y="100" fill="#64748b" text-anchor="middle" font-size="11">Loading time series evolution…</text>';

        try {
            const data = await ApiClient.getPointTimeseries(
                this.activeInspectedPoint.lat,
                this.activeInspectedPoint.lon,
                varName,
                this.activeInspectedPoint.depthM || 0
            );

            const points = data?.timeseries || [];
            if (!points.length) {
                svg.innerHTML = '<text x="170" y="100" fill="#64748b" text-anchor="middle" font-size="11">No time series points returned</text>';
                return;
            }

            const vals = points.map(p => p.value);
            const minV = Math.min(...vals);
            const maxV = Math.max(...vals);
            const vSpan = (maxV - minV) || 1.0;

            const W = 340, H = 200;
            const padL = 45, padR = 20, padT = 20, padB = 30;
            const innerW = W - padL - padR;
            const innerH = H - padT - padB;

            const scaleX = (i) => padL + (i / Math.max(1, points.length - 1)) * innerW;
            const scaleY = (v) => H - padB - ((v - minV) / vSpan) * innerH;

            let pathD = '';
            points.forEach((p, i) => {
                const x = scaleX(i);
                const y = scaleY(p.value);
                pathD += (i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`);
            });

            const colorMap = { temperature: '#00d2ff', salinity: '#10b981', current_speed: '#f59e0b' };
            const strokeColor = colorMap[varName] || '#00d2ff';
            const unit = data.unit || '';

            const startDate = new Date(points[0].time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            const endDate = new Date(points[points.length - 1].time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

            let svgHtml = `
                <!-- Grid Lines -->
                <line x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}" stroke="rgba(255,255,255,0.08)" />
                <line x1="${padL}" y1="${padT + innerH / 2}" x2="${W - padR}" y2="${padT + innerH / 2}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="3,3" />
                <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="rgba(255,255,255,0.08)" />

                <!-- Axes -->
                <text x="${padL - 6}" y="${padT + 4}" fill="#64748b" text-anchor="end" font-size="9" font-family="monospace">${maxV.toFixed(1)}</text>
                <text x="${padL - 6}" y="${H - padB + 4}" fill="#64748b" text-anchor="end" font-size="9" font-family="monospace">${minV.toFixed(1)}</text>

                <text x="${padL}" y="${H - 10}" fill="#64748b" text-anchor="start" font-size="9" font-family="monospace">${startDate}</text>
                <text x="${W - padR}" y="${H - 10}" fill="#64748b" text-anchor="end" font-size="9" font-family="monospace">${endDate}</text>

                <!-- Curve -->
                <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" />
            `;

            points.forEach((p, i) => {
                const x = scaleX(i);
                const y = scaleY(p.value);
                const dt = new Date(p.time).toISOString().slice(0, 10);
                svgHtml += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${strokeColor}" stroke="#030a12" stroke-width="1.5" class="ts-chart-pt" data-time="${dt}" data-val="${p.value.toFixed(2)}" />`;
            });

            svg.innerHTML = svgHtml;

            // Hover tooltips
            svg.querySelectorAll('.ts-chart-pt').forEach(pt => {
                pt.addEventListener('mouseenter', () => {
                    const time = pt.dataset.time;
                    const val = pt.dataset.val;
                    if (tooltip) {
                        tooltip.innerHTML = `${time} · <b>${val} ${unit}</b>`;
                        tooltip.style.left = `${parseFloat(pt.getAttribute('cx')) + 8}px`;
                        tooltip.style.top = `${parseFloat(pt.getAttribute('cy')) - 12}px`;
                        tooltip.classList.remove('hidden');
                    }
                });
                pt.addEventListener('mouseleave', () => {
                    tooltip?.classList.add('hidden');
                });
            });

            if (summaryBox && data.stats) {
                summaryBox.innerHTML = `
                    <span>Min: <b>${data.stats.min?.toFixed(2)} ${unit}</b></span>
                    <span>Max: <b>${data.stats.max?.toFixed(2)} ${unit}</b></span>
                    <span>Mean: <b>${data.stats.mean?.toFixed(2)} ${unit}</b></span>
                    <span>(${data.stats.count} steps)</span>
                `;
            }
        } catch (err) {
            console.error('Time series fetch error:', err);
            svg.innerHTML = `<text x="170" y="100" fill="#ff4455" text-anchor="middle" font-size="11">Time series error: ${err.message}</text>`;
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
            await this.profileViewer.show(argo, this.activeTime);
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
