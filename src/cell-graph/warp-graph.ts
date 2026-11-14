import type { ReliefSourceSnapshot } from '../types';
import type { CellGraph, CellGraphNode, CellGraphPath, CellGraphWork } from './graph';
import {
  compareDirections,
  emitCoordinate,
  exactDiagram,
  pointSegmentDistanceSquared,
  rectangle,
} from './exact-diagram';
import type { ExactEdge } from './exact-diagram';
import { add, compare, cross, delta, exact, mul, point, pointKey, square, sub } from './rational';
import type { ExactPoint } from './rational';
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

interface CurveNode {
  readonly id: string;
  readonly q: ExactPoint;
  readonly x: number;
  readonly y: number;
  readonly error: number;
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
const squareLength = (a: ExactPoint, b: ExactPoint): Interval => {
  const difference = delta(a, b);
  return sumI([squareI(rationalInterval(difference[0])), squareI(rationalInterval(difference[1]))]);
};
function chordError(c: WarpCertificate, a: CurveNode, b: CurveNode): number {
  const curvature = mulI(
    mulI(
      mulI(interval(c.inverseLipschitz), interval(c.inverseLipschitz)),
      interval(c.inverseLipschitz),
    ),
    interval(c.hessian),
  );
  const geometric = scaleI(mulI(curvature, squareLength(a.q, b.q)), 0.125)[1];
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
  const q: ExactPoint = [
    mul(add(segment.a.q[0], segment.b.q[0]), exact(0.5)),
    mul(add(segment.a.q[1], segment.b.q[1]), exact(0.5)),
  ];
  const qx = emitCoordinate(q[0]),
    qy = emitCoordinate(q[1]),
    p = invertWarp(c, qx, qy, budget);
  const middle: CurveNode = {
    id: `sample:${segment.edge}:${pointKey(q)}`,
    q,
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
  direction: ExactPoint,
): readonly [Interval, Interval] {
  const jacobian = c.jacobian(box[0], box[1]),
    a = addI(interval(1), jacobian[0]),
    b = jacobian[1],
    d = addI(interval(1), jacobian[3]),
    cc = jacobian[2];
  const determinant = subI(mulI(a, d), mulI(b, cc));
  if (determinant[0] <= 0) throw new Error('Warp junction inverse Jacobian cannot be certified');
  const x = rationalInterval(direction[0]),
    y = rationalInterval(direction[1]);
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
    endB = b.a.id === shared.id ? b.b : b.a;
  const qa = delta(endA.q, shared.q),
    qb = delta(endB.q, shared.q);
  const distance = Math.max(
    sqrtNonnegativeI(squareLength(endA.q, shared.q))[1],
    sqrtNonnegativeI(squareLength(endB.q, shared.q))[1],
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
  const determinant = cross(qa, qb);
  if (determinant.n === 0n) return addI(mulI(da[0], db[0]), mulI(da[1], db[1]))[1] < 0;
  const orientation = subI(mulI(da[0], db[1]), mulI(da[1], db[0]));
  return determinant.n > 0n ? orientation[0] > 0 : orientation[1] < 0;
}
function nonincidentSeparated(a: CurveSegment, b: CurveSegment, c: WarpCertificate): boolean {
  const uncertainty = mulI(
    addI(interval(a.error), interval(b.error)),
    addI(interval(1), interval(c.lipschitz)),
  )[1];
  const threshold = square(exact(uncertainty));
  return [
    pointSegmentDistanceSquared(a.a.q, b.a.q, b.b.q),
    pointSegmentDistanceSquared(a.b.q, b.a.q, b.b.q),
    pointSegmentDistanceSquared(b.a.q, a.a.q, a.b.q),
    pointSegmentDistanceSquared(b.b.q, a.a.q, a.b.q),
  ].every((distance) => compare(distance, threshold) > 0);
}
interface Box {
  readonly xmin: number;
  readonly xmax: number;
  readonly ymin: number;
  readonly ymax: number;
}
function corridorBox(segment: CurveSegment, c: WarpCertificate): Box {
  const ax = rationalInterval(segment.a.q[0]),
    ay = rationalInterval(segment.a.q[1]),
    bx = rationalInterval(segment.b.q[0]),
    by = rationalInterval(segment.b.q[1]);
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
  const cells = new Map<string, number[]>(),
    boxes = segments.map((segment) => corridorBox(segment, c));
  const pairs = new Set<string>(),
    refine = new Set<number>(),
    size = 0.25;
  for (let i = 0; i < segments.length; i++) {
    const box = boxes[i];
    for (let x = Math.floor(box.xmin / size); x <= Math.floor(box.xmax / size); x++)
      for (let y = Math.floor(box.ymin / size); y <= Math.floor(box.ymax / size); y++) {
        budget.step();
        const key = `${x},${y}`,
          occupants = cells.get(key) ?? [];
        for (const j of occupants) {
          budget.step();
          const pair = `${j}:${i}`;
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
  const makeNode = (endpoint: EdgeEndpoint, edge: ExactEdge): CurveNode => {
    const t = exact(endpoint.parameter),
      q: ExactPoint = [
        add(edge.a[0], mul(t, sub(edge.b[0], edge.a[0]))),
        add(edge.a[1], mul(t, sub(edge.b[1], edge.a[1]))),
      ];
    return {
      id: endpoint.id,
      q,
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
      const a = makeNode(fragment.a, edge),
        b = makeNode(fragment.b, edge);
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
  const nodes = new Map<string, CurveNode>();
  for (const path of paths)
    for (const segment of path.segments) {
      nodes.set(segment.a.id, segment.a);
      nodes.set(segment.b.id, segment.b);
      // Positive projection proves each emitted line chain is simple as well as the true inverse arc.
      const qdirection = delta(segment.b.q, segment.a.q),
        worldDirection = delta(point(segment.b.x, segment.b.y), point(segment.a.x, segment.a.y));
      if (add(mul(qdirection[0], worldDirection[0]), mul(qdirection[1], worldDirection[1])).n <= 0n)
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
    const direction = delta(edges[edgeIndex].b, edges[edgeIndex].a),
      axis = direction[0].n !== 0n ? 0 : 1,
      order = direction[axis].n > 0n ? 1 : -1;
    segments.sort((a, b) => order * compare(a.a.q[axis], b.a.q[axis]));
    for (let i = 1; i < segments.length; i++) {
      const previous = segments[i - 1].b,
        next = segments[i].a;
      if (previous.id === next.id) continue;
      const change = delta(point(next.x, next.y), point(previous.x, previous.y));
      if (add(mul(direction[0], change[0]), mul(direction[1], change[1])).n <= 0n)
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
    nodes.set(id, {
      id,
      q: point(...corner),
      x: corner[0],
      y: corner[1],
      error: 0,
    });
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
