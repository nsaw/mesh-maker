/// <reference lib="webworker" />
/**
 * Drape Worker: runs the Jolt cloth simulation (src/drape-sim/pipeline.ts) off the main thread and
 * posts progress per frame, then the relief heights. The main thread cancels by terminating it.
 */
import initJolt from 'jolt-physics/wasm-compat';
import { runDrapeJob } from './pipeline';
import type { DrapeJob, DrapeWorkerMessage } from './messages';

const post = (m: DrapeWorkerMessage, transfer: Transferable[] = []): void => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<DrapeJob>) => {
  try {
    const J = await initJolt();
    const run = runDrapeJob(J, e.data, (frame, frames) => { post({ type: 'progress', frame, frames }); });
    const { heightsM, mask, veil } = run.relief;
    post({ type: 'done', heightsM, mask, veil, seconds: run.seconds, lastFrameMotion: run.lastFrameMotion },
      [heightsM.buffer, mask.buffer, veil.buffer]);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
