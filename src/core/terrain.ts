import type { TerrainData } from './types';
import { clamp, fbm, lerp, valueNoise2D } from './mathx';

export type { TerrainData };

export function dxOf(t: TerrainData): number {
  return t.width / (t.nx - 1);
}
export function dzOf(t: TerrainData): number {
  return t.depth / (t.nz - 1);
}
export function cellArea(t: TerrainData): number {
  return dxOf(t) * dzOf(t);
}

export function ixToX(t: TerrainData, ix: number): number {
  return t.originX + (ix / (t.nx - 1)) * t.width;
}
export function izToZ(t: TerrainData, iz: number): number {
  return t.originZ + (iz / (t.nz - 1)) * t.depth;
}

export function indexAt(t: TerrainData, ix: number, iz: number): number {
  return iz * t.nx + ix;
}

/** 世界坐标 -> 浮点网格坐标 */
export function worldToGrid(t: TerrainData, x: number, z: number): { gx: number; gz: number } {
  const gx = ((x - t.originX) / t.width) * (t.nx - 1);
  const gz = ((z - t.originZ) / t.depth) * (t.nz - 1);
  return { gx, gz };
}

function bilinearArr(t: TerrainData, arr: Float32Array, x: number, z: number): number {
  const { gx, gz } = worldToGrid(t, x, z);
  if (gx <= 0 && gz <= 0) return arr[0];
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const fx = clamp(gx - x0, 0, 1);
  const fz = clamp(gz - z0, 0, 1);
  const ix0 = clamp(x0, 0, t.nx - 1);
  const iz0 = clamp(z0, 0, t.nz - 1);
  const ix1 = clamp(x0 + 1, 0, t.nx - 1);
  const iz1 = clamp(z0 + 1, 0, t.nz - 1);
  const a = arr[indexAt(t, ix0, iz0)];
  const b = arr[indexAt(t, ix1, iz0)];
  const c = arr[indexAt(t, ix0, iz1)];
  const d = arr[indexAt(t, ix1, iz1)];
  return (
    a * (1 - fx) * (1 - fz) +
    b * fx * (1 - fz) +
    c * (1 - fx) * fz +
    d * fx * fz
  );
}

export function sampleGround(t: TerrainData, x: number, z: number): number {
  return bilinearArr(t, t.ground, x, z);
}
export function sampleSnow(t: TerrainData, x: number, z: number): number {
  return bilinearArr(t, t.snow, x, z);
}
/** 雪面高程 = 地面 + 雪厚 */
export function sampleSurface(t: TerrainData, x: number, z: number): number {
  return sampleGround(t, x, z) + sampleSnow(t, x, z);
}

/** 沿世界方向 (dirX,dirZ) 的坡度（rise/run，正为上坡） */
export function slopeAlong(
  t: TerrainData,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
): number {
  const e = 1.0;
  const len = Math.hypot(dirX, dirZ) || 1;
  const ux = dirX / len;
  const uz = dirZ / len;
  const h1 = sampleSurface(t, x + ux * e, z + uz * e);
  const h0 = sampleSurface(t, x - ux * e, z - uz * e);
  return (h1 - h0) / (2 * e);
}

export function totalSnowVolume(t: TerrainData): number {
  const a = cellArea(t);
  let sum = 0;
  for (let i = 0; i < t.snow.length; i++) sum += Math.max(0, t.snow[i]);
  return sum * a;
}

export function thinSnowArea(t: TerrainData, threshold: number): { area: number; min: number; mean: number } {
  const a = cellArea(t);
  let area = 0;
  let min = Infinity;
  let sum = 0;
  for (let i = 0; i < t.snow.length; i++) {
    const s = t.snow[i];
    sum += s;
    if (s < min) min = s;
    if (s < threshold) area += a;
  }
  return { area, min, mean: sum / t.snow.length };
}

export function cloneTerrain(t: TerrainData): TerrainData {
  return { ...t, ground: new Float32Array(t.ground), snow: new Float32Array(t.snow) };
}

