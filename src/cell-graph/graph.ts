import { validateCellGraphQuery } from './query';
import { addI, divI, inflateI, interval, mulI, nextUp, squareI, subI } from './interval';
import type { Interval } from './interval';
import { rationalInterval } from './warp-clipping';
import { buildWarpCellGraph } from './warp-graph';
import type { ReliefSourceSnapshot } from '../types';
import { copyReliefSource, validateReliefSites } from '../noise/relief-sites';
import {
  compareDirections,
  emitCoordinate,
  exactDiagram,
  pointSegmentDistanceSquared,
  rectangle,
  segmentsIntersect,
} from './exact-diagram';
import type { ExactEdge, GraphBudget } from './exact-diagram';
import {
  add,
  compare,
  cross,
  delta,
  dot,
  exact,
  mul,
  point,
  pointKey,
  rational,
  samePoint,
  square,
} from './rational';
import type { ExactPoint } from './rational';

export interface CellGraphNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly incident: readonly string[];
}
export interface CellGraphPath {
  readonly id: string;
  readonly nodes: readonly string[];
  readonly owners: readonly number[];
  readonly closed: boolean;
}
export interface CellGraph {
  readonly revision: number;
  readonly implementation: string;
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly CellGraphNode[];
  readonly inner: readonly CellGraphPath[];
  readonly outer: CellGraphPath;
  readonly certificate: Readonly<{
    kind: 'exact-rational' | 'contraction';
    errorIn: number;
    topology: 'exact-incidence-separated-emission' | 'inverse-separated-curves';
    steps: number;
    kernel?: string;
    lipschitz?: number;
    hessian?: number;
    evaluationResidue?: number;
  }>;
}
export interface CellGraphRequest {
  readonly source: ReliefSourceSnapshot;
  readonly revision: number;
  readonly isCurrent?: (revision: number) => boolean;
  readonly signal?: AbortSignal;
  readonly maxSteps?: number;
}
export type CellGraphResult =
  | { readonly ok: true; readonly graph: CellGraph }
  | { readonly ok: false; readonly reason: string };
export class CellGraphWork implements GraphBudget {
  steps = 0;
  constructor(private request: CellGraphRequest) {}
  step(): void {
    this.steps++;
    if (this.steps > (this.request.maxSteps ?? 25_000_000))
      throw new Error('Cell graph work budget exceeded');
    if (this.request.signal?.aborted) throw new Error('Cell graph request cancelled');
    if (this.request.isCurrent && !this.request.isCurrent(this.request.revision))
      throw new Error('Cell graph source revision became stale');
  }
}
const EMISSION_ERROR_IN = 2e-10;

type Box = readonly [Interval, Interval];
const enclosures = new WeakMap<ExactPoint, Box>();
const enclose = (p: ExactPoint): Box => {
  let box = enclosures.get(p);
  if (!box) { box = [rationalInterval(p[0]), rationalInterval(p[1])]; enclosures.set(p, box); }
  return box;
};
const signOf = (v: Interval): number | undefined => v[0] > 0 ? 1 : v[1] < 0 ? -1 : v[0] === 0 && v[1] === 0 ? 0 : undefined;
/** compareDirections(endA - shared, endB - shared) when intervals decide that the rays are
 * not collinear, clear the 2e-10 orientation budget, and lie in decided half-planes. */
function junctionByIntervals(endA: Box, endB: Box, shared: Box): number | undefined {
  const va = [subI(endA[0], shared[0]), subI(endA[1], shared[1])] as const,
    vb = [subI(endB[0], shared[0]), subI(endB[1], shared[1])] as const;
  const determinant = subI(mulI(va[0], vb[1]), mulI(va[1], vb[0])),
    sign = signOf(determinant);
  if (!sign) return undefined;
  const absolute = (v: Interval): number => Math.max(Math.abs(v[0]), Math.abs(v[1]));
  const lengthSum = [va[0], va[1], vb[0], vb[1]].reduce((sum, v) => nextUp(sum + absolute(v)), 0);
  const bound = nextUp(nextUp(2e-10 * lengthSum) + nextUp(2 * nextUp(2e-10 * 2e-10)));
  if (Math.min(Math.abs(determinant[0]), Math.abs(determinant[1])) <= bound) return undefined;
  const half = (v: readonly [Interval, Interval]): number | undefined => {
    const y = signOf(v[1]), x = signOf(v[0]);
    if (y === undefined) return undefined;
    if (y !== 0) return y > 0 ? 0 : 1;
    return x === undefined ? undefined : x >= 0 ? 0 : 1;
  };
  const ha = half(va), hb = half(vb);
  if (ha === undefined || hb === undefined) return undefined;
  return ha !== hb ? ha - hb : -sign;
}
/** True when intervals prove the segments disjoint and every endpoint farther than the
 * threshold from the other segment, the outcome the exact checks would also reach. */
