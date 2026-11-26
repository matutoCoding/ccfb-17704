import { h, button, clear } from '../dom';
import { store } from '../store';
import type { Ctx } from '../ctx';
import type { Plan } from '../../core/types';
import { idbListPlans, idbSavePlan, idbCount } from '../../core/db';
import { createPlanA, createPlanB } from '../../core/samplePlans';
import { totalSnowVolume } from '../../core/terrain';
import { evaluateCourse, type CourseReport } from '../../core/course';
import { summarizeGroom } from '../../core/grooming';

interface Metrics {
  plan: Plan;
  report: CourseReport;
  snowVolume: number;
  cut: number;
  fill: number;
  haul: number;
  borrow: number;
  ops: number;
}

function metrics(p: Plan): Metrics {
  const g = summarizeGroom(p.groomOps);
  return {
    plan: p,
    report: evaluateCourse(p),
    snowVolume: totalSnowVolume(p.terrain),
    cut: g.cut,
    fill: g.fill,
    haul: g.haul,
    borrow: g.borrow,
    ops: p.groomOps.length,
  };
}

let cache: Plan[] = [];
let leftId = 'plan-a';
let rightId = 'plan-b';

export async function ensurePlanCache(): Promise<Plan[]> {
  if ((await idbCount()) === 0) {
    await idbSavePlan(createPlanA());
    await idbSavePlan(createPlanB());
  }
  cache = await idbListPlans();
  return cache;
}

function allChoices(): Plan[] {
  const cur = store.plan;
  const list = cache.filter((p) => p.id !== 'current');
  return [{ ...cur, id: 'current', name: `当前编辑 · ${cur.name}` }, ...list];
}

export function renderComparePanel(root: HTMLElement, ctx: Ctx): void {
  const nameInput = h('input', { type: 'text', value: store.plan.name }) as HTMLInputElement;
  root.append(
    h('div', { class: 'page-title' }, '方案对比'),
    h('p', { class: 'page-desc' }, '两版方案的雪量、挖填与安全指标并排对比。方案均保存在浏览器 IndexedDB。'),
    h('div', { class: 'section' },
      h('h3', {}, '保存当前方案'),
      h('div', { class: 'field' }, h('span', {}, '方案名'), nameInput),
      h('div', { class: 'row mt8' },
        button('💾 另存为新方案', async () => {
          await ctx.saveCurrentAs(nameInput.value.trim() || store.plan.name);
          await ensurePlanCache();
          ctx.toast('已存入 IndexedDB');
          ctx.rerender();
        }, 'primary'),
        button('🔄 刷新列表', async () => {
          await ensurePlanCache();
          ctx.rerender();
        }),
      ),
    ),
    h('div', { class: 'section' },
      h('h3', {}, '对比说明'),
      h('p', { class: 'tiny muted' }, '内置 A 版预埋了一个落地坡只有 4m 的中型跳台：速度到位后冲出落地坡，EFH 超标；B 版把落地坡加长到 20m，落点回到坡中央。'),
    ),
  );

  if (cache.length === 0) {
    void ensurePlanCache().then(() => ctx.rerender());
  }
}

function pickSelect(value: string, onChange: (id: string) => void): HTMLSelectElement {
  const choices = allChoices();
  if (!choices.some((p) => p.id === value)) value = choices[1]?.id ?? choices[0].id;
  const sel = h('select', {}, ...choices.map((p) => h('option', { value: p.id, selected: p.id === value } as any, p.name))) as HTMLSelectElement;
  sel.value = value;
  sel.onchange = () => onChange(sel.value);
  return sel;
}

function metricRow(label: string, a: string, b: string, opts?: { badA?: boolean; goodB?: boolean }): HTMLElement {
  return h('tr', {},
    h('th', {}, label),
    h('td', { class: `num ${opts?.badA ? 'delta-bad' : ''}` }, a),
    h('td', { class: `num ${opts?.goodB ? 'delta-good' : ''}` }, b),
  );
}

function barPair(label: string, va: number, vb: number, unit: string): HTMLElement {
  const max = Math.max(va, vb, 1);
  return h('div', { class: 'mt12' },
    h('div', { class: 'tiny muted' }, label),
    h('div', { class: 'row', style: 'align-items:stretch' },
      h('div', { class: 'grow' },
        h('div', { class: 'bar' }, h('i', { style: `width:${(va / max) * 100}%;background:linear-gradient(90deg,#dc2626,#f87171)` })),
        h('div', { class: 'tiny mt8' }, `${va.toFixed(0)} ${unit}`),
      ),
      h('div', { class: 'grow' },
        h('div', { class: 'bar' }, h('i', { style: `width:${(vb / max) * 100}%` })),
        h('div', { class: 'tiny mt8' }, `${vb.toFixed(0)} ${unit}`),
      ),
    ),
  );
}

