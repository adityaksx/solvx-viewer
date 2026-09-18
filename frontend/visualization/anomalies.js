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

        // Use the existing recolorCells function on DynamicWater
        this.water.recolorCells((cell) => {
            // Find closest lat/lon index
            let minLatDist = Infinity, latIdx = 0;
            let minLonDist = Infinity, lonIdx = 0;
            
            for (let i = 0; i < lats.length; i++) {
                const d = Math.abs(lats[i] - cell.lat);
                if (d < minLatDist) { minLatDist = d; latIdx = i; }
            }
            for (let i = 0; i < lons.length; i++) {
                const d = Math.abs(lons[i] - cell.lon);
                if (d < minLonDist) { minLonDist = d; lonIdx = i; }
            }
            
            const score = scores[latIdx][lonIdx];
            if (score < 0 || score < 20) {
                return new THREE.Color(0x0c659e); // Normal ocean color
            } else if (score < 40) {
                return new THREE.Color(0xcccc00); // Low anomaly (yellow)
            } else if (score < 60) {
                return new THREE.Color(0xff8800); // Moderate anomaly (orange)
            } else if (score < 80) {
                return new THREE.Color(0xff4400); // High anomaly (red-orange)
            } else {
                return new THREE.Color(0xff0000); // Extreme anomaly (bright red)
            }
        });
    }

    clear() {
        if (this.water) {
            this.water.recolorCells((cell) => {
                const maxH = 5000;
                const depthFrac = Math.min(cell.h / maxH, 1.0);
                const r = 0.08 + (1.0 - depthFrac) * 0.10; 
                const g = 0.35 + (1.0 - depthFrac) * 0.25; 
                const b = 0.55 + (1.0 - depthFrac) * 0.30; 
                return new THREE.Color(r, g, b);
            });
        }
        this.currentData = null;
        this.hazards = [];
    }
}
