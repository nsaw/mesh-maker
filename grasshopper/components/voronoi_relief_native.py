#! python 2
# GhPython component script -- MeshCraft | Voronoi Relief (native)
# Runtime: IronPython 2.7 (Rhino 7)
#
# Generates a Voronoi cell relief using REAL Rhino geometry (not a per-pixel
# distance-field sampler like the web app). Produces:
#   - a height-field grid that drops into MeshCraft | Shape unchanged
#   - the underlying Voronoi cell curves for Brep editing or baking
#
# Pipeline:
#   sites (Bridson rejection w/ attractor-driven density)
#     -> Lloyd relaxation via ghcomp.Voronoi
#     -> kNN-2 per grid pixel (d1, d2) -> ridge distance d2-d1
#     -> profile(d_seam / cell_size) gives bowl shape per cell
#
# Inputs:
#   mesh_x, mesh_y     (float)  panel dimensions
#   resolution         (int)    grid res along the longer axis (default 128)
#   cell_size          (float)  target avg cell radius; also normalizes depth
#   jitter             (float)  unused for V1 (Bridson is inherently jittered)
#   relax_iter         (int)    Lloyd relaxation passes (0..4 typical)
#   attractor_pt       (Point3d) optional density attractor; None disables
#   attractor_radius   (float)  influence radius (panel units)
#   density_strength   (float)  0..1 -- how much density rises near attractor
#                                  (1.0 = cells shrink to 15% of cell_size at center)
#   seed               (int)    RNG seed
#   depth              (float)  max relief depth (signed, see polarity)
#   profile            (str)    'parabolic-bowl'|'spherical-cap'|'cone'|'cosine'
#   polarity           (str)    'pockets' (cells dip down) | 'domes' (cells rise up)
#   seam_sharpness     (float)  0..1 -- extra V-groove sharpening near ridge
#
# Outputs:
#   z_values           DataTree[float]  normalized [0,1], plugs into Shape
#   cols, rows         int              passthrough to Shape
#   mesh_x, mesh_y     float            passthrough to Shape
#   sites              list[Point3d]    generated site centers (post-relax)
#   cells              list[Curve]      Voronoi cell boundary curves
#
# Notes:
# - z_values is normalized [0,1]. Wire into Shape with `amplitude` = ridge
#   height above the deepest cell point. `offset` shifts the whole field.
# - For "carved bowls" (reference image), polarity='pockets' produces z=1 at
#   ridge and z=0 at cell center. Shape's amplitude becomes the ridge-to-floor
#   range. Set `offset` to whatever you want the wood-surface (ridge) z to be.
# - cells output lets you bake per-cell curves to Rhino for hand-edit, fillet,
#   or run a separate Brep loft per cell if you want true NURBS surfaces.
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
if mesh_x           is None: mesh_x           = 24.0
if mesh_y           is None: mesh_y           = 36.0
if resolution       is None: resolution       = 128
if cell_size        is None: cell_size        = 2.5
if jitter           is None: jitter           = 0.85
if relax_iter       is None: relax_iter       = 2
if attractor_pt     is None: attractor_pt     = None
if attractor_radius is None: attractor_radius = 8.0
if density_strength is None: density_strength = 0.4
if seed             is None: seed             = 12345
if depth            is None: depth            = 0.4
if profile          is None: profile          = 'parabolic-bowl'
if polarity         is None: polarity         = 'pockets'
if seam_sharpness   is None: seam_sharpness   = 0.0

mesh_x           = float(mesh_x)
mesh_y           = float(mesh_y)
resolution       = max(8, int(resolution))
cell_size        = max(0.05, float(cell_size))
jitter           = max(0.0, min(1.0, float(jitter)))
relax_iter       = max(0, int(relax_iter))
attractor_radius = max(0.01, float(attractor_radius))
density_strength = max(0.0, min(1.0, float(density_strength)))
seed             = int(seed)
depth            = float(depth)
profile          = str(profile).lower()
polarity         = str(polarity).lower()
seam_sharpness   = max(0.0, min(1.0, float(seam_sharpness)))

# Grid dimensions: longer axis gets `resolution`, shorter axis scales to keep
# square pixels.
if mesh_x >= mesh_y:
    g_cols = int(resolution)
    g_rows = max(2, int(round(resolution * (mesh_y / mesh_x))))
else:
    g_rows = int(resolution)
    g_cols = max(2, int(round(resolution * (mesh_x / mesh_y))))

