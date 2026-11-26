// 腾空轨迹与速度串联物理核心
// 坐标系：s = 沿雪道前进方向的水平距离，y = 竖直向上。单位 m / s。
// 空气阻力采用二次模型 a_drag = -k * |v| * v，k = 0.5*rho*CdA/mass (1/m)。

export const G = 9.81;

/** 滑雪者典型空气阻力系数 k (1/m) */
export function dragKOf(rho = 1.2, cdA = 0.55, mass = 80): number {
  return (0.5 * rho * cdA) / mass;
}
export const DEFAULT_DRAG_K = dragKOf(); // ≈ 0.0041

export const msToKmh = (v: number) => v * 3.6;
export const kmhToMs = (v: number) => v / 3.6;

export interface FlightOptions {
  g?: number;
  dragK?: number;
  dt?: number;
  maxTime?: number;
}

export interface FlightPoint {
  t: number;
  s: number;
  y: number;
  vs: number;
  vy: number;
}

export interface LandingInfo extends FlightPoint {
  speed: number;
  angleDeg: number; // 落地速度方向角（负值朝下）
  slope: number; // 落地表面 dy/ds
  normalImpact: number; // 垂直于坡面的冲击速度 m/s
  tangentSpeed: number; // 沿坡面切向保留速度 m/s
  efh: number; // 等效落差 Equivalent Fall Height = vn^2/(2g)
  verticalDrop: number; // 相对起跳点的垂直落差
}

export interface FlightSolution {
  points: FlightPoint[];
  landing: LandingInfo | null;
  apexS: number;
  apexY: number;
  maxGap: number;
}

type State4 = [number, number, number, number]; // s,y,vs,vy

function deriv(st: State4, k: number, g: number): State4 {
  const [, , vs, vy] = st;
  const speed = Math.hypot(vs, vy);
  return [vs, vy, -k * speed * vs, -g - k * speed * vy];
}

/** 经典 RK4 推进一步（步长 h 可为任意小，供二分求根反复调用） */
function rk4Step(st: State4, h: number, k: number, g: number): State4 {
  const k1 = deriv(st, k, g);
  const s2: State4 = [
    st[0] + (h / 2) * k1[0],
    st[1] + (h / 2) * k1[1],
    st[2] + (h / 2) * k1[2],
    st[3] + (h / 2) * k1[3],
  ];
  const k2 = deriv(s2, k, g);
  const s3: State4 = [
    st[0] + (h / 2) * k2[0],
    st[1] + (h / 2) * k2[1],
    st[2] + (h / 2) * k2[2],
    st[3] + (h / 2) * k2[3],
  ];
  const k3 = deriv(s3, k, g);
  const s4: State4 = [
    st[0] + h * k3[0],
    st[1] + h * k3[1],
    st[2] + h * k3[2],
    st[3] + h * k3[3],
  ];
  const k4 = deriv(s4, k, g);
  return [
    st[0] + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    st[1] + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    st[2] + (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
    st[3] + (h / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]),
  ];
}

function stateToPoint(st: State4, t: number): FlightPoint {
  return { t, s: st[0], y: st[1], vs: st[2], vy: st[3] };
}

/**
 * 求解腾空轨迹。
 * @param speed 起跳速度大小 m/s
 * @param angleRad 起跳角（相对水平，向上为正）
 * @param surfaceY 落地表面高度函数（与 y0 同一基准）
 */
