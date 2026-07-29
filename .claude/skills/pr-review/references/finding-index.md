# Historical finding index — nsaw/mesh-maker

139 findings mined from past bot reviews. This is the empirical
answer to 'what actually goes wrong in this repo'. Files near the top of the
hot-file list have earned extra scrutiny: they broke before, repeatedly.

## Distribution

**Category:** ⚠️ Potential issue 54, 🎯 Functional Correctness 28, 🧹 Nitpick 12, 📐 Maintainability & Code Quality 5, 🩺 Stability & Availability 4, 🗄️ Data Integrity & Integration 3, 🛠️ Refactor suggestion 2

**Severity:** 🟠 Major 69, 🟡 Minor 25, 🔵 Trivial 13, 🔴 Critical 1

**Placement:** potential_issue 116, nitpick 22, refactor_suggestion 1

## Hot files (3+ historical findings)

### src/noise/voronoi-relief.ts (37)

- [coderabbit 🟠 Major/🎯 Functional Correctness] Remove directional bias from the fixed-count membrane solve.
- [coderabbit 🟠 Major/⚠️ Potential issue] `reliefRadialFociCount = 1` still serializes a no-op.
- [coderabbit 🟠 Major/⚠️ Potential issue] Cap site generation before the two nearest-site passes.
- [greptile P1] `ReliefSampleParams.seed` is silently ignored
- [coderabbit 🟠 Major/🎯 Functional Correctness] The minimum-separation guarantee does not cover final sites.
- [coderabbit 🟡 Minor/🎯 Functional Correctness] Keep restored Cartesian sites outside polar-owned zones.
- [coderabbit 🟠 Major/⚠️ Potential issue] Clamp `transitionSoftness` before raising `mask` to a power.
- [greptile P1] `warp_frequency` not wired into Grasshopper relief pipeline
- [coderabbit 🟠 Major/🎯 Functional Correctness] Reserve site capacity for the polar lattice.
- [coderabbit 🟠 Major/🎯 Functional Correctness] Minimize bisector distance over every relevant competitor.
- [coderabbit 🟠 Major/🎯 Functional Correctness] The slope budget uses an estimated wall width rather than the final wall geometry.
- [greptile P2] Dead typed-array allocations — `ownerF1` / `ownerIdx` are written but never read
- [coderabbit 🟠 Major/⚠️ Potential issue] `reliefAttractorFalloff` is ignored for radial and point masks.
- [coderabbit 🟡 Minor/⚠️ Potential issue] Clamp `intensityStrength` inside `sampleGrid()` too.
- [coderabbit 🔵 Trivial/🧹 Nitpick] Refresh the file overview to mention the site-warp path.
- [coderabbit 🟡 Minor/⚠️ Potential issue] Use both axis pitches for seam anti-alias floor.
- [coderabbit 🟠 Major/⚠️ Potential issue] Sanitize and cap `radialFoci` in `sampleGrid`.
- [coderabbit 🟠 Major/⚠️ Potential issue] Guard the radial scalar clamps against `NaN`.
- [greptile P1] One point disables flow
- [greptile P1] Handle one focus
- [coderabbit 🔵 Trivial/🧹 Nitpick] Remove unnecessary `void` statements.
- [coderabbit 🔵 Trivial/🧹 Nitpick] Update the header to match the current anisotropy model.
- [coderabbit 🔵 Trivial/🧹 Nitpick] Header documentation contradicts actual implementation.
- [coderabbit 🟠 Major/⚠️ Potential issue] Single-focus starbursts leave `radialWarp` and focal expansion inert.
- [coderabbit 🟠 Major/⚠️ Potential issue] Reject non-finite base anisotropy inputs.
- [coderabbit 🟠 Major/⚠️ Potential issue] Make the focal density cut respect `radialGrow`.
- [coderabbit 🟠 Major/🩺 Stability & Availability] Cap and sanitize distortion before sizing the warp domain
- [coderabbit 🟠 Major/🩺 Stability & Availability] Restore finite guards for warp and radial controls.
- [coderabbit 🟠 Major/🎯 Functional Correctness] Do not use `radialStrength` as the starburst enable flag.
- [coderabbit 🟠 Major/🎯 Functional Correctness] Make `junctionLift` control junction widening across every sampler.
- [coderabbit 🟠 Major/🎯 Functional Correctness] Guard the three-distance formulas when fewer than three sites exist.
- [coderabbit 🟠 Major/🎯 Functional Correctness] Keep crest and junction effects inside the spatially enabled cell region.
- [coderabbit 🟠 Major/🎯 Functional Correctness] Replace the F2–F1 approximation with the actual nearest-bisector distance.
- [coderabbit 🟡 Minor/🎯 Functional Correctness] Preserve a minimum Cartesian site set during suppression.
- [coderabbit 🟠 Major/🎯 Functional Correctness] Gate the new junction deltas with `junctionLift`.
- [coderabbit 🟠 Major/🎯 Functional Correctness] Make the per-edge interpolation symmetric.
- [coderabbit 🟠 Major/🎯 Functional Correctness] Preserve zero pillow coverage across every sampler.

