#!/usr/bin/env python3
"""Owned controls: output-grid geometry fails with a converged and a loose membrane."""
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='meshcraft-relief-measurement-') as temp:
    target = Path(temp)
    shutil.copytree(ROOT / 'src', target / 'src')
    (target / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
    shutil.copy2(ROOT / 'package.json', target / 'package.json')
    probe = '''import assert from 'node:assert/strict';
import {DEFAULTS} from './src/state';
import {presetState} from './src/noise/presets';
import {buildNoiseSurface,noiseSurfaceParams} from './src/noise/surface';
const grids=[201,401].map(resolution=>buildNoiseSurface(noiseSurfaceParams({...DEFAULTS,...presetState('relief-pockets'),meshX:24,meshY:24,resolution,seed:5})).vertices);
let sum=0,max=0;
for(let j=0;j<201;j++)for(let i=0;i<201;i++){const e=Math.abs(grids[0][j][i]-grids[1][2*j][2*i]);sum+=e;max=Math.max(max,e);}
process.stdout.write(JSON.stringify({mean:sum/40401,max})+'\\n');
assert(sum/40401<=1.2*.005&&max<=1.2*.03,'production Pockets retained coincidence bounds');
'''
    (target / 'probe.mts').write_text(probe)
    diagnostic = """import assert from 'node:assert/strict';
import {DEFAULTS} from './src/state';
import {buildNoiseSurface,noiseSurfaceParams} from './src/noise/surface';
const result=buildNoiseSurface(noiseSurfaceParams({...DEFAULTS,noiseType:'voronoi-relief',meshX:6,meshY:4,resolution:16,reliefWallWidth:.9,reliefCellSize:1}));
process.stdout.write(result.crestClipStatus+'\\n');
assert.equal(result.crestClipStatus,'narrowed','physical crest diagnostic');
"""
    (target / 'diagnostic.mts').write_text(diagnostic)
    source = target / 'src/noise/voronoi-relief.ts'
    original = source.read_text()
    command = [str(ROOT / 'node_modules/.bin/tsx'), 'probe.mts']
    positive = subprocess.run(command, cwd=target, capture_output=True, text=True, timeout=120)
    if positive.returncode:
        raise AssertionError(positive.stdout + positive.stderr)
    print('Physical geometry positive:', positive.stdout.strip())
    checked = subprocess.run(command[:-1] + ['diagnostic.mts'], cwd=target, capture_output=True, text=True, timeout=120)
    if checked.returncode:
        raise AssertionError(checked.stdout + checked.stderr)
    print('Physical diagnostic positive:', checked.stdout.strip())
    for tolerance in ['1e-10', '1e-4']:
        start = original.index('    // Physical quadrature')
        end = original.index('    if (captureMeasurements)', start)
        # The output grid doubles as the membrane lattice here, as the membrane once was.
        old_grid = """    const measureCols=cols,measureRows=rows;
    const measureBoundary=new Float64Array(rows*cols),measureNearest=null as Float64Array|null,measureRanks=null as Int32Array|null;
    for(let idx=0;idx<rows*cols;idx++){
      const {f1,f2,f3,f4,idx:owner,idx2,idx3,idx4}=nearest(wxArr[idx],wyArr[idx]);
      radiusSum[owner]+=f1;radiusN[owner]++;
      measureBoundary[idx]=boundaryDist(f1,f2,f3,f4,owner,idx2,idx3,idx4,wxArr[idx],wyArr[idx]);
      inradius[owner]=Math.max(inradius[owner],measureBoundary[idx]);
    }
    for(let k=0;k<sites.length;k++)sites[k].radius=radiusN[k]>0?(radiusSum[k]/radiusN[k])*2:p.cellSize;
"""
        mutated = original[:start] + old_grid + original[end:]
        mutated = mutated.replace('const MEMBRANE_TOLERANCE = 1e-10;', 'const MEMBRANE_TOLERANCE = %s;' % tolerance)
        if mutated == original:
            raise AssertionError('Output-grid mutant was not installed')
        source.write_text(mutated)
        result = subprocess.run(command, cwd=target, capture_output=True, text=True, timeout=120)
        if not result.returncode or 'AssertionError' not in result.stderr or 'production Pockets retained coincidence bounds' not in result.stderr:
            raise AssertionError('Output-grid mutation did not fail its intended gate\n' + result.stdout + result.stderr)
        print('Output-grid geometry with membrane tolerance %s rejected:' % tolerance, result.stdout.strip())
        result = subprocess.run(command[:-1] + ['diagnostic.mts'], cwd=target, capture_output=True, text=True, timeout=120)
        if not result.returncode or 'physical crest diagnostic' not in result.stderr or result.stdout.strip() != 'collapsed':
            raise AssertionError('Old coarse-grid diagnostic alias not reproduced\n' + result.stdout + result.stderr)
        print('Old coarse-grid diagnostic alias reproduced:', result.stdout.strip())
