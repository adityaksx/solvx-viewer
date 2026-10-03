/**
 * UI Controls Panel and Diagnostic HUD for SolvX Test Prototype.
 * Follows Sections 28, 29, 30, 34, 54, 55 of the prototype plan.
 */

import { GUI } from 'lil-gui';
import { getAvailablePalettes } from '../renderer/palette.js';

export class AppGui {
    constructor(app, container = null) {
        this.app = app;
        this.gui = new GUI({ container: container || undefined, title: 'SolvX Volume Explorer' });

        this.params = {
            // Dataset
            dataset: 'synthetic_ocean.nc',
            variable: 'temperature',
            time: 0,
            stride: 1,

            // Rendering
            colorMode: 'variable',
            opacity: 0.85,
            raySteps: 128,
            verticalExaggeration: 70.0,
            palette: 'Ocean Thermal (Turbo)',
            paletteMin: 0.0,
            paletteMax: 1.0,
            extinction: 0.20,

            // Depth
            depthMin: 0,
            depthMax: 1000,
            sliceMode: false,
            sliceDepth: 100,

            // Layers
            showOcean: true,
            showSeabed: true,
            showLand: true,
            showCoastline: true,
            showBoundingBox: true,
            showGrid: true,

            // Camera Views
            viewTop: () => this.app.cameraManager.setView('top'),
            viewSide: () => this.app.cameraManager.setView('side'),
            view3D: () => this.app.cameraManager.setView('3d'),
            viewReset: () => this.app.cameraManager.setView('reset'),
        };

        this.folders = {};
        this.controllers = {};
        this.initGui();
    }

    initGui() {
        // ---- 1. Dataset Folder ----
        const fData = this.gui.addFolder('Dataset & Variable');
        this.folders.dataset = fData;

        this.controllers.dataset = fData.add(this.params, 'dataset', ['synthetic_ocean.nc'])
            .name('Dataset')
            .onChange(val => this.app.onDatasetChange(val));

        this.controllers.variable = fData.add(this.params, 'variable', ['temperature'])
            .name('Variable')
            .onChange(val => this.app.onVariableChange(val));

        this.controllers.time = fData.add(this.params, 'time', 0, 0, 1)
            .name('Time Step')
            .onChange(val => this.app.onTimeChange(val));

        this.controllers.stride = fData.add(this.params, 'stride', [1, 2, 4])
            .name('Resolution / Stride')
            .onChange(val => this.app.reloadVolume());

        fData.open();

        // ---- 2. Rendering Folder ----
        const fRender = this.gui.addFolder('Volume Rendering');
        this.folders.render = fRender;

        fRender.add(this.params, 'colorMode', ['variable', 'depth', 'bathymetry', 'mask'])
            .name('Color Mode')
            .onChange(val => this.app.onColorModeChange(val));

        fRender.add(this.params, 'opacity', 0.0, 1.0, 0.02)
            .name('Ocean Opacity')
            .onChange(val => this.app.oceanManager.setOpacity(val));

        fRender.add(this.params, 'raySteps', [32, 64, 128, 256])
            .name('Ray Steps')
            .onChange(val => this.app.oceanManager.setRaySteps(Number(val)));

        fRender.add(this.params, 'verticalExaggeration', 1.0, 100.0, 1.0)
            .name('Vertical Exaggeration')
            .onChange(val => this.app.onExaggerationChange(val));

        fRender.add(this.params, 'palette', getAvailablePalettes())
            .name('Color Palette')
            .onChange(val => this.app.oceanManager.setPalette(val));

        fRender.add(this.params, 'paletteMin', 0.0, 1.0, 0.02)
            .name('Palette Min')
            .onChange(val => this.app.oceanManager.setPaletteRange(val, this.params.paletteMax));

        fRender.add(this.params, 'paletteMax', 0.0, 1.0, 0.02)
            .name('Palette Max')
            .onChange(val => this.app.oceanManager.setPaletteRange(this.params.paletteMin, val));

        fRender.add(this.params, 'extinction', 0.01, 0.20, 0.01)
            .name('Extinction')
            .onChange(val => this.app.oceanManager.setExtinction(val));

        fRender.open();

        // ---- 3. Depth Exploration Folder ----
        const fDepth = this.gui.addFolder('Depth Exploration');
        this.folders.depth = fDepth;

        this.controllers.depthMin = fDepth.add(this.params, 'depthMin', 0, 1000, 10)
            .name('Min Depth (m)')
            .onChange(() => this.updateDepthRange());

        this.controllers.depthMax = fDepth.add(this.params, 'depthMax', 0, 1000, 10)
            .name('Max Depth (m)')
            .onChange(() => this.updateDepthRange());

        fDepth.add(this.params, 'sliceMode')
            .name('2D Slice Mode')
            .onChange(val => this.app.oceanManager.setSliceMode(val, this.params.sliceDepth, this.params.verticalExaggeration));

        this.controllers.sliceDepth = fDepth.add(this.params, 'sliceDepth', 0, 1000, 10)
            .name('Slice Depth (m)')
            .onChange(val => {
                if (this.params.sliceMode) {
                    this.app.oceanManager.setSliceMode(true, val, this.params.verticalExaggeration);
                }
            });

        // ---- 4. Scene Layers Folder ----
        const fLayers = this.gui.addFolder('Scene Layers');
        this.folders.layers = fLayers;

        this.controllers.showOcean = fLayers.add(this.params, 'showOcean').name('Ocean Volume')
            .onChange(v => this.app.oceanManager.volumeRenderer.visible = v);

        this.controllers.showSeabed = fLayers.add(this.params, 'showSeabed').name('Bathymetric Seabed')
            .onChange(v => {
                if (this.app.seabedMesh) this.app.seabedMesh.visible = v;
            });

        this.controllers.showLand = fLayers.add(this.params, 'showLand').name('Land Topography')
            .onChange(v => {
                if (this.app.landMesh) this.app.landMesh.visible = v;
            });

        this.controllers.showCoastline = fLayers.add(this.params, 'showCoastline').name('Coastline Vectors')
            .onChange(v => {
                if (this.app.coastlineMesh) this.app.coastlineMesh.visible = v;
            });

        this.controllers.showBoundingBox = fLayers.add(this.params, 'showBoundingBox').name('Bounding Box')
            .onChange(v => this.app.oceanManager.wireframeBox.visible = v);

        this.controllers.showGrid = fLayers.add(this.params, 'showGrid').name('Geographic Grid')
            .onChange(v => this.app.oceanManager.setGridVisible(v));

        // Quick Layer Presets for Diagnostics
        const presets = {
            allLayers: () => {
                this.params.showOcean = true;
                this.params.showSeabed = true;
                this.params.showLand = true;
                this.params.showCoastline = true;
                this.params.showBoundingBox = true;
                this.params.showGrid = true;
                this.syncLayerVisibility();
            },
            volumeOnly: () => {
                this.params.showOcean = true;
                this.params.showSeabed = false;
                this.params.showLand = false;
                this.params.showCoastline = false;
                this.params.showBoundingBox = true;
                this.params.showGrid = true;
                this.syncLayerVisibility();
            },
            seabedOnly: () => {
                this.params.showOcean = false;
                this.params.showSeabed = true;
                this.params.showLand = false;
                this.params.showCoastline = true;
                this.params.showBoundingBox = true;
                this.params.showGrid = true;
                this.syncLayerVisibility();
            },
            landOnly: () => {
                this.params.showOcean = false;
                this.params.showSeabed = false;
                this.params.showLand = true;
                this.params.showCoastline = true;
                this.params.showBoundingBox = true;
                this.params.showGrid = true;
                this.syncLayerVisibility();
            }
        };

        fLayers.add(presets, 'allLayers').name('Preset: All Layers');
        fLayers.add(presets, 'volumeOnly').name('Preset: Volume Only');
        fLayers.add(presets, 'seabedOnly').name('Preset: Seabed Only');
        fLayers.add(presets, 'landOnly').name('Preset: Land Only');

        // ---- 5. View Controls ----
        const fViews = this.gui.addFolder('Camera Views');
        fViews.add(this.params, 'view3D').name('3D Perspective');
        fViews.add(this.params, 'viewTop').name('Top View (Lon × Lat)');
        fViews.add(this.params, 'viewSide').name('Side View (Lat × Depth)');
        fViews.add(this.params, 'viewReset').name('Reset Camera');
    }

