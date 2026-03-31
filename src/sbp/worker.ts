/// <reference lib="webworker" />

import { parseSTLBinary } from './stl-parser';
import { meshToHeightmap } from './heightmap';
import { generateSBP } from './generate';
import type { SbpConfig } from './types';
import type { GenerateResult } from './generate';

interface WorkerInput {
  stlBuffer: ArrayBuffer;
  config: SbpConfig;
  resolution: number;
}

type WorkerOutput =
  | { type: 'success'; sbp: string; stats: GenerateResult['stats'] }
  | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  try {
    const { stlBuffer, config, resolution } = e.data;
    const { data, count, bounds } = parseSTLBinary(stlBuffer);
    const heightmap = meshToHeightmap(data, count, bounds, resolution);
    config.materialX = heightmap.meshX;
    config.materialY = heightmap.meshY;
    const result = generateSBP(heightmap, config);
    const output: WorkerOutput = { type: 'success', sbp: result.sbp, stats: result.stats };
    self.postMessage(output);
  } catch (err) {
    const output: WorkerOutput = { type: 'error', message: err instanceof Error ? err.message : String(err) };
    self.postMessage(output);
  }
};
