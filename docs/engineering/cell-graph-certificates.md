# Cell graph proof contract

The input is a completed query `/2` producer snapshot, copied once. The owner policy and runtime kernel coefficients are checked as specified in [kernel binding](cell-graph-kernel-binding.md). Ordered Float64 sites, stable IDs and the effective query metric determine the graph. Placement and current UI state are not consulted. Every failure returns a reason without a graph. No DXF is emitted on failure.

## Exact constant metric

Binary64 input coordinates and metric constants are decoded as exact reduced dyadic rationals. For each site the algorithm intersects the board with every competing site's closed metric half-plane. The rotation and scale are applied algebraically to the bisector covector, without rounding transformed vertices. This is equivalent to clipping the Euclidean diagram to the actual transformed board polygon, rather than its bounding box. Directed interval tests may prove a plane redundant; every unresolved test uses rational clipping. Competing sites arrive nearest first from a bucket grid, and the loop stops at the first one whose Euclidean distance is at least twice the cell's farthest vertex in the metric: by the triangle inequality no later site is strictly nearer than the owner at any vertex, and the metric distance bounds the Euclidean one from above. Each new vertex is the Cramer intersection of its edge's own line with the clip line, the same exact point the segment parameter gives. Order changes only work.

Coincident coordinates retain all saved IDs. Only the lowest ID owns area. Point and line contacts are not cells. Edge keys contain reduced rational endpoints, so cocircular junctions retain one identity without coordinate quantization. A non-boundary edge must have two owners and each edge is emitted once. Empty inputs retain the closed board outline.

Emission proves a coordinate error below the explicit conversion budget. For nonincident edges, exact point-to-segment distance exceeds the sum of perturbation corridors. For incident edges the determinant perturbation bound preserves orientation. Collinear opposite rays must retain their exact common line. These conditions certify the straight embedding through linear endpoint conversion, not merely the absence of crossings in the final drawing. Only edge pairs whose boxes come within the 4e-10 corridor are examined, through a grid over padded boxes; outward intervals decide each predicate first, and exact rationals decide whatever the intervals leave open.

## Continuous Simplex model and source residue

The model is the full sum of the compactly supported corner polynomial

`70 max(0, 1/2 - |r|²)^4 (g dot r)`

on the ideal triangular lattice, with exactly the runtime's copied permutation and gradient table. The ideal skew constants use an outward interval around sqrt(3). The runtime descriptor has an explicit implementation tag. The supported tag is `meshcraft-simplex2-fisher-yates-mulberry32-v1`. A changed or unsupported tag or mismatched coefficient table refuses certification.

A support disk has radius sqrt(1/2). The skew transform maps a displacement (a, b) to a + (a + b)F per coordinate, of magnitude at most sqrt((1+F)^2 + F^2) sqrt(1/2) = 1, because F(1+F) = 1/2. Enumerating the skew-coordinate box expanded by one therefore includes every vertex with nonzero support; a vertex exactly one away contributes zero. The interval implementation enumerates those vertices rather than selecting a simplex from the midpoint.

For the ideal containing simplex the selected three vertices contain every nonzero contribution. Across the `x0 > y0` diagonal the exchanged vertex is at squared distance at least 1/2. Across a skew-floor boundary the same statement holds after translating the adjacent simplex. Thus an omitted vertex has nonpositive support outside the transition strip. On support boundaries the value and its first three derivatives vanish because of the fourth power. At an exact simplex boundary the three-corner and full-lattice sums agree, including degenerate zero contributions.

The source evaluates sqrt(3), the skew and unskew expressions, branch decisions and polynomial using binary64 arithmetic. The bound uses `u=2^-53`, `gamma(n)=n*u/(1-n*u)` with outward arithmetic. Within the supported input-magnitude domain M, integer lattice indices have magnitude at most `2(M+1)`. The coordinate error bound is `gamma(32)*(1+2M+8*2(M+1))`. This covers the rounded sqrt/skew constants and all selected-vertex coordinate expressions. A changed floor or diagonal branch is confined to that coordinate-error strip. Every omitted or extra vertex in the strip has support at most sixteen times that error; at most sixteen nearby vertices are charged. Their sum is bounded by `16*70*2*strip^4`.

For retained corners, use the gradient L1 norm because coordinate errors are bounded per component. The declared magnitude scope gives coordinateError below 1e-6. On that enlarged support, t <= 0.50001, ||r||1 <= 1.00001, ||g||1 <= 2 and |g dot r| <= 1.00001. The explicit L1 bound `70*(0.50001^4*2 + 8*0.50001^3*1.00001^2)` is below 128. The three corners therefore charge coordinate perturbations by `384*coordinateError`. The remaining polynomial and final summation error is bounded by `gamma(128)*256`. The intermediate magnitudes fit this bound: support is at most slightly above 1/2, |g| <= sqrt(2), and coordinates of a contributing corner are below one. Absolute subnormal rounding errors are dominated by this positive bound throughout the declared domain.

