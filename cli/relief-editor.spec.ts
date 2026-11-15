import { NoiseGeneration, type NoiseWorker } from '../src/noise/controller';
import { packNoiseSurface, type NoiseWorkerInput, type NoiseWorkerOutput } from '../src/noise/messages';
import { reliefRidgeReadout } from '../src/noise/relief-features';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/state';
import { buildNoiseSurface, noiseSurfaceParams } from '../src/noise/surface';
import { captureReliefProject, encodeReliefProject, type ReliefProject } from '../src/relief-project';
import { ReliefEditor, type EditorJobs } from '../src/relief-editor';
import { runEditorJob } from '../src/relief-editor-worker';
import { ReliefEditorJobs, type EditorWorker } from '../src/relief-editor-jobs';
import type { EditorInput, EditorOutput } from '../src/relief-editor-worker';

const params = noiseSurfaceParams({...DEFAULTS, noiseType: 'voronoi-relief', meshX: 8, meshY: 6, resolution: 48, reliefCellSize: 2, distortion: 0, reliefRadialFociCount: 0});
const surface = buildNoiseSurface(params), source = surface.reliefSource!;
for (const seed of [-17, 0.125, Number.MAX_SAFE_INTEGER + 4]) {
  const seeded = buildNoiseSurface({...params, seed}), frozen = captureReliefProject(seeded);
  assert.equal(frozen.params.seed, seed, 'exact projects retain the actual finite input seed');
  assert.deepEqual(buildNoiseSurface({...frozen.params, reliefSites: frozen.sites, reliefRevision: 7}).vertices, seeded.vertices);
}
const jobs: EditorJobs = {
  preflight: async project => { runEditorJob({kind: 'preflight', project}); },
  relax: async project => runEditorJob({kind: 'relax', project}),
  generate: async p => runEditorJob({kind: 'generate', params: p}),
  cancel: () => undefined,
};
const ridge = reliefRidgeReadout({...DEFAULTS, noiseType: 'voronoi-relief', reliefWallWidth: 0.02}, 0.125);
assert.equal(ridge?.warn, true); assert.match(ridge!.text, /not a physical minimum/);
const editor = new ReliefEditor(jobs);
editor.freeze(source);
const initial = editor.current!;
const heights = (p: ReliefProject): number[][] => buildNoiseSurface({...p.params, reliefSites: p.sites, reliefRevision: 1}).vertices;
assert.deepEqual(heights(initial), surface.vertices, 'freeze reads completed Float64 producer sites without placement or RNG drift');
const id = initial.sites.ids[0], x = initial.sites.xy[0], y = initial.sites.xy[1];
editor.beginGesture();
editor.move(id, Math.min(8, x + 0.1), y);
editor.move(id, Math.min(8, x + 0.2), y);
editor.commitGesture();
assert.notDeepEqual(heights(editor.current!), surface.vertices);
editor.undo(); assert.deepEqual(heights(editor.current!), surface.vertices, 'one undo restores the complete pre-gesture surface');
assert.equal(editor.canUndo, false);
editor.redo(); editor.beginGesture(); editor.move(id, x, y); editor.cancelGesture();
assert.equal(editor.current!.sites.xy[0], Math.min(8, x + 0.2));
editor.pin(id, true);
const pinned = editor.current!.sites.xy.slice(0, 2);
await editor.relax(); assert.deepEqual(editor.current!.sites.xy.slice(0, 2), pinned, 'explicit Worker relaxation respects the pin');
const beforeStock = editor.current!;
assert.doesNotThrow(() => editor.updateParams({baseThickness: 0.3}), 'lowering stock must couple cut depth before exact source validation'); assert.equal(editor.current!.params.amplitude, 0.3);
editor.undo(); assert.deepEqual(editor.current, beforeStock);
editor.stage({reliefAttractorMode: 'point'}); editor.updateParams({baseThickness: 0.3});
assert.equal(editor.pendingParams()!.amplitude, 0.3); assert.deepEqual(editor.current, beforeStock);
editor.undo(); editor.undo(); assert.equal(editor.hasPending, false);
const beforeHandle = editor.current!;
editor.beginGesture(); editor.moveHandle({reliefAttractorX: 0.2}); editor.moveHandle({reliefAttractorX: 0.3}); editor.commitGesture();
assert.equal(editor.pendingValue('reliefAttractorX'), 0.3);
assert.equal(editor.current!.params.reliefAttractorX, beforeHandle.params.reliefAttractorX, 'a placement handle remains unapplied');
assert.deepEqual(heights(editor.current!), heights(beforeHandle));
editor.undo(); assert.equal(editor.hasPending, false, 'one Undo removes the entire pending handle gesture');
editor.redo(); assert.equal(editor.pendingValue('reliefAttractorX'), 0.3);
editor.beginGesture(); editor.moveHandle({reliefAttractorX: 0.4}); editor.cancelGesture();
assert.equal(editor.pendingValue('reliefAttractorX'), 0.3, 'cancel restores the previous pending settings');
await editor.apply(); assert.equal(editor.hasPending, false); assert.equal(editor.current!.params.reliefAttractorX, 0.3);
editor.undo(); assert.equal(editor.pendingValue('reliefAttractorX'), 0.3); assert.deepEqual(heights(editor.current!), heights(beforeHandle), 'Undo Apply restores the applied source and prior pending layout');
editor.undo(); assert.equal(editor.hasPending, false);
const saved = editor.save(); editor.markSaved(saved); assert.equal(editor.dirty, false);
editor.edit({kind: 'add', x: 0.0123456789012345, y: 0.123456789012345});
assert.equal(editor.markSaved(saved), false); assert.equal(editor.dirty, true);
const detached = editor.current!; detached.sites.xy.fill(0); assert.notDeepEqual(detached.sites.xy, editor.current!.sites.xy);
const beforePending = encodeReliefProject(editor.current!);
editor.stage({reliefCellSize: 1}); assert.equal(encodeReliefProject(editor.current!), beforePending);
assert.equal(editor.hasPending, true); editor.discardPending();
await editor.open(saved.text); assert.equal(encodeReliefProject(editor.current!), saved.text);
const beforeBad = encodeReliefProject(editor.current!);
const invalidStock = JSON.parse(saved.text); invalidStock.params.baseThickness = 0.01;
for (const text of ['{', JSON.stringify(invalidStock), saved.text.replace('"version":1', '"version":2'), 'x'.repeat(1_000_001)]) {
  await assert.rejects(editor.open(text)); assert.equal(encodeReliefProject(editor.current!), beforeBad);
}
const pendingEditor = new ReliefEditor(jobs); pendingEditor.freeze(source);
const pendingSource = encodeReliefProject(pendingEditor.current!);
pendingEditor.stage({reliefCellSize: 1}); pendingEditor.undo();
assert.equal(pendingEditor.hasPending, false, 'pending layout participates in Undo');
assert.equal(pendingEditor.canUndo, false); pendingEditor.redo(); assert.equal(pendingEditor.pendingValue('reliefCellSize'), 1);
pendingEditor.discardPending(); pendingEditor.undo(); assert.equal(pendingEditor.pendingValue('reliefCellSize'), 1);
pendingEditor.discardPending();
pendingEditor.beginGesture(); pendingEditor.moveHandle({reliefAttractorX: .2}); pendingEditor.moveHandle({reliefAttractorX: .3}); pendingEditor.commitGesture();
assert.equal(encodeReliefProject(pendingEditor.current!), pendingSource, 'placement handle leaves applied source unchanged');
assert.equal(pendingEditor.pendingValue('reliefAttractorX'), .3); pendingEditor.undo(); assert.equal(pendingEditor.hasPending, false);
pendingEditor.redo(); pendingEditor.beginGesture(); pendingEditor.moveHandle({reliefAttractorX: .4}); pendingEditor.cancelGesture();
assert.equal(pendingEditor.pendingValue('reliefAttractorX'), .3, 'cancel restores the prior pending handle state');
await pendingEditor.apply(); assert.equal(pendingEditor.current!.params.reliefAttractorX, .3); assert.equal(pendingEditor.hasPending, false);
pendingEditor.undo(); assert.equal(encodeReliefProject(pendingEditor.current!), pendingSource); assert.equal(pendingEditor.pendingValue('reliefAttractorX'), .3);
const fresh = new ReliefEditor(jobs); assert.equal(await fresh.open(saved.text), true); assert.equal(fresh.dirty, false, 'fresh Open establishes its saved baseline');
// Cancelling an earlier job must not clear the busy state of a newer file operation.
let rejectRelax: ((error: Error) => void) | undefined, readBusy: ((text: string) => void) | undefined;
const busyEditor = new ReliefEditor({...jobs,
  relax: () => new Promise<ReliefProject>((_resolve, reject) => { rejectRelax = reject; }),
  cancel: () => { const reject = rejectRelax; rejectRelax = undefined; reject?.(new Error('cancelled prior operation')); },
});
busyEditor.freeze(source);
const priorRelax = busyEditor.relax(), priorRejected = assert.rejects(priorRelax, /cancelled prior operation/);
const busyOpen = busyEditor.openFile({size: saved.text.length, text: () => new Promise<string>(resolve => { readBusy = resolve; })});
await priorRejected;
assert.equal(busyEditor.running, true, 'retired Relax cannot clear a newer file read busy state');
readBusy!(saved.text); assert.equal(await busyOpen, true); assert.equal(busyEditor.running, false);
const oversized = {...initial.params, meshX: 1, meshY: 24, resolution: 1024};
let generatedOversized = 0;
const boundedEditor = new ReliefEditor({...jobs, generate: async () => { generatedOversized++; return initial; }});
boundedEditor.freeze(source); boundedEditor.stage(oversized);
await assert.rejects(boundedEditor.apply(), /supported generation grid/);
assert.equal(generatedOversized, 0, 'over-budget staged settings refuse before starting a generation job');
assert.equal(boundedEditor.running, false); assert.equal(boundedEditor.hasPending, true);
assert.deepEqual(boundedEditor.current, initial, 'refused Apply retains applied source and staged settings');
// A missing Worker-side guard must fail safely instead of allocating the oversized grid.
const nativeFloat64 = globalThis.Float64Array;
try {
  globalThis.Float64Array = new Proxy(nativeFloat64, {construct(target, args, receiver) {
    if (typeof args[0] === 'number' && args[0] > 4_194_304) throw new Error('HEAVY_GRID_SENTINEL');
    return Reflect.construct(target, args, receiver);
  }});
  assert.throws(() => runEditorJob({kind: 'generate', params: oversized}), /supported generation grid/);
} finally { globalThis.Float64Array = nativeFloat64; }
let finishEarlier: (() => void) | undefined;
const latest = new ReliefEditor({...jobs, preflight: () => new Promise<void>(resolve => { finishEarlier = resolve; })});
latest.freeze(source); latest.edit({kind: 'add', x: .123, y: .456});
const retainedLatest = encodeReliefProject(latest.current!), older = latest.open(saved.text); await Promise.resolve();
await assert.rejects(latest.open('{')); finishEarlier!();
assert.equal(await older, false, 'rejected newer Open retires older valid preflight'); assert.equal(encodeReliefProject(latest.current!), retainedLatest);
let finishRead: ((text: string) => void) | undefined;
const earlierRead = latest.openFile({size: saved.text.length, text: () => new Promise<string>(resolve => { finishRead = resolve; })});
await assert.rejects(latest.open('{')); finishRead!(saved.text);
assert.equal(await earlierRead, false, 'rejected newer selection retires an older file read');
let release: (() => void) | undefined;
const delayed = new ReliefEditor({...jobs, preflight: () => new Promise<void>(resolve => { release = resolve; })});
delayed.freeze(source);
const open = delayed.open(saved.text);
await Promise.resolve();
delayed.edit({kind: 'add', x: 0, y: 0});
release!(); assert.equal(await open, false, 'late import cannot replace a newer edit');
assert.equal(delayed.current!.sites.ids.length, initial.sites.ids.length + 1);
let readA: ((text: string) => void) | undefined, finishB: (() => void) | undefined;
let preflightCalls = 0;
const selected = new ReliefEditor({...jobs, preflight: () => { preflightCalls++; return new Promise<void>(resolve => { finishB = resolve; }); }});
selected.freeze(source);
const readPending = selected.openFile({size: saved.text.length, text: () => new Promise<string>(resolve => { readA = resolve; })});
const newerPending = selected.openFile({size: saved.text.length, text: async () => saved.text});
await Promise.resolve(); await Promise.resolve();
assert.equal(preflightCalls, 1, 'newer selection starts preflight while old read is pending');
readA!(saved.text); assert.equal(await readPending, false, 'old read cannot cancel the newer preflight');
assert.equal(preflightCalls, 1); finishB!(); assert.equal(await newerPending, true);
let stalePreflight: (() => void) | undefined;
const phase = new ReliefEditor({...jobs, preflight: () => new Promise<void>(resolve => { stalePreflight = resolve; })});
phase.freeze(source);
const oldPreflight = phase.open(saved.text); await Promise.resolve(); await Promise.resolve();
const firstFinish = stalePreflight!;
const newRead = phase.openFile({size: saved.text.length, text: () => new Promise<string>(resolve => { readA = resolve; })});
firstFinish(); assert.equal(await oldPreflight, false, 'new selection invalidates an earlier preflight before its file read ends');
readA!(saved.text); await Promise.resolve(); await Promise.resolve(); stalePreflight!(); assert.equal(await newRead, true);
let sourceCurrent = true;
const sourceBound = new ReliefEditor({...jobs, preflight: () => new Promise<void>(resolve => { release = resolve; })});
sourceBound.freeze(source);
const changedSource = sourceBound.openFile({size: saved.text.length, text: async () => saved.text}, () => sourceCurrent);
await Promise.resolve(); await Promise.resolve(); sourceCurrent = false; release!();
assert.equal(await changedSource, false, 'a background source replacement cannot be overwritten by a pending import');
await assert.rejects(sourceBound.openFile({size: 1_000_001, text: async () => {throw new Error('oversized files must never be read');}}), /supported file size/);
const failing = new ReliefEditor({...jobs, preflight: async () => { throw new Error('worker failure'); }});
failing.freeze(source);
await assert.rejects(failing.open(saved.text), /worker failure/);
assert.equal(encodeReliefProject(failing.current!), encodeReliefProject(initial));

