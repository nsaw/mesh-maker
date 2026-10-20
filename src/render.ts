import * as THREE from 'three';
import { STATE } from './state';
import { preferZ00Z11Diagonal, cellTriangleOffsets, gridMinMax } from './geometry';

// --- Module state ---
let _renderer: THREE.WebGLRenderer | null = null;
let _scene: THREE.Scene;
let _camera: THREE.PerspectiveCamera;
let _surfaceMesh: THREE.Mesh | null = null;
let _wireLines: THREE.LineSegments | null = null;
let _pointsObj: THREE.Points | null = null;
/** Inputs for the lazily built wireframe and points of the current surface. */
let _overlaySource: {
  positions: Float32Array; vertices: number[][]; cols: number; rows: number; zMin: number; zRange: number;
} | null = null;
let _encGroup: THREE.Group | null = null;
let _hemi: THREE.HemisphereLight | null = null;
let _keyLight: THREE.DirectionalLight | null = null;
let _fillLight: THREE.DirectionalLight | null = null;
let _gizmoScene: THREE.Scene;
let _gizmoCamera: THREE.OrthographicCamera;
let _needsRender = false;
let _rafPending = false;
let _prevW = 0;
let _prevH = 0;
let _lastVerticesRef: number[][] | null = null;
let _lastMeshX = 0;
let _lastMeshY = 0;
let _lastRows = 0;
let _lastCols = 0;
let _cachedZMin = 0;
let _cachedZMax = 0;
let _cachedZMid = 0;

const BG_COLOR = 0x141418;
const GIZMO_BG = 0x1e1e24;
const FOV = 60;

// --- Color ramp texture (sampled per-pixel for smooth Z-height gradient) ---

let _colorRampTexture: THREE.DataTexture | null = null;

function getColorRampTexture(): THREE.DataTexture {
  if (_colorRampTexture) return _colorRampTexture;

  const width = 512;
  const data = new Uint8Array(width * 4);

  // Blue -> teal -> white -> amber gradient (30-10-30-30% distribution)
  const stops = [
    { t: 0.00, r: 15, g: 50, b: 90 },
    { t: 0.15, r: 30, g: 80, b: 125 },
    { t: 0.30, r: 50, g: 130, b: 150 },
    { t: 0.40, r: 150, g: 200, b: 210 },
    { t: 0.50, r: 240, g: 240, b: 235 },
    { t: 0.70, r: 255, g: 210, b: 150 },
    { t: 1.00, r: 255, g: 170, b: 78 },
  ];

  for (let i = 0; i < width; i++) {
    const t = i / (width - 1);
    let lo = stops[0], hi = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s].t && t <= stops[s + 1].t) {
        lo = stops[s]; hi = stops[s + 1]; break;
      }
    }
    const f = (t - lo.t) / (hi.t - lo.t || 1);
    data[i * 4] = Math.round(lo.r + (hi.r - lo.r) * f);
    data[i * 4 + 1] = Math.round(lo.g + (hi.g - lo.g) * f);
    data[i * 4 + 2] = Math.round(lo.b + (hi.b - lo.b) * f);
    data[i * 4 + 3] = 255;
  }

  _colorRampTexture = new THREE.DataTexture(data, width, 1);
  _colorRampTexture.magFilter = THREE.LinearFilter;
  _colorRampTexture.minFilter = THREE.LinearFilter;
  _colorRampTexture.wrapS = THREE.ClampToEdgeWrapping;
  _colorRampTexture.needsUpdate = true;
  return _colorRampTexture;
}

// --- Initialization ---

