/**
 * Relief master round trip: load a .mcrelief exactly as the browser does, export it with the
 * browser's own mesh writer, and optionally generate the SBP and replay its emitted moves through
 * the independent cutter simulation.
 *
 *   npm run relief-roundtrip -- MASTER.mcrelief --out DIR [--no-watertight] [--crop x0,y0,x1,y1]
 *        [--sbp] [--replay FILE.sbp] [--sim-factor N] [--offset x,y] [--face x0,y0,x1,y1]
 *
 * --sim-factor (default 2) sets how much finer than the master the cut is simulated and compared,
 * against the master's own triangles. --replay checks an existing SBP instead of generating one
 * (a known-bad file must come out with a gouge). --offset is the work offset (default 0,0); part
 * plus offset must fit the machine.
 *
 * Coordinates are panel inches, X right and Y up from the bottom-left (MeshCraft's grid). --crop
 * keeps the master's samples inside the box, unchanged, and moves its corner to the origin (a test
 * cut of one region). --face names a region reported on its own, so a large flat background
 * cannot hide local damage in an average.
 *
 * Writes DIR/relief.stl and DIR/roundtrip.json; with --sbp also relief.sbp, cut-report.json,
 * predicted-stock.f32 and target / predicted / deviation PNGs. scripts/relief/verify_export.py
 * then checks the STL inside Blender against the master file independently.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseReliefMaster } from '../src/relief-master';
import type { ReliefMaster } from '../src/relief-master';
import { reliefMasterSurface, surfaceHeightmap } from '../src/export-surface';
import { buildIndexedMesh, writeBinarySTL } from '../src/mesh-writer';
import type { ExportSurface } from '../src/mesh-writer';
import { generateSBP } from '../src/sbp/generate';
import { getDefaultConfig, getEmbeddedTools } from '../src/sbp/tools';
import { MACHINE_TRAVEL_IN } from '../src/sbp/types';
import { compareCut, cutAgainstTriangles, parseSbp } from './cut-sim';
import type { CutComparison } from './cut-sim';
import { encodePngRgb } from './png';

type Box = [number, number, number, number];

function parseBox(s: string | undefined, flag: string): Box | null {
  if (s === undefined) return null;
  const v = s.split(',').map(Number);
  if (v.length !== 4 || !v.every(Number.isFinite) || v[2] <= v[0] || v[3] <= v[1]) throw new Error(`${flag} needs x0,y0,x1,y1`);
  return v as Box;
}

interface Options {
  master: string; out: string; watertight: boolean; sbp: boolean; crop: Box | null; face: Box | null;
  replay: string | null; simFactor: number; offset: [number, number];
}

function args(): Options {
  const a = process.argv.slice(2);
  const get = (flag: string): string | undefined => { const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : undefined; };
  const master = a.find(x => x.endsWith('.mcrelief'));
  const out = get('--out');
  if (!master || !out) throw new Error('usage: relief-roundtrip MASTER.mcrelief --out DIR [--no-watertight] [--crop x0,y0,x1,y1] ' +
    '[--sbp] [--replay FILE.sbp] [--sim-factor N] [--offset x,y] [--face x0,y0,x1,y1]');
  const simFactor = Number(get('--sim-factor') ?? 2);
  if (!Number.isInteger(simFactor) || simFactor < 1) throw new Error('--sim-factor needs a positive integer');
  const offset = (get('--offset') ?? '0,0').split(',').map(Number);
  if (offset.length !== 2 || !offset.every(Number.isFinite)) throw new Error('--offset needs x,y');
  const replay = get('--replay') ?? null;
  return { master, out, watertight: !a.includes('--no-watertight'), sbp: a.includes('--sbp') || replay !== null,
    crop: parseBox(get('--crop'), '--crop'), face: parseBox(get('--face'), '--face'), replay, simFactor,
    offset: [offset[0], offset[1]] };
}

/** The master's samples inside `box`, unchanged, with the box corner moved to the origin. */
function cropMaster(m: ReliefMaster, box: Box): ReliefMaster {
  const dx = m.widthIn / (m.cols - 1), dy = m.heightIn / (m.rows - 1);
  const i0 = Math.max(0, Math.ceil(box[0] / dx - 1e-9)), i1 = Math.min(m.cols - 1, Math.floor(box[2] / dx + 1e-9));
  const j0 = Math.max(0, Math.ceil(box[1] / dy - 1e-9)), j1 = Math.min(m.rows - 1, Math.floor(box[3] / dy + 1e-9));
  const cols = i1 - i0 + 1, rows = j1 - j0 + 1;
  const heightsIn = new Float64Array(cols * rows);
  const mask = m.mask ? new Uint8Array(cols * rows) : null;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      heightsIn[j * cols + i] = m.heightsIn[(j + j0) * m.cols + i + i0];
      if (mask && m.mask) mask[j * cols + i] = m.mask[(j + j0) * m.cols + i + i0];
    }
  return { ...m, cols, rows, widthIn: (cols - 1) * dx, heightIn: (rows - 1) * dy, heightsIn, mask };
}

