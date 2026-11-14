import { isFiniteNumeric, normalizeNumericValue, numericDomain } from './numeric-domain';
import { MAX_CUT_DEPTH_IN, MAX_STOCK_THICKNESS_IN, MACHINE_TRAVEL_IN, type SbpStats } from './sbp/types';
import type { ReliefMaster } from './relief-master';
import { CNC_PRESETS, PROFILES } from './noise/presets';
import { DRAPE_CONTROLS, DRAPE_PRESETS, DRAPE_STOCK_RANGE, MIN_DRAPE_BACKING_IN, snapCarveWidth, type DrapeSettings, type DrapeWindMode } from './drape-controls';
import type { ReliefAttractorMode, ReliefBaseMode, ReliefCrestClipStatus, ReliefPolarity, ReliefProfile, ReliefRadialMode } from './types';

/** Every DRAPE slider (src/drape-controls.ts) is a MeshState key. */
export interface MeshState extends DrapeSettings {
  mode: 'noise' | 'depthmap' | 'drape';
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
  // v16 base-surface superposition: independent smooth wave the cells are carved INTO.
  // Ridge tops follow this surface instead of a flat reference plane.
  reliefBaseAmplitude: number;
  reliefBaseFrequency: number;
  // v16 wall band: fraction of the normalized cell distance held at base level around
  // every cell boundary — gives ridges finite width instead of knife-edge lines.
  reliefWallWidth: number;
  // v16 patchy site density: low-frequency noise multiplying local site density so giant
  // and small cells coexist (the lafabrica multi-scale look).
  reliefDensityNoise: number;
  reliefDensityNoiseFreq: number;
  // v16.1 pillowed floors: past the bowl's saturation point the floor rises back into a
  // soft central mound (the reference's double-curvature pockets). Applied per cell via a
  // seeded hash so only a fraction of cells (pillowCoverage) get pillows — the reference
  // mixes pillowed and plain pockets.
  reliefPillow: number;
  reliefPillowCoverage: number;
  // v16.3 spec mechanisms: per-cell depth tiers + asymmetric walls; junction crest lift.
  reliefDepthVariation: number;
  reliefJunctionLift: number;
  reliefCrestVariation: number;
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
  smoothRadiusIn: number;
  baseThickness: number;
  // Depth map
  depthMap: HTMLImageElement | null;
  depthMapName: string;
  /** A finished relief loaded from a .mcrelief file (src/relief-master.ts). In DEPTH MAP mode it
   *  replaces the image path: the viewport shows a preview resample, and every export and toolpath
   *  reads these full-resolution heights unchanged. Never serialized into share links. */
  reliefMaster: ReliefMaster | null;
  /** File name the relief master was loaded from (the label shown while it is active). */
  reliefMasterName: string;
  /** 99th percentile of the preview-vs-master height difference at the master's nodes, inches
   *  (previewErrorIn). */
  reliefPreviewErrorIn: number;
  dmHeightScale: number;
  dmOffset: number;
  dmSmoothRadiusIn: number;
  /** Normalized height at or below which the depth map is flattened to the floor (both depth
   *  modes); the rest is stretched to the full cut. 0 = off. */
  dmBackgroundCutoff: number;
  // DRAPE mode (src/drape-sim): a silk veil simulated over a 3D figure, extracted as a relief. Its
  // numeric controls (pose, cloth, forces, carve depth) come from DrapeSettings.
  /** Wind or normal pressure on a target region of the front view, or neither. */
  drapeWindMode: DrapeWindMode;
  /** Material thickness of the drape carve, inches. Material Thickness sets it on the DRAPE tab, where
   *  baseThickness follows it; the other tabs keep their own baseThickness. */
  drapeStock: number;
  /** Width of the drape carve, inches (DRAPE_WIDTH_RANGE); its height is 4/3 of it. The X and Y sliders
   *  set it on the DRAPE tab, and the figure scales with the carve. */
  drapeCarveWidth: number;
  /** The relief DRAPE mode shows and exports: the bare figure until a drape is generated, then the
   *  draped figure. Built in memory as a relief master (src/relief-master.ts). Never serialized. */
  drapeMaster: ReliefMaster | null;
  /** 'bare' = the figure before draping, 'draped' = a generated drape (drapeMasterLabel). */
  drapeMasterKind: 'bare' | 'draped' | null;
  /** What the shown relief is (pose and setup), for the status line. */
  drapeMasterLabel: string;
  /** Label of the figure being draped. */
  drapeFigureName: string;
  depthMapAR: number | null;
  aspectLocked: boolean;
  // View
  /** Surface shading: height color ramp, or a uniform neutral material for judging form. */
  viewMaterial: 'elevation' | 'neutral';
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
  reliefTruncatedFrom: number;
  reliefCrestClipStatus: ReliefCrestClipStatus;
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
  reliefInvertProfile: 0,
  reliefSeamSharpness: 0,
  reliefAttractorNoise: 0,
  reliefAttractorNoiseFreq: 0.15,
  reliefBaseAmplitude: 0,
  reliefBaseFrequency: 0.1,
  reliefWallWidth: 0,
  reliefDensityNoise: 0,
  reliefDensityNoiseFreq: 0.08,
  reliefPillow: 0,
  reliefPillowCoverage: 0.6,
  reliefDepthVariation: 0,
  reliefJunctionLift: 0,
  reliefCrestVariation: 0,
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
  smoothRadiusIn: 0,
  baseThickness: 0.75,
  depthMap: null,
  depthMapName: '',
  reliefMaster: null,
  reliefMasterName: '',
  reliefPreviewErrorIn: 0,
  dmHeightScale: 1.0,
  dmOffset: -0.08,
  dmSmoothRadiusIn: 0.13074926387539343,
  dmBackgroundCutoff: 0,
  // The gathered silk of the 2026-10-21 Blender study (tilt 25 deg, as the proof accepted on 2026-10-20).
  ...DRAPE_PRESETS.gathered.settings,
  drapeWindMode: 'off',
  drapeStock: 0.75,
  drapeCarveWidth: 12,
  drapeMaster: null,
  drapeMasterKind: null,
  drapeMasterLabel: '',
  drapeFigureName: '',
  depthMapAR: null,
  aspectLocked: false,
  viewMaterial: 'elevation',
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
  genTime: 0, reliefTruncatedFrom: 0, reliefCrestClipStatus: 'none',
  sbpStats: null,
};

