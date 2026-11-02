# Implementation T6 — Tenant Keys via Stamper Constructs

**Date:** 2026-07-07
**Branch:** g-muster-p1

## Vendored Files

All vendored into `muster-api/src/vendored/ces-shared/` preserving relative structure.

| File | Source | Adaptation |
|------|--------|-----------|
| `config/secretRef.ts` | ces-shared verbatim | None |
| `config/TenantConfig.ts` | ces-shared verbatim | None |
| `stack/StackProvider.ts` | ces-shared verbatim | None |
| `stack/index.ts` | ces-shared verbatim | None |
| `stack/providers/microsoftGccHigh.ts` | ces-shared verbatim | None |
| `stack/providers/exampleStub.ts` | ces-shared verbatim | None |
| `stack/providers/googleWorkspaceCloud.ts` | ces-shared verbatim | None |
| `storage/contract.ts` | ces-shared adapted | (1) Removed DexieContract re-export — not needed; avoids circular vendor dep. (2) Added `// eslint-disable-next-line no-control-regex` for verbatim `\x00-\x1f` regex. |
| `storage/node.ts` | ces-shared verbatim | None — contract.ts stripping does not affect node.ts imports. |

**Not vendored:** `storage/DexieContract.ts` (not in dependency graph for getCesPipelineRoot), test files.

## New / Changed Files

| File | Status | Notes |
|------|--------|-------|
| `src/services/tenantKeysService.ts` | NEW | `TenantKeys`, `TenantKeysError`, `resolveTenantKeys()` |
| `src/services/consentService.ts` | MODIFIED | `buildConsentUrl` gains optional `loginBase` 5th param; `exchangeCode` gains optional `overrides: {tenantId?, clientId?, loginBase?}`. Both backward-compatible. |
| `src/routes/harvest.ts` | MODIFIED | GET /consent-url accepts `?tenant_slug=`; POST /callback accepts `tenant_slug` in body; POST /run accepts `tenant_slug` in body for graph base URL resolution. |
| `tests/tenantKeys.test.ts` | NEW | 9 tests covering all specified scenarios |
| `.env.example` | MODIFIED | Added CES_PIPELINE_ROOT, CES_STRICT_SECRETS; annotated GRAPH_* vars as no-slug fallback only |
| `vendor-manifest.json` (root) | MODIFIED | 9 new entries with real SHA-256 hashes |

## Test Counts

- Previous: 211 passed (1 skipped) across 18 test files
- After: **220 passed** (1 skipped) across **19 test files**
- New tenantKeys.test.ts: 9 tests
- All 10 existing harvest.test.ts tests green (no changes to their expectations)

## Deviations from Task Spec

1. **`process.cwd()` vs `getCesPipelineRoot()/Stamper`**: Step 3 says `resolveTenantJsonPath(slug, process.cwd())`. The test fixture places the file at `{CES_PIPELINE_ROOT}/Stamper/plan-data/<slug>/<slug>.json`, which is the ces-shared storage convention. Using `process.cwd()` would not find files there. Implementation uses `path.join(getCesPipelineRoot(), 'Stamper')` as the project root — consistent with the test fixture and with `getStamperPlanDataRoot()` in storage/node.ts. Logged as deviation.

2. **`storage/contract.ts` eslint-disable comment**: Minor lint adaptation added on top of the DexieContract strip (both counted as one adaptation in the header comment). The added comment keeps the regex verbatim from the source.

3. **POST /run graph base URL**: `endpoints.graph` from TenantKeys is the bare API root (e.g. `https://graph.microsoft.us`). `realGraphClient` expects a versioned root. Implementation appends `/v1.0`: `${keys.endpoints.graph}/v1.0`. Not explicitly specified in the task but required for correctness.

4. **Consent-url `?tenant_slug` with secretRef unresolved**: If ACME_THUMB is not set when consent-url is called with `tenant_slug=acme`, `loadTenantConfig` throws a `SecretRefError` (not a `TenantKeysError`). This propagates to `next(err)` → 500. The task does not specify this edge case; the fail-closed behavior of secretRef is preserved.

## Verification Results

- `npx tsc --noEmit` — clean (no output)
- `npm test` — 220 passed, 1 skipped, 0 failed (19 test files)
- `npx eslint src --ext ts --max-warnings 0` — clean (no output)
- `node scripts/check-vendor-drift.mjs` — 32 files OK, 0 DRIFT
