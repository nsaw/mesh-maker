<!-- Captured from the Greptile knowledge base 2026-07-29. Greptile generated this from the
codebase and grounded its review findings in it; it is not hand-authored SOT.
Verify against live code before citing it as authoritative. -->

# CLI Tools

This module holds the standalone command-line entrypoints and the parity/regression specs that guard the noise engine and the embedded Grasshopper scripts. `cli/stl-to-sbp.ts` and `cli/vtdb-reader.ts` form the STL-to-SBP conversion path; `cli/grasshopper-parity.spec.ts` and `cli/voronoi-relief.spec.ts` are plain-Node scripts (not a test framework) run via `npm run test:gh-parity` / `npm run test:relief` that assert TS/Grasshopper consistency and deterministic relief output.

## Mental model

| Entrypoint | Input | Output | Verifies |
|---|---|---|---|
| `stl-to-sbp.sh` → `cli/stl-to-sbp.ts` | `.stl` mesh + CLI flags | `.sbp` toolpath file | End-to-end mesh→heightmap→toolpath generation |
| `cli/vtdb-reader.ts` | Vectric `.vtdb` SQLite file | `ToolDef[]` | Tool metadata extraction (used by stl-to-sbp.ts) |
| `cli/grasshopper-parity.spec.ts` | `grasshopper/builder/meshcraft_builder.py` + `grasshopper/components/*.py` | pass/fail + diff context | Embedded GhPython literals match canonical component files |
| `cli/voronoi-relief.spec.ts` | `src/noise/voronoi-relief.ts` | pass/fail + diff context | numbered assertion blocks (18+, grown alongside the sampler's v16-v23 iterations) on relief sampler behavior |

## stl-to-sbp: mesh to toolpath

`stl-to-sbp.sh` is a thin wrapper that resolves its own directory and execs `npx tsx cli/stl-to-sbp.ts "$@"`, so it works regardless of the caller's cwd. The TS entrypoint (`cli/stl-to-sbp.ts`) does the real work:

1. Parses CLI flags (`parseArgs`) covering output path, tool database path/patterns/ATC overrides, heightmap resolution, material profile and thickness, workpiece offsets, safe/home Z, stock allowance, finish angle, and roughing/finishing-only toggles. Validates numeric args are finite and rejects `--roughing-only` combined with `--finishing-only`.
2. Reads the input STL with `readFileSync` and parses it via `parseSTLBinary` (`src/sbp/stl-parser.ts`), reporting triangle count and bounding box to stderr.
3. Loads tool definitions: if `--vtdb` is given it calls `readToolDatabase`; otherwise it tries the default `sourceTruth/stl-to-sbp/tool-libraries/tooldb-general.vtdb` relative to the script, falling back to `getEmbeddedTools` (`src/sbp/tools.ts`) if no vtdb is found.
4. Builds an `SbpConfig` via `getDefaultConfig(materialProfile)`, resolving roughing/finishing tools by name pattern (`findToolByName`) with a "Chipbreaker"/"R1/16-S1/4" default match preference when a database was loaded (`selectDefaultTool`).
5. Rasterizes the mesh to a heightmap (`meshToHeightmap`, `src/sbp/heightmap.ts`) at the requested cells-per-inch resolution, then sets `config.materialX/Y/Z` from the heightmap dimensions and STL bounds (or the `--material-thickness` override).
6. Calls `generateSBP(heightmap, config)` (`src/sbp/generate.ts`) to produce the toolpath, prints a stats summary (grid size, Z-shift normalization, move counts per pass, output size/line count, elapsed time), and — unless `--dry-run` — writes the `.sbp` file.

`cli/vtdb-reader.ts` opens the Vectric `.vtdb` SQLite database read-only via `better-sqlite3` and joins `tool_tree_entry`, `tool_geometry`, `tool_entity`, and `tool_cutting_data` to build one row per tool with cutting parameters. It extracts the ATC slot from the parent group's name (`TOOL N - ...` pattern via regex) and converts feed/plunge rates from mm/s to in/s only for the tools flagged `rate_units === 4`, per a documented quirk: the shipped ShopBot libraries store stepdown/stepover in inches even under metric rate_units, so those geometry fields pass through unconverted. Tool type integers are mapped to `ToolType` enum values (0=BallNose, 1=EndMill, 2=Radiused, 3=VBit, 5=TaperedBallNose, default=EndMill).

## grasshopper-parity.spec.ts: embedded script drift guard

`grasshopper/builder/meshcraft_builder.py` embeds two GhPython scripts (`NOISE_SCRIPT`, `PRESETS_SCRIPT`) as triple-quoted Python string literals, hand-maintained as mirrors of the standalone canonical files `grasshopper/components/noise_gen.py` and `grasshopper/components/presets.py`. Because there is no automated sync between the embedded copy and the standalone file, this spec extracts each embedded literal with a regex (`extractEmbedded`), normalizes both sides (right-trim every line, drop blank lines — since blank-line separator counts legitimately differ between the two representations), and asserts byte-for-byte equality. The comment in the file notes this exact drift caused round-2 through round-5 PR review findings, motivating the guard. On mismatch it prints the first diverging line with `ctx()` context (2 lines before/after, `>`-marked) and exits 1 with a message telling the maintainer which file to update. A fourth block (`4. ctx() marker placement`) is a self-test of the `ctx()` helper's marker-position math, guarding a boundary bug where the marker could land on the wrong row when the divergence is near the start or end of the file.

## voronoi-relief.spec.ts: relief sampler regression guard

This spec drives `VoronoiReliefGen.sampleGrid` (`src/noise/voronoi-relief.ts`) directly with a shared `baseParams()` fixture and numbered blocks (18+, one added per sampler iteration through v23 — e.g. block 18 covers the starburst radial-foci system, and later blocks cover base superposition/wall band/depth-tier mechanisms), each isolating one parameter's effect by diffing two grids that differ only in that parameter. Key groups:

- **Determinism and bounds** (1-3): same seed produces identical grids; all values finite and within `[-1.05, 1.05]`.
- **Polarity and profile** (4, 6): `domes` vs `pockets` are mean sign-symmetric; `hemisphere`/`cosine`/`parabolic` profiles all peak near 1 at cell centers and drop below 0.5 at boundaries.
- **Attractor and base-mode semantics** (5, 7, 7b, 12, 13, 14): vertical density attractors bias variance toward the anchored band; `attractorY` controls the anchor direction (row 12 is a named regression guard for a round-13 fix that flipped this convention); `attractorNoise` breaks a smooth gradient into patches (round-14); `flowAnisotropy` curves the stretch direction; wave `baseMode` combined with a vertical attractor must keep wave-zone troughs shallower than cell-zone troughs, and `transitionSoftness` controls how early cell character appears in the blend band.
- **Structural pipeline effects** (8-11): Lloyd relaxation (`relaxIterations`) must change >10% of values vs. unrelaxed; `warpDistortion` and `warpFrequency` are separately tested (9 and 9b) so a regression that drops the frequency parameter from the site-warp pass still fails even though warp-on/off (test 9) would pass; `voidStrength` must push bottom-band minimums below `-1.0` and deeper than the no-void case; `cellSizeGradient` must materially change output vs. baseline.
- **Guards against known regressions** (15-17): row 15 checks the asymmetric output range used by the production preset (`seamDepth=0.22`, `polarity=pockets`); row 16 is a named regression test for commit `c40c67b`, where F2-aliasing caused catastrophic pixel-to-pixel jumps (>1.5 out of a ~2.0 total range) — it scans both horizontal and vertical neighbor pairs; row 17 is a 5x5 z-score + absolute-deviation outlier scan (z > 6 and absolute deviation > 0.3) designed to catch isolated single-pixel spikes (F2-ownership/radius-field discontinuities) while ignoring smooth natural dome transitions and tiny clamp-boundary noise.

Both specs are plain scripts with a local `assert()` helper and `failures` counter, not a test-runner integration — they print `ok`/`FAIL` lines to stdout and `process.exit(1)` on any failure, making them CI-friendly without a test framework dependency.

## tsconfig.cli.json

`tsconfig.cli.json` is a standalone TS config (`target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `strict`, `noEmit`) scoped to `include: ["src/sbp", "cli"]`. It exists separately from the main project tsconfig so the CLI and `src/sbp` code can be typechecked independently (e.g. `tsc -p tsconfig.cli.json --noEmit`) without pulling in the rest of the app's compiler settings.

## Change checklist

When these files or sections are changed, remember to consider these:

- If `grasshopper/components/noise_gen.py` or `presets.py` changes, update the matching embedded literal (`NOISE_SCRIPT`/`PRESETS_SCRIPT`) in `grasshopper/builder/meshcraft_builder.py` and re-run `npm run test:gh-parity` — the spec does byte-level (whitespace-normalized) comparison, so even a comment change on one side without the other fails it.
- If `src/noise/voronoi-relief.ts`'s `ReliefSampleParams` fields change (add/rename/remove), update `baseParams()` in `cli/voronoi-relief.spec.ts` — an omitted field silently defaults to `undefined` inside the sampler rather than failing the spec loudly.
- If the vtdb schema assumptions in `cli/vtdb-reader.ts` (table names, `rate_units` metric flag, `TOOL N` group-name pattern) change in the source Vectric tool library format, `readToolDatabase` will throw or silently mis-map tools; verify against `sourceTruth/stl-to-sbp/tool-libraries/tooldb-general.vtdb`.
- If `src/sbp/tools.ts`'s `ToolDef`/`ToolType` shape changes, both `cli/vtdb-reader.ts` (which constructs `ToolDef`) and `cli/stl-to-sbp.ts` (which consumes it via `findToolByName`/`getEmbeddedTools`) need matching updates.
- If `src/sbp/generate.ts` output stats (`result.stats.*`) change shape, update the summary printout in `cli/stl-to-sbp.ts`'s `main()`.

## Important failure modes

| Trigger | Consequence | Guard |
|---|---|---|
| `meshcraft_builder.py` embedded script edited without updating `grasshopper/components/*.py` (or vice versa) | GhPython behavior in the builder silently diverges from the standalone component used elsewhere | `cli/grasshopper-parity.spec.ts` fails with line-level diff context |
| `ReliefSampleParams` gains a field not added to `baseParams()` | Spec runs with an `undefined` param value, possibly masking a real regression in that code path | Manual review; spec has no schema-driven exhaustiveness check |
| `.vtdb` group name doesn't match `TOOL N` pattern | `readToolDatabase` throws `Could not extract ATC slot from tool group "..."` | Thrown error surfaces immediately; no silent fallback |
| Requested `--roughing-tool`/`--finishing-tool` pattern matches no tool | `stl-to-sbp.ts` prints available tool names and exits 1 | Explicit check before generation begins |
| F2-aliasing-style algorithmic discontinuity reintroduced (as in commit `c40c67b`) | Toolpath from relief output could jump destructively between adjacent cells | `voronoi-relief.spec.ts` tests 16 (catastrophic-jump) and 17 (isolated-outlier) |

## Key files

| File | Why to read it |
|---|---|
| `stl-to-sbp.sh` | Shell wrapper resolving script dir and invoking `tsx cli/stl-to-sbp.ts` |
| `cli/stl-to-sbp.ts` | Full CLI: arg parsing, STL parse, tool resolution, heightmap rasterization, SBP generation, summary output |
| `cli/vtdb-reader.ts` | Reads Vectric `.vtdb` SQLite tool libraries into `ToolDef[]` |
| `cli/grasshopper-parity.spec.ts` | Asserts embedded GhPython literals in `meshcraft_builder.py` match canonical `grasshopper/components/*.py` |
| `cli/voronoi-relief.spec.ts` | 18-block deterministic regression suite for `VoronoiReliefGen.sampleGrid` |
| `tsconfig.cli.json` | Standalone strict TS config scoping `cli/` and `src/sbp` for independent typechecking |
