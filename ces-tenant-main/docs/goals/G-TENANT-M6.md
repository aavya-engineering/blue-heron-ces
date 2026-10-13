# G-TENANT-M6 — The Stateful Tenant Service (auto-connect + connection observability)

**Type:** `/goal` · **Date:** 2026-07-10 · **Status:** QUEUED (after M1; runnable parallel to
M2–M5 adoption; modules flip to it by configuration as they adopt)
**Provenance:** founder-directed 2026-07-10 — "ces-tenant should be stateful such that the
modules can auto-connect if ces-tenant is up and has a connection. ces-tenant should show
connection status and activity by module and connection service." Assessment accepted same
day; this goal is that write-up.
**Canonical design:** `ces-stamper/docs/design/tenant-manager-extraction.md` (the extraction
this builds on; M0 interfaces ratified 2026-07-10). **Precedent:** tenant-stacksim's
single-writer `serve` (one process owns state; consumers speak localhost HTTP) — the same
shape, proven in-family.

---

## Objective

ces-tenant grows a second delivery mode: a **local, per-user, stateful service** (daemon)
that implements the SAME ratified TenantManager interfaces as the in-process library.
When the service is up and holds a connection to a tenant:

1. **Auto-connect** — any CES module asking for that tenant gets the existing connection
   instantly: no re-authentication, no second device-code prompt, no new PowerShell session
   spin-up. One sign-in per engagement, shared by Muster, Stamper, EO, AO, and ces-tester.
2. **Observability** — the service exposes (API + simple status view) connection status and
   activity **by module and by connection service**: which tenant, which auth tier, which
   engine sessions are alive (Graph / Exchange / Purview / Azure / SharePoint / Teams),
   which module is doing what, when, with a per-request activity ledger.

## Why (the economics)

Authentication is the expensive, HUMAN part of connecting: a delegated device-code sign-in
with multi-factor cannot be silently re-minted. Without the service, each module pays it
separately — Muster for discovery, Stamper for execution, EO for assessment; same tenant,
same hour, three sign-ins. With it: one. The activity ledger is not a dashboard nicety —
"which module ran what against which tenant, when, over which service" is PROVENANCE, the
same ledger discipline stacksim already applies to sim traffic, extended to live
connections. It feeds the evidence story.

## Design requirements

1. **Same interfaces, second implementation.** The daemon implements the ratified M0
   TenantManager interfaces behind the already-defined HTTP surface. Consumers do not code
   against "the daemon" — they code against TenantManager; a config/discovery step selects
   in-process vs service transport. No consumer rework when flipping.
2. **Auto-connect semantics:** module requests tenant X → service has a live connection →
   hand it over (scoped by the module's requested access tier; a read-only consumer never
   inherits write scope). Service lacks it → module may request the service establish one
   (which may surface an interactive auth step to the human) OR fall back to in-process
   connect. **Degrade, never block:** if the service is down, every module works exactly as
   it does today via the library path.
3. **Session ownership:** engine sessions (persistent powershell.exe children) are OWNED by
   the service in service mode; modules proxy commands through it (single-writer pattern).
   Phase option (smaller first step, decide at planning): the service holds AUTH STATE only
   (tokens, cert context, device-code sessions) and modules run their own engine processes
   without re-auth — most of the win, far less plumbing. The goal's planning stage must
   pick one for v1 and state why.
4. **Caller identity is mandatory** (interface amendment, rides with G-TENANT-1): every
   connection/session request carries `consumer: { module, purpose }`. Without it,
   activity-by-module is impossible. This amendment lands BEFORE M1 consumers wire up —
   cheap at interface time, painful later.
5. **Security posture — the daemon is the most sensitive process on the machine.** It holds
   live authenticated sessions. Constraints: binds localhost only, per-OS-user, never
   network-exposed, no credential material in its API responses (hand out session handles/
   proxied execution, never raw tokens where avoidable), activity ledger append-only.
   Crash/lifecycle: health endpoint; consumers detect death and fall back (see 2).
6. **Status/activity surface:** queryable API + a minimal human view (console table or
   single self-contained HTML status page — house style): per tenant [kind live|sim, auth
   tier, connected-since] × per engine service [session state, last activity] × per module
   [what it ran, when]. kind:'sim' connections appear identically — ces-tester's runs are
   first-class activity.

## Non-goals

- Not a network/remote service, ever, in this goal's scope.
- Not a replacement for the library mode — both ship, config-selected.
- No business logic, registries, or evidence handling migrate into the service (the §3
  scope fence of the extraction design holds here too).

## Preconditions / queue position

- **After M1** (the library extraction must exist — the service wraps it, not forks it).
- The caller-identity + status-surface interface amendment ships with **G-TENANT-1**
  (see that goal's 2026-07-10 addendum) so M1–M5 consumers wire it once.
- Runnable parallel to M2–M5 adoptions; each module flips to service transport by config
  whenever it adopts — no coordinated cutover needed.

## Acceptance gate (objectively checkable)

1. Same test suite passes against BOTH implementations of the TenantManager interfaces
   (in-process and service transport) — the interface contract tests run twice.
2. Demonstrated auto-connect: two different module processes obtain the same tenant
   connection with exactly ONE interactive auth event between them.
3. Kill-the-daemon test: with the service down, a module's connect succeeds via library
   fallback with no code change.
4. Activity ledger shows per-module, per-service entries for a scripted two-module run;
   ledger is append-only; no raw credential material appears in any API response (grep-able
   assertion).
5. Status view renders the tenant × service × module matrix for at least one live-kind and
   one sim-kind tenant.

## Open decisions (resolve at this goal's planning stage)

1. v1 session ownership: full session proxy vs auth-state-only (requirement 3).
2. Service lifecycle: started explicitly by the first module that wants it, or a user-run
   command only (`ces-tenant serve`, mirroring `stacksim serve`)?
3. Status view: console vs HTML page for v1.

---

## RESOLUTION 2026-07-11 — open decision 1 DECIDED: v1 = auth-state-only

Founder decision 2026-07-11 after tradeoff review: **the v1 daemon holds AUTH STATE only**
(tokens, certificate context, delegated device-code sessions). Modules skip the sign-in
ceremony when the daemon has credentials for the tenant, but run their own engine worker
processes exactly as today. The full session proxy (daemon-owned PowerShell workers,
command proxying, centrally-enforced ledger) is explicitly deferred as a possible v2 —
adopt it only if warm-session sharing or enforced central ledgering proves necessary in
practice. Requirement 3's "decide at planning" is therefore pre-decided; design planning
proceeds from auth-state-only. Activity ledger in v1 is self-reported via the caller-
identity amendment (landed, commit f9d75b4) — state this honestly in the status view.
Open decisions 2 and 3 (service lifecycle; status view form) remain for this goal's
planning stage.
