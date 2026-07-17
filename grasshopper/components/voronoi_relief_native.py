#! python 2
# GhPython component script -- MeshCraft | Voronoi Relief (native) -- V2
# Runtime: IronPython 2.7 (Rhino 7)
#
# Generates a Voronoi cell relief using REAL Rhino geometry (not a per-pixel
# distance-field sampler like the web app). Produces:
#   - a height-field grid that drops into MeshCraft | Shape unchanged
#   - the underlying Voronoi cell curves for Brep editing or baking
#
# V2 (v18 parity with the web sampler's boundary-distance construction):
#   - BOUNDARY-DISTANCE WALLS: d_b = (d2-d1)/2 is the true distance to the
#     shared Voronoi boundary; the wall spans seam_depth of the per-cell
#     inradius from the crest plateau to the inset polygonal floor. Every
#     interior point is crest, wall, or floor -- no neutral gaps, connected
#     tessellation with shared ridges.
#   - BASE SUPERPOSITION: cells are carved INTO a smooth value-noise wave
#     (base_amp / base_freq) so ridge tops undulate instead of sitting on a
#     flat reference plane.
#   - CREST PLATEAU: wall_width sets a small physical plateau on the shared
#     boundary (crest_w = wall_width * cell_size / 2).
#   - DENSITY NOISE: density_noise / density_noise_freq modulate the local
#     Bridson radius so giant and small cells coexist (multi-scale patches).
#   - PER-CELL DEPTH: wall extent normalizes against the per-cell inradius
#     (closed form: half the nearest-neighbor site distance), so dense patches
#     read proportionally shallower -- the reference's size-to-depth coupling.
#   - jitter input is LIVE: it randomizes the local Bridson radius +/-30% for
#     cell-size variety (it was reserved/unused in V1).
#   - ghcomp.Voronoi is called with KEYWORD arguments (positional args bound
#     the boundary curve to the component's Radius input) and wrapped in
#     try/except: if node-in-code fails, Lloyd relaxation falls back to a
#     Halton-sample centroid pass and `cells` outputs [] -- the height field
#     NEVER depends on ghcomp.
#
# Pipeline:
#   sites (Bridson rejection w/ attractor + density-noise radius)
#     -> Lloyd relaxation (ghcomp.Voronoi centroids, Halton fallback)
#     -> per-cell inradius (nearest-neighbor half-distance)
#     -> kNN-3 per grid pixel (d1, d2, d3) -> d_b -> crest/wall/floor
#     -> profile bowl -> + base wave -> renormalize [0,1]
#
# Inputs:
#   mesh_x, mesh_y       (float)  panel dimensions
#   resolution           (int)    grid res along the longer axis (default 128)
#   cell_size            (float)  target avg cell radius; depth normalization baseline
#   jitter               (float)  0..1 local radius randomization (cell-size variety)
#   relax_iter           (int)    Lloyd relaxation passes (0..4 typical)
#   attractor_pt         (Point3d) optional density attractor; None disables
#   attractor_radius     (float)  influence radius (panel units)
#   density_strength     (float)  0..1 -- how much density rises near attractor
#   seed                 (int)    RNG seed
#   profile              (str)    'parabolic-bowl'|'spherical-cap'|'cone'|'cosine'
#   polarity             (str)    'pockets' (cells dip down) | 'domes' (cells rise up)
#   seam_sharpness       (float)  0..1 -- extra V-groove sharpening near ridge
#   seam_depth           (float)  wall extent as a fraction of the remaining
#                                 per-cell inradius (v18: 0.5 => walls span half
#                                 the crest-to-center distance, floor the rest)
#   base_amp             (float)  base wave amplitude (0 = flat, like V1)
#   base_freq            (float)  base wave spatial frequency (per panel unit)
#   wall_width           (float)  0..0.9 -- ridge crest plateau width fraction
#   density_noise        (float)  0..1.5 -- patchy cell-size noise amount
#   density_noise_freq   (float)  patch spatial frequency (per panel unit)
#
# Outputs:
#   z_values             DataTree[float]  normalized [0,1], plugs into Shape
#   cols, rows           int              passthrough to Shape
#   mesh_x, mesh_y       float            passthrough to Shape
#   sites                list[Point3d]    generated site centers (post-relax)
#   cells                list[Curve]      Voronoi cell curves ([] if ghcomp failed)
#
# Notes:
# - z_values is normalized [0,1]. Wire into Shape with `amplitude` = ridge
#   height above the deepest cell point. `offset` shifts the whole field.
# - O(N_sites^2) site rejection + O(grid * N_sites) pixel sampling. For
#   ~200 sites at 128x96 grid, expect 3-8 sec in IronPython. If too slow,
#   port the inner loops to MeshCraftNoise.dll.

