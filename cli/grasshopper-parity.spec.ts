/**
 * Parity check for embedded GhPython scripts in the builder.
 * Run: npm run test:gh-parity  (or: npx tsx cli/grasshopper-parity.spec.ts)
 *
 * `grasshopper/builder/meshcraft_builder.py` embeds NOISE_SCRIPT and PRESETS_SCRIPT
 * as triple-quoted Python literals. These are hand-maintained mirrors of the
 * canonical standalone component files in `grasshopper/components/`.
 *
 * This spec extracts the embedded literals and asserts they share an identical
 * algorithmic core with the standalone files (after stripping platform-specific
 * differences: leading shebang/header comments, script-end footer, and trailing
 * whitespace). Drift between the two paths has caused round-2 through round-5
 * review findings — this guard catches it before review.
 */

import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;

let failures = 0;
function assert(condition: boolean, label: string, detail = ''): void {
  if (condition) {
    process.stdout.write(`  ok  ${label}\n`);
  } else {
    process.stdout.write(`  FAIL ${label}${detail ? ` — ${detail}` : ''}\n`);
    failures++;
  }
}

/** Extract the body of a triple-quoted assignment `NAME = """..."""`. */
function extractEmbedded(source: string, name: string): string {
  const re = new RegExp(`${name}\\s*=\\s*"""([\\s\\S]*?)"""`, 'm');
  const m = source.match(re);
  if (!m) throw new Error(`Could not find embedded ${name} literal`);
  return m[1];
}

/**
 * Normalize a script for byte-comparison:
 *   1. Right-trim every line (drop trailing whitespace).
 *   2. Drop now-empty lines (the two files use blank-line separators in
 *      different counts; a step that's purely a separator shouldn't fail parity).
 */
function normalize(src: string): string {
  return src
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .filter((line) => line.length > 0)
    .join('\n');
}

const builderSrc = readFileSync(`${ROOT}grasshopper/builder/meshcraft_builder.py`, 'utf8');
const noiseGenSrc = readFileSync(`${ROOT}grasshopper/components/noise_gen.py`, 'utf8');
const presetsSrc = readFileSync(`${ROOT}grasshopper/components/presets.py`, 'utf8');

const embeddedNoise = extractEmbedded(builderSrc, 'NOISE_SCRIPT');
const embeddedPresets = extractEmbedded(builderSrc, 'PRESETS_SCRIPT');

// 1. Both embedded scripts found
process.stdout.write('1. embedded scripts present\n');
assert(embeddedNoise.length > 100, 'NOISE_SCRIPT extracted', `${embeddedNoise.length} chars`);
assert(embeddedPresets.length > 100, 'PRESETS_SCRIPT extracted', `${embeddedPresets.length} chars`);

// 2. NOISE_SCRIPT byte-equivalent to noise_gen.py (after whitespace normalization)
process.stdout.write('2. NOISE_SCRIPT matches grasshopper/components/noise_gen.py\n');
const a = normalize(embeddedNoise);
const b = normalize(noiseGenSrc);
if (a === b) {
  assert(true, 'identical after whitespace normalization');
} else {
  // Find first divergence to make drift easy to spot
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  let diffIdx = -1;
  for (let i = 0; i < Math.max(aLines.length, bLines.length); i++) {
    if (aLines[i] !== bLines[i]) { diffIdx = i; break; }
  }
  const ctx = (lines: string[], i: number, n = 2): string =>
    lines.slice(Math.max(0, i - n), i + n + 1).map((l, k) => `      ${k === n ? '>' : ' '} ${l}`).join('\n');
  process.stdout.write(`  FAIL identical after whitespace normalization (first divergence at line ${diffIdx})\n`);
  process.stdout.write(`    EMBEDDED (NOISE_SCRIPT in meshcraft_builder.py):\n${ctx(aLines, diffIdx)}\n`);
  process.stdout.write(`    CANONICAL (noise_gen.py):\n${ctx(bLines, diffIdx)}\n`);
  failures++;
}

// 3. PRESETS_SCRIPT byte-equivalent to presets.py
process.stdout.write('3. PRESETS_SCRIPT matches grasshopper/components/presets.py\n');
const c = normalize(embeddedPresets);
const d = normalize(presetsSrc);
if (c === d) {
  assert(true, 'identical after whitespace normalization');
} else {
  const aLines = c.split('\n');
  const bLines = d.split('\n');
  let diffIdx = -1;
  for (let i = 0; i < Math.max(aLines.length, bLines.length); i++) {
    if (aLines[i] !== bLines[i]) { diffIdx = i; break; }
  }
  const ctx = (lines: string[], i: number, n = 2): string =>
    lines.slice(Math.max(0, i - n), i + n + 1).map((l, k) => `      ${k === n ? '>' : ' '} ${l}`).join('\n');
  process.stdout.write(`  FAIL identical after whitespace normalization (first divergence at line ${diffIdx})\n`);
  process.stdout.write(`    EMBEDDED (PRESETS_SCRIPT in meshcraft_builder.py):\n${ctx(aLines, diffIdx)}\n`);
  process.stdout.write(`    CANONICAL (presets.py):\n${ctx(bLines, diffIdx)}\n`);
  failures++;
}

if (failures === 0) {
  process.stdout.write('\nALL OK\n');
  process.exit(0);
} else {
  process.stdout.write(`\n${failures} FAILURE(S) — embedded GH scripts have drifted from canonical files.\n`);
  process.stdout.write('Update grasshopper/builder/meshcraft_builder.py NOISE_SCRIPT/PRESETS_SCRIPT to match\n');
  process.stdout.write('the canonical files in grasshopper/components/ (or vice versa) before merging.\n');
  process.exit(1);
}
