// SolvX Viewer — Physics-Driven Animated Ocean Current Flow Particle System
// Particles move in the actual calculated current direction: atan2(v, u), with speed = sqrt(u^2 + v^2)
import * as THREE from 'three';

export class CurrentParticles {
    constructor(currentGrid, bounds, options = {}) {
        this.currentGrid = currentGrid;
        this.bounds = bounds || [84.1, 93.0, 16.0, 23.5];
        this.count = options.count || 1800;
        this.flowSpeed = options.flowSpeed !== undefined ? options.flowSpeed : 1.0;
        this.vectorScale = options.vectorScale !== undefined ? options.vectorScale : 1.0;
        this.isPaused = Boolean(options.paused);
        this.animationEnabled = options.animated !== false;
        this.depthY = options.depthY !== undefined ? options.depthY : 0.6;

        this.group = new THREE.Group();
        this.particleMesh = null;
        this.trailMesh = null;
        this.particleData = null; // Float32Array: [x, y, z, life, speed, dir]
        this.simAccumulator = 0;

        // Reusable return struct to avoid per-frame allocations
        this._sampledVelocity = { u: 0, v: 0, speed: 0, dir: 0 };

        this.init();
    }

    init() {
        if (!this.currentGrid || !this.currentGrid.u || !this.currentGrid.v) return;

        const lats = this.currentGrid.latitude || this.currentGrid.lat || [];
        const lons = this.currentGrid.longitude || this.currentGrid.lon || [];
        if (!lats.length || !lons.length) return;

        this.latCount = lats.length;
        this.lonCount = lons.length;
        this.latMin = Number(lats[0]);
        this.latMax = Number(lats[lats.length - 1]);
        this.latStep = (this.latMax - this.latMin) / Math.max(1, this.latCount - 1);

        this.lonMin = Number(lons[0]);
        this.lonMax = Number(lons[lons.length - 1]);
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

        // 6 floats per particle: [x, y, z, life, speed, dir]
        this.particleData = new Float32Array(this.count * 6);
        const pointPositions = new Float32Array(this.count * 3);
        const pointColors = new Float32Array(this.count * 3);
        const trailPositions = new Float32Array(this.count * 6); // 2 vertices (start, end) per trail
        const trailColors = new Float32Array(this.count * 6);

        const b = this.boundsKm;
        const dX = b.maxX - b.minX;
        const dZ = b.maxZ - b.minZ;

        for (let i = 0; i < this.count; i++) {
            const rx = b.minX + Math.random() * dX;
            const rz = b.minZ + Math.random() * dZ;
            const ry = this.depthY;
            const life = Math.random() * 120;

            const vel = this._sampleVelocity(rx, rz);
            const pIdx = i * 6;
            this.particleData[pIdx] = rx;
            this.particleData[pIdx + 1] = ry;
            this.particleData[pIdx + 2] = rz;
            this.particleData[pIdx + 3] = life;
            this.particleData[pIdx + 4] = vel.speed;
            this.particleData[pIdx + 5] = vel.dir;

            const posIdx = i * 3;
            pointPositions[posIdx] = rx;
            pointPositions[posIdx + 1] = ry;
            pointPositions[posIdx + 2] = rz;

            // Vivid speed-based color
            const col = this._getFlowColor(vel.speed);
            pointColors[posIdx] = col.r;
            pointColors[posIdx + 1] = col.g;
            pointColors[posIdx + 2] = col.b;

            // Initial trail
            const trailIdx = i * 6;
            trailPositions[trailIdx] = rx;
            trailPositions[trailIdx + 1] = ry;
            trailPositions[trailIdx + 2] = rz;
            trailPositions[trailIdx + 3] = rx - vel.v * 3.0;
            trailPositions[trailIdx + 4] = ry;
            trailPositions[trailIdx + 5] = rz - vel.u * 3.0;

            trailColors[trailIdx] = col.r;
            trailColors[trailIdx + 1] = col.g;
            trailColors[trailIdx + 2] = col.b;
            trailColors[trailIdx + 3] = col.r * 0.2;
            trailColors[trailIdx + 4] = col.g * 0.2;
            trailColors[trailIdx + 5] = col.b * 0.2;
        }

        // 1. Particle Head Points
        const ptGeom = new THREE.BufferGeometry();
        ptGeom.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3));
        ptGeom.setAttribute('color', new THREE.BufferAttribute(pointColors, 3));

        const ptMat = new THREE.PointsMaterial({
            size: 3.2,
            vertexColors: true,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.particleMesh = new THREE.Points(ptGeom, ptMat);
        this.group.add(this.particleMesh);

        // 2. Animated Flow Trails (Streamlets)
        const trailGeom = new THREE.BufferGeometry();
        trailGeom.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
        trailGeom.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));

        const trailMat = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.75,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.trailMesh = new THREE.LineSegments(trailGeom, trailMat);
        this.group.add(this.trailMesh);
    }

    _getFlowColor(speed) {
        // Cyan-blue (slow) -> bright turquoise -> electric yellow/amber (fast)
        const norm = Math.min(1.0, Math.max(0.0, speed / 0.8));
        if (norm < 0.3) {
            return { r: 0.1, g: 0.6 + norm, b: 0.95 };
        } else if (norm < 0.7) {
            const t = (norm - 0.3) / 0.4;
            return { r: 0.1 + 0.8 * t, g: 0.9, b: 0.95 - 0.5 * t };
        } else {
            const t = (norm - 0.7) / 0.3;
            return { r: 0.95 + 0.05 * t, g: 0.9 - 0.2 * t, b: 0.45 - 0.3 * t };
        }
    }

    _sampleVelocity(posX, posZ) {
        // Convert scene coordinates back to lat/lon in O(1)
        const lat = this.geoBase.midLat + posX / this.geoBase.klat;
        const lon = this.geoBase.midLon + posZ / this.geoBase.klon;

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

        const u = (rowU && rowU[lonIdx] != null && isFinite(rowU[lonIdx])) ? Number(rowU[lonIdx]) : 0;
        const v = (rowV && rowV[lonIdx] != null && isFinite(rowV[lonIdx])) ? Number(rowV[lonIdx]) : 0;

        // Exact physics calculations
        const speed = Math.hypot(u, v);
        const dir = Math.atan2(v, u);

        this._sampledVelocity.u = u;
        this._sampledVelocity.v = v;
        this._sampledVelocity.speed = speed;
        this._sampledVelocity.dir = dir;
        return this._sampledVelocity;
    }

    update(delta = 0.016) {
        if (!this.animationEnabled || this.isPaused) return;
        if (!this.particleMesh || !this.trailMesh || !this.particleData) return;

        const clampedDelta = Math.min(delta, 0.1);
        this.simAccumulator += clampedDelta;

        // Target simulation rate ~35 Hz
        const simStep = 0.028;
        if (this.simAccumulator < simStep) {
            return;
        }

        const stepDelta = this.simAccumulator;
        this.simAccumulator = 0;

        const ptPosAttr = this.particleMesh.geometry.attributes.position;
        const ptColAttr = this.particleMesh.geometry.attributes.color;
        const ptPosArray = ptPosAttr.array;
        const ptColArray = ptColAttr.array;

        const trailPosAttr = this.trailMesh.geometry.attributes.position;
        const trailColAttr = this.trailMesh.geometry.attributes.color;
        const trailPosArray = trailPosAttr.array;
        const trailColArray = trailColAttr.array;

        const b = this.boundsKm;
        const pData = this.particleData;
        const baseSpeedScale = 18.0 * this.flowSpeed;

        const bMinX = b.minX;
        const bMaxX = b.maxX;
        const bMinZ = b.minZ;
        const bMaxZ = b.maxZ;
        const dX = bMaxX - bMinX;
        const dZ = bMaxZ - bMinZ;

        for (let i = 0; i < this.count; i++) {
            const pIdx = i * 6;
            let px = pData[pIdx];
            const py = this.depthY;
            let pz = pData[pIdx + 2];
            let life = pData[pIdx + 3];

            // Sample velocity in exact direction
            const vel = this._sampleVelocity(px, pz);
            const u = vel.u;
            const v = vel.v;
            const speed = vel.speed;

            // Faster currents produce faster movement, slower currents produce slower movement
            // U is eastward (Z axis in 3D scene), V is northward (X axis in 3D scene)
            pz += u * baseSpeedScale * stepDelta;
            px += v * baseSpeedScale * stepDelta;
            life += 1;

            // Boundary or expiry reset
            const maxLife = 90 + (i % 50);
            if (px < bMinX || px > bMaxX || pz < bMinZ || pz > bMaxZ || life > maxLife || (speed < 0.002)) {
                px = bMinX + Math.random() * dX;
                pz = bMinZ + Math.random() * dZ;
                life = 0;
            }

            pData[pIdx] = px;
            pData[pIdx + 1] = py;
            pData[pIdx + 2] = pz;
            pData[pIdx + 3] = life;
            pData[pIdx + 4] = speed;
            pData[pIdx + 5] = vel.dir;

            // Update Point Head
            const ptIdx = i * 3;
            ptPosArray[ptIdx] = px;
            ptPosArray[ptIdx + 1] = py;
            ptPosArray[ptIdx + 2] = pz;

            const col = this._getFlowColor(speed);
            ptColArray[ptIdx] = col.r;
            ptColArray[ptIdx + 1] = col.g;
            ptColArray[ptIdx + 2] = col.b;

            // Update Trail (Connecting previous point to current point with direction tail)
            const trailIdx = i * 6;
            const trailLen = Math.max(1.5, Math.min(12.0, speed * 20.0 * this.vectorScale));
            const tailX = px - (vel.v / Math.max(0.001, speed)) * trailLen;
            const tailZ = pz - (vel.u / Math.max(0.001, speed)) * trailLen;

            trailPosArray[trailIdx] = px;
            trailPosArray[trailIdx + 1] = py;
            trailPosArray[trailIdx + 2] = pz;
            trailPosArray[trailIdx + 3] = tailX;
            trailPosArray[trailIdx + 4] = py;
            trailPosArray[trailIdx + 5] = tailZ;

            // Fade trail tail
            trailColArray[trailIdx] = col.r;
            trailColArray[trailIdx + 1] = col.g;
            trailColArray[trailIdx + 2] = col.b;
            trailColArray[trailIdx + 3] = col.r * 0.15;
            trailColArray[trailIdx + 4] = col.g * 0.15;
            trailColArray[trailIdx + 5] = col.b * 0.15;
        }

        ptPosAttr.needsUpdate = true;
        ptColAttr.needsUpdate = true;
        trailPosAttr.needsUpdate = true;
        trailColAttr.needsUpdate = true;
    }

    setFlowSpeed(val) {
        this.flowSpeed = Math.max(0.1, Math.min(5.0, Number(val) || 1.0));
    }

    setParticleDensity(count) {
        const newCount = Math.max(200, Math.min(6000, Math.round(Number(count) || 1800)));
        if (newCount === this.count) return;
        this.count = newCount;
        this.dispose();
        this.init();
    }

    setVectorScale(scale) {
        this.vectorScale = Math.max(0.2, Math.min(4.0, Number(scale) || 1.0));
    }

    setPaused(isPaused) {
        this.isPaused = Boolean(isPaused);
    }

    toggleAnimation(enabled) {
        this.animationEnabled = enabled !== undefined ? Boolean(enabled) : !this.animationEnabled;
        this.group.visible = this.animationEnabled;
    }

    setDepthY(y) {
        this.depthY = y;
        if (this.particleData) {
            for (let i = 0; i < this.count; i++) {
                this.particleData[i * 6 + 1] = y;
            }
        }
    }

    updateGrid(currentGrid, bounds = null, depthY = null) {
        this.currentGrid = currentGrid;
        if (bounds) this.bounds = bounds;
        if (depthY != null) this.depthY = depthY;
        this.dispose();
        this.init();
    }

    dispose() {
        if (this.particleMesh) {
            this.particleMesh.geometry.dispose();
            this.particleMesh.material.dispose();
            this.group.remove(this.particleMesh);
            this.particleMesh = null;
        }
        if (this.trailMesh) {
            this.trailMesh.geometry.dispose();
            this.trailMesh.material.dispose();
            this.group.remove(this.trailMesh);
            this.trailMesh = null;
        }
        this.particleData = null;
    }
}
