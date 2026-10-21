/**
 * DRAPE tab controller: the figure being draped (the bundled Venus de Milo bust or an upload), its
 * bare relief preview, and the cloth simulation run in a Worker (src/drape-sim/worker.ts) with the
 * settings of src/drape-controls.ts. Results become STATE.drapeMaster, an in-memory relief master, so
 * preview, stats, STL and SBP export all read the full-resolution heights through the same paths as an
 * imported .mcrelief. The carve (material thickness, relief depth) is applied when the master is built,
 * so changing it remaps the shown relief without simulating again.
 */
import { DEFAULTS, STATE, noiseDims } from './state';
import { generateMesh } from './mesh';
import { syncSbpSafeZIfStockMoved } from './sbp-export';
import { drapeCarvePending, masterOffCarve } from './export-surface';
import { showToast } from './toast';
import { triggerDownload } from './export';
import { encodeReliefMaster, parseReliefMaster, type ReliefMaster } from './relief-master';
import { encodeFigure, figureFromMesh, MAX_FIGURE_TRIANGLES, parseFigure, poseFigure, type Figure, type FigurePose } from './drape-sim/figure';
import { bareDepth, PANEL_HEIGHT_IN, PANEL_WIDTH_IN, reliefHeights } from './drape-sim/pipeline';
import type { DrapeJob, DrapeWorkerMessage } from './drape-sim/messages';
import { drapeCarveFor, drapeJob, MAX_CLOTH_QUADS, remapToCarve, type DrapeCarve } from './drape-controls';
import type { BufferAttribute, BufferGeometry, Mesh } from 'three';

export const DEMO_FIGURE_URL = '/demo/venus-de-milo.mcfig';
export const DEMO_FIGURE_NAME = 'Venus de Milo bust (demo, CC0)';
export const FIGURE_EXTENSIONS = ['.mcfig', '.stl', '.obj', '.glb', '.gltf'];

let figure: Figure | null = null;
let figureFile: ArrayBuffer | null = null;
/** Bumped whenever the figure or pose changes; a result built from an older revision is discarded. */
let revision = 0;
let worker: Worker | null = null;
/** Why there is nothing to show (no demo figure, or no relief for this figure in this pose): the
 *  status line a rebuilt sidebar shows, or null. */
let bareError: string | null = null;
let demoLoading: Promise<void> | null = null;
/** Bumped by every upload; a read that finishes after a newer upload started is dropped. */
let uploadSeq = 0;
/** The size controls as they were before the Drape tab took them over (its relief fixes the board at
 *  12 x 16 in and the stock at STATE.drapeStock), and the camera, which the Drape tab points straight at
 *  the carve. Noise and Depth Map get them back on leaving, so a look at the Drape tab never changes the
 *  board another tab cuts or the view it had. */
let sizeBeforeDrape: Pick<typeof STATE, 'meshX' | 'meshY' | 'resolution' | 'baseThickness' | 'aspectLocked' | 'depthMapAR'
  | 'orbit' | 'tilt' | 'roll' | 'zoom' | 'panX' | 'panY'> | null = null;
/** The relief last built (bare or draped) in the standard mapping (RELIEF_BACKING_IN + RELIEF_SPAN_IN),
 *  kept so a carve change can remap it. */
let lastRelief: { heightsM: Float32Array; mask: Uint8Array; name: string; fig: Figure; kind: 'bare' | 'draped'; label: string; jobKey?: string } | null = null;

/** The solver settings the controls describe now (the pose and carve are not in it: a pose change
 *  discards the drape, a carve change remaps it). A shown drape made with another key is out of date. */
function currentJobKey(): string {
  return JSON.stringify(drapeJob(STATE, STATE.drapeWindMode).params);
}
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
  if (!figure) return bareError ?? 'Loading the figure...';
  if (worker) return 'Simulating the drape...';
  if (bareError && !STATE.drapeMaster) return bareError;
  if (STATE.drapeMasterKind === 'draped') {
    return `Draped (${STATE.drapeMasterLabel}). Exports use this drape at full resolution.`
      + (lastRelief?.jobKey !== undefined && lastRelief.jobKey !== currentJobKey() ? ' Cloth or force settings changed since: Generate Drape again to apply them.' : '');
  }
  return `Bare figure (${poseText(currentPose())}). Press Generate Drape to simulate the veil (1-4 minutes in this tab; longer at a higher cloth resolution).`;
}

