# GHPython component script — MeshCraft | Smooth
# Runtime: IronPython 2.7 (Rhino 7)
#
# Port of weightedSmooth() from mesh.ts:153-174
# Kernel: 3x3, weights — center=4, cardinal=2, diagonal=1
#
# Inputs:  pts (list of Point3d), cols (int), rows (int),
#          smooth_iter (int), smooth_str (float)
# Outputs: pts (list of Point3d)
import Rhino.Geometry as rg

# ── Defaults ──────────────────────────────────────────────────────────────────
if smooth_iter is None: smooth_iter = 0
if smooth_str  is None: smooth_str  = 0.5

iters    = int(smooth_iter)
strength = float(smooth_str)
cols_i   = int(cols)
rows_i   = int(rows)

if iters <= 0:
    # No smoothing — pass through as plain list
    pts = list(pts)
else:
    # Decompose Point3d list into separate arrays for fast Z manipulation
    xs = [p.X for p in pts]
    ys = [p.Y for p in pts]
    zv = [p.Z for p in pts]

    for it in range(iters):
        nzv = list(zv)
        for j in range(rows_i):
            for i in range(cols_i):
                ws = 0.0; tw = 0.0
                for dj in range(-1, 2):
                    for di in range(-1, 2):
                        nj = j+dj; ni = i+di
                        if 0 <= nj < rows_i and 0 <= ni < cols_i:
                            # Center weight=4, cardinal=2, diagonal=1
                            if dj == 0 and di == 0:
                                w = 4
                            elif dj == 0 or di == 0:
                                w = 2
                            else:
                                w = 1
                            ws += zv[nj*cols_i+ni] * w; tw += w
                idx = j*cols_i+i
                nzv[idx] = zv[idx]*(1.0-strength) + (ws/tw)*strength
        zv = nzv

    pts = [rg.Point3d(xs[k], ys[k], zv[k]) for k in range(len(xs))]
