import { h, button, sliderRow, badge } from '../dom';
import { store } from '../store';
import type { Ctx } from '../ctx';
import { getDef, kindLabel } from '../../core/features';
import { CONDITION_INFO, type PlacedFeature, type SnowCondition } from '../../core/types';
import { msToKmh } from '../../core/physics';

export function renderParkPage(root: HTMLElement, ctx: Ctx): void {
  const plan = store.plan;
  const report = store.report;
  const selected = plan.features.find((f) => f.id === store.selectedId) ?? null;

  // ---------- 雪况 / 出发速度 ----------
  const condSelect = h(
    'select',
    {},
    ...(Object.keys(CONDITION_INFO) as SnowCondition[]).map((c) =>
      h('option', { value: c, selected: c === plan.condition } as any, `${CONDITION_INFO[c].label} μ=${CONDITION_INFO[c].mu}`),
    ),
  ) as HTMLSelectElement;
  condSelect.value = plan.condition;
  condSelect.onchange = () =>
    store.mutate((p) => {
      p.condition = condSelect.value as SnowCondition;
    });

  const courseSection = h(
    'div',
    { class: 'section' },
    h('h3', {}, '速度链与雪况'),
    h('div', { class: 'field' }, h('span', {}, '雪面状况'), condSelect),
    sliderRow({
      label: '出发速度',
      value: plan.startSpeed,
      min: 0,
      max: 20,
      step: 0.5,
      unit: 'm/s',
      format: (v) => `${v.toFixed(1)} m/s · ${(v * 3.6).toFixed(0)}km/h`,
      onInput: (v) =>
        store.mutate((p) => {
          p.startSpeed = v;
        }),
    }),
    h('p', { class: 'tiny muted' }, CONDITION_INFO[plan.condition].desc + '；速度会从上一个道具经摩擦、空气阻力一路算到下一个起跳点。'),
  );

  // ---------- 安全校核汇总 ----------
  const issueSection = h('div', { class: 'section' }, h('h3', {}, '间距 / 速度校核'));
  issueSection.append(
    h(
      'div',
      { class: 'row' },
      badge(`${report.badCount} 红`, report.badCount ? 'bad' : 'ok'),
      badge(`${report.warnCount} 警`, report.warnCount ? 'warn' : 'ok'),
      badge(`最大 EFH ${report.maxEfh.toFixed(2)}m`, report.maxEfh > 1.1 ? 'warn' : 'ok'),
    ),
  );
  const issueBox = h('div', { class: 'mt8' });
  if (!report.issues.length) {
    issueBox.append(h('div', { class: 'issue-line ok' }, '✅ 全部道具的落点、速度窗口与间距均通过校核。'));
  } else {
    for (const iss of report.issues.slice(0, 12)) {
      issueBox.append(
        h(
          'div',
          {
            class: `issue-line ${iss.level}`,
            style: 'cursor:pointer',
            onclick: () => {
              if (iss.featureId) {
                store.select(iss.featureId);
                ctx.app.focusFeature(iss.featureId);
                ctx.rerender();
              }
            },
          },
          iss.level === 'bad' ? '⛔' : '⚠️',
          h('span', {}, iss.text),
        ),
      );
    }
  }
  issueSection.append(issueBox);

  // ---------- 道具列表 ----------
  const listSection = h('div', { class: 'section' }, h('h3', {}, `道具列表（${plan.features.length}）`));
  const list = h('div', { class: 'feature-list' });
  for (const f of plan.features) {
    const orderIdx = plan.order.indexOf(f.id);
    const row = h(
      'div',
      {
        class: `feature-row${selected?.id === f.id ? ' selected' : ''}`,
        onclick: () => {
          store.select(f.id);
          ctx.rerender();
        },
      },
      h('div', { class: 'feature-order' }, orderIdx >= 0 ? String(orderIdx + 1) : '—'),
      h(
        'div',
        {},
        h('div', { class: 'feature-name' }, f.name),
        h(
          'div',
          { class: 'feature-sub' },
          `${kindLabel(f.kind)} · x${f.x.toFixed(0)} z${f.z.toFixed(0)} · ${(f.yaw * 180 / Math.PI).toFixed(0)}°`,
        ),
      ),
      h(
        'div',
        { class: 'row', style: 'gap:4px' },
        h('button', {
          class: 'icon-btn',
          title: '上移顺序',
          onclick: (e: Event) => {
            e.stopPropagation();
            moveOrder(f.id, -1);
          },
        } as any, '↑'),
        h('button', {
          class: 'icon-btn',
          title: '下移顺序',
          onclick: (e: Event) => {
            e.stopPropagation();
            moveOrder(f.id, 1);
          },
        } as any, '↓'),
      ),
    );
    list.append(row);
  }
  listSection.append(
    list,
    h(
      'div',
      { class: 'row mt12' },
      button('➕ 从道具库添加', () => store.setPage('library'), 'primary'),
      button('🎯 视角归位全场', () => ctx.app.frameAll()),
    ),
  );

  root.append(
    h('div', { class: 'page-title' }, '公园布置'),
    h('p', { class: 'page-desc' }, '直接在雪道上拖动道具即可移位，位置实时贴合雪面。顺序决定速度串联方向。'),
    courseSection,
    issueSection,
    listSection,
  );

  // ---------- 选中道具检查器 ----------
  if (selected) {
    root.append(buildInspector(selected, ctx));
  }
}

