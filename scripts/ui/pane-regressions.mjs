import assert from 'node:assert/strict';
import { verifyNumericLinks } from './reset-regressions.mjs';
const input = (page, key) => page.locator(`#sl_${key}`);

/** Explicit pane navigation restores the last eligible control or editor. */
export async function verifyPaneFocusAndNumericLinks(page) {
  await input(page, 'resolution').focus();
  await page.locator('#btnSponsors').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btnSponsorsBack');
  await page.locator('#btnSponsorsBack').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'sl_resolution');
  await page.locator('#val_resolution').click();
  await page.locator('#val_resolution .val-edit').fill('20');
  await page.locator('#btnSponsors').click();
  await page.locator('#btnSponsorsBack').click();
  assert.equal(await page.locator('#val_resolution .val-edit').inputValue(), '20');
  assert.equal(await page.locator('#val_resolution .val-edit').evaluate(element => element === document.activeElement), true);
  await page.locator('#val_resolution .val-edit').press('Enter');
  await page.locator('#seedInput').focus();
  await page.locator('#btnSponsors').click();
  await page.locator('.mode-tab[data-mode="drape"]').click();
  await page.locator('#btnSponsors').click();
  await page.locator('#btnSponsorsBack').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btnSponsors');
  assert.equal(await page.locator('#btnSponsors').isVisible(), true);
  await verifyNumericLinks(page);
}

/** Hidden modes do not inherit expanded construction defaults or erase another mode's choices. */
export async function verifyMobileFirstUse(page) {
  const open = () => page.locator('#controlsPane .section').evaluateAll(sections => sections.filter(section => section.offsetParent !== null && !section.classList.contains('collapsed')).map(section => section.querySelector('.section-title').textContent));
  assert.deepEqual(await open(), ['Presets']);
  await page.locator('.mode-tab[data-mode="drape"]').click();
  assert((await open()).length <= 1);
  await page.locator('#drape-cloth-section-body-toggle').click();
  assert.deepEqual(await open(), ['Drape: Cloth']);
  await page.locator('.mode-tab[data-mode="noise"]').click();
  await page.locator('#advanced-noise-section-body-toggle').click();
  assert.deepEqual(await open(), ['Advanced Noise']);
  await page.locator('.mode-tab[data-mode="drape"]').click();
  assert.deepEqual(await open(), ['Drape: Cloth']);
  await page.locator('#drape-cloth-section-body-toggle').click();
  assert.deepEqual(await open(), []);
  await page.locator('#btnResetCamera').click();
  assert.deepEqual(await open(), []);
  await page.locator('.mode-tab[data-mode="depthmap"]').click();
  assert((await open()).length <= 1);
  await page.locator('.mode-tab[data-mode="noise"]').click();
  assert.deepEqual(await open(), ['Advanced Noise']);
}

/** Completed edits cannot return as drafts; genuinely unfinished edits survive teardown. */
export async function verifyEditorLifecycle(page) {
  const orbit = page.locator('#sl_orbit'), label = page.locator('#val_orbit');
  const original = Number(await orbit.getAttribute('data-value'));
  const roundTrip = async () => { await page.locator('#btnSponsors').click(); await page.locator('#btnSponsorsBack').click(); };
  await label.click(); await page.locator('#val_orbit .val-edit').fill('123'); await page.locator('#val_orbit .val-edit').press('Escape');
  assert.equal(Number(await orbit.getAttribute('data-value')), original);
  assert.equal(await page.locator('#val_orbit .val-edit').count(), 0);
  await roundTrip();
  assert.equal(await page.locator('#val_orbit .val-edit').count(), 0, 'canceled draft stays closed on pane return');
  assert.equal(Number(await orbit.getAttribute('data-value')), original);
  for (const value of [String(original), '', 'invalid', '124']) {
    await label.click(); await page.locator('#val_orbit .val-edit').fill(value); await page.locator('#val_orbit .val-edit').press('Enter');
    await roundTrip(); assert.equal(await page.locator('#val_orbit .val-edit').count(), 0, 'explicit completion stays closed');
  }
  assert.equal(Number(await orbit.getAttribute('data-value')), 124);
  await label.click(); await page.locator('#val_orbit .val-edit').fill('invalid');
  await roundTrip(); assert.equal(await page.locator('#val_orbit .val-edit').count(), 0, 'invalid blur does not revive a rejected draft');
  assert.equal(Number(await orbit.getAttribute('data-value')), 124);
  await label.click(); await page.locator('#val_orbit .val-edit').fill('999');
  await roundTrip(); assert.equal(await page.locator('#val_orbit .val-edit').count(), 0, 'clamped blur does not revive rejected text');
  assert.equal(Number(await orbit.getAttribute('data-value')), Number(await orbit.getAttribute('max')));
  // Programmatic full rebuilds preserve both valid and transitional unfinished input.
  for (const draft of ['125', '-']) {
    await label.click(); await page.locator('#val_orbit .val-edit').fill(draft);
    await page.locator('[data-profile="organic"]').dispatchEvent('click');
    assert.equal(await page.locator('#val_orbit .val-edit').inputValue(), draft);
    assert.equal(await page.locator('#val_orbit .val-edit').evaluate(element => element === document.activeElement), true);
    await page.locator('#val_orbit .val-edit').press('Escape');
    await roundTrip(); assert.equal(await page.locator('#val_orbit .val-edit').count(), 0);
  }
  await page.locator('.format-btn[data-fmt="sbp"]').click();
  await page.locator('#val_sbpFeedRate').click(); await page.locator('#val_sbpFeedRate .val-edit').fill('1.2345');
  await page.locator('#sbpProfile').evaluate(element => { element.value = 'hardwood'; element.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(await page.locator('#val_sbpFeedRate .val-edit').inputValue(), '1.2345');
  assert.equal(await page.locator('#val_sbpFeedRate .val-edit').evaluate(element => element === document.activeElement), true);
  await page.locator('#val_sbpFeedRate .val-edit').press('Escape');
  await roundTrip(); assert.equal(await page.locator('#val_sbpFeedRate .val-edit').count(), 0);
}
