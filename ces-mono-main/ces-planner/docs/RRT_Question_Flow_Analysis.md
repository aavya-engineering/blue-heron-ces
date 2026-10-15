# RRT Readiness Recon Tool Flow Analysis

**Generated:** 2026-03-30 | **Source:** CES-FE v1.0.0 codebase trace

---

## Overview

The Readiness Recon Tool (RRT) is the second tool in the CES workflow pipeline. It encompasses two sub-pipelines:

1. **RR Question Set Generation** (runs during SIT, outputs a scenario-specific question set)
2. **Readiness Posture Creation** (runs during RRT wizard, outputs the posture artifact)

The RR Question Bank contains **165 activities** (3 universal + 17 L1 + 110 L2 + 35 L3) spanning all 14 CMMC domains. The question set generator extracts a **scenario profile** from **11 SI baseline fields** and applies **10 heuristic rules** plus YAML-declared applicability blocks and CUI domain boosting to produce a filtered, prioritized question set. The RRT wizard then presents a **4-phase flow** (preamble, bulk review, deep dive, posture review) that derives action statuses from **5 preamble questions**, a **6-step cascade**, and optional advisor overrides before generating the Readiness Posture artifact.

The Readiness Posture is consumed by **8 downstream systems**: gap compiler, control disposition builder, manual plan generator, proposal generator, policy context compiler, control assessment report generator, traceability report (via plan helpers), and export rendering.

---

## Part 1: RR Question Set Generation

### 1. Question Bank Structure

**File:** `public/data/primed RR Question Bank.yaml` (10,660 lines)

The question bank is organized into two tiers:

| Tier | Section | Activity Count | Description |
|------|---------|:--------------:|-------------|
| Universal | `ces.activity_bank.universal` | 3 | Foundation activities: boundary definition, data flow documentation, SSP confirmation |
| L1 | `ces.activity_bank.level_specific.L1` | 17 | One activity per L1 practice (FAR 52.204-21 basic safeguarding) |
| L2 | `ces.activity_bank.level_specific.L2` | 110 | One activity per L2 practice (NIST SP 800-171 Rev 2) |
| L3 | `ces.activity_bank.level_specific.L3` | 35 | One activity per L3 practice (NIST SP 800-172 enhanced) |
| **Total** | | **165** | |

Each activity has:

| Field | Purpose |
|-------|---------|
| `id` | Unique ID (e.g., `RR-ACT-AC_L1_3_1_1`) |
| `name` | Practice reference + title (e.g., "AC.L1-3.1.1 — Authorized") |
| `applies_to_levels` | Array of CMMC levels where applicable (`[L1, L2, L3]`) |
| `produces_rrt_fields` | RRT field paths populated by this activity |
| `mapped_requirements` | CMMC requirement IDs (e.g., `AC.L1-3.1.1`) or `FOUNDATION` |
| `expected_evidence_archetypes` | Evidence matrix IDs and assessor methods |
| `evidence_requests` | Detailed evidence guidance (acceptable forms, collection method, retention notes) |
| `assessor_methods` | Methods: examine, interview, test |
| `steps` | Step-by-step guidance for the advisor |
| `outputs` | Status enum patterns (e.g., `status = implemented | partial | not_implemented | not_applicable`) |
| `advisor_description` | Advisor guidance text |
| `advisor_reason_rrt` | Why this matters for the assessment |
| `advisor_cmmc_impact` | Impact of incorrect answers |
| `applicability` | Optional YAML block with `excludes`, `requires_any`, `boost_when` conditions |

**Source:** `public/data/primed RR Question Bank.yaml`

---

### 2. Question Set Generator

**File:** `src/features/sit/services/questionSetGenerator.ts` (1,018 lines)

The generator runs during SIT baseline generation and produces the `CES_RR_QUESTION_SET` artifact.

#### 2.1 Scenario Profile Extraction

The `extractScenarioProfile()` function reads **11 SI baseline fields** into a flat profile:

