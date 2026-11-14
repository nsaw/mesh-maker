/** Exact producer/project/history contracts, independent owner and hash oracles. */
import assert from 'node:assert/strict';
import { NoiseGeneration, type NoiseWorker } from '../src/noise/controller';
import { rankSitesExactly } from './exact-metric-rank-oracle';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DEFAULTS, CURRENT_PAYLOAD_VERSION } from '../src/state';
import { presetState } from '../src/noise/presets';
import { SimplexNoiseGen } from '../src/noise/generators';
import { SiteGrid } from '../src/noise/site-grid';
import { noiseGridShape } from '../src/noise/grid-shape';
import { assertFrozenReliefWork, frozenReliefQueryWork, MAX_FROZEN_RELIEF_QUERY_WORK, reliefMeasurementShape } from '../src/noise/relief-work-budget';
import { buildNoiseSurface, noiseSurfaceParams } from '../src/noise/surface';
import { packNoiseSurface, unpackNoiseSurface } from '../src/noise/messages';
import { copyReliefSites, editReliefSite, validateReliefSites } from '../src/noise/relief-sites';
import { sampleReliefParamsFromState, describeReliefQuery, VoronoiReliefGen, reliefOwnerOracle, relaxReliefSites } from '../src/noise/voronoi-relief';
import { captureReliefProject, copyReliefProject, encodeReliefProject, parseReliefProject, projectSurfaceParams, preflightReliefProject, assertReliefProjectGenerationWork, ReliefProjectHistory } from '../src/relief-project';
import type { ReliefSiteSet } from '../src/types';

const make = (key = 'relief-pockets', resolution = 64) => buildNoiseSurface(noiseSurfaceParams({...DEFAULTS, ...presetState(key), resolution}));
const bytes = (xy: Float64Array) => new Uint8Array(xy.buffer, xy.byteOffset, xy.byteLength);
for (const name of ['relief-vertical', 'relief-pockets', 'relief-radial', 'relief-starburst']) {
  const surface = make(name), project = captureReliefProject(surface);
  const frozen = buildNoiseSurface(projectSurfaceParams(project, 3));
  assert.deepEqual(frozen.vertices, surface.vertices, `${name}: freeze reproduces every height`);
  assert.deepEqual(buildNoiseSurface(projectSurfaceParams(parseReliefProject(encodeReliefProject(project)), 4)).vertices, surface.vertices);
  assert.deepEqual(surface.reliefSource!.sites.ids, Uint32Array.from({length: project.sites.ids.length}, (_, i) => i));
  preflightReliefProject(project);
}
const cappedSurface = buildNoiseSurface(noiseSurfaceParams({...DEFAULTS, ...presetState('relief-pockets'), meshX:36, meshY:24, resolution:32, reliefCellSize:0.2, reliefDensityStrength:2}));
const cappedProject = captureReliefProject(cappedSurface);
assert.equal(cappedProject.sites.ids.length,4096);assert(cappedProject.sites.truncatedFrom>4096);
assert.deepEqual(buildNoiseSurface(projectSurfaceParams(parseReliefProject(encodeReliefProject(cappedProject)),5)).vertices,cappedSurface.vertices,'freeze retains the exact cap selection and relaxation');
const original = make(), document = captureReliefProject(original), roundtrip = parseReliefProject(encodeReliefProject(document));
assert.deepEqual(roundtrip, document);
for(const revision of[-1,NaN,Infinity])assert.throws(()=>projectSurfaceParams(document,revision),/source revision/);
const exposedSites=original.reliefSource!.sites; exposedSites.xy[0]=999;exposedSites.ids[0]=999;
assert.deepEqual(original.reliefSource!.sites,document.sites,'producer keeps private immutable retained arrays');
const exposedParams=original.reliefSource!.params;if(exposedParams.reliefSites)exposedParams.reliefSites.xy[0]=999;
assert.deepEqual(original.reliefSource!.params.reliefSites,null);
const frozenPublished=buildNoiseSurface(projectSurfaceParams(document,2)).reliefSource!;frozenPublished.params.reliefSites!.xy[0]=999;
assert.deepEqual(frozenPublished.params.reliefSites,document.sites,'published frozen request arrays are private copies');
assert.throws(() => captureReliefProject(buildNoiseSurface(noiseSurfaceParams(DEFAULTS))), /only supports procedural/);
assert.equal(document.params.resolution, 64);
const signed = parseReliefProject(encodeReliefProject(document)); signed.sites.xy[0] = -0;
const signedSettings = {...signed, params: {...signed.params, offset: -0}};
const restoredSigned = parseReliefProject(encodeReliefProject(signedSettings));
assert.deepEqual(bytes(restoredSigned.sites.xy), bytes(signed.sites.xy));
assert(Object.is(restoredSigned.sites.xy[0], -0) && Object.is(restoredSigned.params.offset, -0));
const starburst = captureReliefProject(buildNoiseSurface(noiseSurfaceParams({...DEFAULTS, ...presetState('relief-starburst'), resolution:32, seed:5})));
assert(validateReliefSites(starburst.sites, starburst.params.meshX, starburst.params.meshY) > 0, 'producer coincidence is present and retained');
assert.deepEqual(parseReliefProject(encodeReliefProject(starburst)).sites, starburst.sites);
assert.throws(() => editReliefSite(document.sites, 12, 24, {kind:'add', x:document.sites.xy[0], y:document.sites.xy[1]}), /already occupies/);
const erased = editReliefSite(document.sites, 12, 24, {kind:'erase', id:document.sites.ids[1]});
assert.deepEqual(Array.from(erased.ids), Array.from(document.sites.ids).filter((_, i) => i !== 1));
const added = editReliefSite(erased, 12, 24, {kind:'add', x:0, y:0});
assert.equal(added.ids.at(-1), document.sites.ids.at(-1)! + 1); assert.equal(added.pinned.at(-1), 0);
assert.deepEqual(document.sites, roundtrip.sites, 'editing leaves its input untouched');

