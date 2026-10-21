import type { Heightmap, SbpConfig, ToolpathSection, ToolpathMove } from './types';
import { createDropCutter, createTipLipschitzField } from './compensate';

/** Largest the straight move between two emitted points may sit below the exact tip height at a
 *  sample before the move is split. The envelope bends sharply where the steep side of a tapered
 *  ball nose touches fine detail, so uniform 0.005 in points alone gouged up to 0.007 in there. */
const CHORD_TOLERANCE = 0.0001;
const MAX_CHORD_SPLITS = 6;
/** Most samples of the exact tip per move before it is split instead. At least eighths are always
 *  taken on a move that is not already flat to the bound: on a cliff-and-spike surface a rise at
 *  t = 0.125 went 1.1 thou under quarter-point checks (cli/sbp-cut.spec.ts C8). */
const MAX_CHORD_SAMPLES = 256;
/** Most a certified move may pass under the exact tip, inches; under the 0.0005 in the cut specs
 *  allow, so sampling noise in the check itself cannot reach it. */
const CERTIFIED_GOUGE = 0.0004;

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
 * Points sampled at uniform 0.005" spacing along each raster line, each one dropped onto the target
 * surface (createDropCutter). Each straight move between two points is certified against the exact
 * tip (see emit below) or split, with a provably clear lift-and-cross at the deepest split. No
 * collinear reduction.
 */
export function generateFinishing(
  target: Heightmap,
  config: SbpConfig,
): ToolpathSection {
  const { meshX, meshY } = target;
  const tool = config.finishingTool;
  const drop = createDropCutter(target, tool);
  const stepover = tool.cutting.stepover;
  const { materialZ, safeZ, offsetX, offsetY, finishRasterAngle } = config;

  const lines = computeRasterLines(meshX, meshY, stepover, finishRasterAngle);
  const pointSpacing = 0.005; // uniform spacing along each line
  // Moves are at most pointSpacing long; the field covers every contact of any point on one.
  const tipSlopeAt = createTipLipschitzField(target, tool, pointSpacing);
  const moves: ToolpathMove[] = [];

  // Entry: rapid to start of first line at safeZ
  if (lines.length === 0) {
    return { name: '3D Finish', tool, moves };
  }

  const firstLine = lines[0];
  const startX = offsetX + firstLine.x0;
  const startY = offsetY + firstLine.y0;
  const startZ = drop(firstLine.x0, firstLine.y0);

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
    const at = (t: number): { x: number; y: number; z: number } => {
      const lx = line.x0 + t * dx, ly = line.y0 + t * dy;
      return { x: offsetX + lx, y: offsetY + ly, z: drop(lx, ly) };
    };
    // Emit [ta, tb). A straight move is accepted only when it is certified: the exact tip is sampled
    // at n evenly spaced points, and between two samples h apart the tip can rise above them by
    // at most L h / 2 (L from createTipLipschitzField, local to the move). So the move passes under
    // the tip by at most max(sample excess) + L h / 2, and it must keep that within CERTIFIED_GOUGE.
    // Otherwise it is split; if the last allowed split still fails, the cutter lifts at a, crosses at
    // max(a, b) + L |ab| / 2 (no point of the step can need more) and drops at b.
    const emit = (ta: number, a: { x: number; y: number; z: number }, tb: number,
      b: { x: number; y: number; z: number }, depth: number): void => {
      const tm = (ta + tb) / 2, m = at(tm);
      const lineT = (t: number): number => a.z + (b.z - a.z) * ((t - ta) / (tb - ta));
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const L = tipSlopeAt((a.x + b.x) / 2 - offsetX, (a.y + b.y) / 2 - offsetY);
      // Sample at n evenly spaced points, doubling n (new points only) while the samples are clean
      // but the bound is not yet met: near steep ground that costs tip evaluations, not emitted points.
      let excess = Math.max(0, m.z - lineT(tm)), n = 2;
      while (excess <= CHORD_TOLERANCE && excess + L * (len / n) / 2 > CERTIFIED_GOUGE && n < MAX_CHORD_SAMPLES) {
        n *= 2;
        for (let k = 1; k < n && excess <= CHORD_TOLERANCE; k += 2) {
          const t = ta + ((tb - ta) * k) / n;
          excess = Math.max(excess, at(t).z - lineT(t));
        }
      }
      if (excess <= CHORD_TOLERANCE && excess + L * (len / n) / 2 <= CERTIFIED_GOUGE) {
        linePoints.push(a);
      } else if (depth < MAX_CHORD_SPLITS) {
        emit(ta, a, tm, m, depth + 1);
        emit(tm, m, tb, b, depth + 1);
      } else {
        const hold = Math.max(a.z, b.z) + L * len / 2;
        linePoints.push(a, { x: a.x, y: a.y, z: hold }, { x: b.x, y: b.y, z: hold });
      }
    };

    let tPrev = forward ? 0 : 1, pPrev = at(tPrev);
    for (let p = 1; p < numPoints; p++) {
      const t = forward ? p / (numPoints - 1) : 1 - p / (numPoints - 1);
      const pt = at(t);
      emit(tPrev, pPrev, t, pt, 0);
      tPrev = t; pPrev = pt;
    }
    linePoints.push(pPrev);

    // If not the first line, traverse from previous line end to this line start at materialZ
    if (i > 0) {
      const prev = moves[moves.length - 1];
      const next = linePoints[0];

      // Boundary traverse at materialZ assumes normalizeZ() already lifted the
      // stock top above the surface extrema used by these line endpoints.
      if (materialZ + 1e-9 < prev.z || materialZ + 1e-9 < next.z) {
        throw new Error('Finishing traverse requires materialZ to be above the surface');
      }
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
