import { ToolType, type ToolDef, type Heightmap } from './types';

/**
 * Height of the cutter's surface above its tip at horizontal distance d from the tool axis, in
 * inches, or Infinity where the cutter has no material at that distance.
 *
 * `halfAngle` is the side angle measured from the tool AXIS (Vectric's "Side Angle", the vtdb
 * included angle / 2; see tools.ts). A cone with side angle a rises dz/dr = 1 / tan(a), so a 3.58 deg
 * tapered ball nose climbs about 16 in per in beyond its ball. Before 2026-10-20 this used tan(a), the
 * slope of an angle measured from the horizontal, which modelled that tool as a nearly flat 1/8 in
 * disc and a 60 deg V-bit three times too blunt.
 *
 * Tapered ball nose and V-bit: a ball of radius R on the tip, tangent to the cone where the ball's
 * normal is perpendicular to the cone side, at r = R cos(a), height R (1 - sin(a)).
 */
export function toolZOffset(tool: ToolDef, d: number): number {
  const R = tool.tipRadius;
  switch (tool.type) {
    case ToolType.BallNose:
      return d <= R ? R - Math.sqrt(R * R - d * d) : Infinity;

    case ToolType.TaperedBallNose:
    case ToolType.VBit: {
      // A V-bit's cutting edge ends at its diameter; a tapered ball nose keeps widening to the shank,
      // and the footprint is bounded by relief depth instead (see compensateForTool).
      if (tool.type === ToolType.VBit && d > tool.diameter / 2) return Infinity;
      const a = tool.halfAngle;
      if (!(a > 0)) return d <= R ? R - Math.sqrt(R * R - d * d) : Infinity;
      const rTangent = R * Math.cos(a);
      if (d <= rTangent) return R - Math.sqrt(R * R - d * d);
      return R * (1 - Math.sin(a)) + (d - rTangent) / Math.tan(a);
    }

    case ToolType.Radiused: {
      const toolR = tool.diameter / 2;
      if (d > toolR) return Infinity;
      const flatR = toolR - R;
      if (R <= 0 || d <= flatR) return 0;
      const dr = d - flatR;
      return R - Math.sqrt(R * R - dr * dr);
    }

    case ToolType.EndMill:
      return d <= tool.diameter / 2 ? 0 : Infinity;

    default:
      // A cutter shape this file does not model must stop the export, not be cut as a flat end mill.
      throw new Error(`Tool "${tool.name}": unsupported tool type ${String(tool.type)} for compensation`);
  }
}

interface KernelPoint { di: number; dj: number; offset: number }

/** Every grid offset the cutter can touch, sorted by profile height. Points whose profile height is
 *  at least the heightmap's Z range can never decide the tip height (their candidate is at most
 *  zMin, below the centre candidate), so they are dropped; that also bounds the tapered ball nose,
 *  which has no finite radius in the profile.
 *
 *  `segment` > 0 evaluates the profile at sqrt(d^2 - segment^2) instead of d. For a point q on a
 *  segment ab of that length and any surface point p, one endpoint n (a when p lies ahead of q
 *  along ab, b otherwise) has |p - n|^2 <= |p - q|^2 + segment^2. So the larger of the two endpoint
 *  tips computed this way is at least the exact tip anywhere along the segment. Roughing uses this
 *  to keep node-to-node moves clear without sampling between nodes. */
function buildKernel(tool: ToolDef, cellX: number, cellY: number, zRange: number, segment: number): KernelPoint[] {
  const kernel: KernelPoint[] = [];
  const profile = (d: number): number => toolZOffset(tool, Math.sqrt(Math.max(0, d * d - segment * segment)));
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
 * Before 2026-10-20 this took the MINIMUM (and a separable 1D approximation of it), which put the
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
 * passes `segment` and holds each segment at its higher end; finishing does not interpolate node
 * tips at all and drops the cutter at every emitted point (createDropCutter).
 */
export function compensateForTool(heightmap: Heightmap, tool: ToolDef, segment = 0): Heightmap {
  const { z, rows, cols, cellSize, cellSizeY } = heightmap;
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < z.length; i++) { if (z[i] < zMin) zMin = z[i]; if (z[i] > zMax) zMax = z[i]; }
  const zRange = zMax - zMin;
  if (!(zRange > 0)) return { ...heightmap, z: z.slice() };

  const kernel = buildKernel(tool, cellSize, cellSizeY, zRange, segment);
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

/**
 * Exact tip height at an arbitrary (x, y), in heightmap coordinates: the max over every node p in
 * reach of H(p) - profile(|p - (x, y)|). The surface is taken as its node samples; between nodes the
 * exported mesh's triangles can sit up to about cell^2 / (8 R) away from that for a ball of radius
 * R, which is below 0.0002 in for the 1/16 in radius finishing ball on a 0.01 in grid.
 */
export function createDropCutter(heightmap: Heightmap, tool: ToolDef): (x: number, y: number) => number {
  const { z, rows, cols, cellSize, cellSizeY } = heightmap;
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < z.length; i++) { if (z[i] < zMin) zMin = z[i]; if (z[i] > zMax) zMax = z[i]; }
  const zRange = zMax - zMin;
  let reach = 0;
  const step = Math.min(cellSize, cellSizeY) / 4;
  while (zRange > 0 && toolZOffset(tool, reach + step) < zRange && reach < 6) reach += step;
  reach += step;
  const reach2 = reach * reach;
  return (x: number, y: number): number => {
    const gx = x / cellSize, gy = y / cellSizeY;
    const c0 = Math.max(0, Math.ceil(gx - reach / cellSize)), c1 = Math.min(cols - 1, Math.floor(gx + reach / cellSize));
    const r0 = Math.max(0, Math.ceil(gy - reach / cellSizeY)), r1 = Math.min(rows - 1, Math.floor(gy + reach / cellSizeY));
    let best = -Infinity;
    for (let r = r0; r <= r1; r++) {
      const dy = (r - gy) * cellSizeY, base = r * cols;
      for (let c = c0; c <= c1; c++) {
        const h = z[base + c];
        if (h <= best) continue; // the profile is never negative
        const dx = (c - gx) * cellSize, d2 = dx * dx + dy * dy;
        if (d2 > reach2) continue;
        const v = h - toolZOffset(tool, Math.sqrt(d2));
        if (v > best) best = v;
      }
    }
    // Only reachable outside the grid; keep the cutter at the nearest edge height rather than -Inf.
    return best === -Infinity ? z[Math.min(rows - 1, Math.max(0, Math.round(gy))) * cols + Math.min(cols - 1, Math.max(0, Math.round(gx)))] : best;
  };
}
