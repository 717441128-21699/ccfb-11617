// 全流程冒烟: 选泥 → 定中心 → 提拉拉高 → 修坯 → 阴干入架
import { chromium } from 'playwright-core';

const exe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on('pageerror', e => { errors.push(e.stack || String(e)); console.log('PAGEERROR:', e.stack || String(e)); });
await page.goto('http://localhost:5471/#/clay', { waitUntil: 'networkidle' });
await page.click('.card[data-id="stoneware"]');
await page.waitForSelector('#gl');
await page.waitForTimeout(600);
const box = (await page.locator('#gl').boundingBox())!;
const cx = box.x + box.width / 2;
const Y = (f: number) => box.y + box.height * f;

const hud = () => page.evaluate(() => ({
  wob: document.querySelector('#wob')?.textContent,
  H: document.querySelector('#hh')?.textContent,
  wall: document.querySelector('#wall')?.textContent,
  water: (document.querySelector('#water') as HTMLElement)?.style.width,
  fail: !(document.querySelector('#fail') as HTMLElement).hidden,
}));

// 1) 定中心: 稳定按住中下部 5 秒
await page.mouse.move(cx + 120, Y(0.6));
await page.waitForTimeout(5000);
console.log('after centering:', JSON.stringify(await hud()));

// 2) 提拉: 手从低到高慢扫, 每道 2.5 秒, 共 12 道; 定期补水(按住 W)
for (let pass = 0; pass < 5; pass++) {
  await page.keyboard.down('w');
  const steps = 40;
  for (let s = 0; s <= steps; s++) {
    const f = 0.62 - 0.30 * (s / steps); // 从 0.62 屏高慢慢提到 0.32
    await page.mouse.move(cx + 130, Y(f));
    await page.waitForTimeout(2500 / steps);
  }
  await page.keyboard.up('w');
  const d = await hud();
  if (pass % 3 === 0 || d.fail) console.log(`pass ${pass + 1}:`, JSON.stringify(d));
  if (d.fail) break;
}
await page.screenshot({ path: 'shots/3-thrown.png' });
const finalHud = await hud();
console.log('final:', JSON.stringify(finalHud));

// 3) 完成拉坯 → 修坯
const finishEnabled = await page.evaluate(() => !(document.querySelector('#finish') as HTMLButtonElement).disabled);
console.log('finish enabled:', finishEnabled);
if (finishEnabled) {
  await page.click('#finish');
  await page.waitForTimeout(600);
  // 修两刀
  await page.mouse.move(cx + 150, Y(0.5));
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  const removed = await page.evaluate(() => document.querySelector('#removed')?.textContent);
  console.log('trimmed cm³:', removed);
  await page.screenshot({ path: 'shots/4-trim.png' });
  await page.click('#done');
  await page.waitForTimeout(600);
  const pieces = await page.locator('.piece').count();
  console.log('shelf pieces:', pieces);
  await page.screenshot({ path: 'shots/5-shelf.png' });
}
console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
