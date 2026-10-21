/**
 * DRAPE tab controller: the figure being draped (the bundled Venus de Milo bust or an upload), its
 * bare relief preview, and the cloth simulation run in a Worker (src/drape-sim/worker.ts). Results
 * become STATE.drapeMaster, an in-memory relief master, so preview, stats, STL and SBP export all read
 * the full-resolution heights through the same paths as an imported .mcrelief.
 */
import { STATE } from './state';
import { generateMesh } from './mesh';
import { showToast } from './toast';
import { triggerDownload } from './export';
import { encodeReliefMaster, parseReliefMaster, type ReliefMaster } from './relief-master';
import { encodeFigure, figureFromMesh, MAX_FIGURE_TRIANGLES, parseFigure, tiltFigure, type Figure } from './drape-sim/figure';
import { bareDepth, PANEL_HEIGHT_IN, PANEL_WIDTH_IN, RELIEF_BACKING_IN, RELIEF_SPAN_IN, reliefHeights } from './drape-sim/pipeline';
import type { DrapeJob, DrapeWorkerMessage } from './drape-sim/messages';
import type { BufferAttribute, BufferGeometry, Mesh } from 'three';

export const DEMO_FIGURE_URL = '/demo/venus-de-milo.mcfig';
export const DEMO_FIGURE_NAME = 'Venus de Milo bust (demo, CC0)';
export const FIGURE_EXTENSIONS = ['.mcfig', '.stl', '.obj', '.glb', '.gltf'];

let figure: Figure | null = null;
let figureFile: ArrayBuffer | null = null;
/** Bumped whenever the figure or tilt changes; a result built from an older revision is discarded. */
let revision = 0;
let worker: Worker | null = null;
let demoLoading: Promise<void> | null = null;
/** Bumped by every upload; a read that finishes after a newer upload started is dropped. */
let uploadSeq = 0;
/** The size controls as they were before the Drape tab took them over (its relief fixes them to
 *  12 x 16 in and 0.75 in stock). Noise and Depth Map get them back on leaving, so a look at the Drape
 *  tab never changes the board another tab cuts. */
let sizeBeforeDrape: Pick<typeof STATE, 'meshX' | 'meshY' | 'baseThickness' | 'aspectLocked' | 'depthMapAR'> | null = null;
/** The tab the user came from (null when the page opened on DRAPE). */
let modeBeforeDrape: typeof STATE.mode | null = null;

/** Leaving DRAPE: restore the size controls and return the tab the user was on before it, so the
 *  caller can treat the switch as if the DRAPE visit never happened. */
export function restoreSizeAfterDrape(): typeof STATE.mode | null {
  if (sizeBeforeDrape) Object.assign(STATE, sizeBeforeDrape);
  sizeBeforeDrape = null;
  const from = modeBeforeDrape;
  modeBeforeDrape = null;
  return from;
}

/** Button state for a freshly built Drape section (the sidebar is rebuilt on mode switches, also while
 *  a drape runs). */
export function drapeControls(): { canGenerate: boolean; running: boolean } {
  return { canGenerate: worker === null && figure !== null, running: worker !== null };
}

function setStatus(text: string): void {
  const el = document.getElementById('drapeStatus');
  if (el) el.textContent = text;
}

function syncButtons(): void {
  const gen = document.getElementById('drapeGenerateBtn') as HTMLButtonElement | null;
  const cancel = document.getElementById('drapeCancelBtn') as HTMLButtonElement | null;
  if (gen) gen.disabled = worker !== null || figure === null;
  if (cancel) cancel.style.display = worker ? '' : 'none';
}

/** What the viewport shows, in words: the drape status line. */
export function drapeStatusText(): string {
  if (!figure) return 'Loading the figure...';
  if (worker) return 'Simulating the drape...';
  if (STATE.drapeMasterKind === 'draped') return `Draped at ${STATE.drapeMasterTilt} deg tilt. Exports use this drape at full resolution.`;
  return `Bare figure at ${STATE.drapeTilt} deg tilt. Press Generate Drape to simulate the veil (1-4 minutes in this tab).`;
}

