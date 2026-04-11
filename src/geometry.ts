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
