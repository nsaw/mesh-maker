#!/usr/bin/env bash
# Look up a RhinoCommon or Grasshopper member in the SHIPPED assembly before you write a call to it.
# This answers "does it exist, what are its overloads, what does it return" from the installed
# binary. It does not run Rhino and is safe to use while Rhino is open.
#
#   rhino-api.sh 'Mesh::GetOutlines'                      short type name is enough when unambiguous
#   rhino-api.sh 'Rhino.Geometry.Brep::CreatePatch' 'Interval::Contains'
#   rhino-api.sh --gh 'GH_Document::FilePath'             look in Grasshopper.dll instead
#   rhino-api.sh --doc 'Transform.Multiply'               print the XML doc summary (return shape, order, units)
#   rhino-api.sh --check scripts/verified-members.txt     assert every listed member exists (exit 1 if not)
#   rhino-api.sh --app "/Applications/Rhino 8.app" ...    a different install
#
# A missing member prints near misses ("did you mean"). Read them: GetOutline vs GetOutlines cost a
# session four failed approaches on 2026-11-05.
#
# Reflection proves existence and signature. It does not prove behavior. An `out` parameter shows as
# "ByRef"; IronPython returns those as extra tuple items instead of taking them as arguments.
#
# Requires mono (mcs + mono on PATH; `brew install mono`).
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"

APP="/Applications/Rhino 7.app"; MODE=lookup; TARGET=rc; ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --app)   APP="$2"; shift 2 ;;
    --gh)    TARGET=gh; shift ;;
    --doc)   MODE=doc; shift ;;
    --check) MODE=check; LIST="$2"; shift 2 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *)       ARGS+=("$1"); shift ;;
  esac
done

RES="$APP/Contents/Frameworks/RhCore.framework/Versions/A/Resources"
RC="$RES/RhinoCommon.dll"; GH="$RES/ManagedPlugIns/GrasshopperPlugin.rhp/Grasshopper.dll"
[ -f "$RC" ] || { echo "FATAL: RhinoCommon.dll not found under $APP" >&2; exit 2; }

if [ "$MODE" = doc ]; then
  XML="$RES/RhinoCommon.xml"; [ -f "$XML" ] || { echo "FATAL: RhinoCommon.xml not shipped with this install" >&2; exit 2; }
  for q in "${ARGS[@]}"; do
    grep -n -A14 "<member name=\"[MPTF]:[A-Za-z.]*${q}[(\"]" "$XML" | sed -e 's/^[0-9]*[:-] *//' -e 's/<[^>]*>//g' -e '/^$/d' | head -60
  done
  exit 0
fi

command -v mcs >/dev/null && command -v mono >/dev/null || { echo "FATAL: mono not on PATH (brew install mono)" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
CACHE="${TMPDIR:-/tmp}/rhino-api-$(shasum "$HERE/Refl.cs" | cut -c1-12)"
mkdir -p "$CACHE"
[ -f "$CACHE/Refl.exe" ] || mcs -nowarn:0618 -out:"$CACHE/Refl.exe" "$HERE/Refl.cs" || { echo "FATAL: Refl.cs did not compile" >&2; exit 2; }

DLL="$RC"; [ "$TARGET" = gh ] && DLL="$GH"

if [ "$MODE" = check ]; then
  fail=0; rcq=(); ghq=()
  while IFS= read -r line; do
    line="${line%%#*}"; line="$(echo "$line" | xargs)"; [ -z "$line" ] && continue
    case "$line" in gh:*) ghq+=("${line#gh:}") ;; *) rcq+=("$line") ;; esac
  done < "$LIST"
  # Capture first, then match. `mono | grep && fail=1` under pipefail reports mono's own non-zero
  # exit and skips the assignment, which made a failing list pass (caught by a mutant list).
  out=""
  if [ ${#rcq[@]} -gt 0 ]; then out+="$(mono "$CACHE/Refl.exe" "$RC" "${rcq[@]}" 2>&1)"$'\n'; fi
  if [ ${#ghq[@]} -gt 0 ]; then out+="$(mono "$CACHE/Refl.exe" "$GH" "${ghq[@]}" 2>&1)"$'\n'; fi
  bad="$(printf '%s' "$out" | grep -E "MISSING|FAILED|Exception" || true)"
  if [ -n "$bad" ]; then printf '%s\n' "$bad"; fail=1; fi
  n=$(( ${#rcq[@]} + ${#ghq[@]} ))
  [ $fail -eq 0 ] && echo "All $n listed members exist in $(basename "$APP")." || echo "FAILURES above: a reference names something this install does not have."
  exit $fail
fi

mono "$CACHE/Refl.exe" "$DLL" "${ARGS[@]}"
