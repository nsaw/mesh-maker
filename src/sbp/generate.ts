import type { Heightmap, SbpConfig, SbpStats, ToolpathSection } from './types';
import { MACHINE_TRAVEL_IN, MACHINE_TRAVEL_TOLERANCE_IN, ToolType } from './types';
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
  // The grid's own extent: an STL raster (meshToHeightmap) can run up to a cell past meshX/meshY,
  // and roughing emits a move at every column and row.
  const reachX = normConfig.offsetX + Math.max(normHm.meshX, (normHm.cols - 1) * normHm.cellSize);
  const reachY = normConfig.offsetY + Math.max(normHm.meshY, (normHm.rows - 1) * normHm.cellSizeY);
  if (normConfig.offsetX < -T || normConfig.offsetY < -T || reachX > MACHINE_TRAVEL_IN.x + T || reachY > MACHINE_TRAVEL_IN.y + T)
    throw new Error(`Part plus offset reaches X ${reachX.toFixed(3)}, Y ${reachY.toFixed(3)} in; the machine travels ` +
      `${MACHINE_TRAVEL_IN.x} x ${MACHINE_TRAVEL_IN.y} in. Reduce Offset X/Y or the part size.`);
  // Z travel: the stock top, safe Z and home Z all sit above the table, inside the 6 in travel.
  for (const [label, z] of [['Stock top', normConfig.materialZ], ['Safe Z', normConfig.safeZ], ['Home Z', normConfig.homeZ]] as const)
    if (!(z <= MACHINE_TRAVEL_IN.z + T))
      throw new Error(`${label} ${z.toFixed(3)} in is beyond the machine's ${MACHINE_TRAVEL_IN.z} in Z travel`);
  // The footer returns home with one straight J3 from the last safe-Z point to (0, 0, home Z); below
  // safe Z that diagonal can run through the stock or the finished part.
  if (!(normConfig.homeZ >= normConfig.safeZ))
    throw new Error(`Home Z ${normConfig.homeZ.toFixed(3)} in must be at or above safe Z ${normConfig.safeZ.toFixed(3)} in`);
  // Policy, not safety: certified finishing keeps a flat end mill clear of the surface too, but its
  // flat bottom terraces a 3D relief rather than finishing it, and its tip rises at the full facet
  // slope at every wall, which drives the certificate to its densest sampling. Finish with a rounded or conical cutter.
  const ft = normConfig.finishingTool;
  if (normConfig.finishingEnabled && (ft.type === ToolType.EndMill || (ft.type === ToolType.Radiused && !(ft.tipRadius > 0))))
    throw new Error(`Finishing tool "${normConfig.finishingTool.name}" is a flat end mill; finish with a ball nose, tapered ball nose, V-bit or radiused cutter`);
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

  // Backstop: no move reaches the writer with a non-finite coordinate, whatever produced it.
  for (const section of sections)
    for (const m of section.moves)
      if (!(Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.z)))
        throw new Error(`${section.name}: non-finite move (${m.x}, ${m.y}, ${m.z}); no SBP written`);

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
