import type { ReliefSourceSnapshot } from '../types';
import type { CellGraph, CellGraphNode, CellGraphPath, CellGraphWork } from './graph';
import {
  compareDirections,
  exactDiagram,
  pointSegmentDistanceSquared,
  rectangle,
} from './exact-diagram';
import type { ExactEdge } from './exact-diagram';
import { add, compare, cross, delta, exact, mul, point, square } from './rational';
import type { ExactPoint, Rational } from './rational';
import {
  addI,
  divI,
  inflateI,
  interval,
  mulI,
  nextDown,
  nextUp,
  scaleI,
  sqrtNonnegativeI,
  squareI,
  subI,
  sumI,
} from './interval';
import type { Interval } from './interval';
import { certifyWarp } from './warp-bounds';
import type { WarpCertificate } from './warp-bounds';
import { clipWarpEdge, rationalInterval } from './warp-clipping';
import type { EdgeEndpoint } from './warp-clipping';
import { invertWarp } from './warp-inverse';

/** One exact query edge q(t) = a + t d. Curve nodes carry the binary64 parameter t, so
 * subdivision never builds a rational midpoint: every quantity below is an outward
 * interval of the exact a + t d, and exact rationals are formed only when an interval
 * test is inconclusive. */
interface EdgeFrame {
  readonly a: ExactPoint;
  readonly b: ExactPoint;
  readonly ax: Interval;
  readonly ay: Interval;
  readonly dx: Interval;
  readonly dy: Interval;
  readonly length2: Interval;
}
interface CurveNode {
  readonly id: string;
  readonly frame: EdgeFrame;
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly error: number;
  readonly boundary?: EdgeEndpoint['boundary'];
}
/** What emission needs of a node: corners carry no query edge. */
interface EmittedNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly boundary?: EdgeEndpoint['boundary'];
}
interface CurveSegment {
  readonly edge: number;
  readonly a: CurveNode;
  readonly b: CurveNode;
  readonly error: number;
  readonly depth: number;
}
const CURVE_TARGET = 0.002;
const MIN_CURVE_ERROR = 2e-7;
function edgeFrame(edge: ExactEdge): EdgeFrame {
  const ax = rationalInterval(edge.a[0]),
    ay = rationalInterval(edge.a[1]),
    dx = subI(rationalInterval(edge.b[0]), ax),
    dy = subI(rationalInterval(edge.b[1]), ay);
  return { a: edge.a, b: edge.b, ax, ay, dx, dy, length2: addI(squareI(dx), squareI(dy)) };
}
const exactDirections = new WeakMap<EdgeFrame, ExactPoint>();
/** The exact direction b - a, built only for inconclusive interval tests. */
function direction(frame: EdgeFrame): ExactPoint {
  let d = exactDirections.get(frame);
  if (!d) { d = delta(frame.b, frame.a); exactDirections.set(frame, d); }
  return d;
}
/** Outward enclosure of the binary64 difference b - a. */
function differenceI(b: number, a: number): Interval {
  const value = b - a;
  // Sterbenz: the difference of values within a factor of two is exact.
  if ((a === 0 && b === 0) || (a > 0 && b > 0 && b <= 2 * a && a <= 2 * b)
    || (a < 0 && b < 0 && b >= 2 * a && a >= 2 * b)) return interval(value);
  return [nextDown(value), nextUp(value)];
}
const queryI = (node: CurveNode): readonly [Interval, Interval] => [
  addI(node.frame.ax, mulI(interval(node.t), node.frame.dx)),
  addI(node.frame.ay, mulI(interval(node.t), node.frame.dy)),
];
const exactQueries = new WeakMap<CurveNode, ExactPoint>();
/** The exact query point a + t d, built only for inconclusive interval tests. */
function exactQuery(node: CurveNode): ExactPoint {
  let q = exactQueries.get(node);
  if (!q) {
    const t = exact(node.t);
    const d = direction(node.frame);
    q = [add(node.frame.a[0], mul(t, d[0])), add(node.frame.a[1], mul(t, d[1]))];
    exactQueries.set(node, q);
  }
  return q;
}
/** Squared query chord between two nodes of one edge: (tb - ta)^2 |d|^2. */
const squareLength = (a: CurveNode, b: CurveNode): Interval =>
  mulI(squareI(differenceI(b.t, a.t)), a.frame.length2);
