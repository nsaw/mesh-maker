/** Independent integer arithmetic and signed-window diversity for plain cellular jitter. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import { cellularDistances, cellularSite } from '../src/noise/generators';
import { cellHash01 } from '../src/noise/prng';

const u32=(x:bigint):bigint=>BigInt.asUintN(32,x);
function avalanche(x:bigint):bigint {
  x=u32(x);x=u32((x^(x>>16n))*0x7feb352dn);
  x=u32((x^(x>>15n))*0x846ca68bn);return u32(x^(x>>16n));
}
function referenceSite(x:number,y:number,seed:number,jitter:number):[number,number] {
  const coordinateHash=(channel:bigint):number=>{
    let h=avalanche(u32(BigInt(seed))+channel^0x9e3779b9n);
    for(const [word,multiplier] of [[BigInt(x),0x85ebca6bn],[BigInt(x)>>32n,0x9e3779b1n],
      [BigInt(y),0xc2b2ae35n],[BigInt(y)>>32n,0x27d4eb2dn]])h=avalanche(h+u32(word*multiplier));
    return Number(h)/4294967296;
  };
  return [x+.5+(coordinateHash(0n)-.5)*jitter,y+.5+(coordinateHash(1013n)-.5)*jitter];
}
// The unchanged legacy relief hash has an independent integer expectation too.
for(const seed of [0,17,-85,4294967295])for(const index of [0,1,4095]) {
  let h=u32(BigInt(index+1)*374761393n+u32(BigInt(seed))*668265263n);
  h=u32((h^(h>>13n))*1274126177n);
  assert.equal(cellHash01(index,seed),Number(u32(h^(h>>16n)))/4294967296);
}
let minimum=10000;
for(const seed of [0,17,-85,1001,2147483647,4294967295]) {
  for(const [ox,oy] of [[0,0],[-100,-100],[-100,0],[0,-100],[-50,-50],[123,-147]]) {
    const offsets=new Set<string>();
    for(let j=0;j<100;j++)for(let i=0;i<100;i++) {
      const x=ox+i,y=oy+j,[px,py]=cellularSite(x,y,seed);
      offsets.add(`${px-x},${py-y}`);
    }
    minimum=Math.min(minimum,offsets.size);
    assert(offsets.size>=9990,`signed cellular diversity ${seed} at ${ox},${oy}: ${offsets.size}`);
  }
}
assert.notDeepEqual(cellularSite(1,1,0).map(v=>v-1),cellularSite(-1,-1,0).map(v=>v+1));
for(const seed of [0,17,-85,4294967295])for(const jitter of [0,.3,1]) {
  for(const [x,y] of [[1,1],[-1,-1],[-50,49],[2**40+3,-(2**39)+7],[-2147483649,4294967297]]) {
    assert.deepEqual(cellularSite(x,y,seed,jitter),referenceSite(x,y,seed,jitter));
  }
  for(const metric of ['euclidean','manhattan','chebyshev'] as const)for(let i=0;i<80;i++) {
    const x=i*.371-17,y=i*-.217+9,distances:number[]=[];
    for(let j=Math.floor(y)-5;j<=Math.floor(y)+5;j++)for(let k=Math.floor(x)-5;k<=Math.floor(x)+5;k++) {
      const [px,py]=referenceSite(k,j,seed,jitter),dx=Math.abs(x-px),dy=Math.abs(y-py);
      distances.push(metric==='euclidean'?Math.hypot(dx,dy):metric==='manhattan'?dx+dy:Math.max(dx,dy));
    }
    distances.sort((a,b)=>a-b);
    assert.deepEqual(cellularDistances(x,y,seed,jitter,metric),distances.slice(0,2));
  }
}
process.stdout.write(`Signed cellular windows minimum distinct offsets ${minimum}; independent BigInt sites and F1/F2 passed.\n`);

const cases=[0,17,-85,4294967295].flatMap(seed=>[0,.3,1].flatMap(jitter=>
  [[1,1],[-1,-1],[-50,49],[2**40+3,-(2**39)+7],[-2147483649,4294967297]].map(([x,y])=>({x,y,seed,jitter}))));
const python=`import ast,json,math,sys
p=json.loads(sys.stdin.read());m=ast.parse(p['source']);m.body=[n for n in m.body if isinstance(n,ast.ClassDef)]
scope={'math':math};exec(compile(m,'noise_gen.py','exec'),scope)
print(json.dumps([scope['_Cellular'].site(q['x'],q['y'],q['seed'],q['jitter']) for q in p['cases']]))`;
const native:number[][]=JSON.parse(execFileSync('python3',['-I','-c',python],{
  input:JSON.stringify({source:readFileSync(new URL('../grasshopper/components/noise_gen.py',import.meta.url),'utf8'),cases}),encoding:'utf8'}));
for(const [i,q]of cases.entries())assert.deepEqual(native[i],referenceSite(q.x,q.y,q.seed,q.jitter));
process.stdout.write('Canonical Python ordered-coordinate sites match the independent BigInt oracle.\n');
