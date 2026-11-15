import { buildWireBuffers, type WireBuffers } from './render-geometry';

export interface WireWorkerInput {
  positions: Float32Array;
  heights: Float64Array;
  cols: number;
  rows: number;
  zMin: number;
  zRange: number;
}
export type WireWorkerOutput = { buffers: WireBuffers } | { error: string };
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<WireWorkerInput>) => void) | null;
  postMessage(value: WireWorkerOutput, transfer: ArrayBuffer[]): void;
};
ctx.onmessage = ({ data }) => {
  try {
    const buffers = buildWireBuffers(data.positions, data.heights, data.cols, data.rows, data.zMin, data.zRange);
    ctx.postMessage({ buffers }, [buffers.positions.buffer as ArrayBuffer, buffers.colors.buffer as ArrayBuffer]);
  } catch (error: unknown) {
    ctx.postMessage({ error: error instanceof Error ? error.message : String(error) }, []);
  }
};
