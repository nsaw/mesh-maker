/**
 * MeshCraft relief master (.mcrelief): a finished relief's numerical heights with an explicit data
 * contract, imported without any of the depth-map processing (no 8-bit canvas read, no
 * normalization, cutoff or smoothing). Pure: no DOM, shared by the browser and the Node CLI.
 *
 * Container, little-endian:
 *   bytes 0-7   ASCII "MCRELIEF"
 *   bytes 8-11  uint32 header length L
 *   12..12+L    UTF-8 JSON header (ReliefHeader)
 *   padding to the next multiple of 8 from the start of the file
 *   heights     rows x cols of `dtype`, row-major in the header's row order
 *   mask        rows x cols uint8 (0 = background), same order, present when header.mask is true
 *
 * Heights are measured from the flat back of the panel and include the backing, in `units`.
 * `width` and `height` are the node-to-node extents: column 0 sits at X = 0 and column cols - 1 at
 * X = width (endpoints included), likewise for rows. `sha256.heights` is the hex SHA-256 of the
 * heights bytes exactly as stored; a mismatch rejects the file.
 */

import { MACHINE_TRAVEL_IN, MACHINE_TRAVEL_TOLERANCE_IN } from './sbp/types';

export const RELIEF_MAGIC = 'MCRELIEF';
export const RELIEF_EXTENSION = '.mcrelief';

/** Triangle diagonal of every grid cell, named in image terms (row 0 at the top):
 *  'tr-bl' joins each cell's top-right and bottom-left nodes, 'tl-br' the other pair. */
export type ReliefDiagonal = 'tr-bl' | 'tl-br';

export interface ReliefHeader {
  format: 'meshcraft-relief';
  version: 1;
  units: 'in' | 'mm' | 'm';
  cols: number;
  rows: number;
  width: number;
  height: number;
  dtype: 'float32' | 'float64';
  rowOrder: 'top-down' | 'bottom-up';
  heightOrigin: 'panel-back';
  backing: number;
  stock: number;
  triangulation: ReliefDiagonal;
  mask: boolean;
  sha256: { heights: string; mask?: string };
  name?: string;
  source?: string;
  license?: string;
}

/** A parsed master in MeshCraft's grid convention: index j * cols + i, row j = 0 at world Y = 0
 *  (the image bottom), inches. */
export interface ReliefMaster {
  header: ReliefHeader;
  cols: number;
  rows: number;
  widthIn: number;
  heightIn: number;
  backingIn: number;
  stockIn: number;
  heightsIn: Float64Array;
  mask: Uint8Array | null;
  /** True when each cell splits along its (j, i)-(j + 1, i + 1) diagonal in MeshCraft's grid. */
  diagonalZ00Z11: boolean;
}

/** Size of one inch in each unit. Values are divided by it (correctly rounded), not multiplied by
 *  its reciprocal, so a millimetre or metre value converts to the nearest representable inch. */
const UNITS_PER_IN = { in: 1, mm: 25.4, m: 0.0254 } as const;

/** Heights stored as float32 metres round up to ~1e-8 in past a stock given as a decimal. */
const STOCK_TOLERANCE_IN = 1e-6;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function fail(msg: string): never {
  throw new Error(`Relief master: ${msg}`);
}

/** Image-row diagonal to MeshCraft cell diagonal. In MeshCraft's grid z00 = (j, i) is a cell's
 *  bottom-left in the image and z11 = (j + 1, i + 1) its top-right, so 'tr-bl' is z00-z11. */
export function diagonalIsZ00Z11(d: ReliefDiagonal): boolean {
  return d === 'tr-bl';
}

/** Check every header field's JSON type and value; nothing is coerced. A wrong type (null where a
 *  number belongs, a string for a boolean, an inherited key like "constructor" for units) is a
 *  contract violation, reported with the field's name. */
