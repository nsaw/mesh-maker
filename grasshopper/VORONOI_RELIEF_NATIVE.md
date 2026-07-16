# MeshCraft | Voronoi Relief (native) — Wiring Guide

New GhPython component that generates a Voronoi cell relief using real Rhino
geometry (not a per-pixel distance-field sampler like the web app).

**File**: `components/voronoi_relief_native.py`

---

## Pipeline

```
[Voronoi Relief (native)]   ← new component (replaces DLL Loader for this preset)
   ├─ z_values   ─►  [MeshCraft | Shape]
   ├─ cols       ─►  [MeshCraft | Shape]
   ├─ rows       ─►  [MeshCraft | Shape]
   ├─ mesh_x     ─►  [MeshCraft | Shape]
   ├─ mesh_y     ─►  [MeshCraft | Shape]
   ├─ sites      ─►  (inspection / baking)
   └─ cells      ─►  (bake to Rhino for Brep edit / Aspire)

[MeshCraft | Shape]  →  [MeshCraft | Smooth]  →  [Point Mesh Surface]  →  STL
```

`MeshCraft | Shape`, `Smooth`, and `Point Mesh Surface` stay unchanged — they
just consume the new z-values.

---

## Wire it up (matches the pattern of the other 4 components — paste, don't import)

1. Drop a fresh `GhPython` component on the canvas.
2. Rename inputs (right-click each → Rename) and set type hints:

   | Input             | Type hint | Access |
   |-------------------|-----------|--------|
   | `mesh_x`, `mesh_y` | float    | item   |
   | `resolution`, `relax_iter`, `seed` | int | item |
   | `cell_size`, `jitter`, `attractor_radius`, `density_strength`, `seam_sharpness` | float | item |
   | `base_amp`, `base_freq`, `wall_width`, `density_noise`, `density_noise_freq`, `pillow`, `pillow_coverage`, `depth_variation`, `junction_lift` | float | item |
   | `attractor_pt`    | Point3d   | item   |
   | `profile`, `polarity` | str   | item   |

3. Rename outputs to: `z_values, cols, rows, mesh_x, mesh_y, sites, cells`.
4. Paste the contents of `components/voronoi_relief_native.py` into the component.
5. Wire `z_values, cols, rows, mesh_x, mesh_y` into the matching inputs of
   `MeshCraft | Shape`. Skip the existing `Noise [DLL Loader]` for this preset
   (or branch with a Stream Filter so the same canvas serves both noise modes).

---

## Suggested starting values (matches the reference photo)

```
mesh_x = 24, mesh_y = 48          # panel proportions like the reference (web relief-pockets)
resolution = 128                   # 64×128 grid, ~8K pixels (128 along the longer axis)
cell_size = 5.0                    # matches the retuned web preset's proportions
jitter = 0.6                       # V2: LIVE — randomizes local radius ±30% for size variety
relax_iter = 1                     # tightens cell shapes; bump to 2-4 for very regular cells
attractor_pt = (12, 0, 0)          # bottom-center of panel (dense zone at bottom)
attractor_radius = 20
density_strength = 0.5             # cells shrink ~50% near attractor
seed = 81105
profile = "cosine"                 # round-bottom bowls like the reference
polarity = "pockets"               # cells dip down (the reference look)
seam_sharpness = 0                 # 0 = pure profile; 1 = razor V-groove at ridges
base_amp = 0.7                     # v16 base wave — ridge tops undulate (0 = V1 flat look)
base_freq = 0.05                   # wave cycles per panel inch
wall_width = 0.12                  # finite wall band around every cell boundary
density_noise = 0.9                # giant-vs-small cell patches
density_noise_freq = 0.06          # patch scale (lower = larger patches)
```

On `MeshCraft | Shape`:

- `amplitude` = desired ridge-to-floor range (the Voronoi node already shaped
  the relief; Shape just rescales/positions).
- `peak_exp = valley_exp = noise_exp = 1.0`
- `valley_floor = 0`
- `offset` = wood-surface z (the ridge plane).

---

## Inputs reference

