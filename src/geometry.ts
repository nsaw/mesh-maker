/** Shortest-diagonal quad split: returns true when z00-z11 diagonal has smaller
 *  Z-difference than z10-z01, meaning callers should split along z00-z11.
 *  z00=(j,i)  z10=(j,i+1)  z01=(j+1,i)  z11=(j+1,i+1) */
export function preferZ00Z11Diagonal(z00: number, z10: number, z01: number, z11: number): boolean {
  return Math.abs(z00 - z11) < Math.abs(z10 - z01);
}

/** Returns the two triangles for a grid cell as flat index offsets from the
 *  cell's top-left corner (0 = (j,i), 1 = (j,i+1), cols = (j+1,i), cols+1 = (j+1,i+1)).
 *  CCW winding for +Z upward normals. */
export function cellTriangleOffsets(
  useZ00Z11: boolean, cols: number,
): [[number, number, number], [number, number, number]] {
  return useZ00Z11
    ? [[0, 1, cols + 1], [0, cols + 1, cols]]
    : [[0, 1, cols], [1, cols + 1, cols]];
}

/** Find min and max values in a 2D grid. */
export function gridMinMax(grid: number[][], rows: number, cols: number): [number, number] {
  let min = Infinity, max = -Infinity;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (grid[j][i] < min) min = grid[j][i];
      if (grid[j][i] > max) max = grid[j][i];
    }
  return [min, max];
}

/** Emit watertight enclosure triangles (bottom face + 4 side walls) via callback.
 *  Winding produces outward-facing normals on all faces.
 *  topBase/botBase are flat index offsets for top and bottom vertex arrays. */
export function emitWatertightTriangles(
  cols: number, rows: number, topBase: number, botBase: number,
  emit: (a: number, b: number, c: number) => void,
): void {
  // Bottom face (normal points -Z)
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < cols - 1; i++) {
      const a = botBase + j * cols + i;
      emit(a, a + cols, a + 1);
      emit(a + 1, a + cols, a + cols + 1);
    }
  // Front wall (j=0, normal points -Y)
  for (let i = 0; i < cols - 1; i++) {
    const tl = topBase + i, bl = botBase + i;
    emit(tl, bl, tl + 1);
    emit(tl + 1, bl, bl + 1);
  }
  // Back wall (j=rows-1, normal points +Y)
  for (let i = 0; i < cols - 1; i++) {
    const tl = topBase + (rows - 1) * cols + i, bl = botBase + (rows - 1) * cols + i;
    emit(tl, tl + 1, bl);
    emit(tl + 1, bl + 1, bl);
  }
  // Left wall (i=0, normal points -X)
  for (let j = 0; j < rows - 1; j++) {
    const tt = topBase + j * cols, bt = botBase + j * cols;
    emit(tt, tt + cols, bt);
    emit(tt + cols, bt + cols, bt);
  }
  // Right wall (i=cols-1, normal points +X)
  for (let j = 0; j < rows - 1; j++) {
    const tt = topBase + j * cols + (cols - 1), bt = botBase + j * cols + (cols - 1);
    emit(tt, bt, tt + cols);
    emit(tt + cols, bt, bt + cols);
  }
}

/** Weighted 3x3 kernel smoothing (center 4, edge 2, corner 1), `iterations` passes at
 *  `strength` lerp. Shared by the noise pipeline (mesh.ts) and the drape compositor
 *  (drape.ts) — lives here so drape.ts never has to import mesh.ts (no import cycle). */
export function weightedSmooth(verts: number[][], rows: number, cols: number, iterations: number, strength: number): number[][] {
  let sm = verts;
  for (let iter = 0; iter < iterations; iter++) {
    const nv: number[][] = [];
    for (let j = 0; j < rows; j++) {
      nv[j] = [];
      for (let i = 0; i < cols; i++) {
        let ws = 0, tw = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const nj = j + dj, ni = i + di;
          if (nj >= 0 && nj < rows && ni >= 0 && ni < cols) {
            const w = (dj === 0 && di === 0) ? 4 : (dj === 0 || di === 0) ? 2 : 1;
            ws += sm[nj][ni] * w; tw += w;
          }
        }
        nv[j][i] = sm[j][i] * (1 - strength) + (ws / tw) * strength;
      }
    }
    sm = nv;
  }
  return sm;
}
