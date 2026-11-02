# CES SaaS / Multi-Tenant Hosting — Readiness Spike (design only)

**Date:** 2026-06-14 · **Status:** spike (no build) · **Goal:** G14 P3 · **Gate:** business demand.

CES today is **operator-local**: the EO/AO Express servers and the Stamper engine run on a single
operator workstation; persistence is a local SQLite `ces.db` + local blob/file artifacts; the Planner is
an offline browser SPA. This spike maps what moving to a **hosted, multi-tenant SaaS** would require —
what already helps, what's missing, and a phased path. It is a direction, not a commitment.

## What already helps (foundations in place)
- **Tenant-scoped persistence (G2):** `CesRepository` requires a scope on every read and throws on empty
  scope — the core isolation primitive a multi-tenant service needs already exists.
- **Identity model (G1):** CES tuple (customer/SI/tenant) + customer↔tenant binding gives stable
  cross-system tenant keys.
- **Secret references (G1/T6, G8 strict mode):** creds already externalizable to `env:`/`${}`; strict
  mode can forbid inline secrets — a step toward managed-identity/Key Vault secret sourcing.
- **Stack-provider seam (G4/G7):** per-tenant stack selection is already config-driven.
- **Env-gated auth (G8):** EO bearer-token middleware is a placeholder seam to swap for a real IdP.

## What multi-tenant hosting requires (gaps)
| Area | Today | Hosted requirement |
|---|---|---|
| **AuthN/Z** | env-gated shared bearer token (G8) | Real IdP (Entra ID/OAuth2/OIDC), per-user + per-tenant RBAC, token issuance/rotation |
| **Secrets** | secret refs from env | Central secret store (Key Vault) + workload/managed identity; no per-tenant secrets on disk |
| **Persistence** | one local SQLite `ces.db` | Per-tenant isolation at scale: either DB-per-tenant or a server RDBMS (Postgres) with row-level tenant scoping enforced (extend the existing scope guard) |
| **Evidence storage** | local blob/file artifacts | Per-tenant cloud containers with WORM (G10) + Key Vault signing (G11); lifecycle/retention policy |
| **Compute** | local Express + PowerShell sessions | Containerized services; PowerShell execution sandboxed per tenant (the heaviest lift — Stamper/EO run live cmdlets) |
| **Networking** | localhost | TLS, per-tenant routing, egress controls to `.microsoft.us` |
| **Tenancy lifecycle** | manual | Onboard/offboard, quotas, audit, billing hooks |
| **Observability** | console/logs | Central logging/metrics/tracing per tenant |
| **Compliance of CES itself** | N/A | A CUI-handling SaaS in GCC High likely needs its own authorization posture (FedRAMP/CMMC) |

## The hard part
**PowerShell execution.** Stamper/EO run live Microsoft cmdlets against customer tenants using
certificate auth. In a hosted model this becomes per-tenant sandboxed execution with delegated/managed
credentials — a security-sensitive redesign, not a lift-and-shift. This, plus CES's own CUI-handling
authorization, are the gating constraints.

## Phased path (suggested)
1. **Containerize** EO/AO/Stamper as services; keep single-tenant per deployment (managed-hosting MVP).
2. **Externalize state**: move `ces.db` to Postgres with enforced row-level tenant scoping; evidence to
   per-tenant cloud storage with WORM (G10) + signing (G11).
3. **Real IdP + RBAC** replacing the G8 bearer seam; secrets via managed identity/Key Vault.
4. **Per-tenant sandboxed execution** for PowerShell; quotas + observability.
5. **CES platform authorization** (FedRAMP/CMMC for the service itself) to host CUI.

## Recommendation
Defer the build; the operator-local + managed-service model is sufficient for early customers and
matches the current GTM. Revisit when customer demand justifies the (substantial) investment, and do
**G10/G11** first — they are prerequisites for credible hosted evidence storage anyway.
