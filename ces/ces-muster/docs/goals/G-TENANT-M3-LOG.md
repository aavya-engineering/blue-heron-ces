# G-TENANT-M3 — Implementation Log

Companion log for `G-TENANT-M3.md` (the goal file is left byte-identical to its ratified
form; this file is the goal's implementation log). Cutover executed 2026-07-11.

**Preconditions confirmed closed before starting:** ces-tenant M1 implemented (ces-tenant
repo commits `6ecd5f4` implementation, `f9d75b4` ratified 2026-07-10 amendment),
ces-stamper M1 cutover shipped (shared ces repo commit `ccebc1f`). ces-tenant was built
fresh (`npm run build`) and its own suite was green (75/75) before wiring.

## What changed

- `muster-api/package.json` — added `"ces-tenant": "file:../../ces-tenant"` (the same
  workspace-adjacent `file:` pattern ces-stamper's M1 cutover used; muster-api sits one
  directory deeper). `muster-api/package-lock.json` updated by `npm install`.
- `muster-api/src/services/tenantKeysService.ts` — rewritten as a thin wrapper over the
  ces-tenant package's `TenantHttpKeyProvider` surface (`PlanDataTenantHttpKeyProvider`,
  design §2.4 point 2). All vendored-`ces-shared` imports (`loadTenantConfig`,
  `resolveTenantJsonPath`, `getActiveStackProvider`, `getCesPipelineRoot`) are removed
  from the service; no plan-data path construction remains anywhere in non-vendored
  muster-api source. The public contract is unchanged:
  `resolveTenantKeys(slug: string | undefined): TenantKeys`, `TenantKeys`, and
  `TenantKeysError` are re-exported from ces-tenant, so the harvest routes
  (`src/routes/harvest.ts`) needed zero changes and `instanceof TenantKeysError` still
  holds (single class identity). The provider is constructed per call so per-request env
  changes (`CES_PIPELINE_ROOT`, `GRAPH_*`) keep their pre-M3 semantics.
- Consumer identity per the ratified 2026-07-10 amendment, bound at surface construction:
  `{ module: 'ces-muster', purpose: 'resolve tenant Graph/auth keys (harvest + consent flows)' }`.
- Cert-assertion token minting remains OUT of muster-api (must-NOT honored; the code
  comment stating that boundary is preserved in the rewritten service header).
- The browser React app was not touched and gained no ces-tenant import (must-NOT
  honored; the dependency lives in `muster-api/package.json` only, not the repo-root
  `package.json`).

## Gate results (actual)

1. No independent path construction — grep for
   `plan-data|resolveTenantJsonPath|CES_PIPELINE_ROOT` over `muster-api/src` excluding
   `vendored/`: only doc comments match; zero code references. PASS.
2. Contract preserved — `muster-api/tests/tenantKeys.test.ts` (all recorded behaviors:
   slug resolve, secret-ref resolve + fail-closed, endpoint fallback, `tenant_not_found`,
   env fallback, `degraded`, consent-url routes) passes unchanged, no test edits. PASS.
3. Test suites, zero regressions — muster-api: 20 files, 250 passed + 3 skipped
   (identical to pre-change baseline). Repo-root SPA suite: 33 files, 226/226 passed
   (the 226 baseline). `npx tsc --noEmit` in muster-api: clean. PASS.
4. Vendored-retirement question logged as OPEN — see below, no default action taken. PASS.
5. Encoding gate — mojibake-marker grep returns 0 on every file touched by this goal
   (`muster-api/package.json`, `muster-api/package-lock.json`,
   `muster-api/src/services/tenantKeysService.ts`, this log, the session log). The goal
   file itself was deliberately left untouched: its gate 5 line quotes the marker pattern
   literally (pre-existing at HEAD), so this log lives in a sibling file to keep every
   touched file at 0. PASS.
6. Vendor drift check — `npm run check:drift`: "Checked 32 files: 32 OK, 0 DRIFT". PASS.

## OPEN DECISION (founder call required) — vendored ces-shared retirement

As of this cutover, **nothing in muster-api source imports
`muster-api/src/vendored/ces-shared/` any longer** (`tenantKeysService.ts` was the only
importer). The vendored copy, `vendor-manifest.json`, and `scripts/check-vendor-drift.mjs`
are all left fully intact per the scope fence (design §8 item 5). The two options, stated
without a default action taken:

- **Option A — retire now.** Delete `muster-api/src/vendored/ces-shared/`, drop its
  entries from `vendor-manifest.json`, and simplify/remove `check-vendor-drift.mjs`
  accordingly. Pro: dead code gone; no drift-check maintenance for code nothing imports.
  Con: loses the zero-dependency fallback if the `file:../../ces-tenant` link ever breaks
  (ces-muster sits outside the ces workspace; design §8 item 2 flags exactly this drift
  risk for file-path dependencies).
- **Option B — keep as fallback.** Leave the vendored copy and drift tracking in place,
  unused, until the ces-tenant dependency-mechanism question (design §8 item 2:
  published vs git-pinned vs file-path) is itself resolved. Pro: safety net, and the
  drift check keeps proving the copy is pristine (32/32 today). Con: carries ~32 vendored
  files nothing imports, which future readers may mistake for live code.

No action taken either way. Awaiting founder sign-off to be recorded in this log.
