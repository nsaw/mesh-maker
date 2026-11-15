import { restrictToAppOrigin } from './app-requests.mjs';
import assert from 'node:assert/strict';
import {readFile, mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {preview} from 'vite';

const version = Number((await readFile(new URL('../../src/state.ts', import.meta.url), 'utf8')).match(/CURRENT_PAYLOAD_VERSION = (\d+)/)[1]);
const config = {_v: version, noiseType: 'voronoi-relief', meshX: 8, meshY: 6, resolution: 48, reliefCellSize: 2, distortion: 0,
  reliefRadialFociCount: 0, reliefAttractorMode: 'none', reliefRelaxIterations: 0};
const idle = async page => { await page.waitForFunction(() => !document.getElementById('genOverlay')?.classList.contains('visible')); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
let server, browser, lastDownload = 0;
async function download(page, selector) {
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 250 - performance.now() + lastDownload))); lastDownload = performance.now();
  const wait = page.waitForEvent('download'); await page.click(selector); const stream = await (await wait).createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk); return Buffer.concat(chunks);
}
const save = async page => JSON.parse((await download(page, '#btnSaveProject')).toString());
async function matchesSource(page, expected) {
  const project = await save(page); if (expected) assert.deepEqual(project, expected, 'returning source preserves the retained exact document');
  await page.click('[data-fmt="stl"]'); const mesh = await download(page, '#btnExport');
  const bounds = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < mesh.readUInt32LE(80); i++) for (let j = 0; j < 3; j++) {
    const offset = 84 + i * 50 + 12 + j * 12, x = mesh.readFloatLE(offset), y = mesh.readFloatLE(offset + 4);
    bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.max(bounds[1], x); bounds[2] = Math.min(bounds[2], y); bounds[3] = Math.max(bounds[3], y);
  }
  assert.deepEqual(bounds, [0, project.params.meshX, 0, project.params.meshY], 'saved source and actual STL bounds agree'); return project;
}
async function assertSitePixel(page, point) {
  const hit = await page.locator('#cellOverlay').evaluate((canvas, p) => {
    const r = canvas.getBoundingClientRect(), scale = canvas.width / r.width, x = Math.round((p.x - r.x) * scale), y = Math.round((p.y - r.y) * scale);
    const data = canvas.getContext('2d').getImageData(x - 5, y - 5, 11, 11).data;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 110 && data[i + 1] > 120 && data[i + 1] < 205 && data[i + 2] > 210 && data[i + 3] > 200) return true;
    return false;
  }, point); assert(hit, 'actual overlay site follows the orthographic camera projection');
}
try {
  server = await preview({preview: {host: '127.0.0.1', port: 0, strictPort: true}}); const address = server.httpServer.address(); assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/?c=${Buffer.from(JSON.stringify(config)).toString('base64url')}`;
  browser = await chromium.launch(); await mkdir('screenshots/playwright', {recursive: true});
  if (!process.argv.includes('--touch-only')) {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}}), errors = []; page.on('pageerror', error => errors.push(error.message));
    await restrictToAppOrigin(page, url); await page.goto(url); await idle(page); await page.click('#btnFreezeCells'); await idle(page); const initial = await matchesSource(page);
    for (const route of ['preset', 'type']) {
      await page.selectOption('#selPreset', 'gentle-waves'); await page.click('#btnCellApply'); await idle(page);
      await page.click('[data-profile="rough"]'); await idle(page);
      const reset = page.locator('#sl_distortion').locator('..').locator('.control-reset'); await reset.click(); await idle(page);
      await page.click('.mode-tab[data-mode="depthmap"]'); await idle(page); await page.click('.mode-tab[data-mode="noise"]'); await idle(page);
      assert.equal(await page.locator('#selNoiseType').inputValue(), 'simplex', 'profile, reset and mode return keep the nonrelief source active');
      if (route === 'preset') await page.selectOption('#selPreset', 'relief-pockets'); else await page.selectOption('#selNoiseType', 'voronoi-relief');
      await idle(page); await matchesSource(page, initial); assert.equal(await page.locator('#selPreset').inputValue(), '', 'retained manual source clears the other algorithm preset tag');
      if (route === 'preset') {
        assert.match(await page.locator('#cellEditorStatus').innerText(), /Layout changes pending/);
        await page.screenshot({path: 'screenshots/playwright/relief-editor-return-preset.png'});
        page.once('dialog', dialog => dialog.accept());
        await page.click('#btnCellApply'); await idle(page); const applied = await matchesSource(page); assert.equal(applied.params.meshX, 12); assert.equal(applied.params.meshY, 24);
        await page.click('#btnCellUndo'); await idle(page); await matchesSource(page, initial); assert.match(await page.locator('#cellEditorStatus').innerText(), /Layout changes pending/);
        await page.click('#btnCellDiscard');
      }
    }
    assert.deepEqual(errors, []); await page.close(); process.stdout.write('Returning preset/type/profile/reset/mode sources agree with exact files and actual STL.\n');
  }
  if (!process.argv.includes('--source-only')) {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}, hasTouch: true}), errors = []; page.on('pageerror', error => errors.push(error.message));
    await restrictToAppOrigin(page, url); await page.goto(url); await idle(page); await page.click('[data-view="plan"]');
    const cdp = await page.context().newCDPSession(page);
    async function pinch() {
      const r = await page.locator('#canvasWrap').boundingBox(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: x - 40, y, id: 1}, {x: x + 40, y, id: 2}]});
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x - 60, y: y + 30, id: 1}, {x: x + 100, y: y + 30, id: 2}]});
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []}); await idle(page);
      assert.equal(Number(await page.locator('#sl_zoom').inputValue()), 2, 'real Plan pinch changes shared camera zoom');
    }
    await pinch(); await page.click('#btnResetCamera'); await page.click('#btnFreezeCells'); await idle(page); await page.click('#btnResetCamera');
    const before = await save(page), bytes = Buffer.from(before.sites.xyFloat64LE, 'base64'), rect = await page.locator('#cellOverlay').boundingBox();
    const height = Math.max(6 * 1.15, 8 * 1.15 * rect.height / rect.width), inch = rect.height / height;
    let index = 0, nearest = Infinity;
    for (let i = 0; i < before.sites.count; i++) { const d = Math.hypot(bytes.readDoubleLE(i * 16) - 4, bytes.readDoubleLE(i * 16 + 8) - 3); if (d < nearest) {nearest = d; index = i;} }
    const x = bytes.readDoubleLE(index * 16), y = bytes.readDoubleLE(index * 16 + 8), point = {x: rect.x + rect.width / 2 + (x - 4) * inch, y: rect.y + rect.height / 2 - (y - 3) * inch};
    await assertSitePixel(page, point);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{...point, id: 1}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: point.x + 30, y: point.y, id: 1}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: point.x + 30, y: point.y, id: 1}, {x: point.x + 70, y: point.y, id: 2}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []}); await idle(page); assert.deepEqual((await save(page)).sites, before.sites, 'second finger and touchcancel restore the entire site transaction');
    await pinch(); assert.deepEqual((await save(page)).sites, before.sites, 'pinch and pan never edit sites');
    const moved = {x: rect.x + rect.width / 2 + (x - 4) * inch * 2 + 20, y: rect.y + rect.height / 2 - (y - 3) * inch * 2 + 30}; await assertSitePixel(page, moved);
    await page.mouse.move(moved.x, moved.y); await page.mouse.down(); await page.mouse.move(moved.x + inch * 2, moved.y, {steps: 4}); await page.mouse.up(); await idle(page);
    const edited = await save(page), editedX = Buffer.from(edited.sites.xyFloat64LE, 'base64').readDoubleLE(index * 16); assert(Math.abs(editedX - x - 1) < 0.01, `post-pinch drag maps one inch through the actual orthographic camera: ${editedX - x}`);
    await page.click('#btnCellUndo'); await idle(page); assert.deepEqual((await save(page)).sites, before.sites); assert.deepEqual(errors, []); await page.close();
    process.stdout.write('Actual CDP Plan/non-editor pinch, pan projection, second-finger cancellation and post-camera one-inch editing passed.\n');
  }
} finally { if (browser) await browser.close(); if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve())); }
