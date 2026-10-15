# /goal G-PLANNER-2 — saved prompt

> Saved 2026-07-05. **Amended 2026-07-05 (rev 2):** adds a mandatory HIL user-approval gate
> AFTER the brutal-critic PASS (the user approves the final plan — completion is blocked
> until explicit approval); sets lean default touch budgets (mode b ≤ 2 hrs/sub/cycle,
> mode c ≤ 30 min/escalation — user-selected 2026-07-05, still [validate with BHD]);
> architecture decision remains run-decided with rationale (user declined to pre-bias).
> Drives the Planner product track. Output = PLANNER_V2_PLAN.md (plan document, not code).
> Brutal-critic pass mandatory — gates COMPLETE-WHEN. Re-run: paste the fenced block below
> into a Claude session with cwd C:/Users/mhsut/DevProjects/ces.
> Does not supersede any prior goal.

```
/goal G-PLANNER-2 COMPLETE WHEN ces-planner/docs/PLANNER_V2_PLAN.md exists, is
builder-actionable (a dev team can sequence v2 sprints from it without a clarifying call),
the architecture decision (extend ces-planner/ vs. standalone Muster repo) is stated with
explicit rationale and is not "TBD," all three operating modes carry a per-mode BHD-touch
budget expressed as a number, a brutal-critic pass has been recorded in the document
with verdict PASS or FAIL-then-fixed, AND the user has explicitly approved the
post-critic plan (HIL gate — see DONE-WHEN #15; no approval, no completion).

CONTEXT (do not re-derive — verify against the repo, read-only):

1. The three Planner v2 characteristics (given — verbatim):
   - Same domain knowledge, same end state, same deliverables — v2 outputs existing
     deliverables exactly the same way (same AJV schemas, same export formats).
   - Adds supply-chain-readiness / readiness-evaluation functions: engagement kind
     (Prime-and-Subs vs. Individual-Contractor); contracts involved + tracked contract
     details; subs roster; sub POC; sub status; sub management support.
   - BIG driver: minimize human touch across three operating modes — (a) client operates
     evaluation activities independently; (b) BHD assists in a live session with minimized
     need for it; (c) chat-first coaching escalating to live.

2. Deliverables to preserve exactly (this list is the authoritative source for this goal —
   do not substitute any other inventory):
   - SI Baseline (`ces-planner/src/features/sit/services/baselineGenerator.ts`)
   - CUI Boundary (`ces-planner/src/features/cui/services/cuiBoundaryGenerator.ts`)
   - BTC output (`ces-planner/src/features/btc/services/btcOutputGenerator.ts`)
   - TCP profile (`ces-planner/src/features/tcp/services/tcpProfileGenerator.ts`)
   - Policy Inputs profile (`ces-planner/src/features/policy/services/policyProfileGenerator.ts`)
   - RR Question Set + Readiness Posture (`ces-planner/src/features/rrt/services/bulkAnswerDerivation.ts`,
     `ces-planner/src/features/rrt/services/postureGenerator.ts`)
   - Manual Plan, Exec Plan, Proposal, Tenant Manifest, Infrastructure Manifest, policy
     DOCX documents (`ces-planner/src/features/mpt/services/manualPlanGenerator.ts`,
     `ces-planner/src/features/mpt/services/proposalGenerator.ts`,
     `ces-planner/src/features/mpt/services/manifestGenerator.ts`,
     `ces-planner/src/features/mpt/services/infraManifestGenerator.ts`,
     `ces-planner/src/features/mpt/services/policyRenderer.ts`,
     `ces-planner/src/features/mpt/services/policyDocxExporter.ts`)
   - Customer TCO report (`ces-planner/src/features/cost-estimator/services/tenantCost.ts`)

3. SCRE prior art — read these six files read-only before producing the plan:
   - C:/Users/mhsut/DevProjects/scre/SCRE-Approach-Decision-Summary.md
   - C:/Users/mhsut/DevProjects/scre/BHD-SCRE-UseCases-DomainModel.md
   - C:/Users/mhsut/DevProjects/scre/BHD-SCRE-Engagement-Flow.md
   - C:/Users/mhsut/DevProjects/scre/BHD-Planner-as-SCRE.md
   - C:/Users/mhsut/DevProjects/scre/SCRE-Build-Plan.md
   - C:/Users/mhsut/DevProjects/scre/SCRE-Data-Collection-Goal.md

4. Pricing guardrails (summary here; full detail in `ces-strategy/pricing/PRICING_CONTEXT.md`):
   SCRE tiers are assess → enclave → annuity; the CRS posture memo is not the CYT gap
   report and does not substitute for it; LOE is assisted-not-automatic; two-rate labor:
   $150/hr floor (COGS, never quoted) vs. $200/hr billing
   (`ces-planner/src/shared/types/loeRates.ts`).

5. Architecture tension: `SCRE-Build-Plan.md §1` chose a standalone `scre-muster/` repo;
   this goal frames v2 as a ces-planner version — the plan must resolve this explicitly;
   not "TBD."

READINESS-EVALUATION FUNCTIONS TO PLAN (the net-new surface):

- Intake mechanism (required): the plan must define HOW engagement kind is determined at
  session start — the mechanism (intake question, branch logic, or profile field) must be
  specified. All seven readiness functions (engagement kind, contracts involved, contract
  details, subs roster, sub POC, sub status, sub management) are gated on this intake
  result. A plan that plans the seven functions without specifying the intake gate fails
  DONE-WHEN #4.
- Engagement kind: Prime-and-Subs (has sub roster, sub POC, sub status, sub management)
  vs. Individual-Contractor (single-entity assessment, no subs). Both are first-class
  flows — Individual-Contractor is not a degenerate Prime-and-Subs case.
- Contract entity (net-new — the SCRE domain model has `programs[]` and `value_at_risk`
  but no Contract node): the plan must define this entity. Minimum fields: contract
  number, award date, performance period start/end, party CAGE/UEI, applicable DFARS
  clauses, status. Relationship to Engagement and Prime must be modeled.
- Subs roster / sub POC / sub status / sub management: the plan maps each to a named SCRE
  entity field (Sub, Contact, TriageResult, SubReadinessRecord) or proposes a new field
  with justification. "Sub management" means the ability to track and act on sub status
  changes — the plan must distinguish read-only roster from writable management.

MINIMAL-TOUCH OPERATING MODES (the BIG driver):

Numbers are required for all three modes. Adjectives ("minimal," "low") are not acceptable.

- Mode (a) client-independent: BHD-touch budget = 0 hours post-onboarding per assessment
  cycle. The plan names the enabling feature set: self-service hosting, auth, built-in
  guidance rails, no phone/email loop required. Note: the current Planner is
  single-browser/IndexedDB; mode (a) implies multi-party access and therefore a backend
  or hosted solution.
- Mode (b) live-session assist: BHD-touch budget = ≤ 2 hours per sub per assessment cycle
  (user-selected lean default [validate with BHD]).
  Specific BHD tasks enumerated vs. the self-serve remainder. Concierge tooling
  requirements called out; reference `SCRE-LiveCall-Dashboard.html` in the scre repo.
- Mode (c) chat-first coaching escalating to live: BHD-touch budget = ≤ 30 minutes per
  escalation instance (user-selected lean default [validate with BHD]). The LLM/Claude API
  dependency must be declared
  explicitly (connectivity required; the current Planner is offline — this is a breaking
  change in deployment model). HIL escalation rule: low-confidence/high-weight answers
  auto-route to a BHD advisor per SCRE Approach B Provisional HIL; the escalation
  threshold must be stated as a specific condition (not "low confidence"). Offline
  fallback: the plan describes, in ≥ 1 sentence each, the trigger condition that activates
  the fallback, the degraded-mode behavior available to the sub, and the resync path when
  connectivity is restored. Do not hard-code A+B source ordering without restating the
  >~30% on-prem trigger for Approach C.

ARCHITECTURE DECISION THE PLAN MUST MAKE:

The plan must choose one option and provide rationale. This goal does not pre-choose.

- Option A: Extend `ces-planner/` — supply-chain entities and a backend added to the
  existing SPA.
- Option B: The `ces-planner/` assessment spine becomes a library vendored by a new
  `scre-muster/` repo; the build spine (TCP/MPT/Stamper) stays in ces-planner.
- Option C: Muster supersedes both; ces-planner archived; assessment spine migrated
  wholesale.

Required rationale inputs: the offline/single-browser constraint (`ces-planner/CLAUDE.md`),
the multi-tenancy gap (`BHD-Planner-as-SCRE.md §5`), the Planner-as-SCRE assessment/build
spine split, and Muster's Phase-0-not-started status.

DONE-WHEN (all must hold):

1. Architecture option (A/B/C) stated with rationale — not "TBD" — including a
   plain-language "build a new planner vs. extend the existing planner, and why" statement
   a co-founder can follow without reading the options' definitions.
2. Persistence/backend strategy named (what technology, who builds it, which phase) to
   enable multi-party sub roster access; or an explicit argument that offline is
   sufficient with stated constraints.
3. Contract entity defined: ≥ 6 fields listed; relationship to Engagement and Prime
   described in prose or diagram.
4. Both engagement kinds (Prime-and-Subs, Individual-Contractor) planned as distinct
   first-class flows, AND the session-start intake mechanism (question/branch/profile
   field) that gates all seven readiness functions is specified.
5. Subs roster, sub POC, sub status, and sub management each mapped to a named entity
   field or a new field with justification.
6. Deliverable preservation per artifact, by name — citing the embedded list in the
   CONTEXT block above (not any external inventory): SI Baseline, CUI Boundary, BTC
   output, TCP profile, Policy Inputs profile, RR Question Set, Readiness Posture, Manual
   Plan, Exec Plan, Proposal, Tenant Manifest, Infrastructure Manifest, policy DOCX
   documents, TCO report — each with "AJV schema unchanged / export format unchanged" as
   the preservation bar.
7. Mode (a) BHD-touch budget is a number (0 hours post-onboarding per cycle); enabling
   feature set named.
8. Mode (b) BHD-touch budget per sub is a number (default ≤ 2 hrs/sub/cycle
   [validate with BHD]); ≥ 3 BHD-specific tasks enumerated vs. the self-serve remainder.
9. Mode (c): BHD-touch budget per escalation instance is a number (default ≤ 30
   min/escalation [validate with BHD]);
   LLM/connectivity dependency declared; HIL escalation threshold stated as a specific
   condition; offline fallback described with trigger condition, degraded-mode behavior,
   and resync path (≥ 1 sentence each).
10. Build phasing: ≥ 2 phases with explicit scope boundaries and a go/no-go gate per phase.
11. Pricing alignment: the plan contains ≥ 1 sentence restating the CRS/SCRE boundary
    (posture memo ≠ CYT gap report, not quote-bindable); the plan labels LOE
    "assisted-not-automatic" in ≥ 1 explicit statement; the plan names all three SCRE
    tiers (assess / enclave / annuity) by name.
12. Risks and open questions: covers LLM connectivity (mode c), the multi-tenancy path,
    SCRE score weight status (directional/unvalidated), and the >~30% on-prem trigger for
    Approach C promotion.
13. Brutal-critic verdict recorded in the plan document: PASS or FAIL-then-fixed; if FAIL,
    each defect numbered and resolved before COMPLETE-WHEN. The critic must be run as a
    separate critic agent or separate session — the plan executor may not self-certify PASS.
14. All BHD business assumptions labeled [validate with BHD]; the verifier checks against
    this minimum enumeration: (a) mode (a) touch budget (0 hours — is this a firm
    commitment?), (b) mode (b) touch budget per sub, (c) mode (c) touch budget per
    escalation instance, (d) HIL escalation threshold criteria, (e) sub-status taxonomy
    (what status values are defined), (f) contract-detail field set (are the 6+ fields
    complete?), (g) chat-coaching tooling (what LLM, what interface). The count of
    [validate with BHD] tags in the plan document must cover all seven.
15. HIL user-approval gate (mandatory, LAST): after the brutal critic records PASS, STOP
    and present the plan to the user for approval — a summary of the architecture decision
    (build-new vs. extend, and why), the three touch budgets, and the build phasing, plus
    the critic's verdict. The goal COMPLETES only on explicit user approval. If the user
    requests changes: apply them, re-run the critic to PASS, re-present. Never mark this
    goal complete on the critic's PASS alone.

BRUTAL CRITIC PASS (mandatory — gates COMPLETE-WHEN, but does NOT complete the goal —
DONE-WHEN #15 user approval is the final gate):

The critic attacks three targets, in order:

- Simplicity: could any new entity collapse into an existing SCRE entity without loss? Is
  any proposed build phase redundant given what Muster Phase 0 would cover? Does mode (c)
  duplicate mode (b) in scope — if so, merge or clearly separate them.
- Accuracy: does the plan claim any capability the current Planner lacks (backend
  persistence, LLM in offline mode, auto-LOE computation)? Are SCRE A/B/C source weights
  labeled directional and unvalidated? Does the on-prem trigger for Approach C (>~30%)
  appear?
- Robustness: does the plan survive (a) Approach C being promoted if >30% of subs carry
  CUI on on-prem/OT, (b) Muster being built independently by another team before v2
  ships, (c) Individual-Contractor becoming the majority engagement kind?

Verdict gate: the critic writes PASS (plan is builder-actionable, no unsupported claims)
or FAIL (each defect numbered). A FAIL verdict blocks COMPLETE-WHEN until the executor
fixes the plan and the critic re-runs to PASS.

OUTPUT & CONSTRAINTS:

- This goal file: `ces-planner/docs/_goal-planner-v2.md` (already EXISTS — do not modify
  when running this goal).
- Output file: `ces-planner/docs/PLANNER_V2_PLAN.md` (does NOT exist — create; future
  re-runs reconcile in place, do not overwrite).
- NO code changes. All grounding is read-only against `ces-planner/`,
  `C:/Users/mhsut/DevProjects/scre/`, and `ces-strategy/pricing/` files.
- Label every BHD business assumption [validate with BHD] at point of use.
- End PLANNER_V2_PLAN.md with an open-questions list of ≥ 5 questions.
```
