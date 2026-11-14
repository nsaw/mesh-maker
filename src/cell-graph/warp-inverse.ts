import type { WarpCertificate } from './warp-bounds';
import type { GraphBudget } from './exact-diagram';
import {
  absI,
  divI,
  inflateI,
  interval,
  nextUp,
  sqrtNonnegativeI,
  squareI,
  subI,
  sumI,
} from './interval';
import type { Interval } from './interval';

export interface InversePoint {
  readonly x: number;
  readonly y: number;
  readonly error: number;
}
/** A posteriori residual includes model evaluation and complete source arithmetic residue.
 * A floating fixed point alone is not a stopping condition. */
export function invertWarp(
  certificate: WarpCertificate,
  qx: number,
  qy: number,
  budget: GraphBudget,
  target = 1e-7,
): InversePoint {
  let x = qx,
    y = qy;
  const K = certificate.inverseLipschitz;
  for (let iteration = 0; iteration < 256; iteration++) {
    budget.step();
    const domain = certificate.domain;
    if (x < domain.xmin || x > domain.xmax || y < domain.ymin || y > domain.ymax)
      throw new Error('Warp inverse left its contraction proof rectangle');
    const [wx, wy] = certificate.evaluate(x, y);
    const residual = nextUp(Math.hypot(wx - qx, wy - qy));
    const coarse = nextUp(
      K * nextUp(residual + nextUp(Math.SQRT2 * certificate.evaluationResidue)),
    );
    if (coarse < target * 0.5) {
      const enclosure = certificate.enclose(interval(x), interval(y));
      const errors = [subI(enclosure[0], interval(qx)), subI(enclosure[1], interval(qy))];
      const norm = sqrtNonnegativeI(sumI(errors.map((v) => squareI(interval(absI(v))))))[1];
      const error = divI(interval(norm), subI(interval(1), interval(certificate.lipschitz)))[1];
      if (error < target) return { x, y, error };
    }
    x = qx - (wx - x);
    y = qy - (wy - y);
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error('Warp inverse left its finite arithmetic domain');
  }
  throw new Error('Warp inverse residual did not meet its error budget');
}
export const inverseBox = (p: InversePoint): readonly [Interval, Interval] => [
  inflateI(interval(p.x), p.error),
  inflateI(interval(p.y), p.error),
];
