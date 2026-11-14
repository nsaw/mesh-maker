import { addI, inflateI, interval, nextUp, scaleI, squareI, subI } from './interval';
import type { Interval } from './interval';
import type { ReliefQueryDescription, ReliefSiteSet } from '../types';
import {
  add,
  compare,
  cross,
  delta,
  div,
  dot,
  exact,
  mul,
  number,
  ONE,
  orient,
  point,
  pointKey,
  samePoint,
  square,
  sub,
  ZERO,
} from './rational';
import type { ExactPoint, Rational } from './rational';

export interface ExactEdge {
  readonly a: ExactPoint;
  readonly b: ExactPoint;
  readonly owners: readonly number[];
}
export interface ExactDiagram {
  readonly cells: ReadonlyMap<number, readonly ExactPoint[]>;
  readonly edges: readonly ExactEdge[];
}
export interface GraphBudget {
  step(): void;
}
type Line = readonly [Rational, Rational, Rational];
const value = (line: Line, p: ExactPoint): Rational =>
  sub(add(mul(line[0], p[0]), mul(line[1], p[1])), line[2]);
function clip(polygon: readonly ExactPoint[], line: Line, budget: GraphBudget): ExactPoint[] {
  const result: ExactPoint[] = [];
  if (polygon.length === 0) return result;
  let previous = polygon[polygon.length - 1],
    before = value(line, previous);
  for (const current of polygon) {
    budget.step();
    const after = value(line, current);
    if (before.n <= 0n !== after.n <= 0n) {
      const t = div(before, sub(before, after));
      result.push([
        add(previous[0], mul(t, sub(current[0], previous[0]))),
        add(previous[1], mul(t, sub(current[1], previous[1]))),
      ]);
    }
    if (after.n <= 0n) result.push(current);
    previous = current;
    before = after;
  }
  return result.filter((p, i) => !samePoint(p, result[(i + result.length - 1) % result.length]));
}
/** The represented metric is evaluated exactly, including its represented rotation constants.
 * Clipping in query coordinates is equivalent to transforming the complete board polygon. */
export function exactDiagram(
  sites: ReliefSiteSet,
  metric: ReliefQueryDescription['metric'],
  domain: readonly ExactPoint[],
  budget: GraphBudget,
): ExactDiagram {
  const c = exact(metric.cosA),
    s = exact(metric.sinA),
    scale = exact(metric.scale);
  const transform = (p: ExactPoint): ExactPoint => [
    mul(add(mul(p[0], c), mul(p[1], s)), scale),
    sub(mul(p[1], c), mul(p[0], s)),
  ];
  const positions = Array.from(sites.ids, (_, i) => point(sites.xy[2 * i], sites.xy[2 * i + 1]));
  const transformed = positions.map(transform);
  const enclosures = new WeakMap<ExactPoint, readonly [Interval, Interval]>();
  const enclose = (p: ExactPoint): readonly [Interval, Interval] => {
    let result = enclosures.get(p);
    if (!result) {
      result = [
        inflateI(interval(emitCoordinate(p[0])), 1e-10),
        inflateI(interval(emitCoordinate(p[1])), 1e-10),
      ];
      enclosures.set(p, result);
    }
    return result;
  };
  const distance = (p: readonly [Interval, Interval], i: number): Interval => {
    const dx = subI(p[0], interval(sites.xy[2 * i])),
      dy = subI(p[1], interval(sites.xy[2 * i + 1]));
    const x = scaleI(addI(scaleI(dx, metric.cosA), scaleI(dy, metric.sinA)), metric.scale);
    const y = subI(scaleI(dy, metric.cosA), scaleI(dx, metric.sinA));
    return addI(squareI(x), squareI(y));
  };
  const cells = new Map<number, readonly ExactPoint[]>();
  const edges = new Map<string, { a: ExactPoint; b: ExactPoint; owners: number[] }>();
  for (let i = 0; i < positions.length; i++) {
    let polygon = [...domain];
    const competitors = Array.from(sites.ids, (_, j) => j)
      .filter((j) => j !== i)
      .sort((a, b) => {
        const ax = sites.xy[2 * a] - sites.xy[2 * i],
          ay = sites.xy[2 * a + 1] - sites.xy[2 * i + 1];
        const bx = sites.xy[2 * b] - sites.xy[2 * i],
          by = sites.xy[2 * b + 1] - sites.xy[2 * i + 1];
        return ax * ax + ay * ay - bx * bx - by * by;
      });
    for (const j of competitors) {
      budget.step();
      if (samePoint(positions[i], positions[j])) {
        if (sites.ids[j] < sites.ids[i]) {
          polygon = [];
          break;
        }
        continue;
      }
      // A directed interval proves redundant planes without changing exact predicates near a boundary.
      const classification = polygon.map((p) => {
        budget.step();
        const box = enclose(p);
        return subI(distance(box, i), distance(box, j));
      });
      if (classification.every((v) => v[1] < 0)) continue;
      if (classification.every((v) => v[0] > 0)) {
        polygon = [];
        break;
      }
      const difference = delta(transformed[j], transformed[i]);
      // Pull the bisector covector through the linear metric without rounding a vertex.
      const two = exact(2);
      const a = mul(two, sub(mul(mul(difference[0], c), scale), mul(difference[1], s)));
      const b = mul(two, add(mul(mul(difference[0], s), scale), mul(difference[1], c)));
      polygon = clip(
        polygon,
        [a, b, sub(dot(transformed[j], transformed[j]), dot(transformed[i], transformed[i]))],
        budget,
      );
      if (polygon.length === 0) break;
    }
    // A cell touching only at a line or point owns no open area and contributes no edge.
    if (polygon.length < 3 || polygon.every((p) => orient(polygon[0], polygon[1], p).n === 0n))
      polygon = [];
    cells.set(sites.ids[i], polygon);
    for (let k = 0; k < polygon.length; k++) {
      const a = polygon[k],
        b = polygon[(k + 1) % polygon.length];
      if (samePoint(a, b)) continue;
      const ka = pointKey(a),
        kb = pointKey(b),
        id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const edge = edges.get(id);
      if (edge) edge.owners.push(sites.ids[i]);
      else edges.set(id, { a, b, owners: [sites.ids[i]] });
    }
  }
  for (const edge of edges.values()) {
    if (edge.owners.length > 2) throw new Error('Exact graph incidence exceeds two cell owners');
    if (
      edge.owners.length === 1 &&
      !domain.some(
        (p, i) =>
          orient(p, domain[(i + 1) % domain.length], edge.a).n === 0n &&
          orient(p, domain[(i + 1) % domain.length], edge.b).n === 0n,
      )
    )
      throw new Error('Exact graph has an unmatched internal edge');
  }
  return { cells, edges: [...edges.values()] };
}

