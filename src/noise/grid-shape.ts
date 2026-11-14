/** Largest grid any generation path builds (2048 squared). Thin boards at high resolution would
 * otherwise reach 25M nodes and gigabytes of memory, which kills a phone tab. */
export const MAX_GRID_NODES = 4_194_304;

/** Keep the producer's represented arithmetic: aspect division precedes column scaling. */
export function noiseGridShape(resolution: number, meshX: number, meshY: number): {cols: number; rows: number} {
  let cols = Math.max(2, resolution);
  let rows = Math.max(4, Math.round(cols * (meshY / meshX)));
  if (cols * rows > MAX_GRID_NODES) {
    // Only extreme aspect ratios reach this; shrink columns so the aspect is kept within the cap.
    cols = Math.max(2, Math.floor(Math.sqrt(MAX_GRID_NODES * (meshX / meshY))));
    rows = Math.max(4, Math.round(cols * (meshY / meshX)));
    while (cols > 2 && cols * rows > MAX_GRID_NODES) { cols--; rows = Math.max(4, Math.round(cols * (meshY / meshX))); }
  }
  return {cols, rows};
}
