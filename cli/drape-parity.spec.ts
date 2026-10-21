/**
 * Parity of the web drape (src/drape-sim, Jolt) with the Blender drapes of the bundled Venus bust at
 * tilt 25 deg: the silk proof accepted on 2026-10-20 (frame 100, cli/fixtures/drape-silk-tilt25) and
 * the gathered silk of the 2026-10-21 study (surface attraction, frame 120,
 * cli/fixtures/drape-silk-gathered). Each reference is every 4th node of the Blender extraction; its
 * provenance and Blender's own variation are in its reference.json.
 * Run: npm run test:drape-parity  (about 2.5 min: two full cloth simulations)
 *
 * Gates come from Blender's own variation on the same drape, not from what the web run happens to
 * reach. Silk: frame 100 vs frame 400 keeps veil footprint IoU 0.87; Blender variants keep the fold
 * wavelength within +11%. Gathered: the veil is still sliding at frame 120 (frame 150 keeps IoU 0.67
 * and has 1.47x the veil area), so its footprint gate is that IoU. Its area gate (25%) is tighter than
 * that drift and was checked for what it rejects (drape-run probes, 2026-10-21): the calibrated run
 * scores IoU 0.786 / area 1.18 and passes; half the attraction (0.717 / 1.34), the attraction ramped in
 * 35 frames late (0.685 / 1.39), a quarter of it (0.62 / 1.57) and none (0.53 / 1.75) all fail. Fold
 * positions are chaotic (Blender moves them with thread count), so pointwise depth differences are
 * reported, not gated.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import initJolt from 'jolt-physics/wasm-compat';
import { parseFigure } from '../src/drape-sim/figure';
import { SILK, SILK_GATHERED, type ClothParams } from '../src/drape-sim/cloth';
import { drapeFigure, PANEL_WINDOW } from '../src/drape-sim/pipeline';

const STRIDE = 4, UNITS_PER_MM = 8 / 1000;
const ROWS = Math.ceil(PANEL_WINDOW.rows / STRIDE), COLS = Math.ceil(PANEL_WINDOW.cols / STRIDE);

let failures = 0;
function assert(condition: boolean, label: string, detail = ''): void {
  if (condition) process.stdout.write(`  ok  ${label}${detail ? ` (${detail})` : ''}\n`);
  else { process.stdout.write(`  FAIL ${label}${detail ? `: ${detail}` : ''}\n`); failures++; }
}
const f32 = (dir: string, name: string): Float32Array => { const b = gunzipSync(readFileSync(`${dir}/${name}`)); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const u8 = (dir: string, name: string): Uint8Array => new Uint8Array(gunzipSync(readFileSync(`${dir}/${name}`)));
function strided<T extends Float64Array | Uint8Array>(a: T, make: (n: number) => T): T {
  const out = make(ROWS * COLS);
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) out[j * COLS + i] = a[(j * STRIDE) * PANEL_WINDOW.cols + i * STRIDE];
  return out;
}
const pct = (v: number[], p: number): number => { const s = v.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/** Power-weighted mean wavelength of the veil's folds along horizontal rows, mm (high-pass: minus a
 *  12 mm running mean, Hann window), the same measure used during calibration. */
function foldWavelengthMm(d: ArrayLike<number>, veil: ArrayLike<number>): number {
  const cell = (PANEL_WINDOW.x1 - PANEL_WINDOW.x0) / (PANEL_WINDOW.cols - 1) * STRIDE, k = Math.round(27 / STRIDE) | 1;
  let num = 0, den = 0;
  for (let j = Math.round(300 / STRIDE); j < Math.round(1100 / STRIDE); j += Math.round(20 / STRIDE)) {
    let i0 = -1, i1 = -1, cnt = 0;
    for (let i = 0; i < COLS; i++) if (veil[j * COLS + i]) { if (i0 < 0) i0 = i; i1 = i; cnt++; }
    if (cnt < 200 / STRIDE) continue;
    const seg: number[] = []; let mean = 0, m = 0;
    for (let i = i0; i < i1; i++) { const v = d[j * COLS + i]; if (Number.isFinite(v)) { mean += v; m++; } }
    mean /= m;
    for (let i = i0; i < i1; i++) { const v = d[j * COLS + i]; seg.push(Number.isFinite(v) ? v : mean); }
    const n = seg.length, hp = seg.map((v, i) => {
      let s = 0, c = 0; for (let q = Math.max(0, i - (k >> 1)); q <= Math.min(n - 1, i + (k >> 1)); q++) { s += seg[q]; c++; }
      return (v - s / c) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    });
    for (let f = 1; f <= n / 2; f++) {
      let re = 0, im = 0; for (let i = 0; i < n; i++) { const a = (-2 * Math.PI * f * i) / n; re += hp[i] * Math.cos(a); im += hp[i] * Math.sin(a); }
      const P = re * re + im * im, freq = f / (n * cell);                 // cycles per scene unit
      num += P / freq; den += P;
    }
  }
  return num / den / UNITS_PER_MM;
}

