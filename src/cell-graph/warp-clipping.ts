import type { ExactEdge, GraphBudget } from './exact-diagram';
import { emitCoordinate } from './exact-diagram';
import { compare, div, exact, add, mul, number, sub } from './rational';
import type { Rational } from './rational';
import {
  absI,
  addI,
  divI,
  inflateI,
  interval,
  midpointI,
  mulI,
  nextDown,
  nextUp,
  scaleI,
  squareI,
  sqrtNonnegativeI,
  subI,
  sumI,
} from './interval';
import type { Interval } from './interval';
import { encloseAtPoint } from './warp-bounds';
import type { WarpCertificate } from './warp-bounds';
import { invertWarp } from './warp-inverse';
import type { InversePoint } from './warp-inverse';

export interface BoundaryRoot {
  readonly id: string;
  readonly side: number;
  readonly t: Interval;
  readonly parameter: Interval;
  readonly query: readonly [number, number];
  readonly world: InversePoint;
}
export interface EdgeEndpoint {
  readonly id: string;
  readonly parameter: number;
  readonly query: readonly [number, number];
  readonly world: InversePoint;
  readonly boundary?: BoundaryRoot;
}
export interface ClippedFragment {
  readonly a: EdgeEndpoint;
  readonly b: EdgeEndpoint;
}
const ROOT_TOLERANCE = 2e-7;

/** An exact rational coefficient is enclosed by adjacent representable numbers. */
export function rationalInterval(value: Rational): Interval {
  let lower = number(value),
    upper = lower;
  for (let i = 0; i < 16; i++) {
    const low = compare(exact(lower), value),
      high = compare(exact(upper), value);
    if (low <= 0 && high >= 0) return [lower, upper];
    if (low > 0) lower = nextDown(lower);
    if (high < 0) upper = nextUp(upper);
  }
  throw new Error('Rational line coefficient could not be enclosed');
}
function queryLine(edge: ExactEdge): readonly [Interval, Interval, Interval] {
  const a = sub(edge.b[1], edge.a[1]),
    b = sub(edge.a[0], edge.b[0]);
  const scale = Math.max(Math.abs(number(a)), Math.abs(number(b)));
  if (!(scale > 0)) throw new Error('Warp clipping received a zero query edge');
  const divisor = exact(scale),
    na = div(a, divisor),
    nb = div(b, divisor);
  return [
    rationalInterval(na),
    rationalInterval(nb),
    rationalInterval(
      div(sub(mul(a, edge.a[0]), mul(sub(edge.b[0], edge.a[0]), edge.a[1])), divisor),
    ),
  ];
}
const sign = (value: Interval): number => (value[0] > 0 ? 1 : value[1] < 0 ? -1 : 0);
const sidePoint = (
  side: number,
  t: Interval,
  width: number,
  height: number,
): readonly [Interval, Interval] =>
  side === 0
    ? [t, interval(0)]
    : side === 1
      ? [interval(width), t]
      : side === 2
        ? [t, interval(height)]
        : [interval(0), t];

/** Isolate every intersection of an entire query bisector with all physical board sides.
 * Range exclusion and derivative sign establish completeness, including same-sign endpoints. */
