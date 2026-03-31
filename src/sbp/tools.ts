import { ToolType } from './types';
import type { ToolDef, CuttingParams, MaterialProfile, SbpConfig } from './types';

/**
 * Embedded ATC tool data exported from 3 vtdb files (GENERAL, MDF, Hardwood).
 * Geometry is identical across all 3; cutting params differ by material.
 * Angles converted from vtdb included_angle (degrees) to halfAngle (radians).
 * Feed/plunge in IPS (vtdb mm/s entries converted: value / 25.4).
 */

interface ToolGeometry {
  name: string;
  atcSlot: number;
  type: ToolType;
  diameter: number;
  tipRadius: number;
  halfAngle: number;
  flutes: number;
}

type MaterialCuttingData = Partial<Record<MaterialProfile, CuttingParams>>;

interface EmbeddedTool {
  geometry: ToolGeometry;
  cutting: MaterialCuttingData;
}

const DEG_TO_RAD = Math.PI / 180;

const EMBEDDED_TOOLS: EmbeddedTool[] = [
  // TOOL 1 - Surfacing
  {
    geometry: {
      name: '1.25" Surfacing EM',
      atcSlot: 1,
      type: ToolType.EndMill,
      diameter: 1.25,
      tipRadius: 0,
      halfAngle: 0,
      flutes: 2,
    },
    cutting: {
      general:  { feedRate: 4.0,   plungeRate: 1.0,  rpm: 12000, stepdown: 0.08,   stepover: 0.625 },
      hardwood: { feedRate: 5.0,   plungeRate: 1.0,  rpm: 12000, stepdown: 0.0625, stepover: 0.625 },
    },
  },
  // TOOL 2 - 90-deg V-Bit
  {
    geometry: {
      name: '90-deg V-Bit 1.25"',
      atcSlot: 2,
      type: ToolType.VBit,
      diameter: 1.25,
      tipRadius: 0,
      halfAngle: 45 * DEG_TO_RAD,
      flutes: 2,
    },
    cutting: {
      general:  { feedRate: 3.150, plungeRate: 0.984, rpm: 10000, stepdown: 0.25, stepover: 0.025 },
      mdf:      { feedRate: 1.6,   plungeRate: 0.417, rpm: 10000, stepdown: 0.25, stepover: 0.025 },
      hardwood: { feedRate: 2.756, plungeRate: 0.669, rpm: 11000, stepdown: 0.18, stepover: 0.025 },
    },
  },
  // TOOL 2 - 60-deg V-Bit
  {
    geometry: {
      name: '60-deg V-Bit 1"',
      atcSlot: 2,
      type: ToolType.VBit,
      diameter: 1.0,
      tipRadius: 0,
      halfAngle: 30 * DEG_TO_RAD,
      flutes: 2,
    },
    cutting: {
      general:  { feedRate: 2.5,  plungeRate: 0.83, rpm: 16000, stepdown: 0.1,  stepover: 0.01 },
      hardwood: { feedRate: 2.5,  plungeRate: 0.83, rpm: 16000, stepdown: 0.1,  stepover: 0.01 },
    },
  },
  // TOOL 3 - 3/8" Chipbreaker (default roughing)
  {
    geometry: {
      name: '3/8" Chipbreaker EM',
      atcSlot: 3,
      type: ToolType.EndMill,
      diameter: 0.375,
      tipRadius: 0,
      halfAngle: 0,
      flutes: 2,
    },
    cutting: {
      general:  { feedRate: 3.0, plungeRate: 1.0, rpm: 12000, stepdown: 0.25, stepover: 0.20 },
      mdf:      { feedRate: 3.0, plungeRate: 1.0, rpm: 12000, stepdown: 0.25, stepover: 0.20 },
      hardwood: { feedRate: 3.0, plungeRate: 1.0, rpm: 14000, stepdown: 0.25, stepover: 0.20 },
    },
  },
  // TOOL 4 - Whiteside UD2102 0.25" Compression Spiral
  {
    geometry: {
      name: 'UD2102 0.25" Compression',
      atcSlot: 4,
      type: ToolType.EndMill,
      diameter: 0.25,
      tipRadius: 0,
      halfAngle: 0,
      flutes: 2,
    },
    cutting: {
      mdf: { feedRate: 3.937, plungeRate: 1.181, rpm: 12000, stepdown: 0.25, stepover: 0.1 },
    },
  },
  // TOOL 4 - Ball Nose Spiral EM 0.25"
  {
    geometry: {
      name: '0.25" BN Spiral EM',
      atcSlot: 4,
      type: ToolType.EndMill,
      diameter: 0.25,
      tipRadius: 0,
      halfAngle: 0,
      flutes: 2,
    },
    cutting: {
      general: { feedRate: 3.333, plungeRate: 1.0, rpm: 18000, stepdown: 0.125, stepover: 0.10 },
    },
  },
  // TOOL 4 - 3/8" Radiused EM (BN tip 3/16")
  {
    geometry: {
      name: '3/8" Radiused EM',
      atcSlot: 4,
      type: ToolType.Radiused,
      diameter: 0.375,
      tipRadius: 0.1875,
      halfAngle: 0,
      flutes: 2,
    },
    cutting: {
      general: { feedRate: 2.0, plungeRate: 1.0, rpm: 18000, stepdown: 0.1875, stepover: 0.15 },
    },
  },
  // TOOL 5 - 1/4" Spiral Ball Nose
  {
    geometry: {
      name: '1/4" Spiral BN',
      atcSlot: 5,
      type: ToolType.BallNose,
      diameter: 0.25,
      tipRadius: 0.125,
      halfAngle: 0,
      flutes: 2,
    },
    cutting: {
      general:  { feedRate: 3.5, plungeRate: 1.0, rpm: 18000, stepdown: 0.125, stepover: 0.10 },
      hardwood: { feedRate: 2.0, plungeRate: 1.0, rpm: 16000, stepdown: 0.1,   stepover: 0.075 },
    },
  },
  // TOOL 5 - 3/8" Straight Ball Nose S1/4
  {
    geometry: {
      name: '3/8" Straight BN',
      atcSlot: 5,
      type: ToolType.BallNose,
      diameter: 0.375,
      tipRadius: 0.1875,
      halfAngle: 0,
      flutes: 2,
    },
    cutting: {
      general:  { feedRate: 2.0, plungeRate: 0.7, rpm: 14000, stepdown: 0.1875, stepover: 0.0375 },
      hardwood: { feedRate: 2.0, plungeRate: 0.7, rpm: 14000, stepdown: 0.1875, stepover: 0.0375 },
    },
  },
  // TOOL 6 - 1/8" Spiral Upcut EM
  {
    geometry: {
      name: '1/8" Spiral Upcut EM',
      atcSlot: 6,
      type: ToolType.EndMill,
      diameter: 0.125,
      tipRadius: 0,
      halfAngle: 0,
      flutes: 2,
    },
    cutting: {
      general:  { feedRate: 3.0, plungeRate: 1.25, rpm: 18000, stepdown: 0.0625, stepover: 0.0625 },
      mdf:      { feedRate: 3.0, plungeRate: 1.25, rpm: 18000, stepdown: 0.0625, stepover: 0.0625 },
    },
  },
  // TOOL 6 - 1/4" O-Flute EM
  {
    geometry: {
      name: '1/4" O-Flute EM',
      atcSlot: 6,
      type: ToolType.EndMill,
      diameter: 0.25,
      tipRadius: 0,
      halfAngle: 0,
      flutes: 1,
    },
    cutting: {
      general:  { feedRate: 1.667, plungeRate: 0.7, rpm: 18000, stepdown: 0.125, stepover: 0.125 },
      hardwood: { feedRate: 1.667, plungeRate: 0.7, rpm: 18000, stepdown: 0.125, stepover: 0.125 },
    },
  },
  // TOOL 7 - TBN R1/32-S1/4
  {
    geometry: {
      name: 'TBN R1/32-S1/4',
      atcSlot: 7,
      type: ToolType.TaperedBallNose,
      diameter: 0.0625,
      tipRadius: 0.03125,
      halfAngle: (3.578 / 2) * DEG_TO_RAD,
      flutes: 2,
    },
    cutting: {
      general:  { feedRate: 1.5, plungeRate: 0.8, rpm: 16000, stepdown: 0.0125, stepover: 0.0156 },
      hardwood: { feedRate: 1.5, plungeRate: 0.8, rpm: 16000, stepdown: 0.0125, stepover: 0.0156 },
    },
  },
  // TOOL 7 - TBN R1/16-S1/4 (default finishing)
  {
    geometry: {
      name: 'TBN R1/16-S1/4',
      atcSlot: 7,
      type: ToolType.TaperedBallNose,
      diameter: 0.125,
      tipRadius: 0.0625,
      halfAngle: (7.1526 / 2) * DEG_TO_RAD,
      flutes: 2,
    },
    cutting: {
      general:  { feedRate: 1.5, plungeRate: 0.8, rpm: 16000, stepdown: 0.0125, stepover: 0.0156 },
      hardwood: { feedRate: 1.5, plungeRate: 0.8, rpm: 16000, stepdown: 0.0125, stepover: 0.0156 },
    },
  },
  // TOOL 7 - TBN R0.25-S1/16
  {
    geometry: {
      name: 'TBN R0.25-S1/16',
      atcSlot: 7,
      type: ToolType.TaperedBallNose,
      diameter: 0.0098,
      tipRadius: 0.0049,
      halfAngle: (0.955 / 2) * DEG_TO_RAD,
      flutes: 2,
    },
    cutting: {
      general: { feedRate: 1.5, plungeRate: 0.8, rpm: 16000, stepdown: 0.001, stepover: 0.0012152 },
    },
  },
  // TOOL 7 - TBN R0.5-S1/16
  {
    geometry: {
      name: 'TBN R0.5-S1/16',
      atcSlot: 7,
      type: ToolType.TaperedBallNose,
      diameter: 0.0197,
      tipRadius: 0.0098,
      halfAngle: (1.9096 / 2) * DEG_TO_RAD,
      flutes: 2,
    },
    cutting: {
      general: { feedRate: 1.5, plungeRate: 0.8, rpm: 16000, stepdown: 0.002, stepover: 0.0024304 },
    },
  },
  // TOOL 7 - TBN R0.75-S1/16
  {
    geometry: {
      name: 'TBN R0.75-S1/16',
      atcSlot: 7,
      type: ToolType.TaperedBallNose,
      diameter: 0.0295,
      tipRadius: 0.0148,
      halfAngle: (2.8 / 2) * DEG_TO_RAD,
      flutes: 2,
    },
    cutting: {
      general: { feedRate: 1.5, plungeRate: 0.8, rpm: 16000, stepdown: 0.003, stepover: 0.00296 },
    },
  },
  // TOOL 7 - TBN R1.0-S1/16
  {
    geometry: {
      name: 'TBN R1.0-S1/16',
      atcSlot: 7,
      type: ToolType.TaperedBallNose,
      diameter: 0.0394,
      tipRadius: 0.0197,
      halfAngle: (3.8 / 2) * DEG_TO_RAD,
      flutes: 2,
    },
    cutting: {
      general: { feedRate: 1.5, plungeRate: 0.8, rpm: 16000, stepdown: 0.004, stepover: 0.0049 },
    },
  },
];

