/**
 * Frontmost depth of triangle meshes seen along +Y (the camera on the -Y side), sampled at the nodes of
 * a regular grid. Equivalent to the Blender proof's ray cast (scripts/drape/blender_drape.py): node
 * (i, j) sits at x = x0 + i * (x1 - x0) / (cols - 1), z = zTop - j * (zTop - zBottom) / (rows - 1)
 * (row 0 at the top), and its value is -y of the first surface hit, NaN where nothing is hit.
 * Pure: no DOM.
 */

export interface DepthWindow { x0: number; x1: number; zTop: number; zBottom: number; cols: number; rows: number }

/** Write the frontmost -y of every triangle into `depth` (max wins); when `owner` is given, mark the
 *  nodes this mesh now owns with `tag`. */
export function rasterizeFrontmost(pos: ArrayLike<number>, tris: ArrayLike<number>, w: DepthWindow, depth: Float64Array,
  owner?: Uint8Array, tag = 1): void {
  const { x0, x1, zTop, zBottom, cols, rows } = w;
  const sx = (cols - 1) / (x1 - x0), sz = (rows - 1) / (zTop - zBottom);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    // Grid-space coordinates: u along columns, v along rows (down).
    const ua = (pos[a] - x0) * sx, va = (zTop - pos[a + 2]) * sz, da = -pos[a + 1];
    const ub = (pos[b] - x0) * sx, vb = (zTop - pos[b + 2]) * sz, db = -pos[b + 1];
    const uc = (pos[c] - x0) * sx, vc = (zTop - pos[c + 2]) * sz, dc = -pos[c + 1];
    const det = (ub - ua) * (vc - va) - (uc - ua) * (vb - va);
    if (det === 0) continue;                                        // edge-on to the view
    const i0 = Math.max(0, Math.ceil(Math.min(ua, ub, uc))), i1 = Math.min(cols - 1, Math.floor(Math.max(ua, ub, uc)));
    const j0 = Math.max(0, Math.ceil(Math.min(va, vb, vc))), j1 = Math.min(rows - 1, Math.floor(Math.max(va, vb, vc)));
    if (i0 > i1 || j0 > j1) continue;
    const inv = 1 / det, eps = 1e-9;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const l1 = ((i - ua) * (vc - va) - (uc - ua) * (j - va)) * inv;
        const l2 = ((ub - ua) * (j - va) - (i - ua) * (vb - va)) * inv;
        const l0 = 1 - l1 - l2;
        if (l0 < -eps || l1 < -eps || l2 < -eps) continue;
        const d = l0 * da + l1 * db + l2 * dc, k = j * cols + i;
        if (!(depth[k] >= d)) { depth[k] = d; if (owner) owner[k] = tag; }
      }
    }
  }
}

export function emptyDepth(w: DepthWindow): Float64Array {
  return new Float64Array(w.cols * w.rows).fill(NaN);
}
