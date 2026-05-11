/**
 * VoronoiReliefGen — grid-aware 3D Voronoi cell relief sampler.
 *
 * Reproduces lafabricatrun-style 3D cellular wood carvings: smooth domed cells with
 * deep V-seams between them, optionally fading into a smooth wave field via a spatial
 * attractor. Cannot be expressed as a per-pixel scalar field because each cell needs
 * an identity (which site does this sample belong to?) and a per-cell radius (how big
 * is THIS cell vs its neighbors?).
 *
 * Algorithm:
 *   1. Site generation — jittered grid in physical units, density modulated by attractor.
 *   2. Lloyd relaxation — 0–2 passes via low-discrepancy Halton sampling, smooths cell sizes.
 *   3. Pass 1 over the output grid — find F1 and owning site for every (x,y); accumulate
 *      mean F1 per site.
 *   4. Per-cell radius — R ≈ 2 × mean F1 (mean F1 inside a roughly disc-shaped Voronoi cell
 *      ≈ R/2). Clamps when too few samples per cell.
 *   5. Pass 2 over the grid — re-sample F1, F2, owner; combine dome + seam + attractor mask
 *      + optional smooth-wave base field; clamp to ~[-1, 1].
 *
 * Output is in noise-native range; the standard CNC-z normalization in mesh.ts handles
 * the rest. Domain warp is intentionally skipped for relief — warping discrete cells
 * tears them visually.
 */
import type {
  ReliefAttractorMode,
  ReliefBaseMode,
  ReliefGenerator,
  ReliefPolarity,
  ReliefProfile,
  ReliefSampleParams,
} from '../types';
import { SimplexNoiseGen } from './generators';

// Tuning constants — kept central so future work has one place to edit.
const LLOYD_SAMPLE_BUDGET_MAX = 8192;
const LLOYD_SAMPLES_PER_SITE = 64;
const WAVE_GEN_SEED_OFFSET = 17;
const WAVE_NOISE_FREQUENCY = 0.1;
const WAVE_AMPLITUDE = 0.5;
const ANISOTROPY_SCALE_MULTIPLIER = 1.5;
const OUTPUT_CLAMP = 1.05;
// transitionSoftness=0 → exponent 0.2 (cells take over abruptly).
// transitionSoftness=1 → exponent 2.0 (gradual lerp from waves to cells).
const TRANSITION_EXPONENT_MIN = 0.2;
const TRANSITION_EXPONENT_MAX = 2.0;
// Hard caps to prevent DoS via crafted params. Both passes are O(rows·cols·sites);
// at ~107K pixels and the SITE_COUNT_MAX below, two passes ≈ 870M ops → ~1s on
// modern hardware. Anything beyond this either freezes the tab or produces a
// mesh that's noisier than the underlying CNC tool can resolve anyway.
const SITE_COUNT_MAX = 4096;
const LOCAL_DENSITY_MAX = 4;

