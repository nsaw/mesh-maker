import { STATE, activeMaster } from './state';
import { drapeCarveFor } from './drape-controls';
import { MIN_WATERTIGHT_THICKNESS } from './geometry';
import type { ExportSurface } from './mesh-writer';
import type { ReliefMaster } from './relief-master';
import type { Heightmap } from './sbp/types';

/** The surface every export and toolpath is built from. With a relief master active it is the
 *  master's full-resolution heights and fixed triangulation, never the viewport preview; otherwise
 *  the generated grid. Returns a reason string when there is nothing exportable. `forToolpath`
 *  skips the watertight-only checks. */
export function getExportSurface(forToolpath = false): ExportSurface | string {
  const m = activeMaster();
  if (drapeCarvePending()) return 'The drape relief is still being remapped to the new Material Thickness or Relief Depth: export again in a moment.';
  // Toolpaths cut the top surface only, so the watertight enclosure's floor rule does not apply.
  if (m) return reliefMasterSurface(m, forToolpath ? false : STATE.watertight);
  const { vertices, cols, rows, meshX, meshY } = STATE;
  if (!vertices) return 'Generate a mesh first';
  if (cols < 2 || rows < 2) return 'Mesh too small to export (need at least 2\u00d72 grid)';
  const z = new Float64Array(rows * cols);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) z[j * cols + i] = vertices[j][i];
  return { z, cols, rows, meshX, meshY, diagonal: 'shortest', watertight: STATE.watertight };
}

/** True when relief master `m` was not cut to the drape carve the controls show (STATE.drapeStock and
 *  STATE.drapeReliefDepth), within 1e-6 in. */
export function masterOffCarve(m: ReliefMaster): boolean {
  const c = drapeCarveFor(STATE.drapeStock, STATE.drapeReliefDepth);
  return Math.abs(m.stockIn - c.stockIn) > 1e-6 || Math.abs(m.backingIn - c.backingIn) > 1e-6;
}

/** On the DRAPE tab, Material Thickness and Relief Depth are applied by rebuilding the relief master,
 *  debounced. Until that lands (or if it fails) the master's stock top and heights are not the ones
 *  the controls show, so every export refuses rather than pair one with the other. */
export function drapeCarvePending(): boolean {
  return STATE.mode === 'drape' && STATE.drapeMaster !== null && masterOffCarve(STATE.drapeMaster);
}

/** A relief master's export surface: its own heights, extents and triangulation, unchanged. Shared
 *  by the browser export and cli/relief-roundtrip.ts. */
export function reliefMasterSurface(m: ReliefMaster, watertight: boolean): ExportSurface | string {
  if (watertight) {
    let lo = Infinity;
    for (let k = 0; k < m.heightsIn.length; k++) if (m.heightsIn[k] < lo) lo = m.heightsIn[k];
    // Raising those cells to the floor would change the master; refuse instead.
    if (lo < MIN_WATERTIGHT_THICKNESS)
      return `Relief master dips to ${lo.toFixed(4)}" (watertight needs ${MIN_WATERTIGHT_THICKNESS}"): add backing or turn Watertight off`;
  }
  return { z: m.heightsIn, cols: m.cols, rows: m.rows, meshX: m.widthIn, meshY: m.heightIn,
    diagonal: m.diagonalZ00Z11 ? 'z00z11' : 'z10z01', watertight };
}

/** The SBP pipeline's view of an export surface (a copy: the generator may shift it). */
export function surfaceHeightmap(surface: ExportSurface): Heightmap {
  const { z, rows, cols, meshX, meshY } = surface;
  return { z: z.slice(), rows, cols, originX: 0, originY: 0,
    cellSize: meshX / (cols - 1), cellSizeY: meshY / (rows - 1), meshX, meshY, diagonal: surface.diagonal };
}
