import type { FeatureDef, FeatureKind, ParamSpec, PlacedFeature } from './types';
import { sampleSurface, type TerrainData } from './terrain';

const p = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  unit?: string,
): ParamSpec => ({ key, label, min, max, step, unit });

export const FEATURE_DEFS: FeatureDef[] = [
  {
    type: 'jump-small',
    kind: 'jump',
    name: '小型跳台',
    size: 'S',
    description: '初级公园包，适合练起跳与小腾空',
    speedRangeKmh: [20, 30],
    friction: 0.06,
    params: {
      takeoffAngle: 14,
      lipHeight: 0.4,
      tableLength: 1.5,
      tableDown: 2,
      landingAngle: 32,
      landingLength: 12,
      runoutLength: 12,
      width: 4,
    },
    paramSpecs: [
      p('takeoffAngle', '起跳角', 5, 40, 0.5, '°'),
      p('lipHeight', '台高', 0.2, 6, 0.1, 'm'),
      p('tableLength', '平台长', 0, 25, 0.5, 'm'),
      p('tableDown', '平台俯角', 0, 20, 0.5, '°'),
      p('landingAngle', '落地坡角', 15, 42, 0.5, '°'),
      p('landingLength', '落地坡长', 4, 35, 0.5, 'm'),
      p('runoutLength', '缓冲区长度', 4, 40, 1, 'm'),
      p('width', '台宽', 2, 14, 0.5, 'm'),
    ],
  },
  {
    type: 'jump-medium',
    kind: 'jump',
    name: '中型跳台',
    size: 'M',
    description: '标准地形公园台，腾空约 1 秒',
    speedRangeKmh: [30, 42],
    friction: 0.05,
    params: {
      takeoffAngle: 12,
      lipHeight: 0.6,
      tableLength: 1.5,
      tableDown: 2,
      landingAngle: 32,
      landingLength: 16,
      runoutLength: 16,
      width: 6,
    },
    paramSpecs: [
      p('takeoffAngle', '起跳角', 5, 40, 0.5, '°'),
      p('lipHeight', '台高', 0.2, 8, 0.1, 'm'),
      p('tableLength', '平台长', 0, 30, 0.5, 'm'),
      p('tableDown', '平台俯角', 0, 20, 0.5, '°'),
      p('landingAngle', '落地坡角', 15, 42, 0.5, '°'),
      p('landingLength', '落地坡长', 4, 40, 0.5, 'm'),
      p('runoutLength', '缓冲区长度', 4, 50, 1, 'm'),
      p('width', '台宽', 2, 16, 0.5, 'm'),
    ],
  },
  {
    type: 'jump-large',
    kind: 'jump',
    name: '大型跳台',
    size: 'L',
    description: '高阶大包，需要足够速度与落地坡长度',
    speedRangeKmh: [42, 60],
    friction: 0.045,
    params: {
      takeoffAngle: 12,
      lipHeight: 1.5,
      tableLength: 5,
      tableDown: 3,
      landingAngle: 32,
      landingLength: 22,
      runoutLength: 20,
      width: 8,
    },
    paramSpecs: [
      p('takeoffAngle', '起跳角', 5, 45, 0.5, '°'),
      p('lipHeight', '台高', 0.5, 10, 0.1, 'm'),
      p('tableLength', '平台长', 0, 40, 0.5, 'm'),
      p('tableDown', '平台俯角', 0, 20, 0.5, '°'),
      p('landingAngle', '落地坡角', 15, 45, 0.5, '°'),
      p('landingLength', '落地坡长', 4, 50, 0.5, 'm'),
      p('runoutLength', '缓冲区长度', 4, 60, 1, 'm'),
      p('width', '台宽', 2, 20, 0.5, 'm'),
    ],
  },
  {
    type: 'box-flat',
    kind: 'box',
    name: '平地箱',
    size: 'BOX',
    description: '宽面箱子，适合练 boardslide',
    speedRangeKmh: [15, 28],
    friction: 0.045,
    params: { length: 6, width: 0.7, height: 0.45 },
    paramSpecs: [
      p('length', '长度', 2, 14, 0.5, 'm'),
      p('width', '宽度', 0.3, 1.5, 0.05, 'm'),
      p('height', '高度', 0.2, 1.2, 0.05, 'm'),
    ],
  },
  {
    type: 'box-long',
    kind: 'box',
    name: '长条箱',
    size: 'BOX-L',
    description: '8 米长箱，考验平衡',
    speedRangeKmh: [18, 32],
    friction: 0.04,
    params: { length: 9, width: 0.5, height: 0.55 },
    paramSpecs: [
      p('length', '长度', 2, 18, 0.5, 'm'),
      p('width', '宽度', 0.3, 1.5, 0.05, 'm'),
      p('height', '高度', 0.2, 1.4, 0.05, 'm'),
    ],
  },
  {
    type: 'rail-flat',
    kind: 'rail',
    name: '平铁杆',
    size: 'RAIL',
    description: '圆管平杆，带支架',
    speedRangeKmh: [15, 28],
    friction: 0.028,
    params: { length: 7, height: 0.55, radius: 0.055 },
    paramSpecs: [
      p('length', '长度', 2, 16, 0.5, 'm'),
      p('height', '杆高', 0.25, 1.1, 0.05, 'm'),
      p('radius', '管径', 0.03, 0.12, 0.005, 'm'),
    ],
  },
  {
    type: 'rail-down',
    kind: 'rail',
    name: '下坡杆',
    size: 'D-RAIL',
    description: '随坡下降的扶手杆',
    speedRangeKmh: [18, 32],
    friction: 0.025,
    params: { length: 8, height: 0.7, radius: 0.055, drop: 1.4 },
    paramSpecs: [
      p('length', '长度', 2, 18, 0.5, 'm'),
      p('height', '上端高度', 0.3, 1.3, 0.05, 'm'),
      p('radius', '管径', 0.03, 0.12, 0.005, 'm'),
      p('drop', '末端落差', 0, 4, 0.1, 'm'),
    ],
  },
  {
    type: 'halfpipe-standard',
    kind: 'halfpipe',
    name: '标准 U 型池',
    size: 'HP',
    description: '圆弧过渡 + 平底 + 垂直段',
    speedRangeKmh: [20, 45],
    friction: 0.05,
    params: { length: 90, radius: 5.5, flatWidth: 5, vertHeight: 0.8, deckWidth: 2.5 },
    paramSpecs: [
      p('length', '池长', 30, 180, 2, 'm'),
      p('radius', '过渡半径', 3, 9, 0.1, 'm'),
      p('flatWidth', '平底宽', 2, 10, 0.1, 'm'),
      p('vertHeight', '垂直段高', 0, 2.5, 0.1, 'm'),
      p('deckWidth', '池沿平台', 1, 5, 0.1, 'm'),
    ],
  },
  {
    type: 'stairs-6',
    kind: 'stairs',
    name: '6 级台阶',
    size: 'STAIR6',
    description: '街道台阶段，可带扶手',
    speedRangeKmh: [15, 26],
    friction: 0.06,
    params: { steps: 6, stepHeight: 0.18, stepDepth: 0.38, width: 3, rail: 1, railHeight: 0.95 },
    paramSpecs: [
      p('steps', '台阶数', 2, 20, 1, '级'),
      p('stepHeight', '每级高', 0.1, 0.28, 0.01, 'm'),
      p('stepDepth', '踏面深', 0.25, 0.6, 0.01, 'm'),
      p('width', '台阶宽', 1.5, 8, 0.1, 'm'),
      p('rail', '带扶手(1/0)', 0, 1, 1, ''),
      p('railHeight', '扶手高', 0.6, 1.3, 0.05, 'm'),
    ],
  },
  {
    type: 'stairs-10',
    kind: 'stairs',
    name: '10 级大台阶',
    size: 'STAIR10',
    description: '高阶街道道具，配合铁杆',
    speedRangeKmh: [20, 34],
    friction: 0.06,
    params: { steps: 10, stepHeight: 0.19, stepDepth: 0.4, width: 3.5, rail: 1, railHeight: 1.0 },
    paramSpecs: [
      p('steps', '台阶数', 2, 25, 1, '级'),
      p('stepHeight', '每级高', 0.1, 0.28, 0.01, 'm'),
      p('stepDepth', '踏面深', 0.25, 0.6, 0.01, 'm'),
      p('width', '台阶宽', 1.5, 8, 0.1, 'm'),
      p('rail', '带扶手(1/0)', 0, 1, 1, ''),
      p('railHeight', '扶手高', 0.6, 1.3, 0.05, 'm'),
    ],
  },
];

