/**
 * The DRAPE tab's controls: one table drives the sliders (src/ui.ts), the share-link clamps
 * (src/state.ts) and the conversion to the solver's parameters (src/drape-sim). DOM-free.
 *
 * Lengths a user sets on the cloth are life-size (the figure is placed at 1 scene unit = 1/8 m, so
 * 12.5 cm); positions on the carve are percentages of the panel, so they stay on the same spot of the
 * figure at every carve size.
 */
import { SILK, SILK_GATHERED, type ClothParams } from './drape-sim/cloth';
import type { FigurePose } from './drape-sim/figure';
import { PANEL_ASPECT, PANEL_WINDOW, RELIEF_BACKING_IN, RELIEF_SPAN_IN } from './drape-sim/pipeline';

/** Centimetres per scene unit (life size). */
export const CM_PER_UNIT = 12.5;
const PANEL_W = PANEL_WINDOW.x1 - PANEL_WINDOW.x0, PANEL_H = PANEL_WINDOW.zTop - PANEL_WINDOW.zBottom;

export type DrapeWindMode = 'off' | 'wind' | 'pressure';

/** Every numeric DRAPE control, as STATE keys. */
export interface DrapeSettings {
  drapeTilt: number; drapeTurn: number; drapeLean: number; drapeFigureScale: number;
  drapeClothWidth: number; drapeClothLength: number; drapeClothRes: number; drapeFrontShare: number; drapePinSize: number;
  drapeFabricThickness: number; drapeClearance: number; drapeBendStiffness: number; drapeDamping: number; drapeFrames: number;
  drapeAttract: number; drapeAttractReach: number; drapeAttractStart: number; drapeAttractFull: number;
  drapeWind: number; drapeWindFrom: number; drapeWindElevation: number;
  drapeWindX: number; drapeWindY: number; drapeWindRadius: number; drapeWindStart: number; drapeWindFull: number;
  drapeFaceAttract: number; drapeFaceReach: number; drapeFaceStart: number; drapeFaceFull: number;
  drapeFaceX: number; drapeFaceY: number; drapeFaceRadius: number; drapeFit: number;
  drapeSubsteps: number; drapeIterations: number; drapeSubdivisions: number;
  drapeReliefDepth: number;
}

export type DrapeKey = keyof DrapeSettings;
export type DrapeGroup = 'figure' | 'cloth' | 'attraction' | 'face' | 'wind' | 'solver' | 'carve';

export interface DrapeControl { key: DrapeKey; label: string; min: number; max: number; step: number; group: DrapeGroup }

