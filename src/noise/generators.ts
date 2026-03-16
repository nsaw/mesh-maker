import type { NoiseGenerator, FBMGenerator } from '../types';

export class SimplexNoiseGen implements NoiseGenerator {
  private grad3: number[][];
  private perm: number[];

  constructor(seed = 0) {
    this.grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
    const p: number[] = [];
    for (let i = 0; i < 256; i++) p[i] = Math.floor(this._sr(seed + i) * 256);
    this.perm = [];
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  private _sr(s: number): number { const x = Math.sin(s) * 10000; return x - Math.floor(x); }
  private _dot(g: number[], x: number, y: number): number { return g[0] * x + g[1] * y; }

  noise(xin: number, yin: number): number {
    const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
    const s = (xin + yin) * F2, i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2, x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const gi0 = this.perm[ii + this.perm[jj]] % 12;
    const gi1 = this.perm[ii + i1 + this.perm[jj + j1]] % 12;
    const gi2 = this.perm[ii + 1 + this.perm[jj + 1]] % 12;
    let t0 = 0.5 - x0*x0 - y0*y0, n0 = 0;
    if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * this._dot(this.grad3[gi0], x0, y0); }
    let t1 = 0.5 - x1*x1 - y1*y1, n1 = 0;
    if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * this._dot(this.grad3[gi1], x1, y1); }
    let t2 = 0.5 - x2*x2 - y2*y2, n2 = 0;
    if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * this._dot(this.grad3[gi2], x2, y2); }
    return 70 * (n0 + n1 + n2);
  }
}

export class PerlinNoiseGen implements NoiseGenerator {
  private p: number[];

  constructor(seed = 0) {
    const perm: number[] = [];
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const x = Math.sin(seed + i) * 10000;
      const j = Math.min(Math.floor((x - Math.floor(x)) * (i + 1)), i);
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    this.p = new Array(512);
    for (let i = 0; i < 512; i++) this.p[i] = perm[i % 256];
  }

  private _fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }
  private _lerp(t: number, a: number, b: number): number { return a + t * (b - a); }
  private _grad(hash: number, x: number, y: number): number {
    const h = hash & 15, u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : 0);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  noise(x: number, y: number): number {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = this._fade(x), v = this._fade(y);
    const A = this.p[X] + Y, AA = this.p[A], AB = this.p[A + 1], B = this.p[X + 1] + Y, BA = this.p[B], BB = this.p[B + 1];
    return this._lerp(v, this._lerp(u, this._grad(this.p[AA], x, y), this._grad(this.p[BA], x - 1, y)),
      this._lerp(u, this._grad(this.p[AB], x, y - 1), this._grad(this.p[BB], x - 1, y - 1)));
  }
}

export class RidgedNoiseGen implements NoiseGenerator {
  private base: SimplexNoiseGen;
  constructor(seed: number) { this.base = new SimplexNoiseGen(seed); }
  noise(x: number, y: number): number { return 1 - Math.abs(this.base.noise(x, y)); }
}

export class FBMNoiseGen implements FBMGenerator {
  private base: SimplexNoiseGen;
  constructor(seed: number) { this.base = new SimplexNoiseGen(seed); }
  noise(x: number, y: number): number { return this.base.noise(x, y); }
  fbm(x: number, y: number, octaves: number, persistence: number, lacunarity: number): number {
    let val = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      val += this.noise(x * freq, y * freq) * amp;
      max += amp; amp *= persistence; freq *= lacunarity;
    }
    return val / max;
  }
}

export class VoronoiNoiseGen implements NoiseGenerator {
  private seed: number;
  constructor(seed: number) { this.seed = seed; }
  private _sr(s: number): number { const x = Math.sin(s) * 10000; return x - Math.floor(x); }
  private _hash(x: number, y: number): number { return Math.floor(this._sr(x * 374761393 + y * 668265263 + this.seed) * 1000); }
  noise(x: number, y: number): number {
    const cx = Math.floor(x), cy = Math.floor(y);
    let min = Infinity;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const nx = cx + i, ny = cy + j, h = this._hash(nx, ny);
      const px = nx + this._sr(h), py = ny + this._sr(h + 1);
      const d = Math.hypot(x - px, y - py);
      if (d < min) min = d;
    }
    return min;
  }
}

export function createNoiseGen(type: string, seed: number): NoiseGenerator {
  switch (type) {
    case 'perlin': return new PerlinNoiseGen(seed);
    case 'ridged': return new RidgedNoiseGen(seed);
    case 'fbm': return new FBMNoiseGen(seed);
    case 'voronoi': return new VoronoiNoiseGen(seed);
    default: return new SimplexNoiseGen(seed);
  }
}
