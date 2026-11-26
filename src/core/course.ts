import type { Plan, PlacedFeature, SnowCondition } from './types';
import { CONDITION_INFO } from './types';
import {
  sampleSurface,
  type TerrainData,
} from './terrain';
import {
  getDef,
  jumpProfile,
  footprint,
  localToWorldXZ,
  featureBaseY,
  type JumpProfile,
} from './features';
import {
  solveFlight,
  rollSpeed,
  controlledRoll,
  brakingDistance,
  msToKmh,
  type FlightSolution,
  type RollSegment,
} from './physics';

export type Level = 'ok' | 'warn' | 'bad';

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

export interface SpacingInfo {
  toName: string;
  available: number;
  required: number;
  brakeDistance: number;
  setup: number;
  level: Level;
  message: string;
}

export interface JumpEval {
  featureId: string;
  profile: JumpProfile;
  baseY: number;
  lip: WorldPoint;
  takeoffSpeed: number;
  solution: FlightSolution;
  verdict: 'landing' | 'table' | 'runout' | 'beyond' | 'none';
  level: Level;
  title: string;
  message: string;
  /** 落点在落地坡上距其起点/终点的沿坡长度 */
  marginStart: number;
  marginEnd: number;
  landingWorld: WorldPoint | null;
  trajectoryWorld: WorldPoint[];
  efhLevel: Level;
}

export interface ChainRow {
  featureId: string;
  name: string;
  kind: string;
  arrivalSpeed: number;
  exitSpeed: number;
  stopped: boolean;
  speedLevel: Level;
  speedMessage: string;
  spacing?: SpacingInfo;
  jump?: JumpEval;
  anchor: WorldPoint;
  exit: WorldPoint;
}

export interface SafetyIssue {
  level: Level;
  featureId?: string;
  text: string;
}

export interface CourseReport {
  rows: ChainRow[];
  issues: SafetyIssue[];
  jumpEvals: JumpEval[];
  badCount: number;
  warnCount: number;
  maxEfh: number;
  allLandingOnSlope: boolean;
}

export function conditionMu(c: SnowCondition): number {
  return CONDITION_INFO[c].mu;
}

/** 滑手主动搓雪刹车时的等效摩擦（冰面抓不住，明显更低） */
export const BRAKE_MU: Record<SnowCondition, number> = {
  soft: 0.34,
  hard: 0.24,
  ice: 0.09,
};

/** 道具锚点世界坐标（f.x/f.z 即锚点水平位置，y 取该处雪面） */
export function featureAnchor(terrain: TerrainData, f: PlacedFeature): WorldPoint {
  return { x: f.x, y: sampleSurface(terrain, f.x, f.z), z: f.z };
}

function entrySOf(f: PlacedFeature): number {
  const fp = footprint(f);
  return fp.s0 + (f.kind === 'jump' ? 1 : 0); // jump footprint s0=-1，取约 0
}
function exitSOf(f: PlacedFeature): number {
  return footprint(f).s1 - (f.kind === 'jump' ? 2 : 0.5);
}

export function entryWorld(terrain: TerrainData, f: PlacedFeature): WorldPoint {
  const s = f.kind === 'jump' ? 0 : entrySOf(f);
  const p = localToWorldXZ(f, s, 0);
  return { x: p.x, z: p.z, y: sampleSurface(terrain, p.x, p.z) };
}
export function exitWorld(terrain: TerrainData, f: PlacedFeature): WorldPoint {
  const s = f.kind === 'jump' ? jumpProfile(f.params).endS : exitSOf(f);
  const p = localToWorldXZ(f, s, 0);
  return { x: p.x, z: p.z, y: sampleSurface(terrain, p.x, p.z) };
}

/** 沿两点直线采样雪面，生成滚雪路程段 */
export function terrainSegments(
  terrain: TerrainData,
  a: { x: number; z: number; y?: number },
  b: { x: number; z: number },
  mu: number,
  step = 2,
): RollSegment[] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(dist / step));
  const segs: RollSegment[] = [];
  let px = a.x;
  let pz = a.z;
  let py = a.y ?? sampleSurface(terrain, px, pz);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = a.x + dx * t;
    const z = a.z + dz * t;
    const y = sampleSurface(terrain, x, z);
    const ddx = x - px;
    const ddz = z - pz;
    segs.push({ ds: Math.hypot(ddx, ddz), dh: y - py, mu });
    px = x;
    pz = z;
    py = y;
  }
  return segs;
}

function smooth01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * 跳台实际骑行表面 = max(设计剖面, 自然雪面)。
 * 设计落地坡比自然坡陡，末端会埋入雪中，此时以自然雪面为准；
 * endS 之外再用 10m 平滑过渡，避免折点。
 */
