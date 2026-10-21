<!-- Captured from the Greptile knowledge base 2026-07-29. Greptile generated this from the
codebase and grounded its review findings in it; it is not hand-authored SOT.
Verify against live code before citing it as authoritative. -->

# Mesh Generation Core

MeshCraft turns either a procedural noise field or an uploaded grayscale depth-map image into a regular-grid heightfield, then triangulates that grid into 3D geometry consumed by the viewport renderer and the export/CNC pipelines. The pipeline lives mainly in `src/mesh.ts` (sampling, blending, CNC z-normalization) and `src/geometry.ts` (grid-to-triangle, watertight-enclosure, and the shared `weightedSmooth` blur); `src/types.ts` defines the shared grid/vertex contracts. Two sibling modules extend the depth-map path: `src/depth-estimate.ts` runs in-browser monocular depth estimation (Depth-Anything-V2-small via lazy-loaded transformers.js) to turn a photo into an actual depth image, DRAPE mode does not use the depth-map path: `src/drape-sim/` simulates a silk veil over a 3D figure (Jolt Physics) and `src/drape-ui.ts` turns the front view into an in-memory relief master that `generateMesh` previews like an imported `.mcrelief`.

## Mental model

```mermaid
flowchart TD
  A[STATE: noiseType/params or depthMap image] --> B{STATE.mode}
  B -->|noise| C[sampleNoiseGrid: warp + FBM + shaping]
  B -->|depthmap| D[sampleLumaGrid: Rec. 709 luma, grid row 0 = image bottom]
  B -->|drape| E[drape-sim: Jolt cloth over a 3D figure, front relief as the active master]
  C --> F[weightedSmooth]
  D --> F
  E --> F
  F --> G[CNC z-normalize into 0..baseThickness]
  G --> H[STATE.vertices: number rows x cols grid]
  H --> I[geometry.ts: gridMinMax, preferZ00Z11Diagonal, cellTriangleOffsets]
  I --> J[render.ts buildSurface (preview)]
  H --> K[export-surface.ts getExportSurface: relief master or grid]
  K --> L[mesh-writer.ts / sbp worker]
```

## Grid representation and shared types

The generation pipeline never produces a triangle mesh directly. It produces `STATE.vertices: number[][]`, a `rows x cols` grid of Z heights in inches (CNC machine-bed space), alongside `STATE.cols`/`STATE.rows`/`STATE.meshX`/`STATE.meshY`. That grid is what the viewport draws (`render.ts`). Exports and toolpaths read `getExportSurface()` (`src/export-surface.ts`), which returns an `ExportSurface` (`{ z: Float64Array, cols, rows, meshX, meshY, diagonal, watertight }`): in DEPTH MAP mode with a relief master loaded (`STATE.reliefMaster`, `src/relief-master.ts`) it is the master's full-resolution heights and declared triangulation, and `STATE.vertices` is only a preview resample of the master's triangles (`reliefPreviewGrid`, with its measured error in `STATE.reliefPreviewErrorIn`); otherwise it is a copy of `STATE.vertices` with the shortest-diagonal split. `src/mesh-writer.ts` turns an `ExportSurface` into an indexed mesh (`buildIndexedMesh`: top grid, four walls, bottom fan from one centre vertex) and writes STL/OBJ from it; `export.ts` adds 3DM and the heightmap PNG; `surfaceHeightmap()` feeds the SBP worker. Vertex (j, i) sits at `x = (i/(cols-1))*meshX`, `y = (j/(rows-1))*meshY`. The `MeshData`/`getFullMeshData()` representation was removed on 2026-10-19. `types.ts` defines the noise-generator contracts (`NoiseGenerator`, `FBMGenerator`, `ReliefGenerator`, `NoiseGridParams`, `ReliefSampleParams`) that `mesh.ts` depends on; see `noise-and-relief-system` for how those generators are implemented.

## Noise-driven generation (`generateNoiseMesh`)

