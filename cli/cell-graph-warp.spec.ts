import assert from 'node:assert/strict';
import { rankSitesExactly } from './exact-metric-rank-oracle';
import { buildCellGraph } from '../src/cell-graph/graph';
import { cellGraphDxf } from '../src/cell-graph/dxf';
import { SimplexNoiseGen } from '../src/noise/generators';
import type { WarpCertificate } from '../src/cell-graph/warp-bounds';
import { clipWarpEdge, boardRoots } from '../src/cell-graph/warp-clipping';
import { point } from '../src/cell-graph/rational';
import { addI, inflateI, interval, nextDown, nextUp, scaleI } from '../src/cell-graph/interval';
import type { Interval } from '../src/cell-graph/interval';
import { buildNoiseSurface, noiseSurfaceParams } from '../src/noise/surface';
import { DEFAULTS } from '../src/state';
import { presetState } from '../src/noise/presets';
import { reliefOwnerOracle } from '../src/noise/voronoi-relief';

const unlimited = { step(): void {} };
const trig = (bounds: Interval, kind: 'sin' | 'cos'): Interval => {
  const evaluate = kind === 'sin' ? Math.sin : Math.cos,
    values = [evaluate(bounds[0]), evaluate(bounds[1])],
    offset = kind === 'sin' ? Math.PI / 2 : 0;
  for (
    let i = Math.ceil((bounds[0] - offset) / Math.PI);
    i <= Math.floor((bounds[1] - offset) / Math.PI);
    i++
  )
    values.push(i % 2 === 0 ? 1 : -1);
  return [nextDown(Math.min(...values) - 1e-14), nextUp(Math.max(...values) + 1e-14)];
};
// Analytical shear has four disconnected fragments despite both query endpoints lying outside.
const shear: WarpCertificate = {
  domain: { xmin: -1e6, xmax: 1e6, ymin: -1e6, ymax: 1e6 },
  kernel: 'analytic-shear-fixture',
  displacement: 0.6,
  lipschitz: 0.6,
  inverseLipschitz: 2.5,
  hessian: 0.6,
  evaluationResidue: 1e-14,
  evaluate: (x, y) => [x + 0.6 * Math.sin(y), y],
  jacobian: (_x, y) => [interval(0), scaleI(trig(y, 'cos'), 0.6), interval(0), interval(0)],
  enclose: (x, y) => [inflateI(addI(x, scaleI(trig(y, 'sin'), 0.6)), 1e-14), y],
};
const height = 8 * Math.PI,
  edge = { a: point(-0.2, 0), b: point(-0.2, height), owners: [1, 2] };
const roots = boardRoots(edge, shear, 4, height, unlimited);
assert.equal(roots.length, 8);
const fragments = clipWarpEdge(edge, 0, shear, 4, height, unlimited, new Map());
assert.equal(fragments.length, 4);
const alpha = Math.asin(1 / 3);
for (let i = 0; i < 4; i++) {
  const lo = Math.PI + alpha + 2 * Math.PI * i,
    hi = 2 * Math.PI - alpha + 2 * Math.PI * i;
  assert.ok(Math.abs(fragments[i].a.world.y - lo) < 3e-7);
  assert.ok(Math.abs(fragments[i].b.world.y - hi) < 3e-7);
  assert.equal(fragments[i].a.world.x, 0);
  assert.equal(fragments[i].b.world.x, 0);
}
assert.throws(
  () =>
    boardRoots(
      { a: point(-0.6, 0), b: point(-0.6, height), owners: [1, 2] },
      shear,
      4,
      height,
      unlimited,
    ),
  /tangency|root/,
);

for (const metric of [
  { cosA: 1, sinA: 0, scale: 1 },
  { cosA: Math.cos(0.7), sinA: Math.sin(0.7), scale: 2.3 },
]) {
  const source = {
    sites: {
      xy: new Float64Array([1, 1, 3, 1, 3, 3, 1, 3]),
      ids: new Uint32Array([1, 4, 7, 10]),
      pinned: new Uint8Array(4),
      truncatedFrom: 0,
    },
    query: {
      implementation: 'meshcraft-relief-query/2' as const,
      ownerPolicy: 'exact-represented-metric-stable-id-v1' as const,
      meshX: 4,
      meshY: 4,
      seed: 7,
      metric,
      warp: { amplitude: 0.4, frequency: 0.1, seed: 37, kernel: new SimplexNoiseGen(37).describeKernel() },
    },
  };
  const result = buildCellGraph({ source, revision: 1 });
  assert.ok(result.ok, result.ok ? undefined : result.reason);
  assert.ok(result.graph.certificate.errorIn < 0.005);
  if (metric.scale === 1) {
    assert.equal(result.graph.inner.length, 4);
    assert.equal(
      result.graph.nodes.filter((node) => node.incident.length === 4).length,
      1,
      'cocircular warped junction retains one identity',
    );
  }
}