The complete warp residue is per component in world inches. It also charges both source input operations `x*f` and the optional offset addition by `2^-52*M`, with the same derivative bound, then charges the final noise multiplication and world-coordinate addition by `2^-50*(1+maxWorld+3A)`. Euclidean residuals use both component bounds through a squared-sum norm. Source evaluation is used for iteration. The a posteriori residual at a point uses the source value widened by twice the residue, which contains the continuous model (within one residue) and everything its own enclosure admits; an inverse is accepted only against that enclosure.

This derivation is part of the review surface. Numerical derivative samples can falsify it but do not replace it. The magnitude domain, implementation identity, work cap and every unresolved proof are explicit refusal conditions.

## Contraction, inverse and curve error

Each corner contribution is at most

`70 sqrt(2) sqrt((1/2)/9) ((1/2)-(1/2)/9)^4`.

Three times this value is below three. Therefore component displacement is bounded by `D=3A`. Query domain Q is the physical board expanded by D. Certification covers R, constructed by outwardly expanding the already outward-rounded Q by D. Inverse candidates must remain inside the certified R. For every query in Q the ideal fixed-point map `q-u(x)` maps R into itself. A directed interval Jacobian bound L below one on all of R gives a unique inverse. Query source arrays are not changed.

The matrix bound is the spectral norm of its midpoint plus the Frobenius norm of its radii. Both terms use outward interval operations. Subdivision covers every box, and an unresolved box refuses. Scalar products such as A*f and A*f\*f are themselves enclosed products.

An inverse is accepted only when `||W(x)-q||/(1-L)` fits its budget, using the full enclosed residual. For a straight query subsegment of length d, inverse curvature is bounded by `K^3 H`, where `K=1/(1-L)` and H bounds the vector Hessian in Frobenius norm. The chord error is therefore `K^3 H d^2/8`, plus endpoint/inverse/conversion bounds. No midpoint sagitta is used as a certificate. No simplification is applied.

## Complete board clipping

Every complete query-space edge is intersected with the warp image of each of the four physical board sides. The signed line function and derivative are enclosed on every side interval. A side farther from the edge's query box than the certified per-axis displacement cannot meet the edge's segment and is skipped. A range excluding zero proves absence. A derivative excluding zero and opposite endpoint signs prove one root. Otherwise subdivision continues, including intervals with equal-sign endpoints. Ambiguous tangencies, coincident curves, corner roots and exhausted budgets refuse.

Every root bracket carries a world-side interval and a query-edge parameter interval. Root ordering must be proved. All intervals between consecutive roots are classified by an inverse midpoint only after completeness and root order are established. The implementation keeps every inside fragment, including disconnected physical ownership regions. A root is projected to the exact rational query edge and its world discrepancy is included in endpoint error.

## Embedding and closure

A bi-Lipschitz bound gives `distanceWorld >= distanceQuery/(1+L)`. Nonincident query subsegments must have separation larger than the sum of their world approximation errors after this factor. A conservative query-space corridor index omits only pairs whose expanded bounding boxes are disjoint. Unresolved pairs refine; exhausted separation budgets refuse.

At a shared junction, inverse-Jacobian intervals enclose all outgoing tangents. Determinant or opposite-cone tests preserve the exact query rays' cyclic order. Endpoint errors are included in the chord cones. On one query line, the inverse has strictly positive projection along that line when L<1. The emitted chains and disconnected fragments must preserve the same projection order.

Board roots retain their side coordinate and are ordered by disjoint side intervals. The outline is one separate closed path containing these shared boundary nodes and the corners. The cell network paths remain open. R12 ASCII DXF writes POLYLINE/VERTEX, Y up, zero Z, CUT_INNER and CUT_OUTER, with inch metadata. Final unit interpretation remains a native Aspire acceptance gate.

## Worker lifetime

`CellGraphController` owns a worker, deadline and abort listener per request ID. The default deadline is 120000 milliseconds; explicitly configured deadlines must be integers from 1 through 300000 milliseconds. A deadline bounds a silent worker independently of its internal geometry work cap.

Construction, deadline scheduling or postMessage failure; worker error; response deserialization error; abort; supersession; stale source; message or graph revision mismatch; malformed response; timeout; explicit cancel; proof refusal; and success all settle through the same identity-guarded terminal path. That path cancels the deadline, removes the abort listener, detaches every worker handler and terminates the worker before resolving. Cleanup actions are attempted independently so one cleanup exception cannot leave the Promise pending.

Saved callbacks carry the original request ID. Replaying a retired timer, response, error, messageerror or abort cannot retire a newer request. Tests cover those callbacks, cancellation during construction, synchronous deadline expiry, all terminal paths and a real silent-worker deadline with an owned watchdog that is cleared on both success and failure.
