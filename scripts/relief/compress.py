"""Gradient-domain bas-relief compression of an orthographic depth map (NumPy only).

A linear map of depth to relief height spends the carving depth on the large jumps (silhouette
against background, a limb in front of the body) and shrinks small detail by the same factor.
This follows Weyrich, Deng, Barnes, Rusinkiewicz and Finkelstein, "Digital Bas-Relief from 3D
Scenes" (SIGGRAPH 2007): take the depth gradients, drop the ones that are occlusion cliffs, shrink
the rest with a log curve so steep slopes lose more than shallow ones, then rebuild a height field
from the compressed gradients with a Poisson solve.

  python3 scripts/relief/compress.py DEPTH.npy OUT.npy --spacing UNITS [--alpha 4] [--edge-slope 8] [--base-radius N]

DEPTH is a 2-D float array, larger = nearer the viewer, NaN where nothing was hit. --spacing is the
distance between samples in the depth's own units, so gradients are true slopes (rise over run).
OUT has the same units: background exactly 0, foreground >= 0. It is not yet scaled to stock;
the caller maps 0..max onto its backing and relief depth.

--base-radius N compresses only the large-scale part of each slope (its mean over a (2N+1)-sample
square) and keeps the rest, in place of the unsharp-masking detail step in Weyrich et al. Without it
steep small features lose the most: on the gathered Venus drape (2026-11-19) plain log compression cut
fine-detail RMS to 0.67x of the linear mapping.
"""
import argparse, json, sys
import numpy as np

def _slopes(depth, mask, spacing, edge_slope):
    """Forward-difference slopes between neighbouring foreground samples; 0 elsewhere and at cliffs."""
    gx = np.zeros_like(depth); gy = np.zeros_like(depth)
    both_x = mask[:, 1:] & mask[:, :-1]; both_y = mask[1:, :] & mask[:-1, :]
    gx[:, :-1] = np.where(both_x, np.diff(np.where(mask, depth, 0.0), axis=1), 0.0) / spacing
    gy[:-1, :] = np.where(both_y, np.diff(np.where(mask, depth, 0.0), axis=0), 0.0) / spacing
    cliffs = int((np.abs(gx) > edge_slope).sum() + (np.abs(gy) > edge_slope).sum())
    gx[np.abs(gx) > edge_slope] = 0.0; gy[np.abs(gy) > edge_slope] = 0.0
    return gx, gy, cliffs

def _box(a, w, r):
    """Weighted mean of `a` over a (2r+1)-square window, weights `w` (0 outside the foreground)."""
    def s(x):
        c = np.pad(np.cumsum(np.cumsum(x, 0), 1), ((1, 0), (1, 0)))
        R, C = x.shape; y0 = np.clip(np.arange(R) - r, 0, R); y1 = np.clip(np.arange(R) + r + 1, 0, R)
        x0 = np.clip(np.arange(C) - r, 0, C); x1 = np.clip(np.arange(C) + r + 1, 0, C)
        return c[y1][:, x1] - c[y0][:, x1] - c[y1][:, x0] + c[y0][:, x0]
    n = s(w)
    return np.where(n > 0, s(a * w) / np.maximum(n, 1e-12), 0.0)

def _attenuate(g, alpha):
    return np.sign(g) * np.log1p(alpha * np.abs(g)) / alpha

def _div(gx, gy):
    """Backward-difference divergence of edge fields, the transpose of the forward differences (negated)."""
    div = gx.copy(); div[:, 1:] -= gx[:, :-1]
    div += gy; div[1:, :] -= gy[:-1, :]
    return div

def _solve_div(div):
    """Full-grid u with Laplacian(u) = div and reflective edges, mean 0.

    Mirroring to a 2R x 2C periodic grid makes the FFT solve equal to the Neumann problem
    (half-sample symmetry, i.e. a DCT-II solve), without SciPy.
    """
    R, C = div.shape
    ext = np.concatenate([div, div[:, ::-1]], axis=1); ext = np.concatenate([ext, ext[::-1, :]], axis=0)
    ky = 2 * np.cos(2 * np.pi * np.arange(2 * R) / (2 * R)) - 2
    kx = 2 * np.cos(2 * np.pi * np.arange(C + 1) / (2 * C)) - 2       # rfft keeps columns 0..C of 2C
    denom = ky[:, None] + kx[None, :]; denom[0, 0] = 1.0
    F = np.fft.rfft2(ext) / denom; F[0, 0] = 0.0
    return np.fft.irfft2(F, s=ext.shape)[:R, :C]

def poisson_neumann(gx, gy):
    """Least-squares u whose forward differences are closest to (gx, gy) over the whole grid."""
    return _solve_div(_div(gx, gy))

