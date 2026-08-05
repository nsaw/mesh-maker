#!/usr/bin/env bash
# Re-verifies factual claims made in this skill's grasshopper-*.md reference files
# against a Rhino installation's SHIPPED assemblies (not docs, not upstream source).
#
# Usage: ./verify-rhino-claims.sh [/Applications/Rhino 7.app]
#
# Why this exists: the reference files deliberately keep version numbers out of their
# prose so a Rhino upgrade does not require rewriting them. Instead, run this. Anything
# that FAILs is a claim whose behavior changed -- record it in that file's
# "Version deltas" table rather than silently editing the body.
#
# Requires: ikdasm + monodis (brew install mono)

set -uo pipefail

APP="${1:-/Applications/Rhino 7.app}"
RES="$APP/Contents/Frameworks/RhCore.framework/Versions/A/Resources"
GHD="$RES/ManagedPlugIns/GrasshopperPlugin.rhp"
RC="$RES/RhinoCommon.dll"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail=0

command -v ikdasm >/dev/null || { echo "FATAL: ikdasm not on PATH (brew install mono)"; exit 2; }
[ -f "$RC" ]   || { echo "FATAL: RhinoCommon.dll not found under $APP"; exit 2; }
[ -d "$GHD" ]  || { echo "FATAL: GrasshopperPlugin.rhp not found under $APP"; exit 2; }

echo "Rhino assemblies: $(monodis --assembly "$RC" 2>/dev/null | awk '/^Version:/{print $2}')"
echo

check() { # check <label> <0|1>
  if [ "$2" -eq 1 ]; then printf 'PASS  %s\n' "$1"
  else printf 'FAIL  %s\n' "$1"; fail=1; fi
}

# body <il-file> <MethodName> -- print a method's IL body.
# A plain awk range on "Name(object" matches the first CALL SITE, not the
# declaration, and then runs to the wrong "end of method". Call sites are
# indented under a `call` opcode, so filter those out to find the real decl.
body() {
  local il="$1" name="$2" s e
  s=$(grep -n "${name}(object" "$il" | grep -v '  call ' | head -1 | cut -d: -f1)
  [ -z "$s" ] && return 1
  e=$(awk -v s="$s" 'NR>s && /end of method/{print NR; exit}' "$il")
  [ -z "$e" ] && return 1
  sed -n "${s},${e}p" "$il"
}

# body_has <il-file> <MethodName> <substring> -- true if the method body contains it.
#
# Do NOT write `body ... | grep -q ...` here. `grep -q` exits on its first match,
# which SIGPIPEs the upstream sed, and `set -o pipefail` then reports the whole
# pipeline as failed even though the match succeeded. That produced a size-dependent
# race: short method bodies finished writing and passed, longer ones were killed
# mid-write and reported a spurious FAIL. Capture first, then match in-shell.
body_has() {
  local out
  out=$(body "$1" "$2") || return 1
  [[ "$out" == *"$3"* ]]
}

# bodyx <il-file> <MethodName> -- like body(), but matches a declaration with ANY
# signature (no args, or args that are not `object`). Declarations put the name
# either on the .method line or on its continuation line; call sites sit under a
# `call`/`callvirt` opcode, so those are filtered out.
bodyx() {
  local il="$1" name="$2" s e
  s=$(grep -n "${name}(" "$il" | grep -v 'call ' | grep -v 'ldftn' | head -1 | cut -d: -f1)
  [ -z "$s" ] && return 1
  e=$(awk -v s="$s" 'NR>s && /end of method/{print NR; exit}' "$il")
  [ -z "$e" ] && return 1
  sed -n "${s},${e}p" "$il"
}

# bodyx_has <il-file> <MethodName> <substring>
bodyx_has() {
  local out
  out=$(bodyx "$1" "$2") || return 1
  [[ "$out" == *"$3"* ]]
}

