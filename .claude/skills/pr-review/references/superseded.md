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
