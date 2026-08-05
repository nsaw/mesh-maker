# AGENTS.md — MESHCRAFT

## Project Overview

MESHCRAFT is a browser-based 3D mesh generator and ShopBot SBP toolpath compiler for CNC machining (ShopBot Desktop Max ATC). Built with Vite + TypeScript, with a shared SBP pipeline used by both the web app and the CLI.

**Live site**: `meshcraft.sawyerdesign.io` (Cloudflare Pages)
**Repo**: `github.com/nsaw/mesh-maker`

---

## Secrets & Environment Files (READ DIRECTLY — DO NOT ASK)

ALL secrets, API keys, and config env vars live in the files below. **Read them directly. Never ask where a secret is — grep the relevant file.**

### User-level (shared across all projects)
- `/Users/sawyer/.env` — primary canonical secrets store
- `/Users/sawyer/.env.zsh` — shell-export form
- `/Users/sawyer/.zshenv` — shell init that sources `.env.zsh`

### Project-local (mesh-maker, gitignored)
- `/Users/sawyer/Code/mesh-maker/.env`

### Read pattern (preferred over `source`)
```bash
VAR=$(grep '^KEY_NAME=' /path/to/.env | tail -1 | cut -d= -f2-)
```

### NEVER
- Commit `.env*` files (already gitignored)
- Echo a secret value in agent responses
- Write a secret into any file under the repo root other than the gitignored env files

---

## Architecture

Vite + TypeScript ES modules with a browser UI, shared SBP pipeline, and a Node CLI:

