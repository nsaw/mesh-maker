import assert from 'node:assert/strict';

const pane = (page, name) => page.locator(`#tab-${name}`).click();
const sidebar = page => page.locator('#sidebar');
const position = page => sidebar(page).evaluate(element => element.scrollTop);
const setRange = (page, key, value) => page.locator(`#sl_${key}`).evaluate((element, number) => {
  element.value = String(number);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}, value);
async function open(page, section) {
  const toggle = page.locator(`#${section}-section-body-toggle`);
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}
async function scroll(page, value) {
  return sidebar(page).evaluate((element, target) => { element.scrollTop = target; return element.scrollTop; }, value);
}
async function resize(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForFunction(expected => document.body.dataset.mobileLayout === String(expected), width <= 900);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function roundTrip(page, name, focusId, requestedScroll) {
  if (name !== 'export') {
    await page.locator('#sheetHandle').press('Home');
    await page.locator('#sheetHandle').press('ArrowUp');
  }
  const control = page.locator(`#${focusId}`);
  await control.focus();
  await control.evaluate(element => { window.breakpointControl = element; });
  const mobileScroll = await scroll(page, requestedScroll);
  assert(mobileScroll > 0, `${name} has a nonzero mobile scroll to preserve`);
  // Deliberately resize immediately after setting scroll, matching the cold probe's ordering.
  await resize(page, 1440, 900);
  assert.equal(await control.evaluate(element => element === window.breakpointControl), true, `${name} retains its canonical node`);
  assert.equal(await page.evaluate(() => document.activeElement === window.breakpointControl), true, `${name} retains focused node on desktop`);
  const desktopScroll = await scroll(page, 35);
  await resize(page, 390, 664);
  assert.equal(await position(page), mobileScroll, `${name} restores its outgoing phone snapshot before CSS clamping`);
  assert.equal(await page.evaluate(() => document.activeElement === window.breakpointControl), true, `${name} retains focused node on phone`);
  await resize(page, 1440, 900);
  assert.equal(await position(page), desktopScroll, `${name} restores the separate desktop snapshot`);
  await resize(page, 390, 664);
  assert.equal(await position(page), mobileScroll, `${name} retains the phone snapshot on a repeated round trip`);
  return mobileScroll;
}

/** Every mobile task and generation mode keeps its own view through both breakpoint directions. */
export async function verifyPresentationHistory(page) {
  await pane(page, 'generator');
  await open(page, 'noise-parameters');
  await setRange(page, 'resolution', 40);
  await page.selectOption('#selNoiseType', 'voronoi-relief');
  const expected = new Map();
  for (const [name, section, focus, amount] of [
    ['shape', 'mesh-dimensions', 'sl_resolution', 180],
    ['generator', 'layout', 'sl_reliefAnisotropy', 300],
    ['view', 'view-controls', 'sl_orbit', 180],
    ['export', 'sbp', 'filenameInput', 300],
    ['sponsors', null, 'btnSponsorsBack', 30],
  ]) {
    await pane(page, name);
    if (name === 'export') await page.locator('[data-fmt="sbp"]').click();
    if (section) await open(page, section);
    expected.set(name, await roundTrip(page, name, focus, amount));
  }
  // Siblings retain their own positions; navigation cannot replace one task's snapshot with another's.
  for (const [name, amount] of expected) {
    if (name !== 'export') { await page.locator('#sheetHandle').press('Home'); await page.locator('#sheetHandle').press('ArrowUp'); }
    await pane(page, name);
    assert.equal(await position(page), amount, `${name} retains its sibling-pane scroll`);
  }
  await pane(page, 'generator');
  await scroll(page, 140);
  await pane(page, 'sponsors');
  await page.locator('.mode-tab[data-mode="noise"]').click();
  assert.equal(await page.locator('#tab-generator').getAttribute('aria-selected'), 'true');
  assert.equal(await position(page), 140, 'mode navigation reveals controls before restoring their scroll');
  await pane(page, 'sponsors');
  await page.locator('#btnSponsorsBack').click();
  assert.equal(await position(page), 140, 'Sponsors Back restores the task before the legacy pane handler');
  for (const [mode, section, focus] of [
    ['depthmap', 'depth-map', 'sl_dmHeightScale'],
    ['drape', 'drape-cloth', 'sl_drapeClothRes'],
    ['noise', 'layout', 'sl_reliefAnisotropy'],
  ]) {
    await page.locator(`.mode-tab[data-mode="${mode}"]`).click();
    await pane(page, 'generator');
    if (mode === 'drape') await page.waitForFunction(() => document.getElementById('drapeStatus').textContent.includes('Bare figure'), null, { timeout: 60000 });
    await open(page, section);
    await roundTrip(page, mode, focus, 100);
    assert.equal(await page.locator(`#${section}-section-body-toggle`).getAttribute('aria-expanded'), 'true', `${mode} retains its section history`);
  }
  // A legitimate content shrink clamps the stored position, rather than resurrecting an invalid offset.
  await setRange(page, 'reliefRadialFociCount', 3);
  await scroll(page, 100000);
  const expanded = await position(page);
  await setRange(page, 'reliefRadialFociCount', 0);
  const clamped = await position(page);
  const maximum = await sidebar(page).evaluate(element => element.scrollHeight - element.clientHeight);
  assert.equal(clamped, Math.min(expanded, maximum));
  assert(clamped < expanded, 'hiding radial controls really reduces the scroll range');
  await pane(page, 'view');
  await pane(page, 'generator');
  assert.equal(await position(page), clamped, 'content-driven clamp survives task navigation');
}

/** Generated degradation metadata remains visible in the compact phone HUD. */
export async function verifyVisibleSiteCap(page) {
  await pane(page, 'export');
  await page.locator('[data-fmt="stl"]').click();
  await pane(page, 'generator');
  await setRange(page, 'reliefCellSize', 0.4);
  await page.locator('#sheetHandle').press('Home');
  await page.waitForFunction(() => {
    const stats = document.getElementById('statsOverlay');
    return !document.getElementById('genOverlay').classList.contains('visible') && stats.textContent.includes('Cells capped') && stats.textContent.includes('Vertices');
  });
  const warning = page.locator('#statsOverlay .stat-diagnostic').filter({ hasText: 'Cells capped' });
  assert.match(await warning.textContent(), /4,096 of [\d,]+; raise Cell Size/);
  assert((await warning.boundingBox()).height > 0);
  assert.equal(await warning.getAttribute('role'), 'status');
  assert((await page.locator('body').innerText()).includes('Cells capped'), 'actual visible body text discloses the cap');
  assert.equal(await page.locator('#statsOverlay .stat-secondary').evaluateAll(rows => rows.every(row => getComputedStyle(row).display === 'none')), true);
}

/** All legacy root-pane entry points share capture, reveal, rebuild and restore ordering. */
export async function verifyRootPaneTransitions(page) {
  const tasks = [['shape', 'mesh-dimensions'], ['generator', 'layout'], ['view', 'view-controls'], ['export', 'sbp']];
  for (const [task, section] of tasks) {
    await page.locator('.mode-tab[data-mode="noise"]').click();
    await pane(page, task);
    await open(page, section);
    if (task !== 'export') { await page.locator('#sheetHandle').press('Home'); await page.locator('#sheetHandle').press('ArrowUp'); }
    const saved = await scroll(page, 100);
    assert(saved > 0, `${task} Back test has real scroll`);
    await pane(page, 'sponsors');
    await page.locator('#btnSponsorsBack').click();
    assert.equal(await page.locator(`#tab-${task}`).getAttribute('aria-selected'), 'true', `Back returns to ${task}`);
    assert.equal(await position(page), saved, `${task} Back reveals before restoring`);
    for (const [mode, label] of [['noise', 'Relief'], ['depthmap', 'Image'], ['drape', 'Drape']]) {
      await pane(page, task);
      await pane(page, 'sponsors');
      await page.locator(`.mode-tab[data-mode="${mode}"]`).click();
      if (mode === 'drape') await page.waitForFunction(() => document.getElementById('drapeStatus').textContent.includes('Bare figure'), null, { timeout: 60000 });
      assert.equal(await page.locator('#controlsPane').isVisible(), true);
      assert.equal(await page.locator('#sponsorsPane').isVisible(), false);
      assert.equal(await page.locator(`#tab-${task}`).getAttribute('aria-selected'), 'true', `${mode} keeps the independent ${task} task`);
      assert.equal(await page.locator(`[data-control-pane="${task}"]`).getAttribute('data-mobile-hidden'), 'false');
      assert.equal(await page.locator('#tab-generator').textContent(), label);
    }
  }
  await resize(page, 1440, 900);
  for (const mode of ['noise', 'depthmap', 'drape']) {
    await page.locator(`.mode-tab[data-mode="${mode}"]`).click();
    if (mode === 'drape') await page.waitForFunction(() => document.getElementById('drapeStatus').textContent.includes('Bare figure'), null, { timeout: 60000 });
    await page.locator('#sl_resolution').focus();
    await page.locator('#sl_resolution').evaluate(element => { window.rootPaneControl = element; });
    const saved = await scroll(page, 100);
    await page.locator('#btnSponsors').click();
    assert.equal(await page.locator('#sponsorsPane').isVisible(), true);
    await page.locator('#btnSponsorsBack').click();
    assert.equal(await position(page), saved, `desktop ${mode} Controls/Sponsors scroll`);
    assert.equal(await page.evaluate(() => document.activeElement === window.rootPaneControl), true, `desktop ${mode} restores the canonical focused control`);
    await page.locator('#btnSponsors').click();
    await page.locator(`.mode-tab[data-mode="${mode}"]`).click();
    assert.equal(await page.locator('#controlsPane').isVisible(), true);
    assert.equal(await page.locator('#sponsorsPane').isVisible(), false);
    assert.equal(await page.locator('body').getAttribute('class'), `mode-${mode}`);
  }
  await page.locator('.mode-tab[data-mode="noise"]').click();
  await resize(page, 390, 664);
}

/** Defer only the app's query-change callback, exposing the rebuild-before-CSS-switch phase. */
export function installDeferredLayoutProbe() {
  const add = MediaQueryList.prototype.addEventListener;
  MediaQueryList.prototype.addEventListener = function(type, listener, options) {
    if (type !== 'change' || this.media !== '(max-width: 900px)') return add.call(this, type, listener, options);
    return add.call(this, type, event => {
      window.releaseLayoutChange = () => {
        delete window.releaseLayoutChange;
        listener.call(this, event);
      };
    }, options);
  };
}

export async function verifyDeferredLayoutRebuild(page) {
  await pane(page, 'generator');
  await open(page, 'noise-parameters');
  await page.selectOption('#selNoiseType', 'voronoi-relief');
  await open(page, 'layout');
  await scroll(page, 300);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => Boolean(window.releaseLayoutChange));
  assert.equal(await page.locator('body').getAttribute('data-mobile-layout'), 'true');
  await page.locator('#btnOverflow').click();
  await page.locator('#btnResetCamera').click();
  assert.equal(await position(page), 300, 'pending desktop query keeps the applied phone snapshot during rebuild');
  assert.equal(await page.locator('#generatorPane').getAttribute('role'), 'tabpanel');
  await page.evaluate(() => window.releaseLayoutChange());
  await page.waitForFunction(() => document.body.dataset.mobileLayout === 'false');
  const desktopScroll = await scroll(page, 35);
  await page.setViewportSize({ width: 390, height: 664 });
  await page.waitForFunction(() => Boolean(window.releaseLayoutChange));
  await page.locator('#btnResetCamera').click();
  assert.equal(await page.locator('#layout-section-body-toggle').getAttribute('aria-expanded'), 'true', 'pending phone query does not apply mobile accordion rules to desktop');
  assert.equal(await position(page), desktopScroll);
  await page.evaluate(() => window.releaseLayoutChange());
  await page.waitForFunction(() => document.body.dataset.mobileLayout === 'true');
  assert.equal(await position(page), 300);
  assert.equal(await page.locator('#layout-section-body-toggle').getAttribute('aria-expanded'), 'true');
}
