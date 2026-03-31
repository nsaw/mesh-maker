import type { BoundingBox } from './types';

export interface ParsedSTL {
  /** Flat array: 12 floats per triangle (nx,ny,nz, v0x,v0y,v0z, v1x,v1y,v1z, v2x,v2y,v2z) */
  data: Float32Array;
  count: number;
  bounds: BoundingBox;
}

/**
 * Parse a binary STL file into a Float32Array + bounding box.
 * Single-pass DataView loop, no object allocation per triangle.
 * Validates: 80-byte header + 4-byte count + count*50 <= byteLength.
 */
export function parseSTLBinary(buffer: ArrayBuffer): ParsedSTL {
  const view = new DataView(buffer);

  if (buffer.byteLength < 84) {
    throw new Error(`STL too small: ${buffer.byteLength} bytes (minimum 84)`);
  }

  const count = view.getUint32(80, true);
  const expected = 80 + 4 + count * 50;

  if (count === 0) {
    throw new Error('STL contains zero triangles');
  }

  if (buffer.byteLength < expected) {
    throw new Error(
      `STL size mismatch: expected at least ${expected} bytes for ${count} triangles, got ${buffer.byteLength}`
    );
  }

  const data = new Float32Array(count * 12);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  let byteOffset = 84;
  let floatIdx = 0;

  for (let i = 0; i < count; i++) {
    // Normal (3 floats) + 3 vertices (9 floats) = 12 floats = 48 bytes
    for (let f = 0; f < 12; f++) {
      data[floatIdx + f] = view.getFloat32(byteOffset + f * 4, true);
    }

    // Track bounds from vertex data only (skip normal at indices 0-2)
    for (let v = 0; v < 3; v++) {
      const base = floatIdx + 3 + v * 3;
      const x = data[base];
      const y = data[base + 1];
      const z = data[base + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    byteOffset += 50; // 48 bytes data + 2 bytes attribute
    floatIdx += 12;
  }

  return {
    data,
    count,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
  };
}
