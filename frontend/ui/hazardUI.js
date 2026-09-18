// SolvX Viewer — Ocean Hazard & Early Warning UI Controller
// Integrates with the top-right #hazardPanel and scientific design system

import { ApiClient } from '../api/apiClient.js';

export class HazardUI {
    constructor(app) {
        this.app = app;
        this.api = ApiClient;

        this.panel = document.getElementById('hazardPanel');
        this.badge = document.getElementById('hazardBadge');
        this.status = document.getElementById('hazardStatus');
        this.statusText = document.getElementById('hazardStatusText');
        this.eventsList = document.getElementById('hazardEventsList');
    }

    updateHazards(data) {
        if (!this.panel) return;

        const hazards = data?.hazards || [];
        // Filter for active/meaningful hazards
        const activeHazards = hazards.filter(h => {
            const lvl = (h.risk_level || '').toLowerCase();
            return (lvl && lvl !== 'normal') || (Number(h.risk_score) >= 25);
        });

        if (activeHazards.length === 0) {
            this.setNormalState();
            return;
        }

        const topHazard = activeHazards[0];
        const isSevere = activeHazards.some(h => (h.risk_level || '').toLowerCase() === 'severe' || Number(h.risk_score) >= 60);
        const levelClass = isSevere ? 'severe' : 'warning';

        // Update badge
        if (this.badge) {
            this.badge.className = `hazard-badge ${levelClass}`;
            this.badge.textContent = isSevere ? 'CRITICAL' : 'WARNING';
        }

        // Update status row
        if (this.status) {
            this.status.className = `hazard-status ${levelClass}`;
        }
        if (this.statusText) {
            this.statusText.textContent = `${topHazard.hazard_type || 'Marine Hazard'} Detected`;
        }

        // Add visual pulsing alert state to panel
        this.panel.classList.add('hazard-alert');

        // Render cards into events list
        if (this.eventsList) {
            this.eventsList.innerHTML = activeHazards.map(h => {
                const loc = h.predicted_center || { latitude: 0, longitude: 0 };
                const isCardSevere = (h.risk_level || '').toLowerCase() === 'severe' || Number(h.risk_score) >= 60;
                const cardClass = isCardSevere ? 'severe' : 'warning';
                const latStr = `${Number(loc.latitude).toFixed(2)}°N`;
                const lonStr = `${Number(loc.longitude).toFixed(2)}°E`;

                return `
                    <div class="hazard-card ${cardClass}">
                        <div class="hazard-card-title">${h.hazard_type || 'Ocean Hazard'}</div>
                        <div class="hazard-metrics-grid">
                            <span class="hazard-k">Risk Score</span>
                            <span class="hazard-v">${Number(h.risk_score || 0).toFixed(1)} / 100</span>
                            <span class="hazard-k">Center</span>
                            <span class="hazard-v">${latStr}, ${lonStr}</span>
                            ${h.magnitude_estimate ? `
                            <span class="hazard-k">Magnitude</span>
                            <span class="hazard-v">${h.magnitude_estimate}</span>` : ''}
                            ${h.expected_window ? `
                            <span class="hazard-k">Window</span>
                            <span class="hazard-v">${h.expected_window}</span>` : ''}
                        </div>
                        <button class="hazard-investigate-btn" onclick="window.solvx?.focusHazard(${loc.latitude}, ${loc.longitude})">
                            [ FOCUS & INVESTIGATE ]
                        </button>
                    </div>
                `;
            }).join('');
        }
    }

    setNormalState() {
        if (this.badge) {
            this.badge.className = 'hazard-badge normal';
            this.badge.textContent = 'NORMAL';
        }
        if (this.status) {
            this.status.className = 'hazard-status normal';
        }
        if (this.statusText) {
            this.statusText.textContent = 'Conditions Normal';
        }
        if (this.eventsList) {
            this.eventsList.innerHTML = '<div class="hazard-subtext">No active warnings detected</div>';
        }
        this.panel?.classList.remove('hazard-alert');
    }
}
