// SolvX — Interactive 2D World Map (MapLibre GL JS)
// 100% Open-Source Maps: OpenStreetMap (OSM), OpenTopoMap, and OpenStreetMap Dark
// Provides pan/zoom, bounding box drawing, EEZ boundaries, and real-time area calculation.

import { ApiClient } from '../api/apiClient.js';

export class WorldMap2D {
    constructor(containerId, options = {}) {
        this.containerId = containerId;
        this.options = options;
        this.map = null;
        this.isLoaded = false;
        this.onBBoxChange = options.onBBoxChange || null;
        this.currentBBox = options.initialBBox || {
            min_lon: 84.10,
            max_lon: 93.00,
            min_lat: 16.07,
            max_lat: 23.52
        };
        this.currentBasemap = options.basemap || 'osm';
        this.showEEZ = true;
    }

    _getBasemapStyle(key) {
        if (key === 'opentopo') {
            return {
                version: 8,
                sources: {
                    'opentopo-source': {
                        type: 'raster',
                        tiles: [
                            'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
                            'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
                            'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'
                        ],
                        tileSize: 256,
                        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, <a href="https://opentopomap.org" target="_blank">OpenTopoMap</a>'
                    }
                },
                layers: [
                    {
                        id: 'opentopo-layer',
                        type: 'raster',
                        source: 'opentopo-source',
                        minzoom: 0,
                        maxzoom: 17
                    }
                ]
            };
        }

        if (key === 'osm-dark') {
            // OpenFreeMap Dark Mode — 100% Free, Open-Source & Token-Free Vector Basemap
            return 'https://tiles.openfreemap.org/styles/dark';
        }


        // OpenStreetMap Standard (Open-Source Default)
        return {
            version: 8,
            sources: {
                'osm-raster': {
                    type: 'raster',
                    tiles: [
                        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
                    ],
                    tileSize: 256,
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
                }
            },
            layers: [
                {
                    id: 'osm-raster-layer',
                    type: 'raster',
                    source: 'osm-raster',
                    minzoom: 0,
                    maxzoom: 19
                }
            ]
        };
    }

