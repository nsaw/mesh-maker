#!/usr/bin/env python3
"""The native relief component's compiled height pass is wired safely.

voronoi_relief_native.py hands its height pass to MeshCraftRelief in MeshCraftNoise.dll only
when the DLL's Version equals RELIEF_DLL_VERSION. This checks, in CPython with stubbed CLR
modules, that the component falls back to its Python pass without a CLR, with a DLL lacking
MeshCraftRelief, and with a stale DLL; that a current DLL receives the relaxed sites and the
clamped inputs and its heights become the output unchanged; and that the C# source carries
the same version string. Bit parity of the C# itself needs Rhino 7: scripts/rhino-native-relief-dll-parity.py."""
from pathlib import Path
import hashlib
import re
import sys
import types

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
import native_relief_host as host  # noqa: E402

SOURCE = (ROOT / 'grasshopper/components/voronoi_relief_native.py').read_text()
CSHARP = (ROOT / 'grasshopper/components/MeshCraftRelief.cs').read_text()
INPUTS = dict(resolution=33, mesh_x=24.0, mesh_y=18.0, pillow=1.0, pillow_coverage=1.0, cell_size=3.0,
              seam_depth=0.4, relax_iter=1, seed=7, wall_width=0.3, profile='Cosine', polarity='domes')

# Every part of the component that MeshCraftRelief.cs ports. The loader block between
# '# Compiled height pass.' and '# v18 per-cell' is excluded: it holds the version itself.
HEIGHT_PASS = [('class _SiteGrid(object):', 'if mesh_x             is None'), ('def _vn_hash(', 'ax = attractor_pt'),
               ('def _edge_hash01(', 'def local_min_dist('), ('def profile_fn(', '# Compiled height pass.'),
               ('# v18 per-cell INRADIUS proxy', '# Outputs ----')]


def height_pass_hash(source):
    digest = hashlib.sha256()
    for start, end in HEIGHT_PASS:
        assert source.count(start) == 1 and source.count(end) == 1, (start, end)
        i = source.index(start)
        digest.update(source[i:source.index(end, i)].encode('utf-8'))
    return digest.hexdigest()[:12]


python_version = re.search(r"^RELIEF_DLL_VERSION = '([^']+)'$", SOURCE, re.M).group(1)
csharp_version = re.search(r'public const string Version = "([^"]+)";', CSHARP).group(1)
assert python_version == csharp_version, 'version drift: component %r, C# %r' % (python_version, csharp_version)
def csharp_hash(source):
    # The C# port with its own Version line removed, so stamping the version leaves it unchanged.
    lines = [line for line in source.splitlines(True) if 'public const string Version' not in line]
    assert len(lines) == len(source.splitlines(True)) - 1
    return hashlib.sha256(''.join(lines).encode('utf-8')).hexdigest()[:12]


current_hash = height_pass_hash(SOURCE) + '-' + csharp_hash(CSHARP)
assert python_version.endswith('-' + current_hash), (
    'the native height pass or its C# port changed (hashes %s) but the version is %r: port the change '
    'to the other side, rebuild, rerun scripts/rhino-native-relief-dll-parity.py, then put the new '
    'hashes in both version strings' % (current_hash, python_version))


class _Array(object):
    def __getitem__(self, item):
        return lambda values: list(values)


sys.modules['System'].Array = _Array()


def run(clr=None, relief=None):
    for name in ('clr', 'MeshCraftRelief'):
        sys.modules.pop(name, None)
    if clr is not None:
        sys.modules['clr'] = clr
    if relief is not None:
        sys.modules['MeshCraftRelief'] = relief
    try:
        scope, _ = host.run(SOURCE, **INPUTS)
    finally:
        for name in ('clr', 'MeshCraftRelief'):
            sys.modules.pop(name, None)
    return scope


def fake_clr():
    module = types.ModuleType('clr')
    module.AddReference = lambda name: None
    return module


reference = run()
assert reference['height_pass'] == 'Python (no CLR)', reference['height_pass']
expected = list(reference['z_values'].items)
assert any(v > 0.0 for v in reference['cush_a']), 'the reference layout must exercise the membrane'

