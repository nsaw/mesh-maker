/// <reference lib="webworker" />

import { parseSTLBinary } from './stl-parser';
import { meshToHeightmap } from './heightmap';
import { generateSBP } from './generate';
import type { SbpConfig } from './types';
import type { SbpStats } from './types';

interface WorkerInput {
  stlBuffer: ArrayBuffer;
  config: SbpConfig;
  resolution: number;
}

type WorkerOutput =
  | { type: 'success'; sbpBytes: ArrayBuffer; stats: SbpStats; stlBuffer: ArrayBuffer }
  | { type: 'error'; message: string; stlBuffer: ArrayBuffer };

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const { stlBuffer, config, resolution } = e.data;
  try {
    const { data, count, bounds } = parseSTLBinary(stlBuffer);
    const heightmap = meshToHeightmap(data, count, bounds, resolution);
    config.materialX = heightmap.meshX;
    config.materialY = heightmap.meshY;
    const result = generateSBP(heightmap, config);
    const sbpBytes = new TextEncoder().encode(result.sbp);
    const output: WorkerOutput = {
      type: 'success',
      sbpBytes: sbpBytes.buffer,
      stats: result.stats,
      stlBuffer,
    };
    self.postMessage(output, [sbpBytes.buffer, stlBuffer]);
  } catch (err) {
    const output: WorkerOutput = {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      stlBuffer,
    };
    self.postMessage(output, [stlBuffer]);
  }
};
