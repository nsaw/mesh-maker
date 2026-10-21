/** Shortest-diagonal quad split: returns true when z00-z11 diagonal has smaller
 *  Z-difference than z10-z01, meaning callers should split along z00-z11.
 *  z00=(j,i)  z10=(j,i+1)  z01=(j+1,i)  z11=(j+1,i+1) */
export function preferZ00Z11Diagonal(z00: number, z10: number, z01: number, z11: number): boolean {
  return Math.abs(z00 - z11) < Math.abs(z10 - z01);
}

/** Returns the two triangles for a grid cell as flat index offsets from the
 *  cell's top-left corner (0 = (j,i), 1 = (j,i+1), cols = (j+1,i), cols+1 = (j+1,i+1)).
 *  CCW winding for +Z upward normals. */
export function cellTriangleOffsets(
  useZ00Z11: boolean, cols: number,
): [[number, number, number], [number, number, number]] {
  return useZ00Z11
    ? [[0, 1, cols + 1], [0, cols + 1, cols]]
    : [[0, 1, cols], [1, cols + 1, cols]];
}

/** Minimum material under every surface vertex, and minimum stock, when the export is
 *  watertight. The exporter builds the bottom face at z=0, so a top vertex at 0 collapses the side
 *  walls into degenerate triangles. One constant shared by mesh.ts and export.ts: two copies of
 *  this floor would let the viewport and the exported geometry disagree. */
export const MIN_WATERTIGHT_THICKNESS = 0.01;

/** Rec. 709 luma weights. Depth maps are grayscale (R = G = B, so luma matches the old red-channel
 *  read to within float rounding, ~1e-16); color photos keep the detail a red-only read discarded. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/** Bilinear sample of RGBA pixels into a rows x cols grid of luma in [0, 1]. Pure (no DOM): the
 *  canvas read stays with the caller. Bilinear, not nearest: nearest stair-stepped low-res
 *  sources and forced heavy smoothing.
 *
 *  Grid row j is world Y = j / (rows - 1) x meshY in every export (STL/OBJ/3DM vertices, SBP
 *  toolpaths), and world Y grows away from the machine front. Grid row 0 therefore samples the
 *  BOTTOM image row: mapping the image's top row to Y = 0 (as before 2026-10-19) carved a
 *  vertically mirrored copy of every depth map. */
export function sampleLumaGrid(
  data: Uint8ClampedArray, imgW: number, imgH: number,
  cols: number, rows: number,
): number[][] {
  const luma = (idx: number): number =>
    LUMA_R * data[idx] + LUMA_G * data[idx + 1] + LUMA_B * data[idx + 2];
  const grid: number[][] = [];
  for (let j = 0; j < rows; j++) {
    grid[j] = [];
    const fy = ((rows - 1 - j) / (rows - 1)) * (imgH - 1);
    const iy0 = Math.min(Math.floor(fy), imgH - 1);
    const iy1 = Math.min(iy0 + 1, imgH - 1);
    const ty = fy - iy0;
    for (let i = 0; i < cols; i++) {
      const fx = (i / (cols - 1)) * (imgW - 1);
      const ix0 = Math.min(Math.floor(fx), imgW - 1);
      const ix1 = Math.min(ix0 + 1, imgW - 1);
      const tx = fx - ix0;
      const p00 = luma((iy0 * imgW + ix0) * 4);
      const p10 = luma((iy0 * imgW + ix1) * 4);
      const p01 = luma((iy1 * imgW + ix0) * 4);
      const p11 = luma((iy1 * imgW + ix1) * 4);
      const top = p00 * (1 - tx) + p10 * tx;
      const bot = p01 * (1 - tx) + p11 * tx;
      grid[j][i] = (top * (1 - ty) + bot * ty) / 255;
    }
  }
  return grid;
}

// Ranges below this are rounding, not image contrast: luma of a constant gray image varies by
// ~2e-16 across bilinear samples, and stretching that to [0, 1] carved full relief from a flat
// input. One 8-bit level is 1/255 = 3.9e-3, so 1e-9 cannot swallow real contrast.
const FLAT_RANGE_EPS = 1e-9;

/** Min-max normalize a grid to [0, 1] in place. A flat grid (range below FLAT_RANGE_EPS) maps to 0. */
export function normalizeGrid(grid: number[][], rows: number, cols: number): void {
  const [mn, mx] = gridMinMax(grid, rows, cols);
  const range = mx - mn;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++)
      grid[j][i] = range > FLAT_RANGE_EPS ? (grid[j][i] - mn) / range : 0;
}

/** Flatten everything at or below `cutoff` (normalized height) to 0 and stretch the rest back to
 *  [0, 1], so a figure on a deep background claims the cut depth instead of the background step.
 *  `cutoff <= 0` is the identity (values untouched). Operates in place on a normalized grid. */
export function applyBackgroundCutoff(grid: number[][], rows: number, cols: number, cutoff: number): void {
  if (!(cutoff > 0)) return;
  const c = Math.min(cutoff, 0.99);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const v = grid[j][i];
      grid[j][i] = v <= c ? 0 : (v - c) / (1 - c);
    }
}

/** Find min and max values in a 2D grid. */
export function gridMinMax(grid: number[][], rows: number, cols: number): [number, number] {
  let min = Infinity, max = -Infinity;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (grid[j][i] < min) min = grid[j][i];
      if (grid[j][i] > max) max = grid[j][i];
    }
  return [min, max];
}

/** Weighted 3x3 kernel smoothing (center 4, edge 2, corner 1), `iterations` passes at
 *  `strength` lerp. Used by the noise and depth-map smoothing in mesh.ts. */
export function weightedSmooth(verts: number[][], rows: number, cols: number, iterations: number, strength: number): number[][] {
  let sm = verts;
  for (let iter = 0; iter < iterations; iter++) {
    const nv: number[][] = [];
    for (let j = 0; j < rows; j++) {
      nv[j] = [];
      for (let i = 0; i < cols; i++) {
        let ws = 0, tw = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const nj = j + dj, ni = i + di;
          if (nj >= 0 && nj < rows && ni >= 0 && ni < cols) {
            const w = (dj === 0 && di === 0) ? 4 : (dj === 0 || di === 0) ? 2 : 1;
            ws += sm[nj][ni] * w; tw += w;
          }
        }
        nv[j][i] = sm[j][i] * (1 - strength) + (ws / tw) * strength;
      }
    }
    sm = nv;
  }
  return sm;
}
