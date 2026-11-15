/** Binary64 interval arithmetic. Each primitive expands by one representable value.
 * Infinities are allowed in intermediate intervals and cause bounded proof refusal. */
export type Interval = readonly [number, number];
// Adjacent binary64 values by stepping the bit pattern, through two 32-bit words rather
// than a BigInt, which allocated on every primitive. Same increments as a 64-bit step.
const float = new Float64Array(1),
  words = new Uint32Array(float.buffer);
const LOW = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 0 : 1,
  HIGH = 1 - LOW;
export function nextUp(value: number): number {
  if (Number.isNaN(value) || value === Infinity) return value;
  if (value === 0) return Number.MIN_VALUE;
  float[0] = value;
  if (value > 0) {
    if (words[LOW] === 0xffffffff) { words[LOW] = 0; words[HIGH] += 1; } else words[LOW] += 1;
  } else if (words[LOW] === 0) { words[LOW] = 0xffffffff; words[HIGH] -= 1; } else words[LOW] -= 1;
  return float[0];
}
export const nextDown = (value: number): number => -nextUp(-value);
export const interval = (value: number): Interval => [value, value];
export const addI = (a: Interval, b: Interval): Interval => [
  nextDown(a[0] + b[0]),
  nextUp(a[1] + b[1]),
];
export const negI = (a: Interval): Interval => [-a[1], -a[0]];
export const subI = (a: Interval, b: Interval): Interval => addI(a, negI(b));
export function mulI(a: Interval, b: Interval): Interval {
  const p = a[0] * b[0], q = a[0] * b[1], r = a[1] * b[0], t = a[1] * b[1];
  return [nextDown(Math.min(p, q, r, t)), nextUp(Math.max(p, q, r, t))];
}
export const scaleI = (a: Interval, value: number): Interval => mulI(a, interval(value));
export function squareI(a: Interval): Interval {
  const lower = a[0] <= 0 && a[1] >= 0 ? 0 : Math.min(a[0] * a[0], a[1] * a[1]);
  return [lower === 0 ? 0 : nextDown(lower), nextUp(Math.max(a[0] * a[0], a[1] * a[1]))];
}
export function powI(a: Interval, exponent: number): Interval {
  let result: Interval = [1, 1];
  for (let i = 0; i < exponent; i++) result = mulI(result, a);
  return result;
}
export function divI(a: Interval, b: Interval): Interval {
  if (b[0] <= 0 && b[1] >= 0) throw new Error('Interval division crosses zero');
  return mulI(a, [nextDown(1 / b[1]), nextUp(1 / b[0])]);
}
export function sqrtI(a: Interval): Interval {
  if (a[0] < 0) throw new Error('Interval square root crosses zero');
  if (a[1] === 0) return [0, 0];
  let lower = a[0] === 0 ? 0 : nextDown(Math.sqrt(a[0])),
    upper = nextUp(Math.sqrt(a[1]));
  // Verify the result using outward squared products, rather than assuming a libm error bound.
  for (let i = 0; i < 16; i++) {
    const lowValid = lower === 0 || nextUp(lower * lower) <= a[0];
    const highValid = nextDown(upper * upper) >= a[1];
    if (lowValid && highValid) return [lower, upper];
    if (!lowValid) lower = nextDown(lower);
    if (!highValid) upper = nextUp(upper);
  }
  throw new Error('Interval square root could not be enclosed');
}
export const absI = (a: Interval): number => Math.max(Math.abs(a[0]), Math.abs(a[1]));
export const sumI = (values: readonly Interval[]): Interval => values.reduce(addI, interval(0));
export const inflateI = (a: Interval, error: number): Interval => addI(a, [-error, error]);
export const midpointI = (a: Interval): number => a[0] + (a[1] - a[0]) / 2;
export const hullI = (a: Interval, b: Interval): Interval => [
  Math.min(a[0], b[0]),
  Math.max(a[1], b[1]),
];

/** Use only when the expression is known algebraically to be nonnegative. */
export const sqrtNonnegativeI = (a: Interval): Interval =>
  sqrtI([Math.max(0, a[0]), Math.max(0, a[1])]);
