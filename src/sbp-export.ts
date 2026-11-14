import { STATE, activeMaster, stockTopIn } from './state';
import { getReliefRidgeInfo } from './noise/relief-features';
import { attachControlReset, attachValueEdit, configureRange, readRangeValue, syncRange } from './slider-utils';
import { DRAPE_CARVE_PENDING, drapeCarvePending, getExportSurface, surfaceHeightmap } from './export-surface';
import { getDefaultConfig, getEmbeddedTools } from './sbp/tools';
import { parseSTLBinary } from './sbp/stl-parser';
import { updateStats } from './stats';
import { updateExportControls } from './toolbar';
import { showToast } from './toast';
import { UPDATED_MESSAGE, updatedSinceLoad } from './stale-build';
import type { MaterialProfile, SbpConfig, SbpStats } from './sbp/types';
import { effectiveWorkOffsets, MACHINE_TRAVEL_IN, MACHINE_TRAVEL_TOLERANCE_IN } from './sbp/types';
import type { SbpWorkerInput, SbpWorkerOutput } from './sbp/worker';

/** Persistent SBP config -- survives sidebar rebuilds */
interface SbpState {
  roughingEnabled: boolean;
  finishingEnabled: boolean;
  materialProfile: MaterialProfile;
  resolution: number;
  offsetX: number;
  offsetY: number;
  safeZ: number;
  homeZ: number;
  leaveStock: number;
  finishRasterAngle: number;
  feedRateOverride: number | null;
  plungeRateOverride: number | null;
  rpmOverride: number | null;
  stepdownOverride: number | null;
  stepoverOverride: number | null;
  stlBuffer: ArrayBuffer | null;
  stlName: string;
}

/** Initial SBP settings, retained as reset targets when controls are rebuilt. */
const SBP_DEFAULTS: Readonly<SbpState> = {
  roughingEnabled: true,
  finishingEnabled: true,
  materialProfile: 'general',
  resolution: 200,
  offsetX: 2.0,
  offsetY: 2.0,
  safeZ: 0.9,   // safeZForStock(0.75)
  homeZ: 1.4,   // safeZ + 0.5
  leaveStock: 0.02,
  finishRasterAngle: 45,
  feedRateOverride: null,
  plungeRateOverride: null,
  rpmOverride: null,
  stepdownOverride: null,
  stepoverOverride: null,
  stlBuffer: null,
  stlName: '',
};

/** The SBP sidebar settings. Exported for cli/drape.spec.ts. */
export const SBP_STATE: SbpState = { ...SBP_DEFAULTS };

let sbpWorkerRunning = false;
let stlSize: { meshX: number; meshY: number } | null = null;

/** The stock top Safe Z was last synced to (null before the first sync). */
let safeZSyncedStock: number | null = null;

/** Sync Safe Z only when the stock top moved since the last sync, so a rebuild or a new drape on the
 *  same stock keeps a Safe Z the user raised. */
export function syncSbpSafeZIfStockMoved(): void {
  if (safeZSyncedStock === null || Math.abs(stockTopIn() - safeZSyncedStock) > 1e-9) syncSbpSafeZ();
}

/** Safe Z for a stock top: at least 0.1 in above it, rounded UP to the slider's 0.1 in step (rounding
 *  to the nearest tenth left 0.05 in at 0.75 in stock), within 0.5 to 6 in. Above 5.9 in of stock the
 *  6 in Z travel leaves less, and generateSBP refuses a Safe Z at or below the stock top. The 1e-6 keeps an exact
 *  tenth exact: (0.8 + 0.1) * 10 is 9.000000000000002 in floating point. */
export function safeZForStock(stockIn: number): number {
  return Math.min(6, Math.max(0.5, Math.ceil((stockIn + 0.1) * 10 - 1e-6) / 10));
}

/** Clearance reset targets follow stock, independently of a user's raised values. */
function clearanceDefaults(): { safeZ: number; homeZ: number } {
  const safeZ = safeZForStock(stockTopIn());
  return { safeZ, homeZ: Math.min(6, Math.max(1, Number((safeZ + 0.5).toFixed(1)))) };
}

/** Remove arithmetic noise at a short-decimal gap endpoint, such as 1.4 - 0.1.
 *  The IEEE guard keeps genuinely precise derived bounds; user requests never pass through this. */
function clearanceEndpoint(value: number): number {
  const compact = Number(value.toFixed(12));
  return Math.abs(compact - value) <= Number.EPSILON * 4 * Math.max(1, Math.abs(value)) ? compact : value;
}

