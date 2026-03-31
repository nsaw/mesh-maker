import type { Heightmap, SbpConfig, ToolpathSection, ToolpathMove } from './types';

/**
 * Generate Z-level raster roughing toolpath.
 *
 * Strategy: step down from materialZ to roughing floor (0.050") in increments of tool stepdown.
 * At each Z level, serpentine raster: sweep X, step Y by stepover, reverse each row.
 * Cut Z = max(currentZLevel, surfaceZ + leaveStock) -- never cuts below the surface.
 * Retract between disconnected segments (gaps in the cut).
 */
export function generateRoughing(
  compensated: Heightmap,
  config: SbpConfig,
): ToolpathSection {
  const { z, rows, cols, cellSize } = compensated;
  const tool = config.roughingTool;
  const stepdown = tool.cutting.stepdown;
  const stepover = tool.cutting.stepover;
  const { materialZ, safeZ, offsetX, offsetY, leaveStock } = config;

  const moves: ToolpathMove[] = [];
  const floor = 0.050; // roughing floor -- finishing handles below this

  // Compute Z levels from top down
  const levels: number[] = [];
  let level = materialZ - stepdown;
  while (level > floor) {
    levels.push(level);
    level -= stepdown;
  }
  levels.push(floor);

  // Raster step in grid cells
  const stepCells = Math.max(1, Math.round(stepover / cellSize));

  for (const zLevel of levels) {
    let forward = true;

    for (let r = 0; r < rows; r += stepCells) {
      const colRange = forward
        ? { start: 0, end: cols - 1, step: 1 }
        : { start: cols - 1, end: 0, step: -1 };

      let cutting = false;
      let prevX = 0, prevY = 0;

      for (
        let c = colRange.start;
        forward ? c <= colRange.end : c >= colRange.end;
        c += colRange.step
      ) {
        const surfaceZ = z[r * cols + c] + leaveStock;
        const cutZ = Math.max(zLevel, surfaceZ);

        // Skip if nothing to cut at this point (surface already below level)
        if (cutZ >= materialZ - 0.001) {
          if (cutting) {
            // Retract after cutting segment ends
            moves.push({ type: 'rapid', x: prevX, y: prevY, z: safeZ });
            cutting = false;
          }
          continue;
        }

        const worldX = offsetX + c * cellSize;
        const worldY = offsetY + r * cellSize;

        if (!cutting) {
          // Rapid to position, then plunge
          moves.push({ type: 'rapid', x: worldX, y: worldY, z: safeZ });
          moves.push({ type: 'cut', x: worldX, y: worldY, z: cutZ });
          cutting = true;
        } else {
          moves.push({ type: 'cut', x: worldX, y: worldY, z: cutZ });
        }

        prevX = worldX;
        prevY = worldY;
      }

      if (cutting) {
        moves.push({ type: 'rapid', x: prevX, y: prevY, z: safeZ });
      }

      forward = !forward;
    }
  }

  return {
    name: '3D Roughing',
    tool,
    moves,
  };
}