// Reaching the largest uint32 ID does not exhaust the available identity space.
const fullRangeSites: ReliefSiteSet = {xy:new Float64Array([1,1,2,2,3,3,4,4]),
  ids:new Uint32Array([0,1,0xfffffffe,0xffffffff]),pinned:new Uint8Array([1,0,1,0]),truncatedFrom:0};
const gapAdded=editReliefSite(fullRangeSites,12,24,{kind:'add',x:5,y:5});
assert.deepEqual(gapAdded.ids,new Uint32Array([0,1,2,0xfffffffe,0xffffffff]));
assert.deepEqual(gapAdded.pinned,new Uint8Array([1,0,0,1,0]));
for(let i=0;i<fullRangeSites.ids.length;i++){
  const retained=gapAdded.ids.indexOf(fullRangeSites.ids[i]);
  assert.deepEqual(gapAdded.xy.slice(retained*2,retained*2+2),fullRangeSites.xy.slice(i*2,i*2+2));
}
const rangeDocument={...document,sites:fullRangeSites},rangeHistory=new ReliefProjectHistory(rangeDocument,true);
rangeHistory.replace({...rangeDocument,sites:gapAdded});assert(rangeHistory.undo());assert.deepEqual(rangeHistory.current,rangeDocument);
assert(rangeHistory.redo());assert.deepEqual(rangeHistory.current.sites,gapAdded);
const missingZero=editReliefSite({...fullRangeSites,ids:new Uint32Array([7,31,0xfffffffe,0xffffffff])},12,24,{kind:'add',x:5,y:5});
assert.deepEqual(missingZero.ids,new Uint32Array([0,7,31,0xfffffffe,0xffffffff]));

// A valid small file must preflight within a generous process deadline even when sites
// cluster near one corner. The old median-spacing index scanned empty buckets per pixel.
const clusterBase = captureReliefProject(buildNoiseSurface(noiseSurfaceParams({
  ...DEFAULTS, noiseType:'voronoi-relief', meshX:12, meshY:12, resolution:16,
})));
const clusteredProject = {...clusterBase, sites:{
  xy:new Float64Array([0,0,0.000001,0,0,0.000001,12,12]),
  ids:new Uint32Array([7,31,99,255]), pinned:new Uint8Array([0,1,0,1]), truncatedFrom:0,
}};
const preflightScript = `import {readFileSync} from 'node:fs';
import {parseReliefProject,preflightReliefProject} from ${JSON.stringify(new URL('../src/relief-project.ts',import.meta.url).href)};
const project=parseReliefProject(readFileSync(0,'utf8'));preflightReliefProject(project);
process.stdout.write('accepted clustered project preflight passed');`;
assert.equal(execFileSync(process.execPath,['--import','tsx','--input-type=module','--eval',preflightScript],{
  input:encodeReliefProject(clusteredProject), encoding:'utf8', timeout:8000,
}), 'accepted clustered project preflight passed');

