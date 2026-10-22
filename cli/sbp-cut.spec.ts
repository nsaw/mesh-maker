/**
 * Tool compensation and emitted-toolpath verification.
 * Run: npm run test:cut  (or: npx tsx cli/sbp-cut.spec.ts)
 *
 *   C1  compensateForTool equals a brute-force oracle (also with roughing's segment and slack margins), max over EVERY grid point of
 *       H(p) - profile(|p - x|), with the oracle's profile taken from cli/cut-sim.ts (an independent
 *       derivation), on an anisotropic grid, for every cutter type in the tool database.
 *   C2  the two 2026-10-19 audit probes: a flat 0.500 in plane under a 0.1 in ball stays 0.500
 *       (old: 0.473205), and a flat end mill over a 0.5 in peak stays at 0.5 (old: 0.1).
 *   C3  full pipeline: generateSBP -> SBP text -> independent swept-cutter replay -> no gouge on a
 *       plane, ramp, narrow peak, bowl, an asymmetric relief and a cliff edge along the raster;
 *       plane residual within the scallop.
 *   C4  a grid whose row spacing differs from its column spacing is cut in register (old: rows
 *       placed at the column spacing, the last row off by up to a cell).
 *   C5  coarse grids (0.09 in cells): finishing and roughing checked against the triangulated
 *       surface BETWEEN nodes (a node-only drop-cutter went 0.089 in deep on a near-flat ramp).
 *   C6  the drop-cutter equals a dense sampling of the triangulated surface for every cutter type.
 *   C7  the finishing fallback's hold height, max(ends) + L |ab| / 2, bounds the exact tip between.
 *   C8  every emitted finishing move stays above the exact tip along its length (16 samples per
 *       move), on a cliff-and-spike surface and a wall at three raster angles, for every finishing
 *       cutter type (quarter-point chord checks passed 1.1 thou under it).
 *   C9  a flat end mill (or radius-0 radiused cutter) is refused for finishing; a home Z below safe Z
 *       is refused; small-radius radiused cutters finish with finite, non-gouging moves.
 *   C10 cli/stl-to-sbp.ts does not look up a tool named for a pass that is switched off (an unknown
 *       --finishing-tool with --roughing-only exported nothing and exited 1), and still refuses one
 *       for a pass that runs.
 *   C11 profileOf (the drop cutter's precomputed profile) equals toolZOffset bit for bit for every
 *       tool in every library, plus edge shapes, out past every tool's radius (no cone, no tip, a V-bit wider at the tip than its edge).
 *
 * Every cut is simulated on a grid of at most 0.005 in, finer than the target, and compared with the
 * triangulated surface the export describes (cli/cut-sim.ts triangulatedTarget).
 */
import { compensateForTool, createDropCutter, createTipLipschitzField, profileOf, toolZOffset } from '../src/sbp/compensate';
import { generateSBP } from '../src/sbp/generate';
import { generateFinishing } from '../src/sbp/finishing';
import { stateToHeightmap } from '../src/sbp/heightmap';
import { getDefaultConfig, getEmbeddedTools } from '../src/sbp/tools';
import { ToolType, type Heightmap, type SbpConfig, type ToolDef } from '../src/sbp/types';
import { compareCut, cutterProfile, parseSbp, simulateCut, triangulatedTarget } from './cut-sim';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
function assert(condition: boolean, label: string, detail = ''): void {
  process.stdout.write(`  ${condition ? 'ok ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}\n`);
  if (!condition) failures++;
}

function hm(z: Float64Array, rows: number, cols: number, cellX: number, cellY: number): Heightmap {
  return { z, rows, cols, originX: 0, originY: 0, cellSize: cellX, cellSizeY: cellY,
    meshX: cellX * (cols - 1), meshY: cellY * (rows - 1) };
}

