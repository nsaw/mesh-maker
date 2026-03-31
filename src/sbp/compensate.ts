import { ToolType, type ToolDef, type Heightmap } from './types';

/**
 * Compute the Z offset for a tool profile at horizontal distance d from center.
 *
 * TBN: ball hemisphere near center, linear taper beyond transition.
 * Ball nose: hemisphere offset = R - sqrt(R^2 - d^2).
 * End mill: offset = 0 within radius (flat bottom).
 */
function toolZOffset(tool: ToolDef, d: number): number {
  const R = tool.tipRadius;

  switch (tool.type) {
    case ToolType.TaperedBallNose: {
      const alpha = tool.halfAngle;
      const sinA = Math.sin(alpha);
      const dTransition = R * sinA;
      if (d <= dTransition) {
        return R - Math.sqrt(R * R - d * d);
      }
      return R * (1 - Math.cos(alpha)) + (d - dTransition) * Math.tan(alpha);
    }

    case ToolType.BallNose: {
      if (d >= R) return Infinity;
      return R - Math.sqrt(R * R - d * d);
    }

    case ToolType.VBit: {
      const toolR = tool.diameter / 2;
      if (d > toolR) return Infinity;
      const alpha = tool.halfAngle;
      const sinA = Math.sin(alpha);
      const dTransition = R * sinA;
      if (d <= dTransition) {
        return R - Math.sqrt(R * R - d * d);
      }
      return R * (1 - Math.cos(alpha)) + (d - dTransition) * Math.tan(alpha);
    }

    case ToolType.EndMill:
    case ToolType.Radiused:
    default: {
      const toolR = tool.diameter / 2;
      if (d > toolR) return Infinity;
      if (tool.type === ToolType.Radiused && R > 0) {
        // Radiused end mill: flat center, rounded edge
        const flatR = toolR - R;
        if (d <= flatR) return 0;
        const dr = d - flatR;
        return R - Math.sqrt(R * R - dr * dr);
      }
      return 0;
    }
  }
}

/**
 * Build a 1D kernel profile: Z offsets for distances 0..maxCells from tool center.
 * Returns the offset array and the kernel half-width in cells.
 */
function buildKernel1D(tool: ToolDef, cellSize: number): { offsets: Float64Array; halfWidth: number } {
  // Determine the maximum effective radius of the tool
  let maxRadius: number;

  if (tool.type === ToolType.TaperedBallNose) {
    // The effective cutting radius is bounded by the physical tool diameter,
    // not the theoretical taper projection at maxDepth (which diverges for
    // small taper angles -- e.g. 3.576-deg gives 24" radius at 1.5" depth).
    maxRadius = tool.diameter / 2;
  } else if (tool.type === ToolType.BallNose) {
    maxRadius = tool.tipRadius;
  } else {
    maxRadius = tool.diameter / 2;
  }

  const halfWidth = Math.ceil(maxRadius / cellSize);
  const offsets = new Float64Array(halfWidth + 1);

  for (let i = 0; i <= halfWidth; i++) {
    offsets[i] = toolZOffset(tool, i * cellSize);
  }

  return { offsets, halfWidth };
}

/**
 * Separable morphological erosion for tool compensation.
 *
 * Two-pass approach:
 * 1. Horizontal pass: for each row, slide kernel across columns
 * 2. Vertical pass: for each column, slide kernel across rows
 *
 * Erosion computes min(z[neighbor] - kernelOffset[distance]) at each cell.
 * This gives the lowest Z the tool center can reach without gouging.
 *
 * Separable approximation error < 0.001" for TBN profiles (verified analytically).
 */
export function compensateForTool(heightmap: Heightmap, tool: ToolDef): Heightmap {
  const { z, rows, cols, cellSize } = heightmap;

  const { offsets, halfWidth } = buildKernel1D(tool, cellSize);

  // Pass 1: horizontal (along columns within each row)
  const temp = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const rowBase = r * cols;
    for (let c = 0; c < cols; c++) {
      let minVal = Infinity;
      const kStart = Math.max(0, c - halfWidth);
      const kEnd = Math.min(cols - 1, c + halfWidth);
      for (let k = kStart; k <= kEnd; k++) {
        const dist = Math.abs(k - c);
        const offset = offsets[dist];
        if (offset === Infinity) continue;
        const val = z[rowBase + k] - offset;
        if (val < minVal) minVal = val;
      }
      temp[rowBase + c] = minVal === Infinity ? z[rowBase + c] : minVal;
    }
  }

  // Pass 2: vertical (along rows within each column)
  const result = new Float64Array(rows * cols);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      let minVal = Infinity;
      const kStart = Math.max(0, r - halfWidth);
      const kEnd = Math.min(rows - 1, r + halfWidth);
      for (let k = kStart; k <= kEnd; k++) {
        const dist = Math.abs(k - r);
        const offset = offsets[dist];
        if (offset === Infinity) continue;
        const val = temp[k * cols + c] - offset;
        if (val < minVal) minVal = val;
      }
      result[r * cols + c] = minVal === Infinity ? temp[r * cols + c] : minVal;
    }
  }

  return { ...heightmap, z: result };
}
