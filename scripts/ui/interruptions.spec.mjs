import { verifyEditorLifecycle, verifyPaneFocusAndNumericLinks, verifyMobileFirstUse } from './pane-regressions.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { preview } from 'vite';
import { verifyCameraResets, verifyCountDomains, verifyCoupledClearances, verifyDimensionResetLayout, verifyOffStepDrapeDefaults, verifyProgrammaticRangeSync, verifySbpDefaults, verifySmallMasterRanges, verifySourceOwnership } from './reset-regressions.mjs';

let server;
let browser;
try {
  let origin = process.env.MESHCRAFT_UI_ORIGIN;
  if (!origin) {
    server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } });
    const address = server.httpServer.address();
    assert(address && typeof address !== 'string');
    origin = `http://127.0.0.1:${address.port}`;
  }
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 664 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Block remote imagery to exercise the offline layout and avoid optional demo timing.
  await page.route(/^https:\/\//, route => route.abort());
  await page.goto(origin);
  await page.waitForSelector('#selPreset');
  assert.equal(await page.locator('#seedInput').getAttribute('placeholder'), 'seed');
  await page.locator('#noise-parameters-section-body-toggle').click();
  const seed = await page.locator('#seedInput').inputValue();
  await page.locator('#seedInput').fill('');
  await page.locator('#seedInput').dispatchEvent('change');
  assert.match(await page.locator('#seedInput').inputValue(), /^\d+$/);
  assert.notEqual(await page.locator('#seedInput').inputValue(), '');
  await page.locator('#sl_resolution').evaluate(element => { element.value = '40'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#presets-section-body-toggle').click();
  await page.selectOption('#selPreset', 'relief-pockets');
  const reliefToggle = page.locator('#cell-relief-section-body-toggle');
  await reliefToggle.click();
  const sidebar = page.locator('#sidebar');
  await sidebar.evaluate(element => { element.scrollTop = 100; });
  const beforeScroll = await sidebar.evaluate(element => element.scrollTop);
  await page.locator('[data-profile="organic"]').dispatchEvent('click');
  assert.equal(await reliefToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await sidebar.evaluate(element => element.scrollTop), beforeScroll);
  await reliefToggle.click();
  await page.locator('[data-profile="organic"]').dispatchEvent('click');
  assert.equal(await reliefToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#controlsPane .section-header[aria-expanded="true"]').count(), 0);

  // Restoring controls after viewing sponsors preserves mode, open sections and scroll.
  await reliefToggle.click();
  await sidebar.evaluate(element => { element.scrollTop = 140; });
  const savedScroll = await sidebar.evaluate(element => element.scrollTop);
  await page.locator('#btnSponsors').click();
  assert.equal(await page.locator('body').getAttribute('class'), 'mode-noise');
  assert.equal(await page.locator('#controlsPane').isVisible(), false);
  assert.equal(await page.locator('#sponsorsPane').isVisible(), true);
  assert.equal(await page.locator('#sponsorsPane a[target="_blank"]').count(), 2);
  const popupLinks = await page.locator('#sponsorsPane a').evaluateAll(links => links.map(link => ({ href: link.href, rel: link.rel })));
  assert.deepEqual(popupLinks.map(link => link.href), ['https://shopbottools.com/products/desktop-max-atc/', 'https://bitsbits.com/']);
  assert(popupLinks.every(link => link.rel.includes('noopener')));
  for (const link of await page.locator('#sponsorsPane a').all()) {
    const popupPromise = page.waitForEvent('popup');
    await link.click();
    const popup = await popupPromise;
    await popup.close();
  }
  await page.locator('#btnSponsorsBack').click();
  assert.equal(await reliefToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await sidebar.evaluate(element => element.scrollTop), savedScroll);

  await page.locator('#mesh-dimensions-section-body-toggle').click();
  const resolution = page.locator('#sl_resolution');
  await resolution.evaluate(element => { element.value = '80'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  const reset = page.locator('[data-reset-for="sl_resolution"]');
  assert.equal(await reset.isVisible(), true);
  await reset.tap();
  assert.equal(await resolution.inputValue(), await resolution.getAttribute('data-default'));
  assert.equal(await reset.isVisible(), false);
  await resolution.evaluate(element => { element.value = '40'; element.dispatchEvent(new Event('input', { bubbles: true })); });

  await page.locator('#view-controls-section-body-toggle').click();
  await page.locator('#sl_orbit').evaluate(element => { element.value = '90'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#btnResetCamera').click();
  assert.equal(await page.locator('#sl_orbit').inputValue(), await page.locator('#sl_orbit').getAttribute('data-default'));
  assert.equal(await page.locator('#sl_tilt').inputValue(), await page.locator('#sl_tilt').getAttribute('data-default'));
  assert.equal(await page.locator('#sl_zoom').inputValue(), await page.locator('#sl_zoom').getAttribute('data-default'));
  assert.equal(await page.locator('#sl_roll').inputValue(), await page.locator('#sl_roll').getAttribute('data-default'));
  await page.locator('#sl_orbit').focus();
  await page.locator('[data-profile="organic"]').dispatchEvent('click');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'sl_orbit');
  await page.locator('#val_orbit').click();
  await page.locator('#val_orbit .val-edit').fill('123');
  await page.locator('[data-profile="organic"]').dispatchEvent('click');
  assert.equal(await page.locator('#val_orbit .val-edit').inputValue(), '123');
  await page.locator('#val_orbit .val-edit').press('Escape');

  await page.locator('.format-btn[data-fmt="sbp"]').click();
  await page.locator('#sbp-section-body-toggle').click();
  await page.selectOption('#sbpProfile', 'hardwood');
  assert.equal(await page.locator('#sbp-section-body-toggle').getAttribute('aria-expanded'), 'true');
  await page.locator('#sl_sbpFeedRate').evaluate(element => { element.value = '7'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('[data-reset-for="sl_sbpFeedRate"]').tap();
  assert.equal(await page.locator('#sl_sbpFeedRate').inputValue(), await page.locator('#sl_sbpFeedRate').getAttribute('data-default'));
  await page.locator('#sbp-section-body-toggle').click();
  await page.locator('#btnResetCamera').click();
  assert.equal(await page.locator('#sbp-section-body-toggle').getAttribute('aria-expanded'), 'false');

  // Drape aliases retain their own reset defaults and minimum backing.
  await page.locator('.mode-tab[data-mode="drape"]').click();
  await page.waitForFunction(() => document.getElementById('drapeStatus').textContent.includes('Bare figure'), null, { timeout: 60000 });
  const openSection = async id => {
    const toggle = page.locator(`#${id}-toggle`);
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  };
  const setRange = async (key, value) => page.locator(`#sl_${key}`).evaluate((element, number) => {
    element.value = String(number); element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await openSection('mesh-dimensions-section-body');
  assert.equal(await page.locator('#sl_meshX').getAttribute('data-default'), '12');
  assert.equal(await page.locator('#sl_meshY').getAttribute('data-default'), '16');
  assert.equal(await page.locator('#sl_baseThickness').getAttribute('data-default'), '0.75');
  await setRange('meshX', 15);
  await page.locator('[data-reset-for="sl_meshY"]').tap();
  assert.equal(await page.locator('#sl_meshX').inputValue(), '12');
  assert.equal(await page.locator('#sl_meshY').inputValue(), '16');
  await setRange('meshY', 20);
  await page.locator('[data-reset-for="sl_meshX"]').tap();
  assert.equal(await page.locator('#sl_meshX').inputValue(), '12');
  assert.equal(await page.locator('#sl_meshY').inputValue(), '16');
  await setRange('baseThickness', 0.25);
  await openSection('drape-carve-section-body');
  await setRange('drapeReliefDepth', 0.1);
  await page.locator('[data-reset-for="sl_drapeReliefDepth"]').tap();
  assert.equal(await page.locator('#sl_drapeReliefDepth').inputValue(), '0.1875');
  assert.equal(0.25 - Number(await page.locator('#sl_drapeReliefDepth').inputValue()), 1 / 16);
  assert.equal(await page.locator('[data-reset-for="sl_drapeReliefDepth"]').getAttribute('hidden'), '');
  await openSection('mesh-dimensions-section-body');
  await page.locator('[data-reset-for="sl_baseThickness"]').tap();
  assert.equal(await page.locator('#sl_baseThickness').inputValue(), '0.75');
  await openSection('drape-carve-section-body');
  await page.locator('[data-reset-for="sl_drapeReliefDepth"]').tap();
  assert.equal(await page.locator('#sl_drapeReliefDepth').inputValue(), '0.625');

  // A remap updates safe Z asynchronously, without an input event on its slider.
  await openSection('sbp-section-body');
  await setRange('sbpSafeZ', 1.2);
  await openSection('mesh-dimensions-section-body');
  await setRange('baseThickness', 1.5);
  await page.waitForFunction(() => document.getElementById('sl_sbpSafeZ').value === '1.6');
  assert.equal(await page.locator('#sl_sbpSafeZ').getAttribute('data-default'), '1.6');
  assert.equal(await page.locator('[data-reset-for="sl_sbpSafeZ"]').getAttribute('hidden'), '');

  // Independent desktop sessions exercise reset targets across rebuilds and gesture inputs.
  for (const verify of [verifyEditorLifecycle, verifyPaneFocusAndNumericLinks, verifySourceOwnership, verifyCountDomains, verifySbpDefaults, verifyCameraResets, verifyCountDomains, verifyCoupledClearances, verifyOffStepDrapeDefaults, verifyProgrammaticRangeSync, verifySmallMasterRanges]) {
    const regressionContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
    const regressionPage = await regressionContext.newPage();
    regressionPage.on('pageerror', error => errors.push(error.message));
    await regressionPage.route(/^https:\/\//, route => route.abort());
    await regressionPage.goto(origin);
    await regressionPage.waitForSelector('#selPreset');
    await verify(regressionPage);
    await regressionContext.close();
  }

  for (const [width, height] of [[1440, 900], [834, 1112], [390, 664]]) {
    const layoutContext = await browser.newContext({ viewport: { width, height }, hasTouch: width < 900 });
    const layoutPage = await layoutContext.newPage();
    layoutPage.on('pageerror', error => errors.push(error.message));
    await layoutPage.route(/^https:\/\//, route => route.abort());
    await layoutPage.goto(origin);
    await layoutPage.waitForSelector('#selPreset');
    await verifyDimensionResetLayout(layoutPage);
    await layoutContext.close();
  }

  const firstUseContext = await browser.newContext({ viewport: { width: 390, height: 664 }, hasTouch: true });
  const firstUsePage = await firstUseContext.newPage();
  firstUsePage.on('pageerror', error => errors.push(error.message));
  await firstUsePage.route(/^https:\/\//, route => route.abort());
  await firstUsePage.goto(origin);
  await firstUsePage.waitForSelector('#selPreset');
  await verifyMobileFirstUse(firstUsePage);
  await firstUseContext.close();

  // No sponsor content appears without an explicit request, past both old timer windows.
  await page.goto(origin);
  await page.waitForSelector('#selPreset');
  await page.waitForTimeout(90_000);
  assert.equal(await page.locator('#sponsorsPane').isVisible(), false);
  assert.equal(await page.locator('.sponsor-backdrop, .bb-banner').count(), 0);
  assert.deepEqual(errors, []);
  process.stdout.write(JSON.stringify({ result: 'ALL OK', seed, sponsors: true, noTimedOverlayAfterMs: 90000, persistentSections: true, allClosed: true, paneScroll: true, focus: true, reset: true, sbpRebuild: true, drapeResetAliases: true, drapeMinimumBacking: true, dependentResetVisibility: true, stableSbpDefaults: true, gestureResetVisibility: true, constrainedClearanceReset: true, containedDimensionTargets: true, offStepDrapeRoundTrips: true, programmaticRangeCoherence: true, smallMasterReadout: true, discreteCountDomains: true, sourceControlOwnership: true, paneFocusAndNumericLinks: true, editorLifecycle: true, mobileFirstUse: true }) + '\n');
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