const tools = getEmbeddedTools('general');
const toolOf = (name: string): ToolDef => {
  const t = tools.find(x => x.name.includes(name));
  if (!t) throw new Error(`tool ${name} missing`);
  return t;
};
const ball: ToolDef = { ...toolOf('Chipbreaker'), name: 'probe ball R0.1', type: 0, diameter: 0.2, tipRadius: 0.1, halfAngle: 0 };
const radiused: ToolDef = { ...toolOf('Chipbreaker'), name: 'probe radiused', type: 2, diameter: 0.25, tipRadius: 0.05, halfAngle: 0 };
const cutters: ToolDef[] = [toolOf('R1/16-S1/4'), toolOf('R1/32-S1/4'), toolOf('Chipbreaker'), toolOf('60-deg'),
  toolOf('90-deg'), ball, radiused];

// ---------- C1 brute-force oracle ----------
process.stdout.write('C1 compensation equals a brute-force max over every grid point\n');
{
  const rows = 37, cols = 43, cx = 0.011, cy = 0.0137;
  const z = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = c * cx, y = r * cy;
      z[r * cols + c] = 0.3 + 0.08 * Math.sin(9 * x) * Math.cos(7 * y) + 0.05 * x
        + ((r * 7 + c * 13) % 29 === 0 ? 0.12 : 0) - ((r * 11 + c * 5) % 31 === 0 ? 0.09 : 0);
    }
  for (const tool of cutters) {
    const got = compensateForTool(hm(z, rows, cols, cx, cy), tool).z;
    let maxErr = 0, gouge = 0;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        let best = -Infinity;
        for (let rr = 0; rr < rows; rr++)
          for (let cc = 0; cc < cols; cc++) {
            const v = z[rr * cols + cc] - cutterProfile(tool, Math.hypot((cc - c) * cx, (rr - r) * cy));
            if (v > best) best = v;
          }
        maxErr = Math.max(maxErr, Math.abs(got[r * cols + c] - best));
        gouge = Math.max(gouge, best - got[r * cols + c]);
      }
    assert(maxErr <= 1e-12, `${tool.name}: matches the oracle`, `max |error| ${maxErr.toExponential(2)} in, gouge ${gouge.toExponential(2)} in`);
  }
}

// C1b: the node-to-node margins roughing uses (segment, and slack for the surface between nodes).
{
  const rows = 23, cols = 27, cx = 0.019, cy = 0.023, seg = 0.019, slack = Math.hypot(0.019, 0.023);
  const z = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) z[r * cols + c] = 0.3 + 0.1 * Math.sin(5 * c * cx) * Math.cos(4 * r * cy) + ((r * 3 + c * 7) % 17 === 0 ? 0.1 : 0);
  for (const tool of [toolOf('R1/16-S1/4'), toolOf('Chipbreaker'), ball]) {
    const got = compensateForTool(hm(z, rows, cols, cx, cy), tool, seg, slack).z;
    let maxErr = 0;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        let best = -Infinity;
        for (let rr = 0; rr < rows; rr++)
          for (let cc = 0; cc < cols; cc++) {
            const e = Math.max(0, Math.hypot((cc - c) * cx, (rr - r) * cy) - slack);
            const v = z[rr * cols + cc] - cutterProfile(tool, Math.sqrt(Math.max(0, e * e - seg * seg)));
            if (v > best) best = v;
          }
        maxErr = Math.max(maxErr, Math.abs(got[r * cols + c] - best));
      }
    assert(maxErr <= 1e-12, `${tool.name}: segment + slack margins match the oracle`, `max |error| ${maxErr.toExponential(2)} in`);
  }
}

// ---------- C2 audit probes ----------
process.stdout.write('C2 2026-10-19 audit probes\n');
{
  const flat = new Float64Array(49).fill(0.5);
  const tip = compensateForTool(hm(flat, 7, 7, 0.05, 0.05), ball).z;
  assert(Math.max(...tip.map(v => Math.abs(v - 0.5))) === 0, 'flat 0.500 in plane, 0.1 in ball: tip stays 0.500 everywhere',
    `centre ${tip[24].toFixed(6)} (old 0.473205)`);
  const peak = new Float64Array(49).fill(0.1); peak[24] = 0.5;
  const em: ToolDef = { ...ball, name: 'probe end mill', type: 1, diameter: 0.2, tipRadius: 0 };
  const tp = compensateForTool(hm(peak, 7, 7, 0.05, 0.05), em).z;
  // 0.2 in end mill, 0.05 in cells: the peak is under the cutter from 2 cells (0.1 in) away.
  assert(tp[24] === 0.5 && tp[23] === 0.5 && tp[22] === 0.5 && tp[21] === 0.1,
    'end mill over a 0.5 in peak: tip 0.5 over the peak and within the cutter radius, 0.1 beyond it',
    `peak ${tp[24]} (old 0.1), 1 cell ${tp[23]}, 2 cells ${tp[22]}, 3 cells ${tp[21]}`);
}

