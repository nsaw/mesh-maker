# CLAUDE.md — MeshCraft 3000

## Project Overview

MeshCraft 3000 is a browser-based 3D mesh generator for CNC machining (ShopBot Desktop Max ATC). Built with Vite + TypeScript, deployed as a static site.

**Live site**: `meshcraft.sawyerdesign.io` (Cloudflare Pages)
**Repo**: `github.com/nsaw/mesh-maker`

---

## Architecture

Vite + TypeScript ES modules, 13 source files:

```
meshcraft/
├── index.html                 # HTML shell
├── styles/main.css            # All CSS (~490 lines)
├── src/
│   ├── main.ts                # Entry point: init, URL state, demo preload
│   ├── state.ts               # MeshState interface, STATE singleton, URL serialize/deserialize
│   ├── types.ts               # Vertex3D, Triangle, MeshData, NoiseGenerator interfaces
│   ├── noise/
│   │   ├── generators.ts      # 5 noise classes + createNoiseGen() factory
│   │   └── presets.ts         # CNC_PRESETS (9), PROFILES (6)
│   ├── mesh.ts                # generateMesh, weightedSmooth, debouncedGenerate
│   ├── render.ts              # Canvas 2D 3D rendering (painter's algo, Gouraud shading)
│   ├── export.ts              # STL (binary/ASCII), OBJ, heightmap PNG export
│   ├── ui.ts                  # Sidebar builder, sliders, depth map upload, presets
│   ├── interaction.ts         # Mouse orbit/pan/zoom, touch pinch, scroll
│   ├── toolbar.ts             # Mode tabs, toolbar buttons, Copy Link (URL sharing)
│   ├── stats.ts               # zoomExtents, updateStats, formatBytes
│   └── sponsor.ts             # Sponsor modal + scroll-to-export
├── public/
│   ├── _redirects             # Cloudflare Pages: / -> /index.html
│   └── monalisa-depthMap.jpeg # Demo depth map
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### Key Design Decisions

- **Canvas 2D, not WebGL**: Intentional. Simpler, more portable, no shader compilation. Performance is adequate for CNC mesh resolution (<256x256 grids).
- **Typed STATE singleton**: `MeshState` interface with 40+ typed keys. Direct mutation — no reactive/observer pattern. The call graph is explicit (slider → debounce → generate → render).
- **URL state sharing**: `serializeConfig()` encodes only keys differing from defaults as base64url JSON. "Copy Link" button in toolbar.
- **Watertight export**: Bottom face + side walls for CNC-ready meshes. Enforces minimum 0.01" base thickness to prevent degenerate triangles.
- **ShopBot defaults**: 36"x24" max dimensions, 6" Z limit — hardcoded for the ShopBot Desktop Max ATC.

---

## Deployment

**Platform**: Cloudflare Pages (static site hosting)
**Pages URL**: `meshcraft.pages.dev`
**Custom domain**: `meshcraft.sawyerdesign.io`
**Account ID**: `ff4a53e6bc626ee548c280edfbb6aa16`

**CI/CD**: GitHub Actions on push to `main` — runs `npm ci && npm run build`, deploys `dist/`.

**Manual deploy**:

```bash
npm run build
source ~/.env.zsh && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_WORKERS_API \
CLOUDFLARE_ACCOUNT_ID=ff4a53e6bc626ee548c280edfbb6aa16 \
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
- [ ] All 9 CNC presets apply correctly
- [ ] Depth map upload works (click + drag-and-drop)
- [ ] Export produces valid STL/OBJ/heightmap files
- [ ] Watertight toggle adds bottom + sides
- [ ] Mouse orbit, pan (shift/right-click), zoom (scroll) work
- [ ] Touch: single finger orbit, two finger pan+pinch zoom
- [ ] Responsive layout at < 900px
- [ ] URL state sharing: copy link → open in new tab → same config loads

---

## Code Quality Rules

- **No `console.log`** — this is a production tool, not a debug environment
- **No TODO/FIXME in production paths** — fix it or don't ship it
- **Escape user input in innerHTML** — `STATE.depthMapName` is user-controlled (file upload name). Always escape `<` and `>` when interpolating into HTML.
- **Revoke object URLs** — every `URL.createObjectURL()` must have a matching `URL.revokeObjectURL()` in both success and error paths
- **No degenerate triangles in exports** — enforce minimum base thickness (0.01") when watertight is enabled

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
- Review diffs before committing — 13 source files means verify scope
