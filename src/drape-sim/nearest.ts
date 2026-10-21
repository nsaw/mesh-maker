/**
 * Nearest point on the figure's surface, precomputed on a voxel grid, for the surface attraction force
 * (Blender's SURFACE force field pulls each cloth vertex toward the nearest point of the figure).
 * Pure: no DOM.
 *
 * Every voxel stores the nearest surface point found for its centre: exact within one voxel of a
 * triangle (seeded per triangle), then carried outward by two forward and backward sweeps that test
 * each neighbour's nearest point (vector distance propagation). A query takes the closest of the 8
 * surrounding voxels' points, so its distance is an upper bound within a fraction of a voxel of the
 * exact one (cli/drape.spec.ts compares it with a brute-force search).
 */

export interface NearestField {
  x0: number; y0: number; z0: number; h: number;
  nx: number; ny: number; nz: number;
  /** Nearest surface point per voxel (xyz), NaN where none was found. */
  points: Float32Array;
}

export interface Box { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5), into `out`. */
export function closestOnTriangle(px: number, py: number, pz: number, t: ArrayLike<number>, a: number, b: number, c: number,
  out: Float64Array): void {
  const ax = t[a], ay = t[a + 1], az = t[a + 2];
  const abx = t[b] - ax, aby = t[b + 1] - ay, abz = t[b + 2] - az;
  const acx = t[c] - ax, acy = t[c + 1] - ay, acz = t[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - t[b], bpy = py - t[b + 1], bpz = pz - t[b + 2];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = t[b]; out[1] = t[b + 1]; out[2] = t[b + 2]; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3); out[0] = ax + v * abx; out[1] = ay + v * aby; out[2] = az + v * abz; return;
  }
  const cpx = px - t[c], cpy = py - t[c + 1], cpz = pz - t[c + 2];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = t[c]; out[1] = t[c + 1]; out[2] = t[c + 2]; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6); out[0] = ax + w * acx; out[1] = ay + w * acy; out[2] = az + w * acz; return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out[0] = t[b] + w * (t[c] - t[b]); out[1] = t[b + 1] + w * (t[c + 1] - t[b + 1]); out[2] = t[b + 2] + w * (t[c + 2] - t[b + 2]); return;
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
}

