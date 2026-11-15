import { DEFAULTS } from '../state';
import type { MeshState } from '../state';

export const PROFILES: Record<string, Record<string, number> | null> = {
  custom: null,
  smooth: { octaves: 2, persistence: 0.3, lacunarity: 2.0, distortion: 0.1, peakExp: 0.55, valleyExp: 0.55 },
  rough: { octaves: 6, persistence: 0.7, lacunarity: 2.5, distortion: 0.3, peakExp: 0.9, valleyExp: 0.9 },
  organic: { octaves: 4, persistence: 0.6, lacunarity: 1.8, distortion: 0.5, peakExp: 0.65, valleyExp: 0.65 },
  geometric: { octaves: 3, persistence: 0.4, lacunarity: 3.0, distortion: 0.1, peakExp: 1.25, valleyExp: 1.25 },
  crystalline: { octaves: 5, persistence: 0.5, lacunarity: 2.2, distortion: 0.2, peakExp: 1.1, valleyExp: 1.1 },
  waves: { octaves: 3, persistence: 0.6, lacunarity: 1.5, distortion: 0.8, peakExp: 0.7, valleyExp: 0.7 },
};

type PresetConfig = Record<string, string | number>;

export const CNC_PRESETS: Record<string, PresetConfig> = {
  'gentle-waves': { noiseType:'simplex', frequency:0.06, amplitude:0.5, peakExp:0.5, valleyExp:0.5, valleyFloor:0.0, offset:0, octaves:2, persistence:0.3, lacunarity:2, distortion:0, baseThickness:0.75, meshX:36, meshY:24, smoothRadiusIn:0.07813763041664107 },
  'organic-terrain': { noiseType:'simplex', frequency:0.1, amplitude:0.8, peakExp:0.84, valleyExp:0.84, valleyFloor:0.0, offset:0, octaves:4, persistence:0.55, lacunarity:2, distortion:0.3, baseThickness:1.05, meshX:36, meshY:24, smoothRadiusIn:0.040350098842101466 },
  'sharp-ridges': { noiseType:'ridged', frequency:0.08, amplitude:0.5, peakExp:2.7, valleyExp:2.7, valleyFloor:0.0, offset:0, octaves:3, persistence:0.5, lacunarity:2.2, distortion:0, baseThickness:0.75, meshX:36, meshY:24, smoothRadiusIn:0.0 },
  'voronoi-cells': { noiseType:'voronoi', frequency:0.15, amplitude:0.3, peakExp:0.8, valleyExp:0.8, valleyFloor:0.0, offset:0, octaves:1, persistence:0.5, lacunarity:2, distortion:0, baseThickness:0.55, meshX:36, meshY:24, smoothRadiusIn:0.06988842128494586 },
  'subtle-texture': { noiseType:'perlin', frequency:0.12, amplitude:0.25, peakExp:0.5, valleyExp:0.5, valleyFloor:0.0, offset:0, octaves:3, persistence:0.4, lacunarity:2.5, distortion:0.1, baseThickness:0.5, meshX:36, meshY:24, smoothRadiusIn:0.0754881226948038 },
  'deep-carve': { noiseType:'simplex', frequency:0.05, amplitude:2.0, peakExp:1.7999999999999998, valleyExp:1.7999999999999998, valleyFloor:0.0, offset:0, octaves:5, persistence:0.6, lacunarity:1.8, distortion:0.4, baseThickness:2.5, meshX:24, meshY:18, smoothRadiusIn:0.0 },
  'sculptural': { noiseType:'simplex', frequency:0.04, amplitude:1.5, peakExp:1.4489999999999998, valleyExp:0.28174999999999994, valleyFloor:0.7055174172996764, offset:0, octaves:3, persistence:0.55, lacunarity:1.8, distortion:0.4, baseThickness:1.75, meshX:36, meshY:24, smoothRadiusIn:0.0605251482631522 },
  'hard-wave': { noiseType:'simplex', frequency:0.05, amplitude:1.2, peakExp:1.32, valleyExp:0.198, valleyFloor:0.8286104444190472, offset:0, octaves:2, persistence:0.4, lacunarity:2, distortion:0.25, baseThickness:1.45, meshX:36, meshY:24, smoothRadiusIn:0.07813763041664107 },
  'eroded-stone': { noiseType:'ridged', frequency:0.06, amplitude:0.5, peakExp:1.56, valleyExp:0.41600000000000004, valleyFloor:0.7079503136385321, offset:0, octaves:4, persistence:0.5, lacunarity:2.2, distortion:0.35, baseThickness:0.75, meshX:36, meshY:24, smoothRadiusIn:0.03494421064247293 },
  'billowy-clouds': { noiseType:'billow', frequency:0.07, amplitude:0.8, peakExp:0.5, valleyExp:0.5, valleyFloor:0.0, offset:0, octaves:3, persistence:0.45, lacunarity:2, distortion:0.15, baseThickness:1.05, meshX:36, meshY:24, smoothRadiusIn:0.06379910807698173 },
  'turbulent-marble': { noiseType:'billow', frequency:0.08, amplitude:1.0, peakExp:0.9099999999999999, valleyExp:0.9099999999999999, valleyFloor:0.0, offset:0, octaves:5, persistence:0.55, lacunarity:2.2, distortion:0.3, baseThickness:1.25, meshX:36, meshY:24, smoothRadiusIn:0.03494421064247293 },
  'natural-ridge': { noiseType:'hybrid', frequency:0.06, amplitude:1.2, peakExp:0.792, valleyExp:0.33, valleyFloor:0.3565477788936814, offset:0, octaves:4, persistence:0.5, lacunarity:2, distortion:0.2, baseThickness:1.45, meshX:36, meshY:24, smoothRadiusIn:0.040350098842101466 },
  'organic-swirl': { noiseType:'domainwarp', frequency:0.05, amplitude:1.0, peakExp:0.5, valleyExp:0.5, valleyFloor:0.0, offset:0, octaves:3, persistence:0.5, lacunarity:1.8, distortion:0, baseThickness:1.25, meshX:36, meshY:24, smoothRadiusIn:0.06379910807698173 },
  'worley-cracks': { noiseType:'worley', frequency:0.12, amplitude:0.5, peakExp:1.04, valleyExp:1.04, valleyFloor:0.0, offset:0, octaves:1, persistence:0.5, lacunarity:2, distortion:0.1, baseThickness:0.75, meshX:36, meshY:24, smoothRadiusIn:0.040350098842101466 },
  'brushed-metal': { noiseType:'gabor', frequency:0.1, amplitude:0.3, peakExp:0.5, valleyExp:0.5, valleyFloor:0.0, offset:0, octaves:1, persistence:0.5, lacunarity:2, distortion:0, gaborAngle:15, gaborBandwidth:1.2, baseThickness:0.55, meshX:36, meshY:24, smoothRadiusIn:0.03494421064247293 },
  // Voronoi Relief presets — reproduce lafabricatrun-style 3D Voronoi cell carvings.
  // v16: all four presets ride the base-superposition model (cells carved INTO a wave
  // surface), use finite wall widths, and get multi-scale cell patchiness from
  // reliefDensityNoise. Distortion drives the flow component of the space-warp.
  // `relief-vertical` targets the tall panel reference: smooth wave field at top, dense
  // domed cells in the middle, cut-through spike fingers at the bottom.
  'relief-vertical': { noiseType:'voronoi-relief', frequency:0.2, amplitude:0.75, peakExp:1.0, valleyExp:1.0, valleyFloor:0.0, offset:0, octaves:1, persistence:0.5, lacunarity:2, distortion:0.55,
    warpFreq:0.16, warpCurl:0,
    reliefCellSize:0.8, reliefJitter:0.95, reliefRelaxIterations:1, reliefPolarity:'domes', reliefProfile:'parabolic',
    reliefSeamDepth:0.95, reliefWallWidth:0.08, reliefAnisotropy:0, reliefAnisotropyAngle:0,
    // attractorY:0 anchors the dense+void zone to the BOTTOM of the panel (viewport bottom
    // with default camera) — matches the lafabrica reference orientation where smooth waves
    // sit at the top and the cellular/spike zone hangs toward the bottom edge.
    reliefAttractorMode:'vertical', reliefAttractorX:0.5, reliefAttractorY:0, reliefAttractorRadius:0.5, reliefAttractorFalloff:2.2,
    reliefDensityStrength:1.8, reliefIntensityStrength:1, reliefTransitionSoftness:0.45, reliefBaseMode:'wave',
    reliefBaseAmplitude:0.5, reliefBaseFrequency:0.2,
    reliefCellSizeGradient:1.0, reliefVoidStrength:0.7, reliefInvertProfile:0, reliefSeamSharpness:0,
    reliefPillow:0, reliefPillowCoverage:0.6,
    reliefAttractorNoise:0, reliefAttractorNoiseFreq:0.3,
    reliefDensityNoise:0.3, reliefDensityNoiseFreq:0.16,
    reliefRadialFociCount:0, reliefRadialFocus1X:0.5, reliefRadialFocus1Y:0.25,
    reliefRadialFocus2X:0.25, reliefRadialFocus2Y:0.6, reliefRadialFocus3X:0.75, reliefRadialFocus3Y:0.8,
    reliefRadialStrength:1.5, reliefRadialFalloff:0.3, reliefRadialGrow:0.45, reliefRadialWarp:0.4, reliefRadialMode:'rays',
    meshX:12, meshY:24, baseThickness:0.75, smoothRadiusIn:0.027317146052007444 },
  // relief-radial — v21: the PIERCED-CLUSTER look (organic wood references, IMG_1985/1986):
  // a dense cluster of small deep cells around an off-center attractor point — the
  // smallest, deepest ones CUT THROUGH the panel (voidStrength) — growing smoothly
  // outward into giant stretched bowls. Full-bowl profile (seamDepth 0.9 leaves almost
  // no flat floor), wide sanded crowns, heavy smoothing. The size gradient is
  // attractor-driven and SMOOTH, not patchy (low densityNoise).
  'relief-radial': { noiseType:'voronoi-relief', frequency:0.15, amplitude:1.333333333333333, peakExp:1.0, valleyExp:1.0, valleyFloor:0.0, offset:0, octaves:1, persistence:0.5, lacunarity:2, distortion:0.4,
    warpFreq:0.105, warpCurl:0,
    reliefCellSize:1.733333333333333, reliefJitter:0.8, reliefRelaxIterations:1, reliefPolarity:'pockets', reliefProfile:'cosine',
    reliefSeamDepth:0.7, reliefWallWidth:0.12, reliefAnisotropy:0.25, reliefAnisotropyAngle:35,
    reliefAttractorMode:'radial', reliefAttractorX:0.62, reliefAttractorY:0.42, reliefAttractorRadius:0.55, reliefAttractorFalloff:0.9,
    reliefDensityStrength:2, reliefIntensityStrength:0.55, reliefTransitionSoftness:0.15, reliefBaseMode:'wave',
    reliefBaseAmplitude:0.25, reliefBaseFrequency:0.09,
    reliefCellSizeGradient:0.8, reliefVoidStrength:0.38, reliefInvertProfile:0, reliefSeamSharpness:0,
    reliefPillow:0.45, reliefPillowCoverage:0.75,
    reliefDepthVariation:0.2, reliefJunctionLift:0.25, reliefCrestVariation:0.15,
    reliefAttractorNoise:0.25, reliefAttractorNoiseFreq:0.15,
    reliefDensityNoise:0.55, reliefDensityNoiseFreq:0.09,
    reliefRadialFociCount:0, reliefRadialFocus1X:0.5, reliefRadialFocus1Y:0.25,
    reliefRadialFocus2X:0.25, reliefRadialFocus2Y:0.6, reliefRadialFocus3X:0.75, reliefRadialFocus3Y:0.8,
    reliefRadialStrength:1.5, reliefRadialFalloff:0.3, reliefRadialGrow:0.45, reliefRadialWarp:0.4, reliefRadialMode:'rays',
    // The pierced cells reach the export enclosure's minimum backing.
    meshX:16, meshY:24, baseThickness:1.333333333333333, smoothRadiusIn:0.028355159145325215 },
  // relief-pockets — v16 primary reference-matcher for the lafabrica panel. Proportions
  // retuned from measurement: the reference reads as ~0.25 depth:cell ratio (was 4.5"/5.5"
  // = 0.82, which saturated bowls into thin-fin walls regardless of algorithm). The wave
  // base (superposition) gives the undulating ridge network; wallWidth gives the walls
  // finite width; densityNoise produces giant-vs-small cell patches; distortion drives
  // the flow warp that elongates cells organically.
  'relief-pockets': { noiseType:'voronoi-relief', frequency:0.2, amplitude:1.2, peakExp:1.0, valleyExp:1.0, valleyFloor:0.0, offset:0, octaves:1, persistence:0.5, lacunarity:2, distortion:0.35,
    warpFreq:0.12, warpCurl:0,
    reliefCellSize:2, reliefJitter:0.85, reliefRelaxIterations:1, reliefPolarity:'pockets', reliefProfile:'cosine',
    // seamDepth = saturation point: 0.75 keeps only the biggest cells reaching full depth,
    // Small cells stay shallow, retaining the depth gradient.
    reliefSeamDepth:0.62, reliefWallWidth:0.11, reliefAnisotropy:0.2, reliefAnisotropyAngle:75,
    reliefAttractorMode:'vertical', reliefAttractorX:0.5, reliefAttractorY:0, reliefAttractorRadius:0.5, reliefAttractorFalloff:0.35,
    reliefDensityStrength:1.2, reliefIntensityStrength:0.9, reliefTransitionSoftness:0.35, reliefBaseMode:'wave',
    reliefBaseAmplitude:0.4, reliefBaseFrequency:0.14,
    reliefCellSizeGradient:0.8, reliefVoidStrength:0, reliefInvertProfile:0, reliefSeamSharpness:0,
    reliefPillow:0.5, reliefPillowCoverage:0.85,
    reliefDepthVariation:0.35, reliefJunctionLift:0.3, reliefCrestVariation:0.5,
    reliefAttractorNoise:0.5, reliefAttractorNoiseFreq:0.2,
    // v20: bigger cell-size dynamic range (stronger density swings on larger patches) and
    // ONE stretched-fan focus (grow > 1 = shallow converging-crease fan, the reference's
    // drape-like center-left region).
    reliefDensityNoise:1.0, reliefDensityNoiseFreq:0.09,
    reliefRadialFociCount:1, reliefRadialFocus1X:0.3, reliefRadialFocus1Y:0.42,
    reliefRadialFocus2X:0.25, reliefRadialFocus2Y:0.6, reliefRadialFocus3X:0.75, reliefRadialFocus3Y:0.8,
    reliefRadialStrength:2.2, reliefRadialFalloff:0.32, reliefRadialGrow:1.6, reliefRadialWarp:0.5, reliefRadialMode:'rays',
    // Keep the scaled cut and Nick's minimum 1/16 in backing.
    meshX:12, meshY:24, baseThickness:1.2625, smoothRadiusIn:0.020175049421050733 },
  // relief-starburst — v16: each "Focus" point contributes a radial displacement term to
  // the unified space-warp, so cells stretch outward from each focus because the Voronoi
  // is EVALUATED in warped coordinates (clean curved cell boundaries, no metric tearing).
  // Slider semantics (v16):
  //   reliefRadialStrength → radial displacement strength at each focus
  //   reliefRadialFalloff  → focus influence σ as fraction of panel diagonal
  //   reliefRadialGrow     → focal expansion of the continuous radius field (broader pockets)
  //   reliefRadialWarp     → wobble on the displacement direction (organic, not rosette)
  //   reliefRadialMode     → 'rays' (radial elongation) / 'rings' (tangential) / 'spiral'
  'relief-starburst': { noiseType:'voronoi-relief', frequency:0.15, amplitude:1, peakExp:1.0, valleyExp:1.0, valleyFloor:0.0, offset:0, octaves:1, persistence:0.5, lacunarity:2, distortion:0.35,
    warpFreq:0.105, warpCurl:0,
    reliefCellSize:1.2, reliefJitter:0.55, reliefRelaxIterations:1, reliefPolarity:'pockets', reliefProfile:'cosine',
    reliefSeamDepth:0.5, reliefWallWidth:0.08, reliefAnisotropy:0, reliefAnisotropyAngle:0,
    reliefAttractorMode:'none', reliefAttractorX:0.5, reliefAttractorY:0.5, reliefAttractorRadius:0.5, reliefAttractorFalloff:1,
    reliefDensityStrength:0, reliefIntensityStrength:1, reliefTransitionSoftness:0.5, reliefBaseMode:'wave',
    reliefBaseAmplitude:0.5, reliefBaseFrequency:0.09,
    reliefCellSizeGradient:0.4, reliefVoidStrength:0, reliefInvertProfile:0, reliefSeamSharpness:0,
    reliefPillow:0, reliefPillowCoverage:0.5,
    reliefDepthVariation:0.35, reliefJunctionLift:0.25, reliefCrestVariation:0.4,
    reliefAttractorNoise:0.2, reliefAttractorNoiseFreq:0.18,
    reliefDensityNoise:0.2, reliefDensityNoiseFreq:0.12,
    reliefRadialFociCount:3, reliefRadialFocus1X:0.7, reliefRadialFocus1Y:0.18,
    reliefRadialFocus2X:0.2, reliefRadialFocus2Y:0.5, reliefRadialFocus3X:0.75, reliefRadialFocus3Y:0.85,
    reliefRadialStrength:1.2, reliefRadialFalloff:0.3, reliefRadialGrow:0.3, reliefRadialWarp:0.65, reliefRadialMode:'rays',
    meshX:8, meshY:24, baseThickness:1.666666666666667, smoothRadiusIn:0.007765380142771763 },
};

