// SolvX — Interactive Region Drawing & Coordinate Sync
// Provides click-and-drag box drawing on 2D MapLibre map,
// real-time area calculation in km², bidirectional sync with manual inputs,
// and preset basin selection.

import { SelectionContext, PRESET_REGIONS } from '../context/selectionContext.js';

export class RegionDrawer {
    constructor(worldMap, options = {}) {
        this.worldMap = worldMap;
        this.options = options;
        this.map = worldMap.getMap();
        this.onExplore = options.onExplore || null;
        this.isDrawing = false;
        this.drawMode = false; // Enabled via button or Shift key
        this.startLngLat = null;
        const ctxArea = SelectionContext.getArea();
        this.currentBBox = ctxArea?.bbox ? { ...ctxArea.bbox } : { ...worldMap.currentBBox };

        // DOM elements
        this.inMinLat = document.getElementById('coordMinLat');
        this.inMaxLat = document.getElementById('coordMaxLat');
        this.inMinLon = document.getElementById('coordMinLon');
        this.inMaxLon = document.getElementById('coordMaxLon');
        this.areaDisplay = document.getElementById('regionAreaDisplay');
        this.drawBtn = document.getElementById('drawBoxBtn');
        this.exploreBtn = document.getElementById('exploreRegionBtn');
        this.errorBox = document.getElementById('coordError');
        this.presetList = document.getElementById('presetList');
        this.toggleEEZBtn = document.getElementById('toggleEEZBtn');
        this.basemapSelect = document.getElementById('mapBasemapSelect');

        const initialName = ctxArea?.name || 'Bay of Bengal';
        const nameEl = document.getElementById('regionNameDisplay');
        if (nameEl) nameEl.textContent = initialName;
        this.worldMap.setBBox(this.currentBBox, false, initialName);

        this._bindEvents();
        this._populatePresets();
        this.updateInputs(this.currentBBox);
    }

