# GHPython builder — MESHCRAFT Grasshopper Node
# Runtime: IronPython 2.7 (Rhino 7)
#
# HOW TO USE:
#   1. Open Rhino 7, run the Grasshopper command to open GH editor
#   2. Drop a GHPython component on the blank canvas
#   3. Double-click it, paste this entire script
#   4. Add two inputs to the component:
#        - run       (type: bool)
#        - save_path (type: str, optional)
#   5. Connect a Boolean Toggle to "run"
#   6. Optionally connect a Panel with a file path to "save_path"
#      (defaults to ~/Desktop/meshcraft.gh if left unconnected)
#   7. Flip the toggle to True — the .gh file is created and saved
#   8. Open the saved .gh file: File > Open in Grasshopper
#
# Inputs:  run (bool), save_path (str, optional)
# Outputs: a (str) — debug log and save status
#
# IMPORTANT: The output variable is named 'a' to match GHPython's default
# output pin. Connect a Panel to the 'a' output to see the debug log.

# TOP-LEVEL SAFETY NET: a is always set, no matter what
a = "script loaded but not yet executed"

import os
import sys
import traceback

_log = []
def _dbg(msg):
    _log.append(str(msg))

try:
    a = "checkpoint: try block entered"
    _run_val = bool(run) if run is not None else False
    if not _run_val:
        a = "run is falsy. Wire a Boolean Toggle set to True."
        raise Exception("EARLY_EXIT")

    a = "checkpoint: step 1 - importing clr"
    import clr
    import System
    import System.Drawing

    a = "checkpoint: step 1 - loading Grasshopper assembly"
    clr.AddReference("Grasshopper")
    clr.AddReference("GhPython")

    a = "checkpoint: step 1 - importing GH modules"
    import Grasshopper.Kernel as ghk
    import Grasshopper.Kernel.Special as ghs
    from GhPython.Component import ZuiPythonComponent
    from Grasshopper.Kernel import GH_ParameterSide

    a = "checkpoint: step 2 - resolving save path"
    _sp = str(save_path).strip() if save_path is not None else ""
    if not _sp:
        _sp = os.path.join(os.path.expanduser("~"), "Desktop", "meshcraft.gh")
    if os.path.isdir(_sp) or _sp.endswith(os.sep):
        _sp = os.path.join(_sp, "meshcraft.gh")
    if not _sp.endswith(".gh"):
        _sp += ".gh"
    a = "checkpoint: save path = " + _sp

    # ── Embedded component scripts ─────────────────────────────────────────
    NOISE_SCRIPT = """# GHPython component script — MeshCraft | Noise
# Runtime: IronPython 2.7 (Rhino 7)
#
# Inputs:  noise_type, seed, frequency, octaves, persistence, lacunarity,
#          distortion, gabor_angle, gabor_bw, mesh_x, mesh_y, resolution
# Outputs: z_values (list of float), cols (int), rows (int),
#          mesh_x (float passthrough), mesh_y (float passthrough)
import math

# ── Defaults ──────────────────────────────────────────────────────────────────
if noise_type  is None: noise_type  = "simplex"
if seed        is None: seed        = 0
if frequency   is None: frequency   = 0.1
if octaves     is None: octaves     = 2
if persistence is None: persistence = 0.5
if lacunarity  is None: lacunarity  = 2.0
if distortion  is None: distortion  = 0.0
if gabor_angle is None: gabor_angle = 45.0
if gabor_bw    is None: gabor_bw    = 1.5
if mesh_x      is None: mesh_x      = 36.0
if mesh_y      is None: mesh_y      = 24.0
if resolution  is None: resolution  = 96
# Voronoi-relief inputs. Two failure modes for a missing value:
#   1) the pin doesn't exist on the component → globals()[name] raises KeyError
#      (component was compiled before relief mode was added)
#   2) the pin exists but is unwired → GhPython binds the name to None (component
#      was rebuilt with relief pins but user hasn't wired them yet)
# Both must fall through to the documented default so `noise_type=='voronoi-relief'`
# never hits float(None) / int(None) downstream.
def _relief_default(name, default):
    try:
        v = globals()[name]
    except KeyError:
        return default
    return default if v is None else v

relief_cell_size           = _relief_default('relief_cell_size',           1.5)
relief_jitter              = _relief_default('relief_jitter',              0.7)
relief_relax_iter          = _relief_default('relief_relax_iter',          1)
relief_polarity            = _relief_default('relief_polarity',            'domes')        # 'domes' | 'pockets'
relief_profile             = _relief_default('relief_profile',             'hemisphere')   # 'hemisphere' | 'cosine' | 'parabolic'
relief_seam_depth          = _relief_default('relief_seam_depth',          0.6)
relief_seam_width          = _relief_default('relief_seam_width',          0.15)
relief_anisotropy          = _relief_default('relief_anisotropy',          0.0)
relief_anisotropy_angle    = _relief_default('relief_anisotropy_angle',    0.0)
relief_attractor_mode      = _relief_default('relief_attractor_mode',      'none')         # 'none'|'vertical'|'horizontal'|'radial'|'point'
relief_attractor_x         = _relief_default('relief_attractor_x',         0.5)
relief_attractor_y         = _relief_default('relief_attractor_y',         0.5)
relief_attractor_radius    = _relief_default('relief_attractor_radius',    0.5)
relief_attractor_falloff   = _relief_default('relief_attractor_falloff',   1.0)
relief_density_strength    = _relief_default('relief_density_strength',    0.0)
relief_intensity_strength  = _relief_default('relief_intensity_strength',  1.0)
relief_transition_softness = _relief_default('relief_transition_softness', 0.3)
relief_base_mode           = _relief_default('relief_base_mode',           'flat')         # 'flat'|'wave'
relief_cell_size_gradient  = _relief_default('relief_cell_size_gradient',  0.0)
relief_void_strength       = _relief_default('relief_void_strength',       0.0)
relief_attractor_noise     = _relief_default('relief_attractor_noise',     0.0)
relief_attractor_noise_freq= _relief_default('relief_attractor_noise_freq',0.15)
relief_flow_anisotropy     = _relief_default('relief_flow_anisotropy',     0.0)

seed        = int(seed)
octaves     = int(octaves)
resolution  = int(resolution)
frequency   = float(frequency)
persistence = float(persistence)
lacunarity  = float(lacunarity)
distortion  = float(distortion)
gabor_angle = float(gabor_angle)
gabor_bw    = float(gabor_bw)
mesh_x      = float(mesh_x)
mesh_y      = float(mesh_y)

# ── Noise classes ─────────────────────────────────────────────────────────────

class SimplexNoise(object):
    GRAD3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],
             [1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]]
    def __init__(self, seed=0):
        p = [int(self._sr(seed + i) * 256) for i in range(256)]
        self.perm = [p[i & 255] for i in range(512)]
    def _sr(self, s):
        x = math.sin(s) * 10000.0; return x - math.floor(x)
    def _dot(self, g, x, y):
        return g[0]*x + g[1]*y
    def noise(self, xin, yin):
        F2 = 0.5*(math.sqrt(3.0)-1.0); G2 = (3.0-math.sqrt(3.0))/6.0
        s = (xin+yin)*F2
        i = int(math.floor(xin+s)); j = int(math.floor(yin+s))
        t = (i+j)*G2; x0 = xin-(i-t); y0 = yin-(j-t)
        i1 = 1 if x0 > y0 else 0; j1 = 0 if x0 > y0 else 1
        x1 = x0-i1+G2; y1 = y0-j1+G2
        x2 = x0-1.0+2.0*G2; y2 = y0-1.0+2.0*G2
        ii = i & 255; jj = j & 255
        gi0 = self.perm[ii+self.perm[jj]] % 12
        gi1 = self.perm[ii+i1+self.perm[jj+j1]] % 12
        gi2 = self.perm[ii+1+self.perm[jj+1]] % 12
        n0 = n1 = n2 = 0.0
        t0 = 0.5-x0*x0-y0*y0
        if t0 >= 0: t0 *= t0; n0 = t0*t0*self._dot(self.GRAD3[gi0],x0,y0)
        t1 = 0.5-x1*x1-y1*y1
        if t1 >= 0: t1 *= t1; n1 = t1*t1*self._dot(self.GRAD3[gi1],x1,y1)
        t2 = 0.5-x2*x2-y2*y2
        if t2 >= 0: t2 *= t2; n2 = t2*t2*self._dot(self.GRAD3[gi2],x2,y2)
        return 70.0*(n0+n1+n2)


class PerlinNoise(object):
    def __init__(self, seed=0):
        perm = list(range(256))
        for i in range(255, 0, -1):
            x = math.sin(seed+i)*10000.0
            j = min(int((x-math.floor(x))*(i+1)), i)
            perm[i], perm[j] = perm[j], perm[i]
        self.p = [perm[i % 256] for i in range(512)]
    def _fade(self, t): return t*t*t*(t*(t*6.0-15.0)+10.0)
    def _lerp(self, t, a, b): return a+t*(b-a)
    def _grad(self, h, x, y):
        h = h & 15; u = x if h < 8 else y
        v = y if h < 4 else (x if (h == 12 or h == 14) else 0.0)
        return (u if (h&1)==0 else -u)+(v if (h&2)==0 else -v)
    def noise(self, x, y):
        X = int(math.floor(x)) & 255; Y = int(math.floor(y)) & 255
        x -= math.floor(x); y -= math.floor(y)
        u = self._fade(x); v = self._fade(y)
        A = self.p[X]+Y; AA = self.p[A]; AB = self.p[A+1]
        B = self.p[X+1]+Y; BA = self.p[B]; BB = self.p[B+1]
        return self._lerp(v,
            self._lerp(u, self._grad(self.p[AA],x,y),   self._grad(self.p[BA],x-1,y)),
            self._lerp(u, self._grad(self.p[AB],x,y-1), self._grad(self.p[BB],x-1,y-1)))


class ValueNoise(object):
    def __init__(self, seed=0):
        perm = list(range(256))
        for i in range(255, 0, -1):
            x = math.sin(seed+i)*10000.0
            j = min(int((x-math.floor(x))*(i+1)), i)
            perm[i], perm[j] = perm[j], perm[i]
        self.p = [perm[i % 256] for i in range(512)]
        self.values = [0.0]*256
        for i in range(256):
            x = math.sin(seed*1000.0+i*7.13)*10000.0
            self.values[i] = (x-math.floor(x))*2.0-1.0
    def _fade(self, t): return t*t*t*(t*(t*6.0-15.0)+10.0)
    def noise(self, x, y):
        X = int(math.floor(x)) & 255; Y = int(math.floor(y)) & 255
        fx = x-math.floor(x); fy = y-math.floor(y)
        u = self._fade(fx); v = self._fade(fy)
        aa = self.values[(self.p[X]+Y) & 255]
        ba = self.values[(self.p[X+1]+Y) & 255]
        ab = self.values[(self.p[X]+Y+1) & 255]
        bb = self.values[(self.p[X+1]+Y+1) & 255]
        return (1.0-v)*((1.0-u)*aa+u*ba)+v*((1.0-u)*ab+u*bb)


class OpenSimplex2Noise(object):
    def __init__(self, seed=0):
        self.grad2 = [[math.cos((i/24.0)*2.0*math.pi),
                       math.sin((i/24.0)*2.0*math.pi)] for i in range(24)]
        p = list(range(256))
        for i in range(255, 0, -1):
            x = math.sin(seed+i)*10000.0
            j = min(int((x-math.floor(x))*(i+1)), i)
            p[i], p[j] = p[j], p[i]
        self.perm = [p[i & 255] for i in range(512)]
    def noise(self, x, y):
        F2 = 0.3660254037844386; G2 = 0.21132486540518713
        s = (x+y)*F2; i = int(math.floor(x+s)); j = int(math.floor(y+s))
        t = (i+j)*G2; x0 = x-(i-t); y0 = y-(j-t)
        i1 = 1 if x0 > y0 else 0; j1 = 0 if x0 > y0 else 1
        x1 = x0-i1+G2; y1 = y0-j1+G2
        x2 = x0-1.0+2.0*G2; y2 = y0-1.0+2.0*G2
        ii = i & 255; jj = j & 255
        gi0 = self.perm[ii+self.perm[jj]] % 24
        gi1 = self.perm[ii+i1+self.perm[jj+j1]] % 24
        gi2 = self.perm[ii+1+self.perm[jj+1]] % 24
        val = 0.0
        a0 = 2.0/3.0-x0*x0-y0*y0
        if a0 > 0: a0 *= a0; val += a0*a0*(self.grad2[gi0][0]*x0+self.grad2[gi0][1]*y0)
        a1 = 2.0/3.0-x1*x1-y1*y1
        if a1 > 0: a1 *= a1; val += a1*a1*(self.grad2[gi1][0]*x1+self.grad2[gi1][1]*y1)
        a2 = 2.0/3.0-x2*x2-y2*y2
        if a2 > 0: a2 *= a2; val += a2*a2*(self.grad2[gi2][0]*x2+self.grad2[gi2][1]*y2)
        return val*18.0


class RidgedNoise(object):
    def __init__(self, seed=0): self.base = SimplexNoise(seed)
    def noise(self, x, y): return (1.0-abs(self.base.noise(x,y)))*2.0-1.0


class BillowNoise(object):
    def __init__(self, seed=0): self.base = SimplexNoise(seed)
    def noise(self, x, y): return abs(self.base.noise(x,y))*2.0-1.0


class FBMNoise(object):
    def __init__(self, seed=0): self.base = SimplexNoise(seed)
    def noise(self, x, y): return self.base.noise(x, y)
    def fbm(self, x, y, octs, pers, lac):
        val = 0.0; amp = 1.0; freq = 1.0; mx = 0.0
        for i in range(octs):
            val += self.base.noise(x*freq, y*freq)*amp
            mx += amp; amp *= pers; freq *= lac
        return val/mx


class TurbulenceNoise(object):
    def __init__(self, seed=0): self.base = SimplexNoise(seed)
    def noise(self, x, y): return self.base.noise(x, y)
    def fbm(self, x, y, octs, pers, lac):
        val = 0.0; amp = 1.0; freq = 1.0; mx = 0.0
        for i in range(octs):
            val += abs(self.base.noise(x*freq, y*freq))*amp
            mx += amp; amp *= pers; freq *= lac
        return (val/mx)*2.0-1.0


class HybridMultifractal(object):
    def __init__(self, seed=0): self.base = SimplexNoise(seed)
    def noise(self, x, y): return self.base.noise(x, y)
    def fbm(self, x, y, octs, pers, lac):
        result = (self.base.noise(x,y)+1.0)*0.5
        weight = result; amp = pers; freq = lac
        for i in range(1, octs):
            weight = min(weight, 1.0)
            sig = (self.base.noise(x*freq, y*freq)+1.0)*0.5
            result += sig*amp*weight; weight *= sig; amp *= pers; freq *= lac
        return result*2.0-1.0


class HeteroTerrain(object):
    def __init__(self, seed=0): self.base = SimplexNoise(seed)
    def noise(self, x, y): return self.base.noise(x, y)
    def fbm(self, x, y, octs, pers, lac):
        result = self.base.noise(x, y)
        weight = max(0.0, min(1.0, (result+1.0)*0.5))
        amp = pers; freq = lac
        for i in range(1, octs):
            sig = self.base.noise(x*freq, y*freq)*amp
            result += sig*weight
            weight = max(0.0, min(1.0, (result+1.0)*0.5))
            freq *= lac; amp *= pers
        return result


class DomainWarpNoise(object):
    def __init__(self, seed=0):
        self.base = SimplexNoise(seed); self.warp = SimplexNoise(seed+31)
    def noise(self, x, y):
        qx = self.warp.noise(x, y); qy = self.warp.noise(x+5.2, y+1.3)
        return self.base.noise(x+4.0*qx, y+4.0*qy)
    def fbm(self, x, y, octs, pers, lac):
        qx = self.warp.noise(x, y); qy = self.warp.noise(x+5.2, y+1.3)
        rx = self.warp.noise(x+4.0*qx+1.7, y+4.0*qy+9.2)
        ry = self.warp.noise(x+4.0*qx+8.3, y+4.0*qy+2.8)
        wx = x+4.0*rx; wy = y+4.0*ry
        val = 0.0; amp = 1.0; freq = 1.0; mx = 0.0
        for i in range(octs):
            val += self.base.noise(wx*freq, wy*freq)*amp
            mx += amp; amp *= pers; freq *= lac
        return val/mx


class VoronoiNoise(object):
    def __init__(self, seed=0): self.seed = seed
    def _sr(self, s): x = math.sin(s)*10000.0; return x-math.floor(x)
    def _hash(self, x, y):
        return int(math.floor(self._sr(x*374761393.0+y*668265263.0+self.seed)*1000.0))
    def noise(self, x, y):
        cx = int(math.floor(x)); cy = int(math.floor(y)); mn = float('inf')
        for i in range(-1, 2):
            for j in range(-1, 2):
                nx = cx+i; ny = cy+j; h = self._hash(nx, ny)
                px = nx+self._sr(h); py = ny+self._sr(h+1)
                d = math.hypot(x-px, y-py)
                if d < mn: mn = d
        return 1.0-mn*2.0


class WorleyNoise(object):
    def __init__(self, seed=0): self.seed = seed
    def _sr(self, s): x = math.sin(s)*10000.0; return x-math.floor(x)
    def _hash(self, x, y):
        return int(math.floor(self._sr(x*374761393.0+y*668265263.0+self.seed)*1000.0))
    def noise(self, x, y):
        cx = int(math.floor(x)); cy = int(math.floor(y))
        f1 = float('inf'); f2 = float('inf')
        for i in range(-1, 2):
            for j in range(-1, 2):
                nx = cx+i; ny = cy+j; h = self._hash(nx, ny)
                px = nx+self._sr(h); py = ny+self._sr(h+1)
                d = math.hypot(x-px, y-py)
                if d < f1: f2 = f1; f1 = d
                elif d < f2: f2 = d
        return min((f2-f1)*1.5, 1.0)*2.0-1.0


class GaborNoise(object):
    def __init__(self, seed=0, angle=45.0, bw=1.5):
        self.seed = seed
        a = angle*math.pi/180.0
        self.cosA = math.cos(a); self.sinA = math.sin(a); self.bw2 = bw*bw
    def _sr(self, s): x = math.sin(s)*10000.0; return x-math.floor(x)
    def _hash(self, x, y):
        return int(math.floor(self._sr(x*374761393.0+y*668265263.0+self.seed)*10000.0))
    def noise(self, x, y):
        cx = int(math.floor(x)); cy = int(math.floor(y))
        val = 0.0; piBw2 = math.pi*self.bw2; twoPi = 2.0*math.pi
        for di in range(-1, 2):
            for dj in range(-1, 2):
                nx = cx+di; ny = cy+dj; h = self._hash(nx, ny)
                nk = 3+(h % 4)
                for k in range(nk):
                    ks = h+k*7; kx = nx+self._sr(ks); ky = ny+self._sr(ks+1)
                    phase = self._sr(ks+2)*twoPi
                    dx = x-kx; dy = y-ky; r2 = dx*dx+dy*dy
                    if r2 > 4.0: continue
                    proj = dx*self.cosA+dy*self.sinA
                    val += math.exp(-piBw2*r2)*math.cos(twoPi*proj+phase)
        return max(-1.0, min(1.0, val*0.5))


class WaveletNoise(object):
    SIZE = 128
    def __init__(self, seed=0):
        n = self.SIZE; self.tile = [0.0]*(n*n)
        base = SimplexNoise(seed); scale = 4.0/n; seedOff = seed*100.0
        for j in range(n):
            for i in range(n):
                val = 0.0; amp = 0.5; freq = scale; total = 0.0
                for o in range(4):
                    val += base.noise(i*freq+seedOff, j*freq+seedOff+500.0)*amp
                    total += amp; amp *= 0.5; freq *= 2.0
                self.tile[j*n+i] = val/total
    def noise(self, x, y):
        n = self.SIZE
        tx = ((x % n)+n) % n; ty = ((y % n)+n) % n
        ix = int(math.floor(tx)) & (n-1); iy = int(math.floor(ty)) & (n-1)
        fx = tx-math.floor(tx); fy = ty-math.floor(ty)
        u = fx*fx*(3.0-2.0*fx); v = fy*fy*(3.0-2.0*fy)
        i00 = self.tile[iy*n+ix]
        i10 = self.tile[iy*n+((ix+1)&(n-1))]
        i01 = self.tile[((iy+1)&(n-1))*n+ix]
        i11 = self.tile[((iy+1)&(n-1))*n+((ix+1)&(n-1))]
        return (1.0-v)*((1.0-u)*i00+u*i10)+v*((1.0-u)*i01+u*i11)


# ── Voronoi Relief (grid-aware, not stateless per-pixel) ──────────────────────
# 3D Voronoi cell relief — domed/pocketed cells with deep V-seams.
# Mirrors src/noise/voronoi-relief.ts. Per-cell radius from mean F1 inside the cell.
# Skip domain warp; relief sampler handles its own anisotropy.
# (Class docstring is intentionally a comment, not a triple-quoted string, so this
#  block can be embedded byte-equivalently inside the NOISE_SCRIPT triple-quoted
#  literal in grasshopper/builder/meshcraft_builder.py.)
class VoronoiReliefNoise(object):
    def __init__(self, seed=0):
        self._prng_state = int(seed) & 0xffffffff
        self.wave = SimplexNoise(seed + 17)
    def _rand(self):
        # mulberry32 — byte-equivalent to the TS sampler so the same seed produces the
        # same site layout in both the browser and Grasshopper. The previous sin-based
        # _sr() drifted from the TS mulberry32 sequence even with the same seed.
        self._prng_state = (self._prng_state + 0x6D2B79F5) & 0xffffffff
        r = self._prng_state
        r = (((r ^ (r >> 15)) * (r | 1)) & 0xffffffff)
        r ^= ((r + (((r ^ (r >> 7)) * (r | 61)) & 0xffffffff)) & 0xffffffff)
        return float((r ^ (r >> 14)) & 0xffffffff) / 4294967296.0
    def _smoothstep(self, e0, e1, x):
        if e1 <= e0: return 0.0 if x < e0 else 1.0
        t = (x - e0) / (e1 - e0)
        if t < 0.0: t = 0.0
        elif t > 1.0: t = 1.0
        return t * t * (3.0 - 2.0 * t)
    def _attractor_mask(self, mode, u, v, ax, ay, radius, falloff):
        if mode == 'none': return 1.0
        if mode == 'vertical':
            # attractorY anchors the peak: 0 = bottom of viewport (lafabrica panel orientation),
            # 1 = top, 0.5 = middle band. Falloff sharpens or broadens the gradient.
            dy = abs(v - ay)
            return pow(max(0.0, 1.0 - dy), max(0.05, falloff))
        if mode == 'horizontal':
            dx = abs(u - ax)
            return pow(max(0.0, 1.0 - dx), max(0.05, falloff))
        dx = u - ax; dy = v - ay
        d = math.sqrt(dx * dx + dy * dy)
        r = max(0.001, radius)
        # Falloff shapes the curve for radial/point modes too: < 1 broadens, > 1 sharpens.
        shaped = max(0.05, falloff)
        if mode == 'radial':
            return pow(1.0 - self._smoothstep(r * 0.5, r, d), shaped)
        return pow(self._smoothstep(r * 0.5, r, d), shaped)  # 'point'
    def _dome(self, profile, d, R):
        if R <= 0: return 0.0
        t = min(1.0, d / R)
        if profile == 'hemisphere':
            inside = 1.0 - t * t
            return math.sqrt(inside) if inside > 0 else 0.0
        if profile == 'cosine':
            return math.cos(t * math.pi * 0.5)
        return max(0.0, 1.0 - t * t)  # parabolic
    SITE_COUNT_MAX = 4096
    LOCAL_DENSITY_MAX = 4.0
    # Radius field (Pass 1.5) Gaussian blend over sites within cutoff. Mirrors TS constants
    # RADIUS_FIELD_SIGMA_CELLS and RADIUS_FIELD_CUTOFF_SIGMAS exactly.
    RADIUS_FIELD_SIGMA_CELLS = 0.8
    RADIUS_FIELD_CUTOFF_SIGMAS = 3.0
    # Coarse-grid pitch in σ units for the Rfield optimization. See TS sampler.
    RADIUS_FIELD_COARSE_PITCH_SIGMAS = 0.5
    # Minimum seam smoothstep transition width in pixel units (anti-aliasing floor).
    SEAM_MIN_PIXEL_WIDTH = 3.0
    # Cap on the floor as a fraction of R per-pixel (prevents floor from inverting cells at low resolution).
    SEAM_FLOOR_MAX_R_FRACTION = 0.3
    # Output clamp magnitude. Used with explicit negative sign at carve sites.
    OUTPUT_HEIGHT_CLAMP = 1.05
    def _gen_sites(self, p, warp_gen):
        spacing = max(0.2, p['cell_size'])
        nx = max(2, int(math.ceil(p['mesh_x'] / spacing)) + 1)
        ny = max(2, int(math.ceil(p['mesh_y'] / spacing)) + 1)
        sx = p['mesh_x'] / nx; sy = p['mesh_y'] / ny
        # Warp tuning matches TS: amplitude scales with cellSize so warp is visible relative
        # to grid spacing but never large enough to shove sites off-panel before the clamp.
        warp_amp = (p.get('warp_distortion', 0.0) * spacing * 0.7) if warp_gen else 0.0
        warp_freq = max(0.02, p.get('warp_frequency', 0.1))
        sites = []
        # Hard caps prevent O(rows*cols*sites) blowup from crafted params or unwired density attractors.
        for j in range(ny):
            if len(sites) >= self.SITE_COUNT_MAX: break
            for i in range(nx):
                if len(sites) >= self.SITE_COUNT_MAX: break
                cx = (i + 0.5) * sx; cy = (j + 0.5) * sy
                u = cx / p['mesh_x']; v = cy / p['mesh_y']
                mask = self._attractor_mask(p['attractor_mode'], u, v,
                    p['attractor_x'], p['attractor_y'],
                    p['attractor_radius'], p['attractor_falloff'])
                local = max(0.0, min(self.LOCAL_DENSITY_MAX, 1.0 + p['density_strength'] * mask))
                reps = int(math.floor(local))
                if self._rand() < (local - math.floor(local)):
                    reps += 1
                for _ in range(reps):
                    if len(sites) >= self.SITE_COUNT_MAX: break
                    jx = (self._rand() - 0.5) * p['jitter'] * sx
                    jy = (self._rand() - 0.5) * p['jitter'] * sy
                    px = cx + jx; py = cy + jy
                    if warp_gen and warp_amp > 0:
                        wx = warp_gen.noise(px * warp_freq, py * warp_freq)
                        wy = warp_gen.noise(px * warp_freq + 31.7, py * warp_freq + 17.3)
                        px += wx * warp_amp; py += wy * warp_amp
                    sites.append([
                        max(0.0, min(p['mesh_x'], px)),
                        max(0.0, min(p['mesh_y'], py)),
                        0.0  # radius (set after Pass 1)
                    ])
        return sites
    def _nearest_two(self, sites, x, y, cosA, sinA, aniso_scale):
        # Anisotropy: rotate into stretched frame, scale x', take hypot. Rotation preserves length
        # so we don't need to rotate back.
        f1 = float('inf'); f2 = float('inf'); idx = 0
        isotropic = (aniso_scale == 1.0)
        for i in range(len(sites)):
            dx = x - sites[i][0]; dy = y - sites[i][1]
            if isotropic:
                d = math.sqrt(dx * dx + dy * dy)
            else:
                xr = dx * cosA + dy * sinA
                yr = -dx * sinA + dy * cosA
                d = math.sqrt((xr * aniso_scale) ** 2 + yr * yr)
            if d < f1: f2 = f1; f1 = d; idx = i
            elif d < f2: f2 = d
        return f1, f2, idx
    def _halton(self, index, base):
        result = 0.0; f = 1.0 / base; i = index
        while i > 0:
            result += f * (i % base)
            i = i // base
            f /= base
        return result
    def _lloyd_relax(self, sites, p, samples):
        # One Lloyd pass — move each site toward the centroid of its assigned low-discrepancy samples.
        n = len(sites)
        sumX = [0.0] * n; sumY = [0.0] * n; counts = [0] * n
        for s in range(samples):
            x = self._halton(s + 1, 2) * p['mesh_x']
            y = self._halton(s + 1, 3) * p['mesh_y']
            best_idx = 0; best_d = float('inf')
            for i in range(n):
                dx = sites[i][0] - x; dy = sites[i][1] - y
                d = dx * dx + dy * dy
                if d < best_d:
                    best_d = d; best_idx = i
            sumX[best_idx] += x; sumY[best_idx] += y; counts[best_idx] += 1
        for i in range(n):
            if counts[i] > 0:
                sites[i][0] = sumX[i] / counts[i]
                sites[i][1] = sumY[i] / counts[i]
    def sample_grid(self, p):
        # Re-seed PRNG + wave generator from p.seed (canonical source). Mirrors the TS
        # sampler — same seed produces same site layout and wave field even when the
        # generator instance is reused across GH evaluations.
        seed = int(p.get('seed', 0)) & 0xffffffff
        self._prng_state = seed
        self.wave = SimplexNoise(seed + 17)
        warp_gen = SimplexNoise(seed + 17 + 13) if p.get('warp_distortion', 0.0) > 0 else None
        attractor_noise_gen = SimplexNoise(seed + 17 + 29) if p.get('attractor_noise', 0.0) > 0 else None
        flow_gen = SimplexNoise(seed + 17 + 47) if p.get('flow_anisotropy', 0.0) > 0 else None
        sites = self._gen_sites(p, warp_gen)
        if not sites:
            return [0.0] * (p['cols'] * p['rows'])
        # Lloyd relaxation passes — clamped 0..2.
        relax_iter = max(0, min(2, int(p.get('relax_iter', 1))))
        if relax_iter > 0:
            lloyd_samples = min(8192, len(sites) * 64)
            for _ in range(relax_iter):
                self._lloyd_relax(sites, p, lloyd_samples)
        a_rad = p['anisotropy_angle'] * math.pi / 180.0
        cosA = math.cos(a_rad); sinA = math.sin(a_rad)
        aniso_scale = 1.0 + p['anisotropy'] * 1.5
        # Clamp + hoist transition_softness so pow(mask, exponent) is finite when
        # mask=0 even if a crafted param sneaks past the URL boundary.
        ts_clamped = max(0.0, min(1.0, p['transition_softness']))
        transition_exponent = 0.2 + ts_clamped * 1.8
        cols = p['cols']; rows = p['rows']
        # Pass 1: accumulate mean F1 per site to derive per-cell radius. Accumulators live
        # in local arrays so the site row stays slim and concurrent sample_grid calls don't
        # trample each other (mirrors the Float64Array approach in the TS sampler).
        n_sites = len(sites)
        radius_sum = [0.0] * n_sites
        radius_n = [0] * n_sites
        pass1_flow_amt = max(0.0, min(1.0, p.get('flow_anisotropy', 0.0)))
        for j in range(rows):
            v = j / float(max(1, rows - 1)); y = v * p['mesh_y']
            for i in range(cols):
                u = i / float(max(1, cols - 1)); x = u * p['mesh_x']
                px_cosA = cosA; px_sinA = sinA
                if flow_gen and pass1_flow_amt > 0.0:
                    flow = flow_gen.noise(x * 0.18, y * 0.18)
                    local_angle = (p['anisotropy_angle'] + flow * pass1_flow_amt * 90.0) * math.pi / 180.0
                    px_cosA = math.cos(local_angle); px_sinA = math.sin(local_angle)
                f1, f2, idx = self._nearest_two(sites, x, y, px_cosA, px_sinA, aniso_scale)
                radius_sum[idx] += f1; radius_n[idx] += 1
        for k in range(n_sites):
            sites[k][2] = (radius_sum[k] / radius_n[k]) * 2.0 if radius_n[k] > 0 else p['cell_size']
        # Pass 1.5: continuous radius field R(x,y) via Gaussian blend over sites. Computed
        # on a coarse grid (pitch sigma/2, well above Nyquist for the Gaussian-smoothed
        # field) and bilinear-interpolated to full resolution. Without the coarse-grid
        # optimization the full-resolution computation is O(cols*rows*sites) which times
        # out the browser at production resolution. Mirrors src/noise/voronoi-relief.ts.
        sigma_r = max(0.2, p['cell_size']) * self.RADIUS_FIELD_SIGMA_CELLS
        sigma_r2 = sigma_r * sigma_r
        cutoff_r = sigma_r * self.RADIUS_FIELD_CUTOFF_SIGMAS
        cutoff_r2 = cutoff_r * cutoff_r
        coarse_pitch = sigma_r * self.RADIUS_FIELD_COARSE_PITCH_SIGMAS
        coarse_cols = max(2, int(math.ceil(p['mesh_x'] / coarse_pitch)) + 1)
        coarse_rows = max(2, int(math.ceil(p['mesh_y'] / coarse_pitch)) + 1)
        coarse_step_x = p['mesh_x'] / float(coarse_cols - 1)
        coarse_step_y = p['mesh_y'] / float(coarse_rows - 1)
        r_coarse = [0.0] * (coarse_rows * coarse_cols)
        for cj in range(coarse_rows):
            y = cj * coarse_step_y
            for ci in range(coarse_cols):
                x = ci * coarse_step_x
                sum_r = 0.0; sum_w = 0.0
                for k in range(n_sites):
                    dx = x - sites[k][0]; dy = y - sites[k][1]
                    d2 = dx * dx + dy * dy
                    if d2 > cutoff_r2: continue
                    w = math.exp(-d2 / sigma_r2)
                    sum_r += sites[k][2] * w
                    sum_w += w
                r_coarse[cj * coarse_cols + ci] = (sum_r / sum_w) if sum_w > 0 else p['cell_size']
        # Bilinear-interpolate coarse field to full resolution.
        r_field = [0.0] * (rows * cols)
        for j in range(rows):
            v = j / float(max(1, rows - 1)); y = v * p['mesh_y']
            cy = y / coarse_step_y
            cj0 = min(coarse_rows - 2, int(math.floor(cy)))
            ty = cy - cj0
            for i in range(cols):
                u = i / float(max(1, cols - 1)); x = u * p['mesh_x']
                cx = x / coarse_step_x
                ci0 = min(coarse_cols - 2, int(math.floor(cx)))
                tx = cx - ci0
                r00 = r_coarse[cj0 * coarse_cols + ci0]
                r10 = r_coarse[cj0 * coarse_cols + ci0 + 1]
                r01 = r_coarse[(cj0 + 1) * coarse_cols + ci0]
                r11 = r_coarse[(cj0 + 1) * coarse_cols + ci0 + 1]
                r0 = r00 * (1.0 - tx) + r10 * tx
                r1 = r01 * (1.0 - tx) + r11 * tx
                r_field[j * cols + i] = r0 * (1.0 - ty) + r1 * ty
        # Pass 2: heights
        polarity = -1.0 if p['polarity'] == 'pockets' else 1.0
        cell_size_grad = max(0.0, min(2.0, p.get('cell_size_gradient', 0.0)))
        void_strength = max(0.0, min(1.0, p.get('void_strength', 0.0)))
        attractor_noise_amt = max(0.0, min(1.0, p.get('attractor_noise', 0.0)))
        attractor_noise_freq = max(0.02, min(0.5, p.get('attractor_noise_freq', 0.15)))
        flow_anisotropy_amt = max(0.0, min(1.0, p.get('flow_anisotropy', 0.0)))
        # Pixel pitch + minimum seam-transition width (anti-aliasing floor). The floor is
        # later capped to a fraction of R per-pixel so it can't dominate the natural width
        # at low grid resolutions (which would invert the dome/seam balance).
        px_pitch = p['mesh_x'] / float(max(1, cols))
        pixel_min_width = px_pitch * self.SEAM_MIN_PIXEL_WIDTH
        out = [0.0] * (cols * rows)
        for j in range(rows):
            v = j / float(max(1, rows - 1)); y = v * p['mesh_y']
            for i in range(cols):
                u = i / float(max(1, cols - 1)); x = u * p['mesh_x']
                px_cosA = cosA; px_sinA = sinA
                if flow_gen and flow_anisotropy_amt > 0.0:
                    flow = flow_gen.noise(x * 0.18, y * 0.18)
                    local_angle = (p['anisotropy_angle'] + flow * flow_anisotropy_amt * 90.0) * math.pi / 180.0
                    px_cosA = math.cos(local_angle); px_sinA = math.sin(local_angle)
                f1, f2, idx = self._nearest_two(sites, x, y, px_cosA, px_sinA, aniso_scale)
                mask = self._attractor_mask(p['attractor_mode'], u, v,
                    p['attractor_x'], p['attractor_y'],
                    p['attractor_radius'], p['attractor_falloff'])
                if attractor_noise_gen and attractor_noise_amt > 0.0:
                    n = attractor_noise_gen.noise(x * attractor_noise_freq, y * attractor_noise_freq)
                    modulator = (n + 1.0) * 0.5
                    mask = mask * ((1.0 - attractor_noise_amt) + attractor_noise_amt * modulator * 1.5)
                    if mask > 1.0: mask = 1.0
                    if mask < 0.0: mask = 0.0
                # Cell-size gradient shrinks effective radius where mask is high. R is read
                # from the continuous radius field (Pass 1.5), not from sites[idx], so it
                # has no ownership-boundary discontinuities.
                size_shrink = 1.0 - cell_size_grad * mask * 0.6
                R = max(0.05, r_field[j * cols + i] * max(0.2, size_shrink))
                dome = self._dome(p['profile'], f1, R)
                # Seam smoothstep transition width: max of (seam_width * R) and a pixel-aware
                # floor, where the floor is capped to a fraction of R so it can't grow wider
                # than the cell. Eliminates sub-pixel-wall sawtooth aliasing.
                capped_floor = min(pixel_min_width, R * self.SEAM_FLOOR_MAX_R_FRACTION)
                seam_width_physical = max(p['seam_width'] * R, capped_floor)
                seam = 1.0 - self._smoothstep(0.0, seam_width_physical, f2 - f1)
                # Dome decays at the seam so seamDepth represents the true trough depth.
                h = polarity * (dome * (1.0 - seam) - p['seam_depth'] * seam)
                intensity = (1.0 - p['intensity_strength']) + p['intensity_strength'] * mask
                if p['base_mode'] == 'wave':
                    base = self.wave.noise(x * 0.1, y * 0.1) * 0.5
                    cw = pow(mask, transition_exponent)
                    h = base * (1.0 - cw) + h * cw * intensity
                else:
                    h = h * intensity
                # Void mode applied AFTER the wave/cell blend so the floor-clamp intent
                # is not diluted by the wave base in transition zones.
                if void_strength > 0.0:
                    void_gate = mask * seam
                    void_edge0 = 1.0 - void_strength
                    void_edge1 = 1.0 - void_strength * 0.5
                    void_t = self._smoothstep(void_edge0, void_edge1, void_gate)
                    h = h * (1.0 - void_t) - self.OUTPUT_HEIGHT_CLAMP * void_t
                if h != h or h == float('inf') or h == float('-inf'):  # NaN/Inf guard
                    h = 0.0
                if h < -self.OUTPUT_HEIGHT_CLAMP: h = -self.OUTPUT_HEIGHT_CLAMP
                elif h > self.OUTPUT_HEIGHT_CLAMP: h = self.OUTPUT_HEIGHT_CLAMP
                out[j * cols + i] = h
        return out


# ── Factory ───────────────────────────────────────────────────────────────────
_NOISE_MAP = {
    'simplex':      lambda s, cfg: SimplexNoise(s),
    'perlin':       lambda s, cfg: PerlinNoise(s),
    'value':        lambda s, cfg: ValueNoise(s),
    'opensimplex2': lambda s, cfg: OpenSimplex2Noise(s),
    'ridged':       lambda s, cfg: RidgedNoise(s),
    'billow':       lambda s, cfg: BillowNoise(s),
    'fbm':          lambda s, cfg: FBMNoise(s),
    'turbulence':   lambda s, cfg: TurbulenceNoise(s),
    'hybrid':       lambda s, cfg: HybridMultifractal(s),
    'hetero':       lambda s, cfg: HeteroTerrain(s),
    'domainwarp':   lambda s, cfg: DomainWarpNoise(s),
    'voronoi':      lambda s, cfg: VoronoiNoise(s),
    'worley':       lambda s, cfg: WorleyNoise(s),
    'gabor':        lambda s, cfg: GaborNoise(s, cfg.get('angle', 45.0), cfg.get('bw', 1.5)),
    'wavelet':      lambda s, cfg: WaveletNoise(s),
    'voronoi-relief': lambda s, cfg: VoronoiReliefNoise(s),
}

cfg = {'angle': gabor_angle, 'bw': gabor_bw}
gen = _NOISE_MAP.get(str(noise_type), _NOISE_MAP['simplex'])(seed, cfg)
has_fbm = hasattr(gen, 'fbm')
is_relief = isinstance(gen, VoronoiReliefNoise)

# ── Grid generation ───────────────────────────────────────────────────────────
cols = resolution
rows = max(4, int(round(resolution * (mesh_y / mesh_x))))

if is_relief:
    # Relief sampler skips per-pixel domain warp + octaves; takes its own param dict.
    # warp_distortion + warp_frequency wire the global distortion/warpFreq sliders into the
    # relief sampler's site-position warp pass.
    relief_params = {
        'cols': cols, 'rows': rows,
        'mesh_x': mesh_x, 'mesh_y': mesh_y,
        'seed': int(seed),
        'cell_size': float(relief_cell_size),
        'jitter': float(relief_jitter),
        'relax_iter': int(relief_relax_iter),
        'polarity': str(relief_polarity),
        'profile': str(relief_profile),
        'seam_depth': float(relief_seam_depth),
        'seam_width': float(relief_seam_width),
        'anisotropy': float(relief_anisotropy),
        'anisotropy_angle': float(relief_anisotropy_angle),
        'attractor_mode': str(relief_attractor_mode),
        'attractor_x': float(relief_attractor_x),
        'attractor_y': float(relief_attractor_y),
        'attractor_radius': float(relief_attractor_radius),
        'attractor_falloff': float(relief_attractor_falloff),
        'density_strength': float(relief_density_strength),
        'intensity_strength': float(relief_intensity_strength),
        'transition_softness': float(relief_transition_softness),
        'base_mode': str(relief_base_mode),
        'cell_size_gradient': float(relief_cell_size_gradient),
        'void_strength': float(relief_void_strength),
        'attractor_noise': float(relief_attractor_noise),
        'attractor_noise_freq': float(relief_attractor_noise_freq),
        'flow_anisotropy': float(relief_flow_anisotropy),
        'warp_distortion': float(distortion),
        'warp_frequency': 0.1,
    }
    z_values = gen.sample_grid(relief_params)
else:
    warp_gen = SimplexNoise(seed) if distortion > 0 else None
    raw = []
    for j in range(rows):
        for i in range(cols):
            u = i / float(cols-1); v = j / float(rows-1)
            x = u * mesh_x; y = v * mesh_y

            if warp_gen:
                x += warp_gen.noise(x*0.1, y*0.1) * distortion * 5.0
                y += warp_gen.noise((x+100.0)*0.1, (y+100.0)*0.1) * distortion * 5.0

            if has_fbm:
                n = gen.fbm(x*frequency, y*frequency, octaves, persistence, lacunarity)
            elif octaves > 1:
                n = 0.0; amp = 1.0; freq = 1.0; mx = 0.0
                for o in range(octaves):
                    n += gen.noise(x*frequency*freq, y*frequency*freq)*amp
                    mx += amp; amp *= persistence; freq *= lacunarity
                n /= mx
            else:
                n = gen.noise(x*frequency, y*frequency)

            raw.append(n)

    z_values = raw
# mesh_x and mesh_y pass through so Shape component can build the point grid
"""

    SHAPE_SCRIPT = """# GHPython component script — MeshCraft | Shape
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
"""

    SMOOTH_SCRIPT = """# GHPython component script — MeshCraft | Smooth
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
"""

    PRESETS_SCRIPT = """# GHPython component script — MeshCraft | Presets
# Runtime: IronPython 2.7 (Rhino 7)
#
# Inputs:  preset (str) — name of preset to load
# Outputs: noise_type, frequency, amplitude, noise_exp, peak_exp, valley_exp,
#          valley_floor, offset, octaves, persistence, lacunarity, distortion,
#          contrast, sharpness, mesh_x, mesh_y, smooth_iter, smooth_str
#
# Usage: wire any output to the matching input on Noise/Shape/Smooth components
#        to override the slider value for that parameter.

PRESETS = {
    'gentle-waves':    {'noise_type':'simplex',    'frequency':0.06, 'amplitude':0.50, 'noise_exp':0.5, 'peak_exp':1.0, 'valley_exp':1.0,  'valley_floor':0.00, 'offset': 0.0, 'octaves':2, 'persistence':0.30, 'lacunarity':2.0, 'distortion':0.00, 'contrast':1.0, 'sharpness':0.00, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':3, 'smooth_str':0.5},
    'organic-terrain': {'noise_type':'fbm',        'frequency':0.10, 'amplitude':0.80, 'noise_exp':0.7, 'peak_exp':1.0, 'valley_exp':1.0,  'valley_floor':0.00, 'offset': 0.0, 'octaves':4, 'persistence':0.55, 'lacunarity':2.0, 'distortion':0.30, 'contrast':1.2, 'sharpness':0.20, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':1, 'smooth_str':0.4},
    'sharp-ridges':    {'noise_type':'ridged',     'frequency':0.08, 'amplitude':0.50, 'noise_exp':1.5, 'peak_exp':1.0, 'valley_exp':1.0,  'valley_floor':0.00, 'offset': 0.3, 'octaves':3, 'persistence':0.50, 'lacunarity':2.2, 'distortion':0.00, 'contrast':1.5, 'sharpness':0.80, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':0, 'smooth_str':0.0},
    'voronoi-cells':   {'noise_type':'voronoi',    'frequency':0.15, 'amplitude':0.30, 'noise_exp':0.8, 'peak_exp':1.0, 'valley_exp':1.0,  'valley_floor':0.00, 'offset': 0.3, 'octaves':1, 'persistence':0.50, 'lacunarity':2.0, 'distortion':0.00, 'contrast':1.0, 'sharpness':0.00, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':2, 'smooth_str':0.6},
    'subtle-texture':  {'noise_type':'perlin',     'frequency':0.12, 'amplitude':0.25, 'noise_exp':0.5, 'peak_exp':1.0, 'valley_exp':1.0,  'valley_floor':0.00, 'offset': 0.0, 'octaves':3, 'persistence':0.40, 'lacunarity':2.5, 'distortion':0.10, 'contrast':0.8, 'sharpness':0.00, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':2, 'smooth_str':0.7},
    'deep-carve':      {'noise_type':'fbm',        'frequency':0.05, 'amplitude':2.00, 'noise_exp':1.2, 'peak_exp':1.0, 'valley_exp':1.0,  'valley_floor':0.00, 'offset':-0.3, 'octaves':5, 'persistence':0.60, 'lacunarity':1.8, 'distortion':0.40, 'contrast':1.8, 'sharpness':0.50, 'mesh_x':24, 'mesh_y':18, 'smooth_iter':0, 'smooth_str':0.0},
    'sculptural':      {'noise_type':'fbm',        'frequency':0.04, 'amplitude':1.50, 'noise_exp':0.7, 'peak_exp':1.8, 'valley_exp':0.35, 'valley_floor':0.60, 'offset': 0.0, 'octaves':3, 'persistence':0.55, 'lacunarity':1.8, 'distortion':0.40, 'contrast':1.3, 'sharpness':0.15, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':2, 'smooth_str':0.45},
    'hard-wave':       {'noise_type':'simplex',    'frequency':0.05, 'amplitude':1.20, 'noise_exp':0.6, 'peak_exp':2.0, 'valley_exp':0.30, 'valley_floor':0.75, 'offset': 0.1, 'octaves':2, 'persistence':0.40, 'lacunarity':2.0, 'distortion':0.25, 'contrast':1.4, 'sharpness':0.10, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':3, 'smooth_str':0.5},
    'eroded-stone':    {'noise_type':'ridged',     'frequency':0.06, 'amplitude':0.50, 'noise_exp':0.8, 'peak_exp':1.5, 'valley_exp':0.40, 'valley_floor':0.50, 'offset': 0.4, 'octaves':4, 'persistence':0.50, 'lacunarity':2.2, 'distortion':0.35, 'contrast':1.6, 'sharpness':0.30, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':1, 'smooth_str':0.3},
    'billowy-clouds':  {'noise_type':'billow',     'frequency':0.07, 'amplitude':0.80, 'noise_exp':0.5, 'peak_exp':1.0, 'valley_exp':1.0,  'valley_floor':0.00, 'offset': 0.0, 'octaves':3, 'persistence':0.45, 'lacunarity':2.0, 'distortion':0.15, 'contrast':1.0, 'sharpness':0.00, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':2, 'smooth_str':0.5},
    'turbulent-marble':{'noise_type':'turbulence', 'frequency':0.08, 'amplitude':1.00, 'noise_exp':0.7, 'peak_exp':1.0, 'valley_exp':1.0,  'valley_floor':0.00, 'offset': 0.0, 'octaves':5, 'persistence':0.55, 'lacunarity':2.2, 'distortion':0.30, 'contrast':1.4, 'sharpness':0.30, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':1, 'smooth_str':0.3},
    'natural-ridge':   {'noise_type':'hybrid',     'frequency':0.06, 'amplitude':1.20, 'noise_exp':0.6, 'peak_exp':1.2, 'valley_exp':0.50, 'valley_floor':0.30, 'offset': 0.0, 'octaves':4, 'persistence':0.50, 'lacunarity':2.0, 'distortion':0.20, 'contrast':1.2, 'sharpness':0.10, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':1, 'smooth_str':0.4},
    'organic-swirl':   {'noise_type':'domainwarp', 'frequency':0.05, 'amplitude':1.00, 'noise_exp':0.5, 'peak_exp':1.0, 'valley_exp':1.0,  'valley_floor':0.00, 'offset': 0.0, 'octaves':3, 'persistence':0.50, 'lacunarity':1.8, 'distortion':0.00, 'contrast':1.1, 'sharpness':0.00, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':2, 'smooth_str':0.5},
    'worley-cracks':   {'noise_type':'worley',     'frequency':0.12, 'amplitude':0.50, 'noise_exp':0.8, 'peak_exp':1.0, 'valley_exp':1.0,  'valley_floor':0.00, 'offset': 0.2, 'octaves':1, 'persistence':0.50, 'lacunarity':2.0, 'distortion':0.10, 'contrast':1.2, 'sharpness':0.30, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':1, 'smooth_str':0.4},
    'brushed-metal':   {'noise_type':'gabor',      'frequency':0.10, 'amplitude':0.30, 'noise_exp':0.5, 'peak_exp':1.0, 'valley_exp':1.0,  'valley_floor':0.00, 'offset': 0.0, 'octaves':1, 'persistence':0.50, 'lacunarity':2.0, 'distortion':0.00, 'contrast':1.0, 'sharpness':0.00, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':1, 'smooth_str':0.3},
    # Voronoi Relief presets — relief_* keys consumed by the noise component when noise_type == 'voronoi-relief'.
    'relief-vertical': {'noise_type':'voronoi-relief', 'frequency':0.10, 'amplitude':2.50, 'noise_exp':1.0, 'peak_exp':1.0, 'valley_exp':1.0, 'valley_floor':0.00, 'offset':0.0, 'octaves':1, 'persistence':0.50, 'lacunarity':2.0, 'distortion':0.55, 'contrast':1.0, 'sharpness':0.00, 'mesh_x':24, 'mesh_y':48, 'smooth_iter':3, 'smooth_str':0.55,
                        'relief_cell_size':1.6, 'relief_jitter':0.95, 'relief_relax_iter':1, 'relief_polarity':'domes', 'relief_profile':'hemisphere', 'relief_seam_depth':0.95, 'relief_seam_width':0.14, 'relief_anisotropy':0.0, 'relief_anisotropy_angle':0.0, 'relief_attractor_mode':'vertical', 'relief_attractor_x':0.5, 'relief_attractor_y':0.0, 'relief_attractor_radius':0.5, 'relief_attractor_falloff':2.2, 'relief_density_strength':1.8, 'relief_intensity_strength':1.0, 'relief_transition_softness':0.45, 'relief_base_mode':'wave', 'relief_cell_size_gradient':1.0, 'relief_void_strength':0.7},
    'relief-radial':   {'noise_type':'voronoi-relief', 'frequency':0.10, 'amplitude':1.20, 'noise_exp':1.0, 'peak_exp':1.0, 'valley_exp':1.0, 'valley_floor':0.00, 'offset':0.0, 'octaves':1, 'persistence':0.50, 'lacunarity':2.0, 'distortion':0.25, 'contrast':1.0, 'sharpness':0.00, 'mesh_x':24, 'mesh_y':24, 'smooth_iter':1, 'smooth_str':0.4,
                        'relief_cell_size':1.6, 'relief_jitter':0.6, 'relief_relax_iter':1, 'relief_polarity':'domes', 'relief_profile':'cosine', 'relief_seam_depth':0.55, 'relief_seam_width':0.14, 'relief_anisotropy':0.0, 'relief_anisotropy_angle':0.0, 'relief_attractor_mode':'radial', 'relief_attractor_x':0.5, 'relief_attractor_y':0.4, 'relief_attractor_radius':0.6, 'relief_attractor_falloff':1.2, 'relief_density_strength':1.0, 'relief_intensity_strength':1.0, 'relief_transition_softness':0.4, 'relief_base_mode':'flat', 'relief_cell_size_gradient':0.6, 'relief_void_strength':0.0},
    'relief-pockets':  {'noise_type':'voronoi-relief', 'frequency':0.10, 'amplitude':4.50, 'noise_exp':1.0, 'peak_exp':1.0, 'valley_exp':1.0, 'valley_floor':0.00, 'offset':0.0, 'octaves':1, 'persistence':0.50, 'lacunarity':2.0, 'distortion':0.5, 'contrast':1.0, 'sharpness':0.00, 'mesh_x':24, 'mesh_y':48, 'smooth_iter':2, 'smooth_str':0.5,
                        'relief_cell_size':6.0, 'relief_jitter':0.85, 'relief_relax_iter':1, 'relief_polarity':'pockets', 'relief_profile':'hemisphere', 'relief_seam_depth':0.28, 'relief_seam_width':0.10, 'relief_anisotropy':0.35, 'relief_anisotropy_angle':75.0, 'relief_attractor_mode':'vertical', 'relief_attractor_x':0.5, 'relief_attractor_y':0.0, 'relief_attractor_radius':0.5, 'relief_attractor_falloff':0.8, 'relief_density_strength':2.0, 'relief_intensity_strength':0.55, 'relief_transition_softness':0.5, 'relief_base_mode':'flat', 'relief_cell_size_gradient':2.0, 'relief_void_strength':0.0, 'relief_attractor_noise':0.85, 'relief_attractor_noise_freq':0.13, 'relief_flow_anisotropy':0.55},
}

p = PRESETS.get(str(preset), PRESETS['gentle-waves'])

noise_type   = p['noise_type']
frequency    = p['frequency']
amplitude    = p['amplitude']
noise_exp    = p['noise_exp']
peak_exp     = p['peak_exp']
valley_exp   = p['valley_exp']
valley_floor = p['valley_floor']
offset       = p['offset']
octaves      = p['octaves']
persistence  = p['persistence']
lacunarity   = p['lacunarity']
distortion   = p['distortion']
contrast     = p['contrast']
sharpness    = p['sharpness']
mesh_x       = p['mesh_x']
mesh_y       = p['mesh_y']
smooth_iter  = p['smooth_iter']
smooth_str   = p['smooth_str']
# Voronoi Relief outputs (only meaningful when noise_type == 'voronoi-relief'; non-relief
# presets fall back to the in-component defaults via .get).
relief_cell_size           = p.get('relief_cell_size',           1.5)
relief_jitter              = p.get('relief_jitter',              0.7)
relief_relax_iter          = p.get('relief_relax_iter',          1)
relief_polarity            = p.get('relief_polarity',            'domes')
relief_profile             = p.get('relief_profile',             'hemisphere')
relief_seam_depth          = p.get('relief_seam_depth',          0.6)
relief_seam_width          = p.get('relief_seam_width',          0.15)
relief_anisotropy          = p.get('relief_anisotropy',          0.0)
relief_anisotropy_angle    = p.get('relief_anisotropy_angle',    0.0)
relief_attractor_mode      = p.get('relief_attractor_mode',      'none')
relief_attractor_x         = p.get('relief_attractor_x',         0.5)
relief_attractor_y         = p.get('relief_attractor_y',         0.5)
relief_attractor_radius    = p.get('relief_attractor_radius',    0.5)
relief_attractor_falloff   = p.get('relief_attractor_falloff',   1.0)
relief_density_strength    = p.get('relief_density_strength',    0.0)
relief_intensity_strength  = p.get('relief_intensity_strength',  1.0)
relief_transition_softness = p.get('relief_transition_softness', 0.3)
relief_base_mode           = p.get('relief_base_mode',           'flat')
relief_cell_size_gradient  = p.get('relief_cell_size_gradient',  0.0)
relief_void_strength       = p.get('relief_void_strength',       0.0)
relief_attractor_noise     = p.get('relief_attractor_noise',     0.0)
relief_attractor_noise_freq= p.get('relief_attractor_noise_freq',0.15)
relief_flow_anisotropy     = p.get('relief_flow_anisotropy',     0.0)
"""

    # ── Builder helpers ────────────────────────────────────────────────────
    _dbg("Step 3: Creating GH_Document...")
    doc = ghk.GH_Document()
    _dbg("  GH_Document created: " + str(type(doc)))

    def make_ghpy(nickname, script, x, y):
        _dbg("  Creating component: " + nickname)
        c = ZuiPythonComponent()
        c.NickName = nickname
        c.Name = nickname
        c.Description = nickname
        c.CreateAttributes()
        _dbg("    Attributes created, setting Code (" + str(len(script)) + " chars)...")
        try:
            c.Code = script
            _dbg("    Code set OK")
        except Exception as ex:
            _dbg("    WARNING: Code setter failed: " + str(ex))
            _dbg("    HiddenCodeInput = " + str(c.HiddenCodeInput) if hasattr(c, 'HiddenCodeInput') else "    (no HiddenCodeInput attr)")
        c.Attributes.Pivot = System.Drawing.PointF(x, y)
        doc.AddObject(c, False)
        _dbg("    Added to doc at (" + str(x) + ", " + str(y) + ")")
        return c

    def add_in(comp, name, access=ghk.GH_ParamAccess.item):
        idx = comp.Params.Input.Count
        p = comp.CreateParameter(GH_ParameterSide.Input, idx)
        p.NickName = name; p.Name = name; p.Description = name
        p.Optional = True; p.Access = access
        comp.Params.RegisterInputParam(p)
        return p

    def add_out(comp, name, access=ghk.GH_ParamAccess.item):
        idx = comp.Params.Output.Count
        p = comp.CreateParameter(GH_ParameterSide.Output, idx)
        p.NickName = name; p.Name = name; p.Description = name
        p.Access = access
        comp.Params.RegisterOutputParam(p)
        return p

    def fslider(nick, x, y, mn, mx, default, dec=2):
        s = ghs.GH_NumberSlider(); s.CreateAttributes()
        s.NickName = nick
        s.Slider.Minimum = System.Decimal(mn)
        s.Slider.Maximum = System.Decimal(mx)
        s.Slider.DecimalPlaces = dec
        s.SetSliderValue(System.Decimal(default))
        s.Attributes.Pivot = System.Drawing.PointF(x, y)
        doc.AddObject(s, False); return s

    def islider(nick, x, y, mn, mx, default):
        s = ghs.GH_NumberSlider(); s.CreateAttributes()
        s.NickName = nick
        s.Slider.Minimum = System.Decimal(mn)
        s.Slider.Maximum = System.Decimal(mx)
        s.Slider.DecimalPlaces = 0
        s.SetSliderValue(System.Decimal(default))
        s.Attributes.Pivot = System.Drawing.PointF(x, y)
        doc.AddObject(s, False); return s

    def vlist(x, y, items, default_idx=0):
        vl = ghs.GH_ValueList(); vl.CreateAttributes()
        vl.ListItems.Clear()
        for label, val in items:
            vl.ListItems.Add(ghs.GH_ValueListItem(label, '"' + val + '"'))
        vl.SelectItem(default_idx)
        vl.Attributes.Pivot = System.Drawing.PointF(x, y)
        doc.AddObject(vl, False); return vl

    # ── Noise type + preset lists ──────────────────────────────────────────
    NOISE_TYPES = [
        ("Simplex",             "simplex"),
        ("Perlin",              "perlin"),
        ("Value",               "value"),
        ("OpenSimplex2",        "opensimplex2"),
        ("Ridged",              "ridged"),
        ("Billow",              "billow"),
        ("FBM",                 "fbm"),
        ("Turbulence",          "turbulence"),
        ("Hybrid Multifractal", "hybrid"),
        ("Hetero Terrain",      "hetero"),
        ("Domain Warp",         "domainwarp"),
        ("Voronoi",             "voronoi"),
        ("Worley",              "worley"),
        ("Gabor",               "gabor"),
        ("Wavelet",             "wavelet"),
        ("Voronoi Relief",      "voronoi-relief"),
    ]

    # relief_* input pins added to the Noise component when the user wires the
    # voronoi-relief mode. They mirror `relief*` fields in the TS state.
    RELIEF_INPUTS = [
        "relief_cell_size", "relief_jitter", "relief_relax_iter",
        "relief_polarity", "relief_profile",
        "relief_seam_depth", "relief_seam_width",
        "relief_anisotropy", "relief_anisotropy_angle",
        "relief_attractor_mode",
        "relief_attractor_x", "relief_attractor_y",
        "relief_attractor_radius", "relief_attractor_falloff",
        "relief_density_strength", "relief_intensity_strength",
        "relief_transition_softness", "relief_base_mode",
        "relief_cell_size_gradient", "relief_void_strength",
        "relief_attractor_noise", "relief_attractor_noise_freq", "relief_flow_anisotropy",
    ]

    PRESET_NAMES = [
        ("Gentle Waves",      "gentle-waves"),
        ("Organic Terrain",   "organic-terrain"),
        ("Sharp Ridges",      "sharp-ridges"),
        ("Voronoi Cells",     "voronoi-cells"),
        ("Subtle Texture",    "subtle-texture"),
        ("Deep Carve",        "deep-carve"),
        ("Sculptural",        "sculptural"),
        ("Hard Wave",         "hard-wave"),
        ("Eroded Stone",      "eroded-stone"),
        ("Billowy Clouds",    "billowy-clouds"),
        ("Turbulent Marble",  "turbulent-marble"),
        ("Natural Ridge",     "natural-ridge"),
        ("Organic Swirl",     "organic-swirl"),
        ("Worley Cracks",     "worley-cracks"),
        ("Brushed Metal",     "brushed-metal"),
        ("Relief Vertical",   "relief-vertical"),
        ("Relief Radial",     "relief-radial"),
        ("Relief Pockets",    "relief-pockets"),
    ]

    # ── Canvas x anchors ──────────────────────────────────────────────────
    SL1 = 50      # Noise Gen sliders (left column)
    NC  = 500     # Noise Gen component
    SL2 = 760     # Shape sliders
    SC  = 1150    # Shape component
    SL3 = 1410    # Smooth sliders
    SMC = 1700    # Smooth component
    PVL = -300    # Preset value list (far left)
    PC  = 50      # Presets component (below noise block)
    DY  = 42      # Row height

    a = "checkpoint: step 3 - scripts loaded (Noise:" + str(len(NOISE_SCRIPT)) + " Shape:" + str(len(SHAPE_SCRIPT)) + " Smooth:" + str(len(SMOOTH_SCRIPT)) + " Presets:" + str(len(PRESETS_SCRIPT)) + ")"

    # ── Create MeshCraft | Noise ───────────────────────────────────────────
    a = "checkpoint: step 4 - creating Noise component"
    noise_comp = make_ghpy("MeshCraft | Noise", NOISE_SCRIPT, NC, 330)

    ni = {}
    for name in ["noise_type","seed","frequency","octaves","persistence",
                 "lacunarity","distortion","gabor_angle","gabor_bw",
                 "mesh_x","mesh_y","resolution"]:
        ni[name] = add_in(noise_comp, name)
    # Voronoi-relief input pins. Unwired by default — the embedded NOISE_SCRIPT
    # handles missing/None values via `_relief_default`, so these pins can sit
    # empty when noise_type != 'voronoi-relief'.
    for name in RELIEF_INPUTS:
        ni[name] = add_in(noise_comp, name)

    no = {}
    no["z_values"] = add_out(noise_comp, "z_values", ghk.GH_ParamAccess.list)
    no["cols"]     = add_out(noise_comp, "cols")
    no["rows"]     = add_out(noise_comp, "rows")
    no["mesh_x"]   = add_out(noise_comp, "mesh_x")
    no["mesh_y"]   = add_out(noise_comp, "mesh_y")

    # ── Create MeshCraft | Shape ───────────────────────────────────────────
    shape_comp = make_ghpy("MeshCraft | Shape", SHAPE_SCRIPT, SC, 380)

    si = {}
    si["z_values"] = add_in(shape_comp, "z_values", ghk.GH_ParamAccess.list)
    for name in ["cols","rows","mesh_x","mesh_y"]:
        si[name] = add_in(shape_comp, name)
    for name in ["amplitude","noise_exp","peak_exp","valley_exp",
                 "valley_floor","offset","contrast","sharpness"]:
        si[name] = add_in(shape_comp, name)

    so = {}
    so["pts"]  = add_out(shape_comp, "pts",  ghk.GH_ParamAccess.list)
    so["cols"] = add_out(shape_comp, "cols")
    so["rows"] = add_out(shape_comp, "rows")

    # ── Create MeshCraft | Smooth ──────────────────────────────────────────
    smooth_comp = make_ghpy("MeshCraft | Smooth", SMOOTH_SCRIPT, SMC, 360)

    smi = {}
    smi["pts"]         = add_in(smooth_comp, "pts",  ghk.GH_ParamAccess.list)
    smi["cols"]        = add_in(smooth_comp, "cols")
    smi["rows"]        = add_in(smooth_comp, "rows")
    smi["smooth_iter"] = add_in(smooth_comp, "smooth_iter")
    smi["smooth_str"]  = add_in(smooth_comp, "smooth_str")

    smo = {}
    smo["pts"] = add_out(smooth_comp, "pts", ghk.GH_ParamAccess.list)

    # ── Create MeshCraft | Presets ─────────────────────────────────────────
    preset_comp = make_ghpy("MeshCraft | Presets", PRESETS_SCRIPT, PC + 300, 720)

    pri = {}
    pri["preset"] = add_in(preset_comp, "preset")

    pro = {}
    for name in ["noise_type","frequency","amplitude","noise_exp","peak_exp",
                 "valley_exp","valley_floor","offset","octaves","persistence",
                 "lacunarity","distortion","contrast","sharpness",
                 "mesh_x","mesh_y","smooth_iter","smooth_str"]:
        pro[name] = add_out(preset_comp, name)
    # Voronoi-relief preset outputs — wire to the Noise component's matching pins
    # to use the relief presets (relief-vertical / relief-radial / relief-pockets).
    for name in RELIEF_INPUTS:
        pro[name] = add_out(preset_comp, name)

    a = "checkpoint: step 5 - creating sliders"
    # ── Sliders: Noise Gen ────────────────────────────────────────────────
    Y = 100
    vl_noise = vlist(SL1, Y, NOISE_TYPES, 0)                              ; Y += DY
    sl = {}
    sl["seed"]        = islider("seed",        SL1, Y,   0, 999,  0)      ; Y += DY
    sl["frequency"]   = fslider("frequency",   SL1, Y, .01,  .5, .1)      ; Y += DY
    sl["octaves"]     = islider("octaves",      SL1, Y,   1,   8,  2)      ; Y += DY
    sl["persistence"] = fslider("persistence", SL1, Y,  .1,  .9, .5)      ; Y += DY
    sl["lacunarity"]  = fslider("lacunarity",  SL1, Y, 1.0, 4.0, 2.0)     ; Y += DY
    sl["distortion"]  = fslider("distortion",  SL1, Y, 0.0, 1.0, 0.0)     ; Y += DY
    sl["gabor_angle"] = fslider("gabor_angle", SL1, Y, 0.0, 180., 45., 1) ; Y += DY
    sl["gabor_bw"]    = fslider("gabor_bw",    SL1, Y, 0.1, 3.0, 1.5)     ; Y += DY
    sl["mesh_x"]      = fslider("mesh_x",      SL1, Y, 1.0, 36., 36., 1)  ; Y += DY
    sl["mesh_y"]      = fslider("mesh_y",      SL1, Y, 1.0, 24., 24., 1)  ; Y += DY
    sl["resolution"]  = islider("resolution",   SL1, Y,  16, 256, 96)      ; Y += DY

    # ── Sliders: Shape ────────────────────────────────────────────────────
    Y = 100
    sl["amplitude"]    = fslider("amplitude",    SL2, Y, .01, 6.0, .65)   ; Y += DY
    sl["noise_exp"]    = fslider("noise_exp",    SL2, Y, 0.1, 3.0, 0.5)   ; Y += DY
    sl["peak_exp"]     = fslider("peak_exp",     SL2, Y, 0.1, 3.0, 1.0)   ; Y += DY
    sl["valley_exp"]   = fslider("valley_exp",   SL2, Y, 0.1, 3.0, 1.0)   ; Y += DY
    sl["valley_floor"] = fslider("valley_floor", SL2, Y, 0.0, 1.0, 0.0)   ; Y += DY
    sl["offset"]       = fslider("offset",       SL2, Y,-2.0, 2.0, 0.0)   ; Y += DY
    sl["contrast"]     = fslider("contrast",     SL2, Y, 0.1, 3.0, 1.0)   ; Y += DY
    sl["sharpness"]    = fslider("sharpness",    SL2, Y, 0.0, 2.0, 0.0)   ; Y += DY

    # ── Sliders: Smooth ───────────────────────────────────────────────────
    Y = 100
    sl["smooth_iter"] = islider("smooth_iter", SL3, Y, 0, 8,   0)         ; Y += DY
    sl["smooth_str"]  = fslider("smooth_str",  SL3, Y, 0., 1., 0.5)       ; Y += DY

    # ── Preset value list (placed left of noise block, y=720) ─────────────
    vl_preset = vlist(PVL, 720, PRESET_NAMES, 0)

    a = "checkpoint: step 6 - wiring " + str(len(sl)) + " sliders"
    # ── Wire: sliders → Noise Gen ─────────────────────────────────────────
    ni["noise_type"].AddSource(vl_noise)
    for k in ["seed","frequency","octaves","persistence","lacunarity",
              "distortion","gabor_angle","gabor_bw","mesh_x","mesh_y","resolution"]:
        ni[k].AddSource(sl[k])

    # ── Wire: Noise Gen → Shape ───────────────────────────────────────────
    si["z_values"].AddSource(no["z_values"])
    si["cols"].AddSource(no["cols"])
    si["rows"].AddSource(no["rows"])
    si["mesh_x"].AddSource(no["mesh_x"])
    si["mesh_y"].AddSource(no["mesh_y"])

    # ── Wire: sliders → Shape ─────────────────────────────────────────────
    for k in ["amplitude","noise_exp","peak_exp","valley_exp",
              "valley_floor","offset","contrast","sharpness"]:
        si[k].AddSource(sl[k])

    # ── Wire: Shape → Smooth ──────────────────────────────────────────────
    smi["pts"].AddSource(so["pts"])
    smi["cols"].AddSource(so["cols"])
    smi["rows"].AddSource(so["rows"])
    smi["smooth_iter"].AddSource(sl["smooth_iter"])
    smi["smooth_str"].AddSource(sl["smooth_str"])

    # ── Wire: preset VL → Presets comp (outputs remain unwired) ──────────
    pri["preset"].AddSource(vl_preset)
    # To use a preset: right-click any Noise/Shape/Smooth input,
    # disconnect its slider, and wire the matching Presets output into it.

    a = "checkpoint: step 7 - saving (" + str(doc.ObjectCount) + " objects) to " + _sp

    io = ghk.GH_DocumentIO(doc)
    ok = io.SaveQuiet(_sp)

    if ok and os.path.isfile(_sp):
        fsize = os.path.getsize(_sp)
        a = "SUCCESS: saved " + _sp + " (" + str(fsize) + " bytes, " + str(doc.ObjectCount) + " objects)"
    elif ok:
        a = "WARNING: SaveQuiet=True but file not found at " + _sp
    else:
        a = "FAILED: SaveQuiet returned False for " + _sp

except Exception as e:
    if str(e) != "EARLY_EXIT":
        _dbg("EXCEPTION: " + str(e))
        _dbg("Type: " + str(type(e).__name__))
        _dbg("Traceback:")
        _dbg(traceback.format_exc())
    a = "\n".join(_log)