import Rhino
import Rhino.Geometry as rg
import ghpythonlib.components as ghcomp
import math
import random
from Grasshopper import DataTree
from Grasshopper.Kernel.Data import GH_Path
from System.Collections.Generic import List as NetList

# Defaults ------------------------------------------------------------------
if mesh_x             is None: mesh_x             = 24.0
if mesh_y             is None: mesh_y             = 36.0
if resolution         is None: resolution         = 128
if cell_size          is None: cell_size          = 2.5
if jitter             is None: jitter             = 0.85
if relax_iter         is None: relax_iter         = 2
if attractor_pt       is None: attractor_pt       = None
if attractor_radius   is None: attractor_radius   = 8.0
if density_strength   is None: density_strength   = 0.4
if seed               is None: seed               = 12345
if profile            is None: profile            = 'parabolic-bowl'
if polarity           is None: polarity           = 'pockets'
if seam_sharpness     is None: seam_sharpness     = 0.0
if seam_depth         is None: seam_depth         = 0.5
if base_amp           is None: base_amp           = 0.0
if base_freq          is None: base_freq          = 0.05
if wall_width         is None: wall_width         = 0.0
if density_noise      is None: density_noise      = 0.0
if density_noise_freq is None: density_noise_freq = 0.08
if pillow             is None: pillow             = 0.0
if pillow_coverage    is None: pillow_coverage    = 0.6
if depth_variation    is None: depth_variation    = 0.0
if junction_lift      is None: junction_lift      = 0.0
if crest_variation    is None: crest_variation    = 0.0

mesh_x             = float(mesh_x)
mesh_y             = float(mesh_y)
# Upper bounds cap user-controlled work: grid cells scale with resolution^2 and
# each Lloyd pass repeats the full Voronoi/centroid cost.
resolution         = max(8, min(512, int(resolution)))
cell_size          = max(0.05, float(cell_size))
jitter             = max(0.0, min(1.0, float(jitter)))
relax_iter         = max(0, min(6, int(relax_iter)))
attractor_radius   = max(0.01, float(attractor_radius))
density_strength   = max(0.0, min(1.0, float(density_strength)))
seed               = int(seed)
profile            = str(profile).lower()
polarity           = str(polarity).lower()
seam_sharpness     = max(0.0, min(1.0, float(seam_sharpness)))
seam_depth         = max(0.05, min(1.0, float(seam_depth)))
base_amp           = max(0.0, min(2.0, float(base_amp)))
base_freq          = max(0.005, min(2.0, float(base_freq)))
wall_width         = max(0.0, min(0.9, float(wall_width)))
density_noise      = max(0.0, min(1.5, float(density_noise)))
density_noise_freq = max(0.005, min(2.0, float(density_noise_freq)))
pillow             = max(0.0, min(1.0, float(pillow)))
pillow_coverage    = max(0.0, min(1.0, float(pillow_coverage)))
depth_variation    = max(0.0, min(1.0, float(depth_variation)))
junction_lift      = max(0.0, min(1.0, float(junction_lift)))
crest_variation    = max(0.0, min(1.0, float(crest_variation)))

# Grid dimensions: longer axis gets `resolution`, shorter axis scales to keep
# square pixels.
if mesh_x >= mesh_y:
    g_cols = int(resolution)
    g_rows = max(2, int(round(resolution * (mesh_y / mesh_x))))
else:
    g_rows = int(resolution)
    g_cols = max(2, int(round(resolution * (mesh_x / mesh_y))))

# Deterministic value noise (hash lattice + smoothstep bilinear) -------------
# Self-contained -- no dependency on noise_gen.py. Used for the base wave and
# the density-noise field.
def _vn_hash(ix, iy, s):
    h = (ix * 374761393 + iy * 668265263 + s * 1442695041) & 0xffffffff
    h = (h ^ (h >> 13)) & 0xffffffff
    h = (h * 1274126177) & 0xffffffff
    h = (h ^ (h >> 16)) & 0xffffffff
    return (h / 4294967295.0) * 2.0 - 1.0

def _cell_hash01(idx, s):
    # Deterministic per-cell hash in [0, 1) from the owning site index (pillow gating).
    h = (((idx + 1) * 374761393) + ((s & 0xffffffff) * 668265263)) & 0xffffffff
    h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
    # 2^32 denominator keeps the result in [0, 1) -- dividing by 2^32-1 can return
    # exactly 1.0, which would fail the `< pillow_coverage` gate even at coverage 1.
    return float((h ^ (h >> 16)) & 0xffffffff) / 4294967296.0

