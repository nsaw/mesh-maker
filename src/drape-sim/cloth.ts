/**
 * Silk veil drape over a static figure, solved with Jolt Physics soft bodies (XPBD, WebAssembly).
 * Pure apart from the Jolt module it is handed: runs in a browser Worker and in Node.
 *
 * The scene matches the Blender proof (scripts/drape/blender_drape.py): scene units, Z up, gravity
 * -9.81 Z, figure facing -Y with its crown at (0, 0, 1); a flat sheet `sheetX` x `sheetY` units with
 * `cellsX` x `cellsY` quads, `liftZ` above the crown, `frontShare` of its length in front of the crown,
 * its vertices within `pinRadius` of the crown fixed in place (the crown attachment). Frame 1 is the
 * rest state and every later frame is one step of `substeps` Jolt steps, as Blender counts frames, so
 * `frames` is the frame that is read.
 *
 * Optional forces, both as Blender's force fields act on cloth (SIM_mass_spring_force_face_extern in
 * blender/simulation/intern/implicit_blender.cc): a field of strength S accelerates a cloth vertex by
 * EFFECTOR_ACCEL x (its share of the sheet area) x S / (vertex mass).
 *   - Surface attraction (Blender's FORCE / SURFACE field on the figure, negative strength, falloff power
 *     0): every vertex within `attractReach` of the figure is pulled toward its nearest surface point.
 *   - Local attraction: the same pull, only on cloth inside a face region of the front view (the
 *     study's cropped face emitter), with its own strength, reach and timing.
 *   - Wind or pressure on a target region of the front view: a fixed direction (`windMode` 1, Blender
 *     WIND with wind factor 0, as the quartering-wind study used) or along the cloth normal toward the
 *     figure (`windMode` 2, normal pressure).
 * The regions are circles in the front view acting on the cloth in front of the crown (y < 0), so cloth
 * hanging behind the head inside the same circle is left alone.
 * After the solve, an optional surface fit (the study's Shrinkwrap, nearest-surface method) moves the
 * cloth inside the face region toward the figure, keeping the collision clearance.
 * Each strength rises from 0 at its start frame to full at its full frame along smoothstep, which is what
 * Blender's default (auto-clamped Bezier) keyframes between a 0 key and a full key evaluate to.
 */
import type JoltNS from 'jolt-physics';
import { buildNearestField, nearestPoint, type NearestField } from './nearest';

export type Jolt = typeof JoltNS;

export interface ClothParams {
  sheetX: number; sheetY: number; cellsX: number; cellsY: number; liftZ: number; pinRadius: number;
  frontShare: number;          // fraction of the sheet's length hanging in front of the crown (0.5 = centred)
  vertexMass: number;          // kg per vertex (Blender cloth mass convention)
  compliance: number;          // edge compliance, 1 / stiffness (XPBD)
  shearCompliance: number;
  bendCompliance: number;      // dihedral bend compliance
  iterations: number;          // Jolt soft-body solver iterations per step
  linearDamping: number;
  friction: number;
  vertexRadius: number;        // collision radius of every cloth vertex: the clearance kept from the figure
  fabricThickness: number;     // extracted veil surface offset toward the viewer, scene units (extraction only)
  frames: number; fps: number; substeps: number;
  attractStrength: number;     // Blender field strength toward the figure (0 = off)
  attractReach: number;        // scene units
  attractStart: number; attractFull: number;
  attractFrictionKeep: number; // share of `friction` left once the attraction is full (see simulateCloth)
  windMode: number;            // 0 off, 1 wind in a fixed direction, 2 pressure along the cloth normal
  windStrength: number;        // Blender field strength
  windAzimuth: number;         // degrees the wind comes from: 0 = from the viewer, 90 = from the viewer's right (+X)
  windElevation: number;       // degrees above horizontal the wind comes from
  windX: number; windZ: number; windRadius: number;  // target circle in the front view, scene units
  windStart: number; windFull: number;
  faceAttractStrength: number; // local attraction inside the face circle (0 = off)
  faceAttractReach: number;
  faceStart: number; faceFull: number;
  faceX: number; faceZ: number; faceRadius: number;  // face circle in the front view, scene units
  fitStrength: number;         // post-solve surface fit inside the face circle, 0 (off) to 1 (onto the figure)
  displaySubdivisions: number; // Catmull-Clark levels on the solved cloth before extraction (extraction only)
}

