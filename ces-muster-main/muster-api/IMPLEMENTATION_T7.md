# Implementation Log — T7: mu CLI
**Date:** 2026-07-07
**Branch:** g-muster-p1
**Scope:** muster-api/src/cli/ + muster-api/tests/cli.test.ts + muster-api/CLI.md + muster-api/package.json

## Files Created / Modified

| File | Change |
|---|---|
| `muster-api/src/cli/mu.ts` | NEW — core CLI module; exports `runMu`, `makeMemoryCredStore`, `makeFileCredStore`, `StoredCred`, `CredStore`, `MuDeps` |
| `muster-api/src/cli/bin.ts` | NEW — thin bin wrapper; calls `runMu(process.argv.slice(2))` and `process.exit(code)` |
| `muster-api/tests/cli.test.ts` | NEW — 30 tests (25 unit + 5 integration) |
| `muster-api/CLI.md` | NEW — one-page install/auth/command reference with exit codes |
| `muster-api/package.json` | MODIFIED — added `"bin": {"mu": "dist/cli/bin.js"}` and `"mu": "tsx src/cli/bin.ts"` script |

## Command count

34 commands implemented (login, logout, whoami, engagements×4, parties×3, contracts×5, sessions×2, hil×3, interview×2, coach×1, harvest×2, sprs×1, nudges×2, reassessment×2, recipes×2, touch×2).

## Test counts

- **Pre-existing:** 220 tests across 19 files (1 skipped — RLS live-DB guard)
- **New cli.test.ts:** 30 tests (25 unit + 5 integration)
- **Total:** 250 tests passed, 1 skipped

Unit tests cover (≥12 commands as specified):
help/usage, unknown-command→exit-2, login (method+path+body+credStore write), whoami (Bearer header), engagements list/create/get/progress, parties list/action (notes body), contracts create (--file), hil queue/resolve (--minutes), sprs score (--file), nudges tick/digest (--now + --engagement), recipes ingest (x-concierge-session header), sessions sync, touch report (query param), reassessment drift-check, degraded-503→exit-3, --pretty indented output, logout (credStore delete), unknown-sub→exit-2.

Integration tests (real express on port 0, mockDb, in-memory credStore):
- login (bcrypt hash verify → token stored)
- engagements create → verify 201 body
- engagements list → verify created engagement appears
- sprs score with fixture → verify numeric `sprs` field
- nudges tick --now → verify `{fired: []}` shape

## Deviations from spec

1. **`npm run mu` invocation:** Plan says `"mu": "tsx src/cli/bin.ts"` (works without building). Implemented exactly. The `--` separator for npm run pass-through is: `npm run mu -- engagements list`.

2. **`@-` stdin on Windows:** Used an async `for await` loop on `process.stdin` (not `/dev/stdin` which doesn't exist on Windows). Tests bypass stdin by using actual temp files via `tmpdir()` + `writeFileSync`.

3. **`makeMemoryCredStore` exported:** The spec lists `credStore?` in deps but doesn't name the factory. Exported `makeMemoryCredStore` from mu.ts so tests can import it without re-implementing. The file-based store remains the default when no credStore dep is injected.

4. **`auth.ts` not injectable for integration test:** The production auth router imports `db` from `../lib/prisma.js` directly (not through DI). The integration test creates an inline auth router using mockDb + bcrypt + mintToken — identical logic, no Prisma import. Consistent with how `rbac.matrix.test.ts` handles the same constraint.

5. **`hil flag` route requires `role: sub`:** The `POST /api/hil/flag` route is guarded by `requireRole('sub')`. The unit test for `hil flag` uses a bhd_operator token (injected via MU_TOKEN env), so the mock-fetch test passes regardless of role — only the integration path would exercise the real guard. The integration test suite covers login/engagements/sprs/nudges; hil flag integration is left to the existing `hil.threshold.test.ts`.

## Test run

```
npx tsc --noEmit  → 0 errors
npm test          → 250 passed | 1 skipped (pre-existing RLS skip)
```

## Open Items

- ESLint was not available to run (`eslint` not installed in this package — the task references `npx eslint src --ext ts --max-warnings 0` but the package has no eslint devDependency). No lint errors expected given strict TypeScript clean pass.
- `npm link` / global install of the `mu` binary requires a `dist/` build (`npm run build`). The `npm run mu --` script works without building.
