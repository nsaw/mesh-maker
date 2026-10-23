/**
 * DRAPE tab controller: the figure being draped (the bundled Venus de Milo bust or an upload), its
 * bare relief preview, and the cloth simulation run in a Worker (src/drape-sim/worker.ts) with the
 * settings of src/drape-controls.ts. Results become STATE.drapeMaster, an in-memory relief master, so
 * preview, stats, STL and SBP export all read the full-resolution heights through the same paths as an
 * imported .mcrelief. The carve (material thickness, relief depth, width) is applied when the master is
 * built, so changing it remaps the shown relief without simulating again.
 */
import { DEFAULTS, STATE, noiseDims } from './state';
import { generateMesh } from './mesh';
import { syncSbpSafeZIfStockMoved } from './sbp-export';
import { syncAspectLockButton } from './ui';
import { DRAPE_CARVE_PENDING, DRAPE_NO_RELIEF, drapeCarvePending, masterOffCarve } from './export-surface';
import { showToast } from './toast';
import { formatSliderValue } from './slider-utils';
import { triggerDownload } from './export';
import { encodeReliefMaster, parseReliefMaster, type ReliefMaster } from './relief-master';
import { encodeFigure, figureFromMesh, MAX_FIGURE_TRIANGLES, MAX_MCFIG_UPLOAD_TRIANGLES, parseFigure, poseFigure, type Figure, type FigurePose } from './drape-sim/figure';
import { bareDepth, FIGURE_FIT, reliefHeights } from './drape-sim/pipeline';
import { simplifyMesh } from './drape-sim/simplify';
import { isChunkLoadError, UPDATED_MESSAGE, updatedSinceLoad } from './stale-build';
import type { DrapeJob, DrapeWorkerMessage } from './drape-sim/messages';
import { drapeCarveFor, drapeJob, MAX_CLOTH_QUADS, remapToCarve, type DrapeCarve } from './drape-controls';
import type { BufferAttribute, BufferGeometry, Mesh, Object3D } from 'three';

export const DEMO_FIGURE_URL = '/demo/venus-de-milo.mcfig';
export const DEMO_FIGURE_NAME = 'Venus de Milo bust (demo, CC0)';
export const FIGURE_EXTENSIONS = ['.mcfig', '.stl', '.obj', '.ply', '.glb', '.gltf', '.usdz', '.usd', '.usda', '.usdc'];

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
/** The size controls as they were before the Drape tab took them over (its relief sets the board to
 *  STATE.drapeCarveWidth at 3:4 and the stock to STATE.drapeStock), and the camera, which the Drape tab points straight at
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
  return drapeJob(STATE, STATE.drapeWindMode).pose;
}

function poseText(p: FigurePose): string {
  const parts = [`tilt ${p.tiltDeg} deg`];
  if (p.turnDeg) parts.push(`turn ${p.turnDeg} deg`);
  if (p.leanDeg) parts.push(`lean ${p.leanDeg} deg`);
  if (p.scale !== undefined && p.scale !== 1) parts.push(`size ${Math.round(p.scale * 100)}%`);
  return parts.join(', ');
}

/** The carve the relief is cut to: STATE.drapeStock of material with STATE.drapeReliefDepth of relief,
 *  STATE.drapeCarveWidth wide (src/drape-controls.ts drapeCarveFor). */
export function drapeCarve(): DrapeCarve {
  return drapeCarveFor(STATE.drapeStock, STATE.drapeReliefDepth, STATE.drapeCarveWidth);
}

/** Point the size controls at the drape relief (its width, height and stock): the mesh preview reads them
 *  from the master, and the sliders must show the same numbers. */
