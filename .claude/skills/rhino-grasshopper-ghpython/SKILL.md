---
name: rhino-grasshopper-ghpython
description: "Use this skill when the user asks to write, debug, or optimize GhPython scripts, Grasshopper definitions, RhinoCommon code, rhinoscriptsyntax scripts, Rhino command macros, or C# scripting components for Rhino 7. Trigger on: GhPython, Grasshopper, Rhino Python, RhinoCommon, rhinoscriptsyntax, parametric design, data trees, surface paneling, attractor points, mesh generation, NURBS, Brep operations, computational geometry in Rhino, IronPython 2.7, .gh definitions, baking geometry, Grasshopper components from Python, node-in-code, ghpythonlib. Also trigger when the user references .gh files, .3dm files, Rhino geometry types (Point3d, Curve, Surface, Brep, Mesh), or mentions McNeel, Food4Rhino, or parametric modeling workflows. This skill covers the full Rhino 7 scripting ecosystem -- from quick rhinoscriptsyntax one-liners to complex multi-component Grasshopper definitions with custom GhPython nodes. Includes compiled C# DLL pattern for IronPython bottlenecks and GhPython silent output data loss."
---

# Rhino 7 / Grasshopper / GhPython Scripting Skill

> **Root skill — project copy wins.** This is the broad root version. If the project you're working in (`~/Code/<project>/`) ships its own `rhino-grasshopper-ghpython` skill, that project copy is authoritative and supersedes this one: load it and let it win where they differ; use this file only for general principles the project copy doesn't cover. (Umbrella rule: "Skill precedence" in `~/Code/CLAUDE.md`.)

## Critical: Rhino 7 = IronPython 2.7

Rhino 7 runs **IronPython 2.7.12**, which is Python 2 syntax. This is the single most common source of bugs when generating code for Rhino 7. Every script you write must follow Python 2 conventions:

```python
# CORRECT (Rhino 7 / IronPython 2.7)
print "hello"                    # print is a statement, not a function
for i in xrange(100):            # xrange for iteration (range returns a list)
    pass
d = {"a": 1}
keys = d.keys()                  # returns list, not dict_keys view
isinstance(x, basestring)        # basestring exists in Python 2
"formatted: %s and %d" % (s, n)  # use % formatting or .format()

# WRONG (Python 3 syntax -- will error in Rhino 7)
print("a", "b")                  # prints tuple ('a', 'b'), not "a b"
f"formatted: {value}"            # f-strings don't exist (Python 3.6+)
isinstance(x, str)               # use basestring to catch both str and unicode
```

**Notable IronPython 2.7 constraints:**
- No `pathlib`, no `dataclasses`, no `typing` module
- `print("hello")` works fine (parens are just grouping), but `print("a", "b")` prints the tuple `('a', 'b')` instead of `a b`
- Integer division: `5/2 = 2` (floor division by default), use `5.0/2` for float
- `dict.iteritems()`, `dict.itervalues()`, `dict.iterkeys()` exist and are preferred for large dicts
- String literals are bytes by default; use `u"unicode"` for unicode strings
- No `with` statement context manager for some types (IronPython quirk)
- `sorted()` `key` parameter works, but `cmp` parameter also still exists
- Imports from .NET assemblies work directly thanks to IronPython's CLR integration

## Architecture: Three API Tiers

When writing Rhino/Grasshopper Python code, there are three tiers of API access. Choose based on the task:

### Tier 1: ghpythonlib.components (Highest-level)
Wraps every native Grasshopper component as a Python function. Best for: quick prototyping, when a native GH component already does what you need.

```python
import ghpythonlib.components as ghcomp

# Call native GH components directly
curves = ghcomp.Voronoi(points)
area_result = ghcomp.Area(curves)
centroids = area_result.centroid
```

**Limitation:** Not compatible with `ghpythonlib.parallel` (causes memory leaks). Cannot be used in parallel workflows.

