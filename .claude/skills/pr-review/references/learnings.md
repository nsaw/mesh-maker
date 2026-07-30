# Repo learnings — mesh-maker

Rules this repo taught its AI reviewers, exported from CodeRabbit. Each was a
real correction: a reviewer proposed something, the maintainer explained why this
repo does it differently, and the exception stuck. Treat them as settled —
re-raising a resolved one is noise, and noise is what makes a reviewer tiring to
read.

10 rules, applied 57 times in total. 2 have never been applied and are listed last.

The bracketed number is how many reviews used the rule. High counts are broad
conventions; low counts are narrow, specific knowledge — both matter, but a rule
applied once may also just be stale, so verify against live code before citing it.

> **This file is generated — do not hand-edit it.** Re-running the importer overwrites
> it. A learning that has since been overtaken by the code belongs in
> `superseded.md`, which survives regeneration. **Read `superseded.md` before citing
> anything here**: a settled rule that the implementation has moved past is worse than
> no rule, because it makes a reviewer argue for a regression.

## Area-specific rules (10)

### grasshopper/components (2)

- **[36x]** `grasshopper/components/noise_gen.py` (PR #16) — In the mesh-maker repository, IronPython 2.7 Grasshopper components (e.g., `grasshopper/components/noise_gen.py`, `grasshopper/components/voronoi_relief_native.py`) intentionally use single-line `if x: y` guards as an established convention throughout the codebase. Do not flag these as Ruff E701 violations or suggest expanding them onto indented lines, since Ruff is not part of this repo's toolchain (the toolchain is ESLint + tsc + ast.parse gates for Python files).
- **[1x]** `grasshopper/components/noise_gen.py` (PR #16) — In `grasshopper/components/noise_gen.py`'s `VoronoiReliefNoise.sample_grid`, `relief_anisotropy` and `relief_anisotropy_angle` should be sanitized before building the metric frame (non-finite values reset to 0, `anisotropy` clamped to `[0,2]`), mirroring the TS `sampleReliefParamsFromState` guards in `src/noise/voronoi-relief.ts`. The embedded copy of this sampler in `grasshopper/builder/meshcraft_builder.py`'s `NOISE_SCRIPT` is regenerated wholesale from `grasshopper/components/noise_gen.py`, so both files should stay byte-identical; this is enforced by a `test:gh-parity` test.

### src/export.ts (1)

- **[12x]** `src/export.ts` (PR #7) — In `src/export.ts` (MeshCraft 3000, Vite + TypeScript project), the Rhino3DM library is intentionally loaded at runtime via a version-pinned CDN URL (`rhino3dm@8.4.0` on jsDelivr) rather than self-hosted or bundled. This is a deliberate design decision: the ~8MB WASM binary is too large to commit to the repo for a client-side CNC tool, the URL is immutable (content-addressed by version), and `doExport()` already has a try/catch that falls back to OBJ export on any load failure. Do not flag this CDN dynamic import pattern as a supply-chain or SRI issue in this codebase.

### src/state.ts (1)

- **[3x]** `src/state.ts` (PR #11) — In `src/state.ts` for the nsaw/mesh-maker project, `serializeConfig()` intentionally returns `''` (empty string, meaning no `?c=` query param) when the current STATE matches DEFAULTS. This is by design: a default-config share URL is meant to be the plain app URL. Recipients always receive the current defaults. The `_v` version token is only included in payloads that have actual customizations. Flagging the empty return as a missing version signal is incorrect.

### src/noise (2)

- **[1x]** `src/noise/voronoi-relief.ts` (PR #16) — In the Voronoi-relief samplers (`src/noise/voronoi-relief.ts`, `grasshopper/components/noise_gen.py`, and `grasshopper/components/voronoi_relief_native.py`), slope-budget multipliers must remain per-cell static and be blended across edges to preserve C0 continuity at dissolved boundaries. Do not derive the cap from pixel-local final wall widths because per-side hash-dependent wall geometry can introduce boundary steps; instead use a conservative lower-bound estimate of the final wall width.
- **[1x]** `src/noise/voronoi-relief.ts` (PR #16) — For the Voronoi-relief samplers in `src/noise/voronoi-relief.ts`, `grasshopper/components/noise_gen.py`, `grasshopper/builder/meshcraft_builder.py`, and `grasshopper/components/voronoi_relief_native.py`, exact practical boundary distance is computed by minimizing the bisector-distance expression across the second, third, and fourth nearest sites. In jittered site sets, deeper competitors constrain only measure-zero high-degree degeneracies, so full Delaunay-neighbor enumeration is intentionally avoided for performance.

### styles (1)

- **[2x]** `styles/main.css` (PR #11) — In `styles/main.css` of nsaw/mesh-maker, `.section-title` intentionally uses `var(--warn)` (amber) as a visual hierarchy/design choice for the CNC industrial aesthetic introduced in commit cd94751. This is NOT a semantic warning color — do not flag it as misuse of the warning token in future reviews.

### cli/voronoi-relief.spec.ts (1)

- **[1x]** `cli/voronoi-relief.spec.ts` (PR #16) — In `cli/voronoi-relief.spec.ts`, the radial-focus enclosure regression test intentionally samples a radius-11 disc and takes the maximum relief rise per angular sector. Starburst petal walls occur at direction-dependent radii, so a narrow fixed annulus can miss valid enclosing walls; the disc also avoids the diagonal-distance bias of square-neighborhood sampling.

### sourceTruth (1)

- **[0x]** `sourceTruth/meshcraft.h` (comment anchored on `sourceTruth/meshcraft.html`) (PR #7) — In `sourceTruth/meshcraft.html` and `src/interaction.ts` (MeshCraft 3000, plain JS/TypeScript, Vite), `STATE.panX` and `STATE.panY` are intentional screen-space pixel offsets consumed directly by `renderViewport()` as a canvas translation. Scroll/wheel pan and drag pan do NOT apply orbit-angle compensation — screen-space pan is the deliberate design choice. Do not flag the absence of orbit-angle rotation on pan deltas as a bug.

### src/render.ts (1)

- **[0x]** `src/render.ts` (comment anchored on `src/mesh.ts`) (PR #11) — In `src/render.ts` of nsaw/mesh-maker, `setCameraFromState()` always calls `requestRender()` at the end of its body, which schedules an on-demand RAF-based repaint via the `_rafPending` flag. Calling `setCameraFromState()` is therefore sufficient to both update the camera and trigger a redraw — no separate `renderViewport()` call is needed afterward.

