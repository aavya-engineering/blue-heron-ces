# collective-ces-muster.md — status capture for AI planning

**Captured:** 2026-07-27 (updated post-G-MUSTER-PL-1) · **Branch:** `g-muster-p1`
**HEAD:** G-MUSTER-PL-1 commits (`efb684f` M1 CODE, `d1c47ee` M2 HARDENING, + M3
HOUSEKEEPING) — NOT pushed. Awaiting brutal-critic + HIL approval → completion doc.

**G-MUSTER-PL-1 executed 2026-07-27 (all 11 items closed in-repo):**
- **M1 CODE:** C1 added the missing ResultScreen cascade integration test (cascade
  was already wired live since 07-11); C2 threaded real party_id on new-session
  create (onEngagementReady 3rd arg → App.partyId); C3 persist the 3 profile
  answers (employee_count/has_ssp/covers_m365) on AssessedParty + restore on
  resume + optional StatusPayload.profile (schema+AJV); C4 recorded keep-two
  decision (`docs/design/D-C4-quick-session-keep-two.md`) — shared core, thin UIs.
- **M2 HARDENING:** H1 closed the schema↔validator gap (validateConfigFact now
  enforces additionalProperties; both-ways parity test; no ajv runtime dep); H2
  documented one-liner (`muster-api/README.md` + `test:live`/`seed:rls` +
  `scripts/seed-rls-fixtures.ts`) — 3 live-RLS tests still env-gated, NOT run live
  this session (no non-BYPASSRLS Postgres here); H3 real wall-clock scheduler
  (`schedulerService.ts`, opt-in `SCHEDULER_TENANT_ID`, single operator tenant via
  withTenant; GLOBAL tick X11 stays excluded; fake-timer test).
- **M3 HOUSEKEEPING:** K1 already satisfied (VAULT.md archive-by-git convention +
  `git show ac659f2:PLAN.md`); K2 reconciled 40 BHD markers → all map to existing
  rows (checklist header + row 16 closed + row 21 noted); K3 regenerated coverage
  (0 stale scre-muster paths; gitignored); K4 manual attestation — scre-muster is
  a MOVED.md-only tombstone, physical delete left founder-manual (outside root).
- **Board:** SPA 301/301, muster-api 293+3 env-skips, e2e 9/9, drift 60/60, both
  tsc clean, build/lint 0. **Founder-remaining:** brutal-critic PASS + HIL approval
  → write `docs/GOAL_COMPLETION_G-MUSTER-PL-1.md` (must re-verify X1 hashes on
  origin: `1444299`/`3030785`/`ac659f2` — all confirmed on origin/g-muster-p1).

**Prior — GP-MUSTER-1 (2026-07-25):** M1 DISCOVERY-1 Gates 2/3/5 PASS (Gate 4 stays
founder-held on FD-LIVE-SMOKE) — ledger in `docs/goals/G-MUSTER-DISCOVERY-1-LOG.md`;
M2 EO's SPRS-parity filing closed by recording READINESS-1 gate 6
(`docs/goals/G-MUSTER-READINESS-1-LOG.md`); M3 delivery-vehicle brief presented
(`docs/design/delivery-vehicle-brief.md`, recommends operator-run + portal now,
SaaS as destination) — **ruled Option C → GP-MUSTER-2 EXECUTED (see Next steps).**
**GP-MUSTER-1 executed 2026-07-25:** M1 DISCOVERY-1 Gates 2/3/5 PASS (Gate 4 stays
founder-held on FD-LIVE-SMOKE) — ledger in `docs/goals/G-MUSTER-DISCOVERY-1-LOG.md`;
M2 EO's SPRS-parity filing closed by recording READINESS-1 gate 6
(`docs/goals/G-MUSTER-READINESS-1-LOG.md`); M3 delivery-vehicle brief presented
(`docs/design/delivery-vehicle-brief.md`, recommends operator-run + portal now,
SaaS as destination) — **awaiting founder ruling (master plan D8) → GP-MUSTER-2**.

## Goal (founder-calibrated 2026-07-25)

