import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const setRange = async (page, key, value) => page.locator(`#sl_${key}`).evaluate((element, number) => {
  element.value = String(number);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
const reset = (page, key) => page.locator(`[data-reset-for="sl_${key}"]`);
const input = (page, key) => page.locator(`#sl_${key}`);

async function copiedConfiguration(page) {
  // Record the app's real serialized output without changing the system clipboard.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async text => { document.documentElement.dataset.testCopiedLink = text; },
    } });
  });
  await page.locator('#btnCopyLink').click();
  const link = await page.evaluate(() => document.documentElement.dataset.testCopiedLink);
  assert(link);
  const encoded = new URL(link).searchParams.get('c');
  return { link, config: encoded ? JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) : {} };
}

async function assertSerializedRange(page, key, fallback) {
  const config = (await copiedConfiguration(page)).config;
  let state = config[key] ?? fallback;
  // Drape aliases own requests. meshX/Y follow the completed master; baseThickness follows the
  // stock request immediately, while stockTopIn() supplies export-authoritative stock.
  if (config.mode === 'drape') {
    const defaultValue = Number(await input(page, key).getAttribute('data-default'));
    if (key === 'baseThickness') state = config.drapeStock ?? defaultValue;
    if (key === 'meshX') state = config.drapeCarveWidth ?? defaultValue;
    if (key === 'meshY') state = (config.drapeCarveWidth ?? defaultValue * 0.75) / 0.75;
  }
  assert.equal(Number(await input(page, key).getAttribute('data-value')), state, `${key} controller equals actual serialized state`);
  const thumb = Number(await input(page, key).inputValue());
  assert(Math.abs(thumb - state) <= 32 * Number.EPSILON * Math.max(1, Math.abs(state)), `${key} native thumb stays within its floating-point serialization bound`);
  assert.equal(Number(await page.locator(`#val_${key}`).textContent()), state, `${key} label equals actual serialized state`);
  return state;
}

async function assertDefault(page, key, expected) {
  assert.equal(Number(await input(page, key).getAttribute('data-default')), expected, `${key} retains its reset target`);
}
async function assertReset(page, key, expected) {
  assert.equal(await reset(page, key).getAttribute('hidden'), null, `${key} offers reset after an edit`);
  await reset(page, key).tap();
  assert.equal(Number(await input(page, key).inputValue()), expected, `${key} resets to its default`);
  assert.equal(Number(await page.locator(`#val_${key}`).textContent()), expected, `${key} value label agrees with its reset target`);
  assert.equal(await reset(page, key).getAttribute('hidden'), '', `${key} hides reset at its default`);
}

/** Both full-sidebar and SBP-profile rebuilds retain settings without redefining defaults. */
export async function verifySbpDefaults(page) {
  await page.locator('.format-btn[data-fmt="sbp"]').click();
  const fixed = { sbpLeaveStock: 0.02, sbpOffsetX: 2, sbpOffsetY: 2, sbpRasterAngle: 45 };
  const edited = { sbpLeaveStock: 0.04, sbpOffsetX: 3.5, sbpOffsetY: 4.5, sbpRasterAngle: 30, sbpHomeZ: 4, sbpSafeZ: 2 };
  const defaults = { ...fixed, sbpSafeZ: 0.9, sbpHomeZ: 1.4 };
  const overrides = { sbpFeedRate: 7, sbpPlungeRate: 2, sbpRpm: 24000, sbpStepdown: 0.8, sbpStepover: 0.3 };
  const profileDefaults = {};
  for (const key of Object.keys(overrides)) profileDefaults[key] = Number(await input(page, key).getAttribute('data-default'));
  for (const [key, value] of Object.entries(edited)) await setRange(page, key, value);
  for (const [key, value] of Object.entries(overrides)) await setRange(page, key, value);
  await page.locator('#btnResetCamera').click();
  for (const [key, value] of Object.entries(edited)) {
    assert.equal(Number(await input(page, key).inputValue()), value, `${key} edit survives a camera reset`);
    await assertDefault(page, key, defaults[key]);
  }
  // Reset Safe Z first so Home Z can return to the stock-derived clearance.
  for (const key of ['sbpSafeZ', 'sbpHomeZ', ...Object.keys(fixed)]) await assertReset(page, key, defaults[key]);
  for (const key of Object.keys(overrides)) {
    assert.equal(Number(await input(page, key).inputValue()), overrides[key], `${key} override survives a sidebar rebuild`);
    await assertDefault(page, key, profileDefaults[key]);
    await assertReset(page, key, profileDefaults[key]);
    await page.locator(`#val_${key}`).click();
    await page.locator(`#val_${key} .val-edit`).press('Enter');
    assert.equal(Number(await input(page, key).inputValue()), profileDefaults[key], `${key} unchanged value edit preserves the exact profile value`);
  }

  for (const [key, value] of Object.entries(edited)) await setRange(page, key, value);
  await page.selectOption('#sbpProfile', 'hardwood');
  for (const [key, value] of Object.entries(edited)) {
    assert.equal(Number(await input(page, key).inputValue()), value, `${key} edit survives a profile rebuild`);
    await assertDefault(page, key, defaults[key]);
  }
  for (const key of ['sbpSafeZ', 'sbpHomeZ', ...Object.keys(fixed)]) await assertReset(page, key, defaults[key]);
  // Each override now resets to this profile, independent of its manually entered value.
  for (const [key, value] of Object.entries(overrides)) {
    const expected = Number(await input(page, key).getAttribute('data-default'));
    await setRange(page, key, value);
    await page.locator('#btnResetCamera').click();
    await assertDefault(page, key, expected);
    await assertReset(page, key, expected);
  }

  // Clearance defaults follow the stock while preserving raised settings on rebuild.
  await setRange(page, 'baseThickness', 1.5);
  await assertDefault(page, 'sbpSafeZ', 1.6);
  await assertDefault(page, 'sbpHomeZ', 2.1);
  await setRange(page, 'sbpHomeZ', 4);
  await setRange(page, 'sbpSafeZ', 3);
  await page.locator('#btnResetCamera').click();
  await assertDefault(page, 'sbpSafeZ', 1.6);
  await assertDefault(page, 'sbpHomeZ', 2.1);
  await assertReset(page, 'sbpSafeZ', 1.6);
  await assertReset(page, 'sbpHomeZ', 2.1);
  await setRange(page, 'sbpHomeZ', 4);
  await setRange(page, 'baseThickness', 0.75);
  assert.equal(await input(page, 'sbpHomeZ').inputValue(), '4', 'a stock change preserves a raised Home Z');
  await assertDefault(page, 'sbpSafeZ', 0.9);
  await assertDefault(page, 'sbpHomeZ', 1.4);
  await page.locator('#btnResetCamera').click();
  await assertReset(page, 'sbpHomeZ', 1.4);
}