function ensureRenderer(): void {
  if (_renderer) return;

  const canvas = document.getElementById('viewport') as HTMLCanvasElement;
  const wrap = document.getElementById('canvasWrap')!;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;

  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  _renderer.setPixelRatio(window.devicePixelRatio);
  _renderer.setSize(w, h);
  _renderer.setClearColor(BG_COLOR);
  _renderer.autoClear = false;

  _scene = new THREE.Scene();

  _camera = new THREE.PerspectiveCamera(FOV, w / h, 0.01, 2000);
  _camera.up.set(0, 0, 1); // Z-up for CNC

  // Lighting: hemisphere for natural ambient fill + key + fill directional (see applyLighting)
  _hemi = new THREE.HemisphereLight(0x8899bb, 0x445566, 0.35);
  _scene.add(_hemi);
  _keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
  _scene.add(_keyLight);
  _fillLight = new THREE.DirectionalLight(0x8899aa, 0.3);
  _scene.add(_fillLight);
  applyLighting();

  // Gizmo scene (AxesHelper + axis labels in scissored inset)
  _gizmoScene = new THREE.Scene();
  _gizmoScene.add(new THREE.AxesHelper(1));
  // Axis labels using sprite textures
  const labelAxes: [string, THREE.Color, THREE.Vector3][] = [
    ['X', new THREE.Color(0xff4444), new THREE.Vector3(1.3, 0, 0)],
    ['Y', new THREE.Color(0x44ff44), new THREE.Vector3(0, 1.3, 0)],
    ['Z', new THREE.Color(0x4488ff), new THREE.Vector3(0, 0, 1.3)],
  ];
  for (const [text, color, pos] of labelAxes) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = `#${color.getHexString()}`;
    ctx.fillText(text, 32, 32);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos);
    sprite.scale.set(0.5, 0.5, 1);
    _gizmoScene.add(sprite);
  }
  _gizmoCamera = new THREE.OrthographicCamera(-1.8, 1.8, 1.8, -1.8, 0.1, 10);

  setCameraFromState();

  _prevW = w;
  _prevH = h;
}

function doRender(): void {
  if (!_renderer) return;
  // Three.js setViewport/setScissor apply DPR internally (set via setPixelRatio).
  // Pass CSS pixel dimensions, NOT buffer pixels, to avoid double-multiplication.
  const w = _prevW;
  const h = _prevH;

  // Main scene
  _renderer.setViewport(0, 0, w, h);
  _renderer.setScissor(0, 0, w, h);
  _renderer.setScissorTest(true);
  _renderer.setClearColor(BG_COLOR);
  _renderer.clear();
  _renderer.render(_scene, _camera);

  // Gizmo inset (top-left corner, 80x80 CSS pixels)
  const gs = 80;
  const gx = 10;
  // WebGL origin is bottom-left; top-left corner in CSS coords
  const gy = h - gs - 10;

  // Position gizmo camera from orbit/tilt (no pan influence)
  const phi = Math.PI * (90 + STATE.tilt) / 180;
  const theta = STATE.orbit * Math.PI / 180;
  _gizmoCamera.position.set(
    3 * Math.sin(phi) * Math.cos(theta),
    3 * Math.sin(phi) * Math.sin(theta),
    3 * Math.cos(phi),
  );
  _gizmoCamera.up.copy(_camera.up);
  _gizmoCamera.lookAt(0, 0, 0);

  _renderer.setViewport(gx, gy, gs, gs);
  _renderer.setScissor(gx, gy, gs, gs);
  _renderer.setClearColor(GIZMO_BG);
  _renderer.clear(true, true, false);
  _renderer.render(_gizmoScene, _gizmoCamera);

  _renderer.setScissorTest(false);
}

// --- Camera ---

function getMeshCenter(): THREE.Vector3 {
  const meshX = STATE.meshX || 36;
  const meshY = STATE.meshY || 24;
  // When watertight, solid extends from z=0 (base) to zMax; center on full solid
  const zMid = STATE.watertight ? (_cachedZMax + 0) / 2 : _cachedZMid;
  return new THREE.Vector3(meshX / 2, meshY / 2, zMid);
}

export function setCameraFromState(): void {
  if (!_camera) return;

  const target = getMeshCenter();
  const meshMax = Math.max(STATE.meshX || 36, STATE.meshY || 24);
  const radius = meshMax * 1.2 / Math.max(STATE.zoom, 0.01);

  const phi = Math.PI * (90 + STATE.tilt) / 180;   // polar from Z-axis
  const theta = STATE.orbit * Math.PI / 180;        // azimuthal around Z

  // Camera position on sphere around target
  const camPos = new THREE.Vector3(
    target.x + radius * Math.sin(phi) * Math.cos(theta),
    target.y + radius * Math.sin(phi) * Math.sin(theta),
    target.z + radius * Math.cos(phi),
  );

  // Compute camera basis vectors (before roll)
  const forward = new THREE.Vector3().subVectors(target, camPos).normalize();
  const baseUp = new THREE.Vector3(0, 0, 1);
  const right = new THREE.Vector3().crossVectors(forward, baseUp).normalize();

  // Handle degenerate case (looking straight up/down along Z)
  if (right.lengthSq() < 0.001) {
    right.set(1, 0, 0);
  }
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  // Apply roll: rotate camera up vector around forward axis
  if (STATE.roll !== 0) {
    const rollRad = STATE.roll * Math.PI / 180;
    const q = new THREE.Quaternion().setFromAxisAngle(forward, rollRad);
    up.applyQuaternion(q);
  }

  // Apply screen-space pan: convert pixel offsets to world-space camera shifts
  if (STATE.panX !== 0 || STATE.panY !== 0) {
    const h = _prevH || 1;
    const fovRad = FOV * Math.PI / 180;
    const pixelScale = (2 * radius * Math.tan(fovRad / 2)) / h;
    // panX: negative because dragging right should shift view left (move camera right)
    const panShift = new THREE.Vector3()
      .addScaledVector(right, -STATE.panX * pixelScale)
      .addScaledVector(up, STATE.panY * pixelScale);
    camPos.add(panShift);
    target.add(panShift);
  }

  _camera.position.copy(camPos);
  _camera.up.copy(up);
  _camera.lookAt(target);

  requestRender();
}

