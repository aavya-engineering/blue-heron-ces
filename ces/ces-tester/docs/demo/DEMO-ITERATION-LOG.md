# GP-DEMO-1 — Demo Iteration Log

Human-readable companion to `iterations.json` (the machine ledger). Goal:
perfect the CES-wide demo + talk track until the per-iteration quality curve
flattens — **combined-score delta < 1 AND zero P0/P1 for 3 consecutive
iterations** (rubric max 25, five axes).

Home repo: `ces-tester` (the demo DRIVER). Driven under the GP-DEMO-1
SOLE-ORCHESTRATOR LOCK — one orchestrator, cross-module authority, do no harm.

## Score curve

| Iter | Date | Combined /25 | Δ | Flawless | Value | Fidelity | TT-relevance | TT-flow | Source |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 2026-07-27 | 16 | — | 2 | 3 | 3 | 4 | 4 | adversarial critique (read-only) |
| 1 | 2026-07-27 | 17 | +1 | 3 | 3 | 3 | 4 | 4 | provisional self-estimate |
| 2 | 2026-07-27 | 18 | +1 | 3 | 3 | 3 | 5 | 4 | adversarial critic (measured) |
| 3 | 2026-07-27 | 20 | +2 | 4 | 3 | 4 | 5 | 4 | adversarial critic (measured) |
| 4 | 2026-07-28 | 21 | +1 | 4 | 4 | 4 | 5 | 4 | adversarial critic (measured) |
| 5 | 2026-07-28 | 19 | **−2** | 3 | 4 | 3 | 5 | 4 | adversarial critic (measured) |

Convergence needs 3 consecutive iterations at Δ<1 **and** zero P0/P1. Iteration 5
**REGRESSED** — the real remediation pipeline works, but the needle is
non-deterministic (a partial Stamper execute under load can even go backwards). The
loop is not converging; the payoff needle is blocked on a deterministic Stamper
execute.

## FINAL STATUS — shipped honest partial (founder decision, 2026-07-28)
The founder chose to **stop the loop at iteration 5 and ship the honest partial** rather than
chase the reliable needle now. Rationale: the demo tells the truth today, and the one thing
blocking a flawless needle is a Stamper-side reliability issue (`REQ-STAMPER-ROTATING-VERIFY-FAIL`
load tail) better owned by GP-STAMPER-1 than papered over here.

**What ships (honest, tested, committed — nothing pushed):**
- `demo:run` — one command, all 5 beats: preflight → spine (all green; self-test scenario excluded)
  → live EO before → real Stamper remediation → live EO after → unified dashboard.
- The dashboard shows a **real** baseline and, because the current Stamper execute is `partial`, an
  **honestly-staged** after (the guard guarantees a regression or a lucky partial never reads as a
  clean needle).
- Talk track v1 (founder-approved). Both HIL gates closed.
- Fixed at source: the P0-2 core-9 + the CA write→read gap (generalizes to 5 CA controls total);
  all sim-fidelity false-FAILs resolved (registry empty, non-masking).

**Known future item (not a defect being hidden — a documented, guarded limitation):** a *reliable*
before→after needle needs a deterministic (complete) Stamper execute. Filed for GP-STAMPER-1 / a
future iteration. The demo is honest about it today.

**Score curve:** 16 → 17 → 18 → 20 → 21 → 19. Peak 21/25 at iter4; iter5 corrected an over-claim
down to a truthful 19. The loop did NOT reach the flat-curve convergence bar — it was stopped by
founder decision, honestly short of convergence.

## Iteration 6 (post-close, founder-directed) — the ONE-demo-run bar; the needle SHIPS

The founder recalibrated the requirement: **"One demo run is what we're wanting"** — not multi-run
determinism under adversarial load. Re-examining the evidence proved them right:
- My iter5 "verification" runs were effectively **load tests** (the orchestration itself — parallel
  agents, builds, suites — was the load). The −10 regression came from the loaded box.
- **Quiet-box runs consistently improve:** +8 (100/110 applied) and the fresh demo-condition
  validation run **+18: 38→56 met, EO detail SPRS −89→−33** (97/110 applied, 61 set-commands,
  ports clean, 325s).
- The failure set = a stable core (~9-10, bit-identical members) + a small drifting tail even when
  quiet. HONEST CORRECTION: the stable core includes tasks declared "resolved" in iter3 — isolated
  resolver round-trips pass, but live in-execute evidence validation still fails them
  (live-vs-isolated discrepancy → Stamper-side diagnosis, GP-STAMPER-1).

