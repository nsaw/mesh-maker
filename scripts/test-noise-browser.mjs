import { waitForFullNoiseResult } from './noise-browser-waits.mjs';
/** Production-bundle worker responsiveness and full-resolution export contract. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';

const port = Number(process.env.NOISE_TEST_PORT ?? 4184);
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
let serverOutput = '';
server.stdout.on('data', data => { serverOutput += data; });
server.stderr.on('data', data => { serverOutput += data; });
let browser;
const receipt = { responsivenessMs: [], previewMs: [], screenshots: [] };
const output = process.env.NOISE_TEST_OUTPUT ?? '.codex/implementation/slice4-browser';
await mkdir(output, { recursive: true });
try {
  let ready = false;
  let connectionError;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const res = await fetch(origin); if (res.ok) { ready = true; break; } }
    catch (error) { connectionError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Preview failed: ${serverOutput}`, { cause: connectionError });
  browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', `--use-angle=${process.env.NOISE_TEST_GPU ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader')}`, '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const installProbe = () => {
    const NativeWorker = window.Worker;
    window.noiseProbe = { requests: [], results: [], failNext: false, constructorFails: false, hold: false, longTasks: [] };
    window.renderProbe = { buffers: [], uploads: 0, deletedBuffers: 0, deletedPrograms: 0 };
    window.wireProbe = { requests: [], hold: false, held: [], failNext: false, constructorFails: false };
    const bufferData = WebGL2RenderingContext.prototype.bufferData;
    WebGL2RenderingContext.prototype.bufferData = function(target, data, ...rest) {
      window.renderProbe.uploads++;
      // Capture only the initial frame for byte parity. Later generation measurements avoid hashing overhead.
      if (ArrayBuffer.isView(data) && window.renderProbe.capture !== false) {
        window.renderProbe.buffers.push(crypto.subtle.digest('SHA-256', data).then(hash => ({ target,
          bytes: data.byteLength, type: data.constructor.name,
          hash: Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('').replace(/(.{8})(?=.)/g, '$1-') })));
      }
      return bufferData.call(this, target, data, ...rest);
    };
    const deleteBuffer = WebGL2RenderingContext.prototype.deleteBuffer;
    WebGL2RenderingContext.prototype.deleteBuffer = function(buffer) { window.renderProbe.deletedBuffers++; return deleteBuffer.call(this, buffer); };
    const deleteProgram = WebGL2RenderingContext.prototype.deleteProgram;
    WebGL2RenderingContext.prototype.deleteProgram = function(program) { window.renderProbe.deletedPrograms++; return deleteProgram.call(this, program); };
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.noiseProbe.longTasks.push({ at: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        if (String(url).includes('render-wire-worker') && window.wireProbe.constructorFails) throw new Error('Wire constructor blocked');
        if (window.noiseProbe.constructorFails) throw new Error('Worker construction blocked for fallback regression');
        super(url, options);
        this.entry = null; this.isWire = String(url).includes('render-wire-worker');
        this.addEventListener('message', event => {
          if (this.isWire && window.wireProbe.hold) {
            event.stopImmediatePropagation(); window.wireProbe.held.push({ worker: this, data: event.data }); return;
          }
          if (this.entry && event.data.type === 'result' && event.data.surface) {
            window.noiseProbe.results.push({ id: event.data.requestId, at: performance.now(),
              elapsed: performance.now() - this.entry.at, params: this.entry.params,
              renderPrepared: Boolean(event.data.surface.renderBuffers), wirePrepared: Boolean(event.data.surface.renderBuffers?.wire),
              heights: Array.from(event.data.surface.heights), cols: event.data.surface.cols, rows: event.data.surface.rows });
          }
        });
      }
      postMessage(input, ...rest) {
        if (this.isWire) {
          window.wireProbe.requests.push(this);
          if (window.wireProbe.failNext) {
            window.wireProbe.failNext = false;
            setTimeout(() => this.dispatchEvent(new ErrorEvent('error', { message: 'Injected wire failure', cancelable: true })), 10); return;
          }
        }
        if (input.params?.noiseType) {
          this.entry = { id: input.requestId, at: performance.now(), params: input.params, terminated: false };
          window.noiseProbe.requests.push(this.entry);
          if (window.noiseProbe.hold) return;
          if (window.noiseProbe.failNext && input.params.resolution === 400) {
            window.noiseProbe.failNext = false;
            setTimeout(() => this.dispatchEvent(new ErrorEvent('error', { message: 'Injected noise worker failure', cancelable: true })), 10);
            return;
          }
        }
        super.postMessage(input, ...rest);
      }
      terminate() { if (this.entry) this.entry.terminated = true; super.terminate(); }
    };
  };
  await page.addInitScript(installProbe);
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(origin);
  process.stdout.write('loaded\n');
  await page.waitForFunction(() => window.noiseProbe.results.length > 0 && !document.getElementById('genOverlay').classList.contains('visible'));
  async function setRange(key, value, event = 'input') {
    await page.locator(`input[data-key="${key}"]`).evaluate((el, data) => {
      el.value = String(data.value); el.dispatchEvent(new Event('input', { bubbles: true }));
      if (data.event !== 'input') el.dispatchEvent(new Event(data.event, { bubbles: true }));
    }, { value, event });
  }
  const waitFull = after => waitForFullNoiseResult(page, after);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const renderedBuffers = await page.evaluate(() => Promise.all(window.renderProbe.buffers));
  const renderFixture = JSON.parse(await readFile('cli/fixtures/noise-render-buffers.json', 'utf8'));
  assert.deepEqual(renderedBuffers, renderFixture.buffers, 'positions, normals, UVs, indices and enclosure buffers retain their pre-reuse bytes');
  await page.evaluate(() => { window.renderProbe.capture = false; });
  receipt.initialRenderBuffers = renderedBuffers.length;
  assert(await page.evaluate(() => window.noiseProbe.results[0].renderPrepared), 'worker prepares exact surface buffers');
  assert.equal(await page.evaluate(() => window.noiseProbe.results[0].wirePrepared), false, 'solid mode retains lazy wire allocation');
  receipt.gpu = await page.locator('#viewport').evaluate(canvas => { const gl = canvas.getContext('webgl2'); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable'; });
  process.stdout.write(`initial surface ${receipt.gpu}\n`);
  const beforeVertical = await page.evaluate(() => window.noiseProbe.requests.at(-1).id);
  await page.locator('#selPreset').selectOption('relief-vertical');
  await waitFull(beforeVertical);
  process.stdout.write('vertical surface\n');
  const profiling = process.env.NOISE_TEST_PROFILE === '1';
  if (profiling) { await session.send('Profiler.enable'); await session.send('Profiler.start'); }
  const disposalBefore = await page.evaluate(() => ({ buffers: window.renderProbe.deletedBuffers, programs: window.renderProbe.deletedPrograms }));
  const responseStart = await page.evaluate(() => performance.now());
  const beforeResponse = await page.evaluate(() => window.noiseProbe.requests.at(-1).id);
  await setRange('reliefJitter', 0.55, 'change');
  await page.waitForFunction(() => document.getElementById('genOverlay').classList.contains('visible'));
  for (let i = 0; i < 8; i++) {
    const started = performance.now(); await page.evaluate(() => 1);
    receipt.responsivenessMs.push(performance.now() - started);
    await new Promise(resolve => setTimeout(resolve, 12));
  }
  assert(Math.max(...receipt.responsivenessMs) < 100, `4x responsiveness ${JSON.stringify(receipt.responsivenessMs)}`);
  await waitFull(beforeResponse);
  // Include the completed full-density frame, not only the time while worker sampling runs.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(50);
  if (profiling) {
    const cpuProfile = await session.send('Profiler.stop');
    await writeFile(`${output}/generation.cpuprofile`, JSON.stringify(cpuProfile.profile));
    receipt.profileTop = cpuProfile.profile.nodes.filter(node => node.hitCount).sort((a, b) => b.hitCount - a.hitCount).slice(0, 15).map(node => ({ name: node.callFrame.functionName, hits: node.hitCount, url: node.callFrame.url, line: node.callFrame.lineNumber, column: node.callFrame.columnNumber }));
  }
  receipt.generationLongTasks = await page.evaluate(start => window.noiseProbe.longTasks.filter(task => task.at >= start), responseStart);
  const disposalAfter = await page.evaluate(() => ({ buffers: window.renderProbe.deletedBuffers, programs: window.renderProbe.deletedPrograms }));
  assert(disposalAfter.buffers - disposalBefore.buffers >= 20, 'replaced full geometry disposes its GPU buffers');
  assert.equal(disposalAfter.programs, disposalBefore.programs, 'same shading regeneration retains shader programs');
  receipt.replacedBuffersDisposed = disposalAfter.buffers - disposalBefore.buffers;
  receipt.cpuThrottleRate = 4;
  receipt.hardwareCompletionGate = !/swiftshader|llvmpipe|software/i.test(receipt.gpu);
  if (receipt.hardwareCompletionGate) assert(receipt.generationLongTasks.every(task => task.duration < 100),
    `4x hardware full-frame completion exceeded 100ms: ${JSON.stringify(receipt.generationLongTasks)}`);
  process.stdout.write(`responsiveness checked ${JSON.stringify({ gpu: receipt.gpu, hardwareCompletionGate: receipt.hardwareCompletionGate, longTasks: receipt.generationLongTasks })}\n`);
  const beforePockets = await page.evaluate(() => window.noiseProbe.requests.at(-1).id);
  await page.locator('#selPreset').selectOption('relief-pockets'); await waitFull(beforePockets);
  if (await page.locator('#sponsorBackdrop.visible').count()) await page.keyboard.press('Escape');
  await page.locator('#sl_reliefJitter').scrollIntoViewIfNeeded();
  const sliderBox = await page.locator('#sl_reliefJitter').boundingBox();
  assert(sliderBox);
  const sustainedStart = await page.evaluate(() => { window.noiseProbe.results = []; return performance.now(); });
  await page.mouse.move(sliderBox.x + 5, sliderBox.y + sliderBox.height / 2);
  await page.mouse.down();
  for (let i = 0; i < 30; i++) {
    await page.mouse.move(sliderBox.x + 5 + (sliderBox.width - 10) * i / 29, sliderBox.y + sliderBox.height / 2);
    await page.waitForTimeout(20);
  }
  receipt.sustainedPreviews = await page.evaluate(start => window.noiseProbe.results.filter(result => result.at > start && result.cols === 120).length, sustainedStart);
  assert(receipt.sustainedPreviews >= 2, 'sustained 20ms mouse dragging must show coarse frames before release');
  assert.match(await page.locator('#statsOverlay').textContent(), /display approximation/);
  assert.match(await page.locator('#dimsOverlay').textContent(), /approximation/);
  const beforeDragRelease = await page.evaluate(() => window.noiseProbe.requests.at(-1).id);
  await page.mouse.up();
  await waitFull(beforeDragRelease);
  process.stdout.write(`sustained previews ${receipt.sustainedPreviews}\n`);
  const rapid = await page.evaluate(async () => {
    const input = document.getElementById('sl_reliefJitter');
    const start = performance.now();
    input.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 19 }));
    await new Promise(resolve => { let i = 0; const timer = setInterval(() => {
      input.value = String(0.1 + (i % 15) * 0.05); input.dispatchEvent(new Event('input', { bubbles: true }));
      if (++i === 160) { clearInterval(timer); resolve(); }
    }, 8); });
    const during = window.noiseProbe.results.filter(result => result.at > start && result.cols === 120).length;
    const beforeRelease = window.noiseProbe.requests.at(-1).id;
    input.dispatchEvent(new PointerEvent('pointerup', { pointerId: 19 }));
    return {during, beforeRelease};
  });
  assert(rapid.during > 0, '8ms sustained inputs must produce previews before release');
  receipt.highRatePreviews = rapid.during;
  await waitFull(rapid.beforeRelease);
  const baseline = await page.evaluate(() => window.noiseProbe.requests.at(-1).id);
  // Hold a gesture open so previews never initiate a full request until its release.
  await page.locator('#sl_reliefJitter').dispatchEvent('pointerdown', { pointerId: 7 });
  for (const value of [0.1, 0.2, 0.3]) {
    const before = await page.evaluate(() => performance.now());
    await setRange('reliefJitter', value);
    await page.waitForFunction(({ value, before }) => window.noiseProbe.results.some(result => result.at >= before && result.params.resolution === 120 && result.params.reliefJitter === value), { value, before });
    const elapsed = await page.evaluate(({ value, before }) => window.noiseProbe.results.findLast(result => result.params.resolution === 120 && result.params.reliefJitter === value).at - before, { value, before });
    receipt.previewMs.push(elapsed);
    (receipt.previewTimeline ??= []).push({inputAt: before, resultAt: before + elapsed, value});
  }
  const previewContext = await page.evaluate(() => ({requests: window.noiseProbe.requests.slice(-10).map(r => ({id:r.id,at:r.at,terminated:r.terminated,resolution:r.params.resolution,jitter:r.params.reliefJitter})), results:window.noiseProbe.results.slice(-10).map(r=>({id:r.id,at:r.at,elapsed:r.elapsed,cols:r.cols,jitter:r.params.reliefJitter})),longTasks:window.noiseProbe.longTasks.slice(-16)}));
  // Like the 100 ms frame bounds, the 400 ms latency bound binds GPU-backed Chrome only. Software
  // GL (SwiftShader on hosted Linux) still has to deliver every preview; its timing is reported.
  assert.equal(receipt.previewMs.length, 3, 'every held preview arrives');
  if (!receipt.hardwareCompletionGate) process.stdout.write(`software-renderer preview timing (not gated) ${JSON.stringify(receipt.previewMs)}\n`);
  assert(Math.min(...receipt.previewMs) >= 0 && (!receipt.hardwareCompletionGate || Math.max(...receipt.previewMs) < 400), `4x preview ${JSON.stringify(receipt.previewMs)} context ${JSON.stringify({timeline:receipt.previewTimeline,...previewContext})}`);
  for (let i = 0; i < 10; i++) await setRange('reliefJitter', 0.35 + i * 0.05);
  await page.locator('#sl_reliefJitter').dispatchEvent('pointerup', { pointerId: 7 });
  await waitFull(baseline);
  const final = await page.evaluate(baseline => {
    const full = window.noiseProbe.results.filter(result => result.id > baseline && result.params.resolution === 400);
    return { count: full.length, last: full.at(-1) };
  }, baseline);
  assert.equal(final.count, 1, 'one full commit after release');
  assert.equal(final.last.params.reliefJitter, 0.8);
  process.stdout.write(`worker measurements ${JSON.stringify({ responsivenessMs: receipt.responsivenessMs, previewMs: receipt.previewMs })}\n`);
  // Regenerate that same last value on a fresh page and compare every Float64 height.
  const expected = final.last.heights;
  const version = Number((await readFile('src/state.ts', 'utf8')).match(/CURRENT_PAYLOAD_VERSION = (\d+)/)[1]);
  const link = Buffer.from(JSON.stringify({ ...final.last.params, _v: version })).toString('base64url');
  const fresh = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  fresh.setDefaultTimeout(15_000);
  await fresh.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await fresh.addInitScript(installProbe);
  const freshSession = await fresh.context().newCDPSession(fresh);
  await freshSession.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await fresh.goto(`${origin}/?c=${link}`);
  await fresh.waitForFunction(() => window.noiseProbe.results.length > 0 && !document.getElementById('genOverlay').classList.contains('visible'));
  assert.deepEqual(await fresh.evaluate(() => window.noiseProbe.results.at(-1).heights), expected, 'final drag value matches a fresh page exactly');
  await fresh.close();
  // Dismiss the legacy timed overlay through its real keyboard UI on a pre-Slice-5 checkpoint.
  if (await page.locator('#sponsorBackdrop.visible').count()) await page.keyboard.press('Escape');
  await page.locator('[data-fmt="obj"]').click();
  const downloadPromise = page.waitForEvent('download');
  // Input and export happen in the same JavaScript turn, inside the debounce interval.
  await page.evaluate(() => {
    const input = document.getElementById('sl_reliefJitter');
    input.value = '0.65'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('btnExport').click();
  });
  const download = await downloadPromise;
  const obj = await readFile(await download.path(), 'utf8');
  const vertexCount = obj.split('\n').filter(line => line.startsWith('v ')).length;
  const latest = await page.evaluate(() => window.noiseProbe.results.at(-1));
  assert.equal(latest.cols, 400);
  assert.equal(vertexCount, latest.cols * latest.rows + 2 * (latest.cols + latest.rows) - 3, 'OBJ uses the full grid, bottom rim and centre vertex');
  receipt.exportVertices = vertexCount;
  // Programmatic-only input must finish at full resolution without a release event.
  for (const action of ['none', 'rebuild', 'gesture', 'mode']) {
    const resetBoundary = await page.evaluate(() => {
      const request = window.noiseProbe.requests.at(-1), result = window.noiseProbe.results.at(-1);
      // A repeated value may reuse an already completed current source instead of posting again.
      const cached = result?.id === request.id && result.params.resolution === 400 && result.params.reliefJitter === 0.65;
      return request.id - Number(cached);
    });
    await setRange('reliefJitter', 0.65, 'change'); await waitFull(resetBoundary);
    const prior = await page.evaluate(() => window.noiseProbe.requests.at(-1).id);
    await page.evaluate(action => {
      const input = document.getElementById('sl_reliefJitter');
      input.value = '0.8'; input.dispatchEvent(new Event('input', { bubbles: true }));
      if (action !== 'none') document.getElementById('btnResetCamera').click();
      if (action === 'gesture') {
        const current = document.getElementById('sl_reliefJitter');
        current.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 23 }));
        current.value = '0.8'; current.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (action === 'mode') document.querySelector('[data-mode="depthmap"]').click();
    }, action);
    if (action === 'gesture' || action === 'mode') {
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(prior => window.noiseProbe.requests.filter(request => request.id > prior && request.params.resolution === 400).length, prior), 0, `${action} retires the old completion timer`);
      if (action === 'gesture') await page.locator('#sl_reliefJitter').dispatchEvent('pointerup', { pointerId: 23 });
      else await page.locator('[data-mode="noise"]').click();
    }
    await waitFull(prior);
    if (action === 'none' || action === 'rebuild') assert.deepEqual(await page.evaluate(() => window.noiseProbe.results.at(-1).heights), expected);
    receipt.numericCompletionCases = [...(receipt.numericCompletionCases ?? []), action];
  }
  // Edits during a pending export settle its waiter and refuse the retired source.
  const downloads = [];
  page.on('download', item => downloads.push(item.suggestedFilename()));
  await page.evaluate(() => { window.noiseProbe.failNext = true; });
  await setRange('reliefJitter', 0.45, 'change');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Injected noise worker failure'));
  assert.equal(await page.locator('#genOverlay').evaluate(el => el.classList.contains('visible')), false);
  const failedId = await page.evaluate(() => window.noiseProbe.requests.at(-1).id);
  await setRange('reliefJitter', 0.5, 'change'); await waitFull(failedId);
  // Hold a real worker before it receives input, then supersede an export waiting on it.
  const downloadCount = downloads.length;
  await page.evaluate(() => {
    window.noiseProbe.hold = true;
    const input = document.getElementById('sl_reliefJitter');
    input.value = '0.55'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('btnExport').click();
  });
  await page.waitForFunction(() => document.getElementById('genOverlay').classList.contains('visible'));
  await setRange('reliefJitter', 0.6);
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Settings changed'));
  assert.equal(downloads.length, downloadCount, 'superseded export produces no stale download');
  await page.evaluate(() => { window.noiseProbe.hold = false; });
  const beforeRetry = await page.evaluate(() => window.noiseProbe.requests.at(-1).id);
  await page.locator('#btnRegenerate').click(); await waitFull(beforeRetry);
  // Mode changes also settle pending export waiters and discard the retired noise source.
  await page.evaluate(() => {
    window.noiseProbe.hold = true;
    const input = document.getElementById('sl_reliefJitter');
    input.value = '0.7'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('btnExport').click();
  });
  await page.locator('[data-mode="depthmap"]').click();
  await page.waitForFunction(() => !document.getElementById('genOverlay').classList.contains('visible'));
  assert.equal(downloads.length, downloadCount, 'mode change produces no noise download');
  await page.evaluate(() => { window.noiseProbe.hold = false; });
  const beforeNoiseReturn = await page.evaluate(() => window.noiseProbe.requests.at(-1).id);
  await page.locator('[data-mode="noise"]').click(); await waitFull(beforeNoiseReturn);
  // A constructor exception exercises the real inline adapter, including a full-resolution export.
  await page.locator('[data-mode="depthmap"]').click();
  await page.evaluate(() => { window.noiseProbe.constructorFails = true; });
  await page.locator('[data-mode="noise"]').click();
  const fallbackDownload = page.waitForEvent('download');
  await page.evaluate(() => {
    const input = document.getElementById('sl_reliefJitter');
    input.value = '0.75'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('btnExport').click();
  });
  const fallback = await fallbackDownload;
  assert.equal((await readFile(await fallback.path(), 'utf8')).split('\n').filter(line => line.startsWith('v ')).length,
    vertexCount, 'inline fallback exports the same full grid dimensions');
  await page.evaluate(() => { window.noiseProbe.constructorFails = false; });
  // View-only changes produce no worker requests.
  const count = await page.evaluate(() => window.noiseProbe.requests.length);
  await setRange('orbit', 99); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.noiseProbe.requests.length), count);
  for (const view of ['wireframe', 'both', 'points', 'solid']) {
    await page.locator(`[data-view="${view}"]`).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const before = await page.evaluate(() => ({ deleted: window.renderProbe.deletedPrograms, id: window.noiseProbe.requests.at(-1).id }));
    const renderStarted = await page.evaluate(() => performance.now());
    await setRange('reliefJitter', view === 'wireframe' || view === 'points' ? 0.65 : 0.7, 'change');
    await waitFull(before.id);
    assert.equal(await page.evaluate(() => window.noiseProbe.results.at(-1).wirePrepared), view === 'wireframe' || view === 'both');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.renderProbe.deletedPrograms), before.deleted, `${view} regeneration retains overlay programs`);
    await page.waitForTimeout(50);
    const tasks = await page.evaluate(start => window.noiseProbe.longTasks.filter(task => task.at >= start), renderStarted);
    (receipt.viewLongTasks ??= {})[view] = tasks;
    if (receipt.hardwareCompletionGate) assert(tasks.every(task => task.duration < 100), `${view} full render exceeded 100ms: ${JSON.stringify(tasks)}`);
  }
  // Real lazy-wire workers: view changes cache only the current source; retired results cannot upload.
  const lazyCounts = [];
  async function freshSolid(value) {
    await page.locator('[data-view="solid"]').click();
    const id = await page.evaluate(() => window.noiseProbe.requests.at(-1).id);
    await setRange('reliefJitter', value, 'change'); await waitFull(id);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function holdWire() {
    await page.evaluate(() => { window.wireProbe.hold = true; window.wireProbe.held = []; });
    await page.locator('[data-view="wireframe"]').click();
    await page.waitForFunction(() => window.wireProbe.held.length === 1);
  }
  async function releaseWire() {
    await page.evaluate(() => {
      window.wireProbe.hold = false;
      for (const held of window.wireProbe.held) held.worker.dispatchEvent(new MessageEvent('message', { data: held.data }));
      window.wireProbe.held = [];
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  await freshSolid(0.45); await holdWire();
  await page.locator('[data-view="solid"]').click();
  const cached = await page.evaluate(() => ({ uploads: window.renderProbe.uploads, noise: window.noiseProbe.requests.length }));
  await releaseWire();
  assert.equal(await page.evaluate(() => window.renderProbe.uploads), cached.uploads, 'hidden lazy wire does not upload');
  await page.locator('[data-view="wireframe"]').click();
  await page.waitForFunction(n => window.renderProbe.uploads > n, cached.uploads);
  assert.equal(await page.evaluate(() => window.noiseProbe.requests.length), cached.noise, 'lazy wire never regenerates noise');
  for (const race of ['replacement', 'mode']) {
    await freshSolid(race === 'replacement' ? 0.5 : 0.65); await holdWire();
    if (race === 'replacement') await freshSolid(0.6);
    else {
      await page.locator('[data-mode="depthmap"]').click();
      await page.waitForFunction(() => !document.getElementById('genOverlay').classList.contains('visible'));
    }
    const uploads = await page.evaluate(() => window.renderProbe.uploads);
    await releaseWire();
    assert.equal(await page.evaluate(() => window.renderProbe.uploads), uploads, `${race} rejects retired lazy-wire delivery`);
    if (race === 'mode') { const id = await page.evaluate(() => window.noiseProbe.requests.at(-1).id); await page.locator('[data-mode="noise"]').click(); await waitFull(id); }
    lazyCounts.push(race);
  }
  for (const fallback of ['failNext', 'constructorFails']) {
    await freshSolid(fallback === 'failNext' ? 0.75 : 0.8);
    const before = await page.evaluate(key => { window.wireProbe[key] = true; return window.renderProbe.uploads; }, fallback);
    await page.locator('[data-view="wireframe"]').click();
    await page.waitForFunction(n => window.renderProbe.uploads > n, before);
    await page.evaluate(() => { window.wireProbe.constructorFails = false; });
    lazyCounts.push(fallback);
  }
  receipt.lazyWireCases = lazyCounts;
  const beforeClear = await page.evaluate(() => window.renderProbe.deletedPrograms);
  await page.locator('[data-mode="depthmap"]').click();
  await page.waitForFunction(() => !document.getElementById('genOverlay').classList.contains('visible'));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert(await page.evaluate(() => window.renderProbe.deletedPrograms) > beforeClear, 'clearing the source disposes retained programs');
  const beforeFinalNoise = await page.evaluate(() => window.noiseProbe.requests.at(-1).id);
  await page.locator('[data-mode="noise"]').click(); await waitFull(beforeFinalNoise);
  const requestCountBeforeShading = await page.evaluate(() => window.noiseProbe.requests.length);
  await page.locator('#sl_viewMaterial').selectOption('neutral');
  await page.locator('#sl_viewMaterial').selectOption('elevation');
  assert.equal(await page.evaluate(() => window.noiseProbe.requests.length), requestCountBeforeShading, 'material switches do not regenerate');
  for (const [width, height] of [[1440, 900], [834, 1112], [390, 664]]) {
    await page.setViewportSize({ width, height });
    const path = `${output}/${width}x${height}.png`;
    await page.screenshot({ path }); receipt.screenshots.push(path);
  }
  assert.deepEqual(errors, [], 'no browser runtime exceptions');
  await writeFile(`${output}/receipt.json`, JSON.stringify(receipt, null, 2) + '\n');
  process.stdout.write(JSON.stringify(receipt) + '\n');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await new Promise(resolve => { if (server.exitCode !== null || server.signalCode !== null) resolve(); else server.once('exit', resolve); });
}
