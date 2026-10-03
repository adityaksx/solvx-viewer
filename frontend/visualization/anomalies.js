import * as THREE from 'three';
import { ApiClient } from '../api/apiClient.js';

export class AnomalyVisualizer {
    constructor(waterComponent) {
        this.water = waterComponent;
        this.api = new ApiClient();
        this.currentData = null;
        this.hazards = [];
    }

    async load(bbox, time) {
        try {
            // Provide feedback
            const res = await this.api.get('/api/ml/anomalies', {
                lat_min: bbox.min_lat,
                lat_max: bbox.max_lat,
                lon_min: bbox.min_lon,
                lon_max: bbox.max_lon,
                time: time
            });
            this.currentData = res;
            this.hazards = res.hazards || [];
            this.updateVisualization();
            return this.hazards;
        } catch (err) {
            console.error("Failed to load anomalies:", err);
            return [];
        }
    }

    updateVisualization() {
        if (!this.currentData || !this.water) return;
        
        const { scores, lats, lons } = this.currentData;
        if (!scores || scores.length === 0) return;
        // Legacy recolorCells removed in favor of true volumetric / shader-based rendering
    }

    clear() {
        this.currentData = null;
        this.hazards = [];
    }
}
