# Represented-input relief ownership

Nearest ranks use the squared effective metric of the represented binary64 query, site and frame inputs. The scale <= 1.0001 gate remains isotropic. A true exact tie retains the lower ordered site index, which is the producer's stable-ID order. Distinct near-coincident positions are not treated as ties and are never perturbed or merged.

The ordinary path compares the existing radial or squared values with an absolute error guard. C bounds query and indexed site coordinates, including moved sites. The effective transform factor is `max(1,|cos|+|sin|)*max(1,scale)` outside the isotropic gate. The radial guard is `256*EPSILON*C*factor`, with C at least one. For squared comparisons the guard is `E*(2*max(1,dA,dB)+E)`. Since max(1,dSquared) bounds its square root, this also covers squared evaluation without an extra root per comparison. An overflowing guard sends comparisons to exact arithmetic.

The loose constants exceed the subtraction, rotation, scale and radial evaluation operation counts. For one transformed coordinate, input subtraction contributes at most 2uC, rotation contributes fewer than 8uC times the frame factor and scaling fewer than 12uC times that factor. Combining both radial evaluations and their final comparison stays below the 512u guard. The absolute floor also sends subnormal/underflow cases to the exact path. The squared guard covers both radial perturbations and squared rounding. Error overlap invokes a comparison, never an assumed tie.

The fallback evaluates the exact sign of

`distanceSquared(q,a)-distanceSquared(q,b) = T(b-a) dot T(2q-a-b)`.

TypeScript decodes the IEEE mantissa and exponent to BigInt dyadics. Python uses math.frexp and math.ldexp to recover the exact integral mantissa, followed by integer shifts and products compatible with Python 2.7. No separately rounded coordinate difference, radius or transform enters this polynomial. Only a zero polynomial is a tie. Coincident positions return zero directly.

The indexed TypeScript nearestFour/nearestOwner paths, full-population sampler ordering and Lloyd reference path use this comparison. The bucket stopping margin includes the ordering error so an ambiguous unvisited competitor is not excluded. Canonical Python nearest-three and the shared Python Lloyd index mirror the comparison. The builder literal and standalone native shared helper remain identical. The standalone native pixel rank loop also uses the predicate. Its four unfilled squared-distance slots use infinity; cleanup and the third-radius consumer test absence with isinf, so finite supported values above1e30 remain valid ranks. The regression executes initialization, insertion, cleanup and d1/d3 consumption at ordinary and extreme supported coordinates, including truly absent slots; its distinct legacy boundary construction is not claimed to have web geometry parity.

Returned F values remain the production radial/squared values associated with the selected IDs. In a last-bit reversal they can differ from mathematical rank order by their evaluation error. They are not independently re-sorted, since that would attach another site's radius to the owner.

`npm run test:relief-near-ties` compares all four ranks against a separate 400-digit Decimal quadratic-distance oracle, including opposing near-coincident half-planes, off-axis gaps, large origins, the anisotropy gate, coincident IDs, exact ties and subnormals. It executes the canonical Python and actual native nearest loop. Observable coordinate reads verify that ordinary ordering does not enter the dyadic path and bucket queries do not become full scans. `npm run test:relief-near-ties-mutants` rejects both rounded-distance and blanket lower-ID substitutions. Existing strict sampling performance and native acceptance remain separate gates.

## Finite-distance sentinel census

The complete native file was read and searched before this correction with `rg -n '1\.0e(30|15)|distance_limit|nearest\(|best[0-9_]*\s*=|inradius|isinf' grasshopper/components/voronoi_relief_native.py`. The c1cfdbe census and resulting contracts are:

| Site | Decision |
|---|---|
| Native Lloyd caller at former line583 | Remove its arbitrary1e30 squared cutoff. Every actual Halton sample requires a real nearest owner. |
| Inradius initializer/acceptance at former lines667/674 | Initialize with infinity and accept every finite nearest-neighbor radius, distinguishing absence with isinf. |
| Inradius default cell_size/2 | Preserve this physical estimate only when no other site exists. A coincident neighbor is present and yields zero. |
| Pixel best1 through best4 and cleanup | Keep the infinity/isinf correction. Finite supported distances are never unfilled slots. |
| Missing third radius at former line749 | Keep infinity through d3 consumption; explicitly set junction proximity to zero when no third site exists. Do not invent a finite distant third site. |
| Shared nearest distance_limit parameter | Preserve the deliberate bounded-query API; native Lloyd does not opt into it. |
| db_cap = mesh_x + mesh_y | Preserve the finite physical board-distance cap for unbounded/absent planes. |
| MAX_COORDINATE and work limits | Preserve numeric safety and bounded-work contracts. Feature floors remain physical parameters rather than missing-neighbor sentinels. |

`npm run test:native-distance-consumers` executes actual native Lloyd definitions, records every assignment and checks both assignments and resulting centroids against Fraction distances. Ordinary, large finite, singleton, coincident and empty inputs are covered. It also executes actual inradius and size-modifier consumers with absent, coincident, ordinary and far finite neighbors. The mutation gate rejects reintroduced Lloyd limits and both inradius sentinel siblings. No finite1e30 or1e15 distance placeholder remains in the native production source. The historical full-scan regression fixture remains an explicitly old reference, not a production caller.

The optional Python nearest distance limit retains strict Float candidate admission. Every candidate must satisfy `d < distance_limit` before exact ranking; an empty eligible set retains the legacy default index0. This policy is distinct from unbounded exact ownership, and native Lloyd always requests the latter. Mandatory rank tests now use an independent common-integer-grid expanded-distance oracle, cross-checked against the separate Decimal oracle. The old native full-scan fixture remains immutable and is explicitly tested as a phantom-owner negative control rather than the corrected large-coordinate contract.