| # | SI Field Path | Profile Key | Type |
|---|---------------|-------------|------|
| 1 | `si_baseline.target.target_cmmc_level` | `target_cmmc_level` | string |
| 2 | `si_baseline.target.cui_presence` | `cui_presence` | string |
| 3 | `si_baseline.scope.deployment_posture` | `deployment_posture` | string |
| 4 | `si_baseline.scope.boundary_strategy` | `boundary_strategy` | string |
| 5 | `si_baseline.operations.byod_posture` | `byod_posture` | string |
| 6 | `si_baseline.operations.collaboration_mode` | `collaboration_mode` | string |
| 7 | `si_baseline.evidence.evidence_posture_target` | `evidence_posture_target` | string |
| 8 | `si_baseline.assessment.assessment_route` | `assessment_route` | string |
| 9 | `si_baseline.dependencies.tenant_model_preference` | `tenant_model_preference` | string |
| 10 | `si_baseline.risk_acceptance.poam_policy_intent` | `poam_policy_intent` | string |
| 11 | `si_baseline.operations.devops_touches_cui` | `devops_touches_cui` | boolean |

**Source:** `questionSetGenerator.ts` lines 30-45

#### 2.2 Activity Filtering Pipeline

Activities pass through three gates in order:

**Gate 1: CMMC Level Filter**
- Activities must include the target level in `applies_to_levels`
- Legacy `applicability.min_level` is also checked
- L1 targets only see L1 activities; L2 targets see L1+L2; L3 targets see L1+L2+L3

**Gate 2: YAML Explicit Applicability**
- `applicability.excludes`: If any condition matches the profile, the activity is excluded
- `applicability.requires_any`: If present and no conditions match, the activity is excluded
- `applicability.boost_when`: Matching conditions add +5 priority boost per match

**Gate 3: Heuristic Applicability Rules (10 rules)**

| # | Rule ID | SI Field | Condition | Effect |
|---|---------|----------|-----------|--------|
| 1 | `CUI_IN_NAME` | `cui_presence` | Activity name contains "cui" AND `no_cui` | **Exclude** |
| 2 | `MOBILE_DEVICE` | `byod_posture` | NIST 3.1.18/3.1.19 or name contains "mobile device" AND `not_allowed` | **Exclude** |
| 3 | `L2_CUI_ASSUMPTION` | `cui_presence` | L2-only activity AND `no_cui` or `fci_only` | **Exclude** |
| 4 | `REMOTE_ACCESS` | `deployment_posture` | NIST 3.1.12/3.1.14/3.1.15 or name contains "remote access" AND `cloud_only` or `hybrid` | **Boost +10** |
| 5 | `AUDIT_BOOST` | `evidence_posture_target` | AU domain AND `c3pao_ready` or `continuous_compliance` | **Boost +5** |
| 6 | `CA_CERTIFICATION` | `assessment_route` | CA domain AND `certification` | **Boost +5** |
| 7 | `CRYPTO_TENANT` | `tenant_model_preference` | NIST 3.13.10/3.13.11 AND `gcc_high`/`dod_il5`/`dod_il6` | **Boost +5** |
| 8 | `PS_CUI` | `cui_presence` | PS domain L2+ AND `no_cui` | **Exclude** |
| 9 | `IR_CERTIFICATION` | `assessment_route` | IR domain AND `certification` | **Boost +3** |
| 10 | `MULTI_ENCLAVE_BOOST` | `boundary_strategy` | UNIV-BOUNDARY or UNIV-DATAFLOW AND `multiple_enclaves`/`hybrid_boundary` | **Boost +5** |

**CUI Domain Boost** (step 3 in `evaluateApplicability`):
When a CUI boundary exists, activities whose CMMC domain matches a primary CUI boundary domain (via `CUI_DOMAIN_MAP`) receive **+8 priority boost**.

**Source:** `questionSetGenerator.ts` lines 63-302

#### 2.3 Question Generation

After filtering and boosting, activities are sorted by descending priority boost. Each activity becomes a single schema question with:

- `question_id` = activity ID
- `prompt` derived from: (1) requirements store `requirement_text`, (2) assessor KB `assessor_intent`, (3) activity title, (4) `advisor_description`
- `answer_type` derived from: (1) explicit `answer_type`, (2) outputs patterns, (3) `produces_rrt_fields` suffixes, (4) FOUNDATION check, (5) default `enum`
- `enum_values` derived from: (1) explicit values, (2) parsed output strings, (3) default `[implemented, partial, not_implemented, not_applicable]`
- `evidence_requests` normalized from bank data
- `advisor_reason_rrt` and `advisor_cmmc_impact` from bank or requirements store fallback

#### 2.4 Output Structure (RRQuestionSet)

