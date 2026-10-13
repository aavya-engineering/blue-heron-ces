# Plan: the demo-act test harness (`demo:acts-test`)

**Date:** 2026-09-06 · **Branch:** `gp-demo-4` (or a `gp-demo-5` cut per founder cadence)
**Status:** READY FOR IMPLEMENTATION · **Rev 2** (closes GAP_ANALYSIS P0-1 and P1-1 … P1-9)

> **Two deliberate deviations from the architect template, declared once.** (1) This plan is
> written to `docs/demo/PLAN-ACT-HARNESS.md`; **root `PLAN.md` is frozen and must not be
> touched.** (2) It exceeds the 800-word guideline because the founder asked for a
> *cold-executable* plan with exact paths, commands and schemas. The work is sliced instead.

---

## Objective

Build a committed test harness that runs each **implemented** demo-act against the real
environment and mechanically judges three things the founder named: it **works well** (the
dossier's `SUCCESS (TESTABLE)` clauses, artifact-first), it is **paced well** (measured wall
time per phase vs. the op catalog's `typicalWarmMs` and the dossier's timing prose), and it is
**documented well** (`DEMO-ACTS-DOSSIER.md` cross-checked against the registry and the catalog;
doc-drift is a first-class failure).

## Context Summary

- **From the implementation log (GP-DEMO-4 richness, final section):** all five ops ship;
  backstage session, run report + `schemas/demo-show-report.schema.json`, and
  `op-catalog.ts` with `typicalWarmMs` are committed. Baseline: **639 tests / 49 files**,
  `tsc --noEmit` clean, three decks `--check` exit 0.
- **There is NO committed proof harness to reuse.** `proof-slice2.mjs` / `proof-report.mjs` were
  scratchpad-only; commit `6b4610d` ("headless proof evidence + acceptance sweep") changed
  `docs/context/IMPLEMENTATION_LOG.md` **and nothing else** (137 insertions); `scripts/` holds
  only `make-demo-xlsx.mjs` and `verify-dashboard.mjs`. **`demo:acts-test` will be the first
  committed end-to-end op driver in the repo.** Reused, never re-implemented: `armSim` (all
  arming), `makeShowOps` (arming + backstage + the single-lane queue + dispatch),
  `createShowReport` (durations + artifact path normalization), `probePort`, `op-catalog.ts`.
- **Constraints.** Windows-only; PowerShell 5.1 spawns. Ports **4390** (stacksim, always),
  **3001** (AO), **4002** (EO), **3000** (Stamper) — each armed only when the act needs it.
  `:4173` Muster GUI acts are PROPOSED: **out of runtime scope, in docs scope.** `runs/` is
  gitignored, so final evidence is transcribed into `docs/context/IMPLEMENTATION_LOG.md`.
- **Operator prerequisite for `--quick` and `--full`:** `../ces-muster/muster-api/dist/cli/bin.js`
  must exist — **ces-tester never builds a sibling.** Absent, `muster-readiness` self-gates to
  "evaluation unavailable" and MR1 fails for an environmental reason. It is present today. The
  harness must probe for it up front and, if missing, exit **2** (could-not-run) naming the path
  and the `npm run build` remedy — never fail MR1 as if the act were broken.
- **The blocking API fact:** `OpImplementation = (ctx) => Promise<void>` (`op-registry.ts` L82).
  **No op returns a result.** Outcomes reach the harness only via (a) `ctx.artifact?.(absPath)` —
  the harness supplies the callback, (b) `ctx.log(line)`, (c) files in `runDir`, (d) live-page
  probes with the exported pure helpers, (e) sibling APIs the harness calls itself. Judge in that
  order of preference; use log substrings **only** for the honesty strings the dossier quotes
  verbatim.

## Architecture Decisions

