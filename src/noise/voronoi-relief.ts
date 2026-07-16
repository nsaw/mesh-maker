/**
 * VoronoiReliefGen — grid-aware 3D Voronoi cell relief sampler (v16).
 *
 * Reproduces lafabricatrun-style 3D cellular wood carvings: cells carved INTO a smooth
 * undulating base surface, separated by finite-width walls, elongated along an organic
 * flow. Cannot be expressed as a per-pixel scalar field because each cell needs an
 * identity (which site owns this sample?) and a per-cell radius (how big is THIS cell?).
 *
 * Three structural mechanisms (v16 — replaces the v1–v15 crossfade/starburst machinery):
 *
 *   1. BASE SUPERPOSITION. The final height is `base + polarity·bowl·…` where `base` is an
 *      independent low-frequency wave field (reliefBaseAmplitude/Frequency). Ridge tops
 *      follow the base surface instead of collapsing onto a flat reference plane. The old
 *      model crossfaded base and cells through one weight, so full-depth cells always sat
 *      on a flattened base — the "dimpled flat panel" failure.
 *
 *   2. WALL BAND. `wallWidth` holds a band of the normalized cell distance at base level
 *      around every cell boundary before the bowl profile starts, giving walls finite
 *      width instead of knife-edge ridge lines (the F2-F1 field's natural boundary).
 *
 *   3. FLOW WARP W(x, y) + POLAR STARBURST LATTICES. All distance queries (Pass 1, Lloyd
 *      samples, radius field, Pass 2) are evaluated at W(q), a smooth flow warp driven by
 *      the global distortion/warpFreq sliders — cells stretch and flow but ownership
 *      boundaries stay clean curves (the old per-pixel metric rotation tore ownership;
 *      measured 0.70 max adjacent-pixel jump vs 0.28). The STARBURST (v16.2) is a SITE
 *      LAYOUT, not a warp: jittered polar ring lattices around each focus whose radial
 *      gap is (1 + radialStrength) × the tangential pitch produce radially elongated
 *      petal cells (direction-verified: boundary-crossing rate along spokes ≈ half the
 *      rate along arcs in 'rays' mode). A radial displacement warp CANNOT produce petals:
 *      any Gaussian-localized radial displacement compresses radially somewhere in its
 *      falloff annulus, rendering tangential ring bands — measured on both signs.
 *
 * Site density is additionally modulated by low-frequency noise (reliefDensityNoise) so
 * giant and small cells coexist — the reference's patchy multi-scale cell sizes.
 *
 * Algorithm:
 *   1. Site generation — jittered grid in physical units; density modulated by the
 *      attractor mask and the density noise field. Sites are never displaced.
 *   2. Lloyd relaxation — 0–2 passes via low-discrepancy Halton sampling (samples warped
 *      through W so relaxation happens in the same space as the queries).
 *   3. Pass 1 — find F1 and owning site for every W(x, y); accumulate mean F1 per site.
 *   4. Per-cell radius — R ≈ 2 × mean F1. Pass 1.5 blends per-site radii into a continuous
 *      Gaussian radius field on a coarse grid (bilinear-upsampled) covering the warped
 *      domain, so per-pixel R reads are C0-continuous.
 *   5. Pass 2 — re-sample F1/F2 at W(x, y); wall-band remap; bowl profile; superpose onto
 *      the base wave; attractor/void/intensity shaping; clamp to ~[-1, 1].
 *
 * Output is in noise-native range; the standard CNC-z normalization in mesh.ts handles
 * the rest.
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
const ANISOTROPY_SCALE_MULTIPLIER = 1.5;
// Flow-warp displacement amplitude in units of cellSize at distortion = 1. Chosen so a
// full-slider warp moves sites' apparent positions by roughly one cell — strong visible
// flow without folding the domain (the warp field gradient stays well below 1/amplitude).
const FLOW_WARP_AMPLITUDE_CELLS = 0.9;
// Starburst polar-lattice geometry (v16.2). The focal "explosion" is a SITE LAYOUT, not a
// warp: jittered polar rings around each focus whose radial gap is `1 + radialStrength`
// times the tangential pitch — Voronoi cells of such a lattice are radially elongated
// petals/wedges. (v16.0 tried a radial displacement warp; measured result: ANY Gaussian-
// localized radial displacement produces tangential ring bands at the falloff annulus —
// both modes rendered as concentric webs. Site placement is the honest mechanism.)
const POLAR_ZONE_SIGMAS = 1.0;
const POLAR_TANGENTIAL_PITCH_CELLS = 0.85;
// Cartesian sites are excluded slightly inside the polar zone so the lattice owns it.
const POLAR_EXCLUSION_FRACTION = 0.9;
// Density-noise gain: at reliefDensityNoise = 1.5 (clamp max) local density swings by
// ±2.4× before the [0.1, LOCAL_DENSITY_MAX] clamp — enough for giant-vs-small patches.
const DENSITY_NOISE_GAIN = 1.6;
// Focal expansion gain/cap (unchanged from v14.2 — middle ground between blobby and flat).
const FOCAL_EXPAND_GAIN = 1.7;
const FOCAL_EXPAND_CAP = 2.2;
// Sampler output clamp. Positive constant; used with explicit `-` sign at carve sites.
const OUTPUT_HEIGHT_CLAMP = 1.05;
// transitionSoftness=0 → exponent 0.2 (cells take over abruptly).
// transitionSoftness=1 → exponent 2.0 (gradual lerp from base to cells).
const TRANSITION_EXPONENT_MIN = 0.2;
const TRANSITION_EXPONENT_MAX = 2.0;
// Hard caps to prevent DoS via crafted params. Both passes are O(rows·cols·sites).
const SITE_COUNT_MAX = 4096;
const LOCAL_DENSITY_MAX = 4;
// Radius field (Pass 1.5) — Gaussian blend over all sites within cutoff. σ in units of
// cellSize. See the doc block on the coarse-grid computation below.
const RADIUS_FIELD_SIGMA_CELLS = 0.8;
const RADIUS_FIELD_CUTOFF_SIGMAS = 3;
const RADIUS_FIELD_COARSE_PITCH_SIGMAS = 0.5;

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

/** Deterministic per-cell hash in [0, 1) from the owning site index — drives which cells
 *  get pillowed floors and how strongly, stable across renders for the same seed. */
