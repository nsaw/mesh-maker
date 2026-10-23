/**
 * Run the browser drape solver (src/drape-sim) in Node on a figure and write the same arrays the Blender
 * proof's extraction writes (scripts/drape/blender_drape.py), for parity comparison.
 *
 *   npm run drape-run -- FIGURE.mcfig --out DIR [--preset silk|gathered] [--tilt 25] [--turn 0] [--lean 0] [--scale 100]
 *     [--param key=value]...  (one --param per pair; keys are the ClothParams in src/drape-sim/cloth.ts)
 *
 * Writes DIR/veiled-depth.f32, bare-depth.f32 (float32, NaN = no hit, rows top-down), cloth-front.u8,
 * cloth.f32 (simulated node positions) and drape.json. Window: x -2.1..2.1, z 1.2 down 5.6 (12 x 16 aspect),
 * 1201 x 1601 nodes, as in the Blender proof.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import initJolt from 'jolt-physics/wasm-compat';
import { parseFigure } from '../src/drape-sim/figure';
import { SILK, SILK_GATHERED, type ClothParams } from '../src/drape-sim/cloth';
import { drapeFigure, PANEL_WINDOW } from '../src/drape-sim/pipeline';
import { DRAPE_CONTROLS } from '../src/drape-controls';

const USAGE = 'usage: drape-run FIGURE.mcfig --out DIR [--preset silk|gathered] [--tilt DEG] [--turn DEG] [--lean DEG] [--scale PERCENT] [--param key=value] ...';
const PRESETS: Record<string, ClothParams> = { silk: SILK, gathered: SILK_GATHERED };
const SINGLE = ['--out', '--preset', '--tilt', '--turn', '--lean', '--scale'];

/** A finite number, or an error naming the flag it came from. */
function finite(text: string, what: string): number {
  const v = Number(text);
  if (text.trim() === '' || !Number.isFinite(v)) throw new Error(`${what} must be a finite number, got ${JSON.stringify(text)}`);
  return v;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const file = argv[0];
  if (!file || file.startsWith('--')) throw new Error(USAGE);
  // Every token after the figure is a flag followed by its operand; anything else is an error, so a
  // misspelt flag or a second key=value after one --param never runs silently with defaults.
  const one = new Map<string, string>();
  const pairs: string[] = [];
  for (let i = 1; i < argv.length; i += 2) {
    const flag = argv[i], v = argv[i + 1];
    if (flag !== '--param' && !SINGLE.includes(flag)) throw new Error(`unexpected argument ${JSON.stringify(flag)}. ${USAGE}`);
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value. ${USAGE}`);
    if (flag === '--param') pairs.push(v);
    else if (one.has(flag)) throw new Error(`${flag} given twice`);
    else one.set(flag, v);
  }
  const out = one.get('--out');
  if (!out) throw new Error(USAGE);
  const presetName = one.get('--preset') ?? 'silk';
  if (!Object.hasOwn(PRESETS, presetName)) throw new Error(`unknown preset ${JSON.stringify(presetName)} (silk or gathered)`);
  const angle = (flag: string, def: number): number => { const t = one.get(flag); return t === undefined ? def : finite(t, flag); };
  // --scale is the Drape tab's Figure Size, percent about the crown (100 = as placed).
  const pose = { tiltDeg: angle('--tilt', 25), turnDeg: angle('--turn', 0), leanDeg: angle('--lean', 0), scale: angle('--scale', 100) / 100 };
  // The Drape tab's range: far past it Jolt spends unbounded time building the figure's shape.
  const size = DRAPE_CONTROLS.find(c => c.key === 'drapeFigureScale')!;
  if (!(pose.scale * 100 >= size.min && pose.scale * 100 <= size.max)) throw new Error(`--scale must be ${size.min} to ${size.max} (percent)`);
  const params: ClothParams = { ...PRESETS[presetName] };
  for (const kv of pairs) {
    const eq = kv.indexOf('=');
    if (eq <= 0) throw new Error(`--param needs key=value, got ${JSON.stringify(kv)}`);
    const k = kv.slice(0, eq);
    if (!Object.hasOwn(params, k)) throw new Error(`unknown cloth parameter ${k}`);
    (params as unknown as Record<string, number>)[k] = finite(kv.slice(eq + 1), `--param ${k}`);
  }
  mkdirSync(out, { recursive: true });
  const buf = readFileSync(file); const fig = parseFigure(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const J = await initJolt();
  // The same pipeline the Drape tab runs (src/drape-sim/pipeline.ts): tilt, cloth, smoothing, extraction.
  const run = drapeFigure(J, fig, pose, params, f => { if (f % 20 === 0) process.stdout.write(`frame ${f}\n`); });
  writeFileSync(join(out, 'veiled-depth.f32'), Buffer.from(new Float32Array(run.veiled).buffer));
  writeFileSync(join(out, 'bare-depth.f32'), Buffer.from(new Float32Array(run.bare).buffer));
  writeFileSync(join(out, 'cloth-front.u8'), Buffer.from(run.relief.veil.buffer));
  writeFileSync(join(out, 'cloth.f32'), Buffer.from(new Float32Array(run.cloth).buffer));
  const meta = { figure: file, preset: presetName, pose, params, window: PANEL_WINDOW, seconds: run.seconds, lastFrameMotion: run.lastFrameMotion };
  writeFileSync(join(out, 'drape.json'), JSON.stringify(meta, null, 1));
  process.stdout.write(`${JSON.stringify({ seconds: run.seconds, lastFrameMotion: run.lastFrameMotion })}\n`);
}

main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exit(1); });
