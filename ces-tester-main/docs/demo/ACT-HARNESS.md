# `demo:acts-test` — the demo-act test harness

**What it is.** A committed harness that runs each **implemented** demo-act against the real
environment and mechanically judges the three things the founder named:

| Axis | Question | How it is judged |
|---|---|---|
| **Works well** | Does the act do what `DEMO-ACTS-DOSSIER.md` says it does? | The entry's `SUCCESS (TESTABLE)` clauses, **artifact-first** |
| **Paced well** | Is the wall time what we tell people it is? | Measured `armMs` + per-op ms vs `OP_CATALOG[id].typicalWarmMs` and the dossier's timing prose |
| **Documented well** | Does the dossier still describe the code? | Rules `DD1`-`DD11` below. **Doc-drift is a first-class failure** |

> **Why a harness and not more unit tests.** A unit test cannot prove a port is free after
> teardown, that the Configuration GUI never reached the *visible* pane, or that an artifact
> reached the finished run report. Those are the claims the demo makes on stage.

---

## Invocation

```
node bin/ces-tester.mjs demo:acts-test [tier] [--act <groupId>] [--run-id <id>]
                                       [--from-report <path>]
                                       [--stacksim-root <dir>] [--ao-root <dir>]
                                       [--eo-root <dir>] [--stamper-root <dir>]
                                       [--muster-root <dir>]
```

`npm run demo:acts-test -- --docs-only` builds first, then runs it.

### Tiers

| Tier flag | Act groups run | Ports armed | Typical wall time |
|---|---|---|---|
| `--docs-only` *(default)* | none | none | < 1 s |
| `--quick` | `muster-readiness`, `ao-registry` | 4390, 3001, 4173 | ~2 min |
| `--full` | `muster-readiness`, `ao-registry`, `ao-make-change`, `eo-review`, `eo-verify-evidence`, `eo-show-change-captured`, `simstack-create`, `simstack-destroy`, `muster-gui`, `stamper` | 4390, 3001, 4002, 3000, 4173 | ~25 min |

**The docs check runs in every tier**, including `--docs-only`.

`--act <groupId>` **overrides** the tier with exactly that one group, and is repeatable.
Combining `--act` with `--quick` or `--full` is **exit 2** with a message naming both — a tier
and an explicit group set are two different intents and silently picking one hides a typo.

`--from-report <path>` re-analyses a prior run's `acts-report.json` without re-running it.

### Exit codes — the same three `demo:show --check` uses

| Code | Meaning |
|---|---|
| **0** | Everything checked passed |
| **1** | Checked and failed. **An honest `act-red` lands here** — it is an accepted outcome, recorded and never pinned |
| **2** | Bad invocation, or the harness **could not run** (missing dossier, missing sibling build, runtime unavailable) |

`2` is never used for "the act is broken". If the operator prerequisite
`../ces-muster/muster-api/dist/cli/bin.js` is missing, the harness exits **2** naming the path
and the `npm run build` remedy — it does not fail `MR1` as though the act were broken.
**ces-tester never builds a sibling.**

---

## `--docs-only` spawns nothing

No browser, no server, no sibling process. The runtime half is reached **only** through a
dynamic `import('../demo/acts/act-run.js')` gated on tier, so a docs run never loads
`op-registry.ts` and therefore never loads Playwright.
`tests/demo-acts-docs-check.test.ts` proves this by walking the transitive source graph
reachable from `docs-check.ts` and asserting zero hits for `playwright` and
`node:child_process`.

Note the assertion is *"no browser, no server, no sibling"* — **not** "declaration-layer only".
`docs-check.ts` imports `xlsx-loader.ts` for the column vocabulary, and that module
value-imports `read-excel-file/node`. It is a real module; it just does not spawn anything.

---

## The documentation rules

Rule ids are **stable**. Each fires on `DEMO-ACTS-DOSSIER.md` (repo root).