```
{
  ces: {
    artifact: "CES_RR_QUESTION_SET",
    version: "1.0.0",
    generated_on: ISO datetime,
    intent: string,
    inputs: {
      si_baseline_ref: ArtifactRef,
      rrt_bank_ref: ArtifactRef,
      cmmc_requirements_ref: ArtifactRef,
      assessor_evidence_matrix_ref: ArtifactRef,
      assessor_approach_ref: ArtifactRef,
      vendor_capabilities_ref: ArtifactRef,
    },
    scenario: { scenario_id, tags[], derivation_rules_version },
    selection: {
      selected_activity_ids: string[],
      excluded_activity_ids: { activity_id, reason }[],
    },
    questions: RRSchemaQuestion[],
    coverage: {
      requirements_covered: string[],
      requirements_missing: { requirement_id, reason }[],
    },
  }
}
```

**Source:** `questionSetGenerator.ts` lines 312-489

---

## Part 2: RRT Wizard & Answer Collection

### 3. Wizard Architecture

**File:** `src/features/rrt/components/RRTWizard.tsx` (491 lines)

The RRT wizard operates in **4 phases**, tracked by `wizardPhase` in the RRT store:

| Phase | Component | Description |
|-------|-----------|-------------|
| `preamble` | `RRTPreamble` | 5 high-level intake questions about the tenant environment |
| `review` | `BulkReviewTable` | Review/override derived action statuses (grouped by capability) |
| `posture_review` | `PostureReview` | Review generated Readiness Posture before saving |
| `deep_dive` | `RRQuestionPage` | Question-by-question assessment (optional after review) |

### 4. Preamble Questions

**File:** `src/features/rrt/components/RRTPreamble.tsx`

| # | ID | Title | Type | Options |
|---|-----|-------|------|---------|
| 1 | `license_tier` | Microsoft 365 License Tier | enum | e3, e5, business_premium, gcc_g3, gcc_g5, unknown |
| 2 | `security_archetype` | Current Security Posture | enum | greenfield, security_defaults_only, basic_ca_policies, moderate_hardening, managed_by_msp |
| 3 | `endpoint_management` | Endpoint Management | enum | intune_enrolled, third_party_mdm, mixed, unmanaged |
| 4 | `monitoring_siem` | Security Monitoring & SIEM | enum | sentinel_deployed, third_party_siem, basic_m365_audit, none |
| 5 | `policy_doc_state` | Policy & Documentation State | enum | ssp_with_policies, some_policies_drafted, nothing_written |

**"New Tenant" defaults:** `license_tier: unknown`, `security_archetype: greenfield`, `endpoint_management: unmanaged`, `monitoring_siem: none`, `policy_doc_state: nothing_written`

**SI Baseline context:** The preamble displays `target_cmmc_level`, `deployment_posture`, and `tenant_model` as badges for advisor reference.

---

### 5. Bulk Answer Derivation (6-Step Cascade)

**File:** `src/features/rrt/services/bulkAnswerDerivation.ts` (527 lines)

The `deriveActionStatuses()` function processes every implementation action from the Implementation Patterns + Vendor Playbook data, applying a **6-step cascade** where the first matching rule wins.

#### 5.1 Input Data Sources

| Source | Description |
|--------|-------------|
| `ImplementationPatterns` | CMMC practices with implementation actions |
| `VendorPlaybook` | M365 service mappings, signal types (configure/customize/manual), inherent flags |
| `PreambleAnswers` | 5 preamble responses |
| `SIBaseline` | Full SI baseline for scope/CUI/deployment checks |
| `TechRefIndex` | E5 service gating and CSP-managed control lookup |
| `BTCRiskFlags` | BTC confirmation risk flags (if available) |

#### 5.2 Cascade Rules

| Step | Rule | Derivation Source | Condition | Result |
|------|------|-------------------|-----------|--------|
| 1 | **License gate** | `license_gate` | E5-required service but license is not E5/GCC-G5 | `not_applicable` |
| 2a | **Scope gate (level)** | `scope_gate` | Practice level exceeds target CMMC level | `not_applicable` |
| 2b | **Scope gate (CUI)** | `scope_gate` | No CUI + L2+ practice in MP/SC/SI domain | `not_applicable` |
| 3 | **Inherent check** | `inherent` | Playbook marks capability as inherent to platform | `implemented` |
| 4a | **SI override (cloud)** | `si_override` | Cloud-only deployment + PE domain | `not_applicable` |
| 4b | **SI override (CSP)** | `inherent` | Tech ref marks practice as CSP-managed | `implemented` |
| 4c | **SI override (BYOD)** | `si_override` | BYOD not allowed + mobile action | `not_applicable` |
| 4.5 | **BTC risk flag gate** | `btc_risk_flag` | High/critical BTC flag matching domain | `partial` (downgrade) |
| 5 | **Preamble overrides** | `preamble_override` | Endpoint/monitoring/policy capability match | Status based on preamble answer |
| 6 | **Archetype default** | `archetype_default` | Fallback based on security archetype + signal type | Status from archetype matrix |

