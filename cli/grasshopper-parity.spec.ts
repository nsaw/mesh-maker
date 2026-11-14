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
import { execFileSync } from 'node:child_process';
import { CNC_PRESETS } from '../src/noise/presets';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve the repo root via the platform-correct path API. `URL.pathname` returns
// posix-style paths on Windows (e.g. `/C:/Users/...`) and string-concatenating breaks
// when the repo path contains spaces or special characters. fileURLToPath + path.resolve
// produce a native path that works on macOS, Linux, and Windows.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

/** Print n lines of context around `i`, marking the divergence row with `>`.
 *  Marker position is computed from the actual slice start so the `>` lands on the
 *  divergence even when `i < n` (slice gets clamped to 0 and the row index shifts). */
function ctx(lines: string[], i: number, n = 2): string {
  const start = Math.max(0, i - n);
  const marker = i - start;
  return lines
    .slice(start, i + n + 1)
    .map((l, k) => `      ${k === marker ? '>' : ' '} ${l}`)
    .join('\n');
}

const builderSrc = readFileSync(resolve(ROOT, 'grasshopper/builder/meshcraft_builder.py'), 'utf8');
const noiseGenSrc = readFileSync(resolve(ROOT, 'grasshopper/components/noise_gen.py'), 'utf8');
const presetsSrc = readFileSync(resolve(ROOT, 'grasshopper/components/presets.py'), 'utf8');

// Rhino 7 executes this file with Python 2, which requires an encoding cookie
// before parsing the Unicode comments and embedded component sources.
assert(/^#.*coding[:=]\s*utf-8/m.test(builderSrc.split('\n').slice(0, 2).join('\n')),
  'builder declares UTF-8 within its first two lines');

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
  process.stdout.write(`  FAIL identical after whitespace normalization (first divergence at line ${diffIdx})\n`);
  process.stdout.write(`    EMBEDDED (PRESETS_SCRIPT in meshcraft_builder.py):\n${ctx(aLines, diffIdx)}\n`);
  process.stdout.write(`    CANONICAL (presets.py):\n${ctx(bLines, diffIdx)}\n`);
  failures++;
}

// 4. ctx() marker placement — regression for the k === n bug at file boundaries.
process.stdout.write('4. ctx() marker placement\n');
{
  const lines = ['a', 'b', 'c', 'd', 'e'];
  // Divergence at index 0: slice = [0..2], marker should be at row 0 (`>` on 'a').
  const head = ctx(lines, 0, 2);
  assert(head.split('\n')[0].trimStart().startsWith('> a'), 'marker on first line when divergence at start');
  // Divergence at index 4 (last): slice = [2..4], marker should be at row 2 (`>` on 'e').
  const tail = ctx(lines, 4, 2);
  assert(tail.split('\n')[2].trimStart().startsWith('> e'), 'marker on last line when divergence at end');
  // Divergence in middle: slice = [1..3], marker at row 1 (`>` on 'c').
  const mid = ctx(lines, 2, 1);
  assert(mid.split('\n')[1].trimStart().startsWith('> c'), 'marker on center line when divergence in middle');
}

// Compare both runtime languages, rather than only the two Python copies.
process.stdout.write('5. TypeScript and Grasshopper preset values match\n');
{
  const json = execFileSync('python3', ['-I', '-c',
    'import ast,json,sys\nmodule=ast.parse(sys.stdin.read())\nassignment=next(n for n in module.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=="PRESETS" for t in n.targets))\nprint(json.dumps(ast.literal_eval(assignment.value)))',
  ], { input: presetsSrc, encoding: 'utf8' });
  const pythonPresets: Record<string, Record<string, string | number>> = JSON.parse(json);
  const aliases: Record<string, string> = {
    reliefRelaxIterations: 'relief_relax_iter', reliefBaseAmplitude: 'relief_base_amp',
    reliefBaseFrequency: 'relief_base_freq', warpFreq: 'relief_warp_freq',
    gaborBandwidth: 'gabor_bw',
  };
  const webOnly = new Set(['baseThickness']);
  const toPythonKey = (key: string): string => aliases[key]
    ?? key.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
  assert(Object.keys(pythonPresets).sort().join() === Object.keys(CNC_PRESETS).sort().join(),
    'same preset names in web and Grasshopper');
  for (const [name, preset] of Object.entries(CNC_PRESETS)) {
    const pythonPreset = pythonPresets[name];
    if (!pythonPreset) continue;
    for (const [key, value] of Object.entries(preset)) {
      if (webOnly.has(key)) continue;
      const actual = pythonPreset[toPythonKey(key)];
      const matches = typeof value === 'number' && typeof actual === 'number'
        ? Math.abs(actual - value) <= 1e-9 : actual === value;
      assert(matches, `${name}.${key}`, `web ${value}, Grasshopper ${actual}`);
    }
  }
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
