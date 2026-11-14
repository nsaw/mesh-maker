/** Test oracle: align every represented input on one integer lattice, then evaluate
 * complete squared distances. This does not call the production relative predicate. */
interface Point {
  readonly x: number;
  readonly y: number;
}
const buffer = new DataView(new ArrayBuffer(8));
function integerPart(value: number): { mantissa: bigint; exponent: number } {
  if (!Number.isFinite(value)) throw new Error('Finite oracle input required');
  if (value === 0) return { mantissa: 0n, exponent: 0 };
  buffer.setFloat64(0, value);
  const bits = buffer.getBigUint64(0),
    rawExponent = Number((bits >> 52n) & 2047n);
  let mantissa = bits & ((1n << 52n) - 1n);
  if (rawExponent !== 0) mantissa |= 1n << 52n;
  if (bits >> 63n) mantissa = -mantissa;
  return { mantissa, exponent: rawExponent === 0 ? -1074 : rawExponent - 1075 };
}
export function rankSitesExactly(
  sites: readonly Point[],
  x: number,
  y: number,
  c = 1,
  s = 0,
  scale = 1,
): number[] {
  const anisotropic = scale > 1.0001;
  const values = [
    x,
    y,
    ...sites.flatMap((point) => [point.x, point.y]),
    ...(anisotropic ? [c, s, scale] : []),
  ].map(integerPart);
  const shift = -Math.min(0, ...values.map((value) => value.exponent));
  const aligned = values.map((value) => value.mantissa << BigInt(value.exponent + shift));
  const scores = sites.map((_, index) => {
    const dx = aligned[0] - aligned[2 + 2 * index],
      dy = aligned[1] - aligned[3 + 2 * index];
    if (!anisotropic) return dx * dx + dy * dy;
    const offset = 2 + 2 * sites.length,
      cos = aligned[offset],
      sin = aligned[offset + 1],
      stretch = aligned[offset + 2];
    const along = (dx * cos + dy * sin) * stretch,
      across = (dy * cos - dx * sin) << BigInt(shift);
    return along * along + across * across;
  });
  return sites
    .map((_, index) => index)
    .sort((a, b) => (scores[a] < scores[b] ? -1 : scores[a] > scores[b] ? 1 : a - b));
}