#### 5.3 E5-Required Services

```
Microsoft Sentinel, Microsoft Defender for Endpoint P2,
Microsoft Defender for Identity, Microsoft Purview DLP,
Microsoft Purview Information Protection, Privileged Identity Management,
Azure AD Identity Protection, Entra ID Protection,
Defender for Cloud Apps, Microsoft Defender for Office 365 P2
```

#### 5.4 Archetype Defaults Matrix

| Archetype | configure | customize | manual | Capability Overrides |
|-----------|-----------|-----------|--------|---------------------|
| `greenfield` | not_implemented | not_implemented | not_implemented | — |
| `security_defaults_only` | not_implemented | not_implemented | not_implemented | identity_access_management: configure=partial |
| `basic_ca_policies` | partial | not_implemented | not_implemented | identity_access_management: configure=implemented, customize=partial |
| `moderate_hardening` | partial | partial | not_implemented | identity_access_management: both=implemented; endpoint_*: configure=implemented |
| `managed_by_msp` | partial | partial | partial | — |

#### 5.5 Preamble Override Rules

| Preamble Field | Capability/Service Match | Status Resolution |
|----------------|--------------------------|-------------------|
| `endpoint_management` | endpoint_management, endpoint_protection, device_compliance capabilities; Intune/MDE services | intune_enrolled: configure=implemented, else=partial; third_party_mdm/mixed: partial; unmanaged: not_implemented |
| `monitoring_siem` | security_monitoring_logging, security_monitoring, audit_logging, incident_response capabilities; Sentinel services | sentinel_deployed: configure=implemented, else=partial; third_party_siem: partial; basic_m365_audit: configure=partial, else=not_implemented; none: not_implemented |
| `policy_doc_state` | action_type=policy; Compliance Manager services | ssp_with_policies: implemented; some_policies_drafted: partial; nothing_written: not_implemented |

#### 5.6 Conversion to RRT Answers

`convertToRRTAnswers()` transforms `DerivedActionStatus[]` into `Record<string, RRTAnswer>`:
- Actions with `not_applicable` status are **excluded** (not included in posture)
- Provenance mapping: inherent/license_gate/scope_gate -> `system_observation`; si_override/btc_risk_flag -> `operator_observation`; archetype_default/preamble_override -> `operator_inference`; advisor_override -> `client_assertion`

**Source:** `bulkAnswerDerivation.ts` lines 237-526

---

### 6. Deep Dive Question Flow

**File:** `src/features/rrt/components/RRQuestionPage.tsx` (565 lines)

For each question, the advisor provides:

| Input | Component | Description |
|-------|-----------|-------------|
| Answer value | `renderInput()` | Type-specific input (boolean, enum, multi_select, free_text, url, structured_json, evidence_upload) |
| Provenance | `ProvenanceSelector` | 6 options: auto_collected, client_assertion, operator_observation, operator_inference, assumption, system_observation |
| Evidence | `EvidenceCollector` | Location, source system, archetype ID, notes |
| Notes | Textarea | Free-form notes |

Each answer is structured as `RRTAnswer`:

```typescript
{
  question_id: string;
  answer: any;
  provenance_class: string;
  mapped_requirements: string[];
  assessor_methods_satisfied?: string[];
  expected_evidence_archetypes?: string[];
  evidence_ids?: string[];
  notes?: string;
}
```

The question page displays in a 2/3 + 1/3 layout:
- **Main panel:** Question text, advisor guidance, mapped requirements (clickable badges opening floating detail panels), assessor methods, answer input, provenance, evidence, notes
- **Advisory sidebar:** Why This Matters, CMMC Impact, Expected Evidence (with acceptable forms, collection methods), Guidance Steps, Technical RRT Fields

---

### 7. Evidence Model

**File:** `src/features/rrt/components/EvidenceCollector.tsx` + `src/features/rrt/types.ts`