**Recalibrated rule (`837d825`):** the real needle renders whenever the after is live and did not
regress, with the execute's failure split printed transparently on the beat ("N known-set + M under
diagnosis", drifters named). Regression or a missing execute report still stages the after. Registry
re-populated from live evidence (the stable 10). Dashboard now rendered from the REAL
demo-condition run. 112/112 tests.

**Net final state: the demo's payoff needle SHIPS under the founder's bar** — one clean run on a
quiet box shows genuine, sizeable movement with the residual failures named on screen. The
GP-STAMPER-1 items remain: (a) live-vs-isolated evidence-validation discrepancy on the stable core,
(b) load-sensitivity of the execute (only matters if the demo box is loaded — don't load it).

**CES-flow canon (founder, 2026-07-28), confirmed in-pipeline:** Muster → Stamper (sole writer;
ledger = attestability) → EO proves, AO modifies; strictly serial in the demo; EO∥AO is the only
sanctioned CES concurrency.

# GP-DEMO-2 — evaluation mode (founder-directed 2026-07-28)

## THE GATE: 5/5 PASS — done-when MET (2026-07-28, run eval-1785299544883)

**"Done when Muster reads 5 different tenant configurations correctly" — achieved.**
`demo:eval --all`: T1 bare, T2 identity-first, T3 half-configured (the demo tenant),
T4 mostly-hardened, T5 decoys — **all 5 PASS: schemaValid=true, readOnly=true
(ledgerDelta=0 — provably zero writes), 0 probe mismatches (11 probes/config)**, exit 0,
ports clean. Evidence preserved: `docs/demo/gate-evidence/` (gate summary + per-config
expected-vs-read tables). The T5 decoy acid test held: policies present under non-CMMC
names earned **no credit** — Muster credits requirements, not artifacts.

## The road there (4 gate attempts — every red was loud and diagnosable)
1. Attempt 1 (0/5): mu CLI schema path cwd-dependent → fixed at source (ces-muster b93e1f6).
2. Attempt 2 (0/5): sim-root/registry-root defaults ALSO cwd-relative (all 201 commands
   degraded) → fixed at source (0685ad4); + the known Node/Windows libuv teardown abort
   made exit codes untrustworthy → eval leg judges the ARTIFACT + ledger proof (0ff8d39).
3. Attempt 3 (0/5, but REAL reads): mismatches collapsed to 3 probes; adjudicated against
   registry commands + per-entry evidence — 2 oracle errors corrected (AC.L2-3.1.18
   aggregate met-by-signIns-evidence → dropped as non-discriminating; PS.L2-3.9.2 aggregate
   met-by-directoryAudits wherever users exist → T2 corrected), 1 REAL finding filed
   (REQ-STACKSIM-GRAPH-CMDLET-IN-EXO-MODULE: Graph cmdlet codegen'd into the EXO shim +
   DISCOVERY-1 silence-vs-unknown semantics). Calibration a916e30.
4. **Attempt 4: 5/5.**

## What GP-DEMO-2 shipped
- Multi-scenario demo framework: `demo:run --scenario <needle|eval>`; `demo:eval
  [--config <id>|--all]` (ces-tester 812859f + calibration commits).
- The evaluation leg: seed → serve → `mu discovery --sim` (ces-muster CLI, 07908ee +
  cwd fixes) → schema validation → **ledger read-only proof** → posture diff (evidence
  per config).
- The 5 ground-truth configs (`scenarios/eval/`) + `EVAL-CONFIGS.md` v2 (oracle-grounded).
- Narrative: `TALK-TRACK-EVAL.md` v0 — **founder HIL review still pending**.
- 3 requirement filings (state-blindness, startsWith passthrough, Graph-cmdlet-in-EXO) +
  2 source fixes in siblings (Invoke-AzRestMethod GET routing 9170eb8; ces-tenant exports
  81507c1).

# GP-DEMO-3 — end-to-end demo + the AdminOps beat (founder-directed 2026-08-29)

## What GP-DEMO-3 shipped
`demo:e2e [--config <id>] [--watch] [--calibrate]` — **one command, six beats, all four UIs
Playwright-driven** (Muster wizard, Stamper GUI, EO SPA, AdminOps GUI), evidence retained under
`runs/e2e/<runId>/`, and a **nine-clause success predicate that alone decides the exit code**.

- **Beat 5 — AdminOps (new).** A-18 "Default User Permission Lockdown" executed **live through
  AO's own GUI**. The proof is artifacts, never a badge: an `adminops_evidence` row for
  `sim-tenant-<slug>` carrying `stateChanged`, a resolved `commandExecuted` and a `sha256Hash`,
  **plus** a stacksim ledger `mutate` inside AO's own window. The beat claims exactly one
  thing — *"evidence of the change was auto-collected"* — because AO's pre/post state reads are
  stubs (REQ-AO-GETTHENSET-PRESTATE-IS-STUB). Pinned by unit test.
- **A config parameter** — `demo-dib-small` (full chain) plus the five eval tenants, whose runs
  report Beats 2/3 as **`n/a`**, never silently skipped.
- **`--watch`** — the same run headed, at 250 ms slowMo, for a human in the room.
- **`docs/demo/PROMPT-E2E-AO-DEMO.md`** — the reusable prompt: preconditions, exact
  invocations, the evidence-reading guide, the pin procedure, per-beat failure meanings, and
  measured durations.

## The live run (M7)
Six runs on a quiet box; every one's evidence retained under `runs/e2e/`.

| Run | Flags | Exit | Clause 5 residue |
|---|---|---|---|
| `m7-run1` | `--calibrate` | 1 | Stamper never reached (wizard + EO blockers) |
| `m7-run1b` | `--calibrate` | **0** | `calibrating` — 19 failures recorded and classified |
| `m7-run2` | none | 1 | 5 unexpected |
| `m7-run3` | none | 1 | 3 unexpected |
| `m7-run4` | none | 1 | 1 unexpected |
| `m7-run5` | none | **0** | **none — all nine clauses PASS** |

Constant across every run that reached them: discovery **11/11 probes matched, ledger delta 0**
(read-only proved); **EO 38/110 → 56/110 met**, 106 live assessments both sides — a real **+18**,
matching GP-DEMO-1's best quiet-box needle; **AO's A-18 applied live with its evidence
auto-collected** (+1 row, +1 ledger mutate).

## What the live run caught — all fixed inside ces-tester, no sibling patched
1. **EO's `/api/assessment` was a permanent 500.** `AssessmentStore.loadLatest()` sorts over
   foreign scope-pointer records in the shared `ces.db` and throws
   (**REQ-EO-ASSESSMENT-SCOPE-POINTER-CRASH**, HIGH — it also breaks the older `demo:run` EO
   leg on any box with an aged database). Fixed our side with a **per-EO-beat run-scoped
   `CES_PIPELINE_ROOT`**, plus EO server logs captured per beat.
2. **Pre-flight could not see an IPv6-only listener.** An orphaned `ces-muster` vite dev server
   held `::1:5173`; pre-flight said "free"; the Muster leg then drove **the wrong product's
   SPA**. `probePort` now probes both loopback families.
3. **Twenty-two plan variables nothing supplies** — seeded from the sim's own data. Two of
   them corrected M4's assumption that "has a producer" implies "the producer runs" (the
   producers are evidence-only or idempotently skipped), and the last fifteen were
   **enumerated from the Stamper registries** rather than discovered one 19-minute run at a
   time. Three names in the same gap were deliberately left unseeded — this plan never uses
   them, and one is a credential.

