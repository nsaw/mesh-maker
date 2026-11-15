"""CPython host for grasshopper/components/voronoi_relief_native.py: stubs the Rhino and
Grasshopper modules (node-in-code Voronoi is unavailable, so Lloyd uses the Halton fallback)
and runs the component as a script. Used by scripts/test-native-membrane.py."""
import json, math, sys, types, time
class Point3d(object):
    def __init__(self, x, y, z=0.0): self.X, self.Y, self.Z = x, y, z
class _Curve(object):
    def ToNurbsCurve(self): return self
rg = types.ModuleType('Rhino.Geometry'); rg.Point3d = Point3d
rg.Rectangle3d = lambda *a: _Curve(); rg.Interval = lambda a, b: (a, b)
rg.Plane = types.SimpleNamespace(WorldXY=None)
rg.AreaMassProperties = types.SimpleNamespace(Compute=lambda c: None)
rhino = types.ModuleType('Rhino'); rhino.Geometry = rg
gh = types.ModuleType('ghpythonlib'); comps = types.ModuleType('ghpythonlib.components')
def _vor(**kw): raise RuntimeError('no node-in-code in CPython')
comps.Voronoi = _vor; gh.components = comps
class DataTree(object):
    def __class_getitem__(cls, item): return cls
    def __init__(self): self.items = []
    def AddRange(self, values, path): self.items.extend(values)
class _GenericList(object):
    def __class_getitem__(cls, item): return lambda values: list(values)
grass = types.ModuleType('Grasshopper'); grass.DataTree = DataTree
kern = types.ModuleType('Grasshopper.Kernel'); data = types.ModuleType('Grasshopper.Kernel.Data'); data.GH_Path = lambda i: i
system = types.ModuleType('System'); coll = types.ModuleType('System.Collections'); gen = types.ModuleType('System.Collections.Generic'); gen.List = _GenericList
for name, mod in {'Rhino': rhino, 'Rhino.Geometry': rg, 'ghpythonlib': gh, 'ghpythonlib.components': comps, 'Grasshopper': grass,
                  'Grasshopper.Kernel': kern, 'Grasshopper.Kernel.Data': data, 'System': system, 'System.Collections': coll,
                  'System.Collections.Generic': gen}.items():
    sys.modules[name] = mod
def run(source, **inputs):
    names = ['mesh_x', 'mesh_y', 'resolution', 'cell_size', 'jitter', 'relax_iter', 'attractor_pt', 'attractor_radius',
             'density_strength', 'seed', 'profile', 'polarity', 'seam_sharpness', 'seam_depth', 'base_amp', 'base_freq',
             'wall_width', 'density_noise', 'density_noise_freq', 'pillow', 'pillow_coverage', 'depth_variation',
             'junction_lift', 'crest_variation']
    scope = {n: None for n in names}; scope.update(inputs); scope['xrange'] = range; scope['__name__'] = '__native__'
    import random; random.seed(0)
    t = time.time(); exec(compile(source, 'voronoi_relief_native.py', 'exec'), scope); scope['_seconds'] = time.time() - t
    z = scope['z_values'].items
    raw = [v / scope['inv_span'] + scope['z_min'] for v in z] if 'inv_span' in scope else z
    return scope, raw
