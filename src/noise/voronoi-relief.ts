import { metricOrdering } from './metric-order';
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
 *   3. Pass 1 accumulates mean F1 and maximum exact capped bisector distance per site.
 *   4. Complete compact support interpolates static depth, slope, radius, seam and shared
 *      strength fields. Ordered side variation fades to zero at every owner boundary.
 *   5. Pass 2 uses a complete sparse bisector minimum for the wall/bowl remap, then
 *      superposes base, crest, lift, attractor and void fields before output clamping.
 *
 * Output is in noise-native range; the standard CNC-z normalization in mesh.ts handles
 * the rest.
 */
import type {
  ReliefAttractorMode,
  ReliefBaseMode,
  ReliefCrestClipStatus,
  ReliefGenerator,
  ReliefPolarity,
  ReliefProfile,
  ReliefRadialMode,
  ReliefSampleParams,
  ReliefSiteSet,
  ReliefQueryDescription,
  ReliefSourceSnapshot,
} from '../types';
import { SimplexNoiseGen } from './generators';
import { copyReliefSites, copyReliefSource, sameReliefKernel, validateReliefSites } from './relief-sites';
import { mulberry32, cellHash01 } from './prng';
import { SiteGrid, type GridSite } from './site-grid';
import { MAX_CUT_DEPTH_IN } from '../sbp/types';

/** Every control that can alter generated site positions, count, pinning or order.
 * Cartesian density and suppression, focal exclusion/polar candidates, seeded selection and
 * warped Lloyd centroids share this producer-owned list. Radius/height shaping is excluded. */
export const RELIEF_PLACEMENT_KEYS = Object.freeze([
  'meshX', 'meshY', 'seed', 'reliefCellSize', 'reliefJitter', 'reliefRelaxIterations',
  'reliefDensityStrength', 'reliefDensityNoise', 'reliefDensityNoiseFreq', 'reliefDepthVariation',
  'reliefAttractorMode', 'reliefAttractorX', 'reliefAttractorY', 'reliefAttractorRadius', 'reliefAttractorFalloff',
  'reliefRadialFociCount', 'reliefRadialFocus1X', 'reliefRadialFocus1Y', 'reliefRadialFocus2X', 'reliefRadialFocus2Y',
  'reliefRadialFocus3X', 'reliefRadialFocus3Y', 'reliefRadialStrength', 'reliefRadialFalloff', 'reliefRadialGrow', 'reliefRadialWarp', 'reliefRadialMode',
  'distortion', 'warpFreq',
] as const);

// Tuning constants — kept central so future work has one place to edit.
const LLOYD_SAMPLES_PER_SITE = 64;
const WALL_MIN_PHYS = 0.3;
const CELL_MEASUREMENT_PITCH_IN = WALL_MIN_PHYS / 4;
const CELL_MEASUREMENT_MAX = 320000;
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
// Hard caps to bound site allocation and protect against crafted params. Queries use buckets.
const SITE_COUNT_MAX = 4096;
const LOCAL_DENSITY_MAX = 4;
// v17 excavation-grammar constants (see docs/voronoi-relief-target-spec.md, critique v2):
// crest variation fragments the upper envelope LOCALLY (ridge-only noise), clustered
// suppression melts whole neighborhoods of cells into calm masses, and heavy-tail density
// spikes put tiny cell clusters directly beside giant cells.
const CREST_VARIATION_GAIN = 0.4;
const SUPPRESSION_STRENGTH = 0.5;
const JUNCTION_LIFT_GAIN = 0.1;
// Crest plateau width modulation along each edge: 1 ± this per unit of wall noise
// (clamped at 0.15× so ridges thin to threads but never vanish). Drives the reference's
// chunky-to-thin ridge swings — visible ridge MASS varies, not just the wall slope run.
const RIDGE_WIDTH_SWING = 1.2;
// Junction deltas: the crest plateau flares toward three-way junctions into bold smooth
// triangular masses (the reference's Y-deltas are as big as small cells), pinching thin
// mid-edge. Applied to the crest width with a WIDER gate than the lift term, and SCALED
// by the junctionLift control (0 disables — junctionLift is the documented junction
// knob). Gain sized so the shipped presets (junctionLift 0.25-0.3) keep the ~1.5-1.8×
// flare the reference look was tuned against.
const JUNCTION_DELTA_GAIN = 6.0;
// v19 scooped floors: per-cell floor tilt (hash direction) shifts each pocket's deepest
// point off-center — steep wall on one flank, long ramp on the other. The reference's
// pockets are carved directionally, not radially symmetric. Gated by depthVariation;
// purely reductive (shallow flank ramps up) so the output clamp is never involved.
const FLOOR_TILT_GAIN = 0.7;
// v19 giant merged cells: inside the spatial suppression field, SITES are deleted (their
// territory merges into neighbors — walls survive as long sweeping creases across the calm
// zone) instead of relying on depth-melt alone, which erases structure rather than merging
// it. Deletion probability at full field strength, scaled by depthVariation.
const SUPPRESSION_KILL = 0.9;
// v20 ridge crown: the crest band is not a flat strip (whose edges read as lines under
// raking light) but a rounded BEAD — a smoothstep dome over the crest with zero slope at
// both the ridge line and the wall shoulder. The reference's wall tops are broad convex
// plateaus, never flat-topped.
const RIDGE_CROWN_GAIN = 0.15;
// v20 stretched fans: radialGrow ABOVE 1 enters a documented fan regime — the focal zone
// gets progressively SHALLOWER (while the polar lattice keeps its radially-converging
// walls), so a focus inside a calm mass reads as drape-like creases converging to a pinch
// point instead of a deep starburst. grow ≤ 1 keeps the classic deepened-focus behavior.
const FOCAL_CALM_GAIN = 0.8;
// v21 edge dissolution ceiling: the weakest edges melt this far toward floor level (the
// two adjacent cells blend into a shared basin). ~6% of edges dissolve strongly, ~20%
// weaken partially (1 − smoothstep(0.06, 0.3) on the shared edge hash).
const EDGE_DISSOLVE_MAX = 0.7;
// v21 stock-plane soft cap (pockets polarity): material can only be REMOVED — positive
// excursions (crowns, junction lift, crest noise) saturate into flat plateaus just above
// the base wave, exactly like the references' ridge tops (remnants of the original stock
// face). Also converts pyramid junctions into broad saddles and keeps the panel
// silhouette clean (no fins above the top edge).
// v21.1 slope budget (normalized depth per inch of wall extent): 1.0 at the default
// 2.4\" reference depth anchors the budget. Crown, crest and junction additions share it.
// The 0.4 gain keeps the shipped presets below the measured steep-facet area ceiling.
const SLOPE_DEPTH_BUDGET = 0.4;
const STOCK_CAP_START = 0.04;
const STOCK_CAP_SPAN = 0.13;
const SIZE_DEPTH_MIN = 0.8;
const SIZE_DEPTH_MAX = 1.2;


interface Site {
  x: number;
  y: number;
  /** Per-cell scale derived from average F1 inside the cell (set after Pass 1). Used as
   *  sample value for the Gaussian radius field (Pass 1.5); never read directly per-pixel. */
  radius: number;
}

export interface ReliefSampleResult {
  grid: number[][];
  /** Candidate count before capping, or zero when every candidate was retained. */
  truncatedFrom: number;
  crestClipStatus: ReliefCrestClipStatus;
  source: ReliefSourceSnapshot;
}

/** Select once across the full candidate population, preserving required focal nuclei
 * and original order. Cartesian candidates remain a prefix for Lloyd pinning. */
function representativeIndices(length: number, limit: number, rand: () => number, retained: readonly number[] = []): number[] {
  const required = new Set(retained);
  const indices = Array.from({length}, (_, i) => i);
  if (length <= limit) return indices;
  const available = indices.filter(i => !required.has(i));
  const count = limit - required.size;
  for (let i = 0; i < count; i++) {
    const chosen = i + Math.floor(rand() * (available.length - i));
    [available[i], available[chosen]] = [available[chosen], available[i]];
  }
  return [...retained, ...available.slice(0, count)].sort((a, b) => a - b);
}

const JUNCTION_SUPPORT_RATIO = 2.08;
// jn >= 0.98 implies F3/F1 <= this ratio. Keep the incident-cell mean in that core.
const JUNCTION_CORE_RATIO = 2 / 0.98 - 1;

export function reliefJunctionFields(candidates: readonly {index: number; distance: number}[], nearest: number,
  ...fields: (ArrayLike<number> | ((index: number) => number))[]): number[] {
  if (!Number.isFinite(nearest) || nearest < 0) throw new RangeError('Junction nearest distance must be finite and nonnegative');
  let weightSum = 0;
  const sums = fields.map(() => 0);
  for (const candidate of candidates) {
    const ratio = candidate.distance / Math.max(nearest, 1e-9);
    const weight = (1 - smoothstep(JUNCTION_CORE_RATIO, JUNCTION_SUPPORT_RATIO, ratio)) ** 2;
    if (weight === 0) continue;
    weightSum += weight;
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      sums[i] += weight * (typeof field === 'function' ? field(candidate.index) : field[candidate.index]);
    }
  }
  if (!(weightSum > 0) || sums.some(value => !Number.isFinite(value))) {
    throw new RangeError('Junction support must have positive finite weights and fields');
  }
  return sums.map(value => value / weightSum);
}