function makeJumpSurface(
  plan: Plan,
  f: PlacedFeature,
  prof: JumpProfile,
  baseY: number,
): (s: number) => number {
  return (s: number) => {
    const designed = prof.surfaceY(s);
    const w = localToWorldXZ(f, s, 0);
    const terrainRel = sampleSurface(plan.terrain, w.x, w.z) - baseY;
    if (s < 0) return designed;
    if (s <= prof.endS) return Math.max(designed, terrainRel - 0.03);
    const t = smooth01((s - prof.endS) / 10);
    const blended = designed * (1 - t) + terrainRel * t;
    return Math.max(blended, terrainRel - 0.03);
  };
}

function evaluateJump(
  plan: Plan,
  f: PlacedFeature,
  takeoffSpeed: number,
): JumpEval {
  const prof = jumpProfile(f.params);
  const baseY = featureBaseY(plan.terrain, f);
  const lipLocal = { s: prof.lipS, y: prof.lipY };
  const lipW = localToWorldXZ(f, lipLocal.s, 0);
  const lip: WorldPoint = { x: lipW.x, y: baseY + lipLocal.y, z: lipW.z };
  const surface = makeJumpSurface(plan, f, prof, baseY);

  const solution = solveFlight({
    s0: prof.lipS,
    y0: prof.lipY,
    speed: takeoffSpeed,
    angleRad: prof.theta,
    surfaceY: surface,
    surfaceSlope: (s) => {
      const e = 0.2;
      return (surface(s + e) - surface(s - e)) / (2 * e);
    },
  });

  const trajectoryWorld: WorldPoint[] = solution.points.map((pt) => {
    const w = localToWorldXZ(f, pt.s, 0);
    return { x: w.x, y: baseY + pt.y, z: w.z };
  });

  let verdict: JumpEval['verdict'] = 'none';
  let level: Level = 'bad';
  let title = '无落点';
  let message = '未在限定时间内检测到落点';
  let marginStart = 0;
  let marginEnd = 0;
  let landingWorld: WorldPoint | null = null;
  let efhLevel: Level = 'ok';

  if (solution.landing) {
    const L = solution.landing;
    const cls = prof.classify(L.s);
    verdict = cls === 'beyond' ? 'beyond' : cls === 'kicker' ? 'none' : cls;
    const w = localToWorldXZ(f, L.s, 0);
    landingWorld = { x: w.x, y: baseY + L.y, z: w.z };

    const landAng = (f.params.landingAngle * Math.PI) / 180;
    if (cls === 'landing') {
      marginStart = (L.s - prof.landing.s0) / Math.max(1e-6, Math.cos(landAng));
      marginEnd = (prof.landing.s1 - L.s) / Math.max(1e-6, Math.cos(landAng));
      const tight = marginStart < 2 || marginEnd < 2;
      level = tight ? 'warn' : 'ok';
      title = tight ? '落点偏坡边' : '落点在落地坡上';
      message = `距坡首 ${marginStart.toFixed(1)}m、距坡尾 ${marginEnd.toFixed(1)}m（沿坡）`;
    } else if (cls === 'table') {
      level = 'bad';
      title = '落点砸在平台/台面上';
      message = `腾空距离不足，落在平台段，等效落高 ${L.efh.toFixed(2)}m，严禁开放`;
    } else if (cls === 'runout') {
      level = 'bad';
      title = '落点越过落地坡、砸在平缓冲区';
      message = `落地坡长度不足，冲到平段，冲击法向速度 ${L.normalImpact.toFixed(1)}m/s`;
    } else if (cls === 'beyond') {
      level = 'bad';
      title = '飞出落地坡与缓冲区';
      message = `速度过大或落地坡太短，落点已在道具之外`;
    } else {
      level = 'bad';
      title = '异常落点（起抛区）';
      message = '轨迹与起抛坡相交，请检查起跳角与速度';
    }

    if (L.efh >= 2.0) efhLevel = 'bad';
    else if (L.efh >= 1.3) efhLevel = 'warn';
  }

  return {
    featureId: f.id,
    profile: prof,
    baseY,
    lip,
    takeoffSpeed,
    solution,
    verdict,
    level,
    title,
    message,
    marginStart,
    marginEnd,
    landingWorld,
    trajectoryWorld,
    efhLevel,
  };
}

