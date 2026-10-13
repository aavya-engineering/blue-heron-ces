# The demo op catalog — the authoring vocabulary for `demo:show` decks

**The boundary, stated once.** ces-strategy writes op intents by **id** and **declared
parameters** only. Implementations, selectors and environment handling stay in ces-tester.

There are deliberately **no step-level primitives** — no `click`, no `navigate`, no `wait`, no
selector cells. A deck carrying selectors is a deck that breaks whenever a sibling's markup moves,
in front of a customer, with no useful error. Both sides refuse that. What a deck names instead is
a **demo act**: a routine end ("evaluate this tenant's readiness", "browse the determinations"),
never a mouse click.

This document is generated-adjacent, not generated: `src/demo/show/op-catalog.ts` is the source of
truth and **a test fails if this file drifts from it** (`tests/demo-show-op-catalog.test.ts`).

## How to write an op in a deck

| Column | What you put there |
|---|---|
| `op` | a registered op id from the table below. Header aliases `act` / `demo act` / `demo-act` work too. |
| `op mode` | `live`, `warm` or `staged` — see `demos/README.md`. |
| `params` | `key=value`, **one per line** (Alt+Enter in Excel). Blank is fine; every parameter has a default. |
| `duration (sec)` | the slide's dwell. A `live` slide holds past it until the op completes. |

```
op:        eo-review
op mode:   live
params:    family=AC
           land=evidence
```

**Every parameter error names the key, the supported keys, and this file by path.** An unknown key,
a bad enum value, a non-numeric number, a non-`true|false` boolean, or a `params` cell on a slide
with no `op` — all are load-time errors, caught by `demo:show --check` before you ever stand up.

`params`, like the other op fields, resolves **unique-or-agree** across a slide's rows. Two rows
writing the same parameters in a different order is not a conflict; two rows writing *different*
values is.

## The registered ops

### `ao-registry` — Operations (Ops) · version 1 · drives **ao**

**Shows:** A governed command submitted live against the sim tenant, writing its own evidence
record.

**Modes:** `live`, `warm`, `staged` · **Typical warm cost:** ~4 s *(MEASURED 2026-09-06)*

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `command` | string | `A-18` | The AdminOps registry command id to submit. |

**Preconditions:**
- The AO GUI is armed on :3001 (automatic when a deck names this op).

```
op: ao-registry   op mode: live   params: command=A-18
```

---

### `ao-make-change` — Operations (Ops) · version 1 · drives **ao**

**Shows:** The REMEDIATING governed command submitted live against the sim tenant — the "fix it"
beat — writing its own evidence record.

**Modes:** `live`, `warm`, `staged` · **Typical warm cost:** ~4 s *(MEASURED 2026-09-06)*

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `command` | string | `A-18` | The AdminOps registry command id to submit. `A-18` mutates the tenant `authorizationPolicy` (the MFA object). |

**Preconditions:**
- The AO GUI is armed on :3001 (automatic when a deck names this op).

`ao-make-change` is `ao-registry`'s flow under a distinct id (defaulting to the remediation
command), so a deck can name the browse beat and the fix beat separately. Like `ao-registry`, it
does not branch on op mode.

```
op: ao-make-change   op mode: live   params: command=A-18
```

---

### `eo-review` — Assessment · version 1 · drives **eo**

**Shows:** The assessment result walked as an assessor does: the compliance matrix, one family's
NOT-MET determinations, then the SPRS score.

**Modes:** `live`, `warm`, `staged` · **Typical warm cost:** ~5 s *(MEASURED 2026-09-06 — not the "about five minutes" the talk track used to claim)*

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `family` | string | `IA` | Which control family the live walk filters to. IA is where the MFA control the AO and Config beats remediate lives. |
| `land` | enum `dashboard\|evidence\|sprs` | `sprs` | Where the walk **ends**. Every landing walks the matrix and the family determinations first. |

**Preconditions:**
- The EO server is armed on :4002 (automatic when a deck names this op).
- A `live` slide wants an earlier `warm` slide: the EO SPA cannot rehydrate an assessment from a
  page load. Without one the op self-heals by re-assessing — slower, still real, never a fake
  result.

```
op: eo-review   op mode: warm    (slide 7 — assess off stage)
op: eo-review   op mode: live    params: land=sprs      (slide 10 — the number they ask about)
```

---

### `eo-show-change-captured` — Assessment · version 1 · drives **eo**

