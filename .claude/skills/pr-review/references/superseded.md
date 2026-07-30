# Superseded learnings — mesh-maker

Entries in `learnings.md` that the code has since moved past. That file is generated from the
CodeRabbit export and is overwritten on every import, so corrections live here instead.

**Read this before citing anything from `learnings.md`.** A settled rule the implementation has
outgrown is worse than no rule: it makes a reviewer argue for a regression, with the authority of
"this was already decided."

Each entry keeps the original rule, so the *reason* it was settled stays available — usually the
reasoning is still sound and only a version, path, or status code moved.

---

## `src/export.ts` — rhino3dm CDN version pin

**Learning says:** the CDN pin is `rhino3dm@8.4.0`.

**Live code:** `src/export.ts:166` loads
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