/** Mouse, wheel, touch and Fit update the same individual Reset controls as slider edits. */
export async function verifyCameraResets(page) {
  const wrap = page.locator('#canvasWrap');
  const box = await wrap.boundingBox();
  assert(box);
  const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
  const defaults = {};
  for (const key of ['orbit', 'tilt', 'roll', 'zoom']) defaults[key] = Number(await input(page, key).getAttribute('data-default'));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y + 40);
  await page.mouse.up();
  for (const key of ['orbit', 'tilt']) await assertReset(page, key, defaults[key]);

  // Return to the original camera through the gesture path too.
  for (const [dx, dy] of [[100, 40], [-100, -40]]) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy);
    await page.mouse.up();
  }
  for (const key of ['orbit', 'tilt']) {
    assert.equal(Number(await input(page, key).inputValue()), defaults[key]);
    assert.equal(await reset(page, key).getAttribute('hidden'), '', `${key} hides reset after the reverse gesture`);
  }
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => document.getElementById('sl_zoom').value !== document.getElementById('sl_zoom').dataset.default);
  await assertReset(page, 'zoom', defaults.zoom);

  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 80, y: y + 30, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  for (const key of ['orbit', 'tilt']) await assertReset(page, key, defaults[key]);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 20, y, id: 1 }, { x: x + 20, y, id: 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 35, y, id: 1 }, { x: x + 35, y, id: 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await assertReset(page, 'zoom', defaults.zoom);
  await touch.detach();

  for (const fit of [() => page.locator('#btnZoomExtents').click(), () => wrap.dblclick()]) {
    await page.locator('#btnResetCamera').click();
    await fit();
    for (const key of ['orbit', 'tilt', 'roll', 'zoom']) {
      const changed = Number(await input(page, key).inputValue()) !== defaults[key];
      assert.equal(await reset(page, key).getAttribute('hidden'), changed ? null : '', `${key} reset visibility follows Fit`);
      if (changed) await assertReset(page, key, defaults[key]);
    }
  }
}

/** A constrained reset changes only its own clearance and hides at the nearest legal value. */
export async function verifyCoupledClearances(page) {
  await page.locator('.format-btn[data-fmt="sbp"]').click();
  await setRange(page, 'sbpHomeZ', 4);
  await setRange(page, 'sbpSafeZ', 3);
  const assertBounds = async () => {
    assert.equal(Number(await input(page, 'sbpHomeZ').getAttribute('min')), 3.1, 'Home bound follows the other clearance');
    assert.equal(Number(await input(page, 'sbpSafeZ').getAttribute('max')), 3.9, 'Safe bound follows the other clearance');
  };
  await assertBounds();
  await input(page, 'sbpHomeZ').evaluate(control => { control.min = '1'; });
  await assert.rejects(assertBounds, /Home bound follows the other clearance/);
  await page.locator('#btnResetCamera').click();
  await assertBounds();
  await assertReset(page, 'sbpHomeZ', 3.1);
  assert.equal(await input(page, 'sbpSafeZ').inputValue(), '3', 'Home reset preserves raised Safe Z');
  await assertDefault(page, 'sbpHomeZ', 1.4);
  await reset(page, 'sbpHomeZ').dispatchEvent('click');
  assert.equal(await input(page, 'sbpHomeZ').inputValue(), '3.1', 'repeating the constrained reset is stable');
  await page.locator('#btnResetCamera').click();
  assert.equal(await reset(page, 'sbpHomeZ').getAttribute('hidden'), '', 'constrained reset stays hidden after rebuilding');

  await setRange(page, 'baseThickness', 1.5);
  assert.equal(await input(page, 'sbpHomeZ').inputValue(), '3.1', 'stock change preserves raised Home Z');
  await assertReset(page, 'sbpHomeZ', 2.1);
  assert.equal(await input(page, 'sbpSafeZ').inputValue(), '1.6');
  await setRange(page, 'sbpHomeZ', 4);
  await setRange(page, 'sbpSafeZ', 3);
  await assertReset(page, 'sbpHomeZ', 3.1);
  assert.equal(await input(page, 'sbpSafeZ').inputValue(), '3');
  await assertReset(page, 'sbpSafeZ', 1.6);
  assert.equal(await input(page, 'sbpHomeZ').inputValue(), '3.1', 'Safe reset preserves Home Z');
  await assertReset(page, 'sbpHomeZ', 2.1);

  await setRange(page, 'sbpSafeZ', 0.5);
  await setRange(page, 'sbpHomeZ', 1);
  await assertReset(page, 'sbpSafeZ', 0.9);
  await assertDefault(page, 'sbpSafeZ', 1.6);
  assert.equal(await input(page, 'sbpHomeZ').inputValue(), '1', 'constrained Safe reset preserves Home Z');
  await reset(page, 'sbpSafeZ').dispatchEvent('click');
  assert.equal(await input(page, 'sbpSafeZ').inputValue(), '0.9');
  await page.locator('#btnResetCamera').click();
  assert.equal(await reset(page, 'sbpSafeZ').getAttribute('hidden'), '', 'constrained Safe reset stays hidden after rebuilding');
  await setRange(page, 'sbpHomeZ', 4);
  await assertReset(page, 'sbpSafeZ', 1.6);
  assert.equal(await input(page, 'sbpHomeZ').inputValue(), '4', 'Safe reset never lowers manually raised Home Z');
  await assertReset(page, 'sbpHomeZ', 2.1);
  await setRange(page, 'baseThickness', 0.75);
  await assertReset(page, 'sbpHomeZ', 1.4);
  assert.equal(await input(page, 'sbpSafeZ').inputValue(), '0.9');
  await setRange(page, 'sbpHomeZ', 6);
  await setRange(page, 'sbpSafeZ', 5.9);
  assert.equal(await input(page, 'sbpHomeZ').inputValue(), '6');
  assert.equal(await reset(page, 'sbpHomeZ').getAttribute('hidden'), '', 'Home Z already at the only legal value hides Reset');
  await assertReset(page, 'sbpSafeZ', 0.9);
  assert.equal(await input(page, 'sbpHomeZ').inputValue(), '6', 'Safe reset preserves the raised upper-limit Home Z');
  await assertReset(page, 'sbpHomeZ', 1.4);
}

