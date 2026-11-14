#!/usr/bin/env python3
"""Rank regressions must reject rounded-distance and blanket lower-ID tie fallbacks."""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='meshcraft-near-tie-mutants-') as temporary:
    destination = Path(temporary)
    shutil.copytree(root / 'src', destination / 'src')
    (destination / 'cli/fixtures').mkdir(parents=True)
    shutil.copy2(root / 'cli/exact-metric-rank-oracle.ts', destination / 'cli/exact-metric-rank-oracle.ts')
    shutil.copy2(root / 'cli/relief-near-ties.spec.ts', destination / 'cli/relief-near-ties.spec.ts')
    (destination / 'scripts').mkdir()
    shutil.copy2(root / 'scripts/test-relief-near-ties.py', destination / 'scripts/test-relief-near-ties.py')
    shutil.copy2(root / 'scripts/test-native-distance-consumers.py', destination / 'scripts/test-native-distance-consumers.py')
    shutil.copytree(root / 'grasshopper/components', destination / 'grasshopper/components')
    for name in ['package.json', 'tsconfig.json']:
        shutil.copy2(root / name, destination / name)
    (destination / 'node_modules').symlink_to(root / 'node_modules')
    module = destination / 'src/noise/metric-order.ts'
    original = module.read_text()
    target = 'const order = exactMetricOrder(sites[index], sites[current], x, y, c, s, scale);'
    assert original.count(target) == 1
    for name, replacement in [('positive', target), ('rounded', 'const order = distance - currentDistance;'), ('lower-id', 'const order = 0;')]:
        module.write_text(original.replace(target, replacement))
        result = subprocess.run([str(root / 'node_modules/.bin/tsx'), 'cli/relief-near-ties.spec.ts'],
                                cwd=destination, capture_output=True, text=True, timeout=30)
        if name == 'positive':
            assert result.returncode == 0, result.stdout + result.stderr
        else:
            assert result.returncode != 0 and 'exact nearest rank fixture' in result.stderr, (name, result.stdout, result.stderr)
        print(name + ': ' + ('passed' if name == 'positive' else 'rejected by independent rank oracle'))
    module.write_text(original)
    native = destination / 'grasshopper/components/voronoi_relief_native.py'
    native_source = native.read_text()
    legacy_slots = native_source
    for slot in range(1, 5):
        target = "best%d = float('inf')" % slot
        assert legacy_slots.count(target) == 1
        legacy_slots = legacy_slots.replace(target, 'best%d = 1.0e30' % slot)
    legacy_cleanup = native_source
    for slot in range(2, 5):
        target = 'if math.isinf(best%d):' % slot
        assert legacy_cleanup.count(target) == 1
        legacy_cleanup = legacy_cleanup.replace(target, 'if best%d >= 1.0e30:' % slot)
    radius_target = 'd3 = math.sqrt(best3)'
    assert native_source.count('jn = 0.0 if math.isinf(d3) else') == 1
    assert native_source.count(radius_target) == 1
    for name, changed, expected in [
            ('native-unfilled-slots', legacy_slots, 'unfilled slot must remain infinite'),
            ('native-finite-cleanup', legacy_cleanup, 'native consuming loop'),
            ('native-third-radius', native_source.replace(radius_target, 'd3 = math.sqrt(best3) if best3 < 1.0e30 else 1.0e15'), 'third radius consumption'),
            ('native-absent-junction', native_source.replace('jn = 0.0 if math.isinf(d3) else', 'jn = 1.0 if math.isinf(d3) else'), 'absent third has no junction')]:
        native.write_text(changed)
        result = subprocess.run([str(root / 'node_modules/.bin/tsx'), 'cli/relief-near-ties.spec.ts'],
                                cwd=destination, capture_output=True, text=True, timeout=30)
        assert result.returncode != 0 and expected in result.stderr, (name, result.stdout, result.stderr)
        print(name + ': rejected by full native consumer regression')
    for name, target, replacement, expected in [
            ('native-lloyd-limit', 'best = lookup.nearest(x, y)', 'best = lookup.nearest(x, y, 1.0e30)', 'actual native Lloyd assignment'),
            ('native-inradius-unfilled', "best = float('inf')", 'best = 1.0e30', 'native inradius consumer'),
            ('native-inradius-cutoff', 'if not math.isinf(best):', 'if best < 1.0e30:', 'native inradius consumer')]:
        assert native_source.count(target) == 1, name
        native.write_text(native_source.replace(target, replacement))
        result = subprocess.run(['python3', 'scripts/test-native-distance-consumers.py'],
                                cwd=destination, capture_output=True, text=True, timeout=30)
        assert result.returncode != 0 and expected in result.stderr, (name, result.stdout, result.stderr)
        print(name + ': rejected by actual native caller/consumer regression')