/** A tenth-inch gap is shared by native ranges, reset clamping and input handlers. */
function clearanceBounds(): { safeZMax: number; homeZMin: number } {
  const safeZMax = Math.max(0.5, Math.min(6, clearanceEndpoint(SBP_STATE.homeZ - 0.1)));
  const homeZMin = Math.min(6, Math.max(1, clearanceEndpoint(SBP_STATE.safeZ + 0.1)));
  const slack = Number.EPSILON * 4 * Math.max(1, Math.abs(SBP_STATE.safeZ), Math.abs(SBP_STATE.homeZ));
  const validPair = SBP_STATE.safeZ >= 0.5 && SBP_STATE.homeZ >= 1 && SBP_STATE.homeZ <= 6
    && SBP_STATE.homeZ - SBP_STATE.safeZ >= 0.1 - slack;
  // Derived endpoint cleanup must not displace an already legal exact model pair.
  return {
    safeZMax: validPair ? Math.max(safeZMax, SBP_STATE.safeZ) : safeZMax,
    homeZMin: validPair ? Math.min(homeZMin, SBP_STATE.homeZ) : homeZMin,
  };
}

function syncClearanceBounds(): void {
  const bounds = clearanceBounds();
  const safe = document.getElementById('sl_sbpSafeZ') as HTMLInputElement | null;
  const home = document.getElementById('sl_sbpHomeZ') as HTMLInputElement | null;
  const defaults = clearanceDefaults();
  if (safe) syncRange(safe, SBP_STATE.safeZ, { max: bounds.safeZMax, defaultValue: defaults.safeZ });
  if (home) syncRange(home, SBP_STATE.homeZ, { min: bounds.homeZMin, defaultValue: defaults.homeZ });
}

/** Sync SBP safe/home Z to the stock top (stockTopIn). Called when it changes. */
export function syncSbpSafeZ(): void {
  safeZSyncedStock = stockTopIn();
  const defaults = clearanceDefaults();
  SBP_STATE.safeZ = defaults.safeZ;
  // Commit a legal pair before syncRange can clamp either displayed control.
  if (SBP_STATE.homeZ < clearanceBounds().homeZMin) SBP_STATE.homeZ = defaults.homeZ;

  syncClearanceBounds();
}

/** The SBP job settings from the sidebar and the stock top. Exported for cli/drape.spec.ts. */
export function buildConfig(): SbpConfig {
  const base = getDefaultConfig(SBP_STATE.materialProfile);
  base.roughingEnabled = SBP_STATE.roughingEnabled;
  base.finishingEnabled = SBP_STATE.finishingEnabled;
  base.materialZ = stockTopIn();
  const { meshX, meshY } = currentPartDimensions();
  Object.assign(base, effectiveWorkOffsets(meshX, meshY, SBP_STATE.offsetX, SBP_STATE.offsetY));
  base.safeZ = SBP_STATE.safeZ;
  base.homeZ = SBP_STATE.homeZ;
  base.leaveStock = SBP_STATE.leaveStock;
  base.finishRasterAngle = SBP_STATE.finishRasterAngle;

  if (SBP_STATE.feedRateOverride !== null) {
    base.roughingTool = { ...base.roughingTool, cutting: { ...base.roughingTool.cutting, feedRate: SBP_STATE.feedRateOverride } };
    base.finishingTool = { ...base.finishingTool, cutting: { ...base.finishingTool.cutting, feedRate: SBP_STATE.feedRateOverride } };
  }
  if (SBP_STATE.plungeRateOverride !== null) {
    base.roughingTool = { ...base.roughingTool, cutting: { ...base.roughingTool.cutting, plungeRate: SBP_STATE.plungeRateOverride } };
    base.finishingTool = { ...base.finishingTool, cutting: { ...base.finishingTool.cutting, plungeRate: SBP_STATE.plungeRateOverride } };
  }
  if (SBP_STATE.rpmOverride !== null) {
    base.roughingTool = { ...base.roughingTool, cutting: { ...base.roughingTool.cutting, rpm: SBP_STATE.rpmOverride } };
    base.finishingTool = { ...base.finishingTool, cutting: { ...base.finishingTool.cutting, rpm: SBP_STATE.rpmOverride } };
  }
  if (SBP_STATE.stepdownOverride !== null) {
    base.roughingTool = { ...base.roughingTool, cutting: { ...base.roughingTool.cutting, stepdown: SBP_STATE.stepdownOverride } };
  }
  if (SBP_STATE.stepoverOverride !== null) {
    base.finishingTool = { ...base.finishingTool, cutting: { ...base.finishingTool.cutting, stepover: SBP_STATE.stepoverOverride } };
  }

  base.materialX = meshX;
  base.materialY = meshY;

  return base;
}