interface Case { name: string; dir: string; params: ClothParams; minIou: number; iouWhy: string; maxAreaDev: number }

const CASES: Case[] = [
  { name: 'silk (proof, frame 100)', dir: 'cli/fixtures/drape-silk-tilt25', params: SILK, minIou: 0.87,
    iouWhy: "Blender's own frame 100 vs frame 400 (0.87)", maxAreaDev: 0.1 },
  { name: 'gathered silk (study, frame 120)', dir: 'cli/fixtures/drape-silk-gathered', params: SILK_GATHERED, minIou: 0.67,
    iouWhy: "Blender's own frame 120 vs frame 150 (0.67)", maxAreaDev: 0.25 },
];

async function runCase(J: Awaited<ReturnType<typeof initJolt>>, fig: ReturnType<typeof parseFigure>, c: Case): Promise<void> {
  process.stdout.write(`\n== ${c.name}\n`);
  const ref = { veiled: f32(c.dir, 'veiled-depth.f32.gz'), bare: f32(c.dir, 'bare-depth.f32.gz'), veil: u8(c.dir, 'veil.u8.gz') };
  if (ref.veiled.length !== ROWS * COLS) throw new Error('reference size does not match the panel');
  const run = drapeFigure(J, fig, { tiltDeg: 25, turnDeg: 0, leanDeg: 0 }, c.params, f => { if (f % 25 === 0) process.stdout.write(`  frame ${f}\n`); });
  const web = { veiled: strided(run.veiled, n => new Float64Array(n)), bare: strided(run.bare, n => new Float64Array(n)), veil: strided(run.relief.veil, n => new Uint8Array(n)) };
  process.stdout.write(`drape: ${run.seconds.toFixed(1)} s, last-frame motion ${run.lastFrameMotion.toFixed(4)} units\n`);

  let both = 0, either = 0, refArea = 0, webArea = 0;
  const signed: number[] = [], abs: number[] = [], bareDiff: number[] = [];
  for (let k = 0; k < ROWS * COLS; k++) {
    const a = ref.veil[k] === 1, w = web.veil[k] === 1;
    if (a) refArea++; if (w) webArea++; if (a || w) either++;
    if (a && w) { both++; const d = (web.veiled[k] - ref.veiled[k]) / UNITS_PER_MM; signed.push(d); abs.push(Math.abs(d)); }
    if (Number.isFinite(ref.bare[k]) && Number.isFinite(web.bare[k])) bareDiff.push(Math.abs(web.bare[k] - ref.bare[k]) / UNITS_PER_MM);
  }
  const iou = both / either, area = webArea / refArea, bias = pct(signed, 0.5);
  const wlRef = foldWavelengthMm(ref.veiled, ref.veil), wlWeb = foldWavelengthMm(web.veiled, web.veil);

  process.stdout.write('P1 same figure, same placement\n');
  assert(pct(bareDiff, 0.99) < 0.05, 'the bare figure matches the Blender extraction', `p99 ${pct(bareDiff, 0.99).toFixed(4)} mm`);
  process.stdout.write('P2 same drape\n');
  assert(iou >= c.minIou, `veil footprint IoU at least ${c.iouWhy}`, iou.toFixed(4));
  assert(Math.abs(area - 1) <= c.maxAreaDev, `veil area within ${Math.round(c.maxAreaDev * 100)}%`, `web / Blender ${area.toFixed(3)}`);
  assert(Math.abs(bias) <= 2, 'no depth bias where both have veil (median within 2 mm)', `${bias.toFixed(2)} mm`);
  assert(wlWeb / wlRef >= 0.85 && wlWeb / wlRef <= 1.15, 'fold wavelength within 15% (Blender variants: up to +11%)',
    `web ${wlWeb.toFixed(1)} mm, Blender ${wlRef.toFixed(1)} mm`);
  process.stdout.write(`  report: pointwise |depth| difference p50 ${pct(abs, 0.5).toFixed(2)} mm, p90 ${pct(abs, 0.9).toFixed(2)} mm; fold positions differ\n`);
}

async function main(): Promise<void> {
  const b = readFileSync('public/demo/venus-de-milo.mcfig');
  const fig = parseFigure(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const J = await initJolt();
  for (const c of CASES) await runCase(J, fig, c);
  process.stdout.write(failures ? `\n${failures} FAILURE(S)\n` : '\nALL OK\n');
  process.exit(failures ? 1 : 0);
}

main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exit(1); });
