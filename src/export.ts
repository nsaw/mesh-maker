import { STATE } from './state';
import type { Vertex3D, Triangle, MeshData } from './types';
import { showToast } from './toast';
import { preferZ00Z11Diagonal } from './geometry';

export function getFullMeshData(): MeshData | null {
  const { vertices, cols, rows, meshX, meshY, watertight } = STATE;
  const baseThickness = watertight ? Math.max(STATE.baseThickness, 0.01) : STATE.baseThickness;
  if (!vertices || cols < 2 || rows < 2) return null;

  const top: Vertex3D[][] = [];
  for (let j = 0; j < rows; j++) {
    top[j] = [];
    for (let i = 0; i < cols; i++) {
      top[j][i] = { x: (i/(cols-1))*meshX, y: (j/(rows-1))*meshY, z: vertices[j][i] };
    }
  }
  return { top, cols, rows, meshX, meshY, baseThickness, watertight };
}

function triNormal(a: Vertex3D, b: Vertex3D, c: Vertex3D): Vertex3D {
  const ux = b.x-a.x, uy = b.y-a.y, uz = b.z-a.z;
  const vx = c.x-a.x, vy = c.y-a.y, vz = c.z-a.z;
  const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
  const len = Math.hypot(nx, ny, nz);
  return len > 0 ? { x: nx/len, y: ny/len, z: nz/len } : { x: 0, y: 0, z: 1 };
}


function collectTriangles(mesh: MeshData): Triangle[] {
  const tris: Triangle[] = [];
  const { top, cols, rows, watertight } = mesh;
  const zBase = 0;

  for (let j = 0; j < rows-1; j++) for (let i = 0; i < cols-1; i++) {
    if (preferZ00Z11Diagonal(top[j][i].z, top[j][i+1].z, top[j+1][i].z, top[j+1][i+1].z)) {
      tris.push([top[j][i], top[j][i+1], top[j+1][i+1]]);
      tris.push([top[j][i], top[j+1][i+1], top[j+1][i]]);
    } else {
      tris.push([top[j][i], top[j][i+1], top[j+1][i]]);
      tris.push([top[j][i+1], top[j+1][i+1], top[j+1][i]]);
    }
  }

  if (watertight) {
    for (let j = 0; j < rows-1; j++) for (let i = 0; i < cols-1; i++) {
      const b00: Vertex3D = {x:top[j][i].x, y:top[j][i].y, z:zBase};
      const b10: Vertex3D = {x:top[j][i+1].x, y:top[j][i+1].y, z:zBase};
      const b01: Vertex3D = {x:top[j+1][i].x, y:top[j+1][i].y, z:zBase};
      const b11: Vertex3D = {x:top[j+1][i+1].x, y:top[j+1][i+1].y, z:zBase};
      tris.push([b00, b01, b10]);
      tris.push([b10, b01, b11]);
    }
    for (let i = 0; i < cols-1; i++) {
      const tl = top[0][i], tr = top[0][i+1];
      const bl: Vertex3D = {x:tl.x,y:tl.y,z:zBase}, br: Vertex3D = {x:tr.x,y:tr.y,z:zBase};
      tris.push([tl, bl, tr]); tris.push([tr, bl, br]);
    }
    for (let i = 0; i < cols-1; i++) {
      const tl = top[rows-1][i], tr = top[rows-1][i+1];
      const bl: Vertex3D = {x:tl.x,y:tl.y,z:zBase}, br: Vertex3D = {x:tr.x,y:tr.y,z:zBase};
      tris.push([tl, tr, bl]); tris.push([tr, br, bl]);
    }
    for (let j = 0; j < rows-1; j++) {
      const tt = top[j][0], tb = top[j+1][0];
      const bt: Vertex3D = {x:tt.x,y:tt.y,z:zBase}, bb: Vertex3D = {x:tb.x,y:tb.y,z:zBase};
      tris.push([tt, tb, bt]); tris.push([tb, bb, bt]);
    }
    for (let j = 0; j < rows-1; j++) {
      const tt = top[j][cols-1], tb = top[j+1][cols-1];
      const bt: Vertex3D = {x:tt.x,y:tt.y,z:zBase}, bb: Vertex3D = {x:tb.x,y:tb.y,z:zBase};
      tris.push([tt, bt, tb]); tris.push([tb, bt, bb]);
    }
  }
  return tris;
}

function exportSTL_ASCII(mesh: MeshData): string {
  const tris = collectTriangles(mesh);
  let s = 'solid meshcraft\n';
  for (const [a, b, c] of tris) {
    const n = triNormal(a, b, c);
    s += `facet normal ${n.x} ${n.y} ${n.z}\n outer loop\n  vertex ${a.x} ${a.y} ${a.z}\n  vertex ${b.x} ${b.y} ${b.z}\n  vertex ${c.x} ${c.y} ${c.z}\n endloop\nendfacet\n`;
  }
  return s + 'endsolid meshcraft';
}

