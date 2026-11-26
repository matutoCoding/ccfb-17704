// 全局共享类型：地形、道具、方案、施工记录

export type PageId = 'terrain' | 'library' | 'park' | 'groom' | 'flight' | 'compare';

export type SnowCondition = 'soft' | 'hard' | 'ice';

export type FeatureKind = 'jump' | 'box' | 'rail' | 'halfpipe' | 'stairs';

/** 高程网格地形。索引 iz * nx + ix，x 沿雪道前进方向（下坡），z 横向 */
export interface TerrainData {
  name: string;
  nx: number;
  nz: number;
  width: number; // x 方向长度（米）
  depth: number; // z 方向宽度（米）
  originX: number; // 最小角点 x
  originZ: number; // 最小角点 z
  /** 地表基岩/原始地面高程 */
  ground: Float32Array;
  /** 雪层厚度（独立一层），实际雪面 = ground + snow */
  snow: Float32Array;
}

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export interface FeatureDef {
  type: string;
  kind: FeatureKind;
  name: string;
  size: string;
  description: string;
  params: Record<string, number>;
  paramSpecs: ParamSpec[];
  /** 建议入台速度 km/h [min,max] */
  speedRangeKmh: [number, number];
  /** 道具表面摩擦系数 */
  friction: number;
}

export interface PlacedFeature {
  id: string;
  type: string;
  kind: FeatureKind;
  name: string;
  x: number;
  z: number;
  /** 绕 Y 轴弧度，约定 forward=(cos yaw, 0, -sin yaw)，与 three rotation.y 一致 */
  yaw: number;
  params: Record<string, number>;
}

export interface GroomPath {
  id: string;
  name: string;
  points: { x: number; z: number }[];
  bladeWidth: number;
  cutPerPass: number; // 每层推铲切深 m
}

export interface HaulBlob {
  x: number;
  z: number;
  v: number;
}

/** 一次推铲作业（一层）的挖填与调运记录 */
export interface GroomOp {
  id: string;
  pathId: string;
  pathName: string;
  layer: number;
  at: number;
  cutPerPass: number;
  bladeWidth: number;
  cutVolume: number;
  fillVolume: number;
  reusedVolume: number;
  haulVolume: number; // 推到路线末端集雪堆的量
  borrowVolume: number; // 从取雪点借入的量
  cutArea: number;
  fillArea: number;
  sources: HaulBlob[];
  destinations: HaulBlob[];
  centroidCut: { x: number; z: number };
  centroidFill: { x: number; z: number };
  stockpile: { x: number; z: number };
}

export interface Plan {
  id: string;
  name: string;
  updatedAt: number;
  seeded?: boolean;
  condition: SnowCondition;
  /** 出发速度 m/s */
  startSpeed: number;
  terrain: TerrainData;
  /** 导入时的原始雪厚，用于逐层回放/重置 */
  snowOriginal: Float32Array;
  features: PlacedFeature[];
  /** 雪道串联顺序，元素为 feature id */
  order: string[];
  groomPaths: GroomPath[];
  groomOps: GroomOp[];
}

export const CONDITION_INFO: Record<
  SnowCondition,
  { label: string; mu: number; color: string; desc: string }
> = {
  soft: { label: '软雪', mu: 0.1, color: '#9fd8ff', desc: '新雪/春雪，摩擦大 0.10' },
  hard: { label: '硬雪', mu: 0.045, color: '#dcecff', desc: '压雪车压实，摩擦 0.045' },
  ice: { label: '冰面', mu: 0.018, color: '#bff4ff', desc: '结冰/亮冰面，摩擦 0.018' },
};
