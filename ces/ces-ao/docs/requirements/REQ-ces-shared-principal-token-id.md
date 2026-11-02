# REQ-ces-shared-principal-token-id — expose the token id (`jti`) on the verified request principal

- **From:** ces-ao (FC-AO-2 step 1, 2026-09-28)
- **To:** ces-shared (`src/http/requestPrincipal.ts`: `RequestPrincipal`, `createHs256PrincipalVerifier`)
- **Status:** CLOSED (2026-09-28, FC-AO-3) — ces-shared 2.8.0 ships `tokenId?: string` on `RequestPrincipal`
  (`src/http/requestPrincipal.ts`), populated from `jti` by `createHs256PrincipalVerifier`, matching this REQ's
  acceptance exactly. FC-AO-3 step 3 consumes it: `VerifiedApprover.verifyApproverToken` carries it through, and
  `ApprovalStore.recordApprovalDecision` persists it as `approverTokenId` on every decision.
- **Related:** `ces-eo/docs/requirements/REQ-ces-ao-approver-token-tenant-binding.md` ask 3

## Context

EvidenceOps mints AdminOps approver tokens with `jti` = the mint id recorded in its evidence log
(`eo_approver_token_mints`). ces-eo's REQ asks AO to record that `jti` on each approval decision, so every decision
links back to its mint record. FC-AO-2 made AO's approval decisions tenant-bound (the token's `tid` must equal the
approval's tenant, on web, CLI and MCP) and records `approverTenantId`, but it cannot record the `jti`: the HS256
verifier discards every claim that is not on `RequestPrincipal` (sub/oid, upn, name, roles, tid, exp).

## Ask

Add an optional `tokenId?: string` to `RequestPrincipal`, populated from a string `jti` claim by
`createHs256PrincipalVerifier` (and by any future Entra verifier). AO will then persist it as `approverTokenId` on the
approval and its decision evidence. AO should not decode the JWT a second time itself.

## Acceptance

A ces-shared test signs a token with `jti: 'mint-1'` and the verified principal carries `tokenId: 'mint-1'`.
