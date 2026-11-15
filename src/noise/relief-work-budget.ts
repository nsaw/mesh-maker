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

/** Run before constructing SiteGrid, whose spacing seed queries also expand coincidence. */
export function assertFrozenReliefWork(p: WorkShape, sites: ReliefSiteSet, additionalQueries = 0): void {
  if (frozenReliefQueryWork(p, sites, additionalQueries) > MAX_FROZEN_RELIEF_QUERY_WORK) {
    throw new Error('Frozen relief exceeds the supported coincident-site query work. Reduce coincident sites or output grid density.');
  }
}
