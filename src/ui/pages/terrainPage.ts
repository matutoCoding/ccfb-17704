import { h, button, sliderRow, statCard, clear } from '../dom';
import { store } from '../store';
import type { Ctx } from '../ctx';
import { totalSnowVolume, thinSnowArea, generateTestTerrain, contoursToTerrain } from '../../core/terrain';

export function renderTerrainPage(root: HTMLElement, ctx: Ctx): void {
  const p = store.plan;
  const t = p.terrain;
  const thin = thinSnowArea(t, 0.6);
  const vol = totalSnowVolume(t);

  const stats = h(
    'div',
    { class: 'stat-grid' },
    statCard('雪道面积', `${((t.width * t.depth) / 10000).toFixed(1)}`, '公顷'),
    statCard('网格精度', `${t.nx}×${t.nz}`, `格距 ${(t.width / (t.nx - 1)).toFixed(1)}m`),
    statCard('最薄雪层', thin.min.toFixed(2), 'm', thin.min < 0.4 ? 'bad' : 'ok'),
    statCard('薄雪面积', `${(thin.area / 10000).toFixed(2)}`, '公顷 (<0.6m)', 'warn'),
    statCard('总雪量', `${(vol / 10000).toFixed(1)}`, '万 m³'),
    statCard('平均雪厚', thin.mean.toFixed(2), 'm'),
  );

  const heatToggle = button(store.view.heatmap ? '✅ 雪厚热力图' : '🟥 雪厚热力图', () => {
    store.setView({ heatmap: !store.view.heatmap });
    ctx.rerender();
  }, store.view.heatmap ? 'primary' : 'default');

  const contourToggle = button(store.view.contours ? '✅ 等高线' : '📈 显示等高线', () => {
    const next = !store.view.contours;
    store.setView({ contours: next });
    ctx.app.setContours(next, t);
    ctx.rerender();
  }, store.view.contours ? 'primary' : 'default');

  const sunBtn = button('☀️ 晴天侧光', () => {
    store.setView({ lighting: 'sun' });
    ctx.app.applyView(store.view);
    ctx.rerender();
  }, store.view.lighting === 'sun' ? 'primary' : 'default');
  const flatBtn = button('🌫️ 阴天平光', () => {
    store.setView({ lighting: 'flat' });
    ctx.app.applyView(store.view);
    ctx.rerender();
  }, store.view.lighting === 'flat' ? 'primary' : 'default');

  root.append(
    h('div', { class: 'page-title' }, '雪道地形'),
    h(
      'p',
      { class: 'page-desc' },
      '支持等高线或高程网格导入。雪厚是独立图层，薄雪区在热力图下立刻现形。内置测试雪场含两处露石薄雪斑。',
    ),
    h(
      'div',
      { class: 'section' },
      h('h3', {}, '数据源'),
      h('div', { class: 'row' }, button('🎲 重新生成测试地形', () => {
        const terrain = generateTestTerrain();
        store.mutate((pl) => {
          pl.terrain = terrain;
          pl.snowOriginal = new Float32Array(terrain.snow);
        });
        ctx.app.setContours(store.view.contours, store.plan.terrain);
        ctx.toast('已生成 400×280m 测试雪场');
        ctx.rerender();
      })),
      h('div', { class: 'row mt8' },
        button('📄 导入 JSON / CSV', () => ctx.triggerImport(), 'primary'),
        button('🧭 等高线示例', () => {
          const terrain = contoursToTerrain(buildDemoContours());
          store.mutate((pl) => {
            pl.terrain = terrain;
            pl.snowOriginal = new Float32Array(terrain.snow);
          });
          ctx.toast('已由等高线 IDW 插值生成地形');
          ctx.rerender();
        }),
        button('💾 导出', () => ctx.exportTerrain()),
      ),
      h('p', { class: 'tiny muted mt8' }, 'JSON：{nx,nz,cellSize,heights} 或 {contours:[{elev,points:[x,z…]}]}；CSV：纯高程矩阵。'),
    ),
    h('div', { class: 'section' }, h('h3', {}, '雪厚图层'), stats),
    h(
      'div',
      { class: 'section' },
      h('h3', {}, '一眼看薄雪'),
      h('div', { class: 'row' }, heatToggle),
      sliderRow({
        label: '薄雪阈值',
        value: 0.6,
        min: 0.2,
        max: 1.5,
        step: 0.05,
        unit: 'm',
        onInput: (v) => ctx.app.setThinThreshold(v),
      }),
      h('p', { class: 'tiny muted' }, '红＝薄于阈值，黄＝过渡，蓝白＝深雪。'),
    ),
    h(
      'div',
      { class: 'section' },
      h('h3', {}, '雪面光照 / 等高线'),
      h('div', { class: 'row' }, sunBtn, flatBtn, contourToggle),
      sliderRow({
        label: '平光强度',
        value: store.view.flatAmount,
        min: 0.5,
        max: 1,
        step: 0.01,
        onInput: (v) => {
          store.view.flatAmount = v;
          ctx.app.applyView(store.view);
        },
      }),
      h('div', { class: 'row mt8' },
        button(store.view.corduroy ? '✅ 灯芯绒压雪纹' : '灯芯绒纹', () => {
          store.setView({ corduroy: !store.view.corduroy });
          ctx.app.applyView(store.view);
          ctx.rerender();
        }, store.view.corduroy ? 'primary' : 'default'),
        button(store.view.glitter ? '✅ 颗粒闪光' : '颗粒闪光', () => {
          store.setView({ glitter: !store.view.glitter });
          ctx.app.applyView(store.view);
          ctx.rerender();
        }, store.view.glitter ? 'primary' : 'default'),
      ),
      h('p', { class: 'tiny muted mt8' }, '晴天有强侧光、灯芯绒阴影与雪晶闪烁；平光模式压低明暗、加白雾，还原阴天看不清起伏的感觉。'),
    ),
  );
}

function buildDemoContours(): any {
  // 一组沿 x 下降、带轻微弯曲的等高线
  const contours: any[] = [];
  for (let e = -40; e <= 40; e += 4) {
    const pts: number[] = [];
    for (let z = -120; z <= 120; z += 10) {
      // e ≈ -0.16 x + 2 sin(...) 反解 x
      const x = (e - 2.2 * Math.sin(z * 0.03)) / -0.14;
      pts.push(x, z);
    }
    contours.push({ elev: e, points: pts });
  }
  return { name: '等高线示例', cellSize: 4, contours };
}
