# Frozen relief regression layouts

These files retain the original post-Lloyd site coordinates and stable ID order
from source `bb9bbf3514`, before the Simplex permutation repair changes the
suppression field. `provenance.json` stores the full source identity as joined
commit groups, complete capture parameters, site counts and grouped SHA-256 values.
The files contain little-endian binary64 x/y pairs with no header or resampling.
`frozenReliefSites` verifies every byte hash before decoding and freezing positions.

Capture command: `tsx /tmp/meshcraft-capture-bb9-sites.mts`. That owned capture
imported the archived source's `DEFAULTS`, `sampleReliefParamsFromState` and
`VoronoiReliefGen`, then called `sitesForTest(params, false)` for each recorded
parameter object. It wrote each x/y with `Buffer.writeDoubleLE` in existing ID
order. To reproduce, reconstruct the recorded source with `git archive`, run
that same API against each complete recorded parameter object, encode the returned
positions as little-endian binary64 pairs, and compare the recorded byte hashes.

The rank layout preserves the reported third/fourth switch and the seventh-ranked
constraining bisector at their original coordinates. The mixed-crest and regular
outer-membership layouts preserve their actual junction geometry. The tests
explicitly pass these post-Lloyd layouts through a test-only sampler input;
production generation still uses the repaired seed kernel. Generated-layout
oracles also remain on the current kernel. No seed or expected counterexample
coordinate was selected to make the repaired kernel pass.
