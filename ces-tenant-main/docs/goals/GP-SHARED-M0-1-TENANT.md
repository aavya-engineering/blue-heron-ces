# Goal Document — GP-SHARED-M0-1-TENANT (the M0 mirror)

**Date:** 2026-07-26
**Status:** EXECUTED
**Ratification:** founder ask 2026-07-26 ("execute the ces-tenant half of GP-SHARED-M0-1"),
executing the remainder filed by `ces-shared/docs/goals/GP-SHARED-M0-1.md` §"Remainder — filed
against ces-tenant". Origin memo: `ces-ao/docs/goals/G-AO-CMMC-BOUND-1.md` §"Against ces-tenant".

## Job

Mirror the three CMMC scoping fields (landed on ces-shared's `TenantConfig` 2026-07-25) onto
`TenantRegistryRecord`, so ces-ao's M4 type probe passes on BOTH sibling types and registry-resolved
tenants can carry CMMC posture. Plus the memo's three riders: G7 kind-queryability confirmation,
load-time partial-config rejection (SHOULD), and the `cmmcMigrationExempt` addendum convention.

## Implementation

- `src/registry.ts` — RATIFIED AMENDMENT (founder, 2026-07-26), marked in source:
  - New exported `AssessmentScope` / `CuiBoundary` interfaces (field-identical mirror of
    ces-shared's).
  - `TenantRegistryRecord` gains `cmmcLevel?: 'L1' | 'L2'`, `assessmentScope?`, `cuiBoundary?`,
    and `cmmcMigrationExempt?: boolean` (the memo-addendum convention promoted to a typed field —
    ces-ao's audit script reads it via cast today and can drop the cast on next bump).
  - G7 note added at the `kind` field doc: surfaced generically by `get()`/`listByKind()` in both
    transports; wire redaction strips only `evidenceStorage`. No schema change was needed.
- `src/index.ts` — exports the two new types.
- `src/impl/tenant-file.ts`:
  - CMMC parsers are a behavior-identical mirror of `ces-shared/src/config/TenantConfig.ts:90-142`
    (same snake_case keys, same fail-closed error messages; absent → `undefined`, so
    pre-migration records load byte-identically).
  - `cmmcMigrationExempt` parsed from `cmmc_migration_exempt` (file convention) OR literal
    top-level `cmmcMigrationExempt` (the convention as filed); camelCase wins if both present;
    non-boolean throws.
  - **Case-B load-time rejection** in `parseTenantRecord()` — covers get/listByKind/migration/
    sim-create and, through them, the service API.
- No service-layer changes needed: `redactRecord()` is a rest-spread (only `evidenceStorage`
  stripped), so the new fields cross the wire automatically; verified by test.

## Decision — Case-B semantics (memo said SHOULD; interpretation recorded)

The memo's wording ("`cmmcLevel` is set but `assessmentScope`/`cuiBoundary` is absent") is
ambiguous between either-absent and both-absent. Implemented: **reject when `cmmc_level` is set
and `cui_boundary` is absent; `assessment_scope` absent alone is allowed.** Rationale: ces-ao's
runtime Case-B always-deny keys on `cuiBoundary` alone ("cuiBoundary missing on cmmcLevel-scoped
tenant", G-AO-CMMC-BOUND-1 M3), and a tag-based CUI boundary legitimately needs no
subscription/RG/OU scope. Flip to stricter both-required is a two-line change in
`tenant-file.ts` if the founder disagrees.

## Verification

- `npx vitest run --reporter=verbose`: **7 files / 94 tests green** (86 baseline + 8 new:
  7 in `registry.test.ts` — absent→undefined, full snake_case parse, tag-only boundary,
  Case-B rejection, malformed-value throws, exempt both spellings + non-boolean throw,
  G7 listByKind generic surface; 1 in `service.test.ts` — wire pass-through of all four
  fields with `evidenceStorage` still stripped).
- `npm run build` clean; `npx tsc --noEmit` clean. Encoding grep 0 on all touched files.
- **M0 type probe (the ces-ao landing signal) PASSES on both types:**
  `grep -cE 'cmmcLevel|assessmentScope|cuiBoundary'` → `ces-tenant/src/registry.ts` **5**,
  `ces-shared/src/config/TenantConfig.ts` **8**. Per G-AO-CMMC-BOUND-1, M0 is now LANDED
  (was "filed, not landed") and ces-ao's M4 live-registry blocker is cleared.
- Version 0.4.0 → 0.5.0 (additive; no consumer updates required — verified stance: the only
  registry consumers read records whole, and absent fields parse to `undefined`).

## Follow-ups for siblings (filed here, not done — write boundary)

- **ces-ao:** M0 landing signal is live — rerun the type probe, then record migration
  (`cmmc_level` + `cui_boundary` or `cmmcMigrationExempt` on the 7 audited records) and the
  Phase-2 flip per its own collective. `scripts/audit-cmmc-migration.ts` can drop its cast of
  `cmmcLevel`/`cmmcMigrationExempt` once it picks up ces-tenant ≥0.5.0.
- **Record authors:** any record opting into `cmmc_level` MUST carry `cui_boundary` or the
  registry refuses to serve it (Case B) — populate both in the same edit.
