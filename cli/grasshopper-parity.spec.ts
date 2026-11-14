/**
 * Parity check for embedded GhPython scripts in the builder.
 * Run: npm run test:gh-parity  (or: npx tsx cli/grasshopper-parity.spec.ts)
 *
 * `grasshopper/builder/meshcraft_builder.py` embeds NOISE_SCRIPT, PRESETS_SCRIPT, SHAPE_SCRIPT and SMOOTH_SCRIPT
 * as triple-quoted Python literals. These are hand-maintained mirrors of the
 * canonical standalone component files in `grasshopper/components/`.
 *
 * This spec extracts the embedded literals and asserts they share an identical
 * source with the standalone files after right-trimming lines and dropping
 * blank lines. Headers and comments remain part of the comparison. Drift between the two paths has caused round-2 through round-5
 * review findings — this guard catches it before review.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gaussianSmooth } from '../src/geometry';
import { CNC_PRESETS } from '../src/noise/presets';
import { DEFAULTS } from '../src/state';
import { sampleReliefParamsFromState, __sitesForTest, __siteCandidatesForTest } from '../src/noise/voronoi-relief';
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

// Smoothing and shaping are executable mirrors too. Input changes must not drift.
for (const [literal, file] of [['SMOOTH_SCRIPT', 'smoother.py'], ['SHAPE_SCRIPT', 'shape_pts.py']]) {
  const canonical = readFileSync(resolve(ROOT, 'grasshopper/components', file), 'utf8');
  assert(normalize(extractEmbedded(builderSrc, literal)) === normalize(canonical), `${literal} matches ${file}`);
}
for (const [cellSize,radialFalloff] of [[0.4,0.6],[0.4,0.2],[0.2,0.15]]) {
  const p = {...sampleReliefParamsFromState(2,4,36,24,5,DEFAULTS),cellSize,relaxIterations:0,
    radialFoci:[{x:0.1,y:0.1},{x:0.9,y:0.9},{x:0.5,y:0.5}],radialFalloff,
    radialStrength:0,radialGrow:0,radialWarp:0,radialMode:radialFalloff===0.6?'rays' as const:'rings' as const};
  // Execute only class definitions; Grasshopper host inputs and output marshalling stay native gates.
  const python = `import ast,json,math,sys
payload=json.loads(sys.stdin.read())
module=ast.parse(payload["source"])
module.body=[node for node in module.body if isinstance(node,ast.ClassDef)]
scope={"math":math}
exec(compile(module,"noise_gen.py","exec"),scope)
p=payload["params"]
gen=scope["VoronoiReliefNoise"](5)
foci=[[f[0]*36,f[1]*24] for f in p["radial_foci"]]
zone=p["radial_falloff"]*math.hypot(36,24)
gen._check_site_work(3,zone,p["cell_size"],0,0,36,24)
cart=gen._gen_sites(p,None,foci,zone*0.9,None)
sites=list(cart)
nuclei=gen._gen_polar_sites(foci,zone,p["cell_size"],0,0,0,p["radial_mode"],36,24,sites)
assert len(cart)==payload["cartesianCount"]
assert len(sites)==payload["candidateCount"]
selected=gen._representative_indices(len(sites),gen.SITE_COUNT_MAX,nuclei)
sites=[sites[i] for i in selected]
assert len(sites)==4096
for dims in [(0.1,0.1),(36,24),(80,80)]:
    for count in [0,3]:
        gen._check_site_work(count,0.6*math.hypot(*dims) if count else 0,0.2,4,0,*dims)
for dims in [(1e6,24),(1e308,1e308),(float("inf"),24)]:
    try: gen._check_site_work(3,0.6*math.hypot(*dims),0.4,0,0,*dims)
    except ValueError as error: assert str(error)=="Relief site enumeration exceeds supported work budget"
    else: raise AssertionError("excessive direct inputs accepted")
for cell in [float("nan"),float("inf")]:
    try: gen._check_site_work(3,zone,cell,0,0,36,24)
    except ValueError as error: assert str(error)=="Relief site enumeration exceeds supported work budget"
    else: raise AssertionError("non-finite cell accepted")
print(json.dumps([[s[0],s[1]] for s in sites]))`;
  const aliases: Record<string,string> = {relaxIterations:'relax_iter',baseAmplitude:'base_amp',baseFrequency:'base_freq'};
  const pyParams = Object.fromEntries(Object.entries(p).map(([key,value]) => [
    aliases[key] ?? key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),
    key === 'radialFoci' ? p.radialFoci.map(f=>[f.x,f.y]) : value,
  ]));
  const raw = __siteCandidatesForTest(p,false);
  const sites: number[][] = JSON.parse(execFileSync('python3',['-I','-c',python],{
    input:JSON.stringify({source:noiseGenSrc,params:pyParams,cartesianCount:raw.cartesianCount,candidateCount:raw.sites.length}),encoding:'utf8',
  }));
  const web = __sitesForTest(p,false);
  assert(sites.length === web.length && sites.every(([x,y],i)=>Math.abs(x-web[i].x)<=1e-12 && Math.abs(y-web[i].y)<=1e-12),
    'global capped mixed/polar site selection and order match Python within numeric roundoff');
}

{
  const p = {...sampleReliefParamsFromState(2,4,36,24,5,DEFAULTS),cellSize:0.4};
  const aliases: Record<string,string> = {relaxIterations:'relax_iter',baseAmplitude:'base_amp',baseFrequency:'base_freq'};
  const params = Object.fromEntries(Object.entries(p).map(([key,value]) => [
    aliases[key] ?? key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),key==='radialFoci'?[]:value,
  ]));
  const python = `import ast,json,math,sys
payload=json.loads(sys.stdin.read())
module=ast.parse(payload["source"])
module.body=[node for node in module.body if isinstance(node,ast.ClassDef)]
scope={"math":math}
exec(compile(module,"noise_gen.py","exec"),scope)
for foci in [[],[[.1,.1],[.9,.9],[.5,.5]]]:
    for bad in [dict(mesh_x=1e6),dict(mesh_x=1000,mesh_y=1000),dict(mesh_x=1e308,mesh_y=1e308),
                dict(mesh_x=float("nan")),dict(mesh_x=float("inf")),dict(mesh_x=0),dict(mesh_y=-1),
                dict(cell_size=float("nan")),dict(cell_size=float("inf")),dict(cell_size=0),dict(cell_size=-1)]:
        p=dict(payload["params"],radial_foci=foci,radial_falloff=.02)
        p.update(bad)
        try: scope["VoronoiReliefNoise"](5).sample_grid(p)
        except ValueError as error: assert str(error)=="Relief site enumeration exceeds supported work budget"
        else: raise AssertionError("unbounded site work accepted")
p=dict(payload["params"],mesh_x=120,mesh_y=120,cell_size=.2,radial_foci=[[.1,.1],[.9,.9],[.5,.5]],
       radial_falloff=.6,radial_strength=4,radial_grow=0)
try: scope["VoronoiReliefNoise"](5).sample_grid(p)
except ValueError as error: assert str(error)=="Relief site enumeration exceeds supported work budget"
else: raise AssertionError("combined site work budget bypassed")`;
  execFileSync('python3',['-I','-c',python],{input:JSON.stringify({source:noiseGenSrc,params}),encoding:'utf8',timeout:3000});
}

for (const [cols,rows,width,height,sigma,constant] of [[9,11,4,10,0.7],[71,65,1,4,0.7],[66,64,3,1,0.5],
  [75,5,1,2,0.2],[5,75,2,1,0.2],[39,41,1,2,0],
  [67,65,1,3,1,0],[67,65,1,3,1,7],[67,65,1,3,1,1e12]]) {
  const grid = Array.from({length: rows}, (_, j) => Array.from({length: cols}, (_, i) => constant ?? Math.sin(i * 1.3 + j * 0.7)));
  const smoother = readFileSync(resolve(ROOT, 'grasshopper/components/smoother.py'), 'utf8');
  // This host exercises only the pure convolution. Native Point3d marshalling remains a Rhino gate.
  const python = `import json,math,sys,types
class Point:
    def __init__(self,x,y,z): self.X=x; self.Y=y; self.Z=z
rhino=types.ModuleType("Rhino")
geometry=types.ModuleType("Rhino.Geometry")
geometry.Point3d=Point
rhino.Geometry=geometry
sys.modules["Rhino"]=rhino
sys.modules["Rhino.Geometry"]=geometry
payload=json.loads(sys.stdin.read())
cols=payload["cols"]; rows=payload["rows"]
pts=[Point(i*payload["width"]/(cols-1),j*payload["height"]/(rows-1),payload["grid"][j][i]) for j in range(rows) for i in range(cols)]
scope={"pts":pts,"cols":cols,"rows":rows,"smooth_radius_in":payload["sigma"]}
exec(compile(payload["source"],"smoother.py","exec"),scope)
print(json.dumps([p.Z for p in scope["pts"]]))`;
  const flat: number[] = JSON.parse(execFileSync('python3', ['-I', '-c', python], {
    input: JSON.stringify({cols,rows,width,height,sigma,grid,source:smoother}), encoding:'utf8',
  }));
  const web = gaussianSmooth(grid,rows,cols,width,height,sigma).flat();
  assert(flat.length === web.length && flat.every((z,i) => Math.abs(z-web[i]) <= 1e-12),
    'Gaussian convolution matches Python at edges and unequal X/Y pitches');
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
