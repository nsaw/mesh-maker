import { STATE } from './state';
import { stateToHeightmap } from './sbp/heightmap';
import { generateSBP } from './sbp/generate';
import { getDefaultConfig, getEmbeddedTools } from './sbp/tools';
import { showToast } from './toast';
import type { MaterialProfile, SbpConfig } from './sbp/types';
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

function triggerDownload(content: string, filename: string): void {
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

function handleResult(result: GenerateResult, filename: string): void {
  const { sbp, stats } = result;
  triggerDownload(sbp, filename);

  const parts: string[] = [];
  if (stats.roughingMoves > 0) parts.push(`roughing: ${stats.roughingMoves.toLocaleString()} moves`);
  if (stats.finishingMoves > 0) parts.push(`finishing: ${stats.finishingMoves.toLocaleString()} moves`);
  parts.push(`${stats.totalLines.toLocaleString()} lines`);
  showToast(`SBP exported! ${parts.join(', ')}`);
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
  if (!SBP_STATE.stlBuffer) {
    showToast('No STL uploaded');
    return;
  }

  showToast('Generating SBP from STL...');

  const worker = new Worker(
    new URL('./sbp/worker.ts', import.meta.url),
    { type: 'module' },
  );

  worker.onmessage = (e: MessageEvent) => {
    worker.terminate();
    if (e.data.type === 'error') {
      showToast(`SBP generation failed: ${e.data.message}`, 8000);
      return;
    }
    handleResult(e.data as GenerateResult, `${STATE.filename}.sbp`);
  };

  worker.onerror = (err) => {
    worker.terminate();
    showToast(`Worker error: ${err.message}`, 8000);
  };

  worker.postMessage({
    stlBuffer: SBP_STATE.stlBuffer,
    config: buildConfig(),
    resolution: SBP_STATE.resolution,
  });
}

/** Main export entry point -- called from export.ts */
export function doSBPExport(): void {
  if (SBP_STATE.stlBuffer) {
    exportFromSTL();
  } else {
    exportFromMesh();
  }
}

/** Returns HTML for the SBP config sidebar section */
export function buildSBPSection(): string {
  const tools = getEmbeddedTools(SBP_STATE.materialProfile);
  const roughingTool = getDefaultConfig(SBP_STATE.materialProfile).roughingTool;
  const finishingTool = getDefaultConfig(SBP_STATE.materialProfile).finishingTool;

  return `<div class="section sbp-only" id="sbpSection">
    <div class="section-header">
      <div class="section-title">SBP Toolpath</div>
      <div class="section-arrow">&#9660;</div>
    </div>
    <div class="section-body">
      <div class="check-row" style="margin-top:0;">
        <input type="checkbox" id="sbpRoughing"${SBP_STATE.roughingEnabled ? ' checked' : ''}>
        <label for="sbpRoughing">Roughing (${roughingTool.name})</label>
      </div>
      <div class="check-row">
        <input type="checkbox" id="sbpFinishing"${SBP_STATE.finishingEnabled ? ' checked' : ''}>
        <label for="sbpFinishing">Finishing (${finishingTool.name})</label>
      </div>

      <div class="control-row">
        <div class="control-label">Material Profile</div>
        <select class="select-input" id="sbpProfile">
          <option value="general"${SBP_STATE.materialProfile === 'general' ? ' selected' : ''}>General</option>
          <option value="mdf"${SBP_STATE.materialProfile === 'mdf' ? ' selected' : ''}>MDF</option>
          <option value="hardwood"${SBP_STATE.materialProfile === 'hardwood' ? ' selected' : ''}>Hardwood</option>
        </select>
      </div>

      <div class="control-row">
        <div class="control-label"><span>Material Thickness (in)</span><span class="val" id="val_sbpThickness">${SBP_STATE.materialThickness.toFixed(2)}</span></div>
        <input type="range" id="sl_sbpThickness" min="0.25" max="6" step="0.05" value="${SBP_STATE.materialThickness}">
      </div>

      <div class="control-row">
        <div class="control-label"><span>Leave Stock (in)</span><span class="val" id="val_sbpLeaveStock">${SBP_STATE.leaveStock.toFixed(3)}</span></div>
        <input type="range" id="sl_sbpLeaveStock" min="0" max="0.1" step="0.005" value="${SBP_STATE.leaveStock}">
      </div>

      <div class="control-row">
        <div class="control-label"><span>Offset X (in)</span><span class="val" id="val_sbpOffsetX">${SBP_STATE.offsetX.toFixed(1)}</span></div>
        <input type="range" id="sl_sbpOffsetX" min="0" max="10" step="0.5" value="${SBP_STATE.offsetX}">
      </div>

      <div class="control-row">
        <div class="control-label"><span>Offset Y (in)</span><span class="val" id="val_sbpOffsetY">${SBP_STATE.offsetY.toFixed(1)}</span></div>
        <input type="range" id="sl_sbpOffsetY" min="0" max="10" step="0.5" value="${SBP_STATE.offsetY}">
      </div>

      <div class="upload-zone${SBP_STATE.stlBuffer ? ' has-image' : ''}" id="sbpUploadZone" tabindex="0" role="button" aria-label="Upload STL for SBP generation">
        <div class="upload-text">${SBP_STATE.stlBuffer ? SBP_STATE.stlName.replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Upload STL (optional -- uses current mesh if empty)'}</div>
        <input type="file" id="sbpStlInput" accept=".stl">
      </div>
      ${SBP_STATE.stlBuffer ? '<button class="btn btn-sm" id="sbpClearStl" style="margin-top:6px;color:var(--red);border-color:var(--red);">Clear STL</button>' : ''}

      <div style="margin-top:10px;font-size:10px;color:var(--text3);">
        Tools: ${tools.length} embedded (${SBP_STATE.materialProfile})
      </div>
    </div>
  </div>`;
}

/** Wire event listeners for SBP controls. Called after sidebar rebuild. */
export function wireSBPControls(): void {
  const roughingEl = document.getElementById('sbpRoughing') as HTMLInputElement | null;
  if (roughingEl) roughingEl.addEventListener('change', () => { SBP_STATE.roughingEnabled = roughingEl.checked; });

  const finishingEl = document.getElementById('sbpFinishing') as HTMLInputElement | null;
  if (finishingEl) finishingEl.addEventListener('change', () => { SBP_STATE.finishingEnabled = finishingEl.checked; });

  const profileEl = document.getElementById('sbpProfile') as HTMLSelectElement | null;
  if (profileEl) {
    profileEl.addEventListener('change', () => {
      SBP_STATE.materialProfile = profileEl.value as MaterialProfile;
    });
  }

  // Thickness slider
  const thicknessEl = document.getElementById('sl_sbpThickness') as HTMLInputElement | null;
  if (thicknessEl) {
    thicknessEl.addEventListener('input', () => {
      SBP_STATE.materialThickness = parseFloat(thicknessEl.value);
      const valEl = document.getElementById('val_sbpThickness');
      if (valEl) valEl.textContent = SBP_STATE.materialThickness.toFixed(2);
    });
  }

  // Leave stock slider
  const stockEl = document.getElementById('sl_sbpLeaveStock') as HTMLInputElement | null;
  if (stockEl) {
    stockEl.addEventListener('input', () => {
      SBP_STATE.leaveStock = parseFloat(stockEl.value);
      const valEl = document.getElementById('val_sbpLeaveStock');
      if (valEl) valEl.textContent = SBP_STATE.leaveStock.toFixed(3);
    });
  }

  // Offset sliders
  const offsetXEl = document.getElementById('sl_sbpOffsetX') as HTMLInputElement | null;
  if (offsetXEl) {
    offsetXEl.addEventListener('input', () => {
      SBP_STATE.offsetX = parseFloat(offsetXEl.value);
      const valEl = document.getElementById('val_sbpOffsetX');
      if (valEl) valEl.textContent = SBP_STATE.offsetX.toFixed(1);
    });
  }

  const offsetYEl = document.getElementById('sl_sbpOffsetY') as HTMLInputElement | null;
  if (offsetYEl) {
    offsetYEl.addEventListener('input', () => {
      SBP_STATE.offsetY = parseFloat(offsetYEl.value);
      const valEl = document.getElementById('val_sbpOffsetY');
      if (valEl) valEl.textContent = SBP_STATE.offsetY.toFixed(1);
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

  // Clear STL button
  const clearBtn = document.getElementById('sbpClearStl');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      SBP_STATE.stlBuffer = null;
      SBP_STATE.stlName = '';
      // Re-render the upload zone
      const zone = document.getElementById('sbpUploadZone');
      if (zone) {
        zone.classList.remove('has-image');
        const text = zone.querySelector('.upload-text');
        if (text) text.textContent = 'Upload STL (optional -- uses current mesh if empty)';
      }
      clearBtn.remove();
    });
  }
}

function loadSTL(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    SBP_STATE.stlBuffer = reader.result as ArrayBuffer;
    SBP_STATE.stlName = file.name;
    const zone = document.getElementById('sbpUploadZone');
    if (zone) {
      zone.classList.add('has-image');
      const text = zone.querySelector('.upload-text');
      if (text) text.textContent = file.name;
    }
    showToast(`STL loaded: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
  };
  reader.onerror = () => {
    showToast('Failed to read STL file');
  };
  reader.readAsArrayBuffer(file);
}