/** Deterministic per-seed PRNG (mulberry32) — better distribution than sin-hash for site jitter. */
function mulberry32(seed: number): () => number {
  let t = (seed | 0) >>> 0;
  return (): number => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

interface Site {
  x: number;
  y: number;
  /** Per-cell scale derived from average F1 inside the cell (set after grid sweep). */
  radius: number;
  /** Running mean accumulator for radius computation. */
  _radiusSum: number;
  _radiusN: number;
}

/** smoothstep(edge0, edge1, x) clamped — standard GLSL semantics. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Compute the spatial-attractor mask in [0, 1] for a normalized (u, v) ∈ [0, 1]². */
function attractorMask(
  mode: ReliefAttractorMode,
  u: number,
  v: number,
  ax: number,
  ay: number,
  radius: number,
  falloff: number,
): number {
  if (mode === 'none') return 1;
  if (mode === 'vertical') {
    // Distance from the attractor anchor along Y, clamped to [0, 1] then sharpened by falloff.
    // This makes `attractorY` a real directional control: 0 = peak at viewport bottom (matches
    // lafabrica wall-panel orientation — dense cells gravitate to the bottom edge), 1 = peak at
    // viewport top, 0.5 = peak band running across the middle. Falloff sharpens or broadens.
    const dy = Math.abs(v - ay);
    return Math.pow(Math.max(0, 1 - dy), Math.max(0.05, falloff));
  }
  if (mode === 'horizontal') {
    const dx = Math.abs(u - ax);
    return Math.pow(Math.max(0, 1 - dx), Math.max(0.05, falloff));
  }
  // radial / point share the same distance-to-anchor formula.
  const dx = u - ax;
  const dy = v - ay;
  const d = Math.sqrt(dx * dx + dy * dy);
  const r = Math.max(0.001, radius);
  // falloff shapes the smoothstep curve for radial/point modes — < 1 broadens, > 1 sharpens.
  const shapedFalloff = Math.max(0.05, falloff);
  if (mode === 'radial') {
    // Inside radius → 1; outside falls off — high density at center, sparse at edge.
    return Math.pow(1 - smoothstep(r * 0.5, r, d), shapedFalloff);
  }
  // 'point': inverse — sparse at center, dense outside (useful for vignette/border patterns).
  return Math.pow(smoothstep(r * 0.5, r, d), shapedFalloff);
}

/** Generate a roughly-uniform jittered grid of sites scaled by the attractor mask.
 *  When `warpDistortion > 0`, a SimplexNoise warp field displaces site positions so the
 *  Voronoi grid flows organically with the noise pipeline (matches lafabrica panels where
 *  cells curve around the panel rather than gridding). */
function generateSites(p: ReliefSampleParams, rand: () => number, warpGen: SimplexNoiseGen | null): Site[] {
  const { meshX, meshY, cellSize, jitter } = p;
  // baseSpacing converts cellSize (avg cell diameter) to grid spacing for site placement.
  const baseSpacing = Math.max(0.2, cellSize);
  // Grid count along each axis; +2 padding so border cells don't pinch.
  const nx = Math.max(2, Math.ceil(meshX / baseSpacing) + 1);
  const ny = Math.max(2, Math.ceil(meshY / baseSpacing) + 1);
  const sx = meshX / nx;
  const sy = meshY / ny;

  // Warp tuning: amplitude scales with cellSize so warp displacement is visible relative
  // to grid spacing but never large enough to push sites off-panel before the clamp.
  const warpAmp = warpGen ? p.warpDistortion * baseSpacing * 0.7 : 0;
  const warpFreq = Math.max(0.02, p.warpFrequency);

  const sites: Site[] = [];
  // Hard caps: defense in depth on top of state.ts URL clamps. SITE_COUNT_MAX bounds the
  // O(rows·cols·sites) cost of both passes; LOCAL_DENSITY_MAX prevents a single cell from
  // exploding even if densityStrength sneaks past the URL clamp via tests/future code paths.
  outer: for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = (i + 0.5) * sx;
      const cy = (j + 0.5) * sy;
      // Density attractor decides whether to keep this site (subsample) or split it (oversample).
      const u = cx / meshX;
      const v = cy / meshY;
      const mask = attractorMask(
        p.attractorMode, u, v, p.attractorX, p.attractorY,
        p.attractorRadius, p.attractorFalloff,
      );
      const localDensity = Math.max(0, Math.min(LOCAL_DENSITY_MAX, 1 + p.densityStrength * mask));
      // Stochastic acceptance: density 1 keeps all, density 2 doubles via extra in-cell sample.
      const reps = Math.floor(localDensity) + (rand() < (localDensity - Math.floor(localDensity)) ? 1 : 0);
      for (let k = 0; k < reps; k++) {
        if (sites.length >= SITE_COUNT_MAX) break outer;
        const jx = (rand() - 0.5) * jitter * sx;
        const jy = (rand() - 0.5) * jitter * sy;
        let px = cx + jx;
        let py = cy + jy;
        // Domain warp on site positions — shifts the whole grid by a smoothly-varying field
        // so cells curve and flow rather than tile uniformly.
        if (warpGen && warpAmp > 0) {
          const wx = warpGen.noise(px * warpFreq, py * warpFreq);
          const wy = warpGen.noise(px * warpFreq + 31.7, py * warpFreq + 17.3);
          px += wx * warpAmp;
          py += wy * warpAmp;
        }
        sites.push({
          x: Math.max(0, Math.min(meshX, px)),
          y: Math.max(0, Math.min(meshY, py)),
          radius: 0,
          _radiusSum: 0,
          _radiusN: 0,
        });
      }
    }
  }
  return sites;
}