### Tier 2: rhinoscriptsyntax (Mid-level)
Convenience wrapper around RhinoCommon. Works through document object references (GUIDs). Best for: interactive scripts, automation, when you want simple function calls.

```python
import rhinoscriptsyntax as rs

circle_id = rs.AddCircle(rs.WorldXYPlane(), 5.0)
rs.MoveObject(circle_id, [10, 0, 0])
```

**Key:** rs functions return GUIDs, not geometry objects. They operate on the active document (ghdoc in Grasshopper, Rhino doc in scripts).

### Tier 3: RhinoCommon (Lowest-level, fastest)
Direct .NET API access. Best for: performance-critical code, complex geometry operations, anything not exposed in the higher tiers.

```python
import Rhino.Geometry as rg

pt = rg.Point3d(0, 0, 0)
circle = rg.Circle(rg.Plane.WorldXY, 5.0)
crv = circle.ToNurbsCurve()
```

**Performance note:** RhinoCommon is meaningfully faster than rhinoscriptsyntax because it skips the wrapper layer. For anything processing hundreds or thousands of objects, use RhinoCommon directly.

## Standard Import Block

For GhPython components in Grasshopper, this is the typical import structure:

```python
import Rhino
import Rhino.Geometry as rg
import Grasshopper
from Grasshopper.Kernel.Data import GH_Path
from Grasshopper import DataTree
import ghpythonlib.components as ghcomp
import ghpythonlib.treehelpers as th
import scriptcontext as sc
import rhinoscriptsyntax as rs
import System
```

Only import what you need. Don't dump the full block into every script.

## GhPython Component Mechanics

### Inputs and Outputs
- Default inputs: `x`, `y` -- rename and add more by right-clicking the component
- Default output: `a` -- rename and add more the same way
- **Type hints** (right-click input > Type hint): Critical for automatic geometry conversion. Set `Point3d` hint and you get actual Point3d objects instead of GUIDs.
- **Access modes** (right-click input > access):
  - **Item access**: One value at a time (Grasshopper iterates automatically)
  - **List access**: All values in one branch as a Python list
  - **Tree access**: Full DataTree structure

### Automatic Iteration
Grasshopper automatically loops over inputs when using Item access. Write your logic for a single item; GH handles the iteration. This is the default and usually what you want.

```python
# With Item access on 'x' (a list of points), GH calls this once per point
# x arrives as a single Point3d
a = rg.Circle(rg.Plane(x, rg.Vector3d.ZAxis), radius)
```

### The ghdoc / scriptcontext Pattern
`ghdoc` is the Grasshopper document. `sc.doc` can point to either ghdoc or the Rhino document. When you need to interact with the Rhino document (e.g., baking, reading existing geometry):

```python
import scriptcontext as sc

# Switch to Rhino document
sc.doc = Rhino.RhinoDoc.ActiveDoc
# ... do Rhino document operations ...
rs.AddPoint(0, 0, 0)  # adds to Rhino, not Grasshopper

# Switch back to Grasshopper document
sc.doc = ghdoc
```

**Why this matters:** rhinoscriptsyntax functions operate on whatever `sc.doc` points to. If you forget to switch back, your GhPython component will write to the Rhino doc instead of passing data downstream in Grasshopper.

## Data Trees

Data trees are Grasshopper's hierarchical data structure. They're unavoidable in non-trivial definitions.

### Working with Trees in Python

**Preferred approach -- use treehelpers:**
```python
from ghpythonlib import treehelpers as th

# Tree input -> nested Python lists
nested = th.tree_to_list(tree_input)

# Nested Python lists -> Tree output
a = th.list_to_tree(nested_result)
```

**Manual tree construction:**
```python
from Grasshopper import DataTree
from Grasshopper.Kernel.Data import GH_Path
import Rhino.Geometry as rg

# Use typed trees when possible -- DataTree[int], DataTree[rg.Point3d], etc.
# DataTree[object] works as a fallback but typed trees integrate better with GH
tree = DataTree[rg.Point3d]()
for i, branch_data in enumerate(data):
    path = GH_Path(i)
    for item in branch_data:
        tree.Add(item, path)
a = tree
```

