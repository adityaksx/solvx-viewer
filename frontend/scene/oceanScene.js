// SolvX Viewer — Main 3D Ocean Scene Manager
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class OceanScene {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.onOceanClick = options.onOceanClick || (() => {});
        this.onFloatClick = options.onFloatClick || (() => {});
        this.depthEx = options.depthEx || 70.0;

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.root = null;
        this.bounds = null;
        this.animId = null;
        this.updateCallbacks = [];

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.init();
    }

    init() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xb9dfe9);

        this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100000);
        this.camera.position.set(250, 180, 350);

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(width, height);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        // Lighting
        const hemi = new THREE.HemisphereLight(0xffffff, 0x6b7b73, 1.5);
        this.scene.add(hemi);

        const sun = new THREE.DirectionalLight(0xffffff, 1.8);
        sun.position.set(-350, 900, 500);
        this.scene.add(sun);

        const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.5);
        fillLight.position.set(300, -200, -200);
        this.scene.add(fillLight);

        this.root = new THREE.Group();
        this.scene.add(this.root);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.055;
        this.controls.screenSpacePanning = true;
        this.controls.minDistance = 30;
        this.controls.maxDistance = 15000;

        window.addEventListener('resize', this.onResize.bind(this));
        this.canvas.addEventListener('click', this.onClick.bind(this));

        this.animate(0);
    }

    onUpdate(cb) {
        this.updateCallbacks.push(cb);
    }

    clearScene() {
        while (this.root.children.length) {
            const child = this.root.children.pop();
            this.disposeObject(child);
        }
    }

    disposeObject(obj) {
        if (!obj) return;
        obj.traverse(x => {
            x.geometry?.dispose();
            if (x.material) {
                if (Array.isArray(x.material)) x.material.forEach(m => m.dispose());
                else x.material.dispose();
            }
        });
        obj.parent?.remove(obj);
    }

    depthY(meters) {
        return -Math.max(0, Number(meters)) * this.depthEx / 1000;
    }

    fitCamera() {
        const box = new THREE.Box3().setFromObject(this.root);
        if (box.isEmpty()) return;
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const radius = Math.max(size.x, size.z, size.y, 10);

        this.controls.target.set(center.x, center.y * 0.12, center.z);
        this.camera.position.set(center.x + radius * 0.95, center.y + radius * 0.72, center.z + radius * 1.05);
        this.camera.near = 0.1;
        this.camera.far = radius * 30;
        this.camera.updateProjectionMatrix();
        this.controls.update();
    }

    setView(viewName) {
        const box = new THREE.Box3().setFromObject(this.root);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const radius = Math.max(size.x, size.z, size.y, 10);

        if (viewName === 'top') {
            this.camera.position.set(center.x, center.y + radius * 1.65, center.z + 0.001);
        } else if (viewName === 'profile') {
            this.camera.position.set(center.x + radius * 1.55, center.y, center.z);
        } else if (viewName === 'under') {
            this.camera.position.set(center.x + radius * 0.7, center.y - radius * 0.65, center.z - radius * 1.2);
        } else {
            this.camera.position.set(center.x + radius * 0.95, center.y + radius * 0.72, center.z + radius * 1.05);
        }
        this.controls.target.copy(center);
        this.controls.update();
    }

    setExaggeration(ex) {
        this.depthEx = Number(ex);
    }

    onClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Check for Argo floats
        const floatHits = this.raycaster.intersectObjects(this.root.children, true).filter(h => h.object.userData?.isArgoFloat);
        if (floatHits.length > 0) {
            this.onFloatClick(floatHits[0].object.userData.float);
            return;
        }

        // Check for ocean cells
        const oceanHits = this.raycaster.intersectObjects(this.root.children, true).filter(h => h.object.userData?.isWater && h.instanceId != null);
        if (oceanHits.length > 0) {
            const hit = oceanHits[0];
            const cell = hit.object.userData.cells?.[hit.instanceId];
            if (cell) {
                this.onOceanClick(cell);
            }
        }
    }

    onResize() {
        if (!this.renderer || !this.camera) return;
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    animate(timestamp) {
        this.animId = requestAnimationFrame(this.animate.bind(this));
        for (const cb of this.updateCallbacks) {
            cb(timestamp);
        }
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    destroy() {
        if (this.animId) cancelAnimationFrame(this.animId);
        window.removeEventListener('resize', this.onResize.bind(this));
        this.clearScene();
    }
}
