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
   | `cell_size`, `jitter`, `attractor_radius`, `density_strength`, `depth`, `seam_sharpness` | float | item |
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
mesh_x = 24, mesh_y = 36          # panel proportions like the reference
resolution = 128                   # 128×192 grid, ~24K pixels
cell_size = 2.2                    # ~11×16 = ~175 cells
jitter = 0.85                      # unused in V1 (Bridson is inherently jittered)
relax_iter = 2                     # tightens cell shapes; bump to 4 for very regular cells
attractor_pt = (12, 30, 0)         # near top-center of panel
attractor_radius = 14
density_strength = 0.55            # cells shrink ~55% near attractor
seed = 81105
depth = 0.4                        # 0.4" carve depth — Shape's `amplitude` rescales this
profile = "parabolic-bowl"         # try "spherical-cap" for sharper V-grooves
polarity = "pockets"               # cells dip down (the reference look)
seam_sharpness = 0.25              # 0 = pure profile; 1 = razor V-groove at ridges
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
| `jitter`          | 0.85             | Reserved for V2 (jittered-grid fallback). Currently unused. |
| `relax_iter`      | 2                | Lloyd relaxation passes. 0 = wild, 4 = very regular. >6 can wash out attractor density. |
| `attractor_pt`    | None             | Optional Point3d density attractor. Unconnect to disable. |
| `attractor_radius`| 8.0              | Influence radius (panel units). |
| `density_strength`| 0.4              | 0..1 — how aggressively cells shrink near attractor. |
| `seed`            | 12345            | RNG seed. |
| `depth`           | 0.4              | Max relief amplitude (further scaled by Shape's `amplitude`). |
| `profile`         | `parabolic-bowl` | `parabolic-bowl` (default), `spherical-cap` (sharpest V), `cone` (sharp at center too), `cosine` (smoothest). |
| `polarity`        | `pockets`        | `pockets` (cells dip down — reference) or `domes` (cells bulge up). |
| `seam_sharpness`  | 0.0              | 0..1 extra V-groove sharpening near ridges. |

## Outputs reference

| Output     | Type             | Notes |
|------------|------------------|-------|
| `z_values` | `DataTree[float]`| Normalized [0, 1]. Plugs straight into Shape. |
| `cols`     | int              | Grid cols. |
| `rows`     | int              | Grid rows. |
| `mesh_x`   | float            | Passthrough. |
| `mesh_y`   | float            | Passthrough. |
| `sites`    | `list[Point3d]`  | Post-Lloyd site centers. Bake to inspect distribution. |
| `cells`    | `list[Curve]`    | Voronoi cell boundary curves. Bake for Brep edit / fillet / Aspire. |

---

## Two design choices worth flagging

1. **Site distribution is Bridson rejection, not jittered grid.** Produces
   tighter, more uniform-looking organic cells like the reference. The
   `jitter` input is wired but unused in V1 — kept so a jittered-grid
   fallback can be added without breaking the component signature.

2. **Profile uses `t = (d2 − d1) / cell_size`** clamped to [0, 1]. Cells
   smaller than `cell_size` (the dense ones near the attractor) never reach
   `t = 1`, so they're proportionally shallower — which matches the
   reference where dense regions read as finer, lighter texture.

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
