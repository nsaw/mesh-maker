export interface NoiseGenerator {
  noise(x: number, y: number): number;
  /** Discriminator for grid-aware generators that bypass the per-pixel sampleNoiseGrid loop.
   *  Only 'voronoi-relief' branches the pipeline today; scalar generators leave it undefined. */
  kind?: 'voronoi-relief';
}

export interface FBMGenerator extends NoiseGenerator {
  fbm(x: number, y: number, octaves: number, persistence: number, lacunarity: number): number;
}

export type ReliefPolarity = 'pockets' | 'domes';
export type ReliefProfile = 'hemisphere' | 'cosine' | 'parabolic';
export type ReliefAttractorMode = 'none' | 'vertical' | 'horizontal' | 'radial' | 'point';
export type ReliefBaseMode = 'flat' | 'wave';
/** Radial-foci elongation axis: 'rays' = cells stretched along the radius from each focus
 *  (sunburst), 'rings' = stretched tangentially (concentric), 'spiral' = radius + ~30°. */
export type ReliefRadialMode = 'rays' | 'rings' | 'spiral';

export interface ReliefParams {
  cellSize: number;
  jitter: number;
  relaxIterations: number;
  polarity: ReliefPolarity;
  profile: ReliefProfile;
  seamDepth: number;
  seamWidth: number;
  anisotropy: number;
  anisotropyAngle: number;
  attractorMode: ReliefAttractorMode;
  attractorX: number;
  attractorY: number;
  attractorRadius: number;
  attractorFalloff: number;
  densityStrength: number;
  intensityStrength: number;
  transitionSoftness: number;
  baseMode: ReliefBaseMode;
  /** Domain warp distortion applied to Voronoi site positions. Reuses the global
   *  `distortion` slider so the existing noise pipeline integrates with relief. */
  warpDistortion: number;
  /** Frequency of the warp noise field (matches the global `warpFreq` semantics). */
  warpFrequency: number;
  /** When > 0, dense areas of the attractor mask not only get more sites but also
   *  proportionally smaller per-cell radii — produces dramatic size variation across
   *  a panel (huge cells where mask=0, tight cells where mask=1). */
  cellSizeGradient: number;
  /** When > 0, seams in high-mask regions cut through the panel (output = -∞ pre-clamp,
   *  CNC normalizer drops to z=0). Produces the spike-finger zone seen in lafabrica
   *  panels where cells become disconnected protrusions. */
  voidStrength: number;
  /** When true, the bowl profile is inverted: `bowlH := 1 − bowlH`. The Worley F2-F1 field
   *  gives distDiff ≈ 0 at cell boundaries and large at cell centers. Without inversion, the
   *  height field is carved INSIDE the cells (pockets) or raised AT the cells (domes). With
   *  inversion, the carving moves to the cell BOUNDARIES — cell INTERIORS sit at the
   *  original surface with a dome-shaped rise from the carved seam to the center. Matches
   *  the reference panel's "domed floors with carved valleys between" signature. Boolean
   *  semantics expressed as 0/1 to keep the existing slider UI binding simple. */
  invertProfile: number;
  /** Seam V-groove sharpness in [0, 1]. 0 = smooth profile (dh/dt = 0 at the cell boundary
   *  → round-bottom gutter); 1 = linear ramp (dh/dt = 1 at the boundary → knife-edge V-groove).
   *  Linearly blends `bowlH` between the chosen profile curve and a linear ramp `bowlT`. The
   *  rendered mesh can show polygon aliasing at high sharpness — unavoidable for true V-grooves
   *  and acceptable for CNC V-bit carving paths. */
  seamSharpness: number;
  /** Patches the otherwise-smooth attractor mask with a 2D noise field — produces
   *  patchy, random-looking INTENSITY variation in the cellular zone (cell HEIGHTS
   *  and SHAPES vary; cell COUNT/DENSITY stays a smooth gradient driven by the
   *  unmodulated mask in generateSites). 0 = pure mathematical attractor, 1 = pure
   *  noise modulation of intensity. */
  attractorNoise: number;
  /** Spatial frequency of the attractor noise field. Lower = larger blobs. */
  attractorNoiseFreq: number;
  /** v16 base-surface superposition amplitude. The cellular carve is ADDED to a smooth
   *  low-frequency wave field of this amplitude, so ridge tops follow an undulating
   *  surface instead of a flat reference plane. 0 = flat base (with baseMode 'flat',
   *  the base term is forced to 0 regardless). */
  baseAmplitude: number;
  /** Spatial frequency of the base wave field (independent of the warp frequency). */
  baseFrequency: number;
  /** Fraction of the normalized cell distance held at base level around every cell
   *  boundary — walls get finite width instead of knife-edge ridge lines. The bowl
   *  profile is remapped to the remaining (1 − wallWidth) band. */
  wallWidth: number;
  /** Low-frequency multiplicative noise on local site density. 0 = uniform jittered
   *  grid; higher values produce patchy multi-scale cell sizes (giant cells next to
   *  small ones — the lafabrica signature). */
  densityNoise: number;
  /** Spatial frequency of the density noise field. Lower = larger patches. */
  densityNoiseFreq: number;
  /** v16.1 pillowed floors: past the bowl's saturation point the floor rises back into a
   *  soft central mound (double-curvature pockets). 0 = plain saturated floors. */
  pillow: number;
  /** Fraction of cells that receive a pillow (seeded per-cell hash) — the reference mixes
   *  pillowed and plain pockets. */
  pillowCoverage: number;
  /** Radial focal points (normalized [0,1]² panel coords), already pruned to the active
   *  count by `sampleReliefParamsFromState`. Empty = the starburst system is off and the
   *  sampler is byte-identical to non-foci output. v16.2: each focus seeds a jittered
   *  POLAR SITE LATTICE (nucleus + concentric rings) whose Voronoi cells are radially
   *  elongated petals — a site layout, not a warp or metric trick, so cell boundaries
   *  stay clean curves. */
  radialFoci: Array<{ x: number; y: number }>;
  /** Petal elongation: the lattice's radial ring gap is (1 + radialStrength) × the
   *  tangential pitch, so 1.2 ≈ 2.2:1 petal aspect. */
  radialStrength: number;
  /** Focal zone radius σ as a fraction of the panel diagonal — the polar lattice owns a
   *  disc of ~σ around each focus (Cartesian sites are excluded slightly inside it). */
  radialFalloff: number;
  /** Focal cell scale in [0, 2]: widens the lattice pitch (bigger petals) and expands the
   *  continuous radius/bowl normalization near foci. */
  radialGrow: number;
  /** Lattice jitter in [0,1] — randomizes ring radii and sector angles so foci read as
   *  organic fans, not mandalas. */
  radialWarp: number;
  /** Lattice arrangement: 'rays' = radially elongated petals, 'rings' = tangential arcs,
   *  'spiral' = petals with golden-angle ring offsets joining into spiral arms. */
  radialMode: ReliefRadialMode;
}

export interface ReliefSampleParams extends ReliefParams {
  cols: number;
  rows: number;
  meshX: number;
  meshY: number;
  seed: number;
}

export interface NoiseConfig {
  gaborAngle?: number;
  gaborBandwidth?: number;
}

/** Generator-side interface for relief sampling — narrow contract used by mesh.ts. */
export interface ReliefGenerator extends NoiseGenerator {
  kind: 'voronoi-relief';
  sampleGrid(params: ReliefSampleParams): number[][];
}

export interface NoiseGridParams {
  cols: number;
  rows: number;
  meshX: number;
  meshY: number;
  frequency: number;
  noiseExp: number;
  peakExp: number;
  valleyExp: number;
  valleyFloor: number;
  contrast: number;
  sharpness: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
  distortion: number;
  warpFreq: number;
  warpCurl: number;
  gen: NoiseGenerator;
  warpGen: NoiseGenerator | null;
}

export interface Vertex3D {
  x: number;
  y: number;
  z: number;
}

export type Triangle = [Vertex3D, Vertex3D, Vertex3D];

export interface MeshData {
  top: Vertex3D[][];
  cols: number;
  rows: number;
  meshX: number;
  meshY: number;
  baseThickness: number;
  watertight: boolean;
}