    syncLayerVisibility() {
        this.app.oceanManager.volumeRenderer.visible = this.params.showOcean;
        if (this.app.seabedMesh) this.app.seabedMesh.visible = this.params.showSeabed;
        if (this.app.landMesh) this.app.landMesh.visible = this.params.showLand;
        if (this.app.coastlineMesh) this.app.coastlineMesh.visible = this.params.showCoastline;
        this.app.oceanManager.wireframeBox.visible = this.params.showBoundingBox;
        this.app.oceanManager.setGridVisible(this.params.showGrid);

        this.controllers.showOcean?.updateDisplay();
        this.controllers.showSeabed?.updateDisplay();
        this.controllers.showLand?.updateDisplay();
        this.controllers.showCoastline?.updateDisplay();
        this.controllers.showBoundingBox?.updateDisplay();
        this.controllers.showGrid?.updateDisplay();
    }

    updateDepthRange() {
        this.app.oceanManager.setDepthRange(
            this.params.depthMin,
            this.params.depthMax,
            this.params.verticalExaggeration
        );
    }

    updateDatasetList(datasets) {
        this.controllers.dataset = this.controllers.dataset.options(datasets);
    }

    updateVariableList(variables) {
        const names = variables.map(v => v.name);
        this.controllers.variable = this.controllers.variable.options(names);
        if (names.length && !names.includes(this.params.variable)) {
            this.params.variable = names[0];
            this.controllers.variable.setValue(names[0]);
        }
    }

    updateDepthLimits(minDepth, maxDepth) {
        this.params.depthMin = minDepth;
        this.params.depthMax = maxDepth;
        this.params.sliceDepth = (minDepth + maxDepth) / 2;

        this.controllers.depthMin.min(minDepth).max(maxDepth).setValue(minDepth);
        this.controllers.depthMax.min(minDepth).max(maxDepth).setValue(maxDepth);
        this.controllers.sliceDepth.min(minDepth).max(maxDepth).setValue(this.params.sliceDepth);
    }

    updateTimeLimits(times) {
        const count = times ? times.length : 1;
        if (count > 1) {
            this.controllers.time.min(0).max(count - 1).step(1);
            this.controllers.time.show();
        } else {
            this.controllers.time.hide();
        }
    }
}