/** Exact squared distance also covers zero-length diagnostic segments. */
export function pointSegmentDistanceSquared(p: ExactPoint, a: ExactPoint, b: ExactPoint): Rational {
  const direction = delta(b, a),
    length = dot(direction, direction),
    projection = dot(delta(p, a), direction);
  if (projection.n <= 0n || length.n === 0n) return dot(delta(p, a), delta(p, a));
  if (compare(projection, length) >= 0) return dot(delta(p, b), delta(p, b));
  return div(square(cross(delta(p, a), direction)), length);
}
export function segmentsIntersect(
  a: ExactPoint,
  b: ExactPoint,
  c: ExactPoint,
  d: ExactPoint,
): boolean {
  const o1 = orient(a, b, c),
    o2 = orient(a, b, d),
    o3 = orient(c, d, a),
    o4 = orient(c, d, b);
  if (
    ((o1.n < 0n && o2.n > 0n) || (o1.n > 0n && o2.n < 0n)) &&
    ((o3.n < 0n && o4.n > 0n) || (o3.n > 0n && o4.n < 0n))
  )
    return true;
  return (
    (o1.n === 0n && pointSegmentDistanceSquared(c, a, b).n === 0n) ||
    (o2.n === 0n && pointSegmentDistanceSquared(d, a, b).n === 0n) ||
    (o3.n === 0n && pointSegmentDistanceSquared(a, c, d).n === 0n) ||
    (o4.n === 0n && pointSegmentDistanceSquared(b, c, d).n === 0n)
  );
}
export function compareDirections(a: ExactPoint, b: ExactPoint): number {
  const half = (p: ExactPoint): number => (p[1].n > 0n || (p[1].n === 0n && p[0].n >= 0n) ? 0 : 1);
  const difference = half(a) - half(b);
  if (difference !== 0) return difference;
  return -compare(cross(a, b), ZERO);
}
/** Return a finite coordinate and prove its conversion error against an exact inch budget. */
export function emitCoordinate(value: Rational, limit = 1e-10): number {
  const result = number(value),
    error = sub(value, exact(result));
  if (compare(square(error), square(exact(limit))) > 0)
    throw new Error('Graph coordinate conversion exceeds numeric error budget');
  return Object.is(result, -0) ? 0 : result;
}
export const rectangle = (width: number, height: number, margin = 0): readonly ExactPoint[] => [
  point(-margin, -margin),
  point(margin > 0 ? nextUp(width + margin) : width, -margin),
  point(margin > 0 ? nextUp(width + margin) : width, margin > 0 ? nextUp(height + margin) : height),
  point(-margin, margin > 0 ? nextUp(height + margin) : height),
];
export const midpoint = (a: ExactPoint, b: ExactPoint): ExactPoint => [
  mul(add(a[0], b[0]), div(ONE, exact(2))),
  mul(add(a[1], b[1]), div(ONE, exact(2))),
];
