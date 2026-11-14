/** Keep the producer's represented arithmetic: aspect division precedes column scaling. */
export function noiseGridShape(resolution: number, meshX: number, meshY: number): {cols: number; rows: number} {
  const cols = Math.max(2, resolution);
  return {cols, rows: Math.max(4, Math.round(cols * (meshY / meshX)))};
}
