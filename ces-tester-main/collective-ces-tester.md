# collective-ces-tester.md — Status & Next Steps

> Purpose: standalone context capsule for AI-based planning. Captures where ces-tester
> stands as of **2026-07-25**, what is verified vs. unrecorded, and what comes next.
> Written from repo evidence (git log, session logs, PLAN.md, IMPLEMENTATION_LOG.md).

## Goal (founder-calibrated 2026-07-25)

ces-tester is the end-to-end proving ground for the whole CES suite: it seeds a
simulated M365/Azure tenant, drives the **real, unmodified tools** — Muster's
actual wizard UI via Playwright, Stamper's actual CLI in `--stacksim` mode —
and then verifies the resulting tenant state and evidence against per-scenario
expectations. Declarative JSON scenarios make new coverage cheap; the seed →
Muster → Stamper → verify loop makes cross-tool regressions visible **before a
customer tenant ever would.** Its charter is strict consumption: siblings are
driven only through their public surfaces (CLI, HTTP, UI) — never imported,
never modified — so a green run certifies the interfaces customers and
engagements actually touch. It exists because a compliance product whose own
toolchain is unverified is selling exactly what it can't prove.

## 1. What this module is

**ces-tester** is the end-to-end scenario test harness for the CES ecosystem. It seeds a
simulated M365/Azure tenant (via sibling **tenant-stacksim**), drives the real **Muster/
Planner** web UI with Playwright, launches the **Stamper** CLI against the sim tenant, and
verifies resulting tenant state + evidence against per-scenario expectations.

- Stack: Node + TypeScript (strict), vitest, Playwright. CLI entry `src/cli/index.ts`.
- Scenario files: `scenarios/*.json`, ces-tester-owned wrapper schema (frozen in
  `schemas/scenario.schema.json`); the runner materializes the `stacksim_seed` block into a
  stacksim-format temp file (stacksim requires top-level `name`+`stance`; file-lookup, not
  piped input).
- Governing plan: **PLAN.md** (milestone ladder M0–M7 with per-milestone acceptance gates).
- Day-by-day memory: `session-ces-tester-<date>.md` files + `docs/context/IMPLEMENTATION_LOG.md`.

## 2. Ecosystem & hard constraints (any planner MUST honor)

- Siblings (all under `C:/Users/mhsut/DevProjects/ces/`): `ces-tenant` (shared tenant
  registry/launch lib, consumed via `file:../ces-tenant` junction — **do not bump/replace
  the pin without founder instruction**), `tenant-stacksim` (sim tenant engine, HTTP facade
  on `127.0.0.1:4390`), `ces-muster` (Planner UI, Vite dev server on 5173), Stamper (CLI,
  spawned via powershell with `--stacksim`).
- **Sibling repos are read-only** from this session root (global Project Root Write
  Boundary rule). Cross-repo needs are filed as requirement docs in THIS repo.
- stacksim's deprecated **`init-tenant` direct-write path must not be used** — tenant
  lifecycle goes through ces-tenant's `TenantRegistryLifecycle`; launch env through
  `getSimLaunchEnv()`.
- Never touch tenant-stacksim internals (store.json, ledger.jsonl, PS codegen, az shim) —
  interface contract, PLAN.md §"Interface Contract Summary".
- Standard gates for any milestone commit: repo test suite green, `tsc --noEmit` clean,
  mojibake grep 0, plus the milestone's own acceptance gate. Commits pathspec-scoped.
- `~/.ces/tenants/sim/` holds 3 standing records owned by another pane (ces-tenant work) —
  not ces-tester residue; leave alone.

## 3. Current status (as of 2026-07-25)

**Branch `g-tester-1`, working tree clean except an untracked `ces-tester.code-workspace`.**
No repo activity between 2026-07-12 and today.