// Resource admission precedes the index's own coincidence-expanded spacing queries.
// The file contract remains lossless, including layouts too expensive to regenerate.
const coincidentPopulation: ReliefSiteSet = {
  xy:Float64Array.from({length:8192},()=>6), ids:Uint32Array.from({length:4096},(_,i)=>i),
  pinned:new Uint8Array(4096), truncatedFrom:0,
};
const expensiveProject={...clusterBase,sites:coincidentPopulation};
const expensiveText=encodeReliefProject(expensiveProject);
assert.deepEqual(parseReliefProject(expensiveText),expensiveProject);
assert.deepEqual(copyReliefProject(expensiveProject),expensiveProject);
assert.equal(validateReliefSites(coincidentPopulation,12,12),4095);
const admittedHistory=new ReliefProjectHistory(document,true), retainedText=encodeReliefProject(admittedHistory.current);
const originalFromSites=SiteGrid.fromSites;
let heavyEntries=0;
SiteGrid.fromSites=()=>{ heavyEntries++; throw new Error('Heavy index entered before resource admission'); };
try {
  assert.throws(()=>preflightReliefProject(expensiveProject),/coincident-site query work/);
  assert.throws(()=>projectSurfaceParams(expensiveProject,0),/coincident-site query work/);
  const settings=noiseSurfaceParams({...expensiveProject.params,reliefSites:coincidentPopulation,reliefRevision:0});
  assert.throws(()=>buildNoiseSurface(settings),/coincident-site query work/,'direct frozen generation cannot bypass admission');
  const sample=sampleReliefParamsFromState(16,16,12,12,settings.seed,settings);
  assert.throws(()=>relaxReliefSites(sample,coincidentPopulation),/coincident-site query work/);
  await assert.rejects(admittedHistory.open(expensiveText,async project=>preflightReliefProject(project)),/coincident-site query work/);
  assert.equal(heavyEntries,0,'negative control refuses without executing quadratic spacing or billions of geometry queries');
} finally { SiteGrid.fromSites=originalFromSites; }
assert.equal(encodeReliefProject(admittedHistory.current),retainedText);
assert.equal(admittedHistory.dirty,false);
assert.equal(admittedHistory.canUndo,false);

// Admission units are integer candidate visits, with an inclusive boundary and no timing claim.
const budgetShape={cols:2,rows:2,meshX:1,meshY:1};
const pair: ReliefSiteSet={xy:new Float64Array([0,0,-0,0]),ids:new Uint32Array([7,99]),pinned:new Uint8Array([0,1]),truncatedFrom:0};
const pairWork=frozenReliefQueryWork(budgetShape,pair);
const remainingQueries=(MAX_FROZEN_RELIEF_QUERY_WORK-pairWork)/2;
assert(Number.isSafeInteger(remainingQueries));
assert.equal(frozenReliefQueryWork(budgetShape,pair,remainingQueries),MAX_FROZEN_RELIEF_QUERY_WORK);
assert.doesNotThrow(()=>assertFrozenReliefWork(budgetShape,pair,remainingQueries));
assert.throws(()=>assertFrozenReliefWork(budgetShape,pair,remainingQueries+1),/coincident-site query work/);
for(const invalid of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER]) {
  assert.throws(()=>frozenReliefQueryWork(budgetShape,pair,invalid),/Invalid frozen relief/);
}
assert.throws(()=>frozenReliefQueryWork(budgetShape,{xy:new Float64Array(),ids:new Uint32Array(),pinned:new Uint8Array(),truncatedFrom:0},Number.MAX_SAFE_INTEGER),
  /Invalid frozen relief query work/,'empty layouts cannot hide query-count overflow');
assert(Object.is(pair.xy[2],-0),'admission groups signed zero without rewriting its bytes');
assert.deepEqual(reliefMeasurementShape(36,24),{cols:481,rows:321});
const largeQuadrature=reliefMeasurementShape(360,240);
assert(largeQuadrature.cols*largeQuadrature.rows<=320000);
assert.doesNotThrow(()=>assertReliefProjectGenerationWork({...cappedProject,params:{...cappedProject.params,resolution:1024}}),
  '4096 ordinary distributed sites stay admitted at the maximum output width');
const fullGridSites: ReliefSiteSet={
  xy:Float64Array.from({length:8192},(_,i)=>i%2===0?(Math.floor(i/2)%64)/63:Math.floor(i/128)/63*24),
  ids:Uint32Array.from({length:4096},(_,i)=>i),pinned:new Uint8Array(4096),truncatedFrom:0,
};
assert.doesNotThrow(()=>assertReliefProjectGenerationWork({...document,params:{...document.params,meshX:1,meshY:24,resolution:400},sites:fullGridSites}),
  'distributed frozen sites remain supported near the project grid-node limit');

