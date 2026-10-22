import { chromium } from 'playwright-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://localhost:8765/index.html';
const HEADED = process.env.HEADED !== '0';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: !HEADED,
  args: [
    '--ignore-gpu-blocklist', '--enable-webgl',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--autoplay-policy=no-user-gesture-required'
  ]
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); errors.push(e.message); });
page.on('console', (m) => {
  if (m.type() === 'error') {
    const t = m.text().slice(0, 300);
    if (!/favicon|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(t)) console.log('CONSOLE', t);
  }
});

const results = [];
function check(name, ok, data) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (data === undefined ? '' : ' · ' + JSON.stringify(data)));
}

await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.VD && window.VD.debug, null, { timeout: 20000 });
await page.waitForTimeout(2400);
await page.bringToFront();
// Evita che il blur della finestra headed cancelli i tasti durante i test.
await page.evaluate(() => addEventListener('blur', (e) => e.stopImmediatePropagation(), true));

/* ------------------------------- boot ------------------------------- */
const boot = await page.evaluate(() => {
  const d = window.VD.debug;
  return {
    state: d.state, mode: d.mode, cars: d.traffic.cars.length,
    bodyInstances: d.traffic.bodies.count, calls: d.renderer.info.render.calls,
    tris: d.renderer.info.render.triangles, player: d.playerType,
    three: THREE.REVISION
  };
});
check('boot 120 auto istanziate', boot.cars === 120 && boot.bodyInstances === 120, boot);
check('menu iniziale', boot.state === 'menu', boot.state);
check('draw calls contenuti', boot.calls > 0 && boot.calls < 130, boot.calls);
await page.screenshot({ path: '/tmp/vd_qa_menu.png' });

/* ----------------------------- lobby / paddock ----------------------- */
await page.click('#startBtn');
await page.waitForTimeout(400);
const lobbyOpen = await page.evaluate(() => ({
  state: window.VD.debug.state,
  open: !document.getElementById('lobbyScreen').classList.contains('hidden'),
  modes: document.querySelectorAll('.lobby-mode').length,
  pilot: document.getElementById('pilotName').value
}));
check('lobby locale con nome pilota e modalità', lobbyOpen.state === 'menu' && lobbyOpen.open && lobbyOpen.modes === 6 && !!lobbyOpen.pilot, lobbyOpen);
await page.click('.lobby-mode[data-lobby-mode="lobby"]');
await page.click('#readyBtn');
await page.waitForTimeout(900);
const paddock = await page.evaluate(() => {
  const d = window.VD.debug;
  return {
    state: d.state, mode: d.mode, x: +d.physics.position.x.toFixed(1), z: +d.physics.position.z.toFixed(1),
    inPaddock: d.world.inPaddock(d.physics.position.x, d.physics.position.z),
    showCars: d.world.paddock.cars.length, mechanics: d.world.paddock.mechanics.length,
    zone: d.world.zoneName(d.physics.position.x, d.physics.position.z)
  };
});
check('READY porta nel paddock 3D', paddock.state === 'playing' && paddock.mode === 'lobby' && paddock.inPaddock && paddock.showCars === 3 && paddock.mechanics === 5, paddock);
await page.screenshot({ path: '/tmp/vd_qa_paddock.png' });

/* ----------------------------- guida libera -------------------------- */
await page.evaluate(() => window.VD.debug.startGame('free'));
await page.waitForTimeout(600);
await page.bringToFront();
await page.keyboard.down('KeyW');
await page.waitForTimeout(3200);
await page.keyboard.up('KeyW');
const drive = await page.evaluate(() => {
  const d = window.VD.debug;
  return { state: d.state, kmh: Math.round(d.physics.speed * 3.6), gear: d.physics.gear, rpm: Math.round(d.physics.rpm), mode: d.physics.autoMode };
});
check('accelerazione 0-100 in free roam', drive.kmh > 45 && drive.gear > 1, drive);
await page.screenshot({ path: '/tmp/vd_qa_free.png' });

/* --------------------------- cambio manuale -------------------------- */
await page.keyboard.press('KeyM');
await page.waitForTimeout(150);
const beforeShift = await page.evaluate(() => ({ gear: window.VD.debug.physics.gear, auto: window.VD.debug.physics.autoMode }));
await page.bringToFront();
await page.keyboard.press('KeyE');
await page.waitForTimeout(250);
const afterShift = await page.evaluate(() => ({ gear: window.VD.debug.physics.gear, auto: window.VD.debug.physics.autoMode, rpm: Math.round(window.VD.debug.physics.rpm), flash: window.VD.debug.physics.shiftFlash }));
check('cambio manuale Q/E', !beforeShift.auto && afterShift.gear >= beforeShift.gear, { beforeShift, afterShift });
await page.keyboard.press('KeyM');
await page.waitForTimeout(200);