// ---------- C3 full pipeline through the emitted SBP ----------
const GOUGE_TOL = 0.0005; // stamp spacing + bilinear sampling between nodes; see the notes printed below

/** Sim spacing: half the target cell, and at most a sixth of it on coarse grids, so the surface
 *  between nodes is sampled at least 2 to 6 times per cell. */
const simFactor = (cell: number): number => Math.max(2, Math.min(6, Math.ceil(cell / 0.005)));

function cutCheck(name: string, z: Float64Array, rows: number, cols: number, meshX: number, meshY: number,
  planeResidual?: number, configOver: Partial<SbpConfig> = {}): void {
  const heightmap = stateToHeightmap(Array.from({ length: rows }, (_, r) => Array.from(z.subarray(r * cols, r * cols + cols))),
    rows, cols, meshX, meshY);
  const config: SbpConfig = { ...getDefaultConfig(), materialX: meshX, materialY: meshY, materialZ: 0.75, ...configOver };
  const { sbp } = generateSBP(heightmap, config);
  const sections = parseSbp(sbp);
  const byName = new Map(tools.map(t => [t.name, t]));
  // The simulation runs on a grid finer than the target's and is compared with the triangulated
  // surface the export describes, so a gouge between the target's nodes shows. Spacing comes from
  // the fixture, not from the heightmap under test: a generator that mis-sets its spacing must show
  // up as misregistered cuts, not as a simulation of nothing.
  const factor = simFactor(Math.max(meshX / (cols - 1), meshY / (rows - 1)));
  const fine = triangulatedTarget(z, cols, rows, 'shortest', factor);
  const sim = simulateCut(sections, byName, { cols: fine.cols, rows: fine.rows, originX: config.offsetX, originY: config.offsetY,
    cellX: meshX / (fine.cols - 1), cellY: meshY / (fine.rows - 1) }, 0.75);
  const cmp = compareCut(sim.stock, fine.z);
  // Not vacuous: the cut must remove most of the stock above the target (finishing), or at least
  // half of it (roughing alone, whose flat cutter cannot follow curved ground).
  let above = 0;
  for (let k = 0; k < fine.z.length; k++) above += 0.75 - fine.z[k];
  const removed = 1 - (cmp.meanResidual * fine.z.length) / above;
  assert(removed > (config.finishingEnabled ? 0.95 : 0.5), `${name}: the cut reached the target (simulation is not vacuous)`,
    `${(removed * 100).toFixed(1)}% of the stock above the target removed, sim grid ${fine.cols} x ${fine.rows}`);
  assert(sim.rapidCollisions === 0, `${name}: no rapid move passes through stock`, `${sim.movesSimulated} moves replayed`);
  assert(cmp.maxGouge <= GOUGE_TOL, `${name}: no gouge below the target, between nodes included`,
    `max gouge ${cmp.maxGouge.toFixed(5)} in, residual p99 ${cmp.residualP99.toFixed(4)} in, mean ${cmp.meanResidual.toFixed(4)} in`);
  if (planeResidual !== undefined)
    assert(cmp.residualP99 <= planeResidual, `${name}: residual within the finishing scallop`,
      `p99 ${cmp.residualP99.toFixed(5)} in vs ${planeResidual.toFixed(5)} in`);
}

