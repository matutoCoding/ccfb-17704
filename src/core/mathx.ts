// 小型数学/随机工具

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 可复现的 mulberry32 随机数 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 二维值噪声（双线性 + 平滑插值），用于生成起伏 */
export function valueNoise2D(seed: number): (x: number, z: number) => number {
  const rand = rng(seed);
  const size = 256;
  const perm = new Float32Array(size * size);
  for (let i = 0; i < perm.length; i++) perm[i] = rand();
  const at = (ix: number, iz: number) => {
    const x = ((ix % size) + size) % size;
    const z = ((iz % size) + size) % size;
    return perm[z * size + x];
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, z: number) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = smooth(x - ix);
    const fz = smooth(z - iz);
    const a = at(ix, iz);
    const b = at(ix + 1, iz);
    const c = at(ix, iz + 1);
    const d = at(ix + 1, iz + 1);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
  };
}

export function fbm(noise: (x: number, z: number) => number, x: number, z: number, oct = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * noise(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

let idCounter = 0;
export function uid(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

export function fmt(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}
