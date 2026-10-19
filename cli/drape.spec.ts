/**
 * Deterministic verification of the Blend drape compositor (src/drape.ts) and its CNC mapping.
 * Run: npm run test:drape  (or: npx tsx cli/drape.spec.ts)
 *
 * Each block pins one finding from the 2026-10-19 review of the previous compositor:
 *   T1  no peak inflation (old: square max-filter dilation, impulse r=3 -> 121 px)
 *   T2  thickness survives the CNC mapping at peaks (old: clamp to 1 before offset, 0.000 in)
 *   T3  thickness does not move folds (old: +0.005 in moved 27.5% of vertices)
 *   T4  fold strength is local (old: one global-max slope mask; a distant spike flipped 0 -> 0.999)
 *   T5  Detail Transmission acts at any smoothing (old: no-op at dmSmoothing 0)
 *   T6  Fold Spacing is a physical spacing (old: "Fold Count 12" gave ~24 height-phase creases)
 *   T7  fold orientation crosses contours / follows gravity (old: contour rings, cos^2 0.81)
 * plus profile skew, determinism, bounds, timing, solver convergence, luma, cutoff, share links,
 * machinability, and the SBP toolpath path.
 *
 * Orientation thresholds come from a PBD cloth simulation run during the review (scratchpad
 * sim.ts/orient.py, 128x128 grid): dome contour cos^2 0.100, two domes 0.232; tilted + pinned
 * vertical-crest 0.960. The physics comparison itself runs in cli/drape-physics.spec.ts.
 */

import { composeDrape, drapeToStockHeights, foldDirection, gaussianBlur, solveMembrane, tensionToCurvature } from '../src/drape';
import type { DrapeParams } from '../src/drape';
import { applyBackgroundCutoff, normalizeGrid, sampleLumaGrid } from '../src/geometry';
import { DEFAULTS, STATE, deserializeConfig, serializeConfig } from '../src/state';
import { getDefaultConfig, getDefaultFinishingTool } from '../src/sbp/tools';
import { contourAlignment, domes, skewness, verticalCrest } from './drape-metrics';
import { stateToHeightmap } from '../src/sbp/heightmap';
import { generateSBP } from '../src/sbp/generate';

let failures = 0;
function assert(condition: boolean, label: string, detail = ''): void {
  if (condition) {
    process.stdout.write(`  ok  ${label}${detail ? ` (${detail})` : ''}\n`);
  } else {
    process.stdout.write(`  FAIL ${label}${detail ? `: ${detail}` : ''}\n`);
    failures++;
  }
}

// ---------- fixtures ----------

const PANEL_X = 16;

function params(rows: number, cols: number, overrides: Partial<DrapeParams> = {}): DrapeParams {
  return {
    cols, rows,
    dxIn: PANEL_X / (cols - 1),
    formDepthIn: 0.75,
    thicknessIn: DEFAULTS.drapeThickness,
    tension: DEFAULTS.blend,
    conform: DEFAULTS.drapeConform,
    foldSpacingIn: DEFAULTS.drapeFoldSpacing,
    foldAmpIn: DEFAULTS.drapeFoldAmp,
    foldLength: DEFAULTS.drapeFoldLength,
    hang: DEFAULTS.drapeHang,
    gravityAngleDeg: DEFAULTS.drapeGravityAngle,
    seed: 7,
    ...overrides,
  };
}

/** Deterministic face-like relief: a head ellipsoid with brow, nose and cheek bumps and fine
 *  0.1 in-scale texture, normalized to 0..1. Stands in for a depth map at production size. */
function faceRelief(rows: number, cols: number): Float64Array {
  const f = new Float64Array(rows * cols);
  const bump = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) =>
    Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
  let mx = 0;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x = i / (cols - 1), y = j / (rows - 1);
      const e = ((x - 0.5) / 0.28) ** 2 + ((y - 0.38) / 0.3) ** 2;
      let h = e < 1 ? Math.sqrt(1 - e) : 0;
      h += 0.15 * bump(x, y, 0.5, 0.42, 0.03, 0.08) + 0.08 * bump(x, y, 0.4, 0.3, 0.07, 0.02)
         + 0.08 * bump(x, y, 0.6, 0.3, 0.07, 0.02) + 0.06 * bump(x, y, 0.38, 0.47, 0.06, 0.05)
         + 0.06 * bump(x, y, 0.62, 0.47, 0.06, 0.05) - 0.07 * bump(x, y, 0.42, 0.34, 0.035, 0.02)
         - 0.07 * bump(x, y, 0.58, 0.34, 0.035, 0.02);
      h += 0.01 * Math.sin(i * 0.9) * Math.sin(j * 0.7);
      f[j * cols + i] = Math.max(0, h);
      if (f[j * cols + i] > mx) mx = f[j * cols + i];
    }
  for (let k = 0; k < f.length; k++) f[k] /= mx;
  return f;
}

/** Demo-like depth map: an elliptical figure on a dark background with sparse one-pixel specks.
 *  Its noisy contact pattern makes the solver as slow as the real demo (T11) and exposes the
 *  coarse-level plateau defect (T12b). */
function speckledRelief(rows: number, cols: number): Float64Array {
  const f = new Float64Array(rows * cols);
  let seed = 99; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = i / (cols - 1) - 0.5, y = (j / (rows - 1) - 0.62) * 1.5, e = x * x / 0.08 + y * y / 0.1;
    f[j * cols + i] = e < 1 ? Math.sqrt(1 - e) : 0;
  }
  for (let k = 0; k < f.length; k++) if (rnd() < 0.002) f[k] = Math.min(1, f[k] + 0.3 + 0.5 * rnd());
  return f;
}

function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0; for (let k = 0; k < a.length; k++) d = Math.max(d, Math.abs(a[k] - b[k])); return d;
}