process.stdout.write('C3 generateSBP -> emitted SBP -> independent swept-cutter replay\n');
{
  const rows = 121, cols = 121, size = 1.2;
  const field = (f: (x: number, y: number) => number): Float64Array => {
    const z = new Float64Array(rows * cols);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) z[r * cols + c] = f(c * size / (cols - 1), r * size / (rows - 1));
    return z;
  };
  const fin = toolOf('R1/16-S1/4');
  const R = fin.tipRadius, s = fin.cutting.stepover;
  const scallop = R - Math.sqrt(R * R - (s / 2) ** 2);
  cutCheck('plane 0.5', field(() => 0.5), rows, cols, size, size, scallop + GOUGE_TOL);
  cutCheck('ramp 0.2 -> 0.6', field(x => 0.2 + 0.2 * x), rows, cols, size, size);
  cutCheck('narrow peak', field((x, y) => 0.2 + 0.3 * Math.exp(-((x - 0.6) ** 2 + (y - 0.6) ** 2) / (2 * 0.05 ** 2))), rows, cols, size, size);
  // Spherical cap 0.25 in deep, sphere radius 0.8 in, cut into a 0.6 in plane.
  cutCheck('spherical bowl', field((x, y) => {
    const d2 = (x - 0.6) ** 2 + (y - 0.6) ** 2;
    return 0.6 - Math.max(0, Math.sqrt(Math.max(0, 0.64 - d2)) - 0.55);
  }), rows, cols, size, size);
  // Asymmetric: an L-shaped plateau, a step and a tilted face, so mirroring or rotation would show.
  cutCheck('asymmetric L + step', field((x, y) => (x < 0.45 && y > 0.25 ? 0.55 : 0.25) + (y < 0.25 && x > 0.8 ? 0.1 * (x - 0.8) : 0)),
    rows, cols, size, size);
}

// ---------- C4 anisotropic grid ----------
// A 0.07 in occlusion cliff running at 44 deg, near the 45 deg finishing raster, below a sloped,
// folded face: the cutter's envelope dips under a straight move away from the move's midpoint. With
// a midpoint-only chord check this gouged 0.00085 in (on the Monti master, 0.0022 in at one cliff).
{
  const rows = 121, cols = 121, size = 1.2, a = 44 * Math.PI / 180;
  const z = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = c * size / (cols - 1) - 0.6, y = r * size / (rows - 1) - 0.6, s = x * Math.cos(a) + y * Math.sin(a);
      z[r * cols + c] = s < 0 ? 0.64 + 0.3 * s + 0.01 * Math.sin(25 * (x * Math.sin(a) - y * Math.cos(a))) : 0.567 - 0.05 * s;
    }
  cutCheck('cliff edge along the raster', z, rows, cols, size, size);
}

process.stdout.write('C4 row spacing differs from column spacing\n');
{
  const rows = 150, cols = 201, meshX = 2, meshY = 1.7;
  const z = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) z[r * cols + c] = 0.2 + 0.25 * (r / (rows - 1));
  const h = stateToHeightmap([[0, 0], [0, 0]], 2, 2, 1, 1);
  assert(h.cellSizeY === 1, 'stateToHeightmap carries the row spacing');
  const hh = stateToHeightmap(Array.from({ length: rows }, (_, r) => Array.from(z.subarray(r * cols, r * cols + cols))), rows, cols, meshX, meshY);
  assert(Math.abs(hh.cellSizeY * (rows - 1) - meshY) < 1e-12 && Math.abs(hh.cellSize * (cols - 1) - meshX) < 1e-12,
    'last row sits at meshY and last column at meshX', `cell ${String(hh.cellSize)} x ${String(hh.cellSizeY)} in`);
  cutCheck('Y ramp on a 0.01 x 0.0114 in grid', z, rows, cols, meshX, meshY);
}