- **AD1 — Compose `makeShowOps`, never `runShow`.** The harness builds a synthetic in-memory
  `DemoDeck` per act-group, opens headless panes, and calls `prepare()` → `run(ctx)` per slide →
  `dispose()`. This inherits per-act arming (`armingFor` reads the deck's own driven ids), the
  backstage session, warm-ordering and serialization — with no slides server, no windows, no
  operator loop. It is the scratchpad proof, committed and generalized.
- **AD2 — An act-group is the unit.** Ordering-dependent acts run as one deck in one lifecycle:
  `eo-review` warm→live (D.13→D.14) and `stamper-translate`→`stamper-execute` (D.9→D.10).
- **AD3 — Synthetic slides take `validateParams(opId, {}).resolved`** so the harness mirrors the
  loader's default-filling instead of hand-rolling defaults.
- **AD4 — `--docs-only` spawns no browser, no server and no sibling process.** That, and not
  "declaration-layer only", is the assertion — `docs-check.ts` imports `xlsx-loader.ts` for
  `CANONICAL_COLUMNS`/`HEADER_ALIASES`, and that module value-imports `read-excel-file/node`, so
  it is **not** a declaration-layer module. The test (`tests/demo-acts-docs-check.test.ts`) greps
  the transitive source graph reachable from `docs-check.ts` for `playwright` and
  `node:child_process` and asserts zero hits; `acts-test-command.ts` reaches the runtime only
  through `await import('../demo/acts/act-run.js')` gated on tier, so `--docs-only` never loads
  `op-registry.ts`.
- **AD5 — Honest reds are recorded, never pinned.** Every finding carries
  `failureClass: 'act-red' | 'doc-drift' | 'pace' | 'environment' | 'harness-defect'`. An
  `act-red` exits non-zero and is an accepted outcome. No skip-list is added to make a run green.
  Do **not** hard-code `AZ-NSG-005` as the only tolerable id — that class rotates
  (`REQ-STAMPER-ROTATING-VERIFY-FAIL`); the contract is *"surfaced, named, non-zero"*.
- **AD6 — Exit codes mirror `demo:show --check`:** `0` pass · `1` checked-and-failed · `2` bad
  invocation or the harness could not run. `src/cli/index.ts`'s `default:` arm (L362) returns 0,
  so the new `case` must be added **before** it, alongside `case 'demo:show':` (L360-361).
- **AD7 — No new dossier template field.** The status rule restates the dossier's AS OF table row
  *Rule applied* — status tracks **deck-invocability of committed code**, not code in a working
  tree. **Do not string-match that sentence**: the cell is a markdown table cell containing bold
  markers and a comma continuation, so any literal quote match finds nothing. Encode the rule as
  `invocableToday()` below and cite the AS OF row in prose only.
- **AD8 — Report layout, and the two-directory fact.** Write
  `runs/acts-test/<runId>/<actGroupId>.json` per group, a roll-up `acts-report.json` (the schema'd
  artifact), and `summary.md`. Meanwhile **`armSim` hardcodes `runs/show/<runId>/`** (`arm-sim.ts`
  L173) for the run's own evidence and is not being changed, so one harness run touches two
  directories and artifact paths point across. Intentional — say so in `docs/demo/ACT-HARNESS.md`
  so nobody "fixes" it by forking arming.
- **AD9 — Sibling roots.** `parseActsTestArgs` mirrors `show-command.ts`'s `root(flag, name)`
  helper for all five roots — `--stacksim-root`, `--ao-root`, `--eo-root`, `--stamper-root`,
  `--muster-root` — adding them to its own `FLAGS_WITH_VALUES` alongside `--run-id`, `--act` and
  `--from-report`. Do not invent a second resolution scheme.
- **AD10 — Tier and `--act` semantics.** Tiers are group sets: `--docs-only` = {} ·
  `--quick` = {`muster-readiness`, `ao-registry`} · `--full` = all four groups. `--act <groupId>`
  **overrides** the tier with exactly that one group (repeatable); combining it with `--quick` or
  `--full` is exit **2** with a message naming both. The docs check runs in **every** tier.

## The dossier parser (`dossier.ts`) — semantics decided, not left open

- **Entry boundaries:** scan **heading-to-next-heading** (`^### D\.(\d+) \`(actName)\``), never
  stopping at a blank line or a non-list line — D.1 and D.2 interleave `>` blockquote boxes
  between field bullets, and a first-blank-line parser silently drops their last fields.
- **Two field shapes, both legal.** Verified counts in today's file: **240 inline** field lines
  (`^- \*\*FIELD\*\* <rest>`) and **16 bare** ones — 240 + 16 = 256 = 16 entries × 16 fields.
  The bare ones are all `SUGGESTED TALK-TRACK`, which every entry renders as a bare bullet whose
  content is nested sub-bullets. **Decision: a field is `^- \*\*(FIELD)\*\*(?: (.*))?$`, and a
  field with no inline remainder takes its value from the indented block that follows** (until
  the next field bullet or the next heading). A **block-style field is non-empty iff that block
  has ≥1 non-blank line.** The field-name class must include spaces, parentheses and **hyphens**
  (`SUGGESTED TALK-TRACK`, `SUCCESS (TESTABLE)`). Consequence: **DD2 yields zero findings today**
  — every entry is substantively complete, and a parser that reported 16 failures would be
  reporting its own defect as doc-drift.
- **`opId`** = first backticked token on the `ID` line. **Qualifier classification** (this is what
  keeps D.11 from misfiring): scan the remainder for `op mode: <mode>` → *mode qualifier*; for
  `<key>=<value>` or `` `key` `` = `` `value` `` → *param qualifier*; **anything else — prose,
  parentheticals, alias notes — is not a qualifier and is ignored.** D.11's ID line carries only a
  prose parenthetical reconciling `ao-registry-command` with `ao-registry`, so D.11 has no
  qualifier.
- **`invocableToday(entry)`** = `opId ∈ DEMO_OP_IDS` **and** every qualifier is expressible in a
  deck cell today: a mode qualifier always is (`op mode` is a shipped column); a param qualifier
  is iff `validateParams(opId, {key: value})` returns no errors; an unregistered `ID` never is.
  ⇒ **D.15 `eo-verify-evidence` IS invocable today** (`land=evidence` validates since Slice 4a).
  ⇒ **D.12 `ao-make-change` is NOT** — it is not a registered id and no deck can name it, so its
  PROPOSED status is *correct*; only its STATUS *reason* is stale (caught by DD6b, not DD3).
- **Param keys** on a PARAMS line = backticked tokens matching `^[A-Za-z][A-Za-z0-9]*$`, excluding:
  dotted/slashed/hyphenated/pipe-bearing tokens (`ctx.slide.op.mode`, `assets/demo-plan`,
  `self-hosted|independent`), tokens containing `_` (code constants like `AO_DEMO_COMMAND_ID`),
  the literals `None`/`true`/`false`, **and any token equal to a catalog `default` or a member of
  a catalog `values` list for that op** (`IA`, `sprs`, `evidence`). That last exclusion is what
  makes DD5b silent today instead of warning on three enum defaults.

## The docs-check rules (`docs-check.ts`) — mechanical, rule-ids stable

| Rule | Check | Severity |
|---|---|---|
| **DD1** | Every `DEMO_OP_IDS` member is the `ID` of ≥1 entry | FAIL |
| **DD2** | Every entry fills all 16 §C template fields (inline **or** block-style), non-empty | FAIL |
| **DD3** | `invocableToday(entry)` **and** STATUS `PROPOSED` ⇒ drift | FAIL |
| **DD3b** | The converse (*"and vice versa"*): STATUS `IMPLEMENTED` ⇒ `invocableToday(entry)` | FAIL |
| **DD4** | STATUS `IN-BUILD` with a registered id ⇒ drift. **IN-BUILD is carved out of DD3** so a drifted entry yields exactly one status finding, not two | FAIL |
| **DD5** | For a registered id: every `OP_CATALOG[id]` param key appears on the PARAMS line — **per-id, unioned across every entry sharing that id** (D.13 ∪ D.14 ∪ D.15 for `eo-review`), because the dossier deliberately splits one op into three act views | FAIL |
| **DD5b** | Reverse: a param-shaped token on a PARAMS line that is not a catalog key for that id | WARN |
| **DD6** | Registered id whose PARAMS **or** STATUS line says `Slice 4a` / `None today` / `does not exist`, while `OP_CATALOG[id]` declares ≥1 param ⇒ stale-future prose | FAIL |
| **DD6b** | **Any** entry (registered or not) whose STATUS line names a §A.1-listed artifact by its backticked token (today: `` `params` column ``) **and** pairs it with one of the enumerated nonexistence/blocking phrases — `does not exist` \| `not selectable without` \| `needs the` — when DD7's probe says the artifact exists. Trigger phrases are this closed list, extended only by plan revision — a paraphrase outside the list is NOT a finding (that keeps the count derivable from the files, which is the whole point of the enumerated red list). This is the clause that reaches `ao-make-change`, which has no catalog entry and so can never trigger DD6 | FAIL |
| **DD7** | Each artifact named in §A.1's *"What does NOT exist yet"* block is probed: `params` ∈ `CANONICAL_COLUMNS`; `act`/`demoact` ∈ `HEADER_ALIASES`; `docs/demo/OP-CATALOG.md` on disk. An existing one is stale doc | FAIL |
| **DD8** | §E items carrying a mechanical probe — **exactly two are defined**: E4 (`params` column) and E11 (`ShowOpContext.artifact` inert). E5 (`DEMO_PORTS` labels 5173 `muster`) was re-verified **still true**; E1/E2/E3/E6/E9/E10 have no probe and are not tested | FAIL |
| **DD9** | STATUS `PROPOSED` ⇒ §C completeness only; reported `skipped` at runtime, never failed. Independent of DD3 — an entry can be runtime-skipped *and* a docs FAIL | SKIP |
| **DD10** | Dossier **minute-valued** timing prose vs `typicalWarmMs` | `DD10_SEVERITY` |
| **DD11** | AS OF freshness: the `Branch / HEAD` cell names the current `git HEAD`, and the `Build state` cell does not claim an in-flight executor when the working tree is clean | WARN |

**DD10's regex, corrected.** The rev-1 pattern `≈|~ *(\d+) *min` alternates on the bare character
`≈` and never captures — it would have missed D.13, the flagship prediction. Use
`/(?:≈|~)\s*(\d+)\s*min/g` plus `/(\d+)\s*minutes?\b/g`. **The seconds pattern is deleted
outright**: no registered-id entry states a seconds-level warm cost, while a loose `(\d+) *s`
captures D.9's "reports Complete in 0.7 s" (a bug anecdote) and D.14's "20 s timeout by design"
(a failure-mode budget) as pacing claims. Tolerance is flagged **strictly outside** [0.5×, 2.0×]
— 2.0× exactly passes, which is a decision, not an accident. `DD10_SEVERITY` is an exported
constant, `'warn'` in Slices B-E, flipped to `'fail'` in Slice F once the catalog carries measured
values: a pacing lie is advisory while the numbers are guesses and a failure once they are
evidence.

## The predicted red list — re-derived from the files as they stand today

Every line below was verified by reading the current `DEMO-ACTS-DOSSIER.md`, `op-catalog.ts`,
`xlsx-loader.ts` and `deck-model.ts`. **This is Slice B's acceptance: 17 FAIL, 1 WARN + DD11, 10
runtime-skips.** An extra or a missing finding fails the slice — reconcile the *rule* against
these files; **never edit the dossier to match the list.**

| Rule | Fires on | Count | Why |
|---|---|---|---|
| DD1 | — | **0** | all five registered ids have entries |
| DD2 | — | **0** | 256 = 16×16 fields present once block-style is allowed |
| DD3 | D.15 | **1** | PROPOSED, but `land=evidence` validates ⇒ invocable today |
| DD3b | — | **0** | D.3/D.11/D.13/D.14 are IMPLEMENTED **and** invocable |
| DD4 | D.9, D.10 | **2** | IN-BUILD, both registered since Slices 2b/2c |
| DD5 | — | **0** | every catalog key appears, under the per-id union reading |
| DD5b | — | **0 WARN** | `IA`/`sprs`/`evidence` excluded as catalog defaults/enum values |
| DD6 | D.3, D.9, D.10, D.11, D.13, D.14, D.15 | **7** | all seven registered-id entries carry `Slice 4a` / `None today` prose — **not the four rev 1 predicted** |
| DD6b | D.12, D.15 | **2** | D.12's STATUS pairs `` `params` column `` with "which **does not exist**" (dossier L470); D.15's pairs it with "**not selectable without**" (L539) — both on DD6b's closed trigger-phrase list; the column exists (`CANONICAL_COLUMNS`). D.15 therefore carries two findings (DD6 + DD6b) |
| DD7 | params column · act/demoact alias · `OP-CATALOG.md` | **3** | **3 of 3, not 2 of 3** — `HEADER_ALIASES` carries `act: 'op'` and `demoact: 'op'`; rev 1 was factually wrong |
| DD8 | §E4, §E11 | **2** | both stale; §E5 re-verified still true |
| DD10 | D.13 | **1 WARN** | `≈ 5 min` (300 000 ms) vs `typicalWarmMs: 10_000` → 0.033× |
| DD11 | AS OF | **1 WARN** | pins HEAD `5d5854b` (actual `6b4610d`); claims Slice 2b mid-write and a repo-wide `backstage` grep returning nothing — both false |
| DD9 | D.1, D.2, D.4, D.5, D.6, D.7, D.8, D.12, D.15, D.16 | **10 skips** | every PROPOSED entry |

## The per-act runtime checks (from each entry's `SUCCESS (TESTABLE)`)

| Act | Checks |
|---|---|
| **muster-readiness** (D.3) | **MR1** `<runDir>/muster-readiness.json` parses with an `observations` array · **MR2** `tallyPostures()` five buckets sum to `observations.length`, all four `READINESS_POSTURES` named · **MR3** ledger create+mutate delta recorded (**advisory** — §E9: the op does not gate on it) · **MR4** a log line contains `NO_SCORE_LINE` verbatim · **MR5** the artifact reached `ctx.artifact` · **MR6** warm and live both complete |
| **ao-registry** (D.11) | **AO1** completes in warm and live (it does not branch — assert the two runs agree) · **AO2** ≥1 screenshot registered *and* present on disk · **AO3** the evidence record exists: derive the DB as `aoDbPath(path.join(armed.runDir, 'pipeline'))` (`ao-leg.ts` L117; `arm-sim.ts` L175 builds that same path — neither `ArmedSim` nor `ArmedEnvironment` exposes `pipelineRoot`, so it must be re-derived), then `readAoEvidence(dbPath, simTenantId(armed.slug))` (`ao-evidence.ts` L230, L46) and assert ≥1 row naming the executed command. Closes §E3 · **AO4** unarmed-AO produces the specific arming error, not a timeout (negative case, injected) |
| **eo-review** (D.13→D.14) | **EO1** after warm, `hasRenderedAssessment(pane.page)` is true · **EO2 (condition-aware)** `eo-review-01-compliance-matrix.png` **always**; `-02-family-determinations.png` **iff `rowsBefore > 0`** (`eo-review-op.ts` L203-209); `-03-<landing>.png` matching the resolved `land` — `03-sprs.png` under AD3's default, `03-evidence.png` / `03-dashboard.png` otherwise (L218-232). A missing `02` when the family has no rows is classed **`environment`**, never `act-red` · **EO3** the harness fetches `<eoBaseUrl>/api/assessment` and `/api/sprs` and feeds `readEoNumbers`, whose fields are `number \| undefined` — assert **numerically** (`Number.isInteger(met) && met >= 0`; SPRS an integer, sign-permitting), not with `/^\d+$/` against a number · **EO4** if the live signal leg did not run, the log must carry `LIVE SIGNAL LEG DID NOT RUN; do not narrate these numbers` · **EO5** still hydrated after live |
| **stamper-translate** (D.9) | **ST1 backstage-not-pane** — the harness wraps `AppPane.goto` (a plain arrow property on an object literal, so a proxy works) in a counter; visible-pane navigations during warm must be **0** · **ST2** `readExecutePreconditions(backstage.page)` — it lives in **`stamper-execute-op.ts` L95**, not the translate op, and takes a `UiPage` — reports a populated `#outputPath` · **ST3** ≥2 screenshots registered · **ST4** `armingFor` brought up :3000 and **not** :3001/:4002 |
| **stamper-execute** (D.10) | **SE1** the on-disk execution report is located **the way `stamper-execute-op.ts` itself locates it** (it reads `result.report` off the driver) — do not hardcode a directory; read total/applied/failed. The badge is never the judge · **SE2** phase `execute-only` when ST2 held · **SE3** `partitionGuiFailures(ids, GUI_LEG_KNOWN_FALSE_FAILS)` recorded as expected / **unexpected** / staleSkips, **with all three counts logged even when zero** — that logged partition is the positive proof the check ran (see Slice D) · **SE4** badge-vs-report divergence recorded as evidence when it occurs |
| **every group** | **ARM1** the armed set equals the group's declaration · **TD1** after `dispose()`, `probePort` reports **free** on 4390 and on every port the group armed |

## Implementation Steps (slices — each independently green)

Gate on every slice: `npx tsc --noEmit` · `npm test` · `C:\ces` still does not exist (the Slice 3
write-boundary trap) · `git status --short` shows no unintended paths. Commit cadence per repo
precedent: **one commit per slice, staged by explicit path.**

**Step 0 — commit the inputs as received.** `DEMO-ACTS-DOSSIER.md` and
`docs/demo/PLAN-ACT-HARNESS.md` are both **untracked** (`git ls-files` returns nothing for
either). Slice B pins an exact red list against the dossier and Slice F modifies it — neither is
reviewable without a baseline. Commit both, by explicit path, before Slice A, exactly as the
richness plan needed Step 0c. Message: `GP-DEMO-5 acts: dossier + act-harness plan (as received)`.

**Slice A — the dossier parser (pure).**
`src/demo/acts/dossier.ts`: `DossierEntry`, `parseDossier(markdown): ParsedDossier`,
`DOSSIER_PATH = 'DEMO-ACTS-DOSSIER.md'` (repo **root**, not `docs/demo/`), `TEMPLATE_FIELDS` (the
§C list, in order), `classifyQualifiers`, `paramKeysOf`. Imports nothing outside `node:*`.
Tests (`tests/demo-acts-dossier.test.ts`): 16 entries; **240 inline + 16 block-style fields, and
DD2-completeness true for all 16**; heading-to-heading scanning across D.1/D.2's blockquotes;
qualifier classification for D.11 (prose ⇒ none), D.13/D.14 (mode), D.15 (param); param-key
extraction excluding `IA`/`sprs`/`evidence`, `AO_DEMO_COMMAND_ID`, dotted and pipe-bearing tokens.

**Slice B — the docs check + `--docs-only` CLI + report + schema.**
`src/demo/acts/docs-check.ts` (DD1-DD11, `DD10_SEVERITY`) · `src/demo/acts/acts-report.ts` ·
`schemas/demo-acts-test.schema.json` · `src/cli/acts-test-command.ts` (`parseActsTestArgs`,
`runDemoActsTestCommand(argv, testerRoot, deps = {})`) · `src/cli/index.ts` (import; a
`case 'demo:acts-test':` inserted beside `case 'demo:show':` at L360-361, **before** `default:` at
L362; a clause appended to `usage()`) · `package.json` script · `docs/demo/ACT-HARNESS.md` (tiers,
exit codes, what each check proves, AD8's two directories).
**Acceptance is NOT green:** `node bin/ces-tester.mjs demo:acts-test --docs-only` exits **1** and
prints **exactly 17 FAIL, 2 WARN (DD10 D.13 + DD11), 10 skips**, matching the table above
finding-for-finding. **Do not wire the docs check into `npm test` yet** — it would make every
intermediate slice red by design.

**Slice C — the runtime core and the cheap groups (`--quick`).**
`src/demo/acts/act-roster.ts` (`ACT_GROUPS`: id, opIds, slides, expected arming, expected ports,
checks) · `src/demo/acts/act-run.ts` (`runActGroup`): builds the synthetic `DemoDeck`, opens
`openAppPane({ geometry: BACKSTAGE_GEOMETRY, headless: true })`, wraps `goto` for ST1, calls
`makeShowOps(pane, deck, options, { log })`, times `prepare()` as `armMs`, runs each slide, times
each op, `dispose()`, then the TD1 port probe.
**The `opStarted` requirement (P1-7).** `ShowReportRecorder.opArtifact(index, absPath)` **returns
early when no op record exists** (`run-report.ts` L216 `if (!op) return;`). The harness must call
`recorder.opStarted(index, slide, now())` **before** running the op and `opFinished(...)` after —
mirroring `show-run.ts` L337-349 — or MR5 / AO2 / EO2 / ST3 all silently observe zero artifacts
and the artifact-first axis quietly reports nothing. `tests/demo-acts-run.test.ts` must include a
test that drives a fake op calling `ctx.artifact()` and asserts the path **appears in the finished
report**, not merely that the callback fired.
**Acceptance:** `demo:acts-test --quick --run-id acts-quick-1` runs for real and writes
`runs/acts-test/acts-quick-1/` — `muster-readiness.json`, `ao-registry.json` and the roll-up
`acts-report.json`, validating against the schema with ajv. Both groups pass; 4390 and 3001 probe
free; **zero findings classed `harness-defect`.**

**Slice D — the expensive groups (`--full`).**
Extends the roster and runner with the EO pair (EO1-EO5) and the Stamper pair (ST1-ST4, SE1-SE4).
**Acceptance — both branches defined, because the failure class rotates and no run can be
guaranteed red:**
- **Tier floor, unconditional:** exit code is 0 or 1 (never 2), every group reached teardown with
  its ports free, and the report contains **zero findings classed `harness-defect`**. This floor
  is what stops a real harness defect hiding behind an expected `act-red`.
- **Red branch:** `unexpected.length > 0` ⇒ the group is `act-red`, every unexpected id is named
  in the report, exit **1**. Accepted, recorded, never pinned.
- **Green branch:** `unexpected.length === 0` ⇒ the group **passes**, and SE3 must record
  `{expected: n, unexpected: 0, staleSkips: m}` as positive proof it ran. A group whose SE3 has
  **no** partition record is `status: 'skipped'` with `failureClass: 'harness-defect'` — never
  `pass`. Absence of a red is never itself evidence.

**Slice E — pacing analysis and the catalog delta.**
`src/demo/acts/pacing.ts`: `paceVerdict(measuredMs, catalogMs, dossierClaimsMs[])`,
`catalogDelta(measurements)` → `{ opId, catalogMs, measuredMs, suggestMs }`, and the `summary.md`
writer. `--from-report <path>` re-analyses a prior run without re-running.
**Acceptance:** the `pacing` block names at minimum `eo-review` (catalog `10_000` vs a ~5 min
measured warm assess), `stamper-execute` (`420_000` vs the ~786 s fast path measured 2026-09-06)
and `ao-registry` (`30_000`, never measured).

**Slice F — correct the docs and the catalog from evidence, then promote the check.**
- `DEMO-ACTS-DOSSIER.md`: AS OF (date, HEAD, build state — no executor is running); D.9/D.10 →
  `IMPLEMENTED`; D.15's status re-decided under `invocableToday`; the `Slice 4a` / `None today`
  prose on all seven registered-id entries; D.12's STATUS reason; §A.1's "does not exist yet"
  block (**all three now exist**); §B's status summary; §E items 4 and 11.
- **`docs/context/THREAD_HANDOFF.md` (P1-9)** — L86 still reads "**RE and Config: NO live product
  demo**" and the file contains **zero** occurrences of "decision 9", so the one *binding*
  doctrine doc contradicts the founder's own lift. Amend that bullet to point at decision 9
  (the no-live rule now applies to **Config only**). Doc-drift is a first-class failure; the
  binding doc cannot be the one document outside the rules.
- **The prep-budget decision (P1-6).** `tests/demo-show-op-catalog.test.ts` L137 pins
  `prepBudgetMs(['eo-review','ao-registry','muster-readiness'])` **under** `PREP_BUDGET_WARN_MS`.
  Today 10k+30k+80k = 120k. A measured `eo-review` near 300k makes the trio ≈410k and **breaks
  that pin.** The test's own comment says it exists so the budget "needs revisiting", so this is a
  policy call, not a test edit. **Decision: do not raise `PREP_BUDGET_WARN_MS`.** 300 s of dead
  stare before slide 1 is the founder-accepted threshold (decision 6); a trio warm chain that
  genuinely costs ~410 s *should* warn — that is the warning working. Invert the pin to assert
  the trio now exceeds the threshold, with a comment recording that **the measurement changed,
  not the policy**. Then re-run `--check` on all three decks: today's warm ops are the AdminOps
  pair, so no shipped deck is expected to newly warn — **if one does, the warning is true and the
  deck's ordering is what to revisit; escalate to the founder rather than tune the constant.**
- `src/demo/show/op-catalog.ts`: `typicalWarmMs` ← measured, each with a `MEASURED <date>` comment
  (precedent at L112-115). `docs/demo/OP-CATALOG.md` + `tests/demo-show-op-catalog.test.ts` follow.
- Flip `DD10_SEVERITY` to `'fail'`; add the real-dossier run to `tests/demo-acts-docs-check.test.ts`
  asserting **zero FAIL and zero WARN**.
**Acceptance:** `demo:acts-test --docs-only` exits **0**; `npm test` green; three decks `--check`
exit 0 with their warning state explicitly recorded.

**Slice G — the loop step.** Re-run `--docs-only`, `--quick`, `--full`. Record in
`docs/context/IMPLEMENTATION_LOG.md` (new `# GP-DEMO-5 act harness` section): the measured phase
table, the docs verdict, the ports-free proof, the catalog corrections, the prep-budget decision,
and either the named `act-red` ids or the SE3 partition counts proving the green branch.
`runs/` is gitignored — **the log is the evidence.**

## File Inventory

| Slice | File | Action | Target |
|---|---|---|---|
| 0 | `DEMO-ACTS-DOSSIER.md`, `docs/demo/PLAN-ACT-HARNESS.md` | COMMIT | untracked today; baseline before B/F |
| A | `src/demo/acts/dossier.ts` | CREATE | `parseDossier`, `classifyQualifiers`, `paramKeysOf` |
| A | `tests/demo-acts-dossier.test.ts` | CREATE | 240+16 field shapes, qualifier + key extraction |
| B | `src/demo/acts/docs-check.ts` | CREATE | DD1-DD11, `DD10_SEVERITY` |
| B | `src/demo/acts/acts-report.ts` | CREATE | report types, `writeActsReport` |
| B | `schemas/demo-acts-test.schema.json` | CREATE | incl. `failureClass` enum |
| B | `src/cli/acts-test-command.ts` | CREATE | `parseActsTestArgs`, `runDemoActsTestCommand` |
| B | `src/cli/index.ts` | MODIFY | import; `case` beside L360-361, before `default:` L362; `usage()` |
| B | `package.json` | MODIFY | `scripts."demo:acts-test"` |
| B | `docs/demo/ACT-HARNESS.md` | CREATE | tiers, exit codes, AD8's two directories |
| B | `tests/demo-acts-docs-check.test.ts` | CREATE | rules over **fixtures**; AD4 graph scan; a drift test that every DD rule id and tier flag appears in `ACT-HARNESS.md` (the `OP-CATALOG.md` pattern) |
| C | `src/demo/acts/act-roster.ts` | CREATE | `ACT_GROUPS`, per-act check tables |
| C | `src/demo/acts/act-run.ts` | CREATE | `runActGroup`; `opStarted`/`opFinished` around every op |
| C | `tests/demo-acts-roster.test.ts` | CREATE | arming expectations, synthetic-deck shape, `--act`/tier conflict |
| C | `tests/demo-acts-run.test.ts` | CREATE | injected `arm`/`implementations`; **artifact-reaches-report** test |
| D | `src/demo/acts/act-roster.ts`, `act-run.ts` | MODIFY | EO + Stamper groups |
| D | `tests/demo-acts-roster.test.ts` | MODIFY | the two new groups (Slice C's test pins the set) |
| D | `tests/demo-acts-run.test.ts` | MODIFY | EO/Stamper judges; SE3 green-branch partition record |
| E | `src/demo/acts/pacing.ts` | CREATE | `paceVerdict`, `catalogDelta`, `summary.md` |
| E | `src/demo/acts/acts-report.ts`, `schemas/demo-acts-test.schema.json` | MODIFY | `pacing` block |
| E | `tests/demo-acts-pacing.test.ts` | CREATE | — |
| F | `DEMO-ACTS-DOSSIER.md` | MODIFY | AS OF · §A.1 · §B · D.3/D.9/D.10/D.11/D.12/D.13/D.14/D.15 · §E 4,11 |
| F | `docs/context/THREAD_HANDOFF.md` | MODIFY | **L86** — amend to point at decision 9 |
| F | `src/demo/show/op-catalog.ts` | MODIFY | `typicalWarmMs` × 5, measured |
| F | `docs/demo/OP-CATALOG.md` | MODIFY | warm-cost lines |
| F | `tests/demo-show-op-catalog.test.ts` | MODIFY | **L137 pin inverted** per the budget decision |
| F | `tests/demo-acts-docs-check.test.ts` | MODIFY | real dossier, zero FAIL / zero WARN |
| G | `docs/context/IMPLEMENTATION_LOG.md` | MODIFY | append the evidence section |

*Not modified:* `tests/scaffold.test.ts` — its only assertion is that `usage()` contains
`ces-tester`, which an appended clause cannot break.

## Testing Strategy

- Unit (vitest, `tests/*.test.ts`, explicit `.js`-extension imports, local `ShowRunOptions` /
  `DemoDeck` literals — there is no shared fixture helper): the parser, every DD rule against
  fixture markdown, roster arming expectations, `runActGroup` against injected `arm` +
  `implementations`, the artifact-reaches-report proof, the pacing arithmetic.
- The AD4 graph scan (no `playwright`, no `node:child_process` reachable from `docs-check.ts`).
- Real invocations are the acceptance of Slices B/C/D/F/G — a unit test cannot prove a port is
  free or that the Configuration GUI never reached the visible pane.

## Out of Scope

- **Any Muster GUI act (D.4-D.8) at runtime** — PROPOSED, no driver, `:4173` never armed. Docs
  check only.
- `simstack-create` / `simstack-destroy` / `ao-make-change` / `eo-show-change-captured` runtime.
- **Degradation paths:** the EO self-heal and the Stamper `full`-phase fallback. Both are
  unit-covered; the founder's brief is warm + live, and a degradation is not a mode.
- Adding a `params` column to `scripts/make-demo-xlsx.mjs` or authoring a new `.xlsx` — the
  harness uses **in-memory** decks.
- Pinning `AZ-NSG-005` or any skip-list edit. Adjudicating it is a ces-stamper question.
- Fixing the two GP-DEMO-4 open items (`html` on slide 1; act-alias resolution).
- Editing `docs/demo/DEMO-ACTS-CONCEPT.md` (§E7's "MFA policy absent") — flagged, corrected under
  a separate ask.

## Acceptance Criteria

- [ ] `demo:acts-test` registered; `--docs-only` / `--quick` / `--full` / `--act <id>` /
      `--run-id` / `--from-report` parse; `--act` + a tier flag exits 2; codes 0/1/2 per AD6.
- [ ] `--docs-only` spawns no browser, server or sibling, proven by the AD4 graph scan.
- [ ] Slice B reproduces the predicted red list **exactly**: 17 FAIL, 2 WARN, 10 skips.
- [ ] Every implemented act is judged by its dossier `SUCCESS (TESTABLE)` clauses, artifact-first,
      with artifacts proven to reach the finished report.
- [ ] **A `--full` run contains zero `harness-defect` findings** — the tier floor, independent of
      any `act-red`.
- [ ] The Stamper group's green branch is distinguishable from a skipped SE3 by a recorded
      partition, never by absence.
- [ ] PROPOSED acts report `skipped`, not `failed`.
- [ ] Measured `armMs` / per-op ms land in the report with a `catalogDelta` block.
- [ ] Ports 4390 + each group's armed ports probe **free** after teardown.
- [ ] After Slice F: dossier, catalog and THREAD_HANDOFF agree with the code;
      `demo:acts-test --docs-only` exits 0 and the check runs inside `npm test`; the prep-budget
      decision is recorded with its rationale.
- [ ] `npx tsc --noEmit` clean · `npm test` green · three decks `--check` exit 0 with warning
      state recorded · no writes outside this project root (re-check `C:\ces` does not exist).
- [ ] **Commit hygiene, per repo precedent (GP-DEMO-4):** one commit per slice, staged by explicit
      path; never `git add -A` / `git add .`; **no pushes** without founder say-so; never stage a
      `session-ces-tester-*.md`.
