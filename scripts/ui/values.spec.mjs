import { restrictToAppOrigin } from './app-requests.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { verifyDrapeRequestDefaults, verifyStockClearanceCoherence, verifyExactNearDefaultReset, verifyExactClearances, verifyCameraResets, verifyCountDomains, verifyCoupledClearances, verifyDimensionResetLayout, verifyNumericLinks, verifyOffStepDrapeDefaults, verifyProgrammaticRangeSync, verifySbpDefaults, verifySmallMasterRanges, verifySourceOwnership } from './reset-regressions.mjs';

// The offline policy must keep both HTTP and HTTPS app documents and chunks reachable.
for (const app of ['https://meshcraft.test', 'http://127.0.0.1:5173']) {
  let pattern, handler;
  await restrictToAppOrigin({route: async (nextPattern, nextHandler) => { pattern = nextPattern; handler = nextHandler; }}, app);
  for (const [url, expected] of [[app + '/index.html', 'continue'], [app + '/assets/app.js', 'continue'], ['https://third-party.test/image.png', 'abort'], ['http://third-party.test/image.png', 'abort']]) {
    let action = 'continue';
    if (pattern === '**/*' || pattern.test(url)) await handler({request: () => ({url: () => url}), continue: () => { action = 'continue'; }, abort: () => { action = 'abort'; }});
    assert.equal(action, expected, `application-origin routing ${app} -> ${url}`);
  }
}

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
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await restrictToAppOrigin(page, origin);
    await page.goto(origin);
    await page.waitForSelector('#selPreset', { state: 'attached' });
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
