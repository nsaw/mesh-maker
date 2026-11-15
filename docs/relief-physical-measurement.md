# Slice 3e: relief cell measurements

This repair is part of the final kernel parent before class/control cleanup. It
fixes output-resolution-dependent cell measurements, rather than changing the
membrane iteration count. Original kernel, cleanup and standalone physical-proof
checkpoints remain preserved recovery refs. The fixture-only middle layer restores
all 16 migration-capture files byte-exact before cleanup is applied.

The failing Pockets seed-5 point is (23.52, 4.44) on a 24-inch square. Its owner
and boundary distance agree at 201 and 401 resolution. Output-grid Pass 1 changes
the measured inradius, wall width and gutter membership, enabling a cushion only
on the coarse grid. Fixed 80, 320 and 1280 sweeps retain that mismatch. Evidence
commands and logs are under `/tmp/meshcraft-pockets-*`.

Structural rule: generation and Lloyd placement retain their existing inputs.
Per-cell mean F1, maximum boundary distance and derived radius/slope/size fields
come from a physical measurement quadrature independent of output resolution.
The pitch is one quarter of the existing 0.3-inch minimum wall span, so that
feature has four measurement intervals. An explicit sample cap bounds large or
extreme-aspect panels. This is a finite geometry estimate, not an exact inradius
or an all-layout convergence guarantee.

Every retained site also has an indexed center query. This supplies an interior
inradius lower bound even for a cell missed by the panel quadrature. A missed
cell's mean-radius fallback is the analytic mean radius of its contained disk,
not the nominal cell-size slider. Coincident IDs retain their identities and
hashes while sharing their lower-ID owner's geometric measurements.

The separate native relief algorithm already derives its radii from site
neighbors independently of output resolution. Its membrane has the same fixed
sweep count, but the controls show that increasing that count does not repair
this bug. No native alternative arithmetic changes belong to this correction.

- [x] Implement physical quadrature and retained-site anchors in TS and Python.
- [x] Keep canonical and builder literals identical; advance incompatible URL state.
- [x] Verify independent all-site measurement and contained-disk oracles.
- [x] Preserve failing old-resolution and sweep-count controls.
- [ ] Run retained coincidence, depth/backing, basin, junction and slope gates.
- [ ] Freeze normal-hook source before independent extraction capture.
- [ ] Record scope, finite gates, render comparisons and pending native/review work.

`npm run test:relief-measurement` compares the complete sparse-index measurement
against independent all-site ranking, relative bisector planes and arithmetic
on square, rotated/anisometric, portrait, narrow and capped large panels. It
checks exact output-resolution independence, retained coincident IDs and the
contained-disk fallback for sub-pitch cells. Canonical Python measurements are
executed against that same independent oracle.

`npm run test:relief-measurement-mutants` restores output-grid quadrature in an
owned copy. The corrected source reports mean 0.0013829871512239366 and maximum
0.015417299434196452 inches for the reported production case. The old-grid
control fails the unchanged 3% maximum bound at 80 and 1280 sweeps, with maxima
0.042938316430797374 and 0.042938179175027735 inches. More iterations are therefore
a rejected control, not the production correction. The accepted source keeps 80.

`npm run test:gh-parity`, `npm run lint` and `npm run typecheck:cli` pass. Normal
hooks and immutable broader gates still need their receipts. Incompatible URL
payloads advance to 23 because relief geometry now follows fixed physical
measurements. The seed kernel and its descriptor do not change.

Initial source checkpoint `78548fb` was created before the new worktree's Husky
bootstrap existed. The exact committed range was subsequently scanned with the
same hook body, changing only its file enumeration from staged paths to
`git diff HEAD^ HEAD --name-only --diff-filter=ACM`; committed/index bytes were
identical. Lint, app types and the complete secret scan exited 0. Husky is now
bootstrapped; the followup commit runs its normal hook. CLI typechecking also
passed. Logs: `/tmp/meshcraft-3e-checkpoint-hook.log` and
`/tmp/meshcraft-3e-source-hook.log`.

The production Metal/4x bounded preview probe retains the initial GPU parity,
full-frame completion, sustained-preview and 400 ms preview assertions from
`scripts/test-noise-browser.mjs`, stopping before its export cases. Its receipt
is `/tmp/meshcraft-3e-preview/preview-receipt.json`. This is a bounded probe, not
a completed full browser gate. Root's retained prior observations were 62 ms
full-frame completion and approximately 180 ms previews; neither observation
changes the acceptance thresholds. The earlier 200 ms instruction was corrected
to the existing 400 ms gate.