function moveOrder(id: string, dir: -1 | 1): void {
  store.mutate((p) => {
    const arr = p.order;
    const i = arr.indexOf(id);
    if (i < 0) {
      arr.push(id);
      return;
    }
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  });
}

function buildInspector(feature: PlacedFeature, ctx: Ctx): HTMLElement {
  const def = getDef(feature.type);
  const sec = h('div', { class: 'section' }, h('h3', {}, `检查器 · ${feature.name}`));

  const xInput = h('input', { type: 'number', value: feature.x.toFixed(1) }) as HTMLInputElement;
  const zInput = h('input', { type: 'number', value: feature.z.toFixed(1) }) as HTMLInputElement;
  xInput.onchange = () =>
    store.mutate((p) => {
      const q = p.features.find((q) => q.id === feature.id)!;
      q.x = Number(xInput.value);
    });
  zInput.onchange = () =>
    store.mutate((p) => {
      const q = p.features.find((q) => q.id === feature.id)!;
      q.z = Number(zInput.value);
    });

  sec.append(
    h('div', { class: 'field' }, h('span', {}, 'X (m)'), xInput),
    h('div', { class: 'field' }, h('span', {}, 'Z (m)'), zInput),
    sliderRow({
      label: '朝向',
      value: Math.round((feature.yaw * 180) / Math.PI),
      min: -180,
      max: 180,
      step: 1,
      unit: '°',
      onInput: (v) =>
        store.mutate((p) => {
          p.features.find((q) => q.id === feature.id)!.yaw = (v * Math.PI) / 180;
        }),
    }),
  );

  // 实时拖动时同步数字框
  const unsub = store.on('plan', () => {
    const cur = store.plan.features.find((q) => q.id === feature.id);
    if (!cur) return;
    if (document.activeElement !== xInput) xInput.value = cur.x.toFixed(1);
    if (document.activeElement !== zInput) zInput.value = cur.z.toFixed(1);
  });
  ctx.addCleanup(unsub);

  for (const spec of def.paramSpecs) {
    sec.append(
      sliderRow({
        label: spec.label,
        value: feature.params[spec.key],
        min: spec.min,
        max: spec.max,
        step: spec.step,
        unit: spec.unit,
        onInput: (v) =>
          store.mutate((p) => {
            p.features.find((q) => q.id === feature.id)!.params[spec.key] = v;
          }),
      }),
    );
  }

  const ordered = store.plan.order.includes(feature.id);
  sec.append(
    h(
      'div',
      { class: 'row mt12' },
      button('🎯 聚焦', () => ctx.app.focusFeature(feature.id)),
      button(ordered ? '移出速度链' : '加入速度链', () =>
        store.mutate((p) => {
          const i = p.order.indexOf(feature.id);
          if (i >= 0) p.order.splice(i, 1);
          else p.order.push(feature.id);
        }),
      ),
      button('📋 复制', () =>
        store.mutate((p) => {
          const copy = {
            ...feature,
            id: `f_${Math.random().toString(36).slice(2, 9)}`,
            x: feature.x + 5,
            params: { ...feature.params },
          };
          p.features.push(copy);
          const oi = p.order.indexOf(feature.id);
          if (oi >= 0) p.order.splice(oi + 1, 0, copy.id);
          store.select(copy.id);
        }),
      ),
      button('🗑 删除', () =>
        store.mutate((p) => {
          p.features = p.features.filter((q) => q.id !== feature.id);
          p.order = p.order.filter((id) => id !== feature.id);
          store.select(null);
        }), 'danger'),
    ),
  );

  // 该道具的速度/落点快览
  const row = store.report.rows.find((r) => r.featureId === feature.id);
  if (row) {
    sec.append(
      h('div', { class: 'kv mt12' },
        h('span', { class: 'k' }, '入口速度'), h('span', { class: 'v' }, `${msToKmh(row.arrivalSpeed).toFixed(0)} km/h`),
        h('span', { class: 'k' }, '出口速度'), h('span', { class: 'v' }, `${msToKmh(row.exitSpeed).toFixed(0)} km/h`),
      ),
    );
    if (row.jump) {
      const j = row.jump;
      sec.append(
        h('div', { class: `verdict-banner ${j.level} mt12` }, j.title),
        h('div', { class: 'tiny muted' }, j.message),
      );
    }
  }
  return sec;
}
