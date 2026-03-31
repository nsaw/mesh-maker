import Database from 'better-sqlite3';
import { ToolType } from '../src/sbp/types';
import type { ToolDef, CuttingParams } from '../src/sbp/types';

const DEG_TO_RAD = Math.PI / 180;
const MM_S_TO_IPS = 1.0 / 25.4;

/**
 * Map vtdb tool_type integers to our ToolType enum.
 */
function mapToolType(vtdbType: number): ToolType {
  switch (vtdbType) {
    case 0: return ToolType.BallNose;
    case 1: return ToolType.EndMill;
    case 2: return ToolType.Radiused;
    case 3: return ToolType.VBit;
    case 5: return ToolType.TaperedBallNose;
    default: return ToolType.EndMill;
  }
}

interface VtdbRow {
  tree_name: string;
  name_format: string;
  tool_type: number;
  diameter: number;
  tip_radius: number | null;
  included_angle: number | null;
  num_flutes: number | null;
  feed_rate: number;
  plunge_rate: number;
  spindle_speed: number;
  stepdown: number;
  stepover: number;
  rate_units: number;
  group_name: string;
}

/**
 * Read all tools with cutting data from a Vectric vtdb file.
 * Returns ToolDef[] with ATC slot extracted from parent group name (e.g., "TOOL 4 - Finish 1").
 *
 * @param vtdbPath  Path to .vtdb SQLite file
 */
export function readToolDatabase(vtdbPath: string): ToolDef[] {
  const db = new Database(vtdbPath, { readonly: true });

  const rows = db.prepare(`
    SELECT
      t.name as tree_name,
      g.name_format,
      g.tool_type,
      g.diameter,
      g.tip_radius,
      g.included_angle,
      g.num_flutes,
      c.feed_rate,
      c.plunge_rate,
      c.spindle_speed,
      c.stepdown,
      c.stepover,
      c.rate_units,
      p.name as group_name
    FROM tool_tree_entry t
    JOIN tool_tree_entry p ON t.parent_group_id = p.id
    JOIN tool_geometry g ON t.tool_geometry_id = g.id
    JOIN tool_entity e ON e.tool_geometry_id = g.id
    JOIN tool_cutting_data c ON e.tool_cutting_data_id = c.id
    WHERE c.feed_rate IS NOT NULL
      AND p.name LIKE 'TOOL%'
    ORDER BY p.name, g.diameter
  `).all() as VtdbRow[];

  db.close();

  return rows.map(row => {
    // Extract ATC slot from group name: "TOOL N - ..."
    const slotMatch = row.group_name.match(/^TOOL\s+(\d+)/i);
    if (!slotMatch) {
      throw new Error(`Could not extract ATC slot from tool group "${row.group_name}"`);
    }
    const atcSlot = parseInt(slotMatch[1], 10);

    // Vectric's rate_units only covers feed/plunge speeds. The shipped ShopBot
    // libraries store stepdown/stepover in inches even when rate_units=4, so
    // those geometry values pass through unchanged here.
    const isMetric = row.rate_units === 4;
    const feedRate = isMetric ? row.feed_rate * MM_S_TO_IPS : row.feed_rate;
    const plungeRate = isMetric ? row.plunge_rate * MM_S_TO_IPS : row.plunge_rate;

    // Build display name from name_format or tree_name
    const name = row.tree_name || row.name_format || `Tool ${atcSlot}`;

    const cutting: CuttingParams = {
      feedRate,
      plungeRate,
      rpm: row.spindle_speed,
      stepdown: row.stepdown,
      stepover: row.stepover,
    };

    return {
      name,
      atcSlot,
      type: mapToolType(row.tool_type),
      diameter: row.diameter,
      tipRadius: row.tip_radius ?? 0,
      halfAngle: row.included_angle ? (row.included_angle / 2) * DEG_TO_RAD : 0,
      flutes: row.num_flutes ?? 2,
      cutting,
    };
  });
}