for (const name of ['relief-pockets', 'relief-starburst', 'relief-vertical', 'relief-radial']) {
  const surface = buildNoiseSurface(
      noiseSurfaceParams({ ...DEFAULTS, ...presetState(name), resolution: 32 }),
    ),
    source = surface.reliefSource!;
  const before = source.sites.xy.slice(),
    result = buildCellGraph({ source, revision: 17 });
  assert.ok(result.ok, result.ok ? undefined : `${name}: ${result.reason}`);
  const graph = result.graph;
  assert.equal(graph.certificate.kind, 'contraction');
  assert.ok(graph.certificate.errorIn < 0.005);
  assert.deepEqual(source.sites.xy, before);
  assert.ok(graph.inner.length > 0);
  assert.ok(graph.outer.closed);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const runtime = new SimplexNoiseGen(source.query.warp.seed),
    A = source.query.warp.amplitude,
    f = source.query.warp.frequency;
  const warp = (x: number, y: number): readonly [number, number] => [
    x + A * runtime.noise(x * f, y * f),
    y + A * runtime.noise(x * f + 31.7, y * f + 17.3),
  ];
  const metric = source.query.metric,
    sites = source.sites;
  const boundaryDistance = (x: number, y: number, owners: readonly number[]): number => {
    const i = sites.ids.indexOf(owners[0]),
      j = sites.ids.indexOf(owners[1]);
    const transform = (sx: number, sy: number): readonly [number, number] => [
      (sx * metric.cosA + sy * metric.sinA) * metric.scale,
      sy * metric.cosA - sx * metric.sinA,
    ];
    const s = transform(sites.xy[2 * i], sites.xy[2 * i + 1]),
      t = transform(sites.xy[2 * j], sites.xy[2 * j + 1]);
    const dx = t[0] - s[0],
      dy = t[1] - s[1];
    const nx = dx * metric.cosA * metric.scale - dy * metric.sinA,
      ny = dx * metric.sinA * metric.scale + dy * metric.cosA;
    const rhs = (t[0] * t[0] + t[1] * t[1] - s[0] * s[0] - s[1] * s[1]) / 2;
    const q = warp(x, y),
      residue = (nx * q[0] + ny * q[1] - rhs) / (nx * nx + ny * ny),
      qx = q[0] - residue * nx,
      qy = q[1] - residue * ny;
    let bx = qx,
      by = qy;
    for (let iteration = 0; iteration < 160; iteration++) {
      const value = warp(bx, by);
      bx = qx - (value[0] - bx);
      by = qy - (value[1] - by);
    }
    return Math.hypot(bx - x, by - y);
  };

  const oracle = reliefOwnerOracle(source),
    m = source.query.metric;
  const positions=Array.from(sites.ids,(_,i)=>({x:sites.xy[2*i],y:sites.xy[2*i+1]}));
  const exactOwner=(x:number,y:number):number=>{
    const q=warp(x,y);
    return sites.ids[rankSitesExactly(positions,q[0],q[1],m.cosA,m.sinA,m.scale)[0]];
  };
  let checked = 0;
  for (const path of graph.inner)
    for (
      let i = 0;
      i + 1 < path.nodes.length;
      i += Math.max(1, Math.floor(path.nodes.length / 4))
    ) {
      const a = nodes.get(path.nodes[i])!,
        b = nodes.get(path.nodes[i + 1])!,
        x = (a.x + b.x) / 2,
        y = (a.y + b.y) / 2;
      const e = 0.01,
        dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.hypot(dx, dy);
      assert.ok(
        boundaryDistance(x, y, path.owners) <= graph.certificate.errorIn + 1e-7,
        `${name}: independent inverse-to-line error`,
      );
      const owners = [
        oracle(x - (dy / length) * e, y + (dx / length) * e),
        oracle(x + (dy / length) * e, y - (dx / length) * e),
      ];
      assert.deepEqual(owners,[
        exactOwner(x - (dy / length) * e, y + (dx / length) * e),
        exactOwner(x + (dy / length) * e, y - (dx / length) * e),
      ],`${name}: independent exact represented-metric owner ordering`);
      // Near a junction an offset can enter a third cell; check only unambiguous pair samples.
      if (owners.every((owner) => owner !== null && path.owners.includes(owner))) {
        assert.notEqual(owners[0], owners[1]);
        checked++;
      }
    }
  assert.ok(checked > 0, `${name}: independent source owner offsets`);
  assert.ok(m.scale >= 1);
  if (name === 'relief-pockets') {
    const straight = buildCellGraph({
      source: {
        sites,
        query: {
          ...source.query,
          warp: { ...source.query.warp, amplitude: 0, kernel: null },
        },
      },
      revision: 17,
    });
    assert.ok(straight.ok);
    const straightNodes = new Map(straight.graph.nodes.map((node) => [node.id, node]));
    const errors = straight.graph.inner.map((path) => {
      const a = straightNodes.get(path.nodes[0])!,
        b = straightNodes.get(path.nodes[1])!;
      return boundaryDistance((a.x + b.x) / 2, (a.y + b.y) / 2, path.owners);
    });
    assert.ok(
      errors.some((error) => error > 0.005),
      'straight query polygons are a failing negative control for the real warped boundary',
    );
  }

  // #80: graph work stays bounded. Before the reach-limited board roots, one-cell Simplex
  // corner margin and point-enclosure root pruning these took 3.0e6 to 2.2e7 steps (and 2.5 to
  // 21.5 s); they now take 4.8e5 to 3.0e6.
  assert.ok(graph.certificate.steps < 4_000_000, `${name}: ${graph.certificate.steps} graph steps`);

  const dxf = cellGraphDxf(graph);
  assert.ok(dxf.endsWith('0\nEOF\n'));
  assert.throws(
    () => cellGraphDxf({ ...graph, inner: [...graph.inner, graph.inner[0]] }),
    /duplicate/,
  );
  process.stdout.write(
    JSON.stringify({
      name,
      sites: source.sites.ids.length,
      nodes: graph.nodes.length,
      paths: graph.inner.length,
      certificate: graph.certificate,
    }) + '\n',
  );
}
// #80: a large unwarped layout no longer spends its step budget on every edge pair. 2,051
// cells used to exceed the 25e6-step budget in the quadratic emission check.
{
  const large = buildNoiseSurface(noiseSurfaceParams({ ...DEFAULTS, ...presetState('relief-pockets'),
    distortion: 0, reliefCellSize: 0.25, reliefAnisotropy: 0, resolution: 32 })).reliefSource!;
  assert.equal(large.query.warp.amplitude, 0);
  assert.ok(large.sites.ids.length > 1900, `${large.sites.ids.length} cells`);
  const straight = buildCellGraph({ source: large, revision: 3 });
  assert.ok(straight.ok, straight.ok ? undefined : straight.reason);
  assert.equal(straight.graph.certificate.kind, 'exact-rational');
  assert.ok(straight.graph.certificate.steps < 1_000_000, `${straight.graph.certificate.steps} straight steps`);
}
// Review of #84: long parallel bisectors share grid cells, so every emission pair visit is
// charged; a 1,025-site diagonal stops at the step budget instead of running unbounded.
{
  const xy: number[] = [];
  for (let k = 0; k < 1025; k++) xy.push(1 + k / 512, 1 + k / 512);
  const diagonal = buildCellGraph({ revision: 4, source: {
    sites: { xy: Float64Array.from(xy), ids: Uint32Array.from({ length: 1025 }, (_, i) => i), pinned: new Uint8Array(1025), truncatedFrom: 0 },
    query: { implementation: 'meshcraft-relief-query/2', ownerPolicy: 'exact-represented-metric-stable-id-v1', meshX: 4, meshY: 4,
      seed: 7, metric: { cosA: 1, sinA: 0, scale: 1 }, warp: { amplitude: 0, frequency: 0.1, seed: 37, kernel: null } } } });
  assert.ok(!diagonal.ok && diagonal.reason === 'Cell graph work budget exceeded', diagonal.ok ? 'built' : diagonal.reason);
}
process.stdout.write(
  'Warp disconnected clipping, tangency refusal, cocircular junctions, metric and producer graphs passed\n',
);
