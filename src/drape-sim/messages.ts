/** Messages between the Drape tab (src/drape-ui.ts) and the drape Worker (src/drape-sim/worker.ts). */
import type { ClothParams } from './cloth';
import type { FigurePose } from './figure';

export interface DrapeJob {
  type: 'drape';
  /** A .mcfig file (src/drape-sim/figure.ts), transferred. */
  figure: ArrayBuffer;
  pose: FigurePose;
  params: ClothParams;
  /** The full-resolution figure the drape figure was simplified from (splitForDrape), copied: the relief
   *  is extracted over it. Its header is the drape figure's apart from the counts. */
  detail?: { positions: Float32Array; triangles: Uint32Array };
}

export type DrapeWorkerMessage =
  | { type: 'progress'; frame: number; frames: number }
  | { type: 'done'; heightsM: Float32Array; mask: Uint8Array; veil: Uint8Array; seconds: number; lastFrameMotion: number }
  | { type: 'error'; message: string };