/* ------------------------------ pausa ------------------------------- */
await page.keyboard.press('KeyP');
await page.waitForTimeout(300);
const paused = await page.evaluate(() => ({ state: window.VD.debug.state, overlay: !document.getElementById('pauseScreen').classList.contains('hidden') }));
await page.keyboard.press('KeyP');
await page.waitForTimeout(300);
const resumed = await page.evaluate(() => ({ state: window.VD.debug.state, overlay: document.getElementById('pauseScreen').classList.contains('hidden') }));
check('pausa e ripresa', paused.state === 'paused' && paused.overlay && resumed.state === 'playing' && resumed.overlay, { paused, resumed });

/* --------------------------- parcheggio PERFECT ---------------------- */
await page.evaluate(() => window.VD.debug.startGame('parking'));
await page.waitForTimeout(700);
await page.evaluate(() => {
  const d = window.VD.debug;
  const bay = d.world.parkingBays[0];
  d.physics.reset(bay.x, bay.z, bay.yaw);
});
await page.waitForTimeout(1800);
const parkPerfect = await page.evaluate(() => {
  const d = window.VD.debug;
  const bay = d.world.parkingBays[0];
  return {
    done: bay.done, perfect: bay.perfect, grade: bay.lastGrade, live: d.parking.grade,
    progress: +bay.progress.toFixed(2), perfectCount: d.records.perfect || 0,
    speed: +d.physics.speed.toFixed(3), angle: document.getElementById('parkAngle').textContent,
    offset: document.getElementById('parkOffset').textContent
  };
});
check('parcheggio PERFECT al millimetro', parkPerfect.done && parkPerfect.perfect && parkPerfect.grade === 'perfect', parkPerfect);
await page.screenshot({ path: '/tmp/vd_qa_parking.png' });

/* --------------------- parcheggio fuori linea ----------------------- */
await page.evaluate(() => window.VD.debug.startGame('parking'));
await page.waitForTimeout(500);
await page.evaluate(() => {
  const d = window.VD.debug;
  const bay = d.world.parkingBays[0];
  const p = d.world.bayWorld(bay, 1.5, 0);
  d.physics.reset(p.x, p.z, bay.yaw);
});
await page.waitForTimeout(1700);
const parkOut = await page.evaluate(() => {
  const d = window.VD.debug;
  const bay = d.world.parkingBays[0];
  return { done: bay.done, perfect: bay.perfect, grade: d.parking.grade, progress: +bay.progress.toFixed(2), offset: document.getElementById('parkOffset').textContent };
});
check('parcheggio fuori linea rifiutato', !parkOut.done && !parkOut.perfect && parkOut.grade === 'out', parkOut);

/* ------------------------ parcheggio storto ------------------------- */
await page.evaluate(() => window.VD.debug.startGame('parking'));
await page.waitForTimeout(500);
await page.evaluate(() => {
  const d = window.VD.debug;
  const bay = d.world.parkingBays[0];
  d.physics.reset(bay.x, bay.z, bay.yaw + 0.2);
});
await page.waitForTimeout(1700);
const parkAngle = await page.evaluate(() => {
  const d = window.VD.debug;
  const bay = d.world.parkingBays[0];
  return { done: bay.done, perfect: bay.perfect, grade: d.parking.grade, angle: document.getElementById('parkAngle').textContent };
});
check('parcheggio non parallelo non è PERFECT', !parkAngle.done && !parkAngle.perfect && parkAngle.grade === 'align', parkAngle);