function cellHash01(idx: number, seed: number): number {
  let h = (Math.imul(idx + 1, 374761393) + Math.imul(seed | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
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
  const shapedFalloff = Math.max(0.05, falloff);
  if (mode === 'radial') {
    return Math.pow(1 - smoothstep(r * 0.5, r, d), shapedFalloff);
  }
  // 'point': inverse — sparse at center, dense outside (vignette/border patterns).
  return Math.pow(smoothstep(r * 0.5, r, d), shapedFalloff);
}

/** The flow warp W (global distortion/warpFreq sliders). Returns null when inactive so
 *  callers can take the identity fast path. Sites are NEVER passed through W — only query
 *  points are, which makes real-space cells the preimages of clean warped-space Voronoi
 *  cells. (v16.2: the starburst no longer lives here — see generatePolarSites.) */
function makeWarpFn(
  p: ReliefSampleParams,
  seed: number,
  warpDistortion: number,
): ((x: number, y: number) => [number, number]) | null {
  const flowAmp = warpDistortion * Math.max(0.2, p.cellSize) * FLOW_WARP_AMPLITUDE_CELLS;
  const flowFreq = Math.max(0.02, p.warpFrequency);
  if (flowAmp <= 0) return null;
  const flowGen = new SimplexNoiseGen(seed + WAVE_GEN_SEED_OFFSET + 13);
  return (x: number, y: number): [number, number] => [
    x + flowGen.noise(x * flowFreq, y * flowFreq) * flowAmp,
    y + flowGen.noise(x * flowFreq + 31.7, y * flowFreq + 17.3) * flowAmp,
  ];
}

/** Starburst polar site lattices (v16.2). Around each focus: a nucleus site plus jittered
 *  concentric rings whose RADIAL gap is `(1 + radialStrength)` × the tangential pitch —
 *  the Voronoi cells of that lattice are radially elongated petals fanning out of the
 *  node, exactly the reference's wedge structure. 'rings' swaps the two pitches
 *  (tangential arcs); 'spiral' advances each ring by the golden angle so sectors join
 *  into spiral arms. jitterAmt (the Starburst Wobble slider) breaks mandala regularity;
 *  radialGrow scales the whole lattice pitch (bigger focal cells). Petal length grows
 *  with ring index, matching the reference's outward-lengthening fans. */
function generatePolarSites(
  fociPhys: ReadonlyArray<{ x: number; y: number }>,
  zoneR: number,
  cellSize: number,
  radialStrength: number,
  radialGrow: number,
  jitterAmt: number,
  mode: ReliefRadialMode,
  rand: () => number,
  meshX: number,
  meshY: number,
  sites: Site[],
): void {
  const pitchT = Math.max(0.3, cellSize * POLAR_TANGENTIAL_PITCH_CELLS
    * (1 + 0.5 * Math.max(0, Math.min(2, radialGrow))));
  const elong = 1 + Math.max(0, Math.min(4, radialStrength));
  const margin = Math.max(0.2, cellSize);
  for (let k = 0; k < fociPhys.length; k++) {
    if (sites.length >= SITE_COUNT_MAX) break;
    const cp = fociPhys[k];
    // Nucleus site — the small calm cell at the node the reference shows.
    sites.push({
      x: Math.max(0, Math.min(meshX, cp.x + (rand() - 0.5) * 0.2 * pitchT)),
      y: Math.max(0, Math.min(meshY, cp.y + (rand() - 0.5) * 0.2 * pitchT)),
      radius: 0,
    });
    const baseTheta = rand() * 2 * Math.PI;
    let r = pitchT * 0.75;
    let ring = 0;
    while (r < zoneR && sites.length < SITE_COUNT_MAX) {
      const gap = mode === 'rings'
        ? pitchT * 0.8
        : pitchT * elong * (1 + 0.1 * ring);
      const pitch = mode === 'rings' ? pitchT * elong : pitchT;
      const rMid = r + gap * 0.5;
      const sectors = Math.max(4, Math.round((2 * Math.PI * rMid) / pitch));
      const spiralOff = mode === 'spiral' ? ring * 0.381966 * 2 * Math.PI : 0;
      for (let s = 0; s < sectors; s++) {
        if (sites.length >= SITE_COUNT_MAX) break;
        const th = baseTheta + spiralOff + ((s + 0.5) / sectors) * 2 * Math.PI
          + (rand() - 0.5) * jitterAmt * (2 * Math.PI / sectors);
        const rr = rMid + (rand() - 0.5) * jitterAmt * gap * 0.7;
        const sx0 = cp.x + rr * Math.cos(th);
        const sy0 = cp.y + rr * Math.sin(th);
        // Skip sites far off-panel; clamp near-edge ones (border cells stay sane).
        if (sx0 < -margin || sx0 > meshX + margin || sy0 < -margin || sy0 > meshY + margin) continue;
        sites.push({
          x: Math.max(0, Math.min(meshX, sx0)),
          y: Math.max(0, Math.min(meshY, sy0)),
          radius: 0,
        });
      }
      r += gap;
      ring++;
    }
  }
}

/** Generate a roughly-uniform jittered grid of sites, density modulated by the attractor
 *  mask and (v16) a low-frequency density-noise field. Sites are placed in the same
 *  coordinate space the warped queries live in and are never displaced — cell flow comes
 *  entirely from warping the query points. */
function generateSites(
  p: ReliefSampleParams,
  rand: () => number,
  densityGen: SimplexNoiseGen | null,
  exclusionFoci: ReadonlyArray<{ x: number; y: number }>,
  exclusionR: number,
): Site[] {
  const { meshX, meshY, cellSize, jitter } = p;
  const baseSpacing = Math.max(0.2, cellSize);
  const nx = Math.max(2, Math.ceil(meshX / baseSpacing) + 1);
  const ny = Math.max(2, Math.ceil(meshY / baseSpacing) + 1);
  const sx = meshX / nx;
  const sy = meshY / ny;
  const densityNoiseAmt = Math.max(0, Math.min(1.5, p.densityNoise));
  const densityNoiseFreq = Math.max(0.02, Math.min(0.3, p.densityNoiseFreq));
  const exclusionR2 = exclusionR * exclusionR;

  const sites: Site[] = [];
  outer: for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = (i + 0.5) * sx;
      const cy = (j + 0.5) * sy;
      const u = cx / meshX;
      const v = cy / meshY;
      const mask = attractorMask(
        p.attractorMode, u, v, p.attractorX, p.attractorY,
        p.attractorRadius, p.attractorFalloff,
      );
      let localDensity = Math.max(0, Math.min(LOCAL_DENSITY_MAX, 1 + p.densityStrength * mask));
      // v16 patchy density: low-frequency noise multiplies local density so giant cells
      // (density < 1) and dense clusters (density > 1) coexist across the panel.
      if (densityGen && densityNoiseAmt > 0) {
        const n = densityGen.noise(cx * densityNoiseFreq, cy * densityNoiseFreq);
        localDensity *= Math.max(0.1, Math.min(LOCAL_DENSITY_MAX, 1 + densityNoiseAmt * n * DENSITY_NOISE_GAIN));
      }
      localDensity = Math.min(LOCAL_DENSITY_MAX, Math.max(0.1, localDensity));
      const reps = Math.floor(localDensity) + (rand() < (localDensity - Math.floor(localDensity)) ? 1 : 0);
      for (let k = 0; k < reps; k++) {
        if (sites.length >= SITE_COUNT_MAX) break outer;
        const jx = (rand() - 0.5) * jitter * sx;
        const jy = (rand() - 0.5) * jitter * sy;
        const px = Math.max(0, Math.min(meshX, cx + jx));
        const py = Math.max(0, Math.min(meshY, cy + jy));
        // v16.2: the polar lattices own the focal zones — Cartesian sites inside an
        // exclusion disc would double the density there and shred the petal structure.
        if (exclusionR > 0) {
          let excluded = false;
          for (let f = 0; f < exclusionFoci.length; f++) {
            const dx = px - exclusionFoci[f].x;
            const dy = py - exclusionFoci[f].y;
            if (dx * dx + dy * dy < exclusionR2) { excluded = true; break; }
          }
          if (excluded) continue;
        }
        sites.push({ x: px, y: py, radius: 0 });
      }
    }
  }
  return sites;
}

