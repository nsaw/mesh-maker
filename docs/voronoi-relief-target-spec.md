# Voronoi Relief — Target Geometry Specification

Authored description of the reference panel (lafabricatrun carved-wood relief), written by
Nick 2026-07-16. This is the canonical acceptance spec for the `voronoi-relief` sampler and
its presets. Mechanism mapping notes at the bottom added by implementation.

## Concise technical summary

A multiscale, anisotropically warped, weighted Voronoi relief with variable-width medial
ridges, nonuniform pocket depths, rounded polygonal floor insets, G1-G2 wall transitions,
and a few strategically enlarged junctions acting as deformation attractors.

## Defining properties

- Extreme variation in cell scale (largest cells 10-20x the area of the smallest; four
  perceptual scales: tiny slots, small compact, medium polygonal, very large stretched
  basins; transitions partially GRADED into bands, not scattered)
- Variable-depth recessed floors (three depth classes: deep/steep, intermediate, shallow
  inflated; deepest concentrated in dense cellular bands)
- Broad, continuously curved walls: concave descent leaving the crest at low slope,
  steepening progressively, steepest near the lower third, blending into the floor with a
  tighter-radius fillet (variable-radius cove). NOT constant draft; floor inset nonuniform.
- Nonuniform ridge thickness: effective ridge width varies by roughly an order of
  magnitude; a single wall begins narrow at one junction, broadens, contracts again
- Asymmetric wall profiles: one neighboring cell descends long/shallow while the opposite
  cell drops short/steep across the same ridge
- Ridge crests rise toward major junctions and dip near midpoints; three-way junctions
  form peaks, rounded triangular plateaus, or saddles, and are often much WIDER than the
  ridges feeding them (star/Y-shaped elevated nodes)
- Radial stretching around 2-3 convergence points: narrow cells/grooves project outward
  like spokes with unequal lengths, widths, angles (weak, perturbed 3-5 way pseudo-radial
  symmetry; one branch usually dominates)
- Large calm surface masses interrupting dense cellular clusters (cells locally merged or
  suppressed into shared mounds)
- Horizontal lens-shaped cells near the lower region; directional biases: horizontal
  elongation, both diagonals, local radial spreading. Vertical secondary.
- Cell shapes: rounded triangles, asymmetric quads, trapezoids, flattened pentagons, lens/
  eye shapes, leaf shapes, wedge fissures, amorphous basins. Aspect up to 3:1-7:1 for the
  longest; compact cells 1-1.5:1. Edges bow/taper; corners fillet or pinch to cusps.
- Floors: predominantly planar near a shared lower datum with 5-15% local deviation,
  compact rounded insets of the parent cell (pinching out at acute ends), softened
  floor-to-wall transition, occasional slight concavity/tilt/upward curl at tips
- Upper envelope non-planar: rises and falls in broad waves
- Normalized elevation bands: floors 0.00-0.10, floor fillets 0.10-0.20, walls 0.20-0.75,
  ridge shoulders 0.75-0.90, crests + junction peaks 0.90-1.00
- No global symmetry; asymmetric balance (left: larger calm masses / right: busier,
  fragmented; top: density / bottom: scale with sweeping lenses; center transitional)

## Construction logic (author's plausible pipeline)

1. Seeds with variable density  2. Weighted Voronoi / power diagram  3. LIGHT Lloyd only
4. Strong anisotropic deformation field  5. Stretch around attractors/radial centers
6. Boundaries -> variable-width ridges  7. Nonuniform cell depth  8. Curvature-continuous
smoothing  9. Preserve selected acute tips  10. Locally merge/suppress cells into masses

## Mechanism mapping (sampler v16.3)

| Spec property | Mechanism |
|---|---|
| Upper envelope waves | base superposition (reliefBaseAmplitude/Frequency) |
| Variable ridge width + wide junctions | per-pixel wall-band modulation: noise x junction proximity (F3-F1) |
| Crests rise at junctions | junction lift term from (F3-F1)/(2R) (reliefJunctionLift) |
| Three depth classes + suppressed cells | per-cell hash depth tiers (reliefDepthVariation) |
| Asymmetric wall profiles | per-cell seamDepth jitter (same variation control) |
| Floor fillet (G1 into floor) | smooth-min saturation band replacing hard clamp |
| Pillowed/deviating floors | reliefPillow / reliefPillowCoverage |
| Multi-scale graded sizes | reliefDensityNoise patches + attractor gradient |
| Radial convergence nodes | polar petal lattices at foci (v16.2) |
| Directional bias | global anisotropy + flow warp (distortion) |
