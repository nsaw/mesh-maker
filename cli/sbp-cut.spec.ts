/**
 * Tool compensation and emitted-toolpath verification.
 * Run: npm run test:cut  (or: npx tsx cli/sbp-cut.spec.ts)
 *
 *   C1  compensateForTool equals a brute-force oracle, max over EVERY grid point of
 *       H(p) - profile(|p - x|), with the oracle's profile taken from cli/cut-sim.ts (an independent
 *       derivation), on an anisotropic grid, for every cutter type in the tool database.
 *   C2  the two 2026-10-19 audit probes: a flat 0.500 in plane under a 0.1 in ball stays 0.500
 *       (old: 0.473205), and a flat end mill over a 0.5 in peak stays at 0.5 (old: 0.1).
 *   C3  full pipeline: generateSBP -> SBP text -> independent swept-cutter replay -> no gouge on a
 *       plane, ramp, narrow peak, bowl and an asymmetric relief; plane residual within the scallop.
 *   C4  a grid whose row spacing differs from its column spacing is cut in register (old: rows
 *       placed at the column spacing, the last row off by up to a cell).
 */
import { compensateForTool } from '../src/sbp/compensate';
import { generateSBP } from '../src/sbp/generate';
import { stateToHeightmap } from '../src/sbp/heightmap';
import { getDefaultConfig, getEmbeddedTools } from '../src/sbp/tools';
import type { Heightmap, SbpConfig, ToolDef } from '../src/sbp/types';
import { compareCut, cutterProfile, parseSbp, simulateCut } from './cut-sim';

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

function cutCheck(name: string, z: Float64Array, rows: number, cols: number, meshX: number, meshY: number,
  planeResidual?: number): void {
  const heightmap = stateToHeightmap(Array.from({ length: rows }, (_, r) => Array.from(z.subarray(r * cols, r * cols + cols))),
    rows, cols, meshX, meshY);
  const config: SbpConfig = { ...getDefaultConfig(), materialX: meshX, materialY: meshY, materialZ: 0.75 };
  const { sbp } = generateSBP(heightmap, config);
  const sections = parseSbp(sbp);
  const byName = new Map(tools.map(t => [t.name, t]));
  // Grid spacing from the fixture, not from the heightmap under test: a generator that mis-sets its
  // spacing must show up as misregistered cuts, not as a simulation of nothing.
  const sim = simulateCut(sections, byName, { cols, rows, originX: config.offsetX, originY: config.offsetY,
    cellX: meshX / (cols - 1), cellY: meshY / (rows - 1) }, 0.75);
  const cmp = compareCut(sim.stock, z);
  assert(cmp.residualP99 < 0.1, `${name}: the cut reached the target (simulation is not vacuous)`,
    `residual p99 ${cmp.residualP99.toFixed(4)} in`);
  assert(sim.rapidCollisions === 0, `${name}: no rapid move passes through stock`, `${sim.movesSimulated} moves replayed`);
  assert(cmp.maxGouge <= GOUGE_TOL, `${name}: no gouge below the target`,
    `max gouge ${cmp.maxGouge.toFixed(5)} in, residual p99 ${cmp.residualP99.toFixed(4)} in, mean ${cmp.meanResidual.toFixed(4)} in`);
  if (planeResidual !== undefined)
    assert(cmp.residualP99 <= planeResidual, `${name}: residual within the finishing scallop`,
      `p99 ${cmp.residualP99.toFixed(5)} in vs ${planeResidual.toFixed(5)} in`);
}

process.stdout.write('C3 generateSBP -> emitted SBP -> independent swept-cutter replay\n');
{
  const rows = 201, cols = 201, size = 2;
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
  cutCheck('narrow peak', field((x, y) => 0.2 + 0.3 * Math.exp(-((x - 1) ** 2 + (y - 1) ** 2) / (2 * 0.05 ** 2))), rows, cols, size, size);
  // Spherical cap 0.25 in deep, sphere radius 0.8 in, cut into a 0.6 in plane.
  cutCheck('spherical bowl', field((x, y) => {
    const d2 = (x - 1) ** 2 + (y - 1) ** 2;
    return 0.6 - Math.max(0, Math.sqrt(Math.max(0, 0.64 - d2)) - 0.55);
  }), rows, cols, size, size);
  // Asymmetric: an L-shaped plateau, a step and a tilted face, so mirroring or rotation would show.
  cutCheck('asymmetric L + step', field((x, y) => (x < 0.7 && y > 0.3 ? 0.55 : 0.25) + (y < 0.3 && x > 1.2 ? 0.1 * (x - 1.2) : 0)),
    rows, cols, size, size);
}

// ---------- C4 anisotropic grid ----------
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

if (failures === 0) {
  process.stdout.write('\nALL OK\n');
  process.exit(0);
} else {
  process.stdout.write(`\n${failures} FAILURE(S)\n`);
  process.exit(1);
}
