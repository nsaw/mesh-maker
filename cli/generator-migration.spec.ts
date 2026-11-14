import './cellular-hash.spec';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { DEFAULTS, deserializeConfig, CURRENT_PAYLOAD_VERSION } from '../src/state';
import { presetState } from '../src/noise/presets';
import { buildNoiseSurface, noiseSurfaceParams, type NoiseSurfaceParams } from '../src/noise/surface';
import { BillowNoiseGen, SimplexNoiseGen, createNoiseGen, cellularDistances, cellularSite } from '../src/noise/generators';

const manifest = JSON.parse(readFileSync(new URL('./fixtures/generator-migration/manifest.json', import.meta.url), 'utf8')) as {
  presets: {name: string; params: NoiseSurfaceParams; cols: number; rows: number; sha256: string}[];
};
for (const item of manifest.presets) {
  const bytes = gunzipSync(readFileSync(new URL(`./fixtures/generator-migration/${item.name}.f64.gz`, import.meta.url)));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256.replaceAll('-', ''));
  // Cellular sites intentionally change in this slice; the remaining presets must retain
  // every production-resolution height after class substitution and curve folding.
  if (['voronoi-cells', 'worley-cracks'].includes(item.name)) continue;
  const current = buildNoiseSurface(noiseSurfaceParams({...DEFAULTS, ...presetState(item.name), seed: 0, resolution: 400}));
  assert.deepEqual([current.cols, current.rows], [item.cols, item.rows]);
  let maximum = 0;
  for (let j = 0; j < item.rows; j++) for (let i = 0; i < item.cols; i++) {
    maximum = Math.max(maximum, Math.abs(current.vertices[j][i] - bytes.readDoubleLE((j * item.cols + i) * 8)));
  }
  assert(maximum <= item.params.amplitude * .02 && maximum < 1e-12, `${item.name}: ${maximum} in migration error`);
  process.stdout.write(`${item.name}: max error ${maximum} in\n`);
}
// Independently reproduce the removed Turbulence arithmetic, before any shape operation.
for (const seed of [0, 71, -120]) for (const octaves of [1, 2, 5, 8]) {
  const simplex = new SimplexNoiseGen(seed), billow = new BillowNoiseGen(seed);
  for (let i = 0; i < 50; i++) {
    const x = i * .131 - 3, y = i * -.217;
    let val = 0, amp = 1, freq = 1, weight = 0;
    for (let o = 0; o < octaves; o++) {
      val += Math.abs(simplex.noise(x * freq, y * freq)) * amp;
      weight += amp; amp *= .55; freq *= 2.2;
    }
    assert.equal(billow.fbm(x, y, octaves, .55, 2.2), val / weight * 2 - 1);
  }
}
for (const seed of [0, 17, -85]) for (const jitter of [0, .3, 1]) for (const metric of ['euclidean', 'manhattan', 'chebyshev'] as const) {
  for (let n = 0; n < 120; n++) {
    const x = n * .371 - 20, y = n * -.191 + 13;
    const distances: number[] = [];
    for (let j = Math.floor(y) - 5; j <= Math.floor(y) + 5; j++) for (let i = Math.floor(x) - 5; i <= Math.floor(x) + 5; i++) {
      const [px, py] = cellularSite(i, j, seed, jitter), dx = Math.abs(x - px), dy = Math.abs(y - py);
      distances.push(metric === 'euclidean' ? Math.hypot(dx, dy) : metric === 'manhattan' ? dx + dy : Math.max(dx, dy));
    }
    distances.sort((a,b) => a-b);
    assert.deepEqual(cellularDistances(x,y,seed,jitter,metric), distances.slice(0,2));
  }
  assert.equal(cellularDistances(-2.5, 4.5, seed, 0, metric)[0], 0);
}
const offsets = new Set<string>();
for (let j = 0; j < 100; j++) for (let i = 0; i < 100; i++) {
  const [x,y] = cellularSite(i,j,0); offsets.add(`${x-i},${y-j}`);
}
assert(offsets.size >= 9990);
const decode = (value: object): ReturnType<typeof deserializeConfig> => deserializeConfig(new URLSearchParams({c: btoa(JSON.stringify({_v: CURRENT_PAYLOAD_VERSION, ...value}))}));
assert.equal(decode({invert: true}).invert, true);
for (const value of ['false', 1, [], null]) assert.equal(decode({invert: value}).invert, undefined);
assert.equal(decode({cellJitter: 2}).cellJitter, 1);
assert.equal(decode({cellJitter: -.2}).cellJitter, 0);
assert.equal(decode({cellMetric: 'manhattan'}).cellMetric, 'manhattan');
assert.equal(decode({cellMetric: ['euclidean']}).cellMetric, undefined);
for (const noiseType of ['fbm', 'turbulence']) assert.equal(decode({noiseType}).noiseType, undefined);
// Invert precedes asymmetric shaping, rather than negating an already-shaped height.
const params = noiseSurfaceParams({...DEFAULTS, seed: 71, resolution: 40, smoothRadiusIn: 0, peakExp: 1.7, valleyExp: .3});
const normal = buildNoiseSurface(params), inverse = buildNoiseSurface({...params, invert: true});
assert.notDeepEqual(normal.vertices, inverse.vertices);
const ridged = buildNoiseSurface({...params, noiseType: 'ridged', peakExp: .5, valleyExp: .5});
const billowInverse = buildNoiseSurface({...params, noiseType: 'billow', peakExp: .5, valleyExp: .5, invert: true});
for (let j = 0; j < ridged.rows; j++) for (let i = 0; i < ridged.cols; i++) {
  assert(Math.abs(ridged.vertices[j][i] - billowInverse.vertices[j][i]) < 1e-12);
}
const direct = {...params, octaves: 1, distortion: 0, invert: true};
const simple = new SimplexNoiseGen(direct.seed), expected: number[][] = [];
for (let j = 0; j < inverse.rows; j++) {
  expected[j] = [];
  for (let i = 0; i < inverse.cols; i++) {
    const raw = -simple.noise(i / (inverse.cols - 1) * direct.meshX * direct.frequency,
      j / (inverse.rows - 1) * direct.meshY * direct.frequency);
    expected[j][i] = raw >= 0 ? raw ** direct.peakExp : -((-raw) ** direct.valleyExp);
  }
}
const low = Math.min(...expected.flat()), high = Math.max(...expected.flat());
const actual = buildNoiseSurface(direct);
for (let j = 0; j < actual.rows; j++) for (let i = 0; i < actual.cols; i++) {
  const z = direct.baseThickness - direct.amplitude + (expected[j][i] - low) / (high - low) * direct.amplitude;
  assert(Math.abs(z - actual.vertices[j][i]) < 1e-12, 'invert precedes asymmetric shape');
}
for (const x of [NaN, Infinity, 1e20]) assert.throws(() => cellularDistances(x, 0, 1, 1, 'euclidean'), RangeError);
process.stdout.write('Cellular oracle, strict link fields and removed-class arithmetic passed.\n');