/** 全场速度串联 + 安全校核 */
export function evaluateCourse(plan: Plan): CourseReport {
  const terrain = plan.terrain;
  const mu = conditionMu(plan.condition);
  const ordered = plan.order
    .map((id) => plan.features.find((f) => f.id === id))
    .filter((f): f is PlacedFeature => !!f);

  const rows: ChainRow[] = [];
  const issues: SafetyIssue[] = [];
  const jumpEvals: JumpEval[] = [];

  if (!ordered.length) {
    return { rows, issues, jumpEvals, badCount: 0, warnCount: 0, maxEfh: 0, allLandingOnSlope: true };
  }

  // startSpeed 即首个道具入口处的出发/入台速度
  let cursor: WorldPoint = entryWorld(terrain, ordered[0]);
  let v = plan.startSpeed;

  for (let i = 0; i < ordered.length; i++) {
    const f = ordered[i];
    const def = getDef(f.type);
    const anchor = featureAnchor(terrain, f);
    const entry = entryWorld(terrain, f);

    // 连接段：自然雪面。滑手会主动把速度控制在该道具建议区间的中值附近
    const conn = terrainSegments(terrain, cursor, entry, mu);
    const targetMid = (def.speedRangeKmh[0] + def.speedRangeKmh[1]) / 2 / 3.6;
    const ctrl = controlledRoll(v, conn, {
      muGlide: mu,
      muBrake: BRAKE_MU[plan.condition],
      targetSpeed: targetMid,
    });
    v = ctrl.endSpeed;
    let stopped = false;

    const arrivalSpeed = v;
    let jumpEval: JumpEval | undefined;

    // 道具内部
    if (!stopped) {
      if (f.kind === 'jump') {
        const prof = jumpProfile(f.params);
        const kick = rollSpeed(v, [{ ds: prof.lipS, dh: prof.lipY, mu }]);
        v = kick.endSpeed;
        if (kick.stopped) stopped = true;
        const takeoff = v;
        jumpEval = evaluateJump(plan, f, takeoff);
        jumpEvals.push(jumpEval);
        if (jumpEval.solution.landing) {
          // 落地冲击后只保留沿坡切向速度，压缩损失 3%
          v = jumpEval.solution.landing.tangentSpeed * 0.97;
          const landS = jumpEval.solution.landing.s;
          const tail = rollSpeed(v, [
            { ds: Math.max(0.1, prof.endS - landS), dh: prof.endY - jumpEval.solution.landing.y, mu },
          ]);
          v = tail.endSpeed;
        }
        if (jumpEval.level === 'bad') {
          issues.push({ level: 'bad', featureId: f.id, text: `${f.name}：${jumpEval.title}` });
        } else if (jumpEval.level === 'warn') {
          issues.push({ level: 'warn', featureId: f.id, text: `${f.name}：${jumpEval.title}` });
        }
        if (jumpEval.efhLevel !== 'ok' && jumpEval.solution.landing) {
          issues.push({
            level: jumpEval.efhLevel,
            featureId: f.id,
            text: `${f.name}：等效落高 ${jumpEval.solution.landing.efh.toFixed(2)}m 偏高`,
          });
        }
      } else if (f.kind === 'box' || f.kind === 'rail') {
        const L = f.params.length ?? 6;
        let dh = 0;
        if (f.kind === 'rail' && f.params.drop) dh = -f.params.drop;
        else {
          const a = localToWorldXZ(f, -L / 2, 0);
          const b = localToWorldXZ(f, L / 2, 0);
          dh = sampleSurface(terrain, b.x, b.z) - sampleSurface(terrain, a.x, a.z);
        }
        const r = rollSpeed(v, [{ ds: L, dh, mu: def.friction }]);
        v = r.endSpeed;
      } else if (f.kind === 'stairs') {
        const run = (f.params.steps ?? 5) * (f.params.stepDepth ?? 0.38);
        const drop = (f.params.steps ?? 5) * (f.params.stepHeight ?? 0.18);
        const r = rollSpeed(v, [{ ds: run, dh: -drop, mu: def.friction }]);
        v = r.endSpeed;
      } else if (f.kind === 'halfpipe') {
        const L = f.params.length ?? 80;
        const a = localToWorldXZ(f, -L / 2, 0);
        const b = localToWorldXZ(f, L / 2, 0);
        const dh = sampleSurface(terrain, b.x, b.z) - sampleSurface(terrain, a.x, a.z);
        const r = rollSpeed(v, [{ ds: L, dh, mu: def.friction }]);
        v = r.endSpeed;
      }
    }

    const exit = exitWorld(terrain, f);

    // 速度窗口校核
    const [vminKmh, vmaxKmh] = def.speedRangeKmh;
    const kmh = msToKmh(arrivalSpeed);
    let speedLevel: Level = 'ok';
    let speedMessage = `入台 ${kmh.toFixed(0)} km/h，设计区间 ${vminKmh}–${vmaxKmh}`;
    if (stopped) {
      speedLevel = 'bad';
      speedMessage = '在上坡/软雪中停住，无法到达道具';
      issues.push({ level: 'bad', featureId: f.id, text: `${f.name}：速度不足，中途停住` });
    } else if (kmh > vmaxKmh * 1.08) {
      speedLevel = 'bad';
      speedMessage = `入台 ${kmh.toFixed(0)} km/h 过快（上限 ${vmaxKmh}）`;
      issues.push({ level: 'bad', featureId: f.id, text: `${f.name}：入台速度 ${kmh.toFixed(0)} 超过上限` });
    } else if (kmh < vminKmh * 0.9) {
      speedLevel = 'warn';
      speedMessage = `入台 ${kmh.toFixed(0)} km/h 偏慢（下限 ${vminKmh}）`;
      issues.push({ level: 'warn', featureId: f.id, text: `${f.name}：入台速度偏慢` });
    } else if (kmh > vmaxKmh || kmh < vminKmh) {
      speedLevel = 'warn';
      speedMessage = `入台 ${kmh.toFixed(0)} km/h 接近设计区间边缘`;
    }

    // 与下一个道具的间距/速度衔接
    let spacing: SpacingInfo | undefined;
    const nf = ordered[i + 1];
    if (nf) {
      const nextEntry = entryWorld(terrain, nf);
      const origin =
        f.kind === 'jump' && jumpEval?.landingWorld ? jumpEval.landingWorld : exit;
      const seg = terrainSegments(terrain, origin, nextEntry, mu);
      const available = seg.reduce((s, q) => s + Math.hypot(q.ds, q.dh), 0);
      const totalDh = seg.reduce((s, q) => s + q.dh, 0);
      const grade = totalDh / Math.max(1, seg.reduce((s, q) => s + q.ds, 0));
      const nextDef = getDef(nf.type);
      const targetV = nextDef.speedRangeKmh[1] / 3.6;
      const brake = brakingDistance(v, BRAKE_MU[plan.condition], grade, targetV);
      const setup = 7 + v * 0.8;
      const required = setup + (Number.isFinite(brake) ? brake : 200);
      let level: Level = 'ok';
      let message = `间距 ${available.toFixed(0)}m，需求约 ${required.toFixed(0)}m`;
      if (!Number.isFinite(brake)) {
        level = 'bad';
        message = `下坡/冰面无法在间距内降到 ${nextDef.speedRangeKmh[1]} km/h 以下`;
      } else if (available < required * 0.7) {
        level = 'bad';
        message = `间距不足：可用 ${available.toFixed(0)}m < 安全需求 ${required.toFixed(0)}m`;
      } else if (available < required) {
        level = 'warn';
        message = `间距偏紧：${available.toFixed(0)}m / 建议 ${required.toFixed(0)}m`;
      }
      spacing = {
        toName: nf.name,
        available,
        required,
        brakeDistance: Number.isFinite(brake) ? brake : Infinity,
        setup,
        level,
        message,
      };
      if (level !== 'ok')
        issues.push({ level, featureId: f.id, text: `${f.name} → ${nf.name}：${message}` });
    }

    rows.push({
      featureId: f.id,
      name: f.name,
      kind: f.kind,
      arrivalSpeed,
      exitSpeed: v,
      stopped,
      speedLevel,
      speedMessage,
      spacing,
      jump: jumpEval,
      anchor,
      exit,
    });

    cursor = exit;
  }

  const badCount = issues.filter((i) => i.level === 'bad').length;
  const warnCount = issues.filter((i) => i.level === 'warn').length;
  const maxEfh = jumpEvals.reduce((m, j) => Math.max(m, j.solution.landing?.efh ?? 0), 0);
  const allLandingOnSlope = jumpEvals.every((j) => j.verdict === 'landing');

  return { rows, issues, jumpEvals, badCount, warnCount, maxEfh, allLandingOnSlope };
}