/** The Blender proof's sheet, pins, frames and timing (5 x 8 units, 100 x 160 quads, 0.012 above the
 *  crown, nine pinned vertices, Silk preset vertex mass 0.15, 24 fps, read at frame 100), with Jolt
 *  material values calibrated against it on 2026-10-21. Calibration (cli/drape-run.ts runs scored
 *  against the Blender silk-tilt25 reference, about 60 runs): bend compliance 1, 10, 1e2 ... 1e6; edge
 *  compliance 1e-5 to 1e-3; damping 0.02 to 6.7; friction 0.1 to 5; 8 or 16 iterations and substeps.
 *  Bend compliance 10 and above all behave as no bending resistance at this cell size, so Blender's
 *  silk (0.05) already sits at the floppy end. Gates and measured values: npm run test:drape-parity. */
export const SILK: ClothParams = {
  sheetX: 5, sheetY: 8, cellsX: 100, cellsY: 160, liftZ: 0.012, pinRadius: 0.051, frontShare: 0.5,
  vertexMass: 0.15, compliance: 3e-5, shearCompliance: 3e-5, bendCompliance: 1e5, iterations: 8,
  linearDamping: 1.0, friction: 0.5, vertexRadius: 0.005, fabricThickness: 0, frames: 100, fps: 24, substeps: 8,
  attractStrength: 0, attractReach: 0.8, attractStart: 45, attractFull: 100, attractFrictionKeep: 0,
  windMode: 0, windStrength: 0, windAzimuth: 45, windElevation: 0, windX: 0.4, windZ: 0.07, windRadius: 0.3,
  windStart: 100, windFull: 115,
  faceAttractStrength: 0, faceAttractReach: 0.4, faceStart: 45, faceFull: 100, faceX: -0.1, faceZ: 0.08, faceRadius: 0.63,
  fitStrength: 0, displaySubdivisions: 2,
};

/** The gathered silk of the Blender study (scripts/drape, preset silk-gathered, read at frame 120): the
 *  proof plus a surface attraction of strength 1000 within 0.8 units, ramping in from frame 45 to 100,
 *  with friction released as it does (see simulateCloth). The study also softened bending (0.05 to
 *  0.0025) and shrank the collision gap (0.003 + 0.002 to 0.001 + 0.001). Neither has a counterpart
 *  here: the calibrated silk already has no bending resistance, and a smaller Jolt radius matched the
 *  Blender run worse (0.002: IoU 0.75, 0.004: 0.72, 0.005: 0.79, 0.007: 0.77), so the silk calibration's
 *  0.005 stays. Measured values and gates: npm run test:drape-parity. */
export const SILK_GATHERED: ClothParams = { ...SILK, frames: 120, attractStrength: 1000 };

/** Acceleration of a Blender cloth vertex per unit field strength x cloth area / vertex mass. Measured in
 *  Blender 5.2.2 (Silk, quality 12, no gravity or air damping; a 21 x 21 patch over a SURFACE field):
 *  strength 1000 moves the centre vertex 1.416 times as far as gravity 9.81 does over the first four
 *  frames at cell 0.05 and mass 0.15, so 13.89 units/s^2. Quadrupling the cell area quadrupled it,
 *  quadrupling the mass quartered it, the height above the field (falloff power 0) did not change it,
 *  and a WIND field (wind factor 0) gave the identical displacement. */
export const EFFECTOR_ACCEL = 13.89 * 0.15 / (0.05 * 0.05 * 1000);