`generateNoiseMesh()` in `mesh.ts` reads noise parameters off `STATE` (frequency, octaves, persistence, lacunarity, contrast, sharpness, exponents, distortion/warp settings, smoothing), computes `cols`/`rows` from `STATE.resolution` and the mesh aspect ratio (`meshY/meshX`), and instantiates a generator via `createNoiseGen(noiseType, seed, noiseConfig)`. The per-pixel sampling loop lives in the internal `sampleNoiseGrid()`: for each grid cell it optionally applies domain warp (convergent or curl-based, blended by `warpCurl`), evaluates FBM or manual octave summation, then applies contrast/sharpness/exponent shaping (`noiseExp`, `peakExp` for peaks, `valleyExp`/`valleyFloor` for valleys). One generator kind is special-cased: if `gen.kind === 'voronoi-relief'`, `sampleNoiseGrid` skips its own per-pixel warp/FBM loop entirely and delegates to `gen.sampleGrid(reliefParams)` (params built by `sampleReliefParamsFromState`), because discrete Voronoi cells plus continuous domain warp produce visible tearing.

After sampling, `weightedSmooth()` (a 3x3 weighted-average blur, `iterations`/`strength` controlled) optionally relaxes the grid. The result is then remapped into CNC z-space: peaks map to `baseThickness` (stock top) and valleys to `baseThickness - cutDepth`, where `cutDepth = min(amplitude, baseThickness)`, followed by a hard clamp to `[floor, baseThickness]`. When `STATE.watertight` is true, `baseThickness` is floored at, and the surface floor equals, `MIN_WATERTIGHT_THICKNESS` (0.01 in, `src/geometry.ts`), so no surface vertex coincides with the exporter's z=0 bottom face (degenerate enclosure triangles); otherwise the floor is 0.

## Depth-map generation and the drape compositor (`generateDepthMapMesh`)

`generateDepthMapMesh()` requires `STATE.depthMap` (an `HTMLImageElement` set by `loadDepthMap()` in `src/ui.ts`, or replaced in place by `runDepthEstimation()`); if absent it clears `STATE.vertices` and returns. It draws the image to an offscreen canvas and reads Rec. 709 luma via `sampleLumaGrid()` (`src/geometry.ts`), which bilinear-samples `ImageData` at each grid cell; grid row 0 samples the image's BOTTOM row, because exports place grid row j at world `y = j/(rows-1)*meshY` (Y grows away from the machine front). Mapping the image's top row to row 0, as before 2026-10-19, carved a vertical mirror image. `normalizeGrid()` then maps the grid to `[0, 1]`, treating a range under 1e-9 as flat (luma rounding is ~2e-16), and `applyBackgroundCutoff()` applies `dmBackgroundCutoff`.

Depth data can come from two sources: raw image luminance (the default), or `src/depth-estimate.ts`'s `estimateDepth()`, which lazily dynamic-imports `@huggingface/transformers` and runs the `onnx-community/depth-anything-v2-small` model (WebGPU first, WASM fallback) to produce an actual monocular depth image from the source photo. `runDepthEstimation()` in `src/ui.ts` wires the "Estimate Depth" action: it swaps `STATE.depthMap` for the model's output, appends `' (AI depth)'` to `STATE.depthMapName` (guarding against re-estimating an already-estimated map), and guards against a stale closure if the user swaps images mid-inference. Both `INFERENCE_TIMEOUT_MS` (180s) and `LOAD_TIMEOUT_MS` (300s, covers first-run model download) reject a hung backend so the UI button isn't left disabled forever; failures are swallowed and the caller falls back to the luminance path since this feature is strictly additive.

