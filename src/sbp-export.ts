import { STATE } from './state';
import { stateToHeightmap } from './sbp/heightmap';
import { generateSBP } from './sbp/generate';
import { getDefaultConfig, getEmbeddedTools } from './sbp/tools';
import { updateStats } from './stats';
import { showToast } from './toast';
import type { MaterialProfile, SbpConfig, SbpStats } from './sbp/types';
import type { GenerateResult } from './sbp/generate';

/** Persistent SBP config -- survives sidebar rebuilds */
interface SbpState {
  roughingEnabled: boolean;
  finishingEnabled: boolean;
  materialProfile: MaterialProfile;
  materialThickness: number;
  resolution: number;
  offsetX: number;
  offsetY: number;
  safeZ: number;
  homeZ: number;
  leaveStock: number;
  stlBuffer: ArrayBuffer | null;
  stlName: string;
}

const SBP_STATE: SbpState = {
  roughingEnabled: true,
  finishingEnabled: true,
  materialProfile: 'general',
  materialThickness: 1.5,
  resolution: 200,
  offsetX: 2.0,
  offsetY: 2.0,
  safeZ: 1.6,
  homeZ: 2.3,
  leaveStock: 0.02,
  stlBuffer: null,
  stlName: '',
};

let sbpWorkerRunning = false;

function buildConfig(): SbpConfig {
  const base = getDefaultConfig(SBP_STATE.materialProfile);
  base.roughingEnabled = SBP_STATE.roughingEnabled;
  base.finishingEnabled = SBP_STATE.finishingEnabled;
  base.materialZ = SBP_STATE.materialThickness;
  base.offsetX = SBP_STATE.offsetX;
  base.offsetY = SBP_STATE.offsetY;
  base.safeZ = SBP_STATE.safeZ;
  base.homeZ = SBP_STATE.homeZ;
  base.leaveStock = SBP_STATE.leaveStock;

  // Set materialX/Y from STATE mesh dims
  base.materialX = STATE.meshX;
  base.materialY = STATE.meshY;

  return base;
}

function invalidateSbpStats(): void {
  STATE.sbpStats = null;
  updateStats();
}

