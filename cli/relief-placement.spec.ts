import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/state';
import { buildNoiseSurface, noiseSurfaceParams, NOISE_SURFACE_KEYS, type NoiseSurfaceParams } from '../src/noise/surface';
import { RELIEF_PLACEMENT_KEYS } from '../src/noise/voronoi-relief';

const allowed = new Set<string>(RELIEF_PLACEMENT_KEYS);
const fixtures: Partial<NoiseSurfaceParams>[] = [
  {reliefDensityStrength: 1.4, reliefDensityNoise: 0.8, reliefDepthVariation: 0.8, reliefAttractorMode: 'point'},
  {reliefCellSize: 0.4, reliefRadialFociCount: 3, reliefRadialStrength: 2, reliefRadialGrow: 0.8, reliefRadialWarp: 0.6, reliefRadialFalloff: 0.4},
  {reliefRelaxIterations: 1, distortion: 0.6, warpFreq: 0.25},
  {meshX: 36, meshY: 24, reliefCellSize: 0.2, reliefDensityStrength: 2, reliefDensityNoise: 1.5},
];
const enums: Partial<Record<typeof NOISE_SURFACE_KEYS[number], string>> = {
  reliefPolarity: 'pockets', reliefProfile: 'parabolic', reliefAttractorMode: 'radial', reliefBaseMode: 'wave', reliefRadialMode: 'rings',
};
const observed = new Set<string>();
function sites(params: NoiseSurfaceParams): string {
  const source = buildNoiseSurface(params).reliefSource!;
  return JSON.stringify({xy: Array.from(source.sites.xy), ids: Array.from(source.sites.ids), pinned: Array.from(source.sites.pinned), truncatedFrom: source.sites.truncatedFrom});
}
for (const fixture of fixtures) {
  const base = noiseSurfaceParams({...DEFAULTS, noiseType: 'voronoi-relief', meshX: 8, meshY: 6, resolution: 2,
    reliefCellSize: 1.2, reliefRelaxIterations: 0, seed: 197, ...fixture});
  const before = sites(base);
  for (const key of NOISE_SURFACE_KEYS) {
    if (['reliefSites', 'reliefRevision', 'noiseType'].includes(key)) continue;
    const value = base[key];
    let alternate: unknown = typeof value === 'number' ? (value === 0 ? 0.6 : value * 0.71) : typeof value === 'boolean' ? !value : enums[key];
    if (['resolution', 'octaves', 'reliefRelaxIterations', 'reliefRadialFociCount', 'reliefInvertProfile'].includes(key)) alternate = value === 0 ? 1 : 0;
    if (key === 'seed') alternate = base.seed + 17;
    if (key === 'resolution') alternate = 3;
    if (alternate === undefined || alternate === value) continue;
    const after = sites(noiseSurfaceParams({...base, [key]: alternate}));
    if (after !== before) { observed.add(key); assert(allowed.has(key), `${key} changes producer coordinates/count/pins/order but is missing from its placement dependency list`); }
  }
}
assert.deepEqual(observed, allowed, 'every declared producer placement dependency is exercised by the census');
assert(observed.has('reliefDepthVariation'), 'the census reaches suppression pruning');
assert(observed.has('reliefAttractorRadius'), 'the census reaches indirect attractor density');
assert(observed.has('reliefRadialMode'), 'the census reaches polar placement');
assert(observed.has('distortion'), 'the census reaches warped Lloyd centroids');
process.stdout.write(`Producer placement census passed across Cartesian/suppression, polar, warped Lloyd and capped sources; observed ${Array.from(observed).sort().join(', ')}.\n`);
