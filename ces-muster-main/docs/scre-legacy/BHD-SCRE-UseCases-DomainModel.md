# SCRE Tool — Use Cases & Domain Object Model

**What the SCRE tool must do (use cases, derived by flowing the engagement) and the abstractions it operates on (domain object model).**
**Date:** June 10, 2026 · **Classification:** Internal — product/strategy
**Companion to:** `BHD-SCRE-Engagement-Flow.md`, `BHD-Assess-Subs-Build-Spec.md`, `BHD-Planner-as-SCRE.md`. Diagram: `mmd/scre-domain-model.svg`.

---

## Part 1 — Use cases (flowed through the engagement)

Actors: **BHD operator/admin**, **Prime** (program owner / CISO / procurement), **Sub** (owner / IT), **Channel** (Carahsoft/ValorForge), **Assessor** (downstream C3PAO — read-only). The tool must support, by phase:

### Phase 0–1 · Entry & setup
- **U1** Create an engagement for a prime (channel/BHD).
- **U2** Build the sub roster — import (CSV/CAGE/UEI) or discover the sub-tier from SAM sub-award + program data.
- **U3** Define scope: programs in scope, the prime's milestones, cadence (one-time vs. continuous).
- **U4** Set data rights, sub-consent model, and enrollment posture (mandate / sponsor / endorse / self-pay).
- **U5** Manage contacts (prime-side and sub-side).

### Phase 2 · Triage & routing
- **U6** Run zero-touch triage per sub (detect stack, cert claims, incident signals) — Cobalt Talon.
- **U7** Assign **lane** (authored-stack → fast / not-yet-authored → manual) and **mode** (self-serve / concierge).
- **U8** Prioritize the cohort by contract-value-at-risk; group into assessment waves.

### Phase 3 · Per-sub assessment (CES Planner)
- **U9** Invite a sub (branded self-serve link) or schedule a concierge session.
- **U10** Capture scope-lite (target L2, CUI users, stack) + the 5-question preamble.
- **U11** Run Bulk Answer Derivation (authored stack) — auto-fill 60–80%; accept/override.
- **U12** Run guided deep-dive (any stack) — control-by-control where needed.
- **U13** Collect & attach evidence per control (with provenance/hash).
- **U14** Generate the Readiness Posture → SPRS-style score + ranked gap list.
- **U15** Save / resume an in-progress assessment; track completion status.
- **U16** Sub views its own result (score, top gaps, "what moves you up").

### Phase 4 · Roll-up & reporting
- **U17** Aggregate sub postures into the prime roll-up board (RAG by sub).
- **U18** Show the cohort family heatmap (systemic gaps across the tier).
- **U19** Rank a risk register weighted by contract value at risk.
- **U20** Overlay days-to-ready vs. the prime's program milestones.
- **U21** Prime drills into an individual sub's posture.
- **U22** Export PDF for program reviews; share a live board.

### Phase 5 · Disposition
- **U23** Mark a sub ready; schedule its re-assessment.
- **U24** Run a validation pass (BHD review + sample evidence) → upgrade the confidence rung.
- **U25** Offer/route a not-ready sub to enclave conversion (Tier 2) and track it.

### Phase 6 · Continuous assurance
- **U26** Schedule and run periodic re-assessment of the tier.
- **U27** Detect drift / regression; alert on new-red subs.
- **U28** Produce the prime's FCA "stay-current" status snapshot.
- **U29** Expand the cohort (add subs, next program/tier) — loops to setup.

### Cross-cutting
- **U30** Multi-tenant access control — prime sees only its tier; sub sees only itself; BHD sees all; assessor read-only.
- **U31** Manage vendor playbooks — author/add a stack (AWS GovCloud, Google Workspace, on-prem) to extend the fast lane.
- **U32** Maintain provenance, consent, and an audit log on every record.

---

## Part 2 — Domain object model

Four layers. The **Reference/Knowledge** layer is shared, vendor-pluggable, and read-only at runtime. The **Assessment** layer is the Planner artifact chain (reused). The **Program** and **Outcome** layers are SCRE-native.

### Layer A — SCRE Program (who & what is being assessed)

| Entity | Purpose | Key attributes | Relationships |
|---|---|---|---|
| **Prime** | The buyer/liability holder | name, UEI, CAGE, programs[] | 1 → * Engagement; 1 → * Contact |
| **Engagement** | One prime program of work | scope, cadence, data_rights, enrollment_posture, milestones[], status | belongs to Prime; 1 → * Sub, Cohort, RollUp |
| **Cohort / Wave** | A batch of subs assessed together | label, created, sub_ids[] | belongs to Engagement; * ↔ Sub |
| **Sub** | A subcontractor being assessed | name, UEI, CAGE, domain, declared_stack | in Engagement; 1 → 1 TriageResult; 1 → * Assessment |
| **TriageResult** | Zero-touch pre-screen | cloud_posture, certs[], signals, **lane**, **mode**, value_at_risk, confidence | belongs to Sub (Cobalt Talon) |
| **Contact** | A person on prime or sub side | name, role, email | belongs to Prime or Sub |

### Layer B — Assessment (CES Planner artifacts, per sub per run)

