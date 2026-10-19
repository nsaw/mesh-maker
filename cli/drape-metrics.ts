/**
 * Fold-structure metrics shared by cli/drape.spec.ts and cli/drape-physics.spec.ts. Same
 * definitions as the 2026-10-19 review (scratchpad orient.py), so thresholds carry over.
 */
import { gaussianBlur } from '../src/drape';

function grad(a: Float64Array, rows: number, cols: number, j: number, i: number): [number, number] {
  const ip = Math.min(cols - 1, i + 1), im = Math.max(0, i - 1), jp = Math.min(rows - 1, j + 1), jm = Math.max(0, j - 1);
  return [(a[j * cols + ip] - a[j * cols + im]) / 2, (a[jp * cols + i] - a[jm * cols + i]) / 2];
}

/** Energy-weighted cos^2 between the fold field's gradient and the gradient of the form blurred at
 *  8 cells. 1 = crests follow contour lines, 0 = crests run across them, 0.5 = isotropic. */
export function contourAlignment(fold: Float64Array, form: Float64Array, rows: number, cols: number): number {
  const ref = gaussianBlur(form, rows, cols, 8);
  let rmax = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) rmax = Math.max(rmax, Math.hypot(...grad(ref, rows, cols, j, i)));
  let num = 0, den = 0;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const [fx, fy] = grad(fold, rows, cols, j, i), [rx, ry] = grad(ref, rows, cols, j, i);
      const rm = Math.hypot(rx, ry), fm = fx * fx + fy * fy;
      if (rm > 0.02 * rmax) { num += ((fx * rx + fy * ry) ** 2) / (rm * rm + 1e-30); den += fm; }
    }
  return den > 0 ? num / den : 0.5;
}

/** Fraction of fold-gradient energy along x: 1 = crests run vertically (down the image). */
export function verticalCrest(fold: Float64Array, rows: number, cols: number): number {
  let vx = 0, vt = 0;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) { const [fx, fy] = grad(fold, rows, cols, j, i); vx += fx * fx; vt += fx * fx + fy * fy; }
  return vt > 0 ? vx / vt : 0.5;
}

export function skewness(a: Float64Array): number {
  let m = 0; for (const v of a) m += v; m /= a.length;
  let m2 = 0, m3 = 0; for (const v of a) { m2 += (v - m) ** 2; m3 += (v - m) ** 3; }
  m2 /= a.length; m3 /= a.length;
  return m2 > 0 ? m3 / m2 ** 1.5 : 0;
}

/** RMS difference after removing the mean offset, over cells inside `margin` of the border. */
export function rmsAfterOffset(a: Float64Array, b: Float64Array, rows: number, cols: number, margin: number): number {
  let mean = 0, n = 0;
  for (let j = margin; j < rows - margin; j++) for (let i = margin; i < cols - margin; i++) { mean += a[j * cols + i] - b[j * cols + i]; n++; }
  mean /= n;
  let s = 0;
  for (let j = margin; j < rows - margin; j++) for (let i = margin; i < cols - margin; i++) s += (a[j * cols + i] - b[j * cols + i] - mean) ** 2;
  return Math.sqrt(s / n);
}

/** Hemispherical domes [cx, cy, r] in normalized panel coords; max height 1. */
export function domes(rows: number, cols: number, list: [number, number, number][]): Float64Array {
  const f = new Float64Array(rows * cols);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x = i / (cols - 1), y = j / (rows - 1);
      let h = 0;
      for (const [cx, cy, r] of list) {
        const d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
        if (d2 < 1) h = Math.max(h, Math.sqrt(1 - d2));
      }
      f[j * cols + i] = h;
    }
  return f;
}