export function renderCompareHost(host: HTMLElement, ctx: Ctx): void {
  clear(host);
  const choices = allChoices();
  const left = choices.find((p) => p.id === leftId) ?? choices.find((p) => p.id === 'plan-a') ?? choices[0];
  const right = choices.find((p) => p.id === rightId) ?? choices.find((p) => p.id === 'plan-b') ?? choices[1] ?? choices[0];
  if (!left || !right) return;
  const ma = metrics(left);
  const mb = metrics(right);

  const selA = pickSelect(left.id, (id) => {
    leftId = id;
    renderCompareHost(host, ctx);
  });
  const selB = pickSelect(right.id, (id) => {
    rightId = id;
    renderCompareHost(host, ctx);
  });

  const wrap = h('div', { class: 'compare-wrap' },
    h('div', { class: 'compare-picker' },
      h('div', {}, h('div', { class: 'tiny muted', style: 'margin-bottom:5px' }, '方案 A'), selA),
      h('div', { style: 'text-align:center;font-weight:900;color:var(--cyan)' }, 'VS'),
      h('div', {}, h('div', { class: 'tiny muted', style: 'margin-bottom:5px' }, '方案 B'), selB),
    ),
    h('div', { class: 'compare-grid' },
      planColumn('a', ma, ctx),
      planColumn('b', mb, ctx),
    ),
    h('div', { class: 'plan-col mt12' },
      h('h3', { style: 'margin-top:0' }, '关键指标对照'),
      h('table', { class: 'metric-table' },
        h('tbody', {},
          metricRow('总雪量 (m³)', ma.snowVolume.toFixed(0), mb.snowVolume.toFixed(0)),
          metricRow('挖方 (m³)', ma.cut.toFixed(1), mb.cut.toFixed(1)),
          metricRow('填方 (m³)', ma.fill.toFixed(1), mb.fill.toFixed(1)),
          metricRow('推至集雪堆 (m³)', ma.haul.toFixed(1), mb.haul.toFixed(1)),
          metricRow('外借雪 (m³)', ma.borrow.toFixed(1), mb.borrow.toFixed(1), { badA: ma.borrow > mb.borrow + 1 }),
          metricRow('压雪层数', String(ma.ops), String(mb.ops)),
          metricRow('道具数量', String(ma.plan.features.length), String(mb.plan.features.length)),
          metricRow('红色安全项', String(ma.report.badCount), String(mb.report.badCount), { badA: ma.report.badCount > 0, goodB: mb.report.badCount === 0 }),
          metricRow('警告项', String(ma.report.warnCount), String(mb.report.warnCount)),
          metricRow('最大等效落高 EFH (m)', ma.report.maxEfh.toFixed(2), mb.report.maxEfh.toFixed(2), { badA: ma.report.maxEfh >= 1.3, goodB: mb.report.maxEfh < 1.3 }),
          metricRow('跳台全部落在落地坡', ma.report.allLandingOnSlope ? '是 ✅' : '否 ❌', mb.report.allLandingOnSlope ? '是 ✅' : '否 ❌', { badA: !ma.report.allLandingOnSlope, goodB: mb.report.allLandingOnSlope }),
        ),
      ),
      barPair('总雪量对比', ma.snowVolume, mb.snowVolume, 'm³'),
      barPair('挖 / 填工程量', ma.cut + ma.fill, mb.cut + mb.fill, 'm³'),
      barPair('安全问题数（红+警）', ma.report.badCount + ma.report.warnCount, mb.report.badCount + mb.report.warnCount, '项'),
    ),
  );
  host.append(wrap);
}

function planColumn(side: 'a' | 'b', m: Metrics, ctx: Ctx): HTMLElement {
  const r = m.report;
  const issues = r.issues.length
    ? r.issues.slice(0, 8).map((i) => h('div', { class: `issue-line ${i.level}` }, i.level === 'bad' ? '⛔' : '⚠️', h('span', {}, i.text)))
    : [h('div', { class: 'issue-line ok' }, '✅ 无安全问题')];
  return h('div', { class: `plan-col ${side}` },
    h('h2', { style: 'margin:0 0 4px;font-size:17px' }, m.plan.name),
    h('div', { class: 'tiny muted' }, new Date(m.plan.updatedAt).toLocaleString('zh-CN')),
    h('div', { class: 'stat-grid three mt12' },
      statMini('红项', String(r.badCount), r.badCount ? 'var(--red)' : 'var(--green)'),
      statMini('警告', String(r.warnCount), r.warnCount ? 'var(--amber)' : 'var(--green)'),
      statMini('最大EFH', r.maxEfh.toFixed(2), r.maxEfh > 1.3 ? 'var(--red)' : 'var(--green)'),
    ),
    h('div', { class: 'mt12' }, ...issues),
    h('div', { class: 'row mt12' },
      button('📂 载入此方案', () => {
        if (m.plan.id === 'current') {
          ctx.toast('当前方案已在编辑器中');
          return;
        }
        ctx.loadPlanById(m.plan.id);
      }, 'primary'),
    ),
  );
}

function statMini(label: string, value: string, color: string): HTMLElement {
  return h('div', { class: 'stat-card' },
    h('div', { class: 'stat-value', style: `color:${color}` }, value),
    h('div', { class: 'stat-label' }, label),
  );
}
