import { MAX_CUT_DEPTH_IN } from './sbp/types';

/** Shared effective cut depth for control edits and exact procedural documents. */
export function clampCutDepth(requested: number, stock: number): number {
  if (requested <= 0) return requested === 0 ? requested : 0;
  return Math.min(requested, stock, MAX_CUT_DEPTH_IN);
}
