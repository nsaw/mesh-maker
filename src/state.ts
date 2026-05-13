import type { SbpStats } from './sbp/types';
import type { ReliefAttractorMode, ReliefBaseMode, ReliefPolarity, ReliefProfile, ReliefRadialMode } from './types';

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
  reliefAttractorNoise: number;
  reliefAttractorNoiseFreq: number;
  reliefFlowAnisotropy: number;
  // Voronoi-relief radial-foci ("starburst") params
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
  reliefAttractorNoise: 0,
  reliefAttractorNoiseFreq: 0.15,
  reliefFlowAnisotropy: 0,
  reliefRadialFociCount: 0,
  reliefRadialFocus1X: 0.5,
  reliefRadialFocus1Y: 0.25,
  reliefRadialFocus2X: 0.25,
  reliefRadialFocus2Y: 0.6,
  reliefRadialFocus3X: 0.75,
  reliefRadialFocus3Y: 0.8,
  reliefRadialStrength: 1.5,
  reliefRadialFalloff: 0.3,
  reliefRadialGrow: 0.45,
  reliefRadialWarp: 0.4,
  reliefRadialMode: 'rays',
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
  'reliefAttractorNoise', 'reliefAttractorNoiseFreq', 'reliefFlowAnisotropy',
  'reliefRadialFociCount', 'reliefRadialFocus1X', 'reliefRadialFocus1Y',
  'reliefRadialFocus2X', 'reliefRadialFocus2Y', 'reliefRadialFocus3X', 'reliefRadialFocus3Y',
  'reliefRadialStrength', 'reliefRadialFalloff', 'reliefRadialGrow', 'reliefRadialWarp',
  'reliefRadialMode',
  'meshX', 'meshY', 'resolution', 'smoothIter', 'smoothStr',
  'baseThickness', 'blend', 'dmHeightScale', 'dmOffset', 'dmSmoothing', 'watertight',
  'viewMode', 'activePreset', 'activeProfile',
];