/** Slider order within each group is the order here. */
export const DRAPE_CONTROLS: readonly DrapeControl[] = [
  { key: 'drapeTilt', label: 'Face Tilt (deg, + tips the face back)', min: -20, max: 60, step: 1, group: 'figure' },
  { key: 'drapeTurn', label: 'Turn (deg, + face toward your right)', min: -180, max: 180, step: 1, group: 'figure' },
  { key: 'drapeLean', label: 'Lean (deg, + crown toward your right)', min: -30, max: 30, step: 1, group: 'figure' },
  { key: 'drapeFigureScale', label: 'Figure Size (%, 100 = as loaded)', min: 25, max: 300, step: 1, group: 'figure' },
  { key: 'drapeClothWidth', label: 'Cloth Width (cm)', min: 25, max: 100, step: 0.5, group: 'cloth' },
  { key: 'drapeClothLength', label: 'Cloth Length, front to back (cm)', min: 40, max: 150, step: 0.5, group: 'cloth' },
  { key: 'drapeClothRes', label: 'Cloth Resolution (quads across)', min: 40, max: 200, step: 2, group: 'cloth' },
  { key: 'drapeFrontShare', label: 'Crown Attachment: Share in Front (%)', min: 20, max: 80, step: 1, group: 'cloth' },
  { key: 'drapePinSize', label: 'Crown Attachment: Size (cm)', min: 0.3, max: 10, step: 0.01, group: 'cloth' },
  { key: 'drapeFabricThickness', label: 'Fabric Thickness (mm)', min: 0, max: 5, step: 0.1, group: 'cloth' },
  { key: 'drapeClearance', label: 'Collision Clearance (mm)', min: 0.1, max: 5, step: 0.025, group: 'cloth' },
  { key: 'drapeBendStiffness', label: 'Bending Stiffness (0 to 4 = silk, no resistance; 8 = stiff)', min: 0, max: 8, step: 0.5, group: 'cloth' },
  { key: 'drapeDamping', label: 'Damping (air)', min: 0, max: 5, step: 0.1, group: 'cloth' },
  { key: 'drapeFrames', label: 'Simulation Length (frames, 24 fps)', min: 60, max: 240, step: 1, group: 'cloth' },
  { key: 'drapeAttract', label: 'Attraction Strength (0 = off)', min: 0, max: 3000, step: 50, group: 'attraction' },
  { key: 'drapeAttractReach', label: 'Attraction Reach (cm)', min: 1, max: 25, step: 0.5, group: 'attraction' },
  { key: 'drapeAttractStart', label: 'Attraction Starts (frame)', min: 1, max: 240, step: 1, group: 'attraction' },
  { key: 'drapeAttractFull', label: 'Attraction Full (frame)', min: 1, max: 240, step: 1, group: 'attraction' },
  { key: 'drapeFaceAttract', label: 'Local Attraction Strength (0 = off)', min: 0, max: 3000, step: 50, group: 'face' },
  { key: 'drapeFaceReach', label: 'Local Attraction Reach (cm)', min: 0.5, max: 25, step: 0.5, group: 'face' },
  { key: 'drapeFaceStart', label: 'Local Attraction Starts (frame)', min: 1, max: 240, step: 1, group: 'face' },
  { key: 'drapeFaceFull', label: 'Local Attraction Full (frame)', min: 1, max: 240, step: 1, group: 'face' },
  { key: 'drapeFit', label: 'Surface Fit after the solve (0 = off, 1 = onto the figure)', min: 0, max: 1, step: 0.05, group: 'face' },
  { key: 'drapeFaceX', label: 'Face Region X (% of the carve width, from left)', min: 0, max: 100, step: 0.1, group: 'face' },
  { key: 'drapeFaceY', label: 'Face Region Y (% of the carve height, from top)', min: 0, max: 100, step: 0.1, group: 'face' },
  { key: 'drapeFaceRadius', label: 'Face Region Radius (% of the carve width)', min: 2, max: 67, step: 0.1, group: 'face' },
  { key: 'drapeWind', label: 'Strength', min: 0, max: 3000, step: 50, group: 'wind' },
  { key: 'drapeWindFrom', label: 'Comes From (deg, 0 = you, 90 = your right)', min: -180, max: 180, step: 1, group: 'wind' },
  { key: 'drapeWindElevation', label: 'Comes From Above (deg)', min: -60, max: 60, step: 1, group: 'wind' },
  { key: 'drapeWindX', label: 'Target X (% of the carve width, from left)', min: 0, max: 100, step: 0.1, group: 'wind' },
  { key: 'drapeWindY', label: 'Target Y (% of the carve height, from top)', min: 0, max: 100, step: 0.1, group: 'wind' },
  { key: 'drapeWindRadius', label: 'Target Radius (% of the carve width)', min: 2, max: 67, step: 0.1, group: 'wind' },
  { key: 'drapeWindStart', label: 'Starts (frame)', min: 1, max: 240, step: 1, group: 'wind' },
  { key: 'drapeWindFull', label: 'Full (frame)', min: 1, max: 240, step: 1, group: 'wind' },
  { key: 'drapeSubsteps', label: 'Solver Steps per Frame (accuracy)', min: 2, max: 32, step: 1, group: 'solver' },
  { key: 'drapeIterations', label: 'Solver Iterations per Step (accuracy)', min: 2, max: 32, step: 1, group: 'solver' },
  { key: 'drapeSubdivisions', label: 'Display Subdivision (smoothing levels)', min: 0, max: 3, step: 1, group: 'solver' },
  { key: 'drapeReliefDepth', label: 'Relief Depth (in)', min: 0.05, max: 3.95, step: 0.005, group: 'carve' },
];

/** Most cloth quads the solver can hold: Jolt's fixed 128 MiB WASM heap ran 200 x 750 (150,000) and
 *  ran out at 200 x 900 (180,000) over the bundled bust (drape-run, 2026-10-21). A large uploaded figure
 *  takes some of that memory too; the Worker then reports the failure. */
export const MAX_CLOTH_QUADS = 150_000;

/** Thinnest backing left under the deepest point of the drape relief, inches. */
export const MIN_DRAPE_BACKING_IN = 0.05;
/** Material thickness range on the DRAPE tab, inches. */
export const DRAPE_STOCK_RANGE: readonly [number, number] = [0.25, 4];
/** Carve width range on the DRAPE tab, inches; the height is 4/3 of it, so 18 in wide is 24 in tall, the
 *  ShopBot bed's Y. */
export const DRAPE_WIDTH_RANGE: readonly [number, number] = [3, 18];
/** The carve width's grid, inches: 0.75 across is 1 in up at 3:4, so the X and Y sliders share it. */
export const DRAPE_WIDTH_STEP = 0.75;
/** A carve width on DRAPE_WIDTH_STEP within DRAPE_WIDTH_RANGE (the sliders and share links both use it). */
export function snapCarveWidth(w: number): number {
  return Math.min(DRAPE_WIDTH_RANGE[1], Math.max(DRAPE_WIDTH_RANGE[0], Math.round(w / DRAPE_WIDTH_STEP) * DRAPE_WIDTH_STEP));
}

