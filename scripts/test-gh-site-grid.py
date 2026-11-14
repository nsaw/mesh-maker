#!/usr/bin/env python3
"""Exact Python bucket queries and independent original full-scan regressions."""
import ast
import copy
import math
from pathlib import Path
import random
import time
import unittest

ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / 'grasshopper/components/noise_gen.py').read_text()
NATIVE = (ROOT / 'grasshopper/components/voronoi_relief_native.py').read_text()
HELPER = (ROOT / 'grasshopper/components/site_grid.py').read_text()


def definitions(source, names=None):
    module = ast.parse(source)
    module.body = [n for n in module.body if isinstance(n, (ast.ClassDef, ast.FunctionDef))
                   and (names is None or n.name in names)]
    return compile(module, '<component definitions>', 'exec')


SCOPE = {'math': math, 'xrange': range}
exec(definitions(SOURCE), SCOPE)
exec(compile((ROOT / 'cli/fixtures/gh-site-index-fullscan.py').read_text(), '<full-scan oracle>', 'exec'), SCOPE)
Grid = SCOPE['_SiteGrid']
Noise = SCOPE['VoronoiReliefNoise']
Oracle = SCOPE['FullScanNoise']


def params(**changed):
    p = dict(mesh_x=6.0, mesh_y=4.0, cell_size=.7, jitter=.8, density_strength=.5,
             attractor_mode='vertical', attractor_x=.5, attractor_y=0.0,
             attractor_radius=.5, attractor_falloff=1.2, density_noise=.5,
             density_noise_freq=.1, depth_variation=.4, cols=12, rows=8,
             seed=7, polarity='pockets', profile='cosine', seam_depth=.6,
             anisotropy=.3, anisotropy_angle=35, intensity_strength=.7,
             transition_softness=.4, base_mode='wave', warp_distortion=.3,
             warp_frequency=.1, relax_iter=1)
    p.update(changed)
    return p


def owner(sites, x, y):
    best = 0
    best_d = float('inf')
    for i, p in enumerate(sites):
        dx = p[0] - x; dy = p[1] - y
        d = dx * dx + dy * dy
        if d < best_d:
            best = i; best_d = d
    return best


class Point:
    def __init__(self, x, y, z=0):
        self.X = x; self.Y = y; self.Z = z


class Geometry:
    Point3d = Point


class CountingSites:
    def __init__(self, values):
        self.values = values
        self.reads = 0

    def __len__(self):
        return len(self.values)

    def __getitem__(self, index):
        self.reads += 1
        return self.values[index]


class CountGrid(Grid):
    calls = 0
    instances = []

    def __init__(self, sites, spacing, bounds=None):
        super().__init__(sites, spacing, bounds)
        self.sites = CountingSites(self.sites)
        CountGrid.instances.append(self)

    def nearest(self, x, y, distance_limit=float('inf')):
        CountGrid.calls += 1
        return super().nearest(x, y, distance_limit)


