import assert from 'node:assert/strict';
import {readFile, mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {preview} from 'vite';

const source = await readFile(new URL('../../src/state.ts', import.meta.url), 'utf8');
const version = Number(source.match(/CURRENT_PAYLOAD_VERSION = (\d+)/)?.[1]);
const config = {_v: version, noiseType: 'voronoi-relief', meshX: 8, meshY: 6, resolution: 48, reliefCellSize: 2,
  distortion: 0, reliefRadialFociCount: 0, reliefAttractorMode: 'none', reliefRelaxIterations: 0};
const encoded = Buffer.from(JSON.stringify(config)).toString('base64url');
const xy = project => {const bytes = Buffer.from(project.sites.xyFloat64LE, 'base64'); return Array.from({length: project.sites.count * 2}, (_, i) => bytes.readDoubleLE(i * 8));};
let server, browser, lastDownloadAt = 0;
async function download(page, button) {
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 250 - (performance.now() - lastDownloadAt))));
  lastDownloadAt = performance.now();
  const waiting = page.waitForEvent('download', {timeout: 8000}); await page.click(button); let file; try {file = await waiting;} catch (error) {process.stderr.write(await page.locator('#toast').innerText() + '\n'); await page.screenshot({path:'screenshots/playwright/editor-failure.png'}); throw error;}
  const stream = await file.createReadStream(), chunks = []; for await (const chunk of stream) chunks.push(chunk); return Buffer.concat(chunks);
}
const save = async page => JSON.parse((await download(page, '#btnSaveProject')).toString());
async function dxf(page) { await page.click('[data-fmt="dxf"]'); const text = await download(page, '#btnExport'); await page.click('[data-fmt="stl"]'); return text; }
const unloadGuard = page => page.evaluate(() => {const event = new Event('beforeunload', {cancelable:true}); window.dispatchEvent(event); return event.defaultPrevented;});
const idle = async page => {await page.waitForFunction(() => !document.getElementById('genOverlay')?.classList.contains('visible'));};
async function point(page, x, y) {
  const rect = await page.locator('#cellOverlay').boundingBox(); assert(rect);
  const height = Math.max(6 * 1.15, 8 * 1.15 * rect.height / rect.width), width = height * rect.width / rect.height;
  return {x: rect.x + rect.width / 2 + (x - 4) * rect.width / width, y: rect.y + rect.height / 2 - (y - 3) * rect.height / height, inch: rect.width / width};
}
try {
  server = await preview({preview: {host: '127.0.0.1', port: 0, strictPort: true}});
  const address = server.httpServer.address(); assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/?c=${encoded}`;
  browser = await chromium.launch();
  await mkdir('screenshots/playwright', {recursive: true});
  const page = await browser.newPage({viewport: {width: 1440, height: 900}}), errors = [];
  page.on('pageerror', error => {errors.push(error.message); process.stderr.write(error.stack + '\n');});
  await page.route(/^https:\/\//, route => route.abort());
  await page.goto(url); await idle(page); await page.click('#btnFreezeCells');
  await page.waitForSelector('#cellOverlay', {state: 'visible'}); await idle(page);
  await page.click('#btnZoomExtents'); await page.click('#btnResetCamera');
  assert.equal(await unloadGuard(page), true, 'a newly frozen unsaved document protects navigation');
  const initial = await save(page), before = await download(page, '#btnExport'), initialXY = xy(initial), beforeDxf = await dxf(page);
  assert.match(beforeDxf.toString(), /CUT_INNER/); assert.equal(await unloadGuard(page), false, 'a saved unchanged source is clean');
  const index = initial.sites.ids.findIndex((_, i) => initialXY[i * 2] > 1 && initialXY[i * 2] < 6 && initialXY[i * 2 + 1] > 1 && initialXY[i * 2 + 1] < 5); assert(index >= 0);
  const start = await point(page, initialXY[index * 2], initialXY[index * 2 + 1]);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + start.inch, start.y, {steps: 8}); await page.mouse.up(); await idle(page);
  const moved = await save(page), movedXY = xy(moved);
  assert(Math.abs(movedXY[index * 2] - initialXY[index * 2] - 1) < 0.02, 'actual mouse drag moves the producer site one inch');
  assert.notDeepEqual(await dxf(page), beforeDxf, 'the same completed-source cell boundary graph changes with a one-inch move');
  const owner = (coords, x, y) => {let best = Infinity, id = -1; for (let i = 0; i < coords.length / 2; i++) {const d = (coords[i*2]-x)**2 + (coords[i*2+1]-y)**2; if (d < best) {best = d; id = i;}} return id;};
  assert(Array.from({length: 4096}, (_, i) => [i % 64 / 63 * 8, Math.floor(i / 64) / 63 * 6]).some(([x,y]) => owner(initialXY,x,y) !== owner(movedXY,x,y)), 'the actual Euclidean owner oracle changes after the drag');
  assert.notDeepEqual(await download(page, '#btnExport'), before, 'the actual exported mesh changes after the edit');
  await page.click('#btnCellUndo'); await idle(page);
  assert.deepEqual(await download(page, '#btnExport'), before, 'one undo restores all emitted STL bytes');
  assert.deepEqual((await save(page)).sites, initial.sites);
  assert.deepEqual(await dxf(page), beforeDxf, 'Undo restores the complete ownership boundary network');
  await page.mouse.click(start.x, start.y);
  await page.locator('#cellOverlay').press('Tab'); assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'cellOverlay', 'Tab leaves the plan canvas');
  await page.locator('#cellOverlay').press('ArrowRight'); await idle(page);
  assert.equal(xy(await save(page))[index * 2], initialXY[index * 2] + 0.01);
  await page.click('#btnCellUndo'); await idle(page);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + start.inch, start.y);
  await page.locator('#cellOverlay').dispatchEvent('pointercancel', {pointerId: 1, pointerType: 'mouse'}); await page.mouse.up(); await idle(page);
  assert.deepEqual((await save(page)).sites, initial.sites, 'pointercancel rolls the actual mouse transaction back');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x:start.x,y:start.y,id:1}]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x:start.x+start.inch,y:start.y,id:1}]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x:start.x+start.inch,y:start.y,id:1},{x:start.x+start.inch+30,y:start.y+30,id:2}]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []}); await idle(page);
  assert.deepEqual((await save(page)).sites, initial.sites, 'second real touch cancels the transaction');
  await page.mouse.click(start.x, start.y); await page.check('#cellPinned');
  let pinned = await save(page); assert.equal(pinned.sites.pinned[index], 1);
  const otherIndex = (index + 1) % pinned.sites.count, otherPoint = await point(page, initialXY[otherIndex * 2], initialXY[otherIndex * 2 + 1]);
  await page.mouse.click(otherPoint.x, otherPoint.y); await page.check('#cellPinned'); pinned = await save(page);
  await page.click('#cellTool_erase'); await page.mouse.click(start.x, start.y); await idle(page);
  const erased = await save(page); assert.equal(erased.sites.count, initial.sites.count - 1); assert(!erased.sites.ids.includes(initial.sites.ids[index])); assert.equal(erased.sites.pinned[erased.sites.ids.indexOf(initial.sites.ids[otherIndex])], 1);
  await page.click('#cellTool_add'); const addPoint = await point(page, 0.3, 0.3); await page.mouse.click(addPoint.x, addPoint.y); await idle(page);
  const added = await save(page); assert.equal(added.sites.count, initial.sites.count);
  for (const id of erased.sites.ids) {assert(added.sites.ids.includes(id), 'surviving cell identities persist'); assert.equal(added.sites.pinned[added.sites.ids.indexOf(id)], erased.sites.pinned[erased.sites.ids.indexOf(id)], 'surviving pins persist through Add');}
  await page.locator('#cellProjectInput').setInputFiles({name: 'exact.mcproject', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pinned))});
  await page.waitForFunction(() => document.getElementById('cellEditorStatus')?.textContent?.includes('No unsaved source changes.')); await idle(page);
  assert.deepEqual((await save(page)).sites, pinned.sites, 'Save/Open preserves exact Float64 sites, identities and pins');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#btnCopyLink'); const linked = await page.evaluate(() => navigator.clipboard.readText());
  const payload = JSON.parse(Buffer.from(new URL(linked).hash.slice(3), 'base64url').toString()), ids = Buffer.from(payload._sites.identities, 'base64');
  assert.deepEqual(Array.from({length: payload._sites.count}, (_, i) => ids.readUInt32LE(i * 4)), pinned.sites.ids);
  assert.deepEqual(Array.from(Buffer.from(payload._sites.pins, 'base64')), pinned.sites.pinned);
  const linkedPage = await browser.newPage({viewport: {width:1440,height:900}}); await linkedPage.route(/^https:\/\//, route => route.abort());
  const solidLink = new URL(linked); solidLink.hash = 'c=' + Buffer.from(JSON.stringify({...payload, viewMode:'solid'})).toString('base64url');
  await linkedPage.goto(solidLink.toString()); await idle(linkedPage); await linkedPage.waitForFunction(() => !document.getElementById('btnSaveProject')?.disabled);
  assert.equal(await unloadGuard(linkedPage), false, 'initial frozen-link adoption is clean');
  await linkedPage.click('#cellTool_move'); await linkedPage.waitForFunction(() => document.getElementById('cellGraphStatus')?.textContent?.includes('boundaries and DXF use'));
  await linkedPage.locator('#cellOverlay').press('PageDown'); await linkedPage.locator('#cellOverlay').press('ArrowRight');
  assert.equal(await unloadGuard(linkedPage), true, 'editing an adopted link protects navigation');
  await linkedPage.locator('#cellOverlay').press('Delete'); await idle(linkedPage); assert.equal((await save(linkedPage)).sites.count,pinned.sites.count-1);
  await linkedPage.click('#cellTool_add'); await linkedPage.locator('#cellOverlay').press('Enter'); await idle(linkedPage); assert.equal((await save(linkedPage)).sites.count,pinned.sites.count);
  await linkedPage.click('#btnCellUndo'); await linkedPage.click('#btnCellUndo'); await linkedPage.click('#btnCellUndo'); await idle(linkedPage);
  const reopenedLink = await save(linkedPage); assert.deepEqual(reopenedLink.sites.ids, pinned.sites.ids); assert.deepEqual(reopenedLink.sites.pinned, pinned.sites.pinned); await linkedPage.close();
  await page.locator('#cellProjectInput').setInputFiles({name: 'corrupt.mcproject', mimeType: 'application/json', buffer: Buffer.from('{')});
  await page.waitForFunction(() => document.getElementById('toast')?.textContent?.includes('JSON')); assert.deepEqual((await save(page)).sites, pinned.sites);
  await page.evaluate(() => {
    window.editorNativeWorker = window.Worker;
    window.Worker = class extends window.editorNativeWorker {
      constructor(url, options) { super(url, options); this.editorJob = String(url).includes('relief-editor-worker'); }
      postMessage(...args) { if (this.editorJob) throw new Error('Injected project Worker failure'); super.postMessage(...args); }
    };
  });
  await page.locator('#cellProjectInput').setInputFiles({name: 'worker-error.mcproject', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pinned))});
  await page.waitForFunction(() => document.getElementById('toast')?.textContent?.includes('Injected project Worker failure'));
  assert.deepEqual((await save(page)).sites, pinned.sites, 'Worker preflight errors preserve the current document');
  await page.evaluate(() => {window.Worker = window.editorNativeWorker;});
  await page.evaluate(() => {
    window.Worker = class extends window.editorNativeWorker {
      constructor(url, options) { super(url, options); this.editorJob = String(url).includes('relief-editor-worker'); }
      postMessage(...args) { if (this.editorJob) {window.releaseEditorPreflight = () => super.postMessage(...args); window.editorPreflightHeld = true;} else super.postMessage(...args); }
    };
  });
  await page.locator('#cellProjectInput').setInputFiles({name: 'late.mcproject', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pinned))});
  await page.waitForFunction(() => window.editorPreflightHeld);
  await page.click('#cellTool_move');
  await page.mouse.click(start.x, start.y); await page.locator('#cellOverlay').press('ArrowRight'); await idle(page);
  const newer = await save(page); assert.notDeepEqual(newer.sites, pinned.sites);
  await page.evaluate(() => {window.releaseEditorPreflight(); window.Worker = window.editorNativeWorker;});
  await page.waitForTimeout(100); assert.deepEqual((await save(page)).sites, newer.sites, 'late Worker import cannot replace a newer keyboard edit');
  await page.click('#btnCellUndo'); await idle(page);
  await page.locator('#sl_reliefCellSize').evaluate(el => {el.value = '1'; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true}));});
  assert.match(await page.locator('#cellEditorStatus').innerText(), /Layout changes pending/);
  assert.equal(await unloadGuard(page), true, 'pending layout protects navigation even when the applied source was saved');
  assert.deepEqual((await save(page)).sites, pinned.sites, 'placement settings cannot replace manual sites implicitly');
  await page.click('#btnCellDiscard');
  await page.locator('#sl_reliefDepthVariation').evaluate(el => {el.value = '0.6'; el.dispatchEvent(new Event('input', {bubbles: true}));});
  assert.match(await page.locator('#cellEditorStatus').innerText(), /Layout changes pending/);
  assert.equal((await save(page)).params.reliefDepthVariation, pinned.params.reliefDepthVariation, 'site-deletion depth variation is staged too');
  await page.click('#btnCellDiscard');
  const matrixBefore = await save(page);
  await page.evaluate(() => {
    window.originalImage = window.Image;
    window.Image = function(...args) {
      const image = new window.originalImage(...args);
      Object.defineProperty(image, 'onload', {set(listener) {image.addEventListener('load', event => {window.releaseImageLoad = () => listener.call(image, event); window.imageLoadHeld = true;}, {once:true});}});
      return image;
    };
  });
  const png = await page.evaluate(() => {const canvas = document.createElement('canvas'); canvas.width=20; canvas.height=10; return canvas.toDataURL('image/png').split(',')[1];});
  await page.click('[data-mode="depthmap"]'); await page.locator('#depthMapInput').setInputFiles({name:'writer-census.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(() => window.imageLoadHeld); await page.click('[data-mode="noise"]'); await idle(page);
  await page.evaluate(() => {window.releaseImageLoad(); window.Image = window.originalImage;}); await idle(page);
  assert.deepEqual((await save(page)).params, matrixBefore.params, 'late image callback cannot take Noise dimensions from its retained document');
  await page.click('[data-mode="depthmap"]'); await page.waitForFunction(() => document.querySelector('#uploadZone .upload-text')?.textContent === 'writer-census.png');
  await page.click('[data-mode="noise"]'); await idle(page); assert.deepEqual((await save(page)).params, matrixBefore.params);
  await page.click('#btnAspectLock'); await page.locator('#sl_meshX').evaluate(element => {element.value='10';element.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(Number(await page.locator('#sl_meshY').inputValue()),5,'manual dimensions use the same locked image aspect fit');
  assert.deepEqual((await save(page)).params,matrixBefore.params,'locked dimensions remain pending');
  await page.click('#btnCellUndo'); await page.click('#btnCellUndo'); await page.click('#btnAspectLock');
  await page.selectOption('#selPreset','relief-pockets'); assert.equal(Number(await page.locator('#sl_meshY').inputValue()),24);
  assert.deepEqual((await save(page)).params,matrixBefore.params,'presets cannot replace frozen sites without Apply'); await page.click('#btnCellDiscard');
  await page.click('#profile_rough'); const profiled = await save(page); assert.deepEqual(profiled.sites,matrixBefore.sites); assert.deepEqual(profiled.params,matrixBefore.params); assert.equal(Number(await page.locator('#sl_distortion').inputValue()),0.3,'a placement-changing profile is pending');
  await page.click('#btnCellUndo'); await idle(page); assert.deepEqual((await save(page)).params,matrixBefore.params);
  await page.locator('#seedInput').fill('-17'); await page.locator('#seedInput').dispatchEvent('change'); assert.equal((await save(page)).params.seed,matrixBefore.params.seed); assert.equal(await page.locator('#seedInput').inputValue(),'-17');
  await page.click('#btnCellUndo'); assert.equal(await page.locator('#seedInput').inputValue(),String(matrixBefore.params.seed));
  await page.locator('#sl_amplitude').evaluate(element=>{element.value='0.4';element.dispatchEvent(new Event('input',{bubbles:true}));}); await idle(page);
  await page.click('#reset_sl_amplitude'); await idle(page); assert.equal((await save(page)).params.amplitude,0.5);
  await page.click('#btnCellUndo'); await page.click('#btnCellUndo'); await idle(page); assert.deepEqual((await save(page)).params,matrixBefore.params);
  await page.check('#sl_reliefInvertProfile'); await idle(page); assert.equal((await save(page)).params.reliefInvertProfile,1); assert.equal(await page.locator('#sl_reliefPillow').isVisible(),false);
  await page.click('#btnCellUndo'); await idle(page); assert.equal(await page.locator('#sl_reliefInvertProfile').isChecked(),false); assert.equal(await page.locator('#sl_reliefPillow').isVisible(),true);
  const couplingBefore = await save(page), couplingMesh = await download(page, '#btnExport');
  await page.uncheck('#chkWatertight'); await idle(page); const openSurface = await save(page); assert.equal(openSurface.params.watertight, false); assert.deepEqual(openSurface.sites, couplingBefore.sites);
  await page.click('#btnCellUndo'); await idle(page); assert.equal(await page.locator('#chkWatertight').isChecked(), true); assert.deepEqual(await download(page, '#btnExport'), couplingMesh, 'Watertight undo restores the source and control together');
  const changeNumber = async (key, value) => page.locator('#sl_' + key).evaluate((element, number) => {element.value = String(number); element.dispatchEvent(new Event('input', {bubbles:true})); element.dispatchEvent(new Event('change', {bubbles:true}));}, value);
  await changeNumber('baseThickness', 0.3); await idle(page);
  const thin = await save(page); assert.equal(thin.params.baseThickness, 0.3); assert.equal(thin.params.amplitude, 0.3);
  assert.equal(Number(await page.locator('#sl_amplitude').getAttribute('max')), 0.3); assert.equal(Number(await page.locator('#val_amplitude').innerText()), 0.3);
  assert(Number(await page.locator('#sl_sbpSafeZ').inputValue()) >= 0.5, 'stock edit also executes shared clearance synchronization');
  await page.click('#btnCellUndo'); await idle(page); assert.deepEqual((await save(page)).params, couplingBefore.params); assert.deepEqual(await download(page, '#btnExport'), couplingMesh);
  await page.selectOption('#sl_reliefAttractorMode', 'point');
  assert.equal(await page.locator('#sl_reliefAttractorX').isVisible(), true, 'pending mode reveals its anchor controls without Apply');
  assert.equal((await save(page)).params.reliefAttractorMode, 'none', 'visibility reads the draft while exports retain the applied source');
  await changeNumber('baseThickness', 0.3);
  assert.equal(Number(await page.locator('#sl_amplitude').getAttribute('max')), 0.3);
  assert.deepEqual((await save(page)).params, couplingBefore.params, 'stock/depth changes remain pending with a layout draft');
  await page.click('#btnCellApply'); await page.waitForFunction(() => !document.getElementById('cellEditorStatus')?.textContent?.includes('Preparing')); await idle(page);
  const appliedCoupling = await save(page); assert.equal(appliedCoupling.params.reliefAttractorMode, 'point'); assert.equal(appliedCoupling.params.baseThickness, 0.3); assert.equal(appliedCoupling.params.amplitude, 0.3);
  await page.click('#btnCellUndo'); await idle(page); assert.deepEqual((await save(page)).params, couplingBefore.params); assert.deepEqual(await download(page, '#btnExport'), couplingMesh);
  assert.equal(await page.locator('#sl_reliefAttractorX').isVisible(), true, 'Undo Apply restores the prior pending mode and source');
  assert.equal(Number(await page.locator('#sl_amplitude').getAttribute('max')), 0.3);
  await page.click('#btnCellUndo'); assert.equal(Number(await page.locator('#sl_amplitude').getAttribute('max')), couplingBefore.params.baseThickness);
  await page.click('#btnCellUndo'); assert.equal(await page.locator('#sl_reliefAttractorX').isVisible(), false, 'Undo the mode draft restores original visibility');
  for (const mode of ['solid', 'wireframe', 'both', 'points', 'plan']) {await page.click(`[data-view="${mode}"]`); await idle(page);}
  await page.click('[data-mode="depthmap"]'); await page.click('[data-mode="noise"]'); await idle(page);
  assert.deepEqual((await save(page)).sites, pinned.sites, 'mode navigation retains the procedural authoring document');
  await page.waitForFunction(() => document.getElementById('cellGraphStatus')?.textContent?.includes('boundaries and DXF use'));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({path: 'screenshots/playwright/relief-editor-1440.png'});
  assert.deepEqual(errors, []);
  await page.close();
  const invalidLinkPage = await browser.newPage({viewport: {width: 390, height: 664}}), invalidErrors = [];
  invalidLinkPage.on('pageerror', error => invalidErrors.push(error.message));
  await invalidLinkPage.route(/^https:\/\//, route => route.abort());
  await invalidLinkPage.goto(url.split('?')[0] + '?c=' + Buffer.from(JSON.stringify({...payload, frequency: -1})).toString('base64url'));
  await invalidLinkPage.waitForFunction(() => document.getElementById('toast')?.textContent?.includes('cell link is invalid'));
  await idle(invalidLinkPage); assert.deepEqual(invalidErrors, [], 'invalid frozen metadata refuses before automatic document adoption');
  await invalidLinkPage.close();
  const handlePage = await browser.newPage({viewport: {width: 1440, height: 900}});
  await handlePage.route(/^https:\/\//, route => route.abort());
  const handleConfig = {...config, reliefRadialFociCount: 1, reliefRadialFocus1X: 0.3, reliefRadialFocus1Y: 0.5,
    reliefAttractorMode: 'point', reliefAttractorX: 0.7, reliefAttractorY: 0.7, reliefDensityStrength: 1.8};
  await handlePage.goto(url.split('?')[0] + '?c=' + Buffer.from(JSON.stringify(handleConfig)).toString('base64url'));
  await idle(handlePage); await handlePage.click('#btnFreezeCells'); await idle(handlePage); await handlePage.click('#btnZoomExtents'); await handlePage.click('#btnResetCamera');
  const handleInitial = await save(handlePage);
  for (const [xKey, yKey] of [['reliefRadialFocus1X', 'reliefRadialFocus1Y'], ['reliefAttractorX', 'reliefAttractorY']]) {
    const startHandle = await point(handlePage, handleInitial.params[xKey] * 8, handleInitial.params[yKey] * 6);
    await handlePage.mouse.move(startHandle.x, startHandle.y); await handlePage.mouse.down();
    await handlePage.mouse.move(startHandle.x + startHandle.inch * 1.5, startHandle.y, {steps: 6}); await handlePage.mouse.up();
    assert.match(await handlePage.locator('#cellEditorStatus').innerText(), /Layout changes pending/);
    const handlePending = await save(handlePage);
    assert.deepEqual(handlePending.sites, handleInitial.sites); assert.deepEqual(handlePending.params, handleInitial.params, 'a dragged placement handle remains unapplied in an exact saved source');
    const pendingX = Number(await handlePage.locator('#sl_' + xKey).inputValue());
    assert(Math.abs(pendingX - handleInitial.params[xKey] - 1.5 / 8) < 0.01);
    await handlePage.click('#btnCellUndo'); assert.doesNotMatch(await handlePage.locator('#cellEditorStatus').innerText(), /Layout changes pending/);
    assert(await handlePage.locator('#btnCellUndo').isDisabled(), 'one handle gesture is one checkpoint');
    await handlePage.click('#btnCellRedo'); assert.equal(Number(await handlePage.locator('#sl_' + xKey).inputValue()), pendingX);
    const pendingPoint = await point(handlePage, pendingX * 8, handleInitial.params[yKey] * 6);
    await handlePage.mouse.move(pendingPoint.x, pendingPoint.y); await handlePage.mouse.down();
    await handlePage.mouse.move(pendingPoint.x - pendingPoint.inch / 3, pendingPoint.y);
    await handlePage.locator('#cellOverlay').dispatchEvent('pointercancel', {pointerId: 1, pointerType: 'mouse'}); await handlePage.mouse.up();
    assert.equal(Number(await handlePage.locator('#sl_' + xKey).inputValue()), pendingX, 'cancel restores the prior pending handle position');
    await handlePage.click('#btnCellApply'); await handlePage.waitForFunction(() => !document.getElementById('cellEditorStatus')?.textContent?.includes('Preparing')); await idle(handlePage);
    const appliedHandle = await save(handlePage);
    assert.equal(appliedHandle.params[xKey], pendingX); assert.notDeepEqual(appliedHandle.sites, handleInitial.sites, 'Apply replaces the layout from the pending handle');
    await handlePage.click('#btnCellUndo'); await idle(handlePage); assert.deepEqual((await save(handlePage)).sites, handleInitial.sites);
    assert.match(await handlePage.locator('#cellEditorStatus').innerText(), /Layout changes pending/);
    await handlePage.click('#btnCellUndo'); assert.doesNotMatch(await handlePage.locator('#cellEditorStatus').innerText(), /Layout changes pending/);
  }
  await handlePage.close();
  for (const width of [390, 430]) {
    const phone = await browser.newPage({viewport: {width, height: 664}, isMobile: true, hasTouch: true});
    await phone.route(/^https:\/\//, route => route.abort()); await phone.goto(url); await idle(phone);
    await phone.click('#tab-generator');
    if (await phone.locator('.cell-editor .section-header').getAttribute('aria-expanded') === 'false') await phone.click('.cell-editor .section-header');
    await phone.click('#btnFreezeCells'); await phone.waitForSelector('#cellOverlay', {state: 'visible'}); await idle(phone);
    const targets = await phone.locator('.cell-editor-actions button').evaluateAll(buttons => buttons.filter(button => !button.hidden).map(button => ({id: button.id, height: button.getBoundingClientRect().height, size: parseFloat(getComputedStyle(button).fontSize)})));
    for (const target of targets) {assert(target.height >= 44, target.id); assert(target.size >= 13, target.id);}
    const pinTarget = await phone.locator('#cellPinned').evaluate(input => { const box = input.closest('label').getBoundingClientRect(); return {width: box.width, height: box.height}; });
    assert(pinTarget.width >= 44 && pinTarget.height >= 44, 'pin label remains a 44px touch target');
    await phone.locator('#sheetHandle').press('End'); await phone.locator('.cell-editor').scrollIntoViewIfNeeded();
    await phone.screenshot({path: `screenshots/playwright/relief-editor-controls-${width}.png`});
    await phone.locator('#sheetHandle').focus(); await phone.keyboard.press('Home');
    const stage = await phone.locator('#canvasWrap').boundingBox(); assert(stage.height >= 664 * 0.70, 'editor retains the mobile peek stage');
    await phone.waitForFunction(() => document.getElementById('cellGraphStatus')?.textContent?.includes('boundaries and DXF use'));
    await phone.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await phone.screenshot({path: `screenshots/playwright/relief-editor-${width}.png`}); await phone.close();
  }
  process.stdout.write('Production cell editor drag/undo STL and DXF bytes, keyboard, pointer cancellation, pending focus/anchor Apply/Undo, pins, identity, files, mode ownership and phone targets passed.\n');
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