The first immutable functional run passed the retained slope/depth and all
coincidence cases before stopping at the atomic-failure fixture's old diagnostic
label. That 6 x 4-inch, resolution-16 fixture now reports `narrowed`, rather than
`collapsed`: the physical measurement finds a retained band that the coarse
output grid missed. Its exact expected label is updated; its nonzero-diagnostic
preservation and failure assertions remain. The separate dense true-collapse
regression remains unchanged and passed. The stopped receipt is preserved at
`/tmp/meshcraft-3e-gates-54ec835/receipt.json`.

The pre-extraction reference freezes the five parent-7b post-Lloyd layouts,
checks their coordinates unchanged, and computes the physical statistics with
independent complete-population ranking and relative planes. Injecting only
those fields into the old parent height/smoothing/CNC pipeline reproduces every
new source height exactly. It also reproduces clipping diagnostics. The source
of the expected values is therefore the independent fields plus unchanged old
composition, rather than a fresh current-producer capture.

Commands: `node_modules/.bin/tsx /tmp/meshcraft-3e-independent-fixtures.mts`, then
`node_modules/.bin/tsx /tmp/meshcraft-3e-refresh-worker.mts`, then
`npm run test:noise-worker`. The reference inputs and command logs are
`/tmp/meshcraft-3e-independent-fixture-inputs.json`,
`/tmp/meshcraft-3e-independent-fixtures.log`,
`/tmp/meshcraft-3e-worker-refresh.log` and `/tmp/meshcraft-3e-worker.log`.
The refresh asserts all 30 scalar worker hashes unchanged and replaces only
five relief expectations. The fixture records the frozen source and independent
input checksum in grouped metadata. Production migration and GPU fixture bytes
remain unchanged.

The diagnostic negative control restores the entire old output-grid Pass 1,
including its missing-cell fallback. It reproduces `collapsed` at both 80 and
1280 sweeps while the physical source reports `narrowed`. This control retains
the actual old-grid alias independently of the corrected atomic-failure test.

Release-DAG correction: the standalone physical-proof branch remains an evidence
and recovery checkpoint. Its production delta is integrated into the kernel
parent, retaining legacy classes and shaping there. The fixture-only layer then
restores the original 16 capture files; cleanup consumes that parent and uses
payload 24. The kernel parent uses payload 23. No mandatory-CI-red parent is an
accepted publication boundary. Historical source/log paths above retain their
actual checkpoint identities rather than being relabeled as the repartitioned
source. Fresh receipts bind the new parent stack.

## Membrane lattice (#81, #57)

The pillow membrane kept the output-grid dependence that the measurements lost:
80 SOR sweeps over output pixels left large cushions under-converged, so a pillowed
preset carved a different cushion at the 120-column drag preview than at export.
The membrane now lives on this same physical measurement lattice. Each lattice node
evaluates the pass-2 cushion test (reusing its pass-1 nearest ranks, and skipped
where its boundary distance cannot reach the gutter ratio), one Poisson system
over every cell's region is solved by conjugate gradients to a relative residual
of 1e-10 with other cells' nodes held at zero, and each output node reads its own
cell's membrane bilinearly. Raw relief is now identical at every coincident node
of resolutions 121, 401 and 961 (`cli/relief-resolution.spec.ts`).

Pockets seed 139 (#57) measured max 0.0365 of the requested depth at the
pre-slice-3 checkpoint and 0.0346 at the slice-3 candidate. Physical measurement
brought it to 0.0096 and the lattice membrane to 0.0038, the same as with the
pillow off; the remainder is Gaussian smoothing and depth mapping sampled per grid.
`npm run test:relief-measurement-mutants` now installs output-grid quadrature, which
also makes the output grid the membrane lattice, and rejects it at membrane
tolerances 1e-10 and 1e-4.

The native Rhino component (`grasshopper/components/voronoi_relief_native.py`) is a separate
algorithm, but its pillow membrane had the same output-grid dependence (0.0042 of the
normalized range between resolutions 49 and 97 in Rhino 7). It now evaluates its cushion test
on its own fixed lattice (0.2 in, at most 10,000 nodes, sized for IronPython) and solves the
same conjugate-gradient system; pillowed raw heights agree exactly at coincident nodes in Rhino
7.38 and in `npm run test:native-membrane`, and output with the pillow off is unchanged.

