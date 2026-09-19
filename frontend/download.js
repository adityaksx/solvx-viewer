// SolvX — Data Download Manager Client Controller
// Handles 2D MapLibre map drawing, timeline bounds, multi-layer selection,
// cache status verification, batch download orchestration, and storage inventory.

import { ApiClient } from './api/apiClient.js';

class DownloadManager {
    constructor() {
        this.map = null;
        this.isDrawing = false;
        this.drawMode = false;
        this.startLngLat = null;
        this.currentBBox = {
            min_lat: 16.07,
            max_lat: 23.52,
            min_lon: 84.10,
            max_lon: 93.00
        };

        this.inventoryData = null;
        this.checkDebounce = null;

        // DOM elements
        this.inMinLat = document.getElementById('inMinLat');
        this.inMaxLat = document.getElementById('inMaxLat');
        this.inMinLon = document.getElementById('inMinLon');
        this.inMaxLon = document.getElementById('inMaxLon');
        this.areaReadout = document.getElementById('areaReadout');
        this.btnDrawBox = document.getElementById('btnDrawBox');

        this.inStartTime = document.getElementById('inStartTime');
        this.inEndTime = document.getElementById('inEndTime');

        this.chkLand = document.getElementById('chkLand');
        this.chkCoast = document.getElementById('chkCoast');
        this.chkEEZ = document.getElementById('chkEEZ');
        this.chkSeabed = document.getElementById('chkSeabed');
        this.selResolution = document.getElementById('selResolution');
        this.btnToggleAllVars = document.getElementById('btnToggleAllVars');

        this.cacheSummaryText = document.getElementById('cacheSummaryText');
        this.btnCheckCache = document.getElementById('btnCheckCache');
        this.btnStartDownload = document.getElementById('btnStartDownload');
        this.progressBox = document.getElementById('progressBox');
        this.progressBarFill = document.getElementById('progressBarFill');
        this.logTerminal = document.getElementById('logTerminal');
        this.btnLaunchViewer = document.getElementById('btnLaunchViewer');

        this.statTotalSize = document.getElementById('statTotalSize');
        this.statTotalFiles = document.getElementById('statTotalFiles');
        this.statOceanFiles = document.getElementById('statOceanFiles');
        this.invSearchInput = document.getElementById('invSearchInput');
        this.invTableBody = document.getElementById('invTableBody');
        this.btnRefreshInventory = document.getElementById('btnRefreshInventory');

        this.init();
    }

    async init() {
        this._initTimelineDates();
        this._initMap();
        this._bindEvents();
        await this.loadInventory();
        this.checkCacheStatus();
    }

    _initTimelineDates() {
        const today = new Date();
        const oneYearAgo = new Date();
        oneYearAgo.setDate(today.getDate() - 365);

        this.inEndTime.value = today.toISOString().slice(0, 10);
        this.inStartTime.value = oneYearAgo.toISOString().slice(0, 10);
    }

    _initMap() {
        const osmStyle = {
            version: 8,
            sources: {
                'osm-raster': {
                    type: 'raster',
                    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: '&copy; OpenStreetMap contributors'
                }
            },
            layers: [{
                id: 'osm-layer',
                type: 'raster',
                source: 'osm-raster',
                minzoom: 0,
                maxzoom: 19
            }]
        };

        this.map = new maplibregl.Map({
            container: 'dlMapContainer',
            style: osmStyle,
            center: [88.55, 19.8],
            zoom: 4,
            attributionControl: false
        });

        this.map.on('load', () => {
            this._setupMapSources();
            this.updateMapBBox(this.currentBBox, true);
        });

        this._setupMapDrawing();
    }

    _setupMapSources() {
        const geojson = this._bboxToGeoJSON(this.currentBBox);
        this.map.addSource('bbox-source', {
            type: 'geojson',
            data: geojson
        });

        this.map.addLayer({
            id: 'bbox-fill',
            type: 'fill',
            source: 'bbox-source',
            paint: {
                'fill-color': '#00e5a0',
                'fill-opacity': 0.15
            }
        });

        this.map.addLayer({
            id: 'bbox-line',
            type: 'line',
            source: 'bbox-source',
            paint: {
                'line-color': '#00e5a0',
                'line-width': 2.5,
                'line-dasharray': [2, 1]
            }
        });
    }

