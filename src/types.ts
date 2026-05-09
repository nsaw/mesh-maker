export interface NoiseGenerator {
  noise(x: number, y: number): number;
  /** Discriminator for grid-aware generators that bypass the per-pixel sampleNoiseGrid loop. */
  kind?: 'scalar' | 'voronoi-relief';
}

export interface FBMGenerator extends NoiseGenerator {
  fbm(x: number, y: number, octaves: number, persistence: number, lacunarity: number): number;
}

export type ReliefPolarity = 'pockets' | 'domes';
export type ReliefProfile = 'hemisphere' | 'cosine' | 'parabolic';
export type ReliefAttractorMode = 'none' | 'vertical' | 'horizontal' | 'radial' | 'point';
export type ReliefBaseMode = 'flat' | 'wave';

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
  /** Patches the otherwise-smooth attractor mask with a 2D noise field — produces
   *  patchy, random-looking density/intensity variation instead of a single linear
   *  gradient. 0 = pure mathematical attractor, 1 = pure noise modulation. */
  attractorNoise: number;
  /** Spatial frequency of the attractor noise field. Lower = larger blobs. */
  attractorNoiseFreq: number;
  /** Per-pixel deviation of the anisotropy angle from the global `anisotropyAngle`,
   *  driven by a flow-noise field. 0 = uniform global angle (current behavior),
   *  1 = anisotropy direction varies wildly across the panel. Produces the
   *  organic, randomly-stretched-in-different-directions look. */
  flowAnisotropy: number;
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
  relief?: ReliefParams;
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