## Clause 5, calibrated honestly (the integrity step)
The first post-seed execute produced **91/110 completed, 19 failures** (M0's pre-seed run: 30;
the final runs reach **96/110**). Every entry was classified before anything was pinned:
**10 were ours** (missing seeds — fixed, not pinned), **9 were pinned** against a demonstrated
sibling cause — 6 verification failures that tenant-stacksim's *own* coverage report records as
`set: PASS` in isolation (REQ-STAMPER-ROTATING-VERIFY-FAIL) and 3 capture cascades
(**REQ-STAMPER-SUBCOMMAND-CAPTURES-NOT-RUN**, filed this run). Each later run surfaced only
failures that its predecessor had made reachable, split the same way, until the pinned set
settled at **16 ids** (11 verification + 5 capture cascades; 13 of them observed as a primary
failure id, 3 pinned by name because they only ever appear inside a compound error message
beside a sibling id) — for scale, the CLI leg's founder-approved registry is ten.

**Nothing was transcribed wholesale**, no id was pinned without a demonstrated sibling cause,
and only re-translation-stable ids may be pinned at all: a plan `task_id` carries a
per-translation suffix, so the report parser now resolves identity as entry-id → control-id →
task-id, and a test refuses any `step_task_*` id in the pinned set.

## Standing items
- **8 REQs** filed by GP-DEMO-3 (six in M0, two in M7). None actioned in a sibling; none should
  be by this repo.
- Two sim certificates remain in `Cert:\CurrentUser\My` (`2F91…` from M0, `976D…` from M7) —
  founder cleanup at demo close.
- The demo's honest residue is on screen every run: a `partial` Stamper execute with its
  failures named, and Beat 1 described as a presence-based read rather than gap-finding.

