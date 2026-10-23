/**
 * Drape figure (.mcfig): a complete 3D figure placed for draping, written by
 * scripts/drape/export_figure.py. Pure: no DOM, shared by the browser worker and the Node CLI.
 *
 * Container, little-endian:
 *   bytes 0-7   ASCII "MCFIG" + 3 zero bytes
 *   bytes 8-11  uint32 header length L
 *   12..12+L    UTF-8 JSON header (FigureHeader)
 *   padding to the next multiple of 8 from the start of the file
 *   positions   vertices x 3 float32 (scene units)
 *   triangles   triangles x 3 uint32
 *
 * Placement convention (the Blender proof's): Z up, the face looks toward -Y, the crown (highest
 * point) at (0, 0, 1). One scene unit is 1/8 m for the bundled Venus.
 */

export const FIGURE_MAGIC = 'MCFIG';
/** Most triangles a figure may have: Jolt's collision mesh shares the fixed 128 MiB WASM heap with the
 *  cloth. Measured with drape-run on a clustered 9.1 M-triangle STL (2026-10-23): 390,444 triangles ran
 *  with the largest cloth the sliders allow (200 x 750 quads), 483,512 ran out of memory even with the
 *  default cloth. 300,000 keeps a margin for meshes that weld less well. Uploads above it are simplified
 *  (src/drape-sim/simplify.ts). The bundled Venus has 141,642 triangles. */
export const MAX_FIGURE_TRIANGLES = 300_000;
/** Most triangles an uploaded .mcfig may have before it is simplified to MAX_FIGURE_TRIANGLES: the size the
 *  figure format accepted before that cap was measured. */
export const MAX_MCFIG_UPLOAD_TRIANGLES = 2_000_000;

export interface FigureHeader {
  format: 'meshcraft-figure';
  version: 1;
  vertices: number;
  triangles: number;
  head_centre: [number, number, number];
  head_height: number;
  name?: string;
  source?: string;
  license?: string;
  /** Where the cloth hangs from (figureAnchor): absent = the crown, the highest point (the bundled and
   *  Blender-exported figures); 'top-centre' = over the middle of the top region (uploaded meshes). */
  anchor?: 'top-centre';
}

export interface Figure {
  header: FigureHeader;
  positions: Float32Array;
  triangles: Uint32Array;
}

