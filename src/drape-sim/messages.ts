/** Messages between the Drape tab (src/drape-ui.ts) and the drape Worker (src/drape-sim/worker.ts). */
import type { ClothParams } from './cloth';
import type { FigurePose } from './figure';

export interface DrapeJob {
  type: 'drape';
  /** A .mcfig file (src/drape-sim/figure.ts), transferred. */
  figure: ArrayBuffer;
  pose: FigurePose;
  params: ClothParams;
}

export type DrapeWorkerMessage =
  | { type: 'progress'; frame: number; frames: number }
  | { type: 'done'; heightsM: Float32Array; mask: Uint8Array; veil: Uint8Array; seconds: number; lastFrameMotion: number }
  | { type: 'error'; message: string };
