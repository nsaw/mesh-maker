#!/usr/bin/env python3
"""The native relief component's pillow membrane is independent of output resolution.

It solves the cushion membrane on a fixed physical lattice, so raw heights agree (to normalization rounding) at
coincident nodes of different grids; with the pillow off the pass is untouched. Runs the
component in CPython through scripts/native_relief_host.py, which cannot replace the Rhino 7
check in grasshopper/README.md."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
import native_relief_host as host  # noqa: E402

SOURCE = (ROOT / 'grasshopper/components/voronoi_relief_native.py').read_text()


def grid(resolution, **inputs):
    scope, raw = host.run(SOURCE, resolution=resolution, mesh_x=24.0, mesh_y=24.0, **inputs)
    return scope['g_cols'], scope['g_rows'], raw


def worst(a, b):
    (ca, ra, A), (cb, rb, B) = a, b
    result, nodes = 0.0, 0
    for j in range(ra):
        if (j * (rb - 1)) % (ra - 1):
            continue
        for i in range(ca):
            if (i * (cb - 1)) % (ca - 1):
                continue
            nodes += 1
            result = max(result, abs(A[j * ca + i] - B[(j * (rb - 1) // (ra - 1)) * cb + i * (cb - 1) // (ca - 1)]))
    return result, nodes


for polarity in ('pockets', 'domes'):
    inputs = dict(pillow=1.0, pillow_coverage=1.0, cell_size=3.0, seam_depth=0.4, relax_iter=1, seed=7, polarity=polarity)
    coarse, fine = grid(49, **inputs), grid(97, **inputs)
    bare = grid(49, **dict(inputs, pillow=0.0))
    lifted = sum(1 for a, b in zip(coarse[2], bare[2]) if abs(a - b) > 0.01)
    assert lifted >= 5, '%s: the membrane must lift cushions (%d nodes)' % (polarity, lifted)
    difference, nodes = worst(coarse, fine)
    # Raw heights are recovered from the normalized output, so allow its rounding (old: 7e-3).
    assert nodes == 49 * 49 and difference <= 1e-12, '%s: pillowed raw heights differ by %r across grids' % (polarity, difference)
    print('%s: %d cushion nodes, raw heights within %.1e at %d coincident nodes' % (polarity, lifted, difference, nodes))
print('Native membrane resolution independence passed.')
