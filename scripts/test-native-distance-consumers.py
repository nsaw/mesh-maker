#!/usr/bin/env python3
"""Actual native Lloyd assignments and radius consumers against independent exact distances."""
import ast
from fractions import Fraction as F
import math
from pathlib import Path
import textwrap

ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / 'grasshopper/components/voronoi_relief_native.py').read_text()

class Point:
    def __init__(self, x, y, z=0.0):
        self.X, self.Y, self.Z = x, y, z

class Geometry:
    Point3d = Point

module = ast.parse(SOURCE)
module.body = [node for node in module.body if isinstance(node, (ast.ClassDef, ast.FunctionDef))]
scope = {'math': math, 'xrange': range, 'rg': Geometry}
exec(compile(module, '<actual native definitions>', 'exec'), scope)
Grid = scope['_SiteGrid']

def exact_distance(point, x, y):
    return (F(point.X) - F(x)) ** 2 + (F(point.Y) - F(y)) ** 2

assignments = []
class RecordingGrid(Grid):
    def nearest(self, x, y, *args):
        result = super().nearest(x, y, *args)
        assignments.append((x, y, result))
        return result

scope['_SiteGrid'] = RecordingGrid
lloyd_cases = [
    ([(0.0, 0.0), (1.0, 0.0)], 1.0, 1.0),
    ([(1e16, 0.0), (5e15, 0.0)], 1e16, 1.0),
    ([(-1e16, 0.0), (0.0, 1e16), (1e16, 0.0)], 2e16, 1e16),
    ([(1e150, 0.0)], 1e150, 1.0),
    ([(1.0, 0.0), (1.0, 0.0)], 2.0, 1.0),
    ([], 1e16, 1.0),
]
for coordinates, mesh_x, mesh_y in lloyd_cases:
    points = [Point(x, y) for x, y in coordinates]
    assignments[:] = []
    scope.update(mesh_x=mesh_x, mesh_y=mesh_y)
    actual = scope['lloyd_fallback'](points)
    assert len(assignments) == len(points) * 64, ('native Lloyd keeps every sample', coordinates)
    sum_x, sum_y, counts = [0.0] * len(points), [0.0] * len(points), [0] * len(points)
    for x, y, owner in assignments:
        expected_owner = min(range(len(points)), key=lambda i: (exact_distance(points[i], x, y), i))
        assert owner == expected_owner, ('actual native Lloyd assignment', coordinates, (x, y), owner, expected_owner)
        sum_x[expected_owner] += x
        sum_y[expected_owner] += y
        counts[expected_owner] += 1
    for i, point in enumerate(actual):
        expected = (sum_x[i] / counts[i], sum_y[i] / counts[i]) if counts[i] else coordinates[i]
        assert (point.X, point.Y) == expected, ('native Lloyd consumes correct assignments', coordinates, i)
    if not points:
        assert actual is points

# Include the real inradius initializer, scan, absence decision and assignment.
start = SOURCE.index('inradius = [cell_size * 0.5]')
end = SOURCE.index('# v17 size-depth coupling:', start)
radius_code = compile(SOURCE[start:end], '<actual native inradius consumer>', 'exec')
size_start = SOURCE.index('sorted_inr =', end)
size_end = SOURCE.index('wall_noise_freq =', size_start)
size_code = compile(SOURCE[size_start:size_end], '<actual native radius modifiers>', 'exec')
radius_cases = [[], [(2.0, 3.0)], [(0.0, 0.0), (2.0, 0.0), (4.0, 0.0)],
                [(0.0, 0.0), (1e16, 0.0), (3e16, 0.0)],
                [(-1e150, 0.0), (1e150, 0.0)], [(0.0, 0.0), (0.0, 0.0)]]
for coordinates in radius_cases:
    points = [Point(x, y) for x, y in coordinates]
    environment = dict(scope, n_sites=len(points), cell_size=2.0, sx=[p.X for p in points], sy=[p.Y for p in points],
                       depth_variation=0.0, seam_depth=0.5, seed=7)
    exec(radius_code, environment)
    expected = []
    for i, point in enumerate(points):
        others = [exact_distance(other, point.X, point.Y) for j, other in enumerate(points) if j != i]
        expected.append(math.sqrt(float(min(others))) * 0.5 if others else 1.0)
    assert environment['inradius'] == expected, ('native inradius consumer', coordinates, environment['inradius'], expected)
    if points:
        exec(size_code, environment)
        assert all(math.isfinite(value) for value in environment['size_mul_cell'])
        assert environment['median_inr'] == max(0.05, sorted(expected)[len(expected) // 2])

# These are deliberate API/physical contracts, not missing-neighbor sentinels.
assert Grid.from_sites([[1e16, 0.0], [5e15, 0.0]]).nearest(0.0, 0.0, 1.0e30) == 0
pixel_start = SOURCE.index('        db_cap = mesh_x + mesh_y')
pixel_end = SOURCE.index('        # v21 per-edge fields', pixel_start)
plane_code = compile(textwrap.dedent(SOURCE[pixel_start:pixel_end]), '<native physical plane cap>', 'exec')
plane_environment = dict(scope, mesh_x=4.0, mesh_y=3.0, owner2=-1, owner3=-1, owner4=-1)
exec(plane_code, plane_environment)
assert plane_environment['db'] == 7.0
assert '1.0e30' not in SOURCE and '1.0e15' not in SOURCE, 'unintentional finite distance sentinels remain'
print('Actual native Lloyd assignments/centroids, inradius/size consumers, absence and physical caps passed')
