/**
 * Independent swept-cutter simulation of an emitted OpenSBP file.
 *
 * Reads the SBP TEXT (not the generator's internal move list), replays every J3/M3/JZ move, and
 * lowers a stock heightfield wherever the cutter's body passes below it. The result is the surface
 * the machine would leave, which is compared against the target relief: stock below the target is a
 * gouge, stock above it is material the cutter could not reach (scallops, narrow valleys).
 *
 * Deliberately shares no code with src/sbp/ (compensation, raster or writer): the cutter profile is
 * re-derived here from the tool geometry, so a defect in the generator's profile or envelope cannot
 * cancel out in the check.
 */
import type { ToolDef } from '../src/sbp/types';

export interface SimMove { rapid: boolean; x: number; y: number; z: number }
export interface SimSection { toolName: string; moves: SimMove[] }

/** Parse the moves of an OpenSBP file, grouped by tool section. Only the commands the MeshCraft
 *  writer emits are accepted; anything else that moves the machine throws, so a writer change cannot
 *  silently escape the simulation. */
export function parseSbp(text: string): SimSection[] {
  const sections: SimSection[] = [];
  let current: SimSection | null = null;
  let x = 0, y = 0, z: number;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const tool = /^'&ToolName = "(.*)"$/.exec(line);
    if (tool) { current = { toolName: tool[1], moves: [] }; sections.push(current); continue; }
    if (line === '' || line.startsWith("'") || line.startsWith('&')) continue;
    const cmd = line.split(/[\s,]/)[0].toUpperCase();
    const args = line.split(',').slice(1).map(s => Number(s.split(/\s/)[0]));
    if (cmd === 'J3' || cmd === 'M3') {
      [x, y, z] = args;
      if (![x, y, z].every(Number.isFinite)) throw new Error(`Bad move: ${line}`);
      current?.moves.push({ rapid: cmd === 'J3', x, y, z });
    } else if (cmd === 'JZ' || cmd === 'MZ') {
      z = args[0];
      current?.moves.push({ rapid: cmd === 'JZ', x, y, z });
    } else if (/^[JM][2-5XYAB]$/.test(cmd) || /^[JM]Z?$/.test(cmd)) {
      throw new Error(`Unsupported motion command in simulation: ${line}`);
    }
  }
  return sections;
}

/** Cutter surface height above the tip at radius d, re-derived from the tool geometry (see the file
 *  comment). Side angles are measured from the tool axis. */
export function cutterProfile(tool: ToolDef, d: number): number {
  const R = tool.tipRadius;
  const ball = (r: number): number => (r <= R ? R - Math.sqrt(Math.max(0, R * R - r * r)) : Infinity);
  switch (tool.type) {
    case 0: return ball(d); // BallNose
    case 1: return d <= tool.diameter / 2 ? 0 : Infinity; // EndMill
    case 2: { // Radiused end mill
      if (d > tool.diameter / 2) return Infinity;
      const flat = tool.diameter / 2 - R;
      return d <= flat ? 0 : R - Math.sqrt(Math.max(0, R * R - (d - flat) ** 2));
    }
    case 3: case 5: { // VBit, TaperedBallNose
      if (tool.type === 3 && d > tool.diameter / 2) return Infinity;
      const a = tool.halfAngle;
      if (!(a > 0)) return ball(d);
      // Ball/cone tangent point: the ball normal there is perpendicular to the cone side.
      const rt = R * Math.cos(a);
      if (d <= rt) return ball(d);
      return R - R * Math.sin(a) + (d - rt) / Math.tan(a);
    }
    default: throw new Error(`Unknown tool type ${String(tool.type)}`);
  }
}

export interface SimGrid {
  cols: number; rows: number;
  /** Machine X/Y of grid node (0, 0), and node spacing. */
  originX: number; originY: number; cellX: number; cellY: number;
}

export interface SimResult {
  stock: Float64Array;
  /** Rapid (J) moves whose cutter body passed below the stock: a crash or an unintended cut. */
  rapidCollisions: number;
  movesSimulated: number;
}

/** Replay the sections on a stock block of height `stockTop`. `sampleStep` is the spacing of cutter
 *  stamps along each move (default a quarter of the finer cell); between stamps the swept volume is
 *  approximated, an error of about sampleStep^2 / (8 R) for a ball of radius R. */
