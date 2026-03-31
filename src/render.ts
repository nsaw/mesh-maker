import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STATE } from './state';

// --- Module state ---
let _renderer: THREE.WebGLRenderer | null = null;
let _scene: THREE.Scene;
let _camera: THREE.PerspectiveCamera;
let _controls: OrbitControls;
let _surfaceMesh: THREE.Mesh | null = null;
let _wireLines: THREE.LineSegments | null = null;
let _pointsObj: THREE.Points | null = null;
let _encGroup: THREE.Group | null = null;
let _gizmoScene: THREE.Scene;
let _gizmoCamera: THREE.OrthographicCamera;
let _needsRender = true;
let _prevW = 0;
let _prevH = 0;
let _lastVerticesRef: number[][] | null = null;

const BG_COLOR = 0x141418;
const FOV = 60;

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

  // Lighting: ambient 12% + directional 88% -- matches current Gouraud model
  _scene.add(new THREE.AmbientLight(0xffffff, 0.12));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.88);
  dirLight.position.set(-0.4, -0.5, 0.75).normalize();
  _scene.add(dirLight);

  // OrbitControls
  _controls = new OrbitControls(_camera, _renderer.domElement);
  _controls.enableDamping = true;
  _controls.dampingFactor = 0.08;
  _controls.screenSpacePanning = true;
  _controls.minDistance = 0.5;
  _controls.maxDistance = 500;
  _controls.addEventListener('change', () => {
    syncCameraToState();
    _needsRender = true;
  });

  // Gizmo scene (AxesHelper in scissored inset)
  _gizmoScene = new THREE.Scene();
  _gizmoScene.add(new THREE.AxesHelper(1));
  _gizmoCamera = new THREE.OrthographicCamera(-1.8, 1.8, 1.8, -1.8, 0.1, 10);

  setCameraFromState();

  // Animation loop (needed for OrbitControls damping)
  const animate = (): void => {
    requestAnimationFrame(animate);
    _controls.update(); // fires 'change' during damping
    if (_needsRender) {
      _needsRender = false;
      doRender();
    }
  };
  animate();

  _prevW = w;
  _prevH = h;
}

function doRender(): void {
  if (!_renderer) return;
  const w = _prevW;
  const h = _prevH;
  const dpr = _renderer.getPixelRatio();

  // Main scene
  _renderer.setViewport(0, 0, w * dpr, h * dpr);
  _renderer.setScissor(0, 0, w * dpr, h * dpr);
  _renderer.setScissorTest(true);
  _renderer.clear();
  _renderer.render(_scene, _camera);

  // Gizmo inset (top-left corner, 80x80px)
  const gs = Math.floor(80 * dpr);
  const gx = Math.floor(10 * dpr);
  // WebGL origin is bottom-left; top-left corner = (gx, totalH - gs - margin)
  const gy = Math.floor(h * dpr - gs - 10 * dpr);
  _gizmoCamera.position.copy(_camera.position).sub(_controls.target).normalize().multiplyScalar(3);
  _gizmoCamera.up.copy(_camera.up);
  _gizmoCamera.lookAt(0, 0, 0);
  _renderer.setViewport(gx, gy, gs, gs);
  _renderer.setScissor(gx, gy, gs, gs);
  _renderer.clearDepth();
  _renderer.render(_gizmoScene, _gizmoCamera);

  _renderer.setScissorTest(false);
}

// --- Camera sync ---

export function setCameraFromState(): void {
  if (!_controls || !_camera) return;

  const meshX = STATE.meshX || 36;
  const meshY = STATE.meshY || 24;

  let zMid = 0;
  if (STATE.vertices) {
    let zMin = Infinity, zMax = -Infinity;
    const { vertices, rows, cols } = STATE;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const z = vertices[j][i];
        if (z < zMin) zMin = z;
        if (z > zMax) zMax = z;
      }
    zMid = (zMin + zMax) / 2;
  }

  const target = new THREE.Vector3(meshX / 2, meshY / 2, zMid);
  const radius = Math.max(meshX, meshY) * 1.2 / Math.max(STATE.zoom, 0.01);
  const phi = Math.PI * (90 + STATE.tilt) / 180;   // polar from Z-axis
  const theta = STATE.orbit * Math.PI / 180;        // azimuthal around Z

  _camera.position.set(
    target.x + radius * Math.sin(phi) * Math.cos(theta),
    target.y + radius * Math.sin(phi) * Math.sin(theta),
    target.z + radius * Math.cos(phi),
  );
  _controls.target.copy(target);
  _controls.update();
  _needsRender = true;
}