// ---------- T1 no inflation ----------
process.stdout.write('T1 no peak inflation\n');
{
  const n = 64, f = new Float64Array(n * n);
  f[32 * n + 32] = 1;
  const p = params(n, n, { conform: 1, thicknessIn: 0, foldAmpIn: 0 });
  const r = composeDrape(f, p);
  const peak = Math.max(...r.membrane);
  let atPeak = 0; for (const v of r.membrane) if (v >= peak - 1e-4) atPeak++;
  assert(atPeak <= 1, 'impulse: membrane plateau no wider than the original peak', `${atPeak} px at peak height`);
  assert(peak <= Math.max(...r.obstacle) + 1e-12, 'membrane never rises above the highest support');
  const ramp = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) ramp[j * n + i] = i / (n - 1);
  const rr = composeDrape(ramp, p);
  assert(maxAbsDiff(rr.membrane, rr.obstacle) < 1e-9, 'linear ramp: membrane lies on the form everywhere, edges included',
    `max gap ${maxAbsDiff(rr.membrane, rr.obstacle).toExponential(2)} in`);
}

// ---------- T2 clearance at peaks ----------
process.stdout.write('T2 thickness survives the CNC mapping\n');
{
  const n = 101, f = domes(n, n, [[0.5, 0.5, 0.4]]);
  const p = params(n, n, { foldAmpIn: 0, conform: 1, thicknessIn: 0.03 });
  const r = composeDrape(f, p);
  const bt = 0.75, cut = 0.75;
  const z = drapeToStockHeights(r.surface, n, n, bt, cut, 0, 0);
  // Form placed the same way the surface is (same overflow shift).
  const top = Math.max(...r.surface), overflow = Math.max(0, (bt - cut) + top - bt);
  const formZ = (j: number, i: number) => (bt - cut) + f[j * n + i] * cut - overflow;
  const peakClr = z[50][50] - formZ(50, 50);
  const flankClr = z[50][74] - formZ(50, 74);
  assert(Math.abs(peakClr - 0.03) < 1e-6, 'peak clearance equals thickness', `${peakClr.toFixed(6)} in`);
  assert(Math.abs(flankClr - 0.03) < 1e-6, 'flank clearance equals thickness', `${flankClr.toFixed(6)} in`);
  assert(Math.abs(Math.max(...z.flat()) - bt) < 1e-9, 'veil top meets the stock top');
  // Below conform 1 the fabric is stiff, but it must still never sit closer than its thickness to
  // the form anywhere (round-1 review: a blurred obstacle let the default veil cut into a dome).
  const narrow = domes(n, n, [[0.5, 0.5, 0.06]]);
  for (const conform of [DEFAULTS.drapeConform, 0]) {
    const rc = composeDrape(narrow, params(n, n, { foldAmpIn: 0, conform, thicknessIn: 0.03 }));
    let minClr = Infinity;
    for (let k = 0; k < narrow.length; k++) minClr = Math.min(minClr, rc.surface[k] - narrow[k] * 0.75);
    assert(minClr >= 0.03 - 1e-9, `conform ${conform}: clearance over the form never below thickness`, `min ${minClr.toFixed(6)} in`);
    const withFolds = composeDrape(narrow, params(n, n, { conform }));
    let minF = Infinity;
    for (let k = 0; k < narrow.length; k++) minF = Math.min(minF, withFolds.surface[k] - narrow[k] * 0.75);
    assert(minF >= 0.03 - 1e-9, `conform ${conform} with folds: no penetration`, `min ${minF.toFixed(6)} in`);
  }
}

// ---------- T2b fitting the veil inside the cut ----------
process.stdout.write('T2b the veil fits inside the cut without clipping the background\n');
{
  // A figure (dome) on a background with low relief bumps at 3% of the cut, the demo's situation.
  const n = 121, f = domes(n, n, [[0.5, 0.45, 0.3]]);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    if (f[k] === 0) f[k] = 0.03 * (0.5 + 0.5 * Math.sin(i * 0.6) * Math.sin(j * 0.5));
  }
  const bt = 0.75, cut = 0.75;
  const p = params(n, n, { fitDepthIn: cut });
  const r = composeDrape(f, p);
  const top = Math.max(...r.surface);
  assert(top <= cut + 0.002, 'fitted drape top within 0.002 in of the cut', `top ${top.toFixed(4)} in, cut ${cut}`);
  const z = drapeToStockHeights(r.surface, n, n, bt, cut, 0, 0.01);
  // Background corner region: its relief must survive (not be flattened onto the floor).
  let mn = Infinity, mx = -Infinity;
  for (let j = 100; j < 118; j++) for (let i = 2; i < 30; i++) { mn = Math.min(mn, z[j][i]); mx = Math.max(mx, z[j][i]); }
  assert(mn > 0.01 + 1e-9, 'background stays above the floor clamp', `min ${mn.toFixed(4)} in`);
  assert(mx - mn > 0.005, 'background relief survives', `range ${(mx - mn).toFixed(4)} in`);
  const shiftOnly = drapeToStockHeights(composeDrape(f, params(n, n)).surface, n, n, bt, cut, 0, 0.01);
  let flat = 0; for (let j = 100; j < 118; j++) for (let i = 2; i < 30; i++) if (shiftOnly[j][i] <= 0.01 + 1e-12) flat++;
  process.stdout.write(`  info: without fitting, ${flat} of ${18 * 28} background cells hit the floor\n`);
  // At the summit the cloth rests on the obstacle (exactly form + thickness), so surface - obstacle
  // is 0 and the clearance over the form is exactly the thickness.
  let summitGap = Infinity;
  for (let k = 0; k < r.surface.length; k++) if (f[k] > 0.999) summitGap = Math.min(summitGap, r.surface[k] - r.obstacle[k]);
  assert(Math.abs(summitGap) < 1e-9, 'after fitting, the summit still carries exactly the fabric thickness', `surface - obstacle ${summitGap.toExponential(2)} in`);
}

