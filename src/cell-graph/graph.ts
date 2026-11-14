import { validateCellGraphQuery } from './query';
import type { ReliefSourceSnapshot } from '../types';
import { copyReliefSource, validateReliefSites } from '../noise/relief-sites';
import { compareDirections, emitCoordinate, exactDiagram, pointSegmentDistanceSquared, rectangle, segmentsIntersect } from './exact-diagram';
import type { ExactEdge, GraphBudget } from './exact-diagram';
import { add, compare, cross, delta, dot, exact, mul, point, pointKey, rational, samePoint, square } from './rational';
import type { ExactPoint } from './rational';

export interface CellGraphNode { readonly id: string; readonly x: number; readonly y: number; readonly incident: readonly string[] }
export interface CellGraphPath { readonly id: string; readonly nodes: readonly string[]; readonly owners: readonly number[]; readonly closed: boolean }
export interface CellGraph {
  readonly revision: number;
  readonly implementation: string;
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly CellGraphNode[];
  readonly inner: readonly CellGraphPath[];
  readonly outer: CellGraphPath;
  readonly certificate: Readonly<{ kind: 'exact-rational'; errorIn: number; topology: 'exact-incidence-separated-emission'; steps: number }>;
}
export interface CellGraphRequest {
  readonly source: ReliefSourceSnapshot;
  readonly revision: number;
  readonly isCurrent?: (revision: number) => boolean;
  readonly signal?: AbortSignal;
  readonly maxSteps?: number;
}
export type CellGraphResult = {readonly ok: true; readonly graph: CellGraph} | {readonly ok: false; readonly reason: string};
export class CellGraphWork implements GraphBudget {
  steps = 0;
  constructor(private request: CellGraphRequest) {}
  step(): void {
    this.steps++;
    if (this.steps > (this.request.maxSteps ?? 2_000_000)) throw new Error('Cell graph work budget exceeded');
    if (this.request.signal?.aborted) throw new Error('Cell graph request cancelled');
    if (this.request.isCurrent && !this.request.isCurrent(this.request.revision)) throw new Error('Cell graph source revision became stale');
  }
}
const EMISSION_ERROR_IN = 2e-10;

/** Certify the straight embedding throughout endpoint conversion, rather than only scanning its result. */
function certifyEmission(edges: readonly ExactEdge[], budget: GraphBudget): void {
  const threshold = square(exact(4 * EMISSION_ERROR_IN));
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    budget.step();
    const a = edges[i], b = edges[j];
    const shared = [a.a, a.b].find(p => samePoint(p, b.a) || samePoint(p, b.b));
    if (shared) {
      const endA = samePoint(shared, a.a) ? a.b : a.a, endB = samePoint(shared, b.a) ? b.b : b.a;
      const rounded = (p: ExactPoint): ExactPoint => point(emitCoordinate(p[0]), emitCoordinate(p[1]));
      // The two rays retain their half-plane and exact cross-product sign during linear rounding.
      const va = delta(endA, shared), vb = delta(endB, shared);
      const ra = delta(rounded(endA), rounded(shared)), rb = delta(rounded(endB), rounded(shared));
      const determinant = cross(va, vb);
      const absolute = (v: typeof determinant): typeof determinant => rational(v.n < 0n ? -v.n : v.n, v.d);
      if (determinant.n === 0n) {
        if (cross(va,ra).n !== 0n || cross(va,rb).n !== 0n || dot(va,vb).n >= 0n) throw new Error('Graph collinear junction cannot survive numeric emission');
      } else {
        const componentError = exact(2e-10);
        const lengthSum = [va[0],va[1],vb[0],vb[1]].reduce((sum,v) => add(sum,absolute(v)),exact(0));
        const bound = add(mul(componentError,lengthSum),mul(exact(2),square(componentError)));
        if (compare(absolute(determinant),bound) <= 0) throw new Error('Graph junction orientation is below numeric emission budget');
      }
      if (compareDirections(va, vb) !== compareDirections(ra, rb)) throw new Error('Graph junction cyclic order cannot survive numeric emission');
      continue;
    }
    if (segmentsIntersect(a.a, a.b, b.a, b.b)) throw new Error('Exact graph nonincident edges intersect');
    for (const distance of [pointSegmentDistanceSquared(a.a, b.a, b.b), pointSegmentDistanceSquared(a.b, b.a, b.b),
      pointSegmentDistanceSquared(b.a, a.a, a.b), pointSegmentDistanceSquared(b.b, a.a, a.b)]) {
      if (compare(distance, threshold) <= 0) throw new Error('Graph nonincident separation is below numeric emission budget');
    }
  }
}