| Rule | What it proves | Severity |
|---|---|---|
| **DD1** | Every `DEMO_OP_IDS` member is the `ID` of at least one dossier entry — no act ships undocumented | FAIL |
| **DD2** | Every entry fills all 16 section C template fields, **inline or block-style**, non-empty | FAIL |
| **DD3** | An entry that is `PROPOSED` while its op id and qualifiers are invocable in a deck **today** | FAIL |
| **DD3b** | The converse: `IMPLEMENTED` while no deck can name it | FAIL |
| **DD4** | `IN-BUILD` with a registered id — the build landed and nobody re-stamped the entry. **`IN-BUILD` is carved out of DD3** so a drifted entry yields exactly one status finding, not two | FAIL |
| **DD5** | Every `OP_CATALOG[id]` param key appears on a `PARAMS` line, **unioned per-id** across every entry sharing that id (the dossier deliberately splits `eo-review` into three act views) | FAIL |
| **DD5b** | Reverse drift: a param-shaped token on a `PARAMS` line that is not a catalog key for that id | WARN |
| **DD6** | Stale-future prose (`Slice 4a` / `None today` / `does not exist`) on a registered id whose catalog entry already declares parameters | FAIL |
| **DD6b** | A `STATUS` that blocks on a section A.1 artifact **that now exists**. Trigger phrases are a closed list — `does not exist`, `not selectable without`, `needs the` — extended only by plan revision, because a paraphrase-matching rule has a count nobody can derive from the files. This is the clause that reaches `ao-make-change`, which has no catalog entry and so can never trigger DD6 | FAIL |
| **DD7** | Each artifact in section A.1's *"What does NOT exist yet"* block is probed. One that exists is stale doc | FAIL |
| **DD8** | The two section E items carrying a mechanical probe: **E4** (the `params` column) and **E11** (`ShowOpContext.artifact` inert). E5 was re-verified still true; E1/E2/E3/E6/E9/E10 have no probe and are deliberately not tested | FAIL |
| **DD9** | A `PROPOSED` entry is checked for template completeness only, and reported **`skipped`** at runtime — never failed. Independent of DD3: an entry can be runtime-skipped *and* a docs FAIL | SKIP |
| **DD10** | Minute-valued timing prose vs `typicalWarmMs`, flagged **strictly outside** [0.5x, 2.0x] — 2.0x exactly passes, which is a decision. Severity is `DD10_SEVERITY`: `warn` while the catalog values are guesses, `fail` once they are measured evidence | `DD10_SEVERITY` |
| **DD11** | AS OF freshness | WARN |

### Two DD11 refinements worth knowing before you "fix" them

1. **The sha sub-check does not demand equality with `git HEAD`.** It cannot: the commit that
   re-stamps AS OF cannot know its own hash, so a strict check reds forever after the first
   re-stamp. It asserts the named commit is a **real commit of this repository** (HEAD, or
   present in the reflog), which still catches a typo or a hash carried in from another
   checkout. It goes inert when `.git/logs/HEAD` is absent.
2. **The build-state sub-check probes the claim, not the working tree.** "Does not claim an
   in-flight executor *when the tree is clean*" is inert here — this tree is never clean
   (untracked session logs). Instead: an AS OF that says a build is mid-write, while every act
   the dossier lists as `IN-BUILD` is registered **and** has its implementation module on disk,
   is describing a build that already landed. A genuine in-flight executor has un-registered
   ops and will not trip it.

**Consequence, stated so nobody reads it as a harness defect:** the real-dossier test asserts
zero FAIL and zero WARN, so cutting a new branch without re-stamping the AS OF `Branch / HEAD`
cell makes `npm test` fail. That is DD11 doing its job. Re-stamp the block; do not relax the rule.

---

## The runtime checks

An **act group** is the unit, because ordering-dependent acts must run in one lifecycle:
`eo-review` warm then live (D.13 → D.14), and `stamper-translate` then `stamper-execute`
(D.9 → D.10).