# Site generation -----------------------------------------------------------
# Bridson-style rejection sampling with locally-variable minimum distance.
# Density attractor shrinks the local radius -> more cells near attractor.
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
    # Smooth quintic falloff -- continuous 1st + 2nd derivatives at t=0,1
    t = math.sqrt(t2)
    u = 1.0 - t
    return u * u * u * (10.0 - 15.0 * u + 6.0 * u * u)  # actually smoothstep^2-ish

def local_min_dist(x, y):
    w = attractor_w(x, y)
    # At w=1, local radius shrinks to (1 - density_strength) of cell_size,
    # floored at 15% so site count doesn't explode.
    factor = 1.0 - density_strength * w
    return cell_size * max(0.15, factor)

# Candidate budget: target ~(panel_area / cell_area) sites, oversample 6x for
# rejection misses. Capped at 8000 to keep IronPython runtime bounded.
target_sites = (mesh_x * mesh_y) / max(0.01, cell_size * cell_size)
n_candidates = int(min(8000, max(80, target_sites * 6.0)))

sites = []
for _k in xrange(n_candidates):
    cx = random.random() * mesh_x
    cy = random.random() * mesh_y
    rmin = local_min_dist(cx, cy)
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

# Voronoi cells + Lloyd relaxation -----------------------------------------
def make_boundary():
    return rg.Rectangle3d(
        rg.Plane.WorldXY,
        rg.Interval(0.0, mesh_x),
        rg.Interval(0.0, mesh_y),
    ).ToNurbsCurve()

bnd_crv = make_boundary()

def compute_cells(pts):
    # ghcomp.Voronoi handles point list + boundary clip. Returns a flat
    # list of cell curves (one per input point, same index).
    return ghcomp.Voronoi(pts, bnd_crv)

for _iter in xrange(relax_iter):
    cells_iter = compute_cells(sites)
    if cells_iter is None:
        break
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
            # Keep centroid inside panel bounds.
            cx = max(0.0, min(mesh_x, c.X))
            cy = max(0.0, min(mesh_y, c.Y))
            new_sites.append(rg.Point3d(cx, cy, 0.0))
    sites = new_sites

cells_final = compute_cells(sites)
if cells_final is None:
    cells_final = []

# Height-field sampling -----------------------------------------------------
# For each pixel, find d1, d2 to the two nearest sites. The Voronoi ridge
# sits where d1 == d2 (i.e. d2 - d1 == 0). Normalized ridge distance t in
# [0,1] drives the per-cell profile shape.
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
    # Seam sharpening: lift the curve near t=0 toward 1.0 -- gives a sharper
    # V-groove at the ridge without changing the cell-interior shape.
    if seam_sharpness > 0.0 and t < 0.5:
        # Blend out -> max(out, sharp(t)) where sharp = (1 - (1-2t)^k)
        k = 2.0 + 6.0 * seam_sharpness
        sharp = 1.0 - pow(1.0 - 2.0 * t, k)
        out = out * (1.0 - seam_sharpness) + max(out, sharp) * seam_sharpness
    return out

inv_norm = 1.0 / cell_size
n_sites = len(sites)

dx_pix = mesh_x / float(g_cols - 1) if g_cols > 1 else mesh_x
dy_pix = mesh_y / float(g_rows - 1) if g_rows > 1 else mesh_y

total = g_cols * g_rows
z_arr = [0.0] * total

# Cache site coords as plain floats -- attribute access on Point3d in a tight
# IronPython loop is ~2x slower than indexing flat lists.
sx = [s.X for s in sites]
sy = [s.Y for s in sites]

for j in xrange(g_rows):
    py = j * dy_pix
    row_off = j * g_cols
    for i in xrange(g_cols):
        px = i * dx_pix
        # kNN-2 brute force. For n_sites < ~500 this beats RTree round-trips.
        best1 = 1.0e30
        best2 = 1.0e30
        for k in xrange(n_sites):
            dx = sx[k] - px
            dy = sy[k] - py
            d2v = dx * dx + dy * dy
            if d2v < best1:
                best2 = best1
                best1 = d2v
            elif d2v < best2:
                best2 = d2v
        d1 = math.sqrt(best1)
        d2 = math.sqrt(best2)
        d_seam = d2 - d1
        t = d_seam * inv_norm
        if t > 1.0: t = 1.0
        elif t < 0.0: t = 0.0
        v = profile_fn(t)
        # Polarity: 'pockets' (default, reference image) -> ridge=1 (top of
        # wood), cell center=0 (deepest carve).
        # 'domes' inverts -> cells rise up out of base plane.
        if polarity == 'domes':
            z_arr[row_off + i] = v
        else:
            z_arr[row_off + i] = 1.0 - v

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
