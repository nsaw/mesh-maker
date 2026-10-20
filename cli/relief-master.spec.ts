/**
 * Relief master data contract and export fidelity.
 * Run: npm run test:relief-master  (or: npx tsx cli/relief-master.spec.ts)
 *
 *   M1  encode -> parse round trip is exact (float32 and float64), units convert to inches, and the
 *       top-down / bottom-up row orders land on the same MeshCraft grid.
 *   M2  an asymmetric calibration relief (a raised "F" top left, a rising ramp, a dot bottom right)
 *       comes out of the STL writer unmirrored, uninverted, in inches, with the backing once.
 *   M3  every corrupt or out-of-contract file is rejected, not repaired.
 *   M4  the export surface is the master itself: preview Grid Resolution changes nothing exported.
 *   M5  the watertight STL is a closed, consistently oriented two-manifold with Euler
 *       characteristic 2, positive volume equal to the heightfield integral, no zero-area faces,
 *       and the master's declared diagonal in every cell.
 */
import { encodeReliefMaster, parseReliefMaster } from '../src/relief-master';
import type { ReliefHeader } from '../src/relief-master';
import { buildIndexedMesh, writeBinarySTL } from '../src/mesh-writer';
import type { ExportSurface } from '../src/mesh-writer';
import { getExportSurface, reliefMasterSurface } from '../src/export-surface';
import { STATE } from '../src/state';

let failures = 0;
function assert(condition: boolean, label: string, detail = ''): void {
  process.stdout.write(`  ${condition ? 'ok ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}\n`);
  if (!condition) failures++;
}

async function rejects(label: string, make: () => Promise<ArrayBuffer>, expect: RegExp): Promise<void> {
  let msg = '';
  try { await parseReliefMaster(await make()); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  assert(expect.test(msg), `rejects ${label}`, msg || 'accepted');
}

// Calibration relief, image rows top-down, millimetres: 4 x 3 in panel, 41 x 31 nodes.
const COLS = 41, ROWS = 31, MM = 25.4;
const BACK = 3.175, STOCK = 19.05;
function fixture(): Float64Array {
  const h = new Float64Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      let v = BACK + 3 * (c / (COLS - 1)); // ramp rising to the right
      const inF = (c >= 4 && c <= 6 && r >= 3 && r <= 15) || (r >= 3 && r <= 5 && c >= 4 && c <= 14) || (r >= 8 && r <= 10 && c >= 4 && c <= 11);
      if (inF) v += 6; // "F" in the image's top-left quadrant
      if (r === ROWS - 4 && c === COLS - 4) v += 9; // dot near the bottom-right
      h[r * COLS + c] = v;
    }
  return h;
}
const header = (over: Partial<ReliefHeader> = {}): Omit<ReliefHeader, 'sha256'> => ({
  format: 'meshcraft-relief', version: 1, units: 'mm', cols: COLS, rows: ROWS, width: 4 * MM, height: 3 * MM,
  dtype: 'float64', rowOrder: 'top-down', heightOrigin: 'panel-back', backing: BACK, stock: STOCK,
  triangulation: 'tr-bl', mask: false, ...over,
});

