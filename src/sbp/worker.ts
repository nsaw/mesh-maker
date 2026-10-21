/// <reference lib="webworker" />

import { parseSTLBinary } from './stl-parser';
import { meshToHeightmap } from './heightmap';
import { generateSBP } from './generate';
import type { Heightmap, SbpConfig, SbpStats } from './types';

/** An uploaded STL (rasterized here) or a ready heightmap (the current surface or relief master). */
export type SbpWorkerInput =
  | { kind: 'stl'; stlBuffer: ArrayBuffer; config: SbpConfig; resolution: number }
  | { kind: 'heightmap'; heightmap: Heightmap; config: SbpConfig };

/** `stlBuffer` is handed back so the page can export the same upload again. */
export type SbpWorkerOutput =
  | { type: 'success'; sbpBytes: ArrayBuffer; stats: SbpStats; stlBuffer?: ArrayBuffer }
  | { type: 'error'; message: string; stlBuffer?: ArrayBuffer };

self.onmessage = (e: MessageEvent<SbpWorkerInput>) => {
  const input = e.data;
  const stlBuffer = input.kind === 'stl' ? input.stlBuffer : undefined;
  const keep: ArrayBuffer[] = stlBuffer ? [stlBuffer] : [];
  try {
    let heightmap: Heightmap;
    let config: SbpConfig;
    if (input.kind === 'stl') {
      const { data, count, bounds } = parseSTLBinary(input.stlBuffer);
      heightmap = meshToHeightmap(data, count, bounds, input.resolution);
      config = { ...input.config, materialX: heightmap.meshX, materialY: heightmap.meshY };
    } else {
      heightmap = input.heightmap;
      config = input.config;
    }
    const result = generateSBP(heightmap, config);
    const sbpBytes = new TextEncoder().encode(result.sbp);
    const output: SbpWorkerOutput = { type: 'success', sbpBytes: sbpBytes.buffer, stats: result.stats, stlBuffer };
    self.postMessage(output, [sbpBytes.buffer, ...keep]);
  } catch (err) {
    const output: SbpWorkerOutput = { type: 'error', message: err instanceof Error ? err.message : String(err), stlBuffer };
    self.postMessage(output, keep);
  }
};
