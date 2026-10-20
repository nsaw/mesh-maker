import type { Heightmap, SbpConfig, SbpStats, ToolpathSection } from './types';
import { MACHINE_TRAVEL_IN, MACHINE_TRAVEL_TOLERANCE_IN } from './types';
import { compensateForTool } from './compensate';
import { generateRoughing } from './roughing';
import { generateFinishing } from './finishing';
import { writeSBP } from './writer';

/**
 * Normalize a heightmap so all Z >= 0. Shifts the entire grid up if any negative values found.
 * Also ensures materialZ covers the surface.
 * Returns the (possibly modified) heightmap and adjusted config.
 */
function normalizeZ(
  heightmap: Heightmap,
  config: SbpConfig,
): { heightmap: Heightmap; config: SbpConfig; shifted: number } {
  const { z } = heightmap;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < z.length; i++) {
    if (z[i] < minZ) minZ = z[i];
    if (z[i] > maxZ) maxZ = z[i];
  }

  let shifted = 0;
  let adjustedZ = z;

  if (minZ < 0) {
    shifted = -minZ;
    adjustedZ = new Float64Array(z.length);
    for (let i = 0; i < z.length; i++) {
      adjustedZ[i] = z[i] + shifted;
    }
    maxZ += shifted;
  }

  // Ensure materialZ covers the surface
  let adjustedConfig = config;
  if (config.materialZ < maxZ + 0.01) {
    adjustedConfig = { ...config, materialZ: maxZ + 0.01 };
  }

  return {
    heightmap: shifted > 0 ? { ...heightmap, z: adjustedZ } : heightmap,
    config: adjustedConfig,
    shifted,
  };
}

export interface GenerateResult {
  sbp: string;
  stats: SbpStats;
}

/**
 * Full SBP generation pipeline.
 * Shared entry point for both CLI and web.
 *
 * 1. Normalize Z (shift negative values up)
 * 2. If roughing: compensate for roughing tool, generate roughing with leave stock
 * 3. If finishing: generate finishing, dropping the cutter onto the target at each point
 * 4. Write SBP string
 */
export function generateSBP(heightmap: Heightmap, config: SbpConfig): GenerateResult {
  const { heightmap: normHm, config: normConfig, shifted } = normalizeZ(heightmap, config);
  // The part sits at the work offset; part plus offset must stay inside the machine's travel.
  const T = MACHINE_TRAVEL_TOLERANCE_IN;
  const reachX = normConfig.offsetX + normHm.meshX, reachY = normConfig.offsetY + normHm.meshY;
  if (normConfig.offsetX < -T || normConfig.offsetY < -T || reachX > MACHINE_TRAVEL_IN.x + T || reachY > MACHINE_TRAVEL_IN.y + T)
    throw new Error(`Part plus offset reaches X ${reachX.toFixed(3)}, Y ${reachY.toFixed(3)} in; the machine travels ` +
      `${MACHINE_TRAVEL_IN.x} x ${MACHINE_TRAVEL_IN.y} in. Reduce Offset X/Y or the part size.`);
  // Rapids run at safe Z; at or below the stock top they would drive the cutter through material.
  if (!(normConfig.safeZ > normConfig.materialZ))
    throw new Error(`Safe Z ${normConfig.safeZ.toFixed(3)} in must be above the stock top ${normConfig.materialZ.toFixed(3)} in`);

  const sections: ToolpathSection[] = [];
  let roughingMoves = 0;
  let finishingMoves = 0;

  if (normConfig.roughingEnabled) {
    // Roughing moves node to node along rows, so its tips carry the one-cell segment margin, and
    // the one-diagonal slack that keeps them clear of the triangulated surface between nodes.
    const roughCompensated = compensateForTool(normHm, normConfig.roughingTool, normHm.cellSize,
      Math.hypot(normHm.cellSize, normHm.cellSizeY));
    const roughing = generateRoughing(roughCompensated, normConfig);
    roughingMoves = roughing.moves.length;
    sections.push(roughing);
  }

  if (normConfig.finishingEnabled) {
    // Finishing drops the cutter onto the target at every emitted point (no node interpolation).
    const finishing = generateFinishing(normHm, normConfig);
    finishingMoves = finishing.moves.length;
    sections.push(finishing);
  }

  const { sbp, lineCount } = writeSBP(sections, normConfig);

  return {
    sbp,
    stats: {
      roughingMoves,
      finishingMoves,
      totalLines: lineCount,
      zShifted: shifted,
      heightmapRows: normHm.rows,
      heightmapCols: normHm.cols,
    },
  };
}