missing = run(clr=fake_clr())
assert missing['height_pass'] == 'Python (DLL has no MeshCraftRelief)', missing['height_pass']
assert list(missing['z_values'].items) == expected

stale_module = types.ModuleType('MeshCraftRelief')
stale_module.Version = 'v23-output-grid-membrane'
stale_module.VoronoiReliefHeights = lambda *args: (_ for _ in ()).throw(AssertionError('stale DLL must not be called'))
stale = run(clr=fake_clr(), relief=stale_module)
assert stale['height_pass'] == 'Python (DLL height pass is stale)', stale['height_pass']
assert list(stale['z_values'].items) == expected

calls = []
current_module = types.ModuleType('MeshCraftRelief')
current_module.Version = python_version
sentinel = [((k * 37) % 101) / 100.0 for k in range(len(expected))]
def heights(*args):
    calls.append(args)
    return list(sentinel)
current_module.VoronoiReliefHeights = heights
current = run(clr=fake_clr(), relief=current_module)
assert current['height_pass'] == 'DLL', current['height_pass']
assert len(calls) == 1, 'the DLL must be called exactly once (%d)' % len(calls)
assert list(current['z_values'].items) == sentinel, 'the DLL heights must be the output unchanged'
assert not any(v > 0.0 for v in current['cush_a']), 'the Python pixel pass must not run beside the DLL'
args = calls[0]
s = reference
assert args[0] == [p.X for p in s['sites']] and args[1] == [p.Y for p in s['sites']], 'sites must be the relaxed sites'
assert args[2:] == (s['mesh_x'], s['mesh_y'], s['g_cols'], s['g_rows'], s['cell_size'], s['seed'], 'cosine', 'domes',
                    s['seam_sharpness'], s['seam_depth'], s['base_amp'], s['base_freq'], s['wall_width'], s['pillow'],
                    s['pillow_coverage'], s['depth_variation'], s['junction_lift'], s['crest_variation']), args[2:]
assert (current['cols'], current['rows']) == (s['g_cols'], s['g_rows'])

huge = dict(INPUTS)
INPUTS['seed'] = 2 ** 62
outside = run(clr=fake_clr(), relief=current_module)
INPUTS.update(huge)
assert outside['height_pass'] == 'Python (inputs outside the DLL range)', outside['height_pass']
assert len(calls) == 1
assert all(r == s['cell_size'] * 0.5 for r in current['inradius']), 'the Python inradius pass must not run beside the DLL'

failing_module = types.ModuleType('MeshCraftRelief')
failing_module.Version = python_version
failing_module.VoronoiReliefHeights = lambda *args: (_ for _ in ()).throw(ArithmeticError('overflow'))
failing = run(clr=fake_clr(), relief=failing_module)
assert failing['height_pass'] == 'Python (DLL call failed: ArithmeticError)', failing['height_pass']
assert list(failing['z_values'].items) == expected
short_module = types.ModuleType('MeshCraftRelief')
short_module.Version = python_version
short_module.VoronoiReliefHeights = lambda *args: sentinel[:-1]
short = run(clr=fake_clr(), relief=short_module)
assert short['height_pass'] == 'Python (DLL returned %d heights)' % (len(sentinel) - 1), short['height_pass']
assert list(short['z_values'].items) == expected

# Review of #85: large cells carve deeper than the stock face (v > 1), where pow(1 - v, 1.5)
# raised in Python and gave NaN in C#. The crest term now clamps at the face.
INPUTS.update(cell_size=8.0, seam_depth=1.0, crest_variation=0.5, seed=2, resolution=64, mesh_x=24.0, mesh_y=36.0,
              profile='cosine', polarity='pockets', pillow=0.0, wall_width=0.0)
deep = run()
values = list(deep['z_values'].items)
assert all(v == v for v in values) and min(values) == 0.0 and max(values) == 1.0, 'deep cells must give finite heights'
print('Native relief DLL wiring passed: fallback without CLR, without MeshCraftRelief and on a stale '
      'version; a current DLL receives the clamped inputs and its heights are the output.')