/** A collapsed band contributes zero crown, with continuous growth into a resolved bead. */
export function reliefCrownWeight(width: number, distance: number, minimumSpan: number): number {
  const span = Math.max(width, minimumSpan);
  return smoothstep(0, minimumSpan, width) * (1 - smoothstep(0, span, distance));
}

/** Pairwise fields retain their mid-edge behavior and fade into a continuous junction field. */
export function blendReliefJunction(pair: number, neighborhood: number, support: number): number {
  if (support === 0) return pair;
  return (1 - support) * pair + support * neighborhood;
}

/** smoothstep(edge0, edge1, x) clamped, with standard GLSL semantics. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Quintic smootherstep — zero FIRST and SECOND derivatives at both edges (G2 blend).
 *  Used where curvature must fade through a transition band instead of resetting at a
 *  line (the cushion ramp). */
function smootherstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** v21 per-EDGE hash. An edge is identified by its two site indices. ORDERED (a→b) gives
 *  each SIDE of a shared ridge its own value (wall asymmetry); callers wanting a value
 *  both sides agree on (crest strength) pass min/max. */
function edgeHash01(a: number, b: number, seed: number): number {
  return cellHash01(Math.imul(a + 1, 7919) + b + 1, seed);
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

/** Capture the effective constant metric and query warp used by this producer.
 * Sites stay in sampling space. Only query points pass through the recorded flow warp. */
type QueryWarp = ((x: number, y: number) => [number, number]) | null;
function queryRuntime(p: ReliefSampleParams): {description: ReliefQueryDescription; warp: QueryWarp} {
  const seed = p.seed >>> 0;
  const distortion = Number.isFinite(p.warpDistortion) ? Math.max(0, Math.min(2, p.warpDistortion)) : 0;
  const anisotropy = Number.isFinite(p.anisotropy) ? Math.max(0, Math.min(2, p.anisotropy)) : 0;
  const angle = (Number.isFinite(p.anisotropyAngle) ? p.anisotropyAngle : 0) * Math.PI / 180;
  const scale = 1 + anisotropy * ANISOTROPY_SCALE_MULTIPLIER;
  const amplitude = distortion * Math.max(0.2, p.cellSize) * FLOW_WARP_AMPLITUDE_CELLS;
  const frequency = Math.max(0.02, Number.isFinite(p.warpFrequency) ? p.warpFrequency : 0.1);
  const warpSeed = seed + WAVE_GEN_SEED_OFFSET + 13;
  const gen = amplitude > 0 ? new SimplexNoiseGen(warpSeed) : null;
  const description: ReliefQueryDescription = Object.freeze({implementation: 'meshcraft-relief-query/2',
    ownerPolicy: 'exact-represented-metric-stable-id-v1', meshX: p.meshX, meshY: p.meshY, seed,
    metric: Object.freeze(scale <= 1.0001 ? {cosA: 1, sinA: 0, scale: 1} : {cosA: Math.cos(angle), sinA: Math.sin(angle), scale}),
    warp: Object.freeze({amplitude, frequency, seed: warpSeed, kernel: gen?.describeKernel() ?? null})});
  return {description, warp: gen ? warpEvaluator(gen, amplitude, frequency) : null};
}
function warpEvaluator(gen: SimplexNoiseGen, amplitude: number, frequency: number): Exclude<QueryWarp, null> {
  return (x, y) => [x + gen.noise(x * frequency, y * frequency) * amplitude,
    y + gen.noise(x * frequency + 31.7, y * frequency + 17.3) * amplitude];
}
export function describeReliefQuery(p: ReliefSampleParams): ReliefQueryDescription {
  return queryRuntime(p).description;
}

/** Reconstruct only a recorded, matching production kernel. No placement or geometry is sampled. */
export function reliefQueryWarp(warp: ReliefQueryDescription['warp']): QueryWarp {
  const {amplitude, frequency, seed, kernel} = warp;
  if (amplitude <= 0) {
    if (kernel !== null) throw new Error('Inactive relief warp has a kernel');
    return null;
  }
  const gen = new SimplexNoiseGen(seed);
  if (!sameReliefKernel(gen.describeKernel(), kernel)) throw new Error('Unsupported relief warp kernel');
  return warpEvaluator(gen, amplitude, frequency);
}

/** Owner oracle shared with the future overlay and DXF. Stable-ID order resolves ties. */
export function reliefOwnerOracle(source: ReliefSourceSnapshot): (x: number, y: number) => number | null {
  if (source.query.implementation !== 'meshcraft-relief-query/2'
    || source.query.ownerPolicy !== 'exact-represented-metric-stable-id-v1') throw new Error('Unsupported relief query implementation');
  validateReliefSites(source.sites, source.query.meshX, source.query.meshY);
  const {xy, ids} = copyReliefSites(source.sites);
  const sites = Array.from(ids, (_, i) => ({x: xy[i * 2], y: xy[i * 2 + 1]}));
  const grid = SiteGrid.fromSites(sites), warp = reliefQueryWarp(source.query.warp);
  const metric = {...source.query.metric};
  return (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid ownership query');
    if (ids.length === 0) return null;
    const [qx, qy] = warp ? warp(x, y) : [x, y];
    return ids[grid.nearestFour(qx, qy, metric.cosA, metric.sinA, metric.scale).idx];
  };
}

/** Bound both candidate loops before grid sizing or allocation, even without foci.
 * Cartesian cells attempt at most LOCAL_DENSITY_MAX sites each. The polar estimate
 * bounds every ring by its shortest gap and largest possible sector count. Required
 * nuclei add at most three attempts. Refuse explicitly rather than biasing the cap. */
function checkSiteWork(fociCount: number, zoneR: number, cellSize: number,
  radialStrength: number, radialGrow: number, meshX: number, meshY: number): void {
  const refuse = (): never => { throw new RangeError('Relief site enumeration exceeds supported work budget'); };
  if (![zoneR, cellSize, meshX, meshY].every(Number.isFinite)
    || meshX <= 0 || meshY <= 0 || cellSize <= 0) refuse();
  const budget = 5_000_000;
  const spacing = Math.max(0.2, cellSize);
  const xCells = meshX / spacing, yCells = meshY / spacing;
  if (![xCells, yCells].every(Number.isFinite) || xCells > budget || yCells > budget) refuse();
  let work = Math.max(2, Math.ceil(xCells) + 1) * Math.max(2, Math.ceil(yCells) + 1) * LOCAL_DENSITY_MAX;
  if (!Number.isFinite(work) || work > budget) refuse();
  if (fociCount > 0) {
    const pitch = Math.max(0.3, cellSize * POLAR_TANGENTIAL_PITCH_CELLS
      * (1 + 0.5 * Math.max(0, Math.min(2, radialGrow > 1 ? 1 : radialGrow))));
    const ringBound = zoneR / (pitch * 0.8);
    if (!Number.isFinite(ringBound) || ringBound > budget) refuse();
    const rings = Math.ceil(ringBound) + 1;
    const maxGap = pitch * (1 + radialStrength) * (1 + 0.1 * rings);
    const sectorBound = 2 * Math.PI * (zoneR + maxGap * 0.5) / pitch;
    if (!Number.isFinite(sectorBound) || sectorBound > budget) refuse();
    work += fociCount * (1 + rings * Math.max(4, Math.ceil(sectorBound)));
  }
  if (!Number.isFinite(work) || work > budget) refuse();
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
): number[] {
  const nuclei: number[] = [];
  // v20 fan regime (radialGrow > 1): the lattice pitch stops growing with grow (more
  // sectors survive), the sector COUNT locks across rings so sector boundaries align
  // into long radially-converging creases, angular jitter is damped, and dropout is
  // reduced — a stretched fan whose creases run unbroken toward the pinch point.
  const fan = radialGrow > 1;
  const pitchT = Math.max(0.3, cellSize * POLAR_TANGENTIAL_PITCH_CELLS
    * (1 + 0.5 * Math.max(0, Math.min(2, fan ? 1 : radialGrow))));
  const elong = 1 + Math.max(0, Math.min(4, radialStrength));
  const margin = Math.max(0.2, cellSize);
  for (let k = 0; k < fociPhys.length; k++) {
    const cp = fociPhys[k];
    nuclei.push(sites.length);
    // Nucleus site — the small calm cell at the node the reference shows.
    sites.push({
      x: Math.max(0, Math.min(meshX, cp.x + (rand() - 0.5) * 0.2 * pitchT)),
      y: Math.max(0, Math.min(meshY, cp.y + (rand() - 0.5) * 0.2 * pitchT)),
      radius: 0,
    });
    const baseTheta = rand() * 2 * Math.PI;
    let r = pitchT * 0.75;
    let ring = 0;
    let sectorsLocked = 0;
    while (r < zoneR) {
      const gap = mode === 'rings'
        ? pitchT * 0.8
        : pitchT * elong * (1 + 0.1 * ring);
      const pitch = mode === 'rings' ? pitchT * elong : pitchT;
      const rMid = r + gap * 0.5;
      const sectors = fan && sectorsLocked > 0
        ? sectorsLocked
        : Math.max(4, Math.round((2 * Math.PI * rMid) / pitch));
      if (fan && sectorsLocked === 0) sectorsLocked = sectors;
      const spiralOff = mode === 'spiral' ? ring * 0.381966 * 2 * Math.PI : 0;
      for (let s = 0; s < sectors; s++) {
        // v17 sector dropout — deletes random spokes so fans read as discovered, not
        // generated (critique: radial systems too visibly algorithmic).
        if (rand() < (fan ? 0.1 : 0.25) * jitterAmt) continue;
        const th = baseTheta + spiralOff + ((s + 0.5) / sectors) * 2 * Math.PI
          + (rand() - 0.5) * jitterAmt * (2 * Math.PI / sectors) * (fan ? 0.35 : 1);
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
  return nuclei;
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
  suppressGen: SimplexNoiseGen | null,
  bruteForce: boolean,
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
  // v19 giant merged cells: the SAME low-frequency field that melts depth in Pass 2
  // (seed offset +103, freq 0.16/cellSize) deletes sites here — several neighboring
  // cells merge into one giant territory whose surviving perimeter walls read as long
  // sweeping creases across the calm zone (the reference's smooth masses are enormous
  // CELLS, not erased relief).
  const depthVariationAmt = Number.isFinite(p.depthVariation)
    ? Math.max(0, Math.min(1, p.depthVariation))
    : 0;
  const suppressFreqSites = 0.16 / Math.max(0.2, cellSize);
  const killedReserve: Array<{ x: number; y: number }> = [];

  const sites: Site[] = [];
  const separation = new SiteGrid(sites, baseSpacing, { minX: 0, minY: 0, maxX: meshX, maxY: meshY });
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = (i + 0.5) * sx;
      const cy = (j + 0.5) * sy;
      const u = cx / meshX;
      const v = cy / meshY;
      const mask = attractorMask(
        p.attractorMode, u, v, p.attractorX, p.attractorY,
        p.attractorRadius, p.attractorFalloff,
      );
      if (suppressGen && depthVariationAmt > 0) {
        const sn01 = (suppressGen.noise(cx * suppressFreqSites, cy * suppressFreqSites) + 1) * 0.5;
        const kill = smoothstep(0.66, 0.8, sn01) * SUPPRESSION_KILL * depthVariationAmt;
        if (kill > 0 && rand() < kill) {
          // Remember a few deleted cell centers — if deletion (on a small grid inside a
          // strong field) wipes out every candidate, restore from these below so the
          // sampler degrades to giant merged cells, never to a flat zero-site panel.
          if (killedReserve.length < 8) killedReserve.push({ x: cx, y: cy });
          continue;
        }
      }
      let localDensity = Math.max(0, Math.min(LOCAL_DENSITY_MAX, 1 + p.densityStrength * mask));
      // v16 patchy density: low-frequency noise multiplies local density so giant cells
      // (density < 1) and dense clusters (density > 1) coexist across the panel.
      if (densityGen && densityNoiseAmt > 0) {
        const n = densityGen.noise(cx * densityNoiseFreq, cy * densityNoiseFreq);
        localDensity *= Math.max(0.1, Math.min(LOCAL_DENSITY_MAX, 1 + densityNoiseAmt * n * DENSITY_NOISE_GAIN));
        // v17 heavy-tail spikes: rare abrupt jumps between scales — tiny cell clusters
        // directly beside giant cells, with weak spatial correlation (critique: the size
        // distribution was too continuously graded).
        const spike = rand();
        if (spike < 0.03 * densityNoiseAmt) localDensity *= 3;
        else if (spike < 0.08 * densityNoiseAmt) localDensity *= 0.12;
      }
      localDensity = Math.min(LOCAL_DENSITY_MAX, Math.max(0.1, localDensity));
      const reps = Math.floor(localDensity) + (rand() < (localDensity - Math.floor(localDensity)) ? 1 : 0);
      for (let k = 0; k < reps; k++) {
        const jx = (rand() - 0.5) * jitter * sx;
        const jy = (rand() - 0.5) * jitter * sy;
        const px = Math.max(0, Math.min(meshX, cx + jx));
        const py = Math.max(0, Math.min(meshY, cy + jy));
        // v21.1 minimum separation: jittered reps can land two sites arbitrarily close,
        // producing sliver cells whose entire wall geometry is narrower than a sample —
        // they render as torn shelves. (Physically: features below the tool radius
        // cannot be cut anyway.)
        {
          const minSep2 = (0.35 * baseSpacing) * (0.35 * baseSpacing);
          let tooClose = !bruteForce && separation.hasWithin(px, py, 0.35 * baseSpacing);
          for (let q = 0; bruteForce && q < sites.length; q++) {
            const ddx = sites[q].x - px;
            const ddy = sites[q].y - py;
            if (ddx * ddx + ddy * ddy < minSep2) { tooClose = true; break; }
          }
          if (tooClose) continue;
        }
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
        if (!bruteForce) separation.add(sites.length - 1);
      }
    }
  }
  // Minimum-site floor: deletion is independent per candidate, so a small grid inside a
  // strong suppression field can wipe out EVERY Cartesian site — restore deleted cell
  // centers (deterministic order) so the panel degrades to giant merged cells, never to
  // the flat zero-site fallback. Reserve centers were captured BEFORE the focal exclusion
  // check ran, so revalidate here: a restored site inside a polar-owned disc would shred
  // the petal lattice.
  for (let i = 0; sites.length < 3 && i < killedReserve.length; i++) {
    const rx = killedReserve[i].x;
    const ry = killedReserve[i].y;
    if (exclusionR > 0) {
      let excluded = false;
      for (let f = 0; f < exclusionFoci.length; f++) {
        const dx = rx - exclusionFoci[f].x;
        const dy = ry - exclusionFoci[f].y;
        if (dx * dx + dy * dy < exclusionR2) { excluded = true; break; }
      }
      if (excluded) continue;
    }
    sites.push({ x: rx, y: ry, radius: 0 });
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
  bruteForce: boolean,
  pinned?: Uint8Array,
): void {
  const { meshX, meshY } = p;
  const sumX = new Float64Array(sites.length);
  const sumY = new Float64Array(sites.length);
  const counts = new Int32Array(sites.length);
  const grid = SiteGrid.fromSites(sites);
  for (let s = 0; s < samples; s++) {
    let x = halton(s + 1, 2) * meshX;
    let y = halton(s + 1, 3) * meshY;
    if (warpFn) {
      [x, y] = warpFn(x, y);
    }
    let bestIdx = bruteForce ? 0 : grid.nearestOwner(x, y);
    let bestD = Infinity;
    const precedes = bruteForce ? metricOrdering(sites,x,y,Math.max(meshX,meshY),1,0,1,true) : null;
    for (let i = 0; bruteForce && i < sites.length; i++) {
      const dx = sites[i].x - x;
      const dy = sites[i].y - y;
      const d = dx * dx + dy * dy;
      if (precedes && precedes(i,bestIdx,d,bestD)) { bestD = d; bestIdx = i; }
    }
    sumX[bestIdx] += x;
    sumY[bestIdx] += y;
    counts[bestIdx]++;
  }
  const moveLimit = Math.min(sites.length, Math.max(0, pinnedFrom));
  const minSep2 = 0.3 * 0.3;
  for (let i = 0; i < moveLimit; i++) {
    if (pinned?.[i]) continue;
    if (counts[i] > 0) {
      // Warped centroids can land slightly outside the physical panel at high
      // distortion (the warp displaces samples by up to ~distortion·cellSize·0.9) —
      // clamp so edge sites cannot drift off-panel and starve boundary cells.
      const nx = Math.max(0, Math.min(meshX, sumX[i] / counts[i]));
      const ny = Math.max(0, Math.min(meshY, sumY[i] / counts[i]));
      // Relaxation (and proximity to pinned polar sites) must not defeat the minimum
      // separation guarantee — reject moves that would land within the feature floor
      // of any other site (the site keeps its previous valid position).
      let ok = bruteForce || !grid.hasWithin(nx, ny, 0.3, i);
      for (let q = 0; bruteForce && q < sites.length; q++) {
        if (q === i) continue;
        const ddx = sites[q].x - nx;
        const ddy = sites[q].y - ny;
        if (ddx * ddx + ddy * ddy < minSep2) { ok = false; break; }
      }
      if (ok) {
        if (bruteForce) {
          sites[i].x = nx;
          sites[i].y = ny;
        } else grid.move(i, nx, ny);
      }
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
export function nearestThree(
  sites: Site[],
  x: number,
  y: number,
  cosA: number,
  sinA: number,
  anisotropyScale: number,
): { f1: number; f2: number; f3: number; f4: number; idx: number; idx2: number; idx3: number; idx4: number } {
  let f1 = Infinity;
  let f2 = Infinity;
  let f3 = Infinity;
  let f4 = Infinity;
  let idx = 0;
  let idx2 = -1;
  let idx3 = -1;
  let idx4 = -1;
  const isotropic = anisotropyScale <= 1.0001;
  const coordinateScale=sites.reduce((maximum,site)=>Math.max(maximum,Math.abs(site.x),Math.abs(site.y)),1);
  const precedes=metricOrdering(sites,x,y,coordinateScale,cosA,sinA,anisotropyScale);
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
    if (precedes(i,idx,d,f1)) { f4 = f3; idx4 = idx3; f3 = f2; idx3 = idx2; f2 = f1; idx2 = idx; f1 = d; idx = i; }
    else if (precedes(i,idx2,d,f2)) { f4 = f3; idx4 = idx3; f3 = f2; idx3 = idx2; f2 = d; idx2 = i; }
    else if (precedes(i,idx3,d,f3)) { f4 = f3; idx4 = idx3; f3 = d; idx3 = i; }
    else if (precedes(i,idx4,d,f4)) { f4 = d; idx4 = i; }
  }
  // idx2 seeds as the initial idx placeholder when only one site exists — normalize.
  if (!Number.isFinite(f2)) idx2 = -1;
  if (!Number.isFinite(f3)) idx3 = -1;
  if (!Number.isFinite(f4)) idx4 = -1;
  return { f1, f2, f3, f4, idx, idx2, idx3, idx4 };
}

export interface CellMeasurements {
  cols: number; rows: number;
  sites: Array<{x: number; y: number; radius: number}>;
  counts: number[]; inradii: number[];
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
    return this.sampleGridResult(p).grid;
  }

  sampleGridResult(p: ReliefSampleParams): ReliefSampleResult {
    return this.completedSample(p, false);
  }

  /** Kept for the independent full-scan regression oracle, never used by production. */
  static bruteForceForTest(p: ReliefSampleParams): number[][] {
    return new VoronoiReliefGen(p.seed).completedSample(p, true).grid;
  }

  static sitesForTest(p: ReliefSampleParams, bruteForce: boolean): Array<{ x: number; y: number }> {
    const result: Array<{ x: number; y: number }> = [];
    new VoronoiReliefGen(p.seed).sample(p, bruteForce, sites => {
      for (const site of sites) result.push({ x: site.x, y: site.y });
    });
    return result;
  }

  /** Raw layout oracle for cap population tests; production always applies the shared cap. */
  static candidatesForTest(p: ReliefSampleParams, bruteForce: boolean): {
    sites: Array<{x: number; y: number}>; cartesianCount: number; nuclei: number[];
  } {
    const result = {sites: [] as Array<{x: number; y: number}>, cartesianCount: 0, nuclei: [] as number[]};
    new VoronoiReliefGen(p.seed).sample(p, bruteForce, undefined, (sites, cartesianCount, nuclei) => {
      result.sites = sites.map(s => ({x: s.x, y: s.y}));
      result.cartesianCount = cartesianCount;
      result.nuclei = [...nuclei];
    });
    return result;
  }

  /** Fixed Pass 1, unwarped junction-limit probe; production never supplies a query override. */
  static queryForTest(p: ReliefSampleParams, x: number, y: number, sites?: readonly GridSite[]): number {
    return new VoronoiReliefGen(p.seed).completedSample(p, false, {x, y}, sites).grid[0][0];
  }

  /** Fixed-layout measurement oracle; stops before height and membrane work. */
  static measurementsForTest(p: ReliefSampleParams, sites: readonly GridSite[]): CellMeasurements {
    let result: CellMeasurements | undefined;
    new VoronoiReliefGen(p.seed).sample(p, false, undefined, undefined, undefined, sites,
      value => { result = value; });
    if (!result) throw new Error('Cell measurements were not captured');
    return result;
  }

  /** Frozen post-Lloyd layouts isolate geometric regressions from seed-kernel changes. */
  static sampleSitesForTest(p: ReliefSampleParams, sites: readonly GridSite[]): number[][] {
    return new VoronoiReliefGen(p.seed).completedSample(p, false, undefined, sites).grid;
  }

  /** Capture-only test hooks do not publish a partial producer result. */
  private completedSample(p: ReliefSampleParams, bruteForce: boolean,
    query?: {x: number; y: number}, sites?: readonly GridSite[]): ReliefSampleResult {
    const result = this.sample(p, bruteForce, undefined, undefined, query, sites);
    if (result === null) throw new Error('Relief producer did not complete its surface');
    return result;
  }

  private sample(p: ReliefSampleParams, bruteForce: boolean, captureSites?: (sites: readonly Site[]) => void,
    captureCandidates?: (sites: readonly Site[], cartesianCount: number, nuclei: readonly number[]) => void,
    queryOverride?: {x: number; y: number}, frozenSites?: readonly GridSite[],
    captureMeasurements?: (value: CellMeasurements) => void): ReliefSampleResult | null {
    if (frozenSites && (frozenSites.length === 0 || frozenSites.some(site => !Number.isFinite(site.x) || !Number.isFinite(site.y)))) {
      throw new RangeError('Frozen relief layout must contain finite sites');
    }
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
    // Finite fallbacks BEFORE clamping — Math.min/Math.max propagate NaN, so a direct
    // caller (tests, future paths) could otherwise poison sigma, the polar lattice, or
    // focal expansion through any of these scalars.
    const radialFalloffSafe = Number.isFinite(p.radialFalloff) ? p.radialFalloff : 0.3;
    const sigmaRadial = Math.max(
      1e-3,
      Math.max(0.02, Math.min(0.6, radialFalloffSafe)) * Math.hypot(p.meshX, p.meshY),
    );
    const radialStrength = Number.isFinite(p.radialStrength)
      ? Math.max(0, Math.min(4, p.radialStrength))
      : 0;
    const radialGrow = Number.isFinite(p.radialGrow)
      ? Math.max(0, Math.min(2, p.radialGrow))
      : 0;
    const radialWarpAmt = fociPhys.length > 0 && Number.isFinite(p.radialWarp)
      ? Math.max(0, Math.min(1, p.radialWarp))
      : 0;
    // One producer description records the effective metric and warp for this request.
    const {description: query, warp: warpFn} = queryRuntime({...p, seed});

    // v16.2 starburst: polar site lattices own a disc of radius zoneR around each focus;
    // Cartesian sites are excluded slightly inside it so the petal structure stays clean.
    // Foci are the sole enable — at radialStrength 0 the lattice pitch is 1:1 (no
    // elongation) but the focal organization remains, per the ReliefParams contract
    // ("Empty = the starburst system is off").
    const starburstActive = fociPhys.length > 0;
    const zoneR = starburstActive ? POLAR_ZONE_SIGMAS * sigmaRadial : 0;
    // Shared with Pass 2's depth-melt AND the v19 site deletion in generateSites — one
    // field decides both which zones calm down and which cells merge away.
    const suppressGen = Number.isFinite(p.depthVariation) && p.depthVariation > 0
      ? new SimplexNoiseGen(seed + WAVE_GEN_SEED_OFFSET + 103)
      : null;
    let sites: Site[], ids: Uint32Array, pinned: Uint8Array, truncatedFrom: number;
    if (p.frozenSites) {
      validateReliefSites(p.frozenSites, p.meshX, p.meshY);
      const frozen = copyReliefSites(p.frozenSites);
      sites = Array.from(frozen.ids, (_, i) => ({x: frozen.xy[i * 2], y: frozen.xy[i * 2 + 1], radius: 0}));
      ({ ids, pinned, truncatedFrom } = frozen);
    } else {
      checkSiteWork(fociPhys.length, zoneR, p.cellSize,
        radialStrength, radialGrow, p.meshX, p.meshY);
      sites = generateSites(
        p, rand, densityNoiseGen,
        starburstActive ? fociPhys : [],
        starburstActive ? zoneR * POLAR_EXCLUSION_FRACTION : 0,
        suppressGen, bruteForce,
      );
      const originalCartesianCount = sites.length;
      const nuclei = starburstActive ? generatePolarSites(
        fociPhys, zoneR, Math.max(0.2, p.cellSize), radialStrength, radialGrow,
        radialWarpAmt, p.radialMode, rand, p.meshX, p.meshY, sites,
      ) : [];
      if (captureCandidates) {
        captureCandidates(sites, originalCartesianCount, nuclei);
        return null;
      }
      const candidateCount = sites.length;
      const selected = representativeIndices(candidateCount, SITE_COUNT_MAX, rand, nuclei);
      sites = selected.map(i => sites[i]);
      const cartesianCount = selected.filter(i => i < originalCartesianCount).length;
      truncatedFrom = candidateCount > sites.length ? candidateCount : 0;
      pinned = Uint8Array.from(sites, (_, i) => Number(i >= cartesianCount));
      ids = Uint32Array.from(sites, (_, i) => i);
      // Lloyd relaxation passes (default 1, max 2). Hard-cap defends against crafted links.
      // Polar lattice sites (index ≥ cartesianCount) are pinned — relaxation would erase
      // their deliberate radial elongation.
      const relaxIters = Math.max(0, Math.min(2, Math.floor(p.relaxIterations) || 0));
      const lloydSamples = sites.length * LLOYD_SAMPLES_PER_SITE;
      for (let r = 0; r < relaxIters; r++) {
        lloydRelax(sites, p, lloydSamples, warpFn, cartesianCount, bruteForce);
      }
    }

    if (frozenSites) {
      sites = frozenSites.map(site => ({x: site.x, y: site.y, radius: 0}));
      ids = Uint32Array.from(sites, (_, i) => i);
      pinned = new Uint8Array(sites.length);
      truncatedFrom = 0;
    }
    if (captureSites) {
      captureSites(sites);
      return null;
    }

    const {cosA, sinA, scale: metricScale} = query.metric;
    const source = copyReliefSource({ sites: {xy: Float64Array.from(sites.flatMap(site => [site.x, site.y])), ids, pinned, truncatedFrom}, query });
    if (sites.length === 0) return { grid: Array.from({length: p.rows}, () => new Array<number>(p.cols).fill(0)), truncatedFrom, crestClipStatus: 'none', source };

    const grid = SiteGrid.fromSites(sites);
    const nearest = bruteForce
      ? (x: number, y: number) => nearestThree(sites, x, y, cosA, sinA, metricScale)
      : (x: number, y: number) => grid.nearestFour(x, y, cosA, sinA, metricScale);

    const withinRadius = bruteForce
      ? (x: number, y: number, radius: number): Array<{index: number; distance: number}> => {
        const result: Array<{index: number; distance: number}> = [];
        for (let index = 0; index < sites.length; index++) {
          const dx = x - sites[index].x, dy = y - sites[index].y;
          const distance = metricScale <= 1.0001 ? Math.hypot(dx, dy)
            : Math.hypot((dx * cosA + dy * sinA) * metricScale, -dx * sinA + dy * cosA);
          if (distance < radius) result.push({index, distance});
        }
        return result;
      }
      : (x: number, y: number, radius: number) => grid.withinRadius(x, y, radius, cosA, sinA, metricScale);

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

    // The first competitors only seed an upper bound. A complete sparse radius
    // search then minimizes all potentially constraining bisectors in this metric.
    const dbCap = p.meshX + p.meshY;
    const seedPlane = (distance: number, owner: number, index: number, x: number, y: number): number =>
      index < 0 || !Number.isFinite(distance) ? dbCap : grid.bisectorDistance(x, y, owner, index, cosA, sinA, metricScale);
    const boundarySeed = (f1: number, f2: number, f3: number, f4: number,
      owner: number, i2: number, i3: number, i4: number, x: number, y: number): number => {
      const plane = Math.min(seedPlane(f2, owner, i2, x, y), seedPlane(f3, owner, i3, x, y), seedPlane(f4, owner, i4, x, y));
      // Inflate the search bound only. The complete traversal recomputes the actual minimum.
      const roundoff = 64 * Number.EPSILON * Math.max(1, Math.abs(x), Math.abs(y), f1, dbCap) * metricScale;
      return Math.min(dbCap, plane + roundoff);
    };
    const boundaryDist = (f1: number, f2: number, f3: number, f4: number,
      owner: number, i2: number, i3: number, i4: number, x: number, y: number): number => {
      let bound = boundarySeed(f1, f2, f3, f4, owner, i2, i3, i4, x, y);
      if (!bruteForce) return grid.boundaryDistance(x, y, owner, f1, bound, cosA, sinA, metricScale);
      // Full-population path checks index completeness; independent plane arithmetic lives in the test oracle.
      for (let index = 0; index < sites.length; index++) {
        bound = Math.min(bound, grid.bisectorDistance(x, y, owner, index, cosA, sinA, metricScale));
      }
      return bound;
    };

    // Pass 1: accumulate per-site mean F1 (in the warped metric — the same one Pass 2
    // normalizes with, so normDist still hits ~1 at cell centers).
    const radiusSum = new Float64Array(sites.length);
    const radiusN = new Int32Array(sites.length);
    // v18: per-cell INRADIUS = max distance-to-shared-boundary observed in the cell —
    // the normalizer for the wall extent (the critique's "inset must be normalized per
    // cell and locally capped").
    const inradius = new Float64Array(sites.length);
    // Physical quadrature, independent of display/export resolution. Large panels
    // coarsen under an explicit work cap; every retained cell also gets a center query.
    let measureCols = Math.max(2, Math.ceil(p.meshX / CELL_MEASUREMENT_PITCH_IN) + 1);
    let measureRows = Math.max(4, Math.ceil(p.meshY / CELL_MEASUREMENT_PITCH_IN) + 1);
    if (measureCols * measureRows > CELL_MEASUREMENT_MAX) {
      const scale = Math.sqrt(CELL_MEASUREMENT_MAX / (measureCols * measureRows));
      measureCols = Math.min(CELL_MEASUREMENT_MAX / 4, Math.max(2, Math.floor(measureCols * scale)));
      measureRows = Math.min(Math.floor(CELL_MEASUREMENT_MAX / measureCols), Math.max(4, Math.floor(measureRows * scale)));
    }
    for (let j = 0; j < measureRows; j++) for (let i = 0; i < measureCols; i++) {
      const x = i / (measureCols - 1) * p.meshX, y = j / (measureRows - 1) * p.meshY;
      const [qx, qy] = warpFn ? warpFn(x, y) : [x, y];
      const { f1, f2, f3, f4, idx: siteIdx, idx2, idx3, idx4 } = nearest(qx, qy);
      radiusSum[siteIdx] += f1;
      radiusN[siteIdx]++;
      const db = boundaryDist(f1, f2, f3, f4, siteIdx, idx2, idx3, idx4, qx, qy);
      if (db > inradius[siteIdx]) inradius[siteIdx] = db;
    }
    const anchorRadius = new Float64Array(sites.length);
    const geometricOwner = new Int32Array(sites.length);
    for (let k = 0; k < sites.length; k++) {
      const {x, y} = sites[k];
      const n = nearest(x, y);
      geometricOwner[k] = n.idx;
      anchorRadius[k] = boundaryDist(n.f1, n.f2, n.f3, n.f4, n.idx, n.idx2, n.idx3, n.idx4, x, y);
      inradius[k] = Math.max(inradius[k], anchorRadius[k]);
      // Mean distance in an inscribed disk of radius r is 2r/3; radius stores twice it.
      sites[k].radius = radiusN[k] > 0 ? (radiusSum[k] / radiusN[k]) * 2 : 4 * anchorRadius[k] / 3;
    }
    for (let k = 0; k < sites.length; k++) {
      const owner = geometricOwner[k];
      if (owner !== k) { sites[k].radius = sites[owner].radius; inradius[k] = inradius[owner]; }
    }
    if (captureMeasurements) {
      captureMeasurements({cols: measureCols, rows: measureRows, sites: sites.map(site => ({...site})),
        counts: Array.from(radiusN), inradii: Array.from(inradius)});
      return null;
    }
    // v17 size-depth coupling normalizes against the MEDIAN actual cell radius (the slider
    // cellSize is a spacing target, not the realized radius — normalizing against it would
    // scale every cell's depth down uniformly).
    const sortedRadii = sites.map(site => site.radius).sort((a, b) => a - b);
    const medianRadius = Math.max(0.05, sortedRadii[Math.floor(sortedRadii.length / 2)]);

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
    const crestVariation = Number.isFinite(p.crestVariation)
      ? Math.max(0, Math.min(1, p.crestVariation))
      : 0;
    const crestGen = crestVariation > 0
      ? new SimplexNoiseGen(seed + WAVE_GEN_SEED_OFFSET + 97)
      : null;
    const crestFreq = 0.25 / Math.max(0.2, p.cellSize);
    // suppressGen was created before generateSites (v19 site deletion shares the field).
    const suppressFreq = 0.16 / Math.max(0.2, p.cellSize);
    const seamDepthBase = Math.max(0.05, p.seamDepth);
    // v21.1 minimum feature floor — a PHYSICAL constant (tool-radius scale), NOT derived
    // from the sample pitch: pitch-derived floors would make the exported geometry change
    // shape with grid resolution. 0.3" also covers the flow warp's local sampling stretch
    // at the default 400-res grid.
    const wallMinPhys = WALL_MIN_PHYS;
    const crownMinPhys = 0.25;
    // v21.1 C0 CONTINUITY REPAIR. Dissolution lifts boundaries off zero (bowlH ≈ dissolve
    // at a weakened edge), so any PER-CELL factor multiplying bowlH now creates a step of
    // dissolve × |mulA − mulB| along that edge — the "shattered" defect. All hash-static
    // per-cell depth multipliers are therefore precomputed per site and BLENDED across the
    // nearest edges per pixel (owner weight is exactly 0.5 on the boundary, so both sides
    // compute the identical average — C0 by construction).
    const cutDepthIn = Number.isFinite(p.cutDepthIn) ? Math.max(0.05, Math.min(MAX_CUT_DEPTH_IN, p.cutDepthIn)) : 2.4;
    const staticMul = new Float64Array(sites.length);
    const slopeMul = new Float64Array(sites.length);
    const geometryRadius = Float64Array.from(inradius, radius => Math.max(0.01, radius));
    const seamScale = Float64Array.from(sites, (_, k) => 1 + (cellHash01(ids[k], seed + 29) - 0.5) * 0.8 * depthVariation);
    // Continuous site-supported strength replaces independent fixed-rank edge hashes.
    const sharedStrength = Float64Array.from(sites, (_, k) => cellHash01(ids[k], seed + 53));
    for (let k = 0; k < sites.length; k++) {
      const sMul = Math.max(SIZE_DEPTH_MIN, Math.min(SIZE_DEPTH_MAX,
        Math.sqrt(sites[k].radius / medianRadius)));
      let tierMul = 1;
      if (depthVariation > 0) {
        // v21 continuous depth classes: every cell draws its own multiplier in [0.45, 1.1].
        const hDepth = cellHash01(ids[k], seed + 13);
        tierMul = 1 - depthVariation * (1 - (0.45 + 0.65 * hDepth));
      }
      staticMul[k] = sMul * tierMul;
      // v21.1 SLOPE BUDGET: a cell can only carve as deep as its walls can descend at
      // the aesthetic slope ceiling — small cells become shallow dimples and deep
      // pockets are always big. Every wood reference obeys this; slopes past ~65°
      // read as fractures, not carving. Folded into the pre-blended static multiplier
      // so it stays C0 across dissolved boundaries.
      // Conservative: per-edge/crest modifiers can narrow the FINAL wall to ~0.65× this
      // typical estimate without reducing depth — budgeting against the worst case keeps
      // the documented ceiling honest while staying per-cell static (C0 requirement; a
      // pixel-level cap from final w would step across dissolved boundaries).
      const wTyp = Math.max(0.05, seamDepthBase * inradius[k] * 0.52);
      slopeMul[k] = Math.min(1, SLOPE_DEPTH_BUDGET * (2.4 / cutDepthIn) * wTyp);
      staticMul[k] *= slopeMul[k];
    }
    // Smooth floor saturation: replaces the hard min(bowlT, 1) clamp with a C1 fillet band
    // so floors meet walls through a rounded transition. Kept tight (spec: "tighter-radius
    // fillet") — the reference's floors read flat and its walls rise decisively; a wide
    // band reads as soft dunes instead of carved cavities.
    // Wider deceleration band (v22): the wall must FLATTEN before the cushion rises —
    // the target's transition is a region, not a line.
    const FILLET_BAND = 0.2;
    // v16.1 pillow params. The pillow ramps on the UNCAPPED bowl saturation ratio
    // (bowlTRaw = tw/seamDepth): 1.0 = the floor just saturated, 1.4 = deep interior.
    // Anchoring on this ratio (not on normDist toward 1) matters — the measured normDist
    // distribution is concentrated low, so ramps anchored near 1 never fire.
    const pillowAmt = Number.isFinite(p.pillow) ? Math.max(0, Math.min(1, p.pillow)) : 0;
    const pillowCoverage = Number.isFinite(p.pillowCoverage)
      ? Math.max(0, Math.min(1, p.pillowCoverage))
      : 0.6;
    // v22 unified profile phases (in saturation-ratio units): the wall bottoms out at
    // 1.0 through the fillet, HOLDS through a genuine perimeter gutter, then the crown
    // rises via a G2 smootherstep and finishes flat — one monotonic-then-reversing
    // profile, not a wall function plus a pasted floor patch.
    const PILLOW_GUTTER_END = 1.25;
    // v23 MEMBRANE CUSHIONS: the crown is no longer a function of the boundary distance
    // (whose level sets kink at the medial axis) — it is a per-cell MEMBRANE solve
    // (Poisson, unit inflation source, Dirichlet u = 0 clamped at the gutter ring),
    // relaxed with a fixed number of SOR sweeps for determinism, normalized per cell,
    // and composed through the quintic smootherstep so the boundary departs with zero
    // slope and the crown finishes broad and flat. The membrane is smooth everywhere
    // inside the region: the medial axis cannot appear.
    const MEMBRANE_SWEEPS = 80;
    const MEMBRANE_OMEGA = 1.8;
    // Crown rise ≤ ~25% of ridge-to-gutter depth — perceived through curvature, not
    // elevation; the crown stays visibly trapped inside the cavity.
    const PILLOW_AMP = 0.28;
    // v22 shared panel field: cushion tilt direction, amplitude variation, and coverage
    // all sample ONE low-frequency field at the site position, so neighboring cells lean
    // and inflate in related directions (random per-cell warps read as procedural
    // islands; a shared field reads as flow).
    const panelFieldGen = new SimplexNoiseGen(seed + WAVE_GEN_SEED_OFFSET + 61);
    const PANEL_FIELD_FREQ = 0.045;
    const out: number[][] = [];
    let crestClipStatus: ReliefCrestClipStatus = 'none';
    // v23 membrane-cushion buffers (see MEMBRANE_SWEEPS above).
    const cushA = new Float64Array(rows * cols);
    const cushOwner = new Int32Array(rows * cols).fill(-1);
    const polarity: number = p.polarity === 'pockets' ? -1 : 1;
    for (let j = 0; j < rows; j++) {
      const row: number[] = new Array(cols);
      const v = j / Math.max(1, rows - 1);
      const y = queryOverride?.y ?? v * p.meshY;
      for (let i = 0; i < cols; i++) {
        const u = i / Math.max(1, cols - 1);
        const x = queryOverride?.x ?? u * p.meshX;
        const pixIdx = j * cols + i;
        const qx = queryOverride?.x ?? wxArr[pixIdx];
        const qy = queryOverride?.y ?? wyArr[pixIdx];
        const { f1, f2, f3, f4, idx: ownerIdx, idx2, idx3, idx4 } = nearest(qx, qy);
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
        // v18 BOUNDARY-DISTANCE CONSTRUCTION (the critique's prescribed q-coordinate).
        // d_b is the exact distance to the SHARED Voronoi boundary (see boundaryDist) —
        // its level sets are true inset polygons of the cell, so the floor keeps
        // polygonal ancestry. The wall extent w is normalized per cell against the
        // measured inradius, so the wall spans the FULL territory from the shared
        // boundary to the inset floor: every interior point is crest, wall, or floor —
        // no finite falloff radius, no abandoned neutral surface, and shrinking floors
        // WIDENS walls instead of retreating the cavity mouth. q = d_b/w: 0 at the
        // boundary, 1 at the floor edge.
        const radius = JUNCTION_SUPPORT_RATIO * Math.max(f1, 1e-9);
        const neighborhood = bruteForce
          ? {distance: boundaryDist(f1, f2, f3, f4, ownerIdx, idx2, idx3, idx4, qx, qy), candidates: withinRadius(qx, qy, radius)}
          : grid.boundaryNeighborhood(qx, qy, ownerIdx, f1, boundarySeed(f1, f2, f3, f4, ownerIdx, idx2, idx3, idx4, qx, qy), cosA, sinA, metricScale, radius);
        const db = neighborhood.distance;
        // F3 is a continuous order statistic even when third/fourth membership swaps.
        const jn = Number.isFinite(f3)
          ? 1 - Math.min(1, (f3 - f1) / Math.max(1e-9, f3 + f1)) : 0;
        const jnS = smoothstep(0.65, 0.98, jn);
        const [staticMulBlended, slopeBlended, inr, seam, edgeShared, localSide] = reliefJunctionFields(
          neighborhood.candidates, f1, staticMul, slopeMul, geometryRadius, seamScale, sharedStrength,
          index => edgeHash01(ids[ownerIdx], ids[index], seed + 59));
        // Ordered side variation survives in interiors; every owner-dependent residual
        // vanishes at a shared boundary. The positive self weight prevents empty support.
        const ownerFade = Math.min(1, db / Math.max(1e-6, 0.35 * inr));
        const edgeSide = edgeShared + ownerFade * (localSide - edgeShared);
        const wallFieldNoise = wallNoiseGen?.noise(x * wallNoiseFreq, y * wallNoiseFreq) ?? 0;
        const dissolve = (1 - smoothstep(0.06, 0.3, edgeShared)) * EDGE_DISSOLVE_MAX
          * (1 - smoothstep(0.45, 0.75, jn));
        // Ridge crest band: a physical plateau on the shared boundary. The plateau width
        // SWINGS along each edge with the wall-noise field (chunky-to-thin ridges — the
        // reference's most distinctive wall trait) and widens toward junctions.
        let crestW = wallFrac * Math.max(0.2, p.cellSize) * 0.5;
        // Wall extent = seamDepth fraction of the remaining inradius, varied per cell
        // (asymmetric neighbors), per EDGE SIDE (v21 — the dominant variation), along
        // each edge (noise), and at junctions (widening). Capped so most cells keep a
        // floor; per-edge excursions may consume it entirely — the reference's pinch-outs.
        let wallScale = 0.7 + 0.7 * edgeSide;
        wallScale *= seam;
        if (wallNoiseGen) {
          const wn = wallFieldNoise;
          wallScale *= Math.max(0.3, 1 + 0.6 * wn + 1.1 * jnS);
          // Junction DELTAS use a wider gate than the lift term: the plateau starts
          // flaring well before the corner, forming the bold triangular Y-masses.
          // Scaled by junctionLift — the documented junction control; 0 disables.
          const jnW = smoothstep(0.55, 0.95, jn);
          crestW *= Math.max(0.15, 1 + RIDGE_WIDTH_SWING * wn + JUNCTION_DELTA_GAIN * junctionLift * jnW);
        }
        // The flare must never consume the cell (a crest wider than the inradius starves
        // w and renders a star-shaped tear), and must always leave a RESOLVABLE wall span.
        const unclippedCrestW = crestW;
        crestW = Math.min(crestW, 0.6 * inr, Math.max(0, inr - wallMinPhys));
        if (crestW < unclippedCrestW) {
          if (crestW === 0) crestClipStatus = 'collapsed';
          else if (crestClipStatus === 'none') crestClipStatus = 'narrowed';
        }
        if (cellSizeGradient > 0) {
          wallScale *= 1 + cellSizeGradient * mask * 0.6;
        }
        if (radialGrow > 0 && gMax > 0) {
          wallScale /= Math.min(FOCAL_EXPAND_CAP, 1 + radialGrow * gMax * FOCAL_EXPAND_GAIN);
        }
        // v21.1 sampling floor: a wall narrower than ~2 sample pitches cannot be resolved
        // by the grid — the full crest-to-floor drop lands inside one pixel and renders as
        // a shard. Clamp the wall extent to the resolvable minimum.
        const w = Math.max(wallMinPhys, seamDepthBase * Math.max(0.02, inr - crestW) * wallScale);
        const bowlTRaw = Math.max(0, (db - crestW) / w);
        // Smooth floor saturation (C1 fillet into the floor) instead of a hard clamp kink.
        let bowlT: number;
        if (bowlTRaw >= 1 + FILLET_BAND) bowlT = 1;
        else if (bowlTRaw <= 1 - FILLET_BAND) bowlT = bowlTRaw;
        else {
          const e = 1 + FILLET_BAND - bowlTRaw;
          bowlT = 1 - (e * e) / (4 * FILLET_BAND);
        }
        // Profile shapes the bowl falloff curve. All profiles have dh/dt = 0 at t=0 so the
        // wall-to-bowl transition is crease-free. v21: 'cosine' is a per-edge FAMILY, not
        // one global curve — each edge blends toward a late-power profile (shallow
        // shoulder, broad descent, steeper lower third) by its own amount, so no two
        // walls share exactly the same cross-section.
        let bowlH: number;
        if (p.profile === 'hemisphere') {
          const t2 = bowlT * bowlT;
          bowlH = 1 - Math.sqrt(Math.max(0, 1 - t2));
        } else if (p.profile === 'cosine') {
          const cosH = 0.5 - 0.5 * Math.cos(bowlT * Math.PI);
          // Exponent and mix tempered so the blended profile's PEAK slope stays ≤ ~1.9×
          // the mean — the resolvability budget is sized to peak slope, not average.
          const lateH = Math.pow(bowlT, 1.5 + 0.6 * edgeShared);
          const profMix = 0.15 + 0.45 * edgeSide;
          bowlH = (1 - profMix) * cosH + profMix * lateH;
        } else {
          // 'parabolic'
          bowlH = bowlT * bowlT;
        }
        // Seam sharpness — blend toward a linear ramp for V-groove gutters.
        if (p.seamSharpness > 0) {
          const sharp = Math.max(0, Math.min(1, p.seamSharpness));
          bowlH = (1 - sharp) * bowlH + sharp * bowlT;
        }
        // v21 edge dissolution: weak edges melt toward floor level, so the two adjacent
        // cells blend into one shared basin — the references' boundary hierarchy runs
        // strong / moderate / weak / gone, never all-equal.
        if (dissolve > 0) {
          bowlH += (1 - bowlH) * dissolve;
        }
        // v21 perimeter-clamped CUSHION floors ("a sunken cushion with a low perimeter
        // gutter and broad convex crown"). The ramp runs on the boundary-distance
        // saturation ratio, so the cushion inherits the floor's inset-polygon footprint
        // and aspect (loaf in elongated cells, softened triangle in triangular ones) —
        // never a circular seed bump. The bowl's own minimum at the floor edge becomes
        // the perimeter gutter; past it the floor rises to a broad flat crown that stays
        // well below the ridges. SCALE-DEPENDENT: pronounced in the largest cells, absent
        // in small ones (inflating every floor equally reads as a field of buttons).
        let cushionAmp = 0;
        if (pillowAmt > 0 && bowlTRaw > PILLOW_GUTTER_END && p.invertProfile <= 0.5) {
          const sizeT = smoothstep(0.9, 1.8, inr / Math.max(0.05, medianRadius * 0.5));
          if (sizeT > 0) {
            // Shared-field modulation (sampled at the SITE, constant per cell, C0-safe):
            // coverage is a SMOOTH threshold on the field — inflation emerges gradually
            // across the panel instead of switching on per cell — and the amplitude
            // variation follows the same field, so neighboring cushions relate.
            const fieldV = (panelFieldGen.noise(
              sites[ownerIdx].x * PANEL_FIELD_FREQ,
              sites[ownerIdx].y * PANEL_FIELD_FREQ,
            ) + 1) * 0.5;
            // Coverage 0 must fully disable cushions (the smooth threshold alone stays
            // positive for high field values).
            const covGate = pillowCoverage <= 0
              ? 0
              : smoothstep(0.8 - pillowCoverage, 1.2 - pillowCoverage, fieldV);
            if (covGate > 0) {
              // v23: record the amplitude chain — the crown SHAPE comes from the
              // membrane solve after this pass, not from the distance field.
              const amtVar = 0.55 + 0.45 * fieldV;
              cushionAmp = pillowAmt * amtVar * PILLOW_AMP * sizeT * covGate;
            }
          }
        }
        // v19 scooped floors: a per-cell hash direction tilts the pocket so its deepest
        // point shifts off-center — steep wall on one flank, long ramp on the other (the
        // reference's pockets are carved directionally, never radially symmetric). The
        // tilt is purely REDUCTIVE: the deep flank keeps full depth and the shallow flank
        // ramps up, so max depth never exceeds 1 — deepening instead would drive cells
        // into the output clamp, whose crease renders as serrated pocket rims. The factor
        // is 1 at the boundary (bowlH = 0) so ridges and shared walls stay put.
        if (depthVariation > 0 && bowlH > 0) {
          // v22: tilt direction comes from the shared panel field (sampled at the site),
          // not a per-cell hash — adjacent pockets lean in related directions.
          const tiltAng = panelFieldGen.noise(
            sites[ownerIdx].x * PANEL_FIELD_FREQ + 37.1,
            sites[ownerIdx].y * PANEL_FIELD_FREQ + 11.7,
          ) * Math.PI * 2;
          const rad = Math.max(0.2, sites[ownerIdx].radius);
          const tilt = (Math.cos(tiltAng) * (qx - sites[ownerIdx].x)
            + Math.sin(tiltAng) * (qy - sites[ownerIdx].y)) / rad;
          const tiltT = (Math.max(-0.9, Math.min(0.9, tilt)) + 0.9) / 1.8;
          bowlH *= 1 - FLOOR_TILT_GAIN * depthVariation * tiltT * bowlH * ownerFade;
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
        // v17 depth composition:
        //   size coupling — bigger cells carve somewhat deeper (per-cell radius from Pass 1)
        //   iid tier     — per-cell deep/intermediate jitter (asymmetric neighbors)
        //   suppression  — SPATIAL low-frequency field melts whole NEIGHBORHOODS of cells
        //                  into calm masses (clustered, not per-cell — critique: "delete
        //                  several neighboring cells and merge their wall regions")
        // v21.1: the hash-static parts (size coupling + depth class) come pre-blended
        // across the nearest edges (staticMulBlended) — C0 at dissolved boundaries. The
        // suppression field is spatial and continuous, so it multiplies directly.
        let cellDepthMul = staticMulBlended;
        if (depthVariation > 0 && suppressGen) {
          const sn = (suppressGen.noise(x * suppressFreq, y * suppressFreq) + 1) * 0.5;
          cellDepthMul *= 1 - SUPPRESSION_STRENGTH * depthVariation * smoothstep(0.62, 0.82, sn);
        }
        // v20 stretched fans: above grow = 1 the focal zone shallows toward the pinch
        // point while its polar lattice keeps converging walls — drape-like fan creases
        // in a calm mass (the reference's center-left region), not a deep starburst.
        if (radialGrow > 1 && gMax > 0) {
          cellDepthMul *= 1 - FOCAL_CALM_GAIN * (radialGrow - 1) * gMax;
        }

        // v16 SUPERPOSITION: the base wave is never attenuated by the cell system — cells
        // are carved INTO it. Ridge tops (bowlH = 0) sit exactly on the base surface.
        const base = baseAmplitude > 0
          ? baseAmplitude * waveGen.noise(x * baseFrequency, y * baseFrequency)
          : 0;
        let h = base + polarity * bowlH * cellWeight * intensityFactor * cellDepthMul;
        if (cushionAmp > 0) {
          // Full h-space amplitude: the membrane delta rides the same multiplier chain
          // the bowl does (raising a pocket floor = reducing |bowlH| through the chain).
          cushA[pixIdx] = cushionAmp * cellWeight * intensityFactor * cellDepthMul;
          cushOwner[pixIdx] = ownerIdx;
        }
        // v17 crest variation: ridge-LOCAL height noise (scaled by (1 − bowlH)^1.5 so it
        // lives on crests/shoulders only). Fragments the upper envelope into mesas, saddles
        // and differing adjacent crest heights WITHOUT bending the whole panel through one
        // macro wave — the critique's "upper envelope too continuous / macro flow dominant".
        if (crestVariation > 0 && crestGen) {
          const ridgeMask = Math.pow(1 - bowlH, 1.5);
          h += crestVariation * CREST_VARIATION_GAIN
            * crestGen.noise(x * crestFreq, y * crestFreq) * ridgeMask * cellWeight * slopeBlended;
        }
        // v17 junction lift: tighter gate, lower gain — junctions read as tense nodes and
        // saddles, not swollen domes (critique: "junctions bulge; reference junctions pull,
        // pinch, split, and saddle").
        // Both cell-derived additions are gated by cellWeight so relief cannot reappear
        // where the attractor has faded the cell system out.
        if (junctionLift > 0) {
          h += junctionLift * JUNCTION_LIFT_GAIN * jnS * (1 - bowlH) * cellWeight * slopeBlended;
        }
        // v20 ridge crown: rounded bead over the crest band — dome peaking on the shared
        // boundary, blending to the wall shoulder with zero slope at both ends. The bead
        // follows cellDepthMul only PARTIALLY (floor at 0.35): melted zones keep ghost
        // creases — the reference's calm masses and fan regions show their converging
        // wall lines even where pockets have faded out. Gated by cellWeight. v21: also
        // scaled by the per-edge crest strength (variable crest heights along the graph;
        // dissolved edges lose their bead entirely).
        if (wallFrac > 0) {
          const crown = reliefCrownWeight(crestW, db, crownMinPhys);
          const crownMul = (0.35 + 0.65 * cellDepthMul) * (0.35 + 0.9 * edgeShared) * (1 - dissolve);
          h -= polarity * RIDGE_CROWN_GAIN * crown * cellWeight * crownMul * slopeBlended;
        }
        // v21 stock-plane soft cap (pockets only — domes mode intentionally rises).
        // Broad crests flatten into plateaus just above the base wave; junction fins
        // become saddles; the silhouette stays a clean rectangle.
        if (polarity < 0) {
          const hp = h - base;
          if (hp > STOCK_CAP_START) {
            h = base + STOCK_CAP_START + STOCK_CAP_SPAN * Math.tanh((hp - STOCK_CAP_START) / STOCK_CAP_SPAN);
          }
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

    // v23 membrane cushion pass. Solve one Poisson relaxation over all cushion-region
    // pixels (u = 0 outside — Dirichlet-clamped at every gutter ring; regions of
    // different cells are separated by wall corridors, so per-cell normalization is
    // safe), then lift each floor by amp × smootherstep(u/uMaxCell): zero slope where
    // the cushion meets the gutter, broad flat crown, no medial-axis trace.
    let anyCushion = false;
    for (let i = 0; i < cushA.length; i++) {
      if (cushA[i] > 0) { anyCushion = true; break; }
    }
    if (anyCushion) {
      const u = new Float64Array(rows * cols);
      // Symmetric SOR: sweeps alternate forward/reverse traversal — a forward-only
      // Gauss-Seidel at a fixed sweep count leaves partially converged large cushions
      // with a bias toward the sweep origin. Still fully deterministic.
      for (let sweep = 0; sweep < MEMBRANE_SWEEPS; sweep++) {
        if ((sweep & 1) === 0) {
          for (let j = 1; j < rows - 1; j++) {
            const off = j * cols;
            for (let i = 1; i < cols - 1; i++) {
              const idx = off + i;
              if (cushA[idx] <= 0) continue;
              const target = 0.25 * (u[idx - 1] + u[idx + 1] + u[idx - cols] + u[idx + cols]) + 1;
              u[idx] = u[idx] + MEMBRANE_OMEGA * (target - u[idx]);
            }
          }
        } else {
          for (let j = rows - 2; j >= 1; j--) {
            const off = j * cols;
            for (let i = cols - 2; i >= 1; i--) {
              const idx = off + i;
              if (cushA[idx] <= 0) continue;
              const target = 0.25 * (u[idx - 1] + u[idx + 1] + u[idx - cols] + u[idx + cols]) + 1;
              u[idx] = u[idx] + MEMBRANE_OMEGA * (target - u[idx]);
            }
          }
        }
      }
      const uMax = new Float64Array(sites.length);
      for (let i = 0; i < u.length; i++) {
        const o = cushOwner[i];
        if (o >= 0 && u[i] > uMax[o]) uMax[o] = u[i];
      }
      for (let j = 0; j < rows; j++) {
        const off = j * cols;
        for (let i = 0; i < cols; i++) {
          const idx = off + i;
          if (cushA[idx] <= 0) continue;
          const o = cushOwner[idx];
          if (o < 0 || uMax[o] <= 1e-9) continue;
          const w = smootherstep(0, 1, u[idx] / uMax[o]);
          // Pockets (polarity −1): the floor rises toward the surface; domes: recedes.
          const lifted = out[j][i] - polarity * cushA[idx] * w;
          out[j][i] = Math.max(-OUTPUT_HEIGHT_CLAMP, Math.min(OUTPUT_HEIGHT_CLAMP, lifted));
        }
      }
    }
    return { grid: out, truncatedFrom, crestClipStatus, source };
  }
}

/** One explicit authoring relaxation. Stored geometry is never relaxed implicitly. */
export function relaxReliefSites(p: ReliefSampleParams, frozen: ReliefSiteSet): ReliefSiteSet {
  validateReliefSites(frozen, p.meshX, p.meshY);
  const copy = copyReliefSites(frozen);
  const sites = Array.from(copy.ids, (_, i) => ({x: copy.xy[i * 2], y: copy.xy[i * 2 + 1], radius: 0}));
  if (sites.length) {
    lloydRelax(sites, p, sites.length * LLOYD_SAMPLES_PER_SITE, queryRuntime(p).warp, sites.length, false, copy.pinned);
    sites.forEach((site, i) => { copy.xy[i * 2] = site.x; copy.xy[i * 2 + 1] = site.y; });
  }
  return copy;
}

/** Test oracle retains the original nearest, placement and Lloyd scan loops. */
export const __bruteForceForTest = VoronoiReliefGen.bruteForceForTest;
export const __sitesForTest = VoronoiReliefGen.sitesForTest;
export const __siteCandidatesForTest = VoronoiReliefGen.candidatesForTest;

export function sampleReliefParamsFromState(
  cols: number,
  rows: number,
  meshX: number,
  meshY: number,
  seed: number,
  s: {
    frozenSites?: ReliefSiteSet | null;
    reliefSites?: ReliefSiteSet | null;
    amplitude: number;
    baseThickness: number;
    reliefCellSize: number;
    reliefJitter: number;
    reliefRelaxIterations: number;
    reliefPolarity: ReliefPolarity;
    reliefProfile: ReliefProfile;
    reliefSeamDepth: number;
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
    reliefCrestVariation: number;
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
    frozenSites: s.reliefSites ?? s.frozenSites,
    cutDepthIn: Math.min(s.amplitude, s.baseThickness, MAX_CUT_DEPTH_IN),
    cellSize: s.reliefCellSize,
    jitter: s.reliefJitter,
    relaxIterations: s.reliefRelaxIterations,
    polarity: s.reliefPolarity,
    profile: s.reliefProfile,
    seamDepth: s.reliefSeamDepth,
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
    crestVariation: s.reliefCrestVariation,
    radialFoci,
    radialStrength: s.reliefRadialStrength,
    radialFalloff: s.reliefRadialFalloff,
    radialGrow: s.reliefRadialGrow,
    radialWarp: s.reliefRadialWarp,
    radialMode: s.reliefRadialMode,
  };
}
