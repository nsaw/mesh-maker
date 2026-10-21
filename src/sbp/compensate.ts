import { ToolType, type ToolDef, type Heightmap } from './types';

/**
 * Height of the cutter's surface above its tip at horizontal distance d from the tool axis, in
 * inches, or Infinity where the cutter has no material at that distance.
 *
 * `halfAngle` is the side angle measured from the tool AXIS (Vectric's "Side Angle", the vtdb
 * included angle / 2; see tools.ts). A cone with side angle a rises dz/dr = 1 / tan(a), so a 3.58 deg
 * tapered ball nose climbs about 16 in per in beyond its ball. Before 2026-10-19 this used tan(a), the
 * slope of an angle measured from the horizontal, which modelled that tool as a nearly flat 1/8 in
 * disc and a 60 deg V-bit three times too blunt.
 *
 * Tapered ball nose and V-bit: a ball of radius R on the tip, tangent to the cone where the ball's
 * normal is perpendicular to the cone side, at r = R cos(a), height R (1 - sin(a)).
 */
export function toolZOffset(tool: ToolDef, d: number): number {
  // Every square root below is clamped at 0: at the rim, d - flat radius can round a hair past R
  // (0.020000000000000004 for D 0.25, R 0.02), and the unclamped root wrote NaN Z into the SBP.
  const R = tool.tipRadius;
  switch (tool.type) {
    case ToolType.BallNose:
      return d <= R ? R - Math.sqrt(Math.max(0, R * R - d * d)) : Infinity;

    case ToolType.TaperedBallNose:
    case ToolType.VBit: {
      // A V-bit's cutting edge ends at its diameter; a tapered ball nose keeps widening to the shank,
      // and the footprint is bounded by relief depth instead (see compensateForTool).
      if (tool.type === ToolType.VBit && d > tool.diameter / 2) return Infinity;
      const a = tool.halfAngle;
      if (!(a > 0)) return d <= R ? R - Math.sqrt(Math.max(0, R * R - d * d)) : Infinity;
      const rTangent = R * Math.cos(a);
      if (d <= rTangent) return R - Math.sqrt(Math.max(0, R * R - d * d));
      return R * (1 - Math.sin(a)) + (d - rTangent) / Math.tan(a);
    }

    case ToolType.Radiused: {
      const toolR = tool.diameter / 2;
      if (d > toolR) return Infinity;
      const flatR = toolR - R;
      if (R <= 0 || d <= flatR) return 0;
      const dr = d - flatR;
      return R - Math.sqrt(Math.max(0, R * R - dr * dr));
    }

    case ToolType.EndMill:
      return d <= tool.diameter / 2 ? 0 : Infinity;

    default:
      // A cutter shape this file does not model must stop the export, not be cut as a flat end mill.
      throw new Error(`Tool "${tool.name}": unsupported tool type ${String(tool.type)} for compensation`);
  }
}

/** toolZOffset for one tool, with its constants worked out once: the drop-cutter evaluates the profile
 *  millions of times per toolpath. Same values as toolZOffset (cli/sbp-cut.spec.ts checks the drop
 *  cutter against it). */
export function profileOf(tool: ToolDef): (d: number) => number {
  const R = tool.tipRadius, R2 = R * R;
  const ball = (d: number): number => (d <= R ? R - Math.sqrt(Math.max(0, R2 - d * d)) : Infinity);
  switch (tool.type) {
    case ToolType.BallNose: return ball;
    case ToolType.TaperedBallNose:
    case ToolType.VBit: {
      const a = tool.halfAngle;
      if (!(a > 0)) return ball;
      const rT = R * Math.cos(a), z0 = R * (1 - Math.sin(a)), k = 1 / Math.tan(a);
      const edge = tool.type === ToolType.VBit ? tool.diameter / 2 : Infinity;
      return (d: number): number => (d > edge ? Infinity : d <= rT ? R - Math.sqrt(Math.max(0, R2 - d * d)) : z0 + (d - rT) * k);
    }
    default: return (d: number): number => toolZOffset(tool, d);
  }
}

