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
}

cfg = {'angle': gabor_angle, 'bw': gabor_bw}
gen = _NOISE_MAP.get(str(noise_type), _NOISE_MAP['simplex'])(seed, cfg)
has_fbm = hasattr(gen, 'fbm')

# ── Grid generation ───────────────────────────────────────────────────────────
cols = resolution
rows = max(4, int(round(resolution * (mesh_y / mesh_x))))

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