export function simulateCut(
  sections: SimSection[], toolsByName: Map<string, ToolDef>, grid: SimGrid, stockTop: number,
  sampleStep = Math.min(grid.cellX, grid.cellY) / 4,
): SimResult {
  const { cols, rows, originX, originY, cellX, cellY } = grid;
  const stock = new Float64Array(rows * cols).fill(stockTop);
  let rapidCollisions = 0, movesSimulated = 0;
  for (const section of sections) {
    const tool = toolsByName.get(section.toolName);
    if (!tool) throw new Error(`No tool definition for "${section.toolName}"`);
    // Radius beyond which the cutter cannot reach any stock below stockTop from a tip at z >= 0.
    let reach = 0;
    while (cutterProfile(tool, reach + cellX / 4) < stockTop && reach < 6) reach += cellX / 4;
    reach += cellX / 4;
    const reach2 = reach * reach;
    let px = NaN, py = NaN, pz = NaN;
    for (const m of section.moves) {
      movesSimulated++;
      const startKnown = Number.isFinite(px);
      if (!startKnown) { px = m.x; py = m.y; pz = m.z; }
      if (Math.min(pz, m.z) >= stockTop) { px = m.x; py = m.y; pz = m.z; continue; }
      const len = Math.hypot(m.x - px, m.y - py);
      const n = Math.max(1, Math.ceil(len / sampleStep));
      let collided = false;
      for (let s = startKnown ? 1 : 0; s <= n; s++) {
        const t = s / n;
        const cx = px + (m.x - px) * t, cy = py + (m.y - py) * t, cz = pz + (m.z - pz) * t;
        if (cz >= stockTop) continue;
        const gx = (cx - originX) / cellX, gy = (cy - originY) / cellY;
        const c0 = Math.max(0, Math.floor(gx - reach / cellX)), c1 = Math.min(cols - 1, Math.ceil(gx + reach / cellX));
        const r0 = Math.max(0, Math.floor(gy - reach / cellY)), r1 = Math.min(rows - 1, Math.ceil(gy + reach / cellY));
        for (let r = r0; r <= r1; r++) {
          const dy = (r - gy) * cellY;
          for (let c = c0; c <= c1; c++) {
            const dx = (c - gx) * cellX, d2 = dx * dx + dy * dy;
            if (d2 > reach2) continue;
            const f = cutterProfile(tool, Math.sqrt(d2));
            if (f === Infinity) continue;
            const v = cz + f, k = r * cols + c;
            if (v < stock[k]) {
              if (m.rapid && v < stock[k] - 1e-6) collided = true;
              stock[k] = v;
            }
          }
        }
      }
      if (collided) rapidCollisions++;
      px = m.x; py = m.y; pz = m.z;
    }
  }
  return { stock, rapidCollisions, movesSimulated };
}

export interface CutComparison {
  /** Largest depth the stock sits below the target (positive = gouge), inches. */
  maxGouge: number;
  /** 99th percentile of residual stock above the target, inches. */
  residualP99: number;
  maxResidual: number;
  meanResidual: number;
  cells: number;
}

/** Compare stock to target over the cells where `include` is true (all cells if omitted). */
export function compareCut(stock: Float64Array, target: Float64Array, include?: (k: number) => boolean): CutComparison {
  const res: number[] = [];
  let maxGouge = -Infinity, sum = 0;
  for (let k = 0; k < target.length; k++) {
    if (include && !include(k)) continue;
    const d = stock[k] - target[k];
    if (-d > maxGouge) maxGouge = -d;
    res.push(d); sum += d;
  }
  res.sort((a, b) => a - b);
  return {
    maxGouge,
    residualP99: res[Math.min(res.length - 1, Math.floor(res.length * 0.99))],
    maxResidual: res[res.length - 1],
    meanResidual: sum / res.length,
    cells: res.length,
  };
}

/**
 * The surface the exported mesh describes, sampled `factor` times finer than its grid: each cell is
 * split into two triangles ('shortest' = along the smaller height difference, as the mesh writer
 * does; re-derived here, not imported) and the fine nodes are interpolated on them. Comparing a
 * simulation on this fine grid against it shows gouges BETWEEN the target's nodes, which a
 * comparison at the nodes alone cannot.
 */
export function triangulatedTarget(
  z: Float64Array, cols: number, rows: number, diagonal: 'shortest' | 'z00z11' | 'z10z01', factor: number,
): { z: Float64Array; cols: number; rows: number } {
  const fc = (cols - 1) * factor + 1, fr = (rows - 1) * factor + 1;
  const out = new Float64Array(fc * fr);
  for (let R = 0; R < fr; R++)
    for (let C = 0; C < fc; C++) {
      const j = Math.min(rows - 2, Math.floor(R / factor)), i = Math.min(cols - 2, Math.floor(C / factor));
      const u = C / factor - i, v = R / factor - j;
      const z00 = z[j * cols + i], z10 = z[j * cols + i + 1], z01 = z[(j + 1) * cols + i], z11 = z[(j + 1) * cols + i + 1];
      const mainDiag = diagonal === 'z00z11' || (diagonal === 'shortest' && Math.abs(z00 - z11) < Math.abs(z10 - z01));
      let h: number;
      if (mainDiag) h = v <= u ? z00 + u * (z10 - z00) + v * (z11 - z10) : z00 + v * (z01 - z00) + u * (z11 - z01);
      else h = u + v <= 1 ? z00 + u * (z10 - z00) + v * (z01 - z00) : z11 + (1 - u) * (z01 - z11) + (1 - v) * (z10 - z11);
      out[R * fc + C] = h;
    }
  return { z: out, cols: fc, rows: fr };
}
