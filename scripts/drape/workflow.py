"""Local veil-drape workflow: 3D figure -> Blender silk drape -> front relief -> .mcrelief + STL for Aspire.

    python3 scripts/drape/workflow.py FIGURE.glb --preset silk-tilt25 --out DIR [options]

Presets (one change at a time from the drape accepted on 2026-10-20):
    silk-gathered      softer bending, smaller gap, timed gathering; bake 150, read 120, wind off
    silk-tilt25        face tipped back 25 deg, Blender Silk preset, crown-pinned, gravity only
    silk-tilt35        the same, 35 deg ("more tilt")
    silk-tilt25-cling  25 deg plus wet cling: an attraction field toward the figure's surface (art convention)
Optional --left-quarter-wind STRENGTH adds the calibrated anatomical-left field (tested 250, 750).
Options override a preset: --tilt DEG, --cling STRENGTH (negative attracts), --cling-reach UNITS.
Figure placement: --azimuth DEG (turn about Z so the face looks toward -Y), --scale (scene units per source
unit; pick it so the head is about 2.4 units tall), --pose JSON (measured 3x3 'rigid_pose_rotation_rows'
that makes the face vertical, e.g. scripts/drape/venus-de-milo-pose.json), --head-height UNITS.
Relief: a 12 x 16 in panel, 1201 x 1601 samples, linear mapping of 0.125 in backing + 0.625 in relief
(the accepted Monti mapping). --frame-width UNITS sets how much of the figure the panel spans.

Writes DIR/drape.blend (open it in Blender to inspect or re-bake), front.png, oblique.png, drape.json,
relief-preview.png, veiled.mcrelief (open in MeshCraft's Depth Map tab), and relief.stl (for Aspire)
unless --no-stl. Needs Blender 5.2 (--blender PATH), Python 3 with numpy and Pillow, and Node for the STL.
"""
import argparse, json, subprocess, sys, time
from pathlib import Path
from quartering_wind import finite, validate_profile

REPO = Path(__file__).resolve().parents[2]
PRESETS = {
    'silk-gathered': dict(tilt_deg=25.0, cling_strength=-1000.0, cling_reach=0.8),
    'silk-tilt25': dict(tilt_deg=25.0, cling_strength=0.0, cling_reach=0.0),
    'silk-tilt35': dict(tilt_deg=35.0, cling_strength=0.0, cling_reach=0.0),
    'silk-tilt25-cling': dict(tilt_deg=25.0, cling_strength=-100.0, cling_reach=1.0),
}
IN = 0.0254; BACK, SPAN = 0.125 * IN, 0.625 * IN

def parse_args(argv=None):
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('figure'); a.add_argument('--preset', choices=sorted(PRESETS), required=True); a.add_argument('--out', required=True)
    a.add_argument('--tilt', type=float); a.add_argument('--cling', type=float); a.add_argument('--cling-reach', type=float)
    a.add_argument('--azimuth', type=float, default=0.0); a.add_argument('--scale', type=float, default=1.0); a.add_argument('--pose')
    a.add_argument('--head-height', type=float, default=2.6); a.add_argument('--frame-width', type=float, default=4.2)
    a.add_argument('--frames', type=int); a.add_argument('--frame', type=int)
    a.add_argument('--threads', type=int, default=4)
    a.add_argument('--left-quarter-wind', type=float, default=0.0, metavar='STRENGTH', help='Opt-in local wind, calibrated on silk-gathered (tested: 250, 750)')
    a.add_argument('--wind-profile', help='Editable force-volume JSON; default is the measured Venus region')
    a.add_argument('--blender', default='/Applications/Blender.app/Contents/MacOS/Blender'); a.add_argument('--no-stl', action='store_true')
    return a.parse_args(argv)