// Admission uses the producer's exact floating-point operation order at a rounding tie.
// Reassociating resolution * (Y / X) as resolution * Y / X adds a row here.
const boundaryParams={...clusterBase.params,resolution:3,meshX:1.8154845485377136,meshY:7.564518952240473};
assert.equal(Math.max(4,Math.round(boundaryParams.resolution*boundaryParams.meshY/boundaryParams.meshX)),13);
const boundaryShape=noiseGridShape(boundaryParams.resolution,boundaryParams.meshX,boundaryParams.meshY);
assert.deepEqual(boundaryShape,{cols:3,rows:12});
const boundarySites: ReliefSiteSet={xy:new Float64Array(2301*2),ids:Uint32Array.from({length:2301},(_,i)=>i),pinned:new Uint8Array(2301),truncatedFrom:0};
const boundaryProject={params:boundaryParams,sites:boundarySites,query:describeReliefQuery(sampleReliefParamsFromState(
  boundaryShape.cols,boundaryShape.rows,boundaryParams.meshX,boundaryParams.meshY,boundaryParams.seed,boundaryParams))};
const boundaryRestored=parseReliefProject(encodeReliefProject(boundaryProject));
assert.deepEqual(boundaryRestored,boundaryProject);
assert.equal(frozenReliefQueryWork({...boundaryShape,meshX:boundaryParams.meshX,meshY:boundaryParams.meshY},boundarySites),16_774_290);
assert.doesNotThrow(()=>assertReliefProjectGenerationWork(boundaryRestored));
assert.throws(()=>assertFrozenReliefWork({...boundaryShape,rows:13,meshX:boundaryParams.meshX,meshY:boundaryParams.meshY},boundarySites),/coincident-site query work/);
let boundaryHeavyEntries=0;
SiteGrid.fromSites=()=>{boundaryHeavyEntries++;throw new Error('Boundary admission reached heavy index');};
try {
  assert.throws(()=>preflightReliefProject(boundaryRestored),/Boundary admission reached heavy index/,
    'project preflight admits the same represented shape as direct generation');
  assert.throws(()=>buildNoiseSurface(noiseSurfaceParams({...boundaryParams,reliefSites:boundarySites,reliefRevision:0})),
    /Boundary admission reached heavy index/,'direct frozen sampling agrees without executing the expensive geometry');
  assert.equal(boundaryHeavyEntries,2);
} finally {SiteGrid.fromSites=originalFromSites;}
const smallBoundary=buildNoiseSurface(noiseSurfaceParams({...boundaryParams,reliefSites:pair,reliefRevision:0}));
assert.equal(smallBoundary.cols,boundaryShape.cols);assert.equal(smallBoundary.rows,boundaryShape.rows);

// Independent distance ordering covers clustered, sparse, collinear and coincident
// authored populations. Bucket sizing must change only work, not arithmetic or ties.
const layouts = [
  clusteredProject.sites.xy,
  new Float64Array([0,0,0.000001,0,0,0.000001,12,0,0,12,12,12,6,6]),
  new Float64Array([0,6,0.000001,6,0.000002,6,6,6,12,6]),
  new Float64Array([0,0,0,0,0.000001,0,0,0.000001,12,12]),
];
for (const xy of layouts) {
  const sites = {xy, ids:Uint32Array.from({length:xy.length/2},(_,i)=>7+i*31),
    pinned:Uint8Array.from({length:xy.length/2},(_,i)=>i%2), truncatedFrom:0};
  const positions = Array.from(sites.ids,(_,i)=>({x:xy[i*2],y:xy[i*2+1]}));
  const index = SiteGrid.fromSites(positions);
  for (const [angle,scale] of [[0,1],[35,3]]) {
    const cosA=Math.cos(angle*Math.PI/180),sinA=Math.sin(angle*Math.PI/180);
    for (const [x,y] of [[0,0],[6,6],[12,12],[0,12],[12,0],[-12,24],[24,-12],[0.0000005,0]]) {
      const distances=positions.map((site,i)=>{
        const dx=x-site.x,dy=y-site.y;
        return {i,d:scale===1?Math.hypot(dx,dy):Math.hypot((dx*cosA+dy*sinA)*scale,-dx*sinA+dy*cosA)};
      });
      const ordered=rankSitesExactly(positions,x,y,cosA,sinA,scale).map(i=>distances[i]);
      const actual=index.nearestFour(x,y,cosA,sinA,scale);
      assert.deepEqual([actual.f1,actual.f2,actual.f3,actual.f4],ordered.slice(0,4).map(point=>point.d));
      assert.deepEqual([actual.idx,actual.idx2,actual.idx3,actual.idx4],ordered.slice(0,4).map(point=>point.i));
      assert.equal(index.nearestOwner(x,y),rankSitesExactly(positions,x,y)[0]);
    }
  }
  const state={...clusterBase.params,reliefSites:sites,reliefAnisotropy:1.3,reliefAnisotropyAngle:35,distortion:0.8};
  const sample=sampleReliefParamsFromState(16,16,12,12,state.seed,state);
  const indexed=new VoronoiReliefGen(state.seed).sampleGridResult(sample);
  assert.deepEqual(indexed.grid,VoronoiReliefGen.bruteForceForTest(sample));
  assert.deepEqual(indexed.source.sites,sites,'sampling retains every authored coordinate, identity and pin');
  const owner=reliefOwnerOracle(indexed.source),m=indexed.source.query.metric,w=indexed.source.query.warp;
  const flow=new SimplexNoiseGen(w.seed);
  for (const [x,y] of [[0,0],[6,6],[12,12],[0,12],[12,0],[-12,24],[24,-12]]) {
    const qx=x+flow.noise(x*w.frequency,y*w.frequency)*w.amplitude;
    const qy=y+flow.noise(x*w.frequency+31.7,y*w.frequency+17.3)*w.amplitude;
    const nearest=rankSitesExactly(positions,qx,qy,m.cosA,m.sinA,m.scale)[0];
    assert.equal(owner(x,y),sites.ids[nearest]);
  }
  const relaxed=relaxReliefSites(sample,sites);
  assert.deepEqual(relaxed.ids,sites.ids);assert.deepEqual(relaxed.pinned,sites.pinned);
  sites.pinned.forEach((pin,i)=>{if(pin)assert.deepEqual(relaxed.xy.slice(i*2,i*2+2),xy.slice(i*2,i*2+2));});
}