/** Parse a .mcfig. `maxTriangles` is the drape's cap; an upload may parse with a larger one and simplify. */
export function parseFigure(buf: ArrayBuffer, maxTriangles = MAX_FIGURE_TRIANGLES): Figure {
  const u8 = new Uint8Array(buf);
  const magic = String.fromCharCode(...u8.subarray(0, 5));
  if (u8.length < 12 || magic !== FIGURE_MAGIC || u8[5] !== 0 || u8[6] !== 0 || u8[7] !== 0) throw new Error('not a MeshCraft figure (.mcfig)');
  const len = new DataView(buf).getUint32(8, true);
  if (12 + len > u8.length) throw new Error('figure header runs past the end of the file');
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + len))); } catch { throw new Error('figure header is not valid JSON'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('figure header must be a JSON object');
  const header = raw as FigureHeader;
  if (header.format !== 'meshcraft-figure' || header.version !== 1) throw new Error('unsupported figure header');
  const nv = header.vertices, nt = header.triangles;
  if (!Number.isInteger(nv) || !Number.isInteger(nt) || nv < 3 || nt < 1) throw new Error('figure header has bad counts');
  if (nt > maxTriangles) throw new Error(`${nt.toLocaleString()} triangles; decimate below ${maxTriangles.toLocaleString()}`);
  const hc = header.head_centre;
  if (!Array.isArray(hc) || hc.length !== 3 || !hc.every(v => typeof v === 'number' && Number.isFinite(v))) throw new Error('figure head_centre must be three finite numbers');
  if (header.anchor !== undefined && header.anchor !== 'top-centre') throw new Error('figure anchor must be "top-centre" when present');
  for (const key of ['name', 'source', 'license'] as const)                // carried into the relief master
    if (header[key] !== undefined && typeof header[key] !== 'string') throw new Error(`figure ${key} must be a string when present`);
  const start = Math.ceil((12 + len) / 8) * 8;
  if (buf.byteLength !== start + nv * 12 + nt * 12) throw new Error('figure size does not match its header');
  const positions = new Float32Array(buf.slice(start, start + nv * 12));
  const triangles = new Uint32Array(buf.slice(start + nv * 12));
  for (let i = 0; i < triangles.length; i++) if (triangles[i] >= nv) throw new Error('figure triangle index out of range');
  for (let i = 0; i < positions.length; i++) if (!Number.isFinite(positions[i])) throw new Error('figure has a non-finite position');
  return { header, positions, triangles };
}

/** How the figure is posed for the drape, degrees: `tiltDeg` tips the face back (positive = face looks
 *  up), `turnDeg` turns it about the vertical axis (positive = face turns toward the viewer's right),
 *  `leanDeg` leans the head sideways (positive = crown toward the viewer's right). `scale` sizes the
 *  posed figure about its crown (1 or absent = as placed). */
export interface FigurePose { tiltDeg: number; turnDeg: number; leanDeg: number; scale?: number }

/** Where the cloth hangs from, for figure positions `pos`: the horizontal spot (x, y) that goes under
 *  (0, 0), and `top`, the highest point, which goes to z = 1 so the sheet starts above everything.
 *  'crown' (the bundled and Blender figures): the highest vertex, as the Blender proof hangs its veil.
 *  'top-centre' (uploaded meshes): the middle of the posed figure's whole width, at the highest vertex's
 *  depth, so it stays centred in the panel as it is posed and a tilted tile hangs from the middle of its
 *  top rather than a corner beside it. Where the surface under that spot is lower than the top, the
 *  pinned cloth starts a little above it. */
export function figureAnchor(pos: ArrayLike<number>, mode: 'crown' | 'top-centre'): { x: number; y: number; top: number } {
  let top = -Infinity, ti = 0;
  for (let i = 0; i < pos.length; i += 3) if (pos[i + 2] > top) { top = pos[i + 2]; ti = i; }
  if (mode === 'crown') return { x: pos[ti], y: pos[ti + 1], top };
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pos.length; i += 3) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]); }
  return { x: (lo + hi) / 2, y: pos[ti + 1], top };
}

/**
 * Pose the figure about its head centre (turn about Z, then tilt about X, then lean about Y), then move
 * its anchor (figureAnchor) under (0, 0) with its highest point at z = 1, and scale about (0, 0, 1).
 * Tilt alone is the construction of scripts/drape/blender_drape.py.
 */
export function poseFigure(fig: Figure, pose: FigurePose): Float32Array {
  const t = (-pose.tiltDeg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const u = (pose.turnDeg * Math.PI) / 180, cu = Math.cos(u), su = Math.sin(u);
  const l = (pose.leanDeg * Math.PI) / 180, cl = Math.cos(l), sl = Math.sin(l);
  const [hx, hy, hz] = fig.header.head_centre;
  const p = fig.positions, out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    let x = p[i] - hx, y = p[i + 1] - hy, z = p[i + 2] - hz;
    if (pose.turnDeg) { const x2 = x * cu - y * su; y = x * su + y * cu; x = x2; }
    const y2 = y * c - z * s; z = y * s + z * c; y = y2;
    if (pose.leanDeg) { const x2 = x * cl + z * sl; z = -x * sl + z * cl; x = x2; }
    out[i] = pose.turnDeg || pose.leanDeg ? x + hx : p[i];
    out[i + 1] = y + hy;
    out[i + 2] = z + hz;
  }
  const a = figureAnchor(out, fig.header.anchor ?? 'crown'), dx = a.x, dy = a.y, dz = a.top - 1;
  for (let i = 0; i < out.length; i += 3) { out[i] -= dx; out[i + 1] -= dy; out[i + 2] -= dz; }
  // Skipped at 1 so an unscaled pose stays bit for bit what the Blender parity runs were built from.
  const k = pose.scale ?? 1;
  if (k !== 1) for (let i = 0; i < out.length; i += 3) { out[i] *= k; out[i + 1] *= k; out[i + 2] = 1 + (out[i + 2] - 1) * k; }
  return out;
}

/** Tip the face back by `tiltDeg` only (the Blender proof's pose). */
export function tiltFigure(fig: Figure, tiltDeg: number): Float32Array {
  return poseFigure(fig, { tiltDeg, turnDeg: 0, leanDeg: 0 });
}