def poisson_masked(gx, gy, mask, tol=1e-8, max_iter=2000):
    """Least-squares u over the mask with the background held at 0 (Dirichlet), reflective at the window edge.

    Edges with at least one foreground end are fitted; their target is (gx, gy), which must already be
    0 on foreground-background edges. Solved by conjugate gradient preconditioned with the full-grid
    FFT solve. Returns (u, iterations, relative residual).
    """
    R, C = mask.shape
    ex = np.zeros((R, C), bool); ex[:, :-1] = mask[:, 1:] | mask[:, :-1]
    ey = np.zeros((R, C), bool); ey[:-1, :] = mask[1:, :] | mask[:-1, :]
    def A(u):  # D^T M D on the embedded field, restricted to the mask
        dx = np.zeros((R, C)); dx[:, :-1] = np.diff(u, axis=1)
        dy = np.zeros((R, C)); dy[:-1, :] = np.diff(u, axis=0)
        return np.where(mask, -_div(np.where(ex, dx, 0.0), np.where(ey, dy, 0.0)), 0.0)
    def M(r):  # (D^T D)^+ on the full grid, restricted
        return np.where(mask, -_solve_div(-r), 0.0)
    b = np.where(mask, -_div(np.where(ex, gx, 0.0), np.where(ey, gy, 0.0)), 0.0)
    bn = np.linalg.norm(b)
    u = np.zeros((R, C))
    if bn == 0: return u, 0, 0.0
    r = b.copy(); z = M(r); p = z.copy(); rz = np.vdot(r, z)
    for k in range(1, max_iter + 1):
        Ap = A(p); step = rz / np.vdot(p, Ap)
        u += step * p; r -= step * Ap
        res = np.linalg.norm(r) / bn
        if res < tol: return u, k, float(res)
        z = M(r); rz_new = np.vdot(r, z); p = z + (rz_new / rz) * p; rz = rz_new
    raise ValueError(f'Poisson solve did not converge in {max_iter} iterations (residual {res:.2e})')

def bas_relief(depth, spacing, alpha=4.0, edge_slope=8.0, base_radius=None):
    """Return (height, stats). height: background 0, foreground >= 0, in depth units.

    base_radius (samples): if given, only the large-scale part of each slope (its box mean over a
    (2r+1)-square of foreground samples) is log-compressed and the remainder is kept unchanged, so
    steep small features such as cloth folds survive. None compresses every slope (Weyrich et al.
    without their unsharp step).
    """
    depth = np.asarray(depth, dtype=np.float64)
    if depth.ndim != 2: raise ValueError('depth must be 2-D')
    if not (np.isfinite(spacing) and spacing > 0): raise ValueError('spacing must be finite and positive')
    if not (np.isfinite(alpha) and alpha > 0): raise ValueError('alpha must be finite and positive')
    if not (np.isfinite(edge_slope) and edge_slope > 0): raise ValueError('edge-slope must be finite and positive')
    if base_radius is not None and not (isinstance(base_radius, (int, np.integer)) and base_radius >= 1):
        raise ValueError('base radius must be a whole number of samples, at least 1')
    mask = np.isfinite(depth)
    if not mask.any(): raise ValueError('depth has no foreground')
    gx, gy, cliffs = _slopes(depth, mask, spacing, edge_slope)
    if base_radius is None:
        gx, gy = _attenuate(gx, alpha), _attenuate(gy, alpha)
    else:
        wx = np.zeros(mask.shape); wx[:, :-1] = mask[:, 1:] & mask[:, :-1]
        wy = np.zeros(mask.shape); wy[:-1, :] = mask[1:, :] & mask[:-1, :]
        lx, ly = _box(gx, wx, base_radius), _box(gy, wy, base_radius)
        gx = np.where(wx > 0, _attenuate(lx, alpha) + gx - lx, 0.0)
        gy = np.where(wy > 0, _attenuate(ly, alpha) + gy - ly, 0.0)
    gx, gy = gx * spacing, gy * spacing
    if mask.all():  # no background to anchor to: plain Neumann solve, lowest point at 0
        u = poisson_neumann(gx, gy); u -= u.min(); iters, res = 0, 0.0
    else:
        u, iters, res = poisson_masked(gx, gy, mask)
    span = float(u[mask].max())
    if not span > 0: raise ValueError('compressed relief has no height above the background')
    below = mask & (u < 0)
    stats = dict(method='gradient', alpha=alpha, edge_slope=edge_slope, base_radius=base_radius, spacing=spacing, cliff_edges_removed=cliffs,
                 solver_iterations=iters, solver_residual=res,
                 foreground_clipped_fraction=float(below.sum() / mask.sum()),
                 foreground_clipped_depth_max=float(-u[below].min()) / span if below.any() else 0.0,
                 height_max=span)
    return np.where(mask, np.maximum(u, 0.0), 0.0), stats

def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('depth'); a.add_argument('out')
    a.add_argument('--spacing', type=float, required=True); a.add_argument('--alpha', type=float, default=4.0)
    a.add_argument('--edge-slope', type=float, default=8.0)
    a.add_argument('--base-radius', type=int, help='samples; compress only slopes averaged over this radius')
    o = a.parse_args()
    try:
        h, stats = bas_relief(np.load(o.depth), o.spacing, o.alpha, o.edge_slope, o.base_radius)
    except ValueError as e:
        sys.exit(str(e))
    np.save(o.out, h)
    print(json.dumps(stats, allow_nan=False))

if __name__ == '__main__':
    main()
