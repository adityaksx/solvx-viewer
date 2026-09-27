// SolvX Viewer — 3D Ocean Current Vector Field with Real-Time Flow Dynamics & Adaptive Zoom LOD
// Vectors continuously stream and animate in the exact physical current direction (u, v)
import * as THREE from 'three';
import { sampleColor, updateLegendUI } from './colorScale.js';

export function buildCurrentVectors(currentGrid, sceneManager, bounds, updateLegend = false, vectorScale = 1.0, depthY = 1.2) {
    const group = new THREE.Group();
    group.renderOrder = 50;
    if (!currentGrid || !currentGrid.u || !currentGrid.v) return group;

    const lat = currentGrid.latitude || currentGrid.lat || [];
    const lon = currentGrid.longitude || currentGrid.lon || [];
    const u = currentGrid.u || [];
    const v = currentGrid.v || [];

    const midLat = (bounds[2] + bounds[3]) / 2;
    const midLon = (bounds[0] + bounds[1]) / 2;
    const klat = 111.32;
    const klon = 111.32 * Math.cos((midLat * Math.PI) / 180);

    const project = (lng, lt) => [
        (Number(lng) - midLon) * klon,
        (Number(lt) - midLat) * klat
    ];

    let maxSpeed = 0.001;

    // Calculate max speed for scaling & normalization
    for (let j = 0; j < lat.length; j++) {
        for (let i = 0; i < lon.length; i++) {
            const uu = Number(u[j]?.[i]);
            const vv = Number(v[j]?.[i]);
            if (isFinite(uu) && isFinite(vv)) {
                maxSpeed = Math.max(maxSpeed, Math.hypot(uu, vv));
            }
        }
    }

    if (updateLegend) {
        updateLegendUI('currents', 0.0, maxSpeed, currentGrid.units || 'm s⁻¹');
    }

    // Vector collection for dynamic flow simulation
    const vectors = [];

    // Static arrow frame buffers
    const baseLinePos = [];
    const baseLineCols = [];

    // Flowing streamlet wave shader buffers
    const flowLinePos = [];
    const flowLineProgress = []; // 0.0 at tail, 1.0 at tip
    const flowLineSpeed = [];    // normalized speed 0..1
    const flowLinePhase = [];    // random phase offset
    const flowLineCols = [];

    for (let j = 0; j < lat.length; j++) {
        for (let i = 0; i < lon.length; i++) {
            const uu = Number(u[j]?.[i]);
            const vv = Number(v[j]?.[i]);
            if (!isFinite(uu) || !isFinite(vv)) continue;

            const speed = Math.hypot(uu, vv);
            if (speed < 0.005) continue;

            const [pLon, pLat] = project(lon[i], lat[j]);
            const x = pLat; // Scene X is Northing (V velocity)
            const z = pLon; // Scene Z is Easting (U velocity)
            const y = depthY;

            const len = (7 + (speed / maxSpeed) * 22) * vectorScale;
            const dx = (vv / speed) * len; // Northward displacement along X
            const dz = (uu / speed) * len; // Eastward displacement along Z

            const ex = x + dx;
            const ez = z + dz;
            const normSpeed = Math.min(1.0, speed / maxSpeed);
            const phase = Math.random() * Math.PI * 2.0;
            const angle = Math.atan2(dz, dx); // Yaw angle in X-Z plane

            vectors.push({
                x, y, z,
                dx, dz,
                ex, ez,
                speed,
                normSpeed,
                len,
                angle,
                phase
            });

            // 1. Static base reference guide (shaft line)
            baseLinePos.push(x, y, z, ex, y, ez);

            // Sleek, short wireframe head lines
            const headLen = Math.min(3.8, len * 0.24);
            const leftX = ex - headLen * Math.cos(angle - 0.42);
            const leftZ = ez - headLen * Math.sin(angle - 0.42);
            const rightX = ex - headLen * Math.cos(angle + 0.42);
            const rightZ = ez - headLen * Math.sin(angle + 0.42);

            baseLinePos.push(ex, y, ez, leftX, y, leftZ);
            baseLinePos.push(ex, y, ez, rightX, y, rightZ);

            const col = sampleColor('currents', speed, 0.0, maxSpeed);
            for (let c = 0; c < 6; c++) {
                baseLineCols.push(col.r, col.g, col.b);
            }

            // 2. Flowing Streamlet Wave (Shaft line segments with progress attribute)
            const segments = 4;
            for (let s = 0; s < segments; s++) {
                const t0 = s / segments;
                const t1 = (s + 1) / segments;
                const p0x = x + dx * t0;
                const p0z = z + dz * t0;
                const p1x = x + dx * t1;
                const p1z = z + dz * t1;

                flowLinePos.push(p0x, y + 0.08, p0z, p1x, y + 0.08, p1z);
                flowLineProgress.push(t0, t1);
                flowLineSpeed.push(normSpeed, normSpeed);
                flowLinePhase.push(phase, phase);
                flowLineCols.push(col.r, col.g, col.b, col.r, col.g, col.b);
            }

            // Head wave pulses
            flowLinePos.push(ex, y + 0.08, ez, leftX, y + 0.08, leftZ);
            flowLineProgress.push(1.0, 0.88);
            flowLineSpeed.push(normSpeed, normSpeed);
            flowLinePhase.push(phase, phase);
            flowLineCols.push(col.r, col.g, col.b, col.r, col.g, col.b);

            flowLinePos.push(ex, y + 0.08, ez, rightX, y + 0.08, rightZ);
            flowLineProgress.push(1.0, 0.88);
            flowLineSpeed.push(normSpeed, normSpeed);
            flowLinePhase.push(phase, phase);
            flowLineCols.push(col.r, col.g, col.b, col.r, col.g, col.b);
        }
    }

    const vectorCount = vectors.length;

    // 1. Solid Base Reference LineSegments
    if (baseLinePos.length) {
        const baseGeom = new THREE.BufferGeometry();
        baseGeom.setAttribute('position', new THREE.Float32BufferAttribute(baseLinePos, 3));
        baseGeom.setAttribute('color', new THREE.Float32BufferAttribute(baseLineCols, 3));
        const baseMat = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.75,
            depthWrite: false
        });
        const baseMesh = new THREE.LineSegments(baseGeom, baseMat);
        baseMesh.renderOrder = 51;
        group.add(baseMesh);
    }

    // 2. 3D Instanced Arrowhead Cones with Adaptive Zoom-LOD Scaling
    let arrowConesMesh = null;
    if (vectorCount > 0) {
        // Base cone geometry: slender, short, streamlined
        const baseConeRadius = 0.75 * vectorScale;
        const baseConeHeight = 2.4 * vectorScale;
        const coneGeom = new THREE.ConeGeometry(baseConeRadius, baseConeHeight, 8);
        coneGeom.rotateZ(-Math.PI / 2); // Point tip along +X

        const coneMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.95,
            depthWrite: false
        });

        arrowConesMesh = new THREE.InstancedMesh(coneGeom, coneMat, vectorCount);
        arrowConesMesh.renderOrder = 52;
        const dummy = new THREE.Object3D();

        for (let i = 0; i < vectorCount; i++) {
            const v = vectors[i];
            dummy.position.set(v.ex, v.y, v.ez);
            dummy.rotation.set(0, -v.angle, 0);
            dummy.scale.set(1.0, 1.0, 1.0);
            dummy.updateMatrix();
            arrowConesMesh.setMatrixAt(i, dummy.matrix);

            const col = sampleColor('currents', v.speed, 0.0, maxSpeed);
            arrowConesMesh.setColorAt(i, new THREE.Color(col.r, col.g, col.b));
        }

        arrowConesMesh.instanceMatrix.needsUpdate = true;
        if (arrowConesMesh.instanceColor) arrowConesMesh.instanceColor.needsUpdate = true;
        group.add(arrowConesMesh);
    }

    // 3. Dynamic Flowing Streamlet Wave Mesh (GPU Shader)
    let flowMesh = null;
    let flowUniforms = null;

    if (flowLinePos.length) {
        const flowGeom = new THREE.BufferGeometry();
        flowGeom.setAttribute('position', new THREE.Float32BufferAttribute(flowLinePos, 3));
        flowGeom.setAttribute('aProgress', new THREE.Float32BufferAttribute(flowLineProgress, 1));
        flowGeom.setAttribute('aSpeed', new THREE.Float32BufferAttribute(flowLineSpeed, 1));
        flowGeom.setAttribute('aPhase', new THREE.Float32BufferAttribute(flowLinePhase, 1));
        flowGeom.setAttribute('aColor', new THREE.Float32BufferAttribute(flowLineCols, 3));

        flowUniforms = {
            uTime: { value: 0.0 },
            uFlowSpeed: { value: 1.0 },
            uOpacity: { value: 0.95 }
        };

        const flowMat = new THREE.ShaderMaterial({
            uniforms: flowUniforms,
            vertexShader: `
                attribute float aProgress;
                attribute float aSpeed;
                attribute float aPhase;
                attribute vec3 aColor;

                varying float vProgress;
                varying float vSpeed;
                varying float vPhase;
                varying vec3 vColor;

                void main() {
                    vProgress = aProgress;
                    vSpeed = aSpeed;
                    vPhase = aPhase;
                    vColor = aColor;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uFlowSpeed;
                uniform float uOpacity;

                varying float vProgress;
                varying float vSpeed;
                varying float vPhase;
                varying vec3 vColor;

                void main() {
                    // Forward traveling light wave along the vector from tail (0.0) to tip (1.0)
                    float speedFactor = 1.2 + vSpeed * 2.6;
                    float wave = fract(vProgress - uTime * speedFactor * uFlowSpeed * 0.45 + vPhase);

                    // Glowing streamlet head with smooth trailing fade
                    float pulse = smoothstep(0.68, 0.98, wave);
                    float headCore = pow(wave, 6.0);
                    float intensity = pulse * 2.4 + headCore * 1.4 + 0.35;

                    vec3 finalCol = mix(vColor, vec3(1.0, 1.0, 1.0), pulse * 0.7);
                    float alpha = clamp(pulse * 1.6 + 0.35, 0.0, 1.0) * uOpacity;

                    gl_FragColor = vec4(finalCol * intensity, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        flowMesh = new THREE.LineSegments(flowGeom, flowMat);
        flowMesh.renderOrder = 53;
        group.add(flowMesh);
    }

    // Controller state & animation hook
    let flowSpeedMultiplier = 1.0;
    let isPaused = false;
    let animationEnabled = true;
    let elapsedSimTime = 0.0;
    let lastZoomScale = -1;

    // Center coordinates for camera distance calculation
    const centerPos = new THREE.Vector3(0, depthY, 0);

    group.update = function(delta = 0.016, timeSec = null, camera = null) {
        if (!animationEnabled || isPaused) return;

        const dt = Math.min(delta, 0.1);
        elapsedSimTime += dt * flowSpeedMultiplier;

        // Update GPU shader uniform for traveling wave
        if (flowUniforms) {
            flowUniforms.uTime.value = elapsedSimTime;
            flowUniforms.uFlowSpeed.value = flowSpeedMultiplier;
        }

        // Adaptive Arrowhead Scaling:
        // In Zoom In (camera close, dist ~ 200..450): scale = 1.0 (prominent, crisp, full head)
        // In Zoom Out (camera far, dist ~ 900..1600): scale = 0.35..0.45 (short, sleek, no overlapping clutter)
        const activeCam = camera || sceneManager?.camera;
        if (activeCam && arrowConesMesh) {
            const camDist = activeCam.position.distanceTo(centerPos);
            // Smooth non-linear curve: fast shrink when zooming out, full size when zooming in
            const zoomScale = Math.max(0.32, Math.min(1.0, Math.pow(420.0 / Math.max(200.0, camDist), 0.85)));

            if (Math.abs(zoomScale - lastZoomScale) > 0.012) {
                lastZoomScale = zoomScale;
                const dummy = new THREE.Object3D();

                for (let i = 0; i < vectorCount; i++) {
                    const v = vectors[i];
                    dummy.position.set(v.ex, v.y, v.ez);
                    dummy.rotation.set(0, -v.angle, 0);
                    dummy.scale.set(zoomScale, zoomScale, zoomScale);
                    dummy.updateMatrix();
                    arrowConesMesh.setMatrixAt(i, dummy.matrix);
                }
                arrowConesMesh.instanceMatrix.needsUpdate = true;
            }
        }
    };

    group.setFlowSpeed = function(speed) {
        flowSpeedMultiplier = Math.max(0.1, Math.min(5.0, Number(speed) || 1.0));
        if (flowUniforms) flowUniforms.uFlowSpeed.value = flowSpeedMultiplier;
    };

    group.setPaused = function(paused) {
        isPaused = Boolean(paused);
    };

    group.toggleAnimation = function(enabled) {
        animationEnabled = enabled !== undefined ? Boolean(enabled) : !animationEnabled;
        if (flowMesh) flowMesh.visible = animationEnabled;
        if (arrowConesMesh) arrowConesMesh.visible = animationEnabled;
    };

    group.dispose = function() {
        group.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        });
    };

    return group;
}
