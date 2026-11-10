# Running Rhino scripts on the Mac, and getting a mesh out safely

> Every claim here is tagged. **VERIFIED** means checked on 2026-11-10 against the shipped
> RhinoCommon `7.38.24338.17002` (reflection or `RhinoCommon.xml`) or a file on disk. **RECORDED**
> means taken from a past session's record and not re-run, because Rhino was open with Nick's work
> when this was written. Treat RECORDED items as leads and confirm them the first time you use one.

## 1. Pick the cheapest route that answers the question

| You need | Route | Launches Rhino |
|---|---|---|
| Does a member exist, what does it return | `scripts/rhino-api.sh 'Type::Member'` | no |
| Read or write a `.3dm` (layers, meshes, breps as data) | CPython `rhino3dm` | no |
| Mesh math on an STL/OBJ (bounds, closedness, outline, booleans) | CPython (`trimesh`, `shapely`, `manifold3d`) | no |
| Real RhinoCommon geometry ops (NURBS, Brep booleans, meshing a Brep) | a script run inside Rhino | yes |
| Author or edit a Grasshopper definition | inside Grasshopper (Cordyceps MCP when it is up) | yes |

Fifteen of the Bed-Caddy scripts use `rhino3dm` and forty-three use `trimesh` (import scan,
2026-11-10). Reach for those before automating the Rhino GUI.

## 2. Before you touch a running Rhino

```bash
pgrep -fl Rhinoceros
```

If that prints a process, it is Nick's working session. Nick has said agents may open and run
Rhino (2026-11-10), but a second instance does not work beside an open one: VERIFIED 2026-11-10,
a scripted launch next to his session opened no window, wrote nothing in 200 seconds, and had to
be killed. `scripts/rhino-run.sh` therefore refuses when Rhino is already running. Do not drive
his open session either: at that moment it had colour pickers and save panels open, and a script
ending in `_-Exit _No` would close his document unsaved. When Rhino is open, use a route from
section 1 that needs no Rhino, or ask him to close it.

`scripts/rhino-probe.py` executes the claims that reflection cannot prove. On 2026-11-10 Nick
opened a blank document and a copy without the exit line and without the Grasshopper import was
run in it through `-_RunPythonScript`. Every claim held; the output is
`scripts/rhino-probe-result-261110.json`. Still not executed: the `ghcomp` function names
(`BrepXBrep`, `RemapNumbers`, `Isotrim`), because importing `ghpythonlib` loads Grasshopper and
Grasshopper had just crashed that session. They rest on the name rule read from
`components.py` and the component names read from the `.gha` files. Run the full probe with
`scripts/rhino-run.sh scripts/rhino-probe.py /tmp/rhino-probe.json` when Rhino is closed.

## 3. Running a script inside Rhino

**Scripted launch (RECORDED, worked 2026-11-05 with no other Rhino open).** Use the wrapper:

```bash
~/.claude/skills/rhino-grasshopper-ghpython/scripts/rhino-run.sh script.py result.json [timeout]
```

It runs this, which is the process line captured from the 2026-11-05 session:

```bash
"/Applications/Rhino 7.app/Contents/MacOS/Rhinoceros" -nosplash \
  -runscript="-_RunPythonScript \"/absolute/path/to/script.py\""
```

Rules that go with it:

- There is no stdout back to you. The script writes its result to a file (JSON) at an absolute
  path, and you wait for that file with a timeout.
- The script ends Rhino itself: `Rhino.RhinoApp.RunScript("_-Exit _No", False)`. Then confirm with
  `pgrep` that the process is gone before the next step. A leftover Rhino from an interrupted
  script was found on 2026-11-05.
- First line `#! python 2`. IronPython 2.7 syntax only.
- Wrap the body in `try/except` and write the traceback into the result file. An uncaught error
  shows a modal dialog that blocks the process until a human dismisses it.

**In Nick's open session (RECORDED).** At Rhino's command line:
`-_RunPythonScript "/absolute/path/to/script.py"`. Driving the command line through screen
automation works and was used on 2026-10-29, but it is the slowest and least checkable route. Use
it only when the work needs the live document.

