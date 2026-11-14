/** Near ties are ordered in the metric of the represented binary64 inputs.
 * The common path compares floats; only error-overlapping distances use dyadics. */
interface Point {
  readonly x: number;
  readonly y: number;
}
type Dyadic = readonly [bigint, number];
const bits = new DataView(new ArrayBuffer(8));
function dyadic(value: number): Dyadic {
  if (!Number.isFinite(value))
    throw new RangeError('Metric comparison requires finite coordinates');
  if (value === 0) return [0n, 0];
  bits.setFloat64(0, value);
  const high = bits.getUint32(0),
    low = bits.getUint32(4),
    exponent = (high >>> 20) & 2047;
  let mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
  if (exponent !== 0) mantissa |= 1n << 52n;
  if (high >>> 31) mantissa = -mantissa;
  return [mantissa, exponent === 0 ? -1074 : exponent - 1075];
}
function add(a: Dyadic, b: Dyadic): Dyadic {
  const exponent = Math.min(a[1], b[1]);
  return [(a[0] << BigInt(a[1] - exponent)) + (b[0] << BigInt(b[1] - exponent)), exponent];
}
const negative = (a: Dyadic): Dyadic => [-a[0], a[1]];
const subtract = (a: Dyadic, b: Dyadic): Dyadic => add(a, negative(b));
const multiply = (a: Dyadic, b: Dyadic): Dyadic => [a[0] * b[0], a[1] + b[1]];

/** |q-a|_M^2-|q-b|_M^2 = T(b-a) dot T(2q-a-b).
 * Subtractions and the effective transform are exact, including the isotropic gate. */
export function exactMetricOrder(
  a: Point,
  b: Point,
  x: number,
  y: number,
  c: number,
  s: number,
  scale: number,
): number {
  if (a.x === b.x && a.y === b.y) return 0;
  const ax = dyadic(a.x),
    ay = dyadic(a.y),
    ux = subtract(dyadic(b.x), ax),
    uy = subtract(dyadic(b.y), ay);
  const vx = subtract(multiply([2n, 0], subtract(dyadic(x), ax)), ux);
  const vy = subtract(multiply([2n, 0], subtract(dyadic(y), ay)), uy);
  let u: [Dyadic, Dyadic] = [ux, uy],
    v: [Dyadic, Dyadic] = [vx, vy];
  if (scale > 1.0001) {
    const dc = dyadic(c),
      ds = dyadic(s),
      dk = dyadic(scale);
    const transform = (px: Dyadic, py: Dyadic): [Dyadic, Dyadic] => [
      multiply(add(multiply(px, dc), multiply(py, ds)), dk),
      subtract(multiply(py, dc), multiply(px, ds)),
    ];
    u = transform(ux, uy);
    v = transform(vx, vy);
  }
  const sign = add(multiply(u[0], v[0]), multiply(u[1], v[1]))[0];
  return sign < 0n ? -1 : sign > 0n ? 1 : 0;
}

/** Absolute query-wide guard. C bounds query/site coordinates; the transform's L1
 * factor bounds subtraction/rotation/scale errors. The constants exceed the
 * operation count, include radial/squared evaluation and retain an absolute floor.
 * Overflow of this guard makes every comparison exact rather than selecting a side. */
export function metricOrderError(
  coordinateScale: number,
  x: number,
  y: number,
  c = 1,
  s = 0,
  scale = 1,
  squared = false,
  distanceMagnitude = 1,
): number {
  const factor =
    scale <= 1.0001 ? 1 : Math.max(1, Math.abs(c) + Math.abs(s)) * Math.max(1, Math.abs(scale));
  const magnitude = Math.max(1, coordinateScale, Math.abs(x), Math.abs(y)) * factor;
  const error = 256 * Number.EPSILON * magnitude;
  return squared ? error * (2 * Math.max(1, distanceMagnitude) + error) : error;
}
export function metricOrdering(
  sites: readonly Point[],
  x: number,
  y: number,
  coordinateScale: number,
  c = 1,
  s = 0,
  scale = 1,
  squared = false,
): (index: number, current: number, distance: number, currentDistance: number) => boolean {
  const error = metricOrderError(coordinateScale, x, y, c, s, scale);
  return (index, current, distance, currentDistance) => {
    if (current < 0 || currentDistance === Infinity) return true;
    const difference = distance - currentDistance;
    const guard = squared ? error * (2 * Math.max(1, distance, currentDistance) + error) : error;
    if (difference < -guard) return true;
    if (difference > guard) return false;
    const order = exactMetricOrder(sites[index], sites[current], x, y, c, s, scale);
    return order < 0 || (order === 0 && index < current);
  };
}
