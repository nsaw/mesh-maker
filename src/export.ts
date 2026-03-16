import { STATE } from './state';
import type { Vertex3D, Triangle, MeshData } from './types';

export function getFullMeshData(): MeshData | null {
  const { vertices, cols, rows, meshX, meshY, watertight } = STATE;
  const baseThickness = watertight ? Math.max(STATE.baseThickness, 0.01) : STATE.baseThickness;
  if (!vertices) return null;

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
  const { top, cols, rows, baseThickness, watertight } = mesh;
  const zBase = -baseThickness;

  for (let j = 0; j < rows-1; j++) for (let i = 0; i < cols-1; i++) {
    tris.push([top[j][i], top[j][i+1], top[j+1][i]]);
    tris.push([top[j][i+1], top[j+1][i+1], top[j+1][i]]);
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
  const header = 'MESHCRAFT 3000 // Sawyer Design';
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
  const { top, cols, rows, watertight, baseThickness } = mesh;
  const zBase = -baseThickness;
  let s = '# MESHCRAFT 3000 - Sawyer Design\n# OBJ Export\n\n';

  const topStart = 1;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const v = top[j][i];
    s += `v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}\n`;
  }

  let vidx = rows * cols + 1;
  const botStart = vidx;

  if (watertight) {
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      s += `v ${top[j][i].x.toFixed(6)} ${top[j][i].y.toFixed(6)} ${zBase.toFixed(6)}\n`;
    }
    vidx += rows * cols;
  }

  s += '\n# Top surface\n';
  for (let j = 0; j < rows-1; j++) for (let i = 0; i < cols-1; i++) {
    const a = topStart + j*cols+i, b = a+1, c = a+cols, d = c+1;
    s += `f ${a} ${b} ${c}\nf ${b} ${d} ${c}\n`;
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

// Version-pinned CDN URL — immutable content, OBJ fallback on any load failure.
const RHINO3DM_URL = 'https://cdn.jsdelivr.net/npm/rhino3dm@8.4.0/rhino3dm.module.min.js';

async function loadRhino3dm(): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (_rhino) return _rhino;
  if (!_rhinoPromise) {
    // Cache the in-flight promise to prevent concurrent WASM downloads on rapid clicks.
    _rhinoPromise = (async () => {
      // @ts-ignore: TS2307 — runtime CDN URL, no type declarations available
      const mod = await import(/* @vite-ignore */ RHINO3DM_URL);
      _rhino = await mod.default();
      return _rhino;
    })();
  }
  return _rhinoPromise;
}

async function exportRhino3DM(mesh: MeshData): Promise<Blob> {
  const rhino = await loadRhino3dm();

  const { top, cols, rows, watertight, baseThickness } = mesh;
  const zBase = -baseThickness;

  const m = new rhino.Mesh();
  let file: ReturnType<typeof rhino.File3dm> | null = null;

  try {
    // Top surface vertices: index = j * cols + i
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++)
        m.vertices().add(top[j][i].x, top[j][i].y, top[j][i].z);

    // Bottom vertices (watertight): index = botStart + j * cols + i
    const botStart = rows * cols;
    if (watertight)
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++)
          m.vertices().add(top[j][i].x, top[j][i].y, zBase);

    // Top surface quads
    for (let j = 0; j < rows - 1; j++)
      for (let i = 0; i < cols - 1; i++) {
        const a = j * cols + i;
        m.faces().addFace(a, a + 1, a + cols + 1, a + cols);
      }

    if (watertight) {
      // Bottom surface quads (reversed winding)
      for (let j = 0; j < rows - 1; j++)
        for (let i = 0; i < cols - 1; i++) {
          const a = botStart + j * cols + i;
          m.faces().addFace(a, a + cols, a + cols + 1, a + 1);
        }

      // Front wall (j=0)
      for (let i = 0; i < cols - 1; i++)
        m.faces().addFace(i, botStart + i, botStart + i + 1, i + 1);

      // Back wall (j=rows-1)
      for (let i = 0; i < cols - 1; i++) {
        const t = (rows - 1) * cols + i, b = botStart + (rows - 1) * cols + i;
        m.faces().addFace(t, t + 1, b + 1, b);
      }

      // Left wall (i=0)
      for (let j = 0; j < rows - 1; j++) {
        const t = j * cols, b = botStart + j * cols;
        m.faces().addFace(t, t + cols, b + cols, b);
      }

      // Right wall (i=cols-1)
      for (let j = 0; j < rows - 1; j++) {
        const t = j * cols + (cols - 1), b = botStart + j * cols + (cols - 1);
        m.faces().addFace(t, b, b + cols, t + cols);
      }
    }

    m.normals().computeNormals();
    m.compact();

    file = new rhino.File3dm();
    file.objects().add(m, null);

    const bytes: Uint8Array = file.toByteArray();
    return new Blob([bytes], { type: 'application/octet-stream' });
  } finally {
    file?.delete();
    m.delete();
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

  return new Promise(resolve => {
    c.toBlob(blob => resolve(blob), 'image/png');
  });
}

// --- Toast helper (self-contained to avoid circular deps with toolbar.ts) ---

let _toastHideTimer: ReturnType<typeof setTimeout> | null = null;
let _toastFinalizeTimer: ReturnType<typeof setTimeout> | null = null;

function showExportToast(message: string): void {
  const toast = document.getElementById('toast');
  if (!toast) return;
  if (_toastHideTimer !== null) clearTimeout(_toastHideTimer);
  if (_toastFinalizeTimer !== null) clearTimeout(_toastFinalizeTimer);
  toast.textContent = message;
  toast.style.display = 'block';
  toast.classList.add('visible');
  _toastHideTimer = setTimeout(() => {
    toast.classList.remove('visible');
    _toastFinalizeTimer = setTimeout(() => { toast.style.display = 'none'; }, 300);
  }, 1500);
}

// --- Main export dispatcher ---

export async function doExport(): Promise<void> {
  const fmt = STATE.exportFormat;

  if (fmt === 'heightmap') {
    const blob = await exportHeightmapPNG();
    if (!blob) { alert('Generate a mesh first'); return; }
    triggerDownload(blob, `${STATE.filename}_heightmap.png`);
    return;
  }

  const mesh = getFullMeshData();
  if (!mesh) return;

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
      showExportToast('Loading Rhino3DM\u2026');
      blob = await exportRhino3DM(mesh);
      ext = '3dm';
    } catch {
      // CDN or WASM load failed — fall back to OBJ
      const txt = exportOBJ(mesh);
      blob = new Blob([txt], { type: 'text/plain' });
      ext = 'obj';
      showExportToast('3DM unavailable \u2014 exported as OBJ');
    }
  } else {
    return;
  }

  triggerDownload(blob, `${STATE.filename}.${ext}`);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