// ---------- T2c stock fit at legal extremes (GPT review round 1) ----------
process.stdout.write('T2c the fit converges at legal extremes and reports infeasibility\n');
{
  // GPT's reproduction: one fit correction overflowed by 0.0478 in and clipped 2,984 background
  // samples. The fit must now converge (top within tolerance) and leave the background alone.
  const n = 80, f = domes(n, n, [[0.5, 0.5, 0.3]]);
  const p = params(n, n, { dxIn: 16 / (n - 1), conform: 1, foldAmpIn: 0.25, seed: 7, fitDepthIn: 0.75 });
  const r = composeDrape(f, p);
  const top = Math.max(...r.surface);
  assert(r.fitOverflowIn === 0 && top <= 0.75 + 0.001, 'fold depth 0.25 in on a 0.3 dome fits the 0.75 in cut', `top ${top.toFixed(4)} in, overflow ${r.fitOverflowIn.toFixed(4)}`);
  const z = drapeToStockHeights(r.surface, n, n, 0.75, 0.75, 0, 0.01);
  let clipped = 0, bg = 0;
  for (let k = 0; k < f.length; k++) if (f[k] === 0) { bg++; if (z[Math.floor(k / n)][k % n] <= 0.01 + 1e-12) clipped++; }
  assert(clipped === 0, 'no background sample clipped to the floor', `${clipped} of ${bg}`);
  // Infeasible: thickness alone deeper than the cut. Reported, not hidden.
  const inf = composeDrape(f, params(n, n, { dxIn: 16 / (n - 1), thicknessIn: 0.2, foldAmpIn: 0.25, fitDepthIn: 0.1 }));
  assert(Math.abs(inf.fitOverflowIn - 0.1) < 1e-6 && inf.formDepthUsedIn === 0, 'fabric thicker than the cut is reported as overflow', `overflow ${inf.fitOverflowIn.toFixed(4)} in`);
  // GPT model-gap review: at fold depth 0.25 in the old fit kept 1.1% of the figure to preserve the
  // folds. The figure must keep at least 75% of the cut minus thickness; the folds give way.
  assert(r.formDepthUsedIn >= 0.75 * 0.75 - p.thicknessIn - 1e-12, 'at fold depth 0.25 in the figure keeps >= 75% of the cut',
    `form ${r.formDepthUsedIn.toFixed(4)} in, folds at ${(100 * r.foldScaleUsed).toFixed(1)}%`);
  // A broad flat-topped mesa puts the cloth in contact across the whole top, so 0.25 in folds
  // exceed the capped headroom there: they must shrink (and say so) rather than overflow.
  const mesa = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) mesa[j * n + i] = (i / (n - 1) - 0.5) ** 2 + (j / (n - 1) - 0.5) ** 2 < 0.16 ? 1 : 0;
  const rm = composeDrape(mesa, params(n, n, { dxIn: 16 / (n - 1), foldAmpIn: 0.25, seed: 7, fitDepthIn: 0.75 }));
  assert(rm.foldScaleUsed < 1 && Math.max(...rm.surface) <= 0.75 + 1e-9 && rm.formDepthUsedIn >= 0.75 * 0.75 - p.thicknessIn - 1e-12,
    'on a mesa, deep folds shrink to fit and the figure keeps its depth', `folds at ${(100 * rm.foldScaleUsed).toFixed(1)}%, top ${Math.max(...rm.surface).toFixed(4)} in`);
  const easy = composeDrape(f, params(n, n, { dxIn: 16 / (n - 1), foldAmpIn: 0.01, fitDepthIn: 0.75 }));
  assert(easy.foldScaleUsed === 1 && easy.fitOverflowIn === 0, 'folds that fit are not scaled and no overflow is reported');
  // GPT's penetration reproduction: Gaussian support, production fit, defaults. The summit must
  // carry the full thickness above the FITTED form, never sit below it.
  const rows = 600, cols = 400, g = new Float64Array(rows * cols);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const x = i / (cols - 1) - 0.5, y = (j / (rows - 1) - 0.5) * 1.5; g[j * cols + i] = Math.exp(-(x * x + y * y) / (0.2 * 0.2)); }
  const rg = composeDrape(g, params(rows, cols, { seed: 0, fitDepthIn: 0.75 }));
  let worst = Infinity;
  for (let k = 0; k < g.length; k++) worst = Math.min(worst, rg.surface[k] - g[k] * rg.formDepthUsedIn);
  assert(worst >= p.thicknessIn - 1e-9, 'Gaussian support at defaults: clearance over the fitted form never below thickness', `min ${worst.toFixed(6)} in, form laid at ${rg.formDepthUsedIn.toFixed(4)} in`);
}

// ---------- T3 thickness invariance ----------
process.stdout.write('T3 thickness does not move folds\n');
{
  const rows = 120, cols = 80, f = faceRelief(rows, cols);
  const a = composeDrape(f, params(rows, cols, { thicknessIn: 0.030 }));
  const b = composeDrape(f, params(rows, cols, { thicknessIn: 0.035 }));
  // Not bit-identical: a uniform shift perturbs the block-averaged direction blur in the last ulp.
  // 1e-9 is still ~7 orders of magnitude below the old defect (folds moved up to 0.050 in).
  assert(maxAbsDiff(a.folds, b.folds) < 1e-9, 'fold field unchanged for 0.030 vs 0.035 in', `max diff ${maxAbsDiff(a.folds, b.folds).toExponential(2)}`);
  let worst = 0, n = 0;
  for (let k = 0; k < a.surface.length; k++)
    if (a.contact[k] === 1 && b.contact[k] === 1) { worst = Math.max(worst, Math.abs(b.surface[k] - a.surface[k] - 0.005)); n++; }
  assert(n > 0 && worst < 1e-8, 'in full contact the surface rises by exactly +0.005 in', `${n} px, max error ${worst.toExponential(2)}`);
  // The production path is fitted: there the form depth depends on thickness and fold depth, and
  // fold directions taken from the fitted membrane let both sliders move the folds (pass-2 N7/N8).
  const fitted = (o: Partial<DrapeParams>) => composeDrape(f, params(rows, cols, { fitDepthIn: 0.75, ...o })).folds;
  const base = fitted({});
  assert(maxAbsDiff(base, fitted({ thicknessIn: 0.035 })) < 1e-9 && maxAbsDiff(base, fitted({ thicknessIn: 0.06 })) < 1e-9,
    'fitted: thickness 0.03 / 0.035 / 0.06 in give the same fold field', `max diff ${maxAbsDiff(base, fitted({ thicknessIn: 0.06 })).toExponential(2)}`);
  assert(maxAbsDiff(fitted({ foldAmpIn: 0.03 }), fitted({ foldAmpIn: 0.05 })) < 1e-9, 'fitted: Fold Depth does not move where the folds are');
}