// Raw finite seeds remain lossless even though the producer's PRNG consumes uint32.
for (const seed of [-0, -9.5, 4294967301.25, Number.MAX_VALUE, -Number.MAX_VALUE]) {
  const surface=buildNoiseSurface(noiseSurfaceParams({...DEFAULTS,...presetState('relief-pockets'), seed, resolution:16,
    cellJitter:0.73, cellMetric:'manhattan', invert:true, distortion:0.4, reliefAnisotropy:1.7, reliefAnisotropyAngle:19}));
  const project=captureReliefProject(surface), restored=parseReliefProject(encodeReliefProject(project));
  assert(Object.is(restored.params.seed,seed));
  assert.equal(restored.query.seed,seed>>>0);
  assert.equal(restored.query.implementation,'meshcraft-relief-query/2');
  assert.equal(restored.query.ownerPolicy,'exact-represented-metric-stable-id-v1');
  assert.deepEqual(restored.query.warp.kernel,new SimplexNoiseGen(restored.query.warp.seed).describeKernel());
  assert.deepEqual(buildNoiseSurface(projectSurfaceParams(restored,4)).vertices,surface.vertices);
  const kernel=surface.reliefSource!.query.warp.kernel!;
  assert(Object.isFrozen(kernel) && Object.isFrozen(kernel.perm) && Object.isFrozen(kernel.grad2) && kernel.grad2.every(Object.isFrozen));
  assert.throws(()=>{(kernel.perm as number[])[0]=999;},TypeError);
  const altered=JSON.parse(encodeReliefProject(project));altered.query.warp.kernel.perm[0]^=1;
  assert.throws(()=>parseReliefProject(JSON.stringify(altered)),/disagrees/);
}

// Full uint32 identity hashes, checked with independent integer arithmetic on a one-site floor.
function hash(identity: number, seed: number): number {
  const mask = 0xffffffffn;
  let h = ((BigInt(identity) + 1n) * 374761393n + BigInt(seed >>> 0) * 668265263n) & mask;
  h = ((h ^ (h >> 13n)) * 1274126177n) & mask;
  return Number((h ^ (h >> 16n)) & mask) / 4294967296;
}
const p = {...sampleReliefParamsFromState(3, 3, 12, 12, 5, DEFAULTS), cellSize:1, cutDepthIn:0.05, seamDepth:0.05, depthVariation:1,
  radialFoci:[], pillow:0, wallWidth:0, crestVariation:0, junctionLift:0, baseMode:'flat' as const, polarity:'pockets' as const,
  invertProfile:0, cellSizeGradient:0, voidStrength:0, warpDistortion:0, attractorMode:'none' as const};
const sn = (new SimplexNoiseGen(125).noise(0.96,0.96) + 1) * 0.5;
const t = Math.max(0, Math.min(1, (sn - 0.62) / 0.2));
for (const id of [71, 0xffffffff]) {
  const frozen: ReliefSiteSet = {xy:new Float64Array([6,6]), ids:new Uint32Array([id]), pinned:new Uint8Array([0]), truncatedFrom:0};
  const raw = new VoronoiReliefGen(5).sampleGridResult({...p, frozenSites:frozen});
  const expected = -0.65 * (0.45 + 0.65 * hash(id,18)) * (1 - 0.5 * t * t * (3 - 2 * t));
  assert(Math.abs(raw.grid[1][1] - expected) < 1e-14, `retained owner ${id} keeps its hash identity`);
}