function exportSTL_Binary(mesh: MeshData): Blob {
  const tris = collectTriangles(mesh);
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const view = new DataView(buf);
  const header = 'MESHCRAFT // Sawyer Design';
  for (let i = 0; i < 80; i++) view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  view.setUint32(80, tris.length, true);
  let off = 84;
  for (const [a, b, c] of tris) {
    const n = triNormal(a, b, c);
    view.setFloat32(off, n.x, true); off += 4;
    view.setFloat32(off, n.y, true); off += 4;
    view.setFloat32(off, n.z, true); off += 4;
    for (const v of [a, b, c]) {
      view.setFloat32(off, v.x, true); off += 4;
      view.setFloat32(off, v.y, true); off += 4;
      view.setFloat32(off, v.z, true); off += 4;
    }
    view.setUint16(off, 0, true); off += 2;
  }
  return new Blob([buf], { type: 'application/octet-stream' });
}

function exportOBJ(mesh: MeshData): string {
  const { top, cols, rows, watertight } = mesh;
  const zBase = 0;
  let s = '# MESHCRAFT - Sawyer Design\n# OBJ Export\n\n';

  const topStart = 1;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const v = top[j][i];
    s += `v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}\n`;
  }

  const botStart = rows * cols + 1;

  if (watertight) {
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      s += `v ${top[j][i].x.toFixed(6)} ${top[j][i].y.toFixed(6)} ${zBase.toFixed(6)}\n`;
    }
  }

  s += '\n# Top surface\n';
  for (let j = 0; j < rows-1; j++) for (let i = 0; i < cols-1; i++) {
    const a = topStart + j*cols+i, b = a+1, c = a+cols, d = c+1;
    if (preferZ00Z11Diagonal(top[j][i].z, top[j][i+1].z, top[j+1][i].z, top[j+1][i+1].z)) {
      s += `f ${a} ${b} ${d}\nf ${a} ${d} ${c}\n`;
    } else {
      s += `f ${a} ${b} ${c}\nf ${b} ${d} ${c}\n`;
    }
  }

  if (watertight) {
    s += '\n# Bottom surface\n';
    for (let j = 0; j < rows-1; j++) for (let i = 0; i < cols-1; i++) {
      const a = botStart + j*cols+i, b = a+1, c = a+cols, d = c+1;
      s += `f ${a} ${c} ${b}\nf ${b} ${c} ${d}\n`;
    }
    s += '\n# Side walls\n';
    for (let i = 0; i < cols-1; i++) {
      const tl = topStart+i, tr = tl+1, bl = botStart+i, br = bl+1;
      s += `f ${tl} ${bl} ${tr}\nf ${tr} ${bl} ${br}\n`;
    }
    for (let i = 0; i < cols-1; i++) {
      const tl = topStart+(rows-1)*cols+i, tr = tl+1, bl = botStart+(rows-1)*cols+i, br = bl+1;
      s += `f ${tl} ${tr} ${bl}\nf ${tr} ${br} ${bl}\n`;
    }
    for (let j = 0; j < rows-1; j++) {
      const tt = topStart+j*cols, tb = tt+cols, bt = botStart+j*cols, bb = bt+cols;
      s += `f ${tt} ${tb} ${bt}\nf ${tb} ${bb} ${bt}\n`;
    }
    for (let j = 0; j < rows-1; j++) {
      const tt = topStart+j*cols+(cols-1), tb = tt+cols, bt = botStart+j*cols+(cols-1), bb = bt+cols;
      s += `f ${tt} ${bt} ${tb}\nf ${tb} ${bt} ${bb}\n`;
    }
  }
  return s;
}

// --- Rhino 3DM export via lazy-loaded rhino3dm.js WASM from CDN ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _rhino: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _rhinoPromise: Promise<any> | null = null;

// Version-pinned CDN URL — 8.17+ required for toByteArrayOptions(File3dmWriteOptions) for Rhino 7–compatible export.
const RHINO3DM_URL = 'https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0/rhino3dm.module.min.js';