def build_config(o):
    out = Path(o.out).resolve()
    p = dict(PRESETS[o.preset])
    if o.tilt is not None: p['tilt_deg'] = o.tilt
    if o.cling is not None: p['cling_strength'] = o.cling
    if o.cling_reach is not None: p['cling_reach'] = o.cling_reach
    if p['cling_strength'] and p['cling_reach'] <= 0: raise ValueError('--cling needs a positive --cling-reach')
    pose_rows = None
    if o.pose:
        pose_data = json.loads(Path(o.pose).read_text())
        if not isinstance(pose_data, dict) or 'rigid_pose_rotation_rows' not in pose_data:
            raise ValueError('pose JSON must contain rigid_pose_rotation_rows')
        pose_rows = pose_data['rigid_pose_rotation_rows']
    args = dict(input=str(Path(o.figure).resolve()), out=str(out), azimuth_deg=o.azimuth, scale=o.scale, head_height=o.head_height,
                pose_rows=pose_rows,
                frames=o.frames if o.frames is not None else (150 if o.preset == 'silk-gathered' else 120),
                frame=o.frame if o.frame is not None else (120 if o.preset == 'silk-gathered' else 100),
                frame_width=o.frame_width, threads=o.threads, preset=o.preset, **p)
    for key in ('azimuth_deg', 'scale', 'head_height', 'frame_width', 'tilt_deg', 'cling_strength', 'cling_reach'):
        if not finite(args[key]): raise ValueError(f'{key} must be finite')
    for key in ('scale', 'head_height', 'frame_width'):
        if args[key] <= 0: raise ValueError(f'{key} must be positive')
    if args['cling_reach'] < 0: raise ValueError('cling reach cannot be negative')
    if not 2 <= args['frame'] <= args['frames']: raise ValueError('require 2 <= frame <= frames')
    if not 1 <= o.threads <= 64: raise ValueError('threads must be between 1 and 64')
    pose = args['pose_rows']
    if pose is not None and (not isinstance(pose, list) or len(pose) != 3 or any(not isinstance(row, list) or len(row) != 3 or not all(map(finite, row)) for row in pose)):
        raise ValueError('pose must be a finite 3x3 matrix')
    if not finite(o.left_quarter_wind) or o.left_quarter_wind < 0:
        raise ValueError('left-quarter-wind must be finite and nonnegative')
    if o.wind_profile and not o.left_quarter_wind: raise ValueError('--wind-profile requires positive --left-quarter-wind')
    args['quartering_wind'] = None
    if o.left_quarter_wind:
        if o.preset != 'silk-gathered': raise ValueError('left-quarter-wind is calibrated only for silk-gathered')
        if args['frame'] <= 100 or args['frames'] < 150: raise ValueError('wind requires frame > 100 and frames >= 150')
        path = Path(o.wind_profile) if o.wind_profile else Path(__file__).with_name('venus-left-quarter-wind.json')
        profile = json.loads(path.read_text())
        validate_profile(profile, args)
        args['quartering_wind'] = dict(strength=o.left_quarter_wind, profile=profile)
    return args