async function reachableBox(page, selector) {
  const element = page.locator(selector);
  // Scroll vertically ourselves, preserving the horizontal clipping position under test.
  await element.evaluate(el => {
    window.scrollTo(0, 0);
    const sidebar = document.getElementById('sidebar');
    const box = el.getBoundingClientRect(), clip = sidebar.getBoundingClientRect();
    sidebar.scrollTop += box.top - clip.top - 8;
    sidebar.scrollLeft = 0;
  });
  const result = await element.evaluate(el => {
    const sidebar = document.getElementById('sidebar');
    const box = el.getBoundingClientRect(), clip = sidebar.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      left: box.left, right: box.right, top: box.top, bottom: box.bottom, x, y,
      clipLeft: clip.left, clipRight: clip.left + sidebar.clientWidth,
      clipTop: clip.top, clipBottom: clip.top + sidebar.clientHeight,
      hit: hit === el || el.contains(hit), scrollLeft: sidebar.scrollLeft,
    };
  });
  assert(result.left >= result.clipLeft && result.right <= result.clipRight, `${selector} stays inside horizontal clipping: ${JSON.stringify(result)}`);
  assert(result.top >= result.clipTop && result.bottom <= result.clipBottom, `${selector} stays inside vertical clipping: ${JSON.stringify(result)}`);
  assert.equal(result.scrollLeft, 0, 'checking a control never scrolls the sidebar horizontally');
  assert(result.hit, `${selector} receives the pointer at its visible center: ${JSON.stringify(result)}`);
  return result;
}

async function pointerClick(page, selector) {
  const box = await reachableBox(page, selector);
  await page.mouse.click(box.x, box.y);
}

/** Test pointer hit targets before clicking, so Playwright cannot hide horizontal clipping. */
export async function verifyDimensionResetLayout(page) {
  const toggle = page.locator('#mesh-dimensions-section-body-toggle');
  if (!(await input(page, 'meshX').isVisible())) await toggle.click();
  await setRange(page, 'meshX', 20);
  await setRange(page, 'meshY', 18);
  for (const key of ['meshX', 'meshY']) {
    await reachableBox(page, `#val_${key}`);
    await reachableBox(page, `#reset_sl_${key}`);
  }
  await pointerClick(page, '#reset_sl_meshX');
  assert.equal(await input(page, 'meshX').inputValue(), '36');
  assert.equal(await input(page, 'meshY').inputValue(), '18');
  await pointerClick(page, '#reset_sl_meshY');
  assert.equal(await input(page, 'meshY').inputValue(), '24');

  // Image fitting produces exact fractional dimensions through the real upload/lock path.
  await page.locator('.mode-tab[data-mode="depthmap"]').click();
  await page.locator('#depthMapInput').setInputFiles({
    name: 'fractional-dimensions.svg', mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="173" height="127"><rect width="173" height="127" fill="white"/></svg>'),
  });
  await page.waitForFunction(() => document.getElementById('btnAspectLock').classList.contains('locked'));
  await setRange(page, 'meshX', 17.25);
  await assertSerializedRange(page, 'meshX', 36);
  await assertSerializedRange(page, 'meshY', 24);
  await input(page, 'meshY').evaluate(control => { const value = control.value; control.step = control.dataset.step; control.value = value; });
  await assert.rejects(() => assertSerializedRange(page, 'meshY', 24), /native thumb stays within its floating-point serialization bound/);
  await page.locator('#btnResetCamera').click();
  await assertSerializedRange(page, 'meshY', 24);
  if (!(await input(page, 'meshX').isVisible())) await toggle.click();
  await page.locator('#btnAspectLock').click();
  await setRange(page, 'meshY', 11.125);
  for (const [key, expected] of [['meshX', 17.25], ['meshY', 11.125]]) {
    assert.equal(Number(await input(page, key).inputValue()), expected);
    await reachableBox(page, `#reset_sl_${key}`);
    await pointerClick(page, `#val_${key}`);
    await reachableBox(page, `#val_${key} .val-edit`);
    await page.locator(`#val_${key} .val-edit`).press('Escape');
  }
  await pointerClick(page, '#reset_sl_meshX');
  assert.equal(await input(page, 'meshX').inputValue(), '36');
  await pointerClick(page, '#reset_sl_meshY');
  assert.equal(await input(page, 'meshY').inputValue(), '24');
}

/** Generated Drape percentages retain their exact defaults through every control path. */
export async function verifyOffStepDrapeDefaults(page) {
  await page.locator('.mode-tab[data-mode="drape"]').click();
  const waitForDrape = () => page.waitForFunction(() => document.getElementById('drapeStatus').textContent.includes('Bare figure'), null, { timeout: 60000 });
  await waitForDrape();
  const expected = { drapeFaceX: 47.62, drapeWindX: 59.52, drapeWindY: 20.18, drapeWindRadius: 7.14 };
  const offStep = await page.locator('input[type="range"][data-key^="drape"]').evaluateAll(controls => controls.filter(control => {
    const steps = (Number(control.dataset.default) - Number(control.min)) / Number(control.dataset.step);
    return Math.abs(steps - Math.round(steps)) > 1e-8;
  }).map(control => control.dataset.key));
  assert.deepEqual(offStep.sort(), Object.keys(expected).sort(), 'every off-step Drape default is covered');
  const openControl = async key => {
    const id = await input(page, key).evaluate(control => control.closest('.section').querySelector('.section-header').id);
    const toggle = page.locator(`#${id}`);
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  };
  const snapshot = async key => {
    const control = input(page, key);
    return { value: Number(await control.inputValue()), label: Number(await page.locator(`#val_${key}`).textContent()), defaultValue: Number(await control.getAttribute('data-default')) };
  };
  const unchangedEdit = async key => {
    await page.locator(`#val_${key}`).click();
    await page.locator(`#val_${key} .val-edit`).press('Enter');
  };
  const copyConfig = () => copiedConfiguration(page);
  for (const [key, defaultValue] of Object.entries(expected)) {
    await openControl(key);
    assert.deepEqual(await snapshot(key), { value: defaultValue, label: defaultValue, defaultValue }, `${key} initially agrees across value, label and default`);
    assert.equal(await reset(page, key).getAttribute('hidden'), '');
    await input(page, key).evaluate(control => { const value = control.value; control.step = control.dataset.step; control.value = value; });
    await assert.rejects(() => assertSerializedRange(page, key, defaultValue), /native thumb stays within its floating-point serialization bound/);
    await page.locator('#btnResetCamera').click();
    await openControl(key);
    await assertSerializedRange(page, key, defaultValue);
    await unchangedEdit(key);
    assert.deepEqual(await snapshot(key), { value: defaultValue, label: defaultValue, defaultValue });
    const nominal = Number(await input(page, key).getAttribute('data-step'));
    await input(page, key).press('ArrowUp');
    const moved = Number((defaultValue + nominal).toFixed(6));
    assert.deepEqual(await snapshot(key), { value: moved, label: moved, defaultValue }, `${key} keeps its nominal keyboard increment`);
    const copied = await copyConfig();
    assert.equal(copied.config[key], moved, `${key} actual serialized state equals the displayed edit`);
    await page.goto(copied.link);
    await waitForDrape();
    await openControl(key);
    assert.deepEqual(await snapshot(key), { value: moved, label: moved, defaultValue }, `${key} share-link round-trip keeps the exact edit`);
    await unchangedEdit(key);
    assert.deepEqual(await snapshot(key), { value: moved, label: moved, defaultValue });
    await input(page, key).press('ArrowDown');
    assert.deepEqual(await snapshot(key), { value: defaultValue, label: defaultValue, defaultValue });
    const typed = Number((defaultValue + nominal / 2).toFixed(6));
    await page.locator(`#val_${key}`).click();
    await page.locator(`#val_${key} .val-edit`).fill(String(typed));
    await page.locator(`#val_${key} .val-edit`).press('Enter');
    assert.deepEqual(await snapshot(key), { value: typed, label: typed, defaultValue }, `${key} preserves an explicit exact numeric edit`);
    assert.equal((await copyConfig()).config[key], typed);
    await assertReset(page, key, defaultValue);
    assert.equal((await copyConfig()).config[key] ?? defaultValue, defaultValue, `${key} reset restores the exact serialized default`);
  }
}


