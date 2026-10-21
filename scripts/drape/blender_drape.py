"""Drape a silk veil over a complete 3D figure and extract its front relief. Runs inside Blender 5.2.

Called by workflow.py; arguments after `--` are one JSON object (see workflow.py for the keys).

Construction, all in Blender scene units (Z up, the figure faces -Y):
  1. Import the figure (.glb/.gltf/.obj/.stl), rotate it about Z by `azimuth_deg`, scale by `scale`, apply
     the optional measured pose (3x3 rows) so the face is vertical, then tilt the face up by `tilt_deg`
     about the head centre. The highest point (the crown) goes to (0, 0, 1).
  2. A flat 5 x 8 unit sheet, 100 x 160 quads, 0.012 units above the crown; its nine centre vertices are
     hooked to the figure (the crown attachment). Blender's installed Silk cloth preset, solver quality 8,
     object and self collision 0.003, gravity -9.81 Z.
  3. Optional wet cling: a surface force field on the figure, `cling_strength` (negative attracts),
     felt within `cling_reach` units. It is an art convention, not cloth physics.
  4. silk-gathered overrides bend, gap and quality and animates gathering. Optional calibrated
     quartering wind adds finite surface panels (no collisions). See README for schedules.
     Bake `frames` frames, read frame `frame`.
  5. Orthographic rays along +Y over a 12 x 16 aspect window (`frame_width` units wide, top at z 1.2);
     frontmost of the veil (with 2-level display subdivision) and the figure, plus the bare figure alone.
Writes in `out`: drape.blend, front.png, oblique.png, veiled-depth.npy, bare-depth.npy, cloth-front.npy,
drape.json (requested controls plus applied material/collision/field values), setup.blend, cloth-nodes.npz.
"""
import ast, hashlib, json, math, sys, time
from pathlib import Path
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from quartering_wind import create_emitter, validate_profile

A = json.loads(sys.argv[sys.argv.index('--') + 1]); OUT = Path(A['out']); OUT.mkdir(parents=True, exist_ok=True); t0 = time.time()
CODE_HASHES = {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
               for name in ('blender_drape.py', 'workflow.py', 'quartering_wind.py')}
bpy.ops.wm.read_factory_settings(use_empty=True); sc = bpy.context.scene
sc.frame_start = 1; sc.frame_end = A['frames']; sc.gravity = (0, 0, -9.81)

src = Path(A['input']); ext = src.suffix.lower()
if ext in ('.glb', '.gltf'): bpy.ops.import_scene.gltf(filepath=str(src))
elif ext == '.obj': bpy.ops.wm.obj_import(filepath=str(src))
elif ext == '.stl': bpy.ops.wm.stl_import(filepath=str(src))
else: raise SystemExit(f'unsupported input {ext}: use .glb, .gltf, .obj or .stl')
meshes = [o for o in sc.objects if o.type == 'MESH']
if not meshes: raise SystemExit('input has no mesh')
world = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]; apex = max(world, key=lambda p: p.z).copy()
Rz = Matrix.Rotation(math.radians(A['azimuth_deg']), 3, 'Z'); V = []; F = []
for o in meshes:
    off = len(V); o.data.calc_loop_triangles()
    V.extend([Rz @ ((o.matrix_world @ v.co) - apex) * A['scale'] for v in o.data.vertices])
    F.extend([tuple(off + i for i in t.vertices) for t in o.data.loop_triangles])
if A.get('pose_rows'):
    PM = Matrix(A['pose_rows']); V = [PM @ p for p in V]
ztop = max(p.z for p in V); head = [p for p in V if p.z > ztop - A['head_height']]; hc = sum(head, Vector()) / len(head)
# Face looks toward -Y; tilting it up turns the crown toward +Y (rotation about X through the head centre).
TM = Matrix.Rotation(math.radians(-A['tilt_deg']), 3, 'X'); V = [TM @ (p - hc) + hc for p in V]
top = max(V, key=lambda p: p.z).copy(); V = [p - top + Vector((0, 0, 1)) for p in V]
for o in list(sc.objects): bpy.data.objects.remove(o, do_unlink=True)
me = bpy.data.meshes.new('figure'); me.from_pydata(V, [], F); me.update()
fig = bpy.data.objects.new('Figure collision', me); sc.collection.objects.link(fig)
gathered = A['preset'] == 'silk-gathered'
fig.modifiers.new('Collision', 'COLLISION'); fig.collision.thickness_outer = .001 if gathered else .002
if A['cling_strength']:
    fig.field.type = 'FORCE'; fig.field.shape = 'SURFACE'; fig.field.strength = A['cling_strength']
    fig.field.use_max_distance = True; fig.field.distance_max = A['cling_reach']; fig.field.falloff_type = 'SPHERE'
    if gathered:
        # Artistic gathering control: let gravity form folds before surface attraction ramps up.
        for frame, strength in ((1, 0), (45, 0), (100, A['cling_strength']), (150, A['cling_strength'])):
            fig.field.strength = strength
            fig.field.keyframe_insert('strength', frame=frame)