// ---------- T4 slope invariance ----------
process.stdout.write('T4 fold strength is local\n');
{
  // Measure what reaches the surface (surface - membrane), not the raw fold field: the old defect
  // was a slope mask on fold AMPLITUDE, applied after the field, so a field-only check misses it.
  const rows = 160, cols = 160, flat = new Float64Array(rows * cols), plane = new Float64Array(rows * cols);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) plane[j * cols + i] = 0.1 * i / (cols - 1);
  const p = params(rows, cols, { hang: 1 });
  const contribution = (f: Float64Array): Float64Array => {
    const r = composeDrape(f, p), c = new Float64Array(f.length);
    for (let k = 0; k < c.length; k++) c[k] = r.surface[k] - r.membrane[k];
    return c;
  };
  const std = (c: Float64Array): number => {
    let m = 0, n = 0; for (let j = 20; j < rows - 20; j++) for (let i = 20; i < cols - 20; i++) { m += c[j * cols + i]; n++; }
    m /= n; let v = 0; for (let j = 20; j < rows - 20; j++) for (let i = 20; i < cols - 20; i++) v += (c[j * cols + i] - m) ** 2;
    return Math.sqrt(v / n);
  };
  const sFlat = std(contribution(flat)), sSlope = std(contribution(plane));
  assert(sFlat > 0.1 * p.foldAmpIn, 'folds reach the surface on flat ground', `std ${sFlat.toFixed(4)} in`);
  assert(Math.abs(sSlope - sFlat) / sFlat < 0.1, 'a gentle constant slope carries the same fold strength as flat ground',
    `flat ${sFlat.toFixed(4)} in, slope ${sSlope.toFixed(4)} in`);
  const spiked = plane.slice(); spiked[5 * cols + 5] = 1;
  const a = contribution(plane), b = contribution(spiked);
  // The spike's reach: membrane tent + direction blur (0.5 in) + streamline length.
  let farDelta = 0;
  for (let j = 100; j < rows - 10; j++) for (let i = 100; i < cols - 10; i++) farDelta = Math.max(farDelta, Math.abs(a[j * cols + i] - b[j * cols + i]));
  assert(farDelta < 0.05 * p.foldAmpIn, 'a distant spike leaves far fold heights essentially unchanged', `max delta ${farDelta.toExponential(2)} in`);
}

// ---------- T5 Detail Transmission ----------
process.stdout.write('T5 Detail Transmission acts at any smoothing\n');
{
  const rows = 120, cols = 120, f = new Float64Array(rows * cols);
  // Base dome plus 0.1 in-wide ridges (0.6 in period) across it.
  const d = domes(rows, cols, [[0.5, 0.5, 0.45]]);
  for (let k = 0; k < f.length; k++) { const i = k % cols; f[k] = d[k] * (0.9 + 0.1 * Math.max(0, Math.sin(i * 2 * Math.PI * (PANEL_X / (cols - 1)) / 0.6))); }
  const hi = composeDrape(f, params(rows, cols, { conform: 1, foldAmpIn: 0 }));
  const mid = composeDrape(f, params(rows, cols, { conform: 0.5, foldAmpIn: 0 }));
  const lo = composeDrape(f, params(rows, cols, { conform: 0, foldAmpIn: 0 }));
  assert(maxAbsDiff(hi.surface, lo.surface) > 0.01, 'silk vs felt differ by more than 0.01 in', `${maxAbsDiff(hi.surface, lo.surface).toFixed(4)} in`);
  const hp = (s: Float64Array) => { const b = gaussianBlur(s, rows, cols, 3); let e = 0; for (let k = 0; k < s.length; k++) e += (s[k] - b[k]) ** 2; return e; };
  assert(hp(hi.surface) > hp(mid.surface) && hp(mid.surface) > hp(lo.surface), 'fine-detail energy rises monotonically with transmission');
}

// ---------- T6 spacing ----------
process.stdout.write('T6 Fold Spacing is physical\n');
{
  const rows = 200, cols = 200, plane = new Float64Array(rows * cols);
  const spacing = 0.6;
  const r = composeDrape(plane, params(rows, cols, { hang: 1, foldSpacingIn: spacing, foldLength: 6 }));
  // Count local maxima across x on the middle rows; mean distance between crests.
  let crests = 0, rowsCounted = 0;
  for (let j = 60; j < 140; j += 4) {
    for (let i = 1; i < cols - 1; i++) { const v = r.folds[j * cols + i]; if (v > r.folds[j * cols + i - 1] && v >= r.folds[j * cols + i + 1] && v > 0) crests++; }
    rowsCounted++;
  }
  const meanSpacing = (PANEL_X * rowsCounted) / crests;
  assert(Math.abs(meanSpacing - spacing) / spacing < 0.25, 'mean crest spacing within 25% of Fold Spacing', `${meanSpacing.toFixed(3)} in vs ${spacing}`);
}