export interface ClothResult {
  /** Cloth node positions after the last frame, row-major (cellsY + 1) x (cellsX + 1) x 3. */
  positions: Float64Array;
  rows: number; cols: number;
  /** Largest node displacement during the last frame (scene units), a settledness measure. */
  lastFrameMotion: number;
  seconds: number;
}

/** 0 before `start`, 1 from `full`, smoothstep between (a step at `start` when full <= start). */
export function ramp(frame: number, start: number, full: number): number {
  if (frame < start) return 0;
  if (frame >= full) return 1;
  const t = (frame - start) / (full - start);
  return t * t * (3 - 2 * t);
}

/** The sheet's y offset so `frontShare` of it lies in front of the crown (-Y), snapped to the cell grid
 *  so a vertex sits on the crown. */
export function sheetOffsetY(p: ClothParams): number {
  const dy = p.sheetY / p.cellsY;
  return Math.round(((0.5 - p.frontShare) * p.sheetY) / dy) * dy;
}

const LAYER_STATIC = 0, LAYER_MOVING = 1;
/** Voxel size of the nearest-surface field, scene units (the cloth cell is 0.05). */
const NEAREST_VOXEL = 0.04;
/** How far from the figure the surface fit still pulls cloth, scene units (12.5 cm life size). */
const FIT_REACH = 1;