/* ------------------------------- drag ------------------------------- */
await page.evaluate(() => window.VD.debug.startGame('drag'));
await page.waitForTimeout(250);
await page.bringToFront();
await page.keyboard.down('KeyS');
await page.keyboard.down('KeyW');
let staged = null;
for (let i = 0; i < 26; i++) {
  await page.waitForTimeout(200);
  const s = await page.evaluate(() => {
    const d = window.VD.debug;
    return { state: d.drag.state, countdown: +d.drag.countdown.toFixed(2), staged: d.physics.staged, rpm: Math.round(d.physics.rpm), speed: +d.physics.speed.toFixed(2), label: d.physics.launchLabel };
  });
  if (s.staged && s.rpm > 2500) {
    staged = s;
    if (s.state === 'running') break;
  }
}
check('drag staging con freno + gas', !!staged && staged.rpm > 2500, staged || { error: 'staging non rilevato' });
await page.keyboard.up('KeyS');
await page.waitForTimeout(450);
const launched = await page.evaluate(() => {
  const d = window.VD.debug;
  return { drag: d.drag.state, elapsed: +d.drag.elapsed.toFixed(2), rpm: Math.round(d.physics.rpm), label: d.physics.launchLabel, spin: +d.physics.wheelSpin.toFixed(2), speed: +d.physics.speed.toFixed(2) };
});
check('lancio drag e wheelspin', launched.speed > 0.5 && !!launched.label && launched.spin >= 0, launched);
await page.keyboard.up('KeyW');

await page.evaluate(() => {
  const d = window.VD.debug;
  d.drag.state = 'running';
  d.drag.elapsed = 11.11;
  d.physics.reset(0, 141, 0);
});
await page.waitForTimeout(350);
const dragFinish = await page.evaluate(() => {
  const d = window.VD.debug;
  return { state: d.drag.state, result: +d.drag.lastResult.toFixed(2), record: +(d.records.drag || 0).toFixed(2) };
});
check('traguardo drag e record', dragFinish.state === 'finished' && dragFinish.result > 10, dragFinish);
await page.screenshot({ path: '/tmp/vd_qa_drag.png' });

/* --------------------------- consegne / cargo ------------------------ */
await page.evaluate(() => window.VD.debug.startGame('delivery'));
await page.waitForTimeout(800);
const delStart = await page.evaluate(() => {
  const d = window.VD.debug;
  return { player: d.playerType, cubes: d.cargo ? d.cargo.cubes.length : 0, loaded: d.cargo && d.cargo.loaded };
});
check('pick-up con 3 cubi caricati', delStart.player === 'pickup' && delStart.cubes === 3 && delStart.loaded, delStart);
await page.evaluate(() => window.VD.debug.beginDelivery());
await page.waitForTimeout(250);
const delActive = await page.evaluate(() => ({ active: window.VD.debug.delivery.active, route: window.VD.debug.delivery.routeIndex }));
check('consegna avviata', delActive.active && delActive.route === 0, delActive);
await page.screenshot({ path: '/tmp/vd_qa_delivery.png' });

const cubeYBefore = await page.evaluate(() => {
  const d = window.VD.debug;
  const v = new THREE.Vector3();
  d.cargo.cubes[0].node.getWorldPosition(v);
  return +v.y.toFixed(2);
});
await page.evaluate(() => window.VD.debug.ejectCargo('QA TEST'));
await page.waitForTimeout(2400);
const ejected = await page.evaluate(() => {
  const d = window.VD.debug;
  return {
    failed: d.delivery.failed, active: d.delivery.active, loaded: d.cargo.loaded,
    seated: d.cargo.cubes.map((c) => c.seated), lost: d.cargo.cubes.map((c) => c.lost),
    y: +d.cargo.cubes[0].node.position.y.toFixed(2)
  };
});
check('carico perso = consegna fallita', ejected.failed && !ejected.active && !ejected.loaded && ejected.seated.every((s) => !s) && ejected.lost.every(Boolean), { cubeYBefore, ejected });

await page.evaluate(() => window.VD.debug.startGame('delivery'));
await page.waitForTimeout(400);
await page.evaluate(() => window.VD.debug.beginDelivery());
for (let i = 0; i < 3; i++) {
  await page.evaluate((idx) => {
    const d = window.VD.debug;
    const cp = d.world.delivery.route[idx];
    d.physics.reset(cp.x, cp.z, 0);
  }, i);
  await page.waitForTimeout(350);
}
const delDone = await page.evaluate(() => {
  const d = window.VD.debug;
  return { done: d.delivery.done, active: d.delivery.active, route: d.delivery.routeIndex, record: +(d.records.delivery || 0).toFixed(2), time: +d.delivery.time.toFixed(2) };
});
check('3 checkpoint = consegna completa', delDone.done && !delDone.active && delDone.route >= 3, delDone);