/** One pass of Lloyd relaxation — moves each site toward the centroid of its assigned samples. */
function lloydRelax(sites: Site[], p: ReliefSampleParams, samples: number): void {
  const { meshX, meshY } = p;
  const sumX = new Float64Array(sites.length);
  const sumY = new Float64Array(sites.length);
  const counts = new Int32Array(sites.length);
  // Use a low-discrepancy sample set instead of full grid for speed (samples ~4096 typical).
  for (let s = 0; s < samples; s++) {
    // Halton(2, 3) for low-discrepancy coverage.
    const x = halton(s + 1, 2) * meshX;
    const y = halton(s + 1, 3) * meshY;
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < sites.length; i++) {
      const dx = sites[i].x - x;
      const dy = sites[i].y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; bestIdx = i; }
    }
    sumX[bestIdx] += x;
    sumY[bestIdx] += y;
    counts[bestIdx]++;
  }
  for (let i = 0; i < sites.length; i++) {
    if (counts[i] > 0) {
      sites[i].x = sumX[i] / counts[i];
      sites[i].y = sumY[i] / counts[i];
    }
  }
}

function halton(index: number, base: number): number {
  let result = 0;
  let f = 1 / base;
  let i = index;
  while (i > 0) {
    result += f * (i % base);
    i = Math.floor(i / base);
    f /= base;
  }
  return result;
}

/** Return the dome contribution at radial distance d from a site of effective radius R. */
function domeHeight(profile: ReliefProfile, d: number, R: number): number {
  if (R <= 0) return 0;
  const t = Math.min(1, d / R);
  if (profile === 'hemisphere') {
    const inside = 1 - t * t;
    return inside > 0 ? Math.sqrt(inside) : 0;
  }
  if (profile === 'cosine') {
    return Math.cos(t * Math.PI * 0.5);
  }
  // parabolic
  return Math.max(0, 1 - t * t);
}

/** Find F1, F2 and the index of the nearest site, with optional anisotropic distance metric.
 *  Distance is computed in the rotated anisotropy frame: rotation preserves length, so we
 *  scale x' and take hypot directly without rotating back. */
function nearestTwo(
  sites: Site[],
  x: number,
  y: number,
  cosA: number,
  sinA: number,
  anisotropyScale: number,
): { f1: number; f2: number; idx: number; idx2: number } {
  let f1 = Infinity;
  let f2 = Infinity;
  let idx = 0;
  let idx2 = 0;
  const isotropic = anisotropyScale === 1;
  for (let i = 0; i < sites.length; i++) {
    const dx = x - sites[i].x;
    const dy = y - sites[i].y;
    let d: number;
    if (isotropic) {
      d = Math.hypot(dx, dy);
    } else {
      const xr = dx * cosA + dy * sinA;
      const yr = -dx * sinA + dy * cosA;
      d = Math.hypot(xr * anisotropyScale, yr);
    }
    if (d < f1) { f2 = f1; idx2 = idx; f1 = d; idx = i; }
    else if (d < f2) { f2 = d; idx2 = i; }
  }
  return { f1, f2, idx, idx2 };
}

export class VoronoiReliefGen implements ReliefGenerator {
  readonly kind = 'voronoi-relief' as const;
  /** Fallback seed for callers that ignore the params struct (none in current pipeline). */
  private fallbackSeed: number;

  constructor(seed: number) {
    this.fallbackSeed = seed;
  }

  /** Per-pixel noise() not meaningful for relief — return 0 for any caller that ignores `kind`. */
  noise(): number { return 0; }