export function buildStraightCellGraph(source: ReliefSourceSnapshot, revision: number, budget: CellGraphWork): CellGraph {
  const {meshX: width, meshY: height} = source.query;
  const board = rectangle(width, height);
  const diagram = exactDiagram(source.sites, source.query.metric, board, budget);
  const innerEdges = diagram.edges.filter(edge => edge.owners.length === 2);
  const points = new Map<string, ExactPoint>(board.map(p => [pointKey(p), p]));
  for (const edge of diagram.edges) { points.set(pointKey(edge.a), edge.a); points.set(pointKey(edge.b), edge.b); }
  const outline: ExactPoint[] = [];
  for (let side = 0; side < 4; side++) {
    const start = board[side], end = board[(side + 1) % 4];
    const axis = side % 2 === 0 ? 0 : 1, direction = side < 2 ? 1 : -1;
    const fixed = 1 - axis;
    outline.push(...[...points.values()].filter(p => compare(p[fixed], start[fixed]) === 0 && !samePoint(p, end))
      .sort((a, b) => direction * compare(a[axis], b[axis])));
  }
  const outerEdges = outline.map((a, i) => ({a, b: outline[(i + 1) % outline.length], owners: []}));
  const allEdges = [...innerEdges, ...outerEdges];
  certifyEmission(allEdges, budget);
  const incidents = new Map<string, {id: string; direction: ExactPoint}[]>();
  const inner = innerEdges.map((edge, i) => ({id: `edge:${i}`, nodes: [pointKey(edge.a), pointKey(edge.b)], owners: [...edge.owners].sort((a,b) => a-b), closed: false}));
  const paths = [...inner, ...outerEdges.map((edge, i) => ({id: `outline:${i}`, nodes: [pointKey(edge.a), pointKey(edge.b)], owners: [], closed: false}))];
  allEdges.forEach((edge, i) => {
    for (const [a, b] of [[edge.a, edge.b], [edge.b, edge.a]]) {
      const key = pointKey(a), list = incidents.get(key) ?? [];
      list.push({id: paths[i].id, direction: delta(b, a)}); incidents.set(key, list);
    }
  });
  for (const path of inner) { Object.freeze(path.nodes); Object.freeze(path.owners); Object.freeze(path); }
  Object.freeze(inner);
  const nodes = [...points].map(([id, p]) => ({id, x: emitCoordinate(p[0]), y: emitCoordinate(p[1]),
    incident: (incidents.get(id) ?? []).sort((a,b) => compareDirections(a.direction,b.direction)).map(item => item.id)}));
  for (const node of nodes) { Object.freeze(node.incident); Object.freeze(node); }
  Object.freeze(nodes);
  budget.step();
  return Object.freeze({revision, implementation: source.query.implementation, width, height, nodes, inner,
    outer: Object.freeze({id: 'outline', nodes: Object.freeze(outline.map(pointKey)), owners: Object.freeze([]), closed: true}),
    certificate: Object.freeze({kind: 'exact-rational' as const, errorIn: EMISSION_ERROR_IN, topology: 'exact-incidence-separated-emission' as const, steps: budget.steps})});
}

/** Capture once. A failed proof returns no partial graph. Producer arrays are never transferred or edited. */
export function buildCellGraph(request: CellGraphRequest): CellGraphResult {
  try {
    if (!Number.isSafeInteger(request.revision) || request.revision < 0) throw new Error('Invalid cell graph source revision');
    if (request.maxSteps !== undefined && (!Number.isSafeInteger(request.maxSteps) || request.maxSteps < 1)) throw new Error('Invalid cell graph work budget');
    const budget = new CellGraphWork(request); budget.step();
    const source = copyReliefSource(request.source);
    validateCellGraphQuery(source.query);
    validateReliefSites(source.sites, source.query.meshX, source.query.meshY);
    if (source.query.warp.amplitude !== 0) throw new Error('Nonlinear cell graph certificate is not installed in the straight graph core');
    const graph = buildStraightCellGraph(source, request.revision, budget);
    return {ok: true, graph};
  } catch (error) {
    return {ok: false, reason: error instanceof Error ? error.message : 'Cell graph failed with an unknown error'};
  }
}