/** d/dd of toolZOffset for one tool (Infinity where the profile is vertical or undefined). Every
 *  supported profile is convex and non-decreasing in d up to its finite radius, which is what lets
 *  the drop cutter bound a triangle by tangent planes (see createDropCutter). */
export function profileSlopeOf(tool: ToolDef): (d: number) => number {
  const R = tool.tipRadius, R2 = R * R;
  const ball = (d: number): number => (d < R ? d / Math.sqrt(R2 - d * d) : Infinity);
  switch (tool.type) {
    case ToolType.BallNose: return ball;
    case ToolType.TaperedBallNose:
    case ToolType.VBit: {
      const a = tool.halfAngle;
      if (!(a > 0)) return ball;
      const rT = R * Math.cos(a), k = 1 / Math.tan(a);
      const edge = tool.type === ToolType.VBit ? tool.diameter / 2 : Infinity;
      return (d: number): number => (d > edge ? Infinity : d <= rT ? d / Math.sqrt(Math.max(1e-300, R2 - d * d)) : k);
    }
    case ToolType.Radiused: {
      const toolR = tool.diameter / 2, flatR = toolR - R;
      return (d: number): number => (d > toolR ? Infinity : R <= 0 || d <= flatR ? 0 : ball(d - flatR));
    }
    case ToolType.EndMill: return (d: number): number => (d <= tool.diameter / 2 ? 0 : Infinity);
    default: return () => Infinity;
  }
}

interface KernelPoint { di: number; dj: number; offset: number }

/** Every grid offset the cutter can touch, sorted by profile height. Points whose profile height is
 *  at least the heightmap's Z range can never decide the tip height (their candidate is at most
 *  zMin, below the centre candidate), so they are dropped; that also bounds the tapered ball nose,
 *  which has no finite radius in the profile.
 *
 *  `segment` > 0 evaluates the profile at sqrt(d^2 - segment^2) instead of d. For a point q on a
 *  segment ab of that length and any surface point p, one endpoint n (a when p lies behind q along
 *  ab, b when it lies ahead) has |p - n|^2 <= |p - q|^2 + segment^2. So the larger of the two
 *  endpoint tips computed this way is at least the exact tip anywhere along the segment. Roughing
 *  uses this to keep node-to-node moves clear without sampling between nodes.
 *
 *  `slack` > 0 first shortens every distance by that much: a surface point inside a grid triangle is
 *  no higher than the triangle's highest vertex, which lies within one cell diagonal of it, so with
 *  slack = cell diagonal the node tips also clear the triangulated surface between nodes. */
function buildKernel(tool: ToolDef, cellX: number, cellY: number, zRange: number, segment: number, slack: number): KernelPoint[] {
  const kernel: KernelPoint[] = [];
  const profile = (d: number): number => {
    const e = Math.max(0, d - slack);
    return toolZOffset(tool, Math.sqrt(Math.max(0, e * e - segment * segment)));
  };
  // Search radius: grow until the profile is out of reach. Profiles rise monotonically with d.
  let rMax = 0;
  const step = Math.min(cellX, cellY);
  while (profile(rMax + step) < zRange && rMax < 6) rMax += step;
  const ki = Math.ceil(rMax / cellX) + 1, kj = Math.ceil(rMax / cellY) + 1;
  for (let dj = -kj; dj <= kj; dj++)
    for (let di = -ki; di <= ki; di++) {
      const offset = profile(Math.hypot(di * cellX, dj * cellY));
      if (offset < zRange || (di === 0 && dj === 0)) kernel.push({ di, dj, offset });
    }
  kernel.sort((p, q) => p.offset - q.offset);
  return kernel;
}

/** Horizontal sliding maximum over [c - w, c + w], cells outside the row ignored (van Herk /
 *  Gil-Werman, O(1) per cell). */