# anydecl_has <il-file> <MethodName> <substring> -- true if ANY declaration of that
# method name has a body containing the substring. Needed because a name can be
# declared several times (interface stub with no body, plus GH_Brep / GH_Surface /
# GH_SubD implementations); checking only the first gives a false negative.
anydecl_has() {
  local il="$1" name="$2" pat="$3" ln end
  for ln in $(grep -n "${name}(" "$il" | grep -v 'call ' | grep -v 'ldftn' | cut -d: -f1); do
    end=$(awk -v s="$ln" 'NR>s && /end of method/{print NR; exit}' "$il")
    [ -z "$end" ] && continue
    if sed -n "${ln},${end}p" "$il" | grep -q -- "$pat"; then return 0; fi
  done
  return 1
}

# body_has_any <il-file> <substring> <Method...> -- true if ANY named method contains it.
body_has_any() {
  local il="$1" pat="$2"; shift 2
  local m
  for m in "$@"; do body_has "$il" "$m" "$pat" && return 0; done
  return 1
}

# ---------------------------------------------------------------------------
# Component names  (grasshopper-canvas-patterns.md, grasshopper-data-matching.md)
# ---------------------------------------------------------------------------
for f in "$GHD/Grasshopper.dll" "$GHD"/Components/*.gha; do
  [ -f "$f" ] && ikdasm "$f" 2>/dev/null | grep -o 'ldstr *"[^"]*"'
done | sed 's/ldstr *"//; s/"$//' | sort -u > "$TMP/names.txt"

while IFS= read -r n; do
  [ -z "$n" ] && continue
  if grep -qxF "$n" "$TMP/names.txt"; then check "component name: $n" 1; else check "component name: $n" 0; fi
done <<'NAMES'
Plane Normal
Construct Plane
Cross Reference
Holistic
Stream Filter
Stream Gate
Cull Pattern
List Item
Repeat Data
Data Dam
Evaluate Surface
Flip Matrix
Path Mapper
Longest List
GhPython Script
NAMES

# ---------------------------------------------------------------------------
# RhinoCommon geometry  (grasshopper-geometry-orientation.md, SKILL.md)
# ---------------------------------------------------------------------------
ikdasm "$RC" 2>/dev/null > "$TMP/rc.il"

if awk '/Rhino\.Geometry\.Cone/,0' "$TMP/rc.il" \
     | grep -A8 'get_ApexPoint() cil managed' | grep -q 'Plane::get_Origin'; then
  check "RhinoCommon Cone.ApexPoint == plane.Origin" 1
else
  check "RhinoCommon Cone.ApexPoint == plane.Origin" 0
fi

grep -q 'Mesh::RebuildNormals' "$TMP/rc.il" \
  && check "Mesh.RebuildNormals present" 1 || check "Mesh.RebuildNormals present" 0

grep -q 'MeshVertexNormalList::ComputeNormals' "$TMP/rc.il" \
  && check "MeshVertexNormalList.ComputeNormals present" 1 \
  || check "MeshVertexNormalList.ComputeNormals present" 0

grep -q 'MeshFaceNormalList::ComputeFaceNormals' "$TMP/rc.il" \
  && check "MeshFaceNormalList.ComputeFaceNormals present" 1 \
  || check "MeshFaceNormalList.ComputeFaceNormals present" 0

if [ "$(grep -c 'CreateBooleanDifference(' "$TMP/rc.il")" -ge 4 ]; then
  check "Brep.CreateBooleanDifference has >=4 overloads" 1
else
  check "Brep.CreateBooleanDifference has >=4 overloads" 0
fi

# ---------------------------------------------------------------------------
# GH Cone COMPONENT: base lands on the input plane, not the apex.
# The component translates the plane by ZAxis*height then flips it before
# constructing the Cone -- which inverts the RhinoCommon struct's apex-at-origin.
# ---------------------------------------------------------------------------
if [ -f "$GHD/Components/SurfaceComponents.gha" ]; then
  ikdasm "$GHD/Components/SurfaceComponents.gha" 2>/dev/null > "$TMP/surf.il"
  if grep -q 'Rhino\.Geometry\.Cone::\.ctor' "$TMP/surf.il" && grep -q 'Plane::Flip' "$TMP/surf.il"; then
    check "GH Cone translates+flips plane (base at input plane origin)" 1
  else
    check "GH Cone translates+flips plane (base at input plane origin)" 0
  fi
else
  check "SurfaceComponents.gha present" 0
fi

# ---------------------------------------------------------------------------
# GH_Convert numeric semantics  (grasshopper-type-system.md)
# Number -> Integer ROUNDS AwayFromZero. It does NOT truncate.
# ldc.i4.0 = MidpointRounding.ToEven, ldc.i4.1 = MidpointRounding.AwayFromZero
# ---------------------------------------------------------------------------
ikdasm "$GHD/Grasshopper.dll" 2>/dev/null > "$TMP/ghmain.il"

if awk '/ToInt32_Secondary\(object/,/end of method/' "$TMP/ghmain.il" \
     | grep -B3 'Math::Round' | grep -q 'ldc\.i4\.1'; then
  check "Number->Integer rounds AwayFromZero (not truncate)" 1
else
  check "Number->Integer rounds AwayFromZero (not truncate)" 0
fi

# --- Conversion ASYMMETRIES ---------------------------------------------
# The conversion graph is directional. Widely-circulated guidance shows these
# as bidirectional ("Point <-> Vector", "Mesh <-> Brep"); they are not.
# NOTE: the real logic lives in the To<Type>_{Primary,Secondary} family.
# The ToGH<Type>_* family delegates into it, so checking only ToGH* gives a
# false negative. Follow the call graph, not just inline type constants.

M="$TMP/ghmain.il"

# Brep -> Mesh works; Mesh -> Brep does not.
body_has "$M" ToMesh_Secondary 't_rc_brep' \
  && check "Brep DOES convert to Mesh" 1 || check "Brep DOES convert to Mesh" 0
body_has_any "$M" 't_rc_mesh' ToBrep_Primary ToBrep_Secondary \
  && check "Mesh does NOT convert to Brep" 0 || check "Mesh does NOT convert to Brep" 1

# Point -> Vector works; Vector -> Point does not.
body_has "$M" ToVector3d_Secondary 't_rc_point3d' \
  && check "Point DOES convert to Vector" 1 || check "Point DOES convert to Vector" 0
body_has_any "$M" 't_rc_vector3d' ToPoint3d_Primary ToPoint3d_Secondary \
  && check "Vector does NOT convert to Point" 0 || check "Vector does NOT convert to Point" 1

# Brep -> Surface is gated on face count.
body_has "$M" ToGHSurface_Primary 'Brep::get_Faces' \
  && check "Brep->Surface checks Faces.Count (single-face only)" 1 \
  || check "Brep->Surface checks Faces.Count (single-face only)" 0

# Line/Circle/Arc reach Curve through ToCurve_Secondary, not through Goo CastTo.
body_has "$M" ToCurve_Secondary 't_rc_line' \
  && check "Line/Circle/Arc DO convert to Curve" 1 \
  || check "Line/Circle/Arc DO convert to Curve" 0

# Curve -> Line/Circle works, but only by round-tripping through ToCurve.
body_has "$M" ToLine_Secondary 'GH_Convert::ToCurve' \
  && check "Curve DOES convert back to Line (via ToCurve)" 1 \
  || check "Curve DOES convert back to Line (via ToCurve)" 0

# Integer -> Number works, but only via delegation (no inline type constant).
body_has "$M" ToDouble_Secondary 'ToInt32_Primary' \
  && check "Integer DOES convert to Number (via ToInt32_Primary)" 1 \
  || check "Integer DOES convert to Number (via ToInt32_Primary)" 0

# Numbers do not become Points, and Curves do not become Surfaces.
body_has_any "$M" 't_double' ToPoint3d_Primary ToPoint3d_Secondary \
  && check "Number does NOT convert to Point" 0 || check "Number does NOT convert to Point" 1
body_has_any "$M" 't_rc_curve' ToSurface_Primary ToSurface_Secondary \
  && check "Curve does NOT convert to Surface" 0 || check "Curve does NOT convert to Surface" 1

# ---------------------------------------------------------------------------
# Grasshopper preview meshing  (grasshopper-canvas-patterns.md)
# GH keeps preview-mesh settings on the .gh document, NOT the .3dm, and the
# Custom Preview component bypasses them entirely.
# ---------------------------------------------------------------------------
for v in None LowQuality HighQuality Document Custom; do
  grep -q "GH_PreviewMesh $v = int32" "$M" \
    && check "GH_PreviewMesh.$v exists" 1 || check "GH_PreviewMesh.$v exists" 0
done

grep -q 'GH_Document::get_PreviewMeshType' "$M" \
  && check "GH_Document.PreviewMeshType present" 1 || check "GH_Document.PreviewMeshType present" 0
grep -q 'GH_Document::DestroyPreviewMeshes' "$M" \
  && check "GH_Document.DestroyPreviewMeshes present (cache drop)" 1 \
  || check "GH_Document.DestroyPreviewMeshes present (cache drop)" 0

# Document mode really does defer to the Rhino doc.
anydecl_has "$M" PreviewCurrentMeshParameters 'MeshingParameters::DocumentCurrentSetting' \
  && check "PreviewMeshType=Document defers to the Rhino doc" 1 \
  || check "PreviewMeshType=Document defers to the Rhino doc" 0

# The preview mesh is cached and the builder early-returns on it.
anydecl_has "$M" CreatePreviewMeshes 'm_mesh' \
  && check "GH_Brep preview mesh is cached in m_mesh" 1 \
  || check "GH_Brep preview mesh is cached in m_mesh" 0

# GetPreviewMeshes() -- the path Custom Preview uses -- hardcodes the coarse default.
# AppendRenderGeometry is the IGH_RenderAwareData path that Custom Preview implements.
# It hardcodes MeshingParameters.Default when no mesh is cached -- no document setting
# applies. (GetPreviewMeshes() merely returns the cached m_mesh and takes no parameters.)
anydecl_has "$M" AppendRenderGeometry 'MeshingParameters::get_Default' \
  && check "AppendRenderGeometry hardcodes MeshingParameters.Default" 1 \
  || check "AppendRenderGeometry hardcodes MeshingParameters.Default" 0

anydecl_has "$M" GetPreviewMeshes 'm_mesh' \
  && check "GetPreviewMeshes only returns the cached m_mesh" 1 \
  || check "GetPreviewMeshes only returns the cached m_mesh" 0

# No application-level default: the GH_Document ctor hardcodes LowQuality (ldc.i4.1)
# and never reads the settings server.
anydecl_has "$M" DocumentAdded 'GH_DocumentServer' \
  && check "GH_DocumentServer.DocumentAdded hook exists (session-wide workaround)" 1 \
  || check "GH_DocumentServer.DocumentAdded hook exists (session-wide workaround)" 0

# ---------------------------------------------------------------------------
# GhPython write path  (grasshopper-canvas-patterns.md + the Rhino 7 MCP spike)
# ---------------------------------------------------------------------------
GHP="$GHD/Components/GhPython.gha"
if [ -f "$GHP" ]; then
  ikdasm "$GHP" 2>/dev/null > "$TMP/gh.il"

  if grep -B1 'set_Code(string' "$TMP/gh.il" | grep -q '\.method public'; then
    check "GhPython Code setter is public" 1
  else
    check "GhPython Code setter is public" 0
  fi

  if awk '/set_Code\(string/,/end of method/' "$TMP/gh.il" | grep -q 'm_compiled_py'; then
    check "GhPython Code setter clears compiled cache (forces recompile)" 1
  else
    check "GhPython Code setter clears compiled cache (forces recompile)" 0
  fi

  grep -qi '410755B1' "$TMP/gh.il" \
    && check "GhPython ComponentGuid 410755B1-224A-4C1E-A407-BF32FB45EA7E" 1 \
    || check "GhPython ComponentGuid 410755B1-224A-4C1E-A407-BF32FB45EA7E" 0

  grep -q 'ldstr *"out"' "$TMP/gh.il" \
    && check "GhPython 'out' report param present" 1 \
    || check "GhPython 'out' report param present" 0
else
  check "GhPython.gha present (IronPython script component shipped)" 0
fi

echo
if [ $fail -eq 0 ]; then
  echo "All machine-checkable claims PASS."
else
  echo "FAILURES above. Each one is a claim whose behavior changed in this Rhino version."
  echo "Record it in the affected reference file's 'Version deltas' table."
  echo "If a check fails but the underlying fact still holds, fix the grep -- not the claim."
fi
exit $fail
