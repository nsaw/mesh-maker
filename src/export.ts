import { STATE } from './state';
import { showToast } from './toast';
import { doSBPExport } from './sbp-export';
import { getExportSurface } from './export-surface';
import { buildIndexedMesh, writeAsciiSTL, writeBinarySTL, writeOBJ } from './mesh-writer';
import type { ExportSurface, IndexedMesh } from './mesh-writer';

// --- Rhino 3DM export via lazy-loaded rhino3dm.js WASM from CDN ---
//
// Narrow local types over the rhino3dm WASM API. The CDN ships no .d.ts; we type only
// the surface we use. `unknown` for opaque return types we never inspect — methods are
// invoked but callers don't peek inside them.

interface RhinoMesh {
  vertices(): { add(x: number, y: number, z: number): unknown };
  faces(): { addTriFace(a: number, b: number, c: number): unknown; addQuadFace(a: number, b: number, c: number, d: number): unknown };
  normals(): { computeNormals(): unknown };
  compact(): unknown;
  delete(): void;
}
interface RhinoPointCloud { addRangePoints(points: number[][]): unknown; delete(): void }
interface RhinoFile3dmObjects { add(obj: unknown, attrs: unknown): unknown; addPointCloud(cloud: unknown, attrs: unknown): unknown }
interface RhinoFile3dmSettings { modelUnitSystem: number }
interface RhinoFile3dm {
  settings(): RhinoFile3dmSettings;
  objects(): RhinoFile3dmObjects;
  toByteArray(): Uint8Array;
  toByteArrayOptions(options: RhinoFile3dmWriteOptions): Uint8Array;
  delete(): void;
}
interface RhinoFile3dmWriteOptions { version: number }
interface RhinoApi {
  Mesh: new () => RhinoMesh;
  PointCloud: new () => RhinoPointCloud;
  File3dm: new () => RhinoFile3dm;
  File3dmWriteOptions: new () => RhinoFile3dmWriteOptions;
  UnitSystem: { Inches: number };
}
interface Rhino3dmModule { default(): Promise<RhinoApi> }

let _rhino: RhinoApi | null = null;
let _rhinoPromise: Promise<RhinoApi> | null = null;

// Version-pinned CDN URL — 8.17+ required for toByteArrayOptions(File3dmWriteOptions) for Rhino 7–compatible export.
const RHINO3DM_URL = 'https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0/rhino3dm.module.min.js';

async function loadRhino3dm(): Promise<RhinoApi> {
  if (_rhino) return _rhino;
  if (!_rhinoPromise) {
    // Cache the in-flight promise to prevent concurrent WASM downloads on rapid clicks.
    // Reset on failure so subsequent attempts can retry.
    _rhinoPromise = (async (): Promise<RhinoApi> => {
      let mod: Rhino3dmModule;
      try {
        mod = await import(/* @vite-ignore */ RHINO3DM_URL) as Rhino3dmModule;
      } catch (e) {
        _rhinoPromise = null;
        throw new Error(`CDN import failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e } as ErrorOptions);
      }
      try {
        _rhino = await mod.default();
        return _rhino;
      } catch (e) {
        _rhinoPromise = null;
        throw new Error(`WASM init failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e } as ErrorOptions);
      }
    })();
  }
  return _rhinoPromise;
}