/** Query displacement from `from` to `to` along one edge: (to.t - from.t) d. */
const displacementI = (from: CurveNode, to: CurveNode): readonly [Interval, Interval] => {
  const dt = differenceI(to.t, from.t);
  return [mulI(dt, from.frame.dx), mulI(dt, from.frame.dy)];
};
function chordError(c: WarpCertificate, a: CurveNode, b: CurveNode): number {
  const curvature = mulI(
    mulI(
      mulI(interval(c.inverseLipschitz), interval(c.inverseLipschitz)),
      interval(c.inverseLipschitz),
    ),
    interval(c.hessian),
  );
  const geometric = scaleI(mulI(curvature, squareLength(a, b)), 0.125)[1];
  return sumI([
    interval(geometric),
    interval(Math.max(a.error, b.error)),
    scaleI(interval(c.inverseLipschitz), 2e-10),
  ])[1];
}
function splitSegment(
  segment: CurveSegment,
  c: WarpCertificate,
  budget: CellGraphWork,
): readonly [CurveSegment, CurveSegment] {
  budget.step();
  if (segment.depth >= 28) throw new Error('Warp curve subdivision depth exhausted');
  const ta = segment.a.t,
    tb = segment.b.t,
    t = ta + (tb - ta) / 2;
  if (!(t > Math.min(ta, tb) && t < Math.max(ta, tb)))
    throw new Error('Warp curve subdivision depth exhausted');
  const frame = segment.a.frame,
    probe = { id: '', frame, t, x: 0, y: 0, error: 0 },
    [ix, iy] = queryI(probe),
    qx = ix[0] + (ix[1] - ix[0]) / 2,
    qy = iy[0] + (iy[1] - iy[0]) / 2;
  // The emitted query lies inside the enclosure of the exact a + t d, so it is within its
  // width of that point, the same 1e-10 per-coordinate budget an exact rounding met.
  if (ix[1] - ix[0] > 1e-10 || iy[1] - iy[0] > 1e-10)
    throw new Error('Graph coordinate conversion exceeds numeric error budget');
  const p = invertWarp(c, qx, qy, budget, undefined,
    [segment.a.x + (segment.b.x - segment.a.x) / 2, segment.a.y + (segment.b.y - segment.a.y) / 2]);
  const middle: CurveNode = {
    id: `sample:${segment.edge}:${t}`,
    frame,
    t,
    x: p.x,
    y: p.y,
    error: addI(interval(p.error), scaleI(interval(c.inverseLipschitz), 2e-10))[1],
  };
  const a = {
    edge: segment.edge,
    a: segment.a,
    b: middle,
    error: 0,
    depth: segment.depth + 1,
  };
  const b = {
    edge: segment.edge,
    a: middle,
    b: segment.b,
    error: 0,
    depth: segment.depth + 1,
  };
  return [
    { ...a, error: chordError(c, a.a, a.b) },
    { ...b, error: chordError(c, b.a, b.b) },
  ];
}
function inverseDirection(
  c: WarpCertificate,
  box: readonly [Interval, Interval],
  direction: readonly [Interval, Interval],
): readonly [Interval, Interval] {
  const jacobian = c.jacobian(box[0], box[1]),
    a = addI(interval(1), jacobian[0]),
    b = jacobian[1],
    d = addI(interval(1), jacobian[3]),
    cc = jacobian[2];
  const determinant = subI(mulI(a, d), mulI(b, cc));
  if (determinant[0] <= 0) throw new Error('Warp junction inverse Jacobian cannot be certified');
  const [x, y] = direction;
  return [
    divI(subI(mulI(d, x), mulI(b, y)), determinant),
    divI(subI(mulI(a, y), mulI(cc, x)), determinant),
  ];
}
/** Every tangent and the emitted chord lies in its interval cone. Disjoint cones
 * retain the exact query junction's incidence and cyclic order throughout rounding. */