function currentPose(): FigurePose {
  return { tiltDeg: STATE.drapeTilt, turnDeg: STATE.drapeTurn, leanDeg: STATE.drapeLean };
}

function poseText(p: FigurePose): string {
  const parts = [`tilt ${p.tiltDeg} deg`];
  if (p.turnDeg) parts.push(`turn ${p.turnDeg} deg`);
  if (p.leanDeg) parts.push(`lean ${p.leanDeg} deg`);
  return parts.join(', ');
}

/** The carve the relief is cut to: STATE.drapeStock of material with STATE.drapeReliefDepth of relief
 *  (src/drape-controls.ts drapeCarveFor). */
export function drapeCarve(): DrapeCarve {
  return drapeCarveFor(STATE.drapeStock, STATE.drapeReliefDepth);
}

/** Point the size controls at the drape relief (12 x 16 in, its stock): the mesh preview reads them
 *  from the master, and the sliders must show the same numbers. */
function syncSizeControls(m: ReliefMaster): void {
  STATE.meshX = m.widthIn; STATE.meshY = m.heightIn; STATE.baseThickness = m.stockIn;
  STATE.depthMapAR = m.widthIn / m.heightIn; STATE.aspectLocked = true;
  for (const [key, v] of [['meshX', m.widthIn], ['meshY', m.heightIn], ['baseThickness', m.stockIn]] as const) {
    const sl = document.querySelector<HTMLInputElement>(`input[data-key="${key}"]`);
    if (sl) sl.value = String(v);
    const val = document.getElementById(`val_${key}`);
    if (val) val.textContent = key === 'baseThickness' ? v.toFixed(2) : String(Math.round(v * 100) / 100);
  }
  // Safe Z follows the stock top when it moves; a new drape on the same stock keeps the user's Safe Z.
  syncSbpSafeZIfStockMoved();
}

/** Show a drape relief (bare or draped) in DRAPE mode. */
function present(m: ReliefMaster, kind: 'bare' | 'draped', label: string): void {
  bareError = null;
  STATE.drapeMaster = m; STATE.drapeMasterKind = kind; STATE.drapeMasterLabel = label;
  // A carve change made while this master was being built: remap it to the carve the controls show.
  if (masterOffCarve(m)) onDrapeCarveChanged();
  setStatus(drapeStatusText());
  if (STATE.mode !== 'drape') return;
  syncSizeControls(m);
  generateMesh();
}

/** The relief master of `r` (heights in the standard RELIEF_BACKING_IN + RELIEF_SPAN_IN mapping),
 *  remapped linearly onto the current carve. */
async function toMaster(r: NonNullable<typeof lastRelief>): Promise<ReliefMaster> {
  const IN = 0.0254, carve = drapeCarve(), heights = remapToCarve(r.heightsM, carve);
  const buf = await encodeReliefMaster({
    format: 'meshcraft-relief', version: 1, units: 'm', cols: 1201, rows: 1601,
    width: PANEL_WIDTH_IN * IN, height: PANEL_HEIGHT_IN * IN, dtype: 'float32', rowOrder: 'top-down',
    heightOrigin: 'panel-back', backing: carve.backingIn * IN, stock: carve.stockIn * IN,
    triangulation: 'tr-bl', mask: true, name: r.name, source: r.fig.header.source, license: r.fig.header.license,
  }, heights, r.mask);
  return parseReliefMaster(buf);
}

/** Build and show the master of `r` (the last relief, unless a newer one replaced it meanwhile). */
async function showRelief(r: NonNullable<typeof lastRelief>, rev: number): Promise<void> {
  const master = await toMaster(r);
  if (rev !== revision || lastRelief !== r) return;
  present(master, r.kind, r.label);
}

/** A relief that could not be built: say so instead of leaving the last status line up. Returns the
 *  status line. */
function reliefFailed(what: string, err: unknown): string {
  const status = `${what} failed. Check the figure placement (units, up axis) or try another pose.`;
  setStatus(status);
  showToast(`${what} failed: ${err instanceof Error ? err.message : String(err)}`, 8000);
  return status;
}

