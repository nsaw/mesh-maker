export interface NoiseGenerator {
  noise(x: number, y: number): number;
}

export interface FBMGenerator extends NoiseGenerator {
  fbm(x: number, y: number, octaves: number, persistence: number, lacunarity: number): number;
}

export interface Vertex3D {
  x: number;
  y: number;
  z: number;
}

export type Triangle = [Vertex3D, Vertex3D, Vertex3D];

export interface MeshData {
  top: Vertex3D[][];
  cols: number;
  rows: number;
  meshX: number;
  meshY: number;
  baseThickness: number;
  watertight: boolean;
}
