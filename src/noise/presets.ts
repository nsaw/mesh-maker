export const PROFILES: Record<string, Record<string, number> | null> = {
  custom: null,
  smooth: { octaves: 2, persistence: 0.3, lacunarity: 2.0, distortion: 0.1, contrast: 0.8, sharpness: 0.1 },
  rough: { octaves: 6, persistence: 0.7, lacunarity: 2.5, distortion: 0.3, contrast: 1.5, sharpness: 0.8 },
  organic: { octaves: 4, persistence: 0.6, lacunarity: 1.8, distortion: 0.5, contrast: 1.2, sharpness: 0.3 },
  geometric: { octaves: 3, persistence: 0.4, lacunarity: 3.0, distortion: 0.1, contrast: 2.0, sharpness: 1.5 },
  crystalline: { octaves: 5, persistence: 0.5, lacunarity: 2.2, distortion: 0.2, contrast: 1.8, sharpness: 1.2 },
  waves: { octaves: 3, persistence: 0.6, lacunarity: 1.5, distortion: 0.8, contrast: 1.0, sharpness: 0.4 },
};

type PresetConfig = Record<string, string | number>;

export const CNC_PRESETS: Record<string, PresetConfig> = {
  'gentle-waves': { noiseType:'simplex', frequency:0.06, amplitude:0.5, noiseExp:0.5, peakExp:1, valleyExp:1, valleyFloor:0, offset:0, octaves:2, persistence:0.3, lacunarity:2, distortion:0, contrast:1, sharpness:0, meshX:36, meshY:24, smoothIter:3, smoothStr:0.5 },
  'organic-terrain': { noiseType:'fbm', frequency:0.1, amplitude:0.8, noiseExp:0.7, peakExp:1, valleyExp:1, valleyFloor:0, offset:0, octaves:4, persistence:0.55, lacunarity:2, distortion:0.3, contrast:1.2, sharpness:0.2, meshX:36, meshY:24, smoothIter:1, smoothStr:0.4 },
  'sharp-ridges': { noiseType:'ridged', frequency:0.08, amplitude:0.5, noiseExp:1.5, peakExp:1, valleyExp:1, valleyFloor:0, offset:0.3, octaves:3, persistence:0.5, lacunarity:2.2, distortion:0, contrast:1.5, sharpness:0.8, meshX:36, meshY:24, smoothIter:0, smoothStr:0 },
  'voronoi-cells': { noiseType:'voronoi', frequency:0.15, amplitude:0.3, noiseExp:0.8, peakExp:1, valleyExp:1, valleyFloor:0, offset:0.3, octaves:1, persistence:0.5, lacunarity:2, distortion:0, contrast:1, sharpness:0, meshX:36, meshY:24, smoothIter:2, smoothStr:0.6 },
  'subtle-texture': { noiseType:'perlin', frequency:0.12, amplitude:0.25, noiseExp:0.5, peakExp:1, valleyExp:1, valleyFloor:0, offset:0, octaves:3, persistence:0.4, lacunarity:2.5, distortion:0.1, contrast:0.8, sharpness:0, meshX:36, meshY:24, smoothIter:2, smoothStr:0.7 },
  'deep-carve': { noiseType:'fbm', frequency:0.05, amplitude:2.0, noiseExp:1.2, peakExp:1, valleyExp:1, valleyFloor:0, offset:-0.3, octaves:5, persistence:0.6, lacunarity:1.8, distortion:0.4, contrast:1.8, sharpness:0.5, meshX:24, meshY:18, smoothIter:0, smoothStr:0 },
  'sculptural': { noiseType:'fbm', frequency:0.04, amplitude:1.5, noiseExp:0.7, peakExp:1.8, valleyExp:0.35, valleyFloor:0.6, offset:0, octaves:3, persistence:0.55, lacunarity:1.8, distortion:0.4, contrast:1.3, sharpness:0.15, meshX:36, meshY:24, smoothIter:2, smoothStr:0.45 },
  'hard-wave': { noiseType:'simplex', frequency:0.05, amplitude:1.2, noiseExp:0.6, peakExp:2.0, valleyExp:0.3, valleyFloor:0.75, offset:0.1, octaves:2, persistence:0.4, lacunarity:2, distortion:0.25, contrast:1.4, sharpness:0.1, meshX:36, meshY:24, smoothIter:3, smoothStr:0.5 },
  'eroded-stone': { noiseType:'ridged', frequency:0.06, amplitude:0.5, noiseExp:0.8, peakExp:1.5, valleyExp:0.4, valleyFloor:0.5, offset:0.4, octaves:4, persistence:0.5, lacunarity:2.2, distortion:0.35, contrast:1.6, sharpness:0.3, meshX:36, meshY:24, smoothIter:1, smoothStr:0.3 },
  'billowy-clouds': { noiseType:'billow', frequency:0.07, amplitude:0.8, noiseExp:0.5, peakExp:1, valleyExp:1, valleyFloor:0, offset:0, octaves:3, persistence:0.45, lacunarity:2, distortion:0.15, contrast:1, sharpness:0, meshX:36, meshY:24, smoothIter:2, smoothStr:0.5 },
  'turbulent-marble': { noiseType:'turbulence', frequency:0.08, amplitude:1.0, noiseExp:0.7, peakExp:1, valleyExp:1, valleyFloor:0, offset:0, octaves:5, persistence:0.55, lacunarity:2.2, distortion:0.3, contrast:1.4, sharpness:0.3, meshX:36, meshY:24, smoothIter:1, smoothStr:0.3 },
  'natural-ridge': { noiseType:'hybrid', frequency:0.06, amplitude:1.2, noiseExp:0.6, peakExp:1.2, valleyExp:0.5, valleyFloor:0.3, offset:0, octaves:4, persistence:0.5, lacunarity:2, distortion:0.2, contrast:1.2, sharpness:0.1, meshX:36, meshY:24, smoothIter:1, smoothStr:0.4 },
  'organic-swirl': { noiseType:'domainwarp', frequency:0.05, amplitude:1.0, noiseExp:0.5, peakExp:1, valleyExp:1, valleyFloor:0, offset:0, octaves:3, persistence:0.5, lacunarity:1.8, distortion:0, contrast:1.1, sharpness:0, meshX:36, meshY:24, smoothIter:2, smoothStr:0.5 },
  'worley-cracks': { noiseType:'worley', frequency:0.12, amplitude:0.5, noiseExp:0.8, peakExp:1, valleyExp:1, valleyFloor:0, offset:0.2, octaves:1, persistence:0.5, lacunarity:2, distortion:0.1, contrast:1.2, sharpness:0.3, meshX:36, meshY:24, smoothIter:1, smoothStr:0.4 },
  'brushed-metal': { noiseType:'gabor', frequency:0.1, amplitude:0.3, noiseExp:0.5, peakExp:1, valleyExp:1, valleyFloor:0, offset:0, octaves:1, persistence:0.5, lacunarity:2, distortion:0, contrast:1, sharpness:0, gaborAngle:15, gaborBandwidth:1.2, meshX:36, meshY:24, smoothIter:1, smoothStr:0.3 },
  // Voronoi Relief presets — reproduce lafabricatrun-style 3D Voronoi cell carvings.
  // v16: all four presets ride the base-superposition model (cells carved INTO a wave
  // surface), use finite wall widths, and get multi-scale cell patchiness from
  // reliefDensityNoise. Distortion drives the flow component of the space-warp.
  // `relief-vertical` targets the tall panel reference: smooth wave field at top, dense
  // domed cells in the middle, cut-through spike fingers at the bottom.
  'relief-vertical': { noiseType:'voronoi-relief', frequency:0.1, amplitude:2.5, noiseExp:1, peakExp:1, valleyExp:1, valleyFloor:0, offset:0, octaves:1, persistence:0.5, lacunarity:2, distortion:0.55, contrast:1, sharpness:0,
    warpFreq:0.08, warpCurl:0,
    reliefCellSize:1.6, reliefJitter:0.95, reliefRelaxIterations:1, reliefPolarity:'domes', reliefProfile:'parabolic',
    reliefSeamDepth:0.95, reliefSeamWidth:0.14, reliefWallWidth:0.08, reliefAnisotropy:0, reliefAnisotropyAngle:0,
    // attractorY:0 anchors the dense+void zone to the BOTTOM of the panel (viewport bottom
    // with default camera) — matches the lafabrica reference orientation where smooth waves
    // sit at the top and the cellular/spike zone hangs toward the bottom edge.
    reliefAttractorMode:'vertical', reliefAttractorX:0.5, reliefAttractorY:0, reliefAttractorRadius:0.5, reliefAttractorFalloff:2.2,
    reliefDensityStrength:1.8, reliefIntensityStrength:1, reliefTransitionSoftness:0.45, reliefBaseMode:'wave',
    reliefBaseAmplitude:0.5, reliefBaseFrequency:0.1,
    reliefCellSizeGradient:1.0, reliefVoidStrength:0.7, reliefInvertProfile:0, reliefSeamSharpness:0,
    reliefPillow:0, reliefPillowCoverage:0.6,
    // Explicit zeros so switching from relief-pockets / relief-starburst (which set these to
    // non-zero) cleanly resets back to relief-vertical's designed appearance. Presets are
    // key-only merges, so omitting a field means inheriting the previous preset's value.
    reliefAttractorNoise:0, reliefAttractorNoiseFreq:0.15,
    reliefDensityNoise:0.3, reliefDensityNoiseFreq:0.08,
    reliefRadialFociCount:0, reliefRadialFocus1X:0.5, reliefRadialFocus1Y:0.25,
    reliefRadialFocus2X:0.25, reliefRadialFocus2Y:0.6, reliefRadialFocus3X:0.75, reliefRadialFocus3Y:0.8,
    reliefRadialStrength:1.5, reliefRadialFalloff:0.3, reliefRadialGrow:0.45, reliefRadialWarp:0.4, reliefRadialMode:'rays',
    meshX:24, meshY:48, baseThickness:1.5, smoothIter:3, smoothStr:0.55 },
  'relief-radial': { noiseType:'voronoi-relief', frequency:0.1, amplitude:1.2, noiseExp:1, peakExp:1, valleyExp:1, valleyFloor:0, offset:0, octaves:1, persistence:0.5, lacunarity:2, distortion:0.25, contrast:1, sharpness:0,
    warpFreq:0.08, warpCurl:0,
    reliefCellSize:1.8, reliefJitter:0.7, reliefRelaxIterations:1, reliefPolarity:'domes', reliefProfile:'cosine',
    reliefSeamDepth:0.6, reliefSeamWidth:0.14, reliefWallWidth:0.08, reliefAnisotropy:0, reliefAnisotropyAngle:0,
    reliefAttractorMode:'radial', reliefAttractorX:0.5, reliefAttractorY:0.4, reliefAttractorRadius:0.6, reliefAttractorFalloff:1.2,
    reliefDensityStrength:1.2, reliefIntensityStrength:1, reliefTransitionSoftness:0.4, reliefBaseMode:'flat',
    reliefBaseAmplitude:0, reliefBaseFrequency:0.1,
    reliefCellSizeGradient:0.6, reliefVoidStrength:0, reliefInvertProfile:0, reliefSeamSharpness:0,
    reliefPillow:0, reliefPillowCoverage:0.6,
    // Explicit zeros for the same reason as relief-vertical above — prevents stale state
    // carry-over when switching from relief-pockets / relief-starburst.
    reliefAttractorNoise:0, reliefAttractorNoiseFreq:0.15,
    reliefDensityNoise:0.3, reliefDensityNoiseFreq:0.08,
    reliefRadialFociCount:0, reliefRadialFocus1X:0.5, reliefRadialFocus1Y:0.25,
    reliefRadialFocus2X:0.25, reliefRadialFocus2Y:0.6, reliefRadialFocus3X:0.75, reliefRadialFocus3Y:0.8,
    reliefRadialStrength:1.5, reliefRadialFalloff:0.3, reliefRadialGrow:0.45, reliefRadialWarp:0.4, reliefRadialMode:'rays',
    // baseThickness explicit so the preset is deterministic when merged into state — without
    // this, applying relief-radial after another preset inherits the previous baseThickness.
    meshX:24, meshY:24, baseThickness:1.2, smoothIter:1, smoothStr:0.4 },
  // relief-pockets — v16 primary reference-matcher for the lafabrica panel. Proportions
  // retuned from measurement: the reference reads as ~0.25 depth:cell ratio (was 4.5"/5.5"
  // = 0.82, which saturated bowls into thin-fin walls regardless of algorithm). The wave
  // base (superposition) gives the undulating ridge network; wallWidth gives the walls
  // finite width; densityNoise produces giant-vs-small cell patches; distortion drives
  // the flow warp that elongates cells organically.
  'relief-pockets': { noiseType:'voronoi-relief', frequency:0.1, amplitude:1.75, noiseExp:1, peakExp:1, valleyExp:1, valleyFloor:0, offset:0, octaves:1, persistence:0.5, lacunarity:2, distortion:0.6, contrast:1, sharpness:0,
    warpFreq:0.06, warpCurl:0,
    reliefCellSize:5.0, reliefJitter:0.85, reliefRelaxIterations:1, reliefPolarity:'pockets', reliefProfile:'cosine',
    // seamDepth = saturation point: 0.75 keeps only the biggest cells reaching full depth,
    // small cells stay shallow — the lafabrica depth gradient. seamWidth drives SBP V-carve
    // width only (no mesh effect under F2-F1).
    reliefSeamDepth:0.35, reliefSeamWidth:0.15, reliefWallWidth:0.12, reliefAnisotropy:0, reliefAnisotropyAngle:0,
    reliefAttractorMode:'vertical', reliefAttractorX:0.5, reliefAttractorY:0, reliefAttractorRadius:0.5, reliefAttractorFalloff:0.35,
    reliefDensityStrength:1.2, reliefIntensityStrength:0.9, reliefTransitionSoftness:0.35, reliefBaseMode:'wave',
    reliefBaseAmplitude:0.7, reliefBaseFrequency:0.05,
    reliefCellSizeGradient:0.8, reliefVoidStrength:0, reliefInvertProfile:0, reliefSeamSharpness:0,
    reliefPillow:0.55, reliefPillowCoverage:0.6,
    reliefAttractorNoise:0.5, reliefAttractorNoiseFreq:0.1,
    reliefDensityNoise:0.9, reliefDensityNoiseFreq:0.06,
    reliefRadialFociCount:0, reliefRadialFocus1X:0.5, reliefRadialFocus1Y:0.25,
    reliefRadialFocus2X:0.25, reliefRadialFocus2Y:0.6, reliefRadialFocus3X:0.75, reliefRadialFocus3Y:0.8,
    reliefRadialStrength:1.5, reliefRadialFalloff:0.3, reliefRadialGrow:0.45, reliefRadialWarp:0.4, reliefRadialMode:'rays',
    meshX:24, meshY:48, baseThickness:2.0, smoothIter:2, smoothStr:0.4 },
  // relief-starburst — v16: each "Focus" point contributes a radial displacement term to
  // the unified space-warp, so cells stretch outward from each focus because the Voronoi
  // is EVALUATED in warped coordinates (clean curved cell boundaries, no metric tearing).
  // Slider semantics (v16):
  //   reliefRadialStrength → radial displacement strength at each focus
  //   reliefRadialFalloff  → focus influence σ as fraction of panel diagonal
  //   reliefRadialGrow     → focal expansion of the continuous radius field (broader pockets)
  //   reliefRadialWarp     → wobble on the displacement direction (organic, not rosette)
  //   reliefRadialMode     → 'rays' (radial elongation) / 'rings' (tangential) / 'spiral'
  // NOTE: these numbers are mirrored verbatim by the pre-v12 starburst share-link migration
  // in state.ts (upgradeKnownStarburstDefaults) — keep both in sync when retuning.
  'relief-starburst': { noiseType:'voronoi-relief', frequency:0.1, amplitude:1.5, noiseExp:1, peakExp:1, valleyExp:1, valleyFloor:0, offset:0, octaves:1, persistence:0.5, lacunarity:2, distortion:0.35, contrast:1, sharpness:0,
    warpFreq:0.07, warpCurl:0,
    reliefCellSize:2.5, reliefJitter:0.55, reliefRelaxIterations:1, reliefPolarity:'pockets', reliefProfile:'cosine',
    reliefSeamDepth:0.3, reliefSeamWidth:0.15, reliefWallWidth:0.1, reliefAnisotropy:0, reliefAnisotropyAngle:0,
    reliefAttractorMode:'none', reliefAttractorX:0.5, reliefAttractorY:0.5, reliefAttractorRadius:0.5, reliefAttractorFalloff:1,
    reliefDensityStrength:0, reliefIntensityStrength:1, reliefTransitionSoftness:0.5, reliefBaseMode:'wave',
    reliefBaseAmplitude:0.45, reliefBaseFrequency:0.06,
    reliefCellSizeGradient:0.4, reliefVoidStrength:0, reliefInvertProfile:0, reliefSeamSharpness:0,
    reliefPillow:0.4, reliefPillowCoverage:0.5,
    reliefAttractorNoise:0.2, reliefAttractorNoiseFreq:0.12,
    reliefDensityNoise:0.6, reliefDensityNoiseFreq:0.08,
    reliefRadialFociCount:3, reliefRadialFocus1X:0.7, reliefRadialFocus1Y:0.18,
    reliefRadialFocus2X:0.2, reliefRadialFocus2Y:0.5, reliefRadialFocus3X:0.75, reliefRadialFocus3Y:0.85,
    reliefRadialStrength:2.5, reliefRadialFalloff:0.3, reliefRadialGrow:0.2, reliefRadialWarp:0.4, reliefRadialMode:'rays',
    meshX:12, meshY:36, baseThickness:2.0, smoothIter:2, smoothStr:0.4 },
};
