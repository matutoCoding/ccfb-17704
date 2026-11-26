import type { Plan, PlacedFeature } from './types';
import { generateTestTerrain, cloneTerrain } from './terrain';
import { createFeature } from './features';
import { applyGroomPass } from './grooming';

function jump(
  type: string,
  x: number,
  z: number,
  overrides: Record<string, number>,
): PlacedFeature {
  const f = createFeature(type, x, z);
  Object.assign(f.params, overrides);
  return f;
}

/** 两版方案共用的基底：测试地形 + 一组道具（含一个落地不足的中型跳台） */
function buildBase(id: string, name: string): Plan {
  const terrain = generateTestTerrain();
  const p: Plan = {
    id,
    name,
    updatedAt: Date.now(),
    seeded: true,
    condition: 'hard',
    startSpeed: 7.0,
    terrain,
    snowOriginal: new Float32Array(terrain.snow),
    features: [],
    order: [],
    groomPaths: [
      {
        id: 'gp_main',
        name: '主雪道推铲线',
        points: [
          { x: -175, z: 2 },
          { x: -120, z: 0 },
          { x: -60, z: 0 },
          { x: -12, z: 0 },
          { x: 55, z: 0 },
          { x: 100, z: 0 },
        ],
        bladeWidth: 7,
        cutPerPass: 0.12,
      },
    ],
    groomOps: [],
  };

  const small = jump('jump-small', -150, 0, {});
  const box = createFeature('box-flat', -95, 0);
  const rail = createFeature('rail-flat', -62, 0);
  // 问题跳台：参数本身常规，但落地坡只修了 4m，速度到位后会冲出落地坡 -> 标红
  const badJump = jump('jump-medium', -18, 0, {
    landingLength: 4,
  });
  const stairs = createFeature('stairs-6', 78, 0);
  const pipe = createFeature('halfpipe-standard', 25, -96);

  p.features = [small, box, rail, badJump, stairs, pipe];
  p.order = [small.id, box.id, rail.id, badJump.id, stairs.id];
  return p;
}

/** 在指定路径上推 n 层 */
export function runGroomPasses(plan: Plan, pathId: string, n: number): void {
  for (let i = 0; i < n; i++) {
    const path = plan.groomPaths.find((q) => q.id === pathId);
    if (!path) return;
    const layer = plan.groomOps.filter((o) => o.pathId === pathId).length + 1;
    const { snow, op } = applyGroomPass(plan.terrain, path, layer);
    plan.terrain.snow = snow;
    op.at = Date.now() + i;
    plan.groomOps.push(op);
  }
}

export function createPlanA(): Plan {
  const a = buildBase('plan-a', '方案 A · 初版（落点不足）');
  runGroomPasses(a, 'gp_main', 2);
  return a;
}

export function createPlanB(): Plan {
  const b = buildBase('plan-b', '方案 B · 修订（加长落地坡）');
  const bad = b.features.find((f) => f.type === 'jump-medium')!;
  // 修订：把落地坡从 4m 加长到 20m 并加陡 3°，其余参数/速度保持一致
  Object.assign(bad.params, {
    landingAngle: 33,
    landingLength: 20,
  });
  b.startSpeed = 7.0;
  // 施工更多层，落地坡补雪压实
  runGroomPasses(b, 'gp_main', 5);
  const landPath = {
    id: 'gp_landing',
    name: '中型台落地坡补雪线',
    points: [
      { x: 6, z: 0 },
      { x: 22, z: 0 },
    ],
    bladeWidth: 8,
    cutPerPass: 0.15,
  };
  b.groomPaths.push(landPath);
  runGroomPasses(b, 'gp_landing', 3);
  return b;
}

export function createInitialPlan(): Plan {
  return createPlanA();
}

/** 深拷贝方案（IDB 结构化克隆也可，这里用于内存另存） */
export function clonePlan(p: Plan, newId?: string, newName?: string): Plan {
  const t = cloneTerrain(p.terrain);
  return {
    ...p,
    id: newId ?? p.id,
    name: newName ?? p.name,
    updatedAt: Date.now(),
    terrain: t,
    snowOriginal: new Float32Array(p.snowOriginal),
    features: p.features.map((f) => ({ ...f, params: { ...f.params } })),
    order: [...p.order],
    groomPaths: p.groomPaths.map((g) => ({ ...g, points: g.points.map((q) => ({ ...q })) })),
    groomOps: p.groomOps.map((o) => ({
      ...o,
      sources: o.sources.map((s) => ({ ...s })),
      destinations: o.destinations.map((d) => ({ ...d })),
    })),
  };
}
