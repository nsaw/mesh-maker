# Generator cleanup checkpoints

Start: 318526e. Rollback uses a reviewed revert, preserving other work.

- [x] Isolate the worktree and read generator, preset and request boundaries.
- [x] Repair seed permutations, Wavelet mapping and OpenSimplex kernel in TS and Python.
- [x] Capture production-resolution migration fixtures after seed repair. Their 16 byte-exact files are published in the fixture-only middle layer, not this kernel tree.
- [ ] Remove redundant classes and shape fields, preserving fixture surfaces.
- [ ] Add complete cellular distance search and controls.
- [x] Integrate the reviewed Slice 6 UI checkpoint e2d9594.
- [ ] Run finite local gates and normal commit hook.

Kernel checkpoint: 3659938, captured before class substitution and curve folding.
The worktree initially lacked generated Husky hooks. `npm run prepare` installed them;
the followup checkpoint runs the normal hook. The seed/kernel fixture source is
`318526e` plus Fisher-Yates Simplex, Wavelet8 and the radius-squared 0.5 OpenSimplex kernel.
The fixture-only middle layer restores the gzip files byte-exact from recovery checkpoint 91ba3a9. They contain complete row-major little-endian Float64 heights at resolution 400.
Hashes in the manifest verify decompressed bytes. Shape migration must compare those
heights, excluding the cellular fields whose site placement intentionally changes.

- [ ] Root performs native Rhino regeneration, independent review and publication.

Seed-repair review finding: the starburst minimum-count gate required at least five
sharp dips, each more than 0.03 below its cardinal-neighbor mean. The original kernel-only checkpoint distinguished
strict cardinal basins from sharp dips. The gate now independently requires
at least five basins and retains the exact sharp-dip ceiling of 1200. Flat and dense
checkerboard negative controls fail those respective predicates; smooth bowls pass
without requiring sharp dips. Coverage, crossing and slope gates are unchanged.
The repaired seed intentionally changes relief warp and texture. No seed was tuned.

Fixture capture at 3659938 uses `buildNoiseSurface(noiseSurfaceParams({...DEFAULTS,
...presetState(name), seed: 0, resolution: 400}))` for every scalar preset. The
manifest records all request fields, dimensions and decompressed byte hashes.

Integration preparation joins the complete-support relief sampler with the Worker and mobile
parents. Synchronous failures now use the generation controller, preserving committed geometry
and diagnostics while refusing stale exports. `npm run test:noise-worker` verifies that adapter
and request ownership. The original site layouts now remain in checksummed binary64 fixtures from
source bb9bbf3514. Tests explicitly use those layouts for the reported rank transition,
seventh-ranked bisector and mixed/outer junctions. Actual rank identities are asserted.
This preparation checkpoint is not release-ready. Scalar extraction hashes remain unchanged; the relief recapture receipt records
the intentional sampler change before further cleanup.

The Simplex runtime exposes `describeKernel()` as copied, deeply frozen permutation
and 2D-gradient data for independent warp certification. Its explicit implementation
tag is `meshcraft-simplex2-fisher-yates-mulberry32-v1`; downstream query identities
must include the changed kernel identity. This metadata API does not alter sampling.

Extraction fixtures were refreshed from source checkpoint 109e268 after relative-plane
integration. The capture script verifies every scalar hash before changing only
relief hashes and records its source identity in the fixture. The near-tie and physical cell-measurement repairs are integrated with URL payload 23. Current worker, generator,
near-tie and GH checks verify the joined source; broader gates, visuals, native
regeneration and independent review remain open. Payload version is separate from
the Simplex implementation tag and future query identity.

The final publication sequence is a coherent kernel plus physical-repair parent,
a fixture-only middle layer, then the class/control cleanup. The original 91ba3a9
kernel, 7ae72a7 cleanup and a6c5a41 physical-proof checkpoints remain recovery refs.
The kernel parent retains legacy shaping and menu classes. Its physical sampler
and Python relief class match the reviewed a6c5a41 mechanism; its five relief
worker hashes reuse the independent frozen-input proof, while scalar and GPU
expectations remain unchanged. Mandatory relief CI belongs to this parent, so
no published parent depends on a child to repair a failing gate. Cleanup uses
payload 24 after the fixture-only parent; this combined kernel uses payload 23.