**Manual tree reading:**
```python
for i in xrange(tree.BranchCount):
    path = tree.Path(i)
    branch = tree.Branch(i)
    for item in branch:
        # process item
        pass
```

### Tree Gotchas
- `th.tree_to_list()` requires consistent branch depth -- overlapping or irregular paths will fail
- When outputting trees, the output variable type hint must be set to handle trees (or use no type hint)
- Grafting/flattening in Python: usually easier to restructure your nested lists and convert back with `th.list_to_tree()`

## Common Geometry Patterns

Read `references/rhinocommon-geometry.md` for the full API surface. Here are the patterns you'll use constantly:

### Creating Geometry
```python
import Rhino.Geometry as rg

# Points and vectors
pt = rg.Point3d(x, y, z)
vec = rg.Vector3d(1, 0, 0)

# Lines and curves
line = rg.Line(pt1, pt2)
circle = rg.Circle(plane, radius)
arc = rg.Arc(pt1, pt2, pt3)
nurbs = rg.NurbsCurve.Create(False, 3, control_points)  # non-periodic, degree 3
interp = rg.Curve.CreateInterpolatedCurve(points, 3)     # interpolated, degree 3

# Surfaces and Breps
srf = rg.NurbsSurface.CreateFromCorners(pt1, pt2, pt3, pt4)
loft = rg.Brep.CreateFromLoft(curves, rg.Point3d.Unset, rg.Point3d.Unset,
                               rg.LoftType.Normal, False)
extrusion = rg.Extrusion.Create(profile_curve, height, cap)
```

### Transformations
```python
# All geometry types support .Transform(xform) method
xform = rg.Transform.Translation(rg.Vector3d(10, 0, 0))
xform_rot = rg.Transform.Rotation(angle_radians, rg.Vector3d.ZAxis, center_pt)
xform_scale = rg.Transform.Scale(center_pt, factor)

# Apply: returns True/False for success
geometry.Transform(xform)

# Chain transforms by multiplying
combined = xform_rot * xform  # rotation then translation
```

### Boolean Operations

Boolean methods have multiple overloads. The most common mistake is passing wrong argument types.

```python
import Rhino
tol = Rhino.RhinoDoc.ActiveDoc.ModelAbsoluteTolerance

# --- CreateBooleanDifference overloads ---
# Overload 1: single Brep vs single Brep
diff = rg.Brep.CreateBooleanDifference(brep_a, brep_b, tol)

# Overload 2: collection vs collection (subtract all of set B from all of set A)
diff = rg.Brep.CreateBooleanDifference([base], cutters_list, tol)

# All boolean methods return Brep[] (array) or None on failure
union = rg.Brep.CreateBooleanUnion(breps, tol)
inter = rg.Brep.CreateBooleanIntersection(brep_a, brep_b, tol)

# ALWAYS check for None -- boolean ops fail silently
if diff is None or len(diff) == 0:
    print "Boolean difference failed"
```

**IronPython overload gotcha:** When passing Python lists to methods expecting `IEnumerable<Brep>`, IronPython sometimes resolves to the wrong overload. If a boolean call fails unexpectedly, try wrapping in a .NET List:
```python
from System.Collections.Generic import List as NetList
first_set = NetList[rg.Brep]()
first_set.Add(base)
diff = rg.Brep.CreateBooleanDifference(first_set, cutters, tol)
```

**Boolean operations are notoriously fragile.** Common failure causes: non-manifold geometry, tolerance mismatches, nearly-tangent surfaces, incorrect solid orientation. Always validate inputs with `brep.IsValid` and use document tolerance -- never hardcode it.