def vnoise(x, y, s):
    ix = int(math.floor(x)); iy = int(math.floor(y))
    fx = x - ix; fy = y - iy
    sx = fx * fx * (3.0 - 2.0 * fx)
    sy = fy * fy * (3.0 - 2.0 * fy)
    a = _vn_hash(ix,     iy,     s)
    b = _vn_hash(ix + 1, iy,     s)
    c = _vn_hash(ix,     iy + 1, s)
    d = _vn_hash(ix + 1, iy + 1, s)
    return (a * (1.0 - sx) * (1.0 - sy) + b * sx * (1.0 - sy)
            + c * (1.0 - sx) * sy + d * sx * sy)

# Site generation -----------------------------------------------------------
# Bridson-style rejection sampling with locally-variable minimum distance.
# Density attractor + density noise shrink/grow the local radius.
random.seed(seed)

ax = attractor_pt.X if attractor_pt is not None else 0.0
ay = attractor_pt.Y if attractor_pt is not None else 0.0
inv_ar2 = 1.0 / (attractor_radius * attractor_radius)
attractor_enabled = attractor_pt is not None and density_strength > 0.0

def attractor_w(x, y):
    if not attractor_enabled:
        return 0.0
    dx = x - ax
    dy = y - ay
    t2 = (dx * dx + dy * dy) * inv_ar2
    if t2 >= 1.0:
        return 0.0
    t = math.sqrt(t2)
    u = 1.0 - t
    return u * u * u * (10.0 - 15.0 * u + 6.0 * u * u)

def _edge_hash01(a, b, seed):
    # v21 per-EDGE hash. ORDERED (a, b) gives each side of a shared ridge its own value;
    # pass (min, max) for a value both sides agree on (crest strength).
    return _cell_hash01(((a + 1) * 7919 + b + 1) & 0x7fffffff, seed)

def local_min_dist(x, y):
    w = attractor_w(x, y)
    # At w=1, local radius shrinks to (1 - density_strength) of cell_size,
    # floored at 15% so site count doesn't explode.
    factor = 1.0 - density_strength * w
    r = cell_size * max(0.15, factor)
    # v16 density noise: patchy multi-scale cell sizes. Positive noise shrinks
    # the radius (denser), negative grows it (giant cells).
    if density_noise > 0.0:
        n = vnoise(x * density_noise_freq, y * density_noise_freq, seed + 71)
        r /= max(0.5, 1.0 + density_noise * n)
        # v17 heavy-tail spikes: abrupt scale jumps (hash-gated, deterministic).
        hcell = _cell_hash01(int(x * 7.13) * 31 + int(y * 7.13), seed + 41)
        if hcell < 0.03 * density_noise: r *= 0.45
        elif hcell < 0.08 * density_noise: r *= 2.2
    return r

target_sites = (mesh_x * mesh_y) / max(0.01, cell_size * cell_size)
n_candidates = int(min(8000, max(80, target_sites * 6.0)))

sites = []
killed_reserve = []
suppress_freq = 0.16 / max(0.2, cell_size)
for _k in xrange(n_candidates):
    cx = random.random() * mesh_x
    cy = random.random() * mesh_y
    # v19 giant merged cells: the same low-frequency field that melts depth in the
    # height pass (seed+103) deletes candidate sites — several neighboring cells merge
    # into one giant territory whose surviving perimeter walls read as long sweeping
    # creases across the calm zone.
    if depth_variation > 0.0:
        sn01 = (vnoise(cx * suppress_freq, cy * suppress_freq, seed + 103) + 1.0) * 0.5
        st = (sn01 - 0.66) / 0.14
        if st < 0.0: st = 0.0
        elif st > 1.0: st = 1.0
        st = st * st * (3.0 - 2.0 * st)
        if random.random() < 0.9 * depth_variation * st:
            if len(killed_reserve) < 8:
                killed_reserve.append((cx, cy))
            continue
    rmin = local_min_dist(cx, cy)
    # jitter randomizes the local radius +/-30% (symmetric) -- cell-size variety
    # (V1 kept this input reserved/unused; V2 makes it live).
    if jitter > 0.0:
        rmin *= (1.0 + 0.3 * jitter * (2.0 * random.random() - 1.0))
    r2 = rmin * rmin
    ok = True
    for s in sites:
        dx = s.X - cx
        dy = s.Y - cy
        if dx * dx + dy * dy < r2:
            ok = False
            break
    if ok:
        sites.append(rg.Point3d(cx, cy, 0.0))

# Minimum-site floor: suppression deletion is independent per candidate, so a
# small panel inside a strong field could reject every candidate -- restore
# deleted positions (deterministic order) so the component degrades to giant
# merged cells, never to a zero-site failure.
_ri = 0
while len(sites) < 3 and _ri < len(killed_reserve):
    sites.append(rg.Point3d(killed_reserve[_ri][0], killed_reserve[_ri][1], 0.0))
    _ri += 1

