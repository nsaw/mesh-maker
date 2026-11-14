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
| Smooth | embedded `SMOOTH_SCRIPT` → "MeshCraft \| Smooth" | `src/geometry.ts` `gaussianSmooth` | smoothed `pts` |
| Presets | embedded `PRESETS_SCRIPT` → "MeshCraft \| Presets" | web app preset table | slider-override outputs |

## The builder: generating a `.gh` file from Python

`meshcraft_builder.py` runs inside a GHPython component in Rhino 7 (IronPython 2.7). Triggered by a `run` boolean toggle, it loads `Grasshopper`/`GhPython` assemblies via `clr.AddReference`, creates a `Grasshopper.Kernel.GH_Document`, and uses `ZuiPythonComponent` (`make_ghpy`) to instantiate four script components, each with its `Code` property set to one of the embedded triple-quoted scripts (`NOISE_SCRIPT`, `SHAPE_SCRIPT`, `SMOOTH_SCRIPT`, `PRESETS_SCRIPT`). It adds matching input/output parameters (`add_in`/`add_out`), lays down number sliders and value lists (`fslider`, `islider`, `vlist`) for every tunable parameter, wires sliders to component inputs and components to each other (`AddSource`), then calls `GH_DocumentIO.SaveQuiet` to write the resulting `.gh` file (defaulting to `~/Desktop/meshcraft.gh`). It maintains a `_log` and always assigns debug output to `a` — GHPython's output pin must never be left unset — with the whole body wrapped in one `try/except` so failures surface as checkpoint text in a connected Panel instead of Rhino's opaque error dialog. The historical `mesh-maker.gh` and `meshcraft_builder.gh` artifacts live outside this repository in `/Users/sawyer/Code/sawyer-design/rhino-aspire-grasshopper/rhino/grasshopper/meshcraft-repo/`; the Python builder and components remain Git-tracked here. The migration receipt is in the studio library and the artifact README describes regeneration. Input changes require deliberate regeneration and a receipt. Existing native definitions do not update when source changes; `test_ghpy_output.py` is a standalone diagnostic (not part of the pipeline) probing whether `ZuiPythonComponent`, `Code` assignment, and `CreateParameter` work in a given Rhino/GhPython install.

## Component responsibilities

**Noise** (`NOISE_SCRIPT`, embedded at meshcraft_builder.py:67, standalone copy `grasshopper/components/noise_gen.py`) implements sixteen generators as small classes (Simplex, Perlin, Value, OpenSimplex2, Ridged, Billow, FBM, Turbulence, HybridMultifractal, HeteroTerrain, DomainWarp, Voronoi, Worley, Gabor, Wavelet, VoronoiRelief), selected via the `_NOISE_MAP` factory keyed by `noise_type`. The fifteen "classic" types walk a `cols × rows` grid applying domain warp and octave/`fbm` summation identically to the TS implementations, emitting `z_values` plus `cols`/`rows`/`mesh_x`/`mesh_y` passthroughs.

`voronoi-relief` is a grid-aware special case. `VoronoiReliefNoise.sample_grid` enumerates Cartesian and polar candidates before one global representative selection at the site cap. Selection preserves each focal nucleus and the original order, leaving Cartesian sites as a prefix and pinned polar sites as a suffix. No cohort has first claim on the cap. It optionally Lloyd-relaxes Cartesian sites using Halton samples proportional to retained site count. The height passes measure cell radii/inradii and construct crest, wall and floor profiles using shared-boundary distances. Cell, crest, junction and crown contributions share the depth-aware slope budget; a base wave, attractor shaping, cushions and void mode compose the result. Its mulberry32 PRNG preserves the site-selection sequence across the language ports. Missing and unwired `relief_*` inputs use documented defaults. `relief_cut_depth_in` supplies the requested physical cut depth for the slope budget.

**Shape** (`SHAPE_SCRIPT`, at meshcraft_builder.py:826, standalone `grasshopper/components/shape_pts.py`) converts flat `z_values` into a `Point3d` grid, applying contrast, sharpness (sign-preserving power curve), noise exponent, separate peak/valley exponents, and valley-floor softening — explicitly documented as a port of `mesh.ts` lines 47-65.

