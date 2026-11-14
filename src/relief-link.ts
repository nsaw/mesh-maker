import type { ReliefSiteSet } from './types';
import { validateReliefSites } from './noise/relief-sites';

export const MAX_LINK_SITES = 1000;
export const MAX_RELIEF_LINK_BYTES = 100_000;
interface SiteLink { version: 1; count: number; coordinates: string; identities: string; pins: string }

function encode(bytes: Uint8Array): string {
  let text = '';
  for (const value of bytes) text += String.fromCharCode(value);
  return btoa(text);
}
function decode(value: unknown, length: number): Uint8Array {
  if (typeof value !== 'string' || value.length !== 4 * Math.ceil(length / 3)) throw new Error('Invalid cell link encoding');
  const text = atob(value), bytes = Uint8Array.from(text, char => char.charCodeAt(0));
  if (bytes.length !== length || encode(bytes) !== value) throw new Error('Invalid cell link encoding');
  return bytes;
}
function uniqueCoordinates(sites: ReliefSiteSet): void {
  const seen = new Set<string>();
  for (let i = 0; i < sites.ids.length; i++) {
    const key = `${sites.xy[i * 2]},${sites.xy[i * 2 + 1]}`;
    if (seen.has(key)) throw new Error('Cells overlap at link precision; use Save project');
    seen.add(key);
  }
}

/** Links use hundredths of an inch. Exact projects retain the original Float64 coordinates. */
export function encodeReliefLink(sites: ReliefSiteSet, width: number, height: number): SiteLink {
  validateReliefSites(sites, width, height);
  if (sites.ids.length > MAX_LINK_SITES) throw new Error('Too many cells for a link; use Save project');
  if (width > 36 || height > 24) throw new Error('Cell link exceeds the machine bed');
  const coordinates = new Uint8Array(sites.xy.length * 2), xy = new DataView(coordinates.buffer);
  const identities = new Uint8Array(sites.ids.length * 4), ids = new DataView(identities.buffer);
  const quantized: ReliefSiteSet = { xy: new Float64Array(sites.xy.length), ids: sites.ids.slice(), pinned: sites.pinned.slice(), truncatedFrom: 0 };
  for (let i = 0; i < sites.xy.length; i++) {
    // A board edge between hundredths rounds inward rather than placing a site outside it.
    const bound = i % 2 === 0 ? width : height;
    const value = Math.min(Math.round(sites.xy[i] * 100), Math.floor(bound * 100));
    xy.setInt16(i * 2, value, true);
    quantized.xy[i] = value / 100;
  }
  uniqueCoordinates(quantized);
  sites.ids.forEach((id, i) => ids.setUint32(i * 4, id, true));
  return {version: 1, count: sites.ids.length, coordinates: encode(coordinates), identities: encode(identities), pins: encode(sites.pinned)};
}

export function decodeReliefLink(value: unknown, width: number, height: number): ReliefSiteSet {
  if (width > 36 || height > 24) throw new Error('Cell link exceeds the machine bed');
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cell link');
  const wire = value as Record<string, unknown>;
  const keys = ['version', 'count', 'coordinates', 'identities', 'pins'];
  if (Object.keys(wire).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(wire, key)) || wire.version !== 1
    || typeof wire.count !== 'number' || !Number.isInteger(wire.count) || wire.count < 0 || wire.count > MAX_LINK_SITES)
    throw new Error('Unsupported cell link');
  const coordinates = decode(wire.coordinates, wire.count * 4), xy = new DataView(coordinates.buffer);
  const identities = decode(wire.identities, wire.count * 4), ids = new DataView(identities.buffer);
  const sites: ReliefSiteSet = {xy: Float64Array.from({length: wire.count * 2}, (_, i) => xy.getInt16(i * 2, true) / 100),
    ids: Uint32Array.from({length: wire.count}, (_, i) => ids.getUint32(i * 4, true)), pinned: decode(wire.pins, wire.count), truncatedFrom: 0};
  validateReliefSites(sites, width, height);
  uniqueCoordinates(sites);
  return sites;
}
