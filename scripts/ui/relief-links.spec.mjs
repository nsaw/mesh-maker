import { restrictToAppOrigin } from './app-requests.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

const stateSource = await readFile(new URL('../../src/state.ts', import.meta.url), 'utf8');
const version = Number(stateSource.match(/CURRENT_PAYLOAD_VERSION = (\d+)/)?.[1]);
assert(Number.isSafeInteger(version));
function wire(count) {
  const xy = Buffer.alloc(count * 4), ids = Buffer.alloc(count * 4), pins = Buffer.alloc(count);
  for (let i = 0; i < count; i++) {
    xy.writeInt16LE((i % 40) * 80, i * 4);
    xy.writeInt16LE(Math.floor(i / 40) * 80, i * 4 + 2);
    ids.writeUInt32LE(i === count - 1 ? 0xffffffff : i * 103, i * 4);
    pins[i] = i % 2;
  }
  return {version: 1, count, coordinates: xy.toString('base64'), identities: ids.toString('base64'), pins: pins.toString('base64')};
}
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
let server, browser;
try {
  server = await preview({preview: {host: '127.0.0.1', port: 0, strictPort: true}});
  const address = server.httpServer.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
  for (const width of [390, 834, 1440]) {
    const context = await browser.newContext({viewport: {width, height: 900}, permissions: ['clipboard-read', 'clipboard-write']});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await restrictToAppOrigin(page, origin);
    const expected = wire(1000);
    await page.goto(`${origin}/#c=${encode({_v: version, noiseType: 'voronoi-relief', resolution: 16, _sites: expected})}`);
    await page.waitForSelector('#selNoiseType', {state: 'attached'});
    assert.equal(await page.locator('#selNoiseType').inputValue(), 'voronoi-relief');
    if (width <= 900) await page.click('#btnOverflow');
    await page.click('#btnCopyLink');
    await page.waitForFunction(() => document.getElementById('toast')?.textContent?.includes('0.01 in precision'));
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    const copiedUrl = new URL(copied);
    assert.equal(copiedUrl.search, '');
    const copiedPayload = JSON.parse(Buffer.from(copiedUrl.hash.slice(3), 'base64url').toString());
    assert.deepEqual(copiedPayload._sites, expected);
    assert.equal(copiedPayload.reliefRevision, undefined);
    await page.goto(copied);
    await page.reload();
    await page.waitForSelector('#selNoiseType', {state: 'attached'});
    assert.equal(await page.locator('#selNoiseType').inputValue(), 'voronoi-relief');
    if (width <= 900) await page.click('#btnOverflow');
    await page.click('#btnCopyLink');
    await page.waitForFunction(() => document.getElementById('toast')?.textContent?.includes('0.01 in precision'));
    assert.deepEqual(JSON.parse(Buffer.from(new URL(await page.evaluate(() => navigator.clipboard.readText())).hash.slice(3), 'base64url').toString())._sites, expected);
    await page.goto(`${origin}/#c=${encode({_v: version, noiseType: 'voronoi-relief', seed: 47, _sites: {...expected, pins: ''}})}`);
    await page.waitForFunction(() => document.getElementById('toast')?.textContent?.includes('cell link is invalid'));
    assert.equal(await page.locator('#selNoiseType').inputValue(), 'simplex');
    // Back and Forward must restore the whole document in both fragment directions.
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => document.getElementById('selNoiseType')?.value === 'simplex');
    await page.evaluate(url => { window.location.hash = url; }, `c=${encode({_v: version, noiseType: 'voronoi-relief', resolution: 16, _sites: wire(2)})}`);
    await page.waitForFunction(() => document.getElementById('selNoiseType')?.value === 'voronoi-relief');
    await page.goBack();
    await page.waitForFunction(() => document.getElementById('selNoiseType')?.value === 'simplex');
    assert.equal(new URL(page.url()).hash, '');
    await page.goForward();
    await page.waitForFunction(() => document.getElementById('selNoiseType')?.value === 'voronoi-relief');
    await page.goto(`${origin}/#c=${encode({_v: version + 1, noiseType: 'voronoi-relief', _sites: expected})}`);
    await page.waitForFunction(() => document.getElementById('toast')?.textContent?.includes('cell link is invalid'));
    assert.equal(await page.locator('#selNoiseType').inputValue(), 'simplex');
    assert.deepEqual(errors, []);
    await context.close();
    process.stdout.write(`PASS frozen relief Copy Link and invalid-document refusal at ${width}px\n`);
  }
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
