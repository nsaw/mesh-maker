import type { ReliefSiteSet, ReliefSourceSnapshot, ReliefQueryDescription } from '../types';

export const MAX_RELIEF_SITES = 4096;

/** Every retained owner keeps its identity, even when a coincident site owns no area. */
export function copyReliefSites(sites: ReliefSiteSet): ReliefSiteSet {
  return { xy: sites.xy.slice(), ids: sites.ids.slice(), pinned: sites.pinned.slice(), truncatedFrom: sites.truncatedFrom };
}

/** Validate without clamping or dropping coincident producer sites. Returns their duplicate count. */
export function validateReliefSites(sites: ReliefSiteSet, width: number, height: number): number {
  if (!(sites.xy instanceof Float64Array) || !(sites.ids instanceof Uint32Array) || !(sites.pinned instanceof Uint8Array)
    || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Invalid relief sites');
  const n = sites.ids.length;
  if (n > MAX_RELIEF_SITES || sites.xy.length !== n * 2 || sites.pinned.length !== n
    || !Number.isSafeInteger(sites.truncatedFrom) || (sites.truncatedFrom !== 0 && (n !== MAX_RELIEF_SITES || sites.truncatedFrom <= n))
    || sites.truncatedFrom > 5_000_000) throw new Error('Invalid relief site lengths or candidate count');
  const seen = new Set<string>();
  let duplicates = 0;
  for (let i = 0; i < n; i++) {
    const x = sites.xy[i * 2], y = sites.xy[i * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > width || y < 0 || y > height
      || (i > 0 && sites.ids[i] <= sites.ids[i - 1]) || sites.pinned[i] > 1) throw new Error('Invalid relief coordinate, identity or pin');
    const key = `${x},${y}`;
    if (seen.has(key)) duplicates++;
    seen.add(key);
  }
  return duplicates;
}

/** Edit a detached copy. Existing coincident producer sites remain lossless; new coincidences refuse. */
export function editReliefSite(sites: ReliefSiteSet, width: number, height: number,
  edit: { kind: 'move'; id: number; x: number; y: number } | { kind: 'add'; x: number; y: number } | { kind: 'erase'; id: number }): ReliefSiteSet {
  validateReliefSites(sites, width, height);
  const index = edit.kind === 'add' ? -1 : sites.ids.indexOf(edit.id);
  if (edit.kind !== 'add' && index < 0) throw new Error('Unknown relief site');
  if (edit.kind === 'move' && sites.xy[index * 2] === edit.x && sites.xy[index * 2 + 1] === edit.y) {
    const result = copyReliefSites(sites); result.xy[index * 2] = edit.x; result.xy[index * 2 + 1] = edit.y; return result;
  }
  if (edit.kind !== 'erase') {
    if (!Number.isFinite(edit.x) || !Number.isFinite(edit.y) || edit.x < 0 || edit.x > width || edit.y < 0 || edit.y > height) throw new Error('Site must stay inside the board');
    for (let i = 0; i < sites.ids.length; i++) {
      if (i !== index && sites.xy[i * 2] === edit.x && sites.xy[i * 2 + 1] === edit.y) throw new Error('A site already occupies that coordinate');
    }
  }
  if (edit.kind === 'move') {
    const result = copyReliefSites(sites);
    result.xy[index * 2] = edit.x; result.xy[index * 2 + 1] = edit.y;
    return result;
  }
  if (edit.kind === 'add' && sites.ids.length >= MAX_RELIEF_SITES) throw new Error('Relief site limit reached');
  let addedId = (sites.ids[sites.ids.length - 1] ?? -1) + 1;
  if (addedId > 0xffffffff) {
    addedId = 0;
    for (const id of sites.ids) {
      if (id !== addedId) break;
      addedId++;
    }
  }
  const kept = Array.from({length: sites.ids.length}, (_, i) => i).filter(i => i !== index);
  if (edit.kind === 'add') {
    const before = kept.findIndex(i => sites.ids[i] > addedId);
    kept.splice(before < 0 ? kept.length : before, 0, -1);
  }
  const count = kept.length;
  const result: ReliefSiteSet = { xy: new Float64Array(count * 2), ids: new Uint32Array(count), pinned: new Uint8Array(count), truncatedFrom: 0 };
  kept.forEach((old, i) => {
    if (old < 0 && edit.kind === 'add') {
      result.xy.set([edit.x, edit.y], i * 2); result.ids[i] = addedId;
    } else {
      result.xy.set(sites.xy.subarray(old * 2, old * 2 + 2), i * 2);
      result.ids[i] = sites.ids[old]; result.pinned[i] = sites.pinned[old];
    }
  });
  return result;
}

/** Clone the producer description before publishing it across an ownership boundary. */
export function copyReliefSource(source: ReliefSourceSnapshot): ReliefSourceSnapshot {
  const sites = copyReliefSites(source.sites);
  const kernel = source.query.warp.kernel;
  const copiedKernel = kernel ? Object.freeze({...kernel, perm: Object.freeze([...kernel.perm]),
    grad2: Object.freeze(kernel.grad2.map(g => Object.freeze([g[0], g[1]] as const)))}) : null;
  const query = Object.freeze({...source.query, metric: Object.freeze({...source.query.metric}),
    warp: Object.freeze({...source.query.warp, kernel: copiedKernel})});
  return Object.freeze({ get sites() { return copyReliefSites(sites); }, query });
}

/** Compare represented kernel coefficients, including signed zero, without JSON coercion. */
export function sameReliefKernel(a: ReliefQueryDescription['warp']['kernel'], b: ReliefQueryDescription['warp']['kernel']): boolean {
  if (a === null || b === null) return a === b;
  return a.implementation === b.implementation && a.perm.length === b.perm.length && a.grad2.length === b.grad2.length
    && a.perm.every((value, i) => Object.is(value, b.perm[i]))
    && a.grad2.every((g, i) => g.length === b.grad2[i].length && g.every((value, j) => Object.is(value, b.grad2[i][j])));
}