/** Asynchronous masters and physical bound changes retain state/input/label coherence. */
export async function verifyProgrammaticRangeSync(page) {
  const exactDepth = 0.33333333333333337;
  await page.locator('#val_amplitude').click();
  await page.locator('#val_amplitude .val-edit').fill(String(exactDepth));
  await page.locator('#val_amplitude .val-edit').press('Enter');
  assert.equal(await assertSerializedRange(page, 'amplitude', 0.5), exactDepth);
  const exactLink = (await copiedConfiguration(page)).link;
  await page.goto(exactLink);
  await page.waitForSelector('#selPreset');
  assert.equal(await assertSerializedRange(page, 'amplitude', 0.5), exactDepth);
  await page.locator('.mode-tab[data-mode="drape"]').click();
  await page.waitForFunction(() => document.getElementById('drapeStatus').textContent.includes('Bare figure'), null, { timeout: 60000 });
  await setRange(page, 'meshX', 9.75);
  await page.waitForFunction(() => document.getElementById('dimsOverlay').textContent.startsWith('9.75" x 13"'));
  await assertSerializedRange(page, 'meshX', 36);
  await assertSerializedRange(page, 'meshY', 24);
  await page.locator('#val_baseThickness').click();
  await page.locator('#val_baseThickness .val-edit').fill('1.2625');
  await page.locator('#val_baseThickness .val-edit').press('Enter');
  await page.waitForFunction(() => document.getElementById('sl_sbpSafeZ').value === '1.4');
  await assertSerializedRange(page, 'baseThickness', 0.75);
  await input(page, 'baseThickness').evaluate(control => { const value = control.value; control.step = control.dataset.step; control.value = value; });
  await assert.rejects(() => assertSerializedRange(page, 'baseThickness', 0.75), /native thumb stays within its floating-point serialization bound/);
  await page.locator('#btnResetCamera').click();
  await assertSerializedRange(page, 'baseThickness', 0.75);
  await setRange(page, 'baseThickness', 0.25);
  await page.waitForFunction(() => document.getElementById('sl_sbpSafeZ').value === '0.5');
  await assertSerializedRange(page, 'drapeReliefDepth', 0.625);
  assert.equal(await input(page, 'drapeReliefDepth').inputValue(), '0.1875');
  await input(page, 'drapeReliefDepth').evaluate(control => { const value = control.value; control.step = control.dataset.step; control.value = value; });
  await assert.rejects(() => assertSerializedRange(page, 'drapeReliefDepth', 0.625), /native thumb stays within its floating-point serialization bound/);
  await page.locator('#btnResetCamera').click();
  await assertSerializedRange(page, 'drapeReliefDepth', 0.625);
  await input(page, 'drapeReliefDepth').press('End');
  assert.equal(await input(page, 'drapeReliefDepth').inputValue(), '0.1875');
  assert.equal(0.25 - Number(await input(page, 'drapeReliefDepth').inputValue()), 1 / 16);
}


/** Locked authored sources remain readable even below ordinary slider minimums. */
export async function verifySmallMasterRanges(page) {
  const heights = Buffer.alloc(9 * 8);
  for (let index = 0; index < 9; index++) heights.writeDoubleLE(index === 4 ? 0.0625 : 0.125, index * 8);
  const header = Buffer.from(JSON.stringify({
    format: 'meshcraft-relief', version: 1, units: 'in', cols: 3, rows: 3,
    width: 0.5, height: 0.75, stock: 0.125, backing: 0.0625, dtype: 'float64',
    rowOrder: 'top-down', heightOrigin: 'panel-back', triangulation: 'tr-bl', mask: false,
    sha256: { heights: createHash('sha256').update(heights).digest('hex') },
  }));
  const start = Math.ceil((12 + header.length) / 8) * 8;
  const buffer = Buffer.alloc(start + heights.length);
  buffer.write('MCRELIEF'); buffer.writeUInt32LE(header.length, 8); header.copy(buffer, 12); heights.copy(buffer, start);
  await page.locator('#depthMapInput').setInputFiles({ name: 'small-authored.mcrelief', mimeType: 'application/octet-stream', buffer });
  await page.waitForFunction(() => document.body.classList.contains('mode-depthmap') && document.getElementById('sl_meshX').disabled);
  for (const [key, expected] of [['meshX', 0.5], ['meshY', 0.75], ['baseThickness', 0.125]]) {
    assert.equal(await assertSerializedRange(page, key, expected), expected);
    assert.equal(await input(page, key).isDisabled(), true);
    assert.equal(await reset(page, key).getAttribute('hidden'), '', `${key} locked source has no reset action`);
  }
  assert.equal(await assertSerializedRange(page, 'resolution', 400), 3);
  await page.locator('#btnResetCamera').click();
  for (const [key, expected] of [['meshX', 0.5], ['meshY', 0.75], ['baseThickness', 0.125]]) await assertSerializedRange(page, key, expected);
}

