import { validateCellGraphQuery } from './query';
import { SimplexNoiseGen } from '../noise/generators';
import type { ReliefQueryDescription } from '../types';
import type { GraphBudget } from './exact-diagram';
import {
  absI,
  addI,
  divI,
  inflateI,
  interval,
  midpointI,
  mulI,
  nextUp,
  powI,
  scaleI,
  sqrtI,
  squareI,
  subI,
  sumI,
} from './interval';
import type { Interval } from './interval';

type Matrix = readonly [Interval, Interval, Interval, Interval];
export interface NoiseBounds {
  readonly value: Interval;
  readonly dx: Interval;
  readonly dy: Interval;
  readonly dxx: Interval;
  readonly dxy: Interval;
  readonly dyy: Interval;
}
export interface WarpCertificate {
  readonly domain: Readonly<{ xmin: number; xmax: number; ymin: number; ymax: number }>;
  readonly kernel: string;
  readonly displacement: number;
  readonly lipschitz: number;
  readonly inverseLipschitz: number;
  readonly hessian: number;
  /** Per-component world-inch bound, including the complete source warp arithmetic. */
  readonly evaluationResidue: number;
  readonly jacobian: (x: Interval, y: Interval) => Matrix;
  readonly evaluate: (x: number, y: number) => readonly [number, number];
  readonly enclose: (x: Interval, y: Interval) => readonly [Interval, Interval];
}

const SQRT3 = sqrtI(interval(3));
const F = scaleI(subI(SQRT3, interval(1)), 0.5);
const G = divI(subI(interval(3), SQRT3), interval(6));
const OFFSET_X = 31.7,
  OFFSET_Y = 17.3;

/** The continuous model sums compact-support corner polynomials on the ideal skew lattice.
 * The permutation and gradient table are copied from the actual producer runtime. */
export function simplexBounds(
  gen: SimplexNoiseGen,
  x: Interval,
  y: Interval,
  budget: GraphBudget,
): NoiseBounds {
  const kernel = gen.describeKernel();
  const skew = mulI(addI(x, y), F),
    u = addI(x, skew),
    v = addI(y, skew);
  const lowerI = Math.floor(u[0]) - 2,
    upperI = Math.ceil(u[1]) + 2;
  const lowerJ = Math.floor(v[0]) - 2,
    upperJ = Math.ceil(v[1]) + 2;
  if (upperI - lowerI > 128 || upperJ - lowerJ > 128)
    throw new Error('Simplex interval box exceeds lattice work budget');
  const values: Interval[] = [],
    dxs: Interval[] = [],
    dys: Interval[] = [],
    dxxs: Interval[] = [],
    dxys: Interval[] = [],
    dyys: Interval[] = [];
  for (let i = lowerI; i <= upperI; i++)
    for (let j = lowerJ; j <= upperJ; j++) {
      budget.step();
      const unskew = scaleI(G, i + j);
      const rx = subI(x, subI(interval(i), unskew)),
        ry = subI(y, subI(interval(j), unskew));
      const support = subI(interval(0.5), addI(squareI(rx), squareI(ry)));
      if (support[1] <= 0) continue;
      const t: Interval = [Math.max(0, support[0]), Math.max(0, support[1])];
      const [gx, gy] = kernel.grad2[kernel.perm[(i & 255) + kernel.perm[j & 255]] % 12];
      const dot = addI(scaleI(rx, gx), scaleI(ry, gy)),
        t2 = squareI(t),
        t3 = mulI(t2, t),
        t4 = squareI(t2);
      values.push(scaleI(mulI(t4, dot), 70));
      dxs.push(scaleI(subI(scaleI(t4, gx), scaleI(mulI(mulI(rx, t3), dot), 8)), 70));
      dys.push(scaleI(subI(scaleI(t4, gy), scaleI(mulI(mulI(ry, t3), dot), 8)), 70));
      dxxs.push(
        scaleI(
          addI(
            subI(scaleI(mulI(mulI(squareI(rx), t2), dot), 48), scaleI(mulI(t3, dot), 8)),
            scaleI(mulI(rx, t3), -16 * gx),
          ),
          70,
        ),
      );
      dyys.push(
        scaleI(
          addI(
            subI(scaleI(mulI(mulI(squareI(ry), t2), dot), 48), scaleI(mulI(t3, dot), 8)),
            scaleI(mulI(ry, t3), -16 * gy),
          ),
          70,
        ),
      );
      dxys.push(
        scaleI(
          subI(
            scaleI(mulI(mulI(mulI(rx, ry), t2), dot), 48),
            scaleI(mulI(addI(scaleI(rx, gy), scaleI(ry, gx)), t3), 8),
          ),
          70,
        ),
      );
    }
  return {
    value: sumI(values),
    dx: sumI(dxs),
    dy: sumI(dys),
    dxx: sumI(dxxs),
    dxy: sumI(dxys),
    dyy: sumI(dyys),
  };
}