### Intersections
```python
from Rhino.Geometry.Intersect import Intersection

# Curve-Curve
events = Intersection.CurveCurve(crv1, crv2, tolerance, overlap_tol)
for e in events:
    pt = e.PointA

# Curve-Brep -- the out params are OVERLAP CURVES and POINTS, not points and UVs
success, overlap_curves, inter_points = Intersection.CurveBrep(crv, brep, tolerance)

# Brep-Brep
success, curves, pts = Intersection.BrepBrep(brep1, brep2, tolerance)

# Curve-Plane
events = Intersection.CurvePlane(crv, plane, tolerance)
```

### Mesh Operations
```python
# Create mesh from Brep
mesh_params = rg.MeshingParameters.Default  # or .Coarse, .Smooth
meshes = rg.Mesh.CreateFromBrep(brep, mesh_params)

# Build mesh manually
mesh = rg.Mesh()
mesh.Vertices.Add(0, 0, 0)
mesh.Vertices.Add(1, 0, 0)
mesh.Vertices.Add(1, 1, 0)
mesh.Faces.AddFace(0, 1, 2)  # triangle
mesh.Normals.ComputeNormals()     # vertex normals (per-vertex, interpolated)
mesh.FaceNormals.ComputeFaceNormals()  # face normals (per-face, flat)
mesh.Compact()
```

**Normals vs FaceNormals:** These are separate collections. `mesh.Normals` = per-vertex normals (for smooth shading). `mesh.FaceNormals` = per-face normals (one vector per triangle/quad). Each has its own compute method. If you need face normals, you must call `mesh.FaceNormals.ComputeFaceNormals()` -- calling `mesh.Normals.ComputeNormals()` does NOT populate FaceNormals. Alternatively, `mesh.RebuildNormals()` recomputes both.

## Parametric Design Patterns

### Attractor Point Logic
```python
import Rhino.Geometry as rg

# pts = grid of points, attractor = attractor point, max_radius = influence range
distances = []
for pt in pts:
    d = pt.DistanceTo(attractor)
    distances.append(d)

max_d = max(distances)
for i, pt in enumerate(pts):
    # Normalized influence: 1.0 at attractor, 0.0 at max_d
    influence = 1.0 - min(distances[i] / max_d, 1.0)
    # Use influence to drive scale, offset, color, etc.
    scaled = rg.Transform.Scale(pt, 0.2 + influence * 1.8)
```

### Surface Subdivision / Paneling

When placing geometry on a surface, always orient it to the surface normal at that point. Using a fixed axis like `Vector3d.ZAxis` only works for flat horizontal surfaces and will produce wrong results on any curved or tilted surface.

```python
# Divide surface into UV grid
u_count, v_count = 10, 10
u_domain = surface.Domain(0)
v_domain = surface.Domain(1)

panels = []
for i in xrange(u_count):
    for j in xrange(v_count):
        u = u_domain.ParameterAt(float(i) / u_count)
        v = v_domain.ParameterAt(float(j) / v_count)
        pt = surface.PointAt(u, v)
        normal = surface.NormalAt(u, v)  # ALWAYS use surface normal, not ZAxis

        # Create a plane oriented to the surface at this point
        plane = rg.Plane(pt, normal)

        # Now create geometry on this plane (circles, rectangles, etc.)
        circle = rg.Circle(plane, radius)
        panels.append(circle.ToNurbsCurve())
```

### Recursive Geometry
```python
def subdivide(curve, depth, results):
    if depth <= 0:
        results.append(curve)
        return
    # Split curve at midpoint
    t_mid = curve.Domain.Mid
    parts = curve.Split(t_mid)
    if parts:
        for part in parts:
            subdivide(part, depth - 1, results)

results = []
subdivide(input_curve, recursion_depth, results)
a = results
```

## Baking Geometry to Rhino Document

