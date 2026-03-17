import type { NoiseGenerator, FBMGenerator, NoiseConfig } from '../types';

// ── Base noise generators ────────────────────────────────────────────

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

export class ValueNoiseGen implements NoiseGenerator {
  private p: number[];
  private values: number[];

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
    this.values = new Array(256);
    for (let i = 0; i < 256; i++) {
      const x = Math.sin(seed * 1000 + i * 7.13) * 10000;
      this.values[i] = (x - Math.floor(x)) * 2 - 1;
    }
  }

  private _fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }

  noise(x: number, y: number): number {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const fx = x - Math.floor(x), fy = y - Math.floor(y);
    const u = this._fade(fx), v = this._fade(fy);
    const aa = this.values[(this.p[X] + Y) & 255];
    const ba = this.values[(this.p[X + 1] + Y) & 255];
    const ab = this.values[(this.p[X] + Y + 1) & 255];
    const bb = this.values[(this.p[X + 1] + Y + 1) & 255];
    return (1 - v) * ((1 - u) * aa + u * ba) + v * ((1 - u) * ab + u * bb);
  }
}

export class OpenSimplex2NoiseGen implements NoiseGenerator {
  private perm: number[];
  private grad2: number[][];

  constructor(seed = 0) {
    this.grad2 = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * 2 * Math.PI;
      this.grad2.push([Math.cos(a), Math.sin(a)]);
    }
    const p: number[] = [];
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const x = Math.sin(seed + i) * 10000;
      const j = Math.min(Math.floor((x - Math.floor(x)) * (i + 1)), i);
      [p[i], p[j]] = [p[j], p[i]];
    }
    this.perm = [];
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  noise(x: number, y: number): number {
    const F2 = 0.3660254037844386, G2 = 0.21132486540518713;
    const s = (x + y) * F2;
    const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const gi0 = this.perm[ii + this.perm[jj]] % 24;
    const gi1 = this.perm[ii + i1 + this.perm[jj + j1]] % 24;
    const gi2 = this.perm[ii + 1 + this.perm[jj + 1]] % 24;
    let value = 0;
    let a0 = 2.0 / 3.0 - x0 * x0 - y0 * y0;
    if (a0 > 0) { a0 *= a0; value += a0 * a0 * (this.grad2[gi0][0] * x0 + this.grad2[gi0][1] * y0); }
    let a1 = 2.0 / 3.0 - x1 * x1 - y1 * y1;
    if (a1 > 0) { a1 *= a1; value += a1 * a1 * (this.grad2[gi1][0] * x1 + this.grad2[gi1][1] * y1); }
    let a2 = 2.0 / 3.0 - x2 * x2 - y2 * y2;
    if (a2 > 0) { a2 *= a2; value += a2 * a2 * (this.grad2[gi2][0] * x2 + this.grad2[gi2][1] * y2); }
    return value * 18;
  }
}

// ── Fractal noise generators ─────────────────────────────────────────

export class RidgedNoiseGen implements NoiseGenerator {
  private base: SimplexNoiseGen;
  constructor(seed: number) { this.base = new SimplexNoiseGen(seed); }
  noise(x: number, y: number): number { return (1 - Math.abs(this.base.noise(x, y))) * 2 - 1; }
}

export class BillowNoiseGen implements NoiseGenerator {
  private base: SimplexNoiseGen;
  constructor(seed: number) { this.base = new SimplexNoiseGen(seed); }
  noise(x: number, y: number): number { return Math.abs(this.base.noise(x, y)) * 2 - 1; }
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

export class TurbulenceNoiseGen implements FBMGenerator {
  private base: SimplexNoiseGen;
  constructor(seed: number) { this.base = new SimplexNoiseGen(seed); }
  noise(x: number, y: number): number { return this.base.noise(x, y); }
  fbm(x: number, y: number, octaves: number, persistence: number, lacunarity: number): number {
    let val = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      val += Math.abs(this.base.noise(x * freq, y * freq)) * amp;
      max += amp; amp *= persistence; freq *= lacunarity;
    }
    return (val / max) * 2 - 1;
  }
}

// ── Multi-fractal generators ─────────────────────────────────────────

