import { rankSitesExactly } from './exact-metric-rank-oracle';
/** Complete field support and bisector bounds, independently checked against all sites. */
import assert from 'node:assert/strict';
import { SiteGrid } from '../src/noise/site-grid';
import { VoronoiReliefGen, sampleReliefParamsFromState } from '../src/noise/voronoi-relief';
import { DEFAULTS } from '../src/state';
import { frozenReliefSites } from './relief-fixtures';

const params={...sampleReliefParamsFromState(41,41,4,4,5,DEFAULTS),cellSize:.8,jitter:.95,
  relaxIterations:0,densityStrength:0,densityNoise:0,radialFoci:[],depthVariation:.7,pillow:0,
  baseAmplitude:0,baseMode:'flat' as const,wallWidth:0,junctionLift:0,invertProfile:1,
  crestVariation:0,warpDistortion:0,attractorMode:'none' as const,anisotropy:0,cutDepthIn:2.4};
const sites=VoronoiReliefGen.sitesForTest(params,false);
// Complete plane oracle in explicitly transformed coordinates, independent of bucket search.
function planes(points: readonly {x:number;y:number}[],x:number,y:number,angle=0,scale=1) {
  const c=Math.cos(angle),s=Math.sin(angle);
  const transform=(x:number,y:number)=>({x:(x*c+y*s)*scale,y:-x*s+y*c});
  const radial=points.map((p,index)=>{const q=transform(p.x-x,p.y-y);return {index,distance:Math.hypot(q.x,q.y)};});
  const ranked=rankSitesExactly(points,x,y,c,s,scale).map(index=>radial[index]);
  const owner=points[ranked[0].index],q=transform(x-owner.x,y-owner.y);
  let minimum=8;
  for(const p of points) {
    const delta=transform(p.x-owner.x,p.y-owner.y),separation=Math.hypot(delta.x,delta.y);
    if(separation===0)continue;
    // Midpoint-relative projection uses no separately rounded query radii.
    const plane=(delta.x/2-q.x)*(delta.x/separation)+(delta.y/2-q.y)*(delta.y/separation);
    minimum=Math.min(minimum,Math.max(0,plane));
  }
  return {minimum,ranked};
}
const grid=SiteGrid.fromSites(sites);
let maxError=0;
for(const scale of [1,1.7,4])for(let i=1;i<=1500;i++) {
  const x=(i*.618033988749895%1)*4,y=(i*.414213562373095%1)*4,angle=scale===1?0:.73;
  const {minimum,ranked}=planes(sites,x,y,angle,scale);
  const bound=grid.boundaryDistance(x,y,ranked[0].index,ranked[0].distance,8,Math.cos(angle),Math.sin(angle),scale);
  maxError=Math.max(maxError,Math.abs(bound-minimum));
  assert(Math.abs(bound-minimum)<1e-12,'complete bisector oracle must match every potentially constraining plane');
}
const regressionSites=frozenReliefSites('rank-switch'),regressionGrid=SiteGrid.fromSites(regressionSites);
const counterexample=planes(regressionSites,2.5604007186484523,2.9606903099047486);
assert(Math.abs(counterexample.minimum-.2795740313417761)<1e-12);
assert.equal(counterexample.ranked.findIndex(p=>p.index===26),6);
assert(Math.abs(regressionGrid.boundaryDistance(2.5604007186484523,2.9606903099047486,
  counterexample.ranked[0].index,counterexample.ranked[0].distance,.45122570797791717)-counterexample.minimum)<1e-12);
// Distinct stable IDs at one position have equal field support, but no separating plane.
for(const points of [[{x:0,y:0},{x:0,y:0},{x:2,y:0}],Array.from({length:9},()=>({x:0,y:0})),
  [{x:0,y:0},{x:1e-12,y:0},{x:2,y:0}]]) {
  const coincident=SiteGrid.fromSites(points),nearest=coincident.nearestFour(0,0);
  assert.equal(nearest.idx,0);
  const expected=points[1].x===1e-12?5e-13:points.length===3?1:8;
  assert.equal(coincident.boundaryDistance(0,0,0,0,8),expected);
  assert.equal(coincident.withinRadius(0,0,1e-9).length,points.length===3?2:9);
}
// Off-axis near-coincident planes must not disappear through radial cancellation.
for(const gap of [1e-10,1e-12,1e-14,Number.EPSILON])for(const scale of [1,4])for(const angle of [0,.713]) {
  const points=[{x:1,y:0},{x:1+gap,y:0}],c=Math.cos(angle),s=Math.sin(angle);
  const dx=(points[1].x-1)*c*scale,dy=-(points[1].x-1)*s,d=Math.hypot(dx,dy);
  const tx=-.2*dx/d-10*dy/d,ty=-.2*dy/d+10*dx/d;
  const x=1+c*tx/scale-s*ty,y=s*tx/scale+c*ty;
  const close=SiteGrid.fromSites(points),n=close.nearestFour(x,y,c,s,scale);
  assert.equal(n.idx,0);
  const expected=planes(points,x,y,angle,scale).minimum;
  assert(expected>.19,'near-coincident relative-plane oracle must remain nonzero');
  const actual=close.boundaryDistance(x,y,n.idx,n.f1,20,c,s,scale);
  assert(Math.abs(actual-expected)<1e-13,`near-coincident relative-plane minimum: ${gap}, ${angle}, ${scale}, ${actual}, ${expected}`);
  assert(Math.abs(close.bisectorDistance(x,y,0,1,c,s,scale)-expected)<1e-13);
}
const representedGap=(1+1e-14)-1;
assert.equal(new SiteGrid([{x:1,y:0},{x:1+1e-14,y:0}],1).boundaryDistance(.8,10,0,Math.hypot(.2,10),20),
  representedGap/2-(.8-1));

