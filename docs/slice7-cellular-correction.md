# Cellular coordinate hash correction

Scope: the plain Voronoi and Worley site jitter in Slice 7b. The legacy relief
`cellHash01` and `VoronoiReliefNoise._cell_hash01` remain unchanged.

| Sibling or consumer | Rule |
|---|---|
| TS `cellularSite` | Replace commutative signed-coordinate XOR with ordered coordinate mixing. |
| TS Voronoi/Worley and `cellularDistances` | Consume the corrected sites; retain complete F1/F2 search, jitter bounds and metrics. |
| Python `_Cellular.hash01/site` | Mirror unsigned arithmetic and coordinate ordering. |
| Embedded `NOISE_SCRIPT` | Match canonical Python exactly. |
| Relief TS `cellHash01`, Python `_cell_hash01`, native relief | No hash or sampler changes. |
| Worker extraction baselines | Refresh only affected plain-cellular cases; preserve every other case. |
| Production migration fixtures | Preserve recorded bytes and retained scalar comparisons; the existing two cellular exceptions remain intentional. |
| Current docs and native Shape wiring | Describe retained algorithms, invert/exponent/floor shaping and current pins. Keep historical fixture metadata historical. |

The coordinate hash uses fixed order-sensitive avalanche rounds over low and high
coordinate words, with the seed mixed before coordinates and separate offset
channels. No claim of universal injectivity is made for a finite hash. Tests retain
the required diversity bound in positive, negative, mixed-sign and translated
windows across seeds, and compare site/search results with an independent BigInt
implementation. A control restoring the old XOR must fail the signed-window test.

- [x] Enumerate production and documentation siblings before editing.
- [x] Implement and mirror the cellular-only correction.
- [x] Run diversity, BigInt, mutation, retained migration and GH checks.
- [x] Complete worker snapshot and browser control checks.
- [x] Freeze runtime source with normal hooks and record source/receipt boundaries.

The cleanup now descends from the reviewed kernel and physical-measurement prefix
and its separate migration-fixture packet. The current URL payload is 24. Native
and release acceptance have separate receipts; the bounded tests here do not close them.

Evidence commands and finite boundaries:

- `npm run test:generator-migration` passes the retained scalar production fixtures and Python parity. `cli/cellular-hash.spec.ts` reports a minimum of 10000 distinct offsets across its declared signed/translated windows; the acceptance bound remains 9990.
- `npm run test:cellular-hash-mutant` first passes the corrected implementation, then rejects the restored XOR at 8362 offsets in the seed-0 signed window. The temporary control never edits the working tree.
- `npm run test:gh-parity` verifies canonical/embedded script and preset parity. The cellular test also executes the canonical Python sites against the independent BigInt oracle, including signed high coordinate words.
- `git diff --exit-code fc6b105 8fc3c0c -- src/noise/prng.ts src/noise/voronoi-relief.ts grasshopper/components/voronoi_relief_native.py` passes for the historical cellular correction. The corresponding AST comparison found its entire Python `VoronoiReliefNoise` class unchanged. The later physical-measurement prerequisite intentionally changes that sampler; the cellular hash correction does not.

The old symmetric XOR is a production negative control, not a change to the
legacy relief hash. Historical migration metadata and its compressed fixture
bytes remain untouched. Versions 21 and 22 identify earlier preparation states;
the integrated cleanup uses version 24 and resets those older links.

`node_modules/.bin/tsx /tmp/meshcraft-recapture-cellular-worker.mts /Users/sawyer/Code/mesh-maker-generator-cleanup slice7-folded-shapes-cellular-ordered-coordinates-v3`
recaptured the four plain-cellular worker expectations from normal-hook source
`3374ff1`. It asserted the other 31 hashes and every grid/diagnostic metadata
field unchanged, including all five relief cases. `npm run test:noise-worker`
then passed against the refreshed expectations. These worker snapshots are
extraction contracts, not independent correctness oracles.

`npm run test:generators`, `npm run test:generator-controls`, `npm run build`,
`npm run lint` and `npx tsc --noEmit -p tsconfig.cli.json` pass. The browser
control check covers desktop, tablet and phone sizes declared in its script.
Normal hooks run lint, app typechecking and staged secret scanning. The shortcut
scan has only existing Python `any()` calls and ordinary English uses of that
word; no new type escapes or diagnostic shortcuts were introduced.

The runtime-source hook log is `/tmp/meshcraft-cellular-hook-source.log`.
Bounded gate logs use `/tmp/meshcraft-cellular-*.log`; capture and legacy receipts
use `/tmp/meshcraft-cellular-worker-recapture-3374ff1.json` and
`/tmp/meshcraft-cellular-legacy-proof.json`. Full exports, hardware timing and
native acceptance are outside this correction's verification scope.
