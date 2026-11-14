# Python relief index checkpoint

Start: a57b0fa. Rollback uses a reviewed revert and preserves other work.

- [x] Verify PR 58 findings 4573370671, 4573370672 and 4573370683 against source.
- [x] Capture the original full-scan methods as independent regression oracles.
- [x] Index uncapped Cartesian candidate separation without changing order or RNG draws.
- [x] Index Lloyd ownership and sequential movement, preserving squared arithmetic, ties and samples.
- [x] Index the distinct native fallback without claiming web geometry parity.
- [x] Verify complete maximum-size Lloyd sampling and bounded site-read work.
- [x] Run source mirrors, exact output oracles, negative controls and ordinary checks.
- [ ] Integrate the parent's junction fix and rerun applicable gates.
- [ ] Root owns cold review, Rhino source regeneration, saved-open proof and publication.

The helper is self-contained in each standalone component. The canonical
`site_grid.py` class, Noise copy, native copy and builder copy are checked for drift.
No component depends on finding a Python file on the Grasshopper host's filesystem.
Candidate enumeration and the 64-samples-per-site rule are retained. The existing
native geometry algorithm remains separate from the web sampler.

`npm run test:gh-site-grid` passes the original full-scan output comparisons,
complete maximum-size sampling and site-read predicates. The native oracle freezes
only the original fallback, and the canonical oracle freezes only candidate and
Lloyd lookup paths. The parent junction geometry change has a separate contract.
`npm run test:gh-parity`, both typechecks, lint and build pass locally. Native
IronPython execution and speed remain host gates owned by the parent.