const DEF_MAP = new Map(FEATURE_DEFS.map((d) => [d.type, d]));
export function getDef(type: string): FeatureDef {
  const d = DEF_MAP.get(type);
  if (!d) throw new Error(`未知道具类型: ${type}`);
  return d;
}

export function kindLabel(kind: FeatureKind): string {
  return { jump: '跳台', box: '箱子', rail: '铁杆', halfpipe: 'U型池', stairs: '台阶' }[kind];
}

export function createFeature(type: string, x: number, z: number): PlacedFeature {
  const def = getDef(type);
  return {
    id: `f_${Math.random().toString(36).slice(2, 9)}`,
    type,
    kind: def.kind,
    name: def.name,
    x,
    z,
    yaw: 0,
    params: { ...def.params },
  };
}

// ---------------- 跳台剖面（物理 + 几何唯一数据源） ----------------

export type JumpSegKind = 'kicker' | 'table' | 'landing' | 'runout';

export interface ProfileSeg {
  kind: JumpSegKind;
  s0: number;
  s1: number;
  y0: number;
  y1: number;
  slope: number; // dy/ds（水平坐标 s）
}

export interface JumpProfile {
  theta: number;
  run: number; // 起抛坡水平长度
  toeS: number; // 原点即坡趾 0
  toeY: number;
  lipS: number;
  lipY: number;
  table: ProfileSeg;
  landing: ProfileSeg;
  runout: ProfileSeg;
  endS: number;
  endY: number;
  segments: ProfileSeg[];
  surfaceY: (s: number) => number;
  classify: (s: number) => JumpSegKind | 'beyond';
  landingHorizontal: number;
}

