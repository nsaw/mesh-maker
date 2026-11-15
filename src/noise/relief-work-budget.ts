import type { ReliefSiteSet } from '../types';

export const RELIEF_WALL_MIN_PHYS = 0.3;
const CELL_MEASUREMENT_PITCH_IN = RELIEF_WALL_MIN_PHYS / 4;
const CELL_MEASUREMENT_MAX = 320000;

/** Physical quadrature is shared by admission and generation, independent of output density. */
export function reliefMeasurementShape(meshX: number, meshY: number): {cols: number; rows: number} {
  let cols = Math.max(2, Math.ceil(meshX / CELL_MEASUREMENT_PITCH_IN) + 1);
  let rows = Math.max(4, Math.ceil(meshY / CELL_MEASUREMENT_PITCH_IN) + 1);
  if (cols * rows > CELL_MEASUREMENT_MAX) {
    const scale = Math.sqrt(CELL_MEASUREMENT_MAX / (cols * rows));
    cols = Math.min(CELL_MEASUREMENT_MAX / 4, Math.max(2, Math.floor(cols * scale)));
    rows = Math.min(Math.floor(CELL_MEASUREMENT_MAX / cols), Math.max(4, Math.floor(rows * scale)));
  }
  return {cols, rows};
}

// Admission estimates query count times the largest exact-coordinate group, not elapsed
// time or total query operations. The budget is four times the project output-node cap:
// distributed populations remain admitted while coincidence cannot expand work without limit.
export const MAX_FROZEN_RELIEF_QUERY_WORK = 16_777_216;
interface WorkShape { cols: number; rows: number; meshX: number; meshY: number }

/** A separate resource policy. Validation/serialization keep every coordinate and identity. */
export function frozenReliefQueryWork(p: WorkShape, sites: ReliefSiteSet, additionalQueries = 0): number {
  if (![p.cols, p.rows, additionalQueries].every(value => Number.isSafeInteger(value) && value >= 0)
    || p.cols < 2 || p.rows < 2 || !Number.isFinite(p.meshX) || !Number.isFinite(p.meshY) || p.meshX <= 0 || p.meshY <= 0) {
    throw new Error('Invalid frozen relief work dimensions');
  }
  const groups = new Map<string, number>();
  let largestGroup = 0;
  for (let i = 0; i < sites.ids.length; i++) {
    // Signed zero compares equal in geometric queries, but the original arrays remain untouched.
    const key = `${sites.xy[i * 2]},${sites.xy[i * 2 + 1]}`;
    const count = (groups.get(key) ?? 0) + 1;
    groups.set(key, count); largestGroup = Math.max(largestGroup, count);
  }
  const measurement = reliefMeasurementShape(p.meshX, p.meshY);
  // One quadrature query per physical node, one per output node, one anchor per site,
  // and one index-spacing seed query per site, before optional explicit relaxation.
  const queries = measurement.cols * measurement.rows + p.cols * p.rows + 2 * sites.ids.length + additionalQueries;
  if (!Number.isSafeInteger(queries)) throw new Error('Invalid frozen relief query work');
  const work = queries * largestGroup;
  if (!Number.isSafeInteger(work)) throw new Error('Invalid frozen relief query work');
  return work;
}

// Every relief query averages its fields over the sites within RELIEF_SUPPORT_RATIO times
// its nearest distance (voronoi-relief.ts), and its boundary search visits about as many.
// Far from a packed cluster that support holds the whole cluster, so work grows with
// queries x cluster size even when no two sites coincide. Measured on the producer at
// 70-125 ns per support visit, the budget is about 20-35 s of worker time. It refuses the
// #82 probes (4,096 sites in 0.64 in at resolution 100, about 3.3e8 visits; 961 sites at
// link precision at resolution 400, about 3.6e8) and keeps a board with half its cells
// deleted at resolution 400 (about 1.8e8) and 4,096 distributed sites at the maximum
// output grid (about 1e7) admitted.
export const RELIEF_SUPPORT_RATIO = 2.08;
const SUPPORT_SAMPLE_TARGET = 4096;
export const MAX_FROZEN_RELIEF_SUPPORT_VISITS = 268_435_456;

