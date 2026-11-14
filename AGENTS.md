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
├── styles/main.css            # All CSS (one file)
├── src/
│   ├── main.ts                # Entry point: init, URL state, demo preload
│   ├── state.ts               # MeshState interface, STATE singleton, URL serialize/deserialize
│   ├── types.ts               # NoiseGenerator, FBMGenerator, relief and noise-grid parameter types
│   ├── noise/
│   │   ├── generators.ts      # 14+ noise classes + createNoiseGen() factory
│   │   ├── site-grid.ts       # Exact bucket lookup and incremental minimum separation
│   │   ├── voronoi-relief.ts  # Voronoi Relief sampler (cellular relief, attractors, starburst)
│   │   └── presets.ts         # CNC_PRESETS, PROFILES
│   ├── mesh.ts                # generateMesh (noise / depthmap / drape dispatch), debouncedGenerate
│   ├── geometry.ts            # Pure grid helpers: luma sampling, normalize, background cutoff,
│   │                          #   gaussianSmooth, triangle split + watertight enclosure emitters
│   ├── drape-ui.ts            # Drape tab: figure (bundled bust or upload), bare preview, Worker
│   │                          #   runs, result as an in-memory relief master (activeMaster())
│   ├── drape-controls.ts      # Drape controls table, presets (gathered, silk, quartering wind),
│   │                          #   controls -> solver parameters, carve (thickness, depth) remap
│   ├── drape-sim/             # Silk drape over a 3D figure (pure, browser Worker + Node):
│   │   ├── figure.ts          #   .mcfig container, pose (tilt, turn, lean), uploaded-mesh placement
│   │   ├── cloth.ts           #   Jolt Physics soft-body cloth; SILK, SILK_GATHERED; attraction, wind
│   │   ├── nearest.ts         #   nearest point on the figure's surface (voxel field, for attraction)
│   │   ├── raster.ts          #   frontmost depth along +Y (the relief's front view)
│   │   ├── subdiv.ts          #   Catmull-Clark smoothing of the solved cloth grid
│   │   ├── simplify.ts        #   welding and vertex clustering of figures over the 300 k-triangle cap
│   │   ├── pipeline.ts        #   figure -> drape -> 3:4 relief heights (12 x 16 in by default)
│   │   └── worker.ts          #   Worker entry (messages.ts)
│   ├── depth-estimate.ts      # Optional in-browser monocular depth (Depth-Anything-V2-small)
│   ├── slider-utils.ts        # Shared exact ranges, nominal keyboard steps, numeric edits and resets
│   ├── numeric-domain.ts      # Finite numeric input boundary and semantic count domains
│   ├── render.ts              # Three.js WebGL viewport: surface, wireframe, points, enclosure,
│   │                          #   elevation or neutral surface material
│   ├── export.ts              # Export dispatcher: STL (binary/ASCII), OBJ, 3DM, heightmap PNG
│   ├── export-surface.ts      # The one surface every export and toolpath reads (master or grid)
│   ├── mesh-writer.ts         # Pure grid -> indexed mesh -> STL/OBJ writers (browser + CLI)
│   ├── relief-master.ts       # .mcrelief data contract: parse/encode/verify, preview resample
│   ├── sbp-export.ts          # Web UI bridge: MeshCraft STATE -> SBP pipeline -> download
│   ├── ui.ts                  # Sidebar builder, sliders, depth map upload, presets, SBP section
│   ├── interaction.ts         # Mouse orbit/pan/zoom, touch pinch, scroll
│   ├── toolbar.ts             # Mode tabs, toolbar buttons, Copy Link, format-aware controls
│   ├── stats.ts               # zoomExtents, updateStats, format-aware overlay
│   ├── toast.ts               # Toast notifications
│   ├── sidebar-state.ts       # Pane scroll/focus and persistent section state
│   ├── sponsor.ts             # Explicit Sponsors pane + scroll-to-export
│   └── sbp/                   # Shared STL-to-SBP pipeline (web + CLI, zero Node deps)
│       ├── types.ts           # ToolDef, SbpConfig, ToolpathMove, ToolpathSection
│       ├── tools.ts           # Embedded ATC tool database + default tool config
│       ├── stl-parser.ts      # Binary STL parser + bounds validation
│       ├── heightmap.ts       # STL/STATE vertices -> regular Z grid
│       ├── compensate.ts      # Max-envelope tool compensation + exact triangle drop-cutter
│       ├── roughing.ts        # Roughing toolpath generation
│       ├── finishing.ts       # Finishing raster toolpath generation
│       ├── writer.ts          # OpenSBP file builder
│       ├── generate.ts        # SBP pipeline orchestrator
│       └── worker.ts          # Web Worker entry for uploaded STL processing
├── cli/
│   ├── stl-to-sbp.ts          # CLI entry point (tsx/Node)
│   ├── vtdb-reader.ts         # SQLite .vtdb reader (better-sqlite3)
│   ├── voronoi-relief.spec.ts # npm run test:relief
│   ├── grasshopper-parity.spec.ts # npm run test:gh-parity
│   ├── presets.spec.ts        # npm run test:presets (owned state, production geometry, SBP)
│   ├── depthmap.spec.ts       # npm run test:depthmap (luma, orientation, cutoff, share links)
│   ├── drape.spec.ts          # npm run test:drape (fast: figure, pose, extraction, forces, controls)
│   ├── drape-parity.spec.ts   # npm run test:drape-parity (~2.5 min: web silk and gathered vs Blender)
│   ├── drape-run.ts           # npm run drape-run (one web drape in Node, arrays for comparison)
│   ├── fixtures/drape-silk-tilt25/   # Blender proof reference (every 4th node) + provenance
│   ├── fixtures/drape-silk-gathered/ # Blender gathered-study reference + provenance
│   ├── sbp-cut.spec.ts        # npm run test:cut (compensation oracle + emitted-SBP cut replay)
│   ├── cut-sim.ts             # Independent swept-cutter simulation of an SBP file
│   ├── relief-master.spec.ts  # npm run test:relief-master (data contract, export fidelity)
│   ├── relief-roundtrip.ts    # npm run relief-roundtrip (master -> STL [-> SBP -> cut report])
│   └── png.ts                 # Minimal PNG writer for CLI diagnostics
├── grasshopper/               # Git-tracked Python components, native alternative and builder
│   ├── components/            # Canonical GhPython source
│   └── builder/               # Builder source and source-marshaling probe, no native .gh files
├── docs/images/               # README Grasshopper previews
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

