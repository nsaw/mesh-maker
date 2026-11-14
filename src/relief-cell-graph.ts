import { CellGraphController } from './cell-graph/controller';
import type { CellGraph, CellGraphResult } from './cell-graph/graph';
import { noiseGeneration } from './noise/controller';
import { noiseSurfaceParams } from './noise/surface';
import { STATE } from './state';

const controller = new CellGraphController();
let completed: CellGraph | null = null;
let pending: {revision: number; promise: Promise<CellGraphResult>} | null = null;
let refusal = '';
let changed: () => void = () => undefined;
export function setCellGraphListener(listener: () => void): void { changed = listener; }
function current(revision: number): boolean {
  return STATE.mode === 'noise' && STATE.noiseType === 'voronoi-relief' && noiseGeneration.isRevisionCurrent(revision)
    && noiseGeneration.exportBlock(noiseSurfaceParams(STATE)) === null;
}
export function completedCellGraph(): CellGraph | null { return completed && current(completed.revision) ? completed : null; }
export function cellGraphStatus(): string {
  if (pending) return 'Preparing cell boundaries in Worker.';
  if (refusal) return `Cell boundaries unavailable: ${refusal}`;
  return completedCellGraph() ? 'Cell boundaries and DXF use this completed source. Cell edges are not toolpaths or a ridge-width measurement.' : 'Cell boundaries wait for the completed relief.';
}
export function cancelCellGraph(): void {
  controller.cancel('The relief source changed.'); pending = null; completed = null; refusal = ''; changed();
}
export function requestCellGraph(): Promise<CellGraphResult> {
  const source = noiseGeneration.completedReliefSource(), revision = noiseGeneration.sourceRevision;
  if (!source || !current(revision)) return Promise.resolve({ok: false, reason: 'Generate a full-resolution procedural Voronoi relief first.'});
  if (completedCellGraph()) return Promise.resolve({ok: true, graph: completed!});
  if (pending?.revision === revision) return pending.promise;
  const promise = controller.request({source, revision, isCurrent: current}).then(result => {
    if (pending?.promise !== promise) return {ok: false, reason: 'The relief source changed.'} as const;
    pending = null;
    if (!current(revision)) return {ok: false, reason: 'The relief source changed.'} as const;
    if (result.ok) { completed = result.graph; refusal = ''; } else { completed = null; refusal = result.reason; }
    changed(); return result;
  });
  pending = {revision, promise}; changed(); return promise;
}
noiseGeneration.subscribeInvalidation(cancelCellGraph);