```typescript
interface EvidenceItem {
  evidence_id: string;        // Auto-generated UUID
  source_system: string;      // e.g., "Azure AD", "SIEM"
  location: string;           // File path or URL
  hash_sha256: string;        // Content hash (placeholder in manual entry)
  captured_at: string;        // ISO datetime
  archetype_id: string;       // Evidence archetype ID
  collector?: string;         // Who/what collected this
  retention_days?: number;    // Days to retain
  freshness_days?: number;    // Max age before stale
  assessor_methods_supported?: string[];
  mapped_requirements?: string[];
  supporting_question_ids?: string[];
  notes?: string;
}
```

Evidence is stored in the RRT store's `evidenceItems` array and persisted to localStorage.

---

### 8. BTC Evidence Adapter

**File:** `src/features/rrt/services/btcEvidenceAdapter.ts`

BTC evidence references are converted to RRT `EvidenceItem` format:

| BTC Field | RRT Field |
|-----------|-----------|
| `evidence_id` | `evidence_id` |
| `source_system` | `source_system` |
| `location` | `location` |
| `hash_sha256` | `hash_sha256` |
| `captured_at` | `captured_at` |
| `question_id` | `supporting_question_ids[0]` |
| — | `archetype_id` = `'btc_evidence'` |
| `notes` | `notes` = `"From BTC: {notes}"` |

BTC evidence is injected idempotently into the RRT store (skips duplicates by `evidence_id`).

**Source:** `btcEvidenceAdapter.ts`, `RRTWizard.tsx` lines 132-148

---

## Part 3: Readiness Posture Generation

### 9. Posture Generator

**File:** `src/features/rrt/services/postureGenerator.ts` (242 lines)

`generateReadinessPosture()` takes:
- `answers: Record<string, RRTAnswer>` (from bulk derivation or deep dive)
- `evidenceItems: EvidenceItem[]` (advisor-collected evidence)
- `questionSet` (for metadata references)
- `siBaseline` (for constraints and level)
- `btcEvidenceItems?` (adapted BTC evidence)

#### 9.1 Requirement Result Mapping

`mapToRequirementResults()` aggregates answers into per-requirement results:

1. For each answer, iterate its `mapped_requirements`
2. Create or update a `RequirementResult` for each requirement ID
3. Add evidence references from `answer.evidence_ids`
4. Determine status from the answer value using `determineRequirementStatus()`
5. Merge statuses pessimistically using `mergeStatuses()`

**Status determination logic (`classifyAnswerString`):**

| Pattern | Status |
|---------|--------|
| `not_implemented`, `not implemented`, `no` | `not_met` |
| `partial`, `in_progress`, `in progress` | `partial` |
| `yes`, `implemented`, `true` | `met` |
| Fallback | `unknown` |

**Status merge precedence:** `not_met` > `partial` > `unknown` > `met`

#### 9.2 BTC Evidence Auto-Satisfaction

When BTC evidence items exist, the posture generator upgrades requirement results:
- If a requirement has status `unknown` AND matching BTC evidence maps to its requirement ID
- Status is upgraded to `partial` with note: `[BTC evidence contributes to satisfaction]`

#### 9.3 Control Status Summary

`computeControlStatusSummary()` counts requirements by status at the target CMMC level:

```typescript
{ level: string; met: number; partial: number; not_met: number; unknown: number }
```

#### 9.4 Key Findings Derivation

`deriveKeyFindings()` generates severity-tagged findings:

| Condition | Severity | Statement |
|-----------|----------|-----------|
| not_met count > 5 | `critical` | `{N} requirement(s) are currently NOT MET and require remediation.` |
| not_met count 1-5 | `high` | Same |
| unknown count > 0 | `medium` | `{N} requirement(s) have UNKNOWN status and need further investigation.` |
| No findings | `low` | `No significant findings at this time.` |

#### 9.5 Constraints Derivation

Extracted from SI baseline: `budget_constraints` and `schedule_constraints` from `si_baseline.dependencies`.

#### 9.6 Output Structure (ReadinessPosture)

```
{
  ces: {
    artifact: "CES_READINESS_POSTURE",
    version: "1.0.0",
    generated_on: ISO datetime,
    snapshot_id: string,
    as_of_date: ISO date,
    si_baseline_ref: ArtifactRef,
    rr_question_set_ref: ArtifactRef,
    control_status_summary: { level, met, partial, not_met, unknown },
    key_findings: Finding[],
    constraints: string[],
    requirement_results: RequirementResult[],
    evidence_index: EvidenceIndexEntry[],
  }
}
```

