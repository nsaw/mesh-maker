# Silk drape workflow (local, Blender)

Drape a sheet over a complete upright 3D figure, then extract the front as a `.mcrelief`
for MeshCraft or an STL for Aspire. The preferred gathered version is now a named preset.
Quartering wind is an optional flag, off by default.

The browser's existing Jolt parity benchmark covers `silk-tilt25` only. These new gathered
and wind controls run in Blender; they have not been ported to the web solver.

## Run the preferred gathered drape

Supply the original SMK Venus de Milo GLB (CC0); it is not included in this repository.
The measured pose file is included.

```bash
python3 scripts/drape/workflow.py venus-de-milo-smk.glb \
  --preset silk-gathered --out out/venus-gathered \
  --azimuth -45 --scale 8 --pose scripts/drape/venus-de-milo-pose.json
```

To test the anatomical-left quartering wind, add:

```bash
--left-quarter-wind 250
```

We compared 0, 250 and 750 at frame 120. All three looked good to the user; a visible improvement
from wind was not established. Strength is a Blender field parameter, not metres per second.
Wind stays at zero through frame 100, ramps to the requested strength at 115 and holds through
150. Animation uses Blender's default keyframe interpolation. Do not compare different frames
and attribute every change to wind.

| Preset | Setup |
|---|---|
| `silk-gathered` | 25° tilt, softer bending, smaller object gap, timed surface attraction; bake 150, read 120 |
| `silk-tilt25` | Original gravity-only crown-pinned Silk setup; bake 120, read 100 |
| `silk-tilt35` | Original setup with 35° tilt |
| `silk-tilt25-cling` | Original setup with constant surface attraction of -100, reach 1 |

Overrides: `--tilt`, `--cling`, `--cling-reach`, `--frames`, `--frame`, `--threads` (default 4).
The gathered attraction keys are fixed at frames 1/45/100/150, with values 0/0/-1000/-1000;
`--cling` changes the last two values. Extending the cache does not retime those keys.

## What we adjusted

| Control | Trials and preferred setting |
|---|---|
| Figure orientation | Measured upright face pose, then 25° versus 35° backward tilt; preferred 25° |
| Bending stiffness | Silk's 0.05 versus 0.0025; preferred 0.0025 |
| Collision clearance | Cloth/object 0.003 and collider outer 0.002 versus 0.001 each; preferred smaller gaps |
| Solver accuracy | Quality 8 → 12, collision quality 4 → 6 in the gathered preset |
| Gathering / global attraction | Surface force strength, reach and ramp/hold timing; preferred -1000 within 0.8 units after gravity establishes folds |
| Air damping | 1 versus a ramp to 5 in longer holding trials; preferred result retains 1 |
| Cloth resolution | 100×160 versus 200×320 quads; preferred 100×160. Fine trial reduced per-vertex mass to conserve total mass |
| Local attraction | Extra cropped face emitter, strength, reach and activation time; more facial detail but an unwanted glued/wrapped appearance |
| Normal pressure | Surface-normal wind over the face; also looked too wrapped |
| Quartering wind | Horizontal from anatomical left/front toward -X/+Y; strength, finite spatial region and timing; optional, not the default |
| Simulation time | Longer holds versus the selected frame; preferred frame 120 of a 150-frame bake |
| Surface fitting | Post-solve Shrinkwrap method, mask and strength; rejected as glued to the face, excluded from this workflow |
| Display subdivision | Two levels after the coarse cloth solve, one in the fine-grid trial; does not add simulated cloth detail |

The recent comparisons held the 5×8 sheet, nine crown pins and Hook attachment, downward gravity,
and tension/compression/shear stiffness of 5 fixed. The preferred mass is Blender Silk's **0.15 kg
per vertex**, not an independently calibrated silk areal density. Earlier sphere-to-figure work
established the sheet size and attachment; they were not variables in the wind comparison.

“Thinner” here means lower bending resistance and smaller collision separation. The simulated
sheet has no Solidify thickness. Transparency was not used to reveal the face. Gathering at the
neck emerges under the declared global attraction; there is no neck drawstring or hidden neck pin.

## How strong a field is

