import { h, button, sliderRow, statCard, clear } from '../dom';
import { store } from '../store';
import type { Ctx } from '../ctx';
import { uid } from '../../core/mathx';
import { applyGroomPass, summarizeGroom } from '../../core/grooming';
import type { GroomOp } from '../../core/types';

/** 供 main 的 3D 点击钩子调用 */
export const groomController = {
  drawingId: null as string | null,
  viewOpId: null as string | null,
  addMapPoint(p: { x: number; z: number }): void {
    const id = this.drawingId;
    if (!id) return;
    store.mutate((pl) => {
      const path = pl.groomPaths.find((q) => q.id === id);
      path?.points.push({ ...p });
    });
  },
};

export function renderGroomPage(root: HTMLElement, ctx: Ctx): void {
  const plan = store.plan;
  const stats = summarizeGroom(plan.groomOps);

  if (groomController.drawingId && !plan.groomPaths.some((p) => p.id === groomController.drawingId)) {
    groomController.drawingId = null;
  }
  const activePath =
    plan.groomPaths.find((p) => p.id === groomController.drawingId) ??
    plan.groomPaths[0] ??
    null;

  const pathSec = h('div', { class: 'section' }, h('h3', {}, '推铲轨迹'));
  for (const path of plan.groomPaths) {
    const drawing = groomController.drawingId === path.id;
    pathSec.append(
      h(
        'div',
        { class: `feature-row${activePath?.id === path.id ? ' selected' : ''}`, style: 'margin-bottom:6px' },
        h('div', { class: 'feature-order' }, '🚜'),
        h('div', {
          onclick: () => {
            groomController.drawingId = path.id;
            ctx.app.setMode('groom');
            ctx.rerender();
          },
        } as any,
          h('div', { class: 'feature-name' }, path.name + (drawing ? ' · 点选中…' : '')),
          h('div', { class: 'feature-sub' }, `${path.points.length} 个轨迹点 · 铲宽 ${path.bladeWidth}m · 每层 ${path.cutPerPass * 100}cm`),
        ),
        h('button', {
          class: 'icon-btn',
          title: '删除轨迹',
          onclick: (e: Event) => {
            e.stopPropagation();
            store.mutate((p) => {
              p.groomPaths = p.groomPaths.filter((q) => q.id !== path.id);
            });
            if (groomController.drawingId === path.id) groomController.drawingId = null;
            ctx.rerender();
          },
        } as any, '✕'),
      ),
    );
  }
  pathSec.append(
    h('div', { class: 'row mt8' },
      button('➕ 新建轨迹并在雪道上点选', () => {
        const id = uid('gp');
        store.mutate((p) => {
          p.groomPaths.push({ id, name: `推铲线 ${p.groomPaths.length + 1}`, points: [], bladeWidth: 6, cutPerPass: 0.12 });
        });
        groomController.drawingId = id;
        ctx.app.setMode('groom');
        ctx.toast('在雪道上依次点击轨迹点，完成后点“结束点选”');
        ctx.rerender();
      }, 'primary'),
      groomController.drawingId
        ? button('✅ 结束点选', () => {
            groomController.drawingId = null;
            ctx.app.setMode('orbit');
            ctx.rerender();
          })
        : null,
    ),
  );

  const paramSec = h('div', { class: 'section' }, h('h3', {}, '铲具参数 / 分层推雪'));
  if (activePath) {
    paramSec.append(
      sliderRow({
        label: '推铲宽度',
        value: activePath.bladeWidth,
        min: 3,
        max: 14,
        step: 0.5,
        unit: 'm',
        onInput: (v) =>
          store.mutate((p) => {
            p.groomPaths.find((q) => q.id === activePath.id)!.bladeWidth = v;
          }),
      }),
      sliderRow({
        label: '每层切深',
        value: activePath.cutPerPass,
        min: 0.03,
        max: 0.35,
        step: 0.01,
        format: (v) => `${(v * 100).toFixed(0)} cm`,
        onInput: (v) =>
          store.mutate((p) => {
            p.groomPaths.find((q) => q.id === activePath.id)!.cutPerPass = v;
          }),
      }),
      h('div', { class: 'row mt12' },
        button('🚜 推一层（挖填计算）', () => {
          const path = store.plan.groomPaths.find((q) => q.id === activePath.id);
          if (!path || path.points.length < 2) {
            ctx.toast('请先给轨迹至少 2 个点');
            return;
          }
          const layer = store.plan.groomOps.filter((o) => o.pathId === path.id).length + 1;
          const result = applyGroomPass(store.plan.terrain, path, layer);
          const op: GroomOp = result.op;
          op.at = Date.now();
          store.mutate((p) => {
            p.terrain.snow = result.snow;
            p.groomOps.push(op);
          });
          groomController.viewOpId = op.id;
          if (store.view.groomArrows) ctx.app.setHaul(op);
          ctx.toast(`第 ${layer} 层：挖 ${op.cutVolume.toFixed(0)}m³ / 填 ${op.fillVolume.toFixed(0)}m³`);
          ctx.rerender();
        }, 'primary'),
        button('♻️ 恢复原始雪面', () => {
          store.mutate((p) => {
            p.terrain.snow = new Float32Array(p.snowOriginal);
            p.groomOps = [];
          });
          groomController.viewOpId = null;
          ctx.app.clearHaul();
          ctx.toast('已回到导入时的雪厚');
          ctx.rerender();
        }, 'danger'),
      ),
    );
  } else {
    paramSec.append(h('p', { class: 'tiny muted' }, '先新建一条轨迹。'));
  }

  const volSec = h(
    'div',
    { class: 'section' },
    h('h3', {}, '挖填与调运（累计）'),
    h('div', { class: 'stat-grid' },
      statCard('挖方', stats.cut.toFixed(0), 'm³', 'warn'),
      statCard('填方', stats.fill.toFixed(0), 'm³', 'ok'),
      statCard('内部倒运', stats.reused.toFixed(0), 'm³'),
      statCard('推至集雪堆', stats.haul.toFixed(0), 'm³', 'info' as any),
      statCard('外借雪', stats.borrow.toFixed(0), 'm³', stats.borrow > 1 ? 'bad' : 'ok'),
      statCard('作业层数', String(plan.groomOps.length), '层'),
    ),
    h('p', { class: 'tiny muted mt8' }, '橙球＝挖方雪源，蓝球＝填方去向；箭头为推铲调运方向，紫箭头为末端集雪堆。'),
    h('div', { class: 'row mt8' },
      button(store.view.groomArrows ? '✅ 显示调运箭头' : '显示调运箭头', () => {
        store.setView({ groomArrows: !store.view.groomArrows });
        if (!store.view.groomArrows) ctx.app.clearHaul();
        ctx.rerender();
      }, store.view.groomArrows ? 'primary' : 'default'),
    ),
  );

  const opSec = h('div', { class: 'section' }, h('h3', {}, '分层记录（点击查看该层雪从哪来到哪去）'));
  const opList = h('div', {});
  if (!plan.groomOps.length) opList.append(h('p', { class: 'tiny muted' }, '还没有作业记录。'));
  for (const op of [...plan.groomOps].reverse()) {
    opList.append(
      h('div', {
        class: `issue-line ${groomController.viewOpId === op.id ? 'warn' : 'ok'}`,
        style: 'cursor:pointer',
        onclick: () => {
          groomController.viewOpId = op.id;
          ctx.app.setHaul(op);
          ctx.rerender();
        },
      },
        h('span', {}, `第${op.layer}层 · ${op.pathName}：挖 ${op.cutVolume.toFixed(1)} / 填 ${op.fillVolume.toFixed(1)} / 倒运 ${op.reusedVolume.toFixed(1)} / 集雪 ${op.haulVolume.toFixed(1)} m³`),
      ),
    );
  }
  opSec.append(opList);

  root.append(
    h('div', { class: 'page-title' }, '压雪施工'),
    h('p', { class: 'page-desc' }, '按压雪车推铲轨迹一层层改造雪面，逐格计算挖填雪量，并给出雪源、填方与调运路线。'),
    pathSec,
    paramSec,
    volSec,
    opSec,
  );

  // 进入页面且未选中某层时，默认展示最近一层的调运箭头
  if (store.view.groomArrows && plan.groomOps.length && !groomController.viewOpId) {
    ctx.app.setHaul(plan.groomOps[plan.groomOps.length - 1]);
  }
}
