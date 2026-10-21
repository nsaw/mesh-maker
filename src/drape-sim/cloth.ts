/**
 * Silk veil drape over a static figure, solved with Jolt Physics soft bodies (XPBD, WebAssembly).
 * Pure apart from the Jolt module it is handed: runs in a browser Worker and in Node.
 *
 * The scene matches the Blender proof (scripts/drape/blender_drape.py): scene units, Z up, gravity
 * -9.81 Z, figure facing -Y with its crown at (0, 0, 1); a flat sheet `sheetX` x `sheetY` units with
 * `cellsX` x `cellsY` quads, `liftZ` above the crown, its centre vertices within `pinRadius` fixed in
 * place (the crown attachment); frames at `fps`, each split into `substeps` Jolt steps.
 */
import type JoltNS from 'jolt-physics';

export type Jolt = typeof JoltNS;

export interface ClothParams {
  sheetX: number; sheetY: number; cellsX: number; cellsY: number; liftZ: number; pinRadius: number;
  vertexMass: number;          // kg per vertex (Blender cloth mass convention)
  compliance: number;          // edge compliance, 1 / stiffness (XPBD)
  shearCompliance: number;
  bendCompliance: number;      // dihedral bend compliance
  iterations: number;          // Jolt soft-body solver iterations per step
  linearDamping: number;
  friction: number;
  vertexRadius: number;        // collision radius of every cloth vertex
  frames: number; fps: number; substeps: number;
}

/** The Blender proof's sheet, pins, frames and timing (5 x 8 units, 100 x 160 quads, 0.012 above the
 *  crown, nine pinned vertices, Silk preset vertex mass 0.15, 24 fps, read at frame 100), with Jolt
 *  material values calibrated against it on 2026-10-21. Calibration (cli/drape-run.ts runs scored
 *  against the Blender silk-tilt25 reference, about 60 runs): bend compliance 1, 10, 1e2 ... 1e6; edge
 *  compliance 1e-5 to 1e-3; damping 0.02 to 6.7; friction 0.1 to 5; 8 or 16 iterations and substeps.
 *  With the chosen values npm run test:drape-parity measures veil footprint IoU 0.916, area ratio 1.03,
 *  median depth bias -0.17 mm and fold wavelength 13.9 mm (Blender 12.7); Blender's own frame-100 vs
 *  frame-400 IoU is 0.87. Fold positions differ, as they do between Blender runs with different thread
 *  counts. */
export const SILK: ClothParams = {
  sheetX: 5, sheetY: 8, cellsX: 100, cellsY: 160, liftZ: 0.012, pinRadius: 0.051,
  vertexMass: 0.15, compliance: 3e-5, shearCompliance: 3e-5, bendCompliance: 1e5, iterations: 8,
  linearDamping: 1.0, friction: 0.5, vertexRadius: 0.005, frames: 100, fps: 24, substeps: 8,
};

export interface ClothResult {
  /** Cloth node positions after the last frame, row-major (cellsY + 1) x (cellsX + 1) x 3. */
  positions: Float64Array;
  rows: number; cols: number;
  /** Largest node displacement during the last frame (scene units), a settledness measure. */
  lastFrameMotion: number;
  seconds: number;
}

const LAYER_STATIC = 0, LAYER_MOVING = 1;

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
  bodies.CreateAndAddBody(figSettings, J.EActivation_DontActivate);
  J.destroy(figSettings); J.destroy(vl); J.destroy(tl); J.destroy(it); J.destroy(ms);

  // Cloth sheet.
  const cols = p.cellsX + 1, rows = p.cellsY + 1, dx = p.sheetX / p.cellsX, dy = p.sheetY / p.cellsY;
  const shared = new J.SoftBodySharedSettings(), v = new J.SoftBodySharedSettingsVertex();
  const z = 1 + p.liftZ;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = -p.sheetX / 2 + i * dx, y = -p.sheetY / 2 + j * dy;
    f3.x = x; f3.y = y; f3.z = z; v.mPosition = f3;
    v.mInvMass = Math.abs(x) < p.pinRadius && Math.abs(y) < p.pinRadius ? 0 : 1 / p.vertexMass;
    shared.mVertices.push_back(v);
  }
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
  const read = (out: Float64Array): void => {
    const verts = motion.GetVertices();
    for (let k = 0; k < rows * cols; k++) {
      const q = verts.at(k).mPosition; out[k * 3] = q.GetX(); out[k * 3 + 1] = q.GetY(); out[k * 3 + 2] = q.GetZ();
    }
  };
  const step = 1 / (p.fps * p.substeps);
  const prev = new Float64Array(rows * cols * 3), cur = new Float64Array(rows * cols * 3);
  let lastMotion = NaN;
  for (let fr = 1; fr <= p.frames; fr++) {
    if (fr === p.frames) read(prev);
    for (let s = 0; s < p.substeps; s++) jolt.Step(step, 1);
    if (onFrame && onFrame(fr, p.frames) === false) break;
  }
  read(cur);
  for (let k = 0; k < cur.length; k += 3) {
    const m = Math.hypot(cur[k] - prev[k], cur[k + 1] - prev[k + 1], cur[k + 2] - prev[k + 2]);
    if (!(m <= lastMotion)) lastMotion = m;
  }
  bodies.RemoveBody(cloth.GetID()); bodies.DestroyBody(cloth.GetID());
  J.destroy(jolt);
  return { positions: cur, rows, cols, lastFrameMotion: lastMotion, seconds: (Date.now() - t0) / 1000 };
}