async function main(): Promise<void> {
  const h64 = fixture();
  const topDown = await parseReliefMaster(await encodeReliefMaster(header(), h64));

  process.stdout.write('M1 round trip, units, row order\n');
  {
    let exact = true;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (topDown.heightsIn[(ROWS - 1 - r) * COLS + c] !== h64[r * COLS + c] / MM) exact = false;
    assert(exact, 'float64 heights decode to source / 25.4 exactly, image row r -> grid row rows-1-r');
    assert(Math.abs(topDown.widthIn - 4) < 1e-12 && Math.abs(topDown.heightIn - 3) < 1e-12 && Math.abs(topDown.stockIn - 0.75) < 1e-12,
      'extents and stock convert from mm', `${topDown.widthIn} x ${topDown.heightIn} x ${topDown.stockIn} in`);
    const flipped = new Float64Array(COLS * ROWS);
    for (let r = 0; r < ROWS; r++) flipped.set(h64.subarray(r * COLS, r * COLS + COLS), (ROWS - 1 - r) * COLS);
    const bottomUp = await parseReliefMaster(await encodeReliefMaster(header({ rowOrder: 'bottom-up' }), flipped));
    assert(bottomUp.heightsIn.every((v, k) => v === topDown.heightsIn[k]), 'bottom-up file of the same relief gives the same grid');
    const h32 = Float32Array.from(h64);
    const m32 = await parseReliefMaster(await encodeReliefMaster(header({ dtype: 'float32' }), h32));
    let exact32 = true;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) if (m32.heightsIn[(ROWS - 1 - r) * COLS + c] !== h32[r * COLS + c] / MM) exact32 = false;
    assert(exact32, 'float32 heights decode bit-exactly (then / 25.4 in float64)');
  }

  process.stdout.write('M2 asymmetric calibration through the STL writer\n');
  {
    const surface = reliefMasterSurface(topDown, true) as ExportSurface;
    const stl = new DataView(writeBinarySTL(buildIndexedMesh(surface)));
    // Collect top vertices from the binary STL itself (float32), keyed by grid node.
    const dx = 4 / (COLS - 1), dy = 3 / (ROWS - 1);
    const z = new Map<number, number>();
    const count = stl.getUint32(80, true);
    for (let f = 0; f < count; f++)
      for (let v = 0; v < 3; v++) {
        const o = 84 + f * 50 + 12 + v * 12;
        const x = stl.getFloat32(o, true), y = stl.getFloat32(o + 4, true), zz = stl.getFloat32(o + 8, true);
        if (zz > 0) z.set(Math.round(y / dy) * COLS + Math.round(x / dx), zz);
      }
    let maxErr = 0;
    for (let j = 0; j < ROWS; j++)
      for (let i = 0; i < COLS; i++) maxErr = Math.max(maxErr, Math.abs((z.get(j * COLS + i) ?? NaN) - topDown.heightsIn[j * COLS + i]));
    assert(z.size === COLS * ROWS && maxErr < 1e-6, 'every node appears once on top with its master height', `max error ${maxErr.toExponential(2)} in`);
    const at = (x: number, y: number): number => z.get(Math.round(y / dy) * COLS + Math.round(x / dx)) ?? NaN;
    // "F" stem: image columns 4..6, rows 3..15 -> X 0.4..0.6 in, Y = 3 - r * 0.1 -> 1.5..2.7 in (upper left).
    const fStem = at(0.5, 2.2), mirrorX = at(4 - 0.5, 2.2), mirrorY = at(0.5, 3 - 2.2);
    assert(fStem - BACK / MM > 0.2 && mirrorX - BACK / MM < 0.2 && mirrorY - BACK / MM < 0.2,
      'the F is at the upper left, not mirrored in X or Y', `F ${fStem.toFixed(4)}, X-mirror ${mirrorX.toFixed(4)}, Y-mirror ${mirrorY.toFixed(4)} in`);
    assert(at(3.9, 1.5) > at(0.1, 1.5), 'the ramp rises to +X', `${at(0.1, 1.5).toFixed(4)} -> ${at(3.9, 1.5).toFixed(4)} in`);
    // Dot: image row ROWS-4 (Y = 0.3 in), column COLS-4 (X = 3.7 in): raised, so depth is not inverted.
    assert(at(3.7, 0.3) > at(3.6, 0.3) + 0.3, 'the dot is raised (depth not inverted)', `${at(3.7, 0.3).toFixed(4)} vs ${at(3.6, 0.3).toFixed(4)} in`);
    let minTop = Infinity;
    for (const v of z.values()) minTop = Math.min(minTop, v);
    assert(Math.abs(minTop - BACK / MM) < 1e-6, 'backing applied once (lowest top vertex = backing)', `${minTop.toFixed(6)} in`);
  }

  process.stdout.write('M3 contract violations are rejected\n');
  {
    const good = await encodeReliefMaster(header(), h64);
    await rejects('a wrong signature', async () => { const b = good.slice(0); new Uint8Array(b)[0] = 0x58; return b; }, /signature/);
    await rejects('a changed height byte', async () => { const b = good.slice(0); const u = new Uint8Array(b); u[u.length - 3] ^= 1; return b; }, /checksum/);
    await rejects('a truncated file', async () => good.slice(0, good.byteLength - 8), /bytes/);
    const over = Float64Array.from(h64); over[5] = STOCK + 1;
    await rejects('a height above the stock', () => encodeReliefMaster(header(), over), /outside \[0, stock\]/);
    const nan = Float64Array.from(h64); nan[7] = NaN;
    await rejects('a NaN height', () => encodeReliefMaster(header(), nan), /non-finite/);
    await rejects('a panel larger than the bed', () => encodeReliefMaster(header({ width: 40 * MM }), h64), /exceeds/);
    await rejects('an unknown triangulation', () => encodeReliefMaster(header({ triangulation: 'x' as never }), h64), /triangulation/);
    await rejects('backing at or above stock', () => encodeReliefMaster(header({ backing: STOCK }), h64), /backing/);
  }

  process.stdout.write('M4 preview resolution never reaches the export\n');
  {
    STATE.reliefMaster = topDown;
    STATE.mode = 'depthmap';
    STATE.watertight = true;
    const hashes: string[] = [];
    for (const res of [8, 20, 41]) {
      STATE.resolution = res;
      STATE.cols = res; STATE.rows = Math.round(res * 0.75);
      STATE.vertices = Array.from({ length: STATE.rows }, () => new Array<number>(STATE.cols).fill(0.123));
      const s = getExportSurface();
      if (typeof s === 'string') { assert(false, 'export surface', s); continue; }
      const bytes = new Uint8Array(writeBinarySTL(buildIndexedMesh(s)));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      hashes.push(Buffer.from(digest).toString('hex'));
    }
    assert(new Set(hashes).size === 1, 'identical STL bytes at preview resolutions 8, 20 and 41', hashes[0].slice(0, 16));
    STATE.mode = 'blend';
    const s = getExportSurface();
    assert(typeof s !== 'string' && s.cols === STATE.cols, 'outside DEPTH MAP mode the generated grid is exported instead');
    STATE.mode = 'depthmap';
    const low = Float64Array.from(h64); low[0] = 0.1; // 0.1 mm = 0.0039 in, under the 0.01 in watertight floor
    STATE.reliefMaster = await parseReliefMaster(await encodeReliefMaster(header(), low));
    const refused = getExportSurface();
    assert(typeof refused === 'string' && /watertight/.test(refused), 'a master below the watertight floor is refused, not raised', String(refused));
    STATE.reliefMaster = null;
  }

  process.stdout.write('M5 enclosure topology and triangulation\n');
  {
    const surface = reliefMasterSurface(topDown, true) as ExportSurface;
    const mesh = buildIndexedMesh(surface);
    const { positions: p, triangles: t } = mesh;
    const nv = p.length / 3, nf = t.length / 3;
    const directed = new Set<number>();
    let dup = false;
    for (let f = 0; f < nf; f++)
      for (let e = 0; e < 3; e++) {
        const a = t[f * 3 + e], b = t[f * 3 + (e + 1) % 3], key = a * nv + b;
        if (directed.has(key)) dup = true;
        directed.add(key);
      }
    let unpaired = 0;
    for (const key of directed) { const a = Math.floor(key / nv), b = key % nv; if (!directed.has(b * nv + a)) unpaired++; }
    const edges = directed.size / 2;
    assert(!dup && unpaired === 0, 'every edge is shared by exactly two faces in opposite directions', `${directed.size} directed edges`);
    assert(nv - edges + nf === 2, 'Euler characteristic 2', `V ${nv} - E ${edges} + F ${nf}`);
    let vol = 0, minArea = Infinity;
    for (let f = 0; f < nf; f++) {
      const [a, b, c] = [t[f * 3], t[f * 3 + 1], t[f * 3 + 2]].map(i => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
      const cx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
      const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      minArea = Math.min(minArea, 0.5 * Math.hypot(cx, cy, cz));
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    const z = topDown.heightsIn, dx = 4 / (COLS - 1), dy = 3 / (ROWS - 1);
    let integral = 0;
    for (let j = 0; j < ROWS - 1; j++)
      for (let i = 0; i < COLS - 1; i++) {
        const z00 = z[j * COLS + i], z10 = z[j * COLS + i + 1], z01 = z[(j + 1) * COLS + i], z11 = z[(j + 1) * COLS + i + 1];
        integral += ((z00 + z10 + z11) + (z00 + z11 + z01)) / 3 * dx * dy / 2;
      }
    assert(vol > 0 && Math.abs(vol - integral) < 1e-9 * integral, 'outward faces: volume positive and equal to the tr-bl heightfield integral',
      `${vol.toFixed(9)} vs ${integral.toFixed(9)} in^3`);
    assert(minArea > 0, 'no zero-area faces', `min ${minArea.toExponential(2)} in^2`);
    let fixed = true;
    for (let c = 0; c < (COLS - 1) * (ROWS - 1); c++) {
      const j = Math.floor(c / (COLS - 1)), i = c % (COLS - 1), a = j * COLS + i;
      const tri = Array.from(t.subarray(c * 6, c * 6 + 3));
      if (!(tri.includes(a) && tri.includes(a + COLS + 1))) fixed = false;
    }
    assert(fixed, "every cell splits along the master's declared diagonal (tr-bl = grid z00-z11)");
    const shortest = buildIndexedMesh({ ...surface, diagonal: 'shortest' });
    let differs = 0;
    for (let k = 0; k < mesh.topTriangles * 3; k++) if (shortest.triangles[k] !== t[k]) differs++;
    assert(differs > 0, 'control: the height-chosen diagonal differs on this relief, so the fixed one matters', `${differs} indices differ`);
  }

  if (failures === 0) {
    process.stdout.write('\nALL OK\n');
    process.exit(0);
  } else {
    process.stdout.write(`\n${failures} FAILURE(S)\n`);
    process.exit(1);
  }
}

void main();
