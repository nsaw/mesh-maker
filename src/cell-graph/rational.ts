/** Reduced exact rationals. Input numbers are decoded as their IEEE-754 values. */
export interface Rational { readonly n: bigint; readonly d: bigint }
const MAX_BITS = 16384;
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  while (b !== 0n) { const next = a % b; a = b; b = next; }
  return a;
}
export function rational(n: bigint, d = 1n): Rational {
  if (d === 0n) throw new Error('Exact graph division by zero');
  if (d < 0n) { n = -n; d = -d; }
  const divisor = gcd(n, d);
  n /= divisor; d /= divisor;
  if (n.toString(2).length > MAX_BITS || d.toString(2).length > MAX_BITS) throw new Error('Exact graph rational bit budget exceeded');
  return {n, d};
}
export const ZERO = rational(0n);
export const ONE = rational(1n);
export function exact(value: number): Rational {
  if (!Number.isFinite(value)) throw new Error('Nonfinite exact graph input');
  if (value === 0) return ZERO;
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, value);
  const high = bits.getUint32(0), low = bits.getUint32(4);
  const exponent = (high >>> 20) & 2047;
  let mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
  if (exponent !== 0) mantissa |= 1n << 52n;
  if (high >>> 31) mantissa = -mantissa;
  const shift = exponent === 0 ? -1074 : exponent - 1023 - 52;
  return shift < 0 ? rational(mantissa, 1n << BigInt(-shift)) : rational(mantissa << BigInt(shift));
}
export const add = (a: Rational, b: Rational): Rational => rational(a.n * b.d + b.n * a.d, a.d * b.d);
export const neg = (a: Rational): Rational => ({n: -a.n, d: a.d});
export const sub = (a: Rational, b: Rational): Rational => add(a, neg(b));
export const mul = (a: Rational, b: Rational): Rational => rational(a.n * b.n, a.d * b.d);
export const div = (a: Rational, b: Rational): Rational => rational(a.n * b.d, a.d * b.n);
export const square = (a: Rational): Rational => mul(a, a);
export const compare = (a: Rational, b: Rational): number => {
  const difference = a.n * b.d - b.n * a.d;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
};
export const key = (a: Rational): string => `${a.n}/${a.d}`;
export function number(a: Rational): number {
  const sign = a.n < 0n ? -1 : 1, positive = a.n < 0n ? -a.n : a.n;
  const ns = Math.max(0, positive.toString(2).length - 53), ds = Math.max(0, a.d.toString(2).length - 53);
  const result = sign * Number(positive >> BigInt(ns)) / Number(a.d >> BigInt(ds)) * 2 ** (ns - ds);
  if (!Number.isFinite(result)) throw new Error('Exact graph coordinate cannot be represented');
  return result;
}
export type ExactPoint = readonly [Rational, Rational];
export const point = (x: number, y: number): ExactPoint => [exact(x), exact(y)];
export const pointKey = (p: ExactPoint): string => `${key(p[0])},${key(p[1])}`;
export const samePoint = (a: ExactPoint, b: ExactPoint): boolean => compare(a[0], b[0]) === 0 && compare(a[1], b[1]) === 0;
export const delta = (a: ExactPoint, b: ExactPoint): ExactPoint => [sub(a[0], b[0]), sub(a[1], b[1])];
export const cross = (a: ExactPoint, b: ExactPoint): Rational => sub(mul(a[0], b[1]), mul(a[1], b[0]));
export const dot = (a: ExactPoint, b: ExactPoint): Rational => add(mul(a[0], b[0]), mul(a[1], b[1]));
export const orient = (a: ExactPoint, b: ExactPoint, c: ExactPoint): Rational => cross(delta(b, a), delta(c, a));