/** 生成内置测试雪场：顺 +X 下坡，中央走廊平整，两侧有林缘起伏，含薄雪区 */
export function generateTestTerrain(): TerrainData {
  const nx = 201;
  const nz = 141;
  const width = 400;
  const depth = 280;
  const originX = -200;
  const originZ = -140;
  const ground = new Float32Array(nx * nz);
  const snow = new Float32Array(nx * nz);
  const n1 = valueNoise2D(20261127);
  const n2 = valueNoise2D(7717);
  const tanPitch = Math.tan((8 * Math.PI) / 180);

  const gauss = (x: number, z: number, cx: number, cz: number, r: number) =>
    Math.exp(-(((x - cx) ** 2 + (z - cz) ** 2) / (2 * r * r)));

  for (let iz = 0; iz < nz; iz++) {
    const z = originZ + (iz / (nz - 1)) * depth;
    for (let ix = 0; ix < nx; ix++) {
      const x = originX + (ix / (nx - 1)) * width;
      const i = indexAt({ nx } as TerrainData, ix, iz);
      const side = clamp((Math.abs(z) - 22) / 80, 0, 1);
      const roll =
        2.2 * Math.sin(x * 0.021 + 1.7) * Math.cos(z * 0.028) +
        (fbm(n1, x * 0.012 + 10, z * 0.012 - 4, 4) - 0.5) * (2.0 + 7.0 * side);
      const valley = 0.00115 * z * z;
      ground[i] = -tanPitch * x + roll + valley;

      let sd =
        0.62 +
        0.62 * fbm(n2, x * 0.028 + 3, z * 0.028 + 9, 4) +
        0.25 * fbm(n1, x * 0.09, z * 0.09, 2);
      // 两处明显薄雪/露石区，热力图一眼可见
      sd -= 0.62 * gauss(x, z, -30, 20, 9);
      sd -= 0.55 * gauss(x, z, 95, -24, 12);
      sd -= 0.3 * gauss(x, z, -150, -14, 14);
      snow[i] = clamp(sd, 0.06, 2.4);
    }
  }

  return { name: '测试雪场 · 北坡地形公园', nx, nz, width, depth, originX, originZ, ground, snow };
}

/** 从二维高程矩阵构建地形（heights[iz][ix] 或一维数组） */
export function terrainFromMatrix(opts: {
  name?: string;
  heights: number[][] | Float32Array | number[];
  nx?: number;
  nz?: number;
  cellSize?: number;
  originX?: number;
  originZ?: number;
  snowDepth?: number | Float32Array;
}): TerrainData {
  const { heights } = opts;
  let nx = opts.nx ?? 0;
  let nz = opts.nz ?? 0;
  let flat: ArrayLike<number>;
  if (Array.isArray(heights) && Array.isArray((heights as number[][])[0])) {
    const m = heights as number[][];
    nz = m.length;
    nx = m[0].length;
    flat = Float32Array.from(m.flat());
  } else {
    flat = heights as Float32Array | number[];
    if (!nx || !nz) throw new Error('一维高程数组必须提供 nx/nz');
    if (flat.length !== nx * nz) throw new Error(`高程数量 ${flat.length} 与 nx*nz=${nx * nz} 不一致`);
  }
  const cell = opts.cellSize ?? 2;
  const width = (nx - 1) * cell;
  const depth = (nz - 1) * cell;
  const ground = Float32Array.from(flat);
  const snow = new Float32Array(nx * nz);
  if (opts.snowDepth instanceof Float32Array) snow.set(opts.snowDepth);
  else snow.fill(opts.snowDepth ?? 0.8);
  return {
    name: opts.name ?? '导入高程网格',
    nx,
    nz,
    width,
    depth,
    originX: opts.originX ?? -width / 2,
    originZ: opts.originZ ?? -depth / 2,
    ground,
    snow,
  };
}

export interface ParsedImport {
  terrain: TerrainData;
  warnings: string[];
}

/** 支持 JSON 高程网格 / 等高线，以及 CSV 矩阵 */
export function parseTerrainFile(fileName: string, text: string): ParsedImport {
  const warnings: string[] = [];
  if (fileName.toLowerCase().endsWith('.csv') || text.trim().split('\n')[0]?.includes(',')) {
    const rows = text
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split(/[,\s;]+/).filter(Boolean).map(Number))
      .filter((r) => r.length && r.every((v) => Number.isFinite(v)));
    if (rows.length < 2) throw new Error('CSV 至少需要 2 行高程数据');
    const nx = rows[0].length;
    if (rows.some((r) => r.length !== nx)) throw new Error('CSV 各行列数不一致');
    const cellSize = 2;
    const t = terrainFromMatrix({ heights: rows, cellSize, name: fileName });
    warnings.push(`CSV 按 ${cellSize}m 格距解析，可在导入后调整比例`);
    return { terrain: t, warnings };
  }

  const json = JSON.parse(text);
  if (json.type === 'contours' || Array.isArray(json.contours)) {
    return { terrain: contoursToTerrain(json), warnings };
  }
  if (json.heights || json.ground) {
    const h = json.heights ?? json.ground;
    const t = terrainFromMatrix({
      name: json.name ?? fileName,
      heights: h,
      nx: json.nx ?? json.cols,
      nz: json.nz ?? json.rows,
      cellSize: json.cellSize ?? json.cell ?? 2,
      originX: json.originX,
      originZ: json.originZ,
      snowDepth: json.snowDepth,
    });
    return { terrain: t, warnings };
  }
  throw new Error('无法识别的文件格式：需要 heights 网格或 contours 等高线');
}

