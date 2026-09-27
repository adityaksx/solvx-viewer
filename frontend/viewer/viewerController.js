// SolvX — 3D Viewer Controller Interface
// Section 18 / Stage 2: Thin controller around the existing 3D viewer.
// Provides a unified, decoupled interface for dashboard, analysis, and AI visualization commands.

export class ViewerController {
    /**
     * @param {import('../app.js').SolvXApp} app 
     */
    constructor(app) {
        this.app = app;
    }

    /**
     * Focuses the 3D camera on a geographic coordinate (lat, lon) and optional depth.
     * @param {number} lat
     * @param {number} lon
     * @param {number} [depth=null]
     */
    focusLocation(lat, lon, depth = null) {
        if (!this.app || !this.app.scene?.camera || !this.app.scene?.controls) return;
        const bbox = this.app.currentBBox;
        const midLat = (bbox.min_lat + bbox.max_lat) / 2;
        const midLon = (bbox.min_lon + bbox.max_lon) / 2;
        const posX = (lat - midLat) * 111.32;
        const posZ = (lon - midLon) * 111.32 * Math.cos(midLat * Math.PI / 180);

        let posY = 0;
        if (depth != null && this.app.sceneManager?.depthY) {
            posY = this.app.sceneManager.depthY(depth);
        }

        this.app.scene.camera.position.set(posX, Math.max(posY + 80, 40), posZ + 120);
        this.app.scene.controls.target.set(posX, posY, posZ);
        this.app.scene.controls.update();

        this.app.inspectPoint({ lat, lon });
    }

    /**
     * Sets the active horizontal slice depth in meters.
     * @param {number} depthM
     */
    setDepth(depthM) {
        if (!this.app) return;
        this.app.activeDepth = depthM;
        if (this.app.depthControl) {
            this.app.depthControl.currentDepth = depthM;
            if (this.app.depthControl.horizDepthInput) {
                this.app.depthControl.horizDepthInput.value = depthM;
            }
            if (this.app.depthControl.horizDepthSlider) {
                this.app.depthControl.horizDepthSlider.value = depthM;
            }
            if (this.app.depthControl.horizDepthValue) {
                this.app.depthControl.horizDepthValue.textContent = `${Math.round(depthM)}m`;
            }
        }
        this.app.onDepthChange(depthM);
    }

    /**
     * Sets depth mode: 'volume', 'horizontal', or 'vertical'.
     * @param {'volume'|'horizontal'|'vertical'} mode
     * @param {number} [depthM]
     */
    setDepthMode(mode, depthM = null) {
        if (!this.app) return;
        const d = depthM != null ? depthM : this.app.activeDepth;
        if (this.app.depthControl) {
            this.app.depthControl.setMode(mode);
        } else {
            this.app.onDepthModeChange(mode, d);
        }
    }

    /**
     * Changes active oceanographic variable.
     * @param {string} variable
     */
    setVariable(variable) {
        if (!this.app) return;
        this.app.setVariable(variable);
    }

    /**
     * Sets the current time step.
     * @param {string} timeIso
     */
    setTime(timeIso) {
        if (!this.app) return;
        this.app.activeTime = timeIso;
        this.app.loadTimelineBundle(timeIso);
    }

    /**
     * Toggles visibility of a 3D scene layer.
     * @param {string} layer ('land'|'coastline'|'islands'|'eez'|'seabed'|'water'|'scientific'|'currents'|'particles')
     * @param {boolean} visible
     */
    showLayer(layer, visible) {
        if (!this.app) return;
        this.app.layerState[layer] = visible;
        const checkbox = document.getElementById(`layer${layer.charAt(0).toUpperCase() + layer.slice(1)}`);
        if (checkbox) checkbox.checked = visible;
        this.app.applyLayerVisibility(layer, visible);
    }

    /**
     * Displays a vertical cross-section slice between two coordinates.
     * @param {number} sLat
     * @param {number} sLon
     * @param {number} eLat
     * @param {number} eLon
     */
    showVerticalSlice(sLat, sLon, eLat, eLon) {
        if (!this.app) return;
        this.setDepthMode('vertical');
        this.app.applyVerticalSlice(sLat, sLon, eLat, eLon);
    }

