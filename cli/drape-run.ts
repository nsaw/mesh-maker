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
import { parseFigure, tiltFigure } from '../src/drape-sim/figure';
import { simulateCloth, SILK, type ClothParams } from '../src/drape-sim/cloth';
import { emptyDepth, rasterizeFrontmost, type DepthWindow } from '../src/drape-sim/raster';
import { gridTriangles, subdivideGrid } from '../src/drape-sim/subdiv';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (k: string): string | undefined => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const file = argv[0], out = get('--out');
  if (!file || !out) throw new Error('usage: drape-run FIGURE.mcfig --out DIR [--tilt DEG] [--param key=value ...]');
  const tilt = Number(get('--tilt') ?? 25);
  const params: ClothParams = { ...SILK };
  argv.forEach((a, i) => {
    if (a !== '--param') return;
    const [k, val] = argv[i + 1].split('=');
    if (!(k in params)) throw new Error(`unknown cloth parameter ${k}`);
    (params as unknown as Record<string, number>)[k] = Number(val);
  });
  mkdirSync(out, { recursive: true });
  const buf = readFileSync(file); const fig = parseFigure(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const figPos = tiltFigure(fig, tilt);
  const J = await initJolt();
  const res = simulateCloth(J, figPos, fig.triangles, params, f => { if (f % 20 === 0) process.stdout.write(`frame ${f}\n`); });
  let g = { rows: res.rows, cols: res.cols, pos: res.positions };
  g = subdivideGrid(subdivideGrid(g));
  const w: DepthWindow = { x0: -2.1, x1: 2.1, zTop: 1.2, zBottom: 1.2 - 4.2 * 16 / 12, cols: 1201, rows: 1601 };
  const bare = emptyDepth(w); rasterizeFrontmost(figPos, fig.triangles, w, bare);
  const veiled = bare.slice(), owner = new Uint8Array(w.cols * w.rows);
  rasterizeFrontmost(g.pos, gridTriangles(g.rows, g.cols), w, veiled, owner, 1);
  writeFileSync(join(out, 'veiled-depth.f32'), Buffer.from(new Float32Array(veiled).buffer));
  writeFileSync(join(out, 'bare-depth.f32'), Buffer.from(new Float32Array(bare).buffer));
  writeFileSync(join(out, 'cloth-front.u8'), Buffer.from(owner.buffer));
  writeFileSync(join(out, 'cloth.f32'), Buffer.from(new Float32Array(res.positions).buffer));
  const meta = { figure: file, tilt, params, window: w, seconds: res.seconds, lastFrameMotion: res.lastFrameMotion };
  writeFileSync(join(out, 'drape.json'), JSON.stringify(meta, null, 1));
  process.stdout.write(`${JSON.stringify({ seconds: res.seconds, lastFrameMotion: res.lastFrameMotion })}\n`);
}

main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exit(1); });