```text
meshcraft/
├── index.html                 # HTML shell
├── styles/main.css            # All CSS (~490 lines)
├── src/
│   ├── main.ts                # Entry point: init, URL state, demo preload
│   ├── state.ts               # MeshState interface, STATE singleton, URL serialize/deserialize
│   ├── types.ts               # Vertex3D, Triangle, MeshData, NoiseGenerator interfaces
│   ├── noise/
│   │   ├── generators.ts      # 14+ noise classes + createNoiseGen() factory
│   │   └── presets.ts         # CNC_PRESETS (15), PROFILES (6)
│   ├── mesh.ts                # generateMesh, weightedSmooth, debouncedGenerate
│   ├── render.ts              # Canvas 2D 3D rendering (painter's algo, Gouraud shading)
│   ├── export.ts              # STL (binary/ASCII), OBJ, heightmap PNG export dispatcher
│   ├── sbp-export.ts          # Web UI bridge: MeshCraft STATE -> SBP pipeline -> download
│   ├── ui.ts                  # Sidebar builder, sliders, depth map upload, presets, SBP section
│   ├── interaction.ts         # Mouse orbit/pan/zoom, touch pinch, scroll
│   ├── toolbar.ts             # Mode tabs, toolbar buttons, Copy Link, format-aware controls
│   ├── stats.ts               # zoomExtents, updateStats, format-aware overlay
│   ├── toast.ts               # Toast notifications
│   ├── sponsor.ts             # Sponsor modal + scroll-to-export
│   └── sbp/                   # Shared STL-to-SBP pipeline (web + CLI, zero Node deps)
│       ├── types.ts           # ToolDef, SbpConfig, ToolpathMove, ToolpathSection
│       ├── tools.ts           # Embedded ATC tool database + default tool config
│       ├── stl-parser.ts      # Binary STL parser + bounds validation
│       ├── heightmap.ts       # STL/STATE vertices -> regular Z grid
│       ├── compensate.ts      # Tool compensation / erosion
│       ├── roughing.ts        # Roughing toolpath generation
│       ├── finishing.ts       # Finishing raster toolpath generation
│       ├── writer.ts          # OpenSBP file builder
│       ├── generate.ts        # SBP pipeline orchestrator
│       └── worker.ts          # Web Worker entry for uploaded STL processing
├── cli/
│   ├── stl-to-sbp.ts          # CLI entry point (tsx/Node)
│   └── vtdb-reader.ts         # SQLite .vtdb reader (better-sqlite3)
├── public/
│   ├── _redirects             # Cloudflare Pages: / -> /index.html
│   └── monalisa-depthMap.jpeg # Demo depth map
├── stl-to-sbp.sh              # Shell wrapper for CLI invocation
├── tsconfig.cli.json          # CLI-only TypeScript config
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### Key Design Decisions

- **Canvas 2D, not WebGL**: Intentional. Simpler, more portable, no shader compilation. Performance is adequate for CNC mesh resolution (<256x256 grids).
- **Typed STATE singleton**: `MeshState` interface with 40+ typed keys. Direct mutation — no reactive/observer pattern. The call graph is explicit (slider → debounce → generate → render).
- **URL state sharing**: `serializeConfig()` encodes only keys differing from defaults as base64url JSON. "Copy Link" button in toolbar.
- **Watertight export**: Bottom face + side walls for CNC-ready meshes. Enforces minimum 0.01" material thickness to prevent degenerate triangles.
- **ShopBot defaults**: 36"x24" max dimensions, 6" Z limit — hardcoded for the ShopBot Desktop Max ATC.

---

## Deployment

**Platform**: Cloudflare Pages (static site hosting)
**Pages URL**: `meshcraft.pages.dev`
**Custom domain**: `meshcraft.sawyerdesign.io`
**Account ID**: supply `CLOUDFLARE_ACCOUNT_ID` via local environment or CI secrets

**CI/CD**: GitHub Actions on push to `main` — runs `npm ci && npm run build`, deploys `dist/`.

**Manual deploy**:

```bash
npm run build
source ~/.env.zsh && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_WORKERS_API \
CLOUDFLARE_ACCOUNT_ID=<CLOUDFLARE_ACCOUNT_ID> \
wrangler pages deploy dist --project-name=meshcraft --branch=main
```

---

## Development

```bash
npm install        # First time
npm run dev        # Vite dev server with HMR (http://localhost:5173)
npm run build      # tsc + vite build → dist/
npm run preview    # Preview production build
```

### Testing Checklist

When modifying the codebase, verify:
- [ ] All 5 noise algorithms generate (Simplex, Perlin, Ridged, FBM, Voronoi)
- [ ] All 4 view modes render (Solid, Wire, Both, Points)
- [ ] All 15 CNC presets apply correctly
- [ ] Depth map upload works (click + drag-and-drop)
- [ ] Export produces valid STL/OBJ/heightmap files
- [ ] Watertight toggle adds bottom + sides
- [ ] Mouse orbit, pan (shift/right-click), zoom (scroll) work
- [ ] Touch: single finger orbit, two finger pan+pinch zoom
- [ ] Responsive layout at < 900px
- [ ] URL state sharing: copy link → open in new tab → same config loads
- [ ] `npm run stl-to-sbp -- <input.stl> --dry-run` completes with valid summary output
- [ ] SBP STL upload path still works in the browser worker (`src/sbp/worker.ts`)
- [ ] SBP export output changes when roughing/finishing settings or raster angle change

---

## Code Quality Rules

- **No `console.log`** — this is a production tool, not a debug environment
- **No TODO/FIXME in production paths** — fix it or don't ship it
- **No `innerHTML` for user-influenced content** — values like `STATE.depthMapName` must be rendered via DOM node creation, `appendChild`, and `textContent`, not string interpolation into `innerHTML`
- **Revoke object URLs** — every `URL.createObjectURL()` must have a matching `URL.revokeObjectURL()` in both success and error paths
- **No degenerate triangles in exports** — enforce minimum material thickness (0.01") when watertight is enabled

---

## External Resources

| Resource | URL | Fallback |
|----------|-----|----------|
| Google Fonts | `fonts.googleapis.com` | System fonts (Ubuntu → sans-serif) |
| Logo image | `imagedelivery.net/...` | Hidden via `onerror` attribute |
| Demo depth map | `imagedelivery.net/.../w=800` (Mona Lisa) | Null (user uploads their own) |

All external resources have graceful fallbacks. The tool is fully functional offline except for font loading.

---

## Git Safety

- NEVER commit `.env` files
- NEVER commit screenshots or temp files
- Review diffs before committing — verify both the browser surface and the SBP/CLI surfaces


<claude-mem-context>
# Memory Context

# [mesh-maker] recent context, 2026-05-13 5:59pm PDT

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 32 obs (15,196t read) | 1,359,764t work | 99% savings

### May 12, 2026
856 8:27p ⚖️ MeshCraft Radial Focal-Point Distortion Feature — Design Exploration
857 " 🔵 MeshCraft VoronoiReliefGen Architecture — Full Source Audit
S155 Continue radial-foci (starburst) Voronoi relief feature development, verify work, deploy to production, commit, push to GitHub, create PR, and begin automated code review loop (May 12 at 8:28 PM)
S153 MeshCraft multi-focal radial starburst effect — architecture analysis and implementation design for voronoi-relief engine (May 12 at 8:28 PM)
858 8:30p 🔵 MeshCraft State/UI/Mesh Architecture — Full Implementation Surface for Starburst Feature
859 8:31p ⚖️ MeshCraft Radial-Foci Starburst Feature — Full Implementation Plan Written
S156 Triage and autofix PR #16 (radial-foci starburst) review comments from CodeRabbit ASSERTIVE and Greptile (May 12 at 8:31 PM)
S157 mesh-maker PR #16 triage-pr-comments autofix loop: fix, commit, push, reply to reviewers, deploy (May 12 at 10:38 PM)
860 10:54p 🔴 PR #16 Round-1 Review Fixes Committed and Deployed
861 11:09p ✅ PR #16 Review Threads Replied To and Resolved via GitHub API
S158 mesh-maker PR #16 triage-pr-comments autofix loop (rounds 1 and 2 complete, waiting for round 3) (May 12 at 11:10 PM)
862 11:21p 🔵 Round-2 Review Scan: One New Unresolved Thread Found
863 11:22p 🔵 Greptile Round-2 Summary: Confidence 4/5, One Remaining Blocker
864 " 🔵 meshcraft_builder.py Has Own PRESETS Table Missing relief-starburst
865 " 🔵 Builder Has Second Preset Gap: PRESET_NAMES List Also Missing relief-starburst
866 11:23p 🔴 meshcraft_builder.py: Added relief-starburst to Builder PRESETS Dict
867 " 🔴 meshcraft_builder.py: PRESET_NAMES List and All Gates Pass for Round-2 Fix
868 " ✅ Round-2 Fix Committed, Pushed, and Deployed
869 11:24p ✅ Round-2 Greptile Thread Replied To and Resolved
S159 mesh-maker PR #16 triage-pr-comments autofix loop — COMPLETE. Greptile 5/5, CodeRabbit clean, all 6 threads resolved. (May 12 at 11:24 PM)
870 11:36p 🔵 Round-3 Scan: Zero Unresolved Threads, Greptile Updated, CodeRabbit Updated
871 " 🔵 PR #16 Triage Loop Complete: Greptile 5/5, CodeRabbit Zero Actionable Comments
S160 mesh-maker v2 starburst (polar-grid Voronoi) implementation complete — commit pushed, PR #16 updated, CI wait in progress (May 12 at 11:36 PM)
### May 13, 2026
872 9:11a 🔵 Starburst Visual Result Mismatch: "Butthole" Pattern vs. Geometric Radial Warping
877 " 🔵 Starburst "Butthole" Bug: Three Coupled Root Causes Identified
878 " ⚖️ Radial-Foci v2 Plan: Replace Metric Anisotropy + Site-Warp with Polar-Grid Site Placement
873 9:14a 🔵 mesh-maker lacks .cursor/contracts lessons-learned file
874 " 🔵 MeshCraft 3000 design system documented in frontend-design skill
875 " 🔵 Voronoi relief radial-foci system architecture mapped
876 9:15a 🔵 Voronoi relief test suite passing and codebase has no anti-patterns
884 9:16a 🔵 Voronoi Relief Starburst: Hub-Site Absence Confirmed as Primary Root Cause
885 " 🔵 GH Parity Test Failing: Comment Drift in relief-starburst Entry
886 " ⚖️ Starburst Fix Plan: 8-Part Algorithm Change for True Hub-Cell Expansion
887 " 🔵 Starburst Implementation Regressed: Mandala Then Further Away from Reference
S161 mesh-maker v2 starburst adversarial self-critique, gap fixes, full gate suite, commit + push to PR #16, Cloudflare Pages deploy (May 13 at 9:23 AM)
879 9:37a 🟣 mesh-maker v2 starburst adversarial self-review initiated with visual evidence
880 " 🟣 mesh-maker v2 polar-grid starburst committed and deployed (e58c302)
881 " ⚖️ v3 starburst design: abandon polar-grid placement, return to Cartesian Voronoi + anisotropy metric
S162 Voronoi relief v3 implementation — replace v2 polar-grid (mandala) with Cartesian Voronoi + metric anisotropy + density boost near foci (May 13 at 9:51 AM)
882 3:36p 🟣 v3 starburst lever 1: Gaussian site-density boost in generateSites
883 3:39p 🔵 v3 Voronoi relief regression: radial character lost, mandala direction was correct
S163 Voronoi relief starburst v3 investigation — visual regression after deployment, corrective plan needed (May 13 at 3:42 PM)
**Investigated**: The primary session resumed v3 implementation work that was in-flight before compaction. It completed the final cleanup tasks: replaced the failing v2 5x5-patch hole-at-center test in `cli/voronoi-relief.spec.ts` with a v3-appropriate bottom-5%-quantile assertion (the old test expected 20% local variation at the focus center, but v3's organic Voronoi keeps focus centers as normal cell pixels at ~18.6% — below threshold). All 22 spec assertions now pass. The full v3 implementation was committed as `7ead552` and deployed to `https://4eefbaa3.meshcraft.pages.dev`. After visual verification by Nick (images #9, #10, #11), a critical regression was identified: v3 lost ALL radial character and reverted to a uniform pocketed mesh.

