import { restrictToAppOrigin } from './app-requests.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mobilePane, toolbarAction } from './mobile-navigation.mjs';

let server, browser;
async function open(page, section) {
  const button = page.locator(`#${section}-section-body-toggle`);
  if (await button.getAttribute('aria-expanded') === 'false') await button.click();
}
async function copy(page) {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async text => { document.documentElement.dataset.generatorLink = text; },
  } }));
  await toolbarAction(page, 'btnCopyLink');
  const link = await page.evaluate(() => document.documentElement.dataset.generatorLink);
  const encoded = new URL(link).searchParams.get('c');
  return { link, config: encoded ? JSON.parse(Buffer.from(encoded, 'base64url').toString()) : {} };
}
try {
  server = await preview({preview: {host: '127.0.0.1', port: 0, strictPort: true}});
  const address = server.httpServer.address(); assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
  for (const [width,height] of [[1440,900],[834,1112],[390,664]]) {
    const context = await browser.newContext({viewport:{width,height},hasTouch:true});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await restrictToAppOrigin(page, origin);
    await page.goto(origin);
    await mobilePane(page,'generator'); await open(page,'noise-parameters');
    assert.equal(await page.locator('#selNoiseType option[value="fbm"], #selNoiseType option[value="turbulence"]').count(),0);
    assert.equal(await page.locator('#sl_noiseExp, #sl_contrast, #sl_sharpness').count(),0);
    await page.locator('#sl_invert').check();
    assert.equal((await copy(page)).config.invert,true);
    await page.locator('[data-reset-for="sl_invert"]').click();
    assert.equal(await page.locator('#sl_invert').isChecked(),false);
    for (const type of ['voronoi','worley']) {
      await page.selectOption('#selNoiseType',type);
      await open(page,'noise-parameters');
      await page.selectOption('#sl_cellMetric','manhattan');
      await page.locator('#sl_cellJitter').evaluate(element => {
        element.value = '.37'; element.dispatchEvent(new Event('input',{bubbles:true})); element.dispatchEvent(new Event('change',{bubbles:true}));
      });
      await page.locator('#sl_invert').check();
      const {link,config} = await copy(page);
      assert.equal(config.cellJitter,.37); assert.equal(config.cellMetric,'manhattan'); assert.equal(config.invert,true);
      await page.goto(link);
      await mobilePane(page,'generator'); await open(page,'noise-parameters');
      assert.equal(await page.locator('#sl_invert').isChecked(),true);
      assert.equal(await page.locator('#sl_cellMetric').inputValue(),'manhattan');
      assert.equal(Number(await page.locator('#sl_cellJitter').getAttribute('data-value')),.37);
    }
    await page.selectOption('#selNoiseType','simplex'); await open(page,'noise-parameters');
    assert.equal(await page.locator('#sl_cellJitter, #sl_cellMetric').count(),0);
    await mobilePane(page,'shape'); await open(page,'presets');
    await page.selectOption('#selPreset','hard-wave');
    await mobilePane(page,'generator'); await open(page,'peak-valley-shaping');
    assert.equal(Number(await page.locator('#sl_valleyExp').getAttribute('data-value')),.198);
    await page.locator('#val_valleyExp').click(); await page.locator('#val_valleyExp .val-edit').press('Enter');
    assert.equal(Number(await page.locator('#sl_valleyExp').getAttribute('data-value')),.198);
    assert.deepEqual(errors,[]);
    await context.close(); process.stdout.write(`PASS generator controls ${width}x${height}\n`);
  }
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve,reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
