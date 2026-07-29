<!-- Captured from the Greptile knowledge base 2026-07-29. Greptile generated this from the
codebase and grounded its review findings in it; it is not hand-authored SOT.
Verify against live code before citing it as authoritative. -->

# Grasshopper Integration

The `grasshopper/` directory ports the web app's mesh-generation math into native Rhino/Grasshopper components so a designer can build panels inside CAD without leaving Rhino. `grasshopper/builder/meshcraft_builder.py` is a GHPython bootstrap script that programmatically constructs a four-component Grasshopper graph (Noise, Shape, Smooth, Presets) by embedding each component's full source as a string and injecting it into a `GH_Document` via the RhinoCommon/Grasshopper SDK. The embedded scripts are line-for-line IronPython 2.7 ports of the TypeScript noise generators (`src/noise/*`) and mesh shaping pipeline (`mesh.ts`), including a from-scratch Voronoi-relief sampler that must stay numerically identical to `src/noise/voronoi-relief.ts`.

## Mental model

| Stage | Grasshopper component | TS counterpart | Key output |
|---|---|---|---|
| Bootstrap | `meshcraft_builder.py` (GHPython, run once) | n/a | builds & saves `.gh` file |
| Noise | embedded `NOISE_SCRIPT` → "MeshCraft \| Noise" | `src/noise/*.ts`, `voronoi-relief.ts` | `z_values`, `cols`, `rows` |
| Shape | embedded `SHAPE_SCRIPT` → "MeshCraft \| Shape" | `mesh.ts` `generateNoiseMesh` (lines ~47-65) | `pts` (Point3d grid) |
| Smooth | embedded `SMOOTH_SCRIPT` → "MeshCraft \| Smooth" | `mesh.ts` `weightedSmooth` (lines ~153-174) | smoothed `pts` |
| Presets | embedded `PRESETS_SCRIPT` → "MeshCraft \| Presets" | web app preset table | slider-override outputs |

## The builder: generating a `.gh` file from Python

`meshcraft_builder.py` runs inside a GHPython component in Rhino 7 (IronPython 2.7). Triggered by a `run` boolean toggle, it loads `Grasshopper`/`GhPython` assemblies via `clr.AddReference`, creates a `Grasshopper.Kernel.GH_Document`, and uses `ZuiPythonComponent` (`make_ghpy`) to instantiate four script components, each with its `Code` property set to one of the embedded triple-quoted scripts (`NOISE_SCRIPT`, `SHAPE_SCRIPT`, `SMOOTH_SCRIPT`, `PRESETS_SCRIPT`). It adds matching input/output parameters (`add_in`/`add_out`), lays down number sliders and value lists (`fslider`, `islider`, `vlist`) for every tunable parameter, wires sliders to component inputs and components to each other (`AddSource`), then calls `GH_DocumentIO.SaveQuiet` to write the resulting `.gh` file (defaulting to `~/Desktop/meshcraft.gh`). It maintains a `_log` and always assigns debug output to `a` — GHPython's output pin must never be left unset — with the whole body wrapped in one `try/except` so failures surface as checkpoint text in a connected Panel instead of Rhino's opaque error dialog. `grasshopper/mesh-maker.gh` and `grasshopper/builder/meshcraft_builder.gh` are checked-in Grasshopper documents this script (or manual assembly) produces; `test_ghpy_output.py` is a standalone diagnostic (not part of the pipeline) probing whether `ZuiPythonComponent`, `Code` assignment, and `CreateParameter` work in a given Rhino/GhPython install.

## Component responsibilities

**Noise** (`NOISE_SCRIPT`, embedded at meshcraft_builder.py:67, standalone copy `grasshopper/components/noise_gen.py`) implements sixteen generators as small classes (Simplex, Perlin, Value, OpenSimplex2, Ridged, Billow, FBM, Turbulence, HybridMultifractal, HeteroTerrain, DomainWarp, Voronoi, Worley, Gabor, Wavelet, VoronoiRelief), selected via the `_NOISE_MAP` factory keyed by `noise_type`. The fifteen "classic" types walk a `cols × rows` grid applying domain warp and octave/`fbm` summation identically to the TS implementations, emitting `z_values` plus `cols`/`rows`/`mesh_x`/`mesh_y` passthroughs.

