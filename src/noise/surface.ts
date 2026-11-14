import type { SurfaceBuffers } from '../render-geometry';
import type { MeshState } from '../state';
import { MAX_CUT_DEPTH_IN } from '../sbp/types';
import { createNoiseGen, SimplexNoiseGen } from './generators';
import { sampleReliefParamsFromState } from './voronoi-relief';
import type { VoronoiReliefGen } from './voronoi-relief';
import type { FBMGenerator, NoiseConfig, NoiseGridParams, ReliefCrestClipStatus } from '../types';
import { MIN_WATERTIGHT_THICKNESS, gaussianSmooth, gridMinMax } from '../geometry';

/** Complete immutable generation request. View, export and runtime fields never enter a worker. */
export const NOISE_SURFACE_KEYS = [
  'noiseType',
  'frequency',
  'amplitude',
  'cellJitter',
  'cellMetric',
  'invert',
  'peakExp',
  'valleyExp',
  'valleyFloor',
  'offset',
  'seed',
  'octaves',
  'persistence',
  'lacunarity',
  'distortion',
  'warpFreq',
  'warpCurl',
  'gaborAngle',
  'gaborBandwidth',
  'reliefCellSize',
  'reliefJitter',
  'reliefRelaxIterations',
  'reliefPolarity',
  'reliefProfile',
  'reliefSeamDepth',
  'reliefAnisotropy',
  'reliefAnisotropyAngle',
  'reliefAttractorMode',
  'reliefAttractorX',
  'reliefAttractorY',
  'reliefAttractorRadius',
  'reliefAttractorFalloff',
  'reliefDensityStrength',
  'reliefIntensityStrength',
  'reliefTransitionSoftness',
  'reliefBaseMode',
  'reliefCellSizeGradient',
  'reliefVoidStrength',
  'reliefInvertProfile',
  'reliefSeamSharpness',
  'reliefAttractorNoise',
  'reliefAttractorNoiseFreq',
  'reliefBaseAmplitude',
  'reliefBaseFrequency',
  'reliefWallWidth',
  'reliefDensityNoise',
  'reliefDensityNoiseFreq',
  'reliefPillow',
  'reliefPillowCoverage',
  'reliefDepthVariation',
  'reliefJunctionLift',
  'reliefCrestVariation',
  'reliefRadialFociCount',
  'reliefRadialFocus1X',
  'reliefRadialFocus1Y',
  'reliefRadialFocus2X',
  'reliefRadialFocus2Y',
  'reliefRadialFocus3X',
  'reliefRadialFocus3Y',
  'reliefRadialStrength',
  'reliefRadialFalloff',
  'reliefRadialGrow',
  'reliefRadialWarp',
  'reliefRadialMode',
  'meshX',
  'meshY',
  'resolution',
  'smoothRadiusIn',
  'baseThickness',
  'watertight',
] as const satisfies readonly (keyof MeshState)[];

export type NoiseSurfaceParams = Readonly<Pick<MeshState, typeof NOISE_SURFACE_KEYS[number]>>;