/** Point the size controls at the drape relief (12 x 16 in, 0.75 in stock): the mesh preview reads
 *  them from the master, and the sliders must show the same numbers. */
function syncSizeControls(m: ReliefMaster): void {
  STATE.meshX = m.widthIn; STATE.meshY = m.heightIn; STATE.baseThickness = m.stockIn;
  STATE.depthMapAR = m.widthIn / m.heightIn; STATE.aspectLocked = true;
  for (const [key, v] of [['meshX', m.widthIn], ['meshY', m.heightIn], ['baseThickness', m.stockIn]] as const) {
    const sl = document.querySelector<HTMLInputElement>(`input[data-key="${key}"]`);
    if (sl) sl.value = String(v);
    const val = document.getElementById(`val_${key}`);
    if (val) val.textContent = key === 'baseThickness' ? v.toFixed(2) : String(Math.round(v * 100) / 100);
  }
}

/** Show a drape relief (bare or draped) in DRAPE mode. */
function present(m: ReliefMaster, kind: 'bare' | 'draped', tilt: number): void {
  STATE.drapeMaster = m; STATE.drapeMasterKind = kind; STATE.drapeMasterTilt = tilt;
  setStatus(drapeStatusText());
  if (STATE.mode !== 'drape') return;
  syncSizeControls(m);
  generateMesh();
}

async function toMaster(heightsM: Float32Array, mask: Uint8Array, name: string): Promise<ReliefMaster> {
  const IN = 0.0254;
  const buf = await encodeReliefMaster({
    format: 'meshcraft-relief', version: 1, units: 'm', cols: 1201, rows: 1601,
    width: PANEL_WIDTH_IN * IN, height: PANEL_HEIGHT_IN * IN, dtype: 'float32', rowOrder: 'top-down',
    heightOrigin: 'panel-back', backing: RELIEF_BACKING_IN * IN, stock: (RELIEF_BACKING_IN + RELIEF_SPAN_IN) * IN,
    triangulation: 'tr-bl', mask: true, name, source: figure?.header.source, license: figure?.header.license,
  }, heightsM, mask);
  return parseReliefMaster(buf);
}

/** A relief that could not be built: say so instead of leaving the last status line up. */
function reliefFailed(what: string, err: unknown): void {
  setStatus(`${what} failed. Check the figure placement (units, up axis) and try again.`);
  showToast(`${what} failed: ${err instanceof Error ? err.message : String(err)}`, 8000);
}

/** Rebuild the bare-figure relief at the current tilt and show it. */
async function showBare(): Promise<void> {
  if (!figure) return;
  const rev = revision, tilt = STATE.drapeTilt;
  try {
    const pos = tiltFigure(figure, tilt);
    const bare = bareDepth(pos, figure.triangles);
    const r = reliefHeights(bare, bare);
    const master = await toMaster(r.heightsM, r.mask, `${STATE.drapeFigureName}, bare, tilt ${tilt} deg`);
    if (rev !== revision) return;
    present(master, 'bare', tilt);
  } catch (err) {
    if (rev !== revision) return;
    // Nothing valid to show at this figure and tilt: clear the old relief so nothing exports it.
    STATE.drapeMaster = null; STATE.drapeMasterKind = null;
    if (STATE.mode === 'drape') generateMesh();
    reliefFailed('The bare figure relief', err);
  }
}

function useFigure(fig: Figure, file: ArrayBuffer, name: string): void {
  cancelDrape(false);
  revision++;
  figure = fig; figureFile = file; STATE.drapeFigureName = name;
  // The previous figure's relief must not stay exportable under the new name while (or if) the new
  // one is built.
  STATE.drapeMaster = null; STATE.drapeMasterKind = null;
  if (STATE.mode === 'drape') generateMesh();
  const label = document.querySelector('#drapeZone .upload-text');
  if (label) label.textContent = name;
  syncButtons();
  void showBare();
}

/** Entering DRAPE mode: remember the other tabs' size controls, then show the figure (loading the
 *  bundled bust once). */
