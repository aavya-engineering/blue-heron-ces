# Plan: Unify ces-stamper Plan-Data Locations onto the Repo Folder
**Date:** 2026-07-10
**Status:** READY FOR IMPLEMENTATION

## Objective
Stamper currently reads tenant configs from two different roots (repo-relative `./plan-data` and the pipeline root `getStamperPlanDataRoot()`), forcing tenant JSONs to be duplicated. **Direction reversed at the human approval gate (2026-07-10): the canonical home is `ces-stamper/plan-data/` (within the repo), not `C:\CES_Pipeline`.** Unify all read/list/write paths onto the repo folder so a tenant JSON only needs to exist in one place, and stamper never depends on `CES_PIPELINE_ROOT` for tenant config.

## Context Summary
- **From Research (RESEARCH_SUMMARY.md, reconciled 2026-07-10):** Canonical home is `ces-stamper/plan-data/` — already exists, already gitignored (`.gitignore:23`), already what Camp A (cwd-based) resolves to. Camp B call sites (already on `getStamperPlanDataRoot()`) must switch to the repo folder. The Call-site inventory's prior "dist-relative!" flag on `blobStorageHelpers.ts:13` is now explicitly reconciled in RESEARCH_SUMMARY.md line 25: that flag was a defect ONLY under the old pipeline-root direction; under the repo-internal direction the same resolution is correct, conditioned on the depth-parity invariant below.
- **Depth-parity invariant (verified this pass, now a checked assumption, not implicit):** Read `tsconfig.json` directly — `rootDir: "./src"`, `outDir: "./dist"`, no per-file `paths`/rootDirs remapping, `include: ["src/**/*"]`. This means tsc mirrors the entire `src/` subtree into `dist/` at identical relative depth (e.g. `src/utils/blobStorageHelpers.ts` → `dist/utils/blobStorageHelpers.js`). Therefore a fixed `'..','..'` (or `'..','..','..'`) climb from a given module's `__dirname` lands on the same repo-root target whether running under `tsx` (from `src/`) or the built CLI (from `dist/`), **as long as that module's subdirectory depth relative to `src/`/`dist/` never changes**. This is the invariant the new singleton helper depends on — it must be stated in the helper's own code comment, not just this plan, so a future file move that breaks depth parity is caught by a reader, not silently.
- **Verified against code (this pass):**
  - Repo `plan-data/` currently holds `sim-m365-azure/` and `vfsgov-xtra/` (confirmed via `ls`). Pipeline root `C:\CES_Pipeline\Stamper\plan-data\` currently holds only `vfsgov-xtra/` (confirmed via `ls`).
  - `tenant.routes.ts:10-12` — read in full. `PROJECT_ROOT` is derived via `fileURLToPath(import.meta.url)` (NOT the regex-hack pattern), then `path.resolve(__dirname, '..', '..', '..')`. Module lives at `src/server/routes/tenant.routes.ts` → `dist/server/routes/tenant.routes.js`; three `..` climbs from `routes/` → `server/` → `src`/`dist` → repo root, in both cases. **This IS dist-safe today**, confirmed by direct read, not deferred — no change needed to this derivation, only to what it's used for (already repo-relative, no redirection required).
  - `GuiServer.ts:92-181` (`migrateToTenantTree`) and `:390-410` — read in full. This migration is UNRELATED to the pipeline-root/repo-root question: it moves tenant data from a third, older legacy location `~/.stamper/tenants/` into whatever `planDataDir` currently resolves to (line 391: `getStamperPlanDataRoot()`). Changing line 391 to the new repo-root helper does not create a no-op or self-copy risk — the source (`~/.stamper/tenants/`) and destination (plan-data root) are always different directories regardless of which root is canonical. The only change needed is redirecting the destination variable.
  - `evidence.routes.ts:29-32`'s exclusion (bundled static CMMC registry JSON, not tenant data) is unaffected by the direction change — stays untouched either way.
  - `ces-eo/src/eo/config/EoConfig.ts:107` and `ces-eo/src/eo/evidence/VariableStore.ts:49` both do `process.env.STAMPER_PLAN_DATA_ROOT ?? getStamperPlanDataRoot()` — EO has an env override.
  - `ces-ao/src/server/AoServer.ts:98` hard-codes `getStamperPlanDataRoot()`, no override, still reads the pipeline-root path — this is why the pipeline-root `vfsgov-xtra` copy must NOT be deleted during this execution (see Collision Policy).
- **Constraints:** Modify only files under `ces-stamper/` (ces-shared and all sibling repos are read-only). Minimal diff. Never print credential values. Update stale `./plan-data` and pipeline-root-implying help/description strings. **`src/server/GuiServer.ts` and `src/cli/index.ts` currently carry uncommitted, unrelated changes (a quiet request logger and a `--verbose` CLI flag) from a separate task — the executor must preserve these when editing either file; do not revert or clobber them via a stale re-read/re-write.** Single-operator Windows machine — see Portability Note.

## CES_PIPELINE_ROOT Relevance Under This Direction
`CES_PIPELINE_ROOT`'s Windows-default (`C:\CES_Pipeline`) vs. POSIX-default (cwd-relative `ces-pipeline`) divergence in `ces-shared/storage/contract.ts` is **no longer load-bearing for stamper's own tenant-config resolution** once this plan lands — stamper stops calling `getStamperPlanDataRoot()`/pipeline-root helpers for plan-data entirely. It still matters to stamper's unified SQLite state DB (`ces.db`, used by `StateManager`/`EvidenceStore`/assess-state) and to sibling modules (EO, AO) that still read `getStamperPlanDataRoot()`; changing that DB usage is out of scope.

## Singleton Helper (mandatory — no per-file re-derivation)
Define exactly ONE new module, `src/config/paths.ts`, at `src/config/` depth (same depth as the existing `ClientConfig.ts` it will be imported by, and one hop shallower than `src/utils/`, `src/server/routes/`, `src/server/`, `src/cli/` — each of those needs a different `..` climb count, so the module centralizes the computation, not the per-caller math):

```ts
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// src/config/paths.ts -> dist/config/paths.js: two '..' reaches src/ or dist/,
// a third reaches repo root. Depth parity holds only while this file stays at
// src/config/ — see tsconfig.json rootDir/outDir invariant in PLAN.md.
export function getRepoRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