// ---------- C5 coarse grids: the surface between nodes ----------
process.stdout.write('C5 coarse grid (0.09 in cells, a 36 in panel at 400 columns): cut checked between nodes\n');
{
  const rows = 31, cols = 31, size = 2.7;
  const field = (f: (x: number, y: number) => number): Float64Array => {
    const z = new Float64Array(rows * cols);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) z[r * cols + c] = f(c * size / (cols - 1), r * size / (rows - 1));
    return z;
  };
  // The reviewer's probe: a near-flat ramp, where the node-only drop-cutter went 0.089 in deep.
  const ramp = field(x => 0.5 + 0.005 * x);
  cutCheck('coarse near-flat ramp', ramp, rows, cols, size, size);
  const dome = field((x, y) => 0.25 + 0.3 * Math.max(0, 1 - ((x - 1.35) ** 2 + (y - 1.35) ** 2) / 0.8));
  cutCheck('coarse dome', dome, rows, cols, size, size);
  // Roughing alone with no leave stock: its own clearance, not hidden under the 0.02 in allowance.
  cutCheck('coarse dome, roughing only, no leave stock', dome, rows, cols, size, size, undefined,
    { finishingEnabled: false, leaveStock: 0 });
  const step = field((x, y) => (x < 1.2 && y > 0.9 ? 0.55 : 0.25));
  cutCheck('coarse step, roughing only, no leave stock', step, rows, cols, size, size, undefined,
    { finishingEnabled: false, leaveStock: 0 });
}

// ---------- C6 drop-cutter exactness against the triangulated surface ----------
process.stdout.write('C6 drop-cutter equals a dense sampling of the triangulated surface\n');
{
  const rows = 9, cols = 9, size = 0.4;
  const z = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) z[r * cols + c] = 0.3 + 0.08 * Math.sin(9 * c * size / 8 + 2 * r * size / 8) + (r === 4 && c === 4 ? 0.05 : 0);
  const h = stateToHeightmap(Array.from({ length: rows }, (_, r) => Array.from(z.subarray(r * cols, r * cols + cols))), rows, cols, size, size);
  const dense = triangulatedTarget(z, cols, rows, 'shortest', 60);
  const dx = size / (dense.cols - 1);
  let gMax = 0;
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const k = r * cols + c, e = size / (cols - 1);
      gMax = Math.max(gMax, Math.abs(z[k + 1] - z[k]) / e, Math.abs(z[k + cols] - z[k]) / e, Math.abs(z[k + cols + 1] - z[k]) / e);
    }
  gMax *= Math.SQRT2; // a facet's gradient from its two edge slopes
  for (const tool of [toolOf('R1/16-S1/4'), toolOf('Chipbreaker'), toolOf('60-deg'), ball, radiused]) {
    const drop = createDropCutter(h, tool);
    let worstLow = 0, worstHigh = 0;
    for (let k = 0; k < 40; k++) {
      const qx = 0.05 + 0.3 * ((k * 0.618) % 1), qy = 0.05 + 0.3 * ((k * 0.414) % 1);
      let best = -Infinity;
      for (let R = 0; R < dense.rows; R++)
        for (let C = 0; C < dense.cols; C++) {
          const v = dense.z[R * dense.cols + C] - cutterProfile(tool, Math.hypot(C * dx - qx, R * dx - qy));
          if (v > best) best = v;
        }
      const got = drop(qx, qy);
      worstLow = Math.max(worstLow, best - got); // drop below a real contact: a gouge
      worstHigh = Math.max(worstHigh, got - best);
    }
    // Dense sampling misses the exact contact by at most a sample spacing times the steepest of the
    // surface and the cutter's side there (a flat end mill touches on its rim, a V-bit on its cone).
    const side = tool.type === 3 ? 1 / Math.tan(tool.halfAngle) : 0;
    const allowHigh = dx * (gMax + side) + 1e-5;
    assert(worstLow <= 1e-9 && worstHigh <= allowHigh, `${tool.name}: drop-cutter matches the triangulated surface`,
      `never below by more than ${worstLow.toExponential(1)} in, above dense sampling by ${worstHigh.toExponential(1)} in (allowed ${allowHigh.toExponential(1)})`);
  }
}

