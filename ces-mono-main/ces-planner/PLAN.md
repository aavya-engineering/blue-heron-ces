# Plan: Goal File — Planner v2 (/goal G-PLANNER-2)
**Date:** 2026-07-05
**Status:** READY FOR IMPLEMENTATION (rev 2 — gap-analysis fixes applied)

## Objective
Write `ces-planner/docs/_goal-planner-v2.md` — a saved `/goal` prompt file that, when later run, produces a decision-ready Planner v2 plan document at `ces-planner/docs/PLANNER_V2_PLAN.md`.

## Context Summary
- **From Review:** N/A
- **From Research:** N/A
- **Constraints:** House style from `ces-strategy/docs/_goal-pricing-v2.md`: file = `# /goal <ID> — saved prompt` + blockquote provenance header + ONE fenced code block containing the full prompt. Executor writes only the new goal file — no source files touched, no PLANNER_V2_PLAN.md written. Context artifacts referenced during this planning pass: `ces-planner/docs/context/VAULT.md`, `ces-planner/docs/context/MODULE_MAP.md`.

## Implementation Steps

### 1. `ces-planner/docs/_goal-planner-v2.md` — CREATE

The executor writes one file: a file header (outside the fenced block) and a single fenced code block containing sections (A) COMPLETE-WHEN, (B) CONTEXT, (C) requirement sections, (D) DONE-WHEN, (E) BRUTAL CRITIC PASS, (F) OUTPUT & CONSTRAINTS.

**SCRE path pre-check (executor must do this before writing):**
Verify each of the following six absolute paths exists. If any is missing, stop and report which paths are missing — do NOT write the goal file with unresolvable read instructions:
- `C:/Users/mhsut/DevProjects/scre/SCRE-Approach-Decision-Summary.md`
- `C:/Users/mhsut/DevProjects/scre/BHD-SCRE-UseCases-DomainModel.md`
- `C:/Users/mhsut/DevProjects/scre/BHD-SCRE-Engagement-Flow.md`
- `C:/Users/mhsut/DevProjects/scre/BHD-Planner-as-SCRE.md`
- `C:/Users/mhsut/DevProjects/scre/SCRE-Build-Plan.md`
- `C:/Users/mhsut/DevProjects/scre/SCRE-Data-Collection-Goal.md`

---

**Part 1 — File header (outside fenced block):**

```
# /goal G-PLANNER-2 — saved prompt
> Saved 2026-07-05. Drives the Planner product track. Output = PLANNER_V2_PLAN.md (plan
> document, not code). Brutal-critic pass mandatory — gates COMPLETE-WHEN. Re-run: paste
> the fenced block below into a Claude session with cwd C:/Users/mhsut/DevProjects/ces.
> Does not supersede any prior goal.
```

---

**Part 2A — COMPLETE-WHEN sentence (first line inside fenced block):**

> `/goal G-PLANNER-2 COMPLETE WHEN ces-planner/docs/PLANNER_V2_PLAN.md exists, is builder-actionable (a dev team can sequence v2 sprints from it without a clarifying call), the architecture decision (extend ces-planner/ vs. standalone Muster repo) is stated with explicit rationale and is not "TBD," all three operating modes carry a per-mode BHD-touch budget expressed as a number, and a brutal-critic pass has been recorded in the document with verdict PASS or FAIL-then-fixed.`

---

**Part 2B — CONTEXT block (self-contained — executor must not derive these from external files):**

Embed in this order:

1. The three v2 characteristics (embed verbatim):
   - Same domain knowledge, same end state, same deliverables — v2 outputs existing deliverables exactly the same way (same AJV schemas, same export formats).
   - Adds supply-chain-readiness / readiness-evaluation functions: engagement kind (Prime-and-Subs vs. Individual-Contractor); contracts involved + tracked contract details; subs roster; sub POC; sub status; sub management support.
   - BIG driver: minimize human touch across three operating modes — (a) client operates evaluation activities independently; (b) BHD assists in a live session with minimized need for it; (c) chat-first coaching escalating to live.

