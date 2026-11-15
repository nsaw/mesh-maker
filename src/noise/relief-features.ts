import type { MeshState } from '../state';
import type { ReliefCrestClipStatus } from '../types';

type ReliefFeatureState = Pick<MeshState, 'mode' | 'noiseType' | 'reliefWallWidth' | 'reliefCellSize'
  | 'distortion' | 'reliefAnisotropy' | 'reliefCrestClipStatus'>;

export interface ReliefRidgeInfo {
  /** Pre-clamp nominal modulation floor, not a bound on generated physical ridge width. */
  nominalRidgeWidthIn: number;
  sampledCrestClipStatus: ReliefCrestClipStatus;
  crestBandDisabled: boolean;
  queryDeformed: boolean;
}

/** Shared warning facts. Observed sampling diagnostics do not establish a global feature minimum. */
export function getReliefRidgeInfo(state: ReliefFeatureState): ReliefRidgeInfo | null {
  if (state.mode !== 'noise' || state.noiseType !== 'voronoi-relief') return null;
  return {
    nominalRidgeWidthIn: 0.15 * state.reliefWallWidth * state.reliefCellSize,
    sampledCrestClipStatus: state.reliefCrestClipStatus,
    crestBandDisabled: state.reliefWallWidth <= 0,
    queryDeformed: state.distortion > 0 || state.reliefAnisotropy > 0,
  };
}

/** A nominal estimate and observed diagnostic, never a measured physical minimum. */
export function reliefRidgeReadout(state: ReliefFeatureState, finishingDiameterIn: number): {text: string; warn: boolean} | null {
  const info = getReliefRidgeInfo(state);
  if (!info) return null;
  const caveats = ['nominal pre-clamp estimate; not a physical minimum'];
  if (info.crestBandDisabled) caveats.push('crest band disabled');
  if (info.sampledCrestClipStatus !== 'none') caveats.push(`observed crest ${info.sampledCrestClipStatus}`);
  if (info.queryDeformed) caveats.push('warp/metric limits');
  return {text: `${info.nominalRidgeWidthIn.toFixed(3)} in; ${caveats.join('; ')}`,
    warn: info.nominalRidgeWidthIn < finishingDiameterIn || info.crestBandDisabled || info.sampledCrestClipStatus !== 'none' || info.queryDeformed};
}
