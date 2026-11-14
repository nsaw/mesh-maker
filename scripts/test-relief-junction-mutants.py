#!/usr/bin/env python3
"""Removed shared fields and binary crown controls must fail production regressions."""
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='meshcraft-junction-mutants-') as temp:
    destination = Path(temp)
    shutil.copytree(ROOT / 'src', destination / 'src')
    (destination / 'cli/fixtures').mkdir(parents=True)
    shutil.copy2(ROOT / 'cli/exact-metric-rank-oracle.ts', destination / 'cli/exact-metric-rank-oracle.ts')
    shutil.copy2(ROOT / 'cli/relief-junction.spec.ts', destination / 'cli/relief-junction.spec.ts')
    (destination / 'grasshopper/components').mkdir(parents=True)
    shutil.copy2(ROOT / 'grasshopper/components/noise_gen.py', destination / 'grasshopper/components/noise_gen.py')
    for name in ['package.json', 'tsconfig.json']:
        shutil.copy2(ROOT / name, destination / name)
    (destination / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
    shutil.copy2(ROOT / 'cli/relief-support.spec.ts', destination / 'cli/relief-support.spec.ts')
    shutil.copy2(ROOT / 'cli/relief-fixtures.ts', destination / 'cli/relief-fixtures.ts')
    shutil.copytree(ROOT / 'cli/fixtures/relief-geometry-bb9', destination / 'cli/fixtures/relief-geometry-bb9')
    sampler = destination / 'src/noise/voronoi-relief.ts'
    grid = destination / 'src/noise/site-grid.ts'
    originals = {path: path.read_text() for path in [sampler, grid]}
    cases = [
        ('positive', sampler, None, None, None),
        ('static', sampler, r'f1, staticMul, slopeMul,', 'f1, () => staticMul[ownerIdx], slopeMul,', 'junction'),
        ('slope', sampler, r'f1, staticMul, slopeMul,', 'f1, staticMul, () => slopeMul[ownerIdx],', 'junction'),
        ('radius', sampler, r'slopeMul, geometryRadius, seamScale,', 'slopeMul, () => geometryRadius[ownerIdx], seamScale,', 'junction'),
        ('crown', sampler, r'return smoothstep\(0, minimumSpan, width\) \* \(1 - smoothstep\(0, span, distance\)\);',
         'return width > 1e-6 ? 1 - smoothstep(0, span, distance) : 0;', 'junction'),
        ('shared', sampler, r'seamScale, sharedStrength,', 'seamScale, () => sharedStrength[ownerIdx],', 'junction'),
        ('rank-shared', sampler, r'seamScale, sharedStrength,',
         'seamScale, () => edgeHash01(Math.min(ownerIdx, idx3), Math.max(ownerIdx, idx3), seed + 53),', 'junction'),
        ('rank-side', sampler, r'const edgeSide = edgeShared \+ ownerFade \* \(localSide - edgeShared\);',
         'const edgeSide = edgeHash01(ownerIdx, idx3, seed + 59);', 'junction'),
        ('relative-plane', grid, r'return Math.max\(0, separation / 2 - qx \* nx - qy \* ny\);',
         'let dx = this.sites[index].x - this.sites[owner].x, dy = this.sites[index].y - this.sites[owner].y; '
         'if (scale > 1.0001) { const tx = (dx * cosA + dy * sinA) * scale; dy = -dx * sinA + dy * cosA; dx = tx; } '
         'const a = Math.hypot(qx - dx, qy - dy), b = Math.hypot(qx, qy); return Math.max(0, (a - b) * (a + b) / (2 * separation));',
         'near-coincident relative-plane'),
        ('bisector', grid, r'if \(candidate.index === owner\) continue;',
         'if (candidate.index >= 0) continue;', 'bisector oracle'),
    ]
    for name, path, pattern, replacement, expected in cases:
        for original_path, source in originals.items():
            original_path.write_text(source)
        if pattern:
            source, count = re.subn(pattern, replacement, originals[path])
            if count != 1:
                raise AssertionError('Mutant pattern did not identify exactly one field: ' + name)
            path.write_text(source)
        result = subprocess.run([str(ROOT / 'node_modules/.bin/tsx'), 'cli/relief-junction.spec.ts'],
                                cwd=destination, capture_output=True, text=True, timeout=120)
        if name == 'positive':
            if result.returncode != 0:
                raise AssertionError(result.stdout + result.stderr)
        elif result.returncode == 0 or 'AssertionError' not in result.stderr or expected not in result.stderr:
            raise AssertionError('Mutant did not fail its intended assertion: ' + name + '\n' + result.stdout + result.stderr)
        print(name + ': ' + ('passed' if name == 'positive' else 'rejected by regression'))
        if name != 'positive':
            print(next(line for line in result.stderr.splitlines() if line.startswith('AssertionError')))
