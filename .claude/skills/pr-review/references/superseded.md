# Superseded learnings — mesh-maker

Entries in `learnings.md` or `learnings-mined.md` that the code has since moved past. That file is generated from the
CodeRabbit export and is overwritten on every import, so corrections live here instead.

**Read this before citing anything from `learnings.md`.** A settled rule the implementation has
outgrown is worse than no rule: it makes a reviewer argue for a regression, with the authority of
"this was already decided."

Each entry keeps the original rule, so the *reason* it was settled stays available — usually the
reasoning is still sound and only a version, path, or status code moved.

---

## `src/export.ts` — rhino3dm CDN version pin

**Learning says:** the CDN pin is `rhino3dm@8.4.0`.

**Live code:** `RHINO3DM_URL` in `src/export.ts` loads
`https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0/rhino3dm.module.min.js`.

**Still true:** the *pattern* — loading rhino3dm from a CDN at runtime with an OBJ fallback is
intentional, not an oversight, and should not be flagged as a missing dependency.

**No longer true:** the specific version. Do not flag `8.17.0` as drift from `8.4.0`; the pin was
simply bumped. Only flag the pin if it is unpinned (`@latest`, or no version at all), since the
whole point of the learning is that the version is deliberate.

*Raised by Greptile on PR #18 against `references/learnings.md:24`. Verified 2026-07-29.*

---

## `grasshopper/builder/meshcraft_builder.py` — `NOISE_SCRIPT` is not regenerated

**Learning says** (the `[1x]` `noise_gen.py` sanitization rule): the embedded copy of the sampler
in `meshcraft_builder.py`'s `NOISE_SCRIPT` "is regenerated wholesale from
`grasshopper/components/noise_gen.py`, so both files should stay byte-identical".

**Live code:** there is no generator and no regeneration step in this repo — grep for one and you
will not find it. `cli/grasshopper-parity.spec.ts` extracts the embedded triple-quoted literals
and asserts an *identical algorithmic core* after stripping platform-specific differences
(shebang/header comments, script-end footer, trailing whitespace).

**Still true:** the two sides must not drift, and a sanitization guard added to one needs the same
guard on the other. That is the point of the rule and it is the highest-value finding class in
this repo.

**No longer true:** *how* they are kept in step, and how equal they have to be. They are
HAND-MAINTAINED mirrors held to algorithmic-core equivalence, not byte equality. Two consequences
for a reviewer:

- Do not tell an author to re-run a regeneration step, or ask why the generator was not run.
  There is no such step; the real fix path is **edit both files by hand, then
  `npm run test:gh-parity`**.
- Do not raise a finding on a header comment, footer, or trailing-whitespace difference between
  the two copies. The parity spec strips exactly those before comparing, so a byte diff there is
  not drift. Only an algorithmic-core difference is.

*Raised by CodeRabbit on PR #18 against `references/superseded.md`. The same wrong claim was
fixed in `SKILL.md` (invariant 2) in commit `6b8d32c`, but `learnings.md` is generated and cannot
carry the correction, so it needed an entry here. Verified 2026-07-30 against
`cli/grasshopper-parity.spec.ts`.*

---

## `src/render.ts` and the AGENTS.md checklist: Canvas renderer, pan, noise and preset counts

**Learnings say:** `learnings-mined.md` (AGENTS.md block) "Use Canvas 2D rendering instead of
WebGL for mesh visualization", "All noise algorithms must generate correctly: Simplex, Perlin,
Ridged, FBM, and Voronoi" and "All 15 CNC presets must apply correctly". `learnings-mined.md`
(sourceTruth) and `learnings.md` (sourceTruth, PR #7): `STATE.panX`/`STATE.panY` are "consumed
directly by `renderViewport()` as a canvas translation".

**Live code:** `src/render.ts` renders with `THREE.WebGLRenderer`. Pan is applied in
`setCameraFromState()`, which converts the pixel offsets to a world-space shift of the camera
and its target. `createNoiseGen()` in `src/noise/generators.ts` dispatches 15 named types plus
the `simplex` default, and `CNC_PRESETS` in `src/noise/presets.ts` has 19 entries.

**Still true:** pan is screen-space by design, with no orbit-angle compensation on the pan
deltas. Do not flag that. Every noise type and every preset must still work.

**No longer true:** the renderer, where pan is applied, and the counts. Do not flag WebGL or
Three.js in `src/render.ts` as a violation, and do not ask for exactly five algorithms or
fifteen presets. `AGENTS.md`'s checklist now names the source of truth instead of a count.

*Source: prompt audit 2026-11-12. The two learnings files are generated and cannot carry the
correction. Verified 2026-11-12 against `src/render.ts`, `src/noise/generators.ts` and
`src/noise/presets.ts`.*
