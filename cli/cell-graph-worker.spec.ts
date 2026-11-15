import assert from 'node:assert/strict';
import { SimplexNoiseGen } from '../src/noise/generators';
import { getEventListeners } from 'node:events';
import { CellGraphController } from '../src/cell-graph/controller';
import type { CellGraphWorkerPort, CellGraphDeadline } from '../src/cell-graph/controller';
import type { CellGraphWorkerRequest, CellGraphWorkerResponse } from '../src/cell-graph/messages';
import { buildCellGraph } from '../src/cell-graph/graph';
import type { ReliefSourceSnapshot } from '../src/types';

class FakeWorker implements CellGraphWorkerPort {
  onmessage: ((event: MessageEvent<CellGraphWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  terminated = false;
  message: CellGraphWorkerRequest | null = null;
  postFailure: Error | null = null;
  postMessage(message: CellGraphWorkerRequest): void {
    if (this.postFailure) throw this.postFailure;
    this.message = message;
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(result = buildCellGraph(this.message!)): void {
    const message = this.message!;
    this.onmessage?.({
      data: { id: message.id, revision: message.revision, result },
    } as MessageEvent<CellGraphWorkerResponse>);
  }
}
class ManualDeadline implements CellGraphDeadline {
  readonly entries: { callback: () => void; cancelled: boolean }[] = [];
  schedule(callback: () => void, _timeoutMs: number): () => void {
    const entry = { callback, cancelled: false };
    this.entries.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }
  get active(): number {
    return this.entries.filter((entry) => !entry.cancelled).length;
  }
}
const source: ReliefSourceSnapshot = {
  sites: {
    xy: new Float64Array([1, 2, 3, 2]),
    ids: new Uint32Array([1, 4]),
    pinned: new Uint8Array(2),
    truncatedFrom: 0,
  },
  query: {
    implementation: 'meshcraft-relief-query/2',
    ownerPolicy: 'exact-represented-metric-stable-id-v1',
    meshX: 4,
    meshY: 4,
    seed: 7,
    metric: { cosA: 1, sinA: 0, scale: 1 },
    warp: { amplitude: 0, frequency: 0.1, seed: 37, kernel: null },
  },
};
function harness(factory?: () => FakeWorker) {
  const workers: FakeWorker[] = [],
    deadline = new ManualDeadline();
  const controller = new CellGraphController(
    () => {
      const worker = factory ? factory() : new FakeWorker();
      workers.push(worker);
      return worker;
    },
    { deadline },
  );
  return { controller, workers, deadline };
}
function released(worker: FakeWorker, deadline: ManualDeadline, signal?: AbortSignal): void {
  assert.ok(worker.terminated);
  assert.equal(worker.onmessage, null);
  assert.equal(worker.onerror, null);
  assert.equal(worker.onmessageerror, null);
  assert.equal(deadline.active, 0);
  if (signal) assert.equal(getEventListeners(signal, 'abort').length, 0);
}
const terminalCases = [
  'success',
  'worker-refusal',
  'error',
  'messageerror',
  'abort',
  'cancel',
  'stale',
  'id-mismatch',
  'revision-mismatch',
  'graph-mismatch',
  'implementation-mismatch',
  'malformed',
  'timeout',
] as const;
for (const terminal of terminalCases) {
  const { controller, workers, deadline } = harness(),
    abort = new AbortController();
  let current = true;
  const resultPromise = controller.request({
    source,
    revision: 5,
    signal: abort.signal,
    isCurrent: () => current,
  });
  assert.equal(deadline.active, 1);
  assert.equal(getEventListeners(abort.signal, 'abort').length, 1);
  const worker = workers[0];
  switch (terminal) {
    case 'success':
      worker.reply();
      break;
    case 'worker-refusal':
      worker.reply({ ok: false, reason: 'Proof refused' });
      break;
    case 'error':
      worker.onerror?.({ message: 'host error', preventDefault(): void {} } as ErrorEvent);
      break;
    case 'messageerror':
      worker.onmessageerror?.({} as MessageEvent<unknown>);
      break;
    case 'abort':
      abort.abort();
      break;
    case 'cancel':
      controller.cancel('Editor closed');
      break;
    case 'stale':
      current = false;
      worker.reply();
      break;
    case 'id-mismatch':
      worker.onmessage?.({
        data: { id: 999, revision: 5, result: { ok: false, reason: 'unexpected' } },
      } as MessageEvent<CellGraphWorkerResponse>);
      break;
    case 'revision-mismatch':
      worker.onmessage?.({
        data: { id: worker.message!.id, revision: 6, result: { ok: false, reason: 'unexpected' } },
      } as MessageEvent<CellGraphWorkerResponse>);
      break;
    case 'graph-mismatch': {
      const built = buildCellGraph(worker.message!);
      assert.ok(built.ok);
      worker.reply({ ok: true, graph: { ...built.graph, revision: 6 } });
      break;
    }
    case 'implementation-mismatch': {
      const built=buildCellGraph(worker.message!);assert.ok(built.ok);
      worker.reply({ok:true,graph:{...built.graph,implementation:'meshcraft-relief-query/1'}});
      break;
    }
    case 'malformed':
      worker.onmessage?.({
        data: { id: worker.message!.id, revision: 5, result: {} },
      } as MessageEvent<CellGraphWorkerResponse>);
      break;
    case 'timeout':
      deadline.entries[0].callback();
      break;
  }
  const result = await resultPromise;
  assert.equal(result.ok, terminal === 'success', terminal);
  if (result.ok) assert.ok(Object.isFrozen(result.graph) && Object.isFrozen(result.graph.nodes));
  else assert.ok(result.reason.length > 0);
  released(worker, deadline, abort.signal);
}
for (const failure of [
  'construction',
  'postMessage',
  'stale-initial',
  'aborted-initial',
] as const) {
  const abort = new AbortController();
  if (failure === 'aborted-initial') abort.abort();
  const { controller, workers, deadline } = harness(() => {
    if (failure === 'construction') throw new Error('Worker construction rejected');
    const worker = new FakeWorker();
    if (failure === 'postMessage') worker.postFailure = new Error('Cannot clone work');
    return worker;
  });
  const result = await controller.request({
    source,
    revision: 1,
    signal: abort.signal,
    isCurrent: () => failure !== 'stale-initial',
  });
  assert.equal(result.ok, false, failure);
  assert.equal(deadline.active, 0);
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
  workers.forEach((worker) => released(worker, deadline));
}
const scheduleFailure = new CellGraphController(() => new FakeWorker(), {
  deadline: {
    schedule() {
      throw new Error('Cannot schedule deadline');
    },
  },
});
assert.deepEqual(await scheduleFailure.request({ source, revision: 1 }), {
  ok: false,
  reason: 'Cannot schedule deadline',
});
for (const timeoutMs of [0, -1, NaN, Infinity, 300001])
  assert.throws(() => new CellGraphController(() => new FakeWorker(), { timeoutMs }), /deadline/);

// Replaying already queued events and an expired retired timer cannot retire a newer job.
const { controller, workers, deadline } = harness(),
  oldSignal = new AbortController();
const first = controller.request({ source, revision: 1, signal: oldSignal.signal });
const saved = {
  message: workers[0].onmessage!,
  error: workers[0].onerror!,
  messageerror: workers[0].onmessageerror!,
  timer: deadline.entries[0].callback,
};
source.sites.xy[0] = 0.5;
assert.equal(
  workers[0].message!.source.sites.xy[0],
  1,
  'retained arrays are copied before posting',
);
const second = controller.request({ source, revision: 2 });
assert.deepEqual(await first, { ok: false, reason: 'Cell graph request superseded' });
assert.ok(workers[0].terminated);
assert.equal(getEventListeners(oldSignal.signal, 'abort').length, 0);
saved.timer();
saved.error({ message: 'retired', preventDefault(): void {} } as ErrorEvent);
saved.messageerror({} as MessageEvent<unknown>);
saved.message({
  data: { id: 1, revision: 1, result: { ok: false, reason: 'retired' } },
} as MessageEvent<CellGraphWorkerResponse>);
oldSignal.abort();
assert.equal(deadline.active, 1);
assert.equal(workers[1].terminated, false);
workers[1].reply();
assert.equal((await second).ok, true);
released(workers[1], deadline);

// Kernel metadata is privately copied before transfer; retired-query identities never reach a worker.
{
  const active=structuredClone(source);
  active.query.warp={amplitude:0.4,frequency:0.1,seed:37,kernel:structuredClone(new SimplexNoiseGen(37).describeKernel())};
  const {controller,workers,deadline}=harness();
  const pending=controller.request({source:active,revision:8});
  const posted=workers[0].message!.source.query.warp.kernel!;
  const perm=posted.perm[0],gradient=posted.grad2[0][0];
  Reflect.set(active.query.warp.kernel!.perm,0,perm^1);
  Reflect.set(active.query.warp.kernel!.grad2[0],0,-gradient);
  assert.equal(posted.perm[0],perm);assert.equal(posted.grad2[0][0],gradient);
  controller.cancel();assert.equal((await pending).ok,false);released(workers[0],deadline);
  const stale=structuredClone(source);Reflect.set(stale.query,'implementation','meshcraft-relief-query/1');
  const invalid=await controller.request({source:stale,revision:9});
  assert(!invalid.ok && /implementation/.test(invalid.reason));
  assert.equal(workers.length,1);assert.equal(deadline.active,0);
}

// Construction can synchronously cancel. Its returned port must still be retired.
const duringConstruction = new FakeWorker();
const reentrant = new CellGraphController(
  () => {
    reentrant.cancel('Cancelled during construction');
    return duringConstruction;
  },
  { deadline: new ManualDeadline() },
);
assert.deepEqual(await reentrant.request({ source, revision: 1 }), {
  ok: false,
  reason: 'Cancelled during construction',
});
assert.ok(duringConstruction.terminated);
assert.equal(duringConstruction.message, null);

// This real deadline is the silent-worker regression. The watchdog bounds failure on old code.
const silent = new FakeWorker(),
  signal = new AbortController();
const bounded = new CellGraphController(() => silent, { timeoutMs: 5 });
const pending = bounded.request({ source, revision: 1, signal: signal.signal });
let watchdog: ReturnType<typeof setTimeout> | undefined;
try {
  const result = await Promise.race([
    pending,
    new Promise<'pending'>((resolve) => {
      watchdog = setTimeout(() => resolve('pending'), 100);
    }),
  ]);
  assert.notEqual(result, 'pending', 'a silent worker must settle before the watchdog');
  assert.deepEqual(result, {
    ok: false,
    reason: 'Cell graph request timed out after 5 milliseconds',
  });
  assert.ok(silent.terminated);
  assert.equal(silent.onmessage, null);
  assert.equal(silent.onerror, null);
  assert.equal(silent.onmessageerror, null);
  assert.equal(getEventListeners(signal.signal, 'abort').length, 0);
} finally {
  if (watchdog !== undefined) clearTimeout(watchdog);
  bounded.cancel();
  await pending;
}
const sync = new ManualDeadline();
const synchronous = new CellGraphController(() => new FakeWorker(), {
  deadline: {
    schedule(callback, ms) {
      const cancel = sync.schedule(callback, ms);
      callback();
      return cancel;
    },
  },
});
assert.equal((await synchronous.request({ source, revision: 1 })).ok, false);
assert.equal(sync.active, 0);
process.stdout.write(
  `Cell graph terminal paths (${terminalCases.join(', ')}), startup failures, retired events and silent deadline passed\n`,
);
