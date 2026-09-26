// SolvX — Shared Geographic & Selection Context
// Single source of truth for active region, ocean variable, time, depth, and entity selection.
// Persists in localStorage and synchronizes with URL parameters across 2D Map, Home, and Analysis.

const STORAGE_KEY = 'solvx_selection_context';

export const PRESET_REGIONS = {
    bay_of_bengal: {
        id: 'bay_of_bengal',
        name: 'Bay of Bengal',
        bbox: { min_lon: 84.10, max_lon: 93.00, min_lat: 16.07, max_lat: 23.52 },
        desc: 'High-resolution GEBCO + INCOIS ocean model data',
        badge: 'Basin'
    },
    arabian_sea: {
        id: 'arabian_sea',
        name: 'Arabian Sea',
        bbox: { min_lon: 60.00, max_lon: 76.00, min_lat: 10.00, max_lat: 24.00 },
        desc: 'Western Indian Ocean & Somali Current',
        badge: 'Sea'
    },
    indian_ocean: {
        id: 'indian_ocean',
        name: 'Indian Ocean',
        bbox: { min_lon: 55.00, max_lon: 95.00, min_lat: -15.00, max_lat: 15.00 },
        desc: 'Tropical Indian Ocean & monsoon drift basin',
        badge: 'Ocean'
    },
    north_atlantic: {
        id: 'north_atlantic',
        name: 'North Atlantic',
        bbox: { min_lon: -65.00, max_lon: -20.00, min_lat: 15.00, max_lat: 45.00 },
        desc: 'Subtropical gyre, Sargasso Sea & Gulf Stream',
        badge: 'Ocean'
    },
    south_atlantic: {
        id: 'south_atlantic',
        name: 'South Atlantic',
        bbox: { min_lon: -35.00, max_lon: 10.00, min_lat: -35.00, max_lat: -10.00 },
        desc: 'South Atlantic basin & Benguela Current',
        badge: 'Ocean'
    },
    north_pacific: {
        id: 'north_pacific',
        name: 'North Pacific',
        bbox: { min_lon: 130.00, max_lon: 170.00, min_lat: 15.00, max_lat: 45.00 },
        desc: 'Northwest Pacific basin & Kuroshio extension',
        badge: 'Ocean'
    },
    south_pacific: {
        id: 'south_pacific',
        name: 'South Pacific',
        bbox: { min_lon: -150.00, max_lon: -110.00, min_lat: -35.00, max_lat: -5.00 },
        desc: 'South Pacific central subtropical gyre',
        badge: 'Ocean'
    },
    mediterranean_sea: {
        id: 'mediterranean_sea',
        name: 'Mediterranean Sea',
        bbox: { min_lon: 0.00, max_lon: 36.00, min_lat: 30.00, max_lat: 44.00 },
        desc: 'Semi-enclosed intercontinental marginal sea',
        badge: 'Sea'
    },
    southern_ocean: {
        id: 'southern_ocean',
        name: 'Southern Ocean',
        bbox: { min_lon: -70.00, max_lon: -20.00, min_lat: -65.00, max_lat: -50.00 },
        desc: 'Antarctic Circumpolar Current & Drake Passage',
        badge: 'Ocean'
    },
    arctic_ocean: {
        id: 'arctic_ocean',
        name: 'Arctic Ocean',
        bbox: { min_lon: -10.00, max_lon: 50.00, min_lat: 68.00, max_lat: 82.00 },
        desc: 'Greenland and Barents Sea polar waters',
        badge: 'Ocean'
    },
    gulf_of_mexico: {
        id: 'gulf_of_mexico',
        name: 'Gulf of Mexico',
        bbox: { min_lon: -97.00, max_lon: -80.00, min_lat: 18.00, max_lat: 31.00 },
        desc: 'Loop Current & Gulf Coast ocean system',
        badge: 'Sea'
    },
    red_sea: {
        id: 'red_sea',
        name: 'Red Sea',
        bbox: { min_lon: 32.00, max_lon: 44.00, min_lat: 12.00, max_lat: 28.50 },
        desc: 'Narrow inlet basin and rift zone',
        badge: 'Sea'
    },
    strait_of_hormuz: {
        id: 'strait_of_hormuz',
        name: 'Strait of Hormuz',
        bbox: { min_lon: 55.50, max_lon: 57.50, min_lat: 25.50, max_lat: 27.20 },
        desc: 'Strategic Persian Gulf strait',
        badge: 'Strait'
    },
    strait_of_malacca: {
        id: 'strait_of_malacca',
        name: 'Strait of Malacca',
        bbox: { min_lon: 98.00, max_lon: 104.50, min_lat: 1.00, max_lat: 6.00 },
        desc: 'Indo-Pacific maritime gateway',
        badge: 'Strait'
    }
};