function separatedByIntervals(a: Box, b: Box, c: Box, d: Box, thresholdUpper: number): boolean {
  const orient = (p: Box, q: Box, r: Box): number | undefined => signOf(subI(
    mulI(subI(q[0], p[0]), subI(r[1], p[1])), mulI(subI(q[1], p[1]), subI(r[0], p[0]))));
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  const disjoint = (o1 !== undefined && o1 !== 0 && o1 === o2) || (o3 !== undefined && o3 !== 0 && o3 === o4);
  if (!disjoint) return false;
  const gap = (p: Box, s: Box, t: Box): number => {
    const dir = [subI(t[0], s[0]), subI(t[1], s[1])] as const,
      ps = [subI(p[0], s[0]), subI(p[1], s[1])] as const;
    const length2 = addI(squareI(dir[0]), squareI(dir[1]));
    let lower = 0;
    if (length2[0] > 0) lower = divI(squareI(subI(mulI(ps[0], dir[1]), mulI(ps[1], dir[0]))), length2)[0];
    const projection = addI(mulI(ps[0], dir[0]), mulI(ps[1], dir[1]));
    if (projection[1] <= 0) lower = Math.max(lower, addI(squareI(ps[0]), squareI(ps[1]))[0]);
    else if (projection[0] >= length2[1]) {
      const pt = [subI(p[0], t[0]), subI(p[1], t[1])] as const;
      lower = Math.max(lower, addI(squareI(pt[0]), squareI(pt[1]))[0]);
    }
    return lower;
  };
  return gap(a, c, d) > thresholdUpper && gap(b, c, d) > thresholdUpper
    && gap(c, a, b) > thresholdUpper && gap(d, a, b) > thresholdUpper;
}

