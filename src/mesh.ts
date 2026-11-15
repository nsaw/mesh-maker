import { MAX_CUT_DEPTH_IN } from './sbp/types';
import { STATE, activeMaster } from './state';
import { previewErrorIn, reliefPreviewGrid } from './relief-master';
import { buildNoiseSurface, noiseSurfaceParams, type NoiseSurface } from './noise/surface';
import { noiseGridShape } from './noise/grid-shape';
import { noiseGeneration, NOISE_CHANGED } from './noise/controller';
import type { GenerationQuality } from './noise/messages';
import { showToast } from './toast';
import { renderViewport, setCameraFromState, updateDimsOverlay } from './render';
import { updateStats } from './stats';
import { MIN_WATERTIGHT_THICKNESS, applyBackgroundCutoff, normalizeGrid, sampleLumaGrid, gaussianSmooth } from './geometry';

function surfaceFloor(): number {
  return Math.max(STATE.watertight ? MIN_WATERTIGHT_THICKNESS : 0, STATE.baseThickness - MAX_CUT_DEPTH_IN);
}

/** Synchronous Node adapter, using exactly the same builder as the browser worker. */
export function generateNoiseMesh(): void {
  const params = noiseSurfaceParams(STATE);
  noiseGeneration.invalidate(params);
  try {
    const surface = buildNoiseSurface(params);
    applyNoiseSurface(surface);
    noiseGeneration.acceptSync(params, surface);
  } catch (error: unknown) {
    noiseGeneration.failSync(params, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function applyNoiseSurface(surface: NoiseSurface): void {
  STATE.vertices = surface.vertices;
  STATE.cols = surface.cols;
  STATE.rows = surface.rows;
  STATE.genTime = surface.genTime;
  STATE.reliefTruncatedFrom = surface.truncatedFrom;
  STATE.reliefCrestClipStatus = surface.crestClipStatus;
}

export function generateDepthMapMesh(): void {
  STATE.reliefTruncatedFrom = 0;
  STATE.reliefCrestClipStatus = 'none';
  const t0 = performance.now();
  const { depthMap, dmHeightScale, dmOffset, dmSmoothRadiusIn, meshX, meshY, resolution, baseThickness } = STATE;

  if (activeMaster()) { generateReliefMasterPreview(); return; }
  if (!depthMap) { STATE.vertices = null; return; }

  const {cols, rows} = noiseGridShape(resolution, meshX, meshY);
  STATE.cols = cols; STATE.rows = rows;

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = depthMap.width;
  tmpCanvas.height = depthMap.height;
  const tmpCtx = tmpCanvas.getContext('2d')!;
  tmpCtx.drawImage(depthMap, 0, 0);
  const imgData = tmpCtx.getImageData(0, 0, depthMap.width, depthMap.height);

  const bt = STATE.watertight ? Math.max(MIN_WATERTIGHT_THICKNESS, baseThickness) : baseThickness;
  const cutDepth = Math.min(dmHeightScale, bt, MAX_CUT_DEPTH_IN);
  const floorZ = surfaceFloor();

  // Luma, normalized, then the background cutoff (cutoff 0 is the identity).
  const sampled = sampleLumaGrid(imgData.data, depthMap.width, depthMap.height, cols, rows);
  normalizeGrid(sampled, rows, cols);
  applyBackgroundCutoff(sampled, rows, cols, STATE.dmBackgroundCutoff);

  const finalVerts = gaussianSmooth(sampled, rows, cols, meshX, meshY, dmSmoothRadiusIn);
  // Same flat-range rule as the first normalization (geometry.ts), not a second copy of it.
  normalizeGrid(finalVerts, rows, cols);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const t = finalVerts[j][i];
      const raw = (bt - cutDepth) + t * cutDepth + dmOffset;
      finalVerts[j][i] = Math.max(floorZ, Math.min(bt, raw));
    }
  STATE.vertices = finalVerts;

  STATE.genTime = performance.now() - t0;
}

/** Relief master (a loaded .mcrelief, or the drape result): the size, stock and heights come from
 *  it. STATE.vertices is only a preview resample at the Grid Resolution (capped at the master's
 *  own); exports read the master itself (export-surface.ts getExportSurface), so preview density
 *  never changes exported geometry. */
function generateReliefMasterPreview(): void {
  STATE.reliefTruncatedFrom = 0;
  STATE.reliefCrestClipStatus = 'none';
  const t0 = performance.now();
  const m = activeMaster()!;
  STATE.meshX = m.widthIn;
  STATE.meshY = m.heightIn;
  STATE.baseThickness = m.stockIn;
  const cols = Math.max(2, Math.min(STATE.resolution, m.cols));
  const rows = Math.max(2, Math.min(m.rows, Math.round((cols - 1) * (m.rows - 1) / (m.cols - 1)) + 1));
  STATE.cols = cols; STATE.rows = rows;
  STATE.vertices = reliefPreviewGrid(m, cols, rows);
  STATE.reliefPreviewErrorIn = cols === m.cols && rows === m.rows ? 0 : previewErrorIn(m, STATE.vertices, cols, rows, 0.99);
  STATE.genTime = performance.now() - t0;
}

function setGenerationBusy(busy: boolean): void {
  if (typeof document === 'undefined') return;
  document.getElementById('genOverlay')?.classList.toggle('visible', busy);
  updateStats();
  updateDimsOverlay();
}

noiseGeneration.includeWire = () => STATE.viewMode === 'wireframe' || STATE.viewMode === 'both';
noiseGeneration.onBusy = setGenerationBusy;
noiseGeneration.onError = reason => showToast(reason, 8000);
noiseGeneration.onCommit = surface => {
  applyNoiseSurface(surface);
  STATE.sbpStats = null;
  renderViewport(surface.renderBuffers);
  updateStats();
};

let frameRevision = 0;
let genTimer: ReturnType<typeof setTimeout> | null = null;

function clearGenerationTimer(): void {
  if (genTimer !== null) { clearTimeout(genTimer); genTimer = null; }
}

/** Noise starts in its worker immediately; other modes retain their existing preview path. */
export function generateMesh(): void { noiseGeneration.endGesture(); requestMesh('full'); }

export function beginNoiseGesture(key: string): void {
  if (STATE.mode === 'noise' && !VIEW_ONLY_KEYS.has(key)) noiseGeneration.beginGesture();
}
export function endNoiseGesture(key: string): void {
  if (STATE.mode === 'noise' && !VIEW_ONLY_KEYS.has(key)) noiseGeneration.endGesture();
}

function requestMesh(quality: GenerationQuality): void {
  clearGenerationTimer();
  const revision = ++frameRevision;
  if (STATE.mode === 'noise') {
    void noiseGeneration.start(noiseSurfaceParams(STATE), quality);
    return;
  }
  // Until the two-frame image/figure preview lands, an old mode's ordinary grid is not a source.
  // Active relief masters remain independently exportable through getExportSurface.
  STATE.vertices = null;
  noiseGeneration.cancel();
  setGenerationBusy(true);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (revision !== frameRevision) return;
    try {
      if (STATE.mode === 'depthmap') generateDepthMapMesh();
      else if (STATE.mode === 'drape' && STATE.drapeMaster) generateReliefMasterPreview();
      else STATE.vertices = null;
      STATE.sbpStats = null;
      renderViewport();
      updateStats();
    } catch (error: unknown) {
      STATE.vertices = null;
      renderViewport();
      showToast(`Generation failed: ${error instanceof Error ? error.message : String(error)}`, 8000);
    } finally {
      if (revision === frameRevision) setGenerationBusy(false);
    }
  }));
}