function separatedAtJunction(
  a: CurveSegment,
  b: CurveSegment,
  shared: CurveNode,
  c: WarpCertificate,
): boolean {
  const endA = a.a.id === shared.id ? a.b : a.a,
    endB = b.a.id === shared.id ? b.b : b.a,
    sharedA = a.a.id === shared.id ? a.a : a.b,
    sharedB = b.a.id === shared.id ? b.a : b.b;
  const qa = displacementI(sharedA, endA),
    qb = displacementI(sharedB, endB);
  const distance = Math.max(
    sqrtNonnegativeI(squareLength(endA, sharedA))[1],
    sqrtNonnegativeI(squareLength(endB, sharedB))[1],
  );
  const radius = addI(
    mulI(interval(c.inverseLipschitz), interval(distance)),
    interval(shared.error),
  )[1];
  const box = [inflateI(interval(shared.x), radius), inflateI(interval(shared.y), radius)] as const;
  let da: readonly [Interval, Interval], db: readonly [Interval, Interval];
  try {
    da = inverseDirection(c, box, qa);
    db = inverseDirection(c, box, qb);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Warp junction inverse Jacobian cannot be certified'
    )
      return false;
    throw error;
  }
  da = [
    inflateI(da[0], addI(interval(shared.error), interval(endA.error))[1]),
    inflateI(da[1], addI(interval(shared.error), interval(endA.error))[1]),
  ];
  db = [
    inflateI(db[0], addI(interval(shared.error), interval(endB.error))[1]),
    inflateI(db[1], addI(interval(shared.error), interval(endB.error))[1]),
  ];
  // sign(cross(qa, qb)) = sign(dta) sign(dtb) sign(cross(da, db)); the frame cross product
  // is decided by intervals and falls back to exact rationals only when they straddle zero.
  const frameCross = subI(mulI(sharedA.frame.dx, sharedB.frame.dy), mulI(sharedA.frame.dy, sharedB.frame.dx));
  const frameSign = frameCross[0] > 0 ? 1 : frameCross[1] < 0 ? -1
    : Math.sign(Number(cross(direction(sharedA.frame), direction(sharedB.frame)).n));
  const determinant = frameSign * Math.sign(endA.t - sharedA.t) * Math.sign(endB.t - sharedB.t);
  if (determinant === 0) return addI(mulI(da[0], db[0]), mulI(da[1], db[1]))[1] < 0;
  const orientation = subI(mulI(da[0], db[1]), mulI(da[1], db[0]));
  return determinant > 0 ? orientation[0] > 0 : orientation[1] < 0;
}
/** Lower bound on the squared distance from point P to segment AB (query boxes): the
 * distance to the supporting line, or to an endpoint where the projection is decided. */
