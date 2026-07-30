# IronPython 2.7 for Rhino 7 -- Survival Guide

## Why This Matters
Rhino 7 uses IronPython 2.7.12, a .NET implementation of Python 2.7. This is NOT CPython, and it's NOT Python 3. Code generated for Python 3 will break. Code that assumes CPython standard library completeness will also break.

---

## Python 2 vs Python 3: Quick Reference

### Print
```python
# Correct (Python 2)
print "hello"
print "values:", x, y, z
print >> sys.stderr, "error"

# Also works (treated as expression grouping)
print("single value")

# BROKEN (Python 3 style)
print("multiple", "values")       # prints tuple ('multiple', 'values')
print(x, end="")                  # SyntaxError
print(f"formatted {x}")           # SyntaxError
```

### Division
```python
# Python 2: integer division by default
5 / 2          # = 2 (floor division)
5.0 / 2        # = 2.5 (float division)
5 / 2.0        # = 2.5

# If you want Python 3-style division everywhere:
from __future__ import division
5 / 2          # = 2.5
5 // 2         # = 2 (explicit floor division)
```

### String Formatting
```python
# Available in IronPython 2.7:
"Hello %s, you are %d years old" % (name, age)    # % formatting
"Hello {0}, you are {1} years old".format(name, age)  # .format()
"Hello {name}".format(name=name)                    # keyword format

# NOT available:
f"Hello {name}"                                     # f-strings (Python 3.6+)
```

### Strings and Unicode
```python
# Python 2: str = bytes, unicode = text
s = "hello"           # byte string
u = u"hello"          # unicode string
isinstance(s, basestring)  # True for both str and unicode

# Python 3 equivalent:
# str = text (unicode), bytes = bytes
# basestring doesn't exist in Python 3
```

### Dictionary Methods
```python
d = {"a": 1, "b": 2, "c": 3}

# Python 2: return lists
d.keys()        # ['a', 'b', 'c'] (list)
d.values()      # [1, 2, 3] (list)
d.items()       # [('a', 1), ('b', 2), ('c', 3)] (list)

# Python 2: return iterators (memory efficient for large dicts)
d.iterkeys()
d.itervalues()
d.iteritems()

# Python 2: membership test
d.has_key("a")  # True (deprecated but works)
"a" in d        # preferred
```

### Range and Iteration
```python
# Python 2
range(10)       # returns list [0, 1, ..., 9]
xrange(10)      # returns iterator (memory efficient)

# For large ranges, always use xrange
for i in xrange(1000000):   # OK: lazy evaluation
    pass

for i in range(1000000):    # BAD: creates million-element list in memory
    pass
```

### Exception Handling
```python
# Python 2 (both work)
try:
    something()
except ValueError, e:        # old style (comma)
    print e
except TypeError as e:       # new style (as keyword) -- preferred
    print e

# Raising exceptions
raise ValueError("message")   # preferred
raise ValueError, "message"   # old style, also works
```

### Imports and Modules
```python
# Relative imports (Python 2 default)
import foo                    # searches current package first, then sys.path
from . import foo             # explicit relative (also works)

# Absolute imports (Python 3 behavior, available via future)
from __future__ import absolute_import
import foo                    # only searches sys.path
```

### Other Python 2 Differences
```python
# input() vs raw_input()
name = raw_input("Enter name: ")   # Python 2: returns string
# input() in Python 2 evaluates the expression (dangerous!)

# map/filter return lists in Python 2
result = map(func, items)    # list (not iterator)
result = filter(func, items) # list (not iterator)

# reduce is a builtin (not in functools)
result = reduce(func, items)

# True/False are not keywords (can be reassigned, but don't)
# None is not a keyword either

# Old-style classes
class MyClass:              # old-style in Python 2
    pass
class MyClass(object):      # new-style (preferred, required for some features)
    pass

# Long integers
x = 1L                      # explicit long (unnecessary but valid)
x = 10000000000              # auto-promotes to long
```

---

## IronPython-Specific Considerations

### .NET Integration (CLR)
IronPython's killer feature is seamless .NET interop:

