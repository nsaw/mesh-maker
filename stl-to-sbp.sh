#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec npx tsx "$DIR/cli/stl-to-sbp.ts" "$@"