function segmentGapLower(p: readonly [Interval, Interval], a: readonly [Interval, Interval],
  b: readonly [Interval, Interval]): number {
  const dir = [subI(b[0], a[0]), subI(b[1], a[1])] as const,
    pa = [subI(p[0], a[0]), subI(p[1], a[1])] as const;
  const length2 = addI(squareI(dir[0]), squareI(dir[1]));
  const projection = addI(mulI(pa[0], dir[0]), mulI(pa[1], dir[1]));
  let lower = 0;
  if (length2[0] > 0) {
    const crossed = subI(mulI(pa[0], dir[1]), mulI(pa[1], dir[0]));
    lower = divI(squareI(crossed), length2)[0];
  }
  if (projection[1] <= 0) lower = Math.max(lower, addI(squareI(pa[0]), squareI(pa[1]))[0]);
  else if (projection[0] >= length2[1]) {
    const pb = [subI(p[0], b[0]), subI(p[1], b[1])] as const;
    lower = Math.max(lower, addI(squareI(pb[0]), squareI(pb[1]))[0]);
  }
  return lower;
}
function nonincidentSeparated(a: CurveSegment, b: CurveSegment, c: WarpCertificate): boolean {
  const uncertainty = mulI(
    addI(interval(a.error), interval(b.error)),
    addI(interval(1), interval(c.lipschitz)),
  )[1];
  const bound = nextUp(uncertainty * uncertainty);
  const [qaa, qab, qba, qbb] = [a.a, a.b, b.a, b.b].map(queryI);
  if ([segmentGapLower(qaa, qba, qbb), segmentGapLower(qab, qba, qbb),
    segmentGapLower(qba, qaa, qab), segmentGapLower(qbb, qaa, qab)].every((lower) => lower > bound))
    return true;
  const threshold = square(exact(uncertainty));
  const [ea, eb, fa, fb] = [a.a, a.b, b.a, b.b].map(exactQuery);
  return [
    pointSegmentDistanceSquared(ea, fa, fb),
    pointSegmentDistanceSquared(eb, fa, fb),
    pointSegmentDistanceSquared(fa, ea, eb),
    pointSegmentDistanceSquared(fb, ea, eb),
  ].every((distance) => compare(distance, threshold) > 0);
}
interface Box {
  readonly xmin: number;
  readonly xmax: number;
  readonly ymin: number;
  readonly ymax: number;
}
function corridorBox(segment: CurveSegment, c: WarpCertificate): Box {
  const [ax, ay] = queryI(segment.a),
    [bx, by] = queryI(segment.b);
  const r = mulI(interval(segment.error), addI(interval(1), interval(c.lipschitz)))[1];
  return {
    xmin: nextDown(Math.min(ax[0], bx[0]) - r),
    xmax: nextUp(Math.max(ax[1], bx[1]) + r),
    ymin: nextDown(Math.min(ay[0], by[0]) - r),
    ymax: nextUp(Math.max(ay[1], by[1]) + r),
  };
}
function topologyRefinement(
  segments: readonly CurveSegment[],
  c: WarpCertificate,
  budget: CellGraphWork,
): Set<number> {
  const cells = new Map<number, number[]>(),
    boxes = segments.map((segment) => corridorBox(segment, c));
  const pairs = new Set<number>(),
    refine = new Set<number>(),
    size = 0.25,
    count = segments.length;
  for (let i = 0; i < segments.length; i++) {
    const box = boxes[i];
    for (let x = Math.floor(box.xmin / size); x <= Math.floor(box.xmax / size); x++)
      for (let y = Math.floor(box.ymin / size); y <= Math.floor(box.ymax / size); y++) {
        budget.step();
        // Board cells span well under 2^20 per axis, so the numeric key is collision free.
        const key = (x + 524288) * 1048576 + (y + 524288),
          occupants = cells.get(key) ?? [];
        for (const j of occupants) {
          budget.step();
          const pair = j * count + i;
          if (pairs.has(pair)) continue;
          pairs.add(pair);
          const previous = boxes[j];
          if (
            box.xmin > previous.xmax ||
            previous.xmin > box.xmax ||
            box.ymin > previous.ymax ||
            previous.ymin > box.ymax
          )
            continue;
          const a = segments[j],
            b = segments[i];
          // Along one query line inverse strong monotonicity makes the complete arc simple.
          if (a.edge === b.edge) continue;
          const shared = [a.a, a.b].find((node) => node.id === b.a.id || node.id === b.b.id);
          const separated = shared
            ? separatedAtJunction(a, b, shared, c)
            : nonincidentSeparated(a, b, c);
          if (!separated) {
            if (a.error <= MIN_CURVE_ERROR && b.error <= MIN_CURVE_ERROR)
              throw new Error('Warp curve separation or junction order cannot be certified');
            refine.add(j);
            refine.add(i);
          }
        }
        occupants.push(i);
        cells.set(key, occupants);
      }
  }
  return refine;
}

