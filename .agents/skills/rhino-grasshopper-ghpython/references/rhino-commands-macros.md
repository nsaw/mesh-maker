# Rhino Command Macros & RhinoScript (VBScript) Reference

## Rhino Command Macros

### Syntax Rules
- Commands typed as you would at the command line
- **Space** acts as Enter
- **Underscore prefix** `_` = English language command (works regardless of Rhino language)
- **Hyphen prefix** `-` = suppress dialog boxes (command-line only mode)
- **Exclamation** `!` at start = cancel any running command first

### Special Keywords
| Keyword | Action |
|---------|--------|
| `Pause` | Wait for user input (one pick/value) |
| `Multipause` | Wait for multiple picks (Rhino 6+) |
| `Enter` | Press Enter |
| `EnterEnd` | Press Enter to exit nested prompts |
| `_No` / `_Yes` | Boolean option responses |

### Example Macros

```
! _Circle _Pause 10
```
Cancel current command, start Circle, wait for center click, use radius 10.

```
! _-Properties _Pause _Object _Color _Object 255,0,0 _Enter _Enter
```
Set object color to red via command-line Properties.

```
! _SelNone _SelCrv _-Export "curves.dwg" _Enter
```
Deselect all, select all curves, export to DWG.

```
! _-Sweep1 _Pause _Pause _Enter _Closed=_No _Enter
```
Sweep1 with rail and cross-section picks, not closed.

### Macro Tips
- Chain commands with spaces (each space = Enter)
- Use `_-CommandName` to avoid dialog popups
- Test macros one step at a time
- Macros run in Rhino's command stream -- they can't branch/loop (use scripts for that)

### Running Macros
- Type directly in command line
- Assign to toolbar button (right-click button > Edit > Command field)
- Keyboard shortcut (Tools > Options > Keyboard)
- Alias (Tools > Options > Aliases)
- `ReadCommandFile` command (run macro from .txt file)

---

## RhinoScript (VBScript) -- Legacy Reference

RhinoScript is the VBScript-based scripting system. It's Windows-only and largely superseded by Python, but still found in legacy workflows.

### When RhinoScript Is Still Relevant
- Existing automation scripts in production
- Very old tutorials/references
- Windows-only environments where Python isn't available (rare)
- Some Rhino plugins that expose VBScript-only APIs

### Basic Syntax
```vbscript
' Variable declaration
Dim x, y, z
x = 10.0

' Function
Function AddMyPoint(x, y, z)
    AddMyPoint = Rhino.AddPoint(Array(x, y, z))
End Function

' Subroutine (no return value)
Sub DoSomething()
    Call Rhino.AddLine(Array(0,0,0), Array(10,10,0))
End Sub

' Arrays
Dim arr(2)
arr(0) = 1.0
arr(1) = 2.0
arr(2) = 3.0
' or: arr = Array(1.0, 2.0, 3.0)

' Loops
For i = 0 To 10
    ' ...
Next

Do While condition
    ' ...
Loop

' Conditionals
If x > 5 Then
    ' ...
ElseIf x > 0 Then
    ' ...
Else
    ' ...
End If
```

### RhinoScript Object Model
RhinoScript functions are accessed through the `Rhino` object (similar to `rs` in Python):

```vbscript
' Equivalent of rs.AddLine in Python
Rhino.AddLine Array(0,0,0), Array(10,0,0)

' Equivalent of rs.GetObject
strObject = Rhino.GetObject("Select object")

' Equivalent of rs.MoveObject
Rhino.MoveObject strObject, Array(10, 0, 0)
```

### Python Equivalents
| RhinoScript (VBScript) | rhinoscriptsyntax (Python) |
|------------------------|---------------------------|
| `Rhino.AddLine(...)` | `rs.AddLine(...)` |
| `Rhino.GetObject(...)` | `rs.GetObject(...)` |
| `Array(x, y, z)` | `[x, y, z]` or `(x, y, z)` |
| `Dim x` | `x = None` |
| `IsNull(x)` | `x is None` |
| `UBound(arr)` | `len(arr) - 1` |
| `For Each obj In arr` | `for obj in arr:` |

### Migration Advice
If maintaining legacy RhinoScript code, the most reliable migration path is to Python + rhinoscriptsyntax. The function names and signatures are nearly identical -- the main work is translating VBScript syntax to Python syntax.

---

## C# Scripting Components (Quick Reference)

C# scripting components in Grasshopper use the same RhinoCommon API but with C# syntax. Key differences from GhPython:

### RunScript Method
```csharp
private void RunScript(Curve crv, double t, ref object A)
{
    Point3d pt = crv.PointAt(t);
    Vector3d tan = crv.TangentAt(t);
    A = new Plane(pt, tan);
}
```

### Key Syntax Differences
| Python | C# |
|--------|-----|
| `pt = rg.Point3d(0, 0, 0)` | `var pt = new Point3d(0, 0, 0);` |
| `for i in xrange(10):` | `for (int i = 0; i < 10; i++)` |
| `pts = []` | `var pts = new List<Point3d>();` |
| `pts.append(pt)` | `pts.Add(pt);` |
| `if crv.IsClosed:` | `if (crv.IsClosed)` |
| `len(pts)` | `pts.Count` |
| `try: ... except:` | `try { } catch { }` |

### When to Use C# Over Python
- Maximum performance (no interpreter overhead)
- Complex type-safe data structures
- LINQ queries for data manipulation
- Parallel.For / async operations
- When interfacing with .NET libraries that have poor IronPython interop

### Additional Assemblies (C# component)
Right-click component > "Manage Assemblies" to add references to additional .NET libraries. Common additions: `System.Linq`, `System.Drawing`, `System.Collections.Generic`.
