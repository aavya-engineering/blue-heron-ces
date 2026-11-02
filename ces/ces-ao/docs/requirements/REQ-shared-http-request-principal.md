# REQ-shared-http-request-principal

**Target module:** ces-shared (`src/http/bearerAuth.ts`)
**Filed by:** ces-ao (2026-09-27 fix batch, FX-AO4)
**Date:** 2026-09-27
**Priority:** P2 (does not block the sim flow; blocks a real "authenticated approver")

## What

`createBearerAuthMiddleware` authenticates the *service* (one shared bearer token, loopback
trusted) but attaches no per-user principal to the request. So ces-ao's two-person approval
has no authenticated identity to bind to: `POST /api/approvals/:id/decision` has to take
`approverUPN` from the request body, and the separation-of-duties check compares two
free-text UPNs.

## What ces-ao already does (FX-AO4)

- The execute path takes the approver ONLY from the approval record
  (`consumedApproval.approverUPN`); a request-supplied `approverUPN` is ignored and logged.
  Test: `test/fixBatch.routes.test.ts` ("FX-AO4").
- The approval record's approver is still whatever the decision request claimed.

## Proposed addition

Expose an authenticated principal on the request (e.g. `req.cesPrincipal = { upn, source }`)
from a verified identity (Entra ID token validation, or a per-user signed token), with a
loopback/dev mode that is explicitly marked unauthenticated. ces-ao would then take the
approver (and requestor) from `req.cesPrincipal.upn` and reject body-supplied values.

## Acceptance test

A request carrying a verified principal `approver@x` and body `approverUPN: other@x` to the
decision route records `approver@x`; a request without a verified principal is refused
(outside the explicit dev mode).
