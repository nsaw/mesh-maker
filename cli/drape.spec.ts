/**
 * Fast checks of the DRAPE pipeline (src/drape-sim): figure container, pose geometry, frontmost
 * extraction, cloth smoothing, relief mapping, a short cloth run, the field forces, the nearest-surface
 * field, fabric thickness, and the controls (src/drape-controls.ts). The full parity run against the
 * Blender proof is cli/drape-parity.spec.ts.
 * Run: npm run test:drape  (or: npx tsx cli/drape.spec.ts)
 */
import { readFileSync } from 'node:fs';
import initJolt from 'jolt-physics/wasm-compat';
import { encodeFigure, figureFromMesh, MAX_FIGURE_TRIANGLES, parseFigure, poseFigure, tiltFigure, type Figure } from '../src/drape-sim/figure';
import { emptyDepth, rasterizeFrontmost, type DepthWindow } from '../src/drape-sim/raster';
import { gridTriangles, subdivideGrid } from '../src/drape-sim/subdiv';
import { bareDepth, FIGURE_FIT, offsetTowardViewer, PANEL_ASPECT, PANEL_WINDOW, veiledDepth, RELIEF_BACKING_IN, RELIEF_SPAN_IN, reliefHeights } from '../src/drape-sim/pipeline';
import { EFFECTOR_ACCEL, ramp, sheetOffsetY, simulateCloth, SILK, SILK_GATHERED, type ClothParams } from '../src/drape-sim/cloth';
import { buildNearestField, closestOnTriangle, MAX_FIELD_VOXELS, nearestPoint } from '../src/drape-sim/nearest';
import { STATE } from '../src/state';
import { downloadDrapeRelief, FIGURE_EXTENSIONS, meshFromFile, toMaster } from '../src/drape-ui';
import { encodeReliefMaster, parseReliefMaster } from '../src/relief-master';
import { DRAPE_CARVE_PENDING, DRAPE_NO_RELIEF, drapeCarvePending, getExportSurface } from '../src/export-surface';
import { buildConfig, doSBPExport, safeZForStock, SBP_STATE, syncSbpSafeZ, syncSbpSafeZIfStockMoved } from '../src/sbp-export';
import { DRAPE_CONTROLS, DRAPE_PRESETS, DRAPE_WIDTH_RANGE, drapeCarveFor, drapeControlEffect, drapeJob, MAX_CLOTH_QUADS, MIN_DRAPE_BACKING_IN, remapToCarve } from '../src/drape-controls';