/** Serialize a figure as a .mcfig file (the Worker takes a file, so the same parser checks both
 *  bundled and uploaded figures). */
export function encodeFigure(fig: Figure): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(fig.header));
  const start = Math.ceil((12 + json.length) / 8) * 8;
  const out = new Uint8Array(start + fig.positions.byteLength + fig.triangles.byteLength);
  out.set([77, 67, 70, 73, 71, 0, 0, 0], 0);                     // "MCFIG\0\0\0"
  new DataView(out.buffer).setUint32(8, json.length, true);
  out.set(json, 12);
  out.set(new Uint8Array(fig.positions.buffer, fig.positions.byteOffset, fig.positions.byteLength), start);
  out.set(new Uint8Array(fig.triangles.buffer, fig.triangles.byteOffset, fig.triangles.byteLength), start + fig.positions.byteLength);
  return out.buffer;
}

/** Scene units per metre: one unit is 1/8 m, so a life-size head is about 2.4 units tall, as in the
 *  Blender proof. */
export const SCENE_UNITS_PER_M = 8;
/** Height of the head region below the crown used for the tilt pivot, scene units. */
export const HEAD_HEIGHT = 2.6;

/** Room an uploaded mesh is fitted into, scene units from its crown at (0, 0, 1): `halfWidth` either
 *  side of it and `below` it (src/drape-sim/pipeline.ts FIGURE_FIT, from the panel). */
export interface FigureFit { halfWidth: number; below: number }

export interface MeshPlacement {
  /** Which model axis points up. */
  up: 'z' | 'y';
  /** Turn about the vertical axis so the face looks toward -Y (the viewer), degrees. */
  turnDeg: number;
  name: string;
  fit: FigureFit;
}

/** Place an uploaded mesh much as export_figure.py places the bundled figure: Z up, turned about Z, the
 *  middle of its width under x = 0, its highest point at (., 0, 1), head centre from the top HEAD_HEIGHT
 *  units. Its own units are ignored: it is scaled about (0, 0, 1) so it fits `fit` (half its width, or its
 *  depth below the top, fills its room), so any model starts the same size against the panel and the
 *  cloth. It is marked 'top-centre', so posing hangs it from the middle of its top. */
export function figureFromMesh(pos: ArrayLike<number>, tris: ArrayLike<number>, p: MeshPlacement): Figure {
  const n = pos.length / 3, out = new Float32Array(pos.length);
  const a = (p.turnDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3];
    let y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (p.up === 'y') { const t = y; y = -z; z = t; }                // Y-up model: its +Z (glTF front) faces the viewer
    out[i * 3] = x * c - y * s; out[i * 3 + 1] = x * s + y * c; out[i * 3 + 2] = z;
  }
  // The same anchor posing uses, so the fitted margins hold at the default pose.
  const anchor = figureAnchor(out, 'top-centre'), cx = anchor.x, cy = anchor.y, cz = anchor.top;
  let side = 0, below = 0;
  for (let i = 0; i < n; i++) { side = Math.max(side, Math.abs(out[i * 3] - cx)); below = Math.max(below, cz - out[i * 3 + 2]); }
  const k = Math.min(side > 0 ? p.fit.halfWidth / side : Infinity, below > 0 ? p.fit.below / below : Infinity);
  if (!Number.isFinite(k)) throw new Error('the mesh has no width or height to fit');
  let sx = 0, sy = 0, sz = 0, m = 0;
  for (let i = 0; i < n; i++) {
    out[i * 3] = (out[i * 3] - cx) * k; out[i * 3 + 1] = (out[i * 3 + 1] - cy) * k; out[i * 3 + 2] = 1 + (out[i * 3 + 2] - cz) * k;
    if (out[i * 3 + 2] > 1 - HEAD_HEIGHT) { sx += out[i * 3]; sy += out[i * 3 + 1]; sz += out[i * 3 + 2]; m++; }
  }
  const triangles = Uint32Array.from(tris as ArrayLike<number>);
  const header: FigureHeader = { format: 'meshcraft-figure', version: 1, vertices: n, triangles: triangles.length / 3,
    head_centre: [sx / m, sy / m, sz / m], head_height: HEAD_HEIGHT, name: p.name, anchor: 'top-centre' };
  return { header, positions: out, triangles };
}