```python
import scriptcontext as sc
import Rhino

sc.doc = Rhino.RhinoDoc.ActiveDoc

# Add geometry with optional attributes
attr = Rhino.DocObjects.ObjectAttributes()
attr.LayerIndex = sc.doc.Layers.FindByFullPath("MyLayer", True)

obj_id = sc.doc.Objects.AddBrep(brep, attr)
# or: AddCurve, AddPoint, AddMesh, AddSurface, AddText, etc.

sc.doc.Views.Redraw()
sc.doc = ghdoc  # switch back
```

## Performance Optimization

### General Rules

1. **Use RhinoCommon over rhinoscriptsyntax** for anything touching more than ~50 objects
2. **Remove the `out` parameter only when shipping, never while developing.** `out` is the
   component's report channel -- `print` output, tracebacks, and any external error readback all
   arrive there. Removing it saves a little per-execution overhead but blinds you to errors. Keep
   it while iterating; strip it from finished definitions that run unattended (batch CNC output,
   long solves). If a definition suddenly produces no diagnostics, check whether `out` was removed.
3. **Avoid ghpythonlib.components in loops** -- each call has marshaling overhead. Use RhinoCommon equivalents for inner loops.
4. **Parallel processing** (use cautiously):
   ```python
   from ghpythonlib import parallel
   results = parallel.run(my_function, data_list)
   ```
   Do NOT combine with `ghpythonlib.components` -- causes memory leaks. Test thoroughly.
5. **Mesh for computation, NURBS for output** -- process with meshes for speed, convert to NURBS/Brep at the end if needed for fabrication/rendering.
6. **Cache intermediate results** in sticky dict:
   ```python
   if "cached_result" not in sc.sticky or sc.sticky["version"] != version:
       sc.sticky["cached_result"] = expensive_computation()
       sc.sticky["version"] = version
   result = sc.sticky["cached_result"]
   ```

### CRITICAL: GhPython Silent Output Data Loss (10K+ items)

GhPython silently drops large collections on output. This is the single most time-consuming debugging trap in GhPython and will cost hours if you don't know about it.

When a GhPython script assigns a value to an output variable, GhPython's runtime serializes it into a GH DataTree for the wire. For certain output types this serialization **silently fails** -- downstream components receive an empty list with no error message.

> **On the mechanism:** the trigger is the output's *type*, and size correlates rather than causes.
> Inspecting `NewComponentIOMarshal` in the shipped `GhPython.gha` shows the output path is a type
> dispatch over `GH_Structure<T>` (`GH_Number`, `GH_Integer`, `GH_String`, `GH_Boolean`, ...,
> falling back to `IGH_Goo`) with **no size threshold anywhere in the marshaller**. So "10K+" below
> is an empirical rule of thumb from the field, not a constant in the code -- large collections are
> where the type-dependent path gets exercised hardest and where the failure was noticed. Treat the
> type column as the real signal. The mitigation is correct regardless of mechanism.

| Output Type | Behavior |
|---|---|
| Python `list` (small, <1K) | Usually works |
| Python `list` (large, 10K+) | **SILENTLY DROPS** -- downstream receives empty list |
| `System.Array[float]` | **SILENTLY DROPS** -- downstream receives empty list |
| `DataTree[float]` | **ALWAYS WORKS** |
| `DataTree[Point3d]` | **ALWAYS WORKS** |
| Single scalars (int, float, str) | Always works |

**The fix**: Always use `DataTree[T]` for large outputs:

```python
from Grasshopper import DataTree
from Grasshopper.Kernel.Data import GH_Path
from System.Collections.Generic import List as NetList

# For float arrays:
z_tree = DataTree[float]()
z_tree.AddRange(NetList[float](z_arr), GH_Path(0))
z_values = z_tree  # output variable

# For Point3d lists:
pt_list = NetList[rg.Point3d]()
for k in xrange(total):
    pt_list.Add(rg.Point3d(x, y, z))
pt_tree = DataTree[rg.Point3d]()
pt_tree.AddRange(pt_list, GH_Path(0))
pts = pt_tree  # output variable
```

### IronPython Loop Bottleneck -> Compiled C# DLL Pattern

