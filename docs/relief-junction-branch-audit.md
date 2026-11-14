# Relief ownership and complete support

The cold reviews found three related defects: fixed-rank cell means changed at
outer membership ties; owner-specific clipped crown activation changed at true
junctions; residual third/fourth edge fields changed inside ordinary cells. A
separate all-site oracle disproved the nearest-four bisector approximation.

## Structural rule

Point ranks select the stable lower-ID owner and continuous F1/F3 order
statistics. Competitor ranks may seed a boundary upper bound; they do not define
final field membership or the final boundary minimum.

Static depth, slope budget, geometry radius, seam scale and shared strength are
normalized fields over every site inside `2.08 * max(F1, 1e-9)`. Their smooth
weights vanish at the support boundary. This rule applies throughout cells,
including ordinary owner edges and interior rank transitions. Distinct IDs at the
same position retain equal positive weights. The positive self weight prevents
an empty support or arbitrary-owner fallback.

Shared strength now interpolates per-site strengths. This intentionally replaces
independent per-edge strength hashes with a continuous site-supported field.
Ordered owner-to-site side hashes remain, averaged over the same complete support
including the owner itself. Their difference from shared strength is multiplied
by a boundary-vanishing owner fade. This retains asymmetric interior wall character
without allowing owner changes to alter nonzero boundary heights.

## Exact capped boundary distance

Both passes minimize all potentially constraining bisectors. In the actual
stretched/rotated Euclidean coordinates, triangle inequality gives
`bij = (Fj-F1)(Fj+F1)/(2 Dij) >= (Fj-F1)/2`. A seeded bound B excludes only
competitors beyond `F1+2B`, enlarged for floating-point rounding. The sparse bucket
query visits every remaining candidate. Plane evaluation uses relative transformed displacement and a normalized plane
normal, avoiding cancellation between separately rounded query radii. Search
seeds are inflated conservatively before the complete traversal recomputes final
minima. Positive separating distances are not replaced by a denominator floor. Identical positions have no separating plane;
only those planes are omitted, preserving IDs, pins, field weights and lower-ID
ownership. The existing panel-size cap remains the degenerate one-site fallback.
The independent oracle evaluates all transformed planes without this pruning rule.

## Consumer audit

| Consumer | Ownership and boundary rule |
|---|---|
| Pass-1 mean radius and unsampled-cell spacing fallback | Per-site estimates feed static depth; complete support blends them before composition. |
| Pass-1 maximum bisector radius and minimum 0.01 | Exact capped plane minimum supplies each estimate; complete field support supplies final geometric radius. |
| Depth tier and slope minimum/saturation | Precomputed per site, unchanged, then interpolated through complete support. |
| Side/shared strength and seam scale | No final fixed-rank neighbor fields remain. Ordered side residual vanishes at owner boundaries. |
| Crest clipping and wall minimum | Apply continuous min/max operations after shared inputs. Diagnostics inspect actual final clipped width, including true zero-width collapse. The physical wall-span floor remains. |
| Bowl zero clamp, floor saturation/fillet, profile and sharp seams | Continuous functions of exact boundary distance and shared geometry. The noninverted bowl tends to zero at every owner edge. |
| F3 junction proximity, width flare, dissolution and lift | F3 is a continuous order statistic even when its identity changes. Spatial fields and clamps do not use the discarded rank IDs. |
| Tilt direction, radius and clamp | Owner-dependent residual is multiplied by the boundary-vanishing fade. |
| Cushion size/coverage, site field and membrane normalization | Cushion pixels require bowl ratio above 1.25. Boundary ratio tends to zero, leaving a corridor without cushion contribution. Per-cell normalization remains interior-only. |
| Crown activation and minimum span | Global wall enable only. Crown amplitude grows smoothly from zero over the minimum physical span; the distance falloff reaches zero at its support boundary. Narrow-band amplitudes intentionally change. |
| Inversion, crest noise, stock cap, void gate and output clamp | Global controls or continuous scalar functions after composition. The nonfinite fallback is an exceptional numeric guard, not a continuity repair. |

TypeScript, canonical Python and the builder literal implement this rule. The
native geometry alternative retains its distinct sampler; its embedded index
helper matches canonical source without claiming web geometry parity.

## Validation

`cli/relief-support.spec.ts` covers the reported interior rank switch, ordinary
owner edges, anisometric all-site plane oracles, the seventh-ranked constraining
site, coincident and nearly coincident positions, and sparse read bounds.
`cli/relief-junction.spec.ts` preserves the prior triple, quad, domed, mixed-band,
outer-membership and crown-amplitude assertions and full-grid Python comparisons.
The mutation gate rejects owner-only fields, binary crown activation, fixed-rank
strength/side substitutions and incomplete bisector candidates. The side mutation
fails the rank-switch test; the strength mutation fails ordinary owner-edge tests.
An owned b60 archive reproduces the original rank-switch jump independently.

The previously approved basin-predicate separation is copied from 386821c without
changing its controls: strict basins require at least five, sharp dips remain at
most 1200, and flat, dense-sliver and smooth-bowl controls distinguish the meanings.
Strict basins test local topology; the 0.03-neighbor-mean deficit tests sharpness.
Crossing, coverage, slope and convergence assertions retain their thresholds.

Browser comparison images, full export gates and native acceptance are separate
receipts. Root owns independent visual review and native publication.