// Owner queries use the completed source, with an independent brute metric/warp evaluator.
const owned = make('relief-starburst').reliefSource!;
const oracle = reliefOwnerOracle(owned), flow = new SimplexNoiseGen(owned.query.warp.seed), ownedSites=owned.sites;
for (let k=0;k<400;k++) {
  const x = (k * 0.61803398875 % 1) * owned.query.meshX, y = (k * 0.41421356237 % 1) * owned.query.meshY;
  const w = owned.query.warp, m = owned.query.metric;
  const qx = x + flow.noise(x*w.frequency,y*w.frequency)*w.amplitude;
  const qy = y + flow.noise(x*w.frequency+31.7,y*w.frequency+17.3)*w.amplitude;
  const positions=Array.from(ownedSites.ids,(_,i)=>({x:ownedSites.xy[i*2],y:ownedSites.xy[i*2+1]}));
  const best=rankSitesExactly(positions,qx,qy,m.cosA,m.sinA,m.scale)[0];
  assert.equal(oracle(x,y),ownedSites.ids[best]);
}
const coincident: ReliefSiteSet = {xy:new Float64Array([6,6,6,6]),ids:new Uint32Array([7,99]),pinned:new Uint8Array([0,1]),truncatedFrom:0};
const coincidentSource=new VoronoiReliefGen(5).sampleGridResult({...p,frozenSites:coincident}).source;
assert.equal(reliefOwnerOracle(coincidentSource)(6,6),7,'coincident ownership retains the lower stable identity');
const emptyProject={...document,sites:{xy:new Float64Array(),ids:new Uint32Array(),pinned:new Uint8Array(),truncatedFrom:0}};
assert.deepEqual(parseReliefProject(encodeReliefProject(emptyProject)).sites,emptyProject.sites);
const emptySurface=buildNoiseSurface(projectSurfaceParams(emptyProject,6));preflightReliefProject(emptyProject);
assert.equal(reliefOwnerOracle(emptySurface.reliefSource!)(0,0),null);
const mixed: ReliefSiteSet = {xy:new Float64Array([1,1,3,3,6,6,10,10]), ids:new Uint32Array([1,7,20,99]), pinned:new Uint8Array([0,1,1,0]), truncatedFrom:0};
const relaxed = relaxReliefSites(p,mixed);
assert.deepEqual(Array.from(relaxed.xy.slice(2,6)),Array.from(mixed.xy.slice(2,6)), 'explicit pin flags survive additions after the polar tail');
assert.notDeepEqual(Array.from(relaxed.xy.slice(6)),Array.from(mixed.xy.slice(6)), 'un-pinned addition after polar sites can relax');
assert.deepEqual(mixed.xy,new Float64Array([1,1,3,3,6,6,10,10]));

// A completed preview has display authority, while only a current full surface supplies a project.
{
  const params=noiseSurfaceParams({...DEFAULTS,...presetState('relief-pockets'),resolution:16});
  const workers: Array<NoiseWorker & {input: Parameters<NoiseWorker['postMessage']>[0] | null}> = [];
  const generation=new NoiseGeneration({createWorker:()=>{
    const worker: typeof workers[number]={input:null,onmessage:null,onerror:null,onmessageerror:null,
      postMessage(input){this.input=input;},terminate(){this.onmessage=null;this.onerror=null;this.onmessageerror=null;}};
    workers.push(worker);return worker;
  }});
  const preview=generation.start(params,'preview');
  assert.equal(generation.completedSource(params),null);
  const emit=()=>{
    const worker=workers.at(-1)!;
    worker.onmessage!({data:{type:'result',requestId:worker.input!.requestId,surface:packNoiseSurface(buildNoiseSurface(worker.input!.params))}} as MessageEvent);
  };
  emit();await preview;
  assert.equal(generation.completedSource(params),null,'preview metadata cannot become an authoring source');
  const full=generation.start(params,'full');emit();const outcome=await full;
  assert('surface' in outcome);delete outcome.surface.reliefSource;
  const completed=generation.completedSource(params)!;
  assert.deepEqual(captureReliefProject({...buildNoiseSurface(params),reliefSource:completed.source}),captureReliefProject(buildNoiseSurface(params)));
  const retained=completed.source.sites;retained.xy[0]=999;
  assert.notEqual(generation.completedSource(params)!.source.sites.xy[0],999);
  const changed=noiseSurfaceParams({...params,seed:params.seed+1});
  assert.equal(generation.completedSource(changed),null);
  generation.invalidate(changed);assert.equal(generation.completedSource(params),null);
  generation.failSync(changed,'fixture failure');assert.equal(generation.completedSource(changed),null);
  generation.cancel();assert.equal(generation.completedSource(params),null);
}