2. Deliverables to preserve exactly — embed this list verbatim in the goal text (do NOT point to a VAULT section; the list below is the authoritative source for the goal):
   - SI Baseline (`ces-planner/src/features/sit/services/baselineGenerator.ts`)
   - CUI Boundary (`ces-planner/src/features/cui/services/cuiBoundaryGenerator.ts`)
   - BTC output (`ces-planner/src/features/btc/services/btcOutputGenerator.ts`)
   - TCP profile (`ces-planner/src/features/tcp/services/tcpProfileGenerator.ts`)
   - Policy Inputs profile (`ces-planner/src/features/policy/services/policyProfileGenerator.ts`)
   - RR Question Set + Readiness Posture (`ces-planner/src/features/rrt/services/bulkAnswerDerivation.ts`, `rrt/services/postureGenerator.ts`)
   - Manual Plan, Exec Plan, Proposal, Tenant Manifest, Infrastructure Manifest, policy DOCX documents (`ces-planner/src/features/mpt/services/manualPlanGenerator.ts`, `proposalGenerator.ts`, `manifestGenerator.ts`, `infraManifestGenerator.ts`, `policyRenderer.ts`, `policyDocxExporter.ts`)
   - Customer TCO report (`ces-planner/src/features/cost-estimator/services/tenantCost.ts`)

3. SCRE prior-art reading list — instruct the executor to read these six files read-only before producing the plan:
   - `C:/Users/mhsut/DevProjects/scre/SCRE-Approach-Decision-Summary.md`
   - `C:/Users/mhsut/DevProjects/scre/BHD-SCRE-UseCases-DomainModel.md`
   - `C:/Users/mhsut/DevProjects/scre/BHD-SCRE-Engagement-Flow.md`
   - `C:/Users/mhsut/DevProjects/scre/BHD-Planner-as-SCRE.md`
   - `C:/Users/mhsut/DevProjects/scre/SCRE-Build-Plan.md`
   - `C:/Users/mhsut/DevProjects/scre/SCRE-Data-Collection-Goal.md`

4. Pricing guardrails (embed summary; point to `ces-strategy/pricing/PRICING_CONTEXT.md` for full detail): SCRE tiers (assess → enclave → annuity); CRS posture-memo is not the CYT gap report and does not substitute for it; LOE is assisted-not-automatic; two-rate labor: $150/hr floor (COGS, never quoted) vs. $200/hr billing (`ces-planner/src/shared/types/loeRates.ts`).

5. Architecture tension: `SCRE-Build-Plan.md §1` chose a standalone `scre-muster/` repo; this goal frames v2 as a ces-planner version — the plan must resolve this explicitly; not "TBD."

---

**Part 2C — READINESS-EVALUATION FUNCTIONS section (inside fenced block):**

- **Intake mechanism (required):** The plan must define HOW engagement kind is determined at session start — the mechanism (intake question, branch logic, or profile field) must be specified. All seven readiness functions (engagement kind, contracts involved, contract details, subs roster, sub POC, sub status, sub management) are gated on this intake result. A plan that plans the seven functions without specifying the intake gate fails DONE-WHEN #4.

- Engagement kind: Prime-and-Subs (has sub roster, sub POC, sub status, sub management) vs. Individual-Contractor (single-entity assessment, no subs). Both are first-class flows — Individual-Contractor is not a degenerate Prime-and-Subs case.

- Contract entity (net-new — SCRE domain model has `programs[]` and `value_at_risk` but no Contract node): plan must define this entity. Minimum fields: contract number, award date, performance period start/end, party CAGE/UEI, applicable DFARS clauses, status. Relationship to Engagement and Prime must be modeled.

- Subs roster / sub POC / sub status / sub management: plan maps each to a named SCRE entity field (Sub, Contact, TriageResult, SubReadinessRecord) or proposes a new field with justification. "Sub management" means the ability to track and act on sub status changes — must distinguish read-only roster from writable management.

---

**Part 2C — MINIMAL-TOUCH OPERATING MODES section (inside fenced block):**

Numbers required for all three modes. Adjectives ("minimal," "low") are not acceptable.

- **Mode (a) client-independent:** BHD-touch budget = 0 hours post-onboarding per assessment cycle. Plan names the enabling feature set: self-service hosting, auth, built-in guidance rails, no phone/email loop required. Note: current Planner is single-browser/IndexedDB; mode (a) implies multi-party access and therefore a backend or hosted solution.

- **Mode (b) live-session assist:** BHD-touch budget per sub = ≤ N hours `[validate with BHD]`. Specific BHD tasks enumerated vs. self-serve remainder. Concierge tooling requirements called out; reference `SCRE-LiveCall-Dashboard.html` in the scre repo.

- **Mode (c) chat-first coaching escalating to live:** BHD-touch budget per escalation instance = ≤ N hours `[validate with BHD]`. LLM/Claude API dependency must be declared explicitly (connectivity required; current Planner is offline — this is a breaking change in deployment model). HIL escalation rule: low-confidence/high-weight answers auto-route to a BHD advisor per SCRE Approach B Provisional HIL; escalation threshold stated as a specific condition (not "low confidence"). Offline fallback: plan describes in ≥ 1 sentence the trigger condition that activates the fallback, the degraded-mode behavior available to the sub, and the resync path when connectivity is restored. Do not hard-code A+B source ordering without restating the >~30% on-prem trigger for Approach C.

