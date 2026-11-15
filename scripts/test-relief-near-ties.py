#!/usr/bin/env python3
"""Independent Decimal metric oracle plus actual Python/native ordering consumers."""
import ast
from decimal import Decimal as D, localcontext
import json
import math
from pathlib import Path
import sys
import textwrap

root = Path(__file__).resolve().parent.parent
source = (root / 'grasshopper/components/noise_gen.py').read_text()
module = ast.parse(source)
module.body = [node for node in module.body if isinstance(node, (ast.ClassDef, ast.FunctionDef))]
scope = {'math': math, 'xrange': range}
exec(compile(module, '<canonical definitions>', 'exec'), scope)
Grid = scope['_SiteGrid']
noise = scope['VoronoiReliefNoise'](7)
native = (root / 'grasshopper/components/voronoi_relief_native.py').read_text()
start = native.index('\n    best1 =', native.index('def _relief_node(px, py):')) + 1
end = native.index('\n    # v18 BOUNDARY-DISTANCE CONSTRUCTION.', start) + 1
native_loop = compile(textwrap.dedent(native[start:end]), '<native nearest loop>', 'exec')
junction_start = native.index('\n    # Scale-free junction proximity:') + 1
junction_end = native.index('\n    jn_s =', junction_start) + 1
junction_consumer = compile(textwrap.dedent(native[junction_start:junction_end]), '<native junction consumer>', 'exec')
results = []
for case in json.load(sys.stdin):
    sites = [[p['x'], p['y'], 0.0] for p in case['sites']]
    x, y = case['q']
    c, s, scale = case['c'], case['s'], case['scale']
    with localcontext() as context:
        context.prec = 400
        def distance(p):
            dx, dy = D(p[0]) - D(x), D(p[1]) - D(y)
            if scale > 1.0001:
                dx, dy = (dx * D(c) + dy * D(s)) * D(scale), -dx * D(s) + dy * D(c)
            return dx * dx + dy * dy
        ranked = sorted(range(len(sites)), key=lambda i: (distance(sites[i]), i))
        def isotropic(p):
            dx, dy = D(p[0]) - D(x), D(p[1]) - D(y)
            return dx * dx + dy * dy
        identity_rank = sorted(range(len(sites)), key=lambda i: (isotropic(sites[i]), i))
    expected_rank = ranked[:4] + [-1] * max(0, 4 - len(sites))
    expected_identity = identity_rank[:4] + [-1] * max(0, 4 - len(sites))
    if not sites:
        expected_rank[0] = 0
        expected_identity[0] = 0
    actual = noise._nearest_three(sites, x, y, c, s, scale)
    assert list(actual[4:]) == expected_rank, ('canonical', case, actual[4:], ranked)
    owner = Grid.from_sites(sites).nearest(x, y)
    assert owner == expected_identity[0], ('indexed owner', case, owner, identity_rank)
    environment = dict(scope, sx=[p[0] for p in sites], sy=[p[1] for p in sites],
                       site_positions=sites, site_coordinate_scale=max([1.0] + [abs(v) for p in sites for v in p[:2]]),
                       px=x, py=y, n_sites=len(sites))
    exec(native_loop, environment)
    native_rank = [environment[name] for name in ['owner', 'owner2', 'owner3', 'owner4']]
    assert native_rank == expected_identity, ('native consuming loop', case, native_rank, expected_identity)
    for slot, index in enumerate(native_rank):
        value = environment['best%d' % (slot + 1)]
        if slot >= len(sites):
            assert math.isinf(value), ('unfilled slot must remain infinite', case, slot, value)
        else:
            assert math.isfinite(value), ('finite supported site must not become absent', case, slot, value)
            dx, dy = sites[index][0] - x, sites[index][1] - y
            assert value == dx * dx + dy * dy, ('radius must belong to selected owner', case, slot)
    assert environment['d1'] == math.sqrt(environment['best1'])
    expected_d3 = math.sqrt(environment['best3'])
    assert environment['d3'] == expected_d3, ('third radius consumption', case, environment['d3'], expected_d3)
    exec(junction_consumer, environment)
    expected_junction = 0.0 if len(sites) < 3 else 1.0 - min(1.0, (environment['d3'] - environment['d1']) / max(1e-9, environment['d3'] + environment['d1']))
    assert environment['jn'] == expected_junction, ('absent third has no junction', case, environment['jn'])
    results.append({'rank': expected_rank, 'isotropic': expected_identity})
json.dump(results, sys.stdout)
