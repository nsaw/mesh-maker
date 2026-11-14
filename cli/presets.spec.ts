/** Preset ownership, production geometry and default SBP export contracts. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, STATE } from '../src/state';
import { CNC_PRESETS, CUT_THROUGH_PRESETS, PRESET_OWNED_KEYS, presetState } from '../src/noise/presets';
import { generateNoiseMesh } from '../src/mesh';
import { gridMinMax, MIN_WATERTIGHT_THICKNESS } from '../src/geometry';
import { getExportSurface, surfaceHeightmap } from '../src/export-surface';
import { getDefaultConfig } from '../src/sbp/tools';
import { generateSBP } from '../src/sbp/generate';
import { effectiveWorkOffsets, MACHINE_TRAVEL_IN, MAX_CUT_DEPTH_IN, MAX_STOCK_THICKNESS_IN } from '../src/sbp/types';

function bytes(): Buffer {
  assert(STATE.vertices);
  return Buffer.from(new Float64Array(STATE.vertices.flat()).buffer);
}

const names = Object.keys(CNC_PRESETS);
const args = process.argv.slice(2);
const geometryOnly = args.length === 1 && args[0] === '--geometry';
const exportOnly = args.length === 2 && args[0] === '--export';
const listExports = args.length === 1 && args[0] === '--list-exports';
assert(args.length === 0 || geometryOnly || exportOnly || listExports,
  'Usage: presets.spec.ts [--geometry | --export <preset> | --list-exports]');
if (exportOnly) {
  assert(Object.prototype.hasOwnProperty.call(CNC_PRESETS, args[1]), `Unknown preset: ${args[1]}`);
}

if (args.length === 0) {
  // Each full export owns a fresh heap, matching the CI matrix. The parent keeps no surfaces or SBP.
  const runChild = (childArgs: string[]): void => {
    const child = spawnSync(process.execPath,
      [...process.execArgv, fileURLToPath(import.meta.url), ...childArgs], { stdio: 'inherit' });
    if (child.error) throw new Error(`Preset check ${childArgs.join(' ')} could not start: ${child.error.message}`);
    if (child.signal) throw new Error(`Preset check ${childArgs.join(' ')} terminated by ${child.signal}`);
    if (child.status !== 0) {
      process.stderr.write(`Preset check ${childArgs.join(' ')} exited with status ${child.status}\n`);
      process.exit(child.status ?? 1);
    }
  };
  runChild(['--geometry']);
  for (const name of names) runChild(['--export', name]);
  process.stdout.write('ALL PRESET CHECKS OK\n');
} else if (listExports) {
  // CI derives its matrix from the production preset names, so a new preset cannot be omitted.
  process.stdout.write(JSON.stringify(names) + '\n');
} else {
  if (!exportOnly) {
    const owned = new Set<string>(PRESET_OWNED_KEYS);
    for (const preset of Object.values(CNC_PRESETS)) {
      for (const key of Object.keys(preset)) assert(owned.has(key), `preset field ${key} must be owned`);
    }
    assert.throws(() => presetState('missing'), /Unknown preset/);
    assert.throws(() => presetState('__proto__'), /Unknown preset/);

    // Exercise all ordering pairs through the production sampler at a small grid. High-resolution
    // geometry is checked separately, so this cross-product remains affordable before indexing lands.
    for (const name of names) {
      Object.assign(STATE, DEFAULTS, { resolution: 40 }, presetState(name));
      generateNoiseMesh();
      const expected = bytes();
      for (const previous of names) {
        Object.assign(STATE, DEFAULTS, { resolution: 40 }, presetState(previous));
        generateNoiseMesh();
        Object.assign(STATE, presetState(name));
        generateNoiseMesh();
        assert(bytes().equals(expected), `${name} differs after ${previous}`);
      }
      process.stdout.write(`order ${name}: all predecessors identical\n`);
    }

    // Only generation controls are replaced, even if the previous user settings differ from defaults.
    Object.assign(STATE, DEFAULTS, { seed: 123, orbit: 78, resolution: 93, filename: 'retained', viewMode: 'wireframe' });
    Object.assign(STATE, presetState('gentle-waves'));
    assert.equal(STATE.seed, 123);
    assert.equal(STATE.orbit, 78);
    assert.equal(STATE.resolution, 93);
    assert.equal(STATE.filename, 'retained');
    assert.equal(STATE.viewMode, 'wireframe');
  }

  for (const name of exportOnly ? [args[1]] : names) {
    Object.assign(STATE, DEFAULTS, { resolution: 400 }, presetState(name));
    generateNoiseMesh();
    const vertices = STATE.vertices;
    assert(vertices);
    const [minZ, maxZ] = gridMinMax(vertices, STATE.rows, STATE.cols);
    const depth = Math.min(STATE.amplitude, STATE.baseThickness);
    assert(STATE.baseThickness <= MAX_STOCK_THICKNESS_IN, `${name} maximum stock thickness`);
    assert(STATE.meshX <= MACHINE_TRAVEL_IN.x && STATE.meshY <= MACHINE_TRAVEL_IN.y, `${name} bed fit`);
    assert(Math.abs(maxZ - minZ - depth) <= depth * 0.02, `${name} actual relief ${maxZ - minZ}, requested ${depth}`);
    // Normalized maxima deliberately touch stock top. A zero offset and full depth prove that the
    // material clamp has not cropped the signal; equality at a designed extremum is not saturation.
    assert.equal(STATE.offset, 0, `${name} has no clipping offset`);
    assert(Math.abs(maxZ - STATE.baseThickness) <= 1e-9, `${name} peak stays at stock top`);
    for (const row of vertices) for (const z of row) {
      assert(Number.isFinite(z) && z <= STATE.baseThickness + 1e-9, `${name} finite Z inside stock`);
      if (!CUT_THROUGH_PRESETS.has(name)) assert(z > MIN_WATERTIGHT_THICKNESS, `${name} avoids the floor clamp`);
    }
    if (!CUT_THROUGH_PRESETS.has(name)) assert(minZ >= 1 / 16 - 1e-9, `${name} minimum backing ${minZ}`);
    assert(STATE.baseThickness - minZ <= MAX_CUT_DEPTH_IN + 1e-9, `${name} depth cap`);
    const surface = getExportSurface(true);
    assert.notEqual(typeof surface, 'string', `${name} exportable surface`);
    if (typeof surface === 'string') throw new Error(surface);
    if (geometryOnly) {
      process.stdout.write(`geometry ${name}: depth ${(maxZ - minZ).toFixed(4)} in, backing ${minZ.toFixed(4)} in\n`);
      continue;
    }
    process.stdout.write(`export starting ${name}: ${surface.cols} x ${surface.rows} grid, default roughing and finishing\n`);
    const started = performance.now();
    const config = getDefaultConfig();
    config.materialZ = STATE.baseThickness;
    config.safeZ = config.materialZ + 0.15;
    config.homeZ = config.safeZ + 0.5;
    Object.assign(config, effectiveWorkOffsets(surface.meshX, surface.meshY, 2, 2));
    const result = generateSBP(surfaceHeightmap(surface), config);
    assert(result.sbp.length > 0 && result.stats.totalLines > 0, `${name} default SBP export`);
    process.stdout.write(`geometry/export ${name}: depth ${(maxZ - minZ).toFixed(4)} in, backing ${minZ.toFixed(4)} in; ${((performance.now() - started) / 1000).toFixed(1)} s; ${result.stats.roughingMoves} roughing moves, ${result.stats.finishingMoves} finishing moves, ${result.stats.totalLines} lines\n`);
  }
  Object.assign(STATE, DEFAULTS);
  process.stdout.write('ALL OK\n');
}
