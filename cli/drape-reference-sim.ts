/**
 * Reference cloth simulation for cli/drape-physics.spec.ts: the physical oracle the procedural
 * drape (src/drape.ts) is checked against. Not shipped in the app.
 *
 * Position-based dynamics (distance constraints: structural, shear, weak skip-one bending) on a
 * square cloth dropped onto a heightfield relief over the unit square, with optional gravity tilt
 * toward +y (away from the pinned edge) and an optional pinned edge at y = 0. Heightfield collision is a vertical
 * projection; friction is position-level Coulomb, applied once per step: a contact whose tangential
 * slip this step is below mu_s x (normal correction) sticks, otherwise the slip shrinks by
 * mu_k x (normal correction). The review's first version scaled slip by a constant inside every
 * constraint iteration, which effectively glued the cloth and biased its folds.
 * The cloth is rasterized back onto the grid as the top surface, so it compares cell for cell with
 * a heightfield model.
 */

export interface ReferenceSimOptions {
  /** Gravity tilt from -z toward +y (away from the pinned edge), degrees. 0 = straight into the panel. */
  tiltDeg: number;
  /** Pin the cloth's y = 0 row (a veil hung from that edge). */
  pinTop: boolean;
  /** Particles per side. */
  particles: number;
  /** Hard cap on steps; the run stops earlier once it has settled. */
  maxSteps: number;
  /** Settled when no particle moves more than this (domain units) in one step. */
  settleMove: number;
}

export interface ReferenceSimResult {
  /** Cloth top surface on the G x G grid, domain units. */
  surface: Float64Array;
  steps: number;
  /** Largest single-particle move in the last step, domain units. */
  lastMove: number;
  /** 99th-percentile particle move in the last step, domain units. */
  lastMoveP99: number;
  settled: boolean;
  /** Grid cells the rasterized cloth did not cover (filled from the relief). */
  holes: number;
  maxPenetration: number;
}

const CLOTH_EXTENT = 1.1;     // cloth side length; slightly larger than the panel
const THICKNESS = 0.004;      // collision offset, domain units
const FRICTION_STATIC = 0.6;
const FRICTION_KINETIC = 0.4;
const DT = 1 / 240;
const ITERS = 12;
// Velocity damping per step. The oracle wants the static drape, not the swing that gets there.
const DAMPING = 0.98;