function slidingRowMax(src: Float64Array, rows: number, cols: number, w: number, out: Float64Array): void {
  const m = 2 * w + 1;
  const n = cols + 2 * w;
  const pad = new Float64Array(n), g = new Float64Array(n), h = new Float64Array(n);
  for (let r = 0; r < rows; r++) {
    pad.fill(-Infinity);
    pad.set(src.subarray(r * cols, r * cols + cols), w);
    for (let i = 0; i < n; i++) g[i] = i % m === 0 ? pad[i] : Math.max(g[i - 1], pad[i]);
    for (let i = n - 1; i >= 0; i--) h[i] = (i % m === m - 1 || i === n - 1) ? pad[i] : Math.max(h[i + 1], pad[i]);
    for (let c = 0; c < cols; c++) out[r * cols + c] = Math.max(h[c], g[c + 2 * w]);
  }
}

/** Flat dilation: max of z over the kernel's footprint (a disc, so each kernel row is one chord). */
function footprintMax(z: Float64Array, rows: number, cols: number, kernel: KernelPoint[]): Float64Array {
  const halfWidth = new Map<number, number>();
  for (const { di, dj } of kernel) halfWidth.set(dj, Math.max(halfWidth.get(dj) ?? 0, Math.abs(di)));
  const byWidth = new Map<number, number[]>();
  for (const [dj, w] of halfWidth) byWidth.set(w, [...(byWidth.get(w) ?? []), dj]);
  const out = new Float64Array(rows * cols).fill(-Infinity);
  const rowMax = new Float64Array(rows * cols);
  for (const [w, djs] of byWidth) {
    slidingRowMax(z, rows, cols, w, rowMax);
    for (const dj of djs)
      for (let r = Math.max(0, -dj); r < Math.min(rows, rows - dj); r++) {
        const o = r * cols, s = (r + dj) * cols;
        for (let c = 0; c < cols; c++) if (rowMax[s + c] > out[o + c]) out[o + c] = rowMax[s + c];
      }
  }
  return out;
}

/**
 * Tool compensation: the lowest tip height at each grid node that leaves the cutter clear of the
 * surface everywhere under it. With the surface H positive up and the cutter's profile f above its
 * tip, clearance at offset d needs tip + f(d) >= H(x + d), so
 *
 *   tip(x) = max over d of (H(x + d) - f(|d|)).
 *
 * Before 2026-10-19 this took the MINIMUM (and a separable 1D approximation of it), which put the
 * tip below the surface: a flat 0.500 in plane with a 0.1 in ball came out at 0.4732 in, and a flat
 * end mill centred on a 0.5 in peak over a 0.1 in field went to 0.1 in, erasing the peak.
 *
 * Exact over the grid with a true radial (2D) kernel. Distances are physical, so a grid whose X and
 * Y spacing differ is handled. Kernel points are visited in increasing profile height and the loop
 * stops once even the footprint's highest point could not beat the current best. Cells outside the
 * grid are treated as empty (nothing to collide with past the panel edge).
 *
 * The result is exact AT the nodes only. A move that interpolates linearly between two node tips
 * can still gouge, because the envelope is not linear between nodes: at a vertical step under a
 * flat end mill it jumps by the full step height from one node to the next. Roughing therefore
 * passes `segment` and `slack` and holds each segment at its higher end; finishing does not interpolate node
 * tips at all and drops the cutter at every emitted point (createDropCutter).
 */