  sampleGrid(p: ReliefSampleParams): number[][] {
    // Use the per-call seed from params (the canonical source — STATE.seed flows through
    // sampleReliefParamsFromState into p.seed). Fall back to constructor seed only if
    // p.seed is missing (defensive — currently never happens).
    const seed = (p.seed ?? this.fallbackSeed) >>> 0;
    const rand = mulberry32(seed);
    // Re-seed the wave generator per call so same p.seed → same wave field even when the
    // generator instance is reused across renders.
    const waveGen = new SimplexNoiseGen(seed + WAVE_GEN_SEED_OFFSET);
    // Separate warp generator (only created when distortion > 0) — driven by the global
    // distortion/warpFreq sliders so the existing noise UI integrates with relief mode.
    const warpGen = p.warpDistortion > 0
      ? new SimplexNoiseGen(seed + WAVE_GEN_SEED_OFFSET + 13)
      : null;
    // Patchy modulator for the attractor mask — produces random "blob" zones of
    // density/intensity instead of a smooth linear gradient. Off when attractorNoise=0.
    const attractorNoiseGen = p.attractorNoise > 0
      ? new SimplexNoiseGen(seed + WAVE_GEN_SEED_OFFSET + 29)
      : null;
    // Flow field for per-pixel anisotropy direction — drives organic stretched-in-different-
    // directions look. Off when flowAnisotropy=0; otherwise creates two noise channels
    // (ang + freq variation) so cell orientation curves smoothly across the panel.
    const flowGen = p.flowAnisotropy > 0
      ? new SimplexNoiseGen(seed + WAVE_GEN_SEED_OFFSET + 47)
      : null;
    const sites = generateSites(p, rand, warpGen);
    if (sites.length === 0) {
      // Defensive: empty cellgrid → flat field.
      const empty: number[][] = [];
      for (let j = 0; j < p.rows; j++) empty.push(new Array(p.cols).fill(0));
      return empty;
    }

    // Lloyd relaxation passes (default 1, max 2). Defensive clamp — STATE is the canonical
    // source, but params may originate from URLs, tests, or future callers. Hard-cap at 2
    // to prevent a denial-of-service via a crafted share link.
    const relaxIters = Math.max(0, Math.min(2, Math.floor(p.relaxIterations) || 0));
    const lloydSamples = Math.min(LLOYD_SAMPLE_BUDGET_MAX, sites.length * LLOYD_SAMPLES_PER_SITE);
    for (let r = 0; r < relaxIters; r++) {
      lloydRelax(sites, p, lloydSamples);
    }

    const aAngle = p.anisotropyAngle * Math.PI / 180;
    const cosA = Math.cos(aAngle);
    const sinA = Math.sin(aAngle);
    // anisotropyScale > 1 squashes along the angle's perpendicular → elongated cells along the angle axis.
    const anisotropyScale = 1 + p.anisotropy * ANISOTROPY_SCALE_MULTIPLIER;

    // Hoisted + clamped wave-mode params. transitionSoftness must stay in [0, 1] —
    // negative values would make the exponent ≤ 0 and `Math.pow(0, ≤0)` = Infinity,
    // which the non-finite guard later flattens to 0, punching dead bands into the mesh.
    const transitionSoftness = Math.max(0, Math.min(1, p.transitionSoftness));
    const transitionExponent = TRANSITION_EXPONENT_MIN
      + transitionSoftness * (TRANSITION_EXPONENT_MAX - TRANSITION_EXPONENT_MIN);

    const cols = p.cols;
    const rows = p.rows;

    // Pass 1: accumulate per-site mean F1 to derive per-cell radius. We don't keep the
    // F1/owner grid around — Pass 2 re-runs nearestTwo to also get F2, which is faster
    // than caching F1 at every grid point (~850 KB heap on a 400×267 grid for no benefit).
    // Pre-clamp flow strength so the inner loop branch is predictable.
    const pass1FlowAnisotropyAmt = Math.max(0, Math.min(1, p.flowAnisotropy));
    for (let j = 0; j < rows; j++) {
      const v = j / Math.max(1, rows - 1);
      const y = v * p.meshY;
      for (let i = 0; i < cols; i++) {
        const u = i / Math.max(1, cols - 1);
        const x = u * p.meshX;
        let pxCosA = cosA, pxSinA = sinA;
        if (flowGen && pass1FlowAnisotropyAmt > 0) {
          const flow = flowGen.noise(x * 0.18, y * 0.18);
          const localAngle = (p.anisotropyAngle + flow * pass1FlowAnisotropyAmt * 90) * Math.PI / 180;
          pxCosA = Math.cos(localAngle); pxSinA = Math.sin(localAngle);
        }
        const { f1, idx } = nearestTwo(sites, x, y, pxCosA, pxSinA, anisotropyScale);
        const s = sites[idx];
        s._radiusSum += f1;
        s._radiusN++;
      }
    }
    // Per-cell radius ≈ 2 × mean F1 (since mean F1 inside a Voronoi cell ≈ R/2 for a disk).
    for (const s of sites) {
      s.radius = s._radiusN > 0 ? (s._radiusSum / s._radiusN) * 2 : p.cellSize;
    }

    // Pass 2: compute heights using F1 + F2 + owner from a fresh nearestTwo call.
    // Defensive clamps for new fields — both already clamped at the URL boundary, but the
    // sampler is also called from tests and future callers that may bypass deserializeConfig.
    const cellSizeGradient = Math.max(0, Math.min(2, p.cellSizeGradient));
    const voidStrength = Math.max(0, Math.min(1, p.voidStrength));
    const attractorNoiseAmt = Math.max(0, Math.min(1, p.attractorNoise));
    const attractorNoiseFreq = Math.max(0.02, Math.min(0.5, p.attractorNoiseFreq));
    const flowAnisotropyAmt = Math.max(0, Math.min(1, p.flowAnisotropy));
    const out: number[][] = [];
    const polarity: number = p.polarity === 'pockets' ? -1 : 1;
    for (let j = 0; j < rows; j++) {
      const row: number[] = new Array(cols);
      const v = j / Math.max(1, rows - 1);
      const y = v * p.meshY;
      for (let i = 0; i < cols; i++) {
        const u = i / Math.max(1, cols - 1);
        const x = u * p.meshX;
        // Per-pixel anisotropy angle when flow is enabled — angle deviates from the global
        // anisotropyAngle by up to ±90° based on a smooth flow-noise field. Fast path uses
        // hoisted cosA/sinA when flowAnisotropy=0.
        let pxCosA = cosA, pxSinA = sinA;
        if (flowGen && flowAnisotropyAmt > 0) {
          const flow = flowGen.noise(x * 0.18, y * 0.18);
          const localAngle = (p.anisotropyAngle + flow * flowAnisotropyAmt * 90) * Math.PI / 180;
          pxCosA = Math.cos(localAngle); pxSinA = Math.sin(localAngle);
        }
        const { f1, f2, idx, idx2 } = nearestTwo(sites, x, y, pxCosA, pxSinA, anisotropyScale);
        const site = sites[idx];
        // Continuous radius blend across cell boundaries — eliminates the sawtooth aliasing
        // along seams caused by per-site `radius` being a discrete lookup. Weight by inverse
        // distance so deep inside a cell the blend is ~100% owner radius, and at the F1=F2
        // boundary the blend is the average of the two cells' radii. Without this, two
        // adjacent pixels straddling a boundary read two different R values, producing the
        // grid-aligned tooth pattern visible in the rendered mesh.
        const w1 = 1 / (f1 + 1e-6);
        const w2 = 1 / (f2 + 1e-6);
        const blendedRadius = (site.radius * w1 + sites[idx2].radius * w2) / (w1 + w2);
        // Spatial attractor on intensity — relief amplitude varies with mask.
        let mask = attractorMask(
          p.attractorMode, u, v, p.attractorX, p.attractorY,
          p.attractorRadius, p.attractorFalloff,
        );
        // Patchy noise modulation — multiplies the smooth attractor mask by a noise field
        // so dense/intense zones form random blobs rather than a uniform gradient. Produces
        // the lafabrica look where cells of vastly different sizes coexist in the same band.
        if (attractorNoiseGen && attractorNoiseAmt > 0) {
          // Map noise [-1, 1] to [0, 1] then lerp from "1.0 (no modulation)" toward the
          // noise field as attractorNoise increases.
          const n = attractorNoiseGen.noise(x * attractorNoiseFreq, y * attractorNoiseFreq);
          const modulator = (n + 1) * 0.5;
          mask = mask * ((1 - attractorNoiseAmt) + attractorNoiseAmt * modulator * 1.5);
          if (mask > 1) mask = 1;
          if (mask < 0) mask = 0;
        }
        // Cell-size gradient — shrinks the effective per-cell radius where mask is high so
        // the dense-attractor zone has visibly smaller domes (not just more of them). Without
        // this the "vertical" attractor only multiplies cell COUNT, never their physical size,
        // and the panel reads as uniform tessellation regardless of attractor strength.
        const sizeShrink = 1 - cellSizeGradient * mask * 0.6;
        const R = Math.max(0.05, blendedRadius * Math.max(0.2, sizeShrink));
        const dome = domeHeight(p.profile, f1, R);
        // Seam: 1 at boundary (F1≈F2), 0 well inside cells.
        const seam = 1 - smoothstep(0, Math.max(0.001, p.seamWidth * R), f2 - f1);
        // Combined relief: dome occupies cell interiors; seam carves a V where cells meet.
        // The (1 - seam) factor on dome ensures seamDepth represents an actual depth instead
        // of a budget the dome partially consumes — without it, dome at the boundary lifts
        // the trough back above the surface.
        let h = polarity * (dome * (1 - seam) - p.seamDepth * seam);

        const intensityFactor = (1 - p.intensityStrength) + p.intensityStrength * mask;

        if (p.baseMode === 'wave') {
          // Low-frequency simplex base that cells transition into. transitionSoftness=0 →
          // sharp boundary (cells take over abruptly where mask rises); transitionSoftness=1 →
          // gradual lerp from base to cells across the full mask range. Exponent is hoisted
          // above the loop and guaranteed positive, so Math.pow(mask, exponent) is finite.
          const base = waveGen.noise(x * WAVE_NOISE_FREQUENCY, y * WAVE_NOISE_FREQUENCY) * WAVE_AMPLITUDE;
          const cellWeight = Math.pow(mask, transitionExponent);
          h = base * (1 - cellWeight) + h * cellWeight * intensityFactor;
        } else {
          h *= intensityFactor;
        }

        // Void mode — at high mask + seam, blend h toward the negative clamp so CNC
        // normalization drops to z=0 (machine bed). Produces the spike-finger zone seen in
        // lafabrica panels where seams cut through the entire panel. Uses a smoothstep
        // transition zone (not a hard threshold) so adjacent pixels can't flip discretely
        // between continuous h and -OUTPUT_CLAMP, which produced dotted/sawtooth seam
        // artifacts when rendered as a CNC mesh.
        if (voidStrength > 0) {
          const voidGate = mask * seam;
          const voidEdge0 = 1 - voidStrength;
          // Transition band is half the voidStrength range so the cliff still feels sharp
          // but spans multiple pixels — enough for smoothing to clean up grid alignment.
          const voidEdge1 = 1 - voidStrength * 0.5;
          const voidT = smoothstep(voidEdge0, voidEdge1, voidGate);
          h = h * (1 - voidT) - OUTPUT_CLAMP * voidT;
        }

        // Clamp to a sane native range — downstream pipeline handles full normalization.
        if (!Number.isFinite(h)) h = 0;
        row[i] = Math.max(-OUTPUT_CLAMP, Math.min(OUTPUT_CLAMP, h));
      }
      out.push(row);
    }
    return out;
  }
}

