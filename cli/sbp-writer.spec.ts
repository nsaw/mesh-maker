/** SBP output bytes captured before bounded line formatting was introduced.
 * Baseline: git show ac2e14e:src/sbp/writer.ts
 * Deterministic fixtures cover large output, section boundaries and every retract branch.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeSBP } from '../src/sbp/writer';
import { getDefaultConfig } from '../src/sbp/tools';
import type { ToolpathMove, ToolpathSection } from '../src/sbp/types';

function contractFixtures() {
  const config = getDefaultConfig();
  const transitions: ToolpathMove[] = [
    { type: 'rapid', x: 0, y: 0, z: config.safeZ },
    { type: 'cut', x: 1, y: 2, z: 0.3 },
    { type: 'rapid', x: 1, y: 2, z: config.safeZ },
    { type: 'cut', x: 2, y: 3, z: 0.4 },
    { type: 'rapid', x: 2, y: 3, z: config.homeZ },
    { type: 'cut', x: 3, y: 4, z: 0.5 },
  ];
  const denseMoves: ToolpathMove[] = Array.from({ length: 8250 }, (_, k) => ({
    type: 'cut', x: (k % 100) / 20, y: Math.floor(k / 100) / 20, z: 0.125 + (k % 17) / 64,
  }));
  const large: ToolpathSection[] = [
    { name: 'Empty first', tool: config.roughingTool, moves: [] },
    { name: 'Dense roughing', tool: config.roughingTool, moves: [...denseMoves, ...transitions] },
    { name: 'Finishing transition', tool: config.finishingTool, moves: transitions },
    { name: 'Empty last', tool: config.finishingTool, moves: [] },
  ];
  return { config, large, transitions: [{ name: 'Transitions', tool: config.finishingTool, moves: transitions }],
    emptySections: [{ name: 'Empty', tool: config.roughingTool, moves: [] }], noSections: [] };
}

const expected = {
  "large": {
    "sha256Base64": "l/iCFBRKehq1fPSKmId1MPHtbhAW3FndvFYhlIjtsVM=",
    "bytes": 250373,
    "lineCount": 8367
  },
  "transitions": {
    "sha256Base64": "2v5vl8PIAbyBHG+cJWVK083Mqksup1c6oq35sBjYBqk=",
    "bytes": 1512,
    "lineCount": 54
  },
  "emptySections": {
    "sha256Base64": "bDhNfRPzazCSThWWW1bNPtOUNWqiesceYPGRw4Bn0CQ=",
    "bytes": 1260,
    "lineCount": 45
  },
  "noSections": {
    "sha256Base64": "KxlSb40ZF9ZuuNmtpPy/4/v0+3X7URh6D4umyhnxF7s=",
    "bytes": 898,
    "lineCount": 27
  }
} as const;

const { config, ...cases } = contractFixtures();
for (const name of Object.keys(cases) as (keyof typeof cases)[]) {
  const result = writeSBP(cases[name], config);
  const snapshot = expected[name];
  assert.equal(createHash('sha256').update(result.sbp).digest('base64'), snapshot.sha256Base64, `${name} original output bytes`);
  assert.equal(Buffer.byteLength(result.sbp), snapshot.bytes, `${name} byte length`);
  assert.equal(result.lineCount, snapshot.lineCount, `${name} reported line count`);
  assert.equal(result.sbp.split('\n').length - 1, snapshot.lineCount, `${name} actual line count`);
  assert(result.sbp.endsWith('\n') && !result.sbp.includes('\r'), `${name} LF terminator`);
  process.stdout.write(`writer ${name}: byte-identical to original snapshot\n`);
}

const motion = (sbp: string): string[] => sbp.split('\n').filter(line => /^(M3|J3|JZ),/.test(line));
assert.deepEqual(motion(writeSBP(cases.transitions, config).sbp), [
  'J3,0.000000,0.000000,1.600000',
  'M3,1.000000,2.000000,0.300000',
  'J3,1.000000,2.000000,1.600000',
  'M3,2.000000,3.000000,0.400000',
  'J3,2.000000,3.000000,1.600000',
  'J3,2.000000,3.000000,2.300000',
  'M3,3.000000,4.000000,0.500000',
  'J3,3.000000,4.000000,1.600000',
  'JZ,2.300000',
  'J3,0.000000,0.000000,2.300000',
], 'rapid-after-cut and final retract commands retain their order and coordinates');
assert.deepEqual(motion(writeSBP(cases.emptySections, config).sbp), [
  'J3,0.000000,0.000000,2.300000',
], 'an empty section adds no toolpath moves');
const large = writeSBP(cases.large, config).sbp;
assert.equal(large.split('\n').filter(line => line.startsWith('M3,')).length, 8256,
  'large output retains every cut across section boundaries');
process.stdout.write('ALL OK\n');
