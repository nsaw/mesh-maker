/** Tool geometry types matching Vectric vtdb schema */
export const enum ToolType {
  BallNose = 0,
  EndMill = 1,
  Radiused = 2,
  VBit = 3,
  TaperedBallNose = 5,
}

/** Cutting parameters for a specific material profile */
export interface CuttingParams {
  feedRate: number;    // inches per second
  plungeRate: number;  // inches per second
  rpm: number;
  stepdown: number;    // inches
  stepover: number;    // inches
}

/** Full tool definition with geometry and default cutting data */
export interface ToolDef {
  name: string;
  atcSlot: number;
  type: ToolType;
  diameter: number;       // inches
  tipRadius: number;      // inches (0 for flat, R for ball/TBN)
  halfAngle: number;      // radians (0 for straight tools, >0 for tapered/V)
  flutes: number;
  cutting: CuttingParams; // active cutting params (resolved from material profile)
}

export type MaterialProfile = 'general' | 'mdf' | 'hardwood';

/** Bounding box from STL parser */
export interface BoundingBox {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

/** Regular Z grid produced by heightmap rasterization */
export interface Heightmap {
  z: Float64Array;
  rows: number;
  cols: number;
  originX: number;
  originY: number;
  cellSize: number;      // inches per cell (1/resolution)
  meshX: number;         // physical X extent in inches
  meshY: number;         // physical Y extent in inches
}

/** SBP generation configuration */
export interface SbpConfig {
  materialX: number;      // stock width (inches)
  materialY: number;      // stock height (inches)
  materialZ: number;      // stock thickness (inches)
  safeZ: number;          // retract height (default 1.6)
  homeZ: number;          // home height (default 2.3)
  offsetX: number;        // workpiece X offset (default 2.0)
  offsetY: number;        // workpiece Y offset (default 2.0)
  roughingTool: ToolDef;
  finishingTool: ToolDef;
  roughingEnabled: boolean;
  finishingEnabled: boolean;
  leaveStock: number;     // roughing stock allowance (default 0.02)
  finishRasterAngle: number; // degrees (default 45)
  materialProfile: MaterialProfile;
}

/** Single toolpath move */
export interface ToolpathMove {
  type: 'rapid' | 'cut';
  x: number;
  y: number;
  z: number;
}

/** Named section of toolpath moves for one tool */
export interface ToolpathSection {
  name: string;
  tool: ToolDef;
  moves: ToolpathMove[];
}
