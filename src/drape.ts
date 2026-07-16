/**
 * Drape compositor — BLEND mode's fabric-over-form model.
 *
 * Composition (see generateDepthMapMesh in mesh.ts):
 *   envelope = closeGrid(dm, r)                  — tension bridging: cloth spans concavities
 *   base     = lerp(dm, envelope, tension)       — membrane between hug (0) and bridge (1)
 *   folds    = contourFolds(base) · slopeMask    — catenary wrinkles along iso-contours,
 *                                                  damped where the form is steep (taut)
 *   h        = max(base + thickness + folds, dm) — no-penetration constraint
 *
 * All functions are pure grid → grid transforms with no DOM or STATE access.
 */
import { weightedSmooth } from './geometry';
import { SimplexNoiseGen } from './noise/generators';

// Fold-warp noise frequency (per grid-normalized unit). Low — folds should meander
// gently, not jitter.
const FOLD_WARP_NOISE_FREQUENCY = 3.0;
// Post-close smoothing that rounds the envelope's max-filter plateaus into fabric-like
// curvature. Two passes at 0.5 ≈ a gentle gaussian without melting the bridged shape.
const CLOSE_SMOOTH_ITERATIONS = 2;
const CLOSE_SMOOTH_STRENGTH = 0.5;
// Fold sharpening exponent — pow(1 − |sin φ|, k). Higher = narrower crease ridges.
const FOLD_SHARPEN_EXPONENT = 1.5;

/** Morphological closing: separable max-filter (window 2·radiusCells+1, horizontal then
 *  vertical) followed by a light smooth. This is the "shrinkwrap envelope" a taut fabric
 *  would form over the grid — peaks preserved, concavities bridged. radiusCells ≤ 0
 *  returns the input unchanged. */
export function closeGrid(grid: number[][], rows: number, cols: number, radiusCells: number): number[][] {
  const r = Math.max(0, Math.floor(radiusCells));
  if (r === 0) return grid;
  // Horizontal max pass.
  const hmax: number[][] = [];
  for (let j = 0; j < rows; j++) {
    hmax[j] = [];
    for (let i = 0; i < cols; i++) {
      let m = -Infinity;
      const i0 = Math.max(0, i - r);
      const i1 = Math.min(cols - 1, i + r);
      for (let k = i0; k <= i1; k++) if (grid[j][k] > m) m = grid[j][k];
      hmax[j][i] = m;
    }
  }
  // Vertical max pass.
  const vmax: number[][] = [];
  for (let j = 0; j < rows; j++) {
    vmax[j] = [];
    const j0 = Math.max(0, j - r);
    const j1 = Math.min(rows - 1, j + r);
    for (let i = 0; i < cols; i++) {
      let m = -Infinity;
      for (let k = j0; k <= j1; k++) if (hmax[k][i] > m) m = hmax[k][i];
      vmax[j][i] = m;
    }
  }
  return weightedSmooth(vmax, rows, cols, CLOSE_SMOOTH_ITERATIONS, CLOSE_SMOOTH_STRENGTH);
}

/** Per-pixel fold damping from the base grid's gradient: 1 on flat/level fabric (folds
 *  bunch up), → 0 where the form is steep (fabric pulled taut over an edge). Gradient is
 *  central-difference, normalized against the grid's own max gradient. */
export function slopeMask(grid: number[][], rows: number, cols: number): number[][] {
  const g: number[][] = [];
  let gMax = 1e-9;
  for (let j = 0; j < rows; j++) {
    g[j] = [];
    for (let i = 0; i < cols; i++) {
      const jm = Math.max(0, j - 1);
      const jp = Math.min(rows - 1, j + 1);
      const im = Math.max(0, i - 1);
      const ip = Math.min(cols - 1, i + 1);
      const gx = (grid[j][ip] - grid[j][im]) * 0.5;
      const gy = (grid[jp][i] - grid[jm][i]) * 0.5;
      const mag = Math.hypot(gx, gy);
      g[j][i] = mag;
      if (mag > gMax) gMax = mag;
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      g[j][i] = 1 - Math.min(1, g[j][i] / gMax);
    }
  }
  return g;
}

/** Contour-following fold field in [-0.5, 0.5]. Fold phase runs along iso-contours of the
 *  base grid (φ ∝ base height), so wrinkles wrap the form the way catenary folds follow a
 *  draped surface. foldScale = number of fold cycles across the height range; foldWarp
 *  meanders the fold lines with low-frequency noise so they read as fabric, not machine-
 *  turned rings. */
export function contourFolds(
  base: number[][],
  rows: number,
  cols: number,
  foldScale: number,
  foldWarp: number,
  seed: number,
): number[][] {
  const warpGen = foldWarp > 0 ? new SimplexNoiseGen((seed >>> 0) + 101) : null;
  const out: number[][] = [];
  for (let j = 0; j < rows; j++) {
    out[j] = [];
    const v = j / Math.max(1, rows - 1);
    for (let i = 0; i < cols; i++) {
      const u = i / Math.max(1, cols - 1);
      let phase = base[j][i] * foldScale * 2 * Math.PI;
      if (warpGen) {
        phase += warpGen.noise(u * FOLD_WARP_NOISE_FREQUENCY, v * FOLD_WARP_NOISE_FREQUENCY)
          * foldWarp * 2 * Math.PI;
      }
      // 1 − |sin| creases at each phase multiple of π; sharpen and center on 0.
      const crease = Math.pow(1 - Math.abs(Math.sin(phase)), FOLD_SHARPEN_EXPONENT);
      out[j][i] = crease - 0.5;
    }
  }
  return out;
}