/** Counts normalize before callbacks; preferred whole-unit increments do not quantize physical values. */
export async function verifyCountDomains(page) {
  const edit = async (key, value) => {
    const control = input(page, key);
    const section = control.locator('xpath=ancestor::*[contains(@class,"section-body")]');
    if (await section.count() && !(await control.isVisible())) await page.locator(`#${await section.getAttribute('id')}-toggle`).click();
    await page.locator(`#val_${key}`).click();
    await page.locator(`#val_${key} .val-edit`).fill(String(value));
    await page.locator(`#val_${key} .val-edit`).press('Enter');
  };
  await edit('resolution', 20.5);
  await page.waitForTimeout(400);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#btnExport').click();
  const download = await downloadPromise;
  assert.equal(await download.failure(), null);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const stl = Buffer.concat(chunks);
  assert.equal(stl.length, 84 + stl.readUInt32LE(80) * 50, 'fractional resolution edit exports complete binary triangles');
  for (let triangle = 84; triangle < stl.length; triangle += 50) {
    for (let offset = 0; offset < 48; offset += 4) assert(Number.isFinite(stl.readFloatLE(triangle + offset)), 'exported coordinates and normals remain finite');
  }
  assert.equal(await assertSerializedRange(page, 'resolution', 400), 20);
  for (const [key, value, expected] of [['octaves', 2.9, 2]]) {
    await edit(key, value);
    assert.equal(await assertSerializedRange(page, key, Number(await input(page, key).getAttribute('data-default'))), expected);
  }
  const noiseRadius = 0.12345678912345678, depthRadius = 0.23456789123456789;
  await edit('smoothRadiusIn', noiseRadius);
  assert.equal(await assertSerializedRange(page, 'smoothRadiusIn', 0), noiseRadius);
  await page.locator('#val_smoothRadiusIn').click(); await page.locator('#val_smoothRadiusIn .val-edit').press('Enter');
  assert.equal(await assertSerializedRange(page, 'smoothRadiusIn', 0), noiseRadius);
  const noiseLink = (await copiedConfiguration(page)).link; await page.goto(noiseLink); await page.waitForSelector('#selPreset');
  assert.equal(await assertSerializedRange(page, 'smoothRadiusIn', 0), noiseRadius);
  // Dimension and camera increments of one are preferred navigation steps, not count domains.
  for (const [key, value] of [['meshX', 17.25], ['orbit', 31.125]]) {
    await edit(key, value);
    if (key === 'orbit') {
      assert.equal(Number(await input(page, key).getAttribute('data-value')), value);
      assert.equal(Number(await page.locator(`#val_${key}`).textContent()), value);
    } else assert.equal(await assertSerializedRange(page, key, Number(await input(page, key).getAttribute('data-default'))), value);
  }
  await page.selectOption('#selNoiseType', 'voronoi-relief');
  for (const [key, value, expected] of [['reliefRelaxIterations', 1.9, 1], ['reliefRadialFociCount', 2.9, 2], ['reliefInvertProfile', 0.9, 0]]) {
    await edit(key, value);
    assert.equal(await assertSerializedRange(page, key, Number(await input(page, key).getAttribute('data-default'))), expected);
  }
  await page.locator('.mode-tab[data-mode="depthmap"]').click();
  await edit('dmSmoothRadiusIn', depthRadius);
  assert.equal(await assertSerializedRange(page, 'dmSmoothRadiusIn', 0), depthRadius);
  await page.locator('#val_dmSmoothRadiusIn').click(); await page.locator('#val_dmSmoothRadiusIn .val-edit').press('Enter');
  assert.equal(await assertSerializedRange(page, 'dmSmoothRadiusIn', 0), depthRadius);
  await edit('dmSmoothRadiusIn', 2); assert.equal(await assertSerializedRange(page, 'dmSmoothRadiusIn', 0), 1);
  await edit('dmSmoothRadiusIn', -1); assert.equal(await assertSerializedRange(page, 'dmSmoothRadiusIn', 0), 0);
  await edit('dmSmoothRadiusIn', depthRadius);
  await page.locator('.mode-tab[data-mode="drape"]').click();
  await page.waitForFunction(() => document.getElementById('drapeStatus').textContent.includes('Bare figure'), null, { timeout: 60000 });
  const drapeCounts = ['drapeFrames', 'drapeAttractStart', 'drapeAttractFull', 'drapeFaceStart', 'drapeFaceFull', 'drapeWindStart', 'drapeWindFull', 'drapeSubsteps', 'drapeIterations', 'drapeSubdivisions', 'drapeClothRes'];
  for (const key of drapeCounts) {
    const min = Number(await input(page, key).getAttribute('min'));
    const expected = key === 'drapeClothRes' ? min + 2 : min + 1;
    await edit(key, key === 'drapeClothRes' ? min + 1.5 : min + 1.9);
    assert.equal(await assertSerializedRange(page, key, Number(await input(page, key).getAttribute('data-default'))), expected);
    // Programmatic native input uses the same semantic policy as numeric editing.
    await input(page, key).evaluate((control, value) => { control.step = 'any'; control.value = String(value); control.dispatchEvent(new Event('input', { bubbles: true })); }, expected + 0.25);
    assert.equal(await assertSerializedRange(page, key, Number(await input(page, key).getAttribute('data-default'))), expected);
  }
  const { link, config } = await copiedConfiguration(page);
  await page.goto(link);
  await page.waitForFunction(() => document.getElementById('drapeStatus').textContent.includes('Bare figure'), null, { timeout: 60000 });
  for (const key of drapeCounts) assert.equal(await assertSerializedRange(page, key, Number(await input(page, key).getAttribute('data-default'))), config[key] ?? Number(await input(page, key).getAttribute('data-default')));
  // Untrusted fractional payloads normalize through the same policy as actual controls.
  const crafted = { ...config, resolution: 20.5, octaves: 2.9, smoothRadiusIn: noiseRadius, dmSmoothRadiusIn: depthRadius,
    reliefRelaxIterations: 1.9, reliefRadialFociCount: 2.9, reliefInvertProfile: 0.9 };
  const expectedCounts = {};
  for (const key of drapeCounts) {
    const value = Number(await input(page, key).getAttribute('data-value'));
    crafted[key] = value + 0.25;
    expectedCounts[key] = value;
  }
  const url = new URL(link);
  url.searchParams.set('c', Buffer.from(JSON.stringify(crafted)).toString('base64url'));
  await page.goto(url.href);
  await page.waitForFunction(() => document.getElementById('drapeStatus').textContent.includes('Bare figure'), null, { timeout: 60000 });
  const actual = (await copiedConfiguration(page)).config;
  for (const [key, expected] of Object.entries({ resolution: 20, octaves: 2, smoothRadiusIn: noiseRadius, dmSmoothRadiusIn: depthRadius,
    reliefRelaxIterations: 1, reliefRadialFociCount: 2, reliefInvertProfile: 0, ...expectedCounts })) {
    const fallback = await input(page, key).count() ? Number(await input(page, key).getAttribute('data-default')) : { octaves: 2, reliefRelaxIterations: 1, reliefRadialFociCount: 0, reliefInvertProfile: 0 }[key];
    assert.equal(actual[key] ?? fallback, expected, `${key} crafted link follows the same count policy`);
  }
}

