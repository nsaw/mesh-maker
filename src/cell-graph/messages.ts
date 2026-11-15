import type { ReliefSourceSnapshot } from '../types';
import type { CellGraphResult } from './graph';
export interface CellGraphWorkerRequest {
  readonly id: number;
  readonly revision: number;
  readonly source: ReliefSourceSnapshot;
  readonly maxSteps?: number;
}
export interface CellGraphWorkerResponse {
  readonly id: number;
  readonly revision: number;
  readonly result: CellGraphResult;
}
