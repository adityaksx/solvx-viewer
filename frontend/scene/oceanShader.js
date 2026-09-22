export const OceanVertShader = `
uniform float uTime;
uniform float uWaveHeight;

varying vec3 vWorldPosition;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewPosition;

// Gerstner Wave function
vec3 gerstnerWave(vec2 dir, float steepness, float wavelength, float speed, vec2 p, inout vec3 tangent, inout vec3 binormal) {
    float k = 2.0 * 3.14159265 / wavelength;
    float c = sqrt(9.8 / k) * speed;
    vec2 d = normalize(dir);
    float f = k * (dot(d, p) - c * uTime);
    float a = steepness / k;
    
    tangent += vec3(
        -d.x * d.x * (steepness * sin(f)),
        d.x * (steepness * cos(f)),
        -d.x * d.y * (steepness * sin(f))
    );
    binormal += vec3(
        -d.x * d.y * (steepness * sin(f)),
        d.y * (steepness * cos(f)),
        -d.y * d.y * (steepness * sin(f))
    );
    
    return vec3(
        d.x * (a * cos(f)),
        a * sin(f),
        d.y * (a * cos(f))
    );
}

void main() {
    vUv = uv;
    
    vec3 gridPoint = position;
    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);
    vec3 p = gridPoint;
    
    // Sum primary and secondary wave harmonics with subtle amplitude to prevent clipping
    float ampScale = uWaveHeight * 0.15;
    p += gerstnerWave(vec2(1.0, 1.0), 0.2, 60.0, 1.5, gridPoint.xz, tangent, binormal) * ampScale;
    p += gerstnerWave(vec2(1.0, 0.6), 0.2, 31.0, 1.2, gridPoint.xz, tangent, binormal) * ampScale;
    p += gerstnerWave(vec2(-1.0, 0.3), 0.2, 18.0, 1.8, gridPoint.xz, tangent, binormal) * ampScale;
    p += gerstnerWave(vec2(0.3, -1.0), 0.15, 11.0, 2.0, gridPoint.xz, tangent, binormal) * ampScale;

    vec3 normal = normalize(cross(binormal, tangent));
    
    vec4 worldPosition = modelMatrix * vec4(p, 1.0);
    vWorldPosition = worldPosition.xyz;
    vNormal = normal;
    
    vec4 mvPosition = viewMatrix * worldPosition;
    vViewPosition = -mvPosition.xyz;
    
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const OceanFragShader = `
uniform float uTime;
uniform vec3 uBaseColor;
uniform vec3 uSkyColor;
uniform sampler2D uBathyTex;
uniform float uHasBathyTex;
uniform sampler2D uDataTex;
uniform float uHasDataTex;
uniform float uDataOpacity;

varying vec3 vWorldPosition;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewPosition;

// Fast harmonic ripple perturbation (avoids heavy 3D simplex texture-less per-fragment loops)
vec2 waveRipples(vec2 pos, float time) {
    vec2 p1 = pos * 0.12 + vec2(time * 0.7, time * 0.5);
    vec2 p2 = pos * 0.24 - vec2(time * 0.9, time * 0.6);
    float dx = sin(p1.x + p1.y) * 0.5 + cos(p2.x - p2.y) * 0.3;
    float dz = cos(p1.x - p1.y) * 0.5 + sin(p2.x + p2.y) * 0.3;
    return vec2(dx, dz) * 0.05;
}

void main() {
    vec2 texCoord = vec2(1.0 - vUv.y, vUv.x);

    // ---- LAND MASKING: discard fragments over land ----
    if (uHasBathyTex > 0.5) {
        float depthVal = texture2D(uBathyTex, texCoord).r;
        if (depthVal < 0.001) {
            discard;
        }
    }

    vec3 baseColor = uBaseColor;
    float alpha = 0.78;

    // ---- SCIENTIFIC VARIABLE COLORING (e.g. Temperature, Salinity, SSH) ----
    if (uHasDataTex > 0.5) {
        vec4 dataSample = texture2D(uDataTex, texCoord);
        if (dataSample.a > 0.05) {
            baseColor = mix(uBaseColor, dataSample.rgb, uDataOpacity);
            alpha = mix(0.78, 0.92, uDataOpacity);
        }
    }

    // Fast ripple normal perturbation
    vec2 ripple = waveRipples(vWorldPosition.xz, uTime);
    vec3 n = normalize(vNormal + vec3(ripple.x, 0.0, ripple.y));
    vec3 viewDir = normalize(vViewPosition);
    
    // Fresnel reflection
    float f0 = 0.04;
    float cosTheta = clamp(dot(viewDir, n), 0.0, 1.0);
    float fresnel = f0 + (1.0 - f0) * pow(1.0 - cosTheta, 4.0);
    
    // Sky color reflection gradient
    vec3 reflection = mix(baseColor, uSkyColor, clamp(0.35 + n.y * 0.45, 0.0, 1.0));
    
    // Specular highlight from key light
    vec3 sunDir = normalize(vec3(0.5, 1.0, 0.8));
    vec3 halfVector = normalize(sunDir + viewDir);
    float NdotH = max(dot(n, halfVector), 0.0);
    float specular = pow(NdotH, 48.0) * 0.5;
    
    vec3 finalColor = mix(baseColor, reflection, fresnel * 0.55) + specular * vec3(0.9, 0.95, 1.0);
    gl_FragColor = vec4(finalColor, alpha);
}
`;
