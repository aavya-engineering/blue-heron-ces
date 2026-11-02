# Critique — G-MUSTER-P2

**Date:** 2026-07-07
**Target:** G-MUSTER-P2 commits 9e1853e (T1), 832cda1 (T2), fcfd9d7 (T3), 0e7f1f4 (T4), c4e1ccf (wiring)
**Score:** 7.0/10
**Verdict:** NEEDS WORK — two P1 defects block PASS; fix and re-run

---

## TL;DR

Functional work is clean and tests are green, but the static read-only tokenizer has a named gap and P2 started before P1 HIL approval was formally recorded.

---

## Defects

### D1 — P1 — Gate Integrity: E1 not formally satisfied

**File:** `docs/GOAL_COMPLETION_G-MUSTER-P1.md`

P2 ran before G-MUSTER-P1 had explicit HIL approval. P2 entry criterion E1 requires
"ces-muster/docs/GOAL_COMPLETION_G-MUSTER-P1.md exists and records explicit HIL
approval of G-MUSTER-P1 with a date." That file is a DRAFT — the HIL approval line
is blank/pending.

The in-session owner directive "Push past the gate rows. Built out phase 1 then do
phase 2." covers the spirit, but `GATE_OVERRIDE_2026-07-07.md` explicitly covers
G-MUSTER-P1 entry criteria (not P2 entry). There is no separate written P2-entry
override for E1.

**Impact:** Gate integrity claim for DONE-WHEN #1 is unsubstantiated for E1.

**Fix:** One of:
(a) Obtain and record explicit HIL approval of P1 in the P1 completion record (blank
    line → approval date + wording), then P2 E1 is retroactively satisfied; OR
(b) Create `docs/GATE_OVERRIDE_P2_E1_2026-07-07.md` quoting the in-session directive
    as the written authorization for proceeding without P1 HIL approval on record.

---

### D2 — P1 — Tokenizer Gap: Invoke-RestMethod not in forbidden list

**File:** `muster-api/tests/recipes.readonly.test.ts`, lines 36–60 (FORBIDDEN_PATTERNS)

The static assertion bans `Invoke-WebRequest -Method Post/Put/Delete` but does NOT
ban `Invoke-RestMethod -Method Post/Put/Delete`. Both cmdlets make identical mutating
HTTP requests. A future recipe using `Invoke-RestMethod -Method Post` would pass the
tokenizer and violate the "statically asserted read-only" guarantee.

The three existing recipes are clean (they use `Get-Mg*`, `Get-MpComputerStatus`,
`Get-BitLockerVolume`). The gap is structural, not triggered today.

**Impact:** The "no write/delete/config-change operations" static assertion is
incomplete. The P2 recipe library can grow; the tokenizer must guard the full surface.

**Fix:** Add to `FORBIDDEN_PATTERNS` in `recipes.readonly.test.ts`:

```typescript
{
  name: 'Invoke-RestMethod -Method POST/PUT/DELETE',
  re: /\bInvoke-RestMethod\b[^\n]*-Method\s+(Post|Put|Delete)\b/i,
},
```

---

### D3 — P2 — AJV Not Used in Ingestion Pipeline (Documented Deviation)

**File:** `muster-api/src/services/recipeIngestService.ts`, line 14; `muster-api/IMPLEMENTATION_T1.md`

DONE-WHEN #3 says "validated against the vendored AJV schemas (fixture test)."
The ingestion service uses a hand-rolled structural validator (`validateConfigFact`)
instead of AJV. The deviation is documented; constraint coverage is equivalent.
`config-fact.schema.json` is committed as the authoritative schema definition.

**Impact:** Low. The hand-rolled validator is strict and the tests prove it. The
spec word "AJV" is not technically satisfied.

**Fix:** Either (a) add AJV to `muster-api/package.json` and replace the hand-rolled
validator with `ajv.compile(schema)(obj)`, or (b) update DONE-WHEN #3 acceptance
wording in the run log to explicitly note the deviation as owner-accepted.

