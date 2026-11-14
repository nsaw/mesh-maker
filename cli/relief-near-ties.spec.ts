import { rankSitesExactly } from './exact-metric-rank-oracle';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { SiteGrid } from '../src/noise/site-grid';
import { nearestThree } from '../src/noise/voronoi-relief';
import { metricOrdering, exactMetricOrder } from '../src/noise/metric-order';
interface Fixture {
  sites: { x: number; y: number }[];
  q: [number, number];
  c: number;
  s: number;
  scale: number;
}
const cases: Fixture[] = [];
for (const origin of [0, 1e9, 1e12, -1e12])
  for (const gap of origin === 0
    ? [1e-14, 1e-12, 1e-10]
    : [Math.abs(origin) * Number.EPSILON, 0.01])
    for (const offAxis of [0, 0.5])
      for (const scale of [1, 1.0001, 1.0001000000000002, 1.7, 4])
        for (const angle of [0, 0.713, 2.37])
          for (const side of [-1, 1]) {
            const c = Math.cos(angle),
              s = Math.sin(angle),
              a = { x: origin + 1, y: origin },
              b = { x: origin + 1 + gap, y: origin + offAxis * gap };
            const ux = scale <= 1.0001 ? b.x - a.x : ((b.x - a.x) * c + (b.y - a.y) * s) * scale;
            const uy = scale <= 1.0001 ? b.y - a.y : -(b.x - a.x) * s + (b.y - a.y) * c;
            const length = Math.hypot(ux, uy),
              tx = (side * 0.2 * ux) / length - (10 * uy) / length,
              ty = (side * 0.2 * uy) / length + (10 * ux) / length;
            const q: [number, number] =
              scale <= 1.0001
                ? [a.x + tx, a.y + ty]
                : [a.x + (c * tx) / scale - s * ty, a.y + (s * tx) / scale + c * ty];
            cases.push({
              sites: [a, b, { x: origin + 30, y: origin + 30 }, { x: origin - 30, y: origin - 30 }],
              q,
              c,
              s,
              scale,
            });
          }
