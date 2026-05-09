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
  reliefCellSizeGradient: number;
  reliefVoidStrength: number;
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
  reliefCellSizeGradient: 0,
  reliefVoidStrength: 0,
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
  'reliefCellSizeGradient', 'reliefVoidStrength',
  'meshX', 'meshY', 'resolution', 'smoothIter', 'smoothStr',
  'baseThickness', 'blend', 'dmHeightScale', 'dmOffset', 'dmSmoothing', 'watertight',
  'viewMode', 'activePreset', 'activeProfile',
];

// Payload version: bump when DEFAULTS change to preserve old share links.
// Legacy (v0) defaults for keys that changed since the original release:
const CURRENT_PAYLOAD_VERSION = 4;
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
// v3→v4 added cell-size gradient + void-strength fields. Old links never set them; they
// fall back to the documented defaults so prior reliefs render unchanged.
const LEGACY_V3_DEFAULTS: Partial<MeshState> = {
  reliefCellSizeGradient: 0,
  reliefVoidStrength: 0,
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
    if (payloadVersion < 4) {
      for (const [k, v] of Object.entries(LEGACY_V3_DEFAULTS)) {
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
    // Clamp untrusted numeric ranges from URL payloads. Sliders enforce these in the UI,
    // but payloads can come from any source (manual URL edit, third-party share). Without
    // these guards, a crafted link can spin the browser:
    //   - reliefRelaxIterations: each pass scans every sample × every site (O(rows·cols·sites))
    //   - reliefDensityStrength: multiplies the site count itself, then both Pass 1+2 scan all sites
    //
    // Values arrive as `unknown` from JSON.parse — accept anything coercible to a finite
    // number (including numeric strings like "1000" that a crafted payload could use to
    // bypass a strict `typeof === 'number'` check) but discard non-finite junk so it falls
    // back to the field's default rather than poisoning STATE.
    const toFiniteNumber = (v: unknown): number | null => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const clampField = (key: keyof MeshState, lo: number, hi: number, integer = false): void => {
      const n = toFiniteNumber(result[key]);
      if (n === null) {
        delete (result as Record<string, unknown>)[key];
        return;
      }
      const v = integer ? Math.floor(n) : n;
      (result as Record<string, unknown>)[key] = Math.max(lo, Math.min(hi, v));
    };
    if ('reliefRelaxIterations' in result) clampField('reliefRelaxIterations', 0, 2, true);
    if ('reliefDensityStrength' in result)  clampField('reliefDensityStrength',  0, 2);
    // transitionSoftness drives an exponent for Math.pow(mask, ...) — a negative value
    // makes the exponent ≤ 0 and produces Infinity at mask=0, which the sampler's NaN
    // guard then zeroes, punching dead bands into the mesh. Slider range is [0, 1].
    if ('reliefTransitionSoftness' in result) clampField('reliefTransitionSoftness', 0, 1);
    // intensityStrength enters `(1 - is) + is * mask` — outside [0, 1] it can invert the
    // relief sign or amplify it past the output clamp. No DoS risk (clamp catches it),
    // but parity with the other relief URL clamps prevents cosmetic surprises.
    if ('reliefIntensityStrength' in result) clampField('reliefIntensityStrength', 0, 1);
    // cellSizeGradient drives a multiplicative shrink on local cell radius; > 1 inverts the
    // ratio (cells get bigger where mask is high), still bounded but no DoS path.
    if ('reliefCellSizeGradient' in result) clampField('reliefCellSizeGradient', 0, 2);
    // voidStrength gates the "cut-through" mode — values above 1 are meaningless (already
    // saturates), and below 0 disables it; clamp to slider range.
    if ('reliefVoidStrength' in result) clampField('reliefVoidStrength', 0, 1);
    return result;
  } catch {
    return {};
  }
}