// ---------- T7 orientation ----------
process.stdout.write('T7 fold orientation\n');
{
  const n = 128;
  const dome = domes(n, n, [[0.5, 0.5, 0.22]]);
  const two = domes(n, n, [[0.3, 0.5, 0.16], [0.7, 0.5, 0.16]]);
  const pr = (o: Partial<DrapeParams>) => params(n, n, { dxIn: 1 / (n - 1) * PANEL_X, foldSpacingIn: 6 * PANEL_X / (n - 1), ...o });
  const cd = contourAlignment(composeDrape(dome, pr({ hang: 0 })).folds, dome, n, n);
  const c2 = contourAlignment(composeDrape(two, pr({ hang: 0 })).folds, two, n, n);
  assert(cd <= 0.20, 'pressed (hang 0) on a dome: folds cross the contours', `cos^2 ${cd.toFixed(3)} (sim 0.100, old 0.81)`);
  assert(c2 <= 0.30, 'pressed (hang 0) on two domes: folds cross the contours', `cos^2 ${c2.toFixed(3)} (sim 0.232, old 0.86)`);
  const flat = new Float64Array(n * n);
  const vh = verticalCrest(composeDrape(flat, pr({ hang: 1 })).folds, n, n);
  assert(vh >= 0.90, 'hanging on flat ground: crests run down the image', `vertical ${vh.toFixed(3)}`);
  const hz = 1 - verticalCrest(composeDrape(flat, pr({ hang: 1, gravityAngleDeg: 90 })).folds, n, n);
  assert(hz >= 0.90, 'gravity 90 deg: crests run across the image', `horizontal ${hz.toFixed(3)}`);
}

// ---------- T8 profile ----------
process.stdout.write('T8 fold profile\n');
{
  const rows = 160, cols = 160;
  const r = composeDrape(faceRelief(rows, cols), params(rows, cols));
  const sk = skewness(r.folds);
  assert(sk >= 0.2 && sk <= 1.0, 'fold field skews toward sharp-topped ridges', `skew ${sk.toFixed(3)} (sim +0.56)`);
}

// ---------- T9 determinism ----------
process.stdout.write('T9 determinism\n');
{
  const rows = 90, cols = 60, f = faceRelief(rows, cols);
  const a = composeDrape(f, params(rows, cols, { seed: 3 }));
  const b = composeDrape(f, params(rows, cols, { seed: 3 }));
  const c = composeDrape(f, params(rows, cols, { seed: 4 }));
  assert(maxAbsDiff(a.surface, b.surface) === 0, 'same seed reproduces bit for bit');
  assert(maxAbsDiff(a.surface, c.surface) > 1e-4, 'a different seed changes the folds');
}

// ---------- T10 bounds sweep ----------
process.stdout.write('T10 bounds across slider extremes\n');
{
  let s = 12345; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const rows = 48, cols = 32, f = faceRelief(rows, cols);
  let bad = 0, badFit = 0, cases = 0;
  for (let c = 0; c < 200; c++) {
    const pick = (lo: number, hi: number) => (rnd() < 0.2 ? (rnd() < 0.5 ? lo : hi) : lo + (hi - lo) * rnd());
    const bt = pick(0.05, 6), cut = Math.min(pick(0, 6), bt), floor = rnd() < 0.5 ? 0.01 : 0;
    const p = params(rows, cols, {
      dxIn: pick(1, 96) / (cols - 1), formDepthIn: cut, thicknessIn: pick(0, 0.2), tension: pick(0, 1),
      conform: pick(0, 1), foldSpacingIn: pick(0.25, 3), foldAmpIn: pick(0, 0.25), foldLength: pick(1, 12),
      hang: pick(0, 1), gravityAngleDeg: pick(-180, 180), seed: Math.floor(rnd() * 99999),
    });
    const r = composeDrape(f, { ...p, fitDepthIn: cut });
    const z = drapeToStockHeights(r.surface, rows, cols, bt, cut, pick(-1, 1), floor);
    for (const row of z) for (const v of row) if (!Number.isFinite(v) || v < floor - 1e-12 || v > bt + 1e-12) bad++;
    // Before the final clamp: the fit either holds (top within tolerance of the cut) or reports
    // exactly how far it overflows.
    const top = Math.max(...r.surface);
    if (r.fitOverflowIn === 0 ? top > cut + 0.001 + 1e-12 : Math.abs(top - cut - r.fitOverflowIn) > 1e-9) badFit++;
    cases++;
  }
  assert(bad === 0, `${cases} randomized cases stay finite and inside [floor, bt]`, `${bad} bad vertices`);
  assert(badFit === 0, `${cases} randomized fitted cases fit the cut or report the overflow exactly`, `${badFit} bad cases`);
}

// ---------- T11 timing ----------
process.stdout.write('T11 production-size timing\n');
{
  // The production path, fitted into the cut, on the demo-like speckled fixture (a smooth fixture
  // ran ~370 ms faster than the real demo and would hide a solver slowdown). Tension 0 is the slow
  // end. The product budget is 1 s per generation in the browser on the development Mac; CI runners
  // are slower and shared, so CI enforces a 4 s gross-regression bound and prints the time.
  const budget = process.env.CI ? 4000 : 1000;
  const rows = 600, cols = 400, f = speckledRelief(rows, cols);
  const p = params(rows, cols, { fitDepthIn: 0.75 });
  composeDrape(f, p);                                  // warm-up (JIT)
  for (const tension of [DEFAULTS.blend, 0]) {
    const t0 = performance.now();
    composeDrape(f, { ...p, tension });
    const ms = performance.now() - t0;
    assert(ms < budget, `composeDrape (fitted) at 400x600, tension ${tension}, under ${budget} ms`, `${ms.toFixed(0)} ms`);
  }
}

