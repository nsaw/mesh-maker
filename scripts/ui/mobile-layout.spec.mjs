import { restrictToAppOrigin } from './app-requests.mjs';
import { installDeferredLayoutProbe, verifyDeferredLayoutRebuild, verifyPresentationHistory, verifyRootPaneTransitions, verifyVisibleSiteCap } from './presentation-regressions.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { Matrix4, Vector3 } from 'three';
import { installFrameProbe } from './frame-probe.mjs';
import { verifySmallMasterRanges } from './reset-regressions.mjs';
import { mkdir } from 'node:fs/promises';

const range = async (page, key, value) => page.locator(`#sl_${key}`).evaluate((element, number) => {
  element.value = String(number);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}, value);
const pane = (page, name) => page.locator(`#tab-${name}`).click();
const open = async (page, name) => {
  const button = page.locator(`#${name}-section-body-toggle`);
  if (await button.getAttribute('aria-expanded') === 'false') await button.click();
};
async function copyState(page) {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { document.documentElement.dataset.copied = text; } } }));
  if (page.viewportSize().width <= 900) await page.locator('#btnOverflow').click();
  await page.locator('#btnCopyLink').click();
  const link = await page.evaluate(() => document.documentElement.dataset.copied);
  const encoded = new URL(link).searchParams.get('c');
  const config = encoded ? JSON.parse(Buffer.from(encoded, 'base64url').toString()) : {};
  const camera = await page.locator('#viewPane input[type=range][data-key]').evaluateAll(inputs => Object.fromEntries(inputs.filter(input => ['orbit','tilt','roll','zoom'].includes(input.dataset.key)).map(input => [input.dataset.key, Number(input.dataset.value)])));
  return { ...config, ...camera };
}
async function fit(page) {
  await page.evaluate(() => Promise.allSettled(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations)).map(animation => animation.finished)));
  // The full-resolution result rewrites the stats and dims overlays, which bound the fit frame.
  // Fit only once generation is idle and both overlays hold still, or a slow renderer fits early.
  await page.waitForFunction(() => !document.getElementById('genOverlay')?.classList.contains('visible'));
  await page.waitForFunction(() => new Promise(resolve => {
    const boxes = () => ['statsOverlay', 'dimsOverlay'].map(id => JSON.stringify(document.getElementById(id)?.getBoundingClientRect())).join();
    const before = boxes();
    setTimeout(() => resolve(boxes() === before && !document.getElementById('genOverlay')?.classList.contains('visible')), 250);
  }), undefined, { polling: 'raf', timeout: 30000 });
  if (page.viewportSize().width <= 900) await page.locator('#btnOverflow').click();
  const sequence = await page.evaluate(() => window.fitProbe?.sequence ?? 0);
  await page.locator('#btnZoomExtents').click();
  await page.waitForFunction(before => (window.fitProbe?.sequence ?? 0) > before, sequence);
}
async function checkTargets(page) {
  const controls = page.locator('button, select, input:not([type="file"]), [role="button"], .editable-value, .check-row label, a');
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    assert(box && box.height >= 43.99 && box.width >= 43.99, `44 px target ${await control.evaluate(e => e.id || e.className)}: ${JSON.stringify(box)}`);
    await control.scrollIntoViewIfNeeded();
    const receivesPointer = await control.evaluate(element => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hit === element || element.contains(hit);
    });
    assert(receivesPointer, `target receives pointer ${await control.evaluate(e => e.id || e.className)}`);
  }
  const small = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const found = [];
    while (walker.nextNode()) {
      const node = walker.currentNode, element = node.parentElement;
      if (!element || !node.textContent.trim() || element.closest('option,script,style')) continue;
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      if (rect.width && rect.height && style.visibility === 'visible' && parseFloat(style.fontSize) < 13) found.push([node.textContent.trim(), style.fontSize]);
    }
    return found;
  });
  assert.deepEqual(small, [], 'visible mobile text is at least 13 px with fallback fonts');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), page.viewportSize().width);
}
async function projectPoint(page, point) {
  const matrices = await page.evaluate(() => window.fitProbe);
  assert(matrices, 'production mesh draw supplied its actual matrices');
  const canvas = await page.locator('#canvasWrap').boundingBox();
  const position = new Vector3(...point).applyMatrix4(new Matrix4().fromArray(matrices.modelViewMatrix)).applyMatrix4(new Matrix4().fromArray(matrices.projectionMatrix));
  return { x: (position.x + 1) * canvas.width / 2, y: (1 - position.y) * canvas.height / 2 };
}
async function cameraDepth(page, point) {
  const matrices = await page.evaluate(() => window.fitProbe);
  assert(matrices);
  return -new Vector3(...point).applyMatrix4(new Matrix4().fromArray(matrices.modelViewMatrix)).z;
}
async function checkProjectedFit(page, source) {
  const canvas = await page.locator('#canvasWrap').boundingBox();
  const dims = await page.locator('#dimsOverlay').boundingBox(), stats = await page.locator('#statsOverlay').boundingBox();
  const top = Math.max(96, dims.y + dims.height - canvas.y + 8), bottom = canvas.y + canvas.height - stats.y + 8;
  const frame = { left: 16, right: canvas.width - 16, top, bottom: canvas.height - bottom };
  for (const x of [0, source.x]) for (const y of [0, source.y]) for (const z of [0, source.stock]) {
    const projected = await projectPoint(page, [x, y, z]);
    assert(projected.x >= frame.left - 1 && projected.x <= frame.right + 1 && projected.y >= frame.top - 1 && projected.y <= frame.bottom + 1, `GPU source corner ${JSON.stringify(projected)} inside ${JSON.stringify(frame)}`);
  }
}

