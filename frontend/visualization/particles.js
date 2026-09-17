// SolvX Viewer — Animated Current Flow Particle System
import * as THREE from 'three';
import { sampleColor } from './colorScale.js';

export class CurrentParticles {
    constructor(currentGrid, bounds, options = {}) {
        this.currentGrid = currentGrid;
        this.bounds = bounds || [84.1, 93.0, 16.0, 23.5];
        this.count = options.count || 800;

        this.group = new THREE.Group();
        this.particleMesh = null;
        this.particles = [];

        this.init();
    }

    init() {
        if (!this.currentGrid || !this.currentGrid.u || !this.currentGrid.v) return;

        const lat = this.currentGrid.latitude || [];
        const lon = this.currentGrid.longitude || [];
        const u = this.currentGrid.u || [];
        const v = this.currentGrid.v || [];

        const midLat = (this.bounds[2] + this.bounds[3]) / 2;
        const midLon = (this.bounds[0] + this.bounds[1]) / 2;
        const klat = 111.32;
        const klon = 111.32 * Math.cos((midLat * Math.PI) / 180);

        const project = (lng, lt) => [
            (Number(lng) - midLon) * klon,
            (Number(lt) - midLat) * klat
        ];

        const minX = (this.bounds[2] - midLat) * klat;
        const maxX = (this.bounds[3] - midLat) * klat;
        const minZ = (this.bounds[0] - midLon) * klon;
        const maxZ = (this.bounds[1] - midLon) * klon;

        this.boundsKm = { minX, maxX, minZ, maxZ };

        const positions = new Float32Array(this.count * 3);
        const colors = new Float32Array(this.count * 3);

        for (let i = 0; i < this.count; i++) {
            const rx = minX + Math.random() * (maxX - minX);
            const rz = minZ + Math.random() * (maxZ - minZ);
            const ry = 0.5 + Math.random() * 0.8;

            positions[i * 3] = rx;
            positions[i * 3 + 1] = ry;
            positions[i * 3 + 2] = rz;

            colors[i * 3] = 0.2;
            colors[i * 3 + 1] = 0.8;
            colors[i * 3 + 2] = 1.0;

            this.particles.push({
                x: rx,
                y: ry,
                z: rz,
                vx: 0.1,
                vz: 0.1,
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

    update(delta = 0.016) {
        if (!this.particleMesh || !this.currentGrid) return;

        const pos = this.particleMesh.geometry.attributes.position;
        const b = this.boundsKm;

        for (let i = 0; i < this.count; i++) {
            const p = this.particles[i];
            p.x += p.vx * 3.5;
            p.z += p.vz * 3.5;
            p.life += 1;

            if (p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ || p.life > 180) {
                p.x = b.minX + Math.random() * (b.maxX - b.minX);
                p.z = b.minZ + Math.random() * (b.maxZ - b.minZ);
                p.life = 0;
            }

            pos.setXYZ(i, p.x, p.y, p.z);
        }

        pos.needsUpdate = true;
    }
}