// Execute the canonical Python classes independently of builder text parity and Rhino I/O.
const samples = [0, 1001, -47].flatMap(seed => Array.from({length: 30}, (_, i) => ({seed, x: i * .173 - 3, y: i * -.317 + 1})));
const source = readFileSync(new URL('../grasshopper/components/noise_gen.py', import.meta.url), 'utf8');
const python = `import ast,json,math,sys
p=json.loads(sys.stdin.read())
m=ast.parse(p['source']);m.body=[n for n in m.body if isinstance(n,ast.ClassDef)]
scope={'math':math};exec(compile(m,'noise_gen.py','exec'),scope)
out=[]
for q in p['samples']:
    values=[]
    for name in ['SimplexNoise','OpenSimplex2Noise','WaveletNoise']:
        values.append(scope[name](q['seed']).noise(q['x'],q['y']))
    for metric in ['euclidean','manhattan','chebyshev']:
        values.extend(scope['_Cellular'].distances(q['x'],q['y'],q['seed'],0.7,metric))
    out.append(values)
print(json.dumps(out))`;
const result: number[][] = JSON.parse(execFileSync('python3', ['-I', '-c', python], {input: JSON.stringify({source, samples}), encoding:'utf8'}));
for (let i = 0; i < samples.length; i++) {
  const q = samples[i], values = ['simplex','opensimplex2','wavelet'].map(type => createNoiseGen(type,q.seed).noise(q.x,q.y));
  for (const metric of ['euclidean','manhattan','chebyshev'] as const) values.push(...cellularDistances(q.x,q.y,q.seed,.7,metric));
  for (let j = 0; j < values.length; j++) assert(Math.abs(values[j] - result[i][j]) < (j === 2 ? 1e-7 : 1e-12), `Python numeric parity sample ${i}, field ${j}`);
}
process.stdout.write('Canonical Python kernel and cellular numeric parity passed.\n');