/** The bare-figure relief of `fig` in `pose`, and its master, as the viewport and exports read it. */
async function bareRelief(fig: Figure, pose: FigurePose, name: string): Promise<{ relief: NonNullable<typeof lastRelief>; master: ReliefMaster }> {
  const bare = bareDepth(poseFigure(fig, pose), fig.triangles);
  const r = reliefHeights(bare, bare), label = poseText(pose);
  const relief = { heightsM: r.heightsM, mask: r.mask, name: `${name}, bare, ${label}`, fig, kind: 'bare' as const, label };
  return { relief, master: await toMaster(relief) };
}

/** Rebuild the bare-figure relief in the current pose and show it. */
async function showBare(): Promise<void> {
  if (!figure) return;
  const rev = revision;
  try {
    const { relief, master } = await bareRelief(figure, currentPose(), STATE.drapeFigureName);
    if (rev !== revision) return;
    lastRelief = relief;
    present(master, 'bare', relief.label);
  } catch (err) {
    if (rev !== revision) return;
    // Nothing valid to show for this figure and pose: clear the old relief so nothing exports it.
    STATE.drapeMaster = null; STATE.drapeMasterKind = null; lastRelief = null;
    if (STATE.mode === 'drape') generateMesh();
    bareError = reliefFailed('The bare figure relief', err);
  }
}

/** Make `fig` the draped figure. `bare` is its bare relief when the caller already built it (an
 *  upload is built before it replaces anything), used if the pose and carve have not moved since. */
function useFigure(fig: Figure, file: ArrayBuffer, name: string,
  bare?: { relief: NonNullable<typeof lastRelief>; master: ReliefMaster; key: string }): void {
  cancelDrape(false);
  revision++;
  figure = fig; figureFile = file; STATE.drapeFigureName = name; bareError = null;
  // The previous figure's relief must not stay exportable under the new name while (or if) the new
  // one is built.
  STATE.drapeMaster = null; STATE.drapeMasterKind = null; lastRelief = null;
  const label = document.querySelector('#drapeZone .upload-text');
  if (label) label.textContent = name;
  syncButtons();
  if (bare && bare.key === bareKey()) { lastRelief = bare.relief; present(bare.master, 'bare', bare.relief.label); return; }
  if (STATE.mode === 'drape') generateMesh();
  void showBare();
}

/** Entering DRAPE mode: remember the other tabs' size controls, then show the figure (loading the
 *  bundled bust once). */
