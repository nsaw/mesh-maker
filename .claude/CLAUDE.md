# CLAUDE.md - mesh-maker (MESHCRAFT)

Project-local instructions for the Claude surface. Authoritative for this repo.
`~/Code/CLAUDE.md` is the workspace umbrella and routes here; it does not override this file.

## What this is

MESHCRAFT: a browser-based 3D mesh generator and ShopBot SBP toolpath compiler for CNC
machining on the ShopBot Desktop MAX ATC. Vite + TypeScript ES modules, `"type": "module"`,
package name `meshcraft`. A shared SBP pipeline under `src/sbp/` is used by both the web app
and the Node CLI and must stay free of Node-only imports.

- Live: `meshcraft.sawyerdesign.io` (Cloudflare Pages project `meshcraft`)
- Repo: `github.com/nsaw/mesh-maker`

## Architecture: read AGENTS.md, do not duplicate it

The file-by-file map, the key design decisions, and the external-resource table live in
`AGENTS.md` at the repo root. That is the single copy on purpose. Read it before touching
`src/` or `cli/`.

Two known staleness points in that map, both verified 2026-08-05: its tree predates
`grasshopper/`, `CONTEXT/`, `sourceTruth/`, `verification/`, `docs/` and `assets/`, and it
lists five noise algorithms where `src/noise/generators.ts` carries fourteen-plus. Correct
`AGENTS.md` when you touch those areas rather than forking a second description here.

## Commands

From `package.json`. Do not invent scripts that are not in this list.

```bash
npm run dev              # Vite dev server, http://localhost:5173
npm run build            # tsc && vite build -> dist/
npm run preview          # preview the production build
npm run typecheck        # tsc --noEmit (web surface)
npm run typecheck:cli    # tsc -p tsconfig.cli.json --noEmit (CLI surface)
npm run lint             # eslint src/ cli/
npm run lint:fix
npm run test:relief      # tsx cli/voronoi-relief.spec.ts
npm run test:gh-parity   # tsx cli/grasshopper-parity.spec.ts
npm run test:drape       # tsx cli/drape.spec.ts (Drape tab, ~5 s)
npm run test:drape-parity   # tsx cli/drape-parity.spec.ts (web drape vs the Blender proof, ~1 min)
npm run test:depthmap       # tsx cli/depthmap.spec.ts (luma sampling, orientation, cutoff, share links)
npm run drape-run -- <figure.mcfig> --out <dir> [--tilt 25] [--param key=value]   # one web drape in Node
npm run test:cut         # tsx cli/sbp-cut.spec.ts (compensation oracles + SBP cut replay, ~7 min)
npm run test:relief-master  # tsx cli/relief-master.spec.ts (.mcrelief contract, export fidelity)
npm run relief-roundtrip -- <master.mcrelief> --out <dir> [--crop ...] [--sbp] [--replay f.sbp] [--sim-factor N] [--offset x,y] [--face ...]
npm run stl-to-sbp -- <input.stl> [--dry-run]
npm run deploy           # build, then wrangler pages deploy (needs CF env vars)
```

`typecheck` and `typecheck:cli` are separate configs covering different surfaces. Running one
does not clear the other. Check both before claiming the repo is green.

## Gates

A husky `pre-commit` hook runs `npm run lint` then `npm run typecheck`, then scans staged
content for secrets (cloud keys, platform tokens, database URLs, private keys, JWTs, bearer
and basic auth headers). It blocks the commit on any hit.

Two consequences worth knowing before you commit:

- A lint or type error anywhere in `src/` or `cli/` blocks a commit that touches only docs
  or skills. Fix the real error. Do not reach for `--no-verify` to get an unrelated commit
  through.
- The scanner is regex-based and can false-positive, for example on a 37-character hex
  string or on `token:` followed by a quoted literal. If you are certain it is a false
  positive, say so explicitly and get Nick's sign-off before using `--no-verify`.

## The Grasshopper parity invariant

`grasshopper/builder/meshcraft_builder.py` embeds `NOISE_SCRIPT` and `PRESETS_SCRIPT` as
triple-quoted Python literals. Those are hand-maintained mirrors of the canonical standalone
components in `grasshopper/components/`. `npm run test:gh-parity` extracts the embedded
literals and asserts they share an identical algorithmic core with the standalone files,
after stripping shebang, header, footer and trailing whitespace.

Per the spec's own header comment, drift between those two paths has already caused round-2
through round-5 review findings. **Any change to a noise generator or to a preset has three
landing sites, not one:** the TypeScript in `src/noise/`, the standalone component in
`grasshopper/components/`, and the embedded literal in the builder. Adding a preset to
`src/noise/presets.ts` alone will pass typecheck, pass lint, ship to the web app, and be
silently absent from Grasshopper. Run `npm run test:gh-parity` after any such change.

## Correctness rules specific to this tool

- `@huggingface/transformers` is pinned to exactly `4.2.0`. 4.3.0 ships an onnxruntime wasm of
  26,861,777 bytes, over Cloudflare Pages' 25 MiB per-file limit, so every deploy would fail.
  `npm run build` runs `scripts/check-asset-size.mjs` afterwards and fails on any file over the
  limit. Before moving the pin, build and read that check's output. The `sharp` and `adm-zip`
  overrides cover transformers' Node-only dependencies, which this browser app never bundles.

Restated from `AGENTS.md` because they are enforcement rules, not description. Output here
drives a physical machine, so these are not style preferences.

