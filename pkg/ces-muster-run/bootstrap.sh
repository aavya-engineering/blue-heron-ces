#!/usr/bin/env bash
# MX bootstrap (Blue Heron Defense, CES team) for Git Bash, Linux and macOS.
#   bash bootstrap.sh --root <dir> [--origin <url-or-dir>] [--scenario muster-partial] [--skip-e2e]
# --origin: a git URL prefix or a local directory holding <repo>.git bare mirrors (default: pins.json org).
# Same steps as bootstrap.ps1 up to and including the unit gate: clone at the pins (nested
# layout), overlay + patches, npm ci, builds, unit gate. The end-to-end run needs Windows
# PowerShell 5.1 (Stamper and the sim's PowerShell modules), so this script stops there.
# Never calls ces-mono's own scripts/bootstrap.sh. Logs: <root>/out/bootstrap/*.log
set -euo pipefail
ROOT=""; ORIGIN=""; SCENARIO="muster-partial"
while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --origin) ORIGIN="$2"; shift 2 ;;
    --scenario) SCENARIO="$2"; shift 2 ;;
    --skip-e2e) shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$ROOT" ] || { echo "usage: bash bootstrap.sh --root <dir>" >&2; exit 2; }
PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$ROOT"; ROOT="$(cd "$ROOT" && pwd)"
CES="$ROOT/ces"; BLOG="$ROOT/out/bootstrap"; mkdir -p "$BLOG"
GIT=(git -c core.longpaths=true -c core.autocrlf=false)

say() { echo "==> $*"; }
run() { # run <name> <cwd> <cmd...>
  local name="$1" cwd="$2"; shift 2
  if (cd "$cwd" && "$@") >"$BLOG/$name.log" 2>&1; then echo "OK   $name"
  else echo "FAIL $name; last lines of $BLOG/$name.log:"; tail -n 15 "$BLOG/$name.log" | sed 's/^/     /'; exit 1; fi
}
pin() { node -e "const p=require(process.argv[1]);const r=p.repos.find(x=>x.repo===process.argv[2]);console.log(r.dir+' '+r.sha+' '+(r.branch||'main'))" "$PKG/pins.json" "$1"; }
patches() { node -e "const p=require(process.argv[1]);console.log((p.patches||[]).map(x=>x.file).join(' '))" "$PKG/pins.json"; }
[ -n "$ORIGIN" ] || ORIGIN="$(node -e "console.log(require(process.argv[1]).org)" "$PKG/pins.json")"
if [ -d "$ORIGIN" ]; then ORIGIN="$(cd "$ORIGIN" && pwd)"; else ORIGIN="${ORIGIN%/}"; fi

# 1. Prerequisites
say prerequisites
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { echo "Node 20 or later is required" >&2; exit 1; }
git --version >/dev/null
echo "     node $(node -v), $(git --version)"
echo "     origin $ORIGIN"

# 2. Clone at the pins
for repo in ces-mono ces-tenant ces-muster ces-tester ces-stacksim; do
  read -r dir sha branch <<<"$(pin "$repo")"
  target="$CES"; [ "$dir" = "." ] || target="$CES/$dir"
  if [ ! -d "$target/.git" ]; then say "clone $repo"; run "clone-$repo" "$ROOT" "${GIT[@]}" clone -q "$ORIGIN/$repo.git" "$target"; fi
  git -C "$target" config core.longpaths true; git -C "$target" config core.autocrlf false
  run "checkout-$repo" "$ROOT" "${GIT[@]}" -C "$target" checkout -q -B "$branch" "$sha"
  head="$(git -C "$target" rev-parse HEAD)"
  [ "$head" = "$sha" ] || { echo "$repo: HEAD $head is not the pin $sha" >&2; exit 1; }
  echo "     $repo @ ${head:0:7}"
done

# 3. Overlay and patches
say "overlay and patches"
# v2: BHD's changes are commits at the pins; overlay/ and patches/ are optional and normally absent.
if [ -d "$PKG/overlay" ]; then
  (cd "$PKG/overlay" && find . -type f) | while read -r f; do
    mkdir -p "$CES/$(dirname "$f")"; cp -f "$PKG/overlay/$f" "$CES/$f"; echo "     overlay: ${f#./}"
  done
fi
PATCHES="$(patches)"
[ -n "$PATCHES" ] || [ -d "$PKG/overlay" ] || echo "     none: v2 ships BHD changes as commits at the pins"
for pf in $PATCHES; do
  p="$(basename "$pf" .diff)"; patch="$PKG/$pf"
  if git -C "$CES/ces-muster" apply --reverse --check "$patch" 2>/dev/null; then echo "     $p.diff: already applied"; continue; fi
  run "apply-check-$p" "$CES/ces-muster" git apply --check "$patch"
  run "apply-$p" "$CES/ces-muster" git apply "$patch"
done

# 4. Install and build
say "install and build"
run ci-ces-tenant "$CES/ces-tenant" npm ci --no-audit --no-fund
run build-ces-tenant "$CES/ces-tenant" npm run build
run ci-ces-mono "$CES" npm ci --no-audit --no-fund
run build-core "$CES" npm run build:core
run ci-tenant-stacksim "$CES/tenant-stacksim" npm ci --no-audit --no-fund
run build-tenant-stacksim "$CES/tenant-stacksim" npm run build
run ci-ces-tester "$CES/ces-tester" npm ci --no-audit --no-fund
run build-ces-tester "$CES/ces-tester" npm run build
run ci-ces-muster "$CES/ces-muster" npm ci --no-audit --no-fund
run ci-muster-api "$CES/ces-muster/muster-api" npm ci --no-audit --no-fund
run build-muster-api "$CES/ces-muster/muster-api" npm run build
run build-muster-spa "$CES/ces-muster" npm run build

# 5. Unit gate
say "unit gate (scripts/run-tests.sh)"
GATE=0
bash "$PKG/scripts/run-tests.sh" "$ROOT" || GATE=$?
[ "$GATE" -eq 0 ] && echo "OK   unit gate" || echo "FAIL unit gate: see $ROOT/out/unit-gate.json"

# 6. End to end: Windows only
echo "E2E requires Windows PowerShell 5.1 (Stamper/sim modules); run bootstrap.ps1"
exit "$GATE"
