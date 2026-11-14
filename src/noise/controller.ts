import { buildNoiseSurface, noiseSurfaceParams, type NoiseSurface, type NoiseSurfaceParams } from './surface';
import { unpackNoiseSurface, type GenerationQuality, type NoiseWorkerInput, type NoiseWorkerOutput } from './messages';
import { isChunkLoadError, UPDATED_MESSAGE, updatedSinceLoad } from '../stale-build';

export const NOISE_PENDING = 'The full-resolution surface is still generating. Export again when it finishes.';
export const NOISE_CHANGED = 'Settings changed while preparing the export. Export again for the current model.';

export interface NoiseWorker {
  onmessage: ((event: MessageEvent<NoiseWorkerOutput>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(input: NoiseWorkerInput): void;
  terminate(): void;
}
export type NoiseOutcome = { surface: NoiseSurface; revision: number } | { reason: string };
interface Request {
  id: number;
  revision: number;
  quality: GenerationQuality;
  gesture: number;
  worker: NoiseWorker | null;
  timer: ReturnType<typeof setTimeout>;
  promise: Promise<NoiseOutcome>;
  settle(outcome: NoiseOutcome): void;
}
interface ControllerOptions {
  createWorker(): NoiseWorker;
  build(params: NoiseSurfaceParams): NoiseSurface;
  updated(): Promise<boolean>;
  timeoutMs: number;
}

/** A request owns its settings, waiters and worker. Retired requests cannot mutate current state. */
export class NoiseGeneration {
  private revision = 0;
  private nextId = 0;
  private key = '';
  private params: NoiseSurfaceParams | null = null;
  private request: Request | null = null;
  private full: NoiseSurface | null = null;
  private error: string | null = null;
  private tracked = false;
  private gesture = 0;
  private dragging = false;
  includeWire: () => boolean = () => false;
  onCommit: (surface: NoiseSurface, quality: GenerationQuality) => void = () => undefined;
  onBusy: (busy: boolean) => void = () => undefined;
  onError: (reason: string) => void = () => undefined;
  private readonly options: ControllerOptions;

  constructor(options: Partial<ControllerOptions> = {}) {
    this.options = {
      createWorker: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
      build: buildNoiseSurface, updated: updatedSinceLoad, timeoutMs: 120_000, ...options,
    };
  }

  /** Called in the input event, before the debounce timer can expose an old grid to an export. */
  invalidate(params: NoiseSurfaceParams): number {
    const key = JSON.stringify(noiseSurfaceParams(params));
    this.tracked = true;
    if (key === this.key && this.params) return this.revision;
    // During a gesture one display-only preview may finish while newer input is queued.
    // Full requests and every request outside that gesture retain strict source-revision ownership.
    if (!(this.dragging && this.request?.quality === 'preview' && this.request.gesture === this.gesture)) this.stop(NOISE_CHANGED);
    this.revision++;
    this.key = key;
    this.params = noiseSurfaceParams(params);
    this.full = null;
    this.error = null;
    return this.revision;
  }

  beginGesture(): void {
    this.stop(NOISE_CHANGED);
    this.gesture++;
    this.dragging = true;
  }

  endGesture(): void {
    this.dragging = false;
    this.gesture++;
    if (this.request?.quality === 'preview') this.stop(NOISE_CHANGED);
  }

  get displayPending(): boolean { return this.tracked && this.full === null; }
  get failed(): boolean { return this.error !== null; }
  get completionToken(): string { return `${this.revision}:${this.gesture}`; }
  isRevisionCurrent(revision: number): boolean { return revision === this.revision; }

  cancel(reason = NOISE_CHANGED): void {
    this.endGesture();
    this.stop(reason);
    this.revision++;
    this.key = '';
    this.params = null;
    this.full = null;
    this.error = null;
    this.tracked = false;
    this.onBusy(false);
  }

  acceptSync(params: NoiseSurfaceParams, surface: NoiseSurface): void {
    this.invalidate(params);
    this.stop(NOISE_CHANGED);
    this.full = surface;
    this.error = null;
    this.onBusy(false);
  }

  /** The synchronous adapter shares request and export authority with browser workers. */
  failSync(params: NoiseSurfaceParams, message: string): void {
    this.invalidate(params);
    this.endGesture();
    this.stop(NOISE_CHANGED);
    this.full = null;
    this.error = `Noise generation failed: ${message}`;
    this.onBusy(false);
  }

  exportBlock(params: NoiseSurfaceParams): string | null {
    if (!this.tracked) return null; // Node clients may supply their own grids without a browser request.
    if (JSON.stringify(noiseSurfaceParams(params)) !== this.key) return NOISE_CHANGED;
    return this.error ?? (this.full ? null : NOISE_PENDING);
  }

  start(params: NoiseSurfaceParams, quality: GenerationQuality): Promise<NoiseOutcome> {
    const revision = this.invalidate(params);
    if (this.full) return Promise.resolve({ surface: this.full, revision });
    if (this.request && (this.request.quality === 'full' || quality === 'preview')) return this.request.promise;
    this.stop(NOISE_CHANGED);
    this.error = null;
    const id = ++this.nextId;
    let settle: (outcome: NoiseOutcome) => void = () => undefined;
    const promise = new Promise<NoiseOutcome>(resolve => { settle = resolve; });
    const request: Request = { id, revision, quality, gesture: this.gesture, worker: null, promise, settle,
      timer: setTimeout(() => { this.fail(request, 'Noise generation timed out. Generate again.'); }, this.options.timeoutMs) };
    this.request = request;
    this.onBusy(true);
    const input = { requestId: id, includeWire: this.includeWire(), params: noiseSurfaceParams({ ...params,
      resolution: quality === 'preview' ? Math.min(params.resolution, 120) : params.resolution }) };
    try {
      request.worker = this.options.createWorker();
    } catch {
      // Construction can be blocked by a browser policy. The same arithmetic remains available inline.
      try { this.complete(request, this.options.build(input.params)); }
      catch (error: unknown) { this.fail(request, error instanceof Error ? error.message : String(error)); }
      return promise;
    }
    const worker = request.worker;
    worker.onmessage = event => {
      if (!this.current(request) || event.data.requestId !== id) return;
      if (event.data.type === 'error') { this.fail(request, event.data.message); return; }
      try { this.complete(request, unpackNoiseSurface(event.data.surface)); }
      catch (error: unknown) { this.fail(request, error instanceof Error ? error.message : String(error)); }
    };
    worker.onerror = event => { event.preventDefault(); this.fail(request, event.message || 'The noise worker did not start. Check the connection.', true); };
    worker.onmessageerror = () => { this.fail(request, 'The noise worker returned unreadable data. Generate again.'); };
    try { worker.postMessage(input); }
    catch (error: unknown) { this.fail(request, error instanceof Error ? error.message : String(error)); }
    return promise;
  }

  private current(request: Request): boolean {
    return this.request === request && (this.revision === request.revision
      || (request.quality === 'preview' && this.dragging && request.gesture === this.gesture));
  }
  private retire(request: Request): void {
    clearTimeout(request.timer);
    request.worker?.terminate();
    if (this.request === request) this.request = null;
  }
  private stop(reason: string): void {
    if (!this.request) return;
    const request = this.request;
    this.retire(request);
    request.settle({ reason });
  }
  private complete(request: Request, surface: NoiseSurface): void {
    if (!this.current(request)) return;
    this.retire(request);
    if (request.quality === 'full') this.full = surface;
    try { this.onCommit(surface, request.quality); }
    finally {
      this.onBusy(false);
      request.settle({ surface, revision: request.revision });
    }
    // Coalesce continuously arriving input. Only the newest immutable request follows this frame.
    if (request.quality === 'preview' && this.dragging && request.gesture === this.gesture
      && request.revision !== this.revision && this.params) void this.start(this.params, 'preview');
  }
  private fail(request: Request, message: string, workerLoadFailure = false): void {
    if (!this.current(request)) return;
    this.retire(request);
    this.dragging = false;
    this.gesture++;
    this.error = `Noise generation failed: ${message}`;
    this.onBusy(false);
    request.settle({ reason: this.error });
    // Settle immediately. A late deployment probe can only update this same failed request's message.
    void this.reportFailure(request, message, workerLoadFailure, this.revision);
  }
  private async reportFailure(request: Request, message: string, workerLoadFailure: boolean, reportRevision: number): Promise<void> {
    let updated = false;
    if (workerLoadFailure || isChunkLoadError(new Error(message))) {
      try { updated = await this.options.updated(); }
      catch { updated = false; } // Failed connectivity probes leave the original generation error visible.
    }
    if (reportRevision !== this.revision || request.id !== this.nextId || this.request || this.full) return;
    this.error = updated ? UPDATED_MESSAGE : `Noise generation failed: ${message}`;
    this.onError(this.error);
  }
}

export const noiseGeneration = new NoiseGeneration();
