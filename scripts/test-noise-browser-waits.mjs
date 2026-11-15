import assert from 'node:assert/strict';
import {test} from 'node:test';
import {waitForFullNoiseResult} from './noise-browser-waits.mjs';

test('full waits require an explicit fresh boundary before evaluating browser state', async () => {
  let called = false;
  const page = {waitForFunction: () => { called = true; }};
  for (const boundary of [undefined, null, -1, 0.5, NaN, Infinity])
    await assert.rejects(waitForFullNoiseResult(page, boundary), /explicit request boundary/);
  assert.equal(called, false);
});

test('historical full results and newer previews cannot satisfy the current full wait', async () => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  let visible = false;
  globalThis.window = {noiseProbe: {results: [{id: 7, params: {resolution: 400}}]}};
  globalThis.document = {getElementById: () => ({classList: {contains: () => visible}})};
  try {
    await waitForFullNoiseResult({waitForFunction: async (predicate, boundary, options) => {
      assert.equal(boundary, 7); assert.equal(options.timeout, 30_000);
      assert.equal(predicate(boundary), false, 'historical full result cannot cross the fresh boundary');
      window.noiseProbe.results.push({id: 8, params: {resolution: 120}});
      assert.equal(predicate(boundary), false, 'a fresh preview is not the full source');
      window.noiseProbe.results.push({id: 9, params: {resolution: 400}}); visible = true;
      assert.equal(predicate(boundary), false, 'busy publication must finish');
      visible = false; assert.equal(predicate(boundary), true);
    }}, 7);
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});
