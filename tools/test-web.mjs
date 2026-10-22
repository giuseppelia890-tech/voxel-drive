import { chromium } from 'playwright-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://localhost:8765/index.html';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: !process.env.HEADED,
  args: ['--ignore-gpu-blocklist', '--enable-webgl']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.type(), m.text().slice(0, 400));
});
page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); errors.push(e.message); });

await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(2500);

const boot = await page.evaluate(() => {
  const d = window.VD && window.VD.debug;
  return d ? {
    state: d.state, mode: d.mode, cars: d.traffic.cars.length,
    bodies: d.traffic.bodies.count, calls: d.renderer.info.render.calls,
    tris: d.renderer.info.render.triangles, player: d.playerType
  } : { missing: true };
});
console.log('BOOT', JSON.stringify(boot));
await page.screenshot({ path: '/tmp/vd_menu.png' });

await page.click('#startBtn');
await page.waitForTimeout(1000);
await page.keyboard.down('KeyW');
await page.waitForTimeout(5000);
await page.keyboard.up('KeyW');
const drive = await page.evaluate(() => {
  const d = window.VD.debug;
  return { state: d.state, kmh: Math.round(d.physics.speed * 3.6), gear: d.physics.gear, rpm: Math.round(d.physics.rpm), x: Math.round(d.physics.position.x), z: Math.round(d.physics.position.z) };
});
console.log('DRIVE', JSON.stringify(drive));
await page.screenshot({ path: '/tmp/vd_drive.png' });

/* ---- parcheggio perfetto ---- */
await page.evaluate(() => { window.VD.debug.physics.reset(120, 80, 0); });
await page.waitForTimeout(3200);
const park = await page.evaluate(() => {
  const d = window.VD.debug;
  const bay = d.world.parkingBays[0];
  return { done: bay.done, grade: bay.lastGrade, perfect: !!bay.perfect, progress: bay.progress, pos: [d.physics.position.x, d.physics.position.z], angle: d.physics.yaw };
});
console.log('PARK', JSON.stringify(park));
await page.screenshot({ path: '/tmp/vd_park.png' });

/* ---- drag: staging, lancio, corsa ---- */
await page.evaluate(() => window.VD.debug.startGame('drag'));
await page.waitForTimeout(500);
await page.keyboard.down('KeyS');
await page.keyboard.down('KeyW');
await page.waitForTimeout(3100);
const staged = await page.evaluate(() => {
  const d = window.VD.debug;
  return { state: d.drag.state, staged: d.physics.staged, rpm: Math.round(d.physics.rpm), speed: d.physics.speed, label: d.physics.launchLabel };
});
console.log('STAGED', JSON.stringify(staged));
await page.keyboard.up('KeyS');
await page.waitForTimeout(350);
const launched = await page.evaluate(() => {
  const d = window.VD.debug;
  return { drag: d.drag.state, elapsed: d.drag.elapsed, rpm: Math.round(d.physics.rpm), label: d.physics.launchLabel, spin: d.physics.wheelSpin, speed: d.physics.speed };
});
console.log('LAUNCH', JSON.stringify(launched));
await page.waitForTimeout(4200);
const run = await page.evaluate(() => {
  const d = window.VD.debug;
  return { drag: d.drag.state, elapsed: d.drag.elapsed, speed: Math.round(d.physics.speed * 3.6), gear: d.physics.gear, z: Math.round(d.physics.position.z), progress: Math.round(d.physics.position.z - d.world.drag.startZ) };
});
console.log('RUN', JSON.stringify(run));
await page.keyboard.up('KeyW');
await page.screenshot({ path: '/tmp/vd_drag.png' });

/* ---- consegna / cargo ---- */
await page.evaluate(() => window.VD.debug.startGame('delivery'));
await page.waitForTimeout(500);
await page.evaluate(() => window.VD.debug.physics.reset(-330, -200, 0));
await page.waitForTimeout(1200);
const del = await page.evaluate(() => {
  const d = window.VD.debug;
  return { mode: d.mode, player: d.playerType, active: d.delivery.active, cargo: !!d.cargo, loaded: d.cargo && d.cargo.loaded, cubes: d.cargo ? d.cargo.cubes.length : 0, route: d.delivery.routeIndex };
});
console.log('DELIVERY', JSON.stringify(del));
await page.screenshot({ path: '/tmp/vd_delivery.png' });

/* ---- drift: accelerazione poi freno a mano ---- */
await page.evaluate(() => window.VD.debug.startGame('drift'));
await page.waitForTimeout(500);
await page.keyboard.down('KeyW');
await page.waitForTimeout(2200);
await page.keyboard.down('Space');
await page.keyboard.down('KeyA');
await page.waitForTimeout(1800);
const drift = await page.evaluate(() => {
  const d = window.VD.debug;
  return { zone: d.drift.zoneState, time: d.drift.timeLeft.toFixed(1), score: Math.round(d.drift.score), live: d.drift.live, pts: Math.round(d.drift.livePoints), slip: d.physics.slipAngle.toFixed(2), speed: Math.round(d.physics.speed * 3.6), drifting: d.physics.drifting };
});
console.log('DRIFT', JSON.stringify(drift));
await page.keyboard.up('KeyA');
await page.keyboard.up('Space');
await page.keyboard.up('KeyW');
await page.screenshot({ path: '/tmp/vd_drift.png' });

/* ---- catena di urti ---- */
await page.evaluate(() => window.VD.debug.startGame('free'));
await page.waitForTimeout(500);
const smash = await page.evaluate(() => {
  const d = window.VD.debug;
  const car = d.traffic.cars.find((c) => !c.wreck);
  d.traffic.smash(car, 22, 0, 20, 0);
  const wrecked = d.traffic.cars.filter((c) => c.wreck).length;
  return { wrecked, deform: car.deform, index: car.index };
});
console.log('SMASH', JSON.stringify(smash));
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/vd_smash.png' });

/* ---- conteggio performance ---- */
const perf = await page.evaluate(() => new Promise((resolve) => {
  let frames = 0;
  const t0 = performance.now();
  function tick() {
    frames++;
    if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
    else resolve({ fps: frames / ((performance.now() - t0) / 1000), calls: window.VD.debug.renderer.info.render.calls, tris: window.VD.debug.renderer.info.render.triangles });
  }
  requestAnimationFrame(tick);
}));
console.log('PERF', JSON.stringify(perf));
console.log('ERRORS', errors.length, JSON.stringify(errors.slice(0, 5)));
await browser.close();
