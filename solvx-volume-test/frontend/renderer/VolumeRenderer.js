/**
 * SolvX Volume Renderer
 * Adapted from Donitzo's three.js-volume-renderer (https://github.com/Donitzo/three.js-volume-renderer)
 * Provides GPU ray-marching volume rendering with volumetric depth testing against solid meshes.
 */

import * as THREE from 'three';

const vertexShader = /* glsl */ `
varying vec2 vUv;
varying float near;
varying float far;
varying mat4 invProjView;

void main() {
    // Fullscreen quad
    gl_Position = vec4(position.xy, 0.0, 1.0);
    vUv = uv;
    near = projectionMatrix[3][2] / (projectionMatrix[2][2] - 1.0);
    far = projectionMatrix[3][2] / (projectionMatrix[2][2] + 1.0);
    invProjView = inverse(projectionMatrix * viewMatrix);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
precision highp sampler3D;

// Horizontal palette texture
uniform sampler2D palette;

// Palette clamped value range
uniform float minPaletteValue;
uniform float maxPaletteValue;

// Value multiplier and added
uniform float valueMultiplier;
uniform float valueAdded;

// Values outside this range are ignored (allows NaN / land masking)
uniform float minCutoffValue;
uniform float maxCutoffValue;
uniform float cutoffFadeRange;

// Clipping bounding planes
uniform vec3 clipMin;
uniform vec3 clipMax;

// Extinction and opacity
uniform float extinctionCoefficient;
uniform float extinctionMultiplier;
uniform float alphaMultiplier;

// Random jitter to reduce ray banding
uniform float random;

#if USE_VOLUMETRIC_DEPTH_TEST
// Scene depth texture for occlusion by seabed and land
uniform sampler2D depthTexture;
#endif

// Volume spatial transforms
uniform sampler3D volumeData;
uniform vec3 volumeOrigin;
uniform vec3 volumeResolution;
uniform vec3 voxelSize;

varying vec2 vUv;
varying float near;
varying float far;
varying mat4 invProjView;

// Samples the 3D texture given world coordinates
float sampleVolume(vec3 position) {
    vec3 volumeVoxel = (position - volumeOrigin) / voxelSize;
    vec3 volumeUv = (volumeVoxel + 0.5) / volumeResolution;

    // Boundary check
    if (any(lessThan(volumeUv, vec3(0.0))) || any(greaterThan(volumeUv, vec3(1.0)))) {
        return 0.0;
    }

    return texture(volumeData, volumeUv).r;
}

void main() {
    // Calculate world position on far plane
    vec4 farWorld = invProjView * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    farWorld /= farWorld.w;

    vec3 rayOrigin = cameraPosition;
    vec3 rayDirection = normalize(farWorld.xyz - rayOrigin);

#if USE_VOLUMETRIC_DEPTH_TEST
    // Sample scene depth buffer for solid geometry (seabed, land)
    float z = texture(depthTexture, vUv).r;
    float depth = -((near * far) / ((far - near) * z - far));
#endif

    vec3 volumeSize = volumeResolution * voxelSize;
    vec3 volumeMax = volumeOrigin + (volumeResolution - 1.0) * voxelSize;

    // Ray-box intersection against clipped volume bounds
    vec3 boxMin = max(volumeOrigin, clipMin);
    vec3 boxMax = min(volumeMax, clipMax);

    vec3 t1 = (boxMin - rayOrigin) / rayDirection;
    vec3 t2 = (boxMax - rayOrigin) / rayDirection;

    vec3 tMin = min(t1, t2);
    vec3 tMax = max(t1, t2);

    float tNear = max(max(tMin.x, tMin.y), tMin.z);
    float tFar = min(min(tMax.x, tMax.y), tMax.z);

    bool insideBox = all(greaterThanEqual(rayOrigin, boxMin)) && all(lessThanEqual(rayOrigin, boxMax));

    if (!insideBox && (tNear > tFar || tFar < 0.0)) {
        discard;
    }

    vec3 entryPoint = insideBox ? rayOrigin : rayOrigin + rayDirection * tNear;
    vec3 exitPoint = rayOrigin + rayDirection * tFar;

    float intersectionLength = length(exitPoint - entryPoint);
    float stepLength = intersectionLength / float(RAY_STEPS);

    vec4 alphaBlendedColor = vec4(0.0);

#if USE_RANDOM_START
    float rand = mod(random + fract(sin(dot(rayDirection, vec3(12.9898, 78.233, 45.164))) * 43758.5453), 1.0);
    float currentRayLength = stepLength * (rand - 1.0) + 1e-6;
#else
    float currentRayLength = -stepLength + 1e-6;
#endif

    for (int i = 0; i < RAY_STEPS; i++) {
        currentRayLength += stepLength;

        // Mask steps beyond ray exit
        float stepWeight = 1.0 - step(intersectionLength - 1e-6, currentRayLength);

#if USE_VOLUMETRIC_DEPTH_TEST
        // Stop ray if it hits solid scene geometry (seabed / land)
        stepWeight *= step(currentRayLength + tNear, depth);
#endif

        vec3 position = mix(entryPoint, exitPoint, currentRayLength / intersectionLength);
        float sampledValue = sampleVolume(position);
        float scaledValue = sampledValue * valueMultiplier + valueAdded;

        // Discard NaN/masked voxels (encoded as 0.0) below minCutoffValue
        stepWeight *= step(minCutoffValue, scaledValue) * step(scaledValue, maxCutoffValue);

        // Normalize for palette lookup
        float normalizedValue = clamp((scaledValue - minPaletteValue) / max(maxPaletteValue - minPaletteValue, 1e-6), 0.0, 1.0);

        // Extinction opacity accumulation
        float alpha = 1.0 - exp(-extinctionCoefficient * extinctionMultiplier * stepLength);
        alpha *= stepWeight * alphaMultiplier;

        // Cutoff edge fade
        alpha *= smoothstep(0.0, cutoffFadeRange + 1e-6, min(scaledValue - minCutoffValue, maxCutoffValue - scaledValue));
        alpha = clamp(alpha, 0.0, 1.0);

        // Lookup color in transfer function palette
        vec4 color = vec4(texture(palette, vec2(normalizedValue, 0.5)).rgb, alpha);

        // Front-to-back compositing
        alphaBlendedColor.rgb += color.rgb * color.a * (1.0 - alphaBlendedColor.a);
        alphaBlendedColor.a += (1.0 - alphaBlendedColor.a) * color.a;

        if (alphaBlendedColor.a >= 0.98) {
            break; // Early ray termination
        }
    }

    if (alphaBlendedColor.a <= 0.001) {
        discard;
    }

    gl_FragColor = alphaBlendedColor;
}
`;

