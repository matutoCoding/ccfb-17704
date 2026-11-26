import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const EXE = 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1255\\chrome-win64\\chrome.exe';
const URL = 'http://127.0.0.1:5188/';
mkdirSync('screenshots', { recursive: true });

const errors = [];
const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('CONSOLE.ERROR: ' + m.text());
});

await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.waitForSelector('.nav-item', { timeout: 15000 });
await page.waitForTimeout(3500);

const boot = await page.evaluate(() => {
  const s = window.__studio;
  const info = s?.app?.renderer?.info?.render;
  return {
    hasStudio: !!s,
    fps: document.querySelector('#fpsPill')?.textContent,
    calls: info?.calls,
    triangles: info?.triangles,
    bad: s?.store.report.badCount,
    verdicts: s?.store.report.jumpEvals.map((j) => j.verdict),
  };
});
console.log('BOOT', JSON.stringify(boot));
await page.screenshot({ path: 'screenshots/01-park.png' });

async function nav(label) {
  await page.locator('.nav-item', { hasText: label }).first().click();
  await page.waitForTimeout(1300);
}

await nav('雪道地形');
await page.getByRole('button', { name: /雪厚热力图/ }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: 'screenshots/02-terrain-heat.png' });
await page.getByRole('button', { name: /阴天平光/ }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: 'screenshots/02b-flatlight.png' });
await page.getByRole('button', { name: /雪厚热力图/ }).click();
await page.getByRole('button', { name: /晴天侧光/ }).click();

await nav('道具库');
await page.screenshot({ path: 'screenshots/03-library.png' });

await nav('压雪施工');
await page.screenshot({ path: 'screenshots/04-groom.png' });

await nav('腾空推演');
await page.waitForTimeout(800);
await page.screenshot({ path: 'screenshots/05-flight.png' });

// 物理精度自检（用 DOM click，避免软件渲染下可信点击坐标问题）
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('精度自检'))?.click());
await page.waitForFunction(() => document.querySelector('.self-test')?.textContent.includes('最大落点'), { timeout: 30000 });
const txt = await page.locator('.self-test').first().textContent();
console.log('SELFTEST\n' + txt);
await page.screenshot({ path: 'screenshots/07-flight-selftest.png' });

// 第一人称回放
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('沿推演轨迹'))?.click());
await page.waitForTimeout(3500);
const povVisible = await page.locator('#povBar:not(.hidden)').count();
await page.screenshot({ path: 'screenshots/08-pov.png' });
console.log('POV bar visible:', povVisible);
await page.getByRole('button', { name: '退出' }).click().catch(() => {});
await page.waitForTimeout(500);

// 切到中型坏跳台看红色轨迹
await page.locator('.page-title', { hasText: '腾空推演' }).waitFor();
await page.locator('.section select').first().selectOption({ index: 1 });
await page.waitForTimeout(1000);
await page.screenshot({ path: 'screenshots/09-badjump.png' });

await nav('方案对比');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'screenshots/06-compare.png' });

console.log('ERRORS:', errors.length ? '\n' + errors.slice(0, 25).join('\n') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