export function simulateReferenceDrape(relief: Float64Array, G: number, o: ReferenceSimOptions): ReferenceSimResult {
  const sampleH = (x: number, y: number): number => {
    if (x < 0 || x > 1 || y < 0 || y > 1) return 0;
    const fx = x * (G - 1), fy = y * (G - 1);
    const i0 = Math.min(G - 2, Math.floor(fx)), j0 = Math.min(G - 2, Math.floor(fy));
    const tx = fx - i0, ty = fy - j0;
    return (relief[j0 * G + i0] * (1 - tx) + relief[j0 * G + i0 + 1] * tx) * (1 - ty)
         + (relief[(j0 + 1) * G + i0] * (1 - tx) + relief[(j0 + 1) * G + i0 + 1] * tx) * ty;
  };
  let hMax = 0; for (const v of relief) hMax = Math.max(hMax, v);

  const N = o.particles, d = CLOTH_EXTENT / (N - 1);
  const P = new Float64Array(N * N * 3), Q = new Float64Array(N * N * 3), V = new Float64Array(N * N * 3);
  const normalFix = new Float64Array(N * N);   // accumulated normal (z) correction this step
  let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) - 0.5;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = (j * N + i) * 3;
    P[k] = -0.05 + i * d; P[k + 1] = -0.05 + j * d; P[k + 2] = hMax + 0.02 + rnd() * 1e-4;
  }
  const A: number[] = [], B: number[] = [], R: number[] = [], S: number[] = [];
  const add = (a: number, b: number, rest: number, s: number) => { A.push(a); B.push(b); R.push(rest); S.push(s); };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * N + i;
    if (i + 1 < N) add(a, a + 1, d, 1);
    if (j + 1 < N) add(a, a + N, d, 1);
    if (i + 1 < N && j + 1 < N) { add(a, a + N + 1, d * Math.SQRT2, 0.6); add(a + 1, a + N, d * Math.SQRT2, 0.6); }
    if (i + 2 < N) add(a, a + 2, 2 * d, 0.08);
    if (j + 2 < N) add(a, a + 2 * N, 2 * d, 0.08);
  }
  const nc = A.length, Ai = Int32Array.from(A), Bi = Int32Array.from(B), Rf = Float64Array.from(R), Sf = Float64Array.from(S);
  const tilt = o.tiltDeg * Math.PI / 180, gy = 9.8 * Math.sin(tilt), gz = -9.8 * Math.cos(tilt);
  const pinned = (k: number) => o.pinTop && k < N;

  let steps = 0, lastMove = Infinity, lastMoveP99 = Infinity;
  const moves = new Float64Array(N * N);
  for (; steps < o.maxSteps; steps++) {
    for (let k = 0; k < N * N; k++) {
      const b = k * 3;
      Q[b] = P[b]; Q[b + 1] = P[b + 1]; Q[b + 2] = P[b + 2];
      if (pinned(k)) continue;
      V[b + 1] += gy * DT; V[b + 2] += gz * DT;
      for (let c = 0; c < 3; c++) { V[b + c] *= DAMPING; P[b + c] += V[b + c] * DT; }
    }
    for (let it = 0; it < ITERS; it++) {
      for (let c = 0; c < nc; c++) {
        const a = Ai[c], bb = Bi[c], wa = pinned(a) ? 0 : 1, wb = pinned(bb) ? 0 : 1;
        if (!(wa + wb)) continue;
        const ia = a * 3, ib = bb * 3;
        const dx = P[ib] - P[ia], dy = P[ib + 1] - P[ia + 1], dz = P[ib + 2] - P[ia + 2];
        const len = Math.hypot(dx, dy, dz) || 1e-12;
        const corr = Sf[c] * (len - Rf[c]) / (len * (wa + wb));
        P[ia] += dx * corr * wa; P[ia + 1] += dy * corr * wa; P[ia + 2] += dz * corr * wa;
        P[ib] -= dx * corr * wb; P[ib + 1] -= dy * corr * wb; P[ib + 2] -= dz * corr * wb;
      }
      for (let k = 0; k < N * N; k++) {
        if (pinned(k)) continue;
        const b = k * 3, zmin = sampleH(P[b], P[b + 1]) + THICKNESS;
        if (P[b + 2] < zmin) { normalFix[k] += zmin - P[b + 2]; P[b + 2] = zmin; }
      }
    }
    for (let k = 0; k < N * N; k++) {
      const dn = normalFix[k];
      if (!(dn > 0)) continue;
      normalFix[k] = 0;
      const b = k * 3, tx = P[b] - Q[b], ty = P[b + 1] - Q[b + 1], slip = Math.hypot(tx, ty);
      if (slip < FRICTION_STATIC * dn) { P[b] = Q[b]; P[b + 1] = Q[b + 1]; continue; }
      const keep = Math.max(0, 1 - FRICTION_KINETIC * dn / slip);
      P[b] = Q[b] + tx * keep;
      P[b + 1] = Q[b + 1] + ty * keep;
    }
    lastMove = 0;
    for (let k = 0; k < N * N; k++) {
      let m = 0;
      for (let c = 0; c < 3; c++) { const q = k * 3 + c; V[q] = (P[q] - Q[q]) / DT; m = Math.max(m, Math.abs(P[q] - Q[q])); }
      moves[k] = m; if (m > lastMove) lastMove = m;
    }
    if (steps % 25 === 24 || lastMove < o.settleMove) {
      lastMoveP99 = Float64Array.from(moves).sort()[Math.floor(0.99 * (N * N - 1))];
      if (lastMove < o.settleMove) { steps++; break; }
    }
  }

  // Rasterize the cloth's triangles onto the grid, keeping the top surface.
  const surface = new Float64Array(G * G).fill(NaN);
  const tri = (a: number, b: number, c: number): void => {
    const ax = P[a * 3] * (G - 1), ay = P[a * 3 + 1] * (G - 1), az = P[a * 3 + 2];
    const bx = P[b * 3] * (G - 1), by = P[b * 3 + 1] * (G - 1), bz = P[b * 3 + 2];
    const cx = P[c * 3] * (G - 1), cy = P[c * 3 + 1] * (G - 1), cz = P[c * 3 + 2];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-12) return;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(G - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(G - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den;
      const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const z = l1 * az + l2 * bz + l3 * cz, k = y * G + x;
      if (!(surface[k] >= z)) surface[k] = z;
    }
  };
  for (let j = 0; j + 1 < N; j++) for (let i = 0; i + 1 < N; i++) {
    const a = j * N + i;
    tri(a, a + 1, a + N + 1);
    tri(a, a + N + 1, a + N);
  }
  let holes = 0, maxPenetration = 0;
  for (let k = 0; k < G * G; k++) {
    if (Number.isNaN(surface[k])) { surface[k] = relief[k]; holes++; }
    maxPenetration = Math.max(maxPenetration, relief[k] - surface[k]);
  }
  return { surface, steps, lastMove, lastMoveP99, settled: lastMove < o.settleMove, holes, maxPenetration };
}
