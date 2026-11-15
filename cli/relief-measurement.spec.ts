/** Independent complete-population quadrature, missed-cell disk and resolution controls. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {DEFAULTS} from '../src/state';
import {presetState} from '../src/noise/presets';
import {VoronoiReliefGen, sampleReliefParamsFromState} from '../src/noise/voronoi-relief';
import {buildNoiseSurface, noiseSurfaceParams} from '../src/noise/surface';
import type {ReliefSampleParams} from '../src/types';

type Point={x:number;y:number};
function independent(p:ReliefSampleParams,sites:Point[]) {
  let cols=Math.max(2,Math.ceil(p.meshX/.075)+1),rows=Math.max(4,Math.ceil(p.meshY/.075)+1);
  if(cols*rows>320000){const s=Math.sqrt(320000/(cols*rows));cols=Math.min(80000,Math.max(2,Math.floor(cols*s)));rows=Math.min(Math.floor(320000/cols),Math.max(4,Math.floor(rows*s)));}
  const angle=p.anisotropyAngle*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),scale=1+p.anisotropy*1.5;
  const metric=(x:number,y:number):Point=>scale>1.0001?{x:(x*c+y*s)*scale,y:-x*s+y*c}:{x,y};
  const owner=(x:number,y:number):number=>{
    let best=Infinity,result=-1;
    for(const [i,site]of sites.entries()){const d=metric(x-site.x,y-site.y),v=Math.hypot(d.x,d.y);if(v<best){best=v;result=i;}}
    return result;
  };
  const boundary=(x:number,y:number,k:number):number=>{
    let result=p.meshX+p.meshY;
    const q=metric(x-sites[k].x,y-sites[k].y);
    for(const site of sites){const d=metric(site.x-sites[k].x,site.y-sites[k].y),length=Math.hypot(d.x,d.y);if(length>0)result=Math.min(result,Math.max(0,length/2-q.x*(d.x/length)-q.y*(d.y/length)));}
    return result;
  };
  const sums=sites.map(()=>0),counts=sites.map(()=>0),inradii=sites.map(()=>0);
  for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
    const x=i/(cols-1)*p.meshX,y=j/(rows-1)*p.meshY,k=owner(x,y),d=metric(x-sites[k].x,y-sites[k].y);
    counts[k]++;sums[k]+=Math.hypot(d.x,d.y);inradii[k]=Math.max(inradii[k],boundary(x,y,k));
  }
  const radii=sites.map((site,k)=>{const r=boundary(site.x,site.y,owner(site.x,site.y));inradii[k]=Math.max(inradii[k],r);return counts[k]>0?2*sums[k]/counts[k]:4*r/3;});
  for(const [k,site]of sites.entries()){const o=owner(site.x,site.y);if(o!==k){radii[k]=radii[o];inradii[k]=inradii[o];}}
  return {cols,rows,counts,inradii,radii};
}
function close(actual:number[],expected:number[],label:string):void {
  for(let k=0;k<actual.length;k++)assert(Math.abs(actual[k]-expected[k])<=1e-10*Math.max(1,Math.abs(expected[k])),label+' '+k);
}
const pythonCases:Array<{params:ReliefSampleParams;sites:Point[];expected:ReturnType<typeof independent>}>=[];
for(const [width,height,anisotropy,angle]of [[4,4,0,0],[12,6,1.2,37],[6,12,1.2,127],[.03,20,0,0],[72,72,0,0]]) {
  const p=sampleReliefParamsFromState(9,13,width,height,5,{...DEFAULTS,reliefRelaxIterations:0,reliefCellSize:Math.max(.2,width/3),reliefDensityNoise:0,reliefDepthVariation:0});
  Object.assign(p,{anisotropy,anisotropyAngle:angle});
  const sites=[{x:width*.25,y:height*.25},{x:width*.75,y:height*.25},{x:width*.25,y:height*.75},{x:width*.75,y:height*.75}];
  const expected=independent(p,sites),actual=VoronoiReliefGen.measurementsForTest(p,sites);
  if(width<20)pythonCases.push({params:p,sites,expected});
  assert.deepEqual([actual.cols,actual.rows,actual.counts],[expected.cols,expected.rows,expected.counts]);
  assert(actual.cols*actual.rows<=320000);close(actual.inradii,expected.inradii,'all-site plane minimum');close(actual.sites.map(s=>s.radius),expected.radii,'independent mean radius');
  assert.deepEqual(VoronoiReliefGen.measurementsForTest({...p,cols:19,rows:27},sites),actual,'output resolution cannot change cell geometry');
}
// Sub-pitch retained cells and coincident stable IDs must keep finite geometric support.
{
  const p=sampleReliefParamsFromState(2,4,1,1,5,{...DEFAULTS,reliefRelaxIterations:0,reliefCellSize:.5,reliefDepthVariation:0});
  const sites=[{x:.501,y:.501},{x:.501,y:.501},{x:.50100001,y:.501},{x:.501,y:.50100001},{x:.50100001,y:.50100001}];
  const expected=independent(p,sites),actual=VoronoiReliefGen.measurementsForTest(p,sites);
  assert.equal(actual.sites.length,sites.length);assert(actual.counts.some(n=>n===0));
  close(actual.inradii,expected.inradii,'sub-pitch anchors');close(actual.sites.map(s=>s.radius),expected.radii,'contained disk mean');
  assert.deepEqual(actual.sites[0],actual.sites[1]);assert.equal(actual.inradii[0],actual.inradii[1]);
  assert(actual.sites.every(s=>Number.isFinite(s.radius)&&s.radius>0));
}
const grids=[201,401].map(resolution=>buildNoiseSurface(noiseSurfaceParams({...DEFAULTS,...presetState('relief-pockets'),meshX:24,meshY:24,resolution,seed:5})).vertices);
let sum=0,max=0;
for(let j=0;j<201;j++)for(let i=0;i<201;i++){const e=Math.abs(grids[0][j][i]-grids[1][2*j][2*i]);sum+=e;max=Math.max(max,e);}
assert(sum/40401<=1.2*.005&&max<=1.2*.03,'production Pockets retained coincidence bounds');
process.stdout.write(JSON.stringify({mean:sum/40401,max})+'\n');

const python=String.raw`import ast,json,math,sys
payload=json.loads(sys.stdin.read());source=payload['source']
source=source.replace('        # NaN guards on the constant metric frame', '        sites = [[s["x"],s["y"],0.0] for s in FROZEN_SITES]\n        # NaN guards on the constant metric frame')
source=source.replace('        # v17 size-depth coupling normalizes against the MEDIAN', '        return {"cols":measure_cols,"rows":measure_rows,"counts":radius_n,"inradii":inradius,"radii":[s[2] for s in sites]}\n        # v17 size-depth coupling normalizes against the MEDIAN')
m=ast.parse(source);m.body=[n for n in m.body if isinstance(n,ast.ClassDef)]
scope={'math':math};exec(compile(m,'noise_gen.py','exec'),scope)
result=[]
for case in payload['cases']:
    scope['FROZEN_SITES']=case['sites'];result.append(scope['VoronoiReliefNoise'](5).sample_grid(case['params']))
print(json.dumps(result))`;
const aliases:Record<string,string>={relaxIterations:'relax_iter',baseAmplitude:'base_amp',baseFrequency:'base_freq'};
const py=JSON.parse(execFileSync('python3',['-I','-c',python],{encoding:'utf8',input:JSON.stringify({source:readFileSync(new URL('../grasshopper/components/noise_gen.py',import.meta.url),'utf8'),cases:pythonCases.map(item=>({sites:item.sites,params:Object.fromEntries(Object.entries(item.params).map(([key,value])=>[aliases[key]??key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),key==='radialFoci'?item.params.radialFoci.map(f=>[f.x,f.y]):value]))}))})})) as Array<ReturnType<typeof independent>>;
for(const [k,item]of pythonCases.entries()){assert.deepEqual([py[k].cols,py[k].rows,py[k].counts],[item.expected.cols,item.expected.rows,item.expected.counts]);close(py[k].inradii,item.expected.inradii,'Python all-site plane minimum');close(py[k].radii,item.expected.radii,'Python independent mean radius');}
process.stdout.write('Independent measurement and canonical Python geometry oracles passed.\n');
