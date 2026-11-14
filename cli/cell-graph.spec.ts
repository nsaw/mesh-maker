import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/state';
import { buildNoiseSurface, noiseSurfaceParams } from '../src/noise/surface';
import { SimplexNoiseGen } from '../src/noise/generators';
import { reliefOwnerOracle } from '../src/noise/voronoi-relief';
import { validateCellGraphQuery } from '../src/cell-graph/query';
import { rankSitesExactly } from './exact-metric-rank-oracle';
import { spawnSync } from 'node:child_process';
import { buildCellGraph } from '../src/cell-graph/graph';
import type { CellGraph } from '../src/cell-graph/graph';
import { cellGraphDxf } from '../src/cell-graph/dxf';
import { exact, key } from '../src/cell-graph/rational';
import type { ReliefSourceSnapshot } from '../src/types';

function source(xy: number[], width = 4, height = 4): ReliefSourceSnapshot {
  return {sites: {xy: Float64Array.from(xy),ids: Uint32Array.from({length:xy.length/2},(_,i)=>i*3+1),
    pinned:new Uint8Array(xy.length/2),truncatedFrom:0}, query:{implementation:'meshcraft-relief-query/2',ownerPolicy:'exact-represented-metric-stable-id-v1',meshX:width,meshY:height,
    seed:7,metric:{cosA:1,sinA:0,scale:1},warp:{amplitude:0,frequency:0.1,seed:37,kernel:null}}};
}
function graph(input: ReliefSourceSnapshot): CellGraph {
  const result = buildCellGraph({source:input,revision:5});
  assert.ok(result.ok, result.ok ? undefined : result.reason);
  return result.graph;
}
assert.equal(key(exact(0.1)), '3602879701896397/36028797018963968');
assert.equal(key(exact(Number.MIN_VALUE)), `1/${1n<<1074n}`);
assert.equal(key(exact(-0)), '0/1');
const fixtures: Record<string,number[]> = {empty:[],one:[2,2],two:[1,2,3,2],three:[1,1,3,1,2,3],
  cocircular:[1,1,3,1,3,3,1,3],collinear:[0.5,2,1.5,2,2.5,2,3.5,2],coincident:[1,2,1,2,3,2]};
