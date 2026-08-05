# GhPython Performance Optimization: Compiled C# DLL Pattern

## Hard-Won Lessons from the MeshCraft Optimization

This reference documents critical GhPython behaviors and the compiled DLL pattern for eliminating IronPython bottlenecks in Grasshopper. Everything here was verified empirically in Rhino 7 / Grasshopper on macOS.

---

## The Core Problem

IronPython 2.7 interprets every operation. For tight numeric loops over 10K+ items, it is 1000-7000x slower than compiled C#. JavaScript V8 JIT is also dramatically faster than IronPython for the same reason. If a GhPython node takes seconds and processes thousands of items in a loop, the fix is always: move the loop to compiled C#.

**Diagnosis**: If a GhPython node shows >10% of total pipeline time AND contains a `for k in xrange(total):` loop over thousands of items, it's an IronPython bottleneck. The fix is never "optimize the Python" -- it's "don't use Python for that loop."

---

## GhPython Output Serialization: Silent Data Loss

**CRITICAL BUG**: GhPython silently drops large collections on output. This is the single most time-consuming debugging trap in GhPython.

### What Happens

When a GhPython script assigns a value to an output variable, GhPython's runtime serializes it into a GH DataTree for the wire. For large collections (10K+ items), this serialization SILENTLY FAILS for certain types:

| Output Type | Behavior |
|---|---|
| Python `list` (small, <1K) | Usually works |
| Python `list` (large, 10K+) | **SILENTLY DROPS** -- downstream receives empty list |
| `System.Array[float]` | **SILENTLY DROPS** -- downstream receives empty list |
| `DataTree[float]` | **ALWAYS WORKS** |
| `DataTree[Point3d]` | **ALWAYS WORKS** |
| Single scalars (int, float, str) | Always works |

### The Fix: Always Use DataTree for Large Outputs

```python
from Grasshopper import DataTree
from Grasshopper.Kernel.Data import GH_Path
from System.Collections.Generic import List as NetList
import Rhino.Geometry as rg

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

### Debugging Output Serialization

If a downstream node receives empty data from a GhPython node:

1. **Verify data exists in the script**: Add `_msg(_warn, "len=%d" % len(my_list))` before the output assignment
2. **Inspect the GH parameter directly** (bypasses Python variable):
```python
# In the RECEIVING node, inspect the input parameter's raw data:
param = ghenv.Component.Params.Input[0]
_msg(_warn, "VolatileDataCount=%d" % param.VolatileDataCount)
_msg(_warn, "PathCount=%d" % param.VolatileData.PathCount)
if param.VolatileData.PathCount > 0:
    branch = param.VolatileData.get_Branch(0)
    _msg(_warn, "Branch(0).Count=%d" % branch.Count)
```
3. **Inspect upstream through the wire**:
```python
sources = ghenv.Component.Params.Input[0].Sources
if sources.Count > 0:
    src = sources[0]
    _msg(_warn, "Source name=%s VolatileDataCount=%d" % (src.Name, src.VolatileDataCount))
```
4. **Check output parameter names**: GhPython maps script variables to outputs by NickName. Verify with:
```python
for i in range(ghenv.Component.Params.Output.Count):
    p = ghenv.Component.Params.Output[i]
    _msg(_warn, "OUT[%d] Name='%s' NickName='%s'" % (i, p.Name, p.NickName))
```

### Key Diagnostic: VolatileData is populated AFTER script completes

Reading `ghenv.Component.Params.Output[i].VolatileData` from WITHIN the same script always shows 0. GhPython populates output parameters after the script finishes. This is normal, not a bug.

---

## GH Data Marshaling Overhead

When data flows through a GH wire from one component to another, each item gets wrapped in a GH type (GH_Number, GH_Point, etc.). The receiving component then unwraps these. For large collections, this wrapping/unwrapping is a significant performance cost.

### What This Means

- A C# Script Component receiving 10K Point3d values may spend more time on GH marshaling than on actual computation
- If a C# Script Component unexpectedly shows high % time but the code is trivial, the bottleneck is wire transfer, not the script
- **Fix**: Re-paste the code (stale component data), or reduce wire transfers by combining operations into fewer nodes

### Minimizing Wire Overhead

- Combine sequential operations into a single node when possible
- Pass raw numeric arrays through the DLL instead of Point3d lists through wires
- The DLL's interleaved xyz format (`[x0,y0,z0, x1,y1,z1, ...]`) avoids Point3d wire overhead entirely

---

## Compiled C# DLL Pattern

### Architecture

```
GhPython wrapper (thin I/O layer)
  |-- loads DLL via clr.AddReference()
  |-- reads GH inputs, converts types
  |-- calls compiled C# method (heavy math)
  |-- wraps output as DataTree
  |-- assigns to output variable
```

### Why GhPython Wrapper + DLL (not C# Script Component)

- GhPython handles GH input/output, type conversion, and DataTree construction naturally
- C# Script Components require manual input setup (name, type, access mode for EVERY parameter) -- painful for 10+ inputs
- C# Script Components can't have input and output with the same name (e.g., `cols` in, `cols` out)
- DLL code is version-controlled in a .cs file, compiled once, loaded everywhere
- Same DLL can serve multiple GhPython nodes

### Compiling on macOS

```bash
# Requires Mono: brew install mono
cd ~/Code/grasshopper/ghpy
mcs -target:library -out:MeshCraftNoise.dll MeshCraftNoise.cs
```

### DLL Deployment

Copy the compiled DLL to ALL of these locations:
1. GH Libraries folder (for `clr.AddReference("Name")` by name):
   `~/Library/Application Support/McNeel/Rhinoceros/7.0/Plug-ins/Grasshopper (b45a29b1-...)/Libraries/`
2. Next to the .gh file (fallback for `clr.AddReferenceToFileAndPath()`)
3. Your source repo (for version control)

**MUST RESTART RHINO** after updating the DLL. GH caches loaded assemblies.

### DLL Loading Pattern (robust, two-fallback)

```python
import clr, os