export function simulateCloth(J: Jolt, figurePos: Float32Array, figureTris: Uint32Array, p: ClothParams,
  onFrame?: (frame: number, frames: number) => boolean | void): ClothResult {
  const t0 = Date.now();
  const settings = new J.JoltSettings();
  const pairs = new J.ObjectLayerPairFilterTable(2);
  pairs.EnableCollision(LAYER_STATIC, LAYER_MOVING); pairs.EnableCollision(LAYER_MOVING, LAYER_MOVING);
  const bp = new J.BroadPhaseLayerInterfaceTable(2, 2);
  bp.MapObjectToBroadPhaseLayer(LAYER_STATIC, new J.BroadPhaseLayer(0)); bp.MapObjectToBroadPhaseLayer(LAYER_MOVING, new J.BroadPhaseLayer(1));
  settings.mObjectLayerPairFilter = pairs; settings.mBroadPhaseLayerInterface = bp;
  settings.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(bp, 2, pairs, 2);
  const jolt = new J.JoltInterface(settings); J.destroy(settings);
  const system = jolt.GetPhysicsSystem(), bodies = system.GetBodyInterface();
  const g = new J.Vec3(0, 0, -9.81); system.SetGravity(g); J.destroy(g);

  // Static figure.
  const vl = new J.VertexList(), tl = new J.IndexedTriangleList(), f3 = new J.Float3(0, 0, 0);
  vl.reserve(figurePos.length / 3);
  for (let i = 0; i < figurePos.length; i += 3) { f3.x = figurePos[i]; f3.y = figurePos[i + 1]; f3.z = figurePos[i + 2]; vl.push_back(f3); }
  tl.reserve(figureTris.length / 3);
  const it = new J.IndexedTriangle(0, 0, 0, 0);
  for (let i = 0; i < figureTris.length; i += 3) {
    it.set_mIdx(0, figureTris[i]); it.set_mIdx(1, figureTris[i + 1]); it.set_mIdx(2, figureTris[i + 2]); tl.push_back(it);
  }
  const mats = new J.PhysicsMaterialList();
  const ms = new J.MeshShapeSettings(vl, tl, mats);
  const shapeResult = ms.Create();
  if (shapeResult.HasError()) throw new Error('figure mesh rejected by the collision builder');
  const shape = shapeResult.Get();
  const ident = J.Quat.prototype.sIdentity(), origin = new J.RVec3(0, 0, 0);
  const figSettings = new J.BodyCreationSettings(shape, origin, ident, J.EMotionType_Static, LAYER_STATIC);
  figSettings.mFriction = p.friction;
  const figureBody = bodies.CreateAndAddBody(figSettings, J.EActivation_DontActivate);
  J.destroy(figSettings); J.destroy(vl); J.destroy(tl); J.destroy(it); J.destroy(ms);

  // Cloth sheet.
  const cols = p.cellsX + 1, rows = p.cellsY + 1, dx = p.sheetX / p.cellsX, dy = p.sheetY / p.cellsY;
  const shared = new J.SoftBodySharedSettings(), v = new J.SoftBodySharedSettingsVertex();
  const z = 1 + p.liftZ, oy = sheetOffsetY(p);
  const free = new Uint8Array(rows * cols);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = -p.sheetX / 2 + i * dx, y = oy - p.sheetY / 2 + j * dy;
    f3.x = x; f3.y = y; f3.z = z; v.mPosition = f3;
    const pinned = Math.abs(x) < p.pinRadius && Math.abs(y) < p.pinRadius;
    v.mInvMass = pinned ? 0 : 1 / p.vertexMass; free[j * cols + i] = pinned ? 0 : 1;
    shared.mVertices.push_back(v);
  }
  if (free.every(f => f === 1)) throw new Error('the crown attachment holds no cloth vertex: increase its size');
  const face = new J.SoftBodySharedSettingsFace(0, 0, 0, 0);
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = j * cols + i, b = a + 1, d = a + cols, e = d + 1;
    face.set_mVertex(0, a); face.set_mVertex(1, d); face.set_mVertex(2, e); shared.AddFace(face);
    face.set_mVertex(1, e); face.set_mVertex(2, b); shared.AddFace(face);
  }
  const attr = new J.SoftBodySharedSettingsVertexAttributes();
  attr.mCompliance = p.compliance; attr.mShearCompliance = p.shearCompliance; attr.mBendCompliance = p.bendCompliance;
  shared.CreateConstraints(attr, 1, J.SoftBodySharedSettings_EBendType_Dihedral);
  shared.Optimize();
  const cs = new J.SoftBodyCreationSettings(shared, origin, ident, LAYER_MOVING);
  cs.mNumIterations = p.iterations; cs.mLinearDamping = p.linearDamping; cs.mFriction = p.friction;
  cs.mVertexRadius = p.vertexRadius; cs.mUpdatePosition = false; cs.mAllowSleeping = false; cs.mFacesDoubleSided = true;
  const cloth = bodies.CreateSoftBody(cs);
  bodies.AddBody(cloth.GetID(), J.EActivation_Activate);
  J.destroy(cs); J.destroy(v); J.destroy(face); J.destroy(attr); J.destroy(f3);

  const motion = J.castObject(cloth.GetMotionProperties(), J.SoftBodyMotionProperties);
  const verts = motion.GetVertices();
  // Vertex positions and velocities are read and written in the WASM heap: the vertex array does not
  // move once the body exists, and SoftBodyVertexTraits gives the field offsets. HEAPF32 is re-read
  // every time because a growing heap replaces it.
  const base = J.getPointer(verts.at(0)) / 4, stride = (J.getPointer(verts.at(1)) - J.getPointer(verts.at(0))) / 4;
  const po = J.SoftBodyVertexTraits.prototype.mPositionOffset / 4, vo = J.SoftBodyVertexTraits.prototype.mVelocityOffset / 4;
  const read = (out: Float64Array): void => {
    const H = J.HEAPF32;
    for (let k = 0; k < rows * cols; k++) { const a = base + k * stride + po; out[k * 3] = H[a]; out[k * 3 + 1] = H[a + 1]; out[k * 3 + 2] = H[a + 2]; }
  };

  // Field forces: the acceleration per unit strength of each vertex, from its share of the rest area.
  const nV = rows * cols, perStrength = new Float64Array(nV);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const quads = (i > 0 ? 1 : 0) + (i < cols - 1 ? 1 : 0), quadsY = (j > 0 ? 1 : 0) + (j < rows - 1 ? 1 : 0);
    perStrength[j * cols + i] = free[j * cols + i] ? (EFFECTOR_ACCEL * dx * dy * quads * quadsY / 4) / p.vertexMass : 0;
  }
  const attracting = p.attractStrength > 0 && p.attractReach > 0, blowing = p.windMode > 0 && p.windStrength !== 0 && p.windRadius > 0;
  const local = p.faceAttractStrength > 0 && p.faceAttractReach > 0 && p.faceRadius > 0, fitting = p.fitStrength > 0 && p.faceRadius > 0;
  // The fit looks for the figure up to FIT_REACH away; the forces only as far as their reach.
  const reach = Math.max(attracting ? p.attractReach : 0, local ? p.faceAttractReach : 0, fitting ? FIT_REACH : 0);
  let field: NearestField | null = null;
  if (reach > 0) {
    const hang = Math.hypot(p.sheetX / 2, p.sheetY / 2 + Math.abs(oy)) + p.vertexRadius;
    // Every cloth vertex stays within its distance along the sheet (at most `hang`) of the crown pins, and
    // the surface that pulls it within `attractReach` of that (the builder clips this to the figure).
    const e = hang + reach;
    field = buildNearestField(figurePos, figureTris, { x0: -e, x1: e, y0: -e, y1: e, z0: z - e, z1: z + reach }, NEAREST_VOXEL, reach);
  }
  const az = (p.windAzimuth * Math.PI) / 180, el = (p.windElevation * Math.PI) / 180;
  const wind = [-Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), -Math.sin(el)];
  const pos = new Float64Array(nV * 3), q = new Float64Array(3);
  const step = 1 / (p.fps * p.substeps);
  /** 1 inside the face circle of the front view, fading to 0 over its outer 30%; 0 behind the crown. */
  const inFace = (x: number, y: number, zz: number): number =>
    y < 0 ? 1 - ramp(Math.hypot(x - p.faceX, zz - p.faceZ), 0.7 * p.faceRadius, p.faceRadius) : 0;
  const applyForces = (frame: number): void => {
    const sA = attracting ? p.attractStrength * ramp(frame, p.attractStart, p.attractFull) : 0;
    const sL = local ? p.faceAttractStrength * ramp(frame, p.faceStart, p.faceFull) : 0;
    const sW = blowing ? p.windStrength * ramp(frame, p.windStart, p.windFull) : 0;
    if (sA === 0 && sL === 0 && sW === 0) return;
    read(pos);
    const H = J.HEAPF32;
    for (let k = 0; k < nV; k++) {
      if (!perStrength[k]) continue;
      const x = pos[k * 3], y = pos[k * 3 + 1], zz = pos[k * 3 + 2];
      let ax = 0, ay = 0, azz = 0;
      if ((sA || sL) && field) {
        const d = nearestPoint(field, x, y, zz, q);
        let pull = 0;
        if (sA && d <= p.attractReach) pull += sA;
        if (sL && d <= p.faceAttractReach) pull += sL * inFace(x, y, zz);
        if (pull && d > 1e-9) {
          const s = (pull * perStrength[k]) / d;
          ax += (q[0] - x) * s; ay += (q[1] - y) * s; azz += (q[2] - zz) * s;
        }
      }
      if (sW && y < 0) {
        const r = Math.hypot(x - p.windX, zz - p.windZ);
        if (r < p.windRadius) {
          const s = sW * perStrength[k] * (1 - ramp(r, 0.7 * p.windRadius, p.windRadius));
          if (p.windMode === 1) { ax += wind[0] * s; ay += wind[1] * s; azz += wind[2] * s; }
          else {
            // Pressure along the cloth normal, turned to push away from the viewer (toward the figure).
            const j = Math.floor(k / cols), i = k - j * cols;
            const kl = k - (i > 0 ? 1 : 0), kr = k + (i < cols - 1 ? 1 : 0), kd = k - (j > 0 ? cols : 0), ku = k + (j < rows - 1 ? cols : 0);
            const ux = pos[kr * 3] - pos[kl * 3], uy = pos[kr * 3 + 1] - pos[kl * 3 + 1], uz = pos[kr * 3 + 2] - pos[kl * 3 + 2];
            const vx = pos[ku * 3] - pos[kd * 3], vy = pos[ku * 3 + 1] - pos[kd * 3 + 1], vz = pos[ku * 3 + 2] - pos[kd * 3 + 2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const len = Math.hypot(nx, ny, nz) * (ny < 0 ? -1 : 1);
            if (len) { nx /= len; ny /= len; nz /= len; ax += nx * s; ay += ny * s; azz += nz * s; }
          }
        }
      }
      if (ax || ay || azz) {
        const a = base + k * stride + vo;
        H[a] += ax * step; H[a + 1] += ay * step; H[a + 2] += azz * step;
      }
    }
  };

  // Friction under attraction. Jolt's friction is Coulomb: it grows with the load pressing the cloth
  // onto the figure, so the attraction would pin the cloth where it first touches. Blender's cloth
  // collision friction (blenkernel/intern/collision.cc) is an impulse proportional to the approach
  // speed, which a cloth resting under attraction does not have, so there the cloth keeps sliding (the
  // gathered study's veil slides into a rope beside the neck). Friction therefore falls to
  // `attractFrictionKeep` of its value as the attraction ramps in; both bodies get the same value, so
  // any combine rule gives it.
  const setFriction = (frame: number): void => {
    if (!attracting) return;
    const f = p.friction * (1 - ramp(frame, p.attractStart, p.attractFull) * (1 - p.attractFrictionKeep));
    bodies.SetFriction(figureBody, f); bodies.SetFriction(cloth.GetID(), f);
  };

  const prev = new Float64Array(nV * 3), cur = new Float64Array(nV * 3);
  let lastMotion = NaN;
  // Frame 1 is the rest state; frame f is reached by the step that runs with the scene at frame f.
  for (let fr = 2; fr <= p.frames; fr++) {
    if (fr === p.frames) read(prev);
    setFriction(fr);
    for (let s = 0; s < p.substeps; s++) { applyForces(fr); jolt.Step(step, 1); }
    if (onFrame && onFrame(fr, p.frames) === false) break;
  }
  read(cur);
  for (let k = 0; k < cur.length; k += 3) {
    const m = Math.hypot(cur[k] - prev[k], cur[k + 1] - prev[k + 1], cur[k + 2] - prev[k + 2]);
    if (!(m <= lastMotion)) lastMotion = m;
  }
  // Surface fit: each free vertex inside the face circle moves `fitStrength` of the way to the point that
  // keeps the collision clearance from its nearest figure point (Shrinkwrap, nearest surface point).
  if (fitting && field) {
    for (let k = 0; k < nV; k++) {
      if (!free[k]) continue;
      const x = cur[k * 3], y = cur[k * 3 + 1], zz = cur[k * 3 + 2];
      const w = p.fitStrength * inFace(x, y, zz);
      if (!w) continue;
      const d = nearestPoint(field, x, y, zz, q);
      if (!(d > 1e-9 && d <= FIT_REACH)) continue;
      const t = w * (1 - p.vertexRadius / d);                          // fraction of the way to the surface
      cur[k * 3] = x + (q[0] - x) * t; cur[k * 3 + 1] = y + (q[1] - y) * t; cur[k * 3 + 2] = zz + (q[2] - zz) * t;
    }
  }
  bodies.RemoveBody(cloth.GetID()); bodies.DestroyBody(cloth.GetID());
  J.destroy(jolt);
  return { positions: cur, rows, cols, lastFrameMotion: lastMotion, seconds: (Date.now() - t0) / 1000 };
}
