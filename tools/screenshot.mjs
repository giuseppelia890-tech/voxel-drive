import { chromium } from 'playwright-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: false,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
await page.waitForTimeout(2400);
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => addEventListener('blur', (e) => e.stopImmediatePropagation(), true));

const shots = [
  { name: 'cityA', x: 160, z: -232, yaw: 0 },
  { name: 'cityB', x: 80, z: 228, yaw: Math.PI },
  { name: 'cityC', x: 240, z: -200, yaw: 0 },
  { name: 'highway', x: 4.5, z: -140, yaw: 0 },
  { name: 'mountain', x: -240, z: 100, yaw: -Math.PI / 2 }
];

for (const s of shots) {
  await page.evaluate(() => window.VD.debug.startGame('free'));
  await page.waitForTimeout(350);
  await page.evaluate((p) => window.VD.debug.physics.reset(p.x, p.z, p.yaw), s);
  await page.waitForTimeout(800);
  await page.bringToFront();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2800);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(450);
  const info = await page.evaluate(() => {
    const d = window.VD.debug;
    return { kmh: Math.round(d.physics.speed * 3.6), gear: d.physics.gear, x: Math.round(d.physics.position.x), z: Math.round(d.physics.position.z), zone: d.world.zoneAt ? d.world.zoneAt(d.physics.position.x, d.physics.position.z) : '' };
  });
  console.log(s.name, JSON.stringify(info));
  await page.screenshot({ path: `/tmp/vd_shot_${s.name}.png` });
}

await browser.close();
