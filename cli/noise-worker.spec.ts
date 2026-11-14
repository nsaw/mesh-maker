import { buildSurfaceBuffers } from '../src/render-geometry';
/** Exact extraction fixtures and request-lifecycle regressions. No browser or wall-clock sampler oracle. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DEFAULTS, STATE } from '../src/state';
import { PRESET_OWNED_KEYS } from '../src/noise/presets';
import { buildNoiseSurface, noiseSurfaceParams, NOISE_SURFACE_KEYS } from '../src/noise/surface';
import { NoiseGeneration, NOISE_CHANGED, NOISE_PENDING, type NoiseOutcome, type NoiseWorker } from '../src/noise/controller';
import { packNoiseSurface, type NoiseWorkerInput, type NoiseWorkerOutput } from '../src/noise/messages';
import { generateNoiseMesh } from '../src/mesh';
import { getExportSurface } from '../src/export-surface';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/noise-surface-baseline.json', import.meta.url), 'utf8')) as {
  source: string;
  fixtures: { name: string; settings: object; hash: string; cols: number; rows: number; truncatedFrom: number; crestClipStatus: string }[];
};
assert.equal(fixture.source, '859c97ea-inline-complete-support-exact-order');
for (const item of fixture.fixtures) {
  Object.assign(STATE, DEFAULTS, item.settings);
  const params = noiseSurfaceParams(STATE);
  assert(Object.isFrozen(params));
  const surface = buildNoiseSurface(params);
  const bytes = Buffer.from(new Float64Array(surface.vertices.flat()).buffer);
  assert.equal(createHash('sha256').update(bytes).digest('hex').replace(/(.{8})(?=.)/g, '$1-'), item.hash, `${item.name} pre-move output`);
  assert.deepEqual([surface.cols, surface.rows, surface.truncatedFrom, surface.crestClipStatus],
    [item.cols, item.rows, item.truncatedFrom, item.crestClipStatus], `${item.name} metadata`);
  generateNoiseMesh();
  assert.deepEqual(STATE.vertices, surface.vertices, `${item.name} synchronous adapter`);
}
for (const key of PRESET_OWNED_KEYS) assert(NOISE_SURFACE_KEYS.includes(key), `request owns ${key}`);
for (const key of ['seed', 'resolution', 'watertight'] as const) assert(NOISE_SURFACE_KEYS.includes(key));
Object.assign(STATE, DEFAULTS, { resolution: 8, meshX: 3, meshY: 2 });
const params = noiseSurfaceParams(STATE);
const changed = noiseSurfaceParams({ ...params, seed: params.seed + 3 });
const scalar = buildNoiseSurface(params);
class FakeWorker implements NoiseWorker {
  onmessage: NoiseWorker['onmessage'] = null;
  onerror: NoiseWorker['onerror'] = null;
  onmessageerror: NoiseWorker['onmessageerror'] = null;
  input: NoiseWorkerInput | null = null;
  terminated = false;
  postMessage(input: NoiseWorkerInput): void { this.input = input; }
  terminate(): void { this.terminated = true; }
  emit(output: NoiseWorkerOutput): void { this.onmessage?.({ data: output } as MessageEvent<NoiseWorkerOutput>); }
  succeed(): void {
    assert(this.input);
    const source = buildNoiseSurface(this.input.params);
    const renderBuffers = buildSurfaceBuffers(source.vertices, source.cols, source.rows, this.input.params.meshX, this.input.params.meshY);
    this.emit({ type: 'result', requestId: this.input.requestId, surface: packNoiseSurface({ ...source, renderBuffers }) });
  }
  fail(message: string): void { this.onerror?.({ message, preventDefault: () => undefined } as ErrorEvent); }
}
function fakeController(updated: () => Promise<boolean> = async () => false): { controller: NoiseGeneration; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  return { workers, controller: new NoiseGeneration({ createWorker: () => { const worker = new FakeWorker(); workers.push(worker); return worker; }, updated }) };
}
function success(outcome: NoiseOutcome): void { assert('surface' in outcome); }
function refused(outcome: NoiseOutcome): void { assert('reason' in outcome); }
{
  const { controller, workers } = fakeController();
  let commits = 0;
  controller.onCommit = () => { commits++; };
  controller.invalidate(params);
  assert.equal(controller.exportBlock(params), NOISE_PENDING, 'debounce interval refuses old geometry');
  const old = controller.start(params, 'full');
  const joined = controller.start(params, 'full');
  assert.equal(old, joined, 'same full request shares waiters');
  const next = controller.start(changed, 'preview');
  refused(await old);
  assert(workers[0].terminated);
  workers[0].succeed();
  assert.equal(commits, 0, 'terminated response never commits');
  workers[1].emit({ type: 'result', requestId: -1, surface: packNoiseSurface(scalar) });
  assert.equal(commits, 0, 'wrong request ID never commits');
  workers[1].succeed();
  success(await next);
  assert.equal(controller.exportBlock(changed), NOISE_PENDING, 'preview cannot export');
  const full = controller.start(changed, 'full');
  workers[2].succeed(); success(await full);
  assert.equal(controller.exportBlock(changed), null);
  const requestCount = workers.length;
  success(await controller.start(changed, 'preview'));
  assert.equal(workers.length, requestCount, 'unchanged input cannot replace an exportable full grid with a coarse grid');
  assert.equal(controller.exportBlock(params), NOISE_CHANGED);
  assert.equal(commits, 2);
}
{
  const { controller, workers } = fakeController();
  const started = controller.start(params, 'full');
  controller.cancel('Mode changed');
  refused(await started);
  assert(workers[0].terminated);
  workers[0].succeed();
  assert.equal(controller.exportBlock(params), null, 'other sources are no longer blocked');
}
{
  let resolveProbe: (value: boolean) => void = () => undefined;
  const probe = new Promise<boolean>(resolve => { resolveProbe = resolve; });
  const { controller, workers } = fakeController(() => probe);
  const messages: string[] = [];
  const busy: boolean[] = [];
  controller.onError = message => messages.push(message);
  controller.onBusy = value => busy.push(value);
  const failed = controller.start(params, 'full');
  workers[0].fail('Failed to fetch dynamically imported module');
  refused(await failed); // The deployment fetch has not resolved, but no waiter remains hung.
  assert.equal(busy.at(-1), false);
  const latest = controller.start(changed, 'full');
  workers[1].succeed(); success(await latest);
  resolveProbe(true); await probe; await Promise.resolve();
  assert.deepEqual(messages, [], 'retired asynchronous failure cannot replace the current result/message');
  assert.equal(controller.exportBlock(changed), null);
}
{
  const { controller, workers } = fakeController(async () => true);
  let message = '';
  controller.onError = value => { message = value; };
  const pending = controller.start(params, 'full');
  workers[0].fail('Worker did not start'); refused(await pending); await Promise.resolve();
  assert.match(message, /updated since this page opened/);
  assert.match(controller.exportBlock(params) ?? '', /updated/);
}
{
  const controller = new NoiseGeneration({ createWorker: () => { throw new Error('Workers blocked'); } });
  const outcome = await controller.start(params, 'full'); success(outcome);
  if ('surface' in outcome) assert.deepEqual(outcome.surface.vertices, scalar.vertices, 'inline fallback arithmetic');
  assert.equal(controller.exportBlock(params), null);
}
{
  const controller = new NoiseGeneration({ createWorker: () => { throw new Error('Workers blocked'); }, build: () => { throw new Error('Sampler failure'); } });
  refused(await controller.start(params, 'full'));
  assert.match(controller.exportBlock(params) ?? '', /Sampler failure/);
}
{
  const worker = new FakeWorker();
  const controller = new NoiseGeneration({ createWorker: () => worker, timeoutMs: 5 });
  refused(await controller.start(params, 'full'));
  assert(worker.terminated);
  assert.match(controller.exportBlock(params) ?? '', /timed out/);
}
{
  const worker = new FakeWorker();
  worker.postMessage = () => { throw new Error('Transfer failed'); };
  const controller = new NoiseGeneration({ createWorker: () => worker });
  refused(await controller.start(params, 'full'));
  assert(worker.terminated);
}
{
  const { controller, workers } = fakeController();
  const pending = controller.start(params, 'full');
  workers[0].onmessageerror?.({} as MessageEvent);
  refused(await pending);
  assert.equal(controller.displayPending, true);
  assert.equal(controller.failed, true);
  assert(workers[0].terminated);
}
{
  const { controller, workers } = fakeController();
  const pending = controller.start(params, 'full');
  const surface = packNoiseSurface(scalar);
  surface.heights = new Float64Array(1);
  workers[0].emit({ type: 'result', requestId: workers[0].input!.requestId, surface });
  refused(await pending);
  assert.match(controller.exportBlock(params) ?? '', /incomplete surface/);
}
// Invalid prepared attributes must settle the same request rather than reaching Three.js.
for (const field of ['positions', 'wire'] as const) {
  const { controller, workers } = fakeController();
  const pending = controller.start(params, 'full');
  const renderBuffers = buildSurfaceBuffers(scalar.vertices, scalar.cols, scalar.rows, params.meshX, params.meshY);
  if (field === 'positions') renderBuffers.positions = new Float32Array(1);
  else renderBuffers.wire = { positions: new Float32Array(1), colors: new Float32Array(1) };
  const surface = packNoiseSurface({ ...scalar, renderBuffers });
  assert(workers[0].input);
  workers[0].emit({ type: 'result', requestId: workers[0].input.requestId, surface });
  refused(await pending);
  assert(workers[0].terminated);
  assert.match(controller.exportBlock(params) ?? '', /incomplete/);
}
// Gesture previews have display authority only inside their original epoch. Source/export authority
// still changes on every input, and release must retire even a completed-but-queued coarse result.
{
  const { controller, workers } = fakeController();
  const commits: string[] = [];
  controller.onCommit = (_surface, quality) => commits.push(quality);
  controller.beginGesture();
  const first = controller.start(params, 'preview');
  controller.invalidate(changed);
  assert(!workers[0].terminated, 'continuous input coalesces behind one preview');
  assert.equal(controller.start(changed, 'preview'), first);
  workers[0].succeed(); success(await first);
  assert.deepEqual(commits, ['preview']);
  assert.equal(workers.length, 2, 'the newest queued settings start after the coarse frame');
  assert.equal(workers[1].input?.params.seed, changed.seed);
  assert.equal(controller.exportBlock(changed), NOISE_PENDING, 'same-gesture approximation is never exportable');
  controller.endGesture();
  workers[1].succeed();
  assert.deepEqual(commits, ['preview'], 'release retires late coarse results');
  const full = controller.start(changed, 'full');
  workers[2].succeed(); success(await full);
  assert.deepEqual(commits, ['preview', 'full']);
  assert.equal(controller.exportBlock(changed), null);
}
{
  const { controller, workers } = fakeController();
  let commits = 0;
  controller.onCommit = () => { commits++; };
  controller.beginGesture();
  const oldGesture = controller.start(params, 'preview');
  controller.beginGesture();
  refused(await oldGesture);
  workers[0].succeed();
  assert.equal(commits, 0, 'new gesture discards the previous gesture');
  const newGesture = controller.start(changed, 'preview');
  controller.cancel('Mode changed'); refused(await newGesture);
  workers[1].succeed(); assert.equal(commits, 0, 'mode change discards coarse results');
}
{
  const { controller, workers } = fakeController();
  controller.beginGesture();
  const preview = controller.start(params, 'preview');
  const exporting = controller.start(params, 'full');
  refused(await preview);
  controller.invalidate(changed); refused(await exporting);
  const nextPreview = controller.start(changed, 'preview');
  workers[2].succeed(); success(await nextPreview);
  assert.equal(controller.exportBlock(changed), NOISE_PENDING, 'an interrupted full export never certifies a preview');
  controller.cancel();
}
// Synchronous failure retires outstanding waiters and blocks a prior completed source.
{
  const {controller,workers}=fakeController();
  controller.acceptSync(params,scalar);
  controller.failSync(params,'Synchronous sampler failure');
  assert.match(controller.exportBlock(params)??'',/Synchronous sampler failure/);
  assert(controller.failed);
  const pending=controller.start(changed,'full');
  controller.failSync(changed,'Replacement failed');
  refused(await pending); assert(workers[0].terminated);
  workers[0].succeed();
  assert.match(controller.exportBlock(changed)??'',/Replacement failed/);
  controller.acceptSync(changed,scalar);
  assert.equal(controller.exportBlock(changed),null);
}
// Synchronous consumers must refuse a stale generated source too.
Object.assign(STATE, DEFAULTS, { resolution: 8 }); generateNoiseMesh();
STATE.seed++;
assert.equal(getExportSurface(), NOISE_CHANGED);
Object.assign(STATE, DEFAULTS);
process.stdout.write(`Noise worker contracts passed; ${fixture.fixtures.length} pre-move surfaces byte-identical.\n`);
