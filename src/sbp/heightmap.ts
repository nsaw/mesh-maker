import type { BoundingBox, Heightmap } from './types';

/**
 * Rasterize a binary STL (as Float32Array) into a regular Z-height grid.
 * Approach: spatial binning + barycentric interpolation, max Z wins.
 *
 * @param data    Float32Array from parseSTLBinary (12 floats/tri: normal + 3 verts)
 * @param count   Number of triangles
 * @param bounds  Bounding box from parser
 * @param resolution  Cells per inch (default 200)
 */
export function meshToHeightmap(
  data: Float32Array,
  count: number,
  bounds: BoundingBox,
  resolution: number = 200,
): Heightmap {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  if (width <= 0 || height <= 0) {
    throw new Error(`Degenerate STL bounds: ${width}" x ${height}"`);
  }

  const cellSize = 1.0 / resolution;
  const cols = Math.ceil(width * resolution) + 1;
  const rows = Math.ceil(height * resolution) + 1;
  const z = new Float64Array(rows * cols).fill(-Infinity);

  // Phase 1+2: for each triangle, find overlapping grid cells, sample Z via barycentric
  for (let t = 0; t < count; t++) {
    const base = t * 12 + 3; // skip normal

    const x0 = data[base],     y0 = data[base + 1],  z0 = data[base + 2];
    const x1 = data[base + 3], y1 = data[base + 4],  z1 = data[base + 5];
    const x2 = data[base + 6], y2 = data[base + 7],  z2 = data[base + 8];

    // Triangle XY bounding box -> grid cell range
    const triMinX = Math.min(x0, x1, x2);
    const triMaxX = Math.max(x0, x1, x2);
    const triMinY = Math.min(y0, y1, y2);
    const triMaxY = Math.max(y0, y1, y2);

    const colStart = Math.max(0, Math.floor((triMinX - bounds.minX) / cellSize));
    const colEnd   = Math.min(cols - 1, Math.ceil((triMaxX - bounds.minX) / cellSize));
    const rowStart = Math.max(0, Math.floor((triMinY - bounds.minY) / cellSize));
    const rowEnd   = Math.min(rows - 1, Math.ceil((triMaxY - bounds.minY) / cellSize));

    // Barycentric coordinate denominators (2x signed area of triangle in XY)
    const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(denom) < 1e-12) continue; // degenerate triangle in XY
    const invDenom = 1.0 / denom;

    for (let r = rowStart; r <= rowEnd; r++) {
      const py = bounds.minY + r * cellSize;
      for (let c = colStart; c <= colEnd; c++) {
        const px = bounds.minX + c * cellSize;

        // Barycentric coordinates
        const w0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) * invDenom;
        const w1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) * invDenom;
        const w2 = 1.0 - w0 - w1;

        // Point inside triangle (with small tolerance for edge cases)
        if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) {
          const zVal = w0 * z0 + w1 * z1 + w2 * z2;
          const idx = r * cols + c;
          if (zVal > z[idx]) {
            z[idx] = zVal;
          }
        }
      }
    }
  }

  // Phase 3: gap fill -- nearest-neighbor expanding ring (max 5 cells)
  const MAX_GAP_RADIUS = 5;
  const gaps: number[] = [];
  for (let i = 0; i < z.length; i++) {
    if (z[i] === -Infinity) gaps.push(i);
  }

  for (const idx of gaps) {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    let bestZ = -Infinity;

    for (let radius = 1; radius <= MAX_GAP_RADIUS; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue; // ring only
          const nr = row + dr;
          const nc = col + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            const nz = z[nr * cols + nc];
            if (nz > bestZ && nz !== -Infinity) bestZ = nz;
          }
        }
      }
      if (bestZ !== -Infinity) break;
    }

    if (bestZ !== -Infinity) {
      z[idx] = bestZ;
    } else {
      z[idx] = bounds.minZ; // fallback: mesh minimum
    }
  }

  return {
    z,
    rows,
    cols,
    originX: bounds.minX,
    originY: bounds.minY,
    cellSize,
    meshX: width,
    meshY: height,
  };
}

/**
 * Convert MeshCraft STATE.vertices (number[][]) to a Heightmap.
 * STATE.vertices is already a regular grid in CNC Z space.
 */
export function stateToHeightmap(
  vertices: number[][],
  rows: number,
  cols: number,
  meshX: number,
  meshY: number,
): Heightmap {
  const z = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      z[r * cols + c] = vertices[r][c];
    }
  }

  return {
    z,
    rows,
    cols,
    originX: 0,
    originY: 0,
    cellSize: meshX / (cols - 1),
    meshX,
    meshY,
  };
}
