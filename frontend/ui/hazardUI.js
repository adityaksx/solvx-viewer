import { ApiClient } from '../api/apiClient.js';

export class HazardUI {
    constructor(app) {
        this.app = app;
        this.api = new ApiClient();
        
        // Create Sidebar
        this.sidebar = document.createElement('div');
        this.sidebar.id = 'ml-alert-sidebar';
        this.sidebar.style.cssText = `
            position: absolute;
            top: 20px;
            right: 20px;
            width: 300px;
            background: rgba(10, 15, 25, 0.85);
            border: 1px solid #444;
            color: white;
            font-family: monospace;
            padding: 10px;
            border-radius: 4px;
            display: none;
            z-index: 1000;
        `;
        document.body.appendChild(this.sidebar);
        
        // Create Popup Container
        this.popup = document.createElement('div');
        this.popup.id = 'ml-warning-popup';
        this.popup.style.cssText = `
            position: absolute;
            background: rgba(50, 0, 0, 0.9);
            border: 1px solid red;
            color: white;
            font-family: monospace;
            padding: 10px;
            border-radius: 4px;
            display: none;
            z-index: 1000;
            pointer-events: auto;
        `;
        document.body.appendChild(this.popup);

        // Create Point Panel
        this.pointPanel = document.createElement('div');
        this.pointPanel.id = 'ml-point-panel';
        this.pointPanel.style.cssText = `
            position: absolute;
            bottom: 20px;
            right: 20px;
            width: 350px;
            max-height: 80vh;
            overflow-y: auto;
            background: rgba(10, 15, 25, 0.95);
            border: 1px solid #00ffcc;
            color: white;
            font-family: monospace;
            padding: 15px;
            border-radius: 4px;
            display: none;
            z-index: 1000;
        `;
        document.body.appendChild(this.pointPanel);
    }
    
    updateHazards(hazards) {
        if (!hazards || hazards.length === 0) {
            this.sidebar.style.display = 'none';
            this.popup.style.display = 'none';
            return;
        }
        
        this.sidebar.style.display = 'block';
        let html = '<h3 style="margin-top:0; color: #ff4444;">ACTIVE ANOMALIES</h3>';
        
        hazards.forEach((h, i) => {
            const loc = h.predicted_center;
            html += `
                <div style="border-bottom: 1px solid #444; padding: 5px 0; cursor: pointer;" 
                     onclick="window.focusHazard(${loc.latitude}, ${loc.longitude})">
                    <strong style="color:${h.risk_level === 'Severe' ? 'red' : 'orange'}">${h.risk_level.toUpperCase()}</strong><br/>
                    ${loc.latitude.toFixed(1)}°N ${loc.longitude.toFixed(1)}°E<br/>
                    ${h.hazard_type}: ${h.risk_score.toFixed(1)}
                </div>
            `;
        });
        this.sidebar.innerHTML = html;
        
        // Show popup for highest risk
        const topH = hazards[0];
        if (topH.risk_score >= 40) {
            this.showPopup(topH);
        }
    }
    
    showPopup(hazard) {
        const loc = hazard.predicted_center;
        this.popup.innerHTML = `
            <div style="color: red; font-weight: bold;">⚠ HAZARD DETECTED</div>
            <div style="margin: 5px 0;">
                ${hazard.hazard_type}<br/>
                Risk: ${hazard.risk_score.toFixed(1)}/100<br/>
                ${loc.latitude.toFixed(1)}°N, ${loc.longitude.toFixed(1)}°E<br/>
                Expected: ${hazard.expected_window}<br/>
                Magnitude: ${hazard.magnitude_estimate}<br/>
            </div>
            <button onclick="window.inspectPoint(${loc.latitude}, ${loc.longitude})" 
                    style="background: #440000; color: white; border: 1px solid red; padding: 2px 5px; cursor: pointer;">
                [Investigate]
            </button>
        `;
        this.popup.style.display = 'block';
        // Rough positioning in center for now, ideally updated via 3D projection
        this.popup.style.left = (window.innerWidth / 2 - 100) + 'px';
        this.popup.style.top = (window.innerHeight / 2 - 100) + 'px';
    }
    
    async inspectPoint(lat, lon, time) {
        this.pointPanel.style.display = 'block';
        this.pointPanel.innerHTML = `<div>Loading analysis for ${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E...</div>`;
        
        try {
            const data = await this.api.get('/api/ml/point', {
                latitude: lat,
                longitude: lon,
                time: time
            });
            
            let html = `
                <div style="display: flex; justify-content: space-between;">
                    <h3 style="margin-top:0; color:#00ffcc;">LOCATION</h3>
                    <span style="cursor:pointer;" onclick="document.getElementById('ml-point-panel').style.display='none'">[X]</span>
                </div>
                <div>${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E</div>
                
                <h4 style="margin: 10px 0 5px 0; color:#00ffcc;">SURFACE</h4>
            `;
            
            for (const [k, v] of Object.entries(data.values)) {
                if (v !== null) html += `<div>${k}: ${v}</div>`;
            }
            
            html += `
                <h4 style="margin: 10px 0 5px 0; color:#00ffcc;">RISK</h4>
                <div>Anomaly score: ${data.anomaly?.anomaly_score?.toFixed(1) || 0}/100</div>
            `;
            
            if (data.hazard) {
                html += `<div>Hazard risk: ${data.hazard.risk_score.toFixed(1)}/100</div>`;
                html += `
                    <h4 style="margin: 10px 0 5px 0; color:#ffaa00;">WHY FLAGGED?</h4>
                    <ul style="margin:0; padding-left:20px;">
                `;
                data.hazard.contributing_signals.forEach(s => {
                    html += `<li>${s}</li>`;
                });
                html += `</ul>`;
                
                if (data.hazard.missing_inputs.length > 0) {
                    html += `
                        <div style="margin-top: 10px; color: #ff4444; border: 1px solid #ff4444; padding: 5px;">
                            <strong>Data Warning:</strong><br/>
                            Atmospheric inputs unavailable — cyclone intensity prediction confidence reduced.
                        </div>
                    `;
                }
            } else {
                html += `<div>Status: Normal</div>`;
            }
            
            this.pointPanel.innerHTML = html;
        } catch (err) {
            this.pointPanel.innerHTML = `<div>Error loading data: ${err.message}</div>`;
        }
    }
}