// A full population implementation fails this site-read bound.
let reads=0;
const lattice=Array.from({length:4096},(_,i)=>({x:i%64,y:Math.floor(i/64)}));
const observed=lattice.map(p=>({get x(){reads++;return p.x;},get y(){reads++;return p.y;}}));
const sparse=new SiteGrid(observed,1);reads=0;
for(let i=0;i<100;i++) {
  const x=1+i*.371%60,y=1+i*.217%60;
  const nearest=sparse.nearestFour(x,y);
  const owner=lattice[nearest.idx],second=lattice[nearest.idx2];
  const seed=(nearest.f2-nearest.f1)*(nearest.f2+nearest.f1)/(2*Math.hypot(owner.x-second.x,owner.y-second.y));
  sparse.boundaryDistance(x,y,nearest.idx,nearest.f1,seed);
}
assert(reads<100*250,'bisector queries must retain sparse bounded work');
process.stdout.write(`all-site bisector max error ${maxError}; sparse site reads ${reads}\n`);

assert.throws(()=>VoronoiReliefGen.queryForTest(params,0,0,[]),RangeError);
assert.throws(()=>VoronoiReliefGen.sampleSitesForTest(params,[{x:NaN,y:0}]),RangeError);
// Assert the frozen point still denotes the reported rank transition, not a smooth substitute.
const thirdIds=[-1,1].map(sign=>{
  const n=regressionGrid.nearestFour(.33961171357127573+sign*.8633458216323898*1e-9,
    3.8847483055010583+sign*.504612715129032*1e-9);
  assert.equal(n.idx,22);assert.equal(n.idx2,23);return n.idx3;
});
assert.deepEqual(thirdIds.sort((a,b)=>a-b),[17,26]);
// Actual third/fourth rank switch with unchanged owner and runner-up.
for(const change of [{},{seamDepth:2},{wallWidth:.3},{profile:'hemisphere' as const},{seamSharpness:1}]) {
  let previous=Infinity;
  for(const epsilon of [1e-3,1e-5,1e-7,1e-9]) {
    const values=[-1,1].map(sign=>VoronoiReliefGen.queryForTest({...params,...change},
      .33961171357127573+sign*.8633458216323898*epsilon,
      3.8847483055010583+sign*.504612715129032*epsilon,regressionSites));
    const jump=Math.abs(values[0]-values[1]);
    assert(jump<previous*.1+1e-14,`rank-switch junction support must converge: ${epsilon}, ${jump}`);
    previous=jump;
  }
  assert(previous<1e-8);
  process.stdout.write(`rank-switch final jump ${previous}\n`);
}
// Ordinary owner edges retain the same limit with asymmetric wall character active.
let checked=0;
for(let i=0;i<sites.length&&checked<2;i++)for(let j=i+1;j<sites.length&&checked<2;j++) {
  const a=sites[i],b=sites[j],x=(a.x+b.x)/2,y=(a.y+b.y)/2,r=Math.hypot(a.x-b.x,a.y-b.y)/2;
  if(r===0||sites.some((s,k)=>k!==i&&k!==j&&Math.hypot(x-s.x,y-s.y)<r+1e-8))continue;
  for(const invertProfile of [0,1]) {
    let previous=Infinity;
    for(const epsilon of [1e-5,1e-7,1e-9]) {
      const p={...params,wallWidth:.3,junctionLift:1,crestVariation:.5,invertProfile};
      const values=[-1,1].map(sign=>VoronoiReliefGen.queryForTest(p,x+sign*(b.x-a.x)/2/r*epsilon,y+sign*(b.y-a.y)/2/r*epsilon));
      const jump=Math.abs(values[0]-values[1]);
      assert(jump<previous*.1+1e-14,`ordinary owner-edge junction support must converge: ${epsilon}, ${jump}`);
      previous=jump;
    }
    assert(previous<1e-8);
  }
  checked++;
}
assert.equal(checked,2);