    /**
     * Clears the active vertical slice and returns to volume/horizontal mode.
     */
    clearVerticalSlice() {
        if (!this.app) return;
        this.app.clearVerticalSlice();
    }

    /**
     * Shows an anomaly overlay or focus region.
     * @param {Object} anomaly
     */
    showAnomaly(anomaly) {
        if (!anomaly) return;
        const lat = anomaly.latitude ?? anomaly.lat;
        const lon = anomaly.longitude ?? anomaly.lon;
        const depth = anomaly.depth;
        if (lat != null && lon != null) {
            this.focusLocation(lat, lon, depth);
        }
        if (anomaly.variable) {
            this.setVariable(anomaly.variable);
        }
        if (anomaly.time) {
            this.setTime(anomaly.time);
        }
    }

    /**
     * Displays an in-situ profile chart or modal.
     * @param {Object|string} profileOrId
     */
    async showProfile(profileOrId) {
        if (!profileOrId || !this.app) return;
        if (this.app.profileViewer) {
            await this.app.profileViewer.show(profileOrId);
        }
        const profile = typeof profileOrId === 'object' ? profileOrId : this.app.profileViewer?.currentProfile;
        if (profile) {
            const lat = profile.latitude ?? profile.lat;
            const lon = profile.longitude ?? profile.lon;
            if (lat != null && lon != null) {
                this.focusLocation(lat, lon);
            }
        }
    }

    /**
     * Dispatches a structured visualization command JSON to the viewer.
    /**
     * Extracts structured UI context compliant with SolvX AI Assistant schemas.
     * @returns {Object}
     */
    getUIContext() {
        const bbox = this.app?.currentBBox || { min_lat: 16.07, max_lat: 23.52, min_lon: 84.10, max_lon: 93.00 };
        return {
            region: {
                name: this.app?.currentRegionName || "Active Region",
                min_lat: Number(bbox.min_lat),
                max_lat: Number(bbox.max_lat),
                min_lon: Number(bbox.min_lon),
                max_lon: Number(bbox.max_lon)
            },
            timeline: {
                current_time: this.app?.activeTime || new Date().toISOString(),
                start_time: this.app?.timelineStart || null,
                end_time: this.app?.timelineEnd || null,
                resolution: this.app?.timelineResolution || "daily"
            },
            depth: {
                current_depth: Number(this.app?.activeDepth ?? 0),
                depth_mode: this.app?.depthMode || "volume",
                selected_layer: Number(this.app?.activeDepth ?? 0)
            },
            visualization: {
                active_variable: this.app?.activeVar || "temperature",
                active_layers: Object.keys(this.app?.layerState || {}).filter(k => this.app?.layerState[k]),
                camera_position: this.app?.scene?.camera ? {
                    x: this.app.scene.camera.position.x,
                    y: this.app.scene.camera.position.y,
                    z: this.app.scene.camera.position.z
                } : null
            }
        };
    }

