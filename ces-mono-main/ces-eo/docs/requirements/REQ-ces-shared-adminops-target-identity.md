# REQ-ces-shared-adminops-target-identity

- **From:** ces-eo (fix batch 2026-09-27, step FX-EO4)
- **To:** ces-shared (AdminOps evidence contract owner); ces-ao (writer) to populate
- **Status:** CLOSED 2026-09-27 — ces-shared FX-SH3 `03a6d0a` (contract 1.3.0: optional `targetUPN` / `targetObjectId`). EO tripwire converted to a passing test; AO still has to POPULATE the fields (see below).
- **Filed:** 2026-09-27

## Need
The EO offboarding wizard must mark a step (A-02 disable account, A-03 remove group
memberships, B-05 revoke device access) as system-evidenced only when a live, executed
AdminOps row acted on **the person being offboarded**. The shared contract
(`ces-shared/src/types/adminops-evidence.contract.ts`, 1.2.0) has only the **operator**
identities (`requestorUPN`, `approverUPN`). There is no field for the command's **target**
user, so EO cannot match the offboarded person. The old EO code matched the operator's UPN,
which is wrong (an admin who ran A-02 against someone else evidenced their own offboarding).

## Ask (minor bump, back-compatible)
Add two optional fields to `AdminOpsEvidenceSchema`:

| Field | Type | Meaning |
|---|---|---|
| `targetUPN` | `string` (optional) | UPN of the user the command acted on (e.g. A-02's `UserPrincipalName` parameter) |
| `targetObjectId` | `string` (optional) | Entra object id of that user, when known |

- Both optional: rows from 1.0.0–1.2.0 still parse unchanged.
- ces-ao should populate them from the command's parameters for user-targeted commands
  (at least A-02, A-03, B-05) in `data.metadata`.
- Identity note: these are tenant-user identifiers inside tenant-scoped rows; no personal data
  leaves the tenant's own store.

## EO side (already done, waiting on this)
- `AdminOpsEvidenceReader.normalizeRow` already forwards `targetUPN` / `targetObjectId` from
  `data.metadata` (today zod strips them).
- `OffboardingWizardStore.applyAdminOpsEvidence` matches only the target (case-insensitive
  UPN or object id), never the operator; wired into the wizard's real routes.
- Tripwire: `tests/eo/adminops/adminops-offboarding.test.ts` had an `it.failing` positive
  case; it turned red when 03a6d0a landed and is now a normal passing `it`.

## Remaining (ces-ao)
Contract fields exist; until ces-ao writes `targetUPN`/`targetObjectId` on A-02/A-03/B-05 rows,
real rows carry no target and the wizard stays attestation-only for them (fail closed).
