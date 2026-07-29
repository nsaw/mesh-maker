---
name: pr-review
description: "mesh-maker code review — repo invariants, mined bot learnings, hot files, and the TS↔Grasshopper parity cohort for the MeshCraft depth-to-relief mesh tool, its noise engine, and the SBP CNC toolpath pipeline. Use when reviewing changes, a branch, or a PR in this repo. Layer 2: load the user-level pr-review skill first for the review method."
---

# mesh-maker PR Review

**Layer 2 (repo memory).** The review method — the eleven passes, the severity rubric, the
verification recipes, the Phase 3 knowledge-base upkeep step — lives in the user-level
`pr-review` skill (`~/.claude/skills/pr-review/`). Load it first when available. In a
checkout, CI, or remote context where it is not, this file alone still gives real coverage:
work from the invariants, hot files, and cohorts below.

## Source of truth

| Area | Doc |
|---|---|
| Repo conventions, commands, architecture, secrets | `.claude/CLAUDE.md` |
| Voronoi relief target spec | `docs/voronoi-relief-target-spec.md` |
| Grasshopper native port notes | `grasshopper/VORONOI_RELIEF_NATIVE.md` |

### Subsystem dossiers — `CONTEXT/greptile/`

6 generated subsystem docs plus `index.md`, captured from the Greptile knowledge base
(2026-07-19) before that subscription lapsed. Read the matching one before reviewing in its
area. Two sections in each are directly a review checklist:

- **"Change checklist"** — a ready-made pass-1 sibling-cohort list per subsystem.
- **"Important failure modes"** — Trigger / Consequence / Guard rows, each a finding waiting
  to be re-detected.

Routing: `mesh-generation-core` (depth-estimate → geometry → drape → mesh) ·
`noise-and-relief-system` (`src/noise/**`, Voronoi relief) · `grasshopper-integration`
(Python components, builder) · `sbp-export-pipeline` (roughing → finishing → compensation →
writer) · `cli-tools` (parity specs, stl-to-sbp) · `ui-and-state`.

Greptile-generated, not hand-authored. Where they conflict with `.claude/CLAUDE.md` or live
code, those win. Verify before citing one as a violation.

## Invariants

- **TS and Grasshopper Python are kept in lockstep.** `src/noise/**` and
  `grasshopper/components/**` implement the same algorithms and are enforced by
  `cli/grasshopper-parity.spec.ts` and `cli/voronoi-relief.spec.ts`. A change to one side
  without the other is the single highest-value finding in this repo.
- **`grasshopper/builder/meshcraft_builder.py`'s `NOISE_SCRIPT` is regenerated wholesale
  from `grasshopper/components/noise_gen.py`** — the two must stay byte-identical, enforced
  by `test:gh-parity`. Editing the embedded copy by hand is a defect.
- **IronPython 2.7 single-line `if x: y` guards are an established convention** in
  `grasshopper/components/*.py`. Do NOT flag these as Ruff E701 — Ruff is not in this repo's
  toolchain (ESLint + tsc + `ast.parse` gates).
- **All state is one in-memory module, `src/state.ts`.** No database, queue, or external
  store. Do not propose persistence patterns.
- **SBP generation is strictly staged**: roughing → finishing → compensation → writer. Work
  that reorders or skips a stage needs justification.
- **Relief params are sanitized before use** — non-finite values reset to 0, `anisotropy`
  clamped to `[0,2]`. Both the TS `sampleReliefParamsFromState` and the Python
  `sample_grid` do this; a new param needs the same treatment on both sides.
- **`npm` only** (`package-lock.json`). No pnpm/yarn suggestions.
- **Pre-commit hook** runs `npm run lint` + `npm run typecheck` and scans staged files for
  leaked secrets. It does NOT run `typecheck:cli`, so CLI-only type errors escape it —
  verify `npm run typecheck:cli` explicitly when touching `cli/` or `src/sbp/`.
