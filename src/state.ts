import type { SbpStats } from './sbp/types';
import type { ReliefMaster } from './relief-master';
import { CNC_PRESETS, PROFILES } from './noise/presets';
import { DRAPE_CONTROLS, DRAPE_PRESETS, DRAPE_STOCK_RANGE, MIN_DRAPE_BACKING_IN, type DrapeSettings, type DrapeWindMode } from './drape-controls';
import type { ReliefAttractorMode, ReliefBaseMode, ReliefPolarity, ReliefProfile, ReliefRadialMode } from './types';

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
  smoothIter: number;
  smoothStr: number;
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
  /** Largest preview-vs-master height difference at the master's nodes, inches (previewErrorIn). */
  reliefPreviewErrorIn: number;
  dmHeightScale: number;
  dmOffset: number;
  dmSmoothing: number;
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
  smoothIter: 0,
  smoothStr: 0.5,
  baseThickness: 0.75,
  depthMap: null,
  depthMapName: '',
  reliefMaster: null,
  reliefMasterName: '',
  reliefPreviewErrorIn: 0,
  dmHeightScale: 1.0,
  dmOffset: -0.08,
  dmSmoothing: 7,
  dmBackgroundCutoff: 0,
  // The gathered silk of the 2026-10-21 Blender study (tilt 25 deg, as the proof accepted on 2026-10-20).
  ...DRAPE_PRESETS.gathered.settings,
  drapeWindMode: 'off',
  drapeStock: 0.75,
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
  genTime: 0,
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

/** Controls a relief master fixes: its size, stock and heights are the data, not settings. Grid
 *  Resolution stays live because it only sets the preview density. */
export const RELIEF_LOCKED_KEYS: ReadonlySet<string> = new Set([
  'meshX', 'meshY', 'baseThickness', 'dmHeightScale', 'dmOffset', 'dmBackgroundCutoff', 'dmSmoothing',
]);

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
  'reliefSeamDepth', 'reliefSeamWidth', 'reliefAnisotropy', 'reliefAnisotropyAngle',
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
  'meshX', 'meshY', 'resolution', 'smoothIter', 'smoothStr',
  'baseThickness', 'dmHeightScale', 'dmOffset', 'dmSmoothing', 'dmBackgroundCutoff',
  ...DRAPE_CONTROLS.map(c => c.key), 'drapeWindMode', 'drapeStock', 'watertight',
  'viewMode', 'viewMaterial', 'activePreset', 'activeProfile',
];

// Payload version: bump when DEFAULTS change to preserve old share links.
// Legacy (v0) defaults for keys that changed since the original release:
const CURRENT_PAYLOAD_VERSION = 15;
/** The payload version from which starburst links already hold the current preset values (the version
 *  current when the starburst migration was last due); later bumps that touch other keys leave it. */