| Entity | Purpose | Key attributes | Relationships |
|---|---|---|---|
| **Assessment** | One run of Planner against a sub | method/rung, status, started/completed, planner_session_id, stack/lane | of Sub, in Engagement; produces the artifacts below |
| **SI Baseline (lite)** | Strategic intent / scope contract | target_level, cui_presence, deployment_posture, boundary_strategy | produced by Assessment; immutable; derives RR Question Set |
| **CUI Boundary** | CUI scope & who/what touches CUI | cui_types[], data_flows[], **cui_user_count**, device_model | produced by Assessment; feeds coefficient |
| **RR Question Set** | Scenario-specific interrogatory | derived_from SI Baseline, items[] | drives the deep-dive |
| **Readiness Posture** | The measured posture (the score) | per-requirement status (met/partial/not_met/unknown), evidence_index, key_findings, **sprs_score** | produced by Assessment; references CMMC Requirements; wrapped by SubReadinessRecord |
| **Evidence Item** | An artifact backing a control | type, source, hash_sha256, mapped_requirements[], provenance | collected during Assessment; indexed in Posture |

### Layer C — SCRE Outcomes & Reporting

| Entity | Purpose | Key attributes | Relationships |
|---|---|---|---|
| **SubReadinessRecord** | The canonical SCRE unit | sprs_score, score_pct, **rag**, control_rollup, method, confidence, assessed_at, next_due | wraps a Readiness Posture; 1 → * POAMItem, FamilyScore; 0 → 1 ValidationRecord; 1 → 1 Disposition |
| **FamilyScore** | Per-family readiness | family (AC…SI), objectives, met/partial/open, score, high_weight_open | belongs to SubReadinessRecord |
| **POAMItem** | A gap + remediation | control, objective, status, weight, gap, remediation, est_days | belongs to SubReadinessRecord |
| **ValidationRecord** | BHD validation pass (Rung 2) | reviewer, sampled_evidence[], outcome, upgraded_rung | of a SubReadinessRecord |
| **Disposition** | The decision on a sub | outcome (ready/validate/convert), next_action | of a SubReadinessRecord; 0 → 1 EnclaveConversion |
| **EnclaveConversion** | Bridge to Tier 2/3 (GCC High) | enclave_ref, status, evidenced_rung | of a Disposition; links to the enclave / EvidenceOps |
| **RollUp** | Prime-facing aggregate per run | run_seq, generated_at, cohort_stats, rag_distribution, family_heatmap, delta_vs_prev | of an Engagement; aggregates SubReadinessRecord[]; 1 → * RiskRegisterEntry |
| **RiskRegisterEntry** | Exposure ranking | sub_ref, value_at_risk, gap_index, priority | belongs to RollUp |
| **ReassessmentSchedule** | Cadence & next-due | cadence, next_due, last_run | of a Sub or Engagement |

### Layer D — Reference / Knowledge (shared, vendor-pluggable, read-only)

| Entity | Purpose | Notes |
|---|---|---|
| **CMMC Requirement** | The 110 L2 controls | id, family, weight (1/3/5), objectives[] |
| **Assessment Objective** | The 320 objectives | the grading rubric |
| **Control Family** | The 14 families | AC, AT, AU, CM, IA, IR, MA, MP, PS, PE, RA, CA, SC, SI |
| **Implementation Pattern** | Practice → capability → actions | vendor-neutral abstraction |
| **Capability** | Hierarchical capability taxonomy | classifies any vendor's capabilities |
| **Vendor Playbook** | Per-stack binding | signal (configure/customize/manual), service, implementation — **pluggable; only M365/GCC-High authored today** |
| **Evidence Archetype** | Canonical evidence types | with strength tiers |
| **Assessor Method / KB** | Verification methods | examine / interview / test per requirement |
| **Question Bank** | SI / RR / CUI / preamble banks | drives the wizards |

### Key relationships (cardinality summary)

- Prime **1—*** Engagement **1—*** Sub; Sub **1—1** TriageResult; Sub **1—*** Assessment (re-assessed over time).
- Assessment **produces 1—1** Readiness Posture (+ SI Baseline, CUI Boundary, RR Question Set) and **1—*** Evidence Item.
- Readiness Posture **1—1** SubReadinessRecord (wrapped + SPRS); SubReadinessRecord **1—*** POAMItem / FamilyScore, **0—1** ValidationRecord, **1—1** Disposition **0—1** EnclaveConversion.
- Engagement **1—*** RollUp; RollUp **aggregates *** SubReadinessRecord and **1—*** RiskRegisterEntry.
- Knowledge layer **drives** Assessment (derivation, scoring, evidence mapping); Readiness Posture **references** CMMC Requirement / Objective.

---

## Part 3 — Notes

- **Reuse vs. new.** Layer B (Assessment) is Planner's existing artifact chain — reused. Layers A, C are SCRE-native (the wrapper + reporting). Layer D is Planner's existing knowledge banks — reused, and the vendor-pluggable design is what lets the same model assess any stack.
- **The hinge object is `SubReadinessRecord`** — it wraps Planner's Readiness Posture and is what every SCRE report, disposition, and roll-up reads. Get its schema right (see build spec §2.2) and the rest composes.
- **GCC High appears only via `EnclaveConversion`** — the assessment/outcome model is stack-agnostic; the enclave is a downstream bridge, not a precondition.
- **Multi-tenancy is a first-class concern** (U30) — every Program/Outcome record is scoped to an Engagement and access-controlled by party (prime/sub/BHD/assessor).