Measured in Blender 5.2.2, not taken from the source: on Silk cloth (quality 12, cell 0.05 units,
mass 0.15), a SURFACE force field of strength 1000 accelerates a vertex at 13.89 units/s², about 1.4 g.
The acceleration grows with the cloth area per vertex and falls with its mass, does not change with
distance inside the reach (falloff power 0 is Blender's default), and a WIND field with wind factor 0
(what `quartering_wind.py` creates) gives the identical push. So the gathered attraction of -1000 pulls
harder than gravity, and wind 250 or 750 is a third to a whole g on the target cloth.

Blender's cloth friction against the figure is an impulse proportional to the cloth's approach speed
(`blenkernel/intern/collision.cc`), so cloth resting under a steady attraction keeps sliding: in the
gathered run the front half of the veil slides into a rope beside the neck.

The gathered veil is still moving fast at frame 120 (0.15 units per frame); frame 150 differs from it
more (veil footprint IoU 0.67) than a different thread count does (0.94).

## Editable wind region

`venus-left-quarter-wind.json` stores the exact five finite panels measured around the preferred
no-wind cloth at frame 120. They emit a single `WIND / SURFACE` field with flow 0, noise 0,
spherical distance falloff, power 2 and reach 0.22 scene units. Panels have no collision modifier
and are hidden from renders; inspect them as wire geometry in Blender.

All panel vertices have X ≥ 0.295; the maximum reach bounds direct loading to X > 0.075.
With the documented pose, +X is anatomical left (viewer right). The calibrated region stops
above the jaw/neck. The connected cloth can transmit motion beyond the region directly loaded.
With wind factor 0 (what `quartering_wind.py` creates) Blender applies the field as a plain force in the
wind direction, not projected onto the cloth normals: a probe blowing along a flat patch moved it along its
own plane. It is a force-field approximation, not fluid simulation.

The profile records the figure filename and placement. Mismatched pose, scale, tilt, head reference
or gathering controls are rejected. Filename matching does not verify asset identity; the actual
input SHA-256 is recorded in each run's `drape.json`. For another face, **measure a new region**,
edit its calibration and pass `--wind-profile PATH.json`. This is not automatic face detection.
The validation checks direction, triangle winding, finite geometry and strictly left-side support.

## Placement, outputs and verification

Z is up, the figure faces -Y and the crown is placed at (0, 0, 1). `--azimuth` rotates about Z;
`--scale` is scene units per source unit (8 for this metre-scale scan); `--pose` applies the measured
3×3 upright rotation; `--head-height` selects the region used for the tilt centre.
`--frame-width` (default 4.2) controls the relief window.

Outputs include an unbaked `setup.blend`, baked `drape.blend` with a preview camera and lights,
`front.png`, `oblique.png`, `face.png`, `relief-preview.png` under opposing lights,
`veiled.mcrelief`, `relief.stl` and `drape.json`. `cloth-nodes.npz` contains unsubdivided solved
vertices at the selected and final frames, plus their preceding frames.

The report records the Blender build, input/preset hashes, thread count, applied cloth/collision
settings, selected-frame force strength, the complete requested profile and maximum one-frame
node motion. A baked cache is not evidence of rest or penetration-free geometry. The approved
frame is still moving; neither the figure/cloth contact nor CNC suitability is certified here.

Relief extraction retains the existing 1201×1601 frontmost figure/cloth samples, mapped linearly
to a 12×16 inch panel with 0.125 inch backing and 0.625 inch relief. It cannot preserve undercuts.
`export_figure.py` separately produces `.mcfig` placement for the web app; it does not export
these new Blender material or force controls.

Requirements: Blender 5.2 (`--blender PATH`), host Python with NumPy and Pillow, Node for STL
(`--no-stl` skips it). Pin Blender build, source, thread count and setup when comparing raw nodes.
The local reproduction study used Blender 5.2.2 LTS and four threads. Fold trajectories can change
with build, threading and setup; repeatability must be checked for each configuration.

Fast configuration and force-volume tests run without Blender, NumPy or Pillow:

```bash
python3 -m unittest discover -s scripts/drape -p 'test_*.py'
```

Source attribution: [SMK Venus de Milo, CC0](https://sketchfab.com/3d-models/venus-de-milo-aphrodite-of-milos-53082b5d6cef4c34a9701a2a24f58075).