/** One pass of Lloyd relaxation — moves each site toward the centroid of its assigned
 *  samples. Samples are warped through W so relaxation happens in the same space the
 *  distance queries use. Sites at index ≥ pinnedFrom (the polar starburst lattices) are
 *  NOT moved: centroidal relaxation homogenizes cells toward isotropy, which would erase
 *  exactly the radial elongation the lattices exist to produce. */
function lloydRelax(
  sites: Site[],
  p: ReliefSampleParams,
  samples: number,
  warpFn: ((x: number, y: number) => [number, number]) | null,
  pinnedFrom: number,
): void {
  const { meshX, meshY } = p;
  const sumX = new Float64Array(sites.length);
  const sumY = new Float64Array(sites.length);
  const counts = new Int32Array(sites.length);
  for (let s = 0; s < samples; s++) {
    let x = halton(s + 1, 2) * meshX;
    let y = halton(s + 1, 3) * meshY;
    if (warpFn) {
      [x, y] = warpFn(x, y);
    }
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
  const moveLimit = Math.min(sites.length, Math.max(0, pinnedFrom));
  for (let i = 0; i < moveLimit; i++) {
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

/** Find F1, F2, F3 and the index of the nearest site under a CONSTANT anisotropic metric.
 *  The frame never varies per pixel (v16 removed the rotating-metric mechanism — a
 *  constant frame cannot tear cell ownership). Distance is computed in the rotated
 *  anisotropy frame: rotation preserves length, so we scale x' and take hypot directly.
 *  F3 (third-nearest) drives junction detection: at a three-way Voronoi corner
 *  F1 ≈ F2 ≈ F3, so (F3 − F1) → 0 exactly at junctions (v16.3). */
function nearestThree(
  sites: Site[],
  x: number,
  y: number,
  cosA: number,
  sinA: number,
  anisotropyScale: number,
): { f1: number; f2: number; f3: number; idx: number } {
  let f1 = Infinity;
  let f2 = Infinity;
  let f3 = Infinity;
  let idx = 0;
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
    if (d < f1) { f3 = f2; f2 = f1; f1 = d; idx = i; }
    else if (d < f2) { f3 = f2; f2 = d; }
    else if (d < f3) { f3 = d; }
  }
  return { f1, f2, f3, idx };
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
    const seed = (p.seed ?? this.fallbackSeed) >>> 0;
    const rand = mulberry32(seed);
    // Base wave field (v16 superposition term). Re-seeded per call so same p.seed → same
    // wave even when the generator instance is reused across renders.
    const waveGen = new SimplexNoiseGen(seed + WAVE_GEN_SEED_OFFSET);
    // Patchy modulator for the attractor mask — random "blob" zones of intensity.
    const attractorNoiseGen = p.attractorNoise > 0
      ? new SimplexNoiseGen(seed + WAVE_GEN_SEED_OFFSET + 29)
      : null;
    // v16 patchy site density field.
    const densityNoiseGen = p.densityNoise > 0
      ? new SimplexNoiseGen(seed + WAVE_GEN_SEED_OFFSET + 71)
      : null;

    // Starburst foci — sanitize defensively even though state.ts URL-clamps cover the
    // share-link path: callers constructing ReliefSampleParams directly (tests, future
    // paths) bypass sampleReliefParamsFromState's pruning.
    const radialFociNormalized = p.radialFoci
      .filter(f => Number.isFinite(f.x) && Number.isFinite(f.y))
      .slice(0, 3)
      .map(f => ({
        x: Math.max(0, Math.min(1, f.x)),
        y: Math.max(0, Math.min(1, f.y)),
      }));
    const fociPhys = radialFociNormalized.map(f => ({
      x: f.x * p.meshX,
      y: f.y * p.meshY,
    }));
    const sigmaRadial = Math.max(
      1e-3,
      Math.max(0.02, Math.min(0.6, p.radialFalloff)) * Math.hypot(p.meshX, p.meshY),
    );
    const radialStrength = Math.max(0, Math.min(4, p.radialStrength));
    const radialGrow = Math.max(0, Math.min(2, p.radialGrow));
    const radialWarpAmt = fociPhys.length > 0 ? Math.max(0, Math.min(1, p.radialWarp)) : 0;
    // Sanitize distortion ONCE and reuse everywhere it sizes work: the warp amplitude and
    // the radius-field padding below. state.ts clamps URL payloads, but params constructed
    // directly (tests, future callers) bypass that path — a huge finite value here would
    // explode the padded coarse-grid allocation.
    const warpDistortion = Number.isFinite(p.warpDistortion)
      ? Math.max(0, Math.min(2, p.warpDistortion))
      : 0;

    const warpFn = makeWarpFn(p, seed, warpDistortion);

    // v16.2 starburst: polar site lattices own a disc of radius zoneR around each focus;
    // Cartesian sites are excluded slightly inside it so the petal structure stays clean.
    const starburstActive = fociPhys.length > 0 && radialStrength > 0;
    const zoneR = starburstActive ? POLAR_ZONE_SIGMAS * sigmaRadial : 0;
    const sites = generateSites(
      p, rand, densityNoiseGen,
      starburstActive ? fociPhys : [],
      starburstActive ? zoneR * POLAR_EXCLUSION_FRACTION : 0,
    );
    const cartesianCount = sites.length;
    if (starburstActive) {
      generatePolarSites(
        fociPhys, zoneR, Math.max(0.2, p.cellSize), radialStrength, radialGrow,
        radialWarpAmt, p.radialMode, rand, p.meshX, p.meshY, sites,
      );
    }
    if (sites.length === 0) {
      const empty: number[][] = [];
      for (let j = 0; j < p.rows; j++) empty.push(new Array(p.cols).fill(0));
      return empty;
    }

    // Lloyd relaxation passes (default 1, max 2). Hard-cap defends against crafted links.
    // Polar lattice sites (index ≥ cartesianCount) are pinned — relaxation would erase
    // their deliberate radial elongation.
    const relaxIters = Math.max(0, Math.min(2, Math.floor(p.relaxIterations) || 0));
    const lloydSamples = Math.min(LLOYD_SAMPLE_BUDGET_MAX, sites.length * LLOYD_SAMPLES_PER_SITE);
    for (let r = 0; r < relaxIters; r++) {
      lloydRelax(sites, p, lloydSamples, warpFn, cartesianCount);
    }

    // NaN guards on the constant metric frame (crafted params / direct construction).
    const baseAnisotropy = Number.isFinite(p.anisotropy)
      ? Math.max(0, Math.min(2, p.anisotropy))
      : 0;
    const safeAnisotropyAngle = Number.isFinite(p.anisotropyAngle) ? p.anisotropyAngle : 0;
    const aAngle = safeAnisotropyAngle * Math.PI / 180;
    const cosA = Math.cos(aAngle);
    const sinA = Math.sin(aAngle);
    // The metric scale inflates the component ALONG (cosA, sinA), which narrows the cell
    // along that axis and widens it perpendicular → cells elongate ⟂ anisotropyAngle.
    const metricScale = 1 + baseAnisotropy * ANISOTROPY_SCALE_MULTIPLIER;

    // Hoisted + clamped shaping params.
    const transitionSoftness = Math.max(0, Math.min(1, p.transitionSoftness));
    const transitionExponent = TRANSITION_EXPONENT_MIN
      + transitionSoftness * (TRANSITION_EXPONENT_MAX - TRANSITION_EXPONENT_MIN);
    const baseAmplitude = p.baseMode === 'wave' && Number.isFinite(p.baseAmplitude)
      ? Math.max(0, Math.min(2, p.baseAmplitude))
      : 0;
    const baseFrequency = Number.isFinite(p.baseFrequency)
      ? Math.max(0.02, Math.min(0.3, p.baseFrequency))
      : 0.1;
    const wallFrac = Number.isFinite(p.wallWidth)
      ? Math.max(0, Math.min(0.9, p.wallWidth))
      : 0;

    const cols = p.cols;
    const rows = p.rows;

    // Precompute warped query coordinates once — shared by Pass 1 and Pass 2 (and the
    // per-pixel radius-field lookups). Identity fast path when no warp is active.
    const wxArr = new Float64Array(rows * cols);
    const wyArr = new Float64Array(rows * cols);
    for (let j = 0; j < rows; j++) {
      const v = j / Math.max(1, rows - 1);
      const y = v * p.meshY;
      for (let i = 0; i < cols; i++) {
        const u = i / Math.max(1, cols - 1);
        const x = u * p.meshX;
        const idx = j * cols + i;
        if (warpFn) {
          const [qx, qy] = warpFn(x, y);
          wxArr[idx] = qx;
          wyArr[idx] = qy;
        } else {
          wxArr[idx] = x;
          wyArr[idx] = y;
        }
      }
    }

    // Pass 1: accumulate per-site mean F1 (in the warped metric — the same one Pass 2
    // normalizes with, so normDist still hits ~1 at cell centers).
    const radiusSum = new Float64Array(sites.length);
    const radiusN = new Int32Array(sites.length);
    for (let idx = 0; idx < rows * cols; idx++) {
      const { f1, idx: siteIdx } = nearestThree(sites, wxArr[idx], wyArr[idx], cosA, sinA, metricScale);
      radiusSum[siteIdx] += f1;
      radiusN[siteIdx]++;
    }
    for (let k = 0; k < sites.length; k++) {
      sites[k].radius = radiusN[k] > 0 ? (radiusSum[k] / radiusN[k]) * 2 : p.cellSize;
    }

    // Pass 1.5: continuous radius field R via Gaussian blending of per-site radii, computed
    // on a coarse grid (pitch σ/2, well above Nyquist for a Gaussian field of scale σ) and
    // bilinear-upsampled at the warped query coordinates. The coarse domain is padded by the
    // maximum warp displacement so warped queries never sample outside it.
    const sigmaR = Math.max(0.2, p.cellSize) * RADIUS_FIELD_SIGMA_CELLS;
    const sigmaR2 = sigmaR * sigmaR;
    const cutoffR = sigmaR * RADIUS_FIELD_CUTOFF_SIGMAS;
    const cutoffR2 = cutoffR * cutoffR;
    // v16.2: only the flow warp displaces query points now (the starburst is a site
    // layout), so the padding needs only the flow amplitude.
    const pad = warpDistortion * Math.max(0.2, p.cellSize) * FLOW_WARP_AMPLITUDE_CELLS;
    const domX0 = -pad;
    const domY0 = -pad;
    const domW = p.meshX + 2 * pad;
    const domH = p.meshY + 2 * pad;
    const coarsePitch = sigmaR * RADIUS_FIELD_COARSE_PITCH_SIGMAS;
    const coarseCols = Math.max(2, Math.ceil(domW / coarsePitch) + 1);
    const coarseRows = Math.max(2, Math.ceil(domH / coarsePitch) + 1);
    const coarseStepX = domW / (coarseCols - 1);
    const coarseStepY = domH / (coarseRows - 1);
    const Rcoarse = new Float64Array(coarseRows * coarseCols);
    for (let cj = 0; cj < coarseRows; cj++) {
      const y = domY0 + cj * coarseStepY;
      for (let ci = 0; ci < coarseCols; ci++) {
        const x = domX0 + ci * coarseStepX;
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
    const sampleRfield = (qx: number, qy: number): number => {
      const cx = Math.max(0, Math.min(coarseCols - 1.001, (qx - domX0) / coarseStepX));
      const cy = Math.max(0, Math.min(coarseRows - 1.001, (qy - domY0) / coarseStepY));
      const ci0 = Math.floor(cx);
      const cj0 = Math.floor(cy);
      const tx = cx - ci0;
      const ty = cy - cj0;
      const r00 = Rcoarse[cj0 * coarseCols + ci0];
      const r10 = Rcoarse[cj0 * coarseCols + ci0 + 1];
      const r01 = Rcoarse[(cj0 + 1) * coarseCols + ci0];
      const r11 = Rcoarse[(cj0 + 1) * coarseCols + ci0 + 1];
      const r0 = r00 * (1 - tx) + r10 * tx;
      const r1 = r01 * (1 - tx) + r11 * tx;
      return r0 * (1 - ty) + r1 * ty;
    };

    // Pass 2: heights. Wall band + bowl profile on the F2-F1 differential, superposed onto
    // the base wave. Attractor/void/intensity shaping preserved from the prior algorithm.
    const cellSizeGradient = Math.max(0, Math.min(2, p.cellSizeGradient));
    const voidStrength = Math.max(0, Math.min(1, p.voidStrength));
    const attractorNoiseAmt = Math.max(0, Math.min(1, p.attractorNoise));
    const attractorNoiseFreq = Math.max(0.02, Math.min(0.5, p.attractorNoiseFreq));
    const intensityStrengthClamped = Math.max(0, Math.min(1, p.intensityStrength));
    const inv2sigma2Radial = 1 / (2 * sigmaRadial * sigmaRadial);
    // v16.3 spec mechanisms (docs/voronoi-relief-target-spec.md):
    //   depthVariation — per-cell hash depth TIERS (deep/intermediate/shallow-suppressed)
    //     plus per-cell seamDepth jitter → asymmetric wall profiles across shared ridges.
    //   junctionLift — crests rise toward three-way junctions ((F3−F1)/(2R) → 0 there),
    //     which also WIDENS the local wall band (junctions read wider than their ridges).
    //   wall-width noise — ridge width varies continuously along each edge.
    const depthVariation = Number.isFinite(p.depthVariation)
      ? Math.max(0, Math.min(1, p.depthVariation))
      : 0;
    const junctionLift = Number.isFinite(p.junctionLift)
      ? Math.max(0, Math.min(1, p.junctionLift))
      : 0;
    const wallNoiseGen = wallFrac > 0
      ? new SimplexNoiseGen(seed + WAVE_GEN_SEED_OFFSET + 83)
      : null;
    const wallNoiseFreq = 0.45 / Math.max(0.2, p.cellSize);
    const seamDepthBase = Math.max(0.05, p.seamDepth);
    // Smooth floor saturation: replaces the hard min(bowlT, 1) clamp with a C1 fillet band
    // so floors meet walls through a rounded transition (spec: "tighter-radius fillet",
    // "floor-to-wall transition is generally softened").
    const FILLET_BAND = 0.18;
    // v16.1 pillow params. The pillow ramps on the UNCAPPED bowl saturation ratio
    // (bowlTRaw = tw/seamDepth): 1.0 = the floor just saturated, 1.4 = deep interior.
    // Anchoring on this ratio (not on normDist toward 1) matters — the measured normDist
    // distribution is concentrated low, so ramps anchored near 1 never fire.
    const pillowAmt = Number.isFinite(p.pillow) ? Math.max(0, Math.min(1, p.pillow)) : 0;
    const pillowCoverage = Number.isFinite(p.pillowCoverage)
      ? Math.max(0, Math.min(1, p.pillowCoverage))
      : 0.6;
    const PILLOW_RAMP_START = 1.0;
    const PILLOW_RAMP_END = 1.4;
    const out: number[][] = [];
    const polarity: number = p.polarity === 'pockets' ? -1 : 1;
    for (let j = 0; j < rows; j++) {
      const row: number[] = new Array(cols);
      const v = j / Math.max(1, rows - 1);
      const y = v * p.meshY;
      for (let i = 0; i < cols; i++) {
        const u = i / Math.max(1, cols - 1);
        const x = u * p.meshX;
        const pixIdx = j * cols + i;
        const qx = wxArr[pixIdx];
        const qy = wyArr[pixIdx];
        const { f1, f2, f3, idx: ownerIdx } = nearestThree(sites, qx, qy, cosA, sinA, metricScale);
        // Spatial attractor on intensity — relief amplitude varies with mask (real-space).
        let mask = attractorMask(
          p.attractorMode, u, v, p.attractorX, p.attractorY,
          p.attractorRadius, p.attractorFalloff,
        );
        if (attractorNoiseGen && attractorNoiseAmt > 0) {
          const n = attractorNoiseGen.noise(x * attractorNoiseFreq, y * attractorNoiseFreq);
          const modulator = (n + 1) * 0.5;
          mask = mask * ((1 - attractorNoiseAmt) + attractorNoiseAmt * modulator * 1.5);
          if (mask > 1) mask = 1;
          if (mask < 0) mask = 0;
        }
        // Focal proximity (real-space) — drives focal expansion and intensity deepening.
        let gMax = 0;
        for (let k = 0; k < fociPhys.length; k++) {
          const dx = x - fociPhys[k].x;
          const dy = y - fociPhys[k].y;
          const g = Math.exp(-(dx * dx + dy * dy) * inv2sigma2Radial);
          if (g > gMax) gMax = g;
        }
        // Cell-size gradient shrinks the effective radius where mask is high; focal
        // expansion widens it near foci. Both act on the continuous R field.
        const sizeShrink = 1 - cellSizeGradient * mask * 0.6;
        const focalExpand = 1 + radialGrow * gMax * FOCAL_EXPAND_GAIN;
        const R = Math.max(0.05, sampleRfield(qx, qy)
          * Math.max(0.2, sizeShrink)
          * Math.min(FOCAL_EXPAND_CAP, focalExpand));

        // WORLEY F2-F1 DISTANCE-FIELD HEIGHT with v16 wall band.
        //   - at cell boundary (F1≈F2): normDist → 0 → inside the wall band → h stays at base
        //   - at cell center: normDist → ~1 → full bowl depth (big cells deeper — the
        //     lafabrica gradient, via the 2R normalization)
        const distDiff = f2 - f1;
        const normDist = Math.min(1, distDiff / (2 * R));
        // v16.3 junction proximity: (F3−F1) → 0 exactly at three-way corners; jn ≈ 1 there,
        // → 0 along edge midpoints and inside cells.
        const jn = 1 - Math.min(1, (f3 - f1) / (2 * R));
        const jnS = smoothstep(0.55, 0.95, jn);
        // v16.3 variable wall band: ridge width varies continuously along each edge
        // (low-frequency noise) and widens strongly at junctions — the spec's order-of-
        // magnitude ridge-width variation and star-shaped junction plateaus.
        let wallFracLocal = wallFrac;
        if (wallNoiseGen && wallFrac > 0) {
          const wn = wallNoiseGen.noise(x * wallNoiseFreq, y * wallNoiseFreq);
          wallFracLocal = Math.min(0.9, wallFrac * Math.max(0.15, 1 + 0.8 * wn + 1.4 * jnS));
        }
        const tw = Math.max(0, (normDist - wallFracLocal) / Math.max(0.05, 1 - wallFracLocal));
        // v16.3 asymmetric walls: per-cell seamDepth jitter — the two cells sharing a ridge
        // saturate at different rates, so one side descends long/shallow while the other
        // drops short/steep (spec: "wall profile is asymmetric across many ridges").
        let seamDepthLocal = seamDepthBase;
        if (depthVariation > 0) {
          const hSeam = cellHash01(ownerIdx, seed + 29);
          seamDepthLocal = Math.max(0.05, seamDepthBase * (1 + (hSeam - 0.5) * 0.8 * depthVariation));
        }
        const bowlTRaw = tw / seamDepthLocal;
        // Smooth floor saturation (C1 fillet into the floor) instead of a hard clamp kink.
        let bowlT: number;
        if (bowlTRaw >= 1 + FILLET_BAND) bowlT = 1;
        else if (bowlTRaw <= 1 - FILLET_BAND) bowlT = bowlTRaw;
        else {
          const e = 1 + FILLET_BAND - bowlTRaw;
          bowlT = 1 - (e * e) / (4 * FILLET_BAND);
        }
        // Profile shapes the bowl falloff curve. All profiles have dh/dt = 0 at t=0 so the
        // wall-to-bowl transition is crease-free.
        let bowlH: number;
        if (p.profile === 'hemisphere') {
          const t2 = bowlT * bowlT;
          bowlH = 1 - Math.sqrt(Math.max(0, 1 - t2));
        } else if (p.profile === 'cosine') {
          bowlH = 0.5 - 0.5 * Math.cos(bowlT * Math.PI);
        } else {
          // 'parabolic'
          bowlH = bowlT * bowlT;
        }
        // Seam sharpness — blend toward a linear ramp for V-groove gutters.
        if (p.seamSharpness > 0) {
          const sharp = Math.max(0, Math.min(1, p.seamSharpness));
          bowlH = (1 - sharp) * bowlH + sharp * bowlT;
        }
        // v16.1 pillowed floors: past the saturation point the floor rises back toward the
        // cell center — the reference's double-curvature pockets. Per-cell hash gates which
        // cells pillow (coverage) and varies the mound height so the panel mixes pillowed
        // and plain pockets. Capped at 65% of the depth so mounds never poke above walls.
        if (pillowAmt > 0 && bowlTRaw > PILLOW_RAMP_START) {
          const gate = cellHash01(ownerIdx, seed);
          if (gate < pillowCoverage) {
            const amtVar = 0.6 + 0.4 * cellHash01(ownerIdx, seed + 7);
            const pillowT = smoothstep(PILLOW_RAMP_START, PILLOW_RAMP_END, bowlTRaw);
            bowlH -= pillowAmt * amtVar * 0.65 * pillowT;
            if (bowlH < 0) bowlH = 0;
          }
        }
        // invertProfile: carve the boundary instead of the interior (domed floors).
        if (p.invertProfile > 0.5) {
          bowlH = 1 - bowlH;
        }

        // Intensity scales bowl depth by the attractor mask OR focal proximity (whichever
        // is stronger) — foci deepen cells on top of the warp elongation.
        const intensityFactor = (1 - intensityStrengthClamped)
          + intensityStrengthClamped * Math.max(mask, gMax);
        // Spatial gating: cells fade out where the mask is low (transitionSoftness shapes
        // the falloff). With attractorMode 'none' (mask = 1) this is a no-op.
        const cellWeight = Math.pow(mask, transitionExponent);
        // v16.3 depth tiers: three per-cell depth classes (deep / intermediate / shallow).
        // The shallow tier at high variation suppresses cells into the surrounding mass —
        // the spec's "large calm surface masses" and "cells partially swallowed by walls".
        let cellDepthMul = 1;
        if (depthVariation > 0) {
          const hDepth = cellHash01(ownerIdx, seed + 13);
          const tier = hDepth < 0.2 ? 0.25 : (hDepth < 0.55 ? 0.6 : 1);
          cellDepthMul = 1 - depthVariation * (1 - tier);
        }

        // v16 SUPERPOSITION: the base wave is never attenuated by the cell system — cells
        // are carved INTO it. Ridge tops (bowlH = 0) sit exactly on the base surface.
        const base = baseAmplitude > 0
          ? baseAmplitude * waveGen.noise(x * baseFrequency, y * baseFrequency)
          : 0;
        let h = base + polarity * bowlH * cellWeight * intensityFactor * cellDepthMul;
        // v16.3 junction lift: crests rise toward three-way junctions (spec: junction
        // peaks at 0.90-1.00, crest midpoints dipping). Faded by (1 − bowlH) so the lift
        // lives on ridges and shoulders, never inside carved floors.
        if (junctionLift > 0) {
          h += junctionLift * 0.35 * jnS * (1 - bowlH);
        }

        // Void mode pushes h toward the negative clamp where mask + bowl depth are high —
        // the cut-through spike-finger zone.
        if (voidStrength > 0) {
          const voidGate = mask * bowlH;
          const voidEdge0 = 1 - voidStrength;
          const voidEdge1 = 1 - voidStrength * 0.5;
          const voidT = smoothstep(voidEdge0, voidEdge1, voidGate);
          h = h * (1 - voidT) - OUTPUT_HEIGHT_CLAMP * voidT;
        }

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
    reliefInvertProfile: number;
    reliefSeamSharpness: number;
    reliefAttractorNoise: number;
    reliefAttractorNoiseFreq: number;
    reliefBaseAmplitude: number;
    reliefBaseFrequency: number;
    reliefWallWidth: number;
    reliefDensityNoise: number;
    reliefDensityNoiseFreq: number;
    reliefPillow: number;
    reliefPillowCoverage: number;
    reliefDepthVariation: number;
    reliefJunctionLift: number;
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
  // list as "starburst off" → byte-identical to non-foci output.
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
    // The global distortion/warpFreq sliders drive the flow component of the space-warp.
    warpDistortion: s.distortion,
    warpFrequency: s.warpFreq,
    cellSizeGradient: s.reliefCellSizeGradient,
    voidStrength: s.reliefVoidStrength,
    invertProfile: s.reliefInvertProfile,
    seamSharpness: s.reliefSeamSharpness,
    attractorNoise: s.reliefAttractorNoise,
    attractorNoiseFreq: s.reliefAttractorNoiseFreq,
    baseAmplitude: s.reliefBaseAmplitude,
    baseFrequency: s.reliefBaseFrequency,
    wallWidth: s.reliefWallWidth,
    densityNoise: s.reliefDensityNoise,
    densityNoiseFreq: s.reliefDensityNoiseFreq,
    pillow: s.reliefPillow,
    pillowCoverage: s.reliefPillowCoverage,
    depthVariation: s.reliefDepthVariation,
    junctionLift: s.reliefJunctionLift,
    radialFoci,
    radialStrength: s.reliefRadialStrength,
    radialFalloff: s.reliefRadialFalloff,
    radialGrow: s.reliefRadialGrow,
    radialWarp: s.reliefRadialWarp,
    radialMode: s.reliefRadialMode,
  };
}
