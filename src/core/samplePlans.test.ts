import { describe, it, expect } from 'vitest';
import { createPlanA, createPlanB } from './samplePlans';
import { evaluateCourse } from './course';

describe('示例方案安全指标', () => {
  it('A 版恰好包含一个落点不合格的预埋跳台，且其余跳台落在落地坡上', () => {
    const report = evaluateCourse(createPlanA());
    expect(report.jumpEvals.length).toBe(2);
    const verdicts = report.jumpEvals.map((j) => j.verdict);
    expect(verdicts).toContain('runout');
    expect(verdicts.filter((v) => v === 'landing').length).toBeGreaterThanOrEqual(1);
    const bad = report.jumpEvals.find((j) => j.verdict === 'runout')!;
    expect(bad.level).toBe('bad');
    // 最大表面模型下会落到自然坡，EFH 仍明显高于安全台
    expect(bad.solution.landing!.efh).toBeGreaterThan(1.0);
    expect(report.badCount).toBeGreaterThanOrEqual(1);
  });

  it('B 版加长落地坡后所有跳台都落在落地坡上且无红色安全项', () => {
    const report = evaluateCourse(createPlanB());
    expect(report.allLandingOnSlope).toBe(true);
    for (const j of report.jumpEvals) {
      expect(j.verdict).toBe('landing');
      expect(j.level).not.toBe('bad');
    }
    expect(report.maxEfh).toBeLessThan(1.3);
    expect(report.badCount).toBe(0);
  });
});