// ---------- T12 convergence ----------
process.stdout.write('T12 membrane solver convergence\n');
{
  // Two domes far apart force a long bridged span, the slow mode for any membrane solver.
  const rows = 300, cols = 200, f = domes(rows, cols, [[0.25, 0.5, 0.18], [0.75, 0.5, 0.18]]);
  const p = params(rows, cols, { tension: 1 });
  const obstacle = new Float64Array(f.length);
  for (let k = 0; k < f.length; k++) obstacle[k] = f[k] * p.formDepthIn + p.thicknessIn;
  const sag = tensionToCurvature(p.tension) * p.dxIn * p.dxIn / 4;
  const fast = solveMembrane(obstacle, rows, cols, sag);
  // Independent reference: single-grid projected SOR started from the bare obstacle (no coarse
  // levels, no shared starting guess), run until a full sweep moves nothing by more than 1e-12.
  const ref = obstacle.slice();
  let sweeps = 0, moved = 1;
  for (; sweeps < 200000 && moved > 1e-12; sweeps++) {
    moved = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = j * cols + i, c = ref[k];
      const l = i > 0 ? ref[k - 1] : 2 * c - ref[k + 1], r = i < cols - 1 ? ref[k + 1] : 2 * c - ref[k - 1];
      const u = j > 0 ? ref[k - cols] : 2 * c - ref[k + cols], d = j < rows - 1 ? ref[k + cols] : 2 * c - ref[k - cols];
      const v = Math.max(obstacle[k], c + 1.95 * (0.25 * (l + r + u + d) - sag - c));
      moved = Math.max(moved, Math.abs(v - c)); ref[k] = v;
    }
  }
  assert(moved <= 1e-12, 'reference solve converged', `${sweeps} sweeps, last move ${moved.toExponential(1)}`);
  let lifted = 0; for (let k = 0; k < ref.length; k++) if (ref[k] - obstacle[k] > 0.01) lifted++;
  assert(lifted > ref.length * 0.05, 'fixture actually bridges (reference lifts off > 5% of cells)', `${(100 * lifted / ref.length).toFixed(1)}%`);
  const err = maxAbsDiff(fast, ref);
  assert(err <= 0.005, 'coarse-to-fine PSOR within 0.005 in of the independent reference', `${err.toFixed(5)} in`);
}

// ---------- T12b solver on speckled input (the real failure mode) ----------
process.stdout.write('T12b membrane solver on a speckled depth map\n');
{
  // Depth maps carry one-pixel specks. A 2x2 MAX restriction grew each into a plateau per coarse
  // level and left 0.22 in of error on the demo at the default tension; the smooth domes of T12
  // never showed it. Face relief plus 0.5% one-pixel spikes, against an independent SOR reference.
  // Production size: the plateau effect grows with the number of coarse levels (six at 400x600;
  // a 200x300 grid with four levels did not separate max from average restriction).
  const rows = 600, cols = 400, f = speckledRelief(rows, cols);
  // Measured at the default (0.48/in) and at tension 1 (0.3/in): max restriction 0.052 / 0.081 in,
  // average 0.010 / 0.028 in (residual long-wavelength error, documented at PSOR_SWEEPS).
  for (const [tension, bound] of [[DEFAULTS.blend, 0.02], [1, 0.05]] as [number, number][]) {
    const p = params(rows, cols, { tension });
    const obstacle = new Float64Array(f.length);
    for (let k = 0; k < f.length; k++) obstacle[k] = f[k] * p.formDepthIn + p.thicknessIn;
    const sag = tensionToCurvature(tension) * p.dxIn * p.dxIn / 4;
    const fast = solveMembrane(obstacle, rows, cols, sag);
    // Independent: start from the bare obstacle, not from `fast` (a reference seeded with the
    // answer only proves the answer is a fixed point).
    const ref = obstacle.slice();
    let moved = 1, sweeps = 0;
    for (; sweeps < 200000 && moved > 1e-11; sweeps++) {
      moved = 0;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const k = j * cols + i, c = ref[k];
        const l = i > 0 ? ref[k - 1] : 2 * c - ref[k + 1], r = i < cols - 1 ? ref[k + 1] : 2 * c - ref[k - 1];
        const u = j > 0 ? ref[k - cols] : 2 * c - ref[k + cols], d = j < rows - 1 ? ref[k + cols] : 2 * c - ref[k - cols];
        const v = Math.max(obstacle[k], c + 1.95 * (0.25 * (l + r + u + d) - sag - c));
        moved = Math.max(moved, Math.abs(v - c)); ref[k] = v;
      }
    }
    const err = maxAbsDiff(fast, ref);
    assert(moved <= 1e-11 && err <= bound, `tension ${tension}: within ${bound} in of the converged membrane`, `${err.toFixed(5)} in (reference ${sweeps} sweeps)`);
  }
}

// ---------- T13 luma ----------
process.stdout.write('T13 luma sampling\n');
{
  const w = 7, h = 5, gray = new Uint8ClampedArray(w * h * 4), color = new Uint8ClampedArray(w * h * 4);
  for (let k = 0; k < w * h; k++) {
    const v = (k * 37) % 256;
    gray.set([v, v, v, 255], k * 4);
    color.set([v, (k * 11) % 256, (k * 53) % 256, 255], k * 4);
  }
  // The pre-2026-10-19 sampler read the red channel only.
  const redOnly = (data: Uint8ClampedArray, cols: number, rows: number): number[][] => {
    const g: number[][] = [];
    for (let j = 0; j < rows; j++) { g[j] = [];
      const fy = (j / (rows - 1)) * (h - 1), iy0 = Math.min(Math.floor(fy), h - 1), iy1 = Math.min(iy0 + 1, h - 1), ty = fy - iy0;
      for (let i = 0; i < cols; i++) {
        const fx = (i / (cols - 1)) * (w - 1), ix0 = Math.min(Math.floor(fx), w - 1), ix1 = Math.min(ix0 + 1, w - 1), tx = fx - ix0;
        const top = data[(iy0 * w + ix0) * 4] * (1 - tx) + data[(iy0 * w + ix1) * 4] * tx;
        const bot = data[(iy1 * w + ix0) * 4] * (1 - tx) + data[(iy1 * w + ix1) * 4] * tx;
        g[j][i] = (top * (1 - ty) + bot * ty) / 255; } }
    return g;
  };
  // Same values as the old sampler, with rows in world order (grid row 0 = image bottom).
  const a = sampleLumaGrid(gray, w, h, 13, 9).flat(), b = redOnly(gray, 13, 9).reverse().flat();
  assert(maxAbsDiff(a, b) < 1e-12, 'grayscale input matches the old sampler, rows in world order', `max diff ${maxAbsDiff(a, b).toExponential(2)}`);
  const px = sampleLumaGrid(color, w, h, w, h)[h - 2][3], k = w + 3;   // grid row h-2 = image row 1
  const expect = (0.2126 * color[k * 4] + 0.7152 * color[k * 4 + 1] + 0.0722 * color[k * 4 + 2]) / 255;
  assert(Math.abs(px - expect) < 1e-12, 'color input uses Rec. 709 luma');
}

