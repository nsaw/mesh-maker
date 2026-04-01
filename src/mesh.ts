import { STATE } from './state';
import { createNoiseGen, SimplexNoiseGen } from './noise/generators';
import type { FBMGenerator, NoiseConfig } from './types';
import { renderViewport, setCameraFromState } from './render';
import { updateStats } from './stats';

export function generateNoiseMesh(): void {
  const t0 = performance.now();
  const { frequency, amplitude, noiseExp, peakExp, valleyExp, valleyFloor, offset, seed, octaves, persistence, lacunarity,
          distortion, warpFreq, warpCurl, contrast, sharpness, meshX, meshY, resolution, smoothIter, smoothStr, noiseType, baseThickness } = STATE;

  const cols = resolution, rows = Math.max(4, Math.round(resolution * (meshY / meshX)));
  STATE.cols = cols; STATE.rows = rows;

  const noiseConfig: NoiseConfig = { gaborAngle: STATE.gaborAngle, gaborBandwidth: STATE.gaborBandwidth };
  const gen = createNoiseGen(noiseType, seed, noiseConfig);
  const warpGen = distortion > 0 ? (noiseType === 'simplex' ? gen : new SimplexNoiseGen(seed)) : null;

  const verts: number[][] = [];
  for (let j = 0; j < rows; j++) {
    verts[j] = [];
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
        const amp = distortion * 5;
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

        // X: blend convergent noise value with curl component
        const convDx = warpGen.noise(sx, sy);
        x += (convDx * (1 - warpCurl) + curlDx * warpCurl) * amp;

        // Y: convergent uses warped x (cascading), curl uses original gradient
        const convDy = warpGen.noise((x + 100) * wf, (y + 100) * wf);
        y += (convDy * (1 - warpCurl) + curlDy * warpCurl) * amp;
      }

      let n: number;
      if ('fbm' in gen) {
        n = (gen as FBMGenerator).fbm(x * frequency, y * frequency, octaves, persistence, lacunarity);
      } else if (octaves > 1) {
        n = 0; let amp = 1, freq = 1, max = 0;
        for (let o = 0; o < octaves; o++) {
          n += gen.noise(x * frequency * freq, y * frequency * freq) * amp;
          max += amp; amp *= persistence; freq *= lacunarity;
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

      if (n >= 0) {
        n = Math.pow(n, peakExp);
      } else {
        n = -Math.pow(-n, valleyExp);
      }

      if (valleyFloor > 0 && n < 0) {
        n = n * (1 - valleyFloor);
      }

      verts[j][i] = n;
    }
  }

  const finalVerts = smoothIter > 0 ? weightedSmooth(verts, rows, cols, smoothIter, smoothStr) : verts;

  // CNC z-model: z=0 is machine bed, stock from 0 to baseThickness.
  // amplitude = total cut depth (peak to valley), clamped to stock thickness.
  // Peaks sit at z=baseThickness (stock top), valleys at z=baseThickness-cutDepth.
  const cutDepth = Math.min(amplitude, baseThickness);
  let nMin = Infinity, nMax = -Infinity;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (finalVerts[j][i] < nMin) nMin = finalVerts[j][i];
      if (finalVerts[j][i] > nMax) nMax = finalVerts[j][i];
    }
  const range = nMax - nMin || 1;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const t = (finalVerts[j][i] - nMin) / range;
      finalVerts[j][i] = (baseThickness - cutDepth) + t * cutDepth + offset;
    }

  STATE.vertices = finalVerts;
  STATE.genTime = performance.now() - t0;
}

export function generateDepthMapMesh(): void {
  const t0 = performance.now();
  const { depthMap, blend, dmHeightScale, dmOffset, dmSmoothing, frequency,
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

  const verts: number[][] = [];
  for (let j = 0; j < rows; j++) {
    verts[j] = [];
    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1), v = j / (rows - 1);
      const x = u * meshX, y = v * meshY;

      const ix = Math.min(Math.floor(u * depthMap.width), depthMap.width - 1);
      const iy = Math.min(Math.floor(v * depthMap.height), depthMap.height - 1);
      const idx = (iy * depthMap.width + ix) * 4;
      const r = imgData.data[idx];
      const h = (r / 255) * dmHeightScale;

      let n: number;
      if ('fbm' in gen) {
        n = (gen as FBMGenerator).fbm(x * frequency, y * frequency, octaves, persistence, lacunarity);
      } else if (octaves > 1) {
        n = 0; let amp = 1, freq = 1, max = 0;
        for (let o = 0; o < octaves; o++) {
          n += gen.noise(x * frequency * freq, y * frequency * freq) * amp;
          max += amp; amp *= persistence; freq *= lacunarity;
        }
        n /= max;
      } else {
        n = gen.noise(x * frequency, y * frequency);
      }
      const noiseH = ((n + 1) / 2) * dmHeightScale;

      const effectiveBlend = STATE.mode === 'depthmap' ? 0 : (STATE.mode === 'noise' ? 1 : blend);
      verts[j][i] = effectiveBlend * noiseH + (1 - effectiveBlend) * h;
    }
  }

  const finalVerts = dmSmoothing > 0 ? weightedSmooth(verts, rows, cols, dmSmoothing, 0.6) : verts;

  // CNC z-model: same as noise path -- peaks at stock top, valleys at stock top - cut depth
  const cutDepth = Math.min(dmHeightScale, baseThickness);
  let nMin = Infinity, nMax = -Infinity;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (finalVerts[j][i] < nMin) nMin = finalVerts[j][i];
      if (finalVerts[j][i] > nMax) nMax = finalVerts[j][i];
    }
  const nRange = nMax - nMin || 1;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const t = (finalVerts[j][i] - nMin) / nRange;
      finalVerts[j][i] = (baseThickness - cutDepth) + t * cutDepth + dmOffset;
    }

  STATE.vertices = finalVerts;
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
