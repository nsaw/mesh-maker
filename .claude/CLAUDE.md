# CLAUDE.md — MeshCraft 3000

## Project Overview

MeshCraft 3000 is a browser-based 3D mesh generator for CNC machining (ShopBot Desktop Max ATC). Single static HTML file — no build step, no framework, no server-side logic.

**Live site**: `meshcraft.sawyerdesign.io` (Cloudflare Pages)
**Repo**: `github.com/nsaw/mesh-maker`

---

## Architecture

Single file: `meshcraft.html` (~2100 lines)

```
meshcraft.html
├── CSS (~490 lines) — Dark theme, responsive layout, custom controls
├── HTML (~50 lines) — Header, sidebar, viewport canvas, export bar
└── JS (~1550 lines)
    ├── Noise algorithms — Simplex, Perlin, Ridged, FBM, Voronoi
    ├── Mesh generation — Height field from noise or depth map image
    ├── 3D rendering — Canvas 2D with painter's algorithm, Gouraud shading
    ├── Export — STL (binary/ASCII), OBJ, heightmap PNG
    ├── UI — Dynamic sidebar, sliders, presets, section collapse
    └── Interaction — Mouse orbit/pan/zoom, touch pinch, scroll
```

### Key Design Decisions

- **Canvas 2D, not WebGL**: Intentional. Simpler, more portable, no shader compilation. Performance is adequate for CNC mesh resolution (<256x256 grids).
- **No build step**: Single HTML file loads directly in any browser. External dependencies are Google Fonts only.
- **Watertight export**: Bottom face + side walls for CNC-ready meshes. Enforces minimum 0.01" base thickness to prevent degenerate triangles.
- **ShopBot defaults**: 36"x24" max dimensions, 6" Z limit — hardcoded for the ShopBot Desktop Max ATC.

---

## Deployment

**Platform**: Cloudflare Pages (static site hosting)
**Pages URL**: `meshcraft.pages.dev`
**Custom domain**: `meshcraft.sawyerdesign.io` (pending DNS CNAME)
**Account ID**: `ff4a53e6bc626ee548c280edfbb6aa16`

**Deploy command**:

```bash
# From project root — uses CLOUDFLARE_WORKERS_API token from ~/.env.zsh
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_WORKERS_API \
CLOUDFLARE_ACCOUNT_ID=ff4a53e6bc626ee548c280edfbb6aa16 \
wrangler pages deploy . --project-name=meshcraft --branch=main
```

**Root URL routing**: `_redirects` file rewrites `/` → `/meshcraft.html` (Cloudflare Pages expects `index.html` by default).

---

## Development

No build step. Edit `meshcraft.html`, open in browser, test.

```bash
# Local dev server
python3 -m http.server 8765
# Then open http://localhost:8765/meshcraft.html
```

### Testing Checklist

When modifying the file, verify:
- [ ] All 5 noise algorithms generate (Simplex, Perlin, Ridged, FBM, Voronoi)
- [ ] All 4 view modes render (Solid, Wire, Both, Points)
- [ ] All 9 CNC presets apply correctly
- [ ] Depth map upload works (click + drag-and-drop)
- [ ] Export produces valid STL/OBJ/heightmap files
- [ ] Watertight toggle adds bottom + sides
- [ ] Mouse orbit, pan (shift/right-click), zoom (scroll) work
- [ ] Touch: single finger orbit, two finger pan+pinch zoom
- [ ] Responsive layout at < 900px

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
| Demo depth map | `sawyerdesign.io/.../monalisa-1.jpeg` | Null (user uploads their own) |

All external resources have graceful fallbacks. The tool is fully functional offline except for font loading.

---

## Git Safety

- NEVER commit `.env` files
- NEVER commit screenshots or temp files
- Single-file project: be cautious with large diffs, review before committing