export const STATE: MeshState = { ...DEFAULTS };

/** The relief master driving the mesh, if any: a loaded .mcrelief in DEPTH MAP mode, or the drape
 *  result in DRAPE mode. Exports, toolpaths, stats and the preview all read this one. */
export function activeMaster(): ReliefMaster | null {
  if (STATE.mode === 'depthmap') return STATE.reliefMaster;
  if (STATE.mode === 'drape') return STATE.drapeMaster;
  return null;
}

/** The stock top the exported surface is cut from, inches: the active relief master's own stock when a
 *  master drives the heights (Material Thickness can move ahead of a pending remap of it), else Material
 *  Thickness. SBP material Z and Safe Z read this, never baseThickness directly. */
export function stockTopIn(): number {
  return activeMaster()?.stockIn ?? STATE.baseThickness;
}

/** True when a relief master drives the mesh (see activeMaster). */
export function reliefMasterActive(): boolean {
  return activeMaster() !== null;
}

/** Controls an imported Depth Map relief master fixes: its size, stock and heights are the data, not settings. Grid
 *  Resolution stays live because it only sets the preview density. */
export const RELIEF_LOCKED_KEYS: ReadonlySet<string> = new Set([
  'meshX', 'meshY', 'baseThickness', 'dmHeightScale', 'dmOffset', 'dmBackgroundCutoff', 'dmSmoothRadiusIn',
]);

/** Imported source data is immutable; live Drape controls remap their generated master. */
export function controlIsReadOnly(key: string): boolean {
  return STATE.mode === 'depthmap' && STATE.reliefMaster !== null && RELIEF_LOCKED_KEYS.has(key);
}

/** NOISE's own board, kept while another tab (DEPTH MAP, a relief master, DRAPE) takes over the size
 *  controls: it shares meshX, meshY, resolution and baseThickness with DEPTH MAP, so leaving NOISE
 *  saves them here and coming back restores them (saveNoiseDims / restoreNoiseDims). */
