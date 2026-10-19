/**
 * Physics check of the procedural drape (src/drape.ts) against a reference cloth simulation
 * (cli/drape-reference-sim.ts). Slow: several minutes. Run: npm run test:drape-physics
 *
 *   P0  the oracle settled: 99th-percentile particle move per step below 5e-5 of the panel width.
 *       A few particles in tight buckles can chatter indefinitely under position-level friction
 *       (two domes: max move ~2e-3 while the fold metric reads the same at 3000 and 6000 steps),
 *       so the bulk, not the single worst particle, defines settled.
 *   P1  cloth pressed into the panel (gravity -z): fold/contour alignment within 0.15 of the sim
 *   P2  hanging cloth (gravity tilted 60 deg down the image, top pinned): vertical-crest no more
 *       than 0.08 below the sim
 *   P3  envelope: at each model's best tension, the membrane is at least 1.33x closer (RMS) to the
 *       simulated cloth than the previous compositor's envelope (ported below, same oracle, same
 *       run). Measured 2026-10-19: dome 0.0200 vs 0.0387 (1.9x), two domes 0.0562 vs 0.0856 (1.5x).
 *       The review's "2x" compared the old model at its default tension with a tuned membrane;
 *       RMS also understates the old envelope's real defects (square plateaus, peak inflation,
 *       lost clearance), which cli/drape.spec.ts T1/T2 assert exactly.
 *
 * Geometry: unit-square panel mapped to 16 in, 128 x 128 grid, relief height 0.25 x width (deep
 * enough for the cloth to fold), cloth 141 x 141 particles.
 */

import { composeDrape, gaussianBlur } from '../src/drape';
import type { DrapeParams } from '../src/drape';
import { DEFAULTS } from '../src/state';
import { weightedSmooth } from '../src/geometry';
import { simulateReferenceDrape } from './drape-reference-sim';
import { contourAlignment, domes, rmsAfterOffset, verticalCrest } from './drape-metrics';

let failures = 0;
function assert(condition: boolean, label: string, detail = ''): void {
  if (condition) {
    process.stdout.write(`  ok  ${label}${detail ? ` (${detail})` : ''}\n`);
  } else {
    process.stdout.write(`  FAIL ${label}${detail ? `: ${detail}` : ''}\n`);
    failures++;
  }
}

const G = 128;
const PANEL_IN = 16;
const RELIEF_FRACTION = 0.25;           // relief height as a fraction of panel width
/** The previous compositor's envelope (src/drape.ts before 2026-10-19), ported verbatim in
 *  behaviour: smooth the form (dmSmoothing 7 at 0.6), square max-filter of radius tension x 12% of
 *  the width, two 0.5 smoothing passes, lerp by tension. Default tension was 0.2. */
function oldEnvelope(form: Float64Array, n: number, tension = 0.2): Float64Array {
  const grid: number[][] = [];
  for (let j = 0; j < n; j++) { grid[j] = []; for (let i = 0; i < n; i++) grid[j][i] = form[j * n + i]; }
  const sm = weightedSmooth(grid, n, n, 7, 0.6);
  const r = Math.round(tension * 0.12 * n);
  const h: number[][] = [], v: number[][] = [];
  for (let j = 0; j < n; j++) { h[j] = []; for (let i = 0; i < n; i++) { let m = -Infinity; for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) m = Math.max(m, sm[j][k]); h[j][i] = m; } }
  for (let j = 0; j < n; j++) { v[j] = []; for (let i = 0; i < n; i++) { let m = -Infinity; for (let k = Math.max(0, j - r); k <= Math.min(n - 1, j + r); k++) m = Math.max(m, h[k][i]); v[j][i] = m; } }
  const env = weightedSmooth(v, n, n, 2, 0.5);
  const out = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[j * n + i] = sm[j][i] * (1 - tension) + env[j][i] * tension;
  return out;
}

function drapeParams(overrides: Partial<DrapeParams>): DrapeParams {
  const dxIn = PANEL_IN / (G - 1);
  return {
    cols: G, rows: G, dxIn,
    formDepthIn: RELIEF_FRACTION * PANEL_IN,
    thicknessIn: 0.004 * PANEL_IN,      // the sim's collision offset
    tension: DEFAULTS.blend,
    conform: 1,                         // the sim's cloth follows the analytic relief exactly
    foldSpacingIn: 6 * dxIn,            // the sim's fold scale at this particle count
    foldAmpIn: DEFAULTS.drapeFoldAmp,
    foldLength: DEFAULTS.drapeFoldLength,
    hang: 0,
    gravityAngleDeg: 0,
    seed: 7,
    ...overrides,
  };
}

