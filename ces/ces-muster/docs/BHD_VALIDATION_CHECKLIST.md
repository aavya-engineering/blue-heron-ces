# BHD Validation Checklist — business assumptions baked into P1/P2

Generated 2026-07-07 from every `[validate with BHD]` marker on `g-muster-p1`.
Each row is a business decision I (the build) made unilaterally; BHD should
confirm or correct before customer-facing use. Grouped by risk.

**Reconciled 2026-07-27 (G-MUSTER-PL-1 K2).** Every in-code `[validate with BHD]`
marker was re-swept: **40 markers** (10 in `src/`, 30 in `muster-api/src/`) — down
from the 2026-07-10 audit's ~46 as intervening goals resolved several. Every marker
maps to a row below; **no unmapped markers remain, so no new rows were required**
this reconciliation. Rows 1, 2, 15, and 18 have no current in-code `[validate with
BHD]` string (their assumption is recorded in the doc/recipe named in the Where
column) and are retained. Two markers were added this goal — `recipeIngestService.ts`
(row 16, now closed — see below) and `schedulerService.ts` (rows 8/9 cadence) — both
map to existing rows. Marker→row map:
row 3 ← factRouter.ts + its test; row 4 ← driftService (scope); row 5 ←
adaptiveEngine / adaptiveInterviewService; row 6 ← driftService (routing weight),
hilService; row 7 ← contractsService; row 8 ← nudgeService (cadence/STALL/channel);
row 9 ← reassessmentService, reassessment route, schedulerService; row 10 ←
lifecycleService; row 11 ← ResultScreen, TimerBar, nudgeService (digest), touchService;
row 12 ← contracts + hil routes; row 13 ← progressService; row 14 ← graphClient,
consentService; row 16 ← recipeIngestService; row 17 ← ContractsPage,
contractValidation, engagement.ts; row 19 ← preambleMapper; row 20 ←
tenantKeysService; row 21 ← nudges + reassessment routes.

## Tier 1 — affects scores or compliance claims (review before ANY customer output)

| # | Assumption | Where |
|---|---|---|
| 1 | SPRS weight table (5/3/1 per requirement) interpreted from DoD Assessment Methodology v2.13 | `src/features/scoring/sprsCalc.ts`, api copy |
| 2 | Cascade `not_met` outranks interview `met` → all-yes fixture scores SPRS −102; if BHD expects "interview yes = met", the cascade path changes | `docs/IMPLEMENTATION_S6.md` |
| 3 | Router precedence: machine-harvested current state (A) outranks captured point-in-time evidence (C), so A-'yes' beats C-'no' | `src/features/scoring/factRouter.ts` |
| 4 | Drift alerts fire only on machine-evidence (A/C) contradictions; interview-answer changes never alert | `muster-api/src/services/driftService.ts` |
| 5 | Degraded/offline facts default to confidence 'low' weight 3 (auto-routes ALL of them to the advisor queue — volume implication) | `adaptiveInterviewService.ts`, `adaptiveEngine.ts` |
| 6 | HIL threshold: weight ≥ 3 = "high-impact"; drift alerts reuse low/weight-3 to force routing | `hilService.ts`, `driftService.ts` |
| 7 | CMMC levels restricted to 1–3 per DoDI 8171.01 | `contractsService.ts` |

## Tier 2 — cadence, budgets, lifecycle (review before field pilot)

| # | Assumption | Where |
|---|---|---|
| 8 | Nudge cadence T+3/7/14 days; stall threshold strictly > 14 days; channel 'email' placeholder | `nudgeService.ts` |
| 9 | Reassessment cadence 365 days (env REASSESS_DAYS); `convert_to_enclave` excluded as lifecycle-terminal | `reassessmentService.ts`, `lifecycleService.ts` |
| 10 | Lifecycle recovery edges added: stalled→in_progress, reassessment_due→in_progress | `lifecycleService.ts` |
| 11 | Escalation digest counts as mode-c BHD touch; ≤ 30 min/escalation and ≤ 2 hrs/sub budgets displayed | `nudgeService.ts`, `touchService.ts`, TimerBar/ResultScreen |
| 12 | HIL queue visible to bhd_operator + prime + assessor_read_only; contract DELETE bhd_operator-only | `hil.ts`, `contracts.ts` routes |
| 13 | Progress display ordering + abandoned/opted_out label override | `progressService.ts` |

## Tier 3 — integration endpoints & environment (review before deployment)

| # | Assumption | Where |
|---|---|---|
| 14 | GCC High endpoints: graph.microsoft.us / login.microsoftonline.us | `graphClient.ts`, `liveAccess.ts` (`consentService.ts` retired FC-MU-3) |
| 15 | Recipe cmdlet availability on target tenants/endpoints (Graph PowerShell, Get-MpComputerStatus, BitLocker module) | `recipes/*/recipe.ps1` |
| 16 | ConfigFact schema validated structurally (not ajv) in muster-api — self-contained-package tradeoff. **CLOSED 2026-07-27 (PL-1 H1):** the hand-rolled `validateConfigFact` now provably agrees with `config-fact.schema.json` (both-ways fixture parity test `tests/configFact.schema-validator-parity.test.ts`, incl. `additionalProperties:false`); recorded as the permanent design — no ajv runtime dependency. This is now an engineering fact, not an open BHD question. | `recipeIngestService.ts` |
| 17 | Contract entity: 14-field list, required-vs-optional split, prime_ref-null semantics for individual contractors, party resolution on create | `engagement.ts`, `ContractsPage.tsx`, `contractValidation.ts` |
| 18 | `/hil/flag` endpoint added beyond the pinned API contract (SPA resync + sub-flag path) | `hil.ts`, S4 log |
| 19 | Phase-0 preamble assumptions: CUI present, L2 target, hybrid deployment | `preambleMapper.ts` |
| 20 | Tenant keys resolved via stamper constructs (vendored TenantConfig + stack seam); token ACQUISITION strategy open — CES is cert-based via PowerShell sessions, muster-api does not mint cert-assertion tokens (client-secret exchange is env-fallback only) | `muster-api/src/services/tenantKeysService.ts` |
| 21 | Nudge/reassessment ticks are scoped to the CALLING OPERATOR'S tenant (RLS pipeline); a cross-tenant global tick would need a service-account design. **PL-1 H3:** a real wall-clock scheduler (`schedulerService.ts`, opt-in via `SCHEDULER_TENANT_ID`) now self-drives ticks for ONE configured operator tenant through the same withTenant pipeline. The cross-tenant GLOBAL tick remains excluded here (X11) — still needs the service-account design; this row stays open for that. | routes/nudges.ts, reassessment.ts, `schedulerService.ts` (withTenant wiring) |

## Standing gates (not assumptions — do not relax without a recorded decision)

- `RECIPES_SELF_SERVE` stays OFF until concierge validation sessions are recorded
  in `docs/recipes-concierge-validation.md`.
- Field obligations listed in `GOAL_COMPLETION_G-MUSTER-P2.md` §Open field obligations.