export function solveFlight(
  args: {
    speed: number;
    angleRad: number;
    y0?: number;
    s0?: number;
    surfaceY: (s: number) => number;
    surfaceSlope?: (s: number) => number;
  },
  opts: FlightOptions = {},
): FlightSolution {
  const g = opts.g ?? G;
  const k = opts.dragK ?? DEFAULT_DRAG_K;
  const dt = opts.dt ?? 1 / 240;
  const maxTime = opts.maxTime ?? 12;

  const s0 = args.s0 ?? 0;
  const y0 = args.y0 ?? 0;
  const angle = args.angleRad;
  let st: State4 = [s0, y0, args.speed * Math.cos(angle), args.speed * Math.sin(angle)];
  let t = 0;

  const points: FlightPoint[] = [stateToPoint(st, 0)];
  let apexS = s0;
  let apexY = y0;
  let maxGap = 0;
  let landing: LandingInfo | null = null;
  let airborne = false;

  const gapOf = (s: State4) => s[1] - args.surfaceY(s[0]);

  // 连续碰撞检测：每个整步内再扫 SUB 个偏移，防止在折点（台沿/落地坡起点）处
  // “穿过”表面后又因坡面陡降回到表面上方而漏判第一次撞击。
  const SUB = 12;

  while (t < maxTime) {
    const prev = st;
    const prevT = t;
    const full = rk4Step(prev, dt, k, g);

    let hitHi = -1;
    let bracketLo = 0;
    for (let m = 1; m <= SUB; m++) {
      const h = (dt * m) / SUB;
      const sm = m === SUB ? full : rk4Step(prev, h, k, g);
      const gap = gapOf(sm);
      maxGap = Math.max(maxGap, gap);
      if (gap > 1e-4) airborne = true;
      if (airborne && gap <= 0) {
        hitHi = h;
        break;
      }
      bracketLo = h;
    }

    st = full;
    t += dt;
    if (st[1] > apexY) {
      apexY = st[1];
      apexS = st[0];
    }
    points.push(stateToPoint(st, t));

    if (hitHi >= 0) {
      // 在 [bracketLo, hitHi] 内二分求最早根
      let lo = bracketLo;
      let hi = hitHi;
      for (let it = 0; it < 32; it++) {
        const mid = (lo + hi) / 2;
        const sm = rk4Step(prev, mid, k, g);
        if (gapOf(sm) > 0) lo = mid;
        else hi = mid;
      }
      const hRoot = (lo + hi) / 2;
      const root = rk4Step(prev, hRoot, k, g);
      const rootT = prevT + hRoot;
      const slope = args.surfaceSlope
        ? args.surfaceSlope(root[0])
        : finiteSlope(args.surfaceY, root[0]);
      const [, , vs, vy] = root;
      const speed = Math.hypot(vs, vy);
      const nLen = Math.hypot(slope, 1);
      // 上法线 n = (-slope, 1)/len；落入坡面时 v·n < 0
      const normalDot = (-slope * vs + vy) / nLen;
      const normalImpact = Math.max(0, -normalDot);
      const tangentSpeed = (vs + slope * vy) / nLen; // v·t, t=(1,slope)/len
      landing = {
        ...stateToPoint(root, rootT),
        speed,
        angleDeg: (Math.atan2(vy, vs) * 180) / Math.PI,
        slope,
        normalImpact,
        tangentSpeed: Math.max(0, tangentSpeed),
        efh: (normalImpact * normalImpact) / (2 * g),
        verticalDrop: y0 - root[1],
      };
      points[points.length - 1] = stateToPoint(root, rootT);
      break;
    }

    // 安全保护：异常下坠且远超雪道
    if (st[1] < y0 - 400) break;
  }

  return { points, landing, apexS, apexY, maxGap };
}

function finiteSlope(f: (s: number) => number, s: number): number {
  const e = 0.25;
  return (f(s + e) - f(s - e)) / (2 * e);
}

/**
 * 高精度参考解：极小步长 RK4 + 40 次二分。
 * 用于物理精度自检与单元测试，不作为每帧渲染路径。
 */
export function solveFlightReference(
  args: Parameters<typeof solveFlight>[0],
  opts: FlightOptions = {},
): FlightSolution {
  return solveFlight(args, { ...opts, dt: opts.dt ?? 1 / 6000, maxTime: opts.maxTime ?? 12 });
}

// ---------------- 贴地速度串联 ----------------

export interface RollSegment {
  ds: number; // 水平距离 m（>0）
  dh: number; // 高程变化（终点-起点，下坡为负）
  mu: number; // 摩擦系数
}

/**
 * 沿路程积分速度（按弧长 l 积分）。
 * 每个 segment 给出水平位移 ds 与高程变化 dh（下坡 dh<0）。
 * 令 u=v^2，sinθ=dh/L、cosθ=ds/L，L=hypot(ds,dh)：
 *   du/dl = 2(-g·sinθ - μ·g·cosθ - k·u)
 * RK4 子步长 ≤0.5m。若速度归零且驱动力不为正，判定停止。
 */
