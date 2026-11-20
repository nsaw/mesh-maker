"""Regressions for compress.py; NumPy only.  python3 scripts/relief/test_compress.py"""
import unittest
import numpy as np
from compress import bas_relief, poisson_neumann


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


if __name__ == '__main__':
    unittest.main()