---

**Part 2C — ARCHITECTURE DECISION section (inside fenced block):**

The plan must choose one option and provide rationale. This plan does not pre-choose.

- Option A: Extend `ces-planner/` — supply-chain entities and a backend added to the existing SPA.
- Option B: `ces-planner/` assessment spine becomes a library vendored by a new `scre-muster/` repo; build spine (TCP/MPT/Stamper) stays in ces-planner.
- Option C: Muster supersedes both; ces-planner archived; assessment spine migrated wholesale.

Required rationale inputs: offline/single-browser constraint (`ces-planner/CLAUDE.md`), multi-tenancy gap (`BHD-Planner-as-SCRE.md §5`), Planner-as-SCRE assessment/build spine split, Muster Phase 0 not-started status.

---

**Part 2D — DONE-WHEN (14 items, all must hold):**

1. Architecture option (A/B/C) stated with rationale — not "TBD."
2. Persistence/backend strategy named (what technology, who builds it, which phase) to enable multi-party sub roster access; or explicit argument that offline is sufficient with stated constraints.
3. Contract entity defined: ≥ 6 fields listed; relationship to Engagement and Prime described in prose or diagram.
4. Both engagement kinds (Prime-and-Subs, Individual-Contractor) planned as distinct first-class flows, AND the session-start intake mechanism (question/branch/profile field) that gates all seven readiness functions is specified.
5. Subs roster, sub POC, sub status, and sub management each mapped to a named entity field or a new field with justification.
6. Deliverable preservation per artifact, by name — citing the embedded list in the CONTEXT block (not a VAULT section): SI Baseline, CUI Boundary, BTC output, TCP profile, Policy Inputs profile, RR Question Set, Readiness Posture, Manual Plan, Exec Plan, Proposal, Tenant Manifest, Infrastructure Manifest, policy DOCX documents, TCO report — each with "AJV schema unchanged / export format unchanged" as the preservation bar.
7. Mode (a) BHD-touch budget is a number (0 hours post-onboarding per cycle); enabling feature set named.
8. Mode (b) BHD-touch budget per sub is a number `[validate with BHD]`; BHD-specific tasks enumerated vs. self-serve remainder.
9. Mode (c): BHD-touch budget per escalation instance is a number `[validate with BHD]`; LLM/connectivity dependency declared; HIL escalation threshold stated as a specific condition; offline fallback described with trigger condition, degraded-mode behavior, and resync path (≥ 1 sentence each).
10. Build phasing: ≥ 2 phases with explicit scope boundaries and a go/no-go gate per phase.
11. Pricing alignment: plan contains ≥ 1 sentence restating the CRS/SCRE boundary (posture memo ≠ CYT gap report, not quote-bindable); plan labels LOE "assisted-not-automatic" in ≥ 1 explicit statement; plan names all three SCRE tiers (assess / enclave / annuity) by name.
12. Risks and open questions: covers LLM connectivity (mode c), multi-tenancy path, SCRE score weight status (directional/unvalidated), >~30% on-prem trigger for Approach C promotion.
13. Brutal-critic verdict recorded in the plan document: PASS or FAIL-then-fixed; if FAIL, each defect numbered and resolved before COMPLETE-WHEN.
14. All BHD business assumptions labeled `[validate with BHD]`; verifier checks against this minimum enumeration: (a) mode (a) touch budget (0 hours — is this a firm commitment?), (b) mode (b) touch budget per sub, (c) mode (c) touch budget per escalation instance, (d) HIL escalation threshold criteria, (e) sub-status taxonomy (what status values are defined), (f) contract-detail field set (are the 6+ fields complete?), (g) chat-coaching tooling (what LLM, what interface). Count of `[validate with BHD]` tags in the plan document must cover all seven.

---

**Part 2E — BRUTAL CRITIC PASS section (mandatory — gates COMPLETE-WHEN):**

Critic attacks three targets, in order:

- **Simplicity:** Could any new entity collapse into an existing SCRE entity without loss? Is any proposed build phase redundant given what Muster Phase 0 would cover? Does mode (c) duplicate mode (b) in scope — if so, merge or clearly separate them.
- **Accuracy:** Does the plan claim any capability the current Planner lacks (backend persistence, LLM in offline mode, auto-LOE computation)? Are SCRE A/B/C source weights labeled directional and unvalidated? Does the on-prem trigger for Approach C (>~30%) appear?
- **Robustness:** Does the plan survive (a) Approach C being promoted if >30% of subs carry CUI on on-prem/OT, (b) Muster being built independently by another team before v2 ships, (c) Individual-Contractor becoming the majority engagement kind?