// ---------- T13b orientation ----------
process.stdout.write('T13b the carving is not mirrored\n');
{
  // Image with a bright TOP-LEFT quadrant. World Y grows away from the machine front (exports put
  // grid row j at y = j / (rows - 1) x meshY), so the bright patch must land at high j, low i.
  const w = 8, h = 8, img = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = x < w / 2 && y < h / 2 ? 255 : 0; img.set([v, v, v, 255], (y * w + x) * 4); }
  const g = sampleLumaGrid(img, w, h, w, h);
  assert(g[h - 1][0] > 1 - 1e-12 && g[0][0] === 0 && g[h - 1][w - 1] === 0, 'image top-left lands at world top-left (high Y, low X)',
    `g[top][left]=${g[h - 1][0]}, g[bottom][left]=${g[0][0]}, g[top][right]=${g[h - 1][w - 1]}`);
}

// ---------- T13c flat images stay flat ----------
process.stdout.write('T13c a constant image is not normalized into relief\n');
{
  // GPT's reproduction: RGB(144,144,144) everywhere carved 0.01-0.67 in, because luma rounding
  // (~2e-16 across bilinear samples) was stretched to the full depth.
  const w = 7, h = 5, img = new Uint8ClampedArray(w * h * 4);
  for (let k = 0; k < w * h; k++) img.set([144, 144, 144, 255], k * 4);
  const g = sampleLumaGrid(img, w, h, 400, 282);
  const flat = g.flat(), raw = Math.max(...flat) - Math.min(...flat);
  normalizeGrid(g, 282, 400);
  const after = g.flat();
  assert(after.every(v => v === 0), 'constant gray normalizes to all zeros', `raw range ${raw.toExponential(2)}, after max ${Math.max(...after)}`);
  // Real contrast of one 8-bit level still normalizes to the full range.
  const img2 = img.slice(); img2.set([145, 145, 145, 255], 0);
  const g2 = sampleLumaGrid(img2, w, h, 400, 282);
  normalizeGrid(g2, 282, 400);
  assert(Math.max(...g2.flat()) === 1, 'one gray level of contrast still spans [0, 1]');
}

// ---------- T14 background cutoff ----------
process.stdout.write('T14 background cutoff\n');
{
  const g = [[0, 0.25, 0.5, 0.75, 1]], g0 = g.map(r => r.slice());
  applyBackgroundCutoff(g0, 1, 5, 0);
  assert(maxAbsDiff(g0[0], g[0]) === 0, 'cutoff 0 is the identity');
  const g1 = g.map(r => r.slice());
  applyBackgroundCutoff(g1, 1, 5, 0.5);
  assert(g1[0][0] === 0 && g1[0][1] === 0 && g1[0][2] === 0 && Math.abs(g1[0][3] - 0.5) < 1e-12 && g1[0][4] === 1,
    'cutoff 0.5 flattens <= 0.5 and stretches the rest to [0, 1]', g1[0].map(v => v.toFixed(2)).join(','));
}