## Iteration 0 — baseline (read-only)
The prep workflow (`ces-demo-prep`, 8 agents) mapped the demo across all five
modules, drafted talk-track v0, and ran a two-adversary critique (skeptical DIB
buyer + demo-ops engineer). Baseline **16/25**, carrying **2 P0 + 8 P1**. Verdict:
strong talk track, weak integration — "the runnable demo is pre-M1." Artifacts live
in the hub at `ces-strategy/docs/context/demo-prep/` (readiness map, talk-track v0,
critique, five module maps).

Top finding (P0-1): the demo does not exist as one flow — four single-writer
servers, five launch idioms, and the closest spine (`npm run tester`) excludes EO
and the SPRS surface. Recommended #1 fix: **build the integrated
`demo:run`/`demo:reset` harness.**

## Iteration 1 — harness foundation (this session)
Executed the critique's #1 fix, scoped to what is deterministic and fully testable
without booting all four live servers (the live EO leg + unified SPRS dashboard need
live rehearsal → iteration 2).

**Landed in `ces-tester` (branch `gp-demo-1`):**
- `src/demo/preflight.ts` — build-freshness (src-vs-dist mtime) + port-free probe
  for 4390/5173/3000/4002; refuses a demo start if any build is stale or any port
  occupied. *(P1-7, P1-8)*
- `src/demo/known-false-fails.ts` — the `REQ-STAMPER-ROTATING-VERIFY-FAIL`
  deterministic **core-9** registry + a `partitionFailures` that splits a run's
  reds into *explained / unexpected / stale-skip*, so the demo is deterministically
  green on the sold beats while any genuinely-new red is surfaced — and the list
  shrinks honestly as upstream fixes land. *(P1-5, de-risks P0-2)*
- `src/demo/reset.ts` — unified reset (tenant reset [wire pending], stale-lock,
  `runs/`, throwaway EO storage, port report). **Do-no-harm:** ports are *reported*,
  not force-killed (mis-identifying an owner could kill an unrelated process).
  *(P1-8, M1 "one to reset")*
- `src/cli/demo-command.ts` + `index.ts` wiring — `demo:preflight`, `demo:reset`,
  `demo:run [--plan] [--force]`. `demo:run` gates on pre-flight, drives the proven
  seed→Muster→Stamper→verify spine, regenerates the dashboard, and **prints** the
  staged status of Beat 3 (EO) + the unified SPRS dashboard rather than silently
  omitting them. *(P0-1, partial)*

**Verification:** 85/85 vitest (was 64; +21 across three new suites), `tsc --noEmit`
clean, build clean, mojibake 0. `demo:preflight`, `demo:run --plan`, and `demo:reset`
all exercised live and behave correctly (all builds fresh, all ports free).

**Still open (why the loop is not flat):**
- **P0-1 not fully closed** — EO leg (Beat 3) and the unified before→after SPRS
  dashboard are STAGED for iteration 2 (need live rehearsal).
- **P0-2** is upstream (GP-STAMPER-1); the harness now *annotates* it, does not fix it.
- **P0-3** (honesty-tax narrative reframe) is the next iteration's highest-value fix.
- **No proven flawless live end-to-end run yet** — `demo:run`'s live path is unrehearsed.

## Iteration 2 — live proof + narrative reframe + reset wiring
Landed (branch `gp-demo-1`):
- **Live pipeline PROVEN** — a real `run-m2` (stacksim seed → real Muster wizard via
  Playwright → real Stamper execute → verify) passed end-to-end: exit 0, 3/3 assertions,
  0 diverged commands, all four ports cleaned up afterward (do-no-harm confirmed). This
  converts "pre-M1, unrunnable" into "the spine runs live and clean" — on a quiet machine.
- **Talk-track v1** (`905c7cd`) — the P0-3 honesty-tax reframe (five per-beat concessions →
  one upfront "What's real" frame; the sim→your-tenant bridge is now the *opening* promise,
  the close a callback) + the P1-10 transfer rebuttal (same Microsoft Graph surface; only the
  connector cutover is pending). `docs/demo/TALK-TRACK.md`.
- **Tenant reset wired** — `demo:reset` now re-materializes `demo-dib-small` to pristine via
  stacksim's own `demo:reset` contract (live-verified DONE, was `skipped`). Closes the
  critic's NEW-P1.

**Critic-measured score: 18/25** (Flawless 3, Value 3, Fidelity 3, TT-relevance **5**,
TT-flow 4). **CLOSED:** P0-3, P1-7, P1-10. **Still open:** P0-2 (upstream + unproven under
load — the biggest live threat), P0-1 (full 5-beat run not yet proven end-to-end), P1-4
(unified SPRS dashboard), P1-6 (EO leg canned), P1-8 (ports still report-only), P1-9, P1-5.

