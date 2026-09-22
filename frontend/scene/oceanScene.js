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

        this.layers = {
            land: null,
            coastline: null,
            islands: null,
            eez: null,
            seabed: null,
            water: null,
            scientific: null,
            currents: null,
            particles: null
        };

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
            powerPreference: 'high-performance',
            logarithmicDepthBuffer: true
        });
        // Cap DPR at 1.5 for balanced performance and sharpness
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
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
        for (const k of Object.keys(this.layers)) {
            this.layers[k] = null;
        }
    }

    setLayer(name, obj) {
        if (this.layers[name] && this.layers[name] !== obj) {
            this.disposeObject(this.layers[name]);
        }
        this.layers[name] = obj;
        if (obj && !this.root.children.includes(obj)) {
            this.root.add(obj);
        }
    }

    setLayerVisibility(name, visible) {
        if (this.layers[name]) {
            this.layers[name].visible = !!visible;
        }
    }

    disposeObject(obj) {
        if (!obj) return;
        if (typeof obj.dispose === 'function') {
            try { obj.dispose(); } catch (_) {}
        }
        obj.traverse(x => {
            x.geometry?.dispose();
            const mats = Array.isArray(x.material) ? x.material : x.material ? [x.material] : [];
            for (const m of mats) {
                // Explicitly dispose all texture maps to prevent GPU VRAM leaks
                if (m.map) m.map.dispose();
                if (m.alphaMap) m.alphaMap.dispose();
                if (m.normalMap) m.normalMap.dispose();
                if (m.roughnessMap) m.roughnessMap.dispose();
                if (m.metalnessMap) m.metalnessMap.dispose();
                if (m.uniforms) {
                    for (const u of Object.values(m.uniforms)) {
                        if (u?.value?.isTexture) u.value.dispose();
                    }
                }
                m.dispose();
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

        // Targeted raycasting: only test relevant interactive groups
        const interactiveTargets = [];
        if (this.layers.water?.group) interactiveTargets.push(this.layers.water.group);
        if (this.layers.observations?.group) interactiveTargets.push(this.layers.observations.group);

        const hits = this.raycaster.intersectObjects(interactiveTargets.length ? interactiveTargets : this.root.children, true);

        // Check for Argo floats
        for (const hit of hits) {
            if (hit.object.userData?.isArgoFloat) {
                this.onFloatClick(hit.object.userData.float);
                return;
            }
        }

        // Check for ocean cells
        for (const hit of hits) {
            if (hit.object.userData?.isWater && hit.instanceId != null) {
                const cell = hit.object.userData.cells?.[hit.instanceId];
                if (cell) {
                    this.onOceanClick(cell);
                    return;
                }
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
