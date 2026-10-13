# Goal Document — G-TESTER-1

**Definition of Operational Capability (DOC):** ces-tester is operationally complete when, without
ever reading/writing tenant-stacksim's `store.json`/`ledger.jsonl` directly, regenerating its
PowerShell modules, or reimplementing its az shim (two-entities boundary, PLAN.md "What This Plan
Does NOT Do"):

1. `docs/PHASE0_FINDINGS.md` exists recording answers to all 6 phase-0 inventory items, each cited
   to a specific file/line in the product repo it came from, plus verified open/closed status of
   S1/S2/S3 with evidence (PLAN.md M0 Acceptance Gate; note the S1+S2→M1 rule is stated there
   verbatim, while the S3→M2 gating rule lives in PLAN.md's M2 section — both are mirrored in the
   Gate Ledger below).
2. The stacksim+Stamper half of the interface contract runs end-to-end for one hardcoded scenario:
   console PASS for a true assertion, console FAIL (not a crash) for a falsified one, spawned
   process confirmed as genuine `powershell.exe` (PLAN.md M1 Acceptance Gate).
3. The full walking skeleton — seed via `scenario` materialization → Muster wizard driven headless
   to Mission Plan export → mid-pipeline assertion → Stamper translate+execute → stacksim verify —
   completes for one scenario, run twice in a row, same PASS result both times, both readiness
   checks (stacksim tenant, Muster dev server) actually gating rather than no-ops (PLAN.md M2
   Acceptance Gate).
4. `run-all` discovers and serially runs N scenario files (>=4, including one deliberately-failing)
   via glob with no runner code changes, producing per-assertion structured `result.json` per
   scenario, `diverged_commands` sourced from a real `/ledger` query on mismatch (PLAN.md M3
   Acceptance Gate).
5. **Terminal gate:** opening `dashboard/dashboard.html` directly as a `file://` URL, no server
   running, after 3 consecutive `run-all` invocations (varying which scenario fails), shows correct
   latest-run tiles, a 3-run history strip, and per-scenario drill-in with assertions and a link to
   the preserved stacksim ledger snapshot — fully offline (PLAN.md M4 Acceptance Gate).
6. **Coverage clause:** a generated coverage report states X/503 non-excluded stacksim calls
   exercised by at least one scenario, lists the 20 `manual_only` exclusions by ID with original
   justification carried through, and each of the 6 Stamper session types is named as covered by at
   least one scenario (PLAN.md M5 Acceptance Gate).

M6 (live smoke lane against a real GCC High tenant) and M7 (EvidenceOps dual-verifier lane) are
explicitly **post-DOC lanes** — deferred, built only after M5 is stable (PLAN.md M6/M7).

Loop exit condition = DOC satisfied (M5 gate green, coverage report checked in).

Source: `PLAN.md` (repo root), Milestone Ladder M0–M5 and "Acceptance Criteria" section.

---

## Gate Ledger

| Gate | Blocks | Status (verified 2026-07-11, Session 3 stamp) | Evidence |
|---|---|---|---|
| **S1** — stacksim `seed`/`init-tenant` bypass single-writer server | **M1** | **CLOSED 2026-07-10** — exclusive tenant lock (`.stacksim.lock`, atomic create, pid-liveness): `serve` holds it for its lifetime; `seed`/`scenario` fail loudly (TenantLockedError) against a live holder; `scenario` locks before wiping | stacksim commit `2ebd227`; code read: `TenantLock.ts` imported+acquired in `seed.ts:46`, `ScenarioEngine.ts:104`, `serve.ts:64`; regression test run live by this repo: `backlog-s1-single-writer.test.ts` 5/5 PASS; BACKLOG.md § S1 status line CLOSED (re-checked 2026-07-11, unchanged) |
| **S2** — A8 plural/singular read-shape bug | **M1** | **CLOSED 2026-07-10** — derived cmdlet collections remap to the seeded plural (`Get-MgUser` → `users` returns seeded objects, not `[]`); coverage re-run identical (503/523, 0 FAIL) | stacksim commit `e99e27f`, `src/codegen/deriveResolversFromInventory.ts`; BACKLOG.md § S2 status line CLOSED (re-checked 2026-07-11, unchanged) |
| **S3** — `init-tenant` config isolation (writes into real `~/.stamper/tenants/`) | **M2** | **CLOSED 2026-07-10** — flat `~/.stamper/tenants/` write now opt-in (`--tenantprobe-flat`); default writes nothing to the real dir; pre-existing pollution removed | stacksim commit `fc1c352`; BACKLOG.md § S3 status line CLOSED (residual: TenantProbe.psm1 env-override suggestion filed in stacksim's log, optional); **2026-07-11 addendum (G-TENANT-M4 RESOLUTION)** — A9-class collision also structurally closed via ces-tenant's live/sim registry root split (re-checked 2026-07-11, unchanged) |

**Session 3 re-verification (2026-07-11, this stamp):** all three gates re-checked against
`tenant-stacksim/BACKLOG.md` directly — no change since 2026-07-10/07-11's prior stamps. Live M2
gate re-run twice on today's actual dependency resolution (`ces-tenant` 0.4.0, up from the last
stamp's 0.3.0) — see `docs/context/IMPLEMENTATION_LOG.md` "Session 3" entry. Verdict unchanged:
PARTIAL (mid-pipeline PASS, `expected_state` FAIL on the pre-existing external Stamper
`IA.L2-3.5.3` bug). M0/M1/M2 remain the highest complete milestones; next unblocked work is M3.

**GP-TESTER-1 M1 stamp (2026-07-25/26):** acceptance-criterion 4 (the PLAN.md M3 gate)
executed and recorded for the first time (the 2026-07-12 `dbf797b` landing had no gate
record). **Mechanical criteria PASS**: serial 4-scenario `run-all` completes with
per-assertion `result.json` per scenario; deliberate-fail scenario red with non-empty,
real-`/ledger` `diverged_commands` (runs `gp-m1-gate-1` and `gp-m1-gate-2`); 5th-file glob
pickup with zero code changes proven live (`gp-m1-glob-probe`, 5 discovered) and by unit
test. **Verdict-correctness (3 green + 1 deliberate red) BLOCKED-EXTERNAL** on the rotating
Stamper task-verification failure class (~9–12 of 110 per run, set rotates; NAMED known-red
extending the `IA.L2-3.5.3` precedent — `docs/requirements/REQ-STAMPER-ROTATING-VERIFY-FAIL.md`,
6-run evidence). Two harness defects found by the gate and fixed forward this pass
(crash-proof verifier divergence path; degenerate-plan guard + serve-death observability) —
see IMPLEMENTATION_LOG.md "GP-TESTER-1 M1". Re-verify at GP-TESTER-1 M4 when GP-STAMPER-1
lands. Next unblocked work: M4 dashboard (criterion 5).

**GP-TESTER-1 M2/M4 stamp (2026-07-25/26): acceptance criterion 5 (terminal gate) PASS —
all five G-TESTER-1 acceptance criteria are now satisfied.** The M4 dashboard was built
and gated: 4 consecutive `run-all` invocations (failing set varied: zz alone in runs 1–2,
zz+ab-deliberate-fail-fido in run 4), dashboard opened via `file://` with no server by a
headless-Chromium verifier (`scripts/verify-dashboard.mjs`) — correct latest-run tiles,
4-run history strip, per-scenario drill-down with assertions and working ledger-snapshot
links, zero non-file network requests. Criterion 3's old PARTIAL is also superseded:
IA.L2-3.5.3 was fixed upstream (ces-stamper `5252d90`, G-STAMPER-STAB-1 M1; filed
RESOLVED by GP-STAMPER-1 M2) and the walking skeleton ran GREEN end-to-end in all 6
run-alls today. Evidence: IMPLEMENTATION_LOG.md "GP-TESTER-1 M2"/"GP-TESTER-1 M4";
runs `gp-m2-gate-1..4` retained.

**Operational consequence of S1's lock for this repo's client:** `scenario`/`seed` CANNOT run
while `serve` holds the tenant — the M1+ lifecycle is scenario (no serve) → start serve →
HTTP queries → stop serve, per run.

**Rule:** a gated milestone does not start until a closure record exists for the gate(s) blocking
it — a commit hash, changelog entry, or direct code read of the fixed file, checked against
tenant-stacksim's own tracking (`tenant-stacksim/BACKLOG.md`, Status line per item), per PLAN.md
M0's Acceptance Gate. No re-verification-by-assumption: "probably fixed by now" does not clear a gate.

**S1–S5 are tenant-stacksim work items, filed 2026-07-10 in `tenant-stacksim/BACKLOG.md`** — that
file is the tracking source this Gate Ledger checks for closure records (Status line + commit
hash per item). They are never patched, worked around, or re-implemented from
ces-tester — doing so would violate the two-entities boundary and reopen the single-writer race
(PLAN.md Risk List, "S1/S2/S3 timing"). If stacksim's backlog deprioritizes them, this goal holds at
its current milestone by design.

## Run Protocol

**Iteration-0 preconditions (founder decisions, resolved at HIL before the first run):**
- **Git.** ces-tester is not yet git-initialized (VAULT.md). Before any commit step below can run,
  the founder decides: init a standalone repo here (matching the stacksim precedent,
  founder/ces-stacksim) and whether/when to add a remote. First working branch: `g-tester-1`,
  never master, per house cadence.
- **Session logs** for goal iterations go to this project root: `ces-tester/session-ces-tester-<date>.md`
  — not to ces-strategy (whose scope directive covers strategy work only).

Each iteration of this goal:

1. **Check gates.** Read the Gate Ledger above and **re-verify + re-stamp its verified-date this
   iteration** (direct code read or closure record in tenant-stacksim's tracking) — the table's
   date is only as fresh as its last stamp; never trust a prior iteration's date as current. For
   any milestone whose gate(s) are still OPEN, that milestone is not in play this iteration.
2. **Execute the lowest unblocked milestone slice.** Work top-down through PLAN.md's Milestone
   Ladder (M0 → M1 → M2 → M3 → M4 → M5); do the next task of the first milestone that is (a) not
   yet complete and (b) not blocked by an open gate.
3. **Stop at gates, report, do not route around.** If the only remaining work sits behind an open
   gate, stop and report **BLOCKED-ON-STACKSIM** naming the specific gate(s) (S1/S2/S3) and citing
   the Gate Ledger evidence — do not improvise a workaround (e.g. direct store writes, patching
   stacksim) to keep moving. This is a hard stop, not a soft preference.
4. **Small green slices, verify, commit** on a feature branch (not master) per house working cadence
   — one task or one acceptance sub-check at a time, not a whole milestone in one shot.
   **Commit scope guard:** every commit in this goal touches files under `ces-tester/` only. Never
   sweep sibling checkouts (ces-eo, ces-strategy, tenant-stacksim carry unrelated dirty state);
   check `git status` scope before every commit.

**Today's unblocked work (2026-07-10):** M1/M2 are gated (S1+S2 and S3, all OPEN). The only
unblocked lane is **M0** — the read-only phase-0 inventory (6 items, no orchestrator code),
producing `docs/PHASE0_FINDINGS.md` — plus repo scaffold prep as defined by PLAN.md's M1 task 1
(`package.json`/`tsconfig.json`/`vitest.config.ts` scaffolding is not itself gated, since it writes
no seed/tenant state; only M1's stacksim-client and stamper-launcher tasks 2–6 are gate-blocked).
Do not begin M1 tasks 2–6 or any M2 task until the Gate Ledger shows S1+S2 (M1) or S3 (M2) CLOSED
with cited evidence.