---

## DONE-WHEN Table (skipping #12=this critic, #13=HIL)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Entry E1–E3 verified | DEFERRED-with-auth (D1) | E1: P1 HIL approval blank — in-session directive is implicit auth but not a written P2 override (D1). E2: GATE_OVERRIDE_2026-07-07.md present, C-gate decision honestly preserved. E3 a–d: labeled pending field sessions, no synthetic value presented as field measurement. |
| 2 | ≥3 recipes, signed, read-only | PASS (D2 noted) | 3 recipes; sha256 manifests; static tokenizer 7/7 green. Invoke-RestMethod gap (D2) does not affect current recipes. |
| 3 | Ingestion → ConfigFacts, captured provenance, AJV validation | PASS with deviation (D3) | 30 ingest tests green; hand-rolled validator covers AJV schema constraints; deviation documented. |
| 4 | Router unit tests: A>C>B, fallthrough, unknown-never-passes | PASS | 20 tests in factRouter.test.ts; each rule explicitly tested. |
| 5 | Conservative merge: C-no not upgradeable by B-yes | PASS | `recipes.readonly.test.ts` line 105: C-no beats B-yes-low-confidence. Integration test: merged score ≤ naive-B score. |
| 6 | Evidence package: self-contained, FCA disclaimer REQUIRED, schema validated | PASS | fca_disclaimer REQUIRED in evidence-package.schema.json; buildEvidencePackage embeds FCA_DISCLAIMER constant; exportEvidencePackage throws on schema fail; 8 tests including disclaimer exactness. |
| 7 | Reassessment scheduler flips on cadence; drift alert fires on contradiction | PASS | 11 reassessment tests (simulated clock); 12 drift tests; no→yes = improvement only, no alert. |
| 8 | Self-serve flag OFF by default; docs say sessions must be recorded first | PASS | .env.example omits RECIPES_SELF_SERVE; code checks === 'true'; WIRING_T1.md: "Do not set to true until concierge validation sessions are recorded in docs/recipes-concierge-validation.md." Gate tests 19–22 in recipes.ingest.test.ts confirm 403 when flag off and no header. |
| 9 | Annuity-cycle touch queryable ≤30-min budget | PASS | drift_alert and reassessment_cycle each produce TouchEvent records; /api/touch/report endpoint queryable; tests confirm record creation. |
| 10 | Parity + drift still green | PASS | Vendor drift: 23/23 OK (exit 0). SPA npm test: 197/197 pass. muster-api npm test: 211/1-skip. |
| 11 | P0/P1 regression | PASS | 24 SPA test files, 18 muster-api test files — all prior suites intact. |

---

## Technical Purist (6.5/10)

**Good:**
- factRouter.ts is clean, pure, and provably correct; routeFacts + pickWinner have no
  mutation and return original references.
- Evidence package schema is draft-07 with additionalProperties:false throughout — tight.
- Drift service correctly reuses the HIL low/weight-3 routing rule for guaranteed advisor
  routing rather than duplicating the routing logic.

**Bad:**
- Tokenizer missing Invoke-RestMethod (D2) — weakens the static assertion on which #2
  depends. Fix: one regex line in FORBIDDEN_PATTERNS.
- AJV not used in muster-api despite spec saying "validated against the vendored AJV
  schemas" (D3) — documented but the contract word is not met.

**Ugly:**
- None fatal. D1 is a process gap, not a runtime defect.

---

## User Advocate (7.5/10)

**Works:**
- Evidence package download throws rather than exporting invalid data — fail-closed.
- Drift alerts always go to advisor queue; no→yes changes silently record as
  improvements without alarming advisors unnecessarily.
- Self-serve gate is correctly off; advisors cannot accidentally expose recipes to subs.

**Fails:**
- D1 (E1 gap) — if an auditor reviews the gate trail, the P1 completion record has an
  empty approval date. Fix: record the approval date before this record is reviewed.