# Voronoi cells + Lloyd relaxation -----------------------------------------
def make_boundary():
    return rg.Rectangle3d(
        rg.Plane.WorldXY,
        rg.Interval(0.0, mesh_x),
        rg.Interval(0.0, mesh_y),
    ).ToNurbsCurve()

bnd_crv = make_boundary()

def compute_cells(pts):
    # KEYWORD args -- the GH Voronoi component's inputs are (Points, Radius,
    # Boundary, Plane); V1's positional call bound the boundary curve to the
    # Radius input. Keyword binding is input-order-proof. Returns None when
    # node-in-code is unavailable/fails -- callers fall back.
    try:
        return ghcomp.Voronoi(points=pts, boundary=bnd_crv)
    except Exception:
        return None

def _halton(index, base):
    result = 0.0
    f = 1.0 / base
    i = index
    while i > 0:
        result += f * (i % base)
        i = int(i // base)
        f /= base
    return result

def lloyd_fallback(pts):
    # Halton-sample centroid pass (mirrors the web sampler's lloydRelax) --
    # keeps relaxation working when ghcomp.Voronoi is unavailable.
    n = len(pts)
    if n == 0:
        return pts
    samples = min(8192, n * 64)
    sum_x = [0.0] * n
    sum_y = [0.0] * n
    counts = [0] * n
    for si in xrange(samples):
        x = _halton(si + 1, 2) * mesh_x
        y = _halton(si + 1, 3) * mesh_y
        best = 0
        best_d = 1.0e30
        for i in xrange(n):
            dx = pts[i].X - x
            dy = pts[i].Y - y
            d = dx * dx + dy * dy
            if d < best_d:
                best_d = d
                best = i
        sum_x[best] += x
        sum_y[best] += y
        counts[best] += 1
    out = []
    for i in xrange(n):
        if counts[i] > 0:
            out.append(rg.Point3d(sum_x[i] / counts[i], sum_y[i] / counts[i], 0.0))
        else:
            out.append(pts[i])
    return out

ghcomp_ok = True
for _iter in xrange(relax_iter):
    cells_iter = compute_cells(sites)
    if cells_iter is None:
        ghcomp_ok = False
        sites = lloyd_fallback(sites)
        continue
    new_sites = []
    for i in xrange(len(sites)):
        cell = cells_iter[i] if i < len(cells_iter) else None
        if cell is None:
            new_sites.append(sites[i])
            continue
        amp = rg.AreaMassProperties.Compute(cell)
        if amp is None:
            new_sites.append(sites[i])
        else:
            c = amp.Centroid
            cx = max(0.0, min(mesh_x, c.X))
            cy = max(0.0, min(mesh_y, c.Y))
            new_sites.append(rg.Point3d(cx, cy, 0.0))
    sites = new_sites

cells_final = compute_cells(sites) if ghcomp_ok else None
if cells_final is None:
    cells_final = []

# Height-field sampling -----------------------------------------------------
# For each pixel: d1, d2 to the two nearest sites; ridge sits at d1 == d2.
# Normalized ridge distance t -> wall band -> profile bowl -> + base wave.
def profile_fn(t):
    if t < 0.0: t = 0.0
    elif t > 1.0: t = 1.0
    if profile == 'cone':
        out = t
    elif profile == 'spherical-cap':
        out = math.sqrt(max(0.0, 2.0 * t - t * t))
    elif profile == 'cosine':
        out = 0.5 * (1.0 - math.cos(math.pi * t))
    else:  # 'parabolic-bowl' (default)
        out = 2.0 * t - t * t
    if seam_sharpness > 0.0 and t < 0.5:
        k = 2.0 + 6.0 * seam_sharpness
        sharp = 1.0 - pow(1.0 - 2.0 * t, k)
        out = out * (1.0 - seam_sharpness) + max(out, sharp) * seam_sharpness
    return out

n_sites = len(sites)

dx_pix = mesh_x / float(g_cols - 1) if g_cols > 1 else mesh_x
dy_pix = mesh_y / float(g_rows - 1) if g_rows > 1 else mesh_y

total = g_cols * g_rows
z_arr = [0.0] * total
# v23 membrane-cushion buffers.
cush_a = [0.0] * total
cush_owner = [-1] * total

# Cache site coords as plain floats -- attribute access on Point3d in a tight
# IronPython loop is ~2x slower than indexing flat lists.
sx = [s.X for s in sites]
sy = [s.Y for s in sites]

# v18 per-cell INRADIUS proxy: half the distance from the site to its nearest
# neighboring site — the exact boundary distance evaluated AT the site. The true
# cell maximum (at the incenter) can slightly exceed this when the incenter is
# off-site; the small underestimate only makes floors marginally larger. O(n^2)
# on a few hundred sites is negligible next to the pixel loop.
inradius = [cell_size * 0.5] * n_sites
for k in xrange(n_sites):
    best = 1.0e30
    for m in xrange(n_sites):
        if m == k: continue
        dx = sx[m] - sx[k]
        dy = sy[m] - sy[k]
        dd = dx * dx + dy * dy
        if dd < best: best = dd
    if best < 1.0e30:
        inradius[k] = math.sqrt(best) * 0.5

# v17 size-depth coupling: bigger cells carve somewhat deeper. The per-cell inradius
# doubles as the size proxy; normalize against the median so the multiplier is scale-free.
sorted_inr = sorted(inradius)
median_inr = max(0.05, sorted_inr[n_sites // 2])
size_mul_cell = [0.0] * n_sites
for k in xrange(n_sites):
    sm = math.sqrt(inradius[k] / median_inr)
    if sm < 0.8: sm = 0.8
    elif sm > 1.2: sm = 1.2
    # v21.1 continuous depth class + SLOPE BUDGET (a cell only carves as deep as its
    # walls can descend at the aesthetic ceiling; small cells become shallow dimples).
    tier_mul = 1.0
    if depth_variation > 0.0:
        h_depth = _cell_hash01(k, seed + 13)
        tier_mul = 1.0 - depth_variation * (1.0 - (0.45 + 0.65 * h_depth))
    # Conservative: final modifiers can narrow the wall to ~0.65x this estimate.
    w_typ = seam_depth * inradius[k] * 0.52
    if w_typ < 0.05: w_typ = 0.05
    budget = 0.55 * w_typ
    if budget > 1.0: budget = 1.0
    size_mul_cell[k] = sm * tier_mul * budget

wall_noise_freq = 0.45 / max(0.2, cell_size)
crest_freq = 0.25 / max(0.2, cell_size)
suppress_freq = 0.16 / max(0.2, cell_size)

for j in xrange(g_rows):
    py = j * dy_pix
    row_off = j * g_cols
    for i in xrange(g_cols):
        px = i * dx_pix
        best1 = 1.0e30
        best2 = 1.0e30
        best3 = 1.0e30
        best4 = 1.0e30
        owner = 0
        owner2 = -1
        owner3 = -1
        owner4 = -1
        for k in xrange(n_sites):
            dx = sx[k] - px
            dy = sy[k] - py
            d2v = dx * dx + dy * dy
            if d2v < best1:
                best4 = best3
                owner4 = owner3
                best3 = best2
                owner3 = owner2
                best2 = best1
                owner2 = owner
                best1 = d2v
                owner = k
            elif d2v < best2:
                best4 = best3
                owner4 = owner3
                best3 = best2
                owner3 = owner2
                best2 = d2v
                owner2 = k
            elif d2v < best3:
                best4 = best3
                owner4 = owner3
                best3 = d2v
                owner3 = k
            elif d2v < best4:
                best4 = d2v
                owner4 = k
        if best2 >= 1.0e30: owner2 = -1
        if best3 >= 1.0e30: owner3 = -1
        if best4 >= 1.0e30: owner4 = -1
        d1 = math.sqrt(best1)
        d3 = math.sqrt(best3) if best3 < 1.0e30 else 1.0e15
        # v18 BOUNDARY-DISTANCE CONSTRUCTION. d_b is the EXACT distance to the shared
        # Voronoi boundary: the bisector distance (dk^2 - d1^2)/(2*|sk - s1|), minimized
        # over the two nearest competitors (the third catches corner regions). Its level
        # sets are true inset polygons of the cell, so floors keep polygonal ancestry.
        # The wall extent w is normalized per cell against the inradius: every interior
        # point is crest, wall, or floor — no neutral gaps, and shrinking floors WIDENS
        # walls. Squared distances feed the formula directly (dk^2 - d1^2 = best_k - best1).
        db_cap = mesh_x + mesh_y
        db2v = db_cap
        db3v = db_cap
        db4v = db_cap
        if owner2 >= 0:
            dxs = sx[owner2] - sx[owner]
            dys = sy[owner2] - sy[owner]
            db2v = (best2 - best1) / (2.0 * max(1e-9, math.sqrt(dxs * dxs + dys * dys)))
        if owner3 >= 0:
            dxs = sx[owner3] - sx[owner]
            dys = sy[owner3] - sy[owner]
            db3v = (best3 - best1) / (2.0 * max(1e-9, math.sqrt(dxs * dxs + dys * dys)))
        if owner4 >= 0:
            dxs = sx[owner4] - sx[owner]
            dys = sy[owner4] - sy[owner]
            db4v = (best4 - best1) / (2.0 * max(1e-9, math.sqrt(dxs * dxs + dys * dys)))
        db = min(db2v, db3v, db4v)
        # v21 per-edge fields, blended across the corner-ray transition.
        nb2 = owner2 if owner2 >= 0 else owner
        nb3 = owner3 if owner3 >= 0 else nb2
        e2_side = _edge_hash01(owner, nb2, seed + 59)
        e2_shared = _edge_hash01(min(owner, nb2), max(owner, nb2), seed + 53)
        e3_side = _edge_hash01(owner, nb3, seed + 59)
        e3_shared = _edge_hash01(min(owner, nb3), max(owner, nb3), seed + 53)
        # Symmetric interpolation (bisector distances need not preserve d2/d3 ordering).
        emr = (db3v - db2v) / max(1e-9, db3v + db2v)
        ema = emr if emr >= 0.0 else -emr
        if ema > 0.3: ema = 0.3
        ema = ema / 0.3
        ema = ema * ema * (3.0 - 2.0 * ema)
        edge_mix = 0.5 + 0.5 * ema if emr >= 0.0 else 0.5 - 0.5 * ema
        edge_side = edge_mix * e2_side + (1.0 - edge_mix) * e3_side
        edge_shared = edge_mix * e2_shared + (1.0 - edge_mix) * e3_shared
        dt = (edge_shared - 0.06) / 0.24
        if dt < 0.0: dt = 0.0
        elif dt > 1.0: dt = 1.0
        dt = dt * dt * (3.0 - 2.0 * dt)
        dissolve = (1.0 - dt) * 0.7
        inr = inradius[owner]
        if inr < 0.01: inr = 0.01
        # Scale-free junction proximity: (d3-d1)/(d3+d1) -> 0 at three-way corners.
        jn = 1.0 - min(1.0, (d3 - d1) / max(1e-9, d3 + d1))
        jn_s = (jn - 0.65) / 0.33
        if jn_s < 0.0: jn_s = 0.0
        elif jn_s > 1.0: jn_s = 1.0
        jn_s = jn_s * jn_s * (3.0 - 2.0 * jn_s)
        # v21.1: dissolution fades near junction corners (pairwise blend ill-conditioned
        # there; references dissolve boundaries MID-EDGE while nodes survive).
        jg = (jn - 0.45) / 0.3
        if jg < 0.0: jg = 0.0
        elif jg > 1.0: jg = 1.0
        jg = jg * jg * (3.0 - 2.0 * jg)
        dissolve *= (1.0 - jg)
        # v21.1 blended static depth multiplier + boundary-fading tilt weight (per-cell
        # factors must not step across dissolved boundaries).
        owner_mix = 0.5 + 0.5 * min(1.0, db / max(1e-6, 0.35 * inr))
        nb_mul = edge_mix * size_mul_cell[nb2] + (1.0 - edge_mix) * size_mul_cell[nb3]
        static_mul_blended = owner_mix * size_mul_cell[owner] + (1.0 - owner_mix) * nb_mul
        owner_fade = 2.0 * owner_mix - 1.0
        if owner_fade < 0.0: owner_fade = 0.0
        # Ridge crest band: a physical plateau on the shared boundary. The plateau
        # width SWINGS along each edge with the wall-noise field (chunky-to-thin
        # ridges) and widens toward junctions.
        crest_w = wall_width * max(0.2, cell_size) * 0.5
        # Wall extent = seam_depth fraction of the remaining inradius, varied per
        # cell (asymmetric neighbors), along each edge (noise), at junctions (wider).
        wall_scale = 0.7 + 0.7 * edge_side
        if depth_variation > 0.0:
            h_seam = _cell_hash01(owner, seed + 29)
            wall_scale *= 1.0 + (h_seam - 0.5) * 0.8 * depth_variation
        if wall_width > 0.0:
            wn = vnoise(px * wall_noise_freq, py * wall_noise_freq, seed + 83)
            wall_scale *= max(0.3, 1.0 + 0.6 * wn + 1.1 * jn_s)
            # Junction DELTAS use a wider gate than the lift term: the plateau flares
            # well before the corner into bold triangular Y-masses.
            jn_w = (jn - 0.55) / 0.4
            if jn_w < 0.0: jn_w = 0.0
            elif jn_w > 1.0: jn_w = 1.0
            jn_w = jn_w * jn_w * (3.0 - 2.0 * jn_w)
            crest_w *= max(0.15, 1.0 + 1.2 * wn + 6.0 * junction_lift * jn_w)
        # v21.1: crest leaves a resolvable wall span; wall extent floors at the
        # physical minimum feature size (never derived from grid resolution).
        cw_cap = inr - 0.3
        if cw_cap < 0.0: cw_cap = 0.0
        if crest_w > 0.6 * inr: crest_w = 0.6 * inr
        if crest_w > cw_cap: crest_w = cw_cap
        w = seam_depth * max(0.02, inr - crest_w) * wall_scale
        if w < 0.3: w = 0.3
        tw_raw = (db - crest_w) / w
        if tw_raw < 0.0: tw_raw = 0.0
        # Smooth floor saturation (C1 fillet) instead of a hard clamp.
        FILLET_BAND = 0.2
        if tw_raw >= 1.0 + FILLET_BAND:
            tw = 1.0
        elif tw_raw <= 1.0 - FILLET_BAND:
            tw = tw_raw
        else:
            e = 1.0 + FILLET_BAND - tw_raw
            tw = 1.0 - (e * e) / (4.0 * FILLET_BAND)
        if tw < 0.0: tw = 0.0
        if profile == 'cosine':
            # v21 per-edge profile family: shallow shoulder, broad descent, steeper
            # lower third — no two walls share exactly the same cross-section.
            cos_h = 0.5 * (1.0 - math.cos(math.pi * tw))
            # Tempered so the blended profile's PEAK slope stays <= ~1.9x mean.
            late_h = pow(tw, 1.5 + 0.6 * edge_shared)
            prof_mix = 0.15 + 0.45 * edge_side
            v = (1.0 - prof_mix) * cos_h + prof_mix * late_h
        else:
            v = profile_fn(tw)
        # v21 edge dissolution: weak edges melt toward floor level — adjacent cells
        # blend into one shared basin.
        if dissolve > 0.0:
            v += (1.0 - v) * dissolve
        # v16.1 pillowed floors: past saturation (tw_raw > 1) the floor rises back into a
        # soft central mound. Per-cell hash gates coverage; mound height varies per cell.
        # v23 membrane cushions: record the amplitude chain; the crown SHAPE comes from
        # a Poisson relaxation after the pixel loop (no medial-axis trace).
        cushion_amp = 0.0
        if pillow > 0.0 and tw_raw > 1.25:
            st_sz = (inradius[owner] / max(0.05, median_inr) - 0.9) / 0.9
            if st_sz < 0.0: st_sz = 0.0
            elif st_sz > 1.0: st_sz = 1.0
            st_sz = st_sz * st_sz * (3.0 - 2.0 * st_sz)
            if st_sz > 0.0:
                field_v = (vnoise(sx[owner] * 0.045, sy[owner] * 0.045, seed + 61) + 1.0) * 0.5
                # Coverage 0 must fully disable cushions.
                if pillow_coverage <= 0.0:
                    field_v = -1.0
                cg = (field_v - (0.8 - pillow_coverage)) / 0.4
                if cg < 0.0: cg = 0.0
                elif cg > 1.0: cg = 1.0
                cg = cg * cg * (3.0 - 2.0 * cg)
                if cg > 0.0:
                    amt_var = 0.55 + 0.45 * field_v
                    cushion_amp = pillow * amt_var * 0.28 * st_sz * cg
        # v17 depth composition: size coupling (bigger cells carve deeper, per-cell
        # inradius vs median) + depth tiers + SPATIAL suppression (clusters of cells
        # melt into masses).
        # v21.1: size + depth class + slope budget come pre-blended (static). Spatial
        # suppression stays direct (continuous field).
        cell_depth_mul = static_mul_blended
        if depth_variation > 0.0:
            sn = (vnoise(px * suppress_freq, py * suppress_freq, seed + 103) + 1.0) * 0.5
            st = (sn - 0.62) / 0.2
            if st < 0.0: st = 0.0
            elif st > 1.0: st = 1.0
            st = st * st * (3.0 - 2.0 * st)
            cell_depth_mul *= 1.0 - 0.5 * depth_variation * st
        # v19 scooped floors: per-cell hash-direction tilt shifts each pocket's deepest
        # point off-center — steep wall on one flank, long ramp on the other. Purely
        # reductive (shallow flank ramps up); factor is 1 at the boundary (v = 0).
        if depth_variation > 0.0 and v > 0.0:
            tilt_ang = vnoise(sx[owner] * 0.045 + 37.1, sy[owner] * 0.045 + 11.7, seed + 61) * math.pi * 2.0
            rad = max(0.2, inradius[owner] * 2.0)
            tilt = (math.cos(tilt_ang) * (px - sx[owner])
                    + math.sin(tilt_ang) * (py - sy[owner])) / rad
            tilt_t = (max(-0.9, min(0.9, tilt)) + 0.9) / 1.8
            v *= 1.0 - 0.7 * depth_variation * tilt_t * v * owner_fade
        v = v * cell_depth_mul
        # v16 base superposition: ridge tops follow the wave (z_cell = 1 at
        # ridge for pockets), then the whole field renormalizes to [0,1].
        base = base_amp * vnoise(px * base_freq, py * base_freq, seed + 99)
        # v17 crest variation (ridge-local envelope fragmentation) + tamed junction lift.
        crest = 0.0
        if crest_variation > 0.0:
            crest = crest_variation * 0.4 * vnoise(px * crest_freq, py * crest_freq, seed + 97) * pow(1.0 - v, 1.5)
        lift = junction_lift * 0.1 * jn_s * (1.0 - v) if junction_lift > 0.0 else 0.0
        lift += crest
        # v20 ridge crown: rounded bead over the crest band — dome peaking on the shared
        # boundary. Melted zones keep ghost creases (0.35 floor on the bead scale).
        crown_term = 0.0
        crown_w = crest_w
        if crown_w < 0.25: crown_w = 0.25
        if wall_width > 0.0 and crest_w > 1e-6 and db < crown_w:
            ct = db / crown_w
            ct = ct * ct * (3.0 - 2.0 * ct)
            crown_term = 0.15 * (1.0 - ct) * (0.35 + 0.65 * cell_depth_mul) * (0.35 + 0.9 * edge_shared) * (1.0 - dissolve)
        if cushion_amp > 0.0:
            cush_a[row_off + i] = cushion_amp * cell_depth_mul
            cush_owner[row_off + i] = owner
        if polarity == 'domes':
            z_arr[row_off + i] = base + v + lift - crown_term
        else:
            zc = base + (1.0 - v) + lift + crown_term
            # v21 stock-plane soft cap: positive excursions above the local stock face
            # (base + 1) saturate into flat plateaus; junction fins become saddles.
            hp = zc - (base + 1.0)
            if hp > 0.04:
                zc = base + 1.0 + 0.04 + 0.13 * math.tanh((hp - 0.04) / 0.13)
            z_arr[row_off + i] = zc

# v23 membrane cushion pass: SOR-relaxed Poisson over cushion pixels (u=0 clamped
# at the gutter ring), per-cell normalization, quintic composition. Pockets floors
# rise; domes floors recede.
_any_cush = False
for _cv in cush_a:
    if _cv > 0.0:
        _any_cush = True
        break
if _any_cush:
    u_mem = [0.0] * total
    # Symmetric SOR: alternate forward/reverse sweeps (unbiased at fixed count).
    for _sweep in xrange(80):
        if _sweep % 2 == 0:
            row_iter = xrange(1, g_rows - 1)
            col_iter = xrange(1, g_cols - 1)
        else:
            row_iter = xrange(g_rows - 2, 0, -1)
            col_iter = xrange(g_cols - 2, 0, -1)
        for j in row_iter:
            off = j * g_cols
            for i in col_iter:
                idx0 = off + i
                if cush_a[idx0] <= 0.0:
                    continue
                target = 0.25 * (u_mem[idx0 - 1] + u_mem[idx0 + 1] + u_mem[idx0 - g_cols] + u_mem[idx0 + g_cols]) + 1.0
                u_mem[idx0] = u_mem[idx0] + 1.8 * (target - u_mem[idx0])
    u_max = [0.0] * n_sites
    for idx0 in xrange(total):
        o = cush_owner[idx0]
        if o >= 0 and u_mem[idx0] > u_max[o]:
            u_max[o] = u_mem[idx0]
    for idx0 in xrange(total):
        if cush_a[idx0] <= 0.0:
            continue
        o = cush_owner[idx0]
        if o < 0 or u_max[o] <= 1e-9:
            continue
        un = u_mem[idx0] / u_max[o]
        wv = un * un * un * (un * (un * 6.0 - 15.0) + 10.0)
        if polarity == 'domes':
            z_arr[idx0] -= cush_a[idx0] * wv
        else:
            z_arr[idx0] += cush_a[idx0] * wv

# Renormalize to [0,1] -- Shape expects a normalized field; the base wave
# pushes values outside the raw [0,1] band.
z_min = min(z_arr)
z_max = max(z_arr)
z_span = z_max - z_min
if z_span > 1e-12:
    inv_span = 1.0 / z_span
    for idx in xrange(total):
        z_arr[idx] = (z_arr[idx] - z_min) * inv_span

# Outputs ------------------------------------------------------------------
# DataTree[float] is the only output type that survives GhPython serialization
# at 10K+ items. See ghpython-dll-optimization.md (silent output data loss).
z_tree = DataTree[float]()
z_tree.AddRange(NetList[float](z_arr), GH_Path(0))

z_values = z_tree
cols     = g_cols
rows     = g_rows
mesh_x   = mesh_x
mesh_y   = mesh_y
sites    = sites
cells    = list(cells_final) if cells_final is not None else []
