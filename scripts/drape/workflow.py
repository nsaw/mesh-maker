"""Local veil-drape workflow: 3D figure -> Blender silk drape -> front relief -> .mcrelief + STL for Aspire.

    python3 scripts/drape/workflow.py FIGURE.glb --preset silk-tilt25 --out DIR [options]

Presets (one change at a time from the drape accepted on 2026-10-20):
    silk-tilt25        face tipped back 25 deg, Blender Silk preset, crown-pinned, gravity only
    silk-tilt35        the same, 35 deg ("more tilt")
    silk-tilt25-cling  25 deg plus wet cling: an attraction field toward the figure's surface (art convention)
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
import numpy as np

REPO = Path(__file__).resolve().parents[2]
PRESETS = {
    'silk-tilt25': dict(tilt_deg=25.0, cling_strength=0.0, cling_reach=0.0),
    'silk-tilt35': dict(tilt_deg=35.0, cling_strength=0.0, cling_reach=0.0),
    'silk-tilt25-cling': dict(tilt_deg=25.0, cling_strength=-100.0, cling_reach=1.0),
}
IN = 0.0254; BACK, SPAN = 0.125 * IN, 0.625 * IN

def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('figure'); a.add_argument('--preset', choices=sorted(PRESETS), required=True); a.add_argument('--out', required=True)
    a.add_argument('--tilt', type=float); a.add_argument('--cling', type=float); a.add_argument('--cling-reach', type=float)
    a.add_argument('--azimuth', type=float, default=0.0); a.add_argument('--scale', type=float, default=1.0); a.add_argument('--pose')
    a.add_argument('--head-height', type=float, default=2.6); a.add_argument('--frame-width', type=float, default=4.2)
    a.add_argument('--frames', type=int, default=120); a.add_argument('--frame', type=int, default=100)
    a.add_argument('--blender', default='/Applications/Blender.app/Contents/MacOS/Blender'); a.add_argument('--no-stl', action='store_true')
    o = a.parse_args()
    out = Path(o.out).resolve(); out.mkdir(parents=True, exist_ok=True); t0 = time.time()
    p = dict(PRESETS[o.preset])
    if o.tilt is not None: p['tilt_deg'] = o.tilt
    if o.cling is not None: p['cling_strength'] = o.cling
    if o.cling_reach is not None: p['cling_reach'] = o.cling_reach
    if p['cling_strength'] and p['cling_reach'] <= 0: sys.exit('--cling needs a positive --cling-reach')
    args = dict(input=str(Path(o.figure).resolve()), out=str(out), azimuth_deg=o.azimuth, scale=o.scale, head_height=o.head_height,
                pose_rows=json.loads(Path(o.pose).read_text())['rigid_pose_rotation_rows'] if o.pose else None,
                frames=o.frames, frame=o.frame, frame_width=o.frame_width, preset=o.preset, **p)
    r = subprocess.run([o.blender, '-b', '--factory-startup', '--python-exit-code', '1', '--python', str(Path(__file__).with_name('blender_drape.py')),
                        '--', json.dumps(args)], capture_output=True, text=True)
    (out / 'blender.log').write_text(r.stdout + r.stderr)
    if r.returncode != 0 or 'DRAPE_DONE' not in r.stdout:
        sys.exit(f'Blender step failed (exit {r.returncode}); see {out / "blender.log"}')

    # Linear relief: the deepest bare-figure point to the frontmost veil point spans 0.625 in.
    veiled, bare = np.load(out / 'veiled-depth.npy'), np.load(out / 'bare-depth.npy')
    fg = np.isfinite(veiled)
    if not fg.any(): sys.exit('nothing in the relief window: adjust --frame-width or the figure placement')
    lo, hi = float(np.nanmin(bare)), float(np.nanmax(veiled))
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
