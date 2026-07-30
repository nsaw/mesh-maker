# Grasshopper Type System and Conversions

> **Verified against:** Grasshopper `7.38.24338.17002` (2026-07-28). **Every conversion row below
> was read directly from `GH_Convert` IL in the shipped assembly** — none are taken on trust.
> Re-verify with `scripts/verify-rhino-claims.sh "/Applications/Rhino N.app"`.
>
> Adapted from [Cordyceps](https://github.com/brookstalley/cordyceps)
> `Knowledge/TypeSystemGuide.md` (MIT, Copyright (c) 2026 Brooks Talley).
> **Corrections applied — several rows in the upstream guide are wrong; see "Corrections" below.**

Grasshopper wraps every value in a "Goo" container (`GH_Number`, `GH_Curve`, …) and converts
between them automatically when you connect mismatched types. Some conversions succeed silently,
some lose information silently, and some fail silently. Knowing which is which is the difference
between a definition that works and one that produces plausible garbage.

## The conversion graph is directional

**This is the most important thing on this page.** Conversions are one-way. Widely circulated
Grasshopper guidance draws them as bidirectional (`Point ↔ Vector`, `Mesh ↔ Brep`); that is
wrong in both cases, and the direction that fails is not the one people expect.

| Conversion | Result |
|---|---|
| Point → Vector | **Works** |
| Vector → Point | **Fails** |
| Brep → Mesh | **Works** |
| Mesh → Brep | **Fails** |
| Surface → Brep | Works |
| Brep → Surface | Works **only if the Brep has exactly one face** |
| Integer → Number | Works |
| Number → Integer | Works, **rounds** (see below) |
| Line / Circle / Arc / Ellipse / Polyline / Rectangle → Curve | Works |
| Surface / Brep → Curve | Works (yields edge curves) |
| Curve → Line / Circle / Arc | Works **only if the curve genuinely is one** |
| Plane / Box / Sphere / Cone / Torus → Surface or Brep | Works |
| Number → Point | Fails |
| Curve → Surface | Fails |
| Mesh → Surface | Fails |

If a conversion fails, the connection does not error loudly — the receiving component simply gets
no data and usually goes orange. Look for a null or empty input before assuming your upstream
logic is broken.

## Number → Integer rounds; it does not truncate

`GH_Convert` calls `Math.Round(value, MidpointRounding.AwayFromZero)`:

| Input | Result |
|---|---|
| 2.4 | 2 |
| 2.5 | **3** |
| 2.6 | 3 |
| −2.5 | **−3** |

Values outside int32 range fail the conversion rather than wrapping.

**If your definition depends on truncation, do not rely on the cast.** Use an explicit Floor or
Truncate component. A slider at 2.5 feeding an integer input gives you 3, and a common symptom is
an off-by-one that only appears at exact half values.

## Corrections to widely circulated guidance

Three claims that appear in the upstream guide and elsewhere, and what the shipped assembly
actually does:

| Common claim | Reality |
|---|---|
| "Number → Integer truncates" | It rounds, away from zero. |
| "Point ↔ Vector, safe and lossless" | Only Point → Vector. Vector → Point does not convert. |
| "Mesh ↔ Brep fails" | Only Mesh → Brep fails. Brep → Mesh converts fine. |

A methodological note for anyone re-verifying: Grasshopper has **two** converter families.
`ToGH<Type>_*` produces Goo and mostly delegates into `To<Type>_*`, which produces raw geometry
and holds the real cross-type logic. Reading only the `ToGH*` family reports false negatives —
that is how "Point ↔ Vector never converts" gets concluded by mistake. Follow the call graph.
Likewise `Integer → Number` has no inline type constant at all; `ToDouble_Secondary` delegates to
`ToInt32_Primary`.

## Primitive types

| Type | Description | Typical sources |
|---|---|---|
| Number | Double | Number Slider, math ops |
| Integer | Whole number | Series, list indices |
| Boolean | True/False | Toggle, comparisons |
| Text | String | Panel, Concatenate |
| Colour | ARGB | Colour Swatch, Gradient |
| Domain | Interval (min, max) | Construct Domain |

## Geometry types

| Type | Notes |
|---|---|
| Point | A location. Not a direction. |
| Vector | A direction and magnitude. Not a location. |
| Plane | Origin plus axes; `Z = X × Y` |
| Line / Circle / Arc | Lightweight structs; convert up to Curve freely |
| Curve | The general curve type |
| Surface | A single face |
| Brep | Boundary representation; one or many faces |
| Mesh | Polygon mesh; converts *from* Brep but not back |

## Script type hints

Setting a type hint on a script input converts incoming Goo to a native type, so you get a
`Point3d` instead of a GUID. Mapping:

| Hint | Grasshopper type |
|---|---|
| `int` | Integer |
| `float` / `double` | Number |
| `bool` | Boolean |
| `str` | Text |
| `Point3d` | Point |
| `Vector3d` | Vector |
| `Plane` | Plane |
| `Curve` | Curve |
| `Surface` | Surface |
| `Brep` | Brep |
| `Mesh` | Mesh |

See "Inputs and Outputs" in `SKILL.md` for how hints interact with access modes.

## Geometry validity

| Type | Requirement for common operations |
|---|---|
| Curve | Continuous; some ops additionally require non-self-intersecting |
| Brep | Must be closed and correctly oriented for booleans |
| Mesh | Must be manifold for many operations |

Check `IsValid` before expensive operations. Invalid geometry tends to fail silently rather than
raise — see the boolean guidance in `SKILL.md`, which returns `None` on failure rather than
throwing.

## Version deltas

| Version | Difference |
|---|---|
| 7.x | Baseline. Every row above read from `GH_Convert` IL. |
| 8.x and later | Not verified. Rhino 8 adds script-component type hints that do not exist in 7. The conversion model itself is expected to be stable, but "expected" is not "verified" — run the harness. |
