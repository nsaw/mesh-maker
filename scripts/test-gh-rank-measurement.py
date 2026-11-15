#!/usr/bin/env python3
"""Native relief rank queries, frozen IDs and physical measurement work contracts."""
import ast
from fractions import Fraction as F
import json
import math
from pathlib import Path
import random
import unittest

ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / 'grasshopper/components/noise_gen.py').read_text()
module = ast.parse(SOURCE)
module.body = [node for node in module.body if isinstance(node, ast.ClassDef)]
scope = {'math': math}
exec(compile(module, '<actual GhPython classes>', 'exec'), scope)
Grid = scope['_SiteGrid']
Noise = scope['VoronoiReliefNoise']


def reference(sites, x, y, c, s, scale):
    def metric(point):
        dx, dy = F(point[0]) - F(x), F(point[1]) - F(y)
        if scale > 1.0001:
            dx, dy = (dx * F(c) + dy * F(s)) * F(scale), -dx * F(s) + dy * F(c)
        return dx * dx + dy * dy
    indices = sorted(range(len(sites)), key=lambda i: (metric(sites[i]), i))[:4]
    distances = []
    for i in indices:
        dx = x - sites[i][0]; dy = y - sites[i][1]
        xr = dx * c + dy * s; yr = -dx * s + dy * c
        distances.append(math.sqrt(dx * dx + dy * dy) if scale <= 1.0001 else math.sqrt((xr * scale) ** 2 + yr * yr))
    return tuple(distances + [math.inf] * (4 - len(indices)) + indices + [-1] * (4 - len(indices))) if indices else (math.inf,) * 4 + (0, -1, -1, -1)


class CountingSites:
    def __init__(self, values):
        self.values = values
        self.reads = 0
    def __len__(self):
        return len(self.values)
    def __getitem__(self, index):
        self.reads += 1
        return self.values[index]


