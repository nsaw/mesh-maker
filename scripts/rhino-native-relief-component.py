#! python 2
"""Rhino 7 end-to-end test of MeshCraft | Voronoi Relief (native) as a real GhPython component.

Builds the component in a fresh GH_Document with the current source and the wiring guide's 24
inputs, solves it, and reads the component's own Message, outputs and timing. Every layout must
show Message 'DLL' with no runtime errors, and its z_values must equal, bit for bit, the same
source run with the CLR hidden (the pure Python height pass). Unlike
scripts/rhino-native-relief-dll-parity.py, nothing is loaded by path here: the component resolves
MeshCraftNoise.dll by name, so this checks the installed copy Grasshopper actually uses. Run it
with Rhino closed, after deploying a rebuilt DLL:

  ~/.claude/skills/rhino-grasshopper-ghpython/scripts/rhino-run.sh \\
    scripts/rhino-native-relief-component.py /tmp/component.json 500

Saves nothing."""
import json, os, re, sys, time, hashlib, traceback
import clr, System, Rhino
import ghpythonlib.components  # needs clr; imported before any pass hides it
import Grasshopper
from Grasshopper.Kernel import GH_Document, GH_ParameterSide, GH_ParamAccess, GH_RuntimeMessageLevel, GH_SolutionMode
from Grasshopper.Kernel.Types import GH_Number, GH_Integer, GH_String
from GhPython.Component import ZuiPythonComponent
OUT = os.environ.get('RHINO_PROBE_OUT', '/tmp/meshcraft-relief-component.json')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__ if '__file__' in globals() else sys.argv[0])))
SRC = os.path.join(ROOT, 'grasshopper', 'components', 'voronoi_relief_native.py')
CODE = open(SRC).read()
NAMES = ['mesh_x', 'mesh_y', 'resolution', 'cell_size', 'jitter', 'relax_iter', 'attractor_pt', 'attractor_radius',
         'density_strength', 'seed', 'profile', 'polarity', 'seam_sharpness', 'seam_depth', 'base_amp', 'base_freq',
         'wall_width', 'density_noise', 'density_noise_freq', 'pillow', 'pillow_coverage', 'depth_variation',
         'junction_lift', 'crest_variation']
OUTS = ['z_values', 'cols', 'rows', 'mesh_x', 'mesh_y', 'sites', 'cells']
INTS = ('resolution', 'relax_iter', 'seed')
LAYOUTS = [
    ('defaults 24x36', dict(mesh_x=24.0, mesh_y=36.0)),
    ('pillow pockets 24x24 res 97', dict(mesh_x=24.0, mesh_y=24.0, resolution=97, pillow=1.0, pillow_coverage=1.0,
                                         cell_size=3.0, seam_depth=0.4, relax_iter=1, seed=7)),
    ('rich domes 24x24 res 97', dict(mesh_x=24.0, mesh_y=24.0, resolution=97, pillow=1.0, pillow_coverage=1.0,
                                     cell_size=3.0, seam_depth=0.4, relax_iter=1, seed=7, wall_width=0.4,
                                     depth_variation=0.6, junction_lift=0.5, crest_variation=0.5, profile='cosine',
                                     seam_sharpness=0.5, base_amp=0.3, polarity='domes')),
    ('rich pockets res 256', dict(mesh_x=24.0, mesh_y=24.0, resolution=256, pillow=1.0, pillow_coverage=1.0,
                                  cell_size=3.0, seam_depth=0.4, relax_iter=1, seed=7, wall_width=0.4,
                                  depth_variation=0.6, junction_lift=0.5, crest_variation=0.5, profile='cosine',
                                  seam_sharpness=0.5, base_amp=0.3)),
]
r = {'layouts': [], 'passed': False}

def goo(name, v):
    if isinstance(v, str):
        return GH_String(v)
    if name in INTS:
        return GH_Integer(int(v))
    return GH_Number(float(v))

def build(doc, inputs):
    c = ZuiPythonComponent()
    c.NickName = c.Name = 'MeshCraft | Voronoi Relief (native)'
    c.CreateAttributes()
    while c.Params.Input.Count:
        c.Params.UnregisterInputParameter(c.Params.Input[0])
    while c.Params.Output.Count > 1:  # keep 'out'
        c.Params.UnregisterOutputParameter(c.Params.Output[c.Params.Output.Count - 1])
    for name in NAMES:
        p = c.CreateParameter(GH_ParameterSide.Input, c.Params.Input.Count)
        p.NickName = p.Name = name
        p.Optional = True
        p.Access = GH_ParamAccess.item
        if name in inputs:
            p.PersistentData.Append(goo(name, inputs[name]))
        c.Params.RegisterInputParam(p)
    for name in OUTS:
        p = c.CreateParameter(GH_ParameterSide.Output, c.Params.Output.Count)
        p.NickName = p.Name = name
        c.Params.RegisterOutputParam(p)
    c.Params.OnParametersChanged()
    c.Code = CODE
    doc.AddObject(c, False)
    return c

