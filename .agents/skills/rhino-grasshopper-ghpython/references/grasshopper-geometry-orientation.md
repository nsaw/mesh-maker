# Grasshopper Geometry Orientation

> **Verified against:** RhinoCommon / Grasshopper `7.38.24338.17002` (2026-07-28) by IL inspection
> of the shipped assemblies. Re-verify after any Rhino upgrade with
> `scripts/verify-rhino-claims.sh "/Applications/Rhino N.app"`; record anything that FAILs in the
> Version deltas table at the bottom rather than editing the prose.
>
> Adapted from [Cordyceps](https://github.com/brookstalley/cordyceps)
> `Knowledge/GeometryOrientationGuide.md` (MIT, Copyright (c) 2026 Brooks Talley).
> **Corrections applied — the upstream guide states the cone case backwards.**

**Core rule: oriented geometry follows its plane's Z-axis.** Get the plane right and the geometry
follows. Almost every "why is my geometry sideways" bug is a plane bug, not a geometry bug.

## Orientation by primitive

| Component | Relationship to the input plane |
|---|---|
| Cylinder | Extends along +Z from the plane |
| Cone | **Base circle sits on the input plane; the apex is at `origin + height·Z`** |
| Circle / Rectangle | Lie flat in the plane's XY |
| Text 3D | Lies in XY, reads facing +Z |
| Extrude | Uses its Vector input and ignores the plane entirely |

### The cone trap: the component is not the struct

`Rhino.Geometry.Cone` puts its **apex** at the plane origin — `Cone.ApexPoint` returns
`plane.Origin` and `Cone.Axis` returns `plane.ZAxis`. Read that alone and you would expect the
Grasshopper Cone component to place the tip on your input plane.

It does the opposite. The component translates the plane by `ZAxis · height` and then flips it
before constructing the cone, which lands the **base** back on the plane you supplied:

```
plane.Translate(plane.ZAxis * height)   // move up by height
plane.Flip()                            // reverse Z
new Cone(plane, height, radius)         // apex now at the translated point
```

Consequence: **scripting a Cone directly in GhPython orients it opposite to the component**
unless you replicate the translate-and-flip. If you want script output to match canvas output:

```python
#! python 2
import Rhino.Geometry as rg

# Match the Grasshopper Cone component: base on `plane`, apex above it.
plane = rg.Plane(base_plane)            # copy; Translate/Flip mutate in place
plane.Translate(plane.ZAxis * height)
plane.Flip()
cone = rg.Cone(plane, height, radius)
```

**Second gotcha:** the Cone component silently applies `max(abs(radius), 1.49e-08)`. A negative
radius becomes positive rather than erroring, so a sign error upstream produces a valid-looking
cone instead of a red component. Validate radius yourself if its sign is meaningful.

## Plane construction

A plane is an origin plus three axes, where `Z = X × Y` (cross product). You never set Z
directly on Construct Plane — you set X and Y, and Z falls out of them.

| Need | Use | Set |
|---|---|---|
| Geometry pointing in direction D, roll irrelevant | Plane Normal | Normal = D |
| Geometry pointing up (world Z) | XY Plane | (automatic) |
| Full control including roll about the axis | Construct Plane | X and Y such that `X × Y` = D |

### Decision tree

```
Do you care about rotation *around* the direction axis?
├─ NO  → Plane Normal, feed the direction as Normal
└─ YES → Construct Plane, and make sure X × Y equals the direction you want
```

## The classic failure

Wanting cylinders that point at a target, and reaching for Construct Plane:

**Wrong:** `Vector 2Pt` (toward target) → `Construct Plane` (as **X-axis**) → `Cylinder`
**Result:** cylinders sit perpendicular to the target. The direction became X, so Z — the axis the
cylinder actually extends along — ended up somewhere else entirely.

**Right:** `Vector 2Pt` (toward target) → `Plane Normal` (as **Normal**) → `Cylinder`
**Result:** cylinders point at the target.

The general form of this bug: you fed your direction into the wrong axis slot. If oriented
geometry comes out perpendicular to what you intended, that is the first thing to check.

## Patterns

| Goal | Chain |
|---|---|
| Cylinders aimed at a point | Vector 2Pt → Plane Normal → Cylinder |
| Cylinders standing vertical | Points → XY Plane (Origin) → Cylinder |
| Geometry oriented to a surface | Evaluate Surface → Frame output → geometry |

The Evaluate Surface **Frame** output is the canvas equivalent of the scripting rule in
"Surface Subdivision / Paneling" in `SKILL.md`: orient to the surface normal at each point, never
to a fixed world axis. A fixed axis only looks correct on flat horizontal surfaces and silently
produces wrong results everywhere else. Same principle, two places — keep them consistent.

## Verifying orientation

Without the canvas, check the bounding box: a large extent in one axis means the geometry runs
along that axis.

```python
#! python 2
import rhinoscriptsyntax as rs
bbox = rs.BoundingBox(obj)
# bbox is 8 corner points; compare extents to confirm the dominant axis
```

Or bake and eyeball it. For a cone specifically, compare the baked tip position against your
input plane origin — if they coincide, the translate-and-flip did not happen and you are looking
at raw struct behavior rather than component behavior.

## Version deltas

| Version | Difference |
|---|---|
| 7.x | Baseline. Cone component translate+flip verified in `SurfaceComponents.gha`; `Cone.ApexPoint == plane.Origin` verified in RhinoCommon. |
| 8.x and later | Not verified. The cone behavior is *component* logic, not API surface, so it can change without any API deprecation warning. Re-run the harness before trusting the cone row. |