function spectralUpper(matrix: Matrix): number {
  const mid = matrix.map(midpointI),
    radii = matrix.map((a, i) =>
      nextUp(Math.max(Math.abs(a[0] - mid[i]), Math.abs(a[1] - mid[i]))),
    );
  const m = mid.map(interval),
    s = sumI(m.map(squareI));
  const determinant = subI(mulI(m[0], m[3]), mulI(m[1], m[2]));
  const discriminant = subI(squareI(s), scaleI(squareI(determinant), 4));
  const spectral = sqrtI(
    scaleI(addI(s, sqrtI([Math.max(0, discriminant[0]), Math.max(0, discriminant[1])])), 0.5),
  )[1];
  return nextUp(spectral + sqrtI(sumI(radii.map((v) => squareI(interval(v)))))[1]);
}

/** Conservative forward error for the source's binary64 arithmetic relative to the smooth model.
 * u=2^-53, gamma(n)=nu/(1-nu). Floors can change the selected simplex only within the
 * coordinate-error strip; every excluded corner there has support t bounded by that strip.
 * The fourth power makes the branch discrepancy smaller than the ordinary arithmetic term. */
export function simplexEvaluationResidue(maxInput: number): number {
  const u = 2 ** -53;
  const gamma = (n: number): number => divI(interval(n * u), subI(interval(1), interval(n * u)))[1];
  // |i|,|j| <= 2*(|input|+1); every unskewed source coordinate has at most32 arithmetic steps.
  const lattice = scaleI(addI(interval(maxInput), interval(1)), 2)[1];
  const coordinate = mulI(
    interval(gamma(32)),
    sumI([interval(1), scaleI(interval(maxInput), 2), scaleI(interval(lattice), 8)]),
  )[1];
  // A corner gradient is bounded by128 on its support. There are three selected corners.
  const displacement = scaleI(interval(coordinate), 384)[1];
  // All corner polynomial and final-sum intermediate magnitudes are below256.
  const arithmetic = scaleI(interval(gamma(128)), 256)[1];
  const strip = scaleI(interval(coordinate), 16)[1];
  const branches = scaleI(powI(interval(strip), 4), 16 * 70 * 2)[1];
  return sumI([interval(displacement), interval(arithmetic), interval(branches)])[1];
}

