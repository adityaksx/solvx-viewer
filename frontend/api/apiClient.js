// SolvX Viewer — Centralized API Client

const API_BASE = (
    window.location.port === '5500' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === 'localhost'
)
    ? `http://${window.location.hostname || '127.0.0.1'}:8080`
    : window.location.origin;

async function request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const res = await fetch(url, {
        cache: 'no-store',
        ...options
    });
    if (!res.ok) {
        let errText = '';
        try {
            errText = await res.text();
        } catch (_) {}
        throw new Error(`API ${res.status}: ${errText || res.statusText}`);
    }
    return res.json();
}

export const ApiClient = {
    getBaseUrl() {
        return API_BASE;
    },

    // =========================================================================
    // Central SolvX Data Collector Endpoints (/api/data/*)
    // =========================================================================

    async getConfig() {
        return request('/api/config');
    },

    async getDataVariables() {
        return request('/api/data/variables');
    },

    async getDataTimeline({ variable, bbox = null, depth = null }) {
        const q = new URLSearchParams({ variable });
        if (bbox) {
            q.set('min_lon', String(bbox.min_lon));
            q.set('max_lon', String(bbox.max_lon));
            q.set('min_lat', String(bbox.min_lat));
            q.set('max_lat', String(bbox.max_lat));
        }
        if (depth != null) q.set('depth', String(depth));
        return request(`/api/data/timeline?${q}`);
    },

    async getDataEEZ(bbox) {
        const q = new URLSearchParams({
            min_lon: String(bbox.min_lon),
            max_lon: String(bbox.max_lon),
            min_lat: String(bbox.min_lat),
            max_lat: String(bbox.max_lat)
        });
        return request(`/api/data/eez?${q}`);
    },

    async getProviders() {
        return request('/api/data/providers');
    },

    async getProviderStatus() {
        return request('/api/data/providers/status');
    },

    async getCombinedRegion({ provider = 'auto', variable = 'temperature', bbox, depth = null, time = null, resolution = 'medium', include_bathymetry = true }) {
        const q = new URLSearchParams({
            provider,
            variable,
            min_lon: String(bbox.min_lon),
            max_lon: String(bbox.max_lon),
            min_lat: String(bbox.min_lat),
            max_lat: String(bbox.max_lat),
            resolution,
            include_bathymetry: String(include_bathymetry)
        });
        if (depth != null) q.set('depth', String(depth));
        if (time) q.set('time', time);
        return request(`/api/data/region?${q}`);
    },

    async getOceanVariable({ provider = 'auto', variable, bbox, depth = null, time = null, stride = 1, resolution = 'native' }) {
        const q = new URLSearchParams({
            provider,
            variable,
            min_lon: String(bbox.min_lon),
            max_lon: String(bbox.max_lon),
            min_lat: String(bbox.min_lat),
            max_lat: String(bbox.max_lat),
            stride: String(stride),
            resolution
        });
        if (depth != null) q.set('depth', String(depth));
        if (time) q.set('time', time);
        return request(`/api/data/ocean?${q}`);
    },

    async getOceanVariables({ provider = 'auto', bbox, depth = null, time = null }) {
        const q = new URLSearchParams({
            provider,
            min_lon: String(bbox.min_lon),
            max_lon: String(bbox.max_lon),
            min_lat: String(bbox.min_lat),
            max_lat: String(bbox.max_lat)
        });
        if (depth != null) q.set('depth', String(depth));
        if (time) q.set('time', time);
        return request(`/api/data/ocean?${q}`);
    },

    async getDataGeometry(bbox) {
        const q = new URLSearchParams({
            min_lon: String(bbox.min_lon),
            max_lon: String(bbox.max_lon),
            min_lat: String(bbox.min_lat),
            max_lat: String(bbox.max_lat)
        });
        return request(`/api/data/geometry?${q}`);
    },

    async getDataCoastline(bbox) {
        const q = new URLSearchParams({
            min_lon: String(bbox.min_lon),
            max_lon: String(bbox.max_lon),
            min_lat: String(bbox.min_lat),
            max_lat: String(bbox.max_lat)
        });
        return request(`/api/data/coastline?${q}`);
    },

    async getDataBathymetry(bbox, resolution = 'medium') {
        const q = new URLSearchParams({
            min_lon: String(bbox.min_lon),
            max_lon: String(bbox.max_lon),
            min_lat: String(bbox.min_lat),
            max_lat: String(bbox.max_lat),
            resolution
        });
        return request(`/api/data/bathymetry?${q}`);
    },

    async getDataObservations(bbox = null) {
        const q = new URLSearchParams();
        if (bbox) {
            q.set('min_lon', String(bbox.min_lon));
            q.set('max_lon', String(bbox.max_lon));
            q.set('min_lat', String(bbox.min_lat));
            q.set('max_lat', String(bbox.max_lat));
        }
        return request(`/api/data/observations?${q}`);
    },

    // =========================================================================
    // Region & Geography Endpoints
    // =========================================================================

    async getPresets() {
        return request('/api/region/presets');
    },

    async validateRegion(bbox) {
        return request('/api/region/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bbox)
        });
    },

    async getGeography(bbox) {
        const q = new URLSearchParams({
            min_lon: String(bbox.min_lon),
            max_lon: String(bbox.max_lon),
            min_lat: String(bbox.min_lat),
            max_lat: String(bbox.max_lat)
        });
        return request(`/api/geography?${q}`);
    },

    async getBathymetry(bbox) {
        const q = new URLSearchParams({
            min_lon: String(bbox.min_lon),
            max_lon: String(bbox.max_lon),
            min_lat: String(bbox.min_lat),
            max_lat: String(bbox.max_lat)
        });
        return request(`/api/bathymetry?${q}`);
    },

    async getCatalog() {
        return request('/api/ocean/catalog');
    },

    async getTime() {
        return request('/api/ocean/time');
    },

    async getCurrentGrid(time = null, depth = null, stride = 3) {
        const q = new URLSearchParams({ stride: String(stride) });
        if (time) q.set('time', time);
        if (depth != null) q.set('depth', String(depth));
        return request(`/api/ocean/current-grid?${q}`);
    },

    async getPoint(lat, lon, time = null) {
        const q = new URLSearchParams({
            latitude: String(lat),
            longitude: String(lon)
        });
        if (time) q.set('time', time);
        return request(`/api/ocean/point?${q}`);
    },

    async getRegionArray(params) {
        const q = new URLSearchParams({
            file: params.file,
            variable: params.variable,
            stride: String(params.stride || 1)
        });
        if (params.lat_min != null) q.set('lat_min', String(params.lat_min));
        if (params.lat_max != null) q.set('lat_max', String(params.lat_max));
        if (params.lon_min != null) q.set('lon_min', String(params.lon_min));
        if (params.lon_max != null) q.set('lon_max', String(params.lon_max));
        if (params.depth_min != null) q.set('depth_min', String(params.depth_min));
        if (params.depth_max != null) q.set('depth_max', String(params.depth_max));
        if (params.time_start) q.set('time_start', params.time_start);
        if (params.time_end) q.set('time_end', params.time_end);
        return request(`/api/ocean/region-array?${q}`);
    },

    async getMetadata(filename) {
        return request(`/metadata/${encodeURIComponent(filename)}`);
    },

    async getObservations(bbox = null) {
        const q = new URLSearchParams();
        if (bbox) {
            q.set('min_lon', String(bbox.min_lon));
            q.set('max_lon', String(bbox.max_lon));
            q.set('min_lat', String(bbox.min_lat));
            q.set('max_lat', String(bbox.max_lat));
        }
        return request(`/api/observations?${q}`);
    },

    async compareObservation(obsId) {
        return request(`/api/observations/compare/${encodeURIComponent(obsId)}`);
    }
};
