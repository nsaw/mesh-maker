<!-- pr-review:v1:summary -->
<!-- pr-review:v1:head=0f0e200731902d204929723ac429f186fe86d16b -->
## PR Review — round 3, `0f0e200`

**Scope:** four changed files, +24/-9 since round 2; cumulative PR remains eight files. Reviewed the fixes as new code, including the additional change to legacy thread defaults and the actual subprocess call.

**Verdict: Ship** — no open findings in the current Blender workflow diff. This remains a review of the Blender feature: no web-parity implementation is present at this head, and no approval or merge is being issued.

### Verified fixes

- **Closed, round 1: custom-profile overflow.** The original `1e200` coordinate counterexample now fails validation before emitter construction. The coordinate bound keeps arithmetic and float32 conversion finite, and the alignment comparison now rejects NaN instead of accepting it. The supplied Venus profile continues to validate.
- **Closed, round 2: calibration units.** The README now identifies the **1.416× gravity-response ratio** as the measurement, explicitly distinguishes the nominal/gravity-normalized value from the actual displacement finite difference, and records the approximately 6.63 units/s² gravity control. This addresses the numerical interpretation needed for porting without changing the accepted geometry.
- **Verified additional compatibility fix:** legacy presets omit `--threads` by default; gathered uses four threads; explicit overrides are honored. Exercised the real `workflow.py` entry point through an executable child-process stub, inspecting the actual launched argv and JSON payload for all three legacy presets, gathered, and explicit eight-thread overrides on both paths. This checks command construction, not just configuration values. The stub deliberately exits nonzero and the wrapper reports the failure correctly.

### Gates and test effectiveness

- Nine Python tests pass twice. The new overflow test fails when paired with the previous `quartering_wind.py`, and the new thread-default test fails when paired with the previous `workflow.py`, in isolated temporary copies. Both new regression guards therefore catch their pre-fix behavior.
- Python compilation, lint, browser typecheck, CLI typecheck, production build, mandatory anti-pattern search and diff checks pass locally.
- Current-head GitHub CI is still running; completed CodeQL/security checks are green. The diff does not alter cloth material, force schedules, figure placement, raw geometry, relief mapping or web code, so no repeat of round 1's expensive native bake was warranted for these validation/report/argv fixes.
- Committed source-of-truth checker, `origin/main`, `CONTEXT/docs/grasshopper`: no additional document upkeep owed. Workflow README reviewed against the changes.

### Standing state

| Finding | Raised | Result |
|---|---|---|
| Invalid JSON from non-finite motion | round 1 | Previously closed; still fixed |
| Custom-profile normal overflow | round 1 | Closed in `0f0e200`, original counterexample and regression verified |
| Absolute versus normalized acceleration units | round 2 | Closed in `0f0e200`, documentation checked against the measured controls |

**New findings:** 0. **Still open:** 0. **Outside-diff findings/nitpicks:** 0. **Dropped this round:** 0.

No implementation edits performed. Continue watching from this reviewed hash; later web changes require their own review and parity evidence.
