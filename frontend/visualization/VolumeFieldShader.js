// SolvX Viewer — Generic GPU Volume Raymarching Shader
// High-performance front-to-back raymarching through 3D scalar fields with non-uniform depth LUT and colormaps.
import * as THREE from 'three';

export function createVolumeMaterial({
    volumeTexture = null,
    colormapTexture = null,
    depthLutTexture = null,
    bathyTexture = null,
    opacity = 0.65,
    minDepthKm = 0.0,
    maxDepthKm = 0.55,
    steps = 96
} = {}) {
    const uniforms = {
        u_volume: { value: volumeTexture },
        u_colormap: { value: colormapTexture },
        u_depthLut: { value: depthLutTexture },
        u_bathyTex: { value: bathyTexture },
        u_hasBathyTex: { value: !!bathyTexture },
        u_inverseModelMatrix: { value: new THREE.Matrix4() },
        u_opacity: { value: opacity },
        u_clipMinDepthFrac: { value: 0.0 },
        u_clipMaxDepthFrac: { value: 1.0 },
        u_minDepthKm: { value: minDepthKm },
        u_maxDepthKm: { value: maxDepthKm },
        u_steps: { value: steps }
    };

    const vertexShader = `
        precision highp float;
        
        varying vec3 vLocalPos;
        varying vec3 vWorldPos;

        void main() {
            // Local pos shifted to [0.0, 1.0] range
            vLocalPos = position + vec3(0.5);
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPos = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
    `;

    const fragmentShader = `
        precision highp float;
        precision highp sampler3D;

        uniform sampler3D u_volume;
        uniform sampler2D u_colormap;
        uniform sampler2D u_depthLut;
        uniform sampler2D u_bathyTex;
        uniform bool u_hasBathyTex;

        uniform mat4 u_inverseModelMatrix;
        uniform float u_opacity;
        uniform float u_clipMinDepthFrac;
        uniform float u_clipMaxDepthFrac;
        uniform float u_minDepthKm;
        uniform float u_maxDepthKm;
        uniform int u_steps;

        varying vec3 vLocalPos;
        varying vec3 vWorldPos;

        void main() {
            // Transform world camera position into local [0, 1] unit box
            vec3 rayOrigin = (u_inverseModelMatrix * vec4(cameraPosition, 1.0)).xyz + vec3(0.5);
            vec3 rayTarget = vLocalPos;
            vec3 rayDir = normalize(rayTarget - rayOrigin);

            // Ray-AABB intersection with unit box [0, 1]^3
            vec3 invR = 1.0 / (rayDir + vec3(1e-7));
            vec3 t0_cand = invR * (vec3(0.0) - rayOrigin);
            vec3 t1_cand = invR * (vec3(1.0) - rayOrigin);

            vec3 tmin = min(t0_cand, t1_cand);
            vec3 tmax = max(t0_cand, t1_cand);

            float t_enter = max(max(tmin.x, tmin.y), tmin.z);
            float t_exit = min(min(tmax.x, tmax.y), tmax.z);

            // If camera is inside the volume, start raymarching at the camera position
            t_enter = max(t_enter, 0.0);

            if (t_enter >= t_exit) {
                discard;
            }

            int steps = u_steps > 0 ? u_steps : 96;
            float stepLength = (t_exit - t_enter) / float(steps);
            vec4 accColor = vec4(0.0);

            for (int i = 0; i < 128; i++) {
                if (i >= steps) break;

                float t = t_enter + (float(i) + 0.5) * stepLength;
                vec3 p = rayOrigin + rayDir * t;

                // Box boundary check
                if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z < 0.0 || p.z > 1.0) {
                    continue;
                }

                // p.y = 1.0 is sea surface (top), p.y = 0.0 is deep ocean (bottom)
                float depthFrac = clamp(1.0 - p.y, 0.0, 1.0);

                // Depth range clipping
                if (depthFrac < u_clipMinDepthFrac || depthFrac > u_clipMaxDepthFrac) {
                    continue;
                }

                // Non-uniform depth level mapping from 1D LUT
                float texZ = texture2D(u_depthLut, vec2(depthFrac, 0.5)).r;

                // 3D Texture coordinate:
                // Width (Nx) = Longitude -> p.z
                // Height (Ny) = Latitude -> p.x
                // Depth (Nz) = Vertical depth level index -> texZ
                vec3 texCoord = vec3(clamp(p.z, 0.0, 1.0), clamp(p.x, 0.0, 1.0), clamp(texZ, 0.0, 1.0));
                float scalarNorm = texture(u_volume, texCoord).r;

                // Dedicated missing/land voxel sentinel: -1.0
                if (scalarNorm < -0.1) {
                    continue;
                }

                // Bathymetric seabed clipping
                if (u_hasBathyTex) {
                    float bathyNorm = texture2D(u_bathyTex, vec2(p.z, p.x)).r;
                    // bathyNorm encodes seabed depth / 6.0 km. 0 = land.
                    if (bathyNorm < 0.001) {
                        continue; // Land column
                    }
                    float curDepthKm = u_minDepthKm + depthFrac * (u_maxDepthKm - u_minDepthKm);
                    float seabedDepthKm = bathyNorm * 6.0;
                    if (curDepthKm > seabedDepthKm) {
                        continue; // Beneath ocean seabed
                    }
                }

                // Sample colormap
                vec4 sampleCol = texture2D(u_colormap, vec2(clamp(scalarNorm, 0.0, 1.0), 0.5));

                // Physically grounded Beer-Lambert extinction
                // Ensures gentle step opacity so rays penetrate deep through the water column,
                // revealing vertical stratifications and the thermocline instead of an opaque surface slab.
                float extinction = u_opacity * 3.5;
                float alpha = clamp(1.0 - exp(-extinction * stepLength), 0.0, 0.90);
                
                accColor.rgb += (1.0 - accColor.a) * sampleCol.rgb * alpha;
                accColor.a += (1.0 - accColor.a) * alpha;

                // Early ray termination
                if (accColor.a >= 0.98) {
                    break;
                }
            }

            if (accColor.a < 0.01) {
                discard;
            }

            gl_FragColor = accColor;
        }
    `;

    return new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        side: THREE.BackSide, // Guarantees rendering when camera is inside or outside the volume box
        depthWrite: false
    });
}