Muster is the customer-facing front door of CES: it assesses a small defense
contractor's current security posture, computes the **one true SPRS score**
(canonical `computeSprs` — every other module defers to it), and produces the
readiness report and mission plan that scope an engagement. It is the *assess &
plan* stage of the CES lifecycle — everything a prospect experiences before
remediation begins, and the artifact chain (readiness result → task catalog →
tenant manifest → mission plan) the execution engines consume afterward. The
discovery executor (read-only walk of Stamper registries via ces-tenant
sessions) **lives in Muster** (founder-ruled 2026-07-25, closes
FD-DISCOVERY-OWNER) and is what turns "assess" from questionnaire into live
tenant observation.

**Standing product requirement (founder, 2026-07-25):** there must be a
**secure and easy way for users to use Muster and get results from it** —
delivery/access UX (how a contractor runs an assessment and receives the
report, without friction and without security compromise) is part of the goal,
not an afterthought.

## What this module is

ces-muster is the Muster product: a CMMC readiness/assessment SPA (Vite/React, repo
root `src/`) plus **muster-api** (pure-Node backend, `muster-api/`) that brokers ALL
tenant-facing work. Architecture rules that bind every future plan:

- The SPA never touches tenants, sessions, tokens, or registries — it sees only
  results (`TENANT-CONNECTION.md`, amended 2026-07-11).
- muster-api never hand-rolls session/auth — it consumes the sibling `ces-tenant`
  package (`file:../../ces-tenant` dep): HTTP key surface for credentials
  (`muster-api/src/services/tenantKeysService.ts`, consumer identity module
  `ces-muster`) and `PersistentSessionFactory`/`StacksimEnvironment` for sessions.
- Shared code arrives by **vendor-with-drift-check** (`vendor-manifest.json`,
  `npm run check:drift`, 32 files) — never forked copies.
- Stamper registries are consumed AS DATA (223 entries / 201 runnable gets) — no fork.

## Verified baselines (as of HEAD)

- SPA suite: 231 passed / 34 files · muster-api suite: 259 passed (+ env-skips)
- e2e (Playwright): 9/9 incl. five-tabs pruning-delta · drift check: 32/32 OK
- Typecheck clean both packages.

## Completed (reverse order — the three most recent are the active context)

1. **G-MUSTER-DISCOVERY-1 through acceptance Gate 1** (`818ed31`→`ce1d389`):
   read-only discovery executor in muster-api walks both Stamper registries,
   executes `get_command`s via ces-tenant sessions, honors `manual_only`, emits
   readiness-result.v1 `observations[]` with `raw_capture_ref` files. Wired into the
   readiness assembler (`33c1b6b`). Gate 1 proven live: self-booting test drives a
   real `stacksim serve m365_azure` (`muster-api/tests/discovery.live-sim.test.ts`).
2. **G-MUSTER-READINESS-1 M1–M3 + G-MUSTER-PLAN-2 M1–M2** (`919422c`→`a54ee64`):
   readiness-result.v1 schema, exporter + Situation manifest capture, customer
   readiness report; import seam (one seam, no parallel path), vendored Planner
   SI-Baseline generator + TaskCatalog compiler chain → Tenant Manifest → Manual
   Mission Plan. SPRS scoring single-sourced to canonical ces-shared table
   (`5cd1e95`, `6e3aa93`, parity fixture `9e7471c`).
3. **G-MUSTER-GO-2 Answer Engine walking skeleton — COMPLETE, founder HIL approved**
   (`f1666fb`, critic fixes `3613789` [D1 attestation laundering, D2 export draft
   leak], completion doc `ffae1ec`). Drafts prune, never pass.
4. Earlier, still load-bearing: GO-1 discovery-first GO Flow; adaptive-answering
   divergence fixes (`02ab418`: confidence-tiered pruning via `confidenceRank`,
   `on_prem_ot` stack-dimension seam — seam is a TESTED no-op until graph nodes carry
   the `on_prem_ot` tag); G-TENANT-M3 tenant-key cutover to ces-tenant.

## Next steps (priority order)

