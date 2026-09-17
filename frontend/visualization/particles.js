// SolvX Viewer — Animated Current Flow Particle System
import * as THREE from 'three';
import { sampleColor } from './colorScale.js';

export class CurrentParticles {
    constructor(currentGrid, bounds, options = {}) {
        this.currentGrid = currentGrid;
        this.bounds = bounds || [84.1, 93.0, 16.0, 23.5];
        this.count = options.count || 2000;

        this.group = new THREE.Group();
        this.particleMesh = null;
        this.particles = [];

        this.init();
    }

    init() {
        if (!this.currentGrid || !this.currentGrid.u || !this.currentGrid.v) return;

        const lat = this.currentGrid.latitude || [];
        const lon = this.currentGrid.longitude || [];

        const midLat = (this.bounds[2] + this.bounds[3]) / 2;
        const midLon = (this.bounds[0] + this.bounds[1]) / 2;
        const klat = 111.32;
        const klon = 111.32 * Math.cos((midLat * Math.PI) / 180);

        const minX = (this.bounds[2] - midLat) * klat; // Note: In scene, X is Lat? Wait, earlier I discovered X=Lon, Z=Lat? Let's check water.js!
        // In water.js: posX = lat, posZ = lon.
        const minZ = (this.bounds[0] - midLon) * klon;
        const maxZ = (this.bounds[1] - midLon) * klon;
        const minX_lat = (this.bounds[2] - midLat) * klat;
        const maxX_lat = (this.bounds[3] - midLat) * klat;

        this.boundsKm = { minX: minX_lat, maxX: maxX_lat, minZ, maxZ };
        this.geoBase = { midLat, midLon, klat, klon };

        const positions = new Float32Array(this.count * 3);
        const colors = new Float32Array(this.count * 3);

        for (let i = 0; i < this.count; i++) {
            const rx = minX_lat + Math.random() * (maxX_lat - minX_lat);
            const rz = minZ + Math.random() * (maxZ - minZ);
            const ry = 0.5 + Math.random() * 0.8;

            positions[i * 3] = rx;
            positions[i * 3 + 1] = ry;
            positions[i * 3 + 2] = rz;

            colors[i * 3] = 0.8;
            colors[i * 3 + 1] = 0.9;
            colors[i * 3 + 2] = 1.0;

            this.particles.push({
                x: rx,
                y: ry,
                z: rz,
                life: Math.random() * 100
            });
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const mat = new THREE.PointsMaterial({
            size: 2.8,
            vertexColors: true,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending
        });

        this.particleMesh = new THREE.Points(geom, mat);
        this.group.add(this.particleMesh);
    }

    _sampleVelocity(posX, posZ) {
        // Convert scene coordinates back to lat/lon
        const lat = this.geoBase.midLat + posX / this.geoBase.klat;
        const lon = this.geoBase.midLon + posZ / this.geoBase.klon;

        const lats = this.currentGrid.latitude;
        const lons = this.currentGrid.longitude;
        const uGrid = this.currentGrid.u;
        const vGrid = this.currentGrid.v;

        // Find nearest indices
        let minLatDiff = Infinity, latIdx = 0;
        for (let i = 0; i < lats.length; i++) {
            const d = Math.abs(lats[i] - lat);
            if (d < minLatDiff) { minLatDiff = d; latIdx = i; }
        }

        let minLonDiff = Infinity, lonIdx = 0;
        for (let i = 0; i < lons.length; i++) {
            const d = Math.abs(lons[i] - lon);
            if (d < minLonDiff) { minLonDiff = d; lonIdx = i; }
        }

        // Return sampled velocity (u = east/west, v = north/south)
        // Note: u grid might be 3D [depth][lat][lon] or 2D [lat][lon]
        let uVal = 0;
        let vVal = 0;
        
        if (Array.isArray(uGrid[0]) && Array.isArray(uGrid[0][0])) {
            uVal = uGrid[0][latIdx][lonIdx];
            vVal = vGrid[0][latIdx][lonIdx];
        } else {
            uVal = uGrid[latIdx][lonIdx];
            vVal = vGrid[latIdx][lonIdx];
        }

        return { u: uVal || 0, v: vVal || 0 };
    }

    update(delta = 0.016) {
        if (!this.particleMesh || !this.currentGrid) return;

        const pos = this.particleMesh.geometry.attributes.position;
        const b = this.boundsKm;

        for (let i = 0; i < this.count; i++) {
            const p = this.particles[i];
            
            // Sample velocity
            const vel = this._sampleVelocity(p.x, p.z);
            
            // U is eastward (Longitude/Z axis)
            // V is northward (Latitude/X axis)
            // Scale velocity to scene units and apply time delta
            const speedScale = 15.0; 
            p.z += vel.u * speedScale * delta;
            p.x += vel.v * speedScale * delta;
            
            p.life += 1;

            if (p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ || p.life > 200 || (vel.u === 0 && vel.v === 0)) {
                p.x = b.minX + Math.random() * (b.maxX - b.minX);
                p.z = b.minZ + Math.random() * (b.maxZ - b.minZ);
                p.life = 0;
            }

            pos.setXYZ(i, p.x, p.y, p.z);
        }

        pos.needsUpdate = true;
    }
}
