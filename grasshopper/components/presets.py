#! python 2
# GHPython component script — MeshCraft | Presets
# Runtime: IronPython 2.7 (Rhino 7)
#
# Inputs:  preset (str) — name of preset to load
# Outputs: noise_type, frequency, amplitude, noise_exp, peak_exp, valley_exp,
#          valley_floor, offset, octaves, persistence, lacunarity, distortion,
#          contrast, sharpness, mesh_x, mesh_y, smooth_iter, smooth_str,
#          gabor_angle, gabor_bw
#
# Usage: wire any output to the matching input on Noise/Shape/Smooth components
#        to override the slider value for that parameter.

PRESETS = {
    'gentle-waves': {'noise_type':'simplex', 'frequency':0.06, 'amplitude':0.5, 'noise_exp':0.5, 'peak_exp':1, 'valley_exp':1, 'valley_floor':0, 'offset':0, 'octaves':2, 'persistence':0.3, 'lacunarity':2, 'distortion':0, 'contrast':1, 'sharpness':0, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':3, 'smooth_str':0.5},
    'organic-terrain': {'noise_type':'fbm', 'frequency':0.1, 'amplitude':0.8, 'noise_exp':0.7, 'peak_exp':1, 'valley_exp':1, 'valley_floor':0, 'offset':0, 'octaves':4, 'persistence':0.55, 'lacunarity':2, 'distortion':0.3, 'contrast':1.2, 'sharpness':0.2, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':1, 'smooth_str':0.4},
    'sharp-ridges': {'noise_type':'ridged', 'frequency':0.08, 'amplitude':0.5, 'noise_exp':1.5, 'peak_exp':1, 'valley_exp':1, 'valley_floor':0, 'offset':0, 'octaves':3, 'persistence':0.5, 'lacunarity':2.2, 'distortion':0, 'contrast':1.5, 'sharpness':0.8, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':0, 'smooth_str':0},
    'voronoi-cells': {'noise_type':'voronoi', 'frequency':0.15, 'amplitude':0.3, 'noise_exp':0.8, 'peak_exp':1, 'valley_exp':1, 'valley_floor':0, 'offset':0, 'octaves':1, 'persistence':0.5, 'lacunarity':2, 'distortion':0, 'contrast':1, 'sharpness':0, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':2, 'smooth_str':0.6},
    'subtle-texture': {'noise_type':'perlin', 'frequency':0.12, 'amplitude':0.25, 'noise_exp':0.5, 'peak_exp':1, 'valley_exp':1, 'valley_floor':0, 'offset':0, 'octaves':3, 'persistence':0.4, 'lacunarity':2.5, 'distortion':0.1, 'contrast':0.8, 'sharpness':0, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':2, 'smooth_str':0.7},
    'deep-carve': {'noise_type':'fbm', 'frequency':0.05, 'amplitude':2, 'noise_exp':1.2, 'peak_exp':1, 'valley_exp':1, 'valley_floor':0, 'offset':0, 'octaves':5, 'persistence':0.6, 'lacunarity':1.8, 'distortion':0.4, 'contrast':1.8, 'sharpness':0.5, 'mesh_x':24, 'mesh_y':18, 'smooth_iter':0, 'smooth_str':0},
    'sculptural': {'noise_type':'fbm', 'frequency':0.04, 'amplitude':1.5, 'noise_exp':0.7, 'peak_exp':1.8, 'valley_exp':0.35, 'valley_floor':0.6, 'offset':0, 'octaves':3, 'persistence':0.55, 'lacunarity':1.8, 'distortion':0.4, 'contrast':1.3, 'sharpness':0.15, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':2, 'smooth_str':0.45},
    'hard-wave': {'noise_type':'simplex', 'frequency':0.05, 'amplitude':1.2, 'noise_exp':0.6, 'peak_exp':2, 'valley_exp':0.3, 'valley_floor':0.75, 'offset':0, 'octaves':2, 'persistence':0.4, 'lacunarity':2, 'distortion':0.25, 'contrast':1.4, 'sharpness':0.1, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':3, 'smooth_str':0.5},
    'eroded-stone': {'noise_type':'ridged', 'frequency':0.06, 'amplitude':0.5, 'noise_exp':0.8, 'peak_exp':1.5, 'valley_exp':0.4, 'valley_floor':0.5, 'offset':0, 'octaves':4, 'persistence':0.5, 'lacunarity':2.2, 'distortion':0.35, 'contrast':1.6, 'sharpness':0.3, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':1, 'smooth_str':0.3},
    'billowy-clouds': {'noise_type':'billow', 'frequency':0.07, 'amplitude':0.8, 'noise_exp':0.5, 'peak_exp':1, 'valley_exp':1, 'valley_floor':0, 'offset':0, 'octaves':3, 'persistence':0.45, 'lacunarity':2, 'distortion':0.15, 'contrast':1, 'sharpness':0, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':2, 'smooth_str':0.5},
    'turbulent-marble': {'noise_type':'turbulence', 'frequency':0.08, 'amplitude':1, 'noise_exp':0.7, 'peak_exp':1, 'valley_exp':1, 'valley_floor':0, 'offset':0, 'octaves':5, 'persistence':0.55, 'lacunarity':2.2, 'distortion':0.3, 'contrast':1.4, 'sharpness':0.3, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':1, 'smooth_str':0.3},
    'natural-ridge': {'noise_type':'hybrid', 'frequency':0.06, 'amplitude':1.2, 'noise_exp':0.6, 'peak_exp':1.2, 'valley_exp':0.5, 'valley_floor':0.3, 'offset':0, 'octaves':4, 'persistence':0.5, 'lacunarity':2, 'distortion':0.2, 'contrast':1.2, 'sharpness':0.1, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':1, 'smooth_str':0.4},
    'organic-swirl': {'noise_type':'domainwarp', 'frequency':0.05, 'amplitude':1, 'noise_exp':0.5, 'peak_exp':1, 'valley_exp':1, 'valley_floor':0, 'offset':0, 'octaves':3, 'persistence':0.5, 'lacunarity':1.8, 'distortion':0, 'contrast':1.1, 'sharpness':0, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':2, 'smooth_str':0.5},
    'worley-cracks': {'noise_type':'worley', 'frequency':0.12, 'amplitude':0.5, 'noise_exp':0.8, 'peak_exp':1, 'valley_exp':1, 'valley_floor':0, 'offset':0, 'octaves':1, 'persistence':0.5, 'lacunarity':2, 'distortion':0.1, 'contrast':1.2, 'sharpness':0.3, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':1, 'smooth_str':0.4},
    'brushed-metal': {'noise_type':'gabor', 'frequency':0.1, 'amplitude':0.3, 'noise_exp':0.5, 'peak_exp':1, 'valley_exp':1, 'valley_floor':0, 'offset':0, 'octaves':1, 'persistence':0.5, 'lacunarity':2, 'distortion':0, 'contrast':1, 'sharpness':0, 'gabor_angle':15, 'gabor_bw':1.2, 'mesh_x':36, 'mesh_y':24, 'smooth_iter':1, 'smooth_str':0.3},
    'relief-vertical': {'noise_type':'voronoi-relief', 'frequency':0.2, 'amplitude':0.75, 'noise_exp':1, 'peak_exp':1, 'valley_exp':1, 'valley_floor':0, 'offset':0, 'octaves':1, 'persistence':0.5, 'lacunarity':2, 'distortion':0.55, 'contrast':1, 'sharpness':0, 'relief_warp_freq':0.16, 'warp_curl':0, 'relief_cell_size':0.8, 'relief_jitter':0.95, 'relief_relax_iter':1, 'relief_polarity':'domes', 'relief_profile':'parabolic', 'relief_seam_depth':0.95, 'relief_seam_width':0.14, 'relief_wall_width':0.08, 'relief_anisotropy':0, 'relief_anisotropy_angle':0, 'relief_attractor_mode':'vertical', 'relief_attractor_x':0.5, 'relief_attractor_y':0, 'relief_attractor_radius':0.5, 'relief_attractor_falloff':2.2, 'relief_density_strength':1.8, 'relief_intensity_strength':1, 'relief_transition_softness':0.45, 'relief_base_mode':'wave', 'relief_base_amp':0.5, 'relief_base_freq':0.2, 'relief_cell_size_gradient':1, 'relief_void_strength':0.7, 'relief_invert_profile':0, 'relief_seam_sharpness':0, 'relief_pillow':0, 'relief_pillow_coverage':0.6, 'relief_attractor_noise':0, 'relief_attractor_noise_freq':0.3, 'relief_density_noise':0.3, 'relief_density_noise_freq':0.16, 'relief_radial_foci_count':0, 'relief_radial_focus1_x':0.5, 'relief_radial_focus1_y':0.25, 'relief_radial_focus2_x':0.25, 'relief_radial_focus2_y':0.6, 'relief_radial_focus3_x':0.75, 'relief_radial_focus3_y':0.8, 'relief_radial_strength':1.5, 'relief_radial_falloff':0.3, 'relief_radial_grow':0.45, 'relief_radial_warp':0.4, 'relief_radial_mode':'rays', 'mesh_x':12, 'mesh_y':24, 'smooth_iter':3, 'smooth_str':0.55},
    'relief-radial': {'noise_type':'voronoi-relief', 'frequency':0.15, 'amplitude':1.333333333333333, 'noise_exp':1, 'peak_exp':1, 'valley_exp':1, 'valley_floor':0, 'offset':0, 'octaves':1, 'persistence':0.5, 'lacunarity':2, 'distortion':0.4, 'contrast':1, 'sharpness':0, 'relief_warp_freq':0.105, 'warp_curl':0, 'relief_cell_size':1.733333333333333, 'relief_jitter':0.8, 'relief_relax_iter':1, 'relief_polarity':'pockets', 'relief_profile':'cosine', 'relief_seam_depth':0.7, 'relief_seam_width':0.14, 'relief_wall_width':0.12, 'relief_anisotropy':0.25, 'relief_anisotropy_angle':35, 'relief_attractor_mode':'radial', 'relief_attractor_x':0.62, 'relief_attractor_y':0.42, 'relief_attractor_radius':0.55, 'relief_attractor_falloff':0.9, 'relief_density_strength':2, 'relief_intensity_strength':0.55, 'relief_transition_softness':0.15, 'relief_base_mode':'wave', 'relief_base_amp':0.25, 'relief_base_freq':0.09, 'relief_cell_size_gradient':0.8, 'relief_void_strength':0.38, 'relief_invert_profile':0, 'relief_seam_sharpness':0, 'relief_pillow':0.45, 'relief_pillow_coverage':0.75, 'relief_depth_variation':0.2, 'relief_junction_lift':0.25, 'relief_crest_variation':0.15, 'relief_attractor_noise':0.25, 'relief_attractor_noise_freq':0.15, 'relief_density_noise':0.55, 'relief_density_noise_freq':0.09, 'relief_radial_foci_count':0, 'relief_radial_focus1_x':0.5, 'relief_radial_focus1_y':0.25, 'relief_radial_focus2_x':0.25, 'relief_radial_focus2_y':0.6, 'relief_radial_focus3_x':0.75, 'relief_radial_focus3_y':0.8, 'relief_radial_strength':1.5, 'relief_radial_falloff':0.3, 'relief_radial_grow':0.45, 'relief_radial_warp':0.4, 'relief_radial_mode':'rays', 'mesh_x':16, 'mesh_y':24, 'smooth_iter':2, 'smooth_str':0.5},
    'relief-pockets': {'noise_type':'voronoi-relief', 'frequency':0.2, 'amplitude':1.2, 'noise_exp':1, 'peak_exp':1, 'valley_exp':1, 'valley_floor':0, 'offset':0, 'octaves':1, 'persistence':0.5, 'lacunarity':2, 'distortion':0.35, 'contrast':1, 'sharpness':0, 'relief_warp_freq':0.12, 'warp_curl':0, 'relief_cell_size':2, 'relief_jitter':0.85, 'relief_relax_iter':1, 'relief_polarity':'pockets', 'relief_profile':'cosine', 'relief_seam_depth':0.62, 'relief_seam_width':0.15, 'relief_wall_width':0.11, 'relief_anisotropy':0.2, 'relief_anisotropy_angle':75, 'relief_attractor_mode':'vertical', 'relief_attractor_x':0.5, 'relief_attractor_y':0, 'relief_attractor_radius':0.5, 'relief_attractor_falloff':0.35, 'relief_density_strength':1.2, 'relief_intensity_strength':0.9, 'relief_transition_softness':0.35, 'relief_base_mode':'wave', 'relief_base_amp':0.3, 'relief_base_freq':0.14, 'relief_cell_size_gradient':0.8, 'relief_void_strength':0, 'relief_invert_profile':0, 'relief_seam_sharpness':0, 'relief_pillow':0.5, 'relief_pillow_coverage':0.85, 'relief_depth_variation':0.35, 'relief_junction_lift':0.3, 'relief_crest_variation':0.5, 'relief_attractor_noise':0.5, 'relief_attractor_noise_freq':0.2, 'relief_density_noise':1, 'relief_density_noise_freq':0.09, 'relief_radial_foci_count':1, 'relief_radial_focus1_x':0.3, 'relief_radial_focus1_y':0.42, 'relief_radial_focus2_x':0.25, 'relief_radial_focus2_y':0.6, 'relief_radial_focus3_x':0.75, 'relief_radial_focus3_y':0.8, 'relief_radial_strength':2.2, 'relief_radial_falloff':0.32, 'relief_radial_grow':1.6, 'relief_radial_warp':0.5, 'relief_radial_mode':'rays', 'mesh_x':12, 'mesh_y':24, 'smooth_iter':2, 'smooth_str':0.45},
    'relief-starburst': {'noise_type':'voronoi-relief', 'frequency':0.15, 'amplitude':1, 'noise_exp':1, 'peak_exp':1, 'valley_exp':1, 'valley_floor':0, 'offset':0, 'octaves':1, 'persistence':0.5, 'lacunarity':2, 'distortion':0.35, 'contrast':1, 'sharpness':0, 'relief_warp_freq':0.105, 'warp_curl':0, 'relief_cell_size':1.2, 'relief_jitter':0.55, 'relief_relax_iter':1, 'relief_polarity':'pockets', 'relief_profile':'cosine', 'relief_seam_depth':0.5, 'relief_seam_width':0.15, 'relief_wall_width':0.08, 'relief_anisotropy':0, 'relief_anisotropy_angle':0, 'relief_attractor_mode':'none', 'relief_attractor_x':0.5, 'relief_attractor_y':0.5, 'relief_attractor_radius':0.5, 'relief_attractor_falloff':1, 'relief_density_strength':0, 'relief_intensity_strength':1, 'relief_transition_softness':0.5, 'relief_base_mode':'wave', 'relief_base_amp':0.35, 'relief_base_freq':0.09, 'relief_cell_size_gradient':0.4, 'relief_void_strength':0, 'relief_invert_profile':0, 'relief_seam_sharpness':0, 'relief_pillow':0, 'relief_pillow_coverage':0.5, 'relief_depth_variation':0.35, 'relief_junction_lift':0.25, 'relief_crest_variation':0.4, 'relief_attractor_noise':0.2, 'relief_attractor_noise_freq':0.18, 'relief_density_noise':0.2, 'relief_density_noise_freq':0.12, 'relief_radial_foci_count':3, 'relief_radial_focus1_x':0.7, 'relief_radial_focus1_y':0.18, 'relief_radial_focus2_x':0.2, 'relief_radial_focus2_y':0.5, 'relief_radial_focus3_x':0.75, 'relief_radial_focus3_y':0.85, 'relief_radial_strength':1.2, 'relief_radial_falloff':0.3, 'relief_radial_grow':0.3, 'relief_radial_warp':0.65, 'relief_radial_mode':'rays', 'mesh_x':8, 'mesh_y':24, 'smooth_iter':1, 'smooth_str':0.3},
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
gabor_angle  = p.get('gabor_angle', 45.0)
gabor_bw     = p.get('gabor_bw', 1.5)
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
relief_invert_profile      = p.get('relief_invert_profile',      0.0)
relief_seam_sharpness      = p.get('relief_seam_sharpness',      0.0)
relief_base_amp            = p.get('relief_base_amp',            0.0)
relief_base_freq           = p.get('relief_base_freq',           0.1)
relief_wall_width          = p.get('relief_wall_width',          0.0)
relief_density_noise       = p.get('relief_density_noise',       0.0)
relief_density_noise_freq  = p.get('relief_density_noise_freq',  0.08)
relief_pillow              = p.get('relief_pillow',              0.0)
relief_pillow_coverage     = p.get('relief_pillow_coverage',     0.6)
relief_depth_variation     = p.get('relief_depth_variation',     0.0)
relief_junction_lift       = p.get('relief_junction_lift',       0.0)
relief_crest_variation     = p.get('relief_crest_variation',     0.0)
relief_radial_foci_count   = p.get('relief_radial_foci_count',   0)
relief_radial_focus1_x     = p.get('relief_radial_focus1_x',     0.5)
relief_radial_focus1_y     = p.get('relief_radial_focus1_y',     0.25)
relief_radial_focus2_x     = p.get('relief_radial_focus2_x',     0.25)
relief_radial_focus2_y     = p.get('relief_radial_focus2_y',     0.6)
relief_radial_focus3_x     = p.get('relief_radial_focus3_x',     0.75)
relief_radial_focus3_y     = p.get('relief_radial_focus3_y',     0.8)
relief_radial_strength     = p.get('relief_radial_strength',     1.5)
relief_radial_falloff      = p.get('relief_radial_falloff',      0.3)
relief_radial_grow         = p.get('relief_radial_grow',         0.45)
relief_radial_warp         = p.get('relief_radial_warp',         0.4)
relief_radial_mode         = p.get('relief_radial_mode',         'rays')
relief_warp_freq           = p.get('relief_warp_freq',           0.08)