---

## Strategic Thinker (7.0/10)

**Aligned:** Yes — the A→C→B router, evidence package, and Tier-3 annuity engine all
directly serve the G-MUSTER-P2 scope. No scope creep found: only M365 playbook present,
no new intent packs, no non-M365 vendor playbooks.

**Concerns:**
- The written override chain is getting long. Three consecutive phases have run on
  synthetic data / in-session directives rather than field evidence. The calibration and
  mode-(b) timing bars (rows b–d) remain unmeasured. These are honestly labeled but the
  cumulative deferral is a real business risk [validate with BHD before field launch].
- A-yes-beats-C-no is tagged [validate with BHD] but is tested as a PASS in the suite.
  If BHD reverses this decision, the router logic and test must both change. The tag is
  the right mechanism; just flag it prominently for the BHD review.

---

## Verdict: NEEDS WORK

**Fix First (P1 — D1):** Record P1 HIL approval in `docs/GOAL_COMPLETION_G-MUSTER-P1.md`
(blank approval line → approval date + wording), OR create a formal P2-entry written
override for E1. Without this, E1 is unsatisfied and the gate trail is incomplete.

**Fix Second (P1 — D2):** Add `Invoke-RestMethod -Method Post/Put/Delete` to
`FORBIDDEN_PATTERNS` in `muster-api/tests/recipes.readonly.test.ts`. One regex line
closes the named gap in the static read-only assertion.

Re-run critic after both fixes. D3 (AJV deviation) may be accepted as-is if owner
notes it in the run log.

---

## Re-review (post-38a5ad9)

**Date:** 2026-07-07
**Commit verified:** 38a5ad9
**Score:** 7.5/10
**Verdict: PASS**

### D1 — Gate Override Addendum (GATE_OVERRIDE_2026-07-07.md)

The addendum is honest and satisfies the written-override mechanism.

It records who (the project owner), when (2026-07-07), and why (single run directive
"Push past the gate rows. Built out phase 1 then do phase 2." orders both phases
before P1 HIL approval is possible). E2 is separately satisfied via its own option (b).
Both completion records remain explicitly DRAFT pending HIL — no approval is claimed or
fabricated. Open obligations (field measurements, concierge validation) are maintained,
not waived. The override is scoped correctly and preserves the integrity of the gate
trail.

**D1: CURED.**

### D2 — Invoke-RestMethod Added to FORBIDDEN_PATTERNS

`muster-api/tests/recipes.readonly.test.ts` now contains at lines 51-54:

```typescript
{
  name: 'Invoke-RestMethod -Method POST/PUT/DELETE/PATCH',
  re: /\bInvoke-RestMethod\b[^\n]*-Method\s+(Post|Put|Delete|Patch)\b/i,
}
```

PATCH was added beyond the recommended fix — tighter than required. All three
existing recipes still pass the stricter lint. `npx vitest run tests/recipes.readonly.test.ts`
confirms 7/7 green.

**D2: CURED.**

### D3 — AJV Deviation

Owner-accepted as a logged deviation in docs/GOAL_COMPLETION_G-MUSTER-P2.md.

**D3: ACCEPTED.**

### Re-review Summary

| Defect | Severity | Status |
|--------|----------|--------|
| D1 Gate override not covering P2 E1 | P1 | CURED — addendum in GATE_OVERRIDE_2026-07-07.md honest and complete |
| D2 Invoke-RestMethod not in tokenizer | P1 | CURED — added with PATCH coverage; 7/7 tests green |
| D3 AJV not used in ingest pipeline | P2 | ACCEPTED — owner-logged deviation |

No new defects found in the fix commit. All tests remain green. DONE-WHEN #1 and #2
are now fully satisfied. All other DONE-WHEN items (#3-#11) unchanged from initial
review — PASS.

**Final verdict: PASS 7.5/10**
