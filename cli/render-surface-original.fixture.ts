/** Frozen pre-extraction viewport arithmetic, copied from reviewed 405abf7:src/render.ts.
 * Only DOM/global assignments were removed and the master diagonal became an explicit argument. */
import { preferZ00Z11Diagonal, cellTriangleOffsets, gridMinMax } from '../src/geometry';

export function originalSurfaceBuffers(vertices: number[][], cols: number, rows: number,
  meshX: number, meshY: number, fixedDiagonal: boolean | null = null) {
  const positions = new Float32Array(rows * cols * 3);
  const uvs = new Float32Array(rows * cols * 2);

  const [zMin, zMax] = gridMinMax(vertices, rows, cols);
  const zRange = zMax - zMin || 1;

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      positions[idx * 3] = (i / (cols - 1)) * meshX;
      positions[idx * 3 + 1] = (j / (rows - 1)) * meshY;
      positions[idx * 3 + 2] = vertices[j][i];

      // UV: normalized Z maps to color ramp texture (per-pixel sampling = no banding)
      const t = Math.max(0, Math.min(1, (vertices[j][i] - zMin) / zRange));
      uvs[idx * 2] = t;
      uvs[idx * 2 + 1] = 0.5;

    }
  }

  // Indexed triangles (2 per quad, shortest-diagonal split)
  // A relief master declares its triangulation; draw the preview with it, as the export does.
  const indices = new Uint32Array((rows - 1) * (cols - 1) * 6);
  let ti = 0;
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const [t1, t2] = cellTriangleOffsets(fixedDiagonal ?? preferZ00Z11Diagonal(vertices[j][i], vertices[j][i+1], vertices[j+1][i], vertices[j+1][i+1]), cols);
      indices[ti++] = a + t1[0]; indices[ti++] = a + t1[1]; indices[ti++] = a + t1[2];
      indices[ti++] = a + t2[0]; indices[ti++] = a + t2[1]; indices[ti++] = a + t2[2];
    }

  // Analytical heightfield normals from central differences -- much smoother than
  // computeVertexNormals() which averages discrete face normals and creates visible
  // faceting seams on steep terrain.
  const normals = new Float32Array(rows * cols * 3);
  const sx = meshX / (cols - 1);
  const sy = meshY / (rows - 1);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const il = i > 0 ? i - 1 : i, ir = i < cols - 1 ? i + 1 : i;
      const jd = j > 0 ? j - 1 : j, ju = j < rows - 1 ? j + 1 : j;
      const dzdx = (vertices[j][ir] - vertices[j][il]) / ((ir - il) * sx);
      const dzdy = (vertices[ju][i] - vertices[jd][i]) / ((ju - jd) * sy);
      const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const idx = j * cols + i;
      normals[idx * 3] = -dzdx / len;
      normals[idx * 3 + 1] = -dzdy / len;
      normals[idx * 3 + 2] = 1 / len;
    }
  }

  return { positions, uvs, normals, indices, zMin, zMax, zRange };
}

export function originalWireBuffers(positions: Float32Array, vertices: number[][], cols: number, rows: number,
  zMin: number, zRange: number) {
  // Grid lines (horizontal + vertical, no triangle diagonals)
  const nSeg = rows * (cols - 1) + cols * (rows - 1);
  const wPos = new Float32Array(nSeg * 6);
  const wCol = new Float32Array(nSeg * 6);
  let w = 0;
  function pushWireVtx(wj: number, wi: number): void {
    const widx = wj * cols + wi;
    wPos[w] = positions[widx * 3]; wPos[w + 1] = positions[widx * 3 + 1]; wPos[w + 2] = positions[widx * 3 + 2];
    const vt = Math.max(0, Math.min(1, (vertices[wj][wi] - zMin) / zRange));
    const g = (40 + vt * 120) / 255;
    wCol[w] = g; wCol[w + 1] = g + 15 / 255; wCol[w + 2] = g + 30 / 255;
    w += 3;
  }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols - 1; i++) { pushWireVtx(j, i); pushWireVtx(j, i + 1); }
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows - 1; j++) { pushWireVtx(j, i); pushWireVtx(j + 1, i); }

  return { positions: wPos, colors: wCol };
}