/** 等高线 -> IDW 插值高程网格 */
export function contoursToTerrain(json: any): TerrainData {
  const cellSize = json.cellSize ?? 4;
  const contours: { elev: number; points: number[] | { x: number; z: number }[] }[] =
    json.contours ?? [];
  if (!contours.length) throw new Error('等高线数据为空');

  const samples: { x: number; z: number; e: number }[] = [];
  for (const c of contours) {
    const pts = c.points;
    if (!pts) continue;
    if (typeof (pts as any[])[0] === 'number') {
      const arr = pts as number[];
      // 扁平数组按 x,z 成对解析
      for (let i = 0; i + 1 < arr.length; i += 2) {
        samples.push({ x: arr[i], z: arr[i + 1], e: c.elev });
      }
    } else {
      for (const p of pts as { x: number; z: number }[]) samples.push({ x: p.x, z: p.z, e: c.elev });
    }
  }
  if (samples.length < 4) throw new Error('等高线采样点过少');

  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const s of samples) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z);
    maxZ = Math.max(maxZ, s.z);
  }
  const nx = clamp(Math.round((maxX - minX) / cellSize) + 1, 8, 260);
  const nz = clamp(Math.round((maxZ - minZ) / cellSize) + 1, 8, 260);
  const width = (nx - 1) * cellSize;
  const depth = (nz - 1) * cellSize;
  const originX = minX;
  const originZ = minZ;
  const ground = new Float32Array(nx * nz);

  // 抽样降密，避免极端数据下 O(N*M) 过大
  const stride = Math.max(1, Math.floor(samples.length / 6000));
  const used = samples.filter((_, i) => i % stride === 0);

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = originX + ix * cellSize;
      const z = originZ + iz * cellSize;
      let wsum = 0;
      let vsum = 0;
      for (const s of used) {
        const d2 = (s.x - x) ** 2 + (s.z - z) ** 2 + 0.5;
        const w = 1 / d2;
        wsum += w;
        vsum += w * s.e;
      }
      ground[iz * nx + ix] = vsum / wsum;
    }
  }
  return terrainFromMatrix({
    name: json.name ?? '等高线导入地形',
    heights: ground,
    nx,
    nz,
    cellSize,
    originX,
    originZ,
    snowDepth: json.snowDepth ?? 0.9,
  });
}

/** Marching squares 生成等高线线段（世界坐标），用于渲染与导出 */
export function buildContours(
  t: TerrainData,
  interval = 5,
): { level: number; segments: Float32Array }[] {
  const levels: number[] = [];
  let min = Infinity;
  let max = -Infinity;
  for (const v of t.ground) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  for (let l = Math.ceil(min / interval) * interval; l <= max; l += interval) levels.push(l);

  const result: { level: number; segments: Float32Array }[] = [];
  for (const level of levels) {
    const seg: number[] = [];
    for (let iz = 0; iz < t.nz - 1; iz++) {
      for (let ix = 0; ix < t.nx - 1; ix++) {
        const x0 = ixToX(t, ix);
        const x1 = ixToX(t, ix + 1);
        const z0 = izToZ(t, iz);
        const z1 = izToZ(t, iz + 1);
        const i00 = indexAt(t, ix, iz);
        const a = t.ground[i00];
        const b = t.ground[i00 + 1];
        const c = t.ground[i00 + t.nx];
        const d = t.ground[i00 + t.nx + 1];
        const code = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const pt = (edge: number): [number, number] => {
          switch (edge) {
            case 0: {
              // a-b 底边 z0
              const f = (level - a) / (b - a || 1e-9);
              return [lerp(x0, x1, f), z0];
            }
            case 1: {
              // b-d 右边 x1
              const f = (level - b) / (d - b || 1e-9);
              return [x1, lerp(z0, z1, f)];
            }
            case 2: {
              // c-d 顶边 z1
              const f = (level - c) / (d - c || 1e-9);
              return [lerp(x0, x1, f), z1];
            }
            default: {
              // a-c 左边 x0
              const f = (level - a) / (c - a || 1e-9);
              return [x0, lerp(z0, z1, f)];
            }
          }
        };
        // 每条等高线穿过的边对
        const pairs: [number, number][] = [];
        switch (code) {
          case 1:
          case 14:
            pairs.push([3, 0]);
            break;
          case 2:
          case 13:
            pairs.push([0, 1]);
            break;
          case 3:
          case 12:
            pairs.push([3, 1]);
            break;
          case 4:
          case 11:
            pairs.push([2, 3]);
            break;
          case 6:
          case 9:
            pairs.push([0, 2]);
            break;
          case 7:
          case 8:
            pairs.push([1, 2]);
            break;
          case 5:
            pairs.push([3, 0], [1, 2]);
            break;
          case 10:
            pairs.push([0, 1], [2, 3]);
            break;
        }
        for (const [e1, e2] of pairs) {
          const p1 = pt(e1);
          const p2 = pt(e2);
          seg.push(p1[0], sampleGround(t, p1[0], p1[1]) + 0.15, p1[1]);
          seg.push(p2[0], sampleGround(t, p2[0], p2[1]) + 0.15, p2[1]);
        }
      }
    }
    if (seg.length) result.push({ level, segments: new Float32Array(seg) });
  }
  return result;
}