export function buildWarpCellGraph(
  source: ReliefSourceSnapshot,
  revision: number,
  budget: CellGraphWork,
): CellGraph {
  const { meshX: width, meshY: height } = source.query,
    c = certifyWarp(source.query, budget);
  const diagram = exactDiagram(
    source.sites,
    source.query.metric,
    rectangle(width, height, c.displacement),
    budget,
  );
  const edges = diagram.edges.filter((edge) => edge.owners.length === 2),
    junctions = new Map<string, EdgeEndpoint>();
  const paths: { owners: readonly number[]; segments: CurveSegment[] }[] = [];
  const frames = edges.map(edgeFrame);
  const makeNode = (endpoint: EdgeEndpoint, frame: EdgeFrame): CurveNode => {
    return {
      id: endpoint.id,
      frame,
      t: endpoint.parameter,
      x: endpoint.world.x,
      y: endpoint.world.y,
      error: sumI([
        scaleI(interval(endpoint.world.error), 2),
        endpoint.boundary
          ? scaleI(subI(interval(endpoint.boundary.t[1]), interval(endpoint.boundary.t[0])), 0.5)
          : interval(0),
        scaleI(interval(c.inverseLipschitz), 2e-10),
      ])[1],
      boundary: endpoint.boundary,
    };
  };
  edges.forEach((edge, index) => {
    for (const fragment of clipWarpEdge(edge, index, c, width, height, budget, junctions)) {
      const a = makeNode(fragment.a, frames[index]),
        b = makeNode(fragment.b, frames[index]);
      paths.push({
        owners: edge.owners,
        segments: [{ edge: index, a, b, error: chordError(c, a, b), depth: 0 }],
      });
    }
  });
  // First meet the metric error, then refine only corridors whose embedding is unresolved.
  for (const path of paths) {
    const pending = [...path.segments],
      accepted: CurveSegment[] = [];
    while (pending.length) {
      budget.step();
      const segment = pending.pop()!;
      if (segment.error > CURVE_TARGET) {
        const [a, b] = splitSegment(segment, c, budget);
        pending.push(b, a);
      } else accepted.push(segment);
    }
    path.segments = accepted;
  }
  for (let round = 0; round < 28; round++) {
    const all = paths.flatMap((path) => path.segments),
      refine = topologyRefinement(all, c, budget);
    if (refine.size === 0) break;
    if (round === 27) throw new Error('Warp topology refinement round budget exhausted');
    let index = 0;
    for (const path of paths)
      path.segments = path.segments.flatMap((segment) =>
        refine.has(index++) ? [...splitSegment(segment, c, budget)] : [segment],
      );
  }
  const nodes = new Map<string, EmittedNode>();
  // sign(d . w) for an exact query direction d and binary64 world displacement w, by
  // intervals first and exact rationals only when they straddle zero.
  const projectionSign = (frame: EdgeFrame, from: EmittedNode, to: EmittedNode): number => {
    const wx = differenceI(to.x, from.x),
      wy = differenceI(to.y, from.y),
      value = addI(mulI(frame.dx, wx), mulI(frame.dy, wy));
    if (value[0] > 0) return 1;
    if (value[1] < 0) return -1;
    const w = delta(point(to.x, to.y), point(from.x, from.y)),
      d = direction(frame),
      exactValue: Rational = add(mul(d[0], w[0]), mul(d[1], w[1]));
    return exactValue.n > 0n ? 1 : exactValue.n < 0n ? -1 : 0;
  };
  for (const path of paths)
    for (const segment of path.segments) {
      nodes.set(segment.a.id, segment.a);
      nodes.set(segment.b.id, segment.b);
      // Positive projection proves each emitted line chain is simple as well as the true inverse arc.
      if (Math.sign(segment.b.t - segment.a.t) * projectionSign(segment.a.frame, segment.a, segment.b) <= 0)
        throw new Error('Warp polyline lost inverse strong monotonicity');
      for (const node of [segment.a, segment.b])
        if (node.x < 0 || node.x > width || node.y < 0 || node.y > height)
          throw new Error('Warp emitted point lies outside the physical board');
    }
  const byEdge = new Map<number, CurveSegment[]>();
  for (const path of paths)
    for (const segment of path.segments) {
      const list = byEdge.get(segment.edge) ?? [];
      list.push(segment);
      byEdge.set(segment.edge, list);
    }
  for (const [edgeIndex, segments] of byEdge) {
    // Along q(t) = a + t d the query order is the parameter order.
    segments.sort((a, b) => a.a.t - b.a.t);
    for (let i = 1; i < segments.length; i++) {
      const previous = segments[i - 1].b,
        next = segments[i].a;
      if (previous.id === next.id) continue;
      if (projectionSign(frames[edgeIndex], previous, next) <= 0)
        throw new Error('Warp disconnected fragments lost inverse projection order');
    }
  }
  const corners: [[number, number], [number, number], [number, number], [number, number]] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const outline: string[] = [];
  for (let side = 0; side < 4; side++) {
    const corner = corners[side],
      id = `corner:${side}`;
    nodes.set(id, { id, x: corner[0], y: corner[1] });
    outline.push(id);
    const boundary = [...nodes.values()]
      .filter((node) => node.boundary?.side === side)
      .sort((a, b) =>
        side < 2 ? a.boundary!.t[0] - b.boundary!.t[0] : b.boundary!.t[0] - a.boundary!.t[0],
      );
    for (let i = 1; i < boundary.length; i++) {
      const a = boundary[i - 1].boundary!,
        b = boundary[i].boundary!;
      if (!(a.t[1] < b.t[0] || b.t[1] < a.t[0]))
        throw new Error('Warp boundary junctions cannot be ordered');
    }
    outline.push(...boundary.map((node) => node.id));
  }
  const inner: CellGraphPath[] = paths.map((path, i) =>
    Object.freeze({
      id: `edge:${i}`,
      nodes: Object.freeze([
        path.segments[0].a.id,
        ...path.segments.map((segment) => segment.b.id),
      ]),
      owners: Object.freeze([...path.owners]),
      closed: false,
    }),
  );
  const incident = new Map<string, { id: string; direction: ExactPoint }[]>();
  const addIncident = (id: string, other: string, path: string): void => {
    const a = nodes.get(id)!,
      b = nodes.get(other)!,
      list = incident.get(id) ?? [];
    list.push({ id: path, direction: delta(point(b.x, b.y), point(a.x, a.y)) });
    incident.set(id, list);
  };
  for (const path of inner)
    for (let i = 0; i + 1 < path.nodes.length; i++) {
      addIncident(path.nodes[i], path.nodes[i + 1], path.id);
      addIncident(path.nodes[i + 1], path.nodes[i], path.id);
    }
  for (let i = 0; i < outline.length; i++) {
    addIncident(outline[i], outline[(i + 1) % outline.length], `outline:${i}`);
    addIncident(outline[(i + 1) % outline.length], outline[i], `outline:${i}`);
  }
  const emitted: CellGraphNode[] = [...nodes.values()].map((node) =>
    Object.freeze({
      id: node.id,
      x: node.x,
      y: node.y,
      incident: Object.freeze(
        (incident.get(node.id) ?? [])
          .sort((a, b) => compareDirections(a.direction, b.direction))
          .map((item) => item.id),
      ),
    }),
  );
  if (nodes.size > 100_000) throw new Error('Warp graph vertex budget exceeded');
  const maxError = paths.reduce(
    (maximum, path) =>
      path.segments.reduce((value, segment) => Math.max(value, segment.error), maximum),
    0,
  );
  if (maxError >= 0.005) throw new Error('Warp total geometric error exceeds DXF budget');
  budget.step();
  return Object.freeze({
    revision,
    implementation: source.query.implementation,
    width,
    height,
    nodes: Object.freeze(emitted),
    inner: Object.freeze(inner),
    outer: Object.freeze({
      id: 'outline',
      nodes: Object.freeze(outline),
      owners: Object.freeze([]),
      closed: true,
    }),
    certificate: Object.freeze({
      kind: 'contraction' as const,
      errorIn: maxError,
      topology: 'inverse-separated-curves' as const,
      steps: budget.steps,
      kernel: c.kernel,
      lipschitz: c.lipschitz,
      hessian: c.hessian,
      evaluationResidue: c.evaluationResidue,
    }),
  });
}