// Payload version: bump when DEFAULTS change to preserve old share links.
// Legacy (v0) defaults for keys that changed since the original release:
const CURRENT_PAYLOAD_VERSION = 8;
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
// v4→v5 added noise-modulated attractor + flow-anisotropy. Old links never set them.
const LEGACY_V4_DEFAULTS: Partial<MeshState> = {
  reliefAttractorNoise: 0,
  reliefAttractorNoiseFreq: 0.15,
  reliefFlowAnisotropy: 0,
};
// v6→v7 reworked the radial-foci ("starburst") system from metric-anisotropy + site-warp
// (v1, PR #16, produced "pucker hole" artifacts) to polar-grid site placement (v2). The
// state-key surface is unchanged but the semantics of strength/falloff/grow/warp are
// reinterpreted under v2. Empty defaults: v6 starburst links pass through and reinterpret
// their saved values under v2 semantics, which produces a *correct* polar-wedge render
// rather than v1's broken puckers — strictly an improvement, so no forced reset is needed.
// The version marker is kept for future migrations that may need to target pre-v2 links.
const LEGACY_V6_DEFAULTS: Partial<MeshState> = {};
// v7→v8 reverted from polar-grid placement (v2, produced mechanical mandala/spirograph
// patterns) to Cartesian Voronoi with per-pixel metric anisotropy + density-boost near foci
// (v3 = v1's idea minus the site-warp and density-cut that caused v1's puckers). State-key
// surface unchanged; semantics revert to v1-style: reliefRadialStrength = anisotropy boost,
// reliefRadialFalloff = Gaussian σ as fraction of diagonal, reliefRadialGrow = density boost
// near foci (a BOOST, not a cut), reliefRadialWarp is unused (kept for backward compat).
// v7 starburst links reinterpret their saved values under v3 semantics, which produces an
// organic Voronoi with radial bias near foci rather than v2's mandala — again an improvement,
// so no forced reset.
const LEGACY_V7_DEFAULTS: Partial<MeshState> = {};
// v5→v6 added the radial-foci ("starburst") system. Old links never set any of these;
// `reliefRadialFociCount: 0` keeps the relief sampler byte-identical to pre-feature output.
const LEGACY_V5_DEFAULTS: Partial<MeshState> = {
  reliefRadialFociCount: 0,
  reliefRadialFocus1X: 0.5,
  reliefRadialFocus1Y: 0.25,
  reliefRadialFocus2X: 0.25,
  reliefRadialFocus2Y: 0.6,
  reliefRadialFocus3X: 0.75,
  reliefRadialFocus3Y: 0.8,
  reliefRadialStrength: 1.5,
  reliefRadialFalloff: 0.3,
  reliefRadialGrow: 0.45,
  reliefRadialWarp: 0.4,
  reliefRadialMode: 'rays',
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

/** Pull the encoded share-link payload out of a URL-like input. Tolerates payload-only
 *  strings (e.g. when the user pastes a clipboard fragment into the URL bar without the
 *  `?c=` prefix), payloads in the URL hash, and payloads embedded in the path component.
 *  Returns the base64url-encoded blob, or null if nothing payload-shaped is found.
 *  Callers in tests can pass a `URLSearchParams`; the production main.ts passes the full
 *  `window.location` object so all three URL surfaces are inspected. */
export function findEncodedPayload(input: URLSearchParams | Location | string): string | null {
  // 1. URLSearchParams — current canonical path. Both encodeURIComponent forms ('c=eyJ...')
  //    and the older un-prefixed form (the whole search starts with '=eyJ...') are accepted.
  if (input instanceof URLSearchParams) {
    return input.get('c') ?? null;
  }
  // Convert string or Location to a URL we can dissect; fall through to substring extraction
  // when we don't have a URL constructor target.
  let search: string;
  let hash: string;
  let pathname: string;
  if (typeof input === 'string') {
    try {
      const u = new URL(input, 'https://placeholder.invalid');
      search = u.search; hash = u.hash; pathname = u.pathname;
    } catch {
      // Not a URL — treat the whole string as a candidate payload.
      return extractBase64UrlBlob(input);
    }
  } else {
    search = input.search; hash = input.hash; pathname = input.pathname;
  }
  // 2. Standard ?c=eyJ... query.
  if (search) {
    try {
      const sp = new URLSearchParams(search);
      const c = sp.get('c');
      if (c) return c;
    } catch { /* fallthrough */ }
  }
  // 3. Bare ?eyJ... or ?=eyJ... — sometimes the `c=` is stripped by an intermediate
  //    redirect or copy-paste.
  if (search.length > 1) {
    const blob = extractBase64UrlBlob(search.slice(1));
    if (blob) return blob;
  }
  // 4. Hash component (#c=eyJ... or #eyJ...) — some routers move state to the hash.
  if (hash.length > 1) {
    const tail = hash.startsWith('#c=') ? hash.slice(3) : hash.slice(1);
    const blob = extractBase64UrlBlob(tail);
    if (blob) return blob;
  }
  // 5. Path component (/eyJ... or /=eyJ...) — last-ditch tolerance for the pattern the user
  //    hits when iOS clipboard drops the URL prefix and they manually paste the orphan
  //    payload after the domain.
  if (pathname.length > 1) {
    const blob = extractBase64UrlBlob(pathname.slice(1));
    if (blob) return blob;
  }
  return null;
}

/** Detects a base64url-ish blob inside an arbitrary string. Strips a leading `=` (the
 *  separator that escaped its key during a malformed paste), and validates that what
 *  remains is plausibly base64 — at least 16 chars, only [A-Za-z0-9_-]. */
function extractBase64UrlBlob(input: string): string | null {
  let s = input;
  if (s.startsWith('=')) s = s.slice(1);
  // Strip any trailing slash or whitespace.
  s = s.replace(/[/\s]+$/g, '');
  if (s.length < 16) return null;
  // Must look like base64url. Don't accept arbitrary text that just happens to match.
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  return s;
}

export function deserializeConfig(input: URLSearchParams | Location | string): Partial<MeshState> {
  const encoded = findEncodedPayload(input);
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
    if (payloadVersion < 5) {
      for (const [k, v] of Object.entries(LEGACY_V4_DEFAULTS)) {
        if (!(k in parsed)) {
          (result as Record<string, unknown>)[k] = v;
        }
      }
    }
    if (payloadVersion < 6) {
      for (const [k, v] of Object.entries(LEGACY_V5_DEFAULTS)) {
        if (!(k in parsed)) {
          (result as Record<string, unknown>)[k] = v;
        }
      }
    }
    if (payloadVersion < 7) {
      for (const [k, v] of Object.entries(LEGACY_V6_DEFAULTS)) {
        if (!(k in parsed)) {
          (result as Record<string, unknown>)[k] = v;
        }
      }
    }
    if (payloadVersion < 8) {
      for (const [k, v] of Object.entries(LEGACY_V7_DEFAULTS)) {
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
    // Validate untrusted enum strings — drop anything not in the allowed set so it falls
    // back to DEFAULTS instead of feeding a junk string into the sampler/UI.
    const clampEnum = (key: keyof MeshState, allowed: readonly string[]): void => {
      if (!allowed.includes(String(result[key]))) {
        delete (result as Record<string, unknown>)[key];
      }
    };
    if ('reliefPolarity' in result) clampEnum('reliefPolarity', ['domes', 'pockets']);
    if ('reliefProfile' in result) clampEnum('reliefProfile', ['hemisphere', 'cosine', 'parabolic']);
    if ('reliefAttractorMode' in result) clampEnum('reliefAttractorMode', ['none', 'vertical', 'horizontal', 'radial', 'point']);
    if ('reliefBaseMode' in result) clampEnum('reliefBaseMode', ['flat', 'wave']);
    if ('reliefRadialMode' in result) clampEnum('reliefRadialMode', ['rays', 'rings', 'spiral']);
    if ('reliefRelaxIterations' in result) clampField('reliefRelaxIterations', 0, 2, true);
    if ('reliefDensityStrength' in result)  clampField('reliefDensityStrength',  0, 2);
    // anisotropy enters the metric scale `1 + anisotropy·1.5`; an unbounded value degenerates
    // cells to points. Slider is [0, 1]; allow a little headroom and cap the rest.
    if ('reliefAnisotropy' in result) clampField('reliefAnisotropy', 0, 2);
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
    if ('reliefAttractorNoise' in result) clampField('reliefAttractorNoise', 0, 1);
    if ('reliefAttractorNoiseFreq' in result) clampField('reliefAttractorNoiseFreq', 0.02, 0.5);
    if ('reliefFlowAnisotropy' in result) clampField('reliefFlowAnisotropy', 0, 1);
    // Radial-foci ("starburst") params. reliefRadialFociCount bounds a small per-grid-cell
    // loop; reliefRadialWarp is load-bearing for site-warp fold-safety (the sampler caps the
    // per-focus displacement amplitude relative to σ assuming this stays in [0, 1]).
    if ('reliefRadialFociCount' in result) clampField('reliefRadialFociCount', 0, 3, true);
    if ('reliefRadialStrength' in result) clampField('reliefRadialStrength', 0, 3);
    if ('reliefRadialFalloff' in result) clampField('reliefRadialFalloff', 0.05, 0.6);
    if ('reliefRadialGrow' in result) clampField('reliefRadialGrow', 0, 2);
    if ('reliefRadialWarp' in result) clampField('reliefRadialWarp', 0, 1);
    // Focus coordinates are normalized [0, 1] panel coords. Clamping here is load-bearing:
    // a crafted payload could pair a positive reliefRadialFociCount with NaN/Infinity in a
    // focus X/Y, which would propagate through sampleReliefParamsFromState → radialFoci →
    // the sampler's per-pixel metric and either zero the site count (flat render) or NaN-poison
    // every output pixel. Clamping to [0, 1] (with non-finite values dropped by toFiniteNumber)
    // closes that path before the value reaches STATE.
    if ('reliefRadialFocus1X' in result) clampField('reliefRadialFocus1X', 0, 1);
    if ('reliefRadialFocus1Y' in result) clampField('reliefRadialFocus1Y', 0, 1);
    if ('reliefRadialFocus2X' in result) clampField('reliefRadialFocus2X', 0, 1);
    if ('reliefRadialFocus2Y' in result) clampField('reliefRadialFocus2Y', 0, 1);
    if ('reliefRadialFocus3X' in result) clampField('reliefRadialFocus3X', 0, 1);
    if ('reliefRadialFocus3Y' in result) clampField('reliefRadialFocus3Y', 0, 1);
    return result;
  } catch {
    return {};
  }
}