/* ------------------------------- drift ------------------------------ */
await page.evaluate(() => window.VD.debug.startGame('drift'));
await page.waitForTimeout(700);
await page.bringToFront();
await page.keyboard.down('KeyW');
await page.waitForTimeout(2200);
await page.keyboard.down('Space');
await page.keyboard.down('KeyA');
await page.waitForTimeout(1100);
const drift = await page.evaluate(() => {
  const d = window.VD.debug;
  return {
    zone: d.drift.zoneState, timeLeft: +d.drift.timeLeft.toFixed(1), score: Math.round(d.drift.score),
    livePoints: Math.round(d.drift.livePoints), drifting: d.physics.drifting,
    slip: +d.physics.slipAngle.toFixed(2), speed: Math.round(d.physics.speed * 3.6)
  };
});
await page.waitForTimeout(500);
check('drift con freno a mano e punti', drift.zone === 'running' && drift.score > 50 && drift.slip > 0.25, drift);
await page.keyboard.up('KeyA');
await page.keyboard.up('Space');
await page.keyboard.up('KeyW');
await page.screenshot({ path: '/tmp/vd_qa_drift.png' });

/* --------------------------- traffico a catena ---------------------- */
await page.evaluate(() => window.VD.debug.startGame('free'));
await page.waitForTimeout(500);
await page.bringToFront();
const smash = await page.evaluate(() => {
  const d = window.VD.debug;
  // Cluster deterministico: verifica la propagazione a catena del sistema.
  const pool = d.traffic.cars.filter((c) => !c.wreck).slice(0, 9);
  const base = pool[0];
  base.hitCooldown = 0;
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i];
    c.x = (i % 3) * 3.2;
    c.z = Math.floor(i / 3) * 3.2;
    c.y = d.world.heightAt(c.x, c.z);
    c.yaw = 0;
    c.hitCooldown = 0;
    d.traffic.setMatrixForCar(c);
  }
  base.hitCooldown = 0;
  d.traffic.smash(base, 24, 0, 22, 0);
  return { index: base.index, deform: +base.deform.toFixed(2) };
});
await page.waitForTimeout(900);
const chain = await page.evaluate(() => {
  const d = window.VD.debug;
  return { wrecked: d.traffic.cars.filter((c) => c.wreck).length, deform: +(d.traffic.cars.find((c) => c.wreck) || { deform: 0 }).deform.toFixed(2) };
});
check('catena di urti e deformazione', chain.wrecked >= 5 && chain.deform > 0.05, { smash, chain });
await page.screenshot({ path: '/tmp/vd_qa_smash.png' });

/* --------------------------- cambio auto UI ------------------------- */
await page.keyboard.press('KeyP');
await page.waitForTimeout(300);
await page.click('#menuBtn');
await page.waitForTimeout(500);
const menuBack = await page.evaluate(() => ({ state: window.VD.debug.state, cards: document.querySelectorAll('.car-card').length }));
check('ritorno al menu', menuBack.state === 'menu' && menuBack.cards === 4, menuBack);
await page.click('[data-car="pickup"]');
await page.click('#startBtn');
await page.waitForTimeout(300);
await page.click('#readyBtn');
await page.waitForTimeout(800);
const pickup = await page.evaluate(() => ({ player: window.VD.debug.playerType, cubes: window.VD.debug.cargo ? window.VD.debug.cargo.cubes.length : 0 }));
check('selezione pick-up dal menu', pickup.player === 'pickup' && pickup.cubes === 3, pickup);

await page.keyboard.press('KeyP');
await page.waitForTimeout(250);
await page.click('#menuBtn');
await page.waitForTimeout(350);
await page.click('[data-car="citycar"]');
await page.click('#startBtn');
await page.waitForTimeout(300);
await page.click('#readyBtn');
await page.waitForTimeout(700);
const city = await page.evaluate(() => ({ player: window.VD.debug.playerType, cargo: !!window.VD.debug.cargo }));
check('selezione citycar dal menu', city.player === 'citycar' && !city.cargo, city);

/* --------------------- mondo infinito / F1 -------------------------- */
const infinite = await page.evaluate(() => {
  const d = window.VD.debug;
  d.physics.reset(0, 1200, 0);
  d.world.update(0, 1200);
  return {
    z: +d.physics.position.z.toFixed(1),
    chunks: d.world.activeChunks.size,
    keys: [...d.world.activeChunks.keys()].slice(0, 2),
    highwayY: +d.world.heightAt(0, 1200).toFixed(2),
    zone: d.world.zoneName(0, 1200),
    dashes: d.world.highwayDashes.count
  };
});
check('mondo infinito oltre ±548 con streaming', infinite.z === 1200 && infinite.chunks === 25 && infinite.keys.length === 2 && infinite.dashes === 480 && infinite.zone === 'AUTOSTRADA INFINITA', infinite);

