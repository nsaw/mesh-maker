import { STATE } from './state';
import { createNoiseGen, SimplexNoiseGen } from './noise/generators';
import { sampleReliefParamsFromState } from './noise/voronoi-relief';
import type { VoronoiReliefGen } from './noise/voronoi-relief';
import type { FBMGenerator, NoiseConfig, NoiseGridParams } from './types';
import { renderViewport, setCameraFromState } from './render';
import { updateStats } from './stats';
import { gridMinMax, weightedSmooth } from './geometry';
import { closeGrid, contourFolds, slopeMask } from './drape';

export { weightedSmooth };

/** Sample a depth map image into a grid of raw [0,1] grayscale values.
 *  Bilinear interpolation — nearest-neighbor stair-stepped low-res sources, forcing heavy
 *  dmSmoothing blur that melted the form detail the drape model needs. */
function sampleDepthMapGrid(
  imgData: ImageData, imgW: number, imgH: number,
  cols: number, rows: number,
): number[][] {
  const grid: number[][] = [];
  for (let j = 0; j < rows; j++) {
    grid[j] = [];
    const fy = (j / (rows - 1)) * (imgH - 1);
    const iy0 = Math.min(Math.floor(fy), imgH - 1);
    const iy1 = Math.min(iy0 + 1, imgH - 1);
    const ty = fy - iy0;
    for (let i = 0; i < cols; i++) {
      const fx = (i / (cols - 1)) * (imgW - 1);
      const ix0 = Math.min(Math.floor(fx), imgW - 1);
      const ix1 = Math.min(ix0 + 1, imgW - 1);
      const tx = fx - ix0;
      const p00 = imgData.data[(iy0 * imgW + ix0) * 4];
      const p10 = imgData.data[(iy0 * imgW + ix1) * 4];
      const p01 = imgData.data[(iy1 * imgW + ix0) * 4];
      const p11 = imgData.data[(iy1 * imgW + ix1) * 4];
      const top = p00 * (1 - tx) + p10 * tx;
      const bot = p01 * (1 - tx) + p11 * tx;
      grid[j][i] = (top * (1 - ty) + bot * ty) / 255;
    }
  }
  return grid;
}

/** Sample a raw noise grid with domain warping + FBM + post-processing.
 *  Returns values in noise-native range (no CNC normalization, no smoothing). */
function sampleNoiseGrid(p: NoiseGridParams): number[][] {
  const { cols, rows, meshX, meshY, frequency, noiseExp, peakExp, valleyExp,
          valleyFloor, contrast, sharpness, octaves, persistence, lacunarity,
          distortion, warpFreq, warpCurl, gen, warpGen } = p;

  // Grid-aware generators bypass the per-pixel loop. Domain-warp + discrete cells produces
  // visible tearing, so we skip the warp here and let the relief sampler handle anisotropy.
  if (gen.kind === 'voronoi-relief') {
    const reliefParams = sampleReliefParamsFromState(cols, rows, meshX, meshY, STATE.seed, STATE);
    return (gen as VoronoiReliefGen).sampleGrid(reliefParams);
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

      n *= contrast;
      if (sharpness > 0) {
        const s = n >= 0 ? 1 : -1;
        n = s * Math.pow(Math.abs(n), 1 + sharpness);
      }
      const sgn = n >= 0 ? 1 : -1;
      n = sgn * Math.pow(Math.abs(n), noiseExp);
      if (n >= 0) n = Math.pow(n, peakExp);
      else n = -Math.pow(-n, valleyExp);
      if (valleyFloor > 0 && n < 0) n = n * (1 - valleyFloor);

      grid[j][i] = n;
    }
  }
  return grid;
}