## Iteration 3 — P0-2 fixed at the source (founder ruling)
The founder ruled "fix P0-2 at the source." A read-only diagnosis (running each core-9 task's
write→read-back through the real resolver + Stamper's verifier) showed the **core-9 was stale**:
5 already round-tripped green (pre-existing sim fixes), **4 were real tenant-stacksim gaps**, **0
were Stamper template bugs** (`docs/demo/P0-2-SOURCE-WORKLIST.md`).

Landed:
- **4 fixes in tenant-stacksim** (branch `gp-demo-1-stacksim-p02`): `56ae777` dlp-policy (honor
  `-Identity` on named-cmdlet GET + key POST by natural id), `495e9be` malware-rule + anti-phish
  (server-computed `creationDefaults`, args win), `75b84ef` member-add (`@odata.id` → `groupMember`).
  **144/144** sim tests (+3 round-trip), tsc clean, sim-transparency respected (verified the diff).
- **Live re-measure** (`demo:run`/run-all): `exo-protection` (anti-phish/malware/safe-attach) and
  `audit-logging` **PASS live** — no regression. Only reds: the deliberate `zz-fail` and the
  pre-existing PENDING-LIVE `remote-maintenance` CA write→read gap.
- **Registry shrunk to empty** (`a4893ac`): the 9 move to `RESOLVED_FALSE_FAILS` (history);
  `partitionFailures` now reports any live red as **unexpected** — the non-masking close.

**Critic-measured 20/25** (Flawlessness 3→4, Fidelity 3→4). **CLOSED: P0-2.** New finding: the
`remote-maintenance` CA write→read gap (same class as member-add) — a candidate for the next
fix-at-source, tracked as a loud honest red, not a mask.

## Iteration 4 — the demo becomes one live flow
Built + integrated the last two pieces and wired the single command.
- **Unified before→after SPRS dashboard** (`0429bf3`) — `src/results/unified-dashboard.ts` +
  `demo:dashboard`; offline, self-contained (P1-4).
- **EO leg** (`59fe862`) — `src/demo/eo-leg.ts` drives ces-eo's real :4002 connect+assess against
  the served demo tenant; **live-verified**: 106 assessments, 38 met / 35 not_met (EO detail SPRS
  −89), matching the known-good reference; P1-9 env fragility beaten (strips every `PSModulePath`
  casing); self-gates + degrades gracefully (P1-6).
- **`demo:run` Beat 3/4 wiring** (`8e780da`) — one command now: preflight → spine → live EO →
  unified dashboard. `buildUnifiedFromEo` is **honest**: it surfaces EO's real baseline and marks the
  remediation-driven needle STAGED rather than fabricate movement (one-SPRS rule respected). Full
  5-beat rehearsal ran end-to-end, ports freed (P0-1).
- **Demo-scenario exclude** (`c78a3f4`) — `demo:run` skips the `zz-deliberate-fail` self-test.

**Critic-measured 21/25** (Value 3→4). **CLOSED: P0-1, P1-4, P1-6.** All three original P0s
(P0-1/P0-2/P0-3) are now closed.

**Open (why not flat):**
- **The real needle** — the live dashboard shows before==after (no fabrication); genuine SPRS
  movement needs the Muster headline (before) + Stamper remediation + EO re-assess (after) on
  demo-dib-small. This is the emotional payoff.
- **remote-maintenance CA write→read gap** — keeps `demo:run` exit non-zero; next fix-at-source
  (same pattern as the core-9 member-add fix).
- **Beat-plan vs run-all-proxy** — narration overstates; align it or build the dedicated
  demo-dib-small Muster+Stamper pipeline.

## Iteration 5 — real needle built, then caught non-deterministic (REGRESSED 21→19)
Built the genuine pipeline: reset → serve → EO assess(before) → Muster wizard (Playwright) → Stamper
execute → EO assess(after), rendering the real delta (`needle-run.ts`, `24e2640`). Also fixed the
CA write→read gap at source (tenant-stacksim `5702bd7`, generalizes to 4 more CA controls) and the
remote-maintenance scenario's stale assertions (`5924327`) — closing the last non-deliberate spine red.

**But a critic re-score caught a real integrity problem** (verified against the run artifacts): the
needle is **non-deterministic**. Two live runs of the identical pipeline gave **38→46 (+8)** and
**38→28 (−10 regression)** — and *both* Stamper executes were `partial`. My "+8, the needle moves"
was one lucky partial run, baked into the committed dashboard. Root cause: the load-induced Stamper
execute instability (the `REQ-STAMPER-ROTATING-VERIFY-FAIL` tail) — a partial apply under load is
non-reproducible and can break previously-passing controls.

**Honesty guard** (`94001b5`): the needle now shows a real delta **only** when the after is live,
the execute **completed**, and the after did not regress; otherwise real-before + honestly-staged
after with the reason. A load-induced regression can never reach the buyer's screen; a lucky partial
is never sold as reliable. Dashboard regenerated honestly (baked +8 removed). 111/111 tests.

**Critic-measured 19/25** (Flawlessness 4→3, Fidelity 4→3). The loop **regressed** — the real,
*reliable* needle is blocked until the Stamper execute is deterministic.

## Next iteration (6) — planned (critic's #1 fix)
**Make the Stamper execute deterministic / complete** so before→after improves on *every* run — the
real `REQ-STAMPER-ROTATING-VERIFY-FAIL` load tail (Stamper-side, not the demo harness): options
include a retry-to-completion loop, serialized/unloaded execute, or a Stamper reliability fix. Until
the execute completes reproducibly, the demo honestly shows a real before + staged after (guard in
place). Only then does the payoff needle become flawless. Lower-priority follow-ons: per-control
findings detail (mapControlDetail returned [] live), and surfacing Muster's certified headline SPRS.

## GP-DEMO-4 — demo:show iteration log

The presentation demo runner (`docs/demo/PLAN-DEMO-TOOL.md`). Appended below GP-DEMO-1's
iterations 1-5; nothing above this heading is rewritten. One entry per loop pass.

**Acronym legend (this section):** S0-S6 = build slices of the plan's loop; A1-A8 = the plan's
acceptance checks; TT = talk track (the narration column); Op = the app-pane action a slide is
paired with (`live`/`warm`/`staged`); FD-1..FD-4 = the four founder decisions of 2026-09-03.

### Pass 1 — S0 (deps + fixture generator) + S1 (loader + validation)

**Built.** `read-excel-file` (dep) + `fflate` (devDep) installed. `scripts/make-demo-xlsx.mjs`
emits `demos/ces-overview.xlsx` — 8 slides across 11 rows, three multi-row slides (2, 5, 7), a
mix of `staged`/`warm`/`live`, and one blank duration (slide 3). Loader/validator/model landed as
`src/demo/show/{deck-model,xlsx-loader,deck-validate}.ts` + `schemas/demo-deck.schema.json`.

**Gates.** `npx tsc --noEmit` clean. `npm test` 361/361 (was 343; +18 new).

**Findings.**
- **Inline strings work.** `read-excel-file@9.3.10` reads `t="inlineStr"` cells fine, so the
  plan's `sharedStrings.xml` fallback was NOT needed. Blank cells arrive as `null`, as researched.
- **fflate `zipSync` rejects the epoch.** `mtime: new Date(0)` throws `date not in range
  1980-2099`, and fflate reads the LOCAL year — a `Date.UTC(1980,0,1)` lands in 1979 west of
  Greenwich and throws too. Fixed at `new Date(2020, 0, 1)` (local constructor).
- **ajv's `data is T` guard narrows the argument to `never`** in the failure arm under `strict`.
  Validating through a separate `unknown` binding is the fix; noted because the house pattern in
  `scenarios/scenarioFile.ts` does not hit it (it discards the boolean).
- **A2 and A3 pass at the model level.** Grouping is asserted against the real generated .xlsx
  (round trip), error messages against hand-built grids.

**Gaps opened.** None. `--check` (A1) needs S2; A4-A8 need S3+.

### Pass 2 — S2 (render + state + `--check` runner)

**Built.** `src/demo/show/{show-state,slide-render}.ts`, `src/cli/show-command.ts`, registered as
`demo:show` in `src/cli/index.ts`, plus `npm run demo:show` / `npm run make-demo-xlsx`.

**Gates.** `npx tsc --noEmit` clean. `npm test` 405/405 (+44 this pass).

**Acceptance checks run.**
- **A1 PASS (live).** `node bin/ces-tester.mjs demo:show --check demos/ces-overview.xlsx` exits 0:
  8 slides, 11 rows, walk front-to-back with ops forced staged, slide 3 correctly reported as
  `30s (default)`.
- **A3 PASS (live).** A deliberately malformed deck (bad `op mode`, non-integer `slide #`,
  non-numeric duration, unknown tool, unknown op id) printed **all five** errors, each citing the
  1-based sheet row, and exited **2** with "nothing was rendered".
- **A2 PASS** (unit, pass 1). **A5/A6 PASS at the state level** — nav, per-slide duration,
  30 s fallback, `--manual`, and FD-3's hold are all asserted against an injected clock.

**Decisions taken where the plan was ambiguous (all logged as deviations in
`docs/context/IMPLEMENTATION_LOG.md`).**
- `show-command.ts` + CLI registration moved from S3 into **S2**, because the plan puts `--check`
  in S2 but the command file in S3 and `--check` is unreachable without it. S3 extends the same
  file with operator flags rather than creating a second one.
- **Hold semantics sharpened.** FD-3 says a running op "holds past the dwell"; implemented as *the
  dwell has not started* — no deadline while the op is outstanding, deadline set to `now + dwell`
  when the op reports `done`/`failed`. Same observable behaviour, and it means the slide gets its
  full authored dwell WITH the result on screen rather than a dwell that already expired.
- **Slide HTML is rendered in TypeScript and shipped inside the inlined JSON**, not assembled by
  page script. That is what lets `--check` prove "every slide renders" by calling the exact
  function the live window uses — one renderer, no drift.
- The last slide is a **wall, not a wrap**: `next` at the end stops auto-pacing instead of looping.

**Gaps opened.** `demo:show` without `--check` currently refuses with "the operator run is not
wired yet" — S3 closes it. A4/A7/A8 untouched.

### Pass 3 — S3 (slides server + two positioned windows + operator runner)

**Built.** `src/demo/show/{slides-server,app-pane,show-run}.ts`, `openPositionedUiPage()` added
beside `openUiPage` in `src/demo/ui-page.ts` (existing signature untouched), operator flags
(`--slides-window`, `--app-window`) wired into `show-command.ts`.

**Gates.** `npx tsc --noEmit` clean. `npm test` 426/426 (+21 this pass).

**Acceptance checks run.**
- **A1 re-run PASS** — no regression from S2.
- **A5 PASS (headless, real browser).** A real headless Chromium loaded the real slides page from
  the real server and drove it end to end: `ArrowRight` x2, `End`, `Home`, `ArrowLeft` (clamped at
  0), `t` (presenter band hid), `Escape` (server `exited=true`, page overlay shown). Every
  keystroke went page keydown -> `POST /nav` -> reducer -> SSE -> re-render.
- **A6 PASS (unit + server).** Per-slide duration, 30 s default, and the hold are asserted against
  an injected clock, including at the server level where the pacing loop actually lives.
- **A8 PASS (headless).** Disposers run in reverse (`app pane`, then `slides window`), they still
  run when opening the app pane throws, raw mode is restored, and a real server on 4500 released
  the port cleanly (verified by re-binding it immediately after `stop()`).
- **A4 verified-headless.** `openPositionedUiPage` produced a window whose page reported
  `innerWidth/innerHeight = 1280x720` — proof that `--window-size` + `viewport: null` took effect
  rather than Playwright's forced 1280x720 viewport inside some other window. Placement itself
  (left/right on the desktop) needs an operator's eyes.

**Findings.**
- **`viewport: null` is doing real work.** Without it the page would report Playwright's viewport
  and the 16:9 stage would letterbox inside the wrong box.
- **The op scheduler needed a null guard.** `onChange` fires from the server's pacing loop, which
  starts ticking before the browser windows finish launching. `startOpFor` is assigned after the
  pane exists and the handler checks for it — otherwise a deck with a sub-second first slide would
  hit a TDZ error at launch.
- **Assets are served BY ID, not by path.** `/asset/<id>` looks the id up in the deck's own asset
  table, so there is no path for a request to traverse; five traversal attempts all 404.

**Gaps opened.** `makeOps` is not yet wired into the CLI path, so a live/warm slide currently
reports `no op runner is wired for this run`. S4 closes it.

### Pass 4 — S4 (op registry + staged/warm plumbing) + S5 (the first real live op)

**Gated as ONE pass, deliberately.** `op-registry.ts`'s default implementation table IS the S5 op
(`ao-registry`) and its default arming IS `arm-sim.ts`. Splitting them would have meant writing a
placeholder table in S4 and deleting it in S5 — churn with no verification value, since the gate
that matters (a real AO GUI driven end to end) only exists once both halves are in.

**Built.** `src/demo/show/op-registry.ts`, `src/demo/show/arm-sim.ts`,
`src/demo/show/ops/ao-registry-op.ts`, a `reveal` hook on `ShowOpRunner`, and `makeShowOps` wired
into the CLI's default `runShow` call (closing pass 3's gap).