export function certifyWarp(query: ReliefQueryDescription, budget: GraphBudget): WarpCertificate {
  validateCellGraphQuery(query);
  const { amplitude: A, frequency: f, seed } = query.warp;
  if (
    !Number.isFinite(A) ||
    A < 1e-10 ||
    !Number.isFinite(f) ||
    f < 0.02 ||
    !Number.isSafeInteger(seed)
  )
    throw new Error('Invalid producer warp certificate inputs');
  if (absI(subI(interval(Math.sqrt(3)), SQRT3)) > 2 ** -48)
    throw new Error('Runtime Simplex square-root constant exceeds certificate scope');
  const gen = new SimplexNoiseGen(seed),
    kernel = gen.describeKernel();
  if (
    kernel.implementation !== 'meshcraft-simplex2-fisher-yates-mulberry32-v1' ||
    kernel.perm.length !== 512 ||
    kernel.grad2.length !== 12
  )
    throw new Error('Unsupported actual Simplex kernel for graph certification');
  // 3 is an outward bound on 3*70*sqrt(2)*sqrt(.5/9)*(.5-.5/9)^4.
  const D = scaleI(interval(A), 3)[1];
  const expansion = scaleI(interval(D), 2);
  const qmaxX = addI(interval(query.meshX), interval(D))[1],
    qmaxY = addI(interval(query.meshY), interval(D))[1];
  const domain = {
    xmin: -expansion[1],
    xmax: addI(interval(qmaxX), interval(D))[1],
    ymin: -expansion[1],
    ymax: addI(interval(qmaxY), interval(D))[1],
  };
  const domainX = mulI([domain.xmin, domain.xmax], interval(f));
  const domainY = mulI([domain.ymin, domain.ymax], interval(f));
  const [xmin, xmax] = domainX,
    [ymin, ymax] = domainY;
  const maxInput = addI(
    interval(Math.max(Math.abs(xmin), Math.abs(xmax), Math.abs(ymin), Math.abs(ymax))),
    interval(32),
  )[1];
  if (maxInput > 1e5)
    throw new Error('Simplex coordinate magnitude exceeds certificate arithmetic scope');
  const maxWorld = Math.max(domain.xmax, domain.ymax);
  const multiplicationError = scaleI(interval(2 ** -52), maxInput)[1];
  const sourceInputError = scaleI(interval(multiplicationError), 384)[1];
  const noiseError = sumI([
    interval(simplexEvaluationResidue(maxInput)),
    interval(sourceInputError),
  ])[1];
  const outerArithmetic = scaleI(
    sumI([interval(1), interval(maxWorld), scaleI(interval(A), 3)]),
    2 ** -50,
  )[1];
  const evaluationResidue = sumI([scaleI(interval(noiseError), A), interval(outerArithmetic)])[1];
  const derivativeScale = mulI(interval(A), interval(f));
  const hessianScale = mulI(derivativeScale, interval(f));
  const jacobianCache = new Map<string, Matrix>();
  const jacobian = (x: Interval, y: Interval): Matrix => {
    budget.step();
    const cacheKey = `${x[0]},${x[1]},${y[0]},${y[1]}`;
    const cached = jacobianCache.get(cacheKey);
    if (cached) return cached;
    const a = simplexBounds(gen, scaleI(x, f), scaleI(y, f), budget);
    const b = simplexBounds(
      gen,
      addI(scaleI(x, f), interval(OFFSET_X)),
      addI(scaleI(y, f), interval(OFFSET_Y)),
      budget,
    );
    const result: Matrix = [
      mulI(a.dx, derivativeScale),
      mulI(a.dy, derivativeScale),
      mulI(b.dx, derivativeScale),
      mulI(b.dy, derivativeScale),
    ];
    if (jacobianCache.size >= 100_000)
      throw new Error('Warp derivative cache work budget exceeded');
    jacobianCache.set(cacheKey, result);
    return result;
  };
  let lipschitz = 0,
    hessian = 0;
  const stack: { x: Interval; y: Interval; depth: number }[] = [
    { x: [xmin, xmax], y: [ymin, ymax], depth: 0 },
  ];
  while (stack.length) {
    budget.step();
    const box = stack.pop()!;
    if (Math.max(box.x[1] - box.x[0], box.y[1] - box.y[0]) > 0.025) {
      if (box.depth >= 32) throw new Error('Simplex derivative subdivision depth exhausted');
      if (box.x[1] - box.x[0] >= box.y[1] - box.y[0]) {
        const mid = midpointI(box.x);
        stack.push(
          { x: [box.x[0], mid], y: box.y, depth: box.depth + 1 },
          { x: [mid, box.x[1]], y: box.y, depth: box.depth + 1 },
        );
      } else {
        const mid = midpointI(box.y);
        stack.push(
          { x: box.x, y: [box.y[0], mid], depth: box.depth + 1 },
          { x: box.x, y: [mid, box.y[1]], depth: box.depth + 1 },
        );
      }
      continue;
    }
    const a = simplexBounds(gen, box.x, box.y, budget);
    const b = simplexBounds(
      gen,
      addI(box.x, interval(OFFSET_X)),
      addI(box.y, interval(OFFSET_Y)),
      budget,
    );
    const upper = spectralUpper([
      mulI(a.dx, derivativeScale),
      mulI(a.dy, derivativeScale),
      mulI(b.dx, derivativeScale),
      mulI(b.dy, derivativeScale),
    ]);
    if (upper >= 0.98) {
      if (box.depth >= 32 || Math.max(box.x[1] - box.x[0], box.y[1] - box.y[0]) < 0.0005)
        throw new Error('Warp derivative cannot be certified below one');
      if (box.x[1] - box.x[0] >= box.y[1] - box.y[0]) {
        const mid = midpointI(box.x);
        stack.push(
          { x: [box.x[0], mid], y: box.y, depth: box.depth + 1 },
          { x: [mid, box.x[1]], y: box.y, depth: box.depth + 1 },
        );
      } else {
        const mid = midpointI(box.y);
        stack.push(
          { x: box.x, y: [box.y[0], mid], depth: box.depth + 1 },
          { x: box.x, y: [mid, box.y[1]], depth: box.depth + 1 },
        );
      }
      continue;
    }
    lipschitz = Math.max(lipschitz, upper);
    const components = [a.dxx, a.dxy, a.dxy, a.dyy, b.dxx, b.dxy, b.dxy, b.dyy];
    const h = sqrtI(sumI(components.map((v) => squareI(interval(absI(v))))))[1];
    hessian = Math.max(hessian, mulI(interval(h), hessianScale)[1]);
  }
  const inverseLipschitz = divI(interval(1), subI(interval(1), interval(lipschitz)))[1];
  const evaluate = (x: number, y: number): readonly [number, number] => [
    x + gen.noise(x * f, y * f) * A,
    y + gen.noise(x * f + OFFSET_X, y * f + OFFSET_Y) * A,
  ];
  const enclose = (x: Interval, y: Interval): readonly [Interval, Interval] => {
    const a = simplexBounds(gen, scaleI(x, f), scaleI(y, f), budget);
    const b = simplexBounds(
      gen,
      addI(scaleI(x, f), interval(OFFSET_X)),
      addI(scaleI(y, f), interval(OFFSET_Y)),
      budget,
    );
    return [
      inflateI(addI(x, scaleI(a.value, A)), evaluationResidue),
      inflateI(addI(y, scaleI(b.value, A)), evaluationResidue),
    ];
  };
  return {
    domain,
    kernel: kernel.implementation,
    displacement: D,
    lipschitz,
    inverseLipschitz,
    hessian,
    evaluationResidue,
    jacobian,
    evaluate,
    enclose,
  };
}