    /**
     * Dispatches a structured visualization command JSON to the viewer.
     * Supports both flat command objects and AI Assistant action objects with parameters.
     * @param {Object} command
     */
    executeCommand(command) {
        if (!command || typeof command !== 'object') return;
        const params = command.parameters || command;
        const action = (command.action || '').toUpperCase();

        if (action === 'FOCUS_REGION' || action === 'SHOW_ANOMALY' || action === 'HIGHLIGHT_REGION') {
            const bbox = params.bbox || (params.min_lat != null ? params : null);
            let lat = params.latitude ?? params.lat;
            let lon = params.longitude ?? params.lon;
            if ((lat == null || lon == null) && bbox) {
                lat = (bbox.min_lat + bbox.max_lat) / 2;
                lon = (bbox.min_lon + bbox.max_lon) / 2;
            }
            const depth = params.depth;
            if (lat != null && lon != null) {
                this.focusLocation(lat, lon, depth);
            }
            if (params.variable) this.setVariable(params.variable);
            if (params.time) this.setTime(params.time);
            if (depth != null) this.setDepth(Number(depth));
            if (params.layer) this.showLayer(params.layer, true);
        } else if (action === 'FOCUS_LOCATION') {
            const lat = params.latitude ?? params.lat;
            const lon = params.longitude ?? params.lon;
            const depth = params.depth;
            if (lat != null && lon != null) {
                this.focusLocation(lat, lon, depth);
            }
            if (params.variable) this.setVariable(params.variable);
            if (depth != null) this.setDepth(Number(depth));
        } else if (action === 'SET_DEPTH') {
            const depth = params.depth != null ? params.depth : params.target_depth;
            if (depth != null) {
                this.setDepth(Number(depth));
            }
        } else if (action === 'SET_VARIABLE') {
            if (params.variable) {
                this.setVariable(params.variable);
            }
        } else if (action === 'VERTICAL_SLICE') {
            if (params.start_lat != null && params.start_lon != null && params.end_lat != null && params.end_lon != null) {
                this.showVerticalSlice(params.start_lat, params.start_lon, params.end_lat, params.end_lon);
            }
        } else if (action === 'SHOW_LAYER') {
            if (params.layer) {
                this.showLayer(params.layer, params.visible !== false);
            }
        } else if (action === 'FILTER_ARGO') {
            if (params.float_id && this.app?.argoManager?.filterFloats) {
                this.app.argoManager.filterFloats(params.float_id);
            }
        } else if (action === 'SHOW_GRAPH') {
            // Dispatches event for chart display
            window.dispatchEvent(new CustomEvent('solvx:show-graph', { detail: params }));
        }
    }

    // =========================================================================
    // Stage 4: Oceanographic Analysis Engine Interface
    // =========================================================================

    /**
     * Executes an analytical assessment: 'model-vs-argo', 'coverage', 'gaps', or 'summary'.
     * @param {string} type
     * @param {Object} [params]
     */
    async runAnalysis(type = 'summary', params = {}) {
        const bbox = params.bbox || this.app?.currentBBox || {};
        const queryParams = {
            min_lat: params.min_lat ?? bbox.min_lat,
            max_lat: params.max_lat ?? bbox.max_lat,
            min_lon: params.min_lon ?? bbox.min_lon,
            max_lon: params.max_lon ?? bbox.max_lon,
            variable: params.variable || this.app?.activeVar || 'temperature',
            ...params
        };

        const { ApiClient } = await import('../api/apiClient.js');

        switch (type.toLowerCase()) {
            case 'model-vs-argo':
            case 'model_vs_argo':
                return ApiClient.getModelVsArgo(queryParams);
            case 'coverage':
                return ApiClient.getObservationCoverage(queryParams);
            case 'gaps':
            case 'data_gaps':
                return ApiClient.getDataGaps(queryParams);
            case 'anomalies':
                return ApiClient.getAnomalies(queryParams);
            case 'abnormal-regions':
            case 'abnormal_regions':
                return ApiClient.getAbnormalRegions(queryParams);
            case 'summary':
            default:
                return ApiClient.getAnalysisSummary(queryParams);
        }
    }

    /**
     * Retrieves basin-wide Model vs Argo comparison metrics.
     */
    async getModelVsArgo(params = {}) {
        return this.runAnalysis('model-vs-argo', params);
    }

    /**
     * Retrieves observation coverage metrics.
     */
    async getObservationCoverage(params = {}) {
        return this.runAnalysis('coverage', params);
    }

    /**
     * Retrieves observation gap sectors and depth gaps.
     */
    async getDataGaps(params = {}) {
        return this.runAnalysis('gaps', params);
    }

    /**
     * Retrieves consolidated executive analysis summary.
     */
    async getAnalysisSummary(params = {}) {
        return this.runAnalysis('summary', params);
    }

    // =========================================================================
    // Stage 5: Anomaly Detection, Abnormal Region Extraction & 3D Highlighting
    // =========================================================================

