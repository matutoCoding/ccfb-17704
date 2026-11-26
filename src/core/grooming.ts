import type { GroomOp, GroomPath, HaulBlob, Plan } from './types';
import { cellArea, indexAt, ixToX, izToZ, sampleSurface, type TerrainData } from './terrain';
import { uid } from './mathx';

interface Station {
  x: number;
  z: number;
  q: number;
}

/** 把路径折线加密成间距约 1m 的桩号序列 */
export function densifyPath(points: { x: number; z: number }[], step = 1): Station[] {
  const out: Station[] = [];
  let q = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i === 0) {
      out.push({ x: p.x, z: p.z, q: 0 });
      continue;
    }
    const prev = points[i - 1];
    const len = Math.hypot(p.x - prev.x, p.z - prev.z);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ x: prev.x + (p.x - prev.x) * t, z: prev.z + (p.z - prev.z) * t, q: q + len * t });
    }
    q += len;
  }
  return out;
}

interface Nearest {
  dist: number;
  q: number;
  dirX: number;
  dirZ: number;
}

function nearestOnPath(x: number, z: number, pts: { x: number; z: number }[]): Nearest | null {
  if (pts.length < 2) return null;
  let best: Nearest = { dist: Infinity, q: 0, dirX: 1, dirZ: 0 };
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const len2 = vx * vx + vz * vz || 1e-9;
    const len = Math.sqrt(len2);
    let t = ((x - a.x) * vx + (z - a.z) * vz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + vx * t;
    const pz = a.z + vz * t;
    const dist = Math.hypot(x - px, z - pz);
    if (dist < best.dist) {
      best = { dist, q: acc + t * len, dirX: vx / len, dirZ: vz / len };
    }
    acc += len;
  }
  return best;
}

/**
 * 沿推铲轨迹应用一层作业：
 * 设计高程为首尾雪面连线（纵坡），高处切、低处填，物料沿推进方向 sweep。
 * 严格质量平衡：cut = reused + haul（末端集雪），fill = reused + borrow。
 */
export function applyGroomPass(
  terrain: TerrainData,
  path: GroomPath,
  layer: number,
): { snow: Float32Array; op: GroomOp } {
  const snow = new Float32Array(terrain.snow);
  const area = cellArea(terrain);
  const halfW = path.bladeWidth / 2;

  const p0 = path.points[0];
  const p1 = path.points[path.points.length - 1];
  const h0 = sampleSurface(terrain, p0.x, p0.z);
  const h1 = sampleSurface(terrain, p1.x, p1.z);
  const totalLen = Math.max(1e-6, Math.hypot(p1.x - p0.x, p1.z - p0.z));
  const gradeAt = (q: number) => h0 + ((h1 - h0) / totalLen) * q;

  interface CellWork {
    ix: number;
    iz: number;
    idx: number;
    x: number;
    z: number;
    q: number;
    diff: number; // 当前雪面 - 设计高程，正为高
  }
  const cells: CellWork[] = [];

  for (let iz = 0; iz < terrain.nz; iz++) {
    const z = izToZ(terrain, iz);
    for (let ix = 0; ix < terrain.nx; ix++) {
      const x = ixToX(terrain, ix);
      const near = nearestOnPath(x, z, path.points);
      if (!near || near.dist > halfW) continue;
      const idx = indexAt(terrain, ix, iz);
      const surface = terrain.ground[idx] + snow[idx];
      cells.push({ ix, iz, idx, x, z, q: near.q, diff: surface - gradeAt(near.q) });
    }
  }

  // 沿推进方向（桩号）排序，模拟推铲把雪向前推
  cells.sort((a, b) => a.q - b.q);

  let load = 0; // 铲上雪量 m³
  let cutVolume = 0;
  let fillVolume = 0;
  let reusedVolume = 0;
  let borrowVolume = 0;
  let cutArea = 0;
  let fillArea = 0;
  const srcBins = new Map<number, HaulBlob>();
  const dstBins = new Map<number, HaulBlob>();
  let cx = 0,
    cz = 0,
    cv = 0;
  let fx = 0,
    fz = 0,
    fv = 0;
  const BIN = 6;

  for (const c of cells) {
    if (c.diff > 0.005) {
      const depth = Math.min(c.diff, path.cutPerPass, snow[c.idx]);
      if (depth <= 0.001) continue;
      const vol = depth * area;
      snow[c.idx] = Math.max(0, snow[c.idx] - depth);
      cutVolume += vol;
      cutArea += area;
      load += vol;
      const bin = Math.round(c.q / BIN);
      const b = srcBins.get(bin) ?? { x: 0, z: 0, v: 0 };
      // 累加加权中心
      b.x += c.x * vol;
      b.z += c.z * vol;
      b.v += vol;
      srcBins.set(bin, b);
      cx += c.x * vol;
      cz += c.z * vol;
      cv += vol;
    } else if (c.diff < -0.005) {
      const wantDepth = Math.min(-c.diff, path.cutPerPass);
      const wantVol = wantDepth * area;
      const fromBlade = Math.min(wantVol, load);
      const borrow = wantVol - fromBlade;
      const applied = fromBlade + borrow;
      const depth = applied / area;
      snow[c.idx] += depth;
      load -= fromBlade;
      fillVolume += applied;
      reusedVolume += fromBlade;
      borrowVolume += borrow;
      fillArea += area;
      const bin = Math.round(c.q / BIN);
      const b = dstBins.get(bin) ?? { x: 0, z: 0, v: 0 };
      b.x += c.x * applied;
      b.z += c.z * applied;
      b.v += applied;
      dstBins.set(bin, b);
      fx += c.x * applied;
      fz += c.z * applied;
      fv += applied;
    }
  }

  const haulVolume = Math.max(0, load); // 推到末端集雪堆

  const sources: HaulBlob[] = [...srcBins.values()]
    .map((b) => ({ x: b.x / b.v, z: b.z / b.v, v: b.v }))
    .filter((b) => b.v > 0.05)
    .sort((a, b) => b.v - a.v)
    .slice(0, 24);
  const destinations: HaulBlob[] = [...dstBins.values()]
    .map((b) => ({ x: b.x / b.v, z: b.z / b.v, v: b.v }))
    .filter((b) => b.v > 0.05)
    .sort((a, b) => b.v - a.v)
    .slice(0, 24);

  const endDir = (() => {
    const a = path.points[path.points.length - 2] ?? p0;
    const dx = p1.x - a.x;
    const dz = p1.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  })();

  const op: GroomOp = {
    id: uid('op'),
    pathId: path.id,
    pathName: path.name,
    layer,
    at: 0,
    cutPerPass: path.cutPerPass,
    bladeWidth: path.bladeWidth,
    cutVolume,
    fillVolume,
    reusedVolume,
    haulVolume,
    borrowVolume,
    cutArea,
    fillArea,
    sources,
    destinations,
    centroidCut: cv > 0 ? { x: cx / cv, z: cz / cv } : { x: p0.x, z: p0.z },
    centroidFill: fv > 0 ? { x: fx / fv, z: fz / fv } : { x: p1.x, z: p1.z },
    stockpile: { x: p1.x + endDir.x * 4, z: p1.z + endDir.z * 4 },
  };
  return { snow, op };
}