**Learned**: 1. v3's Cartesian-jittered Voronoi + per-pixel metric anisotropy approach PASSES all automated gate tests (anti-mandala crossing-count test, anti-pucker bottom-5%-quantile test, finiteness, range, catastrophic-jump guard) but FAILS visual inspection — the radial starburst effect is not visible.
    2. The `blend = wMax × coherence` formula likely double-suppresses the effect: `wMax` may be significantly less than 1 at useful focal distances, AND `coherence` is also < 1, so the product is small. The anisotropy scale boost of `1.5 × radialStrength × blend` may be too subtle to visibly elongate cells.
    3. Nick explicitly confirmed: "The mandalas were the correct direction." The v2 polar grid's mechanically perfect concentric rings (which the team was trying to AVOID) were paradoxically closer to the reference starburst target than v3's organic-but-uniform output.
    4. The anti-mandala test passed, confirming v3 truly eliminated polar ring structure — but that structure was what gave v2 its visible radial character. The test caught the wrong thing to optimize against.
    5. The Gaussian influence field with σ = 0.4 × panel_diagonal may blur the anisotropy effect too broadly, or the coherence weighting suppresses blend specifically near the focus where it matters most (because near-focus pixels have less multi-focus interference, but the formula still penalizes them).
    6. The current state: `generatePolarSites` deleted, `generateSites` Cartesian with density boost, `pixelAnisoFrame` with 12-param signature returning `{cosA, sinA, scale, blend}`. `relief-starburst` preset: `reliefCellSize:2.2`.

