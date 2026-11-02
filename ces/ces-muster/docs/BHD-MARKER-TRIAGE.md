# BHD marker triage (MG-24)

**2026-10-27. Triage only.** Every `[validate with BHD]` marker in `src/` and `muster-api/src/`, one row each, with the question it asks, the output it affects, and a proposed owner. No marker is resolved or removed here, and no answer is proposed. BHD's answers are due before wave 3 (decision D8); they are applied under MG-24 when they land.

**Sweep:** `grep -rn "validate with BHD" src muster-api/src` finds **43 lines**:
- 10 in `src/` code (including one test name)
- 29 in `muster-api/src/` code
- 4 in a build log under `src/` (`src/features/assessment/IMPLEMENTATION_S4.md`)

The backlog's "about 29" matches the `muster-api/src/` count. None are in `src/vendored/`.

**Legend:**
- **Owner:**
  - *BHD content* means BHD supplies data or a list.
  - *BHD decision* means BHD confirms or changes a business rule.
  - *Contractor* means engineering can settle it from code or published vendor or regulatory sources.
  - *Obsolete* means the line is not an open question in its own right (a duplicate echo or a closed item); remove it once its source row is answered.
- **Checklist row:** the row number in `docs/BHD_VALIDATION_CHECKLIST.md`, which already groups these assumptions by risk tier.
- **HIL** = human-in-the-loop advisor queue. **SPRS** = the Supplier Performance Risk System score. **Mode-a / mode-c** = the touch-event modes `touchService` records.

## Code markers

| # | File:line | Question | Output it affects | Proposed owner | Checklist row |
|---|---|---|---|---|---|
| 1 | `src/features/assessment/adaptiveEngine.ts:229` | When retro-confidence fails or is degraded, should every queued fact default to confidence `low`, weight 3 (so every one routes to HIL)? | Fact confidence and weight; HIL queue volume before score release | BHD decision | 5 |
| 2 | `src/features/contracts/ContractsPage.tsx:17` | For individual-contractor engagements, is `prime_ref` null, and how is `party_id` resolved? | Contract records | BHD decision | 17 |
| 3 | `src/features/contracts/ContractsPage.tsx:182` | Same as row 2, for the on-screen notice "Contracts attach directly to this contractor party". | Contracts page text | BHD decision | 17 |
| 4 | `src/features/contracts/contractValidation.ts:13` | Which contract fields are required and which are optional? | Contract form validation | BHD content | 17 |
| 5 | `src/features/scoring/factRouter.ts:23` | Should machine-harvested current state (class A) outrank captured point-in-time evidence (class C), so an A "yes" beats a C "no"? | Requirement status, and so SPRS and the readiness result | BHD decision | 3 |
| 6 | `src/features/scoring/__tests__/factRouter.test.ts:136` | A test name that repeats row 5. | None (test label) | Obsolete | 3 |
| 7 | `src/features/scoring/preambleMapper.ts:16` | The scoring cascade's SI Baseline assumes CUI present, L2 target and hybrid deployment. Should it keep these Phase-0 assumptions, or use the session's derived SI values (`siDerivation` now derives target level, CUI presence and deployment posture)? | Scoring cascade posture (`scoringService`) | Contractor | 19 |
| 8 | `src/features/scoring/ResultScreen.tsx:136` | Is "at most 2 hours BHD touch per sub" the target? | Result screen text | BHD decision | 11 |
| 9 | `src/features/timer/TimerBar.tsx:122` | Same as row 8. | Timer bar text | BHD decision | 11 |
| 10 | `src/shared/types/engagement.ts:168` | Is the 14-field Contract entity the right field list? | Contract data model and API | BHD content | 17 |
| 11 | `muster-api/src/lib/graphClient.ts:11` | Is `https://graph.microsoft.us/v1.0` the right GCC High Graph base URL? | Every live Graph call | Contractor | 14 |
| 12 | `muster-api/src/routes/contracts.ts:130` | Should only `bhd_operator` be allowed to delete a contract? | Contract delete authorisation | BHD decision | 12 |
| 13 | `muster-api/src/routes/hil.ts:38` | Should the HIL queue be visible to `bhd_operator`, `prime` and `assessor_read_only`? | HIL queue access | BHD decision | 12 |
| 14 | `muster-api/src/routes/nudges.ts:32` | Is scoping party visibility to the calling operator's tenant correct for the nudge tick? (The marker asserts "correct"; it still needs a BHD confirm.) | Which parties a nudge tick reaches | BHD decision | 21 |
| 15 | `muster-api/src/routes/reassessment.ts:50` | Is an annual reassessment cadence (`REASSESS_DAYS` = 365) right? | When parties flip to `reassessment_due` | BHD decision | 9 |
| 16 | `muster-api/src/routes/reassessment.ts:51` | Same tenant-scope question as row 14, for the reassessment tick. | Which parties a reassessment tick reaches | BHD decision | 21 |
| 17 | `muster-api/src/services/adaptiveInterviewService.ts:16` | Should every unknown or unsure answer be treated as not passed downstream? | Adaptive sequencing; downstream scoring | BHD decision | 5 |
| 18 | `muster-api/src/services/adaptiveInterviewService.ts:165` | On a degraded retro-confidence run, should every fact get confidence `low`, weight 3 (all routed to HIL)? | Fact confidence and weight; HIL volume | BHD decision | 5 |
| 19 | `muster-api/src/services/contractsService.ts:44` | Are CMMC levels limited to 1–3, and is DoD Instruction 8171.01 the right citation? | Contract level validation | Contractor | 7 |
| 20 | `muster-api/src/services/driftService.ts:15` | Should drift fire only on machine evidence (`auto_detected`, `captured`), never on interview-answer changes? | Drift alerts | BHD decision | 4 |
| 21 | `muster-api/src/services/driftService.ts:24` | Should drift alerts route to HIL as confidence `low`, weight 3? | Drift alert routing | BHD decision | 6 |
| 22 | `muster-api/src/services/driftService.ts:156` | Same as row 21, at the call site. | Drift alert routing | BHD decision | 6 |
| 23 | `muster-api/src/services/hilService.ts:47` | Is weight 3 or more the right "high-impact" threshold for HIL routing? | Which facts route to HIL | BHD decision | 6 |
| 24 | `muster-api/src/services/lifecycleService.ts:35` | Should `stalled` → `in_progress` (recovery) be a legal transition? | Party lifecycle | BHD decision | 10 |
| 25 | `muster-api/src/services/lifecycleService.ts:36` | Should `reassessment_due` → `in_progress` (restart) be a legal transition? | Party lifecycle | BHD decision | 10 |
| 26 | `muster-api/src/services/nudgeService.ts:12` | Are the T+3/7/14 nudge thresholds and the stall threshold right? | Nudge events | BHD decision | 8 |
| 27 | `muster-api/src/services/nudgeService.ts:25` | Is "stalled" strictly more than 14 idle days? | Stall detection | BHD decision | 8 |
| 28 | `muster-api/src/services/nudgeService.ts:103` | Is `email` the nudge channel? | Nudge event channel | BHD decision | 8 |
| 29 | `muster-api/src/services/nudgeService.ts:123` | Same as row 28, for the stall nudge. | Stall event channel | BHD decision | 8 |
| 30 | `muster-api/src/services/nudgeService.ts:140` | Does an escalation digest count as a mode-c BHD touch? Is setting `party_id` to the first stalled party acceptable? | Digest event; touch records | BHD decision | 11 |
| 31 | `muster-api/src/services/nudgeService.ts:174` | Same as row 30, at the touch-record call. | Touch records | BHD decision | 11 |
| 32 | `muster-api/src/services/progressService.ts:13` | What is the display order of lifecycle and disposition states? | Engagement progress summary | BHD decision | 13 |
| 33 | `muster-api/src/services/progressService.ts:60` | Should `abandoned` or `opted_out` override the lifecycle display label? | Progress summary labels | BHD decision | 13 |
| 34 | `muster-api/src/services/reassessmentService.ts:15` | Same as row 15 (annual cadence). | Reassessment flips | BHD decision | 9 |
| 35 | `muster-api/src/services/reassessmentService.ts:32` | Which terminal states are excluded from reassessment (now: only `complete`, `ready`, `validate` are eligible)? | Reassessment eligibility | BHD decision | 9 |
| 36 | `muster-api/src/services/recipeIngestService.ts:68` | None: the comment records that checklist row 16 is closed. | None | Obsolete | 16 (closed) |
| 37 | `muster-api/src/services/schedulerService.ts:20` | The scheduler's cadence values (the same values as rows 15 and 26). | Scheduled nudge and reassessment ticks | BHD decision | 9, 21 |
| 38 | `muster-api/src/services/tenantKeysService.ts:25` | Token acquisition: a cert assertion minted in Node, or delegation to the endpoint-operations sessions? | Live tenant access | BHD decision | 20 |
| 39 | `muster-api/src/services/touchService.ts:42` | After onboarding, is the mode-a bar zero and mode-c counted per escalation? | Touch records and budgets | BHD decision | 11 |

