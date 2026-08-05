# Grasshopper Data Matching (Canvas Side)

> **Verified against:** Grasshopper `7.38.24338.17002` (2026-07-28). Component names verified by
> IL inspection of the shipped assemblies. Re-verify with
> `scripts/verify-rhino-claims.sh "/Applications/Rhino N.app"`.
>
> Adapted from [Cordyceps](https://github.com/brookstalley/cordyceps)
> `Knowledge/DataTreesGuide.md` (MIT, Copyright (c) 2026 Brooks Talley).

This file covers how Grasshopper **pairs data between two inputs on the canvas**. That is a
different problem from manipulating trees inside a script — for that, see the Data Trees section
in `SKILL.md` (`treehelpers`, `DataTree[T]`, and the silent large-output trap). The seam between
the two is documented at the bottom.

Wrong item counts are almost always a matching problem, not a logic problem.

## Path notation

Branches are addressed by path: `{0}` is one level, `{0;1}` two, `{0;1;2}` three. A path is an
address, not an index into a list — `{0;1}` and `{1;0}` are unrelated branches.

## Access modes

| Mode | The script/component sees | Use for |
|---|---|---|
| Item | One item at a time; GH loops for you | Most operations |
| List | The whole branch as a list | Sort, reverse, cull, anything order-dependent |
| Tree | The entire structure | Tree surgery |

Access mode is set per input. In a script component it is the same setting described under
"Inputs and Outputs" in `SKILL.md` — the canvas and script views of access are the same mechanism.

## How two inputs get paired

**Same structure** — items pair directly, index for index. This is the case you usually want.

**Same path, different counts** — longest-list matching. The shorter input's last item repeats to
fill:

```
A: {0}[1,2,3,4,5]   B: {0}[a,b]
→ (1,a) (2,b) (3,b) (4,b) (5,b)      5 results, b repeats
```

**Different paths** — cross product. Every branch of A meets every branch of B:

```
A: {0}[1,2,3]   B: {0}[a] {1}[b] {2}[c]
→ 9 results
```

## The N×M problem

**Symptom:** you have N items and M items, you expect N×M results, you get `max(N,M)`.

**Cause:** both inputs are flat and sit at the same path, so they longest-list match instead of
cross-producting.

**Fix:** graft one input. Grafting puts each item in its own branch, which makes the paths differ,
which triggers the cross product.

This is the single most common data-tree bug in Grasshopper and it is silent — you get a valid
result of the wrong size, not an error.

## Ask this before wiring

> **Do these two lists correspond one-to-one, or should every A combine with every B?**

| Relationship | Expect | Do |
|---|---|---|
| Paired by index | N results | Do not graft |
| All combinations | N×M results | Graft one input |

*Worked example:* 8 geometries and 3 offsets. If geometry₁ pairs with offset₁ (each object has its
own offset), do not graft — you want 8. If every geometry should be offset by all three amounts,
graft the offsets — you want 24. Nothing about the wires tells you which is intended; only you
know, which is why the question has to be asked deliberately.

## Tree operations

| Operation | Effect | Reach for it when |
|---|---|---|
| Graft | Each item becomes its own branch | You need the cross product |
| Flatten | All branches collapse to one list | You genuinely want to discard grouping |
| Simplify | Strips redundant path levels | Cleaning up; use sparingly, it can erase meaning |
| Path Mapper | Arbitrary path rewriting | Precise restructuring |
| Flip Matrix | Swaps rows and columns | Reorganizing a 2D grid |

Rules that save time:

1. Do not flatten reflexively. It destroys the relationships you will need two components later.
2. Prefer Path Mapper over Simplify when you care about the result — Simplify guesses.
3. Match structures *before* connecting, not after the counts come out wrong.

## Debugging

1. Attach a **Panel** to the suspect output. Panels show branch paths and item counts directly.
2. Use **Param Viewer** for a compact tree diagram when a Panel is too noisy.
3. Compare item counts at each step going upstream. The step where the count first diverges from
   your expectation is where the structures stopped matching.

## Where these rules stop applying

Everything above governs data **on the wire**. Once data enters a script component, canvas
matching is over and the script's own rules take over:

- Inputs arrive shaped by the access mode you set (Item / List / Tree).
- Inside the script, trees are `DataTree[T]` and are manipulated with `ghpythonlib.treehelpers`.
- **Outputs have their own trap:** large collections can be silently dropped on the way back out
  to the wire. See "GhPython Silent Output Data Loss" in `SKILL.md` — the mitigation is to emit
  `DataTree[T]` rather than a bare Python list.

So a wrong item count downstream of a script component has two possible causes, and they need
different fixes: canvas matching upstream of the script (this file), or output serialization
inside it (`SKILL.md`). Check which side of the boundary the count first goes wrong.

## Version deltas

| Version | Difference |
|---|---|
| 7.x | Baseline. All component names verified present. |
| 8.x and later | Not verified. Matching semantics are long-stable GH 1.0 behavior and are unlikely to change, but the harness only confirms component names exist, not that matching rules held. |
