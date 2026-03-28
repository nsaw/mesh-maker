import { STATE } from './state';

let _canvasW = 0;
let _canvasH = 0;

export function resizeCanvas(): void {
  const canvas = document.getElementById('viewport') as HTMLCanvasElement;
  const wrap = document.getElementById('canvasWrap')!;
  const dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (_canvasW !== w || _canvasH !== h) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    _canvasW = w; _canvasH = h;
  }
}

export function resetCanvasSize(): void {
  _canvasW = 0;
  _canvasH = 0;
}

export function renderViewport(): void {
  const canvas = document.getElementById('viewport') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const wrap = document.getElementById('canvasWrap')!;
  const dpr = window.devicePixelRatio || 1;
  const W = wrap.clientWidth, H = wrap.clientHeight;

  resizeCanvas();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = '#141418';
  ctx.fillRect(0, 0, W, H);

  if (!STATE.vertices) {
    updateDimsOverlay();
    return;
  }

  const { vertices, cols, rows, meshX, meshY, orbit, tilt, roll, zoom, viewMode, panX, panY } = STATE;
  const rotRad = orbit * Math.PI / 180;
  const tiltRad = tilt * Math.PI / 180;
  const rollRad = roll * Math.PI / 180;
  const cx = W / 2 + (panX || 0), cy = H / 2 + (panY || 0);
  const fov = Math.PI / 3;
  const projScale = (H / 2) / Math.tan(fov / 2);
  const camDist = Math.max(meshX, meshY) * 1.2 / zoom;

  let zMin = Infinity, zMax = -Infinity;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (vertices[j][i] < zMin) zMin = vertices[j][i];
    if (vertices[j][i] > zMax) zMax = vertices[j][i];
  }
  const zBase = STATE.watertight ? -STATE.baseThickness : 0;
  const zMid = (Math.min(zMin, zBase) + zMax) / 2;

  function project(x: number, y: number, z: number) {
    const mx = x - meshX / 2, my = y - meshY / 2, mz = z - zMid;
    const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad);
    const rx = mx * cosR - mz * sinR, rz = mx * sinR + mz * cosR;
    const cosT = Math.cos(tiltRad), sinT = Math.sin(tiltRad);
    const ty = my * cosT - rz * sinT, tz = my * sinT + rz * cosT;
    const cosS = Math.cos(rollRad), sinS = Math.sin(rollRad);
    const sx = rx * cosS - ty * sinS, sy = rx * sinS + ty * cosS;
    const cz = tz + camDist;
    if (cz < 0.1) return { x: cx, y: cy, z: 0.1 };
    return { x: cx + (sx * projScale) / cz, y: cy + (sy * projScale) / cz, z: cz };
  }

  const proj: { x: number; y: number; z: number }[][] = [];
  for (let j = 0; j < rows; j++) {
    proj[j] = [];
    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1), v = j / (rows - 1);
      proj[j][i] = project(u * meshX, v * meshY, vertices[j][i]);
    }
  }

  const zRange = zMax - zMin || 1;

  if (viewMode === 'solid' || viewMode === 'both') {
    const zBaseLocal = -STATE.baseThickness;

    const lightDir = { x: -0.4, y: -0.5, z: 0.75 };
    const lLen = Math.sqrt(lightDir.x*lightDir.x + lightDir.y*lightDir.y + lightDir.z*lightDir.z);
    lightDir.x /= lLen; lightDir.y /= lLen; lightDir.z /= lLen;
    const dxW = meshX / (cols - 1);
    const dyW = meshY / (rows - 1);

    if (STATE.watertight && STATE.baseThickness > 0) {
      const encFaces: { pts: { x: number; y: number; z: number }[]; avgZ: number; color: string }[] = [];
      const step = Math.max(1, Math.floor(cols / 48));

      for (let j = 0; j < rows - 1; j += step) {
        const jn = Math.min(j + step, rows - 1);
        for (let i = 0; i < cols - 1; i += step) {
          const in2 = Math.min(i + step, cols - 1);
          const b1 = project((i/(cols-1))*meshX, (j/(rows-1))*meshY, zBaseLocal);
          const b2 = project((in2/(cols-1))*meshX, (j/(rows-1))*meshY, zBaseLocal);
          const b3 = project((i/(cols-1))*meshX, (jn/(rows-1))*meshY, zBaseLocal);
          const b4 = project((in2/(cols-1))*meshX, (jn/(rows-1))*meshY, zBaseLocal);
          encFaces.push({ pts: [b1, b3, b4, b2], avgZ: (b1.z+b2.z+b3.z+b4.z)/4, color: '#1a2030' });
        }
      }
      const sideColor = '#253045';
      for (let i = 0; i < cols - 1; i += step) {
        const in2 = Math.min(i + step, cols - 1);
        let t1, t2, b1, b2;
        t1 = proj[0][i]; t2 = proj[0][in2];
        b1 = project((i/(cols-1))*meshX, 0, zBaseLocal); b2 = project((in2/(cols-1))*meshX, 0, zBaseLocal);
        encFaces.push({ pts: [t1, t2, b2, b1], avgZ: (t1.z+t2.z+b1.z+b2.z)/4, color: sideColor });
        t1 = proj[rows-1][i]; t2 = proj[rows-1][in2];
        b1 = project((i/(cols-1))*meshX, meshY, zBaseLocal); b2 = project((in2/(cols-1))*meshX, meshY, zBaseLocal);
        encFaces.push({ pts: [t1, b1, b2, t2], avgZ: (t1.z+t2.z+b1.z+b2.z)/4, color: sideColor });
      }
      for (let j = 0; j < rows - 1; j += step) {
        const jn = Math.min(j + step, rows - 1);
        let t1, t2, b1, b2;
        t1 = proj[j][0]; t2 = proj[jn][0];
        b1 = project(0, (j/(rows-1))*meshY, zBaseLocal); b2 = project(0, (jn/(rows-1))*meshY, zBaseLocal);
        encFaces.push({ pts: [t1, b1, b2, t2], avgZ: (t1.z+t2.z+b1.z+b2.z)/4, color: sideColor });
        t1 = proj[j][cols-1]; t2 = proj[jn][cols-1];
        b1 = project(meshX, (j/(rows-1))*meshY, zBaseLocal); b2 = project(meshX, (jn/(rows-1))*meshY, zBaseLocal);
        encFaces.push({ pts: [t1, t2, b2, b1], avgZ: (t1.z+t2.z+b1.z+b2.z)/4, color: sideColor });
      }
      encFaces.sort((a, b) => b.avgZ - a.avgZ);
      for (const f of encFaces) {
        ctx.fillStyle = f.color;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(f.pts[0].x, f.pts[0].y);
        for (let k = 1; k < f.pts.length; k++) ctx.lineTo(f.pts[k].x, f.pts[k].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(78,170,255,0.12)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    const faceNx: number[][] = [], faceNy: number[][] = [], faceNz: number[][] = [];
    for (let j = 0; j < rows - 1; j++) {
      faceNx[j] = []; faceNy[j] = []; faceNz[j] = [];
      for (let i = 0; i < cols - 1; i++) {
        const e1z = vertices[j][i+1] - vertices[j][i];
        const e2z = vertices[j+1][i] - vertices[j][i];
        const nx = -e1z * dyW, ny = -e2z * dxW, nz = dxW * dyW;
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
        faceNx[j][i] = nx / len;
        faceNy[j][i] = ny / len;
        faceNz[j][i] = nz / len;
      }
    }

    const vtxShade: number[][] = [];
    for (let j = 0; j < rows; j++) {
      vtxShade[j] = [];
      for (let i = 0; i < cols; i++) {
        let nx = 0, ny = 0, nz = 0, count = 0;
        if (j > 0 && i > 0)         { nx += faceNx[j-1][i-1]; ny += faceNy[j-1][i-1]; nz += faceNz[j-1][i-1]; count++; }
        if (j > 0 && i < cols - 1)  { nx += faceNx[j-1][i];   ny += faceNy[j-1][i];   nz += faceNz[j-1][i];   count++; }
        if (j < rows - 1 && i > 0)  { nx += faceNx[j][i-1];   ny += faceNy[j][i-1];   nz += faceNz[j][i-1];   count++; }
        if (j < rows - 1 && i < cols - 1) { nx += faceNx[j][i]; ny += faceNy[j][i]; nz += faceNz[j][i]; count++; }
        if (count > 0) { nx /= count; ny /= count; nz /= count; }
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
        nx /= len; ny /= len; nz /= len;
        const diffuse = Math.max(0, nx*lightDir.x + ny*lightDir.y + nz*lightDir.z);
        vtxShade[j][i] = 0.12 + 0.88 * diffuse;
      }
    }

    const vtxColor: number[][][] = [];
    for (let j = 0; j < rows; j++) {
      vtxColor[j] = [];
      for (let i = 0; i < cols; i++) {
        const t = Math.max(0, Math.min(1, (vertices[j][i] - zMin) / zRange));
        const s = vtxShade[j][i];
        vtxColor[j][i] = [
          Math.floor((40 + t * 180) * s),
          Math.floor((50 + t * 190) * s),
          Math.floor((70 + t * 185) * s)
        ];
      }
    }

    const rowOrder: { j: number; z: number }[] = [];
    for (let j = 0; j < rows - 1; j++) {
      const midI = Math.floor(cols / 2);
      rowOrder.push({ j, z: (proj[j][midI].z + proj[j+1][midI].z) / 2 });
    }
    rowOrder.sort((a, b) => b.z - a.z);
    const colOrderLR = proj[0][0].z > proj[0][cols-1].z;

    for (const { j } of rowOrder) {
      const iStart = colOrderLR ? 0 : cols - 2;
      const iEnd = colOrderLR ? cols - 1 : -1;
      const iStep = colOrderLR ? 1 : -1;

      for (let i = iStart; i !== iEnd; i += iStep) {
        const p1 = proj[j][i], p2 = proj[j][i+1], p3 = proj[j+1][i], p4 = proj[j+1][i+1];
        const c1 = vtxColor[j][i], c2 = vtxColor[j][i+1], c3 = vtxColor[j+1][i], c4 = vtxColor[j+1][i+1];

        const r = (c1[0] + c2[0] + c3[0] + c4[0]) >> 2;
        const g = (c1[1] + c2[1] + c3[1] + c4[1]) >> 2;
        const bl = (c1[2] + c2[2] + c3[2] + c4[2]) >> 2;
        const fillColor = `rgb(${r},${g},${bl})`;

        ctx.fillStyle = fillColor;
        ctx.strokeStyle = fillColor;
        ctx.lineJoin = 'round';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  if (viewMode === 'wireframe' || viewMode === 'both') {
    ctx.lineWidth = 0.5;
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const p1 = proj[j][i], p2 = proj[j][i+1], p3 = proj[j+1][i];
        const t = Math.max(0, Math.min(1, (vertices[j][i] - zMin) / zRange));
        const g = Math.floor(40 + t * 120);
        ctx.strokeStyle = `rgb(${g},${g+15},${g+30})`;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.stroke();
      }
    }
    for (let j = 0; j < rows - 1; j++) {
      const i = cols - 1;
      ctx.beginPath();
      ctx.moveTo(proj[j][i].x, proj[j][i].y);
      ctx.lineTo(proj[j+1][i].x, proj[j+1][i].y);
      ctx.stroke();
    }
    for (let i = 0; i < cols - 1; i++) {
      const j = rows - 1;
      ctx.beginPath();
      ctx.moveTo(proj[j][i].x, proj[j][i].y);
      ctx.lineTo(proj[j][i+1].x, proj[j][i+1].y);
      ctx.stroke();
    }
  }

  if (viewMode === 'points') {
    const skip = Math.max(1, Math.floor(cols / 80));
    for (let j = 0; j < rows; j += skip) {
      for (let i = 0; i < cols; i += skip) {
        const p = proj[j][i];
        const t = Math.max(0, Math.min(1, (vertices[j][i] - zMin) / zRange));
        ctx.fillStyle = `rgba(78,170,255,${0.3 + t * 0.7})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  updateDimsOverlay();
}

export function updateDimsOverlay(): void {
  const el = document.getElementById('dimsOverlay')!;
  if (!STATE.vertices) { el.textContent = ''; return; }
  let zMin = Infinity, zMax = -Infinity;
  const { vertices, rows, cols } = STATE;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (vertices[j][i] < zMin) zMin = vertices[j][i];
    if (vertices[j][i] > zMax) zMax = vertices[j][i];
  }
  const totalZ = STATE.watertight
    ? Math.max(zMax, 0) + STATE.baseThickness
    : zMax - zMin;

  // Build overlay via DOM methods — all values are numeric STATE properties (safe)
  el.textContent = '';
  const spanDims = document.createElement('span');
  spanDims.textContent = `${STATE.meshX}" x ${STATE.meshY}"`;
  el.appendChild(spanDims);

  const spanZ = document.createElement('span');
  spanZ.style.marginLeft = '12px';
  spanZ.textContent = `Z: ${zMin.toFixed(2)}" to ${zMax.toFixed(2)}"`;
  el.appendChild(spanZ);

  const spanTotal = document.createElement('span');
  spanTotal.style.marginLeft = '12px';
  spanTotal.textContent = `Total: ${totalZ.toFixed(2)}"`;
  el.appendChild(spanTotal);

  if (totalZ > 6) {
    const spanWarn = document.createElement('span');
    spanWarn.className = 'cnc-warn';
    spanWarn.style.marginLeft = '8px';
    spanWarn.textContent = 'EXCEEDS 6" Z';
    el.appendChild(spanWarn);
  }
}
