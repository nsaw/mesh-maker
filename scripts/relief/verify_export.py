"""Verify an exported relief STL inside Blender against its .mcrelief master, independently of
MeshCraft's code: the master is decoded here with NumPy (format: src/relief-master.ts), the STL is
read by Blender's own importer, and every comparison is made in panel inches.

  Blender -b --factory-startup --python-exit-code 1 --python scripts/relief/verify_export.py -- \
      MASTER.mcrelief EXPORT.stl REPORT.json [--npy SOURCE_HEIGHTS.npy] [--samples 200000] \
      [--sections y1,y2,...] [--face x0,y0,x1,y1]

Checks: master checksum (and bit equality with the source .npy when given); STL facet count;
dimensions and orientation of every top vertex against its master node; backing; surface samples
BETWEEN grid vertices by ray casting, against the master's declared triangulation (and, as a
control, against the other diagonal); cross-sections; closed two-manifold with consistently
oriented faces, Euler characteristic 2, positive volume equal to the master's, no zero-area faces.
Exits non-zero if any check fails.
"""
import hashlib, json, struct, sys
import numpy as np
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
master_path, stl_path, report_path = argv[:3]
opts = {argv[i]: argv[i + 1] for i in range(3, len(argv) - 1, 2)}
UNITS_PER_IN = {'in': 1.0, 'mm': 25.4, 'm': 0.0254}
report = {'master': master_path, 'stl': stl_path, 'blender': bpy.app.version_string, 'checks': {}}
failures = []


def check(name, ok, **detail):
    report['checks'][name] = {'ok': bool(ok), **detail}
    print(('ok   ' if ok else 'FAIL ') + name + ' ' + json.dumps(detail))
    if not ok:
        failures.append(name)