export function compensateForTool(heightmap: Heightmap, tool: ToolDef, segment = 0, slack = 0): Heightmap {
  const { z, rows, cols, cellSize, cellSizeY } = heightmap;
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < z.length; i++) { if (z[i] < zMin) zMin = z[i]; if (z[i] > zMax) zMax = z[i]; }
  const zRange = zMax - zMin;
  if (!(zRange > 0)) return { ...heightmap, z: z.slice() };

  const kernel = buildKernel(tool, cellSize, cellSizeY, zRange, segment, slack);
  const upper = footprintMax(z, rows, cols, kernel);
  const flat = kernel.every(p => p.offset === 0);
  if (flat) return { ...heightmap, z: upper };

  const result = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const bound = upper[idx];
      let best = z[idx];
      for (let k = 0; k < kernel.length; k++) {
        const { di, dj, offset } = kernel[k];
        if (bound - offset <= best) break;
        const rr = r + dj, cc = c + di;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        const cand = z[rr * cols + cc] - offset;
        if (cand > best) best = cand;
      }
      result[idx] = best;
    }
  return { ...heightmap, z: result };
}

/** Radius beyond which the cutter has no material (Infinity for the tapered ball nose, whose cone
 *  keeps widening to the shank). */
function finiteRadius(tool: ToolDef): number {
  switch (tool.type) {
    case ToolType.BallNose: return tool.tipRadius;
    case ToolType.TaperedBallNose: return Infinity;
    default: return tool.diameter / 2;
  }
}

/** Radius at which H(p) - profile(|p - q|) peaks along the uphill direction of a plane with slope
 *  |g|: where profile'(r) = |g|. Flat-bottomed and conical parts have no interior peak below their
 *  slope, so the peak runs out to `rArc`. */
function peakRadius(tool: ToolDef, slope: number, rArc: number): number {
  const R = tool.tipRadius, ball = (R * slope) / Math.sqrt(1 + slope * slope);
  switch (tool.type) {
    case ToolType.BallNose: return Math.min(ball, rArc);
    case ToolType.Radiused: return Math.min(tool.diameter / 2 - R + ball, rArc);
    case ToolType.TaperedBallNose:
    case ToolType.VBit: {
      const a = tool.halfAngle;
      if (!(a > 0)) return Math.min(ball, rArc);
      return slope < 1 / Math.tan(a) ? ball : rArc; // ball part, or up the cone to the edge
    }
    default: return rArc; // flat end mill
  }
}

/** Grid cell diagonal used by the exported mesh (src/mesh-writer.ts): 'shortest' splits each cell
 *  along its smaller height difference, the same rule as geometry.ts preferZ00Z11Diagonal. */
function cellUsesZ00Z11(diagonal: Heightmap['diagonal'], z00: number, z10: number, z01: number, z11: number): boolean {
  if (diagonal === 'z00z11') return true;
  if (diagonal === 'z10z01') return false;
  return Math.abs(z00 - z11) < Math.abs(z10 - z01);
}

/**
 * Exact tip height at an arbitrary (x, y), in heightmap coordinates, against the TRIANGULATED surface
 * the export writes (vertices, edges and facets), not just its nodes: the max over every surface point
 * p in reach of H(p) - profile(|p - (x, y)|).
 *
 * Before this change it took the max over node samples only, so on a grid whose cells are
 * not small against the ball the cutter dropped between nodes: on 0.09 in cells (a 36 in panel at 400
 * columns) with the 1/16 in radius finishing ball it went 0.089 in below a near-flat ramp.
 *
 * Per triangle the objective is concave (a plane minus a convex radial profile), so its maximum is
 * the plane's interior peak when that lies inside the triangle, else on an edge, found by a golden-
 * section search. Node samples give a lower bound first; a triangle is solved only if its highest
 * vertex, minus the profile at its nearest point, could beat that bound.
 */
/** Margin on the tangent-plane bound, inches: far above its rounding error (~1e-15), far below
 *  any tolerance in the toolpath (CHORD_TOLERANCE and the gouge checks are 1e-4 and up). */
const TRI_BOUND_SLACK = 1e-9;

