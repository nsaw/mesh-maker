import { captureReliefProject, copyReliefProject, preflightReliefProject, projectSurfaceParams, validateReliefProjectParams, type ReliefProject, type ReliefProjectParams } from './relief-project';
import { buildNoiseSurface } from './noise/surface';
import { noiseGridShape } from './noise/grid-shape';
import { relaxReliefSites, sampleReliefParamsFromState } from './noise/voronoi-relief';

export type EditorInput = {kind: 'preflight' | 'relax'; project: ReliefProject} | {kind: 'generate'; params: ReliefProjectParams};
export type EditorOutput = {ok: true; project: ReliefProject} | {ok: false; reason: string};
export function runEditorJob(input: EditorInput): ReliefProject {
  if (input.kind === 'generate') {
    const params = validateReliefProjectParams({...input.params, reliefSites: null, reliefRevision: 0});
    return captureReliefProject(buildNoiseSurface({...params, reliefSites: null, reliefRevision: 0}));
  }
  const project = copyReliefProject(input.project);
  if (input.kind === 'relax') {
    const p = projectSurfaceParams(project, 0), {cols, rows} = noiseGridShape(p.resolution, p.meshX, p.meshY);
    project.sites = relaxReliefSites(sampleReliefParamsFromState(cols, rows, p.meshX, p.meshY, p.seed, p), project.sites);
  }
  preflightReliefProject(project);
  return project;
}
// This module is also imported by Node tests; only a dedicated Worker installs the handler.
if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = (event: MessageEvent<EditorInput>): void => {
    let result: EditorOutput;
    try { result = {ok: true, project: runEditorJob(event.data)}; }
    catch (error: unknown) { result = {ok: false, reason: error instanceof Error ? error.message : String(error)}; }
    globalThis.postMessage(result);
  };
}
