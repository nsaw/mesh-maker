#!/usr/bin/env python3
"""Restore the signed-coordinate XOR only in an owned copy; the diversity gate must fail."""
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='meshcraft-cellular-mutant-') as temp:
    destination = Path(temp)
    shutil.copytree(ROOT / 'src', destination / 'src')
    (destination / 'cli').mkdir()
    shutil.copy2(ROOT / 'cli/cellular-hash.spec.ts', destination / 'cli/cellular-hash.spec.ts')
    (destination / 'grasshopper/components').mkdir(parents=True)
    shutil.copy2(ROOT / 'grasshopper/components/noise_gen.py', destination / 'grasshopper/components/noise_gen.py')
    for name in ['package.json', 'tsconfig.json']:
        shutil.copy2(ROOT / name, destination / name)
    (destination / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
    path = destination / 'src/noise/generators.ts'
    original = path.read_text()
    command = [str(ROOT / 'node_modules/.bin/tsx'), 'cli/cellular-hash.spec.ts']
    positive = subprocess.run(command, cwd=destination, capture_output=True, text=True, timeout=120)
    if positive.returncode:
        raise AssertionError(positive.stdout + positive.stderr)
    replacement = '''export function cellularSite(x: number, y: number, seed: number, jitter = 1): [number, number] {
  const index = Math.imul(x, 1597334677) ^ Math.imul(y, 3812015801);
  return [x + .5 + (cellHash01(index, seed) - .5) * jitter,
    y + .5 + (cellHash01(index, seed + 1013) - .5) * jitter];
}'''
    mutated, count = re.subn(r'export function cellularSite\([\s\S]*?\n}', replacement, original)
    if count != 1:
        raise AssertionError('Cellular site mutant did not match exactly one function')
    path.write_text(mutated.replace("import { mulberry32 }", "import { mulberry32, cellHash01 }"))
    result = subprocess.run(command, cwd=destination, capture_output=True, text=True, timeout=120)
    if result.returncode == 0 or 'AssertionError' not in result.stderr or 'signed cellular diversity' not in result.stderr:
        raise AssertionError('Restored XOR did not fail its intended diversity assertion\n' + result.stdout + result.stderr)
    print('Positive ordered-coordinate gate passed; restored XOR rejected by signed diversity gate.')
    print(next(line for line in result.stderr.splitlines() if line.startswith('AssertionError')))
