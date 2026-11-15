/** Relief geometry at a physical point does not depend on the output grid (#81, #57).
 * Every pass-2 input is a function of physical position; the pillow membrane used to be
 * solved over output pixels with a fixed sweep count, so the 120-column drag preview and
 * the export carved different cushions. It now lives on the physical measurement lattice. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { DEFAULTS } from '../src/state';
import { presetState } from '../src/noise/presets';
import { noiseGridShape } from '../src/noise/grid-shape';
import { sampleReliefParamsFromState, VoronoiReliefGen } from '../src/noise/voronoi-relief';
import { buildNoiseSurface, noiseSurfaceParams } from '../src/noise/surface';
import type { ReliefSampleParams } from '../src/types';

type Grid = readonly (readonly number[])[];
/** Visit nodes of `a` that coincide exactly with nodes of `b` (same normalized position). */
function coincident(a: Grid, b: Grid, visit: (va: number, vb: number) => void): number {
  const ca = a[0].length - 1, cb = b[0].length - 1, ra = a.length - 1, rb = b.length - 1;
  let count = 0;
  for (let j = 0; j <= ra; j++) {
    if ((j * rb) % ra) continue;
    for (let i = 0; i <= ca; i++) {
      if ((i * cb) % ca) continue;
      visit(a[j][i], b[j * rb / ra][i * cb / ca]);
      count++;
    }
  }
  return count;
}
const square = {meshX: 24, meshY: 24};
const rawGrid = (state: Record<string, unknown>, resolution: number): number[][] => {
  const s = {...DEFAULTS, ...state} as typeof DEFAULTS;
  const {cols, rows} = noiseGridShape(resolution, s.meshX, s.meshY);
  return new VoronoiReliefGen(s.seed).sampleGridResult(sampleReliefParamsFromState(cols, rows, s.meshX, s.meshY, s.seed, s)).grid;
};

// #81: a fully pillowed preset carves the same raw relief at every coincident node of
// resolutions 121, 401 and 961, and the membrane is actually exercised there.
const pillowed = {...presetState('relief-radial'), ...square, reliefPillow: 1};
const raw = [121, 401, 961].map(resolution => rawGrid(pillowed, resolution));
const flat = rawGrid({...pillowed, reliefPillow: 0}, 121);
let lifted = 0;
coincident(raw[0], flat, (cushion, bare) => { if (Math.abs(cushion - bare) > 0.01) lifted++; });
assert(lifted > 20, `pillow lifts ${lifted} nodes of the 121 grid`);
for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
  let worst = 0;
  const nodes = coincident(raw[a], raw[b], (va, vb) => { worst = Math.max(worst, Math.abs(va - vb)); });
  assert(nodes >= 1681, `${nodes} coincident nodes`);
  assert.equal(worst, 0, `raw pillowed relief differs by ${worst} between grids ${a} and ${b}`);
}

// Final inches, smoothing off (the Gaussian kernel is sampled per grid by design): the
// issue's acceptance, 0.005 in at coincident nodes. Before the lattice it was 0.077 in.
const surface = (resolution: number) => buildNoiseSurface(noiseSurfaceParams({...DEFAULTS, ...pillowed, smoothRadiusIn: 0, resolution})).vertices;
const coarse = surface(121), fine = surface(961);
let finalWorst = 0;
coincident(coarse, fine, (va, vb) => { finalWorst = Math.max(finalWorst, Math.abs(va - vb)); });
assert(finalWorst <= 0.005, `pillowed final heights differ by ${finalWorst} in between 121 and 961`);

