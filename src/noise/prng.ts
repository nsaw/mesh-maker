/** Deterministic per-seed PRNG (mulberry32) — better distribution than sin-hash for site jitter. */
export function mulberry32(seed: number): () => number {
  let t = (seed | 0) >>> 0;
  return (): number => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic per-cell hash in [0, 1) from the owning site index — drives which cells
 *  get pillowed floors and how strongly, stable across renders for the same seed. */
export function cellHash01(idx: number, seed: number): number {
  let h = (Math.imul(idx + 1, 374761393) + Math.imul(seed | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

