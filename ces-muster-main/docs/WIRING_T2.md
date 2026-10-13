# WIRING_T2 — T2 Fact-Router Integration Notes

## Where to invoke the router in the export/scoring path

The `routeFacts` call belongs in `src/features/export/exportPipeline.ts`, in
`executeExport`, immediately before `scoreFacts` is called (current line ~23):

```typescript
// Add import at top of exportPipeline.ts:
import { routeFacts } from '@/features/scoring/factRouter';

// In executeExport, replace the scoreFacts call (currently line ~23):
const routedFacts = routeFacts(session.facts);
const { posture, conservativeScore } = await scoreFacts(
  routedFacts,                     // was: session.facts
  graph,
  session.selected_stacks ?? []
);
```

`routeFacts` accepts `InterviewFact[]` and returns `InterviewFact[]` (same type,
one winner per `question_id`), so `scoreFacts` receives its existing expected type
with no signature change. The `buildStatusPayload` call that follows may optionally
receive `routedFacts` in place of `session.facts` for the `interview_facts` field
to reflect the de-duplicated, post-routing fact set in the export package.

**Integration landing:** This wiring is deferred to T3/T5 to avoid parallel-edit
collisions — the export agent owns `src/features/export/` concurrently. No changes
to `exportPipeline.ts` or `statusPayloadService.ts` were made in this slice.
