import assert from 'node:assert/strict';
import { DEFAULTS, STATE, CURRENT_PAYLOAD_VERSION, serializeConfig, deserializeConfig, consumeInvalidCellLink } from '../src/state';
import { decodeReliefLink, encodeReliefLink, MAX_LINK_SITES, MAX_RELIEF_LINK_BYTES } from '../src/relief-link';
import type { ReliefSiteSet } from '../src/types';

const sites = (count: number): ReliefSiteSet => ({
  xy: Float64Array.from({length: count * 2}, (_, i) => i % 2 === 0 ? (Math.floor(i / 2) % 40) * .8 : Math.floor(i / 80) * .8),
  ids: Uint32Array.from({length: count}, (_, i) => i === count - 1 ? 0xffffffff : i * 103),
  pinned: Uint8Array.from({length: count}, (_, i) => i % 2), truncatedFrom: 0,
});
const payload = (value: object): URLSearchParams => new URLSearchParams({c: btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')});

for (const count of [0, 1, 2, MAX_LINK_SITES]) {
  const original = sites(count), before = structuredClone(original), wire = encodeReliefLink(original, 36, 24);
  const restored = decodeReliefLink(wire, 36, 24);
  assert.deepEqual(original, before, 'Encoding must not alter retained source arrays');
  assert.deepEqual(restored.ids, original.ids);
  assert.deepEqual(restored.pinned, original.pinned);
  original.xy.forEach((value, i) => assert(Math.abs(value - restored.xy[i]) < .01));
}
const edges: ReliefSiteSet = {xy: new Float64Array([1.006, 2.004, .125, .255]), ids: new Uint32Array([0, 0xffffffff]), pinned: new Uint8Array([1, 0]), truncatedFrom: 0};
const edgeWire = encodeReliefLink(edges, 1.006, 2.004);
assert.equal(Buffer.from(edgeWire.coordinates, 'base64').toString('hex'), '6400c8000d001a00');
assert.equal(Buffer.from(edgeWire.identities, 'base64').toString('hex'), '00000000ffffffff');
assert.equal(Buffer.from(edgeWire.pins, 'base64').toString('hex'), '0100');
const edgeRoundtrip = decodeReliefLink(edgeWire, 1.006, 2.004);
assert(edgeRoundtrip.xy[0] <= 1.006 && edgeRoundtrip.xy[1] <= 2.004);
edges.xy.forEach((value, i) => assert(Math.abs(value - edgeRoundtrip.xy[i]) < .01));
assert.throws(() => encodeReliefLink(sites(1001), 36, 24), /Too many cells/);
assert.throws(() => encodeReliefLink(sites(2), 37, 24), /bed/);
const collision = sites(2); collision.xy.set([1, 1, 1.001, 1.001]);
assert.throws(() => encodeReliefLink(collision, 36, 24), /overlap/);
collision.xy.set([1, 1, 1, 1]);
assert.throws(() => encodeReliefLink(collision, 36, 24), /overlap/);
const valid = encodeReliefLink(sites(2), 36, 24);
for (const broken of [null, [], {...valid, version: 2}, {...valid, count: '2'}, {...valid, count: -1}, {...valid, count: 1001},
  {...valid, coordinates: valid.coordinates + ' '}, {...valid, identities: ''}, {...valid, pins: btoa('\x02\x00')}, {...valid, extra: true}]) {
  assert.throws(() => decodeReliefLink(broken, 36, 24));
}
assert.throws(() => decodeReliefLink({...valid, pins: 'AAF='}, 36, 24), /encoding/, 'Nonzero discarded padding bits must not become a second encoding of the same pins');
assert.throws(() => decodeReliefLink({...valid, pins: 'AA=='}, 36, 24), /encoding/, 'Equal base64 character length does not imply the expected byte count');
const atobBefore = globalThis.atob;
let decodeCalls = 0;
globalThis.atob = text => { decodeCalls++; return atobBefore(text); };
try {
  assert.throws(() => decodeReliefLink({...valid, coordinates: valid.coordinates.repeat(1000)}, 36, 24), /encoding/);
  assert.equal(decodeCalls, 0, 'Reject unsupported encoded lengths before allocating decoded strings or arrays');
} finally { globalThis.atob = atobBefore; }
const oversizedSites = sites(1001), oversizedXY = Buffer.alloc(1001 * 4), oversizedIDs = Buffer.alloc(1001 * 4);
oversizedSites.ids.forEach((id, i) => {
  oversizedXY.writeInt16LE(Math.round(oversizedSites.xy[i * 2] * 100), i * 4);
  oversizedXY.writeInt16LE(Math.round(oversizedSites.xy[i * 2 + 1] * 100), i * 4 + 2);
  oversizedIDs.writeUInt32LE(id, i * 4);
});
assert.throws(() => decodeReliefLink({version: 1, count: 1001, coordinates: oversizedXY.toString('base64'), identities: oversizedIDs.toString('base64'),
  pins: Buffer.from(oversizedSites.pinned).toString('base64')}, 36, 24), /Unsupported/);
const descending = structuredClone(valid); descending.identities = btoa('\x01\x00\x00\x00\x00\x00\x00\x00');
assert.throws(() => decodeReliefLink(descending, 36, 24), /identity/);
const overlap = {...valid, coordinates: btoa('\x00'.repeat(8))};
assert.throws(() => decodeReliefLink(overlap, 36, 24), /overlap/);
assert.throws(() => decodeReliefLink(valid, 37, 24), /bed/);
assert.throws(() => decodeReliefLink(valid, NaN, 24));
const fromIndependentWire = decodeReliefLink({version: 1, count: 2, coordinates: Buffer.from('00006400ac0d6009', 'hex').toString('base64'),
  identities: Buffer.from('03000000feffffff', 'hex').toString('base64'), pins: Buffer.from([0, 1]).toString('base64')}, 36, 24);
assert.deepEqual(Array.from(fromIndependentWire.xy), [0, 1, 35, 24]);
assert.deepEqual(Array.from(fromIndependentWire.ids), [3, 0xfffffffe]);
assert.deepEqual(Array.from(fromIndependentWire.pinned), [0, 1]);

const saved = {...STATE};
try {
  Object.assign(STATE, DEFAULTS, {noiseType: 'voronoi-relief', reliefSites: sites(1000), reliefRevision: 39});
  const encoded = serializeConfig(), result = deserializeConfig(new URLSearchParams({c: encoded}));
  assert.equal(result.noiseType, 'voronoi-relief');
  assert.equal(result.reliefRevision, 1, 'Runtime revision is freshly assigned, not transported');
  assert.deepEqual(result.reliefSites?.ids, STATE.reliefSites?.ids);
  assert.deepEqual(result.reliefSites?.pinned, STATE.reliefSites?.pinned);
  assert.equal(consumeInvalidCellLink(), false);
  for (const malformed of [
    ...[CURRENT_PAYLOAD_VERSION + 1, -1, 'invalid', 1.5].map(_v => ({_v, noiseType: 'voronoi-relief', _sites: valid})),
    {_v: CURRENT_PAYLOAD_VERSION, noiseType: 'voronoi-relief', _sites: overlap},
    {_v: CURRENT_PAYLOAD_VERSION, noiseType: 'simplex', _sites: valid},
    {_v: CURRENT_PAYLOAD_VERSION, mode: 'drape', noiseType: 'voronoi-relief', _sites: valid},
  ]) {
    assert.deepEqual(deserializeConfig(payload(malformed)), {}, 'Malformed frozen links refuse the entire document');
    assert.equal(consumeInvalidCellLink(), true);
    assert.equal(consumeInvalidCellLink(), false);
  }
  assert.deepEqual(deserializeConfig(new URLSearchParams({c: 'x'.repeat(MAX_RELIEF_LINK_BYTES + 1)})), {});
  assert.equal(consumeInvalidCellLink(), true);
  Object.assign(STATE, {reliefSites: sites(1001)});
  assert.throws(serializeConfig, /Too many cells/);
  Object.assign(STATE, {reliefSites: null, noiseType: 'simplex'});
  assert.equal(serializeConfig(), '', 'Default links remain unchanged');
} finally { Object.assign(STATE, saved); }
process.stdout.write('Approximate relief links retain identities and pins, bound coordinates and refuse precision collisions.\n');
