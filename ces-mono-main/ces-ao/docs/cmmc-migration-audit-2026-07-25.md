# CMMC-level migration audit — 2026-07-25 (G-AO-CMMC-BOUND-1 M5 evidence)

Run: `npm run audit-cmmc-migration` against the live ces-tenant registry
(`~/.ces/tenants/{live,sim}`), post-M4 wiring.

```
[audit-cmmc-migration] CMMC-level migration coverage report
  total tenants:     7
  exempt:            0
  migrated:          0
  coverage:          0.0%
```

## Reading

- **Coverage 0.0% is expected, not alarming.** Two blockers precede any record
  migration: (1) ces-tenant's M0 mirror has not landed — `parseTenantRecord`
  (`ces-tenant/src/impl/tenant-file.ts`) does not map
  `cmmc_level`/`assessment_scope`/`cui_boundary`, so even a migrated record
  would not surface the fields to AO; (2) no registry record carries the fields
  yet. ces-shared 0.3.0 (GP-SHARED-M0-1, `01612c4`) landed the type + parsing on
  its side only.
- Tenant count grew 5 → 7 since the 07-11 baseline audit (other panes' sim
  records).

## Phase 1 → Phase 2 flip recommendation

**No-go for now.** Preconditions, in order:
1. ces-tenant lands the M0 mirror (field mapping in `parseTenantRecord` +
   registry-record type) — filed requirement, sibling-owned.
2. Registry records get `cmmc_level` (+ scope/boundary) values, or
   `cmmcMigrationExempt` for archival tenants.
3. This audit reports 100% (`migrated / (total - exempt)`).

Until then Phase 1 (fail-open-with-warning) stays the default; operators can
fail closed today per-invocation (`--strict-cmmc`) or per-environment
(`AO_CMMC_STRICT=1`). Every fail-open pass is now visible: the warning lands on
`evidence.metadata.cmmcGate` (M4), so the migration window itself is evidenced.
