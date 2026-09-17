// SolvX Viewer — Interactive 3D World Globe
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class WorldGlobe {
    constructor(container, options = {}) {
        this.container = container;
        this.onRegionSelect = options.onRegionSelect || (() => {});
        this.selectedBBox = options.initialBBox || {
            min_lon: 84.10,
            max_lon: 93.00,
            min_lat: 16.07,
            max_lat: 23.52
        };

        this.radius = 100;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.globeMesh = null;
        this.bboxMesh = null;
        this.pinsGroup = null;
        this.animId = null;

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.isSelecting = false;
        this.dragStartPoint = null;

        this.init();
    }

    init() {
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x07111c);

        this.camera = new THREE.PerspectiveCamera(40, width / height, 1, 3000);
        this.camera.position.set(0, 80, 320);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(width, height);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.rotateSpeed = 0.6;
        this.controls.minDistance = 130;
        this.controls.maxDistance = 600;
        this.controls.autoRotate = false;

        // Lighting
        const ambient = new THREE.AmbientLight(0xdbeafe, 1.2);
        this.scene.add(ambient);

        const sun = new THREE.DirectionalLight(0xffffff, 2.0);
        sun.position.set(300, 200, 250);
        this.scene.add(sun);

        const backLight = new THREE.DirectionalLight(0x38bdf8, 0.7);
        backLight.position.set(-300, -100, -200);
        this.scene.add(backLight);

        // Build Globe with high-fidelity procedural texture
        this.buildGlobe();
        this.buildAtmosphere();
        this.buildGraticule();
        this.pinsGroup = new THREE.Group();
        this.scene.add(this.pinsGroup);

        this.updateSelectionBox();

        window.addEventListener('resize', this.onResize.bind(this));
        this.setupEvents();
        this.animate();
    }

    createEarthTexture() {
        // High-fidelity procedural Earth texture with continents, oceans, and bathymetry
        const canvas = document.createElement('canvas');
        canvas.width = 2048;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');

        // Deep ocean gradient
        const oceanGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        oceanGrad.addColorStop(0, '#0a2342');
        oceanGrad.addColorStop(0.3, '#0b3954');
        oceanGrad.addColorStop(0.5, '#084887');
        oceanGrad.addColorStop(0.7, '#0b3954');
        oceanGrad.addColorStop(1, '#0a2342');
        ctx.fillStyle = oceanGrad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw simplified continental landmasses
        ctx.fillStyle = '#2d6a4f';
        ctx.strokeStyle = '#40916c';
        ctx.lineWidth = 2;

        const toCanvas = (lon, lat) => [
            ((lon + 180) / 360) * canvas.width,
            ((90 - lat) / 180) * canvas.height
        ];

        const continents = [
            // Eurasia & Africa
            [[10, 36], [30, 42], [60, 45], [90, 50], [120, 55], [140, 45], [120, 20], [105, 10], [90, 22], [80, 10], [70, 24], [50, 12], [40, 28], [25, 36], [10, 36]],
            // India sub-continent
            [[68, 24], [72, 20], [76, 12], [77, 8], [80, 10], [84, 18], [88, 22], [90, 24], [80, 28], [68, 24]],
            // Africa
            [[-17, 15], [-5, 36], [12, 37], [32, 31], [51, 12], [42, -5], [35, -25], [18, -34], [12, -18], [9, 5], [-17, 15]],
            // North America
            [[-165, 65], [-140, 70], [-95, 72], [-60, 50], [-75, 35], [-82, 25], [-97, 26], [-105, 20], [-120, 35], [-125, 48], [-165, 65]],
            // South America
            [[-80, 8], [-60, 12], [-35, -5], [-40, -22], [-55, -38], [-68, -55], [-75, -45], [-81, -5], [-80, 8]],
            // Australia
            [[114, -22], [130, -12], [142, -11], [153, -28], [148, -38], [135, -35], [115, -34], [114, -22]],
            // Southeast Asia & Indonesia
            [[98, 5], [105, 10], [108, -7], [120, -9], [130, -4], [110, 1], [98, 5]]
        ];

        continents.forEach(poly => {
            ctx.beginPath();
            poly.forEach(([lon, lat], i) => {
                const [x, y] = toCanvas(lon, lat);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        });

        // Add bathymetric shelf highlights around coastlines
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
        ctx.lineWidth = 5;
        continents.forEach(poly => {
            ctx.beginPath();
            poly.forEach(([lon, lat], i) => {
                const [x, y] = toCanvas(lon, lat);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.closePath();
            ctx.stroke();
        });

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        return texture;
    }

    buildGlobe() {
        const geom = new THREE.SphereGeometry(this.radius, 64, 64);
        const texture = this.createEarthTexture();
        const mat = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.8,
            metalness: 0.1
        });
        this.globeMesh = new THREE.Mesh(geom, mat);
        this.scene.add(this.globeMesh);
    }

    buildAtmosphere() {
        const geom = new THREE.SphereGeometry(this.radius * 1.03, 48, 48);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x38bdf8,
            transparent: true,
            opacity: 0.12,
            side: THREE.BackSide
        });
        const atmo = new THREE.Mesh(geom, mat);
        this.scene.add(atmo);
    }

    buildGraticule() {
        const lines = new THREE.Group();
        const mat = new THREE.LineBasicMaterial({
            color: 0x38bdf8,
            transparent: true,
            opacity: 0.15
        });

        // Parallels (every 30 deg)
        for (let lat = -60; lat <= 60; lat += 30) {
            const pts = [];
            const r = this.radius * 1.002 * Math.cos((lat * Math.PI) / 180);
            const y = this.radius * 1.002 * Math.sin((lat * Math.PI) / 180);
            for (let lon = 0; lon <= 360; lon += 5) {
                const phi = (lon * Math.PI) / 180;
                pts.push(new THREE.Vector3(r * Math.sin(phi), y, r * Math.cos(phi)));
            }
            const g = new THREE.BufferGeometry().setFromPoints(pts);
            lines.add(new THREE.Line(g, mat));
        }

        // Meridians (every 30 deg)
        for (let lon = 0; lon < 360; lon += 30) {
            const pts = [];
            const phi = (lon * Math.PI) / 180;
            for (let lat = -80; lat <= 80; lat += 5) {
                const theta = (lat * Math.PI) / 180;
                const r = this.radius * 1.002 * Math.cos(theta);
                const y = this.radius * 1.002 * Math.sin(theta);
                pts.push(new THREE.Vector3(r * Math.sin(phi), y, r * Math.cos(phi)));
            }
            const g = new THREE.BufferGeometry().setFromPoints(pts);
            lines.add(new THREE.Line(g, mat));
        }

        this.scene.add(lines);
    }

    geoToCartesian(lat, lon, altitude = 1.005) {
        const phi = ((90 - lat) * Math.PI) / 180;
        const theta = ((lon + 180) * Math.PI) / 180;
        const r = this.radius * altitude;
        return new THREE.Vector3(
            -r * Math.sin(phi) * Math.cos(theta),
            r * Math.cos(phi),
            r * Math.sin(phi) * Math.sin(theta)
        );
    }

    cartesianToGeo(vec) {
        const n = vec.clone().normalize();
        const lat = 90 - (Math.acos(n.y) * 180) / Math.PI;
        let lon = ((Math.atan2(n.z, -n.x) * 180) / Math.PI) - 180;
        if (lon < -180) lon += 360;
        if (lon > 180) lon -= 360;
        return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
    }

    updateSelectionBox(bbox = null) {
        if (bbox) this.selectedBBox = bbox;
        const b = this.selectedBBox;
        if (!b) return;

        if (this.bboxMesh) {
            this.scene.remove(this.bboxMesh);
            this.bboxMesh.geometry.dispose();
            this.bboxMesh.material.dispose();
            this.bboxMesh = null;
        }

        // Draw bounding box wireframe curved on sphere
        const pts = [];
        const steps = 16;

        // South edge (min_lat, min_lon -> max_lon)
        for (let i = 0; i <= steps; i++) {
            const lon = b.min_lon + ((b.max_lon - b.min_lon) * i) / steps;
            pts.push(this.geoToCartesian(b.min_lat, lon));
        }
        // East edge (max_lon, min_lat -> max_lat)
        for (let i = 0; i <= steps; i++) {
            const lat = b.min_lat + ((b.max_lat - b.min_lat) * i) / steps;
            pts.push(this.geoToCartesian(lat, b.max_lon));
        }
        // North edge (max_lat, max_lon -> min_lon)
        for (let i = 0; i <= steps; i++) {
            const lon = b.max_lon - ((b.max_lon - b.min_lon) * i) / steps;
            pts.push(this.geoToCartesian(b.max_lat, lon));
        }
        // West edge (min_lon, max_lat -> min_lat)
        for (let i = 0; i <= steps; i++) {
            const lat = b.max_lat - ((b.max_lat - b.min_lat) * i) / steps;
            pts.push(this.geoToCartesian(lat, b.min_lon));
        }

        const geom = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({
            color: 0x38bdf8,
            linewidth: 3
        });
        this.bboxMesh = new THREE.Line(geom, mat);
        this.scene.add(this.bboxMesh);
    }

    setPresets(presets = []) {
        while (this.pinsGroup.children.length) {
            const c = this.pinsGroup.children.pop();
            c.geometry?.dispose();
            c.material?.dispose();
        }

        presets.forEach(p => {
            const b = p.bbox;
            const midLat = (b.min_lat + b.max_lat) / 2;
            const midLon = (b.min_lon + b.max_lon) / 2;
            const pos = this.geoToCartesian(midLat, midLon, 1.03);

            const pinGeom = new THREE.SphereGeometry(1.8, 16, 16);
            const pinMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
            const pin = new THREE.Mesh(pinGeom, pinMat);
            pin.position.copy(pos);
            pin.userData = { preset: p };
            this.pinsGroup.add(pin);
        });
    }

    flyTo(lat, lon) {
        const targetPos = this.geoToCartesian(lat, lon, 2.5);
        this.camera.position.copy(targetPos);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    setupEvents() {
        const dom = this.renderer.domElement;

        dom.addEventListener('pointerdown', (e) => {
            if (e.shiftKey) {
                this.isSelecting = true;
                this.controls.enabled = false;
                const hit = this.raycast(e);
                if (hit) {
                    this.dragStartPoint = this.cartesianToGeo(hit.point);
                }
            }
        });

        dom.addEventListener('pointermove', (e) => {
            if (this.isSelecting && this.dragStartPoint) {
                const hit = this.raycast(e);
                if (hit) {
                    const currentPoint = this.cartesianToGeo(hit.point);
                    const bbox = {
                        min_lat: Math.min(this.dragStartPoint.lat, currentPoint.lat),
                        max_lat: Math.max(this.dragStartPoint.lat, currentPoint.lat),
                        min_lon: Math.min(this.dragStartPoint.lon, currentPoint.lon),
                        max_lon: Math.max(this.dragStartPoint.lon, currentPoint.lon)
                    };
                    if (bbox.max_lat - bbox.min_lat > 1 && bbox.max_lon - bbox.min_lon > 1) {
                        this.updateSelectionBox(bbox);
                    }
                }
            }
        });

        window.addEventListener('pointerup', () => {
            if (this.isSelecting) {
                this.isSelecting = false;
                this.controls.enabled = true;
                this.onRegionSelect(this.selectedBBox);
            }
        });

        dom.addEventListener('click', (e) => {
            if (e.shiftKey) return;
            const rect = dom.getBoundingClientRect();
            this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const hits = this.raycaster.intersectObjects(this.pinsGroup.children, false);
            if (hits.length > 0) {
                const preset = hits[0].object.userData.preset;
                if (preset) {
                    this.updateSelectionBox(preset.bbox);
                    this.onRegionSelect(preset.bbox);
                }
            }
        });
    }

    raycast(e) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const hits = this.raycaster.intersectObject(this.globeMesh, false);
        return hits.length ? hits[0] : null;
    }

    onResize() {
        if (!this.renderer || !this.camera) return;
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    animate() {
        this.animId = requestAnimationFrame(this.animate.bind(this));
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    destroy() {
        if (this.animId) cancelAnimationFrame(this.animId);
        window.removeEventListener('resize', this.onResize.bind(this));
        if (this.renderer?.domElement?.parentElement) {
            this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
        }
    }
}