- **Some values are intentional**: `serializeConfig()` returning `'…'` and
  `.section-title` using `var(--warn)` are deliberate. Check `references/learnings.md`
  before flagging an odd-looking constant.
- **Never validate a build through a pipe** — `cmd | tail` returns tail's exit status, so a
  failing build reports success. Branch on the unmasked exit code.

## Hot files

From `references/finding-index.md` (139 historical findings). Weight attention here.

| File | Findings | What tends to go wrong |
|---|---|---|
| `src/noise/voronoi-relief.ts` | 37 | Sampler math, param sanitization, parity with the Python port |
| `cli/voronoi-relief.spec.ts` | 13 | Deterministic regression coverage, sampling assumptions |
| `src/state.ts` | 13 | Serialization, param defaults, in-memory invariants |
| `grasshopper/builder/meshcraft_builder.py` | 10 | Embedded `NOISE_SCRIPT` drift from the component source |
| `grasshopper/components/noise_gen.py` | 8 | IronPython 2.7 constraints, param sanitization parity |
| `src/noise/presets.ts` + `grasshopper/components/presets.py` | 12 | Preset drift between the two sides |
| `grasshopper/components/voronoi_relief_native.py` | 6 | Native port fidelity |

Distribution skews Major (69) / Minor (25) / Trivial (13), with 1 Critical historically.
Note the concentration: the noise engine and its Python mirror account for most findings,
which is exactly what a parity-critical design predicts.

## Sibling cohorts

This repo's cohorts are unusually explicit — the parity specs name them.

- **`src/noise/voronoi-relief.ts` ↔ `grasshopper/components/voronoi_relief_native.py` ↔
  `grasshopper/components/noise_gen.py` ↔ the `NOISE_SCRIPT` embedded in
  `grasshopper/builder/meshcraft_builder.py`.** Four copies of one algorithm.
- **`src/noise/presets.ts` ↔ `grasshopper/components/presets.py`.**
- **SBP stages** — `roughing.ts`, `finishing.ts`, `compensate.ts` share config plumbing from
  `src/sbp-export.ts`; a new config field usually needs threading through all of them plus
  `worker.ts`.
- **Inline vs worker export paths** — `src/sbp-export.ts` runs the pipeline inline for the
  current mesh and offloads to `src/sbp/worker.ts` for uploaded STLs. These are primary/retry
  style siblings and diverge easily.
- **Parity specs** — `cli/grasshopper-parity.spec.ts` and `cli/voronoi-relief.spec.ts`
  should both cover any new sampler behavior.

## Knowledge-base upkeep

Phase 3 is not optional. `CONTEXT/greptile/` is a decaying capture (2026-07-19) and
`docs/voronoi-relief-target-spec.md` is the hand-authored spec the samplers are judged
against — a sampler change that does not update the spec makes the spec a liar.

```bash
python3 ~/.claude/skills/pr-review/scripts/check-context-staleness.py \
  --doc-roots CONTEXT docs grasshopper --base <base-ref>
```

## Validation commands

```bash
npm run lint            # eslint src/ cli/
npm run typecheck       # tsc --noEmit (browser sources only)
npm run typecheck:cli   # tsc -p tsconfig.cli.json --noEmit (CLI + shared SBP) — NOT in the hook
npm run build           # tsc + vite build
```

Parity is the test that matters here: run the parity specs when touching either side of the
TS/Python mirror.

## References

- `references/learnings.md` — 10 settled maintainer corrections from the authoritative
  CodeRabbit export, ranked by how often each was applied. Several are "this is
  intentional" rules — read them before flagging.
- `references/finding-index.md` — 139 historical findings grouped by file
- `references/learnings-mined.md` — scraped learnings (superset, noisier; the CSV wins)
- `references/false-positive-log.md` — findings raised and withdrawn. Read before flagging
  in these areas, and append whenever a `/pr-review` finding is rejected, with the reason.
