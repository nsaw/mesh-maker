/**
 * Deterministic verification of the Voronoi Relief sampler.
 * Run: npm run test:relief  (or: npx tsx cli/voronoi-relief.spec.ts)
 *
 * Asserts:
 *   1. determinism (same seed → byte-identical grid)
 *   2-3. finiteness + range bounds (within [-1.05, 1.05])
 *   4. polarity inversion (pockets vs domes have flipped sign)
 *   5. density attractor (vertical mode increases site density toward bottom)
 *   6. profile sanity (peak at cell center, decay between cells)
 *   7-7b. wave base mode + transitionSoftness semantics
 *   8. Lloyd relaxation effect
 */

import { VoronoiReliefGen } from '../src/noise/voronoi-relief';
import type { ReliefSampleParams } from '../src/types';

let failures = 0;
function assert(condition: boolean, label: string, detail = ''): void {
  if (condition) {
    process.stdout.write(`  ok  ${label}\n`);
  } else {
    process.stdout.write(`  FAIL ${label}${detail ? ` — ${detail}` : ''}\n`);
    failures++;
  }
}

function baseParams(overrides: Partial<ReliefSampleParams> = {}): ReliefSampleParams {
  return {
    cols: 60, rows: 40, meshX: 36, meshY: 24, seed: 7,
    cellSize: 1.5, jitter: 0.7, relaxIterations: 1,
    polarity: 'domes', profile: 'hemisphere',
    seamDepth: 0.6, seamWidth: 0.15,
    anisotropy: 0, anisotropyAngle: 0,
    attractorMode: 'none', attractorX: 0.5, attractorY: 0.5,
    attractorRadius: 0.5, attractorFalloff: 1,
    densityStrength: 0, intensityStrength: 1,
    transitionSoftness: 0.3, baseMode: 'flat',
    // New fields (round-12): warp pipeline integration + cell-size gradient + void mode.
    warpDistortion: 0, warpFrequency: 0.1,
    cellSizeGradient: 0, voidStrength: 0,
    ...overrides,
  };
}

function flatten(grid: number[][]): number[] {
  const out: number[] = [];
  for (const row of grid) for (const v of row) out.push(v);
  return out;
}

