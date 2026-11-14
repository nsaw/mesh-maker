import type { EditorJobs } from './relief-editor';
import { copyReliefProject, type ReliefProject, type ReliefProjectParams } from './relief-project';
import type { EditorInput, EditorOutput } from './relief-editor-worker';

export interface EditorWorker {
  onmessage: ((event: MessageEvent<EditorOutput>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(input: EditorInput): void;
  terminate(): void;
}
/** Preflights never publish a preview or mutate the current mesh. */
export class ReliefEditorJobs implements EditorJobs {
  private active: {worker: EditorWorker; reject(error: Error): void; timer: ReturnType<typeof setTimeout>} | null = null;
  constructor(private readonly create: () => EditorWorker = () => new Worker(new URL('./relief-editor-worker.ts', import.meta.url), {type: 'module'})) {}
  cancel(): void {
    const active = this.active;
    if (!active) return;
    this.active = null; clearTimeout(active.timer); active.worker.terminate();
    active.reject(new Error('Project changed while preparing cells. Try again.'));
  }
  private run(input: EditorInput): Promise<ReliefProject> {
    this.cancel();
    return new Promise((resolve, reject) => {
      let worker: EditorWorker;
      try { worker = this.create(); }
      catch { reject(new Error('Cell editing needs a Worker. Reload and try again.')); return; }
      const finish = (result: EditorOutput): void => {
        if (this.active?.worker !== worker) return;
        clearTimeout(this.active.timer); this.active = null; worker.terminate();
        try { if (result.ok) resolve(copyReliefProject(result.project)); else reject(new Error(result.reason)); }
        catch (error: unknown) { reject(error); }
      };
      this.active = {worker, reject, timer: setTimeout(() => finish({ok: false, reason: 'Cell preparation timed out. Try again.'}), 120_000)};
      worker.onmessage = event => finish(event.data);
      worker.onerror = event => { event.preventDefault(); finish({ok: false, reason: event.message || 'Cell Worker failed. Reload and try again.'}); };
      worker.onmessageerror = () => finish({ok: false, reason: 'Cell Worker returned unreadable data.'});
      try { worker.postMessage(input); }
      catch (error: unknown) { finish({ok: false, reason: error instanceof Error ? error.message : String(error)}); }
    });
  }
  async preflight(project: ReliefProject): Promise<void> { await this.run({kind: 'preflight', project: copyReliefProject(project)}); }
  relax(project: ReliefProject): Promise<ReliefProject> { return this.run({kind: 'relax', project: copyReliefProject(project)}); }
  generate(params: ReliefProjectParams): Promise<ReliefProject> { return this.run({kind: 'generate', params: {...params}}); }
}
