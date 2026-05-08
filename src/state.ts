import type { SbpStats } from './sbp/types';
import type { ReliefAttractorMode, ReliefBaseMode, ReliefPolarity, ReliefProfile } from './types';

export interface MeshState {
  mode: 'noise' | 'depthmap' | 'blend';
  viewMode: 'solid' | 'wireframe' | 'both' | 'points';
  exportFormat: 'stl' | 'obj' | '3dm' | 'heightmap' | 'sbp';
  // Noise params
  noiseType: 'simplex' | 'perlin' | 'ridged' | 'fbm' | 'voronoi'
    | 'value' | 'opensimplex2' | 'worley' | 'billow' | 'turbulence'
    | 'hybrid' | 'hetero' | 'domainwarp' | 'gabor' | 'wavelet'
    | 'voronoi-relief';
  frequency: number;
  amplitude: number;
  noiseExp: number;
  peakExp: number;
  valleyExp: number;
  valleyFloor: number;
  offset: number;
  seed: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
  distortion: number;
  warpFreq: number;
  warpCurl: number;
  contrast: number;
  sharpness: number;
  gaborAngle: number;
  gaborBandwidth: number;
  // Voronoi-relief params (only used when noiseType === 'voronoi-relief')
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
  // Mesh params
  meshX: number;
  meshY: number;
  resolution: number;
  smoothIter: number;
  smoothStr: number;
  baseThickness: number;
  // Depth map
  depthMap: HTMLImageElement | null;
  depthMapName: string;
  blend: number;
  dmHeightScale: number;
  dmOffset: number;
  dmSmoothing: number;
  depthMapAR: number | null;
  aspectLocked: boolean;
  // View
  orbit: number;
  tilt: number;
  roll: number;
  zoom: number;
  panX: number;
  panY: number;
  // Export
  watertight: boolean;
  binary: boolean;
  /** When true, 3DM export outputs a PointCloud (vertices only) instead of a polygon mesh. */
  export3dmAsPointCloud: boolean;
  filename: string;
  // Presets
  activePreset: string | null;
  activeProfile: string | null;
  // Internal
  vertices: number[][] | null;
  cols: number;
  rows: number;
  genTime: number;
  sbpStats: SbpStats | null;
}

export const DEFAULTS: MeshState = {
  mode: 'noise',
  viewMode: 'solid',
  exportFormat: 'stl',
  noiseType: 'simplex',
  frequency: 0.1,
  amplitude: 0.50,
  noiseExp: 0.5,
  peakExp: 1.0,
  valleyExp: 1.0,
  valleyFloor: 0,
  offset: 0,
  seed: 0,
  octaves: 2,
  persistence: 0.5,
  lacunarity: 2.0,
  distortion: 0,
  warpFreq: 0.1,
  warpCurl: 0,
  contrast: 1.0,
  sharpness: 0,
  gaborAngle: 45,
  gaborBandwidth: 1.5,
  reliefCellSize: 1.5,
  reliefJitter: 0.7,
  reliefRelaxIterations: 1,
  reliefPolarity: 'domes',
  reliefProfile: 'hemisphere',
  reliefSeamDepth: 0.6,
  reliefSeamWidth: 0.15,
  reliefAnisotropy: 0,
  reliefAnisotropyAngle: 0,
  reliefAttractorMode: 'none',
  reliefAttractorX: 0.5,
  reliefAttractorY: 0.5,
  reliefAttractorRadius: 0.5,
  reliefAttractorFalloff: 1,
  reliefDensityStrength: 0,
  reliefIntensityStrength: 1,
  reliefTransitionSoftness: 0.3,
  reliefBaseMode: 'flat',
  meshX: 36,
  meshY: 24,
  resolution: 400,
  smoothIter: 0,
  smoothStr: 0.5,
  baseThickness: 0.75,
  depthMap: null,
  depthMapName: '',
  blend: 0.2,
  dmHeightScale: 1.0,
  dmOffset: -0.08,
  dmSmoothing: 7,
  depthMapAR: null,
  aspectLocked: false,
  orbit: 235,
  tilt: -25,
  roll: 0,
  zoom: 1.0,
  panX: 0,
  panY: 0,
  watertight: true,
  binary: true,
  export3dmAsPointCloud: false,
  filename: 'meshcraft_export',
  activePreset: null,
  activeProfile: null,
  vertices: null,
  cols: 400,
  rows: 267,
  genTime: 0,
  sbpStats: null,
};

export const STATE: MeshState = { ...DEFAULTS };

export const noiseDims = { meshX: 36, meshY: 24, resolution: 400 };

export let demoDepthMap: HTMLImageElement | null = null;
export function setDemoDepthMap(img: HTMLImageElement | null): void {
  demoDepthMap = img;
}