const reportedCase = cases.length;
cases.push({
  sites: [
    { x: 1, y: 0 },
    { x: 1 + 1e-14, y: 0 },
    { x: 30, y: 30 },
    { x: -30, y: -30 },
  ],
  q: [-2.9514043666552228, 8.486412693888102],
  c: Math.cos(0.713),
  s: Math.sin(0.713),
  scale: 1.7,
});
for (const scale of [1, 1.0001, 1.0001000000000002, 1.7, 4]) {
  cases.push({
    sites: [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ],
    q: [0, 0],
    c: Math.cos(0.713),
    s: Math.sin(0.713),
    scale,
  });
  cases.push({
    sites: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
    q: [0.25, 10],
    c: Math.cos(0.713),
    s: Math.sin(0.713),
    scale,
  });
}
cases.push({
  sites: [
    { x: 0, y: 0 },
    { x: Number.MIN_VALUE, y: 0 },
    { x: 1, y: 1 },
    { x: -1, y: -1 },
  ],
  q: [Number.MIN_VALUE, 0],
  c: 1,
  s: 0,
  scale: 1,
});
cases.push({
  sites: [
    { x: -0, y: 0 },
    { x: 0, y: -0 },
    { x: 1, y: 1 },
    { x: -1, y: -1 },
  ],
  q: [0, 0],
  c: Math.cos(0.713),
  s: Math.sin(0.713),
  scale: 1.7,
});
// Execute the native initializer, rank loop, cleanup and radius consumers at
// finite distances above its former1e30 sentinel, plus genuinely unfilled slots.
for (const origin of [1e16, 1e100, 1e150]) {
  const gap = origin === 1e16 ? 2 : origin * Number.EPSILON;
  for (const count of [0, 1, 2, 3, 4]) {
    cases.push({
      sites: Array.from({ length: count }, (_, i) => ({
        x: origin + (origin === 1e150 ? -i : i) * gap,
        y: 0,
      })),
      q: [0, 0],
      c: 1,
      s: 0,
      scale: 1,
    });
  }
}
const python = spawnSync('python3', ['scripts/test-relief-near-ties.py'], {
  input: JSON.stringify(cases),
  encoding: 'utf8',
  timeout: 15000,
});
assert.equal(python.status, 0, python.stderr);
const expected = JSON.parse(python.stdout) as { rank: number[]; isotropic: number[] }[];
const owners = new Set<number>();
cases.forEach((fixture, i) => {
  assert.deepEqual(
    rankSitesExactly(fixture.sites, ...fixture.q, fixture.c, fixture.s, fixture.scale).slice(0, 4),
    fixture.sites.length ? expected[i].rank.slice(0, Math.min(4, fixture.sites.length)) : [],
    'common-integer expanded oracle agrees with independent Decimal',
  );
  const { sites, q, c, s, scale } = fixture,
    grid = SiteGrid.fromSites(sites),
    actual = grid.nearestFour(q[0], q[1], c, s, scale);
  assert.deepEqual(
    [actual.idx, actual.idx2, actual.idx3, actual.idx4],
    expected[i].rank,
    `exact nearest rank fixture ${i}`,
  );
  assert.equal(
    grid.nearestOwner(...q),
    expected[i].isotropic[0],
    `exact isotropic owner fixture ${i}`,
  );
  const full = nearestThree(
    sites.map((p) => ({ ...p, radius: 0 })),
    q[0],
    q[1],
    c,
    s,
    scale,
  );
  assert.deepEqual(
    [full.idx, full.idx2, full.idx3, full.idx4],
    expected[i].rank,
    `exact full-scan rank fixture ${i}`,
  );
  owners.add(actual.idx);
  if (i === reportedCase) {
    assert.equal(actual.idx, 0, 'reported off-axis owner must not turn a positive plane into zero');
    assert.ok(
      Math.abs(
        grid.boundaryDistance(q[0], q[1], actual.idx, actual.f1, 20, c, s, scale) -
          0.2000000000000073,
      ) < 1e-12,
    );
  }
});
assert.ok(
  owners.has(0) && owners.has(1),
  'opposite near-coincident half-planes must select both owners',
);
assert.equal(exactMetricOrder({ x: 0, y: 0 }, { x: 1, y: 0 }, 0.5, 10, 1, 0, 1), 0);
// A proxy makes exact fallback observable without test-only production instrumentation.
const ordinary = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
];
let reads = 0;
const observed = ordinary.map((p) => ({
  get x() {
    reads++;
    return p.x;
  },
  get y() {
    reads++;
    return p.y;
  },
}));
const order = metricOrdering(observed, 0.1, 0.2, 3);
for (let i = 0; i < 10000; i++) assert.ok(order(0, 1, 0.2236, 2.907));
assert.equal(reads, 0, 'ordinary comparisons must not decode or read exact site coordinates');
const dense = Array.from({ length: 4096 }, (_, i) => ({ x: i % 64, y: Math.floor(i / 64) }));
let visits = 0;
const counted = dense.map((p) => ({
  get x() {
    visits++;
    return p.x;
  },
  get y() {
    visits++;
    return p.y;
  },
}));
const indexed = new SiteGrid(counted, 1);
visits = 0;
for (let i = 0; i < 100; i++) indexed.nearestFour(1 + ((i * 0.371) % 60), 1 + ((i * 0.217) % 60));
assert.ok(visits < 25000, 'near-tie correctness must preserve bucket candidate work');
const translated = dense.map((p) => ({ x: p.x + 1e12, y: p.y - 1e12 }));
let translatedReads = 0;
const translatedGrid = new SiteGrid(
  translated.map((p) => ({
    get x() {
      translatedReads++;
      return p.x;
    },
    get y() {
      translatedReads++;
      return p.y;
    },
  })),
  1,
);
translatedReads = 0;
for (let i = 0; i < 100; i++)
  translatedGrid.nearestOwner(1e12 + 1 + ((i * 0.371) % 60), -1e12 + 1 + ((i * 0.217) % 60));
assert.ok(translatedReads < 25000, 'large origins must retain bounded bucket work');
process.stdout.write(
  `Decimal nearest-rank fixtures ${cases.length}; sparse coordinate reads ${visits}; ordinary exact-site reads ${reads}\n`,
);
