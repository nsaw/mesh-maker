# GHPython component script — MeshCraft | Presets
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
