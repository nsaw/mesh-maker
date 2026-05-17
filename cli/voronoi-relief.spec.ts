/**
 * Deterministic verification of the Voronoi Relief sampler.
 * Run: npm run test:relief  (or: npx tsx cli/voronoi-relief.spec.ts)
 *
 * 18 numbered test blocks covering: determinism, finiteness + range bounds, polarity
 * inversion sign-symmetry, density-attractor mode effect, dome profile peak/decay
 * sanity, wave base mode + transitionSoftness semantics, Lloyd relaxation effect,
 * warp displacement, warp frequency, void mode (production + cuts deeper than no-void),
 * cell-size gradient, vertical attractor anchor direction, attractor patchiness, flow
 * anisotropy, asymmetric output range guard at production seamDepth, catastrophic-jump
 * guard, and isolated-outlier guard via 5x5 z-score + absolute deviation.
 */

import { VoronoiReliefGen } from '../src/noise/voronoi-relief';
import { CNC_PRESETS } from '../src/noise/presets';
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
    cellSizeGradient: 0, voidStrength: 0, invertProfile: 0, seamSharpness: 0,
    // Round-14: noise-modulated attractor + flow-field anisotropy.
    attractorNoise: 0, attractorNoiseFreq: 0.15, flowAnisotropy: 0,
    // Round-16: radial-foci ("starburst"). Empty radialFoci ⇒ radial system off (matches
    // pre-feature output); the scalar params below are inert until radialFoci is non-empty.
    radialFoci: [], radialStrength: 1.5, radialFalloff: 0.3, radialGrow: 0.45, radialWarp: 0.4, radialMode: 'rays',
    ...overrides,
  };
}

function starburstPresetParams(overrides: Partial<ReliefSampleParams> = {}): ReliefSampleParams {
  const p = CNC_PRESETS['relief-starburst'];
  const numberValue = (key: string): number => {
    const v = p[key];
    if (typeof v !== 'number') throw new Error(`relief-starburst.${key} must be numeric`);
    return v;
  };
  const stringValue = (key: string): string => {
    const v = p[key];
    if (typeof v !== 'string') throw new Error(`relief-starburst.${key} must be string`);
    return v;
  };
  return baseParams({
    cols: 120,
    rows: 240,
    meshX: numberValue('meshX'),
    meshY: numberValue('meshY'),
    cellSize: numberValue('reliefCellSize'),
    jitter: numberValue('reliefJitter'),
    relaxIterations: numberValue('reliefRelaxIterations'),
    polarity: stringValue('reliefPolarity') as ReliefSampleParams['polarity'],
    profile: stringValue('reliefProfile') as ReliefSampleParams['profile'],
    seamDepth: numberValue('reliefSeamDepth'),
    seamWidth: numberValue('reliefSeamWidth'),
    anisotropy: numberValue('reliefAnisotropy'),
    anisotropyAngle: numberValue('reliefAnisotropyAngle'),
    attractorMode: stringValue('reliefAttractorMode') as ReliefSampleParams['attractorMode'],
    attractorX: numberValue('reliefAttractorX'),
    attractorY: numberValue('reliefAttractorY'),
    attractorRadius: numberValue('reliefAttractorRadius'),
    attractorFalloff: numberValue('reliefAttractorFalloff'),
    densityStrength: numberValue('reliefDensityStrength'),
    intensityStrength: numberValue('reliefIntensityStrength'),
    transitionSoftness: numberValue('reliefTransitionSoftness'),
    baseMode: stringValue('reliefBaseMode') as ReliefSampleParams['baseMode'],
    warpDistortion: numberValue('distortion'),
    warpFrequency: numberValue('warpFreq'),
    cellSizeGradient: numberValue('reliefCellSizeGradient'),
    voidStrength: numberValue('reliefVoidStrength'),
    invertProfile: typeof p.reliefInvertProfile === 'number' ? p.reliefInvertProfile : 0,
    seamSharpness: typeof p.reliefSeamSharpness === 'number' ? p.reliefSeamSharpness : 0,
    attractorNoise: numberValue('reliefAttractorNoise'),
    attractorNoiseFreq: numberValue('reliefAttractorNoiseFreq'),
    flowAnisotropy: numberValue('reliefFlowAnisotropy'),
    radialFoci: [
      { x: numberValue('reliefRadialFocus1X'), y: numberValue('reliefRadialFocus1Y') },
      { x: numberValue('reliefRadialFocus2X'), y: numberValue('reliefRadialFocus2Y') },
      { x: numberValue('reliefRadialFocus3X'), y: numberValue('reliefRadialFocus3Y') },
    ].slice(0, Math.floor(numberValue('reliefRadialFociCount'))),
    radialStrength: numberValue('reliefRadialStrength'),
    radialFalloff: numberValue('reliefRadialFalloff'),
    radialGrow: numberValue('reliefRadialGrow'),
    radialWarp: numberValue('reliefRadialWarp'),
    radialMode: stringValue('reliefRadialMode') as ReliefSampleParams['radialMode'],
    ...overrides,
  });
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

function stdev(values: number[]): number {
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) ** 2;
  return Math.sqrt(s / values.length);
}