**Source:** `postureGenerator.ts` lines 10-88

### 10. Readiness Posture Schema

**File:** `public/schemas/CES RRT Readiness Posture.schema.json`

Required fields: `artifact`, `version`, `generated_on`, `snapshot_id`, `as_of_date`, `si_baseline_ref`, `rr_question_set_ref`, `control_status_summary`, `key_findings`, `constraints`, `requirement_results`, `evidence_index`

Requirement status enum: `met`, `partial`, `not_met`, `unknown`

Finding severity enum: `critical`, `high`, `medium`, `low`

---

## Part 4: Downstream Consumers

### 11. Gap Compiler

**File:** `src/features/mpt/services/gapCompiler.ts`

The gap compiler is the **primary consumer** of Readiness Posture data.

**11.1 `compileGapSet()`** (line 286) — Iterates `readinessPosture.ces.requirement_results`:
- Skips scoped-out requirements (from `buildScopeExclusions()`)
- For `not_met`, `partial`, or `unknown` statuses: creates a Gap with severity, classifications, missing evidence archetypes, and methods needed
- Gap severity is computed based on the requirement result status, requirement metadata, SI baseline context, and evidence matrix data

**11.2 Safety net** (line 373) — Catches in-scope requirements absent from the posture (never assessed) and creates gaps for them with status `unknown`.

**11.3 `buildControlDispositions()`** (line 152) — Uses posture to determine per-control stamper actions:

| Posture Status | Stamper Action | Category |
|----------------|---------------|----------|
| `met` (no exclusion) | `validate` | Automated |
| `not_met`/`partial`/`unknown` with gap | `implement` | Automated |
| `not_met`/`partial`/`unknown` with all-manual gaps | `manual_gate` | Non-Stack |
| Scoped out | `skip` | Excluded |
| No gap, not met | `skip` | Non-Stack |

**Source:** `gapCompiler.ts` lines 152-283, 286-400

### 12. Manual Plan Generator

**File:** `src/features/mpt/services/manualPlanGenerator.ts`

Consumes `readinessPosture` to:
- Build the readiness posture summary block (`snapshot_id`, `as_of_date`, level, status counts, compliance percentage)
- Derive key findings from requirement results
- Include posture reference in plan inputs

**Source:** `manualPlanGenerator.ts` + `planHelpers.ts` lines 53-130

### 13. Proposal Generator

**File:** `src/features/mpt/services/proposalGenerator.ts`

References posture via `readiness_posture_ref` in the proposal inputs block.

### 14. Policy Context Compiler

**File:** `src/features/mpt/services/policyContextCompiler.ts`

Exposes the Readiness Posture control status summary to all 17 Handlebars policy document templates:

| Template Variable | Source |
|-------------------|--------|
| `posture.met` | `control_status_summary.met` |
| `posture.partial` | `control_status_summary.partial` |
| `posture.not_met` | `control_status_summary.not_met` |
| `posture.unknown` | `control_status_summary.unknown` |
| `posture.total` | Sum of all statuses |
| `posture.compliance_pct` | `Math.round((met / total) * 100)` |
| `posture.has_posture` | `total > 0` |

**Source:** `policyContextCompiler.ts` lines 109-271

### 15. Control Assessment Report Generator

**File:** `src/features/mpt/services/controlAssessmentReportGenerator.ts`

Consumes `readinessPosture.ces.requirement_results` to generate the control assessment report with per-requirement status tracking.

### 16. Plan Helpers (Traceability)

**File:** `src/features/mpt/services/planHelpers.ts`

Builds the readiness posture section of the manual plan:
- Extracts `snapshot_id`, `as_of_date` from posture
- Counts met/partial/not_met/unknown
- Computes compliance percentage
- Derives key findings from requirement results for plan embedding

---

## Part 5: Landing Page Integration

### 17. Landing Page Cards

**File:** `src/features/landing/components/LandingPage.tsx`

The RRT appears as **two cards** on the landing page:

**RR Question Set Card:**
- Dropdown lists available question sets (labeled by creation date)
- Auto-selects first available question set
- 5-button grid: New/View/Export/Cancel+Confirm or spacer+Delete
- "New" triggers RR Question Set generation from the selected SI baseline
- Description: "Assess current compliance posture"
- Cascade on delete: deletes all associated postures and their mission plans

