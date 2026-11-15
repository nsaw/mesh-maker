import { setViewMode } from './toolbar';
import { triggerDownload } from './export';
import { captureExportSource } from './export-surface';
import { syncRange } from './slider-utils';
import { STATE, type MeshState } from './state';
import { NOISE_SURFACE_KEYS } from './noise/surface';
import { noiseGeneration } from './noise/controller';
import { ensureFullNoiseSurface, generateMesh, debouncedGenerate } from './mesh';
import { ReliefEditor } from './relief-editor';
import { ReliefEditorJobs } from './relief-editor-jobs';
import { encodeReliefProject, type ReliefProjectParams } from './relief-project';
import { showToast } from './toast';
import { buildSidebar, lockedDimensionPatch, syncDepthCaps, syncReliefControls } from './ui';
import { syncSbpSafeZIfStockMoved } from './sbp-export';

export const reliefEditor = new ReliefEditor(new ReliefEditorJobs());
export let selectedCell: number | null = null;
export let cellTool: 'move' | 'add' | 'erase' = 'move';
let applied = '';
let ready = false;
let controlGesture: string | null = null;
let generatingGesture = false;
let editorChanged: () => void = () => undefined;
export function setEditorChangeListener(callback: () => void): void { editorChanged = callback; }
export function selectCell(id: number | null): void { selectedCell = id; syncCellEditor(); editorChanged(); }
export function editorIsActive(): boolean { return STATE.mode === 'noise' && STATE.noiseType === 'voronoi-relief' && reliefEditor.view !== null; }
export function restoreReliefDocument(): void {
  const project = reliefEditor.current;
  if (!project || STATE.noiseType !== 'voronoi-relief') return;
  Object.assign(STATE, project.params, {reliefSites: project.sites, reliefRevision: reliefEditor.revision});
  applied = encodeReliefProject(project);
}
export function beginReliefControlGesture(key: string): void {
  if (!editorIsActive() || reliefEditor.gesturing || !NOISE_SURFACE_KEYS.some(candidate => candidate === key)) return;
  controlGesture = key; reliefEditor.beginGesture();
}
export function endReliefControlGesture(key: string, cancel = false): void {
  if (controlGesture !== key) return;
  controlGesture = null;
  if (cancel) reliefEditor.cancelGesture(); else reliefEditor.commitGesture();
}
/** Controls call this before mutating STATE. A staged layout never becomes the export source. */
export function changeReliefParams(patch: Partial<ReliefProjectParams>): boolean {
  const returning = STATE.mode === 'noise' && reliefEditor.view !== null && STATE.noiseType !== 'voronoi-relief' && patch.noiseType === 'voronoi-relief';
  if (returning) {
    reliefEditor.navigation(); STATE.noiseType = 'voronoi-relief'; restoreReliefDocument();
    STATE.activePreset = null; STATE.activeProfile = null;
  }
  if (!editorIsActive()) return false;
  const filtered = Object.fromEntries(Object.entries(patch).filter(([key]) => NOISE_SURFACE_KEYS.some(candidate => candidate === key) && key !== 'reliefSites' && key !== 'reliefRevision')) as Partial<ReliefProjectParams>;
  if (!Object.keys(filtered).length) return false;
  const entries = Object.entries(filtered);
  if (entries.length === 1 && typeof entries[0][1] === 'number') {
    const fitted = lockedDimensionPatch(entries[0][0], entries[0][1]);
    if (fitted) Object.assign(filtered, fitted);
  }
  patch = filtered;
  reliefEditor.updateParams(patch);
  if (returning) { buildSidebar(); generateMesh(); }
  return true;
}
export function reliefPreviewParams(): ReliefProjectParams | null { return editorIsActive() ? reliefEditor.pendingParams() : null; }
export function reliefControlValue(key: string): MeshState[keyof MeshState] | undefined {
  if (!editorIsActive()) return undefined;
  return reliefEditor.pendingValue(key as keyof ReliefProjectParams);
}
export async function applyCellLayout(): Promise<void> {
  if (!editorIsActive()) { generateMesh(); return; }
  try {
    const pending = reliefEditor.pendingParams();
    if (pending && pending.noiseType !== 'voronoi-relief') {
      reliefEditor.navigation(); reliefEditor.discardPending();
      Object.assign(STATE, pending, {reliefSites: null, reliefRevision: reliefEditor.revision});
      buildSidebar(); generateMesh(); return;
    }
    if (!window.confirm('Replace the frozen cell layout? Undo restores the current layout.')) return;
    if (!await reliefEditor.apply()) showToast('The project changed. Layout was kept.');
    buildSidebar();
  } catch (error: unknown) { report(error); }
}
function report(error: unknown): void { showToast(error instanceof Error ? error.message : String(error), 8000); }
async function freeze(): Promise<void> {
  try {
    const refusal = await ensureFullNoiseSurface();
    if (refusal) throw new Error(refusal);
    const source = noiseGeneration.completedReliefSource();
    if (!source || STATE.mode !== 'noise' || STATE.noiseType !== 'voronoi-relief') throw new Error('Generate a procedural relief before freezing cells.');
    reliefEditor.freeze(source); buildSidebar(); setViewMode('plan');
  } catch (error: unknown) { report(error); }
}
function button(id: string, label: string, action: () => void): HTMLButtonElement {
  const element = document.createElement('button'); element.type = 'button'; element.className = 'btn btn-sm';
  element.id = id; element.textContent = label; element.addEventListener('click', action); return element;
}
export function buildCellEditor(): HTMLElement {
  const section = document.createElement('div'); section.className = 'section noise-only cell-editor';
  const header = document.createElement('button'); header.type = 'button'; header.className = 'section-header';
  header.setAttribute('aria-expanded', 'true'); header.setAttribute('aria-controls', 'cell-editor-section-body');
  const title = document.createElement('div'); title.className = 'section-title'; title.textContent = 'Cell editor';
  header.append(title);
  const body = document.createElement('div'); body.className = 'section-body'; body.id = 'cell-editor-section-body';
  const status = document.createElement('p'); status.id = 'cellEditorStatus'; status.className = 'profile-note'; status.setAttribute('role', 'status');
  const controls = document.createElement('div'); controls.className = 'cell-editor-actions';
  controls.append(button('btnFreezeCells', 'Freeze and edit', () => { void freeze(); }));
  for (const tool of ['move', 'add', 'erase'] as const) controls.append(button(`cellTool_${tool}`, tool, () => {
    cellTool = tool; setViewMode('plan'); syncCellEditor();
  }));
  controls.append(button('btnCellUndo', 'Undo', () => reliefEditor.undo()), button('btnCellRedo', 'Redo', () => reliefEditor.redo()),
    button('btnCellRelax', 'Relax once', () => { void reliefEditor.relax().catch(report); }),
    button('btnCellApply', 'Apply layout', () => { void applyCellLayout(); }),
    button('btnCellDiscard', 'Discard layout', () => { reliefEditor.discardPending(); buildSidebar(); }));
  const selected = document.createElement('div'); selected.className = 'cell-coordinates';
  for (const axis of ['X', 'Y'] as const) {
    const label = document.createElement('label'); label.textContent = `${axis} in`;
    const input = document.createElement('input'); input.id = `cell${axis}`; input.type = 'number'; input.step = 'any'; input.min = '0';
    input.addEventListener('change', () => {
      const project = reliefEditor.view;
      if (!project || selectedCell === null) return;
      const i = project.sites.ids.indexOf(selectedCell), v = Number(input.value);
      try {
        if (!input.value.trim() || !Number.isFinite(v)) throw new Error('Enter a finite cell coordinate.'); reliefEditor.edit({kind: 'move', id: selectedCell, x: axis === 'X' ? v : project.sites.xy[i * 2], y: axis === 'Y' ? v : project.sites.xy[i * 2 + 1]}); }
      catch (error: unknown) { report(error); syncCellEditor(); }
    }); label.append(input); selected.append(label);
  }
  const pinLabel = document.createElement('label'); pinLabel.textContent = 'Pinned';
  const pin = document.createElement('input'); pin.type = 'checkbox'; pin.id = 'cellPinned';
  pin.addEventListener('change', () => { if (selectedCell !== null) reliefEditor.pin(selectedCell, pin.checked); }); pinLabel.append(pin); selected.append(pinLabel);
  const files = document.createElement('div'); files.className = 'cell-editor-actions';
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.mcproject'; input.id = 'cellProjectInput'; input.hidden = true;
  input.addEventListener('change', () => {
    const file = input.files?.[0]; input.value = ''; if (!file) return;
    const sourceIsCurrent = captureExportSource();
    void (async () => {
      if (!await reliefEditor.openFile(file, () => sourceIsCurrent() === null)) throw new Error('Project changed while opening the file. Current work was kept.');
      STATE.mode = 'noise'; STATE.noiseType = 'voronoi-relief'; restoreReliefDocument();
      document.body.className = 'mode-noise';
      document.querySelectorAll<HTMLElement>('.mode-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.mode === 'noise'));
      buildSidebar(); generateMesh();
    })().catch(report);
  });
  files.append(button('btnSaveProject', 'Save project', saveProject), button('btnOpenProject', 'Open project', () => input.click()), input);
  const scope = document.createElement('p'); scope.className = 'profile-note'; scope.textContent = 'Exact procedural relief only. Images, relief masters and Drape assets are not saved. Layout controls wait for Apply layout. Cell edits can change heights across the board. Plan keys: Page Up/Down selects, arrows move, Delete erases. Enter adds at the centre with Add selected.';
  const graph = document.createElement('p'); graph.id = 'cellGraphStatus'; graph.className = 'profile-note'; graph.setAttribute('role', 'status');
  body.append(status, controls, selected, files, scope, graph); section.append(header, body);
  requestAnimationFrame(syncCellEditor); return section;
}
function saveProject(): void {
  try {
    const save = reliefEditor.save();
    triggerDownload(new Blob([save.text], {type: 'application/json'}), `${STATE.filename}.mcproject`);
    reliefEditor.markSaved(save);
    if (reliefEditor.hasPending) showToast('Saved the applied relief. Pending layout changes are not in this file.', 6000);
  } catch (error: unknown) { report(error); }
}

export function syncCellEditor(): void {
  const project = reliefEditor.view, active = editorIsActive();
  if (active && project) {
    const settings = reliefEditor.pendingParams()!;
    for (const key of NOISE_SURFACE_KEYS) {
      if (key === 'reliefSites' || key === 'reliefRevision') continue;
      const control = document.getElementById(`sl_${key}`);
      const value = settings[key];
      if (control instanceof HTMLInputElement && control.type === 'range' && typeof value === 'number') syncRange(control, value, key === 'baseThickness' ? {min: Math.min(0.25, value)} : {});
      else if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = typeof value === 'boolean' ? value : Number(value) > 0.5;
      else if (control instanceof HTMLSelectElement) control.value = String(value);
    }
    const watertight = document.getElementById('chkWatertight') as HTMLInputElement | null; if (watertight) watertight.checked = settings.watertight;
    const seed = document.getElementById('seedInput') as HTMLInputElement | null; if (seed) seed.value = String(settings.seed);
    const algorithm = document.getElementById('selNoiseType') as HTMLSelectElement | null; if (algorithm) algorithm.value = settings.noiseType;
  }
  const status = document.getElementById('cellEditorStatus');
  if (status) status.textContent = reliefEditor.running ? 'Preparing cells in Worker. Current project kept until complete.' : project
    ? `${project.sites.ids.length} frozen cells. ${reliefEditor.dirty ? 'Unsaved changes.' : 'No unsaved source changes.'}${reliefEditor.hasPending ? ' Layout changes pending. Apply replaces cell positions.' : ''}`
    : 'Freeze the completed full-resolution cells to edit their positions.';
  for (const [id, disabled] of Object.entries({btnFreezeCells: active || reliefEditor.running, btnCellUndo: !active || !reliefEditor.canUndo,
    btnCellRedo: !active || !reliefEditor.canRedo, btnCellRelax: !active || reliefEditor.hasPending || reliefEditor.running,
    btnCellApply: !active || reliefEditor.running, btnCellDiscard: !active || !reliefEditor.hasPending, btnSaveProject: !active || reliefEditor.running})) {
    const button = document.getElementById(id) as HTMLButtonElement | null; if (button) button.disabled = disabled;
  }
  for (const tool of ['move', 'add', 'erase']) {
    const button = document.getElementById(`cellTool_${tool}`) as HTMLButtonElement | null;
    if (button) { button.disabled = !active; button.setAttribute('aria-pressed', String(cellTool === tool)); }
  }
  const i = project && selectedCell !== null ? project.sites.ids.indexOf(selectedCell) : -1;
  for (const [axis, offset] of [['X', 0], ['Y', 1]] as const) {
    const input = document.getElementById(`cell${axis}`) as HTMLInputElement | null;
    if (input) { input.disabled = !active || i < 0; input.max = String(axis === 'X' ? project?.params.meshX : project?.params.meshY); input.value = i < 0 ? '' : String(project!.sites.xy[i * 2 + offset]); }
  }
  const pin = document.getElementById('cellPinned') as HTMLInputElement | null;
  if (pin) { pin.disabled = !active || i < 0; pin.checked = i >= 0 && project!.sites.pinned[i] === 1; }
}
export function setupCellEditor(): void {
  if (ready) return; ready = true;
  reliefEditor.onChange = () => {
    if (!reliefEditor.gesturing) controlGesture = null;
    const project = reliefEditor.view;
    if (editorIsActive() && project) {
      const encoded = encodeReliefProject(project);
      if (encoded !== applied) {
        STATE.activePreset = null; STATE.activeProfile = null;
        const preset = document.getElementById('selPreset') as HTMLSelectElement | null; if (preset) preset.value = '';
        document.querySelector('.preset-pill.active[data-profile]')?.classList.remove('active');
        restoreReliefDocument();
        syncSbpSafeZIfStockMoved();
        if (reliefEditor.gesturing) {
          if (!generatingGesture) noiseGeneration.beginGesture();
          generatingGesture = true; debouncedGenerate('reliefRevision', 'preview');
        } else { generatingGesture = false; generateMesh(); }
      }
    }
    if (!reliefEditor.gesturing && generatingGesture) { generatingGesture = false; generateMesh(); }
    if (editorIsActive()) { syncDepthCaps(); syncReliefControls(); }
    syncCellEditor(); editorChanged();
  };
  noiseGeneration.subscribeFullRelief(source => {
    if (STATE.mode === 'noise' && STATE.reliefSites !== null && !reliefEditor.view) reliefEditor.freeze(source, true);
  });
  window.addEventListener('beforeunload', event => { if (reliefEditor.dirty || reliefEditor.hasPending) { event.preventDefault(); event.returnValue = ''; } });
}
