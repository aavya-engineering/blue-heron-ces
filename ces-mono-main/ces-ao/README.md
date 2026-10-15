# ces-ao — AdminOps

Governed AdminOps for CMMC L2 tenants. A registry of **95 commands** (`src/registry/ao-commands.registry.json`)
runs against **M365 / Azure GCC High** through one headless engine, exposed by **three surfaces**: a CLI, an
HTTP GUI, and an MCP server. Package `ces-ao` v0.1.0; bin `ao`.

## Purpose

- **Separation of duties.** Tier-3 commands cannot be executed by one person — they open a two-person approval.
- **dryRun by default.** Every execution previews the exact command that would run; a live write is opt-in.
- **get-then-set write pattern.** A command reads current state before mutating, and emits that pre-state as evidence.

## Run

Build first (`npm run build`, compiles TS to `dist/`).

**CLI** — `ao` (dryRun is the default; `--apply` performs a LIVE write):

```
ao list [--domain X] [--tier "Tier 3"] [--cmmc AC.L2-3.1.5] [--json]
ao show <commandId>
ao exec <commandId> --tenant <slug> [--param key=value ...] [--apply]
ao approvals [--status pending|approved|rejected|executed]
ao approve <approvalId> [--principal-token <token>] [--reject --reason <text>]
```

A Tier-3 `exec` returns `pending_approval` with an `approvalId` instead of running. After a second person runs
`ao approve`, re-run `ao exec <id> --approval <id> --apply --requestor <upn> --tenant <slug>`.

**Approver identity (FX2-AO1).** On every surface (web, CLI, MCP) the approver is a *verified principal*, never a
typed name. Operator setup: the deployment sets `CES_AO_PRINCIPAL_SECRET` (>= 16 chars; optionally
`CES_AO_PRINCIPAL_ISSUER` / `CES_AO_PRINCIPAL_AUDIENCE`), the same secret the web route verifies `x-ces-principal`
tokens with. The approving person gets their own signed principal token from the same issuer as the web sign-in and
sets `CES_AO_PRINCIPAL_TOKEN` (or passes `--principal-token`). The recorded approver is the token's UPN. `--approver`
is refused; no token, no secret, a bad or expired token, or the requestor's own token are all refused, and the
approval stays pending.

**GUI** — `ao gui --port <n>` (default port **3000**), served by `src/server/AoServer.ts` at `http://localhost:<n>`.

**MCP** — `mcp/ao-mcp-server.mjs` (stdio JSON-RPC), wrapping the same engine. Tools:
`ao_list_commands`, `ao_get_command`, `ao_execute`, `ao_approvals`, `ao_approve`.
Live writes are **HARD-BLOCKED** unless the env `AO_MCP_ALLOW_APPLY=1` is set; otherwise a requested
`dryRun:false` is silently downgraded to a safe preview, and `ao_approve` is refused.
`ao_approve` takes `{ approvalId, principalToken }`: the approving person's own signed principal token, verified with
`CES_AO_PRINCIPAL_SECRET` in the server's env. A typed `approverUPN` is refused, and there is no server-env token
fallback. Tool behaviour lives in `src/mcp/aoMcpTools.ts` (the `.mjs` is transport only), so build before starting it.

## Test

```
npm test                # vitest run
npm run test:coverage   # vitest run --coverage  (~88% lines)
```

## The approval model

The standout control. When a Tier-3 `exec` is requested, an approval record is created and **bound to a
canonical SHA-256 hash of its exact parameters**. The approval is:

- **Parameter-locked** — the hash is re-checked immediately before the live write; executing with any different
  inputs requires a brand-new request.
- **Single-use** — one approval authorizes one execution.
- **Two-person** — the approver is a verified principal (signed token) whose UPN must differ from the requestor UPN
  (SoD enforced at decision time). No path accepts a typed approver name (FX2-AO1).

## Security note — auth model (G-ENG-4)

**Loopback is trusted; the network requires a token.** The `/api/*` surface is guarded by the
shared CES bearer-auth middleware:

- **`CES_AO_AUTH_TOKEN` unset** → `/api/*` is served to **loopback only** (127.0.0.1 / ::1); any
  other address is rejected `401`. Local dev is zero-friction and the server is never silently
  network-exposed.
- **`CES_AO_AUTH_TOKEN` set** → every `/api/*` request must carry `Authorization: Bearer <token>`.

## Sim-only by default (FX-AO2, 2026-09-27)

Every execution path (web, CLI, MCP; dry-run included) passes the sim-only rail first:

- A `kind: 'sim'` tenant runs only if all its endpoints are loopback (stacksim).
- Any other tenant is **refused with a `denied_sim_only` evidence row** unless
  **`CES_AO_ALLOW_LIVE=1`** is set **and** the tenant record is explicitly `kind: 'live'`.
- `CES_AO_SIM_ONLY=1` refuses every non-sim tenant, even with the opt-in.

The startup log states which auth mode is active. These network safeguards are in addition to
**dryRun-by-default** and the **separation-of-duties approval gate** (which remain the controls for
the privileged actions themselves).

## Evidence

Every execution emits **StructuredEvidence** carrying a SHA-256 hash and a satisfaction verdict
(**SAT / NOT_SAT**) plus the command executed and the get-then-set pre-state — the audit record for each action.
