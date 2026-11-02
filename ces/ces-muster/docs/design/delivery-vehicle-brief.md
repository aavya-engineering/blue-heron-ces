# Delivery-vehicle brief — how a contractor runs Muster and gets results

**Date:** 2026-07-25 · **Prepared under:** GP-MUSTER-1 M3 (paper, not code)
**Decision owed:** founder ruling on the delivery vehicle (master plan D8);
the ruling becomes GP-MUSTER-2.

> **RULED (founder HIL, 2026-07-25 — FD-DELIVERY-VEHICLE, closes master plan
> D8): Option C — operator-run with portal delivery, SaaS (A) as the
> destination.** Scope ratified as proposed below; the brief's three open
> questions (portal hosting locus, offline self-serve SPA policy, retention
> period) remain open and are carried as HIL gates in
> `docs/goals/GP-MUSTER-2.md`.
**Standing requirement it serves (founder, 2026-07-25):** "a secure and easy way
for users to use Muster and get results from it" — delivery UX is part of the
goal, not an afterthought.

## What exists today (the ground every option stands on)

- **The SPA is offline-first and tenant-blind.** All assessment state lives in
  the browser (Dexie/IndexedDB); imports and exports are local files
  (readiness-result.v1 is THE import format — one schema, four producers). It
  never touches tenants, tokens, or registries (`TENANT-CONNECTION.md`).
- **muster-api is already a multi-tenant SaaS skeleton**, not a stub: Prisma
  models `Tenant`/`User`/`Engagement`/`Party`/…, JWT auth middleware, RBAC and
  row-level-security enforced by tests (`rbac.matrix.test.ts`, `rls.test.ts`),
  15 route groups. It brokers ALL tenant-facing work and now owns the
  DISCOVERY-1 executor (Gates 1–3, 5 passed; live parity awaits FD-LIVE-SMOKE).
- **Discovery requires a Windows/PowerShell runtime** (Stamper registries run
  `Get-Mg*` through powershell.exe via ces-tenant sessions) — wherever discovery
  executes, that runtime must exist. The SPA never needs it.
- **The auth ladder is designed and partially proven** (residual-elicitation
  ladder): device-code (minutes, deal-proven) → admin-runs-script + upload (CES
  never holds credentials) → "lite" posture reads → cert app-only (post-deal,
  remediation-time). Per-command degradation is now recorded honestly
  ("unavailable at this auth tier", Gate 2).
- **The result is FCA-weight sensitive.** A readiness result feeds the SSP
  chain; manifest carries operator/tenant identity. Delivery must treat the
  payload like CUI-adjacent material regardless of vehicle.

## The three candidates

### A. Hosted multi-tenant SaaS (muster.bhd cloud)

One hosted SPA + muster-api + DB; contractors sign in, run assessments, results
live in their tenant rows; discovery runs from BHD-operated Windows workers
against the customer tenant at whatever auth tier the customer grants.

- **Security:** weakest story of the three *for the trust we can claim today*.
  BHD holds every customer's readiness data at once (aggregation risk: one
  compromise exposes many DIB companies' gap lists — an attack map). Needs real
  hardening (the RLS/RBAC tests are necessary, not sufficient), likely a
  GCC-adjacent hosting posture to be credible to this market, plus consent
  flows for BHD-side discovery. The tenant-blind SPA advantage is partially
  surrendered: the browser now talks to a server that holds results.
- **Friction:** lowest for the customer (URL + login; device-code consent when
  discovery runs). Highest for BHD ops.
- **Cost:** highest — hosting, hardening, monitoring, incident posture, and the
  compliance optics of holding other people's assessment data.
- **Time-to-first-customer:** months. The skeleton exists, but "we hold your
  gap list" demands the security work BEFORE customer one, not after.

### B. Per-engagement provisioned instance

Each engagement gets its own short-lived instance (a VM/container bundle:
SPA + muster-api + local DB + PowerShell runtime), provisioned at kickoff,
destroyed at close-out; results delivered from inside the instance.

- **Security:** strong isolation — no aggregation risk, blast radius = one
  engagement; matches the "enclave per engagement" instinct. But every instance
  is a little server BHD must patch/secure for its lifetime, and secure
  DESTRUCTION becomes part of the story.
- **Friction:** medium for the customer (wait for provisioning, get access);
  high for BHD until provisioning is automated (which is its own project).
- **Cost:** medium-high, scaling linearly with engagements; the automation to
  make it cheap is real engineering that serves delivery, not product.
- **Time-to-first-customer:** weeks-to-months, gated on provisioning automation
  nobody has started.

### C. Operator-run with portal delivery (recommended)

Muster stays where it already runs — BHD's own operated environment (the
existing enclave posture). An engagement is a SESSION run by or with a BHD
operator: collaborative-bhd mode on a call (device-code consent, minutes), or
independent mode via the admin-runs-script + upload rung (CES never holds
credentials). Results delivery is the only new surface: a small, hardened
portal (or even signed-link delivery) where the contractor downloads their
readiness report/result — per-engagement access, short-lived credentials,
audit-logged, nothing browsable across engagements.

- **Security:** best near-term story. Data at rest stays in BHD's existing
  enclave posture; the only internet-facing surface is a narrow download portal
  holding one engagement's artifacts under per-engagement auth. The SPA stays
  tenant-blind; discovery runs on BHD's Windows infrastructure where the
  PowerShell runtime already lives. The manifest's three modes
  (self-hosted / independent / collaborative-bhd) already model exactly this.
- **Friction:** low for the customer in collaborative mode (join a call,
  approve a device code, receive a link); the script-upload rung serves
  security-conservative customers with zero credential handover. BHD does more
  per engagement — acceptable at early-customer volume, and every session
  doubles as discovery-of-the-product.
- **Cost:** lowest new engineering: the product already works this way; the
  portal is a small, well-bounded build (auth + object storage + audit log).
- **Time-to-first-customer:** shortest — plausibly days-to-weeks after the
  portal exists; the collaborative flow needs nothing built to start a pilot
  (delivery by existing secure channel while the portal lands).

## Scorecard

| | Security | Friction (customer) | Cost | Time-to-first-customer |
|---|---|---|---|---|
| A. Multi-tenant SaaS | Low-Med (aggregation risk) | **Low** | High | Months |
| B. Per-engagement instance | **High** (isolation) | Med | Med-High | Weeks-Months |
| C. Operator-run + portal | **High** (enclave + narrow portal) | Low-Med | **Low** | **Days-Weeks** |

## Recommendation

**C now, with A as the destination.** C is the only option that ships to a first
customer on the strength of what exists; every C engagement exercises the exact
machinery A would host (same SPA, same muster-api, same auth ladder), so nothing
built for C is throwaway. The muster-api SaaS skeleton (Tenant/JWT/RBAC/RLS)
keeps A open as volume justifies the hardening investment; B's isolation
property can be grafted onto A later (per-tenant DB/instance sharding) if the
market demands it. The portal built for C becomes A's delivery surface.

**If C is ratified, GP-MUSTER-2 scopes:** (1) the delivery portal (auth model,
storage, audit, retention/destruction policy); (2) the collaborative-bhd session
runbook (device-code consent script, operator checklist); (3) the script-upload
kit for independent mode (signed, human-readable collector — the ladder's rung
2); (4) result-handling policy (encryption at rest, who can pull, how long it
lives).

**Open questions for the ruling:** hosting locus of the portal (enclave-adjacent
vs commercial cloud); whether independent-mode customers may self-serve the SPA
offline (it already works offline — policy call, not engineering); retention
period for delivered results.