**Completed**: - Replaced failing 5x5-patch focus-hole test with bottom-5%-quantile assertion in `voronoi-relief.spec.ts`
    - Ran `npm run test:relief` — ALL OK (22/22 assertions)
    - Ran `npm run deploy` — deployed to `https://4eefbaa3.meshcraft.pages.dev`
    - Committed all v3 changes as `7ead552` on `feature/voronoi-relief` branch, pushed to GitHub
    - v3 files changed: `voronoi-relief.ts`, `state.ts`, `ui.ts`, `presets.ts`, `index.html`, `voronoi-relief.spec.ts` (6 files, 262 insertions, 238 deletions)
    - Received visual feedback from Nick: v3 is a regression vs v2 — uniform pocketed mesh, no visible radial elongation

**Next Steps**: Investigate the root cause of v3's invisible radial character and produce a corrective plan. Key questions to answer:
    1. Read `pixelAnisoFrame` in `src/noise/voronoi-relief.ts` — what is the actual numeric magnitude of `blend = wMax × coherence` at typical focal distances (e.g., 20%, 40%, 60% of panel diagonal)? Is the anisotropy scale factor large enough to visibly elongate cells?
    2. Is `ANISOTROPY_SCALE_MULTIPLIER = 1.5` × `radialStrength (1.6)` × `blend` sufficient, or does it need to be 3-5x?
    3. Is the Gaussian σ too broad (smearing the effect across the whole panel) or too narrow (invisible except in a tiny zone)?
    4. Does the `coherence` term actively suppress blend near the focus (where the starburst should be strongest)?
    5. Candidate fixes: stronger anisotropy scale override near focus (e.g., 3-5x direct at focus, not linear blend); hybrid approach keeping polar site placement in near-focus zone; explicit per-site radial orientation injection post-Lloyd; or abandoning per-pixel metric in favor of per-SITE metric deformation during site generation.


Access 1360k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>