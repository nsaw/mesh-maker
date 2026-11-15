import './relief-support.spec';
/** Junction-limit and rejected-generation regressions through production paths. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { blendReliefJunction, reliefCrownWeight, reliefJunctionFields, sampleReliefParamsFromState, VoronoiReliefGen } from '../src/noise/voronoi-relief';
import { SiteGrid } from '../src/noise/site-grid';
import { DEFAULTS, STATE } from '../src/state';
import { getExportSurface } from '../src/export-surface';
import { encodeReliefMaster, parseReliefMaster } from '../src/relief-master';
import { generateNoiseMesh } from '../src/mesh';
import { noiseGeneration, NoiseGeneration } from '../src/noise/controller';
import { noiseSurfaceParams } from '../src/noise/surface';
import { frozenReliefSites } from './relief-fixtures';

// The limit cannot depend on which unequal multiplier becomes the owner or runner-up.
const values = [0.1, 0.35, 0.8, 0.95];
for (const owner of values) for (const second of values.filter(value => value !== owner)) {
  const others = values.filter(value => value !== owner && value !== second);
  for (const third of others) {
    const fourth = others.find(value => value !== third)!;
    const pair = (owner + second) / 2, triple = (owner + second + third) / 3;
    const quad = (owner + second + third + fourth) / 4;
    assert(Math.abs(blendReliefJunction(pair, triple, 1) - triple) < 1e-15);
    assert(Math.abs(blendReliefJunction(pair, quad, 1) - 0.55) < 1e-15);
    assert.equal(blendReliefJunction(pair, triple, 0), pair);
  }
}
function nearbyVariation(cols: number, quad: boolean, inverted: boolean): number {
  const rows = quad ? cols : (cols - 1) / 2 + 1;
  const p = {...sampleReliefParamsFromState(cols, rows, quad ? 6 : 12, 6, 5, DEFAULTS),
    cellSize:6, jitter:0, relaxIterations:0, densityStrength:0, densityNoise:0, radialFoci:[], depthVariation:0,
    pillow:0, baseAmplitude:0, baseMode:'flat' as const, wallWidth:quad ? 0.2 : 0, junctionLift:inverted ? 0 : 1, invertProfile:inverted ? 1 : 0,
    crestVariation:0, warpDistortion:0, attractorMode:'none' as const, anisotropy:quad ? 0 : 2/3,
    anisotropyAngle:45, cutDepthIn:2.4};
  // Six regular sites under the tilted metric have a triple junction at (119/32,63/32).
  // Its unequal wall budgets expose the former pair-dependent junction-lift limits.
  // Four square sites expose the sibling shared-edge crown field at (3,3).
  const i = quad ? (cols - 1) / 2 : (cols - 1) * 119 / 384;
  const j = quad ? i : (rows - 1) * 21 / 64;
  const grid = new VoronoiReliefGen(5).sampleGrid(p);
  let delta = 0;
  for (let y=-1;y<=1;y++) for (let x=-1;x<=1;x++) delta = Math.max(delta, Math.abs(grid[j+y][i+x]-grid[j][i]));
  return delta;
}
for (const [quad,inverted] of [[false,false],[true,false],[false,true]]) {
  const coarse = nearbyVariation(quad ? 129 : 385, quad, inverted), fine = nearbyVariation(quad ? 257 : 769, quad, inverted);
  assert(fine <= coarse * 0.6, `${quad ? 'four' : 'three'}-cell junction must converge as pitch halves: ${coarse}, ${fine}`);
  process.stdout.write(`junction ${quad ? 4 : 3} inverted ${inverted}: ${coarse} -> ${fine}\n`);
}
// The reported real triple has tied nonincident fourth/fifth/sixth sites.
function membershipParams(cols: number) {
  return {...sampleReliefParamsFromState(cols,cols,6,6,5,DEFAULTS),cellSize:2,jitter:0,relaxIterations:0,
    densityStrength:0,densityNoise:0,radialFoci:[],depthVariation:.7,pillow:0,baseAmplitude:0,baseMode:'flat' as const,
    wallWidth:0,junctionLift:0,invertProfile:1,crestVariation:0,warpDistortion:0,attractorMode:'none' as const,
    anisotropy:(Math.sqrt(3)-1)/1.5,anisotropyAngle:45,cutDepthIn:2.4};
}
const outerSites=frozenReliefSites('outer-membership'),mixedSites=frozenReliefSites('mixed-crest');
const variations: number[]=[];
for (const cols of [121,241,481,961]) {
  const grid=VoronoiReliefGen.sampleSitesForTest(membershipParams(cols),outerSites), i=(cols-1)*11/24;
  let variation=0;
  for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++) variation=Math.max(variation,Math.abs(grid[i+y][i+x]-grid[i][i]));
  variations.push(variation);
}
for(let i=1;i<variations.length;i++) assert(variations[i]<=variations[i-1]*.6, `outer-membership triple convergence ${variations}`);
let previousJump=Infinity;
for (const epsilon of [1e-3,1e-5,1e-7,1e-9]) {
  const a=VoronoiReliefGen.queryForTest(membershipParams(121),2.75-epsilon,2.75,outerSites);
  const b=VoronoiReliefGen.queryForTest(membershipParams(121),2.75+epsilon,2.75,outerSites);
  const jump=Math.abs(a-b);
  assert(jump < previousJump*.1, `fixed-Pass-1 membership limit ${epsilon}: ${jump}`);
  previousJump=jump;
}
assert(previousJump<1e-10);
process.stdout.write(`outer membership convergence ${variations}; fixed-Pass-1 final jump ${previousJump}\n`);
for (const [quad,inverted] of [[false,false],[true,false],[false,true]]) {
  const cols=65, rows=quad?65:33;
  const p={...sampleReliefParamsFromState(cols,rows,quad?6:12,6,5,DEFAULTS),cellSize:6,jitter:0,relaxIterations:0,
    densityStrength:0,densityNoise:0,radialFoci:[],depthVariation:0,pillow:0,baseAmplitude:0,baseMode:'flat' as const,
    wallWidth:quad?.2:0,junctionLift:inverted?0:1,invertProfile:inverted?1:0,crestVariation:0,warpDistortion:0,
    attractorMode:'none' as const,anisotropy:quad?0:2/3,anisotropyAngle:45,cutDepthIn:2.4};
  const x=quad?3:119/32,y=quad?3:63/32;
  let previous=Infinity;
  for(const epsilon of [1e-5,1e-7,1e-9]) {
    const jump=Math.abs(VoronoiReliefGen.queryForTest(p,x-epsilon,y)-VoronoiReliefGen.queryForTest(p,x+epsilon,y));
    assert(jump<=previous*.1+1e-14, `sibling fixed-Pass-1 limit ${quad},${inverted}: ${jump}`);
    previous=jump;
  }
  assert(previous<1e-8);
}
// Mixed collapsed/retained bands at the reviewed real triple must share one limit.
const mixedCrest={...sampleReliefParamsFromState(41,41,4,4,5,DEFAULTS),cellSize:.8,jitter:.95,
  relaxIterations:0,densityStrength:0,densityNoise:0,radialFoci:[],depthVariation:0,pillow:0,
  baseAmplitude:0,baseMode:'flat' as const,wallWidth:.3,junctionLift:0,invertProfile:0,
  crestVariation:0,warpDistortion:0,attractorMode:'none' as const,anisotropy:0,cutDepthIn:2.4};
for(const [name,change] of Object.entries({crown:{},sharp:{seamSharpness:1},domed:{invertProfile:1},
  hemisphere:{profile:'hemisphere' as const},parabolic:{profile:'parabolic' as const},
  lift:{junctionLift:1},variation:{depthVariation:.7,crestVariation:.5},cushion:{pillow:1},disabled:{wallWidth:0}})) {
  let previous=Infinity;
  for(const epsilon of [1e-5,1e-7,1e-9]) {
    const p={...mixedCrest,...change};
    const jump=Math.abs(VoronoiReliefGen.queryForTest(p,.39537742389626745-epsilon,.4955797323410449,mixedSites)
      -VoronoiReliefGen.queryForTest(p,.39537742389626745+epsilon,.4955797323410449,mixedSites));
    assert(jump<=previous*.1+1e-14, `mixed-crest junction ${name} must converge: ${epsilon}, ${jump}`);
    previous=jump;
  }
  assert(previous<1e-8,`mixed-crest junction ${name}: ${previous}`);
  process.stdout.write(`mixed-crest junction ${name} final jump ${previous}\n`);
}
// Continuous amplitude must also cross the former owner-specific activation threshold.
assert.equal(reliefCrownWeight(0,0,.25),0);
assert.equal(reliefCrownWeight(.25,0,.25),1);
assert.equal(reliefCrownWeight(.25,.25,.25),0);
for(const width of [0,1e-6,.25]) {
  const delta=1e-10;
  assert(Math.abs(reliefCrownWeight(width+delta,0,.25)-reliefCrownWeight(Math.max(0,width-delta),0,.25))<1e-8,
    `crown junction amplitude must be continuous at width ${width}`);
}

// Distinct coincident sites all participate, including more than four IDs and F1=F3=0.
for (const count of [3,4,5,9]) {
  const sites=Array.from({length:count},()=>({x:0,y:0})), grid=new SiteGrid(sites,1);
  const staticValues=Array.from({length:count},(_,i)=>(i+1)/(count+1));
  const slopeValues=staticValues.map(v=>v*v);
  for(const epsilon of [1e-6,1e-10,0]) {
    const candidates=grid.withinRadius(epsilon,0,2.08*Math.max(epsilon,1e-9));
    assert.equal(candidates.length,count);
    const result=reliefJunctionFields(candidates,epsilon,staticValues,slopeValues);
    for(const [i,values] of [staticValues,slopeValues].entries()) assert.equal(result[i],values.reduce((a,b)=>a+b,0)/count);
  }
}
// Exact metric radius queries match an independent scan and avoid scanning the lattice.
let reads=0;
const plain=Array.from({length:4096},(_,i)=>({x:i%64,y:Math.floor(i/64)}));
const observed=plain.map(p=>({get x(){reads++;return p.x;},get y(){reads++;return p.y;}}));
const radiusGrid=new SiteGrid(observed,1);reads=0;
for(let i=0;i<100;i++)for(const scale of [1,1.00001,2.7]) {
  const x=(i*.618033988749895%1)*64,y=(i*.414213562373095%1)*64,radius=1.2;
  const expected: Array<{index:number;distance:number}>=[];
  for(const [index,p]of plain.entries()) {
    const dx=x-p.x,dy=y-p.y;
    const distance=scale<=1.0001?Math.hypot(dx,dy):Math.hypot((dx+dy)/Math.sqrt(2)*scale,(-dx+dy)/Math.sqrt(2));
    if(distance<radius)expected.push({index,distance});
  }
  const actual=radiusGrid.withinRadius(x,y,radius,1/Math.sqrt(2),1/Math.sqrt(2),scale);
  assert.deepEqual(actual.map(p=>p.index),expected.map(p=>p.index));
  for(let j=0;j<actual.length;j++)assert(Math.abs(actual[j].distance-expected[j].distance)<1e-13);
}
assert(reads<300*100);
const zeroGrid=new SiteGrid([{x:0,y:0}],1);
assert.equal(zeroGrid.withinRadius(1,0,1).length,0);
assert.throws(()=>zeroGrid.withinRadius(0,0,Infinity),RangeError);
process.stdout.write(`radius lattice query site reads ${reads}\n`);

const source = readFileSync(new URL('../grasshopper/components/noise_gen.py',import.meta.url),'utf8');
const py = `import ast,math,json,sys
m=ast.parse(sys.stdin.read());m.body=[n for n in m.body if isinstance(n,ast.ClassDef)];scope={'math':math};exec(compile(m,'native','exec'),scope)
g=scope['VoronoiReliefNoise'](5);print(json.dumps([g._junction_blend(.2,.4,a) for a in [0,.2,.7,1]] + list(g._junction_fields(list(enumerate([1,1.02,1.04,1.3,2,2.08,3])),1,[.1,.2,.3,.4,.5,.6,.7],[.7,.6,.5,.4,.3,.2,.1]))))`;
const native: number[] = JSON.parse(execFileSync('python3',['-I','-c',py],{input:source,encoding:'utf8'}));
for (const [i,support] of [0,.2,.7,1].entries()) assert.equal(native[i],blendReliefJunction(.2,.4,support));
const fields=reliefJunctionFields([1,1.02,1.04,1.3,2,2.08,3].map((distance,index)=>({distance,index})),1,[.1,.2,.3,.4,.5,.6,.7],[.7,.6,.5,.4,.3,.2,.1]);
for(const [i,value] of fields.entries())assert.equal(native[i+4],value);


// Execute full production geometry in both languages, including mixed crest budgets.
for (const change of [{},{depthVariation:.7,junctionLift:1,crestVariation:.5,seamSharpness:1},{invertProfile:1}]) {
  const params={...mixedCrest,...change};
  const aliases: Record<string,string>={relaxIterations:'relax_iter',baseAmplitude:'base_amp',baseFrequency:'base_freq'};
  const pythonParams=Object.fromEntries(Object.entries(params).map(([key,value])=>[
    aliases[key]??key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),value]));
  const python=`import ast,math,json,sys
payload=json.loads(sys.stdin.read());m=ast.parse(payload['source']);m.body=[n for n in m.body if isinstance(n,ast.ClassDef)]
scope={'math':math};exec(compile(m,'native','exec'),scope)
print(json.dumps(scope['VoronoiReliefNoise'](5).sample_grid(payload['params'])))`;
  const nativeGrid: number[]=JSON.parse(execFileSync('python3',['-I','-c',python],{
    input:JSON.stringify({source,params:pythonParams}),encoding:'utf8'}));
  const webGrid=new VoronoiReliefGen(5).sampleGrid(params).flat();
  assert.equal(nativeGrid.length,webGrid.length);
  const error=Math.max(...webGrid.map((value,i)=>Math.abs(value-nativeGrid[i])));
  assert(error<1e-12,`mixed-crest junction Python geometry parity: ${error}`);
  process.stdout.write(`mixed-crest Python full-grid max error ${error}\n`);
}

// A rejected worker/inline request settles, retires busy state and preserves committed geometry.
const rejected = new NoiseGeneration({createWorker:()=>{throw new Error('Workers unavailable');}});
const busy: boolean[]=[];
rejected.onBusy=value=>busy.push(value);
const invalid=noiseSurfaceParams({...DEFAULTS,noiseType:'voronoi-relief',reliefCellSize:0});
const outcome=await rejected.start(invalid,'full');
assert('reason' in outcome); assert.match(outcome.reason,/Relief site enumeration exceeds supported work budget/);
assert.deepEqual(busy,[true,false]); assert(rejected.failed);

// The synchronous adapter rethrows the original failure and retains all committed metadata.
const master = await parseReliefMaster(await encodeReliefMaster({format:'meshcraft-relief',version:1,units:'in',
    cols:2,rows:2,width:1,height:1,dtype:'float64',rowOrder:'bottom-up',heightOrigin:'panel-back',
    backing:.1,stock:.75,triangulation:'tr-bl',mask:false},new Float64Array([.5,.75,.25,.6])));
const previousState = {...STATE};
try {
  Object.assign(STATE, DEFAULTS, {mode:'noise', noiseType:'simplex', resolution:16});
  generateNoiseMesh();
  const record = {vertices:STATE.vertices,cols:STATE.cols,rows:STATE.rows,genTime:STATE.genTime,
    reliefTruncatedFrom:STATE.reliefTruncatedFrom,reliefCrestClipStatus:STATE.reliefCrestClipStatus};
  Object.assign(STATE,{resolution:32,noiseType:'voronoi-relief',reliefCellSize:0});
  assert.throws(()=>generateNoiseMesh(),RangeError);
  assert.deepEqual({vertices:STATE.vertices,cols:STATE.cols,rows:STATE.rows,genTime:STATE.genTime,
    reliefTruncatedFrom:STATE.reliefTruncatedFrom,reliefCrestClipStatus:STATE.reliefCrestClipStatus},record);
  assert.equal(STATE.vertices, record.vertices);
  for (const toolpath of [false,true]) assert.match(String(getExportSurface(toolpath)),/Noise generation failed/);
  // A prior nonzero diagnostic must survive just like its generated grid.
  Object.assign(STATE,DEFAULTS,{mode:'noise',noiseType:'voronoi-relief',meshX:6,meshY:4,
    resolution:16,reliefWallWidth:.9,reliefCellSize:1});
  generateNoiseMesh();
  // Physical cell measurements retain a real band here; the coarse output grid previously missed it.
  assert.equal(STATE.reliefCrestClipStatus,'narrowed');
  const diagnosed={vertices:STATE.vertices,cols:STATE.cols,rows:STATE.rows,genTime:STATE.genTime,
    reliefTruncatedFrom:STATE.reliefTruncatedFrom,reliefCrestClipStatus:STATE.reliefCrestClipStatus};
  Object.assign(STATE,{resolution:32,reliefCellSize:0});
  assert.throws(()=>generateNoiseMesh(),RangeError);
  assert.deepEqual({vertices:STATE.vertices,cols:STATE.cols,rows:STATE.rows,genTime:STATE.genTime,
    reliefTruncatedFrom:STATE.reliefTruncatedFrom,reliefCrestClipStatus:STATE.reliefCrestClipStatus},diagnosed);
  // The refusal belongs to noise. Valid image grids and relief masters remain independent.
  STATE.mode='depthmap'; assert.notEqual(typeof getExportSurface(),'string');
  STATE.reliefMaster=master;
  const masterSurface=getExportSurface(); assert(typeof masterSurface!=='string');
  assert.equal(masterSurface.z,master.heightsIn);
  Object.assign(STATE,{mode:'noise',noiseType:'simplex'}); generateNoiseMesh();
  assert.equal(noiseGeneration.failed,false);
  const recovered=getExportSurface(); assert(typeof recovered!=='string');
  assert.equal(recovered.cols,32); assert.equal(recovered.rows,21);

} finally {
  Object.assign(STATE,previousState);

}