export function getPlanDataRoot(): string {
  return path.join(getRepoRoot(), 'plan-data');
}

export function getTenantPlanDataDir(slug: string): string {
  return path.join(getPlanDataRoot(), slug);
}
```

This reuses the existing `fileURLToPath(import.meta.url)` pattern already proven correct in `tenant.routes.ts` and `GuiServer.ts` — NOT the regex fixup (`.replace(/^\/([A-Z]:)/, '$1')`) present in `blobStorageHelpers.ts`'s current `checkPriorRunCompleted`, which is superseded/removed in favor of this shared helper (see Step 1). Every call site listed below imports `getPlanDataRoot()` (or `getTenantPlanDataDir()`) from `src/config/paths.ts` — the plan forbids re-deriving `__dirname`/`import.meta.url` math in `ClientConfig.ts`, `GuiServer.ts`, `translate.routes.ts`, `utility.routes.ts`, or `cli/index.ts`. `tenant.routes.ts` already has its own correct, independently-verified `PROJECT_ROOT` derivation (see Context Summary) and may keep it as-is, OR be switched to import `getPlanDataRoot()` for consistency — plan prefers switching it too, to leave exactly one derivation in the codebase.

## Implementation Steps
1. **`src/config/paths.ts`** — CREATE with the singleton helper above. **`src/utils/blobStorageHelpers.ts`** — MODIFY: replace `checkPriorRunCompleted`'s inline `__dirname`/regex-based path construction with a call to `getTenantPlanDataDir(tenantSlug)` (+ `'state'`) imported from `../config/paths.js`; remove the now-redundant regex fixup.
2. **`src/config/ClientConfig.ts`** — Change `resolveTenantJsonPath(slug)` to call `sharedResolveTenantJsonPath(slug, getRepoRoot())` (imported from `./paths.js`), replacing `process.cwd()`.
3. **`src/server/routes/tenant.routes.ts`** — Replace the locally-derived `PROJECT_ROOT` (lines 10-12) with `getRepoRoot()` imported from `../../config/paths.js`, so there is exactly one derivation in the codebase (this file's own math was verified correct but is redundant once the singleton exists). No behavior change — same resolved path. Update help/comment strings ~lines 120, 136 if they mention anything other than the repo folder.
4. **`src/server/GuiServer.ts`** — Preserve the existing uncommitted quiet-logger/`--verbose` changes. Change line 391's `const planDataDir = getStamperPlanDataRoot();` to `const planDataDir = getPlanDataRoot();` imported from `./config/paths.js` (adjust relative import path as needed), removing the `ces-shared/storage` import if no longer used elsewhere in the file. `migrateToTenantTree()` itself (lines 92-181) needs no logic change — it migrates from `~/.stamper/tenants/` into `planDataDir`, which now simply resolves to the repo folder instead of the pipeline root; source and destination remain distinct directories, so no no-op/self-copy risk.
5. **`src/server/routes/translate.routes.ts:73,249`** and **`src/server/routes/utility.routes.ts`** — Replace `getStamperPlanDataRoot()`-based output dirs / scans with `getPlanDataRoot()` from `../../config/paths.js`.
6. **`src/cli/index.ts`** — Preserve the existing uncommitted `--verbose` flag. Change `tenants list` (~line 480) from `getStamperPlanDataRoot()` to `getPlanDataRoot()` imported from `../config/paths.js`. Update help strings (lines 243, 478, 496) to say `plan-data/<slug>/<slug>.json` (repo-relative), removing pipeline-root wording.
7. **One-time hash verification (report only — no deletion this pass)** — Hash-verify `C:\CES_Pipeline\Stamper\plan-data\vfsgov-xtra\vfsgov-xtra.json` against `ces-stamper\plan-data\vfsgov-xtra\vfsgov-xtra.json` (SHA-256, never print contents). See Collision Policy below. Repo `plan-data/` already has both `sim-m365-azure` and `vfsgov-xtra`, so no copy-in from the pipeline root is needed either way.
8. **Requirement note for ces-ao** — Create `docs/REQUIREMENT-sibling-plan-data-consumers.md` inside ces-stamper stating: (a) ces-ao's `AoServer.ts:98` hard-codes `getStamperPlanDataRoot()` and will not see tenants living in `ces-stamper/plan-data/` after this change — it needs either an env-override analogous to ces-eo's `STAMPER_PLAN_DATA_ROOT`, or a direct fix to point at the repo folder, both requiring edits to ces-ao/ces-shared, out of scope here; (b) operator action: set `STAMPER_PLAN_DATA_ROOT=C:\Users\mhsut\DevProjects\ces\ces-stamper\plan-data` in ces-eo's environment; (c) **follow-up item, not part of this execution:** the `C:\CES_Pipeline\Stamper\plan-data\vfsgov-xtra\` copy is a candidate for deletion once ces-ao is fixed (or the user explicitly approves deleting it while ces-ao still reads it) — do not delete it now, since ces-ao actively reads that exact path with no override and may be running.
9. **Verify `.gitignore`** — Confirm `plan-data/` entry (line 23) still covers the repo copies; no edit expected.

## Migration Collision Policy (pipeline-root `vfsgov-xtra` vs repo `vfsgov-xtra`) — REPORT ONLY, NO DELETION
1. Compute a SHA-256 hash of both `C:\CES_Pipeline\Stamper\plan-data\vfsgov-xtra\vfsgov-xtra.json` and `ces-stamper\plan-data\vfsgov-xtra\vfsgov-xtra.json`. Never print file contents — only feed each file into the hash function.
2. **Hashes match → report "in sync" and STOP.** Do NOT delete the pipeline-root copy in this execution. Record it as a follow-up in the requirement note (Step 8c): safe to delete only after ces-ao is fixed to read from the repo folder (or an operator explicitly approves deleting it despite ces-ao's current read dependency). Rationale for not deleting now: `AoServer.ts:98` reads that exact path with no override; deleting it while ces-ao may be running/reading breaks AO with no fallback.
3. **Hashes differ → STOP.** Do not delete or overwrite either file. Parse both JSONs, diff top-level and nested key paths (e.g. `auth.cert_thumbprint`, `tenant.tenant_id`, `onboarding.cert_expires`), and report to the human the list of field **NAMES** that differ — never values. Leave both copies in place until the human decides which is authoritative; this also blocks the future deletion follow-up until resolved.
4. `sim-m365-azure` exists only in the repo copy (confirmed — pipeline root has no `sim-m365-azure` dir) — no collision to resolve for that slug.

## File Inventory
| File | Action | Lines/Functions Affected |
|------|--------|--------------------------|
| src/config/paths.ts | CREATE | `getRepoRoot()`, `getPlanDataRoot()`, `getTenantPlanDataDir()` — the one and only `__dirname`/`import.meta.url` derivation site for plan-data |
| src/utils/blobStorageHelpers.ts | MODIFY | `checkPriorRunCompleted()` L9-22 — use `getTenantPlanDataDir()` from paths.ts instead of inline derivation |
| src/config/ClientConfig.ts | MODIFY | `resolveTenantJsonPath()` L16-18 — pass `getRepoRoot()` |
| src/server/routes/tenant.routes.ts | MODIFY | replace local `PROJECT_ROOT` (L10-12) with `getRepoRoot()` import; help/comment strings ~L120,136 |
| src/server/GuiServer.ts | MODIFY (preserve uncommitted logger/--verbose changes) | `planDataDir` source L391 |
| src/server/routes/translate.routes.ts | MODIFY | output dirs L73,249 |
| src/server/routes/utility.routes.ts | MODIFY | plan-data scans |
| src/cli/index.ts | MODIFY (preserve uncommitted --verbose flag) | `tenants list` ~L480; help strings L243,478,496 |
| docs/REQUIREMENT-sibling-plan-data-consumers.md | CREATE | ces-ao gap, ces-eo env-override instruction, deferred-deletion follow-up |
| .gitignore | VERIFY ONLY | L23 `plan-data/` — confirm no change needed |

No file outside `ces-stamper/` is modified. `C:\CES_Pipeline\Stamper\plan-data\vfsgov-xtra\` is read (for hashing) but NOT deleted or modified in this execution.

## Architecture Decisions
- **Repo folder is canonical, not the pipeline root:** reverses the prior plan per explicit human rejection at the approval gate.
- **Exactly one derivation site (`src/config/paths.ts`), not five:** closes the gap-analysis finding that "reuse blobStorageHelpers.ts's pattern" was a description, not a shared import. Every call site imports the same two/three functions; the `'..'` climb-count math exists once.
- **Depth-parity is a stated, checked invariant, not implicit:** `tsconfig.json`'s `rootDir`/`outDir` were read directly and confirmed to mirror `src/` into `dist/` at identical depth with no per-file exceptions. The helper's own code comment restates this so a future contributor who moves `paths.ts` to a different depth is warned in the same file, not just this plan.
- **`tenant.routes.ts`'s existing `PROJECT_ROOT` was independently verified dist-safe** (read in full, `fileURLToPath`-based, correct climb count) — not deferred to implementation. It is still redirected to the shared helper for the "one derivation site" invariant, not because it was wrong.
- **No deletion of the pipeline-root `vfsgov-xtra` copy in this execution:** ces-ao reads that exact path live with no override; deleting it now could break AO with no fallback. Deletion becomes a documented follow-up, gated on either fixing ces-ao or explicit user approval.
- **`GuiServer.ts`'s `migrateToTenantTree()` needs no logic change**, only a redirected destination variable — verified by reading the function in full: its source is the unrelated legacy `~/.stamper/tenants/` directory, not the pipeline root, so there is no self-copy or no-op risk from this plan.
- **Leave `EvidenceReadinessAnalyzer.ts` and `evidence.routes.ts:31-32` untouched:** unaffected by the direction reversal — bundled static registry file, not tenant storage.

## Testing Strategy — Full Test Audit (carried forward, still applies)
Every file under `tests/` was enumerated (`tests/**/*.ts`, 14 files) and checked for references to `plan-data`, `resolveTenantJsonPath`, `ClientConfig`, or the affected files. No test in the current suite imports or exercises any of these files against a real filesystem path in a way that depends on which root is canonical — the three `CES_PIPELINE_ROOT`-using tests (`StateManagerIdentity.test.ts`, `EvidenceStoreIdentity.test.ts`, `AssessStateRepo.test.ts`) use it only to relocate the unified SQLite DB (`ces.db`), unrelated to tenant-JSON plan-data resolution, and are unaffected by this plan. `StorageSmoke.test.ts` asserts `getStamperPlanDataRoot()`'s shape directly against the ces-shared contract, which this plan does not modify (stamper simply stops calling that function for tenant config) — expected to keep passing unchanged. `StamperConfig.test.ts` and `PlanTranslatorIdentity.test.ts` use `ClientConfig`-shaped plain object literals only, never real file resolution.

- Run `npm test` before any change to capture the baseline pass count.
- No existing test is expected to change status. If a new test is added for `src/config/paths.ts`, it needs no environment hermeticity (derives from module location, not `process.cwd()`/`CES_PIPELINE_ROOT`) — a plain unit test against the known repo layout is sufficient.
- `npm test` must be green after the change, same pass count as baseline.

## Credential-Safety Verification (concrete, not just "never print")
Grep the known-sensitive field NAMES (not values) — `cert_thumbprint`, `app_id`, `tenant_id`, `subscription_id`, `client_secret`, `initial_password`, `cert_path` — against:
1. The git diff of all tracked files changed by this plan.
2. Any terminal/log output captured during the hash-verify step.
3. `git status` after Step 7 — confirms no new file under `ces-stamper/plan-data/` became newly tracked.
Field **names** in code (e.g. `cfg.auth?.cert_thumbprint`) are expected and fine; field **values** anywhere in tracked files, console output, or logs is a hard failure requiring remediation before proceeding.

## Portability Note
The repo-relative `plan-data/` helper (`src/config/paths.ts`) is cross-platform by construction — an incidental portability improvement over the original `process.cwd()`-based wrapper. The hash-verify step references a Windows-only absolute path (`C:\CES_Pipeline\...`) matching the operator's actual machine; making that step cross-platform is not attempted (single known Windows operator machine, not CI).

## Out of Scope
- Any change inside `ces-shared/`, `ces-eo/`, or `ces-ao/` (all read-only; sibling repos).
- Actually fixing ces-ao's hard-coded `getStamperPlanDataRoot()` call — documented only, per the requirement note (Step 8).
- Deleting the pipeline-root `vfsgov-xtra` copy — explicitly deferred to a follow-up gated on ces-ao being fixed or explicit user approval; NOT part of this execution.
- Live authentication / connectivity testing of tenant credentials — `tenants validate` need only resolve the path and print auth commands without error.
- Changing stamper's `CES_PIPELINE_ROOT`-based SQLite state DB location/behavior — unrelated to tenant-config plan-data.
- Refactoring `EvidenceReadinessAnalyzer.ts`'s evidence/state/logs directory resolution — separate concern.
- Reverting or altering the uncommitted quiet-logger/`--verbose` changes in `GuiServer.ts`/`cli/index.ts` — must be preserved as-is.
- Changing the `--stacksim` GUI flag mechanism itself — only verifying it still surfaces `sim-m365-azure` post-change.

## Acceptance Criteria
- [ ] Baseline captured: `npm test` pass count recorded before any code change.
- [ ] `src/config/paths.ts` is the only module performing `__dirname`/`import.meta.url`-based repo-root derivation for plan-data; all other listed call sites import from it.
- [ ] `npx tsx src/cli/index.ts tenants list` shows both `sim-m365-azure` and `vfsgov-xtra`, resolved entirely from `ces-stamper/plan-data/` (no dependency on `CES_PIPELINE_ROOT`/`C:\CES_Pipeline`).
- [ ] `npx tsx src/cli/index.ts tenants validate sim-m365-azure` and `tenants validate vfsgov-xtra` both resolve their config path and print auth commands without error.
- [ ] Hash comparison performed for `vfsgov-xtra` (not assumed); result (match/mismatch) reported; NO deletion performed regardless of outcome; if mismatched, field-name-only diff reported.
- [ ] `docs/REQUIREMENT-sibling-plan-data-consumers.md` created, documenting the ces-ao gap, the ces-eo `STAMPER_PLAN_DATA_ROOT` instruction, and the deferred-deletion follow-up condition.
- [ ] `npm test` passes green with the same pass count as the recorded baseline.
- [ ] `gui --stacksim` flow surfaces `sim-m365-azure` tenant data in the tenant picker/list — no credential values displayed or logged.
- [ ] Uncommitted quiet-logger/`--verbose` changes in `GuiServer.ts` and `cli/index.ts` remain intact after this plan's edits to those files.
- [ ] Credential-Safety Verification section's three checks all pass with zero credential-value hits.
- [ ] `.gitignore` confirmed to still exclude repo `plan-data/`.
