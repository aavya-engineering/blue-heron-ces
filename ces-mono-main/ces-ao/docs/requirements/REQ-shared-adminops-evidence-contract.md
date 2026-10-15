# REQ-shared-adminops-evidence-contract

**Status:** SUPERSEDED — shipped in ces-shared `c0b80b3` (`adminops-evidence.contract.ts`, v1.0.0)
**Target module:** ces-shared
**Filed by:** ces-ao (AE-R1 / AE-R2)
**Date:** 2026-09-26
**Closed:** 2026-09-27 (ces-ao AE-R2 adopted the contract in `e0745f9`)
**Priority:** P0 — blocks AdminOps → EvidenceOps flow

## What

Create `ces-shared/src/types/adminops-evidence.types.ts` with a versioned Zod schema
and TypeScript type for the AdminOps evidence row. Both ces-ao (producer) and ces-eo
(consumer) compile and validate against it.

## Why

Three private definitions of the evidence row exist today (Stamper Zod, AO hand copy,
EO loose parser). AE-R1 landed the dry-run flag and deny outcomes in ces-ao's local
type (`StamperTypes.ts`). The shared contract must adopt the same field names and enum
values so EO's reader (AE-R4) can filter on them.

## Field names and enums landed by AE-R1

These are the values AE-R1 already writes; the shared contract must include them:

```
metadata.dryRun:  boolean
metadata.mode:    'dry_run' | 'live'

outcome enum additions:
  'dry_run'       — preview, no state change
  'denied_cmmc'   — CMMC scope gate denial
  'denied_cui'    — CUI boundary denial

complianceVerdict additions:
  'NOT_APPLICABLE' — no compliance determination (previews and denials)

Persisted flat metadata additions (on the repo record):
  outcome, dryRun, mode  — for EO reader filtering
```

## Full contract fields (from the flow assessment AE-R2)

- commandId, tenantId, tenantSlug, tenantKind
- mode ('dry_run' | 'live'), dryRun (boolean)
- outcome enum: executed | dry_run | denied_cmmc | denied_cui |
  blocked_pending_approval | approval_rejected | failed
- controlIds (string[])
- correlationId
- requestorUPN, approverUPN, approvalId
- timestamps (created, decided, executed)
- pre/post state
- complianceVerdict: SAT | NOT_SAT | PROVISIONAL | NOT_APPLICABLE
- sha256 over the canonical row
- contractVersion

## Acceptance test

- `ces-shared` unit test: `AdminopsEvidenceSchema.parse()` accepts a valid row and
  rejects a row with `outcome: 'dry_run', complianceVerdict: 'SAT'`.
- `ces-ao` schema-conformance test: every execution path (success, failure, each deny,
  dry-run, pending, rejected) produces a row that passes `schema.parse()`.
- `npx tsc --noEmit` clean in ces-ao and ces-eo.

## Legend

AE-Rn = AdminOps → EvidenceOps recommendation n from the flow assessment.
P0 = blocks the flow.