async function loadRhino3dm(): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (_rhino) return _rhino;
  if (!_rhinoPromise) {
    // Cache the in-flight promise to prevent concurrent WASM downloads on rapid clicks.
    // Reset on failure so subsequent attempts can retry.
    _rhinoPromise = (async () => {
      let mod;
      try {
        mod = await import(/* @vite-ignore */ RHINO3DM_URL);
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

async function exportRhino3DM(mesh: MeshData): Promise<Blob> {
  const rhino = await loadRhino3dm();

  const { top, cols, rows, watertight } = mesh;
  const zBase = 0;

  const asPointCloud = STATE.export3dmAsPointCloud;

  let m: ReturnType<typeof rhino.Mesh> | null = null;
  let cloud: ReturnType<typeof rhino.PointCloud> | null = null;
  let file: ReturnType<typeof rhino.File3dm> | null = null;
  let geometryAdded = false;

  try {
    file = new rhino.File3dm();
    file.settings().modelUnitSystem = rhino.UnitSystem.Inches;

    if (asPointCloud) {
      const points: number[][] = [];
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++)
          points.push([top[j][i].x, top[j][i].y, top[j][i].z]);
      if (watertight)
        for (let j = 0; j < rows; j++)
          for (let i = 0; i < cols; i++)
            points.push([top[j][i].x, top[j][i].y, zBase]);

      cloud = new rhino.PointCloud();
      cloud.addRangePoints(points);
      file.objects().addPointCloud(cloud, null);
      geometryAdded = true;
    } else {
      m = new rhino.Mesh();
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++)
          m.vertices().add(top[j][i].x, top[j][i].y, top[j][i].z);

      const botStart = rows * cols;
      if (watertight)
        for (let j = 0; j < rows; j++)
          for (let i = 0; i < cols; i++)
            m.vertices().add(top[j][i].x, top[j][i].y, zBase);

      for (let j = 0; j < rows - 1; j++)
        for (let i = 0; i < cols - 1; i++) {
          const a = j * cols + i;
          if (preferZ00Z11Diagonal(top[j][i].z, top[j][i+1].z, top[j+1][i].z, top[j+1][i+1].z)) {
            m.faces().addFace(a, a + 1, a + cols + 1);
            m.faces().addFace(a, a + cols + 1, a + cols);
          } else {
            m.faces().addFace(a, a + 1, a + cols);
            m.faces().addFace(a + 1, a + cols + 1, a + cols);
          }
        }

      if (watertight) {
        for (let j = 0; j < rows - 1; j++)
          for (let i = 0; i < cols - 1; i++) {
            const a = botStart + j * cols + i;
            m.faces().addQuadFace(a, a + cols, a + cols + 1, a + 1);
          }
        for (let i = 0; i < cols - 1; i++)
          m.faces().addQuadFace(i, botStart + i, botStart + i + 1, i + 1);
        for (let i = 0; i < cols - 1; i++) {
          const t = (rows - 1) * cols + i, b = botStart + (rows - 1) * cols + i;
          m.faces().addQuadFace(t, t + 1, b + 1, b);
        }
        for (let j = 0; j < rows - 1; j++) {
          const t = j * cols, b = botStart + j * cols;
          m.faces().addQuadFace(t, t + cols, b + cols, b);
        }
        for (let j = 0; j < rows - 1; j++) {
          const t = j * cols + (cols - 1), b = botStart + j * cols + (cols - 1);
          m.faces().addQuadFace(t, b, b + cols, t + cols);
        }
      }

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

function exportHeightmapPNG(): Promise<Blob | null> {
  const { vertices, cols, rows } = STATE;
  if (!vertices) return Promise.resolve(null);

  let zMin = Infinity, zMax = -Infinity;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (vertices[j][i] < zMin) zMin = vertices[j][i];
    if (vertices[j][i] > zMax) zMax = vertices[j][i];
  }
  const zRange = zMax - zMin || 1;

  const c = document.createElement('canvas');
  c.width = cols; c.height = rows;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(cols, rows);

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const t = (vertices[j][i] - zMin) / zRange;
      const v = Math.round(Math.max(0, Math.min(1, t)) * 255);
      const idx = (j * cols + i) * 4;
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
    const { doSBPExport } = await import('./sbp-export');
    doSBPExport();
    return;
  }

  if (fmt === 'heightmap') {
    if (!STATE.vertices) { showToast('Generate a mesh first'); return; }
    const blob = await exportHeightmapPNG();
    if (!blob) { showToast('Heightmap export failed'); return; }
    triggerDownload(blob, `${STATE.filename}_heightmap.png`);
    return;
  }

  const mesh = getFullMeshData();
  if (!mesh) {
    showToast(STATE.vertices ? 'Mesh too small to export (need at least 2\u00d72 grid)' : 'Generate a mesh first');
    return;
  }

  let blob: Blob | undefined;
  let ext: string;

  if (fmt === 'stl') {
    if (STATE.binary) {
      blob = exportSTL_Binary(mesh);
    } else {
      const txt = exportSTL_ASCII(mesh);
      blob = new Blob([txt], { type: 'text/plain' });
    }
    ext = 'stl';
  } else if (fmt === 'obj') {
    const txt = exportOBJ(mesh);
    blob = new Blob([txt], { type: 'text/plain' });
    ext = 'obj';
  } else if (fmt === '3dm') {
    try {
      if (!_rhino) showToast('Loading Rhino3DM\u2026', 15000);
      blob = await exportRhino3DM(mesh);
      ext = '3dm';
    } catch (e: unknown) {
      const txt = exportOBJ(mesh);
      blob = new Blob([txt], { type: 'text/plain' });
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

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
