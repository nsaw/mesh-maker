import { STATE } from './state';
import { setCameraFromState } from './render';

export function zoomExtents(): void {
  if (!STATE.vertices) return;
  const { meshX, meshY, vertices, rows, cols } = STATE;
  let zMin = Infinity, zMax = -Infinity;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const z = vertices[j][i];
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  const halfW = meshX / 2, halfH = meshY / 2, halfZ = (zMax - zMin) / 2;
  const radius = Math.sqrt(halfW * halfW + halfH * halfH + halfZ * halfZ);

  const fov = Math.PI / 3;
  const fitDist = radius / Math.tan(fov / 2);
  const targetZoom = Math.max(meshX, meshY) * 1.2 / fitDist;

  STATE.zoom = Math.max(0.1, Math.min(10, targetZoom * 0.85));
  STATE.panX = 0; STATE.panY = 0;
  STATE.orbit = 45; STATE.tilt = -30;

  ['orbit','tilt','zoom'].forEach(k => {
    const sl = document.getElementById('sl_' + k) as HTMLInputElement | null;
    const val = document.getElementById('val_' + k);
    const v = STATE[k as keyof typeof STATE] as number;
    if (sl) sl.value = String(v);
    if (val) val.textContent = typeof v === 'number' ?
      (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);
  });

  setCameraFromState();
}

export function updateStats(): void {
  const el = document.getElementById('statsOverlay')!;
  if (!STATE.vertices) { el.textContent = ''; return; }
  const { cols, rows, genTime, watertight } = STATE;

  // Build stats overlay via DOM methods -- all values are numeric STATE properties (safe)
  el.textContent = '';

  let statData: [string, string][];

  if (STATE.exportFormat === 'sbp') {
    if (!STATE.sbpStats) {
      return;
    }
    statData = [
      ['Grid', `${STATE.sbpStats.heightmapCols} x ${STATE.sbpStats.heightmapRows}`],
      ['Roughing', STATE.sbpStats.roughingMoves.toLocaleString()],
      ['Finishing', STATE.sbpStats.finishingMoves.toLocaleString()],
      ['SBP Lines', STATE.sbpStats.totalLines.toLocaleString()],
    ];
  } else {
    const topTris = (cols-1) * (rows-1) * 2;
    const sideTris = watertight ? ((cols-1)*4 + (rows-1)*4) : 0;
    const bottomTris = watertight ? topTris : 0;
    const totalTris = topTris + bottomTris + sideTris;
    const verts = cols * rows * (watertight ? 2 : 1);
    const estSize = STATE.binary ? (84 + totalTris * 50) : (totalTris * 200);
    statData = [
      ['Vertices', verts.toLocaleString()],
      ['Triangles', totalTris.toLocaleString()],
      ['Gen time', `${genTime.toFixed(0)}ms`],
      ['Est. size', formatBytes(estSize)],
    ];
  }

  for (const [label, value] of statData) {
    const row = document.createElement('div');
    row.className = 'stat-row';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    const valSpan = document.createElement('span');
    valSpan.className = 'stat-val';
    valSpan.textContent = value;
    row.appendChild(labelSpan);
    row.appendChild(valSpan);
    el.appendChild(row);
  }

  if (STATE.resolution > 256) {
    const warnRow = document.createElement('div');
    warnRow.className = 'stat-row';
    const warnLabel = document.createElement('span');
    warnLabel.textContent = 'Note';
    const warnVal = document.createElement('span');
    warnVal.className = 'stat-warn';
    warnVal.textContent = 'May be slow. Crank up resolution before exporting for a smooth carve; use ≤256 while modeling for easier tweaking.';
    warnRow.appendChild(warnLabel);
    warnRow.appendChild(warnVal);
    el.appendChild(warnRow);
  }
}

export function formatBytes(b: number): string {
  if (b < 1024) return b + 'B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + 'KB';
  return (b/1024/1024).toFixed(1) + 'MB';
}