IronPython 2.7 interprets every operation. For tight numeric loops over 10K+ items, it is 1000-7000x slower than compiled C#. If a GhPython node takes seconds and the profiler shows >10% of total pipeline time on a node with a `for k in xrange(total):` loop over thousands of items, the fix is never "optimize the Python" -- it's "move the loop to compiled C#."

The recommended architecture is: **GhPython wrapper (thin I/O) + compiled C# DLL (heavy math)**. This eliminates IronPython bottlenecks while keeping GhPython's easy input/output and DataTree handling. Avoid replacing GhPython nodes with C# Script Components -- they require manual setup of every input parameter and can't have same-named inputs and outputs.

For the full compiled DLL pattern, including compilation on macOS with Mono, DLL deployment, loading patterns, IronPython tuple-return for .NET out parameters, GH_Number unwrapping, wire marshaling overhead, and a complete optimization workflow, read: `references/ghpython-dll-optimization.md`

### When to Read the DLL Optimization Reference

Read `references/ghpython-dll-optimization.md` whenever:
- A GhPython node shows >10% of pipeline time with a loop over 10K+ items
- Downstream nodes receive empty data from a GhPython node (silent output serialization failure)
- You need to compile and deploy a C# DLL for Grasshopper on macOS
- You're debugging data transfer between GhPython nodes
- You're considering replacing a GhPython node with a C# Script Component (don't -- read the reference first)
- The user mentions performance problems in a multi-node Grasshopper pipeline

## GhPython Default Parameter Pattern

Unconnected GhPython inputs arrive as `None`. Check for this to provide defaults:

```python
# Idiomatic GhPython default handling
if u_count is None:
    u_count = 20
if v_count is None:
    v_count = 20
if max_radius is None:
    max_radius = 1.0
```

This is cleaner and more reliable than checking `dir()` or `globals()`. It also makes the script self-documenting about what's optional.

## File-Based Workflow

When working with .py files extracted from GhPython components (editing outside Grasshopper):

### Script Structure for Standalone .py Files
```python
#! python 2
"""
Description of what this component does.

Args:
    x (Point3d): Input points
    y (float): Scale factor

Returns:
    a (Curve): Output curves
"""
import Rhino.Geometry as rg

# Your logic here
# Inputs come from GH component inputs (x, y, etc.)
# Assign outputs to GH component outputs (a, b, etc.)
a = process(x, y)
```

**Every script must start with `#! python 2` on line 1.** This header tells the script component which language version to use. Without it, the component may default to the wrong interpreter. For Rhino 7, always use `python 2`. Put it before the docstring, before imports, before everything.

### Project Organization
When managing .py files in a repo alongside .gh definitions:

```
project/
  definition.gh           # Grasshopper definition (references the .py files)
  scripts/
    attractor_grid.py     # Extracted from GhPython component "attractor_grid"
    boolean_ops.py        # Extracted from GhPython component "boolean_ops"
    utils.py              # Shared utility functions
```

Each .py file corresponds to one GhPython component. The mapping between .gh and .py is manual -- when you edit a .py file, you paste it back into the GhPython component (or use a file-reading component to load it at runtime).

### Importing Shared Code Between Components
```python
import sys
sys.path.append(r"C:\path\to\your\scripts")
import utils  # shared across multiple components

# Or use os.path relative to the script location
import os
script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, script_dir)
```

### Keeping .py Files in Sync
There's no automatic sync between .py files and .gh components. Options:
- **Manual paste**: Edit .py, copy contents, paste into GhPython component
- **FileReader component**: Wire a File Path + Read File component into a GhPython evaluator that `exec()`s the loaded text (fragile but automatic)
- **ScriptParasite plugin** (Food4Rhino): Links GhPython components to external .py files with live reload