    async init() {
        if (!window.maplibregl) {
            throw new Error('MapLibre GL JS is not loaded. Ensure maplibre-gl.js script is included.');
        }

        const style = this._getBasemapStyle(this.currentBasemap);
        const centerLon = (this.currentBBox.min_lon + this.currentBBox.max_lon) / 2;
        const centerLat = (this.currentBBox.min_lat + this.currentBBox.max_lat) / 2;

        this.map = new window.maplibregl.Map({
            container: this.containerId,
            style: style,
            center: [centerLon, centerLat],
            zoom: 4.8,
            attributionControl: true
        });

        // Add standard navigation controls (zoom, compass)
        this.map.addControl(new window.maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
        this.map.addControl(new window.maplibregl.ScaleControl({ maxWidth: 200, unit: 'metric' }), 'bottom-left');

        return new Promise((resolve) => {
            const onMapReady = () => {
                this.isLoaded = true;
                try {
                    this._initLayers();
                    const targetBBox = this.pendingBBox || this.currentBBox;
                    const fitTarget = this.pendingFit !== undefined ? this.pendingFit : false;
                    const targetAreaName = this.pendingAreaName || this.currentAreaName || 'Bay of Bengal';
                    this.setBBox(targetBBox, fitTarget, targetAreaName);
                    this.pendingBBox = null;
                    this.pendingFit = null;
                    this.pendingAreaName = null;
                    if (this.showEEZ) {
                        this.loadEEZForBBox(this.currentBBox);
                    }
                } catch (e) {
                    console.warn('[WorldMap2D] Layer setup deferred:', e);
                }
                resolve(this);
            };

            this.map.on('load', onMapReady);
            this.map.on('style.load', () => {
                if (this.isLoaded) {
                    try {
                        this._initLayers();
                        const source = this.map.getSource('selection-box-source');
                        if (source) {
                            source.setData(this._createBBoxGeoJSON(this.currentBBox));
                        }
                        if (this.showEEZ) {
                            this.loadEEZForBBox(this.currentBBox);
                        }
                    } catch (e) {
                        console.warn('[WorldMap2D] Style reload layer restore error:', e);
                    }
                }
            });

            if (this.map.loaded() || this.map.isStyleLoaded()) {
                onMapReady();
            }
        });
    }

    setBasemap(styleKey) {
        if (this.currentBasemap === styleKey && this.map) return;
        this.currentBasemap = styleKey;
        if (!this.map) return;
        const style = this._getBasemapStyle(styleKey);
        this.map.setStyle(style);
        this.map.once('style.load', () => {
            try {
                this._initLayers();
                this.setBBox(this.currentBBox, false, this.currentAreaName);
                if (this.showEEZ) {
                    this.loadEEZForBBox(this.currentBBox);
                }
            } catch (e) {
                console.warn('[WorldMap2D] Basemap style layer update deferred:', e);
            }
        });
    }

    _initLayers() {
        if (!this.map || !this.map.isStyleLoaded()) return;

        // 1. EEZ Boundaries Layer (Real VLIZ / Marine Regions v12)
        if (!this.map.getSource('eez-source')) {
            this.map.addSource('eez-source', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
        }

        if (!this.map.getLayer('eez-layer')) {
            this.map.addLayer({
                id: 'eez-layer',
                type: 'line',
                source: 'eez-source',
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round',
                    'visibility': this.showEEZ ? 'visible' : 'none'
                },
                paint: {
                    'line-color': '#ffb703',
                    'line-width': 1.8,
                    'line-opacity': 0.85,
                    'line-dasharray': [3, 2]
                }
            });
        }

        // 2. Selection Box Source & Layers (High-contrast ocean blue rectangle)
        if (!this.map.getSource('selection-box-source')) {
            this.map.addSource('selection-box-source', {
                type: 'geojson',
                data: this._createBBoxGeoJSON(this.currentBBox)
            });
        }

        // Blue Fill
        if (!this.map.getLayer('selection-box-fill')) {
            this.map.addLayer({
                id: 'selection-box-fill',
                type: 'fill',
                source: 'selection-box-source',
                filter: ['==', ['geometry-type'], 'Polygon'],
                paint: {
                    'fill-color': '#0284c7',
                    'fill-opacity': 0.22
                }
            });
        }

        // Blue Outline (High contrast)
        if (!this.map.getLayer('selection-box-line')) {
            this.map.addLayer({
                id: 'selection-box-line',
                type: 'line',
                source: 'selection-box-source',
                filter: ['==', ['geometry-type'], 'Polygon'],
                paint: {
                    'line-color': '#0284c7',
                    'line-width': 3.0,
                    'line-opacity': 0.95
                }
            });
        }

        // Corner handles
        if (!this.map.getLayer('selection-box-corners')) {
            this.map.addLayer({
                id: 'selection-box-corners',
                type: 'circle',
                source: 'selection-box-source',
                filter: ['==', ['geometry-type'], 'Point'],
                paint: {
                    'circle-radius': 5.5,
                    'circle-color': '#ffffff',
                    'circle-stroke-width': 2.5,
                    'circle-stroke-color': '#0284c7'
                }
            });
        }
    }

    setTheme(themeName) {
        const isDark = themeName === 'dark';
        const targetBasemap = isDark ? 'osm-dark' : 'osm';
        const select = document.getElementById('mapBasemapSelect');
        if (select) {
            select.value = targetBasemap;
        }
        if (!this.map) {
            this.currentBasemap = targetBasemap;
            return;
        }
        this.setBasemap(targetBasemap);
    }

    _createBBoxGeoJSON(bbox) {
        const { min_lon, max_lon, min_lat, max_lat } = bbox;
        const polygonCoords = [
            [
                [min_lon, min_lat],
                [max_lon, min_lat],
                [max_lon, max_lat],
                [min_lon, max_lat],
                [min_lon, min_lat]
            ]
        ];
        return {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: { role: 'boundary' },
                    geometry: {
                        type: 'Polygon',
                        coordinates: polygonCoords
                    }
                },
                {
                    type: 'Feature',
                    properties: { corner: 'sw' },
                    geometry: { type: 'Point', coordinates: [min_lon, min_lat] }
                },
                {
                    type: 'Feature',
                    properties: { corner: 'se' },
                    geometry: { type: 'Point', coordinates: [max_lon, min_lat] }
                },
                {
                    type: 'Feature',
                    properties: { corner: 'ne' },
                    geometry: { type: 'Point', coordinates: [max_lon, max_lat] }
                },
                {
                    type: 'Feature',
                    properties: { corner: 'nw' },
                    geometry: { type: 'Point', coordinates: [min_lon, max_lat] }
                }
            ]
        };
    }

    setBBox(bbox, fit = false, areaName = null) {
        this.currentBBox = { ...bbox };
        if (areaName) {
            this.currentAreaName = areaName;
        }
        if (!this.map || !this.isLoaded) {
            this.pendingBBox = { ...bbox };
            this.pendingFit = fit;
            this.pendingAreaName = areaName;
            return;
        }

        if (this.map.isStyleLoaded() && !this.map.getSource('selection-box-source')) {
            this._initLayers();
        }

        const source = this.map.getSource('selection-box-source');
        if (source) {
            source.setData(this._createBBoxGeoJSON(this.currentBBox));
        }

        this._updateSelectionBadge(this.currentBBox, this.currentAreaName);

        if (fit) {
            const container = this.map.getContainer();
            const w = container ? container.clientWidth : 0;
            const h = container ? container.clientHeight : 0;
            if (w > 160 && h > 160) {
                try {
                    this.map.fitBounds(
                        [
                            [this.currentBBox.min_lon, this.currentBBox.min_lat],
                            [this.currentBBox.max_lon, this.currentBBox.max_lat]
                        ],
                        { padding: 80, duration: 600, maxZoom: 8 }
                    );
                } catch (e) {
                    console.warn('[WorldMap2D] fitBounds skipped:', e);
                }
            }
        }
    }

    _updateSelectionBadge(bbox, areaName) {
        if (!this.map || !window.maplibregl) return;
        const centerLon = (bbox.min_lon + bbox.max_lon) / 2;
        const topLat = bbox.max_lat;
        const displayName = areaName || this.currentAreaName || 'Selected Area';
        const coordsText = `${bbox.min_lat.toFixed(2)}°N–${bbox.max_lat.toFixed(2)}°N, ${bbox.min_lon.toFixed(2)}°E–${bbox.max_lon.toFixed(2)}°E`;

        if (!this.selectionPopup) {
            this.selectionPopup = new window.maplibregl.Popup({
                closeButton: false,
                closeOnClick: false,
                className: 'solvx-map-badge-popup',
                offset: [0, -12]
            });
        }

        this.selectionPopup
            .setLngLat([centerLon, topLat])
            .setHTML(`
                <div class="map-selection-hud-badge">
                    <span class="hud-status-dot"></span>
                    <strong class="hud-badge-title">${displayName}</strong>
                    <span class="hud-badge-coords">${coordsText}</span>
                </div>
            `)
            .addTo(this.map);
    }


    async loadEEZForBBox(bbox) {
        if (!this.map || !this.isLoaded) return;
        try {
            const eezData = await ApiClient.getDataEEZ(bbox);
            const source = this.map.getSource('eez-source');
            if (source && eezData && eezData.features) {
                source.setData(eezData);
            }
        } catch (e) {
            console.warn('[WorldMap2D] Failed loading EEZ data for map:', e);
        }
    }

    setEEZVisibility(visible) {
        this.showEEZ = visible;
        if (this.map && this.isLoaded && this.map.getLayer('eez-layer')) {
            this.map.setLayoutProperty('eez-layer', 'visibility', visible ? 'visible' : 'none');
        }
    }

    resize() {
        if (!this.map) return;
        this.map.resize();
        const container = this.map.getContainer();
        const w = container ? container.clientWidth : 0;
        const h = container ? container.clientHeight : 0;
        if (w > 160 && h > 160 && this.isLoaded) {
            try {
                this.map.fitBounds(
                    [
                        [this.currentBBox.min_lon, this.currentBBox.min_lat],
                        [this.currentBBox.max_lon, this.currentBBox.max_lat]
                    ],
                    { padding: 80, duration: 300, maxZoom: 8 }
                );
            } catch (e) {
                // ignore
            }
        }
    }

    getMap() {
        return this.map;
    }
}