Shape retains its signed noise-times-amplitude-plus-offset mapping. It does not implement the web stock/backing model. Sampler, depth-budget and Gaussian checks therefore do not certify matching physical Z values between the native and web pipelines.

**Smooth** (`SMOOTH_SCRIPT`, standalone `grasshopper/components/smoother.py`) accepts `smooth_radius_in`, a Gaussian sigma in inches. It derives independent X/Y pitches from the point grid, applies separable three-sigma kernels, and renormalizes truncated kernels with half-weight physical endpoints. Kernels with more than 32 weights use a zero-padded FFT; smaller kernels use direct summation. Exactly constant heights remain unchanged. `npm run test:gh-parity` compares all four embedded scripts with their canonical files and numerically compares this Gaussian with the TypeScript implementation at edges and unequal pitches. The same suite compares global capped-site selection and ordered coordinates against a Python class host for the committed fixtures. Neither numerical host replaces Rhino serialization/runtime checks.

**Presets** (`PRESETS_SCRIPT`, at meshcraft_builder.py:950, standalone `grasshopper/components/presets.py`) is a static dictionary of named parameter bundles (`gentle-waves`, `organic-terrain`, ... `relief-vertical`, `relief-radial`, `relief-pockets`) whose outputs are meant to be manually rewired over the sliders on Noise/Shape/Smooth. The relief preset dictionaries mirror the web values, with web-only stock thickness excluded. The parity suite compares TypeScript values against the Python dictionary as well as the two Python source copies.

Input changes require a Rhino 7 builder smoke test and a preset solve after save/reopen. The Presets component supplies `gabor_angle`, `gabor_bw`, `smooth_radius_in` and `relief_cut_depth_in`. Text/value parity cannot establish that a saved definition has these pins.

## Coupling