### Rhino 8 Migration Note
Rhino 8 adds a CPython 3 script component alongside IronPython 2.7, delivered through McNeel's
RhinoCode scripting stack. Scripts written for Rhino 7 still run in Rhino 8's IronPython 2 mode.
To ease future migration, consider `from __future__ import division, print_function` at the top of
new scripts -- this makes Python 2 code behave more like Python 3 for division and print.

Two Rhino 8 differences that matter if you ever move a definition across:

- Rhino 7's dedicated **GhPython Script** component (`Math` > `Script`, nickname `Python`) is
  replaced by a unified **Script** component that infers its language from a first-line directive
  (`#! python 3`, `#! python 2`, or `// #! csharp`). A body with no directive fails at solve time.
- The Rhino 7 component's source is settable programmatically via its public `Code` property; the
  Rhino 8 components expose `SetSource()` instead and do not carry `Code`.

These are stated from the Rhino 7 side, which is what is verified here. Anything specific to
Rhino 8's runtime should be checked against a Rhino 8 install before relying on it.

## Reference Files

For deeper API details, read:
- `references/rhinocommon-geometry.md` -- Full RhinoCommon geometry class reference (Point3d, Curve, Surface, Brep, Mesh, Transform, Intersection)
- `references/rhinoscriptsyntax-api.md` -- Key rhinoscriptsyntax functions organized by category
- `references/grasshopper-sdk.md` -- Grasshopper SDK details, component creation, data trees, type hints
- `references/ironpython-27-guide.md` -- IronPython 2.7 survival guide (.NET interop, missing modules, Python 2 vs 3 pitfalls)
- `references/rhino-commands-macros.md` -- Rhino command macros and RhinoScript (VBScript) reference
- `references/ghpython-dll-optimization.md` -- Compiled C# DLL pattern for eliminating IronPython bottlenecks, silent output data loss fixes, DLL compilation/deployment, optimization workflow (read this FIRST for any performance work)

Canvas-side references (how Grasshopper itself behaves, as opposed to what you write inside a node):
- `references/grasshopper-geometry-orientation.md` -- Plane-driven orientation, Plane Normal vs Construct Plane, the perpendicular-cylinder trap, and the cone whose base (not tip) lands on your plane
- `references/grasshopper-data-matching.md` -- How GH pairs data between inputs: longest-list vs cross product, the N x M problem (pairs with the Python-side Data Trees section above)
- `references/grasshopper-type-system.md` -- Goo containers and the verified conversion matrix; conversions are directional, and Number->Integer rounds rather than truncating
- `references/grasshopper-canvas-patterns.md` -- Goal-to-component-chain lookup, conditionals, arrays, cluster gotchas

The four `grasshopper-*.md` files are adapted from the Cordyceps project
(https://github.com/brookstalley/cordyceps, MIT, Copyright (c) 2026 Brooks Talley), rewritten for
Rhino 7 and re-verified against the shipped assemblies. Several upstream claims were found
incorrect and corrected -- see each file's header. Re-verify all machine-checkable claims after any
Rhino upgrade with `scripts/verify-rhino-claims.sh "/Applications/Rhino N.app"`.

## Tolerances

Always read tolerances from the document. Never hardcode them. Requires `import Rhino` at top of script.

```python
import Rhino

tol = Rhino.RhinoDoc.ActiveDoc.ModelAbsoluteTolerance  # typically 0.01 or 0.001
angle_tol = Rhino.RhinoDoc.ActiveDoc.ModelAngleToleranceRadians
```

Many operations (booleans, intersections, joining) require tolerance parameters. Using incorrect tolerances is the #1 cause of "it works sometimes" bugs.

## Debugging Tips

- `print` statements show in the GhPython component's output panel (the `out` output)
- Use `Rhino.RhinoApp.WriteLine()` for messages in Rhino's command line
- Check `brep.IsValid` before operations -- invalid geometry causes silent failures
- If a boolean or intersection returns None, the geometry is probably invalid or the tolerance is wrong
- Use `rs.coerce*` functions when you need to convert between GUIDs and geometry objects
