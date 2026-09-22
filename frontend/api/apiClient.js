// SolvX Viewer — High-Performance Centralized API Client
// Implements client-side LRU cache, single-flight deduplication, and AbortController request cancellation.

const API_BASE = (
    window.location.port === '5500' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === 'localhost'
)
    ? `http://${window.location.hostname || '127.0.0.1'}:8080`
    : window.location.origin;

const inFlightRequests = new Map();
const clientLRUCache = new Map();
const MAX_CACHE_ENTRIES = 50;

const activeAbortControllers = new Map();

function getFromCache(key) {
    if (!clientLRUCache.has(key)) return null;
    const item = clientLRUCache.get(key);
    // Refresh LRU order
    clientLRUCache.delete(key);
    clientLRUCache.set(key, item);
    return item;
}

function setToCache(key, value) {
    if (clientLRUCache.has(key)) {
        clientLRUCache.delete(key);
    } else if (clientLRUCache.size >= MAX_CACHE_ENTRIES) {
        const firstKey = clientLRUCache.keys().next().value;
        clientLRUCache.delete(firstKey);
    }
    clientLRUCache.set(key, value);
}

async function request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const isGet = !options.method || options.method === 'GET';
    const category = options.category || null;

    // Abort previous in-flight request in the same category if requested
    if (category) {
        if (activeAbortControllers.has(category)) {
            try {
                activeAbortControllers.get(category).abort();
            } catch (_) {}
        }
        const controller = new AbortController();
        activeAbortControllers.set(category, controller);
        options.signal = controller.signal;
    }

    const cacheKey = isGet ? url : null;
    if (cacheKey && !options.noCache) {
        const cached = getFromCache(cacheKey);
        if (cached) {
            return Promise.resolve(cached);
        }
    }

    const dedupKey = isGet ? url : null;
    if (dedupKey && inFlightRequests.has(dedupKey)) {
        return inFlightRequests.get(dedupKey);
    }

    const p = (async () => {
        try {
            const fetchOptions = { ...options };
            delete fetchOptions.category;
            delete fetchOptions.noCache;

            const res = await fetch(url, fetchOptions);
            if (!res.ok) {
                let errText = '';
                try {
                    errText = await res.text();
                } catch (_) {}
                throw new Error(`API ${res.status}: ${errText || res.statusText}`);
            }
            const data = await res.json();
            if (cacheKey && !options.noCache) {
                setToCache(cacheKey, data);
            }
            return data;
        } catch (err) {
            if (err.name === 'AbortError') {
                return { aborted: true };
            }
            throw err;
        } finally {
            if (dedupKey) {
                inFlightRequests.delete(dedupKey);
            }
            if (category && activeAbortControllers.get(category)?.signal === options.signal) {
                activeAbortControllers.delete(category);
            }
        }
    })();

    if (dedupKey) {
        inFlightRequests.set(dedupKey, p);
    }
    return p;
}