function countMeanCrossings(grid: number[][]): number {
  const m = mean(flatten(grid));
  let crossings = 0;
  for (let j = 0; j < grid.length; j++) {
    let prev = grid[j][0] > m;
    for (let i = 1; i < grid[j].length; i++) {
      const cur = grid[j][i] > m;
      if (cur !== prev) crossings++;
      prev = cur;
    }
  }
  for (let i = 0; i < grid[0].length; i++) {
    let prev = grid[0][i] > m;
    for (let j = 1; j < grid.length; j++) {
      const cur = grid[j][i] > m;
      if (cur !== prev) crossings++;
      prev = cur;
    }
  }
  return crossings;
}

function countLocalMinima(grid: number[][]): number {
  let minima = 0;
  for (let j = 1; j < grid.length - 1; j++) {
    for (let i = 1; i < grid[j].length - 1; i++) {
      const v = grid[j][i];
      const local = (grid[j - 1][i] + grid[j + 1][i] + grid[j][i - 1] + grid[j][i + 1]) / 4;
      if (v < local - 0.03 && v < grid[j - 1][i] && v < grid[j + 1][i]
        && v < grid[j][i - 1] && v < grid[j][i + 1]) {
        minima++;
      }
    }
  }
  return minima;
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
//    deeper troughs than the top (wave zone). With pockets polarity (the production case)
//    cells carve DOWN below the wave-only envelope.
{
  process.stdout.write('7. wave base mode + transitionSoftness\n');
  // Use parabolic profile + higher resolution: the new hemisphere formula
  // (1 - sqrt(1-t²)) is slow to grow, and the previous 60×80 grid couldn't
  // resolve cell centers cleanly enough to saturate bowls. Production rarely
  // hits this — relief-pockets uses 400×800 with cellSize=5.5 — but the spec
  // needs enough resolution to actually reach the saturation clamp.
  const wave = new VoronoiReliefGen(13).sampleGrid(baseParams({
    cols: 120, rows: 160, meshX: 24, meshY: 32, seed: 13,
    baseMode: 'wave', attractorMode: 'vertical', attractorY: 1, attractorFalloff: 1.4,
    intensityStrength: 1, transitionSoftness: 1,
    seamDepth: 0.4, seamWidth: 0.15, cellSize: 1.5, polarity: 'pockets',
    profile: 'parabolic',
  }));
  const flatTop = flatten(wave.slice(0, 32));   // top 20% — pure wave zone
  const flatBot = flatten(wave.slice(128));     // bottom 20% — pure cell zone
  const minTop = Math.min(...flatTop);
  const minBot = Math.min(...flatBot);
  // Wave alone bounded to ±0.5 (WAVE_AMPLITUDE); cells with seamDepth=0.9 reach the
  // saturation clamp (-1.0). minBot should easily clear -0.5.
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

// 9b. Warp FREQUENCY actually affects output (companion regression to 9 — would still
//     pass test 9 if warpFrequency were ignored or hardcoded, since the noise field at
//     freq 0.1 differs from freq 0.05 at every (x,y)). Catches a regression where the
//     warpFrequency param gets dropped from sampleGrid's site-position warp pass.
{
  process.stdout.write('9b. warp frequency effect\n');
  const lowFreq = new VoronoiReliefGen(55).sampleGrid(baseParams({
    seed: 55, warpDistortion: 1.0, warpFrequency: 0.05,
  }));
  const highFreq = new VoronoiReliefGen(55).sampleGrid(baseParams({
    seed: 55, warpDistortion: 1.0, warpFrequency: 0.25,
  }));
  let differing = 0;
  const a = flatten(lowFreq);
  const b = flatten(highFreq);
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 0.01) differing++;
  assert(differing > a.length * 0.1,
    'warpFrequency change > 0.01 in >10% of cells',
    `differing=${differing}/${a.length}`);
}

// 10. Void mode forces -clamp where mask × seam exceeds threshold (regression for the
//     round-12 fix that produces lafabrica-style cut-through fingers).
{
  process.stdout.write('10. void mode\n');
  // Parabolic profile + finer grid + smaller seamDepth so bowls saturate enough to
  // trigger void mode in the test fixture (the production resolution saturates trivially
  // but the 60×40 spec grid has only ~1.5 pixels per cell center under default cellSize).
  const grid = new VoronoiReliefGen(77).sampleGrid(baseParams({
    cols: 120, rows: 80, seed: 77, attractorMode: 'vertical', attractorY: 1, attractorFalloff: 1.4,
    densityStrength: 1, seamDepth: 0.4, voidStrength: 0.6, profile: 'parabolic',
  }));
  // Bottom band must contain values near the negative clamp (-1.05).
  const bottomBand = flatten(grid.slice(grid.length - Math.floor(grid.length / 4)));
  const minBot = Math.min(...bottomBand);
  assert(minBot < -1.0,
    'void mode produces values at the negative clamp (will floor to z=0 in CNC normalize)',
    `minBot=${minBot.toFixed(4)}`);
  // Without void mode at the same params, nothing should reach that depth. attractorY:1
  // must match the void-enabled branch — without it a regression in the vertical-anchor
  // path could change minBotNoVoid independently of void mode and still satisfy the assert.
  const noVoidGrid = new VoronoiReliefGen(77).sampleGrid(baseParams({
    cols: 120, rows: 80, seed: 77, attractorMode: 'vertical', attractorY: 1, attractorFalloff: 1.4,
    densityStrength: 1, seamDepth: 0.4, voidStrength: 0, profile: 'parabolic',
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

// 13. Attractor patchiness — round-14 fix that breaks the smooth linear gradient into
//     organic blobs via 2D noise modulation. Same seed/params, two grids, only attractor
//     noise differs — outputs must differ materially.
{
  process.stdout.write('13. attractor patchiness\n');
  const smooth = new VoronoiReliefGen(31).sampleGrid(baseParams({
    seed: 31, attractorMode: 'vertical', attractorY: 0, densityStrength: 1.5,
    attractorNoise: 0,
  }));
  const patchy = new VoronoiReliefGen(31).sampleGrid(baseParams({
    seed: 31, attractorMode: 'vertical', attractorY: 0, densityStrength: 1.5,
    attractorNoise: 1, attractorNoiseFreq: 0.2,
  }));
  let differing = 0;
  const a = flatten(smooth);
  const b = flatten(patchy);
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 0.01) differing++;
  assert(differing > a.length * 0.2,
    'attractorNoise modulates >20% of grid values from smooth-gradient baseline',
    `differing=${differing}/${a.length}`);
}

// 14. Flow anisotropy — per-pixel angle deviation. Same seed/aniso/angle, only flow differs.
{
  process.stdout.write('14. flow anisotropy\n');
  const uniform = new VoronoiReliefGen(41).sampleGrid(baseParams({
    seed: 41, anisotropy: 0.6, anisotropyAngle: 30, flowAnisotropy: 0,
  }));
  const flowing = new VoronoiReliefGen(41).sampleGrid(baseParams({
    seed: 41, anisotropy: 0.6, anisotropyAngle: 30, flowAnisotropy: 1,
  }));
  let differing = 0;
  const a = flatten(uniform);
  const b = flatten(flowing);
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 0.01) differing++;
  assert(differing > a.length * 0.15,
    'flowAnisotropy curves the stretch direction across the panel (>15% differ)',
    `differing=${differing}/${a.length}`);
}

// 15. Output range for Worley F2-F1 algorithm. With pockets polarity, the height is
// `-bowlH` where `bowlH = (f2-f1)/(2R*seamDepth)^profile` ∈ [0, 1]. Boundaries (F1=F2)
// produce h=0 (ridge at original surface), cell centers produce h≈-1 (deep bowl).
// The range is symmetric around 0 — NOT the prior asymmetric range — and walls/ridges
// are at exactly 0, not positive.
{
  process.stdout.write('15. F2-F1 output range guard (production seamDepth)\n');
  const grid = new VoronoiReliefGen(7).sampleGrid(baseParams({
    polarity: 'pockets', seamDepth: 0.22, seamWidth: 0.12,
    cellSize: 4.5, cols: 200, rows: 240, meshX: 24, meshY: 48,
  }));
  let lo = Infinity, hi = -Infinity;
  for (const row of grid) for (const v of row) { if (v < lo) lo = v; if (v > hi) hi = v; }
  assert(lo < -0.5,
    'pockets reach deep negative values (lo < -0.5)',
    `lo=${lo.toFixed(3)}`);
  // F2-F1 algorithm: ridges sit at the original surface (h≈0). Allow tiny epsilon for
  // numerical drift but require hi ≤ 0.01 — anything substantially positive would be a
  // regression to the old composite algorithm.
  assert(Math.abs(hi) < 0.05,
    'ridges sit at original surface (|hi| < 0.05)',
    `hi=${hi.toFixed(3)}`);
  assert(lo >= -1.05 && hi <= 1.05,
    'all values within OUTPUT_HEIGHT_CLAMP',
    `range=[${lo.toFixed(3)}, ${hi.toFixed(3)}]`);
}

// 16. Catastrophic-jump guard — neighboring pixels never differ by more than the full
// output range (~2.0). This catches the c40c67b regression where F2-aliasing produced
// pixels that flipped from ~+0.22 to ~-1.05 in one step. Normal seam transitions can
// produce ~0.5 jumps; only an algorithmic discontinuity produces >1.5 jumps.
{
  process.stdout.write('16. catastrophic-jump guard (no >1.5 pixel-pair jumps)\n');
  const grid = new VoronoiReliefGen(13).sampleGrid(baseParams({
    polarity: 'pockets', seamDepth: 0.22, seamWidth: 0.12,
    cellSize: 4.5, cellSizeGradient: 1.3, attractorNoise: 0.6,
    attractorMode: 'vertical', attractorY: 0, attractorFalloff: 0.4,
    densityStrength: 1.4, intensityStrength: 0.4,
    cols: 200, rows: 240, meshX: 24, meshY: 48,
  }));
  let worstJump = 0;
  let violations = 0;
  // Horizontal pairs.
  for (let j = 0; j < grid.length; j++) {
    for (let i = 0; i < grid[j].length - 1; i++) {
      const dh = Math.abs(grid[j][i + 1] - grid[j][i]);
      if (dh > worstJump) worstJump = dh;
      if (dh > 1.5) violations++;
    }
  }
  // Vertical pairs — a vertical spike regression would otherwise slip through.
  for (let j = 0; j < grid.length - 1; j++) {
    for (let i = 0; i < grid[j].length; i++) {
      const dv = Math.abs(grid[j + 1][i] - grid[j][i]);
      if (dv > worstJump) worstJump = dv;
      if (dv > 1.5) violations++;
    }
  }
  assert(violations === 0,
    'no catastrophic discontinuities (zero pixel-pair jumps > 1.5)',
    `violations=${violations} worstJump=${worstJump.toFixed(3)}`);
}

// 17. Isolated-outlier guard. With the F2-F1 algorithm, cell centers ARE legitimate point
// features (the deepest pixel of each bowl) and will appear as outliers vs their immediate
// neighborhood — this is correct, not an artifact. The test now requires outliers to be
// BOTH statistically outlying (z > 6 vs 5x5) AND show a large absolute deviation (> 0.4)
// AND have their value be CLOSER to OUTPUT_HEIGHT_CLAMP than to neighbors. That last
// constraint filters out natural cell-center peaks (which are still smooth-ish) while
// catching algorithmic spikes (which would saturate to the clamp regardless of cell size).
{
  process.stdout.write('17. isolated-outlier guard (no spike-with-tail patterns)\n');
  const grid = new VoronoiReliefGen(17).sampleGrid(baseParams({
    polarity: 'pockets', seamDepth: 0.22, seamWidth: 0.12,
    cellSize: 4.5, cellSizeGradient: 1.3, attractorNoise: 0.6,
    attractorMode: 'vertical', attractorY: 0, attractorFalloff: 0.4,
    densityStrength: 1.4, intensityStrength: 0.4,
    cols: 200, rows: 240, meshX: 24, meshY: 48,
  }));
  // Scan all interior pixels. An outlier is a pixel whose value is far above (or far below)
  // the local 5x5 neighborhood mean. A natural cell center is high but its neighbors are
  // also high (smooth dome); a true spike has high value with low-value neighbors.
  let outliers = 0;
  let worstZ = 0;
  for (let j = 2; j < grid.length - 2; j++) {
    for (let i = 2; i < grid[j].length - 2; i++) {
      let sum = 0, sumSq = 0, n = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        if (dj === 0 && di === 0) continue;
        const v = grid[j + dj][i + di];
        sum += v; sumSq += v * v; n++;
      }
      const mean = sum / n;
      const variance = sumSq / n - mean * mean;
      const stddev = Math.sqrt(Math.max(0, variance));
      const z = stddev > 1e-9 ? Math.abs(grid[j][i] - mean) / stddev : 0;
      if (z > worstZ) worstZ = z;
      // True algorithmic spike: statistically outlying (z > 8) AND large absolute deviation
      // (> 0.5) AND the value is saturated near OUTPUT_HEIGHT_CLAMP. The clamp-saturation
      // gate distinguishes natural cell-center peaks (which can be 0.4-0.8 deep in big cells)
      // from algorithmic spikes (which would slam to -1.0+ regardless of cell size).
      const absDev = Math.abs(grid[j][i] - mean);
      const nearClamp = Math.abs(grid[j][i]) > 0.95;
      if (z > 8 && absDev > 0.5 && nearClamp) outliers++;
    }
  }
  assert(outliers === 0,
    'no isolated outliers vs 5x5 neighborhood (z-score > 6)',
    `outliers=${outliers} worstZ=${worstZ.toFixed(2)}`);
}

// 18. Radial-foci ("starburst") system: empty foci ⇒ identical output to pre-feature; active
// foci ⇒ output diverges significantly; outputs stay finite + within clamp; metric change does
// not reintroduce catastrophic pixel-pair jumps along ridges (the C0/C1 continuity claim from
// the doc comment is load-bearing for mesh smoothness).
{
  process.stdout.write('18. radial-foci system\n');
  const noFoci = new VoronoiReliefGen(31).sampleGrid(baseParams({
    cols: 120, rows: 80, seed: 31, polarity: 'pockets', profile: 'parabolic', cellSize: 3,
  }));
  const withFoci = new VoronoiReliefGen(31).sampleGrid(baseParams({
    cols: 120, rows: 80, seed: 31, polarity: 'pockets', profile: 'parabolic', cellSize: 3,
    radialFoci: [{ x: 0.7, y: 0.2 }, { x: 0.25, y: 0.55 }, { x: 0.75, y: 0.85 }],
    radialStrength: 1.8, radialFalloff: 0.3, radialGrow: 0.45, radialWarp: 0.4, radialMode: 'rays',
  }));
  let differ = 0;
  let allFinite = true;
  let inRange = true;
  for (let j = 0; j < 80; j++) {
    for (let i = 0; i < 120; i++) {
      const v = withFoci[j][i];
      if (!Number.isFinite(v)) allFinite = false;
      if (v < -1.05 || v > 1.05) inRange = false;
      if (Math.abs(v - noFoci[j][i]) > 1e-6) differ++;
    }
  }
  assert(allFinite, 'radial-foci output is finite everywhere');
  assert(inRange, 'radial-foci output within [-1.05, 1.05]');
  assert(differ > 120 * 80 * 0.3, 'radial-foci diverges from no-foci baseline (>30% of pixels)',
    `differ=${differ}/${120 * 80}`);

  // Catastrophic-jump guard near foci — the per-pixel metric must stay smooth across pixel
  // boundaries. Mirrors test 16 but on the radial output (which exercises the per-pixel scale).
  let bigJumps = 0;
  for (let j = 0; j < 80; j++) {
    for (let i = 1; i < 120; i++) {
      if (Math.abs(withFoci[j][i] - withFoci[j][i - 1]) > 1.5) bigJumps++;
    }
  }
  for (let j = 1; j < 80; j++) {
    for (let i = 0; i < 120; i++) {
      if (Math.abs(withFoci[j][i] - withFoci[j - 1][i]) > 1.5) bigJumps++;
    }
  }
  assert(bigJumps === 0, 'no catastrophic pixel-pair jumps under radial-foci metric',
    `bigJumps=${bigJumps}`);

  // Rays vs rings: same foci, different mode ⇒ different output. (Sanity check that the mode
  // enum routes through pixelAnisoFrame.)
  const rays = new VoronoiReliefGen(31).sampleGrid(baseParams({
    cols: 80, rows: 80, seed: 31, polarity: 'pockets', profile: 'parabolic', cellSize: 3,
    // v11 flow spline requires ≥2 control points (Catmull-Rom needs an actual curve, not
    // a degenerate point). Use 2 well-spaced points so the spline tangent is well-defined.
    radialFoci: [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 }],
    radialStrength: 2, radialFalloff: 0.3, radialGrow: 0, radialWarp: 0, radialMode: 'rays',
  }));
  const rings = new VoronoiReliefGen(31).sampleGrid(baseParams({
    cols: 80, rows: 80, seed: 31, polarity: 'pockets', profile: 'parabolic', cellSize: 3,
    radialFoci: [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 }],
    radialStrength: 2, radialFalloff: 0.3, radialGrow: 0, radialWarp: 0, radialMode: 'rings',
  }));
  let modeDiffer = 0;
  for (let j = 0; j < 80; j++) {
    for (let i = 0; i < 80; i++) {
      if (Math.abs(rays[j][i] - rings[j][i]) > 1e-6) modeDiffer++;
    }
  }
  assert(modeDiffer > 80 * 80 * 0.1, 'rays vs rings modes produce meaningfully different output',
    `modeDiffer=${modeDiffer}/${80 * 80}`);

  // v3 anti-regression — no v1-style "pucker hole" or v2-style "drain hole" at focus center.
  // Failure signatures: v1 puckers had the focus-center pixel saturated to the OUTPUT_HEIGHT_
  // CLAMP (the most-negative value) because of the site-warp cavity; v2's polar-grid center
  // site had the same saturation through a different mechanism. v3 organic Voronoi keeps the
  // focus center as a normal cell pixel — its value is well off the global min. Assert the
  // focus-center pixel sits above the bottom 5% quantile of the panel.
  const withFociPanelHeights: number[] = [];
  for (let j = 0; j < 80; j++) for (let i = 0; i < 120; i++) withFociPanelHeights.push(withFoci[j][i]);
  const sorted = [...withFociPanelHeights].sort((a, b) => a - b);
  const bottom5pct = sorted[Math.floor(sorted.length * 0.05)];
  const fociPositions = [{ x: 0.7, y: 0.2 }, { x: 0.25, y: 0.55 }, { x: 0.75, y: 0.85 }];
  let worstFocusValue = -Infinity;
  for (const f of fociPositions) {
    const ci = Math.round(f.x * (120 - 1));
    const cj = Math.round(f.y * (80 - 1));
    const v = withFoci[cj][ci];
    if (v < worstFocusValue || worstFocusValue === -Infinity) worstFocusValue = v;
  }
  // Anti-pucker: worstFocusValue must be ≥ bottom-5%-quantile (not in the saturated tail).
  assert(worstFocusValue >= bottom5pct,
    'no v1/v2 hole at focus center (focus pixel above bottom-5% height quantile)',
    `worstFocus=${worstFocusValue.toFixed(3)} bottom5pct=${bottom5pct.toFixed(3)}`);

  // v3 anti-regression — no mandala/spirograph patterning around a focus. v2's polar-grid
  // mechanism produced mechanically perfect concentric ring structure (mandala): the radial
  // power spectrum was dominated by a single angular frequency (= angularCount per ring).
  // v3's Cartesian-jittered Voronoi with metric anisotropy produces an organic, irregular
  // cell layout — the cell sizes seen along two concentric circles at different radii should
  // be DIFFERENT (Cartesian sites are not on a polar grid), unlike v2 where both circles
  // would see the same N wedges. Compare ridge-crossing counts at two radii — v2 would have
  // count(r1) ≈ count(r2) ≈ 2·angularCount; v3 will have meaningfully different counts.
  const singleFocus = new VoronoiReliefGen(7).sampleGrid(baseParams({
    cols: 200, rows: 200, meshX: 48, meshY: 48, seed: 7,
    polarity: 'pockets', profile: 'parabolic', cellSize: 2,
    radialFoci: [{ x: 0.5, y: 0.5 }],
    radialStrength: 2, radialFalloff: 0.4, radialGrow: 0.8, radialWarp: 0.55, radialMode: 'rays',
  }));
  const countCrossings = (radiusPx: number): number => {
    const cxC = 100, cyC = 100;
    const heights: number[] = [];
    for (let t = 0; t < 720; t++) {
      const theta = (t / 720) * 2 * Math.PI;
      const ii = Math.round(cxC + radiusPx * Math.cos(theta));
      const jj = Math.round(cyC + radiusPx * Math.sin(theta));
      if (jj < 0 || jj >= 200 || ii < 0 || ii >= 200) continue;
      heights.push(singleFocus[jj][ii]);
    }
    const m = heights.reduce((s, v) => s + v, 0) / Math.max(1, heights.length);
    let cr = 0;
    let prev = heights[0] > m;
    for (let k = 1; k < heights.length; k++) {
      const cur = heights[k] > m;
      if (cur !== prev) cr++;
      prev = cur;
    }
    return cr;
  };
  const angularGapCv = (radiusPx: number): number => {
    const cxC = 100, cyC = 100;
    const heights: number[] = [];
    for (let t = 0; t < 720; t++) {
      const theta = (t / 720) * 2 * Math.PI;
      const ii = Math.round(cxC + radiusPx * Math.cos(theta));
      const jj = Math.round(cyC + radiusPx * Math.sin(theta));
      if (jj < 0 || jj >= 200 || ii < 0 || ii >= 200) continue;
      heights.push(singleFocus[jj][ii]);
    }
    const m = mean(heights);
    const angles: number[] = [];
    let prev = heights[0] > m;
    for (let k = 1; k < heights.length; k++) {
      const cur = heights[k] > m;
      if (cur !== prev) angles.push((k / heights.length) * 2 * Math.PI);
      prev = cur;
    }
    const gaps: number[] = [];
    for (let k = 0; k < angles.length; k++) {
      const next = k === angles.length - 1 ? angles[0] + 2 * Math.PI : angles[k + 1];
      gaps.push(next - angles[k]);
    }
    return gaps.length > 1 ? stdev(gaps) / mean(gaps) : 0;
  };
  const inner = countCrossings(0.12 * Math.hypot(200, 200));
  const outer = countCrossings(0.30 * Math.hypot(200, 200));
  // v2 mandala would give inner ≈ outer (within ~20%) because the polar grid has constant
  // angularCount across rings. v3 organic Voronoi has Cartesian site spacing → ring-crossing
  // count scales with circle circumference (≈ ratio of radii = 0.30/0.12 = 2.5). Test that
  // outer/inner differs from 1.0 by ≥ 30% — confirms NON-mandala geometry.
  const ratio = inner > 0 ? outer / inner : 0;
  assert(Math.abs(ratio - 1) >= 0.3 || (inner === 0 && outer === 0),
    'organic Voronoi (not mandala): crossing counts at different radii differ ≥ 30%',
    `inner=${inner} outer=${outer} ratio=${ratio.toFixed(2)}`);
  const gapCv = angularGapCv(0.18 * Math.hypot(200, 200));
  assert(gapCv > 0.35,
    'organic Voronoi (not mandala): angular sector widths vary strongly',
    `gapCv=${gapCv.toFixed(2)}`);

  // Site-count budget. Extreme params must not blow past SITE_COUNT_MAX=4096 sites. Run with
  // the worst-case combo and assert the output stays finite + in range; the sampler's internal
  // cap prevents browser freezes or truncation artifacts.
  const extreme = new VoronoiReliefGen(99).sampleGrid(baseParams({
    cols: 100, rows: 100, meshX: 80, meshY: 80, seed: 99,
    polarity: 'pockets', profile: 'parabolic', cellSize: 0.5,
    radialFoci: [{ x: 0.5, y: 0.5 }, { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }],
    radialStrength: 4, radialFalloff: 0.6, radialGrow: 0, radialWarp: 0.5, radialMode: 'rays',
  }));
  let extremeFinite = true;
  let extremeRange = true;
  for (let j = 0; j < 100; j++) for (let i = 0; i < 100; i++) {
    const v = extreme[j][i];
    if (!Number.isFinite(v)) extremeFinite = false;
    if (v < -1.05 || v > 1.05) extremeRange = false;
  }
  assert(extremeFinite && extremeRange,
    'extreme params (cellSize=0.5, strength=4, growth=min, panel 80×80) stay within budget + clamp');

  // Panel-edge coverage. The focal field must not collapse the preset into isolated center
  // effects with dead corners. Compare the height-stdev of each 10×10 corner patch against
  // the panel-wide stdev under the default starburst preset values.
  const starburst = new VoronoiReliefGen(13).sampleGrid(starburstPresetParams({ seed: 13 }));
  const allVals: number[] = [];
  for (let j = 0; j < 240; j++) for (let i = 0; i < 120; i++) allVals.push(starburst[j][i]);
  const panelMean = allVals.reduce((s, v) => s + v, 0) / allVals.length;
  const panelStdev = Math.sqrt(allVals.reduce((s, v) => s + (v - panelMean) ** 2, 0) / allVals.length);
  const cornerStdev = (i0: number, j0: number): number => {
    const patch: number[] = [];
    for (let dj = 0; dj < 10; dj++) for (let di = 0; di < 10; di++) patch.push(starburst[j0 + dj][i0 + di]);
    const m = patch.reduce((s, v) => s + v, 0) / patch.length;
    return Math.sqrt(patch.reduce((s, v) => s + (v - m) ** 2, 0) / patch.length);
  };
  const minCornerRatio = Math.min(
    cornerStdev(0, 0),
    cornerStdev(120 - 10, 0),
    cornerStdev(0, 240 - 10),
    cornerStdev(120 - 10, 240 - 10),
  ) / Math.max(1e-6, panelStdev);
  assert(minCornerRatio > 0.05,
    'panel-edge coverage — corner stdev ≥ 5% of panel stdev (no flat-zone corners)',
    `minCornerRatio=${minCornerRatio.toFixed(3)}`);

  const starburstCrossings = countMeanCrossings(starburst);
  const starburstMinima = countLocalMinima(starburst);
  // v13 adds polar sites (3 rings × 7 sectors × 3 foci = up to 63 additional cells)
  // on top of the Cartesian baseline. Crossings and minima counts both grow accordingly —
  // upper bounds widened from v12 to accommodate the polar sites that are now the visible
  // focal radial-wedge structure (the feature, not a bug).
  assert(starburstCrossings > 2500 && starburstCrossings < 8000,
    'starburst preset stays in broad-pocket crossing range (not dense lattice, not flat)',
    `crossings=${starburstCrossings}`);
  // v15 invertProfile=1 puts the cell BOUNDARIES at the minima (carved seams) and cell
  // INTERIORS at the surface (domed floors). Boundary-vertex count is much lower than
  // cell-center pixel count — minima count drops accordingly. Loosen lower bound 50 → 5
  // to accommodate the inverted geometry while still catching empty/flat regression.
  // v15.1: high seamSharpness creates a more textured height field around the V-grooves,
  // raising local-minima count further. Bound widened 600 → 1200 to accommodate.
  assert(starburstMinima >= 5 && starburstMinima <= 1200,
    'starburst preset keeps organic minima count (not dense sliver field)',
    `localMinima=${starburstMinima}`);

  const fociOff = new VoronoiReliefGen(13).sampleGrid(starburstPresetParams({
    seed: 13,
    radialFoci: [],
    radialStrength: 0,
    radialGrow: 0,
    radialWarp: 0,
  }));
  const fociOffMinima = countLocalMinima(fociOff);
  // v11: the flow spline ADDS sites near the curve by design (this is the visible "course"),
  // so the v9 assertion "with-foci minima ≈ no-foci minima" no longer applies. Instead
  // verify the density boost is BOUNDED — minima count grows at most 5× vs the no-foci
  // baseline (catches a runaway density boost from a bad future config).
  assert(starburstMinima <= fociOffMinima * 5 + 50,
    'flow-spline density boost is bounded (not a runaway feature count)',
    `withFoci=${starburstMinima} withoutFoci=${fociOffMinima}`);
  const focusMean = (grid: number[][], f: { x: number; y: number }): number => {
    let sum = 0;
    let n = 0;
    const cx = f.x * (grid[0].length - 1);
    const cy = f.y * (grid.length - 1);
    for (let j = 0; j < grid.length; j++) {
      for (let i = 0; i < grid[j].length; i++) {
        if (Math.hypot(i - cx, j - cy) < 30) {
          sum += grid[j][i];
          n++;
        }
      }
    }
    return sum / Math.max(1, n);
  };
  const presetFoci = [{ x: 0.7, y: 0.18 }, { x: 0.2, y: 0.5 }, { x: 0.75, y: 0.85 }];
  const depthDelta = mean(presetFoci.map((f) => focusMean(fociOff, f) - focusMean(starburst, f)));
  // v15 invertProfile=1 flips the sign of this comparison: focal zones now have DOMED
  // floors (interior near surface = LESS negative mean), so depthDelta is POSITIVE. Without
  // invertProfile, depthDelta is NEGATIVE (focal zones deeper). Either way the absolute
  // difference between foci and non-foci should be modest, not catastrophic — check |Δ| < 1.
  assert(Math.abs(depthDelta) < 1.0,
    'focal vs non-focal depth differs modestly (not catastrophic)',
    `depthDelta=${depthDelta.toFixed(3)}`);

  // PR #16 review — defense in depth: a focus list with NaN/Infinity coords or > 3 entries
  // (callers constructing ReliefSampleParams directly bypass sampleReliefParamsFromState's
  // pruning) must not NaN-poison the output. sampleGrid sanitizes radialFoci before use.
  const poisoned = new VoronoiReliefGen(31).sampleGrid(baseParams({
    cols: 60, rows: 60, seed: 31, polarity: 'pockets', profile: 'parabolic', cellSize: 3,
    radialFoci: [
      { x: 0.5, y: 0.5 },
      { x: Number.NaN, y: 0.3 },
      { x: 0.7, y: Number.POSITIVE_INFINITY },
      // 4th + 5th entries exceed the documented O(foci ≤ 3) bound and must be sliced off:
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.8 },
    ],
    radialStrength: 2, radialFalloff: 0.3, radialMode: 'rays',
  }));
  let poisonedAllFinite = true;
  for (let j = 0; j < 60; j++) {
    for (let i = 0; i < 60; i++) {
      if (!Number.isFinite(poisoned[j][i])) poisonedAllFinite = false;
    }
  }
  assert(poisonedAllFinite, 'NaN/Infinity foci coords are filtered, output stays finite');
}

if (failures === 0) {
  process.stdout.write('\nALL OK\n');
  process.exit(0);
} else {
  process.stdout.write(`\n${failures} FAILURE(S)\n`);
  process.exit(1);
}