/**
 * 跳台纵剖面，原点 (s=0,y=0) 为起抛坡趾点（贴地锚点）。
 * s 沿前进方向水平计，y 相对坡趾向上。几何与落点判定共用此函数。
 */
export function jumpProfile(params: Record<string, number>): JumpProfile {
  const theta = (params.takeoffAngle * Math.PI) / 180;
  const h = params.lipHeight;
  const Ltab = params.tableLength;
  const tabDown = ((params.tableDown ?? 0) * Math.PI) / 180;
  const landAng = (params.landingAngle * Math.PI) / 180;
  const Lland = params.landingLength;
  const Lrun = params.runoutLength ?? 12;

  const run = h / Math.tan(Math.max(theta, 0.02));
  const toeS = 0;
  const toeY = 0;
  const lipS = run;
  const lipY = h;

  const kicker: ProfileSeg = {
    kind: 'kicker',
    s0: 0,
    s1: run,
    y0: 0,
    y1: h,
    slope: Math.tan(theta),
  };

  const tabH = Ltab * Math.cos(tabDown);
  const tabDrop = Ltab * Math.sin(tabDown);
  const table: ProfileSeg = {
    kind: 'table',
    s0: run,
    s1: run + tabH,
    y0: h,
    y1: h - tabDrop,
    slope: tabH > 1e-6 ? -tabDrop / tabH : 0,
  };

  const landH = Lland * Math.cos(landAng);
  const landDrop = Lland * Math.sin(landAng);
  const landing: ProfileSeg = {
    kind: 'landing',
    s0: table.s1,
    s1: table.s1 + landH,
    y0: table.y1,
    y1: table.y1 - landDrop,
    slope: -Math.tan(landAng),
  };

  const runout: ProfileSeg = {
    kind: 'runout',
    s0: landing.s1,
    s1: landing.s1 + Lrun,
    y0: landing.y1,
    y1: landing.y1,
    slope: 0,
  };

  const segments = [kicker, table, landing, runout];
  const endS = runout.s1;
  const endY = runout.y1;

  const surfaceY = (s: number): number => {
    if (s <= 0) return kicker.slope * s;
    for (const seg of segments) {
      if (s <= seg.s1 + 1e-9) {
        const t = (s - seg.s0) / Math.max(seg.s1 - seg.s0, 1e-9);
        return seg.y0 + (seg.y1 - seg.y0) * t;
      }
    }
    return endY;
  };

  const classify = (s: number): JumpSegKind | 'beyond' => {
    if (s < run - 1e-7) return 'kicker';
    if (s <= table.s1 + 1e-7) return 'table';
    if (s <= landing.s1 + 1e-7) return 'landing';
    if (s <= runout.s1 + 1e-7) return 'runout';
    return 'beyond';
  };

  return {
    theta,
    run,
    toeS,
    toeY,
    lipS,
    lipY,
    table,
    landing,
    runout,
    endS,
    endY,
    segments,
    surfaceY,
    classify,
    landingHorizontal: landH,
  };
}

