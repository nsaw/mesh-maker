# Silk drape workflow (local, Blender)

Drapes a silk veil over a complete 3D figure in Blender and turns the front view into a CNC relief:
a `.mcrelief` for MeshCraft and an STL for Aspire. This is the proof the web Drape tab reproduces
(`src/drape-sim`, parity checked by `npm run test:drape-parity`).

## Run

```bash
python3 scripts/drape/workflow.py FIGURE.glb --preset silk-tilt25 --out OUT_DIR \
  [--azimuth DEG] [--scale UNITS_PER_SOURCE_UNIT] [--pose POSE.json] [--tilt DEG] [--cling STRENGTH --cling-reach UNITS]
```

| Preset | What changes |
|---|---|
| `silk-tilt25` | face tipped back 25 deg, Blender Silk preset, hung from the crown, gravity only (the accepted look) |
| `silk-tilt35` | the same with 35 deg of tilt: the silk lies further onto the face |
| `silk-tilt25-cling` | 25 deg plus wet cling: an attraction field toward the figure's surface within `--cling-reach` (an art convention, not cloth physics) |

The bundled Venus de Milo (SMK scan, CC0, from `https://sketchfab.com/3d-models/venus-de-milo-aphrodite-of-milos-53082b5d6cef4c34a9701a2a24f58075`):

```bash
python3 scripts/drape/workflow.py venus-de-milo-smk.glb --preset silk-tilt25 --out out/venus-25 \
  --azimuth -45 --scale 8 --pose scripts/drape/venus-de-milo-pose.json
```

`OUT_DIR` gets `drape.blend` (open it to inspect or re-bake), `front.png`, `oblique.png`,
`relief-preview.png` (both raking lights), `veiled.mcrelief` (MeshCraft Depth Map tab),
`relief.stl` (Aspire) and `drape.json` (every setting as Blender applied it).

## Placement

The drape assumes Z up, the face toward -Y (the camera) and roughly 2.4 scene units for a life-size
head. `--azimuth` turns the figure about Z, `--scale` sets scene units per source unit (8 for a
model in metres), and `--pose` applies a measured 3x3 rotation that makes the face vertical
(`venus-de-milo-pose.json` was measured from eye, brow and chin landmarks).

`export_figure.py` writes the same placement as a `.mcfig`, the figure format the web Drape tab
loads (the bundled `public/demo/venus-de-milo.mcfig` came from it, cropped below z = -9).

## Requirements and repeatability

Blender 5.2 (`--blender PATH`), Python 3 with NumPy and Pillow, Node for the STL step (`--no-stl`
skips it). Results repeat exactly at a fixed Blender build and thread count; the cloth's fold positions can
change with thread count and setup order, so compare drapes by footprint, envelope and fold scale,
not node by node.
