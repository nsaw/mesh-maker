/// <reference lib="webworker" />
/**
 * Drape Worker: runs the Jolt cloth simulation (src/drape-sim/pipeline.ts) off the main thread and
 * posts progress per frame, then the relief heights. The main thread cancels by terminating it.
 */
import initJolt from 'jolt-physics/wasm-compat';
import { parseFigure } from './figure';
import { drapeFigure } from './pipeline';
import type { DrapeJob, DrapeWorkerMessage } from './messages';

const post = (m: DrapeWorkerMessage, transfer: Transferable[] = []): void => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<DrapeJob>) => {
  try {
    const fig = parseFigure(e.data.figure), d = e.data.detail;
    const detail = d ? { header: { ...fig.header, vertices: d.positions.length / 3, triangles: d.triangles.length / 3 }, positions: d.positions, triangles: d.triangles } : null;
    const J = await initJolt();
    const run = drapeFigure(J, fig, e.data.pose, e.data.params, (frame, frames) => { post({ type: 'progress', frame, frames }); }, detail);
    const { heightsM, mask, veil } = run.relief;
    post({ type: 'done', heightsM, mask, veil, seconds: run.seconds, lastFrameMotion: run.lastFrameMotion },
      [heightsM.buffer, mask.buffer, veil.buffer]);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