async function exportRhino3DM(mesh: IndexedMesh): Promise<Blob> {
  const rhino = await loadRhino3dm();
  const { positions: p, triangles: t } = mesh;
  const asPointCloud = STATE.export3dmAsPointCloud;

  let m: RhinoMesh | null = null;
  let cloud: RhinoPointCloud | null = null;
  let file: RhinoFile3dm | null = null;
  let geometryAdded = false;

  try {
    file = new rhino.File3dm();
    file.settings().modelUnitSystem = rhino.UnitSystem.Inches;

    if (asPointCloud) {
      const points: number[][] = [];
      for (let i = 0; i < p.length / 3; i++) points.push([p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
      cloud = new rhino.PointCloud();
      cloud.addRangePoints(points);
      file.objects().addPointCloud(cloud, null);
      geometryAdded = true;
    } else {
      m = new rhino.Mesh();
      for (let i = 0; i < p.length / 3; i++) m.vertices().add(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      for (let f = 0; f < t.length / 3; f++) m.faces().addTriFace(t[f * 3], t[f * 3 + 1], t[f * 3 + 2]);
      m.normals().computeNormals();
      m.compact();
      file.objects().add(m, null);
      geometryAdded = true;
    }

    let bytes: Uint8Array;
    try {
      const writeOptions = new rhino.File3dmWriteOptions();
      writeOptions.version = 7;
      bytes = file.toByteArrayOptions(writeOptions);
    } catch (primaryErr: unknown) {
      // Fallback: serialize without version pinning (compatible with rhino3dm 8.4+)
      try {
        bytes = file.toByteArray();
      } catch (fallbackErr: unknown) {
        const msg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
        throw new Error(`3DM write failed: ${msg}`, { cause: fallbackErr } as ErrorOptions);
      }
    }
    return new Blob([bytes], { type: 'application/octet-stream' });
  } finally {
    file?.delete();
    if (!geometryAdded) m?.delete();
    if (!geometryAdded) cloud?.delete();
  }
}

// --- Heightmap PNG export ---

function exportHeightmapPNG(surface: ExportSurface): Promise<Blob | null> {
  const { z, cols, rows } = surface;
  let zMin = Infinity, zMax = -Infinity;
  for (let k = 0; k < z.length; k++) { if (z[k] < zMin) zMin = z[k]; if (z[k] > zMax) zMax = z[k]; }
  const zRange = zMax - zMin || 1;

  const c = document.createElement('canvas');
  c.width = cols; c.height = rows;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(cols, rows);

  // Grid row 0 is world Y = 0 (the bottom edge); PNG row 0 is the top. Write rows top-down so the
  // heightmap reads the same way as the carving and as the source image.
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const t = (z[j * cols + i] - zMin) / zRange;
      const v = Math.round(Math.max(0, Math.min(1, t)) * 255);
      const idx = ((rows - 1 - j) * cols + i) * 4;
      img.data[idx] = v;
      img.data[idx+1] = v;
      img.data[idx+2] = v;
      img.data[idx+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PNG encoding timed out')), 5000);
    c.toBlob(blob => { clearTimeout(timer); resolve(blob); }, 'image/png');
  });
}

// --- Main export dispatcher ---

let _exportInFlight = false;

export async function doExport(): Promise<void> {
  if (_exportInFlight) { showToast('Export in progress...'); return; }
  _exportInFlight = true;
  try {
    return await _doExportInner();
  } finally {
    _exportInFlight = false;
  }
}

async function _doExportInner(): Promise<void> {
  const fmt = STATE.exportFormat;

  if (fmt === 'sbp') {
    doSBPExport();
    return;
  }

  const surface = getExportSurface();
  if (typeof surface === 'string') { showToast(surface, 6000); return; }

  if (fmt === 'heightmap') {
    const blob = await exportHeightmapPNG(surface);
    if (!blob) { showToast('Heightmap export failed'); return; }
    triggerDownload(blob, `${STATE.filename}_heightmap.png`);
    return;
  }

  const mesh = buildIndexedMesh(surface);
  let blob: Blob | undefined;
  let ext: string;

  if (fmt === 'stl') {
    if (STATE.binary) {
      blob = new Blob([writeBinarySTL(mesh)], { type: 'application/octet-stream' });
    } else {
      blob = new Blob(writeAsciiSTL(mesh), { type: 'text/plain' });
    }
    ext = 'stl';
  } else if (fmt === 'obj') {
    blob = new Blob(writeOBJ(mesh), { type: 'text/plain' });
    ext = 'obj';
  } else if (fmt === '3dm') {
    try {
      if (!_rhino) showToast('Loading Rhino3DM\u2026', 15000);
      blob = await exportRhino3DM(mesh);
      ext = '3dm';
    } catch (e: unknown) {
      blob = new Blob(writeOBJ(mesh), { type: 'text/plain' });
      ext = 'obj';
      const errMsg = e instanceof Error ? e.message : String(e);
      showToast(`3DM failed (OBJ fallback): ${errMsg}`, 8000);
    }
  } else {
    showToast('Unknown export format');
    return;
  }

  triggerDownload(blob, `${STATE.filename}.${ext}`);
  if (fmt === '3dm' && ext === '3dm') showToast('3DM exported!');
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
