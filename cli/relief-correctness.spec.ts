/** Physical relief contracts: site coverage, centroid quality, facets and resolution invariance. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DEFAULTS, STATE, CURRENT_PAYLOAD_VERSION, serializeConfig, deserializeConfig, consumeOutdatedLinkReset } from '../src/state';
import { VoronoiReliefGen, sampleReliefParamsFromState, __sitesForTest, __siteCandidatesForTest } from '../src/noise/voronoi-relief';
import { presetState } from '../src/noise/presets';
import { SiteGrid } from '../src/noise/site-grid';
import { generateNoiseMesh, generateDepthMapMesh } from '../src/mesh';
import { gaussianSmooth, preferZ00Z11Diagonal } from '../src/geometry';
import { getReliefRidgeInfo } from '../src/noise/relief-features';
import { buildReliefStepoverWarning } from '../src/sbp-export';

function params(state = { ...DEFAULTS }, seed = 5) {
  return sampleReliefParamsFromState(2, 4, state.meshX, state.meshY, seed, state);
}
function areaCV(sites: Array<{x: number; y: number}>): number {
  const counts = new Float64Array(sites.length), index = SiteGrid.fromSites(sites);
  const cols = 500, rows = Math.round(cols * 24 / 36);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    counts[index.nearestOwner((i + 0.5) / cols * 36, (j + 0.5) / rows * 24)]++;
  }
  const mean = cols * rows / sites.length;
  return Math.sqrt(counts.reduce((sum, n) => sum + (n - mean) ** 2, 0) / sites.length) / mean;
}
// Raster-order truncation previously starved the last panel sixth entirely.
{
  const p = { ...params(), cellSize: 0.4, densityStrength: 2, jitter: 0.9, relaxIterations: 0 };
  const result = new VoronoiReliefGen(5).sampleGridResult(p);
  const sites = __sitesForTest(p, false);
  assert.equal(sites.length, 4096);
  assert(result.truncatedFrom > sites.length);
  const counts = Array.from({length: 6}, () => 0);
  for (const site of sites) counts[Math.min(5, Math.floor(site.y / 4))]++;
  const mean = sites.length / 6;
  for (const count of counts) assert(Math.abs(count - mean) <= mean * 0.25, `cap sixth coverage ${counts}`);
  // Reserving a polar tail must also sample Cartesian sites across the whole panel.
  const focal = {...p, radialFoci: [{x: 0.5, y: 0.5}], radialFalloff: 0.3, radialStrength: 0, radialWarp: 0};
  const focalSites = __sitesForTest(focal, false);
  const relaxed = __sitesForTest({...focal, relaxIterations: 2}, false);
  assert.equal(focalSites.length, 4096);
  let pinned = 0;
  for (let i = focalSites.length - 1; i >= 0; i--) {
    if (focalSites[i].x !== relaxed[i].x || focalSites[i].y !== relaxed[i].y) break;
    pinned++;
  }
  assert(pinned > 0, 'polar tail remains pinned');
  const outer = focalSites.filter(s => Math.hypot(s.x - 18, s.y - 12) > 3);
  const sixths = Array.from({length: 6}, () => 0);
  for (const site of outer) sixths[Math.min(5, Math.floor(site.y / 4))]++;
  assert(sixths[5] > outer.length / 6 * 0.75, `final budget retains far edge ${sixths}`);
  const outside = focalSites.filter(s => Math.hypot(s.x - 18, s.y - 12) > 0.3 * Math.hypot(36,24));
  const first = outside.filter(s => s.y < 4).length, last = outside.filter(s => s.y >= 20).length;
  assert(first > 0 && Math.abs(last-first) <= first*0.25, `post-polar Cartesian edge coverage ${first},${last}`);
  const grid = new VoronoiReliefGen(5).sampleGrid({...p, cols:400, rows:267, polarity:'pockets', profile:'cosine'});
  const minima = Array.from({length:6}, () => 0);
  for (let j=1;j<266;j++) for (let i=1;i<399;i++) {
    let minimum = true;
    for (let dj=-1;dj<=1;dj++) for (let di=-1;di<=1;di++) {
      if ((dj || di) && grid[j+dj][i+di] <= grid[j][i]) minimum = false;
    }
    if (minimum) minima[Math.min(5,Math.floor(j/267*6))]++;
  }
  const minimaMean = minima.reduce((a,b)=>a+b,0)/6;
  assert(minimaMean > 0);
  for (const count of minima) assert(Math.abs(count-minimaMean) <= minimaMean*0.25, `local minima coverage ${minima}`);
  process.stdout.write(`cap local minima ${minima}\n`);
  process.stdout.write(`cap coverage ${counts}; candidates ${result.truncatedFrom}; polar pinned ${pinned}\n`);
}
// All focal lattices are enumerated before capping, including the third nucleus.
{
  const p = {...params(), cellSize:0.4, relaxIterations:0, radialFoci:[{x:0.1,y:0.1},{x:0.9,y:0.9},{x:0.5,y:0.5}],
    radialFalloff:0.6, radialStrength:0, radialGrow:0, radialWarp:0};
  const sites = __sitesForTest(p, false), result = new VoronoiReliefGen(5).sampleGridResult(p);
  assert.equal(sites.length,4096);
  assert.equal(result.truncatedFrom,7183, 'all polar candidates count toward the notice');
  // These nucleus coordinates come from the complete, pre-cap lattice at seed 5.
  // The former early stop at 4096 omitted the third nucleus at candidate index 4143.
  const nuclei = [[3.6159177702395247,2.4212861248673874],
    [32.43079224319197,21.62399350638036],[17.98889805103373,11.968276990577579]];
  const nucleusIndices = nuclei.map(([x,y]) => sites.findIndex(s => s.x === x && s.y === y));
  assert(nucleusIndices.every(i => i >= 0), `retained focal nuclei ${nucleusIndices}`);
  assert(nucleusIndices[0] < nucleusIndices[1] && nucleusIndices[1] < nucleusIndices[2], 'retain original focal order');
  assert.deepEqual(__sitesForTest(p,false),sites,'polar capping is deterministic');
  assert.deepEqual(__sitesForTest({...p,relaxIterations:2},false),sites,'all capped polar sites remain pinned');
  const sixths = Array.from({length:6},()=>0);
  for (const site of sites) sixths[Math.min(5,Math.floor(site.y/4))]++;
  const mean = sites.length/6;
  assert(sixths.every(n => Math.abs(n-mean) <= mean*0.25), `polar cap panel coverage ${sixths}`);
  process.stdout.write(`polar candidates ${result.truncatedFrom}; nuclei ${nucleusIndices}; panel ${sixths}\n`);
  for (const radialMode of ['rings','rays','spiral'] as const) {
    for (const size of [{meshX:0.1,meshY:0.1},{meshX:36,meshY:24},{meshX:80,meshY:80}]) {
      for (const radialFoci of [[],p.radialFoci]) {
        const bounded = {...p,...size,radialFoci,cellSize:0.2,radialMode,radialStrength:4,radialGrow:0,radialWarp:1};
        const generated = __sitesForTest(bounded,false);
        assert(generated.length <= 4096 && generated.length >= Math.max(1,radialFoci.length));
        assert(generated.every(s => Number.isFinite(s.x) && Number.isFinite(s.y)), `${radialMode} finite bounded panel`);
      }
    }
  }

}

// A subprocess timeout makes a missing guard a finite test failure instead of a runaway grid.
{
  const sampler = new URL('../src/noise/voronoi-relief.ts',import.meta.url).href;
  const state = new URL('../src/state.ts',import.meta.url).href;
  const code = `import assert from 'node:assert/strict';
import {DEFAULTS} from ${JSON.stringify(state)};
import {sampleReliefParamsFromState,VoronoiReliefGen} from ${JSON.stringify(sampler)};
const p={...sampleReliefParamsFromState(2,4,36,24,5,DEFAULTS),cellSize:.4,relaxIterations:0,
radialFoci:[{x:.1,y:.1},{x:.9,y:.9},{x:.5,y:.5}],radialFalloff:.02};
for(const radialFoci of [[],p.radialFoci]) for(const bad of [
 {meshX:1e6},{meshX:1000,meshY:1000},{meshX:Number.MAX_VALUE,meshY:Number.MAX_VALUE},
 {meshX:NaN},{meshX:Infinity},{meshX:0},{meshX:-1},{meshY:0},{meshY:-1},
 {cellSize:NaN},{cellSize:Infinity},{cellSize:0},{cellSize:-1}
]) assert.throws(()=>new VoronoiReliefGen(5).sampleGridResult({...p,radialFoci,...bad}),
{name:'RangeError',message:'Relief site enumeration exceeds supported work budget'});
assert.throws(()=>new VoronoiReliefGen(5).sampleGridResult({...p,meshX:120,meshY:120,cellSize:.2,
radialFalloff:.6,radialStrength:4,radialGrow:0}),
{name:'RangeError',message:'Relief site enumeration exceeds supported work budget'});`;
  const child = spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{encoding:'utf8',timeout:3000});
  assert.equal(child.status,0,`site work refusal: ${child.error?.message ?? child.stderr}`);
}

// Global retention follows the complete population, including Cartesian-only corners.
{
  for (const [cellSize,radialFalloff] of [[0.4,0.2],[0.2,0.15],[0.2,0.18],[0.2,0.25]]) {
    const p = {...params(),cellSize,radialFalloff,relaxIterations:0,
      radialFoci:[{x:0.1,y:0.1},{x:0.9,y:0.9},{x:0.5,y:0.5}],
      radialMode:'rings' as const,radialStrength:0,radialGrow:0,radialWarp:0};
    const raw = __siteCandidatesForTest(p,false), sites = __sitesForTest(p,false);
    const result = new VoronoiReliefGen(5).sampleGridResult(p);
    assert.equal(sites.length,4096);
    assert.equal(result.truncatedFrom,raw.sites.length,'notice counts the full raw population once');
    assert(raw.cartesianCount > 0 && raw.cartesianCount < raw.sites.length,'both cohorts exist');
    if (cellSize === 0.4) assert.equal(raw.sites.length,8346,'actual slider mixed-layout population');
    if (radialFalloff === 0.15) assert.equal(raw.sites.length,20034,'dense mixed-layout population');
    const nuclei = raw.nuclei.map(i=>raw.sites[i]);
    assert.equal(nuclei.length,3);
    assert(nuclei.every(n=>sites.some(s=>s.x===n.x && s.y===n.y)),'retain every focal nucleus');
    // Check ordered subsequence membership without assuming unique edge-clamped coordinates.
    let cursor = 0;
    for (const site of sites) {
      while (cursor < raw.sites.length && (raw.sites[cursor].x!==site.x || raw.sites[cursor].y!==site.y)) cursor++;
      assert(cursor < raw.sites.length,'retained candidates keep original global order');
      cursor++;
    }
    const cartesian = new Set(raw.sites.slice(0,raw.cartesianCount).map(s=>`${s.x},${s.y}`));
    const cartCount = sites.filter(s=>cartesian.has(`${s.x},${s.y}`)).length;
    assert(sites.slice(0,cartCount).every(s=>cartesian.has(`${s.x},${s.y}`)),'Cartesian prefix is contiguous');
    assert(sites.slice(cartCount).every(s=>!cartesian.has(`${s.x},${s.y}`)),'polar tail follows Cartesian prefix');
    const expected = (predicate: (site: {x:number;y:number})=>boolean): number => {
      const required = nuclei.filter(predicate).length;
      const optional = raw.sites.filter(predicate).length-required;
      return required+optional*(sites.length-nuclei.length)/(raw.sites.length-nuclei.length);
    };
    const checkPopulation = (actual: number, predicted: number, label: string): void => {
      assert(predicted > 0 && Math.abs(actual-predicted)<=predicted*0.25,
        `${label}: retained ${actual}, population expectation ${predicted}`);
    };
    checkPopulation(cartCount,raw.cartesianCount*(sites.length-3)/(raw.sites.length-3),'Cartesian cohort');
    checkPopulation(sites.length-cartCount,3+(raw.sites.length-raw.cartesianCount-3)*(sites.length-3)/(raw.sites.length-3),'polar cohort');
    const tile = (site: {x:number;y:number}): number => Math.min(3,Math.floor(site.y/6))*6+Math.min(5,Math.floor(site.x/6));
    for (let bin=0;bin<24;bin++) {
      checkPopulation(sites.filter(s=>tile(s)===bin).length,expected(s=>tile(s)===bin),`6x4 tile ${bin}`);
    }
    for (const focus of p.radialFoci) {
      const near = (s: {x:number;y:number}): boolean => Math.hypot(s.x-focus.x*36,s.y-focus.y*24)<5;
      checkPopulation(sites.filter(near).length,expected(near),'focal neighborhood');
    }
    const farCorner = (s: {x:number;y:number}): boolean => s.x<6 && s.y>18;
    const farRaw = raw.sites.filter(farCorner).length, farRetained = sites.filter(farCorner).length;
    assert(farRaw > 0 && farRetained > 0,'Cartesian-only far corner must survive');
    checkPopulation(farRetained,expected(farCorner),'Cartesian-only far corner');
    const relaxed = __sitesForTest({...p,relaxIterations:2},false);
    assert.deepEqual(relaxed.slice(cartCount),sites.slice(cartCount),'all retained polar sites remain pinned');
    assert(relaxed.slice(0,cartCount).some((s,i)=>s.x!==sites[i].x || s.y!==sites[i].y),'Cartesian prefix still relaxes');
    assert.deepEqual(__sitesForTest(p,false),sites,'global capping is deterministic');
    // The raw oracle owns detached coordinate and index copies, not production arrays.
    const first = {...raw.sites[0]}, firstNucleus = raw.nuclei[0];
    raw.sites[0].x = -999; raw.nuclei[0] = -999;
    const again = __siteCandidatesForTest(p,false);
    assert.deepEqual(again.sites[0],first); assert.equal(again.nuclei[0],firstNucleus);
    assert.deepEqual(__sitesForTest(p,false),sites,'observing raw candidates does not alter selection or RNG');
    process.stdout.write(`global cap cell ${cellSize} falloff ${radialFalloff}: candidates ${result.truncatedFrom}, Cartesian ${cartCount}, polar ${sites.length-cartCount}, far corner ${farRetained}/${farRaw}\n`);
  }
}

{
  const p = {...params(), cellSize: 0.5, jitter: 0.9};
  const one = areaCV(__sitesForTest({...p, relaxIterations: 1}, false));
  const two = areaCV(__sitesForTest({...p, relaxIterations: 2}, false));
  assert(two < one && two <= 0.15, `Lloyd area CV one ${one}, two ${two}`);
  process.stdout.write(`Lloyd area CV one ${one}, two ${two}\n`);
}
/** Sum true 3D facet areas, matching the export's adaptive diagonal. */
function steepAreaFraction(grid: number[][], width: number, height: number): number {
  const rows = grid.length, cols = grid[0].length, dx = width / (cols - 1), dy = height / (rows - 1);
  let steep = 0, total = 0;
  const add = (a: number[], b: number[], c: number[]): void => {
    const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2];
    const vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
    const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
    const area = Math.hypot(nx, ny, nz) / 2;
    total += area;
    if (Math.atan2(Math.hypot(nx, ny), Math.abs(nz)) > 67 * Math.PI / 180) steep += area;
  };
  for (let j = 0; j < rows-1; j++) for (let i = 0; i < cols-1; i++) {
    const a=[0,0,grid[j][i]],b=[dx,0,grid[j][i+1]],c=[0,dy,grid[j+1][i]],d=[dx,dy,grid[j+1][i+1]];
    if (preferZ00Z11Diagonal(a[2],b[2],c[2],d[2])) { add(a,b,d); add(a,d,c); }
    else { add(a,b,c); add(b,d,c); }
  }
  return steep / total;
}
for (const seed of [0, 5, 7, 18, 50, 75, 2971519875]) for (const name of ['relief-pockets','relief-starburst','flat-pockets']) {
  Object.assign(STATE, DEFAULTS, presetState(name === 'flat-pockets' ? 'relief-pockets' : name), {resolution: 400, seed});
  if (name === 'flat-pockets') Object.assign(STATE, {distortion: 0, reliefCrestVariation: 0, reliefJunctionLift: 0, reliefBaseAmplitude: 0, reliefBaseMode: 'flat'});
  generateNoiseMesh();
  assert(STATE.vertices);
  const fraction = steepAreaFraction(STATE.vertices, STATE.meshX, STATE.meshY);
  assert(fraction <= 0.005, `${name} seed ${seed} facet area over 67 degrees ${fraction}`);
  process.stdout.write(`${name} seed ${seed} steep facet fraction ${fraction}\n`);
}
// A physical sigma retains a constant signal at truncated edges and is separable by pitch.
{
  const constant = Array.from({length: 11}, () => Array.from({length: 9}, () => 7));
  const result = gaussianSmooth(constant, 11, 9, 4, 10, 0.7);
  for (const row of result) for (const z of row) assert(Math.abs(z - 7) < 1e-12);
  assert.equal(gaussianSmooth(constant, 11, 9, 4, 10, 0), constant);
}
// Finite resolution-coincidence regression coverage; this is not an all-seed bound.
for (const seed of [0, 5, 7, 18]) for (const name of ['ridged','relief-pockets','gentle-waves']) {
  // Square grids at 201 and 401 have exactly coincident samples in both axes.
  const state = name === 'ridged' ? {noiseType: 'ridged' as const, frequency: 0.3, smoothRadiusIn: 0.2} : presetState(name);
  Object.assign(STATE, DEFAULTS, state, {meshX: 24, meshY: 24, resolution: 201, seed});
  generateNoiseMesh();
  const coarse = STATE.vertices!;
  STATE.resolution = 401;
  generateNoiseMesh();
  const fine = STATE.vertices!;
  let sum = 0, max = 0;
  for (let j=0;j<201;j++) for (let i=0;i<201;i++) {
    const error = Math.abs(coarse[j][i]-fine[j*2][i*2]);
    sum += error; max = Math.max(max,error);
  }
  const depth = Math.min(STATE.amplitude,STATE.baseThickness), mean = sum/(201*201);
  assert(mean <= depth*0.005 && max <= depth*0.03, `${name} seed ${seed} coincident mean ${mean}, max ${max}, depth ${depth}`);
  process.stdout.write(`${name} seed ${seed} coincident mean ${mean}, max ${max}\n`);
}
{
  Object.assign(STATE, DEFAULTS, {mode: 'noise', noiseType: 'voronoi-relief', reliefWallWidth: 0.11, reliefCellSize: 2});
  assert.match(buildReliefStepoverWarning(0.05)!, /Nominal pre-clamp ridge-width estimate 0.033"/);
  assert.doesNotMatch(buildReliefStepoverWarning(0.05)!, /Narrowest|measured width/);
  assert.equal(buildReliefStepoverWarning(0.01), undefined);
  Object.assign(STATE, {smoothRadiusIn:0.123,dmSmoothRadiusIn:0.456});
  const decoded=deserializeConfig('?c='+serializeConfig());
  assert.equal(decoded.smoothRadiusIn,0.123); assert.equal(decoded.dmSmoothRadiusIn,0.456);
  const old=Buffer.from(JSON.stringify({_v:CURRENT_PAYLOAD_VERSION-1,smoothIter:10})).toString('base64url');
  assert.deepEqual(deserializeConfig('?c='+old),{}); assert(consumeOutdatedLinkReset());
}
// A dense layout can collapse every crest despite a positive nominal estimate.
{
  Object.assign(STATE, DEFAULTS, {noiseType:'voronoi-relief', meshX:36, meshY:24,
    resolution:201, seed:5, reliefCellSize:0.5, reliefWallWidth:0.5, distortion:0});
  generateNoiseMesh();
  assert.equal(STATE.reliefCrestClipStatus,'collapsed');
  assert.match(buildReliefStepoverWarning(0.005)!, /collapse to zero/);
  assert(getReliefRidgeInfo(STATE)!.nominalRidgeWidthIn > 0);
  // Even an identity, evenly spaced layout can narrow positive crest bands locally.
  Object.assign(STATE, DEFAULTS, {noiseType:'voronoi-relief', resolution:201, seed:5,
    reliefCellSize:2, reliefWallWidth:0.5, reliefJitter:0, reliefRelaxIterations:0});
  generateNoiseMesh();
  assert.equal(STATE.reliefCrestClipStatus,'narrowed');
  assert.match(buildReliefStepoverWarning(0.001)!, /Local clipping narrows/);
  Object.assign(STATE, DEFAULTS, {noiseType:'voronoi-relief', reliefWallWidth:0});
  assert.match(buildReliefStepoverWarning(0.001)!, /crest band is disabled/);
  for (const key of ['distortion','reliefAnisotropy'] as const) {
    Object.assign(STATE, DEFAULTS, {noiseType:'voronoi-relief', [key]:0.2});
    assert.match(buildReliefStepoverWarning(0.001)!, /does not bound physical ridge width/);
  }
  Object.assign(STATE, DEFAULTS, {noiseType:'voronoi-relief', reliefCrestClipStatus:'collapsed'});
  for (const mode of ['depthmap','drape'] as const) {
    STATE.mode=mode;
    assert.equal(getReliefRidgeInfo(STATE),null);
    assert.equal(buildReliefStepoverWarning(0.005),undefined);
  }
  Object.assign(STATE, DEFAULTS, {reliefCrestClipStatus:'collapsed',resolution:16});
  generateNoiseMesh();
  assert.equal(STATE.reliefCrestClipStatus,'none','scalar generation resets relief diagnostics');
  Object.assign(STATE,{mode:'depthmap',depthMap:null,reliefCrestClipStatus:'collapsed'});
  generateDepthMapMesh();
  assert.equal(STATE.reliefCrestClipStatus,'none','image generation resets relief diagnostics');
}
Object.assign(STATE,DEFAULTS);