// URL state serialization — only serialize keys that define a mesh config
const URL_SERIALIZABLE_KEYS: (keyof MeshState)[] = [
  'mode', 'noiseType', 'frequency', 'amplitude', 'noiseExp', 'peakExp', 'valleyExp',
  'valleyFloor', 'offset', 'seed', 'octaves', 'persistence', 'lacunarity', 'distortion',
  'warpFreq', 'warpCurl', 'contrast', 'sharpness', 'gaborAngle', 'gaborBandwidth',
  'reliefCellSize', 'reliefJitter', 'reliefRelaxIterations', 'reliefPolarity', 'reliefProfile',
  'reliefSeamDepth', 'reliefSeamWidth', 'reliefAnisotropy', 'reliefAnisotropyAngle',
  'reliefAttractorMode', 'reliefAttractorX', 'reliefAttractorY', 'reliefAttractorRadius',
  'reliefAttractorFalloff', 'reliefDensityStrength', 'reliefIntensityStrength',
  'reliefTransitionSoftness', 'reliefBaseMode',
  'meshX', 'meshY', 'resolution', 'smoothIter', 'smoothStr',
  'baseThickness', 'blend', 'dmHeightScale', 'dmOffset', 'dmSmoothing', 'watertight',
  'viewMode', 'activePreset', 'activeProfile',
];

// Payload version: bump when DEFAULTS change to preserve old share links.
// Legacy (v0) defaults for keys that changed since the original release:
const CURRENT_PAYLOAD_VERSION = 3;
const LEGACY_V0_DEFAULTS: Partial<MeshState> = {
  resolution: 256,
};
const LEGACY_V1_DEFAULTS: Partial<MeshState> = {
  viewMode: 'wireframe',
};
// v2→v3 added Voronoi Relief fields. Old links never set them; they fall back to current defaults.
const LEGACY_V2_DEFAULTS: Partial<MeshState> = {
  reliefCellSize: 1.5,
  reliefJitter: 0.7,
  reliefRelaxIterations: 1,
  reliefPolarity: 'domes',
  reliefProfile: 'hemisphere',
  reliefSeamDepth: 0.6,
  reliefSeamWidth: 0.15,
  reliefAnisotropy: 0,
  reliefAnisotropyAngle: 0,
  reliefAttractorMode: 'none',
  reliefAttractorX: 0.5,
  reliefAttractorY: 0.5,
  reliefAttractorRadius: 0.5,
  reliefAttractorFalloff: 1,
  reliefDensityStrength: 0,
  reliefIntensityStrength: 1,
  reliefTransitionSoftness: 0.3,
  reliefBaseMode: 'flat',
};

export function serializeConfig(): string {
  const diff: Record<string, unknown> = { _v: CURRENT_PAYLOAD_VERSION };
  for (const key of URL_SERIALIZABLE_KEYS) {
    if (STATE[key] !== DEFAULTS[key]) {
      diff[key] = STATE[key];
    }
  }
  // Only _v present means no diffs -- return empty (default config)
  if (Object.keys(diff).length === 1) return '';
  return btoa(JSON.stringify(diff))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function deserializeConfig(searchParams: URLSearchParams): Partial<MeshState> {
  const encoded = searchParams.get('c');
  if (!encoded) return {};
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded);
    const parsed = JSON.parse(json);
    const result: Partial<MeshState> = {};

    // Apply legacy defaults for unversioned (v0) payloads so old share links
    // keep their original behavior even when DEFAULTS change.
    const payloadVersion: number = parsed._v ?? 0;
    if (payloadVersion < 1) {
      for (const [k, v] of Object.entries(LEGACY_V0_DEFAULTS)) {
        if (!(k in parsed)) {
          (result as Record<string, unknown>)[k] = v;
        }
      }
    }
    if (payloadVersion < 2) {
      for (const [k, v] of Object.entries(LEGACY_V1_DEFAULTS)) {
        if (!(k in parsed)) {
          (result as Record<string, unknown>)[k] = v;
        }
      }
    }
    if (payloadVersion < 3) {
      for (const [k, v] of Object.entries(LEGACY_V2_DEFAULTS)) {
        if (!(k in parsed)) {
          (result as Record<string, unknown>)[k] = v;
        }
      }
    }

    for (const key of URL_SERIALIZABLE_KEYS) {
      if (key in parsed) {
        (result as Record<string, unknown>)[key] = parsed[key];
      }
    }
    // Clamp untrusted numeric ranges from URL payloads. A crafted share link with
    // huge reliefRelaxIterations would otherwise spin the browser inside a Lloyd
    // loop. Slider UI bounds are not enforced here — payload comes from any source.
    if (typeof result.reliefRelaxIterations === 'number') {
      result.reliefRelaxIterations = Math.max(0, Math.min(2, Math.floor(result.reliefRelaxIterations)));
    }
    return result;
  } catch {
    return {};
  }
}