function triggerDownload(content: BlobPart, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function buildSbpToastMessage(stats: SbpStats): string {
  const parts: string[] = [];
  if (stats.roughingMoves > 0) parts.push(`roughing: ${stats.roughingMoves.toLocaleString()} moves`);
  if (stats.finishingMoves > 0) parts.push(`finishing: ${stats.finishingMoves.toLocaleString()} moves`);
  parts.push(`${stats.totalLines.toLocaleString()} lines`);
  return `SBP exported! ${parts.join(', ')}`;
}

function handleResult(result: GenerateResult, filename: string): void {
  const { sbp, stats } = result;
  STATE.sbpStats = stats;
  triggerDownload(sbp, filename);
  updateStats();
  showToast(buildSbpToastMessage(stats));
}

/** Export using current MeshCraft mesh (STATE.vertices) */
function exportFromMesh(): void {
  const { vertices, rows, cols, meshX, meshY } = STATE;
  if (!vertices || rows < 2 || cols < 2) {
    showToast('Generate a mesh first');
    return;
  }

  const heightmap = stateToHeightmap(vertices, rows, cols, meshX, meshY);
  const config = buildConfig();
  const result = generateSBP(heightmap, config);
  handleResult(result, `${STATE.filename}.sbp`);
}

/** Export using uploaded STL via Web Worker */
function exportFromSTL(): void {
  if (sbpWorkerRunning) {
    showToast('SBP generation already in progress');
    return;
  }
  if (!SBP_STATE.stlBuffer || SBP_STATE.stlBuffer.byteLength === 0) {
    showToast('No STL uploaded');
    return;
  }

  sbpWorkerRunning = true;
  showToast('Generating SBP from STL...');

  const worker = new Worker(
    new URL('./sbp/worker.ts', import.meta.url),
    { type: 'module' },
  );

  worker.onmessage = (e: MessageEvent) => {
    worker.terminate();
    sbpWorkerRunning = false;
    SBP_STATE.stlBuffer = e.data.stlBuffer;
    if (e.data.type === 'error') {
      showToast(`SBP generation failed: ${e.data.message}`, 8000);
      return;
    }
    STATE.sbpStats = e.data.stats;
    triggerDownload(e.data.sbpBytes, `${STATE.filename}.sbp`);
    updateStats();
    showToast(buildSbpToastMessage(e.data.stats));
  };

  worker.onerror = (err) => {
    worker.terminate();
    sbpWorkerRunning = false;
    showToast(`Worker error: ${err.message}. Re-upload the STL and try again.`, 8000);
  };

  const stlBuffer = SBP_STATE.stlBuffer;
  worker.postMessage({
    stlBuffer,
    config: buildConfig(),
    resolution: SBP_STATE.resolution,
  }, [stlBuffer]);
}

/** Main export entry point -- called from export.ts */
export function doSBPExport(): void {
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
  valueText: string,
  min: number,
  max: number,
  step: number,
  value: number,
): HTMLDivElement {
  const row = createElement('div', 'control-row');
  const controlLabel = createElement('div', 'control-label');
  const labelSpan = createElement('span', undefined, label);
  const valueSpan = createElement('span', 'val', valueText);
  valueSpan.id = valueId;
  controlLabel.append(labelSpan, valueSpan);

  const input = createElement('input') as HTMLInputElement;
  input.type = 'range';
  input.id = sliderId;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);

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
  SBP_STATE.stlBuffer = null;
  SBP_STATE.stlName = '';
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
  const roughingTool = getDefaultConfig(SBP_STATE.materialProfile).roughingTool;
  const finishingTool = getDefaultConfig(SBP_STATE.materialProfile).finishingTool;
  const section = createElement('div', 'section sbp-only');
  section.id = 'sbpSection';

  const header = createElement('button', 'section-header') as HTMLButtonElement;
  header.type = 'button';
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
    buildRangeControl('sl_sbpThickness', 'val_sbpThickness', 'Material Thickness (in)', SBP_STATE.materialThickness.toFixed(2), 0.25, 6, 0.05, SBP_STATE.materialThickness),
    buildRangeControl('sl_sbpLeaveStock', 'val_sbpLeaveStock', 'Leave Stock (in)', SBP_STATE.leaveStock.toFixed(3), 0, 0.1, 0.005, SBP_STATE.leaveStock),
    buildRangeControl('sl_sbpOffsetX', 'val_sbpOffsetX', 'Offset X (in)', SBP_STATE.offsetX.toFixed(1), 0, 10, 0.5, SBP_STATE.offsetX),
    buildRangeControl('sl_sbpOffsetY', 'val_sbpOffsetY', 'Offset Y (in)', SBP_STATE.offsetY.toFixed(1), 0, 10, 0.5, SBP_STATE.offsetY),
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
      invalidateSbpStats();
    });
  }

  // Thickness slider
  const thicknessEl = document.getElementById('sl_sbpThickness') as HTMLInputElement | null;
  if (thicknessEl) {
    thicknessEl.addEventListener('input', () => {
      SBP_STATE.materialThickness = parseFloat(thicknessEl.value);
      const valEl = document.getElementById('val_sbpThickness');
      if (valEl) valEl.textContent = SBP_STATE.materialThickness.toFixed(2);
      invalidateSbpStats();
    });
  }

  // Leave stock slider
  const stockEl = document.getElementById('sl_sbpLeaveStock') as HTMLInputElement | null;
  if (stockEl) {
    stockEl.addEventListener('input', () => {
      SBP_STATE.leaveStock = parseFloat(stockEl.value);
      const valEl = document.getElementById('val_sbpLeaveStock');
      if (valEl) valEl.textContent = SBP_STATE.leaveStock.toFixed(3);
      invalidateSbpStats();
    });
  }

  // Offset sliders
  const offsetXEl = document.getElementById('sl_sbpOffsetX') as HTMLInputElement | null;
  if (offsetXEl) {
    offsetXEl.addEventListener('input', () => {
      SBP_STATE.offsetX = parseFloat(offsetXEl.value);
      const valEl = document.getElementById('val_sbpOffsetX');
      if (valEl) valEl.textContent = SBP_STATE.offsetX.toFixed(1);
      invalidateSbpStats();
    });
  }

  const offsetYEl = document.getElementById('sl_sbpOffsetY') as HTMLInputElement | null;
  if (offsetYEl) {
    offsetYEl.addEventListener('input', () => {
      SBP_STATE.offsetY = parseFloat(offsetYEl.value);
      const valEl = document.getElementById('val_sbpOffsetY');
      if (valEl) valEl.textContent = SBP_STATE.offsetY.toFixed(1);
      invalidateSbpStats();
    });
  }

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

function loadSTL(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    SBP_STATE.stlBuffer = reader.result as ArrayBuffer;
    SBP_STATE.stlName = file.name;
    invalidateSbpStats();
    updateStlUploadUi();
    syncClearStlButton();
    showToast(`STL loaded: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
  };
  reader.onerror = () => {
    showToast('Failed to read STL file');
  };
  reader.readAsArrayBuffer(file);
}