/** Hillshade under a raking light from the upper left, row 0 of the image at the top (max Y). */
function shade(z: Float64Array, cols: number, rows: number, dx: number, dy: number): Uint8Array {
  const out = new Uint8Array(cols * rows * 3);
  const L = [-0.55, 0.45, 0.7], ln = Math.hypot(...L);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const zx = (z[j * cols + Math.min(cols - 1, i + 1)] - z[j * cols + Math.max(0, i - 1)]) / (2 * dx);
      const zy = (z[Math.min(rows - 1, j + 1) * cols + i] - z[Math.max(0, j - 1) * cols + i]) / (2 * dy);
      const n = Math.hypot(zx, zy, 1);
      const s = Math.max(0, (-zx * L[0] - zy * L[1] + L[2]) / (n * ln));
      const v = Math.round(255 * s);
      const o = ((rows - 1 - j) * cols + i) * 3;
      out[o] = out[o + 1] = out[o + 2] = v;
    }
  return out;
}

function sha256(b: Uint8Array): string {
  return createHash('sha256').update(b).digest('hex');
}

function boxMask(box: Box, cols: number, dx: number, dy: number): (k: number) => boolean {
  return (k: number): boolean => {
    const x = (k % cols) * dx, y = Math.floor(k / cols) * dy;
    return x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
  };
}

