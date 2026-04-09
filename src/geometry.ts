/** Shortest-diagonal heuristic: split quad along the diagonal with smaller Z-difference.
 *  z00=(j,i)  z10=(j,i+1)  z01=(j+1,i)  z11=(j+1,i+1)
 *  Returns true when the z00-z11 diagonal is shorter (all call sites use that diagonal in their true branch). */
export function useAlternateDiagonal(z00: number, z10: number, z01: number, z11: number): boolean {
  return Math.abs(z00 - z11) < Math.abs(z10 - z01);
}