{
  const generation=new NoiseGeneration();
  const positive=noiseSurfaceParams({...DEFAULTS,seed:0}),negative=noiseSurfaceParams({...DEFAULTS,seed:-0});
  const revision=generation.invalidate(positive);
  assert(generation.invalidate(negative)>revision,'represented seed changes retain distinct source revisions');
  generation.cancel();
}

// Transport and history readers receive copies; transferring them cannot detach retained state.
const history = new ReliefProjectHistory(document,true), ticket = history.captureSave();
const packed = packNoiseSurface(original), unpacked = unpackNoiseSurface(structuredClone(packed,{transfer:[packed.heights.buffer,packed.reliefSource!.sites.xy.buffer]}));
assert.deepEqual(unpacked.vertices,original.vertices);
assert.deepEqual(original.reliefSource!.sites,document.sites);
const external = history.current;
structuredClone(external.sites,{transfer:[external.sites.xy.buffer,external.sites.ids.buffer,external.sites.pinned.buffer]});
assert.deepEqual(history.current,document);
const shifted = {...document,sites:editReliefSite(document.sites,12,24,{kind:'move',id:document.sites.ids[0],x:0,y:0})};
history.beginGesture(); history.updateGesture(shifted);
history.updateGesture({...shifted,sites:editReliefSite(shifted.sites,12,24,{kind:'move',id:shifted.sites.ids[0],x:0.5,y:0.5})});
history.commitGesture();
assert.equal(history.markSaved(ticket),false,'a save captured before edits cannot clear dirty'); assert(history.dirty);
const latestRevision = history.revision; assert(history.undo()); assert(history.revision>latestRevision);
assert.deepEqual(buildNoiseSurface(projectSurfaceParams(history.current,history.revision)).vertices,original.vertices);
assert.equal(history.dirty,false); assert.equal(history.undo(),false,'one drag is one checkpoint'); assert(history.redo());
const beforeGesture=history.current; history.beginGesture();history.updateGesture(document);const beforeCancel=history.revision;history.cancelGesture();assert(history.revision>beforeCancel);assert.deepEqual(history.current,beforeGesture);
const staleRevision=history.revision; history.replace(document); assert.equal(history.replace(shifted,staleRevision),false);
let release: (()=>void) | undefined;
const late = history.open(encodeReliefProject(shifted),()=>new Promise<void>(resolve=>{release=resolve;}));
history.replace(document);const afterNew=history.current;release!();assert.equal(await late,false);assert.deepEqual(history.current,afterNew);
assert.equal(await history.open(encodeReliefProject(shifted),async doc=>preflightReliefProject(doc)),true);assert.deepEqual(history.current,shifted);
// Starting a later import retires an earlier intent before either preflight resolves.
for(const invalidLater of [false,true]){
  let finishEarlier: (()=>void) | undefined;
  const earlier=history.open(encodeReliefProject(document),()=>new Promise<void>(resolve=>{finishEarlier=resolve;}));
  if(invalidLater) await assert.rejects(history.open('{}',async()=>undefined));
  else assert(await history.open(encodeReliefProject(shifted),async()=>undefined));
  const latest=history.current;finishEarlier!();assert.equal(await earlier,false);assert.deepEqual(history.current,latest);
}
const savedNow=history.captureSave();assert(history.markSaved(savedNow));assert(!history.dirty);
for(let i=0;i<55;i++)history.replace({...document,params:{...document.params,amplitude:0.2+i*0.001}});
let undone=0;while(history.undo())undone++;assert.equal(undone,50,'history retains exactly its bounded past');
history.replace(document);assert(!history.canRedo);