/** Imported data locks and live remap controls have different ownership across every rebuild. */
export async function verifySourceOwnership(page) {
  const assertEditable = async () => {
    for (const key of ['meshX', 'meshY', 'baseThickness']) assert.equal(await input(page, key).isEnabled(), true, `${key} live source stays editable after rebuild`);
  };
  const edit = async (key, value) => {
    await assertEditable();
    await page.locator(`#val_${key}`).click();
    await page.locator(`#val_${key} .val-edit`).fill(String(value));
    await page.locator(`#val_${key} .val-edit`).press('Enter');
  };
  await page.locator('.mode-tab[data-mode="drape"]').click();
  const bare = () => page.waitForFunction(() => document.getElementById('drapeStatus').textContent.includes('Bare figure'), null, { timeout: 60000 });
  await bare();
  await assertEditable();
  await page.locator('#btnResetCamera').click();
  await assertEditable();
  await edit('meshX', 9.75);
  await page.waitForFunction(() => document.getElementById('dimsOverlay').textContent.startsWith('9.75" x 13"'));
  await edit('meshY', 12);
  await page.waitForFunction(() => document.getElementById('dimsOverlay').textContent.startsWith('9" x 12"'));
  await input(page, 'meshY').press('ArrowUp');
  await page.waitForFunction(() => document.getElementById('dimsOverlay').textContent.startsWith('9.75" x 13"'));
  await edit('baseThickness', 1.2625);
  await page.waitForFunction(() => Math.abs(Number(document.getElementById('sl_sbpSafeZ').value) - 1.4) < 1e-12);
  for (const preset of ['silk', 'quartering', 'gathered']) {
    await page.locator(`#drapePreset_${preset}`).click();
    await bare();
    await assertEditable();
  }
  await edit('meshX', 9.75);
  await page.waitForFunction(() => document.getElementById('dimsOverlay').textContent.startsWith('9.75" x 13"'));
  await page.locator('.mode-tab[data-mode="noise"]').click();
  await assertEditable();
  await page.locator('.mode-tab[data-mode="drape"]').click();
  await bare();
  await assertEditable();
  await edit('baseThickness', 1.5);
  await page.waitForFunction(() => Number(document.getElementById('sl_sbpSafeZ').value) === 1.6);
  const pending = page.waitForEvent('download');
  await page.locator('#drapeDownloadBtn').click();
  const download = await pending;
  assert.equal(await download.failure(), null);
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  const header = JSON.parse(buffer.subarray(12, 12 + buffer.readUInt32LE(8)).toString());
  for (const [key, expected] of [['width', 9.75], ['height', 13], ['stock', 1.5]]) assert(Math.abs(header[key] / 0.0254 - expected) < 1e-12, `downloaded master preserves edited ${key}`);
  await verifySmallMasterRanges(page);
  await page.locator('.mode-tab[data-mode="noise"]').click();
  await assertEditable();
  await page.locator('.mode-tab[data-mode="depthmap"]').click();
  for (const key of ['meshX', 'meshY', 'baseThickness']) assert.equal(await input(page, key).isDisabled(), true, `${key} imported source stays locked after mode round trip`);
  await page.locator('.mode-tab[data-mode="drape"]').click();
  await bare();
  await assertEditable();
}

/** Every malformed numeric link initializes safely; exact finite numbers retain precision. */
export async function verifyNumericLinks(page) {
  await page.locator('.mode-tab[data-mode="noise"]').click();
  await page.locator('#val_frequency').click(); await page.locator('#val_frequency .val-edit').fill('0.2'); await page.locator('#val_frequency .val-edit').press('Enter');
  const version = (await copiedConfiguration(page)).config._v; assert(Number.isInteger(version));
  const origin = new URL(page.url()).origin;
  for (const value of ['0.2', '', null, true, {}, [0.2]]) {
    const url = new URL(origin);
    url.searchParams.set('c', Buffer.from(JSON.stringify({ _v: version, resolution: 16, frequency: value })).toString('base64url'));
    await page.goto(url.href);
    await page.waitForSelector('#selPreset');
    assert.equal(await assertSerializedRange(page, 'frequency', 0.1), 0.1);
  }
  const url = new URL(origin);
  url.searchParams.set('c', Buffer.from(`{"_v":${version},"resolution":16,"frequency":1e400}`).toString('base64url'));
  await page.goto(url.href);
  await page.waitForSelector('#selPreset');
  assert.equal(await assertSerializedRange(page, 'frequency', 0.1), 0.1);
  const exact = 0.12345678912345678;
  url.searchParams.set('c', Buffer.from(JSON.stringify({ _v: version, resolution: 16, frequency: exact })).toString('base64url'));
  await page.goto(url.href);
  await page.waitForSelector('#selPreset');
  assert.equal(await assertSerializedRange(page, 'frequency', 0.1), exact);
}

