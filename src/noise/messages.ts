import type { NoiseSurface, NoiseSurfaceParams } from './surface';

export type GenerationQuality = 'preview' | 'full';
export interface NoiseWorkerInput { requestId: number; params: NoiseSurfaceParams; includeWire?: boolean }
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
  const prepared = metadata.renderBuffers;
  if (prepared && (prepared.cols !== surface.cols || prepared.rows !== surface.rows
    || prepared.positions.length !== heights.length * 3 || prepared.normals.length !== heights.length * 3
    || prepared.uvs.length !== heights.length * 2 || prepared.indices.length !== (surface.cols - 1) * (surface.rows - 1) * 6))
    throw new Error('Noise worker returned incomplete render buffers');
  if (prepared?.wire) {
    const count = (surface.rows * (surface.cols - 1) + surface.cols * (surface.rows - 1)) * 6;
    if (prepared.wire.positions.length !== count || prepared.wire.colors.length !== count)
      throw new Error('Noise worker returned incomplete wire buffers');
  }
  const vertices: number[][] = [];
  for (let j = 0; j < surface.rows; j++) vertices.push(Array.from(heights.subarray(j * surface.cols, (j + 1) * surface.cols)));
  return { ...metadata, vertices };
}