| Milestone | State | Evidence |
|---|---|---|
| M0 inventory + preconditions | DONE, gated | logs 07-10/07-11; re-verified Session 3 |
| M1 orchestrator skeleton (stacksim half) | DONE, gated | `448d26b`, re-verified |
| M2 Playwright Muster driver (walking skeleton) | DONE, gated — **GREEN as of 2026-07-25/26** (IA.L2-3.5.3 fixed upstream `5252d90`; 6/6 run-alls green today) | `03e60d2`; GP-TESTER-1 M4 record |
| G-TENANT-ADOPT (ces-tenant 0.2.0 cutover) | DONE, verified | `ce4bab4` |
| Step-0 schema freeze (lanes, readiness_payload) | DONE | `f8b705d` |
| **M3 scenario format + run-all + verifier** | **GATED: mechanism PASS 2026-07-25/26; verdict-correctness ACHIEVED on quiet machine** (`gp-m2-gate-1/2`: 3 green + deliberate red, twice; load-induced extras still a risk — §5) | IMPLEMENTATION_LOG "GP-TESTER-1 M1"/"M2" — see §4 |
| **M4 results dashboard** | **DONE, GATED 2026-07-25/26 — G-TESTER-1 terminal criterion PASS** (file:// offline verify all-green, `scripts/verify-dashboard.mjs`) | IMPLEMENTATION_LOG "GP-TESTER-1 M2"; runs `gp-m2-gate-1..4` |
| M5 coverage vs 523-call baseline | IN PROGRESS — coverage-report tool + CLI shipped (`ad2b218`); **2 new T1/PROTECT scenarios added `538ff98`** (audit-logging 3.3.1 high-confidence; remote-maint-MFA 3.7.5 PENDING-LIVE read-parity). Distinct T1 asserted 3 -> 5. Schema-valid + glob-discovered + unit-guarded; live green pending. | `538ff98`; docs/M5-COVERAGE-PLAN.md |
| M6 live smoke / M7 EvidenceOps lanes | DEFERRED | PLAN.md:363/379 |

Last fully-verified world-state (Session 3, 2026-07-11, `b0ff1f9`): build clean, strict
tsc clean, 34/34 vitest, live M2 gate deterministic across repeated runs, ces-tenant
resolving **0.4.0** (its breaking `resolveTenantKeys` change is not consumed here — zero
call sites, confirmed by grep).

## 4. M3 gate — executed and recorded (GP-TESTER-1 M1, 2026-07-25/26)

The record gap from the 2026-07-12 `dbf797b` landing is CLOSED — full account in
`docs/context/IMPLEMENTATION_LOG.md` "GP-TESTER-1 M1". Summary:

- **Mechanical criteria (PLAN.md M3 gate): PASS.** Serial 4-scenario `run-all` completes
  with per-assertion `result.json` per scenario; the deliberate-fail scenario is honestly
  red with non-empty, real-`/ledger` `diverged_commands` (proven twice); 5th-file glob
  pickup with zero code changes proven live (`gp-m1-glob-probe`) and by unit test;
  validator's malformed-scenario rejection demonstrated live.
- **Verdict-correctness ("3 green + 1 deliberate red"): BLOCKED-EXTERNAL.** Every Stamper
  execute fails a rotating ~9–12 of 110 task verifications ("Evidence validation failed",
  state genuinely unpersisted per two independent observers); a scenario goes red iff the
  rotation hits an asserted control. NAMED known-red extending the IA.L2-3.5.3 precedent;
  `docs/requirements/REQ-STAMPER-ROTATING-VERIFY-FAIL.md` (6-run evidence matrix).
  Re-verify at GP-TESTER-1 M4 when GP-STAMPER-1 lands.
- **Two harness defects found by the gate, fixed forward same pass:** verifier's
  divergence path could crash the runner on a dead serve (now an honest diverged row);
  a ces-planner data-bank race could yield a silently degenerate all-manual plan (now
  detected + bounded regeneration retry; `REQ-PLANNER-MPT-DATA-RACE.md` filed). Serve
  output now persisted per-scenario (`stacksim-serve.log`) with unexpected-exit stamping.

## 5. Known issues / open threads

1. **External Stamper instability (blocks full-green gates):** (a) the original
   IA.L2-3.5.3 template-vs-injection-guard bug (IMPLEMENTATION_LOG M2 section), and (b)
   the broader **rotating task-verification failure class** (~9–12 of 110 per execute,
   set rotates; `docs/requirements/REQ-STAMPER-ROTATING-VERIFY-FAIL.md`). Both carried as
   NAMED known-red; requirement docs live in this repo (siblings read-only) — founder
   routes them to GP-STAMPER-1. Re-verify at GP-TESTER-1 M4.
2. **`probeSimReady` BLOCKED-PENDING-CES-TENANT:** ces-tester retains its M1 poll loop;
   swap to ces-tenant's `TenantReachProbe.probeSimReady` when they implement it (was
   absent through 0.4.0 — recheck current version at next session start).
3. **ces-tenant version drift watch:** pin is `file:../ces-tenant` (live junction) — each
   session, diff the consumed surfaces (registry lifecycle, `getSimLaunchEnv`) against the
   currently-resolving version before trusting green builds.
4. **vitest ^3 maintenance bump** pending (low priority).
5. `expected_evidence.capture_received` cannot fire on the CLI path (Stamper GUI-only
   emission) — verified against local evidence + stacksim `/evidence` instead; true
   capture semantics defer to M7. See `docs/PHASE0_FINDINGS.md` item 5.

## 6. Next steps (ordered)