const expected: Record<string,number> = {empty:0,one:0,two:1,three:3,cocircular:4,collinear:3,coincident:1};
for (const [name,xy] of Object.entries(fixtures)) {
  const input = source(xy), before = new Uint8Array(input.sites.xy.buffer).slice();
  const output = graph(input);
  assert.equal(output.inner.length,expected[name],name);
  assert.deepEqual(new Uint8Array(input.sites.xy.buffer),before,`${name} producer ownership`);
  assert.ok(output.outer.closed);
  if (name==='cocircular') {
    const centre=output.nodes.find(node=>node.x===2&&node.y===2);
    assert.equal(centre?.incident.length,4);
    assert.equal(output.inner.filter(edge=>edge.nodes.includes(centre!.id)).length,4);
  }
  if (name==='two') {
    const edge=output.inner[0], points=edge.nodes.map(id=>output.nodes.find(node=>node.id===id));
    assert.deepEqual(points.map(node=>[node!.x,node!.y]).sort((a,b)=>a[1]-b[1]),[[2,0],[2,4]]);
  }
  if (name==='coincident') assert.deepEqual(output.inner[0].owners,[1,7]);
}
// Python Fraction implements a separate clipper and compares all rational vertices and owner pairs.
const python = String.raw`
import json,sys
from fractions import Fraction as F
v=json.load(sys.stdin);P=[(F(x),F(y)) for x,y in zip(v['xy'][::2],v['xy'][1::2])]
c,s,k=map(F,v['metric']);T=lambda p:((p[0]*c+p[1]*s)*k,p[1]*c-p[0]*s)
V=list(map(T,P));D=[(F(0),F(0)),(F(4),F(0)),(F(4),F(4)),(F(0),F(4))];E={}
for i,p in enumerate(P):
 poly=D[:]
 for j,q in enumerate(P):
  if i==j:continue
  if p==q:
   if j<i:poly=[];break
   continue
  a,b=V[j][0]-V[i][0],V[j][1]-V[i][1]
  line=(2*(a*c*k-b*s),2*(a*s*k+b*c),sum(z*z for z in V[j])-sum(z*z for z in V[i]))
  val=lambda x:line[0]*x[0]+line[1]*x[1]-line[2]
  out=[]
  if not poly:break
  prev=poly[-1];vp=val(prev)
  for curr in poly:
   vc=val(curr)
   if (vp<=0)!=(vc<=0):
    t=vp/(vp-vc);out.append(tuple(prev[m]+t*(curr[m]-prev[m]) for m in (0,1)))
   if vc<=0:out.append(curr)
   prev,vp=curr,vc
  poly=[x for m,x in enumerate(out) if x!=out[m-1]]
 for m,a in enumerate(poly):
  b=poly[(m+1)%len(poly)]
  if a==b:continue
  E.setdefault(tuple(sorted((a,b))),[]).append(i*3+1)
def key(p):return ','.join(str(z.numerator)+'/'+str(z.denominator) for z in p)
print(json.dumps(sorted([{'ends':sorted([key(a),key(b)]),'owners':ids} for (a,b),ids in E.items() if len(ids)==2],key=lambda e:str(e))))
`;
for (const [metric, xy] of [
  [{cosA:1,sinA:0,scale:2},[0.25,0.5,3.5,0.75,3,3.2,0.5,3.5,2,2]],
  [{cosA:Math.cos(0.7),sinA:Math.sin(0.7),scale:2.3},[0.25,0.5,3.5,0.75,3,3.2,0.5,3.5,2,2]],
  [{cosA:Math.cos(0.713),sinA:Math.sin(0.713),scale:1.7},[1,2,1+1e-14,2]],
] as const) {
  const input = source([...xy]); input.query.metric=metric;
  const result=graph(input);
  const independent=spawnSync('python3',['-c',python],{input:JSON.stringify({xy:Array.from(input.sites.xy),metric:[metric.cosA,metric.sinA,metric.scale]}),encoding:'utf8'});
  assert.equal(independent.status,0,independent.stderr);
  const expectedEdges=JSON.parse(independent.stdout) as {ends:string[];owners:number[]}[];
  const actual=result.inner.map(edge=>({ends:[...edge.nodes].sort(),owners:edge.owners}));
  assert.deepEqual(actual.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),expectedEdges.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
// Query identity and actual kernel metadata must bind even when geometry needs no nonlinear proof.
for (const mutate of [
  (input: ReliefSourceSnapshot) => { Reflect.set(input.query,'implementation','meshcraft-relief-query/1'); },
  (input: ReliefSourceSnapshot) => { Reflect.set(input.query,'ownerPolicy','rounded-radial-lower-index'); },
  (input: ReliefSourceSnapshot) => { input.query.warp={...input.query.warp,kernel:new SimplexNoiseGen(37).describeKernel()}; },
]) {
  const input=source(fixtures.two);mutate(input);
  const refused=buildCellGraph({source:input,revision:1});
  assert(!refused.ok && /implementation|policy|kernel/.test(refused.reason));
}
const live=buildNoiseSurface(noiseSurfaceParams({...DEFAULTS,noiseType:'voronoi-relief',meshX:4,meshY:4,resolution:16,
  reliefCellSize:1,reliefAnisotropy:0.7,reliefAnisotropyAngle:37,distortion:0})).reliefSource!;
assert.equal(graph(live).implementation,'meshcraft-relief-query/2');
const nearest=reliefOwnerOracle(live),sites=live.sites;
const positions=Array.from(sites.ids,(_,i)=>({x:sites.xy[i*2],y:sites.xy[i*2+1]}));
for(const [x,y] of [[0,0],[2,2],[4,4],[1.13,2.71]]){
  const m=live.query.metric;
  assert.equal(nearest(x,y),sites.ids[rankSitesExactly(positions,x,y,m.cosA,m.sinA,m.scale)[0]]);
}
const active=buildNoiseSurface(noiseSurfaceParams({...DEFAULTS,noiseType:'voronoi-relief',meshX:4,meshY:4,resolution:8,
  reliefCellSize:1,distortion:0.3})).reliefSource!;
validateCellGraphQuery(active.query);
const staleKernel=structuredClone(active.query);
Reflect.set(staleKernel.warp.kernel!.perm,0,staleKernel.warp.kernel!.perm[0]^1);
assert.throws(()=>validateCellGraphQuery(staleKernel),/actual Simplex kernel/);

const two=graph(source(fixtures.two)),dxf=cellGraphDxf(two);
const codes=dxf.trimEnd().split('\n');
assert.equal(codes.length%2,0);
const pairs=Array.from({length:codes.length/2},(_,i)=>[Number(codes[2*i]),codes[2*i+1]] as const);
assert.ok(pairs.some(([code,value],i)=>code===9&&value==='$INSUNITS'&&pairs[i+1][0]===70&&pairs[i+1][1]==='1'));
const entities: {type:string;values:Map<number,string>}[]=[];
for (const [code,value] of pairs) {
  if (code===0) entities.push({type:value,values:new Map()});
  else entities.at(-1)?.values.set(code,value);
}
const paths=entities.filter(entity=>entity.type==='POLYLINE');
assert.deepEqual(paths.map(path=>[path.values.get(8),path.values.get(70)]),[['CUT_INNER','0'],['CUT_OUTER','1']]);
const vertices=entities.filter(entity=>entity.type==='VERTEX');
assert.equal(vertices.length,two.inner[0].nodes.length+two.outer.nodes.length);
assert.throws(()=>cellGraphDxf(two,6),/stale/);
for (const request of [{source:source(fixtures.two),revision:5,maxSteps:1},
  {source:source(fixtures.two),revision:5,isCurrent:()=>false},
  {source:source(fixtures.two),revision:5,signal:AbortSignal.abort()}]) {
  const result=buildCellGraph(request);assert.equal(result.ok,false);assert.ok(!('graph' in result));
}
const near=buildCellGraph({source:source([1,2,1+1e-12,2,1+2e-12,2,3,2]),revision:1});
assert.equal(near.ok,false);
process.stdout.write('Cell graph exact, Fraction oracle, topology, ownership, DXF and refusal checks passed\n');
