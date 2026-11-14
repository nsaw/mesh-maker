import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { SimplexNoiseGen } from '../src/noise/generators';
import {
  certifyWarp,
  simplexBounds,
  simplexEvaluationResidue,
} from '../src/cell-graph/warp-bounds';
import { invertWarp } from '../src/cell-graph/warp-inverse';
import { add, compare, exact } from '../src/cell-graph/rational';
import { nextUp, nextDown, sqrtI } from '../src/cell-graph/interval';

let work = 0;
const unlimited = {
  step(): void {
    if (++work > 10_000_000) throw new Error('Fixture work budget exceeded');
  },
};
const kernel = new SimplexNoiseGen(37).describeKernel();
assert.ok(
  Object.isFrozen(kernel) &&
    Object.isFrozen(kernel.perm) &&
    Object.isFrozen(kernel.grad2) &&
    kernel.grad2.every(Object.isFrozen),
);
assert.throws(() => {
  (kernel.perm as number[])[0] = 999;
});
// Independent integer Fisher-Yates construction binds the reviewed algorithm, not only its tag.
const fisher=spawnSync('python3',['-c',String.raw`
import json,sys,math
M=0xffffffff
out=[]
for seed in json.load(sys.stdin):
 t=seed&M;p=list(range(256))
 for i in range(255,0,-1):
  t=(t+0x6D2B79F5)&M;r=((t^(t>>15))*(t|1))&M
  r=(r^((r+(((r^(r>>7))*(r|61))&M))&M))&M
  j=math.floor(((r^(r>>14))&M)/4294967296.0*(i+1))
  p[i],p[j]=p[j],p[i]
 out.append(p+p)
print(json.dumps(out))
`],{input:JSON.stringify([0,7,37,0xffffffff,4294967325]),encoding:'utf8'});
assert.equal(fisher.status,0,fisher.stderr);
const independentPerms=JSON.parse(fisher.stdout) as number[][];
[0,7,37,0xffffffff,4294967325].forEach((seed,i)=>{
  const actual=new SimplexNoiseGen(seed).describeKernel();
  assert.equal(actual.implementation,'meshcraft-simplex2-fisher-yates-mulberry32-v1');
  assert.deepEqual(actual.perm,independentPerms[i]);
});

const samples: [number, number][] = [];
const G = (3 - Math.sqrt(3)) / 6;
for (let i = 0; i < 90; i++)
  samples.push([((i * 0.618033988749895) % 1) * 12 - 3, ((i * 0.414213562373095) % 1) * 12 - 3]);
for (let i = -3; i <= 3; i++)
  for (const epsilon of [-(2 ** -40), 0, 2 ** -40]) {
    samples.push([i - 2 * i * G + epsilon, i - 2 * i * G - epsilon]);
    samples.push([i - (2 * i + 1) * G + epsilon, i + 1 - (2 * i + 1) * G - epsilon]);
  }
const gen = new SimplexNoiseGen(37);
// Independent high-precision model, gradient and Hessian. This does not call production interval code.
const decimal = String.raw`
import json,sys,decimal,math
D=decimal.Decimal;decimal.getcontext().prec=85
v=json.load(sys.stdin);P=v['perm'];V=v['grad'];G=(D(3)-D(3).sqrt())/D(6);F=(D(3).sqrt()-1)/2
out=[]
for xx,yy in v['points']:
 x=D(xx);y=D(yy);u=x+(x+y)*F;w=y+(x+y)*F
 total=D(0);dx=D(0);dy=D(0);hxx=D(0);hxy=D(0);hyy=D(0)
 for i in range(math.floor(u)-2,math.ceil(u)+3):
  for j in range(math.floor(w)-2,math.ceil(w)+3):
   rx=x-i+(i+j)*G;ry=y-j+(i+j)*G;t=D('.5')-rx*rx-ry*ry
   if t<=0:continue
   gx,gy=map(D,V[P[(i&255)+P[j&255]]%12]);dot=gx*rx+gy*ry
   total+=70*t**4*dot
   dx+=70*(gx*t**4-8*rx*t**3*dot);dy+=70*(gy*t**4-8*ry*t**3*dot)
   hxx+=70*(48*rx*rx*t*t*dot-8*t**3*dot-16*gx*rx*t**3)
   hyy+=70*(48*ry*ry*t*t*dot-8*t**3*dot-16*gy*ry*t**3)
   hxy+=70*(48*rx*ry*t*t*dot-8*t**3*(gx*ry+gy*rx))
 out.append(list(map(str,[total,dx,dy,hxx,hxy,hyy])))
print(json.dumps(out))
`;
const highPrecision = spawnSync('python3', ['-c', decimal], {
  input: JSON.stringify({
    perm: kernel.perm,
    grad: kernel.grad2,
    points: samples,
  }),
  encoding: 'utf8',
});
assert.equal(highPrecision.status, 0, highPrecision.stderr);
const rows = JSON.parse(highPrecision.stdout) as string[][];
let zeroResidueFails = 0,
  shrunkenDerivativeFails = 0;