class FakeWorker implements EditorWorker {
  onmessage: ((event: MessageEvent<EditorOutput>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  input: EditorInput | null = null;
  stopped = false;
  postMessage(input: EditorInput): void { this.input = input; }
  terminate(): void { this.stopped = true; }
}
const workers: FakeWorker[] = [];
const workerJobs = new ReliefEditorJobs(() => { const worker = new FakeWorker(); workers.push(worker); return worker; });
const first = workerJobs.relax(initial);
const firstRejected = assert.rejects(first, /Project changed/);
const second = workerJobs.preflight(initial);
await firstRejected;
assert.equal(workers[0].stopped, true);
workers[0].onmessage!({data: {ok: true, project: initial}} as MessageEvent<EditorOutput>);
workers[1].onmessage!({data: {ok: false, reason: 'injected preflight refusal'}} as MessageEvent<EditorOutput>);
await assert.rejects(second, /injected preflight refusal/);
assert.deepEqual(captureReliefProject(surface).sites.xy, initial.sites.xy);
const noiseWorkers: NoiseWorker[] = [];
const generation = new NoiseGeneration({createWorker: () => {
  const worker: NoiseWorker = {onmessage: null, onerror: null, onmessageerror: null, postMessage: (_input: NoiseWorkerInput) => undefined, terminate: () => undefined};
  noiseWorkers.push(worker); return worker;
}});
assert.equal(generation.completedReliefSource(), null);
const preview = generation.start(params, 'preview');
noiseWorkers[0].onmessage!({data: {type: 'result', requestId: 1, surface: packNoiseSurface(surface)}} as MessageEvent<NoiseWorkerOutput>);
await preview; assert.equal(generation.completedReliefSource(), null, 'preview metadata cannot freeze a document');
const full = generation.start(params, 'full');
assert.equal(generation.completedReliefSource(), null, 'pending full source is unavailable');
assert.equal(noiseWorkers.length, 1, 'the full source reuses the completed preview transport');
const fullMessage = noiseWorkers[0].onmessage!;
fullMessage({data: {type: 'result', requestId: 2, surface: packNoiseSurface(surface)}} as MessageEvent<NoiseWorkerOutput>);
const fullOutcome = await full;
assert.deepEqual(generation.completedReliefSource()!.sites.xy, source.sites.xy);
const published = generation.completedReliefSource()!; published.sites.xy.fill(0);
assert.deepEqual(generation.completedReliefSource()!.sites.xy, source.sites.xy, 'completed source readers cannot mutate retained producer buffers');
assert('surface' in fullOutcome && fullOutcome.surface.reliefSource);
const completedMetadata = fullOutcome.surface.reliefSource;
fullOutcome.surface.reliefSource = {...completedMetadata, sites: {...completedMetadata.sites, xy: new Float64Array(completedMetadata.sites.xy.length)}};
assert.deepEqual(generation.completedReliefSource()!.sites.xy, source.sites.xy, 'a published surface cannot mutate the editor metadata adapter');
assert.deepEqual(generation.completedSource(params)!.source.sites.xy, source.sites.xy, 'both editor entry points read the same privately retained source');
generation.invalidate({...params, seed: params.seed + 1});
assert.equal(generation.completedReliefSource(), null, 'changed input retires the full source');
fullMessage({data: {type: 'result', requestId: 2, surface: packNoiseSurface(surface)}} as MessageEvent<NoiseWorkerOutput>);
assert.equal(generation.completedReliefSource(), null, 'stale Worker completion cannot revive a retired source');
const failed = generation.start({...params, seed: params.seed + 1}, 'full');
assert.equal(noiseWorkers.length, 1, 'a new request retains healthy idle transport without retaining old source authority');
noiseWorkers[0].onmessage!({data: {type: 'error', requestId: 3, message: 'injected failure'}} as MessageEvent<NoiseWorkerOutput>);
await failed; assert.equal(generation.completedReliefSource(), null, 'failed source cannot freeze');
generation.acceptSync(params, surface); assert(generation.completedReliefSource());
generation.cancel(); assert.equal(generation.completedReliefSource(), null, 'cancel retires producer metadata too');
process.stdout.write('Relief editor ownership, geometry, gesture, pin, save, import and Worker race regressions passed.\n');