export class HybridMultifractalGen implements FBMGenerator {
  private base: SimplexNoiseGen;
  constructor(seed: number) { this.base = new SimplexNoiseGen(seed); }
  noise(x: number, y: number): number { return this.base.noise(x, y); }
  fbm(x: number, y: number, octaves: number, persistence: number, lacunarity: number): number {
    let result = (this.base.noise(x, y) + 1) * 0.5;
    let weight = result;
    let amp = persistence, freq = lacunarity;
    for (let i = 1; i < octaves; i++) {
      weight = Math.min(weight, 1);
      const signal = (this.base.noise(x * freq, y * freq) + 1) * 0.5;
      result += signal * amp * weight;
      weight *= signal;
      amp *= persistence; freq *= lacunarity;
    }
    return result * 2 - 1;
  }
}

export class HeteroTerrainGen implements FBMGenerator {
  private base: SimplexNoiseGen;
  constructor(seed: number) { this.base = new SimplexNoiseGen(seed); }
  noise(x: number, y: number): number { return this.base.noise(x, y); }
  fbm(x: number, y: number, octaves: number, persistence: number, lacunarity: number): number {
    let result = this.base.noise(x, y);
    let weight = Math.max(0, Math.min(1, (result + 1) * 0.5));
    let amp = persistence, freq = lacunarity;
    for (let i = 1; i < octaves; i++) {
      const signal = this.base.noise(x * freq, y * freq) * amp;
      result += signal * weight;
      weight = Math.max(0, Math.min(1, (result + 1) * 0.5));
      freq *= lacunarity; amp *= persistence;
    }
    return result;
  }
}

export class DomainWarpNoiseGen implements FBMGenerator {
  private base: SimplexNoiseGen;
  private warp: SimplexNoiseGen;
  constructor(seed: number) {
    this.base = new SimplexNoiseGen(seed);
    this.warp = new SimplexNoiseGen(seed + 31);
  }
  noise(x: number, y: number): number {
    const qx = this.warp.noise(x, y);
    const qy = this.warp.noise(x + 5.2, y + 1.3);
    return this.base.noise(x + 4 * qx, y + 4 * qy);
  }
  fbm(x: number, y: number, octaves: number, persistence: number, lacunarity: number): number {
    const qx = this.warp.noise(x, y);
    const qy = this.warp.noise(x + 5.2, y + 1.3);
    const rx = this.warp.noise(x + 4 * qx + 1.7, y + 4 * qy + 9.2);
    const ry = this.warp.noise(x + 4 * qx + 8.3, y + 4 * qy + 2.8);
    const wx = x + 4 * rx, wy = y + 4 * ry;
    let val = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      val += this.base.noise(wx * freq, wy * freq) * amp;
      max += amp; amp *= persistence; freq *= lacunarity;
    }
    return val / max;
  }
}

// ── Cellular noise generators ────────────────────────────────────────

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
    return 1 - min * 2;
  }
}

export class WorleyNoiseGen implements NoiseGenerator {
  private seed: number;
  constructor(seed: number) { this.seed = seed; }
  private _sr(s: number): number { const x = Math.sin(s) * 10000; return x - Math.floor(x); }
  private _hash(x: number, y: number): number { return Math.floor(this._sr(x * 374761393 + y * 668265263 + this.seed) * 1000); }
  noise(x: number, y: number): number {
    const cx = Math.floor(x), cy = Math.floor(y);
    let f1 = Infinity, f2 = Infinity;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const nx = cx + i, ny = cy + j, h = this._hash(nx, ny);
      const px = nx + this._sr(h), py = ny + this._sr(h + 1);
      const d = Math.hypot(x - px, y - py);
      if (d < f1) { f2 = f1; f1 = d; }
      else if (d < f2) { f2 = d; }
    }
    return Math.min((f2 - f1) * 1.5, 1.0) * 2 - 1;
  }
}

// ── Advanced noise generators ────────────────────────────────────────

export class GaborNoiseGen implements NoiseGenerator {
  private seed: number;
  private cosA: number;
  private sinA: number;
  private bw2: number;

