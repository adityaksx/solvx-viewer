export const OceanVertShader = `
uniform float uTime;
uniform float uWaveHeight;

varying vec3 vWorldPosition;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewPosition;

// Gerstner Wave function
vec3 gerstnerWave(vec2 dir, float steepness, float wavelength, float speed, vec2 p, inout vec3 tangent, inout vec3 binormal) {
    float k = 2.0 * 3.14159 / wavelength;
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
    
    // Sum multiple waves
    float ampScale = uWaveHeight * 0.5;
    
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

varying vec3 vWorldPosition;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewPosition;

// Simple procedural 3D noise for small ripples
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 = v - i + dot(i, C.xxx) ;
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
}

void main() {
    // ---- LAND MASKING: discard fragments over land ----
    if (uHasBathyTex > 0.5) {
        // Ocean geometry vUv.x = lat, vUv.y = lon.
        // Bathy texture is Width=lon, Height=lat.
        // We must transpose the UV and flip lon!
        float depthVal = texture2D(uBathyTex, vec2(1.0 - vUv.y, vUv.x)).r;
        if (depthVal < 0.001) {
            discard; // land or no-data → don't render ocean here
        }
    }

    // Generate small procedural noise normal
    float noise1 = snoise(vec3(vWorldPosition.xz * 0.05, uTime * 0.5));
    float noise2 = snoise(vec3(vWorldPosition.xz * 0.1, -uTime * 0.8));
    
    vec3 n = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);
    
    // Perturb normal for small ripples
    n.x += (noise1 + noise2) * 0.1;
    n.z += (noise1 - noise2) * 0.1;
    n = normalize(n);
    
    // Fresnel term
    float f0 = 0.02;
    float cosTheta = max(dot(viewDir, n), 0.0);
    float fresnel = f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
    
    // Simple reflection (sky color gradient + fake sun)
    vec3 reflection = mix(uBaseColor, uSkyColor, 0.7 + n.y * 0.3);
    
    // Fake specular highlight from a directional sun
    vec3 sunDir = normalize(vec3(1.0, 1.0, 0.5));
    vec3 halfVector = normalize(sunDir + viewDir);
    float NdotH = max(dot(n, halfVector), 0.0);
    float specular = pow(NdotH, 150.0) * 1.5;
    
    // Mix base water color with reflection based on Fresnel
    vec3 finalColor = mix(uBaseColor, reflection, fresnel) + specular * vec3(1.0, 0.9, 0.8);
    
    gl_FragColor = vec4(finalColor, 0.7); // semi-transparent
}
`;
