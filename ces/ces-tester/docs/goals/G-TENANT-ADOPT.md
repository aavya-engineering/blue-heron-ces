# Goal Document — G-TENANT-ADOPT

**Provenance:** Founder-directed. M0 interface gate passed 2026-07-10 (founder review of
`ces-tenant`'s `src/*.ts` interfaces: approved as ratified). ces-tester promoted to named
consumer by founder direction 2026-07-10 ("ces-tester needs a tenant too") — this is the concrete
adoption brief for that promotion. Authored 2026-07-10, distributed from the `ces-strategy` session
that executed the M0 interface work. Self-contained — a fresh session in this repo needs nothing
outside this file, this repo's own `PLAN.md`, and `ces-tenant`'s `README.md` + `src/*.ts`
(read-only, in the sibling repo).

## Job

ces-tester's orchestrator needs to create, query, and tear down ephemeral sim tenants per scenario
run, and needs the sim launch-context env bundle its `stamper-launcher` injects when spawning
Stamper. Because ces-tester was named a consumer at M0 time (not left for a later milestone), four
interface members in `ces-tenant` exist specifically to answer these needs from day one — this
goal is: **consume them**, rather than build any version of this logic locally. Per the design
doc's per-consumer requirement for ces-tester: "the test orchestrator consumes the registry from
day one rather than growing its own variant... Must not pre-build bespoke session/auth/config-path
logic — consuming these interfaces IS its tenant story" (design §6).

This repo's own `PLAN.md` (M1 tasks 2-4, Interface Contract Summary table) already names the exact
behaviors this goal wires up — this brief maps each of those needs to the specific `ces-tenant`
interface member that answers it.

## Must-NOTs (scope fence)

- Do not write any bespoke tenant/session/auth/config-path logic in this repo, ever, at any
  milestone — not "for now," not "as a stopgap until ces-tenant is ready." If `ces-tenant`'s
  implementation is not ready when this repo needs a capability, that is a blocking dependency to
  surface (see Preconditions), not a license to hand-roll a temporary version. This is the exact
  duplication pattern (Stamper → ces-eo → muster-api, three independent implementations of the same
  problem) the whole extraction exists to end (design §1) — a fourth independent implementation in
  ces-tester would be the same mistake with better timing.
- Do not read or write tenant-stacksim's `store.json`/`ledger.jsonl` directly, regenerate its
  PowerShell modules, or reimplement its az shim — this repo's own `PLAN.md` "two-entities
  boundary" rule (What This Plan Does NOT Do) is independent of and additional to this goal's
  `ces-tenant`-adoption scope; adopting `ces-tenant` does not relax that boundary.
- Do not hand-roll the sim-tenant ready-check polling loop as a permanent design once
  `probeSimReady` exists and is usable — `PLAN.md` M1 task 3's current hand-rolled polling
  (poll `/resolve` for a known-seeded object, bounded retry budget) is exactly what
  `probe.ts`'s `probeSimReady` is meant to replace (see `ces-tenant/src/probe.ts` doc comment,
  explicitly citing this repo's `PLAN.md` M1 task 3 as its grounding). Once that method is
  implemented and available, keep using it, not a parallel local loop.
- Do not hand-reconstruct `StacksimMode`'s env-mutation logic (`PSModulePath`/`Path`/
  `STACKSIM_SERVER_URL`) inside `stamper-launcher`. Request the bundle from
  `TenantLaunchContextProvider.getSimLaunchEnv()` instead — that interface exists specifically so
  this repo's launcher doesn't duplicate `StacksimMode.ts:118-125}`'s three env mutations a second
  time (see `ces-tenant/src/launch-context.ts` file header, which names this exact repo and task as
  its grounding).
- Do not let the orchestrator's sim-tenant cleanup pass risk touching a `kind: 'live'` tenant.
  Every kind-filtered query in this repo must go through `listByKind('sim')`, never a naming-
  convention or directory-location heuristic — this is a named invariant from the founder
  direction that promoted ces-tester to a consumer, not optional hardening.

## Acceptance Gate

Map each `PLAN.md`-documented need to the interface member that answers it, and confirm each is
actually wired, not merely available:

