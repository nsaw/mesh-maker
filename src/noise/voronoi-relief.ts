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
 * the rest. Per-pixel domain warp (the warpGen mix in sampleNoiseGrid) is intentionally
 * skipped for relief — warping discrete cells tears them visually. However `generateSites`
 * DOES apply site-position warping when `warpDistortion > 0`: the warp displaces each
 * jittered site rather than the heightmap, producing curving cell layouts without tearing.
 * `sampleReliefParamsFromState` wires both `warpDistortion` and `warpFrequency` into that
 * path so the global warp sliders affect relief output.
 *
 * RADIAL FOCI ("starburst") — v2: when `radialFoci` is non-empty, the entire Cartesian site
 * generation is REPLACED by `generatePolarSites`. Each focus contributes a polar grid of sites
 * (a center site at the focus plus concentric rings of `angularCount` sectors with `ringGrowth`
 * radial spacing). Voronoi tessellation of polar sites naturally produces radial wedge cells —
 * the geometry the reference photo shows. Where two foci's polar grids overlap, sites from
 * both compete in `nearestTwo` and the Voronoi boundary falls on the perpendicular bisector,
 * producing the long sweeping ridges that arc between centers (no explicit blending math
 * needed — tessellation IS the blend). Lloyd is suppressed under foci because the centroid of
 * a polar wedge is offset from the original polar position; relaxing would erode the
 * wedge arrangement toward hex packing.
 *
 * v1's three mechanisms (metric anisotropy in `pixelAnisoFrame`, site-density cut in
 * `generateSites`, post-Lloyd outward site-warp) all caused the v1 "pucker hole" failure:
 * the outward warp vacated each focus center → site-sparse cavity → F1 large, F2−F1 small
 * → shallow bowl reading as a dark hole. v2 removes all three and uses polar-grid placement
 * exclusively. `pixelAnisoFrame` is reduced to just the flow-noise rotation (still useful
 * for the non-foci `flowAnisotropy` feature).
 *
 * `radialMode`: 'rays' = standard polar grid (wedge cells, the main feature);
 * 'rings' = transpose with few angular sectors, many radial rings (concentric annulus cells);
 * 'spiral' = Vogel sunflower / golden-angle arrangement (swirled cells, artistic variant).
 *
 * All radial branches are skipped when `radialFoci` is empty → byte-identical to non-foci output.
 */
import type {
  ReliefAttractorMode,
  ReliefBaseMode,
  ReliefGenerator,
  ReliefPolarity,
  ReliefProfile,
  ReliefRadialMode,
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
// Spatial frequency of the flow-anisotropy noise field (per-pixel angle perturbation).
const FLOW_NOISE_FREQUENCY = 0.18;
// Polar-grid (radial-foci) hard caps. POLAR_MAX_RINGS prevents budget overflow at extreme
// parameter combos (small cellSize + low ringGrowth + max angularCount could otherwise demand
// > SITE_COUNT_MAX sites). 24 rings × 56 angular × 3 foci = 4032 ≤ SITE_COUNT_MAX = 4096.
const POLAR_MAX_RINGS = 24;
// Center-site per-cell radius hint: the (fx, fy) site at each focus uses this fraction of
// r_inner as its radius. Avoids the v1 "hole-at-center" failure mode where the focus sits
// inside an empty disc between the first ring of sites — without a center site, F1 stays
// large at the focus and the bowl saturates flat.
const POLAR_CENTER_RADIUS_FRACTION = 0.5;
// Sampler output clamp. Positive constant; used with explicit `-` sign at carve sites
// (e.g. void mode pushes h to `-OUTPUT_HEIGHT_CLAMP`). Naming clarifies the magnitude
// vs. previous `OUTPUT_CLAMP` which was used asymmetrically and read confusingly.
const OUTPUT_HEIGHT_CLAMP = 1.05;
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
// Radius field (Pass 1.5) — Gaussian blend over all sites within cutoff. σ in units of
// cellSize: small enough that R(x,y) follows per-cell radius near each cell center, but
// large enough that the field has no discontinuities at F1 or F2 ownership boundaries.
// σ=0.8 cellSize gives w≈0.21 at neighbor centers, w≈0.002 at 2 cellSizes away.
const RADIUS_FIELD_SIGMA_CELLS = 0.8;
// Cutoff in σ units. At 3σ, Gaussian weight is e⁻⁹ ≈ 1.2e-4 — beyond noise. Halves the
// inner loop cost vs full sum without measurable accuracy loss.
const RADIUS_FIELD_CUTOFF_SIGMAS = 3;
// Coarse-grid pitch in σ units. The Gaussian field varies on the scale of σ, so sampling
// at σ/2 is well above Nyquist; bilinear interpolation to full resolution introduces no
// visible error. This is the speed lever: full-resolution Rfield is O(cols·rows·sites)
// which times out at production resolution; coarse Rfield is O((cols/k)·(rows/k)·sites)
// where k = sigma/(2*pxPitch) is typically 30+ for relief-pockets.
const RADIUS_FIELD_COARSE_PITCH_SIGMAS = 0.5;
// SEAM_MIN_PIXEL_WIDTH / SEAM_FLOOR_MAX_R_FRACTION (formerly used by the dome+seam composite
// to enforce a minimum smoothstep transition width) are gone: the F2-F1 field has no seam
// width concept — every pixel reads the same continuous distance differential, so there's
// no smoothstep edge to alias.

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
  /** Per-cell scale derived from average F1 inside the cell (set after Pass 1). Used as
   *  sample value for the Gaussian radius field (Pass 1.5); never read directly per-pixel. */
  radius: number;
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
function generateSites(
  p: ReliefSampleParams,
  rand: () => number,
  warpGen: SimplexNoiseGen | null,
): Site[] {
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
        });
      }
    }
  }
  return sites;
}