function mean(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

// 1. Determinism
{
  process.stdout.write('1. determinism\n');
  const a = new VoronoiReliefGen(42).sampleGrid(baseParams({ seed: 42 }));
  const b = new VoronoiReliefGen(42).sampleGrid(baseParams({ seed: 42 }));
  const fa = flatten(a);
  const fb = flatten(b);
  let identical = fa.length === fb.length;
  if (identical) {
    for (let i = 0; i < fa.length; i++) {
      if (fa[i] !== fb[i]) { identical = false; break; }
    }
  }
  assert(identical, 'two seeded runs produce identical grids');
}

// 2. Finiteness + 3. Range
{
  process.stdout.write('2-3. finiteness and range\n');
  const grid = new VoronoiReliefGen(11).sampleGrid(baseParams());
  const flat = flatten(grid);
  const allFinite = flat.every((v) => Number.isFinite(v));
  const inRange = flat.every((v) => v >= -1.05 && v <= 1.05);
  assert(allFinite, 'all values finite');
  assert(inRange, 'all values within [-1.05, 1.05]');
}

// 4. Polarity inversion
{
  process.stdout.write('4. polarity inversion\n');
  const domes = new VoronoiReliefGen(99).sampleGrid(baseParams({ polarity: 'domes', seed: 99 }));
  const pockets = new VoronoiReliefGen(99).sampleGrid(baseParams({ polarity: 'pockets', seed: 99 }));
  const dMean = mean(flatten(domes));
  const pMean = mean(flatten(pockets));
  // Domes should mean-positive (raised cells), pockets mean-negative.
  assert(dMean > 0 && pMean < 0,
    'domes mean > 0 and pockets mean < 0',
    `dMean=${dMean.toFixed(4)} pMean=${pMean.toFixed(4)}`);
  assert(Math.abs(dMean + pMean) < 0.05,
    'domes and pockets means are sign-symmetric',
    `dMean+pMean=${(dMean + pMean).toFixed(4)}`);
}

// 5. Density attractor (vertical mode)
{
  process.stdout.write('5. density attractor\n');
  // Use high resolution and a strong vertical density attractor anchored at bottom of grid
  // (high j). With attractorY=1, mask peaks at v=1 → high j → high-row band has more density.
  const params = baseParams({
    cols: 80, rows: 60, attractorMode: 'vertical', attractorY: 1,
    densityStrength: 1.5, seed: 3,
  });
  const grid = new VoronoiReliefGen(3).sampleGrid(params);
  const topBand = flatten(grid.slice(0, 15));
  const bottomBand = flatten(grid.slice(45));
  const stdev = (vs: number[]): number => {
    const m = mean(vs);
    let s = 0;
    for (const v of vs) s += (v - m) ** 2;
    return Math.sqrt(s / vs.length);
  };
  const tSd = stdev(topBand);
  const bSd = stdev(bottomBand);
  assert(bSd > tSd * 1.1,
    'bottom band has > 1.1× variance of top under vertical attractor',
    `top σ=${tSd.toFixed(4)} bot σ=${bSd.toFixed(4)}`);
}

// 6. Profile sanity — verify each profile hits a clear dome peak near 1.
{
  process.stdout.write('6. profile sanity\n');
  // Many small cells over a large grid: the per-cell radius is reliably small relative to
  // the meshX, so cell centers reach 1 and cell boundaries (sampled between sites) hit ≤ 0.5.
  const profiles: Array<'hemisphere' | 'cosine' | 'parabolic'> = ['hemisphere', 'cosine', 'parabolic'];
  for (const profile of profiles) {
    const grid = new VoronoiReliefGen(0).sampleGrid(baseParams({
      cols: 200, rows: 200, meshX: 36, meshY: 24, cellSize: 1.5, seamDepth: 0,
      relaxIterations: 1, jitter: 0.4, profile, baseMode: 'flat', seed: 0,
    }));
    const flat = flatten(grid);
    const max = Math.max(...flat);
    const min = Math.min(...flat);
    assert(max > 0.92,
      `${profile} max ≈ 1 at cell centers`,
      `max=${max.toFixed(4)}`);
    // With seamDepth=0, the only thing pulling values down is the dome falloff toward cell edges.
    // All three profiles must drop well below 0.5 somewhere on the grid.
    assert(min < 0.5,
      `${profile} reaches < 0.5 between cells`,
      `min=${min.toFixed(4)}`);
  }
}

// 7. Wave base mode: with vertical attractor + wave, the bottom (cell zone) must reach
//    deeper troughs than the top (wave zone). Cells with seamDepth>0 cut to ≈ -0.7;
//    the wave field alone is bounded to ±0.5 by WAVE_AMPLITUDE.
{
  process.stdout.write('7. wave base mode + transitionSoftness\n');
  const wave = new VoronoiReliefGen(13).sampleGrid(baseParams({
    cols: 60, rows: 80, meshX: 24, meshY: 32, seed: 13,
    baseMode: 'wave', attractorMode: 'vertical', attractorY: 1, attractorFalloff: 1.4,
    intensityStrength: 1, transitionSoftness: 1,
    seamDepth: 0.9, seamWidth: 0.15, cellSize: 1.5, polarity: 'domes',
  }));
  const flatTop = flatten(wave.slice(0, 16));   // top 20% — pure wave zone
  const flatBot = flatten(wave.slice(64));      // bottom 20% — pure cell zone
  const minTop = Math.min(...flatTop);
  const minBot = Math.min(...flatBot);
  // Wave alone bounded to ±0.5; cells with seamDepth=0.9 cut deeper than -0.5.
  assert(minBot < -0.5,
    'wave-mode bottom reaches deep cell troughs (< -0.5)',
    `minBot=${minBot.toFixed(4)}`);
  assert(minTop > -0.55,
    'wave-mode top stays in wave envelope (> -0.55)',
    `minTop=${minTop.toFixed(4)}`);
}

// 7b. transitionSoftness semantic — softness=0 → sharper cells take-over (more low-mask
//     samples are still wave-dominated); softness=1 → gradual lerp (cells visible earlier).
{
  process.stdout.write('7b. transitionSoftness semantic\n');
  const sharp = new VoronoiReliefGen(21).sampleGrid(baseParams({
    cols: 40, rows: 80, meshX: 16, meshY: 32, seed: 21,
    baseMode: 'wave', attractorMode: 'vertical', attractorFalloff: 1.0,
    intensityStrength: 1, transitionSoftness: 0,
    seamDepth: 0.8, cellSize: 1.5,
  }));
  const gradual = new VoronoiReliefGen(21).sampleGrid(baseParams({
    cols: 40, rows: 80, meshX: 16, meshY: 32, seed: 21,
    baseMode: 'wave', attractorMode: 'vertical', attractorFalloff: 1.0,
    intensityStrength: 1, transitionSoftness: 1,
    seamDepth: 0.8, cellSize: 1.5,
  }));
  // In the mid-band (v=0.5, mask=0.5), gradual exponent=2 → cellWeight=0.25; sharp
  // exponent=0.2 → cellWeight=0.87. So sharp shows MORE cell character at mid-band.
  const sharpMid = flatten(sharp.slice(30, 50));
  const gradualMid = flatten(gradual.slice(30, 50));
  const stdev = (vs: number[]): number => {
    const m = mean(vs);
    let s = 0;
    for (const v of vs) s += (v - m) ** 2;
    return Math.sqrt(s / vs.length);
  };
  assert(stdev(sharpMid) > stdev(gradualMid),
    'softness=0 (sharp) shows higher mid-band variance than softness=1 (gradual)',
    `sharp σ=${stdev(sharpMid).toFixed(4)} gradual σ=${stdev(gradualMid).toFixed(4)}`);
}

// 8. Lloyd relaxation actually moves sites — relaxIterations=2 should produce a different grid
//    than relaxIterations=0 for the same seed. (Hash a sample of values.)
{
  process.stdout.write('8. Lloyd relaxation effect\n');
  const noRelax = new VoronoiReliefGen(101).sampleGrid(baseParams({
    seed: 101, relaxIterations: 0, jitter: 0.9, // high jitter → uneven sites → Lloyd will move them
  }));
  const relaxed = new VoronoiReliefGen(101).sampleGrid(baseParams({
    seed: 101, relaxIterations: 2, jitter: 0.9,
  }));
  let differing = 0;
  const a = flatten(noRelax);
  const b = flatten(relaxed);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differing++;
  assert(differing > a.length * 0.1,
    'Lloyd relaxation changes >10% of grid values from non-relaxed',
    `differing=${differing}/${a.length}`);
}

// 9. Warp displacement actually moves sites (regression for the round-12 fix that wired
//    the global distortion slider into the relief sampler). Same seed, same params, but
//    one run has warpDistortion=0 and the other has warpDistortion=1 — outputs must differ.
{
  process.stdout.write('9. warp displacement effect\n');
  const noWarp = new VoronoiReliefGen(55).sampleGrid(baseParams({
    seed: 55, warpDistortion: 0, warpFrequency: 0.1,
  }));
  const warped = new VoronoiReliefGen(55).sampleGrid(baseParams({
    seed: 55, warpDistortion: 1.0, warpFrequency: 0.1,
  }));
  let differing = 0;
  const a = flatten(noWarp);
  const b = flatten(warped);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differing++;
  assert(differing > a.length * 0.2,
    'warpDistortion changes >20% of grid values from no-warp baseline',
    `differing=${differing}/${a.length}`);
}

// 10. Void mode forces -clamp where mask × seam exceeds threshold (regression for the
//     round-12 fix that produces lafabrica-style cut-through fingers).
{
  process.stdout.write('10. void mode\n');
  const grid = new VoronoiReliefGen(77).sampleGrid(baseParams({
    seed: 77, attractorMode: 'vertical', attractorY: 1, attractorFalloff: 1.4,
    densityStrength: 1, seamDepth: 0.7, voidStrength: 0.6,
  }));
  // Bottom band must contain values near the negative clamp (-1.05).
  const bottomBand = flatten(grid.slice(grid.length - Math.floor(grid.length / 4)));
  const minBot = Math.min(...bottomBand);
  assert(minBot < -1.0,
    'void mode produces values at the negative clamp (will floor to z=0 in CNC normalize)',
    `minBot=${minBot.toFixed(4)}`);
  // Without void mode at the same params, nothing should reach that depth.
  const noVoidGrid = new VoronoiReliefGen(77).sampleGrid(baseParams({
    seed: 77, attractorMode: 'vertical', attractorFalloff: 1.4,
    densityStrength: 1, seamDepth: 0.7, voidStrength: 0,
  }));
  const minBotNoVoid = Math.min(...flatten(noVoidGrid.slice(noVoidGrid.length - Math.floor(noVoidGrid.length / 4))));
  assert(minBotNoVoid > minBot,
    'void mode cuts deeper than no-void at the same seamDepth',
    `void min=${minBot.toFixed(4)} vs no-void min=${minBotNoVoid.toFixed(4)}`);
}

// 11. Cell-size gradient — under a vertical attractor, dome peaks in the dense (high-mask)
//     band should be smaller than peaks in the sparse (low-mask) band. We approximate this
//     by counting peaks above 0.9 — gradient should not eliminate peaks but should redistribute.
{
  process.stdout.write('11. cell-size gradient\n');
  const flat = new VoronoiReliefGen(91).sampleGrid(baseParams({
    seed: 91, cols: 80, rows: 80, attractorMode: 'vertical', attractorFalloff: 1,
    densityStrength: 1, cellSizeGradient: 0,
  }));
  const graded = new VoronoiReliefGen(91).sampleGrid(baseParams({
    seed: 91, cols: 80, rows: 80, attractorMode: 'vertical', attractorFalloff: 1,
    densityStrength: 1, cellSizeGradient: 1.5,
  }));
  // Both grids should still hit dome peaks; the test is that the OUTPUTS DIFFER materially
  // when the gradient is engaged.
  let differing = 0;
  const a = flatten(flat);
  const b = flatten(graded);
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 0.01) differing++;
  assert(differing > a.length * 0.1,
    'cellSizeGradient changes >10% of grid values from baseline',
    `differing=${differing}/${a.length}`);
}