export interface DrapeCarve { stockIn: number; depthIn: number; backingIn: number; widthIn: number; heightIn: number }

/** The carve for a material thickness, relief depth and width: thickness within DRAPE_STOCK_RANGE, depth
 *  capped so at least MIN_DRAPE_BACKING_IN of backing stays under the deepest point, width within
 *  DRAPE_WIDTH_RANGE at the panel's 3:4. */
export function drapeCarveFor(stockIn: number, depthIn: number, widthIn: number): DrapeCarve {
  const stock = Math.min(DRAPE_STOCK_RANGE[1], Math.max(DRAPE_STOCK_RANGE[0], stockIn));
  const depth = Math.min(stock - MIN_DRAPE_BACKING_IN, Math.max(0.01, depthIn));
  const width = Math.min(DRAPE_WIDTH_RANGE[1], Math.max(DRAPE_WIDTH_RANGE[0], widthIn));
  return { stockIn: stock, depthIn: depth, backingIn: stock - depth, widthIn: width, heightIn: width / PANEL_ASPECT };
}

/** Heights in metres from the pipeline's mapping (RELIEF_BACKING_IN backing + RELIEF_SPAN_IN relief),
 *  remapped linearly onto `c`: the deepest point lands on its backing, the frontmost on its stock top. */
