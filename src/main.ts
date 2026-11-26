import './style.css';
import { h, clear } from './ui/dom';
import { store } from './ui/store';
import type { Ctx } from './ui/ctx';
import { SceneApp } from './three/SceneApp';
import { renderTerrainPage } from './ui/pages/terrainPage';
import { renderLibraryPage } from './ui/pages/libraryPage';
import { renderParkPage } from './ui/pages/parkPage';
import { renderGroomPage, groomController } from './ui/pages/groomPage';
import { renderFlightPage } from './ui/pages/flightPage';
import { renderComparePanel, renderCompareHost, ensurePlanCache } from './ui/pages/comparePage';
import type { PageId } from './core/types';
import { createFeature } from './core/features';
import { parseTerrainFile } from './core/terrain';
import { buildPovPath } from './core/course';
import { idbGetPlan, idbSavePlan } from './core/db';
import { clonePlan } from './core/samplePlans';

const NAV: { id: PageId; ico: string; label: string }[] = [
  { id: 'terrain', ico: '🏔️', label: '雪道地形' },
  { id: 'library', ico: '🎿', label: '道具库' },
  { id: 'park', ico: '🧩', label: '公园布置' },
  { id: 'groom', ico: '🚜', label: '压雪施工' },
  { id: 'flight', ico: '🛫', label: '腾空推演' },
  { id: 'compare', ico: '📊', label: '方案对比' },
];

const HINTS: Record<PageId, string> = {
  terrain: '左键旋转 · 右键平移 · 滚轮缩放。打开雪厚热力图，红色区域就是缺雪段。',
  library: '选卡片并细调参数，点“加入雪道并放置”后到雪道上点击。',
  park: '直接拖动道具移位；点击道具在左侧编辑参数与朝向；顺序决定速度串联。',
  groom: '新建轨迹后在雪道上点击采集推铲路线，再到左侧“推一层”。',
  flight: '左侧选台并运行精度自检；可第一人称沿轨迹滑行。',
  compare: '两版方案的雪量与安全指标并排对比，方案保存在 IndexedDB。',
};

const navEl = document.getElementById('nav')!;
const panelEl = document.getElementById('panel')!;
const viewport = document.getElementById('viewport')!;
const hintEl = document.getElementById('viewportHint')!;
const toastEl = document.getElementById('toast')!;
const fpsPill = document.getElementById('fpsPill')!;
const planNameEl = document.getElementById('planName')!;
const saveStateEl = document.getElementById('saveState')!;
const compareHost = document.getElementById('compareHost')!;
const povBar = document.getElementById('povBar')!;

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
}

const povBridge: { tick: ((t: number, d: number) => void) | null; end: (() => void) | null } = {
  tick: null,
  end: null,
};

const app = new SceneApp(viewport, {
  onSelect: (id) => {
    store.select(id);
    if (store.page === 'park' || store.page === 'flight') rerenderPanel();
  },
  onPlace: (type, x, z) => {
    const f = createFeature(type, x, z);
    if (pendingParams) Object.assign(f.params, pendingParams);
    pendingParams = null;
    store.mutate((p) => {
      p.features.push(f);
      p.order.push(f.id);
    });
    store.select(f.id);
    app.setMode('orbit');
    store.setPage('park');
    toast(`已放置 ${f.name}，可直接拖动贴合地形`);
  },
  onGroomClick: (p) => groomController.addMapPoint(p),
  onDragLive: (id, x, z) =>
    store.mutate((pl) => {
      const f = pl.features.find((q) => q.id === id);
      if (f) {
        f.x = x;
        f.z = z;
      }
    }),
  onDragEnd: () => void store.saveNow(),
  onFps: (fps) => {
    fpsPill.textContent = `${fps} fps`;
    fpsPill.style.color = fps >= 45 ? '#86efac' : '#fca5a5';
  },
  onPovTick: (t, d) => povBridge.tick?.(t, d),
  onPovEnd: () => povBridge.end?.(),
});

