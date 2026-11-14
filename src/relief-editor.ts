import { clampCutDepth } from './carve-limits';
import { captureReliefSourceProject, copyReliefProject, parseReliefProject, validateReliefProjectParams, ReliefProjectHistory, MAX_PROJECT_BYTES, type ReliefProject, type ReliefProjectParams, type ProjectSave } from './relief-project';
import { RELIEF_PLACEMENT_KEYS, describeReliefQuery, sampleReliefParamsFromState } from './noise/voronoi-relief';
import { editReliefSite } from './noise/relief-sites';
import type { NoiseSurface } from './noise/surface';
import { noiseGridShape } from './noise/grid-shape';

export const PLACEMENT_KEYS = new Set<keyof ReliefProjectParams>(['noiseType', ...RELIEF_PLACEMENT_KEYS]);
export function projectWithParams(project: ReliefProject, patch: Partial<ReliefProjectParams>): ReliefProject {
  const params = {...project.params, ...patch};
  params.amplitude = clampCutDepth(params.amplitude, params.baseThickness);
  const {cols, rows} = noiseGridShape(params.resolution, params.meshX, params.meshY);
  const query = describeReliefQuery(sampleReliefParamsFromState(cols, rows, params.meshX, params.meshY, params.seed, params));
  return copyReliefProject({...project, params, query});
}
export interface EditorJobs {
  preflight(project: ReliefProject): Promise<void>;
  relax(project: ReliefProject): Promise<ReliefProject>;
  generate(params: ReliefProjectParams): Promise<ReliefProject>;
  cancel(): void;
}

