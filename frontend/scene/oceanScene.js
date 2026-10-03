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
            observations: null,
            regions: null,
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
        const parent = this.canvas.parentElement;
        const width = parent ? parent.clientWidth : window.innerWidth;
        const height = parent ? parent.clientHeight : window.innerHeight;

        const initialTheme = (typeof localStorage !== 'undefined' && localStorage.getItem('solvx_theme')) || 'light';
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(initialTheme === 'dark' ? 0x101a24 : 0xeaf4f7);

        this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100000);
        this.camera.position.set(250, 180, 350);

        try {
            this.renderer = new THREE.WebGLRenderer({
                canvas: this.canvas,
                antialias: true,
                powerPreference: 'high-performance'
            });
        } catch (_) {
            this.renderer = new THREE.WebGLRenderer({
                canvas: this.canvas,
                antialias: false,
                powerPreference: 'default'
            });
        }
        // Cap DPR at 1.5 for balanced performance and sharpness
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        this.renderer.setSize(width, height);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        // Lighting
        const hemi = new THREE.HemisphereLight(0xffffff, 0x6b7b73, 1.5);
        this.scene.add(hemi);
        this.hemiLight = hemi;

        const sun = new THREE.DirectionalLight(0xffffff, 1.8);
        sun.position.set(-350, 900, 500);
        this.scene.add(sun);
        this.sunLight = sun;

        const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.5);
        fillLight.position.set(300, -200, -200);
        this.scene.add(fillLight);

        this.root = new THREE.Group();
        this.scene.add(this.root);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.075;
        this.controls.rotateSpeed = 0.9;
        this.controls.zoomSpeed = 1.2;
        this.controls.panSpeed = 0.85;
        this.controls.screenSpacePanning = true;
        this.controls.minDistance = 20;
        this.controls.maxDistance = 15000;

        window.addEventListener('resize', this.onResize.bind(this));
        // Selection is deliberately pointer-click only. Track pointer movement
        // so OrbitControls drags cannot accidentally trigger a selection on release.
        this.canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
        this.canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
        this.canvas.addEventListener('pointercancel', this.onPointerCancel.bind(this));

        this.animate(0);
    }

    animateCameraTo(targetCamPos, targetControlsTarget, durationMs = 550) {
        if (!this.camera || !this.controls) return;
        if (this._cameraAnim) {
            cancelAnimationFrame(this._cameraAnim);
            this._cameraAnim = null;
        }

        const startCamPos = this.camera.position.clone();
        const startTarget = this.controls.target.clone();
        const startTime = performance.now();

        const step = (now) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / durationMs, 1);
            // Smooth ease-out cubic
            const ease = 1 - Math.pow(1 - progress, 3);

            this.camera.position.lerpVectors(startCamPos, targetCamPos, ease);
            this.controls.target.lerpVectors(startTarget, targetControlsTarget, ease);
            this.controls.update();

            if (progress < 1) {
                this._cameraAnim = requestAnimationFrame(step);
            } else {
                this._cameraAnim = null;
            }
        };
        this._cameraAnim = requestAnimationFrame(step);
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

    fitCamera(durationMs = 600) {
        const box = new THREE.Box3().setFromObject(this.root);
        if (box.isEmpty()) return;
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const radius = Math.max(size.x, size.z, size.y, 10);

        const targetControls = new THREE.Vector3(center.x, center.y * 0.12, center.z);
        const targetPos = new THREE.Vector3(center.x + radius * 0.95, center.y + radius * 0.72, center.z + radius * 1.05);

        this.camera.near = 0.1;
        this.camera.far = radius * 30;
        this.camera.updateProjectionMatrix();

        if (durationMs > 0) {
            this.animateCameraTo(targetPos, targetControls, durationMs);
        } else {
            this.controls.target.copy(targetControls);
            this.camera.position.copy(targetPos);
            this.controls.update();
        }
    }

    setView(viewName) {
        if (viewName === 'reset') {
            this.fitCamera(600);
            return;
        }
        const box = new THREE.Box3().setFromObject(this.root);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const radius = Math.max(size.x, size.z, size.y, 10);

        let targetPos;
        if (viewName === 'top') {
            targetPos = new THREE.Vector3(center.x, center.y + radius * 1.65, center.z + 0.001);
        } else if (viewName === 'cut' || viewName === 'horizontal') {
            targetPos = new THREE.Vector3(center.x + radius * 1.3, center.y * 0.1, center.z + radius * 0.1);
        } else if (viewName === 'profile' || viewName === 'vertical') {
            targetPos = new THREE.Vector3(center.x + radius * 1.55, center.y, center.z);
        } else if (viewName === 'under') {
            targetPos = new THREE.Vector3(center.x + radius * 0.7, center.y - radius * 0.65, center.z - radius * 1.2);
        } else {
            targetPos = new THREE.Vector3(center.x + radius * 0.95, center.y + radius * 0.72, center.z + radius * 1.05);
        }
        this.animateCameraTo(targetPos, center, 550);
    }

    setTheme(themeName = 'light') {
        const isDark = themeName === 'dark';
        if (this.scene) {
            this.scene.background = new THREE.Color(isDark ? 0x101a24 : 0xeaf4f7);
        }
        if (this.hemiLight) {
            this.hemiLight.groundColor.setHex(isDark ? 0x6b7b73 : 0xb8cdd8);
            this.hemiLight.intensity = isDark ? 1.5 : 1.8;
        }
        if (this.sunLight) {
            this.sunLight.intensity = isDark ? 1.8 : 2.0;
        }
    }

    setExaggeration(ex) {
        this.setExaggerationFactor(ex);
    }

    setExaggerationFactor(factor) {
        this.depthEx = Number(factor);
        if (this.root) {
            this.root.scale.y = this.depthEx / 70.0;
        }
        this.controls.update();
    }

    focusPosition(targetVec, distance = null) {
        if (!targetVec) return;
        const dist = distance || this.camera.position.distanceTo(this.controls.target);
        const dir = this.camera.position.clone().sub(this.controls.target).normalize();
        const targetPos = targetVec.clone().add(dir.multiplyScalar(dist));
        this.animateCameraTo(targetPos, targetVec, 550);
    }

    onPointerDown(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        this._pointerDown = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    }

    onPointerUp(e) {
        if (!this._pointerDown || e.pointerId !== this._pointerDown.pointerId) return;

        const dx = e.clientX - this._pointerDown.x;
        const dy = e.clientY - this._pointerDown.y;
        const moved = Math.hypot(dx, dy);
        this._pointerDown = null;

        // A click must be nearly stationary. Orbit/camera drags are never selections.
        if (moved > 6) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        this.onClick(e);
    }

    onPointerCancel() {
        this._pointerDown = null;
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
        // Regions are stored in the analysis scene layer and are clickable.
        if (this.layers.regions?.group) interactiveTargets.push(this.layers.regions.group);

        const hits = this.raycaster.intersectObjects(interactiveTargets.length ? interactiveTargets : this.root.children, true);

        // Check for Anomaly Regions first (highest priority if clicked)
        for (const hit of hits) {
            if (hit.object.userData?.isAnomaly || hit.object.userData?.customData?.isAnomaly) {
                if (this.onAnomalyClick) this.onAnomalyClick({ isAnomaly: true, item: hit.object.userData.item || hit.object.userData.customData.item });
                return;
            }
            if (hit.object.userData?.isRegion || hit.object.userData?.customData?.isRegion) {
                if (this.onAnomalyClick) this.onAnomalyClick({ isRegion: true, item: hit.object.userData.item || hit.object.userData.customData.item });
                return;
            }
        }

        // Check for Argo floats
        for (const hit of hits) {
            if (hit.object.userData?.isArgoFloat && hit.object.userData?.float) {
                if (this.onFloatClick) this.onFloatClick(hit.object.userData.float);
                return;
            }
        }

        // Check for ocean cells
        for (const hit of hits) {
            if (hit.object.userData?.isWater && hit.instanceId != null) {
                const cell = hit.object.userData.cells?.[hit.instanceId];
                if (cell) {
                    if (this.onOceanClick) this.onOceanClick(cell);
                    return;
                }
            }
        }
    }

    onResize() {
        if (!this.renderer || !this.camera) return;
        const parent = this.canvas.parentElement;
        const width = parent ? parent.clientWidth : window.innerWidth;
        const height = parent ? parent.clientHeight : window.innerHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    animate(timestamp) {
        this.animId = requestAnimationFrame(this.animate.bind(this));

        for (const cb of this.updateCallbacks) {
            cb(timestamp);
        }
        this.controls?.update();
        if (this.renderer && this.scene && this.camera && this.root && this.root.children.length > 0) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    logSceneInventory() {
        console.group('[SolvX 3D Scene Inventory]');
        const items = [];
        this.root.traverse((obj) => {
            if (obj.isMesh || obj.isInstancedMesh || obj.isPoints || obj.isLine) {
                const info = {
                    name: obj.name || (obj.isInstancedMesh ? 'InstancedMesh (water columns)' : (obj.userData?.isWater ? 'Water Mesh' : obj.type)),
                    type: obj.type,
                    visible: obj.visible,
                    parentVisible: obj.parent ? obj.parent.visible : true,
                    renderOrder: obj.renderOrder,
                    isWater: !!obj.userData?.isWater,
                    hasData3D: !!obj.material?.uniforms?.uHasData3D?.value,
                    opacity: obj.material?.opacity ?? obj.material?.uniforms?.uGlobalOpacity?.value ?? 1.0,
                    transparent: !!obj.material?.transparent
                };
                items.push(info);
                console.log(`[Mesh] ${info.name}: type=${info.type}, visible=${info.visible}, renderOrder=${info.renderOrder}, opacity=${info.opacity}, transparent=${info.transparent}`);
            }
        });
        if (console.table) {
            console.table(items);
        }
        console.groupEnd();
        return items;
    }

    destroy() {
        if (this.animId) cancelAnimationFrame(this.animId);
        window.removeEventListener('resize', this.onResize.bind(this));
        this.clearScene();
    }
}