`voronoi-relief` is a special case (`is_relief` branch) needing the whole grid at once: `VoronoiReliefNoise.sample_grid` generates jittered sites (`_gen_sites`), optionally Lloyd-relaxes them (`_lloyd_relax`, Halton samples), computes per-site mean-F1 radius in Pass 1, blurs it into a continuous radius field on a coarse grid and bilinear-interpolates to full resolution in Pass 1.5 (a perf optimization avoiding O(cols·rows·sites) blowup, mirroring `src/noise/voronoi-relief.ts`), then in Pass 2 computes dome/pocket height, seam smoothstep transitions, attractor masks (vertical/horizontal/radial/point), optional wave-base blending, and void mode, clamping output to `±OUTPUT_HEIGHT_CLAMP`. Its PRNG (`_rand`) is mulberry32, chosen to be bit-for-bit compatible with the TS sampler so the same seed reproduces the same site layout in both environments — an earlier `sin()`-based PRNG had drifted from the TS sequence. `relief_*` inputs use `_relief_default` to distinguish a missing pin (`KeyError`, older compiled component) from an unwired one (`None`), both falling back to documented defaults so missing wiring never reaches `float(None)`.

**Shape** (`SHAPE_SCRIPT`, at meshcraft_builder.py:826, standalone `grasshopper/components/shape_pts.py`) converts flat `z_values` into a `Point3d` grid, applying contrast, sharpness (sign-preserving power curve), noise exponent, separate peak/valley exponents, and valley-floor softening — explicitly documented as a port of `mesh.ts` lines 47-65.

**Smooth** (`SMOOTH_SCRIPT`, at meshcraft_builder.py:897, standalone `grasshopper/components/smoother.py`) is a direct port of `weightedSmooth()` from `mesh.ts:153-174`: a 3x3 weighted-average kernel (center=4, cardinal=2, diagonal=1) applied `smooth_iter` times at `smooth_str` blend strength, operating on decomposed X/Y/Z arrays for speed.

**Presets** (`PRESETS_SCRIPT`, at meshcraft_builder.py:950, standalone `grasshopper/components/presets.py`) is a static dictionary of named parameter bundles (`gentle-waves`, `organic-terrain`, ... `relief-vertical`, `relief-radial`, `relief-pockets`) whose outputs are meant to be manually rewired over the sliders on Noise/Shape/Smooth. The three `relief-*` presets carry the full `relief_*` key set and were tuned iteratively (see Risks) to match a physical reference panel ("lafabrica").

## Coupling