/**
 * 道具贴地基准高程。跳台陡落地坡末端会切入缓自然坡，
 * 实际表面由 course.makeJumpSurface 取 max(设计剖面, 自然雪面)，
 * 埋入段由自然雪面接管，因此这里不做整体抬升（避免坡趾出现台阶）。
 */
export function featureBaseY(terrain: TerrainData, f: PlacedFeature): number {
  return sampleSurface(terrain, f.x, f.z);
}

/** 道具在局部坐标（s 前后、w 左右）的占地范围 */
export function footprint(
  f: PlacedFeature,
): { s0: number; s1: number; w0: number; w1: number } {
  const q = f.params;
  switch (f.kind) {
    case 'jump': {
      const prof = jumpProfile(q);
      const hw = (q.width ?? 5) / 2;
      return { s0: prof.toeS - 1, s1: prof.endS + 2, w0: -hw - 0.5, w1: hw + 0.5 };
    }
    case 'box':
    case 'rail': {
      const L = q.length ?? 6;
      const w = (q.width ?? 0.4) / 2 + 0.4;
      return { s0: -L / 2 - 0.5, s1: L / 2 + 0.5, w0: -w, w1: w };
    }
    case 'stairs': {
      const run = (q.steps ?? 5) * (q.stepDepth ?? 0.35);
      const hw = (q.width ?? 3) / 2 + 0.4;
      return { s0: -0.5, s1: run + 1.2, w0: -hw, w1: hw };
    }
    case 'halfpipe': {
      const L = q.length ?? 80;
      const r = q.radius ?? 5;
      const fw = q.flatWidth ?? 5;
      const d = q.deckWidth ?? 2;
      const halfW = fw / 2 + r + d;
      return { s0: -L / 2, s1: L / 2, w0: -halfW, w1: halfW };
    }
  }
}

/** 局部 (s,w) -> 世界 x,z（yaw 约定见 types） */
export function localToWorldXZ(
  f: PlacedFeature,
  s: number,
  w: number,
): { x: number; z: number } {
  const c = Math.cos(f.yaw);
  const sn = Math.sin(f.yaw);
  return { x: f.x + s * c + w * sn, z: f.z - s * sn + w * c };
}

export function worldToLocalSW(
  f: PlacedFeature,
  x: number,
  z: number,
): { s: number; w: number } {
  const dx = x - f.x;
  const dz = z - f.z;
  const c = Math.cos(f.yaw);
  const sn = Math.sin(f.yaw);
  // 逆变换（旋转矩阵转置）
  const s = dx * c - dz * sn;
  const w = dx * sn + dz * c;
  return { s, w };
}