export function ensureDrapeFigure(fromMode: typeof STATE.mode | null = null): Promise<void> {
  if (!sizeBeforeDrape) {
    const { meshX, meshY, baseThickness, aspectLocked, depthMapAR } = STATE;
    sizeBeforeDrape = { meshX, meshY, baseThickness, aspectLocked, depthMapAR };
    modeBeforeDrape = fromMode;
  }
  if (figure) {
    if (STATE.drapeMaster) syncSizeControls(STATE.drapeMaster); else void showBare();
    return Promise.resolve();
  }
  if (!demoLoading) {
    demoLoading = (async () => {
      try {
        const res = await fetch(DEMO_FIGURE_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (!figure) useFigure(parseFigure(buf), buf, DEMO_FIGURE_NAME);
      } catch (err) {
        demoLoading = null;
        setStatus('Could not load the demo figure. Upload a figure (.mcfig, .stl, .obj, .glb).');
        showToast(`Could not load the demo figure: ${err instanceof Error ? err.message : String(err)}`, 6000);
      }
    })();
  }
  return demoLoading;
}

/** Tilt slider moved: drop a drape made at another tilt and show the bare figure at the new one. */
let tiltTimer: ReturnType<typeof setTimeout> | null = null;
export function onDrapeTiltChanged(): void {
  if (worker) { cancelDrape(false); showToast('Drape cancelled: the tilt changed. Generate again at the new tilt.', 4000); }
  revision++;
  setStatus(drapeStatusText());
  if (tiltTimer) clearTimeout(tiltTimer);
  tiltTimer = setTimeout(() => { void showBare(); }, 120);
}

export function generateDrape(): void {
  if (!figure || !figureFile || worker) return;
  const rev = revision, tilt = STATE.drapeTilt, name = STATE.drapeFigureName;
  const w = new Worker(new URL('./drape-sim/worker.ts', import.meta.url), { type: 'module' });
  worker = w; syncButtons();
  const t0 = performance.now();
  setStatus('Starting the cloth simulation...');
  w.onmessage = (e: MessageEvent<DrapeWorkerMessage>) => {
    const m = e.data;
    if (worker !== w) return;
    if (m.type === 'progress') {
      const pct = Math.round((m.frame / m.frames) * 100);
      setStatus(`Simulating the drape: frame ${m.frame} of ${m.frames} (${pct}%), ${((performance.now() - t0) / 1000).toFixed(0)} s`);
      return;
    }
    w.terminate(); worker = null; syncButtons();
    if (m.type === 'error') { setStatus(drapeStatusText()); showToast(`Drape failed: ${m.message}`, 8000); return; }
    void (async () => {
      try {
        const master = await toMaster(m.heightsM, m.mask, `${name}, silk drape, tilt ${tilt} deg`);
        if (rev !== revision) return;                               // the figure or tilt changed meanwhile
        present(master, 'draped', tilt);
        showToast(`Drape done in ${m.seconds.toFixed(0)} s`, 3000);
      } catch (err) {
        if (rev === revision) reliefFailed('The drape relief', err);
      }
    })();
  };
  w.onerror = (err) => {
    if (worker !== w) return;
    w.terminate(); worker = null; syncButtons(); setStatus(drapeStatusText());
    showToast(`Drape worker error: ${err.message}`, 8000);
  };
  // The Worker gets its own copy: the figure stays loaded for the next run.
  const job: DrapeJob = { type: 'drape', figure: figureFile.slice(0), tiltDeg: tilt };
  w.postMessage(job, [job.figure]);
}

export function cancelDrape(announce = true): void {
  if (!worker) return;
  worker.terminate(); worker = null; syncButtons();
  setStatus(drapeStatusText());
  if (announce) showToast('Drape cancelled', 2000);
}

/** Download the relief DRAPE mode shows, as a .mcrelief (opens in the Depth Map tab or the CLI). */
export async function downloadDrapeRelief(): Promise<void> {
  const m = STATE.drapeMaster;
  if (!m) return;
  const heights = new Float32Array(m.cols * m.rows);
  // Back to the file layout: metres, rows top-down (MeshCraft's grid has row 0 at the bottom).
  for (let j = 0; j < m.rows; j++) for (let i = 0; i < m.cols; i++)
    heights[(m.rows - 1 - j) * m.cols + i] = m.heightsIn[j * m.cols + i] * 0.0254;
  const mask = new Uint8Array(m.cols * m.rows);
  if (m.mask) for (let j = 0; j < m.rows; j++) for (let i = 0; i < m.cols; i++) mask[(m.rows - 1 - j) * m.cols + i] = m.mask[j * m.cols + i];
  const buf = await encodeReliefMaster({ ...m.header, units: 'm', dtype: 'float32', rowOrder: 'top-down',
    width: m.widthIn * 0.0254, height: m.heightIn * 0.0254, backing: m.backingIn * 0.0254, stock: m.stockIn * 0.0254 }, heights, m.mask ? mask : undefined);
  triggerDownload(new Blob([buf], { type: 'application/octet-stream' }), `${STATE.filename || 'drape'}.mcrelief`);
}

/** Upload a figure: .mcfig as is, or an STL / OBJ / glTF mesh placed with the sidebar's units, up axis
 *  and turn. */
export async function loadFigureFile(file: File, placement: { metresPerUnit: number; up: 'z' | 'y'; turnDeg: number }): Promise<void> {
  const name = file.name, lower = name.toLowerCase(), seq = ++uploadSeq;
  try {
    let fig: Figure, buf = await file.arrayBuffer();
    if (seq !== uploadSeq) return;                                  // a newer upload started meanwhile
    if (lower.endsWith('.mcfig')) fig = parseFigure(buf);
    else {
      const { pos, tris } = await meshFromFile(buf, lower);
      if (seq !== uploadSeq) return;
      if (tris.length / 3 > MAX_FIGURE_TRIANGLES) throw new Error(`${(tris.length / 3).toLocaleString()} triangles; decimate below ${MAX_FIGURE_TRIANGLES.toLocaleString()}`);
      buf = encodeFigure(figureFromMesh(pos, tris, { ...placement, name }));
      fig = parseFigure(buf);
    }
    // Build its bare relief before replacing the current figure, so a figure that cannot be shown
    // (wrong units, nothing in the panel) is refused and the current one stays.
    const bare = bareDepth(tiltFigure(fig, STATE.drapeTilt), fig.triangles);
    reliefHeights(bare, bare);
    useFigure(fig, buf, name);
  } catch (err) {
    if (seq !== uploadSeq) return;
    showToast(`Could not use ${name} as a figure: ${err instanceof Error ? err.message : String(err)}. Check the units and up axis.`, 8000);
  }
}

async function meshFromFile(buf: ArrayBuffer, lower: string): Promise<{ pos: Float32Array; tris: Uint32Array }> {
  const collect = (geoms: BufferGeometry[]): { pos: Float32Array; tris: Uint32Array } => {
    let nv = 0, nt = 0;
    for (const g of geoms) { nv += g.getAttribute('position').count; nt += g.index ? g.index.count : g.getAttribute('position').count; }
    const pos = new Float32Array(nv * 3), tris = new Uint32Array(nt); let ov = 0, ot = 0;
    for (const g of geoms) {
      const p = g.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < p.count; i++) { pos[(ov + i) * 3] = p.getX(i); pos[(ov + i) * 3 + 1] = p.getY(i); pos[(ov + i) * 3 + 2] = p.getZ(i); }
      if (g.index) for (let i = 0; i < g.index.count; i++) tris[ot++] = ov + g.index.getX(i);
      else for (let i = 0; i < p.count; i++) tris[ot++] = ov + i;
      ov += p.count;
    }
    return { pos, tris };
  };
  if (lower.endsWith('.stl')) {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
    return collect([new STLLoader().parse(buf)]);
  }
  if (lower.endsWith('.obj')) {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    const root = new OBJLoader().parse(new TextDecoder().decode(buf));
    const geoms: BufferGeometry[] = [];
    root.updateMatrixWorld(true);
    root.traverse(o => { const m = o as Mesh; if (m.isMesh) geoms.push(m.geometry.clone().applyMatrix4(m.matrixWorld)); });
    return collect(geoms);
  }
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  const geoms: BufferGeometry[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => { const m = o as Mesh; if (m.isMesh) geoms.push(m.geometry.clone().applyMatrix4(m.matrixWorld)); });
  return collect(geoms);
}