// #57: Relief Pockets at seed 139, the issue's coincident-node probe. The pre-slice-3
// checkpoint measured max 0.0365 of the requested depth and the slice-3 candidate 0.0346;
// physical cell measurement (8b9df92) brought it to 0.0096 and the lattice membrane to the
// pillow-free 0.0038. The gates are the planned mean 0.005 and maximum 0.03, unweakened, and
// the pillow may add no resolution error of its own.
function pocketsError(seed: number, pillow?: number): {mean: number; max: number} {
  const state = {...DEFAULTS, ...presetState('relief-pockets'), ...square, seed, ...(pillow === undefined ? {} : {reliefPillow: pillow})};
  const a = buildNoiseSurface(noiseSurfaceParams({...state, resolution: 201})).vertices;
  const b = buildNoiseSurface(noiseSurfaceParams({...state, resolution: 401})).vertices;
  let sum = 0, max = 0;
  const count = coincident(a, b, (va, vb) => { const e = Math.abs(va - vb); sum += e; max = Math.max(max, e); });
  assert.equal(count, 201 * 201);
  const depth = Math.min(state.amplitude, state.baseThickness);
  return {mean: sum / count / depth, max: max / depth};
}
const seed139 = pocketsError(139), seed139Bare = pocketsError(139, 0);
assert(presetState('relief-pockets').reliefPillow! > 0, 'the Pockets preset is pillowed');
assert(seed139.mean <= 0.005 && seed139.max <= 0.03, `seed 139: ${JSON.stringify(seed139)}`);
assert(seed139.max <= seed139Bare.max + 1e-12, `pillow adds resolution error: ${seed139.max} > ${seed139Bare.max}`);

// The Grasshopper port carries the same lattice membrane (three landing sites): one small
// pillowed layout with cushions, frozen from the web producer, matches to 1e-12.
const pocketState = {...DEFAULTS, ...presetState('relief-pockets'), meshX: 8, meshY: 8, reliefPillow: 1, seed: 11};
const {cols, rows} = noiseGridShape(33, pocketState.meshX, pocketState.meshY);
const p: ReliefSampleParams = sampleReliefParamsFromState(cols, rows, pocketState.meshX, pocketState.meshY, pocketState.seed, pocketState);
const web = new VoronoiReliefGen(p.seed).sampleGridResult(p);
const webBare = new VoronoiReliefGen(p.seed).sampleGridResult({...p, pillow: 0, frozenSites: web.source.sites});
assert(web.grid.flat().some((z, i) => Math.abs(z - webBare.grid.flat()[i]) > 0.01), 'parity layout has lifted cushions');
const aliases: Record<string, string> = {relaxIterations: 'relax_iter', baseAmplitude: 'base_amp', baseFrequency: 'base_freq'};
const pyParams = Object.fromEntries(Object.entries(p).map(([key, value]) => [aliases[key] ?? key.replace(/[A-Z]/g, c => '_' + c.toLowerCase()),
  key === 'radialFoci' ? p.radialFoci.map(focus => [focus.x, focus.y]) : value]));
const sites = web.source.sites;
const python = `import ast,json,math,sys
payload=json.loads(sys.stdin.read());module=ast.parse(payload['source']);module.body=[n for n in module.body if isinstance(n,(ast.ClassDef,ast.FunctionDef,ast.Import,ast.ImportFrom)) and not (isinstance(n,(ast.Import,ast.ImportFrom)) and ('Rhino' in ast.unparse(n) or 'rhinoscriptsyntax' in ast.unparse(n)))];scope={'math':math};exec(compile(module,'native','exec'),scope)
p=payload['params'];p['frozen_sites']=payload['sites']
print(json.dumps(scope['VoronoiReliefNoise'](payload['seed']).sample_grid(p)))`;
const native = readFileSync(new URL('../grasshopper/components/noise_gen.py', import.meta.url), 'utf8');
const pyGrid = JSON.parse(execFileSync('python3', ['-I', '-c', python], {encoding: 'utf8', input: JSON.stringify({
  source: native, seed: p.seed, params: pyParams,
  sites: {xy: Array.from(sites.xy), ids: Array.from(sites.ids), pinned: Array.from(sites.pinned), truncated_from: 0},
})})) as number[];
const webFrozen = new VoronoiReliefGen(p.seed).sampleGridResult({...p, frozenSites: sites}).grid.flat();
assert.equal(pyGrid.length, webFrozen.length);
const parityWorst = pyGrid.reduce((worst, z, i) => Math.max(worst, Math.abs(z - webFrozen[i])), 0);
assert(parityWorst < 1e-12, `Grasshopper membrane differs from the web producer by ${parityWorst}`);

process.stdout.write(`Relief resolution independence passed: pillowed raw nodes identical, final ${finalWorst.toExponential(2)} in, `
  + `seed 139 max ${seed139.max.toFixed(4)} of depth, Grasshopper parity ${parityWorst.toExponential(1)}.\n`);
