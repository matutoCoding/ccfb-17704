import { chromium } from 'playwright-core';
const EXE = 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1255\\chrome-win64\\chrome.exe';
const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://127.0.0.1:5188/');
await page.waitForSelector('.nav-item');
await page.waitForTimeout(1500);

const result = await page.evaluate(async () => {
  const s = window.__studio;
  const out = {};
  // 1) 放置一个铁杆（走真实 onPlace 钩子）
  const before = s.store.plan.features.length;
  s.app.hooks.onPlace('rail-flat', -100, 12);
  await new Promise((r) => setTimeout(r, 200));
  out.featuresAfterPlace = s.store.plan.features.length;
  out.placeInOrder = s.store.plan.order.includes(s.store.selectedId);
  out.before = before;

  // 2) 压雪推一层
  const opsBefore = s.store.plan.groomOps.length;
  s.store.setPage('groom');
  await new Promise((r) => setTimeout(r, 100));
  const pushBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('推一层'));
  pushBtn?.click();
  await new Promise((r) => setTimeout(r, 200));
  out.opsAfterPush = s.store.plan.groomOps.length;
  out.pushWorked = s.store.plan.groomOps.length === opsBefore + 1;

  // 3) 立即保存到 IndexedDB
  await s.store.saveNow();
  out.saveState = s.store.saveState;
  const dbs = await indexedDB.databases();
  out.dbNames = dbs.map((d) => d.name);
  const plans = await new Promise((resolve, reject) => {
    const req = indexedDB.open('terrain-park-studio');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('plans', 'readonly');
      const allReq = tx.objectStore('plans').getAll();
      allReq.onsuccess = () => resolve(allReq.result.map((p) => ({ id: p.id, name: p.name, nf: p.features.length, no: p.groomOps.length })));
      allReq.onerror = () => reject(allReq.error);
    };
    req.onerror = () => reject(req.error);
  });
  out.idbPlans = plans;

  // 4) 切到晴天/平光与热力图，确认 applyView 不抛
  s.store.setView({ lighting: 'flat' });
  s.app.applyView(s.store.view);
  s.store.setView({ heatmap: true });
  s.app.applyView(s.store.view);
  s.store.setView({ lighting: 'sun', heatmap: false });
  s.app.applyView(s.store.view);
  out.viewToggleOk = true;

  // 5) 重新评估全场，确保新道具进入后无异常
  const rep = s.store.report;
  out.reportRows = rep.rows.length;
  out.jumps = rep.jumpEvals.length;
  return out;
});
console.log(JSON.stringify(result, null, 2));
console.log('PAGE_ERRORS:', errors.length ? errors.slice(0, 10).join(' | ') : 'none');
await page.screenshot({ path: 'screenshots/12-interact-groom.png' });
await browser.close();
process.exit(errors.length ? 1 : 0);
