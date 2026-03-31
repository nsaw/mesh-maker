import type { Heightmap, SbpConfig, ToolpathSection, ToolpathMove } from './types';

/**
 * Bilinear interpolation of the heightmap at arbitrary (x, y) in mesh coordinates.
 */
function bilinearInterp(
  z: Float64Array,
  rows: number,
  cols: number,
  cellSize: number,
  x: number,
  y: number,
): number {
  const col = x / cellSize;
  const row = y / cellSize;

  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const c1 = Math.min(c0 + 1, cols - 1);
  const r1 = Math.min(r0 + 1, rows - 1);
  const c0c = Math.max(0, c0);
  const r0c = Math.max(0, r0);

  const fx = col - c0;
  const fy = row - r0;

  const z00 = z[r0c * cols + c0c];
  const z10 = z[r0c * cols + c1];
  const z01 = z[r1 * cols + c0c];
  const z11 = z[r1 * cols + c1];

  return z00 * (1 - fx) * (1 - fy)
    + z10 * fx * (1 - fy)
    + z01 * (1 - fx) * fy
    + z11 * fx * fy;
}

function pushUniquePoint(
  points: Array<{ x: number; y: number }>,
  meshX: number,
  meshY: number,
  x: number,
  y: number,
): void {
  const EPS = 1e-9;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (x < -EPS || x > meshX + EPS || y < -EPS || y > meshY + EPS) return;
  if (points.some((point) => Math.abs(point.x - x) <= EPS && Math.abs(point.y - y) <= EPS)) return;
  points.push({ x, y });
}

/**
 * Compute raster lines across the workpiece at an arbitrary angle.
 *
 * The raster direction is defined by finishRasterAngle in degrees, and the line
 * offsets advance along the normalized perpendicular by the configured stepover.
 */
function computeRasterLines(
  meshX: number,
  meshY: number,
  stepover: number,
  finishRasterAngle: number = 45,
): Array<{ x0: number; y0: number; x1: number; y1: number }> {
  const theta = finishRasterAngle * Math.PI / 180;
  const dirX = Math.cos(theta);
  const dirY = Math.sin(theta);
  const normalX = -dirY;
  const normalY = dirX;
  const corners = [
    { x: 0, y: 0 },
    { x: meshX, y: 0 },
    { x: 0, y: meshY },
    { x: meshX, y: meshY },
  ];
  let minOffset = Infinity;
  let maxOffset = -Infinity;
  for (const corner of corners) {
    const offset = corner.x * normalX + corner.y * normalY;
    if (offset < minOffset) minOffset = offset;
    if (offset > maxOffset) maxOffset = offset;
  }
  const lines: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  const offsetStep = stepover;
  const EPS = 1e-9;

  for (let offset = minOffset; offset <= maxOffset + offsetStep * 0.5; offset += offsetStep) {
    const intersections: Array<{ x: number; y: number }> = [];

    if (Math.abs(normalY) > EPS) {
      pushUniquePoint(intersections, meshX, meshY, 0, offset / normalY);
      pushUniquePoint(intersections, meshX, meshY, meshX, (offset - normalX * meshX) / normalY);
    }
    if (Math.abs(normalX) > EPS) {
      pushUniquePoint(intersections, meshX, meshY, offset / normalX, 0);
      pushUniquePoint(intersections, meshX, meshY, (offset - normalY * meshY) / normalX, meshY);
    }

    if (intersections.length < 2) continue;

    intersections.sort(
      (a, b) => (a.x * dirX + a.y * dirY) - (b.x * dirX + b.y * dirY),
    );
    const start = intersections[0];
    const end = intersections[intersections.length - 1];
    lines.push({
      x0: start.x,
      y0: start.y,
      x1: end.x,
      y1: end.y,
    });
  }

  return lines;
}

/**
 * Generate continuous finishing toolpath.
 *
 * Structure matches Aspire reference:
 * - Entry: rapid to start position at safeZ, plunge to surface
 * - Core: continuous M3 moves along bidirectional zigzag raster lines
 *   At line ends, traverse boundary at materialZ to next line (no mid-path retracts)
 * - Exit: retract to safeZ
 *
 * Points sampled at uniform 0.005" spacing along each raster line.
 * Collinear point reduction applied to compress output.
 */
export function generateFinishing(
  compensated: Heightmap,
  config: SbpConfig,
): ToolpathSection {
  const { z, rows, cols, cellSize, meshX, meshY } = compensated;
  const tool = config.finishingTool;
  const stepover = tool.cutting.stepover;
  const { materialZ, safeZ, offsetX, offsetY, finishRasterAngle } = config;

  const lines = computeRasterLines(meshX, meshY, stepover, finishRasterAngle);
  const pointSpacing = 0.005; // uniform spacing along each line
  const moves: ToolpathMove[] = [];

  // Entry: rapid to start of first line at safeZ
  if (lines.length === 0) {
    return { name: '3D Finish', tool, moves };
  }

  const firstLine = lines[0];
  const startX = offsetX + firstLine.x0;
  const startY = offsetY + firstLine.y0;
  const startZ = bilinearInterp(z, rows, cols, cellSize, firstLine.x0, firstLine.y0);

  moves.push({ type: 'rapid', x: startX, y: startY, z: safeZ });
  moves.push({ type: 'cut', x: startX, y: startY, z: startZ });

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const forward = i % 2 === 0; // alternate direction for zigzag

    // Sample points along the raster line
    const dx = line.x1 - line.x0;
    const dy = line.y1 - line.y0;
    const lineLen = Math.sqrt(dx * dx + dy * dy);

    if (lineLen < 1e-6) continue;

    const numPoints = Math.max(2, Math.ceil(lineLen / pointSpacing) + 1);
    const linePoints: { x: number; y: number; z: number }[] = [];

    for (let p = 0; p < numPoints; p++) {
      const t = forward
        ? p / (numPoints - 1)
        : 1 - p / (numPoints - 1);

      const lx = line.x0 + t * dx;
      const ly = line.y0 + t * dy;
      const lz = bilinearInterp(z, rows, cols, cellSize, lx, ly);

      linePoints.push({
        x: offsetX + lx,
        y: offsetY + ly,
        z: lz,
      });
    }

    // If not the first line, traverse from previous line end to this line start at materialZ
    if (i > 0) {
      const prev = moves[moves.length - 1];
      const next = linePoints[0];

      // Boundary traverse at material thickness (no retract)
      moves.push({ type: 'cut', x: prev.x, y: prev.y, z: materialZ });
      moves.push({ type: 'cut', x: next.x, y: next.y, z: materialZ });
    }

    // Add all line points (uniform 0.005" spacing, no reduction)
    for (const pt of linePoints) {
      moves.push({ type: 'cut', x: pt.x, y: pt.y, z: pt.z });
    }
  }

  // Exit: retract
  if (moves.length > 0) {
    const last = moves[moves.length - 1];
    moves.push({ type: 'rapid', x: last.x, y: last.y, z: safeZ });
  }

  return {
    name: '3D Finish',
    tool,
    moves,
  };
}
