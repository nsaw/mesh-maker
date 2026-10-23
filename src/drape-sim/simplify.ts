/**
 * Simplify a mesh too dense for the drape (MAX_FIGURE_TRIANGLES) by vertex clustering (Rossignac and
 * Borrel, 1993): every vertex in a cubic grid cell becomes one vertex at the mean of the cell's members,
 * and a triangle whose corners land in fewer than three cells is dropped. It also welds a triangle soup
 * (a binary STL repeats each vertex per triangle). The first cell is sized from the surface area, so a
 * flat surface (about two triangles per cell) lands near 90% of the cap; the cell is then bisected until
 * the result keeps between a quarter of the cap and the cap. A mesh no cell brings into that band (detail
 * far finer than its spacing) is refused rather than collapsed. Pure: no DOM, shared by the browser and
 * the specs.
 */

export interface MeshArrays { pos: Float32Array; tris: Uint32Array }

/** Cell change per pass until the search has a bound on both sides, then it bisects. */
const CELL_STEP = 1.3;
const MAX_PASSES = 24;
/** Fewest triangles kept, as a share of the cap: below it the clustering has erased the shape. */
const MIN_KEPT = 0.25;

/** One clustering pass at `cell`; null when it keeps more than `maxTris` triangles, or when the grid has
 *  more cells than a cell key can number exactly (2^53; a cell that fine keeps everything anyway). */
function clusterPass(pos: Float32Array, tris: Uint32Array, lo: number[], hi: number[], cell: number, maxTris: number): MeshArrays | null {
  const nx = Math.floor((hi[0] - lo[0]) / cell) + 1, ny = Math.floor((hi[1] - lo[1]) / cell) + 1;
  if (nx * ny * (Math.floor((hi[2] - lo[2]) / cell) + 1) > Number.MAX_SAFE_INTEGER) return null;
  const nv = pos.length / 3, vid = new Int32Array(nv), ids = new Map<number, number>();
  const sums: number[] = [], counts: number[] = [];
  for (let v = 0; v < nv; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const key = Math.floor((x - lo[0]) / cell) + nx * (Math.floor((y - lo[1]) / cell) + ny * Math.floor((z - lo[2]) / cell));
    let c = ids.get(key);
    if (c === undefined) { c = counts.length; ids.set(key, c); sums.push(0, 0, 0); counts.push(0); }
    sums[c * 3] += x; sums[c * 3 + 1] += y; sums[c * 3 + 2] += z; counts[c]++;
    vid[v] = c;
  }
  // Cluster ids key a triangle exactly while they fit in 24 bits (2^48 for the first two corners).
  if (counts.length > 2 ** 24) return null;
  const out = new Uint32Array(Math.min(tris.length, maxTris * 3));
  // Clustering maps neighbouring triangles (and coincident shells) onto the same three cells: keep one
  // of each, in either winding, before counting against the cap.
  const seen = new Map<number, Set<number>>();
  let k = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = vid[tris[t]], b = vid[tris[t + 1]], c = vid[tris[t + 2]];
    if (a === b || b === c || a === c) continue;
    const lo3 = Math.min(a, b, c), hi3 = Math.max(a, b, c), mid = a + b + c - lo3 - hi3;
    const pair = lo3 * 2 ** 24 + mid;
    let thirds = seen.get(pair);
    if (!thirds) { thirds = new Set(); seen.set(pair, thirds); }
    if (thirds.has(hi3)) continue;
    thirds.add(hi3);
    if (k === out.length) return null;
    out[k++] = a; out[k++] = b; out[k++] = c;
  }
  const p = new Float32Array(counts.length * 3);
  for (let c = 0; c < counts.length; c++) for (let i = 0; i < 3; i++) p[c * 3 + i] = sums[c * 3 + i] / counts[c];
  return { pos: p, tris: out.slice(0, k) };
}

/** `m` itself when it has at most `maxTris` triangles, else a clustered copy keeping between MIN_KEPT of
 *  `maxTris` and `maxTris`. Throws if the mesh has no area, or no cell lands in that band. */
export function simplifyMesh(m: MeshArrays, maxTris: number): MeshArrays {
  const { pos, tris } = m;
  if (tris.length / 3 <= maxTris) return m;
  if (!pos.every(Number.isFinite)) throw new Error('the mesh has non-finite coordinates');
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], pos[i + a]); hi[a] = Math.max(hi[a], pos[i + a]); }
  let area = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const i = tris[t] * 3, j = tris[t + 1] * 3, k = tris[t + 2] * 3;
    const ux = pos[j] - pos[i], uy = pos[j + 1] - pos[i + 1], uz = pos[j + 2] - pos[i + 2];
    const vx = pos[k] - pos[i], vy = pos[k + 1] - pos[i + 1], vz = pos[k + 2] - pos[i + 2];
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  let cell = Math.sqrt((2 * area) / (0.9 * maxTris));
  if (!(cell > 0) || !Number.isFinite(cell)) throw new Error('the mesh has no area to simplify');
  let tooFine = 0, tooCoarse = Infinity;                      // cells known to keep too many / too few
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const r = clusterPass(pos, tris, lo, hi, cell, maxTris);
    if (r && r.tris.length / 3 >= MIN_KEPT * maxTris) return r;
    if (r) tooCoarse = cell; else tooFine = cell;
    cell = Number.isFinite(tooCoarse) && tooFine > 0 ? (tooFine + tooCoarse) / 2 : r ? cell / CELL_STEP : cell * CELL_STEP;
  }
  throw new Error(`could not simplify ${(tris.length / 3).toLocaleString()} triangles to between ${(MIN_KEPT * maxTris).toLocaleString()} and ${maxTris.toLocaleString()} without losing its shape`);
}
