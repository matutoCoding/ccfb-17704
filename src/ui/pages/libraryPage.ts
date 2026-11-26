import { h, button, sliderRow } from '../dom';
import { FEATURE_DEFS, getDef } from '../../core/features';
import type { Ctx } from '../ctx';

const KIND_ICON: Record<string, string> = {
  jump: '⛷️',
  box: '📦',
  rail: '🎚️',
  halfpipe: '🛼',
  stairs: '🪜',
};

let selectedType = 'jump-medium';
const draftParams: Record<string, Record<string, number>> = {};

export function renderLibraryPage(root: HTMLElement, ctx: Ctx): void {
  const def = getDef(selectedType);
  if (!draftParams[selectedType]) draftParams[selectedType] = { ...def.params };
  const params = draftParams[selectedType];

  const cards = FEATURE_DEFS.map((d) =>
    h(
      'button',
      {
        class: `lib-card${d.type === selectedType ? ' selected-card' : ''}`,
        onclick: () => {
          selectedType = d.type;
          ctx.rerender();
        },
      },
      h('span', { class: 'lib-size' }, d.size),
      h('div', { class: 'lib-ico' }, KIND_ICON[d.kind] ?? '🎿'),
      h('div', { class: 'lib-name' }, d.name),
      h('div', { class: 'lib-meta' }, d.description),
      h('div', { class: 'lib-meta mt8' }, `建议 ${d.speedRangeKmh[0]}–${d.speedRangeKmh[1]} km/h`),
    ),
  );

  const editor = h('div', { class: 'section' }, h('h3', {}, `参数化编辑 · ${def.name}`));
  for (const spec of def.paramSpecs) {
    editor.append(
      sliderRow({
        label: spec.label,
        value: params[spec.key],
        min: spec.min,
        max: spec.max,
        step: spec.step,
        unit: spec.unit,
        onInput: (v) => {
          params[spec.key] = v;
        },
      }),
    );
  }
  editor.append(
    h(
      'div',
      { class: 'row mt12' },
      button('📍 加入雪道并放置', () => ctx.beginPlace(def.type, { ...params }), 'primary'),
      button('恢复默认', () => {
        draftParams[def.type] = { ...def.params };
        ctx.rerender();
      }),
    ),
    h('p', { class: 'tiny muted mt8' }, '进入公园布置后，在雪道上点击即可放置；道具会自动采样该处雪面高程贴合地形。'),
  );

  root.append(
    h('div', { class: 'page-title' }, '道具库'),
    h('p', { class: 'page-desc' }, '大小跳台、箱子、铁杆、U 型池、台阶全部参数化：起跳角、平台长、落地坡长等均可细调。'),
    h('div', { class: 'lib-grid' }, ...cards),
    h('div', { class: 'mt12' }, editor),
  );
}
