/**
 * Main Application Controller for SolvX Volume Renderer Test Prototype.
 * Coordinates Three.js rendering, data loading, land, seabed, volume ray-marching, and UI.
 */

import * as THREE from 'three';
import { CameraManager } from './scene/camera.js';
import { OceanVolumeManager } from './scene/ocean.js';
import { buildLandMesh } from './scene/land.js';
import { buildSeabedMesh } from './scene/seabed.js';
import { buildCoastlines } from './scene/coastline.js';
import { GeographicTransform } from './scene/geographicTransform.js';
import { createOceanVolumeTexture } from './renderer/volumeTexture.js';
import { AppGui } from './controls/gui.js';
import { OceanProbe } from './controls/controls.js';

class App {
    constructor() {
        this.canvas = document.getElementById('ocean-canvas');
        this.spinner = document.getElementById('spinner');
        this.spinnerText = document.getElementById('spinner-text');

        // Scene Layers
        this.landMesh = null;
        this.seabedMesh = null;
        this.coastlineMesh = null;
        this.geometryData = null;
        this.bathymetryData = null;
        this.datasetMeta = null;
        this.geoConfig = null;

        // Current Dataset State
        this.currentDataset = 'synthetic_ocean.nc';
        this.currentVariable = 'temperature';
        this.currentTime = 0;
        this.currentStride = 1;
        this.verticalExaggeration = 5.0;

        // Performance Metrics
        this.fpsFrames = 0;
        this.lastFpsTime = performance.now();
        this.currentFps = 60;

        this.initThree();
        this.initScene();
        this.initControls();
        this.initUI();

        this.loadInitialData();
        this.animate();
    }

    initThree() {
        const width = this.canvas.clientWidth || window.innerWidth;
        const height = this.canvas.clientHeight || window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.autoClear = false;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x080e1a); // Deep marine background

        // Depth render target for solid geometry occlusion (seabed & land)
        const depthTexture = new THREE.DepthTexture();
        depthTexture.format = THREE.DepthFormat;
        depthTexture.type = THREE.UnsignedShortType;