export function createDropCutter(heightmap: Heightmap, tool: ToolDef): (x: number, y: number) => number {
  const { z, rows, cols, cellSize: cx, cellSizeY: cy } = heightmap;
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < z.length; i++) { if (z[i] < zMin) zMin = z[i]; if (z[i] > zMax) zMax = z[i]; }
  const zRange = zMax - zMin;
  let reach = 0;
  const step = Math.min(cx, cy) / 4;
  while (zRange > 0 && toolZOffset(tool, reach + step) < zRange && reach < 6) reach += step;
  reach += step;
  const rArc = Math.min(reach, finiteRadius(tool));
  const f = profileOf(tool), fSlope = profileSlopeOf(tool);

  // Triangle scratch: vertex x, y, h.
  const tx = new Float64Array(3), ty = new Float64Array(3), th = new Float64Array(3);

  /** Distance from (qx, qy) to the triangle in XY (0 inside). */
  function distToTri(qx: number, qy: number): number {
    let inside = true, best = Infinity;
    for (let e = 0; e < 3; e++) {
      const ax = tx[e], ay = ty[e], bx = tx[(e + 1) % 3], by = ty[(e + 1) % 3];
      const ex = bx - ax, ey = by - ay;
      if (ex * (qy - ay) - ey * (qx - ax) < 0) inside = false;
      const t = Math.max(0, Math.min(1, ((qx - ax) * ex + (qy - ay) * ey) / (ex * ex + ey * ey)));
      best = Math.min(best, Math.hypot(ax + t * ex - qx, ay + t * ey - qy));
    }
    return inside ? 0 : best;
  }

  const G = 0.6180339887498949;
  // The edge being searched in triMax: its start (relative to the query point), direction and rise.
  let eAh = 0, eOx = 0, eOy = 0, eEx = 0, eEy = 0, eEh = 0;
  const phi = (t: number): number => eAh + t * eEh - f(Math.sqrt((eOx + t * eEx) ** 2 + (eOy + t * eEy) ** 2));

  /** Max of H - profile over the triangle in tx/ty/th (counterclockwise), or `best` if it cannot
   *  beat it. The plane's peak along its uphill direction bounds the whole triangle; when the peak
   *  lies inside, it is the answer, else the maximum is on an edge. */
  function triMax(qx: number, qy: number, best: number): number {
    const x1 = tx[1] - tx[0], y1 = ty[1] - ty[0], x2 = tx[2] - tx[0], y2 = ty[2] - ty[0];
    const h1 = th[1] - th[0], h2 = th[2] - th[0], det = x1 * y2 - x2 * y1;
    const gx = (h1 * y2 - h2 * y1) / det, gy = (x1 * h2 - x2 * h1) / det;
    const slope = Math.hypot(gx, gy);
    const rp = peakRadius(tool, slope, rArc);
    const ux = slope > 0 ? gx / slope : 0, uy = slope > 0 ? gy / slope : 0;
    const px = qx + rp * ux, py = qy + rp * uy;
    const peak = th[0] + gx * (px - tx[0]) + gy * (py - ty[0]) - f(slope > 0 ? rp : 0);
    if (peak <= best) return best;
    let inside = true;
    for (let e = 0; e < 3 && inside; e++) {
      const ax = tx[e], ay = ty[e], bx = tx[(e + 1) % 3], by = ty[(e + 1) % 3];
      if ((bx - ax) * (py - ay) - (by - ay) * (px - ax) < -1e-12) inside = false;
    }
    if (inside) return peak;
    // Edges: the objective restricted to the part of each edge within rArc of q is concave.
    for (let e = 0; e < 3; e++) {
      const ax = tx[e], ay = ty[e], ah = th[e];
      const ex = tx[(e + 1) % 3] - ax, ey = ty[(e + 1) % 3] - ay, eh = th[(e + 1) % 3] - ah;
      const A = ex * ex + ey * ey, B = 2 * ((ax - qx) * ex + (ay - qy) * ey), C = (ax - qx) ** 2 + (ay - qy) ** 2 - rArc * rArc;
      const disc = B * B - 4 * A * C;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      let t0 = Math.max(0, (-B - sq) / (2 * A)), t1 = Math.min(1, (-B + sq) / (2 * A));
      if (t0 > t1 || Math.max(ah, ah + eh) <= best) continue;
      const ox = ax - qx, oy = ay - qy;
      // The edge's highest end minus the profile at its nearest point bounds the whole edge.
      const tn = Math.max(t0, Math.min(t1, -(ox * ex + oy * ey) / A));
      if (Math.max(ah + t0 * eh, ah + t1 * eh) - f(Math.sqrt((ox + tn * ex) ** 2 + (oy + tn * ey) ** 2)) <= best) continue;
      eAh = ah; eOx = ox; eOy = oy; eEx = ex; eEy = ey; eEh = eh;
      best = Math.max(best, phi(t0), phi(t1));
      let a = t1 - G * (t1 - t0), b = t0 + G * (t1 - t0), fa = phi(a), fb = phi(b);
      // 32 steps shrink the bracket by 0.618^32 = 2e-7 of a cell edge: below 1e-8 in on 0.05 in cells.
      for (let it = 0; it < 32; it++) {
        if (fa < fb) { t0 = a; a = b; fa = fb; b = t0 + G * (t1 - t0); fb = phi(b); }
        else { t1 = b; b = a; fb = fa; a = t1 - G * (t1 - t0); fa = phi(a); }
      }
      best = Math.max(best, fa, fb);
    }
    return best;
  }

  /** An upper bound of H - profile over the triangle in tx/ty/th, or Infinity. With a convex,
   *  non-decreasing profile, g(p) = plane(p) - profile(|p - q|) is concave on the triangle, so it lies
   *  under its tangent plane at each vertex v: g(p) <= g(v) + grad g(v) . (p - v), whose maximum over the
   *  triangle is at a vertex. The smallest of the three is the bound. It is within about
   *  profile'' x cell^2 / 2 of the true maximum, so it rules out almost every triangle that cannot
   *  touch, without the exact search in triMax. */
  function triBound(qx: number, qy: number): number {
    const x1 = tx[1] - tx[0], y1 = ty[1] - ty[0], x2 = tx[2] - tx[0], y2 = ty[2] - ty[0];
    const h1 = th[1] - th[0], h2 = th[2] - th[0], det = x1 * y2 - x2 * y1;
    const gx = (h1 * y2 - h2 * y1) / det, gy = (x1 * h2 - x2 * h1) / det;
    let bound = Infinity;
    for (let v = 0; v < 3; v++) {
      const dx = tx[v] - qx, dy = ty[v] - qy, r = Math.sqrt(dx * dx + dy * dy);
      const fv = f(r), sv = r > 0 ? fSlope(r) : 0;
      if (!(fv < Infinity) || !(sv < Infinity)) return Infinity;
      const ux = r > 0 ? (gx - (sv * dx) / r) : gx, uy = r > 0 ? (gy - (sv * dy) / r) : gy;
      let rise = 0;
      for (let w = 0; w < 3; w++) if (w !== v) rise = Math.max(rise, ux * (tx[w] - tx[v]) + uy * (ty[w] - ty[v]));
      bound = Math.min(bound, th[v] - fv + rise);
    }
    return bound;
  }

  function loadTri(x0: number, y0: number, a: number, ah: number, b: number, bh: number, c: number, ch: number): void {
    // Corners as bit pairs: bit 0 = +1 column, bit 1 = +1 row.
    tx[0] = x0 + (a & 1) * cx; ty[0] = y0 + (a >> 1) * cy; th[0] = ah;
    tx[1] = x0 + (b & 1) * cx; ty[1] = y0 + (b >> 1) * cy; th[1] = bh;
    tx[2] = x0 + (c & 1) * cx; ty[2] = y0 + (c >> 1) * cy; th[2] = ch;
  }

  /** Best contact over the two triangles of cell (r, c), or `best` if neither beats it. Triangles
   *  counterclockwise, matching mesh-writer.ts. */
  function solveCell(r: number, c: number, x: number, y: number, best: number): number {
    const k = r * cols + c;
    const z00 = z[k], z10 = z[k + 1], z01 = z[k + cols], z11 = z[k + cols + 1];
    const x0 = c * cx, y0 = r * cy;
    const main = cellUsesZ00Z11(heightmap.diagonal, z00, z10, z01, z11);
    for (let t = 0; t < 2; t++) {
      if (main) { if (t === 0) loadTri(x0, y0, 0, z00, 1, z10, 3, z11); else loadTri(x0, y0, 0, z00, 3, z11, 2, z01); }
      else if (t === 0) loadTri(x0, y0, 0, z00, 1, z10, 2, z01); else loadTri(x0, y0, 1, z10, 3, z11, 2, z01);
      const triTop = Math.max(th[0], th[1], th[2]);
      if (triTop <= best) continue;
      const d = distToTri(x, y);
      if (d > reach || triTop - f(d) <= best) continue;
      // TRI_BOUND_SLACK absorbs rounding in the bound (its algebra is exact; floating point is not).
      if (triBound(x, y) + TRI_BOUND_SLACK <= best) continue;
      best = triMax(x, y, best);
    }
    return best;
  }

  // Highest node of every cell, for one-comparison rejection.
  const cellMax = new Float64Array((rows - 1) * (cols - 1));
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const k = r * cols + c;
      cellMax[r * (cols - 1) + c] = Math.max(z[k], z[k + 1], z[k + cols], z[k + cols + 1]);
    }

  // Highest node within reach + 1.5 cell diagonals of every node: it bounds every surface point a
  // cutter centred within half a diagonal of that node can touch.
  const diag = Math.hypot(cx, cy);
  const localR = reach + 1.5 * diag;
  const disc: KernelPoint[] = [];
  for (let dj = -Math.ceil(localR / cy); dj <= Math.ceil(localR / cy); dj++)
    for (let di = -Math.ceil(localR / cx); di <= Math.ceil(localR / cx); di++)
      if (Math.hypot(di * cx, dj * cy) <= localR) disc.push({ di, dj, offset: 0 });
  const localMax = footprintMax(z, rows, cols, disc);
  const minCell = Math.min(cx, cy);


  /** Lower-bound candidates from the cell's four nodes, then its two triangles if they could win. */
  function visitCell(r: number, c: number, x: number, y: number, best: number): number {
    const cm = cellMax[r * (cols - 1) + c];
    if (cm <= best) return best;
    const x0 = c * cx, y0 = r * cy;
    const ddx = Math.max(0, x0 - x, x - x0 - cx), ddy = Math.max(0, y0 - y, y - y0 - cy);
    const dd = Math.sqrt(ddx * ddx + ddy * ddy);
    if (dd > reach || cm - f(dd) <= best) return best;
    for (let v = 0; v < 4; v++) {
      const rr = r + (v >> 1), cc = c + (v & 1), h = z[rr * cols + cc];
      if (h <= best) continue;
      const d = Math.hypot(cc * cx - x, rr * cy - y);
      if (d <= reach) best = Math.max(best, h - f(d));
    }
    return solveCell(r, c, x, y, best);
  }

  return (x: number, y: number): number => {
    const gxq = x / cx, gyq = y / cy;
    const cq = Math.min(cols - 2, Math.max(0, Math.floor(gxq))), rq = Math.min(rows - 2, Math.max(0, Math.floor(gyq)));
    const zLocal = localMax[Math.min(rows - 1, Math.max(0, Math.round(gyq))) * cols + Math.min(cols - 1, Math.max(0, Math.round(gxq)))];
    // The cell under the cutter first: on smooth ground its contact is at or near the answer. Then
    // rings of cells outward, until even the local maximum height minus the profile at the ring's
    // nearest possible distance cannot beat the best contact found.
    let best = visitCell(rq, cq, x, y, -Infinity);
    const kMax = Math.ceil(reach / minCell) + 2;
    for (let k = 1; k <= kMax; k++) {
      if (zLocal - f((k - 1) * minCell) <= best) break;
      for (let r = rq - k; r <= rq + k; r++) {
        if (r < 0 || r > rows - 2) continue;
        const edgeRow = r === rq - k || r === rq + k;
        for (let c = cq - k; c <= cq + k; c += edgeRow ? 1 : 2 * k) {
          if (c < 0 || c > cols - 2) continue;
          best = visitCell(r, c, x, y, best);
        }
      }
    }
    // Only reachable outside the grid; keep the cutter at the nearest edge height rather than -Inf.
    return best === -Infinity ? z[Math.min(rows - 1, Math.max(0, Math.round(gyq))) * cols + Math.min(cols - 1, Math.max(0, Math.round(gxq)))] : best;
  };
}