_dll_name = "MeshCraftNoise"
_loaded = False

# Try 1: GH Libraries folder (by name)
try:
    clr.AddReference(_dll_name)
    _loaded = True
except:
    pass

# Try 2: Next to .gh file (by path)
if not _loaded:
    try:
        _gh_dir = os.path.dirname(ghdoc.Path) if ghdoc.Path else ""
        if _gh_dir:
            dll_path = os.path.join(_gh_dir, _dll_name + ".dll")
            if os.path.exists(dll_path):
                clr.AddReferenceToFileAndPath(dll_path)
                _loaded = True
    except:
        pass

if not _loaded:
    _msg(_err, "Cannot find " + _dll_name + ".dll")
else:
    from MeshCraftNoise import Generate, Shape, Smooth, BuildFaces
```

### IronPython Tuple-Return for .NET Out Parameters

C# methods with `out` parameters return tuples in IronPython. Call with fewer arguments:

```csharp
// C# signature:
public static double[] Generate(..., out int cols, out int rows)
```

```python
# IronPython call (omit out params, get tuple back):
result = Generate(nt, sd, freq, octs, pers, lac, dist, ga, gb, mx, my, res)
z_arr = result[0]   # Array[float] -- the return value
cols = result[1]     # int -- first out param
rows = result[2]     # int -- second out param
```

### GH_Number Unwrapping

Data arriving through GH wires is wrapped in GH types. When you receive a `List[float]` through a wire, each element is actually a `GH_Number`, not a raw float. Calling `float(z_values[k])` in a tight loop is slow.

**Bulk extract once**:
```python
z_arr = System.Array.CreateInstance(float, total)
for k in xrange(total):
    z_arr[k] = float(zv_in[k])
# Now pass z_arr to the DLL
```

This is still IronPython overhead. For maximum performance, avoid receiving large float lists through GH wires entirely -- keep data inside the DLL between operations.

---

## DLL API Design Principles

### Return Interleaved Arrays, Not Objects

```csharp
// GOOD: returns double[] -- fast to pass through IronPython
public static double[] Shape(...) {
    double[] result = new double[total * 3];
    // result[k*3] = x, result[k*3+1] = y, result[k*3+2] = z
    return result;
}

// AVOID: would require IronPython to construct Point3d objects
// (IronPython can't directly consume C# Point3d without Rhino references in the DLL)
```

### Chain DLL Calls Without GH Wires

```python
# Node 2 calls Shape() then Smooth() on the same array -- no wire overhead
xyz = Shape(z_arr, cols, rows, ...)
if sm_iter > 0:
    xyz = Smooth(xyz, cols, rows, sm_iter, sm_str)
# Only THEN build Point3d and DataTree for wire output
```

### Keep CNC Logic in the DLL

Normalize-then-map belongs in compiled code:
```csharp
// Two-pass: shape all values (tracking min/max), then normalize to CNC coordinates
// Pass 1: shaped[k] = shaping_pipeline(zValues[k]); track nMin, nMax
// Pass 2: t = (shaped[k] - nMin) / range; z = t * amplitude + offset
```

---

## C# Script Component Pitfalls

When a C# Script Component is unavoidable:

- Input and output CANNOT share the same name (`cols` in + `cols` out = compile error)
- Default output is `A` -- add more via right-click > Manage Outputs (`B`, `C`, etc.)
- Set output Type Hint to "No Type Hint" if outputting geometry (prevents double->Point3d cast errors)
- After pasting code, if the component shows unexpected high % time, re-paste -- stale component state is real
- Inputs must be added via the component ZUI with correct types before pasting code

---

## Optimization Workflow: Do NOT Start With Code Changes

1. **Measure first**: Note each node's % time. Identify the bottleneck.
2. **Diagnose the cause**: Is it IronPython loop overhead? GH wire marshaling? Stale component data?
3. **Choose the right fix**:
   - IronPython loop bottleneck -> move loop to DLL
   - GH wire marshaling -> combine nodes or re-paste code
   - Output serialization -> switch to DataTree output
4. **Preserve the working state**: ALWAYS back up the .gh file before making changes. Component replacement means re-wiring every input.
5. **Test incrementally**: Change one node at a time. Verify it works before moving to the next.
6. **NEVER replace a working GhPython component with a C# Script Component** unless you're prepared to manually recreate every input parameter with correct names, types, and access modes. The DLL + GhPython wrapper pattern avoids this entirely.

---

## Quick Reference: Node Architecture

```
[GhPython Node 1: Noise]
  - Loads DLL, calls Generate()
  - Outputs z_values as DataTree[float]
  - Outputs cols, rows, mesh_x, mesh_y as scalars

[GhPython Node 2: Shape]
  - Loads DLL, calls Shape() (+ optional Smooth())
  - Extracts GH_Number z_values into .NET array
  - Outputs pts as DataTree[Point3d]
  - Passes through cols, rows as scalars

[C# Script Node 3: Smooth]
  - Receives pts as List<Point3d>
  - Weighted neighbor smoothing on Z values
  - Outputs smoothed List<Point3d>

[GhPython Node 4: Surface]
  - Loads DLL, calls BuildFaces()
  - Builds Rhino Mesh from Point3d list + face indices
  - Outputs Mesh
```