/** One owner for authoring revisions, pending placement, file races and immutable history. */
export class ReliefEditor {
  private history: ReliefProjectHistory | null = null;
  private epoch = 0;
  private importSequence = 0;
  private operation = 0;
  private gesture = false;
  private busy = false;
  onChange: () => void = () => undefined;
  constructor(private readonly jobs: EditorJobs) {}
  get current(): ReliefProject | null { return this.history?.current ?? null; }
  /** Shared read-only document for drawing and lookups; never mutate it. */
  get view(): ReliefProject | null { return this.history?.view ?? null; }
  get revision(): number { return this.epoch; }
  get dirty(): boolean { return this.history?.dirty ?? false; }
  get canUndo(): boolean { return this.history?.canUndo ?? false; }
  get canRedo(): boolean { return this.history?.canRedo ?? false; }
  get gesturing(): boolean { return this.gesture; }
  get running(): boolean { return this.busy; }
  get hasPending(): boolean { return Object.keys(this.history?.pending ?? {}).length > 0; }
  pendingValue(key: keyof ReliefProjectParams): ReliefProjectParams[typeof key] | undefined { return this.history?.pending[key]; }
  private changed(): void { this.epoch++; this.importSequence++; this.operation++; this.jobs.cancel(); this.busy = false; this.onChange(); }
  navigation(): void { this.cancelGesture(); this.changed(); }
  freeze(source: NonNullable<NoiseSurface['reliefSource']>, saved = false): void {
    if (this.history) return;
    this.history = new ReliefProjectHistory(captureReliefSourceProject(source), saved);
    this.changed();
  }
  stage(patch: Partial<ReliefProjectParams>): void {
    if (!this.history) return;
    const before = this.history.view.params, preview = {...before, ...this.history.pending, ...patch};
    preview.amplitude = clampCutDepth(preview.amplitude, preview.baseThickness);
    this.history.stage(Object.fromEntries(Object.entries(preview).filter(([key, value]) => !Object.is(value, before[key as keyof ReliefProjectParams]))), true); this.changed();
  }
  pendingParams(): ReliefProjectParams | null { return this.history ? {...this.history.view.params, ...this.history.pending} : null; }
  discardPending(): void { this.history?.stage({}, true); this.changed(); }
  updateParams(patch: Partial<ReliefProjectParams>): void {
    if (!this.history) return;
    const preview = this.pendingParams()!;
    const placementChanged = Object.entries(patch).some(([key, value]) => PLACEMENT_KEYS.has(key as keyof ReliefProjectParams) && !Object.is(value, preview[key as keyof ReliefProjectParams]));
    if (this.hasPending || placementChanged) { this.stage(patch); return; }
    const candidate = projectWithParams(this.history.current, patch);
    if (this.gesture) this.history.updateGesture(candidate); else this.history.replace(candidate);
    this.changed();
  }
  beginGesture(): void {
    if (!this.history || this.gesture) throw new Error('Freeze cells before editing');
    this.history.beginGesture(); this.gesture = true;
  }
  move(id: number, x: number, y: number): void {
    if (!this.history || !this.gesture) throw new Error('Start a cell gesture first');
    const project = this.history.current;
    project.sites = editReliefSite(project.sites, project.params.meshX, project.params.meshY, {kind: 'move', id, x, y});
    this.history.updateGesture(project); this.changed();
  }
  moveHandle(patch: Partial<ReliefProjectParams>): void {
    if (!this.history || !this.gesture) throw new Error('Start a cell gesture first');
    this.history.stage(patch); this.changed();
  }
  commitGesture(): void { if (this.gesture) { this.history!.commitGesture(); this.gesture = false; this.onChange(); } }
  cancelGesture(): void { if (this.gesture) { this.history!.cancelGesture(); this.gesture = false; this.changed(); } }
  edit(edit: Parameters<typeof editReliefSite>[3]): void {
    if (!this.history) return;
    const project = this.history.current;
    project.sites = editReliefSite(project.sites, project.params.meshX, project.params.meshY, edit);
    if (this.gesture) this.history.updateGesture(project); else this.history.replace(project);
    this.changed();
  }
  pin(id: number, pinned: boolean): void {
    if (!this.history) return;
    const project = this.history.current, index = project.sites.ids.indexOf(id);
    if (index < 0) throw new Error('Unknown relief site');
    project.sites.pinned[index] = Number(pinned);
    this.history.replace(project); this.changed();
  }
  undo(): void { this.cancelGesture(); if (this.history?.undo()) { this.changed(); } }
  redo(): void { this.cancelGesture(); if (this.history?.redo()) { this.changed(); } }
  save(): ProjectSave { if (!this.history) throw new Error('Freeze cells before saving'); return this.history.captureSave(); }
  markSaved(save: ProjectSave): boolean { const saved = this.history?.markSaved(save) ?? false; this.onChange(); return saved; }
  async open(text: string): Promise<boolean> {
    return this.openFile({size: new TextEncoder().encode(text).length, text: async () => text});
  }
  /** Selection owns the read and preflight phases, including when neither has committed yet. */
  async openFile(file: {size: number; text(): Promise<string>}, contextIsCurrent: () => boolean = () => true): Promise<boolean> {
    const epoch = this.epoch, sequence = ++this.importSequence, operation = ++this.operation;
    this.jobs.cancel(); this.busy = true; this.onChange();
    try {
      if (file.size > MAX_PROJECT_BYTES) throw new Error('Project exceeds the supported file size');
      const text = await file.text();
      if (sequence !== this.importSequence || epoch !== this.epoch || !contextIsCurrent()) return false;
      const candidate = parseReliefProject(text);
      await this.jobs.preflight(copyReliefProject(candidate));
      if (sequence !== this.importSequence || epoch !== this.epoch || this.gesture || !contextIsCurrent()) return false;
      if (this.history) this.history.replace(candidate, this.history.revision, true);
      else this.history = new ReliefProjectHistory(candidate);
      this.history.markSaved(this.history.captureSave());
      this.changed(); return true;
    } finally { if (operation === this.operation) { this.busy = false; this.onChange(); } }
  }
  async relax(): Promise<boolean> {
    const project = this.current;
    if (!project || this.gesture || this.hasPending) throw new Error('Apply or discard pending layout changes before relaxing');
    return this.run(() => this.jobs.relax(project));
  }
  async apply(): Promise<boolean> {
    const project = this.current;
    if (!project || this.gesture) throw new Error('Finish editing before applying a layout');
    return this.run(() => this.jobs.generate(validateReliefProjectParams({...project.params, ...this.history!.pending, reliefSites: null, reliefRevision: 0})));
  }
  private async run(job: () => Promise<ReliefProject>): Promise<boolean> {
    const epoch = this.epoch, operation = ++this.operation;
    this.importSequence++;
    this.busy = true; this.onChange();
    try {
      const candidate = await job();
      if (epoch !== this.epoch || operation !== this.operation) return false;
      this.history!.replace(candidate, this.history!.revision, true); this.changed(); return true;
    } finally { if (operation === this.operation) { this.busy = false; this.onChange(); } }
  }
}