**Shows:** A re-assessment after remediation, walked to the control that changed — the before/after
proof that the loop closes. Narrates only what actually changed.

**Modes:** `live`, `staged` · **Typical warm cost:** ~6 s *(MEASURED 2026-09-06)* · **no `warm`** — a
warm re-assess would capture "after" before the live remediator ran.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `control` | string | `IA.L2-3.5.3` | The control whose before/after determination the walk compares (the demo MFA control). |
| `family` | string | `IA` | The control family the walk filters to before landing on the control. |

**Preconditions:**
- The EO server is armed on :4002 (automatic when a deck names this op).
- A `before` assessment captured earlier (a warm `eo-review`) and a remediating act
  (`ao-make-change` or `stamper-execute`) BETWEEN before and after. Without a reliable before the act
  reports "no reliable before" rather than narrating a delta.

> ⚠ The named control's status and the SPRS delta are **independent**. A-18 (`ao-make-change`) can
> move the score without flipping `IA.L2-3.5.3` — that flip belongs to Stamper's enforcement in the
> full arc. The act reports both and never narrates a flip that did not happen.

```
op: eo-review               op mode: warm   (capture the before, off stage)
op: ao-make-change          op mode: live   params: command=A-18   (remediate)
op: eo-show-change-captured op mode: live   (re-assess, compare, narrate what changed)
```

---

### `muster-readiness` — Readiness Evaluation (RE) · version 1 · drives **muster**

**Shows:** A real presence-based readiness evaluation of the tenant: the CLI walk runs, then this
run's real result is **imported into the Muster SPA** and the boundary confirm panel streams
operating on stage (`mirror: theatrical`, `mirrorSource: pane`) — **never the fixture "Run
Discovery" button** (GP-DEMO-5 streamgui; decision 9 lifted the RE no-live restriction). It keeps
its RE identity (four-value tally, no-score line, read-only ledger proof) in the log and artifact.

**Modes:** `live`, `staged` *(`warm` was dropped — a warm SPA drive shows a stale panel; honesty
wants the import visibly happening)* · **Typical live cost:** ~80 s *(MEASURED 2026-09-06)*

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `detail` | enum `counts\|controls` | `counts` | How much the readout shows on the DEGRADED card: posture counts only, or the per-control list beneath them. |

**Preconditions:**
- The stacksim serve is armed (always), and the **ces-muster SPA preview on :4173** (automatic — this
  op imports its result into the SPA).
- **`../ces-muster/muster-api/dist/cli/bin.js` and `../ces-muster/dist/index.html` must exist — an
  operator prerequisite**, since ces-tester never builds a sibling. A clean `dist/`, or a SPA that is
  not armed, degrades this beat to the "evaluation unavailable" **readout card** rather than failing.
- On the success path the op navigates the pane to the SPA and imports this run's real
  readiness-result through the file-input seam, ending on `boundary-confirm-panel`.
- **No readiness score is produced.** DISCOVERY-1 yields a four-value per-control posture
  (`met` / `not_met` / `partial` / `unknown`) and nothing else. Do not write a talk track that
  claims a score here; EO's SPRS score is a different number from a different tool.

```
op: muster-readiness   op mode: live   params: detail=controls
```

---

### `muster-connect-tenant` — Readiness Evaluation (RE) · version 1 · drives **muster**

**Shows:** Muster pointed at a tenant with the assessment method DECLARED — session kind, auth tier,
operator — the honest opening beat. Fills the readiness manifest and stops on the manifest view.

**Modes:** `live`, `staged` · **no `warm`** (a seconds-long UI step; the loader rejects a `warm`
cell). · **Typical warm cost:** ~4 s *(MEASURED 2026-09-06)*

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `mode` | enum `self-hosted\|independent\|collaborative-bhd` | `independent` | The readiness session kind (`rm-mode`). |
| `authTier` | enum `lite\|script-upload\|device-code\|cert-app-only` | `cert-app-only` | The authorization tier achieved (`rm-auth-tier`). |
| `slug` | string | `demo-dib-small` | The tenant slug declared (`rm-tenant-slug`). |

**Preconditions:**
- The ces-muster SPA is armed on :4173 (automatic when a deck names a muster-gui op). **Operator
  prerequisite:** `../ces-muster/dist/index.html` must exist (`npm run build` in ces-muster) —
  ces-tester never builds a sibling.