// Invalid and future documents leave the active source/history untouched.
const valid = JSON.parse(encodeReliefProject(document));
const invalids = [
  {...valid,version:2},{...valid,generation:CURRENT_PAYLOAD_VERSION+1},{...valid,kind:'drape'},{...valid,asset:{}},
  {...valid,params:{...valid.params,mode:'depthmap'}},{...valid,params:{...valid.params,noiseType:'simplex'}},
  {...valid,params:{...valid.params,resolution:2.5}},{...valid,params:{...valid.params,amplitude:false}},
  {...valid,params:{...valid.params,meshX:40}},{...valid,params:{...valid.params,meshX:1,meshY:24,resolution:1024}},{...valid,query:{...valid.query,warp:{...valid.query.warp,amplitude:999}}},
  {...valid,sites:{...valid.sites,count:4097}},{...valid,sites:{...valid.sites,truncatedFrom:valid.sites.count+1}},{...valid,sites:{...valid.sites,xyFloat64LE:valid.sites.xyFloat64LE.slice(1)}},
  {...valid,sites:{...valid.sites,ids:valid.sites.ids.map((id:number,i:number)=>i===1?valid.sites.ids[0]:id)}},
  {...valid,sites:{...valid.sites,pinned:valid.sites.pinned.map((pin:number,i:number)=>i===0?2:pin)}},
  {...valid,sites:{count:1,xyFloat64LE:'AAAAAAAAAAAAAAAAAAAAAB==',ids:[0],pinned:[0],truncatedFrom:0}},
];
for(const bad of invalids){const before=history.current,revision=history.revision;await assert.rejects(history.open(JSON.stringify(bad),async doc=>preflightReliefProject(doc)));assert.deepEqual(history.current,before);assert.equal(history.revision,revision);}
await assert.rejects(history.open(encodeReliefProject(document),async()=>{throw new Error('Preflight failed');}));
assert.throws(()=>parseReliefProject(' '.repeat(1_000_001)),/file size/);
const nanSites = copyReliefSites(document.sites); nanSites.xy[0]=NaN;assert.throws(()=>encodeReliefProject({...document,sites:nanSites}));

// Execute the native class host with high stable IDs and non-prefix pins.
const native = readFileSync(new URL('../grasshopper/components/noise_gen.py',import.meta.url),'utf8');
const parityParams={...p,cols:19,rows:19,wallWidth:0.15,seamDepth:0.8,depthVariation:1,crestVariation:0.2,junctionLift:0.3,pillow:0.2};
const aliases: Record<string,string> = {relaxIterations:'relax_iter',baseAmplitude:'base_amp',baseFrequency:'base_freq'};
const pyParams = Object.fromEntries(Object.entries(parityParams).map(([key,value])=>[aliases[key]??key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),key==='radialFoci'?[]:value]));
const authored: ReliefSiteSet = {...mixed,ids:new Uint32Array([1,7,0xfffffffe,0xffffffff])};
const wireSites = {xy:Array.from(authored.xy),ids:Array.from(authored.ids),pinned:Array.from(authored.pinned),truncated_from:0};
const python = `import ast,json,math,sys
payload=json.loads(sys.stdin.read());module=ast.parse(payload['source']);module.body=[n for n in module.body if isinstance(n,(ast.ClassDef,ast.FunctionDef,ast.Import,ast.ImportFrom)) and not (isinstance(n,(ast.Import,ast.ImportFrom)) and ('Rhino' in ast.unparse(n) or 'rhinoscriptsyntax' in ast.unparse(n)))];scope={'math':math};exec(compile(module,'native','exec'),scope)
gen=scope['VoronoiReliefNoise'](5);p=payload['params'];frozen=payload['sites'];p['frozen_sites']=frozen
out=gen.sample_grid(p);relaxed=gen.relax_sites(p,frozen)
print(json.dumps({'grid':out,'relaxed':relaxed,'hash':gen._edge_hash01(4294967294,4294967295,53)}))`;
const py = JSON.parse(execFileSync('python3',['-I','-c',python],{input:JSON.stringify({source:native,params:pyParams,sites:wireSites}),encoding:'utf8'}));
const web = new VoronoiReliefGen(5).sampleGridResult({...parityParams,frozenSites:authored});
assert(py.grid.every((z:number,i:number)=>Math.abs(z-web.grid[Math.floor(i/parityParams.cols)][i%parityParams.cols])<1e-12));
const webRelaxed=relaxReliefSites(p,authored);assert(py.relaxed.xy.every((v:number,i:number)=>Math.abs(v-webRelaxed.xy[i])<1e-12));
const edgeIndex=Number(((4294967295n*7919n)+4294967295n+1n)&0xffffffffn);assert.equal(py.hash,hash(edgeIndex,53));

let finishOldHistory: (() => void) | undefined;
const historyRace = new ReliefProjectHistory(document);
const oldHistoryOpen = historyRace.open(encodeReliefProject(document), () => new Promise<void>(resolve => { finishOldHistory = resolve; }));
await assert.rejects(historyRace.open('{', async () => undefined)); finishOldHistory!();
assert.equal(await oldHistoryOpen, false, 'history admission also rejects an older preflight after a newer invalid selection');
process.stdout.write('Relief project, frozen identity, query ownership, transport, history and native parity contracts passed.\n');