await page.keyboard.press('KeyP');
await page.waitForTimeout(250);
await page.click('#menuBtn');
await page.waitForTimeout(300);
await page.click('[data-car="f1"]');
await page.click('#startBtn');
await page.waitForTimeout(300);
await page.click('#readyBtn');
await page.waitForTimeout(600);
await page.evaluate(() => window.VD.debug.physics.reset(0, 900, 0));
await page.bringToFront();
await page.keyboard.down('KeyW');
await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(1800);
await page.keyboard.press('KeyF');
await page.waitForTimeout(3200);
const f1run = await page.evaluate(() => {
  const d = window.VD.debug;
  return {
    player: d.playerType, kmh: Math.round(d.physics.speed * 3.6), gear: d.physics.gear,
    drs: d.physics.drsActive, ers: +d.physics.ers.toFixed(2), tire: +d.physics.tireWear.toFixed(3),
    downforce: +d.physics.downforce.toFixed(1), hud: document.getElementById('drsState').textContent,
    panel: !document.getElementById('f1Panel').classList.contains('hidden')
  };
});
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');
check('F1 DRS + ERS + downforce + usura', f1run.player === 'f1' && f1run.kmh > 250 && f1run.drs && f1run.ers < 1 && f1run.tire > 0 && f1run.downforce > 0 && f1run.hud === 'APERTO' && f1run.panel, f1run);
await page.screenshot({ path: '/tmp/vd_qa_f1.png' });

const pit = await page.evaluate(async () => {
  const d = window.VD.debug;
  d.physics.reset(d.world.paddock.pit.x, d.world.paddock.pit.z, 0);
  d.physics.tireWear = 0.6;
  d.physics.ers = 0.1;
  await new Promise((r) => setTimeout(r, 500));
  return { wear: +d.physics.tireWear.toFixed(3), ers: +d.physics.ers.toFixed(2), pit: d.world.inPit(d.physics.position.x, d.physics.position.z) };
});
check('pit service gomme ed ERS', pit.pit && pit.wear < 0.05 && pit.ers > 0.99, pit);

/* ---------------------------- PWA / offline ------------------------- */
await page.waitForTimeout(900);
let pwa = {};
try {
  pwa = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((res) => setTimeout(() => res(null), 8000))
    ]);
    const keys = 'caches' in window ? await caches.keys() : [];
    return { supported: true, active: !!(reg && reg.active), script: reg && reg.active && reg.active.scriptURL, keys };
  });
} catch (e) { pwa = { error: e.message }; }
check('service worker v6 attivo', !!pwa.active && (pwa.keys || []).includes('voxel-drive-v6'), pwa);

let offlineBoot = null;
try {
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => window.VD && window.VD.debug, null, { timeout: 12000 });
  await page.waitForTimeout(900);
  offlineBoot = await page.evaluate(() => ({ state: window.VD.debug.state, cars: window.VD.debug.traffic.cars.length, three: THREE.REVISION }));
} catch (e) {
  offlineBoot = { error: e.message };
}
await context.setOffline(false);
check('avvio offline da cache PWA', !!offlineBoot && offlineBoot.cars === 120 && !offlineBoot.error, offlineBoot);

/* --------------------------- prestazioni ---------------------------- */
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.VD && window.VD.debug, null, { timeout: 20000 });
await page.waitForTimeout(2700);
await page.bringToFront();
const perf = await page.evaluate(() => new Promise((resolve) => {
  let frames = 0;
  const t0 = performance.now();
  function tick() {
    frames++;
    if (performance.now() - t0 < 2200) requestAnimationFrame(tick);
    else resolve({ fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1), calls: window.VD.debug.renderer.info.render.calls, tris: window.VD.debug.renderer.info.render.triangles });
  }
  requestAnimationFrame(tick);
}));
check('frame rate desktop', perf.fps >= 50, perf);

/* ------------------------- screenshot finale ------------------------ */
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.VD && window.VD.debug, null, { timeout: 20000 });
await page.waitForTimeout(2400);
await page.click('#startBtn');
await page.waitForTimeout(350);
await page.click('.lobby-mode[data-lobby-mode="free"]');
await page.click('#readyBtn');
await page.waitForTimeout(600);
await page.bringToFront();
await page.keyboard.down('KeyW');
await page.waitForTimeout(4200);
await page.keyboard.up('KeyW');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/vd_qa_final.png' });

console.log('\nQA SUMMARY', JSON.stringify({ passed: results.filter((r) => r.ok).length, total: results.length, failures: results.filter((r) => !r.ok).map((r) => r.name), pageErrors: errors.length }));
await browser.close();