- No `console.log`. This is a production tool, not a debug environment.
- No TODO or FIXME in production paths.
- No `innerHTML` for user-influenced content. Values like `STATE.depthMapName` are rendered
  via DOM node creation, `appendChild` and `textContent`.
- Every `URL.createObjectURL()` needs a matching `URL.revokeObjectURL()` on both the success
  and the error path.
- No degenerate triangles in exports. Enforce the 0.01 inch minimum material thickness when
  watertight is on.
- ShopBot Desktop MAX ATC limits are hardcoded: 36 x 24 inch bed, 6 inch Z. Do not raise
  them without checking the machine.
- Grid row `j` is world `Y = j / (rows - 1) * meshY` in every export (STL/OBJ/3DM vertices, SBP
  toolpaths), and Y grows away from the machine front. Depth-map sampling therefore puts the
  image's bottom row at `j = 0` (`sampleLumaGrid` in `src/geometry.ts`), and the heightmap PNG
  export writes rows top-down. Before 2026-10-19 the image's top row went to `Y = 0`, which
  carved a mirror image. `npm run test:depthmap` T13b guards it.

`src/sbp/` is shared by the browser worker and the Node CLI. Keep it dependency-free of Node
built-ins or it breaks the web path at runtime rather than at build time.

## Verification

`AGENTS.md` carries the full manual checklist. The parts that are automatable and should run
before you claim a change is good:

```bash
npm run lint && npm run typecheck && npm run typecheck:cli
npm run test:relief
npm run test:gh-parity
npm run test:depthmap
npm run test:drape
npm run test:drape-parity
npm run test:cut
npm run test:relief-master
npm run stl-to-sbp -- <input.stl> --dry-run
```

`.github/workflows/ci.yml` runs lint, both typechecks, `test:relief`, `test:gh-parity`,
`test:depthmap`, `test:drape`, `test:drape-parity`, `test:cut`, `test:relief-master` and the build on every pull request.
`test:drape-parity` runs one full cloth simulation of the bundled bust against the Blender proof's reference
(`cli/fixtures/drape-silk-tilt25`); after any change under `src/drape-sim/`, paste its numbers in the PR.

Visual and interaction items (view modes, orbit and pinch, responsive under 900px, URL state
round-trip, depth map upload) are not covered by any suite. If a change touches them, verify
in a browser and say that you did. A passing gate suite is not evidence the render is right:
the voronoi-relief work in May 2026 passed all 22 assertions while being a visible regression.

## Git

- Branch from `main`. Do not commit directly to `main`: CI deploys `dist/` to Cloudflare Pages
  on every push to `main`, so a direct push is a production deploy.
- The Cloudflare Pages deploy failed repeatedly in August 2026 (last failure 2026-08-28) and has
  succeeded on every `main` push since 2026-10-03. A green local build is still not a deploy:
  check the run with `gh run list --workflow=deploy.yml --limit 5`.
- Preview a branch on the real CDN without touching production:
  `npm run build && npx wrangler@4 pages deploy dist --project-name=meshcraft --branch=<branch>`
  (credentials from `~/.zshenv`). Wrangler prints the preview URL.
- Review the diff on both surfaces before committing: the browser path and the SBP/CLI path.
- Never commit `.env`, screenshots, or temp files. `verification/` holds intentional
  screenshots; new ones do not belong there by default.

## Skills

Seven skills are mirrored across `.claude/skills/`, `.agents/skills/` and `.codex/skills/`,
kept in step by `sync-skills`. Present here: `frontend-design`, `plan`, `pr-review`,
`rhino-grasshopper-ghpython`, `shopbot-aspire`, `triage-pr-comments`, `voice-system`.

- `rhino-grasshopper-ghpython` for anything under `grasshopper/`, GhPython, RhinoCommon,
  `.gh` or `.3dm`. Mandatory there. IronPython 2.7 constraints apply, not Python 3.
- `shopbot-aspire` for toolpaths, feeds and speeds, bit selection, OpenSBP, `.sbp` output,
  and anything about the physical machine.
- `frontend-design` for the browser UI. The MESHCRAFT 3000 design system is documented there.
- `pr-review` and `triage-pr-comments` for review work. These two are the only skills the
  `.gitignore` comment claims are tracked; in practice all seven are tracked.
- `voice-system` for any user-facing copy, including sponsor-facing and README text.

## Surfaces and .gitignore

`.gitignore` excludes `.claude/`, `.codex/` and `.agents/` wholesale, then walks back down to
re-include the skill trees and this file. A bare negation cannot re-include a path whose
parent is still excluded, because git will not descend into an excluded directory. That is
why the rules are written as a descent (`!.claude/`, `.claude/*`, `!.claude/skills/`, and so
on) rather than a single pattern. Preserve that shape when editing.

`.claude/settings.local.json`, `.claude/projects/` and `.claude/launch.json` stay local-only
and are correctly ignored.

## Secrets

Follow the user-level rule in `~/.claude/CLAUDE.md`. Project-local secrets are in
`/Users/sawyer/Code/mesh-maker/.env`, gitignored. Read them directly with

```bash
VAR=$(grep '^KEY_NAME=' /Users/sawyer/Code/mesh-maker/.env | tail -1 | cut -d= -f2-)
```

Never echo a value back. `npm run deploy` requires `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in the environment and fails fast if either is missing.
