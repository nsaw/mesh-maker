/**
 * Run the browser drape solver (src/drape-sim) in Node on a figure and write the same arrays the Blender
 * proof's extraction writes (scripts/drape/blender_drape.py), for parity comparison.
 *
 *   npm run drape-run -- FIGURE.mcfig --out DIR [--tilt 25] [--param key=value ...]
 *
 * Writes DIR/veiled-depth.f32, bare-depth.f32 (float32, NaN = no hit, rows top-down), cloth-front.u8,
 * cloth.f32 (simulated node positions) and drape.json. Window: x -2.1..2.1, z 1.2 down 5.6 (12 x 16 aspect),
 * 1201 x 1601 nodes, as in the Blender proof.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import initJolt from 'jolt-physics/wasm-compat';
import { parseFigure } from '../src/drape-sim/figure';
import { SILK, type ClothParams } from '../src/drape-sim/cloth';
import { drapeFigure, PANEL_WINDOW } from '../src/drape-sim/pipeline';

const USAGE = 'usage: drape-run FIGURE.mcfig --out DIR [--tilt DEG] [--param key=value ...]';

/** A finite number, or an error naming the flag it came from. */
function finite(text: string, what: string): number {
  const v = Number(text);
  if (text.trim() === '' || !Number.isFinite(v)) throw new Error(`${what} must be a finite number, got ${JSON.stringify(text)}`);
  return v;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  /** The operand after argv[i]; a flag present without one is an error, never read as absent. */
  const operand = (i: number): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${argv[i]} needs a value. ${USAGE}`);
    return v;
  };
  const get = (flag: string): string | undefined => { const i = argv.indexOf(flag); return i < 0 ? undefined : operand(i); };
  const file = argv[0], out = get('--out');
  if (!file || file.startsWith('--') || !out) throw new Error(USAGE);
  const tiltText = get('--tilt');
  const tilt = tiltText === undefined ? 25 : finite(tiltText, '--tilt');
  const params: ClothParams = { ...SILK };
  argv.forEach((a, i) => {
    if (a !== '--param') return;
    const kv = operand(i), eq = kv.indexOf('=');
    if (eq <= 0) throw new Error(`--param needs key=value, got ${JSON.stringify(kv)}`);
    const k = kv.slice(0, eq);
    if (!Object.hasOwn(params, k)) throw new Error(`unknown cloth parameter ${k}`);
    (params as unknown as Record<string, number>)[k] = finite(kv.slice(eq + 1), `--param ${k}`);
  });
  mkdirSync(out, { recursive: true });
  const buf = readFileSync(file); const fig = parseFigure(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const J = await initJolt();
  // The same pipeline the Drape tab runs (src/drape-sim/pipeline.ts): tilt, cloth, smoothing, extraction.
  const run = drapeFigure(J, fig, tilt, params, f => { if (f % 20 === 0) process.stdout.write(`frame ${f}\n`); });
  writeFileSync(join(out, 'veiled-depth.f32'), Buffer.from(new Float32Array(run.veiled).buffer));
  writeFileSync(join(out, 'bare-depth.f32'), Buffer.from(new Float32Array(run.bare).buffer));
  writeFileSync(join(out, 'cloth-front.u8'), Buffer.from(run.relief.veil.buffer));
  writeFileSync(join(out, 'cloth.f32'), Buffer.from(new Float32Array(run.cloth).buffer));
  const meta = { figure: file, tilt, params, window: PANEL_WINDOW, seconds: run.seconds, lastFrameMotion: run.lastFrameMotion };
  writeFileSync(join(out, 'drape.json'), JSON.stringify(meta, null, 1));
  process.stdout.write(`${JSON.stringify({ seconds: run.seconds, lastFrameMotion: run.lastFrameMotion })}\n`);
}

main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exit(1); });
