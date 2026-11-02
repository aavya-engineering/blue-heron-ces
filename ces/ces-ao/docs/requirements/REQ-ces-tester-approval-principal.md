# REQ-ces-tester-approval-principal — AO approval decisions now require an authenticated principal

- **From:** ces-ao (W4-AO3, 2026-09-27, commit `a9e7f5b`; UI half `4ba1da0`)
- **To:** ces-tester (AO UI driver, AO-OPS-SIMSTACK suite, flow tests that drive Tier-3 ops)
- **Status:** OPEN (breaking change on ces-ao's side is committed)

## What changed

`POST /api/approvals/:id/decision` is guarded by ces-shared's `requirePrincipal` (W4-SH1, `ces-shared/http/principal`).
- **The approver is the authenticated principal.** A body `approverUPN` is ignored.
- **A decision without a verified principal gets 401, and nothing is recorded.** This covers today's pattern: body
  `approverUPN` and no token.
- **If the AO server has no principal configuration, every decision gets 401** (fail closed).
- **`POST /api/execute/:id` accepts an optional token.** When a token is sent it must verify, or the request gets 401.
  The requestor is then the principal, and a differing body `requestorUPN` is ignored.
- **Without a token, execute works as before.** The body `requestorUPN` is used.

## How to authenticate in a sim run

1. Put `CES_AO_PRINCIPAL_SECRET=<16+ chars>` in AO's child env. `CES_AO_PRINCIPAL_ISSUER` and
   `CES_AO_PRINCIPAL_AUDIENCE` are optional.
2. Sign one token per person with `signPrincipalToken({ sub, upn }, { secret })` from `ces-shared/http/principal`.
3. Send the token as header `x-ces-principal`.
   - **API:** put the approver's token on the decision request, and optionally the requestor's token on execute.
   - **UI:** type the approver's token into `[data-testid=approver-token]`. `docs/contracts/AO-UI-TEST-HOOKS.md` has the
     full Tier-3 round trip.
4. **Loopback-only alternative:** `CES_AO_DEV_PRINCIPAL_UPN=<upn>` gives an explicit, unverified dev principal.
   - It is ONE identity, so it can approve only requests whose requestor is a different UPN. Send that requestor's UPN
     in the body, with no token.
   - Never use it in a deployment.

## Why

W4-AO3 (Wave 4 instructions): the persisted approver must be an authenticated identity, not free text, and a requester
cannot approve their own Tier-3 request.

## Acceptance test

A ces-tester Tier-3 flow (API or UI) completes pending → approve → execute against a ces-ao server started with
`CES_AO_PRINCIPAL_SECRET`. The executed `adminops_evidence` row's `approverUPN` equals the UPN in the approver's token.