Verdict gate: critic writes PASS (plan is builder-actionable, no unsupported claims) or FAIL (each defect numbered). A FAIL verdict blocks COMPLETE-WHEN until the executor fixes the plan and the critic re-runs to PASS.

---

**Part 2F — OUTPUT & CONSTRAINTS section:**

- Output file: `ces-planner/docs/PLANNER_V2_PLAN.md` (does NOT exist — create; future re-runs reconcile in place, do not overwrite).
- NO code changes. All grounding is read-only against `ces-planner/`, `scre/`, and `ces-strategy/pricing/` files.
- Label every BHD business assumption `[validate with BHD]` at point of use.
- End `PLANNER_V2_PLAN.md` with an open-questions list of ≥ 5 questions.

---

## File Inventory

| File | Action | Lines/Functions Affected |
|------|--------|--------------------------|
| `ces-planner/docs/_goal-planner-v2.md` | CREATE | All — single new goal file |

## Architecture Decisions

- **Goal file path:** `ces-planner/docs/_goal-planner-v2.md` — the output plan (`PLANNER_V2_PLAN.md`) lives in `ces-planner/docs/`; house convention is goal-beside-outputs, so the goal file belongs in the same directory. This rationale is self-contained and does not depend on any external context file.
- **Goal ID:** `G-PLANNER-2`.
- **Architecture option not pre-chosen:** the goal requires the plan to choose A/B/C with rationale. The Muster/ces-planner decision belongs to the plan document's executor, not to this goal-authoring step.
- **Minimal-touch encoding:** numbers (hours, thresholds, specific conditions) are required in all three mode DONE-WHEN items — adjectives are not testable. BHD-specific numbers tagged `[validate with BHD]`.
- **Deliverable preservation bar:** "AJV schema unchanged / export format unchanged" is the testable definition of "byte-for-byte in spirit." The deliverables list is embedded verbatim in Part 2B item 2 so the goal file is self-contained — DONE-WHEN #6 cites that embedded list, never a VAULT section.
- **Offline fallback minimum content:** trigger condition + degraded-mode behavior + resync path (≥ 1 sentence each) — required so "fallback named" is not satisfied by a single label.

## Testing Strategy
- After writing, confirm the fenced code block is a single unbroken block (no accidental triple-backtick inside the prompt body).
- Confirm the file header blockquote is outside, not inside, the fenced block.

## Out of Scope
- Writing `ces-planner/docs/PLANNER_V2_PLAN.md` — that is what running the goal does.
- Modifying any existing ces-planner source, ces-strategy, scre, or pricing files.
- Pre-choosing the architecture option (A/B/C).
- Session log or index artifacts.
- The pricing dashboard (`ces-strategy/pricing/ces-pricing-dashboard.html`) — not touched.

## Acceptance Criteria
- [ ] Executor verifies all six SCRE absolute paths exist before writing — if any path is missing, executor stops and reports which are missing; does not write the goal file.
- [ ] `ces-planner/docs/_goal-planner-v2.md` created; house style: file header + blockquote provenance + single fenced block containing the full prompt.
- [ ] COMPLETE-WHEN is a single sentence with a usability bar and four testable gates; all three modes are explicitly named as requiring a numerical touch budget.
- [ ] CONTEXT block contains the deliverables list verbatim (14 artifacts, each with feature-path parenthetical) — does NOT say "copy from VAULT"; the list is self-contained.
- [ ] DONE-WHEN has exactly 14 numbered items; every item is independently checkable without judgment.
- [ ] DONE-WHEN #4 requires both the distinct first-class flows AND the session-start intake mechanism that gates the seven readiness functions.
- [ ] DONE-WHEN #6 cites "the embedded list in the CONTEXT block" — not a VAULT section.
- [ ] DONE-WHEN #9 contains a numerical budget for mode (c) and specifies offline fallback with three components (trigger / behavior / resync).
- [ ] DONE-WHEN #11 states three concrete content bars (boundary sentence count ≥ 1, LOE label present, tier names enumerated).
- [ ] DONE-WHEN #14 enumerates ≥ 7 named assumptions verifier must find tagged.
- [ ] Architecture decision section requires explicit A/B/C choice with named rationale inputs — not left open.
- [ ] Brutal-critic section names three attack targets and specifies the PASS/FAIL verdict gate that blocks COMPLETE-WHEN.
- [ ] OUTPUT & CONSTRAINTS names both output file paths and states NO code changes.
- [ ] SCRE on-prem/>~30% trigger for Approach C appears in DONE-WHEN item 12 and in the critic's accuracy attack.