const cases: { name: string; form: Float64Array; tiltDeg: number; pinTop: boolean; hang: number }[] = [
  { name: 'dome', form: domes(G, G, [[0.5, 0.5, 0.22]]), tiltDeg: 0, pinTop: false, hang: 0 },
  { name: 'twodome', form: domes(G, G, [[0.3, 0.5, 0.16], [0.7, 0.5, 0.16]]), tiltDeg: 0, pinTop: false, hang: 0 },
  { name: 'dome-hanging', form: domes(G, G, [[0.5, 0.5, 0.22]]), tiltDeg: 60, pinTop: true, hang: 60 / 90 },
];

for (const c of cases) {
  process.stdout.write(`${c.name}\n`);
  const relief = new Float64Array(c.form.length);
  for (let k = 0; k < relief.length; k++) relief[k] = c.form[k] * RELIEF_FRACTION;
  const t0 = performance.now();
  const sim = simulateReferenceDrape(relief, G, { tiltDeg: c.tiltDeg, pinTop: c.pinTop, particles: 141, maxSteps: 3000, settleMove: 1e-5 });
  const secs = (performance.now() - t0) / 1000;
  assert(sim.lastMoveP99 < 5e-5, 'P0 reference cloth settled (p99 move)',
    `${sim.steps} steps, p99 move ${sim.lastMoveP99.toExponential(1)}, max ${sim.lastMove.toExponential(1)}, ${secs.toFixed(0)} s, holes ${sim.holes}`);

  const simFold = new Float64Array(sim.surface.length);
  const simBlur = gaussianBlur(sim.surface, G, G, 4);
  for (let k = 0; k < simFold.length; k++) simFold[k] = sim.surface[k] - simBlur[k];
  // The sim pulls toward +y (away from its pinned row); in drape.ts that is gravity angle 180.
  const drape = composeDrape(c.form, drapeParams({ hang: c.hang, gravityAngleDeg: c.tiltDeg ? 180 : 0 }));

  if (c.tiltDeg === 0) {
    const s = contourAlignment(simFold, c.form, G, G), a = contourAlignment(drape.folds, c.form, G, G);
    assert(Math.abs(s - a) <= 0.15, 'P1 fold/contour alignment matches the sim', `sim ${s.toFixed(3)}, drape ${a.toFixed(3)}`);
    // Envelope: compare in units of relief height.
    const simEnv = gaussianBlur(sim.surface, G, G, 3);
    const simN = new Float64Array(G * G), memN = new Float64Array(G * G);
    for (let k = 0; k < simN.length; k++) { simN[k] = simEnv[k] / RELIEF_FRACTION; memN[k] = drape.membrane[k] / (RELIEF_FRACTION * PANEL_IN); }
    // Model capability, not default tuning: each envelope gets its best tension over the same sweep.
    const sweep = [0, 0.2, 0.4, 0.6, 0.8, 1];
    let best = Infinity, bestT = 0, oldBest = Infinity, oldT = 0;
    for (const t of sweep) {
      const m = composeDrape(c.form, drapeParams({ hang: c.hang, tension: t })).membrane;
      for (let k = 0; k < memN.length; k++) memN[k] = m[k] / (RELIEF_FRACTION * PANEL_IN);
      const e = rmsAfterOffset(memN, simN, G, G, 8);
      if (e < best) { best = e; bestT = t; }
      const eo = rmsAfterOffset(oldEnvelope(c.form, G, t), simN, G, G, 8);
      if (eo < oldBest) { oldBest = eo; oldT = t; }
    }
    const rmsDefault = rmsAfterOffset(memN.map((_, k) => drape.membrane[k] / (RELIEF_FRACTION * PANEL_IN)), simN, G, G, 8);
    assert(best <= 0.75 * oldBest, 'P3 membrane model at least 1.33x closer to the cloth than the old envelope model',
      `best ${best.toFixed(4)} @ tension ${bestT} vs old best ${oldBest.toFixed(4)} @ ${oldT}; at defaults ${rmsDefault.toFixed(4)}`);
  } else {
    const s = verticalCrest(simFold, G, G), a = verticalCrest(drape.folds, G, G);
    assert(a >= s - 0.08, 'P2 hanging folds run down the image like the sim', `sim ${s.toFixed(3)}, drape ${a.toFixed(3)}`);
  }
}

if (failures === 0) {
  process.stdout.write('\nALL OK\n');
  process.exit(0);
} else {
  process.stdout.write(`\n${failures} FAILURE(S)\n`);
  process.exit(1);
}
