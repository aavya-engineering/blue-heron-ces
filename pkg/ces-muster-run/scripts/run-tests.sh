#!/usr/bin/env bash
# MX unit gate (Blue Heron Defense, CES team). Bash wrapper for run-tests.mjs (Git Bash, Linux, macOS).
#   bash run-tests.sh <WS>
# Passes (exit 0) when every failing test is listed in ../known-failures.json. Writes <WS>/out/unit-gate.json.
# Off Windows the live-sim suites skip themselves (they need powershell.exe).
set -euo pipefail
ROOT="$(cd "${1:?usage: run-tests.sh <WS>}" && pwd)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$HERE/run-tests.mjs" --ces "$ROOT/ces" --out "$ROOT/out" --known "$HERE/../known-failures.json"