        this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
            depthTexture: depthTexture,
            depthBuffer: true,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
        });

        // Camera manager
        this.cameraManager = new CameraManager(this.canvas);
        this.camera = this.cameraManager.camera;

        window.addEventListener('resize', this.onWindowResize.bind(this));
    }

    initScene() {
        // Lighting
        const ambient = new THREE.AmbientLight(0xffffff, 1.2);
        this.scene.add(ambient);

        const sun = new THREE.DirectionalLight(0xffffff, 1.5);
        sun.position.set(400, 1000, 600);
        this.scene.add(sun);

        const fill = new THREE.DirectionalLight(0x38bdf8, 0.6);
        fill.position.set(-400, -300, -400);
        this.scene.add(fill);

        // Ocean Volume Manager
        this.oceanManager = new OceanVolumeManager(this.scene, this);
        this.oceanManager.volumeRenderer.uniforms.depthTexture.value = this.renderTarget.depthTexture;
    }

    initControls() {
        // Setup Probe
        this.probe = new OceanProbe(this.canvas, this.camera, this.oceanManager, this.displayProbeResult.bind(this));

        // Quick View Buttons
        document.getElementById('btn-3d').addEventListener('click', () => {
            this.setActiveViewBtn('btn-3d');
            this.cameraManager.setView('3d');
        });
        document.getElementById('btn-top').addEventListener('click', () => {
            this.setActiveViewBtn('btn-top');
            this.cameraManager.setView('top');
        });
        document.getElementById('btn-side').addEventListener('click', () => {
            this.setActiveViewBtn('btn-side');
            this.cameraManager.setView('side');
        });
        document.getElementById('btn-reset').addEventListener('click', () => {
            this.setActiveViewBtn('btn-reset');
            this.cameraManager.setView('reset');
        });

        // Close probe card
        document.getElementById('probe-close').addEventListener('click', () => {
            document.getElementById('probe-card').style.display = 'none';
        });
    }

    setActiveViewBtn(btnId) {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        const el = document.getElementById(btnId);
        if (el) el.classList.add('active');
    }

    initUI() {
        this.gui = new AppGui(this);
    }

    showSpinner(text) {
        this.spinnerText.textContent = text || 'Loading...';
        this.spinner.style.display = 'flex';
    }

    hideSpinner() {
        this.spinner.style.display = 'none';
    }

    async loadInitialData() {
        this.showSpinner('Loading Geographic Context (Land & Seabed)...');

        try {
            // 1. Fetch Geometry & Bathymetry
            const [geomRes, bathyRes] = await Promise.all([
                fetch('/api/geometry').then(r => r.json()).catch(() => null),
                fetch('/api/bathymetry').then(r => r.json()).catch(() => null),
            ]);

            this.geometryData = geomRes;
            this.bathymetryData = bathyRes;

            this.rebuildGeographicLayers();

            // 2. Fetch Datasets
            const dsListRes = await fetch('/api/datasets').then(r => r.json());
            if (dsListRes && dsListRes.datasets && dsListRes.datasets.length) {
                this.gui.updateDatasetList(dsListRes.datasets);
                // Prefer synthetic_ocean.nc first as per test sequence
                if (dsListRes.datasets.includes('synthetic_ocean.nc')) {
                    this.currentDataset = 'synthetic_ocean.nc';
                } else {
                    this.currentDataset = dsListRes.datasets[0];
                }
                this.gui.params.dataset = this.currentDataset;
            }

            // 3. Load Selected Dataset
            await this.loadDatasetMetaAndVolume();
        } catch (err) {
            console.error('Initial data loading error:', err);
            this.showSpinner(`Error loading data: ${err.message}`);
        }
    }

    getGeoConfig() {
        const bounds = this.datasetMeta?.bounds || this.geometryData?.bounds || [84.105, 92.993, 16.071, 23.524, 0, 1000];
        return GeographicTransform.createGeoConfig(bounds, {
            verticalExaggeration: this.verticalExaggeration,
        });
    }

    rebuildGeographicLayers() {
        this.geoConfig = this.getGeoConfig();

        // 1. Land Topography
        if (this.landMesh) {
            this.scene.remove(this.landMesh);
            this.landMesh = null;
        }
        if (this.geometryData) {
            this.landMesh = buildLandMesh(this.geometryData, this.geoConfig);
            this.landMesh.visible = this.gui?.params?.showLand ?? true;
            this.scene.add(this.landMesh);
        }

        // 2. Coastline Vectors
        if (this.coastlineMesh) {
            this.scene.remove(this.coastlineMesh);
            this.coastlineMesh = null;
        }
        if (this.geometryData) {
            this.coastlineMesh = buildCoastlines(this.geometryData, this.geoConfig);
            this.coastlineMesh.visible = this.gui?.params?.showCoastline ?? true;
            this.scene.add(this.coastlineMesh);
        }

        // 3. Bathymetric Seabed
        if (this.seabedMesh) {
            this.scene.remove(this.seabedMesh);
            this.seabedMesh = null;
        }
        if (this.bathymetryData) {
            this.seabedMesh = buildSeabedMesh(this.bathymetryData, this.geoConfig);
            if (this.seabedMesh) {
                this.seabedMesh.visible = this.gui?.params?.showSeabed ?? true;
                this.scene.add(this.seabedMesh);
            }
        }

        // 4. Update Coordinate Grid in OceanVolumeManager
        if (this.oceanManager) {
            this.oceanManager.updateCoordinateGrid(this.geoConfig);
        }
    }

    async loadDatasetMetaAndVolume() {
        this.showSpinner(`Inspecting ${this.currentDataset}...`);

        try {
            // 1. Get Dataset Info
            const metaRes = await fetch(`/api/dataset?dataset=${encodeURIComponent(this.currentDataset)}`);
            if (!metaRes.ok) {
                const errData = await metaRes.json();
                throw new Error(errData.detail || 'Failed to inspect dataset');
            }
            const dsInfo = await metaRes.json();
            this.datasetMeta = dsInfo;

            // Rebuild scene geographic layers matching new dataset domain
            this.rebuildGeographicLayers();

            // Update variables list
            if (dsInfo.variables && dsInfo.variables.length) {
                this.gui.updateVariableList(dsInfo.variables);
                // Check if currentVariable is present
                const varNames = dsInfo.variables.map(v => v.name);
                if (!varNames.includes(this.currentVariable)) {
                    this.currentVariable = varNames[0];
                    this.gui.params.variable = this.currentVariable;
                }
            }

            // Update time slider
            this.gui.updateTimeLimits(dsInfo.times);

            // Update depth limits
            if (dsInfo.bounds.depth_max) {
                this.gui.updateDepthLimits(dsInfo.bounds.depth_min || 0, dsInfo.bounds.depth_max);
            }

            // 2. Fetch and Render Volume
            await this.reloadVolume();
        } catch (err) {
            console.error('Error in loadDatasetMetaAndVolume:', err);
            alert(`Dataset Error: ${err.message}`);
            this.hideSpinner();
        }
    }

    async reloadVolume() {
        this.showSpinner(`Loading 3D Volume (${this.currentVariable})...`);

        try {
            const colorMode = this.gui?.params?.colorMode || 'variable';
            const url = `/api/volume/binary?dataset=${encodeURIComponent(this.currentDataset)}&variable=${encodeURIComponent(this.currentVariable)}&time=${this.currentTime}&stride=${this.gui.params.stride}&color_mode=${encodeURIComponent(colorMode)}`;
            const metaUrl = `/api/volume/metadata?dataset=${encodeURIComponent(this.currentDataset)}&variable=${encodeURIComponent(this.currentVariable)}&time=${this.currentTime}&stride=${this.gui.params.stride}&color_mode=${encodeURIComponent(colorMode)}`;

            const [metaRes, binRes] = await Promise.all([
                fetch(metaUrl).then(r => r.json()),
                fetch(url).then(r => r.arrayBuffer()),
            ]);

            this.geoConfig = this.getGeoConfig();

            const volumeResult = createOceanVolumeTexture(binRes, metaRes, {
                verticalExaggeration: this.verticalExaggeration,
                geoConfig: this.geoConfig,
            });

            this.oceanManager.applyVolumeData(volumeResult);
            this.updateHUD(metaRes);
            this.hideSpinner();
        } catch (err) {
            console.error('Volume fetch error:', err);
            alert(`Failed to load volume: ${err.message}`);
            this.hideSpinner();
        }
    }

    onColorModeChange(mode) {
        this.reloadVolume();
    }

    onDatasetChange(datasetName) {
        this.currentDataset = datasetName;
        this.currentTime = 0;
        this.loadDatasetMetaAndVolume();
    }

    onVariableChange(varName) {
        this.currentVariable = varName;
        // Automatically select appropriate palette
        if (varName.includes('sal') || varName === 'so') {
            this.gui.params.palette = 'Haline (Salinity)';
        } else if (varName.includes('chl')) {
            this.gui.params.palette = 'Chlorophyll';
        } else {
            this.gui.params.palette = 'Ocean Thermal (Turbo)';
        }
        this.oceanManager.setPalette(this.gui.params.palette);
        this.reloadVolume();
    }

    onTimeChange(timeIdx) {
        this.currentTime = Math.round(timeIdx);
        this.reloadVolume();
    }

    onExaggerationChange(exVal) {
        this.verticalExaggeration = exVal;
        this.rebuildGeographicLayers();
        this.reloadVolume();
    }

    updateHUD(meta) {
        document.getElementById('hud-dataset').textContent = this.currentDataset;
        document.getElementById('hud-variable').textContent = `${meta.long_name || meta.variable} (${meta.units})`;
        document.getElementById('hud-shape').textContent = `${meta.shape[2]} × ${meta.shape[1]} × ${meta.shape[0]}`;

        const totalVoxels = meta.shape[0] * meta.shape[1] * meta.shape[2];
        document.getElementById('hud-voxels').textContent = `${totalVoxels.toLocaleString()} voxels`;

        const b = meta.bounds;
        document.getElementById('hud-lat').textContent = `${b.lat_min.toFixed(2)}° → ${b.lat_max.toFixed(2)}°`;
        document.getElementById('hud-lon').textContent = `${b.lon_min.toFixed(2)}° → ${b.lon_max.toFixed(2)}°`;
        document.getElementById('hud-depth').textContent = `${b.depth_min.toFixed(0)}m → ${b.depth_max.toFixed(0)}m`;

        const pr = meta.physical_range;
        document.getElementById('hud-range').textContent = `${pr.min.toFixed(2)} → ${pr.max.toFixed(2)} ${meta.units}`;
    }

    displayProbeResult(result) {
        const card = document.getElementById('probe-card');
        const hudCursor = document.getElementById('hud-cursor');

        if (!result) {
            hudCursor.textContent = 'Outside volume';
            return;
        }

        hudCursor.textContent = `${result.latitude}°, ${result.longitude}°, ${result.depthMeters}m`;

        document.getElementById('probe-lon').textContent = `${result.longitude}°E`;
        document.getElementById('probe-lat').textContent = `${result.latitude}°N`;
        document.getElementById('probe-depth').textContent = `${result.depthMeters} m`;

        const seabedEl = document.getElementById('probe-seabed');
        const statusEl = document.getElementById('probe-status');

        if (seabedEl) {
            seabedEl.textContent = result.seabedDepth != null ? `${result.seabedDepth} m` : 'Querying...';
        }

        let statusText = 'In Ocean';
        let statusColor = '#34d399'; // green

        if (result.isLand) {
            statusText = 'Outside Ocean (Land)';
            statusColor = '#f87171'; // red
        } else if (result.isBelowSeabed || (result.seabedDepth != null && result.depthMeters > result.seabedDepth)) {
            statusText = 'Outside Ocean (Below Seabed)';
            statusColor = '#f59e0b'; // amber
        } else if (result.isMasked) {
            statusText = 'Masked / Boundary';
            statusColor = '#f87171';
        }

        if (statusEl) {
            statusEl.textContent = statusText;
            statusEl.style.color = statusColor;
        }

        if (statusText !== 'In Ocean') {
            document.getElementById('probe-val').textContent = `-- (${statusText})`;
            document.getElementById('probe-truth').textContent = '--';
        } else {
            document.getElementById('probe-val').textContent = `${result.physicalValue} ${result.units}`;
            document.getElementById('probe-truth').textContent = result.backendGroundTruth != null
                ? `${result.backendGroundTruth.toFixed(2)} ${result.units}`
                : 'Verifying...';
        }

        // Position card near mouse click
        const screenX = Math.min(result.screenPos.x + 15, window.innerWidth - 240);
        const screenY = Math.max(result.screenPos.y, 100);
        card.style.left = `${screenX}px`;
        card.style.top = `${screenY}px`;
        card.style.display = 'block';
    }

    onWindowResize() {
        const width = this.canvas.clientWidth || window.innerWidth;
        const height = this.canvas.clientHeight || window.innerHeight;

        this.renderer.setSize(width, height);
        this.renderTarget.setSize(width, height);
        this.cameraManager.onResize();
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));

        // FPS meter
        this.fpsFrames++;
        const now = performance.now();
        if (now - this.lastFpsTime >= 1000) {
            this.currentFps = Math.round((this.fpsFrames * 1000) / (now - this.lastFpsTime));
            document.getElementById('hud-fps').textContent = `${this.currentFps} FPS`;
            this.fpsFrames = 0;
            this.lastFpsTime = now;
        }

        this.cameraManager.update();
        this.oceanManager.update();

        // 1. Render ONLY solid geometry (land + seabed) to off-screen renderTarget for depth buffer
        this.oceanManager.volumeRenderer.visible = false;
        this.oceanManager.wireframeBox.visible = false;
        this.oceanManager.setGridVisible(false);
        if (this.coastlineMesh) this.coastlineMesh.visible = false;
        this.renderer.setRenderTarget(this.renderTarget);
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);

        // 2. Restore wireframe/grid/coastlines and render scene to screen
        this.oceanManager.wireframeBox.visible = this.gui.params.showBoundingBox;
        this.oceanManager.setGridVisible(this.gui.params.showGrid);
        if (this.coastlineMesh) this.coastlineMesh.visible = this.gui.params.showCoastline;
        this.renderer.setRenderTarget(null);
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);

        // 3. Render volume on top using volumetric depth occlusion
        if (this.gui.params.showOcean) {
            this.oceanManager.volumeRenderer.visible = true;
            this.renderer.render(this.oceanManager.volumeRenderer, this.camera);
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.appInstance = new App();
});