export default class VolumeRenderer extends THREE.Mesh {
    uniforms = {
        depthTexture:          { value: null },

        volumeOrigin:          { value: new THREE.Vector3() },
        volumeResolution:      { value: new THREE.Vector3(1, 1, 1) },
        voxelSize:             { value: new THREE.Vector3(1, 1, 1) },
        volumeData:            { value: null },

        clipMin:               { value: new THREE.Vector3(-1e10, -1e10, -1e10) },
        clipMax:               { value: new THREE.Vector3(1e10, 1e10, 1e10) },

        random:                { value: 0.0 },

        palette:               { value: null },
        minPaletteValue:       { value: 0.0 },
        maxPaletteValue:       { value: 1.0 },

        minCutoffValue:        { value: 0.01 },  // Below 0.01 is masked (NaN)
        maxCutoffValue:        { value: 1.05 },
        cutoffFadeRange:       { value: 0.01 },

        valueMultiplier:       { value: 1.0 },
        valueAdded:            { value: 0.0 },

        extinctionCoefficient: { value: 0.05 },
        extinctionMultiplier:  { value: 1.0 },
        alphaMultiplier:       { value: 0.65 },
    };

    constructor(options = {}) {
        super(new THREE.PlaneGeometry(2, 2));

        this.name = 'VolumeRenderer';
        this.renderOrder = 1000;
        this.frustumCulled = false;

        this.updateMaterial(options);
    }

    updateMaterial(options = {}) {
        const defines = {
            USE_VOLUMETRIC_DEPTH_TEST: +(options.useVolumetricDepthTest ?? true),
            USE_RANDOM_START: +(options.useRandomStart ?? true),
            RAY_STEPS: options.raySteps ?? 128,
        };

        const uniforms = {
            depthTexture:          this.uniforms.depthTexture,
            volumeOrigin:          this.uniforms.volumeOrigin,
            volumeResolution:      this.uniforms.volumeResolution,
            voxelSize:             this.uniforms.voxelSize,
            volumeData:            this.uniforms.volumeData,
            clipMin:               this.uniforms.clipMin,
            clipMax:               this.uniforms.clipMax,
            random:                this.uniforms.random,
            palette:               this.uniforms.palette,
            minPaletteValue:       this.uniforms.minPaletteValue,
            maxPaletteValue:       this.uniforms.maxPaletteValue,
            minCutoffValue:        this.uniforms.minCutoffValue,
            maxCutoffValue:        this.uniforms.maxCutoffValue,
            cutoffFadeRange:       this.uniforms.cutoffFadeRange,
            valueMultiplier:       this.uniforms.valueMultiplier,
            valueAdded:            this.uniforms.valueAdded,
            extinctionCoefficient: this.uniforms.extinctionCoefficient,
            extinctionMultiplier:  this.uniforms.extinctionMultiplier,
            alphaMultiplier:       this.uniforms.alphaMultiplier,
        };

        if (this.material) {
            this.material.dispose();
        }

        this.material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms,
            defines,
            depthTest: false,
            depthWrite: false,
            transparent: true,
            premultipliedAlpha: true,
            side: THREE.DoubleSide,
        });
    }

    setRaySteps(steps) {
        this.updateMaterial({ raySteps: steps, useVolumetricDepthTest: true });
    }
}