DRAPE mode (renamed from BLEND on 2026-10-20; the procedural membrane-and-folds compositor was removed on 2026-10-21) simulates a silk veil over a complete 3D figure: `src/drape-sim/cloth.ts` hangs a 5 x 8 unit sheet (100 x 160 quads) from nine crown vertices over the figure's Jolt mesh shape under gravity, 100 frames at 24 fps in 8 substeps, with material values calibrated against the Blender proof (`SILK`). `pipeline.ts` smooths the solved grid with two Catmull-Clark levels, rasterizes the frontmost of figure and cloth along +Y over a 12 x 16 in window (1201 x 1601 nodes), and maps depth linearly into 0.125 in backing + 0.625 in relief. `src/drape-ui.ts` runs it in a Worker and packs the result through `encodeReliefMaster`/`parseReliefMaster` into `STATE.drapeMaster`, which `activeMaster()` hands to the preview, stats, STL and SBP. The depth-map path (`STATE.mode === 'depthmap'`) normalizes/smooths/z-maps the depth grid alone.

`generateMesh()` in `mesh.ts` is the entry point called by UI slider changes (via `debouncedGenerate()`, 60ms debounce that skips regeneration for view-only keys like orbit/tilt/roll/zoom) and by `loadDepthMap()`. It dispatches on `STATE.mode` (`'noise'` / `'depthmap'` / a mixed mode that prefers `generateDepthMapMesh` if a depth map is loaded, else falls back to noise), wraps the call in two `requestAnimationFrame`s to let a loading overlay paint first, then triggers `renderViewport()` and `updateStats()`.

## Triangulation and enclosure geometry (`geometry.ts`)

`geometry.ts` holds pure, side-effect-free grid math shared by both the live Three.js viewport (`render.ts`) and the exporters (`export.ts`), plus `weightedSmooth()`, the 3x3 weighted-average blur (center 4, edge 2, corner 1) used by the noise and depth-map smoothing in `mesh.ts`, and the depth-map input helpers `sampleLumaGrid()`, `normalizeGrid()`, `applyBackgroundCutoff()` and the shared `MIN_WATERTIGHT_THICKNESS`. `gridMinMax()` scans a grid for its z-range (used for both color-ramp normalization and CNC clamps); `preferZ00Z11Diagonal()` picks the shorter-difference diagonal for each quad's split, reducing visible faceting on steep slopes; `cellTriangleOffsets()` returns CCW-wound flat-index triangle offsets for a quad based on that diagonal choice. The watertight enclosure (walls plus a bottom fan) is built by `src/mesh-writer.ts` `buildIndexedMesh()`, the single triangulation every export uses. `render.ts`'s `buildSurface()`/`buildEnclosure()` triangulate the preview grid separately for display, with the relief master's fixed diagonal when one is active and the shortest diagonal otherwise.

## Change checklist

When these files or sections are changed, remember to consider these:

- If `sampleNoiseGrid`'s shaping pipeline (warp, FBM, contrast/sharpness/exponents) changes order or math, verify both `generateNoiseMesh` and the noise branch of `generateDepthMapMesh`'s drape path still produce a `[nMin,nMax]`-normalizable grid; both callers rely on `gridMinMax` afterward.
- If a new generator `kind` is added alongside `'voronoi-relief'` in `NoiseGenerator`/`types.ts`, add a matching branch in `sampleNoiseGrid` — generators are otherwise assumed to support the per-pixel `noise()`/`fbm()` contract, and an unhandled `kind` will silently fall through to the generic per-pixel loop.
- If `ExportSurface` (`src/mesh-writer.ts`) changes shape, update `getExportSurface()`/`reliefMasterSurface()`/`surfaceHeightmap()` in `src/export-surface.ts` and the CLI round trip (`cli/relief-roundtrip.ts`), which all build from it.
- If `baseThickness`/`watertight` clamping logic changes in `mesh.ts`, check `reliefMasterSurface()` in `src/export-surface.ts`, which refuses (never raises) a relief master below `MIN_WATERTIGHT_THICKNESS` for watertight exports.
- If `cols`/`rows` computation (`Math.max(2, resolution)`, aspect-derived rows) changes, verify `render.ts`'s `buildSurface`/`buildEnclosure` and `getExportSurface()`, which all assume `STATE.cols`/`STATE.rows` match the actual length of `STATE.vertices`.
- If `weightedSmooth`'s signature or kernel weights change in `geometry.ts`, verify the noise and depth-map smoothing callers in `mesh.ts` (the drape compositor no longer calls it).
- If `src/depth-estimate.ts`'s `DepthOutput` shape or timeout constants change, check `runDepthEstimation()` in `src/ui.ts`, which assumes the resolved image has `width`/`height` and treats any rejection as "fall back to luminance."
- If anything under `src/drape-sim/` changes (cloth values, sheet, extraction window, mapping), run `npm run test:drape` and `npm run test:drape-parity`; the parity reference in `cli/fixtures/drape-silk-tilt25` comes from the Blender proof and must not be regenerated from the web solver.