NX, NY, SP = 100, 160, .05
PV = [(-2.5 + i * SP, -4 + j * SP, 0) for j in range(NY + 1) for i in range(NX + 1)]
PF = [(j * (NX + 1) + i, j * (NX + 1) + i + 1, (j + 1) * (NX + 1) + i + 1, (j + 1) * (NX + 1) + i) for j in range(NY) for i in range(NX)]
pm = bpy.data.meshes.new('veil'); pm.from_pydata(PV, [], PF); pm.update()
veil = bpy.data.objects.new('Veil silk', pm); sc.collection.objects.link(veil); veil.location = (0, 0, 1.012)
pins = [v.index for v in veil.data.vertices if abs(v.co.x) < .051 and abs(v.co.y) < .051]
assert len(pins) == 9, pins
vg = veil.vertex_groups.new(name='Pins'); vg.add(pins, 1.0, 'REPLACE'); bpy.context.view_layer.update()
hook = veil.modifiers.new('Hook crown attachment', 'HOOK'); hook.object = fig; hook.vertex_group = 'Pins'
hook.vertex_indices_set(pins); hook.falloff_type = 'NONE'; hook.matrix_inverse = fig.matrix_world.inverted() @ veil.matrix_world
mod = veil.modifiers.new('Cloth', 'CLOTH'); s = mod.settings; cs = mod.collision_settings
PRESET = Path(bpy.utils.resource_path('LOCAL')) / 'scripts/presets/cloth/Silk.py'
for st in ast.parse(PRESET.read_text()).body:
    if isinstance(st, ast.Assign): setattr(s, st.targets[0].attr, ast.literal_eval(st.value))
s.quality = 12 if gathered else 8; s.vertex_group_mass = 'Pins'
if gathered: s.bending_stiffness = .0025
cs.use_self_collision = A.get('self_collision', True); cs.distance_min = .001 if gathered else .003; cs.self_distance_min = .003; cs.collision_quality = 6 if gathered else 4
mod.point_cache.frame_end = A['frames']
for o in (fig, veil):
    for p in o.data.polygons: p.use_smooth = True
sub = veil.modifiers.new('Subdivision after Cloth', 'SUBSURF'); sub.levels = sub.render_levels = 2
wind = None
if A.get('quartering_wind'):
    control = A['quartering_wind']
    validate_profile(control['profile'], A)
    wind = create_emitter(control['profile'], control['strength'], sc)
if gathered: sub.show_viewport = sub.show_render = False
sc.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'setup.blend'))
with bpy.context.temp_override(scene=sc, object=veil, point_cache=mod.point_cache): bpy.ops.ptcache.bake(bake=True)
if not mod.point_cache.is_baked: raise SystemExit('cloth cache did not bake')
# Save raw simulation nodes, independent of display subdivision, and measure one-frame motion.
sub.show_viewport = False
samples = {}
for frame in sorted({A['frame']-1, A['frame'], A['frames']-1, A['frames']}):
    sc.frame_set(frame); bpy.context.view_layer.update()
    ev = veil.evaluated_get(bpy.context.evaluated_depsgraph_get())
    xyz = np.empty(len(ev.data.vertices)*3, dtype=np.float32)
    ev.data.vertices.foreach_get('co', xyz)
    samples[str(frame)] = xyz.reshape(-1, 3)
