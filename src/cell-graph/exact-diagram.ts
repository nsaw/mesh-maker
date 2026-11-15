import { addI, inflateI, interval, nextDown, nextUp, scaleI, squareI, subI } from './interval';
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
  rational,
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
// Unreduced exact arithmetic for one clip: signs are the same as with reduced operands,
// without a gcd at every intermediate step.
interface Fraction { readonly n: bigint; readonly d: bigint }
const mulU = (a: Fraction, b: Fraction): Fraction => ({ n: a.n * b.n, d: a.d * b.d });
const addU = (a: Fraction, b: Fraction): Fraction =>
  a.d === b.d ? { n: a.n + b.n, d: a.d } : { n: a.n * b.d + b.n * a.d, d: a.d * b.d };
const subU = (a: Fraction, b: Fraction): Fraction => addU(a, { n: -b.n, d: b.d });
const value = (line: Line, p: ExactPoint): Fraction =>
  subU(addU(mulU(line[0], p[0]), mulU(line[1], p[1])), line[2]);
/** The line through p and q, in value(line, x) = a x + b y - c form. */
function through(p: ExactPoint, q: ExactPoint): Line {
  const a = sub(q[1], p[1]),
    b = sub(p[0], q[0]);
  return [a, b, add(mul(a, p[0]), mul(b, p[1]))];
}
/** The unique point on both lines (Cramer). Each new vertex is the crossing of the edge's
 * own line with the clip line, so this is exactly the point the segment parameter gives,
 * from line coefficients rather than products of vertex coordinates. */
