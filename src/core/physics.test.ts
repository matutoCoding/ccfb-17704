import { describe, it, expect } from 'vitest';
import {
  solveFlight,
  solveFlightReference,
  brakingDistance,
  DEFAULT_DRAG_K,
  G,
} from './physics';

describe('抛体轨迹精度', () => {
  it('无空气阻力时落地点符合解析射程 v²sin2θ/g', () => {
    let worst = 0;
    for (const speed of [8, 14, 22]) {
      for (const deg of [10, 18, 30]) {
        const ang = (deg * Math.PI) / 180;
        const sol = solveFlight(
          { speed, angleRad: ang, surfaceY: () => 0 },
          { dt: 1 / 240, dragK: 0 },
        );
        const exact = (speed * speed * Math.sin(2 * ang)) / G;
        expect(sol.landing).not.toBeNull();
        worst = Math.max(worst, Math.abs(sol.landing!.s - exact));
        expect(Math.abs(sol.landing!.s - exact)).toBeLessThan(0.02);
      }
    }
    console.log(`真空解析解最大误差 = ${worst.toExponential(3)} m`);
  });

  it('有空气阻力时落点比真空射程近', () => {
    const ang = (20 * Math.PI) / 180;
    const vacuum = solveFlight(
      { speed: 16, angleRad: ang, surfaceY: () => 0 },
      { dragK: 0 },
    );
    const drag = solveFlight(
      { speed: 16, angleRad: ang, surfaceY: () => 0 },
      { dragK: DEFAULT_DRAG_K },
    );
    expect(drag.landing!.s).toBeLessThan(vacuum.landing!.s);
  });

  it.each(Array.from({ length: 40 }, (_, i) => i))(
    '与高精度 RK4 参考解相比落点误差 < 0.2m（随机案例 %#）',
    (seed) => {
      let a = seed * 2654435761 + 12345;
      const rnd = () => {
        a = (a * 1664525 + 1013904223) >>> 0;
        return a / 4294967296;
      };
      const speed = 8 + rnd() * 16;
      const deg = 8 + rnd() * 26;
      const dragK = rnd() * 0.012;
      const landDeg = 20 + rnd() * 18;
      const landSlope = -Math.tan((landDeg * Math.PI) / 180);
      const knuckle = 6 + rnd() * 10;
      const surfaceY = (s: number) => (s <= knuckle ? 0 : landSlope * (s - knuckle));

      const prod = solveFlight(
        { speed, angleRad: (deg * Math.PI) / 180, surfaceY },
        { dt: 1 / 240, dragK },
      );
      const ref = solveFlightReference(
        { speed, angleRad: (deg * Math.PI) / 180, surfaceY },
        { dragK },
      );

      expect(prod.landing).not.toBeNull();
      expect(ref.landing).not.toBeNull();
      const errS = Math.abs(prod.landing!.s - ref.landing!.s);
      const errY = Math.abs(prod.landing!.y - ref.landing!.y);
      expect(errS).toBeLessThan(0.2);
      expect(errY).toBeLessThan(0.2);
    },
  );

  it('全量随机案例的最大落点误差远小于 0.2m 预算', () => {
    let maxErr = 0;
    let worst = '';
    let nulls = 0;
    for (let seed = 0; seed < 500; seed++) {
      let a = seed * 40503 + 77;
      const rnd = () => {
        a = (a * 1664525 + 1013904223) >>> 0;
        return a / 4294967296;
      };
      const speed = 5 + rnd() * 21;
      const deg = 4 + rnd() * 36;
      const dragK = rnd() * 0.015;
      const landSlope = -Math.tan((15 + rnd() * 25) * (Math.PI / 180));
      const knuckle = 2 + rnd() * 16;
      const surfaceY = (s: number) => (s <= knuckle ? 0 : landSlope * (s - knuckle));
      const args = { speed, angleRad: (deg * Math.PI) / 180, surfaceY };
      const prod = solveFlight(args, { dragK });
      const ref = solveFlightReference(args, { dragK });
      if (!prod.landing || !ref.landing) {
        nulls++;
        continue;
      }
      const err = Math.abs(prod.landing.s - ref.landing.s);
      if (err > maxErr) {
        maxErr = err;
        worst = `v=${speed.toFixed(2)} ang=${deg.toFixed(1)} k=${dragK.toFixed(5)} kn=${knuckle.toFixed(1)}`;
      }
    }
    console.log(`500 案例最大落点误差 = ${maxErr.toFixed(6)} m (${worst}), null=${nulls}`);
    expect(nulls).toBe(0);
    expect(maxErr).toBeLessThan(0.2);
  }, 60000);

  it('制动距离随摩擦增大而缩短、随初速增大而增大', () => {
    const dIce = brakingDistance(15, 0.018, 0, 0);
    const dSoft = brakingDistance(15, 0.1, 0, 0);
    expect(Number.isFinite(dSoft)).toBe(true);
    expect(dSoft).toBeLessThan(dIce);
    const dFast = brakingDistance(25, 0.05, 0, 0);
    const dSlow = brakingDistance(10, 0.05, 0, 0);
    expect(dFast).toBeGreaterThan(dSlow);
  });
});
