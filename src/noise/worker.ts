import { buildSurfaceBuffers, buildWireBuffers } from '../render-geometry';
import { buildNoiseSurface } from './surface';
import { packNoiseSurface, type NoiseWorkerInput, type NoiseWorkerOutput } from './messages';

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<NoiseWorkerInput>) => void) | null;
  postMessage(message: NoiseWorkerOutput, transfer: ArrayBuffer[]): void;
};
ctx.onmessage = ({ data }) => {
  try {
    const built = buildNoiseSurface(data.params);
    const renderBuffers = buildSurfaceBuffers(built.vertices, built.cols, built.rows, data.params.meshX, data.params.meshY);
    const surface = packNoiseSurface({ ...built, renderBuffers });
    if (data.includeWire) renderBuffers.wire = buildWireBuffers(renderBuffers.positions, surface.heights,
      built.cols, built.rows, renderBuffers.zMin, renderBuffers.zRange);
    const transfer = [surface.heights.buffer as ArrayBuffer, renderBuffers.positions.buffer as ArrayBuffer,
      renderBuffers.normals.buffer as ArrayBuffer, renderBuffers.uvs.buffer as ArrayBuffer,
      renderBuffers.indices.buffer as ArrayBuffer];
    if (renderBuffers.wire) transfer.push(renderBuffers.wire.positions.buffer as ArrayBuffer, renderBuffers.wire.colors.buffer as ArrayBuffer);
    ctx.postMessage({ type: 'result', requestId: data.requestId, surface }, transfer);
  } catch (error: unknown) {
    ctx.postMessage({ type: 'error', requestId: data.requestId,
      message: error instanceof Error ? error.message : String(error) }, []);
  }
};