/** Read dimensions without copying the full-resolution export surface's height array. */
function currentPartDimensions(): { meshX: number; meshY: number } {
  if (SBP_STATE.stlBuffer && stlSize) {
    const r = SBP_STATE.resolution;
    return { meshX: Math.ceil(stlSize.meshX * r) / r, meshY: Math.ceil(stlSize.meshY * r) / r };
  }
  const master = activeMaster();
  return master ? { meshX: master.widthIn, meshY: master.heightIn } : STATE;
}

/** Report the effective placement while retaining the user's preferred offsets. */
export function updateEffectiveOffsetDisplay(): void {
  const note = document.getElementById('sbpEffectiveOffsets');
  if (!note) return;
  const { meshX, meshY } = currentPartDimensions();
  const { offsetX, offsetY } = effectiveWorkOffsets(meshX, meshY, SBP_STATE.offsetX, SBP_STATE.offsetY);
  const T = MACHINE_TRAVEL_TOLERANCE_IN;
  const oversized = meshX > MACHINE_TRAVEL_IN.x + T || meshY > MACHINE_TRAVEL_IN.y + T;
  const fills = Math.abs(meshX - MACHINE_TRAVEL_IN.x) <= T && Math.abs(meshY - MACHINE_TRAVEL_IN.y) <= T;
  note.classList.toggle('cnc-warn', oversized);
  const formatOffset = (value: number): string => Number.isInteger(value) ? value.toFixed(1) : String(Number(value.toFixed(6)));
  note.textContent = oversized
    ? `Part ${meshX.toFixed(2)} x ${meshY.toFixed(2)} in exceeds the ${MACHINE_TRAVEL_IN.x} x ${MACHINE_TRAVEL_IN.y} in bed`
    : `Using offset X ${formatOffset(offsetX)}, Y ${formatOffset(offsetY)} in${fills ? ` (part ${meshX} x ${meshY} in fills the bed)` : ''}`;
}

function invalidateSbpStats(): void {
  STATE.sbpStats = null;
  updateStats();
  updateEffectiveOffsetDisplay();
}