1. **GP-MUSTER-2 EXECUTED 2026-07-25 — all four milestones landed** (HIL gates
   ruled same day: 90-day retention, enclave-adjacent hosting, self-serve YES
   with kit). M1 `docs/design/result-handling-policy.md` (ACTIVE); M2 delivery
   portal (`muster-api` `/api/delivery` operator lane + `/portal` grantee
   capability lane, migration 005, 10 tests); M3
   `docs/design/collaborative-session-runbook.md`; M4 `collectorKitService`
   (signed read-only PS collector → existing import seam, 5 tests). Boards:
   SPA 294, api 278+3, e2e 9/9, drift clean. **Remaining before first customer:**
   portal DEPLOY (enclave-adjacent host stand-up + run migration 005), a real
   engagement dry-run of the runbook, DISCOVERY-1 Gate 4 when FD-LIVE-SMOKE
   lifts.
2. **DISCOVERY-1 Gate 4 — BLOCKED**: live-run parity waits on the FD-LIVE-SMOKE
   hold lifting (founder-controlled). Identical observation SHAPE across
   `kind: 'live' | 'sim'` when it runs. Gates 2/3/5 PASSED 2026-07-25
   (`G-MUSTER-DISCOVERY-1-LOG.md`).
3. **G-MUSTER-PL-1** (11-item punchlist): **EXECUTED 2026-07-27** — all C1–C4,
   H1–H3, K1–K4 closed in-repo (see top of file). Awaiting brutal-critic PASS +
   HIL approval → `docs/GOAL_COMPLETION_G-MUSTER-PL-1.md`. Founder-manual residue:
   H2 live-RLS run (needs non-BYPASSRLS Postgres), K4 tombstone folder delete.
   Any remaining PLAN-2 milestones (M2 reached slice 4) are separate; check
   `docs/goals/G-MUSTER-PLAN-2.md`.
4. **Deferred schema question (flagged, not taken):** persisting per-command
   discovery statuses[] INTO readiness-result.v1 (elicitation-ladder residual
   facts) would be a schema rev — the observation object is closed and v1.0.0 is
   shared by four producers. Take it up only with a deliberate schema-version
   decision.

## Open decisions (founder-only — do not resolve in-agent)

- Vendored `src/vendored/ces-shared/`: imported by NOTHING since G-TENANT-M3.
  Retire-now vs keep-as-fallback stated in `docs/goals/G-TENANT-M3-LOG.md`.
- Cert-assertion delegation through ces-tenant (design §6).
- Dependency mechanism `file:` vs published/git-pinned (design §8 item 2).

## Gotchas planners must know

- **Windows PSModulePath casing**: strip EVERY casing of inherited `PSModulePath`
  before setting the sim path, or real Microsoft.Graph modules shadow the stacksim
  shim and Connect-MgGraph hangs on WAM auth. Prod path is safe
  (`StacksimEnvironment.deleteEnvKeyCaseInsensitive`); any new spawn site must guard.
- `G-TENANT-M3.md` must stay byte-identical (its gate quotes a mojibake marker
  literally); impl notes go in the sibling `-LOG.md`.
- muster-api is CJS-under-NodeNext consuming ESM-only ces-tenant — works on TS 5.9 /
  Node 24 (`require(esm)`); pinning TS < 5.8 would break with TS1479.
- Cross-session hazard: muster-api tests flake if a sibling session is mid-operation
  in `ces-tenant` (file: dep). Re-run after the sibling settles.
- Pruning excludes `operator_interview`-provenance facts (`AssessmentPage.tsx`,
  GO-1 deviation #1) — new pruning inputs must ride the stack dimension or an
  allowed provenance, or they are silently swallowed.

## Key files / pointers

- Goals: `docs/goals/` (DISCOVERY-1, GO-1/2, PL-1, PLAN-2, READINESS-1, TENANT-M3)
- Verification artifact: `docs/context/ADAPTIVE_VERIFY-2026-07-11.md`
- Architecture boundary: `TENANT-CONNECTION.md` · Vendor gate: `vendor-manifest.json`
- Discovery lane: `muster-api/src/` discovery + `tests/discovery*.test.ts`
- Session logs (long-term memory): `session-ces-muster-*.md`, newest 2026-07-25.
- Blocked-on-others ledger (unchanged): live discovery engine externals,
  extraction/AI, VOI/plan-generator, auth tiers, archetype content,
  RECIPES_SELF_SERVE.
