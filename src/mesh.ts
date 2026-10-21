import { STATE } from './state';
import { previewErrorIn, reliefPreviewGrid } from './relief-master';
import { createNoiseGen, SimplexNoiseGen } from './noise/generators';
import { sampleReliefParamsFromState } from './noise/voronoi-relief';
import type { VoronoiReliefGen } from './noise/voronoi-relief';
import type { FBMGenerator, NoiseConfig, NoiseGridParams } from './types';
import { renderViewport, setCameraFromState } from './render';
import { updateStats } from './stats';
import { MIN_WATERTIGHT_THICKNESS, applyBackgroundCutoff, gridMinMax, normalizeGrid, sampleLumaGrid, weightedSmooth } from './geometry';
import { composeDrape, drapeToStockHeights } from './drape';

function surfaceFloor(): number {
  return STATE.watertight ? MIN_WATERTIGHT_THICKNESS : 0;
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
  // Floor to 0.01" when watertight to prevent degenerate enclosure triangles: both the stock
  // and every surface vertex (a vertex at z=0 coincides with the bottom face the exporter adds).
  const bt = STATE.watertight ? Math.max(MIN_WATERTIGHT_THICKNESS, baseThickness) : baseThickness;
  const cutDepth = Math.min(amplitude, bt);
  const floorZ = surfaceFloor();
  const [nMin, nMax] = gridMinMax(finalVerts, rows, cols);
  const range = nMax - nMin || 1;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const t = (finalVerts[j][i] - nMin) / range;
      // Clamp to material boundaries: hard crop at stock top and machine bed
      const raw = (bt - cutDepth) + t * cutDepth + offset;
      finalVerts[j][i] = Math.max(floorZ, Math.min(bt, raw));
    }

  STATE.vertices = finalVerts;
  STATE.genTime = performance.now() - t0;
}

export function generateDepthMapMesh(): void {
  const t0 = performance.now();
  const { depthMap, blend, dmHeightScale, dmOffset, dmSmoothing,
          drapeFoldSpacing, drapeFoldAmp, drapeFoldLength, drapeHang, drapeGravityAngle,
          drapeThickness, drapeConform, seed, meshX, meshY, resolution, baseThickness } = STATE;

  STATE.drapeOverflowIn = 0;
  STATE.drapeFoldScaleUsed = 1;
  if (STATE.mode === 'depthmap' && STATE.reliefMaster) { generateReliefMasterPreview(); return; }
  if (!depthMap) { STATE.vertices = null; return; }

  const cols = Math.max(2, resolution), rows = Math.max(4, Math.round(cols * (meshY / meshX)));
  STATE.cols = cols; STATE.rows = rows;

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = depthMap.width;
  tmpCanvas.height = depthMap.height;
  const tmpCtx = tmpCanvas.getContext('2d')!;
  tmpCtx.drawImage(depthMap, 0, 0);
  const imgData = tmpCtx.getImageData(0, 0, depthMap.width, depthMap.height);

  const bt = STATE.watertight ? Math.max(MIN_WATERTIGHT_THICKNESS, baseThickness) : baseThickness;
  const cutDepth = Math.min(dmHeightScale, bt);
  const floorZ = surfaceFloor();

  // Luma, normalized, then the background cutoff, in both modes (cutoff 0 is the identity).
  const sampled = sampleLumaGrid(imgData.data, depthMap.width, depthMap.height, cols, rows);
  normalizeGrid(sampled, rows, cols);
  applyBackgroundCutoff(sampled, rows, cols, STATE.dmBackgroundCutoff);

  if (STATE.mode === 'blend') {
    // DRAPE compositor (src/drape.ts): membrane over the form, gravity/support-directed folds,
    // thickness as clearance. dmSmoothing is not applied here: the fabric's bend length
    // (Detail Transmission) is what limits how much fine form detail the veil follows.
    const form01 = new Float64Array(rows * cols);
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) form01[j * cols + i] = sampled[j][i];
    const { surface, fitOverflowIn, foldScaleUsed } = composeDrape(form01, {
      cols, rows,
      dxIn: meshX / (cols - 1),
      formDepthIn: cutDepth,
      thicknessIn: drapeThickness,
      tension: blend,
      conform: drapeConform,
      foldSpacingIn: drapeFoldSpacing,
      foldAmpIn: drapeFoldAmp,
      foldLength: drapeFoldLength,
      hang: drapeHang,
      gravityAngleDeg: drapeGravityAngle,
      seed,
      // Fit the veil inside the cut: the figure is laid at cut - thickness - fold headroom (never
      // below 0.75 x cut - thickness) and folds shrink if they would still rise past the top. A
      // downward shift instead clipped low background relief.
      fitDepthIn: cutDepth,
    });
    STATE.vertices = drapeToStockHeights(surface, rows, cols, bt, cutDepth, dmOffset, floorZ);
    STATE.drapeOverflowIn = fitOverflowIn;
    STATE.drapeFoldScaleUsed = foldScaleUsed;
  } else {
    // Pure depth map path -- no noise
    const finalVerts = dmSmoothing > 0 ? weightedSmooth(sampled, rows, cols, dmSmoothing, 0.6) : sampled;
    // Same flat-range rule as the first normalization (geometry.ts), not a second copy of it.
    normalizeGrid(finalVerts, rows, cols);
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const t = finalVerts[j][i];
        const raw = (bt - cutDepth) + t * cutDepth + dmOffset;
        finalVerts[j][i] = Math.max(floorZ, Math.min(bt, raw));
      }

    STATE.vertices = finalVerts;
  }

  STATE.genTime = performance.now() - t0;
}

/** Relief master: the size, stock and heights come from the file. STATE.vertices is only a preview
 *  resample at the Grid Resolution (capped at the master's own); exports read the master itself
 *  (export.ts getExportSurface), so preview density never changes exported geometry. */
function generateReliefMasterPreview(): void {
  const t0 = performance.now();
  const m = STATE.reliefMaster!;
  STATE.meshX = m.widthIn;
  STATE.meshY = m.heightIn;
  STATE.baseThickness = m.stockIn;
  const cols = Math.max(2, Math.min(STATE.resolution, m.cols));
  const rows = Math.max(2, Math.min(m.rows, Math.round((cols - 1) * (m.rows - 1) / (m.cols - 1)) + 1));
  STATE.cols = cols; STATE.rows = rows;
  STATE.vertices = reliefPreviewGrid(m, cols, rows);
  STATE.reliefPreviewErrorIn = cols === m.cols && rows === m.rows ? 0 : previewErrorIn(m, STATE.vertices, cols, rows);
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

// weightedSmooth moved to geometry.ts (shared with drape.ts, no import cycle).

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
