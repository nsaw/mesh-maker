import { STATE } from './state';
import { createNoiseGen, SimplexNoiseGen } from './noise/generators';
import type { FBMGenerator } from './types';
import { renderViewport } from './render';
import { updateStats } from './stats';

export function generateNoiseMesh(): void {
  const t0 = performance.now();
  const { frequency, amplitude, noiseExp, peakExp, valleyExp, valleyFloor, offset, seed, octaves, persistence, lacunarity,
          distortion, contrast, sharpness, meshX, meshY, resolution, smoothIter, smoothStr, noiseType } = STATE;

  const cols = resolution, rows = Math.max(4, Math.round(resolution * (meshY / meshX)));
  STATE.cols = cols; STATE.rows = rows;

  const gen = createNoiseGen(noiseType, seed);
  const warpGen = noiseType === 'simplex' ? gen : new SimplexNoiseGen(seed);

  const verts: number[][] = [];
  for (let j = 0; j < rows; j++) {
    verts[j] = [];
    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1), v = j / (rows - 1);
      let x = u * meshX, y = v * meshY;

      // Domain warp: x is warped first, then the warped x feeds into y's displacement.
      // This cascading is intentional — it produces richer, asymmetric distortion patterns.
      if (distortion > 0) {
        x += warpGen.noise(x * 0.1, y * 0.1) * distortion * 5;
        y += warpGen.noise((x + 100) * 0.1, (y + 100) * 0.1) * distortion * 5;
      }

      let n: number;
      if (noiseType === 'fbm') {
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

      verts[j][i] = n * amplitude + offset;
    }
  }

  STATE.vertices = smoothIter > 0 ? weightedSmooth(verts, rows, cols, smoothIter, smoothStr) : verts;
  STATE.genTime = performance.now() - t0;
}

export function generateDepthMapMesh(): void {
  const t0 = performance.now();
  const { depthMap, blend, dmHeightScale, dmOffset, dmSmoothing, frequency,
          seed, meshX, meshY, resolution, noiseType } = STATE;

  if (!depthMap) { STATE.vertices = null; return; }

  const cols = resolution, rows = Math.max(4, Math.round(resolution * (meshY / meshX)));
  STATE.cols = cols; STATE.rows = rows;

  const gen = createNoiseGen(noiseType, seed);

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

      const n = gen.noise(x * frequency, y * frequency);
      const noiseH = ((n + 1) / 2) * dmHeightScale;

      const effectiveBlend = STATE.mode === 'depthmap' ? 0 : (STATE.mode === 'noise' ? 1 : blend);
      const z = effectiveBlend * noiseH + (1 - effectiveBlend) * h + dmOffset;

      verts[j][i] = z;
    }
  }

  STATE.vertices = dmSmoothing > 0 ? weightedSmooth(verts, rows, cols, dmSmoothing, 0.6) : verts;
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
      renderViewport();
    }
  }, 60);
}
