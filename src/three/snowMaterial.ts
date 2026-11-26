import * as THREE from 'three';

export interface SnowUniforms {
  [key: string]: THREE.IUniform;
  uTime: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSun: { value: THREE.Color };
  uAmb: { value: THREE.Color };
  uCam: { value: THREE.Vector3 };
  uGroom: { value: THREE.Texture | null };
  uHeat: { value: number };
  uThin: { value: number };
  uCorduroy: { value: number };
  uGlitter: { value: number };
  uFogColor: { value: THREE.Color };
  uFogDensity: { value: number };
}

const VERT = /* glsl */ `
  attribute float aSnow;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying vec2 vUv;
  varying float vSnow;
  void main() {
    vUv = uv;
    vSnow = aSnow;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSun;
  uniform vec3 uAmb;
  uniform vec3 uCam;
  uniform sampler2D uGroom;
  uniform float uHeat;
  uniform float uThin;
  uniform float uCorduroy;
  uniform float uGlitter;
  uniform vec3 uFogColor;
  uniform float uFogDensity;

  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying vec2 vUv;
  varying float vSnow;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(uCam - vWorldPos);
    vec3 L = normalize(uSunDir);

    // 大范围雪色起伏 + 细颗粒（这里是 sRGB 取色，稍后转线性）
    float broad = vnoise(vWorldPos.xz * 0.06);
    float fine = vnoise(vWorldPos.xz * 1.7);
    vec3 baseS = mix(vec3(0.78, 0.86, 0.96), vec3(0.94, 0.975, 1.0), broad);
    baseS *= 0.965 + 0.05 * fine;
    vec3 base = pow(baseS, vec3(2.2));

    // ---- 压雪灯芯绒纹 ----
    vec4 gm = texture2D(uGroom, vUv);
    float groomMask = gm.r * uCorduroy;
    vec2 gdir = gm.gb * 2.0 - 1.0;
    float gLen = length(gdir);
    vec2 dir = gLen > 0.01 ? gdir / gLen : vec2(1.0, 0.0);
    float spacing = 0.11;
    float phase = dot(vWorldPos.xz, dir) / spacing;
    float stripe = sin(phase * 6.28318);
    float camDist = distance(uCam, vWorldPos);
    // 远距离淡出，避免摩尔纹（smoothstep 边界递增）
    float cordFade = groomMask * (1.0 - smoothstep(18.0, 75.0, camDist));
    N = normalize(N + vec3(dir.x, 0.0, dir.y) * stripe * 0.4 * cordFade);
    base *= 1.0 - 0.10 * cordFade * (0.5 - 0.5 * stripe);

    // ---- 光照（线性空间） ----
    float ndl = max(dot(N, L), 0.0);
    float hemi = N.y * 0.5 + 0.5;
    vec3 amb = uAmb * (0.72 + 0.42 * hemi);
    // 背光面一点冷色补光，保证起伏暗部不死黑
    float wrap = max(dot(N, L) * 0.5 + 0.5, 0.0);
    vec3 col = base * amb + base * uSun * ndl + base * vec3(0.10, 0.14, 0.22) * wrap * 0.35;

    // ---- 太阳下的颗粒闪光 ----
    vec3 H = normalize(L + V);
    vec2 cell = floor(vWorldPos.xz * 22.0);
    float hsh = hash21(cell);
    float twinkle = pow(0.5 + 0.5 * sin(uTime * 2.2 + hsh * 80.0), 14.0);
    float align = pow(max(dot(N, H), 0.0), 90.0);
    float glint = step(0.965, hsh) * twinkle * (0.25 + 2.6 * align);
    col += pow(vec3(1.0, 0.98, 0.92), vec3(2.2)) * glint * uGlitter * (0.35 + ndl);

    // ---- 距离雾（线性混合） ----
    float f = 1.0 - exp(-uFogDensity * uFogDensity * camDist * camDist);
    col = mix(col, uFogColor, clamp(f, 0.0, 1.0));

    // ---- 色调映射 + 输出 gamma ----
    col = aces(col * 1.05);
    col = pow(col, vec3(1.0 / 2.2));

    // ---- 薄雪厚度热力图（直接在输出空间混合设计色板） ----
    if (uHeat > 0.001) {
      float tt = clamp(vSnow / max(0.2, uThin * 2.4), 0.0, 1.0);
      vec3 red = vec3(0.85, 0.12, 0.10);
      vec3 amber = vec3(0.98, 0.72, 0.18);
      vec3 deep = vec3(0.92, 0.97, 1.0);
      vec3 heat = mix(red, amber, smoothstep(0.0, 0.45, tt));
      heat = mix(heat, deep, smoothstep(0.4, 1.0, tt));
      float pulse = 0.88 + 0.12 * sin(uTime * 3.0);
      col = mix(col, heat * pulse, clamp(uHeat * 0.9, 0.0, 1.0));
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSnowMaterial(groomTex: THREE.Texture | null): THREE.ShaderMaterial & { uniforms: SnowUniforms } {
  const uniforms: SnowUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(-0.55, 0.52, 0.42).normalize() },
    uSun: { value: new THREE.Color(2.15, 1.95, 1.62) },
    uAmb: { value: new THREE.Color(0.115, 0.15, 0.235) },
    uCam: { value: new THREE.Vector3() },
    uGroom: { value: groomTex },
    uHeat: { value: 0 },
    uThin: { value: 0.6 },
    uCorduroy: { value: 1 },
    uGlitter: { value: 1 },
    uFogColor: { value: new THREE.Color(0xcfe2f5) },
    uFogDensity: { value: 0.0016 },
  };
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
  }) as THREE.ShaderMaterial & { uniforms: SnowUniforms };
}
