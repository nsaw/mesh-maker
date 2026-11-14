/** Independent pre-extraction viewport oracle, Float32 bounds and transferable ownership. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DEFAULTS, STATE } from '../src/state';
import { buildNoiseSurface, noiseSurfaceParams } from '../src/noise/surface';
import { packNoiseSurface, unpackNoiseSurface } from '../src/noise/messages';
import { buildSurfaceBuffers, buildWireBuffers } from '../src/render-geometry';
import { originalSurfaceBuffers, originalWireBuffers } from './render-surface-original.fixture';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/noise-surface-baseline.json', import.meta.url), 'utf8')) as {
  fixtures: { name: string; settings: object }[];
};
let comparisons = 0;
for (const fixture of fixtures.fixtures) {
  Object.assign(STATE, DEFAULTS, fixture.settings);
  const source = buildNoiseSurface(noiseSurfaceParams(STATE));
  for (const diagonal of [null, false, true]) {
    const actual = buildSurfaceBuffers(source.vertices, source.cols, source.rows, STATE.meshX, STATE.meshY, diagonal);
    const expected = originalSurfaceBuffers(source.vertices, source.cols, source.rows, STATE.meshX, STATE.meshY, diagonal);
    for (const field of ['positions', 'uvs', 'normals', 'indices'] as const) {
      const a = actual[field], b = expected[field];
      assert(Buffer.from(a.buffer).equals(Buffer.from(b.buffer)), `${fixture.name}/${diagonal}/${field} exact bytes`);
    }
    assert.deepEqual([actual.zMin, actual.zMax, actual.zRange], [expected.zMin, expected.zMax, expected.zRange]);
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(actual.positions, 3));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    assert.deepEqual(actual.bounds.min, geometry.boundingBox!.min.toArray(), `${fixture.name} exact uploaded box min`);
    assert.deepEqual(actual.bounds.max, geometry.boundingBox!.max.toArray(), `${fixture.name} exact uploaded box max`);
    const { center, radius, min, max } = actual.bounds;
    for (let k = 0; k < actual.positions.length; k += 3) {
      const p = actual.positions.subarray(k, k + 3);
      for (let axis = 0; axis < 3; axis++) assert(p[axis] >= min[axis] && p[axis] <= max[axis]);
      assert(Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]) <= radius, 'sphere cannot clip an uploaded node');
    }
    geometry.dispose();
    const heights = new Float64Array(source.vertices.flat());
    const wire = buildWireBuffers(actual.positions, heights, source.cols, source.rows, actual.zMin, actual.zRange);
    const oldWire = originalWireBuffers(expected.positions, source.vertices, source.cols, source.rows, expected.zMin, expected.zRange);
    assert.deepEqual(wire.positions, oldWire.positions, 'lazy wire positions retain their original bytes');
    assert.deepEqual(wire.colors, oldWire.colors, 'lazy wire colors retain their original bytes');
    actual.wire = wire;
    const packed = packNoiseSurface({ ...source, renderBuffers: actual });
    const transferred = structuredClone(packed, { transfer: [packed.heights.buffer, actual.positions.buffer,
      actual.normals.buffer, actual.uvs.buffer, actual.indices.buffer, wire.positions.buffer, wire.colors.buffer] });
    assert.equal(actual.positions.byteLength, 0, 'worker transfers, rather than clones, the large buffers');
    const restored = unpackNoiseSurface(transferred);
    assert.deepEqual(restored.vertices, source.vertices);
    assert.deepEqual(restored.renderBuffers?.positions, expected.positions);
    assert.deepEqual(restored.renderBuffers?.wire, oldWire);
    comparisons++;
  }
}
// Non-noise inputs retain fixed diagonals and bounds also cover rounding at tiny/negative extents.
for (const [x, y] of [[1e-8, 1e-7], [-2.3, 3.7], [36, 24]]) {
  const grid = [[-0.123456789, 2.6000001], [1e-8, 0.01]];
  const result = buildSurfaceBuffers(grid, 2, 2, x, y, true);
  for (let k = 0; k < result.positions.length; k += 3) for (let axis = 0; axis < 3; axis++)
    assert(result.positions[k + axis] >= result.bounds.min[axis] && result.positions[k + axis] <= result.bounds.max[axis]);
}
Object.assign(STATE, DEFAULTS);
process.stdout.write(`Render preparation passed ${comparisons} original-math byte comparisons, exact boxes, conservative spheres and transfer ownership.\n`);