async function main(): Promise<void> {
  const opt = args();
  mkdirSync(opt.out, { recursive: true });
  const t0 = performance.now();
  const bytes = readFileSync(opt.master);
  const full = await parseReliefMaster(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const m = opt.crop ? cropMaster(full, opt.crop) : full;
  const surface = reliefMasterSurface(m, opt.watertight);
  if (typeof surface === 'string') throw new Error(surface);
  const mesh = buildIndexedMesh(surface);
  const stl = new Uint8Array(writeBinarySTL(mesh));
  writeFileSync(join(opt.out, 'relief.stl'), stl);
  const roundtrip = {
    master: opt.master, masterSha256Heights: full.header.sha256.heights,
    crop: opt.crop, cols: m.cols, rows: m.rows, widthIn: m.widthIn, heightIn: m.heightIn,
    stockIn: m.stockIn, backingIn: m.backingIn, triangulation: m.header.triangulation, watertight: opt.watertight,
    triangles: mesh.triangles.length / 3, topTriangles: mesh.topTriangles, stlBytes: stl.length, stlSha256: sha256(stl),
    exportSeconds: (performance.now() - t0) / 1000,
  };
  writeFileSync(join(opt.out, 'roundtrip.json'), JSON.stringify(roundtrip, null, 2));
  process.stdout.write(`${JSON.stringify(roundtrip)}\n`);
  if (!opt.sbp) return;
  await cutReport(m, surface, opt);
}

async function cutReport(m: ReliefMaster, surface: ExportSurface, opt: Options): Promise<void> {
  // Safe and home Z follow the master's stock (the defaults assume 0.75 in stock); generateSBP
  // refuses either beyond the 6 in Z travel rather than this script clamping them.
  const base = getDefaultConfig();
  const safeZ = Math.min(MACHINE_TRAVEL_IN.z, Math.max(base.safeZ, m.stockIn + 0.1));
  const config = { ...base, materialX: m.widthIn, materialY: m.heightIn, materialZ: m.stockIn,
    // Home Z capped at the Z travel like the browser's slider; never below safe Z.
    safeZ, homeZ: Math.max(safeZ, Math.min(MACHINE_TRAVEL_IN.z, Math.max(base.homeZ, safeZ + 0.5))),
    offsetX: opt.offset[0], offsetY: opt.offset[1] };
  const t1 = performance.now();
  let sbp: string, stats: unknown = null;
  if (opt.replay) {
    sbp = readFileSync(opt.replay, 'utf8');
  } else {
    ({ sbp, stats } = generateSBP(surfaceHeightmap(surface), config));
    writeFileSync(join(opt.out, 'relief.sbp'), sbp);
  }
  const genSeconds = (performance.now() - t1) / 1000;
  const tools = new Map(getEmbeddedTools(config.materialProfile).map(t => [t.name, t]));
  const t2 = performance.now();
  // Simulated and compared on a grid opt.simFactor times finer than the master, against the
  // master's declared triangles, so damage between the master's nodes counts.
  const fine = cutAgainstTriangles(parseSbp(sbp), tools, m.heightsIn, m.cols, m.rows, m.widthIn, m.heightIn,
    surface.diagonal, config.offsetX, config.offsetY, m.stockIn, opt.simFactor);
  const simSeconds = (performance.now() - t2) / 1000;
  const { cols, rows, cellX: dx, cellY: dy, stock, target } = fine;
  const regions: Record<string, CutComparison> = { all: compareCut(stock, target) };
  if (m.mask) {
    const mask = m.mask, f = opt.simFactor;
    regions.foreground = compareCut(stock, target, k => mask[Math.round(Math.floor(k / cols) / f) * m.cols + Math.round((k % cols) / f)] === 1);
  }
  if (opt.face) regions.face = compareCut(stock, target, boxMask(opt.face, cols, dx, dy));
  const report = {
    sbp: opt.replay ?? 'generated', finishingTool: config.finishingTool.name, roughingTool: config.roughingTool.name,
    stepoverIn: config.finishingTool.cutting.stepover, offsetIn: opt.offset, stats, rapidCollisions: fine.sim.rapidCollisions,
    movesSimulated: fine.sim.movesSimulated, sbpBytes: sbp.length, generateSeconds: genSeconds, simulateSeconds: simSeconds,
    sampling: {
      simFactor: opt.simFactor, simCellIn: [dx, dy], masterCellIn: [m.widthIn / (m.cols - 1), m.heightIn / (m.rows - 1)],
      note: 'Stock and target are compared at every fine sample on the master\'s declared triangles. A gouge narrower than ' +
        'one fine cell can fall between samples; cutter stamps are spaced a quarter fine cell along each move.',
    },
    face: opt.face, regions,
  };
  writeFileSync(join(opt.out, 'cut-report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(opt.out, 'predicted-stock.f32'), Buffer.from(new Float32Array(stock).buffer));
  writeFileSync(join(opt.out, 'target-lit.png'), encodePngRgb(cols, rows, shade(target, cols, rows, dx, dy)));
  const lit = shade(stock, cols, rows, dx, dy);
  writeFileSync(join(opt.out, 'predicted-lit.png'), encodePngRgb(cols, rows, lit));
  // Deviation over the predicted surface: red = gouge (stock below target), blue = stock left.
  const dev = new Uint8Array(lit);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i, d = stock[k] - target[k], o = ((rows - 1 - j) * cols + i) * 3;
      if (d < -0.0005) { dev[o] = 255; dev[o + 1] = 0; dev[o + 2] = 0; }
      else if (d > 0.002) { const w = Math.min(1, d / 0.02); dev[o] = Math.round(dev[o] * (1 - w)); dev[o + 1] = Math.round(dev[o + 1] * (1 - w)); dev[o + 2] = Math.round(dev[o + 2] * (1 - w) + 255 * w); }
    }
  writeFileSync(join(opt.out, 'deviation.png'), encodePngRgb(cols, rows, dev));
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