**Gates.** `npx tsc --noEmit` clean. `npm test` 438/438 (+12 this pass).

**Acceptance checks run.**
- **A1 / A3 re-run PASS** through the built CLI — exit 0 and exit 2 respectively, no regression.
- **A7 PASS (headless, real).** Arming ran for real — seeded `demo-dib-small` to pristine, brought
  up stacksim serve on :4390, generated and installed the sim cert, started `ao gui` on :3001 — and
  the real `runAoRegistryOp` drove that GUI in a real (headless) app pane: **status badge
  "SUCCESS", evidence outcome "automated_success", 3 screenshots**, in 10.4 s total. Nothing was
  stubbed.
- **A4/A5/A6/A8 PASS in a full headless dress rehearsal** of `runShow` with the real op registry:
  both windows opened at their declared geometries, the warm op started during prep, walking
  slides 2→6 left the app pane still on the AO GUI (the staged slides correctly did not touch it),
  slide 7 **held** (`remainingSec === null`) until its live op completed, the live op queued behind
  the still-running warm op instead of interleaving on the one page, and teardown released **all
  three** ports (4500, 4390, 3001), verified by re-binding each.

**Findings.**
- **The op queue is not optional.** Advancing to slide 7 while slide 6's warm drive was still in
  flight is a normal operator action, and without the single-lane queue two Playwright flows would
  have interleaved on one page. The rehearsal reproduced exactly that sequence and the queue held.
