# tenant-stacksim — Backlog (work items S1–S5)

**Filed:** 2026-07-10, from the ces-tester founder decisions
(`ces-strategy/docs/ces-tester-decisions-2026-07-10.md`, decisions 5/8/9/10/11).
These are **this repo's** work items — ces-tester consumes stacksim over its CLI/HTTP
interface only and never patches these from its side (two-entities boundary). Items
S1–S3 gate ces-tester milestones; their closure records belong here
(`ces-tester/docs/goals/G-TESTER-1.md` Gate Ledger watches this file).

---

## S1 — Move `seed`/`init-tenant` behind the single-writer server
**Status:** CLOSED 2026-07-10 · `2ebd227` — exclusive-writer mechanism (accepted alternative per this item's own "or equivalent" clause): `src/store/TenantLock.ts` (`.stacksim.lock`, atomic 'wx' create, pid-liveness). `serve` holds the lock for its lifetime; `seed`/`scenario` hold it during writes and fail loudly (TenantLockedError) against a live holder; `scenario` locks before wiping so it can never delete a live server's files. `init-tenant` writes no store/ledger (config files only) — nothing to route. Regression test: `tests/integration/backlog-s1-single-writer.test.ts` (seed-vs-serve, scenario-vs-serve with wipe canary, serve-vs-serve, stale-lock steal, sequential flow). 112/112 vitest; coverage 503/523 0-FAIL unchanged.
**Priority: pre-Phase-1 (gates ces-tester M1)** · *(Decision 9; inventory §5.1)*

`seed.ts` and `init-tenant.ts` construct `ObjectStore`/`Ledger` and write
`store.json`/`ledger.jsonl` directly (`src/cli/commands/seed.ts:45-46`, with an in-code
comment acknowledging the planned move), bypassing the single-writer `serve` process.
Seeding while `serve` is running is a write race. This was already an unclosed acceptance
criterion in this repo's own plan (inventory §5 item 1).

**Accept when:** `seed`, `init-tenant`, and `scenario` perform all store/ledger writes through
the single-writer server path (or an equivalent exclusive-writer mechanism), and a concurrent
`serve` + seed invocation cannot interleave writes. Record closure here with commit hash.

## S2 — Close the A8 plural/singular read-shape bug
**Status:** CLOSED 2026-07-10 · `e99e27f` — `deriveCollectionInfo()` remaps derived singular collections to the seeded plural when the exact plural exists in KNOWN_OBJECT_TYPES; remapped write entries merge-patch `<singular>-1`. Verified: Get-MgUser returns the 5 seeded users; coverage 503/523 0-FAIL unchanged. *(Was mislabeled "S2" in that commit's session-local numbering too — happily the same item.)*
**Priority: pre-Phase-1 (gates ces-tester M1, bundled with S1)** · *(Decision 10; inventory A8)*

Auto-derived read cmdlets map to **singular** collections (`Get-MgUser` → `user`) while
SeedEngine seeds hand-mapped **plurals** (`users`), so some no-filter reads incorrectly
return `[]`. Passed the coverage bar (A7's executed-without-error proxy) but corrupts any
consumer that trusts read shapes — ces-tester's verifier depends on these reads being truthful.

**Accept when:** no-filter reads on all seeded collections return the seeded objects
(collection-name mapping unified or aliased), with a regression test. Record closure here.

## S3 — Config isolation for `init-tenant`
**Status:** CLOSED 2026-07-10 · `fc1c352` — accepted via the item's "reliably auto-cleaned" clause plus a stronger default: the flat `~/.stamper/tenants/` write is now OPT-IN (`--tenantprobe-flat` / `emitFlat`), so by default sim configs never touch the real dir at all. The one TenantProbe-compat flow (m3-tenantprobe test) opts in and deletes its file in afterEach — verified clean after a full suite run. Pre-existing pollution (`sim-m365-azure.json`, `stacksim-test-m3.json`) removed from the real dir (real client configs untouched). Regression tests: SimTenantConfig.test.ts (no-flat default / emitFlat opt-in) + m1-seeding. Residual: TenantProbe.psm1 (sibling `tenant-tests`, hardcoded `$HOME\.stamper\tenants`, no override) — an env-override there would eliminate even the opt-in real-dir write; filed as an OPTIONAL cross-repo suggestion in this repo's session log, needs owner approval to implement (project-root write boundary).
**Priority: pre-first-repeated-run (gates ces-tester M2)** · *(Decision 5; inventory A9)*
**Addendum 2026-07-11 (G-TENANT-M4 RESOLUTION):** the A9-class collision hazard is now also STRUCTURALLY closed on the registry side — ces-tenant's M1 shipped physically separate live/ and sim/ roots, and per founder decision sim-tenant registration is ces-tester's job (stacksim stays tenant-ignorant). stacksim's residual duty — marking `init-tenant`'s direct writes deprecated-for-orchestrated-use (doc + console warning, command kept) — is done; see docs/goals/G-TENANT-M4.md.

`init-tenant` writes sim tenant configs into the **real** `~/.stamper/tenants/` and
`TenantProbe` hardcodes that directory with no override. A9 accepted this for manual use
(sim-unique slugs), but repeated automated scenario runs must not pollute real Stamper config.

**Accept when:** sim tenant configs are kept out of the real directory (dedicated dir +
TenantProbe directory override), or are reliably auto-cleaned per run. Record closure here.

## S4 — Fake auth surfaces (feature request)
**Status:** CLOSED 2026-07-10 · `829f01b` — acceptance test `tests/integration/backlog-s4-full-lifecycle.test.ts`: Stamper's REAL SessionManager (persistent session-host.ps1, ensureConnected/execute/disconnectAll) completes the full lifecycle across ALL SIX session types (graph/azure/exchange/purview/teams/sharepoint) against a served sim, one real command executed per type, all sessions disconnected. Sign-in = the cert-credentialed Connect-* call (no separate interactive leg exists in Stamper); the sim also serves the OAuth token endpoint for REST clients (07-10, `acc89c7`). SharePoint enabled by an OWNER-APPROVED one-line production improvement in ces-stamper's buildConnectCommand (Connect-SPOService `-CertificateThumbprint`, verified against installed module 16.0.27111.12000's AuthenticationCertificate parameter set — same internal cert-store lookup as every other session type) plus a Connect-SPOService no-op in the sim; NO real certificate store involvement anywhere. Caveat recorded: thumbprint connect not yet validated against a live GCC High SPO tenant — sanity-check on the next real connect.
**Priority: feature, post S1–S3** · *(Decision 8 — founder counter-recommendation)*

Grow simulated sign-in and SharePoint/Teams connection surfaces so Stamper's full session
machinery (not just Graph calls) is exercised against the sim. Founder chose growing the sim
over scoping down ces-tester's fidelity claim. Until this ships, ces-tester states the
auth-fidelity limit honestly (its architecture §9) — no fake auth is built on its side.

**Accept when:** Stamper completes a full session lifecycle (sign-in → connect → execute →
disconnect) against the sim with zero Stamper code edits.

## S5 — Fault-injection hooks in the resolver layer
**Status:** CLOSED 2026-07-10 · `94184c8` — `src/http/FaultInjector.ts` + QueryServer wiring at the transport layer (covers BOTH consumer surfaces with one mechanism: POST /resolve and the /v1.0|/beta Graph REST facade). Rules `{target: cmdlet-name | uri-prefix, kind: throttle|transient|malformed, times: N | 'always'}`; deterministic first-N-matching-calls counters, never random; throttle→429+Retry-After, transient→503 (Graph-shaped error bodies), malformed→200 with an unparseable body. Two knobs per the acceptance clause: a scenario's `faultInjection` block (validated at build, persisted to `<tenantRoot>/faults.json`, auto-loaded by serve) and runtime `POST /_faults` (replace/clear, resets counters, 400s on invalid rules). Acceptance test `tests/integration/backlog-s5-fault-injection.test.ts` (5 cases: scenario knob live at startup, exact-N throttle + unrelated-cmdlet isolation, facade transient + recovery, malformed/'always' + clear, loud validation). 119/119 vitest; coverage 503/523 0-FAIL unchanged. ces-tester's reserved `fault_injection` block can now fill in.
**Priority: later phase** · *(Decision 11 / xref X22)*

Per-command throttle / transient-error / malformed-response injection in the resolver layer.
ces-tester's scenario schema reserves a `fault_injection` block that stays empty until this
ships; when it does, fault scenarios are small incremental work on its side.

**Accept when:** a scenario/config knob can make a named command return 429 / transient
failure / malformed payload deterministically, covered by a test.

---

**Closure protocol:** update the item's Status line here (CLOSED + date + commit hash).
ces-tester's G-TESTER-1 Gate Ledger treats this file as the tracking source for S1/S2/S3.
