"""Fine-detail retention of the drape relief mappings on a saved bake (NumPy only).

  python3 scripts/relief/measure_detail.py DRAPE_DIR [--alpha 4 8] [--base-radius-in 0.5]

DRAPE_DIR is a workflow.py output folder (veiled-depth.npy, bare-depth.npy, drape.json). For linear,
plain log compression (no base split) and the base split at each --alpha, it prints JSON with:
detail_vs_linear, the RMS of height minus its mean over a 0.17 in square (17 samples at 100 per inch),
taken over foreground at least 0.17 in inside the outline, divided by the same RMS for linear; the
clamped foreground fraction; solver iterations; and seconds. Heights are compared in panel inches.
"""
import argparse, json, sys, time
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(HERE.parent / 'drape'))
from compress import _box  # noqa: E402
import workflow  # noqa: E402


def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('drape_dir'); a.add_argument('--alpha', type=float, nargs='+', default=[4.0, 8.0])
    a.add_argument('--base-radius-in', type=float, default=0.5)
    o = a.parse_args()
    d = Path(o.drape_dir)
    veiled, bare = np.load(d / 'veiled-depth.npy'), np.load(d / 'bare-depth.npy')
    frame_width = json.loads((d / 'drape.json').read_text())['args']['frame_width']
    fg = np.isfinite(veiled); per_in = (veiled.shape[1] - 1) / 12
    r = round(0.17 * per_in)
    inner = fg & (_box(fg.astype(float), np.ones(fg.shape), r) > 1 - 1e-9)   # whole (2r+1) square is foreground
    if not inner.any(): sys.exit('no foreground window of %d samples fits inside the outline' % (2 * r + 1))
    def detail(h):
        return float(np.sqrt(np.mean((h - _box(h, fg.astype(float), r // 2))[inner] ** 2)))
    runs = [('linear', dict(method='linear'))]
    for alpha in o.alpha:
        runs.append((f'plain alpha {alpha:g}', dict(method='gradient', alpha=alpha, edge_slope=8.0, base_radius_in=None)))
        runs.append((f'split alpha {alpha:g}', dict(method='gradient', alpha=alpha, edge_slope=8.0, base_radius_in=o.base_radius_in)))
    out, ref = {}, None
    for name, cfg in runs:
        t = time.time()
        if cfg.get('base_radius_in', 0) is None:   # plain log compression: bas_relief without a base split
            from compress import bas_relief
            u, stats = bas_relief(veiled, frame_width / (veiled.shape[1] - 1), cfg['alpha'], cfg['edge_slope'], None)
            h = np.where(fg, workflow.BACK + workflow.SPAN * u / stats['height_max'], workflow.BACK)
        else:
            h, _, _, _, stats = workflow.relief_heights(veiled, bare, cfg, frame_width)
        h = h.astype(np.float64) / workflow.IN
        rms = detail(h); ref = rms if ref is None else ref
        out[name] = dict(detail_vs_linear=round(rms / ref, 3), seconds=round(time.time() - t, 1),
                         clamped_fraction=round(stats.get('foreground_clipped_fraction', 0.0), 4),
                         solver_iterations=stats.get('solver_iterations'))
    print(json.dumps(dict(drape_dir=str(d), detail_window_samples=2 * (r // 2) + 1, inset_samples=r, results=out), indent=1))


if __name__ == '__main__':
    main()
