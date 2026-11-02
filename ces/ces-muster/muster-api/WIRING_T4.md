# WIRING_T4.md — G-MUSTER-P2 Slice T4 wiring reference

## New router: reassessment

File: `muster-api/src/routes/reassessment.ts`

Export: `createReassessmentRouter(db)` (factory) + `default` (production instance)

To wire into `app.ts` when ready (DO NOT edit app.ts during T4 — this slice
is additive and the default export is ready for mounting):

```typescript
// In src/app.ts, add after the touch router line:
import reassessmentRouter from './routes/reassessment.js';
// ...
app.use('/api/reassessment', reassessmentRouter);
```

## Endpoints

| Method | Path                           | Auth                       | Notes                                         |
|--------|--------------------------------|----------------------------|-----------------------------------------------|
| POST   | /api/reassessment/tick         | bearerAuth (bhd_operator)  | Annual cadence flip; REASSESS_DAYS env        |
| POST   | /api/reassessment/drift-check  | bearerAuth (prime, bhd_op) | Machine-evidence drift detection + HIL route  |

## New files (T4)

```
muster-api/
  src/
    services/
      reassessmentService.ts    — tick(engagementId|null, now) → {flipped}
      driftService.ts           — detectDrift({partyId, sessionId?, previousFacts,
                                    currentFacts, now?}) → {alerts, improvements}
    routes/
      reassessment.ts           — POST /reassessment/tick + /reassessment/drift-check
  tests/
    reassessment.test.ts        — cadence flip + idempotency + touch instrumentation
    drift.test.ts               — drift alerts + improvements + HIL + touch budget
  WIRING_T4.md                  — this file
  IMPLEMENTATION_T4.md          — implementation record
```

## Environment variables

| Variable       | Default | Description                                        |
|----------------|---------|----------------------------------------------------|
| REASSESS_DAYS  | 365     | Days since last completed session before re-assess |

## Touch instrumentation (DONE-WHEN #9)

Each re-assessment cycle tick records a mode-c TouchEvent kind='reassessment_cycle'
with minutes=0 at cycle start.

Each drift-alert escalation records a mode-c TouchEvent kind='drift_alert' with
minutes=0 at alert creation.

Advisor resolution timing (advisor_minutes) accrues when the HIL item is resolved
via POST /api/hil/queue/:id/resolve. Both event types are queryable via
GET /api/touch/report?engagement_id=... against the ≤30 min/escalation budget.
[validate with BHD]
