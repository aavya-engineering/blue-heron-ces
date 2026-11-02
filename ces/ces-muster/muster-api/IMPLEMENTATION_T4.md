# Implementation Log — G-MUSTER-P2 Slice T4
**Date:** 2026-07-07
**Plan Reference:** Task spec T4 — continuous re-assessment + drift alerts (Tier-3 annuity engine)

## Files Created

| File | Purpose |
|------|---------|
| `src/services/reassessmentService.ts` | tick() cadence engine — lifecycle flip + touch instrumentation |
| `src/services/driftService.ts` | detectDrift() — machine-evidence drift alerts + HIL routing + touch |
| `src/routes/reassessment.ts` | POST /reassessment/tick + POST /reassessment/drift-check |
| `tests/reassessment.test.ts` | 11 tests — cadence, idempotency, touch instrumentation |
| `tests/drift.test.ts` | 12 tests — drift alerts, improvements, HIL, touch budget |
| `WIRING_T4.md` | Wiring instructions for app.ts (not edited) |

## Changes Made

- `src/services/reassessmentService.ts` (new) — tick(engagementId|null, now) scans
  parties in {complete, ready, validate} lifecycle states whose last completed
  interviewSession was older than REASSESS_DAYS (env, default 365). Calls
  lifecycleService.transition(→ reassessment_due) and records a mode-c TouchEvent
  kind='reassessment_cycle' minutes=0 per flip. Idempotent: reassessment_due parties
  are excluded from the scan.

- `src/services/driftService.ts` (new) — detectDrift({partyId, sessionId?,
  previousFacts, currentFacts, now?}) compares machine-evidence facts
  (provenance 'auto_detected'|'captured') against the previous snapshot.
  yes→no: fires HIL route via hilService.routeFact(confidence='low', weight=3)
  and records TouchEvent mode-c kind='drift_alert' minutes=0.
  no→yes: records improvement only (no HIL, no touch).
  Interview-provenance currentFacts are skipped entirely.

- `src/routes/reassessment.ts` (new) — injectable factory + default export.
  POST /tick: bhd_operator; POST /drift-check: prime|bhd_operator. Zod validation.
  Wiring deferred to WIRING_T4.md.

- `tests/reassessment.test.ts` (new) — 11 tests covering DONE-WHEN #7: 364d no-flip,
  366d flip, idempotent re-tick, no-session skip, ready/validate states, in_progress
  exclusion, null engagementId scope, mode-c touch record, touch report ≤30-min budget,
  no-flip = no touch.

- `tests/drift.test.ts` (new) — 12 tests covering DONE-WHEN #7+#9: auto_detected
  yes→no alert, captured yes→no alert, no→yes improvement (no HIL), interview-provenance
  exclusion, mixed-provenance, same-answer no-op, no-previous-fact, party-not-found
  throw, mode-c touch on alert, no touch on improvement, touch report ≤30-min budget,
  multiple alerts = multiple touch events.

## Deviations from Plan

1. **convert_to_enclave excluded from REASSESSABLE_STATES**: The task spec lists
   'complete'|'ready'|'validate'|'convert_to_enclave' as eligible for the flip.
   However, lifecycleService.LEGAL_TRANSITIONS['convert_to_enclave'] = [] (terminal,
   no outbound edges). Calling transition() on a convert_to_enclave party throws
   "Illegal lifecycle transition". Decision: exclude convert_to_enclave from
   REASSESSABLE_STATES to avoid throwing. Logged here; validate with BHD whether
   convert_to_enclave parties should ever be re-assessed.

2. **findMany filter for interviewSession is by {party_id, status: 'complete'}**:
   The mockDb findMany supports simple key-value equality only. The service uses
   this to find completed sessions and then reduces to the most recent completed_at.
   This works for both mockDb and Prisma (Prisma supports the same where shape).

3. **driftService party lookup for tenant_id/engagement_id**: The detectDrift params
   do not include tenantId/engagementId (per spec signature). The service resolves
   them via db.party.findUnique(partyId). This is consistent with the lifecycleService
   pattern (requireParty) and avoids requiring the caller to pass redundant fields.

## Testing Notes

- All 211 tests pass (212 run, 1 pre-existing skip in rls.test.ts).
- Prior count was 188; T4 adds 23 tests (11 reassessment + 12 drift).
- `npx tsc --noEmit`: clean (no output).
- `npx eslint src/services/reassessmentService.ts src/services/driftService.ts src/routes/reassessment.ts`: clean (no output).
- Simulated-clock idiom matches nudgeService pattern (nowFn injectable, now passed per-call).
- mockDb not modified — all required models (party, interviewSession, hilItem, touchEvent,
  disposition) were already present.

## Open Items

- app.ts wiring deferred: see WIRING_T4.md for the two import+use lines to add.
- `REASSESS_DAYS` env var not set in vitest.config.ts (intentionally — tests rely
  on the default 365 which is what parseInt('365', 10) produces).
- convert_to_enclave reassessment scope needs BHD validation (see Deviation #1).