// ---------- C7 the finishing fallback's hold height ----------
process.stdout.write('C7 tip height between two points never exceeds max(ends) + L |ab| / 2, L local\n');
{
  // Cliffs, a spike and a ramp: the surfaces where the fallback fires. Steps of 0.005 in down to
  // 0.00008 in (the last split), at every orientation, away from the panel edge.
  const rows = 41, cols = 41, size = 0.8;
  const z = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = c * size / (cols - 1), y = r * size / (rows - 1);
      z[r * cols + c] = 0.3 + (x + 0.3 * y > 0.45 ? 0.2 : 0) + (r === 20 && c === 12 ? 0.15 : 0) + 0.05 * Math.sin(12 * x * y);
    }
  const h = stateToHeightmap(Array.from({ length: rows }, (_, r) => Array.from(z.subarray(r * cols, r * cols + cols))), rows, cols, size, size);
  for (const tool of [toolOf('R1/16-S1/4'), toolOf('60-deg'), ball, toolOf('Chipbreaker')]) {
    const drop = createDropCutter(h, tool), field = createTipLipschitzField(h, tool, 0.005);
    let worst = -Infinity, Lmax = 0;
    for (let k = 0; k < 400; k++) {
      const ax = 0.15 + 0.5 * ((k * 0.618034) % 1), ay = 0.15 + 0.5 * ((k * 0.414214) % 1);
      const len = [0.005, 0.0012, 0.0003, 0.00008][k % 4], ang = k * 2.39996;
      const bx = ax + len * Math.cos(ang), by = ay + len * Math.sin(ang);
      const L = field((ax + bx) / 2, (ay + by) / 2);
      const za = drop(ax, ay), zb = drop(bx, by), bound = Math.max(za, zb) + L * len / 2;
      Lmax = Math.max(Lmax, L);
      for (let q = 1; q < 8; q++) worst = Math.max(worst, drop(ax + (bx - ax) * q / 8, ay + (by - ay) * q / 8) - bound);
    }
    assert(worst <= 1e-12, `${tool.name}: the hold height bounds every interior point`, `worst excess ${worst.toExponential(2)} in, local L up to ${Lmax.toFixed(2)}`);
  }
}

// ---------- C8 every emitted finishing move against the exact tip ----------
process.stdout.write('C8 emitted finishing moves stay on or above the exact tip along their length\n');
{
  // The cliff-and-spike surface of C7 at stepover 0.02 in (blind review, PR #30 round 1): with the
  // chord checked only at its quarter points, a move passed 1.1 thou under the tip at t = 0.125.
  const rows = 41, cols = 41, size = 0.8;
  const v = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => {
    const x = c * size / (cols - 1), y = r * size / (rows - 1);
    return 0.3 + (x + 0.3 * y > 0.45 ? 0.2 : 0) + (r === 20 && c === 12 ? 0.15 : 0) + 0.05 * Math.sin(12 * x * y);
  }));
  const cliff = stateToHeightmap(v, rows, cols, size, size);
  // Verification pass, PR #30 round 1: a 0.3 in wall across the raster at 37 deg.
  const wall = stateToHeightmap(Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => {
    const x = c * size / (cols - 1), y = r * size / (rows - 1);
    return 0.25 + (x * Math.cos(0.6) + y * Math.sin(0.6) > 0.5 ? 0.3 : 0);
  })), rows, cols, size, size);
  const cases: Array<[string, Heightmap, number]> = [['cliff and spike', cliff, 0], ['cliff and spike', cliff, 45], ['wall', wall, 37]];
  // Finishing cutters only: generateSBP refuses a flat end mill for finishing (see C9).
  for (const tool of [toolOf('R1/16-S1/4'), toolOf('60-deg'), ball, radiused])
    for (const [surface, h, angle] of cases) {
      const cfg: SbpConfig = { ...getDefaultConfig(), materialX: size, materialY: size, materialZ: 0.75, offsetX: 0, offsetY: 0,
        finishRasterAngle: angle, finishingTool: { ...tool, cutting: { ...tool.cutting, stepover: 0.02 } } };
      const { moves } = generateFinishing(h, cfg);
      const drop = createDropCutter(h, tool);
      let worst = -Infinity, holds = 0, holdWorst = -Infinity;
      for (let k = 1; k < moves.length; k++) {
        const a = moves[k - 1], b = moves[k];
        if (a.type !== 'cut' || b.type !== 'cut' || (a.x === b.x && a.y === b.y)) continue; // vertical moves cannot pass under
        if (a.z >= cfg.materialZ - 1e-9 && b.z >= cfg.materialZ - 1e-9) continue; // traverse above the stock
        let local = -Infinity;
        for (let q = 1; q < 16; q++) {
          const t = q / 16;
          local = Math.max(local, drop(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) - (a.z + (b.z - a.z) * t));
        }
        worst = Math.max(worst, local);
        // A last-resort hold: lift at a, cross at one height. It must clear the tip all the way.
        const prev = moves[k - 2];
        if (prev && prev.x === a.x && prev.y === a.y && a.z > prev.z && b.z === a.z && Math.hypot(b.x - a.x, b.y - a.y) < 1e-3) {
          holds++; holdWorst = Math.max(holdWorst, local);
        }
      }
      assert(worst <= 2 * 0.0001, `${tool.name}, ${surface} at ${angle} deg: no emitted move passes under the exact tip by more than 0.0002 in`,
        `worst ${worst.toExponential(2)} in over ${moves.length} moves; ${holds} last-resort holds`);
      if (holds) assert(holdWorst <= 1e-12, `${tool.name}, ${surface} at ${angle} deg: every last-resort hold clears the tip`);
    }
}