1. ~~Close the M3 gap~~ **DONE 2026-07-25/26** (see §4; GP-TESTER-1 M1 complete).
2. ~~M4 — Results Dashboard~~ **DONE, GATED 2026-07-25/26** (GP-TESTER-1 M2; G-TESTER-1
   terminal criterion PASS; `ces-tester dashboard` regenerates, `scripts/verify-dashboard.mjs`
   re-verifies). GP-TESTER-1 M4 also DONE: walking skeleton confirmed GREEN (IA.L2-3.5.3
   fixed upstream). **NOW CURRENT: M5 coverage growth = GP-TESTER-1 M3** per
   `docs/M5-COVERAGE-PLAN.md` (T1/PROTECT-first; coverage-report tool next, then the
   5-scenario batch). Old M4 spec for reference (PLAN.md:317-336): per-run `summary.json` writer +
   `runs/<run-id>/live.json` in-flight updates; self-contained `dashboard/dashboard.html`
   (house style per `competitors/ces-competitive-dashboard.html` pattern — no server, no
   build step, works over `file://` offline, data inlined at generation time preferred);
   history strip + flaky-scenario detection across `runs/*/summary.json`.
   Gate: 3 consecutive `run-all` runs (varying the failing scenario) render correct tiles,
   3-run history, per-scenario drill-down with ledger snapshot link, fully offline.
3. **M5 (in progress)** — coverage mapping against the 523-call inventory shipped
   (`ces-tester coverage`); 2 T1 scenarios added (`538ff98`). NEXT: run a live run-all to
   turn the 2 new scenarios green (audit-logging expected high-confidence; remote-maint-MFA
   confirms the created-CA-policy read-parity question — if red there, it's the A8-class
   write->read collection gap, file against stacksim, not a tester defect). Then continue
   the T1 batch (entra-access, device-hardening, remote-access, least-priv-pim per
   docs/M5-COVERAGE-PLAN.md). `manual_only` exclusions carried as known-untested (0 in the
   current inventory revision).
   - **M4 dashboard re-confirmed 2026-07-27:** committed `dashboard/dashboard.html` passes
     `scripts/verify-dashboard.mjs` gate fully offline (file://, all UI criteria, 0 non-file
     requests). NOTE: `ces-tester dashboard` regenerates from whatever is in gitignored
     `runs/`; a partial/probe run (e.g. a 1-scenario `runs/gp-m3-probe`) becomes "latest" and
     makes the regenerated file fail the gate's ">=4 latest-run rows" check. The committed
     gated artifact was generated from a full 5-scenario run — do NOT commit a dashboard
     regenerated over a partial run. (Latent hardening candidate: have the generator pick the
     latest FULL run for tiles, or the verifier tolerate partial latest runs.)
4. In parallel/whenever unblocked: file the Stamper IA.L2-3.5.3 bug (ask founder first),
   `probeSimReady` swap, vitest bump.

## 7. Orientation pointers for a fresh AI session

- Read first: most-recent `session-ces-tester-*.md`, then `docs/context/IMPLEMENTATION_LOG.md`,
  then PLAN.md's milestone for the work at hand.
- Live gate command: `npm run tester` (build + run); scenario runs via CLI in `src/cli/`.
  A full walking-skeleton run takes ~75s and is deterministic.
- Ports in play: stacksim facade `127.0.0.1:4390`, Muster dev server `5173` — verify no
  stray listeners after runs.
- Runs output to `runs/` (gitignored). Registry state in `~/.ces/tenants` (shared infra —
  only ever clean up `listByKind('sim')` records ces-tester itself created).

## 8. GP-DEMO-1 — CES-wide demo driver (added 2026-07-27)

ces-tester now also hosts the **CES-wide sales-demo harness** (goal
`ces-strategy/docs/goal-pack-2026-07/GP-DEMO-1.md`), driven under a SOLE-ORCHESTRATOR LOCK.
The iteration engine perfects the demo + talk track until the quality curve flattens (Δ<1 &
zero P0/P1 for 3 iterations); baseline was **16/25**.

- **Surface:** `demo:preflight | demo:reset | demo:run [--plan] [--force]` (branch `gp-demo-1`).
- **Modules:** `src/demo/preflight.ts` (build-freshness + port-free), `known-false-fails.ts`
  (REQ core-9 registry + partition), `reset.ts` (unified do-no-harm reset). CLI in
  `src/cli/demo-command.ts`.
- **Ledger:** `docs/demo/DEMO-ITERATION-LOG.md` + `iterations.json` (the done-when instrument).
- **Open:** demo:run's live path is unrehearsed; EO leg (Beat 3) + unified before→after SPRS
  dashboard STAGED for iteration 2; P0-2 (Stamper rotating verify) upstream; P0-3 (narrative
  honesty-tax) is next. See `docs/demo/` and the hub's `docs/context/demo-prep/`.