| Group | Checks |
|---|---|
| `muster-readiness` | **MR1** the artifact parses with an `observations` array · **MR2** `tallyPostures()`'s five buckets sum to `observations.length` and name all four `READINESS_POSTURES` · **MR3** ledger delta recorded (**advisory** — the op does not gate on it) · **MR4** a log line carries `NO_SCORE_LINE` verbatim · **MR5** the artifact reached `ctx.artifact` **and appears in the finished report** · **MR6** (GP-DEMO-5 streamgui — `warm` dropped) the **live** run completes AND imports this run's result into the Muster SPA (:4173), landing on `boundary-confirm-panel` with the fixture `discovery-summary` **absent** — a degrade to the readout card is classed `environment` |
| `ao-registry` | **AO1** warm and live agree (the op does not branch) · **AO2** at least one screenshot registered *and* present on disk · **AO3** the AO evidence record exists and names the executed command · **AO4** unarmed AO produces the specific arming error, not a timeout |
| `eo-review` | **EO1** `hasRenderedAssessment` after warm · **EO2** screenshots, **condition-aware**: `-01` always, `-02` only when the family had rows, `-03-<landing>` matching the resolved `land`. A missing `-02` on an empty family is classed **`environment`**, never `act-red` · **EO3** `/api/assessment` + `/api/sprs` asserted **numerically** · **EO4** the honest `LIVE SIGNAL LEG DID NOT RUN` line when the live leg did not run · **EO5** still hydrated after live |
| `ao-make-change` | The remediating governed change (D.12), one live slide of `ao-registry`'s flow under a distinct id. **AM1** the command executed against the sim slug (op done + status logged) · **AM2** at least one screenshot registered *and* present · **AM3** the AO evidence row NAMES the command *and* carries `stateChanged=true` — the artifact proves both execution and the state change · **AM4** unarmed AO produces the specific arming error, off the pane |
| `muster-gui` | The Muster SPA acts (D.4-D.8), ONE group grown per slice against the armed Vite preview (:4173). Each op captures its DOM state into a facts artifact while it is fresh (the group grows, so the pane has moved on by judge time). **3.0** `muster-connect-tenant` — **MU-C1** the manifest carried the declared values and `begin-interview` was reachable (left UNCLICKED). **3.1** `muster-auto-analysis` (the honesty centerpiece) — **MA1** the CLI artifact is a `readiness-result/1.0.0` · **MA2** the walk is read-only (ledger create+mutate delta 0) · **MA3** the fixture signature is ABSENT (a readiness-result of the real walk's size, not the 14-row fixture — the non-vacuous re-pin) · **MA4** the import landed on `boundary-confirm-panel`, NOT the fixture branch's `discovery-summary`. The driver NEVER clicks `discovery-run-btn`. **3.2** `muster-consent-and-attest` — **MC1** `boundary-confirm-panel` visible · **MC2** a blank confirmer name is rejected (a draft confirm is `disabled` while blank, enabled after; pruning-only runs record that) · **MC3** attestation continues and a confirmed draft carries the operator name (chained to D.8's export). **3.3** `muster-adaptive-interview` — **MI1** the discovery branch's `progress-note` total is strictly less than a fresh manual branch's (measured live in a throwaway headless session; a no-pruning tie is an honest `environment` finding, never narrated as a drop). **3.4** `muster-generate-sprs-mp` — **MP1** the EXPORTED payload is a `readiness-result/1.0.0` · **MP2** the SPRS integer is read from the payload (`derived.sprs_now.sprs`), never the DOM · **MP3** the DOM `conservative-score` matches `/^-?\d+% compliant/` (a percentage string, not the SPRS integer) |
| `simstack-destroy` | The "leave no trace" teardown (D.2) — wraps `teardownEphemeralSimTenant`, never `demo:reset`. **SD1** the slug is gone from `listByKind('sim')` · **SD2** a second teardown succeeds (idempotent) · **SD3** a LIVE-slug target THROWS the refusal (injected via a throwaway registry with a fabricated live record — a negative-path fixture) · **SD4** the run directory still holds every artifact written before it ran (the op's readout artifact + arming evidence survive). Also verified: a deck declaring `warm` for this op fails the loader (`deck-validate.ts` mode-vs-catalog check) |
| `simstack-create` | A READOUT over the armed state (D.1) — presents what prep built, never re-seeds. **SC1** the sim answers `GET /v1.0/policies/authorizationPolicy` (tenant materialized) · **SC2** the registry record has four valid auth fields + absolute cert_path (via `missingSimTenantAuthFields`) · **SC3** the deliberate gap is present — `caPolicy-1` is `enabledForReportingButNotEnforced` (report-only, not absent) |
| `eo-show-change-captured` | The loop-closes proof (D.16): `eo-review`(warm) → `ao-make-change`(live) → `eo-show-change-captured`(live). The BEFORE is snapshotted between the warm assess and the remediator (SLIDE_PROBES); the op writes the AFTER. **EC1** both artifacts parse + `after.generatedAt` strictly newer (fresh re-assess) · **EC2** `eo-before.json` matches the warm leg's OWN logged API numbers (before captured while still true) · **EC3** the named control's status compared + the op's narration MATCHES the computed comparison (flip narrated iff flipped) · **EC4** on-screen SPRS == `eo-after.json` score (screen==file), delta recorded · **EC5** a non-flip is reported plainly and narrates NO flip. ⚠ Control status (EC3) and SPRS delta (EC4) are **independent** — A-18 moves the score without flipping `IA.L2-3.5.3` (§E.13) |
| `eo-verify-evidence` | The cross-act chain (D.15), run `ao-registry` live → `eo-review` warm → `eo-review` live `land=evidence` in one lifecycle. **EV1** the Evidence Explorer landing screenshot reaches the finished report and is on disk · **EV2** the Explorer surfaces THIS run's assessment (`assessment:IA.L2-3.5.3`) — non-vacuous because EO storage is run-scoped, unlike the always-present static signal catalog · **EV3** the AO write-side `adminops_evidence` row names the executed command. Hydration is **not** judged here (no `SLIDE_PROBES` entry): EV1 + the Explorer API are the tells. ⚠ The Explorer has **no** AdminOps-evidence source, so the command-id half of the chain is proven write-side (EV3), never off the explorer — see dossier §E.12 |
| `stamper` | **ST1 backstage-not-pane** — visible-pane navigations during warm must be **0** · **ST2** `readExecutePreconditions` reports a populated `#outputPath` · **ST3** at least two screenshots registered · **ST4** arming brought up :3000 and **not** :3001/:4002 · **SE1** the **on-disk execution report** is the judge, never the badge · **SE2** phase `execute-only` when ST2 held · **SE3** `partitionGuiFailures` recorded as expected / unexpected / staleSkips, **all three counts logged even when zero** · **SE4** badge-vs-report divergence recorded as evidence |
| every group | **ARM1** the armed set equals the group's declaration · **TD1** `probePort` reports **free** on 4390 and every port the group armed, after `dispose()` |

### The honesty rules the harness itself must obey

- **`failureClass` on every finding**: `act-red` · `doc-drift` · `pace` · `environment` ·
  `harness-defect`. An honest `act-red` exits non-zero and is an **accepted outcome**. No
  skip-list is ever added to make a run green.
- **The tier floor.** A `--full` run must contain **zero `harness-defect` findings**,
  unconditionally and independently of any `act-red`. That is what stops a real harness defect
  hiding behind an expected red.
- **A green branch must be positively proven.** `SE3` passes only by recording
  `{expected, unexpected, staleSkips}`. A group whose SE3 has no partition record is
  `skipped` + `harness-defect` — never `pass`. **Absence of a red is never itself evidence.**
- **`skipped` is a status, never an absence.** PROPOSED acts report `skipped`, not `failed`.
- **Artifacts must reach the FINISHED report.** `ShowReportRecorder.opArtifact` returns early
  when no op record exists, so the harness calls `opStarted` **before** running an op and
  `opFinished` after. Without that, MR5 / AO2 / EO2 / ST3 all silently observe zero artifacts
  and the artifact-first axis quietly reports nothing.

---

## Where the evidence lands — and why it is two directories

```
runs/acts-test/<runId>/acts-report.json     <- the schema'd roll-up
runs/acts-test/<runId>/<actGroupId>.json    <- one per group
runs/acts-test/<runId>/summary.md
runs/show/<runId>/...                       <- the run's OWN evidence (screenshots, artifacts)
```

**This is intentional.** `armSim` hardcodes `runs/show/<runId>/` as the run directory
(`arm-sim.ts` L173) and is not being forked, so one harness run touches two directories and the
report's artifact paths point across into `runs/show/`. Do not "fix" this by forking arming —
the whole design value of the harness is that it composes the *real* arming path rather than a
parallel one.

`runs/` is gitignored, so final evidence is transcribed into
`docs/context/IMPLEMENTATION_LOG.md`. **The log is the evidence.**

---

## What is out of scope at runtime

- Degradation paths (the EO self-heal, the Stamper `full`-phase fallback). Both are unit-covered;
  the brief is warm + live, and a degradation is not a mode.