// 12. Vertical attractor direction is controlled by attractorY anchor — regression for the
//     round-13 fix that flips the convention so cells gravitate toward attractorY (lafabrica
//     panel orientation) instead of always peaking at v=1.
{
  process.stdout.write('12. vertical attractor anchor direction\n');
  // Anchor at top of grid (v=0) — dense band should be at LOW j (top of noise grid).
  const anchorTop = new VoronoiReliefGen(7).sampleGrid(baseParams({
    cols: 80, rows: 80, attractorMode: 'vertical', attractorY: 0,
    densityStrength: 1.5, seed: 7,
  }));
  const stdev = (vs: number[]): number => {
    const m = mean(vs);
    let s = 0;
    for (const v of vs) s += (v - m) ** 2;
    return Math.sqrt(s / vs.length);
  };
  const topSdAnchorTop = stdev(flatten(anchorTop.slice(0, 20)));
  const botSdAnchorTop = stdev(flatten(anchorTop.slice(60)));
  assert(topSdAnchorTop > botSdAnchorTop * 1.1,
    'attractorY=0 puts dense band at top of grid (low j, viewport bottom)',
    `top σ=${topSdAnchorTop.toFixed(4)} bot σ=${botSdAnchorTop.toFixed(4)}`);
  // Anchor at bottom of grid (v=1) — dense band should be at HIGH j.
  const anchorBot = new VoronoiReliefGen(7).sampleGrid(baseParams({
    cols: 80, rows: 80, attractorMode: 'vertical', attractorY: 1,
    densityStrength: 1.5, seed: 7,
  }));
  const topSdAnchorBot = stdev(flatten(anchorBot.slice(0, 20)));
  const botSdAnchorBot = stdev(flatten(anchorBot.slice(60)));
  assert(botSdAnchorBot > topSdAnchorBot * 1.1,
    'attractorY=1 puts dense band at bottom of grid (high j, viewport top)',
    `top σ=${topSdAnchorBot.toFixed(4)} bot σ=${botSdAnchorBot.toFixed(4)}`);
}

if (failures === 0) {
  process.stdout.write('\nALL OK\n');
  process.exit(0);
} else {
  process.stdout.write(`\n${failures} FAILURE(S)\n`);
  process.exit(1);
}