/** Controls a preset replaces. View, export, seed and mode settings stay with the user. */
export const PRESET_OWNED_KEYS = [
  'noiseType', 'frequency', 'amplitude', 'peakExp', 'valleyExp',
  'valleyFloor', 'offset', 'octaves', 'persistence', 'lacunarity', 'distortion',
  'warpFreq', 'warpCurl', 'gaborAngle', 'gaborBandwidth', 'invert', 'cellJitter', 'cellMetric',
  'reliefCellSize', 'reliefJitter', 'reliefRelaxIterations', 'reliefPolarity', 'reliefProfile',
  'reliefSeamDepth', 'reliefAnisotropy', 'reliefAnisotropyAngle',
  'reliefAttractorMode', 'reliefAttractorX', 'reliefAttractorY', 'reliefAttractorRadius',
  'reliefAttractorFalloff', 'reliefDensityStrength', 'reliefIntensityStrength',
  'reliefTransitionSoftness', 'reliefBaseMode', 'reliefCellSizeGradient', 'reliefVoidStrength',
  'reliefInvertProfile', 'reliefSeamSharpness', 'reliefAttractorNoise', 'reliefAttractorNoiseFreq',
  'reliefBaseAmplitude', 'reliefBaseFrequency', 'reliefWallWidth', 'reliefDensityNoise',
  'reliefDensityNoiseFreq', 'reliefPillow', 'reliefPillowCoverage', 'reliefDepthVariation',
  'reliefJunctionLift', 'reliefCrestVariation', 'reliefRadialFociCount',
  'reliefRadialFocus1X', 'reliefRadialFocus1Y', 'reliefRadialFocus2X', 'reliefRadialFocus2Y',
  'reliefRadialFocus3X', 'reliefRadialFocus3Y', 'reliefRadialStrength', 'reliefRadialFalloff',
  'reliefRadialGrow', 'reliefRadialWarp', 'reliefRadialMode',
  'meshX', 'meshY', 'baseThickness', 'smoothRadiusIn',
] as const satisfies readonly (keyof MeshState)[];

/** These designs deliberately reach the machine-bed floor. Watertight exports retain 0.01 in. */
export const CUT_THROUGH_PRESETS: ReadonlySet<string> = new Set(['relief-vertical', 'relief-radial']);

export function presetState(key: string): Partial<MeshState> {
  if (!Object.prototype.hasOwnProperty.call(CNC_PRESETS, key)) throw new Error(`Unknown preset: ${key}`);
  const settings: Partial<MeshState> = {};
  function copyDefault<K extends keyof MeshState>(field: K): void {
    settings[field] = DEFAULTS[field];
  }
  for (const field of PRESET_OWNED_KEYS) copyDefault(field);
  return Object.assign(settings, CNC_PRESETS[key]);
}