export function ensureDrapeFigure(fromMode: typeof STATE.mode | null = null): Promise<void> {
  if (!sizeBeforeDrape) {
    const { meshX, meshY, resolution, baseThickness, aspectLocked, depthMapAR, orbit, tilt, roll, zoom, panX, panY } = STATE;
    const view = { orbit, tilt, roll, zoom, panX, panY };
    // A page opened on DRAPE has only the drape relief's own sizes (a DRAPE share link carries them):
    // hand the other tabs NOISE's defaults instead, as if the user had come from NOISE.
    sizeBeforeDrape = fromMode
      ? { meshX, meshY, resolution, baseThickness, aspectLocked, depthMapAR, ...view }
      : { meshX: noiseDims.meshX, meshY: noiseDims.meshY, resolution: noiseDims.resolution,
          baseThickness: DEFAULTS.baseThickness, aspectLocked: false, depthMapAR: DEFAULTS.depthMapAR,
          orbit: DEFAULTS.orbit, tilt: DEFAULTS.tilt, roll: DEFAULTS.roll, zoom: DEFAULTS.zoom, panX: DEFAULTS.panX, panY: DEFAULTS.panY };
    modeBeforeDrape = fromMode;
    setDrapeFrontView();
  }
  if (figure) {
    if (STATE.drapeMaster) syncSizeControls(STATE.drapeMaster); else void showBare();
    return Promise.resolve();
  }
  if (!demoLoading) {
    demoLoading = (async () => {
      bareError = null;
      try {
        const res = await fetch(DEMO_FIGURE_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (!figure) useFigure(parseFigure(buf), buf, DEMO_FIGURE_NAME);
      } catch (err) {
        demoLoading = null;
        bareError = 'Could not load the demo figure. Upload a figure (.mcfig, .stl, .obj, .glb).';
        setStatus(bareError);
        showToast(`Could not load the demo figure: ${err instanceof Error ? err.message : String(err)}`, 6000);
      }
    })();
  }
  return demoLoading;
}

/** Point the camera straight at the carve: looking down onto the panel, its top edge up on screen. */
export function setDrapeFrontView(): void {
  STATE.orbit = 270; STATE.tilt = -90; STATE.roll = 0; STATE.zoom = 1; STATE.panX = 0; STATE.panY = 0;
}

/** Pose slider moved (or a preset applied): drop the drape and show the bare figure in the current pose. */
let poseTimer: ReturnType<typeof setTimeout> | null = null;
export function onDrapePoseChanged(why = 'the figure pose changed'): void {
  if (worker) { cancelDrape(false); showToast(`Drape cancelled: ${why}. Generate again.`, 4000); }
  revision++;
  setStatus(drapeStatusText());
  if (poseTimer) clearTimeout(poseTimer);
  poseTimer = setTimeout(() => { void showBare(); }, 120);
}

/** A cloth or force control moved: the shown drape stays (and stays exportable) but is marked as made
 *  with earlier settings. */
export function onDrapeClothChanged(): void {
  setStatus(drapeStatusText());
}

/** Material thickness or relief depth moved: remap the shown relief, no new simulation. */
let carveTimer: ReturnType<typeof setTimeout> | null = null;
export function onDrapeCarveChanged(): void {
  if (carveTimer) clearTimeout(carveTimer);
  carveTimer = setTimeout(() => {
    const r = lastRelief;
    if (!r) return;
    const rev = revision;
    showRelief(r, rev).catch(err => { if (rev === revision) reliefFailed('The relief', err); });
  }, 150);
}

/** What makes a prebuilt bare relief current: the pose and the carve it was built for. */
function bareKey(): string {
  return JSON.stringify([currentPose(), drapeCarve()]);
}

export function generateDrape(): void {
  if (!figure || !figureFile || worker) return;
  const rev = revision, name = STATE.drapeFigureName, fig = figure;
  const { pose, params } = drapeJob(STATE, STATE.drapeWindMode), jobKey = JSON.stringify(params);
  if (params.cellsX * params.cellsY > MAX_CLOTH_QUADS) {
    showToast(`The cloth is ${params.cellsX} x ${params.cellsY} quads, over the ${MAX_CLOTH_QUADS.toLocaleString()} the solver has memory for. Lower Cloth Resolution or the cloth size.`, 8000);
    return;
  }
  const extras = [params.faceAttractStrength > 0 ? 'local attraction' : '', params.fitStrength > 0 ? 'surface fit' : '',
    params.windMode === 1 ? 'wind' : params.windMode === 2 ? 'pressure' : ''].filter(Boolean);
  const label = [poseText(pose), params.attractStrength > 0 ? 'gathered' : 'silk', ...extras, `frame ${params.frames}`].join(', ');
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
        const relief = { heightsM: m.heightsM, mask: m.mask, name: `${name}, silk drape, ${label}`, fig, kind: 'draped' as const, label, jobKey };
        const master = await toMaster(relief);
        if (rev !== revision) return;                               // the figure or pose changed meanwhile
        lastRelief = relief;
        present(master, 'draped', label);
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
  const job: DrapeJob = { type: 'drape', figure: figureFile.slice(0), pose, params };
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
  if (drapeCarvePending()) { showToast('The drape relief is still being remapped to the new carve: download again in a moment.', 4000); return; }
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
    // (wrong units, nothing in the panel, a header the relief master refuses) is refused and the
    // current one stays.
    const key = bareKey();
    const { relief, master } = await bareRelief(fig, currentPose(), name);
    if (seq !== uploadSeq) return;
    useFigure(fig, buf, name, { relief, master, key });
  } catch (err) {
    if (seq !== uploadSeq) return;
    const hint = lower.endsWith('.mcfig') ? '' : '. Check the units and up axis.';
    showToast(`Could not use ${name} as a figure: ${err instanceof Error ? err.message : String(err)}${hint}`, 8000);
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