/** Polar-grid site generator for the radial-foci ("starburst") system. Each focus contributes
 *  one center site at (fx, fy) plus concentric rings of `angularCount` sites with `ringGrowth`
 *  radial spacing, optionally jittered by `polarJitter`. The Voronoi tessellation of these
 *  sites produces radial wedge cells (rays mode) — the geometry the reference photo shows.
 *  Out-of-panel sites are SKIPPED rather than clamped (clamping would stack multiple sites at
 *  panel corners and create degenerate Voronoi geometry there). Per-focus site count is capped
 *  at SITE_COUNT_MAX / fociCount and ring count at POLAR_MAX_RINGS so worst-case extreme params
 *  can never blow the global budget. The post-Lloyd warp + per-pixel anisotropy from v1 are
 *  GONE — polar-grid placement is the single mechanism that drives the radial visual. */
function generatePolarSites(
  p: ReliefSampleParams,
  rand: () => number,
  fociPhys: ReadonlyArray<{ x: number; y: number }>,
  angularCount: number,
  ringGrowth: number,
  polarJitter: number,
  rMax: number,
  mode: ReliefRadialMode,
): Site[] {
  const sites: Site[] = [];
  if (fociPhys.length === 0) return sites;
  const maxSitesPerFocus = Math.floor(SITE_COUNT_MAX / fociPhys.length);
  const rInner = Math.max(0.4, p.cellSize * 0.5);
  const { meshX, meshY } = p;
  // Effective angular count for 'rings' mode is small (the transpose — few angular sectors,
  // tightly stacked radial rings). Effective growth is sqrt(growth) so rings stack tighter.
  const isRings = mode === 'rings';
  const effAngular = isRings ? Math.max(4, Math.round(angularCount * 0.25)) : angularCount;
  const effGrowth = isRings ? Math.max(1.05, Math.sqrt(ringGrowth)) : ringGrowth;
  const angularPitch = (2 * Math.PI) / Math.max(1, effAngular);
  // Spiral mode uses Vogel sunflower: a single sequence of sites at (r_k, θ_k) with
  // r_k = rInner·√(k·scaleFactor) and θ_k = k·goldenAngle. Total count is sized to roughly
  // match the rays-mode coverage so visual density is comparable across modes.
  const goldenAngle = 2 * Math.PI * (1 - 1 / 1.6180339887498949);

  for (let f = 0; f < fociPhys.length; f++) {
    const fx = fociPhys[f].x;
    const fy = fociPhys[f].y;
    let perFocusCount = 0;

    // Center site — kills the v1 "hole at focus center" failure mode. With this site at (fx,fy),
    // F1 = 0 exactly at the focus, F2 ≈ rInner, normDist ≈ 0.5 — a normal small bowl at the
    // center. Without it, F1 = rInner and F2 − F1 ≈ tiny (next angular neighbor is right next
    // to the first ring's nearest site), producing a shallow disc that reads as a "pucker hole".
    sites.push({ x: fx, y: fy, radius: rInner * POLAR_CENTER_RADIUS_FRACTION });
    perFocusCount++;

    if (mode === 'spiral') {
      // Vogel sunflower: smooth golden-angle spiral. Cell shape is hexagonal-ish (well-known
      // result for sunflower seed packings), curving along golden-spiral curves — best-effort
      // artistic variant, not the wedge-cell visual of rays mode.
      // Total sample count: budget-bounded; spans the disc rMax with √k radial growth.
      const totalCount = Math.min(maxSitesPerFocus - 1, effAngular * 16);
      const radialScale = rMax / Math.sqrt(Math.max(1, totalCount));
      for (let k = 1; k <= totalCount && perFocusCount < maxSitesPerFocus; k++) {
        const r = radialScale * Math.sqrt(k);
        if (r > rMax) break;
        const theta = k * goldenAngle;
        const jr = (rand() - 0.5) * polarJitter * radialScale * 0.5;
        const jt = (rand() - 0.5) * polarJitter * goldenAngle * 0.5;
        const rj = r + jr;
        const tj = theta + jt;
        const sx = fx + rj * Math.cos(tj);
        const sy = fy + rj * Math.sin(tj);
        if (sx < 0 || sx > meshX || sy < 0 || sy > meshY) continue;
        sites.push({ x: sx, y: sy, radius: 0 });
        perFocusCount++;
      }
      continue;
    }

    // rays / rings: concentric rings of `effAngular` sites each, radii growing geometrically.
    let r = rInner;
    for (let ringIdx = 0; ringIdx < POLAR_MAX_RINGS && r <= rMax && perFocusCount < maxSitesPerFocus; ringIdx++) {
      const radialPitch = r * (effGrowth - 1) / effGrowth; // distance to next-in ring
      for (let j = 0; j < effAngular && perFocusCount < maxSitesPerFocus; j++) {
        const theta = j * angularPitch;
        const jr = (rand() - 0.5) * polarJitter * radialPitch;
        const jt = (rand() - 0.5) * polarJitter * angularPitch;
        const rj = r + jr;
        const tj = theta + jt;
        const sx = fx + rj * Math.cos(tj);
        const sy = fy + rj * Math.sin(tj);
        if (sx < 0 || sx > meshX || sy < 0 || sy > meshY) continue;
        sites.push({ x: sx, y: sy, radius: 0 });
        perFocusCount++;
      }
      r *= effGrowth;
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
): { f1: number; f2: number; idx: number } {
  let f1 = Infinity;
  let f2 = Infinity;
  let idx = 0;
  // A scale that rounds to 1 (the common case far from any radial focus, and the exact case
  // when base anisotropy is 0) takes the cheap isotropic hypot path — keeps non-radial relief
  // at its pre-feature cost despite the per-pixel scale now varying near foci.
  const isotropic = anisotropyScale <= 1.0001;
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
    if (d < f1) { f2 = f1; f1 = d; idx = i; }
    else if (d < f2) { f2 = d; }
  }
  return { f1, f2, idx };
}

/** Per-pixel anisotropy frame for the Voronoi distance metric. v2: just the base anisotropy
 *  angle rotated by the flow-noise field — the v1 radial-foci branch is GONE (the radial visual
 *  is now driven entirely by polar-grid site placement in `generatePolarSites`, not by an
 *  anisotropic distance metric). Returns a unit direction (cosA, sinA) for `nearestTwo` plus
 *  the per-pixel metric `scale`. When `flowGen` is null the flow rotation is skipped and the
 *  helper is a pass-through. */
function pixelAnisoFrame(
  x: number,
  y: number,
  baseCosA: number,
  baseSinA: number,
  baseScale: number,
  flowGen: SimplexNoiseGen | null,
  flowAmt: number,
): { cosA: number; sinA: number; scale: number } {
  let cosA = baseCosA;
  let sinA = baseSinA;
  if (flowGen && flowAmt > 0) {
    const flow = flowGen.noise(x * FLOW_NOISE_FREQUENCY, y * FLOW_NOISE_FREQUENCY);
    // Original semantics: localAngle = baseAngle + flow·flowAmt·90°. Rotating the precomputed
    // base direction by that offset avoids re-doing trig on the base angle every pixel.
    const da = (flow * flowAmt * 90) * Math.PI / 180;
    const c = Math.cos(da);
    const s = Math.sin(da);
    const nc = cosA * c - sinA * s;
    const ns = cosA * s + sinA * c;
    cosA = nc;
    sinA = ns;
  }
  return { cosA, sinA, scale: baseScale };
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

    // Radial-foci ("starburst") setup — v2: polar-grid site placement REPLACES Cartesian site
    // generation when radialFoci is non-empty. radialFoci arrives normalized; sanitize and
    // convert to physical units. Sanitization is defense in depth even though state.ts already
    // URL-clamps; callers constructing ReliefSampleParams directly (tests, future paths) bypass
    // that. Filter non-finite, clamp [0,1], cap to 3 (the documented O(foci ≤ 3) bound).
    const radialFociPhys = p.radialFoci
      .filter(f => Number.isFinite(f.x) && Number.isFinite(f.y))
      .slice(0, 3)
      .map(f => ({
        x: Math.max(0, Math.min(1, f.x)) * p.meshX,
        y: Math.max(0, Math.min(1, f.y)) * p.meshY,
      }));
    // Map the existing relief* params onto polar-grid controls (semantics changed v1→v2 but
    // key names preserved so v6 share-links round-trip):
    //   reliefRadialStrength → angular sector count per ring (rays mode)
    //   reliefRadialGrow → ring-to-ring radius growth ratio
    //   reliefRadialWarp → polar (r, θ) jitter amount
    //   reliefRadialFalloff → coverage radius rMax as a multiple of panel diagonal
    const angularCount = Math.round(8 + Math.max(0, Math.min(4, p.radialStrength)) * 12);
    const ringGrowth = 1.1 + Math.max(0, Math.min(1, p.radialGrow)) * 0.95;
    const polarJitter = Math.max(0, Math.min(1, p.radialWarp));
    const rMaxCoverage = (0.6 + Math.max(0.02, Math.min(0.6, p.radialFalloff)) * 0.6)
      * Math.hypot(p.meshX, p.meshY);

    const sites = radialFociPhys.length > 0
      ? generatePolarSites(p, rand, radialFociPhys, angularCount, ringGrowth, polarJitter, rMaxCoverage, p.radialMode)
      : generateSites(p, rand, warpGen);
    if (sites.length === 0) {
      // Defensive: empty cellgrid → flat field.
      const empty: number[][] = [];
      for (let j = 0; j < p.rows; j++) empty.push(new Array(p.cols).fill(0));
      return empty;
    }

    // Lloyd relaxation passes (default 1, max 2). Defensive clamp — STATE is the canonical
    // source, but params may originate from URLs, tests, or future callers. Hard-cap at 2
    // to prevent a denial-of-service via a crafted share link. SUPPRESSED when radialFoci is
    // active: the centroid of a polar wedge is offset from the original (r, θ) position, so a
    // Lloyd iteration would erode the wedge arrangement toward hex packing — destroying the
    // radial visual the polar grid was built to create. The `reliefRelaxIterations` slider
    // stays visible in the UI but is silently inert under foci (consistent with how other
    // mode-specific knobs interact across noise types).
    const relaxIters = radialFociPhys.length > 0
      ? 0
      : Math.max(0, Math.min(2, Math.floor(p.relaxIterations) || 0));
    const lloydSamples = Math.min(LLOYD_SAMPLE_BUDGET_MAX, sites.length * LLOYD_SAMPLES_PER_SITE);
    for (let r = 0; r < relaxIters; r++) {
      lloydRelax(sites, p, lloydSamples);
    }

    const baseAnisotropy = Math.max(0, Math.min(2, p.anisotropy));
    const aAngle = p.anisotropyAngle * Math.PI / 180;
    const baseCosA = Math.cos(aAngle);
    const baseSinA = Math.sin(aAngle);
    // The metric scale inflates the component ALONG (baseCosA, baseSinA), which narrows the cell
    // along that axis and widens it perpendicular → cells elongate ⟂ anisotropyAngle.
    const baseScale = 1 + baseAnisotropy * ANISOTROPY_SCALE_MULTIPLIER;
    const flowAnisotropyAmt = Math.max(0, Math.min(1, p.flowAnisotropy));

    // Hoisted + clamped wave-mode params. transitionSoftness must stay in [0, 1] —
    // negative values would make the exponent ≤ 0 and `Math.pow(0, ≤0)` = Infinity,
    // which the non-finite guard later flattens to 0, punching dead bands into the mesh.
    const transitionSoftness = Math.max(0, Math.min(1, p.transitionSoftness));
    const transitionExponent = TRANSITION_EXPONENT_MIN
      + transitionSoftness * (TRANSITION_EXPONENT_MAX - TRANSITION_EXPONENT_MIN);

    const cols = p.cols;
    const rows = p.rows;

    // Pass 1: accumulate per-site mean F1 to derive per-cell radius. Accumulators live in
    // Float64Arrays local to this sampleGrid call so the Site interface stays slim and
    // multiple concurrent sampleGrid calls (e.g. tests) can't trample each other.
    const radiusSum = new Float64Array(sites.length);
    const radiusN = new Int32Array(sites.length);
    // Pass 1 MUST use the same per-pixel metric as Pass 2: the per-cell radius R = 2·meanF1 has
    // to be the *metric* radius so the Pass-2 normalization (normDist = (f2−f1)/(2R)) still hits
    // ~1 at cell centers and ~0 at boundaries.
    for (let j = 0; j < rows; j++) {
      const v = j / Math.max(1, rows - 1);
      const y = v * p.meshY;
      for (let i = 0; i < cols; i++) {
        const u = i / Math.max(1, cols - 1);
        const x = u * p.meshX;
        const frame = pixelAnisoFrame(x, y, baseCosA, baseSinA, baseScale, flowGen, flowAnisotropyAmt);
        const { f1, idx } = nearestTwo(sites, x, y, frame.cosA, frame.sinA, frame.scale);
        radiusSum[idx] += f1;
        radiusN[idx]++;
      }
    }
    // Per-cell radius ≈ 2 × mean F1 (since mean F1 inside a Voronoi cell ≈ R/2 for a disk).
    for (let k = 0; k < sites.length; k++) {
      sites[k].radius = radiusN[k] > 0 ? (radiusSum[k] / radiusN[k]) * 2 : p.cellSize;
    }

    // Pass 1.5: build a continuous radius field R(x,y) via Gaussian blending of sites.
    // Architectural fix for the spike-and-sawtooth artifacts: any per-pixel formula that
    // reads R must read a continuous quantity, NOT a per-site discrete lookup. Gaussian
    // basis is C∞ smooth, so the field has no discontinuities anywhere.
    //
    // OPTIMIZATION: compute Rfield on a coarse grid at pitch σ/2 (well above Nyquist for
    // a Gaussian-smoothed field of scale σ), then bilinear-interpolate to full resolution.
    // Without this optimization the full-resolution Rfield is O(cols·rows·sites) ≈ 224M
    // ops at production resolution (400×800 × 700 sites), which times out the browser.
    // The coarse grid is typically O(50×100 × 700) ≈ 3.5M ops — fast enough.
    const sigmaR = Math.max(0.2, p.cellSize) * RADIUS_FIELD_SIGMA_CELLS;
    const sigmaR2 = sigmaR * sigmaR;
    const cutoffR = sigmaR * RADIUS_FIELD_CUTOFF_SIGMAS;
    const cutoffR2 = cutoffR * cutoffR;
    const coarsePitch = sigmaR * RADIUS_FIELD_COARSE_PITCH_SIGMAS;
    const coarseCols = Math.max(2, Math.ceil(p.meshX / coarsePitch) + 1);
    const coarseRows = Math.max(2, Math.ceil(p.meshY / coarsePitch) + 1);
    const coarseStepX = p.meshX / (coarseCols - 1);
    const coarseStepY = p.meshY / (coarseRows - 1);
    const Rcoarse = new Float64Array(coarseRows * coarseCols);
    for (let cj = 0; cj < coarseRows; cj++) {
      const y = cj * coarseStepY;
      for (let ci = 0; ci < coarseCols; ci++) {
        const x = ci * coarseStepX;
        let sumR = 0;
        let sumW = 0;
        for (let k = 0; k < sites.length; k++) {
          const dx = x - sites[k].x;
          const dy = y - sites[k].y;
          const d2 = dx * dx + dy * dy;
          if (d2 > cutoffR2) continue;
          const w = Math.exp(-d2 / sigmaR2);
          sumR += sites[k].radius * w;
          sumW += w;
        }
        Rcoarse[cj * coarseCols + ci] = sumW > 0 ? sumR / sumW : p.cellSize;
      }
    }
    // Bilinear-interpolate the coarse field to full resolution. Result is C0 (the Gaussian
    // field is C∞ but bilinear interp introduces piecewise-linear seams between coarse
    // samples — invisible at this scale since the coarse pitch is well below the per-cell
    // variation length).
    const Rfield = new Float64Array(rows * cols);
    for (let j = 0; j < rows; j++) {
      const v = j / Math.max(1, rows - 1);
      const y = v * p.meshY;
      const cy = y / coarseStepY;
      const cj0 = Math.min(coarseRows - 2, Math.floor(cy));
      const ty = cy - cj0;
      for (let i = 0; i < cols; i++) {
        const u = i / Math.max(1, cols - 1);
        const x = u * p.meshX;
        const cx = x / coarseStepX;
        const ci0 = Math.min(coarseCols - 2, Math.floor(cx));
        const tx = cx - ci0;
        const r00 = Rcoarse[cj0 * coarseCols + ci0];
        const r10 = Rcoarse[cj0 * coarseCols + ci0 + 1];
        const r01 = Rcoarse[(cj0 + 1) * coarseCols + ci0];
        const r11 = Rcoarse[(cj0 + 1) * coarseCols + ci0 + 1];
        const r0 = r00 * (1 - tx) + r10 * tx;
        const r1 = r01 * (1 - tx) + r11 * tx;
        Rfield[j * cols + i] = r0 * (1 - ty) + r1 * ty;
      }
    }

    // Pass 2: compute heights using F1 + F2 + Rfield. R is read from the continuous radius
    // field (not from sites[idx]) — that's the key fix for the spike-and-sawtooth artifacts.
    const cellSizeGradient = Math.max(0, Math.min(2, p.cellSizeGradient));
    const voidStrength = Math.max(0, Math.min(1, p.voidStrength));
    const attractorNoiseAmt = Math.max(0, Math.min(1, p.attractorNoise));
    const attractorNoiseFreq = Math.max(0.02, Math.min(0.5, p.attractorNoiseFreq));
    // intensityStrength is the only sibling param previously read directly from p; clamp it
    // defensively for parity with the others. Out-of-range values would invert (negative)
    // or over-amplify (>1) the relief intensity before the final output clamp.
    const intensityStrengthClamped = Math.max(0, Math.min(1, p.intensityStrength));
    // (Pixel-pitch anti-alias floor is gone with the F2-F1 algorithm — no smoothstep
    // transitions on a per-pixel basis means no sub-pixel-aliasing risk.)
    const out: number[][] = [];
    const polarity: number = p.polarity === 'pockets' ? -1 : 1;
    for (let j = 0; j < rows; j++) {
      const row: number[] = new Array(cols);
      const v = j / Math.max(1, rows - 1);
      const y = v * p.meshY;
      for (let i = 0; i < cols; i++) {
        const u = i / Math.max(1, cols - 1);
        const x = u * p.meshX;
        // Per-pixel anisotropy frame: base angle → flow-noise rotation. (v2 dropped the radial-
        // foci metric branch — the radial visual is now driven by polar-grid site placement in
        // `generatePolarSites`, not by a per-pixel distance-metric rotation.)
        const frame = pixelAnisoFrame(x, y, baseCosA, baseSinA, baseScale, flowGen, flowAnisotropyAmt);
        const { f1, f2 } = nearestTwo(sites, x, y, frame.cosA, frame.sinA, frame.scale);
        // Spatial attractor on intensity — relief amplitude varies with mask.
        let mask = attractorMask(
          p.attractorMode, u, v, p.attractorX, p.attractorY,
          p.attractorRadius, p.attractorFalloff,
        );
        // Patchy noise modulation — multiplies the smooth attractor mask by a noise field
        // so dense/intense zones form random blobs rather than a uniform gradient.
        if (attractorNoiseGen && attractorNoiseAmt > 0) {
          const n = attractorNoiseGen.noise(x * attractorNoiseFreq, y * attractorNoiseFreq);
          const modulator = (n + 1) * 0.5;
          mask = mask * ((1 - attractorNoiseAmt) + attractorNoiseAmt * modulator * 1.5);
          if (mask > 1) mask = 1;
          if (mask < 0) mask = 0;
        }
        // Cell-size gradient shrinks the effective radius where mask is high. R_field is
        // already continuous; we just scale it by a continuous function of mask.
        const sizeShrink = 1 - cellSizeGradient * mask * 0.6;
        const R = Math.max(0.05, Rfield[j * cols + i] * Math.max(0.2, sizeShrink));

        // WORLEY F2-F1 DISTANCE-FIELD HEIGHT. Replaces the prior dome+seam composite which
        // produced piecewise gradients (dome falloff inside cell + seam carve at boundary)
        // that mesh triangulation couldn't represent without polygon-tooth aliasing along
        // every ridge. The F2-F1 distance differential is a single C1 scalar field:
        //   - at cell boundary (F1≈F2): F2-F1 → 0 → height = 0 (ridge stays at surface)
        //   - at cell center: F2-F1 maximizes (proportional to neighbor distance, so big
        //     cells naturally produce deep bowls and small cells stay shallow — exactly
        //     the lafabricatrun reference look)
        //   - everywhere in between: smooth monotonic gradient → smooth triangulation
        //
        // The optional dome profile (hemisphere/cosine/parabolic) now shapes the falloff
        // CURVE applied to the normalized distance, controlling whether bowls have sharp
        // tops + flat bottoms (hemisphere), s-curve sides (cosine), or sharp bottoms
        // (parabolic). seamDepth controls the saturation depth (max bowl depth).
        // seamWidth is no longer used — the F2-F1 field has no seam width concept.
        const distDiff = f2 - f1;
        // Normalize so cellSize-scale cells reach ~1.0 at center. distDiff at center ≈
        // distance to nearest neighbor's site ≈ 2*R for a Voronoi cell of radius R. So
        // dividing by 2R yields [0, 1] for an ideal disk-shaped cell. Bigger cells get
        // more of the depth budget, smaller cells less — this is the lafabrica gradient.
        const normDist = Math.min(1, distDiff / (2 * R));
        // Apply seamDepth as the saturation point: lower seamDepth → bowls saturate sooner
        // (uniform depth), higher seamDepth → only the biggest cells reach full depth.
        let bowlT = normDist / Math.max(0.05, p.seamDepth);
        if (bowlT > 1) bowlT = 1;
        // Profile shapes the bowl falloff curve. CRITICAL: all profiles MUST have dh/dt = 0
        // at t=0 (boundary), otherwise the height drops from 0 with non-zero slope and the
        // mesh triangulation produces knife-edge spikes along every ridge. The prior
        // hemisphere formula `sqrt(t)` had INFINITE derivative at t=0 — fixed below to
        // `1 - sqrt(1 - t²)` which is a true hemisphere bowl shape (flat rim, round bottom).
        let bowlH: number;
        if (p.profile === 'hemisphere') {
          // Hemisphere bowl: flat at rim (boundary, t=0), curved smooth bottom approaching
          // vertical-wall asymptote at t=1. Derivative at t=0 is 0 → no knife edge.
          const t2 = bowlT * bowlT;
          bowlH = 1 - Math.sqrt(Math.max(0, 1 - t2));
        } else if (p.profile === 'cosine') {
          // S-curve: gradual at both ends, fast in the middle. dh/dt = 0 at both t=0 and t=1.
          bowlH = 0.5 - 0.5 * Math.cos(bowlT * Math.PI);
        } else {
          // 'parabolic' — quadratic. dh/dt = 2t = 0 at t=0 (smooth boundary), 2 at t=1.
          bowlH = bowlT * bowlT;
        }
        // Polarity: pockets carve DOWN (negative h), domes raise UP (positive h).
        let h = polarity * bowlH;

        // Intensity mask scales bowl depth by attractor — preserves existing controls.
        const intensityFactor = (1 - intensityStrengthClamped) + intensityStrengthClamped * mask;

        if (p.baseMode === 'wave') {
          // Wave base: low-frequency simplex that the cellular field transitions INTO.
          // cellWeight from mask controls how much "cell" vs "wave" each pixel shows.
          const base = waveGen.noise(x * WAVE_NOISE_FREQUENCY, y * WAVE_NOISE_FREQUENCY) * WAVE_AMPLITUDE;
          const cellWeight = Math.pow(mask, transitionExponent);
          h = base * (1 - cellWeight) + h * cellWeight * intensityFactor;
        } else {
          h *= intensityFactor;
        }

        // Void mode pushes h toward the negative clamp where mask+bowl depth is high —
        // produces the spike-finger zone for relief-vertical. With F2-F1 there's no seam
        // value any more; substitute bowlH as the "carve depth" proxy (high near center).
        if (voidStrength > 0) {
          const voidGate = mask * bowlH;
          const voidEdge0 = 1 - voidStrength;
          const voidEdge1 = 1 - voidStrength * 0.5;
          const voidT = smoothstep(voidEdge0, voidEdge1, voidGate);
          h = h * (1 - voidT) - OUTPUT_HEIGHT_CLAMP * voidT;
        }

        // Clamp to a sane native range — downstream pipeline handles full normalization.
        if (!Number.isFinite(h)) h = 0;
        row[i] = Math.max(-OUTPUT_HEIGHT_CLAMP, Math.min(OUTPUT_HEIGHT_CLAMP, h));
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
    reliefRadialFociCount: number;
    reliefRadialFocus1X: number;
    reliefRadialFocus1Y: number;
    reliefRadialFocus2X: number;
    reliefRadialFocus2Y: number;
    reliefRadialFocus3X: number;
    reliefRadialFocus3Y: number;
    reliefRadialStrength: number;
    reliefRadialFalloff: number;
    reliefRadialGrow: number;
    reliefRadialWarp: number;
    reliefRadialMode: ReliefRadialMode;
    distortion: number;
    warpFreq: number;
  },
): ReliefSampleParams {
  // Prune the three focus slots down to the active count (0–3). The sampler treats an empty
  // list as "radial system off" → byte-identical to pre-feature output.
  const fociCount = Math.max(0, Math.min(3, Math.floor(s.reliefRadialFociCount) || 0));
  const radialFoci = [
    { x: s.reliefRadialFocus1X, y: s.reliefRadialFocus1Y },
    { x: s.reliefRadialFocus2X, y: s.reliefRadialFocus2Y },
    { x: s.reliefRadialFocus3X, y: s.reliefRadialFocus3Y },
  ].slice(0, fociCount);
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
    radialFoci,
    radialStrength: s.reliefRadialStrength,
    radialFalloff: s.reliefRadialFalloff,
    radialGrow: s.reliefRadialGrow,
    radialWarp: s.reliefRadialWarp,
    radialMode: s.reliefRadialMode,
  };
}