export const noiseDims = { meshX: 36, meshY: 24, resolution: 400, baseThickness: 0.75 };

/** Leaving NOISE: remember its board. */
export function saveNoiseDims(): void {
  noiseDims.meshX = STATE.meshX; noiseDims.meshY = STATE.meshY;
  noiseDims.resolution = STATE.resolution; noiseDims.baseThickness = STATE.baseThickness;
}

/** Back on NOISE: its board as it was, unlocked (the aspect lock belongs to an image). */
export function restoreNoiseDims(): void {
  STATE.meshX = noiseDims.meshX; STATE.meshY = noiseDims.meshY;
  STATE.resolution = noiseDims.resolution; STATE.baseThickness = noiseDims.baseThickness;
  STATE.aspectLocked = false;
}

export let demoDepthMap: HTMLImageElement | null = null;

/** The board size a DEPTH MAP share link set (null for any other page). The demo image keeps it rather
 *  than refit the board to its own aspect, as long as the board still is that size when the image is
 *  shown, whatever tabs were visited meanwhile (see showDemoDepthMap in src/ui.ts). */
let linkBoard: { meshX: number; meshY: number } | null = null;
export function rememberLinkBoard(link: Partial<MeshState>): void {
  linkBoard = link.mode === 'depthmap' && ('meshX' in link || 'meshY' in link) ? { meshX: STATE.meshX, meshY: STATE.meshY } : null;
}
export function boardIsLinkBoard(): boolean {
  return linkBoard !== null && STATE.meshX === linkBoard.meshX && STATE.meshY === linkBoard.meshY;
}
export function setDemoDepthMap(img: HTMLImageElement | null): void {
  demoDepthMap = img;
}

// URL state serialization — only serialize keys that define a mesh config
/** Allowed values for every string-enum key a share link can carry. Typed as Record<Union, true>
 *  so adding or removing a union member without updating this table fails the typecheck. */
const ENUM_VALUES: {
  mode: Record<MeshState['mode'], true>;
  noiseType: Record<MeshState['noiseType'], true>;
  viewMode: Record<MeshState['viewMode'], true>;
  viewMaterial: Record<MeshState['viewMaterial'], true>;
  drapeWindMode: Record<DrapeWindMode, true>;
  reliefPolarity: Record<ReliefPolarity, true>;
  reliefProfile: Record<ReliefProfile, true>;
  reliefAttractorMode: Record<ReliefAttractorMode, true>;
  reliefBaseMode: Record<ReliefBaseMode, true>;
  reliefRadialMode: Record<ReliefRadialMode, true>;
} = {
  mode: { noise: true, depthmap: true, drape: true },
  noiseType: {
    simplex: true, perlin: true, ridged: true, fbm: true, voronoi: true, value: true, opensimplex2: true,
    worley: true, billow: true, turbulence: true, hybrid: true, hetero: true, domainwarp: true,
    gabor: true, wavelet: true, 'voronoi-relief': true,
  },
  viewMode: { solid: true, wireframe: true, both: true, points: true },
  viewMaterial: { elevation: true, neutral: true },
  drapeWindMode: { off: true, wind: true, pressure: true },
  reliefPolarity: { pockets: true, domes: true },
  reliefProfile: { hemisphere: true, cosine: true, parabolic: true },
  reliefAttractorMode: { none: true, vertical: true, horizontal: true, radial: true, point: true },
  reliefBaseMode: { flat: true, wave: true },
  reliefRadialMode: { rays: true, rings: true, spiral: true },
};