export function generateNoiseMesh(): void {
  const t0 = performance.now();
  const { frequency, amplitude, noiseExp, peakExp, valleyExp, valleyFloor, offset, seed, octaves, persistence, lacunarity,
          distortion, warpFreq, warpCurl, contrast, sharpness, meshX, meshY, resolution, smoothIter, smoothStr, noiseType, baseThickness } = STATE;

  const cols = Math.max(2, resolution), rows = Math.max(4, Math.round(cols * (meshY / meshX)));
  STATE.cols = cols; STATE.rows = rows;

  const noiseConfig: NoiseConfig = { gaborAngle: STATE.gaborAngle, gaborBandwidth: STATE.gaborBandwidth };
  const gen = createNoiseGen(noiseType, seed, noiseConfig);
  const warpGen = distortion > 0 ? (noiseType === 'simplex' ? gen : new SimplexNoiseGen(seed)) : null;

  const verts = sampleNoiseGrid({
    cols, rows, meshX, meshY, frequency, noiseExp, peakExp, valleyExp, valleyFloor,
    contrast, sharpness, octaves, persistence, lacunarity, distortion, warpFreq, warpCurl,
    gen, warpGen,
  });

  const finalVerts = smoothIter > 0 ? weightedSmooth(verts, rows, cols, smoothIter, smoothStr) : verts;

  // CNC z-model: z=0 is machine bed, stock from 0 to baseThickness.
  // amplitude = total cut depth (peak to valley), clamped to stock thickness.
  // Peaks sit at z=baseThickness (stock top), valleys at z=baseThickness-cutDepth.
  // Floor to 0.01" when watertight to prevent degenerate enclosure triangles.
  const bt = STATE.watertight ? Math.max(0.01, baseThickness) : baseThickness;
  const cutDepth = Math.min(amplitude, bt);
  const [nMin, nMax] = gridMinMax(finalVerts, rows, cols);
  const range = nMax - nMin || 1;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const t = (finalVerts[j][i] - nMin) / range;
      // Clamp to material boundaries: hard crop at stock top and machine bed
      const raw = (bt - cutDepth) + t * cutDepth + offset;
      finalVerts[j][i] = Math.max(0, Math.min(bt, raw));
    }

  STATE.vertices = finalVerts;
  STATE.genTime = performance.now() - t0;
}