/** Schedule a render on the next animation frame (on-demand, no permanent loop). */
export function requestRender(): void {
  _needsRender = true;
  if (!_rafPending) {
    _rafPending = true;
    requestAnimationFrame(() => {
      _rafPending = false;
      if (_needsRender) {
        _needsRender = false;
        doRender();
      }
    });
  }
}

// --- Geometry ---

function disposeGroup(obj: THREE.Object3D | null): void {
  if (!obj || !_scene) return;
  _scene.remove(obj);
  obj.traverse(child => {
    if ('geometry' in child && child.geometry)
      (child.geometry as THREE.BufferGeometry).dispose();
    if ('material' in child && child.material) {
      const mat = child.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else (mat as THREE.Material).dispose();
    }
  });
}

// Warm white, close to Carrara marble under the scene lights: shading alone carries the form.
const NEUTRAL_SURFACE_COLOR = 0xe8e2d6;

/** Surface material for the current STATE.viewMaterial. 'elevation' samples the height color ramp
 *  per pixel (smooth gradients); 'neutral' is one uniform color, because the ramp paints iso-height
 *  bands that read as contour lines and hide or fake fold structure. */
function makeSurfaceMaterial(): THREE.MeshPhongMaterial {
  const neutral = STATE.viewMaterial === 'neutral';
  return new THREE.MeshPhongMaterial({
    ...(neutral ? { color: new THREE.Color(NEUTRAL_SURFACE_COLOR) } : { map: getColorRampTexture() }),
    side: THREE.DoubleSide,
    shininess: neutral ? 12 : 40,
    specular: new THREE.Color(neutral ? 0x1a1a1a : 0x222233),
    polygonOffset: true,       // prevent z-fighting with wireframe overlay
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

/** 'elevation' keeps the original soft key + fill. 'neutral' is for judging form: one raking key from
 *  the upper left of the panel (+Y is up the image) at about 35 deg elevation, the light the relief
 *  renders in cli/relief-roundtrip.ts use, with little fill. Under the soft setup a 0.05 in eyelid on
 *  a relief master was close to invisible. */
function applyLighting(): void {
  if (!_hemi || !_keyLight || !_fillLight) return;
  const neutral = STATE.viewMaterial === 'neutral';
  _hemi.intensity = neutral ? 0.12 : 0.35;
  _keyLight.intensity = neutral ? 1.15 : 0.85;
  if (neutral) _keyLight.position.set(-0.55, 0.45, 0.5).normalize();
  else _keyLight.position.set(-1, -0.8, 1.5).normalize();
  _fillLight.intensity = neutral ? 0.08 : 0.3;
  _fillLight.position.set(1, 0.5, 0.3).normalize();
}

/** Swap the surface material after a shading change without rebuilding geometry. The shared ramp
 *  texture is cached module-wide, so only the material itself is disposed. */
export function applySurfaceMaterial(): void {
  applyLighting();
  if (!_surfaceMesh) { requestRender(); return; }
  (_surfaceMesh.material as THREE.Material).dispose();
  _surfaceMesh.material = makeSurfaceMaterial();
  requestRender();
}

function buildSurface(
  vertices: number[][], cols: number, rows: number,
  meshX: number, meshY: number,
): void {
  disposeGroup(_surfaceMesh); _surfaceMesh = null;
  disposeGroup(_wireLines); _wireLines = null;
  disposeGroup(_pointsObj); _pointsObj = null;

  const positions = new Float32Array(rows * cols * 3);
  const uvs = new Float32Array(rows * cols * 2);

  const [zMin, zMax] = gridMinMax(vertices, rows, cols);
  const zRange = zMax - zMin || 1;
  _cachedZMin = zMin;
  _cachedZMax = zMax;
  _cachedZMid = (zMin + zMax) / 2;

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
  const indices = new Uint32Array((rows - 1) * (cols - 1) * 6);
  let ti = 0;
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const [t1, t2] = cellTriangleOffsets(
        preferZ00Z11Diagonal(vertices[j][i], vertices[j][i+1], vertices[j+1][i], vertices[j+1][i+1]), cols);
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

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));

  _surfaceMesh = new THREE.Mesh(geo, makeSurfaceMaterial());
  _scene.add(_surfaceMesh);

  // Wireframe and points are built on first use (updateVisibility): at 400 columns they add about
  // 4 MB of line vertices that most sessions never display.
  _overlaySource = { positions, vertices, cols, rows, zMin, zRange };
}

function ensureWireframe(): void {
  if (_wireLines || !_overlaySource) return;
  const { positions, vertices, cols, rows, zMin, zRange } = _overlaySource;
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

  const wGeo = new THREE.BufferGeometry();
  wGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3));
  wGeo.setAttribute('color', new THREE.BufferAttribute(wCol, 3));
  _wireLines = new THREE.LineSegments(wGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.7,
  }));
  _scene.add(_wireLines);
}

