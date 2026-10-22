import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
  args: ['--ignore-gpu-blocklist']
});
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); errors.push(e.message); });
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });

await page.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/vd_mobile_menu.png' });

const menuLayout = await page.evaluate(() => {
  const d = document.body;
  return {
    touch: d.classList.contains('touch'),
    scrollW: d.scrollWidth, clientW: d.clientWidth,
    menuH: document.querySelector('.menu-card').scrollHeight,
    viewH: innerHeight
  };
});
console.log('MENU', JSON.stringify(menuLayout));

await page.tap('#startBtn');
await page.waitForTimeout(1600);
await page.screenshot({ path: '/tmp/vd_mobile_game.png' });

/* gas touch */
const gas = page.locator('[data-act="throttle"]');
const box = await gas.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.waitForTimeout(2600);
await page.mouse.up();
const touchDrive = await page.evaluate(() => {
  const d = window.VD.debug;
  return { kmh: Math.round(d.physics.speed * 3.6), gear: d.physics.gear, mode: d.mode };
});
console.log('TOUCH DRIVE', JSON.stringify(touchDrive));
await page.screenshot({ path: '/tmp/vd_mobile_drive.png' });

const layout = await page.evaluate(() => {
  const ids = ['challengePanel', 'parkMeter', 'cargoPanel', 'launchPanel', 'touchControls'];
  const rects = {};
  for (const id of ids) {
    const e = document.getElementById(id);
    const r = e.getBoundingClientRect();
    rects[id] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(e).display, opacity: getComputedStyle(e).opacity };
  }
  const gp = document.querySelector('.gear-pad');
  const gr = gp.getBoundingClientRect();
  const pp = document.querySelector('.pedal-pad').getBoundingClientRect();
  return {
    rects,
    gearPad: { display: getComputedStyle(gp).display, x: Math.round(gr.x), y: Math.round(gr.y), w: Math.round(gr.width), h: Math.round(gr.height), overlapsPedals: gr.bottom > pp.top && gr.top < pp.bottom && gr.right > pp.left && gr.left < pp.right },
    scrollW: document.body.scrollWidth, clientW: document.body.clientWidth
  };
});
console.log('LAYOUT', JSON.stringify(layout));

await page.tap('[data-act="gearUp"]');
await page.waitForTimeout(450);
const gearTouch = await page.evaluate(() => {
  const d = window.VD.debug;
  return { auto: d.physics.autoMode, gear: d.physics.gear, manualClass: document.body.classList.contains('manual') };
});
console.log('GEAR TOUCH', JSON.stringify(gearTouch));
const ok = layout.gearPad.display === 'flex' && !layout.gearPad.overlapsPedals && layout.scrollW <= layout.clientW + 1 && gearTouch.auto === false;
console.log(ok ? 'MOBILE PASS' : 'MOBILE FAIL');
console.log('ERRORS', errors.length);
await browser.close();