export function rollSpeed(
  v0: number,
  segments: RollSegment[],
  dragK: number = DEFAULT_DRAG_K,
  g: number = G,
): { endSpeed: number; segEndSpeeds: number[]; stopped: boolean; stopDistance: number; distances: number[] } {
  let u = Math.max(0, v0) ** 2;
  let travelled = 0;
  const segEndSpeeds: number[] = [];
  const distances: number[] = [];
  let stopped = false;
  let stopDistance = -1;

  for (const seg of segments) {
    const L = Math.hypot(seg.ds, seg.dh) || Math.abs(seg.ds) || 1e-6;
    const sinTheta = seg.dh / L; // 下坡为负
    const cosTheta = Math.abs(seg.ds) / L;
    const drive = -g * sinTheta - seg.mu * g * cosTheta; // 重力切向 + 摩擦（摩擦恒反向）
    const duDl = (uu: number) => 2 * (drive - dragK * uu);

    const sub = Math.max(1, Math.ceil(L / 0.5));
    const h = L / sub;
    for (let i = 0; i < sub; i++) {
      if (u <= 1e-8 && drive <= 0) {
        stopped = true;
        stopDistance = travelled;
        u = 0;
        break;
      }
      // RK4 on u(l)
      const k1 = duDl(u);
      const k2 = duDl(u + 0.5 * h * k1);
      const k3 = duDl(u + 0.5 * h * k2);
      const k4 = duDl(u + h * k3);
      u += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
      if (u < 0) {
        u = 0;
        stopped = true;
        stopDistance = travelled + (i + 1) * h;
        break;
      }
      travelled += h;
    }
    segEndSpeeds.push(Math.sqrt(u));
    distances.push(travelled);
    if (stopped) break;
  }

  return { endSpeed: Math.sqrt(Math.max(0, u)), segEndSpeeds, stopped, stopDistance, distances };
}

/**
 * 滑手主动控速的路程积分：速度高于目标+0.25m/s 时使用刹车摩擦 μBrake
 * （搓雪/转弯减速），否则使用滑行摩擦 μGlide。沿弧长 RK4 子步 ≤0.5m。
 */
export function controlledRoll(
  v0: number,
  segments: RollSegment[],
  opts: { muGlide: number; muBrake: number; targetSpeed: number; dragK?: number; g?: number },
): { endSpeed: number } {
  const k = opts.dragK ?? DEFAULT_DRAG_K;
  const g = opts.g ?? G;
  const targetU = opts.targetSpeed * opts.targetSpeed;
  let u = Math.max(0, v0) ** 2;

  for (const seg of segments) {
    const L = Math.hypot(seg.ds, seg.dh) || Math.abs(seg.ds) || 1e-6;
    const sinTheta = seg.dh / L;
    const cosTheta = Math.abs(seg.ds) / L;
    const sub = Math.max(1, Math.ceil(L / 0.5));
    const h = L / sub;
    const f = (uu: number) => {
      const mu = uu > targetU + 2 * opts.targetSpeed * 0.25 ? opts.muBrake : opts.muGlide;
      const drive = -g * sinTheta - mu * g * cosTheta;
      return 2 * (drive - k * uu);
    };
    for (let i = 0; i < sub; i++) {
      const k1 = f(u);
      const k2 = f(u + 0.5 * h * k1);
      const k3 = f(u + 0.5 * h * k2);
      const k4 = f(u + h * k3);
      u += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
      if (u < 0) u = 0;
    }
  }
  return { endSpeed: Math.sqrt(u) };
}

/**
 * 在恒定坡度/摩擦上减速到 targetSpeed 所需弧长距离（含空气阻力）。
 * gradeDhDs = dh/ds（下坡为负）。若坡度太陡、永远无法降到目标速度，返回 Infinity。
 */
export function brakingDistance(
  v0: number,
  mu: number,
  gradeDhDs = 0,
  targetSpeed = 0,
  dragK: number = DEFAULT_DRAG_K,
): number {
  if (v0 <= targetSpeed) return 0;
  const m = gradeDhDs;
  const inv = 1 / Math.sqrt(1 + m * m);
  const grav = -G * m * inv; // 下坡为正
  const fric = mu * G * inv;
  const drive = grav - fric;
  let u = v0 * v0;
  const targetU = targetSpeed * targetSpeed;
  const h = 0.25;
  let s = 0;
  let prevU = u;
  for (let guard = 0; guard < 20000; guard++) {
    const du = 2 * (drive - dragK * u) * h;
    u += du;
    s += h;
    if (u <= targetU) return s;
    // 速度不再下降且仍高于目标：达到稳态/正在加速，永远减不下来
    if (guard > 200 && u > targetU && u >= prevU - 1e-9 && drive - dragK * u >= 0) {
      return Infinity;
    }
    prevU = u;
  }
  return Infinity;
}