- **Three.js WebGL renderer** (`src/render.ts`): Phong surface with analytical heightfield normals, an on-demand render loop (renders only when state changes), and an elevation-ramp or neutral surface material. Grids up to 400 columns (~250k cells) render interactively. (An earlier Canvas 2D painter's-algorithm renderer was replaced.)
- **Typed STATE singleton**: `MeshState` interface with 40+ typed keys. Direct mutation — no reactive/observer pattern. The call graph is explicit (slider → debounce → generate → render).
- **URL state sharing**: `serializeConfig()` encodes only keys differing from defaults as base64url JSON. "Copy Link" button in toolbar. Incompatible older payloads reset to defaults with a toast.
- **Watertight export**: Side walls + a bottom fan from one centre vertex (closed two-manifold, Euler characteristic 2) for CNC-ready meshes. Enforces minimum 0.01" material thickness to prevent degenerate triangles.
- **Relief master** (`src/relief-master.ts`, `.mcrelief`): a finished relief's float heights with dimensions, units, row order, backing, stock, mask, fixed triangulation and a SHA-256, imported without the image path's 8-bit read, normalization, cutoff or smoothing. The viewport shows a preview resample; every export and toolpath reads the master at full resolution. `scripts/relief/npy_to_mcrelief.py` packages one; `npm run relief-roundtrip` plus `scripts/relief/verify_export.py` (Blender) prove an export reproduces it.
- **Drape** (`src/drape-sim/`, `src/drape-ui.ts`): a silk veil simulated over a complete 3D figure with Jolt Physics in a Worker, then seen from the front as a 3:4 relief (3 x 4 to 18 x 24 in, set with the X / Y sliders; SBP export refuses a carve that does not fit the bed with its X / Y offset; Material Thickness up to 2.6 in, Relief Depth above at least 1/16 in of backing) that becomes the active relief master. It reproduces the Blender drapes in `scripts/drape/` (the local workflow: `python3 scripts/drape/workflow.py FIGURE --preset silk-gathered|silk-tilt25|silk-tilt35|silk-tilt25-cling --out DIR`); the gathered silk (surface attraction) is the default. Every variable the Blender study varied has a control (`src/drape-controls.ts`) except the air-damping ramp, the separate object and self-collision gaps (Jolt has one cloth radius and no self-collision), the measured wind panels (the web targets a circle) and the 0.05 to 0.0025 bending change (calibrated silk already has no bending resistance); solver internals calibrated against Blender (friction, edge compliance, fps) have no control. Figures are `.mcfig` (written by `scripts/drape/export_figure.py`) or STL/OBJ/PLY/glTF/USD(Z) meshes turned with an up axis and turn, centred across the panel and fitted to 90% of it (`figureFromMesh`, so their units do not matter); an upload hangs from the middle of its top (header `anchor: 'top-centre'`, `figureAnchor`) while the bundled and Blender figures hang from their highest point, bit for bit as before; a mesh (or a `.mcfig`, header kept) over 300,000 triangles (`MAX_FIGURE_TRIANGLES`, Jolt's 128 MiB heap measured with the largest cloth) is split (`splitForDrape`): the cloth collides with a copy simplified by vertex clustering (`simplify.ts`), while the bare relief and the drape's extraction read every triangle of the original, posed by the same rigid motion (`poseWithDetail`, the original's anchor), so the carve keeps detail finer than the copy. A triangle soup (binary STL) is welded first (`weldVertices`); an 8.8 M-triangle STL welds in under a second and its front view rasterizes in about 0.1 s in Node. `drape-run` splits a dense `.mcfig` the same way. An uploaded mesh that winds inward is turned outward (`windsInward`: on a nearly closed mesh, openness at most 0.4, the area-weighted agreement of normals with their direction from the centroid is below -0.05), since Jolt collides the cloth with a triangle's front only and a flipped export lets the cloth fall through; open surfaces (plaques, trays, front-only scans) are never turned, since a front-wound bowl and an inward dome cannot be told apart. A full mesh over 256 MiB (`MAX_DETAIL_BYTES`) is carved from the simplified copy, with a toast. Figure Size then scales any figure about its crown. A lazily loaded chunk or Worker that fails to load is checked against the live index (`src/stale-build.ts`): after a deploy the user is told to reload, nothing reloads by itself. Parity with Blender is gated by `npm run test:drape-parity`; the browser and Node runs produce identical heights.
- **Tool compensation** (`src/sbp/compensate.ts`): tip = max over the cutter footprint of (surface - cutter profile), side angles from the tool axis. Finishing drops the cutter at every emitted point onto the exported triangles (vertex, edge and facet contact) instead of interpolating node tips; roughing carries segment and between-node margins. `npm run test:cut` replays the emitted SBP text through `cli/cut-sim.ts`, which shares no code with `src/sbp/`, on a grid finer than the target, against the triangulated surface.
- **Carve limits**: stock thickness and depth below stock top are each capped at 2.6 in. Machine travel remains 36 x 24 in with 6 in Z travel. Browser work offsets retain the preferred 2 in where possible and clamp each axis to the room left by the actual source, including the uploaded STL raster.
- **Relief depth and smoothing**: cellular relief treats Cut Depth as an upper bound and never amplifies its raw range. Scalar noise and depth maps retain full-depth normalization. Gaussian smoothing uses a radius in inches (sigma), with preset radii converted from the previous 400-column settings. Capped cell layouts retain representative Cartesian sites and report the candidate count.
- **Preset ownership**: `presetState()` resets all noise, relief, dimensions, stock and smoothing fields from defaults before applying a preset. Seed, resolution, camera, mode and export settings are retained; texture profiles remain modifiers.

---

The two native `.gh` artifacts live in
`/Users/sawyer/Code/sawyer-design/rhino-aspire-grasshopper/rhino/grasshopper/meshcraft-repo/`.
Current Python sources and parity tests stay here. Read that folder's README before
regenerating artifacts in Rhino 7. The separate DLL work-in-progress branch remains in
the parent Grasshopper library.

## Deployment

**Platform**: Cloudflare Pages (static site hosting)
**Pages URL**: `meshcraft.pages.dev`
**Custom domain**: `meshcraft.sawyerdesign.io`
**Account ID**: supply `CLOUDFLARE_ACCOUNT_ID` via local environment or CI secrets

**CI/CD**: GitHub Actions on push to `main` runs `npm ci`, `npm run lint` and `npm run build`, then deploys `dist/`. `deploy.yml` `paths-ignore` skips pushes that only touch agent and doc files (`.claude/**`, `.agents/**`, `.codex/**`, `CONTEXT/**`, `docs/**`, `README.md`, `AGENTS.md`).

**Manual deploy**:

```bash
npm run deploy    # build, then wrangler pages deploy --branch=main (production); needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID exported
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
- [ ] Every noise type `createNoiseGen()` dispatches (`src/noise/generators.ts`) generates
- [ ] All 4 view modes render (Solid, Wire, Both, Points)
- [ ] Every preset in `CNC_PRESETS` (`src/noise/presets.ts`) applies correctly
- [ ] Depth map upload works (click + drag-and-drop)
- [ ] Export produces valid STL/OBJ/heightmap files
- [ ] Watertight toggle adds bottom + sides
- [ ] Mouse orbit, pan (shift/right-click), zoom (scroll) work
- [ ] Touch: single finger orbit, two finger pan+pinch zoom
- [ ] Responsive layout at < 900px
- [ ] URL state sharing: copy link → open in new tab → same config loads; older incompatible links reset with a toast
- [ ] `npm run test:presets` checks preset order, geometry and default SBP export
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
| Demo depth map | `imagedelivery.net/.../w=800` (Mona Lisa, Depth Map tab) | Null (user uploads their own) |
| Demo drape figure | `/demo/venus-de-milo.mcfig` (bundled, CC0, Drape tab) | Status line asks for an upload |

All external resources have graceful fallbacks. The tool is fully functional offline except for font loading.

---

## Git Safety

- NEVER commit `.env` files
- NEVER commit screenshots or temp files
- Review diffs before committing — verify both the browser surface and the SBP/CLI surfaces

## Project artwork, Blender studies and handoff files

The MeshCraft drape feature does not make project artwork or video assets part of this software repository. Keep reusable application/solver/export tools and intentional regression fixtures here. Put durable project Blender scenes, studies, simulations, animations, renders and fabrication outputs in the identified sawyer-design/artwork project or its mapped Dropbox/media storage, never new `.codex/`, `.claude/` or agent-cache artifact trees. Reuse the entity's existing work area and meaningful numbered revision checkpoints. Run project-specific tool outputs into that project's destination (the drape workflow supports `--out`) and record code/configuration provenance. Preserve existing artifacts and software fixtures until deliberately reconciled; do not relocate or delete them by filename. Read `../sawyer-design/sd-studio/Reference/SD-Studio rules.md` (storage, names and revisions, fabrication handoff) before new artwork/animation work. Cloud-only Dropbox deliveries stay cloud-only; shop geometry uses durable project export packets and the existing sawyer-design outbox/SMB/Tailscale handoff.

Nick's umbrella artwork is **26-finding fabric**: shared drape research, Virgin/Eufy print, hanging carving and chess-table applications. Its home is `../sawyer-design/2026/projects/26_Finding-Fabric/` (working name `26_Finding-Fabric`, immutable ID `26-finding-fabric`); `../sawyer-design/projects/26-finding-fabric` is a legacy alias to it. Existing G-ROLL/outbox paths stay unchanged; media archives externally after actual completion/release. New owner-selected personal project homes use the tested v2 initializer in `../sawyer-design/tools/project-init/`, not the old one; client work becomes a project only through that tool's evidence-checked conversion command (`../sawyer-design/tools/project-init/scripts/lead_promote.py`) after accepted scope, a verified received deposit and Nick's decision (`../sawyer-design/projects/README.md`). Current source migration/master selection remain pending; keep reusable software here and never automatically edit/replace/promote into Nick's owner-controlled Dropbox Rhino master.

For artwork tasks, project automation belongs under its owner's scripts/ tree; no scattered Python/launcher variants. Keep this deployed application's established src/package/test architecture and intentional regression fixtures intact. Study filenames use accurate descriptions, optional useful version and yymmdd; repair broken unissued native work in place rather than retaining another broken version/date copy unless Nick asks. Use bounded project working-cache/render-cache mappings, never new agent artifact trees. Verified completed video jobs may clean only their owned redundant frame sequence after full decode/spec receipt; preserve failed jobs, requested stills/sequence deliveries and selected simulation bakes. Detailed rules are in `../sawyer-design/sd-studio/Reference/SD-Studio rules.md`.
