/**
 * Interactive Mouse Probe for Ocean Volume Inspection.
 * Follows Sections 31 & 32 of the prototype plan.
 */

import * as THREE from 'three';
import { GeographicTransform } from '../scene/geographicTransform.js';

export class OceanProbe {
    constructor(domElement, camera, oceanManager, onProbeResult) {
        this.domElement = domElement;
        this.camera = camera;
        this.oceanManager = oceanManager;
        this.onProbeResult = onProbeResult || (() => {});

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.isDragging = false;
        this.downPosition = { x: 0, y: 0 };

        this.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this));
        this.domElement.addEventListener('pointerup', this.onPointerUp.bind(this));
    }

    onPointerDown(e) {
        this.isDragging = false;
        this.downPosition = { x: e.clientX, y: e.clientY };
    }

    onPointerUp(e) {
        const dx = Math.abs(e.clientX - this.downPosition.x);
        const dy = Math.abs(e.clientY - this.downPosition.y);
        // Only trigger probe if user clicked rather than dragged to orbit
        if (dx > 4 || dy > 4) return;

        this.performProbe(e.clientX, e.clientY);
    }

    performProbe(clientX, clientY) {
        const vol = this.oceanManager.volumeData;
        if (!vol) return;

        const rect = this.domElement.getBoundingClientRect();
        this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const ray = this.raycaster.ray;

        // Bounding box of volume in world space
        const b = vol.worldBounds;
        const box = new THREE.Box3(
            new THREE.Vector3(b.xMin, b.yMin, b.zMin),
            new THREE.Vector3(b.xMax, b.yMax, b.zMax)
        );

        const hitPoint = new THREE.Vector3();
        const hit = ray.intersectBox(box, hitPoint);
        if (!hit) {
            this.onProbeResult(null);
            return;
        }

        // Ray enters at hitPoint. Step along ray slightly into the volume
        const probePoint = hitPoint.clone().addScaledVector(ray.direction, 5.0);

        // Convert world coordinate back to geographic coordinates via canonical GeographicTransform
        const geoConfig = vol.geoConfig || GeographicTransform.createGeoConfig(vol.meta.bounds);
        const geoCoord = GeographicTransform.worldToGeo(probePoint.x, probePoint.y, probePoint.z, geoConfig);
        const lon = geoCoord.lon;
        const lat = geoCoord.lat;
        const depthM = geoCoord.depth;

        // Sample voxel value from CPU buffer
        const [nz, ny, nx] = vol.shape;
        const geo = vol.meta.bounds;

        const lonFrac = Math.max(0, Math.min(1, (lon - geo.lon_min) / Math.max(geo.lon_max - geo.lon_min, 1e-6)));
        const latFrac = Math.max(0, Math.min(1, (lat - geo.lat_min) / Math.max(geo.lat_max - geo.lat_min, 1e-6)));
        const depthFrac = Math.max(0, Math.min(1, (depthM - geo.depth_min) / Math.max(geo.depth_max - geo.depth_min, 1e-6)));

        const xi = Math.round(lonFrac * (nx - 1));
        const yi = Math.round(latFrac * (ny - 1));
        const zi = Math.round(depthFrac * (nz - 1));

        // NetCDF raw buffer index: zi * (ny * nx) + yi * nx + xi
        const rawIdx = zi * (ny * nx) + yi * nx + xi;
        const normalizedVal = vol.rawBuffer ? vol.rawBuffer[rawIdx] : 0.0;

        // Denormalize to physical value
        const pr = vol.meta.physical_range || { min: 0, max: 1 };
        const isMasked = normalizedVal <= 0.01;
        const physVal = isMasked ? null : pr.min + ((normalizedVal - 0.02) / 0.98) * (pr.max - pr.min);

        const datasetName = vol.meta.dataset || this.oceanManager.app?.currentDataset || 'synthetic_ocean.nc';
        const probeData = {
            screenPos: { x: clientX, y: clientY },
            worldPos: probePoint,
            longitude: Number(lon.toFixed(3)),
            latitude: Number(lat.toFixed(3)),
            depthMeters: Number(depthM.toFixed(1)),
            dataset: datasetName,
            variable: vol.meta.variable,
            units: vol.meta.units || '',
            physicalValue: physVal != null ? Number(physVal.toFixed(2)) : null,
            isMasked,
            seabedDepth: null,
            isBelowSeabed: false,
            isLand: false,
            isValid: !isMasked,
            meta: vol.meta,
        };

        // Asynchronously call backend /api/point to verify ground truth & bathymetric depth
        fetch(`/api/point?dataset=${encodeURIComponent(datasetName)}&variable=${encodeURIComponent(vol.meta.variable)}&lat=${lat}&lon=${lon}&depth=${depthM}`)
            .then(res => res.ok ? res.json() : null)
            .then(backendPoint => {
                if (backendPoint) {
                    if (backendPoint.value != null) {
                        probeData.backendGroundTruth = backendPoint.value;
                    }
                    probeData.seabedDepth = backendPoint.seabed_depth;
                    probeData.isBelowSeabed = backendPoint.is_below_seabed;
                    probeData.isLand = backendPoint.is_land;
                    probeData.isValid = backendPoint.is_valid;
                }
                this.onProbeResult(probeData);
            })
            .catch(() => {
                this.onProbeResult(probeData);
            });
    }
}