const URL_SERIALIZABLE_KEYS: (keyof MeshState)[] = [
  'mode', 'noiseType', 'frequency', 'amplitude', 'noiseExp', 'peakExp', 'valleyExp',
  'valleyFloor', 'offset', 'seed', 'octaves', 'persistence', 'lacunarity', 'distortion',
  'warpFreq', 'warpCurl', 'contrast', 'sharpness', 'gaborAngle', 'gaborBandwidth',
  'reliefCellSize', 'reliefJitter', 'reliefRelaxIterations', 'reliefPolarity', 'reliefProfile',
  'reliefSeamDepth', 'reliefAnisotropy', 'reliefAnisotropyAngle',
  'reliefAttractorMode', 'reliefAttractorX', 'reliefAttractorY', 'reliefAttractorRadius',
  'reliefAttractorFalloff', 'reliefDensityStrength', 'reliefIntensityStrength',
  'reliefTransitionSoftness', 'reliefBaseMode',
  'reliefCellSizeGradient', 'reliefVoidStrength', 'reliefInvertProfile', 'reliefSeamSharpness',
  'reliefAttractorNoise', 'reliefAttractorNoiseFreq',
  'reliefBaseAmplitude', 'reliefBaseFrequency', 'reliefWallWidth',
  'reliefDensityNoise', 'reliefDensityNoiseFreq',
  'reliefPillow', 'reliefPillowCoverage',
  'reliefDepthVariation', 'reliefJunctionLift', 'reliefCrestVariation',
  'reliefRadialFociCount', 'reliefRadialFocus1X', 'reliefRadialFocus1Y',
  'reliefRadialFocus2X', 'reliefRadialFocus2Y', 'reliefRadialFocus3X', 'reliefRadialFocus3Y',
  'reliefRadialStrength', 'reliefRadialFalloff', 'reliefRadialGrow', 'reliefRadialWarp',
  'reliefRadialMode',
  'meshX', 'meshY', 'resolution', 'smoothRadiusIn',
  'baseThickness', 'dmHeightScale', 'dmOffset', 'dmSmoothRadiusIn', 'dmBackgroundCutoff',
  ...DRAPE_CONTROLS.map(c => c.key), 'drapeWindMode', 'drapeStock', 'drapeCarveWidth', 'watertight',
  'viewMode', 'viewMaterial', 'activePreset', 'activeProfile',
];

// Generation and preset semantics changed. Incompatible links reset explicitly.
export const CURRENT_PAYLOAD_VERSION = 18;
let outdatedLinkReset = false;

