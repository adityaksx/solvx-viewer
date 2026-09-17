// SolvX Viewer — Dynamic Ocean Water Surface & Volume Column
import * as THREE from 'three';

export class DynamicWater {
    constructor(bathymetry, sceneManager, options = {}) {
        this.bathymetry = bathymetry;
        this.sceneManager = sceneManager;
        this.bounds = bathymetry.bounds || [84.1, 93.0, 16.0, 23.5];

        this.temperature = options.temperature || 28.0;
        this.waveHeight = options.waveHeight || 1.2;
        this.opacity = options.opacity || 0.28;

        this.group = new THREE.Group();
        this.surfaceMesh = null;
        this.instancedVolume = null;
        this.cells = [];

        this.buildVolume();
        this.buildSurface();
    }

    buildVolume() {
        const t = this.bathymetry.terrain;
        if (!t || !t.x || !t.y) return;

        const nx = t.x.length;
        const ny = t.y.length;
        const raw = t.rawDepthKm;
        const step = Math.max(1, Math.ceil(Math.sqrt((nx * ny) / 18000)));

        const midLat = (this.bounds[2] + this.bounds[3]) / 2;
        const midLon = (this.bounds[0] + this.bounds[1]) / 2;
        const klon = 111.32 * Math.cos((midLat * Math.PI) / 180);

        this.cells = [];

        for (let j = 0; j < ny - 1; j += step) {
            for (let i = 0; i < nx - 1; i += step) {
                const i2 = Math.min(nx - 1, i + step);
                const j2 = Math.min(ny - 1, j + step);

                const d00 = Number((raw[j] || [])[i]);
                const d10 = Number((raw[j] || [])[i2]);
                const d01 = Number((raw[j2] || [])[i]);
                const d11 = Number((raw[j2] || [])[i2]);

                const depths = [d00, d10, d01, d11].filter(v => v != null && !isNaN(v) && v > 0.005);
                if (depths.length < 4) continue;

                const minD = Math.min(...depths);
                const h = Math.abs(this.sceneManager.depthY(minD * 1000));
                if (h < 0.08) continue;

                const posX = (t.y[j] + t.y[j2]) / 2;
                const posZ = (t.x[i] + t.x[i2]) / 2;

                // Derive exact geographic coordinates
                const lat = midLat + posX / 111.32;
                const lon = midLon + posZ / (klon || 1.0);

                this.cells.push({
                    x: posX,
                    z: posZ,
                    sx: Math.max(0.25, Math.abs(t.y[j2] - t.y[j]) * 0.995),
                    sz: Math.max(0.25, Math.abs(t.x[i2] - t.x[i]) * 0.995),
                    h: h,
                    depthM: minD * 1000,
                    lat: lat,
                    lon: lon
                });
            }
        }

        if (!this.cells.length) return;

        const boxGeom = new THREE.BoxGeometry(1, 1, 1);
        const boxMat = new THREE.MeshBasicMaterial({
            color: 0x249ed0,
            transparent: true,
            opacity: this.opacity,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        this.instancedVolume = new THREE.InstancedMesh(boxGeom, boxMat, this.cells.length);
        const dummy = new THREE.Object3D();

        for (let k = 0; k < this.cells.length; k++) {
            const c = this.cells[k];
            dummy.position.set(c.x, -c.h / 2, c.z);
            dummy.scale.set(c.sx, c.h, c.sz);
            dummy.updateMatrix();
            this.instancedVolume.setMatrixAt(k, dummy.matrix);
        }

        this.instancedVolume.instanceMatrix.needsUpdate = true;
        this.instancedVolume.userData = { isWater: true, cells: this.cells };
        this.group.add(this.instancedVolume);
    }

    buildSurface() {
        const t = this.bathymetry.terrain;
        if (!t || !t.x || !t.y) return;

        const widthX = Math.abs(t.y[t.y.length - 1] - t.y[0]) || 500;
        const widthZ = Math.abs(t.x[t.x.length - 1] - t.x[0]) || 500;
        const centerX = (t.y[0] + t.y[t.y.length - 1]) / 2;
        const centerZ = (t.x[0] + t.x[t.x.length - 1]) / 2;

        const geom = new THREE.PlaneGeometry(widthX, widthZ, 48, 48);
        geom.rotateX(-Math.PI / 2);

        // Responsive ocean color based on temperature
        const baseColor = this.temperature > 26 ? 0x1892c9 : 0x0c659e;

        const mat = new THREE.MeshStandardMaterial({
            color: baseColor,
            roughness: 0.15,
            metalness: 0.85,
            transparent: true,
            opacity: 0.42,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        this.surfaceMesh = new THREE.Mesh(geom, mat);
        this.surfaceMesh.position.set(centerX, 0.05, centerZ);
        this.group.add(this.surfaceMesh);
    }

    update(timeMs) {
        if (!this.surfaceMesh) return;
        const sec = timeMs * 0.001;
        const pos = this.surfaceMesh.geometry.attributes.position;
        const count = pos.count;

        for (let i = 0; i < count; i++) {
            const u = pos.getX(i);
            const v = pos.getZ(i);
            const wave = (
                Math.sin(u * 0.02 + sec * 1.5) * 0.35 +
                Math.cos(v * 0.025 + sec * 1.2) * 0.25
            ) * (this.waveHeight * 0.5);
            pos.setY(i, wave);
        }
        pos.needsUpdate = true;
    }

    setOpacity(opacity) {
        this.opacity = opacity;
        if (this.instancedVolume?.material) {
            this.instancedVolume.material.opacity = opacity;
        }
    }

    setTemperature(temp) {
        this.temperature = temp;
        if (this.surfaceMesh?.material) {
            const hex = temp > 27 ? 0x1da5d8 : temp > 22 ? 0x1482b8 : 0x095286;
            this.surfaceMesh.material.color.setHex(hex);
        }
    }

    recolorCells(colorFunc) {
        if (!this.instancedVolume) return;
        for (let i = 0; i < this.cells.length; i++) {
            const col = colorFunc(this.cells[i]);
            if (col) {
                this.instancedVolume.setColorAt(i, col);
            }
        }
        if (this.instancedVolume.instanceColor) {
            this.instancedVolume.instanceColor.needsUpdate = true;
        }
    }
}
