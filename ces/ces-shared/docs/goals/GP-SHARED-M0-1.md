# Goal Document — GP-SHARED-M0-1

**Date:** 2026-07-25
**Status:** EXECUTED
**Origin:** M0 requirements memo in `ces-ao/docs/goals/G-AO-CMMC-BOUND-1.md` (Dependencies
section). ces-ao's M4/M5 are parked on this landing; this goal is the ces-shared half.

## Job

Land the three CMMC scoping fields on `TenantConfig` so ces-ao's `CmmcScopeGate` /
`ParameterMapper` (built against mocks in its M2/M3) can wire against the real type in M4.

## Requirements (verbatim from the M0 memo)

- `cmmcLevel: 'L1' | 'L2' | undefined` — optional for backward compatibility.
- `assessmentScope?: { subscriptionIds?: string[]; resourceGroups?: string[]; ous?: string[] }`
- `cuiBoundary?: { resourceAllowlist?: string[]; tagKey?: string; tagValue?: string }`

## Implementation (2026-07-25)

- `src/config/TenantConfig.ts`:
  - New exported `AssessmentScope` and `CuiBoundary` interfaces; three optional fields added
    to `TenantConfig` (placed in the shared section, not Stamper-only).
  - `loadTenantConfig` parses snake_case JSON keys per the file's existing convention:
    `cmmc_level`, `assessment_scope.{subscription_ids,resource_groups,ous}`,
    `cui_boundary.{resource_allowlist,tag_key,tag_value}` → camelCase typed fields.
  - **Fail-closed on malformed values** (invalid `cmmc_level` enum, non-string array entries,
    non-object scope/boundary → throw with a named field). Absent values stay `undefined`, so
    pre-migration tenant files load exactly as before (zero regression).
  - G6 closure assist: one-line "superseded by assessmentScope/cuiBoundary for CMMC scoping"
    comments added at `infrastructure_model` / `excluded_entries` declarations, as the ces-ao
    goal doc requested of the sibling.
- `src/config/TenantConfig.test.ts`: +7 tests (absent → undefined; full parse; tag-based
  boundary; invalid level / array entry / scope shape / tag_key all throw).
- `package.json`: version 0.2.0 → 0.3.0 (additive schema signal; consumers use `"*"`).

## Verification

- `npm test`: **124/124** (12 files) — was 117 before this goal; +7, zero regressions.
- `npm run build` (tsc + copy-data): clean.
- Type probe (the M0 landing signal): grep `cmmcLevel|assessmentScope|cuiBoundary` →
  `ces-shared/src/config/TenantConfig.ts` **8 hits**; `ces-tenant/src/registry.ts` **0 hits**.

## Remainder — filed against ces-tenant (NOT done here; write boundary)

The M0 memo's ces-tenant half is still open. A ces-tenant session (or the founder) must:
1. Mirror `cmmcLevel`/`assessmentScope`/`cuiBoundary` on `TenantRegistryRecord`
   (`ces-tenant/src/registry.ts`).
2. Confirm `kind: 'live'|'sim'` is queryable via the registry API outside `aoTenants.ts` (G7).
3. SHOULD: registry load-time rejection of partial configs (`cmmcLevel` set but
   `assessmentScope`/`cuiBoundary` absent) — the Case-B foot-gun.
4. Addendum: honor the informal `cmmcMigrationExempt: true` convention on registry records
   (excluded from the Phase-2 flip denominator).

ces-ao's M4 stays blocked until the type probe passes on **both** files.
