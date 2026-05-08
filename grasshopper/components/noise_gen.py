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
class VoronoiReliefNoise(object):
    """3D Voronoi cell relief — domed/pocketed cells with deep V-seams.
    Mirrors src/noise/voronoi-relief.ts. Per-cell radius from mean F1 inside the cell.
    Skip domain warp; relief sampler handles its own anisotropy."""
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
        if mode == 'vertical': return pow(v, max(0.05, falloff))
        if mode == 'horizontal': return pow(u, max(0.05, falloff))
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
    def _gen_sites(self, p):
        spacing = max(0.2, p['cell_size'])
        nx = max(2, int(math.ceil(p['mesh_x'] / spacing)) + 1)
        ny = max(2, int(math.ceil(p['mesh_y'] / spacing)) + 1)
        sx = p['mesh_x'] / nx; sy = p['mesh_y'] / ny
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
                    sites.append([
                        max(0.0, min(p['mesh_x'], cx + jx)),
                        max(0.0, min(p['mesh_y'], cy + jy)),
                        0.0, 0.0, 0  # radius, _radius_sum, _radius_n
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
        sites = self._gen_sites(p)
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
        # Pass 1: accumulate mean F1 per site to derive per-cell radius. Owner/F1 grid
        # not retained — Pass 2 re-runs _nearest_two for F1+F2 together.
        for j in range(rows):
            v = j / float(max(1, rows - 1)); y = v * p['mesh_y']
            for i in range(cols):
                u = i / float(max(1, cols - 1)); x = u * p['mesh_x']
                f1, f2, idx = self._nearest_two(sites, x, y, cosA, sinA, aniso_scale)
                sites[idx][3] += f1; sites[idx][4] += 1
        for s in sites:
            s[2] = (s[3] / s[4]) * 2.0 if s[4] > 0 else p['cell_size']
        # Pass 2: heights
        polarity = -1.0 if p['polarity'] == 'pockets' else 1.0
        out = [0.0] * (cols * rows)
        for j in range(rows):
            v = j / float(max(1, rows - 1)); y = v * p['mesh_y']
            for i in range(cols):
                u = i / float(max(1, cols - 1)); x = u * p['mesh_x']
                f1, f2, idx = self._nearest_two(sites, x, y, cosA, sinA, aniso_scale)
                R = max(0.05, sites[idx][2])
                dome = self._dome(p['profile'], f1, R)
                seam = 1.0 - self._smoothstep(0.0, max(0.001, p['seam_width'] * R), f2 - f1)
                # Dome decays at the seam so seamDepth represents the true trough depth.
                h = polarity * (dome * (1.0 - seam) - p['seam_depth'] * seam)
                mask = self._attractor_mask(p['attractor_mode'], u, v,
                    p['attractor_x'], p['attractor_y'],
                    p['attractor_radius'], p['attractor_falloff'])
                intensity = (1.0 - p['intensity_strength']) + p['intensity_strength'] * mask
                if p['base_mode'] == 'wave':
                    base = self.wave.noise(x * 0.1, y * 0.1) * 0.5
                    cw = pow(mask, transition_exponent)
                    h = base * (1.0 - cw) + h * cw * intensity
                else:
                    h = h * intensity
                if h != h or h == float('inf') or h == float('-inf'):  # NaN/Inf guard
                    h = 0.0
                if h < -1.05: h = -1.05
                elif h > 1.05: h = 1.05
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
