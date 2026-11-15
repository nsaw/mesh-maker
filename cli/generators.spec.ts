import assert from 'node:assert/strict';
import { SimplexNoiseGen, OpenSimplex2NoiseGen, WaveletNoiseGen, SIMPLEX_KERNEL_IMPLEMENTATION } from '../src/noise/generators';

for (const seed of [0, 1, 1000, 1001, -1, 2147483647, 4294967295]) {
  const gen=new SimplexNoiseGen(seed),kernel=gen.describeKernel(),perm=kernel.perm;
  assert.equal(kernel.implementation,SIMPLEX_KERNEL_IMPLEMENTATION);
  assert.equal(perm.length,512);
  assert.equal(kernel.grad2.length,12);
  assert(Object.isFrozen(kernel)&&Object.isFrozen(perm)&&Object.isFrozen(kernel.grad2));
  assert(kernel.grad2.every(pair=>Object.isFrozen(pair)));
  assert.notEqual(perm,gen.describeKernel().perm);
  const before=gen.noise(.31,.47);
  assert.equal(Reflect.set(perm,'0',-1),false);
  assert.equal(Reflect.set(kernel.grad2[0],'0',99),false);
  assert.equal(gen.noise(.31,.47),before);
  assert.equal(new Set(perm.slice(0, 256)).size, 256, `seed ${seed} permutation`);
}
const a = new SimplexNoiseGen(1000), b = new SimplexNoiseGen(1001);
let best = -1;
for (let sy = -30; sy <= 30; sy++) for (let sx = -30; sx <= 30; sx++) {
  let sa = 0, sb = 0, aa = 0, bb = 0, ab = 0;
  const count = 1024;
  for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
    const u = a.noise(i * .5, j * .5), v = b.noise(i * .5 + sx * .1, j * .5 + sy * .1);
    sa += u; sb += v; aa += u * u; bb += v * v; ab += u * v;
  }
  best = Math.max(best, (ab - sa * sb / count) / Math.sqrt((aa - sa * sa / count) * (bb - sb * sb / count)));
}
assert(best <= .2, `seed cross-correlation ${best}`);
function extrema(gen: { noise(x: number, y: number): number }): number {
  const grid = Array.from({length: 267}, (_, j) => Array.from({length: 400}, (_, i) => gen.noise(i * 3.6 / 399, j * 2.4 / 266)));
  let total = 0;
  for (let j = 1; j < 266; j++) for (let i = 1; i < 399; i++) {
    let lo = true, hi = true;
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      if (!x && !y) continue;
      lo &&= grid[j][i] < grid[j + y][i + x]; hi &&= grid[j][i] > grid[j + y][i + x];
    }
    if (lo || hi) total++;
  }
  return total;
}
const simplex = extrema(new SimplexNoiseGen(0)), wavelet = extrema(new WaveletNoiseGen(0));
assert(wavelet >= simplex / 2 && wavelet <= simplex * 2, `${simplex} Simplex, ${wavelet} Wavelet extrema`);
let min = Infinity, max = -Infinity, jump = 0;
for (const seed of [7, -47, 218]) {
  const gen = new OpenSimplex2NoiseGen(seed);
  for (let i = 0; i < 1000000; i++) {
    const n = gen.noise((i * .618033988749895 % 1) * 256, (i * .414213562373095 % 1) * 256);
    min = Math.min(min, n); max = Math.max(max, n);
  }
  // Both sides of the triangle branch and skew-cell boundaries, bisected toward zero gap.
  for (let i = -100; i <= 100; i++) for (let step = 40; step <= 50; step++) {
    const t = i / 19, e = 2 ** -step;
    const f = (Math.sqrt(3) - 1) / 2;
    const boundaryX = (3 - f * t) / (1 + f);
    jump = Math.max(jump,
      Math.abs(gen.noise(t - e, t + e) - gen.noise(t + e, t - e)),
      Math.abs(gen.noise(boundaryX - e, t) - gen.noise(boundaryX + e, t)),
      Math.abs(gen.noise(t, boundaryX - e) - gen.noise(t, boundaryX + e)));
  }
}
assert(min >= -1.05 && max <= 1.05 && max > .95 && min < -.95, `range ${min}, ${max}`);
assert(jump <= .000001, `branch-boundary jump ${jump}`);
process.stdout.write(JSON.stringify({bestSeedCorrelation: best, simplexExtrema: simplex, waveletExtrema: wavelet, range: [min,max], branchJump: jump}) + '\n');
