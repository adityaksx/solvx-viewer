/**
 * Camera and Viewpoint Manager for SolvX Scene.
 * Follows Section 28 of the prototype plan.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class CameraManager {
    constructor(canvas, camera = null) {
        this.canvas = canvas;
        const width = canvas.clientWidth || window.innerWidth;
        const height = canvas.clientHeight || window.innerHeight;

        this.camera = camera || new THREE.PerspectiveCamera(45, width / height, 0.5, 20000);
        this.camera.position.set(0, 450, 750);

        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.screenSpacePanning = true;
        this.controls.minDistance = 10;
        this.controls.maxDistance = 15000;
        this.controls.target.set(0, -50, 0);

        this.defaultTarget = new THREE.Vector3(0, -50, 0);
        this.defaultPosition = new THREE.Vector3(0, 450, 750);
    }

    onResize() {
        const width = this.canvas.clientWidth || window.innerWidth;
        const height = this.canvas.clientHeight || window.innerHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }

    update() {
        this.controls.update();
    }

    setView(viewName) {
        const target = this.controls.target;
        switch (viewName) {
            case 'top':
                // Straight down view: Longitude (X) x Latitude (Z)
                this.camera.position.set(target.x, target.y + 900, target.z + 0.001);
                this.camera.up.set(0, 0, -1);
                break;
            case 'side':
                // Side view: Latitude (Z) x Depth (Y)
                this.camera.position.set(target.x + 950, target.y, target.z);
                this.camera.up.set(0, 1, 0);
                break;
            case 'front':
                // Front view: Longitude (X) x Depth (Y)
                this.camera.position.set(target.x, target.y, target.z + 950);
                this.camera.up.set(0, 1, 0);
                break;
            case '3d':
            case 'reset':
            default:
                this.camera.position.copy(this.defaultPosition);
                this.controls.target.copy(this.defaultTarget);
                this.camera.up.set(0, 1, 0);
                break;
        }
        this.camera.lookAt(target);
        this.controls.update();
    }

    fitBounds(bounds) {
        if (!bounds) return;
        const cx = (bounds.xMin + bounds.xMax) / 2;
        const cy = (bounds.yMin + bounds.yMax) / 2;
        const cz = (bounds.zMin + bounds.zMax) / 2;

        const sizeX = bounds.xMax - bounds.xMin;
        const sizeZ = bounds.zMax - bounds.zMin;
        const radius = Math.max(sizeX, sizeZ, 200);

        this.defaultTarget.set(cx, cy, cz);
        this.defaultPosition.set(cx, cy + radius * 0.9, cz + radius * 1.1);

        this.controls.target.copy(this.defaultTarget);
        this.camera.position.copy(this.defaultPosition);
        this.camera.lookAt(this.defaultTarget);
        this.controls.update();
    }
}