/** A waiter captures a generation revision. Edits or mode changes refuse that export. */
export async function ensureFullNoiseSurface(): Promise<string | null> {
  if (STATE.mode !== 'noise') return null;
  const params = noiseSurfaceParams(STATE);
  const key = JSON.stringify(params);
  clearGenerationTimer();
  const outcome = await noiseGeneration.start(params, 'full');
  if ('reason' in outcome) return outcome.reason;
  if (STATE.mode !== 'noise' || !noiseGeneration.isRevisionCurrent(outcome.revision)
    || JSON.stringify(noiseSurfaceParams(STATE)) !== key) return NOISE_CHANGED;
  return noiseGeneration.exportBlock(params);
}

// View changes must not cancel a pending mesh debounce or trigger new generation.
const VIEW_ONLY_KEYS = new Set(['orbit', 'tilt', 'roll', 'zoom', 'panX', 'panY', 'viewMode', 'viewMaterial']);
export function debouncedGenerate(key: string, quality: GenerationQuality = 'full'): void {
  if (VIEW_ONLY_KEYS.has(key)) { setCameraFromState(); return; }
  if (STATE.mode === 'noise') {
    noiseGeneration.invalidate(noiseSurfaceParams(STATE));
    updateStats();
    updateDimsOverlay();
  } else if (!activeMaster()) {
    STATE.vertices = null;
    updateStats();
    updateDimsOverlay();
  }
  clearGenerationTimer();
  if (quality === 'preview' && STATE.mode === 'noise') { requestMesh(quality); return; }
  genTimer = setTimeout(() => { genTimer = null; requestMesh(quality); }, 60);
}