## Build-log markers (`src/features/assessment/IMPLEMENTATION_S4.md`)

| # | File:line | Question | Output it affects | Proposed owner | Checklist row |
|---|---|---|---|---|---|
| 40 | `IMPLEMENTATION_S4.md:10` | HIL routing of low-confidence, high-weight sync facts (repeats rows 1 and 23). | None (log) | Obsolete | 5, 6 |
| 41 | `IMPLEMENTATION_S4.md:14` | `prime_ref` null for individual contractors (repeats row 2). | None (log) | Obsolete | 17 |
| 42 | `IMPLEMENTATION_S4.md:42` | Should `POST /hil/flag` exist, given that it is beyond the pinned API contract? (No code marker carries this.) | HIL flag endpoint | BHD decision | 18 |
| 43 | `IMPLEMENTATION_S4.md:43` | Contract create on a new-session flow sends `party_id: undefined`. Is this still true, and how should the party be resolved? | Contract create | Contractor | 17 |

## Totals by proposed owner

| Owner | Rows | Count |
|---|---|---|
| BHD decision | 1–3, 5, 8, 9, 12–18, 20–35, 37–39, 42 | 33 |
| BHD content | 4, 10 | 2 |
| Contractor | 7, 11, 19, 43 | 4 |
| Obsolete | 6, 36, 40, 41 | 4 |
| **Total** | | **43** |

The 33 BHD decisions collapse to 14 distinct checklist rows (3–6, 8–13, 17, 18, 20, 21), so BHD answers questions, not lines. Several rows are the same question in two places (3/2, 9/8, 22/21, 29/28, 31/30, 34/15, 37/15 and 26); one answer settles both.