1. **Ephemeral per-scenario sim tenants** (`PLAN.md` M1 task 2's materialize-and-invoke path, and
   M1 task 4's slug handoff to the launcher) — implemented via
   `TenantRegistryLifecycle.createEphemeralSimTenant(slug, seedRef)` and
   `teardownEphemeralSimTenant(slug)` (`ces-tenant/src/registry.ts`). Gate: a scenario run creates a
   `kind: 'sim'` tenant through this method (not through direct `stacksim init-tenant`/`scenario`
   CLI invocation bypassing the registry), and teardown leaves no residue — a torn-down slug must
   not appear in a subsequent `listByKind('sim')` call.
2. **Query/filter by kind, live-tenant-safe** — implemented via `TenantRegistryLifecycle.get(slug)`
   and `listByKind(kind)`. Gate: the orchestrator's cleanup/reset pass between scenario runs uses
   `listByKind('sim')` exclusively; a test demonstrates a `kind: 'live'` record present in the same
   registry is never returned by that call.
3. **Reach/ready probe** (`PLAN.md` M1 task 3's currently-hand-rolled `/resolve` polling loop) —
   implemented via `TenantReachProbe.probeSimReady(tenantSlug, options)`
   (`ces-tenant/src/probe.ts`). Gate: the orchestrator's readiness check before any HTTP read
   against a freshly-seeded sim tenant calls this method instead of a locally-implemented polling
   loop. (Per the interface's own doc comment, this may still be thin/simple on `ces-tenant`'s side
   at first — the gate here is that ces-tester *calls* the probe, not that the probe's internal
   implementation is elaborate.)
4. **Launch-context surface** (`PLAN.md` M1 task 4 / Interface Contract Summary row 3: spawn
   `powershell.exe` running `stamper translate ... --tenant <slug>` with `--stacksim [url]` env
   injected) — implemented via `TenantLaunchContextProvider.getSimLaunchEnv(tenantSlug, kind)`
   (`ces-tenant/src/launch-context.ts`), consumed by `stamper-launcher` to obtain `psModulePath`,
   `path`, and `stacksimServerUrl` before spawning Stamper's CLI. Gate: `stamper-launcher`'s spawn
   call sources these three env values from `getSimLaunchEnv()`, not from local computation.
5. Zero bespoke tenant logic anywhere in this repo post-adoption — a repo-wide check for hand-
   rolled tenant-config JSON construction, direct `~/.stamper/tenants/` reads, or a local
   reimplementation of any of the four items above returns nothing.
6. Encoding gate: grep for the UTF-8 mojibake marker (a-circumflex + euro sign, the double-decoded curly-quote sequence) returns 0 on every file touched by this goal.

## Preconditions

- **Blocked on M1 shipping** (both `ces-stamper/docs/goals/G-TENANT-M1.md` and
  `ces-tenant/docs/goals/G-TENANT-1.md`) for the same reason every other consumer milestone is:
  there is no real implementation behind the M0 interfaces to consume yet.
- Independently, per this repo's own `PLAN.md` Gate Ledger (`docs/goals/G-TESTER-1.md`), this
  repo's M1/M2 work is separately gated on tenant-stacksim's S1/S2/S3 closure. Those gates are
  unrelated to `ces-tenant` adoption and are tracked in this repo's existing Gate Ledger, not
  duplicated here — do not treat this goal's `ces-tenant`-adoption precondition as satisfying or
  substituting for that separate gate, and vice versa. Both must be clear before the relevant
  `PLAN.md` milestone tasks proceed.

## Pointers (read-only — do not copy content into new files)

- Design doc: `ces-stamper/docs/design/tenant-manager-extraction.md` — §5 (M5 section noting
  ces-tester's promotion from footnote to named consumer), §6 (ces-tester's specific per-consumer
  requirements, quoted above in full).
- This repo's own `PLAN.md` — §"Interface Contract Summary (who calls what)" (rows for tenant-
  stacksim/Stamper-CLI interactions this goal's launch-context and lifecycle items answer), M1
  tasks 2-4, "What This Plan Does NOT Do" (the two-entities boundary, independent of and additional
  to this goal's scope fence).
- Ratified interfaces (sibling repo, read-only): `ces-tenant/src/registry.ts`
  (`TenantRegistryLifecycle`), `ces-tenant/src/probe.ts` (`TenantReachProbe.probeSimReady`),
  `ces-tenant/src/launch-context.ts` (`TenantLaunchContextProvider`, `SimLaunchEnv`) — all four
  carry doc comments explicitly grounding themselves against this repo's `PLAN.md`.
- This repo's existing Gate Ledger: `docs/goals/G-TESTER-1.md` — the separate S1/S2/S3 gate
  tracking referenced in Preconditions above.

---

## ADDENDUM 2026-07-11 — ces-tester OWNS sim-tenant registration (founder resolution of design §8 item 6)

Founder decision 2026-07-11: tenant-stacksim stays zero-dependency and tenant-ignorant; the
responsibility for making sim tenants exist as first-class registry citizens is THIS
module's, permanently. Per scenario run: create the ephemeral `kind:'sim'` tenant via
ces-tenant's `TenantRegistryLifecycle` (never by writing config files by hand, never by
invoking stacksim's now-deprecated-for-orchestrated-use `init-tenant` direct-write path),
obtain the launch-context env bundle from the package, and tear down through the registry
on run completion. stacksim receives only its own scenario/seed inputs — it never learns
about the registry. This addendum upgrades the corresponding "consume the registry" bullets
from adoption guidance to ownership.
