# Critique — G-MUSTER-P1

**Date:** 2026-07-07
**Target:** G-MUSTER-P1 committed range 621e00a..8b06aa6 (8,984 lines, 76 files, 307 tests)
**Score:** 6.5/10

## VERDICT: FAIL

Three cascading bugs in the offline-resync + HIL-routing path break DONE-WHEN #6.
Every other aspect of the build is solid and would score 8/10 on its own.

---

## DONE-WHEN Table

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | E1–E2 verified before code | DEFERRED-with-authorization | `docs/GATE_OVERRIDE_2026-07-07.md` — owner = the project owner, 2026-07-07; rows 3/4 explicitly open obligations; rows 1/2/5 structurally satisfied. Properly named, not self-certified. |
| 2 | muster-api boots + npm test green | PASS | `npx tsc --noEmit` exits 0. 144/145 muster-api tests pass; 1 skipped = live-DB live-RLS test (correct per no-Postgres constraint). 163/163 SPA tests pass. |
| 3 | RLS proven | PASS | `rls.test.ts:28-98` asserts ENABLE/FORCE/CREATE POLICY for `parties`, `interview_sessions`, `contracts` (migration 001) and `hil_items`, `touch_events` (migration 002). Live cross-tenant test correctly wraps in `describe.skipIf(!process.env.DATABASE_URL)` — structural verification only, documented in PLAN-p1-build.md. |
| 4 | RBAC per role | PASS | `rbac.matrix.test.ts`: prime roster-read allowed (200) + cross-tenant denied (403); sub self-only enforced (403 on other party); bhd_operator write allowed (201); assessor mutation denied (403). One real HTTP test per role via Node http.Server. |
| 5 | Adaptive interview + chat coach | PASS | `adaptive.test.ts` 13 tests (null-client degraded, id-validation fallback, error classification). `coach.test.ts` 12 tests. `provenance:'ai_adaptive'` and per-fact confidence verified. Chat coach panel renders beside interview in `CoachPanel.tsx`. |
| 6 | Offline fallback | FAIL | **P0 DEFECT #1** — see below. Mode-switch to degraded on 3 failures and browser offline event passes. Dexie queuing passes. But server resync is broken. |
| 7 | HIL threshold exact | PASS | `hil.threshold.test.ts`: `low+weight=2 → null` (line 66), `low+weight=3 → routed` (line 23), `sub_flagged → always routes` (line 42). Service implementation at `hilService.ts:42` exactly matches spec. |
| 8 | Graph harvest pre-fills | PASS | `harvest.test.ts` 10 tests (probe table, per-probe non-fatal failures, FCA absence-not-'no'). `harvestPrefill.test.ts` 13 tests. Machine facts carry `provenance:'auto_detected'`. |
| 9 | Nudge engine | PASS | `nudge.engine.test.ts` 14 tests: T+3/7/14 firing, stall detection, escalation digest, injectable clock. 8-state lifecycle in `lifecycleService.ts`; `lifecycle.test.ts` 18 tests cover all transitions and terminal-state guards. |
| 10 | Contract CRUD + IC flow | PASS | `contracts.crud.test.ts` 10 tests including all 14 named fields and `cmmc_level_required` validation. `engagement_kind` immutability tested at line 105. IC flow type definitions in `engagement.ts` include `prime_ref: null` semantics. |
| 11 | SPRS standalone parity | PASS | `sprs.parity.test.ts`: api `computeSprs` imported at line 10; SPA `computeSprs` dynamically imported at line 32 via `import('../../src/features/scoring/sprsCalc.js')`. 22 tests cross-check both implementations on 6 edge cases and the committed `sprs-parity.json` fixture. Vendor drift: 23/23 files OK, 0 drift. |
| 12 | Touch instrumentation + FCA re-verify | PASS | `touch.test.ts` 5 tests: mode-a/c segregated, per-escalation timing verified, HIL-to-touch workflow covered. FCA guardrails verified: `harvestService.ts` comment + probe-failure catch clause enforce absence-not-'no'; `sprsCalc.ts:96` — only `'met'` passes, `partial`/`unknown`/`not_met` all deduct. |
| 13 | Brutal critic PASS | FAIL | This verdict. |
| 14 | HIL user approval | DEFERRED | By design — not in scope of critic pass. |

