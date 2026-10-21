/**
 * Catmull-Clark subdivision of a regular quad grid (rows x cols nodes, row-major xyz), with smooth
 * boundaries and fixed corners: the display smoothing the Blender proof applies to the cloth before its
 * relief is extracted (Subdivision Surface, Catmull-Clark, 2 levels, default boundary). One level maps
 * (r x c) to (2r - 1) x (2c - 1). Pure: no DOM.
 */

export interface Grid { rows: number; cols: number; pos: Float64Array }

export function subdivideGrid(g: Grid): Grid {
  const { rows: r, cols: c, pos: p } = g, R = 2 * r - 1, C = 2 * c - 1, out = new Float64Array(R * C * 3);
  const P = (j: number, i: number, k: number): number => p[(j * c + i) * 3 + k];
  const face = (j: number, i: number, k: number): number => (P(j, i, k) + P(j, i + 1, k) + P(j + 1, i, k) + P(j + 1, i + 1, k)) / 4;
  const set = (J: number, I: number, k: number, v: number): void => { out[(J * C + I) * 3 + k] = v; };
  for (let k = 0; k < 3; k++) {
    for (let j = 0; j < r - 1; j++) for (let i = 0; i < c - 1; i++) set(2 * j + 1, 2 * i + 1, k, face(j, i, k));
    // Horizontal edges (j, i)-(j, i+1).
    for (let j = 0; j < r; j++) for (let i = 0; i < c - 1; i++) {
      const m = (P(j, i, k) + P(j, i + 1, k)) / 2;
      set(2 * j, 2 * i + 1, k, j === 0 || j === r - 1 ? m : (P(j, i, k) + P(j, i + 1, k) + face(j - 1, i, k) + face(j, i, k)) / 4);
    }
    // Vertical edges (j, i)-(j+1, i).
    for (let j = 0; j < r - 1; j++) for (let i = 0; i < c; i++) {
      const m = (P(j, i, k) + P(j + 1, i, k)) / 2;
      set(2 * j + 1, 2 * i, k, i === 0 || i === c - 1 ? m : (P(j, i, k) + P(j + 1, i, k) + face(j, i - 1, k) + face(j, i, k)) / 4);
    }
    for (let j = 0; j < r; j++) for (let i = 0; i < c; i++) {
      const v = P(j, i, k), bj = j === 0 || j === r - 1, bi = i === 0 || i === c - 1;
      let nv: number;
      if (bj && bi) nv = v;                                               // corner kept
      else if (bj) nv = (P(j, i - 1, k) + 6 * v + P(j, i + 1, k)) / 8;    // boundary rule along the row
      else if (bi) nv = (P(j - 1, i, k) + 6 * v + P(j + 1, i, k)) / 8;
      else {
        const Q = (face(j - 1, i - 1, k) + face(j - 1, i, k) + face(j, i - 1, k) + face(j, i, k)) / 4;
        const Rm = (P(j - 1, i, k) + P(j + 1, i, k) + P(j, i - 1, k) + P(j, i + 1, k) + 4 * v) / 8;
        nv = (Q + 2 * Rm + v) / 4;
      }
      set(2 * j, 2 * i, k, nv);
    }
  }
  return { rows: R, cols: C, pos: out };
}

/** Two triangles per grid cell. */
export function gridTriangles(rows: number, cols: number): Uint32Array {
  const t = new Uint32Array((rows - 1) * (cols - 1) * 6); let n = 0;
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = j * cols + i, b = a + 1, d = a + cols, e = d + 1;
    t[n++] = a; t[n++] = b; t[n++] = e; t[n++] = a; t[n++] = e; t[n++] = d;
  }
  return t;
}
