"""Export a figure for MeshCraft's Drape tab as a .mcfig file: the same placement blender_drape.py applies
(azimuth about Z, scale, measured pose, crown at (0, 0, 1)), tilt left to the app. Cropped below `crop_z`.
Layout: b'MCFIG\\0\\0\\0', uint32 header length, JSON header, pad to 8, float32 xyz positions, uint32 triangles.
Blender -b --factory-startup --python export_figure.py -- '{"input":..., "out":..., "azimuth_deg":..., "scale":..., "pose":..., "crop_z":..., "head_height":..., "name":..., "license":..., "source":...}'"""
import json, sys, math, hashlib, struct
from pathlib import Path
import bpy, numpy as np
from mathutils import Matrix, Vector
A = json.loads(sys.argv[sys.argv.index('--') + 1])
bpy.ops.wm.read_factory_settings(use_empty=True); sc = bpy.context.scene
src = Path(A['input']); bpy.ops.import_scene.gltf(filepath=str(src)) if src.suffix.lower() in ('.glb', '.gltf') else bpy.ops.wm.stl_import(filepath=str(src))
ms = [o for o in sc.objects if o.type == 'MESH']
world = [o.matrix_world @ v.co for o in ms for v in o.data.vertices]; apex = max(world, key=lambda p: p.z).copy()
Rz = Matrix.Rotation(math.radians(A['azimuth_deg']), 3, 'Z'); PM = Matrix(json.loads(Path(A['pose']).read_text())['rigid_pose_rotation_rows']) if A.get('pose') else Matrix.Identity(3)
V = []; F = []
for o in ms:
    off = len(V); o.data.calc_loop_triangles()
    V.extend([PM @ (Rz @ ((o.matrix_world @ v.co) - apex) * A['scale']) for v in o.data.vertices]); F.extend([tuple(off + i for i in t.vertices) for t in o.data.loop_triangles])
top = max(V, key=lambda p: p.z).copy(); P = np.array([tuple(p - top + Vector((0, 0, 1))) for p in V], np.float32); T = np.array(F, np.int64)
head = P[P[:, 2] > P[:, 2].max() - A['head_height']]; hc = head.mean(axis=0)
keep_t = (P[T][:, :, 2] > A['crop_z']).any(axis=1); T = T[keep_t]
used = np.unique(T); remap = -np.ones(len(P), np.int64); remap[used] = np.arange(len(used)); P = P[used]; T = remap[T].astype(np.uint32)
hdr = dict(format='meshcraft-figure', version=1, units='scene', up='+Z', facing='-Y', crown=[0, 0, 1], head_centre=hc.tolist(), head_height=A['head_height'],
           vertices=int(len(P)), triangles=int(len(T)), name=A.get('name'), source=A.get('source'), license=A.get('license'),
           placement=dict(azimuth_deg=A['azimuth_deg'], scale=A['scale'], pose=A.get('pose'), crop_z=A['crop_z']), source_sha256=hashlib.sha256(src.read_bytes()).hexdigest())
hj = json.dumps(hdr, separators=(',', ':')).encode(); start = -(-(12 + len(hj)) // 8) * 8
with open(A['out'], 'wb') as f:
    f.write(b'MCFIG\0\0\0' + struct.pack('<I', len(hj)) + hj + b'\0' * (start - 12 - len(hj)) + P.astype('<f4').tobytes() + T.astype('<u4').tobytes())
print('FIG', json.dumps({k: hdr[k] for k in ('vertices', 'triangles', 'head_centre')}), Path(A['out']).stat().st_size)