// ---------- T15 share links ----------
process.stdout.write('T15 share links\n');
{
  const saved = { ...STATE };
  const set = (o: Partial<typeof STATE>) => Object.assign(STATE, o);
  set({ mode: 'blend', drapeFoldSpacing: 0.85, drapeFoldAmp: 0.07, drapeFoldLength: 5, drapeHang: 0.3, drapeGravityAngle: -40, dmBackgroundCutoff: 0.45, viewMaterial: 'neutral', blend: 0.62 });
  const back = deserializeConfig('?c=' + serializeConfig());
  const keys = ['mode', 'drapeFoldSpacing', 'drapeFoldAmp', 'drapeFoldLength', 'drapeHang', 'drapeGravityAngle', 'dmBackgroundCutoff', 'viewMaterial', 'blend'] as const;
  assert(keys.every(k => back[k] === STATE[k]), 'new Blend keys round-trip through a share link');
  Object.assign(STATE, saved);
  const enc = (o: object) => '?c=' + Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const v12 = deserializeConfig(enc({ _v: 12, mode: 'blend', blend: 0.3, drapeFoldScale: 20, drapeFoldDepth: 0.3, drapeFoldWarp: 0.9, drapeThickness: 0.05, drapeConform: 0.4 }));
  assert(!('drapeFoldScale' in v12) && !('drapeFoldDepth' in v12) && !('drapeFoldWarp' in v12), 'v12 link: retired fold keys are dropped');
  assert(v12.blend === 0.3 && v12.drapeThickness === 0.05 && v12.drapeConform === 0.4, 'v12 link: tension, thickness, transmission carry over by value');
  // serializeConfig omits default-valued keys, so a v12 link saved at the old default tension
  // (0.2) has no blend key at all and must still load 0.2, not the new default 0.8.
  const v12Default = deserializeConfig(enc({ _v: 12, mode: 'blend' }));
  assert(v12Default.blend === 0.2, 'v12 link at the old default tension keeps 0.2', `blend ${String(v12Default.blend)}`);
  const v13Default = deserializeConfig(enc({ _v: 13, mode: 'blend' }));
  assert(!('blend' in v13Default), 'v13 link without blend uses the current default');
  const crafted = deserializeConfig(enc({ _v: 13, drapeFoldSpacing: 0, drapeFoldLength: 1e9, drapeFoldAmp: 'NaN', drapeHang: -5, drapeGravityAngle: '720', dmBackgroundCutoff: 5, blend: 9, viewMaterial: 'chrome', mode: 'evil', viewMode: 'x' }));
  assert(crafted.drapeFoldSpacing === 0.25 && crafted.drapeFoldLength === 12 && !('drapeFoldAmp' in crafted) && crafted.drapeHang === 0
    && crafted.drapeGravityAngle === 180 && crafted.dmBackgroundCutoff === 0.9 && crafted.blend === 1,
    'crafted numeric values clamp to slider ranges or drop', JSON.stringify(crafted));
  assert(!('viewMaterial' in crafted) && !('mode' in crafted) && !('viewMode' in crafted), 'unknown enum values fall back to defaults');
  // GPT review: ["blend"] stringifies to "blend" and passed a String()-coerced check, then failed
  // every strict comparison downstream. Every string-enum key must reject non-strings.
  const arrays = deserializeConfig(enc({ _v: 13, mode: ['blend'], viewMode: ['solid'], viewMaterial: ['neutral'], noiseType: ['perlin'],
    reliefPolarity: ['domes'], reliefProfile: { a: 1 }, reliefAttractorMode: null, reliefBaseMode: 1, reliefRadialMode: ['rays'],
    activePreset: 'no-such-preset', activeProfile: 'no-such-profile' }));
  const enumKeys = ['mode', 'viewMode', 'viewMaterial', 'noiseType', 'reliefPolarity', 'reliefProfile', 'reliefAttractorMode', 'reliefBaseMode', 'reliefRadialMode', 'activePreset', 'activeProfile'];
  const survivors = enumKeys.filter(k => k in arrays);
  assert(survivors.length === 0, 'non-string or unknown enum values are dropped for all 11 enum keys', survivors.join(',') || 'none survived');
  const presetArray = deserializeConfig(enc({ _v: 13, activePreset: ['relief-starburst'] }));
  assert(!('activePreset' in presetArray), 'an array that stringifies to a real preset name is dropped');
  for (const bad of ['false', 0, ['true'], null]) {
    const w = deserializeConfig(enc({ _v: 13, watertight: bad }));
    assert(!('watertight' in w), `watertight ${JSON.stringify(bad)} is dropped (only booleans load)`);
  }
  assert(deserializeConfig(enc({ _v: 13, watertight: false })).watertight === false, 'watertight false loads');
  const ok = deserializeConfig(enc({ _v: 13, noiseType: 'perlin', reliefPolarity: 'pockets', activePreset: null, activeProfile: null }));
  assert(ok.noiseType === 'perlin' && ok.reliefPolarity === 'pockets' && ok.activePreset === null && ok.activeProfile === null,
    'valid enum strings and null presets still load');
}

// ---------- T16 machinability ----------
process.stdout.write('T16 machinability at defaults\n');
{
  const tip = getDefaultFinishingTool().tipRadius;
  for (const [name, f, rows, cols] of [
    ['plane', new Float64Array(300 * 200), 300, 200],
    ['dome', domes(300, 200, [[0.5, 0.5, 0.35]]), 300, 200],
  ] as [string, Float64Array, number, number][]) {
    const p = params(rows, cols);
    const r = composeDrape(f, p);
    const { dx, dy } = foldDirection(r.membrane, rows, cols, p.dxIn, p.gravityAngleDeg, p.hang);
    // Concave curvature across the local crest direction (normal = crest rotated 90 deg), 1/in.
    const curv: number[] = [];
    for (let j = 2; j < rows - 2; j++)
      for (let i = 2; i < cols - 2; i++) {
        const k = j * cols + i, nx = -dy[k], ny = dx[k];
        const at = (s: number) => { const x = Math.round(i + nx * s), y = Math.round(j + ny * s); return r.surface[y * cols + x]; };
        const c2 = (at(1) - 2 * r.surface[k] + at(-1)) / (p.dxIn * p.dxIn);
        if (c2 > 0) curv.push(c2);
      }
    curv.sort((a, b) => a - b);
    const p99 = curv[Math.floor(curv.length * 0.99)] ?? 0;
    assert(p99 <= 1 / tip, `${name}: 99th-percentile valley curvature cuttable by the ${tip} in tip`,
      `${p99.toFixed(2)} 1/in vs limit ${(1 / tip).toFixed(2)}`);
  }
}

// ---------- T17 SBP path ----------
process.stdout.write('T17 drape surface through the SBP generator\n');
{
  const rows = 90, cols = 60, f = faceRelief(rows, cols);
  const p = params(rows, cols, { dxIn: 10 / (cols - 1) });
  const z = drapeToStockHeights(composeDrape(f, p).surface, rows, cols, 0.75, 0.75, -0.08, 0.01);
  let threw = '';
  let sbp = '';
  try {
    const hm = stateToHeightmap(z, rows, cols, 10, 15);
    sbp = generateSBP(hm, getDefaultConfig()).sbp;
  } catch (e) { threw = e instanceof Error ? e.message : String(e); }
  assert(threw === '' && sbp.length > 0, 'generateSBP accepts the drape heightmap and emits toolpaths', threw || `${sbp.length} bytes`);
  const zs = [...sbp.matchAll(/^M3,[^,]*,[^,]*,(-?[\d.]+)/gm)].map(m => parseFloat(m[1]));
  assert(zs.length > 0 && zs.every(v => Number.isFinite(v)), 'every cutting move has a finite Z', `${zs.length} moves`);
}

if (failures === 0) {
  process.stdout.write('\nALL OK\n');
  process.exit(0);
} else {
  process.stdout.write(`\n${failures} FAILURE(S)\n`);
  process.exit(1);
}