export function boardRoots(
  edge: ExactEdge,
  certificate: WarpCertificate,
  width: number,
  height: number,
  budget: GraphBudget,
): BoundaryRoot[] {
  const exactA = [rationalInterval(edge.a[0]), rationalInterval(edge.a[1])] as const;
  const roots: BoundaryRoot[] = [];
  // Every warped side point lies within the certified per-axis displacement of its side, so
  // a side farther than that from the query segment's box holds no crossing with parameter
  // in [0, 1]; only the infinite supporting line could meet it, and those roots are discarded.
  const exactB = [rationalInterval(edge.b[0]), rationalInterval(edge.b[1])] as const;
  const reach = nextUp(nextUp(certificate.displacement + certificate.evaluationResidue) + 1e-9);
  const lowX = Math.min(exactA[0][0], exactB[0][0]), highX = Math.max(exactA[0][1], exactB[0][1]);
  const lowY = Math.min(exactA[1][0], exactB[1][0]), highY = Math.max(exactA[1][1], exactB[1][1]);
  const unreachable = [lowY > reach, highX < nextDown(width - reach), highY < nextDown(height - reach), lowX > reach];
  if (unreachable.every(Boolean)) return roots;
  const line = queryLine(edge);
  const deltaX = rationalInterval(sub(edge.b[0], edge.a[0])),
    deltaY = rationalInterval(sub(edge.b[1], edge.a[1]));
  const denominator = addI(squareI(deltaX), squareI(deltaY));
  for (let side = 0; side < 4; side++) {
    if (unreachable[side]) continue;
    const extent = side % 2 === 0 ? width : height;
    const evaluate = (t: number): Interval => {
      const [x, y] = sidePoint(side, interval(t), width, height),
        warp = certificate.enclose(x, y);
      return subI(addI(mulI(line[0], warp[0]), mulI(line[1], warp[1])), line[2]);
    };
    // Bisection only needs a sign. The point enclosure contains the full one, so a sign it
    // decides is the full enclosure's sign; otherwise the full enclosure decides, exactly
    // as before. Every bracket step is therefore unchanged.
    const quickValue = (t: number): Interval => {
      const [x, y] = sidePoint(side, interval(t), width, height),
        warp = encloseAtPoint(certificate, x[0], y[0]);
      return subI(addI(mulI(line[0], warp[0]), mulI(line[1], warp[1])), line[2]);
    };
    const signAt = (t: number): { sign: number; value: () => Interval } => {
      const quickSign = sign(quickValue(t));
      if (quickSign !== 0) return { sign: quickSign, value: () => evaluate(t) };
      const full = evaluate(t);
      return { sign: sign(full), value: () => full };
    };
    const derivative = (t: Interval): Interval => {
      const [x, y] = sidePoint(side, t, width, height),
        jacobian = certificate.jacobian(x, y);
      return side % 2 === 0
        ? addI(mulI(line[0], addI(interval(1), jacobian[0])), mulI(line[1], jacobian[2]))
        : addI(mulI(line[0], jacobian[1]), mulI(line[1], addI(interval(1), jacobian[3])));
    };
    const candidates: Interval[] = [];
    const stack: { t: Interval; depth: number }[] = [{ t: [0, extent], depth: 0 }];
    while (stack.length) {
      budget.step();
      const box = stack.pop()!,
        mid = midpointI(box.t),
        d = derivative(box.t);
      const radius = scaleI(interval(absI(d)), nextUp((box.t[1] - box.t[0]) / 2))[1];
      // A box excluded by the wider point enclosure is excluded by the full one too.
      if (sign(inflateI(quickValue(mid), radius)) !== 0) continue;
      const fm = evaluate(mid);
      if (sign(inflateI(fm, radius)) !== 0) continue;
      const ds = sign(d);
      if (ds !== 0) {
        const quickFirst = quickValue(box.t[0]),
          quickLast = quickValue(box.t[1]);
        if (sign(quickFirst) !== 0 && sign(quickFirst) === sign(quickLast)) continue;
        const first = evaluate(box.t[0]),
          last = evaluate(box.t[1]);
        if (sign(first) !== 0 && sign(first) === sign(last)) continue;
        let lo = box.t[0],
          hi = box.t[1];
        if (sign(first) === 0 || sign(last) === 0) {
          const t = sign(first) === 0 ? lo : hi,
            ft = sign(first) === 0 ? first : last;
          const minimum = Math.min(Math.abs(d[0]), Math.abs(d[1]));
          const r = divI(interval(absI(ft)), interval(minimum))[1];
          lo = nextDown(t - 2 * r - ROOT_TOLERANCE);
          hi = nextUp(t + 2 * r + ROOT_TOLERANCE);
          if (lo <= 0 || hi >= extent)
            throw new Error('Warp board root is unresolved at a board corner');
          if (sign(derivative([lo, hi])) === 0 || sign(evaluate(lo)) * sign(evaluate(hi)) !== -1)
            throw new Error('Warp board root bracket could not be proved');
        }
        let iterations = 0;
        while (hi - lo > ROOT_TOLERANCE) {
          budget.step();
          if (++iterations > 96) throw new Error('Warp board root work budget exhausted');
          const t = lo + (hi - lo) / 2,
            probe = signAt(t),
            fs = probe.sign;
          if (fs === 0) {
            const ft = probe.value();
            const local = derivative([lo, hi]),
              minimum = Math.min(Math.abs(local[0]), Math.abs(local[1]));
            if (sign(local) === 0) throw new Error('Warp board root lost monotonicity');
            const radius = divI(interval(absI(ft)), interval(minimum))[1];
            if (2 * radius >= hi - lo)
              throw new Error('Warp board root cannot meet its arithmetic error budget');
            const nextLo = Math.max(lo, nextDown(t - radius)),
              nextHi = Math.min(hi, nextUp(t + radius));
            if (nextHi - nextLo > ROOT_TOLERANCE && nextHi - nextLo >= (hi - lo) * 0.99)
              throw new Error('Warp board root cannot meet its arithmetic error budget');
            lo = nextLo;
            hi = nextHi;
          } else if (fs === ds) hi = t;
          else lo = t;
        }
        candidates.push([lo, hi]);
        continue;
      }
      if (box.depth >= 26 || box.t[1] - box.t[0] < ROOT_TOLERANCE)
        throw new Error('Warp board tangency or root count cannot be certified');
      stack.push(
        { t: [box.t[0], mid], depth: box.depth + 1 },
        { t: [mid, box.t[1]], depth: box.depth + 1 },
      );
    }
    candidates.sort((a, b) => a[0] - b[0]);
    const unique: Interval[] = [];
    for (const candidate of candidates) {
      const previous = unique.at(-1);
      if (previous && candidate[0] <= previous[1]) {
        const union: Interval = [previous[0], Math.max(previous[1], candidate[1])];
        if (sign(derivative(union)) === 0) throw new Error('Warp board roots cannot be separated');
        unique[unique.length - 1] = union;
      } else unique.push(candidate);
    }
    for (const t of unique) {
      const midpoint = midpointI(t),
        [x, y] = sidePoint(side, interval(midpoint), width, height);
      const [wx, wy] = certificate.enclose(...sidePoint(side, t, width, height));
      // Projection uses interval arithmetic; exact source edge endpoint conversion is <=1e-10in.
      const numerator = addI(mulI(subI(wx, exactA[0]), deltaX), mulI(subI(wy, exactA[1]), deltaY));
      const parameter = divI(numerator, denominator);
      if (parameter[1] < 0 || parameter[0] > 1) continue;
      if (parameter[0] <= 0 || parameter[1] >= 1)
        throw new Error('Warp board crossing is unresolved at a query junction');
      const fraction = exact(midpointI(parameter));
      const queryPoint = [
        emitCoordinate(add(edge.a[0], mul(fraction, sub(edge.b[0], edge.a[0])))),
        emitCoordinate(add(edge.a[1], mul(fraction, sub(edge.b[1], edge.a[1])))),
      ] as const;
      const enclosure = certificate.enclose(x, y);
      const residual = sqrtNonnegativeI(
        sumI([
          squareI(subI(enclosure[0], interval(queryPoint[0]))),
          squareI(subI(enclosure[1], interval(queryPoint[1]))),
        ]),
      )[1];
      const error = mulI(interval(residual), interval(certificate.inverseLipschitz))[1];
      if (error > 1e-5) throw new Error('Warp board root inverse error exceeds its budget');
      roots.push({
        id: `board:${side}:${midpoint}`,
        side,
        t,
        parameter,
        query: queryPoint,
        world: { x: x[0], y: y[0], error },
      });
    }
  }
  roots.sort((a, b) => midpointI(a.parameter) - midpointI(b.parameter));
  for (let i = 1; i < roots.length; i++)
    if (roots[i - 1].parameter[1] >= roots[i].parameter[0])
      throw new Error('Warp board crossings cannot be ordered');
  return roots;
}