function ensurePoints(): void {
  if (_pointsObj || !_overlaySource) return;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(_overlaySource.positions.slice(), 3));
  _pointsObj = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 2, sizeAttenuation: false, color: 0x4eaaff, transparent: true, opacity: 0.8,
  }));
  _scene.add(_pointsObj);
}

function buildEnclosure(
  vertices: number[][], cols: number, rows: number,
  meshX: number, meshY: number,
): void {
  disposeGroup(_encGroup);
  _encGroup = new THREE.Group();
  const zBase = 0;
  const sideMat = new THREE.MeshPhongMaterial({ color: 0xe8e8e8, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });

  // Bottom face
  const botGeo = new THREE.PlaneGeometry(meshX, meshY);
  botGeo.translate(meshX / 2, meshY / 2, zBase);
  // Flip winding for downward-facing normal
  const botIdx = botGeo.getIndex();
  if (botIdx) {
    const arr = Array.from(botIdx.array);
    for (let k = 0; k < arr.length; k += 3) {
      const tmp = arr[k]; arr[k] = arr[k + 2]; arr[k + 2] = tmp;
    }
    botGeo.setIndex(arr);
  }
  botGeo.computeVertexNormals();
  _encGroup.add(new THREE.Mesh(botGeo, new THREE.MeshPhongMaterial({ color: 0xe0e0e0, transparent: true, opacity: 0.7 })));

  // Side walls (4 edge strips connecting top surface to z=0)
  function buildWall(edge: { x: number; y: number; z: number }[]): THREE.BufferGeometry {
    const n = edge.length;
    const pos = new Float32Array(n * 2 * 3);
    const idx: number[] = [];
    for (let k = 0; k < n; k++) {
      pos[k * 6] = edge[k].x;     pos[k * 6 + 1] = edge[k].y;     pos[k * 6 + 2] = edge[k].z;
      pos[k * 6 + 3] = edge[k].x; pos[k * 6 + 4] = edge[k].y; pos[k * 6 + 5] = zBase;
    }
    for (let k = 0; k < n - 1; k++) {
      const t0 = k * 2, b0 = t0 + 1, t1 = (k + 1) * 2, b1 = t1 + 1;
      idx.push(t0, b0, t1, t1, b0, b1);
    }
    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    wallGeo.setIndex(idx);
    wallGeo.computeVertexNormals();
    return wallGeo;
  }

  // Front (j=0), Back (j=rows-1), Left (i=0), Right (i=cols-1)
  const front: { x: number; y: number; z: number }[] = [];
  const back: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < cols; i++) {
    front.push({ x: (i / (cols - 1)) * meshX, y: 0, z: vertices[0][i] });
    back.push({ x: (i / (cols - 1)) * meshX, y: meshY, z: vertices[rows - 1][i] });
  }
  const left: { x: number; y: number; z: number }[] = [];
  const right: { x: number; y: number; z: number }[] = [];
  for (let j = 0; j < rows; j++) {
    left.push({ x: 0, y: (j / (rows - 1)) * meshY, z: vertices[j][0] });
    right.push({ x: meshX, y: (j / (rows - 1)) * meshY, z: vertices[j][cols - 1] });
  }
  _encGroup.add(new THREE.Mesh(buildWall(front), sideMat));
  _encGroup.add(new THREE.Mesh(buildWall(back), sideMat));
  _encGroup.add(new THREE.Mesh(buildWall(left), sideMat));
  _encGroup.add(new THREE.Mesh(buildWall(right), sideMat));

  _scene.add(_encGroup);
}