class RankMeasurementTests(unittest.TestCase):
    def test_integral_frozen_ids_are_copied_as_integers(self):
        noise = Noise(7)
        frozen = {'xy': [1., 1., 2., 2.], 'ids': [0., 4294967295.], 'pinned': [0, 1]}
        result = noise._copy_frozen_sites(frozen, dict(mesh_x=3., mesh_y=3.))
        self.assertTrue(all(type(identity) is int for identity in result['ids']))
        self.assertEqual(result['ids'], [0, 4294967295])
        self.assertEqual(frozen['ids'], [0., 4294967295.])
        for identity in result['ids']:
            self.assertTrue(math.isfinite(noise._cell_hash01(identity, 7)))
        for ids in [[True, 2], [0, 1.5], [-1, 2], [0, 4294967296], [2, 2], [2, 1]]:
            with self.assertRaises(ValueError):
                noise._copy_frozen_sites(dict(frozen, ids=ids), dict(mesh_x=3., mesh_y=3.))

    def test_exact_four_ranks_and_legacy_distance_arithmetic(self):
        rng = random.Random(6868)
        populations = [[], [[0., 0.]], [[0., 0.]] * 7,
                       [[-1., 0.], [1., 0.], [0., -1.], [0., 1.], [2., 0.]],
                       [[i * .1, 0.] for i in range(80)],
                       [[rng.uniform(-4, 4), rng.uniform(-4, 4)] for _ in range(101)],
                       [[1e12 + i, -1e12 + j] for j in range(5) for i in range(7)],
                       [[1., 0.], [math.nextafter(1., 0.), 0.], [1., 1e-12], [-1., 0.], [0., 1.]]]
        for sites in populations:
            for spacing in [.17, 100.]:
                grid = Grid(sites, spacing)
                for c, s, scale in [(1., 0., 1.), (0., 1., 1.00001), (math.cos(.713), math.sin(.713), 4.)]:
                    queries = [(0., 0.), (1., 0.), (-20., 15.)]
                    queries += [(rng.uniform(-6, 6), rng.uniform(-6, 6)) for _ in range(12)]
                    if sites:
                        queries += [(sites[0][0] + .3, sites[0][1] - .2)]
                    for x, y in queries:
                        self.assertEqual(grid.nearest_four(x, y, c, s, scale), reference(sites, x, y, c, s, scale))

    def test_large_population_rank_work_and_negative_control(self):
        sites = [[float(i), float(j)] for j in range(64) for i in range(64)]
        counted = CountingSites(sites)
        grid = Grid(counted, 1.)
        counted.reads = 0
        for i in range(1000):
            x = i * .371 % 64; y = i * .217 % 64
            result = grid.nearest_four(x, y)
            if i % 100 == 0:
                self.assertEqual(result, reference(sites, x, y, 1., 0., 1.))
        indexed_reads = counted.reads
        self.assertLess(indexed_reads, 1000 * 150)
        counted.reads = 0
        # The replaced scan and coordinate-scale reconstruction both fail this bound.
        for _ in range(10):
            for i in range(len(counted)):
                dx = counted[i][0] - .3; dy = counted[i][1] - .2
                math.sqrt(dx * dx + dy * dy)
        self.assertGreater(counted.reads, 10 * 150)
        print(json.dumps(dict(queries=1000, sites=len(sites), indexed_site_reads=indexed_reads,
                              full_scan_reads_per_10_queries=counted.reads)))

    def test_full_sample_matches_independent_exact_rank_path(self):
        class ExactRanks(Noise):
            def _nearest_three(self, sites, x, y, c, s, scale, lookup=None):
                return reference(sites, x, y, c, s, scale)
        params = dict(mesh_x=1., mesh_y=1., cell_size=.7, jitter=.7, density_strength=.2,
            attractor_mode='vertical', attractor_x=.5, attractor_y=.5, attractor_radius=.5,
            attractor_falloff=1., density_noise=.3, depth_variation=.4, cols=7, rows=8,
            seed=7, polarity='pockets', profile='cosine', seam_depth=.6, anisotropy=.3,
            anisotropy_angle=35., intensity_strength=.7, transition_softness=.4,
            base_mode='wave', base_amp=.2, warp_distortion=.3, relax_iter=0)
        for seed in [0, 7]:
            for anisotropy in [0., 2.]:
                p = dict(params, seed=seed, anisotropy=anisotropy)
                self.assertEqual(Noise(seed).sample_grid(p), ExactRanks(seed).sample_grid(p))

    def test_permitted_full_board_physical_measurement_work(self):
        params = dict(mesh_x=36., mesh_y=24., cell_size=.2, jitter=0., density_strength=0.,
            attractor_mode='none', attractor_x=.5, attractor_y=.5, attractor_radius=.5,
            attractor_falloff=1., density_noise=0., depth_variation=0., cols=16, rows=11,
            seed=7, polarity='pockets', profile='cosine', seam_depth=.6, anisotropy=0.,
            anisotropy_angle=0., intensity_strength=.7, transition_softness=.4,
            base_mode='flat', warp_distortion=0., relax_iter=0)
        original = Grid.nearest_four
        counts = [0, 0]
        indices = set()
        def recording(grid, *args):
            if not isinstance(grid.sites, CountingSites):
                grid.sites = CountingSites(grid.sites)
            before = grid.sites.reads
            result = original(grid, *args)
            counts[0] += 1
            counts[1] += grid.sites.reads - before
            indices.add(grid)
            return result
        Grid.nearest_four = recording
        noise = Noise(7)
        try:
            output = noise.sample_grid(params)
        finally:
            Grid.nearest_four = original
        self.assertEqual(len(noise.source_sites['ids']), 4096)
        self.assertEqual(counts[0], 481 * 321 + 4096 + 16 * 11)
        self.assertEqual(len(indices), 1)
        self.assertLess(counts[1], counts[0] * 150)
        self.assertEqual(len(output), 16 * 11)
        print(json.dumps(dict(physical_samples=481 * 321, sites=4096,
                              rank_queries=counts[0], indexed_rank_site_reads=counts[1],
                              original_distance_evaluations=counts[0] * 4096)))

    def test_sample_grid_reuses_one_index_for_all_ranks(self):
        # Observe the actual sample_grid calls, including the physical quadrature,
        # site anchors and output pass. Rebuilding an index in each call fails here.
        params = dict(mesh_x=1., mesh_y=1., cell_size=.7, jitter=0., density_strength=0.,
            attractor_mode='none', attractor_x=.5, attractor_y=.5, attractor_radius=.5,
            attractor_falloff=1., density_noise=0., depth_variation=0., cols=3, rows=4,
            seed=7, polarity='pockets', profile='cosine', seam_depth=.6, anisotropy=.3,
            anisotropy_angle=35., intensity_strength=.7, transition_softness=.4,
            base_mode='flat', warp_distortion=0., relax_iter=0,
            frozen_sites=dict(xy=[.2,.2,.8,.2,.2,.8,.8,.8], ids=[0.,1.,2.,3.], pinned=[0]*4))
        original = Grid.nearest_four
        indices = []
        def recording(grid, *args):
            indices.append(grid)
            return original(grid, *args)
        Grid.nearest_four = recording
        try:
            result = Noise(7).sample_grid(params)
        finally:
            Grid.nearest_four = original
        axis = math.ceil(1. / Noise.CELL_MEASUREMENT_PITCH_IN) + 1
        self.assertEqual(len(indices), axis * axis + 4 + 12)
        self.assertEqual(len(set(indices)), 1)
        self.assertEqual(len(result), 12)
        self.assertTrue(all(math.isfinite(value) for value in result))


if __name__ == '__main__':
    unittest.main()