// ---------- C9 finishing-tool and home-Z refusals ----------
process.stdout.write('C9 generateSBP refuses a flat end mill for finishing and a home Z below safe Z\n');
{
  const flat = stateToHeightmap([[0.5, 0.5], [0.5, 0.5]], 2, 2, 1, 1);
  const base: SbpConfig = { ...getDefaultConfig(), materialX: 1, materialY: 1, materialZ: 0.75, offsetX: 0, offsetY: 0 };
  const refuse = (over: Partial<SbpConfig>): string => {
    try { generateSBP(flat, { ...base, ...over }); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); }
  };
  assert(/flat end mill/.test(refuse({ finishingTool: toolOf('Chipbreaker') })), 'end-mill finishing refused', refuse({ finishingTool: toolOf('Chipbreaker') }));
  assert(refuse({ finishingTool: toolOf('Chipbreaker'), finishingEnabled: false }) === '', 'an end mill still roughs');
  // Verification pass, PR #30 round 1 (N1): the footer's diagonal J3 to home Z ran 0.45 in into the stock.
  assert(/Home Z 0\.300 in must be at or above safe Z/.test(refuse({ homeZ: 0.3 })), 'home Z below safe Z refused', refuse({ homeZ: 0.3 }));
  const flatRadiused: ToolDef = { ...radiused, name: 'probe radiused R0', tipRadius: 0 };
  assert(/flat end mill/.test(refuse({ finishingTool: flatRadiused })), 'a radiused cutter with radius 0 is refused like an end mill');
  // Verification pass, PR #30 round 1 (N4): a vtdb-style radiused cutter with a small corner radius
  // took sqrt of a rounding-negative number at its rim and wrote NaN Z into the SBP.
  const size = 0.8, n = 41;
  const wall = stateToHeightmap(Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => {
    const x = c * size / (n - 1), y = r * size / (n - 1);
    return 0.25 + (x * Math.cos(0.6) + y * Math.sin(0.6) > 0.5 ? 0.3 : 0);
  })), n, n, size, size);
  for (const R of [0.02, 0.005]) {
    const tool: ToolDef = { ...radiused, name: `probe radiused D0.25 R${R}`, diameter: 0.25, tipRadius: R };
    const cfg: SbpConfig = { ...base, materialX: size, materialY: size, roughingEnabled: false, finishRasterAngle: 37,
      finishingTool: { ...tool, cutting: { ...tool.cutting, stepover: 0.02 } } };
    let sbp = '', msg = '';
    try { sbp = generateSBP(wall, cfg).sbp; } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    const nan = (sbp.match(/NaN|Infinity/g) ?? []).length;
    const { moves } = generateFinishing(wall, cfg);
    const drop = createDropCutter(wall, tool);
    let worst = -Infinity;
    for (let k = 1; k < moves.length; k++) {
      const a = moves[k - 1], b = moves[k];
      if (a.type !== 'cut' || b.type !== 'cut' || (a.x === b.x && a.y === b.y) || Math.min(a.z, b.z) >= cfg.materialZ - 1e-9) continue;
      for (let q = 1; q < 16; q++) {
        const t = q / 16;
        worst = Math.max(worst, drop(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) - (a.z + (b.z - a.z) * t));
      }
    }
    assert(msg === '' && nan === 0 && worst <= 0.0002, `${tool.name}: finite SBP, on or above the exact tip`,
      `${msg || 'generated'}; ${nan} non-finite values; worst ${worst.toExponential(2)} in over ${moves.length} moves`);
  }
}

