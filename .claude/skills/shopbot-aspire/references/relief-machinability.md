# Modeling for the router: what a Mac-side model must satisfy

For anything modeled in Rhino, Grasshopper or Blender that will be carved. The Mac's job ends at a
handoff packet; toolpaths are made in Aspire at the shop laptop.

## What Aspire does to a mesh (Vectric V12 help, read 2026-11-10)

- It keeps one height per XY position. A fully 3D object becomes a relief.
- Anything under another part of the model is discarded and replaced by a vertical wall from the
  top-view silhouette down to the zero plane.
- The zero plane slider decides where the model is cut off; "Discard data below zero plane"
  decides whether a recess below the original zero survives.
- 3D finishing is a single pass that ignores pass depth, so the roughing allowance is the full
  depth the finishing bit takes.

## What to check before handoff

Run the gates in the `modeling-pipeline` skill (`mesh_gate.py`, `chirality.py`) and put their
output in the packet. They cover: closed or open, winding, bounds against the sidecar, undercut
area, relief depth against bit stick-out, stock height against Z travel, handedness and height
sign.

Carve depth limit (Nick, 2026-11-10): the carve must be reachable from above, within its top-view
silhouette, by the longest cutter the ATC holder accepts, about 2.6 in. Concave detail narrower
than the cutter is not a modeling concern: Aspire handles it in toolpathing, and carves are cut
with a ball nose or tapered ball nose.

They do not cover, so state these as open in the packet:

- Wall steepness against a tapered bit's angle.
- Grain direction and tearout. No skill in this workspace has verified guidance on either.
- The real Z clearance of Nick's machine. `machine-envelope.json` holds the manufacturer's 5.0 in
  travel, not a measurement.

## Units and files

- Send STL. Rhino 3DM import into Aspire is unverified (not on the V12 format list).
- STL has no units: the sidecar states them and the shop checks one known dimension after import.
- Tool database: it lives in Vectric's cloud and is used from Aspire. Every `.vtdb` and every other
  file under `Dropbox/ShopBot [DROPBOX]/` and `Dropbox/shopbot-dump/` is stale and inactive (Nick,
  2026-11-10). Do not read tooling values from them.
