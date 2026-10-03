/**
 * Single Source of Truth for Geographic <-> Three.js World Transformations.
 * Follows Sections 2, 3, 4, 5, 6, 7, 8 of the implementation plan.
 *
 * Coordinate Convention:
 * - X = Longitude (East-West axis)
 * - Y = Physical Depth (Surface is Y = 0, Depth increases downward as Y < 0)
 * - Z = Latitude (South-North axis)
 */

export class GeographicTransform {
    /**
     * Creates a shared geographic configuration from dataset/domain bounds.
     */
    static createGeoConfig(bounds, options = {}) {
        const lonMin = bounds.lon_min !== undefined ? bounds.lon_min : bounds[0];
        const lonMax = bounds.lon_max !== undefined ? bounds.lon_max : bounds[1];
        const latMin = bounds.lat_min !== undefined ? bounds.lat_min : bounds[2];
        const latMax = bounds.lat_max !== undefined ? bounds.lat_max : bounds[3];
        const depthMin = bounds.depth_min !== undefined ? bounds.depth_min : 0;
        const depthMax = bounds.depth_max !== undefined ? bounds.depth_max : 1000;

        const centerLon = (lonMin + lonMax) / 2.0;
        const centerLat = (latMin + latMax) / 2.0;

        // Physical km scales
        const klon = 111.32 * Math.cos((centerLat * Math.PI) / 180.0);
        const klat = 111.32;

        const worldWidth = options.worldWidth || (lonMax - lonMin) * klon;   // X extent (km)
        const worldLength = options.worldLength || (latMax - latMin) * klat; // Z extent (km)
        const verticalExaggeration = options.verticalExaggeration || 70.0;

        // World Height (Y extent in world units)
        const maxDepthKm = depthMax / 1000.0;
        const minDepthKm = depthMin / 1000.0;
        const worldHeight = (maxDepthKm - minDepthKm) * verticalExaggeration;

        return {
            lonMin,
            lonMax,
            latMin,
            latMax,
            depthMin,
            depthMax,
            centerLon,
            centerLat,
            klon,
            klat,
            worldWidth,
            worldLength,
            worldHeight,
            verticalExaggeration,
        };
    }

    /**
     * Converts Longitude to World X coordinate.
     * X in [-worldWidth/2, +worldWidth/2].
     */
    static lonToWorldX(lon, config) {
        const normX = (lon - config.lonMin) / Math.max(config.lonMax - config.lonMin, 1e-6);
        return (normX - 0.5) * config.worldWidth;
    }

    /**
     * Converts Latitude to World Z coordinate.
     * Z in [-worldLength/2, +worldLength/2].
     */
    static latToWorldZ(lat, config) {
        const normZ = (lat - config.latMin) / Math.max(config.latMax - config.latMin, 1e-6);
        return (normZ - 0.5) * config.worldLength;
    }

    /**
     * Converts Physical Depth (meters) to World Y coordinate.
     * Surface is Y = 0, depth increases downward (negative Y).
     */
    static depthToWorldY(depthMeters, config) {
        const depthKm = Math.max(0, depthMeters) / 1000.0;
        return -depthKm * config.verticalExaggeration;
    }

    /**
     * Full Geographic (lon, lat, depthMeters) to Three.js World (x, y, z) conversion.
     */
    static geoToWorld(lon, lat, depthMeters, config) {
        return {
            x: this.lonToWorldX(lon, config),
            y: this.depthToWorldY(depthMeters, config),
            z: this.latToWorldZ(lat, config),
        };
    }

    /**
     * Converts Three.js World (x, y, z) back to Physical Geographic (lon, lat, depthMeters).
     */
    static worldToGeo(x, y, z, config) {
        const normX = x / config.worldWidth + 0.5;
        const normZ = z / config.worldLength + 0.5;

        const lon = config.lonMin + normX * (config.lonMax - config.lonMin);
        const lat = config.latMin + normZ * (config.latMax - config.latMin);
        const depthMeters = Math.max(0, (-y / config.verticalExaggeration) * 1000.0);

        return {
            lon: Number(lon.toFixed(4)),
            lat: Number(lat.toFixed(4)),
            depth: Number(depthMeters.toFixed(1)),
        };
    }
}