const STARBURST_CURRENT_SINCE = 14;
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
// (reliefFlowAnisotropy was removed in v12 — the key vanished from MeshState, so it is no
// longer written here; old payloads carrying it are silently ignored by the apply loop.)
const LEGACY_V4_DEFAULTS: Partial<MeshState> = {
  reliefAttractorNoise: 0,
  reliefAttractorNoiseFreq: 0.15,
};
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
// v6→v7 reworked the radial-foci ("starburst") system from metric-anisotropy + site-warp
// (v1, PR #16, produced "pucker hole" artifacts) to polar-grid site placement (v2). The
// state-key surface is unchanged but the semantics of strength/falloff/grow/warp are
// reinterpreted under v2. Empty defaults: v6 starburst links pass through and reinterpret
// their saved values under v2 semantics, which produces a *correct* polar-wedge render
// rather than v1's broken puckers — strictly an improvement, so no forced reset is needed.
// The version marker is kept for future migrations that may need to target pre-v2 links.
const LEGACY_V6_DEFAULTS: Partial<MeshState> = {};
// v7→v8 reverted from polar-grid placement (v2, produced mechanical mandala/spirograph
// patterns) to Cartesian Voronoi with per-pixel metric anisotropy + density-boost near foci.
// That v3 density boost later proved too dense and is migrated by the v9 conditional upgrade
// below when saved links exactly match the known bad starburst parameter sets.
const LEGACY_V7_DEFAULTS: Partial<MeshState> = {};
// v8→v9 replaces radial density boost with organic focal expansion: foci no longer change
// site count, reliefRadialGrow expands the continuous radius/bowl field, and reliefRadialWarp
// drives low-frequency focal irregularity instead of remaining inert.
const LEGACY_V8_DEFAULTS: Partial<MeshState> = {};
// v9→v10 reinterprets the 3 "Focus" control points as control points of a Catmull-Rom FLOW
// SPLINE. Sites cluster along the curve; cells elongate along the tangent; cell radius
// expands at curvature peaks. Existing share-links pass through unchanged — the same state
// keys produce a flow-curve render instead of v9's invisible-foci render. Strict improvement.
const LEGACY_V9_DEFAULTS: Partial<MeshState> = {};
// v10→v11 added reliefInvertProfile (domed-floor toggle) and reliefSeamSharpness (V-groove
// sharpness). Existing v10 share-links don't carry these keys; legacy non-starburst presets
// should keep their original smooth-pocket look (invert=0, sharpness=0), so empty defaults
// here are correct. The known-starburst migration below specifically rewrites v10 starburst
// links to include the new field values so saved starburst links match the current preset.
const LEGACY_V10_DEFAULTS: Partial<MeshState> = {};
// v11→v12 is the v16 sampler restructure: base-surface superposition replaces the wave
// crossfade, wall band + density noise added, per-pixel flow anisotropy removed, starburst
// internals replaced by a unified space-warp. Old links never carry the new keys; the
// conditional below (not this table) maps old wave-mode links onto the superposition model.
const LEGACY_V11_DEFAULTS: Partial<MeshState> = {};
// v12→v13 replaced the Blend drape model (height-phased contour folds over a dilated envelope) with a
// membrane + gravity-directed folds. The retired keys drapeFoldScale / drapeFoldDepth / drapeFoldWarp
// have no equivalent and are dropped (they are no longer in URL_SERIALIZABLE_KEYS, so the copy loop
// ignores them). blend (tension), drapeThickness and drapeConform carry over by value. The blend
// DEFAULT moved 0.2 → 0.8, and serializeConfig omits keys equal to the default, so a v12 link saved
// at the old default carries no blend key: record 0.2 here so it keeps its tension.
// v13→v14 replaced that procedural drape with a cloth simulation over a 3D figure (src/drape-sim).
// None of its keys (blend, drapeFoldSpacing, drapeFoldAmp, drapeFoldLength, drapeHang,
// drapeGravityAngle, drapeThickness, drapeConform) has an equivalent: they left
// URL_SERIALIZABLE_KEYS, so the copy loop drops them and older drape links open with the defaults.
const LEGACY_V12_DEFAULTS: Partial<MeshState> = {};
// v14→v15 added the DRAPE controls (src/drape-controls.ts) and made the gathered silk the default. A
// v14 drape link (or an older blend link, which v14 opened with its defaults) was the plain silk proof
// at its tilt: it opens with the silk preset's controls.
const { drapeTilt: _silkTilt, ...LEGACY_V14_DRAPE_DEFAULTS } = DRAPE_PRESETS.silk.settings;
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
    if (payloadVersion < 9) {
      for (const [k, v] of Object.entries(LEGACY_V8_DEFAULTS)) {
        if (!(k in parsed)) {
          (result as Record<string, unknown>)[k] = v;
        }
      }
    }
    if (payloadVersion < 10) {
      for (const [k, v] of Object.entries(LEGACY_V9_DEFAULTS)) {
        if (!(k in parsed)) {
          (result as Record<string, unknown>)[k] = v;
        }
      }
    }
    if (payloadVersion < 11) {
      for (const [k, v] of Object.entries(LEGACY_V10_DEFAULTS)) {
        if (!(k in parsed)) {
          (result as Record<string, unknown>)[k] = v;
        }
      }
    }
    if (payloadVersion < 12) {
      for (const [k, v] of Object.entries(LEGACY_V11_DEFAULTS)) {
        if (!(k in parsed)) {
          (result as Record<string, unknown>)[k] = v;
        }
      }
      // Pre-v12 'wave' relief links relied on the crossfade base (fixed amplitude 0.5).
      // Under the v16 superposition model the closest render uses reliefBaseAmplitude 0.5;
      // links that never set baseMode (or set 'flat') keep the 0 default.
      if (parsed.reliefBaseMode === 'wave' && !('reliefBaseAmplitude' in parsed)) {
        (result as Record<string, unknown>).reliefBaseAmplitude = 0.5;
      }
    }
    if (payloadVersion < 13) {
      for (const [k, v] of Object.entries(LEGACY_V12_DEFAULTS)) {
        if (!(k in parsed)) {
          (result as Record<string, unknown>)[k] = v;
        }
      }
    }
    if (payloadVersion < 15 && (parsed.mode === 'drape' || parsed.mode === 'blend')) {
      for (const [k, v] of Object.entries(LEGACY_V14_DRAPE_DEFAULTS)) {
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
    const approximately = (a: unknown, b: number): boolean => {
      const n = toFiniteNumber(a);
      return n !== null && Math.abs(n - b) < 1e-9;
    };
    const upgradeKnownStarburstDefaults = (): void => {
      // Migrate any older starburst-preset share-link to the CURRENT preset values (copied
      // verbatim from CNC_PRESETS['relief-starburst'] below, so this never drifts from the
      // shipped preset), so users opening older saved links see the latest starburst
      // rendering rather than a mix of stale param values reinterpreted under the current
      // sampler. The migration runs on payloadVersion < STARBURST_CURRENT_SINCE and detects
      // the known starburst signatures produced by each prior shipped version. Non-starburst
      // links (fociCount = 0) pass through untouched. Links with custom/manually-tuned values
      // that don't match any known signature ALSO pass through untouched — their author
      // tuned them deliberately.
      const fociCount = toFiniteNumber(result.reliefRadialFociCount);
      // v15 changed only DRAPE keys: links saved at v14 already carry the current starburst values.
      if (payloadVersion >= STARBURST_CURRENT_SINCE || fociCount === null || fociCount <= 0) return;
      const matchesV7PolarDefaults =
        approximately(result.reliefCellSize, 3.5)
        && approximately(result.reliefRadialStrength, 1.8)
        && approximately(result.reliefRadialFalloff, 0.5)
        && approximately(result.reliefRadialGrow, 0.7)
        && approximately(result.reliefRadialWarp, 0.35);
      const matchesV8DenseDefaults =
        approximately(result.reliefCellSize, 2.2)
        && approximately(result.reliefRadialStrength, 1.6)
        && approximately(result.reliefRadialFalloff, 0.4)
        && approximately(result.reliefRadialGrow, 0.8)
        && approximately(result.reliefRadialWarp, 0);
      const matchesV9OrganicFlowDefaults =
        approximately(result.reliefCellSize, 4.8)
        && approximately(result.reliefRadialStrength, 0.22)
        && approximately(result.reliefRadialFalloff, 0.11)
        && approximately(result.reliefRadialGrow, 0.55)
        && approximately(result.reliefRadialWarp, 0.9);
      const matchesV10SplineDefaults =
        approximately(result.reliefCellSize, 5.5)
        && approximately(result.reliefRadialStrength, 2.4)
        && approximately(result.reliefRadialFalloff, 0.18)
        && approximately(result.reliefRadialGrow, 1.2)
        && approximately(result.reliefRadialWarp, 0.4);
      const matchesV10TunedDefaults =
        approximately(result.reliefCellSize, 4)
        && approximately(result.reliefRadialStrength, 3.0)
        && approximately(result.reliefRadialFalloff, 0.4)
        && approximately(result.reliefRadialGrow, 2.0)
        && approximately(result.reliefRadialWarp, 0.55);
      const matchesV15MidDefaults =
        approximately(result.reliefCellSize, 4)
        && approximately(result.reliefRadialStrength, 3.0)
        && approximately(result.reliefRadialFalloff, 0.4)
        && approximately(result.reliefRadialGrow, 1.3)
        && approximately(result.reliefRadialWarp, 0.55);
      const matchesAnyStarburst = matchesV7PolarDefaults
        || matchesV8DenseDefaults
        || matchesV9OrganicFlowDefaults
        || matchesV10SplineDefaults
        || matchesV10TunedDefaults
        || matchesV15MidDefaults;
      if (!matchesAnyStarburst) return;
      // Respect explicit preset identity when the payload carries it: a link saved from a
      // different preset (or hand-tuned after clearing the preset) must not be rewritten
      // even if its numbers happen to match a known starburst fingerprint.
      if ('activePreset' in parsed && parsed.activePreset !== 'relief-starburst') return;
      // Copy the CURRENT relief-starburst preset verbatim — every URL-serializable field
      // the preset defines — so detected legacy links become exactly the current preset
      // rather than a hybrid old/new configuration. Deriving from CNC_PRESETS removes the
      // hand-maintained sync list this block used to carry.
      // EXCEPTION — the author's COMPOSITION: the legacy fingerprints match only the
      // scalar controls, so a link whose author moved the foci (but left the scalars at
      // defaults) still matches. Focus coordinates and count present in the payload are
      // the saved composition and must survive the migration.
      const compositionKeys = new Set([
        'reliefRadialFociCount',
        'reliefRadialFocus1X', 'reliefRadialFocus1Y',
        'reliefRadialFocus2X', 'reliefRadialFocus2Y',
        'reliefRadialFocus3X', 'reliefRadialFocus3Y',
      ]);
      const starburstPreset = CNC_PRESETS['relief-starburst'];
      for (const key of URL_SERIALIZABLE_KEYS) {
        if (!(key in starburstPreset)) continue;
        if (compositionKeys.has(key) && key in result) continue;
        (result as Record<string, unknown>)[key] = starburstPreset[key];
      }
      (result as Record<string, unknown>).activePreset = 'relief-starburst';
    };
    upgradeKnownStarburstDefaults();
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
    // The DRAPE tab was named BLEND before 2026-10-20; old links carry mode 'blend'.
    if ((result.mode as unknown) === 'blend') result.mode = 'drape';
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
    if ('dmBackgroundCutoff' in result) clampField('dmBackgroundCutoff', 0, 0.9);
    // DRAPE controls: the slider ranges. Cloth resolution and frames set the solver's work, so a
    // crafted link must not raise them past the sliders.
    // The board, to its sliders' ranges (a link with meshX 200 used to keep a 200 in board).
    if ('meshX' in result) clampField('meshX', 1, 96);
    if ('meshY' in result) clampField('meshY', 1, 48);
    if ('resolution' in result) clampField('resolution', 16, 1024, true);
    if ('baseThickness' in result) clampField('baseThickness', 0.25, 6);
    for (const c of DRAPE_CONTROLS) if (c.key in result) clampField(c.key, c.min, c.max);
    if ('drapeStock' in result) clampField('drapeStock', DRAPE_STOCK_RANGE[0], DRAPE_STOCK_RANGE[1]);
    // Relief Depth must leave the minimum backing in the link's material (the slider is capped the same way).
    // (a link with a thin stock and no depth gets the default depth capped the same way).
    if ('drapeReliefDepth' in result || 'drapeStock' in result) {
      const stock = typeof result.drapeStock === 'number' ? result.drapeStock : DEFAULTS.drapeStock;
      if (!('drapeReliefDepth' in result)) (result as Record<string, unknown>).drapeReliefDepth = DEFAULTS.drapeReliefDepth;
      clampField('drapeReliefDepth', 0.05, Math.max(0.05, stock - MIN_DRAPE_BACKING_IN));
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
