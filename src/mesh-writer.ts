/**
 * Mesh export geometry, written straight from a height grid into typed arrays. Pure (no DOM, no
 * STATE): the browser export and the Node round-trip check (cli/relief-roundtrip.ts) share it, so
 * the file the check verifies is byte-for-byte the file the browser downloads.
 *
 * Vertex (j, i) sits at X = i / (cols - 1) * meshX, Y = j / (rows - 1) * meshY, Z = z[j * cols + i]
 * (inches, Y growing away from the machine front). The watertight enclosure adds one bottom vertex
 * under every boundary node, four walls, and a bottom closed by a fan from one centre vertex. The
 * bottom used to be a full grid copy, which doubled the triangle count for nothing: at the
 * 1201 x 2401 relief master that is 5.8M extra triangles, about 288 MB of binary STL.
 */
import { preferZ00Z11Diagonal } from './geometry';

export interface ExportSurface {
  z: Float64Array;
  cols: number;
  rows: number;
  meshX: number;
  meshY: number;
  /** 'shortest' picks each cell's diagonal by height (the procedural modes); a relief master fixes
   *  it so the exported surface between nodes is the master's own triangulation. */
  diagonal: 'shortest' | 'z00z11' | 'z10z01';
  watertight: boolean;
}

/** Boundary node indices, counterclockwise seen from +Z: front edge left to right, right edge up,
 *  back edge right to left, left edge down. */
function rim(cols: number, rows: number): Int32Array {
  const out = new Int32Array(2 * (cols + rows) - 4);
  let k = 0;
  for (let i = 0; i < cols; i++) out[k++] = i;
  for (let j = 1; j < rows; j++) out[k++] = j * cols + cols - 1;
  for (let i = cols - 2; i >= 0; i--) out[k++] = (rows - 1) * cols + i;
  for (let j = rows - 2; j >= 1; j--) out[k++] = j * cols;
  return out;
}

export interface IndexedMesh {
  /** xyz per vertex, inches. */
  positions: Float64Array;
  /** Three vertex indices per triangle, counterclockwise seen from outside. */
  triangles: Uint32Array;
  topTriangles: number;
}

export function buildIndexedMesh(s: ExportSurface): IndexedMesh {
  const { z, cols, rows, meshX, meshY, diagonal, watertight } = s;
  const n = cols * rows;
  const ring = watertight ? rim(cols, rows) : new Int32Array(0);
  const nv = n + (watertight ? ring.length + 1 : 0);
  const positions = new Float64Array(nv * 3);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = (j * cols + i) * 3;
      positions[k] = (i / (cols - 1)) * meshX;
      positions[k + 1] = (j / (rows - 1)) * meshY;
      positions[k + 2] = z[j * cols + i];
    }
  const topTriangles = 2 * (cols - 1) * (rows - 1);
  const nt = topTriangles + (watertight ? 3 * ring.length : 0);
  const tris = new Uint32Array(nt * 3);
  let t = 0;
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      const useZ00Z11 = diagonal === 'z00z11' ||
        (diagonal === 'shortest' && preferZ00Z11Diagonal(z[a], z[b], z[c], z[d]));
      if (useZ00Z11) { tris.set([a, b, d, a, d, c], t); } else { tris.set([a, b, c, b, d, c], t); }
      t += 6;
    }
  if (watertight) {
    const bot = n, centre = n + ring.length;
    for (let k = 0; k < ring.length; k++) {
      const p = ring[k] * 3, q = (bot + k) * 3;
      positions[q] = positions[p]; positions[q + 1] = positions[p + 1]; positions[q + 2] = 0;
    }
    positions[centre * 3] = meshX / 2; positions[centre * 3 + 1] = meshY / 2; positions[centre * 3 + 2] = 0;
    for (let k = 0; k < ring.length; k++) {
      const k1 = (k + 1) % ring.length;
      const t0 = ring[k], t1 = ring[k1], b0 = bot + k, b1 = bot + k1;
      // Wall quad, outward: the rim runs counterclockwise, so outward is to its right.
      tris.set([t0, b0, t1, t1, b0, b1, centre, b1, b0], t);
      t += 9;
    }
  }
  return { positions, triangles: tris, topTriangles };
}

function normalOf(p: Float64Array, a: number, b: number, c: number): [number, number, number] {
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  return len > 0 ? [nx / len, ny / len, nz / len] : [0, 0, 1];
}

export function writeBinarySTL(mesh: IndexedMesh): ArrayBuffer {
  const { positions: p, triangles: t } = mesh;
  const count = t.length / 3;
  const buf = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buf);
  const header = 'MESHCRAFT // Sawyer Design';
  for (let i = 0; i < 80; i++) view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  view.setUint32(80, count, true);
  let off = 84;
  for (let f = 0; f < count; f++) {
    const a = t[f * 3], b = t[f * 3 + 1], c = t[f * 3 + 2];
    const [nx, ny, nz] = normalOf(p, a, b, c);
    view.setFloat32(off, nx, true); view.setFloat32(off + 4, ny, true); view.setFloat32(off + 8, nz, true);
    off += 12;
    for (const v of [a, b, c]) {
      view.setFloat32(off, p[v * 3], true); view.setFloat32(off + 4, p[v * 3 + 1], true); view.setFloat32(off + 8, p[v * 3 + 2], true);
      off += 12;
    }
    view.setUint16(off, 0, true); off += 2;
  }
  return buf;
}

/** Facets or lines per joined chunk of a text export. A full-resolution relief master's ASCII STL
 *  is about 1.6 G characters, three times V8's maximum string length, so text exports are built as
 *  string chunks for `new Blob(chunks)` and never joined into one string. */
export const TEXT_CHUNK = 20000;

export function writeAsciiSTL(mesh: IndexedMesh): string[] {
  const { positions: p, triangles: t } = mesh;
  const chunks: string[] = ['solid meshcraft\n'];
  let part: string[] = [];
  for (let f = 0; f < t.length / 3; f++) {
    const a = t[f * 3], b = t[f * 3 + 1], c = t[f * 3 + 2];
    const [nx, ny, nz] = normalOf(p, a, b, c);
    const v = (i: number): string => `  vertex ${p[i * 3]} ${p[i * 3 + 1]} ${p[i * 3 + 2]}\n`;
    part.push(`facet normal ${nx} ${ny} ${nz}\n outer loop\n${v(a)}${v(b)}${v(c)} endloop\nendfacet\n`);
    if (part.length === TEXT_CHUNK) { chunks.push(part.join('')); part = []; }
  }
  chunks.push(part.join(''), 'endsolid meshcraft');
  return chunks;
}

export function writeOBJ(mesh: IndexedMesh): string[] {
  const { positions: p, triangles: t } = mesh;
  const chunks: string[] = ['# MESHCRAFT - Sawyer Design\n# OBJ Export\n\n'];
  let part: string[] = [];
  const flush = (): void => { if (part.length >= TEXT_CHUNK) { chunks.push(part.join('')); part = []; } };
  for (let i = 0; i < p.length / 3; i++) {
    part.push(`v ${p[i * 3].toFixed(6)} ${p[i * 3 + 1].toFixed(6)} ${p[i * 3 + 2].toFixed(6)}\n`);
    flush();
  }
  part.push('\n');
  for (let f = 0; f < t.length / 3; f++) {
    part.push(`f ${t[f * 3] + 1} ${t[f * 3 + 1] + 1} ${t[f * 3 + 2] + 1}\n`);
    flush();
  }
  chunks.push(part.join(''));
  return chunks;
}