If `src/noise/voronoi-relief.ts` changes any constant, formula, or default (e.g. `LLOYD_SAMPLES_PER_SITE`, crest-band clipping, `warpFreq` default), update it in lockstep in both the embedded `NOISE_SCRIPT` inside `meshcraft_builder.py` and the standalone `grasshopper/components/noise_gen.py` copy — the two are meant to be byte-identical (both files' comments say so), so editing one without the other silently reintroduces parity drift.

A new `relief_*` parameter on the TS sampler must be added to all of: the `_relief_default` calls in `NOISE_SCRIPT`, the `RELIEF_INPUTS` list in `meshcraft_builder.py` (drives both Noise input pins and Presets output pins), and the `relief_*` preset dicts in `PRESETS_SCRIPT`/`presets.py` — missing any one leaves that pin permanently defaulted with no way to wire it from Presets.

Changes to `mesh.ts`'s `generateNoiseMesh` shaping order or `gaussianSmooth` physical kernel require matching edits in `SHAPE_SCRIPT`/`shape_pts.py` or `SMOOTH_SCRIPT`/`smoother.py` — both cite explicit TS line numbers that go stale otherwise.

`noise_type` and preset names are matched by string key (`_NOISE_MAP`, `PRESETS` dict); renaming one in the TS/web app without updating both Python copies breaks the Grasshopper equivalent silently, falling back to `'simplex'`/`'gentle-waves'` rather than erroring.

## Risks

The relief sampler's git history shows a long fix-of-fix chain — sawtooth seam artifacts, void-mode plateaus, F1 tearing, and PRNG drift were each fixed and re-fixed across multiple commits (`c40c67b`, `b6e47c7`, `5d838d0`, `5884f2b`, and PR #14 round-1 through round-6). Any change to crest-band, radius-field, or attractor-mask math is high-risk for reintroducing one of these artifacts, and should be checked against both the coarse-grid performance path and the full-resolution path.

The `relief-pockets` preset was tuned through several commits (`fe420b7`, `1adc503`, `cd0d42c`) purely by visual comparison against a reference photo; its numeric values are not derivable from first principles, so changing shared constants they depend on (radius field, cell-size gradient) can silently make it look wrong — there is no automated visual regression check.

`make_ghpy` swallows `Code`-setter failures into the debug log rather than raising, so an IronPython/GhPython API change (e.g. `ZuiPythonComponent.Code` made read-only) would silently produce a `.gh` file with components that have no executable code, surfacing only as buried "WARNING" text in the `a` output panel.

## Change checklist

When these files or sections are changed, remember to consider these:

- Any edit to `src/noise/voronoi-relief.ts` (constants, formulas, parameter defaults) must be mirrored in both `grasshopper/builder/meshcraft_builder.py`'s embedded `NOISE_SCRIPT` and the standalone `grasshopper/components/noise_gen.py` — check the PRNG (`mulberry32`), radius-field constants, and crest-band clamp first since these are the most fragility-prone.
- A new `relief_*` parameter needs updates in four places: `_relief_default` calls, the `RELIEF_INPUTS` list, the relief preset dicts in `PRESETS_SCRIPT`, and `grasshopper/components/presets.py`.
- Changes to `mesh.ts` `generateNoiseMesh` or `gaussianSmooth` require matching edits in `SHAPE_SCRIPT`/`shape_pts.py` or `SMOOTH_SCRIPT`/`smoother.py` — both cite explicit TS line numbers that should be re-verified.
- Adding/renaming a noise type or preset key in the web app requires a matching update to `_NOISE_MAP` and/or `PRESETS` in the Python components, or Grasshopper silently falls back to a default rather than failing.
- If `ZuiPythonComponent`'s API changes in a future Rhino/GhPython release, re-check `make_ghpy`'s `Code` setter and parameter-creation calls in `meshcraft_builder.py`.

## Important failure modes

| Trigger | Consequence | Guard |
|---|---|---|
| TS voronoi-relief math changes without updating both Python copies | Grasshopper relief output diverges visually/numerically from the web app for the same seed/params | Script-mirror and preset-value parity tests; Gaussian numerical parity; native smoke test still required |
| New `relief_*` param added to only some of the four propagation points | Pin silently stuck at hardcoded default; user wiring has no effect | `_relief_default`'s KeyError/None fallback masks the gap instead of erroring |
| `run` toggle left False or `save_path` unwired | Builder exits early or writes to default `~/Desktop/meshcraft.gh` unexpectedly | `a` output reports "run is falsy..." or the resolved path; must connect a Panel to see it |
| `ZuiPythonComponent.Code` setter fails (Rhino/GhPython version mismatch) | `.gh` file saves successfully but components contain no executable script | Failure is only logged into `a`, not raised — must inspect Panel text |
| Malformed/extreme relief params (huge density_strength, tiny cell_size) | Site count or per-pixel loop blows up compute time | `SITE_COUNT_MAX` limits retained sites; Lloyd samples scale with site count, and smaller cells can still increase work |

## Key files

| File | Why to read it |
|---|---|
| `grasshopper/builder/meshcraft_builder.py` | The bootstrap script; embeds and wires all four components programmatically |
| `grasshopper/builder/test_ghpy_output.py` | Standalone diagnostic for GhPython/`ZuiPythonComponent` API availability, not part of the runtime pipeline |
| `grasshopper/components/noise_gen.py` | Standalone copy of the Noise component, including `VoronoiReliefNoise` — must stay in sync with the embedded copy |
| `grasshopper/components/shape_pts.py` | Standalone copy of the Shape component (port of `mesh.ts` shaping) |
| `grasshopper/components/smoother.py` | Standalone copy of the Smooth component, using physical `gaussianSmooth` kernels |
| `grasshopper/components/presets.py` | Standalone copy of the Presets component, including the relief presets |
| `sawyer-design/rhino-aspire-grasshopper/rhino/grasshopper/meshcraft-repo/mesh-maker.gh` | Historical native definition in the external library, preserved by the migration receipt |
| `sawyer-design/rhino-aspire-grasshopper/rhino/grasshopper/meshcraft-repo/meshcraft_builder.gh` | Builder definition regenerated from Slice 3 sources; external regeneration receipt records source, runtime checks and historical recovery |
| `src/noise/voronoi-relief.ts` | Canonical TS source of truth the relief sampler must mirror byte-for-byte in behavior |
