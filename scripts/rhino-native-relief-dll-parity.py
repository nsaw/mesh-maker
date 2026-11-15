#! python 2
"""Rhino 7 bit-parity gate for MeshCraftRelief (grasshopper/components/MeshCraftRelief.cs).

Runs grasshopper/components/voronoi_relief_native.py twice per layout inside Rhino 7 with real
node-in-code Voronoi: once with the CLR import hidden (the Python height pass) and once as
installed (the DLL), and requires identical heights at every node. Run it after rebuilding the
DLL and before deploying it:

  MESHCRAFT_DLL=/path/to/MeshCraftNoise.dll \\
    ~/.claude/skills/rhino-grasshopper-ghpython/scripts/rhino-run.sh \\
    scripts/rhino-native-relief-dll-parity.py /tmp/parity.json 900

MESHCRAFT_DLL defaults to the library copy beside MeshCraftNoise.cs. The result JSON lists each
layout's node count, identity, worst difference and both timings, and 'passed'."""
import json, os, sys, time, traceback, clr
import Rhino
import ghpythonlib.components  # imported now: it needs clr, which run() hides for the Python pass
OUT = os.environ.get('RHINO_PROBE_OUT', '/tmp/meshcraft-relief-dll-parity.json')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__ if '__file__' in globals() else sys.argv[0])))
COMPONENT = os.path.join(ROOT, 'grasshopper', 'components', 'voronoi_relief_native.py')
DLL = os.environ.get('MESHCRAFT_DLL', '/Users/sawyer/Code/sawyer-design/rhino-aspire-grasshopper/rhino/grasshopper/ghpy/MeshCraftNoise.dll')
NAMES = ['mesh_x', 'mesh_y', 'resolution', 'cell_size', 'jitter', 'relax_iter', 'attractor_pt', 'attractor_radius',
         'density_strength', 'seed', 'profile', 'polarity', 'seam_sharpness', 'seam_depth', 'base_amp', 'base_freq',
         'wall_width', 'density_noise', 'density_noise_freq', 'pillow', 'pillow_coverage', 'depth_variation',
         'junction_lift', 'crest_variation']
BASE = dict(pillow=1.0, pillow_coverage=1.0, cell_size=3.0, seam_depth=0.4, relax_iter=1, seed=7, mesh_x=24.0, mesh_y=24.0)
RICH = dict(BASE, wall_width=0.4, depth_variation=0.6, junction_lift=0.5, crest_variation=0.5, profile='cosine',
            seam_sharpness=0.5, base_amp=0.3)
LAYOUTS = [
    ('pillow pockets 97', dict(BASE, resolution=97)),
    ('rich domes 97', dict(RICH, polarity='domes', resolution=97)),
    ('rich cone 24x36 seed 139, 81', dict(RICH, profile='cone', mesh_y=36.0, resolution=81, seed=139)),
    ('pillow off spherical-cap 65', dict(BASE, pillow=0.0, profile='spherical-cap', resolution=65)),
    ('rich pockets 256', dict(RICH, resolution=256)),
    ('defaults 128', dict(mesh_x=24.0, mesh_y=36.0)),
    ('deep cells (v > 1) 64', dict(cell_size=8.0, seam_depth=1.0, crest_variation=0.5, seed=2, resolution=64,
                                   mesh_x=24.0, mesh_y=36.0, profile='cosine')),
]
result = {'dll': DLL, 'layouts': [], 'passed': False}
try:
    clr.AddReferenceToFileAndPath(DLL)
    code = compile(open(COMPONENT).read(), COMPONENT, 'exec')
    def run(extra, hide_clr):
        scope = dict((n, None) for n in NAMES)
        scope.update(extra)
        saved = sys.modules.get('clr')
        if hide_clr:
            sys.modules['clr'] = None
        try:
            start = time.time()
            exec code in scope
            return scope, time.time() - start
        finally:
            sys.modules['clr'] = saved
    passed = True
    for label, extra in LAYOUTS:
        python, python_s = run(extra, True)
        dll, dll_s = run(extra, False)
        a = list(python['z_values'].AllData())
        b = list(dll['z_values'].AllData())
        worst = max(abs(x - y) for x, y in zip(a, b)) if len(a) == len(b) else None
        same = a == b and python['height_pass'] == 'Python (no CLR)' and dll['height_pass'] == 'DLL'
        passed = passed and same
        result['layouts'].append({'label': label, 'nodes': len(a), 'identical': same, 'worst': worst,
                                  'paths': [python['height_pass'], dll['height_pass']],
                                  'python_s': python_s, 'dll_s': dll_s})
    result['nodes'] = sum(r['nodes'] for r in result['layouts'])
    result['passed'] = passed
    result['rhino'] = str(Rhino.RhinoApp.Version)
except Exception:
    result['error'] = traceback.format_exc()
handle = open(OUT, 'w')
handle.write(json.dumps(result, indent=1))
handle.close()
Rhino.RhinoApp.RunScript('_-Exit _No', False)