# ---------- decode the master (independent of MeshCraft) ----------
raw = open(master_path, 'rb').read()
assert raw[:8] == b'MCRELIEF', 'not a .mcrelief file'
hlen = struct.unpack('<I', raw[8:12])[0]
H = json.loads(raw[12:12 + hlen].decode('utf-8'))
start = -(-(12 + hlen) // 8) * 8
dt = np.dtype('<f4') if H['dtype'] == 'float32' else np.dtype('<f8')
n = H['cols'] * H['rows']
hb = raw[start:start + n * dt.itemsize]
check('master_checksum', hashlib.sha256(hb).hexdigest() == H['sha256']['heights'])
stored = np.frombuffer(hb, dtype=dt).reshape(H['rows'], H['cols'])
if '--npy' in opts:
    src = np.load(opts['--npy'])
    check('master_equals_source_npy_bitwise', src.dtype == stored.dtype and np.array_equal(src, stored),
          source=opts['--npy'], dtype=str(src.dtype))
k = UNITS_PER_IN[H['units']]
cols, rows = H['cols'], H['rows']
W, Hh = H['width'] / k, H['height'] / k
dx, dy = W / (cols - 1), Hh / (rows - 1)
# Bottom-up grid (row 0 at Y = 0), inches.
grid = stored.astype(np.float64) / k
if H['rowOrder'] == 'top-down':
    grid = grid[::-1]
backing, stock = H['backing'] / k, H['stock'] / k
report['master_header'] = {x: H[x] for x in ('cols', 'rows', 'units', 'width', 'height', 'rowOrder', 'triangulation', 'backing', 'stock')}

# ---------- import the STL with Blender's importer ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
stl_count = struct.unpack('<I', open(stl_path, 'rb').read(84)[80:84])[0]
bpy.ops.wm.stl_import(filepath=stl_path, global_scale=1.0, use_scene_unit=False,
                      forward_axis='Y', up_axis='Z', use_mesh_validate=False)
obj = bpy.context.selected_objects[0]
me = obj.data
nv, nf = len(me.vertices), len(me.polygons)
check('facet_count', nf == stl_count, blender_faces=nf, stl_header=stl_count)
co = np.empty(nv * 3, dtype=np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3).astype(np.float64)
fv = np.empty(nf * 3, dtype=np.int64); me.polygons.foreach_get('vertices', fv); fv = fv.reshape(-1, 3)
# Weld exact duplicates (an STL is a triangle soup; the importer may or may not merge).
uco, inv = np.unique(co, axis=0, return_inverse=True)
fv = inv.reshape(-1)[fv]
report['vertices'] = {'imported': nv, 'welded': len(uco)}

lo, hi = uco.min(0), uco.max(0)
check('dimensions', abs(lo[0]) < 1e-5 and abs(lo[1]) < 1e-5 and abs(lo[2]) < 1e-9
      and abs(hi[0] - W) < 1e-5 and abs(hi[1] - Hh) < 1e-5 and abs(hi[2] - grid.max()) < 1e-6,
      bbox_min=lo.tolist(), bbox_max=hi.tolist(), expected=[W, Hh, float(grid.max())])

# ---------- every top vertex against its master node ----------
top = uco[uco[:, 2] > 0]
ii, jj = np.rint(top[:, 0] / dx).astype(np.int64), np.rint(top[:, 1] / dy).astype(np.int64)
xy_err = max(np.abs(top[:, 0] - ii * dx).max(), np.abs(top[:, 1] - jj * dy).max())
covered = len(np.unique(jj * cols + ii)) == cols * rows and len(top) == cols * rows
zerr = top[:, 2] - grid[jj, ii]
check('top_vertices_one_per_node', covered and xy_err < 1e-5, top_vertices=len(top), nodes=cols * rows, max_xy_error_in=float(xy_err))
check('top_heights_match_master', np.abs(zerr).max() <= 1e-6, max_abs_error_in=float(np.abs(zerr).max()),
      rms_error_in=float(np.sqrt((zerr ** 2).mean())), note='float32 STL storage, about 3e-8 in at 0.75 in')
# The same comparison against mirrored / inverted masters must fail by a wide margin, or the check
# above could not have caught those mistakes.
alt = {'x_mirror': grid[:, ::-1], 'y_mirror': grid[::-1, :], 'depth_inverted': grid.max() + grid.min() - grid}
alt_err = {name: float(np.abs(top[:, 2] - g[jj, ii]).max()) for name, g in alt.items()}
check('orientation_discriminates', min(alt_err.values()) > 1000 * max(1e-9, float(np.abs(zerr).max())), control_max_errors_in=alt_err)
check('backing_once', abs(top[:, 2].min() - grid.min()) < 1e-6 and abs(grid.min() - backing) < 1e-6 and top[:, 2].max() <= stock + 1e-6,
      top_min_in=float(top[:, 2].min()), backing_in=backing, top_max_in=float(top[:, 2].max()), stock_in=stock)

# ---------- surface between vertices ----------
deps = bpy.context.evaluated_depsgraph_get()
bvh = BVHTree.FromObject(obj, deps)


def master_surface(x, y, diag):
    u, v = x / dx, y / dy
    i0 = np.minimum(np.floor(u).astype(np.int64), cols - 2); j0 = np.minimum(np.floor(v).astype(np.int64), rows - 2)
    fx, fy = u - i0, v - j0
    z00, z10, z01, z11 = grid[j0, i0], grid[j0, i0 + 1], grid[j0 + 1, i0], grid[j0 + 1, i0 + 1]
    if diag == 'tr-bl':   # MeshCraft z00-z11
        lower = fy <= fx
        return np.where(lower, z00 + fx * (z10 - z00) + fy * (z11 - z10), z00 + fy * (z01 - z00) + fx * (z11 - z01))
    upper = fx + fy >= 1  # z10-z01 diagonal
    return np.where(upper, z11 + (1 - fx) * (z01 - z11) + (1 - fy) * (z10 - z11), z00 + fx * (z10 - z00) + fy * (z01 - z00))


def local_slope(x, y):
    """Steepest edge slope of the cell containing each point (in/in)."""
    i0 = np.minimum(np.floor(x / dx).astype(np.int64), cols - 2); j0 = np.minimum(np.floor(y / dy).astype(np.int64), rows - 2)
    z00, z10, z01, z11 = grid[j0, i0], grid[j0, i0 + 1], grid[j0 + 1, i0], grid[j0 + 1, i0 + 1]
    return np.maximum.reduce([np.abs(z10 - z00) / dx, np.abs(z01 - z00) / dy, np.abs(z11 - z01) / dx,
                              np.abs(z11 - z10) / dy, np.abs(z11 - z00) / np.hypot(dx, dy), np.abs(z10 - z01) / np.hypot(dx, dy)])


# Blender stores vertices, ray origins and hits in float32: a horizontal position is good to about
# 1e-6 in at 24 in, so on a wall of slope s the height read back can differ by s x that.
POS_TOL, Z_TOL = 4e-6, 2e-6


def raycast(x, y):
    out = np.full(len(x), np.nan)
    down, z0 = Vector((0, 0, -1)), stock + 1.0
    for q in range(len(x)):
        hit = bvh.ray_cast(Vector((x[q], y[q], z0)), down, z0 + 1)
        if hit[0] is not None:
            out[q] = hit[0].z
    return out


rng = np.random.default_rng(20261020)
ns = int(opts.get('--samples', 200000))
sx, sy = rng.uniform(dx * 0.01, W - dx * 0.01, ns), rng.uniform(dy * 0.01, Hh - dy * 0.01, ns)
zr = raycast(sx, sy)
declared = H['triangulation']
other = 'tl-br' if declared == 'tr-bl' else 'tr-bl'
e_decl = np.abs(zr - master_surface(sx, sy, declared))
e_other = np.abs(zr - master_surface(sx, sy, other))
allow = Z_TOL + POS_TOL * local_slope(sx, sy)
check('between_vertices_match_declared_triangulation', np.isfinite(zr).all() and (e_decl <= allow).all(),
      samples=ns, missed=int(np.isnan(zr).sum()), max_abs_error_in=float(np.nanmax(e_decl)), rms_in=float(np.sqrt(np.nanmean(e_decl ** 2))),
      worst_error_over_allowance=float(np.nanmax(e_decl / allow)),
      control_other_diagonal_over_allowance_p99=float(np.nanpercentile(e_other / allow, 99)),
      control_other_diagonal_max_in=float(np.nanmax(e_other)), control_other_diagonal_p99_in=float(np.nanpercentile(e_other, 99)))
if '--face' in opts:
    x0, y0, x1, y1 = map(float, opts['--face'].split(','))
    sel = (sx >= x0) & (sx <= x1) & (sy >= y0) & (sy <= y1)
    check('face_between_vertices', sel.sum() > 0 and (e_decl[sel] <= allow[sel]).all(), samples=int(sel.sum()),
          max_abs_error_in=float(np.nanmax(e_decl[sel])), control_other_diagonal_max_in=float(np.nanmax(e_other[sel])))

sections = [float(s) for s in opts['--sections'].split(',')] if '--sections' in opts else list(np.linspace(0.1, 0.9, 5) * Hh)
sec_report = []
for ys in sections:
    xs = np.linspace(dx * 0.01, W - dx * 0.01, 4 * cols)
    zs = raycast(xs, np.full_like(xs, ys))
    yv = np.full_like(xs, ys)
    err = np.abs(zs - master_surface(xs, yv, declared))
    ratio = err / (Z_TOL + POS_TOL * local_slope(xs, yv))
    sec_report.append({'y_in': ys, 'max_abs_error_in': float(np.nanmax(err)), 'worst_error_over_allowance': float(np.nanmax(ratio)),
                       'missed': int(np.isnan(zs).sum()), 'relief_range_in': float(np.nanmax(zs) - np.nanmin(zs))})
check('cross_sections', all(s['worst_error_over_allowance'] <= 1 and s['missed'] == 0 for s in sec_report), sections=sec_report)

# ---------- closed, oriented, non-degenerate ----------
nw = len(uco)
d_edges = np.concatenate([fv[:, [0, 1]], fv[:, [1, 2]], fv[:, [2, 0]]])
dkey = d_edges[:, 0] * nw + d_edges[:, 1]
rkey = d_edges[:, 1] * nw + d_edges[:, 0]
sd = np.sort(dkey)
no_dup_directed = not (sd[1:] == sd[:-1]).any()
paired = np.isin(rkey, dkey, assume_unique=False).all()
und = np.unique(np.minimum(d_edges[:, 0], d_edges[:, 1]) * nw + np.maximum(d_edges[:, 0], d_edges[:, 1]))
euler = nw - len(und) + len(fv)
check('closed_two_manifold_consistent_orientation', no_dup_directed and paired and len(d_edges) == 2 * len(und),
      directed_edges=len(d_edges), undirected_edges=len(und))
check('euler_characteristic_2', euler == 2, euler=int(euler))
a, b, c = uco[fv[:, 0]], uco[fv[:, 1]], uco[fv[:, 2]]
cr = np.cross(b - a, c - a)
area = 0.5 * np.linalg.norm(cr, axis=1)
vol = float(np.einsum('ij,ij->i', a, np.cross(b, c)).sum() / 6)
# Expected volume: the master's triangulated heightfield over the panel (each cell = two triangles).
z00, z10, z01, z11 = grid[:-1, :-1], grid[:-1, 1:], grid[1:, :-1], grid[1:, 1:]
cell = dx * dy / 2
exp_vol = float(((z00 + z10 + z11) / 3 + (z00 + z11 + z01) / 3).sum() * cell) if declared == 'tr-bl' else \
    float(((z00 + z10 + z01) / 3 + (z10 + z11 + z01) / 3).sum() * cell)
check('outward_positive_volume', vol > 0 and abs(vol - exp_vol) / exp_vol < 1e-6, volume_in3=vol, expected_in3=exp_vol)
check('no_zero_area_faces', area.min() > 0, min_area_in2=float(area.min()))

report['failures'] = failures
json.dump(report, open(report_path, 'w'), indent=2)
print('RESULT', 'PASS' if not failures else 'FAIL ' + ','.join(failures))
sys.exit(1 if failures else 0)