rows.forEach((row, i) => {
  const [x, y] = samples[i],
    bounds = simplexBounds(gen, [x - 1e-5, x + 1e-5], [y - 1e-5, y + 1e-5], unlimited);
  const values = [bounds.value, bounds.dx, bounds.dy, bounds.dxx, bounds.dxy, bounds.dyy];
  row.forEach((value, k) => {
    const n = Number(value);
    assert.ok(
      n >= values[k][0] && n <= values[k][1],
      `Decimal enclosure point ${i} derivative ${k}`,
    );
  });
  const source = gen.noise(x, y),
    model = Number(row[0]);
  assert.ok(Math.abs(source - model) <= simplexEvaluationResidue(32));
  if (source !== model) zeroResidueFails++;
  if (Number(row[1]) < bounds.dx[0] * 0.5 || Number(row[1]) > bounds.dx[1] * 0.5)
    shrunkenDerivativeFails++;
});
assert.ok(zeroResidueFails > 0, 'zero arithmetic residue negative control must fail');
assert.ok(shrunkenDerivativeFails > 0, 'halved derivative enclosure negative control must fail');

assert.equal(nextUp(0), Number.MIN_VALUE);
assert.equal(nextDown(0), -Number.MIN_VALUE);
assert.deepEqual(sqrtI([0, 0]), [0, 0]);
const producerQuery = {
    implementation: 'meshcraft-relief-query/2' as const,
    ownerPolicy: 'exact-represented-metric-stable-id-v1' as const,
    meshX: 4,
    meshY: 4,
    seed: 7,
    metric: { cosA: 1, sinA: 0, scale: 1 },
    warp: { amplitude: 0.4, frequency: 0.1, seed: 37, kernel: new SimplexNoiseGen(37).describeKernel() },
  };
const certificate = certifyWarp(producerQuery, unlimited);

for(const mutation of ['query1','old-tag','permutation','gradient'] as const){
  const altered=structuredClone(producerQuery);
  if(mutation==='query1')Reflect.set(altered,'implementation','meshcraft-relief-query/1');
  else if(mutation==='old-tag')Reflect.set(altered.warp.kernel,'implementation','meshcraft-simplex2-sine-table-v1');
  else if(mutation==='permutation')Reflect.set(altered.warp.kernel.perm,0,altered.warp.kernel.perm[0]^1);
  else Reflect.set(altered.warp.kernel.grad2[0],0,-altered.warp.kernel.grad2[0][0]);
  assert.throws(()=>certifyWarp(altered,unlimited),/implementation|policy|kernel/);
}
assert.ok(certificate.lipschitz < 1);
assert.throws(() => invertWarp(certificate, 100, 100, unlimited), /contraction proof rectangle/);
for (const [qx, qy] of [
  [nextDown(certificate.domain.xmin), 0],
  [nextUp(certificate.domain.xmax), 0],
  [0, nextDown(certificate.domain.ymin)],
  [0, nextUp(certificate.domain.ymax)],
]) {
  assert.throws(() => invertWarp(certificate, qx, qy, unlimited), /contraction proof rectangle/);
}
// Q is rounded outward first. R must then contain its exact real expansion by D,
// even when a tiny displacement is close to the board coordinate's rounding scale.
for (const amplitude of [1e-10, 1.0000000000000002e-10, 2 ** -30]) {
  const tiny = certifyWarp(
    {
      implementation: 'meshcraft-relief-query/2',
    ownerPolicy: 'exact-represented-metric-stable-id-v1',
      meshX: nextUp(4),
      meshY: nextDown(4),
      seed: 7,
      metric: { cosA: 1, sinA: 0, scale: 1 },
      warp: { amplitude, frequency: 0.1, seed: 37, kernel: new SimplexNoiseGen(37).describeKernel() },
    },
    unlimited,
  );
  for (const [board, maximum] of [
    [nextUp(4), tiny.domain.xmax],
    [nextDown(4), tiny.domain.ymax],
  ]) {
    const qmax = nextUp(board + tiny.displacement);
    assert.ok(compare(exact(qmax), add(exact(board), exact(tiny.displacement))) >= 0);
    assert.ok(
      compare(exact(maximum), add(exact(qmax), exact(tiny.displacement))) >= 0,
      'R includes the exact expansion of outward Q rather than a rounded board+2D shortcut',
    );
  }
  const inverted = invertWarp(
    tiny,
    nextUp(4 + tiny.displacement),
    nextUp(nextDown(4) + tiny.displacement),
    unlimited,
  );
  assert.ok(inverted.x >= tiny.domain.xmin && inverted.x <= tiny.domain.xmax);
  assert.ok(inverted.y >= tiny.domain.ymin && inverted.y <= tiny.domain.ymax);
  assert.ok(inverted.error < 1e-7);
}
for (let i = 0; i < 25; i++) {
  const qx = ((i * 0.618033988749895) % 1) * 6 - 1,
    qy = ((i * 0.414213562373095) % 1) * 6 - 1;
  const inverse = invertWarp(certificate, qx, qy, unlimited);
  const value = certificate.evaluate(inverse.x, inverse.y);
  assert.ok(Math.hypot(value[0] - qx, value[1] - qy) < 1e-7);
  assert.ok(inverse.error < 1e-7);
}
assert.throws(
  () =>
    certifyWarp(
      {
        implementation: 'meshcraft-relief-query/2',
    ownerPolicy: 'exact-represented-metric-stable-id-v1',
        meshX: 4,
        meshY: 4,
        seed: 7,
        metric: { cosA: 1, sinA: 0, scale: 1 },
        warp: { amplitude: 50, frequency: 2, seed: 37, kernel: new SimplexNoiseGen(37).describeKernel() },
      },
      unlimited,
    ),
  /coordinate|derivative|budget/,
);
process.stdout.write(
  'Simplex Decimal bounds, branch arithmetic negative controls, kernel identity and inverse checks passed\n',
);
