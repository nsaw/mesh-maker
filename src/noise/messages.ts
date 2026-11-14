import type { NoiseSurface, NoiseSurfaceParams } from './surface';

export type GenerationQuality = 'preview' | 'full';
export interface NoiseWorkerInput { requestId: number; params: NoiseSurfaceParams }
export type PackedNoiseSurface = Omit<NoiseSurface, 'vertices'> & { heights: Float64Array };
export type NoiseWorkerOutput = { type: 'result'; requestId: number; surface: PackedNoiseSurface }
  | { type: 'error'; requestId: number; message: string };

export function packNoiseSurface(surface: NoiseSurface): PackedNoiseSurface {
  const { vertices, ...metadata } = surface;
  const heights = new Float64Array(surface.cols * surface.rows);
  for (let j = 0; j < surface.rows; j++) heights.set(vertices[j], j * surface.cols);
  return { ...metadata, heights };
}

export function unpackNoiseSurface(surface: PackedNoiseSurface): NoiseSurface {
  const { heights, ...metadata } = surface;
  if (heights.length !== surface.cols * surface.rows) throw new Error('Noise worker returned an incomplete surface');
  const vertices: number[][] = [];
  for (let j = 0; j < surface.rows; j++) vertices.push(Array.from(heights.subarray(j * surface.cols, (j + 1) * surface.cols)));
  return { ...metadata, vertices };
}