/** Continuous clearance edits reach both the real worker configuration and emitted motion text. */
export async function verifyExactClearances(page) {
  await page.locator('.format-btn[data-fmt="sbp"]').click();
  const edit = async (key, value) => {
    await page.locator(`#val_${key}`).click();
    await page.locator(`#val_${key} .val-edit`).fill(String(value));
    await page.locator(`#val_${key} .val-edit`).press('Enter');
  };
  const coherent = async (key, expected) => {
    assert.equal(Number(await input(page, key).getAttribute('data-value')), expected, `${key} model retains the continuous request`);
    assert.equal(Number(await input(page, key).inputValue()), expected, `${key} native value matches model`);
    assert.equal(Number(await page.locator(`#val_${key}`).textContent()), expected, `${key} label matches model`);
  };
  await edit('sbpSafeZ', 1.1); await edit('sbpHomeZ', 2.1);
  await coherent('sbpSafeZ', 1.1); await coherent('sbpHomeZ', 2.1);
  process.stdout.write('PASS nominal clearance baseline\n');
  await edit('sbpSafeZ', 0.5); await edit('sbpHomeZ', 1.4); await edit('sbpSafeZ', 1.3);
  await coherent('sbpSafeZ', 1.3);
  assert.equal(Number(await input(page, 'sbpSafeZ').getAttribute('max')), 1.3);
  await input(page, 'sbpSafeZ').press('End'); await coherent('sbpSafeZ', 1.3);
  await reset(page, 'sbpHomeZ').dispatchEvent('click'); await coherent('sbpHomeZ', 1.4);
  assert.equal(await reset(page, 'sbpHomeZ').getAttribute('hidden'), '');
  await edit('sbpHomeZ', 2.123456789123456);
  assert.equal(Number(await input(page, 'sbpSafeZ').getAttribute('max')), 2.123456789123456 - 0.1, 'high-precision gap endpoints retain their digits');
  await edit('sbpSafeZ', 1.1); await edit('sbpHomeZ', 2.1);

  for (const [key, value] of [['sbpSafeZ', 1.125], ['sbpHomeZ', 2.125]]) {
    await edit(key, value); await coherent(key, value);
    await page.locator(`#val_${key}`).click();
    await page.locator(`#val_${key} .val-edit`).press('Enter');
    await coherent(key, value);
    await input(page, key).press('ArrowUp'); await coherent(key, value + 0.1);
    await input(page, key).press('ArrowDown'); await coherent(key, value);
  }
  assert.equal(Number(await input(page, 'sbpSafeZ').getAttribute('max')), 2.125 - 0.1);
  assert.equal(Number(await input(page, 'sbpHomeZ').getAttribute('min')), 1.125 + 0.1);
  await edit('sbpSafeZ', 1.325);
  await reset(page, 'sbpHomeZ').click();
  await coherent('sbpHomeZ', 1.325 + 0.1);
  await coherent('sbpSafeZ', 1.325);
  assert.equal(await reset(page, 'sbpHomeZ').getAttribute('hidden'), '');
  await edit('baseThickness', 1.5);
  await edit('sbpSafeZ', 0.5); await edit('sbpHomeZ', 1.225);
  await reset(page, 'sbpSafeZ').click();
  await coherent('sbpSafeZ', 1.225 - 0.1);
  await coherent('sbpHomeZ', 1.225);
  assert.equal(await reset(page, 'sbpSafeZ').getAttribute('hidden'), '');

  // A real small authored surface keeps the export fast while exercising the production worker/writer.
  const heights = Buffer.alloc(9 * 8);
  for (let index = 0; index < 9; index++) heights.writeDoubleLE(index === 4 ? 0.5 : 0.75, index * 8);
  const header = Buffer.from(JSON.stringify({ format: 'meshcraft-relief', version: 1, units: 'in', cols: 3, rows: 3,
    width: 1, height: 1, stock: 0.75, backing: 0.5, dtype: 'float64', rowOrder: 'top-down',
    heightOrigin: 'panel-back', triangulation: 'tr-bl', mask: false, sha256: { heights: createHash('sha256').update(heights).digest('hex') } }));
  const start = Math.ceil((12 + header.length) / 8) * 8, buffer = Buffer.alloc(start + heights.length);
  buffer.write('MCRELIEF'); buffer.writeUInt32LE(header.length, 8); header.copy(buffer, 12); heights.copy(buffer, start);
  await page.locator('#depthMapInput').setInputFiles({ name: 'clearance-proof.mcrelief', mimeType: 'application/octet-stream', buffer });
  await page.waitForFunction(() => document.body.classList.contains('mode-depthmap') && document.getElementById('sl_meshX').disabled);
  await edit('sbpHomeZ', 2.125); await edit('sbpSafeZ', 1.125);
  // Observe the actual message while forwarding it unchanged. Downloaded JZ/J3 lines prove emission.
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args) {
      if (args[0]?.config) document.documentElement.dataset.testSbpConfig = JSON.stringify(args[0].config);
      return post.apply(this, args);
    };
  });
  const pending = page.waitForEvent('download', { timeout: 60000 });
  await page.locator('#btnExport').click();
  const download = await pending;
  assert.equal(await download.failure(), null);
  const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const sbp = Buffer.concat(chunks).toString();
  const config = JSON.parse(await page.evaluate(() => document.documentElement.dataset.testSbpConfig));
  assert.equal(config.safeZ, 1.125); assert.equal(config.homeZ, 2.125);
  assert.match(sbp, /^J3,[-\d.]+,[-\d.]+,1\.125000$/m);
  assert.match(sbp, /^J3,0\.000000,0\.000000,2\.125000$/m);
  await coherent('sbpSafeZ', 1.125); await coherent('sbpHomeZ', 2.125);
}

