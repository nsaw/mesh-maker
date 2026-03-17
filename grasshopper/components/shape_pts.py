# GHPython component script — MeshCraft | Shape
# Runtime: IronPython 2.7 (Rhino 7)
#
# Inputs:  z_values (list), cols (int), rows (int), mesh_x (float), mesh_y (float),
#          amplitude, noise_exp, peak_exp, valley_exp, valley_floor,
#          offset, contrast, sharpness
# Outputs: pts (list of Point3d), cols (int passthrough), rows (int passthrough)
import Rhino.Geometry as rg

# ── Defaults ──────────────────────────────────────────────────────────────────
if amplitude    is None: amplitude    = 0.65
if noise_exp    is None: noise_exp    = 0.5
if peak_exp     is None: peak_exp     = 1.0
if valley_exp   is None: valley_exp   = 1.0
if valley_floor is None: valley_floor = 0.0
if offset       is None: offset       = 0.0
if contrast     is None: contrast     = 1.0
if sharpness    is None: sharpness    = 0.0

amplitude    = float(amplitude)
noise_exp    = float(noise_exp)
peak_exp     = float(peak_exp)
valley_exp   = float(valley_exp)
valley_floor = float(valley_floor)
offset       = float(offset)
contrast     = float(contrast)
sharpness    = float(sharpness)
cols_i = int(cols)
rows_i = int(rows)
mx = float(mesh_x)
my = float(mesh_y)

# ── Shaping pipeline (mirrors mesh.ts generateNoiseMesh lines 47-65) ──────────
pts = []
for j in range(rows_i):
    for i in range(cols_i):
        n = float(z_values[j * cols_i + i])

        # Contrast
        n *= contrast

        # Sharpness — preserves sign, amplifies curvature
        if sharpness > 0:
            sgn = 1 if n >= 0 else -1
            n = sgn * (abs(n) ** (1.0 + sharpness))

        # Noise exponent
        sgn = 1 if n >= 0 else -1
        n = sgn * (abs(n) ** noise_exp)

        # Peak / valley exponents applied to positive / negative halves separately
        if n >= 0:
            n = n ** peak_exp
        else:
            n = -((-n) ** valley_exp)

        # Valley floor — softens negative values toward zero
        if valley_floor > 0 and n < 0:
            n *= (1.0 - valley_floor)

        z = n * amplitude + offset

        u = i / float(cols_i - 1)
        v = j / float(rows_i - 1)
        pts.append(rg.Point3d(u * mx, v * my, z))

# Passthrough so downstream Smooth component knows the grid topology
cols = cols_i
rows = rows_i