export function clipWarpEdge(
  edge: ExactEdge,
  edgeIndex: number,
  certificate: WarpCertificate,
  width: number,
  height: number,
  budget: GraphBudget,
  junctions: Map<string, EdgeEndpoint>,
): ClippedFragment[] {
  const endpoint = (p: typeof edge.a, parameter: number): EdgeEndpoint => {
    const id = `junction:${p[0].n}/${p[0].d},${p[1].n}/${p[1].d}`;
    let result = junctions.get(id);
    if (!result) {
      const q: readonly [number, number] = [emitCoordinate(p[0]), emitCoordinate(p[1])];
      result = {
        id,
        parameter,
        query: q,
        world: invertWarp(certificate, q[0], q[1], budget),
      };
      junctions.set(id, result);
    }
    return { ...result, parameter };
  };
  const roots = boardRoots(edge, certificate, width, height, budget);
  const endpoints: EdgeEndpoint[] = [
    endpoint(edge.a, 0),
    ...roots.map((root, i) => ({
      id: `edge:${edgeIndex}:root:${i}`,
      parameter: midpointI(root.parameter),
      query: root.query,
      world: root.world,
      boundary: root,
    })),
    endpoint(edge.b, 1),
  ];
  const result: ClippedFragment[] = [];
  // Fragment midpoints come from outward intervals of the exact a + t (b - a).
  const startX = rationalInterval(edge.a[0]),
    startY = rationalInterval(edge.a[1]),
    stepX = subI(rationalInterval(edge.b[0]), startX),
    stepY = subI(rationalInterval(edge.b[1]), startY);
  for (let i = 0; i + 1 < endpoints.length; i++) {
    const a = endpoints[i],
      b = endpoints[i + 1];
    const lo = a.boundary?.parameter[1] ?? a.parameter,
      hi = b.boundary?.parameter[0] ?? b.parameter;
    if (!(lo < hi)) throw new Error('Warp clipping has no certified gap between roots');
    const t = interval(lo + (hi - lo) / 2),
      qx = addI(startX, mulI(t, stepX)),
      qy = addI(startY, mulI(t, stepY));
    if (qx[1] - qx[0] > 1e-10 || qy[1] - qy[0] > 1e-10)
      throw new Error('Graph coordinate conversion exceeds numeric error budget');
    const inverted = invertWarp(certificate, midpointI(qx), midpointI(qy), budget);
    const mid = {
      ...inverted,
      error: addI(
        interval(inverted.error),
        scaleI(interval(certificate.inverseLipschitz), 2e-10),
      )[1],
    };
    if (
      mid.x + mid.error < 0 ||
      mid.x - mid.error > width ||
      mid.y + mid.error < 0 ||
      mid.y - mid.error > height
    )
      continue;
    if (
      mid.x - mid.error <= 0 ||
      mid.x + mid.error >= width ||
      mid.y - mid.error <= 0 ||
      mid.y + mid.error >= height
    )
      throw new Error('Warp fragment board membership is unresolved');
    result.push({ a, b });
  }
  return result;
}