/** 依据所有压雪路径与作业次数，生成雪面灯芯绒方向掩码（RGBA, nx*nz） */
export function buildGroomMask(plan: Plan): Uint8Array {
  const t = plan.terrain;
  const data = new Uint8Array(t.nx * t.nz * 4);
  const opsByPath = new Map<string, number>();
  for (const op of plan.groomOps) opsByPath.set(op.pathId, (opsByPath.get(op.pathId) ?? 0) + 1);

  for (let iz = 0; iz < t.nz; iz++) {
    const z = izToZ(t, iz);
    for (let ix = 0; ix < t.nx; ix++) {
      const x = ixToX(t, ix);
      const pi = indexAt(t, ix, iz);
      let best: Nearest | null = null;
      let bestPath: GroomPath | null = null;
      for (const path of plan.groomPaths) {
        const near = nearestOnPath(x, z, path.points);
        if (near && near.dist <= path.bladeWidth / 2 && (!best || near.dist < best.dist)) {
          best = near;
          bestPath = path;
        }
      }
      const o = pi * 4;
      if (best && bestPath) {
        const passes = opsByPath.get(bestPath.id) ?? 1;
        data[o] = Math.round(255 * Math.min(1, 0.3 + 0.28 * passes));
        data[o + 1] = Math.round(255 * (best.dirX * 0.5 + 0.5));
        data[o + 2] = Math.round(255 * (best.dirZ * 0.5 + 0.5));
        data[o + 3] = Math.round(255 * Math.min(1, 0.25 + 0.22 * passes));
      } else {
        data[o] = 0;
        data[o + 1] = 128;
        data[o + 2] = 128;
        data[o + 3] = 0;
      }
    }
  }
  return data;
}

export function summarizeGroom(ops: GroomOp[]): {
  cut: number;
  fill: number;
  reused: number;
  haul: number;
  borrow: number;
} {
  return ops.reduce(
    (acc, o) => ({
      cut: acc.cut + o.cutVolume,
      fill: acc.fill + o.fillVolume,
      reused: acc.reused + o.reusedVolume,
      haul: acc.haul + o.haulVolume,
      borrow: acc.borrow + o.borrowVolume,
    }),
    { cut: 0, fill: 0, reused: 0, haul: 0, borrow: 0 },
  );
}