def main():
    import numpy as np
    o = parse_args()
    try:
        args = build_config(o)
    except (ValueError, KeyError, OSError) as error:
        sys.exit(str(error))
    if not Path(args['input']).is_file(): sys.exit('figure file does not exist')
    out = Path(args['out']); out.mkdir(parents=True, exist_ok=True); t0 = time.time()
    (out / 'run-config.json').write_text(json.dumps(args, indent=2) + '\n')
    r = subprocess.run([o.blender, '-b', '--threads', str(o.threads), '--factory-startup', '--python-exit-code', '1', '--python', str(Path(__file__).with_name('blender_drape.py')),
                        '--', json.dumps(args)], capture_output=True, text=True)
    (out / 'blender.log').write_text(r.stdout + r.stderr)
    if r.returncode != 0 or 'DRAPE_DONE' not in r.stdout:
        sys.exit(f'Blender step failed (exit {r.returncode}); see {out / "blender.log"}')

    # Linear relief: the deepest visible point (figure or veil) to the frontmost point spans 0.625 in,
    # so veil hanging behind the figure never maps below the 0.125 in backing (or below 0).
    veiled, bare = np.load(out / 'veiled-depth.npy'), np.load(out / 'bare-depth.npy')
    fg = np.isfinite(veiled)
    if not fg.any(): sys.exit('nothing in the relief window: adjust --frame-width or the figure placement')
    lo, hi = float(np.nanmin(np.fmin(bare, veiled))), float(np.nanmax(veiled))
    if not hi > lo: sys.exit(f'degenerate depth range ({lo} to {hi}): check the figure placement')
    h = np.where(fg, BACK + SPAN * (veiled - lo) / (hi - lo), BACK).astype(np.float32)
    np.save(out / 'veiled-height-m.npy', h); np.save(out / 'mask.npy', fg)
    W, H = 12 * IN, 16 * IN
    subprocess.run([sys.executable, str(REPO / 'scripts/relief/npy_to_mcrelief.py'), str(out / 'veiled-height-m.npy'), str(out / 'veiled.mcrelief'),
                    '--units', 'm', '--width', repr(W), '--height', repr(H), '--backing', repr(BACK), '--stock', repr(BACK + SPAN),
                    '--row-order', 'top-down', '--triangulation', 'tr-bl', '--mask', str(out / 'mask.npy'),
                    '--name', f'Silk veil drape ({o.preset}) on {Path(o.figure).name}', '--source', f'scripts/drape/workflow.py, Blender silk drape of {Path(o.figure).name}'],
                   check=True, capture_output=True)
    preview(h, out / 'relief-preview.png')
    if not o.no_stl:
        s = subprocess.run(['npm', 'run', '--silent', 'relief-roundtrip', '--', str(out / 'veiled.mcrelief'), '--out', str(out)], cwd=REPO, capture_output=True, text=True)
        if s.returncode != 0: sys.exit(f'STL export failed: {s.stderr.strip()[-400:]}')
    meta = json.loads((out / 'drape.json').read_text())
    meta['relief'] = dict(panel_in=[12, 16], backing_in=0.125, relief_in=0.625, depth_range_units=[lo, hi],
                          depth_compression_vs_xy=((hi - lo) / 0.625) / (o.frame_width / 12), stl=None if o.no_stl else str(out / 'relief.stl'))
    meta['total_seconds'] = round(time.time() - t0, 1)
    (out / 'drape.json').write_text(json.dumps(meta, indent=1))
    print(json.dumps(dict(out=str(out), preset=o.preset, seconds=meta['total_seconds'], mcrelief=str(out / 'veiled.mcrelief'),
                          stl=meta['relief']['stl'])))

def preview(h, path):
    import numpy as np
    from PIL import Image, ImageDraw
    z = h / IN; dx = 12 / (h.shape[1] - 1); zx = np.gradient(z, dx, axis=1); zy = -np.gradient(z, dx, axis=0); n = np.sqrt(zx ** 2 + zy ** 2 + 1)
    tiles = []
    for L in ((-0.55, 0.45, 0.7), (0.55, -0.45, 0.7)):     # same light as cli/relief-roundtrip.ts, then its opposite
        L = np.array(L); tiles.append(Image.fromarray((np.clip((-zx * L[0] - zy * L[1] + L[2]) / (n * np.linalg.norm(L)), 0, 1) * 255).astype(np.uint8)).resize((600, 800)))
    img = Image.new('RGB', (1236, 830), (20, 22, 26)); d = ImageDraw.Draw(img)
    for k, (t, lab) in enumerate(zip(tiles, ('key light upper-left', 'opposite light'))):
        img.paste(t.convert('RGB'), (12 + k * 612, 26)); d.text((12 + k * 612, 6), lab, fill=(230, 230, 230))
    img.save(path)

if __name__ == '__main__':
    main()