```python
import clr

# Add .NET assembly references
clr.AddReference("System.Drawing")
clr.AddReference("System.Windows.Forms")

# Import .NET namespaces directly
import System
import System.Drawing
from System.Collections.Generic import List, Dictionary

# Create .NET generic types
point_list = List[Rhino.Geometry.Point3d]()
point_list.Add(Rhino.Geometry.Point3d(0, 0, 0))

# .NET arrays
import System.Array
arr = System.Array[int]([1, 2, 3])
arr = System.Array[float]([1.0, 2.0, 3.0])
```

### System.Drawing Colors
```python
import System.Drawing

red = System.Drawing.Color.Red
custom = System.Drawing.Color.FromArgb(255, 128, 0)  # orange
custom_alpha = System.Drawing.Color.FromArgb(128, 255, 0, 0)  # semi-transparent red
```

### .NET Collections in Grasshopper Context
```python
from System.Collections.Generic import List
from Rhino.Geometry import Point3d

# Some RhinoCommon methods require IList<T> rather than Python lists
# Create a .NET List and populate it:
net_points = List[Point3d]()
for pt in python_point_list:
    net_points.Add(pt)

# Then pass to RhinoCommon:
result = SomeMethod(net_points)
```

### Missing Standard Library Modules
IronPython 2.7 is missing or has incomplete versions of several CPython modules:

**Missing entirely:**
- `pathlib` (Python 3.4+)
- `dataclasses` (Python 3.7+)
- `typing` (Python 3.5+)
- `asyncio` (Python 3.4+)
- `enum` (Python 3.4+)
- Most C-extension modules (numpy, scipy, pandas, etc.)

**Available but limited:**
- `os` / `os.path` -- works for file operations
- `sys` -- works
- `math` -- works
- `json` -- works
- `re` -- works
- `datetime` -- works
- `collections` -- partially (OrderedDict works, no Counter)
- `itertools` -- works
- `functools` -- partial (reduce is builtin, partial works)
- `copy` -- works
- `hashlib` -- works
- `random` -- works
- `struct` -- works
- `csv` -- works
- `xml.etree.ElementTree` -- works
- `zipfile` -- works

### Using External CPython Libraries
If you need numpy/scipy/etc., you can't use them directly in IronPython. Options:
1. **GH Python Remote plugin** -- bridges IronPython GhPython to a CPython process
2. **Pre-process data** externally with CPython, save to file, read in GhPython
3. **Use .NET alternatives** -- Math.NET Numerics (available via clr.AddReference)

### Performance Notes
- IronPython is JIT-compiled to .NET IL, so it's generally faster than CPython 2.7 for computation
- But startup/import time is slower
- .NET interop (RhinoCommon calls) is very fast because there's no marshaling layer
- String concatenation with `+` is slow for large strings (same as CPython) -- use `"".join(list)`
- List comprehensions are faster than equivalent for-loops

### Common IronPython Gotchas in Rhino 7
1. **Enum comparison**: Some .NET enums require explicit casting
   ```python
   # May fail: if result == Rhino.Commands.Result.Success
   # Use: if int(result) == int(Rhino.Commands.Result.Success)
   # Or: if result == Rhino.Commands.Result.Success  # usually works, test it
   ```

2. **Overloaded methods**: When .NET methods have multiple overloads, IronPython sometimes picks the wrong one
   ```python
   # Be explicit about types to help method resolution
   pt = Rhino.Geometry.Point3d(float(x), float(y), float(z))
   ```

3. **Garbage collection**: IronPython uses .NET GC, not CPython's reference counting. Objects may live longer than expected. Call `System.GC.Collect()` in extreme cases (rare).

4. **with statement**: Works for most types, but some .NET IDisposable objects may not implement `__enter__`/`__exit__` properly in IronPython. Use try/finally as fallback.

5. **Threading**: IronPython has no GIL (Global Interpreter Lock), so true multi-threading is possible but also means shared state is genuinely unsafe without locks.

---

## Useful __future__ Imports

```python
from __future__ import division         # 5/2 = 2.5 instead of 2
from __future__ import print_function   # print() as function
from __future__ import absolute_import  # Python 3-style imports
from __future__ import with_statement   # (already default in 2.7, but explicit is fine)
```

Using these makes your code more forward-compatible if you ever migrate to Rhino 8 (Python 3).
