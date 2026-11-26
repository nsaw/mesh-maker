"""Regressions for compress.py; NumPy only.  python3 scripts/relief/test_compress.py"""
import sys, unittest
from pathlib import Path
import numpy as np
from compress import _box, bas_relief, poisson_masked, poisson_neumann

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'drape'))
import workflow  # noqa: E402  (relief_heights and parse/relief_config; imports no Blender)


def bump(R, C, cy, cx, r, h):
    y, x = np.mgrid[:R, :C]
    return h * np.exp(-((y - cy) ** 2 + (x - cx) ** 2) / (2 * r * r))


class CompressTests(unittest.TestCase):
    def test_poisson_recovers_a_field_from_its_own_gradients(self):
        rng = np.random.default_rng(1)
        u = sum(bump(90, 70, *rng.uniform(0, 70, 2), rng.uniform(4, 15), rng.uniform(-1, 1)) for _ in range(6))
        gx = np.zeros_like(u); gy = np.zeros_like(u)
        gx[:, :-1] = np.diff(u, axis=1); gy[:-1, :] = np.diff(u, axis=0)
        r = poisson_neumann(gx, gy)
        self.assertLess(np.abs((r - r.mean()) - (u - u.mean())).max(), 1e-9)

    def test_cliff_is_removed_and_detail_keeps_its_share_of_the_depth(self):
        R, C = 120, 160
        d = np.zeros((R, C)); d[:, 80:] = 10.0                       # a 10-unit cliff, one sample wide
        d += bump(R, C, 60, 120, 6, 0.5)                             # 0.5-unit detail on the raised side
        linear = (d - d.min()) / (d.max() - d.min())
        h, s = bas_relief(d, spacing=1.0, alpha=4.0, edge_slope=2.0)
        h = h / h.max()
        self.assertGreater(s['cliff_edges_removed'], 0)
        detail_linear = linear[60, 120] - linear[60, 100]
        detail_gradient = h[60, 120] - h[60, 100]
        self.assertLess(detail_linear, 0.06)
        self.assertGreater(detail_gradient, 0.9)                     # the bump now owns the depth
        self.assertLess(abs(h[60, 40] - h[60, 100]), 0.05)           # the two sides of the cliff meet

    def test_nan_background_is_exactly_zero_and_orientation_is_kept(self):
        R, C = 100, 80
        d = np.full((R, C), np.nan)
        d[20:80, 10:70] = bump(R, C, 30, 25, 10, 2.0)[20:80, 10:70] + 1.0   # peak upper-left
        h, s = bas_relief(d, spacing=1.0)
        self.assertTrue(np.isfinite(h).all())
        self.assertTrue((h[np.isnan(d)] == 0).all())
        self.assertTrue((h >= 0).all())
        r, c = np.unravel_index(np.argmax(h), h.shape)
        self.assertLess(r, 50); self.assertLess(c, 40)                    # still upper-left: no flip or mirror

    def test_base_radius_keeps_steep_small_features(self):
        R, C = 120, 160
        y, x = np.mgrid[:R, :C]
        d = 0.5 * x + 0.4 * np.sin(x / 1.5)                          # fine ripples on a long steep ramp
        def ripple(h):                                                # ripple height as a share of the total
            r = h[60, 60:100] / h.max(); t = np.arange(r.size)
            return np.ptp(r - np.polyval(np.polyfit(t, r, 1), t))
        plain, _ = bas_relief(d, spacing=1.0, alpha=8.0, edge_slope=50.0)
        split, s = bas_relief(d, spacing=1.0, alpha=8.0, edge_slope=50.0, base_radius=10)
        self.assertEqual(s['base_radius'], 10)
        self.assertGreater(ripple(split), 2 * ripple(plain))

    def test_bad_inputs_raise(self):
        d = bump(20, 20, 10, 10, 3, 1.0)
        for kw in [dict(spacing=0), dict(spacing=float('nan')), dict(spacing=1, alpha=0),
                   dict(spacing=1, alpha=float('inf')), dict(spacing=1, edge_slope=-1),
                   dict(spacing=1, base_radius=0), dict(spacing=1, base_radius=2.5)]:
            with self.subTest(kw=kw), self.assertRaises(ValueError):
                bas_relief(d, **kw)
        with self.assertRaises(ValueError):
            bas_relief(np.full((10, 10), np.nan), spacing=1)
        with self.assertRaises(ValueError):
            bas_relief(np.zeros(10), spacing=1)

    def test_dropped_cliff_leaves_no_step_with_base_radius(self):
        # Review of #91: cliff edges kept weight 1 in the base split and got att(l) - l, a reverse step.
        R, C = 40, 120
        for slope in (0.5, 2.0, 5.0):
            d = np.tile(slope * np.arange(C, dtype=float), (R, 1)); d[:, 60:] += 200.0
            for radius, axis in ((None, 'x'), (10, 'x'), (10, 'y')):   # 'y' solves the transpose: same answer
                with self.subTest(slope=slope, radius=radius, axis=axis):
                    h, s = bas_relief(d if axis == 'x' else d.T, spacing=1.0, alpha=4.0, edge_slope=8.0, base_radius=radius)
                    if axis == 'y': h = h.T
                    self.assertEqual(s['cliff_edges_removed'], R)
                    step = h[:, 61] - h[:, 60]; ramp = h[:, 58] - h[:, 57]
                    jump = h[:, 60] - h[:, 59]   # across the dropped cliff
                    self.assertLess(np.abs(jump - 0).max(), 1e-6 + 0.02 * np.abs(ramp).max())
                    self.assertGreater(ramp.min(), 0); self.assertGreater(step.min(), 0)
                    # A uniform ramp keeps a uniform step right up to the cliff: dropped edges must not
                    # dilute the base mean of their neighbours either.
                    steps = np.delete(np.diff(h, axis=1), 59, axis=1)
                    self.assertLess(np.ptp(steps) / steps.mean(), 1e-6)

    def test_masked_poisson_matches_dense_least_squares(self):
        rng = np.random.default_rng(3)
        R, C = 9, 11
        mask = np.zeros((R, C), bool); mask[1:8, 2:10] = True; mask[4, 5] = False   # interior hole
        mask[0, 0] = True                                                            # isolated sample
        gx = rng.normal(size=(R, C)); gy = rng.normal(size=(R, C))
        ex = np.zeros((R, C), bool); ex[:, :-1] = mask[:, 1:] | mask[:, :-1]
        ey = np.zeros((R, C), bool); ey[:-1, :] = mask[1:, :] | mask[:-1, :]
        gx = np.where(ex & np.pad(mask[:, 1:] & mask[:, :-1], ((0, 0), (0, 1))), gx, 0.0)
        gy = np.where(ey & np.pad(mask[1:, :] & mask[:-1, :], ((0, 1), (0, 0))), gy, 0.0)
        idx = -np.ones((R, C), int); idx[mask] = np.arange(mask.sum())
        rows, rhs = [], []
        for y in range(R):
            for x in range(C):
                for dy, dx, g, e in ((0, 1, gx, ex), (1, 0, gy, ey)):
                    if not e[y, x]: continue
                    row = np.zeros(mask.sum())
                    if idx[y + dy, x + dx] >= 0: row[idx[y + dy, x + dx]] += 1
                    if idx[y, x] >= 0: row[idx[y, x]] -= 1
                    rows.append(row); rhs.append(g[y, x])
        ref = np.zeros((R, C)); ref[mask] = np.linalg.lstsq(np.array(rows), np.array(rhs), rcond=None)[0]
        u, iters, res = poisson_masked(gx, gy, mask, tol=1e-12)
        self.assertLess(np.abs(u - ref).max(), 1e-8)
        self.assertTrue((u[~mask] == 0).all())

    def test_box_is_a_weighted_window_mean(self):
        rng = np.random.default_rng(4)
        a = rng.normal(size=(13, 17)); w = (rng.random((13, 17)) > 0.3).astype(float)
        for r in (1, 3):
            got = _box(a, w, r)
            for y in range(13):
                for x in range(17):
                    ws = w[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1]
                    xs = a[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1]
                    want = (ws * xs).sum() / ws.sum() if ws.sum() > 0 else 0.0
                    self.assertAlmostEqual(got[y, x], want, places=12)

    def test_output_scales_with_spacing_and_depth_units(self):
        d = np.full((60, 80), np.nan); y, x = np.mgrid[:60, :80]
        inside = (y - 30) ** 2 + (x - 40) ** 2 < 25 ** 2
        d[inside] = (bump(60, 80, 25, 35, 6, 3.0) + 0.2 * x)[inside]; d[inside & (x > 45)] += 30.0
        h1, s1 = bas_relief(d, spacing=1.0, base_radius=4)
        h2, s2 = bas_relief(d * 0.01, spacing=0.01, base_radius=4)
        self.assertEqual(s1['cliff_edges_removed'], s2['cliff_edges_removed'])
        self.assertLess(np.abs(h2 - 0.01 * h1).max(), 1e-9)

    def test_workflow_mapping_onto_the_panel(self):
        R, C = 41, 121                                           # 120 steps across the 12 in panel
        y, x = np.mgrid[:R, :C]
        veiled = np.full((R, C), np.nan); inside = (abs(y - 20) < 15) & (abs(x - 60) < 50)
        veiled[inside] = (1.0 + bump(R, C, 20, 40, 8, 0.5))[inside]
        bare = veiled - 0.1
        for method, extra in (('linear', []), ('gradient', ['--relief', 'gradient'])):
            o = workflow.parse_args(['f.glb', '--preset', 'silk-tilt25', '--out', 'o'] + extra)
            h, fg, lo, hi, stats = workflow.relief_heights(veiled, bare, workflow.relief_config(o), frame_width=4.2)
            with self.subTest(method=method):
                self.assertEqual(h.dtype, np.float32)
                self.assertTrue(np.array_equal(fg, inside))
                self.assertTrue((h[~inside] == np.float32(workflow.BACK)).all())
                self.assertGreaterEqual(h.min(), np.float32(workflow.BACK))
                self.assertAlmostEqual(float(h.max()), workflow.BACK + workflow.SPAN, places=7)
                r, c = np.unravel_index(np.argmax(np.where(inside, h, 0)), h.shape)
                self.assertLess(abs(c - 40), 6)              # the bump stays left of centre
        self.assertEqual(stats['base_radius'], 5)            # 0.5 in at 10 samples per inch
        self.assertAlmostEqual(stats['spacing'], 4.2 / 120)
        o = workflow.parse_args(['f.glb', '--preset', 'silk-tilt25', '--out', 'o', '--relief', 'gradient', '--relief-base-radius', '1'])
        self.assertEqual(workflow.relief_heights(veiled, bare, workflow.relief_config(o), 4.2)[4]['base_radius'], 10)
        # Linear spans the deepest visible point, which is on the bare figure here, to the frontmost veil.
        h = workflow.relief_heights(veiled, bare, dict(method='linear'), 4.2)[0]
        lo, hi = np.nanmin(bare), np.nanmax(veiled)
        want = workflow.BACK + workflow.SPAN * (veiled[20, 90] - lo) / (hi - lo)
        self.assertAlmostEqual(float(h[20, 90]), want, places=7)
        self.assertGreater(float(h[inside].min()), workflow.BACK + 0.1 * workflow.SPAN)   # nothing sits on the backing
        with self.assertRaises(ValueError):
            workflow.relief_heights(np.full((R, C), np.nan), bare, dict(method='linear'), 4.2)


if __name__ == '__main__':
    unittest.main()
