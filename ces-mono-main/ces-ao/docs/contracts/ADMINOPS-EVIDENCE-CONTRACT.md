# AdminOps Evidence Contract — AO Conformance (v1.3.0)

**Module:** ces-ao (writer)
**Contract:** `ces-shared/src/types/adminops-evidence.contract.ts`
**Version:** `ADMINOPS_EVIDENCE_CONTRACT_VERSION = '1.3.0'` (AO emits 1.3.0 since FX-AO6, 2026-09-27; 1.1.0 added the dry-run-mode deny invariant, 1.2.0 (ces-shared FX-SH1, `2e07bc2`) added `denied_sim_only`, 1.3.0 (ces-shared FX-SH3, `03a6d0a`) added optional `targetUPN`/`targetObjectId`)
**Date:** 2026-09-27 (corrected in the fix batch: this doc previously said 1.0.0 while the code emitted 1.1.0)

## Overview

ces-ao writes evidence rows to the `adminops_evidence` collection in `ces.db`.
ces-eo reads them via `AdminOpsEvidenceReader`. Both validate against the shared
`AdminOpsEvidenceSchema` Zod schema in ces-shared.

## AO's Conformance Surface

### Outcome normalization

AO's internal `EvidenceOutcome` (18 values) maps to the contract's 8-value
`AdminOpsEvidenceOutcome` via `normalizeOutcome(local, mode)` in
`src/execution/EvidenceEmitter.ts`:

| AO internal outcome              | mode=live  | mode=dry_run |
|----------------------------------|------------|--------------|
| `automated_success`              | `executed` | `dry_run`    |
| `policy_compliance`              | `executed` | `dry_run`    |
| `manual_action`                  | `executed` | `executed`   |
| `exception_granted`              | `executed` | `executed`   |
| `outside_action`                 | `executed` | `executed`   |
| `partial_success`                | `executed` | `executed`   |
| `dry_run`                        | `dry_run`  | `dry_run`    |
| `denied_cmmc`                    | `denied_cmmc` | `denied_cmmc` |
| `denied_cui`                     | `denied_cui`  | `denied_cui`  |
| `denied_sim_only`                | `denied_sim_only` | `denied_sim_only` |
| `blocked_pending_approval`       | `blocked_pending_approval` | `blocked_pending_approval` |
| `approval_rejected`              | `approval_rejected` | `approval_rejected` |
| `failed_remediation_available`   | `failed`   | `failed`     |
| `failed_no_remediation`          | `failed`   | `failed`     |
| `not_applicable`                 | `failed`   | `failed`     |
| `inherited`                      | `failed`   | `failed`     |
| `verification_pending`           | `failed`   | `failed`     |
| `unknown_legacy`                 | `failed`   | `failed`     |

### Contract row builder

`toContractRow(evidence, opts)` produces `AdminOpsEvidence` from AO's
`StructuredEvidence` + `EvidencePersistenceOptions`. It stamps every row with:

- `contractVersion` = the shared `ADMINOPS_EVIDENCE_CONTRACT_VERSION` (1.3.0)
- `mode` / `dryRun` / `outcome` (normalized)
- `controlIds`, `timestamp`, `verdict`, `sha256`
- Optional: `tenantSlug`, `tenantKind`, `correlationId`,
  `requestorUPN`, `approverUPN`, `approvalId`,
  `targetUPN` / `targetObjectId` (1.3.0 — the user the command acted on, from the command's
  declared `targetUPN`/`upn` parameter via `src/execution/TargetIdentity.ts`; never an
  operator identity; `targetObjectId` stays unset because no registry command carries a
  user object id),
  `preStateOutput`, `postStateOutput`, `verdictRationale`

### Execution paths tested

See `test/evidenceContractConformance.test.ts`:

| Path                            | Status |
|---------------------------------|--------|
| Live execution (SAT)            | PASS   |
| Live execution failure          | PASS   |
| Dry-run preview                 | PASS   |
| Dry-run SAT rejection           | PASS (schema correctly rejects) |
| Live CMMC denial                | PASS   |
| Live CUI denial                 | PASS   |
| Live blocked_pending_approval   | PASS   |
| Live approval_rejected          | PASS   |
| Optional fields round-trip      | PASS   |
| Dry-run CMMC denial             | PASS (un-skipped `6f86d7e`) |
| Dry-run blocked_pending_approval| PASS (un-skipped `6f86d7e`) |
| Sim-only rail refusal           | PASS (`denied_sim_only`, 1.2.0) |

Persisted rows are also pinned by the golden
`test/fixtures/contract/adminops-evidence-rows.golden.json` and the 40-test
`test/contract/adminopsEvidence.conformance.test.ts` (parse + drift).

### Closed: shared superRefine bug

The shared schema's `superRefine` used to reject `dryRun=true` + `outcome≠'dry_run'`,
which blocked valid dry-run-mode denials. Fixed in ces-shared (`8697ecd`, contract 1.1.0);
`docs/requirements/REQ-shared-adminops-evidence-dryrun-invariant.md` is CLOSED.

## SPRS Integrity Rules

The contract enforces that no non-execution outcome can carry `verdict: 'SAT'`:

- `dry_run + SAT` → rejected
- `denied_cmmc + SAT` → rejected
- `denied_cui + SAT` → rejected
- `denied_sim_only + SAT` → rejected
- `blocked_pending_approval + SAT` → rejected
- `approval_rejected + SAT` → rejected
- `failed + SAT` → rejected

AO enforces this at the source: `buildEvidenceArtifact` sets
`complianceVerdict: 'NOT_APPLICABLE'` for all override outcomes and dry-run previews.
