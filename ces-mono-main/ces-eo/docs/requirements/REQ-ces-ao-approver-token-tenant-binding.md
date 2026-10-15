# Requirement: bind AdminOps approver tokens to the approval's tenant (against ces-ao)

- **Filed from:** ces-eo, 2026-09-27 (FC-EO-C, step AO-16)
- **Target:** `ces-ao/src/execution/VerifiedApprover.ts` (`verifyApproverToken` / `decideApprovalAsVerifiedPrincipal`)
- **Status:** DONE (2026-09-28, verified by FC-EO-H) — ask 1: `ces-ao` commit `f3f89fb` (FC-AO-2 step 1,
  `TOKEN_TENANT_MISMATCH`, `test/approverTenantBinding.test.ts`, 15 tests). Asks 2 and 3: `ces-ao` commit
  `6c51626` (FC-AO-3 steps 1 and 3 — `APPROVER_ROLE_REQUIRED` gate requiring `ao-approver`, and
  `approverTokenId` recorded from `RequestPrincipal.tokenId`; `test/approverRoleRequired.test.ts` (11),
  `test/approverTokenId.test.ts` (6)). Re-verified by reading both commits' diffs and tests directly.

## Context

EvidenceOps now mints AdminOps approver tokens (`ces-eo/src/eo/approver-tokens/ApproverTokenIssuer.ts`,
route `POST /api/approver-tokens?tenant=<slug>`). Each token is tenant-scoped: its `tid` claim is the
tenant GUID the BHD operator minted it for, and it carries `roles: ['ao-approver']` and `jti` = the
mint id recorded in EO's evidence log (`eo_approver_token_mints`).

## Problem

`verifyApproverToken` checks signature, expiry and optional iss/aud, but never compares the token's
`tenantId` (`tid`) with the tenant of the approval being decided. A token minted for tenant A can
therefore approve a Tier-3 request on tenant B, which defeats the tenant scoping the founder asked
for (decision 7, 2026-09-27).

## Ask

1. In the approval decision path, refuse when the verified principal's `tenantId` is missing or
   differs from the approval's tenant GUID (fail closed; new refusal reason, e.g. `TOKEN_TENANT_MISMATCH`).
2. Optional hardening: require `roles` to include `ao-approver`, so a principal token minted for any
   other purpose with the same secret cannot approve.
3. Record the token's `jti` on the approval decision evidence so each decision links back to its
   EO mint record.

## Acceptance

A ces-ao test mints with ces-shared `signPrincipalToken` (or EO's issuer) for tenant A and shows the
decision is refused for a tenant-B approval and accepted for a tenant-A approval.
