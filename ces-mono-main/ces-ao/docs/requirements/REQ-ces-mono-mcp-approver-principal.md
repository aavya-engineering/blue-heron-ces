# REQ: ces-mono root MCP launcher — approver principal for `ao_approve` (from ces-ao, FX2-AO1, 2026-09-27)

**Target:** the ces-mono root `.mcp.json` (`ces-adminops` entry) and whoever operates AdminOps approvals.
**Filed by:** ces-ao, fix round 2 (FX2-AO1). ces-ao did not edit the root file (write boundary).

## What changed in ces-ao
- MCP `ao_approve` now takes `{ approvalId, principalToken }`. The token is the approving person's own signed
  principal token (HS256, `ces-shared/http/principal`), verified with `CES_AO_PRINCIPAL_SECRET` from the MCP
  server's env. A typed `approverUPN` is refused. There is no server-env token fallback.
- `mcp/ao-mcp-server.mjs` is now transport only and imports `dist/mcp/aoMcpTools.js`. **Run `npm run build` in
  ces-ao before launching it**, or the server fails to start.

## Requirement
1. When the launcher is ever run with `AO_MCP_ALLOW_APPLY=1` (today it is `"0"`, so `ao_approve` is blocked
   anyway), its `env` must also set `CES_AO_PRINCIPAL_SECRET` (>= 16 chars; optionally `CES_AO_PRINCIPAL_ISSUER` /
   `CES_AO_PRINCIPAL_AUDIENCE`). Otherwise every approval is refused with
   "CES_AO_PRINCIPAL_SECRET is not configured".
2. The secret must be a deployment secret, not a value committed in `.mcp.json`. Inject it from the operator
   environment.

## Open founder decision (blocks CLI and MCP approvals in practice)
No production token issuer exists today. `signPrincipalToken` is called only from tests and scripts, and the web UI
takes a pasted token. So approver tokens can only be minted by whoever holds `CES_AO_PRINCIPAL_SECRET`. Two things
need a decision: who holds the secret, and how each approver gets their own token (for example an Entra-backed
verifier implementing the same `PrincipalVerifier` shape). Until then, CLI and MCP approvals are refused by design.