### cli/voronoi-relief.spec.ts (13)

- [coderabbit 🔵 Trivial/🧹 Nitpick] Minor: Header test count is stale.
- [coderabbit 🟠 Major/🛠️ Refactor suggestion] Route preset coverage through `sampleReliefParamsFromState()` instead of reimplementing it here.
- [coderabbit 🔵 Trivial/🧹 Nitpick] Add a direct `warpFrequency` regression case.
- [coderabbit 🟡 Minor/⚠️ Potential issue] Keep the no-void control branch on the same attractor settings.
- [coderabbit 🟡 Minor/⚠️ Potential issue] Catastrophic-jump guard misses vertical discontinuities.
- [coderabbit 🔵 Trivial/📐 Maintainability & Code Quality] Assert fillet continuity, not only final depth.
- [coderabbit 🟠 Major/⚠️ Potential issue] The `seed` field in `ReliefSampleParams` is never used by `sampleGrid`.
- [coderabbit 🟡 Minor/🎯 Functional Correctness] Assert that rings mode actually reverses the bias.
- [coderabbit 🟡 Minor/⚠️ Potential issue] Fix incorrect file path in header comment.
- [coderabbit 🟠 Major/📐 Maintainability & Code Quality] Tighten the jump threshold so this test catches the documented regression.
- [coderabbit 🟡 Minor/📐 Maintainability & Code Quality] Update the documented warp-continuity threshold.
- [coderabbit 🟡 Minor/🎯 Functional Correctness] Assert an enclosing wall, not one nearby peak.
- [coderabbit 🟡 Minor/🎯 Functional Correctness] Sample an annulus rather than each sector’s entire square.

### src/state.ts (13)

- [coderabbit 🟠 Major/⚠️ Potential issue] Handle v6, v9, and non-standard v7–v8 radial payloads explicitly.
- [greptile P2] Old links still change
- [greptile P1] Preserve seam sharpness
- [greptile P1] Migrate inverted profile
- [coderabbit 🟠 Major/⚠️ Potential issue] Use a stricter signature before auto-migrating legacy starburst links.
- [greptile P1/Security] Clamp focus coordinates
- [greptile P1] `reliefDensityStrength` not clamped — crafted share link can freeze the browser tab
- [coderabbit 🟠 Major/⚠️ Potential issue] Harden numeric URL guards against type bypass
- [coderabbit 🔵 Trivial/🧹 Nitpick] Consider clamping radial focus coordinate fields for consistency.
- [greptile P1] Migration uses stale values
- [greptile P1] Update migration values
- [coderabbit 🟠 Major/🗄️ Data Integrity & Integration] Apply the complete current starburst preset during migration.
- [greptile P1] Preserve custom foci

### grasshopper/builder/meshcraft_builder.py (10)

- [greptile P1] Add builder preset
- [coderabbit 🟠 Major/⚠️ Potential issue] Avoid row-major truncation when the site cap is hit.
- [coderabbit 🟠 Major/⚠️ Potential issue] Expose `warp_frequency` instead of hard-coding `0.1`.
- [coderabbit 🟠 Major/⚠️ Potential issue] The builder still doesn’t surface the new relief mode or its parameters.
- [coderabbit 🟠 Major/⚠️ Potential issue] Missing `seed` in embedded relief_params dict (same issue as noise_gen.py).
- [coderabbit 🔵 Trivial/🧹 Nitpick] Add a parity check for the embedded GH scripts.
- [coderabbit 🔵 Trivial/🧹 Nitpick] Mirror the defensive `intensity_strength` clamp from the TypeScript sampler.
- [coderabbit 🟠 Major/⚠️ Potential issue] `warp_frequency` is still hardcoded to `0.1`.
- [coderabbit 🟠 Major/⚠️ Potential issue] Sync the Grasshopper fallback preset with the web starburst baseline.
- [coderabbit 🟠 Major/⚠️ Potential issue] The GH “starburst” fallback still omits the new bowl-shaping fields.

### grasshopper/components/noise_gen.py (8)