If `src/noise/voronoi-relief.ts` changes any constant, formula, or default (e.g. `RADIUS_FIELD_SIGMA_CELLS`, seam-width floor logic, `warpFreq` default), update it in lockstep in both the embedded `NOISE_SCRIPT` inside `meshcraft_builder.py` and the standalone `grasshopper/components/noise_gen.py` copy — the two are meant to be byte-identical (both files' comments say so), so editing one without the other silently reintroduces parity drift.

A new `relief_*` parameter on the TS sampler must be added to all of: the `_relief_default` calls in `NOISE_SCRIPT`, the `RELIEF_INPUTS` list in `meshcraft_builder.py` (drives both Noise input pins and Presets output pins), and the `relief_*` preset dicts in `PRESETS_SCRIPT`/`presets.py` — missing any one leaves that pin permanently defaulted with no way to wire it from Presets.

Changes to `mesh.ts`'s `generateNoiseMesh` shaping order or `weightedSmooth` kernel weights require matching edits in `SHAPE_SCRIPT`/`shape_pts.py` or `SMOOTH_SCRIPT`/`smoother.py` — both cite explicit TS line numbers that go stale otherwise.

`noise_type` and preset names are matched by string key (`_NOISE_MAP`, `PRESETS` dict); renaming one in the TS/web app without updating both Python copies breaks the Grasshopper equivalent silently, falling back to `'simplex'`/`'gentle-waves'` rather than erroring.

## Risks

The relief sampler's git history shows a long fix-of-fix chain — sawtooth seam artifacts, void-mode plateaus, F1 tearing, and PRNG drift were each fixed and re-fixed across multiple commits (`c40c67b`, `b6e47c7`, `5d838d0`, `5884f2b`, and PR #14 round-1 through round-6). Any change to seam-width, radius-field, or attractor-mask math is high-risk for reintroducing one of these artifacts, and should be checked against both the coarse-grid performance path and the full-resolution path.

The `relief-pockets` preset was tuned through several commits (`fe420b7`, `1adc503`, `cd0d42c`) purely by visual comparison against a reference photo; its numeric values are not derivable from first principles, so changing shared constants they depend on (radius field, cell-size gradient) can silently make it look wrong — there is no automated visual regression check.

`make_ghpy` swallows `Code`-setter failures into the debug log rather than raising, so an IronPython/GhPython API change (e.g. `ZuiPythonComponent.Code` made read-only) would silently produce a `.gh` file with components that have no executable code, surfacing only as buried "WARNING" text in the `a` output panel.

## Change checklist

When these files or sections are changed, remember to consider these:

- Any edit to `src/noise/voronoi-relief.ts` (constants, formulas, parameter defaults) must be mirrored in both `grasshopper/builder/meshcraft_builder.py`'s embedded `NOISE_SCRIPT` and the standalone `grasshopper/components/noise_gen.py` — check the PRNG (`mulberry32`), radius-field constants, and seam-width floor logic first since these are the most fragility-prone.
- A new `relief_*` parameter needs updates in four places: `_relief_default` calls, the `RELIEF_INPUTS` list, the relief preset dicts in `PRESETS_SCRIPT`, and `grasshopper/components/presets.py`.
- Changes to `mesh.ts` `generateNoiseMesh` or `weightedSmooth` require matching edits in `SHAPE_SCRIPT`/`shape_pts.py` or `SMOOTH_SCRIPT`/`smoother.py` — both cite explicit TS line numbers that should be re-verified.
- Adding/renaming a noise type or preset key in the web app requires a matching update to `_NOISE_MAP` and/or `PRESETS` in the Python components, or Grasshopper silently falls back to a default rather than failing.
- If `ZuiPythonComponent`'s API changes in a future Rhino/GhPython release, re-check `make_ghpy`'s `Code` setter and parameter-creation calls in `meshcraft_builder.py`.

## Important failure modes

| Trigger | Consequence | Guard |
|---|---|---|
| TS voronoi-relief math changes without updating both Python copies | Grasshopper relief output diverges visually/numerically from the web app for the same seed/params | Manual parity review only — no automated cross-language test exists |
| New `relief_*` param added to only some of the four propagation points | Pin silently stuck at hardcoded default; user wiring has no effect | `_relief_default`'s KeyError/None fallback masks the gap instead of erroring |
| `run` toggle left False or `save_path` unwired | Builder exits early or writes to default `~/Desktop/meshcraft.gh` unexpectedly | `a` output reports "run is falsy..." or the resolved path; must connect a Panel to see it |
| `ZuiPythonComponent.Code` setter fails (Rhino/GhPython version mismatch) | `.gh` file saves successfully but components contain no executable script | Failure is only logged into `a`, not raised — must inspect Panel text |
| Malformed/extreme relief params (huge density_strength, tiny cell_size) | Site count or per-pixel loop blows up compute time | `SITE_COUNT_MAX` (4096) and coarse-grid Rfield cap runtime |

## Key files

| File | Why to read it |
|---|---|
| `grasshopper/builder/meshcraft_builder.py` | The bootstrap script; embeds and wires all four components programmatically |
| `grasshopper/builder/test_ghpy_output.py` | Standalone diagnostic for GhPython/`ZuiPythonComponent` API availability, not part of the runtime pipeline |
| `grasshopper/components/noise_gen.py` | Standalone copy of the Noise component, including `VoronoiReliefNoise` — must stay in sync with the embedded copy |
| `grasshopper/components/shape_pts.py` | Standalone copy of the Shape component (port of `mesh.ts` shaping) |
| `grasshopper/components/smoother.py` | Standalone copy of the Smooth component (port of `weightedSmooth`) |
| `grasshopper/components/presets.py` | Standalone copy of the Presets component, including the three `relief-*` presets |
| `grasshopper/mesh-maker.gh` | Checked-in Grasshopper document produced by/compatible with the builder |
| `grasshopper/builder/meshcraft_builder.gh` | Companion `.gh` document for the builder component itself |
| `src/noise/voronoi-relief.ts` | Canonical TS source of truth the relief sampler must mirror byte-for-byte in behavior |