**Readiness Posture Card:**
- Dropdown lists available postures (labeled by creation date)
- Auto-selects first available posture
- 5-button grid: New/View/Export/Cancel+Confirm or spacer+Delete
- "New" navigates to `/rrt` (RRT wizard)
- Cascade on delete: deletes all mission plans where postureId matches

**Prerequisite:** Both cards require a selected SI baseline. The posture card requires a selected question set.

**Route:** `/rrt` -> `RRTPage` -> `RRTWizard`

### 18. Workflow State

**File:** `src/features/landing/hooks/useWorkflowState.ts`

The `useWorkflowState` hook queries:
- `availablePostures` via `dbHelpers.getPosturesByCustomerAndBaseline()`
- Sets `hasPosture: selectedPostureId != null`
- Passes `postureId` to downstream workflow checks

Auto-select: When no posture is selected but postures are available, the first is auto-selected.

---

## Part 6: Data Persistence

### 19. Storage Details

| Layer | Location | Details |
|-------|----------|---------|
| Wizard state | localStorage `rrt-store` | Zustand persisted: answers, evidenceItems, questionSet |
| RR Question Set artifact | IndexedDB `rr_question_sets` | Index: `++id, baselineId, customerId, [customerId+baselineId], createdAt` |
| Readiness Posture artifact | IndexedDB `readiness_postures` | Index: `++id, questionSetId, baselineId, customerId, [customerId+baselineId], createdAt` |
| Disk (dev) | `customers/{name}/inputs/rr-question-set-{id}.json` | Via Vite dev server API |
| Disk (dev) | `customers/{name}/inputs/readiness-posture-{id}.json` | Via Vite dev server API |
| App store | localStorage `ces-app-store` | `selectedPostureId` — reset on customer/baseline change |

**Cascade rules:**
- Deleting a **baseline** cascades to delete all question sets, and for each question set, all postures, and for each posture, all mission plans
- Deleting a **question set** cascades to delete all associated postures and their mission plans
- Deleting a **posture** cascades to delete all mission plans where `postureId` matches
- Changing the selected baseline resets `selectedPostureId` to null

**DB schema:** RR question sets added in version 1; compound indexes added in version 2.

---

## 20. Data Flow Diagram

```
SI Baseline (11 fields -> scenario profile)
  |
  +-- extractScenarioProfile() [questionSetGenerator.ts]
  |
  v
RR Question Bank (165 activities: 3 universal + 17 L1 + 110 L2 + 35 L3)
  |
  +-- Gate 1: CMMC Level Filter (applies_to_levels)
  +-- Gate 2: YAML Explicit Applicability (excludes/requires_any/boost_when)
  +-- Gate 3: Heuristic Rules (10 rules: 5 exclusion + 5 boost)
  +-- CUI Domain Boost (+8 for CUI-relevant domains)
  +-- Domain KB enrichment (CMMC Requirements Store, Assessor Approach KB)
  |
  v
RR Question Set (CES_RR_QUESTION_SET artifact)
  |
  v
Save to IndexedDB (rr_question_sets) + disk -> selectedQuestionSetId in AppStore
  |
  v
RRTWizard (4-phase orchestration)
  |
  |-- Phase 1: PREAMBLE
  |   |-- 5 questions (license_tier, security_archetype, endpoint_management,
  |   |                monitoring_siem, policy_doc_state)
  |   v
  |-- Phase 2: REVIEW (BulkReviewTable)
  |   |-- Load Implementation Patterns + Vendor Playbook + Tech Ref
  |   |-- deriveActionStatuses() — 6-step cascade:
  |   |   1. License gate (E5 service gating)
  |   |   2. Scope gate (level + CUI domain)
  |   |   3. Inherent check (platform inherent)
  |   |   4. SI overrides (cloud/CSP/BYOD)
  |   |   4.5. BTC risk flag gate (domain downgrade)
  |   |   5. Preamble overrides (endpoint/monitoring/policy)
  |   |   6. Archetype default (5x3 matrix)
  |   |-- Advisor overrides (per-action status dropdown)
  |   |-- BTC evidence injection (adaptBTCEvidence -> idempotent merge)
  |   v
  |-- Phase 3: POSTURE_REVIEW (PostureReview)
  |   |-- convertToRRTAnswers() — DerivedActionStatus[] -> RRTAnswer records
  |   |-- generateReadinessPosture()
  |   |   |-- mapToRequirementResults() — pessimistic merge per requirement
  |   |   |-- BTC evidence auto-satisfaction (unknown -> partial)
  |   |   |-- computeControlStatusSummary()
  |   |   |-- deriveKeyFindings()
  |   |   |-- deriveConstraints()
  |   v
  |-- Phase 4: DEEP_DIVE (optional, RRQuestionPage)
  |   |-- Question-by-question with evidence collector + provenance
  |   |-- Floating requirement detail panels
  |
  v
ReadinessPosture (CES_READINESS_POSTURE artifact)
  |
  v
Save to IndexedDB (readiness_postures) + disk -> selectedPostureId in AppStore
  |
  v
useMissionPlanGenerator (loads from DB, passes to all generators)
  |
  +---> Gap Compiler          (requirement_results -> gaps for not_met/partial/unknown)
  +---> Control Dispositions  (requirement_results -> validate/implement/manual_gate/skip)
  +---> Manual Plan Generator (posture summary, key findings, compliance %)
  +---> Proposal Generator    (readiness_posture_ref input)
  +---> Policy Context        (posture.* namespace: met/partial/not_met/unknown/total/compliance_pct)
  +---> Control Assessment    (requirement_results for per-control report)
  +---> Plan Helpers          (posture summary for traceability report)
```

