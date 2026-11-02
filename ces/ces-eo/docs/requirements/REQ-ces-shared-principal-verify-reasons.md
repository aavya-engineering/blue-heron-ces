# Requirement: add `wrong_tenant` (and optionally `missing_group`) to `PrincipalVerifyFailure` (against ces-shared)

- **Filed from:** ces-eo, 2026-09-28 (FC-EO-E, Entra operator sign-in)
- **Target:** `ces-shared/src/http/requestPrincipal.ts` (`PrincipalVerifyFailure`)
- **Status:** OPEN — awaiting a ces-shared session

## Context

EvidenceOps now verifies BHD operators with Microsoft Entra ID tokens
(`ces-eo/src/eo/approver-tokens/EntraOperatorVerifier.ts`), implementing ces-shared's `PrincipalVerifier`.
The verifier checks the token's `tid` against BHD's operator tenant independently of `iss`.

## Problem

`PrincipalVerifyFailure` is a closed union with no tenant reason. A token from the wrong tenant is reported
as `wrong_issuer`, which is true in effect but hides the actual cause in the 401 body and in logs. The
groups-overage case (group list replaced by a Graph pointer) is reported as `missing_claims`.

## Ask

Add `'wrong_tenant'` to `PrincipalVerifyFailure`. Optionally add `'groups_overage'` so a verifier can say
why a group-based role could not be decided.

## Acceptance

- The union includes `wrong_tenant` (and `groups_overage` if adopted). `requirePrincipal` passes it through
  unchanged in the 401 `reason`.
- EO then switches its tenant check to `wrong_tenant`. The EO tests that assert `wrong_issuer` for a wrong
  `tid` (`tests/eo/approver-tokens/EntraOperatorVerifier.test.ts`) are updated in the same EO change.
