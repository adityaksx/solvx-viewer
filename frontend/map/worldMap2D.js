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
            return {
                version: 8,
                sources: {
                    'carto-dark': {
                        type: 'raster',
                        tiles: [
                            'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                            'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                            'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                            'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
                        ],
                        tileSize: 256,
                        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>'
                    }
                },
                layers: [
                    {
                        id: 'carto-dark-layer',
                        type: 'raster',
                        source: 'carto-dark',
                        minzoom: 0,
                        maxzoom: 19
                    }
                ]
            };
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
            const onReady = () => {
                this.isLoaded = true;
                this._initLayers();
                this.setBBox(this.currentBBox, false);
                this.loadEEZForBBox(this.currentBBox);
                resolve(this);
            };

            if (this.map.loaded()) {
                onReady();
            } else {
                this.map.once('load', onReady);
            }
        });
    }

    setBasemap(styleKey) {
        if (this.currentBasemap === styleKey || !this.map) return;
        this.currentBasemap = styleKey;
        const style = this._getBasemapStyle(styleKey);
        this.map.setStyle(style);
        this.map.once('style.load', () => {
            this._initLayers();
            this.setBBox(this.currentBBox, false);
            if (this.showEEZ) {
                this.loadEEZForBBox(this.currentBBox);
            }
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
