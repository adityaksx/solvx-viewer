// SolvX Viewer — High-Performance Animated Current Flow Particle System
import * as THREE from 'three';

export class CurrentParticles {
    constructor(currentGrid, bounds, options = {}) {
        this.currentGrid = currentGrid;
        this.bounds = bounds || [84.1, 93.0, 16.0, 23.5];
        this.count = options.count || 2000;

        this.group = new THREE.Group();
        this.particleMesh = null;
        this.particleData = null; // Float32Array: [x, y, z, life]
        this.simAccumulator = 0;

        // Reusable return struct to avoid per-frame allocations
        this._sampledVelocity = { u: 0, v: 0 };

        this.init();
    }

    init() {
        if (!this.currentGrid || !this.currentGrid.u || !this.currentGrid.v) return;

        const lats = this.currentGrid.latitude || [];
        const lons = this.currentGrid.longitude || [];
        if (!lats.length || !lons.length) return;

        this.latCount = lats.length;
        this.lonCount = lons.length;
        this.latMin = lats[0];
        this.latMax = lats[lats.length - 1];
        this.latStep = (this.latMax - this.latMin) / Math.max(1, this.latCount - 1);

        this.lonMin = lons[0];
        this.lonMax = lons[lons.length - 1];
        this.lonStep = (this.lonMax - this.lonMin) / Math.max(1, this.lonCount - 1);

        // Pre-flatten / extract 2D velocity grids
        const rawU = this.currentGrid.u;
        const rawV = this.currentGrid.v;
        const is3D = Array.isArray(rawU[0]) && Array.isArray(rawU[0][0]);
        this.uGrid = is3D ? rawU[0] : rawU;
        this.vGrid = is3D ? rawV[0] : rawV;

        const midLat = (this.bounds[2] + this.bounds[3]) / 2;
        const midLon = (this.bounds[0] + this.bounds[1]) / 2;
        const klat = 111.32;
        const klon = 111.32 * Math.cos((midLat * Math.PI) / 180);

        const minZ = (this.bounds[0] - midLon) * klon;
        const maxZ = (this.bounds[1] - midLon) * klon;
        const minX_lat = (this.bounds[2] - midLat) * klat;
        const maxX_lat = (this.bounds[3] - midLat) * klat;

        this.boundsKm = { minX: minX_lat, maxX: maxX_lat, minZ, maxZ };
        this.geoBase = { midLat, midLon, klat, klon };

        const positions = new Float32Array(this.count * 3);
        const colors = new Float32Array(this.count * 3);
        this.particleData = new Float32Array(this.count * 4); // [x, y, z, life]

        for (let i = 0; i < this.count; i++) {
            const rx = minX_lat + Math.random() * (maxX_lat - minX_lat);
            const rz = minZ + Math.random() * (maxZ - minZ);
            const ry = 0.5 + Math.random() * 0.8;
            const life = Math.random() * 100;

            const pIdx = i * 4;
            this.particleData[pIdx] = rx;
            this.particleData[pIdx + 1] = ry;
            this.particleData[pIdx + 2] = rz;
            this.particleData[pIdx + 3] = life;

            const posIdx = i * 3;
            positions[posIdx] = rx;
            positions[posIdx + 1] = ry;
            positions[posIdx + 2] = rz;

            colors[posIdx] = 0.8;
            colors[posIdx + 1] = 0.9;
            colors[posIdx + 2] = 1.0;
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const mat = new THREE.PointsMaterial({
            size: 2.8,
            vertexColors: true,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.particleMesh = new THREE.Points(geom, mat);
        this.group.add(this.particleMesh);
    }

    _sampleVelocity(posX, posZ) {
        // Convert scene coordinates back to lat/lon in O(1)
        const lat = this.geoBase.midLat + posX / this.geoBase.klat;
        const lon = this.geoBase.midLon + posZ / this.geoBase.klon;

        // O(1) direct grid index calculation
        let latIdx = 0;
        let lonIdx = 0;

        if (this.latStep !== 0) {
            latIdx = Math.round((lat - this.latMin) / this.latStep);
            if (latIdx < 0) latIdx = 0;
            else if (latIdx >= this.latCount) latIdx = this.latCount - 1;
        }

        if (this.lonStep !== 0) {
            lonIdx = Math.round((lon - this.lonMin) / this.lonStep);
            if (lonIdx < 0) lonIdx = 0;
            else if (lonIdx >= this.lonCount) lonIdx = this.lonCount - 1;
        }

        const rowU = this.uGrid[latIdx];
        const rowV = this.vGrid[latIdx];

        this._sampledVelocity.u = (rowU && rowU[lonIdx] != null) ? rowU[lonIdx] : 0;
        this._sampledVelocity.v = (rowV && rowV[lonIdx] != null) ? rowV[lonIdx] : 0;
        return this._sampledVelocity;
    }

    update(delta = 0.016) {
        if (!this.particleMesh || !this.particleData) return;

        // Cap delta to prevent huge jumps during tab-switch
        const clampedDelta = Math.min(delta, 0.1);
        this.simAccumulator += clampedDelta;

        // Run simulation step at ~30 Hz (0.033s)
        const simStep = 0.033;
        if (this.simAccumulator < simStep) {
            return;
        }

        const stepDelta = this.simAccumulator;
        this.simAccumulator = 0;

        const posAttr = this.particleMesh.geometry.attributes.position;
        const posArray = posAttr.array;
        const b = this.boundsKm;
        const pData = this.particleData;
        const speedScale = 15.0;

        const bMinX = b.minX;
        const bMaxX = b.maxX;
        const bMinZ = b.minZ;
        const bMaxZ = b.maxZ;
        const dX = bMaxX - bMinX;
        const dZ = bMaxZ - bMinZ;

        for (let i = 0; i < this.count; i++) {
            const pIdx = i * 4;
            let px = pData[pIdx];
            const py = pData[pIdx + 1];
            let pz = pData[pIdx + 2];
            let life = pData[pIdx + 3];

            // Sample velocity in O(1)
            const vel = this._sampleVelocity(px, pz);
            const u = vel.u;
            const v = vel.v;

            // U is eastward (Z axis), V is northward (X axis)
            pz += u * speedScale * stepDelta;
            px += v * speedScale * stepDelta;
            life += 1;

            if (px < bMinX || px > bMaxX || pz < bMinZ || pz > bMaxZ || life > 200 || (u === 0 && v === 0)) {
                px = bMinX + Math.random() * dX;
                pz = bMinZ + Math.random() * dZ;
                life = 0;
            }

            pData[pIdx] = px;
            pData[pIdx + 2] = pz;
            pData[pIdx + 3] = life;

            const posIdx = i * 3;
            posArray[posIdx] = px;
            posArray[posIdx + 1] = py;
            posArray[posIdx + 2] = pz;
        }

        posAttr.needsUpdate = true;
    }

    dispose() {
        if (this.particleMesh) {
            this.particleMesh.geometry.dispose();
            this.particleMesh.material.dispose();
            this.group.remove(this.particleMesh);
            this.particleMesh = null;
        }
        this.particleData = null;
    }
}
