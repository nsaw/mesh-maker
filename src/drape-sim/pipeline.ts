/**
 * Figure -> (optional) silk drape -> front relief, the web counterpart of the Blender proof
 * (scripts/drape/blender_drape.py + workflow.py). Pure: no DOM; used by the drape Worker, the Node
 * runner (cli/drape-run.ts) and the specs.
 *
 * Panel: the figure seen from the front (-Y) over x -2.1..2.1 scene units, z 1.2 down to -4.4 (12 x 16
 * aspect), 1201 x 1601 nodes, rows top-down. Heights map linearly: the deepest visible point (figure or
 * veil) to the frontmost point spans RELIEF_SPAN_IN above a RELIEF_BACKING_IN backing (the accepted Monti
 * mapping), so every height lies in [backing, backing + span].
 */
import { simulateCloth, type ClothParams, type Jolt } from './cloth';
import { tiltFigure, type Figure } from './figure';
import { emptyDepth, rasterizeFrontmost, type DepthWindow } from './raster';
import { gridTriangles, subdivideGrid } from './subdiv';

export const PANEL_WINDOW: DepthWindow = { x0: -2.1, x1: 2.1, zTop: 1.2, zBottom: 1.2 - 4.2 * 16 / 12, cols: 1201, rows: 1601 };
export const PANEL_WIDTH_IN = 12;
export const PANEL_HEIGHT_IN = 16;
export const RELIEF_BACKING_IN = 0.125;
export const RELIEF_SPAN_IN = 0.625;
/** Display subdivision levels applied to the solved cloth before extraction (as in the proof). */
export const CLOTH_SUBDIVISIONS = 2;

export interface ReliefArrays {
  /** Heights in metres above the panel back, rows top-down (the .mcrelief layout). */
  heightsM: Float32Array;
  /** 1 where the figure or veil is seen, 0 on the background. */
  mask: Uint8Array;
  /** 1 where the veil is the frontmost surface (empty for a bare figure). */
  veil: Uint8Array;
  depthRange: [number, number];
}

export function bareDepth(figPos: Float32Array, tris: Uint32Array, w: DepthWindow = PANEL_WINDOW): Float64Array {
  const d = emptyDepth(w); rasterizeFrontmost(figPos, tris, w, d); return d;
}

/** Frontmost depth of the figure and the subdivided cloth; `veil` marks nodes the cloth owns. */
export function veiledDepth(bare: Float64Array, cloth: Float64Array, rows: number, cols: number, w: DepthWindow = PANEL_WINDOW):
  { depth: Float64Array; veil: Uint8Array } {
  let g = { rows, cols, pos: cloth };
  for (let k = 0; k < CLOTH_SUBDIVISIONS; k++) g = subdivideGrid(g);
  const depth = bare.slice(), veil = new Uint8Array(w.cols * w.rows);
  rasterizeFrontmost(g.pos, gridTriangles(g.rows, g.cols), w, depth, veil, 1);
  return { depth, veil };
}

/** Linear relief: `lo` (the deepest visible point, figure or veil) to the frontmost point spans
 *  RELIEF_SPAN_IN. Veil hanging behind the figure's deepest point beside it would otherwise map below the
 *  backing, and below 0 (a rejected relief master) when it hangs far enough back. */
export function reliefHeights(depth: Float64Array, bare: Float64Array, veil?: Uint8Array): ReliefArrays {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < bare.length; k++) if (bare[k] < lo) lo = bare[k];
  for (let k = 0; k < depth.length; k++) { if (depth[k] > hi) hi = depth[k]; if (depth[k] < lo) lo = depth[k]; }
  if (!(hi > lo)) throw new Error('nothing of the figure is inside the panel');
  const IN = 0.0254, back = RELIEF_BACKING_IN * IN, span = RELIEF_SPAN_IN * IN;
  const heightsM = new Float32Array(depth.length), mask = new Uint8Array(depth.length);
  for (let k = 0; k < depth.length; k++) {
    const d = depth[k];
    if (Number.isFinite(d)) { heightsM[k] = back + span * (d - lo) / (hi - lo); mask[k] = 1; } else heightsM[k] = back;
  }
  return { heightsM, mask, veil: veil ?? new Uint8Array(depth.length), depthRange: [lo, hi] };
}

export interface DrapeRun {
  relief: ReliefArrays;
  cloth: Float64Array; clothRows: number; clothCols: number;
  bare: Float64Array; veiled: Float64Array;
  seconds: number; lastFrameMotion: number; completed: boolean;
}

/** Drape the figure tipped back by `tiltDeg` and extract its relief. `onFrame` may return false to stop
 *  (the result is then marked incomplete and should be discarded by the caller). */
export function drapeFigure(J: Jolt, fig: Figure, tiltDeg: number, params: ClothParams,
  onFrame?: (frame: number, frames: number) => boolean | void): DrapeRun {
  const pos = tiltFigure(fig, tiltDeg);
  let completed = true;
  const res = simulateCloth(J, pos, fig.triangles, params, (f, n) => {
    if (onFrame && onFrame(f, n) === false) { completed = false; return false; }
    return true;
  });
  const bare = bareDepth(pos, fig.triangles);
  const { depth, veil } = veiledDepth(bare, res.positions, res.rows, res.cols);
  return { relief: reliefHeights(depth, bare, veil), cloth: res.positions, clothRows: res.rows, clothCols: res.cols,
    bare, veiled: depth, seconds: res.seconds, lastFrameMotion: res.lastFrameMotion, completed };
}