/** Estimated support visits of every query. Exact nearest and support counts at a fixed
 * board lattice of sample points stand for the evenly spread quadrature and output
 * queries. A deterministic resource estimate, not a bound on elapsed time. */
export function frozenReliefSupportVisits(p: WorkShape, sites: ReliefSiteSet, additionalQueries = 0): number {
  // Shares validation and the query count with coincidence admission.
  frozenReliefQueryWork(p, sites, additionalQueries);
  const n = sites.ids.length;
  if (n === 0) return 0;
  const measurement = reliefMeasurementShape(p.meshX, p.meshY);
  const queries = measurement.cols * measurement.rows + p.cols * p.rows + 2 * n + additionalQueries;
  // Buckets at the even-layout spacing hold about one site each in distributed layouts.
  const spacing = Math.sqrt(p.meshX * p.meshY / n);
  const bc = Math.max(1, Math.min(4 * n, Math.ceil(p.meshX / spacing)));
  const br = Math.max(1, Math.min(4 * n, Math.ceil(p.meshY / spacing)));
  const cx = bc / p.meshX, cy = br / p.meshY;
  const column = (x: number): number => Math.max(0, Math.min(bc - 1, Math.floor(x * cx)));
  const row = (y: number): number => Math.max(0, Math.min(br - 1, Math.floor(y * cy)));
  const start = new Int32Array(bc * br + 1), order = new Int32Array(n);
  for (let i = 0; i < n; i++) start[row(sites.xy[i * 2 + 1]) * bc + column(sites.xy[i * 2]) + 1]++;
  for (let k = 0; k < bc * br; k++) start[k + 1] += start[k];
  const fill = start.slice(0, bc * br);
  for (let i = 0; i < n; i++) order[fill[row(sites.xy[i * 2 + 1]) * bc + column(sites.xy[i * 2])]++] = i;
  const bucketWidth = p.meshX / bc, bucketHeight = p.meshY / br;
  const occupied: number[] = [];
  for (let k = 0; k < bc * br; k++) if (start[k + 1] > start[k]) occupied.push(k);
  // Distance from (x, y) to bucket k's rectangle, and to its farthest corner.
  const near = (k: number, x: number, y: number): number => {
    const i = k % bc, j = (k - i) / bc;
    const gx = Math.max(0, i * bucketWidth - x, x - (i + 1) * bucketWidth);
    const gy = Math.max(0, j * bucketHeight - y, y - (j + 1) * bucketHeight);
    return Math.hypot(gx, gy);
  };
  const far = (k: number, x: number, y: number): number => {
    const i = k % bc, j = (k - i) / bc;
    return Math.hypot(Math.max(Math.abs(x - i * bucketWidth), Math.abs(x - (i + 1) * bucketWidth)),
      Math.max(Math.abs(y - j * bucketHeight), Math.abs(y - (j + 1) * bucketHeight)));
  };
  const siteDistance = (site: number, x: number, y: number): number =>
    Math.hypot(sites.xy[site * 2] - x, sites.xy[site * 2 + 1] - y);
  // The two nearest sites (distance, index), by ring search while it is cheaper than the
  // occupied-bucket list, then the list.
  const nearestTwo = (x: number, y: number): [number, number, number, number] => {
    const ci = column(x), cj = row(y);
    let d1 = Infinity, i1 = -1, d2 = Infinity, i2 = -1, visited = 0;
    const consider = (site: number): void => {
      const d = siteDistance(site, x, y);
      if (d < d1) { d2 = d1; i2 = i1; d1 = d; i1 = site; } else if (d < d2) { d2 = d; i2 = site; }
    };
    for (let ring = 0; visited <= occupied.length; ring++) {
      const i0 = ci - ring, i1r = ci + ring, j0 = cj - ring, j1 = cj + ring;
      for (let j = Math.max(0, j0); j <= Math.min(br - 1, j1); j++) {
        const edge = j === j0 || j === j1;
        for (let i = Math.max(0, i0); i <= Math.min(bc - 1, i1r); i += edge || i >= i1r ? 1 : i1r - i) {
          visited++;
          for (let k = start[j * bc + i]; k < start[j * bc + i + 1]; k++) consider(order[k]);
        }
      }
      // Unvisited buckets lie at least `ring` whole buckets away in some axis.
      if (d2 <= ring * Math.min(bucketWidth, bucketHeight)
        || (i0 <= 0 && j0 <= 0 && i1r >= bc - 1 && j1 >= br - 1)) return [d1, i1, d2, i2];
    }
    d1 = Infinity; i1 = -1; d2 = Infinity; i2 = -1;
    for (const k of occupied) {
      if (near(k, x, y) >= d2) continue;
      for (let m = start[k]; m < start[k + 1]; m++) consider(order[m]);
    }
    return [d1, i1, d2, i2];
  };
  // The producer scans max(support, f1 + 2B) around each query, where B, the boundary seed,
  // is at most the bisector distance to the second-nearest site, (f2^2 - f1^2) / (2 d12).
  const searchRadius = (x: number, y: number): number => {
    const [f1, s1, f2, s2] = nearestTwo(x, y);
    let radius = RELIEF_SUPPORT_RATIO * Math.max(f1, 1e-9);
    if (s2 >= 0 && Number.isFinite(f2)) {
      const d12 = siteDistance(s2, sites.xy[s1 * 2], sites.xy[s1 * 2 + 1]);
      if (d12 > 0) radius = Math.max(radius, f1 + (f2 * f2 - f1 * f1) / d12);
    }
    return radius;
  };
  const supportCount = (x: number, y: number, radius: number): number => {
    let count = 0;
    const visit = (k: number): void => {
      if (start[k + 1] === start[k] || near(k, x, y) >= radius) return;
      if (far(k, x, y) < radius) { count += start[k + 1] - start[k]; return; }
      for (let m = start[k]; m < start[k + 1]; m++) if (siteDistance(order[m], x, y) < radius) count++;
    };
    const i0 = column(x - radius), i1 = column(x + radius), j0 = row(y - radius), j1 = row(y + radius);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > occupied.length) for (const k of occupied) visit(k);
    else for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) visit(j * bc + i);
    return Math.max(1, count);
  };
  const sc = Math.max(2, Math.min(SUPPORT_SAMPLE_TARGET, Math.round(Math.sqrt(SUPPORT_SAMPLE_TARGET * p.meshX / p.meshY))));
  const sr = Math.max(2, Math.round(SUPPORT_SAMPLE_TARGET / sc));
  let visits = 0;
  for (let j = 0; j < sr; j++) for (let i = 0; i < sc; i++) {
    const x = (i + 0.5) / sc * p.meshX, y = (j + 0.5) / sr * p.meshY;
    visits += supportCount(x, y, searchRadius(x, y));
  }
  const estimate = Math.ceil(queries * (visits / (sc * sr)));
  if (!Number.isSafeInteger(estimate)) throw new Error('Invalid frozen relief query work');
  return estimate;
}

/** Run before constructing SiteGrid, whose spacing seed queries also expand coincidence. */
export function assertFrozenReliefWork(p: WorkShape, sites: ReliefSiteSet, additionalQueries = 0): void {
  if (frozenReliefQueryWork(p, sites, additionalQueries) > MAX_FROZEN_RELIEF_QUERY_WORK
    || frozenReliefSupportVisits(p, sites, additionalQueries) > MAX_FROZEN_RELIEF_SUPPORT_VISITS) {
    throw new Error('Frozen relief exceeds the supported coincident-site query work. Reduce coincident or tightly clustered sites, or output grid density.');
  }
}