function updateVisibility(): void {
  const mode = STATE.viewMode;
  const showSolid = mode === 'solid' || mode === 'both';
  if (_surfaceMesh) _surfaceMesh.visible = showSolid;
  const showWire = mode === 'wireframe' || mode === 'both';
  if (showWire) ensureWireframe();
  if (mode === 'points') ensurePoints();
  if (_wireLines) _wireLines.visible = showWire;
  if (_pointsObj) _pointsObj.visible = mode === 'points';
  if (_encGroup) _encGroup.visible = showSolid && STATE.watertight && STATE.baseThickness > 0;
}

// --- Public API ---

export function renderViewport(): void {
  ensureRenderer();

  const verticesChanged = STATE.vertices !== _lastVerticesRef
    || STATE.meshX !== _lastMeshX || STATE.meshY !== _lastMeshY
    || STATE.rows !== _lastRows || STATE.cols !== _lastCols;

  if (verticesChanged) {
    _lastVerticesRef = STATE.vertices;
    _lastMeshX = STATE.meshX;
    _lastMeshY = STATE.meshY;
    _lastRows = STATE.rows;
    _lastCols = STATE.cols;
    if (STATE.vertices) {
      buildSurface(STATE.vertices, STATE.cols, STATE.rows, STATE.meshX, STATE.meshY);
      buildEnclosure(STATE.vertices, STATE.cols, STATE.rows, STATE.meshX, STATE.meshY);
    } else {
      disposeGroup(_surfaceMesh); _surfaceMesh = null;
      disposeGroup(_wireLines); _wireLines = null;
      disposeGroup(_pointsObj); _pointsObj = null;
      disposeGroup(_encGroup); _encGroup = null;
      _overlaySource = null;
    }
  }

  updateVisibility();
  setCameraFromState();
  updateDimsOverlay();
}

export function resizeCanvas(): void {
  if (!_renderer) return;
  const wrap = document.getElementById('canvasWrap')!;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (w !== _prevW || h !== _prevH) {
    _renderer.setSize(w, h);
    _camera.aspect = w / h;
    _camera.updateProjectionMatrix();
    _prevW = w;
    _prevH = h;
    setCameraFromState();
  }
}


export function updateDimsOverlay(): void {
  const el = document.getElementById('dimsOverlay')!;
  if (!STATE.vertices) { el.textContent = ''; return; }
  const zMin = _cachedZMin;
  const zMax = _cachedZMax;
  const totalZ = STATE.watertight ? Math.max(zMax, 0) : zMax - zMin;

  el.textContent = '';
  const spanDims = document.createElement('span');
  // Relief masters carry decimal extents (6.000000000000001 from metres): show at most 3 places.
  const dim = (v: number): string => String(Number(v.toFixed(3)));
  spanDims.textContent = `${dim(STATE.meshX)}" x ${dim(STATE.meshY)}"`;
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
  // Blend: say when the requested veil did not fit the cut, instead of silently reshaping it.
  if (STATE.mode === 'blend' && STATE.drapeOverflowIn > 0.001) {
    const spanWarn = document.createElement('span');
    spanWarn.className = 'cnc-warn';
    spanWarn.style.marginLeft = '8px';
    spanWarn.textContent = `FABRIC ${STATE.drapeOverflowIn.toFixed(3)}" THICKER THAN CUT`;
    el.appendChild(spanWarn);
  } else if (STATE.mode === 'blend' && STATE.drapeFoldScaleUsed < 0.99) {
    const spanWarn = document.createElement('span');
    spanWarn.className = 'cnc-warn';
    spanWarn.style.marginLeft = '8px';
    spanWarn.textContent = `FOLDS AT ${Math.round(STATE.drapeFoldScaleUsed * 100)}% TO FIT CUT`;
    el.appendChild(spanWarn);
  }
}
