# Grasshopper Canvas Patterns

> **Verified against:** Grasshopper `7.38.24338.17002` (2026-07-28). Every component named here
> was confirmed present by IL inspection of the shipped assemblies. Re-verify with
> `scripts/verify-rhino-claims.sh "/Applications/Rhino N.app"`.
>
> Adapted from [Cordyceps](https://github.com/brookstalley/cordyceps)
> `Knowledge/ComponentPatternsGuide.md` and `Knowledge/CommonErrorsGuide.md`
> (MIT, Copyright (c) 2026 Brooks Talley).

A lookup table for "which native components do I wire together to get X". `SKILL.md` advises
preferring a native component over hand-rolled Python when one already does the job; this file is
the missing half of that advice — *which* component.

## Inputs

| Input type | Component | Notes |
|---|---|---|
| Number | Number Slider | Set min/max/precision on the slider itself |
| Integer | Number Slider with integer rounding | Or a Series for a sequence |
| Boolean | Boolean Toggle | A Panel containing `True`/`False` also works |
| Point | Construct Point | Or a Panel with `x,y,z` |
| Many points | Panel, one `x,y,z` per line | Fast way to hand-enter a set |

## Geometry creation

| Goal | Chain |
|---|---|
| Circle | XY Plane → Circle (Plane); Slider → Circle (Radius) |
| Point grid | Series ×2 → Cross Reference (Holistic) → Construct Point |
| Curve through points | Points → Polyline (straight) or Interpolate (smooth) |
| Surface from curves | Curves → Loft |
| Solid from surface | Surface → Extrude → Cap Holes |

## Data operations

| Goal | Chain |
|---|---|
| Combine lists | Merge (add inputs by zooming in on the component) |
| Filter by pattern | List + Boolean Pattern → Cull Pattern |
| Select one item | List + Index → List Item |
| Repeat to length | Items + Count → Repeat Data |

## Conditionals

| Goal | Chain |
|---|---|
| If / else | Boolean → Stream Filter; the two options into inputs 0 and 1 |
| Switch among N | Integer → Stream Gate; options into the numbered inputs |
| Keep numbers passing a test | Numbers → Larger Than → Cull Pattern |

## Transforms

| Transform | Inputs |
|---|---|
| Move | Geometry, Vector |
| Rotate | Geometry, Angle (radians), Plane |
| Scale | Geometry, Factor, Center |
| Mirror | Geometry, Plane |

**Linear array:** Geometry + Series → Unit vector scaled by the series → Move
**Radial array:** Geometry + Series spanning 0 to 2π → Rotate

## Analysis

| Measurement | Component |
|---|---|
| Curve length | Length |
| Surface area | Area |
| Extents | Bounding Box |
| Distance between points | Distance |
| Point at curve parameter | Evaluate Curve |

## Script component templates

**Python (IronPython 2.7 — see `SKILL.md` for the full language constraints):**

```python
#! python 2
import Rhino.Geometry as rg

# Free points: a fixed world-Z orientation is correct here.
circles = [rg.Circle(rg.Plane(pt, rg.Vector3d.ZAxis), radius) for pt in points]

# On a surface, never use a fixed axis -- orient to the surface normal instead.
# See "Surface Subdivision / Paneling" in SKILL.md.

a = circles  # output
```

**C#:**

```csharp
// Inputs: points (List<Point3d>), radius (double)
var circles = new List<Circle>();
foreach (var pt in points)
    circles.Add(new Circle(Plane.WorldXY, pt, radius));
A = circles;  // output
```

## Performance

- **Data Dam** caches an expensive branch so edits downstream do not re-trigger it. Worth adding
  in front of: boolean operations, dense mesh operations, physics/relaxation solvers, and
  curve/surface intersections.
- **Rebuild Curve** before booleans — simpler input geometry fails less often.
- Prefer one component processing a list over many components each processing one item.

## Clusters

**Symptom (well attested).** Clusters can fail to recompute, and cluster inputs can read null from
inside the cluster editor while the outer canvas looks fine. Multiple independent user reports on
the McNeel forum describe this. Recovery: close and reopen the cluster editor.

**Mechanism (unverified).** The Cordyceps project attributes this to native recompute destroying
the cluster's input hooks, and routes around it with its own cluster-safe recompute. That
mechanism is confirmed by no McNeel source and is recorded here as a lead, not a fact.

**Practical rule.** When a cluster's inputs go null, do not immediately assume your definition is
wrong. Reopen the editor and re-check before debugging upstream — you can lose an hour chasing a
data problem that is really an editor-state problem.

## The shaded preview lies about curvature

**Symptom.** A Brep with curved faces shows a visibly faceted shaded fill while its edge curves
stay perfectly smooth. Bake or render the same object and the facets are gone. Most often noticed
on extrusions of curved profiles, filleted corners, and anything with a small radius.

**It is never the geometry.** Edges are drawn analytically from the NURBS; the fill is a
tessellated preview mesh. Two renderers, one object. If the edge is smooth and the fill is not,
you are looking at a meshing setting, not a modelling error. Confirm from the model rather than by
eye -- ask the Brep what its faces actually are:

```python
#! python 2
for f in brep.Faces:
    print f.UnderlyingSurface().GetType().Name    # NurbsSurface / PlaneSurface / ...
ns = brep.Faces[0].UnderlyingSurface().ToNurbsSurface()
print ns.Degree(0), ns.Degree(1), ns.Points.CountU, ns.Points.CountV
```

**Grasshopper keeps its own meshing settings, separate from the Rhino document.** They live on the
`.gh` document, not the `.3dm`, which is why changing Rhino's render mesh quality appears to do
nothing:

```python
#! python 2
import Grasshopper
from Grasshopper.Kernel import GH_PreviewMesh
gd = ghenv.Component.OnPingDocument()
print gd.PreviewMeshType          # None | LowQuality | HighQuality | Document | Custom
mp = gd.PreviewCurrentMeshParameters()
print mp.RelativeTolerance, mp.RefineAngle
```

The default is `LowQuality`, and its `RefineAngle` is **0.0** -- curvature-based refinement is
switched off entirely, so the mesher never subdivides to follow a corner. `HighQuality` and
`Document` both raise it to the Rhino default of 0.349 rad (20 degrees).

| Mode | Source of parameters |
|---|---|
| `LowQuality` (default) | fixed coarse preset, `RefineAngle = 0.0` |
| `HighQuality` | fixed finer preset |
| `Document` | follows the Rhino document's current render mesh |
| `Custom` | `gd.PreviewCustomMeshParameters`, which you set yourself |
| `None` | preview meshes disabled |

**Custom Preview can make it worse, and it is a different code path.** The native component
preview draws through `DrawViewportMeshes(args)` and honours `PreviewMeshType`. Custom Preview
implements `IGH_RenderAwareData.AppendRenderGeometry`, and `GH_Brep.AppendRenderGeometry`
**hardcodes `MeshingParameters.Default`** when no mesh is cached yet -- it consults no document
setting at all, Rhino-side or Grasshopper-side.

Because both paths share the same `m_mesh` cache, whichever draws first wins for that object, so
the result is order-dependent and can look inconsistent between sessions.

Observed directly (same geometry, same camera, same zoom): with Custom Preview attached the shaded
fill pulls visibly away from the edge curve, leaving a gap through the corner; with it removed the
fill hugs the curve. The `AppendRenderGeometry` hardcode is verified in IL, and the visual
difference is verified by capture. What is *not* separately verified is that Custom Preview's
viewport draw specifically routes through `AppendRenderGeometry` rather than some other path --
treat the mechanism as strongly indicated, the symptom as confirmed.

Practical rule: if a definition looks worse the moment you attach Custom Preview for presentation,
that is expected. Judge surface quality from the native preview or from a bake, not from Custom
Preview.

**Preview meshes are cached per object** (`GH_Brep.m_mesh`), and the builder early-returns when the
cache is populated. Changing a setting therefore does nothing to geometry already on the canvas
until the cache is dropped or the geometry is regenerated:

```python
#! python 2
gd.PreviewMeshType = GH_PreviewMesh.HighQuality
gd.DestroyPreviewMeshes()         # required, or nothing visibly changes
```

**There is no application preference for this.** The `GH_Document` constructor hardcodes
`m_previewMeshType = 1` (`LowQuality`) and never reads the settings server, so every new
Grasshopper document starts coarse. The setting is per-document and is serialised into the `.gh`
(key `MeshParams`), so setting it on a definition and saving does persist *for that file* -- but
there is nothing to change once and forget.

Three ways to deal with it:

1. **Per definition** -- Grasshopper's own menu, Display > Preview Mesh Settings
   (`mnuLowQualityMeshing` / `mnuHighQualityMeshing` / `mnuDocumentMeshQuality` /
   `mnuCustomMeshQuality`). Save the file and it sticks.
2. **Per session** -- hook `Grasshopper.Instances.DocumentServer.DocumentAdded` and set
   `PreviewMeshType` on every document as it opens. This is the closest thing to a global default.
3. **Judge from a bake**, not from the preview, when surface quality actually matters.

```python
#! python 2
import Grasshopper
from Grasshopper.Kernel import GH_PreviewMesh

def _fix(server, doc):
    doc.PreviewMeshType = GH_PreviewMesh.HighQuality
    doc.DestroyPreviewMeshes()

Grasshopper.Instances.DocumentServer.DocumentAdded += _fix
for d in Grasshopper.Instances.DocumentServer:
    _fix(None, d)
```

**What is actually affected.** Preview only. Baking, rendering, exporting, and any downstream
geometric operation use the exact NURBS (bakes follow the Rhino document's render mesh). Treat a
faceted preview as a display setting, never as a reason to rebuild the model.

## Common failures

| Symptom | Likely cause | Check |
|---|---|---|
| Wrong item count | Data matching, not logic | See `grasshopper-data-matching.md` |
| Component orange, inputs look fine | A conversion failed silently | See `grasshopper-type-system.md` |
| Geometry perpendicular to intent | Direction fed into the wrong plane axis | See `grasshopper-geometry-orientation.md` |
| Canvas frozen / solver looping | Cyclic dependency | Disable the solver, find the cycle, re-enable |
| Script gives no diagnostics | The `out` parameter was removed | Re-add it; see the Performance section of `SKILL.md` |

## Version deltas

| Version | Difference |
|---|---|
| 7.x | Baseline. All named components verified present. |
| 8.x and later | Not verified. Rhino 8 replaces the dedicated GhPython component with a unified Script component that infers language from a first-line directive, so the Python template above needs a directive change there. Component names are otherwise expected to be stable. |