| Input             | Default          | Notes |
|-------------------|------------------|-------|
| `mesh_x, mesh_y`  | 24, 36           | Panel dimensions. |
| `resolution`      | 128              | Grid res along the longer axis. Shorter axis derived to keep square pixels. |
| `cell_size`       | 2.5              | Target avg cell radius; also normalizes profile depth. |
| `jitter`          | 0.85             | LIVE in V2: randomizes local Bridson radius ±30% (cell-size variety). |
| `relax_iter`      | 2                | Lloyd relaxation passes. 0 = wild, 4 = very regular. >6 can wash out attractor density. |
| `attractor_pt`    | None             | Optional Point3d density attractor. Unconnect to disable. |
| `attractor_radius`| 8.0              | Influence radius (panel units). |
| `density_strength`| 0.4              | 0..1 — how aggressively cells shrink near attractor. |
| `seed`            | 12345            | RNG seed. |
| `profile`         | `parabolic-bowl` | `parabolic-bowl` (default), `spherical-cap` (sharpest V), `cone` (sharp at center too), `cosine` (smoothest). |
| `polarity`        | `pockets`        | `pockets` (cells dip down — reference) or `domes` (cells bulge up). |
| `seam_sharpness`  | 0.0              | 0..1 extra V-groove sharpening near ridges. |
| `base_amp`        | 0.0              | v16 base wave amplitude — cells are carved INTO this undulating surface. 0 reproduces V1's flat-base look. |
| `base_freq`       | 0.05             | Base wave spatial frequency (per panel unit). |
| `wall_width`      | 0.0              | 0..0.9 fraction of normalized ridge distance held at base level — finite wall width. Small values (0.08-0.15) are already strong. |
| `density_noise`   | 0.0              | 0..1.5 patchy cell-size noise (giant cells next to small ones). |
| `density_noise_freq` | 0.08          | Patch spatial frequency (lower = larger patches). |
| `pillow`          | 0.0              | 0..1 pillowed floors — past saturation the pocket floor rises into a soft central mound (double-curvature pockets). |
| `pillow_coverage` | 0.6              | Fraction of cells that get pillows (seeded per-cell hash) — the reference mixes pillowed and plain pockets. |
| `depth_variation` | 0.0              | 0..1 per-cell depth tiers (deep/intermediate/shallow-suppressed) + asymmetric wall saturation per cell. High values merge shallow cells into calm surface masses. |
| `junction_lift`   | 0.0              | 0..1 crest lift toward three-way junctions (star-shaped elevated nodes; crests dip at edge midpoints). Also widens the wall band at junctions. |

## Outputs reference

| Output     | Type             | Notes |
|------------|------------------|-------|
| `z_values` | `DataTree[float]`| Normalized [0, 1]. Plugs straight into Shape. |
| `cols`     | int              | Grid cols. |
| `rows`     | int              | Grid rows. |
| `mesh_x`   | float            | Passthrough. |
| `mesh_y`   | float            | Passthrough. |
| `sites`    | `list[Point3d]`  | Post-Lloyd site centers. Bake to inspect distribution. |
| `cells`    | `list[Curve]`    | Voronoi cell boundary curves. Bake for Brep edit / fillet / Aspire. EMPTY when the ghcomp.Voronoi call fails — the height field still generates via the Halton-centroid Lloyd fallback; an empty `cells` output is the signal to inspect the Voronoi node-in-code call on this machine. |

---

## Design choices worth flagging (V2)

1. **Site distribution is Bridson rejection, not jittered grid.** Produces
   tighter, more uniform-looking organic cells like the reference. `jitter`
   randomizes the local radius ±30% for additional size variety.

2. **Profile uses `t = (d2 − d1) / local_min_dist(px, py)`** clamped to
   [0, 1] — per-cell depth normalization. Dense patches (attractor or
   density noise) read proportionally shallower, matching the reference's
   size-to-depth coupling.

3. **ghcomp.Voronoi is called with keyword args and wrapped in try/except.**
   The GH Voronoi component's inputs are (Points, Radius, Boundary, Plane);
   V1's positional `ghcomp.Voronoi(pts, bnd_crv)` bound the boundary curve
   to Radius. If the call fails at runtime, Lloyd relaxation falls back to
   a Halton-sample centroid pass and `cells` outputs [] — the height field
   never depends on ghcomp.

---

## Performance

~24K pixels × ~175 sites = ~4M distance ops per frame. Expect 4–8 sec in
IronPython for the height-field pass.

If too slow at higher resolutions, the kNN-2 inner loop is the obvious target
for a port into `MeshCraftNoise.dll`:

- Add a `Voronoi(...)` method to `MeshCraftNoise.cs` following the existing
  `Shape` / `Smooth` pattern.
- Mirror the Bridson rejection sampler and the kNN-2 brute force in C#.
- The GhPython component becomes a thin DLL loader, same shape as
  `meshcraft.node1.noise.dll-loader.py`.

Profile the GhPython component first via `ghenv.Component.Description` time
deltas; only port if the inner loop is actually the bottleneck.

---

## Test plan once wired

- [ ] Unconnect `attractor_pt` → uniform cells of size ≈ `cell_size`.
- [ ] `base_amp = 0.7` → ridge tops visibly undulate; `base_amp = 0` → V1 flat-base look.
- [ ] `wall_width = 0.12` → walls read as finite flat-ish bands, not knife edges.
- [ ] `density_noise = 0.9` → giant cells next to small-cell patches.
- [ ] `pillow = 0.55` → some pocket floors rise into central mounds (double curvature); `pillow_coverage` varies how many.
- [ ] `cells` output NON-EMPTY → keyword Voronoi call works on this machine (empty ⇒ fallback ran; height field still valid — inspect the ghcomp call).
- [ ] Connect attractor near top of panel → cells visibly smaller/denser near
      attractor, larger toward bottom.
- [ ] Toggle `polarity`: `pockets` carves down, `domes` bulges up.
- [ ] Bake `cells` output → confirm you get real curves editable in Rhino.
- [ ] Confirm `Point Mesh Surface` exports a watertight mesh.
- [ ] Run the STL through Aspire and confirm toolpath generation succeeds.

---

## Reference

Built to match the carved-wood panel reference (Voronoi tessellation with
domed/bowl cell floors and sharp V-grooves between cells). The artist
confirmed his pieces are built in Rhino + Grasshopper with attractor-driven
density and per-cell depth control — which is exactly the architecture this
component implements.