export interface PovSample extends WorldPoint {
  t: number;
}

/** 生成第一人称贴地滑行路径（飞行点 + 落地后沿坡减速），带时间轴 */
export function buildPovPath(
  plan: Plan,
  jump: JumpEval,
): PovSample[] {
  const path: PovSample[] = jump.trajectoryWorld.map((p, i) => ({
    ...p,
    t: jump.solution.points[i]?.t ?? i / 60,
  }));
  const f = plan.features.find((q) => q.id === jump.featureId);
  if (!f || !jump.solution.landing) return path;
  const mu = conditionMu(plan.condition);
  let s = jump.solution.landing.s;
  let v = jump.solution.landing.tangentSpeed;
  let t = jump.solution.landing.t;
  const step = 1.5;
  for (let i = 0; i < 160 && v > 0.6; i++) {
    const grade = -0.18; // 缓冲区近似缓坡
    const r = rollSpeed(v, [{ ds: step, dh: grade * step, mu }]);
    const vNext = r.endSpeed;
    const vMean = Math.max(0.5, (v + vNext) / 2);
    t += step / vMean;
    v = vNext;
    s += step;
    const w = localToWorldXZ(f, s, 0);
    path.push({
      x: w.x,
      y: sampleSurface(plan.terrain, w.x, w.z) + 0.2,
      z: w.z,
      t,
    });
    if (r.stopped) break;
  }
  return path;
}
