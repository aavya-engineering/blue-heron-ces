# REQ: ces-muster: pruned prefill answers are never persisted to the session

**Filed by:** ces-muster (FC-MU, MU-06, 2026-09-27)
**Target:** ces-muster (self)
**Priority:** P1 (affects what a discovery- or harvest-assisted session scores)
**Status:** DONE (FC-MU-3 step 1, 2026-09-28; founder decision 2026-09-28 #4 "Fix"). Both writes now persist against
the stack-filtered graph (`stackFilteredGraph` in `src/features/interview/questionGraphService.ts`), so a prefill-pruned
answer is saved with provenance `auto_detected`, its confidence and (new optional `InterviewFact.source`) its source; an
answer hidden by a service change still drops out. Proof: `src/features/assessment/__tests__/prefillPersistence.test.tsx`
(harvest, discovery, and the service-change guard). Result change, same session: before SPRS 110 over 26 assessed
requirements (the harvested MFA "no" vanished); after SPRS 100 over 31 (the gap is deducted).

Earlier status: HONEST-OPEN. Found while proving MU-06; deliberately not fixed in the MU-06 step because the fix changes
what scores for every discovery/harvest-assisted session. It needs its own step and a founder look.

## What is wrong
`src/features/assessment/AssessmentPage.tsx` prunes a question when a non-operator prefill (Graph harvest or discovery,
provenance `auto_detected`) covers it. The comment above the pruning effect says facts are derived against the full
`QUESTION_GRAPH` so a pruned question "does not lose its backing fact". That holds for the pruning set only.

The two writes that persist the session both use the **pruned** list:
- `recordAnswer` writes `factsFromAnswers(questions, next, ...)`
- `finishInterview` writes `factsFromAnswers(questions, answers, ...)`

`factsFromAnswers` keeps only questions in the list it is given. A prefilled question is pruned, so its answer is dropped
from `session.facts`. The prefill hides the question from the operator and then adds nothing to the readiness result.

## Evidence
Reproduced with `src/features/assessment/__tests__/harvestFreshAssessment.test.tsx` during MU-06 (a debug run). With
harvest facts for `iam-001`, `iam-004` and `ep-001` in place, Identity showed 3 of 5 questions (the harvested ones pruned).
After answering one question the persisted facts were `[["iam-002","operator_interview"]]`, with no `auto_detected` fact.
The discovery prefill goes through the same `answers`/`provenances` state and the same two writes. That path was read
in code, not reproduced separately.

## Acceptance
1. A test mounts `AssessmentPage` with a harvest prefill, answers one question, and finishes. `session.facts` contains every
   prefilled fact with provenance `auto_detected` and its confidence and source.
2. The same test for the discovery prefill.
3. The readiness result for such a session counts the prefilled answers. The SPRS parity and readiness export tests still pass.

## Suggested fix
Persist `factsFromAnswers(QUESTION_GRAPH, ...)` (the full graph, the same set the pruning uses) at both writes. Keep
`current_question_index` and the finish gate on the visible `questions`.
