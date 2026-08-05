# Grasshopper SDK Reference (Rhino 7)

## Table of Contents
1. [GhPython Component Setup](#ghpython-component-setup)
2. [Type Hints Reference](#type-hints)
3. [Data Trees In Depth](#data-trees)
4. [ghpythonlib.components (Node-in-Code)](#node-in-code)
5. [Custom Component Creation](#custom-components)
6. [Baking Patterns](#baking)
7. [Sticky Dictionary (Persistent State)](#sticky)
8. [ghenv Object](#ghenv)
9. [Common Grasshopper Component Equivalents](#component-equivalents)

---

## GhPython Component Setup

### Input Configuration
Right-click each input parameter to configure:

**Type Hint** -- determines automatic type conversion:
| Type Hint | Result Type | Use Case |
|-----------|-------------|----------|
| No Type Hint | object (raw) | When you want to handle conversion yourself |
| Point3d | Point3d | Point inputs |
| Vector3d | Vector3d | Direction vectors |
| int / float / bool / str | Python primitives | Numeric/text inputs |
| Curve | Curve | Any curve type |
| Surface | Surface | Surface inputs |
| Brep | Brep | Polysurface/solid inputs |
| Mesh | Mesh | Mesh inputs |
| Plane | Plane | Plane inputs |
| Circle | Circle | Circle inputs |
| Line | Line | Line inputs |
| Box | Box | Box inputs |
| Transform | Transform | Transformation matrix |
| Guid | System.Guid | When you need document references |
| ghdoc Object | varies | For rhinoscriptsyntax workflows |

**Access Mode** -- determines how data is delivered:
| Mode | Behavior | When to Use |
|------|----------|-------------|
| Item | Single value, GH iterates automatically | Default. Most common. |
| List | All values in branch as Python list | When you need all values at once |
| Tree | Full DataTree object | When branch structure matters |

### Output Configuration
Right-click outputs to set type hints. Usually leave as default (no hint) and let Grasshopper infer the type. The `out` output captures print statements -- remove it if unused (saves performance).

---

## Data Trees

### Core Classes
```python
from Grasshopper import DataTree
from Grasshopper.Kernel.Data import GH_Path
```

### Creating Trees
```python
tree = DataTree[object]()  # generic tree

# Add items to branches
tree.Add("item", GH_Path(0))        # branch {0}
tree.Add("item", GH_Path(0, 1))     # branch {0;1}
tree.Add("item", GH_Path(0, 1, 2))  # branch {0;1;2}

# Add list to branch
tree.AddRange(item_list, GH_Path(i))
```

### Reading Trees
```python
tree.BranchCount                     # number of branches
tree.DataCount                       # total items across all branches
tree.Branch(i)                       # list of items in branch i
tree.Path(i)                         # GH_Path for branch i
tree.Paths                           # all paths
tree.AllData()                       # flat list of everything
```

### GH_Path
```python
path = GH_Path(0)                   # {0}
path = GH_Path(0, 1)               # {0;1}
path = GH_Path(0, 1, 2)            # {0;1;2}
path = GH_Path(System.Array[int]([0, 1, 2]))  # from array

path.Length                          # number of indices
path[0], path[1]                     # index access
path.CullElement()                   # remove last index (returns new path)
path.AppendElement(idx)              # add index (returns new path)
```

### treehelpers Module
```python
from ghpythonlib import treehelpers as th

# Tree -> nested Python lists
nested = th.tree_to_list(tree_input)
# Result: [[branch0_items], [branch1_items], ...]

# Nested lists -> Tree
tree_output = th.list_to_tree(nested_list)

# Constraints:
# - All branches must be at same depth
# - Overlapping/irregular paths will fail
# - Works best with rectangular data
```

### Data Matching in GhPython
When a component has multiple inputs with different list lengths, Grasshopper applies data matching rules:

- **Shortest list**: stops at shortest input length
- **Longest list**: repeats last item of shorter lists
- **Cross reference**: all combinations (cartesian product)

In GhPython with Item access, GH handles matching automatically. With List access, you get the raw lists and manage matching yourself.

---

## Node-in-Code (ghpythonlib.components)

Call any native Grasshopper component as a Python function:

```python
import ghpythonlib.components as ghcomp

# Geometry operations
result = ghcomp.BrepBrep(brep1, brep2)
curves = ghcomp.Voronoi(points)
area = ghcomp.Area(geometry)

# Return values mirror component outputs
# Single output: returns value directly
# Multiple outputs: returns named tuple
area_result = ghcomp.Area(geometry)
area_result.area        # numeric area
area_result.centroid    # centroid point

# Math / utility
ghcomp.Remap(value, source_domain, target_domain)
ghcomp.Bounds(numbers)  # domain from min to max
ghcomp.Range(domain, steps)  # evenly spaced values
ghcomp.Series(start, step, count)

# Curves
ghcomp.OffsetCurve(curve, distance, plane, corners)
ghcomp.Fillet(curve, radius)
ghcomp.JoinCurves(curves, preserve)
ghcomp.DivideCurve(curve, count, kinks)
ghcomp.Contour(geometry, point, direction, distance)

# Surfaces
ghcomp.Loft(curves, options)
ghcomp.Extrude(base, direction)
ghcomp.SurfaceSplit(surface, curves)
ghcomp.IsoTrim(surface, domain)
ghcomp.EvaluateSurface(surface, uv)

# Mesh
ghcomp.MeshBrep(brep, settings)
ghcomp.DeconstructMesh(mesh)  # returns vertices, faces, colors, normals
ghcomp.ConstructMesh(vertices, faces, colors)

# Transform
ghcomp.Move(geometry, direction)
ghcomp.Rotate(geometry, angle, plane)
ghcomp.Scale(geometry, center, factor)
ghcomp.Mirror(geometry, plane)
ghcomp.Orient(geometry, source_plane, target_plane)

# Analysis
ghcomp.BrepClosestPoint(point, brep)
ghcomp.CurveClosestPoint(point, curve)
ghcomp.PointInBrep(point, brep, strict)
```

### Discovering Component Names
The function names match Grasshopper component names. If unsure of exact name, look at the component's full name in Grasshopper (hover over it). Spaces are removed and CamelCase is used.

### Limitations
- Cannot use with `ghpythonlib.parallel` (memory leak risk)
- Slower than direct RhinoCommon for inner loops
- Some components with complex input types may not work
- Component must be installed for its ghcomp function to exist

---

## Custom Component Creation

### Using executingcomponent Base Class
For creating installable GH components in Python:

```python
from ghpythonlib.componentbase import executingcomponent as component

class MyComponent(component):
    def RunScript(self, x, y):
        # x, y correspond to component inputs
        result = x + y
        return result  # single output
        # or: return (result_a, result_b)  # multiple outputs
```

### GHPY Compiler
The `ghpy` compiler packages Python scripts as `.ghpy` files (Grasshopper Python compiled components) that can be distributed and installed on other machines.

---

## Baking Patterns

### Basic Baking
```python
import scriptcontext as sc
import Rhino

# Switch to Rhino document
sc.doc = Rhino.RhinoDoc.ActiveDoc

# Add geometry
guid = sc.doc.Objects.AddBrep(brep)
# Also: AddCurve, AddPoint, AddMesh, AddSurface, AddText, AddTextDot

# Refresh viewport
sc.doc.Views.Redraw()

# Switch back to Grasshopper
sc.doc = ghdoc
```

### Baking with Attributes
```python
import Rhino.DocObjects as rd

sc.doc = Rhino.RhinoDoc.ActiveDoc

attr = rd.ObjectAttributes()

# Layer
layer_name = "MyLayer"
layer_index = sc.doc.Layers.FindByFullPath(layer_name, True)
if layer_index < 0:
    layer = rd.Layer()
    layer.Name = layer_name
    layer.Color = System.Drawing.Color.Red
    layer_index = sc.doc.Layers.Add(layer)
attr.LayerIndex = layer_index

# Color
attr.ObjectColor = System.Drawing.Color.Blue
attr.ColorSource = rd.ObjectColorSource.ColorFromObject

# Name
attr.Name = "my_object"

# Material
mat_index = sc.doc.Materials.Add()
mat = sc.doc.Materials[mat_index]
mat.DiffuseColor = System.Drawing.Color.Red
mat.CommitChanges()
attr.MaterialIndex = mat_index
attr.MaterialSource = rd.ObjectMaterialSource.MaterialFromObject

guid = sc.doc.Objects.AddBrep(brep, attr)
sc.doc.Views.Redraw()
sc.doc = ghdoc
```

### Batch Baking (Performance)
```python
sc.doc = Rhino.RhinoDoc.ActiveDoc
rs.EnableRedraw(False)  # disable redraw during batch

for geom in geometry_list:
    sc.doc.Objects.AddBrep(geom, attr)

rs.EnableRedraw(True)  # re-enable and redraw once
sc.doc.Views.Redraw()
sc.doc = ghdoc
```

---

## Sticky Dictionary (Persistent State)

`sc.sticky` persists between component executions within a Grasshopper session. Useful for caching expensive computations.

```python
import scriptcontext as sc

# Write
sc.sticky["my_key"] = expensive_result
sc.sticky["version"] = 42

# Read (with fallback)
result = sc.sticky.get("my_key", None)
if result is None:
    result = compute_expensive_thing()
    sc.sticky["my_key"] = result

# Invalidation pattern
current_hash = hash(str(input_data))
if sc.sticky.get("hash") != current_hash:
    sc.sticky["result"] = recompute(input_data)
    sc.sticky["hash"] = current_hash
result = sc.sticky["result"]
```

**Gotchas:**
- Sticky dict survives component re-execution but not Grasshopper restart
- All GhPython components share the same sticky dict -- use unique keys
- Don't store geometry objects that reference documents (they become invalid)
- Large cached data increases memory usage

---

## ghenv Object

The `ghenv` variable provides access to the component's environment:

```python
ghenv.Component                  # the GH_Component instance
ghenv.Component.Name             # component name
ghenv.Component.NickName         # component nickname
ghenv.Component.Params           # parameter access
ghenv.Component.Params.Input     # input parameters
ghenv.Component.Params.Output    # output parameters
ghenv.Component.Message          # set status message shown on component

# Expire the component (force re-solve)
ghenv.Component.ExpireSolution(True)

# Access parameter metadata
for p in ghenv.Component.Params.Input:
    p.Name                       # parameter name
    p.TypeHint                   # current type hint
    p.Access                     # access mode
    p.SourceCount                # number of connected wires
```

---

## Common Grasshopper Component Equivalents

Quick reference for translating between visual GH components and Python code:

| GH Component | ghcomp Equivalent | RhinoCommon Equivalent |
|--------------|------------------|----------------------|
| Move | `ghcomp.Move(geo, vec)` | `geo.Transform(rg.Transform.Translation(vec))` |
| Rotate | `ghcomp.Rotate(geo, angle, plane)` | `geo.Transform(rg.Transform.Rotation(angle, axis, center))` |
| Scale | `ghcomp.Scale(geo, center, factor)` | `geo.Transform(rg.Transform.Scale(center, factor))` |
| Loft | `ghcomp.Loft(curves)` | `rg.Brep.CreateFromLoft(curves, ...)` |
| Extrude | `ghcomp.Extrude(base, dir)` | `rg.Surface.CreateExtrusion(crv, vec)` |
| Offset Curve | `ghcomp.OffsetCurve(crv, d, pln)` | `crv.Offset(plane, dist, tol, corner)` |
| Divide Curve | `ghcomp.DivideCurve(crv, n)` | `crv.DivideByCount(n, True)` |
| Closest Point | `ghcomp.CurveClosestPoint(pt, crv)` | `crv.ClosestPoint(pt)` |
| Area | `ghcomp.Area(geo)` | `rg.AreaMassProperties.Compute(geo)` |
| Volume | `ghcomp.Volume(geo)` | `rg.VolumeMassProperties.Compute(geo)` |
| Mesh Brep | `ghcomp.MeshBrep(brep, settings)` | `rg.Mesh.CreateFromBrep(brep, params)` |
| Boolean Union | `ghcomp.SolidUnion(breps)` | `rg.Brep.CreateBooleanUnion(breps, tol)` |
| Boolean Difference | `ghcomp.SolidDifference(a, b)` | `rg.Brep.CreateBooleanDifference(a, b, tol)` |
| Deconstruct Point | direct `pt.X, pt.Y, pt.Z` | same |
| Construct Point | `ghcomp.ConstructPoint(x,y,z)` | `rg.Point3d(x,y,z)` |
| Evaluate Surface | `ghcomp.EvaluateSurface(srf, uv)` | `srf.PointAt(u, v)` |
| Surface Normal | part of EvaluateSurface result | `srf.NormalAt(u, v)` |
| Brep Join | `ghcomp.BrepJoin(breps)` | `rg.Brep.JoinBreps(breps, tol)` |
| Flip | `ghcomp.Flip(srf)` | `srf.Reverse(0)` / `srf.Reverse(1)` |
| Explode | `ghcomp.Explode(brep)` | iterate `brep.Faces` with `DuplicateFace` |
| Cull Pattern | `ghcomp.CullPattern(list, pattern)` | list comprehension with zip |
| List Item | `ghcomp.ListItem(list, index)` | `list[index]` |
| Dispatch | `ghcomp.Dispatch(list, pattern)` | two list comps with condition |
| Sort | `ghcomp.SortList(keys, list)` | `sorted(zip(keys, list))` |
| Remap | `ghcomp.Remap(val, src, tgt)` | manual: `(val-s0)/(s1-s0)*(t1-t0)+t0` |
