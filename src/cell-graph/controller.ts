import { validateCellGraphQuery } from './query';
import { copyReliefSource } from '../noise/relief-sites';
import type { CellGraphRequest, CellGraphResult } from './graph';
import type { CellGraphWorkerRequest, CellGraphWorkerResponse } from './messages';

export interface CellGraphWorkerPort {
  onmessage: ((event: MessageEvent<CellGraphWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (message: CellGraphWorkerRequest) => void;
  terminate: () => void;
}
export interface CellGraphDeadline {
  schedule: (callback: () => void, timeoutMs: number) => () => void;
}
export interface CellGraphControllerOptions {
  readonly timeoutMs?: number;
  readonly deadline?: CellGraphDeadline;
}
interface Pending {
  readonly id: number;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (result: CellGraphResult) => void;
  readonly abort: () => void;
  cancelDeadline: (() => void) | null;
  worker: CellGraphWorkerPort | null;
}
const defaultWorker = (): CellGraphWorkerPort =>
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const defaultDeadline: CellGraphDeadline = {
  schedule(callback, timeoutMs) {
    const timer = setTimeout(callback, timeoutMs);
    return () => clearTimeout(timer);
  },
};
export const CELL_GRAPH_TIMEOUT_MS = 120_000;

/** One worker and deadline belong to each request. Every terminal path retires both.
 * Saved events and retired timer callbacks can only address their original request ID. */
export class CellGraphController {
  private serial = 0;
  private pending: Pending | null = null;
  private readonly timeoutMs: number;
  private readonly deadline: CellGraphDeadline;

  constructor(
    private readonly createWorker: () => CellGraphWorkerPort = defaultWorker,
    options: CellGraphControllerOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? CELL_GRAPH_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 300_000)
      throw new RangeError('Cell graph deadline must be between 1 and 300000 milliseconds');
    this.deadline = options.deadline ?? defaultDeadline;
  }

  cancel(reason = 'Cell graph request cancelled'): void {
    if (this.pending) this.finish(this.pending.id, { ok: false, reason });
  }

  private finish(id: number, result: CellGraphResult): void {
    const pending = this.pending;
    if (!pending || pending.id !== id) return;
    this.pending = null;
    const errors = this.retire(pending);
    pending.resolve(
      errors.length
        ? { ok: false, reason: `Cell graph worker cleanup failed: ${errors.join('; ')}` }
        : result,
    );
  }

  private retire(pending: Pending): string[] {
    const cleanup: (() => void)[] = [
      () => pending.cancelDeadline?.(),
      () => pending.signal?.removeEventListener('abort', pending.abort),
    ];
    const worker = pending.worker;
    if (worker) {
      cleanup.push(
        () => {
          worker.onmessage = null;
        },
        () => {
          worker.onerror = null;
        },
        () => {
          worker.onmessageerror = null;
        },
        () => worker.terminate(),
      );
    }
    const errors: string[] = [];
    for (const action of cleanup) {
      try {
        action();
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Unknown cleanup failure');
      }
    }
    pending.worker = null;
    pending.cancelDeadline = null;
    return errors;
  }

  request(request: CellGraphRequest): Promise<CellGraphResult> {
    this.cancel('Cell graph request superseded');
    return new Promise((resolve) => {
      const id = ++this.serial;
      const { revision, signal, isCurrent, maxSteps } = request;
      const abort = (): void =>
        this.finish(id, { ok: false, reason: 'Cell graph request cancelled' });
      const pending: Pending = { id, signal, resolve, abort, cancelDeadline: null, worker: null };
      this.pending = pending;
      const fail = (reason: string): void => this.finish(id, { ok: false, reason });
      try {
        const cancelDeadline = this.deadline.schedule(
          () => fail(`Cell graph request timed out after ${this.timeoutMs} milliseconds`),
          this.timeoutMs,
        );
        // A scheduler that expires synchronously still retires its returned timer handle.
        if (this.pending?.id !== id) {
          cancelDeadline();
          return;
        }
        pending.cancelDeadline = cancelDeadline;
        if (signal?.aborted) {
          abort();
          return;
        }
        if (isCurrent && !isCurrent(revision)) {
          fail('Cell graph source revision became stale');
          return;
        }
        if (this.pending?.id !== id) return;
        const source = copyReliefSource(request.source);
        validateCellGraphQuery(source.query);
        if (this.pending?.id !== id) return;
        const worker = this.createWorker();
        pending.worker = worker;
        if (this.pending?.id !== id) {
          this.retire(pending);
          return;
        }
        worker.onerror = (event) => {
          if (this.pending?.id !== id) return;
          event.preventDefault();
          fail(`Cell graph worker failed: ${event.message}`);
        };
        worker.onmessageerror = () => fail('Cell graph worker response could not be deserialized');
        worker.onmessage = (event) => {
          if (this.pending?.id !== id) return;
          try {
            if (event.data.id !== id || event.data.revision !== revision) {
              fail('Cell graph worker response revision mismatch');
              return;
            }
            if (isCurrent && !isCurrent(revision)) {
              fail('Cell graph source revision became stale');
              return;
            }
            const result = event.data.result;
            if (
              !result ||
              typeof result.ok !== 'boolean' ||
              (!result.ok && typeof result.reason !== 'string')
            )
              throw new Error('Cell graph worker response is malformed');
            if (result.ok) {
              const graph = result.graph;
              if (graph.implementation !== source.query.implementation) {
                fail('Cell graph worker graph implementation mismatch');
                return;
              }
              if (graph.revision !== revision) {
                fail('Cell graph worker graph revision mismatch');
                return;
              }
              for (const node of graph.nodes) {
                Object.freeze(node.incident);
                Object.freeze(node);
              }
              for (const path of [...graph.inner, graph.outer]) {
                Object.freeze(path.nodes);
                Object.freeze(path.owners);
                Object.freeze(path);
              }
              Object.freeze(graph.nodes);
              Object.freeze(graph.inner);
              Object.freeze(graph.certificate);
              Object.freeze(graph);
            }
            this.finish(id, result);
          } catch (error) {
            fail(error instanceof Error ? error.message : 'Cell graph worker response failed');
          }
        };
        signal?.addEventListener('abort', abort, { once: true });
        // Covers cancellation during source copying or Worker construction before listener setup.
        if (signal?.aborted) {
          abort();
          return;
        }
        worker.postMessage({ id, revision, source, maxSteps });
      } catch (error) {
        fail(error instanceof Error ? error.message : 'Cell graph worker could not start');
      }
    });
  }
}
