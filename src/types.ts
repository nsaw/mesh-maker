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