const ctx: Ctx = {
  app,
  toast,
  rerender: () => rerenderAll(),
  addCleanup: (fn) => cleanups.push(fn),
  beginPlace: (type, params) => {
    pendingParams = params ?? null;
    store.setPage('park');
    app.setMode('place', type);
    app.setShowGroomPaths(false);
    toast('在雪道上点击放置道具，Esc 取消');
  },
  triggerImport: () => document.getElementById('hiddenFile')?.click(),
  exportTerrain: () => exportTerrain(),
  playPov: (id) => startPov(id),
  loadPlanById: async (pid) => {
    const p = await idbGetPlan(pid);
    if (p) {
      store.loadPlan(p);
      app.sync(store.plan, store.selectedId);
      app.applyView(store.view);
      rerenderPanel();
      toast(`已载入 ${p.name}`);
    }
  },
  saveCurrentAs: async (name) => {
    const copy = clonePlan(store.plan, `plan_${Date.now().toString(36)}`, name);
    await idbSavePlan(copy);
  },
};

let pendingParams: Record<string, number> | null = null;
let cleanups: (() => void)[] = [];

function renderNav(): void {
  clear(navEl);
  navEl.append(h('div', { class: 'nav-logo' }, '🏂'));
  for (const n of NAV) {
    navEl.append(
      h(
        'button',
        {
          class: `nav-item${store.page === n.id ? ' active' : ''}`,
          onclick: () => store.setPage(n.id),
        },
        h('span', { class: 'ico' }, n.ico),
        h('span', {}, n.label),
      ),
    );
  }
  navEl.append(h('div', { class: 'nav-foot' }, 'TERRAIN PARK STUDIO'));
}

function rerenderPanel(): void {
  cleanups.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
  cleanups = [];
  clear(panelEl);
  const page = store.page;
  if (page === 'terrain') renderTerrainPage(panelEl, ctx);
  else if (page === 'library') renderLibraryPage(panelEl, ctx);
  else if (page === 'park') renderParkPage(panelEl, ctx);
  else if (page === 'groom') renderGroomPage(panelEl, ctx);
  else if (page === 'flight') renderFlightPage(panelEl, ctx);
  else if (page === 'compare') renderComparePanel(panelEl, ctx);
}

function rerenderAll(): void {
  rerenderPanel();
  if (store.page === 'compare') renderCompareHost(compareHost, ctx);
}

function applyPageScene(): void {
  const page = store.page;
  renderNav();
  hintEl.textContent = HINTS[page];
  compareHost.classList.toggle('hidden', page !== 'compare');
  if (page === 'compare') {
    renderCompareHost(compareHost, ctx);
    app.setShowGroomPaths(false);
    app.clearHaul();
  } else {
    clear(compareHost);
    if (page !== 'groom') app.clearHaul();
    if (page === 'groom') {
      app.setShowGroomPaths(true);
      if (groomController.drawingId) app.setMode('groom');
      else app.setMode('orbit');
    } else {
      app.setShowGroomPaths(false);
      if (!(page === 'park' && app.mode === 'place')) app.setMode('orbit');
    }
    if (page === 'terrain') app.setContours(store.view.contours, store.plan.terrain);
    if (page !== 'flight') app.clearFlight();
  }
}

store.on('page', () => {
  rerenderPanel();
  applyPageScene();
});
store.on('plan', () => {
  app.sync(store.plan, store.selectedId);
  planNameEl.textContent = store.plan.name;
});
store.on('selection', () => app.sync(store.plan, store.selectedId));
store.on('view', () => app.applyView(store.view));

// 保存状态轮询
setInterval(() => {
  saveStateEl.textContent =
    store.saveState === 'saved' ? '已保存到 IndexedDB' : store.saveState === 'saving' ? '保存中…' : '有未保存修改（自动保存）';
}, 500);

// ---------- 文件导入 ----------
const fileInput = document.getElementById('hiddenFile') as HTMLInputElement;
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseTerrainFile(file.name, text);
    store.mutate((p) => {
      p.terrain = parsed.terrain;
      p.snowOriginal = new Float32Array(parsed.terrain.snow);
    });
    app.setContours(store.view.contours, parsed.terrain);
    toast(`导入成功：${parsed.terrain.nx}×${parsed.terrain.nz} 网格` + (parsed.warnings[0] ? `；${parsed.warnings[0]}` : ''));
    rerenderPanel();
  } catch (e) {
    toast(`导入失败：${(e as Error).message}`);
  } finally {
    fileInput.value = '';
  }
});

