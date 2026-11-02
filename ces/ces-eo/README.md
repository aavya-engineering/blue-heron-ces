# ces-eo — EvidenceOps

`ces-eo` v0.1.0. Continuous compliance evidence collection and drift monitoring for CMMC L2 on
M365 GCC High.

## Purpose

EvidenceOps turns compliance signals and Stamper directives into audit deliverables:
**SSP.docx**, **POA&M.docx**, and **Evidence.zip**. It runs assessment in **dual mode** — a legacy
PowerShell flow and a live Microsoft Graph flow (`GET /api/assess?mode=live|legacy`, GCC High
`graph.microsoft.us`) — and captures configuration data as evidence artifacts when a control passes.

On top of raw assessment it maintains the **DeterminationLedger** — one unified per-objective spine
that is the single source of truth for each control objective — plus an auto-close **POA&M
lifecycle**, **persona views** (assessor / operator / owner projections), and an **assessor
determination viewer** that renders per-objective determinations linked to their evidence.

## Run

Prereqs: `npm install`, then `npm run build` for the compiled path.

- Dev (tsx, no build): `npm run dev:eo`
- Start (compiled): `npm run start:eo`

The server (`createEoServer` in `src/eo/server/EoServer.ts`, entry `src/eo/index.ts`) listens on
`EO_PORT` (default **4002**): `http://localhost:4002`. It consumes the control registry at
`REGISTRY_PATH` and resolves per-tenant config from `~/.stamper/tenants/{slug}.json` (selected via
`TENANT_SLUG` / `ACTIVE_TENANT_SLUG`, falling back to the last-used tenant).

## Test

- `npm test` (Jest, no coverage)
- `npm run test:coverage` (coverage)

The **golden SSP reference test** (`tests/ssp/ssp-golden-reference.test.ts`) is the safety net: it
pins generated SSP output against a known-good fixture so document drift fails the build.

## Config

`EoConfig` (`src/eo/config/EoConfig.ts`) is **Zod-validated at startup** and **throws** on invalid
input (e.g. missing `REGISTRY_PATH`, or an `ACTIVE_TENANT_SLUG` with no matching tenant file). Main
environment variables:

| Var | Purpose |
| --- | --- |
| `EO_PORT` | Listen port (default `4002`). |
| `REGISTRY_PATH` | **Required.** Control registry path. |
| `TENANT_SLUG` / `ACTIVE_TENANT_SLUG` | Active tenant; resolves `~/.stamper/tenants/{slug}.json`. |
| `STORAGE_ROOT` | Artifact/output storage root (defaults to the EvidenceOps module store). |
| `GRAPH_SCOPES` | Comma-separated Graph scopes (default `https://graph.microsoft.us/.default`). |
| `CES_EO_AUTH_TOKEN` | Optional bearer token that enables the `/api/*` auth gate (see below). |

Related optional vars: `TENANT_CONFIG`, `INFRA_REGISTRY_PATH`, `MISSION_PLAN_PATH`,
`TENANT_MANIFEST_PATH`, `INFRA_MANIFEST_PATH`, `COMPLIANCE_REPO_PATH`, `CES_EO_TENANT`.

**Evidence Collector (EC) wiring (M4a):** `EC_URL` (default `http://127.0.0.1:4001`) is the base
URL of the standalone EC service; EO's `/api/ec/health|runs|findings` proxy to it and the "Evidence
Collector" page/upload form read/write through those proxies. `EVIDENCE_OPS_SECRET` is the bearer
EO attaches server-side to EC's authenticated routes (`/api/items`, `/api/ingest`) — the browser
never sees it. Unset => manual-evidence reads return empty and uploads are refused (503), matching
EC's own fail-closed behaviour; `/api/ec/health|runs|findings` stay reachable and simply reflect
whatever EC itself reports (including its own `degraded` state).

## Security note — auth model (G-ENG-4)

**Loopback is trusted; the network requires a token.** The `/api/*` surface is guarded by the
shared CES bearer-auth middleware:

- **`CES_EO_AUTH_TOKEN` set** → every `/api/*` request must carry `Authorization: Bearer <token>`
  (loopback included), with optional `CES_EO_TENANT` pinning. This is the production posture.
- **`CES_EO_AUTH_TOKEN` unset** → `/api/*` is served to **loopback only** (127.0.0.1 / ::1); a
  request from any other address is rejected `401`. So local development is zero-friction (no token
  to set) and the server is **never silently exposed on the network** without one.
- Non-`/api` paths (GUI, static assets) are always open.

The startup log states which mode is active. Inter-module calls over localhost (e.g. Stamper →
`/api/stamp-capture`) work without a token in the common single-host case.

## API surface

`EoServer.ts` registers roughly **104 routes** — assessment (`/api/assess`), SSP/POA&M generation,
personnel, risk-assessment, policies, artifacts, tenant-config, ledger/persona/viewer, and more.
There is **no API versioning yet** (no `/v1` prefix); route paths are unversioned.