export function sampleReliefParamsFromState(
  cols: number,
  rows: number,
  meshX: number,
  meshY: number,
  seed: number,
  s: {
    reliefCellSize: number;
    reliefJitter: number;
    reliefRelaxIterations: number;
    reliefPolarity: ReliefPolarity;
    reliefProfile: ReliefProfile;
    reliefSeamDepth: number;
    reliefSeamWidth: number;
    reliefAnisotropy: number;
    reliefAnisotropyAngle: number;
    reliefAttractorMode: ReliefAttractorMode;
    reliefAttractorX: number;
    reliefAttractorY: number;
    reliefAttractorRadius: number;
    reliefAttractorFalloff: number;
    reliefDensityStrength: number;
    reliefIntensityStrength: number;
    reliefTransitionSoftness: number;
    reliefBaseMode: ReliefBaseMode;
    reliefCellSizeGradient: number;
    reliefVoidStrength: number;
    reliefAttractorNoise: number;
    reliefAttractorNoiseFreq: number;
    reliefFlowAnisotropy: number;
    distortion: number;
    warpFreq: number;
  },
): ReliefSampleParams {
  return {
    cols, rows, meshX, meshY, seed,
    cellSize: s.reliefCellSize,
    jitter: s.reliefJitter,
    relaxIterations: s.reliefRelaxIterations,
    polarity: s.reliefPolarity,
    profile: s.reliefProfile,
    seamDepth: s.reliefSeamDepth,
    seamWidth: s.reliefSeamWidth,
    anisotropy: s.reliefAnisotropy,
    anisotropyAngle: s.reliefAnisotropyAngle,
    attractorMode: s.reliefAttractorMode,
    attractorX: s.reliefAttractorX,
    attractorY: s.reliefAttractorY,
    attractorRadius: s.reliefAttractorRadius,
    attractorFalloff: s.reliefAttractorFalloff,
    densityStrength: s.reliefDensityStrength,
    intensityStrength: s.reliefIntensityStrength,
    transitionSoftness: s.reliefTransitionSoftness,
    baseMode: s.reliefBaseMode,
    // Wire upstream global noise sliders into relief — restores the warp/distortion
    // pipeline that was disconnected when the relief sampler bypassed the per-pixel loop.
    warpDistortion: s.distortion,
    warpFrequency: s.warpFreq,
    cellSizeGradient: s.reliefCellSizeGradient,
    voidStrength: s.reliefVoidStrength,
    attractorNoise: s.reliefAttractorNoise,
    attractorNoiseFreq: s.reliefAttractorNoiseFreq,
    flowAnisotropy: s.reliefFlowAnisotropy,
  };
}
