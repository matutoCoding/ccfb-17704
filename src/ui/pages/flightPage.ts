import { h, button, statCard } from '../dom';
import { store } from '../store';
import type { Ctx } from '../ctx';
import { solveFlight, solveFlightReference, msToKmh } from '../../core/physics';

export function renderFlightPage(root: HTMLElement, ctx: Ctx): void {
  const report = store.report;
  const jumps = report.jumpEvals;
  if (!store.selectedJumpId && jumps[0]) store.selectedJumpId = jumps[0].featureId;
  let current = jumps.find((j) => j.featureId === store.selectedJumpId) ?? jumps[0] ?? null;

  ctx.app.showFlight(jumps, current?.featureId ?? null);
  ctx.addCleanup(() => ctx.app.clearFlight());

  const select = h(
    'select',
    {},
    ...store.plan.features
      .filter((f) => f.kind === 'jump')
      .map((f) => h('option', { value: f.id, selected: current?.featureId === f.id } as any, f.name)),
  ) as HTMLSelectElement;
  select.value = current?.featureId ?? '';
  select.onchange = () => {
    store.selectedJumpId = select.value;
    const j = report.jumpEvals.find((q) => q.featureId === select.value);
    ctx.app.showFlight(jumps, select.value);
    if (j?.landingWorld) ctx.app.focusFeature(select.value);
    ctx.rerender();
  };

  root.append(
    h('div', { class: 'page-title' }, '腾空推演'),
    h('p', { class: 'page-desc' }, 'RK4 数值积分抛体方程与二次空气阻力，步内连续碰撞 + 二分求落点；落点必须落在设计落地坡上，否则整段标红。'),
    h('div', { class: 'section' }, h('h3', {}, '选择跳台'), select),
  );

  if (!current) {
    root.append(h('div', { class: 'section' }, '当前方案没有跳台，去道具库添加一个。'));
    return;
  }

  const L = current.solution.landing;
  const banner = h(
    'div',
    { class: `verdict-banner ${current.level}` },
    current.level === 'ok' ? '✅' : current.level === 'warn' ? '⚠️' : '⛔',
    h('span', {}, `${current.title} — ${current.message}`),
  );

  const grid = h(
    'div',
    { class: 'stat-grid' },
    statCard('起跳速度', current.takeoffSpeed.toFixed(1), 'm/s'),
    statCard('起跳角', `${(current.profile.theta * 180 / Math.PI).toFixed(1)}`, '°'),
    statCard('滞空时间', L ? L.t.toFixed(2) : '—', 's'),
    statCard('水平距离', L ? (L.s - current.profile.lipS).toFixed(1) : '—', 'm（相对唇口）', current.verdict === 'landing' ? 'ok' : 'bad'),
    statCard('落地速度', L ? msToKmh(L.speed).toFixed(0) : '—', 'km/h'),
    statCard('落地姿态角', L ? L.angleDeg.toFixed(1) : '—', '°'),
    statCard('法向冲击', L ? L.normalImpact.toFixed(1) : '—', 'm/s'),
    statCard('等效落高 EFH', L ? L.efh.toFixed(2) : '—', 'm', current.efhLevel === 'bad' ? 'bad' : current.efhLevel === 'warn' ? 'warn' : 'ok'),
    statCard('垂直落差', L ? L.verticalDrop.toFixed(1) : '—', 'm'),
  );

  const replaySec = h(
    'div',
    { class: 'section' },
    h('h3', {}, '第一人称回放'),
    h('div', { class: 'row' },
      button('🎥 沿推演轨迹滑一遍', () => ctx.playPov(current!.featureId), 'primary'),
    ),
    h('p', { class: 'tiny muted mt8' }, '镜头置于滑行眼高，沿飞行弧线与落地后减速线运动；底部可暂停、拖动进度与倍速。'),
  );

  // 物理精度自检
  const testOut = h('div', { class: 'self-test mt8' }, '点击按钮，用随机案例对比生产求解器与 dt=1/6000s 高精度参考解…');
  const testBtn = button('🧪 运行落点精度自检（120 例）', () => {
    testBtn.disabled = true;
    testOut.textContent = '计算中（高精度参考解约需 1–3 秒）…';
    setTimeout(() => {
      try {
        let maxErr = 0;
        let worst = '';
        let maxClsMismatch = 0;
        for (let seed = 0; seed < 120; seed++) {
          let a = seed * 2246822519 + 99;
          const rnd = () => {
            a = (a * 1664525 + 1013904223) >>> 0;
            return a / 4294967296;
          };
          const speed = 6 + rnd() * 18;
          const deg = 6 + rnd() * 30;
          const dragK = rnd() * 0.012;
          const knuckle = 2 + rnd() * 14;
          const slope = -Math.tan((18 + rnd() * 22) * Math.PI / 180);
          const surfaceY = (s: number) => (s <= knuckle ? 0 : slope * (s - knuckle));
          const args = { speed, angleRad: (deg * Math.PI) / 180, surfaceY };
          const prod = solveFlight(args, { dragK });
          const ref = solveFlightReference(args, { dragK });
          if (!prod.landing || !ref.landing) continue;
          const err = Math.abs(prod.landing.s - ref.landing.s);
          if (err > maxErr) {
            maxErr = err;
            worst = `v=${speed.toFixed(2)} θ=${deg.toFixed(1)}° k=${dragK.toFixed(5)}`;
          }
          if (Math.abs(prod.landing.s - ref.landing.s) > 0.2) maxClsMismatch++;
        }
        const pass = maxErr < 0.2;
        testOut.textContent =
          `120 个随机抛体+阻力案例\n` +
          `最大落点水平误差 = ${(maxErr * 1000).toFixed(3)} mm (${maxErr.toExponential(2)} m)\n` +
          `预算 0.2 m：${pass ? '✅ 通过，余量约 ' + (0.2 / Math.max(maxErr, 1e-9)).toFixed(0) + ' 倍' : '❌ 未通过'}\n` +
          `最劣案例：${worst}`;
        testOut.style.color = pass ? '#9fe8c4' : '#fca5a5';
      } finally {
        testBtn.disabled = false;
      }
    }, 30);
  }, 'primary');

  root.append(
    h('div', { class: 'section' }, banner, grid, replaySec),
    h('div', { class: 'section' }, h('h3', {}, '物理精度验证'), testBtn, testOut),
  );
}