/** Build the field over `box` (clipped to the figure's bounds grown by `reach`) at voxel size `h`. */
export function buildNearestField(pos: Float32Array, tris: Uint32Array, box: Box, h: number, reach: number): NearestField {
  let fx0 = Infinity, fy0 = Infinity, fz0 = Infinity, fx1 = -Infinity, fy1 = -Infinity, fz1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] < fx0) fx0 = pos[i]; if (pos[i] > fx1) fx1 = pos[i];
    if (pos[i + 1] < fy0) fy0 = pos[i + 1]; if (pos[i + 1] > fy1) fy1 = pos[i + 1];
    if (pos[i + 2] < fz0) fz0 = pos[i + 2]; if (pos[i + 2] > fz1) fz1 = pos[i + 2];
  }
  const x0 = Math.max(box.x0, fx0 - reach) - h, y0 = Math.max(box.y0, fy0 - reach) - h, z0 = Math.max(box.z0, fz0 - reach) - h;
  const x1 = Math.min(box.x1, fx1 + reach) + h, y1 = Math.min(box.y1, fy1 + reach) + h, z1 = Math.min(box.z1, fz1 + reach) + h;
  const nx = Math.max(2, Math.ceil((x1 - x0) / h) + 1), ny = Math.max(2, Math.ceil((y1 - y0) / h) + 1), nz = Math.max(2, Math.ceil((z1 - z0) / h) + 1);
  const n = nx * ny * nz;
  const points = new Float32Array(n * 3).fill(NaN), d2 = new Float32Array(n).fill(Infinity);
  const q = new Float64Array(3);

  // Seed: exact nearest points for voxels within one voxel of each triangle.
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const lo = (k: number, o: number): number => Math.min(pos[a + k], pos[b + k], pos[c + k]) - o;
    const hi = (k: number, o: number): number => Math.max(pos[a + k], pos[b + k], pos[c + k]) + o;
    const i0 = Math.max(0, Math.floor((lo(0, h) - x0) / h)), i1 = Math.min(nx - 1, Math.ceil((hi(0, h) - x0) / h));
    const j0 = Math.max(0, Math.floor((lo(1, h) - y0) / h)), j1 = Math.min(ny - 1, Math.ceil((hi(1, h) - y0) / h));
    const k0 = Math.max(0, Math.floor((lo(2, h) - z0) / h)), k1 = Math.min(nz - 1, Math.ceil((hi(2, h) - z0) / h));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = x0 + i * h, py = y0 + j * h, pz = z0 + k * h;
      closestOnTriangle(px, py, pz, pos, a, b, c, q);
      const dd = (q[0] - px) ** 2 + (q[1] - py) ** 2 + (q[2] - pz) ** 2, v = (k * ny + j) * nx + i;
      if (dd < d2[v]) { d2[v] = dd; points[v * 3] = q[0]; points[v * 3 + 1] = q[1]; points[v * 3 + 2] = q[2]; }
    }
  }

  // Propagate: each voxel adopts a neighbour's nearest point when it is closer. The forward sweep reads
  // the 13 neighbours already visited, the backward sweep the other 13.
  const offs: number[][] = [];
  for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if (dk < 0 || (dk === 0 && (dj < 0 || (dj === 0 && di < 0)))) offs.push([di, dj, dk]);
  }
  const relax = (i: number, j: number, k: number, sign: number): void => {
    const v = (k * ny + j) * nx + i, px = x0 + i * h, py = y0 + j * h, pz = z0 + k * h;
    let best = d2[v];
    for (const [di, dj, dk] of offs) {
      const ii = i + sign * di, jj = j + sign * dj, kk = k + sign * dk;
      if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
      const u = (kk * ny + jj) * nx + ii;
      if (d2[u] === Infinity) continue;
      const qx = points[u * 3], qy = points[u * 3 + 1], qz = points[u * 3 + 2];
      const dd = (qx - px) ** 2 + (qy - py) ** 2 + (qz - pz) ** 2;
      if (dd < best) { best = dd; d2[v] = dd; points[v * 3] = qx; points[v * 3 + 1] = qy; points[v * 3 + 2] = qz; }
    }
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) relax(i, j, k, 1);
    for (let k = nz - 1; k >= 0; k--) for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) relax(i, j, k, -1);
  }
  return { x0, y0, z0, h, nx, ny, nz, points };
}

/** Nearest surface point to (px, py, pz) into `out`; returns its distance, or Infinity outside the
 *  field. */
export function nearestPoint(f: NearestField, px: number, py: number, pz: number, out: Float64Array): number {
  const fi = (px - f.x0) / f.h, fj = (py - f.y0) / f.h, fk = (pz - f.z0) / f.h;
  const i0 = Math.floor(fi), j0 = Math.floor(fj), k0 = Math.floor(fk);
  if (i0 < 0 || j0 < 0 || k0 < 0 || i0 >= f.nx - 1 || j0 >= f.ny - 1 || k0 >= f.nz - 1) return Infinity;
  let best = Infinity;
  const pts = f.points;
  for (let c = 0; c < 8; c++) {
    const v = ((k0 + (c >> 2)) * f.ny + j0 + ((c >> 1) & 1)) * f.nx + i0 + (c & 1);
    const qx = pts[v * 3];
    if (qx !== qx) continue;                                            // NaN: no point stored
    const qy = pts[v * 3 + 1], qz = pts[v * 3 + 2];
    const dd = (qx - px) ** 2 + (qy - py) ** 2 + (qz - pz) ** 2;
    if (dd < best) { best = dd; out[0] = qx; out[1] = qy; out[2] = qz; }
  }
  return Math.sqrt(best);
}