function triggerDownload(content: BlobPart, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  try {
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function buildSbpToastMessage(stats: SbpStats): string {
  const parts: string[] = [];
  if (stats.roughingMoves > 0) parts.push(`roughing: ${stats.roughingMoves.toLocaleString()} moves`);
  if (stats.finishingMoves > 0) parts.push(`finishing: ${stats.finishingMoves.toLocaleString()} moves`);
  parts.push(`${stats.totalLines.toLocaleString()} lines`);
  return `SBP exported! ${parts.join(', ')}`;
}

/** Export the current surface: the relief master at full resolution when one is active, otherwise
 *  the generated grid. Runs in the worker, since a 1201 x 2401 master takes seconds to compensate. */
function exportFromMesh(): void {
  const surface = getExportSurface(true);
  if (typeof surface === 'string') { showToast(surface, 6000); return; }
  const heightmap = surfaceHeightmap(surface);
  const config = buildConfig();
  config.materialX = surface.meshX;
  config.materialY = surface.meshY;
  // Only emit the seam-rounding warning when finishing is actually enabled. The warning
  // refers to the finishing-pass stepover, which is meaningless for roughing-only exports.
  const reliefWarning = config.finishingEnabled
    ? buildReliefStepoverWarning(config.finishingTool.cutting.stepover)
    : undefined;
  runSbpWorker({ kind: 'heightmap', heightmap, config }, [heightmap.z.buffer as ArrayBuffer], reliefWarning);
}

/** The nominal guide never suppresses observed clipping, a disabled band or query deformation. */
export function buildReliefStepoverWarning(stepoverIn: number): string | undefined {
  const info = getReliefRidgeInfo(STATE);
  if (!info) return undefined;
  if (!info.crestBandDisabled && !info.queryDeformed && info.sampledCrestClipStatus === 'none'
    && stepoverIn <= info.nominalRidgeWidthIn / 2) return undefined;
  const parts = [`Finishing stepover ${stepoverIn.toFixed(3)}" may round ridges.`];
  if (info.crestBandDisabled) parts.push('The crest band is disabled.');
  else parts.push(`Nominal pre-clamp ridge-width estimate ${info.nominalRidgeWidthIn.toFixed(3)}"; local ridges may be narrower.`);
  if (info.sampledCrestClipStatus === 'collapsed') parts.push('Some sampled crest bands collapse to zero under local clipping.');
  else if (info.sampledCrestClipStatus === 'narrowed') parts.push('Local clipping narrows sampled crest bands.');
  if (info.queryDeformed) parts.push('Warp or anisotropy means this estimate does not bound physical ridge width.');
  return parts.join(' ');
}

/** Export using uploaded STL via Web Worker */
function exportFromSTL(): void {
  if (!SBP_STATE.stlBuffer || SBP_STATE.stlBuffer.byteLength === 0) {
    showToast('No STL uploaded');
    return;
  }
  const stlBuffer = SBP_STATE.stlBuffer;
  runSbpWorker({ kind: 'stl', stlBuffer, config: buildConfig(), resolution: SBP_STATE.resolution }, [stlBuffer]);
}

function runSbpWorker(input: SbpWorkerInput, transfer: ArrayBuffer[], warning?: string): void {
  if (sbpWorkerRunning) {
    showToast('SBP generation already in progress');
    return;
  }
  sbpWorkerRunning = true;
  // The page stays editable while the worker runs, so the job keeps its own identity: the file name
  // and the source it was built from. A result for a source that has since been replaced is still
  // delivered under its own name, but never labelled with or attached to the current model.
  const jobSource = currentSbpSource();
  const jobFilename = `${STATE.filename}.sbp`;
  showToast(`${input.kind === 'stl' ? 'Generating SBP from STL' : 'Generating SBP'}... a full-size relief takes a few minutes`, 600000);

  const worker = new Worker(
    new URL('./sbp/worker.ts', import.meta.url),
    { type: 'module' },
  );

  worker.onmessage = (e: MessageEvent<SbpWorkerOutput>) => {
    worker.terminate();
    sbpWorkerRunning = false;
    const out = e.data;
    // Hand the transferred STL back only if no newer upload replaced it meanwhile.
    if (out.stlBuffer && SBP_STATE.stlBuffer === jobSource) SBP_STATE.stlBuffer = out.stlBuffer;
    const current = currentSbpSource() === jobSource || (out.stlBuffer !== undefined && SBP_STATE.stlBuffer === out.stlBuffer);
    if (out.type === 'error') {
      showToast(`SBP generation failed${current ? '' : ' (for an earlier model)'}: ${out.message}`, 8000);
      return;
    }
    triggerDownload(out.sbpBytes, jobFilename);
    const summary = buildSbpToastMessage(out.stats);
    if (!current) {
      showToast(`${jobFilename} was built from the model loaded when the export started, not the current one. ${summary}`, 8000);
      return;
    }
    STATE.sbpStats = out.stats;
    updateStats();
    showToast(warning ? `${summary}. ${warning}` : summary, warning ? 6000 : 3000);
  };

  worker.onerror = (err) => {
    worker.terminate();
    sbpWorkerRunning = false;
    // A Worker that cannot load has no message: most often the site was deployed since this page opened.
    void updatedSinceLoad().then(updated => showToast(updated ? UPDATED_MESSAGE
      : `Worker error: ${err.message || 'the toolpath worker did not start (check the connection)'}.${input.kind === 'stl' ? ' Re-upload the STL and try again.' : ''}`, 8000));
  };

  worker.postMessage(input, transfer);
}

/** Identity of what an SBP export is built from: the uploaded STL buffer, else the relief master,
 *  else the generated grid. Every regeneration or upload replaces the object. */
function currentSbpSource(): unknown {
  if (SBP_STATE.stlBuffer) return SBP_STATE.stlBuffer;
  return activeMaster() ?? STATE.vertices;
}

/** Main export entry point -- called from export.ts */
export function doSBPExport(): void {
  // Material Z comes from the stock top (stockTopIn), so an uploaded STL waits for a pending drape
  // carve remap too, like every surface export (getExportSurface).
  if (drapeCarvePending()) { showToast(DRAPE_CARVE_PENDING, 6000); return; }
  if (SBP_STATE.stlBuffer) {
    exportFromSTL();
  } else {
    exportFromMesh();
  }
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function buildRangeControl(
  sliderId: string,
  valueId: string,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  defaultValue: number,
): HTMLDivElement {
  const row = createElement('div', 'control-row');
  const controlLabel = createElement('div', 'control-label');
  const labelSpan = createElement('span', undefined, label);
  const valueSpan = createElement('span', 'val');
  valueSpan.id = valueId;
  controlLabel.append(labelSpan, valueSpan);
  const input = createElement('input');
  input.id = sliderId;
  configureRange(input, valueSpan, { min, max, step, value, defaultValue });
  row.append(controlLabel, input);
  return row;
}

function updateStlUploadUi(): void {
  const zone = document.getElementById('sbpUploadZone');
  if (!zone) return;
  zone.classList.toggle('has-image', SBP_STATE.stlBuffer !== null);
  const text = zone.querySelector('.upload-text');
  if (text) {
    text.textContent = SBP_STATE.stlBuffer
      ? SBP_STATE.stlName
      : 'Upload STL (optional -- uses current mesh if empty)';
  }
  const input = document.getElementById('sbpStlInput') as HTMLInputElement | null;
  if (input && SBP_STATE.stlBuffer === null) {
    input.value = '';
  }
}

function clearLoadedStl(): void {
  stlRevision++;
  SBP_STATE.stlBuffer = null;
  SBP_STATE.stlName = '';
  stlSize = null;
  invalidateSbpStats();
  updateStlUploadUi();
  document.getElementById('sbpClearStl')?.remove();
}

function createClearStlButton(): HTMLButtonElement {
  const clearButton = createElement('button', 'btn btn-sm', 'Clear STL');
  clearButton.id = 'sbpClearStl';
  clearButton.style.marginTop = '6px';
  clearButton.style.color = 'var(--red)';
  clearButton.style.borderColor = 'var(--red)';
  clearButton.addEventListener('click', clearLoadedStl);
  return clearButton;
}

function syncClearStlButton(): void {
  const existing = document.getElementById('sbpClearStl');
  if (SBP_STATE.stlBuffer) {
    if (existing) return;
    const uploadZone = document.getElementById('sbpUploadZone');
    if (uploadZone) {
      uploadZone.insertAdjacentElement('afterend', createClearStlButton());
    }
    return;
  }
  existing?.remove();
}

/** Returns the SBP config sidebar section */
export function buildSBPSection(): HTMLElement {
  const tools = getEmbeddedTools(SBP_STATE.materialProfile);
  const configDefaults = getDefaultConfig(SBP_STATE.materialProfile);
  const roughingTool = configDefaults.roughingTool;
  const finishingTool = configDefaults.finishingTool;
  const clearances = clearanceDefaults();
  const bounds = clearanceBounds();
  const section = createElement('div', 'section sbp-only');
  section.id = 'sbpSection';

  const header = createElement('button', 'section-header') as HTMLButtonElement;
  header.type = 'button';
  header.id = 'sbp-section-body-toggle';
  header.setAttribute('aria-expanded', 'true');
  header.setAttribute('aria-controls', 'sbp-section-body');
  header.append(
    createElement('div', 'section-title', 'SBP Toolpath'),
    createElement('div', 'section-arrow', '\u25BE'),
  );

  const body = createElement('div', 'section-body');
  body.id = 'sbp-section-body';

  const roughingRow = createElement('div', 'check-row');
  roughingRow.style.marginTop = '0';
  const roughingInput = createElement('input') as HTMLInputElement;
  roughingInput.type = 'checkbox';
  roughingInput.id = 'sbpRoughing';
  roughingInput.checked = SBP_STATE.roughingEnabled;
  const roughingLabel = createElement('label', undefined, `Roughing (${roughingTool.name})`);
  roughingLabel.htmlFor = roughingInput.id;
  roughingRow.append(roughingInput, roughingLabel);

  const finishingRow = createElement('div', 'check-row');
  const finishingInput = createElement('input') as HTMLInputElement;
  finishingInput.type = 'checkbox';
  finishingInput.id = 'sbpFinishing';
  finishingInput.checked = SBP_STATE.finishingEnabled;
  const finishingLabel = createElement('label', undefined, `Finishing (${finishingTool.name})`);
  finishingLabel.htmlFor = finishingInput.id;
  finishingRow.append(finishingInput, finishingLabel);

  const profileRow = createElement('div', 'control-row');
  const profileLabel = createElement('div', 'control-label', 'Material Profile');
  const profileSelect = createElement('select', 'select-input') as HTMLSelectElement;
  profileSelect.id = 'sbpProfile';
  [['general', 'General'], ['mdf', 'MDF'], ['hardwood', 'Hardwood']].forEach(([value, text]) => {
    const option = createElement('option') as HTMLOptionElement;
    option.value = value;
    option.selected = SBP_STATE.materialProfile === value;
    option.textContent = text;
    profileSelect.append(option);
  });
  profileRow.append(profileLabel, profileSelect);

  const uploadZone = createElement('div', `upload-zone${SBP_STATE.stlBuffer ? ' has-image' : ''}`);
  uploadZone.id = 'sbpUploadZone';
  uploadZone.tabIndex = 0;
  uploadZone.setAttribute('role', 'button');
  uploadZone.setAttribute('aria-label', 'Upload STL for SBP generation');
  const uploadText = createElement(
    'div',
    'upload-text',
    SBP_STATE.stlBuffer ? SBP_STATE.stlName : 'Upload STL (optional -- uses current mesh if empty)',
  );
  const uploadInput = createElement('input') as HTMLInputElement;
  uploadInput.type = 'file';
  uploadInput.id = 'sbpStlInput';
  uploadInput.accept = '.stl';
  uploadZone.append(uploadText, uploadInput);

  body.append(
    roughingRow,
    finishingRow,
    profileRow,
    buildRangeControl('sl_sbpLeaveStock', 'val_sbpLeaveStock', 'Leave Stock (in)', 0, 0.1, 0.005, SBP_STATE.leaveStock, SBP_DEFAULTS.leaveStock),
    buildRangeControl('sl_sbpOffsetX', 'val_sbpOffsetX', 'Offset X (in)', 0, 10, 0.5, SBP_STATE.offsetX, SBP_DEFAULTS.offsetX),
    buildRangeControl('sl_sbpOffsetY', 'val_sbpOffsetY', 'Offset Y (in)', 0, 10, 0.5, SBP_STATE.offsetY, SBP_DEFAULTS.offsetY),
    Object.assign(createElement('div', 'cnc-note'), { id: 'sbpEffectiveOffsets' }),
    buildRangeControl('sl_sbpSafeZ', 'val_sbpSafeZ', 'Safe Z (in)', 0.5, bounds.safeZMax, 0.1, SBP_STATE.safeZ, clearances.safeZ),
    buildRangeControl('sl_sbpHomeZ', 'val_sbpHomeZ', 'Home Z (in)', bounds.homeZMin, 6, 0.1, SBP_STATE.homeZ, clearances.homeZ),
    buildRangeControl('sl_sbpRasterAngle', 'val_sbpRasterAngle', 'Raster Angle (deg)', 0, 90, 5, SBP_STATE.finishRasterAngle, SBP_DEFAULTS.finishRasterAngle),
    buildRangeControl('sl_sbpFeedRate', 'val_sbpFeedRate', 'Feed Rate (ips)', 0.1, 8, 0.1,
      SBP_STATE.feedRateOverride ?? finishingTool.cutting.feedRate, finishingTool.cutting.feedRate),
    buildRangeControl('sl_sbpPlungeRate', 'val_sbpPlungeRate', 'Plunge Rate (ips)', 0.05, 3, 0.05,
      SBP_STATE.plungeRateOverride ?? finishingTool.cutting.plungeRate, finishingTool.cutting.plungeRate),
    buildRangeControl('sl_sbpRpm', 'val_sbpRpm', 'Spindle RPM', 5000, 24000, 500,
      SBP_STATE.rpmOverride ?? finishingTool.cutting.rpm, finishingTool.cutting.rpm),
    buildRangeControl('sl_sbpStepdown', 'val_sbpStepdown', 'Stepdown (in)', 0.01, 1, 0.01,
      SBP_STATE.stepdownOverride ?? roughingTool.cutting.stepdown, roughingTool.cutting.stepdown),
    buildRangeControl('sl_sbpStepover', 'val_sbpStepover', 'Stepover (in)', 0.005, 0.5, 0.005,
      SBP_STATE.stepoverOverride ?? finishingTool.cutting.stepover, finishingTool.cutting.stepover),
    uploadZone,
  );

  if (SBP_STATE.stlBuffer) {
    body.append(createClearStlButton());
  }

  const toolsNote = createElement('div', undefined, `Tools: ${tools.length} embedded (${SBP_STATE.materialProfile})`);
  toolsNote.style.marginTop = '10px';
  toolsNote.style.fontSize = '10px';
  toolsNote.style.color = 'var(--text3)';
  body.append(toolsNote);

  section.append(header, body);
  return section;
}

/** Wire event listeners for SBP controls. Called after sidebar rebuild. */
export function wireSBPControls(): void {
  updateEffectiveOffsetDisplay();
  const roughingEl = document.getElementById('sbpRoughing') as HTMLInputElement | null;
  if (roughingEl) roughingEl.addEventListener('change', () => {
    SBP_STATE.roughingEnabled = roughingEl.checked;
    invalidateSbpStats();
  });

  const finishingEl = document.getElementById('sbpFinishing') as HTMLInputElement | null;
  if (finishingEl) finishingEl.addEventListener('change', () => {
    SBP_STATE.finishingEnabled = finishingEl.checked;
    invalidateSbpStats();
  });

  const profileEl = document.getElementById('sbpProfile') as HTMLSelectElement | null;
  if (profileEl) {
    profileEl.addEventListener('change', () => {
      SBP_STATE.materialProfile = profileEl.value as MaterialProfile;
      SBP_STATE.feedRateOverride = null;
      SBP_STATE.plungeRateOverride = null;
      SBP_STATE.rpmOverride = null;
      SBP_STATE.stepdownOverride = null;
      SBP_STATE.stepoverOverride = null;
      invalidateSbpStats();
      const sbpSection = document.getElementById('sbpSection');
      if (sbpSection) {
        const newSection = buildSBPSection();
        sbpSection.replaceWith(newSection);
        wireSBPControls();
        updateExportControls();
        // Re-wire accordion on the replaced section (including mobile behavior)
        const newHeader = newSection.querySelector<HTMLElement>('.section-header');
        if (newHeader) {
          newHeader.addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            if (sidebar && window.matchMedia('(max-width: 900px)').matches) {
              const allSections = sidebar.querySelectorAll('.section');
              const wasCollapsed = newSection.classList.contains('collapsed');
              allSections.forEach(s => s.classList.add('collapsed'));
              if (wasCollapsed) newSection.classList.remove('collapsed');
              allSections.forEach(s => {
                const h = s.querySelector<HTMLElement>('.section-header');
                if (h) h.setAttribute('aria-expanded', String(!s.classList.contains('collapsed')));
              });
            } else {
              newSection.classList.toggle('collapsed');
              newHeader.setAttribute('aria-expanded', String(!newSection.classList.contains('collapsed')));
            }
          });
        }
      }
    });
  }

  // Leave stock slider
  const stockEl = document.getElementById('sl_sbpLeaveStock') as HTMLInputElement | null;
  if (stockEl) {
    stockEl.addEventListener('input', () => {
      SBP_STATE.leaveStock = readRangeValue(stockEl);
      syncRange(stockEl, SBP_STATE.leaveStock);
      invalidateSbpStats();
    });
  }

  // Offset sliders
  const offsetXEl = document.getElementById('sl_sbpOffsetX') as HTMLInputElement | null;
  if (offsetXEl) {
    offsetXEl.addEventListener('input', () => {
      SBP_STATE.offsetX = readRangeValue(offsetXEl);
      syncRange(offsetXEl, SBP_STATE.offsetX);
      invalidateSbpStats();
    });
  }

  const offsetYEl = document.getElementById('sl_sbpOffsetY') as HTMLInputElement | null;
  if (offsetYEl) {
    offsetYEl.addEventListener('input', () => {
      SBP_STATE.offsetY = readRangeValue(offsetYEl);
      syncRange(offsetYEl, SBP_STATE.offsetY);
      invalidateSbpStats();
    });
  }

  const safeZEl = document.getElementById('sl_sbpSafeZ') as HTMLInputElement | null;
  const homeZEl = document.getElementById('sl_sbpHomeZ') as HTMLInputElement | null;
  if (safeZEl) safeZEl.addEventListener('input', () => {
    const val = readRangeValue(safeZEl);
    SBP_STATE.safeZ = Math.min(clearanceBounds().safeZMax, Math.max(0.5, val));
    syncClearanceBounds();
    invalidateSbpStats();
  });

  if (homeZEl) homeZEl.addEventListener('input', () => {
    const val = readRangeValue(homeZEl);
    SBP_STATE.homeZ = Math.max(clearanceBounds().homeZMin, Math.min(6, val));
    syncClearanceBounds();
    invalidateSbpStats();
  });

  const rasterEl = document.getElementById('sl_sbpRasterAngle') as HTMLInputElement | null;
  if (rasterEl) rasterEl.addEventListener('input', () => {
    SBP_STATE.finishRasterAngle = readRangeValue(rasterEl);
    syncRange(rasterEl, SBP_STATE.finishRasterAngle);
    invalidateSbpStats();
  });

  // Override sliders: drag to set, double-click to reset to profile default
  const finishingTool = getDefaultConfig(SBP_STATE.materialProfile).finishingTool;
  const roughingTool = getDefaultConfig(SBP_STATE.materialProfile).roughingTool;

  function wireOverrideSlider(
    sliderId: string, getDefault: () => number,
    setOverride: (v: number | null) => void,
  ): void {
    const el = document.getElementById(sliderId) as HTMLInputElement | null;
    if (!el) return;
    el.addEventListener('input', () => {
      const val = readRangeValue(el);
      setOverride(val);
      syncRange(el, val);
      invalidateSbpStats();
    });
    el.addEventListener('dblclick', () => {
      setOverride(null);
      syncRange(el, getDefault());
      invalidateSbpStats();
    });
  }

  wireOverrideSlider('sl_sbpFeedRate', () => finishingTool.cutting.feedRate,
    v => { SBP_STATE.feedRateOverride = v; });
  wireOverrideSlider('sl_sbpPlungeRate', () => finishingTool.cutting.plungeRate,
    v => { SBP_STATE.plungeRateOverride = v; });
  wireOverrideSlider('sl_sbpRpm', () => finishingTool.cutting.rpm,
    v => { SBP_STATE.rpmOverride = v; });
  wireOverrideSlider('sl_sbpStepdown', () => roughingTool.cutting.stepdown,
    v => { SBP_STATE.stepdownOverride = v; });
  wireOverrideSlider('sl_sbpStepover', () => finishingTool.cutting.stepover,
    v => { SBP_STATE.stepoverOverride = v; });

  // Click value label to type exact number (SBP sliders)
  const sbpSection = document.getElementById('sbpSection');
  if (sbpSection) {
    sbpSection.querySelectorAll<HTMLElement>('.control-label .val').forEach(valSpan => {
      const valueId = valSpan.id;
      if (!valueId) return;
      const row = valSpan.closest('.control-row');
      const sl = row?.querySelector<HTMLInputElement>('input[type="range"]');
      if (!sl) return;
      attachValueEdit(valSpan, sl);
    });

    // Double-click non-override sliders to reset default
    sbpSection.querySelectorAll<HTMLInputElement>('input[type="range"][data-default]').forEach(sl => {
      // Skip override sliders -- they already have dblclick via wireOverrideSlider
      if (sl.id.match(/Feed|Plunge|Rpm|Stepdown|Stepover/)) return;
      sl.addEventListener('dblclick', () => {
        const def = sl.dataset.default;
        if (def === undefined) return;
        syncRange(sl, Number(def));
        sl.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  }

  sbpSection?.querySelectorAll<HTMLInputElement>('input[data-default]').forEach(attachControlReset);
  syncClearanceBounds();

  // STL upload
  const uploadZone = document.getElementById('sbpUploadZone');
  const stlInput = document.getElementById('sbpStlInput') as HTMLInputElement | null;
  if (uploadZone && stlInput) {
    uploadZone.addEventListener('click', () => stlInput.click());
    uploadZone.addEventListener('keydown', e => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        stlInput.click();
      }
    });
    uploadZone.addEventListener('dragover', e => {
      e.preventDefault();
      (uploadZone as HTMLElement).style.borderColor = 'var(--accent)';
    });
    uploadZone.addEventListener('dragleave', () => {
      (uploadZone as HTMLElement).style.borderColor = '';
    });
    uploadZone.addEventListener('drop', e => {
      e.preventDefault();
      (uploadZone as HTMLElement).style.borderColor = '';
      if ((e as DragEvent).dataTransfer?.files[0]) loadSTL((e as DragEvent).dataTransfer!.files[0]);
    });
    stlInput.addEventListener('change', () => {
      if (stlInput.files?.[0]) loadSTL(stlInput.files[0]);
    });
  }

}

/** Bumped by every STL upload and by Clear: a read that finishes after a newer upload or a clear
 *  is discarded, as the depth-map uploads do (ui.ts uploadRevision). */
let stlRevision = 0;

function loadSTL(file: File): void {
  const revision = ++stlRevision;
  const reader = new FileReader();
  reader.onload = () => {
    if (revision !== stlRevision) return;
    const buffer = reader.result as ArrayBuffer;
    try {
      const { bounds } = parseSTLBinary(buffer);
      const meshX = bounds.maxX - bounds.minX, meshY = bounds.maxY - bounds.minY;
      if (!(Number.isFinite(meshX) && Number.isFinite(meshY) && meshX > 0 && meshY > 0))
        throw new Error('STL must have finite, positive X and Y extents');
      stlSize = { meshX, meshY };
    } catch (error) {
      showToast(`Failed to read STL: ${error instanceof Error ? error.message : String(error)}`, 6000);
      return;
    }
    SBP_STATE.stlBuffer = buffer;
    SBP_STATE.stlName = file.name;
    invalidateSbpStats();
    updateStlUploadUi();
    syncClearStlButton();
    showToast(`STL loaded: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
  };
  reader.onerror = () => {
    if (revision === stlRevision) showToast('Failed to read STL file');
  };
  reader.readAsArrayBuffer(file);
}
