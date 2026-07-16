# GHPython component script — MeshCraft | Noise
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
# v16: per-pixel flow anisotropy removed (it tore cell ownership — the space-warp below
# replaces it). relief_flow_anisotropy pins on old canvases are simply ignored.
relief_invert_profile      = _relief_default('relief_invert_profile',      0.0)
relief_seam_sharpness      = _relief_default('relief_seam_sharpness',      0.0)
relief_base_amp            = _relief_default('relief_base_amp',            0.0)
relief_base_freq           = _relief_default('relief_base_freq',           0.1)
relief_wall_width          = _relief_default('relief_wall_width',          0.0)
relief_density_noise       = _relief_default('relief_density_noise',       0.0)
relief_density_noise_freq  = _relief_default('relief_density_noise_freq',  0.08)
relief_pillow              = _relief_default('relief_pillow',              0.0)
relief_pillow_coverage     = _relief_default('relief_pillow_coverage',     0.6)
relief_depth_variation     = _relief_default('relief_depth_variation',     0.0)
relief_junction_lift       = _relief_default('relief_junction_lift',       0.0)
relief_crest_variation     = _relief_default('relief_crest_variation',     0.0)
relief_radial_foci_count   = _relief_default('relief_radial_foci_count',   0)
relief_radial_focus1_x     = _relief_default('relief_radial_focus1_x',     0.5)
relief_radial_focus1_y     = _relief_default('relief_radial_focus1_y',     0.25)
relief_radial_focus2_x     = _relief_default('relief_radial_focus2_x',     0.25)
relief_radial_focus2_y     = _relief_default('relief_radial_focus2_y',     0.6)
relief_radial_focus3_x     = _relief_default('relief_radial_focus3_x',     0.75)
relief_radial_focus3_y     = _relief_default('relief_radial_focus3_y',     0.8)
relief_radial_strength     = _relief_default('relief_radial_strength',     1.5)
relief_radial_falloff      = _relief_default('relief_radial_falloff',      0.3)
relief_radial_grow         = _relief_default('relief_radial_grow',         0.45)
relief_radial_warp         = _relief_default('relief_radial_warp',         0.4)
relief_radial_mode         = _relief_default('relief_radial_mode',         'rays')         # 'rays'|'rings'|'spiral'
# warp_freq for the relief sampler — mirrors `warpFreq` in TS sampleReliefParamsFromState.
# Default 0.08 matches the canonical TS relief presets; the input pin can override per-run.
relief_warp_freq           = _relief_default('relief_warp_freq',           0.08)

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
    def _cell_hash01(self, idx, seed):
        # Deterministic per-cell hash in [0, 1) from the owning site index — drives which
        # cells get pillowed floors. Mirrors cellHash01 in the TS sampler.
        h = (((idx + 1) * 374761393) + ((seed & 0xffffffff) * 668265263)) & 0xffffffff
        h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
        return float((h ^ (h >> 16)) & 0xffffffff) / 4294967296.0
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
    # (_dome removed with the F2-F1 algorithm — profile is now a falloff curve applied to
    # the normalized F2-F1 differential inside sample_grid, not a per-site radial profile.)
    SITE_COUNT_MAX = 4096
    LOCAL_DENSITY_MAX = 4.0
    # Output clamp magnitude. Used with explicit negative sign at carve sites.
    OUTPUT_HEIGHT_CLAMP = 1.05
    # v16 flow-warp + v16.2 polar-lattice + v18 boundary-distance constants — mirror the TS sampler.
    FLOW_WARP_AMPLITUDE_CELLS = 0.9
    POLAR_ZONE_SIGMAS = 1.0
    POLAR_TANGENTIAL_PITCH_CELLS = 0.85
    POLAR_EXCLUSION_FRACTION = 0.9
    CREST_VARIATION_GAIN = 0.4
    SUPPRESSION_STRENGTH = 0.65
    JUNCTION_LIFT_GAIN = 0.18
    # Crest plateau width modulation along each edge (chunky-to-thin ridge swings),
    # clamped at 0.15x so ridges thin to threads but never vanish.
    RIDGE_WIDTH_SWING = 1.2
    SIZE_DEPTH_MIN = 0.8
    SIZE_DEPTH_MAX = 1.2
    DENSITY_NOISE_GAIN = 1.6
    FOCAL_EXPAND_GAIN = 1.7
    FOCAL_EXPAND_CAP = 2.2
    def _gen_sites(self, p, density_gen, exclusion_foci, exclusion_r):
        # v16: sites live on the unwarped jittered grid and are NEVER displaced — cell flow
        # comes entirely from warping the query points (see _make_warp). Density is modulated
        # by the attractor mask and a low-frequency noise field (giant-vs-small patches).
        spacing = max(0.2, p['cell_size'])
        nx = max(2, int(math.ceil(p['mesh_x'] / spacing)) + 1)
        ny = max(2, int(math.ceil(p['mesh_y'] / spacing)) + 1)
        sx = p['mesh_x'] / nx; sy = p['mesh_y'] / ny
        dn_amt = max(0.0, min(1.5, p.get('density_noise', 0.0)))
        dn_freq = max(0.02, min(0.3, p.get('density_noise_freq', 0.08)))
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
                if density_gen is not None and dn_amt > 0.0:
                    n = density_gen.noise(cx * dn_freq, cy * dn_freq)
                    local *= max(0.1, min(self.LOCAL_DENSITY_MAX, 1.0 + dn_amt * n * self.DENSITY_NOISE_GAIN))
                    # v17 heavy-tail spikes: abrupt scale jumps beside calm masses.
                    spike = self._rand()
                    if spike < 0.03 * dn_amt: local *= 3.0
                    elif spike < 0.08 * dn_amt: local *= 0.12
                local = min(self.LOCAL_DENSITY_MAX, max(0.1, local))
                reps = int(math.floor(local))
                if self._rand() < (local - math.floor(local)):
                    reps += 1
                for _ in range(reps):
                    if len(sites) >= self.SITE_COUNT_MAX: break
                    jx = (self._rand() - 0.5) * p['jitter'] * sx
                    jy = (self._rand() - 0.5) * p['jitter'] * sy
                    px = max(0.0, min(p['mesh_x'], cx + jx))
                    py = max(0.0, min(p['mesh_y'], cy + jy))
                    # v16.2: polar lattices own the focal zones — Cartesian sites inside
                    # an exclusion disc would shred the petal structure.
                    if exclusion_r > 0.0:
                        excluded = False
                        for f in range(len(exclusion_foci)):
                            dx = px - exclusion_foci[f][0]
                            dy = py - exclusion_foci[f][1]
                            if dx * dx + dy * dy < exclusion_r * exclusion_r:
                                excluded = True
                                break
                        if excluded:
                            continue
                    sites.append([px, py, 0.0])
        return sites
    def _make_warp(self, p, seed, warp_distortion):
        # Flow warp W (global distortion/warpFreq sliders). Returns None when inactive.
        # Sites are NEVER passed through W — only query points are. (v16.2: the starburst
        # no longer lives here — see _gen_polar_sites.)
        flow_amp = warp_distortion * max(0.2, p['cell_size']) * self.FLOW_WARP_AMPLITUDE_CELLS
        # Finite fallback before the clamp — max() propagates NaN into every warped query.
        ff_raw = float(p.get('warp_frequency', 0.1))
        if ff_raw != ff_raw or ff_raw == float('inf') or ff_raw == float('-inf'):
            ff_raw = 0.1
        flow_freq = max(0.02, ff_raw)
        if flow_amp <= 0:
            return None
        flow_gen = SimplexNoise(seed + 17 + 13)
        def warp(x, y):
            qx = x + flow_gen.noise(x * flow_freq, y * flow_freq) * flow_amp
            qy = y + flow_gen.noise(x * flow_freq + 31.7, y * flow_freq + 17.3) * flow_amp
            return qx, qy
        return warp
    def _gen_polar_sites(self, foci_phys, zone_r, cell_size, radial_strength, radial_grow, jitter_amt, mode, mesh_x, mesh_y, sites):
        # Starburst polar site lattices (v16.2). Around each focus: a nucleus site plus
        # jittered concentric rings whose RADIAL gap is (1 + radialStrength) x the
        # tangential pitch — the Voronoi cells of that lattice are radially elongated
        # petals fanning out of the node. 'rings' swaps the pitches (tangential arcs);
        # 'spiral' advances each ring by the golden angle. Mirrors the TS sampler.
        pitch_t = max(0.3, cell_size * self.POLAR_TANGENTIAL_PITCH_CELLS
                      * (1.0 + 0.5 * max(0.0, min(2.0, radial_grow))))
        elong = 1.0 + max(0.0, min(4.0, radial_strength))
        margin = max(0.2, cell_size)
        for k in range(len(foci_phys)):
            if len(sites) >= self.SITE_COUNT_MAX: break
            cpx = foci_phys[k][0]; cpy = foci_phys[k][1]
            sites.append([
                max(0.0, min(mesh_x, cpx + (self._rand() - 0.5) * 0.2 * pitch_t)),
                max(0.0, min(mesh_y, cpy + (self._rand() - 0.5) * 0.2 * pitch_t)),
                0.0])
            base_theta = self._rand() * 2.0 * math.pi
            r = pitch_t * 0.75
            ring = 0
            while r < zone_r and len(sites) < self.SITE_COUNT_MAX:
                if mode == 'rings':
                    gap = pitch_t * 0.8
                    pitch = pitch_t * elong
                else:
                    gap = pitch_t * elong * (1.0 + 0.1 * ring)
                    pitch = pitch_t
                r_mid = r + gap * 0.5
                sectors = max(4, int(round((2.0 * math.pi * r_mid) / pitch)))
                spiral_off = ring * 0.381966 * 2.0 * math.pi if mode == 'spiral' else 0.0
                for si in range(sectors):
                    if len(sites) >= self.SITE_COUNT_MAX: break
                    # v17 sector dropout — random spoke deletion breaks radial regularity.
                    if self._rand() < 0.25 * jitter_amt: continue
                    th = (base_theta + spiral_off + ((si + 0.5) / float(sectors)) * 2.0 * math.pi
                          + (self._rand() - 0.5) * jitter_amt * (2.0 * math.pi / sectors))
                    rr = r_mid + (self._rand() - 0.5) * jitter_amt * gap * 0.7
                    sx0 = cpx + rr * math.cos(th)
                    sy0 = cpy + rr * math.sin(th)
                    if sx0 < -margin or sx0 > mesh_x + margin or sy0 < -margin or sy0 > mesh_y + margin:
                        continue
                    sites.append([
                        max(0.0, min(mesh_x, sx0)),
                        max(0.0, min(mesh_y, sy0)),
                        0.0])
                r += gap
                ring += 1
    def _nearest_three(self, sites, x, y, cosA, sinA, aniso_scale):
        # CONSTANT anisotropic metric (v16 removed per-pixel rotation — a constant frame
        # cannot tear ownership). F3 drives junction detection: at a three-way Voronoi
        # corner F1 ≈ F2 ≈ F3, so (F3 − F1) → 0 exactly at junctions (v16.3).
        # v18.1: also returns the COMPETITOR INDICES so callers can compute the exact
        # bisector distance to the shared cell boundary.
        f1 = float('inf'); f2 = float('inf'); f3 = float('inf')
        idx = 0; idx2 = -1; idx3 = -1
        isotropic = (aniso_scale <= 1.0001)
        for i in range(len(sites)):
            dx = x - sites[i][0]; dy = y - sites[i][1]
            if isotropic:
                d = math.sqrt(dx * dx + dy * dy)
            else:
                xr = dx * cosA + dy * sinA
                yr = -dx * sinA + dy * cosA
                d = math.sqrt((xr * aniso_scale) ** 2 + yr * yr)
            if d < f1: f3 = f2; idx3 = idx2; f2 = f1; idx2 = idx; f1 = d; idx = i
            elif d < f2: f3 = f2; idx3 = idx2; f2 = d; idx2 = i
            elif d < f3: f3 = d; idx3 = i
        if f2 == float('inf'): idx2 = -1
        if f3 == float('inf'): idx3 = -1
        return f1, f2, f3, idx, idx2, idx3
    def _halton(self, index, base):
        result = 0.0; f = 1.0 / base; i = index
        while i > 0:
            result += f * (i % base)
            i = i // base
            f /= base
        return result
    def _lloyd_relax(self, sites, p, samples, warp_fn, pinned_from):
        # One Lloyd pass — move each site toward the centroid of its assigned low-discrepancy
        # samples. Samples are warped through W so relaxation happens in the same space the
        # distance queries use.
        n = len(sites)
        sumX = [0.0] * n; sumY = [0.0] * n; counts = [0] * n
        for s in range(samples):
            x = self._halton(s + 1, 2) * p['mesh_x']
            y = self._halton(s + 1, 3) * p['mesh_y']
            if warp_fn is not None:
                x, y = warp_fn(x, y)
            best_idx = 0; best_d = float('inf')
            for i in range(n):
                dx = sites[i][0] - x; dy = sites[i][1] - y
                d = dx * dx + dy * dy
                if d < best_d:
                    best_d = d; best_idx = i
            sumX[best_idx] += x; sumY[best_idx] += y; counts[best_idx] += 1
        move_limit = min(n, max(0, pinned_from))
        for i in range(move_limit):
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
        attractor_noise_gen = SimplexNoise(seed + 17 + 29) if p.get('attractor_noise', 0.0) > 0 else None
        density_noise_gen = SimplexNoise(seed + 17 + 71) if p.get('density_noise', 0.0) > 0 else None
        # Starburst foci — sanitize defensively (mirrors the TS sampler): filter non-finite,
        # clamp to [0,1], cap to 3.
        foci_norm = []
        for f in p.get('radial_foci', []):
            if len(foci_norm) >= 3: break
            fx = float(f[0]); fy = float(f[1])
            if fx != fx or fy != fy: continue
            if fx == float('inf') or fx == float('-inf'): continue
            if fy == float('inf') or fy == float('-inf'): continue
            foci_norm.append([max(0.0, min(1.0, fx)), max(0.0, min(1.0, fy))])
        foci_phys = [[f[0] * p['mesh_x'], f[1] * p['mesh_y']] for f in foci_norm]
        # Finite fallbacks BEFORE clamping — min/max propagate NaN, so a bad pin value
        # could otherwise poison sigma, the polar lattice, or focal expansion.
        def _finite(v, fallback):
            v = float(v)
            if v != v or v == float('inf') or v == float('-inf'):
                return fallback
            return v
        sigma_radial = max(1e-3,
            max(0.02, min(0.6, _finite(p.get('radial_falloff', 0.3), 0.3)))
            * math.sqrt(p['mesh_x'] * p['mesh_x'] + p['mesh_y'] * p['mesh_y']))
        radial_strength = max(0.0, min(4.0, _finite(p.get('radial_strength', 1.5), 0.0)))
        radial_grow = max(0.0, min(2.0, _finite(p.get('radial_grow', 0.45), 0.0)))
        radial_warp_amt = max(0.0, min(1.0, _finite(p.get('radial_warp', 0.4), 0.0))) if foci_phys else 0.0
        radial_mode = str(p.get('radial_mode', 'rays'))
        # Sanitize distortion ONCE — sizes both the warp amplitude and the Rfield padding.
        wd_raw = p.get('warp_distortion', 0.0)
        if wd_raw != wd_raw or wd_raw == float('inf') or wd_raw == float('-inf'):
            wd_raw = 0.0
        warp_distortion = max(0.0, min(2.0, wd_raw))
        warp_fn = self._make_warp(p, seed, warp_distortion)
        # v16.2 starburst: polar lattices own a disc of radius zone_r around each focus.
        # Foci are the sole enable — at radial_strength 0 the lattice pitch is 1:1 (no
        # elongation) but the focal organization remains.
        starburst_active = len(foci_phys) > 0
        zone_r = self.POLAR_ZONE_SIGMAS * sigma_radial if starburst_active else 0.0
        sites = self._gen_sites(p, density_noise_gen,
                                foci_phys if starburst_active else [],
                                zone_r * self.POLAR_EXCLUSION_FRACTION if starburst_active else 0.0)
        cartesian_count = len(sites)
        if starburst_active:
            # Polar sites must survive the global cap — generate into a scratch list,
            # then trim the Cartesian TAIL to reserve capacity (Cartesian-first ordering
            # is what pinned_from relies on).
            polar = []
            self._gen_polar_sites(foci_phys, zone_r, max(0.2, p['cell_size']), radial_strength,
                                  radial_grow, radial_warp_amt, radial_mode,
                                  p['mesh_x'], p['mesh_y'], polar)
            budget = max(0, self.SITE_COUNT_MAX - len(polar))
            if len(sites) > budget:
                del sites[budget:]
            cartesian_count = len(sites)
            sites.extend(polar)
        if not sites:
            return [0.0] * (p['cols'] * p['rows'])
        # Lloyd relaxation passes — clamped 0..2. Polar sites are pinned (relaxation would
        # erase their deliberate radial elongation).
        relax_iter = max(0, min(2, int(p.get('relax_iter', 1))))
        if relax_iter > 0:
            lloyd_samples = min(8192, len(sites) * 64)
            for _ in range(relax_iter):
                self._lloyd_relax(sites, p, lloyd_samples, warp_fn, cartesian_count)
        # NaN guards on the constant metric frame — mirrors the TS sampler's defensive
        # clamps (crafted params or unwired pins can pass non-finite values).
        aniso_raw = p['anisotropy']
        if aniso_raw != aniso_raw or aniso_raw == float('inf') or aniso_raw == float('-inf'):
            aniso_raw = 0.0
        aniso_raw = max(0.0, min(2.0, aniso_raw))
        angle_raw = p['anisotropy_angle']
        if angle_raw != angle_raw or angle_raw == float('inf') or angle_raw == float('-inf'):
            angle_raw = 0.0
        a_rad = angle_raw * math.pi / 180.0
        cosA = math.cos(a_rad); sinA = math.sin(a_rad)
        aniso_scale = 1.0 + aniso_raw * 1.5
        # Clamp + hoist transition_softness so pow(mask, exponent) is finite when
        # mask=0 even if a crafted param sneaks past the URL boundary.
        ts_clamped = max(0.0, min(1.0, p['transition_softness']))
        transition_exponent = 0.2 + ts_clamped * 1.8
        # v16 base superposition + wall band params.
        base_amp = max(0.0, min(2.0, p.get('base_amp', 0.0))) if p['base_mode'] == 'wave' else 0.0
        base_freq = max(0.02, min(0.3, p.get('base_freq', 0.1)))
        wall_frac = max(0.0, min(0.9, p.get('wall_width', 0.0)))
        cols = p['cols']; rows = p['rows']
        # Precompute warped query coordinates once — shared by Pass 1 and Pass 2 (identity
        # fast path when no warp is active).
        wx_arr = [0.0] * (rows * cols)
        wy_arr = [0.0] * (rows * cols)
        for j in range(rows):
            v = j / float(max(1, rows - 1)); y = v * p['mesh_y']
            for i in range(cols):
                u = i / float(max(1, cols - 1)); x = u * p['mesh_x']
                idx0 = j * cols + i
                if warp_fn is not None:
                    qx, qy = warp_fn(x, y)
                    wx_arr[idx0] = qx; wy_arr[idx0] = qy
                else:
                    wx_arr[idx0] = x; wy_arr[idx0] = y
        # Exact boundary distance (v18.1). (F2−F1)/2 is exact only on the two-site axis —
        # the true distance to the shared Voronoi boundary is the bisector distance
        # (Fk² − F1²)/(2·|sk − s1|), minimized over the two nearest competitors. Its level
        # sets are TRUE inset polygons of the cell. Measured in the same (an)isotropic
        # metric as the F-distances; capped at the panel diagonal so degenerate one-site
        # panels stay finite.
        db_cap = p['mesh_x'] + p['mesh_y']
        def site_dist(a, b):
            dx = sites[a][0] - sites[b][0]; dy = sites[a][1] - sites[b][1]
            if aniso_scale <= 1.0001:
                return math.sqrt(dx * dx + dy * dy)
            xr = dx * cosA + dy * sinA
            yr = -dx * sinA + dy * cosA
            return math.sqrt((xr * aniso_scale) ** 2 + yr * yr)
        def boundary_dist(f1, f2, f3, owner, i2, i3):
            db = db_cap
            if i2 >= 0 and f2 != float('inf'):
                d = (f2 * f2 - f1 * f1) / (2.0 * max(1e-9, site_dist(owner, i2)))
                if d < db: db = d
            if i3 >= 0 and f3 != float('inf'):
                d = (f3 * f3 - f1 * f1) / (2.0 * max(1e-9, site_dist(owner, i3)))
                if d < db: db = d
            return db
        # Pass 1: accumulate mean F1 per site to derive per-cell radius (in the warped
        # metric — the same one Pass 2 normalizes with).
        # v18: per-cell INRADIUS = max distance-to-shared-boundary observed in the cell —
        # the normalizer for the wall extent.
        n_sites = len(sites)
        radius_sum = [0.0] * n_sites
        radius_n = [0] * n_sites
        inradius = [0.0] * n_sites
        for idx0 in range(rows * cols):
            f1, f2, f3, idx, idx2, idx3 = self._nearest_three(sites, wx_arr[idx0], wy_arr[idx0], cosA, sinA, aniso_scale)
            radius_sum[idx] += f1; radius_n[idx] += 1
            db = boundary_dist(f1, f2, f3, idx, idx2, idx3)
            if db > inradius[idx]: inradius[idx] = db
        for k in range(n_sites):
            sites[k][2] = (radius_sum[k] / radius_n[k]) * 2.0 if radius_n[k] > 0 else p['cell_size']
        # v17 size-depth coupling normalizes against the MEDIAN actual cell radius.
        sorted_radii = sorted(s2[2] for s2 in sites)
        median_radius = max(0.05, sorted_radii[len(sorted_radii) // 2])
        # Pass 2: heights. Wall band + bowl profile on the F2-F1 differential, superposed
        # onto the base wave (v16 — base never attenuated by the cell system).
        polarity = -1.0 if p['polarity'] == 'pockets' else 1.0
        cell_size_grad = max(0.0, min(2.0, p.get('cell_size_gradient', 0.0)))
        void_strength = max(0.0, min(1.0, p.get('void_strength', 0.0)))
        attractor_noise_amt = max(0.0, min(1.0, p.get('attractor_noise', 0.0)))
        attractor_noise_freq = max(0.02, min(0.5, p.get('attractor_noise_freq', 0.15)))
        # intensity_strength clamp — parity with the TS sampler's defensive clamp. Out-of-range
        # values would invert (negative) or over-amplify (>1) the relief before output clamp.
        intensity_strength = max(0.0, min(1.0, p['intensity_strength']))
        seam_sharp = max(0.0, min(1.0, p.get('seam_sharpness', 0.0)))
        invert_profile = p.get('invert_profile', 0.0)
        # v16.3 spec mechanisms — mirror src/noise/voronoi-relief.ts + docs/voronoi-relief-target-spec.md.
        depth_variation = max(0.0, min(1.0, p.get('depth_variation', 0.0)))
        junction_lift = max(0.0, min(1.0, p.get('junction_lift', 0.0)))
        wall_noise_gen = SimplexNoise(seed + 17 + 83) if wall_frac > 0 else None
        wall_noise_freq = 0.45 / max(0.2, p['cell_size'])
        crest_variation = max(0.0, min(1.0, p.get('crest_variation', 0.0)))
        crest_gen = SimplexNoise(seed + 17 + 97) if crest_variation > 0 else None
        crest_freq = 0.25 / max(0.2, p['cell_size'])
        suppress_gen = SimplexNoise(seed + 17 + 103) if depth_variation > 0 else None
        suppress_freq = 0.16 / max(0.2, p['cell_size'])
        seam_depth_base = max(0.05, p['seam_depth'])
        FILLET_BAND = 0.1
        # v16.1 pillow — ramps on the UNCAPPED bowl saturation ratio (1.0 = just saturated,
        # 1.4 = deep interior); anchoring on normDist toward 1 never fires (measured).
        pillow_amt = max(0.0, min(1.0, p.get('pillow', 0.0)))
        pillow_coverage = max(0.0, min(1.0, p.get('pillow_coverage', 0.6)))
        inv2s2_radial = 1.0 / (2.0 * sigma_radial * sigma_radial)
        out = [0.0] * (cols * rows)
        for j in range(rows):
            v = j / float(max(1, rows - 1)); y = v * p['mesh_y']
            for i in range(cols):
                u = i / float(max(1, cols - 1)); x = u * p['mesh_x']
                pix = j * cols + i
                qx = wx_arr[pix]; qy = wy_arr[pix]
                f1, f2, f3, idx, idx2, idx3 = self._nearest_three(sites, qx, qy, cosA, sinA, aniso_scale)
                mask = self._attractor_mask(p['attractor_mode'], u, v,
                    p['attractor_x'], p['attractor_y'],
                    p['attractor_radius'], p['attractor_falloff'])
                if attractor_noise_gen and attractor_noise_amt > 0.0:
                    n = attractor_noise_gen.noise(x * attractor_noise_freq, y * attractor_noise_freq)
                    modulator = (n + 1.0) * 0.5
                    mask = mask * ((1.0 - attractor_noise_amt) + attractor_noise_amt * modulator * 1.5)
                    if mask > 1.0: mask = 1.0
                    if mask < 0.0: mask = 0.0
                # Focal proximity (real-space) — drives focal expansion and intensity deepening.
                g_max = 0.0
                for k in range(len(foci_phys)):
                    dx = x - foci_phys[k][0]; dy = y - foci_phys[k][1]
                    g = math.exp(-(dx * dx + dy * dy) * inv2s2_radial)
                    if g > g_max: g_max = g
                # v18 BOUNDARY-DISTANCE CONSTRUCTION (the critique's prescribed q-coordinate).
                # d_b is the exact distance to the SHARED Voronoi boundary (boundary_dist) —
                # its level sets are true inset polygons of the cell, so the floor keeps
                # polygonal ancestry. The wall extent w is normalized per cell against the
                # measured inradius, so the wall spans the FULL territory from the shared
                # boundary to the inset floor: every interior point is crest, wall, or
                # floor — no neutral gaps. q = d_b/w: 0 at the boundary, 1 at the floor edge.
                db = boundary_dist(f1, f2, f3, idx, idx2, idx3)
                inr = max(0.01, inradius[idx])
                # Scale-free junction proximity: (F3-F1)/(F3+F1) -> 0 at three-way corners.
                # With fewer than three sites there is no junction anywhere — jn stays 0.
                if f3 == float('inf'):
                    jn = 0.0
                else:
                    jn = 1.0 - min(1.0, (f3 - f1) / max(1e-9, f3 + f1))
                jn_s = self._smoothstep(0.65, 0.98, jn)
                # Ridge crest band: a physical plateau on the shared boundary. The plateau
                # width SWINGS along each edge with the wall-noise field (chunky-to-thin
                # ridges) and widens toward junctions.
                crest_w = wall_frac * max(0.2, p['cell_size']) * 0.5
                # Wall extent = seamDepth fraction of the remaining inradius, varied per cell
                # (asymmetric neighbors), along each edge (noise), and at junctions (widening).
                wall_scale = 1.0
                if depth_variation > 0.0:
                    h_seam = self._cell_hash01(idx, seed + 29)
                    wall_scale *= 1.0 + (h_seam - 0.5) * 0.8 * depth_variation
                if wall_noise_gen is not None:
                    wn = wall_noise_gen.noise(x * wall_noise_freq, y * wall_noise_freq)
                    wall_scale *= max(0.3, 1.0 + 0.6 * wn + 1.1 * jn_s)
                    crest_w *= max(0.15, 1.0 + self.RIDGE_WIDTH_SWING * wn + 1.2 * jn_s)
                if cell_size_grad > 0.0:
                    wall_scale *= 1.0 + cell_size_grad * mask * 0.6
                if radial_grow > 0.0 and g_max > 0.0:
                    wall_scale /= min(self.FOCAL_EXPAND_CAP, 1.0 + radial_grow * g_max * self.FOCAL_EXPAND_GAIN)
                w = max(0.02, seam_depth_base * max(0.02, inr - crest_w) * wall_scale)
                bowl_t_raw = max(0.0, (db - crest_w) / w)
                # Smooth floor saturation (C1 fillet into the floor) instead of a hard clamp.
                if bowl_t_raw >= 1.0 + FILLET_BAND:
                    bowl_t = 1.0
                elif bowl_t_raw <= 1.0 - FILLET_BAND:
                    bowl_t = bowl_t_raw
                else:
                    e = 1.0 + FILLET_BAND - bowl_t_raw
                    bowl_t = 1.0 - (e * e) / (4.0 * FILLET_BAND)
                # All profiles MUST have dh/dt = 0 at t=0 (boundary). Otherwise the height
                # drops from 0 with non-zero slope and mesh triangulation produces knife-edge
                # spikes along ridges. Mirrors src/noise/voronoi-relief.ts.
                if p['profile'] == 'hemisphere':
                    bowl_h = 1.0 - math.sqrt(max(0.0, 1.0 - bowl_t * bowl_t))
                elif p['profile'] == 'cosine':
                    bowl_h = 0.5 - 0.5 * math.cos(bowl_t * math.pi)
                else:  # parabolic
                    bowl_h = bowl_t * bowl_t
                # Seam sharpness — blend toward a linear ramp for V-groove gutters.
                if seam_sharp > 0.0:
                    bowl_h = (1.0 - seam_sharp) * bowl_h + seam_sharp * bowl_t
                # v16.1 pillowed floors: past saturation the floor rises back toward the
                # cell center (double-curvature pockets). Per-cell hash gates coverage and
                # varies mound height. Capped at 65% of depth so mounds stay inside pockets.
                if pillow_amt > 0.0 and bowl_t_raw > 1.0:
                    gate = self._cell_hash01(idx, seed)
                    if gate < pillow_coverage:
                        amt_var = 0.6 + 0.4 * self._cell_hash01(idx, seed + 7)
                        pillow_t = self._smoothstep(1.0, 1.4, bowl_t_raw)
                        bowl_h -= pillow_amt * amt_var * 0.65 * pillow_t
                        if bowl_h < 0.0: bowl_h = 0.0
                # invertProfile: carve the boundary instead of the interior (domed floors).
                if invert_profile > 0.5:
                    bowl_h = 1.0 - bowl_h
                # Intensity scales bowl depth by the attractor mask OR focal proximity
                # (whichever is stronger); cellWeight gates cells spatially.
                intensity = (1.0 - intensity_strength) + intensity_strength * max(mask, g_max)
                cw = pow(mask, transition_exponent)
                # v17 depth composition: size coupling + iid tier + SPATIAL suppression
                # (clusters of neighboring cells melt into calm masses).
                size_mul = max(self.SIZE_DEPTH_MIN, min(self.SIZE_DEPTH_MAX,
                    math.sqrt(sites[idx][2] / median_radius)))
                cell_depth_mul = size_mul
                if depth_variation > 0.0:
                    h_depth = self._cell_hash01(idx, seed + 13)
                    tier = 0.55 if h_depth < 0.35 else 1.0
                    cell_depth_mul *= 1.0 - depth_variation * (1.0 - tier)
                    if suppress_gen is not None:
                        sn = (suppress_gen.noise(x * suppress_freq, y * suppress_freq) + 1.0) * 0.5
                        cell_depth_mul *= 1.0 - self.SUPPRESSION_STRENGTH * depth_variation * self._smoothstep(0.62, 0.82, sn)
                base = base_amp * self.wave.noise(x * base_freq, y * base_freq) if base_amp > 0.0 else 0.0
                h = base + polarity * bowl_h * cw * intensity * cell_depth_mul
                # v17 crest variation: ridge-LOCAL height noise (fragments the envelope).
                # Both cell-derived additions are gated by cw so relief cannot reappear
                # where the attractor has faded the cell system out.
                if crest_variation > 0.0 and crest_gen is not None:
                    ridge_mask = pow(1.0 - bowl_h, 1.5)
                    h += crest_variation * self.CREST_VARIATION_GAIN * crest_gen.noise(x * crest_freq, y * crest_freq) * ridge_mask * cw
                # v17 junction lift: tighter gate, lower gain — tense nodes, not domes.
                if junction_lift > 0.0:
                    h += junction_lift * self.JUNCTION_LIFT_GAIN * jn_s * (1.0 - bowl_h) * cw
                # Void mode pushes h toward the negative clamp where mask + bowl depth are
                # high. Uses bowl_h as the carve-depth proxy (was 'seam' in the old algorithm).
                if void_strength > 0.0:
                    void_gate = mask * bowl_h
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
        'invert_profile': float(relief_invert_profile),
        'seam_sharpness': float(relief_seam_sharpness),
        'base_amp': float(relief_base_amp),
        'base_freq': float(relief_base_freq),
        'wall_width': float(relief_wall_width),
        'density_noise': float(relief_density_noise),
        'density_noise_freq': float(relief_density_noise_freq),
        'pillow': float(relief_pillow),
        'pillow_coverage': float(relief_pillow_coverage),
        'depth_variation': float(relief_depth_variation),
        'junction_lift': float(relief_junction_lift),
        'crest_variation': float(relief_crest_variation),
        'radial_foci': [
            [float(relief_radial_focus1_x), float(relief_radial_focus1_y)],
            [float(relief_radial_focus2_x), float(relief_radial_focus2_y)],
            [float(relief_radial_focus3_x), float(relief_radial_focus3_y)],
        ][:max(0, min(3, int(relief_radial_foci_count)))],
        'radial_strength': float(relief_radial_strength),
        'radial_falloff': float(relief_radial_falloff),
        'radial_grow': float(relief_radial_grow),
        'radial_warp': float(relief_radial_warp),
        'radial_mode': str(relief_radial_mode),
        'warp_distortion': float(distortion),
        'warp_frequency': float(relief_warp_freq),
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
