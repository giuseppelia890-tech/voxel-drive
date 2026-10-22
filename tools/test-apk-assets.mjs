import { chromium } from 'playwright-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'file:///private/var/folders/vm/_kzp21315m7b6y05ksfbgx3r0000gn/T/opencode/vd-apk-test/assets/www/index.html';
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: false,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--allow-file-access-from-files', '--disable-backgrounding-occluded-windows']
});
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); errors.push(e.message); });
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window.VD && window.VD.debug, null, { timeout: 20000 });
await page.waitForTimeout(2200);
const boot = await page.evaluate(() => ({
  state: window.VD.debug.state,
  cars: window.VD.debug.traffic.cars.length,
  three: THREE.REVISION,
  cdn: [...document.scripts].some((s) => s.src.includes('cdnjs')),
  vendor: [...document.scripts].some((s) => s.src.includes('vendor/three.min.js')),
  apkLink: getComputedStyle(document.querySelector('.apk-btn')).display
}));
console.log('APK BOOT', JSON.stringify(boot));
await page.evaluate(() => addEventListener('blur', (e) => e.stopImmediatePropagation(), true));
await page.click('#startBtn');
await page.waitForTimeout(350);
await page.click('#readyBtn');
await page.waitForTimeout(700);
await page.bringToFront();
await page.keyboard.down('KeyW');
await page.waitForTimeout(2300);
await page.keyboard.up('KeyW');
const drive = await page.evaluate(() => ({ kmh: Math.round(window.VD.debug.physics.speed * 3.6), gear: window.VD.debug.physics.gear, state: window.VD.debug.state }));
console.log('APK DRIVE', JSON.stringify(drive));
await page.screenshot({ path: '/tmp/vd_apk_file.png' });
console.log('APK ASSETS', boot.cars === 120 && !boot.cdn && boot.vendor && boot.apkLink === 'none' && drive.kmh > 30 && errors.length === 0 ? 'PASS' : 'FAIL');
await browser.close();
