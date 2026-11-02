# Plan: Build & Runtime-Test the 10 Remaining Demo-Acts

**Date:** 2026-09-06
**Status:** READY FOR IMPLEMENTATION
**Scope note:** This plan is deliberately longer than the 800-word architect default. The task
requires it to be *cold-executable* — exact paths, commands, and a driver design grounded in real
files. Length yields to that requirement. **Do NOT touch the root `PLAN.md` (frozen).**

## Objective

Build (or, for one act, runtime-verify) the 10 remaining PROPOSED/verify demo-acts so
`demo:acts-test` proves each works against the real apps. Ship in small, independently-green slices
across three cost tiers, one commit each, with the dossier status flip (`PROPOSED → IMPLEMENTED`)
landing **in the same slice as the code** — the docs-check (DD-rules) is used as a gate, not a chore.

## Context Summary

- **From dossier (`DEMO-ACTS-DOSSIER.md`):** 9 PROPOSED acts + 1 already-invocable act to
  runtime-verify (`eo-verify-evidence`, D.15). Measured facts are current: EO warm ≈ 4.7 s (not
  5 min), Stamper translate ≈ 308 s, execute ≈ 774 s; the rotating **AZ-NSG-004/005** honest red is
  UNPINNED and is expected to surface as one `act-red` on `--full`.
- **From ces-muster investigation (file-grounded, this session):** the SPA is served by
  `npm run preview` on **:4173** from a prebuilt `dist/`; the honest import seam is a
  `<input type="file" data-testid="discovery-import-input">` read via `FileReader` (zero network);
  the CLI (`muster-api/dist/cli/bin.js discovery --sim --out <file>`) produces a
  `readiness-result/1.0.0` artifact that validates against the **same** schema the SPA import
  validates against. **Three dossier SUCCESS clauses are wrong** and are corrected in this plan
  (see *Dossier drift to fix in-slice*).
- **Constraints:** Windows-only, PowerShell 5.1 spawns, ports 4390/3000/3001/4002 (+**4173** Muster).
  Reuse arming/backstage/report infra — never build a parallel stack (ACT-HARNESS.md is explicit).
  Honesty guards A.5 are load-bearing per act. Config (Stamper) stays no-live; Muster/AO/EO/simstack
  are live-eligible per founder decision 9.
- **Commit prefixes:** `GP-DEMO-4 acts:` (Tiers 1–2) · `GP-DEMO-5 muster:` (Tier 3).

---

## The registration recipe (shared by every new op-id slice)

Registering a new `DemoOpId` is a fixed 8-touch checklist. Every Tier 1–3 slice that adds an op id
does **all** of these, atomically, or a DD-rule reds (or, for step 8, a doc rots unguarded):

1. **`src/demo/show/deck-model.ts`** — add the id to the `DemoOpId` union **and** `DEMO_OP_IDS`.
   (`isDemoOpId` is derived; no edit.)
