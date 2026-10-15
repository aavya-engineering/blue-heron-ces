#!/bin/sh
# SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
# SPDX-License-Identifier: LicenseRef-BHD-Proprietary
# CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
# Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
# Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
# Submitting a change to this repository means you accept TERMS.md.
# Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
# See LICENSE and TERMS.md.

# Clone the five CES repositories into the required layout, install, build and test.
# Usage: sh scripts/bootstrap.sh [root-dir]   (default: ./ces)
set -u
ROOT="${1:-./ces}"
ORG="https://github.com/blue-heron-defense-CES"

clone() { # repo dir
  if [ -d "$2/.git" ]; then echo "exists: $2"; else git clone "$ORG/$1.git" "$2" || exit 1; fi
}

clone ces-mono "$ROOT"
clone ces-tenant "$ROOT/ces-tenant"
clone ces-muster "$ROOT/ces-muster"
clone ces-tester "$ROOT/ces-tester"
clone ces-stacksim "$ROOT/tenant-stacksim"

cd "$ROOT" || exit 1
ROOT_ABS="$(pwd)"

step() { # label dir command...
  label="$1"; dir="$2"; shift 2
  echo "==> $label"
  if (cd "$ROOT_ABS/$dir" && "$@"); then echo "OK   $label"; else echo "FAIL $label"; FAILED="$FAILED $label"; fi
}
FAILED=""

step "install ces-tenant" ces-tenant npm install
step "build ces-tenant" ces-tenant npm run build
step "install ces-mono" . npm install
step "build ces-shared" . npm run build:shared
step "build ces-stamper" . npm run build:stamper
step "install tenant-stacksim" tenant-stacksim npm install
step "install ces-tester" ces-tester npm install
step "install ces-muster" ces-muster npm install
step "install muster-api" ces-muster/muster-api npm install

step "test ces-tenant" ces-tenant npm test
step "test ces-shared" . npm run test:shared
step "test ces-stamper" . npm run test:stamper
step "test ces-eo" . npm run test:eo
step "test ces-ao" . npm run test:ao
step "test ces-ec" . npm run test:ec
step "test ces-planner" ces-planner npx vitest run
step "test tenant-stacksim" tenant-stacksim npm test
step "test ces-tester" ces-tester npm test
step "test ces-muster" ces-muster npm test
step "test muster-api" ces-muster/muster-api npm test

if [ -n "$FAILED" ]; then echo "Failed steps:$FAILED"; exit 1; fi
echo "All steps passed."