export function noiseSurfaceParams(s: NoiseSurfaceParams): NoiseSurfaceParams {
  return Object.freeze({
    noiseType: s.noiseType,
    frequency: s.frequency,
    amplitude: s.amplitude,
    cellJitter: s.cellJitter,
    cellMetric: s.cellMetric,
    invert: s.invert,
    peakExp: s.peakExp,
    valleyExp: s.valleyExp,
    valleyFloor: s.valleyFloor,
    offset: s.offset,
    seed: s.seed,
    octaves: s.octaves,
    persistence: s.persistence,
    lacunarity: s.lacunarity,
    distortion: s.distortion,
    warpFreq: s.warpFreq,
    warpCurl: s.warpCurl,
    gaborAngle: s.gaborAngle,
    gaborBandwidth: s.gaborBandwidth,
    reliefCellSize: s.reliefCellSize,
    reliefJitter: s.reliefJitter,
    reliefRelaxIterations: s.reliefRelaxIterations,
    reliefPolarity: s.reliefPolarity,
    reliefProfile: s.reliefProfile,
    reliefSeamDepth: s.reliefSeamDepth,
    reliefAnisotropy: s.reliefAnisotropy,
    reliefAnisotropyAngle: s.reliefAnisotropyAngle,
    reliefAttractorMode: s.reliefAttractorMode,
    reliefAttractorX: s.reliefAttractorX,
    reliefAttractorY: s.reliefAttractorY,
    reliefAttractorRadius: s.reliefAttractorRadius,
    reliefAttractorFalloff: s.reliefAttractorFalloff,
    reliefDensityStrength: s.reliefDensityStrength,
    reliefIntensityStrength: s.reliefIntensityStrength,
    reliefTransitionSoftness: s.reliefTransitionSoftness,
    reliefBaseMode: s.reliefBaseMode,
    reliefCellSizeGradient: s.reliefCellSizeGradient,
    reliefVoidStrength: s.reliefVoidStrength,
    reliefInvertProfile: s.reliefInvertProfile,
    reliefSeamSharpness: s.reliefSeamSharpness,
    reliefAttractorNoise: s.reliefAttractorNoise,
    reliefAttractorNoiseFreq: s.reliefAttractorNoiseFreq,
    reliefBaseAmplitude: s.reliefBaseAmplitude,
    reliefBaseFrequency: s.reliefBaseFrequency,
    reliefWallWidth: s.reliefWallWidth,
    reliefDensityNoise: s.reliefDensityNoise,
    reliefDensityNoiseFreq: s.reliefDensityNoiseFreq,
    reliefPillow: s.reliefPillow,
    reliefPillowCoverage: s.reliefPillowCoverage,
    reliefDepthVariation: s.reliefDepthVariation,
    reliefJunctionLift: s.reliefJunctionLift,
    reliefCrestVariation: s.reliefCrestVariation,
    reliefRadialFociCount: s.reliefRadialFociCount,
    reliefRadialFocus1X: s.reliefRadialFocus1X,
    reliefRadialFocus1Y: s.reliefRadialFocus1Y,
    reliefRadialFocus2X: s.reliefRadialFocus2X,
    reliefRadialFocus2Y: s.reliefRadialFocus2Y,
    reliefRadialFocus3X: s.reliefRadialFocus3X,
    reliefRadialFocus3Y: s.reliefRadialFocus3Y,
    reliefRadialStrength: s.reliefRadialStrength,
    reliefRadialFalloff: s.reliefRadialFalloff,
    reliefRadialGrow: s.reliefRadialGrow,
    reliefRadialWarp: s.reliefRadialWarp,
    reliefRadialMode: s.reliefRadialMode,
    meshX: s.meshX,
    meshY: s.meshY,
    resolution: s.resolution,
    smoothRadiusIn: s.smoothRadiusIn,
    baseThickness: s.baseThickness,
    watertight: s.watertight,
  });
}

export interface NoiseSurface {
  renderBuffers?: SurfaceBuffers;
  vertices: number[][];
  cols: number;
  rows: number;
  genTime: number;
  truncatedFrom: number;
  crestClipStatus: ReliefCrestClipStatus;
}

/** Sample a raw noise grid with domain warping + FBM + post-processing.
 *  Returns values in noise-native range (no CNC normalization, no smoothing). */
function sampleNoiseGrid(p: NoiseGridParams, params: NoiseSurfaceParams, metadata: Pick<NoiseSurface, 'truncatedFrom' | 'crestClipStatus'>): number[][] {
  const { cols, rows, meshX, meshY, frequency, peakExp, valleyExp,
          valleyFloor, octaves, persistence, lacunarity,
          distortion, warpFreq, warpCurl, gen, warpGen } = p;

  // Grid-aware generators bypass the per-pixel loop. Domain-warp + discrete cells produces
  // visible tearing, so we skip the warp here and let the relief sampler handle anisotropy.
  if (gen.kind === 'voronoi-relief') {
    const reliefParams = sampleReliefParamsFromState(cols, rows, meshX, meshY, params.seed, params);
    const result = (gen as VoronoiReliefGen).sampleGridResult(reliefParams);
    metadata.truncatedFrom = result.truncatedFrom;
    metadata.crestClipStatus = result.crestClipStatus;
    return result.grid;
  }

  const grid: number[][] = [];
  for (let j = 0; j < rows; j++) {
    grid[j] = [];
    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1), v = j / (rows - 1);
      let x = u * meshX, y = v * meshY;

      // Domain warp with convergent/curl blend.
      // Convergent warp (curl=0) displaces toward noise extrema -- organic but creates
      // donut-shaped folds at high amplitudes. Curl warp (curl=1) rotates the gradient
      // 90 degrees producing divergence-free flow -- no folds, no donuts.
      // Convergent x cascades into y lookup for asymmetric patterns.
      if (warpGen && distortion > 0) {
        const wf = warpFreq;
        const wAmp = distortion * 5; // empirically tuned for visible warp at slider range [0,1]
        const sx = x * wf, sy = y * wf;

        // Curl component: numerical gradient of noise, rotated 90 degrees
        let curlDx = 0, curlDy = 0;
        if (warpCurl > 0) {
          const eps = 0.01;
          const dndx = (warpGen.noise(sx + eps, sy) - warpGen.noise(sx - eps, sy)) / (2 * eps);
          const dndy = (warpGen.noise(sx, sy + eps) - warpGen.noise(sx, sy - eps)) / (2 * eps);
          curlDx = dndy;
          curlDy = -dndx;
        }

        // Blend convergent + curl. Skip convergent samples when full curl.
        const convW = 1 - warpCurl;
        if (convW > 0) {
          const convDx = warpGen.noise(sx, sy);
          x += (convDx * convW + curlDx * warpCurl) * wAmp;
          const convDy = warpGen.noise((x + 100) * wf, (y + 100) * wf);
          y += (convDy * convW + curlDy * warpCurl) * wAmp;
        } else {
          x += curlDx * wAmp;
          y += curlDy * wAmp;
        }
      }

      let n: number;
      if ('fbm' in gen) {
        n = (gen as FBMGenerator).fbm(x * frequency, y * frequency, octaves, persistence, lacunarity);
      } else if (octaves > 1) {
        n = 0; let a = 1, freq = 1, max = 0;
        for (let o = 0; o < octaves; o++) {
          n += gen.noise(x * frequency * freq, y * frequency * freq) * a;
          max += a; a *= persistence; freq *= lacunarity;
        }
        n /= max;
      } else {
        n = gen.noise(x * frequency, y * frequency);
      }

      if (params.invert) n = -n;
      if (n >= 0) n = Math.pow(n, peakExp);
      else n = -Math.pow(-n, valleyExp);
      if (valleyFloor > 0 && n < 0) n = n * (1 - valleyFloor);

      grid[j][i] = n;
    }
  }
  return grid;
}

