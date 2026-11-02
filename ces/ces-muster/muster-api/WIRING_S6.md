# S6 Wiring — SPRS Route

Slice S6 adds `POST /api/sprs/score`. The router is exported from `src/routes/sprs.ts`.

## Wiring line (add to `src/app.ts`)

```typescript
import sprsRouter from './routes/sprs.js';

// inside createApp(), after existing route mounts:
app.use('/api/sprs', sprsRouter);
```

The route is intentionally NOT wired into `src/app.ts` by this slice — `app.ts` is read-only
per the S6 constraint. Add the import and `app.use` line above when wiring is unblocked.

## Route specification

| Method | Path            | Auth     | Roles         | Body                                              | Response                                                                 |
|--------|-----------------|----------|---------------|---------------------------------------------------|--------------------------------------------------------------------------|
| POST   | /api/sprs/score | required | any (all 4)   | `{ requirement_results: [{requirement_id, status}] }` | `{ sprs, assessed_count, deductions: [{requirement_id, weight}] }` |

## Notes

- `sprs` range: −203 to 110 (DoD Assessment Methodology floor/ceiling).
- Conservative rule (FCA): `'partial'` and `'unknown'` status values count as not met.
- `assessed_count` reflects only requirements passed in the body; unassessed requirements
  are excluded from deductions.
- [validate with BHD: verify WEIGHT_TABLE against current DoD Assessment Methodology
  before any customer-facing use.]
