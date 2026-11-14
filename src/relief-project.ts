import { CURRENT_PAYLOAD_VERSION, DEFAULTS } from './state';
import type { ReliefQueryDescription, ReliefSiteSet } from './types';
import { buildNoiseSurface, NOISE_SURFACE_KEYS, noiseSurfaceParams, type NoiseSurface, type NoiseSurfaceParams } from './noise/surface';
import { describeReliefQuery, sampleReliefParamsFromState } from './noise/voronoi-relief';
import { SIMPLEX_KERNEL_IMPLEMENTATION } from './noise/generators';
import { copyReliefSource, sameReliefKernel, validateReliefSites } from './noise/relief-sites';

export const MAX_PROJECT_BYTES = 1_000_000;
export const MAX_PROJECT_GRID_NODES = 4_194_304;
export type ReliefProjectParams = Omit<NoiseSurfaceParams, 'reliefSites' | 'reliefRevision'>;
export interface ReliefProject { params: ReliefProjectParams; sites: ReliefSiteSet; query: ReliefQueryDescription }
const PARAM_KEYS = NOISE_SURFACE_KEYS.filter((key): key is keyof ReliefProjectParams => key !== 'reliefSites' && key !== 'reliefRevision');
type NumericKey = { [K in keyof ReliefProjectParams]: ReliefProjectParams[K] extends number ? K : never }[keyof ReliefProjectParams];
const RANGES: Record<NumericKey, readonly [number, number, boolean?]> = {
  frequency: [0, 5], cellJitter: [0, 1], amplitude: [0, 2.6], peakExp: [0.01, 16], valleyExp: [0.01, 16], valleyFloor: [0, 1], offset: [-2, 2],
  seed: [-Number.MAX_VALUE, Number.MAX_VALUE], octaves: [1, 8, true], persistence: [0, 1], lacunarity: [0.1, 8], distortion: [0, 2], warpFreq: [0.02, 0.5], warpCurl: [0, 1],
  gaborAngle: [0, 360], gaborBandwidth: [0.01, 8],
  reliefCellSize: [0.2, 6], reliefJitter: [0, 1], reliefRelaxIterations: [0, 2, true], reliefSeamDepth: [0.05, 1], reliefAnisotropy: [0, 2], reliefAnisotropyAngle: [0, 360],
  reliefAttractorX: [0, 1], reliefAttractorY: [0, 1], reliefAttractorRadius: [0.001, 4], reliefAttractorFalloff: [0.05, 8], reliefDensityStrength: [0, 2], reliefIntensityStrength: [0, 1],
  reliefTransitionSoftness: [0, 1], reliefCellSizeGradient: [0, 2], reliefVoidStrength: [0, 1], reliefInvertProfile: [0, 1, true], reliefSeamSharpness: [0, 1],
  reliefAttractorNoise: [0, 1], reliefAttractorNoiseFreq: [0.02, 0.5], reliefBaseAmplitude: [0, 2], reliefBaseFrequency: [0.02, 0.3], reliefWallWidth: [0, 0.5],
  reliefDensityNoise: [0, 1.5], reliefDensityNoiseFreq: [0.02, 0.3], reliefPillow: [0, 1], reliefPillowCoverage: [0, 1], reliefDepthVariation: [0, 1], reliefJunctionLift: [0, 1], reliefCrestVariation: [0, 1],
  reliefRadialFociCount: [0, 3, true], reliefRadialFocus1X: [0, 1], reliefRadialFocus1Y: [0, 1], reliefRadialFocus2X: [0, 1], reliefRadialFocus2Y: [0, 1], reliefRadialFocus3X: [0, 1], reliefRadialFocus3Y: [0, 1],
  reliefRadialStrength: [0, 4], reliefRadialFalloff: [0.02, 0.6], reliefRadialGrow: [0, 2], reliefRadialWarp: [0, 1], meshX: [1, 36], meshY: [1, 24], resolution: [2, 1024, true], smoothRadiusIn: [0, 1], baseThickness: [0.01, 2.6],
};
const ENUMS: Record<string, readonly string[]> = {
  noiseType: ['voronoi-relief'], cellMetric: ['euclidean', 'manhattan', 'chebyshev'], reliefPolarity: ['domes', 'pockets'], reliefProfile: ['hemisphere', 'cosine', 'parabolic'],
  reliefAttractorMode: ['none', 'vertical', 'horizontal', 'radial', 'point'], reliefBaseMode: ['flat', 'wave'], reliefRadialMode: ['rays', 'rings', 'spiral'],
};
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a project object');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(result, key))) throw new Error('Unsupported or incomplete project fields');
  return result;
}
function number(value: unknown): number {
  const n = value === '-0' ? -0 : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('Expected a finite project number');
  return n;
}
function params(value: unknown): ReliefProjectParams {
  const input = record(value, PARAM_KEYS), out: Record<string, unknown> = {};
  for (const key of PARAM_KEYS) {
    const rule = RANGES[key as NumericKey];
    if (rule) {
      const n = number(input[key]);
      if (n < rule[0] || n > rule[1] || (rule[2] && !Number.isInteger(n))) throw new Error(`Unsupported project parameter: ${key}`);
      out[key] = n;
    } else if (typeof DEFAULTS[key] === 'boolean') {
      if (typeof input[key] !== 'boolean') throw new Error(`Expected a boolean: ${key}`);
      out[key] = input[key];
    } else {
      if (typeof input[key] !== 'string' || !ENUMS[key]?.includes(input[key])) throw new Error(`Unsupported project parameter: ${key}`);
      out[key] = input[key];
    }
  }
  const result = out as ReliefProjectParams;
  const rows = Math.max(4, Math.round(result.resolution * result.meshY / result.meshX));
  if (rows * result.resolution > MAX_PROJECT_GRID_NODES) throw new Error('Project exceeds the supported generation grid');
  return Object.freeze(result);
}
function query(value: unknown): ReliefQueryDescription {
  const q = record(value, ['implementation', 'ownerPolicy', 'meshX', 'meshY', 'seed', 'metric', 'warp']);
  if (q.implementation !== 'meshcraft-relief-query/2' || q.ownerPolicy !== 'exact-represented-metric-stable-id-v1') throw new Error('Unsupported relief query implementation');
  const m = record(q.metric, ['cosA', 'sinA', 'scale']), w = record(q.warp, ['amplitude', 'frequency', 'seed', 'kernel']);
  const metric = Object.freeze({cosA: number(m.cosA), sinA: number(m.sinA), scale: number(m.scale)});
  let kernel: ReliefQueryDescription['warp']['kernel'] = null;
  if (w.kernel !== null) {
    const k = record(w.kernel, ['implementation', 'perm', 'grad2']);
    if (k.implementation !== SIMPLEX_KERNEL_IMPLEMENTATION || !Array.isArray(k.perm) || k.perm.length !== 512
      || !Array.isArray(k.grad2) || k.grad2.length !== 12) throw new Error('Unsupported relief warp kernel');
    const perm = k.perm.map(value => {
      const n = number(value);
      if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error('Invalid warp permutation');
      return n;
    });
    const grad2 = k.grad2.map(value => {
      if (!Array.isArray(value) || value.length !== 2) throw new Error('Invalid warp gradient');
      return Object.freeze([number(value[0]), number(value[1])] as const);
    });
    kernel = Object.freeze({implementation: k.implementation, perm: Object.freeze(perm), grad2: Object.freeze(grad2)});
  }
  const warp = Object.freeze({amplitude: number(w.amplitude), frequency: number(w.frequency), seed: number(w.seed), kernel});
  return Object.freeze({implementation: q.implementation, ownerPolicy: q.ownerPolicy, meshX: number(q.meshX), meshY: number(q.meshY), seed: number(q.seed), metric, warp});
}
function checkQuery(settings: ReliefProjectParams, description: ReliefQueryDescription): void {
  const rows = Math.max(4, Math.round(settings.resolution * settings.meshY / settings.meshX));
  const expected = describeReliefQuery(sampleReliefParamsFromState(settings.resolution, rows, settings.meshX, settings.meshY, settings.seed, settings));
  if (!Object.is(expected.meshX, description.meshX) || !Object.is(expected.meshY, description.meshY) || !Object.is(expected.seed, description.seed)
    || Object.keys(expected.metric).some(key => !Object.is(expected.metric[key as keyof typeof expected.metric], description.metric[key as keyof typeof expected.metric]))
    || (['amplitude', 'frequency', 'seed'] as const).some(key => !Object.is(expected.warp[key], description.warp[key]))
    || !sameReliefKernel(expected.warp.kernel, description.warp.kernel)) throw new Error('Project query metadata disagrees with its generation parameters');
}
function bytesToBase64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
function base64ToBytes(value: unknown, count: number): Uint8Array {
  if (typeof value !== 'string' || value.length !== 4 * Math.ceil(count / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Invalid project coordinate encoding');
  const text = atob(value), bytes = Uint8Array.from(text, char => char.charCodeAt(0));
  if (bytes.length !== count || bytesToBase64(bytes) !== value) throw new Error('Noncanonical project coordinate encoding');
  return bytes;
}
function siteWire(sites: ReliefSiteSet): object {
  const bytes = new Uint8Array(sites.xy.length * 8), view = new DataView(bytes.buffer);
  sites.xy.forEach((value, i) => view.setFloat64(i * 8, value, true));
  return {count: sites.ids.length, xyFloat64LE: bytesToBase64(bytes), ids: Array.from(sites.ids), pinned: Array.from(sites.pinned), truncatedFrom: sites.truncatedFrom};
}
function parseSites(value: unknown, width: number, height: number): ReliefSiteSet {
  const wire = record(value, ['count', 'xyFloat64LE', 'ids', 'pinned', 'truncatedFrom']);
  const count = number(wire.count);
  if (!Number.isInteger(count) || count < 0 || count > 4096 || !Array.isArray(wire.ids) || !Array.isArray(wire.pinned)
    || wire.ids.length !== count || wire.pinned.length !== count) throw new Error('Invalid project site count');
  if (wire.ids.some(id => typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id > 0xffffffff)
    || wire.pinned.some(pin => pin !== 0 && pin !== 1)) throw new Error('Invalid project identities or pins');
  const bytes = base64ToBytes(wire.xyFloat64LE, count * 16), view = new DataView(bytes.buffer);
  const sites = {xy: Float64Array.from({length: count * 2}, (_, i) => view.getFloat64(i * 8, true)),
    ids: Uint32Array.from(wire.ids), pinned: Uint8Array.from(wire.pinned), truncatedFrom: number(wire.truncatedFrom)};
  validateReliefSites(sites, width, height);
  return sites;
}

/** Project v1 deliberately excludes image, relief-master and Drape assets. */
export function encodeReliefProject(project: ReliefProject): string {
  const settings = params(project.params), description = query(project.query);
  validateReliefSites(project.sites, settings.meshX, settings.meshY);
  checkQuery(settings, description);
  const wire = {format: 'meshcraft-project', version: 1, kind: 'procedural-voronoi-relief', generation: CURRENT_PAYLOAD_VERSION,
    params: settings, query: description, sites: siteWire(project.sites)};
  const text = JSON.stringify(wire, (_key, value: unknown) => Object.is(value, -0) ? '-0' : value);
  if (text.length > MAX_PROJECT_BYTES) throw new Error('Project exceeds the supported file size');
  return text;
}
export function parseReliefProject(text: string): ReliefProject {
  if (text.length > MAX_PROJECT_BYTES || new TextEncoder().encode(text).length > MAX_PROJECT_BYTES) throw new Error('Project exceeds the supported file size');
  const wire = record(JSON.parse(text), ['format', 'version', 'kind', 'generation', 'params', 'query', 'sites']);
  if (wire.format !== 'meshcraft-project' || wire.version !== 1 || wire.kind !== 'procedural-voronoi-relief' || wire.generation !== CURRENT_PAYLOAD_VERSION) throw new Error('Unsupported project format or generation');
  const settings = params(wire.params), description = query(wire.query), sites = parseSites(wire.sites, settings.meshX, settings.meshY);
  checkQuery(settings, description);
  return {params: settings, sites, query: description};
}
export function copyReliefProject(project: ReliefProject): ReliefProject { return parseReliefProject(encodeReliefProject(project)); }
export function projectSurfaceParams(project: ReliefProject, revision: number): NoiseSurfaceParams {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid project source revision');
  return noiseSurfaceParams({...project.params, reliefSites: project.sites, reliefRevision: revision});
}
export function captureReliefProject(surface: NoiseSurface): ReliefProject {
  const source = surface.reliefSource;
  if (!source || source.params.noiseType !== 'voronoi-relief') throw new Error('Project v1 only supports procedural Voronoi relief');
  const {reliefSites: _sites, reliefRevision: _revision, ...settings} = source.params;
  const copy = copyReliefSource(source);
  return copyReliefProject({params: settings, sites: copy.sites, query: copy.query});
}
/** Regenerate detached geometry before replacing the current authoring document. */
export function preflightReliefProject(project: ReliefProject): void {
  const surface = buildNoiseSurface(projectSurfaceParams(project, 0));
  if (surface.vertices.some(row => row.some(z => !Number.isFinite(z)))) throw new Error('Project did not generate finite geometry');
}

export interface ProjectSave { revision: number; text: string }
/** Private retained copies cannot be detached or mutated by workers, UI readers or past callers. */
export class ReliefProjectHistory {
  private document: ReliefProject;
  private past: ReliefProject[] = [];
  private future: ReliefProject[] = [];
  private gesture: {before: ReliefProject; redo: ReliefProject[]} | null = null;
  private saved: string | null;
  private epoch = 0;
  private importSequence = 0;
  constructor(document: ReliefProject, saved = false) {
    this.document = copyReliefProject(document);
    this.saved = saved ? encodeReliefProject(this.document) : null;
  }
  get revision(): number { return this.epoch; }
  get current(): ReliefProject { return copyReliefProject(this.document); }
  get dirty(): boolean { return this.saved !== encodeReliefProject(this.document); }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  private checkpoint(before: ReliefProject): void { this.past.push(before); if (this.past.length > 50) this.past.shift(); this.future = []; }
  replace(document: ReliefProject, expectedRevision = this.epoch): boolean {
    const candidate = copyReliefProject(document);
    if (expectedRevision !== this.epoch) return false;
    if (this.gesture) throw new Error('Finish the current site gesture first');
    this.checkpoint(this.document); this.document = candidate; this.epoch++;
    return true;
  }
  async open(text: string, preflight: (project: ReliefProject) => Promise<void>): Promise<boolean> {
    const sequence = ++this.importSequence, revision = this.epoch, candidate = parseReliefProject(text);
    await preflight(copyReliefProject(candidate));
    if (sequence !== this.importSequence) return false;
    const accepted = this.replace(candidate, revision);
    if (accepted) this.markSaved(this.captureSave());
    return accepted;
  }
  beginGesture(): void {
    if (this.gesture) throw new Error('A site gesture is already active');
    this.gesture = {before: this.document, redo: this.future};
  }
  updateGesture(document: ReliefProject): void {
    if (!this.gesture) throw new Error('No site gesture is active');
    const candidate = copyReliefProject(document);
    if (encodeReliefProject(candidate) === encodeReliefProject(this.document)) return;
    this.document = candidate; this.future = []; this.epoch++;
  }
  commitGesture(): void {
    if (!this.gesture) throw new Error('No site gesture is active');
    const {before, redo} = this.gesture; this.gesture = null;
    if (encodeReliefProject(before) !== encodeReliefProject(this.document)) this.checkpoint(before);
    else this.future = redo;
  }
  cancelGesture(): void {
    if (!this.gesture) return;
    const {before, redo} = this.gesture; this.gesture = null;
    if (encodeReliefProject(before) !== encodeReliefProject(this.document)) { this.document = before; this.epoch++; }
    this.future = redo;
  }
  undo(): boolean {
    if (this.gesture) throw new Error('Finish the current site gesture first');
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(this.document); this.document = previous; this.epoch++; return true;
  }
  redo(): boolean {
    if (this.gesture) throw new Error('Finish the current site gesture first');
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.document); this.document = next; this.epoch++; return true;
  }
  captureSave(): ProjectSave { return {revision: this.epoch, text: encodeReliefProject(this.document)}; }
  markSaved(save: ProjectSave): boolean {
    if (save.revision !== this.epoch || save.text !== encodeReliefProject(this.document)) return false;
    this.saved = save.text; return true;
  }
}