export function generateDepthMapMesh(): void {
  const t0 = performance.now();
  const { depthMap, blend, dmHeightScale, dmOffset, dmSmoothing,
          drapeFoldScale, drapeFoldDepth, drapeFoldWarp, drapeThickness,
          seed, meshX, meshY, resolution, baseThickness } = STATE;

  if (!depthMap) { STATE.vertices = null; return; }

  const cols = Math.max(2, resolution), rows = Math.max(4, Math.round(cols * (meshY / meshX)));
  STATE.cols = cols; STATE.rows = rows;

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = depthMap.width;
  tmpCanvas.height = depthMap.height;
  const tmpCtx = tmpCanvas.getContext('2d')!;
  tmpCtx.drawImage(depthMap, 0, 0);
  const imgData = tmpCtx.getImageData(0, 0, depthMap.width, depthMap.height);

  const bt = STATE.watertight ? Math.max(0.01, baseThickness) : baseThickness;
  const cutDepth = Math.min(dmHeightScale, bt);

  if (STATE.mode === 'blend') {
    // DRAPE compositor — fabric membrane over the depth-map form (see src/drape.ts).
    // Replaces the old noise/DM crossfade, which could only produce "form + additive
    // speckle" (the depth map was a hard floor under a noise lerp):
    //   1. envelope: morphological closing of the form — tension bridging over concavities
    //   2. base: lerp(form, envelope, tension) + fabric thickness — the membrane
    //   3. folds: contour-following creases, damped where the membrane is steep (taut)
    //   4. no-penetration: h = max(membrane, form)
    const dmVerts = sampleDepthMapGrid(imgData, depthMap.width, depthMap.height, cols, rows);
    const smoothedDM = dmSmoothing > 0 ? weightedSmooth(dmVerts, rows, cols, dmSmoothing, 0.6) : dmVerts;
    const [dmMin, dmMax] = gridMinMax(smoothedDM, rows, cols);
    const dmRange = dmMax - dmMin || 1;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++)
        smoothedDM[j][i] = (smoothedDM[j][i] - dmMin) / dmRange;

    const tension = Math.max(0, Math.min(1, blend));
    // Bridge radius scales with tension: 0 → the membrane hugs the form; 1 → the fabric
    // spans concavities up to ~12% of the panel width.
    const bridgeRadius = Math.round(tension * 0.12 * cols);
    const envelope = closeGrid(smoothedDM, rows, cols, bridgeRadius);
    const thicknessNorm = cutDepth > 0 ? drapeThickness / cutDepth : 0;
    const base: number[][] = [];
    for (let j = 0; j < rows; j++) {
      base[j] = [];
      for (let i = 0; i < cols; i++) {
        base[j][i] = smoothedDM[j][i] * (1 - tension) + envelope[j][i] * tension + thicknessNorm;
      }
    }

    const folds = contourFolds(base, rows, cols, drapeFoldScale, drapeFoldWarp, seed);
    const taut = slopeMask(base, rows, cols);
    const draped: number[][] = [];
    for (let j = 0; j < rows; j++) {
      draped[j] = [];
      for (let i = 0; i < cols; i++) {
        const h = base[j][i] + folds[j][i] * drapeFoldDepth * taut[j][i];
        // No-penetration: the fabric can sag between supports but never enter the form.
        draped[j][i] = Math.max(0, Math.min(1, Math.max(h, smoothedDM[j][i])));
      }
    }

    // CNC z-model: scale [0,1] to [bt - cutDepth, bt]
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const raw = (bt - cutDepth) + draped[j][i] * cutDepth + dmOffset;
        draped[j][i] = Math.max(0, Math.min(bt, raw));
      }

    STATE.vertices = draped;
  } else {
    // Pure depth map path -- no noise, original pipeline unchanged
    const verts = sampleDepthMapGrid(imgData, depthMap.width, depthMap.height, cols, rows);

    const finalVerts = dmSmoothing > 0 ? weightedSmooth(verts, rows, cols, dmSmoothing, 0.6) : verts;

    const [nMin, nMax] = gridMinMax(finalVerts, rows, cols);
    const nRange = nMax - nMin || 1;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const t = (finalVerts[j][i] - nMin) / nRange;
        const raw = (bt - cutDepth) + t * cutDepth + dmOffset;
        finalVerts[j][i] = Math.max(0, Math.min(bt, raw));
      }

    STATE.vertices = finalVerts;
  }

  STATE.genTime = performance.now() - t0;
}

export function generateMesh(): void {
  const overlay = document.getElementById('genOverlay')!;
  overlay.classList.add('visible');

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (STATE.mode === 'noise') {
        generateNoiseMesh();
      } else if (STATE.mode === 'depthmap') {
        generateDepthMapMesh();
      } else {
        if (STATE.depthMap) generateDepthMapMesh();
        else generateNoiseMesh();
      }
      STATE.sbpStats = null;
      renderViewport();
      updateStats();
      overlay.classList.remove('visible');
    });
  });
}

// weightedSmooth moved to geometry.ts (shared with drape.ts, no import cycle); re-exported
// above for any external callers.

// Debounced generation — moved here to avoid circular dependency with stats.ts
const VIEW_ONLY_KEYS = new Set(['orbit','tilt','roll','zoom']);
let _genTimer: ReturnType<typeof setTimeout> | null = null;
let _needsMeshRegen = false;

export function debouncedGenerate(key: string): void {
  if (!VIEW_ONLY_KEYS.has(key)) _needsMeshRegen = true;
  if (_genTimer) clearTimeout(_genTimer);
  _genTimer = setTimeout(() => {
    if (_needsMeshRegen) {
      _needsMeshRegen = false;
      generateMesh();
    } else {
      setCameraFromState();
    }
  }, 60);
}
