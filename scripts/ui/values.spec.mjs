import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { verifyDrapeRequestDefaults, verifyStockClearanceCoherence, verifyExactNearDefaultReset, verifyExactClearances, verifyCameraResets, verifyCountDomains, verifyCoupledClearances, verifyDimensionResetLayout, verifyNumericLinks, verifyOffStepDrapeDefaults, verifyProgrammaticRangeSync, verifySbpDefaults, verifySmallMasterRanges, verifySourceOwnership } from './reset-regressions.mjs';

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
  const cases = [verifyDrapeRequestDefaults, verifyStockClearanceCoherence, verifyExactNearDefaultReset, verifyExactClearances, verifyNumericLinks, verifySourceOwnership, verifyCountDomains, verifySbpDefaults, verifyCameraResets, verifyCoupledClearances, verifyOffStepDrapeDefaults, verifyProgrammaticRangeSync, verifySmallMasterRanges].map(verify => [verify, 1440, 900]);
  cases.push(...[[1440, 900], [834, 1112], [390, 664]].map(([width, height]) => [verifyDimensionResetLayout, width, height]));
  for (const [verify, width, height] of cases) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true });
    // This prerequisite retains legacy sponsor timers. Exercise controls after their dismissal.
    await context.addInitScript(() => { sessionStorage.setItem('sponsorSeen', '1'); sessionStorage.setItem('bbBannerDismissed', '1'); });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https:\/\//, route => route.abort());
    await page.goto(origin);
    await page.waitForSelector('#selPreset');
    await verify(page);
    assert.deepEqual(errors, []);
    await context.close();
    process.stdout.write(`PASS ${verify.name} ${width}x${height}\n`);
  }
  process.stdout.write('ALL OK\n');
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
