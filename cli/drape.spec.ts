/**
 * Fast checks of the DRAPE pipeline (src/drape-sim): figure container, tilt geometry, frontmost
 * extraction, cloth smoothing, relief mapping, and a short cloth run. The full parity run against the
 * Blender proof is cli/drape-parity.spec.ts.
 * Run: npm run test:drape  (or: npx tsx cli/drape.spec.ts)
 */
import { readFileSync } from 'node:fs';
import initJolt from 'jolt-physics/wasm-compat';
import { encodeFigure, figureFromMesh, parseFigure, tiltFigure, type Figure } from '../src/drape-sim/figure';
import { emptyDepth, rasterizeFrontmost, type DepthWindow } from '../src/drape-sim/raster';
import { gridTriangles, subdivideGrid } from '../src/drape-sim/subdiv';
import { bareDepth, PANEL_WINDOW, RELIEF_BACKING_IN, RELIEF_SPAN_IN, reliefHeights } from '../src/drape-sim/pipeline';
import { simulateCloth, SILK } from '../src/drape-sim/cloth';

let failures = 0;
function assert(condition: boolean, label: string, detail = ''): void {
  if (condition) process.stdout.write(`  ok  ${label}${detail ? ` (${detail})` : ''}\n`);
  else { process.stdout.write(`  FAIL ${label}${detail ? `: ${detail}` : ''}\n`); failures++; }
}
const throws = (f: () => unknown): boolean => { try { f(); return false; } catch { return true; } };
const fileBuffer = (path: string): ArrayBuffer => { const b = readFileSync(path); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

async function main(): Promise<void> {
  // ---------- D1 figure container ----------
  process.stdout.write('D1 figure container\n');
  const demoBuf = fileBuffer('public/demo/venus-de-milo.mcfig');
  const demo = parseFigure(demoBuf);
  assert(demo.header.vertices === demo.positions.length / 3 && demo.header.triangles === demo.triangles.length / 3,
    'the bundled Venus parses with consistent counts', `${demo.header.vertices} vertices, ${demo.header.triangles} triangles`);
  assert(demo.header.license === 'CC0', 'the bundled figure is CC0');
  const re = parseFigure(encodeFigure(demo));
  assert(re.positions.every((v, i) => v === demo.positions[i]) && re.triangles.every((v, i) => v === demo.triangles[i]),
    'encodeFigure round-trips the bundled figure exactly');
  const bad = new Uint8Array(demoBuf.slice(0)); bad[0] = 88;
  assert(throws(() => parseFigure(bad.buffer)), 'a wrong signature is rejected');
  assert(throws(() => parseFigure(demoBuf.slice(0, demoBuf.byteLength - 4))), 'a truncated file is rejected');
  const tiny: Figure = { header: { format: 'meshcraft-figure', version: 1, vertices: 3, triangles: 1, head_centre: [0, 0, 0], head_height: 2.6 },
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), triangles: new Uint32Array([0, 1, 5]) };
  assert(throws(() => parseFigure(encodeFigure(tiny))), 'a triangle index past the vertex count is rejected');
  tiny.triangles = new Uint32Array([0, 1, 2]); tiny.positions[4] = NaN;
  assert(throws(() => parseFigure(encodeFigure(tiny))), 'a non-finite position is rejected');

  // ---------- D2 tilt ----------
  process.stdout.write('D2 tilt geometry\n');
  {
    const p0 = tiltFigure(demo, 0);
    let d = 0; for (let i = 0; i < p0.length; i++) d = Math.max(d, Math.abs(p0[i] - demo.positions[i]));
    assert(d < 1e-6, 'tilt 0 leaves the placed figure unchanged', `max ${d.toExponential(2)}`);
    // A face point in front of the head centre rises when the face tips back (looks up).
    const [hx, hy, hz] = [0, 0, 0];
    const probe: Figure = { header: { format: 'meshcraft-figure', version: 1, vertices: 2, triangles: 0, head_centre: [hx, hy, hz], head_height: 2.6 },
      positions: new Float32Array([0, 0, 1, 0, -1, 0]), triangles: new Uint32Array(0) };
    const p = tiltFigure(probe, 25);
    // Crown (0, 0, 1) and face point (0, -1, 0) about the head centre at the origin. After tipping
    // back by t the crown sits at (0, sin t, cos t) and the face point at (0, -cos t, sin t), so
    // relative to the crown the face rises by sin t + 1 - cos t and moves forward by sin t + cos t - 1.
    const t = 25 * Math.PI / 180;
    const rise = (p[5] - p[2]) - (0 - 1), forward = (p[1] - p[4]) - (0 - -1);
    assert(Math.abs(rise - (Math.sin(t) + 1 - Math.cos(t))) < 1e-6 && Math.abs(forward - (Math.sin(t) + Math.cos(t) - 1)) < 1e-6,
      'tipping back 25 deg raises the face and moves the crown back by the exact rotation', `rise ${rise.toFixed(4)}, forward ${forward.toFixed(4)}`);
    let top = -Infinity; const t25 = tiltFigure(demo, 25); for (let i = 2; i < t25.length; i += 3) top = Math.max(top, t25[i]);
    assert(Math.abs(top - 1) < 1e-6, 'the tilted figure keeps its crown at z = 1');
  }

  // ---------- D3 frontmost extraction ----------
  process.stdout.write('D3 frontmost extraction matches a brute-force ray cast\n');
  {
    let s = 7; const rnd = (): number => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
    const n = 40, pos = new Float32Array(n * 9), tris = new Uint32Array(n * 3);
    for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) {
      pos.set([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1], (t * 3 + v) * 3); tris[t * 3 + v] = t * 3 + v;
    }
    const w: DepthWindow = { x0: -1, x1: 1, zTop: 1, zBottom: -1, cols: 61, rows: 57 };
    const got = emptyDepth(w); rasterizeFrontmost(pos, tris, w, got);
    let worst = 0, nanMismatch = 0;
    for (let j = 0; j < w.rows; j++) for (let i = 0; i < w.cols; i++) {
      const x = w.x0 + i * (w.x1 - w.x0) / (w.cols - 1), z = w.zTop - j * (w.zTop - w.zBottom) / (w.rows - 1);
      let best = NaN;
      for (let t = 0; t < n; t++) {
        const a = t * 9;
        const ax = pos[a], ay = pos[a + 1], az = pos[a + 2], bx = pos[a + 3], by = pos[a + 4], bz = pos[a + 5], cx = pos[a + 6], cy = pos[a + 7], cz = pos[a + 8];
        const det = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
        if (det === 0) continue;
        const l1 = ((x - ax) * (cz - az) - (cx - ax) * (z - az)) / det, l2 = ((bx - ax) * (z - az) - (x - ax) * (bz - az)) / det, l0 = 1 - l1 - l2;
        if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
        const d = -(l0 * ay + l1 * by + l2 * cy);
        if (!(best >= d)) best = d;
      }
      const g = got[j * w.cols + i];
      if (Number.isNaN(g) !== Number.isNaN(best)) nanMismatch++; else if (!Number.isNaN(g)) worst = Math.max(worst, Math.abs(g - best));
    }
    assert(nanMismatch === 0 && worst < 1e-6, 'every node equals the frontmost ray hit', `max diff ${worst.toExponential(2)}, coverage mismatches ${nanMismatch}`);
  }

  // ---------- D4 smoothing ----------
  process.stdout.write('D4 cloth smoothing\n');
  {
    const rows = 6, cols = 9, pos = new Float64Array(rows * cols * 3);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) pos.set([i * 0.3 + j * 0.1, 0.2 * i - 0.5 * j + 1, j * 0.25], (j * cols + i) * 3);
    const g = subdivideGrid({ rows, cols, pos });
    let d = 0;
    for (let J = 0; J < g.rows; J++) for (let I = 0; I < g.cols; I++) {
      const i = I / 2, j = J / 2, e = [i * 0.3 + j * 0.1, 0.2 * i - 0.5 * j + 1, j * 0.25];
      for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(g.pos[(J * g.cols + I) * 3 + k] - e[k]));
    }
    assert(g.rows === 2 * rows - 1 && g.cols === 2 * cols - 1 && d < 1e-12, 'a flat affine grid subdivides onto itself', `max ${d.toExponential(2)}`);
    assert(gridTriangles(3, 4).length === 2 * 3 * 2 * 3, 'two triangles per cell');
  }

  // ---------- D5 relief mapping on the bundled figure ----------
  process.stdout.write('D5 bare relief of the bundled bust\n');
  {
    const pos = tiltFigure(demo, 25), bare = bareDepth(pos, demo.triangles);
    const r = reliefHeights(bare, bare), IN = 0.0254;
    let lo = Infinity, hi = -Infinity, bgOk = true, fg = 0;
    for (let k = 0; k < r.heightsM.length; k++) {
      lo = Math.min(lo, r.heightsM[k]); hi = Math.max(hi, r.heightsM[k]);
      if (r.mask[k]) fg++; else if (r.heightsM[k] !== Math.fround(RELIEF_BACKING_IN * IN)) bgOk = false;
    }
    assert(Math.abs(lo - RELIEF_BACKING_IN * IN) < 1e-9 && Math.abs(hi - (RELIEF_BACKING_IN + RELIEF_SPAN_IN) * IN) < 1e-7 && bgOk,
      'heights span exactly backing to stock, background at the backing', `${(lo / IN).toFixed(4)} to ${(hi / IN).toFixed(4)} in`);
    // The crown (z = 1) is the highest foreground row: row (1.2 - 1) / 5.6 x 1600 = 57.
    let firstRow = -1;
    for (let j = 0; j < PANEL_WINDOW.rows && firstRow < 0; j++) for (let i = 0; i < PANEL_WINDOW.cols; i++) if (r.mask[j * PANEL_WINDOW.cols + i]) { firstRow = j; break; }
    assert(Math.abs(firstRow - 57) <= 1, 'the crown is the top of the figure in the panel (upright, not upside down)', `first foreground row ${firstRow}`);
    assert(fg / r.mask.length > 0.4 && fg / r.mask.length < 0.9, 'the bust fills a plausible share of the panel', `${(100 * fg / r.mask.length).toFixed(1)}%`);
  }

  // ---------- D6 uploaded mesh placement ----------
  process.stdout.write('D6 uploaded mesh placement\n');
  {
    // A 300 mm tall Y-up box whose front (+Z, glTF convention) must end up facing the viewer (-Y).
    const p = new Float32Array([-100, 0, 50, 100, 0, 50, 0, 300, 50, 0, 0, -50]);
    const f = figureFromMesh(p, [0, 1, 2, 0, 2, 3], { metresPerUnit: 0.001, up: 'y', turnDeg: 0, name: 'box' });
    const ys = [f.positions[1], f.positions[4], f.positions[10]];
    assert(Math.abs(f.positions[8] - 1) < 1e-6, 'the highest point becomes the crown at z = 1');
    assert(ys[0] < ys[2] && ys[1] < ys[2], 'a Y-up model\'s front (+Z) faces the viewer (-Y)', ys.map(v => v.toFixed(2)).join(','));
    assert(Math.abs((f.positions[8] - f.positions[2]) - 0.3 * 8) < 1e-5, '300 mm becomes 2.4 scene units (8 per metre)');
  }

  // ---------- D7 short cloth run ----------
  process.stdout.write('D7 a short cloth run on the bundled bust\n');
  {
    const J = await initJolt();
    const pos = tiltFigure(demo, 25);
    const res = simulateCloth(J, pos, demo.triangles, { ...SILK, frames: 12 });
    let finite = true, minZ = Infinity;
    for (let k = 0; k < res.positions.length; k++) { if (!Number.isFinite(res.positions[k])) finite = false; if (k % 3 === 2) minZ = Math.min(minZ, res.positions[k]); }
    const centre = ((SILK.cellsY / 2) * (SILK.cellsX + 1) + SILK.cellsX / 2) * 3;
    assert(finite, 'all cloth positions stay finite');
    assert(Math.abs(res.positions[centre + 2] - (1 + SILK.liftZ)) < 1e-6, 'the pinned crown vertex stays where it was attached');
    assert(minZ < 1 + SILK.liftZ - 0.2, 'the free cloth falls under gravity', `lowest z ${minZ.toFixed(3)} after 12 frames, ${res.seconds.toFixed(1)} s`);
  }

  process.stdout.write(failures ? `\n${failures} FAILURE(S)\n` : '\nALL OK\n');
  process.exit(failures ? 1 : 0);
}

main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exit(1); });
