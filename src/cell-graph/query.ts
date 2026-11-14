import type { ReliefQueryDescription } from '../types';
import { SimplexNoiseGen } from '../noise/generators';
import { sameReliefKernel } from '../noise/relief-sites';

/** Bind every certificate to the actual producer owner policy and runtime coefficients. */
export function validateCellGraphQuery(query: ReliefQueryDescription): void {
  if (query.implementation !== 'meshcraft-relief-query/2'
    || query.ownerPolicy !== 'exact-represented-metric-stable-id-v1')
    throw new Error('Unsupported cell graph query implementation or owner policy');
  const {cosA, sinA, scale} = query.metric;
  const {amplitude, frequency, seed, kernel} = query.warp;
  if (!Number.isInteger(query.seed) || query.seed < 0 || query.seed > 0xffffffff
    || seed !== query.seed + 30 || !Number.isFinite(amplitude) || amplitude < 0
    || !Number.isFinite(frequency) || frequency < 0.02)
    throw new Error('Invalid cell graph producer query metadata');
  if (scale <= 1.0001 && (scale !== 1 || cosA !== 1 || sinA !== 0))
    throw new Error('Noncanonical producer isotropic metric');
  if (![cosA, sinA, scale].every(Number.isFinite) || scale < 1
    || Math.abs(cosA * cosA + sinA * sinA - 1) > 1e-12)
    throw new Error('Invalid cell graph effective metric');
  const expected = amplitude > 0 ? new SimplexNoiseGen(seed).describeKernel() : null;
  if (!sameReliefKernel(expected, kernel))
    throw new Error('Unsupported actual Simplex kernel for graph certification');
}