function exportTerrain(): void {
  const t = store.plan.terrain;
  const data = {
    name: t.name,
    nx: t.nx,
    nz: t.nz,
    cellSize: t.width / (t.nx - 1),
    originX: t.originX,
    originZ: t.originZ,
    ground: Array.from(t.ground),
    snow: Array.from(t.snow),
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${t.name || 'terrain'}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('已导出地形 JSON');
}

// ---------- 第一人称条 ----------
function startPov(featureId: string): void {
  const j = store.report.jumpEvals.find((q) => q.featureId === featureId);
  if (!j?.solution.landing) {
    toast('该跳台没有有效落点，无法回放');
    return;
  }
  const samples = buildPovPath(store.plan, j);
  app.startPov(samples);
  showPovBar();
}

function showPovBar(): void {
  clear(povBar);
  povBar.classList.remove('hidden');
  const range = h('input', { class: 'pov-progress', type: 'range', min: '0', max: '1000', value: '0' }) as HTMLInputElement;
  const timeLabel = h('span', {}, '0.0s');
  const playBtn = h('button', { class: 'btn btn-sm btn-primary' }, '⏸ 暂停') as HTMLButtonElement;
  const speedSel = h(
    'select',
    { style: 'width:84px' },
    h('option', { value: '0.5' }, '0.5×'),
    h('option', { value: '1', selected: true } as any, '1×'),
    h('option', { value: '1.5' }, '1.5×'),
    h('option', { value: '2' }, '2×'),
  ) as HTMLSelectElement;
  speedSel.value = '1';

  let seeking = false;
  range.addEventListener('pointerdown', () => (seeking = true));
  window.addEventListener('pointerup', () => (seeking = false));
  range.oninput = () => {
    const st = app.getPovTime();
    if (st) app.seekPov((Number(range.value) / 1000) * st.dur);
  };
  playBtn.onclick = () => {
    const st = app.getPovTime();
    if (!st) return;
    app.setPovPlaying(!st.playing);
    playBtn.textContent = st.playing ? '▶ 播放' : '⏸ 暂停';
  };
  speedSel.onchange = () => app.setPovSpeed(Number(speedSel.value));
  const stopBtn = h('button', { class: 'btn btn-sm' }, '退出') as HTMLButtonElement;
  stopBtn.onclick = () => {
    app.stopPov();
    povBar.classList.add('hidden');
    povBridge.tick = null;
  };

  povBar.append(
    h('div', { class: 'row', style: 'justify-content:space-between' },
      h('strong', { class: 'tiny' }, '🎥 第一人称滑行'),
      timeLabel,
    ),
    range,
    h('div', { class: 'pov-row' }, playBtn, stopBtn, h('span', { class: 'grow' }), h('span', {}, '倍速'), speedSel),
  );

  povBridge.tick = (t, d) => {
    if (!seeking) range.value = String(Math.round((t / Math.max(0.01, d)) * 1000));
    timeLabel.textContent = `${t.toFixed(1)} / ${d.toFixed(1)}s`;
  };
  povBridge.end = () => {
    playBtn.textContent = '▶ 重播';
    playBtn.onclick = () => {
      app.seekPov(0);
      app.setPovPlaying(true);
      playBtn.textContent = '⏸ 暂停';
    };
  };
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!povBar.classList.contains('hidden')) {
      app.stopPov();
      povBar.classList.add('hidden');
      return;
    }
    pendingParams = null;
    app.setMode('orbit');
    groomController.drawingId = null;
  }
});

// ---------- 启动 ----------
planNameEl.textContent = store.plan.name;
app.sync(store.plan, store.selectedId);
app.applyView(store.view);
renderNav();
rerenderPanel();
applyPageScene();
void ensurePlanCache();

// 调试/自动验证句柄
(window as unknown as { __studio: unknown }).__studio = { store, app, ctx };
