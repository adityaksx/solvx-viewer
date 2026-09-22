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
     * @param {Object} profile
     */
    showProfile(profile) {
        if (!profile || !this.app) return;
        const lat = profile.latitude ?? profile.lat;
        const lon = profile.longitude ?? profile.lon;
        if (lat != null && lon != null) {
            this.focusLocation(lat, lon);
        }
        if (this.app.obsModal) {
            this.app.obsModal.classList.remove('hidden');
        }
    }

    /**
     * Dispatches a structured visualization command JSON to the viewer.
     * @param {Object} command
     */
    executeCommand(command) {
        if (!command || typeof command !== 'object') return;
        const action = (command.action || '').toUpperCase();

        if (action === 'FOCUS_REGION' || action === 'SHOW_ANOMALY') {
            const lat = command.latitude ?? command.lat;
            const lon = command.longitude ?? command.lon;
            const depth = command.depth;
            if (lat != null && lon != null) {
                this.focusLocation(lat, lon, depth);
            }
            if (command.variable) this.setVariable(command.variable);
            if (command.time) this.setTime(command.time);
            if (depth != null) this.setDepth(depth);
            if (command.layer) this.showLayer(command.layer, true);
        } else if (action === 'SET_DEPTH') {
            if (command.depth != null) {
                this.setDepth(Number(command.depth));
            }
        } else if (action === 'SET_VARIABLE') {
            if (command.variable) {
                this.setVariable(command.variable);
            }
        } else if (action === 'VERTICAL_SLICE') {
            if (command.start_lat != null && command.start_lon != null && command.end_lat != null && command.end_lon != null) {
                this.showVerticalSlice(command.start_lat, command.start_lon, command.end_lat, command.end_lon);
            }
        } else if (action === 'SHOW_LAYER') {
            if (command.layer) {
                this.showLayer(command.layer, command.visible !== false);
            }
        }
    }
}