/** Find the best cutting params for a tool+material combo */
function resolveCutting(tool: EmbeddedTool, profile: MaterialProfile): CuttingParams {
  return tool.cutting[profile]
    ?? tool.cutting.general
    ?? Object.values(tool.cutting)[0]!;
}

/** Resolve a ToolDef from embedded data */
function toToolDef(tool: EmbeddedTool, profile: MaterialProfile): ToolDef {
  const { geometry } = tool;
  return {
    name: geometry.name,
    atcSlot: geometry.atcSlot,
    type: geometry.type,
    diameter: geometry.diameter,
    tipRadius: geometry.tipRadius,
    halfAngle: geometry.halfAngle,
    flutes: geometry.flutes,
    cutting: resolveCutting(tool, profile),
  };
}

/** Get all embedded tools resolved for a material profile */
export function getEmbeddedTools(profile: MaterialProfile = 'general'): ToolDef[] {
  return EMBEDDED_TOOLS.map(t => toToolDef(t, profile));
}

/** Find a tool by name substring (case-insensitive) */
export function findToolByName(tools: ToolDef[], pattern: string): ToolDef | undefined {
  const lower = pattern.toLowerCase();
  return tools.find(t => t.name.toLowerCase().includes(lower));
}

/** Find a tool by ATC slot number */
export function findToolBySlot(tools: ToolDef[], slot: number): ToolDef | undefined {
  return tools.find(t => t.atcSlot === slot);
}

/** Default roughing tool: TOOL 3 Chipbreaker (flat EM per ShopBot guidance) */
export function getDefaultRoughingTool(profile: MaterialProfile = 'general'): ToolDef {
  const tools = getEmbeddedTools(profile);
  return findToolByName(tools, 'Chipbreaker')!;
}

/** Default finishing tool: TOOL 7 TBN R1/16-S1/4 */
export function getDefaultFinishingTool(profile: MaterialProfile = 'general'): ToolDef {
  const tools = getEmbeddedTools(profile);
  return findToolByName(tools, 'R1/16-S1/4')!;
}

/** Build default SBP config */
export function getDefaultConfig(profile: MaterialProfile = 'general'): SbpConfig {
  return {
    materialX: 10,
    materialY: 6,
    materialZ: 1.5,
    safeZ: 1.6,
    homeZ: 2.3,
    offsetX: 2.0,
    offsetY: 2.0,
    roughingTool: getDefaultRoughingTool(profile),
    finishingTool: getDefaultFinishingTool(profile),
    roughingEnabled: true,
    finishingEnabled: true,
    leaveStock: 0.02,
    finishRasterAngle: 45,
    materialProfile: profile,
  };
}
