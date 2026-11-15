/** Largest grid any noise generation builds (2048 squared). Thin boards at high resolution would
 * otherwise reach 25M nodes and gigabytes of memory, which kills a phone tab. */
export const MAX_GRID_NODES = 4_194_304;

/** Keep the producer's represented arithmetic: aspect division precedes column scaling. */
export function noiseGridShape(resolution: number, meshX: number, meshY: number): {cols: number; rows: number} {
  const cols = Math.max(2, resolution);
  return {cols, rows: Math.max(4, Math.round(cols * (meshY / meshX)))};
}
