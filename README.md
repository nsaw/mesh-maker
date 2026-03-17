# MeshCraft 3000

<p align="center">
  <img src="https://imagedelivery.net/7Un9nY7FmOV52M6-Dm1bzA/a3602ddf-a7fe-4a5c-c8c0-5aa21ba85f00/w=800" alt="MeshCraft 3000" width="600">
</p>

**Browser-based 3D mesh generator for CNC machining.**

[**Try it live**](https://meshcraft.sawyerdesign.io) &nbsp;|&nbsp; Built by [Sawyer Design](https://sawyerdesign.io)

<br>

<p align="center">
  <img src="https://imagedelivery.net/7Un9nY7FmOV52M6-Dm1bzA/ef64f44c-42cc-451d-f1de-b51229a45600/w=800" alt="ShopBot Desktop Max ATC" width="600">
</p>

<h3 align="center">Sponsored by <a href="https://shopbottools.com/products/desktop-max-atc/">ShopBot</a></h3>

<p align="center">
  This project is proudly sponsored by <a href="https://shopbottools.com/products/desktop-max-atc/"><strong>ShopBot Tools</strong></a>.<br>
  MeshCraft 3000 was built for and tested on the <a href="https://shopbottools.com/products/desktop-max-atc/">ShopBot Desktop Max ATC</a> — a production-grade CNC with automatic tool changing.
</p>

<p align="center">
  <a href="https://shopbottools.com/products/desktop-max-atc/">
    <img src="https://imagedelivery.net/7Un9nY7FmOV52M6-Dm1bzA/b657c94b-f67c-4a12-9b3d-64930c5e5900/w=800" alt="ShopBot Desktop Max ATC" width="400">
  </a>
</p>

<p align="center">
  <a href="https://bitsbits.com">
    <img src="https://imagedelivery.net/7Un9nY7FmOV52M6-Dm1bzA/7d4ecee6-c56f-4e09-dd49-c24553552900/w=400" alt="bitsbits.com" width="200">
  </a>
</p>

<p align="center">
  Also sponsored by <a href="https://bitsbits.com"><strong>bitsbits.com</strong></a>
</p>

---

## What It Does

Generate 3D meshes from procedural noise or depth map images, tuned for CNC machining. Export watertight STL, OBJ, or heightmap PNG files ready for your CAM software.

### Features

- **5 noise algorithms** — Simplex, Perlin, Ridged, FBM, Voronoi
- **Depth map import** — Upload any image, blend with noise
- **CNC presets** — 9 presets tuned for the ShopBot Desktop Max ATC (36" x 24", 6" Z)
- **Watertight export** — Bottom face + side walls for CNC-ready meshes
- **Multiple formats** — STL (binary/ASCII), OBJ, 3DM, heightmap PNG
- **Real-time 3D preview** — Orbit, pan, zoom with mouse or touch
- **Shareable configs** — Copy Link encodes your mesh settings into a URL

### View Modes

Solid, Wireframe, Both, Points — switch between render modes to inspect your mesh.

## Usage

Visit the live site — no install required:

**https://meshcraft.sawyerdesign.io**

### Local Development

```bash
npm install        # First time
npm run dev        # Vite dev server with HMR (http://localhost:5173)
npm run build      # TypeScript + Vite production build → dist/
npm run preview    # Preview production build locally
```

## Export Workflow

1. Adjust noise parameters or upload a depth map
2. Choose your export format (STL, OBJ, 3DM, or Heightmap)
3. Enable **Watertight** for CNC milling (adds bottom face + side walls)
4. Click **Export** to download

Exported STL/OBJ files are ready for CAM software like VCarve, Aspire, or Fusion 360.

## Architecture

Vite + TypeScript, 13 ES modules:

```text
src/
├── main.ts              # Entry point, URL state, demo preload
├── state.ts             # Typed STATE singleton, URL serialize/deserialize
├── types.ts             # Shared interfaces (Vertex3D, Triangle, MeshData)
├── noise/
│   ├── generators.ts    # 5 noise classes + factory
│   └── presets.ts       # 9 CNC presets, 6 texture profiles
├── mesh.ts              # Mesh generation + smoothing
├── render.ts            # Canvas 2D 3D rendering (painter's algo, Gouraud shading)
├── export.ts            # STL, OBJ, heightmap PNG export
├── ui.ts                # Sidebar, sliders, depth map upload
├── interaction.ts       # Mouse/touch orbit, pan, zoom
├── toolbar.ts           # Mode tabs, toolbar, Copy Link
├── stats.ts             # Stats overlay, zoom extents
└── sponsor.ts           # Sponsor modal
```

No WebGL, no frameworks. Canvas 2D is intentional — simpler, more portable, and performant enough for CNC mesh resolutions (<256x256 grids).

## License

MIT