/** Stock synchronization commits a legal model pair before either native range is updated. */
export async function verifyStockClearanceCoherence(page) {
  await page.locator('.format-btn[data-fmt="sbp"]').click();
  const edit = async (key, value) => { await page.locator(`#val_${key}`).click(); await page.locator(`#val_${key} .val-edit`).fill(String(value)); await page.locator(`#val_${key} .val-edit`).press('Enter'); };
  const coherent = async (safe, home) => {
    for (const [key, expected] of [['sbpSafeZ', safe], ['sbpHomeZ', home]]) {
      assert.equal(Number(await input(page, key).getAttribute('data-value')), expected, `${key} stock change retains coherent model`);
      const native = Number(await input(page, key).inputValue());
      assert(Math.abs(native - expected) <= 32 * Number.EPSILON * Math.max(1, Math.abs(expected)), `${key} native serialization bound`);
      assert.equal(Number(await page.locator(`#val_${key}`).textContent()), expected);
    }
  };
  await edit('resolution', 16); await edit('meshX', 1); await edit('meshY', 1);
  await edit('sbpHomeZ', 1.45); await edit('baseThickness', 1.25);
  await coherent(1.4, 1.9);
  await page.locator('#btnResetCamera').click(); await coherent(1.4, 1.9);
  await edit('sbpHomeZ', 2.125); await edit('baseThickness', 1.5); await coherent(1.6, 2.125);
  await edit('baseThickness', 1.25); await coherent(1.4, 2.125);
  await reset(page, 'sbpHomeZ').click(); await coherent(1.4, 1.9);
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args) { if (args[0]?.config) document.documentElement.dataset.testStockConfig = JSON.stringify(args[0].config); return post.apply(this, args); };
  });
  const exportCoherent = async (safe = 1.4, home = 1.9) => {
    await page.locator('#btnRegenerate').click();
    const pending = page.waitForEvent('download', { timeout: 60000 }); await page.locator('#btnExport').click();
    const download = await pending; assert.equal(await download.failure(), null);
    const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    const config = JSON.parse(await page.evaluate(() => document.documentElement.dataset.testStockConfig));
    assert.equal(config.materialZ, 1.25); assert.equal(config.safeZ, safe); assert.equal(config.homeZ, home);
    const lines = text.split('\n');
    assert(lines.some(line => line.startsWith('J3,') && Number(line.split(',')[3]) === Number(safe.toFixed(6))));
    assert(lines.includes(`J3,0.000000,0.000000,${home.toFixed(6)}`));
    await coherent(config.safeZ, config.homeZ);
  };
  await exportCoherent();
  const exactHome = 3.029970299702997, exactSafe = exactHome - 0.1;
  await edit('sbpHomeZ', exactHome); await input(page, 'sbpSafeZ').press('End');
  await coherent(exactSafe, exactHome); await exportCoherent(exactSafe, exactHome);
  await edit('baseThickness', 0.75); await edit('sbpHomeZ', 1.45);
  const heights = Buffer.alloc(9 * 8); for (let n = 0; n < 9; n++) heights.writeDoubleLE(n === 4 ? 0.5 : 1.25, n * 8);
  const header = Buffer.from(JSON.stringify({ format: 'meshcraft-relief', version: 1, units: 'in', cols: 3, rows: 3, width: 1, height: 1, stock: 1.25, backing: 0.5,
    dtype: 'float64', rowOrder: 'top-down', heightOrigin: 'panel-back', triangulation: 'tr-bl', mask: false, sha256: { heights: createHash('sha256').update(heights).digest('hex') } }));
  const start = Math.ceil((12 + header.length) / 8) * 8, buffer = Buffer.alloc(start + heights.length);
  buffer.write('MCRELIEF'); buffer.writeUInt32LE(header.length, 8); header.copy(buffer, 12); heights.copy(buffer, start);
  await page.locator('#depthMapInput').setInputFiles({ name: 'stock-gap.mcrelief', mimeType: 'application/octet-stream', buffer });
  await page.waitForFunction(() => document.body.classList.contains('mode-depthmap') && document.getElementById('sl_meshX').disabled);
  await coherent(1.4, 1.9); await exportCoherent();
}

/** Native range serialization must not conceal an exact one-ULP edit from touch Reset. */
export async function verifyExactNearDefaultReset(page) {
  const value = 0.5000000000000001;
  await page.locator('#val_amplitude').click(); await page.locator('#val_amplitude .val-edit').fill(String(value)); await page.locator('#val_amplitude .val-edit').press('Enter');
  assert.equal(await assertSerializedRange(page, 'amplitude', 0.5), value);
  assert.equal(await reset(page, 'amplitude').isVisible(), true, 'one-ULP model difference offers touch Reset');
  await reset(page, 'amplitude').tap();
  assert.equal(await assertSerializedRange(page, 'amplitude', 0.5), 0.5);
  assert.equal(await reset(page, 'amplitude').isVisible(), false);
}

/** Drape aliases retain exact requests while the completed master remains export-authoritative. */
export async function verifyDrapeRequestDefaults(page) {
  await page.locator('.mode-tab[data-mode="drape"]').click();
  await page.waitForFunction(() => document.getElementById('drapeStatus').textContent.includes('Bare figure'), null, { timeout: 60000 });
  for (const [key, value] of [['meshX', 12], ['meshY', 16], ['baseThickness', 0.75]]) {
    assert.equal(await assertSerializedRange(page, key, value), value);
    assert.equal(await reset(page, key).getAttribute('hidden'), '', `${key} canonical request default has no Reset`);
  }
  await page.locator('#btnResetCamera').click();
  assert.equal(await reset(page, 'baseThickness').getAttribute('hidden'), '');
  const edit = async (key, value) => { await page.locator(`#val_${key}`).click(); await page.locator(`#val_${key} .val-edit`).fill(String(value)); await page.locator(`#val_${key} .val-edit`).press('Enter'); };
  await edit('baseThickness', 0.7500000000000001);
  assert.equal(await assertSerializedRange(page, 'baseThickness', 0.75), 0.7500000000000001);
  assert.equal(await reset(page, 'baseThickness').isVisible(), true);
  await reset(page, 'baseThickness').tap();
  assert.equal(await assertSerializedRange(page, 'baseThickness', 0.75), 0.75);
  assert.equal(await reset(page, 'baseThickness').isVisible(), false);
  // Hold publication of real computed digests to observe the pending request/master interval.
  await page.evaluate(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    document.documentElement.dataset.holdTestMaster = '1';
    crypto.subtle.digest = async (...args) => {
      const result = await digest(...args);
      if (document.documentElement.dataset.holdTestMaster === '1') await new Promise(resolve => document.addEventListener('release-test-master', resolve, { once: true }));
      return result;
    };
  });
  await edit('baseThickness', 1.2578125); await edit('meshX', 9.75);
  assert.equal(await assertSerializedRange(page, 'baseThickness', 0.75), 1.2578125);
  assert.equal(await assertSerializedRange(page, 'meshX', 12), 9.75);
  assert.equal(await assertSerializedRange(page, 'meshY', 16), 13);
  const blocked = page.waitForEvent('download', { timeout: 300 }).then(() => false, () => true);
  await page.locator('#drapeDownloadBtn').click(); assert.equal(await blocked, true);
  assert.match(await page.locator('#toast').textContent(), /remapped/);
  await page.evaluate(() => { document.documentElement.dataset.holdTestMaster = '0'; document.dispatchEvent(new Event('release-test-master')); });
  await page.waitForFunction(() => document.getElementById('dimsOverlay').textContent.startsWith('9.75" x 13"'));
  for (const [key, value] of [['meshX', 9.75], ['meshY', 13], ['baseThickness', 1.2578125]]) assert.equal(await assertSerializedRange(page, key, value), value);
  const pending = page.waitForEvent('download'); await page.locator('#drapeDownloadBtn').click();
  const download = await pending; const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const data = Buffer.concat(chunks), header = JSON.parse(data.subarray(12, 12 + data.readUInt32LE(8)).toString());
  for (const [key, expected] of [['width', 9.75], ['height', 13], ['stock', 1.2578125]]) assert(Math.abs(header[key] / 0.0254 - expected) < 1e-12, `${key} belongs to the completed exported master`);
  await verifySmallMasterRanges(page);
}