/** Certify the straight embedding throughout endpoint conversion, rather than only scanning its result. */
function certifyEmission(edges: readonly ExactEdge[], budget: GraphBudget): void {
  const threshold = square(exact(4 * EMISSION_ERROR_IN)),
    thresholdUpper = nextUp(nextUp(4 * EMISSION_ERROR_IN) * nextUp(4 * EMISSION_ERROR_IN));
  const boxes = edges.map((edge) => {
    const xs = [emitCoordinate(edge.a[0]), emitCoordinate(edge.b[0])],
      ys = [emitCoordinate(edge.a[1]), emitCoordinate(edge.b[1])];
    return {
      x: inflateI([Math.min(...xs), Math.max(...xs)], 1e-10),
      y: inflateI([Math.min(...ys), Math.max(...ys)], 1e-10),
    };
  });
  // Only pairs whose boxes come within 4e-10 can fail a check below (the box test skips
  // every other pair), so a grid over boxes padded by that much finds every pair that
  // matters. Each pair is checked once, in the first cell its padded boxes share.
  const pad = nextUp(4 * EMISSION_ERROR_IN);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x[0]); maxX = Math.max(maxX, box.x[1]);
    minY = Math.min(minY, box.y[0]); maxY = Math.max(maxY, box.y[1]);
  }
  const size = Math.max(Math.sqrt(((maxX - minX) * (maxY - minY)) / Math.max(1, edges.length)) * 2,
    (maxX - minX) / 2048, (maxY - minY) / 2048) || 1;
  const columns = Math.max(1, Math.floor((maxX - minX + 2 * pad) / size) + 1);
  const cellOf = (value: number, origin: number): number => Math.max(0, Math.floor((value - origin + pad) / size));
  // Rounding can put a padded edge one past the last column; clamp so keys never alias rows.
  const columnOf = (value: number): number => Math.min(columns - 1, cellOf(value, minX));
  const ranges = boxes.map((box) => [columnOf(box.x[0] - pad), columnOf(box.x[1] + pad),
    cellOf(box.y[0] - pad, minY), cellOf(box.y[1] + pad, minY)] as const);
  const cells = new Map<number, number[]>();
  ranges.forEach(([x0, x1, y0, y1], index) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        budget.step();
        const key = y * columns + x,
          list = cells.get(key);
        if (list) list.push(index);
        else cells.set(key, [index]);
      }
  });
  const pairs: [number, number][] = [];
  for (const [key, list] of cells) {
    const x = key % columns,
      y = (key - x) / columns;
    for (let p = 0; p < list.length; p++)
      for (let q = p + 1; q < list.length; q++) {
        const i = Math.min(list[p], list[q]),
          j = Math.max(list[p], list[q]);
        if (Math.max(ranges[i][0], ranges[j][0]) === x && Math.max(ranges[i][2], ranges[j][2]) === y)
          pairs.push([i, j]);
      }
  }
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [i, j] of pairs) {
      budget.step();
      const a = edges[i],
        b = edges[j];
      const shared = [a.a, a.b].find((p) => samePoint(p, b.a) || samePoint(p, b.b));
      if (shared) {
        const endA = samePoint(shared, a.a) ? a.b : a.a,
          endB = samePoint(shared, b.a) ? b.b : b.a;
        const rounded = (p: ExactPoint): ExactPoint =>
          point(emitCoordinate(p[0]), emitCoordinate(p[1]));
        const ra = delta(rounded(endA), rounded(shared)),
          rb = delta(rounded(endB), rounded(shared));
        // Interval filter for the exact checks below: when it decides every predicate the
        // exact path would reach the same outcome, so it passes or throws the same error.
        const quick = junctionByIntervals(enclose(endA), enclose(endB), enclose(shared));
        if (quick !== undefined) {
          if (quick !== compareDirections(ra, rb))
            throw new Error('Graph junction cyclic order cannot survive numeric emission');
          continue;
        }
        // The two rays retain their half-plane and exact cross-product sign during linear rounding.
        const va = delta(endA, shared),
          vb = delta(endB, shared);
        const determinant = cross(va, vb);
        const absolute = (v: typeof determinant): typeof determinant =>
          rational(v.n < 0n ? -v.n : v.n, v.d);
        if (determinant.n === 0n) {
          if (cross(va, ra).n !== 0n || cross(va, rb).n !== 0n || dot(va, vb).n >= 0n)
            throw new Error('Graph collinear junction cannot survive numeric emission');
        } else {
          const componentError = exact(2e-10);
          const lengthSum = [va[0], va[1], vb[0], vb[1]].reduce(
            (sum, v) => add(sum, absolute(v)),
            exact(0),
          );
          const bound = add(mul(componentError, lengthSum), mul(exact(2), square(componentError)));
          if (compare(absolute(determinant), bound) <= 0)
            throw new Error('Graph junction orientation is below numeric emission budget');
        }
        if (compareDirections(va, vb) !== compareDirections(ra, rb))
          throw new Error('Graph junction cyclic order cannot survive numeric emission');
        continue;
      }
      const boxA = boxes[i],
        boxB = boxes[j];
      if (
        subI(interval(boxA.x[0]), interval(boxB.x[1]))[0] > 4 * EMISSION_ERROR_IN ||
        subI(interval(boxB.x[0]), interval(boxA.x[1]))[0] > 4 * EMISSION_ERROR_IN ||
        subI(interval(boxA.y[0]), interval(boxB.y[1]))[0] > 4 * EMISSION_ERROR_IN ||
        subI(interval(boxB.y[0]), interval(boxA.y[1]))[0] > 4 * EMISSION_ERROR_IN
      )
        continue;
      if (separatedByIntervals(enclose(a.a), enclose(a.b), enclose(b.a), enclose(b.b), thresholdUpper)) continue;
      if (segmentsIntersect(a.a, a.b, b.a, b.b))
        throw new Error('Exact graph nonincident edges intersect');
      for (const distance of [
        pointSegmentDistanceSquared(a.a, b.a, b.b),
        pointSegmentDistanceSquared(a.b, b.a, b.b),
        pointSegmentDistanceSquared(b.a, a.a, a.b),
        pointSegmentDistanceSquared(b.b, a.a, a.b),
      ]) {
        if (compare(distance, threshold) <= 0)
          throw new Error('Graph nonincident separation is below numeric emission budget');
      }
    }
}