---

## 21. Impact Summary Matrix

| Component / Field | Question Set Gen | Bulk Derivation | Posture Generator | Gap Compiler | Control Dispositions | Manual Plan | Proposal | Policy Context | Ctrl Assessment |
|-------------------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **SI: target_cmmc_level** | Level filter | Scope gate | Level in summary | Level hierarchy | Level filter | — | Target | — | — |
| **SI: cui_presence** | 3 exclusion rules | CUI scope gate | — | — | — | — | — | — | — |
| **SI: deployment_posture** | 1 boost rule | Cloud-only PE N/A | — | PE exclusions | — | — | — | Yes | — |
| **SI: boundary_strategy** | 1 boost rule | — | — | — | — | — | — | — | — |
| **SI: byod_posture** | 1 exclusion rule | Mobile N/A | — | — | — | — | — | — | — |
| **SI: evidence_posture_target** | 1 boost rule | — | — | — | — | — | — | — | — |
| **SI: assessment_route** | 2 boost rules | — | — | — | — | — | — | — | — |
| **SI: tenant_model_preference** | 1 boost rule | — | — | — | — | — | — | — | — |
| **SI: poam_policy_intent** | YAML rules | — | — | — | — | — | — | — | — |
| **SI: collaboration_mode** | YAML rules | — | — | — | — | — | — | — | — |
| **SI: devops_touches_cui** | YAML rules | — | — | — | — | — | — | — | — |
| **CUI Boundary** | +8 domain boost | — | — | Boundary relevance | — | — | — | — | — |
| **BTC risk_flags** | — | Domain downgrade | — | — | — | — | — | — | — |
| **BTC evidence_refs** | — | Evidence injection | Auto-satisfaction | — | — | — | — | — | — |
| **Preamble: license_tier** | — | E5 license gate | — | — | — | — | — | — | — |
| **Preamble: security_archetype** | — | Archetype default | — | — | — | — | — | — | — |
| **Preamble: endpoint_management** | — | Endpoint override | — | — | — | — | — | — | — |
| **Preamble: monitoring_siem** | — | Monitoring override | — | — | — | — | — | — | — |
| **Preamble: policy_doc_state** | — | Policy override | — | — | — | — | — | — | — |
| **Posture: requirement_results** | — | — | — | Gap generation | Stamper actions | Key findings | Ref | — | Per-control |
| **Posture: control_status_summary** | — | — | — | — | — | Summary block | — | posture.* namespace | — |
| **Posture: evidence_index** | — | — | — | — | — | — | — | — | — |
| **Posture: key_findings** | — | — | — | — | — | Findings block | — | — | — |
| **Posture: constraints** | — | — | SI budget/schedule | — | — | — | — | — | — |

**Key insight:** The RRT is the central bridge between strategic intent (SIT) and tactical execution (MPT). The 6-step derivation cascade converts 5 simple preamble answers plus SI baseline context into hundreds of action statuses, which become the Readiness Posture requirement results that drive every downstream artifact. The gap compiler's use of posture statuses as the primary input for gap identification makes the Readiness Posture the single most impactful artifact in the entire mission planning pipeline.