> The act STOPS on the manifest view: Begin Interview is left unclicked so the manifest DOM stays
> readable. Later muster-gui acts advance the workflow.

```
op: muster-connect-tenant   op mode: live   params: mode=independent, authTier=cert-app-only
```

---

### `muster-auto-analysis` — Readiness Evaluation (RE) · version 1 · drives **muster**

**Shows:** The REAL read-only discovery walk (CLI) imported into Muster's UI — this tenant's real
result in this run, never the fixture button. Lands on the boundary confirm panel.

**Modes:** `live`, `staged` · **no `warm`** (loader-enforced) · **Typical warm cost:** ~85 s
*(MEASURED 2026-09-06 — the real CLI walk + import)*

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `slug` | string | `demo-dib-small` | The tenant slug the discovery CLI walks. |

**Preconditions:**
- The SPA is armed on :4173 and `muster-connect-tenant` ran earlier. **Operator prerequisite:** both
  `../ces-muster/muster-api/dist/cli/bin.js` AND `../ces-muster/dist/index.html` must exist.

> ⚠ **Honesty (A.5 #1):** composes the REAL `readiness-result/1.0.0` (CLI) → the SPA file-import
> seam. NEVER clicks the fixture "Run Discovery" button. A valid import lands on
> `boundary-confirm-panel`, never the fixture branch's `discovery-summary`.

```
op: muster-auto-analysis   op mode: live
```

---

### `muster-consent-and-attest` — Readiness Evaluation (RE) · version 1 · drives **muster**

**Shows:** A NAMED human attests the CUI boundary the machine inferred — a draft confirm is
name-gated, and nothing auto-drafted becomes an attested fact on its own.

**Modes:** `live`, `staged` · **no `warm`** (loader-enforced) · **Typical warm cost:** ~4 s
*(MEASURED 2026-09-06)*

**Parameters:** none — the confirmer is the demo operator; drafts come from the prior import.

**Preconditions:**
- The SPA is armed on :4173 and `muster-auto-analysis` ran earlier (the import left the boundary
  panel up). Operates on the current page — no navigation.

```
op: muster-consent-and-attest   op mode: live
```

---

### `muster-adaptive-interview` — Readiness Evaluation (RE) · version 1 · drives **muster**

**Shows:** The question count DROPS because discovery already answered them — the discovery branch
total vs a fresh manual branch, the exact comparison ces-muster's own e2e makes.

**Modes:** `live`, `staged` · **no `warm`** · **Typical warm cost:** ~6 s *(MEASURED 2026-09-06)*

**Parameters:** none — both branches use the same profile; the delta is measured.

**Preconditions:**
- The discovery import + boundary confirm ran earlier (the pane carries the imported facts). Opens a
  throwaway headless session for the manual-branch baseline (no extra port).

```
op: muster-adaptive-interview   op mode: live
```

---

### `muster-generate-sprs-mp` — Readiness Evaluation (RE) · version 1 · drives **muster**

**Shows:** The number the customer reports (SPRS), read from the EXPORTED readiness-result payload —
never scraped from the DOM. The on-screen conservative-score is a percentage string, not the SPRS
integer.

**Modes:** `live`, `staged` · **no `warm`** · **Typical warm cost:** ~6 s *(MEASURED 2026-09-06)*

**Parameters:** none — exports the readiness result (plan-mode out of this pass).

**Preconditions:**
- The SPA is armed on :4173 and the interview is in progress (the adaptive-interview beat ran).
  Finishes the interview → the result view → exports through the download seam.

```
op: muster-generate-sprs-mp   op mode: live
```

---

### `muster-rollup` — Readiness Evaluation (RE) · version 1 · drives **muster**

**Shows:** The prime contractor's subcontractor rollup surface, operating live: each sub's
StatusPayload is imported into Muster's Red/Amber/Green board, one row per sub. The fleet is a
labeled **sample** set (every party name carries `(sample)`) — a Readiness Evaluation reads one
tenant, so the board's inputs are illustrative and are never narrated as this run's tenants. The
live thing is the real surface: the component, its schema validation, its RAG math, its CSV export.

**Modes:** `live`, `staged` · **no `warm`** · **Typical warm cost:** ~12 s

**Parameters:** none — the sample fleet is fixed (the honest ceiling is a demonstration of the
surface, not a live multi-sub run), so there is nothing a deck could turn without implying the
fleet is real.

**Preconditions:**
- The ces-muster SPA is armed on :4173 (automatic when a deck names a muster op). Operator
  prerequisite: `../ces-muster/dist/index.html` must exist (`npm run build` in ces-muster).
  Absent or unarmed, the beat degrades to the honest sample-board readout card.
- The fleet is illustrative — sample subcontractor status files that demonstrate the real rollup
  surface, NEVER a claim that the subs were evaluated in this run.
- A schema-rejected sample fails the beat loudly (the driver reads the SPA's `form-error`).

```
op: muster-rollup   op mode: live
```

---

### `simstack-create` — stacksim · version 1 · drives **stacksim**

**Shows:** The deliberately half-configured demo tenant, presented as a readout: the sim answers,
the registry record is usable, and the report-only MFA gap is present. Presents what prep built —
never a live re-seed.

**Modes:** `live`, `warm`, `staged` · **Typical warm cost:** ~1 s *(MEASURED 2026-09-06)*

**Parameters:** none — this act reads only `ctx.armed`.

**Preconditions:**
- The stacksim serve is armed on :4390 (always, for any driven deck).
- The sim record was authored by arming; this act reads it, never writes it.

> ⚠ The gap is **report-only, never absent.** `caPolicy-1` is
> `state: 'enabledForReportingButNotEnforced'` — the MFA policy exists and was never enforced. That
> is why presence-based reads (Muster, EO) score `IA.L2-3.5.3` as met; the gap is depth, not absence.

```
op: simstack-create   op mode: live   (present the armed tenant + the gap)
```

---

### `simstack-destroy` — stacksim · version 1 · drives **stacksim**

**Shows:** The ephemeral demo tenant torn down cleanly — the "leave no trace" beat. Removes the
registry record and keeps every artifact in the run directory.

**Modes:** `staged`, `live` · **no `warm`** — destroying during prep would remove the tenant the
deck is about to use; the loader rejects a `warm` cell for this op with a catalog error. · **Typical
warm cost:** ~1 s *(MEASURED 2026-09-06)*

**Parameters:** none — `keepEvidence` is hardcoded true; the slug comes from `ctx.armed`.

**Preconditions:**
- The stacksim serve is armed on :4390 (always, for any driven deck).
- Wraps `teardownEphemeralSimTenant` (registry record only) — **never** `demo:reset`, whose
  `clear-runs` would delete the run evidence. Put this act **last** in any multi-op group.

```
op: simstack-destroy   op mode: live   (remove the record, keep the proof)
```

---

### `stamper-translate` — Configuration (Config) · version 1 · drives **stamper**

**Shows:** The real Configuration GUI compiling the mission plan into executable remediation tasks,
**streamed live from the backstage session into the slide** (`mirror: theatrical`,
`mirrorSource: backstage`). **Decision 11 (2026-09-07) lifted decision 8's no-live-Config rule** —
the GUI is shown live, but from the headless backstage session, never by driving the visible pane.

**Modes:** `warm`, `live`, `staged` · **Typical warm cost:** ~5 min *(MEASURED 2026-09-06: 308.6 s)*

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `missionPlan` | string | `assets/demo-plan/demo-dib-small/mission-plan.json` | Path to the mission plan, relative to the tester root. Resolved absolute before it reaches the GUI. |
| `manifest` | string | `assets/demo-plan/demo-dib-small/manifest.json` | Path to the **tenant** manifest (never the infrastructure one), relative to the tester root. |

**Preconditions:**
- The Stamper GUI is armed on :3000 (automatic when a deck names either stamper op).
- Runs **backstage** — a headless, never-displayed session. The GUI streams from there on
  `/mirror/backstage`; the op touches the visible pane only to render a readout card, and only on a
  `live` slide (invisible under the mirror, the sole Config surface under `--pane-window`).
- A `live` slide holds for the whole flow (≈5 min) while the GUI streams operating in-sync; `warm`
  runs it at prep instead. The all-live streamgui proof deck uses `live`.

```
op: stamper-translate   op mode: warm
```

---

### `stamper-execute` — Configuration (Config) · version 1 · drives **stamper**

**Shows:** The real Configuration GUI applying and verifying the remediation plan against the tenant,
**streamed live from the backstage session** (`mirror: theatrical`, `mirrorSource: backstage`),
judged by the **execution report on disk** — never by the GUI badge, which has been measured reading
`Complete` on a run the report called `partial`. **Decision 11 (2026-09-07) lifted no-live-Config.**

**Modes:** `warm`, `live`, `staged` · **Typical warm cost:** ~13 min *(MEASURED 2026-09-06: 774.3 s on the fast path)*

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `skipKnownFalseFails` | boolean | `true` | Report and skip the pinned sim-only verification failures. Set `false` to fail the op on every failure, expected or not. |
| `peekMs` | number | *(unset)* | **Demo peek.** On a `live` slide, set (e.g. `5000`) to CLICK Execute, confirm the GUI is running, stream it for this many ms, then HALT the run and cut away without awaiting the ≈13-min terminal — NO report is judged that run. Halting stops the backstage churn that would otherwise crash later live acts (the muster discovery CLI). Omit to hold the slide for the full flow and judge the report on disk. |

**Preconditions:**
- The Stamper GUI is armed on :3000. Runs **backstage**; the GUI streams from there on
  `/mirror/backstage`.
- `peekMs` makes it a watchable start-and-cut-away beat (≈`peekMs` on stage) instead of the full
  ≈13-min hold; the run is HALTED after the peek (so it cannot churn on backstage and crash later
  live acts such as the muster discovery CLI) and no report is judged that run.
- A warm `stamper-translate` on an **earlier** slide leaves the backstage page connected with an
  executable plan — that is the ≈5-minute fast path. Without it the op self-heals by running the
  full flow (≈18 min); `--check` warns when a deck is ordered that way.
- Fails only on **unexpected** failures. Expected sim false-FAILs are reported and skipped.
- **Warm** now runs to COMPLETION during prep and is AWAITED before slide 1 (GP-DEMO-6, 2026-09-08 —
  `show-run` awaits warm ops so a long Config op can no longer starve the live acts behind it on the
  single queue). So a warm execute's slide streams the COMPLETED backstage report, never a mid-run
  frame; a subscriber connecting to the finished-idle backstage gets a subscribe-time capture of the
  real current frame, never a blank. **This amends the GP-DEMO-5 streamgui A3 design** ("stream the
  REAL current state, mid-run or completed") — mid-run streaming of a warm execute is no longer
  possible, and `streamgui-execute-warm`'s prep now blocks ≈13 min. Needs a decision-log entry.
  **Live** streams the operation in-sync at the cost of a ~13-min hold-card unless `peekMs` is set
  (start → confirm running → stream → HALT → cut away). §8 record-replay is out of scope.

```
op: stamper-execute   op mode: warm   params: skipKnownFalseFails=true
```

## Warm-op ordering is a real semantic

Warm ops fire during prep, **in deck order**, through a single serialization queue. That is what
makes the arc work: a deck ordering `eo-review` (warm) → `stamper-execute` (warm) gets
before-state numbers, then remediation — and the after-truth Assessment beat still works, because
`eo-review`'s `live` phase self-heals by re-assessing when the visible pane has moved on.

It is also wall time the presenter commits to before slide 1 ever appears. `--check` sums the
`typicalWarmMs` of a deck's warm ops and **warns above 300 s (5 min)**, naming the total and the
contributing ops.

## Demo acts (aliases)

`ACT_ALIASES` in `op-catalog.ts` carries named presets — an act name that stands for an op plus
declared parameters:

| Act alias | Resolves to |
|---|---|
| `eo-verify-evidence` | `eo-review` `land=evidence` — ends on the Evidence Explorer |
| `eo-browse-determinations` | `eo-review` `land=sprs` — matrix → family NOT-MET → SPRS score |

`land` names where the walk *ends*; every landing walks the matrix and the family determinations
first, which is the beat the alias name describes.

**Alias resolution is not built yet** — `ACT_ALIASES` ships as pure data. The `op` column still
takes a registered op id today; writing `eo-verify-evidence` there is an error. Resolution is
GP-DEMO-5 T3. The names live here now so the vocabulary has a home before the machinery does, and
so this table is the one place they are proposed.

## Adding an op

1. Implement it in `src/demo/show/ops/`, register it in `deck-model.ts`'s `DemoOpId` **and** in
   `op-registry.ts`'s `OP_IMPLEMENTATIONS` — that record is total, so an id cannot exist
   unimplemented.
2. Add its entry to `OP_CATALOG`, with a measured `typicalWarmMs`.
3. Add its section here. **The drift test will fail until you do** — every registered id, every
   parameter key and every act alias must appear in this file.