2. **`src/demo/show/op-catalog.ts`** — add the `OP_CATALOG[id]` entry (TS-forced: `Record<DemoOpId,…>`
   won't compile without it). Include `version`, `target`, `stageName`, `shows`, `modes`, `params`,
   `preconditions`, and `typicalWarmMs`. **`typicalWarmMs`:** seed a placeholder, run `--act <group>`
   once, then set it from that measurement and commit both together (`suggestMs` in `pacing.ts` rounds
   for you). Pacing findings (`PACE1`) are **`warn`-only** and do **not** change the exit code, and no
   pacing finding exists without a runtime run — so a rough guess never fails a gate, but an honest
   measured value is still required (and keeps the pacing table's verdict `ok`). **Do not put
   minute-valued prose** (`≈N min`, `N minutes`) in the dossier entry unless the catalog value is
   within [0.5×, 2.0×] of it — **DD10 is severity `fail`** and would red the docs-check. The new acts
   are all sub-minute, so simply omit minute-prose.
3. **`src/demo/show/ops/<id>-op.ts`** — new op implementation (or a thin delegate). Export it.
4. **`src/demo/show/op-registry.ts`** — wire it into `OP_IMPLEMENTATIONS`, and extend `armingFor`
   if it needs a surface.
5. **`docs/demo/OP-CATALOG.md`** — add the published authoring entry (params + measured warm cost).
6. **`DEMO-ACTS-DOSSIER.md`** — flip that entry's `STATUS` `PROPOSED → IMPLEMENTED`; **scrub the
   PARAMS line** (DD5b WARNs on drift and `npm test` asserts zero WARN); **re-stamp the `AS OF`
   Branch/HEAD cell** (DD11). Add/keep a section E note if a known inconsistency remains.
   - **DD5b scrub — the exact rule** (`paramKeysOf`, `dossier.ts` L173): only **backticked
     bare-identifier** tokens on the PARAMS *inline* line are read as param keys
     (`/^[A-Za-z][A-Za-z0-9]*$/`). Dotted (`` `ctx.armed` ``), underscored (`` `AO_DEMO_COMMAND_ID` ``),
     hyphenated, piped, and slashed tokens, plus `None`/`true`/`false`, all drop out for free. So a
     shipped param must appear backticked (`` `command` ``), and any `(proposed)` key you did **not**
     ship (`profile`, `keepEvidence`, `import`, `answer`, `compare`, …) must be removed **or** rewritten
     so it is not a bare backticked identifier. For a **zero-param** op, write DD2-non-empty prose with
     no bare backticked identifier — e.g. `PARAMS none — this act reads only ctx.armed` (no backticks).
7. **Harness** — `src/demo/acts/act-roster.ts` (add/extend the `ActGroup` + `checkIds`),
   `src/demo/acts/act-run.ts` (add the `Judge` + register in `JUDGES`; add a `SLIDE_PROBES` entry if
   evidence is only true between slides), and `src/cli/acts-test-command.ts` (`TIER_GROUPS.full`).
8. **`docs/demo/ACT-HARNESS.md`** — update it in the same slice. Its tier table, its runtime-checks
   table, and its **"What is out of scope at runtime"** section name every act this plan builds as
   docs-check-only / `:4173` never armed. Each statement goes false as its slice lands, and **no DD
   rule guards this file** — so it rots silently unless every slice edits it. Move the act out of
   "out of scope at runtime", add its group to the tier table, and add its check family to the
   runtime-checks table. This is a mandatory File-Inventory line on every slice below.

**Why the flip must be in-slice:** the moment an id enters `DEMO_OP_IDS` it is deck-invocable, so a
`PROPOSED` dossier entry trips **DD3** (`npm test` red). Conversely, flipping to `IMPLEMENTED` before
registering trips **DD3b**. They move together, by construction.

**Per-slice gates (every slice):**
- `npx tsc --noEmit` clean.
- `npm test` green (baseline 766/766; grows as tests are added).
- `npm run demo:acts-test -- --act <groupId>` proves the new act's `SUCCESS (TESTABLE)` (exit 0,
  or exit 1 with only an accepted `act-red`).
- `node bin/ces-tester.mjs demo:acts-test --docs-only` stays green (DD1–DD11 zero FAIL/WARN).

---

## TIER 1 — `GP-DEMO-4 acts:` (params-column already shipped; small)

### Slice 1A — `eo-verify-evidence` (runtime-verify; **no new op id**)

`eo-verify-evidence` is `eo-review` + `land=evidence`; D.15 is already `IMPLEMENTED` and the landing
already validates (`op-catalog.ts` `land` enum includes `evidence`). The op already screenshots the
Evidence Explorer (`eo-review-op.ts` L228-230, `03-evidence.png`). **The only work is runtime proof
of the cross-act chain**, which no group exercises today (the `eo-review` group runs `land=sprs`).

- **Design:** new act group `eo-verify-evidence` chaining, in one lifecycle:
  `ao-registry` (live) → `eo-review` (warm) → `eo-review` (live, `land=evidence`). **AO must be first**
  — `ao-registry` calls `ctx.pane.goto` unconditionally (A.3 trap), so placing it after EO warm would
  force the EO self-heal. Arming: `withAoGui: true, withEo: true`; ports `[4390, 3001, 4002]`.
- **Do NOT mutate the existing `eo-review` group.** Add a new group.
- **Cross-act check (API-first, honesty rule #3):** after the walk, fetch
  `GET <eoBaseUrl>/api/evidence-explorer/index?tenant=<simTenantId(slug)>` (endpoint verified in
  `ces-eo/public/index.html` L6920) and assert ≥1 record whose command id equals the AO command
  (`A-18`). Corroborate on the write side with the existing `readAoEvidence(aoDbPath(...), tenantId)`
  helper (same pattern as AO3). Also assert `eo-review-03-evidence.png` is registered on disk.
- **Judge/checks (new `EV1–EV3`):** EV1 the evidence-landing screenshot registered + on disk;
  EV2 the EO evidence-explorer API lists ≥1 record for the executed command; EV3 the AO write-side
  record names that command (reuse AO3 logic). Positively record the matching record id even when it
  is the only one (absence of a red is never evidence).
- **`SLIDE_PROBES` note:** this group's slide order is AO(live)→EO(warm)→EO(live), so the EO warm is
  slide **index 1**, not 0. If you want an EO1-style post-warm hydration probe, add a
  `SLIDE_PROBES['eo-verify-evidence']` that samples at `index === 1`. Otherwise state explicitly that
  hydration is not judged in this group (the landing screenshot + evidence API are the tells here).
- **Acceptance (D.15 DEFINITION OF SUCCESS):** the Evidence Explorer tab is active and contains ≥1
  record whose command id equals the one the AO act executed — the cross-act chain, not just the tab.

**File Inventory — Slice 1A**

| File | Action | Lines/Functions |
|---|---|---|
| `src/demo/acts/act-roster.ts` | MODIFY | new `eo-verify-evidence` `ActGroup`, `checkIds: [EV1,EV2,EV3,ARM1,TD1]` |
| `src/demo/acts/act-run.ts` | MODIFY | `judgeEoVerifyEvidence`; register in `JUDGES`; reuse `readAoEvidence`, add evidence-explorer fetch |
| `src/cli/acts-test-command.ts` | MODIFY | add `eo-verify-evidence` to `TIER_GROUPS.full` |
| `DEMO-ACTS-DOSSIER.md` | MODIFY | D.15 already IMPLEMENTED — add the harness-group note; re-stamp AS OF |
| `docs/demo/ACT-HARNESS.md` | MODIFY | add `eo-verify-evidence` to the tier/`--full` table + runtime-checks table (no DD rule guards this file) |
| `tests/…` | ADD | unit test for the new judge against fixtures |

### Slice 1B — `ao-make-change` (new op id; delegate)

Same flow as `ao-registry` with a different `command`. The implementation already exists
(`runAoUiFlow`); the block is only that `ao-make-change` is not a registered id.

- **Op impl:** `src/demo/show/ops/ao-make-change-op.ts` — a thin wrapper that calls `runAoUiFlow`
  exactly as `runAoRegistryOp` does, reading `ctx.slide.op.params?.command`. **Do NOT build alias
  resolution** (that is GP-DEMO-5 T3; `ACT_ALIASES` stays data-only).
- **`armingFor`:** `withAoGui: drivenOpIds.has('ao-registry') || drivenOpIds.has('ao-make-change')`.
- **Required-param resolution:** `validateParams` has **no** "required" concept — an absent param
  with no default resolves absent. So give `command` a **default of `A-18`** (the remediation
  command; `AO_DEMO_COMMAND_ID`, and per `e2e-run.ts` L24/L1196 it mutates `authorizationPolicy`,
  the MFA object). Amend D.12's PARAMS line accordingly, and amend D.12's SUCCESS clause "an unknown
  command fails at `--check` citing the catalog" — that is unsatisfiable for a `string` param;
  restate as "an unknown command is caught by the AO GUI at runtime (loud, in seconds)".
- **Act group `ao-make-change`:** slides `[ao-make-change live]`; arming `withAoGui`; ports
  `[4390, 3001]`. Checks mirror the AO family (`AM1–AM4` ≈ AO1–AO4).
- **Acceptance (D.12):** the named command executes against the sim slug; the targeted control
  changes state (assertable via the sim ledger or a follow-up assessment); the evidence record names
  that command.

**File Inventory — Slice 1B**

| File | Action | Lines/Functions |
|---|---|---|
| `src/demo/show/deck-model.ts` | MODIFY | `+ 'ao-make-change'` to `DemoOpId` + `DEMO_OP_IDS` |
| `src/demo/show/op-catalog.ts` | MODIFY | `OP_CATALOG['ao-make-change']` (target `ao`, param `command` default `A-18`) |
| `src/demo/show/ops/ao-make-change-op.ts` | CREATE | delegate to `runAoUiFlow` |
| `src/demo/show/op-registry.ts` | MODIFY | `OP_IMPLEMENTATIONS`; `armingFor` OR-clause |
| `docs/demo/OP-CATALOG.md` | MODIFY | new entry |
| `DEMO-ACTS-DOSSIER.md` | MODIFY | D.12 flip → IMPLEMENTED; PARAMS/SUCCESS amend; AS OF re-stamp; B-summary counts; refresh A.1 op-column "Accepts" example |
| `docs/demo/ACT-HARNESS.md` | MODIFY | move `ao-make-change` out of "out of scope at runtime"; add its group + `AM*` checks |
| `src/demo/acts/act-roster.ts` / `act-run.ts` / `src/cli/acts-test-command.ts` | MODIFY | group + judge + `TIER_GROUPS.full` |
| `tests/…` | ADD | judge + op unit tests |

### Slice 1C — `eo-show-change-captured` (new op id; compose)

New code: compose an EO re-assess with a delta-aware browse to the control that flipped. This is the
**highest-uncertainty** slice — do the empirical flip check first.

- **Group composition:** `eo-review` (warm — the "before") → `ao-make-change` (live, `command=A-18`,
  the remediator) → `eo-show-change-captured` (**live** re-assess + delta-walk). Arming `withAoGui`
  + `withEo`; ports `[4390, 3001, 4002]`. **The re-assess half is `live`-required, not `warm`:** in a
  real deck (`show-run.ts`) warm ops fire during prep, *before* any live remediator, so a warm
  re-assess would capture "after" before remediation ran. Drop `warm` from D.16 MODES and warn deck
  authors. (In the harness the group is sequential, so ordering is safe either way — but ship the op
  to match the real-deck constraint.)
- **Before/after artifacts (they do not exist today) — and the before-capture is itself unverified:**
  `eo-review` logs API numbers but persists no determination JSON. **Resolve at build (empiricism #1,
  before the flip logic):** determine whether EO's `GET /api/assessment` still returns the
  *pre-remediation* numbers by the time this act starts. `ao-make-change` (A-18) mutates the tenant in
  between, and if the EO server re-reads tenant state per request rather than caching the warm
  snapshot, the "before" call already reflects remediation and the act is **vacuous** (the honest
  no-change fallback prevents *dishonesty* but not *vacuity*). Two required build-time checks:
  1. **Capture "before" at the earliest honest point** — snapshot `GET /api/assessment` + `/api/sprs`
     to `<runDir>/eo-before.json` **immediately after the `eo-review` warm leg hydrates, before
     `ao-make-change` runs** (a `SLIDE_PROBES['eo-show-change-captured']` sampling after the warm
     slide index is the seam — the same between-slides pattern EO1/ST2 use). Do **not** rely on the
     re-assess to read a stale "before"; capture it while it is provably still true.
  2. **Cross-check `eo-before.json` numerically against the `eo-review`-warm leg's own logged API
     numbers** (the op already logs met/not-met/SPRS — the check is free). If they disagree, the
     before-state was already lost → the act reports the honest **"no reliable before"** outcome and
     does not narrate a delta.
  Then snapshot `<runDir>/eo-after.json` post-re-assess. Register both via `ctx.artifact?.()`. D.16
  requires artifact-sourced before-numbers, never memory.
- **Flip empiricism (resolve at build):** it is **not proven** that `A-18` flips an EO-assessed
  `IA.L2-3.5.3` determination. The demo narrative (`e2e-run.ts` clause 10) proves the flip after
  *Stamper* enforcement (report-only → enforced). During this slice, **measure** whether `A-18`
  alone flips the EO determination in-harness:
  - If it does → the op asserts the direction (`not_met → met`) and the SPRS delta.
  - If it does **not** within the harness budget → the op ships proving the **honest no-change path**
    (D.16 SUCCESS clause d: "if no flip occurred, the act fails or reports 'no change' — never render
    the flip narrative unconditionally"), and the plan documents that the full flip is demonstrated
    via `stamper-execute` in the arc deck (the ~13 min path), out of the `--quick`/per-act budget.
  The op's correctness never depends on the flip happening; the check asserts *either* (flip +
  correct direction) *or* (honest no-change report), never an unconditional flip narrative.
- **Params:** `control` (default `IA.L2-3.5.3`), `family` (default `IA`) — both `string`, defaulted.
- **Checks (`EC1–EC5`):** EC1 both `eo-before.json` and `eo-after.json` exist and parse;
  **EC2 `eo-before.json` matches the `eo-review`-warm leg's logged API numbers** (the before-capture
  is real, not already-remediated); EC3 the named control's status is compared and the direction
  asserted (or "no change"/"no reliable before" recorded); EC4 the SPRS delta computed from the two
  artifacts equals the on-screen delta; EC5 if no flip (or no reliable before), the op logged the
  honest line and did **not** narrate a flip.
- **Acceptance (D.16):** both before/after assessments exist as artifacts; the control's status is
  compared with the direction asserted; the SPRS delta matches on-screen; a non-flip reports plainly.

**File Inventory — Slice 1C**

| File | Action | Lines/Functions |
|---|---|---|
| `src/demo/show/deck-model.ts` | MODIFY | `+ 'eo-show-change-captured'` |
| `src/demo/show/op-catalog.ts` | MODIFY | new entry (target `eo`, params `control`,`family`) |
| `src/demo/show/ops/eo-show-change-captured-op.ts` | CREATE | reuse `assessInPane`/`readEoNumbers` from `eo-review-op.ts`; snapshot before/after |
| `src/demo/show/op-registry.ts` | MODIFY | `OP_IMPLEMENTATIONS`; `armingFor` (`withEo` OR-clause) |
| `docs/demo/OP-CATALOG.md` | MODIFY | new entry |
| `DEMO-ACTS-DOSSIER.md` | MODIFY | D.16 flip; **mark the re-assess half `live`-required (drop `warm` from MODES)**; AS OF re-stamp; B-summary; refresh A.1 example |
| `docs/demo/ACT-HARNESS.md` | MODIFY | move `eo-show-change-captured` out of "out of scope at runtime"; add its group + `EC*` checks |
| `src/demo/acts/act-roster.ts` / `act-run.ts` / `src/cli/acts-test-command.ts` | MODIFY | group + judge + `TIER_GROUPS.full` |
| `tests/…` | ADD | pure delta-compare unit tests against before/after fixtures |

---

## TIER 2 — `GP-DEMO-4 acts:` (modest; promote arming capabilities to ops)

**Shared design constraint (grounded in `arm-sim.ts` + ACT-HARNESS.md):** arming already seeds and
serves the sim before any op runs (seed requires serve DOWN — exclusive lock). An op therefore
**cannot** re-seed live. Both Tier 2 acts are **READOUT/terminal-theater over the already-armed
environment** — readout-first is explicitly fine. Neither forks arming.

### Slice 2A — `simstack-create` (new op id; readout of armed state)

- **Op impl:** `src/demo/show/ops/simstack-create-op.ts` — reads the armed sim, renders a
  terminal-theater/readout, and asserts the deliberate gap is present:
  - Query the sim: `GET <simUrl>/v1.0/policies/authorizationPolicy` answers (proves the tenant
    materialized).
  - Read the registry record at `<runDir>/tenant-root/sim/<slug>.json` (reconstruct root as
    `path.join(armed.runDir, 'tenant-root')`, same reconstruction pattern AO3 uses for `pipeline`):
    assert all four auth fields valid, **absolute** `cert_path`, no `SIMTHUMBPRINT…` placeholder.
  - Assert the gap: `caPolicy-1` is `state: 'enabledForReportingButNotEnforced'`
    (`tenant-stacksim/scripts/build-demo-scenario.mjs` L83-95) — **report-only, never "absent"** (the
    dossier D.1 ⚠ correction; the concept doc's "MFA policy absent" is wrong).
  - Render via `htmlDataUrl()` (readout) with the create-ledger/gap facts; register the readout.
- **Params:** **none** — the readout reads only `ctx.armed`/`ctx.options`. Ship `params: []`; scrub
  D.1's `(proposed)` `slug`/`profile` at flip (DD5b). Rewrite D.1 MODES/POSTCONDITIONS text so it
  says "presents what prep built" — a live re-seed claim would be dishonest and would trip the
  honesty axis.
- **Group `simstack-create`:** slides `[simstack-create live]`; `armingFor` adds nothing
  (`NO_EXTRA_SURFACE`); ports `[4390]`. Checks `SC1–SC3`: SC1 sim answers the policy endpoint;
  SC2 registry record has four valid auth fields + absolute cert_path; SC3 the gap
  (`enabledForReportingButNotEnforced`) is present.
- **Acceptance (D.1):** sim answers `GET /v1.0/policies/authorizationPolicy`; registry record valid
  (no placeholder, absolute path); the report-only gap present.

### Slice 2B — `simstack-destroy` (new op id; wrap teardown + add mode validation)

- **Op impl:** `src/demo/show/ops/simstack-destroy-op.ts` —
  `createTenantRegistry({ registryRoot: path.join(armed.runDir, 'tenant-root'), stacksimRoot: ctx.options.stacksimRoot })`
  then `teardownEphemeralSimTenant(registry, slug)` (deletes exactly `sim/<slug>.json`; idempotent;
  refuses live slugs). **Never** shell to `demo:reset` (its `clear-runs` deletes the run's own
  evidence — dossier D.2 box). Render a confirmation readout naming what was removed (the record) and
  what was kept (all `runDir` evidence). `keepEvidence` is hardcoded true (not a knob) — ship
  `params: []`; scrub D.2's `(proposed)` params at flip.
- **Mode-vs-catalog validation (new small feature, this slice):** D.2 SUCCESS requires a deck
  declaring `warm` to fail with a catalog error, and `warm` to be rejected. Today `deck-validate.ts`
  L296 only checks `isOpMode` (live|warm|staged) — **not** against `OP_CATALOG[id].modes`. Add a
  validation in `deck-validate.ts`: a slide whose `op.mode` is not in `OP_CATALOG[opId].modes` is a
  load error citing the catalog. Ship `simstack-destroy` with `modes: ['staged','live']` (no `warm`).
  This is a general, useful loader improvement — verify existing decks/tests still pass (every current
  op lists `warm` where used).
- **Group `simstack-destroy`:** slides `[simstack-destroy live]`; `armingFor` adds nothing; ports
  `[4390]`. Put destroy **last** in any multi-op group. Checks `SD1–SD4`: SD1 after the act
  `listByKind('sim')` does not contain the slug; SD2 a second run succeeds (idempotence); SD3 a
  live-slug target throws the refusal error (assert error text); SD4 `runDir` still contains every
  artifact written before it ran.
- **Acceptance (D.2):** `listByKind('sim')` no longer contains the slug; twice-run succeeds; a
  live-slug target throws rather than deleting; `runDir` evidence intact.

**File Inventory — Tier 2 (both slices)**

| File | Action | Lines/Functions |
|---|---|---|
| `src/demo/show/deck-model.ts` | MODIFY | `+ 'simstack-create'`, `+ 'simstack-destroy'` (one per slice) |
| `src/demo/show/op-catalog.ts` | MODIFY | two entries (target `stacksim`, `params: []`; destroy `modes` omit `warm`) |
| `src/demo/show/ops/simstack-create-op.ts` / `simstack-destroy-op.ts` | CREATE | readout + registry teardown |
| `src/demo/show/op-registry.ts` | MODIFY | `OP_IMPLEMENTATIONS` (both) |
| `src/demo/show/deck-validate.ts` | MODIFY | **2B:** mode ∈ `OP_CATALOG[id].modes` validation |
| `docs/demo/OP-CATALOG.md` | MODIFY | two entries |
| `DEMO-ACTS-DOSSIER.md` | MODIFY | D.1 & D.2 flips; scrub proposed params; rewrite D.1 MODES text; AS OF; B-summary; section E10 note; refresh A.1 example |
| `docs/demo/ACT-HARNESS.md` | MODIFY | move `simstack-create`/`simstack-destroy` out of "out of scope at runtime"; add their groups + `SC*`/`SD*` checks |
| `src/demo/acts/act-roster.ts` / `act-run.ts` / `src/cli/acts-test-command.ts` | MODIFY | groups + judges + `TIER_GROUPS.full` |
| `tests/…` | ADD | teardown idempotence/refusal unit tests; mode-validation loader test |

---

## TIER 3 — `GP-DEMO-5 muster:` (real build; the 5 Muster GUI acts)

The largest slice. Decomposed: **driver + arming first (3.0)**, then one act per slice (3.1–3.4).
The five acts share **one act group** (`muster-gui`) grown incrementally, because they are
workflow-sequential SPA state (like the `eo-review` warm→live pair). Each slice registers its own op
id so DD3 flips stay atomic.

### Muster driver design (grounded in `../ces-muster`, file-verified this session)

- **Serving:** SPA is Vite `npm run preview` on **:4173** (`vite.config.ts` has no port override;
  `playwright.config.ts` L6/L11 confirm), serving a prebuilt `dist/`. `dist/index.html` exists but a
  fresh/honest run should build first (`npm run build` = `tsc && vite build`).
- **New arming module `src/demo/show/arm-muster.ts`** (mirror `arm-eo.ts`): spawn the preview server.
  **Windows/PS5.1:** spawn `npm.cmd run preview` (or `cmd /c npm run preview`) with `cwd = musterRoot`;
  wait for readiness on `http://127.0.0.1:4173/`. Add `MUSTER_SPA_PORT = 4173`. Return a handle with
  `stop()`. Probe 4173 before spawning (arm-sim's existing pattern).
  **⚠ TD1 teardown risk (Windows grandchild):** `npm.cmd run preview` launches vite preview as a
  **grandchild** of the npm process; killing only the npm child orphans vite, which keeps holding
  :4173 and **reds TD1** (`probePort` not free after `dispose()`). Do **not** assume "mirror arm-eo"
  solves this — first confirm `arm-eo`'s actual kill is a **process-tree** kill (`taskkill /T /F /PID`
  or `tree-kill`). If it is not, either spawn the vite preview binary directly
  (`node_modules/.bin/vite preview --port 4173`, no npm wrapper) or add a `taskkill /T /F` on the
  spawned PID. State the chosen mechanism in the slice and cover it with the TD1 check. **Operator prerequisite:** probe
  `<musterRoot>/dist/index.html`; absent → the harness exits **2** naming `npm run build` in
  ces-muster (ces-tester never builds a sibling — mirror `MUSTER_CLI_RELATIVE` handling in
  `act-run.ts` L1111-1118).
- **`ArmedEnvironment` gains `musterBaseUrl?: string`** (`op-registry.ts`); `arm-sim.ts` gains a
  `withMuster` branch calling `arm-muster`; `armingFor` adds
  `withMuster: <any muster-gui op driven>`; `ArmedSim.stop()` stops the preview server (reverse
  acquisition order).
- **New driver `src/demo/muster-ui-driver.ts`** (mirror `eo-ui-driver.ts`/`ao-ui-driver.ts`), exports
  `MUSTER_SELECTORS` (verified testids below) + per-beat flow functions. Copy sequences from
  ces-muster's own suite: `e2e/helpers.ts` (manifest fill, interview walk, finish),
  `e2e/five-tabs.spec.ts` (discovery→boundary→interview click-through),
  `e2e/prime-and-subs-happy.spec.ts` ("EU-1" happy path).
- **`UiPage` seam extension (needed for the import seam):** the discovery import is a
  `<input type="file">`; `UiPage` has no `setInputFiles` verb. Add `setInputFiles(selector, absPath)`
  to the `UiPage` interface (`src/demo/ui-page.ts`) implemented via Playwright
  `locator.setInputFiles`, testable against a hand-written `UiPage`. (Alternative: `ctx.pane.session.raw`
  — prefer the seam method for testability.)

**Verified `data-testid` selectors (file:line, current source):**

| Beat | Selectors |
|---|---|
| connect-tenant | `nav-tab-situation` (ShellNav.tsx:28) · `tab-profile` (AssessmentPage.tsx:581) · `readiness-manifest-capture` (750) · `rm-mode` (759) · `rm-auth-tier` (782) · `rm-tenant-slug` (797) · `rm-tenant-kind` (805) · `rm-operator-name` (818) · **`rm-operator-role` (826, schema-required)** · `begin-interview` (886) |
| auto-analysis | `nav-tab-discovery` · `discovery-offer` · **`discovery-import-input` (DiscoveryOffer.tsx:90, file input)** · `discovery-import-error` (95) · lands on `boundary-confirm-panel` — **NOT** `discovery-sub-tab`/`discovery-summary` (those are the fixture-run path) · **AVOID `discovery-run-btn` (70)** |
| consent-attest | `boundary-confirm-panel` (71) · `boundary-confirmer-name` (84) · `boundary-confirm-${qid}` (139) · `boundary-continue-btn` (162) |
| adaptive-interview | `progress-note` (AssessmentPage.tsx:976, text `"${n} of ${N} answered"`) |
| generate-sprs-mp | `finish-interview` (1011, → navigates to **`result` view**) · **`conservative-score` (ResultScreen.tsx:91, honest per-session SPRS)** · `export-readiness-result` (ResultScreen.tsx:150) · `export-evidence-package` (ResultScreen.tsx:140) |

### Slice 3.0 — arming + driver skeleton + `muster-connect-tenant`

- `arm-muster.ts`, `armingFor` `withMuster`, `ArmedEnvironment.musterBaseUrl`, `UiPage.setInputFiles`,
  `muster-ui-driver.ts` skeleton + connect flow.
- **Op `muster-connect-tenant`** (`src/demo/show/ops/muster-connect-tenant-op.ts`): drive
  `nav-tab-situation` → fill the manifest (`rm-mode`, `rm-auth-tier`, `rm-tenant-slug`,
  `rm-operator-name`, `rm-operator-role`) → `begin-interview`. Drive `rm-operator-role` for
  completeness/honesty, but the **real** persistence gate is `operator_name` + `tenant_slug` — the SPA
  defaults `operator_role` to `'assessor'` (`AssessmentPage.tsx:127,141`), so the export does not fail
  without it. Params: `mode`, `authTier`, `slug` (defaults matching the CLI stub:
  `independent`/`cert-app-only`/`demo-dib-small`).
- **Group `muster-gui`:** slides `[muster-connect-tenant live]`; arming `withMuster`; ports
  `[4390, 4173]`. Checks `MU-C1`: after the act, `tab-profile` visible, the `rm-*` fields carry the
  declared values, `begin-interview` reachable.
- **Acceptance (D.4):** `nav-tab-situation` → `tab-profile` visible; `rm-*` carry declared values;
  `begin-interview` reachable. Negative: `buildReadinessResult()` throws without a manifest.

### Slice 3.1 — `muster-auto-analysis` (CLI walk → import seam; the honesty centerpiece)

- **Op** runs the **real CLI walk** first (terminal-theater), then imports its artifact:
  `node <musterRoot>/muster-api/dist/cli/bin.js discovery --sim --out <runDir>/readiness-result.json --slug <slug>`
  (needs stacksim on :4390 — arming provides — and the `ces-stamper` registry; the CLI reads it).
  **Copy the spawn pattern from `src/demo/show/ops/muster-readiness-op.ts`** (which already drives this
  exact CLI): it sets `STAMPER_REGISTRY_ROOT = <stamperRoot>/src/registry` in the child env before
  spawning, injects `spawnCli`/`fileExists`/`readArtifact` seams for testability, and does NOT fail the
  show when `bin.js` is missing. Reuse those seams; do not re-invent the spawn.
  Then in the SPA: `nav-tab-discovery` → `page.setInputFiles('[data-testid=discovery-import-input]',
  <runDir>/readiness-result.json)`. The CLI output is `readiness-result/1.0.0` and validates against
  the **same** schema the SPA import validates against (both AJV `strict:true`), so import is
  guaranteed valid.
- **⚠ Dossier drift — correct in this slice (D.5 SUCCESS c):** the clause reads "after import,
  `discovery-sub-tab` and `discovery-summary` are visible and the on-screen counts **equal the
  artifact's counts** (screen and file can never disagree)." Two parts, both wrong for the honest
  import path:
  - **Landing testids:** the import path lands on **`boundary-confirm-panel`**, NOT
    `discovery-sub-tab`/`discovery-summary` (those render only on the fixture-run branch, `App.tsx`
    L253-257). Assert `boundary-confirm-panel` visible after import. **Never** click `discovery-run-btn`.
  - **The "on-screen counts equal the artifact's counts" clause is RETIRED, not silently dropped —
    stated reason:** imported discovery has **no on-screen count surface** before boundary
    (`discovery-summary` is fixture-branch-only), so there is no honest screen number to equate. The
    equality the clause protects (screen and file cannot disagree) is **re-pinned upstream**: the SPA
    import validates the **same** `readiness-result/1.0.0` schema (AJV `strict:true`) the CLI emitted,
    so the imported payload **is** the CLI artifact byte-for-byte. Assert instead: the CLI artifact's
    posture tally (via the CLI's own summary / `tallyPostures`) equals the counts in the file that was
    imported. Record this retire+re-pin in the dossier D.5 SUCCESS clause and the "Dossier drift to
    fix" section — do not leave the founder-approved clause dropped.
- **Negative assertion (D.5 d):** the fixture's signature values must be absent from what is
  displayed. Extract `DISCOVERY_RESULTS_FIXTURE`'s signature values at build (App.tsx:13 import → the
  fixture module) and assert they are absent. Ledger create+mutate delta **=== 0** (the CLI asserts
  this itself, GATE-5; re-verify from its output).
- **Acceptance (D.5, corrected):** CLI artifact exists and Ajv-validates as `readiness-result/1.0.0`;
  ledger delta 0; the imported payload's posture counts equal the CLI artifact's own tally (the
  re-pinned equality, since imported counts have no pre-boundary on-screen surface); after import,
  `boundary-confirm-panel` visible; the act never calls `discovery-run-btn` (fixture signature absent).

### Slice 3.2 — `muster-consent-and-attest`

- Drive `boundary-confirmer-name` (non-blank; a blank is rejected — `boundary-name-required`),
  optionally `boundary-confirm-${qid}` per draft, then `boundary-continue-btn`. **Gating:**
  `boundary-confirm-${qid}` is disabled until the name is non-empty; `boundary-continue-btn` is
  blocked only if a confirm exists with a blank name. For pruning-only, leave drafts unconfirmed and
  continue (what `five-tabs.spec.ts` does).
- **Acceptance (D.6):** `boundary-confirm-panel` visible; a blank `boundary-confirmer-name` rejected;
  after `boundary-continue-btn` the confirmed fact carries the operator name + upgraded provenance;
  unconfirmed drafts still score identically to no facts ("drafts prune but never pass").

### Slice 3.3 — `muster-adaptive-interview`

- After discovery import (3.1) prunes questions, read `progress-note` ("of N answered"). Compare the
  discovery-branch total to the manual-branch total for the same profile (the exact assertion
  `e2e/five-tabs.spec.ts` makes, regex `/of (\d+) answered/`).
- **Manual-branch total source (pick one, state it):** either (a) a **second no-import interview walk**
  in the same group lifecycle (Skip-to-Manual → read `progress-note`) — costs one extra walk but never
  drifts; or (b) a pinned constant — cheaper but drifts with the question graph. **Recommend (a)** (a
  live count that cannot drift), mirroring `five-tabs.spec.ts`'s own two-branch comparison.
- **Acceptance (D.7):** the discovery branch's question total is strictly less than the manual
  branch's for an identical starting profile; an `unknown`-confidence fact does not prune its question.

### Slice 3.4 — `muster-generate-sprs-mp`

- **⚠ Dossier drift — correct in this slice (D.8 SUCCESS a/c):** two errors in the dossier clause.
  (1) `readiness-sprs-score` (ReadinessTab.tsx:66) is a **fixture constant** (`RESULTS_MATRIX_FIXTURE`),
  NOT the walk's score; the honest per-session number is `conservative-score` (ResultScreen.tsx:91), on
  the **`result` view** reached by `finish-interview` (auto-navigates), NOT via `nav-tab-readiness`.
  (2) **The `/^-?\d+$/` regex is REFUTED by source:** `conservative-score`'s text is
  `"{score}% compliant"` (ResultScreen.tsx:91-93; ces-muster's own e2e matches `/^0%/`, never a bare
  integer). So **do not scrape a bare integer from the DOM.**
- **Honest number source (A.5#3 — numbers come from the artifact, never the DOM):** drive
  `finish-interview` → `export-readiness-result` (capture the file via `page.waitForEvent('download')`
  per ces-muster's own e2e) → read the integer SPRS score **from the exported `readiness-result/1.0.0`
  payload**. If the DOM is asserted at all, match `/^-?\d+% compliant/` — never `/^-?\d+$/`.
- **Acceptance (D.8, corrected):** the exported payload Ajv-validates against
  `readiness-result.schema.json`; the SPRS integer is read from that payload (not the DOM);
  `conservative-score`'s DOM text, if checked, matches `/^-?\d+% compliant/` and its numeric part
  equals the payload score; only `met` passes (partial/unknown deduct full weight — `sprsCalc.ts`
  L71-77); if plan-mode is exercised, the emitted artifact id is `manual_mission_plan`. **Amend the
  D.8 SUCCESS (a) clause to drop `/^-?\d+$/` and cite the exported-payload integer.**

**File Inventory — Tier 3 (across slices)**

| File | Action | Lines/Functions |
|---|---|---|
| `src/demo/show/arm-muster.ts` | CREATE | spawn `npm run preview` on :4173; readiness; `stop()`; dist/ prereq probe |
| `src/demo/show/arm-sim.ts` | MODIFY | `withMuster` branch; port probe 4173; `stop()` chain |
| `src/demo/show/op-registry.ts` | MODIFY | `ArmedEnvironment.musterBaseUrl`; `armingFor.withMuster`; `OP_IMPLEMENTATIONS` (5 ids) |
| `src/demo/ui-page.ts` | MODIFY | add `setInputFiles(selector, absPath)` to `UiPage` + impl |
| `src/demo/muster-ui-driver.ts` | CREATE | `MUSTER_SELECTORS` + 5 beat flows |
| `src/demo/show/deck-model.ts` | MODIFY | `+` 5 muster op ids (one per slice) |
| `src/demo/show/op-catalog.ts` | MODIFY | 5 catalog entries (target `muster`) |
| `src/demo/show/ops/muster-*-op.ts` | CREATE | 5 op impls (one per slice) |
| `docs/demo/OP-CATALOG.md` | MODIFY | 5 entries |
| `DEMO-ACTS-DOSSIER.md` | MODIFY | D.4–D.8 flips (one per slice); **correct D.5/D.8 SUCCESS drift**; add `rm-operator-role` to the flow; AS OF re-stamp each slice; B-summary; refresh A.1 example; A.5#1 fixture-button note stays |
| `docs/demo/ACT-HARNESS.md` | MODIFY | **per slice:** move that Muster act out of "The five Muster GUI acts (D.4-D.8) … `:4173` never armed. Docs check only." bullet; add `muster-gui` group to the tier table once `:4173` is armed |
| `src/demo/acts/act-roster.ts` | MODIFY | `muster-gui` group grown per slice; `expectedPorts [4390,4173]` |
| `src/demo/acts/act-run.ts` | MODIFY | `judgeMusterGui` grown per slice; `SLIDE_PROBES` for sequential SPA state |
| `src/cli/acts-test-command.ts` | MODIFY | add `muster-gui` to `TIER_GROUPS.full` (in 3.0) |
| `tests/…` | ADD | driver unit tests against a fake `Page`; per-act judge tests |

---

## Final loop slice — `--full` green across every implemented act

After all slices land, run the full harness and confirm the expected finding list:

```
npm run build
node bin/ces-tester.mjs demo:acts-test --full
```

- **Prerequisites:** `../ces-muster/muster-api/dist/cli/bin.js` and `../ces-muster/dist/index.html`
  built; ports 4390/3000/3001/4002/4173 free; ces-stamper registry present.
- **Expected result: exit 1** — not 0 — because the **rotating AZ-NSG honest red** surfaces. The
  Stamper group's **SE3** reports exactly one unexpected failure (`AZ-NSG-004` **or** `AZ-NSG-005`;
  they rotate run-to-run and are deliberately UNPINNED — pinning one would green a genuine different
  failure the next run), classified **`act-red`**. Every other act passes.
- **Tier floor (must hold):** zero `harness-defect` findings, unconditionally. The one `act-red`
  (Stamper SE3) is the only FAIL; every green branch is positively proven (partition/listing/refusal
  evidence recorded even when zero). This is the definition of "green" for this deliverable: all acts
  pass except the accepted, recorded Stamper red.
- **Accepted red vs rerun-worthy red:** exit 1 is only "done" when the **sole** FAIL is the Stamper
  SE3 `act-red` (rotating AZ-NSG). Any other non-zero finding — a `harness-defect`, an `environment`
  FAIL (EO2's empty-family case, a busy/stranded port, an unreadable sibling), or an `act-red` on any
  other act — is **fix-and-rerun**, not accept. `pace`/`doc-drift` `warn`s do not change the exit code
  but should still be driven to zero. Classify before you accept.
- Transcribe final evidence into `docs/context/IMPLEMENTATION_LOG.md` (`runs/` is gitignored — the log
  is the evidence). Do **not** add AZ-NSG to any skip-list to force exit 0.

**Do NOT invent a new tier flag.** `--act <group>` already covers per-slice runs; `--full` is the
final gate. Add each new group to `TIER_GROUPS.full` in its own slice.

---

## Architecture Decisions

- **New op ids, not alias resolution.** `ao-make-change` and `eo-verify-evidence` could be aliases,
  but `ACT_ALIASES` resolution is GP-DEMO-5 T3 and explicitly deferred (dossier A.1). `ao-make-change`
  becomes a real registered id; `eo-verify-evidence` stays an `eo-review` **configuration**
  (`land=evidence`, already invocable) and is only *runtime-verified*, not registered.
- **Readout-over-armed-state for simstack acts.** Arming seeds before serving (exclusive lock), so an
  op cannot re-seed. Both simstack acts present what prep built and assert it — never fork arming
  (ACT-HARNESS.md forbids it). Dossier D.1 MODES text is rewritten to match this truth.
- **`command` gets a default (`A-18`).** `validateParams` has no "required" concept; a default is the
  honest fix, and `A-18` is the remediation command the demo already uses. D.12's `--check` SUCCESS
  clause is amended (a `string` param cannot be enum-validated at `--check`).
- **Mode-vs-catalog validation added.** Needed to make D.2's "reject `warm`" clause honest;
  implemented as a general loader improvement in `deck-validate.ts`.
- **Muster driver copies ces-muster's own Playwright suite.** 76 stable testids + a golden happy path
  make this the cheapest of the four GUI drivers; the file input forces one `UiPage.setInputFiles`
  seam addition.
- **Honesty composition for Muster is load-bearing:** real CLI walk → `readiness-result.v1` → SPA
  file-import seam; never the `discovery-run-btn` fixture. Same schema both sides guarantees valid
  import.

## Dossier drift to fix in-slice (ces-muster investigation, file-verified)

These correct the dossier's own SUCCESS clauses — the file:line-verified names win:

1. **D.5 (`muster-auto-analysis`):** the import path lands on `boundary-confirm-panel`, **not**
   `discovery-sub-tab`/`discovery-summary` (fixture-branch testids; asserting them would force the
   fixture button). The "on-screen counts equal the artifact's counts" clause is **retired** (imported
   discovery has no pre-boundary count surface) and **re-pinned** to the CLI-artifact-equals-import
   equality (same `readiness-result/1.0.0` schema both sides). Record the retire+re-pin in the D.5
   clause — do not drop it silently.
2. **D.8 (`muster-generate-sprs-mp`):** `readiness-sprs-score` is a fixture constant; the honest
   per-session score is `conservative-score` (result view, reached by `finish-interview`, not
   `nav-tab-readiness`). **The `/^-?\d+$/` regex is refuted** — the DOM text is `"{score}% compliant"`.
   Source the integer from the **exported payload** (A.5#3); match DOM only as `/^-?\d+% compliant/`.
3. **D.4 (`muster-connect-tenant`):** drive `rm-operator-role` for honesty/completeness. **Rationale
   corrected (P2):** the SPA defaults `operator_role` to `'assessor'` (`AssessmentPage.tsx:127,141`),
   so the export does **not** fail without it — the real persistence gate is `operator_name` +
   `tenant_slug`. Do **not** build a "throws without role" negative test on the overstated premise.

## Testing Strategy

- **Unit (`npm test`, no browser):** pure judges against before/after and dossier fixtures; the
  mode-validation loader test; the teardown idempotence/refusal tests; the Muster driver against a
  hand-written `UiPage`/fake `Page`. Every new op keeps side effects injectable (spawn, fileExists,
  fetch) so tests need no siblings.
- **Runtime (`demo:acts-test --act <group>` per slice; `--full` at the end):** proves each act's
  DEFINITION OF SUCCESS against the real apps, artifact-first.
- **Docs (`demo:acts-test --docs-only`, runs in every tier):** DD1–DD11 gate every dossier flip.

## Out of Scope

- The in-slide mirror (T1.5), the theatrical cursor layer (T1), terminal-theater rendering (T2) —
  CONCEPT §6 is out of scope here; acts ship as READOUT/plain-drive today.
- Any live Config (Stamper) product demo — item 2 still binds; Stamper stays no-live, hub-and-spoke.
- Alias-cell resolution (`ACT_ALIASES`) — GP-DEMO-5 T3, not this pass.
- Building any sibling (`ces-muster` `dist/`, `muster-api` `dist/`) — operator prerequisite; the
  harness exits 2 naming the remedy.
- Writing to any sibling project root; `git add -A`/`git add .`; commits/pushes;
  `session-ces-tester-*.md` writes.
- Pinning AZ-NSG-004/005 — the rotating honest red stays red (accepted `act-red`).

## Acceptance Criteria

- [ ] **1A `eo-verify-evidence`:** Evidence Explorer active, contains ≥1 record whose command id
      equals the AO command (cross-act chain).
- [ ] **1B `ao-make-change`:** named command executes against the sim slug; targeted control changes
      state; evidence record names the command.
- [ ] **1C `eo-show-change-captured`:** before/after artifacts exist; `eo-before.json` matches the
      warm leg's logged numbers (real before-capture); control status compared + direction asserted
      (or honest "no change"/"no reliable before"); SPRS delta matches on-screen; re-assess is `live`.
- [ ] **2A `simstack-create`:** sim answers the policy endpoint; registry record valid (no
      placeholder, absolute cert_path); report-only gap present.
- [ ] **2B `simstack-destroy`:** slug gone from `listByKind('sim')`; idempotent; live-slug refusal
      throws; `runDir` evidence intact; a `warm` deck cell fails the loader.
- [ ] **3.0 `muster-connect-tenant`:** manifest captured (incl. operator role); `begin-interview`
      reachable; missing manifest makes export throw.
- [ ] **3.1 `muster-auto-analysis`:** CLI artifact Ajv-valid `readiness-result/1.0.0`; ledger delta 0;
      imported payload counts equal the CLI artifact tally (re-pinned equality); import lands on
      `boundary-confirm-panel`; `discovery-run-btn` never clicked.
- [ ] **3.2 `muster-consent-and-attest`:** blank confirmer rejected; confirmed fact carries operator
      name; unconfirmed drafts score as no facts.
- [ ] **3.3 `muster-adaptive-interview`:** discovery-branch question total strictly < manual branch.
- [ ] **3.4 `muster-generate-sprs-mp`:** SPRS integer read from the **exported payload** (not the DOM;
      `/^-?\d+$/` refuted — DOM is `"{score}% compliant"`); export Ajv-valid; DOM (if checked) matches
      `/^-?\d+% compliant/` and its numeric part equals the payload; only `met` passes; plan-mode
      artifact id `manual_mission_plan`.
- [ ] **Final:** `demo:acts-test --full` exits 1 with exactly one Stamper SE3 `act-red` (rotating
      AZ-NSG) and **zero** `harness-defect`; every other act green; evidence in IMPLEMENTATION_LOG.
- [ ] Every slice: `tsc --noEmit` clean, `npm test` green, docs-check zero FAIL/WARN, one commit with
      the correct prefix, AS OF re-stamped.
