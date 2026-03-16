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
    <img src="https://imagedelivery.net/7Un9nY7FmOV52M6-Dm1bzA/04acb407-564f-4b6e-8c91-9506c2f52300/w=800" alt="ShopBot Desktop Max ATC" width="400">
  </a>
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
- **Zero dependencies** — Single HTML file, no build step, runs in any browser

### View Modes

Solid, Wireframe, Both, Points — switch between render modes to inspect your mesh.

## Usage

Open [`meshcraft.html`](meshcraft.html) in any browser, or visit the live site:

**https://meshcraft.sawyerdesign.io**

No install, no server, no build step required.

### Local Development

```bash
python3 -m http.server 8765
# Open http://localhost:8765/meshcraft.html
```

## Export Workflow

1. Adjust noise parameters or upload a depth map
2. Choose your export format (STL, OBJ, 3DM, or Heightmap)
3. Enable **Watertight** for CNC milling (adds bottom face + side walls)
4. Click **Export** to download

Exported STL/OBJ files are ready for CAM software like VCarve, Aspire, or Fusion 360.

## Architecture

Single file: `meshcraft.html` (~2100 lines)

- **CSS** — Dark theme, responsive layout, custom controls
- **HTML** — Header, sidebar, viewport canvas, export bar
- **JavaScript** — Noise generation, mesh construction, Canvas 2D rendering (painter's algorithm + Gouraud shading), file export

No WebGL, no frameworks, no external JS dependencies. Canvas 2D is intentional — simpler, more portable, and performant enough for CNC mesh resolutions.

## License

MIT