- **Staged slides must NOT navigate the pane.** If they did, slides 2-5 would wipe the warm AO
  result before slide 6 arrived — the entire point of `warm`. Rule implemented: a slide that
  declares no op leaves the pane alone; a slide that declares an op but is `staged` shows an honest
  replay placeholder that never fabricates a result.
- **A GUI dry-run against the sim is structurally impossible** (`ao-ui-driver.ts` header,
  M0-verified: the AO front end hardcodes tenant `dev` whenever the live toggle is off). The plan
  asked for a Tier-1 dryRun; the op runs LIVE against the throwaway ephemeral sim slug instead,
  which is the proven path and mutates nothing real. Logged as a deviation.
- **The plan's arming helper list omits seeding.** Without `resetDemoDibSmallTenant`, `startServe`
  comes up healthy against an unmaterialized tenant. Added, per `e2e-run.ts` Beat 0's order.
- **Ports are probed before anything is spawned.** `preflight.ts`'s own header records a live run
  where an orphaned listener made the harness drive a different product's SPA while every check
  looked green; arming now refuses to start rather than risk demoing the wrong tenant.

**Gaps opened.** None. A4/A7/A8 remain verified-headless — window PLACEMENT on the physical desktop
and the audience-facing look of the two windows still want one operator run (see
`docs/context/IMPLEMENTATION_LOG.md` for the exact manual steps).