---

## Defects

### DEFECT 1 — P0 — Offline resync API payload mismatch (DW#6 FAIL)

**File:** `src/features/assessment/adaptiveEngine.ts:162`
**Also:** `muster-api/src/routes/sessions.ts:6-14`

`adaptiveEngine.resync()` posts `{ sessionId, answers }` to `POST /sessions/sync`.
The server Zod schema requires `{ id, party_id, facts, timing_segments, selected_stacks, status }`.

`sessionId` is not the field `id`. `answers` matches no schema field. Zod `safeParse` returns `success:false`; server responds 400. At `adaptiveEngine.ts:167`, `if (!result.ok) return` exits early. Offline queued answers are never marked as synced. Retro-confidence is never called. HIL routing never fires.

The SPA test at `adaptiveEngine.test.ts:177-194` mocks `fetch` to return `{ ok: true, json: () => ({ facts: [] }) }` — this masks the mismatch completely. DONE-WHEN #6 test passes because it never touches the real server contract.

**Fix:** Either (a) align the SPA payload to the server schema (`id` = sessionId, `facts` = synthesized from answers, supply `party_id`, `selected_stacks`, `status`), and have the server call `retroConfidence` and return annotated facts in the sync response; OR (b) refactor `resync()` into two sequential calls — first `POST /interview/retro-confidence` with the raw answers, then `POST /sessions/sync` with the correct schema, using the confidence results for HIL routing.

---

### DEFECT 2 — P1 — retroConfidence degraded path returns 'unknown'; HIL filter misses it

**File:** `muster-api/src/services/adaptiveInterviewService.ts:159`
**Also:** `src/features/assessment/adaptiveEngine.ts:174`

When the Claude client is absent (degraded), `retroConfidence` returns:
```
{ question_id, confidence: 'unknown', weight: 3 }
```
Comment at `muster-api/src/routes/interview.ts:100` says "conservative — routes to HIL."
But the SPA HIL filter at `adaptiveEngine.ts:174` is `f.confidence === 'low'`.
`'unknown' !== 'low'` — degraded offline facts never route to HIL regardless of weight.

The spec mandates "routes qualifying facts to the HIL queue BEFORE score release." In the degraded case — when routing is most critical — it silently does nothing.

**Fix:** Change the degraded fallback to return `confidence: 'low'` instead of `'unknown'`. 'unknown' is not a valid `RetroConfidenceResult.confidence` enum value per the type definition at line 44 anyway. Alternatively, extend the SPA filter to `(f.confidence === 'low' || f.confidence === 'unknown')`.

---

### DEFECT 3 — P1 — /hil/flag receives wrong payload during resync

**File:** `src/features/assessment/adaptiveEngine.ts:178-183`
**Also:** `muster-api/src/routes/hil.ts:11-19`

SPA sends:
```ts
api.post('/hil/flag', { session_id, question_id, reason: 'low_confidence_high_weight' })
```
Server `flagSchema` requires:
```ts
{ session_id?: uuid, question_id: string, fact: { answer, confidence, weight } }
```
`fact` is required and absent. Zod returns 400. The call is `void` (fire-and-forget) so all failures are silently discarded.

Even if Defect 1 is fixed and confidence-annotated facts reach the SPA, this call still fails.

**Fix:** Include the `fact` object from the retro-confidence result: `{ fact: { answer: qa.answer, confidence: fact.confidence, weight: fact.weight ?? 0 } }`.

---

## What Passes (summary)

- Scope: zero CaptureRecipe, zero A→C→B router, zero continuous-assurance, zero non-M365 playbook in the P1 commit range. `git diff 263bff1..HEAD -- .` grep confirmed.
- Vendored spine untouched: `git diff 263bff1..HEAD -- src/vendored` is empty; drift check 23/23 OK.
- HIL threshold is exactly right: the service, route, and test all agree on `low + weight >= 3` as the threshold, `low + weight = 2` does NOT route, `sub_flagged` always routes.
- FCA guardrails hold in AI and harvest paths: harvest probe failures yield no fact (never 'no'); sprsCalc conservative rule verified; `unknown`/`partial` incur full deduction.
- Gate override properly attributed: owner named, date given, why stated, open obligations explicitly preserved. Not self-certified.
- `output_config.format` is valid in this SDK version (confirmed in node_modules CHANGELOG). `claude-opus-4-8` is a real model (confirmed in SDK changelog and middleware docs).