    _bindEvents() {
        // Basemap selector
        if (this.basemapSelect) {
            this.basemapSelect.addEventListener('change', (e) => {
                this.worldMap.setBasemap(e.target.value);
            });
        }

        // Toggle drawing mode button
        if (this.drawBtn) {
            this.drawBtn.addEventListener('click', () => {
                this.setDrawMode(!this.drawMode);
            });
        }

        // Toggle EEZ button
        if (this.toggleEEZBtn) {
            this.toggleEEZBtn.addEventListener('change', (e) => {
                this.worldMap.setEEZVisibility(e.target.checked);
            });
        }

        // Mouse events on map for box drawing
        const canvas = this.map.getCanvasContainer();

        this.map.on('mousedown', (e) => {
            if (!this.drawMode && !e.originalEvent.shiftKey) return;
            // Disable map dragPan while drawing
            this.map.dragPan.disable();
            this.isDrawing = true;
            this.startLngLat = e.lngLat;
            canvas.style.cursor = 'crosshair';
        });

        this.map.on('mousemove', (e) => {
            if (!this.isDrawing || !this.startLngLat) return;
            const currentLngLat = e.lngLat;

            const min_lon = Math.min(this.startLngLat.lng, currentLngLat.lng);
            const max_lon = Math.max(this.startLngLat.lng, currentLngLat.lng);
            const min_lat = Math.min(this.startLngLat.lat, currentLngLat.lat);
            const max_lat = Math.max(this.startLngLat.lat, currentLngLat.lat);

            this.currentBBox = {
                min_lon: roundCoord(min_lon),
                max_lon: roundCoord(max_lon),
                min_lat: roundCoord(min_lat),
                max_lat: roundCoord(max_lat)
            };

            this.worldMap.setBBox(this.currentBBox, false, 'Selecting Area…');
            this.updateInputs(this.currentBBox);
        });

        const finishDrawing = () => {
            if (!this.isDrawing) return;
            this.isDrawing = false;
            this.map.dragPan.enable();
            canvas.style.cursor = '';
            this._hideGuidanceBanner();
            if (this.drawMode) {
                this.setDrawMode(false);
            }

            // Check if user did a micro-click without dragging (< 0.25 deg)
            const dLat = Math.abs(this.currentBBox.max_lat - this.currentBBox.min_lat);
            const dLon = Math.abs(this.currentBBox.max_lon - this.currentBBox.min_lon);
            if (dLat < 0.25 || dLon < 0.25) {
                if (this.startLngLat) {
                    const cLat = Math.max(-85, Math.min(85, this.startLngLat.lat));
                    const cLon = Math.max(-175, Math.min(175, this.startLngLat.lng));
                    this.currentBBox = {
                        min_lat: roundCoord(cLat - 2.5),
                        max_lat: roundCoord(cLat + 2.5),
                        min_lon: roundCoord(cLon - 2.5),
                        max_lon: roundCoord(cLon + 2.5)
                    };
                }
            }

            const areaName = 'Custom Selected Area';
            const nameEl = document.getElementById('regionNameDisplay');
            if (nameEl) nameEl.textContent = areaName;
            this.worldMap.setBBox(this.currentBBox, false, areaName);
            this.updateInputs(this.currentBBox);
            this.worldMap.loadEEZForBBox(this.currentBBox);
            SelectionContext.setArea({ id: 'custom', name: areaName, bbox: this.currentBBox });
        };

        this.map.on('mouseup', finishDrawing);
        canvas.addEventListener('mouseleave', finishDrawing);

        // Manual coordinate input listeners
        const handleInputChange = () => {
            const minLat = parseFloat(this.inMinLat.value);
            const maxLat = parseFloat(this.inMaxLat.value);
            const minLon = parseFloat(this.inMinLon.value);
            const maxLon = parseFloat(this.inMaxLon.value);

            if (isNaN(minLat) || isNaN(maxLat) || isNaN(minLon) || isNaN(maxLon)) {
                this._showError('All coordinates must be valid numbers.');
                return;
            }

            if (minLat >= maxLat) {
                this._showError('Min Latitude must be less than Max Latitude.');
                return;
            }

            if (minLon >= maxLon) {
                this._showError('Min Longitude must be less than Max Longitude.');
                return;
            }

            this._hideError();
            this.currentBBox = {
                min_lat: roundCoord(minLat),
                max_lat: roundCoord(maxLat),
                min_lon: roundCoord(minLon),
                max_lon: roundCoord(maxLon)
            };

            const areaName = 'Custom Coordinates';
            const nameEl = document.getElementById('regionNameDisplay');
            if (nameEl) nameEl.textContent = areaName;
            this.worldMap.setBBox(this.currentBBox, true, areaName);
            this.worldMap.loadEEZForBBox(this.currentBBox);
            this.updateAreaDisplay(this.currentBBox);
            SelectionContext.setArea({ id: 'custom', name: areaName, bbox: this.currentBBox });
        };

        [this.inMinLat, this.inMaxLat, this.inMinLon, this.inMaxLon].forEach(input => {
            if (input) {
                input.addEventListener('change', handleInputChange);
            }
        });

        // Explore 3D Region button
        if (this.exploreBtn) {
            this.exploreBtn.addEventListener('click', () => {
                if (this._validateBBox(this.currentBBox)) {
                    if (this.onExplore) {
                        this.onExplore(this.currentBBox);
                    }
                }
            });
        }

        document.getElementById('openAnalysisBtn')?.addEventListener('click', () => {
            if (this._validateBBox(this.currentBBox)) {
                SelectionContext.setArea({ bbox: this.currentBBox });
                window.location.href = '/analysis.html';
            }
        });

        document.getElementById('downloadDataBtn')?.addEventListener('click', () => {
            if (this._validateBBox(this.currentBBox)) {
                SelectionContext.setArea({ bbox: this.currentBBox });
                window.location.href = '/download';
            }
        });
    }

    setDrawMode(enabled) {
        this.drawMode = enabled;
        const canvas = this.map.getCanvasContainer();
        if (this.drawBtn) {
            if (this.drawMode) {
                this.drawBtn.classList.add('active');
                this.drawBtn.innerText = 'CANCEL DRAWING';
                canvas.style.cursor = 'crosshair';
                this._showGuidanceBanner('✎ Click and drag anywhere on the map to define the custom bounding box');
            } else {
                this.drawBtn.classList.remove('active');
                this.drawBtn.innerText = 'DRAW BOUNDING BOX';
                canvas.style.cursor = '';
                this._hideGuidanceBanner();
            }
        }
    }

    _showGuidanceBanner(message) {
        let banner = document.getElementById('drawGuidanceBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'drawGuidanceBanner';
            banner.className = 'draw-guidance-banner';
            const container = this.worldMap?.map?.getContainer() || document.getElementById('mapContainer');
            if (container) {
                container.appendChild(banner);
            }
        }
        banner.textContent = message;
        banner.classList.add('visible');
    }

    _hideGuidanceBanner() {
        const banner = document.getElementById('drawGuidanceBanner');
        if (banner) {
            banner.classList.remove('visible');
        }
    }