function syncSizeControls(m: ReliefMaster): void {
  STATE.meshX = m.widthIn; STATE.meshY = m.heightIn; STATE.baseThickness = m.stockIn;
  STATE.depthMapAR = m.widthIn / m.heightIn; STATE.aspectLocked = true;
  for (const [key, v] of [['meshX', m.widthIn], ['meshY', m.heightIn], ['baseThickness', m.stockIn]] as const) {
    const sl = document.querySelector<HTMLInputElement>(`input[data-key="${key}"]`);
    if (sl) sl.value = String(v);
    const val = document.getElementById(`val_${key}`);
    if (val) val.textContent = key === 'baseThickness' ? v.toFixed(2) : formatSliderValue(v, sl ? parseFloat(sl.step) : 1);
  }
  syncAspectLockButton();
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
 *  remapped linearly onto the carve the controls show and cut at its size. Exported for cli/drape.spec.ts. */
export async function toMaster(r: NonNullable<typeof lastRelief>): Promise<ReliefMaster> {
  const IN = 0.0254, carve = drapeCarve(), heights = remapToCarve(r.heightsM, carve);
  const buf = await encodeReliefMaster({
    format: 'meshcraft-relief', version: 1, units: 'm', cols: 1201, rows: 1601,
    width: carve.widthIn * IN, height: carve.heightIn * IN, dtype: 'float32', rowOrder: 'top-down',
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
  const status = `${what} failed. Check the figure placement (up axis, turn) or try another pose.`;
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
          baseThickness: noiseDims.baseThickness, aspectLocked: false, depthMapAR: DEFAULTS.depthMapAR,
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
      // A retry after a failed fetch says it is loading again rather than keep the old error up.
      bareError = null;
      setStatus(drapeStatusText());
      try {
        const res = await fetch(DEMO_FIGURE_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (!figure) useFigure(parseFigure(buf), buf, DEMO_FIGURE_NAME);
      } catch (err) {
        demoLoading = null;
        bareError = `Could not load the demo figure. Upload a figure (${FIGURE_EXTENSIONS.join(', ')}).`;
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
    // A Worker that cannot load has no message: most often the site was deployed since this page opened.
    void updatedSinceLoad().then(updated => showToast(updated ? UPDATED_MESSAGE : `Drape worker error: ${err.message || 'the solver did not start'}`, 8000));
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
  if (!m) { showToast(DRAPE_NO_RELIEF, 6000); return; }
  if (drapeCarvePending()) { showToast(DRAPE_CARVE_PENDING, 6000); return; }
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

/** Upload a figure: .mcfig as is, or a mesh (STL, OBJ, PLY, glTF, USD) turned with the sidebar's up axis
 *  and turn and fitted to the panel (figureFromMesh). glTF and USD carry their own up axis. */
export async function loadFigureFile(file: File, placement: { up: 'z' | 'y'; turnDeg: number }): Promise<void> {
  const name = file.name, lower = name.toLowerCase(), seq = ++uploadSeq;
  let noTriangles = false, simplifiedFrom = 0;
  try {
    let fig: Figure | null = null, buf = await file.arrayBuffer();
    if (seq !== uploadSeq) return;                                  // a newer upload started meanwhile
    // A mesh to place (and maybe simplify), or a .mcfig already placed. A .mcfig over the drape's cap is
    // simplified in place, keeping its header (its anchor, head centre, name and licence).
    let mesh: { pos: Float32Array; tris: Uint32Array; up?: 'y' } | null = null, placed: Figure['header'] | null = null;
    if (lower.endsWith('.mcfig')) {
      const f = parseFigure(buf, MAX_MCFIG_UPLOAD_TRIANGLES);
      if (f.triangles.length / 3 <= MAX_FIGURE_TRIANGLES) fig = f;
      else { mesh = { pos: f.positions, tris: f.triangles }; placed = f.header; }
    } else {
      mesh = await meshFromFile(buf, lower);
      if (seq !== uploadSeq) return;
    }
    if (mesh) {
      buf = new ArrayBuffer(0);                                     // the file's bytes are in `mesh` now
      let { pos, tris } = mesh;
      const up = mesh.up;
      mesh = null;
      if (tris.length === 0) { noTriangles = true; throw new Error('it has no triangles (a point cloud cannot be draped)'); }
      if (tris.length / 3 > MAX_FIGURE_TRIANGLES) {
        // A dense scan or CAD export: cluster it under the cap rather than refuse it (about a second for
        // nine million triangles, on this thread; the message is painted first).
        simplifiedFrom = tris.length / 3;
        const msg = `Simplifying ${simplifiedFrom.toLocaleString()} triangles to under ${MAX_FIGURE_TRIANGLES.toLocaleString()} for the drape...`;
        setStatus(msg); showToast(msg, 6000);
        await new Promise(r => setTimeout(r, 50));
        if (seq !== uploadSeq) return;
        ({ pos, tris } = simplifyMesh({ pos, tris }, MAX_FIGURE_TRIANGLES));
      }
      buf = encodeFigure(placed
        ? { header: { ...placed, vertices: pos.length / 3, triangles: tris.length / 3 }, positions: pos, triangles: tris }
        : figureFromMesh(pos, tris, { up: up ?? placement.up, turnDeg: placement.turnDeg, name, fit: FIGURE_FIT }));
      fig = parseFigure(buf);
    }
    if (!fig) throw new Error('the file holds no figure');           // each branch above sets one
    // Build its bare relief before replacing the current figure, so a figure that cannot be shown
    // (wrong up axis, nothing in the panel, a header the relief master refuses) is refused and the
    // current one stays.
    const key = bareKey();
    const { relief, master } = await bareRelief(fig, currentPose(), name);
    if (seq !== uploadSeq) return;
    useFigure(fig, buf, name, { relief, master, key });
    if (simplifiedFrom) showToast(`${name}: simplified from ${simplifiedFrom.toLocaleString()} to ${fig.header.triangles.toLocaleString()} triangles for the drape.`, 5000);
  } catch (err) {
    if (seq !== uploadSeq) return;
    setStatus(drapeStatusText());                                   // a superseded upload may have left "Simplifying..."

    const why = err instanceof Error ? err.message : String(err);
    if (isChunkLoadError(err)) {
      // The reader for this file type is fetched on first use: updated site, or no connection.
      const updated = await updatedSinceLoad();
      if (seq !== uploadSeq) return;
      showToast(updated ? UPDATED_MESSAGE : `Could not load the reader for ${name}: check the connection and try again.`, 8000);
      return;
    }
    const hint = lower.endsWith('.mcfig') || noTriangles ? '' : '. Check the up axis.';
    showToast(`Could not use ${name} as a figure: ${why}${hint}`, 8000);
  }
}

/** The triangles of an uploaded mesh file, merged, in the file's own units. `up` is set for the formats
 *  that fix their up axis (glTF is Y-up by specification; three's USD loader turns a Z-up stage to Y-up),
 *  and left to the sidebar for the rest. A PLY point cloud has no faces and comes back with no triangles. */
export async function meshFromFile(buf: ArrayBuffer, lower: string): Promise<{ pos: Float32Array; tris: Uint32Array; up?: 'y' }> {
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
  /** Every mesh under `root`, in world space. */
  const sceneMeshes = (root: Object3D): BufferGeometry[] => {
    const geoms: BufferGeometry[] = [];
    root.updateMatrixWorld(true);
    root.traverse(o => { const m = o as Mesh; if (m.isMesh) geoms.push(m.geometry.clone().applyMatrix4(m.matrixWorld)); });
    return geoms;
  };
  if (lower.endsWith('.stl')) {
    // Binary STL read straight into positions: three's loader also builds per-vertex normals, a second
    // copy the size of the mesh (327 MB for a 9 M-triangle export), which the drape never uses.
    const soup = binaryStlSoup(buf);
    if (soup) return soup;
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
    return collect([new STLLoader().parse(buf)]);
  }
  if (lower.endsWith('.obj')) {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    return collect(sceneMeshes(new OBJLoader().parse(new TextDecoder().decode(buf))));
  }
  if (lower.endsWith('.ply')) {
    const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
    const g = new PLYLoader().parse(buf);
    // Without faces the loader returns bare vertices, which collect() would read as triangles.
    return g.index ? collect([g]) : { pos: new Float32Array(0), tris: new Uint32Array(0) };
  }
  if (/\.usd[acz]?$/.test(lower)) {
    const { USDLoader } = await import('three/examples/jsm/loaders/USDLoader.js');
    return { ...collect(sceneMeshes(new USDLoader().parse(buf))), up: 'y' };
  }
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  return { ...collect(sceneMeshes(gltf.scene)), up: 'y' };
}

/** A binary STL's triangles as an unwelded soup (three corners each), or null when the file is not a
 *  binary STL (its size is not 84 + 50 bytes per triangle, so it is ASCII). */
export function binaryStlSoup(buf: ArrayBuffer): { pos: Float32Array; tris: Uint32Array } | null {
  if (buf.byteLength < 84) return null;
  const view = new DataView(buf), n = view.getUint32(80, true);
  if (n === 0 || buf.byteLength !== 84 + n * 50) return null;
  const pos = new Float32Array(n * 9), tris = new Uint32Array(n * 3);
  for (let t = 0, o = 84; t < n; t++, o += 50) {
    for (let k = 0; k < 9; k++) pos[t * 9 + k] = view.getFloat32(o + 12 + k * 4, true);
    tris[t * 3] = t * 3; tris[t * 3 + 1] = t * 3 + 1; tris[t * 3 + 2] = t * 3 + 2;
  }
  return { pos, tris };
}
