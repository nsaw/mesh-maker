#! python 2
# -*- coding: utf-8 -*-
# GHPython component script — MeshCraft | Shape
# Runtime: IronPython 2.7 (Rhino 7)
#
# Inputs:  z_values (list), cols (int), rows (int), mesh_x (float), mesh_y (float),
#          amplitude, peak_exp, valley_exp, valley_floor,
#          offset, invert
# Outputs: pts (list of Point3d), cols (int passthrough), rows (int passthrough)
import Rhino.Geometry as rg

invert = globals().get('invert', False)

# ── Defaults ──────────────────────────────────────────────────────────────────
if amplitude    is None: amplitude    = 0.65
if peak_exp     is None: peak_exp     = 0.5
if valley_exp   is None: valley_exp   = 0.5
if valley_floor is None: valley_floor = 0.0
if offset       is None: offset       = 0.0

amplitude    = float(amplitude)
peak_exp     = float(peak_exp)
valley_exp   = float(valley_exp)
valley_floor = float(valley_floor)
offset       = float(offset)
cols_i = int(cols)
rows_i = int(rows)
mx = float(mesh_x)
my = float(mesh_y)

# ── Shaping pipeline (signed-amplitude path; web normalizes the shaped grid) ──────────
pts = []
for j in range(rows_i):
    for i in range(cols_i):
        n = float(z_values[j * cols_i + i])

        if bool(invert): n = -n

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
