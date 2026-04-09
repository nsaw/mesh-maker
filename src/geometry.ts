/** Shortest-diagonal quad split: returns true when z00-z11 diagonal has smaller
 *  Z-difference than z10-z01, meaning callers should split along z00-z11.
 *  z00=(j,i)  z10=(j,i+1)  z01=(j+1,i)  z11=(j+1,i+1) */
export function preferZ00Z11Diagonal(z00: number, z10: number, z01: number, z11: number): boolean {
  return Math.abs(z00 - z11) < Math.abs(z10 - z01);
}