let server, browser;
try {
  let origin = process.env.MESHCRAFT_UI_ORIGIN;
  if (!origin) {
    server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } });
    const address = server.httpServer.address();
    assert(address && typeof address !== 'string');
    origin = `http://127.0.0.1:${address.port}`;
  }
  browser = await chromium.launch();
  const receipts = [];
  const output = process.env.MESHCRAFT_SCREENSHOTS;
  if (output) await mkdir(output, { recursive: true });
  const deferredContext = await browser.newContext({ viewport: { width: 390, height: 664 } });
  const deferred = await deferredContext.newPage();
  await deferred.addInitScript(installDeferredLayoutProbe);
  await restrictToAppOrigin(deferred, origin);
  await deferred.goto(origin);
  await deferred.waitForSelector('#selPreset', { state: 'attached' });
  await verifyDeferredLayoutRebuild(deferred);
  await deferredContext.close();
  process.stdout.write('PASS rebuilds during deferred layout transitions\n');
  const historyContext = await browser.newContext({ viewport: { width: 390, height: 664 }, hasTouch: true });
  const history = await historyContext.newPage();
  await restrictToAppOrigin(history, origin);
  await history.goto(origin);
  await history.waitForSelector('#selPreset', { state: 'attached' });
  await verifyPresentationHistory(history);
  await verifyRootPaneTransitions(history);
  await verifyVisibleSiteCap(history);
  await historyContext.close();
  process.stdout.write('PASS task/mode breakpoint history, content clamps and visible site cap\n');
  // An Export opened before the first source arrives must not redefine the initial camera.
  const earlyContext = await browser.newContext({ viewport: { width: 390, height: 664 }, acceptDownloads: true });
  const early = await earlyContext.newPage();
  await early.addInitScript(installFrameProbe);
  await early.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.holdInitialFrame = true;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.addEventListener('message', event => {
          if (!window.holdInitialFrame || event.data.type !== 'result' || !event.data.surface) return;
          event.stopImmediatePropagation();
          window.releaseInitialFrame = () => {
            window.holdInitialFrame = false;
            this.dispatchEvent(new MessageEvent('message', { data: event.data }));
          };
        });
      }
    };
  });
  await restrictToAppOrigin(early, origin);
  await early.goto(origin);
  await early.waitForFunction(() => Boolean(window.releaseInitialFrame));
  await pane(early, 'export');
  const earlyDownload = early.waitForEvent('download');
  await early.locator('#btnExport').click();
  await early.evaluate(() => window.releaseInitialFrame());
  await earlyDownload;
  await early.locator('#sheetHandle').press('Home');
  await early.waitForFunction(() => Boolean(window.fitProbe));
  assert(Math.abs(await cameraDepth(early, [18, 12, 0.375]) - 36 * 1.2 * 500 / 390) < 0.0001, 'pending Export preserves the initial portrait camera depth');
  await earlyContext.close();
  process.stdout.write('PASS first-frame Export camera regression\n');
  for (const [width, height] of [[390, 664], [430, 932], [834, 1112], [1440, 900]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width <= 900, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(installFrameProbe);
    await restrictToAppOrigin(page, origin);
    await page.goto(origin);
    await page.waitForSelector('#selPreset', { state: 'attached' });
    await page.waitForTimeout(300);
    const initialCanvas = await page.locator('#canvasWrap').boundingBox();
    if (width === 390) assert(initialCanvas.height >= height * 0.7, 'peek gives the visible scene at least 70% of screen height');
    if (output) await page.screenshot({ path: `${output}/${width}-peek.png` });
    if (width > 900) {
      assert.equal((await page.locator('#sidebar').boundingBox()).width, 320);
      assert.equal(await page.locator('#sheetChrome').isVisible(), false);
      assert.equal(await page.locator('.export-bar').evaluate(e => e.parentElement.className), 'viewport');
      const small = await page.locator('body *').evaluateAll(elements => elements.filter(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height && getComputedStyle(e).visibility === 'visible' && parseFloat(getComputedStyle(e).fontSize) < 11).map(e => e.className));
      assert.deepEqual(small, []);
      assert.deepEqual(errors, [], 'desktop page has no runtime errors');
      await context.close();
      receipts.push({ width, desktopSidebar: true });
      process.stdout.write(`PASS desktop sidebar ${width}x${height}\n`);
      continue;
    }
    await checkTargets(page);
    // Export tab plus Export button is the complete file action path.
    await pane(page, 'export');
    const exportBox = await page.locator('#btnExport').boundingBox();
    assert(exportBox.y >= 132 && exportBox.y + exportBox.height <= height);
    const download = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    assert.match((await download).suggestedFilename(), /\.stl$/);
    await checkTargets(page);
    await pane(page, 'shape');
    await range(page, 'resolution', 40);
    await pane(page, 'generator');
    await open(page, 'noise-parameters');
    await page.selectOption('#selNoiseType', 'voronoi-relief');
    assert.equal(await page.locator('#tab-generator').textContent(), 'Relief');
    await page.locator('.relief-controls').evaluateAll(sections => sections.forEach(section => {
      section.classList.remove('collapsed'); section.querySelector('.section-header').setAttribute('aria-expanded', 'true');
    }));
    await page.selectOption('#sl_reliefAttractorMode', 'none');
    await range(page, 'reliefRadialFociCount', 0);
    await range(page, 'reliefPillow', 0);
    await page.selectOption('#sl_reliefBaseMode', 'flat');
    await range(page, 'reliefAttractorNoise', 0);
    const count = await page.locator('.relief-controls input, .relief-controls select').evaluateAll(elements => elements.filter(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height).length);
    assert(count <= 22, `all four open relief sections expose ${count} active controls`);
    assert.equal(await page.locator('#sl_reliefInvertProfile').getAttribute('type'), 'checkbox');
    await page.locator('#sl_reliefInvertProfile').check();
    assert.equal(await page.locator('#sl_reliefPillow').isVisible(), false);
    await page.locator('#sl_reliefInvertProfile').uncheck();
    await range(page, 'reliefPillow', 0.4);
    assert.equal(await page.locator('#sl_reliefPillowCoverage').isVisible(), true);
    for (const [mode, x, y, radiusVisible] of [['vertical', false, true, false], ['horizontal', true, false, false], ['radial', true, true, true], ['point', true, true, true]]) {
      await page.selectOption('#sl_reliefAttractorMode', mode);
      assert.equal(await page.locator('#sl_reliefAttractorX').isVisible(), x);
      assert.equal(await page.locator('#sl_reliefAttractorY').isVisible(), y);
      assert.equal(await page.locator('#sl_reliefAttractorRadius').isVisible(), radiusVisible);
    }
    await range(page, 'reliefRadialFociCount', 2);
    assert.equal(await page.locator('#sl_reliefRadialFocus2X').isVisible(), true);
    assert.equal(await page.locator('#sl_reliefRadialFocus3X').isVisible(), false);
    await page.selectOption('#sl_reliefBaseMode', 'wave');
    assert.equal(await page.locator('#sl_reliefBaseAmplitude').isVisible(), true);
    await checkTargets(page);
    if (output) for (const section of ['cells', 'walls-floors', 'layout', 'base']) {
      await page.locator(`#${section}-section-body-toggle`).evaluate(element => { const sidebar = document.getElementById('sidebar'); sidebar.scrollTop += element.getBoundingClientRect().top - sidebar.getBoundingClientRect().top; });
      await page.screenshot({ path: `${output}/${width}-${section}.png` });
    }
    // Actual task-tab keyboard navigation uses one tab stop and linked panel roles.
    await page.locator('#tab-generator').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-view');
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-sponsors');
    assert.equal(await page.locator('#sponsorsPane').isVisible(), true);
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-shape');
    assert.equal(await page.locator('[role="tab"][tabindex="0"]').count(), 1);
    // Snaps do not change camera settings or reconstruct control nodes.
    const cameraBefore = await copyState(page);
    await page.locator('#sl_meshX').evaluate(element => { element.dataset.identity = 'retained'; });
    await page.locator('#sheetHandle').focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(50);
    assert.equal(await page.locator('body').getAttribute('data-sheet-snap'), 'half');
    assert.equal(await page.locator('#sl_meshX').getAttribute('data-identity'), 'retained');
    assert.deepEqual(await copyState(page), cameraBefore);
    // Range and canvas pointer gestures cannot start a sheet drag.
    await open(page, 'mesh-dimensions');
    const snapBefore = await page.locator('body').getAttribute('data-sheet-snap');
    await page.locator('#sl_resolution').scrollIntoViewIfNeeded();
    const beforeRange = await page.locator('#sl_resolution').getAttribute('data-value');
    const rangeBox = await page.locator('#sl_resolution').boundingBox();
    await page.mouse.move(rangeBox.x + 30, rangeBox.y + 22); await page.mouse.down(); await page.mouse.move(rangeBox.x + 60, rangeBox.y + 22); await page.mouse.up();
    assert.equal(await page.locator('body').getAttribute('data-sheet-snap'), snapBefore);
    assert.notEqual(await page.locator('#sl_resolution').getAttribute('data-value'), beforeRange, 'the native range received the pointer gesture');
    // Wide and tall sources fit at peek without overlapping the fixed overlays.
    for (const source of [{ x: 36, y: 4, stock: 0.75 }, { x: 3, y: 24, stock: 0.75 }]) {
      await range(page, 'meshX', source.x); await range(page, 'meshY', source.y); await range(page, 'baseThickness', source.stock);
      await page.locator('#sheetHandle').focus(); await page.keyboard.press('Home');
      await page.waitForTimeout(400);
      await fit(page);
      await checkProjectedFit(page, source);
      await pane(page, 'shape');
    }
    // Real handle pointer movement settles a snap without a browser resize.
    await page.locator('#sheetHandle').focus(); await page.keyboard.press('Home');
    const handle = await page.locator('#sheetHandle').boundingBox();
    await page.mouse.move(handle.x + 100, handle.y + 22); await page.mouse.down(); await page.mouse.move(handle.x + 100, 70, { steps: 12 }); await page.mouse.up();
    assert.equal(await page.locator('body').getAttribute('data-sheet-snap'), 'full');
    await page.locator('#sheetHandle').press('Home');
    const preservedCamera = await copyState(page);
    const peekBox = await page.locator('#canvasWrap').boundingBox();
    const peekCentre = await projectPoint(page, [1.5, 12, 0.375]);
    const preservedDistance = await cameraDepth(page, [1.5, 12, 0.375]);
    await page.locator('#sheetHandle').press('ArrowUp');
    await page.waitForTimeout(100);
    const halfBox = await page.locator('#canvasWrap').boundingBox();
    const halfCentre = await projectPoint(page, [1.5, 12, 0.375]);
    assert(Math.abs((peekCentre.y - peekBox.height / 2) - (halfCentre.y - halfBox.height / 2)) < 0.05, 'snap preserves the user camera pan');
    assert.deepEqual(await copyState(page), preservedCamera);
    assert(Math.abs(await cameraDepth(page, [1.5, 12, 0.375]) - preservedDistance) < 0.0001, 'snap preserves physical camera distance');
    await page.locator('#sheetHandle').press('Home');
    await page.setViewportSize({ width: height, height: width });
    await page.waitForTimeout(100);
    assert.deepEqual(await copyState(page), preservedCamera, 'orientation retains camera settings');
    assert(Math.abs(await cameraDepth(page, [1.5, 12, 0.375]) - preservedDistance) < 0.0001, 'orientation preserves physical camera distance');
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(100);
    assert.deepEqual(await copyState(page), preservedCamera);
    const touch = await context.newCDPSession(page);
    const stage = await page.locator('#canvasWrap').boundingBox();
    const cx = Math.round(stage.width / 2), cy = Math.round(stage.y + stage.height / 2);
    const gestureState = await copyState(page);
    const centerBeforeGesture = await projectPoint(page, [1.5, 12, 0.375]);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 30, y: cy, id: 1 }, { x: cx + 30, y: cy, id: 2 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 45, y: cy + 15, id: 1 }, { x: cx + 55, y: cy + 15, id: 2 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const afterGesture = await copyState(page);
    assert.notEqual(afterGesture.zoom, gestureState.zoom, 'two-finger pinch changes camera zoom');
    const centerAfterGesture = await projectPoint(page, [1.5, 12, 0.375]);
    assert(Math.abs(centerAfterGesture.y - centerBeforeGesture.y) > 1, 'two-finger translation changes the projected scene centre');
    assert.equal(await page.locator('body').getAttribute('data-sheet-snap'), 'peek');
    await touch.detach();
    // Model keyboard occlusion without resizing the browser. Exercise zero available scene too.
    const beforeKeyboard = await copyState(page);
    await page.evaluate(() => {
      const viewport = window.visualViewport;
      Object.defineProperty(viewport, 'height', { configurable: true, value: 300 });
      viewport.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.innerHeight), height);
    assert.equal(await page.locator('body').evaluate(e => e.getBoundingClientRect().height), 300);
    assert.deepEqual(await copyState(page), beforeKeyboard);
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 44 });
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#canvasWrap').evaluate(e => e.clientHeight), 0);
    await page.evaluate(() => {
      delete window.visualViewport.height;
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(100);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, right: 0, bottom: 34, left: 0 } });
    await pane(page, 'export');
    assert.equal(await page.locator('#sidebar').evaluate(e => getComputedStyle(e).paddingBottom), '34px');
    assert((await page.locator('#btnExport').boundingBox()).y + 44 <= height - 34);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    await cdp.detach();
    // Every generation mode keeps its mode-aware task label and leaves Sponsors independent.
    for (const [mode, label] of [['depthmap', 'Image'], ['drape', 'Drape'], ['noise', 'Relief']]) {
      await page.locator(`.mode-tab[data-mode="${mode}"]`).click();
      await pane(page, 'generator');
      assert.equal(await page.locator('#tab-generator').textContent(), label);
      if (mode === 'drape') await page.waitForFunction(() => document.getElementById('drapeStatus').textContent.includes('Bare figure'), null, { timeout: 60000 });
      if (mode === 'depthmap') {
        await open(page, 'depth-map');
        await page.locator('#depthMapInput').setInputFiles({ name: 'frame-proof.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="173" height="127"><rect width="173" height="127" fill="white"/><rect width="80" height="127" fill="black"/></svg>') });
        await page.waitForFunction(() => document.getElementById('depthMapInput').closest('.upload-zone').textContent.includes('frame-proof.svg'));
      }
      if (mode !== 'noise') {
        await page.waitForFunction(() => !document.getElementById('genOverlay').classList.contains('visible'));
        const dimensions = await page.locator('#shapePane input[data-key]').evaluateAll(inputs => Object.fromEntries(inputs.map(input => [input.dataset.key, Number(input.dataset.value)])));
        await fit(page);
        await checkProjectedFit(page, { x: dimensions.meshX, y: dimensions.meshY, stock: dimensions.baseThickness });
        if (output) { await page.locator('#toast').waitFor({ state: 'hidden' }); await page.screenshot({ path: `${output}/${width}-${mode}-fit.png` }); }
        await pane(page, 'generator');
      }
      await page.locator('#generatorPane .section').evaluateAll(sections => sections.forEach(section => section.classList.remove('collapsed')));
      await checkTargets(page);
      await pane(page, 'sponsors');
      assert.equal(await page.locator('body').getAttribute('class'), `mode-${mode}`);
      await checkTargets(page);
    }
    await pane(page, 'generator');
    await verifySmallMasterRanges(page);
    await fit(page);
    await checkProjectedFit(page, { x: 0.5, y: 0.75, stock: 0.125 });
    assert.deepEqual(errors, []);
    receipts.push({ width, visibleCanvas: initialCanvas.height, allOpenReliefControls: count, targets: true, fit: true, snaps: true, modes: true });
    process.stdout.write(`PASS mobile layout ${width}x${height}\n`);
    await context.close();
  }
  process.stdout.write(JSON.stringify(receipts) + '\n');
} finally {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