    updateInputs(bbox) {
        if (this.inMinLat) this.inMinLat.value = bbox.min_lat.toFixed(2);
        if (this.inMaxLat) this.inMaxLat.value = bbox.max_lat.toFixed(2);
        if (this.inMinLon) this.inMinLon.value = bbox.min_lon.toFixed(2);
        if (this.inMaxLon) this.inMaxLon.value = bbox.max_lon.toFixed(2);
        this.updateAreaDisplay(bbox);
        this._hideError();
    }

    updateAreaDisplay(bbox) {
        if (this.areaDisplay) {
            const areaKm2 = calculateSphericalAreaKm2(bbox);
            const areaDeg2 = (bbox.max_lat - bbox.min_lat) * (bbox.max_lon - bbox.min_lon);
            const formatted = Math.round(areaKm2).toLocaleString();
            this.areaDisplay.innerHTML = `Area: <b>${formatted} km²</b> <small>(${areaDeg2.toFixed(1)} deg²)</small>`;
        }
        const latEl = document.getElementById('regionLatDisplay');
        if (latEl) latEl.textContent = `${bbox.min_lat.toFixed(2)}°N to ${bbox.max_lat.toFixed(2)}°N`;
        const lonEl = document.getElementById('regionLonDisplay');
        if (lonEl) lonEl.textContent = `${bbox.min_lon.toFixed(2)}°E to ${bbox.max_lon.toFixed(2)}°E`;
    }

    _validateBBox(bbox) {
        if (bbox.min_lat < -90 || bbox.max_lat > 90 || bbox.min_lon < -180 || bbox.max_lon > 180) {
            this._showError('Coordinates out of range (-90..90 Lat, -180..180 Lon).');
            return false;
        }
        if (bbox.min_lat >= bbox.max_lat || bbox.min_lon >= bbox.max_lon) {
            this._showError('Minimum bounds must be strictly less than maximum bounds.');
            return false;
        }
        const areaDeg2 = (bbox.max_lat - bbox.min_lat) * (bbox.max_lon - bbox.min_lon);
        if (areaDeg2 > 1500.0) {
            this._showError(`Requested area (${areaDeg2.toFixed(1)} deg²) exceeds maximum allowed (1500 deg²).`);
            return false;
        }
        this._hideError();
        return true;
    }

    _showError(msg) {
        if (this.errorBox) {
            this.errorBox.innerText = msg;
            this.errorBox.classList.remove('hidden');
        }
    }

    _hideError() {
        if (this.errorBox) {
            this.errorBox.classList.add('hidden');
        }
    }

    _populatePresets() {
        if (!this.presetList) return;
        const presets = Object.values(PRESET_REGIONS);
        const activeArea = SelectionContext.getArea();
        const activeId = activeArea?.id || 'bay_of_bengal';

        this.presetList.innerHTML = '';
        presets.forEach((p) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            const isActive = p.id === activeId;
            btn.className = `preset-card ${isActive ? 'active' : ''}`;
            btn.dataset.presetId = p.id;
            btn.innerHTML = `
                <div class="preset-card-header">
                    <b class="preset-name">${p.name}</b>
                    <span class="preset-badge">${p.badge || 'Basin'}</span>
                </div>
                <span class="preset-desc">${p.desc}</span>
                <span class="preset-coords">${p.bbox.min_lat.toFixed(1)}° to ${p.bbox.max_lat.toFixed(1)}°N · ${p.bbox.min_lon.toFixed(1)}° to ${p.bbox.max_lon.toFixed(1)}°E</span>
            `;
            btn.addEventListener('click', () => {
                document.querySelectorAll('.preset-card').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentBBox = { ...p.bbox };
                this.updateInputs(this.currentBBox);
                const nameEl = document.getElementById('regionNameDisplay');
                if (nameEl) nameEl.textContent = p.name;
                this.worldMap.setBBox(this.currentBBox, true, p.name);
                this.worldMap.loadEEZForBBox(this.currentBBox);
                SelectionContext.setArea(p);
            });
            this.presetList.appendChild(btn);
        });
    }
}

function roundCoord(v) {
    return Math.round(v * 100) / 100;
}

// Geodesic spherical area in km^2
function calculateSphericalAreaKm2(bbox) {
    const R = 6371.0; // Earth radius in km
    const dLonRad = Math.abs(bbox.max_lon - bbox.min_lon) * (Math.PI / 180.0);
    const lat1Rad = bbox.min_lat * (Math.PI / 180.0);
    const lat2Rad = bbox.max_lat * (Math.PI / 180.0);
    const area = Math.pow(R, 2) * dLonRad * Math.abs(Math.sin(lat2Rad) - Math.sin(lat1Rad));
    return area;
}
