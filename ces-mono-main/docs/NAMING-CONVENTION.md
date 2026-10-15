# CES Naming Convention (G5)

**Status:** adopted (G5) · **Date:** 2026-06-13

A single, consistent naming convention across the CES monorepo.

## The convention

1. **Every module/workspace uses the `ces-*` prefix.** No `cse-*`, no product codenames
   (`stamper`, `shared`), no version suffixes (`-v2`), no scope (`@bhd-vfs/…`).
2. **Directory name == npm package `name`** (unscoped). One name per module, used identically for the
   folder, the package, and every import specifier.
3. **Import specifiers use the package name** (`ces-shared/...`, `ces-stamper/...`), resolved by npm
   workspaces — not deep relative paths into a sibling package, except in build/test config files
   (vite/jest) that must reference sibling source directly.
4. **Paths are relative from the repo root** — never absolute machine paths in code, config, or scripts.

## Module map (applied in G5)

| Old directory | Old package name | → ces-* name (dir + package) |
|---|---|---|
| `cse-ao` | `@bhd-vfs/admin-ops` | **`ces-ao`** |
| `cse-eo-recover` | `@bhd-vfs/evidence-ops` | **`ces-eo`** |
| `cse-fe-v2` | `cse-planner` | **`ces-planner`** |
| `stamper` | `@bhd-vfs/stamper` | **`ces-stamper`** |
| `shared` | `@bhd-vfs/shared` | **`ces-shared`** |
| `strategy` | (not a package) | **`ces-strategy`** |

Subpath exports keep their shape under the new name, e.g. `@bhd-vfs/shared/persistence/node` →
`ces-shared/persistence/node`; `@bhd-vfs/shared/stack` → `ces-shared/stack`.

## What was intentionally NOT renamed (not naming — would change behavior)

These are runtime data / identifiers, not module names, so renaming them would alter output and is
out of scope for this no-behavior-change goal:
- SQLite collection strings (`stamper_execution_state`, `adminops_evidence`, `eo_*`, …) — persisted keys.
- Evidence `executorIdentity` values (e.g. `cse-ao-service`) — recorded in evidence metadata.
- Internal per-package `src/shared/…` directories (each package keeps its own internal `shared`).
- Stack ids (`microsoft-gcc-high`, `example-stub`) and capability ids.
- Historical artifacts under `docs/context/*` (migration reports, logs) that record past paths.

## Verification
The rename is purely structural: the full test suite (1008 passing) and the G3 golden SSP test pass
**unchanged** after the rename — confirming zero behavior change.