/** Read and clear the reset notice from the latest deserialize operation. */
export function consumeOutdatedLinkReset(): boolean {
  const reset = outdatedLinkReset;
  outdatedLinkReset = false;
  return reset;
}

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
  outdatedLinkReset = false;
  const encoded = findEncodedPayload(input);
  if (!encoded) return {};
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded);
    const parsed = JSON.parse(json);
    const result: Partial<MeshState> = {};

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const payloadVersion = parsed._v ?? 0;
    if (!Number.isInteger(payloadVersion) || payloadVersion < 0) return {};
    if (payloadVersion < CURRENT_PAYLOAD_VERSION) {
      outdatedLinkReset = true;
      return {};
    }
    if (payloadVersion !== CURRENT_PAYLOAD_VERSION) return {};

    for (const key of URL_SERIALIZABLE_KEYS) {
      if (key in parsed) {
        const value: unknown = parsed[key];
        if (typeof DEFAULTS[key] === 'number' && !isFiniteNumeric(value)) continue;
        (result as Record<string, unknown>)[key] = value;
      }
    }
    // Clamp untrusted numeric ranges from URL payloads. Sliders enforce these in the UI,
    // but payloads can come from any source (manual URL edit, third-party share). Without
    // these guards, a crafted link can spin the browser:
    //   - reliefRelaxIterations: each pass scans every sample × every site (O(rows·cols·sites))
    //   - reliefDensityStrength: multiplies the site count itself, then both Pass 1+2 scan all sites
    //
    // The allowlist boundary admits only actual finite numbers for numeric STATE fields.
    const clampField = (key: keyof MeshState, lo: number, hi: number, integer = false): void => {
      const n = result[key];
      if (!isFiniteNumeric(n)) {
        delete (result as Record<string, unknown>)[key];
        return;
      }
      const domain = numericDomain(key);
      const v = integer && !domain ? Math.floor(n) : n;
      (result as Record<string, unknown>)[key] = normalizeNumericValue(v, lo, hi, domain);
    };
    // Validate untrusted enum strings — drop anything not in the allowed set so it falls
    // back to DEFAULTS instead of feeding a junk string into the sampler/UI.
    // String enums. The value must BE a string in the allowed set: a String() coercion let
    // ["domes"] through (it stringifies to "domes") and then failed every strict === downstream.
    // An unknown value would also leave the UI unreachable (an unknown mode hides every sidebar
    // section; an unknown viewMode hides every surface), so anything else falls back to default.
    // Membership only reads the keys of `allowed`, so any record works (presets map names to configs).
    const clampEnum = (key: keyof MeshState, allowed: Readonly<Record<string, unknown>>, nullable = false): void => {
      if (!(key in result)) return;
      const v = result[key];
      if (nullable && v === null) return;
      if (typeof v !== 'string' || !Object.prototype.hasOwnProperty.call(allowed, v)) {
        delete (result as Record<string, unknown>)[key];
      }
    };
    clampEnum('mode', ENUM_VALUES.mode);
    clampEnum('noiseType', ENUM_VALUES.noiseType);
    clampEnum('viewMode', ENUM_VALUES.viewMode);
    clampEnum('viewMaterial', ENUM_VALUES.viewMaterial);
    clampEnum('drapeWindMode', ENUM_VALUES.drapeWindMode);
    clampEnum('reliefPolarity', ENUM_VALUES.reliefPolarity);
    clampEnum('reliefProfile', ENUM_VALUES.reliefProfile);
    clampEnum('reliefAttractorMode', ENUM_VALUES.reliefAttractorMode);
    clampEnum('reliefBaseMode', ENUM_VALUES.reliefBaseMode);
    clampEnum('reliefRadialMode', ENUM_VALUES.reliefRadialMode);
    clampEnum('activePreset', CNC_PRESETS, true);
    clampEnum('activeProfile', PROFILES, true);
    // Booleans must be booleans: "false" is a truthy string, and an array or number would flow
    // into watertight's floor logic the same way. watertight is the only boolean link key.
    if ('watertight' in result && typeof result.watertight !== 'boolean') {
      delete (result as Record<string, unknown>).watertight;
    }
    // distortion drives the relief space-warp amplitude AND the radius-field padding —
    // an unbounded payload value explodes the padded coarse-grid allocation.
    if ('distortion' in result) clampField('distortion', 0, 2);
    if ('warpFreq' in result) clampField('warpFreq', 0.02, 0.5);
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
    if ('reliefInvertProfile' in result) clampField('reliefInvertProfile', 0, 1, true);
    if ('reliefSeamSharpness' in result) clampField('reliefSeamSharpness', 0, 1);
    if ('reliefAttractorNoise' in result) clampField('reliefAttractorNoise', 0, 1);
    if ('reliefAttractorNoiseFreq' in result) clampField('reliefAttractorNoiseFreq', 0.02, 0.5);
    // v16 base/wall/density keys. baseAmplitude adds directly to the output height (clamped
    // downstream), wallWidth divides into the bowl remap (0.9 hard cap in the sampler), and
    // densityNoise multiplies site density (bounded by LOCAL_DENSITY_MAX) — clamps here keep
    // crafted links inside slider semantics.
    if ('reliefBaseAmplitude' in result) clampField('reliefBaseAmplitude', 0, 2);
    if ('reliefBaseFrequency' in result) clampField('reliefBaseFrequency', 0.02, 0.3);
    if ('reliefWallWidth' in result) clampField('reliefWallWidth', 0, 0.5);
    if ('reliefDensityNoise' in result) clampField('reliefDensityNoise', 0, 1.5);
    if ('reliefDensityNoiseFreq' in result) clampField('reliefDensityNoiseFreq', 0.02, 0.3);
    if ('reliefPillow' in result) clampField('reliefPillow', 0, 1);
    if ('reliefPillowCoverage' in result) clampField('reliefPillowCoverage', 0, 1);
    if ('reliefDepthVariation' in result) clampField('reliefDepthVariation', 0, 1);
    if ('reliefJunctionLift' in result) clampField('reliefJunctionLift', 0, 1);
    if ('reliefCrestVariation' in result) clampField('reliefCrestVariation', 0, 1);
    // Ranges match the sliders.
    if ('smoothRadiusIn' in result) clampField('smoothRadiusIn', 0, 1);
    if ('dmSmoothRadiusIn' in result) clampField('dmSmoothRadiusIn', 0, 1);
    if ('dmBackgroundCutoff' in result) clampField('dmBackgroundCutoff', 0, 0.9);
    // The board, to its sliders' ranges (a link with meshX 200 used to keep a 200 in board).
    if ('meshX' in result) clampField('meshX', 1, MACHINE_TRAVEL_IN.x);
    if ('meshY' in result) clampField('meshY', 1, MACHINE_TRAVEL_IN.y);
    if ('resolution' in result) clampField('resolution', 16, 1024);
    if ('octaves' in result) clampField('octaves', 1, 8);
    if ('baseThickness' in result) clampField('baseThickness', 0.25, MAX_STOCK_THICKNESS_IN);
    const stock = typeof result.baseThickness === 'number' ? result.baseThickness : DEFAULTS.baseThickness;
    // The shared stock belongs to the active mode. Keep other modes' requests when sharing a link.
    const mode = result.mode ?? DEFAULTS.mode;
    if ('amplitude' in result) clampField('amplitude', 0, mode === 'noise' ? Math.min(MAX_CUT_DEPTH_IN, stock) : MAX_CUT_DEPTH_IN);
    if ('dmHeightScale' in result) clampField('dmHeightScale', 0, mode === 'depthmap' ? Math.min(MAX_CUT_DEPTH_IN, stock) : MAX_CUT_DEPTH_IN);
    // DRAPE controls: the slider ranges. Cloth resolution and frames set the solver's work, so a
    // crafted link must not raise them past the sliders.
    for (const c of DRAPE_CONTROLS) if (c.key in result) clampField(c.key, c.min, c.max);
    if ('drapeStock' in result) clampField('drapeStock', DRAPE_STOCK_RANGE[0], DRAPE_STOCK_RANGE[1]);
    // On the sliders' grid too, so the labels show the exact carve (an off-grid width drifted on a label click).
    if ('drapeCarveWidth' in result) {
      const n = result.drapeCarveWidth;
      if (!isFiniteNumeric(n)) delete (result as Record<string, unknown>).drapeCarveWidth;
      else (result as Record<string, unknown>).drapeCarveWidth = snapCarveWidth(n);
    }
    // Relief Depth must leave the minimum backing in the link's material (the slider is capped the same
    // way); a link with a thin stock and no depth gets the default depth capped too.
    if ('drapeReliefDepth' in result || 'drapeStock' in result) {
      const stock = typeof result.drapeStock === 'number' ? result.drapeStock : DEFAULTS.drapeStock;
      if (!('drapeReliefDepth' in result)) (result as Record<string, unknown>).drapeReliefDepth = DEFAULTS.drapeReliefDepth;
      clampField('drapeReliefDepth', 0.05, Math.min(MAX_CUT_DEPTH_IN, Math.max(0.05, stock - MIN_DRAPE_BACKING_IN)));
    }
    // Radial-foci ("starburst") params. reliefRadialFociCount bounds the per-focus blend loop;
    // reliefRadialGrow/reliefRadialWarp are continuous-field controls and must stay bounded so
    // they cannot over-amplify the bowl normalization or angular irregularity.
    if ('reliefRadialFociCount' in result) clampField('reliefRadialFociCount', 0, 3, true);
    if ('reliefRadialStrength' in result) clampField('reliefRadialStrength', 0, 3);
    if ('reliefRadialFalloff' in result) clampField('reliefRadialFalloff', 0.05, 0.6);
    if ('reliefRadialGrow' in result) clampField('reliefRadialGrow', 0, 2);
    if ('reliefRadialWarp' in result) clampField('reliefRadialWarp', 0, 1);
    // Focus coordinates are normalized [0, 1] panel coords. Clamping here is load-bearing:
    // a crafted payload could pair a positive reliefRadialFociCount with NaN/Infinity in a
    // focus X/Y, which would propagate through sampleReliefParamsFromState → radialFoci →
    // the sampler's per-pixel metric and either zero the site count (flat render) or NaN-poison
    // every output pixel. Clamping to [0, 1] (with invalid numeric values dropped by the shared input boundary)
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
