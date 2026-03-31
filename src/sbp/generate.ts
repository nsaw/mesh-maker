import type { Heightmap, SbpConfig, SbpStats, ToolpathSection } from './types';
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
 * 3. If finishing: compensate for finishing tool, generate finishing
 * 4. Write SBP string
 */
export function generateSBP(heightmap: Heightmap, config: SbpConfig): GenerateResult {
  const { heightmap: normHm, config: normConfig, shifted } = normalizeZ(heightmap, config);

  const sections: ToolpathSection[] = [];
  let roughingMoves = 0;
  let finishingMoves = 0;

  if (normConfig.roughingEnabled) {
    const roughCompensated = compensateForTool(normHm, normConfig.roughingTool);
    const roughing = generateRoughing(roughCompensated, normConfig);
    roughingMoves = roughing.moves.length;
    sections.push(roughing);
  }

  if (normConfig.finishingEnabled) {
    const finishCompensated = compensateForTool(normHm, normConfig.finishingTool);
    const finishing = generateFinishing(finishCompensated, normConfig);
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
