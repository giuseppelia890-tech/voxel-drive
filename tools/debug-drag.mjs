import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
await page.waitForTimeout(2000);
await page.evaluate(() => window.VD.debug.startGame('drag'));
await page.waitForTimeout(300);
await page.keyboard.down('KeyS');
await page.keyboard.down('KeyW');
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => {
    const d = window.VD.debug;
    return {
      t: performance.now().toFixed(0),
      drag: d.drag.state, cd: +d.drag.countdown.toFixed(2),
      staged: d.physics.staged, rpm: Math.round(d.physics.rpm),
      brake: +d.physics.brake.toFixed(2), thr: +d.physics.throttle.toFixed(2),
      gear: d.physics.gear, speed: +d.physics.speed.toFixed(2),
      label: d.physics.launchLabel, msg: d.physics.launchMessageTimer.toFixed(1)
    };
  });
  console.log(JSON.stringify(s));
}
await page.keyboard.up('KeyS');
await page.waitForTimeout(300);
console.log('AFTER RELEASE', await page.evaluate(() => {
  const d = window.VD.debug;
  return { drag: d.drag.state, staged: d.physics.staged, rpm: Math.round(d.physics.rpm), label: d.physics.launchLabel, spin: +d.physics.wheelSpin.toFixed(2), speed: +d.physics.speed.toFixed(2) };
}));
await page.keyboard.up('KeyW');
await browser.close();