class SiteGridTests(unittest.TestCase):
    def test_embedded_helper_is_identical(self):
        expected = HELPER[HELPER.index('class _SiteGrid'):].strip()
        for source in [SOURCE, NATIVE]:
            text = source.split('# BEGIN SHARED SITE GRID\n')[1].split('# END SHARED SITE GRID')[0]
            self.assertEqual(text.strip(), expected)
        builder = (ROOT / 'grasshopper/builder/meshcraft_builder.py').read_text()
        embedded = builder.split('NOISE_SCRIPT = """', 1)[1].split('"""', 1)[0]
        self.assertEqual(embedded.strip(), SOURCE.strip())

    def test_owner_and_strict_separation_oracles(self):
        rng = random.Random(792)
        populations = [[], [[0., 0.]], [[0., 0.], [0., 0.]],
                       [[-1., 0.], [1., 0.], [0., -1.], [0., 1.]],
                       [[i * .1, 0.] for i in range(100)],
                       [[rng.uniform(-4, 4), rng.uniform(-4, 4)] for _ in range(101)]]
        for sites in populations:
            grid = Grid.from_sites(sites)
            for _ in range(100):
                x = rng.uniform(-20, 20); y = rng.uniform(-20, 20)
                self.assertEqual(grid.nearest(x, y), owner(sites, x, y))
                for radius in [0., .1, 1.]:
                    expected = any((p[0] - x) ** 2 + (p[1] - y) ** 2 < radius * radius for p in sites)
                    self.assertEqual(grid.has_within(x, y, radius), expected)
        self.assertEqual(Grid.from_sites(populations[3]).nearest(0, 0), 0)
        self.assertEqual(Grid([], 1., (0., 0., 1e150, 1e150)).nearest(1e149, 1e149), 0)
        self.assertFalse(Grid([[0., 0.]], 1).has_within(1, 0, 1))
        self.assertTrue(Grid([[0., 0.]], 1).has_within(math.nextafter(1, 0), 0, 1))

    def test_sequential_moves_and_ties(self):
        sites = [[0., 0.], [2., 0.], [1., 2.]]
        grid = Grid(sites, .3, (0., 0., 3., 3.))
        grid.move(0, 1., 1.)
        self.assertEqual(grid.nearest(1., 1.), 0)
        self.assertTrue(grid.has_within(1., 1., .3, 1))
        grid.move(1, 1., 1.)
        self.assertEqual(grid.nearest(1., 1.), 0)
        self.assertTrue(grid.has_within(1., 1., .3, 0))
        before = copy.deepcopy(sites)
        with self.assertRaises(ValueError):
            grid.move(1, math.inf, 0)
        self.assertEqual(sites, before)
        for shift in [0., 1e12]:
            for x in [.3, math.nextafter(.3, 0), math.nextafter(.3, 1)]:
                points = [[shift, shift]]
                grid = Grid.from_sites(points)
                q = shift + x
                self.assertEqual(grid.has_within(q, shift, .3), (points[0][0] - q) ** 2 < .3 * .3)

    def test_candidate_population_and_rng_match_full_scan(self):
        for seed in [0, 5, 71]:
            for jitter in [0., .95]:
                p = params(jitter=jitter)
                args = (p, SCOPE['SimplexNoise'](seed + 88), [[3., 2.]], .5, SCOPE['SimplexNoise'](seed + 120))
                indexed = Noise(seed); original = Oracle(seed)
                self.assertEqual(indexed._gen_sites(*args), original._gen_sites(*args))
                self.assertEqual(indexed._prng_state, original._prng_state)
        p = params(mesh_x=.2, mesh_y=.2, density_strength=0, depth_variation=1.)
        class Suppress:
            def noise(self, x, y):
                return 1.
        indexed = Noise(0); original = Oracle(0)
        self.assertEqual(indexed._gen_sites(p, None, [], 0, Suppress()), original._gen_sites(p, None, [], 0, Suppress()))

    def test_warped_lloyd_matches_full_scan_including_pinning(self):
        rng = random.Random(71)
        for n in [1, 4, 31, 100]:
            sites = [[rng.random() * 6, rng.random() * 4, 0.] for _ in range(n)]
            for pinned in [0, n // 2, n]:
                for warp in [None, lambda x, y: (x + .4 * math.sin(y), y + .3 * math.cos(x))]:
                    a = copy.deepcopy(sites); b = copy.deepcopy(sites)
                    for _ in range(2):
                        Noise(7)._lloyd_relax(a, params(), n * 64, warp, pinned)
                        Oracle(7)._lloyd_relax(b, params(), n * 64, warp, pinned)
                    self.assertEqual(a, b)

    def test_full_sample_grid_matches_full_scan_lookup_path(self):
        for seed in [0, 7, 13]:
            p = params(seed=seed)
            self.assertEqual(Noise(seed).sample_grid(p), Oracle(seed).sample_grid(p))

    def test_uncapped_full_panel_and_index_work(self):
        # Every candidate is accepted here; the original scan visited each retained prefix.
        p = params(mesh_x=80., mesh_y=80., cell_size=.2, jitter=0.,
                   density_strength=0., density_noise=0., depth_variation=0.)
        started = time.monotonic()
        original = SCOPE['_SiteGrid']
        CountGrid.calls = 0; CountGrid.instances = []
        SCOPE['_SiteGrid'] = CountGrid
        try:
            sites = Noise(7)._gen_sites(p, None, [], 0., None)
        finally:
            SCOPE['_SiteGrid'] = original
        reads = sum(g.sites.reads for g in CountGrid.instances)
        self.assertLess(reads, len(sites) * 100)
        old_comparisons = len(sites) * (len(sites) - 1) // 2
        self.assertGreater(old_comparisons, len(sites) * 100)
        self.assertEqual(len(sites), 401 * 401)
        for index, site in enumerate(sites):
            self.assertEqual(site, [((index % 401) + .5) * (80. / 401),
                                    ((index // 401) + .5) * (80. / 401), 0.])
        print('full uncapped Cartesian population:', len(sites), 'site reads:', reads,
              'original full-scan comparisons:', old_comparisons, 'seconds:', time.monotonic() - started)
        # Prove the indexed nearest queries avoid the old full-population scan, using
        # observable site reads rather than a host-dependent timing threshold.
        values = [[float(i), float(j)] for j in range(64) for i in range(64)]
        counted = CountingSites(values)
        grid = Grid(counted, 1., (0., 0., 64., 64.))
        counted.reads = 0
        for i in range(1000):
            x = (i * .618033988749895 % 1) * 64; y = (i * .414213562373095 % 1) * 64
            self.assertEqual(grid.nearest(x, y), owner(values, x, y))
        self.assertLess(counted.reads, 1000 * 100)
        old = CountingSites(values)
        for i in range(10):
            owner(old, i * .1, i * .2)
        self.assertGreater(old.reads, 10 * 100, 'the original full scan fails the same work predicate')
        translated = [[p[0] + 1e12, p[1] - 1e12] for p in values]
        counted = CountingSites(translated)
        grid = Grid(counted, 1., (1e12, -1e12, 1e12 + 64., -1e12 + 64.))
        counted.reads = 0
        for i in range(100):
            x = 1e12 + (i * .618033988749895 % 1) * 64
            y = -1e12 + (i * .414213562373095 % 1) * 64
            self.assertEqual(grid.nearest(x, y), owner(translated, x, y))
        self.assertLess(counted.reads, 100 * 100)


    def test_maximum_lloyd_work_keeps_all_samples(self):
        CountGrid.calls = 0; CountGrid.instances = []
        original = SCOPE['_SiteGrid']
        values = [[i + .5, j + .5, 0.] for j in range(64) for i in range(64)]
        started = time.monotonic()
        SCOPE['_SiteGrid'] = CountGrid
        try:
            Noise(0)._lloyd_relax(values, params(mesh_x=64., mesh_y=64.), len(values) * 64, None, 0)
        finally:
            SCOPE['_SiteGrid'] = original
        self.assertEqual(CountGrid.calls, 4096 * 64)
        self.assertLess(sum(g.sites.reads for g in CountGrid.instances), CountGrid.calls * 100)
        print('canonical maximum Lloyd:', len(values), 'samples:', CountGrid.calls,
              'site reads:', sum(g.sites.reads for g in CountGrid.instances), 'seconds:', time.monotonic() - started)

        scope = dict(math=math, xrange=range, rg=Geometry, mesh_x=100., mesh_y=80.)
        exec(definitions(NATIVE, {'_SiteGrid', '_halton', 'lloyd_fallback'}), scope)
        scope['_SiteGrid'] = CountGrid
        CountGrid.calls = 0; CountGrid.instances = []
        points = [Point(i + .5, j + .5) for j in range(80) for i in range(100)]
        started = time.monotonic()
        result = scope['lloyd_fallback'](points)
        self.assertEqual(len(result), 8000)
        self.assertEqual(CountGrid.calls, 8000 * 64)
        self.assertLess(sum(g.sites.reads for g in CountGrid.instances), CountGrid.calls * 100)
        print('native maximum Lloyd:', len(points), 'samples:', CountGrid.calls,
              'site reads:', sum(g.sites.reads for g in CountGrid.instances), 'seconds:', time.monotonic() - started)

    def test_native_fallback_has_its_own_oracle(self):
        scope = dict(math=math, xrange=range, rg=Geometry, mesh_x=6., mesh_y=4.)
        exec(definitions(NATIVE, {'_SiteGrid', '_halton', 'lloyd_fallback'}), scope)
        oracle_scope = dict(SCOPE, **scope)
        exec(compile((ROOT / 'cli/fixtures/gh-site-index-fullscan.py').read_text(), '<old native fallback>', 'exec'), oracle_scope)
        rng = random.Random(615)
        for n in [0, 1, 4, 35, 80]:
            points = [Point(rng.random() * 6, rng.random() * 4) for _ in range(n)]
            a = scope['lloyd_fallback'](points); b = oracle_scope['native_full_scan'](points)
            self.assertEqual([(p.X, p.Y, p.Z) for p in a], [(p.X, p.Y, p.Z) for p in b])
        # Retain the original native fallback's finite squared-distance ceiling.
        scope['mesh_x'] = oracle_scope['mesh_x'] = 2e20
        scope['mesh_y'] = oracle_scope['mesh_y'] = 2e20
        points = [Point(0., 0.), Point(1e20, 1e20), Point(2e20, 0.)]
        a = scope['lloyd_fallback'](points); b = oracle_scope['native_full_scan'](points)
        self.assertEqual([(p.X, p.Y, p.Z) for p in a], [(p.X, p.Y, p.Z) for p in b])
        with self.assertRaises(ValueError):
            scope['lloyd_fallback']([None] * 8001)

    def test_unsupported_work_is_refused_before_loops(self):
        with self.assertRaises(ValueError):
            Noise(0)._gen_sites(params(mesh_x=1e6), None, [], 0., None)
        with self.assertRaises(ValueError):
            Noise(0)._lloyd_relax([[0., 0.]] * 4097, params(), 0, None, 0)
        with self.assertRaises(ValueError):
            Noise(0)._lloyd_relax([[0., 0.]], params(), 65, None, 0)
        for value in [math.nan, math.inf, 1e151]:
            with self.assertRaises(ValueError):
                Grid([[value, 0.]], 1)
            with self.assertRaises(ValueError):
                Grid([[0., 0.]], 1).nearest(value, 0.)


if __name__ == '__main__':
    unittest.main()