/**
 * Local bound L(x, y) on how fast the exact tip height can change per inch of horizontal travel
 * near (x, y): for points q within `radius` of (x, y), |tip(q) - tip(q')| <= L |q - q'|.
 *
 * Shift the contact point along with the cutter: the surface under it changes by at most the
 * steepest facet slope among the facets the cutter can touch there, so L is the steepest facet
 * within reach + radius + one cell diagonal. A shifted contact that leaves the panel is projected
 * back onto it; projection onto the rectangle is non-expansive and every profile is non-decreasing,
 * so the bound holds at the edges too. A tapered ball nose also obeys
 * its cone slope 1 / tan(side angle) everywhere (its cone never ends, so it has no rim), so its L is
 * the smaller of the two. Cutters with a rim or vertical side (ball nose, end mills, a V-bit past its
 * diameter) use the facet bound alone: their own profile slope is unbounded at the rim.
 */
export function createTipLipschitzField(heightmap: Heightmap, tool: ToolDef, radius: number): (x: number, y: number) => number {
  const { z, rows, cols, cellSize: cx, cellSizeY: cy } = heightmap;
  // Steepest facet touching each node: a grid triangle's gradient has components no steeper than
  // its steepest x and y edges.
  const nodeSlope = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c, h = z[k];
      const sx = Math.max(c > 0 ? Math.abs(h - z[k - 1]) : 0, c < cols - 1 ? Math.abs(z[k + 1] - h) : 0) / cx;
      const sy = Math.max(r > 0 ? Math.abs(h - z[k - cols]) : 0, r < rows - 1 ? Math.abs(z[k + cols] - h) : 0) / cy;
      nodeSlope[k] = Math.hypot(sx, sy);
    }
  let zMin = Infinity, zMax = -Infinity;
  for (let k = 0; k < z.length; k++) { if (z[k] < zMin) zMin = z[k]; if (z[k] > zMax) zMax = z[k]; }
  let reach = 0;
  const step = Math.min(cx, cy) / 4;
  while (zMax > zMin && toolZOffset(tool, reach + step) < zMax - zMin && reach < 6) reach += step;
  const R = reach + step + radius + 1.5 * Math.hypot(cx, cy);
  const disc: KernelPoint[] = [];
  for (let dj = -Math.ceil(R / cy); dj <= Math.ceil(R / cy); dj++)
    for (let di = -Math.ceil(R / cx); di <= Math.ceil(R / cx); di++)
      if (Math.hypot(di * cx, dj * cy) <= R) disc.push({ di, dj, offset: 0 });
  const field = footprintMax(nodeSlope, rows, cols, disc);
  const cone = tool.type === ToolType.TaperedBallNose && tool.halfAngle > 0 ? 1 / Math.tan(tool.halfAngle) : Infinity;
  return (x: number, y: number): number => {
    const c = Math.min(cols - 1, Math.max(0, Math.round(x / cx))), r = Math.min(rows - 1, Math.max(0, Math.round(y / cy)));
    return Math.min(cone, field[r * cols + c]);
  };
}
