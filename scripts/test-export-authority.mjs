/** Controlled browser races exercise real export entry points; worker/encoding boundaries are held. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const origin = 'http://127.0.0.1:4189';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4189', '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin)).ok) { ready = true; break; } } catch (error) { if (i === 99) throw error; } await new Promise(resolve => setTimeout(resolve, 50)); }
  assert(ready);
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ acceptDownloads: true }); page.setDefaultTimeout(15_000);
  const downloads = []; const errors = [];
  page.on('download', file => downloads.push(file.suggestedFilename())); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin); await page.waitForFunction(() => !document.getElementById('genOverlay').classList.contains('visible') && document.getElementById('statsOverlay').textContent.includes('Vertices'));
  await page.evaluate(async () => {
    const state = await import('/src/state.ts'), mesh = await import('/src/mesh.ts'), exports = await import('/src/export.ts'), sbp = await import('/src/sbp-export.ts'), relief = await import('/src/relief-master.ts');
    window.modules = { state, mesh, exports, sbp, relief };
    Object.assign(state.STATE, state.DEFAULTS, { resolution: 16 }); mesh.generateNoiseMesh();
    const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) { window.releasePNG = () => nativeToBlob.call(this, callback, ...args); };
  });
  // Positive PNG control also checks captured filename despite a later rename.
  for (const changed of [false, true]) {
    const before = downloads.length;
    const nextDownload = changed ? null : page.waitForEvent('download');
    await page.evaluate(() => { const { state, exports } = window.modules; state.STATE.exportFormat = 'heightmap'; state.STATE.filename = 'captured'; window.exportJob = exports.doExport(); });
    await page.waitForFunction(() => typeof window.releasePNG === 'function');
    await page.evaluate(changed => {
      window.modules.state.STATE.filename = 'later-name';
      if (changed) { const input = document.getElementById('sl_frequency'); input.value = '0.12'; input.dispatchEvent(new Event('input', { bubbles: true })); }
      window.releasePNG(); window.releasePNG = null;
    }, changed);
    await page.evaluate(() => window.exportJob);
    if (changed) { assert.equal(downloads.length, before); assert.match(await page.locator('#toast').textContent(), /source changed/); }
    else assert.equal((await nextDownload).suggestedFilename(), 'captured_heightmap.png');
  }
  // Valid parsed masters, and the actual direct SBP worker handoff with held replacement timing.
  await page.evaluate(async () => {
    const { state, relief } = window.modules;
    const make = async z => relief.parseReliefMaster(await relief.encodeReliefMaster({ format: 'meshcraft-relief', version: 1, units: 'in', cols: 2, rows: 2, width: 2, height: 2, dtype: 'float32', rowOrder: 'bottom-up', heightOrigin: 'panel-back', backing: 0.1, stock: 0.75, triangulation: 'tl-br', mask: false }, new Float32Array(4).fill(z)));
    window.masterA = await make(0.3); window.masterB = await make(0.6);
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(input, ...rest) {
        if (!input.kind) { super.postMessage(input, ...rest); return; }
        window.handoff = { kind: input.kind, z: input.heightmap ? Array.from(input.heightmap.z) : null, config: input.config };
        setTimeout(() => this.onmessage({ data: { type: 'success', sbpBytes: new TextEncoder().encode("' controlled test boundary\n").buffer, stats: { roughingMoves: 0, finishingMoves: 0, totalLines: 1, heightmapCols: 2, heightmapRows: 2 } } }), 0);
      }
    };
    Object.assign(state.STATE, { mode: 'depthmap', reliefMaster: window.masterA });
  });
  for (const arrival of ['none', 'master', 'image', 'stl']) {
    const handoffDownload = arrival === 'none' ? page.waitForEvent('download') : null;
    const out = await page.evaluate(async arrival => {
      const { state, sbp } = window.modules;
      Object.assign(state.STATE, { mode: 'depthmap', reliefMaster: window.masterA, filename: 'captured-sbp', vertices: [[0.3, 0.3], [0.3, 0.3]], cols: 2, rows: 2 });
      sbp.SBP_STATE.stlBuffer = null; sbp.SBP_STATE.finishRasterAngle = 45; window.handoff = null;
      if (arrival === 'image') state.STATE.reliefMaster = null;
      const job = sbp.doSBPExport();
      state.STATE.filename = 'later-sbp'; sbp.SBP_STATE.finishRasterAngle = 90;
      if (arrival === 'master') state.STATE.reliefMaster = window.masterB;
      if (arrival === 'image') state.STATE.depthMap = new Image();
      if (arrival === 'stl') sbp.SBP_STATE.stlBuffer = new ArrayBuffer(84);
      await job; await new Promise(resolve => setTimeout(resolve, 10));
      const result = window.handoff; sbp.SBP_STATE.stlBuffer = null; return result;
    }, arrival);
    if (arrival === 'none') { assert(Math.abs(out.z[0] - 0.3) < 1e-6); assert.equal(out.config.finishRasterAngle, 45); assert.equal((await handoffDownload).suggestedFilename(), 'captured-sbp.sbp'); }
    else assert.equal(out, null, `${arrival} arrival refuses handoff`);
  }
  // Hold the real 3DM import request, edit through UI, then fail it. Fallback must also refuse.
  let releaseImport;
  await page.route('https://cdn.jsdelivr.net/**', async route => { await new Promise(resolve => { releaseImport = resolve; }); await route.abort(); });
  await page.evaluate(() => { const { state, mesh, exports } = window.modules; Object.assign(state.STATE, { mode: 'noise', exportFormat: '3dm', frequency: 0.1 }); mesh.generateNoiseMesh(); window.exportJob = exports.doExport(); });
  for (let i = 0; !releaseImport && i < 100; i++) await page.waitForTimeout(10);
  assert(releaseImport); const beforeFallback = downloads.length;
  await page.locator('#sl_frequency').evaluate(input => { input.value = '0.15'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  releaseImport(); await page.evaluate(() => window.exportJob);
  assert.equal(downloads.length, beforeFallback); assert.match(await page.locator('#toast').textContent(), /source changed/);
  // Unchanged-source failure still delivers the existing OBJ fallback.
  await page.unroute('https://cdn.jsdelivr.net/**');
  const positiveFallback = page.waitForEvent('download');
  await page.evaluate(() => window.modules.exports.doExport());
  assert.match((await positiveFallback).suggestedFilename(), /\.obj$/);
  // Hold a controlled Rhino API initializer after the actual dynamic import succeeds.
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'text/javascript', body: `
    class Mesh { vertices(){return {add:()=>undefined}} faces(){return {addTriFace:()=>undefined}} normals(){return {computeNormals:()=>undefined}} compact(){return undefined} delete(){return undefined} }
    class File { settings(){return {}} objects(){return {add:()=>undefined}} toByteArrayOptions(){return new Uint8Array([1,2,3])} delete(){return undefined} }
    export default function(){return new Promise(resolve=>{window.releaseRhino=()=>resolve({Mesh,File3dm:File,File3dmWriteOptions:class{},UnitSystem:{Inches:1}})})}
  ` }));
  // A failed dynamic-import module is cached by the browser; use a fresh document for the initializer case.
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('genOverlay').classList.contains('visible') && document.getElementById('statsOverlay').textContent.includes('Vertices'));
  const normalBefore = downloads.length;
  await page.evaluate(async () => {
    const state = await import('/src/state.ts'), mesh = await import('/src/mesh.ts'), exports = await import('/src/export.ts'), sbp = await import('/src/sbp-export.ts');
    window.modules = { state, mesh, exports, sbp };
    Object.assign(state.STATE, { mode: 'noise', resolution: 16, exportFormat: '3dm' }); mesh.generateNoiseMesh();
    window.exportJob = exports.doExport();
  });
  await page.waitForFunction(() => typeof window.releaseRhino === 'function');
  await page.locator('#sl_frequency').evaluate(input => { input.value = '0.2'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.evaluate(async () => { window.releaseRhino(); await window.exportJob; });
  assert.equal(downloads.length, normalBefore); assert.match(await page.locator('#toast').textContent(), /source changed/);
  const normalPositive = page.waitForEvent('download');
  await page.evaluate(() => window.modules.exports.doExport()); assert.match((await normalPositive).suggestedFilename(), /\.3dm$/);
  // The uploaded-STL branch reaches its own handoff synchronously, independently of noise work.
  const uploaded = await page.evaluate(async () => {
    const { state, mesh, sbp } = window.modules;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { postMessage(input, ...rest) {
      if (!input.kind) { super.postMessage(input, ...rest); return; }
      window.handoff = input;
      setTimeout(() => this.onmessage({ data: { type: 'error', message: 'Controlled STL handoff complete' } }), 0);
    } };
    state.STATE.frequency = 0.25; mesh.debouncedGenerate('frequency', 'preview');
    sbp.SBP_STATE.stlBuffer = new ArrayBuffer(84); window.handoff = null;
    const job = sbp.doSBPExport(); const immediate = window.handoff?.kind;
    await job; await new Promise(resolve => setTimeout(resolve, 10)); sbp.SBP_STATE.stlBuffer = null;
    return immediate;
  });
  assert.equal(uploaded, 'stl');
  assert.deepEqual(errors, []); process.stdout.write('Export authority races passed: PNG, master/image/STL handoff, captured filename/config, controlled Rhino initializer and network fallback.\n');
} finally { await browser?.close(); server.kill(); await new Promise(resolve => server.exitCode !== null || server.signalCode !== null ? resolve() : server.once('exit', resolve)); }