- [coderabbit 🟠 Major/⚠️ Potential issue] Use the same seeded PRNG as the TypeScript relief sampler.
- [coderabbit 🟠 Major/⚠️ Potential issue] Missing `seed` in relief_params dict.
- [coderabbit 🟠 Major/⚠️ Potential issue] Handle disconnected relief inputs, not just missing pins.
- [coderabbit 🟠 Major/⚠️ Potential issue] Cap the relief site/work budget before sampling.
- [coderabbit 🟡 Minor/⚠️ Potential issue] `warp_frequency` is hardcoded instead of using an input.
- [coderabbit 🔵 Trivial/🧹 Nitpick] Mirror the `intensity_strength` clamp from the TypeScript fix.
- [coderabbit 🟠 Major/🎯 Functional Correctness] Sanitize anisotropy consistently in both IronPython samplers.
- [coderabbit 🟡 Minor/📐 Maintainability & Code Quality] Expand the new inline guards to satisfy Ruff E701.

### src/noise/presets.ts (6)

- [greptile P1] `relief-radial` preset values still diverge from the Grasshopper mirror
- [greptile P1] Stale `reliefAttractorNoise`/`reliefFlowAnisotropy` when switching away from `relief-pockets`
- [coderabbit 🟠 Major/⚠️ Potential issue] Parity mismatch in `relief-pockets` preset.
- [coderabbit 🟡 Minor/⚠️ Potential issue] Add missing `baseThickness` to the `relief-radial` preset to make it deterministic.
- [coderabbit 🟡 Minor/🎯 Functional Correctness] Keep `relief-vertical` within the sidebar cap.
- [coderabbit 🟡 Minor/🎯 Functional Correctness] Keep `relief-radial` within the stock-thickness amplitude cap.

### grasshopper/components/presets.py (6)

- [coderabbit 🟡 Minor/📐 Maintainability & Code Quality] Correct the radial-parity claim.
- [greptile P1] Missing starburst preset
- [coderabbit 🟠 Major/⚠️ Potential issue] `relief-radial` preset drifts from TypeScript values, breaking TS↔GH parity.
- [greptile P1] Sync starburst base
- [greptile P1] Starburst base loses shape
- [coderabbit 🟠 Major/🗄️ Data Integrity & Integration] Synchronize the Grasshopper fallback with the TypeScript preset.

### grasshopper/components/voronoi_relief_native.py (6)

- [coderabbit 🟠 Major/🎯 Functional Correctness] Remove the discontinuity at `t = 0.5`.
- [coderabbit 🟠 Major/🎯 Functional Correctness] Resolve the inert native `depth` contract.
- [coderabbit 🟠 Major/🩺 Stability & Availability] Bound the user-controlled work factors.
- [coderabbit 🟡 Minor/🎯 Functional Correctness] Align jitter behavior with its ±30% contract.
- [coderabbit 🟡 Minor/🎯 Functional Correctness] Use the same `2^32` hash denominator as the other samplers.
- [coderabbit 🟠 Major/🎯 Functional Correctness] Port v17 size-depth coupling into the native sampler.

### src/sbp-export.ts (4)

- [greptile P1] Seam-width warning toast is always overridden by the success toast
- [greptile P1] homeZ can exceed the ShopBot 6" Z limit
- [coderabbit 🟡 Minor/⚠️ Potential issue] Gate seam-width warning when finishing pass is disabled.
- [greptile P1] Seam-width estimate is off by ~2×, making the warning threshold too loose

## All other flagged files

- `.gitignore` — Test artifact files committed while also added to `.gitignore`
- `README.md` — Prompt-injection attack surface committed to README; Remove the secrets section—sensitive OPSEC/privacy leak.
- `cli/grasshopper-parity.spec.ts` — Use filesystem-safe URL conversion for root path resolution.; Fix divergence marker placement in context output.
- `grasshopper/VORONOI_RELIEF_NATIVE.md` — Correct the stated grid dimensions.
- `src/export.ts` — Heuristic condition is inverted — picks the steeper diagonal, not the shorter one
- `src/render.ts` — Gizmo breaks on HiDPI displays — DPR applied twice
- `src/sbp/finishing.ts` — `config.finishRasterAngle` is never read — `--finish-angle` has no effect
- `src/sbp/generate.ts` — `leaveStock` applied twice — roughing leaves 2× the intended allowance
- `src/sbp/stl-parser.ts` — Strict exact-match byte-length check may reject valid STL files
- `src/sbp/worker.ts` — `config.materialX/Y` not updated from the STL heightmap in the web Worker
- `src/sbp/writer.ts` — Duplicate `J3` rapid commands on every retract
- `src/ui.ts` — Do not hide controls for the active blend fallback.; Cap resolution by the resulting grid size.