export function remapToCarve(heightsM: Float32Array, c: DrapeCarve): Float32Array {
  const IN = 0.0254, b0 = RELIEF_BACKING_IN * IN, k = c.depthIn / RELIEF_SPAN_IN, b1 = c.backingIn * IN;
  const out = new Float32Array(heightsM.length);
  for (let i = 0; i < out.length; i++) out[i] = b1 + (heightsM[i] - b0) * k;
  return out;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
/** Scene x, z and length as percentages of the panel (from its left, from its top, of its width). */
const pctX = (x: number): number => r2(((x - PANEL_WINDOW.x0) / PANEL_W) * 100);
const pctY = (z: number): number => r2(((PANEL_WINDOW.zTop - z) / PANEL_H) * 100);
const pctW = (r: number): number => r2((r / PANEL_W) * 100);

/** Controls for a solver preset, in the units above. */
function settingsFrom(p: ClothParams, wind: Partial<DrapeSettings> = {}): DrapeSettings {
  return {
    drapeTilt: 25, drapeTurn: 0, drapeLean: 0, drapeFigureScale: 100,
    drapeClothWidth: p.sheetX * CM_PER_UNIT, drapeClothLength: p.sheetY * CM_PER_UNIT, drapeClothRes: p.cellsX,
    drapeFrontShare: p.frontShare * 100, drapePinSize: r2(p.pinRadius * CM_PER_UNIT),
    drapeFabricThickness: p.fabricThickness * CM_PER_UNIT * 10, drapeClearance: p.vertexRadius * CM_PER_UNIT * 10,
    drapeBendStiffness: Math.log10(SILK.bendCompliance / p.bendCompliance), drapeDamping: p.linearDamping, drapeFrames: p.frames,
    drapeAttract: p.attractStrength, drapeAttractReach: p.attractReach * CM_PER_UNIT,
    drapeAttractStart: p.attractStart, drapeAttractFull: p.attractFull,
    drapeWind: 250, drapeWindFrom: p.windAzimuth, drapeWindElevation: p.windElevation,
    drapeWindX: pctX(p.windX), drapeWindY: pctY(p.windZ), drapeWindRadius: pctW(p.windRadius), drapeWindStart: p.windStart, drapeWindFull: p.windFull,
    drapeFaceAttract: p.faceAttractStrength, drapeFaceReach: p.faceAttractReach * CM_PER_UNIT,
    drapeFaceStart: p.faceStart, drapeFaceFull: p.faceFull,
    drapeFaceX: pctX(p.faceX), drapeFaceY: pctY(p.faceZ), drapeFaceRadius: pctW(p.faceRadius), drapeFit: p.fitStrength,
    drapeSubsteps: p.substeps, drapeIterations: p.iterations, drapeSubdivisions: p.displaySubdivisions,
    drapeReliefDepth: 0.625,
    ...wind,
  };
}

export interface DrapePreset { label: string; settings: DrapeSettings; windMode: DrapeWindMode; about: string }

/** One-click setups. 'gathered' is the default. Applying one leaves the carve (Relief Depth) and the
 *  Figure Size alone (the preset buttons in src/ui.ts). */
export const DRAPE_PRESETS: Record<'gathered' | 'silk' | 'quartering', DrapePreset> = {
  gathered: { label: 'Gathered', settings: settingsFrom(SILK_GATHERED), windMode: 'off',
    about: 'The preferred Blender study: attraction toward the figure gathers the veil at the neck (frame 120).' },
  silk: { label: 'Silk', settings: settingsFrom(SILK), windMode: 'off',
    about: 'The original Blender proof: gravity only, read at frame 100.' },
  quartering: { label: 'Quartering wind', settings: settingsFrom(SILK_GATHERED), windMode: 'wind',
    about: 'Gathered, plus wind 250 from your front-right onto the left cheek, ramping in from frame 100 to 115 and holding.' },
};

/** The figure pose and solver parameters the controls describe. */
export function drapeJob(s: DrapeSettings, windMode: DrapeWindMode): { pose: FigurePose; params: ClothParams } {
  const sheetX = s.drapeClothWidth / CM_PER_UNIT, sheetY = s.drapeClothLength / CM_PER_UNIT;
  // Even quad counts keep a vertex on the crown (the sheet is centred on it across, and snapped along).
  const cellsX = Math.max(2, Math.round(s.drapeClothRes / 2) * 2);
  const cellsY = Math.max(2, Math.round((cellsX * sheetY) / sheetX / 2) * 2);
  // Mass per vertex follows the cell area, so the cloth weighs the same per area at any resolution.
  const cellArea = (sheetX / cellsX) * (sheetY / cellsY), silkArea = (SILK.sheetX / SILK.cellsX) * (SILK.sheetY / SILK.cellsY);
  const params: ClothParams = {
    ...SILK,
    sheetX, sheetY, cellsX, cellsY,
    frontShare: s.drapeFrontShare / 100, pinRadius: s.drapePinSize / CM_PER_UNIT,
    vertexMass: SILK.vertexMass * (cellArea / silkArea),
    vertexRadius: s.drapeClearance / (CM_PER_UNIT * 10), fabricThickness: s.drapeFabricThickness / (CM_PER_UNIT * 10),
    bendCompliance: SILK.bendCompliance / 10 ** s.drapeBendStiffness, linearDamping: s.drapeDamping, frames: Math.round(s.drapeFrames),
    attractStrength: s.drapeAttract, attractReach: s.drapeAttractReach / CM_PER_UNIT,
    attractStart: s.drapeAttractStart, attractFull: s.drapeAttractFull,
    windMode: windMode === 'wind' ? 1 : windMode === 'pressure' ? 2 : 0, windStrength: s.drapeWind,
    windAzimuth: s.drapeWindFrom, windElevation: s.drapeWindElevation,
    windX: PANEL_WINDOW.x0 + (s.drapeWindX / 100) * PANEL_W, windZ: PANEL_WINDOW.zTop - (s.drapeWindY / 100) * PANEL_H,
    windRadius: (s.drapeWindRadius / 100) * PANEL_W, windStart: s.drapeWindStart, windFull: s.drapeWindFull,
    faceAttractStrength: s.drapeFaceAttract, faceAttractReach: s.drapeFaceReach / CM_PER_UNIT,
    faceStart: s.drapeFaceStart, faceFull: s.drapeFaceFull,
    faceX: PANEL_WINDOW.x0 + (s.drapeFaceX / 100) * PANEL_W, faceZ: PANEL_WINDOW.zTop - (s.drapeFaceY / 100) * PANEL_H,
    faceRadius: (s.drapeFaceRadius / 100) * PANEL_W, fitStrength: s.drapeFit,
    substeps: Math.round(s.drapeSubsteps), iterations: Math.round(s.drapeIterations), displaySubdivisions: Math.round(s.drapeSubdivisions),
  };
  return { pose: { tiltDeg: s.drapeTilt, turnDeg: s.drapeTurn, leanDeg: s.drapeLean, scale: s.drapeFigureScale / 100 }, params };
}

/** Whether a DRAPE control changes the simulation (and so needs Generate), the figure placement
 *  (rebuilt at once), or only how the relief is carved (remapped at once); null for every other key.
 *  Material Thickness (baseThickness) is not one: it is shared with the other tabs, and the Drape tab
 *  handles it before asking (src/ui.ts). */
export function drapeControlEffect(key: string): 'pose' | 'carve' | 'cloth' | null {
  if (key === 'drapeTilt' || key === 'drapeTurn' || key === 'drapeLean' || key === 'drapeFigureScale') return 'pose';
  if (key === 'drapeReliefDepth') return 'carve';
  return DRAPE_CONTROLS.some(c => c.key === key) ? 'cloth' : null;
}
