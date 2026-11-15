/** Strict JSON/model numeric boundary; strings and other coercible values are not numbers. */
export function isFiniteNumeric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Semantic count domains are independent of a control's preferred keyboard increment. */
export interface NumericDomain { quantum: number; rounding: 'floor' | 'nearest' }

const COUNT_DOMAINS: Readonly<Record<string, NumericDomain>> = Object.fromEntries([
  'resolution', 'octaves', 'reliefRelaxIterations',
  'reliefRadialFociCount', 'reliefInvertProfile', 'drapeFrames', 'drapeAttractStart',
  'drapeAttractFull', 'drapeFaceStart', 'drapeFaceFull', 'drapeWindStart', 'drapeWindFull',
  'drapeSubsteps', 'drapeIterations', 'drapeSubdivisions',
].map(key => [key, { quantum: 1, rounding: 'floor' } satisfies NumericDomain]));

export function numericDomain(key: string): NumericDomain | undefined {
  // The cloth solver requires even quads across to retain a vertex on the crown.
  return key === 'drapeClothRes' ? { quantum: 2, rounding: 'nearest' } : COUNT_DOMAINS[key];
}

/** Quantize count domains within legal bounds; continuous physical values retain all digits. */
export function normalizeNumericValue(value: number, min: number, max: number, domain?: NumericDomain): number {
  if (!domain) return Math.max(min, Math.min(max, value));
  const lower = Math.ceil(min / domain.quantum), upper = Math.floor(max / domain.quantum);
  if (lower > upper) throw new Error('Numeric domain has no value within its bounds');
  const units = value / domain.quantum;
  const count = domain.rounding === 'floor' ? Math.floor(units) : Math.round(units);
  return Math.max(lower, Math.min(upper, count)) * domain.quantum;
}
