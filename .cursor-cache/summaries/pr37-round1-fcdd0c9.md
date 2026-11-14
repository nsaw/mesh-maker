<!-- pr-review:v1:summary -->
<!-- pr-review:v1:head=fcdd0c981362e32da63fde101eab2273b4a53a60 -->
## PR Review — round 1, `fcdd0c9`

**Scope:** 7 changed files, +621/-50 lines; 6 related caller/consumer/parity code files examined, plus package configuration and subsystem documentation. This head contains the Blender workflow only; Claude's web-parity implementation is not in this head.

**Verdict: Ship** — no Critical or Major defects found in the reviewed Blender workflow. Two Minor edge-case findings remain, one new and one already posted by CodeRabbit. This verdict does not certify physical contact, settledness, machinability or web parity.

### Findings

1. **Minor | Functional Correctness | Quick win — reject non-finite derived panel normals.** `scripts/drape/quartering_wind.py:54-56`. Inline finding posted with an executable counterexample. Finite Python coordinates can overflow both the normal calculation and Blender's float32 mesh storage; the supplied Venus profile is unaffected.
2. **Minor | Data Integrity & Integration | Quick win — non-finite motion can produce invalid JSON.** Existing [CodeRabbit thread](https://github.com/nsaw/mesh-maker/pull/37#discussion_r4339255116), independently confirmed rather than duplicated inline. The exact expression at `blender_drape.py:137-138` emits `NaN` when given a non-finite solved node; the serializer at line 173 permits it. Node's `JSON.parse` rejects the resulting report. Fail clearly on invalid solved nodes, or explicitly represent the failed measurement and enforce strict JSON serialization; do not turn an invalid solve into a successful geometry certificate.

### Verified clean

- Fresh native run of the exact reviewed code: Blender 5.2.2 LTS, four threads, `silk-gathered`, left-quarter wind 250, bake 150/read 120, followed by `.mcrelief` packaging. The three recorded workflow hashes match this checkout.
- Raw cloth coordinates match the original wind-250 study bit for bit at frames 119, 120, 149 and 150. All sampled coordinates are finite. This is verification of that configuration, not a universal determinism claim.
- Saved scene reopens with a baked cache; raw frame-120 nodes match the saved samples. Actual wind strength is zero at 99/100 and 250 at 115/120. Only Hook, Cloth and display Subdivision are on the veil; the wind emitter has no collision modifier.
- Eight Python tests pass twice. Removing the winding guard in an isolated temporary copy makes the regression suite fail.
- Local lint, browser typecheck, CLI typecheck, Python compilation and production build pass. Current-head GitHub CI, CodeQL and security checks are green. Existing unchanged web/geometry/SBP suites were verified through current-head CI rather than needlessly repeated locally.
- Wind is opt-in, legacy settings remain explicitly separate, no browser source or parity fixture was changed, and relief packing/export consumers preserve the existing mapping and triangulation.
- Mandatory anti-pattern search and diff whitespace checks are clean.

### Source-of-truth upkeep

Ran the committed checker against `origin/main`, covering `CONTEXT`, `docs` and `grasshopper`: no tracked subsystem document references a changed code file, so nothing is owed there. The workflow README correctly states that gathered/wind controls are Blender-only and that the selected frame is still moving; existing Jolt parity covers the original gravity-only preset.

**Outside-diff findings:** none. **Nitpicks:** none.

**Dropped in verification:** 2 candidates: null pose passthrough already existed before this PR, and filename-only asset matching is an explicitly documented limitation rather than a claimed content-identity guarantee.

**Standing state:** 1 new Minor and 1 independently verified existing Minor remain open. No implementation files changed during this review. Further pushes require a fresh review; this round is anchored to the hash above.
