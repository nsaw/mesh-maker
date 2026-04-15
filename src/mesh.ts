import { STATE } from './state';
import { createNoiseGen, SimplexNoiseGen } from './noise/generators';
import type { FBMGenerator, NoiseConfig, NoiseGridParams } from './types';
import { renderViewport, setCameraFromState } from './render';
import { updateStats } from './stats';
import { gridMinMax } from './geometry';

/** Sample a depth map image into a grid of raw [0,1] grayscale values. */
function sampleDepthMapGrid(
  imgData: ImageData, imgW: number, imgH: number,
  cols: number, rows: number,
): number[][] {
  const grid: number[][] = [];
  for (let j = 0; j < rows; j++) {
    grid[j] = [];
    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1), v = j / (rows - 1);
      const ix = Math.min(Math.floor(u * imgW), imgW - 1);
      const iy = Math.min(Math.floor(v * imgH), imgH - 1);
      const idx = (iy * imgW + ix) * 4;
      grid[j][i] = imgData.data[idx] / 255;
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
        const wAmp = distortion * 5;
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

  const cols = resolution, rows = Math.max(4, Math.round(resolution * (meshY / meshX)));
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
  const { depthMap, blend, dmHeightScale, dmOffset, dmSmoothing, frequency,
          noiseExp, peakExp, valleyExp, valleyFloor, distortion, warpFreq, warpCurl,
          contrast, sharpness, smoothIter, smoothStr,
          seed, octaves, persistence, lacunarity, meshX, meshY, resolution, noiseType, baseThickness } = STATE;

  if (!depthMap) { STATE.vertices = null; return; }

  const cols = resolution, rows = Math.max(4, Math.round(resolution * (meshY / meshX)));
  STATE.cols = cols; STATE.rows = rows;

  const noiseConfig: NoiseConfig = { gaborAngle: STATE.gaborAngle, gaborBandwidth: STATE.gaborBandwidth };
  const gen = createNoiseGen(noiseType, seed, noiseConfig);

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = depthMap.width;
  tmpCanvas.height = depthMap.height;
  const tmpCtx = tmpCanvas.getContext('2d')!;
  tmpCtx.drawImage(depthMap, 0, 0);
  const imgData = tmpCtx.getImageData(0, 0, depthMap.width, depthMap.height);

  const effectiveBlend = STATE.mode === 'depthmap' ? 0 : blend;
  const bt = STATE.watertight ? Math.max(0.01, baseThickness) : baseThickness;
  const cutDepth = Math.min(dmHeightScale, bt);

  if (effectiveBlend > 0) {
    // Blend approach matching the p5.js prototype: both noise and depth map
    // normalized to [0, 1], linearly blended in shared space, then a single
    // CNC normalization at the end. This ensures both surfaces occupy the
    // same z-range so the blend slider produces a natural transition.
    const warpGen = distortion > 0 ? (noiseType === 'simplex' ? gen : new SimplexNoiseGen(seed)) : null;

    const noiseVerts = sampleNoiseGrid({
      cols, rows, meshX, meshY, frequency, noiseExp, peakExp, valleyExp, valleyFloor,
      contrast, sharpness, octaves, persistence, lacunarity, distortion, warpFreq, warpCurl,
      gen, warpGen,
    });

    // Smooth noise independently, then normalize to [0, 1]
    const smoothedNoise = smoothIter > 0 ? weightedSmooth(noiseVerts, rows, cols, smoothIter, smoothStr) : noiseVerts;
    const [nMin, nMax] = gridMinMax(smoothedNoise, rows, cols);
    const nRange = nMax - nMin || 1;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++)
        smoothedNoise[j][i] = (smoothedNoise[j][i] - nMin) / nRange;

    // --- Depth map grid: smooth then normalize to [0, 1] (same order as pure DM path) ---
    const dmVerts = sampleDepthMapGrid(imgData, depthMap.width, depthMap.height, cols, rows);
    const smoothedDM = dmSmoothing > 0 ? weightedSmooth(dmVerts, rows, cols, dmSmoothing, 0.6) : dmVerts;
    const [dmMin, dmMax] = gridMinMax(smoothedDM, rows, cols);
    const dmRange = dmMax - dmMin || 1;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++)
        smoothedDM[j][i] = (smoothedDM[j][i] - dmMin) / dmRange;

    // --- Blend in shared [0, 1] space, then CNC normalize once ---
    // Both surfaces in [0, 1]. blend=0 -> pure depth map, blend=1 -> noise
    // floored by depth map (noise adds texture above it but never caves in).
    const b = effectiveBlend;
    const blended: number[][] = [];
    for (let j = 0; j < rows; j++) {
      blended[j] = [];
      for (let i = 0; i < cols; i++) {
        const lerped = b * smoothedNoise[j][i] + (1 - b) * smoothedDM[j][i];
        // Depth map is the floor -- noise can add texture above it but never cave in
        blended[j][i] = Math.max(lerped, smoothedDM[j][i]);
      }
    }

    // CNC z-model: scale blended [0,1] to [bt - cutDepth, bt]
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const raw = (bt - cutDepth) + blended[j][i] * cutDepth + dmOffset;
        blended[j][i] = Math.max(0, Math.min(bt, raw));
      }

    STATE.vertices = blended;
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

export function weightedSmooth(verts: number[][], rows: number, cols: number, iterations: number, strength: number): number[][] {
  let sm = verts;
  for (let iter = 0; iter < iterations; iter++) {
    const nv: number[][] = [];
    for (let j = 0; j < rows; j++) {
      nv[j] = [];
      for (let i = 0; i < cols; i++) {
        let ws = 0, tw = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const nj = j + dj, ni = i + di;
          if (nj >= 0 && nj < rows && ni >= 0 && ni < cols) {
            const w = (dj === 0 && di === 0) ? 4 : (dj === 0 || di === 0) ? 2 : 1;
            ws += sm[nj][ni] * w; tw += w;
          }
        }
        nv[j][i] = sm[j][i] * (1 - strength) + (ws / tw) * strength;
      }
    }
    sm = nv;
  }
  return sm;
}

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