## Important failure modes

| Trigger | Consequence | Guard |
|---|---|---|
| `STATE.depthMap` is null when `generateDepthMapMesh()` runs | `STATE.vertices` set to `null`, viewport/export show nothing | Explicit early-return check in `mesh.ts` |
| `cols < 2` or `rows < 2` | `getExportSurface()` returns a reason string and the export shows it as a toast | Guard in `src/export-surface.ts`; `mesh.ts` also floors `resolution` to 2 and `rows` to 4 |
| `baseThickness` set to 0, or a surface vertex at z=0, with `watertight` true | Zero-height enclosure walls (degenerate triangles) against the z=0 bottom face | `mesh.ts` floors both the stock and every surface vertex to the one shared `MIN_WATERTIGHT_THICKNESS` (`src/geometry.ts`); a relief master below it is refused for watertight export by `reliefMasterSurface()` (`src/export-surface.ts`), never raised |
| `nMax === nMin` (flat noise/depth grid) | Division by zero in normalization | Both `mesh.ts` and `render.ts` use `range || 1` fallback |
| Domain warp (`distortion > 0`) combined with `voronoi-relief` generator | Would tear cell boundaries | `sampleNoiseGrid` special-cases `gen.kind === 'voronoi-relief'` and skips its own warp path entirely |

## Key files

| File | Why to read it |
|---|---|
| `src/mesh.ts` | Core pipeline: noise sampling, depth-map sampling, drape compositor invocation, CNC z-normalization, debounced regeneration entry point |
| `src/geometry.ts` | Shared grid-to-triangle math (diagonal selection, triangle offsets, watertight enclosure) and `weightedSmooth`, used by both viewport/export and the drape compositor |
| `src/drape-sim/` | DRAPE: `figure.ts` (.mcfig, tilt, upload placement), `cloth.ts` (Jolt cloth, `SILK`), `raster.ts` (front depth), `subdiv.ts`, `pipeline.ts` (figure to relief), `worker.ts` |
| `src/depth-estimate.ts` | Lazy-loaded Depth-Anything-V2 monocular depth inference (`estimateDepth`), timeouts, WebGPU/WASM fallback |
| `src/types.ts` | Noise-pipeline contracts (`NoiseGridParams`, generator interfaces); the export geometry contract is `ExportSurface` in `src/mesh-writer.ts` |
| `src/render.ts` (`buildSurface`, `buildEnclosure`) | Consumes `STATE.vertices` to build the live Three.js scene; independent re-triangulation from `export.ts` |
| `src/export-surface.ts`, `src/mesh-writer.ts`, `src/export.ts` | `getExportSurface()` picks the relief master or the grid; `buildIndexedMesh()` and the STL/OBJ writers emit it; `export.ts` dispatches formats |
| `src/ui.ts` (`loadDepthMap`, `fitMeshToAspect`, `runDepthEstimation`) | Loads user depth-map image into `STATE.depthMap`, optionally runs AI depth estimation, and triggers `generateMesh()` |
| `src/state.ts` | Defines all `STATE` fields the pipeline reads (`resolution`, `mode`, `drapeTilt`, `drapeMaster`, `dmBackgroundCutoff`, `baseThickness`, `watertight`, etc.) |