  constructor(seed: number, config?: NoiseConfig) {
    this.seed = seed;
    const angle = ((config?.gaborAngle ?? 45) * Math.PI) / 180;
    this.cosA = Math.cos(angle);
    this.sinA = Math.sin(angle);
    const bw = config?.gaborBandwidth ?? 1.5;
    this.bw2 = bw * bw;
  }

  private _sr(s: number): number { const x = Math.sin(s) * 10000; return x - Math.floor(x); }
  private _hash(x: number, y: number): number { return Math.floor(this._sr(x * 374761393 + y * 668265263 + this.seed) * 10000); }

  noise(x: number, y: number): number {
    const cx = Math.floor(x), cy = Math.floor(y);
    let value = 0;
    const piBw2 = Math.PI * this.bw2;
    const twoPi = 2 * Math.PI;

    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const nx = cx + di, ny = cy + dj;
        const h = this._hash(nx, ny);
        const numKernels = 3 + (h % 4);

        for (let k = 0; k < numKernels; k++) {
          const kSeed = h + k * 7;
          const kx = nx + this._sr(kSeed);
          const ky = ny + this._sr(kSeed + 1);
          const phase = this._sr(kSeed + 2) * twoPi;

          const dx = x - kx, dy = y - ky;
          const r2 = dx * dx + dy * dy;
          if (r2 > 4) continue;

          const proj = dx * this.cosA + dy * this.sinA;
          const envelope = Math.exp(-piBw2 * r2);
          value += envelope * Math.cos(twoPi * proj + phase);
        }
      }
    }

    return Math.max(-1, Math.min(1, value * 0.5));
  }
}

export class WaveletNoiseGen implements NoiseGenerator {
  private tile: Float32Array;
  private readonly SIZE = 128;

  constructor(seed: number) {
    const n = this.SIZE;
    this.tile = new Float32Array(n * n);
    const simplex = new SimplexNoiseGen(seed);
    const scale = 4.0 / n;
    const seedOff = seed * 100;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let val = 0, amp = 0.5, freq = scale, total = 0;
        for (let o = 0; o < 4; o++) {
          val += simplex.noise(i * freq + seedOff, j * freq + seedOff + 500) * amp;
          total += amp; amp *= 0.5; freq *= 2;
        }
        this.tile[j * n + i] = val / total;
      }
    }
  }

  noise(x: number, y: number): number {
    const n = this.SIZE;
    const tx = ((x % n) + n) % n;
    const ty = ((y % n) + n) % n;
    const ix = Math.floor(tx) & (n - 1);
    const iy = Math.floor(ty) & (n - 1);
    const fx = tx - Math.floor(tx);
    const fy = ty - Math.floor(ty);
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const i00 = this.tile[iy * n + ix];
    const i10 = this.tile[iy * n + ((ix + 1) & (n - 1))];
    const i01 = this.tile[((iy + 1) & (n - 1)) * n + ix];
    const i11 = this.tile[((iy + 1) & (n - 1)) * n + ((ix + 1) & (n - 1))];
    return (1 - v) * ((1 - u) * i00 + u * i10) + v * ((1 - u) * i01 + u * i11);
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export function createNoiseGen(type: string, seed: number, config?: NoiseConfig): NoiseGenerator {
  switch (type) {
    case 'perlin': return new PerlinNoiseGen(seed);
    case 'value': return new ValueNoiseGen(seed);
    case 'opensimplex2': return new OpenSimplex2NoiseGen(seed);
    case 'ridged': return new RidgedNoiseGen(seed);
    case 'billow': return new BillowNoiseGen(seed);
    case 'fbm': return new FBMNoiseGen(seed);
    case 'turbulence': return new TurbulenceNoiseGen(seed);
    case 'hybrid': return new HybridMultifractalGen(seed);
    case 'hetero': return new HeteroTerrainGen(seed);
    case 'domainwarp': return new DomainWarpNoiseGen(seed);
    case 'voronoi': return new VoronoiNoiseGen(seed);
    case 'worley': return new WorleyNoiseGen(seed);
    case 'gabor': return new GaborNoiseGen(seed, config);
    case 'wavelet': return new WaveletNoiseGen(seed);
    default: return new SimplexNoiseGen(seed);
  }
}