let failures = 0;
function assert(condition: boolean, label: string, detail = ''): void {
  if (condition) process.stdout.write(`  ok  ${label}${detail ? ` (${detail})` : ''}\n`);
  else { process.stdout.write(`  FAIL ${label}${detail ? `: ${detail}` : ''}\n`); failures++; }
}
const throws = (f: () => unknown): boolean => { try { f(); return false; } catch { return true; } };
/** The message a call throws, or '' when it does not throw. */
const thrown = (f: () => unknown): string => { try { f(); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); } };
/** A .mcfig whose JSON header is `json` verbatim, followed by `body` bytes. */
function rawFigure(json: string, body = 0): ArrayBuffer {
  const h = new TextEncoder().encode(json), start = Math.ceil((12 + h.length) / 8) * 8, out = new Uint8Array(start + body);
  out.set([77, 67, 70, 73, 71, 0, 0, 0], 0); new DataView(out.buffer).setUint32(8, h.length, true); out.set(h, 12);
  return out.buffer;
}
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
  const good = '"format":"meshcraft-figure","version":1,"vertices":3,"triangles":1,"head_height":2.6';
  assert(parseFigure(rawFigure(`{${good},"head_centre":[0,0,0]}`, 48)).header.vertices === 3, 'a minimal well-formed figure parses (control)');
  assert(/head_centre/.test(thrown(() => parseFigure(rawFigure(`{${good}}`, 48)))), 'a missing head_centre is rejected by name');
  assert(/head_centre/.test(thrown(() => parseFigure(rawFigure(`{${good},"head_centre":[0,"x",0]}`, 48)))), 'a non-numeric head_centre is rejected by name');
  assert(/JSON object/.test(thrown(() => parseFigure(rawFigure('null')))), 'a null header is rejected with a message, not a TypeError');
  assert(/license must be a string/.test(thrown(() => parseFigure(rawFigure(`{${good},"head_centre":[0,0,0],"license":null}`, 48)))),
    'a non-string license (which the relief master would refuse later) is rejected at upload');
  assert(/not a MeshCraft figure/.test(thrown(() => parseFigure(new Uint8Array([77, 67, 70, 73, 71, 0, 0, 0]).buffer))), 'a file shorter than its header is rejected');
  const big = MAX_FIGURE_TRIANGLES + 1;
  assert(/decimate/.test(thrown(() => parseFigure(rawFigure(`{"format":"meshcraft-figure","version":1,"vertices":3,"triangles":${big},"head_centre":[0,0,0],"head_height":2.6}`, 36 + big * 12)))),
    'a .mcfig over the triangle cap is refused like an uploaded mesh');

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
    // Veil hanging behind the figure's deepest point (beside the figure, where the bare depth is NaN)
    // must still land on the backing, never below it or below 0.
    const depth = bare.slice(), veil = new Uint8Array(bare.length);
    let bareLo = Infinity, bareHi = -Infinity;
    for (const v of bare) if (Number.isFinite(v)) { bareLo = Math.min(bareLo, v); bareHi = Math.max(bareHi, v); }
    let behind = 0;
    for (let k = 0; k < depth.length; k++) if (!Number.isFinite(bare[k]) && k % 7 === 0) { depth[k] = bareLo - 2 * (bareHi - bareLo); veil[k] = 1; behind++; }
    const rv = reliefHeights(depth, bare, veil);
    let vlo = Infinity, vhi = -Infinity;
    for (let k = 0; k < rv.heightsM.length; k++) if (rv.mask[k]) { vlo = Math.min(vlo, rv.heightsM[k]); vhi = Math.max(vhi, rv.heightsM[k]); }
    assert(behind > 0 && Math.abs(vlo - RELIEF_BACKING_IN * IN) < 1e-9 && vhi <= Math.fround((RELIEF_BACKING_IN + RELIEF_SPAN_IN) * IN),
      'veil deeper than the figure maps onto the backing, never below it', `${behind} veil nodes behind, heights ${(vlo / IN).toFixed(4)} to ${(vhi / IN).toFixed(4)} in`);
  }

  // ---------- D6 uploaded mesh placement ----------
  process.stdout.write('D6 uploaded mesh placement\n');
  {
    // A 300 mm tall Y-up box whose front (+Z, glTF convention) must end up facing the viewer (-Y).
    const p = new Float32Array([-100, 0, 50, 100, 0, 50, 0, 300, 50, 0, 0, -50]);
    const f = figureFromMesh(p, [0, 1, 2, 0, 2, 3], { up: 'y', turnDeg: 0, name: 'box', fit: FIGURE_FIT });
    const ys = [f.positions[1], f.positions[4], f.positions[10]];
    assert(Math.abs(f.positions[8] - 1) < 1e-6, 'the highest point becomes the crown at z = 1');
    assert(ys[0] < ys[2] && ys[1] < ys[2], 'a Y-up model\'s front (+Z) faces the viewer (-Y)', ys.map(v => v.toFixed(2)).join(','));
    // 300 tall and 100 either side: the depth below the crown binds (4.86 / 300 < 1.89 / 100).
    assert(Math.abs((f.positions[8] - f.positions[2]) - FIGURE_FIT.below) < 1e-5, 'a tall model is fitted to the panel\'s depth below the crown',
      `${(f.positions[8] - f.positions[2]).toFixed(4)} of ${FIGURE_FIT.below}`);
    // The same box in metres, and a wide one: units do not matter, and the width binds when it is wider.
    const m = figureFromMesh(p.map(v => v / 1000), [0, 1, 2, 0, 2, 3], { up: 'y', turnDeg: 0, name: 'box', fit: FIGURE_FIT });
    assert(m.positions.every((v, i) => Math.abs(v - f.positions[i]) < 1e-5), 'the fit ignores the model\'s units (millimetres and metres place the same)');
    const wide = figureFromMesh(new Float32Array([-1000, 0, 0, 1000, 0, 0, 0, 10, 0]), [0, 1, 2], { up: 'y', turnDeg: 0, name: 'wide', fit: FIGURE_FIT });
    assert(Math.abs(wide.positions[3] - FIGURE_FIT.halfWidth) < 1e-5 && Math.abs(wide.positions[0] + FIGURE_FIT.halfWidth) < 1e-5,
      'a wide model is fitted to the panel\'s width either side of the crown', `x ${wide.positions[0].toFixed(3)} to ${wide.positions[3].toFixed(3)}`);
    assert(/no width or height/.test(thrown(() => figureFromMesh(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]), [0, 1, 2], { up: 'z', turnDeg: 0, name: 'dot', fit: FIGURE_FIT }))),
      'a mesh with no extent is refused');
    // The fit leaves a margin inside the panel window (90%).
    assert(Math.abs(FIGURE_FIT.halfWidth - 0.9 * 2.1) < 1e-12 && Math.abs(FIGURE_FIT.below - 0.9 * (1 - PANEL_WINDOW.zBottom)) < 1e-12,
      'the fit is 90% of the panel beside and below the crown');
  }

  // ---------- D6b upload formats ----------
  process.stdout.write('D6b upload formats\n');
  {
    // The same 0.65 m bust (a head on shoulders, Z up, face toward -Y) exported by Blender 5.2.2 as USDZ and PLY.
    const usd = await meshFromFile(fileBuffer('cli/fixtures/figure-formats/bust.usdz'), 'bust.usdz');
    const ply = await meshFromFile(fileBuffer('cli/fixtures/figure-formats/bust.ply'), 'bust.ply');
    const place = (r: { pos: Float32Array; tris: Uint32Array; up?: 'y' }): Figure => figureFromMesh(r.pos, r.tris, { up: r.up ?? 'z', turnDeg: 0, name: 'bust', fit: FIGURE_FIT });
    const fu = place(usd), fp = place(ply);
    const box = (q: Float32Array): number[] => { const b = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]; for (let i = 0; i < q.length; i += 3) for (let a = 0; a < 3; a++) { b[a * 2] = Math.min(b[a * 2], q[i + a]); b[a * 2 + 1] = Math.max(b[a * 2 + 1], q[i + a]); } return b; };
    const bu = box(fu.positions), bp = box(fp.positions);
    assert(usd.tris.length / 3 === 236 && ply.tris.length / 3 === 236 && usd.up === 'y' && ply.up === undefined,
      'USDZ and PLY load all 236 triangles (USD comes back Y-up, PLY takes the sidebar\'s axis)', `${usd.tris.length / 3} / ${ply.tris.length / 3}`);
    assert(bu.every((v, i) => Math.abs(v - bp[i]) < 1e-5), 'the USDZ and the PLY of one model place identically', bu.map(v => v.toFixed(3)).join(','));
    assert(bu[2] < -0.5 && Math.abs(bu[3] - 0.748) < 0.01, 'the USDZ\'s front (-Y in the stage) faces the viewer', `y ${bu[2].toFixed(3)} to ${bu[3].toFixed(3)}`);
    const pts = await meshFromFile(fileBuffer('cli/fixtures/figure-formats/points.ply'), 'points.ply');
    assert(pts.tris.length === 0, 'a PLY point cloud comes back with no triangles (the upload refuses it)', `${pts.tris.length / 3} triangles`);
    assert(['.usdz', '.usd', '.usda', '.usdc', '.ply'].every(e => FIGURE_EXTENSIONS.includes(e)), 'the upload accepts USD and PLY files');
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

  // ---------- D8 pose ----------
  process.stdout.write('D8 figure pose\n');
  {
    const t = tiltFigure(demo, 25), p = poseFigure(demo, { tiltDeg: 25, turnDeg: 0, leanDeg: 0 });
    assert(t.every((v, i) => v === p[i]), 'a pose with no turn or lean is the tilt alone, bit for bit');
    // The nose is the frontmost point (most -Y) of the head; turning the face toward the viewer's right
    // moves it toward +X, leaning moves the crown's neighbourhood toward +X.
    // The face is the frontmost (most -Y) part of the head (the top 1.2 units below the crown).
    const face = (q: Float32Array): number => { let k = -1; for (let i = 1; i < q.length; i += 3) if (q[i + 1] > -0.2 && (k < 0 || q[i] < q[k * 3 + 1])) k = (i - 1) / 3; return q[k * 3]; };
    const right = poseFigure(demo, { tiltDeg: 25, turnDeg: 40, leanDeg: 0 }), left = poseFigure(demo, { tiltDeg: 25, turnDeg: -40, leanDeg: 0 });
    assert(face(right) > face(t) + 0.2 && face(left) < face(t) - 0.2, 'turning +40 deg moves the face toward the viewer\'s right (+X), -40 toward the left',
      `face x ${face(left).toFixed(2)} / ${face(t).toFixed(2)} / ${face(right).toFixed(2)}`);
    const lean = poseFigure(demo, { tiltDeg: 25, turnDeg: 0, leanDeg: 20 });
    let ct = 0, cl = 0, n = 0;
    for (let i = 0; i < t.length; i += 3) if (t[i + 2] < -2) { ct += t[i]; cl += lean[i]; n++; }
    assert(cl / n < ct / n - 0.3, 'leaning the crown right swings the body below it to the left (-X)', `body x ${(ct / n).toFixed(2)} -> ${(cl / n).toFixed(2)}`);
    let top = -Infinity; for (let i = 2; i < lean.length; i += 3) top = Math.max(top, lean[i]);
    assert(Math.abs(top - 1) < 1e-6, 'a posed figure keeps its crown at z = 1');
    // Figure Size scales the posed figure about its crown; 1 leaves it bit for bit.
    const one = poseFigure(demo, { tiltDeg: 25, turnDeg: 0, leanDeg: 0, scale: 1 });
    assert(one.every((v, i) => v === t[i]), 'Figure Size 100% is the plain pose, bit for bit');
    const big = poseFigure(demo, { tiltDeg: 25, turnDeg: 0, leanDeg: 0, scale: 2 });
    let worst = 0, bigTop = -Infinity;
    for (let i = 0; i < t.length; i += 3) {
      worst = Math.max(worst, Math.abs(big[i] - 2 * t[i]), Math.abs(big[i + 1] - 2 * t[i + 1]), Math.abs(big[i + 2] - 1 - 2 * (t[i + 2] - 1)));
      bigTop = Math.max(bigTop, big[i + 2]);
    }
    assert(worst < 1e-5 && Math.abs(bigTop - 1) < 1e-6, 'Figure Size 200% doubles every distance from the crown, which stays at z = 1', `worst ${worst.toExponential(1)}`);
    assert(drapeJob({ ...DRAPE_PRESETS.gathered.settings, drapeFigureScale: 150 }, 'off').pose.scale === 1.5 && drapeControlEffect('drapeFigureScale') === 'pose',
      'the Figure Size control is a pose: it reaches the solver and rebuilds the bare figure');
  }

  // ---------- D9 force timing ----------
  process.stdout.write('D9 force timing\n');
  {
    // Blender 5.2.2 evaluates keys (45, 0) and (100, -1000) with default interpolation to these values.
    const blender: [number, number][] = [[50, 23.291], [55, 87.153], [60, 182.569], [72.5, 500], [85, 817.431], [95, 976.709]];
    const worst = Math.max(...blender.map(([f, v]) => Math.abs(1000 * ramp(f, 45, 100) - v)));
    assert(worst < 0.01, 'the attraction ramp matches Blender\'s keyframe curve', `max diff ${worst.toFixed(4)} of 1000`);
    assert(ramp(44, 45, 100) === 0 && ramp(100, 45, 100) === 1 && ramp(150, 45, 100) === 1 && ramp(7, 7, 7) === 1, 'zero before the start, full from the full frame');
  }

  // ---------- D10 nearest surface field ----------
  process.stdout.write('D10 nearest-surface field\n');
  {
    const pos = tiltFigure(demo, 25);
    const f = buildNearestField(pos, demo.triangles, { x0: -3, x1: 3, y0: -3, y1: 3, z0: -3, z1: 1.2 }, 0.04, 0.8);
    const q = new Float64Array(3), c = new Float64Array(3);
    let worst = 0, checked = 0, seed = 12345;
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let n = 0; n < 60; n++) {
      const px = -1.5 + 3 * rnd(), py = -1.5 + 3 * rnd(), pz = -1.5 + 2.5 * rnd();
      let best = Infinity;
      for (let t = 0; t < demo.triangles.length; t += 3) {
        closestOnTriangle(px, py, pz, pos, demo.triangles[t] * 3, demo.triangles[t + 1] * 3, demo.triangles[t + 2] * 3, c);
        best = Math.min(best, Math.hypot(c[0] - px, c[1] - py, c[2] - pz));
      }
      if (best > 0.8) continue;
      const d = nearestPoint(f, px, py, pz, q);
      worst = Math.max(worst, d - best); checked++;
    }
    const big = buildNearestField(pos, demo.triangles, { x0: -20, x1: 20, y0: -20, y1: 20, z0: -20, z1: 20 }, 0.04, 5);
    assert(big.nx * big.ny * big.nz <= MAX_FIELD_VOXELS && big.h > 0.04, 'a huge box gets coarser voxels instead of more memory',
      `${(big.nx * big.ny * big.nz / 1e6).toFixed(1)}M voxels at ${big.h.toFixed(3)}`);
    assert(checked > 20 && worst >= -1e-9 && worst < 0.01, 'within reach, the field\'s distance is the brute-force nearest within 0.01 units (a quarter voxel)',
      `${checked} points, worst excess ${worst.toFixed(5)}`);
  }

  // ---------- D11 field forces act as Blender's ----------
  process.stdout.write('D11 field forces\n');
  {
    // A sheet far above a small far-away figure: no contact. A force of exactly 1 g upward balances
    // gravity on the interior (the edge vertices carry less area, so they sag and pull it down a
    // little); twice that lifts it. The same force from the attraction, toward a plane above, holds too.
    const J = await initJolt();
    const hold = 9.81 * SILK.vertexMass / (EFFECTOR_ACCEL * 0.05 * 0.05);
    const far = new Float32Array([-0.1, 0, -40, 0.1, 0, -40, 0, 0.1, -40]), farTris = new Uint32Array([0, 1, 2]);
    // 90% of the sheet in front of the crown: wind, pressure and the face region act on cloth at y < 0.
    const small: ClothParams = { ...SILK, sheetX: 1, sheetY: 1, cellsX: 20, cellsY: 20, frames: 12, frontShare: 0.9 };
    const probe = (8 * 21 + 15) * 3 + 2;                                // an interior vertex off the pins, at y = -0.5
    const still = simulateCloth(J, far, farTris, { ...small, windMode: 1, windStrength: hold, windElevation: -90, windX: 0, windZ: 1, windRadius: 50, windStart: 0, windFull: 0 });
    const fall = simulateCloth(J, far, farTris, small);
    const z0 = 1 + SILK.liftZ;
    const rise = simulateCloth(J, far, farTris, { ...small, windMode: 1, windStrength: 2 * hold, windElevation: -90, windX: 0, windZ: 1, windRadius: 50, windStart: 0, windFull: 0 });
    const drop = (r: { positions: Float64Array }): number => z0 - r.positions[probe];
    assert(drop(fall) > 0.1 && Math.abs(drop(still)) < 0.2 * drop(fall) && drop(rise) < 0,
      'wind of the strength computed for 1 g upward balances gravity, twice that lifts the cloth',
      `drop: none ${drop(fall).toFixed(3)}, 1 g ${drop(still).toFixed(3)}, 2 g ${drop(rise).toFixed(3)} units`);
    const plane = new Float32Array([-5, -5, 1.4, 5, -5, 1.4, 0, 5, 1.4]);
    const lifted = simulateCloth(J, plane, farTris, { ...small, attractStrength: hold, attractReach: 0.8, attractStart: 0, attractFull: 0 });
    assert(Math.abs(drop(lifted) - drop(still)) < 0.01, 'attraction toward a surface above, of the same strength, balances it the same way',
      `drop ${drop(lifted).toFixed(4)} units`);
    // Local attraction only inside the face circle: a circle round the probe holds it, one beside it
    // does not; the regions are in the front view (x, z), so the sheet's y does not matter.
    const px = still.positions[probe - 2];
    const inside = simulateCloth(J, plane, farTris, { ...small, faceAttractStrength: hold, faceAttractReach: 0.8, faceStart: 0, faceFull: 0, faceX: px, faceZ: 1, faceRadius: 3 });
    const beside = simulateCloth(J, plane, farTris, { ...small, faceAttractStrength: hold, faceAttractReach: 0.8, faceStart: 0, faceFull: 0, faceX: px + 4, faceZ: 1, faceRadius: 1 });
    assert(Math.abs(drop(inside) - drop(still)) < 0.01 && Math.abs(drop(beside) - drop(fall)) < 1e-9,
      'local attraction acts inside its face region and nowhere else', `drop inside ${drop(inside).toFixed(4)}, beside ${drop(beside).toFixed(4)} units`);
    // The same wind on a sheet hanging wholly behind the crown (y >= 0) leaves it alone.
    const behind = { ...small, frontShare: 0 }, probeBehind = (8 * 21 + 15) * 3 + 2;     // y = +0.4
    const backWind = simulateCloth(J, far, farTris, { ...behind, windMode: 1, windStrength: hold, windElevation: -90, windX: 0, windZ: 1, windRadius: 50, windStart: 0, windFull: 0 });
    const backFall = simulateCloth(J, far, farTris, behind);
    // (Cloth by the crown swings a little in front as the sheet falls and is pushed; the sheet passes
    // that on, so allow 5% of the effect the same wind has on cloth in front.)
    const backEffect = Math.abs(backWind.positions[probeBehind] - backFall.positions[probeBehind]), frontEffect = drop(fall) - drop(still);
    assert(backEffect < 0.05 * frontEffect, 'wind leaves the cloth behind the crown alone (pressure goes through the same front-only check)',
      `effect behind ${backEffect.toFixed(4)} units, in front ${frontEffect.toFixed(4)}`);
    // Surface fit: full strength puts the region's cloth at the clearance from the plane above.
    const fit = simulateCloth(J, plane, farTris, { ...small, fitStrength: 1, faceX: px, faceZ: 1, faceRadius: 3 });
    assert(Math.abs(fit.positions[probe] - (1.4 - SILK.vertexRadius)) < 0.005, 'a full surface fit moves the cloth onto the figure, keeping the clearance',
      `z ${fit.positions[probe].toFixed(4)} (figure 1.4, clearance ${SILK.vertexRadius})`);
    const odd = { ...small, cellsX: 20, cellsY: 20, frontShare: 0.7 };
    const oy = sheetOffsetY(odd);
    assert(Math.abs(oy + 0.2) < 1e-12, 'a 70% front share moves the sheet 0.2 of its length toward the viewer, on the cell grid', `offset ${oy}`);
  }

  // ---------- D12 fabric thickness ----------
  process.stdout.write('D12 fabric thickness\n');
  {
    // A flat sheet in the x-z plane, wound either way: the offset always moves it toward the viewer (-Y).
    const grid = (flip: boolean): Float64Array => {
      const g = new Float64Array(5 * 5 * 3);
      for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) { const k = (j * 5 + i) * 3; g[k] = flip ? -i : i; g[k + 1] = 0; g[k + 2] = j; }
      return g;
    };
    const ok = [false, true].every(flip => offsetTowardViewer(grid(flip), 5, 5, 0.01).every((v, k) => k % 3 === 1 ? Math.abs(v + 0.01) < 1e-12 : v === grid(flip)[k]));
    assert(ok, 'fabric thickness offsets the cloth surface toward the viewer by exactly its thickness, whichever way the sheet is wound');
    // Display subdivision: levels change what is carved, not the solve (a bent grid reads differently).
    const bent = new Float64Array(5 * 5 * 3);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) { const k = (j * 5 + i) * 3; bent[k] = i * 0.1; bent[k + 1] = -1 - ((i + j) % 2) * 0.05; bent[k + 2] = 1 - j * 0.1; }
    const w: DepthWindow = { x0: 0, x1: 0.4, zTop: 1, zBottom: 0.6, cols: 41, rows: 41 };
    const none = emptyDepth(w), d0 = veiledDepth(none, bent, 5, 5, w, 0, 0).depth, d2 = veiledDepth(none, bent, 5, 5, w, 0, 2).depth;
    let diff = 0; for (let k = 0; k < d0.length; k++) if (Number.isFinite(d0[k]) && Number.isFinite(d2[k])) diff = Math.max(diff, Math.abs(d0[k] - d2[k]));
    assert(diff > 0.005, 'display subdivision levels change the carved cloth surface', `max depth change ${diff.toFixed(4)} units`);
  }

  // ---------- D13 controls ----------
  process.stdout.write('D13 controls\n');
  {
    const g = drapeJob(DRAPE_PRESETS.gathered.settings, 'off'), sk = drapeJob(DRAPE_PRESETS.silk.settings, 'off');
    // Wind settings are inert while the wind mode is off (the sliders keep a strength ready); region
    // centres and radii are rounded to 0.01 in on the carve, and the pin radius to 0.01 cm, which pins
    // the same vertices (checked below).
    const differs = (a: ClothParams, b: ClothParams): string[] => (Object.keys(b) as (keyof ClothParams)[])
      .filter(k => k !== 'pinRadius' && !/^(wind|face[XZR])/.test(k) && Math.abs(a[k] - b[k]) > 1e-12 * Math.max(1, Math.abs(b[k])));
    assert(differs(g.params, SILK_GATHERED).length === 0, 'the Gathered preset\'s controls give the solver the gathered parameters', differs(g.params, SILK_GATHERED).join(',') || 'all equal');
    assert(differs(sk.params, SILK).length === 0, 'the Silk preset\'s controls give the solver the proof\'s parameters', differs(sk.params, SILK).join(',') || 'all equal');
    const pins = (p: ClothParams): number => { let n = 0; const dx = p.sheetX / p.cellsX, dy = p.sheetY / p.cellsY; for (let i = 0; i <= p.cellsX; i++) for (let j = 0; j <= p.cellsY; j++) if (Math.abs(-p.sheetX / 2 + i * dx) < p.pinRadius && Math.abs(sheetOffsetY(p) - p.sheetY / 2 + j * dy) < p.pinRadius) n++; return n; };
    // Material Thickness is shared with NOISE and DEPTH MAP, which must regenerate on it: it is not a
    // drape control (the Drape tab handles it itself). Every table key is one.
    assert(['baseThickness', 'meshX', 'frequency', 'dmHeightScale'].every(k => drapeControlEffect(k) === null)
      && DRAPE_CONTROLS.every(c => drapeControlEffect(c.key) !== null), 'only DRAPE controls are routed to the drape; Material Thickness regenerates the mesh elsewhere');
    const qw = drapeJob(DRAPE_PRESETS.quartering.settings, DRAPE_PRESETS.quartering.windMode).params;
    assert(qw.windMode === 1 && qw.windStrength === 250 && qw.windAzimuth === 45 && Math.abs(qw.windX - SILK.windX) < 0.004
      && Math.abs(qw.windZ - SILK.windZ) < 0.004 && Math.abs(qw.windRadius - SILK.windRadius) < 0.004 && qw.windStart === 100 && qw.windFull === 115,
      'the Quartering wind preset blows 250 from the front-right onto the left cheek, frames 100 to 115');
    assert(pins(g.params) === 9, 'the default crown attachment holds the proof\'s nine vertices', `${pins(g.params)} pinned`);
    const fine = drapeJob({ ...DRAPE_PRESETS.gathered.settings, drapeClothRes: 200 }, 'off').params;
    const mass = (p: ClothParams): number => p.vertexMass / ((p.sheetX / p.cellsX) * (p.sheetY / p.cellsY));
    // The sliders can ask for more cloth than the solver holds; Generate refuses past MAX_CLOTH_QUADS.
    const huge = drapeJob({ ...DRAPE_PRESETS.gathered.settings, drapeClothRes: 200, drapeClothWidth: 25, drapeClothLength: 150 }, 'off').params;
    assert(huge.cellsX * huge.cellsY > MAX_CLOTH_QUADS && fine.cellsX * fine.cellsY <= MAX_CLOTH_QUADS && g.params.cellsX * g.params.cellsY <= MAX_CLOTH_QUADS,
      'the largest cloth the sliders allow is over the solver cap, the default and 200 across are under it', `${huge.cellsX} x ${huge.cellsY}`);
    assert(fine.cellsX === 200 && fine.cellsY === 320 && Math.abs(mass(fine) - mass(SILK)) < 1e-9, 'a finer cloth keeps its mass per area', `${fine.cellsX} x ${fine.cellsY}`);
    const IN = 0.0254, std = new Float32Array([RELIEF_BACKING_IN * IN, (RELIEF_BACKING_IN + RELIEF_SPAN_IN) * IN]);
    const c4 = drapeCarveFor(4, 3, 12), out = remapToCarve(std, c4);
    assert(Math.abs(out[0] / IN - 1) < 1e-6 && Math.abs(out[1] / IN - 4) < 1e-6, 'a 4 in board with 3 in of relief spans 1 to 4 in', `${(out[0] / IN).toFixed(4)} to ${(out[1] / IN).toFixed(4)} in`);
    const thin = drapeCarveFor(1, 3, 12);
    assert(Math.abs(thin.backingIn - MIN_DRAPE_BACKING_IN) < 1e-12 && thin.stockIn === 1, 'relief depth is capped to keep the minimum backing', JSON.stringify(thin));
    assert(drapeCarveFor(9, 0.5, 12).stockIn === 4 && drapeCarveFor(0.1, 0.05, 12).stockIn === 0.25, 'material thickness stays within 0.25 to 4 in');
    const w9 = drapeCarveFor(0.75, 0.625, 9), wBig = drapeCarveFor(0.75, 0.625, 40), wSmall = drapeCarveFor(0.75, 0.625, 1);
    assert(w9.widthIn === 9 && w9.heightIn === 12 && wBig.widthIn === DRAPE_WIDTH_RANGE[1] && wBig.heightIn === 24 && wSmall.widthIn === DRAPE_WIDTH_RANGE[0]
      && Math.abs(PANEL_ASPECT - 0.75) < 1e-15, 'the carve keeps 3:4 and its width stays within 3 to 18 in (24 in tall at most, the bed)', JSON.stringify([w9, wBig.heightIn, wSmall.widthIn]));
    // Face and wind positions are percentages of the panel: the gathered face region lands where the solver preset has it.
    const gp = drapeJob(DRAPE_PRESETS.gathered.settings, 'off').params;
    assert(Math.abs(gp.faceX - SILK_GATHERED.faceX) < 1e-3 && Math.abs(gp.faceZ - SILK_GATHERED.faceZ) < 1e-3 && Math.abs(gp.faceRadius - SILK_GATHERED.faceRadius) < 1e-3,
      'percent positions map back onto the preset\'s face region within 0.001 units', `${gp.faceX.toFixed(4)}, ${gp.faceZ.toFixed(4)}, ${gp.faceRadius.toFixed(4)}`);
  }

  // ---------- D14 export safety on the Drape tab ----------
  process.stdout.write('D14 export safety\n');
  {
    // syncSbpSafeZ updates the sidebar if there is one; in Node there is none.
    // The toast element records what the user would be told.
    const toast = { textContent: '', style: { display: '' }, classList: { add: () => undefined, remove: () => undefined } };
    (globalThis as unknown as { document: unknown }).document = { getElementById: (id: string) => (id === 'toast' ? toast : null), querySelector: () => null };
    const IN = 0.0254;
    const master = async (stockIn: number, backingIn: number) => parseReliefMaster(await encodeReliefMaster({
      format: 'meshcraft-relief', version: 1, units: 'm', cols: 3, rows: 3, width: 12 * IN, height: 16 * IN, dtype: 'float32',
      rowOrder: 'top-down', heightOrigin: 'panel-back', backing: backingIn * IN, stock: stockIn * IN, triangulation: 'tr-bl', mask: false, name: 'probe',
    }, new Float32Array(9).fill(backingIn * IN).map((v, k) => (k === 4 ? stockIn * IN : v))));
    const keep = { ...STATE };
    const thin = await master(0.75, 0.125), thick = await master(2, 0.75);
    // Material Thickness moved to 2 in; the master is still the 0.75 in one being remapped.
    Object.assign(STATE, { mode: 'drape', drapeMaster: thin, drapeStock: 2, drapeReliefDepth: 1.25, baseThickness: 2 });
    const pending = getExportSurface(true);
    assert(drapeCarvePending() && typeof pending === 'string' && /remapped/.test(pending),
      'while the relief is being remapped to a new carve, every export refuses', typeof pending === 'string' ? pending : 'exported');
    // SBP from an uploaded STL takes the stock top too, so it waits as well (it never reaches its worker).
    SBP_STATE.stlBuffer = new ArrayBuffer(84);
    toast.textContent = '';
    let sbpThrew = '';
    try { doSBPExport(); } catch (e) { sbpThrew = e instanceof Error ? e.message : String(e); }
    SBP_STATE.stlBuffer = null;
    assert(toast.textContent === DRAPE_CARVE_PENDING && !sbpThrew, 'SBP from an uploaded STL refuses too while the carve is pending',
      sbpThrew || toast.textContent.slice(0, 40));
    // The remap landed: the master is the 2 in one, and SBP cuts its stock top.
    Object.assign(STATE, { drapeMaster: thick, baseThickness: 0.5 });
    const ok = getExportSurface(true);
    assert(!drapeCarvePending() && typeof ok !== 'string' && buildConfig().materialZ === 2,
      'once it lands, export proceeds and SBP material Z is the master\'s stock top', `materialZ ${buildConfig().materialZ}`);
    // Relief Depth alone (same stock top, new backing) is a pending carve too.
    Object.assign(STATE, { drapeMaster: thick, drapeStock: 2, drapeReliefDepth: 1.0 });
    assert(drapeCarvePending() && typeof getExportSurface(true) === 'string', 'a Relief Depth change alone also holds exports until its remap lands');
    // So is a new carve size: the master is still 12 x 16 in.
    Object.assign(STATE, { drapeMaster: thick, drapeStock: 2, drapeReliefDepth: 1.25, drapeCarveWidth: 9 });
    const resized = drapeCarvePending();
    Object.assign(STATE, { drapeCarveWidth: 12 });
    assert(resized && !drapeCarvePending(), 'a carve size change holds exports until the master is rebuilt at that size');
    // The rebuilt master is cut at the carve size: 9 in wide is 12 in tall, the heights unchanged.
    {
      const n = PANEL_WINDOW.cols * PANEL_WINDOW.rows, heightsM = new Float32Array(n).fill(RELIEF_BACKING_IN * IN), mask = new Uint8Array(n).fill(1);
      heightsM[n >> 1] = (RELIEF_BACKING_IN + RELIEF_SPAN_IN) * IN;
      const r = { heightsM, mask, name: 'probe', fig: demo, kind: 'bare' as const, label: 'probe' };
      Object.assign(STATE, { drapeCarveWidth: 9, drapeStock: 0.75, drapeReliefDepth: 0.625 });
      const m9 = await toMaster(r);
      Object.assign(STATE, { drapeCarveWidth: 12 });
      const m12 = await toMaster(r);
      assert(Math.abs(m9.widthIn - 9) < 1e-6 && Math.abs(m9.heightIn - 12) < 1e-6 && Math.abs(m12.widthIn - 12) < 1e-6 && Math.abs(m12.heightIn - 16) < 1e-6
        && Math.abs(m9.heightsIn.reduce((a, b) => Math.max(a, b), 0) - 0.75) < 1e-6, 'the drape master is cut at the carve size (9 x 12 in, or 12 x 16 in), its stock top unchanged',
        `${m9.widthIn.toFixed(3)} x ${m9.heightIn.toFixed(3)} in`);
    }
    // Safe Z follows the stock top when it moves, and keeps a raised value when it does not.
    Object.assign(STATE, { drapeMaster: thin, drapeStock: 0.75, drapeReliefDepth: 0.625 });
    syncSbpSafeZ();
    const at075 = SBP_STATE.safeZ;
    SBP_STATE.safeZ = 2;                                                // the user raises Safe Z to clear clamps
    syncSbpSafeZIfStockMoved();
    const kept = SBP_STATE.safeZ;
    Object.assign(STATE, { drapeMaster: thick, drapeStock: 2, drapeReliefDepth: 1.25 });
    syncSbpSafeZIfStockMoved();
    assert(at075 === 0.9 && kept === 2 && SBP_STATE.safeZ === 2.1, 'Safe Z keeps a raised value on the same stock and moves above a new stock top',
      `0.75 in: ${at075}, kept ${kept}, 2 in: ${SBP_STATE.safeZ}`);
    // Safe Z clears the stock top by at least 0.1 in, on the slider's 0.1 in grid (0.75 -> 0.9, not
    // the 0.8 that rounding to the nearest tenth gave), and an exact tenth stays exact.
    const cases: [number, number][] = [[0.75, 0.9], [0.8, 0.9], [0.25, 0.5], [1.0, 1.1], [1.37, 1.5], [3.95, 4.1], [5.95, 6]];
    const bad = cases.filter(([s, z]) => safeZForStock(s) !== z || (s < 5.9 && safeZForStock(s) - s < 0.1 - 1e-9));
    assert(bad.length === 0, 'Safe Z is the stock top plus at least 0.1 in, rounded up to 0.1 in', bad.map(([s]) => `${s} -> ${safeZForStock(s)}`).join(', ') || cases.map(([s, z]) => `${s}->${z}`).join(' '));
    // D15: the .mcrelief download waits for the remap too, and DRAPE exports nothing before its relief.
    Object.assign(STATE, { mode: 'drape', drapeMaster: thin, drapeStock: 2, drapeReliefDepth: 1.25 });
    toast.textContent = '';
    let dlThrew = '';
    try { await downloadDrapeRelief(); } catch (e) { dlThrew = e instanceof Error ? e.message : String(e); }   // a download reaches the DOM
    assert(toast.textContent === DRAPE_CARVE_PENDING && !dlThrew, 'the .mcrelief download refuses while the carve is pending',
      dlThrew ? `went on to download (${dlThrew})` : toast.textContent.slice(0, 40));
    Object.assign(STATE, { drapeMaster: null, vertices: [[0, 0], [0, 0]], cols: 2, rows: 2 });
    const none = getExportSurface();
    assert(none === DRAPE_NO_RELIEF, 'DRAPE exports nothing until its relief exists (not the previous tab\'s mesh)', typeof none === 'string' ? none : 'exported');
    toast.textContent = '';
    await downloadDrapeRelief();
    assert(toast.textContent === DRAPE_NO_RELIEF, 'the .mcrelief download says why when there is no relief yet', toast.textContent || 'silent');
    Object.assign(STATE, keep);
  }

  process.stdout.write(failures ? `\n${failures} FAILURE(S)\n` : '\nALL OK\n');
  process.exit(failures ? 1 : 0);
}

main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exit(1); });