export function buildStraightCellGraph(
  source: ReliefSourceSnapshot,
  revision: number,
  budget: CellGraphWork,
): CellGraph {
  const { meshX: width, meshY: height } = source.query;
  const board = rectangle(width, height);
  const diagram = exactDiagram(source.sites, source.query.metric, board, budget);
  const innerEdges = diagram.edges.filter((edge) => edge.owners.length === 2);
  const points = new Map<string, ExactPoint>(board.map((p) => [pointKey(p), p]));
  for (const edge of diagram.edges) {
    points.set(pointKey(edge.a), edge.a);
    points.set(pointKey(edge.b), edge.b);
  }
  const outline: ExactPoint[] = [];
  for (let side = 0; side < 4; side++) {
    const start = board[side],
      end = board[(side + 1) % 4];
    const axis = side % 2 === 0 ? 0 : 1,
      direction = side < 2 ? 1 : -1;
    const fixed = 1 - axis;
    outline.push(
      ...[...points.values()]
        .filter((p) => compare(p[fixed], start[fixed]) === 0 && !samePoint(p, end))
        .sort((a, b) => direction * compare(a[axis], b[axis])),
    );
  }
  const outerEdges = outline.map((a, i) => ({
    a,
    b: outline[(i + 1) % outline.length],
    owners: [],
  }));
  const allEdges = [...innerEdges, ...outerEdges];
  certifyEmission(allEdges, budget);
  const incidents = new Map<string, { id: string; direction: ExactPoint }[]>();
  const inner = innerEdges.map((edge, i) => ({
    id: `edge:${i}`,
    nodes: [pointKey(edge.a), pointKey(edge.b)],
    owners: [...edge.owners].sort((a, b) => a - b),
    closed: false,
  }));
  const paths = [
    ...inner,
    ...outerEdges.map((edge, i) => ({
      id: `outline:${i}`,
      nodes: [pointKey(edge.a), pointKey(edge.b)],
      owners: [],
      closed: false,
    })),
  ];
  allEdges.forEach((edge, i) => {
    for (const [a, b] of [
      [edge.a, edge.b],
      [edge.b, edge.a],
    ]) {
      const key = pointKey(a),
        list = incidents.get(key) ?? [];
      list.push({ id: paths[i].id, direction: delta(b, a) });
      incidents.set(key, list);
    }
  });
  for (const path of inner) {
    Object.freeze(path.nodes);
    Object.freeze(path.owners);
    Object.freeze(path);
  }
  Object.freeze(inner);
  const nodes = [...points].map(([id, p]) => ({
    id,
    x: emitCoordinate(p[0]),
    y: emitCoordinate(p[1]),
    incident: (incidents.get(id) ?? [])
      .sort((a, b) => compareDirections(a.direction, b.direction))
      .map((item) => item.id),
  }));
  for (const node of nodes) {
    Object.freeze(node.incident);
    Object.freeze(node);
  }
  Object.freeze(nodes);
  budget.step();
  return Object.freeze({
    revision,
    implementation: source.query.implementation,
    width,
    height,
    nodes,
    inner,
    outer: Object.freeze({
      id: 'outline',
      nodes: Object.freeze(outline.map(pointKey)),
      owners: Object.freeze([]),
      closed: true,
    }),
    certificate: Object.freeze({
      kind: 'exact-rational' as const,
      errorIn: EMISSION_ERROR_IN,
      topology: 'exact-incidence-separated-emission' as const,
      steps: budget.steps,
    }),
  });
}

/** Capture once. A failed proof returns no partial graph. Producer arrays are never transferred or edited. */
export function buildCellGraph(request: CellGraphRequest): CellGraphResult {
  try {
    if (!Number.isSafeInteger(request.revision) || request.revision < 0)
      throw new Error('Invalid cell graph source revision');
    if (
      request.maxSteps !== undefined &&
      (!Number.isSafeInteger(request.maxSteps) ||
        request.maxSteps < 1 ||
        request.maxSteps > 50_000_000)
    )
      throw new Error('Invalid cell graph work budget');
    const budget = new CellGraphWork(request);
    budget.step();
    const source = copyReliefSource(request.source);
    validateCellGraphQuery(source.query);
    validateReliefSites(source.sites, source.query.meshX, source.query.meshY);
    const graph =
      source.query.warp.amplitude === 0 || source.sites.ids.length < 2
        ? buildStraightCellGraph(source, request.revision, budget)
        : buildWarpCellGraph(source, request.revision, budget);
    return { ok: true, graph };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Cell graph failed with an unknown error',
    };
  }
}
