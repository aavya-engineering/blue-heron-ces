# PLAN — Prime→Subs Readiness-Evaluation demo (run of show)

**Date:** 2026-09-18. **Branch:** gp-demo-4. **Status:** DECIDED + BUILT. Founder chose **Option B
(sample fleet)** on 2026-09-18 (§6 resolved below); the live `muster-rollup` act and the
`ces-prime-subs` deck are built and green — `tsc --noEmit` clean, `vitest` 888 pass, captions-lint
0 `[tell]`, `demo:show --check demos/ces-prime-subs.xlsx` PASS. **Not yet committed** (awaiting
founder). **Live rehearsal against the real ces-muster SPA is the remaining confidence step** — the
driver is verified vs sibling source + unit-tested, but not yet run headed end to end. One known
narrative seam is open for a founder call (the slide-5 caption vs slide-7 SPRS beat — see §11).

## The ask

A demo that shows a **prime contractor** how **Muster / Readiness Evaluation (RE)** gives it
an objective, evidence-backed readiness picture of its **subcontractors** — without touching
their systems and without waiting on a self-attestation. Deliverable: the **run of show** in
terms of **code-content** (deck rows / slide narrative) and **demo-acts** (which registered
SlideOps run on each slide).

## Legend

- **RE** — Readiness Evaluation (Muster's on-stage product name).
- **RAG** — Red / Amber / Green status rollup.
- **POV** — point of view: whose seat the slide speaks from (prime vs sub).
- **demo-act / SlideOp** — a scripted app operation a slide runs; `op mode` = `live` (holds
  the slide until it finishes) / `warm` (run during prep, result parked on the pane) / `staged`
  (honest placeholder card naming the op that would have run — never a faked result).
- **StatusPayload** — the per-sub status file the real Muster rollup surface imports.
- **FCA** — False Claims Act (the liability behind narrating false cyber-attestations).
- **CUI** — Controlled Unclassified Information.

---

## 1. The pain (why a prime cares)

Under CMMC/DFARS the prime is on the hook for its whole team. A sub that handles CUI and
isn't ready is the prime's problem: the award is at risk, and a false "we're compliant" that
the prime passed along is FCA exposure. Yet today the prime's only visibility into a sub is:

- **Self-attestation** — the sub *says* it's ready. Unverifiable, stale, gameable, and now a
  liability if wrong.
- **A paper SPRS score** — self-scored, annual, disconnected from the sub's actual environment.
- **Email + spreadsheet chasing** — costs schedule on every award, and still proves nothing.

The prime inherits the weakest sub it can't see inside. That's the fear the demo removes.

## 2. The approach the demo proves

The prime hands over its subs. **Each sub runs a Readiness Evaluation in its own tenant** —
read-only, zero writes. Status reports back on the prime's cadence, and Muster **rolls it up**
to the prime as RAG-per-sub. The sub sees instructions and status, not the prime's aggregate;
the prime sees where every sub stands without asking. (This is the authored narrative already
drafted in `outputs/stock-slide-polish/draft-images/prime-subs-flow.html`.)

## 3. What is real vs. what is staged (honesty guards — BINDING)

Carried from the pain-story-v2 rehearsal review (2026-09-09) and the RE act catalog:

- Muster's walk produces **observations** (met / not-met / partial / unknown) mapped to
  controls — **NOT a finished readiness score.** A measured run = **329 observations: 57 met,
  0 not-met, 0 partial, 272 unknown**. "Unknown" = still needs evidence or human input. Narrate
  it as "a readiness picture: what's known, what's unresolved," never "329 controls passed."
- **Zero tenant writes** is a real, verifiable proof (sim ledger mutation count == 0) — promote
  it to a proof card on the walk slide.
- Live RE acts compose the **real CLI walk → real readiness-result → SPA import**. They NEVER
  click the fixture "Run Discovery" button; marketing figures on the offer screen are never
  narrated as tenant results; no invented score; a presence-based walk is never narrated as an
  MFA-enforcement finding.
- The tenant is a **simulated** DIB tenant (tenant-stacksim). Disclose that once, early, plainly.
- **POV honesty:** the pane must show whose view it claims. Slides 4–7 are the **sub's** tenant;
  slides 1–3, 8–9 are the **prime's** seat. Say the switch out loud at 3→4 and 7→8.

## 4. Hard constraint that shapes the design — one live sub per run

Verified in code (`op-registry.ts:157-176` `armingFor`; muster `slug` params default to the
single armed sim slug, `op-catalog.ts:210-308`): the engine arms **one** stacksim serve per
run. Every muster act reads that one armed tenant. **Consequence:** a single run can evaluate
**one sub live**. Showing a second sub with genuinely *different* live data would need a second
seeded/served tenant — new arming/seeding work, out of scope for the buildable-now deck. So the
**fleet** (multiple subs) is shown via the prime **rollup image**, and the **one sub** is
evaluated live as the hero. This is honest: one sub proven live end-to-end, the aggregate shown
as the surface's output shape.

---

## 5. Run of show — 9 slides

Every slide names its `right-third` (pane intent) so no slide inherits a stale pane — the exact
failure the rehearsal review caught (slides 2/3/6 showing leftover app views). Muster subsequence
order follows `mini-muster-gui.xlsx` / `acts-showcase.xlsx` (already in precondition order).

| # | Beat (feature = slide title) | `op` / `op mode` | `tools` | `right-third` | POV |
|---|------------------------------|------------------|---------|---------------|-----|
| 1 | **Your award rides on subs you can't see inside** | — / staged | muster | `image` — ces-core-story-hub-spoke.png | prime |
| 2 | **Self-attestation is a promise, not proof** (FCA exposure) | — / staged | muster | `image` — ces-core-story-decay.png | prime |
| 3 | **Hand us your subs — each proves itself, you get the rollup** | — / staged | muster | `image` — ces-core-story-prime-subs-flow.png | prime |
| 4 | **Inside one sub: connect, method declared** | `muster-connect-tenant` / live | muster | `app` | sub |
| 5 | **The walk — read-only, zero writes, observations arrive** | `muster-readiness` / live | muster | `app` | sub |
| 6 | **A named human attests the boundary** | `muster-consent-and-attest` / live | muster | `app` | sub |
| 7 | **The number that flows — SPRS from the exported payload** | `muster-generate-sprs-mp` / live | muster | `app` | sub |
| 8 | **The prime's seat: every sub, one board (RAG)** | staged (A) / `muster-rollup` new act (B) | muster | `image` — ces-core-story-prime-rollup.png | prime |
| 9 | **Your flow-down didn't pause** (close) | — / staged | muster | `image` — ces-core-story-promises-kept.png | prime |

### Slide-by-slide code-content (talk track + fields)

Each row carries the standard columns: `feature` (title), `function`, `benefit`,
`differentiator`, `talk track`, `tools`, `op`, `op mode`, `params`, `image`/`right-third`,
`duration (sec)`. Highlights:

**S1 — stake.** *Talk:* "You're the prime. Your certification — and your award — depend on subs
you have no window into. Let's fix the window." *Differentiator:* objective visibility vs a
binder of promises.

**S2 — decay.** *Talk:* "A self-attestation is a promise. It ages the moment it's signed, and
if it's wrong, you passed the risk — and the liability — down your own chain." Name FCA once,
soberly. *Benefit:* remove the risk you can't currently see.

**S3 — the approach (POV: prime).** *Talk:* "Here's the model. You hand us your subs. Each one
runs a Readiness Evaluation **in its own tenant**, read-only. Status comes back on your cadence.
We roll it up to you. The sub sees its instructions and its own status — not your board." Then:
"Let's go inside one sub and watch it prove itself." (Announce the POV switch.)

**S4 — connect (POV: sub).** `muster-connect-tenant` live. *Talk:* "This is one sub's tenant.
We point Readiness Evaluation at it and **declare the method** up front — session kind, auth
tier, who's operating. Honesty starts at the manifest." *params:* `mode=independent`,
`authTier=cert-app-only`, `slug=demo-dib-small`.

**S5 — the walk (POV: sub, HERO).** `muster-readiness` live. *Talk:* "Now the real walk. It
**reads** the environment — it changes nothing. Watch the observations arrive." Land on the
result and a **`0 tenant writes`** proof card. Say: "This returned 57 met and 272 unknown.
Unknown means evidence or a human decision is still owed. This is a readiness *picture* — where
this sub stands and what's unresolved — not a finished score." *params:* `detail=counts`.
*(Do NOT stack `muster-auto-analysis` — it runs the same ~80s walk; one hero walk only.)*

**S6 — attest (POV: sub).** `muster-consent-and-attest` live. *Talk:* "A machine can infer the
CUI boundary. Only a **named person** can attest it — and nothing becomes an attested fact until
they do. That's the accountability a prime can actually rely on." Show the name-gated confirm.

**S7 — the number that flows (POV: sub → prime).** `muster-generate-sprs-mp` live. *Talk:*
"The SPRS number the sub reports comes straight from the **exported readiness payload** — not
retyped, not scraped off a screen. This is the number that will flow up to you." End: "Now step
back to your seat." (Announce POV switch to prime.)

**S8 — the rollup (POV: prime, PAYOFF).** *Talk:* "This is your board. Every sub, one view,
Red / Amber / Green — sourced from each sub's own evaluation, on your cadence. You see where each
one stands **without asking**." **Option A wording:** "This is the rollup surface's output shape."
Never "watch it run." **Option B** (if the new act is approved): a live `muster-rollup` act
imports the StatusPayloads from the run and streams the real RAG board.

**S9 — close (POV: prime).** *Talk:* "Your flow-down never paused. What changed is that you can
now see where every sub stands — from evidence, without touching their systems, without a promise
you have to take on faith. Start with your readiness picture." Recap only what was shown.

---

## 6. The one open decision — the rollup climax (Option A vs B) — ✅ RESOLVED

> **RESOLVED 2026-09-18:** founder chose **Option B (sample fleet)** on the corrected premise (§10).
> The live `muster-rollup` act is built (mirror theatrical, real `StaticRollup` surface, labeled
> 5-sub sample fleet). Option A remains the automatic degraded fallback (the honest sample-board
> card renders whenever the SPA is not armed). The original open framing is kept below for the record.

The prime's payoff (slide 8) is the multi-sub RAG board. The product surface is **real**
(ces-muster `src/features/rollup/StaticRollup.tsx`, documented in
`docs/MUSTER-TENANT-READINESS.md §11` — imports subs' StatusPayload files, shows RAG per party),
but there is **no registered `muster-rollup` demo-act in ces-tester today.**

- **Option A — staged image (buildable now, zero new acts).** Slide 8 = `ces-core-story-prime-rollup.png`,
  narrated as the surface's output shape. Live proof lives at the per-sub level (S4–S7). Honest,
  ships immediately. **Recommended default.**
- **Option B — new live `muster-rollup` act (new code).** Register the op id + catalog entry +
  op impl driving `StaticRollup.tsx`, feeding it the StatusPayload(s) from this run so the RAG
  board renders live on stage. Higher fidelity — the prime literally watches their board build —
  but it's real new work and, per house doctrine, a new act needs founder approval.

**This is the Stage-3 approval question**, not something to resolve unilaterally. The deck can be
authored A-now and upgraded to B later by flipping slide 8's `op`/`op mode` once the act exists.

## 7. How this gets built (when approved) — no sibling writes

Follows the `acts-showcase` precedent (`scripts/make-demo-xlsx.mjs`, `PLAN-ACTS-SHOWCASE.md`):

1. Add a `CES_PRIME_SUBS_ROWS` / `buildPrimeSubsDeck()` to `scripts/make-demo-xlsx.mjs`
   (columns per `xlsx-loader.ts:29-176`: `slide #`, `feature`, `function`, `benefit`,
   `differentiator`, `talk track`, `tools`, `op`, `op mode`, `params`, `image` / `right-third`,
   `duration (sec)`). One op per slide (rows sharing a slide # merge, op resolved unique-or-agree).
2. `node scripts/make-demo-xlsx.mjs --deck ces-prime-subs demos/ces-prime-subs.xlsx`.
3. `node bin/ces-tester.mjs demo:show --check demos/ces-prime-subs.xlsx` (expect PASS; a
   `prep budget` WARN for the ~80s live walk is honest, not a failure).
4. Prime images are already in `demos/images/` — no image generation, **no ces-strategy edits.**

## 8. Preflight for a live run (operator prerequisites)

- **ces-muster built + preview on :4173:** `../ces-muster/dist/index.html` and
  `../ces-muster/muster-api/dist/cli/bin.js` MUST exist (`npm run build` in ces-muster). A clean
  dist or an unarmed SPA degrades `muster-readiness` to an "evaluation unavailable" card
  (`op-catalog.ts:236`).
- stacksim serve armed (automatic for any driven deck), seeded `demo-dib-small`.
- All 6 CES ports free before launch; full teardown after (`taskkill //T //F` on the demo:show
  parent PID; verify 4500/4390/4173/3000/3001/4002 free; sweep orphan node + playwright chrome).

## 9. Optional add-ins (only if the founder wants them)

- **`muster-adaptive-interview`** as an extra sub slide — objection-handler: "the sub's manual
  question burden drops because discovery already answered them." Adds a slide + a bit of wall time.
- A **Configuration/Operations** remediation beat for a sub with gaps (`stamper-translate` /
  `ao-make-change`) to show "found a gap → fixed it → re-evaluated" — but that widens the story
  past the pure prime-visibility spine and adds significant wall time (Config ≈5–13 min).

---

**Net:** 9-slide run of show, one sub evaluated **live** end-to-end via four real muster acts
(`connect-tenant` → `readiness` → `consent-and-attest` → `generate-sprs-mp`), framed and paid off
by the prime rollup. Buildable now as **Option A** with zero new acts and zero sibling writes;
**Option B** (live rollup act) is the one approval-gated upgrade.

---

## 10. Option B build plan — CORRECTED PREMISE (re-gate before coding)

**Founder picked Option B (2026-09-18): build a live `muster-rollup` act.** The pick — and the
option text — assumed the act would drive `StaticRollup.tsx` **"with this run's StatusPayloads."**
A read-only investigation of ces-muster proved that premise **false**, so what is actually
buildable differs from what was approved. Stating it plainly before any code:

### What the investigation found (why the premise fails)
- `StaticRollup.tsx` imports **StatusPayload** JSON files (multi-file `<input type=file>`,
  AJV-validated vs `public/schemas/status-payload.schema.json`). One file = one sub = one RAG row.
- **StatusPayload ≠ readiness-result, and there is NO converter and NO CLI** that emits a
  StatusPayload. It is produced only inside the SPA ("Export StatusPayload" on the ResultScreen).
- The board's RAG is driven by `posture_summary.conservative_score` (≥70 green / ≥40 amber / else
  red). **DISCOVERY-1 (the readiness walk on slides 4–7) produces NO score** (`NO_SCORE_LINE`).
- ∴ This run's real per-sub walk **cannot become an honest RAG row** — there is no honest number
  to place it on a score-driven board, and there is no fleet (one armed tenant = one sub).

### What IS buildable (honest ceiling)
The **real live rollup surface** — the actual `StaticRollup` React component, its real AJV
validation, real RAG logic, real "N / 5 subs" aggregation, real CSV export — driven on stage with
a **clearly-labeled sample fleet** of 5 StatusPayloads that ces-tester generates. This is a real
upgrade over Option A's static PNG (the board renders/validates/aggregates/exports live), and it
is honest **only if** the sample nature is unmissable. It is NOT "the subs you just evaluated,
rolled up."

### Honesty guards for the sample fleet (BINDING if we build it)
- **"sample" on the board itself**, not just in the caption/HUD — party names like
  `Machining Sub (sample)` (the name survives screenshots AND the exported CSV; captions don't).
- The driver **reads `ul.form-error` after import and fails loud** on any entry — a schema-rejected
  sample silently yielding a short board is the exact partial-proof failure the doctrine forbids.
- **Caption the intake beat:** the driver visibly fills a Profile + begins an interview to surface
  the rollup nav — name it on stage ("opening a prime engagement to reach the rollup board").
- Narrate the bridge conceptually, never as provenance: "each sub runs the same read-only
  evaluation you just watched; here's how their status rolls up" — the numbers are illustrative.

### Buildable path (5 files + doc + tests, all in-root, zero sibling writes)
1. `deck-model.ts` — add `'muster-rollup'` to `DemoOpId` union + `DEMO_OP_IDS`.
2. `op-catalog.ts` — `OP_CATALOG['muster-rollup']` (target muster, RE, mirror theatrical / pane,
   modes `['live','staged']`, no params v1) + `docs/demo/OP-CATALOG.md` entry.
3. `op-registry.ts` — add to `OP_IMPLEMENTATIONS`; add id to `armingFor` `withMuster` OR-list.
4. `ops/muster-rollup-op.ts` — new impl (mirrors `muster-readiness-op.ts`): success = drive real
   SPA rollup; degraded (SPA unarmed / form-error) = honest readout card. Generates 5 sample
   StatusPayloads into `ctx.armed.runDir`, registers via `ctx.artifact?.()`.
5. `muster-ui-driver.ts` — `driveMusterRollup(page, payloadPaths)` + rollup selectors. Sequence
   (verified vs sibling source): `goto` → nav-situation → tab-profile → check
   `input[name=engagement_kind][value=prime_and_subs]` → fill org name → check on_prem_ot=no →
   click `begin-interview` (REQUIRED — `engagementKind` is set at engagement creation, App.tsx:203;
   the radio alone won't surface `rollup-nav`) → click `[data-testid=rollup-nav]` → wait
   `[data-testid=roster-section]` → per-file `setInputFiles` loop (each fires change, appends a row)
   → wait rows === 5 → assert `form-error` empty → read badges.
6. `captions.ts` — `CAPTIONS['muster-rollup']` (`{success:[…], degraded:[…]}`).
7. Satisfy completeness tests (READ FIRST, they are the spec): `demo-show-op-catalog`,
   `demo-show-op-registry`, `demo-show-captions`, `demo-acts-docs-check`, `demo-acts-roster` +
   pacing — including regenerating `acts-showcase.xlsx` if the roster test requires all ids covered.
   New driver ordering test via `tests/helpers/fake-ui-page.ts`. NOTE: **no Ajv in ces-tester**
   (Playwright is the only dep) — the sample-payload builder's unit test hand-asserts required
   fields/enums; the live surface's own Ajv + the form-error check is the real validator.

### Slices (gate every one: `tsc --noEmit` + targeted `npm test`; no push)
- **S1:** id + catalog + captions + OP-CATALOG.md + `armingFor` + minimal degraded-only impl
  (`OP_IMPLEMENTATIONS` is a typed `Record<DemoOpId,…>`, so the id can't register without an impl).
- **S2:** sample-StatusPayload builder (pure, unit-tested).
- **S3:** `driveMusterRollup` + fake-ui-page ordering test + full live success path.
- **S4:** acts-showcase regen if required + `buildPrimeSubsDeck()` rows (slide 8 → `muster-rollup`
  live) + `demo:show --check demos/ces-prime-subs.xlsx`.

## 11. Open narrative seam — slide 5 caption vs slide 7 SPRS beat (founder call)

The shared caption corpus paints `muster-readiness`'s line on slide 5's pane: *"It does not hand
us a score … That number comes later, from the Assessment."* But this deck has **no Assessment
(EO) beat**, and **slide 7** (`muster-generate-sprs-mp`) delivers the SPRS number from the **Muster
export**. So the pane caption on slide 5 promises the number comes from Assessment, and slide 7
produces it from Readiness — the exact caption-vs-workbook contradiction the 2026-09-09 rehearsal
review (line 41) ordered reconciled. No gate catches this (captions are static, shared, and
globally unique; nothing checks cross-slide narrative consistency).

It does **not** block "the act is built"; it **does** block a clean customer showing. Options, for
the founder:
- **(a) Edit the shared caption** `CAPTIONS['muster-readiness'].success[3]` to not name Assessment.
  Global — it also renders in the pain decks (where an Assessment beat *does* follow), and any edit
  must stay caption-unique and pass voice-lint.
- **(b) Adjust this deck's slide 5 / slide 7 talk** so the spoken narration owns the "the number
  comes from your readiness export" framing and does not lean on an Assessment beat this deck omits.
- **(c) Add an Assessment beat** (`eo-review`) before the rollup — widens the deck past the pure
  prime-visibility spine and adds wall time; only if the founder wants the full loop.

Recommendation: **(b)** — deck-local, no blast radius on other decks, and this deck's spoken slide-5
track already says "a readiness picture … not a finished number," so it is a small tightening.

### Documented v2 upgrade (NOT built now) — one real hero row
Slide 7 ends on the ResultScreen, which has an **"Export StatusPayload"** button producing THIS
session's real StatusPayload (with a real conservative score). To make the hero a real row: (a)
slides 4–7 must create the engagement as `prime_and_subs` (a behavioral change to the existing
muster acts — they never touch that radio today), and (b) export the payload before this act's
fresh `goto` wipes the session. Real coupling risk; deferred to v2, feeds gate option (ii).
