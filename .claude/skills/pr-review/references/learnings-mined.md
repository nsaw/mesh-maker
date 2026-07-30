# Repo learnings — nsaw/mesh-maker

## Maintainer corrections (settled)

Rules a human taught the review bots, recovered from PR comment history.
Each was a real correction: a reviewer proposed something, the maintainer
explained why this repo does it differently, and the exception stuck.
Treat these as settled. Re-raising a resolved one is noise, and noise is what
made the paid reviewers tiring to read.

10 distinct corrections across 8 areas.

### grasshopper (2)

- **grasshopper/components/noise_gen.py:626-628** (PR #16) — In `grasshopper/components/noise_gen.py`'s `VoronoiReliefNoise.sample_grid`, `relief_anisotropy` and `relief_anisotropy_angle` should be sanitized before building the metric frame (non-finite values reset to 0, `anisotropy` clamped to `[0,2]`), mirroring the TS `sampleReliefParamsFromState` guards in `src/noise/voronoi-relief.ts`. The embedded copy of this sampler in `grasshopper/builder/meshcraft_builder.py`'s `NOISE_SCRIPT` is regenerated wholesale from `grasshopper/components/noise_gen.py`, so both files should stay byte-identical; this is enforced by a `test:gh-parity` test.
- **grasshopper/components/noise_gen.py:782-782** (PR #16) — In the mesh-maker repository, IronPython 2.7 Grasshopper components (e.g., `grasshopper/components/noise_gen.py`, `grasshopper/components/voronoi_relief_native.py`) intentionally use single-line `if x: y` guards as an established convention throughout the codebase. Do not flag these as Ruff E701 violations or suggest expanding them onto indented lines, since Ruff is not part of this repo's toolchain (the toolchain is ESLint + tsc + ast.parse gates for Python files).

### src/noise/voronoi-relief.ts (2)

- **src/noise/voronoi-relief.ts:696-713** (PR #16) — For the Voronoi-relief samplers in `src/noise/voronoi-relief.ts`, `grasshopper/components/noise_gen.py`, `grasshopper/builder/meshcraft_builder.py`, and `grasshopper/components/voronoi_relief_native.py`, exact practical boundary distance is computed by minimizing the bisector-distance expression across the second, third, and fourth nearest sites. In jittered site sets, deeper competitors constrain only measure-zero high-degree degeneracies, so full Delaunay-neighbor enumeration is intentionally avoided for performance.
- **src/noise/voronoi-relief.ts:849-870** (PR #16) — In the Voronoi-relief samplers (`src/noise/voronoi-relief.ts`, `grasshopper/components/noise_gen.py`, and `grasshopper/components/voronoi_relief_native.py`), slope-budget multipliers must remain per-cell static and be blended across edges to preserve C0 continuity at dissolved boundaries. Do not derive the cap from pixel-local final wall widths because per-side hash-dependent wall geometry can introduce boundary steps; instead use a conservative lower-bound estimate of the final wall width.

### sourceTruth (1)

- **sourceTruth/meshcraft.html:0-0** (PR #7) — In `sourceTruth/meshcraft.html` and `src/interaction.ts` (MeshCraft 3000, plain JS/TypeScript, Vite), `STATE.panX` and `STATE.panY` are intentional screen-space pixel offsets consumed directly by `renderViewport()` as a canvas translation. Scroll/wheel pan and drag pan do NOT apply orbit-angle compensation — screen-space pan is the deliberate design choice. Do not flag the absence of orbit-angle rotation on pan deltas as a bug.

### src/export.ts (1)

- **src/export.ts:162-171** (PR #7) — In `src/export.ts` (MeshCraft 3000, Vite + TypeScript project), the Rhino3DM library is intentionally loaded at runtime via a version-pinned CDN URL (`rhino3dm8.4.0` on jsDelivr) rather than self-hosted or bundled. This is a deliberate design decision: the ~8MB WASM binary is too large to commit to the repo for a client-side CNC tool, the URL is immutable (content-addressed by version), and `doExport()` already has a try/catch that falls back to OBJ export on any load failure. Do not flag this CDN dynamic import pattern as a supply-chain or SRI issue in this codebase.

### src/state.ts (1)

- **src/state.ts:151-158** (PR #11) — In `src/state.ts` for the nsaw/mesh-maker project, `serializeConfig()` intentionally returns `''` (empty string, meaning no `?c=` query param) when the current STATE matches DEFAULTS. This is by design: a default-config share URL is meant to be the plain app URL. Recipients always receive the current defaults. The `_v` version token is only included in payloads that have actual customizations. Flagging the empty return as a missing version signal is incorrect.

### src/mesh.ts (1)

- **src/mesh.ts:249-250** (PR #11) — In `src/render.ts` of nsaw/mesh-maker, `setCameraFromState()` always calls `requestRender()` at the end of its body, which schedules an on-demand RAF-based repaint via the `_rafPending` flag. Calling `setCameraFromState()` is therefore sufficient to both update the camera and trigger a redraw — no separate `renderViewport()` call is needed afterward.

### styles (1)

- **styles/main.css:135-135** (PR #11) — In `styles/main.css` of nsaw/mesh-maker, `.section-title` intentionally uses `var(--warn)` (amber) as a visual hierarchy/design choice for the CNC industrial aesthetic introduced in commit cd94751. This is NOT a semantic warning color — do not flag it as misuse of the warning token in future reviews.

### cli (1)

- **cli/voronoi-relief.spec.ts:0-0** (PR #16) — In `cli/voronoi-relief.spec.ts`, the radial-focus enclosure regression test intentionally samples a radius-11 disc and takes the maximum relief rise per angular sector. Starburst petal walls occur at direction-dependent radii, so a narrow fixed annulus can miss valid enclosing walls; the disc also avoids the diagonal-distance bias of square-neighborhood sampling.

## Contract rules the reviewer had indexed (11)

These were not corrections. The bot ingested this repo's own written
contracts and restated them. They are listed so a review can check code
against them, but the source docs are authoritative and may have moved on —
read the live contract before citing one of these as a violation.

- **AGENTS.md:0-0** — Applies to **/src/render.ts : All view modes must render correctly: Solid, Wire, Both, and Points
- **AGENTS.md:0-0** — Applies to **/src/{mesh,sbp-export,sbp/generate}.ts : Enforce minimum base thickness of 0.01 inches when watertight export is enabled to prevent degenerate triangles
- **AGENTS.md:0-0** — Applies to **/src/render.ts : Use Canvas 2D rendering instead of WebGL for mesh visualization - simpler, more portable, no shader compilation needed
- **AGENTS.md:0-0** — Applies to **/src/state.ts : Use typed STATE singleton pattern with `MeshState` interface containing 40+ typed keys with direct mutation (no reactive/observer pattern)
- **AGENTS.md:0-0** — Applies to **/src/{sbp-export,sbp/types,noise/presets}.ts : ShopBot defaults are hardcoded: 36 inches x 24 inches max dimensions, 6 inches Z limit for ShopBot Desktop Max ATC
- **AGENTS.md:0-0** — Applies to **/src/sbp/{roughing,finishing,generate}.ts : SBP export output must change when roughing/finishing settings or raster angle settings change
- **AGENTS.md:0-0** — Applies to **/src/noise/generators.ts : All noise algorithms must generate correctly: Simplex, Perlin, Ridged, FBM, and Voronoi
- **AGENTS.md:0-0** — Applies to **/src/noise/presets.ts : All 15 CNC presets must apply correctly when selected
- **AGENTS.md:0-0** — Applies to **/src/state.ts : Encode URL state using base64url JSON format, storing only keys that differ from defaults in `serializeConfig()`
- **AGENTS.md:0-0** — Applies to **/src/{main,state,toolbar}.ts : URL state sharing must work: copy link from toolbar → open in new tab → same configuration loads
- **AGENTS.md:0-0** — Applies to **/src/sbp/worker.ts : SBP output in browser worker must continue working for uploaded STL file processing

