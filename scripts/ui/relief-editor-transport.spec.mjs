import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {preview, createServer} from 'vite';

const version = Number((await readFile(new URL('../../src/state.ts', import.meta.url), 'utf8')).match(/CURRENT_PAYLOAD_VERSION = (\d+)/)[1]);
const config = {_v: version, noiseType: 'voronoi-relief', meshX: 8, meshY: 6, resolution: 32, reliefCellSize: 2, distortion: 0, reliefRadialFociCount: 0, reliefAttractorMode: 'none', reliefRelaxIterations: 0};
let server, browser, lastDownload = 0;
const only = process.argv.find(arg => arg.startsWith('--case='))?.slice(7);
const idle = async page => {await page.waitForFunction(() => !document.getElementById('genOverlay')?.classList.contains('visible')); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));};
async function save(page) {
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 250 - performance.now() + lastDownload))); lastDownload = performance.now();
  const waiting = page.waitForEvent('download'); await page.click('#btnSaveProject'); const stream = await (await waiting).createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString());
}
async function open(page, wire) {
  await page.locator('#cellProjectInput').setInputFiles({name: 'transport.mcproject', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wire))});
  await page.waitForFunction(() => !document.getElementById('cellEditorStatus')?.textContent?.includes('Preparing')); await idle(page);
  assert.doesNotMatch(await page.locator('#toast').innerText(), /Unsupported|Invalid|disagrees/);
}
function xy(wire, id) {const bytes = Buffer.from(wire.sites.xyFloat64LE, 'base64'), i = wire.sites.ids.indexOf(id); assert(i >= 0); return [bytes.readDoubleLE(i * 16), bytes.readDoubleLE(i * 16 + 8)];}
try {
  if (process.argv.includes('--dev')) {server = await createServer({server: {host: '127.0.0.1', port: 0}}); await server.listen();}
  else server = await preview({preview: {host: '127.0.0.1', port: 0, strictPort: true}});
  const address = server.httpServer.address(); assert(address && typeof address !== 'string'); const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch(); const context = await browser.newContext({viewport: {width: 1440, height: 900}}); await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage(), errors = []; context.on('page', p => p.on('pageerror', error => errors.push(error.message))); page.on('pageerror', error => errors.push(error.message));
  await context.route(/^https:\/\//, route => route.abort()); await page.goto(origin + '/?c=' + Buffer.from(JSON.stringify(config)).toString('base64url'));
  await idle(page); await page.click('#btnFreezeCells'); await idle(page); const initial = await save(page);
  if (!only || only === 'links') {
    const thin = structuredClone(initial); Object.assign(thin.params, {baseThickness: 0.1, amplitude: 0.1, resolution: 12, reliefRadialStrength: 4, reliefRadialFalloff: 0.02, offset: '-0'});
    await open(page, thin); assert.deepEqual((await save(page)).params, thin.params, 'accepted file retains every supplied source parameter');
    await page.click('#btnCopyLink'); const link = await page.evaluate(() => navigator.clipboard.readText());
    const fresh = await context.newPage(); await fresh.goto(link); await fresh.waitForFunction(() => document.getElementById('btnSaveProject') && !document.getElementById('btnSaveProject').disabled); await idle(fresh);
    assert.deepEqual((await save(fresh)).params, thin.params, 'actual imported project Copy Link and fresh page preserve all physical parameters'); await fresh.close();
    const payload = JSON.parse(Buffer.from(new URL(link).hash.slice(3), 'base64url').toString()); payload.baseThickness = null;
    const bad = await context.newPage(); await bad.goto(origin + '/#c=' + Buffer.from(JSON.stringify(payload)).toString('base64url'));
    await bad.waitForFunction(() => document.getElementById('toast')?.textContent?.includes('cell link is invalid')); await bad.close();
    process.stdout.write('Imported project, actual clipboard Copy Link, fresh adoption and corrupt frozen metadata refusal passed.\n');
  }
  const wrapped = structuredClone(initial), bytes = Buffer.alloc(32); [1, 1, 7, 5].forEach((value, i) => bytes.writeDoubleLE(value, i * 8));
  wrapped.sites = {count: 2, xyFloat64LE: bytes.toString('base64'), ids: [1, 0xffffffff], pinned: [0, 1], truncatedFrom: 0};
  for (const entry of ['pointer', 'keyboard']) {
    if (only && only !== entry) continue;
    await open(page, wrapped); await page.click('#cellTool_add'); await page.click('#btnResetCamera');
    if (entry === 'keyboard') await page.locator('#cellOverlay').press('Enter');
    else {
      const rect = await page.locator('#cellOverlay').boundingBox(), height = Math.max(6 * 1.15, 8 * 1.15 * rect.height / rect.width), inch = rect.height / height;
      await page.mouse.click(rect.x + rect.width / 2 - 1.5 * inch, rect.y + rect.height / 2);
    }
    await idle(page); const added = await save(page), id = added.sites.ids.find(value => !wrapped.sites.ids.includes(value)); assert.equal(id, 0, 'wrapped allocation uses the lowest unused identity');
    const addedXY = xy(added, id); assert(Math.abs(Number(await page.locator('#cellX').inputValue()) - addedXY[0]) < 1e-12, `${entry} Add selects its actual newly allocated identity`);
    assert.equal(Number(await page.locator('#cellY').inputValue()), addedXY[1]);
    await page.locator('#cellOverlay').press('ArrowRight'); await idle(page); const moved = await save(page); assert(Math.abs(xy(moved, id)[0] - addedXY[0] - 0.01) < 1e-12); assert.deepEqual(xy(moved, 0xffffffff), [7, 5], 'followup move leaves the old maximum ID untouched');
    await page.click('#btnCellUndo'); await idle(page); assert.deepEqual((await save(page)).sites, added.sites); await page.click('#btnCellRedo'); await idle(page); assert.deepEqual((await save(page)).sites, moved.sites);
    await page.locator('#cellOverlay').press('Delete'); await idle(page); const erased = await save(page); assert(!erased.sites.ids.includes(id)); assert(erased.sites.ids.includes(0xffffffff));
    await page.click('#btnCellUndo'); await idle(page); assert.deepEqual((await save(page)).sites, moved.sites); await page.click('#btnCellRedo'); await idle(page); assert.deepEqual((await save(page)).sites, erased.sites);
    await page.click('#btnCellUndo'); await page.click('#btnCellUndo'); await page.click('#btnCellUndo'); await idle(page); assert.deepEqual((await save(page)).sites, wrapped.sites);
    await page.click('#btnCellRedo'); await page.click('#btnCellRedo'); await page.click('#btnCellRedo'); await idle(page); assert.deepEqual((await save(page)).sites, erased.sites);
    process.stdout.write(`${entry} max-ID Add selection, move, Delete, Undo and Redo passed.\n`);
  }
  assert.deepEqual(errors, []);
} finally {if (browser) await browser.close(); if (server) {if (process.argv.includes('--dev')) await server.close(); else await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));}}
