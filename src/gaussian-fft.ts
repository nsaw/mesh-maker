/** In-place radix-2 transform. Twiddle tables are shared across every lane in a pass. */
function transform(real: Float64Array, imag: Float64Array, inverse: boolean,
  cosine: Float64Array, sine: Float64Array): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n / 2;
    while (j & bit) { j ^= bit; bit /= 2; }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let length = 2; length <= n; length *= 2) {
    const half = length / 2, stride = n / length;
    for (let start = 0; start < n; start += length) for (let j = 0; j < half; j++) {
      const k = j * stride, c = cosine[k], s = inverse ? sine[k] : -sine[k];
      const a = start + j, b = a + half;
      const re = real[b] * c - imag[b] * s, im = real[b] * s + imag[b] * c;
      real[b] = real[a] - re; imag[b] = imag[a] - im;
      real[a] += re; imag[a] += im;
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { real[i] /= n; imag[i] /= n; }
}

/** Exact finite Gaussian kernel, evaluated by FFT for wide support. Two real lanes
 * occupy the real/imaginary parts of one transform. A real symmetric kernel has a
 * real spectrum, so multiplying by that spectrum filters each lane independently. */
export function gaussianFftPass(source: number[][], weights: readonly number[], horizontal: boolean): number[][] {
  const rows = source.length, cols = source[0].length;
  const axis = horizontal ? cols : rows, lanes = horizontal ? rows : cols;
  const radius = weights.length - 1;
  // At least axis+radius samples prevents circular wraparound in every retained output.
  let n = 1;
  while (n < axis + radius) n *= 2;
  const real = new Float64Array(n), imag = new Float64Array(n);
  const cosine = new Float64Array(n / 2), sine = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    cosine[k] = Math.cos(2 * Math.PI * k / n); sine[k] = Math.sin(2 * Math.PI * k / n);
  }
  real[0] = weights[0];
  for (let k = 1; k <= radius; k++) { real[k] = weights[k]; real[n - k] = weights[k]; }
  transform(real, imag, false, cosine, sine);
  const spectrum = real.slice(), prefix = new Float64Array(weights.length), norm = new Float64Array(axis);
  for (let k = 1; k <= radius; k++) prefix[k] = prefix[k - 1] + weights[k];
  for (let i = 0; i < axis; i++) {
    norm[i] = weights[0] + prefix[Math.min(i, radius)] + prefix[Math.min(axis - 1 - i, radius)]
      - (i <= radius ? weights[i] * 0.5 : 0) - (axis - 1 - i <= radius ? weights[axis - 1 - i] * 0.5 : 0);
  }
  const out = Array.from({length: rows}, () => new Array<number>(cols));
  for (let lane = 0; lane < lanes; lane += 2) {
    real.fill(0); imag.fill(0);
    for (let i = 0; i < axis; i++) {
      const edge = i === 0 || i === axis - 1 ? 0.5 : 1;
      real[i] = (horizontal ? source[lane][i] : source[i][lane]) * edge;
      if (lane + 1 < lanes) imag[i] = (horizontal ? source[lane + 1][i] : source[i][lane + 1]) * edge;
    }
    transform(real, imag, false, cosine, sine);
    for (let i = 0; i < n; i++) { real[i] *= spectrum[i]; imag[i] *= spectrum[i]; }
    transform(real, imag, true, cosine, sine);
    for (let i = 0; i < axis; i++) {
      if (horizontal) {
        out[lane][i] = real[i] / norm[i];
        if (lane + 1 < lanes) out[lane + 1][i] = imag[i] / norm[i];
      } else {
        out[i][lane] = real[i] / norm[i];
        if (lane + 1 < lanes) out[i][lane + 1] = imag[i] / norm[i];
      }
    }
  }
  return out;
}
