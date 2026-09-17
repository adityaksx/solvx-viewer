// SolvX — Interactive 2D World Map (MapLibre GL JS)
// Provides pan/zoom, basemap fallback (MapTiler -> OpenStreetMap),
// real Marine Regions EEZ vector layer, and selection rectangle display.

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
        this.maptilerKey = options.maptilerKey || '';
        this.showEEZ = true;
    }

    async init() {
        if (!window.maplibregl) {
            throw new Error('MapLibre GL JS is not loaded. Ensure maplibre-gl.js script is included.');
        }

        // Fetch server client config if maptiler key not passed
        if (!this.maptilerKey) {
            try {
                const cfg = await ApiClient.getConfig();
                if (cfg && cfg.maptiler_api_key) {
                    this.maptilerKey = cfg.maptiler_api_key;
                }
            } catch (e) {
                console.warn('[WorldMap2D] Could not fetch /api/config, proceeding with default OSM tiles:', e);
            }
        }

        const osmRasterStyle = {
            version: 8,
            sources: {
                'osm-raster': {
                    type: 'raster',
                    tiles: [
                        'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
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

        const style = this.maptilerKey
            ? `https://api.maptiler.com/maps/ocean/style.json?key=${this.maptilerKey}`
            : osmRasterStyle;

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

        // Handle possible MapTiler load failure by falling back to OSM raster
        this.map.on('error', (e) => {
            if (this.maptilerKey && e.error && e.error.status === 403) {
                console.warn('[WorldMap2D] MapTiler key unauthorized or failed, switching to OpenStreetMap raster tiles.');
                this.maptilerKey = '';
                this.map.setStyle(osmRasterStyle);
            }
        });

        return new Promise((resolve) => {
            this.map.on('load', () => {
                this.isLoaded = true;
                this._initLayers();
                this.setBBox(this.currentBBox, true);
                this.loadEEZForBBox(this.currentBBox);
                resolve(this);
            });
        });
    }

    _initLayers() {
        // 1. EEZ Boundaries Layer (Real VLIZ / Marine Regions v12)
        this.map.addSource('eez-source', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

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

        // 2. Selection Box Source & Layers
        this.map.addSource('selection-box-source', {
            type: 'geojson',
            data: this._createBBoxGeoJSON(this.currentBBox)
        });

        // Fill
        this.map.addLayer({
            id: 'selection-box-fill',
            type: 'fill',
            source: 'selection-box-source',
            filter: ['==', '$type', 'Polygon'],
            paint: {
                'fill-color': '#00e5ff',
                'fill-opacity': 0.18
            }
        });

        // Outline
        this.map.addLayer({
            id: 'selection-box-line',
            type: 'line',
            source: 'selection-box-source',
            filter: ['==', '$type', 'Polygon'],
            paint: {
                'line-color': '#00e5ff',
                'line-width': 2.5
            }
        });

        // Corner handles
        this.map.addLayer({
            id: 'selection-box-corners',
            type: 'circle',
            source: 'selection-box-source',
            filter: ['==', '$type', 'Point'],
            paint: {
                'circle-radius': 5,
                'circle-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#00e5ff'
            }
        });
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

    setBBox(bbox, fit = false) {
        this.currentBBox = { ...bbox };
        if (!this.map || !this.isLoaded) return;

        const source = this.map.getSource('selection-box-source');
        if (source) {
            source.setData(this._createBBoxGeoJSON(this.currentBBox));
        }

        if (fit) {
            this.map.fitBounds(
                [
                    [this.currentBBox.min_lon, this.currentBBox.min_lat],
                    [this.currentBBox.max_lon, this.currentBBox.max_lat]
                ],
                { padding: 80, duration: 800, maxZoom: 8 }
            );
        }
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
        if (this.map) {
            this.map.resize();
        }
    }

    getMap() {
        return this.map;
    }
}
