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
  // `relief-vertical` targets the tall panel reference: smooth wave field at top, dense
  // domed cells in the middle, cut-through spike fingers at the bottom. Distortion drives
  // domain warp on Voronoi sites so the grid flows organically rather than tessellating.
  'relief-vertical': { noiseType:'voronoi-relief', frequency:0.1, amplitude:2.5, noiseExp:1, peakExp:1, valleyExp:1, valleyFloor:0, offset:0, octaves:1, persistence:0.5, lacunarity:2, distortion:0.55, contrast:1, sharpness:0,
    warpFreq:0.08, warpCurl:0,
    reliefCellSize:1.6, reliefJitter:0.95, reliefRelaxIterations:1, reliefPolarity:'domes', reliefProfile:'hemisphere',
    reliefSeamDepth:0.95, reliefSeamWidth:0.14, reliefAnisotropy:0, reliefAnisotropyAngle:0,
    // attractorY:0 anchors the dense+void zone to the BOTTOM of the panel (viewport bottom
    // with default camera) — matches the lafabrica reference orientation where smooth waves
    // sit at the top and the cellular/spike zone hangs toward the bottom edge.
    reliefAttractorMode:'vertical', reliefAttractorX:0.5, reliefAttractorY:0, reliefAttractorRadius:0.5, reliefAttractorFalloff:2.2,
    reliefDensityStrength:1.8, reliefIntensityStrength:1, reliefTransitionSoftness:0.45, reliefBaseMode:'wave',
    reliefCellSizeGradient:1.0, reliefVoidStrength:0.7,
    meshX:24, meshY:48, baseThickness:1.5, smoothIter:3, smoothStr:0.55 },
  'relief-radial': { noiseType:'voronoi-relief', frequency:0.1, amplitude:1.2, noiseExp:1, peakExp:1, valleyExp:1, valleyFloor:0, offset:0, octaves:1, persistence:0.5, lacunarity:2, distortion:0.25, contrast:1, sharpness:0,
    warpFreq:0.08, warpCurl:0,
    reliefCellSize:1.8, reliefJitter:0.7, reliefRelaxIterations:1, reliefPolarity:'domes', reliefProfile:'cosine',
    reliefSeamDepth:0.6, reliefSeamWidth:0.14, reliefAnisotropy:0, reliefAnisotropyAngle:0,
    reliefAttractorMode:'radial', reliefAttractorX:0.5, reliefAttractorY:0.4, reliefAttractorRadius:0.6, reliefAttractorFalloff:1.2,
    reliefDensityStrength:1.2, reliefIntensityStrength:1, reliefTransitionSoftness:0.4, reliefBaseMode:'flat',
    reliefCellSizeGradient:0.6, reliefVoidStrength:0,
    meshX:24, meshY:24, smoothIter:1, smoothStr:0.4 },
  // relief-pockets — iteration 5 against the lafabrica reference. Earlier iterations had
  // three artifact sources that produced "chunky triangular plane" artifacts in the rendered
  // mesh: (1) voidStrength=0.25 floored random pixels to -clamp wherever mask*seam>0.75,
  // creating disconnected dark plateaus along walls; (2) anisotropy=0.55 + flowAnisotropy=0.7
  // made F1 ownership change discontinuously as the local angle rotated, tearing the wall
  // network; (3) attractorNoise=0.95 produced such extreme per-cell radius differences that
  // adjacent cells had mismatched dome heights. Verified clean in headless render.
  'relief-pockets': { noiseType:'voronoi-relief', frequency:0.1, amplitude:4.5, noiseExp:1, peakExp:1, valleyExp:1, valleyFloor:0, offset:0, octaves:1, persistence:0.5, lacunarity:2, distortion:0.5, contrast:1, sharpness:0,
    warpFreq:0.08, warpCurl:0,
    // Iteration 7 (post-radius-field rewrite): cellSizeGradient and attractorNoise can now
    // be pushed much harder because the radius field is continuous — variation no longer
    // causes the spike artifacts the prior algorithm produced. Targeting the lafabrica
    // reference (image #18): cells span large to small, deep pockets, organic flow,
    // dramatic patchiness in cell size.
    reliefCellSize:6.0, reliefJitter:0.85, reliefRelaxIterations:1, reliefPolarity:'pockets', reliefProfile:'hemisphere',
    reliefSeamDepth:0.28, reliefSeamWidth:0.10, reliefAnisotropy:0.35, reliefAnisotropyAngle:75,
    // Sharper attractor (falloff 0.8) concentrates dense small cells toward the bottom edge.
    reliefAttractorMode:'vertical', reliefAttractorX:0.5, reliefAttractorY:0, reliefAttractorRadius:0.5, reliefAttractorFalloff:0.8,
    // densityStrength + cellSizeGradient both at max clamp (2.0) for the most dramatic
    // top-large-to-bottom-small gradient. With the radius field, this no longer produces
    // the spike artifacts the old algorithm did at high values.
    reliefDensityStrength:2.0, reliefIntensityStrength:0.55, reliefTransitionSoftness:0.5, reliefBaseMode:'flat',
    reliefCellSizeGradient:2.0, reliefVoidStrength:0,
    reliefAttractorNoise:0.85, reliefAttractorNoiseFreq:0.13, reliefFlowAnisotropy:0.55,
    meshX:24, meshY:48, baseThickness:5.2, smoothIter:2, smoothStr:0.5 },
};