function syncCameraToState(): void {
  if (!_controls || !_camera) return;

  const offset = _camera.position.clone().sub(_controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);

  STATE.orbit = ((THREE.MathUtils.radToDeg(spherical.theta) % 360) + 360) % 360;
  STATE.tilt = 90 - THREE.MathUtils.radToDeg(spherical.phi);
  const meshMax = Math.max(STATE.meshX || 36, STATE.meshY || 24);
  STATE.zoom = Math.max(0.1, Math.min(10, meshMax * 1.2 / spherical.radius));

  // Update slider displays (no event firing)
  for (const key of ['orbit', 'tilt', 'zoom']) {
    const sl = document.getElementById(`sl_${key}`) as HTMLInputElement | null;
    const valEl = document.getElementById(`val_${key}`);
    const v = STATE[key as keyof typeof STATE] as number;
    if (sl) sl.value = String(v);
    if (valEl) valEl.textContent = key === 'zoom' ? v.toFixed(2) : String(Math.round(v));
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

function buildSurface(
  vertices: number[][], cols: number, rows: number,
  meshX: number, meshY: number,
): void {
  disposeGroup(_surfaceMesh); _surfaceMesh = null;
  disposeGroup(_wireLines); _wireLines = null;
  disposeGroup(_pointsObj); _pointsObj = null;

  // Positions + vertex colors
  const positions = new Float32Array(rows * cols * 3);
  const colors = new Float32Array(rows * cols * 3);

  let zMin = Infinity, zMax = -Infinity;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const z = vertices[j][i];
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
  const zRange = zMax - zMin || 1;

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      positions[idx * 3] = (i / (cols - 1)) * meshX;
      positions[idx * 3 + 1] = (j / (rows - 1)) * meshY;
      positions[idx * 3 + 2] = vertices[j][i];

      // Blue-steel Z-height gradient (matches original Canvas 2D palette)
      const t = Math.max(0, Math.min(1, (vertices[j][i] - zMin) / zRange));
      colors[idx * 3] = (40 + t * 180) / 255;
      colors[idx * 3 + 1] = (50 + t * 190) / 255;
      colors[idx * 3 + 2] = (70 + t * 185) / 255;
    }
  }

  // Indexed triangles (2 per quad)
  const indices: number[] = [];
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      indices.push(a, a + 1, a + cols);
      indices.push(a + 1, a + cols + 1, a + cols);
    }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  _surfaceMesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    polygonOffset: true,       // prevent z-fighting with wireframe overlay
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  }));
  _scene.add(_surfaceMesh);

  // Wireframe: grid lines (horizontal + vertical, no triangle diagonals)
  const wPos: number[] = [];
  const wCol: number[] = [];
  function pushWireVtx(wj: number, wi: number): void {
    const widx = wj * cols + wi;
    wPos.push(positions[widx * 3], positions[widx * 3 + 1], positions[widx * 3 + 2]);
    const vt = Math.max(0, Math.min(1, (vertices[wj][wi] - zMin) / zRange));
    const g = (40 + vt * 120) / 255;
    wCol.push(g, g + 15 / 255, g + 30 / 255);
  }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols - 1; i++) { pushWireVtx(j, i); pushWireVtx(j, i + 1); }
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows - 1; j++) { pushWireVtx(j, i); pushWireVtx(j + 1, i); }

  const wGeo = new THREE.BufferGeometry();
  wGeo.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
  wGeo.setAttribute('color', new THREE.Float32BufferAttribute(wCol, 3));
  _wireLines = new THREE.LineSegments(wGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.7,
  }));
  _scene.add(_wireLines);

  // Points
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
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
  const sideMat = new THREE.MeshPhongMaterial({ color: 0x253045, side: THREE.DoubleSide });

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
  _encGroup.add(new THREE.Mesh(botGeo, new THREE.MeshPhongMaterial({ color: 0x1a2030 })));

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
  if (_wireLines) _wireLines.visible = mode === 'wireframe' || mode === 'both';
  if (_pointsObj) _pointsObj.visible = mode === 'points';
  if (_encGroup) _encGroup.visible = showSolid && STATE.watertight && STATE.baseThickness > 0;
}

// --- Public API ---

export function renderViewport(): void {
  ensureRenderer();

  const verticesChanged = STATE.vertices !== _lastVerticesRef;

  if (verticesChanged) {
    _lastVerticesRef = STATE.vertices;
    if (STATE.vertices) {
      buildSurface(STATE.vertices, STATE.cols, STATE.rows, STATE.meshX, STATE.meshY);
      buildEnclosure(STATE.vertices, STATE.cols, STATE.rows, STATE.meshX, STATE.meshY);
      // Update controls target to mesh center
      let zMin = Infinity, zMax = -Infinity;
      for (let j = 0; j < STATE.rows; j++)
        for (let i = 0; i < STATE.cols; i++) {
          const z = STATE.vertices[j][i];
          if (z < zMin) zMin = z;
          if (z > zMax) zMax = z;
        }
      const zMid = (zMin + zMax) / 2;
      _controls.target.set(STATE.meshX / 2, STATE.meshY / 2, zMid);
      _controls.update();
    } else {
      disposeGroup(_surfaceMesh); _surfaceMesh = null;
      disposeGroup(_wireLines); _wireLines = null;
      disposeGroup(_pointsObj); _pointsObj = null;
      disposeGroup(_encGroup); _encGroup = null;
    }
  }

  updateVisibility();
  _needsRender = true;
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
    _needsRender = true;
  }
}

export function resetCanvasSize(): void {
  _prevW = 0;
  _prevH = 0;
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
  const totalZ = STATE.watertight ? Math.max(zMax, 0) : zMax - zMin;

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