export function buildNoiseSurface(params: NoiseSurfaceParams): NoiseSurface {
  const t0 = performance.now();
  const { frequency, amplitude, peakExp, valleyExp, valleyFloor, offset, seed, octaves, persistence, lacunarity,
          distortion, warpFreq, warpCurl, meshX, meshY, resolution, smoothRadiusIn, noiseType, baseThickness } = params;

  const cols = Math.max(2, resolution), rows = Math.max(4, Math.round(cols * (meshY / meshX)));

  const metadata: Pick<NoiseSurface, 'truncatedFrom' | 'crestClipStatus'> = { truncatedFrom: 0, crestClipStatus: 'none' };
  const noiseConfig: NoiseConfig = { cellJitter: params.cellJitter, cellMetric: params.cellMetric, gaborAngle: params.gaborAngle, gaborBandwidth: params.gaborBandwidth };
  const gen = createNoiseGen(noiseType, seed, noiseConfig);
  const warpGen = distortion > 0 ? (noiseType === 'simplex' ? gen : new SimplexNoiseGen(seed)) : null;

  const verts = sampleNoiseGrid({
    cols, rows, meshX, meshY, frequency, invert: params.invert, peakExp, valleyExp, valleyFloor,
    octaves, persistence, lacunarity, distortion, warpFreq, warpCurl,
    gen, warpGen,
  }, params, metadata);

  const finalVerts = gaussianSmooth(verts, rows, cols, meshX, meshY, smoothRadiusIn);

  // CNC z-model: z=0 is machine bed, stock from 0 to baseThickness.
  // amplitude = total cut depth (peak to valley), clamped to stock thickness.
  // Peaks sit at z=baseThickness (stock top), valleys at z=baseThickness-cutDepth.
  // Floor to 0.01" when watertight to prevent degenerate enclosure triangles: both the stock
  // and every surface vertex (a vertex at z=0 coincides with the bottom face the exporter adds).
  const bt = params.watertight ? Math.max(MIN_WATERTIGHT_THICKNESS, baseThickness) : baseThickness;
  const cutDepth = Math.min(amplitude, bt, MAX_CUT_DEPTH_IN);
  const floorZ = Math.max(params.watertight ? MIN_WATERTIGHT_THICKNESS : 0, baseThickness - MAX_CUT_DEPTH_IN);
  const [nMin, nMax] = gridMinMax(finalVerts, rows, cols);
  const range = nMax - nMin || 1;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const t = (finalVerts[j][i] - nMin) / range;
      // Clamp to material boundaries: hard crop at stock top and machine bed
      const raw = noiseType === 'voronoi-relief'
        ? bt + (finalVerts[j][i] - nMax) * cutDepth * Math.min(1, 1 / range) + offset
        : (bt - cutDepth) + t * cutDepth + offset;
      finalVerts[j][i] = Math.max(floorZ, Math.min(bt, raw));
    }

  return { vertices: finalVerts, cols, rows, genTime: performance.now() - t0, ...metadata };
}