function meet(e: Line, l: Line): ExactPoint {
  const det = subU(mulU(e[0], l[1]), mulU(l[0], e[1])),
    x = subU(mulU(e[2], l[1]), mulU(l[2], e[1])),
    y = subU(mulU(e[0], l[2]), mulU(l[0], e[2]));
  return [rational(x.n * det.d, x.d * det.n), rational(y.n * det.d, y.d * det.n)];
}
/** A convex polygon whose k-th edge, from points[k] to points[k + 1], lies on lines[k]. */
interface Polygon { readonly points: ExactPoint[]; readonly lines: Line[] }
function clip(polygon: Polygon, line: Line, budget: GraphBudget): Polygon {
  const points: ExactPoint[] = [], lines: Line[] = [];
  const count = polygon.points.length;
  if (count === 0) return { points, lines };
  let previous = count - 1,
    before = value(line, polygon.points[previous]);
  for (let k = 0; k < count; k++) {
    budget.step();
    const current = polygon.points[k],
      after = value(line, current);
    if (before.n <= 0n !== after.n <= 0n) {
      points.push(meet(polygon.lines[previous], line));
      // Entering: the crossing starts the rest of the old edge. Leaving: the clip line.
      lines.push(after.n <= 0n ? polygon.lines[previous] : line);
    }
    if (after.n <= 0n) {
      points.push(current);
      lines.push(polygon.lines[k]);
    }
    previous = k;
    before = after;
  }
  // Drop each point equal to its cyclic predecessor; the kept point takes the line of the
  // last point it absorbed, since that line carries the next positive-length edge.
  const keep = points.map((p, i) => !samePoint(p, points[(i + points.length - 1) % points.length]));
  const result: Polygon = { points: [], lines: [] };
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) { result.points.push(points[i]); result.lines.push(lines[i]); }
    else if (result.lines.length) result.lines[result.lines.length - 1] = lines[i];
  }
  // A leading run absorbed into the final kept point (cyclic wrap) hands it its line.
  if (result.points.length && !keep[0]) {
    let last = 0;
    while (last + 1 < points.length && !keep[last + 1]) last++;
    result.lines[result.lines.length - 1] = lines[last];
  }
  return result;
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
  const domainLines = domain.map((p, k) => through(p, domain[(k + 1) % domain.length]));
  // Competitors nearest first (by computed squared distance, then index) from a bucket grid:
  // a heap is fed one ring at a time and only pops entries no farther than every site in
  // the rings not yet read. The diagram loop stops early, so most rings are never read.
  const count = positions.length;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let k = 0; k < count; k++) {
    minX = Math.min(minX, sites.xy[2 * k]); maxX = Math.max(maxX, sites.xy[2 * k]);
    minY = Math.min(minY, sites.xy[2 * k + 1]); maxY = Math.max(maxY, sites.xy[2 * k + 1]);
  }
  const cell = Math.max(Math.sqrt(((maxX - minX) * (maxY - minY)) / Math.max(1, count)), (maxX - minX) / 1024, (maxY - minY) / 1024) || 1;
  const columns = Math.max(1, Math.floor((maxX - minX) / cell) + 1),
    rows = Math.max(1, Math.floor((maxY - minY) / cell) + 1);
  const columnOf = (x: number): number => Math.min(columns - 1, Math.floor((x - minX) / cell)),
    rowOf = (y: number): number => Math.min(rows - 1, Math.floor((y - minY) / cell));
  const bucketSlop = 64 * Number.EPSILON * (1 + Math.abs(minX) + Math.abs(maxX) + Math.abs(minY) + Math.abs(maxY) + (columns + rows) * cell);
  const buckets: number[][] = Array.from({ length: columns * rows }, () => []);
  for (let k = 0; k < count; k++) buckets[rowOf(sites.xy[2 * k + 1]) * columns + columnOf(sites.xy[2 * k])].push(k);
  function* nearestFirst(i: number): Generator<number> {
    const xi = sites.xy[2 * i], yi = sites.xy[2 * i + 1], ci = columnOf(xi), ri = rowOf(yi);
    const heap: { d: number; j: number }[] = [];
    const less = (a: { d: number; j: number }, b: { d: number; j: number }): boolean => a.d < b.d || (a.d === b.d && a.j < b.j);
    const push = (entry: { d: number; j: number }): void => {
      heap.push(entry);
      for (let k = heap.length - 1; k > 0;) {
        const up = (k - 1) >> 1;
        if (!less(heap[k], heap[up])) break;
        [heap[k], heap[up]] = [heap[up], heap[k]]; k = up;
      }
    };
    const pop = (): { d: number; j: number } => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let k = 0; ;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (r < heap.length && less(heap[r], heap[m])) m = r;
          if (m === k) break;
          [heap[k], heap[m]] = [heap[m], heap[k]]; k = m;
        }
      }
      return top;
    };
    const maxRing = Math.max(ci, columns - 1 - ci, ri, rows - 1 - ri);
    for (let ring = 0; ring <= maxRing + 1; ring++) {
      if (ring <= maxRing) {
        budget.step();
        // Only rows and columns inside the grid; a ring's interior rows read just its two
        // side columns.
        for (let r = Math.max(0, ri - ring); r <= Math.min(rows - 1, ri + ring); r++) {
          const edge = r === ri - ring || r === ri + ring;
          const sides = edge ? [] : [ci - ring, ci + ring].filter((c) => c >= 0 && c < columns);
          const from = Math.max(0, ci - ring), to = Math.min(columns - 1, ci + ring);
          for (const c of edge ? Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => from + k) : sides) {
            for (const j of buckets[r * columns + c]) {
              if (j === i) continue;
              const dx = sites.xy[2 * j] - xi, dy = sites.xy[2 * j + 1] - yi;
              push({ d: dx * dx + dy * dy, j });
            }
          }
        }
      }
      // Sites in unread rings are at least `ring` whole cells from the site's own cell, less
      // the few-ulp disagreement between floor-based bucketing and the cell boundaries.
      const unread = ring >= maxRing ? Infinity : ring * cell - bucketSlop;
      const floor = unread === Infinity ? Infinity : unread <= 0 ? -1 : nextDown(nextDown(unread * unread) * (1 - 1e-12));
      while (heap.length && heap[0].d <= floor) yield pop().j;
    }
  }
  for (let i = 0; i < positions.length; i++) {
    let shape: Polygon = { points: [...domain], lines: [...domainLines] };
    let polygon = shape.points;
    const competitors = nearestFirst(i);
    // A competitor at metric distance >= 2R from the site, R the cell's farthest vertex,
    // is never strictly nearer than the site at any vertex (triangle inequality), so its
    // plane cannot cut. Euclidean distance bounds the metric one below, and competitors
    // arrive nearest first, so every later one is at least as far up to rounding, which
    // the 1e-9 relative margin covers.
    let reach = Infinity;
    const updateReach = (): void => {
      reach = 0;
      for (const p of polygon) reach = Math.max(reach, distance(enclose(p), i)[1]);
    };
    updateReach();
    for (const j of competitors) {
      budget.step();
      const dx = subI(interval(sites.xy[2 * j]), interval(sites.xy[2 * i])),
        dy = subI(interval(sites.xy[2 * j + 1]), interval(sites.xy[2 * i + 1]));
      if (addI(squareI(dx), squareI(dy))[0] >= nextUp(4 * nextUp(reach * (1 + 1e-9)))) break;
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
      shape = clip(
        shape,
        [a, b, sub(dot(transformed[j], transformed[j]), dot(transformed[i], transformed[i]))],
        budget,
      );
      polygon = shape.points;
      if (polygon.length === 0) break;
      updateReach();
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
    r = exact(result),
    bound = exact(limit);
  // |n/d - rn/rd| <= ln/ld, cross-multiplied over positive denominators: no reduction.
  const difference = value.n * r.d - r.n * value.d,
    magnitude = difference < 0n ? -difference : difference;
  if (magnitude * bound.d > bound.n * value.d * r.d)
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