    _bboxToGeoJSON(b) {
        return {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [b.min_lon, b.min_lat],
                    [b.max_lon, b.min_lat],
                    [b.max_lon, b.max_lat],
                    [b.min_lon, b.max_lat],
                    [b.min_lon, b.min_lat]
                ]]
            }
        };
    }

    _setupMapDrawing() {
        const canvas = this.map.getCanvasContainer();

        this.map.on('mousedown', (e) => {
            if (!this.drawMode && !e.originalEvent.shiftKey) return;
            this.map.dragPan.disable();
            this.isDrawing = true;
            this.startLngLat = e.lngLat;
            canvas.style.cursor = 'crosshair';
        });

        this.map.on('mousemove', (e) => {
            if (!this.isDrawing || !this.startLngLat) return;
            const cur = e.lngLat;
            const min_lon = Math.min(this.startLngLat.lng, cur.lng);
            const max_lon = Math.max(this.startLngLat.lng, cur.lng);
            const min_lat = Math.min(this.startLngLat.lat, cur.lat);
            const max_lat = Math.max(this.startLngLat.lat, cur.lat);

            this.currentBBox = {
                min_lat: Math.round(min_lat * 100) / 100,
                max_lat: Math.round(max_lat * 100) / 100,
                min_lon: Math.round(min_lon * 100) / 100,
                max_lon: Math.round(max_lon * 100) / 100
            };

            this.updateInputs(this.currentBBox);
            this.updateMapBBox(this.currentBBox, false);
        });

        const finishDrawing = () => {
            if (!this.isDrawing) return;
            this.isDrawing = false;
            this.map.dragPan.enable();
            canvas.style.cursor = '';
            if (this.drawMode) {
                this.setDrawMode(false);
            }
            this.scheduleCheckCache();
        };

        this.map.on('mouseup', finishDrawing);
        canvas.addEventListener('mouseleave', finishDrawing);
    }

    setDrawMode(active) {
        this.drawMode = active;
        this.btnDrawBox.classList.toggle('active', active);
        if (active) {
            this.btnDrawBox.querySelector('span').textContent = 'DRAWING… (CLICK & DRAG)';
            this.map.getCanvasContainer().style.cursor = 'crosshair';
        } else {
            this.btnDrawBox.querySelector('span').textContent = 'DRAW BOUNDING BOX';
            this.map.getCanvasContainer().style.cursor = '';
        }
    }

    updateMapBBox(bbox, fit = false) {
        if (!this.map || !this.map.getSource('bbox-source')) return;
        this.map.getSource('bbox-source').setData(this._bboxToGeoJSON(bbox));

        if (fit) {
            this.map.fitBounds([
                [bbox.min_lon, bbox.min_lat],
                [bbox.max_lon, bbox.max_lat]
            ], { padding: 40, duration: 600 });
        }

        // Calculate approximate surface area in km²
        const latDist = (bbox.max_lat - bbox.min_lat) * 111;
        const midLatRad = ((bbox.min_lat + bbox.max_lat) / 2) * (Math.PI / 180);
        const lonDist = (bbox.max_lon - bbox.min_lon) * 111 * Math.cos(midLatRad);
        const areaKm2 = Math.round(Math.abs(latDist * lonDist));
        this.areaReadout.textContent = `Area: ~${areaKm2.toLocaleString()} km²`;
    }

    updateInputs(bbox) {
        this.inMinLat.value = bbox.min_lat;
        this.inMaxLat.value = bbox.max_lat;
        this.inMinLon.value = bbox.min_lon;
        this.inMaxLon.value = bbox.max_lon;
    }

    _bindEvents() {
        // Toggle drawing
        this.btnDrawBox.addEventListener('click', () => {
            this.setDrawMode(!this.drawMode);
        });

        // Preset ocean basins
        const presets = {
            bob: { min_lat: 16.07, max_lat: 23.52, min_lon: 84.10, max_lon: 93.00 },
            arabian: { min_lat: 12.00, max_lat: 24.00, min_lon: 60.00, max_lon: 75.00 },
            eio: { min_lat: -5.00, max_lat: 8.00, min_lon: 70.00, max_lon: 95.00 },
            scs: { min_lat: 5.00, max_lat: 22.00, min_lon: 105.00, max_lon: 120.00 },
            gulf: { min_lat: 24.00, max_lat: 30.00, min_lon: 48.00, max_lon: 57.00 }
        };

        document.querySelectorAll('.btn-preset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const p = presets[e.target.dataset.preset];
                if (p) {
                    this.currentBBox = { ...p };
                    this.updateInputs(p);
                    this.updateMapBBox(p, true);
                    this.scheduleCheckCache();
                }
            });
        });

        // Manual coordinate inputs
        const handleCoordChange = () => {
            const min_lat = parseFloat(this.inMinLat.value);
            const max_lat = parseFloat(this.inMaxLat.value);
            const min_lon = parseFloat(this.inMinLon.value);
            const max_lon = parseFloat(this.inMaxLon.value);

            if (!isNaN(min_lat) && !isNaN(max_lat) && !isNaN(min_lon) && !isNaN(max_lon)) {
                if (min_lat < max_lat && min_lon < max_lon) {
                    this.currentBBox = { min_lat, max_lat, min_lon, max_lon };
                    this.updateMapBBox(this.currentBBox, true);
                    this.scheduleCheckCache();
                }
            }
        };

        [this.inMinLat, this.inMaxLat, this.inMinLon, this.inMaxLon].forEach(input => {
            input.addEventListener('change', handleCoordChange);
        });

        // Timeline presets
        document.querySelectorAll('.btn-time-preset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.btn-time-preset').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');

                const days = parseInt(e.target.dataset.days, 10) || 30;
                const today = new Date();
                const past = new Date();
                past.setDate(today.getDate() - days);

                this.inEndTime.value = today.toISOString().slice(0, 10);
                this.inStartTime.value = past.toISOString().slice(0, 10);
                this.scheduleCheckCache();
            });
        });

        this.inStartTime.addEventListener('change', () => this.scheduleCheckCache());
        this.inEndTime.addEventListener('change', () => this.scheduleCheckCache());

        // Toggle all variables
        this.btnToggleAllVars.addEventListener('click', () => {
            const varBoxes = document.querySelectorAll('.var-chk');
            const anyUnchecked = Array.from(varBoxes).some(b => !b.checked);
            varBoxes.forEach(b => b.checked = anyUnchecked);
            this.btnToggleAllVars.textContent = anyUnchecked ? 'Deselect All' : 'Select All';
            this.scheduleCheckCache();
        });

        // Layer checkboxes change
        document.querySelectorAll('.layer-checkbox-card input').forEach(box => {
            box.addEventListener('change', () => this.scheduleCheckCache());
        });

        // Check Cache button
        this.btnCheckCache.addEventListener('click', () => this.checkCacheStatus());

        // Start Download button
        this.btnStartDownload.addEventListener('click', () => this.executeDownload());

        // Refresh inventory
        this.btnRefreshInventory.addEventListener('click', () => this.loadInventory(true));

        // Inventory search filter
        this.invSearchInput.addEventListener('input', (e) => this.filterInventory(e.target.value));
    }

    scheduleCheckCache() {
        clearTimeout(this.checkDebounce);
        this.checkDebounce = setTimeout(() => {
            this.checkCacheStatus();
        }, 300);
    }

    getSelectedLayers() {
        const layers = [];
        if (this.chkLand.checked) layers.push('land');
        if (this.chkCoast.checked) layers.push('coastline');
        if (this.chkEEZ.checked) layers.push('eez');
        if (this.chkSeabed.checked) layers.push('seabed');
        return layers;
    }

    getSelectedVariables() {
        const vars = [];
        document.querySelectorAll('.var-chk:checked').forEach(chk => {
            vars.push(chk.value);
        });
        return vars;
    }

    async checkCacheStatus() {
        this.cacheSummaryText.innerHTML = '<span style="opacity:0.7">Checking local cache status…</span>';
        try {
            const payload = {
                bbox: this.currentBBox,
                start_time: this.inStartTime.value ? `${this.inStartTime.value}T00:00:00Z` : null,
                end_time: this.inEndTime.value ? `${this.inEndTime.value}T23:59:59Z` : null,
                layers: this.getSelectedLayers(),
                variables: this.getSelectedVariables()
            };

            const res = await fetch('http://127.0.0.1:8080/api/download/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (data.all_cached) {
                this.cacheSummaryText.innerHTML = `⚡ <b>All selected layers are already downloaded on local disk!</b> (Instant 3D rendering)`;
                this.btnStartDownload.querySelector('span').textContent = 'RE-DOWNLOAD / UPDATE DATA';
            } else {
                this.cacheSummaryText.innerHTML = `📥 <b>${data.missing_count} item(s) need downloading</b> · Est. time: ~${data.estimated_seconds}s (Single-pass timeline download)`;
                this.btnStartDownload.querySelector('span').textContent = 'DOWNLOAD SELECTED DATA TO LOCAL DISK';
            }
        } catch (e) {
            this.cacheSummaryText.textContent = 'Could not verify cache status (Server offline or busy).';
        }
    }

    async executeDownload() {
        this.btnStartDownload.disabled = true;
        this.progressBox.classList.add('active');
        this.btnLaunchViewer.classList.remove('active');
        this.progressBarFill.style.width = '10%';
        this._log(`[Starting] Initializing batch download for BBOX [${this.currentBBox.min_lat}°N, ${this.currentBBox.max_lat}°N, ${this.currentBBox.min_lon}°E, ${this.currentBBox.max_lon}°E]…`);

        const layers = this.getSelectedLayers();
        const vars = this.getSelectedVariables();
        const resolution = this.selResolution?.value || 'medium';

        try {
            if (layers.includes('land') || layers.includes('coastline') || layers.includes('eez')) {
                this._log(`[Geography] Extracting coastline, islands & maritime EEZ vectors…`);
                this.progressBarFill.style.width = '30%';
            }

            if (layers.includes('seabed')) {
                this._log(`[Seabed] Subsetting authoritative GEBCO 2026 elevation grid (${resolution})…`);
                this.progressBarFill.style.width = '50%';
            }

            if (vars.length > 0) {
                this._log(`[Copernicus] Downloading full timeline NetCDF batch for ${vars.join(', ')} (${this.inStartTime.value} to ${this.inEndTime.value})…`);
                this.progressBarFill.style.width = '70%';
            }

            const payload = {
                bbox: this.currentBBox,
                start_time: this.inStartTime.value ? `${this.inStartTime.value}T00:00:00Z` : null,
                end_time: this.inEndTime.value ? `${this.inEndTime.value}T23:59:59Z` : null,
                layers,
                variables: vars,
                resolution
            };

            const res = await fetch('http://127.0.0.1:8080/api/download/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({ detail: res.statusText }));
                throw new Error(errData.detail || 'Download request failed.');
            }

            const data = await res.json();
            this.progressBarFill.style.width = '100%';
            this._log(`[Saved] ✓ ${data.message}`);

            if (data.saved_files && data.saved_files.length > 0) {
                data.saved_files.forEach(f => {
                    this._log(`[Storage] Saved: ${f.split('/').pop()}`);
                });
            }

            this.btnLaunchViewer.href = data.viewer_url || '/';
            this.btnLaunchViewer.classList.add('active');

            // Refresh inventory and cache status
            await this.loadInventory(true);
            this.checkCacheStatus();

        } catch (err) {
            this._log(`[Error] ❌ Download failed: ${err.message}`);
            this.progressBarFill.style.width = '0%';
        } finally {
            this.btnStartDownload.disabled = false;
        }
    }

    _log(msg) {
        const line = document.createElement('div');
        line.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
        this.logTerminal.appendChild(line);
        this.logTerminal.scrollTop = this.logTerminal.scrollHeight;
    }

    async loadInventory(force = false) {
        try {
            const url = force ? 'http://127.0.0.1:8080/api/download/inventory?refresh=true' : 'http://127.0.0.1:8080/api/download/inventory';
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            this.inventoryData = data;

            // Update stats
            this.statTotalSize.textContent = data.summary?.total_size_formatted || '0 B';
            this.statTotalFiles.textContent = data.summary?.total_files || 0;
            this.statOceanFiles.textContent = data.summary?.ocean_files_count || 0;

            this.renderInventoryTable(this._combineInventoryItems(data));
        } catch (e) {
            console.warn('[DownloadManager] Failed loading inventory:', e);
            this.invTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--accent-red); padding: 20px;">Could not connect to API server at http://127.0.0.1:8080</td></tr>`;
        }
    }

    _combineInventoryItems(data) {
        const items = [];
        if (data.local_models) {
            data.local_models.forEach(m => items.push({ ...m, category: 'Local Model' }));
        }
        if (data.ocean_downloads) {
            data.ocean_downloads.forEach(o => items.push({ ...o, category: 'Copernicus NetCDF' }));
        }
        if (data.bathymetry_downloads) {
            data.bathymetry_downloads.forEach(b => items.push({ ...b, category: 'Seabed Grid' }));
        }
        if (data.geography_downloads) {
            data.geography_downloads.forEach(g => items.push({ ...g, category: 'Geography' }));
        }
        return items;
    }

    renderInventoryTable(items) {
        if (!items || items.length === 0) {
            this.invTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 30px;">No downloaded dataset files found on local disk.</td></tr>`;
            return;
        }

        const rows = items.map(item => {
            const varId = item.variable || item.type || 'Dataset';
            let badgeClass = 'badge-model';
            if (varId.includes('temperature') || varId.includes('thetao')) badgeClass = 'badge-temp';
            else if (varId.includes('salinity') || varId.includes('so')) badgeClass = 'badge-sal';
            else if (varId.includes('current') || varId.includes('uo')) badgeClass = 'badge-cur';
            else if (varId.includes('height') || varId.includes('zos')) badgeClass = 'badge-ssh';
            else if (varId.includes('Geometry') || varId.includes('Coast')) badgeClass = 'badge-geo';

            const covStr = item.bbox 
                ? `${item.bbox.min_lat}°–${item.bbox.max_lat}°N, ${item.bbox.min_lon}°–${item.bbox.max_lon}°E`
                : '—';

            const timeStr = item.time_range 
                ? `${item.time_range.start} to ${item.time_range.end}`
                : '—';

            const sizeStr = item.size_formatted || '—';

            let viewerLink = '/';
            if (item.bbox) {
                viewerLink = `/?min_lat=${item.bbox.min_lat}&max_lat=${item.bbox.max_lat}&min_lon=${item.bbox.min_lon}&max_lon=${item.bbox.max_lon}`;
                if (item.time_range?.start) viewerLink += `&time=${item.time_range.start}T12:00:00Z`;
            }

            return `
                <tr>
                  <td>
                    <span class="badge-var ${badgeClass}">${varId}</span>
                    <div style="font-size: 10px; color: var(--text-dim); margin-top: 2px; font-family: var(--font-mono);">${item.filename}</div>
                  </td>
                  <td style="font-family: var(--font-mono); font-size: 11px;">${covStr}</td>
                  <td style="font-family: var(--font-mono); font-size: 11px;">${timeStr}</td>
                  <td style="font-family: var(--font-mono); font-size: 11px; font-weight: 600;">${sizeStr}</td>
                  <td>
                    <a href="${viewerLink}" class="btn-table-action" title="Open in 3D Ocean Viewer">Explore 3D →</a>
                  </td>
                </tr>
            `;
        }).join('');

        this.invTableBody.innerHTML = rows;
    }

    filterInventory(query) {
        if (!this.inventoryData) return;
        const q = (query || '').toLowerCase().trim();
        const all = this._combineInventoryItems(this.inventoryData);

        if (!q) {
            this.renderInventoryTable(all);
            return;
        }

        const filtered = all.filter(item => {
            const v = (item.variable || item.type || '').toLowerCase();
            const f = (item.filename || '').toLowerCase();
            const cov = item.bbox ? `${item.bbox.min_lat} ${item.bbox.max_lat} ${item.bbox.min_lon} ${item.bbox.max_lon}` : '';
            return v.includes(q) || f.includes(q) || cov.includes(q);
        });

        this.renderInventoryTable(filtered);
    }
}

// Instantiate upon DOM load
document.addEventListener('DOMContentLoaded', () => {
    window.downloadManager = new DownloadManager();
});