**Grasshopper.** The Cordyceps MCP server is configured for Claude Code and refused connections on
2026-11-10. Codex has no Cordyceps entry in `~/.codex/config.toml`. If the MCP tools are not in
your tool list, you cannot edit a live definition; write the component source to the owning
`scripts/` tree and say that it has not been loaded into a definition.

## 4. Documents without a window

| Member | Status |
|---|---|
| `Rhino.RhinoDoc.OpenHeadless(path)` | VERIFIED present, `<since>7.0</since>`. RECORDED: returned `None` for a copied `.3dm` on 2026-11-05. Always test for `None` |
| `Rhino.RhinoDoc.CreateHeadless(template)` | VERIFIED present, `<since>7.0</since>`, and EXECUTED 2026-11-10: `CreateHeadless(None)` returned a document. A 2026-09-28 record calling it "Rhino 8 only" is wrong |
| `doc.Import(path)`, `doc.Export(path)` | VERIFIED present, return `bool`. Check the return |
| `Rhino.FileIO.File3dmLayerTable.Add(layer)` | VERIFIED returns `Void`. Do not use its result as a layer index (the 2026-09-28 "expected int, got NoneType" failure) |
| `Rhino.Display.ViewCapture.CaptureToBitmap(view)` | VERIFIED present. RECORDED: returned `None` in a `-nosplash` scripted instance. Do not plan on screenshots from a scripted launch; export the mesh and render it elsewhere |

## 5. Before any mesh leaves Rhino

Run these on the exact object you are about to export, and write the answers into the handoff
sidecar. All members are in `scripts/verified-members.txt`.

```python
#! python 2
import Rhino, Rhino.Geometry as rg
units = str(Rhino.RhinoDoc.ActiveDoc.ModelUnitSystem)   # STL carries no units; record this
closed = mesh.IsClosed
manifold, oriented, has_boundary = mesh.IsManifold(True)
naked = mesh.GetNakedEdges()                            # None on a closed mesh (executed 2026-11-10)
flipped = mesh.UnifyNormals()                           # faces rewound; 0 means winding was consistent
volume = mesh.Volume() if closed else None              # negative or tiny means inward winding
bbox = mesh.GetBoundingBox(True)
tris = mesh.Faces.TriangleCount + 2 * mesh.Faces.QuadCount
```

A mesh that is not closed is a surface, not a solid. Aspire will still import it, but say so in the
sidecar; do not call it a solid.

After export, read the STL back from disk and compare triangle count and bounds to the values
above. On 2026-11-07 an ASCII STL and its binary `.stlbak` had the same facet count and vertices
that differed by up to 13.4 inches, and one stray triangle moved the bounding box by 1.5 inches.
The file on disk is the thing the shop gets, so it is the thing to measure.

## 6. Top-view outline of a mesh

`mesh.GetOutlines(rg.Plane.WorldXY)` (VERIFIED present, returns `Polyline[]`). The name is plural.
EXECUTED 2026-11-10 on a radius-2 mesh sphere: one closed polyline, 25 points, bounds -2 to 2 in
X and Y. It has not been run on a production carving mesh, so check that the result is closed and
that its bounds match the mesh before using it as a cut boundary.

What past sessions did when they did not find it, in the order they tried (RECORDED, 2026-11-05):

| Attempt | Result |
|---|---|
| `Mesh.GetOutline` | `AttributeError`; the method is `GetOutlines` |
| `_Make2D` in a scripted instance | returned `False`, no curves |
| `HiddenLineDrawing.Compute` | curves came back, but in a different coordinate space and not closed |
| raster flood fill plus boundary trace | worked; resolution-limited |
| union of projected triangles with `shapely` (2026-11-07) | worked; exact |

For a section at a height, `rg.Mesh.CreateContourCurves(mesh, plane)` or
`Intersection.MeshPlane(mesh, plane)`. A section is not a silhouette: on 2026-11-05 the section at
the deck plane was closed for the body and open for the veil, and 93,006 vertices overhung it.

## 7. DXF for the shop

Write the units into the header. `ezdxf`'s R12 writer does not emit `$INSUNITS` (RECORDED,
2026-11-07); the delivered file used a hand-written header with `$INSUNITS = 1` (inches). Open the
finished file as text and confirm the tag is there.