### Pass 5 — S6 (close-out)

Nothing from passes 1-4 was left open, so S6 was a verification pass rather than a fix pass:
`npx tsc --noEmit` clean, `npm test` **438/438**, `demo:show --check demos/ces-overview.xlsx`
exit **0**, malformed deck exit **2**. A1, A2, A3, A5, A6 pass; A4, A7, A8 pass headlessly and want
one operator run for the parts only eyes can judge.

### Pass 6 — two A8 defects found in review, fixed and re-verified

The loop's own evidence caught both; neither was visible from the tests.

**Defect 1 — every run installed a NEW certificate into the operator's personal store.**
`arm-sim.ts` called `ensureSimCert({ outDir })` with no `knownThumbprint`, so the two live
rehearsals in pass 4 left two *different* thumbprints (`F124F1B5…`, `094947CC…`) in
`Cert:\CurrentUser\My`. A demo machine would collect one certificate per rehearsal. `e2e-run.ts`
caches a thumbprint in `runs/e2e/sim-cert-state.json` for exactly this reason; arming had copied
Beat 0's ORDER but not its caching. Fixed with the same pattern at
`runs/show/sim-cert-state.json`.

**Verified live:** two consecutive armings — the first reported `via 'ces-tester'` (generated), the
second `via 'already-present'` with the *identical* thumbprint. One cert, not two.

**Defect 2 — Ctrl-C during prep orphaned the armed servers.** The `SIGINT`/`SIGTERM` handlers were
registered *after* prep. Arming is the longest phase and the one that spawns the most processes
(stacksim serve, `ao gui`), so it is the likeliest moment for an operator to hit Ctrl-C — and with
no listener, Node hard-exits, `finally` never runs, and both servers survive. Precisely the A8
failure mode, in precisely the worst window. Handlers moved to immediately after the slides-server
disposer, before either browser opens; a signal during prep now falls through to teardown and skips
starting the deck.

**Gates.** `npx tsc --noEmit` clean. `npm test` **440/440** (+2: one pinning that a SIGINT listener
exists *during* prep, one pinning that a signal mid-prep tears down without warming anything).

**Acceptance re-runs.** A1 exit 0. Full headless dress rehearsal re-run end to end: arming reused
the cached cert, the warm AO op reached `SUCCESS` / `automated_success`, and ports 4500, 4390 and
3001 were all released.