np.savez(OUT / 'cloth-nodes.npz', **samples)
sc.frame_set(A['frame'])
sub.show_viewport = sub.show_render = True
for o, col in ((fig, (.18, .3, .4, 1)), (veil, (.82, .79, .72, 1))):
    m = bpy.data.materials.new(o.name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (.64, .61, .56, 1) if gathered else col; b.inputs['Roughness'].default_value = .7 if gathered else .65; o.data.materials.append(m)

# Front relief extraction.
deps = bpy.context.evaluated_depsgraph_get()
def bvh_of(o):
    ev = o.evaluated_get(deps); m = ev.to_mesh(); m.calc_loop_triangles()
    b = BVHTree.FromPolygons([o.matrix_world @ v.co for v in m.vertices], [tuple(t.vertices) for t in m.loop_triangles]); ev.to_mesh_clear(); return b
bv, bf = bvh_of(veil), bvh_of(fig)
W = A['frame_width']; X0, X1, Z1 = -W / 2, W / 2, 1.2; Z0 = Z1 - W * 16 / 12; C, R = 1201, 1601
xs = np.linspace(X0, X1, C); zs = np.linspace(Z1, Z0, R)
veiled = np.full((R, C), np.nan); bare = np.full((R, C), np.nan); front = np.zeros((R, C), bool); d = Vector((0, 1, 0))
for j in range(R):
    for i in range(C):
        o = Vector((float(xs[i]), -30.0, float(zs[j]))); hf = bf.ray_cast(o, d, 60.0); hv = bv.ray_cast(o, d, 60.0)
        yf = hf[0].y if hf[0] is not None else None; yv = hv[0].y if hv[0] is not None else None
        if yf is not None: bare[j, i] = -yf
        c = [y for y in (yf, yv) if y is not None]
        if c: veiled[j, i] = -min(c); front[j, i] = yv is not None and (yf is None or yv <= yf)
np.save(OUT / 'veiled-depth.npy', veiled); np.save(OUT / 'bare-depth.npy', bare); np.save(OUT / 'cloth-front.npy', front)

def finite_or_none(x):
    """A diverged solve leaves NaN nodes; JSON has no NaN, so the report records null instead."""
    return x if math.isfinite(x) else None

rep = dict(args=A, blender=bpy.app.version_string, blender_build=bpy.app.build_hash.decode(), threads=sc.render.threads,
           max_node_motion_units={str(frame): finite_or_none(float(np.linalg.norm(samples[str(frame)]-samples[str(frame-1)], axis=1).max()))
                                  for frame in (A['frame'], A['frames'])}, silk_preset=str(PRESET), silk_preset_sha256=hashlib.sha256(PRESET.read_bytes()).hexdigest(),
           workflow_sha256=CODE_HASHES,
           input_sha256=hashlib.sha256(src.read_bytes()).hexdigest(), figure_vertices=len(V), veil_vertices=len(PV), pinned=pins,
           cloth={k: getattr(s, k) for k in ('quality', 'mass', 'tension_stiffness', 'compression_stiffness', 'shear_stiffness', 'bending_stiffness', 'air_damping')},
           collision=dict(object=cs.distance_min, self=cs.self_distance_min, self_collision=cs.use_self_collision, figure_outer=fig.collision.thickness_outer, quality=cs.collision_quality),
           cling=dict(type=fig.field.type, shape=fig.field.shape, strength=fig.field.strength, reach=fig.field.distance_max) if A['cling_strength'] else None,
           baked=mod.point_cache.is_baked, frame=sc.frame_current, window=dict(x=[X0, X1], z=[Z0, Z1], cols=C, rows=R, row_order='top-down', col_order='camera-right'),
           foreground_fraction=float(np.isfinite(veiled).mean()), veil_front_fraction=float(front.mean()))

if wind:
    f = wind.field
    rep['quartering_wind'] = dict(requested_strength=A['quartering_wind']['strength'], strength_at_frame=f.strength,
        type=f.type, shape=f.shape, flow=f.flow, noise=f.noise, falloff=f.falloff_type, power=f.falloff_power,
        reach=f.distance_max, surface_modifier=any(m.type == 'SURFACE' for m in wind.modifiers),
        direction_world=A['quartering_wind']['profile']['wind_world'],
        support_min_world_x=validate_profile(A['quartering_wind']['profile'], A))
else: rep['quartering_wind'] = None

# Previews.
sc.world = bpy.data.worlds.new('W'); sc.world.use_nodes = True
sc.world.node_tree.nodes['Background'].inputs[0].default_value = (.13, .13, .13, 1); sc.world.node_tree.nodes['Background'].inputs[1].default_value = .3
target = Vector((0, 0, -.3))
bpy.ops.object.camera_add(location=(0, -11, -.3)); cam = bpy.context.object; sc.camera = cam; cam.data.type = 'ORTHO'; cam.data.ortho_scale = W
for loc, pw, sz in (((-4, -5, 7), 1100, 4), ((4, 2, 4), 450, 3)):
    bpy.ops.object.light_add(type='AREA', location=loc); l = bpy.context.object; l.data.energy = pw; l.data.size = sz
    l.rotation_euler = (target - l.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.engine = 'CYCLES'; sc.cycles.samples = 32; sc.cycles.use_denoising = True; sc.render.resolution_x = sc.render.resolution_y = 900
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'drape.blend'))
for name, loc, aim, size in (('front', (0, -11, -.3), target, W),
                              ('oblique', (5, -10, .5), target, W),
                              ('face', (0, -10, 4.3), Vector((0, -.4, -.3)), 2.5)):
    cam.location = loc; cam.rotation_euler = (aim - cam.location).to_track_quat('-Z', 'Y').to_euler(); cam.data.ortho_scale = size
    sc.render.filepath = str(OUT / f'{name}.png'); bpy.ops.render.render(write_still=True)
rep['seconds'] = round(time.time() - t0, 1)
(OUT / 'drape.json').write_text(json.dumps(rep, indent=1, allow_nan=False)); print('DRAPE_DONE', json.dumps(dict(out=str(OUT), seconds=rep['seconds'])), flush=True)
