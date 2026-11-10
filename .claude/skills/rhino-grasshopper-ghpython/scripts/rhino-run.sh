#!/usr/bin/env bash
# Launch Rhino 7, run one IronPython script, wait for the result file it writes.
#   rhino-run.sh script.py result.json [timeout_seconds]
# The script must write result.json itself and end with Rhino.RhinoApp.RunScript("_-Exit _No", False).
# Refuses when Rhino is already running: on 2026-11-10 a second instance launched beside Nick's
# open session opened no window and produced nothing in 200 s, and had to be killed.
set -uo pipefail
SCRIPT="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; OUT="$2"; T="${3:-180}"
if pgrep -f "MacOS/Rhinoceros" >/dev/null; then
  echo "REFUSED: Rhino is already running (pid $(pgrep -f 'MacOS/Rhinoceros' | tr '\n' ' ')). Ask Nick to close it, or use a route that needs no Rhino." >&2; exit 3
fi
rm -f "$OUT"
RHINO_PROBE_OUT="$OUT" "/Applications/Rhino 7.app/Contents/MacOS/Rhinoceros" -nosplash -runscript="-_RunPythonScript \"$SCRIPT\"" >/dev/null 2>&1 &
PID=$!
for _ in $(seq 1 $((T / 2))); do [ -s "$OUT" ] && break; sleep 2; done
if [ ! -s "$OUT" ]; then echo "TIMEOUT: no result after ${T}s. Killing the instance this script started (pid $PID)." >&2; kill "$PID" 2>/dev/null; exit 4; fi
for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$PID" 2>/dev/null || break; sleep 2; done
kill -0 "$PID" 2>/dev/null && echo "WARNING: Rhino (pid $PID) did not exit; the script may be missing its _-Exit line." >&2
cat "$OUT"