const DEFAULT_STATE = {
    area: {
        id: 'bay_of_bengal',
        name: 'Bay of Bengal',
        bbox: { min_lon: 84.10, max_lon: 93.00, min_lat: 16.07, max_lat: 23.52 },
        polygon: null
    },
    variable: {
        id: 'ocean_temperature',
        name: 'Temperature',
        unit: '°C'
    },
    analysisMode: 'obs_vs_model',
    time: {
        current: null,
        start: null,
        end: null,
        available: []
    },
    depth: {
        current: 0,
        available: [0]
    },
    selection: {
        type: null, // 'cell' | 'argo' | 'glider' | 'anomaly' | 'region'
        id: null,
        lat: null,
        lon: null,
        depth: null,
        argoId: null,
        gliderId: null
    }
};

class SelectionContextStore {
    constructor() {
        this.state = this._loadInitialState();
        this._listeners = new Set();
    }

    _loadInitialState() {
        let loaded = null;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) loaded = JSON.parse(raw);
        } catch (_) {}

        // Fallback to URL search params if present
        const urlParams = new URLSearchParams(window.location.search);
        const regionParam = urlParams.get('region');
        const varParam = urlParams.get('var');

        const initial = { ...DEFAULT_STATE, ...(loaded || {}) };

        if (regionParam && PRESET_REGIONS[regionParam]) {
            initial.area = { ...PRESET_REGIONS[regionParam], polygon: null };
        }
        if (varParam) {
            initial.variable = {
                id: varParam,
                name: this._prettyVarName(varParam),
                unit: this._varUnit(varParam)
            };
        }

        return initial;
    }

    _save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        } catch (_) {}
    }

    _emit(eventType, detail) {
        const event = new CustomEvent(eventType, { detail });
        window.dispatchEvent(event);
        this._listeners.forEach(fn => {
            try { fn(eventType, detail, this.state); } catch (e) { console.error(e); }
        });
    }

    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    getState() {
        return this.state;
    }

    getArea() {
        return this.state.area;
    }

    setArea(areaObj) {
        if (!areaObj) return;
        let area = { ...areaObj };
        if (!area.name) {
            if (area.id && PRESET_REGIONS[area.id]) {
                area.name = PRESET_REGIONS[area.id].name;
            } else if (area.bbox) {
                area.name = `${area.bbox.min_lat.toFixed(1)}°-${area.bbox.max_lat.toFixed(1)}°N, ${area.bbox.min_lon.toFixed(1)}°-${area.bbox.max_lon.toFixed(1)}°E`;
            } else {
                area.name = 'Custom Region';
            }
        }
        this.state.area = area;
        this.state.selection = { ...DEFAULT_STATE.selection }; // reset selection on area change
        this._save();
        this._emit('solvx:areaChange', this.state.area);
    }

    getVariable() {
        return this.state.variable;
    }

    setVariable(varId) {
        this.state.variable = {
            id: varId,
            name: this._prettyVarName(varId),
            unit: this._varUnit(varId)
        };
        this._save();
        this._emit('solvx:variableChange', this.state.variable);
    }

    getAnalysisMode() {
        return this.state.analysisMode || 'obs_vs_model';
    }

    setAnalysisMode(mode) {
        this.state.analysisMode = mode;
        this._save();
        this._emit('solvx:analysisModeChange', mode);
    }

    getTime() {
        return this.state.time;
    }

    setTime(timeObj) {
        this.state.time = { ...this.state.time, ...timeObj };
        this._save();
        this._emit('solvx:timeChange', this.state.time);
    }

    getDepth() {
        return this.state.depth;
    }

    setDepth(depthM) {
        this.state.depth.current = Number(depthM);
        this._save();
        this._emit('solvx:depthChange', this.state.depth.current);
    }

    setDepthLevels(levels) {
        this.state.depth.available = levels;
        this._save();
    }

    getSelection() {
        return this.state.selection;
    }

    setSelection(selectionObj) {
        this.state.selection = { ...this.state.selection, ...selectionObj };
        this._save();
        this._emit('solvx:selectionChange', this.state.selection);
    }

    clearSelection() {
        this.state.selection = { ...DEFAULT_STATE.selection };
        this._save();
        this._emit('solvx:selectionChange', this.state.selection);
    }

    _prettyVarName(id) {
        const map = {
            ocean_temperature: 'Temperature',
            temperature: 'Temperature',
            salinity: 'Salinity',
            chlorophyll: 'Chlorophyll',
            sea_level: 'Sea Level',
            sea_surface_height: 'Sea Level',
            currents: 'Currents'
        };
        return map[id] || id;
    }

    _varUnit(id) {
        const map = {
            ocean_temperature: '°C',
            temperature: '°C',
            salinity: 'PSU',
            chlorophyll: 'mg/m³',
            sea_level: 'm',
            sea_surface_height: 'm',
            currents: 'm/s'
        };
        return map[id] || '';
    }
}

export const SelectionContext = new SelectionContextStore();