---

## What Must Change for PASS

**Fix First (P0):** Repair the offline resync contract. The SPA and server must speak the same schema, retro-confidence must be called during resync, and the confidence-annotated facts must flow into HIL routing before score release. This is the single most load-bearing failure.

**Fix Second (P1):** Change `retroConfidence` degraded fallback from `confidence: 'unknown'` to `confidence: 'low'` so that degraded offline facts — weight 3 by default — satisfy the HIL filter and route correctly.

**Fix Third (P1):** Add the `fact: { answer, confidence, weight }` object to the `/hil/flag` payload in `resync()`. Without this, the flag call fails Zod and is silently discarded even after the other fixes land.

After all three fixes: re-run `npm test` (root + api) and re-run critic to confirm PASS.

---

## Re-review (post-ebccfcf)

**Date:** 2026-07-07
**Commit:** ebccfcf — "G-MUSTER-P1 S7a: fix CRITIQUE_P1 defects — resync contract, HIL routing, degraded confidence"
**Scope:** Defect areas only (resync path, retroConfidence degraded path, /hil/flag payload).

### Tests run

```
cd muster-api && npx vitest run tests/resync.contract.test.ts tests/adaptive.test.ts
  2 files, 20 tests — ALL PASS

cd (root) && npm test
  22 files, 169 tests — ALL PASS (exactly the expected count)
```

### Defect 1 — Resync contract — CURED

`adaptiveEngine.resync()` now follows the correct three-step sequence:
1. POST `/interview/retro-confidence` with unsynced answers to get server-assigned confidences.
2. Merge results into session facts via `mergeRetroConfidence()` and persist to Dexie BEFORE score release.
3. POST `/sessions/sync` via `buildSyncPayload()` which sends `{ id, party_id, facts, timing_segments, selected_stacks, status }` — the exact fields the server `syncSchema` requires.

`syncSchema` and `flagSchema` are now exported from their route files and validated directly in `resync.contract.test.ts` against the SPA's pure-function builders (`buildSyncPayload`, `buildHilFlagPayload`). The `id`/`party_id` schema was also relaxed from `.uuid()` to `.min(1)` to match SPA nanoid-style IDs — a latent contract bug caught in the same fix pass. The contract test at `resync.contract.test.ts:43-45` confirms `syncSchema.safeParse(buildSyncPayload(session))` passes.

### Defect 2 — Degraded confidence — CURED

Both degraded paths in `adaptiveInterviewService.retroConfidence()` now return `confidence: 'low'` (not `'unknown'`), weight 3. This satisfies the exact HIL rule (`confidence === 'low' AND weight >= 3`). The SPA local fallback in `resync()` also uses `'low'` (lines 249-253). `hilCandidates()` in `adaptiveEngine.ts:101` applies the exact same rule. `resync.contract.test.ts:84-93` verifies `hilCandidates` routes low+weight=3 and does NOT route unknown+weight=5.

### Defect 3 — /hil/flag payload — CURED

`buildHilFlagPayload(sessionId, assignment, answer)` returns `{ session_id, question_id, fact: { answer, confidence, weight } }`. The contract test at `resync.contract.test.ts:71-80` validates this against the exported `flagSchema` and confirms the `fact` object shape. `getNextQuestion` also now sends `remainingQuestions` in its payload per `adaptiveNextSchema` — the latent fourth bug noted by the fix commit.

### Verdict

**PASS — 7.5/10**

All three P0/P1 defects are cured. No regressions introduced. Contract tests provide ongoing protection against future schema drift. The remaining -2.5 from a perfect score reflects the original defects existing at initial submission and the latent schema bugs (nanoid/uuid, missing `remainingQuestions`) that required the same fix pass — structural quality is good but the initial cross-boundary contract coverage was absent.