export const ApiClient = {
    getBaseUrl() {
        return API_BASE;
    },

    cancelCategory(category) {
        if (activeAbortControllers.has(category)) {
            try {
                activeAbortControllers.get(category).abort();
            } catch (_) {}
            activeAbortControllers.delete(category);
        }
    },

    clearCache() {
        clientLRUCache.clear();
        inFlightRequests.clear();
    },

    async get(endpoint, params = {}, options = {}) {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
            if (v != null) q.set(k, String(v));
        }
        const qs = q.toString();
        return request(qs ? `${endpoint}?${qs}` : endpoint, { ...options, method: 'GET' });
    },

    async post(endpoint, data = {}, options = {}) {
        return request(endpoint, {
            ...options,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            body: JSON.stringify(data)
        });
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

    async getDataTimeline({ variable, bbox = null, depth = null, start = null, end = null }) {
        const q = new URLSearchParams({ variable });
        if (bbox) {
            q.set('min_lon', String(bbox.min_lon));
            q.set('max_lon', String(bbox.max_lon));
            q.set('min_lat', String(bbox.min_lat));
            q.set('max_lat', String(bbox.max_lat));
        }
        if (depth != null) q.set('depth', String(depth));
        if (start) q.set('start', String(start));
        if (end) q.set('end', String(end));
        return request(`/api/data/timeline?${q}`, { category: 'timeline_meta' });
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
        return request(`/api/data/region?${q}`, { category: 'region' });
    },

    async checkOceanCache({ provider = 'auto', bbox, depth = null, time = null, start_time = null, end_time = null }) {
        const q = new URLSearchParams({
            provider,
            min_lon: String(bbox.min_lon),
            max_lon: String(bbox.max_lon),
            min_lat: String(bbox.min_lat),
            max_lat: String(bbox.max_lat)
        });
        if (depth != null) q.set('depth', String(depth));
        if (time) q.set('time', time);
        if (start_time) q.set('start_time', start_time);
        if (end_time) q.set('end_time', end_time);
        return request(`/api/data/ocean/check?${q}`);
    },

    async getOceanBundle({ provider = 'auto', bbox, depth = null, time = null, start_time = null, end_time = null, stride = 1, options = {} }) {
        const q = new URLSearchParams({
            provider,
            min_lon: String(bbox.min_lon),
            max_lon: String(bbox.max_lon),
            min_lat: String(bbox.min_lat),
            max_lat: String(bbox.max_lat),
            stride: String(stride)
        });
        if (depth != null) q.set('depth', String(depth));
        if (time) q.set('time', time);
        if (start_time) q.set('start_time', start_time);
        if (end_time) q.set('end_time', end_time);
        return request(`/api/data/ocean/bundle?${q}`, { category: 'bundle', ...options });
    },

    async getOceanVariable({ provider = 'auto', variable, bbox, depth = null, time = null, stride = 1, resolution = 'native', options = {} }) {
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
        return request(`/api/data/ocean?${q}`, { category: 'variable', ...options });
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
        return request(`/api/ocean/point?${q}`, { category: 'point_inspect' });
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
    },

    // =========================================================================
    // ML Hazard & Anomaly Endpoints
    // =========================================================================

    async getMLAnomalies(bbox, time = null, depth = null) {
        const q = new URLSearchParams({
            min_lon: String(bbox.min_lon),
            max_lon: String(bbox.max_lon),
            min_lat: String(bbox.min_lat),
            max_lat: String(bbox.max_lat)
        });
        if (time) q.set('time', time);
        if (depth != null) q.set('depth', String(depth));
        return request(`/api/ml/anomalies?${q}`);
    },

    async getMLPoint(lat, lon, time = null, depth = null) {
        const q = new URLSearchParams({
            latitude: String(lat),
            longitude: String(lon)
        });
        if (time) q.set('time', time);
        if (depth != null) q.set('depth', String(depth));
        return request(`/api/ml/point?${q}`);
    },

    // =========================================================================
    // Data Download & Storage Inventory Endpoints
    // =========================================================================

    async getDownloadInventory(refresh = false) {
        const q = refresh ? '?refresh=true' : '';
        return request(`/api/download/inventory${q}`);
    },

    async checkDownloadStatus(payload) {
        return request('/api/download/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    },

    async executeDownload(payload) {
        return request('/api/download/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    },

    // =========================================================================
    // Stage 2 Ocean Slicing Endpoints
    // =========================================================================

    async getOceanDepths(variable = 'temperature') {
        const q = new URLSearchParams({ variable });
        return request(`/api/ocean/depths?${q}`);
    },

    async getOceanSlice({ variable = 'temperature', depth = 0, time = null, bbox = null, stride = 1 } = {}) {
        const q = new URLSearchParams({
            variable,
            depth: String(depth),
            stride: String(stride)
        });
        if (time) q.set('time', time);
        if (bbox) {
            q.set('min_lat', String(bbox.min_lat));
            q.set('max_lat', String(bbox.max_lat));
            q.set('min_lon', String(bbox.min_lon));
            q.set('max_lon', String(bbox.max_lon));
        }
        return request(`/api/ocean/slice?${q}`);
    },

    async getOceanVerticalSlice({ variable = 'temperature', time = null, startLat = null, startLon = null, endLat = null, endLon = null, latitude = null, longitude = null, numPoints = 100 } = {}) {
        const q = new URLSearchParams({
            variable,
            num_points: String(numPoints)
        });
        if (time) q.set('time', time);
        if (startLat != null) q.set('start_lat', String(startLat));
        if (startLon != null) q.set('start_lon', String(startLon));
        if (endLat != null) q.set('end_lat', String(endLat));
        if (endLon != null) q.set('end_lon', String(endLon));
        if (latitude != null) q.set('latitude', String(latitude));
        if (longitude != null) q.set('longitude', String(longitude));
        return request(`/api/ocean/vertical-slice?${q}`);
    },

    // =========================================================================
    // Stage 3 In-Situ Argo Float Endpoints
    // =========================================================================

    async getArgoObservations(bbox = null) {
        const q = new URLSearchParams();
        if (bbox) {
            q.set('min_lat', String(bbox.min_lat));
            q.set('max_lat', String(bbox.max_lat));
            q.set('min_lon', String(bbox.min_lon));
            q.set('max_lon', String(bbox.max_lon));
        }
        const qs = q.toString();
        return request(`/api/observations/argo${qs ? `?${qs}` : ''}`);
    },

    async getArgoFloat(floatId) {
        return request(`/api/observations/argo/${encodeURIComponent(floatId)}`);
    },

    // =========================================================================
    // Stage 4: Oceanographic Analysis Engine (Model vs Argo, Coverage, Gaps)
    // =========================================================================

    async getModelVsArgo(params = {}) {
        const q = new URLSearchParams();
        if (params.min_lat != null) q.set('min_lat', String(params.min_lat));
        if (params.max_lat != null) q.set('max_lat', String(params.max_lat));
        if (params.min_lon != null) q.set('min_lon', String(params.min_lon));
        if (params.max_lon != null) q.set('max_lon', String(params.max_lon));
        if (params.variable) q.set('variable', params.variable);
        if (params.time) q.set('time', params.time);
        const qs = q.toString();
        return request(`/api/analysis/model-vs-argo${qs ? `?${qs}` : ''}`);
    },

    async getFloatComparison(floatId, variable = 'temperature', time = null) {
        const q = new URLSearchParams({ variable });
        if (time) q.set('time', time);
        return request(`/api/analysis/model-vs-argo/${encodeURIComponent(floatId)}?${q.toString()}`);
    },

    async getObservationCoverage(params = {}) {
        const q = new URLSearchParams();
        if (params.min_lat != null) q.set('min_lat', String(params.min_lat));
        if (params.max_lat != null) q.set('max_lat', String(params.max_lat));
        if (params.min_lon != null) q.set('min_lon', String(params.min_lon));
        if (params.max_lon != null) q.set('max_lon', String(params.max_lon));
        if (params.grid_res_deg != null) q.set('grid_res_deg', String(params.grid_res_deg));
        if (params.thresh_high != null) q.set('thresh_high', String(params.thresh_high));
        if (params.thresh_med != null) q.set('thresh_med', String(params.thresh_med));
        if (params.thresh_low != null) q.set('thresh_low', String(params.thresh_low));
        const qs = q.toString();
        return request(`/api/analysis/coverage${qs ? `?${qs}` : ''}`);
    },

    async getDataGaps(params = {}) {
        const q = new URLSearchParams();
        if (params.min_lat != null) q.set('min_lat', String(params.min_lat));
        if (params.max_lat != null) q.set('max_lat', String(params.max_lat));
        if (params.min_lon != null) q.set('min_lon', String(params.min_lon));
        if (params.max_lon != null) q.set('max_lon', String(params.max_lon));
        if (params.grid_res_deg != null) q.set('grid_res_deg', String(params.grid_res_deg));
        if (params.thresh_high != null) q.set('thresh_high', String(params.thresh_high));
        if (params.thresh_med != null) q.set('thresh_med', String(params.thresh_med));
        if (params.thresh_low != null) q.set('thresh_low', String(params.thresh_low));
        const qs = q.toString();
        return request(`/api/analysis/gaps${qs ? `?${qs}` : ''}`);
    },

    async getAnalysisSummary(params = {}) {
        const q = new URLSearchParams();
        if (params.min_lat != null) q.set('min_lat', String(params.min_lat));
        if (params.max_lat != null) q.set('max_lat', String(params.max_lat));
        if (params.min_lon != null) q.set('min_lon', String(params.min_lon));
        if (params.max_lon != null) q.set('max_lon', String(params.max_lon));
        if (params.variable) q.set('variable', params.variable);
        const qs = q.toString();
        return request(`/api/analysis/summary${qs ? `?${qs}` : ''}`);
    }
};