def out_values(c, name):
    for p in c.Params.Output:
        if p.NickName == name:
            return [g.Value if hasattr(g, 'Value') else g for g in p.VolatileData.AllData(True)]
    return None

def python_pass(inputs):
    scope = dict((n, None) for n in NAMES)
    scope.update(inputs)
    saved = sys.modules.get('clr')
    sys.modules['clr'] = None
    try:
        t = time.time()
        exec compile(CODE, SRC, 'exec') in scope
        return scope, time.time() - t
    finally:
        sys.modules['clr'] = saved

try:
    bits = System.BitConverter.DoubleToInt64Bits
    passed = True
    for label, inputs in LAYOUTS:
      doc = GH_Document()
      Grasshopper.Instances.DocumentServer.AddDocument(doc)
      try:
        comp = build(doc, inputs)
        doc.Enabled = True
        t = time.time()
        doc.NewSolution(True, GH_SolutionMode.Silent)
        gh_s = time.time() - t
        z = [float(v) for v in out_values(comp, 'z_values')]
        errors = list(comp.RuntimeMessages(GH_RuntimeMessageLevel.Error))
        warnings = list(comp.RuntimeMessages(GH_RuntimeMessageLevel.Warning))
        py, py_s = python_pass(inputs)
        ref = list(py['z_values'].AllData())
        same = len(z) == len(ref) and len(z) > 0 and all(bits(a) == bits(b) for a, b in zip(z, ref))
        cols = out_values(comp, 'cols'); rows = out_values(comp, 'rows')
        ok = same and comp.Message == 'DLL' and not errors and py['height_pass'] == 'Python (no CLR)'
        passed = passed and ok
        r['layouts'].append({'label': label, 'message': comp.Message, 'errors': errors[:3], 'warnings': warnings[:3],
                             'nodes': len(z), 'cols': cols, 'rows': rows,
                             'sites': len(out_values(comp, 'sites') or []), 'cells': len(out_values(comp, 'cells') or []),
                             'z_min': min(z) if z else None, 'z_max': max(z) if z else None,
                             'bit_identical_to_python_pass': same,
                             'worst': max(abs(a - b) for a, b in zip(z, ref)) if len(z) == len(ref) and z else None,
                             'gh_solve_s': gh_s, 'python_pass_s': py_s, 'python_path': py['height_pass'], 'ok': ok})
      finally:
        doc.Enabled = False
        Grasshopper.Instances.DocumentServer.RemoveDocument(doc)
        doc.Dispose()
    # The components bound MeshCraftNoise by name. Exactly one such assembly may be loaded in this
    # process, or the copy named below is not provably the one they used.
    loaded = [a for a in System.AppDomain.CurrentDomain.GetAssemblies() if a.GetName().Name == 'MeshCraftNoise']
    r['loaded_assemblies'] = [a.Location for a in loaded]
    if len(loaded) != 1:
        raise RuntimeError('expected one MeshCraftNoise assembly, found %d' % len(loaded))
    loc = loaded[0].Location
    relief = loaded[0].GetType('MeshCraftRelief')
    version = relief.GetField('Version').GetValue(None) if relief is not None else None
    # The same whole-line pattern scripts/test-native-relief-dll.py uses, so both tests read one form.
    found = re.search(r"^RELIEF_DLL_VERSION = '([^']+)'$", CODE, re.M)
    if found is None:
        raise RuntimeError('RELIEF_DLL_VERSION not found in ' + SRC)
    expected = found.group(1)
    r['loaded_dll'] = loc
    r['loaded_md5'] = hashlib.md5(open(loc, 'rb').read()).hexdigest()
    r['loaded_version'] = version
    reasons = ['layout %r failed' % l['label'] for l in r['layouts'] if not l['ok']]
    if version != expected:
        reasons.append('loaded MeshCraftRelief.Version %r differs from RELIEF_DLL_VERSION %r' % (version, expected))
    if reasons:
        r['error'] = '; '.join(reasons)
    passed = passed and version == expected
    r['rhino'] = str(Rhino.RhinoApp.Version)
    r['passed'] = passed
except Exception:
    r['error'] = traceback.format_exc()
f = open(OUT, 'w'); f.write(json.dumps(r, indent=1) + '\n'); f.close()
Rhino.RhinoApp.RunScript("_-Exit _No", False)