    /**
     * Detects anomalous depth levels across all Argo float profiles.
     * @param {Object} [params] - { variable, method, threshold_sigma, threshold_abs, ... }
     */
    async getAnomalies(params = {}) {
        return this.runAnalysis('anomalies', params);
    }

    /**
     * Extracts spatially clustered bounding volumes of anomalous observations.
     * Returns AbnormalRegionResponse with FOCUS_REGION commands per region.
     * @param {Object} [params] - { variable, method, threshold_sigma, threshold_abs, grid_res_deg, ... }
     */
    async getAbnormalRegions(params = {}) {
        return this.runAnalysis('abnormal-regions', params);
    }

    /**
     * Renders a translucent 3D bounding-box highlight in the scene for an AbnormalRegion.
     * Additive — does NOT modify oceanShader.js or the camera pipeline.
     *
     * @param {Object} region - AbnormalRegion JSON from /api/analysis/abnormal-regions
     * @returns {THREE.Mesh|null} The created mesh, or null if scene unavailable.
     */
    highlightAnomalyRegion(region) {
        if (!this.app?.scene?.scene) return null;

        const THREE = this.app._THREE;
        if (!THREE) return null;

        const bbox = this.app.currentBBox || {};
        const midLat = ((bbox.min_lat || 16) + (bbox.max_lat || 23)) / 2;
        const midLon = ((bbox.min_lon || 84) + (bbox.max_lon || 93)) / 2;

        const rb = region.bbox;
        const centerLat = (rb.min_lat + rb.max_lat) / 2;
        const centerLon = (rb.min_lon + rb.max_lon) / 2;
        const posX = (centerLat - midLat) * 111.32;
        const posZ = (centerLon - midLon) * 111.32 * Math.cos(midLat * Math.PI / 180);

        const widthLat = Math.abs(rb.max_lat - rb.min_lat) * 111.32;
        const widthLon = Math.abs(rb.max_lon - rb.min_lon) * 111.32 * Math.cos(midLat * Math.PI / 180);

        const [minDepth, maxDepth] = region.depth_range_m || [0, 200];
        const posY = this.app.sceneManager?.depthY
            ? (this.app.sceneManager.depthY(minDepth) + this.app.sceneManager.depthY(maxDepth)) / 2
            : -((minDepth + maxDepth) / 2) * 0.02;
        const height = Math.max(
            this.app.sceneManager?.depthY
                ? Math.abs(this.app.sceneManager.depthY(minDepth) - this.app.sceneManager.depthY(maxDepth))
                : (maxDepth - minDepth) * 0.02,
            2
        );

        const colorMap = { CRITICAL: 0xff2222, MODERATE: 0xff8800, LOW: 0xffdd00 };
        const color = colorMap[region.severity] || 0xff8800;

        const geo = new THREE.BoxGeometry(
            Math.max(widthLat, 3),
            height,
            Math.max(widthLon, 3)
        );
        const mat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.18,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(posX, posY, posZ);
        mesh.userData.anomalyRegionId = region.id;
        mesh.userData.isAnomalyHighlight = true;

        // Wire-frame outline for visibility
        const edges = new THREE.EdgesGeometry(geo);
        const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 });
        const wireframe = new THREE.LineSegments(edges, lineMat);
        wireframe.userData.isAnomalyHighlight = true;

        this.app.scene.scene.add(mesh);
        this.app.scene.scene.add(wireframe);

        return mesh;
    }

    /**
     * Removes all anomaly highlight meshes previously added by highlightAnomalyRegion().
     */
    clearAnomalyHighlights() {
        if (!this.app?.scene?.scene) return;
        const toRemove = [];
        this.app.scene.scene.traverse(obj => {
            if (obj.userData?.isAnomalyHighlight) toRemove.push(obj);
        });
        toRemove.forEach(obj => {
            obj.geometry?.dispose();
            obj.material?.dispose();
            this.app.scene.scene.remove(obj);
        });
    }
}