function validateHeader(raw: unknown): ReliefHeader {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('header must be a JSON object');
  const h = raw as Record<string, unknown>;
  const oneOf = (key: string, values: readonly unknown[]): void => {
    if (!values.includes(h[key])) fail(`${key} must be one of ${values.map(v => JSON.stringify(v)).join(', ')}, got ${JSON.stringify(h[key])}`);
  };
  const num = (key: string): void => {
    const v = h[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${key} must be a finite number, got ${JSON.stringify(v)}`);
  };
  oneOf('format', ['meshcraft-relief']);
  oneOf('version', [1]);
  if (typeof h.units !== 'string' || !Object.prototype.hasOwnProperty.call(UNITS_PER_IN, h.units))
    fail(`units must be one of "in", "mm", "m", got ${JSON.stringify(h.units)}`);
  oneOf('dtype', ['float32', 'float64']);
  oneOf('rowOrder', ['top-down', 'bottom-up']);
  oneOf('heightOrigin', ['panel-back']);
  oneOf('triangulation', ['tr-bl', 'tl-br']);
  for (const key of ['cols', 'rows', 'width', 'height', 'backing', 'stock']) num(key);
  if (typeof h.mask !== 'boolean') fail(`mask must be true or false, got ${JSON.stringify(h.mask)}`);
  const sha = h.sha256;
  if (typeof sha !== 'object' || sha === null || Array.isArray(sha)) fail('sha256 must be an object');
  const digests = sha as Record<string, unknown>;
  const hex = /^[0-9a-f]{64}$/;
  if (typeof digests.heights !== 'string' || !hex.test(digests.heights)) fail('sha256.heights must be a 64-digit lowercase hex string');
  if (h.mask && (typeof digests.mask !== 'string' || !hex.test(digests.mask))) fail('sha256.mask must be a 64-digit lowercase hex string');
  for (const key of ['name', 'source', 'license'])
    if (h[key] !== undefined && typeof h[key] !== 'string') fail(`${key} must be a string when present`);
  return h as unknown as ReliefHeader;
}

export async function parseReliefMaster(buf: ArrayBuffer): Promise<ReliefMaster> {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(0, 8)) !== RELIEF_MAGIC)
    fail('not a .mcrelief file (missing MCRELIEF signature)');
  const view = new DataView(buf);
  const hLen = view.getUint32(8, true);
  if (12 + hLen > bytes.length) fail('header runs past the end of the file');
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(12, 12 + hLen)));
  } catch (e) {
    fail(`header is not valid JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  const header = validateHeader(raw);
  const { cols, rows } = header;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols * rows > 50_000_000)
    fail(`bad grid size ${cols} x ${rows}`);
  const k = UNITS_PER_IN[header.units];
  const widthIn = header.width / k, heightIn = header.height / k;
  const backingIn = header.backing / k, stockIn = header.stock / k;
  for (const [label, v] of [['width', widthIn], ['height', heightIn], ['stock', stockIn]] as const)
    if (!(Number.isFinite(v) && v > 0)) fail(`${label} must be a positive number`);
  if (!(Number.isFinite(backingIn) && backingIn >= 0 && backingIn < stockIn)) fail('backing must be in [0, stock)');
  // Per axis, as stored: X is width, Y is height. A rotated fit is not a fit; nothing here rotates.
  const T = MACHINE_TRAVEL_TOLERANCE_IN;
  if (widthIn > MACHINE_TRAVEL_IN.x + T || heightIn > MACHINE_TRAVEL_IN.y + T || stockIn > MACHINE_TRAVEL_IN.z + T)
    fail(`${widthIn.toFixed(2)} (X) x ${heightIn.toFixed(2)} (Y) x ${stockIn.toFixed(2)} (Z) in exceeds the ${MACHINE_TRAVEL_IN.x} x ${MACHINE_TRAVEL_IN.y} x ${MACHINE_TRAVEL_IN.z} in machine`);

  const bpv = header.dtype === 'float32' ? 4 : 8;
  const dataStart = Math.ceil((12 + hLen) / 8) * 8;
  const n = cols * rows;
  const maskStart = dataStart + n * bpv;
  const expected = maskStart + (header.mask ? n : 0);
  if (bytes.length !== expected) fail(`file is ${bytes.length} bytes, header describes ${expected}`);
  const heightBytes = bytes.subarray(dataStart, maskStart);
  if ((await sha256Hex(heightBytes)) !== header.sha256?.heights) fail('heights checksum does not match the header');
  let maskBytes: Uint8Array | null = null;
  if (header.mask) {
    maskBytes = bytes.subarray(maskStart, expected);
    if ((await sha256Hex(maskBytes)) !== header.sha256.mask) fail('mask checksum missing or does not match the header');
  }

  const heightsIn = new Float64Array(n);
  const mask = maskBytes ? new Uint8Array(n) : null;
  const topDown = header.rowOrder === 'top-down';
  for (let r = 0; r < rows; r++) {
    const j = topDown ? rows - 1 - r : r;
    for (let c = 0; c < cols; c++) {
      const src = r * cols + c;
      const v = bpv === 4 ? view.getFloat32(dataStart + src * 4, true) : view.getFloat64(dataStart + src * 8, true);
      const h = v / k;
      if (!Number.isFinite(h)) fail(`non-finite height at row ${r}, column ${c}`);
      if (h < 0 || h > stockIn + STOCK_TOLERANCE_IN) fail(`height ${h.toFixed(5)} in at row ${r}, column ${c} is outside [0, stock]`);
      heightsIn[j * cols + c] = h;
      if (mask && maskBytes) mask[j * cols + c] = maskBytes[src] ? 1 : 0;
    }
  }
  return {
    header, cols, rows, widthIn, heightIn, backingIn, stockIn, heightsIn, mask,
    diagonalZ00Z11: diagonalIsZ00Z11(header.triangulation),
  };
}

/** Build a .mcrelief file. `heights` is row-major in `header.rowOrder`, in `header.units`; the
 *  checksums are filled in here. */
export async function encodeReliefMaster(
  header: Omit<ReliefHeader, 'sha256'>, heights: Float32Array | Float64Array, mask?: Uint8Array,
): Promise<ArrayBuffer> {
  const n = header.cols * header.rows;
  if (heights.length !== n || (mask && mask.length !== n)) throw new Error('Relief master: array size does not match cols x rows');
  if ((header.dtype === 'float32') !== (heights instanceof Float32Array)) throw new Error('Relief master: dtype does not match the array');
  const heightBytes = new Uint8Array(heights.buffer, heights.byteOffset, heights.byteLength);
  const full: ReliefHeader = {
    ...header,
    mask: mask !== undefined,
    sha256: { heights: await sha256Hex(heightBytes), ...(mask ? { mask: await sha256Hex(mask) } : {}) },
  };
  const json = new TextEncoder().encode(JSON.stringify(full));
  const dataStart = Math.ceil((12 + json.length) / 8) * 8;
  const out = new Uint8Array(dataStart + heightBytes.length + (mask ? n : 0));
  out.set(new TextEncoder().encode(RELIEF_MAGIC), 0);
  new DataView(out.buffer).setUint32(8, json.length, true);
  out.set(json, 12);
  out.set(heightBytes, dataStart);
  if (mask) out.set(mask, dataStart + heightBytes.length);
  return out.buffer;
}

/** Height of a grid's triangulated surface at panel position (x, y), inches: the same two triangles
 *  per cell the export writes (src/mesh-writer.ts), so a sample here lies on the exported surface. */
export function triangulatedHeight(
  z: Float64Array, cols: number, rows: number, widthIn: number, heightIn: number, diagonalZ00Z11: boolean,
  x: number, y: number,
): number {
  const fx = Math.min(cols - 1, Math.max(0, (x / widthIn) * (cols - 1)));
  const fy = Math.min(rows - 1, Math.max(0, (y / heightIn) * (rows - 1)));
  const i = Math.min(cols - 2, Math.floor(fx)), j = Math.min(rows - 2, Math.floor(fy));
  const u = fx - i, v = fy - j;
  const z00 = z[j * cols + i], z10 = z[j * cols + i + 1], z01 = z[(j + 1) * cols + i], z11 = z[(j + 1) * cols + i + 1];
  if (diagonalZ00Z11) return v <= u ? z00 + u * (z10 - z00) + v * (z11 - z10) : z00 + v * (z01 - z00) + u * (z11 - z01);
  return u + v <= 1 ? z00 + u * (z10 - z00) + v * (z01 - z00) : z11 + (1 - u) * (z01 - z11) + (1 - v) * (z10 - z11);
}

/** Preview grid for the viewport: `cols` x `rows` samples of the master's triangulated surface, as
 *  number[][] in MeshCraft order. At the master's own resolution it is the master exactly; below it,
 *  measure the loss with previewErrorIn. Display only: exports and toolpaths read the master. */
export function reliefPreviewGrid(m: ReliefMaster, cols: number, rows: number): number[][] {
  const out: number[][] = [];
  for (let j = 0; j < rows; j++) {
    out[j] = [];
    const y = (j / (rows - 1)) * m.heightIn;
    for (let i = 0; i < cols; i++)
      out[j][i] = triangulatedHeight(m.heightsIn, m.cols, m.rows, m.widthIn, m.heightIn, m.diagonalZ00Z11, (i / (cols - 1)) * m.widthIn, y);
  }
  return out;
}

/** Largest height difference, at the master's nodes, between the master and a preview grid drawn
 *  with the master's diagonal. 0 at native resolution. */
export function previewErrorIn(m: ReliefMaster, preview: number[][], cols: number, rows: number): number {
  const flat = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) flat[j * cols + i] = preview[j][i];
  let worst = 0;
  for (let j = 0; j < m.rows; j++) {
    const y = (j / (m.rows - 1)) * m.heightIn;
    for (let i = 0; i < m.cols; i++) {
      const p = triangulatedHeight(flat, cols, rows, m.widthIn, m.heightIn, m.diagonalZ00Z11, (i / (m.cols - 1)) * m.widthIn, y);
      worst = Math.max(worst, Math.abs(p - m.heightsIn[j * m.cols + i]));
    }
  }
  return worst;
}