// ---------- C10 stl-to-sbp skips the tool lookup for a pass that does not run ----------
process.stdout.write('C10 stl-to-sbp and switched-off passes\n');
{
  // A 2 x 1 in plate, 0.25 in thick at the top face: two triangles, binary STL.
  const tris = [[0, 0, 0.25, 2, 0, 0.25, 2, 1, 0.25], [0, 0, 0.25, 2, 1, 0.25, 0, 1, 0.25]];
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => { const o = 84 + i * 50 + 12; t.forEach((v, k) => buf.writeFloatLE(v, o + k * 4)); });
  const dir = mkdtempSync(join(tmpdir(), 'stl-to-sbp-'));
  try {
    const stl = join(dir, 'plate.stl');
    writeFileSync(stl, buf);
    const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'cli/stl-to-sbp.ts', stl, '--dry-run', '--resolution', '40', ...args], { encoding: 'utf8' });
    const off = run('--roughing-only', '--finishing-tool', 'no-such-tool-c10');
    assert(off.status === 0 && /ignored: --roughing-only/.test(off.stderr), 'a --finishing-tool with --roughing-only is ignored, not fatal', `exit ${off.status}`);
    const on = run('--finishing-tool', 'no-such-tool-c10');
    assert(on.status === 1 && /Finishing tool not found/.test(on.stderr), 'the same unknown tool still fails when finishing runs', `exit ${on.status}`);
    const offR = run('--finishing-only', '--roughing-tool', 'no-such-tool-c10');
    assert(offR.status === 0 && /ignored: --finishing-only/.test(offR.stderr), 'a --roughing-tool with --finishing-only is ignored, not fatal', `exit ${offR.status}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- C11 the drop cutter's profile equals toolZOffset ----------
process.stdout.write('C11 profileOf equals toolZOffset\n');
{
  const edgeShapes: ToolDef[] = [
    { ...getEmbeddedTools()[0], name: 'V-bit a0 R0.2 D0.25', type: ToolType.VBit, halfAngle: 0, tipRadius: 0.2, diameter: 0.25 },
    { ...getEmbeddedTools()[0], name: 'TBN a0 R0.05', type: ToolType.TaperedBallNose, halfAngle: 0, tipRadius: 0.05, diameter: 0.25 },
    { ...getEmbeddedTools()[0], name: 'Radiused R0', type: ToolType.Radiused, tipRadius: 0, diameter: 0.25 },
  ];
  const tools = [...(['general', 'mdf', 'hardwood'] as const).flatMap(p => getEmbeddedTools(p)), ...edgeShapes];
  let differ = 0, n = 0;
  for (const t of tools) {
    const f = profileOf(t);
    // Out to 0.1 in past the widest tool's radius, so every cone and cutting edge is crossed.
    const dMax = Math.max(...tools.map(x => x.diameter)) / 2 + 0.1;
    for (let i = 0; i <= 4000; i++) { const d = (i / 4000) * dMax; n++; const a = f(d), b = toolZOffset(t, d); if (!(a === b || (a !== a && b !== b))) differ++; }
  }
  assert(differ === 0, 'profileOf equals toolZOffset for every library tool and edge shape', `${differ} of ${n} differ`);
}

if (failures === 0) {
  process.stdout.write('\nALL OK\n');
  process.exit(0);
} else {
  process.stdout.write(`\n${failures} FAILURE(S)\n`);
  process.exit(1);
}
